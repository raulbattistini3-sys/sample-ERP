# Importer image. Built from the repo root, where go.mod, gen/ and importer/ live:
#   docker build -f importer/Dockerfile .
# importer/Dockerfile.dockerignore keeps that context to just those.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY gen ./gen
COPY importer ./importer
# static binary: the runtime image has no libc
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/importer ./importer/cmd/importer

# no shell or package manager, runs as an unprivileged user; `importer healthcheck` is the probe
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/importer /importer
EXPOSE 50051
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 CMD ["/importer", "healthcheck"]
ENTRYPOINT ["/importer"]
