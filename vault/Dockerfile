# Vault image. Built from the repo root (one Go module): docker build -f vault/Dockerfile .
# vault/Dockerfile.dockerignore keeps that context to go.mod, go.sum and vault/.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY vault ./vault
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/vault ./vault/cmd/vault

# no shell, unprivileged. Keys are never baked in: VAULT_KEY_DIR is a mounted secret folder
# (secrets/vault from secrets/generate.ts), with VAULT_KEY_PROTECTION=file.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/vault /vault
ENV VAULT_HOST=0.0.0.0 VAULT_PORT=8200 VAULT_KEY_PROTECTION=file
EXPOSE 8200
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 CMD ["/vault", "healthcheck"]
ENTRYPOINT ["/vault"]
