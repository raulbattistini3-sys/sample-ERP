//! `cargo xtask dist`: builds every service natively and assembles the repo's bin/ folder.
//!
//!   web      vite build (bun) → web/dist, embedded into the launcher
//!   api      bun build --compile → services/api.exe, Bun runtime included
//!   importer go build → services/importer.exe
//!   network  go build → services/network.exe (registry + public gateway)
//!   vault    go build → services/vault.exe (encrypted CPF / birth dates; keys under DPAPI)
//!   billing  mvnw package + jlink → services/billing/{billing.jar, runtime/} (a trimmed JRE)
//!   launcher cargo build --release → sample-erp.exe, with the web app, SQL and migrations inside
//!
//! Options: --no-billing (skip Maven and the JDK), --out DIR (default: <repo>/bin)

use anyhow::{Context, Result, bail};
use std::{
    env,
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

const EXE: &str = env::consts::EXE_SUFFIX;
/// The web app calls the API on its own origin, through the launcher's gateway (no CORS, no address baked in).
const WEB_API_URL: &str = "/api";
/// What a Spring Boot 4 app with JPA, Flyway, Security and Actuator loads from the JDK.
const BILLING_MODULES: &str = "java.base,java.compiler,java.desktop,java.instrument,java.management,\
java.naming,java.net.http,java.prefs,java.rmi,java.scripting,java.security.jgss,java.security.sasl,\
java.sql,java.transaction.xa,java.xml,jdk.crypto.ec,jdk.management,jdk.naming.dns,jdk.net,\
jdk.unsupported,jdk.zipfs,jdk.localedata";

fn main() -> Result<()> {
    let args: Vec<String> = env::args().skip(1).collect();
    let Some((task, opts)) = args.split_first() else {
        bail!("usage: cargo xtask dist [--no-billing] [--out DIR]");
    };
    if task != "dist" {
        bail!("unknown task {task}; usage: cargo xtask dist [--no-billing] [--out DIR]");
    }
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize()?;
    let repo = PathBuf::from(repo.to_string_lossy().trim_start_matches(r"\\?\"));
    let mut out = repo.join("bin");
    let mut billing = true;
    let mut opts = opts.iter();
    while let Some(opt) = opts.next() {
        match opt.as_str() {
            "--no-billing" => billing = false,
            "--out" => out = PathBuf::from(opts.next().context("--out needs a folder")?),
            other => bail!("unknown option {other}"),
        }
    }
    dist(&repo, &out, billing)
}

fn dist(repo: &Path, out: &Path, billing: bool) -> Result<()> {
    for tool in ["bun", "go"].into_iter().chain(billing.then_some("jlink")) {
        if which(tool).is_none() {
            bail!("{tool} is not on PATH (needed to build {}); see launcher/README.md", match tool {
                "bun" => "the web app and the API",
                "go" => "the importer",
                _ => "billing's runtime; or pass --no-billing",
            });
        }
    }
    let services = out.join("services");
    fs::create_dir_all(&services)?;
    fs::create_dir_all(out.join("config"))?;

    step("web: vite build");
    let web = repo.join("web");
    run(Command::new(tool("bun")).args(["install", "--frozen-lockfile"]).current_dir(&web))?;
    run(Command::new(tool("bun"))
        .args(["run", "build"])
        .env("VITE_API_URL", WEB_API_URL)
        .current_dir(&web))?;

    step("api: bun build --compile");
    let api = repo.join("api");
    run(Command::new(tool("bun")).args(["install", "--frozen-lockfile"]).current_dir(&api))?;
    run(Command::new(tool("bun"))
        .args(["build", "--compile", "--minify-syntax", "src/index.ts", "--outfile"])
        .arg(services.join(format!("api{EXE}")))
        .current_dir(&api))?;

    step("importer: go build");
    run(Command::new(tool("go"))
        .args(["build", "-trimpath", "-ldflags=-s -w", "-o"])
        .arg(services.join(format!("importer{EXE}")))
        .arg("./importer/cmd/importer")
        .env("CGO_ENABLED", "0")
        .current_dir(repo))?;

    step("vault: go build");
    run(Command::new(tool("go"))
        .args(["build", "-trimpath", "-ldflags=-s -w", "-o"])
        .arg(services.join(format!("vault{EXE}")))
        .arg("./vault/cmd/vault")
        .env("CGO_ENABLED", "0")
        .current_dir(repo))?;

    step("network: go build");
    run(Command::new(tool("go"))
        .args(["build", "-trimpath", "-ldflags=-s -w", "-o"])
        .arg(services.join(format!("network{EXE}")))
        .arg("./network/cmd/network")
        .env("CGO_ENABLED", "0")
        .current_dir(repo))?;

    if billing {
        build_billing(repo, &services.join("billing"))?;
    } else {
        step("billing: skipped (--no-billing)");
    }

    step("launcher: cargo build --release");
    let launcher = repo.join("launcher");
    run(Command::new(env::var("CARGO").unwrap_or_else(|_| "cargo".into()))
        .args(["build", "--release", "-p", "sample-erp"])
        .current_dir(&launcher))?;
    copy(
        &launcher.join("target/release").join(format!("sample-erp{EXE}")),
        &out.join(format!("sample-erp{EXE}")),
    )?;

    let examples = launcher.join("dist-config");
    for name in ["launcher.env.example", "api.env.example", "billing.env.example"] {
        copy(&examples.join(name), &out.join("config").join(name))?;
    }
    copy(&examples.join("README.txt"), &out.join("README.txt"))?;

    step(&format!("done: {}", out.display()));
    println!("  run {}", out.join(format!("sample-erp{EXE}")).display());
    Ok(())
}

fn build_billing(repo: &Path, dest: &Path) -> Result<()> {
    step("billing: mvnw package");
    let billing = repo.join("billing");
    // through sh on Unix: git has mvnw without its executable bit
    let mut mvnw = if cfg!(windows) {
        Command::new(billing.join("mvnw.cmd"))
    } else {
        let mut sh = Command::new("sh");
        sh.arg(billing.join("mvnw"));
        sh
    };
    // test.skip, not skipTests: the tests need Docker
    run(mvnw
        .args(["-B", "-q", "-Dmaven.test.skip=true", "package"])
        .current_dir(&billing))?;
    let jar = fs::read_dir(billing.join("target"))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .find(|p| {
            let name = p.file_name().and_then(OsStr::to_str).unwrap_or_default();
            name.starts_with("billing-") && name.ends_with(".jar")
        })
        .context("mvnw package left no billing-*.jar in billing/target")?;

    step("billing: jlink runtime");
    let runtime = dest.join("runtime");
    if runtime.exists() {
        fs::remove_dir_all(&runtime).with_context(|| format!("removing the old {}", runtime.display()))?;
    }
    fs::create_dir_all(dest)?;
    run(Command::new(tool("jlink"))
        .args(["--add-modules", BILLING_MODULES])
        .args(["--strip-debug", "--no-man-pages", "--no-header-files", "--compress=zip-6"])
        .arg("--output")
        .arg(&runtime))?;
    copy(&jar, &dest.join("billing.jar"))
}

fn step(message: &str) {
    println!("\n==> {message}");
}

fn run(cmd: &mut Command) -> Result<()> {
    let status = cmd.status().with_context(|| format!("starting {cmd:?}"))?;
    if !status.success() {
        bail!("{cmd:?} failed ({status})");
    }
    Ok(())
}

fn copy(from: &Path, to: &Path) -> Result<()> {
    fs::copy(from, to).with_context(|| format!("copying {} to {}", from.display(), to.display()))?;
    Ok(())
}

/// The full path of a tool on PATH. Command::new("bun") would find bun.exe on its own, but not a
/// .cmd shim, which is how some installers provide these.
fn tool(name: &str) -> PathBuf {
    which(name).unwrap_or_else(|| PathBuf::from(name))
}

fn which(name: &str) -> Option<PathBuf> {
    let exts: Vec<String> = if cfg!(windows) {
        env::var("PATHEXT").unwrap_or(".EXE;.CMD;.BAT".into()).split(';').map(str::to_lowercase).collect()
    } else {
        vec![String::new()]
    };
    env::split_paths(&env::var_os("PATH")?).find_map(|dir| {
        exts.iter().map(|ext| dir.join(format!("{name}{ext}"))).find(|p| p.is_file())
    })
}
