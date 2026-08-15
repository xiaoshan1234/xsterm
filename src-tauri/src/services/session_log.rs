//! Per-session output logging.
//!
//! Provides a [`SessionLog`] public type stub and a
//! [`start_session_logging`] entry point used by
//! [`SessionManager`](crate::services::session_manager::SessionManager).
//!
//! The actual on-disk log writer is intentionally deferred — only the
//! configuration acknowledgement (`tracing::info!` on enabled) is wired today.
//! Future waves can add `SessionLog::write_line` / `format_line` etc. without
//! changing the public API surface.

use crate::models::session::SessionLoggingConfig;

/// Per-session log file configuration stub.
///
/// Reserved for future on-disk log wiring. Currently carries no fields and is
/// emitted as an opaque token through the public API surface so callers can
/// be updated independently of the backend storage layer.
#[allow(dead_code)]
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionLog {
    _private: (),
}

/// Acknowledge a session's logging configuration.
///
/// Emits a `tracing::info!` event when `enabled` is set so the global log
/// records that the session requested logging. Returns `Ok(())` for every
/// valid configuration — session creation is never blocked by logging.
///
/// The on-disk wiring (open file, write per-chunk, rollover) is reserved for
/// a follow-up wave.
pub fn start_session_logging(
    session_id: u32,
    logging_config: &SessionLoggingConfig,
) -> Result<(), String> {
    if logging_config.enabled.unwrap_or(false) {
        tracing::info!(
            session_id,
            template = ?logging_config.file_name_template,
            max_size_mb = ?logging_config.max_size_mb,
            append = ?logging_config.append,
            "Session logging configured"
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg_enabled() -> SessionLoggingConfig {
        SessionLoggingConfig {
            enabled: Some(true),
            append: Some(true),
            file_name_template: Some("%n.log".to_string()),
            max_size_mb: Some(10),
            line_format: Some("[%Y-%m-%d] %v".to_string()),
        }
    }

    fn cfg_disabled() -> SessionLoggingConfig {
        SessionLoggingConfig {
            enabled: Some(false),
            ..Default::default()
        }
    }

    #[test]
    fn start_session_logging_returns_ok_when_disabled() {
        let cfg = cfg_disabled();
        assert!(start_session_logging(42, &cfg).is_ok());
    }

    #[test]
    fn start_session_logging_returns_ok_when_enabled() {
        let cfg = cfg_enabled();
        assert!(start_session_logging(7, &cfg).is_ok());
    }

    #[test]
    fn start_session_logging_accepts_default_config() {
        let cfg = SessionLoggingConfig::default();
        assert!(start_session_logging(1, &cfg).is_ok());
    }

    #[test]
    fn start_session_logging_accepts_enabled_true_with_all_fields() {
        let cfg = SessionLoggingConfig {
            enabled: Some(true),
            append: Some(false),
            file_name_template: Some("custom.log".to_string()),
            max_size_mb: Some(50),
            line_format: Some("RAW: %v".to_string()),
        };
        assert!(start_session_logging(100, &cfg).is_ok());
    }

    #[test]
    fn start_session_logging_accepts_enabled_none() {
        let cfg = SessionLoggingConfig {
            enabled: None,
            file_name_template: Some("foo.log".to_string()),
            max_size_mb: Some(5),
            ..Default::default()
        };
        // enabled == None is treated as disabled; function should still Ok.
        assert!(start_session_logging(99, &cfg).is_ok());
    }

    #[test]
    fn start_session_logging_accepts_zero_session_id() {
        let cfg = cfg_enabled();
        assert!(start_session_logging(0, &cfg).is_ok());
    }

    #[test]
    fn start_session_logging_accepts_max_session_id() {
        let cfg = cfg_enabled();
        assert!(start_session_logging(u32::MAX, &cfg).is_ok());
    }

    #[test]
    fn start_session_logging_accepts_max_size_zero() {
        let cfg = SessionLoggingConfig {
            enabled: Some(true),
            max_size_mb: Some(0),
            ..Default::default()
        };
        assert!(start_session_logging(1, &cfg).is_ok());
    }

    #[test]
    fn session_log_default_is_constructible() {
        let _log = SessionLog::default();
    }

    #[test]
    fn session_log_clone_preserves_equality() {
        let log = SessionLog::default();
        let cloned = log.clone();
        assert_eq!(log, cloned);
    }

    #[test]
    fn session_log_debug_format_is_non_empty() {
        let log = SessionLog::default();
        let formatted = format!("{:?}", log);
        assert!(!formatted.is_empty());
    }

    #[test]
    fn session_log_default_equals_default() {
        assert_eq!(SessionLog::default(), SessionLog::default());
    }

    #[test]
    fn start_session_logging_accepts_only_file_name_template() {
        let cfg = SessionLoggingConfig {
            enabled: Some(true),
            file_name_template: Some("trace.log".to_string()),
            ..Default::default()
        };
        assert!(start_session_logging(11, &cfg).is_ok());
    }

    #[test]
    fn start_session_logging_accepts_only_max_size() {
        let cfg = SessionLoggingConfig {
            enabled: Some(true),
            max_size_mb: Some(25),
            ..Default::default()
        };
        assert!(start_session_logging(12, &cfg).is_ok());
    }

    #[test]
    fn start_session_logging_accepts_only_line_format() {
        let cfg = SessionLoggingConfig {
            enabled: Some(true),
            line_format: Some("OUT: %v".to_string()),
            ..Default::default()
        };
        assert!(start_session_logging(13, &cfg).is_ok());
    }
}