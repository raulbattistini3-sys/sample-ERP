package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"strconv"
	"syscall"
)

// MaxPortAttempts is how many ports past the configured one a development importer tries.
const MaxPortAttempts = 20

// Listen binds the gRPC address. In development, when the port is taken (another importer, a stale
// process, a Windows reserved range) it tries the next ones, up to MaxPortAttempts, logging each move; in
// production the bind error is returned as is, since the API is configured with the exact address.
func (c GRPCConfig) Listen(env Env) (net.Listener, error) {
	lis, err := net.Listen("tcp", c.Addr())
	if err == nil || env != Development || !portoOcupado(err) {
		return lis, err
	}
	for porta := c.Port + 1; porta <= 65535 && porta-c.Port < MaxPortAttempts; porta++ {
		slog.Warn("[dev] gRPC port unavailable, trying the next one", "port", porta-1, "next", porta, "err", err)
		lis, err = net.Listen("tcp", net.JoinHostPort(c.Host, strconv.Itoa(porta)))
		if err == nil {
			slog.Warn("[dev] importer moved to another port: point the API's IMPORTER_GRPC_URL at it",
				"configured", c.Port, "port", porta)
			return lis, nil
		}
		if !portoOcupado(err) {
			return nil, err
		}
	}
	return nil, fmt.Errorf("no free port in %d..%d: %w", c.Port, c.Port+MaxPortAttempts-1, err)
}

// Winsock's codes, which Go's windows syscall.EADDRINUSE/EACCES don't match (harmless elsewhere)
const (
	wsaeacces     = syscall.Errno(10013)
	wsaeaddrinuse = syscall.Errno(10048)
)

// portoOcupado: in use, or forbidden (Windows' excluded port ranges answer WSAEACCES)
func portoOcupado(err error) bool {
	return errors.Is(err, syscall.EADDRINUSE) || errors.Is(err, syscall.EACCES) ||
		errors.Is(err, wsaeaddrinuse) || errors.Is(err, wsaeacces)
}
