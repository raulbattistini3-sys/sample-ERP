//! Idempotency-Key handling, ported from orderguard's internal/idempotency, with an in-memory store: one
//! gateway process serves the whole stack, so there are no replicas to share it with.
//!
//! The first request with a key runs; a concurrent duplicate gets 409 while it is in flight, and the
//! stored response (marked Idempotent-Replayed) once it's done. The same key with a different method,
//! path or body is 422: that is the tampered replay of orderguard's man-in-the-middle demo. A 5xx frees
//! the key, so a retry runs again. Status codes follow the IETF Idempotency-Key header draft.

use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

pub const HEADER: &str = "idempotency-key";
pub const REPLAYED_HEADER: &str = "idempotent-replayed";

/// How long a key is remembered.
const TTL: Duration = Duration::from_secs(24 * 60 * 60);
/// How long an in-flight key is honoured; past it (the request hung or the gateway lost track) a retry
/// takes the key over. Longer than any upstream call, including a synchronous 5,000-row import.
const LOCK_TIMEOUT: Duration = Duration::from_secs(120);
/// Responses larger than this aren't kept for replay.
pub const MAX_STORED_BODY: usize = 1024 * 1024;

pub fn valid_key(key: &str) -> bool {
    (8..=255).contains(&key.len()) && key.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.:-".contains(&b))
}

/// sha256 of what the key promises to repeat: method, path with query, body.
pub fn fingerprint(method: &str, uri: &str, body: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(method.as_bytes());
    h.update([0]);
    h.update(uri.as_bytes());
    h.update([0]);
    h.update(body);
    h.finalize().into()
}

/// Keys live in the caller's namespace (a hash of its Authorization header), so one user can neither
/// block another's key nor read the response stored under it.
pub fn scoped(authorization: Option<&str>, key: &str) -> String {
    let owner = Sha256::digest(authorization.unwrap_or("").as_bytes());
    format!("{:x}:{key}", owner)
}

#[derive(Clone)]
pub struct Stored {
    pub status: u16,
    pub headers: Vec<(String, Vec<u8>)>,
    /// None when the response was too big to keep
    pub body: Option<Vec<u8>>,
}

enum State {
    Pending(Instant),
    Done(Stored),
}

struct Record {
    fingerprint: [u8; 32],
    state: State,
    created: Instant,
}

pub enum Acquire {
    /// run the request, then call complete or release
    Owner,
    InFlight,
    Mismatch,
    Replay(Stored),
}

#[derive(Default)]
pub struct Store {
    records: Mutex<HashMap<String, Record>>,
}

impl Store {
    pub fn acquire(&self, key: &str, fingerprint: [u8; 32]) -> Acquire {
        let now = Instant::now();
        let mut records = self.records.lock().unwrap();
        if let Some(r) = records.get(key) {
            let stale = matches!(r.state, State::Pending(since) if now.duration_since(since) > LOCK_TIMEOUT)
                || now.duration_since(r.created) > TTL;
            if !stale {
                if r.fingerprint != fingerprint {
                    return Acquire::Mismatch;
                }
                return match &r.state {
                    State::Pending(_) => Acquire::InFlight,
                    State::Done(stored) => Acquire::Replay(stored.clone()),
                };
            }
        }
        records.insert(key.to_string(), Record { fingerprint, state: State::Pending(now), created: now });
        Acquire::Owner
    }

    pub fn complete(&self, key: &str, stored: Stored) {
        if let Some(r) = self.records.lock().unwrap().get_mut(key) {
            r.state = State::Done(stored);
        }
    }

    /// The upstream failed for reasons the client didn't cause: forget the key so a retry runs again.
    pub fn release(&self, key: &str) {
        self.records.lock().unwrap().remove(key);
    }

    pub fn gc(&self) {
        let now = Instant::now();
        self.records.lock().unwrap().retain(|_, r| now.duration_since(r.created) <= TTL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn done(status: u16) -> Stored {
        Stored { status, headers: vec![], body: Some(b"{}".to_vec()) }
    }

    #[test]
    fn first_owns_duplicate_waits_then_replays() {
        let s = Store::default();
        let fp = fingerprint("POST", "/products", b"{\"a\":1}");
        assert!(matches!(s.acquire("k", fp), Acquire::Owner));
        assert!(matches!(s.acquire("k", fp), Acquire::InFlight));
        s.complete("k", done(201));
        assert!(matches!(s.acquire("k", fp), Acquire::Replay(r) if r.status == 201));
    }

    #[test]
    fn tampered_body_is_a_mismatch() {
        let s = Store::default();
        assert!(matches!(s.acquire("k", fingerprint("POST", "/p", b"qty=1")), Acquire::Owner));
        assert!(matches!(s.acquire("k", fingerprint("POST", "/p", b"qty=100")), Acquire::Mismatch));
    }

    #[test]
    fn release_lets_a_retry_run() {
        let s = Store::default();
        let fp = fingerprint("POST", "/p", b"");
        assert!(matches!(s.acquire("k", fp), Acquire::Owner));
        s.release("k");
        assert!(matches!(s.acquire("k", fp), Acquire::Owner));
    }

    #[test]
    fn keys_are_per_caller_and_validated() {
        assert_ne!(scoped(Some("Bearer a"), "key-12345"), scoped(Some("Bearer b"), "key-12345"));
        assert!(valid_key("0f3c9a1e-77aa-4c1b"));
        assert!(!valid_key("short"));
        assert!(!valid_key("has spaces in it"));
    }
}
