#![cfg(target_os = "windows")]
//! Elevated local shell sessions (Windows "run as administrator").
//!
//! The shell runs inside the elevated `xsterm-elevated-helper.exe` process
//! with its own ConPTY (a non-elevated parent cannot hand its ConPTY to an
//! elevated child due to UIPI, and `ShellExecuteEx("runas")` gives no stdio
//! access to the child). This struct bridges the helper's named pipe into the
//! [`SessionBackend`] interface using the frame protocol from
//! [`crate::elevated_protocol`].

use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::os::windows::io::{AsRawHandle, FromRawHandle};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use windows::core::{HRESULT, PCWSTR};
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_PIPE_BUSY, GENERIC_READ, GENERIC_WRITE, HANDLE};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_NONE, OPEN_EXISTING,
};
use windows::Win32::System::IO::CancelIoEx;

use crate::elevated_protocol as proto;
use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::elevation::{spawn_elevated, to_wide};
use crate::infrastructure::session_backend::SessionBackend;
use crate::models::capabilities::CapabilityFlags;
use crate::models::session::{SessionInfo, SessionType};

const HELPER_FILE_NAME: &str = "xsterm-elevated-helper.exe";
/// How long to wait for the helper to create the pipe server after the UAC
/// prompt is accepted.
const PIPE_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const PIPE_CONNECT_RETRY_INTERVAL: Duration = Duration::from_millis(50);
/// Bound on how long `close` waits for the reader thread to shut down.
const READER_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);

/// A local shell session whose shell runs elevated (as administrator) inside
/// the helper process.
pub struct ElevatedSession {
    pub info: SessionInfo,
    pub capabilities: CapabilityFlags,
    pipe_name: String,
    /// Write side of the pipe (a duplicated handle); user input and resize
    /// frames are framed and sent through it.
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    /// Raw value of the pipe handle owned by the reader thread. Stored as
    /// `usize` because `HANDLE` is not `Send`; only used with `CancelIoEx`.
    reader_handle: usize,
    /// Set by `close` to tell the reader thread to stop.
    closed: Arc<AtomicBool>,
    /// Set by the reader thread once it has stopped using `reader_handle`.
    reader_done: Arc<AtomicBool>,
    helper_pid: u32,
}

impl ElevatedSession {
    /// Launch the elevated helper and attach to it over a named pipe.
    ///
    /// Blocks while the UAC consent prompt is shown. On success a reader
    /// thread is running that forwards helper output as `session-output`
    /// events (and emits `session-disconnected` when the shell exits or the
    /// helper dies).
    pub fn spawn(
        shell_exe: &str,
        args: &[String],
        cwd: &str,
        env: &HashMap<String, String>,
        term_type: Option<&str>,
        charset: Option<&str>,
        cols: u16,
        rows: u16,
        session_id: u32,
        backend: impl AppBackend + 'static,
    ) -> Result<Self, String> {
        let pipe_name = format!(r"\\.\pipe\xsterm-elevated-{}", session_id);
        let helper_path = get_helper_path()?;

        // TERM/LC_ALL travel as ordinary env vars, mirroring create_local_session.
        let mut effective_env = env.clone();
        if let Some(term_type) = term_type {
            effective_env.insert("TERM".to_string(), term_type.to_string());
        }
        if let Some(charset) = charset {
            effective_env.insert("LC_ALL".to_string(), charset.to_string());
        }

        let params = build_helper_params(&pipe_name, shell_exe, args, cwd, &effective_env, cols, rows);
        tracing::info!(
            "Starting elevated session {}: helper={} pipe={}",
            session_id,
            helper_path.display(),
            pipe_name
        );

        let helper_pid = spawn_elevated(
            helper_path
                .to_str()
                .ok_or_else(|| "elevated helper path is not valid UTF-8".to_string())?,
            &params,
        )?;

        let pipe = connect_pipe_client(&pipe_name)?;
        tracing::info!(
            "Elevated session {}: pipe connected successfully",
            session_id
        );
        let reader_file = pipe
            .try_clone()
            .map_err(|e| format!("failed to duplicate elevated pipe handle: {}", e))?;
        let reader_handle = reader_file.as_raw_handle() as usize;

        let closed = Arc::new(AtomicBool::new(false));
        let reader_done = Arc::new(AtomicBool::new(false));

        let reader_backend = backend.clone();
        let reader_closed = Arc::clone(&closed);
        let reader_done_flag = Arc::clone(&reader_done);
        backend.spawn(Box::new(move || {
            tracing::info!(
                "Reader thread started for elevated session {}",
                session_id
            );
            run_reader_loop(reader_file, reader_backend, session_id, reader_closed, reader_done_flag);
        }));

        let shell_name = shell_exe
            .split(['/', '\\'])
            .next_back()
            .unwrap_or(shell_exe)
            .trim_end_matches(".exe")
            .to_string();
        let info = SessionInfo {
            id: session_id,
            name: shell_name,
            session_type: SessionType::Local {
                shell: shell_exe.to_string(),
                cwd: cwd.to_string(),
            },
            is_connected: true,
            capabilities: CapabilityFlags::for_local(),
        };

        Ok(Self {
            info,
            capabilities: CapabilityFlags::for_local(),
            pipe_name,
            writer: Arc::new(Mutex::new(Box::new(pipe))),
            reader_handle,
            closed,
            reader_done,
            helper_pid,
        })
    }
}

impl SessionBackend for ElevatedSession {
    fn info(&self) -> &SessionInfo {
        &self.info
    }

    fn capabilities(&self) -> &CapabilityFlags {
        &self.capabilities
    }

    fn write(&mut self, data: &[u8]) -> Result<(), String> {
        tracing::debug!(
            "Elevated session {}: writing {} bytes to pipe",
            self.info.id,
            data.len()
        );
        let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
        proto::write_frame(&mut *writer, proto::MSG_WRITE, data)
            .map_err(|e| format!("write to elevated helper failed: {}", e))
            .map_err(|e| {
                tracing::error!(
                    "Elevated session {}: write to elevated helper failed: {}",
                    self.info.id,
                    e
                );
                e
            })
    }

    fn resize(&mut self, rows: u16, cols: u16) -> Result<(), String> {
        tracing::debug!(
            "Elevated session {}: resizing to {}x{}",
            self.info.id,
            rows,
            cols
        );
        let payload = proto::encode_resize_payload(rows, cols);
        let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
        proto::write_frame(&mut *writer, proto::MSG_RESIZE, &payload)
            .map_err(|e| format!("resize of elevated session failed: {}", e))
    }

    fn close(self: Box<Self>) -> Result<(), String> {
        tracing::debug!(
            "Closing elevated session {} (helper pid {}, pipe {})",
            self.info.id,
            self.helper_pid,
            self.pipe_name
        );
        self.closed.store(true, Ordering::SeqCst);

        // Abort the reader thread's pending pipe read and wait for it to stop
        // using its handle. Retrying CancelIoEx closes the race where the
        // thread issues a new read right after a previous cancel. Once both
        // pipe handles are closed the helper sees ERROR_BROKEN_PIPE, kills
        // the shell, and exits.
        let deadline = Instant::now() + READER_SHUTDOWN_TIMEOUT;
        while !self.reader_done.load(Ordering::SeqCst) {
            let _ = unsafe { CancelIoEx(HANDLE(self.reader_handle as *mut _), None) };
            if Instant::now() >= deadline {
                tracing::warn!(
                    "Elevated session {} reader thread did not stop within {:?}",
                    self.info.id,
                    READER_SHUTDOWN_TIMEOUT
                );
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        // `self.writer` drops here, closing the write-side handle.
        Ok(())
    }
}

/// Resolve the elevated helper executable.
///
/// In production the helper sits next to the main executable; in development
/// (`tauri dev`) fall back to the cargo debug target directory.
fn get_helper_path() -> Result<PathBuf, String> {
    let current_exe =
        std::env::current_exe().map_err(|e| format!("failed to resolve current exe path: {}", e))?;
    let dir = current_exe
        .parent()
        .ok_or_else(|| "current exe has no parent directory".to_string())?;
    let helper = dir.join(HELPER_FILE_NAME);
    if helper.exists() {
        return Ok(helper);
    }
    let dev_helper = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("debug")
        .join(HELPER_FILE_NAME);
    if dev_helper.exists() {
        return Ok(dev_helper);
    }
    // Return the canonical location so the error message points at the right path.
    Ok(helper)
}

fn build_helper_params(
    pipe_name: &str,
    shell_exe: &str,
    args: &[String],
    cwd: &str,
    env: &HashMap<String, String>,
    cols: u16,
    rows: u16,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    parts.push("--pipe-name".to_string());
    parts.push(proto::quote_windows_arg(pipe_name));
    parts.push("--shell-exe".to_string());
    parts.push(proto::quote_windows_arg(shell_exe));
    for arg in args {
        parts.push("--shell-arg".to_string());
        parts.push(proto::quote_windows_arg(arg));
    }
    parts.push("--cwd".to_string());
    parts.push(proto::quote_windows_arg(cwd));
    parts.push("--cols".to_string());
    parts.push(cols.to_string());
    parts.push("--rows".to_string());
    parts.push(rows.to_string());
    let mut env_pairs: Vec<(&String, &String)> = env.iter().collect();
    env_pairs.sort();
    for (key, value) in env_pairs {
        parts.push("--env".to_string());
        parts.push(proto::quote_windows_arg(&format!("{}={}", key, value)));
    }
    parts.join(" ")
}

/// Open the helper's named pipe as a client, retrying while the helper is
/// still starting up (it creates the server right after the UAC prompt).
fn connect_pipe_client(pipe_name: &str) -> Result<File, String> {
    let wide = to_wide(pipe_name);
    let deadline = Instant::now() + PIPE_CONNECT_TIMEOUT;
    loop {
        match unsafe {
            CreateFileW(
                PCWSTR(wide.as_ptr()),
                (GENERIC_READ | GENERIC_WRITE).0,
                FILE_SHARE_NONE,
                None,
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                HANDLE::default(),
            )
        } {
            Ok(handle) => return Ok(unsafe { File::from_raw_handle(handle.0) }),
            Err(e) => {
                let code = e.code();
                let retriable = code == HRESULT::from_win32(ERROR_FILE_NOT_FOUND.0)
                    || code == HRESULT::from_win32(ERROR_PIPE_BUSY.0);
                if retriable && Instant::now() < deadline {
                    std::thread::sleep(PIPE_CONNECT_RETRY_INTERVAL);
                    continue;
                }
                return Err(format!(
                    "failed to connect to elevated helper pipe {}: {}",
                    pipe_name, e
                ));
            }
        }
    }
}

/// Reader-thread entry point: forward framed helper output to the frontend.
fn run_reader_loop(
    mut reader: File,
    backend: impl AppBackend + 'static,
    session_id: u32,
    closed: Arc<AtomicBool>,
    done: Arc<AtomicBool>,
) {
    let notify_disconnect = reader_loop(&mut reader, &backend, session_id, &closed);
    if notify_disconnect && !closed.load(Ordering::SeqCst) {
        let _ = backend.emit("session-disconnected", &serde_json::json!(session_id));
    }
    // Drop our pipe handle before signalling done; once the writer handle is
    // also closed the helper sees the disconnect.
    drop(reader);
    done.store(true, Ordering::SeqCst);
}

/// Returns `true` when the frontend should be told the session disconnected
/// (as opposed to a user-initiated close).
fn reader_loop(
    reader: &mut File,
    backend: &impl AppBackend,
    session_id: u32,
    closed: &AtomicBool,
) -> bool {
    loop {
        if closed.load(Ordering::SeqCst) {
            tracing::debug!(
                "Reader loop: elevated session {} closed by user",
                session_id
            );
            return false;
        }
        match proto::read_frame(reader) {
            Ok(Some((proto::MSG_DATA, payload))) => {
                tracing::debug!(
                    "Elevated session {}: received {} bytes output from pipe",
                    session_id,
                    payload.len()
                );
                if let Err(e) = backend.emit("session-output", &serde_json::json!([session_id, payload])) {
                    tracing::error!("Failed to emit elevated session output: {}", e);
                    return true;
                }
            }
            Ok(Some((proto::MSG_EOF, _))) => {
                tracing::info!("Elevated shell exited for session {}", session_id);
                return true;
            }
            Ok(Some((msg_type, _))) => {
                tracing::warn!(
                    "Ignoring unknown frame type 0x{:02x} from elevated helper (session {})",
                    msg_type,
                    session_id
                );
            }
            Ok(None) => {
                tracing::info!("Elevated helper closed the pipe for session {}", session_id);
                return true;
            }
            Err(e) => {
                if closed.load(Ordering::SeqCst) {
                    tracing::debug!(
                        "Reader loop: pipe read error on closed elevated session {}: {}",
                        session_id,
                        e
                    );
                    return false;
                }
                tracing::error!("Pipe read error for elevated session {}: {}", session_id, e);
                return true;
            }
        }
    }
}
