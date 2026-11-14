package registry

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

func TestSignatureRejectsTamperingReplayAndOldOnes(t *testing.T) {
	token := []byte("0123456789abcdef0123456789abcdef")
	now := time.Now()
	v := NewVerifier(token)
	sig := Sign(token, "PUT", "/registry/api/a1b2", []byte(`{"address":"http://127.0.0.1:3333"}`), now)

	if err := v.Verify(sig, "PUT", "/registry/api/a1b2", []byte(`{"address":"http://127.0.0.1:3333"}`)); err != nil {
		t.Fatalf("valid signature refused: %v", err)
	}
	if err := v.Verify(sig, "PUT", "/registry/api/a1b2", []byte(`{"address":"http://127.0.0.1:3333"}`)); !errors.Is(err, ErrReplayed) {
		t.Fatalf("replay: got %v", err)
	}
	sig2 := Sign(token, "PUT", "/registry/api/a1b2", []byte(`{"address":"http://127.0.0.1:3333"}`), now)
	if err := v.Verify(sig2, "PUT", "/registry/api/a1b2", []byte(`{"address":"http://10.6.6.6:3333"}`)); !errors.Is(err, ErrInvalid) {
		t.Fatalf("tampered body: got %v", err)
	}
	if err := v.Verify(sig2, "PUT", "/registry/billing/a1b2", nil); !errors.Is(err, ErrInvalid) {
		t.Fatalf("tampered path: got %v", err)
	}
	old := Sign(token, "GET", "/registry", nil, now.Add(-2*time.Minute))
	if err := v.Verify(old, "GET", "/registry", nil); !errors.Is(err, ErrExpired) {
		t.Fatalf("old signature: got %v", err)
	}
	other := Sign([]byte("another-token-another-token-xxxxx"), "GET", "/registry", nil, now)
	if err := v.Verify(other, "GET", "/registry", nil); !errors.Is(err, ErrInvalid) {
		t.Fatalf("wrong token: got %v", err)
	}
	if err := v.Verify("", "GET", "/registry", nil); !errors.Is(err, ErrMissing) {
		t.Fatalf("missing: got %v", err)
	}
}

func TestRegisterPickExpireAndPrivateOnly(t *testing.T) {
	r := New(quiet)
	clock := time.Now()
	r.now = func() time.Time { return clock }
	ctx := context.Background()

	if _, err := r.Register(ctx, "api", "api-1", Registration{Address: "http://127.0.0.1:3333", TTLSeconds: 10}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Register(ctx, "api", "api-2", Registration{Address: "http://192.168.0.10:3334", TTLSeconds: 30}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Register(ctx, "api", "evil", Registration{Address: "http://8.8.8.8:80"}); !errors.Is(err, ErrPublicHost) {
		t.Fatalf("public address: got %v", err)
	}
	if _, err := r.Register(ctx, "api", "x1x1", Registration{Address: "ftp://127.0.0.1:21"}); !errors.Is(err, ErrBadAddress) {
		t.Fatalf("bad scheme: got %v", err)
	}
	if _, err := r.Register(ctx, "API!", "x1x1", Registration{Address: "http://127.0.0.1:1"}); !errors.Is(err, ErrBadName) {
		t.Fatalf("bad name: got %v", err)
	}

	seen := map[string]int{}
	for range 4 {
		in, ok := r.Pick("api")
		if !ok {
			t.Fatal("no instance")
		}
		seen[in.ID]++
	}
	if seen["api-1"] != 2 || seen["api-2"] != 2 {
		t.Fatalf("round robin: %v", seen)
	}

	clock = clock.Add(15 * time.Second) // api-1's TTL (10s) passed, api-2's (30s) didn't
	if h := r.Healthy("api"); len(h) != 1 || h[0].ID != "api-2" {
		t.Fatalf("after ttl: %+v", h)
	}
	r.Expire()
	if all := r.All()["api"]; len(all) != 1 {
		t.Fatalf("expired one should be gone: %+v", all)
	}
	if !r.Deregister("api", "api-2") || r.Deregister("api", "api-2") {
		t.Fatal("deregister")
	}
	if _, ok := r.Pick("api"); ok {
		t.Fatal("nothing should be left")
	}
}

func TestHealthChecksTakeAFailingInstanceOutAndBack(t *testing.T) {
	healthy := true
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if !healthy {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	r := New(quiet)
	ctx := context.Background()
	if _, err := r.Register(ctx, "billing", "billing-1", Registration{Address: srv.URL, Health: "/health"}); err != nil {
		t.Fatal(err)
	}
	healthy = false
	for range FailuresToUnhealthy {
		r.Check(ctx, srv.Client(), time.Second)
	}
	if _, ok := r.Pick("billing"); ok {
		t.Fatal("failing instance still picked")
	}
	healthy = true
	r.Check(ctx, srv.Client(), time.Second)
	if _, ok := r.Pick("billing"); !ok {
		t.Fatal("recovered instance not picked")
	}
}

func TestHandlerNeedsSignature(t *testing.T) {
	token := []byte("0123456789abcdef0123456789abcdef")
	r := New(quiet)
	h := Handler(r, NewVerifier(token), quiet)

	body := []byte(`{"address":"http://127.0.0.1:3333","health":"/healthz"}`)
	req := httptest.NewRequest(http.MethodPut, "/registry/api/api-1", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unsigned: %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPut, "/registry/api/api-1", bytes.NewReader(body))
	req.Header.Set(Header, Sign(token, http.MethodPut, "/registry/api/api-1", body, time.Now()))
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("signed: %d %s", rec.Code, rec.Body)
	}

	req = httptest.NewRequest(http.MethodGet, "/registry/api", nil)
	req.Header.Set(Header, Sign(token, http.MethodGet, "/registry/api", nil, time.Now()))
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out struct{ Instances []Instance }
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if rec.Code != http.StatusOK || len(out.Instances) != 1 || out.Instances[0].Address != "http://127.0.0.1:3333" {
		t.Fatalf("resolve: %d %s", rec.Code, rec.Body)
	}
}
