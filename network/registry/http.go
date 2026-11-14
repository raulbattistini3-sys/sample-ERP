package registry

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"
)

// Handler is the registry's control API, served on the network's private control address (never the
// public port). Every call must be signed (sign.go).
//
//	PUT    /registry/{service}/{id}   register or heartbeat (body: Registration)
//	DELETE /registry/{service}/{id}   leave (clean shutdown)
//	GET    /registry                  every instance, healthy or not, with its id
//	GET    /registry/{service}        the healthy instances of one service (discovery)
func Handler(regs *Registry, v *Verifier, log *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	signed := func(next func(http.ResponseWriter, *http.Request, []byte)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16<<10))
			if err != nil {
				writeErr(w, http.StatusRequestEntityTooLarge, "corpo grande demais")
				return
			}
			if err := v.Verify(r.Header.Get(Header), r.Method, r.URL.Path, body); err != nil {
				log.Warn("registry call refused", "method", r.Method, "path", r.URL.Path, "client", r.RemoteAddr, "reason", err.Error())
				writeErr(w, http.StatusUnauthorized, err.Error())
				return
			}
			next(w, r, body)
		}
	}

	mux.HandleFunc("PUT /registry/{service}/{id}", signed(func(w http.ResponseWriter, r *http.Request, raw []byte) {
		var body Registration
		if err := json.Unmarshal(raw, &body); err != nil {
			writeErr(w, http.StatusBadRequest, "JSON inválido")
			return
		}
		in, err := regs.Register(r.Context(), r.PathValue("service"), r.PathValue("id"), body)
		if err != nil {
			status := http.StatusBadRequest
			if errors.Is(err, ErrTooMany) {
				status = http.StatusTooManyRequests
			}
			writeErr(w, status, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, in)
	}))
	mux.HandleFunc("DELETE /registry/{service}/{id}", signed(func(w http.ResponseWriter, r *http.Request, _ []byte) {
		if !regs.Deregister(r.PathValue("service"), r.PathValue("id")) {
			writeErr(w, http.StatusNotFound, "instância não registrada")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("GET /registry", signed(func(w http.ResponseWriter, _ *http.Request, _ []byte) {
		writeJSON(w, http.StatusOK, map[string]any{"services": regs.All(), "at": time.Now().UTC()})
	}))
	mux.HandleFunc("GET /registry/{service}", signed(func(w http.ResponseWriter, r *http.Request, _ []byte) {
		list := regs.Healthy(r.PathValue("service"))
		if list == nil {
			list = []Instance{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"instances": list})
	}))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	return mux
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"message": msg, "status": "error"})
}
