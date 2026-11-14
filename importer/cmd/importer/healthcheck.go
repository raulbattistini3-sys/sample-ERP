package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"os"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"

	importadorv1 "github.com/raulbattistini3-sys/sample-ERP/gen/go/importador/v1"
	"github.com/raulbattistini3-sys/sample-ERP/importer/internal/config"
)

// healthcheck backs `importer healthcheck`, the container's HEALTHCHECK: the image is distroless (no
// shell, no grpc_health_probe), so the binary asks its own grpc.health.v1 whether ImportadorService is
// SERVING. It only reads GRPC_PORT and GRPC_TLS_*, so a missing DATABASE_URL can't make the probe itself
// fail. With mutual TLS on, the probe presents the importer's own certificate (it carries clientAuth too,
// and is signed by the same CA as the API's).
func healthcheck() int {
	port := os.Getenv("GRPC_PORT")
	if port == "" {
		port = "50051"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	creds, err := healthcheckCreds()
	if err != nil {
		fmt.Fprintln(os.Stderr, "healthcheck:", err)
		return 1
	}
	conn, err := grpc.NewClient(net.JoinHostPort("127.0.0.1", port), grpc.WithTransportCredentials(creds))
	if err != nil {
		fmt.Fprintln(os.Stderr, "healthcheck:", err)
		return 1
	}
	defer conn.Close()

	resp, err := healthpb.NewHealthClient(conn).Check(ctx, &healthpb.HealthCheckRequest{
		Service: importadorv1.ImportadorService_ServiceDesc.ServiceName,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "healthcheck:", err)
		return 1
	}
	if resp.GetStatus() != healthpb.HealthCheckResponse_SERVING {
		fmt.Fprintln(os.Stderr, "healthcheck:", resp.GetStatus())
		return 1
	}
	return 0
}

func healthcheckCreds() (credentials.TransportCredentials, error) {
	certFile, keyFile, caFile := os.Getenv("GRPC_TLS_CERT"), os.Getenv("GRPC_TLS_KEY"), os.Getenv("GRPC_TLS_CLIENT_CA")
	if certFile == "" && keyFile == "" && caFile == "" {
		return insecure.NewCredentials(), nil
	}
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, err
	}
	pool, err := config.LoadCertPool(caFile)
	if err != nil {
		return nil, err
	}
	return credentials.NewTLS(&tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{cert},
		RootCAs:      pool,
	}), nil
}
