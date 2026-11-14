package hubspot

import (
	"bytes"
	"testing"
)

// the API decrypts what the importer writes back after a refresh, and vice versa
func TestCifraIdaEVolta(t *testing.T) {
	chave := bytes.Repeat([]byte{7}, 32)
	cifrado, err := cifrar(chave, "token-secreto")
	if err != nil {
		t.Fatal(err)
	}
	texto, err := decifrar(chave, cifrado)
	if err != nil || texto != "token-secreto" {
		t.Fatalf("decifrar = %q, %v", texto, err)
	}
	if _, err := decifrar(bytes.Repeat([]byte{8}, 32), cifrado); err == nil {
		t.Error("decrypted with the wrong key")
	}
}

// written by api/src/utils/helpers/crypto.util.ts's format with Node's crypto, key = 32 bytes of 7
func TestDecifraFormatoDaAPI(t *testing.T) {
	texto, err := decifrar(bytes.Repeat([]byte{7}, 32), "v1:eqIErfmIwhq1Xeui:xpx4dM+9ti/l6Uaq/SKQwQ==:+w==")
	if err != nil || texto != "x" {
		t.Fatalf("decifrar = %q, %v", texto, err)
	}
}

func TestErroDaResposta(t *testing.T) {
	if !Fatal(erroDaResposta(403, nil, false)) {
		t.Error("403 should stop the import")
	}
	if Fatal(erroDaResposta(400, []byte(`{"message":"Property values were not valid"}`), false)) {
		t.Error("400 is about the rows, not fatal")
	}
}
