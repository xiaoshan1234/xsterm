use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};

// ============================================================================
// PTY System Traits and Implementations for local shell sessions
// ============================================================================

pub trait PtySystem: Send {
    fn openpty(&self, size: PtySize) -> Result<Box<dyn PtyPair>, String>;
}

pub trait PtyPair: Send {
    fn spawn(&mut self, cmd: CommandBuilder) -> Result<Box<dyn Child>, String>;
    fn master_writer(&mut self) -> Result<Box<dyn Write + Send>, String>;
    fn master_reader(&mut self) -> Result<Box<dyn Read + Send>, String>;
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
        let pair = self
            .inner
            .openpty(size)
            .map_err(|e| e.to_string())?;
        Ok(Box::new(NativePtyPair { inner: pair }))
    }
}

struct NativePtyPair {
    inner: portable_pty::PtyPair,
}

impl PtyPair for NativePtyPair {
    fn spawn(&mut self, cmd: CommandBuilder) -> Result<Box<dyn Child>, String> {
        let child = self.inner.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        Ok(Box::new(NativeChild { inner: child }))
    }

    fn master_writer(&mut self) -> Result<Box<dyn Write + Send>, String> {
        self.inner.master.take_writer().map_err(|e| e.to_string())
    }

    fn master_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        self.inner.master.try_clone_reader().map_err(|e| e.to_string())
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
    pub info: crate::session::SessionInfo,
    pub writer: Box<dyn Write + Send>,
}
