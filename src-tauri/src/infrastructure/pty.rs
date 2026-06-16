use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};

use crate::error::StringError;
use crate::models::session::SessionInfo;

/// Default terminal dimensions used when no explicit size is provided.
const DEFAULT_ROWS: u16 = 24;
const DEFAULT_COLS: u16 = 80;

/// Abstraction over a PTY system that can allocate pseudo-terminal pairs.
pub trait PtySystem: Send {
    fn openpty(&self, size: PtySize) -> Result<Box<dyn PtyPair>, String>;
}

/// A pair of master/slave PTY endpoints.
pub trait PtyPair: Send {
    fn spawn(&mut self, cmd: CommandBuilder) -> Result<Box<dyn Child>, String>;
    fn master_writer(&mut self) -> Result<Box<dyn Write + Send>, String>;
    fn master_reader(&mut self) -> Result<Box<dyn Read + Send>, String>;
    fn resize(&self, rows: u16, cols: u16) -> Result<(), String>;
}

/// A spawned child process attached to a PTY.
pub trait Child: Send {
    /// Terminate the child process.
    ///
    /// Currently unused directly, but part of the abstraction API.
    #[allow(dead_code)]
    fn kill(self: Box<Self>) -> Result<(), String>;
}

/// Platform-native PTY system implementation backed by `portable-pty`.
pub struct NativePtySystem {
    inner: Box<dyn portable_pty::PtySystem + Send>,
}

impl NativePtySystem {
    /// Create a new native PTY system.
    pub fn new() -> Self {
        Self { inner: native_pty_system() }
    }
}

impl PtySystem for NativePtySystem {
    fn openpty(&self, size: PtySize) -> Result<Box<dyn PtyPair>, String> {
        let pair = self.inner.openpty(size).map_err_string()?;
        Ok(Box::new(NativePtyPair { inner: pair }))
    }
}

struct NativePtyPair {
    inner: portable_pty::PtyPair,
}

impl PtyPair for NativePtyPair {
    fn spawn(&mut self, cmd: CommandBuilder) -> Result<Box<dyn Child>, String> {
        let child = self.inner.slave.spawn_command(cmd).map_err_string()?;
        Ok(Box::new(NativeChild { inner: child }))
    }

    fn master_writer(&mut self) -> Result<Box<dyn Write + Send>, String> {
        self.inner.master.take_writer().map_err_string()
    }

    fn master_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        self.inner.master.try_clone_reader().map_err_string()
    }

    fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        self.inner.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err_string()
    }
}

pub struct NativeChild {
    /// The underlying child process. Kept alive to keep the process running.
    #[allow(dead_code)]
    inner: Box<dyn portable_pty::Child + Send>,
}

impl Child for NativeChild {
    fn kill(mut self: Box<Self>) -> Result<(), String> {
        self.inner.kill().map_err_string()
    }
}

/// Local session data, holding its metadata and a handle to write input.
pub struct LocalSession {
    pub info: SessionInfo,
    pub writer: Box<dyn Write + Send>,
}

/// Handles that must be kept alive for the lifetime of a local session.
pub struct LocalSessionHandles {
    /// The spawned child process. Kept alive to keep the session running.
    #[allow(dead_code)]
    pub child: Box<dyn Child>,
    /// Keep the PTY pair alive — on Windows, dropping the pair calls
    /// `ClosePseudoConsole` which destroys the ConPTY and kills the session.
    pub _pair: Box<dyn PtyPair>,
}

impl LocalSessionHandles {
    /// Resize the underlying PTY to the requested dimensions.
    pub fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        self._pair.resize(rows, cols)
    }
}

/// Helper to build a default [`PtySize`].
pub(crate) fn default_pty_size() -> PtySize {
    PtySize {
        rows: DEFAULT_ROWS,
        cols: DEFAULT_COLS,
        pixel_width: 0,
        pixel_height: 0,
    }
}
