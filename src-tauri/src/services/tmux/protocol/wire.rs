//! High-level builders that turn xsterm operations into the textual command
//! line tmux understands.
//!
//! Every function in this module returns a **`String`** that is
//! `'\n'`-terminated and ready to be written directly to a tmux
//! `-CC` child's stdin. The mapping is intentionally one-directional: xsterm
//! doesn't read these strings back — it dispatches the wire payload to the
//! server and lets [`crate::services::tmux::protocol::parser`] decode the
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
//!    [`crate::services::tmux::protocol::codec::escape_output`] so the wire
//!    payload is one tmux-token-wide and every control byte survives the
//!    round-trip. Note: keys containing spaces are split by tmux's
//!    command-line tokenizer into multiple `send-keys` arguments; tmux
//!    still sends each character individually, so the byte stream
//!    delivered to the pane is unchanged.
//!
//! All commands use absolute flags (`-h`/`-v` for split direction,
//! `-x`/`-y` for resize dimensions, `-p -e -J` for capture-pane) so the
//! command line is independent of any tmux user-level config / aliases.
//!
//! ## History
//!
//! Originally `crate::services::tmux::commands`. Renamed to `wire` and
//! moved under `protocol/` in PR-T1 (see
//! `doc/ai-terminal-migration/04-tmux-redesign-v0.md`).

use super::codec::escape_output;

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

/// `send-keys -l -t %<pane_id> "<escaped_keys>"` — send a keystroke (or
/// chunk of keystrokes) to the pane.
///
/// Two layers of protection keep every byte intact across the
/// command-line trip:
///
/// 1. **The payload is passed through [`escape_output`]** so every byte
///    survives: control characters, backslash, and non-ASCII bytes are
///    emitted as `\nnn` octal escapes. Printable bytes pass through.
/// 2. **The escaped payload is wrapped in `"..."` and the `-l` flag is
///    passed to `send-keys`.** Two failures the bare wire format
///    suffered before this change:
///
///    - tmux's command-line tokenizer splits on ASCII whitespace
///      *before* any octal decoding runs, so a literal space keystroke
///      arrived as a delimiter and was eaten (Bug — see
///      `doc/dev/changelog/bugs.md` Bug 024).
///    - Without `-l`, tmux interprets each argument as a key name
///      (`Up`, `C-a`, `BSpace`)…).`hello` is not a key name and gets
///      dropped silently. `-l` tells tmux to treat the argument as
///      literal bytes (still with octal decoding), which is what
///      xterm.js's byte stream needs.
///
/// Returns a newline-terminated command line ready for stdin.
pub fn send_keys(pane_id: &str, keys: &[u8]) -> String {
    let escaped = escape_output(keys);
    // `escape_output` already converts every `\` to `\134`, so the
    // escaped payload contains no raw `\` that we need to re-escape.
    // The only character that can break the outer `"..."` quoting is
    // a literal `"` (0x22 is printable ASCII and not in its escape
    // set); replace it with `\"`.
    let safe = escaped.replace('"', "\\\"");
    format!("send-keys -l -t {pane_id} \"{safe}\"\n")
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
        Some(n) => format!("new-window -t {session} -n {}\n", quote_arg(n)),
        None => format!("new-window -t {session}\n"),
    }
}

/// `new-window [-n <name>]` — open a new window in the current tmux
/// session. Used by the controller's `new_window` method because the
/// `tmux -CC` controller is attached to its own tmux session; targeting
/// it explicitly with `-t <session>` would force us to store the
/// session name on the controller and pass it through, which is
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
    format!("rename-window -t {window_id} {}\n", quote_arg(name))
}

/// `attach-session -c ""` — attach (and create if absent) the default
/// control session. Sent immediately after `refresh_client_control`
/// at controller startup; without it, `tmux -CC new-session -d` on
/// the server creates a detached session and the client never sees
/// the `%session-changed` / `%window-add` / `%window-pane-changed`
/// notifications needed to register the first pane (Bug 014).
pub fn attach_session_create() -> String {
    "attach-session -c \"\"\n".to_string()
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
/// The controller translates the synchronous reply lines into
/// xterm.js's scrollback buffer.
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

/// `list-panes` with an explicit `-F` format — used for the bootstrap
/// state query right after `new-session -A` + `new-window`. The output
/// rows start with a `%<pane_id>` (tab-separated) which the dispatch
/// task's `classify_command_response` turns into a `PaneList` event.
///
/// `window_id` empty ⇒ no `-t`, lists every pane on the server (used as
/// the default bootstrap query after a fresh `new-window`).
/// `window_id` non-empty ⇒ `-t <window_id>` (used to refresh a specific
/// window after a `WindowList`).
pub fn list_panes_with_format(window_id: &str, format: &str) -> String {
    if window_id.is_empty() {
        format!("list-panes -a -F '{format}'\n")
    } else {
        format!("list-panes -a -t {window_id} -F '{format}'\n")
    }
}

/// Default `list-panes -F` format covering every field the dispatch
/// task needs to register a `PaneList` entry: id / window / session /
/// active flag / width / height / cwd / title.
pub const DEFAULT_PANE_LIST_FORMAT: &str =
    "#{pane_id}\t#{window_id}\t#{session_id}\t#{pane_active}\t\
     #{pane_width}\t#{pane_height}\t#{pane_current_path}\t#{pane_title}";

/// Default `list-windows -F` format covering every field `WindowList`
/// needs: id / session / name / active flag / layout.
pub const DEFAULT_WINDOW_LIST_FORMAT: &str =
    "#{window_id}\t#{session_id}\t#{window_name}\t#{window_active}\t#{window_layout}";

/// Build a `list-windows -a` query so the bootstrap pass picks up
/// every pre-existing window/pane on the server (not just the first).
/// Without `-a` tmux only reports the current session's first window,
/// so panes in other windows would be lost on the client side.
pub fn list_windows(_session_id: &str) -> String {
    format!("list-windows -a -F '{DEFAULT_WINDOW_LIST_FORMAT}'\n")
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

/// `list-panes -a -F "#{session_name} #{window_id} #{window_name} #{pane_id}"`
/// — list every pane on the server, formatted for the bootstrap
/// state query. We send this right after `new-window` because some
/// tmux versions (notably OpenBSD base) don't push
/// `%window-pane-changed` immediately when a window is created
/// under control mode; the server's own state query is the only
/// reliable way to learn the first pane id (Bug 016).
pub fn list_panes_for_bootstrap() -> String {
    "list-panes -a -F \"#{session_name} #{window_id} #{window_name} #{pane_id}\"\n".to_string()
}

/// `detach-client -s "<session_name>"` — detach the calling control
/// client from `session_name`. tmux treats this as a graceful
/// disconnect: the child process exits cleanly (`%exit` from tmux's
/// end), the server's session + windows stay alive, and the monitor
/// task fires the `Exit` event which the dispatch task propagates to
/// the frontend as `tmux-controller-exit`.
///
/// `session_name` is passed through [`quote_arg`] so a session like
/// `"work — dev"` round-trips safely. ADR 0009 §2.9.
pub fn detach_client(session_name: &str) -> String {
    format!("detach-client -s {}\n", quote_arg(session_name))
}

/// `kill-server` — tell the calling control client to shut down the
/// entire tmux server (every session, every window, every pane).
/// Used by the session-control "Remote delete" action. The child
/// process exits after running the command because the server it was
/// attached to is gone; the monitor task observes the exit and the
/// dispatch task fires `tmux-controller-exit`. ADR 0009 §2.9.
pub fn kill_server() -> String {
    "kill-server\n".to_string()
}