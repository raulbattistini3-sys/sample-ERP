//! Runs each service as a child process, prefixes its output with its name, and restarts it when it
//! dies (docker-compose.yml's `restart: unless-stopped`).

use std::{
    path::PathBuf,
    process::Stdio,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, BufReader},
    process::Command,
    sync::watch,
    time::{sleep, timeout},
};

pub struct Spec {
    pub name: &'static str,
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cwd: PathBuf,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum State {
    Running,
    /// Ctrl+C: the console delivered it to every child too, so they get time to finish their work.
    Interrupted,
    /// The launcher is giving up for another reason; the children never heard of it.
    Aborted,
}

const GRACE: Duration = Duration::from_secs(20);

pub async fn supervise(spec: Spec, mut state: watch::Receiver<State>) {
    let mut backoff = Duration::from_secs(2);
    loop {
        if *state.borrow() != State::Running {
            return;
        }
        let mut child = match Command::new(&spec.program)
            .args(&spec.args)
            .envs(spec.env.iter().map(|(k, v)| (k, v)))
            .current_dir(&spec.cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
        {
            Ok(child) => child,
            Err(e) => {
                crate::log(spec.name, &format!("could not start {}: {e}", spec.program.display()));
                return;
            }
        };
        forward(spec.name, child.stdout.take());
        forward(spec.name, child.stderr.take());
        let started = Instant::now();

        tokio::select! {
            status = child.wait() => {
                if *state.borrow() != State::Running {
                    return;
                }
                if started.elapsed() > Duration::from_secs(60) {
                    backoff = Duration::from_secs(2);
                }
                let status = status.map(|s| s.to_string()).unwrap_or_else(|e| e.to_string());
                crate::log(spec.name, &format!("stopped ({status}), restarting in {}s", backoff.as_secs()));
                tokio::select! {
                    _ = sleep(backoff) => {}
                    _ = state.changed() => return,
                }
                backoff = (backoff * 2).min(Duration::from_secs(30));
            }
            _ = state.changed() => {
                let graceful = *state.borrow() == State::Interrupted;
                if !graceful || timeout(GRACE, child.wait()).await.is_err() {
                    let _ = child.kill().await;
                }
                return;
            }
        }
    }
}

fn forward(name: &'static str, stream: Option<impl AsyncRead + Unpin + Send + 'static>) {
    let Some(stream) = stream else { return };
    tokio::spawn(async move {
        let mut lines = BufReader::new(stream).split(b'\n');
        while let Ok(Some(line)) = lines.next_segment().await {
            let line = String::from_utf8_lossy(&line);
            crate::log(name, line.trim_end_matches('\r'));
        }
    });
}
