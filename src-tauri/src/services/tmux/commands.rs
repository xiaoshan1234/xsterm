//! Backward-compatibility shim — see
//! [`crate::services::tmux::protocol::wire`] for the canonical definitions.
//!
//! This file is kept so external callers (and internal `controller` /
//! `dispatch` modules that have not yet migrated) continue to compile
//! during the P1 → P5 migration window.
//!
//! **New code should import from `crate::services::tmux::protocol::*`
//! directly.** The shim will be removed in PR-T5.

pub use crate::services::tmux::protocol::wire::{
    attach_session_create, kill_pane, kill_window, list_panes, list_panes_for_bootstrap,
    list_panes_with_format, list_sessions, list_windows, new_window, new_window_in_current,
    refresh_client, refresh_client_control, rename_window, resize_pane, send_keys,
    split_window, capture_pane, DEFAULT_PANE_LIST_FORMAT, DEFAULT_WINDOW_LIST_FORMAT,
};

#[cfg(test)]
mod tests {
    //! Unit tests live in [`crate::services::tmux::protocol::wire::tests`].
    //! They exercise the same public functions; this shim only re-exports.
    use super::*;

    fn must_end_in_newline(s: &str) {
        assert!(s.ends_with('\n'), "command {s:?} is not newline-terminated");
    }

    #[test]
    fn send_keys_escapes_control_bytes() {
        let cmd = send_keys("%5", b"hello\nworld");
        must_end_in_newline(&cmd);
        assert!(cmd.contains("hello\\012world"), "got {cmd:?}");
        assert!(
            cmd.starts_with("send-keys -l -t %5 \""),
            "missing -l flag / outer quoting; got {cmd:?}"
        );
        assert!(cmd.ends_with("\"\n"));
    }

    #[test]
    fn send_keys_escapes_backslash() {
        let cmd = send_keys("%5", b"a\\b");
        assert!(cmd.contains("a\\134b"), "got {cmd:?}");
    }

    /// Regression: a literal space keystroke must survive the trip to
    /// tmux. Pre-fix, the wire string was `send-keys -t %5  \n` (one
    /// space between `%5` and the trailing literal space). tmux's
    /// command-line tokenizer split on whitespace and the trailing
    /// space was eaten as a delimiter, so the user typed nothing.
    /// Post-fix: `-l` flag + outer `"..."` quoting bundle the payload
    /// into one argument regardless of whitespace; tmux decodes any
    /// `\nnn` escapes under literal mode and forwards the bytes to
    /// the pane.
    #[test]
    fn send_keys_quotes_payload_with_whitespace() {
        let cmd = send_keys("%5", b" ");
        must_end_in_newline(&cmd);
        assert!(cmd.contains("\" \""), "got {cmd:?}");
        assert!(cmd.starts_with("send-keys -l "), "got {cmd:?}");
    }

    /// Regression: a multi-char ASCII chunk (e.g. `hello`) must be
    /// sent to the pane as five literal bytes. Pre-fix, tmux's
    /// `send-keys` (without `-l`) interpreted each argument as a key
    /// name; `hello` is not a key name and got silently dropped, so
    /// the user typed nothing for any chunk > 1 char.
    #[test]
    fn send_keys_uses_literal_flag() {
        let cmd = send_keys("%5", b"hello");
        assert!(cmd.starts_with("send-keys -l "), "got {cmd:?}");
        assert!(cmd.contains("\"hello\""), "got {cmd:?}");
    }

    /// Regression: a literal `"` keystroke must be embedded inside
    /// the outer `"..."` quoting without terminating it. Pre-fix the
    /// outer quoting did not exist, so this was a non-issue; the
    /// post-fix wire format has the outer quotes and needs to escape
    /// any internal `"` so the tokenizer doesn't truncate the arg.
    #[test]
    fn send_keys_escapes_embedded_quote_in_payload() {
        let cmd = send_keys("%5", b"\"");
        assert!(cmd.starts_with("send-keys -l -t %5 \""));
        assert!(cmd.ends_with("\"\n"));
        assert!(cmd.contains("\\\""), "got {cmd:?}");
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
        assert_eq!(cmd, "new-window -t $1 -n \"say \\\"hi\\\"\"\n");
    }

    #[test]
    fn new_window_quotes_names_with_embedded_backslash() {
        let cmd = new_window("$1", Some("a\\b"));
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