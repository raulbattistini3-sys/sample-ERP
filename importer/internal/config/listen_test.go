package config

import (
	"net"
	"testing"
)

func ocupar(t *testing.T) (net.Listener, int) {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	return l, l.Addr().(*net.TCPAddr).Port
}

func TestListenMovesToNextPortInDevelopment(t *testing.T) {
	_, porta := ocupar(t)
	lis, err := GRPCConfig{Host: "127.0.0.1", Port: porta}.Listen(Development)
	if err != nil {
		t.Fatal(err)
	}
	defer lis.Close()
	if got := lis.Addr().(*net.TCPAddr).Port; got == porta {
		t.Fatalf("bound the taken port %d", got)
	}
}

func TestListenFailsInProduction(t *testing.T) {
	_, porta := ocupar(t)
	lis, err := GRPCConfig{Host: "127.0.0.1", Port: porta}.Listen(Production)
	if err == nil {
		lis.Close()
		t.Fatal("production bound another port instead of failing")
	}
}
