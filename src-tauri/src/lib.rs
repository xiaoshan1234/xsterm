use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, State};

struct PtyState {
    writer: Option<Box<dyn Write + Send>>,
}

impl Default for PtyState {
    fn default() -> Self {
        Self { writer: None }
    }
}

#[tauri::command]
fn spawn_terminal(
    rows: u16,
    cols: u16,
    state: State<'_, Mutex<PtyState>>,
    app: AppHandle,
) -> Result<(), String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = if cfg!(target_os = "windows") {
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.args(["-NoLogo", "-NoProfile"]);
        cmd
    } else {
        let mut cmd = CommandBuilder::new("/bin/bash");
        cmd.arg("--login");
        cmd
    };

    let child = pair.slave.spawn_command(shell).map_err(|e| e.to_string())?;

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    {
        let mut state_guard = state.lock().map_err(|e| e.to_string())?;
        state_guard.writer = Some(writer);
    }

    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            if let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let data = buf[..n].to_vec();
                if let Err(e) = app.emit("terminal-data", data) {
                    eprintln!("Failed to emit: {}", e);
                    break;
                }
            }
        }
    });

    let _ = child;
    Ok(())
}

#[tauri::command]
fn write_terminal(data: Vec<u8>, state: State<'_, Mutex<PtyState>>) -> Result<(), String> {
    let mut state_guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut writer) = state_guard.writer {
        writer
            .write_all(&data)
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn resize_terminal(_rows: u16, _cols: u16) -> Result<(), String> {
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(PtyState::default()))
        .invoke_handler(tauri::generate_handler![
            spawn_terminal,
            write_terminal,
            resize_terminal
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}