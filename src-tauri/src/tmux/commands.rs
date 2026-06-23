//! Builders for tmux control mode commands.
//!
//! These functions return the raw UTF-8 strings that should be written to the
//! tmux control mode stdin. Each command is terminated with a newline.

#![allow(dead_code)]

/// Command number used for requests that do not need a response.
pub const NO_CMD_NUM: u64 = 0;

/// Build the argv for the initial tmux control mode invocation.
///
/// `tmux -CC` is always prepended by the caller; this function returns only
/// the subcommand and its flags. For `new-session` we add `-A -D` so the
/// control client creates the session (or attaches if it exists) and stays
/// attached. For `attach-session` we map the optional target with `-t`.
pub fn build_tmux_argv(command: &str, target: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = command.split_whitespace().map(String::from).collect();
    if args.is_empty() {
        args.push("new-session".to_string());
    }

    match args[0].as_str() {
        "new-session" => {
            add_flag_if_missing(&mut args, "-A");
            add_flag_if_missing(&mut args, "-D");
            if let Some(t) = target {
                add_flag_with_value(&mut args, "-s", t);
            }
        }
        "attach-session" => {
            if let Some(t) = target {
                add_flag_with_value(&mut args, "-t", t);
            }
        }
        _ => {
            if let Some(t) = target {
                args.push(t.to_string());
            }
        }
    }

    args
}

fn add_flag_if_missing(args: &mut Vec<String>, flag: &str) {
    if !args.contains(&flag.to_string()) {
        args.push(flag.to_string());
    }
}

fn add_flag_with_value(args: &mut Vec<String>, flag: &str, value: &str) {
    if !args.contains(&flag.to_string()) {
        args.push(flag.to_string());
        args.push(value.to_string());
    }
}

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
        "send-keys -t {} \"{}\"\n",
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

pub fn list_windows(session_id: &str) -> String {
    if session_id.is_empty() {
        "list-windows -F '#{session_id}\t#{window_id}\t#{window_active}\t#{window_layout}\t#{window_name}'\n".to_string()
    } else {
        format!(
            "list-windows -t {} -F '#{{session_id}}\t#{{window_id}}\t#{{window_active}}\t#{{window_layout}}\t#{{window_name}}'\n",
            session_id
        )
    }
}

pub fn list_panes(window_id: &str) -> String {
    format!(
        "list-panes -t {} -F '#{{session_id}}\t#{{window_id}}\t#{{pane_id}}\t#{{pane_active}}\t#{{pane_width}}\t#{{pane_height}}\t#{{pane_title}}'\n",
        window_id
    )
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
    format!("refresh-client -A {}:continue\n", pane_id)
}

pub fn capture_pane(pane_id: &str, history: Option<usize>, escape_sequences: bool) -> String {
    let mut cmd = format!("capture-pane -t {}", pane_id);
    if escape_sequences {
        cmd.push_str(" -e");
    }
    if let Some(n) = history {
        cmd.push_str(&format!(" -S -{}", n));
    }
    cmd.push_str(" -p\n");
    cmd
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
    let mut result = String::with_capacity(keys.len());
    let mut chars = keys.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' => result.push_str("\\\\"),
            '"' => result.push_str("\\\""),
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                if !result.ends_with("Enter") {
                    result.push_str("Enter");
                }
            }
            '\n' => {
                if !result.ends_with("Enter") {
                    result.push_str("Enter");
                }
            }
            _ => result.push(c),
        }
    }
    result
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
        assert_eq!(send_keys("%0", "hello"), "send-keys -t %0 \"hello\"\n");
    }

    #[test]
    fn send_keys_with_space() {
        assert_eq!(send_keys("%0", "hello world"), "send-keys -t %0 \"hello world\"\n");
    }

    #[test]
    fn send_keys_enter() {
        assert_eq!(send_keys("%0", "\r"), "send-keys -t %0 \"Enter\"\n");
        assert_eq!(send_keys("%0", "\n"), "send-keys -t %0 \"Enter\"\n");
        assert_eq!(send_keys("%0", "\r\n"), "send-keys -t %0 \"Enter\"\n");
    }

    #[test]
    fn send_keys_mixed_with_enter() {
        assert_eq!(
            send_keys("%0", "hello\rworld"),
            "send-keys -t %0 \"helloEnterworld\"\n"
        );
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

    #[test]
    fn build_tmux_argv_new_session_adds_attach_flags() {
        let args = build_tmux_argv("new-session", Some("foo"));
        assert_eq!(args, vec!["new-session", "-A", "-D", "-s", "foo"]);
    }

    #[test]
    fn build_tmux_argv_new_session_without_target() {
        let args = build_tmux_argv("new-session", None);
        assert_eq!(args, vec!["new-session", "-A", "-D"]);
    }

    #[test]
    fn build_tmux_argv_attach_session_maps_target() {
        let args = build_tmux_argv("attach-session", Some("foo"));
        assert_eq!(args, vec!["attach-session", "-t", "foo"]);
    }

    #[test]
    fn build_tmux_argv_does_not_duplicate_flags() {
        let args = build_tmux_argv("new-session -A -D -s foo", Some("foo"));
        assert_eq!(args, vec!["new-session", "-A", "-D", "-s", "foo"]);
    }
}
