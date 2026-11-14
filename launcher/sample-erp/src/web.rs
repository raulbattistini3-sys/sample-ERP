//! The web app (web/dist, embedded at compile time). At launch it is written to data/web and served from
//! there by the network service (NETWORK_WEB_DIR), in place of the nginx image. `cargo xtask dist` builds
//! it with VITE_API_URL=/api, so the browser calls the API on the same origin: no CORS, and no address
//! baked into the bundle.

use anyhow::{Context, Result};
use rust_embed::RustEmbed;
use std::{fs, path::Path};

#[derive(RustEmbed)]
#[folder = "../../web/dist"]
#[allow_missing = true]
struct WebDist;

pub fn is_built() -> bool {
    WebDist::get("index.html").is_some()
}

/// Replaces `dir` with the embedded build, so files of an older build never linger next to the new one.
pub fn extract(dir: &Path) -> Result<()> {
    if dir.exists() {
        fs::remove_dir_all(dir).with_context(|| format!("clearing {}", dir.display()))?;
    }
    for name in WebDist::iter() {
        let file = WebDist::get(&name).context("embedded file vanished")?;
        let target = dir.join(name.as_ref());
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target, file.data.as_ref()).with_context(|| format!("writing {}", target.display()))?;
    }
    Ok(())
}
