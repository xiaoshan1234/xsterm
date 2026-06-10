use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};

use crate::session::{AppBackend, LocalSessionConfig, SessionInfo, SessionType};

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

    fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        self.inner.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| e.to_string())
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
    _pair: Box<dyn PtyPair>,
}

impl LocalSessionHandles {
    pub fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        self._pair.resize(rows, cols)
    }
}

pub fn create_local_session(
    pty_system: &dyn PtySystem,
    config: LocalSessionConfig,
    backend: impl AppBackend + 'static,
    session_id: u32,
) -> Result<(LocalSession, LocalSessionHandles), String> {
    let shell_path = config.shell.unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            "powershell.exe".to_string()
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
        }
    });

    let (shell_exe, shell_extra_args) = shell_path
        .split_once(' ')
        .map(|(exe, rest)| (exe.to_string(), rest.split_whitespace().map(String::from).collect::<Vec<String>>()))
        .unwrap_or((shell_path.clone(), Vec::new()));

    let shell_name = shell_exe
        .split(&['/', '\\'][..])
        .last()
        .unwrap_or(&shell_exe)
        .to_string();

    let cwd = config.cwd.unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            std::env::var("USERPROFILE")
                .or_else(|_: std::env::VarError| {
                    let drive = std::env::var("HOMEDRIVE").unwrap_or_else(|_| "C:".to_string());
                    let path = std::env::var("HOMEPATH").unwrap_or_else(|_| "\\Users\\Default".to_string());
                    Ok(format!("{}{}", drive, path))
                })
                .unwrap_or_else(|_: std::env::VarError| "C:\\".to_string())
        } else {
            std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
        }
    });

    let mut pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(&shell_exe);

    for arg in &shell_extra_args {
        cmd.arg(arg);
    }

    if shell_name.contains("powershell") || shell_name.contains("pwsh") {
        cmd.arg("-NoLogo");
    } else if shell_name == "bash" && !cfg!(target_os = "windows") {
        cmd.arg("--login");
    }

    cmd.cwd(&cwd);

    let child = pair.spawn(cmd).map_err(|e| e.to_string())?;
    let writer = pair.master_writer().map_err(|e| e.to_string())?;
    let reader = pair.master_reader().map_err(|e| e.to_string())?;

    let name = format!("Local ({})", shell_name);
    let shell_for_info = shell_path.clone();
    let cwd_for_info = cwd.clone();

    let info = SessionInfo {
        id: session_id,
        name,
        session_type: SessionType::Local { shell: shell_for_info, cwd: cwd_for_info },
        is_connected: true,
    };

    let backend_clone = backend.clone();
    backend.spawn(Box::new(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        loop {
            if let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    let payload = serde_json::to_vec(&session_id).unwrap();
                    let _ = backend_clone.emit("session-closed", &payload);
                    break;
                }
                let data = buf[..n].to_vec();
                let payload = serde_json::to_vec(&(&session_id, &data[..])).unwrap();
                if let Err(e) = backend_clone.emit("session-output", &payload) {
                    eprintln!("Failed to emit: {}", e);
                    break;
                }
            }
        }
    }));

    let handles = LocalSessionHandles { child, _pair: pair };

    Ok((LocalSession { info, writer }, handles))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_pty_system_openpty_returns_pty_pair() {
        let system = NativePtySystem::new();
        let result = system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        });
        assert!(result.is_ok());
    }
}
