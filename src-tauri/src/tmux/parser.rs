//! Parser for the tmux control mode protocol (`-C` / `-CC`).
//!
//! The control mode protocol is line-based. In `-CC` mode the server wraps
//! control output in a DCS (Device Control String) sequence:
//!
//! ```text
//! ESC P 1000p tmux; <line>\r\n <line>\r\n ... ESC \
//! ```
//!
//! `ESC P 1000p` is the DCS introducer, `ESC \` is the DCS terminator (ST).
//! tmux keeps the DCS open for the lifetime of the control client, sending
//! each protocol line inside the DCS string. This parser strips the wrapper
//! and emits structured messages.
//!
//! Lines that are not wrapped in DCS are ordinary terminal output or control
//! lines without wrapping (this can happen when the client is started in `-C`
//! mode without the second `C`). They are forwarded/parsed unchanged.
//!
//! `%output` and `%extended-output` carry arbitrary pane data which has been
//! octal-escaped by tmux (e.g. `\134` for a backslash). All other lines are
//! UTF-8 text notifications or command response blocks.
//!
//! Command responses are bracketed by `%begin <timestamp> <cmd_num> <flags>`
//! and `%end <timestamp> <cmd_num> <flags>` (or `%error` on failure). The
//! lines between them are the textual response. The parser classifies some
//! common list responses (`list-windows`, `list-panes`) into structured
//! variants of [`TmuxMessage`].

use std::collections::VecDeque;

// ===================================================================
// Message types
// ===================================================================

/// A parsed message from the tmux control stream.
#[derive(Debug, Clone, PartialEq)]
pub enum TmuxMessage {
    /// Raw terminal output for a pane. The data has already been unescaped.
    Output { pane_id: String, data: Vec<u8> },
    /// Extended output includes latency metadata (`age_ms`).
    ExtendedOutput {
        pane_id: String,
        age_ms: u64,
        data: Vec<u8>,
    },
    /// A one-line control notification such as `%window-add @0`.
    Notification {
        name: String,
        args: Vec<String>,
        raw: String,
    },
    /// A complete command response block.
    CommandResponse {
        timestamp: u64,
        cmd_num: u64,
        flags: u64,
        success: bool,
        lines: Vec<String>,
    },
    /// Text captured by `capture-pane` for a specific pane.
    CapturedPaneOutput { pane_id: String, lines: Vec<String> },
    /// Parsed output of a `list-windows` command response.
    WindowList(Vec<WindowListEntry>),
    /// Parsed output of a `list-panes` command response.
    PaneList(Vec<PaneListEntry>),
    /// A line that does not match any known protocol pattern.
    Unknown { raw: String },
}

/// Factory for classifying the next pending command response.
///
/// Tmux control mode does not support client-assigned command ids, so when
/// we issue a command whose response needs special handling (e.g. `capture-pane`)
/// we register this callback. It is invoked when `%begin` arrives and returns
/// an optional pane id that tells the parser to treat the response as captured
/// pane output.
pub type ResponseClassifier = Option<Box<dyn FnMut() -> Option<String> + Send>>;

/// One row from a `list-windows -F` tab-separated response.
#[derive(Debug, Clone, PartialEq)]
pub struct WindowListEntry {
    pub window_id: String,
    pub session_id: String,
    pub name: String,
    pub active: bool,
    pub layout: String,
}

/// One row from a `list-panes -F` tab-separated response.
#[derive(Debug, Clone, PartialEq)]
pub struct PaneListEntry {
    pub pane_id: String,
    pub window_id: String,
    pub session_id: String,
    pub title: String,
    pub active: bool,
    pub width: u16,
    pub height: u16,
}

// ===================================================================
// Parser state
// ===================================================================

/// Incremental parser for the tmux control mode byte stream.
pub struct TmuxControlParser {
    buffer: Vec<u8>,
    pending_response: Option<PendingResponse>,
    pending_dcs_messages: VecDeque<TmuxMessage>,
    in_dcs: bool,
    response_classifier: ResponseClassifier,
}

#[derive(Debug, Clone)]
struct PendingResponse {
    timestamp: u64,
    cmd_num: u64,
    flags: u64,
    lines: Vec<String>,
    capture_pane_id: Option<String>,
}

impl Default for TmuxControlParser {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for TmuxControlParser {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TmuxControlParser")
            .field("buffer_len", &self.buffer.len())
            .field("pending_response", &self.pending_response)
            .field("pending_dcs_messages", &self.pending_dcs_messages)
            .field("in_dcs", &self.in_dcs)
            .field("has_classifier", &self.response_classifier.is_some())
            .finish()
    }
}

impl TmuxControlParser {
    /// DCS introducer used by tmux `-CC` mode: `ESC P 1000p`.
    ///
    /// The control client emits this unterminated DCS at the start of the
    /// connection; each subsequent control line is sent inside the DCS string
    /// until an `ST` (`ESC \`) terminator is emitted on exit.
    const DCS_START: &'static [u8] = b"\x1bP1000p";

    /// DCS terminator: `ST` (`ESC \`).
    const DCS_END: &'static [u8] = b"\x1b\\";

    /// Minimum number of arguments expected after `%begin` / `%end` / `%error`.
    const RESPONSE_HEADER_ARG_COUNT: usize = 3;

    /// Create a new parser with an empty buffer.
    pub fn new() -> Self {
        Self {
            buffer: Vec::new(),
            pending_response: None,
            pending_dcs_messages: VecDeque::new(),
            in_dcs: false,
            response_classifier: None,
        }
    }

    /// Create a parser that uses `classifier` to identify special responses.
    pub fn with_classifier<F>(classifier: F) -> Self
    where
        F: FnMut() -> Option<String> + Send + 'static,
    {
        Self {
            response_classifier: Some(Box::new(classifier)),
            ..Self::default()
        }
    }

    // ===============================================================
    // Public API
    // ===============================================================

    /// Feed more bytes into the parser and return any complete messages.
    ///
    /// Iterates until the buffer stops shrinking, so a single `parse` call can
    /// produce many messages.
    pub fn parse(&mut self, data: &[u8]) -> Vec<TmuxMessage> {
        self.buffer.extend_from_slice(data);
        let mut messages = Vec::new();

        loop {
            let prev_len = self.buffer.len();
            if let Some(message) = self.try_parse_one() {
                messages.push(message);
            }
            if self.buffer.len() == prev_len {
                break;
            }
        }

        messages
    }

    /// Flush any remaining buffered data, returning messages that can be
    /// produced without waiting for more input.
    pub fn flush(&mut self) -> Vec<TmuxMessage> {
        let mut messages = Vec::new();

        if !self.buffer.is_empty() && !self.buffer.ends_with(b"\r") {
            let line = String::from_utf8_lossy(&self.buffer).into_owned();
            self.buffer.clear();
            if !line.is_empty() {
                messages.push(self.parse_control_line(&line));
            }
        }

        if let Some(pending) = self.pending_response.take() {
            messages.push(TmuxMessage::CommandResponse {
                timestamp: pending.timestamp,
                cmd_num: pending.cmd_num,
                flags: pending.flags,
                success: false,
                lines: pending.lines,
            });
        }

        messages
    }

    // ===============================================================
    // Main parse loop
    // ===============================================================

    /// Attempt to parse a single message from the head of the buffer.
    fn try_parse_one(&mut self) -> Option<TmuxMessage> {
        if let Some(message) = self.pending_dcs_messages.pop_front() {
            return Some(message);
        }

        if !self.in_dcs {
            if self.consume_dcs_introducer() {
                self.in_dcs = true;
            }
        }

        if self.in_dcs {
            if self.consume_dcs_terminator() {
                self.in_dcs = false;
                return self.try_parse_one();
            }

            let line = self.take_line()?;
            if line.is_empty() {
                return self.try_parse_one();
            }
            return self.handle_control_line(&line);
        }

        // Plain control line outside DCS (used by -C mode without wrapping).
        let line = self.take_line()?;
        if line.is_empty() {
            return self.try_parse_one();
        }
        self.handle_control_line(&line)
    }

    // ===============================================================
    // DCS wrapper handling
    // ===============================================================

    /// If the buffer begins with the DCS introducer, consume it.
    fn consume_dcs_introducer(&mut self) -> bool {
        if self.buffer.starts_with(Self::DCS_START) {
            self.buffer.drain(..Self::DCS_START.len());
            true
        } else {
            false
        }
    }

    /// If the buffer begins with the DCS terminator, consume it.
    fn consume_dcs_terminator(&mut self) -> bool {
        if self.buffer.starts_with(Self::DCS_END) {
            self.buffer.drain(..Self::DCS_END.len());
            true
        } else {
            false
        }
    }

    // ===============================================================
    // Line extraction
    // ===============================================================

    /// Take a complete line from the buffer, if one exists.
    ///
    /// Strips the trailing newline (and carriage return if present). The line
    /// is returned as a lossy UTF-8 string because protocol lines are text,
    /// while `%output` payload is unescaped separately into raw bytes.
    fn take_line(&mut self) -> Option<String> {
        let pos = self.buffer.iter().position(|&b| b == b'\n')?;
        let mut line_bytes: Vec<u8> = self.buffer.drain(..pos).collect();
        self.buffer.drain(..1); // drop \n

        if line_bytes.last() == Some(&b'\r') {
            line_bytes.pop();
        }

        Some(String::from_utf8_lossy(&line_bytes).into_owned())
    }

    // ===============================================================
    // Control-line dispatch
    // ===============================================================

    /// Parse a single control-mode line and integrate it with the current
    /// command response state.
    fn handle_control_line(&mut self, line: &str) -> Option<TmuxMessage> {
        let message = self.parse_control_line(line);

        if let TmuxMessage::Notification { name, args, .. } = &message {
            if let Some(response_message) = self.handle_response_notification(name, args) {
                return response_message;
            }
        }

        if let Some(pending) = self.pending_response.as_mut() {
            pending.lines.push(line.to_string());
            return None;
        }

        Some(message)
    }

    /// Parse a single control-mode line into a structured message.
    fn parse_control_line(&self, line: &str) -> TmuxMessage {
        if let Some(rest) = line.strip_prefix("%output ") {
            return parse_output_line(rest, false);
        }

        if let Some(rest) = line.strip_prefix("%extended-output ") {
            return parse_output_line(rest, true);
        }

        if let Some(rest) = line.strip_prefix('%') {
            let mut parts = rest.split_whitespace().map(String::from);
            let name = parts.next().unwrap_or_default();
            let args = parts.collect();
            return TmuxMessage::Notification {
                name,
                args,
                raw: line.to_string(),
            };
        }

        TmuxMessage::Unknown {
            raw: line.to_string(),
        }
    }

    // ===============================================================
    // Command response block handling
    // ===============================================================

    /// Handle `%begin`, `%end`, and `%error` notifications that delimit a
    /// command response block.
    ///
    /// Returns `Some(message)` when a block completes, otherwise `None`.
    fn handle_response_notification(
        &mut self,
        name: &str,
        args: &[String],
    ) -> Option<Option<TmuxMessage>> {
        match name {
            "begin" if args.len() >= Self::RESPONSE_HEADER_ARG_COUNT => {
                self.start_command_response(args);
                Some(None)
            }
            "end" if args.len() >= Self::RESPONSE_HEADER_ARG_COUNT => {
                Some(self.finish_command_response())
            }
            "error" if args.len() >= Self::RESPONSE_HEADER_ARG_COUNT => {
                Some(self.abort_command_response())
            }
            _ => None,
        }
    }

    fn start_command_response(&mut self, args: &[String]) {
        let timestamp = args[0].parse().unwrap_or(0);
        let cmd_num = args[1].parse().unwrap_or(0);
        let flags = args[2].parse().unwrap_or(0);

        tracing::trace!("tmux begin response: cmd_num={} flags={}", cmd_num, flags);

        let capture_pane_id = self.response_classifier.as_mut().and_then(|c| c());

        self.pending_response = Some(PendingResponse {
            timestamp,
            cmd_num,
            flags,
            lines: Vec::new(),
            capture_pane_id,
        });
    }

    fn finish_command_response(&mut self) -> Option<TmuxMessage> {
        let pending = self.pending_response.take()?;

        tracing::trace!(
            "tmux end response: cmd_num={} lines={}",
            pending.cmd_num,
            pending.lines.len()
        );

        if let Some(pane_id) = pending.capture_pane_id {
            return Some(TmuxMessage::CapturedPaneOutput {
                pane_id,
                lines: pending.lines,
            });
        }

        let response = TmuxMessage::CommandResponse {
            timestamp: pending.timestamp,
            cmd_num: pending.cmd_num,
            flags: pending.flags,
            success: true,
            lines: pending.lines,
        };

        Some(classify_command_response(response))
    }

    fn abort_command_response(&mut self) -> Option<TmuxMessage> {
        let pending = self.pending_response.take()?;

        if pending.capture_pane_id.is_some() {
            return None;
        }

        Some(TmuxMessage::CommandResponse {
            timestamp: pending.timestamp,
            cmd_num: pending.cmd_num,
            flags: pending.flags,
            success: false,
            lines: pending.lines,
        })
    }
}

// ===================================================================
// Output-line parsing
// ===================================================================

/// Parse `%output` or `%extended-output` payload.
///
/// `%output` format: `%<pane_id> <octal_escaped_data>`
/// `%extended-output` format: `%<pane_id> <age_ms> : <octal_escaped_data>`
fn parse_output_line(rest: &str, extended: bool) -> TmuxMessage {
    let mut parts = rest.splitn(2, ' ');
    let pane_id = parts.next().unwrap_or("").to_string();
    let remainder = parts.next().unwrap_or("");

    if extended {
        // Format: %<pane_id> <age_ms> : <data>
        let mut age_parts = remainder.splitn(2, " : ");
        let age_ms = age_parts
            .next()
            .and_then(|s| s.split_whitespace().next())
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let data_str = age_parts.next().unwrap_or("");
        TmuxMessage::ExtendedOutput {
            pane_id,
            age_ms,
            data: unescape_tmux_output(data_str),
        }
    } else {
        TmuxMessage::Output {
            pane_id,
            data: unescape_tmux_output(remainder),
        }
    }
}

// ===================================================================
// Octal unescaping
// ===================================================================

/// Convert tmux octal escape sequences (`\134`) back into raw bytes.
///
/// Tmux escapes arbitrary pane bytes as three-digit octal values preceded by a
/// backslash. For example, a backslash (`0x5c`) becomes `\134` and a newline
/// (`0x0a`) becomes `\012`. This function is intentionally permissive: an
/// invalid or incomplete escape is copied literally.
fn unescape_tmux_output(input: &str) -> Vec<u8> {
    let mut result = Vec::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;

    // An octal escape is a backslash followed by exactly three octal digits.
    const OCTAL_ESCAPE_LEN: usize = 4;

    while i < bytes.len() {
        if bytes[i] == b'\\' && i + OCTAL_ESCAPE_LEN <= bytes.len() {
            let octal = &bytes[i + 1..i + OCTAL_ESCAPE_LEN];
            if let Ok(s) = std::str::from_utf8(octal) {
                if let Ok(value) = u8::from_str_radix(s, 8) {
                    result.push(value);
                    i += OCTAL_ESCAPE_LEN;
                    continue;
                }
            }
        }
        result.push(bytes[i]);
        i += 1;
    }

    result
}

// ===================================================================
// Command response classification
// ===================================================================

/// Columns expected in a `list-panes -F` tab-separated response.
///
/// Format: `#{session_id}\t#{window_id}\t#{pane_id}\t#{pane_active}\t#{pane_width}\t#{pane_height}\t#{pane_title}`
const PANE_LIST_MIN_COLUMNS: usize = 7;

/// Columns expected in a `list-windows -F` tab-separated response.
///
/// Format: `#{session_id}\t#{window_id}\t#{window_active}\t#{window_layout}\t#{window_name}`
const WINDOW_LIST_MIN_COLUMNS: usize = 5;

/// Inspect a successful command response and convert known list formats into
/// structured [`TmuxMessage`] variants.
fn classify_command_response(message: TmuxMessage) -> TmuxMessage {
    let TmuxMessage::CommandResponse {
        success: true,
        lines,
        ..
    } = &message
    else {
        return message;
    };

    let Some(first) = lines.first() else {
        return message;
    };

    let parts: Vec<&str> = first.split('\t').collect();

    // Pane rows start with a session id (`$N`) and have the pane id (`%N`) in
    // the third column; window rows start with a session id and have the
    // window id (`@N`) in the second column.
    if parts.len() >= PANE_LIST_MIN_COLUMNS
        && parts[0].starts_with('$')
        && parts[2].starts_with('%')
    {
        return parse_pane_list(lines);
    }

    if parts.len() >= WINDOW_LIST_MIN_COLUMNS
        && parts[0].starts_with('$')
        && parts[1].starts_with('@')
    {
        return parse_window_list(lines);
    }

    message
}

fn parse_window_list(lines: &[String]) -> TmuxMessage {
    let mut entries = Vec::new();
    for line in lines {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < WINDOW_LIST_MIN_COLUMNS {
            continue;
        }
        entries.push(WindowListEntry {
            session_id: parts[0].to_string(),
            window_id: parts[1].to_string(),
            active: parts[2] == "1",
            layout: parts[3].to_string(),
            name: parts[4].to_string(),
        });
    }
    TmuxMessage::WindowList(entries)
}

fn parse_pane_list(lines: &[String]) -> TmuxMessage {
    let mut entries = Vec::new();
    for line in lines {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < PANE_LIST_MIN_COLUMNS {
            continue;
        }
        entries.push(PaneListEntry {
            session_id: parts[0].to_string(),
            window_id: parts[1].to_string(),
            pane_id: parts[2].to_string(),
            active: parts[3] == "1",
            width: parts[4].parse().unwrap_or(0),
            height: parts[5].parse().unwrap_or(0),
            title: parts[6].to_string(),
        });
    }
    TmuxMessage::PaneList(entries)
}

// ===================================================================
// Tests
// ===================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_output_with_octal_escape() {
        // \134 is an escaped backslash, \012 is a newline.
        let line = "%output %0 hello\\134\\012world\n";
        let msg = TmuxControlParser::new().parse(line.as_bytes());
        assert_eq!(msg.len(), 1);
        assert_eq!(
            msg[0],
            TmuxMessage::Output {
                pane_id: "%0".to_string(),
                data: b"hello\\\nworld".to_vec(),
            }
        );
    }

    #[test]
    fn parses_dcs_wrapped_block() {
        let block = b"\x1bP1000p%output %0 hi\r\n%window-add @0\r\n\x1b\\";
        let mut parser = TmuxControlParser::new();
        let msgs = parser.parse(block);
        assert_eq!(msgs.len(), 2);
        assert_eq!(
            msgs[0],
            TmuxMessage::Output {
                pane_id: "%0".to_string(),
                data: b"hi".to_vec(),
            }
        );
        assert_eq!(
            msgs[1],
            TmuxMessage::Notification {
                name: "window-add".to_string(),
                args: vec!["@0".to_string()],
                raw: "%window-add @0".to_string(),
            }
        );
    }

    #[test]
    fn parses_streaming_dcs_session() {
        let mut parser = TmuxControlParser::new();
        let msgs = parser.parse(b"\x1bP1000p%begin 0 1 0\r\n%output %0 hi\r\n%end 0 1 0\r\n");
        assert_eq!(msgs.len(), 1);
        assert!(
            matches!(&msgs[0], TmuxMessage::CommandResponse { cmd_num: 1, success: true, lines, .. } if lines == &["%output %0 hi"]),
            "expected CommandResponse containing output line, got {:?}",
            msgs[0]
        );
    }

    #[test]
    fn parses_dcs_terminator_then_plain_line() {
        let mut parser = TmuxControlParser::new();
        let msgs = parser.parse(b"\x1bP1000p%exit\r\n\x1b\\");
        assert_eq!(msgs.len(), 1);
        assert!(
            matches!(&msgs[0], TmuxMessage::Notification { name, .. } if name == "exit"),
            "expected exit notification, got {:?}",
            msgs[0]
        );
    }

    #[test]
    fn parses_command_response_block() {
        let block = b"\x1bP1000p%begin 123 1 0\r\n0: bash\r\n%end 123 1 0\r\n\x1b\\";
        let mut parser = TmuxControlParser::new();
        let msgs = parser.parse(block);
        assert_eq!(msgs.len(), 1);
        assert_eq!(
            msgs[0],
            TmuxMessage::CommandResponse {
                timestamp: 123,
                cmd_num: 1,
                flags: 0,
                success: true,
                lines: vec!["0: bash".to_string()],
            }
        );
    }

    #[test]
    fn parses_list_windows_response() {
        let block = b"\x1bP1000p%begin 0 1 0\r\n$0\t@0\t1\tc080,80x24,0,0,0\tbash\r\n$0\t@1\t0\tc080,80x24,0,0,1\tvim\r\n%end 0 1 0\r\n\x1b\\";
        let mut parser = TmuxControlParser::new();
        let msgs = parser.parse(block);
        assert_eq!(msgs.len(), 1);

        if let TmuxMessage::WindowList(entries) = &msgs[0] {
            assert_eq!(entries.len(), 2);
            assert_eq!(entries[0].window_id, "@0");
            assert_eq!(entries[0].session_id, "$0");
            assert_eq!(entries[0].name, "bash");
            assert!(entries[0].active);
            assert_eq!(entries[0].layout, "c080,80x24,0,0,0");
            assert_eq!(entries[1].window_id, "@1");
            assert_eq!(entries[1].name, "vim");
            assert!(!entries[1].active);
        } else {
            panic!("expected WindowList, got {:?}", msgs[0]);
        }
    }

    #[test]
    fn parses_list_panes_response() {
        let block = b"\x1bP1000p%begin 0 1 0\r\n$0\t@0\t%0\t1\t80\t24\tbash\r\n$0\t@0\t%1\t0\t80\t24\tvim\r\n%end 0 1 0\r\n\x1b\\";
        let mut parser = TmuxControlParser::new();
        let msgs = parser.parse(block);
        assert_eq!(msgs.len(), 1);

        if let TmuxMessage::PaneList(entries) = &msgs[0] {
            assert_eq!(entries.len(), 2);
            assert_eq!(entries[0].pane_id, "%0");
            assert_eq!(entries[0].window_id, "@0");
            assert_eq!(entries[0].session_id, "$0");
            assert_eq!(entries[0].width, 80);
            assert_eq!(entries[0].height, 24);
            assert!(entries[0].active);
            assert_eq!(entries[1].pane_id, "%1");
            assert!(!entries[1].active);
        } else {
            panic!("expected PaneList, got {:?}", msgs[0]);
        }
    }
}
