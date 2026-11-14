//! The embedded Postgres: installed under data/postgres on first launch, then the same steps
//! docker-compose.yml takes (the init scripts on an empty database, then the "migrate" service).

use crate::config::{Config, Paths};
use anyhow::{Context, Result, bail};
use postgresql_embedded::{PostgreSQL, Settings, VersionReq};
use rust_embed::RustEmbed;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::{Connection, PgConnection, Row};
use std::{collections::HashMap, time::Duration};

const DATABASE: &str = "sample_erp";
/// The vault's database, beside sample_erp in the same cluster; the vault creates its own tables.
pub const VAULT_DATABASE: &str = "sample_erp_vault";
const RELEASES_URL: &str = "https://github.com/theseus-rs/postgresql-binaries";

/// docker/postgres/init: the schema and seed rows the postgres image runs on an empty volume
#[derive(RustEmbed)]
#[folder = "../../docker/postgres/init"]
#[include = "*.sql"]
struct InitScripts;

/// api/drizzle: the migrations `bun run db:migrate` applies, and the journal that orders them
#[derive(RustEmbed)]
#[folder = "../../api/drizzle"]
#[include = "*.sql"]
#[include = "meta/_journal.json"]
struct Migrations;

fn settings(paths: &Paths, cfg: &Config) -> Result<Settings> {
    let root = paths.data.join("postgres");
    std::fs::create_dir_all(&root)?;
    // A literal rather than Settings::new(), which creates (and leaks) two temp folders per call.
    Ok(Settings {
        releases_url: RELEASES_URL.into(),
        // the same major version as docker-compose.yml's postgres:17-alpine
        version: VersionReq::parse("=17")?,
        installation_dir: root.join("install"),
        password_file: root.join("pwfile"),
        data_dir: root.join("data"),
        host: "127.0.0.1".into(),
        port: cfg.db_port,
        username: "postgres".into(),
        password: cfg.secrets.db_password.clone(),
        temporary: false,
        // initdb and pg_ctl can take a while on a cold Windows disk
        timeout: Some(Duration::from_secs(120)),
        configuration: HashMap::from([("listen_addresses".into(), "127.0.0.1".into())]),
        trust_installation_dir: false,
        socket_dir: None,
    })
}

/// Installs (first launch: downloads ~100 MB), initializes and starts Postgres. Dropping the
/// returned handle stops the server too, but call `stop` to wait for it.
pub async fn start(paths: &Paths, cfg: &Config) -> Result<PostgreSQL> {
    #[cfg(windows)]
    use_msvc_build()?;
    let settings = settings(paths, cfg)?;
    let first_launch = !settings.installation_dir.exists();
    if first_launch {
        crate::log("postgres", "first launch: downloading a portable Postgres 17 (one time)");
    }
    let install_root = settings.installation_dir.clone();
    let mut pg = PostgreSQL::new(settings);
    // Windows Defender scans the freshly extracted .exe files and can briefly block the rename that moves
    // them into place ("access denied", os error 5); a second try a few seconds later goes through
    for attempt in 1..=3u64 {
        match pg.setup().await {
            Ok(()) => break,
            Err(e) if attempt < 3 => {
                crate::log("postgres", &format!("install attempt {attempt} failed ({e}); retrying"));
                remove_partial_extracts(&install_root);
                tokio::time::sleep(Duration::from_secs(3 * attempt)).await;
            }
            Err(e) => return Err(e).context("installing Postgres"),
        }
    }
    pg.start().await.with_context(|| {
        format!(
            "starting Postgres on port {} (see data/postgres/data/start.log)",
            cfg.db_port
        )
    })?;
    crate::log("postgres", &format!("listening on 127.0.0.1:{}", cfg.db_port));
    Ok(pg)
}

/// The archive crate looks for `postgresql-<version>-<the launcher's own target>.tar.gz`, but the
/// Windows binaries are only published as `-pc-windows-msvc`. A launcher built with the GNU toolchain
/// (x86_64-pc-windows-gnu, e.g. Rust from Chocolatey) would find no asset, so on Windows always ask for
/// the MSVC build: it's a standalone Postgres, whatever compiled the launcher.
#[cfg(windows)]
fn use_msvc_build() -> Result<()> {
    postgresql_archive::matcher::registry::register(
        |url| Ok(url == RELEASES_URL),
        |_url, name, version| {
            Ok(name == format!("postgresql-{version}-{}-pc-windows-msvc.tar.gz", std::env::consts::ARCH))
        },
    )?;
    Ok(())
}

/// The archive is unpacked into a `.tmp*` folder next to its destination first; a failed rename leaves it
/// behind.
fn remove_partial_extracts(install_root: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(install_root) else { return };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(".tmp") {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// Creates and seeds the database on first launch, then applies the migrations it hasn't seen.
pub async fn prepare(pg: &PostgreSQL, cfg: &Config) -> Result<()> {
    if !pg.database_exists(DATABASE).await? {
        pg.create_database(DATABASE).await?;
        if let Err(e) = run_init_scripts(cfg).await {
            // leave nothing half-made behind: the next launch starts over
            let _ = pg.drop_database(DATABASE).await;
            return Err(e);
        }
        crate::log("postgres", "created sample_erp from docker/postgres/init");
    }
    if !pg.database_exists(VAULT_DATABASE).await? {
        pg.create_database(VAULT_DATABASE).await?;
        crate::log("postgres", "created sample_erp_vault (the vault makes its tables on its first start)");
    }
    migrate(cfg).await
}

async fn run_init_scripts(cfg: &Config) -> Result<()> {
    let mut names: Vec<_> = InitScripts::iter().collect();
    names.sort();
    // its own connection: 01_schema.sql empties search_path for the rest of the session
    let mut conn = PgConnection::connect(&cfg.database_url()).await?;
    let mut tx = conn.begin().await?;
    for name in names {
        let sql = text(InitScripts::get(&name).unwrap().data.as_ref(), &name)?;
        sqlx::raw_sql(sqlx::AssertSqlSafe(sql))
            .execute(&mut *tx)
            .await
            .with_context(|| format!("running docker/postgres/init/{name}"))?;
    }
    tx.commit().await?;
    conn.close().await?;
    Ok(())
}

#[derive(Deserialize)]
struct Journal {
    entries: Vec<JournalEntry>,
}

#[derive(Deserialize)]
struct JournalEntry {
    tag: String,
    when: i64,
}

/// What drizzle-kit's migrator does: every journal entry newer than the last row of
/// drizzle.__drizzle_migrations runs, statement by statement, in one transaction, and is logged with
/// the sha256 of its file. 02_seed.sql writes the same rows, so a fresh database only gets the
/// migrations added after it.
async fn migrate(cfg: &Config) -> Result<()> {
    let journal: Journal = serde_json::from_slice(
        &Migrations::get("meta/_journal.json")
            .context("api/drizzle/meta/_journal.json was not embedded")?
            .data,
    )?;
    let mut conn = PgConnection::connect(&cfg.database_url()).await?;
    sqlx::raw_sql(
        "CREATE SCHEMA IF NOT EXISTS drizzle;
         CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
             id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)",
    )
    .execute(&mut conn)
    .await?;
    let last: Option<i64> =
        sqlx::query("SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1")
            .fetch_optional(&mut conn)
            .await?
            .map(|row| row.get(0));

    let pending: Vec<_> = journal
        .entries
        .iter()
        .filter(|e| last.is_none_or(|last| last < e.when))
        .collect();
    if pending.is_empty() {
        return Ok(());
    }

    let mut tx = conn.begin().await?;
    for entry in &pending {
        let file = format!("{}.sql", entry.tag);
        let Some(content) = Migrations::get(&file) else {
            bail!("api/drizzle/{file} is in the journal but was not embedded");
        };
        let sql = text(content.data.as_ref(), &file)?;
        for statement in sql.split("--> statement-breakpoint") {
            if statement.trim().is_empty() {
                continue;
            }
            sqlx::raw_sql(sqlx::AssertSqlSafe(statement.to_string()))
                .execute(&mut *tx)
                .await
                .with_context(|| format!("applying api/drizzle/{file}"))?;
        }
        let hash = format!("{:x}", Sha256::digest(sql.as_bytes()));
        sqlx::query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)")
            .bind(hash)
            .bind(entry.when)
            .execute(&mut *tx)
            .await?;
        crate::log("migrate", &format!("applied {}", entry.tag));
    }
    tx.commit().await?;
    Ok(())
}

/// `sample-erp promote <email>`: gives an account the SU permission (the first user has no other way
/// to get it). Uses the running stack's Postgres, or starts one just for this.
pub async fn promote(paths: &Paths, cfg: &Config, email: &str) -> Result<()> {
    let started = match PgConnection::connect(&cfg.database_url()).await {
        Ok(conn) => {
            conn.close().await?;
            None
        }
        Err(_) => {
            if !paths.data.join("postgres").join("data").exists() {
                bail!("there is no database yet: launch sample-erp once and sign up first");
            }
            Some(start(paths, cfg).await?)
        }
    };
    let result = async {
        let mut conn = PgConnection::connect(&cfg.database_url()).await?;
        let updated = sqlx::query("UPDATE usuarios SET permissoes = 'SU' WHERE lower(email) = lower($1)")
            .bind(email)
            .execute(&mut conn)
            .await?
            .rows_affected();
        if updated == 0 {
            bail!("no account with e-mail {email}: sign up in the web app first");
        }
        println!("{email} is now SU; sign out and back in to pick it up");
        Ok(())
    }
    .await;
    if let Some(pg) = started {
        pg.stop().await?;
    }
    result
}

fn text(bytes: &[u8], name: &str) -> Result<String> {
    String::from_utf8(bytes.to_vec()).with_context(|| format!("{name} is not UTF-8"))
}
