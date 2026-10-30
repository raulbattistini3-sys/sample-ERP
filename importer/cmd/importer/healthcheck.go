package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"

	importadorv1 "github.com/raulbattistini3-sys/sample-ERP/gen/go/importador/v1"
)

// healthcheck backs `importer healthcheck`, the container's HEALTHCHECK: the image is distroless (no
// shell, no grpc_health_probe), so the binary asks its own grpc.health.v1 whether ImportadorService is
// SERVING. It only reads GRPC_PORT, so a missing DATABASE_URL can't make the probe itself fail.
func healthcheck() int {
	port := os.Getenv("GRPC_PORT")
	if port == "" {
		port = "50051"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	conn, err := grpc.NewClient(net.JoinHostPort("localhost", port), grpc.WithTransportCredentials(insecure.NewCredentials()))
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
