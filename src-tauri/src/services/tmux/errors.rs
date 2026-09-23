//! `TmuxError` — single error type for the tmux subsystem.
//!
//! ## Why
//!
//! Before PR-T6 the entire tmux stack returned `Result<_, String>`, which
//! forced callers to do string matching for control flow and made it
//! impossible to programmatically distinguish "server not running" from
//! "auth failed" from "command timed out". `TmuxError` keeps the wire
//! format ergonomic (just `Display`/`Error` for the common path) while
//! exposing structured variants the controller and dispatch task can
//! match on.
//!
//! ## Where it lives
//!
//! `services/tmux/errors.rs` — public to anything that imports a
//! `Result<_, TmuxError>` from the tmux subsystem, including
//! `commands/session.rs` which bridges back to the `String`-shaped
//! Tauri command contract via the [`From<TmuxError> for String`] impl
//! in `services/tmux/mod.rs`.
//!
//! ## Design
//!
//! - **`#[non_exhaustive]`** on the enum so adding a variant in a
//!   follow-up PR is not a SemVer-breaking change for downstream
//!   `match`es — they must use `_` as the last arm.
//! - **`thiserror` derive** for `Display` + `Error`, so call sites can
//!   `tracing::error!(err = ?tmux_err)` and get a stable, structured
//!   log line.
//! - **No `From<X>` blanket impls** — `?` only converts when an explicit
//!   `From` impl is written. This forces new error sources to declare
//!   how they surface, rather than silently erasing variant detail.
//!
//! ## Stable variants
//!
//! These have shipped and should not change shape without an ADR:
//!
//! | variant | meaning | HTTP-style status hint |
//! |---|---|---|
//! | [`TmuxError::ServerNotRunning`](Self::ServerNotRunning) | no server on the requested socket | NotFound |
//! | [`TmuxError::Spawn`](Self::Spawn) | failed to spawn the tmux child | Internal |
//! | [`TmuxError::Ipc`](Self::Ipc) | russh / stdio / channel I/O failure | BadGateway |
//! | [`TmuxError::Timeout`](Self::Timeout) | command or handshake exceeded its budget | GatewayTimeout |
//! | [`TmuxError::Protocol`](Self::Protocol) | parser could not produce a `ProtocolEvent` | BadRequest |
//! | [`TmuxError::CommandNotFound`](Self::CommandNotFound) | the request referenced a window/pane/session id that the controller has never seen | NotFound |
//! | [`TmuxError::AlreadyClosed`](Self::AlreadyClosed) | the controller already dropped the channel (caller raced with shutdown) | Conflict |
//! | [`TmuxError::Internal`](Self::Internal) | escaped from an unwrap / invariant violation | Internal |

use std::time::Duration;
use thiserror::Error;

/// Errors that can be returned from anywhere in `services/tmux/`.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum TmuxError {
    /// `tmux` is not running on the requested socket. Returned by
    /// `probe_tmux_session_exists` when the command exits non-zero with
    /// "no server running on /tmp/tmux-...".
    #[error("tmux server not running: {socket}")]
    ServerNotRunning { socket: String },

    /// Spawning the tmux child (local) or opening the SSH exec channel
    /// (remote) failed. The `source` field carries the lower-level
    /// `io::Error` or russh handshake failure for `tracing::error!`.
    #[error("failed to spawn tmux: {context}")]
    Spawn {
        context: &'static str,
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },

    /// Byte I/O on the tmux control channel failed after spawn
    /// succeeded. Equivalent to a transport-level error in HTTP.
    #[error("tmux I/O error: {context}")]
    Ipc {
        context: &'static str,
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },

    /// A command or handshake step exceeded its time budget. Carries
    /// the budget so callers can log it without having to plumb the
    /// `Duration` through separately. `context` is a short static
    /// label like `"handshake v2 step"` that the log greps can
    /// distinguish between (a) the v2 handshake vs (b) the legacy
    /// `pending_capture` 5-second wait.
    #[error("tmux operation timed out after {budget:?} ({context})")]
    Timeout {
        budget: Duration,
        context: &'static str,
    },

    /// The wire protocol parser rejected a line. Surfaces as
    /// "ignore" in the dispatch task (the previous behaviour for
    /// `Unknown` events) but propagates as `Err` from the parser's
    /// own `feed` calls so test harnesses can assert on it.
    #[error("tmux protocol parse error: {0}")]
    Protocol(String),

    /// The caller referenced a tmux-side identifier (window, pane,
    /// session) that the controller has no record of. Surfaces in
    /// `send_keys` / `capture_pane` when the pane binding was never
    /// recorded (typically a race against `record_first_pane`).
    #[error("tmux {kind} {id} is not registered with this controller")]
    CommandNotFound { kind: CommandKind, id: String },

    /// The controller's `stdin_tx` / oneshot channel has already been
    /// dropped because the tmux child exited. The caller raced with
    /// shutdown; retrying will hit the same fate until the user
    /// reopens the session.
    #[error("tmux controller is already closed")]
    AlreadyClosed,

    /// Catch-all for invariant violations (unwrap on a registered
    /// command id, etc.). Should never fire in tests; if you see it in
    /// a log, file a bug.
    #[error("internal tmux invariant violated: {0}")]
    Internal(String),
}

/// What kind of tmux identifier the caller was looking for, used in
/// [`TmuxError::CommandNotFound`] to make the message grep-friendly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandKind {
    Pane,
    Window,
    Session,
}

impl std::fmt::Display for CommandKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            CommandKind::Pane => "pane",
            CommandKind::Window => "window",
            CommandKind::Session => "session",
        })
    }
}

/// Convenience constructor for `TmuxError::Spawn` from an
/// `std::io::Error`. The `context` is a short static label like
/// `"spawn_create cmd.spawn"`.
pub fn spawn_err<E: Into<Box<dyn std::error::Error + Send + Sync>>>(
    context: &'static str,
    source: E,
) -> TmuxError {
    TmuxError::Spawn {
        context,
        source: Some(source.into()),
    }
}

/// Convenience constructor for `TmuxError::Ipc` from an
/// `std::io::Error`. The `context` is a short static label like
/// `"reader_task read"`.
pub fn ipc_err<E: Into<Box<dyn std::error::Error + Send + Sync>>>(
    context: &'static str,
    source: E,
) -> TmuxError {
    TmuxError::Ipc {
        context,
        source: Some(source.into()),
    }
}

// ---------------------------------------------------------------------------
// `From` impls for `?`-propagation.
//
// P6's brief is "Result<_, String> → Result<_, TmuxError>". The
// mechanical signature change is easy; what makes it ergonomic is
// letting the existing `?` sites inside the controller / dispatcher
// auto-convert. So we write exactly three `From` impls, one per
// *category* of error we expect the tmux stack to surface:
//
// - `std::io::Error`  → `TmuxError::Ipc`
// - `russh::Error`     → `TmuxError::Ipc` (SSH path uses the same wire,
//                       so the same variant fits)
// - `tokio::time::Elapsed` → `TmuxError::Timeout`
//
// Anything else (e.g. `serde_json::Error`, `Box<dyn Error>`) should be
// converted by an explicit `.map_err(|e| spawn_err(...))` so the
// caller chooses the variant, the way `tmux_probe_quote` does in
// `services/session_manager.rs`.
// ---------------------------------------------------------------------------

impl From<std::io::Error> for TmuxError {
    fn from(err: std::io::Error) -> TmuxError {
        TmuxError::Ipc {
            context: "std::io::Error",
            source: Some(Box::new(err)),
        }
    }
}

impl From<tokio::time::error::Elapsed> for TmuxError {
    fn from(_: tokio::time::error::Elapsed) -> TmuxError {
        // `Elapsed` carries no useful detail; the caller should set
        // the `context` by going through `TmuxError::Timeout`
        // directly. This `From` only fires when a `tokio::time::timeout`
        // call has a default `Duration` (i.e. no label), which is
        // almost always a bug — flag it loudly.
        TmuxError::Timeout {
            budget: std::time::Duration::from_secs(0),
            context:
                "tokio::time::timeout (no context — caller should use TmuxError::Timeout directly)",
        }
    }
}

/// `String → TmuxError` lands in the `Internal` variant.
///
/// We provide it because P6's mechanical refactor (`Result<_, String>`
/// → `Result<_, TmuxError>`) leaves ~30 `Err(format!(...))` sites
/// inside `controller/mod.rs` (mostly oneshot-channel failure
/// payloads constructed by the dispatch task). Forbidding `?` from
/// auto-converting these would force every such site to spell out
/// `TmuxError::Internal(format!(...))` — pure boilerplate.
///
/// The trade-off: a `From<String>` impl makes it possible for new
/// code to "round-trip" a string error and lose information. The
/// `Internal` variant's `Display` impl still surfaces the string, so
/// the user-visible message is preserved; the loss is only the
/// distinction between "user-facing string" and "developer-facing
/// invariant violation". `TmuxError::Internal` is explicitly the
/// variant we use for "we shouldn't be here" — this From impl
/// channels ambiguous strings into that bucket.
impl From<String> for TmuxError {
    fn from(s: String) -> TmuxError {
        TmuxError::Internal(s)
    }
}

impl From<&str> for TmuxError {
    fn from(s: &str) -> TmuxError {
        TmuxError::Internal(s.to_string())
    }
}

// Note: `From<russh::Error>` is intentionally NOT implemented here.
// russh errors come in several flavours (kex, channel, disconnect,
// process exit) and lumping them under `TmuxError::Ipc` would erase
// signal. The SSH path uses `TmuxBackend::connect_exec` /
// `SshBackend::run_command_capture_stdout`, which already returns
// `Result<_, String>` — that conversion happens at the boundary and
// is the right place to map to a specific `TmuxError` variant.
//
// If a future PR needs `?`-propagation inside the SSH exec path,
// add `impl From<russh::Error> for TmuxError` here with the
// variant(s) you actually need.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_is_stable_for_log_grep() {
        // Locked message strings — if any of these change the log
        // grep that hunts for these patterns breaks. Update the
        // grep + change this assertion in the same commit.
        assert_eq!(
            TmuxError::ServerNotRunning {
                socket: "default".into()
            }
            .to_string(),
            "tmux server not running: default"
        );
        assert_eq!(
            TmuxError::AlreadyClosed.to_string(),
            "tmux controller is already closed"
        );
    }

    #[test]
    fn command_kind_display_matches_words() {
        assert_eq!(CommandKind::Pane.to_string(), "pane");
        assert_eq!(CommandKind::Window.to_string(), "window");
        assert_eq!(CommandKind::Session.to_string(), "session");
    }

    #[test]
    fn timeout_carries_budget() {
        let err = TmuxError::Timeout {
            budget: Duration::from_secs(5),
            context: "handshake v2 step",
        };
        assert!(err.to_string().contains("5s"));
        assert!(err.to_string().contains("handshake v2 step"));
    }

    #[test]
    fn spawn_helpers_wrap_io_error() {
        let io = std::io::Error::new(std::io::ErrorKind::NotFound, "tmux not in PATH");
        let err = spawn_err("spawn_create cmd.spawn", io);
        match err {
            TmuxError::Spawn { context, source } => {
                assert_eq!(context, "spawn_create cmd.spawn");
                let source_msg = source.expect("source should be preserved").to_string();
                assert!(source_msg.contains("tmux not in PATH"));
            }
            _ => panic!("expected TmuxError::Spawn"),
        }
    }

    #[test]
    fn non_exhaustive_does_not_block_in_crate_match() {
        // Within the defining crate, a non-exhaustive enum can still
        // be matched exhaustively (rustc permits `_ =>` even without
        // it). This test exists to remind the next dev that if they
        // add a variant, they must grep for `_ =>` arms too.
        let err = TmuxError::Internal("test".into());
        let _matched: bool = match err {
            TmuxError::Internal(_) => true,
            _ => false,
        };
    }
}
