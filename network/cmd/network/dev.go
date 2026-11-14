package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/raulbattistini3-sys/sample-ERP/network/supervisor"
)

// dev is `go run ./network/cmd/network dev` (or `bun run dev` at the repo root): the development stack in
// one terminal. The network service runs here as usual and starts two children,
//
//	web   bun run dev   (in web/)
//	api   bun run dev   (in api/), with API_CHILDREN=importer,vault,billing so the API starts those itself
//
// Every line comes out as "[name] ...". Ctrl+C (or SIGTERM) stops the API first, which stops its own
// children, then the web app, then the network; anything still running after 30 s is killed. If the web app
// or the API exits, the rest is stopped too, so a half-up stack never lingers.
//
// Flags: --no-web, --no-api; DEV_API_CHILDREN overrides the API's children (empty = none).
func dev(args []string) int {
	sup := &supervisor.Supervisor{Grace: 30 * time.Second}
	root, err := repoRoot()
	if err != nil {
		sup.Logf("network", "%v", err)
		return 1
	}
	web, api := true, true
	for _, a := range args {
		switch a {
		case "--no-web":
			web = false
		case "--no-api":
			api = false
		default:
			sup.Logf("network", "unknown flag %q (--no-web, --no-api)", a)
			return 2
		}
	}

	// the children join this network: the control address is fixed, and the token is the one it checks
	var join []string
	if t := os.Getenv("NETWORK_TOKEN"); t != "" {
		join = append(join, "NETWORK_URL=http://"+env("NETWORK_CONTROL_ADDR", "127.0.0.1:7070"), "NETWORK_TOKEN="+t)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serverDone := make(chan error, 1)
	go func() { serverDone <- run() }()

	exited := make(chan string, 4)
	bun := "bun"
	if runtime.GOOS == "windows" {
		bun = "bun.exe"
	}
	children, ok := os.LookupEnv("DEV_API_CHILDREN")
	if !ok {
		children = "importer,vault,billing"
	}
	started := 0
	if api {
		if err := sup.Start(supervisor.Spec{Name: "api", Dir: filepath.Join(root, "api"), Command: bun, Args: []string{"run", "dev"},
			Env: append([]string{"API_CHILDREN=" + children, "API_CHILDREN_ROOT=" + root}, join...)}, exited); err != nil {
			sup.Logf("network", "%v", err)
		} else {
			started++
		}
	}
	if web {
		if err := sup.Start(supervisor.Spec{Name: "web", Dir: filepath.Join(root, "web"), Command: bun, Args: []string{"run", "dev"}, Env: join}, exited); err != nil {
			sup.Logf("network", "%v", err)
		} else {
			started++
		}
	}

	code := 0
	select {
	case <-ctx.Done():
		sup.Logf("network", "stopping (Ctrl+C)")
	case name := <-exited:
		sup.Logf("network", "%s ended; stopping the rest", name)
		code = 1
	case err := <-serverDone:
		if err != nil && !errors.Is(err, context.Canceled) {
			sup.Logf("network", "network server stopped: %v", err)
			code = 1
		}
	}
	stopCtx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	sup.Stop(stopCtx)
	// run() watches the same signals; when stopping for another reason, ask it to end too
	if ctx.Err() == nil {
		if p, err := os.FindProcess(os.Getpid()); err == nil && runtime.GOOS != "windows" {
			_ = p.Signal(syscall.SIGTERM)
		}
	}
	select {
	case <-serverDone:
	case <-time.After(12 * time.Second):
	}
	_ = started
	return code
}

// repoRoot is the folder holding api/ and web/: the working directory or one of its parents.
func repoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for d := dir; ; d = filepath.Dir(d) {
		if st, err := os.Stat(filepath.Join(d, "api", "package.json")); err == nil && !st.IsDir() {
			if _, err := os.Stat(filepath.Join(d, "web", "package.json")); err == nil {
				return d, nil
			}
		}
		if filepath.Dir(d) == d {
			return "", fmt.Errorf("run it inside the repository: no api/ and web/ above %s", dir)
		}
	}
}
