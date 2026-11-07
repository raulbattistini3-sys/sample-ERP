# launcher

Runs the whole stack natively, without Docker. `cargo xtask dist` compiles every service into the repo's
`bin/` folder. Running `bin/sample-erp.exe` then does what `docker compose up` does.

| Service  | Built into                                   | How                                                                                   |
| -------- | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| importer | `services/importer.exe`                      | `go build`, static (`CGO_ENABLED=0`)                                                  |
| api      | `services/api.exe`                           | `bun build --compile`: the Bun runtime is inside the exe                              |
| billing  | `services/billing/{runtime/, billing.jar}`   | `mvnw package`, then `jlink` makes a trimmed Java 21 runtime (no JDK needed to run it) |
| web      | inside `sample-erp.exe`                      | `vite build`, embedded with rust-embed and served by axum (no nginx)                  |
| Postgres | `data/postgres/` (first launch)              | `postgresql_embedded` downloads a portable Postgres 17, then the init scripts run     |

## Build

You need Rust, Bun, Go 1.26 and, for billing, a JDK 21 with `jlink` on PATH. `--no-billing` skips billing and
the JDK. These tools are only for building: `bin/` needs none of them to run, and Maven comes with the repo
(`billing/mvnw`).

### Install the tools

Each block assumes x86-64 and a fresh machine. Skip any tool that's already installed (`cargo --version`,
`bun --version`, `go version`, `jlink --version`).

#### Windows 10/11

In PowerShell:

```powershell
winget install --id Git.Git -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id Rustlang.Rustup -e
winget install --id Oven-sh.Bun -e
winget install --id GoLang.Go -e
winget install --id EclipseAdoptium.Temurin.21.JDK -e
```

Rust links with the MSVC tools, which is why the Build Tools line is there.

A terminal keeps the PATH it started with, so the new tools aren't found until you open a new one. To refresh
the current session instead, paste this function into PowerShell and run `refreshenv`. It reloads every
machine and user variable, and rebuilds PATH from both. Add it to `$PROFILE` to always have it.

```powershell
function refreshenv {
    foreach ($level in 'Machine', 'User') {
        [Environment]::GetEnvironmentVariables($level).GetEnumerator() |
            Where-Object { $_.Key -ne 'Path' } |
            ForEach-Object { Set-Item -Path "Env:$($_.Key)" -Value $_.Value }
    }
    $env:Path = @(
        [Environment]::GetEnvironmentVariable('Path', 'Machine'),
        [Environment]::GetEnvironmentVariable('Path', 'User')
    ) -ne $null -join ';'
    Write-Host "Environment variables refreshed." -ForegroundColor Green
}

refreshenv
cargo --version; bun --version; go version; jlink --version   # each should print a version
```

This is PowerShell, not `cmd.exe`. In `cmd`, open a new window instead.

#### Ubuntu 22.04/24.04 and Linux Mint 21/22

```bash
sudo apt update
sudo apt install -y build-essential pkg-config curl git unzip openjdk-21-jdk

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
curl -fsSL https://bun.sh/install | bash

# apt's Go is too old for go.mod; use the official build
curl -fsSL https://go.dev/dl/go1.26.6.linux-amd64.tar.gz | sudo tar -C /usr/local -xz
echo 'export PATH="$PATH:/usr/local/go/bin"' >> ~/.profile
```

Then refresh the session (see [Refresh PATH on Linux](#refresh-path-on-linux)).

Mint 21 and 22 are built on Ubuntu 22.04 and 24.04, so the same packages apply.

#### Amazon Linux 2023

```bash
sudo dnf install -y gcc gcc-c++ make git tar gzip unzip java-21-amazon-corretto-devel

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
curl -fsSL https://bun.sh/install | bash

curl -fsSL https://go.dev/dl/go1.26.6.linux-amd64.tar.gz | sudo tar -C /usr/local -xz
echo 'export PATH="$PATH:/usr/local/go/bin"' >> ~/.bash_profile
```

Then refresh the session (see [Refresh PATH on Linux](#refresh-path-on-linux)).

`java-21-amazon-corretto-devel` is the full JDK, including `jlink`; the headless package lacks it. Amazon
Linux 2 (end of life, glibc 2.26) isn't covered here.

#### Refresh PATH on Linux

The installers add their folders to PATH through shell startup files, which only an open terminal reads
again when told to. Which files they write depends on the distro and the shell: rustup writes `~/.profile`
and `~/.bashrc`, Bun writes `~/.bashrc` or `~/.zshrc`, and Go was added above. So this function adds the
three tool folders directly, then rereads the current shell's startup file. It works the same in bash and
zsh, on any of the distros above. Paste it into the terminal and run `refreshenv`, or add it to `~/.bashrc`
(`~/.zshrc` for zsh) to always have it.

```bash
refreshenv() {
    for dir in "$HOME/.cargo/bin" "$HOME/.bun/bin" /usr/local/go/bin; do
        [ -d "$dir" ] || continue
        case ":$PATH:" in
            *":$dir:"*) ;;
            *) PATH="$PATH:$dir" ;;
        esac
    done
    export PATH
    if [ -n "$ZSH_VERSION" ]; then
        [ -f "$HOME/.zshrc" ] && . "$HOME/.zshrc"
    elif [ -n "$BASH_VERSION" ]; then
        [ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
    fi
    hash -r 2>/dev/null   # forget cached command locations
    echo "Environment variables refreshed."
}

refreshenv
cargo --version && bun --version && go version && jlink --version   # each should print a version
```

If a version check still fails, log out and back in. That rereads every startup file, including the
`~/.profile` or `~/.bash_profile` that only a login shell reads.

On a server, everything listens on 127.0.0.1. To try it from your own machine, use an SSH tunnel:
`ssh -L 8080:localhost:8080 -L 3333:localhost:3333 ec2-user@<host>`. Set `ERP_OPEN_BROWSER=false` in
`config/launcher.env`, since there is no browser to open.

### Build bin/

```powershell
git clone <repo> && cd sample-ERP/launcher
cargo xtask dist              # everything into ../bin
cargo xtask dist --no-billing # no JDK needed
cargo xtask dist --out D:\erp # somewhere else
```

It's the same on Linux, and gives `bin/sample-erp` instead of `bin/sample-erp.exe`. A build only runs on the
OS it was made on, so build on Linux for Linux. The first build downloads the Rust crates, Bun and Go
modules, and Maven's dependencies, and takes several minutes. Later builds are faster.

Stop a running `sample-erp` before you rebuild, or Windows won't let the build replace it. `bin/` is
gitignored, and it is self-contained: copy it to another machine with the same OS and run it there.

## Run

```powershell
..\bin\sample-erp.exe                           # web on http://localhost:8080, API on http://localhost:3333/docs
..\bin\sample-erp.exe promote you@example.com   # make an existing account SU
```

**First sign-in:** `admin@sample-erp.local` / `change-me` (John Doe, SU). The API creates this account while
the database has no active SU, and the web app sends it to `/trocar-senha` to choose its own password before
anything else. The API also refuses every other route until then. Change the defaults with `ERP_ADMIN_NAME`,
`ERP_ADMIN_EMAIL` and `ERP_ADMIN_PASSWORD` in `config/launcher.env`. Add more people in **Usuários**.

The first launch downloads Postgres (about 100 MB) into `bin/data/postgres`, creates `sample_erp` from
`docker/postgres/init/*.sql`, and then applies the `api/drizzle` migrations that the seed doesn't record.
Later launches only apply new migrations. Delete `bin/data` to start over with an empty database.

Startup order and environment follow `docker-compose.yml`:

1. Postgres starts and migrations run. This replaces the db and migrate services.
2. The importer and the API start, restarted after a back-off if they die (`restart: unless-stopped`).
3. Billing starts only when `config/billing.env` exists (compose's `billing` profile).
4. The web app is served, and the browser opens once the API answers.

Ctrl+C stops everything. Each service gets up to 20 s to finish its work, then Postgres shuts down.
On Windows the launcher runs inside a job object, so closing the window or a crash never leaves
`api.exe`, `java` or `postgres` running.

Everything listens on 127.0.0.1 only. Unlike compose, nothing is published on all interfaces.

### Configuration (`bin/config/`)

| File            | What                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `launcher.env`  | Ports (`ERP_WEB_PORT`, `ERP_API_PORT`, `ERP_DB_PORT`=5433, ...) and `ERP_OPEN_BROWSER`. `ERP_*` env vars win over it. |
| `api.env`       | The API's optional secrets (Resend, Jira, HubSpot). A copy of `api/.env` works as is.                 |
| `billing.env`   | The Stripe keys. Its presence turns billing on.                                                       |

The launcher always sets the database URL, hosts, ports, CORS and the URLs the services use to reach
each other, so a copied `.env` can never point the local stack at Supabase. `JWT_SECRET`,
`BILLING_INTERNAL_TOKEN` and the Postgres password are random and generated on first launch, in
`data/secrets.env`. The Postgres password is fixed when the cluster is created, so keep that file
with `data/postgres`.

### How the pieces fit

- **Web → API address.** `xtask` builds the web app with `VITE_API_URL=__SAMPLE_ERP_API_URL__`. The axum
  server swaps that placeholder for `http://127.0.0.1:<ERP_API_PORT>` as it serves each file, so a port
  change needs no rebuild.
- **Imports.** The API always gets `IMPORTER_GRPC_URL` and hands spreadsheets to `importer.exe`. Its
  fallback, which forks `importacoes.processo.ts` and worker threads from file paths, can't run from a
  single compiled exe, and with the importer configured it never does.
- **Migrations.** `src/db.rs` reimplements drizzle-kit's migrator. Journal entries newer than the last
  row of `drizzle.__drizzle_migrations` run in one transaction and are logged with each file's sha256.
  The launcher doesn't need drizzle-kit or `node_modules` at run time.

## Layout

```
launcher/
  Cargo.toml          workspace
  .cargo/config.toml  the `cargo xtask` alias
  sample-erp/         the runtime (src/main.rs: start and stop; db.rs; services.rs; web.rs; config.rs)
  xtask/              the build (`cargo xtask dist`)
  dist-config/        the *.env.example files and README.txt copied into bin/
```

During development, `cargo run -p sample-erp` with `ERP_HOME` pointed at a built `bin/` uses that folder's
services and data.
