use std::process::{Command, ExitCode, Stdio};

fn main() -> ExitCode {
    let mut command = Command::new("wsl.exe");
    command
        .arg("--exec")
        .arg("tmux")
        .args(std::env::args_os().skip(1))
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    match command.status() {
        Ok(status) => ExitCode::from(status.code().unwrap_or(1).clamp(0, 255) as u8),
        Err(error) => {
            eprintln!("xsterm tmux shim failed to start wsl.exe: {error}");
            ExitCode::FAILURE
        }
    }
}
