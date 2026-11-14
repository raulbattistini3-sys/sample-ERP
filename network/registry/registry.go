// Package registry is where the ERP's services announce themselves and find each other.
//
// Each process (api, billing, importer, web) registers under its service name with an instance id it
// picks once at start, the address it actually listens on (after any dev port fallback), its version and
// how to check its health, and then repeats the registration as a heartbeat. The gateway routes a path
// prefix to a service name (the selector), never to a fixed address, and a service asks for another by
// name instead of reading BILLING_URL or IMPORTER_GRPC_URL. An instance that stops beating, or fails its
// health checks, drops out of the answers by itself.
package registry

import (
	"crypto/tls"
	"crypto/x509"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Instance is one running process of a service.
type Instance struct {
	Service string `json:"service"`
	ID      string `json:"id"`
	// http://host:port for HTTP services, grpc://host:port for gRPC ones
	Address string `json:"address"`
	Version string `json:"version,omitempty"`
	// HTTP path answered with 2xx while the instance is fine; empty for gRPC (a TCP connect is the check)
	Health string            `json:"health,omitempty"`
	Meta   map[string]string `json:"meta,omitempty"`

	RegisteredAt time.Time `json:"registeredAt"`
	LastSeen     time.Time `json:"lastSeen"`
	Healthy      bool      `json:"healthy"`
	Failures     int       `json:"failures"`
	// TTL is how long without a heartbeat before the instance is forgotten
	TTL time.Duration `json:"-"`
}

// Registration is what a service sends: PUT /registry/{service}/{id}.
type Registration struct {
	Address    string            `json:"address"`
	Version    string            `json:"version,omitempty"`
	Health     string            `json:"health,omitempty"`
	Meta       map[string]string `json:"meta,omitempty"`
	TTLSeconds int               `json:"ttlSeconds,omitempty"`
}

var (
	namePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)
	idPattern   = regexp.MustCompile(`^[A-Za-z0-9_.:-]{4,64}$`)

	ErrBadName    = errors.New("nome de serviço inválido (a-z, 0-9 e -, até 32)")
	ErrBadID      = errors.New("id de instância inválido (4 a 64 de [A-Za-z0-9_.:-])")
	ErrBadAddress = errors.New("endereço inválido: use http://, https:// ou grpc:// com host e porta")
	ErrPublicHost = errors.New("endereço fora da rede privada: só loopback e redes privadas podem se registrar")
	ErrBadHealth  = errors.New("caminho de saúde inválido")
	ErrTooMany    = errors.New("instâncias demais para este serviço")
)

const (
	DefaultTTL = 15 * time.Second
	MinTTL     = 5 * time.Second
	MaxTTL     = 5 * time.Minute
	// a stolen token can't fill the gateway's memory
	MaxPerService = 64
	MaxServices   = 32
	// health checks failed in a row before an instance stops getting traffic
	FailuresToUnhealthy = 2
)

// Registry is the in-memory table. Safe for concurrent use.
type Registry struct {
	log *slog.Logger
	// only loopback and private addresses may register (default): with the token leaked, nobody can point
	// /api at a server of theirs on the internet
	PrivateOnly bool
	// RootCAs checks https:// instances' certificates in health checks (NETWORK_UPSTREAM_CA); nil = system roots
	RootCAs *x509.CertPool
	now         func() time.Time
	lookupIP    func(ctx context.Context, host string) ([]net.IP, error)

	mu       sync.RWMutex
	services map[string]map[string]*Instance
	// round-robin position per service
	next map[string]*atomic.Uint64
}

func New(log *slog.Logger) *Registry {
	return &Registry{
		log:         log,
		PrivateOnly: true,
		now:         time.Now,
		lookupIP: func(ctx context.Context, host string) ([]net.IP, error) {
			return net.DefaultResolver.LookupIP(ctx, "ip", host)
		},
		services: map[string]map[string]*Instance{},
		next:     map[string]*atomic.Uint64{},
	}
}

// Register adds or refreshes an instance. A refresh with the same address keeps its health state; a new
// address starts over as healthy (it just said it is up).
func (r *Registry) Register(ctx context.Context, service, id string, reg Registration) (*Instance, error) {
	if !namePattern.MatchString(service) {
		return nil, ErrBadName
	}
	if !idPattern.MatchString(id) {
		return nil, ErrBadID
	}
	addr, err := r.checkAddress(ctx, reg.Address)
	if err != nil {
		return nil, err
	}
	if reg.Health != "" && (!strings.HasPrefix(reg.Health, "/") || len(reg.Health) > 128 || strings.ContainsAny(reg.Health, "?#\\ ")) {
		return nil, ErrBadHealth
	}
	ttl := DefaultTTL
	if reg.TTLSeconds > 0 {
		ttl = min(max(time.Duration(reg.TTLSeconds)*time.Second, MinTTL), MaxTTL)
	}
	meta := map[string]string{}
	for k, v := range reg.Meta {
		if len(meta) >= 16 {
			break
		}
		if len(k) <= 32 && len(v) <= 128 {
			meta[k] = v
		}
	}

	now := r.now()
	r.mu.Lock()
	defer r.mu.Unlock()
	instances := r.services[service]
	if instances == nil {
		if len(r.services) >= MaxServices {
			return nil, ErrTooMany
		}
		instances = map[string]*Instance{}
		r.services[service] = instances
		r.next[service] = &atomic.Uint64{}
	}
	in, ok := instances[id]
	if !ok {
		if len(instances) >= MaxPerService {
			return nil, ErrTooMany
		}
		in = &Instance{Service: service, ID: id, RegisteredAt: now, Healthy: true}
		instances[id] = in
		r.log.Info("instance registered", "svc", service, "id", id, "address", addr, "version", reg.Version)
	} else if in.Address != addr {
		in.Healthy, in.Failures = true, 0
		r.log.Info("instance moved", "svc", service, "id", id, "from", in.Address, "to", addr)
	}
	in.Address, in.Version, in.Health, in.Meta, in.TTL, in.LastSeen = addr, reg.Version, reg.Health, meta, ttl, now
	cp := *in
	return &cp, nil
}

// Deregister removes an instance (a clean shutdown); false when it wasn't there.
func (r *Registry) Deregister(service, id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.services[service][id]; !ok {
		return false
	}
	delete(r.services[service], id)
	r.log.Info("instance left", "svc", service, "id", id)
	return true
}

// Healthy lists the instances of service that should get traffic, sorted by id.
func (r *Registry) Healthy(service string) []Instance {
	r.mu.RLock()
	defer r.mu.RUnlock()
	now := r.now()
	var out []Instance
	for _, in := range r.services[service] {
		if in.Healthy && now.Sub(in.LastSeen) <= in.TTL {
			out = append(out, *in)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// Pick returns one healthy instance of service, taking turns between them.
func (r *Registry) Pick(service string) (Instance, bool) {
	list := r.Healthy(service)
	if len(list) == 0 {
		return Instance{}, false
	}
	r.mu.RLock()
	n := r.next[service]
	r.mu.RUnlock()
	return list[int(n.Add(1)-1)%len(list)], true
}

// All is every instance, healthy or not, grouped by service: the table GET /registry shows.
func (r *Registry) All() map[string][]Instance {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := map[string][]Instance{}
	for name, instances := range r.services {
		for _, in := range instances {
			out[name] = append(out[name], *in)
		}
		slices.SortFunc(out[name], func(a, b Instance) int { return strings.Compare(a.ID, b.ID) })
	}
	return out
}

// Expire forgets instances whose heartbeat is older than their TTL.
func (r *Registry) Expire() {
	now := r.now()
	r.mu.Lock()
	defer r.mu.Unlock()
	for name, instances := range r.services {
		for id, in := range instances {
			if now.Sub(in.LastSeen) > in.TTL {
				delete(instances, id)
				r.log.Warn("instance expired (no heartbeat)", "svc", name, "id", id, "address", in.Address)
			}
		}
	}
}

// Check runs one round of health checks, all instances at once, each within timeout.
func (r *Registry) Check(ctx context.Context, client *http.Client, timeout time.Duration) {
	type target struct{ service, id, address, health string }
	r.mu.RLock()
	var targets []target
	for name, instances := range r.services {
		for id, in := range instances {
			targets = append(targets, target{name, id, in.Address, in.Health})
		}
	}
	r.mu.RUnlock()

	var wg sync.WaitGroup
	for _, t := range targets {
		wg.Go(func() {
			cctx, cancel := context.WithTimeout(ctx, timeout)
			defer cancel()
			err := probe(cctx, client, t.address, t.health)
			r.record(t.service, t.id, t.address, err)
		})
	}
	wg.Wait()
}

func (r *Registry) record(service, id, address string, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	in, ok := r.services[service][id]
	if !ok || in.Address != address {
		return
	}
	if err == nil {
		if !in.Healthy {
			r.log.Info("instance healthy again", "svc", service, "id", id)
		}
		in.Healthy, in.Failures = true, 0
		return
	}
	in.Failures++
	if in.Healthy && in.Failures >= FailuresToUnhealthy {
		in.Healthy = false
		r.log.Warn("instance unhealthy", "svc", service, "id", id, "address", address, "err", err.Error())
	}
}

func probe(ctx context.Context, client *http.Client, address, health string) error {
	u, err := url.Parse(address)
	if err != nil {
		return err
	}
	if u.Scheme == "grpc" || health == "" {
		var d net.Dialer
		c, err := d.DialContext(ctx, "tcp", u.Host)
		if err != nil {
			return err
		}
		return c.Close()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(address, "/")+health, nil)
	if err != nil {
		return err
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return fmt.Errorf("health %s answered %d", health, res.StatusCode)
	}
	return nil
}

func (r *Registry) checkAddress(ctx context.Context, raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "grpc") || u.Port() == "" ||
		u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", ErrBadAddress
	}
	if r.PrivateOnly {
		ips := []net.IP{net.ParseIP(u.Hostname())}
		if ips[0] == nil {
			lctx, cancel := context.WithTimeout(ctx, 2*time.Second)
			defer cancel()
			if ips, err = r.lookupIP(lctx, u.Hostname()); err != nil || len(ips) == 0 {
				return "", ErrPublicHost
			}
		}
		for _, ip := range ips {
			if !(ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()) {
				return "", ErrPublicHost
			}
		}
	}
	return u.Scheme + "://" + u.Host, nil
}

// Run expires and health-checks on every tick until ctx ends.
func (r *Registry) Run(ctx context.Context, every time.Duration) {
	client := &http.Client{Timeout: 3 * time.Second,
		Transport: &http.Transport{Proxy: nil, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: r.RootCAs}},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			r.Expire()
			r.Check(ctx, client, 2*time.Second)
		}
	}
}
