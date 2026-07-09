#![allow(dead_code)]

//! Pure tmux command string builders.
//!
//! All functions return a complete tmux command line ending with `\n` so they
//! can be written directly to a tmux control-mode stdin.

/// Command number used when no correlation is needed.
pub const NO_CMD_NUM: usize = 0;

fn shell_tokenize(command: &str) -> Vec<String> {
    command.split_whitespace().map(String::from).collect()
}

/// Build the argv used to spawn `tmux -CC` for a new or attach session.
///
/// - `attach-session` is rewritten to `new-session -A -D` so that tmux creates
///   the session if it does not exist.
/// - Pre-existing `-A`, `-D`, `-s` and `-t` flags are not duplicated.
pub fn build_tmux_argv(command: &str, target: Option<&str>, socket: Option<&str>) -> Vec<String> {
    let mut argv = vec!["tmux".to_string()];
    if let Some(socket) = socket {
        argv.push("-L".to_string());
        argv.push(socket.to_string());
    }
    argv.push("-CC".to_string());

    let mut tokens = shell_tokenize(command);
    if tokens.is_empty() {
        tokens.push("new-session".to_string());
    }

    let is_attach = tokens[0] == "attach-session";
    if is_attach {
        tokens[0] = "new-session".to_string();
    }

    let has_flag = |flag: &str| tokens.iter().any(|t| t == flag);

    if tokens[0] == "new-session" {
        if !has_flag("-A") {
            tokens.push("-A".to_string());
        }
        if !has_flag("-D") {
            tokens.push("-D".to_string());
        }
    }

    if let Some(target) = target {
        if !has_flag("-s") && !has_flag("-t") {
            tokens.push("-s".to_string());
            tokens.push(target.to_string());
        }
    }

    argv.extend(tokens);
    argv
}

/// Wrap an argument in double quotes, escaping existing double quotes.
pub fn quote_tmux_arg(arg: &str) -> String {
    if arg.contains('"') {
        format!("\"{}\"", arg.replace('"', "\\\""))
    } else {
        format!("\"{}\"", arg)
    }
}

/// Escape arbitrary user input for use inside a tmux `send-keys` argument.
///
/// - Backslashes are doubled.
/// - Carriage return / line feed become the `Enter` key name.
/// - Double quotes are escaped.
pub fn escape_tmux_keys(keys: &str) -> String {
    let mut out = String::with_capacity(keys.len());
    let mut chars = keys.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            out.push('\\');
            out.push('\\');
        } else if c == '\r' {
            if chars.peek() == Some(&'\n') {
                chars.next();
            }
            out.push_str("Enter");
        } else if c == '\n' {
            out.push_str("Enter");
        } else if c == '"' {
            out.push('\\');
            out.push('"');
        } else {
            out.push(c);
        }
    }
    out
}

/// Build a `send-keys` command targeting a pane.
pub fn send_keys(pane_id: &str, keys: &str) -> String {
    format!("send-keys -t {} \"{}\"\n", pane_id, escape_tmux_keys(keys))
}

/// Build a `resize-pane` command.
pub fn resize_pane(pane_id: &str, rows: u16, cols: u16) -> String {
    format!("resize-pane -t {} -x {} -y {}\n", pane_id, cols, rows)
}

/// Build a `resize-window` command targeting the window containing a pane.
pub fn resize_window_for_pane(pane_id: &str, cols: u16, rows: u16) -> String {
    format!("resize-window -t {} -x {} -y {}\n", pane_id, cols, rows)
}

/// Build a `list-windows` command for a session (or all sessions if empty).
pub fn list_windows(session_id: &str) -> String {
    let format = "#{window_id}\t#{session_id}\t#{window_name}\t#{window_active}\t#{window_layout}";
    if session_id.is_empty() {
        format!("list-windows -F '{}'", format) + "\n"
    } else {
        format!("list-windows -t {} -F '{}'", session_id, format) + "\n"
    }
}

/// Build a `list-panes` command for a window (or all panes if empty).
pub fn list_panes(window_id: &str) -> String {
    let format = "#{pane_id}\t#{window_id}\t#{session_id}\t#{pane_active}\t#{pane_width}\t#{pane_height}\t#{pane_current_path}\t#{pane_title}";
    if window_id.is_empty() {
        format!("list-panes -F '{}'", format) + "\n"
    } else {
        format!("list-panes -t {} -F '{}'", window_id, format) + "\n"
    }
}

/// Build a `capture-pane` command for historical pane output.
pub fn capture_pane(pane_id: &str, history: usize) -> String {
    if history == 0 {
        format!("capture-pane -t {} -p\n", pane_id)
    } else {
        format!("capture-pane -t {} -p -S -{}\n", pane_id, history)
    }
}

/// Build a `new-session` command.
pub fn new_session(name: &str, socket: Option<&str>) -> String {
    if let Some(socket) = socket {
        format!(
            "new-session -L {} -s {}\n",
            quote_tmux_arg(socket),
            quote_tmux_arg(name)
        )
    } else {
        format!("new-session -s {}\n", quote_tmux_arg(name))
    }
}

/// Build an `attach-session` command.
pub fn attach_session(target: &str, socket: Option<&str>) -> String {
    if let Some(socket) = socket {
        format!(
            "attach-session -L {} -t {}\n",
            quote_tmux_arg(socket),
            quote_tmux_arg(target)
        )
    } else {
        format!("attach-session -t {}\n", quote_tmux_arg(target))
    }
}

/// Build a `kill-session` command.
pub fn kill_session(session_id: &str) -> String {
    format!("kill-session -t {}\n", session_id)
}

/// Build a `kill-window` command.
pub fn kill_window(window_id: &str) -> String {
    format!("kill-window -t {}\n", window_id)
}

/// Build a `kill-pane` command.
pub fn kill_pane(pane_id: &str) -> String {
    format!("kill-pane -t {}\n", pane_id)
}

/// Build a `new-window` command in a session.
pub fn new_window(session_id: &str, name: Option<&str>) -> String {
    let mut cmd = format!("new-window -t {}", session_id);
    if let Some(name) = name {
        cmd.push_str(&format!(" -n {}", quote_tmux_arg(name)));
    }
    cmd.push('\n');
    cmd
}

/// Build a `split-window` command from a pane.
pub fn split_window(pane_id: &str, direction: &str) -> String {
    let flag = match direction {
        "horizontal" | "h" => "-h",
        "vertical" | "v" => "-v",
        _ => "-v",
    };
    format!("split-window -t {} {}\n", pane_id, flag)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn send_keys_simple_text() {
        assert_eq!(send_keys("%0", "abc"), "send-keys -t %0 \"abc\"\n");
    }

    #[test]
    fn send_keys_with_space() {
        assert_eq!(
            send_keys("%0", "hello world"),
            "send-keys -t %0 \"hello world\"\n"
        );
    }

    #[test]
    fn send_keys_enter() {
        assert_eq!(send_keys("%0", "\r"), "send-keys -t %0 \"Enter\"\n");
        assert_eq!(send_keys("%0", "\n"), "send-keys -t %0 \"Enter\"\n");
        assert_eq!(send_keys("%0", "\r\n"), "send-keys -t %0 \"Enter\"\n");
    }

    #[test]
    fn send_keys_mixed_with_enter() {
        assert_eq!(send_keys("%0", "ab\r"), "send-keys -t %0 \"abEnter\"\n");
    }

    #[test]
    fn send_keys_escape_backslash_and_quote() {
        assert_eq!(
            send_keys("%0", "a\\b\"c"),
            "send-keys -t %0 \"a\\\\b\\\"c\"\n"
        );
    }

    #[test]
    fn resize_window_for_pane_format() {
        assert_eq!(
            resize_window_for_pane("%0", 80, 24),
            "resize-window -t %0 -x 80 -y 24\n"
        );
    }

    #[test]
    fn resize_pane_format() {
        assert_eq!(
            resize_pane("%0", 24, 80),
            "resize-pane -t %0 -x 80 -y 24\n"
        );
    }

    #[test]
    fn new_session_with_name() {
        assert_eq!(new_session("xsterm", None), "new-session -s \"xsterm\"\n");
    }

    #[test]
    fn new_session_with_socket() {
        assert_eq!(
            new_session("xsterm", Some("custom")),
            "new-session -L \"custom\" -s \"xsterm\"\n"
        );
    }

    #[test]
    fn attach_session_format() {
        assert_eq!(
            attach_session("xsterm", None),
            "attach-session -t \"xsterm\"\n"
        );
    }

    #[test]
    fn build_tmux_argv_new_session_adds_attach_flags() {
        let argv = build_tmux_argv("new-session", Some("xsterm"), None);
        assert_eq!(
            argv,
            vec!["tmux", "-CC", "new-session", "-A", "-D", "-s", "xsterm"]
        );
    }

    #[test]
    fn build_tmux_argv_new_session_without_target() {
        let argv = build_tmux_argv("new-session", None, None);
        assert_eq!(argv, vec!["tmux", "-CC", "new-session", "-A", "-D"]);
    }

    #[test]
    fn build_tmux_argv_attach_session_uses_new_session_with_attach_flags() {
        let argv = build_tmux_argv("attach-session", Some("xsterm"), None);
        assert_eq!(
            argv,
            vec!["tmux", "-CC", "new-session", "-A", "-D", "-s", "xsterm"]
        );
    }

    #[test]
    fn build_tmux_argv_does_not_duplicate_flags() {
        let argv = build_tmux_argv("new-session -A -D -s xsterm", None, None);
        assert_eq!(
            argv,
            vec!["tmux", "-CC", "new-session", "-A", "-D", "-s", "xsterm"]
        );
    }

    #[test]
    fn build_tmux_argv_with_socket() {
        let argv = build_tmux_argv("new-session", Some("xsterm"), Some("custom"));
        assert_eq!(
            argv,
            vec![
                "tmux",
                "-L",
                "custom",
                "-CC",
                "new-session",
                "-A",
                "-D",
                "-s",
                "xsterm"
            ]
        );
    }

    #[test]
    fn no_cmd_num_is_zero() {
        assert_eq!(NO_CMD_NUM, 0);
    }

    #[test]
    fn kill_session_format() {
        assert_eq!(kill_session("$1"), "kill-session -t $1\n");
    }

    #[test]
    fn kill_window_format() {
        assert_eq!(kill_window("@1"), "kill-window -t @1\n");
    }

    #[test]
    fn kill_pane_format() {
        assert_eq!(kill_pane("%1"), "kill-pane -t %1\n");
    }

    #[test]
    fn list_windows_format() {
        assert!(list_windows("$1").starts_with("list-windows -t $1 -F"));
    }

    #[test]
    fn list_windows_without_target() {
        assert!(list_windows("").starts_with("list-windows -F"));
    }

    #[test]
    fn list_panes_format() {
        assert!(list_panes("@1").starts_with("list-panes -t @1 -F"));
    }

    #[test]
    fn capture_pane_format() {
        assert_eq!(capture_pane("%1", 1000), "capture-pane -t %1 -p -S -1000\n");
        assert_eq!(capture_pane("%1", 0), "capture-pane -t %1 -p\n");
    }

    #[test]
    fn new_window_format() {
        assert_eq!(
            new_window("$1", Some("editor")),
            "new-window -t $1 -n \"editor\"\n"
        );
        assert_eq!(new_window("$1", None), "new-window -t $1\n");
    }

    #[test]
    fn split_window_format() {
        assert_eq!(split_window("%0", "vertical"), "split-window -t %0 -v\n");
        assert_eq!(split_window("%0", "horizontal"), "split-window -t %0 -h\n");
    }

    #[test]
    fn quote_tmux_arg_escapes_quotes() {
        assert_eq!(quote_tmux_arg("a\"b"), "\"a\\\"b\"");
    }
}
