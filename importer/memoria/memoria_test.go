package memoria

import "testing"

func TestElasticoGrowsAndShrinks(t *testing.T) {
	var limites []int64
	liberou := 0
	e := &Elastico{cfg: Config{Base: 100 * mb, Teto: 400 * mb, Fator: 2},
		aplicar: func(l int64) { limites = append(limites, l) }, liberar: func() { liberou++ }}

	a := e.Reservar(50 * mb) // +100 MB
	if e.Limite() != 200*mb {
		t.Fatalf("one import: %d MB", e.Limite()/mb)
	}
	b := e.Reservar(500 * mb) // +1000 MB, capped
	if e.Limite() != 400*mb {
		t.Fatalf("capped: %d MB", e.Limite()/mb)
	}
	b()
	b() // twice is harmless
	if e.Limite() != 200*mb || liberou != 0 {
		t.Fatalf("after one: %d MB, liberou=%d", e.Limite()/mb, liberou)
	}
	a()
	if e.Limite() != 100*mb || liberou != 1 {
		t.Fatalf("idle: %d MB, liberou=%d", e.Limite()/mb, liberou)
	}
	if len(limites) != 4 {
		t.Fatalf("limites aplicados = %v", limites)
	}
}

func TestReservaMinima(t *testing.T) {
	e := &Elastico{cfg: Config{Base: 10 * mb, Fator: 6}, aplicar: func(int64) {}, liberar: func() {}}
	defer e.Reservar(1)()
	if e.Limite() != 42*mb {
		t.Fatalf("minimum lease: %d MB", e.Limite()/mb)
	}
}

func TestDoAmbiente(t *testing.T) {
	t.Setenv("POLYVISOR_MEMORY_HARD_BYTES", "1000000000")
	t.Setenv("IMPORT_MEMORY_BASE_MB", "64")
	c := DoAmbiente()
	if c.Teto != 900000000 || c.Base != 64*mb || c.Fator != 6 {
		t.Fatalf("%+v", c)
	}
}
