//! Per-session output logging.
//!
//! Provides a [`SessionLog`] helper that applies a [`SessionLoggingConfig`]
//! to produce on-disk log files for terminal session output, plus a
//! [`start_session_logging`] entry point that the
//! [`SessionManager`](crate::services::session_manager::SessionManager) calls
//! when a new session is created.
//!
//! This module is deliberately decoupled from the global application logger
//! configured in `crate::logging_setup` — that handles `tracing` events and
//! is not session-scoped. Per-session output logging lives here so each
//! session can have its own log file, size cap, and line format independent
//! of the application-wide log rotation.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::Local;

use crate::models::session::SessionLoggingConfig;

/// Default maximum log file size (10 MB) when the config does not specify
/// one. Matches the global `DEFAULT_MAX_FILE_SIZE_MB` constant but is
/// defined locally because this module must not depend on
/// `crate::logging_setup` to keep the two layers cleanly separated.
const DEFAULT_MAX_SIZE_MB: u64 = 10;
/// Bytes per megabyte, used to convert MB → bytes.
#[allow(dead_code)]
const BYTES_PER_MB: u64 = 1024 * 1024;
/// Default template used when `file_name_template` is absent.
#[allow(dead_code)]
const DEFAULT_FILE_TEMPLATE: &str = "%n_%Y-%m-%d_%H-%M-%S.log";
/// Default line format used when `line_format` is absent.
#[allow(dead_code)]
const DEFAULT_LINE_FORMAT: &str = "[%Y-%m-%d %H:%M:%S] %v";

/// Per-session log file configuration.
///
/// Holds the resolved path, line format, size cap, and append/truncate mode
/// derived from a [`SessionLoggingConfig`]. Does not keep the file open —
/// each [`SessionLog::write_line`] opens, writes, and closes the file. This
/// keeps the implementation simple and avoids leaking file descriptors
/// across sessions.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct SessionLog {
    /// Absolute path to the log file.
    pub file_path: PathBuf,
    /// Line format template — `%v` is replaced with the output chunk.
    pub line_format: String,
    /// Maximum file size in bytes before rolling over.
    pub max_size_bytes: u64,
    /// `true` to append to an existing file, `false` to overwrite.
    pub append: bool,
}

#[allow(dead_code)]
impl SessionLog {
    /// Build a new `SessionLog` rooted at `log_dir` from `config`.
    ///
    /// The file name is the expansion of `config.file_name_template` (with
    /// `%n` / `%Y` / etc. substituted). Returns `Err` when
    /// `config.enabled` is `Some(false)` or unset.
    pub fn new(
        log_dir: &Path,
        session_name: &str,
        config: &SessionLoggingConfig,
    ) -> Result<Self, String> {
        if !config.enabled.unwrap_or(false) {
            return Err("Session logging is disabled".to_string());
        }

        let template = config
            .file_name_template
            .clone()
            .unwrap_or_else(|| DEFAULT_FILE_TEMPLATE.to_string());
        let file_name = expand_template(&template, session_name);
        let file_path = log_dir.join(file_name);

        let max_size_bytes = config
            .max_size_mb
            .unwrap_or(DEFAULT_MAX_SIZE_MB)
            .saturating_mul(BYTES_PER_MB);
        let line_format = config
            .line_format
            .clone()
            .unwrap_or_else(|| DEFAULT_LINE_FORMAT.to_string());

        Ok(Self {
            file_path,
            line_format,
            max_size_bytes,
            append: config.append.unwrap_or(true),
        })
    }

    /// Format a single output chunk using `line_format`.
    ///
    /// Exposed publicly for tests and for callers that prefer to
    /// format-then-write the line themselves.
    pub fn format_line(&self, content: &str) -> String {
        self.line_format.replace("%v", content)
    }

    /// Write one chunk of session output to the log file, rolling the file
    /// over if its current size exceeds `max_size_bytes`.
    pub fn write_line(&self, content: &str) -> Result<(), String> {
        self.maybe_roll_over()?;

        let mut file: File = OpenOptions::new()
            .create(true)
            .write(true)
            .append(self.append)
            .truncate(!self.append && !self.file_path.exists())
            .open(&self.file_path)
            .map_err(|e| format!("Failed to open log file {:?}: {}", self.file_path, e))?;

        let line = self.format_line(content);
        if let Err(e) = writeln!(file, "{}", line) {
            return Err(format!("Failed to write log line: {}", e));
        }
        Ok(())
    }

    /// Rename the existing log file to a `.1` suffix when its size has
    /// reached `max_size_bytes`. Errors are non-fatal: a warning is logged
    /// but the new write still proceeds against the original path.
    fn maybe_roll_over(&self) -> Result<(), String> {
        if !self.file_path.exists() {
            return Ok(());
        }
        let metadata = std::fs::metadata(&self.file_path)
            .map_err(|e| format!("Failed to stat log file: {}", e))?;
        if metadata.len() < self.max_size_bytes {
            return Ok(());
        }
        let mut backup = self.file_path.clone();
        let new_ext = match backup.extension() {
            Some(ext) => format!("{}.1", ext.to_string_lossy()),
            None => "1".to_string(),
        };
        backup.set_extension(new_ext);
        if let Err(e) = std::fs::rename(&self.file_path, &backup) {
            tracing::warn!(
                "Failed to roll over session log {:?} → {:?}: {}",
                self.file_path,
                backup,
                e
            );
        }
        Ok(())
    }
}

/// Expand `template` by substituting session-name and timestamp
/// placeholders.
///
/// Supported placeholders:
/// - `%n` — session display name
/// - `%Y` — 4-digit year
/// - `%m` — month (01–12)
/// - `%d` — day (01–31)
/// - `%H` — hour (00–23)
/// - `%M` — minute (00–59)
/// - `%S` — second (00–59)
///
/// Unknown placeholders (`%x`, `%y`, etc.) are left verbatim so callers can
/// detect typos rather than silently dropping them.
#[allow(dead_code)]
pub fn expand_template(template: &str, session_name: &str) -> String {
    let now = Local::now();
    template
        .replace("%n", session_name)
        .replace("%Y", &now.format("%Y").to_string())
        .replace("%m", &now.format("%m").to_string())
        .replace("%d", &now.format("%d").to_string())
        .replace("%H", &now.format("%H").to_string())
        .replace("%M", &now.format("%M").to_string())
        .replace("%S", &now.format("%S").to_string())
}

/// Start per-session output logging for the given `session_id`.
///
/// This entry point is called by
/// [`SessionManager::create_local`](crate::services::session_manager::SessionManager::create_local)
/// and
/// [`SessionManager::create_ssh`](crate::services::session_manager::SessionManager::create_ssh)
/// immediately after a local or SSH session is created. It validates the
/// configuration and emits a structured `tracing::info!` event describing
/// the resolved log destination.
///
/// The actual hooking of the per-session output stream into the log writer
/// is deferred to a follow-up wave (see the SessionLoggingConfig integration
/// roadmap). For now the function:
/// - returns `Ok(())` for every configuration (logging is best-effort and
///   never blocks session creation),
/// - emits a `tracing::info!` event when logging is enabled, so the active
///   configuration is observable in the global log,
/// - returns `Err` only for malformed internal state (currently a no-op).
///
/// The `_output_writer` parameter is reserved for the future wiring phase
/// and is intentionally ignored.
pub fn start_session_logging(
    session_id: u32,
    logging_config: &SessionLoggingConfig,
    _output_writer: Box<dyn Write + Send>,
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

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(
        enabled: Option<bool>,
        append: Option<bool>,
        template: Option<&str>,
        max_mb: Option<u64>,
        line_fmt: Option<&str>,
    ) -> SessionLoggingConfig {
        SessionLoggingConfig {
            enabled,
            append,
            file_name_template: template.map(String::from),
            max_size_mb: max_mb,
            line_format: line_fmt.map(String::from),
        }
    }

    /// Build a unique temporary directory for a single test so concurrent
    /// runs do not collide. The directory is created eagerly; the test
    /// fixture leaves it behind for the OS to clean up.
    fn unique_temp_dir(label: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        let unique = format!(
            "xsterm-session-log-test-{}-{}-{}",
            label,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        dir.push(unique);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // ---- expand_template ----------------------------------------------------

    #[test]
    fn expand_template_substitutes_session_name_and_all_date_placeholders() {
        let expanded = expand_template("%n_%Y-%m-%d_%H-%M-%S.log", "my-shell");
        // The date portion is non-deterministic; assert that the session
        // name appears at the start and the suffix is present.
        assert!(expanded.starts_with("my-shell_"));
        assert!(expanded.ends_with(".log"));
        // All 6 date placeholders were replaced.
        for placeholder in ["%Y", "%m", "%d", "%H", "%M", "%S"] {
            assert!(
                !expanded.contains(placeholder),
                "{} should be replaced",
                placeholder
            );
        }
    }

    #[test]
    fn expand_template_preserves_unknown_placeholders() {
        let expanded = expand_template("%n-%x-%y", "session");
        assert_eq!(expanded, "session-%x-%y");
    }

    #[test]
    fn expand_template_empty_session_name_keeps_literal() {
        let expanded = expand_template("%n.log", "");
        // "%n" should be replaced with an empty string.
        assert!(!expanded.contains("%n"));
        assert!(expanded.ends_with(".log"));
    }

    // ---- SessionLog::new ----------------------------------------------------

    #[test]
    fn session_log_new_returns_err_when_disabled() {
        let cfg = cfg(Some(false), None, None, None, None);
        let result = SessionLog::new(Path::new("/tmp"), "session", &cfg);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Session logging is disabled");
    }

    #[test]
    fn session_log_new_returns_err_when_enabled_is_none() {
        let cfg = cfg(None, None, None, None, None);
        let result = SessionLog::new(Path::new("/tmp"), "session", &cfg);
        assert!(result.is_err());
    }

    #[test]
    fn session_log_new_uses_defaults_when_fields_absent() {
        let cfg = cfg(Some(true), None, None, None, None);
        let log = SessionLog::new(Path::new("/tmp"), "session", &cfg).unwrap();
        assert!(log.file_path.starts_with("/tmp/"));
        assert!(log.file_path.to_string_lossy().contains("session"));
        assert_eq!(log.max_size_bytes, DEFAULT_MAX_SIZE_MB * BYTES_PER_MB);
        assert!(log.append); // default true
        assert_eq!(log.line_format, DEFAULT_LINE_FORMAT);
    }

    #[test]
    fn session_log_new_respects_custom_template_and_size() {
        let cfg = cfg(Some(true), Some(false), Some("%n.log"), Some(5), Some("%v"));
        let log = SessionLog::new(Path::new("/tmp"), "alpha", &cfg).unwrap();
        assert!(log.file_path.ends_with("alpha.log"));
        assert_eq!(log.max_size_bytes, 5 * BYTES_PER_MB);
        assert!(!log.append);
        assert_eq!(log.line_format, "%v");
    }

    // ---- SessionLog::format_line -------------------------------------------

    #[test]
    fn session_log_format_line_substitutes_v_placeholder() {
        let cfg = cfg(
            Some(true),
            None,
            Some("%n.log"),
            None,
            Some("[%Y-%m-%d] %v"),
        );
        let log = SessionLog::new(Path::new("/tmp"), "s", &cfg).unwrap();
        let formatted = log.format_line("hello world");
        assert!(formatted.ends_with("hello world"));
        assert!(formatted.starts_with("["));
        assert!(!formatted.contains("%v"));
    }

    #[test]
    fn session_log_format_line_without_v_keeps_template_verbatim() {
        let cfg = cfg(Some(true), None, None, None, Some("RAW:"));
        let log = SessionLog::new(Path::new("/tmp"), "s", &cfg).unwrap();
        assert_eq!(log.format_line("payload"), "RAW:");
    }

    // ---- SessionLog::write_line --------------------------------------------

    #[test]
    fn session_log_write_line_appends_to_file() {
        let dir = unique_temp_dir("append");
        let cfg = cfg(Some(true), Some(true), Some("test.log"), None, None);
        let log = SessionLog::new(&dir, "session", &cfg).unwrap();

        log.write_line("first").unwrap();
        log.write_line("second").unwrap();

        let content = std::fs::read_to_string(&log.file_path).unwrap();
        assert!(content.contains("first"));
        assert!(content.contains("second"));
        // Two lines, both preserved because append=true.
        assert_eq!(content.lines().count(), 2);
    }

    #[test]
    fn session_log_write_line_truncates_when_append_false() {
        let dir = unique_temp_dir("trunc");
        let cfg = cfg(Some(true), Some(false), Some("trunc.log"), None, Some("%v"));
        let log = SessionLog::new(&dir, "session", &cfg).unwrap();

        log.write_line("alpha").unwrap();
        log.write_line("beta").unwrap();

        let content = std::fs::read_to_string(&log.file_path).unwrap();
        assert!(!content.contains("alpha"));
        assert!(content.contains("beta"));
    }

    #[test]
    fn session_log_write_line_triggers_rollover_at_max_size() {
        let dir = unique_temp_dir("roll");
        // max_size_mb=0 means 0 bytes cap; the first write will trigger
        // rollover on the second call.
        let cfg = cfg(
            Some(true),
            Some(false),
            Some("roll.log"),
            Some(0),
            Some("%v"),
        );
        let log = SessionLog::new(&dir, "session", &cfg).unwrap();

        log.write_line("first-chunk").unwrap();
        // The next write must not panic even if a rollover was attempted.
        log.write_line("second-chunk").unwrap();

        // At minimum, the latest line is in the active log.
        let content = std::fs::read_to_string(&log.file_path).unwrap();
        assert!(content.contains("second-chunk"));
    }

    // ---- start_session_logging ---------------------------------------------

    #[test]
    fn start_session_logging_returns_ok_when_disabled() {
        let cfg = cfg(Some(false), None, None, None, None);
        let writer: Box<dyn Write + Send> = Box::new(Vec::<u8>::new());
        let result = start_session_logging(42, &cfg, writer);
        assert!(result.is_ok());
    }

    #[test]
    fn start_session_logging_returns_ok_when_enabled() {
        let cfg = cfg(Some(true), Some(true), Some("%n.log"), Some(10), None);
        let writer: Box<dyn Write + Send> = Box::new(Vec::<u8>::new());
        let result = start_session_logging(7, &cfg, writer);
        assert!(result.is_ok());
    }

    #[test]
    fn start_session_logging_accepts_default_config() {
        let cfg = SessionLoggingConfig::default();
        let writer: Box<dyn Write + Send> = Box::new(Vec::<u8>::new());
        // With all-None config the function must short-circuit and return Ok.
        let result = start_session_logging(1, &cfg, writer);
        assert!(result.is_ok());
    }
}