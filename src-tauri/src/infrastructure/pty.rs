//! Local PTY transport backed by the vendored `xscore` crate.
//!
//! The raw PTY / ConPTY plumbing (open, spawn, reader/writer threads, resize,
//! close) lives in `xscore::platform::LocalPty`. This module only adapts it to
//! the project's [`SessionBackend`] contract so [`SessionManager`] can treat a
//! local shell like any other session transport.
//!
//! [`SessionManager`]: crate::services::session_manager::SessionManager

use std::sync::Arc;

use portable_pty::PtySize;
use xscore::platform::{LocalPty, Size};

use crate::error::StringError;
use crate::infrastructure::session_backend::SessionBackend;
use crate::models::capabilities::CapabilityFlags;
use crate::models::session::SessionInfo;

/// Default terminal dimensions used when no explicit size is provided.
const DEFAULT_ROWS: u16 = 24;
const DEFAULT_COLS: u16 = 80;

/// Build a default [`PtySize`] for backends that still talk `portable-pty`
/// directly (e.g. the SSH transport).
pub(crate) fn default_pty_size() -> PtySize {
    PtySize {
        rows: DEFAULT_ROWS,
        cols: DEFAULT_COLS,
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Local session data: metadata plus a shared handle to the xscore PTY transport.
pub struct LocalSession {
    pub info: SessionInfo,
    pub capabilities: CapabilityFlags,
    pty: Arc<LocalPty>,
}

impl LocalSession {
    /// Wrap a spawned [`LocalPty`] as a [`SessionBackend`].
    pub fn new(info: SessionInfo, pty: Arc<LocalPty>) -> Self {
        Self {
            info,
            capabilities: CapabilityFlags::for_local(),
            pty,
        }
    }
}

impl SessionBackend for LocalSession {
    fn info(&self) -> &SessionInfo {
        &self.info
    }

    fn capabilities(&self) -> &CapabilityFlags {
        &self.capabilities
    }

    fn write(&self, data: &[u8]) -> Result<(), String> {
        self.pty.write(data).map_err_string()?;
        Ok(())
    }

    fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        self.pty.resize(Size::new(cols, rows)).map_err_string()
    }

    fn close(self: Box<Self>) -> Result<(), String> {
        self.pty.close().map_err_string()
    }
}
