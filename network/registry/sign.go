package registry

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Every call to the registry, and every request the gateway forwards to a service, carries
//
//	X-Network-Signature: t=<unix seconds>,n=<random nonce>,s=<hex HMAC-SHA256>
//
// where s = HMAC(NETWORK_TOKEN, t "\n" n "\n" METHOD "\n" path "\n" hex(sha256(body))). Someone in the
// middle who reads the traffic can't forge a registration (no token), can't change the body or the path
// of one they saw (the signature covers both), and can't replay it: it is accepted only within MaxSkew of
// its time, and each nonce only once. The token itself never crosses the wire.

const Header = "X-Network-Signature"

// MaxSkew is how far a signature's time may be from this clock, both ways.
const MaxSkew = 60 * time.Second

var (
	ErrMissing   = errors.New("assinatura ausente")
	ErrMalformed = errors.New("assinatura malformada")
	ErrExpired   = errors.New("assinatura fora do prazo")
	ErrReplayed  = errors.New("assinatura repetida")
	ErrInvalid   = errors.New("assinatura inválida")
)

// Sign returns the header value for one request.
func Sign(token []byte, method, path string, body []byte, now time.Time) string {
	var n [12]byte
	_, _ = rand.Read(n[:])
	nonce := hex.EncodeToString(n[:])
	t := strconv.FormatInt(now.Unix(), 10)
	return fmt.Sprintf("t=%s,n=%s,s=%s", t, nonce, mac(token, t, nonce, method, path, body))
}

func mac(token []byte, t, nonce, method, path string, body []byte) string {
	sum := sha256.Sum256(body)
	h := hmac.New(sha256.New, token)
	fmt.Fprintf(h, "%s\n%s\n%s\n%s\n%s", t, nonce, strings.ToUpper(method), path, hex.EncodeToString(sum[:]))
	return hex.EncodeToString(h.Sum(nil))
}

// Verifier checks signatures and remembers the nonces it accepted for twice MaxSkew, so none is accepted
// again while its time is still valid.
type Verifier struct {
	token []byte
	now   func() time.Time

	mu     sync.Mutex
	nonces map[string]time.Time
	sweep  time.Time
}

func NewVerifier(token []byte) *Verifier {
	return &Verifier{token: token, now: time.Now, nonces: map[string]time.Time{}}
}

func (v *Verifier) Verify(header, method, path string, body []byte) error {
	if header == "" {
		return ErrMissing
	}
	var t, nonce, s string
	for part := range strings.SplitSeq(header, ",") {
		k, val, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			return ErrMalformed
		}
		switch k {
		case "t":
			t = val
		case "n":
			nonce = val
		case "s":
			s = val
		}
	}
	secs, err := strconv.ParseInt(t, 10, 64)
	if err != nil || len(nonce) < 16 || len(nonce) > 64 || len(s) != 64 {
		return ErrMalformed
	}
	now := v.now()
	at := time.Unix(secs, 0)
	if at.Before(now.Add(-MaxSkew)) || at.After(now.Add(MaxSkew)) {
		return ErrExpired
	}
	want := mac(v.token, t, nonce, method, path, body)
	if !hmac.Equal([]byte(want), []byte(s)) {
		return ErrInvalid
	}

	v.mu.Lock()
	defer v.mu.Unlock()
	if now.Sub(v.sweep) > MaxSkew {
		for k, exp := range v.nonces {
			if now.After(exp) {
				delete(v.nonces, k)
			}
		}
		v.sweep = now
	}
	if _, seen := v.nonces[nonce]; seen {
		return ErrReplayed
	}
	v.nonces[nonce] = now.Add(2 * MaxSkew)
	return nil
}
