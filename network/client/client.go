// Package client is how a Go service (the importer) joins the network: it registers itself under its
// service name and instance id, keeps the registration alive with heartbeats, leaves on shutdown, and asks
// for other services by name. Every call is signed with NETWORK_TOKEN (see registry/sign.go).
package client

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/raulbattistini3-sys/sample-ERP/network/registry"
)

type Client struct {
	base  string
	token []byte
	http  *http.Client
}

// FromEnv reads NETWORK_URL (the control address, e.g. http://127.0.0.1:7070) and NETWORK_TOKEN; ok is
// false when either is missing and the service should use its configured addresses instead.
func FromEnv() (*Client, bool) {
	base, token := strings.TrimSpace(os.Getenv("NETWORK_URL")), os.Getenv("NETWORK_TOKEN")
	if base == "" || token == "" {
		return nil, false
	}
	return New(base, token), true
}

func New(base, token string) *Client {
	return &Client{base: strings.TrimRight(base, "/"), token: []byte(token), http: &http.Client{Timeout: 5 * time.Second}}
}

// NewID is an instance id: the service name, the host name and a random suffix, so two processes of the
// same service on the same machine never collide.
func NewID(service string) string {
	var b [4]byte
	_, _ = rand.Read(b[:])
	host, _ := os.Hostname()
	host = strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' {
			return r
		}
		return '-'
	}, host)
	if len(host) > 24 {
		host = host[:24]
	}
	return fmt.Sprintf("%s-%s-%s", service, host, hex.EncodeToString(b[:]))
}

func (c *Client) do(ctx context.Context, method, path string, in, out any) error {
	var body []byte
	if in != nil {
		var err error
		if body, err = json.Marshal(in); err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(registry.Header, registry.Sign(c.token, method, path, body, time.Now()))
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		var e struct{ Message string }
		_ = json.Unmarshal(raw, &e)
		return fmt.Errorf("network %s %s: %d %s", method, path, res.StatusCode, e.Message)
	}
	if out != nil {
		return json.Unmarshal(raw, out)
	}
	return nil
}

func (c *Client) Register(ctx context.Context, service, id string, reg registry.Registration) error {
	return c.do(ctx, http.MethodPut, "/registry/"+service+"/"+id, reg, nil)
}

func (c *Client) Deregister(ctx context.Context, service, id string) error {
	return c.do(ctx, http.MethodDelete, "/registry/"+service+"/"+id, nil, nil)
}

// Resolve lists the healthy instances of service.
func (c *Client) Resolve(ctx context.Context, service string) ([]registry.Instance, error) {
	var out struct {
		Instances []registry.Instance `json:"instances"`
	}
	err := c.do(ctx, http.MethodGet, "/registry/"+service, nil, &out)
	return out.Instances, err
}

// Keep registers now and every `every` (the heartbeat; the registry forgets an instance after its TTL
// without one) until ctx ends, then leaves. Failures are logged and retried at the next beat: the
// service keeps running when the network is down, it just can't be found until it is back.
func (c *Client) Keep(ctx context.Context, service, id string, reg registry.Registration, every time.Duration, log *slog.Logger) {
	if reg.TTLSeconds == 0 {
		reg.TTLSeconds = int(3 * every / time.Second)
	}
	ok := true
	beat := func() {
		bctx, cancel := context.WithTimeout(ctx, 4*time.Second)
		defer cancel()
		err := c.Register(bctx, service, id, reg)
		switch {
		case err != nil && ok:
			log.Warn("network: registration failed; retrying", "svc", service, "id", id, "err", err.Error())
		case err == nil && !ok:
			log.Info("network: registered", "svc", service, "id", id, "address", reg.Address)
		}
		ok = err == nil
	}
	if err := c.Register(ctx, service, id, reg); err != nil {
		ok = false
		log.Warn("network: registration failed; retrying", "svc", service, "id", id, "err", err.Error())
	} else {
		log.Info("network: registered", "svc", service, "id", id, "address", reg.Address)
	}
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			lctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			_ = c.Deregister(lctx, service, id)
			cancel()
			return
		case <-t.C:
			beat()
		}
	}
}

// Advertise is the address other services reach this one at: scheme://host:port, where port is the port
// actually bound (after a development port move) and host is NETWORK_ADVERTISE_HOST, else 127.0.0.1 (the
// launcher runs everything on one machine; in docker set it to the service name).
func Advertise(scheme string, bound net.Addr) string {
	host := strings.TrimSpace(os.Getenv("NETWORK_ADVERTISE_HOST"))
	if host == "" {
		host = "127.0.0.1"
	}
	_, port, err := net.SplitHostPort(bound.String())
	if err != nil {
		port = bound.String()
	}
	return scheme + "://" + net.JoinHostPort(host, port)
}

// InstanceID is NETWORK_INSTANCE_ID when set (a stable id across restarts), else a fresh NewID.
func InstanceID(service string) string {
	if id := strings.TrimSpace(os.Getenv("NETWORK_INSTANCE_ID")); id != "" {
		return id
	}
	return NewID(service)
}
