use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Helper that writes incoming session output to an auto-log file.
///
/// If `auto_log_path` is empty, no file is opened and [`Self::append`] is a no-op.
/// Errors during file creation or writes are logged with `tracing::warn!` and do
/// not interrupt the session.
pub struct SessionLog {
    file: Option<File>,
}

impl SessionLog {
    /// Create a new log writer for the given base path.
    ///
    /// The actual file path is derived from `auto_log_path` with a Unix timestamp
    /// suffix so repeated sessions do not overwrite the same file.
    pub fn new(auto_log_path: &str) -> Self {
        if auto_log_path.is_empty() {
            return Self { file: None };
        }

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let path = timestamped_log_path(auto_log_path, timestamp);

        match OpenOptions::new()
            .append(true)
            .create(true)
            .open(&path)
        {
            Ok(file) => Self { file: Some(file) },
            Err(e) => {
                tracing::warn!("Failed to open auto-log file {}: {}", path, e);
                Self { file: None }
            }
        }
    }

    /// Append bytes to the log file, if one was successfully opened.
    pub fn append(&mut self, data: &[u8]) {
        if let Some(file) = &mut self.file {
            if let Err(e) = file.write_all(data).and_then(|_| file.flush()) {
                tracing::warn!("Failed to write to auto-log file: {}", e);
            }
        }
    }
}

/// Build a timestamped log path from the configured base path.
fn timestamped_log_path(base: &str, timestamp: u64) -> String {
    let path = Path::new(base);
    match path.extension().and_then(|e| e.to_str()) {
        Some("log") => {
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(base);
            if let Some(parent) = path.parent().and_then(|p| p.to_str()).filter(|p| !p.is_empty()) {
                format!("{}/{}_{}.log", parent, stem, timestamp)
            } else {
                format!("{}_{}.log", stem, timestamp)
            }
        }
        _ => format!("{}_{}.log", base, timestamp),
    }
}

#[cfg(test)]
mod tests {
    use super::timestamped_log_path;
    use super::SessionLog;

    #[test]
    fn timestamped_log_path_appends_to_plain_base() {
        assert_eq!(timestamped_log_path("/tmp/session", 123), "/tmp/session_123.log");
    }

    #[test]
    fn timestamped_log_path_inserts_before_log_extension() {
        assert_eq!(timestamped_log_path("/tmp/session.log", 456), "/tmp/session_456.log");
    }

    #[test]
    fn timestamped_log_path_handles_relative_log_file() {
        assert_eq!(timestamped_log_path("session.log", 789), "session_789.log");
    }

    #[test]
    fn session_log_new_with_empty_path_does_not_create_file() {
        let mut log = SessionLog::new("");
        log.append(b"should not be written");
    }

    #[test]
    fn session_log_writes_to_timestamped_file() {
        let temp_dir = std::env::temp_dir();
        let base_name = format!("xsterm_session_log_test_{}", std::process::id());
        let base = temp_dir.join(&base_name);
        let base_path = base.to_string_lossy().to_string();

        {
            let mut log = SessionLog::new(&base_path);
            log.append(b"hello\n");
            log.append(b"world\n");
        }

        let mut found_file: Option<std::path::PathBuf> = None;
        for entry in std::fs::read_dir(&temp_dir).unwrap() {
            let path = entry.unwrap().path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with(&base_name) && name.ends_with(".log") {
                    found_file = Some(path);
                    break;
                }
            }
        }

        let path = found_file.expect("Expected a timestamped log file to be created");
        let contents = std::fs::read_to_string(&path).unwrap();
        assert_eq!(contents, "hello\nworld\n");
        std::fs::remove_file(&path).ok();
    }
}
