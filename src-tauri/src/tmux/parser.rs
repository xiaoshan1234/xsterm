//! Parser for the tmux control mode protocol (`-C` / `-CC`).
//!
//! The control mode protocol is line-based. In `-CC` mode the server wraps
//! control output in a DCS sequence:
//!
//! ```text
//! ESC P 1000p tmux; <line>\r\n <line>\r\n ... ESC \
//! ```
//!
//! Lines that are not wrapped in DCS are ordinary terminal output and are
//! forwarded unchanged (this can happen when the client is started in `-C`
//! mode without the second `C`).
//!
//! `%output` and `%extended-output` carry arbitrary pane data which has been
//! octal-escaped by tmux. All other lines are UTF-8 text notifications or
//! command response blocks.

use std::collections::VecDeque;

/// A parsed message from the tmux control stream.
#[derive(Debug, Clone, PartialEq)]
pub enum TmuxMessage {
    /// Raw terminal output for a pane. The data has already been unescaped.
    Output {
        pane_id: String,
        data: Vec<u8>,
    },
    /// Extended output includes latency metadata.
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
    /// Parsed output of a `list-windows` command response.
    WindowList(Vec<WindowListEntry>),
    /// Parsed output of a `list-panes` command response.
    PaneList(Vec<PaneListEntry>),
    Unknown { raw: String },
}

#[derive(Debug, Clone, PartialEq)]
pub struct WindowListEntry {
    pub window_id: String,
    pub session_id: String,
    pub name: String,
    pub active: bool,
    pub layout: String,
}

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

/// Incremental parser for the tmux control mode byte stream.
#[derive(Debug, Default)]
pub struct TmuxControlParser {
    buffer: Vec<u8>,
    pending_response: Option<PendingResponse>,
    pending_dcs_messages: VecDeque<TmuxMessage>,
    in_dcs: bool,
}

#[derive(Debug, Clone)]
struct PendingResponse {
    timestamp: u64,
    cmd_num: u64,
    flags: u64,
    lines: Vec<String>,
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

    /// Create a new parser with an empty buffer.
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed more bytes into the parser and return any complete messages.
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

    /// Attempt to parse a single message from the head of the buffer.
    fn try_parse_one(&mut self) -> Option<TmuxMessage> {
        // Return any messages produced from a previous DCS block first.
        if let Some(message) = self.pending_dcs_messages.pop_front() {
            return Some(message);
        }

        // In -CC mode tmux emits an unterminated DCS introducer and keeps
        // sending control lines inside the DCS until the client exits and the
        // ST terminator is sent. Strip the introducer/terminator and parse
        // the enclosed lines as ordinary control lines.
        if !self.in_dcs && self.buffer.starts_with(Self::DCS_START) {
            self.buffer.drain(..Self::DCS_START.len());
            self.in_dcs = true;
        }

        if self.in_dcs {
            if self.buffer.starts_with(Self::DCS_END) {
                self.buffer.drain(..Self::DCS_END.len());
                self.in_dcs = false;
                return self.try_parse_one();
            }

            if let Some(line) = self.take_line() {
                if line.is_empty() {
                    return self.try_parse_one();
                }
                return self.handle_control_line(&line);
            }

            return None;
        }

        // Plain control line outside DCS (used by -C mode without wrapping).
        if let Some(line) = self.take_line() {
            if !line.is_empty() {
                return self.handle_control_line(&line);
            }
            return self.try_parse_one();
        }

        None
    }

    fn handle_control_line(&mut self, line: &str) -> Option<TmuxMessage> {
        let message = self.parse_control_line(line);

        if let TmuxMessage::Notification { name, args, .. } = &message {
            if name == "begin" && args.len() >= 3 {
                let timestamp = args[0].parse().unwrap_or(0);
                let cmd_num = args[1].parse().unwrap_or(0);
                let flags = args[2].parse().unwrap_or(0);
                tracing::info!(
                    "tmux begin response: cmd_num={} flags={}",
                    cmd_num,
                    flags
                );
                self.pending_response = Some(PendingResponse {
                    timestamp,
                    cmd_num,
                    flags,
                    lines: Vec::new(),
                });
                return None;
            }

            if name == "end" && args.len() >= 3 {
                if let Some(pending) = self.pending_response.take() {
                    tracing::info!(
                        "tmux end response: cmd_num={} lines={}",
                        pending.cmd_num,
                        pending.lines.len()
                    );
                    let response = TmuxMessage::CommandResponse {
                        timestamp: pending.timestamp,
                        cmd_num: pending.cmd_num,
                        flags: pending.flags,
                        success: true,
                        lines: pending.lines,
                    };
                    return Some(classify_command_response(response));
                }
                return None;
            }

            if name == "error" && args.len() >= 3 {
                if let Some(pending) = self.pending_response.take() {
                    return Some(TmuxMessage::CommandResponse {
                        timestamp: pending.timestamp,
                        cmd_num: pending.cmd_num,
                        flags: pending.flags,
                        success: false,
                        lines: pending.lines,
                    });
                }
                return None;
            }
        }

        if let Some(pending) = self.pending_response.as_mut() {
            pending.lines.push(line.to_string());
            return None;
        }

        Some(message)
    }

    /// Take a complete line from the buffer, if one exists.
    ///
    /// Tmux uses `\n` to terminate control lines; some paths include an
    /// additional `\r` before it. Both `\n` and `\r\n` are accepted.
    fn take_line(&mut self) -> Option<String> {
        if let Some(pos) = self.buffer.iter().position(|&b| b == b'\n') {
            let mut line_bytes = self.buffer.drain(..pos).collect::<Vec<u8>>();
            self.buffer.drain(..1); // drop \n

            // Strip a single trailing \r if present.
            if line_bytes.last() == Some(&b'\r') {
                line_bytes.pop();
            }

            Some(String::from_utf8_lossy(&line_bytes).into_owned())
        } else {
            None
        }
    }

    /// Parse the content of a DCS block, which is a sequence of control lines.
    #[allow(dead_code)]
    fn parse_dcs_block(&mut self, _block: &[u8]) -> Vec<TmuxMessage> {
        Vec::new()
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

    /// Flush any remaining buffered data, returning messages that can be
    /// produced without waiting for more input.
    pub fn flush(&mut self) -> Vec<TmuxMessage> {
        let mut messages = Vec::new();

        // If there is a complete line remaining (without trailing \r\n),
        // process it.
        if !self.buffer.is_empty() && !self.buffer.ends_with(b"\r") {
            let line = String::from_utf8_lossy(&self.buffer).into_owned();
            self.buffer.clear();
            if !line.is_empty() {
                messages.push(self.parse_control_line(&line));
            }
        }

        // Any pending command response is lost/unfinished; emit it as an error.
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
}

/// Parse `%output` or `%extended-output` payload.
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

/// Convert tmux octal escape sequences (`\134`) back into raw bytes.
fn unescape_tmux_output(input: &str) -> Vec<u8> {
    let mut result = Vec::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'\\' && i + 4 <= bytes.len() {
            let octal = &bytes[i + 1..i + 4];
            if let Ok(s) = std::str::from_utf8(octal) {
                if let Ok(value) = u8::from_str_radix(s, 8) {
                    result.push(value);
                    i += 4;
                    continue;
                }
            }
        }
        result.push(bytes[i]);
        i += 1;
    }

    result
}

fn classify_command_response(message: TmuxMessage) -> TmuxMessage {
    if let TmuxMessage::CommandResponse {
        success: true,
        lines,
        ..
    } = &message
    {
        if let Some(first) = lines.first() {
            let parts: Vec<&str> = first.split('\t').collect();
            if parts.len() >= 7 && parts[0].starts_with('$') && parts[2].starts_with('%') {
                return parse_pane_list(lines);
            }
            if parts.len() >= 5 && parts[0].starts_with('$') && parts[1].starts_with('@') {
                return parse_window_list(lines);
            }
        }
    }
    message
}

fn parse_window_list(lines: &[String]) -> TmuxMessage {
    let mut entries = Vec::new();
    for line in lines {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 5 {
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
        if parts.len() < 7 {
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
