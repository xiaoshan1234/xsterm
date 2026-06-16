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
}

/// Incremental parser for the tmux control mode byte stream.
#[derive(Debug, Default)]
pub struct TmuxControlParser {
    buffer: Vec<u8>,
    pending_response: Option<PendingResponse>,
    pending_dcs_messages: VecDeque<TmuxMessage>,
}

#[derive(Debug, Clone)]
struct PendingResponse {
    timestamp: u64,
    cmd_num: u64,
    flags: u64,
    lines: Vec<String>,
}

impl TmuxControlParser {
    /// DCS introducer used by tmux `-CC` mode: `ESC P 1000p tmux;`.
    const DCS_START: &'static [u8] = b"\x1bP1000p tmux;";
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

        while !self.buffer.is_empty() {
            if let Some(message) = self.try_parse_one() {
                messages.push(message);
            } else {
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

        // 1. DCS-wrapped block (-CC mode). Check first because DCS blocks
        // contain \r\n sequences that must not be interpreted as plain lines.
        if let Some(block) = self.take_dcs_block() {
            let block_messages = self.parse_dcs_block(&block);
            if !block_messages.is_empty() {
                self.pending_dcs_messages = block_messages.into();
                return self.pending_dcs_messages.pop_front();
            }
        }

        // 2. Plain control line outside DCS (used by -C mode without wrapping).
        if let Some(line) = self.take_line() {
            if !line.is_empty() {
                return Some(self.parse_control_line(&line));
            }
            // Empty line: keep going; may appear between messages.
            return self.try_parse_one();
        }

        None
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

    /// Extract a DCS-wrapped block if the buffer contains a complete one.
    fn take_dcs_block(&mut self) -> Option<Vec<u8>> {
        let start = self
            .buffer
            .windows(Self::DCS_START.len())
            .position(|w| w == Self::DCS_START)?;
        let after_start = start + Self::DCS_START.len();

        let end = self.buffer[after_start..]
            .windows(Self::DCS_END.len())
            .position(|w| w == Self::DCS_END)?;
        let end_abs = after_start + end;

        let block = self.buffer.drain(after_start..end_abs).collect::<Vec<u8>>();
        // Remove the DCS introducer and terminator.
        self.buffer.drain(..start);
        self.buffer.drain(..Self::DCS_END.len());
        Some(block)
    }

    /// Parse the content of a DCS block, which is a sequence of control lines.
    fn parse_dcs_block(&mut self, block: &[u8]) -> Vec<TmuxMessage> {
        let mut messages = Vec::new();

        // Split the block into lines. Tmux uses \n to terminate lines; some
        // paths include an additional \r before it.
        let lines: Vec<&[u8]> = block
            .split(|&b| b == b'\n')
            .map(|l| l.strip_suffix(b"\r").unwrap_or(l))
            .collect();

        for line_bytes in lines {
            if line_bytes.is_empty() {
                continue;
            }
            let line = String::from_utf8_lossy(line_bytes).into_owned();
            let message = self.parse_control_line(&line);

            // If this is part of a command response block, absorb subsequent
            // lines until we hit %end or %error.
            if let TmuxMessage::Notification { name, args, .. } = &message {
                if name == "begin" && args.len() >= 3 {
                    let timestamp = args[0].parse().unwrap_or(0);
                    let cmd_num = args[1].parse().unwrap_or(0);
                    let flags = args[2].parse().unwrap_or(0);
                    self.pending_response = Some(PendingResponse {
                        timestamp,
                        cmd_num,
                        flags,
                        lines: Vec::new(),
                    });
                    continue;
                }

                if name == "end" && args.len() >= 3 {
                    if let Some(pending) = self.pending_response.take() {
                        messages.push(TmuxMessage::CommandResponse {
                            timestamp: pending.timestamp,
                            cmd_num: pending.cmd_num,
                            flags: pending.flags,
                            success: true,
                            lines: pending.lines,
                        });
                    }
                    continue;
                }

                if name == "error" && args.len() >= 3 {
                    if let Some(pending) = self.pending_response.take() {
                        messages.push(TmuxMessage::CommandResponse {
                            timestamp: pending.timestamp,
                            cmd_num: pending.cmd_num,
                            flags: pending.flags,
                            success: false,
                            lines: pending.lines,
                        });
                    }
                    continue;
                }
            }

            if self.pending_response.is_some() {
                self.pending_response
                    .as_mut()
                    .unwrap()
                    .lines
                    .push(line);
                continue;
            }

            messages.push(message);
        }

        messages
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

        // Anything else is treated as a notification without the leading `%`.
        TmuxMessage::Notification {
            name: String::new(),
            args: vec![line.to_string()],
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
        let block = b"\x1bP1000p tmux;%output %0 hi\r\n%window-add @0\r\n\x1b\\";
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
    fn parses_command_response_block() {
        let block = b"\x1bP1000p tmux;%begin 123 1 0\r\n0: bash\r\n%end 123 1 0\r\n\x1b\\";
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
}
