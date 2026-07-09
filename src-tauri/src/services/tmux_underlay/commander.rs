//! Builders for tmux commands executed on an underlay session.

/// Constructs tmux commands for an optional socket (`-L`).
pub struct TmuxCommander {
    socket: Option<String>,
}

impl TmuxCommander {
    pub fn new(socket: Option<String>) -> Self {
        Self { socket }
    }

    fn base(&self) -> String {
        let mut cmd = "tmux".to_string();
        if let Some(socket) = &self.socket {
            cmd.push_str(&format!(" -L {}", shell_quote(socket)));
        }
        cmd
    }

    /// `tmux -V`
    pub fn version(&self) -> String {
        let cmd = format!("{} -V\n", self.base());
        tracing::info!("[tmux-debug] build command: version={:?}", cmd);
        cmd
    }

    /// `tmux has-session -t <name>`
    pub fn has_session(&self, target: &str) -> String {
        let cmd = format!("{} has-session -t {}\n", self.base(), shell_quote(target));
        tracing::info!("[tmux-debug] build command: has_session target={:?}, cmd={:?}", target, cmd);
        cmd
    }

    /// `tmux list-windows -t <session>`
    pub fn list_windows(&self, session_id: &str) -> String {
        let cmd = format!(
            "{} list-windows -t {} -F '#{{session_id}}|#{{window_id}}|#{{window_active}}|#{{window_layout}}|#{{window_name}}'\n",
            self.base(),
            shell_quote(session_id)
        );
        tracing::info!("[tmux-debug] build command: list_windows session_id={:?}, cmd={:?}", session_id, cmd);
        cmd
    }

    /// `tmux list-panes -t <window>`
    pub fn list_panes(&self, window_id: &str) -> String {
        let cmd = format!(
            "{} list-panes -t {} -F '#{{session_id}}|#{{window_id}}|#{{pane_id}}|#{{pane_active}}|#{{pane_width}}|#{{pane_height}}|#{{pane_title}}'\n",
            self.base(),
            shell_quote(window_id)
        );
        tracing::info!("[tmux-debug] build command: list_panes window_id={:?}, cmd={:?}", window_id, cmd);
        cmd
    }

    /// `tmux capture-pane -S -N -p -t <pane>`
    pub fn capture_pane(&self, pane_id: &str, start_line: i32) -> String {
        let cmd = format!(
            "{} capture-pane -t {} -S {} -p\n",
            self.base(),
            shell_quote(pane_id),
            start_line
        );
        tracing::info!("[tmux-debug] build command: capture_pane pane_id={:?}, cmd={:?}", pane_id, cmd);
        cmd
    }

    /// `tmux send-keys -t <pane> "keys"`
    pub fn send_keys(&self, pane_id: &str, keys: &str) -> String {
        let cmd = format!(
            "{} send-keys -t {} \"{}\"\n",
            self.base(),
            shell_quote(pane_id),
            escape_tmux_keys(keys)
        );
        tracing::info!("[tmux-debug] build command: send_keys pane_id={:?}, keys_len={}, cmd={:?}", pane_id, keys.len(), cmd);
        cmd
    }

    /// `tmux resize-pane -t <pane> -x <cols> -y <rows>`
    pub fn resize_pane(&self, pane_id: &str, rows: u16, cols: u16) -> String {
        let cmd = format!(
            "{} resize-pane -t {} -x {} -y {}\n",
            self.base(),
            shell_quote(pane_id),
            cols,
            rows
        );
        tracing::info!("[tmux-debug] build command: resize_pane pane_id={:?}, rows={}, cols={}, cmd={:?}", pane_id, rows, cols, cmd);
        cmd
    }

    /// `tmux new-session -A -d -s <session> [-n <name>]`
    pub fn new_session(&self, session_id: &str, name: Option<&str>) -> String {
        let mut cmd = format!(
            "{} new-session -A -d -s {}",
            self.base(),
            shell_quote(session_id)
        );
        if let Some(name) = name {
            cmd.push_str(&format!(" -n {}", shell_quote(name)));
        }
        cmd.push('\n');
        tracing::info!("[tmux-debug] build command: new_session session_id={:?}, name={:?}, cmd={:?}", session_id, name, cmd);
        cmd
    }

    /// `tmux new-window -t <session> [-n <name>]`
    pub fn new_window(&self, session_id: &str, name: Option<&str>) -> String {
        let mut cmd = format!("{} new-window -t {}", self.base(), shell_quote(session_id));
        if let Some(name) = name {
            cmd.push_str(&format!(" -n {}", shell_quote(name)));
        }
        cmd.push('\n');
        tracing::info!("[tmux-debug] build command: new_window session_id={:?}, name={:?}, cmd={:?}", session_id, name, cmd);
        cmd
    }

    /// `tmux kill-window -t <window>`
    pub fn kill_window(&self, window_id: &str) -> String {
        let cmd = format!("{} kill-window -t {}\n", self.base(), shell_quote(window_id));
        tracing::info!("[tmux-debug] build command: kill_window window_id={:?}, cmd={:?}", window_id, cmd);
        cmd
    }

    /// `tmux kill-pane -t <pane>`
    pub fn kill_pane(&self, pane_id: &str) -> String {
        let cmd = format!("{} kill-pane -t {}\n", self.base(), shell_quote(pane_id));
        tracing::info!("[tmux-debug] build command: kill_pane pane_id={:?}, cmd={:?}", pane_id, cmd);
        cmd
    }

    /// `tmux split-window -t <pane> [-h|-v]`
    pub fn split_window(&self, pane_id: &str, direction: &str) -> String {
        let flag = match direction {
            "horizontal" | "h" => " -h",
            "vertical" | "v" => " -v",
            _ => "",
        };
        let cmd = format!(
            "{} split-window -t {}{}\n",
            self.base(),
            shell_quote(pane_id),
            flag
        );
        tracing::info!("[tmux-debug] build command: split_window pane_id={:?}, direction={:?}, cmd={:?}", pane_id, direction, cmd);
        cmd
    }
}

fn shell_quote(arg: &str) -> String {
    if arg.chars().any(|c| c.is_whitespace() || c == '"' || c == '\'') {
        format!("\"{}\"", arg.replace('"', "\\\""))
    } else {
        arg.to_string()
    }
}

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
                append_enter(&mut result);
            }
            '\n' => append_enter(&mut result),
            _ => result.push(c),
        }
    }
    result
}

fn append_enter(result: &mut String) {
    if !result.ends_with("Enter") {
        result.push_str("Enter");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_format() {
        let cmd = TmuxCommander::new(None);
        assert_eq!(cmd.version(), "tmux -V\n");
    }

    #[test]
    fn version_with_socket() {
        let cmd = TmuxCommander::new(Some("foo".to_string()));
        assert_eq!(cmd.version(), "tmux -L foo -V\n");
    }

    #[test]
    fn has_session_format() {
        let cmd = TmuxCommander::new(None);
        assert_eq!(cmd.has_session("my-session"), "tmux has-session -t my-session\n");
    }

    #[test]
    fn capture_pane_format() {
        let cmd = TmuxCommander::new(None);
        assert_eq!(
            cmd.capture_pane("%0", -250),
            "tmux capture-pane -t %0 -S -250 -p\n"
        );
    }

    #[test]
    fn send_keys_with_enter() {
        let cmd = TmuxCommander::new(None);
        assert_eq!(cmd.send_keys("%0", "hi\n"), "tmux send-keys -t %0 \"hiEnter\"\n");
    }

    #[test]
    fn split_window_horizontal() {
        let cmd = TmuxCommander::new(None);
        assert_eq!(
            cmd.split_window("%0", "horizontal"),
            "tmux split-window -t %0 -h\n"
        );
    }
}
