package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"

	"github.com/raulbattistini3-sys/sample-ERP/importer/internal/config"
	"github.com/raulbattistini3-sys/sample-ERP/importer/postgres"
)

// how long in-flight RPCs get to finish on shutdown before they are cut off
const shutdownTimeout = 10 * time.Second

func main() {
	if err := run(); err != nil {
		slog.Error("importer stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// canceled on Ctrl+C / docker stop; everything long-lived (import workers, the db pool) hangs off it
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := postgres.NewPool(ctx, cfg.DB.URL)
	if err != nil {
		return err
	}
	// deferred before the server starts, so it runs after GracefulStop: in-flight RPCs keep their connections
	defer pool.Close()

	lis, err := net.Listen("tcp", cfg.GRPC.Addr())
	if err != nil {
		return err
	}

	srv := grpc.NewServer()
	// importadorv1.RegisterImportadorServiceServer(srv, grpcserver.New(ctx, ...))

	// grpc.health.v1: the empty service name reports the server as a whole; once ImportadorService is
	// registered, also SetServingStatus(importadorv1.ImportadorService_ServiceDesc.ServiceName, SERVING)
	healthSrv := health.NewServer()
	healthpb.RegisterHealthServer(srv, healthSrv)

	// lets grpcurl / Postman list and call the services without the .proto files
	reflection.Register(srv)

	serveErr := make(chan error, 1)
	go func() {
		slog.Info("importer listening", "addr", lis.Addr().String())
		serveErr <- srv.Serve(lis)
	}()

	select {
	case err := <-serveErr:
		if !errors.Is(err, grpc.ErrServerStopped) {
			return err
		}
		return nil
	case <-ctx.Done():
	}

	slog.Info("shutting down")
	// report NOT_SERVING first, so health checks and load balancers stop sending new calls
	healthSrv.Shutdown()
	done := make(chan struct{})
	go func() {
		srv.GracefulStop()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(shutdownTimeout):
		srv.Stop()
	}
	return nil
}
