// Package gateway is the network service's public port: the only address the browser talks to. It serves
// the web app and forwards /api and /billing to whichever registered instance of the service the route
// names (the selector), so no address is configured anywhere: a service that moved to another port, or
// a second instance, is reachable as soon as it registers.
//
//	browser ──► :8080 (HTTPS when NETWORK_TLS_CERT/KEY are set)
//	              ├─ /healthz              204, never limited
//	              ├─ /_network/config      the reCAPTCHA site key, for the web app
//	              ├─ /api/*     → registry "api"     (prefix stripped)
//	              ├─ /billing/* → registry "billing" (Stripe webhooks)
//	              └─ /*         → registry "web" (the Vite dev server) or the built app in NETWORK_WEB_DIR
//
// Every request to a service, in order:
//  1. per-client rate limit, 429 + Retry-After; repeated 429s make the client "suspect"
//  2. path policy: /api/internal/* and /billing/internal/* are never reachable from outside
//  3. human check (reCAPTCHA v3) on the listed routes and for suspect clients, 428 to ask for it
//  4. body cap per route: the spreadsheet imports get the larger one, 413 past it
//  5. Idempotency-Key on POSTs that create records (required) or any POST that sends one
//  6. double-click dedupe on every other POST/PUT/PATCH/DELETE
//  7. forwarded to a healthy instance, with client-sent X-Forwarded-* replaced by the gateway's own,
//     redirects rewritten back under the prefix, and WebSocket/SSE passed through unbuffered
package gateway

import (
	"crypto/tls"
	"crypto/x509"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/raulbattistini3-sys/sample-ERP/network/logx"
	"github.com/raulbattistini3-sys/sample-ERP/network/registry"
)

// Route maps a path prefix to a service name.
type Route struct {
	Prefix  string
	Service string
	// strip the prefix before forwarding (the API serves /products, not /api/products)
	Strip bool
}

type Settings struct {
	Routes []Route
	// the built web app; served when no "web" instance is registered
	WebDir string

	Rate       float64
	Burst      int
	TrustProxy bool
	MaxBody    int64
	MaxImport  int64
	HTTPS      bool
	// the internal CA (NETWORK_UPSTREAM_CA): services that announce https:// addresses (the API, billing)
	// are reached over TLS 1.3 and must present a certificate it signed; nil = the system roots
	UpstreamCA *x509.CertPool
	// development: X-Network-Instance pins a request to one instance, and answers say who served them
	Development bool
}

// POSTs that create records: a retried or replayed one must not create a second
var idempotencyRequired = []string{
	"/api/products", "/api/products/imports", "/api/products/import", "/api/categorias", "/api/auditoria",
	"/api/auditoria/manual", "/api/detalhamento-auditoria", "/api/user",
	// Stripe invoices: a replay must not bill anyone twice
	"/api/cobrancas",
}

// their responses carry session tokens or reset links: never kept for replay
var neverStored = []string{"/api/user/"}

var importRoutes = []string{
	"/api/products/imports", "/api/products/import", "/api/clientes/importacoes", "/api/clientes/empresas/importacoes",
}

// the services' own channels to each other
var blocked = []string{"/api/internal", "/billing/internal"}

const (
	dedupedHeader  = "X-Network-Deduplicated"
	instanceHeader = "X-Network-Instance"
	serviceHeader  = "X-Network-Service"
)

type Gateway struct {
	s     Settings
	reg   *registry.Registry
	log   *slog.Logger
	now   func() time.Time
	limit *Limiter
	idem  *IdempotencyStore
	dedup *Dedupe
	capt  *Captcha
	proxy *httputil.ReverseProxy
	files http.Handler
}

type target struct {
	route    Route
	instance registry.Instance
	base     *url.URL
}

type ctxTarget struct{}

func New(s Settings, reg *registry.Registry, captcha *Captcha, dedupeWindow time.Duration, log *slog.Logger) *Gateway {
	// longest prefix first, so /api/x never lands on /
	routes := slices.Clone(s.Routes)
	slices.SortFunc(routes, func(a, b Route) int { return len(b.Prefix) - len(a.Prefix) })
	s.Routes = routes

	g := &Gateway{
		s: s, reg: reg, log: log, now: time.Now,
		limit: NewLimiter(s.Rate, s.Burst),
		idem:  NewIdempotencyStore(),
		dedup: NewDedupe(dedupeWindow),
		capt:  captcha,
	}
	if s.WebDir != "" {
		g.files = spa(s.WebDir)
	}
	transport := &http.Transport{
		Proxy:               nil, // never through an environment proxy: upstreams are private
		DialContext:         (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		MaxIdleConnsPerHost: 64,
		IdleConnTimeout:     90 * time.Second,
		ForceAttemptHTTP2:   false,
		TLSClientConfig:     &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: s.UpstreamCA},
	}
	g.proxy = &httputil.ReverseProxy{
		Transport:     transport,
		FlushInterval: -1, // SSE (/cobrancas/eventos) and streamed exports go out as they come
		Rewrite:       g.rewrite,
		ModifyResponse: func(res *http.Response) error {
			t, _ := res.Request.Context().Value(ctxTarget{}).(target)
			// the gateway sets these itself; a second copy from the service would only confuse browsers
			for _, k := range securityHeaderNames {
				res.Header.Del(k)
			}
			if loc := res.Header.Get("Location"); loc != "" && t.route.Strip {
				if v, ok := rewriteLocation(loc, t.route.Prefix); ok {
					res.Header.Set("Location", v)
				}
			}
			if g.s.Development {
				res.Header.Set(serviceHeader, t.instance.Service+"/"+t.instance.ID)
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			t, _ := r.Context().Value(ctxTarget{}).(target)
			logx.From(r.Context()).Error("upstream unavailable", "svc", t.instance.Service, "id", t.instance.ID,
				"address", t.instance.Address, "path", r.URL.Path, "err", err.Error())
			writeError(w, http.StatusBadGateway, "Serviço indisponível no momento.", nil)
		},
	}
	return g
}

// Janitor clears expired limiter buckets, idempotency keys, dedupe flights and suspicions every minute.
func (g *Gateway) Janitor(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			g.limit.GC(now)
			g.idem.GC(now)
			g.dedup.GC(now)
			g.capt.GC(now)
		}
	}
}

func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := g.now()
	cw := &capture{ResponseWriter: w}
	client := clientIP(r, g.s.TrustProxy)
	ctx := logx.With(r.Context(), g.log)
	r = r.WithContext(ctx)
	var why string
	defer func() {
		attrs := []slog.Attr{}
		if why != "" {
			attrs = append(attrs, slog.String("by", why))
		}
		if t, ok := r.Context().Value(ctxTarget{}).(target); ok {
			attrs = append(attrs, slog.String("svc", t.instance.Service), slog.String("id", t.instance.ID))
		}
		if r.URL.Path != "/healthz" {
			logx.Request(g.log, r, client, cw.statusOr200(), cw.n, g.now().Sub(start), attrs...)
		}
	}()
	securityHeaders(cw.Header(), g.s.HTTPS)
	// never let a client speak for the gateway
	for _, h := range []string{instanceHeader, serviceHeader, dedupedHeader, registry.Header} {
		if h != instanceHeader || !g.s.Development {
			r.Header.Del(h)
		}
	}

	switch r.URL.Path {
	case "/healthz":
		cw.WriteHeader(http.StatusNoContent)
		return
	case "/_network/config":
		siteKey := ""
		if g.capt.Enabled() {
			siteKey = g.capt.SiteKey
		}
		cw.Header().Set("Cache-Control", "no-store")
		writeJSON(cw, http.StatusOK, map[string]any{"recaptchaSiteKey": siteKey})
		return
	}

	route, ok := g.match(r.URL.Path)
	if !ok {
		writeError(cw, http.StatusNotFound, "Not found", nil)
		return
	}
	// the web app: the dev server when one registered, the built files otherwise. Not limited: a page
	// load fetches dozens of assets, and they are static
	if route.Service == "web" {
		if _, live := g.reg.Pick("web"); !live && g.files != nil {
			g.files.ServeHTTP(cw, r)
			return
		}
	}
	p := r.URL.Path

	// 1. rate limit
	if route.Service != "web" {
		if ok, wait := g.limit.Allow(client, start); !ok {
			why = "rate_limited"
			if g.capt.Strike(client, start) {
				g.log.Warn("client suspect: human check required", "client", client, "for", g.capt.SuspectFor.String())
			}
			cw.Header().Set("Retry-After", strconv.Itoa(max(int(wait.Seconds()+0.999), 1)))
			writeError(cw, http.StatusTooManyRequests, "Muitas requisições; tente de novo em instantes.", nil)
			return
		}
	}

	// 2. path policy
	for _, b := range blocked {
		if p == b || strings.HasPrefix(p, b+"/") {
			why = "blocked"
			writeError(cw, http.StatusNotFound, "Not found", nil)
			return
		}
	}

	// 3. human check
	if route.Service != "web" && g.capt.Required(r.Method, p, client, start) {
		token := r.Header.Get(captchaHeader)
		if token == "" {
			why = "captcha"
			writeError(cw, http.StatusPreconditionRequired, "Confirme que você não é um robô.",
				map[string]any{"captcha": true, "siteKey": g.capt.SiteKey})
			return
		}
		vctx, cancel := context.WithTimeout(ctx, 6*time.Second)
		score, err := g.capt.Verify(vctx, token, client)
		cancel()
		if err != nil {
			why = "captcha_failed"
			g.log.Warn("human check failed", "client", client, "score", score, "err", err.Error())
			status := http.StatusForbidden
			if !errors.Is(err, ErrCaptchaInvalid) && !errors.Is(err, ErrCaptchaScore) {
				status = http.StatusServiceUnavailable
			}
			writeError(cw, status, "Não foi possível confirmar que você não é um robô. Tente de novo.",
				map[string]any{"captcha": true, "siteKey": g.capt.SiteKey})
			return
		}
	}
	r.Header.Del(captchaHeader)

	// pick the instance now: no point reading a 100 MB body for a service that isn't there
	t, ok := g.target(r, route)
	if !ok {
		why = "no_instance"
		cw.Header().Set("Retry-After", "2")
		writeError(cw, http.StatusServiceUnavailable, "Serviço indisponível no momento.", nil)
		return
	}
	r = r.WithContext(context.WithValue(r.Context(), ctxTarget{}, t))

	mutating := r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodPatch || r.Method == http.MethodDelete
	if !mutating || isUpgrade(r) {
		g.proxy.ServeHTTP(cw, r)
		return
	}

	// 4. body cap
	limit := g.s.MaxBody
	if r.Method == http.MethodPost && slices.Contains(importRoutes, p) {
		limit = g.s.MaxImport
	}
	body, err := io.ReadAll(http.MaxBytesReader(cw, r.Body, limit))
	if err != nil {
		why = "too_large"
		writeError(cw, http.StatusRequestEntityTooLarge, fmt.Sprintf("Requisição maior que o limite de %d MB.", limit>>20), nil)
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	r.ContentLength = int64(len(body))

	uri := r.URL.RequestURI()
	owner := r.Header.Get("Authorization")
	if owner == "" {
		owner = "ip:" + client
	}
	sensitive := slices.ContainsFunc(neverStored, func(n string) bool { return strings.HasPrefix(p, n) })

	// 5. idempotency
	key := r.Header.Get(idempotencyHeader)
	if r.Method == http.MethodPost && !sensitive && (key != "" || slices.Contains(idempotencyRequired, p)) {
		if !validKey(key) {
			writeError(cw, http.StatusBadRequest, "Cabeçalho Idempotency-Key obrigatório (8 a 255 caracteres de [A-Za-z0-9_.:-]).", nil)
			return
		}
		sk := scoped(owner, key)
		switch state, res := g.idem.acquire(sk, fingerprint(r.Method, uri, body), start); state {
		case inFlight:
			why = "idempotency_in_flight"
			cw.Header().Set("Retry-After", "1")
			writeError(cw, http.StatusConflict, "Uma requisição com esta Idempotency-Key ainda está em andamento.", nil)
			return
		case mismatch:
			why = "idempotency_mismatch"
			g.log.Warn("idempotency key reused with another request", "client", client, "path", p)
			writeError(cw, http.StatusUnprocessableEntity, "Esta Idempotency-Key já foi usada com outra requisição (método, caminho ou corpo diferentes).", nil)
			return
		case replay:
			why = "idempotency_replay"
			writeStored(cw, res, replayedHeader)
			return
		}
		cw.keep = true
		g.proxy.ServeHTTP(cw, r)
		if cw.statusOr200() >= 500 {
			g.idem.release(sk)
		} else {
			g.idem.complete(sk, cw.stored())
		}
		return
	}

	// 6. double-click dedupe
	sum := sha256.Sum256(body)
	dk := scoped(owner, r.Method+" "+uri+" "+hex.EncodeToString(sum[:]))
	f, leader := g.dedup.join(dk, start)
	if !leader {
		why = "deduplicated"
		res, err := f.wait(ctx)
		if err != nil {
			return // the client went away
		}
		if res == nil {
			writeError(cw, http.StatusConflict, "Esta mesma requisição acabou de ser enviada e não pôde ser repetida; confira o resultado antes de tentar de novo.", nil)
			return
		}
		writeStored(cw, res, dedupedHeader)
		return
	}
	cw.keep = true
	g.proxy.ServeHTTP(cw, r)
	var res *stored
	if cw.statusOr200() < 500 {
		res = cw.stored()
		if res.body == nil {
			res = nil
		}
	}
	g.dedup.finish(dk, f, res, !sensitive, g.now())
}

func (g *Gateway) match(p string) (Route, bool) {
	for _, rt := range g.s.Routes {
		if rt.Prefix == "/" || p == rt.Prefix || strings.HasPrefix(p, rt.Prefix+"/") {
			return rt, true
		}
	}
	return Route{}, false
}

func (g *Gateway) target(r *http.Request, rt Route) (target, bool) {
	var in registry.Instance
	ok := false
	if id := r.Header.Get(instanceHeader); id != "" && g.s.Development {
		for _, h := range g.reg.Healthy(rt.Service) {
			if h.ID == id {
				in, ok = h, true
			}
		}
	} else {
		in, ok = g.reg.Pick(rt.Service)
	}
	if !ok {
		return target{}, false
	}
	u, err := url.Parse(in.Address)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return target{}, false
	}
	return target{route: rt, instance: in, base: u}, true
}

func (g *Gateway) rewrite(pr *httputil.ProxyRequest) {
	t, _ := pr.In.Context().Value(ctxTarget{}).(target)
	rest := pr.In.URL.Path
	if t.route.Strip && t.route.Prefix != "/" {
		rest = strings.TrimPrefix(rest, t.route.Prefix)
		if rest == "" {
			rest = "/"
		}
	}
	pr.Out.URL.Scheme, pr.Out.URL.Host = t.base.Scheme, t.base.Host
	pr.Out.URL.Path, pr.Out.URL.RawPath = rest, ""
	pr.Out.Host = t.base.Host
	pr.Out.Header.Del(instanceHeader)
	// Rewrite already dropped the client's X-Forwarded-*; set ours
	client := clientIP(pr.In, g.s.TrustProxy)
	if prev := pr.In.Header.Get("X-Forwarded-For"); g.s.TrustProxy && prev != "" {
		pr.Out.Header.Set("X-Forwarded-For", prev+", "+peerIP(pr.In))
	} else {
		pr.Out.Header.Set("X-Forwarded-For", client)
	}
	proto := "http"
	if g.s.HTTPS {
		proto = "https"
	}
	pr.Out.Header.Set("X-Forwarded-Proto", proto)
	pr.Out.Header.Set("X-Forwarded-Host", pr.In.Host)
	if t.route.Strip && t.route.Prefix != "/" {
		pr.Out.Header.Set("X-Forwarded-Prefix", t.route.Prefix)
	}
}

// rewriteLocation puts a redirect to /docs/ from the API back under /api.
func rewriteLocation(loc, prefix string) (string, bool) {
	if strings.HasPrefix(loc, "/") && !strings.HasPrefix(loc, "//") && !strings.HasPrefix(loc, prefix+"/") {
		return prefix + loc, true
	}
	return "", false
}

// clientIP trusts X-Forwarded-For only behind a proxy the operator vouches for; anyone can send it.
func clientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if first, _, _ := strings.Cut(r.Header.Get("X-Forwarded-For"), ","); strings.TrimSpace(first) != "" {
			return strings.TrimSpace(first)
		}
	}
	return peerIP(r)
}

func peerIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func isUpgrade(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket")
}

// securityHeaders: HSTS keeps a browser that once reached the ERP over HTTPS from ever being downgraded to
// plain HTTP by someone in the middle; the rest stop sniffing, framing and referrer leaks.
var securityHeaderNames = []string{"Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options",
	"Referrer-Policy", "Cross-Origin-Opener-Policy", "Permissions-Policy"}

func securityHeaders(h http.Header, https bool) {
	if https {
		h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
	}
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	h.Set("Cross-Origin-Opener-Policy", "same-origin")
	h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError answers in the API's own error shape, so the web app shows these messages like any other.
func writeError(w http.ResponseWriter, status int, msg string, extra map[string]any) {
	body := map[string]any{"message": msg, "status": "error"}
	for k, v := range extra {
		body[k] = v
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, body)
}

func writeStored(w http.ResponseWriter, res *stored, mark string) {
	if res.body == nil {
		writeError(w, http.StatusConflict, "Esta requisição já foi processada; a resposta era grande demais para ser repetida.", nil)
		return
	}
	for k, vs := range res.header {
		if k == "Content-Length" {
			continue
		}
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.Header().Set(mark, "true")
	w.WriteHeader(res.status)
	_, _ = w.Write(res.body)
}

// capture records status and size for the access log and, when keep is set, a copy of the body (up to
// maxStoredBody) for idempotency and dedupe. It unwraps, so WebSocket hijacking and SSE flushing reach the
// real writer.
type capture struct {
	http.ResponseWriter
	status int
	n      int64
	keep   bool
	over   bool
	buf    bytes.Buffer
}

func (c *capture) WriteHeader(status int) {
	if c.status == 0 {
		c.status = status
	}
	c.ResponseWriter.WriteHeader(status)
}

func (c *capture) Write(p []byte) (int, error) {
	if c.status == 0 {
		c.status = http.StatusOK
	}
	if c.keep && !c.over {
		if c.buf.Len()+len(p) > maxStoredBody {
			c.over = true
			c.buf.Reset()
		} else {
			c.buf.Write(p)
		}
	}
	n, err := c.ResponseWriter.Write(p)
	c.n += int64(n)
	return n, err
}

func (c *capture) Unwrap() http.ResponseWriter { return c.ResponseWriter }

func (c *capture) Flush() {
	_ = http.NewResponseController(c.ResponseWriter).Flush()
}

func (c *capture) statusOr200() int {
	if c.status == 0 {
		return http.StatusOK
	}
	return c.status
}

func (c *capture) stored() *stored {
	h := c.Header().Clone()
	for _, k := range append(slices.Clone(securityHeaderNames), "Content-Length", "Set-Cookie") {
		h.Del(k)
	}
	res := &stored{status: c.statusOr200(), header: h}
	if !c.over {
		res.body = bytes.Clone(c.buf.Bytes())
		if res.body == nil {
			res.body = []byte{}
		}
	}
	return res
}

// spa serves the built web app: files as they are (hashed assets cached for a year), and index.html for
// any other path so the client router takes it.
func spa(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeError(w, http.StatusMethodNotAllowed, "Método não permitido.", nil)
			return
		}
		clean := path.Clean("/" + r.URL.Path)
		full := filepath.Join(dir, filepath.FromSlash(clean))
		if st, err := os.Stat(full); err != nil || st.IsDir() {
			w.Header().Set("Cache-Control", "no-cache")
			http.ServeFile(w, r, filepath.Join(dir, "index.html"))
			return
		}
		if strings.HasPrefix(clean, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		fs.ServeHTTP(w, r)
	})
}
