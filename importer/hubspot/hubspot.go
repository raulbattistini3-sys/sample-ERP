// Package hubspot is the small slice of HubSpot's CRM API the clients import needs: read and upsert
// contacts by e-mail, find or create companies, and link contacts to them.
//
// It authenticates the way the API does (api/src/services/hubspot.service.ts): with HUBSPOT_SERVICE_KEY when
// set, else with the OAuth connection stored in integracoes, refreshing its token under the same row lock
// the API takes, so the two never race on a rotating refresh token.
//
// Calls are paced to stay under HubSpot's per-app limits (~10/s; search ~4/s), and a 429 waits for
// Retry-After instead of failing: a 500,000-row import is ~10,000 batches and must survive being throttled.
package hubspot

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	apiVersion  = "2026-09"
	contatos    = "/crm/objects/" + apiVersion + "/contacts"
	empresas    = "/crm/objects/" + apiVersion + "/companies"
	associacoes = "/crm/associations/" + apiVersion
	// most inputs one batch call takes
	TamanhoLote = 100

	intervaloChamada = 110 * time.Millisecond // ~9 calls/s, under the 10/s burst limit
	intervaloBusca   = 260 * time.Millisecond // search has its own, lower limit (~4/s)
	maxTentativas    = 6
)

// Config is how to reach and authenticate with HubSpot.
type Config struct {
	APIURL       string // https://api.hubapi.com
	TokenURL     string // https://api.hubspot.com/oauth/2026-09/token
	ServiceKey   string // HUBSPOT_SERVICE_KEY: used instead of the OAuth connection when set
	ClientID     string
	ClientSecret string
	// INTEGRATIONS_ENCRYPTION_KEY decoded: the AES-256-GCM key of the stored tokens
	ChaveCifra []byte
}

// Erro is HubSpot refusing a call. Fatal ones (not connected, bad key, missing scopes) stop an import: every
// other row would fail the same way. The rest are about the rows sent.
type Erro struct {
	Status   int
	Mensagem string
	Fatal    bool
}

func (e *Erro) Error() string { return e.Mensagem }

// Fatal reports whether err should stop an import instead of failing only some rows.
func Fatal(err error) bool {
	var e *Erro
	return errors.As(err, &e) && e.Fatal
}

var (
	errNaoConectado = &Erro{Mensagem: "O HubSpot não está conectado. Conecte em Integrações.", Fatal: true}
	errReconectar   = &Erro{Mensagem: "A conexão com o HubSpot expirou ou foi revogada. Conecte novamente em Integrações.", Fatal: true}
	errChave        = &Erro{Mensagem: "A chave de serviço do HubSpot é inválida ou não tem os escopos necessários.", Fatal: true}
	errEscopos      = &Erro{Mensagem: "O app do HubSpot não tem os escopos necessários (crm.objects.contacts.write, crm.objects.companies.write). Conecte novamente em Integrações.", Fatal: true}
	errCifra        = &Erro{Mensagem: "INTEGRATIONS_ENCRYPTION_KEY do importador está ausente ou é diferente da API: não dá para ler a conexão com o HubSpot.", Fatal: true}
	errIndisponivel = &Erro{Mensagem: "O HubSpot está indisponível ou limitou as requisições. Tente novamente.", Fatal: true}
)

// Client calls HubSpot. Safe for concurrent use; the pacing is shared by everything using it.
type Client struct {
	cfg  Config
	pool *pgxpool.Pool
	http *http.Client

	mu       sync.Mutex
	proxima  time.Time // when the next call may start
	busca    time.Time // when the next search may start
	token    string
	expiraEm time.Time
}

// New returns a Client.
func New(cfg Config, pool *pgxpool.Pool) *Client {
	if cfg.APIURL == "" {
		cfg.APIURL = "https://api.hubapi.com"
	}
	if cfg.TokenURL == "" {
		cfg.TokenURL = "https://api.hubspot.com/oauth/" + apiVersion + "/token"
	}
	return &Client{cfg: cfg, pool: pool, http: &http.Client{Timeout: 60 * time.Second}}
}

// Contato is a contact as the import needs it.
type Contato struct {
	ID     string
	Email  string
	Papeis string // hs_buying_role, ";"-separated
}

type objeto struct {
	ID         string            `json:"id"`
	Properties map[string]string `json:"properties"`
}

type resultados struct {
	Results []objeto `json:"results"`
}

// LerContatos returns the contacts that exist among emails, by lowercase e-mail.
func (c *Client) LerContatos(ctx context.Context, emails []string) (map[string]Contato, error) {
	inputs := make([]map[string]string, len(emails))
	for i, e := range emails {
		inputs[i] = map[string]string{"id": e}
	}
	var out resultados
	err := c.chamar(ctx, http.MethodPost, contatos+"/batch/read", map[string]any{
		"properties": []string{"email", "hs_buying_role"}, "idProperty": "email", "inputs": inputs,
	}, &out, false)
	if err != nil {
		return nil, err
	}
	achados := make(map[string]Contato, len(out.Results))
	for _, o := range out.Results {
		email := strings.ToLower(o.Properties["email"])
		achados[email] = Contato{ID: o.ID, Email: email, Papeis: o.Properties["hs_buying_role"]}
	}
	return achados, nil
}

// NovoContato is one contact to create or update by e-mail. Empty properties are not sent, so an import
// never blanks what HubSpot already has.
type NovoContato struct {
	Email        string
	Propriedades map[string]string
}

// UpsertContatos creates or updates contacts by e-mail and returns them by lowercase e-mail.
func (c *Client) UpsertContatos(ctx context.Context, novos []NovoContato) (map[string]Contato, error) {
	inputs := make([]map[string]any, len(novos))
	for i, n := range novos {
		props := map[string]string{}
		for k, v := range n.Propriedades {
			if v != "" {
				props[k] = v
			}
		}
		inputs[i] = map[string]any{"idProperty": "email", "id": n.Email, "properties": props}
	}
	var out resultados
	if err := c.chamar(ctx, http.MethodPost, contatos+"/batch/upsert", map[string]any{"inputs": inputs}, &out, false); err != nil {
		return nil, err
	}
	salvos := make(map[string]Contato, len(out.Results))
	for _, o := range out.Results {
		email := strings.ToLower(o.Properties["email"])
		salvos[email] = Contato{ID: o.ID, Email: email}
	}
	return salvos, nil
}

// BuscarEmpresa returns the oldest company with this name (HubSpot's EQ ignores case), or "" when none.
func (c *Client) BuscarEmpresa(ctx context.Context, nome string) (string, error) {
	var out resultados
	err := c.chamar(ctx, http.MethodPost, empresas+"/search", map[string]any{
		"limit":        1,
		"properties":   []string{"name"},
		"filterGroups": []any{map[string]any{"filters": []any{map[string]string{"propertyName": "name", "operator": "EQ", "value": nome}}}},
		"sorts":        []any{map[string]string{"propertyName": "createdate", "direction": "ASCENDING"}},
	}, &out, true)
	if err != nil || len(out.Results) == 0 {
		return "", err
	}
	return out.Results[0].ID, nil
}

// CriarEmpresa creates a company with only its name and returns its id.
func (c *Client) CriarEmpresa(ctx context.Context, nome string) (string, error) {
	var out objeto
	if err := c.chamar(ctx, http.MethodPost, empresas, map[string]any{"properties": map[string]string{"name": nome}}, &out, false); err != nil {
		return "", err
	}
	return out.ID, nil
}

// Ligacao is a contact to make primary at a company.
type Ligacao struct{ ContatoID, EmpresaID string }

// Ligar makes each company its contact's primary one.
func (c *Client) Ligar(ctx context.Context, ligacoes []Ligacao) error {
	inputs := make([]any, len(ligacoes))
	for i, l := range ligacoes {
		inputs[i] = map[string]any{
			"from":  map[string]string{"id": l.ContatoID},
			"to":    map[string]string{"id": l.EmpresaID},
			"types": []any{map[string]any{"associationCategory": "HUBSPOT_DEFINED", "associationTypeId": 1}},
		}
	}
	return c.chamar(ctx, http.MethodPost, associacoes+"/contacts/companies/batch/create", map[string]any{"inputs": inputs}, nil, false)
}

// chamar sends one call, pacing it, retrying throttling and server errors with backoff, and refreshing the
// OAuth token once on a 401. 207 (batch with some failed inputs) counts as success: the caller sees which
// inputs came back.
func (c *Client) chamar(ctx context.Context, metodo, caminho string, corpo, saida any, busca bool) error {
	var payload []byte
	if corpo != nil { // a GET has none
		var err error
		if payload, err = json.Marshal(corpo); err != nil {
			return err
		}
	}
	renovado := false
	espera := time.Second
	for tentativa := 1; ; tentativa++ {
		if err := c.aguardarVez(ctx, busca); err != nil {
			return err
		}
		token, err := c.autorizacao(ctx, false)
		if err != nil {
			return err
		}
		req, err := http.NewRequestWithContext(ctx, metodo, c.cfg.APIURL+caminho, bytes.NewReader(payload))
		if err != nil {
			return err
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)

		resp, err := c.http.Do(req)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if tentativa >= maxTentativas {
				return errIndisponivel
			}
			if err := dormir(ctx, espera); err != nil {
				return err
			}
			espera = min(espera*2, 30*time.Second)
			continue
		}
		dados, _ := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
		resp.Body.Close()

		switch {
		case resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated || resp.StatusCode == http.StatusMultiStatus:
			if saida == nil || len(dados) == 0 {
				return nil
			}
			return json.Unmarshal(dados, saida)
		case resp.StatusCode == http.StatusNoContent:
			return nil
		case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
			if tentativa >= maxTentativas {
				return errIndisponivel
			}
			pausa := espera
			if s, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil && s > 0 {
				pausa = time.Duration(s) * time.Second
			}
			if err := dormir(ctx, pausa); err != nil {
				return err
			}
			espera = min(espera*2, 30*time.Second)
		case resp.StatusCode == http.StatusUnauthorized && c.cfg.ServiceKey == "" && !renovado:
			renovado = true
			if _, err := c.autorizacao(ctx, true); err != nil {
				return err
			}
		default:
			return erroDaResposta(resp.StatusCode, dados, c.cfg.ServiceKey != "")
		}
	}
}

var idExistente = regexp.MustCompile(`(?i)Existing ID:\s*(\d+)`)

func erroDaResposta(status int, dados []byte, chave bool) error {
	var corpo struct {
		Message string `json:"message"`
	}
	_ = json.Unmarshal(dados, &corpo)
	switch {
	case chave && (status == 401 || status == 403):
		return errChave
	case status == 401:
		return errReconectar
	case status == 403:
		return errEscopos
	case status == 404:
		return &Erro{Status: status, Mensagem: "Registro não encontrado no HubSpot."}
	case status == 409:
		if m := idExistente.FindStringSubmatch(corpo.Message); m != nil {
			return &Erro{Status: status, Mensagem: "Já existe um contato com esse e-mail no HubSpot (id " + m[1] + ")."}
		}
		return &Erro{Status: status, Mensagem: "Esse contato já existe no HubSpot."}
	case status == 400 && corpo.Message != "":
		return &Erro{Status: status, Mensagem: "HubSpot: " + corpo.Message}
	case status == 400:
		return &Erro{Status: status, Mensagem: "O HubSpot recusou o pedido."}
	default:
		return &Erro{Status: status, Mensagem: fmt.Sprintf("O HubSpot respondeu %d.", status)}
	}
}

func (c *Client) aguardarVez(ctx context.Context, busca bool) error {
	c.mu.Lock()
	agora := time.Now()
	inicio := maisTarde(agora, c.proxima)
	if busca {
		inicio = maisTarde(inicio, c.busca)
		c.busca = inicio.Add(intervaloBusca)
	}
	c.proxima = inicio.Add(intervaloChamada)
	c.mu.Unlock()
	return dormir(ctx, time.Until(inicio))
}

func dormir(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return ctx.Err()
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func maisTarde(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

// autorizacao returns the bearer token: the service key, or the stored OAuth access token, refreshed when it
// expires within a minute (or always, with forcar, after a 401).
func (c *Client) autorizacao(ctx context.Context, forcar bool) (string, error) {
	if c.cfg.ServiceKey != "" {
		return c.cfg.ServiceKey, nil
	}
	c.mu.Lock()
	if !forcar && c.token != "" && time.Until(c.expiraEm) > time.Minute {
		t := c.token
		c.mu.Unlock()
		return t, nil
	}
	falhou := c.token
	c.mu.Unlock()
	if len(c.cfg.ChaveCifra) != 32 {
		return "", errCifra
	}

	var token string
	var expira time.Time
	err := pgx.BeginFunc(ctx, c.pool, func(tx pgx.Tx) error {
		var acessoCifrado string
		var refreshCifrado *string
		var expiraEm *time.Time
		err := tx.QueryRow(ctx, `
			SELECT access_token_cifrado, refresh_token_cifrado, expira_em FROM integracoes
			WHERE provider::text = 'hubspot' FOR UPDATE`).Scan(&acessoCifrado, &refreshCifrado, &expiraEm)
		if errors.Is(err, pgx.ErrNoRows) {
			return errNaoConectado
		}
		if err != nil {
			return err
		}
		atual, err := decifrar(c.cfg.ChaveCifra, acessoCifrado)
		if err != nil {
			return errCifra
		}
		// still good, and (when forced) not the token that just failed: someone refreshed while we waited
		valido := expiraEm == nil || time.Until(*expiraEm) > time.Minute
		if valido && (!forcar || atual != falhou) {
			token = atual
			if expiraEm != nil {
				expira = *expiraEm
			} else {
				expira = time.Now().Add(24 * time.Hour)
			}
			return nil
		}
		if refreshCifrado == nil {
			return errReconectar
		}
		refresh, err := decifrar(c.cfg.ChaveCifra, *refreshCifrado)
		if err != nil {
			return errCifra
		}
		novo, err := c.renovar(ctx, refresh)
		if err != nil {
			return err
		}
		acesso, err := cifrar(c.cfg.ChaveCifra, novo.AccessToken)
		if err != nil {
			return err
		}
		var novoRefresh *string
		if novo.RefreshToken != "" {
			s, err := cifrar(c.cfg.ChaveCifra, novo.RefreshToken)
			if err != nil {
				return err
			}
			novoRefresh = &s
		}
		var segundos *int
		if novo.ExpiresIn > 0 {
			segundos = &novo.ExpiresIn
		}
		_, err = tx.Exec(ctx, `
			UPDATE integracoes SET access_token_cifrado = $1, refresh_token_cifrado = coalesce($2, refresh_token_cifrado),
				expira_em = CASE WHEN $3::int IS NULL THEN NULL ELSE now() + make_interval(secs => $3::int) END,
				atualizado_em = now()
			WHERE provider::text = 'hubspot'`, acesso, novoRefresh, segundos)
		token = novo.AccessToken
		expira = time.Now().Add(time.Duration(max0(novo.ExpiresIn, 86400)) * time.Second)
		return err
	})
	if err != nil {
		return "", err
	}
	c.mu.Lock()
	c.token, c.expiraEm = token, expira
	c.mu.Unlock()
	return token, nil
}

func max0(v, padrao int) int {
	if v <= 0 {
		return padrao
	}
	return v
}

type tokens struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
}

func (c *Client) renovar(ctx context.Context, refresh string) (tokens, error) {
	if c.cfg.ClientID == "" || c.cfg.ClientSecret == "" {
		return tokens{}, &Erro{Mensagem: "HUBSPOT_CLIENT_ID e HUBSPOT_CLIENT_SECRET não estão configurados no importador.", Fatal: true}
	}
	form := url.Values{
		"grant_type": {"refresh_token"}, "refresh_token": {refresh},
		"client_id": {c.cfg.ClientID}, "client_secret": {c.cfg.ClientSecret},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return tokens{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return tokens{}, errIndisponivel
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return tokens{}, errReconectar
	}
	var t tokens
	if err := json.NewDecoder(resp.Body).Decode(&t); err != nil || t.AccessToken == "" {
		return tokens{}, errReconectar
	}
	return t, nil
}

// cifrar and decifrar match api/src/utils/helpers/crypto.util.ts: v1:<iv>:<tag>:<ciphertext>, base64.
func cifrar(chave []byte, texto string) (string, error) {
	gcm, err := novoGCM(chave)
	if err != nil {
		return "", err
	}
	iv := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}
	selado := gcm.Seal(nil, iv, []byte(texto), nil)
	corte := len(selado) - gcm.Overhead()
	b := base64.StdEncoding
	return strings.Join([]string{"v1", b.EncodeToString(iv), b.EncodeToString(selado[corte:]), b.EncodeToString(selado[:corte])}, ":"), nil
}

func decifrar(chave []byte, cifrado string) (string, error) {
	partes := strings.Split(cifrado, ":")
	if len(partes) != 4 || partes[0] != "v1" {
		return "", errors.New("hubspot: unknown secret format")
	}
	b := base64.StdEncoding
	iv, err1 := b.DecodeString(partes[1])
	tag, err2 := b.DecodeString(partes[2])
	ct, err3 := b.DecodeString(partes[3])
	if err := errors.Join(err1, err2, err3); err != nil {
		return "", err
	}
	gcm, err := novoGCM(chave)
	if err != nil {
		return "", err
	}
	texto, err := gcm.Open(nil, iv, append(ct, tag...), nil)
	return string(texto), err
}

func novoGCM(chave []byte) (cipher.AEAD, error) {
	bloco, err := aes.NewCipher(chave)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(bloco)
}
