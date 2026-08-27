//! Elevated helper binary for administrator shell sessions (Windows only).
//!
//! The main xsterm process cannot spawn an elevated shell directly:
//! `ShellExecuteEx("runas")` gives no stdio access to the child, and an
//! elevated child cannot inherit a ConPTY created by a non-elevated parent
//! (UIPI). The main process therefore launches this helper elevated; the
//! helper creates its own ConPTY + shell and bridges it to the main process
//! through a named pipe using [`xsterm_lib::elevated_protocol`].
//!
//! Lifecycle: the helper exits when either the shell exits (after sending an
//! EOF frame) or the main process disconnects. In the latter case exiting the
//! helper destroys the ConPTY, which terminates the shell.

// The parent launches this binary hidden (SW_HIDE); keep it windowless in
// release builds as well.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("xsterm-elevated-helper is only supported on Windows");
    std::process::exit(1);
}

#[cfg(target_os = "windows")]
fn main() {
    if let Err(e) = windows_main::run() {
        eprintln!("xsterm-elevated-helper: {}", e);
        std::process::exit(1);
    }
}

#[cfg(target_os = "windows")]
mod windows_main {
    use std::ffi::OsStr;
    use std::fs::File;
    use std::io::{Read, Write};
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::FromRawHandle;
    use std::sync::{Arc, Mutex};

    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use windows::core::{HRESULT, PCWSTR};
    use windows::Win32::Foundation::{
        GetLastError, BOOL, ERROR_PIPE_CONNECTED, INVALID_HANDLE_VALUE,
    };
    use windows::Win32::Security::{
        InitializeSecurityDescriptor, SetSecurityDescriptorDacl, PSECURITY_DESCRIPTOR,
        SECURITY_ATTRIBUTES, SECURITY_DESCRIPTOR,
    };
    use windows::Win32::Storage::FileSystem::PIPE_ACCESS_DUPLEX;
    use windows::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_TYPE_BYTE,
        PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
    };

    use xsterm_lib::elevated_protocol as proto;

    // Simple file logger for debugging pipe communication.
    struct Logger {
        file: Mutex<Option<File>>,
    }

    impl Logger {
        fn new() -> Self {
            let path = std::env::var("XSTERM_HELPER_LOG")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| {
                    std::env::temp_dir().join(format!(
                        "xsterm-helper-{}.log",
                        std::process::id()
                    ))
                });
            let file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .ok();
            eprintln!("xsterm-helper logging to: {}", path.display());
            Self {
                file: Mutex::new(file),
            }
        }

        fn log(&self, msg: &str) {
            if let Ok(mut f) = self.file.lock() {
                if let Some(f) = f.as_mut() {
                    let _ = writeln!(f, "[{}] {}", std::process::id(), msg);
                    let _ = f.flush();
                }
            }
            eprintln!("[helper {}] {}", std::process::id(), msg);
        }
    }

    const PTY_READ_BUFFER_SIZE: usize = 8192;
    const PIPE_BUFFER_SIZE: u32 = 65536;
    const SECURITY_DESCRIPTOR_REVISION: u32 = 1;

    struct HelperConfig {
        pipe_name: String,
        shell_exe: String,
        shell_args: Vec<String>,
        cwd: String,
        cols: u16,
        rows: u16,
        env: Vec<(String, String)>,
    }

    pub fn run() -> Result<(), String> {
        let logger = Arc::new(Logger::new());
        logger.log("=== xsterm-helper started ===");

        let config = parse_args()?;
        logger.log(&format!(
            "parsed: shell={}, cols={}, rows={}",
            config.shell_exe, config.cols, config.rows
        ));

        let mut pipe = connect_pipe_server(&config.pipe_name)?;
        logger.log("pipe server connected");
        let pipe_write = Arc::new(Mutex::new(
            pipe.try_clone().map_err(|e| format!("failed to duplicate pipe handle: {}", e))?,
        ));

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: config.rows.max(1),
                cols: config.cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("failed to create ConPTY: {}", e))?;
        logger.log(&format!("ConPTY created {}x{}", config.cols, config.rows));

        let mut cmd = CommandBuilder::new(&config.shell_exe);
        for arg in &config.shell_args {
            cmd.arg(arg);
        }
        for (key, value) in &config.env {
            cmd.env(key, value);
        }
        if !config.cwd.is_empty() {
            cmd.cwd(&config.cwd);
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("failed to spawn shell: {}", e))?;
        logger.log("shell spawned");
        let mut pty_writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("failed to open ConPTY writer: {}", e))?;
        let mut pty_reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("failed to open ConPTY reader: {}", e))?;

        // PTY output -> pipe (MSG_DATA).
        let data_write = Arc::clone(&pipe_write);
        let logger_pty = Arc::clone(&logger);
        std::thread::spawn(move || {
            let mut buf = [0u8; PTY_READ_BUFFER_SIZE];
            loop {
                match pty_reader.read(&mut buf) {
                    Ok(0) => {
                        logger_pty.log("PTY reader: EOF");
                        break;
                    }
                    Ok(n) => {
                        logger_pty.log(&format!(
                            "PTY reader: read {} bytes, sending to pipe",
                            n
                        ));
                        let Ok(mut w) = data_write.lock() else { break };
                        if proto::write_frame(&mut *w, proto::MSG_DATA, &buf[..n]).is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        logger_pty.log(&format!("PTY reader: error {:?}", e));
                        break;
                    }
                }
            }
        });

        // Pipe -> PTY (MSG_WRITE / MSG_RESIZE). Owns `pair` to keep the
        // ConPTY alive. Client disconnect => exit: destroying the ConPTY on
        // process exit terminates the shell.
        let logger_pipe = Arc::clone(&logger);
        std::thread::spawn(move || {
            loop {
                match proto::read_frame(&mut pipe) {
                    Ok(Some((proto::MSG_WRITE, payload))) => {
                        logger_pipe.log(&format!(
                            "pipe reader: got MSG_WRITE, {} bytes",
                            payload.len()
                        ));
                        let _ = pty_writer.write_all(&payload);
                    }
                    Ok(Some((proto::MSG_RESIZE, payload))) => {
                        logger_pipe.log("pipe reader: got MSG_RESIZE");
                        if let Some((rows, cols)) = proto::decode_resize_payload(&payload) {
                            let _ = pair.master.resize(PtySize {
                                rows,
                                cols,
                                pixel_width: 0,
                                pixel_height: 0,
                            });
                        }
                    }
                    Ok(Some((_, _))) => {}
                    Ok(None) => {
                        logger_pipe.log("pipe reader: EOF, exiting");
                        std::process::exit(0);
                    }
                    Err(e) => {
                        logger_pipe.log(&format!("pipe reader: error {:?}", e));
                        std::process::exit(0);
                    }
                }
            }
        });

        // Shell exit -> notify the main process, then exit.
        let _ = child.wait();
        if let Ok(mut w) = pipe_write.lock() {
            let _ = proto::write_frame(&mut *w, proto::MSG_EOF, &[]);
        }
        Ok(())
    }

    fn parse_args() -> Result<HelperConfig, String> {
        let mut config = HelperConfig {
            pipe_name: String::new(),
            shell_exe: String::new(),
            shell_args: Vec::new(),
            cwd: String::new(),
            cols: 80,
            rows: 24,
            env: Vec::new(),
        };
        let mut args = std::env::args().skip(1);
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--pipe-name" => {
                    config.pipe_name = args.next().ok_or("--pipe-name requires a value")?
                }
                "--shell-exe" => {
                    config.shell_exe = args.next().ok_or("--shell-exe requires a value")?
                }
                "--shell-arg" => config
                    .shell_args
                    .push(args.next().ok_or("--shell-arg requires a value")?),
                "--cwd" => config.cwd = args.next().ok_or("--cwd requires a value")?,
                "--cols" => {
                    config.cols = args
                        .next()
                        .ok_or("--cols requires a value")?
                        .parse()
                        .map_err(|_| "--cols must be a u16")?
                }
                "--rows" => {
                    config.rows = args
                        .next()
                        .ok_or("--rows requires a value")?
                        .parse()
                        .map_err(|_| "--rows must be a u16")?
                }
                "--env" => {
                    let pair = args.next().ok_or("--env requires a KEY=VALUE value")?;
                    let (key, value) = pair
                        .split_once('=')
                        .ok_or("--env value must be formatted KEY=VALUE")?;
                    config.env.push((key.to_string(), value.to_string()));
                }
                other => return Err(format!("unknown argument: {}", other)),
            }
        }
        if config.pipe_name.is_empty() {
            return Err("--pipe-name is required".to_string());
        }
        if config.shell_exe.is_empty() {
            return Err("--shell-exe is required".to_string());
        }
        Ok(config)
    }

    fn connect_pipe_server(pipe_name: &str) -> Result<File, String> {
        let wide: Vec<u16> = OsStr::new(pipe_name).encode_wide().chain(std::iter::once(0)).collect();

        // NULL-DACL security descriptor: this helper runs elevated (high
        // integrity level) while the main xsterm process is typically
        // non-elevated (medium IL). The default DACL inherited from the
        // elevated token would deny the parent access (UIPI), so the pipe is
        // created with an explicit everyone-allowed DACL.
        let mut sd: SECURITY_DESCRIPTOR = unsafe { std::mem::zeroed() };
        let psd = PSECURITY_DESCRIPTOR(&mut sd as *mut SECURITY_DESCRIPTOR as *mut core::ffi::c_void);
        unsafe {
            InitializeSecurityDescriptor(psd, SECURITY_DESCRIPTOR_REVISION)
                .map_err(|e| format!("InitializeSecurityDescriptor failed: {}", e))?;
            SetSecurityDescriptorDacl(psd, BOOL::from(true), None, BOOL::from(false))
                .map_err(|e| format!("SetSecurityDescriptorDacl failed: {}", e))?;
        }
        let sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: psd.0,
            bInheritHandle: BOOL::from(false),
        };

        let handle = unsafe {
            CreateNamedPipeW(
                PCWSTR(wide.as_ptr()),
                PIPE_ACCESS_DUPLEX,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                PIPE_UNLIMITED_INSTANCES,
                PIPE_BUFFER_SIZE,
                PIPE_BUFFER_SIZE,
                0,
                Some(&sa),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err(format!(
                "CreateNamedPipeW failed: {:?}",
                unsafe { GetLastError() }
            ));
        }

        if let Err(e) = unsafe { ConnectNamedPipe(handle, None) } {
            if e.code() != HRESULT::from_win32(ERROR_PIPE_CONNECTED.0) {
                let _ = unsafe { windows::Win32::Foundation::CloseHandle(handle) };
                return Err(format!("ConnectNamedPipe failed: {}", e));
            }
        }

        Ok(unsafe { File::from_raw_handle(handle.0) })
    }
}
