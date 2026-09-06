//! High-level builders that turn xsterm operations into the textual command
//! line tmux understands.
//!
//! Every function in this module returns a **`String`** that is
//! `'\n'`-terminated and ready to be written directly to a tmux
//! `-CC` child's stdin. The mapping is intentionally one-directional: xsterm
//! doesn't read these strings back — it dispatches the wire payload to the
//! server and lets [`crate::services::tmux::parser`] decode the
//! asynchronous reply.
//!
//! ## Argument safety
//!
//! Three classes of argument get treated differently:
//!
//! 1. **IDs** (`%<N>`, `$<N>`, `@<N>`) are produced by tmux and are always
//!    safe — passed verbatim without quoting.
//! 2. **Names** that xsterm controls (window names, session names) may
//!    contain whitespace; they go through [`quote_arg`], which wraps the
//!    string in double quotes and escapes embedded `\` and `"` per tmux's
//!    own command-line grammar.
//! 3. **Keys** for [`send_keys`] are arbitrary bytes — they go through
//!    [`escape_output`] so the wire payload is one tmux-token-wide and
//!    every control byte survives the round-trip. Note: keys containing
//!    spaces are split by tmux's command-line tokenizer into multiple
//!    `send-keys` arguments; tmux still sends each character individually,
//!    so the byte stream delivered to the pane is unchanged.
//!
//! All commands use absolute flags (`-h`/`-v` for split direction,
//! `-x`/`-y` for resize dimensions, `-p -e -J` for capture-pane) so the
//! command line is independent of any tmux user-level config / aliases.

use super::escape::escape_output;

fn quote_arg(s: &str) -> String {
    if !s.bytes().any(needs_quoting) {
        return s.to_string();
    }
    let escaped = s.replace('\\', r"\\").replace('"', r#"\""#);
    format!("\"{escaped}\"")
}

#[inline]
fn needs_quoting(b: u8) -> bool {
    b.is_ascii_whitespace() || b == b'"' || b == b'\\'
}

/// `send-keys -t %<pane_id> <escaped_keys>` — send a keystroke (or chunk of
/// keystrokes) to the pane.
///
/// The payload is passed through [`escape_output`] so every byte survives
/// the line-protocol trip: control characters and backslashes are emitted as
/// `\nnn` octal escapes, printable bytes pass through. tmux's `send-keys`
/// without `-l` interprets each argument through its key parser, which
/// decodes `\nnn` back to the original byte and dispatches it to the pane.
///
/// Returns a newline-terminated command line ready for stdin.
pub fn send_keys(pane_id: &str, keys: &[u8]) -> String {
    let escaped = escape_output(keys);
    format!("send-keys -t {pane_id} {escaped}\n")
}

/// `split-window -h|-v -t %<pane_id>` — split the pane horizontally
/// (right) or vertically (down). `horizontal = true` → `-h`, else `-v`.
///
/// Reserved for explicit split calls (the controller currently
/// constructs the wire payload inline in `create_tmux_pane`). Kept for
/// parser / wire-format parity and tested in this module's unit tests.
#[allow(dead_code)]
pub fn split_window(pane_id: &str, horizontal: bool) -> String {
    let flag = if horizontal { "-h" } else { "-v" };
    format!("split-window {flag} -t {pane_id}\n")
}

/// `kill-pane -t %<pane_id>` — destroy the pane.
pub fn kill_pane(pane_id: &str) -> String {
    format!("kill-pane -t {pane_id}\n")
}

/// `new-window -t $<session> [-n <name>]` — open a new window.
///
/// `name` is optional; when `Some`, it is quoted via [`quote_arg`] so a
/// name like `"editor — vim"` round-trips safely.
///
/// Reserved for callers that need to target a specific tmux session;
/// the `new-window` path uses [`new_window_in_current`] instead.
#[allow(dead_code)]
pub fn new_window(session: &str, name: Option<&str>) -> String {
    match name {
        Some(n) => format!(
            "new-window -t {session} -n {}\n",
            quote_arg(n)
        ),
        None => format!("new-window -t {session}\n"),
    }
}

/// `new-window [-n <name>]` — open a new window in the current tmux
/// session. Used by [`TmuxController::new_window`](crate::services::tmux::controller::TmuxController::new_window)
/// because the `tmux -CC` controller is attached to its own tmux
/// session; targeting it explicitly with `-t <session>` would force us to
/// store the session name on the controller and pass it through, which is
/// unnecessary given tmux's "default to current session" semantics.
///
/// `name` is optional; when `Some`, it is quoted via [`quote_arg`] so a
/// name like `"editor — vim"` round-trips safely.
pub fn new_window_in_current(name: Option<&str>) -> String {
    match name {
        Some(n) => format!("new-window -n {}\n", quote_arg(n)),
        None => "new-window\n".to_string(),
    }
}

/// `kill-window -t @<window_id>` — destroy the window.
pub fn kill_window(window_id: &str) -> String {
    format!("kill-window -t {window_id}\n")
}

/// `rename-window -t @<id> <new_name>` — rename the window.
pub fn rename_window(window_id: &str, name: &str) -> String {
    format!(
        "rename-window -t {window_id} {}\n",
        quote_arg(name)
    )
}

/// `resize-pane -t %<pane_id> -x <cols> -y <rows>` — resize the pane to the
/// given character dimensions. tmux updates the child process's TIOCSWINSZ
/// and propagates a SIGWINCH down the pty chain.
pub fn resize_pane(pane_id: &str, cols: u16, rows: u16) -> String {
    format!("resize-pane -t {pane_id} -x {cols} -y {rows}\n")
}

/// `capture-pane -p -e -J -S -<start_line> -t %<pane_id>` — request
/// scrollback content for the pane.
///
/// Flags:
/// - `-p`: print to stdout instead of paste buffer
/// - `-e`: include escape sequences (preserves colors)
/// - `-J`: strip trailing whitespace from each line
/// - `-S -<N>`: include the last N lines of history (negative = "up to N")
///
/// `capture_pane` translates the synchronous reply lines into xterm.js's
/// scrollback buffer.
pub fn capture_pane(pane_id: &str, start_line: i32) -> String {
    // tmux accepts `-S -<N>` (negative). We forward the sign verbatim so
    // callers can pass `-100` to mean "last 100 lines".
    let s = if start_line >= 0 {
        format!("-{start_line}")
    } else {
        format!("{start_line}")
    };
    format!("capture-pane -p -e -J -S {s} -t {pane_id}\n")
}

/// `list-panes -t @<window_id>` — list panes in the given window.
///
/// Returns one `#{pane_id} #{pane_width} ...` line per pane in the
/// command's `%begin..%end` reply block.
///
/// Reserved for future introspection; the controller relies on tmux's
/// event-driven `%window-pane-changed` notifications instead.
#[allow(dead_code)]
pub fn list_panes(window_id: &str) -> String {
    format!("list-panes -t {window_id}\n")
}

/// `list-sessions` — list every session on this server.
///
/// The reply is the same one iTerm2 uses when it opens a tmux -CC window:
/// one session per line, format `session_id session_name session_attached …`.
///
/// Reserved for the attach-recovery path; the active session list is
/// derived from `SessionManager::tmux_controllers` at runtime.
#[allow(dead_code)]
pub fn list_sessions() -> String {
    "list-sessions\n".to_string()
}

/// `refresh-client -A` — ask the server to redraw the client.
///
/// Useful after a layout change or for the first paint of a freshly
/// attached pane.
///
/// Reserved for future scrollback / layout recovery. The current
/// controller relies on tmux's event stream for redraws.
#[allow(dead_code)]
pub fn refresh_client() -> String {
    "refresh-client -A\n".to_string()
}

/// `refresh-client -C` — register the calling client as a **control
/// client**. This is the first command every tmux `-CC` integration
/// must send after starting the child process; without it tmux
/// server closes the control session and the client process exits
/// with code 0 immediately after the initial `%begin` block.
pub fn refresh_client_control() -> String {
    "refresh-client -C\n".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn must_end_in_newline(s: &str) {
        assert!(s.ends_with('\n'), "command {s:?} is not newline-terminated");
    }

    #[test]
    fn send_keys_escapes_control_bytes() {
        let cmd = send_keys("%5", b"hello\nworld");
        must_end_in_newline(&cmd);
        // `\012` is the octal escape for newline. We expect the literal
        // substring `hello\012world` somewhere in the command.
        assert!(cmd.contains("hello\\012world"), "got {cmd:?}");
        assert!(cmd.starts_with("send-keys -t %5 "));
    }

    #[test]
    fn send_keys_escapes_backslash() {
        let cmd = send_keys("%5", b"a\\b");
        assert!(cmd.contains("a\\134b"), "got {cmd:?}");
    }

    #[test]
    fn split_window_horizontal_uses_h() {
        let cmd = split_window("%5", true);
        assert_eq!(cmd, "split-window -h -t %5\n");
    }

    #[test]
    fn split_window_vertical_uses_v() {
        let cmd = split_window("%5", false);
        assert_eq!(cmd, "split-window -v -t %5\n");
    }

    #[test]
    fn kill_pane_uses_dash_t() {
        assert_eq!(kill_pane("%5"), "kill-pane -t %5\n");
    }

    #[test]
    fn new_window_without_name() {
        assert_eq!(new_window("$1", None), "new-window -t $1\n");
    }

    #[test]
    fn new_window_with_simple_name_no_quotes() {
        let cmd = new_window("$1", Some("editor"));
        assert_eq!(cmd, "new-window -t $1 -n editor\n");
    }

    #[test]
    fn new_window_quotes_names_with_whitespace() {
        let cmd = new_window("$1", Some("editor — vim"));
        assert_eq!(cmd, "new-window -t $1 -n \"editor — vim\"\n");
    }

    #[test]
    fn new_window_quotes_names_with_embedded_quote() {
        let cmd = new_window("$1", Some("say \"hi\""));
        // The embedded `"` must be escaped as `\"` inside the outer
        // double-quoted argument.
        assert_eq!(cmd, "new-window -t $1 -n \"say \\\"hi\\\"\"\n");
    }

    #[test]
    fn new_window_quotes_names_with_embedded_backslash() {
        let cmd = new_window("$1", Some("a\\b"));
        // Embedded `\` must be escaped as `\\` inside the quoted argument.
        assert_eq!(cmd, "new-window -t $1 -n \"a\\\\b\"\n");
    }

    #[test]
    fn kill_window_uses_dash_t() {
        assert_eq!(kill_window("@1"), "kill-window -t @1\n");
    }

    #[test]
    fn rename_window_quotes_name() {
        let cmd = rename_window("@1", "new name");
        assert_eq!(cmd, "rename-window -t @1 \"new name\"\n");
    }

    #[test]
    fn rename_window_does_not_quote_simple_name() {
        // No whitespace / special chars → no quoting.
        let cmd = rename_window("@1", "simple");
        assert_eq!(cmd, "rename-window -t @1 simple\n");
    }

    #[test]
    fn resize_pane_uses_xy() {
        let cmd = resize_pane("%5", 80, 24);
        assert_eq!(cmd, "resize-pane -t %5 -x 80 -y 24\n");
    }

    #[test]
    fn capture_pane_uses_negative_start_line() {
        let cmd = capture_pane("%5", -100);
        assert_eq!(cmd, "capture-pane -p -e -J -S -100 -t %5\n");
    }

    #[test]
    fn capture_pane_handles_zero_start_line() {
        // `start_line == 0` → `-0` is also acceptable to tmux.
        let cmd = capture_pane("%5", 0);
        assert_eq!(cmd, "capture-pane -p -e -J -S -0 -t %5\n");
    }

    #[test]
    fn list_panes_uses_dash_t() {
        assert_eq!(list_panes("@1"), "list-panes -t @1\n");
    }

    #[test]
    fn list_sessions_bare() {
        assert_eq!(list_sessions(), "list-sessions\n");
    }

    #[test]
    fn refresh_client_uppercase_a() {
        assert_eq!(refresh_client(), "refresh-client -A\n");
    }
}