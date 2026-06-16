use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};

use crate::models::session::SessionInfo;

pub trait PtySystem: Send {
    fn openpty(&self, size: PtySize) -> Result<Box<dyn PtyPair>, String>;
}

pub trait PtyPair: Send {
    fn spawn(&mut self, cmd: CommandBuilder) -> Result<Box<dyn Child>, String>;
    fn master_writer(&mut self) -> Result<Box<dyn Write + Send>, String>;
    fn master_reader(&mut self) -> Result<Box<dyn Read + Send>, String>;
    fn resize(&self, rows: u16, cols: u16) -> Result<(), String>;
}

pub trait Child: Send {
    #[allow(dead_code)]
    fn kill(self: Box<Self>) -> Result<(), String>;
}

pub struct NativePtySystem {
    inner: Box<dyn portable_pty::PtySystem + Send>,
}

impl NativePtySystem {
    pub fn new() -> Self {
        Self {
            inner: native_pty_system(),
        }
    }
}

impl PtySystem for NativePtySystem {
    fn openpty(&self, size: PtySize) -> Result<Box<dyn PtyPair>, String> {
        let pair = self.inner.openpty(size).map_err(|e| e.to_string())?;
        Ok(Box::new(NativePtyPair { inner: pair }))
    }
}

struct NativePtyPair {
    inner: portable_pty::PtyPair,
}

impl PtyPair for NativePtyPair {
    fn spawn(&mut self, cmd: CommandBuilder) -> Result<Box<dyn Child>, String> {
        let child = self
            .inner
            .slave
            .spawn_command(cmd)
            .map_err(|e| e.to_string())?;
        Ok(Box::new(NativeChild { inner: child }))
    }

    fn master_writer(&mut self) -> Result<Box<dyn Write + Send>, String> {
        self.inner.master.take_writer().map_err(|e| e.to_string())
    }

    fn master_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        self.inner
            .master
            .try_clone_reader()
            .map_err(|e| e.to_string())
    }

    fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        self.inner
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }
}

pub struct NativeChild {
    #[allow(dead_code)]
    inner: Box<dyn portable_pty::Child + Send>,
}

impl Child for NativeChild {
    fn kill(mut self: Box<Self>) -> Result<(), String> {
        self.inner.kill().map_err(|e| e.to_string())
    }
}

/// Local session data structure
pub struct LocalSession {
    pub info: SessionInfo,
    pub writer: Box<dyn Write + Send>,
}

pub struct LocalSessionHandles {
    #[allow(dead_code)]
    pub child: Box<dyn Child>,
    /// Keep the PTY pair alive — on Windows, dropping the pair calls
    /// ClosePseudoConsole which destroys the ConPTY and kills the session.
    pub _pair: Box<dyn PtyPair>,
}

impl LocalSessionHandles {
    pub fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        self._pair.resize(rows, cols)
    }
}
