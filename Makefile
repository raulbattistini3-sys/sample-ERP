# The ERP's entry points, with erp-v1/secrets loaded where each part expects it.
#
#   make dev        network (Go, from source) -> web + api -> importer, vault, billing, tcc
#   make dev-notcc  the same without the TCC
#   make network    the network service alone (go run ./network/cmd/network)
#   make run        the packaged build: ../../bin/sample-erp.exe (launcher -> network.exe, api.exe, ...)
#   make exe        build that package (launcher xtask dist -> erp-v1/bin)
#   make install    bun install in api/ and web/, pnpm install in the TCC workspace
#   make logs       the TCC's 5-minute log files (logs/tcc/*.log[.gz])
#
# Only what crosses process boundaries is exported: NETWORK_TOKEN (secrets/network_token), NETWORK_UPSTREAM_CA
# (secrets/tls/ca.crt), TCC_TOKEN +
# TCC_TELEMETRY_URL (secrets/tcc-server.env, for the API) and TCC_SECRETS_DIR / TCC_DIR. DATABASE_URL & co.
# are not: the API keeps api/.env and the TCC server reads tcc-server.env itself.

# Recipes need bash. From PowerShell/cmd, make doesn't find "bash" on PATH and falls back to cmd.exe, so on
# Windows use Git Bash by its full path.
ifeq ($(OS),Windows_NT)
GIT_BASH := $(firstword $(wildcard C:/Program\ Files/Git/bin/bash.exe C:/Program\ Files/Git/usr/bin/bash.exe))
ifeq ($(GIT_BASH),)
$(error Git Bash not found (C:/Program Files/Git/bin/bash.exe); install Git for Windows)
endif
SHELL := C:/Program Files/Git/bin/bash.exe
else
SHELL := bash
endif
HERE    := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
ERP_V1  := $(abspath $(HERE)/../..)
SECRETS := $(ERP_V1)/secrets
TCC_WS  := $(ERP_V1)/tcc-v2/tcc-v1/demo-monorepo-workspace

tcc_env = $(strip $(shell sed -n 's/^$(1)=//p' "$(SECRETS)/tcc-server.env" 2>/dev/null | tr -d '\r"'))
TCC_PORT := $(or $(call tcc_env,PORT),8787)

export TCC_SECRETS_DIR   := $(SECRETS)
export TCC_DIR           := $(TCC_WS)
export TCC_TOKEN         := $(call tcc_env,TCC_TOKEN)
export TCC_TELEMETRY_URL := http://127.0.0.1:$(TCC_PORT)/telemetry/host
export NETWORK_TOKEN     := $(strip $(shell tr -d '\r\n' < "$(SECRETS)/network_token" 2>/dev/null))
# the CA that signed the services' certificates (secrets/tls). The API serves HTTPS with one of them, and
# without this the gateway can't verify it: every /api request fails the TLS handshake and answers 502
export NETWORK_UPSTREAM_CA := $(wildcard $(SECRETS)/tls/ca.crt)

.PHONY: dev dev-notcc network run exe install logs check-secrets

check-secrets:
	@test -n "$$NETWORK_TOKEN" || { echo "missing $(SECRETS)/network_token (cd $(SECRETS) && bun run network-token)"; exit 1; }
	@test -f "$(SECRETS)/tcc-server.env" || echo "note: no $(SECRETS)/tcc-server.env; the TCC will not get its settings"
	@echo "secrets: $(SECRETS)  tcc: http://127.0.0.1:$(TCC_PORT)  logs: $(HERE)/logs/tcc"

dev: check-secrets
	go run ./network/cmd/network dev

dev-notcc: check-secrets
	go run ./network/cmd/network dev --no-tcc

network: check-secrets
	go run ./network/cmd/network

run:
	"$(ERP_V1)/bin/sample-erp.exe"

exe:
	cd "$(ERP_V1)/launcher" && cargo xtask dist

install:
	cd api && bun install
	cd web && bun install
	cd "$(TCC_WS)" && pnpm install

logs:
	@ls -1t "$(HERE)/logs/tcc" 2>/dev/null | head -20 || echo "no TCC logs yet"
