//! sample-erp: the whole stack without Docker.
//!
//!   sample-erp                 start Postgres, the importer, the API, billing (if configured) and the web app
//!   sample-erp promote EMAIL   give an account the SU permission
//!
//! It mirrors docker-compose.yml: same start order, same environment, same database bootstrap.

mod config;
mod db;
mod gateway;
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
    // turns on reqwest's rustls-no-provider, and that applies to the gateway's client too: without this,
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

    for (bin, what) in [(paths.api(), "the API"), (paths.importer(), "the importer")] {
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
    ];
    if billing {
        ports.push(("ERP_BILLING_PORT", cfg.billing_port));
    }
    for (key, port) in ports {
        if StdListener::bind((Ipv4Addr::LOCALHOST, port)).is_err() {
            bail!("port {port} is taken (is another copy, or docker compose, running?); set {key} in config/launcher.env");
        }
    }
    // the gateway: the only public port. Bound now and handed to axum later, so it can't be taken in between
    let web_listener = StdListener::bind((cfg.gateway.bind, cfg.web_port)).with_context(|| {
        format!("port {} is taken on {}; set ERP_WEB_PORT in config/launcher.env", cfg.web_port, cfg.gateway.bind)
    })?;
    web_listener.set_nonblocking(true)?;

    std::fs::create_dir_all(&paths.data)?;
    let pg = db::start(paths, &cfg).await?;
    let result = run_stack(paths, &cfg, billing, web_listener, &pg).await;
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
    web_listener: StdListener,
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

    // importer: reads, validates and saves product spreadsheets queued in the importacoes table
    tasks.spawn(services::supervise(
        Spec {
            name: "importer",
            program: paths.importer(),
            args: vec![],
            env: owned(&[
                ("DATABASE_URL", cfg.database_url()),
                // loopback only: it has no auth of its own and trusts its caller
                ("GRPC_HOST", "127.0.0.1".into()),
                ("GRPC_PORT", cfg.importer_port.to_string()),
                ("IMPORT_WORKERS", cfg.import_workers.clone()),
                // the embedded Postgres has no TLS
                ("IMPORTER_ENV", "development".into()),
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
        ("BILLING_URL", if billing { format!("http://127.0.0.1:{}", cfg.billing_port) } else { String::new() }),
        ("JWT_SECRET", secrets.jwt_secret.clone()),
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
        ("BILLING_INTERNAL_TOKEN", secrets.billing_token.clone()),
    ]));
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
            ("ERP_API_URL", format!("http://127.0.0.1:{}", cfg.api_port)),
            ("BILLING_INTERNAL_TOKEN", secrets.billing_token.clone()),
            ("BILLING_PORT", cfg.billing_port.to_string()),
            ("BILLING_ENV", "development".into()),
            ("SERVER_ADDRESS", "127.0.0.1".into()),
            // served under /billing by the gateway: honour its X-Forwarded-Prefix in links and redirects
            ("SERVER_FORWARD_HEADERS_STRATEGY", "framework".into()),
        ]));
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

    // the gateway: web app, /api and /billing on one port; the services stay on loopback
    let mut upstreams = vec![gateway::Upstream { prefix: "/api", base: format!("http://127.0.0.1:{}", cfg.api_port) }];
    if billing {
        upstreams.push(gateway::Upstream { prefix: "/billing", base: format!("http://127.0.0.1:{}", cfg.billing_port) });
    }
    let g = &cfg.gateway;
    let settings = gateway::Settings {
        upstreams,
        rate: g.rate,
        burst: g.burst,
        trust_proxy: g.trust_proxy,
        max_body: g.max_body_mb * 1024 * 1024,
        max_import: g.max_import_mb * 1024 * 1024,
        https: g.tls.is_some(),
    };
    let mut web_state = state_rx.clone();
    let mut web = tokio::spawn(gateway::serve(web_listener, settings, g.tls.clone(), async move {
        let _ = web_state.wait_for(|s| *s != State::Running).await;
    }));

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

    let outcome = tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            log("launcher", "stopping (Ctrl+C)");
            State::Interrupted
        }
        result = &mut web => {
            log("launcher", &format!("the web server stopped: {result:?}"));
            State::Aborted
        }
    };
    banner.abort();
    let _ = state_tx.send(outcome);
    while tasks.join_next().await.is_some() {}
    if !web.is_finished() {
        let _ = web.await;
    }
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
