// Command importer imports product spreadsheets in the background. It serves the gRPC API the ERP API
// queues imports through, and runs the workers that process them.
//
// With the healthcheck argument it asks a running instance whether it's SERVING and exits, which is what
// the container's HEALTHCHECK runs. See importer/README.md.
package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"

	importadorv1 "github.com/raulbattistini3-sys/sample-ERP/gen/go/importador/v1"
	netclient "github.com/raulbattistini3-sys/sample-ERP/network/client"
	"github.com/raulbattistini3-sys/sample-ERP/network/registry"
	"github.com/raulbattistini3-sys/sample-ERP/importer/grpcserver"
	"github.com/raulbattistini3-sys/sample-ERP/importer/hubspot"
	"github.com/raulbattistini3-sys/sample-ERP/importer/importacao"
	"github.com/raulbattistini3-sys/sample-ERP/importer/internal/config"
	"github.com/raulbattistini3-sys/sample-ERP/importer/postgres"
)

// how long in-flight RPCs get to finish on shutdown before they are cut off
const shutdownTimeout = 10 * time.Second

// set at build time with -ldflags "-X main.version=..."
var version = "dev"

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck())
	}
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
	if err := postgres.VerificarSchema(ctx, pool); err != nil {
		return err
	}

	lis, err := cfg.GRPC.Listen(cfg.Env) // in development, the next free port when this one is taken
	if err != nil {
		return err
	}

	repo := postgres.NewImportacoes(pool)
	worker := importacao.NewWorker(pool, repo, importacao.NewProcessador(pool, repo, cfg.Importer.MaxRows), importacao.WorkerConfig{
		Concorrencia:  cfg.Importer.Workers,
		Prazo:         cfg.Importer.Lease,
		MaxTentativas: int32(cfg.Importer.MaxAttempts),
		Intervalo:     cfg.Importer.PollInterval,
	})
	if cfg.HubSpot.ServiceKey != "" || len(cfg.HubSpot.ChaveCifra) == 32 {
		hs := hubspot.New(hubspot.Config{
			ServiceKey: cfg.HubSpot.ServiceKey, ClientID: cfg.HubSpot.ClientID, ClientSecret: cfg.HubSpot.ClientSecret,
			ChaveCifra: cfg.HubSpot.ChaveCifra,
		}, pool)
		worker.ComClientes(importacao.NewProcessadorClientes(pool, repo, hs, cfg.Importer.MaxClientesRows, cfg.Importer.HubspotWorkers))
		// companies share the clients' limit: the same batches, the same HubSpot
		worker.ComEmpresas(importacao.NewProcessadorEmpresas(pool, repo, hs, cfg.Importer.MaxClientesRows, cfg.Importer.HubspotWorkers))
	} else {
		slog.Warn("client and company imports disabled: set HUBSPOT_SERVICE_KEY or INTEGRATIONS_ENCRYPTION_KEY (same as the API)")
	}
	// the worker runs off the root ctx, never a request's: an import outlives the RPC that queued it.
	// Deferred after pool.Close, so it runs first: in-flight imports hand their jobs back before the pool goes.
	workerCtx, stopWorker := context.WithCancel(ctx)
	workerDone := make(chan struct{})
	go func() {
		defer close(workerDone)
		worker.Run(workerCtx)
	}()
	defer func() {
		stopWorker()
		<-workerDone
	}()

	// a spreadsheet arrives in one message: the default 4 MB holds ~40,000 clients, so raise it
	limite := cfg.Importer.MaxFileMB << 20
	opts := []grpc.ServerOption{grpc.MaxRecvMsgSize(limite + 1<<20), grpc.MaxSendMsgSize(16 << 20)}
	// mutual TLS: only a client holding a certificate from GRPC_TLS_CLIENT_CA (the API) gets past the handshake
	if cfg.GRPC.TLS.Enabled() {
		tlsCfg, err := cfg.GRPC.TLS.Server()
		if err != nil {
			return err
		}
		opts = append(opts, grpc.Creds(credentials.NewTLS(tlsCfg)))
	} else {
		slog.Warn("gRPC without TLS: any process that reaches the port can queue imports; set GRPC_TLS_CERT, GRPC_TLS_KEY and GRPC_TLS_CLIENT_CA")
	}
	srv := grpc.NewServer(opts...)
	importadorv1.RegisterImportadorServiceServer(srv, grpcserver.New(repo))

	// grpc.health.v1: the empty name is the server as a whole, the service name is ImportadorService itself
	healthSrv := health.NewServer()
	healthpb.RegisterHealthServer(srv, healthSrv)
	healthSrv.SetServingStatus(importadorv1.ImportadorService_ServiceDesc.ServiceName, healthpb.HealthCheckResponse_SERVING)

	// lets grpcurl / Postman list and call the services without the .proto files
	reflection.Register(srv)

	serveErr := make(chan error, 1)
	go func() {
		slog.Info("importer listening", "addr", lis.Addr().String(), "mtls", cfg.GRPC.TLS.Enabled())
		serveErr <- srv.Serve(lis)
	}()

	// announce ourselves on the network service (when NETWORK_URL is set): the API then finds the importer
	// by name instead of IMPORTER_GRPC_URL, wherever the port ended up
	if nc, ok := netclient.FromEnv(); ok {
		netCtx, stopNet := context.WithCancel(ctx)
		netDone := make(chan struct{})
		go func() {
			defer close(netDone)
			nc.Keep(netCtx, "importer", netclient.InstanceID("importer"), registry.Registration{
				Address: netclient.Advertise("grpc", lis.Addr()),
				Version: version,
				Meta:    map[string]string{"protocol": "grpc", "service": importadorv1.ImportadorService_ServiceDesc.ServiceName},
			}, 5*time.Second, slog.Default())
		}()
		// deferred last, so it runs first on the way out: leave the network before the server stops
		defer func() {
			stopNet()
			<-netDone
		}()
	}

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
