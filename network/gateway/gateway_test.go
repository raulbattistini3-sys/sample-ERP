package gateway

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/raulbattistini3-sys/sample-ERP/network/registry"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

type fixture struct {
	gw    *Gateway
	reg   *registry.Registry
	calls atomic.Int32
	slow  chan struct{}
	last  atomic.Value // *http.Request seen by the upstream
}

func setup(t *testing.T, captcha *Captcha) *fixture {
	t.Helper()
	f := &fixture{}
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.calls.Add(1)
		f.last.Store(r.Clone(context.Background()))
		if f.slow != nil {
			<-f.slow
		}
		switch r.URL.Path {
		case "/docs":
			http.Redirect(w, r, "/docs/", http.StatusFound)
		case "/fail":
			w.WriteHeader(http.StatusInternalServerError)
		default:
			body, _ := io.ReadAll(r.Body)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"path": r.URL.Path, "n": f.calls.Load(), "body": string(body)})
		}
	}))
	t.Cleanup(api.Close)

	f.reg = registry.New(quiet)
	if _, err := f.reg.Register(context.Background(), "api", "api-test", registry.Registration{Address: api.URL}); err != nil {
		t.Fatal(err)
	}
	if captcha == nil {
		captcha = &Captcha{}
	}
	f.gw = New(Settings{
		Routes:  []Route{{Prefix: "/api", Service: "api", Strip: true}, {Prefix: "/billing", Service: "billing", Strip: true}},
		Rate:    1000, Burst: 1000, MaxBody: 1 << 10, MaxImport: 1 << 20,
	}, f.reg, captcha, 2*time.Second, quiet)
	return f
}

func (f *fixture) do(method, path, body string, h map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.RemoteAddr = "203.0.113.7:5555"
	for k, v := range h {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	f.gw.ServeHTTP(rec, req)
	return rec
}

func TestRoutesByServiceStripsPrefixAndRewritesRedirects(t *testing.T) {
	f := setup(t, nil)
	rec := f.do(http.MethodGet, "/api/products?q=x", "", map[string]string{"X-Forwarded-For": "6.6.6.6"})
	if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), `"path":"/products"`) {
		t.Fatalf("proxy: %d %s", rec.Code, rec.Body)
	}
	up := f.last.Load().(*http.Request)
	if got := up.Header.Get("X-Forwarded-For"); got != "203.0.113.7" {
		t.Fatalf("spoofed X-Forwarded-For passed through: %q", got)
	}
	if up.Header.Get("X-Forwarded-Prefix") != "/api" {
		t.Fatal("missing X-Forwarded-Prefix")
	}
	rec = f.do(http.MethodGet, "/api/docs", "", nil)
	if loc := rec.Header().Get("Location"); loc != "/api/docs/" {
		t.Fatalf("location: %q", loc)
	}
	if rec.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatal("security headers missing")
	}
	// billing has no instance: 503, not a hang or a 502 to a stale address
	if rec := f.do(http.MethodGet, "/billing/health", "", nil); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("no instance: %d", rec.Code)
	}
	if rec := f.do(http.MethodGet, "/api/internal/x", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("internal reachable: %d", rec.Code)
	}
}

func TestDoubleClickRunsOnce(t *testing.T) {
	f := setup(t, nil)
	f.slow = make(chan struct{})
	auth := map[string]string{"Authorization": "Bearer abc"}

	var wg sync.WaitGroup
	recs := make([]*httptest.ResponseRecorder, 2)
	for i := range recs {
		wg.Go(func() { recs[i] = f.do(http.MethodPost, "/api/clientes", `{"nome":"Ana"}`, auth) })
	}
	time.Sleep(100 * time.Millisecond) // both are in: one at the upstream, one waiting
	close(f.slow)
	wg.Wait()

	if n := f.calls.Load(); n != 1 {
		t.Fatalf("upstream called %d times", n)
	}
	deduped := 0
	for _, r := range recs {
		if r.Code != http.StatusCreated {
			t.Fatalf("status %d", r.Code)
		}
		if r.Header().Get(dedupedHeader) == "true" {
			deduped++
		}
	}
	if deduped != 1 || recs[0].Body.String() != recs[1].Body.String() {
		t.Fatalf("deduped=%d bodies %q %q", deduped, recs[0].Body, recs[1].Body)
	}

	// a click right after it answered is still the same click
	if r := f.do(http.MethodPost, "/api/clientes", `{"nome":"Ana"}`, auth); r.Header().Get(dedupedHeader) != "true" || f.calls.Load() != 1 {
		t.Fatal("click inside the window ran again")
	}
	// different values, or another user, are other requests
	f.do(http.MethodPost, "/api/clientes", `{"nome":"Bia"}`, auth)
	f.do(http.MethodPost, "/api/clientes", `{"nome":"Ana"}`, map[string]string{"Authorization": "Bearer other"})
	if n := f.calls.Load(); n != 3 {
		t.Fatalf("distinct requests: upstream called %d times", n)
	}
	// after the window it runs again
	f.gw.now = func() time.Time { return time.Now().Add(3 * time.Second) }
	f.do(http.MethodPost, "/api/clientes", `{"nome":"Ana"}`, auth)
	if n := f.calls.Load(); n != 4 {
		t.Fatalf("after window: %d", n)
	}
}

func TestIdempotencyKeyReplaysAndRejectsTampering(t *testing.T) {
	f := setup(t, nil)
	h := map[string]string{"Authorization": "Bearer abc", "Idempotency-Key": "key-123456"}
	if r := f.do(http.MethodPost, "/api/cobrancas", `{"valor":10}`, nil); r.Code != http.StatusBadRequest {
		t.Fatalf("key required on /api/cobrancas: %d", r.Code)
	}
	first := f.do(http.MethodPost, "/api/cobrancas", `{"valor":10}`, h)
	again := f.do(http.MethodPost, "/api/cobrancas", `{"valor":10}`, h)
	if f.calls.Load() != 1 || again.Header().Get(replayedHeader) != "true" || again.Body.String() != first.Body.String() {
		t.Fatalf("replay: calls=%d %q", f.calls.Load(), again.Header())
	}
	if r := f.do(http.MethodPost, "/api/cobrancas", `{"valor":1000}`, h); r.Code != http.StatusUnprocessableEntity {
		t.Fatalf("tampered body with the same key: %d", r.Code)
	}
}

func TestFailuresAreNotReplayed(t *testing.T) {
	f := setup(t, nil)
	f.do(http.MethodPost, "/api/fail", `{}`, nil)
	f.do(http.MethodPost, "/api/fail", `{}`, nil)
	if n := f.calls.Load(); n != 2 {
		t.Fatalf("a 5xx must let the retry through: %d calls", n)
	}
}

func TestBodyCap(t *testing.T) {
	f := setup(t, nil)
	if r := f.do(http.MethodPost, "/api/clientes", strings.Repeat("x", 2<<10), nil); r.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("over the cap: %d", r.Code)
	}
	if r := f.do(http.MethodPost, "/api/clientes/importacoes", strings.Repeat("x", 2<<10), nil); r.Code != http.StatusCreated {
		t.Fatalf("import route has the larger cap: %d", r.Code)
	}
}

func TestCaptchaOnLoginAndForFloodingClients(t *testing.T) {
	var score atomic.Value
	score.Store(0.9)
	google := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		ok := r.Form.Get("secret") == "s3cret" && strings.HasPrefix(r.Form.Get("response"), "good-")
		_ = json.NewEncoder(w).Encode(map[string]any{"success": ok, "score": score.Load()})
	}))
	defer google.Close()
	c := &Captcha{Secret: "s3cret", SiteKey: "site", MinScore: 0.5, Routes: []string{"POST /api/user/login"},
		Strikes: 3, SuspectFor: 10 * time.Minute, Endpoint: google.URL}
	f := setup(t, c)

	r := f.do(http.MethodPost, "/api/user/login", `{"email":"a"}`, nil)
	if r.Code != http.StatusPreconditionRequired || !strings.Contains(r.Body.String(), `"captcha":true`) {
		t.Fatalf("login without token: %d %s", r.Code, r.Body)
	}
	if r := f.do(http.MethodPost, "/api/user/login", `{"email":"a"}`, map[string]string{captchaHeader: "bad-token-xxxxxxxxxxxxxxxx"}); r.Code != http.StatusForbidden {
		t.Fatalf("bad token: %d", r.Code)
	}
	score.Store(0.1)
	if r := f.do(http.MethodPost, "/api/user/login", `{"email":"a"}`, map[string]string{captchaHeader: "good-token-xxxxxxxxxxxxxxx"}); r.Code != http.StatusForbidden {
		t.Fatalf("low score: %d", r.Code)
	}
	score.Store(0.9)
	if r := f.do(http.MethodPost, "/api/user/login", `{"email":"a"}`, map[string]string{captchaHeader: "good-token-xxxxxxxxxxxxxxx"}); r.Code != http.StatusCreated {
		t.Fatalf("good token: %d", r.Code)
	}
	if up := f.last.Load().(*http.Request); up.Header.Get(captchaHeader) != "" {
		t.Fatal("token forwarded to the API")
	}
	// other routes don't ask
	if r := f.do(http.MethodGet, "/api/products", "", nil); r.Code != http.StatusCreated {
		t.Fatalf("plain route: %d", r.Code)
	}

	// a flood: 3 strikes in a minute make the client suspect, then every request needs the check
	f.gw.limit = NewLimiter(1, 1)
	for range 4 {
		f.do(http.MethodGet, "/api/products", "", nil)
	}
	f.gw.limit = NewLimiter(1000, 1000)
	if r := f.do(http.MethodGet, "/api/products", "", nil); r.Code != http.StatusPreconditionRequired {
		t.Fatalf("suspect client not asked: %d", r.Code)
	}
	if r := f.do(http.MethodGet, "/api/products", "", map[string]string{captchaHeader: "good-token-xxxxxxxxxxxxxxx"}); r.Code != http.StatusCreated {
		t.Fatalf("suspect with token: %d", r.Code)
	}
	if r := f.do(http.MethodGet, "/api/products", "", nil); r.Code != http.StatusCreated {
		t.Fatalf("cleared after passing: %d", r.Code)
	}
}

func TestStaticFallbackServesTheApp(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>erp</html>"), 0o644)
	_ = os.MkdirAll(filepath.Join(dir, "assets"), 0o755)
	_ = os.WriteFile(filepath.Join(dir, "assets", "app.js"), []byte("js"), 0o644)
	f := setup(t, nil)
	f.gw = New(Settings{Routes: []Route{{Prefix: "/api", Service: "api", Strip: true}, {Prefix: "/", Service: "web"}}, WebDir: dir,
		Rate: 1000, Burst: 1000, MaxBody: 1 << 10, MaxImport: 1 << 20}, f.reg, &Captcha{}, time.Second, quiet)
	if r := f.do(http.MethodGet, "/clientes/empresas/10", "", nil); r.Code != 200 || !strings.Contains(r.Body.String(), "erp") {
		t.Fatalf("spa route: %d %s", r.Code, r.Body)
	}
	if r := f.do(http.MethodGet, "/assets/app.js", "", nil); !strings.Contains(r.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("asset cache: %q", r.Header().Get("Cache-Control"))
	}
	if r := f.do(http.MethodGet, "/api/products", "", nil); r.Code != http.StatusCreated {
		t.Fatalf("api under / route: %d", r.Code)
	}
}
