//! The web app (web/dist, embedded at compile time), served by the gateway for every path that isn't a
//! service's, in place of the nginx image. `cargo xtask dist` builds it with VITE_API_URL=/api, so the
//! browser calls the API on the same origin: no CORS, and no address baked into the bundle.

use axum::{
    body::Body,
    http::{Response, StatusCode, Uri, header},
    response::IntoResponse,
};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "../../web/dist"]
#[allow_missing = true]
struct WebDist;

pub fn is_built() -> bool {
    WebDist::get("index.html").is_some()
}

pub async fn file(uri: Uri) -> Response<Body> {
    let path = uri.path().trim_start_matches('/');
    let (name, content, immutable) = match WebDist::get(path).filter(|_| !path.is_empty()) {
        Some(content) => (path, content, path.starts_with("assets/")),
        // a missing hashed asset is a 404; anything else is a client-side route (/login, /auditorias, ...)
        None if path.starts_with("assets/") => return StatusCode::NOT_FOUND.into_response(),
        None => match WebDist::get("index.html") {
            Some(content) => ("index.html", content, false),
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
    // hashed assets never change (web/nginx.conf did the same); index.html always revalidates
    let cache = if immutable { "public, max-age=31536000, immutable" } else { "no-cache" };
    (
        [(header::CONTENT_TYPE, mime.as_ref().to_string()), (header::CACHE_CONTROL, cache.to_string())],
        content.data.into_owned(),
    )
        .into_response()
}
