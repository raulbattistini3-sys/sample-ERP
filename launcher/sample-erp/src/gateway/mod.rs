//! The only public port: sample-erp.exe serves the web app and proxies the services behind it.
//!
//!   browser ──► :8080 (ERP_WEB_PORT; HTTPS when ERP_TLS_CERT/ERP_TLS_KEY are set)
//!                 ├─ /healthz      204, never rate limited
//!                 ├─ /api/*        → API     127.0.0.1:<ERP_API_PORT>     (prefix stripped)
//!                 ├─ /billing/*    → billing 127.0.0.1:<ERP_BILLING_PORT> (Stripe webhooks)
//!                 └─ /*            → the embedded web app
//!               the importer stays private; only the API reaches it, over gRPC
//!
//! Every proxied request, in order (after orderguard's internal/gateway, minus HMAC signing, which in an
//! SPA would mean shipping the key to every browser):
//!   1. per-client rate limit, 429 + Retry-After
//!   2. path policy: /api/internal/* and /billing/internal/* (the services' channels to each other) are never
//!      reachable from outside
//!   3. body cap per route: the spreadsheet imports get the larger one, 413 past it
//!   4. Idempotency-Key on POSTs that create records (required) or any POST that sends one; never on the
//!      routes that answer with session tokens, which would otherwise sit in memory
//!   5. forwarded with client-sent X-Forwarded-* replaced by the gateway's own, and redirects rewritten
//!      back under the prefix

pub mod idempotency;
pub mod ratelimit;

use crate::web;
use axum::{
    Router,
    body::{Body, Bytes},
    extract::{ConnectInfo, Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, Method, Response, StatusCode, header},
    response::IntoResponse,
};
use futures_util::TryStreamExt;
use idempotency::{Acquire, Stored};
use std::{future::Future, net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};

pub struct Upstream {
    pub prefix: &'static str,
    pub base: String, // e.g. http://127.0.0.1:3333
}

pub struct Settings {
    pub upstreams: Vec<Upstream>,
    pub rate: f64,
    pub burst: u32,
    pub trust_proxy: bool,
    pub max_body: usize,
    pub max_import: usize,
    pub https: bool,
}

struct Gateway {
    settings: Settings,
    limiter: ratelimit::Limiter,
    idempotency: idempotency::Store,
    client: reqwest::Client,
}

// POSTs that create records: a retried or replayed one must not create a second
const IDEMPOTENCY_REQUIRED: &[&str] = &[
    "/api/products",
    "/api/products/imports",
    "/api/products/import",
    "/api/categorias",
    "/api/auditoria",
    "/api/auditoria/manual",
    "/api/detalhamento-auditoria",
    "/api/user",
    // Stripe invoices: a replay must not bill anyone twice
    "/api/cobrancas",
];
// their responses carry session tokens or reset links: never stored
const IDEMPOTENCY_NEVER: &[&str] = &["/api/user/"];
const IMPORT_ROUTES: &[&str] = &["/api/products/imports", "/api/products/import"];
// the services' own channels to each other: the API takes billing's token there, and billing the API's
const BLOCKED: &[&str] = &["/api/internal", "/billing/internal"];

const HOP_BY_HOP: &[&str] = &[
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer",
    "transfer-encoding", "upgrade", "host", "content-length",
];
const FORWARDED: &[&str] = &["x-forwarded-for", "x-forwarded-proto", "x-forwarded-host", "x-forwarded-prefix", "forwarded"];

/// Serves the gateway on listener until shutdown resolves: plain HTTP, or HTTPS with tls (cert, key).
pub async fn serve(
    listener: std::net::TcpListener,
    settings: Settings,
    tls: Option<(PathBuf, PathBuf)>,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()> {
    let app = router(settings).into_make_service_with_connect_info::<SocketAddr>();
    match tls {
        None => {
            axum::serve(tokio::net::TcpListener::from_std(listener)?, app).with_graceful_shutdown(shutdown).await?;
        }
        Some((cert, key)) => {
            // ring, not the default aws-lc-rs, which needs cmake and NASM to build on Windows
            let _ = rustls::crypto::ring::default_provider().install_default();
            let config = axum_server::tls_rustls::RustlsConfig::from_pem_file(&cert, &key).await.map_err(|e| {
                anyhow::anyhow!("loading ERP_TLS_CERT/ERP_TLS_KEY ({}, {}): {e}", cert.display(), key.display())
            })?;
            let handle = axum_server::Handle::new();
            let stopper = handle.clone();
            tokio::spawn(async move {
                shutdown.await;
                stopper.graceful_shutdown(Some(Duration::from_secs(10)));
            });
            axum_server::from_tcp_rustls(listener, config)?.handle(handle).serve(app).await?;
        }
    }
    Ok(())
}

pub fn router(settings: Settings) -> Router {
    let gateway = Arc::new(Gateway {
        limiter: ratelimit::Limiter::new(settings.rate, settings.burst),
        idempotency: idempotency::Store::default(),
        client: reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::none())
            .pool_max_idle_per_host(64)
            .build()
            .expect("an HTTP client with default TLS-free settings always builds"),
        settings,
    });
    let gc = gateway.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(60));
        loop {
            tick.tick().await;
            gc.limiter.gc();
            gc.idempotency.gc();
        }
    });
    Router::new().fallback(handle).with_state(gateway)
}

async fn handle(State(gw): State<Arc<Gateway>>, ConnectInfo(peer): ConnectInfo<SocketAddr>, req: Request) -> Response<Body> {
    let path = req.uri().path().to_string();
    if path == "/healthz" {
        return StatusCode::NO_CONTENT.into_response();
    }
    let Some(upstream) = gw.settings.upstreams.iter().find(|u| path == u.prefix || path.starts_with(&format!("{}/", u.prefix)))
    else {
        return web::file(req.uri().clone()).await;
    };

    // 1. rate limit
    let client_ip = client_ip(req.headers(), peer, gw.settings.trust_proxy);
    if let Err(wait) = gw.limiter.allow(&client_ip) {
        let mut res = error(StatusCode::TOO_MANY_REQUESTS, "Muitas requisições; tente de novo em instantes.");
        res.headers_mut().insert(header::RETRY_AFTER, HeaderValue::from(wait.as_secs().max(1)));
        return res;
    }

    // 2. path policy
    if BLOCKED.iter().any(|b| path == *b || path.starts_with(&format!("{b}/"))) {
        return error(StatusCode::NOT_FOUND, "Not found");
    }

    // 3. body cap
    let method = req.method().clone();
    let limit = if method == Method::POST && IMPORT_ROUTES.contains(&path.as_str()) {
        gw.settings.max_import
    } else {
        gw.settings.max_body
    };
    let (parts, body) = req.into_parts();
    let Ok(body) = axum::body::to_bytes(body, limit).await else {
        return error(
            StatusCode::PAYLOAD_TOO_LARGE,
            &format!("Requisição maior que o limite de {} MB.", limit / (1024 * 1024)),
        );
    };

    // 4. idempotency
    let key = parts.headers.get(idempotency::HEADER).and_then(|v| v.to_str().ok()).map(str::to_string);
    let idempotent = method == Method::POST
        && !IDEMPOTENCY_NEVER.iter().any(|p| path.starts_with(p))
        && (key.is_some() || IDEMPOTENCY_REQUIRED.contains(&path.as_str()));
    let mut owned_key = None;
    if idempotent {
        let Some(key) = key.filter(|k| idempotency::valid_key(k)) else {
            return error(
                StatusCode::BAD_REQUEST,
                "Cabeçalho Idempotency-Key obrigatório (8 a 255 caracteres de [A-Za-z0-9_.:-]).",
            );
        };
        let uri = parts.uri.path_and_query().map(|p| p.as_str()).unwrap_or(&path);
        let fp = idempotency::fingerprint(method.as_str(), uri, &body);
        let scoped = idempotency::scoped(parts.headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()), &key);
        match gw.idempotency.acquire(&scoped, fp) {
            Acquire::Owner => owned_key = Some(scoped),
            Acquire::InFlight => {
                let mut res = error(StatusCode::CONFLICT, "Uma requisição com esta Idempotency-Key ainda está em andamento.");
                res.headers_mut().insert(header::RETRY_AFTER, HeaderValue::from(1));
                return res;
            }
            Acquire::Mismatch => {
                return error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Esta Idempotency-Key já foi usada com outra requisição (método, caminho ou corpo diferentes).",
                );
            }
            Acquire::Replay(stored) => return replay(stored),
        }
    }

    // 5. forward
    let rest = &parts.uri.path()[upstream.prefix.len()..];
    let query = parts.uri.query().map(|q| format!("?{q}")).unwrap_or_default();
    let url = format!("{}{}{}", upstream.base, if rest.is_empty() { "/" } else { rest }, query);
    let mut headers = reqwest::header::HeaderMap::new();
    for (name, value) in &parts.headers {
        let n = name.as_str();
        if HOP_BY_HOP.contains(&n) || (FORWARDED.contains(&n) && !gw.settings.trust_proxy) {
            continue;
        }
        headers.append(name.clone(), value.clone());
    }
    let forwarded_for = match parts.headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        Some(prev) if gw.settings.trust_proxy => format!("{prev}, {}", peer.ip()),
        _ => peer.ip().to_string(),
    };
    let set = |h: &mut reqwest::header::HeaderMap, name: &'static str, value: &str| {
        if let Ok(v) = HeaderValue::from_str(value) {
            h.insert(HeaderName::from_static(name), v);
        }
    };
    set(&mut headers, "x-forwarded-for", &forwarded_for);
    set(&mut headers, "x-forwarded-proto", if gw.settings.https { "https" } else { "http" });
    if let Some(host) = parts.headers.get(header::HOST).and_then(|v| v.to_str().ok()) {
        set(&mut headers, "x-forwarded-host", host);
    }
    set(&mut headers, "x-forwarded-prefix", upstream.prefix);

    let sent = gw.client.request(method.clone(), &url).headers(headers).body(body).send().await;
    let upstream_res = match sent {
        Ok(r) => r,
        Err(e) => {
            if let Some(k) = &owned_key {
                gw.idempotency.release(k);
            }
            crate::log("gateway", &format!("{} {path}: upstream unavailable ({e})", method));
            return error(StatusCode::BAD_GATEWAY, "Serviço indisponível no momento.");
        }
    };

    let status = upstream_res.status();
    let mut out_headers = HeaderMap::new();
    for (name, value) in upstream_res.headers() {
        if HOP_BY_HOP.contains(&name.as_str()) {
            continue;
        }
        if name == header::LOCATION {
            if let Some(v) = rewrite_location(value, upstream.prefix) {
                out_headers.append(name.clone(), v);
                continue;
            }
        }
        out_headers.append(name.clone(), value.clone());
    }

    let Some(key) = owned_key else {
        // streamed: exports and large pages never sit in memory
        let stream = upstream_res.bytes_stream().map_err(std::io::Error::other);
        let mut res = Response::new(Body::from_stream(stream));
        *res.status_mut() = status;
        *res.headers_mut() = out_headers;
        return res;
    };

    let bytes = match upstream_res.bytes().await {
        Ok(b) => b,
        Err(_) => {
            gw.idempotency.release(&key);
            return error(StatusCode::BAD_GATEWAY, "Serviço indisponível no momento.");
        }
    };
    if status.is_server_error() {
        gw.idempotency.release(&key);
    } else {
        gw.idempotency.complete(
            &key,
            Stored {
                status: status.as_u16(),
                headers: out_headers.iter().map(|(n, v)| (n.to_string(), v.as_bytes().to_vec())).collect(),
                body: (bytes.len() <= idempotency::MAX_STORED_BODY).then(|| bytes.to_vec()),
            },
        );
    }
    let mut res = Response::new(Body::from(bytes));
    *res.status_mut() = status;
    *res.headers_mut() = out_headers;
    res
}

fn replay(stored: Stored) -> Response<Body> {
    let Some(body) = stored.body else {
        return error(StatusCode::CONFLICT, "Esta requisição já foi processada; a resposta era grande demais para ser repetida.");
    };
    let mut res = Response::new(Body::from(Bytes::from(body)));
    *res.status_mut() = StatusCode::from_u16(stored.status).unwrap_or(StatusCode::OK);
    for (name, value) in stored.headers {
        if let (Ok(n), Ok(v)) = (HeaderName::try_from(name), HeaderValue::from_bytes(&value)) {
            res.headers_mut().append(n, v);
        }
    }
    res.headers_mut().insert(HeaderName::from_static(idempotency::REPLAYED_HEADER), HeaderValue::from_static("true"));
    res
}

/// Only trusts X-Forwarded-For behind a proxy the operator vouches for (ERP_TRUST_PROXY); anyone can
/// send that header otherwise.
fn client_ip(headers: &HeaderMap, peer: SocketAddr, trust_proxy: bool) -> String {
    if trust_proxy {
        if let Some(first) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()).and_then(|v| v.split(',').next()) {
            let first = first.trim();
            if !first.is_empty() {
                return first.to_string();
            }
        }
    }
    peer.ip().to_string()
}

/// A redirect to /docs/ from the API means /api/docs/ to the browser.
fn rewrite_location(value: &HeaderValue, prefix: &str) -> Option<HeaderValue> {
    let location = value.to_str().ok()?;
    if location.starts_with('/') && !location.starts_with("//") && !location.starts_with(&format!("{prefix}/")) {
        return HeaderValue::from_str(&format!("{prefix}{location}")).ok();
    }
    None
}

/// The API's own error shape, so the web app shows these messages like any other.
fn error(status: StatusCode, message: &str) -> Response<Body> {
    let body = serde_json::json!({ "message": message, "status": "error" }).to_string();
    (status, [(header::CONTENT_TYPE, "application/json")], body).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locations_go_back_under_the_prefix() {
        let v = |s: &str| HeaderValue::from_str(s).unwrap();
        assert_eq!(rewrite_location(&v("/docs/"), "/api").unwrap(), "/api/docs/");
        assert!(rewrite_location(&v("/api/docs/"), "/api").is_none());
        assert!(rewrite_location(&v("https://example.com/x"), "/api").is_none());
        assert!(rewrite_location(&v("//evil.example/x"), "/api").is_none());
    }

    #[test]
    fn forwarded_for_is_ignored_unless_trusted() {
        let mut h = HeaderMap::new();
        h.insert("x-forwarded-for", HeaderValue::from_static("6.6.6.6, 10.0.0.1"));
        let peer: SocketAddr = "127.0.0.1:5000".parse().unwrap();
        assert_eq!(client_ip(&h, peer, false), "127.0.0.1");
        assert_eq!(client_ip(&h, peer, true), "6.6.6.6");
    }
}
