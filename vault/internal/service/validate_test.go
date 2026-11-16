package service

import "testing"

func TestNormalizeValidates(t *testing.T) {
	ok := []Data{
		{"cpf": "529.982.247-25"},
		{"cnpj": "11.222.333/0001-81"},
		{"email": "Ana@Example.com"},
		{"data_nascimento": "1990-01-31"},
	}
	for _, d := range ok {
		if _, _, err := normalize(d); err != nil {
			t.Errorf("%v: %v", d, err)
		}
	}
	bad := []Data{
		{"cpf": "111.111.111-11"},
		{"cpf": "529.982.247-24"},
		{"cnpj": "11.222.333/0001-82"},
		{"email": "not-an-email"},
		{"email": "Ana <ana@example.com>"},
		{"email": "ana@localhost"},
	}
	for _, d := range bad {
		if _, _, err := normalize(d); err == nil {
			t.Errorf("%v: accepted", d)
		}
	}
	out, _, _ := normalize(Data{"cpf": "529.982.247-25", "email": "Ana@Example.com"})
	if out["cpf"] != "52998224725" || out["email"] != "ana@example.com" {
		t.Errorf("normalized to %v", out)
	}
}
