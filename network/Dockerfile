# Network service image (registry + public gateway). Built from the repo root, where go.mod and network/ live:
#   docker build -f network/Dockerfile .
# network/Dockerfile.dockerignore keeps that context to just those.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY network ./network
# static binary: the runtime image has no libc
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/network ./network/cmd/network

# no shell or package manager, runs as an unprivileged user
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/network /network
# 8080: the public gateway; 7070: the registry (keep it on the private network)
EXPOSE 8080 7070
ENTRYPOINT ["/network"]
