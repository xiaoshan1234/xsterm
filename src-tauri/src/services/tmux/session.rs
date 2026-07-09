use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::infrastructure::pty::{Child, PtyPair};
use crate::infrastructure::ssh::SshChannel;
use crate::models::session::SessionInfo;
use crate::services::tmux::channel_io::CapturePaneQueue;

pub mod local;
pub mod ssh;

/// Handles that must be kept alive for the lifetime of a tmux control session.
///
/// For local sessions this holds the child process and PTY pair. For SSH
/// sessions this holds the channel handle and the forwarder thread.
pub struct TmuxSessionHandles {
    /// The spawned child process for local PTY-backed sessions.
    pub child: Mutex<Option<Arc<Mutex<Option<Box<dyn Child>>>>>>,
    /// The forwarder thread that reads and dispatches tmux control messages.
    pub forwarder: Option<std::thread::JoinHandle<()>>,
    /// Keep the PTY pair alive — on Windows, dropping the pair destroys the
    /// ConPTY and kills the session.
    pub _pair: Option<Box<dyn PtyPair>>,
    /// Keep the SSH channel handle alive for SSH-backed sessions.
    pub _channel: Option<Box<dyn SshChannel + Send>>,
}

/// A handle to an active tmux `-CC` control session.
///
/// The handle is cloneable through the shared writer and can be used to write
/// commands to tmux's stdin. The `exited` flag is set by the forwarder thread
/// when the session ends.
pub struct TmuxSession {
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub exited: Arc<AtomicBool>,
    pub capture_queue: CapturePaneQueue,
    pub info: SessionInfo,
    /// Handles that must remain alive for the duration of the session.
    pub handles: TmuxSessionHandles,
}

impl TmuxSession {
    /// Write a raw tmux command string to the session's stdin.
    ///
    /// The command should already include a trailing newline if required by the
    /// tmux protocol.
    pub fn write_command(&self, command: &str) -> Result<(), String> {
        let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
        writer
            .write_all(command.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())
    }

    /// Queue a `capture-pane` request for the given pane.
    ///
    /// The pane id is pushed onto the capture queue so that the parser can
    /// correlate the upcoming command response with the correct pane. The
    /// capture command is then sent to tmux.
    pub fn request_capture_pane(&self, pane_id: &str, history: usize) -> Result<(), String> {
        {
            let mut queue = self.capture_queue.lock().map_err(|e| e.to_string())?;
            queue.push_back(pane_id.to_string());
        }

        let command = crate::services::tmux::commands::capture_pane(pane_id, history);
        self.write_command(&command)
    }

    /// Return whether the forwarder has marked the session as exited.
    pub fn is_exited(&self) -> bool {
        self.exited.load(Ordering::Relaxed)
    }

    /// Kill the local child process backing this session and signal the
    /// control-mode forwarder to exit.
    pub fn close(&self) -> Result<(), String> {
        self.exited.store(true, Ordering::Relaxed);

        let mut guard = self.handles.child.lock().map_err(|e| e.to_string())?;
        let child_arc = guard.take();
        drop(guard);

        if let Some(child_arc) = child_arc {
            let mut inner = child_arc.lock().map_err(|e| e.to_string())?;
            if let Some(child) = inner.take() {
                child.kill().map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
}

