package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// reCAPTCHA v3 (invisible, scored) as the human check in front of the routes bots go for, and in front of
// every route for a client that has just been flooding.
//
// A request needs a token (header X-Recaptcha-Token) when:
//   - its route is listed in RECAPTCHA_ROUTES (default: the login), or
//   - its client was rate limited Strikes times within a minute: it is then "suspect" for SuspectFor, and
//     every request it makes to /api or /billing must prove it is a person.
//
// Without a token the answer is 428 {"captcha": true, "siteKey": ...}; the web app runs grecaptcha.execute
// and sends the same request again with the token. Google answers whether the token is real, fresh and
// unused, and a score from 0 (bot) to 1 (person); below MinScore is 403. A passed check clears the
// client's suspicion.
//
// With no RECAPTCHA_SECRET the check is off (logged at start): development works without a Google key.

const (
	captchaHeader = "X-Recaptcha-Token"
	verifyURL     = "https://www.google.com/recaptcha/api/siteverify"
)

var (
	ErrCaptchaInvalid = errors.New("verificação humana inválida ou expirada")
	ErrCaptchaScore   = errors.New("verificação humana com nota baixa")
)

type Captcha struct {
	Secret   string
	SiteKey  string
	MinScore float64
	// "POST /api/user/login" style entries; a path ending in "/" covers everything under it
	Routes []string

	Strikes    int
	SuspectFor time.Duration

	Endpoint string
	Client   *http.Client

	mu       sync.Mutex
	strikes  map[string][]time.Time
	suspects map[string]time.Time
}

func (c *Captcha) Enabled() bool { return c != nil && c.Secret != "" }

func (c *Captcha) init() {
	if c.strikes == nil {
		c.strikes, c.suspects = map[string][]time.Time{}, map[string]time.Time{}
	}
}

// Required says whether this request must carry a token.
func (c *Captcha) Required(method, path, client string, now time.Time) bool {
	if !c.Enabled() {
		return false
	}
	for _, r := range c.Routes {
		m, p, ok := strings.Cut(r, " ")
		if !ok {
			m, p = "", r
		}
		if (m == "" || strings.EqualFold(m, method)) && (path == p || (strings.HasSuffix(p, "/") && strings.HasPrefix(path, p))) {
			return true
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.init()
	until, ok := c.suspects[client]
	return ok && now.Before(until)
}

// Strike records that client was rate limited; the Strikes-th within a minute makes it suspect.
// Returns true when it just became suspect.
func (c *Captcha) Strike(client string, now time.Time) bool {
	if !c.Enabled() {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.init()
	recent := c.strikes[client][:0]
	for _, t := range c.strikes[client] {
		if now.Sub(t) < time.Minute {
			recent = append(recent, t)
		}
	}
	recent = append(recent, now)
	c.strikes[client] = recent
	if len(recent) >= max(c.Strikes, 1) {
		if until, ok := c.suspects[client]; !ok || now.After(until) {
			c.suspects[client] = now.Add(c.SuspectFor)
			return true
		}
		c.suspects[client] = now.Add(c.SuspectFor)
	}
	return false
}

// Verify asks Google about token; on success the client is no longer suspect.
func (c *Captcha) Verify(ctx context.Context, token, client string) (float64, error) {
	if len(token) < 20 || len(token) > 4096 {
		return 0, ErrCaptchaInvalid
	}
	form := url.Values{"secret": {c.Secret}, "response": {token}}
	if client != "" {
		form.Set("remoteip", client)
	}
	endpoint := c.Endpoint
	if endpoint == "" {
		endpoint = verifyURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	httpc := c.Client
	if httpc == nil {
		httpc = &http.Client{Timeout: 5 * time.Second}
	}
	res, err := httpc.Do(req)
	if err != nil {
		return 0, fmt.Errorf("recaptcha: %w", err)
	}
	defer res.Body.Close()
	var out struct {
		Success bool     `json:"success"`
		Score   *float64 `json:"score"`
		Errors  []string `json:"error-codes"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(nil, res.Body, 64<<10)).Decode(&out); err != nil {
		return 0, fmt.Errorf("recaptcha: %w", err)
	}
	if !out.Success {
		return 0, ErrCaptchaInvalid
	}
	// v2 answers have no score; a solved v2 challenge counts as a person
	score := 1.0
	if out.Score != nil {
		score = *out.Score
	}
	if score < c.MinScore {
		return score, ErrCaptchaScore
	}
	c.mu.Lock()
	c.init()
	delete(c.suspects, client)
	delete(c.strikes, client)
	c.mu.Unlock()
	return score, nil
}

func (c *Captcha) GC(now time.Time) {
	if !c.Enabled() {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.init()
	for k, until := range c.suspects {
		if now.After(until) {
			delete(c.suspects, k)
		}
	}
	for k, ts := range c.strikes {
		if len(ts) == 0 || now.Sub(ts[len(ts)-1]) > time.Minute {
			delete(c.strikes, k)
		}
	}
}
