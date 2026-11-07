//! The web app (web/dist, embedded at compile time) served by axum, in place of the nginx image.
//!
//! `cargo xtask dist` builds the app with VITE_API_URL set to a placeholder, which is swapped here for
//! the API's real address, so ERP_API_PORT can change without rebuilding the web app.

use axum::{
    Router,
    extract::State,
    http::{StatusCode, Uri, header},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;
use std::{future::Future, sync::Arc};

pub const API_URL_PLACEHOLDER: &str = "__SAMPLE_ERP_API_URL__";

#[derive(RustEmbed)]
#[folder = "../../web/dist"]
#[allow_missing = true]
struct WebDist;

pub fn is_built() -> bool {
    WebDist::get("index.html").is_some()
}

pub async fn serve(
    listener: tokio::net::TcpListener,
    api_url: String,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> std::io::Result<()> {
    let app = Router::new().fallback(file).with_state(Arc::new(api_url));
    axum::serve(listener, app).with_graceful_shutdown(shutdown).await
}

async fn file(State(api_url): State<Arc<String>>, uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let (name, content) = match WebDist::get(path).filter(|_| !path.is_empty()) {
        Some(content) => (path, content),
        // a missing hashed asset is a 404; anything else is a client-side route (/login, /auditorias, ...)
        None if path.starts_with("assets/") => return StatusCode::NOT_FOUND.into_response(),
        None => match WebDist::get("index.html") {
            Some(content) => ("index.html", content),
            None => {
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "This launcher was built without the web app: run `cargo xtask dist`.",
                )
                    .into_response();
            }
        },
    };

    let mime = mime_guess::from_path(name).first_or_octet_stream();
    let mut body = content.data.into_owned();
    if name.ends_with(".js") || name.ends_with(".html") {
        if let Some(replaced) = replace(&body, API_URL_PLACEHOLDER.as_bytes(), api_url.as_bytes()) {
            body = replaced;
        }
    }
    // no long-lived caching: the API address inside the bundle can change between launches
    ([(header::CONTENT_TYPE, mime.as_ref()), (header::CACHE_CONTROL, "no-cache")], body).into_response()
}

fn replace(haystack: &[u8], from: &[u8], to: &[u8]) -> Option<Vec<u8>> {
    let first = haystack.windows(from.len()).position(|w| w == from)?;
    let mut out = Vec::with_capacity(haystack.len());
    let mut rest = haystack;
    let mut next = Some(first);
    while let Some(i) = next {
        out.extend_from_slice(&rest[..i]);
        out.extend_from_slice(to);
        rest = &rest[i + from.len()..];
        next = rest.windows(from.len()).position(|w| w == from);
    }
    out.extend_from_slice(rest);
    Some(out)
}
