//! Incremental parser for tmux `-CC` control mode byte streams.
//!
//! Tmux wraps each protocol line in a DCS sequence when started with `-CC`:
//!
//! ```text
//! ESC P 1000p tmux; <line> \r\n <line> ... ESC \
//! ```
//!
//! This parser unwraps the DCS envelope, decodes octal escapes in `%output`
//! payloads, and aggregates command response blocks delimited by `%begin` /
//! `%end` or `%error`.

use serde::{Deserialize, Serialize};

const DCS_INTRODUCER: &[u8] = b"\x1bP1000p tmux;";
const DCS_TERMINATOR: &[u8] = b"\x1b\\";

/// A type alias for a closure that classifies an outstanding command response.
///
/// The parser calls this closure when a `%begin` is received. If the closure
/// returns `Some(pane_id)`, the response is treated as the captured output for
/// that pane; otherwise it is returned as a generic `CommandResponse`.
pub type ResponseClassifier = Option<Box<dyn FnMut() -> Option<String> + Send>>;

/// Parsed line-oriented message from tmux control mode.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TmuxMessage {
    /// Terminal output for a pane (`%output %<pid> <data>`).
    Output {
        pane_id: String,
        data: Vec<u8>,
    },
    /// Output with an age hint (`%extended-output %<pid> <age_ms> : <data>`).
    ExtendedOutput {
        pane_id: String,
        age_ms: u64,
        data: Vec<u8>,
    },
    /// Captured pane output from a `capture-pane` command response.
    CapturedPaneOutput {
        pane_id: String,
        data: Vec<u8>,
    },
    /// Successful command response block.
    CommandResponse {
        cmd_num: usize,
        lines: Vec<String>,
    },
    /// Error command response block.
    CommandError {
        cmd_num: usize,
        lines: Vec<String>,
    },
    /// Parsed `list-windows` response.
    WindowList(Vec<WindowListEntry>),
    /// Parsed `list-panes` response.
    PaneList(Vec<PaneListEntry>),
    /// Generic control notification.
    Notification {
        name: String,
        args: Vec<String>,
    },
    /// Client disconnect.
    Exit {
        reason: Option<String>,
    },
    /// Unrecognized line.
    Unknown {
        raw: String,
    },
}

/// Entry produced by `tmux list-windows -F ...`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowListEntry {
    pub window_id: String,
    pub session_id: String,
    pub name: String,
    pub active: bool,
    pub layout: String,
}

/// Entry produced by `tmux list-panes -F ...`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneListEntry {
    pub pane_id: String,
    pub window_id: String,
    pub session_id: String,
    pub active: bool,
    pub width: u16,
    pub height: u16,
    pub cwd: String,
    pub title: String,
}

struct PendingResponse {
    lines: Vec<String>,
    capture_pane_id: Option<String>,
}

/// Incremental parser for tmux `-CC` control mode.
#[derive(Default)]
pub struct TmuxControlParser {
    buffer: Vec<u8>,
    in_dcs: bool,
    pending_response: Option<PendingResponse>,
    classifier: ResponseClassifier,
}

impl TmuxControlParser {
    /// Create a new parser with no response classifier.
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a parser with a classifier for `capture-pane` responses.
    pub fn with_classifier(classifier: impl FnMut() -> Option<String> + Send + 'static) -> Self {
        let mut parser = Self::new();
        parser.classifier = Some(Box::new(classifier));
        parser
    }

    /// Feed raw bytes into the parser and return all complete messages.
    pub fn parse(&mut self, bytes: &[u8]) -> Vec<TmuxMessage> {
        self.buffer.extend_from_slice(bytes);
        let mut messages = Vec::new();
        while let Some(msg) = self.try_parse_one() {
            messages.push(msg);
        }
        messages
    }

    fn try_parse_one(&mut self) -> Option<TmuxMessage> {
        loop {
            let line = self.next_control_line()?;
            if let Some(msg) = self.handle_control_line(&line) {
                return Some(msg);
            }
        }
    }

    fn next_control_line(&mut self) -> Option<String> {
        if !self.in_dcs {
            if let Some(intro_pos) = find_pattern(&self.buffer, DCS_INTRODUCER) {
                if intro_pos > 0 {
                    if let Some(line) = take_line_bounded(&mut self.buffer, intro_pos) {
                        return Some(line);
                    }
                    self.buffer.drain(..intro_pos);
                }
                self.buffer.drain(..DCS_INTRODUCER.len());
                self.in_dcs = true;
                return self.next_control_line();
            }
            return take_line(&mut self.buffer);
        }

        if let Some(term_pos) = find_pattern(&self.buffer, DCS_TERMINATOR) {
            if let Some(line) = take_line_bounded(&mut self.buffer, term_pos) {
                return Some(line);
            }
            self.buffer.drain(..term_pos + DCS_TERMINATOR.len());
            self.in_dcs = false;
            return self.next_control_line();
        }

        take_line(&mut self.buffer)
    }

    fn handle_control_line(&mut self, line: &str) -> Option<TmuxMessage> {
        if let Some(pending) = &mut self.pending_response {
            if let Some(rest) = line.strip_prefix("%end ") {
                let cmd_num = parse_cmd_num(rest);
                let lines = std::mem::take(&mut pending.lines);
                let capture_id = pending.capture_pane_id.take();
                self.pending_response = None;
                return if let Some(pane_id) = capture_id {
                    Some(TmuxMessage::CapturedPaneOutput {
                        pane_id,
                        data: lines.join("\n").into_bytes(),
                    })
                } else {
                    let response = TmuxMessage::CommandResponse { cmd_num, lines };
                    Some(classify_command_response(response))
                };
            }
            if line.starts_with("%error ") {
                let cmd_num = parse_cmd_num(line);
                let lines = std::mem::take(&mut pending.lines);
                self.pending_response = None;
                return Some(TmuxMessage::CommandError { cmd_num, lines });
            }
            pending.lines.push(line.to_string());
            return None;
        }

        if let Some(rest) = line.strip_prefix("%output ") {
            let (pane_id, data) = parse_output_line(rest);
            return Some(TmuxMessage::Output { pane_id, data });
        }
        if let Some(rest) = line.strip_prefix("%extended-output ") {
            return Some(parse_extended_output_line(rest));
        }
        if let Some(rest) = line.strip_prefix("%begin ") {
            let _cmd_num = parse_cmd_num(rest);
            let capture_pane_id = self.classifier.as_mut().and_then(|c| c());
            self.pending_response = Some(PendingResponse {
                lines: Vec::new(),
                capture_pane_id,
            });
            return None;
        }
        if line == "%exit" || line.starts_with("%exit ") {
            let reason = line.strip_prefix("%exit ").map(String::from);
            return Some(TmuxMessage::Exit { reason });
        }
        if line.starts_with('%') {
            let mut parts = line.split_whitespace();
            let name = parts.next().unwrap_or("").trim_start_matches('%').to_string();
            let args = parts.map(String::from).collect();
            return Some(TmuxMessage::Notification { name, args });
        }

        Some(TmuxMessage::Unknown { raw: line.to_string() })
    }
}

fn parse_cmd_num(s: &str) -> usize {
    s.split_whitespace()
        .nth(1)
        .and_then(|n| n.parse().ok())
        .unwrap_or(0)
}

fn parse_output_line(rest: &str) -> (String, Vec<u8>) {
    let mut parts = rest.splitn(2, ' ');
    let pane_id = parts.next().unwrap_or("").to_string();
    let data = parts.next().unwrap_or("");
    (pane_id, unescape_tmux_output(data))
}

fn parse_extended_output_line(rest: &str) -> TmuxMessage {
    let mut parts = rest.splitn(2, " : ");
    let head = parts.next().unwrap_or("");
    let data = parts.next().unwrap_or("");
    let mut head_parts = head.splitn(2, ' ');
    let pane_id = head_parts.next().unwrap_or("").to_string();
    let age_ms = head_parts.next().and_then(|n| n.parse().ok()).unwrap_or(0);
    TmuxMessage::ExtendedOutput {
        pane_id,
        age_ms,
        data: unescape_tmux_output(data),
    }
}

fn unescape_tmux_output(s: &str) -> Vec<u8> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\'
            && i + 4 <= bytes.len()
            && is_octal_digit(bytes[i + 1])
            && is_octal_digit(bytes[i + 2])
            && is_octal_digit(bytes[i + 3])
        {
            let oct = std::str::from_utf8(&bytes[i + 1..i + 4]).unwrap_or("000");
            if let Ok(val) = u8::from_str_radix(oct, 8) {
                out.push(val);
                i += 4;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    out
}

fn is_octal_digit(b: u8) -> bool {
    (b'0'..=b'7').contains(&b)
}

fn classify_command_response(response: TmuxMessage) -> TmuxMessage {
    if let TmuxMessage::CommandResponse { ref lines, .. } = response {
        if !lines.is_empty() {
            let first = lines[0].trim();
            if first.starts_with('@') {
                return parse_window_list(lines);
            } else if first.starts_with('%') {
                return parse_pane_list(lines);
            }
        }
    }
    response
}

fn parse_window_list(lines: &[String]) -> TmuxMessage {
    let mut entries = Vec::new();
    for line in lines {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 5 {
            continue;
        }
        entries.push(WindowListEntry {
            window_id: parts[0].to_string(),
            session_id: parts[1].to_string(),
            name: parts[2].to_string(),
            active: parts[3] == "1",
            layout: parts[4].to_string(),
        });
    }
    TmuxMessage::WindowList(entries)
}

fn parse_pane_list(lines: &[String]) -> TmuxMessage {
    let mut entries = Vec::new();
    for line in lines {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 8 {
            continue;
        }
        entries.push(PaneListEntry {
            pane_id: parts[0].to_string(),
            window_id: parts[1].to_string(),
            session_id: parts[2].to_string(),
            active: parts[3] == "1",
            width: parts[4].parse().unwrap_or(0),
            height: parts[5].parse().unwrap_or(0),
            cwd: parts[6].to_string(),
            title: parts[7].to_string(),
        });
    }
    TmuxMessage::PaneList(entries)
}

fn find_pattern(buf: &[u8], pat: &[u8]) -> Option<usize> {
    if pat.is_empty() || buf.len() < pat.len() {
        return None;
    }
    buf.windows(pat.len()).position(|w| w == pat)
}

fn take_line(buf: &mut Vec<u8>) -> Option<String> {
    if let Some(i) = buf.iter().position(|&b| b == b'\n') {
        let content_end = if i > 0 && buf[i - 1] == b'\r' {
            i - 1
        } else {
            i
        };
        let line = String::from_utf8_lossy(&buf[..content_end]).to_string();
        buf.drain(..i + 1);
        Some(line)
    } else {
        None
    }
}

fn take_line_bounded(buf: &mut Vec<u8>, max_pos: usize) -> Option<String> {
    let limit = max_pos.min(buf.len());
    if let Some(i) = buf[..limit].iter().position(|&b| b == b'\n') {
        let content_end = if i > 0 && buf[i - 1] == b'\r' { i - 1 } else { i };
        let line = String::from_utf8_lossy(&buf[..content_end]).to_string();
        buf.drain(..i + 1);
        Some(line)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dcs_wrap(content: &str) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(DCS_INTRODUCER);
        out.extend_from_slice(content.as_bytes());
        out.extend_from_slice(DCS_TERMINATOR);
        out
    }

    #[test]
    fn parses_output_with_octal_escape() {
        let mut parser = TmuxControlParser::new();
        let line = "%output %0 hello\\134world\\012";
        let msgs = parser.parse(line.as_bytes());
        assert_eq!(msgs.len(), 1);
        match &msgs[0] {
            TmuxMessage::Output { pane_id, data } => {
                assert_eq!(pane_id, "%0");
                assert_eq!(data, b"hello\\world\n");
            }
            _ => panic!("expected Output"),
        }
    }

    #[test]
    fn parses_dcs_wrapped_block() {
        let mut parser = TmuxControlParser::new();
        let content = "%output %0 abc\r\n%window-add @1\r\n";
        let msgs = parser.parse(&dcs_wrap(content));
        assert_eq!(msgs.len(), 2);
        assert!(matches!(msgs[0], TmuxMessage::Output { .. }));
        match &msgs[1] {
            TmuxMessage::Notification { name, args } => {
                assert_eq!(name, "window-add");
                assert_eq!(args, &["@1"]);
            }
            _ => panic!("expected window-add notification"),
        }
    }

    #[test]
    fn parses_streaming_dcs_session() {
        let mut parser = TmuxControlParser::new();
        let part1 = b"\x1bP1000p tmux; %begin 123 7 0\r\nline one\r\n";
        let part2 = b"%end 456 7 0\r\n%output %0 data\r\n\x1b\\";

        let msgs1 = parser.parse(part1);
        assert!(msgs1.is_empty());

        let msgs2 = parser.parse(part2);
        assert_eq!(msgs2.len(), 2);
        assert!(matches!(msgs2[0], TmuxMessage::CommandResponse { .. }));
        assert!(matches!(msgs2[1], TmuxMessage::Output { .. }));
    }

    #[test]
    fn parses_dcs_terminator_then_plain_line() {
        let mut parser = TmuxControlParser::new();
        let data = b"\x1bP1000p tmux;\x1b\\%exit\r\n";
        let msgs = parser.parse(data);
        assert_eq!(msgs.len(), 1);
        assert!(matches!(msgs[0], TmuxMessage::Exit { reason: None }));
    }

    #[test]
    fn parses_command_response_block() {
        let mut parser = TmuxControlParser::new();
        let data = b"\x1bP1000p tmux; %begin 0 1 0\r\n@1\t$1\tmain\t1\tbabc,0x0...\r\n%end 0 1 0\r\n\x1b\\";
        let msgs = parser.parse(data);
        assert_eq!(msgs.len(), 1);
        match &msgs[0] {
            TmuxMessage::WindowList(entries) => {
                assert_eq!(entries.len(), 1);
                assert_eq!(entries[0].window_id, "@1");
                assert_eq!(entries[0].session_id, "$1");
                assert_eq!(entries[0].name, "main");
                assert!(entries[0].active);
                assert_eq!(entries[0].layout, "babc,0x0...");
            }
            _ => panic!("expected WindowList"),
        }
    }

    #[test]
    fn parses_list_windows_response() {
        let mut parser = TmuxControlParser::new();
        let data = "\x1bP1000p tmux; %begin 0 1 0\r\n@1\t$1\tmain\t1\tbabc,0x0...\r\n%end 0 1 0\r\n\x1b\\";
        let msgs = parser.parse(data.as_bytes());
        assert_eq!(msgs.len(), 1);
        match &msgs[0] {
            TmuxMessage::WindowList(entries) => {
                assert_eq!(entries.len(), 1);
                assert_eq!(entries[0].window_id, "@1");
                assert_eq!(entries[0].session_id, "$1");
                assert_eq!(entries[0].name, "main");
                assert!(entries[0].active);
                assert_eq!(entries[0].layout, "babc,0x0...");
            }
            _ => panic!("expected WindowList"),
        }
    }

    #[test]
    fn parses_list_panes_response() {
        let mut parser = TmuxControlParser::new();
        let data = "\x1bP1000p tmux; %begin 0 1 0\r\n%1\t@1\t$1\t1\t80\t24\t/home\tzsh\r\n%end 0 1 0\r\n\x1b\\";
        let msgs = parser.parse(data.as_bytes());
        assert_eq!(msgs.len(), 1);
        match &msgs[0] {
            TmuxMessage::PaneList(entries) => {
                assert_eq!(entries.len(), 1);
                assert_eq!(entries[0].pane_id, "%1");
                assert_eq!(entries[0].window_id, "@1");
                assert_eq!(entries[0].session_id, "$1");
                assert!(entries[0].active);
                assert_eq!(entries[0].width, 80);
                assert_eq!(entries[0].height, 24);
                assert_eq!(entries[0].cwd, "/home");
                assert_eq!(entries[0].title, "zsh");
            }
            _ => panic!("expected PaneList"),
        }
    }
}
