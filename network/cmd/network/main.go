// Command network is the ERP's network service: the service registry (where api, billing, importer and
// web announce themselves by name and instance id, and find each other) on a private control address, and
// the public gateway in front of the browser (reverse proxy, rate limits, double-click dedupe,
// reCAPTCHA, TLS) on the public one.
//
// Configuration (environment):
//
//	NETWORK_ADDR           public gateway address (default :8080)
//	NETWORK_CONTROL_ADDR   registry address, keep it private (default 127.0.0.1:7070)
//	NETWORK_TOKEN          shared secret that signs registry calls (required, 32+ characters)
//	NETWORK_ENV            development | production (default production)
//	NETWORK_ROUTES         prefix=service list (default "/api=api,/billing=billing,/=web")
//	NETWORK_WEB_DIR        the built web app, served when no "web" instance is registered
//	NETWORK_RATE, NETWORK_BURST           per-client token bucket (default 20/s, 40)
//	NETWORK_TRUST_PROXY    trust X-Forwarded-For (only behind a proxy you run)
//	NETWORK_MAX_BODY_MB, NETWORK_MAX_IMPORT_MB   body caps (default 1, 128)
//	NETWORK_DEDUPE_MS      double-click window (default 2000)
//	NETWORK_TLS_CERT, NETWORK_TLS_KEY     serve HTTPS (TLS 1.2+)
//	NETWORK_ALLOW_PUBLIC_REGISTRATION     let instances register non-private addresses (default false)
//	RECAPTCHA_SECRET, RECAPTCHA_SITE_KEY, RECAPTCHA_MIN_SCORE (0.5), RECAPTCHA_ROUTES ("POST /api/user/login")
//	LOG_FORMAT (json|text), LOG_LEVEL
package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/raulbattistini3-sys/sample-ERP/network/client"
	"github.com/raulbattistini3-sys/sample-ERP/network/gateway"
	"github.com/raulbattistini3-sys/sample-ERP/network/logx"
	"github.com/raulbattistini3-sys/sample-ERP/network/registry"
)

var version = "dev"

func main() {
	// `network dev`: the development supervisor (web + api as children; the API starts the rest)
	if len(os.Args) > 1 && os.Args[1] == "dev" {
		os.Exit(dev(os.Args[2:]))
	}
	if err := run(); err != nil {
		slog.Error("network stopped", "err", err.Error())
		os.Exit(1)
	}
}

func env(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func num(k string, def float64) (float64, error) {
	v := env(k, "")
	if v == "" {
		return def, nil
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil || f < 0 {
		return 0, fmt.Errorf("%s=%q is not a non-negative number", k, v)
	}
	return f, nil
}

func flag(k string) bool {
	v := strings.ToLower(env(k, ""))
	return v == "1" || v == "true" || v == "yes"
}

// ParseRoutes reads "/api=api,/billing=billing,/=web". Every prefix but "/" is stripped before forwarding.
func ParseRoutes(s string) ([]gateway.Route, error) {
	var out []gateway.Route
	for part := range strings.SplitSeq(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		prefix, service, ok := strings.Cut(part, "=")
		prefix, service = strings.TrimRight(strings.TrimSpace(prefix), "/"), strings.TrimSpace(service)
		if prefix == "" {
			prefix = "/"
		}
		if !ok || !strings.HasPrefix(prefix, "/") || service == "" {
			return nil, fmt.Errorf("NETWORK_ROUTES: %q is not prefix=service", part)
		}
		out = append(out, gateway.Route{Prefix: prefix, Service: service, Strip: prefix != "/"})
	}
	if len(out) == 0 {
		return nil, errors.New("NETWORK_ROUTES has no routes")
	}
	return out, nil
}

func run() error {
	development := strings.HasPrefix(strings.ToLower(env("NETWORK_ENV", "production")), "dev")
	format := env("LOG_FORMAT", "json")
	if development && os.Getenv("LOG_FORMAT") == "" {
		format = "text"
	}
	instance := client.NewID("network")
	log := logx.New(logx.Options{Service: "network", Instance: instance, Format: format, Level: logx.ParseLevel(env("LOG_LEVEL", "info"))})

	token := os.Getenv("NETWORK_TOKEN")
	if len(token) < 32 {
		return errors.New("NETWORK_TOKEN must be set to a secret of at least 32 characters (it signs every registry call)")
	}
	routes, err := ParseRoutes(env("NETWORK_ROUTES", "/api=api,/billing=billing,/=web"))
	if err != nil {
		return err
	}
	rate, err := num("NETWORK_RATE", 20)
	if err != nil {
		return err
	}
	burst, err := num("NETWORK_BURST", 40)
	if err != nil {
		return err
	}
	maxBody, err := num("NETWORK_MAX_BODY_MB", 1)
	if err != nil {
		return err
	}
	maxImport, err := num("NETWORK_MAX_IMPORT_MB", 128)
	if err != nil {
		return err
	}
	dedupeMs, err := num("NETWORK_DEDUPE_MS", 2000)
	if err != nil {
		return err
	}
	minScore, err := num("RECAPTCHA_MIN_SCORE", 0.5)
	if err != nil {
		return err
	}
	certFile, keyFile := env("NETWORK_TLS_CERT", ""), env("NETWORK_TLS_KEY", "")
	if (certFile == "") != (keyFile == "") {
		return errors.New("set both NETWORK_TLS_CERT and NETWORK_TLS_KEY, or neither")
	}
	webDir := env("NETWORK_WEB_DIR", "")
	if webDir != "" {
		if _, err := os.Stat(webDir + "/index.html"); err != nil {
			log.Warn("NETWORK_WEB_DIR has no index.html; the web app is served only by a registered \"web\" instance", "dir", webDir)
			webDir = ""
		}
	}

	captcha := &gateway.Captcha{
		Secret:     os.Getenv("RECAPTCHA_SECRET"),
		SiteKey:    env("RECAPTCHA_SITE_KEY", ""),
		MinScore:   minScore,
		Routes:     strings.Split(env("RECAPTCHA_ROUTES", "POST /api/user/login"), ","),
		Strikes:    3,
		SuspectFor: 10 * time.Minute,
	}
	for i, r := range captcha.Routes {
		captcha.Routes[i] = strings.TrimSpace(r)
	}
	if !captcha.Enabled() {
		log.Warn("reCAPTCHA is off (no RECAPTCHA_SECRET): no human check on login or for flooding clients")
	} else if captcha.SiteKey == "" {
		return errors.New("RECAPTCHA_SECRET is set but RECAPTCHA_SITE_KEY is not: the web app needs the site key")
	}

	var upstreamCA *x509.CertPool
	if f := env("NETWORK_UPSTREAM_CA", ""); f != "" {
		pem, err := os.ReadFile(f)
		if err != nil {
			return fmt.Errorf("NETWORK_UPSTREAM_CA: %w", err)
		}
		upstreamCA = x509.NewCertPool()
		if !upstreamCA.AppendCertsFromPEM(pem) {
			return fmt.Errorf("NETWORK_UPSTREAM_CA: no PEM certificate in %s", f)
		}
	}

	reg := registry.New(log)
	reg.PrivateOnly = !flag("NETWORK_ALLOW_PUBLIC_REGISTRATION")
	reg.RootCAs = upstreamCA
	verifier := registry.NewVerifier([]byte(token))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	gw := gateway.New(gateway.Settings{
		Routes:      routes,
		WebDir:      webDir,
		Rate:        rate,
		Burst:       int(burst),
		TrustProxy:  flag("NETWORK_TRUST_PROXY"),
		MaxBody:     int64(maxBody * (1 << 20)),
		MaxImport:   int64(maxImport * (1 << 20)),
		HTTPS:       certFile != "",
		UpstreamCA:  upstreamCA,
		Development: development,
	}, reg, captcha, time.Duration(dedupeMs)*time.Millisecond, log)

	controlLn, err := listen(env("NETWORK_CONTROL_ADDR", "127.0.0.1:7070"), false, log, "control (NETWORK_CONTROL_ADDR; services find the network there, so it never moves)")
	if err != nil {
		return err
	}
	publicLn, err := listen(env("NETWORK_ADDR", ":8080"), development, log, "gateway")
	if err != nil {
		return err
	}

	control := &http.Server{Handler: registry.Handler(reg, verifier, log), ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, ErrorLog: slog.NewLogLogger(log.Handler(), slog.LevelWarn)}
	public := &http.Server{Handler: gw, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second,
		MaxHeaderBytes: 64 << 10, ErrorLog: slog.NewLogLogger(log.Handler(), slog.LevelWarn)}
	if certFile != "" {
		public.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS13}
	}

	go reg.Run(ctx, 5*time.Second)
	go gw.Janitor(ctx)

	errs := make(chan error, 2)
	go func() { errs <- control.Serve(controlLn) }()
	go func() {
		if certFile != "" {
			errs <- public.ServeTLS(publicLn, certFile, keyFile)
		} else {
			errs <- public.Serve(publicLn)
		}
	}()
	log.Info("network up", "version", version, "gateway", publicLn.Addr().String(), "control", controlLn.Addr().String(),
		"https", certFile != "", "routes", env("NETWORK_ROUTES", "/api=api,/billing=billing,/=web"), "web_dir", webDir,
		"recaptcha", captcha.Enabled(), "env", map[bool]string{true: "development", false: "production"}[development])

	select {
	case <-ctx.Done():
	case err := <-errs:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	}
	log.Info("network stopping")
	sctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = public.Shutdown(sctx)
	_ = control.Shutdown(sctx)
	return nil
}

// listen binds addr; in development a taken port moves to the next free one (up to 20), like the other
// services, and says so. Production fails on the configured port.
func listen(addr string, development bool, log *slog.Logger, what string) (net.Listener, error) {
	ln, err := net.Listen("tcp", addr)
	if err == nil || !development {
		if err != nil {
			return nil, fmt.Errorf("%s: %w", what, err)
		}
		return ln, nil
	}
	host, portStr, splitErr := net.SplitHostPort(addr)
	port, convErr := strconv.Atoi(portStr)
	if splitErr != nil || convErr != nil || port == 0 {
		return nil, fmt.Errorf("%s: %w", what, err)
	}
	for p := port + 1; p <= port+20 && p <= 65535; p++ {
		if ln, e := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(p))); e == nil {
			log.Warn("port taken; using the next free one (development only)", "what", what, "wanted", port, "using", p)
			return ln, nil
		}
	}
	return nil, fmt.Errorf("%s: %w (and the next 20 ports are taken too)", what, err)
}
