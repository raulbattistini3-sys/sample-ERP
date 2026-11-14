package main

import (
	"bufio"
	"os"
	"strings"
)

// loadDotEnv reads network/.env (when started from the repo root) or .env (when started from network/),
// whichever exists first, into the process environment. Variables that are already set win, so Docker,
// the launcher and the shell keep control. Lines are KEY=value; # starts a comment; quotes around the
// value are removed.
func loadDotEnv() string {
	for _, path := range []string{"network/.env", ".env"} {
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		defer f.Close()
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			line = strings.TrimPrefix(line, "export ")
			k, v, ok := strings.Cut(line, "=")
			k, v = strings.TrimSpace(k), strings.TrimSpace(v)
			if !ok || k == "" {
				continue
			}
			if len(v) >= 2 && (v[0] == '"' || v[0] == '\'') && v[len(v)-1] == v[0] {
				v = v[1 : len(v)-1]
			} else if i := strings.Index(v, " #"); i >= 0 {
				v = strings.TrimSpace(v[:i])
			}
			if _, set := os.LookupEnv(k); !set {
				os.Setenv(k, v)
			}
		}
		return path
	}
	return ""
}
