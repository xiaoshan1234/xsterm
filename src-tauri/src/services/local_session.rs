use std::io::Read;

use portable_pty::PtySize;

use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::{LocalSession, LocalSessionHandles, PtySystem};
use crate::models::session::{LocalSessionConfig, SessionInfo, SessionType};

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
        .map(|(exe, rest)| {
            (
                exe.to_string(),
                rest.split_whitespace()
                    .map(String::from)
                    .collect::<Vec<String>>(),
            )
        })
        .unwrap_or((shell_path.clone(), Vec::new()));

    let shell_name = shell_exe
        .split(&['/', '\\'][..])
        .last()
        .unwrap_or(&shell_exe)
        .to_string();

    let is_wsl =
        shell_name.eq_ignore_ascii_case("wsl") || shell_name.eq_ignore_ascii_case("wsl.exe");

    let cwd = config.cwd.unwrap_or_else(|| {
        if is_wsl {
            "~".to_string()
        } else if cfg!(target_os = "windows") {
            std::env::var("USERPROFILE")
                .or_else(|_: std::env::VarError| {
                    let drive = std::env::var("HOMEDRIVE").unwrap_or_else(|_| "C:".to_string());
                    let path = std::env::var("HOMEPATH")
                        .unwrap_or_else(|_| "\\Users\\Default".to_string());
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

    let mut cmd = portable_pty::CommandBuilder::new(&shell_exe);

    for arg in &shell_extra_args {
        cmd.arg(arg);
    }

    if shell_name.contains("powershell") || shell_name.contains("pwsh") {
        cmd.arg("-NoLogo");
    } else if shell_name == "bash" && !cfg!(target_os = "windows") {
        cmd.arg("--login");
    }

    if is_wsl {
        cmd.arg("--cd");
        cmd.arg(&cwd);
    } else {
        cmd.cwd(&cwd);
    }

    let child = pair.spawn(cmd).map_err(|e| e.to_string())?;
    let writer = pair.master_writer().map_err(|e| e.to_string())?;
    let reader = pair.master_reader().map_err(|e| e.to_string())?;

    let info = SessionInfo {
        id: session_id,
        name: format!("Local ({})", shell_name),
        session_type: SessionType::Local {
            shell: shell_path,
            cwd,
        },
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
