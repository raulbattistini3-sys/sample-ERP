package main

import (
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/raulbattistini3-sys/sample-ERP/network/supervisor"
)

// The sidecar of `network dev`: erp-cache, beside the API, which the stack works without. The TCC is no
// longer a sidecar: the API starts it as a child (API_CHILDREN "tcc"); network only hands the API the TCC's
// address and token (tccAPIEnv).
//
//	cache   erp-cache (../cache, go run ./cmd/erp-cache): the read cache in front of the API and the TCC
//	        server, when a cache.json is there (or CACHE_CONFIG is set).
//
// Either one ending is logged and nothing else is stopped. Both are found next to the repository (in it
// or in a folder above it) unless TCC_DIR / CACHE_DIR say where; --no-tcc / --no-cache skip them.

// tccWorkspace is the TCC pnpm workspace: TCC_DIR, or <ancestor>/tcc-v2/tcc-v1/demo-monorepo-workspace,
// <ancestor>/tcc-v1/demo-monorepo-workspace for the repository root and every folder above it.
func tccWorkspace(root string) string {
	if d := os.Getenv("TCC_DIR"); d != "" {
		return d
	}
	return findUp(root, func(d string) string {
		for _, rel := range []string{"tcc-v2/tcc-v1/demo-monorepo-workspace", "tcc-v1/demo-monorepo-workspace"} {
			p := filepath.Join(d, filepath.FromSlash(rel))
			if exists(filepath.Join(p, "apps", "server", "package.json")) {
				return p
			}
		}
		return ""
	})
}

// cacheDir is erp-cache's module: CACHE_DIR, or <ancestor>/cache holding cmd/erp-cache.
func cacheDir(root string) string {
	if d := os.Getenv("CACHE_DIR"); d != "" {
		return d
	}
	return findUp(root, func(d string) string {
		p := filepath.Join(d, "cache")
		if exists(filepath.Join(p, "cmd", "erp-cache", "main.go")) {
			return p
		}
		return ""
	})
}

func findUp(from string, at func(string) string) string {
	for d := from; ; d = filepath.Dir(d) {
		if p := at(d); p != "" {
			return p
		}
		if filepath.Dir(d) == d {
			return ""
		}
	}
}

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// tccAPIEnv is what the API needs to send its telemetry to the TCC, which the API itself starts as one of
// its children ("tcc" in API_CHILDREN, api/src/dev/children.ts): the server's address and token, read from
// secrets/tcc-server.env (PORT, TCC_TOKEN) unless TCC_TELEMETRY_URL / TCC_TOKEN are already set.
func tccAPIEnv(root string) (apiEnv []string) {
	vals := map[string]string{}
	if dir := secretsDir(root); dir != "" {
		vals = readEnvFile(filepath.Join(dir, "tcc-server.env"))
	}
	if os.Getenv("TCC_TELEMETRY_URL") == "" {
		port := vals["PORT"]
		if port == "" {
			port = "8787"
		}
		apiEnv = append(apiEnv, "TCC_TELEMETRY_URL=http://127.0.0.1:"+port+"/telemetry/host")
	}
	if os.Getenv("TCC_TOKEN") == "" && vals["TCC_TOKEN"] != "" {
		apiEnv = append(apiEnv, "TCC_TOKEN="+vals["TCC_TOKEN"])
	}
	return apiEnv
}

// secretsDir is erp-v1/secrets: TCC_SECRETS_DIR, or <ancestor>/secrets holding generate.ts.
func secretsDir(root string) string {
	if d := os.Getenv("TCC_SECRETS_DIR"); d != "" {
		return d
	}
	return findUp(root, func(d string) string {
		p := filepath.Join(d, "secrets")
		if exists(filepath.Join(p, "generate.ts")) {
			return p
		}
		return ""
	})
}

// readEnvFile reads KEY=value lines (# comments, optional quotes); a missing file is empty.
func readEnvFile(path string) map[string]string {
	out := map[string]string{}
	b, err := os.ReadFile(path)
	if err != nil {
		return out
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		k, v, ok := strings.Cut(line, "=")
		if !ok || line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		v = strings.TrimSpace(v)
		if len(v) >= 2 && (v[0] == '"' || v[0] == '\'') && v[len(v)-1] == v[0] {
			v = v[1 : len(v)-1]
		}
		out[strings.TrimSpace(k)] = v
	}
	return out
}

// startCache starts erp-cache when found and configured.
func startCache(sup *supervisor.Supervisor, root string, exited chan<- string) {
	dir := cacheDir(root)
	cfg := os.Getenv("CACHE_CONFIG")
	switch {
	case dir == "":
		// no cache module: nothing to say, it is optional
	case cfg == "" && !exists(filepath.Join(dir, "cache.json")):
		sup.Logf("network", "erp-cache found in %s but not started: no cache.json there (copy cache.example.json) and no CACHE_CONFIG", dir)
	default:
		goBin, err := exec.LookPath("go")
		if err != nil {
			sup.Logf("network", "erp-cache not started: go is not on PATH")
			return
		}
		if err := sup.Start(supervisor.Spec{Name: "cache", Dir: dir, Command: goBin, Args: []string{"run", "./cmd/erp-cache"}}, exited); err != nil {
			sup.Logf("network", "%v", err)
		}
	}
}

// erpAPIEnv is the API's share of secrets/sample-erp.env: the ERP's one DATABASE_URL (the API hands it on
// to the importer, and to billing as JDBC_DATABASE_URL), its CA, and what the vault child needs (its own
// database, the key folder, the token). Variables already in the environment win.
func erpAPIEnv(root string) (apiEnv []string) {
	dir := secretsDir(root)
	if dir == "" {
		return nil
	}
	vals := readEnvFile(filepath.Join(dir, "sample-erp.env"))
	if len(vals) == 0 {
		log.Printf("network: no %s; the API, importer and billing use their own .env DATABASE_URL", filepath.Join(dir, "sample-erp.env"))
	}
	if ca := vals["DATABASE_CA_CERT"]; ca != "" && !filepath.IsAbs(ca) {
		vals["DATABASE_CA_CERT"] = filepath.Join(dir, ca)
	}
	if b, err := os.ReadFile(filepath.Join(dir, "vault_token")); err == nil {
		vals["VAULT_TOKEN"] = strings.TrimSpace(string(b))
		vals["VAULT_URL"] = "http://127.0.0.1:8200"
	}
	if exists(filepath.Join(dir, "vault", "index.key")) {
		// written by secrets/generate.ts as plain hex files, not under DPAPI
		vals["VAULT_KEY_DIR"] = filepath.Join(dir, "vault")
		vals["VAULT_KEY_PROTECTION"] = "file"
	}
	for _, k := range []string{"DATABASE_URL", "DATABASE_CA_CERT", "VAULT_DATABASE_URL", "VAULT_KEY_DIR", "VAULT_KEY_PROTECTION", "VAULT_TOKEN", "VAULT_URL"} {
		if v := vals[k]; v != "" && os.Getenv(k) == "" {
			apiEnv = append(apiEnv, k+"="+v)
		}
	}
	return apiEnv
}
