use std::io::{Read, Write};
use std::sync::{mpsc as sync_mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tokio::sync::mpsc;

use crate::infrastructure::pty::{LocalSessionHandles, PtySystem};
use crate::infrastructure::ssh::{SshBackend, SshChannel};
use crate::models::session::{LocalSessionConfig, SSHSessionConfig, SessionInfo};
use crate::services::local_session::create_local_underlay_session;
use crate::services::ssh_session::create_ssh_underlay_session;

/// A unified local or SSH session used as the underlay for tmux commands.
pub struct UnderlaySession {
    pub info: SessionInfo,
    pub writer: Arc<Mutex<UnderlayWriter>>,
    pub reader: Arc<Mutex<UnderlayReader>>,
    _handles: Option<UnderlayHandles>,
}

enum UnderlayHandles {
    Local(LocalSessionHandles),
    Ssh {
        _channel: Arc<Mutex<Box<dyn SshChannel + Send>>>,
    },
}

impl UnderlaySession {
    /// Create a local PTY underlay session.
    pub fn create_local(
        pty_system: &dyn PtySystem,
        config: LocalSessionConfig,
        session_id: u32,
    ) -> Result<Self, String> {
        let (writer, reader, handles, info) =
            create_local_underlay_session(pty_system, config, session_id)?;
        Ok(Self {
            info,
            writer: Arc::new(Mutex::new(UnderlayWriter::Local(Arc::new(Mutex::new(writer))))),
            reader: Arc::new(Mutex::new(UnderlayReader::from_local_reader(reader))),
            _handles: Some(UnderlayHandles::Local(handles)),
        })
    }

    /// Create an SSH underlay session.
    pub fn create_ssh(
        ssh_backend: &dyn SshBackend,
        config: SSHSessionConfig,
        session_id: u32,
    ) -> Result<Self, String> {
        let ssh = create_ssh_underlay_session(ssh_backend, config, session_id)?;
        Ok(Self {
            info: ssh.info,
            writer: Arc::new(Mutex::new(UnderlayWriter::Ssh(ssh.write_tx))),
            reader: Arc::new(Mutex::new(UnderlayReader::from_ssh_receiver(ssh.read_rx))),
            _handles: Some(UnderlayHandles::Ssh {
                _channel: ssh._channel,
            }),
        })
    }

    /// Close the underlay session, killing the local child if present.
    pub fn close(self) -> Result<(), String> {
        if let Some(UnderlayHandles::Local(mut handles)) = self._handles {
            if let Some(child) = handles.child.take() {
                child.kill()?;
            }
        }
        Ok(())
    }
}

/// Writer for an underlay session, abstracting local PTY and SSH channels.
pub enum UnderlayWriter {
    Local(Arc<Mutex<Box<dyn Write + Send>>>),
    Ssh(mpsc::UnboundedSender<Vec<u8>>),
}

impl UnderlayWriter {
    /// Write a tmux command terminated with a newline and flush it.
    pub fn write_command(&self, command: &str) -> Result<(), String> {
        let data = format!("{}\n", command).into_bytes();
        tracing::info!("[tmux-debug] write_command: raw bytes={:?}", data);
        match self {
            UnderlayWriter::Local(writer) => {
                let mut writer = writer.lock().map_err(|e| e.to_string())?;
                writer.write_all(&data).map_err(|e| e.to_string())?;
                writer.flush().map_err(|e| e.to_string())?;
            }
            UnderlayWriter::Ssh(tx) => {
                tx.send(data)
                    .map_err(|_| "SSH channel closed".to_string())?;
            }
        }
        Ok(())
    }
}

/// Reader for an underlay session.
///
/// Both local and SSH variants are normalized to a channel receiver so the
/// poller can read with a timeout without blocking the main thread.
pub struct UnderlayReader {
    rx: sync_mpsc::Receiver<Option<Vec<u8>>>,
    _local_reader_thread: Option<thread::JoinHandle<()>>,
}

impl UnderlayReader {
    /// Wrap a local PTY reader in a forwarding thread.
    pub fn from_local_reader(mut reader: Box<dyn Read + Send>) -> Self {
        let (tx, rx) = sync_mpsc::channel();
        let handle = thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        let _ = tx.send(None);
                        break;
                    }
                    Ok(n) => {
                        if tx.send(Some(buf[..n].to_vec())).is_err() {
                            break;
                        }
                    }
                    Err(_) => {
                        let _ = tx.send(None);
                        break;
                    }
                }
            }
        });
        Self {
            rx,
            _local_reader_thread: Some(handle),
        }
    }

    /// Use an existing SSH read channel directly.
    pub fn from_ssh_receiver(rx: sync_mpsc::Receiver<Option<Vec<u8>>>) -> Self {
        Self {
            rx,
            _local_reader_thread: None,
        }
    }

    /// Read available output with a timeout.
    ///
    /// When `stop_on_idle` is `false`, the function collects data for
    /// `timeout_ms` and returns. When `stop_on_idle` is `true`, it keeps
    /// reading until no data arrives for `timeout_ms` milliseconds.
    pub fn read_with_timeout(
        &self,
        timeout_ms: u64,
        stop_on_idle: bool,
    ) -> Result<Vec<u8>, String> {
        let timeout = Duration::from_millis(timeout_ms);
        let start = Instant::now();
        let mut last_data = Instant::now();
        let mut result = Vec::new();

        loop {
            let elapsed = start.elapsed();
            let idle_elapsed = last_data.elapsed();

            if !stop_on_idle && elapsed >= timeout {
                break;
            }
            if stop_on_idle && !result.is_empty() && idle_elapsed >= timeout {
                break;
            }
            // Safety cap to avoid infinite loops when no data ever arrives.
            if stop_on_idle && elapsed >= timeout * 10 && result.is_empty() {
                break;
            }

            match self.rx.recv_timeout(Duration::from_millis(10)) {
                Ok(Some(data)) => {
                    result.extend(data);
                    last_data = Instant::now();
                }
                Ok(None) => {
                    return Err("Underlay channel closed".to_string());
                }
                Err(sync_mpsc::RecvTimeoutError::Timeout) => {
                    // Continue the loop so the timeout/idle checks run.
                }
                Err(e) => {
                    return Err(e.to_string());
                }
            }
        }

        Ok(result)
    }
}
