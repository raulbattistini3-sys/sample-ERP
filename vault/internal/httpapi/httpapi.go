// Package httpapi is the vault's REST API. Every route but /healthz needs `Authorization: Bearer <token>`;
// the vault keeps only the SHA-256 of the tokens and compares digests in constant time.
//
//	PUT    /v1/records/{ownerType}/{ownerId}          {"data":{...}}  seal (replaces)   -> masked record
//	GET    /v1/records/{ownerType}/{ownerId}[?reveal=true]                             -> record
//	DELETE /v1/records/{ownerType}/{ownerId}                                           -> 204
//	POST   /v1/records/{ownerType}/batch-get          {"owner_ids":[...]}               -> masked records
//	POST   /v1/lookup/cpf                             {"owner_type":"usuario","cpf":"..."} -> {"owner_id"}
//	POST   /v1/keys/rotate                            admin token only                  -> {"kek_version","rewrapped"}
//	GET    /healthz
//
// X-Vault-Actor (the ERP user acting) and X-Request-Id go to the audit trail.
package httpapi

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/raulbattistini3-sys/sample-ERP/vault/internal/audit"
	"github.com/raulbattistini3-sys/sample-ERP/vault/internal/service"
)

type Server struct {
	Vault     *service.Vault
	TokenHash []byte
	AdminHash []byte
}

func matches(header string, want []byte) bool {
	if want == nil || !strings.HasPrefix(header, "Bearer ") {
		return false
	}
	got := sha256.Sum256([]byte(strings.TrimPrefix(header, "Bearer ")))
	return subtle.ConstantTimeCompare(got[:], want) == 1
}

func (s *Server) auth(admin bool, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		var service string
		switch {
		case admin && matches(h, s.AdminHash):
			service = "admin"
		case !admin && matches(h, s.TokenHash):
			service = "api"
		default:
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		ctx := audit.WithCaller(r.Context(), audit.Caller{
			Service:   service,
			Actor:     clip(r.Header.Get("X-Vault-Actor")),
			RequestID: clip(r.Header.Get("X-Request-Id")),
		})
		next(w, r.WithContext(ctx))
	}
}

func clip(s string) string {
	if len(s) > 64 {
		return s[:64]
	}
	return s
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := s.Vault.Store.Ping(r.Context()); err != nil {
			writeErr(w, http.StatusServiceUnavailable, "database unavailable")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("PUT /v1/records/{ownerType}/{ownerId}", s.auth(false, s.put))
	mux.HandleFunc("GET /v1/records/{ownerType}/{ownerId}", s.auth(false, s.get))
	mux.HandleFunc("DELETE /v1/records/{ownerType}/{ownerId}", s.auth(false, s.delete))
	mux.HandleFunc("POST /v1/records/{ownerType}/batch-get", s.auth(false, s.batch))
	mux.HandleFunc("POST /v1/lookup/cpf", s.auth(false, s.lookup))
	mux.HandleFunc("POST /v1/keys/rotate", s.auth(true, s.rotate))
	return mux
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}

func (s *Server) put(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Data service.Data `json:"data"`
	}
	if !decode(w, r, &body) {
		return
	}
	rec, err := s.Vault.Put(r.Context(), r.PathValue("ownerType"), r.PathValue("ownerId"), body.Data)
	if fail(w, r, err) {
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

func (s *Server) get(w http.ResponseWriter, r *http.Request) {
	rec, err := s.Vault.Get(r.Context(), r.PathValue("ownerType"), r.PathValue("ownerId"), r.URL.Query().Get("reveal") == "true")
	if fail(w, r, err) {
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

func (s *Server) delete(w http.ResponseWriter, r *http.Request) {
	if fail(w, r, s.Vault.Delete(r.Context(), r.PathValue("ownerType"), r.PathValue("ownerId"))) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) batch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		OwnerIDs []string `json:"owner_ids"`
	}
	if !decode(w, r, &body) {
		return
	}
	recs, err := s.Vault.GetMasked(r.Context(), r.PathValue("ownerType"), body.OwnerIDs)
	if fail(w, r, err) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"records": recs})
}

func (s *Server) lookup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		OwnerType string `json:"owner_type"`
		CPF       string `json:"cpf"`
	}
	if !decode(w, r, &body) {
		return
	}
	id, err := s.Vault.LookupCPF(r.Context(), body.OwnerType, body.CPF)
	if fail(w, r, err) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"owner_id": id})
}

func (s *Server) rotate(w http.ResponseWriter, r *http.Request) {
	v, moved, err := s.Vault.Rotate(r.Context())
	if fail(w, r, err) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"kek_version": v, "rewrapped": moved})
}

func fail(w http.ResponseWriter, r *http.Request, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, service.ErrInvalid):
		writeErr(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, service.ErrNotFound):
		writeErr(w, http.StatusNotFound, "not found")
	case errors.Is(err, service.ErrDuplicate):
		writeErr(w, http.StatusConflict, "value already registered to another owner")
	default:
		slog.ErrorContext(r.Context(), "vault request failed", "path", r.URL.Path, "err", err)
		writeErr(w, http.StatusInternalServerError, "internal error")
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
