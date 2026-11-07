//! Per-client token bucket, ported from orderguard's internal/ratelimit. Idempotency keeps duplicates
//! from becoming duplicate records, but every request still reaches the API and the database; this caps
//! how fast any one client is served, turning a flood away with 429 before it gets there.

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

pub struct Limiter {
    rate: f64, // tokens per second; <= 0 disables limiting
    burst: f64,
    buckets: Mutex<HashMap<String, Bucket>>,
}

struct Bucket {
    tokens: f64,
    last: Instant,
}

impl Limiter {
    pub fn new(rate: f64, burst: u32) -> Self {
        Self { rate, burst: f64::from(burst.max(1)), buckets: Mutex::new(HashMap::new()) }
    }

    /// Spends one token for key: Ok, or Err with how long until a token is available.
    pub fn allow(&self, key: &str) -> Result<(), Duration> {
        self.allow_at(key, Instant::now())
    }

    fn allow_at(&self, key: &str, now: Instant) -> Result<(), Duration> {
        if self.rate <= 0.0 {
            return Ok(());
        }
        let mut buckets = self.buckets.lock().unwrap();
        let Some(b) = buckets.get_mut(key) else {
            // a fresh client starts full, then spends one
            buckets.insert(key.to_string(), Bucket { tokens: self.burst - 1.0, last: now });
            return Ok(());
        };
        b.tokens = (b.tokens + now.saturating_duration_since(b.last).as_secs_f64() * self.rate).min(self.burst);
        b.last = now;
        if b.tokens >= 1.0 {
            b.tokens -= 1.0;
            return Ok(());
        }
        // rounded up, so Retry-After is never 0 while still denied
        Err(Duration::from_secs_f64((1.0 - b.tokens) / self.rate) + Duration::from_millis(1))
    }

    /// Drops buckets that have had time to refill completely: a new one starts full anyway, so idle
    /// clients don't leak memory.
    pub fn gc(&self) {
        let full = Duration::from_secs_f64(self.burst / self.rate.max(1e-9));
        let cutoff = full.max(Duration::from_secs(60));
        let now = Instant::now();
        self.buckets.lock().unwrap().retain(|_, b| now.saturating_duration_since(b.last) < cutoff);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn burst_then_refill() {
        let l = Limiter::new(2.0, 3);
        let t0 = Instant::now();
        assert!(l.allow_at("a", t0).is_ok());
        assert!(l.allow_at("a", t0).is_ok());
        assert!(l.allow_at("a", t0).is_ok());
        let wait = l.allow_at("a", t0).unwrap_err();
        assert!(wait > Duration::from_millis(400) && wait < Duration::from_millis(600), "{wait:?}");
        // other clients have their own bucket
        assert!(l.allow_at("b", t0).is_ok());
        // half a second at 2/s refills one token
        assert!(l.allow_at("a", t0 + Duration::from_millis(510)).is_ok());
    }

    #[test]
    fn zero_rate_disables() {
        let l = Limiter::new(0.0, 1);
        for _ in 0..100 {
            assert!(l.allow("a").is_ok());
        }
    }
}
