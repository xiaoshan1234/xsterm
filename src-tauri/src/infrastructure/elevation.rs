#![cfg(target_os = "windows")]
//! Spawning elevated (administrator) processes via `ShellExecuteEx("runas")`.
//!
//! `ShellExecuteW` alone does not expose the child process, so this uses
//! `ShellExecuteExW` with `SEE_MASK_NOCLOSEPROCESS` to obtain a process
//! handle and resolves the child's PID from it.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;

use windows::core::{HRESULT, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, ERROR_CANCELLED};
use windows::Win32::System::Threading::GetProcessId;
use windows::Win32::UI::Shell::{ShellExecuteExW, SHELLEXECUTEINFOW, SEE_MASK_NOCLOSEPROCESS};
use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

pub(crate) fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

/// Spawn `exe_path` with the `runas` verb (UAC elevation) and return the
/// child's process ID.
///
/// Blocks while the UAC consent prompt is shown. Returns a distinct error
/// message when the user declines the prompt so the frontend can surface it.
pub fn spawn_elevated(exe_path: &str, params: &str) -> Result<u32, String> {
    let exe_wide = to_wide(exe_path);
    let params_wide = to_wide(params);
    let verb_wide = to_wide("runas");

    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS;
    info.lpVerb = PCWSTR(verb_wide.as_ptr());
    info.lpFile = PCWSTR(exe_wide.as_ptr());
    info.lpParameters = PCWSTR(params_wide.as_ptr());
    info.nShow = SW_HIDE.0;

    if let Err(e) = unsafe { ShellExecuteExW(&mut info) } {
        if e.code() == HRESULT::from_win32(ERROR_CANCELLED.0) {
            return Err("UAC elevation was cancelled by the user".to_string());
        }
        return Err(format!("ShellExecuteEx(\"runas\") failed: {}", e));
    }

    if info.hProcess.is_invalid() {
        return Err("ShellExecuteEx(\"runas\") did not return a process handle".to_string());
    }
    let pid = unsafe { GetProcessId(info.hProcess) };
    let _ = unsafe { CloseHandle(info.hProcess) };
    if pid == 0 {
        return Err("failed to resolve the elevated process id".to_string());
    }
    Ok(pid)
}
