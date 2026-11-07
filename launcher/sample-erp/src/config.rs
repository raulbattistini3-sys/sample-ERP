//! Where things live next to the executable, and the settings the launcher hands to each service.
//!
//! bin/
//!   sample-erp.exe              this launcher, with the web app, SQL scripts and migrations embedded
//!   services/                   importer.exe, api.exe, billing/ (runtime/ + billing.jar)
//!   config/launcher.env         ports and options (optional, see launcher.env.example)
//!   config/api.env              the API's optional secrets: Resend, Jira/HubSpot OAuth, ... (optional)
//!   config/billing.env          Stripe keys; billing only starts when this file exists
//!   data/                       created on first launch: Postgres, generated secrets

use anyhow::{Context, Result, bail};
use rand::{Rng, distr::Alphanumeric};
use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
};

pub const EXE: &str = env::consts::EXE_SUFFIX;

pub struct Paths {
    pub services: PathBuf,
    pub config: PathBuf,
    pub data: PathBuf,
}

impl Paths {
    /// The folder holding the launcher, or ERP_HOME (handy for `cargo run` against ../bin).
    pub fn discover() -> Result<Self> {
        let root = match env::var_os("ERP_HOME") {
            Some(home) => PathBuf::from(home),
            None => env::current_exe()?
                .parent()
                .context("the launcher has no parent folder")?
                .to_path_buf(),
        };
        let root = fs::canonicalize(&root).with_context(|| format!("{} does not exist", root.display()))?;
        // canonicalize gives \\?\C:\... on Windows, which some child programs (java) dislike
        let root = PathBuf::from(root.to_string_lossy().trim_start_matches(r"\\?\"));
        Ok(Self {
            services: root.join("services"),
            config: root.join("config"),
            data: root.join("data"),
        })
    }

    pub fn api(&self) -> PathBuf {
        self.services.join(format!("api{EXE}"))
    }

    pub fn importer(&self) -> PathBuf {
        self.services.join(format!("importer{EXE}"))
    }

    pub fn billing_java(&self) -> PathBuf {
        self.services.join("billing").join("runtime").join("bin").join(format!("java{EXE}"))
    }

    pub fn billing_jar(&self) -> PathBuf {
        self.services.join("billing").join("billing.jar")
    }

    pub fn billing_env(&self) -> PathBuf {
        self.config.join("billing.env")
    }
}

/// Secrets generated on first launch and kept in data/secrets.env. The Postgres password is fixed
/// when the cluster is created, so that file must stay with data/postgres.
pub struct Secrets {
    pub db_password: String,
    pub jwt_secret: String,
    pub billing_token: String,
}

pub struct Config {
    pub web_port: u16,
    pub api_port: u16,
    pub db_port: u16,
    pub importer_port: u16,
    pub billing_port: u16,
    pub import_workers: String,
    pub open_browser: bool,
    pub gateway: GatewayConfig,
    /// The first superuser, created by the API when the database has none (BOOTSTRAP_SU_*). Its
    /// password is a known one, so the web app makes it pick a new one at first sign-in.
    pub admin: Admin,
    pub secrets: Secrets,
}

/// The public port's behaviour (see gateway/mod.rs).
pub struct GatewayConfig {
    /// 127.0.0.1 by default; 0.0.0.0 to serve other machines (put it behind HTTPS then)
    pub bind: std::net::IpAddr,
    pub rate: f64,
    pub burst: u32,
    pub trust_proxy: bool,
    pub max_body_mb: usize,
    pub max_import_mb: usize,
    /// both set: the gateway serves HTTPS with this certificate and key (PEM)
    pub tls: Option<(PathBuf, PathBuf)>,
}

pub struct Admin {
    pub name: String,
    pub email: String,
    pub password: String,
}

impl Config {
    /// config/launcher.env, then ERP_* variables from the environment on top.
    pub fn load(paths: &Paths) -> Result<Self> {
        let mut vars = read_env_file(&paths.config.join("launcher.env"))?;
        vars.extend(env::vars().filter(|(k, _)| k.starts_with("ERP_")));

        let port = |key: &str, default: u16| -> Result<u16> {
            match vars.get(key) {
                Some(v) => v.parse().with_context(|| format!("{key}={v} is not a port")),
                None => Ok(default),
            }
        };
        Ok(Self {
            web_port: port("ERP_WEB_PORT", 8080)?,
            api_port: port("ERP_API_PORT", 3333)?,
            // not 5432, so it never collides with a Postgres already installed on the machine
            db_port: port("ERP_DB_PORT", 5433)?,
            importer_port: port("ERP_IMPORTER_PORT", 50051)?,
            billing_port: port("ERP_BILLING_PORT", 8081)?,
            import_workers: vars.get("ERP_IMPORT_WORKERS").cloned().unwrap_or_else(|| "2".into()),
            open_browser: flag(&vars, "ERP_OPEN_BROWSER", true),
            gateway: GatewayConfig {
                bind: match vars.get("ERP_BIND") {
                    Some(v) => v.parse().with_context(|| format!("ERP_BIND={v} is not an IP address"))?,
                    None => std::net::IpAddr::from([127, 0, 0, 1]),
                },
                rate: number(&vars, "ERP_RATE", 20.0)?,
                burst: number(&vars, "ERP_BURST", 40.0)? as u32,
                trust_proxy: flag(&vars, "ERP_TRUST_PROXY", false),
                max_body_mb: number(&vars, "ERP_MAX_BODY_MB", 1.0)? as usize,
                // the API takes spreadsheets up to 15 MB (api/src/middlewares/upload.middleware.ts)
                max_import_mb: number(&vars, "ERP_MAX_IMPORT_MB", 16.0)? as usize,
                tls: match (vars.get("ERP_TLS_CERT"), vars.get("ERP_TLS_KEY")) {
                    (Some(c), Some(k)) if !c.is_empty() && !k.is_empty() => Some((PathBuf::from(c), PathBuf::from(k))),
                    (None, None) => None,
                    (Some(c), Some(k)) if c.is_empty() && k.is_empty() => None,
                    _ => bail!("set both ERP_TLS_CERT and ERP_TLS_KEY, or neither"),
                },
            },
            admin: Admin {
                name: vars.get("ERP_ADMIN_NAME").cloned().unwrap_or_else(|| "John Doe".into()),
                email: vars.get("ERP_ADMIN_EMAIL").cloned().unwrap_or_else(|| "admin@sample-erp.local".into()),
                password: vars.get("ERP_ADMIN_PASSWORD").cloned().unwrap_or_else(|| "change-me".into()),
            },
            secrets: load_secrets(&paths.data)?,
        })
    }

    pub fn database_url(&self) -> String {
        format!(
            "postgresql://postgres:{}@127.0.0.1:{}/sample_erp?sslmode=disable",
            self.secrets.db_password, self.db_port
        )
    }

    /// The public address: the gateway, the only port a browser (or Stripe) talks to.
    pub fn web_url(&self) -> String {
        let scheme = if self.gateway.tls.is_some() { "https" } else { "http" };
        format!("{scheme}://localhost:{}", self.web_port)
    }
}

fn number(vars: &HashMap<String, String>, key: &str, default: f64) -> Result<f64> {
    match vars.get(key) {
        Some(v) => v.parse::<f64>().ok().filter(|n| *n >= 0.0).with_context(|| format!("{key}={v} is not a non-negative number")),
        None => Ok(default),
    }
}

fn flag(vars: &HashMap<String, String>, key: &str, default: bool) -> bool {
    match vars.get(key).map(|v| v.to_ascii_lowercase()).as_deref() {
        Some("0" | "false" | "no" | "off") => false,
        Some("1" | "true" | "yes" | "on") => true,
        _ => default,
    }
}

/// KEY=value lines (dotenv syntax), or nothing when the file is missing.
pub fn read_env_file(path: &Path) -> Result<HashMap<String, String>> {
    if !path.exists() {
        return Ok(HashMap::new());
    }
    dotenvy::from_path_iter(path)
        .with_context(|| format!("reading {}", path.display()))?
        .map(|item| item.with_context(|| format!("parsing {}", path.display())))
        .collect()
}

fn load_secrets(data: &Path) -> Result<Secrets> {
    let path = data.join("secrets.env");
    let mut vars = read_env_file(&path)?;
    let mut changed = false;
    for key in ["POSTGRES_PASSWORD", "JWT_SECRET", "BILLING_INTERNAL_TOKEN"] {
        if !vars.contains_key(key) {
            if key == "POSTGRES_PASSWORD" && data.join("postgres").join("data").exists() {
                bail!(
                    "{} is missing but data/postgres already exists with the password it held; \
                     restore the file, or delete the data folder to start over with an empty database",
                    path.display()
                );
            }
            vars.insert(key.into(), random_secret());
            changed = true;
        }
    }
    if changed {
        fs::create_dir_all(data)?;
        let body: String = ["POSTGRES_PASSWORD", "JWT_SECRET", "BILLING_INTERNAL_TOKEN"]
            .iter()
            .map(|k| format!("{k}={}\n", vars[*k]))
            .collect();
        let header = "# Generated by sample-erp on first launch. POSTGRES_PASSWORD belongs to data/postgres:\n\
                      # keep them together, or delete both to start over.\n";
        fs::write(&path, format!("{header}{body}")).with_context(|| format!("writing {}", path.display()))?;
    }
    Ok(Secrets {
        db_password: vars.remove("POSTGRES_PASSWORD").unwrap(),
        jwt_secret: vars.remove("JWT_SECRET").unwrap(),
        billing_token: vars.remove("BILLING_INTERNAL_TOKEN").unwrap(),
    })
}

fn random_secret() -> String {
    rand::rng().sample_iter(&Alphanumeric).take(40).map(char::from).collect()
}
