//! Per-session output logging.
//!
//! Writes the terminal's `session-output` byte stream to per-session files
//! under `session-logs/`. The fan-out happens centrally in
//! [`SessionLoggingBackend`], which wraps any [`AppBackend`] and taps the
//! `session-output` event before forwarding it. Session logging defaults to
//! disabled; only sessions whose [`SessionLoggingConfig::enabled`] is `true`
//! get a writer, so the tap is a single `DashMap` lookup for everyone else.

use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use chrono::Local;
use dashmap::DashMap;

use crate::error::StringError;
use crate::infrastructure::app_backend::AppBackend;
use crate::models::session::SessionLoggingConfig;

/// Default timestamp format rendered by `{{ts}}`.
const DEFAULT_TIMESTAMP_FORMAT: &str = "%Y-%m-%d %H:%M:%S";
/// Default maximum file size in MB when the config does not specify one.
const DEFAULT_MAX_SIZE_MB: u64 = 10;
const BYTES_PER_MB: u64 = 1024 * 1024;

/// Normalised, defaulted view over a [`SessionLoggingConfig`].
struct ResolvedLogConfig {
    append: bool,
    file_name_template: String,
    max_size_mb: u64,
    line_format: String,
}

impl From<&SessionLoggingConfig> for ResolvedLogConfig {
    fn from(config: &SessionLoggingConfig) -> Self {
        Self {
            append: config.append.unwrap_or(true),
            file_name_template: config
                .file_name_template
                .clone()
                .unwrap_or_else(|| "{{name}}_{{ts:%Y-%m-%d_%H-%M-%S}}.log".to_string()),
            max_size_mb: config.max_size_mb.unwrap_or(DEFAULT_MAX_SIZE_MB),
            line_format: config
                .line_format
                .clone()
                .unwrap_or_else(|| "[{{ts}}] {{line}}".to_string()),
        }
    }
}

/// Render a `{{...}}` template. `line` is only meaningful for `{{line}}`.
fn render_template(
    template: &str,
    session_name: &str,
    session_id: u32,
    line: Option<&str>,
) -> String {
    let mut output = String::new();
    let mut rest = template;

    while let Some(start) = rest.find("{{") {
        output.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            output.push_str(&rest[start..]);
            rest = "";
            break;
        };
        let token = &after[..end];
        output.push_str(&render_token(token, session_name, session_id, line));
        rest = &after[end + 2..];
    }

    output.push_str(rest);
    output
}

fn render_token(token: &str, session_name: &str, session_id: u32, line: Option<&str>) -> String {
    if let Some(format) = token.strip_prefix("ts:") {
        return Local::now().format(format).to_string();
    }
    match token {
        "ts" => Local::now().format(DEFAULT_TIMESTAMP_FORMAT).to_string(),
        "name" => session_name.to_string(),
        "id" => session_id.to_string(),
        "line" => line.unwrap_or_default().to_string(),
        _ => format!("{{{{{token}}}}}"),
    }
}

/// Replace characters that are illegal in a Windows file name with `_`.
fn sanitize_file_name(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '\0' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect()
}

/// A single session's on-disk log writer.
struct SessionLogWriter {
    file: BufWriter<File>,
    base_path: PathBuf,
    rotation_index: u32,
    max_size_bytes: u64,
    bytes_written: u64,
    line_format: String,
    pending: Vec<u8>,
    session_name: String,
    session_id: u32,
}

impl SessionLogWriter {
    fn open(
        base_dir: &Path,
        session_name: &str,
        session_id: u32,
        config: &ResolvedLogConfig,
    ) -> Result<Self, String> {
        fs::create_dir_all(base_dir).map_err_string()?;

        let rendered_name =
            render_template(&config.file_name_template, session_name, session_id, None);
        let base_path = base_dir.join(sanitize_file_name(&rendered_name));
        let (file, bytes_written) = open_target(&base_path, config.append)?;

        Ok(Self {
            file,
            base_path,
            rotation_index: 0,
            max_size_bytes: config.max_size_mb.saturating_mul(BYTES_PER_MB),
            bytes_written,
            line_format: config.line_format.clone(),
            pending: Vec::new(),
            session_name: session_name.to_string(),
            session_id,
        })
    }

    fn write(&mut self, data: &[u8]) {
        self.pending.extend_from_slice(data);
        self.flush_complete_lines();
    }

    fn flush_complete_lines(&mut self) {
        loop {
            let Some(newline_pos) = self.pending.iter().position(|&b| b == b'\n') else {
                break;
            };
            let mut line: Vec<u8> = self.pending.drain(..=newline_pos).collect();
            line.pop(); // drop '\n'
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            let rendered = self.render_line(&line);
            let mut out = rendered.into_bytes();
            out.push(b'\n');
            if self.write_raw(&out).is_err() {
                break;
            }
        }
    }

    fn render_line(&self, line: &[u8]) -> String {
        let line_text = String::from_utf8_lossy(line);
        render_template(
            &self.line_format,
            &self.session_name,
            self.session_id,
            Some(&line_text),
        )
    }

    fn write_raw(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        if self.needs_rotation(bytes.len()) {
            self.rotate()?;
        }
        self.file.write_all(bytes)?;
        self.bytes_written += bytes.len() as u64;
        Ok(())
    }

    fn needs_rotation(&self, incoming: usize) -> bool {
        self.max_size_bytes > 0
            && self.bytes_written.saturating_add(incoming as u64) > self.max_size_bytes
    }

    fn rotate(&mut self) -> std::io::Result<()> {
        self.file.flush()?;
        self.rotation_index += 1;
        let (file, bytes_written) = open_target(&self.suffixed_path(), false)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        self.file = file;
        self.bytes_written = bytes_written;
        Ok(())
    }

    fn suffixed_path(&self) -> PathBuf {
        let index = self.rotation_index;
        if index == 0 {
            return self.base_path.clone();
        }
        let stem = self
            .base_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("log");
        let ext = self.base_path.extension().and_then(|s| s.to_str());
        let mut name = format!("{stem}.{index}");
        if let Some(ext) = ext {
            name.push('.');
            name.push_str(ext);
        }
        self.base_path.with_file_name(name)
    }

    fn flush_pending(&mut self) {
        if !self.pending.is_empty() {
            let pending = std::mem::take(&mut self.pending);
            let rendered = self.render_line(&pending);
            let mut out = rendered.into_bytes();
            out.push(b'\n');
            let _ = self.write_raw(&out);
        }
        let _ = self.file.flush();
    }
}

fn open_target(path: &Path, append: bool) -> Result<(BufWriter<File>, u64), String> {
    let exists = path.exists();
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append)
        .open(path)
        .map_err_string()?;
    let bytes_written = if append && exists {
        file.metadata().map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };
    Ok((BufWriter::new(file), bytes_written))
}

/// Registry of per-session log writers.
pub struct SessionLogRegistry {
    base_dir: PathBuf,
    writers: DashMap<u32, Arc<Mutex<SessionLogWriter>>>,
}

impl SessionLogRegistry {
    pub fn new(base_dir: PathBuf) -> Self {
        Self {
            base_dir,
            writers: DashMap::new(),
        }
    }

    pub fn start(
        &self,
        session_id: u32,
        config: &SessionLoggingConfig,
        session_name: &str,
    ) -> Result<(), String> {
        if !config.enabled.unwrap_or(false) {
            return Ok(());
        }
        let resolved = ResolvedLogConfig::from(config);
        let writer = SessionLogWriter::open(&self.base_dir, session_name, session_id, &resolved)?;
        self.writers
            .insert(session_id, Arc::new(Mutex::new(writer)));
        Ok(())
    }

    pub fn is_enabled(&self, session_id: u32) -> bool {
        self.writers.contains_key(&session_id)
    }

    pub fn write(&self, session_id: u32, data: &[u8]) {
        let Some(writer) = self.writers.get(&session_id) else {
            return;
        };
        let poisoned = match writer.lock() {
            Ok(mut guard) => {
                guard.write(data);
                false
            }
            Err(_) => true,
        };
        if poisoned {
            tracing::warn!(
                "Session log writer lock poisoned for session {}",
                session_id
            );
            drop(writer);
            self.writers.remove(&session_id);
        }
    }

    pub fn stop(&self, session_id: u32) {
        if let Some((_, writer)) = self.writers.remove(&session_id) {
            if let Ok(mut guard) = writer.lock() {
                guard.flush_pending();
            }
        }
    }
}

/// [`AppBackend`] decorator that fans `session-output` out to the session log.
pub struct SessionLoggingBackend {
    inner: Arc<dyn AppBackend>,
    logs: Arc<SessionLogRegistry>,
}

impl SessionLoggingBackend {
    pub fn new(inner: Arc<dyn AppBackend>, logs: Arc<SessionLogRegistry>) -> Self {
        Self { inner, logs }
    }

    fn tap_session_output(&self, payload: &serde_json::Value) {
        let Some(session_id) = payload.get(0).and_then(|value| value.as_u64()) else {
            return;
        };
        let session_id = session_id as u32;
        if !self.logs.is_enabled(session_id) {
            return;
        }
        let Some(data) = extract_output_bytes(payload.get(1)) else {
            return;
        };
        self.logs.write(session_id, &data);
    }
}

impl AppBackend for SessionLoggingBackend {
    fn emit(&self, event: &str, payload: &serde_json::Value) -> Result<(), String> {
        if event == "session-output" {
            self.tap_session_output(payload);
        }
        self.inner.emit(event, payload)
    }

    fn emit_binary(&self, bytes: Vec<u8>) -> Result<(), String> {
        self.inner.emit_binary(bytes)
    }

    fn spawn(&self, f: Box<dyn FnOnce() + Send>) {
        self.inner.spawn(f)
    }
}

/// Parse `[u8, u8, ...]` back out of a `session-output` JSON payload.
fn extract_output_bytes(value: Option<&serde_json::Value>) -> Option<Vec<u8>> {
    let bytes = value?.as_array()?;
    let mut output = Vec::with_capacity(bytes.len());
    for item in bytes {
        let byte = item.as_u64()?;
        if byte > 255 {
            return None;
        }
        output.push(byte as u8);
    }
    Some(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn logging_config(enabled: bool) -> SessionLoggingConfig {
        SessionLoggingConfig {
            enabled: Some(enabled),
            append: Some(false),
            file_name_template: Some("{{name}}-{{id}}.log".to_string()),
            max_size_mb: Some(0),
            line_format: Some("[{{ts}}] {{line}}".to_string()),
        }
    }

    #[test]
    fn render_template_replaces_supported_tokens() {
        let rendered = render_template(
            "{{name}}/{{id}}/{{ts:fixed}}/{{line}}",
            "shell",
            7,
            Some("payload"),
        );
        assert_eq!(rendered, "shell/7/fixed/payload");
    }

    #[test]
    fn render_template_keeps_unknown_tokens_verbatim() {
        assert_eq!(render_template("{{unknown}}", "n", 1, None), "{{unknown}}");
    }

    #[test]
    fn render_template_handles_missing_closing_braces() {
        assert_eq!(render_template("a {{name b", "n", 1, None), "a {{name b");
    }

    #[test]
    fn sanitize_file_name_replaces_windows_illegal_chars() {
        assert_eq!(
            sanitize_file_name("a:b/c\\d*e?f<g>h|i"),
            "a_b_c_d_e_f_g_h_i"
        );
    }

    #[test]
    fn registry_writes_lines_and_flushes_on_stop() {
        let dir = std::env::temp_dir().join(format!("xsterm-slog-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        let registry = SessionLogRegistry::new(dir.clone());
        let config = logging_config(true);
        registry.start(42, &config, "main").unwrap();
        registry.write(42, b"hello\nworld");
        registry.stop(42);

        let entries: Vec<_> = std::fs::read_dir(&dir).unwrap().collect();
        assert_eq!(entries.len(), 1);
        let path = entries[0].as_ref().unwrap().path();
        let content = std::fs::read_to_string(path).unwrap();
        assert!(content.contains("hello"));
        assert!(content.contains("world"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn start_does_not_create_writer_when_disabled() {
        let dir = std::env::temp_dir().join(format!("xsterm-slog-off-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        let registry = SessionLogRegistry::new(dir.clone());
        let config = logging_config(false);
        registry.start(9, &config, "main").unwrap();
        assert!(!registry.is_enabled(9));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
