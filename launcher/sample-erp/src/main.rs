//! sample-erp: the whole stack without Docker.
//!
//!   sample-erp                 start Postgres, the network service, the importer, the vault, the API, billing (if configured)
//!   sample-erp promote EMAIL   give an account the SU permission
//!
//! It mirrors docker-compose.yml: same start order, same environment, same database bootstrap.

mod certs;
mod config;
mod db;
mod services;
mod web;
#[cfg(windows)]
mod windows;

use anyhow::{Context, Result, bail};
use config::{Config, Paths};
use services::{Spec, State};
use std::{
    io::Write,
    net::{Ipv4Addr, TcpListener as StdListener},
    process::ExitCode,
    time::Duration,
};
use tokio::{net::TcpStream, sync::watch, task::JoinSet};

/// One line of output, prefixed with where it came from.
pub fn log(source: &str, line: &str) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{source:>9} | {line}");
}

#[tokio::main]
async fn main() -> ExitCode {
    // One TLS crypto provider for the whole process, before any HTTP client exists. postgresql_archive
    // turns on reqwest's rustls-no-provider: without this,
    // building it panics on every launch that doesn't download Postgres first (the download installs one).
    // ring rather than aws-lc-rs, which needs cmake and NASM to build on Windows.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let result = cli().await;
    if let Err(e) = &result {
        eprintln!("\nerror: {e:#}");
    }
    #[cfg(windows)]
    if result.is_err() {
        windows::pause_if_double_clicked();
    }
    if result.is_ok() { ExitCode::SUCCESS } else { ExitCode::FAILURE }
}

async fn cli() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let paths = Paths::discover()?;
    match args.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        [] | ["run"] => run(&paths, Config::load(&paths)?).await,
        ["promote", email] => db::promote(&paths, &Config::load(&paths)?, email).await,
        ["help" | "--help" | "-h"] => {
            println!("{}", include_str!("usage.txt"));
            Ok(())
        }
        _ => bail!("unknown arguments {args:?}\n\n{}", include_str!("usage.txt")),
    }
}

async fn run(paths: &Paths, cfg: Config) -> Result<()> {
    #[cfg(windows)]
    windows::kill_children_with_launcher();

    for (bin, what) in [
        (paths.api(), "the API"),
        (paths.importer(), "the importer"),
        (paths.network(), "the network service"),
        (paths.vault(), "the vault"),
    ] {
        if !bin.exists() {
            bail!("{} is missing ({what}): build the bin folder with `cargo xtask dist`", bin.display());
        }
    }
    if !web::is_built() {
        bail!("this launcher was compiled without web/dist: build it with `cargo xtask dist`");
    }
    let billing = paths.billing_env().exists();
    if billing && !paths.billing_jar().exists() {
        bail!(
            "config/billing.env exists but services/billing does not: rebuild with `cargo xtask dist` (without --no-billing)"
        );
    }

    let mut ports = vec![
        ("ERP_DB_PORT", cfg.db_port),
        ("ERP_IMPORTER_PORT", cfg.importer_port),
        ("ERP_API_PORT", cfg.api_port),
        ("ERP_NETWORK_PORT", cfg.network_port),
        ("ERP_VAULT_PORT", cfg.vault_port),
    ];
    if billing {
        ports.push(("ERP_BILLING_PORT", cfg.billing_port));
    }
    for (key, port) in ports {
        if StdListener::bind((Ipv4Addr::LOCALHOST, port)).is_err() {
            bail!("port {port} is taken (is another copy, or docker compose, running?); set {key} in config/launcher.env");
        }
    }
    // the gateway (network.exe): the only public port
    drop(StdListener::bind((cfg.gateway.bind, cfg.web_port)).with_context(|| {
        format!("port {} is taken on {}; set ERP_WEB_PORT in config/launcher.env", cfg.web_port, cfg.gateway.bind)
    })?);

    std::fs::create_dir_all(&paths.data)?;
    web::extract(&paths.data.join("web"))?;
    let pg = db::start(paths, &cfg).await?;
    let result = run_stack(paths, &cfg, billing, &pg).await;
    log("postgres", "stopping");
    if let Err(e) = pg.stop().await {
        // Ctrl+C reaches Postgres too, so it may already be down
        log("postgres", &format!("stop: {e}"));
    }
    result
}

async fn run_stack(
    paths: &Paths,
    cfg: &Config,
    billing: bool,
    pg: &postgresql_embedded::PostgreSQL,
) -> Result<()> {
    db::prepare(pg, cfg).await?;

    let (state_tx, state_rx) = watch::channel(State::Running);
    let mut tasks = JoinSet::new();
    let secrets = &cfg.secrets;
    let cwd = paths.data.clone();
    let owned = |pairs: &[(&str, String)]| -> Vec<(String, String)> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
    };

    // the internal certificates (data/certs, made on first launch): mutual TLS between the API and the
    // importer, the vault and billing, and the API's HTTPS behind the gateway
    let tls = certs::load_or_create(&paths.data)?;
    let path = |p: &std::path::Path| p.to_string_lossy().into_owned();

    // network: the registry every service below announces itself on (by name, at the port it bound), and
    // the public gateway that routes /api, /billing and the web app to whatever is registered
    let network_url = format!("http://127.0.0.1:{}", cfg.network_port);
    let g = &cfg.gateway;
    let mut network_env = owned(&[
        ("NETWORK_ADDR", std::net::SocketAddr::new(g.bind, cfg.web_port).to_string()),
        ("NETWORK_CONTROL_ADDR", format!("127.0.0.1:{}", cfg.network_port)),
        ("NETWORK_TOKEN", secrets.network_token.clone()),
        // production: the public port never moves, it's the one printed below and given to Stripe
        ("NETWORK_ENV", "production".into()),
        ("NETWORK_WEB_DIR", paths.data.join("web").to_string_lossy().into_owned()),
        ("NETWORK_RATE", g.rate.to_string()),
        ("NETWORK_BURST", g.burst.to_string()),
        ("NETWORK_TRUST_PROXY", g.trust_proxy.to_string()),
        ("NETWORK_MAX_BODY_MB", g.max_body_mb.to_string()),
        ("NETWORK_MAX_IMPORT_MB", g.max_import_mb.to_string()),
        ("LOG_FORMAT", "text".into()),
        // the API and billing announce https:// addresses signed by the internal CA
        ("NETWORK_UPSTREAM_CA", path(&tls.ca)),
    ]);
    if let Some((cert, key)) = &g.tls {
        network_env.extend(owned(&[
            ("NETWORK_TLS_CERT", cert.to_string_lossy().into_owned()),
            ("NETWORK_TLS_KEY", key.to_string_lossy().into_owned()),
        ]));
    }
    // reCAPTCHA keys, when config/api.env has them, go to the gateway (it checks them, not the API)
    for (k, v) in config::read_env_file(&paths.config.join("api.env"))? {
        if k.starts_with("RECAPTCHA_") {
            network_env.push((k, v));
        }
    }
    tasks.spawn(services::supervise(
        Spec { name: "network", program: paths.network(), args: vec![], env: network_env, cwd: cwd.clone() },
        state_rx.clone(),
    ));
    let joins = |name: &str| -> Vec<(String, String)> {
        owned(&[
            ("NETWORK_URL", network_url.clone()),
            ("NETWORK_TOKEN", secrets.network_token.clone()),
            ("NETWORK_ADVERTISE_HOST", "127.0.0.1".into()),
            ("NETWORK_INSTANCE_ID", format!("{name}-launcher")),
        ])
    };


    // importer: reads, validates and saves product spreadsheets queued in the importacoes table
    tasks.spawn(services::supervise(
        Spec {
            name: "importer",
            program: paths.importer(),
            args: vec![],
            env: owned(&[
                ("DATABASE_URL", cfg.database_url()),
                // loopback, and only a client with a certificate from data/certs/ca.crt gets past the
                // handshake: the API
                ("GRPC_HOST", "127.0.0.1".into()),
                ("GRPC_PORT", cfg.importer_port.to_string()),
                ("GRPC_TLS_CERT", path(&tls.importer_cert)),
                ("GRPC_TLS_KEY", path(&tls.importer_key)),
                ("GRPC_TLS_CLIENT_CA", path(&tls.ca)),
                ("IMPORT_WORKERS", cfg.import_workers.clone()),
                // the embedded Postgres has no TLS
                ("IMPORTER_ENV", "development".into()),
            ])
            .into_iter()
            .chain(joins("importer"))
            .collect(),
            cwd: cwd.clone(),
        },
        state_rx.clone(),
    ));

    // vault: the usuarios' CPF and birth dates, AES-256-GCM under keys in data/vault-keys. On Windows the
    // keys are DPAPI blobs bound to this Windows account: the folder copied to another machine or user
    // won't open, so back up data/ and restore it as the same user. Loopback + mutual TLS; the API's token
    // is checked against its SHA-256
    let vault_url = format!("https://127.0.0.1:{}", cfg.vault_port);
    let token_sha256 = {
        use sha2::{Digest, Sha256};
        Sha256::digest(secrets.vault_token.as_bytes()).iter().map(|b| format!("{b:02x}")).collect::<String>()
    };
    tasks.spawn(services::supervise(
        Spec {
            name: "vault",
            program: paths.vault(),
            args: vec!["serve".into()],
            env: owned(&[
                ("VAULT_HOST", "127.0.0.1".into()),
                ("VAULT_PORT", cfg.vault_port.to_string()),
                ("VAULT_DATABASE_URL", cfg.vault_database_url()),
                ("VAULT_KEY_DIR", path(&paths.data.join("vault-keys"))),
                // the first launch makes the KEK and the CPF index key
                ("VAULT_KEY_CREATE", "true".into()),
                ("VAULT_KEY_PROTECTION", if cfg!(windows) { "dpapi" } else { "file" }.into()),
                ("VAULT_TOKEN_SHA256", token_sha256),
                ("VAULT_TLS_CERT", path(&tls.vault_cert)),
                ("VAULT_TLS_KEY", path(&tls.vault_key)),
                ("VAULT_TLS_CLIENT_CA", path(&tls.ca)),
                // the embedded Postgres has no TLS
                ("VAULT_ENV", "development".into()),
            ]),
            cwd: cwd.clone(),
        },
        state_rx.clone(),
    ));

    // api: defaults, then config/api.env, then what the launcher owns (as in docker-compose.yml, the
    // database, host/port, URLs and CORS always win over the file)
    let mut api_env = owned(&[
        ("NODE_ENV", "production".into()),
        // Stripe status and cobranças go through billing; without it the pages say it isn't running
        ("BILLING_URL", if billing { format!("https://127.0.0.1:{}", cfg.billing_port) } else { String::new() }),
        ("JWT_SECRET", secrets.jwt_secret.clone()),
        // the web's search timings and the API's snapshot builds, one NDJSON file per day (pkg/telemetry)
        ("TELEMETRY_DIR", paths.data.join("telemetry").to_string_lossy().into_owned()),
        // the first superuser, created only while the database has no active SU
        ("BOOTSTRAP_SU_NAME", cfg.admin.name.clone()),
        ("BOOTSTRAP_SU_EMAIL", cfg.admin.email.clone()),
        ("BOOTSTRAP_SU_PASSWORD", cfg.admin.password.clone()),
    ]);
    api_env.extend(config::read_env_file(&paths.config.join("api.env"))?);
    api_env.extend(owned(&[
        // the embedded Postgres has no TLS; a copied api/.env may say production
        ("API_ENV", "development".into()),
        ("DATABASE_URL", cfg.database_url()),
        ("APP_HOST", "127.0.0.1".into()),
        ("PORT", cfg.api_port.to_string()),
        // the browser calls /api on the gateway's own origin, so CORS only matters for these
        ("CORS_ORIGINS", format!("{0},{1}", cfg.web_url(), cfg.web_url().replace("localhost", "127.0.0.1"))),
        ("WEB_URL", cfg.web_url()),
        // OAuth callbacks come back through the gateway: <web>/api/integracoes/<provider>/callback
        ("API_PUBLIC_URL", format!("{}/api", cfg.web_url())),
        // with this set the API hands imports to the Go importer instead of forking worker processes,
        // which a single compiled executable can't do
        ("IMPORTER_GRPC_URL", format!("127.0.0.1:{}", cfg.importer_port)),
        ("IMPORTER_TLS_CA", path(&tls.ca)),
        ("IMPORTER_TLS_CERT", path(&tls.api_cert)),
        ("IMPORTER_TLS_KEY", path(&tls.api_key)),
        ("IMPORTER_TLS_SERVER_NAME", "importer".into()),
        ("VAULT_URL", vault_url.clone()),
        ("VAULT_TOKEN", secrets.vault_token.clone()),
        ("VAULT_TLS_CA", path(&tls.ca)),
        ("VAULT_TLS_CERT", path(&tls.api_cert)),
        ("VAULT_TLS_KEY", path(&tls.api_key)),
        ("VAULT_TLS_SERVER_NAME", "vault".into()),
        // HTTPS, TLS 1.3 only (the gateway reaches it with NETWORK_UPSTREAM_CA); also the client
        // certificate towards billing, whose own certificate API_TLS_CA checks
        ("API_TLS_CERT", path(&tls.api_cert)),
        ("API_TLS_KEY", path(&tls.api_key)),
        ("API_TLS_CA", path(&tls.ca)),
        ("BILLING_TLS_SERVER_NAME", "billing".into()),
    ]));
    api_env.extend(joins("api"));
    tasks.spawn(services::supervise(
        Spec { name: "api", program: paths.api(), args: vec![], env: api_env, cwd: cwd.clone() },
        state_rx.clone(),
    ));

    // billing: Stripe webhooks; its Flyway migrations run in the billing schema of the same database
    if billing {
        let mut env: Vec<(String, String)> = config::read_env_file(&paths.billing_env())?.into_iter().collect();
        env.extend(owned(&[
            (
                "JDBC_DATABASE_URL",
                format!(
                    "jdbc:postgresql://127.0.0.1:{}/sample_erp?user=postgres&password={}",
                    cfg.db_port, secrets.db_password
                ),
            ),
            ("ERP_API_URL", format!("https://127.0.0.1:{}", cfg.api_port)),
            // mutual TLS with the API, both ways; no shared token
            ("BILLING_TLS_CERT", path(&tls.billing_cert)),
            ("BILLING_TLS_KEY", path(&tls.billing_key)),
            ("BILLING_TLS_CA", path(&tls.ca)),
            ("BILLING_PORT", cfg.billing_port.to_string()),
            ("BILLING_ENV", "development".into()),
            ("SERVER_ADDRESS", "127.0.0.1".into()),
            // served under /billing by the gateway: honour its X-Forwarded-Prefix in links and redirects
            ("SERVER_FORWARD_HEADERS_STRATEGY", "framework".into()),
        ]));
        env.extend(joins("billing"));
        tasks.spawn(services::supervise(
            Spec {
                name: "billing",
                program: paths.billing_java(),
                args: vec!["-jar".into(), paths.billing_jar().to_string_lossy().into_owned()],
                env,
                cwd: cwd.clone(),
            },
            state_rx.clone(),
        ));
    }

    let banner = {
        let api = cfg.api_port;
        let web_url = cfg.web_url();
        let open = cfg.open_browser;
        let admin_line = format!(
            "
  first sign-in  {} / {}  (asked to choose a new password; ignore once done)",
            cfg.admin.email, cfg.admin.password
        );
        let billing_line = if billing {
            format!(
                "\n  billing  {0}/billing/docs   (Stripe: forward webhooks to {0}/billing/webhooks/stripe)",
                cfg.web_url()
            )
        } else {
            String::new()
        };
        let docs = format!("{}/api/docs", cfg.web_url());
        tokio::spawn(async move {
            if !wait_for_port(api, Duration::from_secs(90)).await {
                log("launcher", "the API is not answering yet; check its output above");
                return;
            }
            println!(
                "\n  sample-erp is up on one port\n  web      {web_url}\n  api      {docs}{billing_line}{admin_line}\n  Ctrl+C stops everything.\n"
            );
            if open {
                open_browser(&web_url);
            }
        })
    };

    let outcome = match tokio::signal::ctrl_c().await {
        Ok(()) => {
            log("launcher", "stopping (Ctrl+C)");
            State::Interrupted
        }
        Err(e) => {
            log("launcher", &format!("cannot wait for Ctrl+C ({e}); stopping"));
            State::Aborted
        }
    };
    banner.abort();
    let _ = state_tx.send(outcome);
    while tasks.join_next().await.is_some() {}
    Ok(())
}

async fn wait_for_port(port: u16, limit: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + limit;
    while tokio::time::Instant::now() < deadline {
        if TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await.is_ok() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    false
}

fn open_browser(url: &str) {
    #[cfg(windows)]
    let result = {
        use std::os::windows::process::CommandExt;
        // out of the launcher's job object, or a browser it starts would close along with it
        std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .creation_flags(windows::CREATE_BREAKAWAY_FROM_JOB)
            .spawn()
    };
    #[cfg(not(windows))]
    let result = if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(url).spawn()
    } else {
        std::process::Command::new("xdg-open").arg(url).spawn()
    };
    if let Err(e) = result {
        log("launcher", &format!("could not open a browser ({e}); go to {url}"));
    }
}
