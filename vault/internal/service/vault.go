// Package service is what the vault does: seal, read (masked or revealed), look up and delete the
// sensitive fields of an ERP row, identified by owner type + the row's id in the ERP database.
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/raulbattistini3-sys/sample-ERP/vault/internal/audit"
	"github.com/raulbattistini3-sys/sample-ERP/vault/internal/crypto"
	"github.com/raulbattistini3-sys/sample-ERP/vault/internal/keys"
	"github.com/raulbattistini3-sys/sample-ERP/vault/internal/storage"
)

var (
	ErrInvalid   = errors.New("invalid request")
	ErrNotFound  = storage.ErrNotFound
	ErrDuplicate = storage.ErrDuplicate
)

var (
	ownerTypeRe = regexp.MustCompile(`^[a-z][a-z_]{0,49}$`)
	ownerIDRe   = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	fieldRe     = regexp.MustCompile(`^[a-z][a-z0-9_]{0,49}$`)
	dateRe      = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

const (
	maxFields     = 32
	maxFieldBytes = 2048
	maxBatch      = 500
)

// Data is a record's content: field name -> value. Known fields are normalized and checked:
//
//	cpf              11 digits (punctuation dropped), blind-indexed and unique per owner type
//	data_nascimento  YYYY-MM-DD
type Data map[string]string

// Record is what callers get back.
type Record struct {
	OwnerType string    `json:"owner_type"`
	OwnerID   string    `json:"owner_id"`
	Data      Data      `json:"data"`
	Masked    bool      `json:"masked"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Vault struct {
	Store *storage.Store
	Keys  *keys.Ring
	Audit audit.Log
}

func invalid(format string, a ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, a...))
}

func checkOwner(ownerType, ownerID string) error {
	if !ownerTypeRe.MatchString(ownerType) {
		return invalid("owner type must be lowercase letters and _")
	}
	if !ownerIDRe.MatchString(ownerID) {
		return invalid("owner id must be the ERP row's id (letters, digits, - and _)")
	}
	return nil
}

func normalize(d Data) (Data, []storage.Index, error) {
	if len(d) == 0 {
		return nil, nil, invalid("data is empty")
	}
	if len(d) > maxFields {
		return nil, nil, invalid("at most %d fields", maxFields)
	}
	out := make(Data, len(d))
	for k, v := range d {
		if !fieldRe.MatchString(k) {
			return nil, nil, invalid("field %q: lowercase letters, digits and _", k)
		}
		if len(v) > maxFieldBytes {
			return nil, nil, invalid("field %q is too long", k)
		}
		out[k] = strings.TrimSpace(v)
	}
	if cpf, ok := out["cpf"]; ok {
		cpf = crypto.Digits(cpf)
		if len(cpf) != 11 {
			return nil, nil, invalid("cpf must have 11 digits")
		}
		out["cpf"] = cpf
	}
	if dn, ok := out["data_nascimento"]; ok {
		if _, err := time.Parse(time.DateOnly, dn); err != nil || !dateRe.MatchString(dn) {
			return nil, nil, invalid("data_nascimento must be YYYY-MM-DD")
		}
	}
	return out, nil, nil
}

func (v *Vault) indexes(ownerType string, d Data) []storage.Index {
	var idx []storage.Index
	if cpf, ok := d["cpf"]; ok {
		idx = append(idx, storage.Index{Field: "cpf", Digest: crypto.BlindIndex(v.Keys.Index(), ownerType, "cpf", cpf)})
	}
	return idx
}

// Put seals d as the owner's whole record, replacing any previous one.
func (v *Vault) Put(ctx context.Context, ownerType, ownerID string, d Data) (Record, error) {
	if err := checkOwner(ownerType, ownerID); err != nil {
		return Record{}, err
	}
	d, _, err := normalize(d)
	if err != nil {
		return Record{}, err
	}
	plain, err := json.Marshal(d)
	if err != nil {
		return Record{}, err
	}
	defer crypto.Zero(plain)
	kek, version := v.Keys.Current()
	sealed, err := crypto.SealRecord(kek, version, ownerType, ownerID, plain)
	if err != nil {
		return Record{}, err
	}
	row, err := v.Store.Put(ctx, ownerType, ownerID, sealed, v.indexes(ownerType, d))
	outcome := "ok"
	if errors.Is(err, storage.ErrDuplicate) {
		outcome = "duplicate"
	} else if err != nil {
		outcome = "error"
	}
	if aerr := v.Audit.Record(ctx, "put", ownerType, ownerID, outcome); aerr != nil && err == nil {
		err = aerr
	}
	if err != nil {
		return Record{}, err
	}
	return Record{OwnerType: ownerType, OwnerID: ownerID, Data: Mask(d), Masked: true, UpdatedAt: row.UpdatedAt}, nil
}

func (v *Vault) open(r storage.Record) (Data, error) {
	kek, err := v.Keys.KEK(r.Sealed.KEKVersion)
	if err != nil {
		return nil, err
	}
	plain, err := crypto.OpenRecord(kek, r.OwnerType, r.OwnerID, r.Sealed)
	if err != nil {
		return nil, err
	}
	defer crypto.Zero(plain)
	var d Data
	if err := json.Unmarshal(plain, &d); err != nil {
		return nil, fmt.Errorf("record %s holds invalid JSON: %w", r.ID, err)
	}
	return d, nil
}

// Get returns the owner's record, masked unless reveal (which is audited as such).
func (v *Vault) Get(ctx context.Context, ownerType, ownerID string, reveal bool) (Record, error) {
	if err := checkOwner(ownerType, ownerID); err != nil {
		return Record{}, err
	}
	action := "read_masked"
	if reveal {
		action = "reveal"
	}
	row, err := v.Store.Get(ctx, ownerType, ownerID)
	var d Data
	if err == nil {
		d, err = v.open(row)
	}
	outcome := "ok"
	switch {
	case errors.Is(err, storage.ErrNotFound):
		outcome = "not_found"
	case err != nil:
		outcome = "error"
	}
	if aerr := v.Audit.Record(ctx, action, ownerType, ownerID, outcome); aerr != nil && err == nil {
		err = aerr
	}
	if err != nil {
		return Record{}, err
	}
	if !reveal {
		d = Mask(d)
	}
	return Record{OwnerType: ownerType, OwnerID: ownerID, Data: d, Masked: !reveal, UpdatedAt: row.UpdatedAt}, nil
}

// GetMasked returns the masked records of the owners that have one (a listing page).
func (v *Vault) GetMasked(ctx context.Context, ownerType string, ownerIDs []string) ([]Record, error) {
	if len(ownerIDs) > maxBatch {
		return nil, invalid("at most %d owner ids", maxBatch)
	}
	for _, id := range ownerIDs {
		if err := checkOwner(ownerType, id); err != nil {
			return nil, err
		}
	}
	rows, err := v.Store.GetMany(ctx, ownerType, ownerIDs)
	if aerr := v.Audit.Record(ctx, "read_masked_batch", ownerType, "", map[bool]string{true: "ok", false: "error"}[err == nil]); aerr != nil && err == nil {
		err = aerr
	}
	if err != nil {
		return nil, err
	}
	out := make([]Record, 0, len(rows))
	for _, r := range rows {
		d, err := v.open(r)
		if err != nil {
			return nil, err
		}
		out = append(out, Record{OwnerType: ownerType, OwnerID: r.OwnerID, Data: Mask(d), Masked: true, UpdatedAt: r.UpdatedAt})
	}
	return out, nil
}

// Delete removes the owner's record (crypto-shredding: its data key goes with it).
func (v *Vault) Delete(ctx context.Context, ownerType, ownerID string) error {
	if err := checkOwner(ownerType, ownerID); err != nil {
		return err
	}
	found, err := v.Store.Delete(ctx, ownerType, ownerID)
	outcome := map[bool]string{true: "ok", false: "not_found"}[found]
	if err != nil {
		outcome = "error"
	}
	if aerr := v.Audit.Record(ctx, "delete", ownerType, ownerID, outcome); aerr != nil && err == nil {
		err = aerr
	}
	return err
}

// LookupCPF returns the owner id holding cpf, through the blind index.
func (v *Vault) LookupCPF(ctx context.Context, ownerType, cpf string) (string, error) {
	if !ownerTypeRe.MatchString(ownerType) {
		return "", invalid("owner type must be lowercase letters and _")
	}
	cpf = crypto.Digits(cpf)
	if len(cpf) != 11 {
		return "", invalid("cpf must have 11 digits")
	}
	id, err := v.Store.Lookup(ctx, ownerType, "cpf", crypto.BlindIndex(v.Keys.Index(), ownerType, "cpf", cpf))
	outcome := "ok"
	switch {
	case errors.Is(err, storage.ErrNotFound):
		outcome = "not_found"
	case err != nil:
		outcome = "error"
	}
	if aerr := v.Audit.Record(ctx, "lookup_cpf", ownerType, id, outcome); aerr != nil && err == nil {
		err = aerr
	}
	return id, err
}

// Rotate reloads VAULT_KEY_DIR and rewraps every data key onto the newest KEK.
func (v *Vault) Rotate(ctx context.Context) (version, moved int, err error) {
	if err := v.Keys.Reload(); err != nil {
		return 0, 0, err
	}
	kek, version := v.Keys.Current()
	moved, err = v.Store.Rewrap(ctx, version, func(r storage.Record) (crypto.Sealed, error) {
		old, err := v.Keys.KEK(r.Sealed.KEKVersion)
		if err != nil {
			return crypto.Sealed{}, err
		}
		return crypto.Rewrap(old, kek, version, r.OwnerType, r.OwnerID, r.Sealed)
	})
	outcome := "ok"
	if err != nil {
		outcome = "error"
	}
	if aerr := v.Audit.Record(ctx, "rotate", "", "", outcome); aerr != nil && err == nil {
		err = aerr
	}
	return version, moved, err
}

// Mask hides what a listing doesn't need (LGPD): 123.456.789-09 -> ***.456.789-**, 1990-05-17 ->
// 1990-**-**, anything else -> ****.
func Mask(d Data) Data {
	out := make(Data, len(d))
	for k, v := range d {
		switch {
		case k == "cpf" && len(v) == 11:
			out[k] = "***." + v[3:6] + "." + v[6:9] + "-**"
		case k == "data_nascimento" && len(v) == 10:
			out[k] = v[:4] + "-**-**"
		case v == "":
			out[k] = ""
		default:
			out[k] = "****"
		}
	}
	return out
}
