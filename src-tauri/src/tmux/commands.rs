//! Builders for tmux control mode commands.
//!
//! These functions return the raw UTF-8 strings that should be written to the
//! tmux control mode stdin. Each command is terminated with a newline.

#![allow(dead_code)]

/// Command number used for requests that do not need a response.
pub const NO_CMD_NUM: u64 = 0;

/// Create a new tmux session and enter control mode.
pub fn new_session(name: Option<&str>) -> String {
    match name {
        Some(n) => format!("new-session -s {}\n", quote_tmux_arg(n)),
        None => "new-session\n".to_string(),
    }
}

/// Attach to an existing tmux session in control mode.
pub fn attach_session(name: &str) -> String {
    format!("attach-session -t {}\n", quote_tmux_arg(name))
}

/// Send literal keys to a pane.
pub fn send_keys(pane_id: &str, keys: &str) -> String {
    format!(
        "send-keys -t {} {}\n",
        pane_id,
        escape_tmux_keys(keys)
    )
}

/// Resize a pane to the given dimensions.
pub fn resize_pane(pane_id: &str, rows: u16, cols: u16) -> String {
    format!(
        "resize-pane -t {} -x {} -y {}\n",
        pane_id, cols, rows
    )
}

/// List sessions.
pub fn list_sessions() -> String {
    "list-sessions\n".to_string()
}

/// List windows in a session.
pub fn list_windows(session_id: &str) -> String {
    format!("list-windows -t {}\n", session_id)
}

/// List panes in a window.
pub fn list_panes(window_id: &str) -> String {
    format!("list-panes -t {}\n", window_id)
}

/// Request the current layout of a window.
pub fn display_message_window_layout(window_id: &str) -> String {
    format!(
        "display-message -t {} -p '#{{window_layout}}'\n",
        window_id
    )
}

/// Kill a pane.
pub fn kill_pane(pane_id: &str) -> String {
    format!("kill-pane -t {}\n", pane_id)
}

/// Kill a window.
pub fn kill_window(window_id: &str) -> String {
    format!("kill-window -t {}\n", window_id)
}

/// Kill a session.
pub fn kill_session(session_id: &str) -> String {
    format!("kill-session -t {}\n", session_id)
}

/// Refresh a paused pane by acknowledging its output.
pub fn refresh_client_pane(pane_id: &str) -> String {
    format!("refresh-client -A {}:\n", pane_id)
}

/// Enable or disable pause-after flow control.
pub fn set_pause_after(seconds: u64) -> String {
    format!("refresh-client -p {}\n", seconds)
}

/// Escape a string for use as a tmux key sequence.
///
/// Tmux `send-keys` accepts either literal characters or special key names
/// such as `C-c`, `Enter`, `Tab`. For ordinary text we pass the characters
/// through mostly unchanged, but backslashes and quotes are doubled.
fn escape_tmux_keys(keys: &str) -> String {
    keys.chars()
        .flat_map(|c| match c {
            '\\' | '"' => vec![c, c],
            _ => vec![c],
        })
        .collect()
}

/// Quote an argument that may contain spaces for tmux `-t` targets.
fn quote_tmux_arg(arg: &str) -> String {
    if arg.chars().any(|c| c.is_whitespace()) {
        format!("\"{}\"", arg.replace('\"', "\\\""))
    } else {
        arg.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn send_keys_simple_text() {
        assert_eq!(send_keys("%0", "hello"), "send-keys -t %0 hello\n");
    }

    #[test]
    fn resize_pane_format() {
        assert_eq!(
            resize_pane("%3", 24, 80),
            "resize-pane -t %3 -x 80 -y 24\n"
        );
    }

    #[test]
    fn new_session_with_name() {
        assert_eq!(
            new_session(Some("my session")),
            "new-session -s \"my session\"\n"
        );
    }
}
