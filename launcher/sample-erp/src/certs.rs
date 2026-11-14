//! The certificates of the api -> importer gRPC and api -> vault HTTPS links (mutual TLS), made on first launch in data/certs:
//! a private CA, the importer's server certificate and the API's client certificate. The same layout
//! secrets/generate.ts writes for docker compose (secrets/tls/).
//!
//!   ca.crt, ca.key              the CA; both sides trust only what it signed
//!   importer.crt, importer.key  names importer, localhost, 127.0.0.1; serverAuth and clientAuth (its
//!                               own healthcheck presents it)
//!   vault.crt, vault.key        names vault, localhost, 127.0.0.1; serverAuth and clientAuth
//!   api.crt, api.key            names api, localhost, 127.0.0.1; serverAuth (HTTPS, TLS 1.3) and clientAuth
//!   billing.crt, billing.key    names billing, localhost, 127.0.0.1; serverAuth and clientAuth (api <-> billing)
//!
//! Delete the folder to issue new ones; nothing else depends on them.

use anyhow::{Context, Result};
use rcgen::{
    BasicConstraints, Certificate, CertificateParams, DistinguishedName, DnType, ExtendedKeyUsagePurpose, IsCa,
    KeyPair, KeyUsagePurpose,
};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

pub struct TlsFiles {
    pub ca: PathBuf,
    pub importer_cert: PathBuf,
    pub importer_key: PathBuf,
    pub vault_cert: PathBuf,
    pub vault_key: PathBuf,
    pub api_cert: PathBuf,
    pub api_key: PathBuf,
    pub billing_cert: PathBuf,
    pub billing_key: PathBuf,
}

impl TlsFiles {
    fn at(dir: &Path) -> Self {
        Self {
            ca: dir.join("ca.crt"),
            importer_cert: dir.join("importer.crt"),
            importer_key: dir.join("importer.key"),
            vault_cert: dir.join("vault.crt"),
            vault_key: dir.join("vault.key"),
            api_cert: dir.join("api.crt"),
            api_key: dir.join("api.key"),
            billing_cert: dir.join("billing.crt"),
            billing_key: dir.join("billing.key"),
        }
    }

    fn all_exist(&self) -> bool {
        [&self.ca, &self.importer_cert, &self.importer_key, &self.vault_cert, &self.vault_key, &self.api_cert, &self.api_key, &self.billing_cert, &self.billing_key]
            .iter()
            .all(|p| p.exists())
    }
}

/// data/certs, issued on the first launch (or after the folder was deleted).
pub fn load_or_create(data: &Path) -> Result<TlsFiles> {
    let dir = data.join("certs");
    let files = TlsFiles::at(&dir);
    if files.all_exist() {
        return Ok(files);
    }
    fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    // a folder from an older launcher (no vault.crt or billing.crt) gets a whole new set, CA included
    issue(&dir, &files).context("issuing the internal mutual TLS certificates")?;
    Ok(files)
}

const DAY: Duration = Duration::from_secs(24 * 60 * 60);

fn validity(params: &mut CertificateParams, days: u32) {
    // a few minutes back, so a clock a little behind doesn't see a certificate from the future
    let start = SystemTime::now() - Duration::from_secs(5 * 60);
    params.not_before = start.into();
    params.not_after = (start + DAY * days).into();
}

fn named(cn: &str) -> DistinguishedName {
    let mut dn = DistinguishedName::new();
    dn.push(DnType::CommonName, cn);
    dn
}

fn leaf(
    cn: &str,
    sans: &[&str],
    usages: Vec<ExtendedKeyUsagePurpose>,
    ca: &Certificate,
    ca_key: &KeyPair,
) -> Result<(Certificate, KeyPair)> {
    let key = KeyPair::generate()?;
    // strings that parse as IP addresses become IP SANs
    let mut params = CertificateParams::new(sans.iter().map(|s| s.to_string()).collect::<Vec<_>>())?;
    params.distinguished_name = named(cn);
    params.is_ca = IsCa::ExplicitNoCa;
    params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    params.extended_key_usages = usages;
    params.use_authority_key_identifier_extension = true;
    validity(&mut params, 825);
    Ok((params.signed_by(&key, ca, ca_key)?, key))
}

fn issue(dir: &Path, files: &TlsFiles) -> Result<()> {
    let ca_key = KeyPair::generate()?; // ECDSA P-256
    let mut params = CertificateParams::new(Vec::<String>::new())?;
    params.distinguished_name = named("sample-erp internal mTLS CA");
    params.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
    params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    validity(&mut params, 3650);
    let ca = params.self_signed(&ca_key)?;

    let (importer, importer_key) = leaf(
        "importer",
        &["importer", "localhost", "127.0.0.1"],
        vec![ExtendedKeyUsagePurpose::ServerAuth, ExtendedKeyUsagePurpose::ClientAuth],
        &ca,
        &ca_key,
    )?;
    let (vault, vault_key) = leaf(
        "vault",
        &["vault", "localhost", "127.0.0.1"],
        vec![ExtendedKeyUsagePurpose::ServerAuth, ExtendedKeyUsagePurpose::ClientAuth],
        &ca,
        &ca_key,
    )?;
    // the API serves HTTPS (TLS 1.3) to the gateway and billing, and is the client towards the rest
    let (api, api_key) = leaf(
        "api",
        &["api", "localhost", "127.0.0.1"],
        vec![ExtendedKeyUsagePurpose::ServerAuth, ExtendedKeyUsagePurpose::ClientAuth],
        &ca,
        &ca_key,
    )?;
    // billing: server for the API's calls, client for its notifications back (mutual TLS both ways)
    let (billing, billing_key) = leaf(
        "billing",
        &["billing", "localhost", "127.0.0.1"],
        vec![ExtendedKeyUsagePurpose::ServerAuth, ExtendedKeyUsagePurpose::ClientAuth],
        &ca,
        &ca_key,
    )?;

    let write = |path: &Path, body: String| fs::write(path, body).with_context(|| format!("writing {}", path.display()));
    write(&files.ca, ca.pem())?;
    write(&dir.join("ca.key"), ca_key.serialize_pem())?;
    write(&files.importer_cert, importer.pem())?;
    write(&files.importer_key, importer_key.serialize_pem())?;
    write(&files.vault_cert, vault.pem())?;
    write(&files.vault_key, vault_key.serialize_pem())?;
    write(&files.api_cert, api.pem())?;
    write(&files.api_key, api_key.serialize_pem())?;
    write(&files.billing_cert, billing.pem())?;
    write(&files.billing_key, billing_key.serialize_pem())?;
    Ok(())
}
