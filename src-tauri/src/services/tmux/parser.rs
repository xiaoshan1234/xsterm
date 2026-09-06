//! Pure state machine that turns tmux `-CC` line-protocol output into
//! strongly-typed [`ControlEvent`]s.
//!
//! `ControlParser` is deliberately **pure**: it has no I/O, no channels, no
//! threading. The reader task in [`crate::services::tmux::controller`]
//! splits tmux's stdout into lines and feeds them one by one; the parser
//! returns `Option<ControlEvent>` for each line. This separation makes the
//! parser trivial to unit-test — wrap a fixture in `BufReader<Cursor<&[u8]>>`
//! and feed each line through `feed()` — and keeps the controller's only
//! remaining job to be "spawn child, split lines, push events".
//!
//! The protocol grammar implemented here is the tmux 3.x control-mode spec,
//! documented in `doc/requirements/prd-0.1/req-006-tmux.md` §3.
//!
//! ## State machine
//!
//! ```text
//!   ┌────────────── outside a command block ──────────────┐
//!   │   ""        → None (drop, like tmux notifications) │
//!   │   non-% line → Unknown { line }                    │
//!   │   %begin T I F → CommandBegin, enter block         │
//!   │   %end/%error (outside) → Unknown                  │
//!   │   %xxx <args>  → typed event                       │
//!   └─────────────────────────┬───────────────────────────┘
//!                             │
//!                  enter block│with current_command_id
//!                             ▼
//!   ┌────────────── inside a command block ──────────────┐
//!   │   any line  → CommandOutput { id, line }          │
//!   │   %begin (nested)   → still CommandOutput         │
//!   │   %end T I F (match) → CommandEnd, leave block    │
//!   │   %error T I F msg (match) → CommandError, leave  │
//!   │   %end/%error (mismatch) → CommandOutput          │
//!   └────────────────────────────────────────────────────┘
//! ```

use super::escape::unescape_output;
use super::events::ControlEvent;

/// State machine for the tmux `-CC` line protocol.
///
/// Construct with [`ControlParser::new`] and call [`ControlParser::feed`]
/// once per line (already stripped of the trailing `\n` by the reader).
/// The parser mutates its `current_command_id` field as `%begin/%end/%error`
/// lines flow through, and otherwise remains stateless.
#[derive(Debug, Default, Clone)]
pub struct ControlParser {
    /// `Some(id)` while we are accumulating body lines between a
    /// matching `%begin %<id>` and its `%end %<id>` (or `%error %<id>`).
    /// `None` when we are ready to accept the next standalone event.
    current_command_id: Option<u32>,
}

impl ControlParser {
    /// Create a parser in the "outside any command block" state.
    pub fn new() -> Self {
        Self::default()
    }

    /// True iff we are currently inside a `%begin … %end/%error` block.
    #[allow(dead_code)] // test-only introspection helper
    pub fn in_command_block(&self) -> bool {
        self.current_command_id.is_some()
    }

    /// Feed one decoded line (no trailing newline) and consume any event
    /// it produces.
    ///
    /// Returns:
    /// - `None` for lines that should be silently dropped (currently: empty
    ///   lines outside a command block — tmux sometimes emits bare newlines
    ///   as keepalive pings).
    /// - `Some(ControlEvent::Unknown { line })` for unrecognised lines so
    ///   the controller can log them without crashing.
    /// - `Some(ControlEvent::{Output, CommandEnd, ...})` for recognised events.
    ///
    /// The parser is **forgiving**: malformed numbers, unknown sub-events,
    /// and even `%end` outside a block never panic — they degrade to
    /// `Unknown` or are emitted as `CommandOutput` inside a block.
    pub fn feed(&mut self, line: &str) -> Option<ControlEvent> {
        if self.current_command_id.is_some() {
            return self.feed_inside_block(line);
        }
        // Empty / whitespace-only lines outside a command block are
        // dropped: tmux emits them as keepalive pings and they have no
        // semantic value for xsterm.
        if line.trim().is_empty() {
            return None;
        }
        if !line.starts_with('%') {
            return Some(ControlEvent::Unknown {
                line: line.to_string(),
            });
        }
        self.parse_outer(line)
    }

    fn feed_inside_block(&mut self, line: &str) -> Option<ControlEvent> {
        let active_id = self.current_command_id.expect("checked above");
        let stripped = line.strip_prefix('%').unwrap_or(line);
        let tokens: Vec<&str> = stripped.split_ascii_whitespace().collect();
        let prefix = tokens.first().copied().unwrap_or("");
        let rest: &[&str] = if tokens.is_empty() { &[] } else { &tokens[1..] };

        match prefix {
            "end" if rest.len() == 3 => {
                let (timestamp, id, flags) = parse_begin_triple(rest)?;
                if Some(id) == self.current_command_id {
                    self.current_command_id = None;
                    Some(ControlEvent::CommandEnd {
                        id,
                        timestamp,
                        flags,
                    })
                } else {
                    // Mismatched id — emit as body.
                    Some(ControlEvent::CommandOutput {
                        id: active_id,
                        line: line.to_string(),
                    })
                }
            }
            "error" if rest.len() >= 3 => {
                let timestamp = rest[0].parse::<u64>().ok()?;
                let id = rest[1].parse::<u32>().ok()?;
                let flags = rest[2].parse::<u32>().ok()?;
                let message = rest[3..].join(" ");
                if Some(id) == self.current_command_id {
                    self.current_command_id = None;
                    Some(ControlEvent::CommandError {
                        id,
                        timestamp,
                        flags,
                        message,
                    })
                } else {
                    Some(ControlEvent::CommandOutput {
                        id: active_id,
                        line: line.to_string(),
                    })
                }
            }
            _ => Some(ControlEvent::CommandOutput {
                id: active_id,
                line: line.to_string(),
            }),
        }
    }

    fn parse_outer(&mut self, line: &str) -> Option<ControlEvent> {
        let stripped = line.strip_prefix('%').unwrap_or(line);
        let tokens: Vec<&str> = stripped.split_ascii_whitespace().collect();
        if tokens.is_empty() {
            // Bare `%` — emit Unknown rather than None so the controller
            // can log it.
            return Some(ControlEvent::Unknown {
                line: line.to_string(),
            });
        }
        let prefix = tokens[0];
        let rest: &[&str] = &tokens[1..];

        match prefix {
            "begin" if rest.len() == 3 => match parse_begin_triple(rest) {
                Some((timestamp, id, flags)) => {
                    self.current_command_id = Some(id);
                    Some(ControlEvent::CommandBegin {
                        id,
                        timestamp,
                        flags,
                    })
                }
                None => Some(ControlEvent::Unknown {
                    line: line.to_string(),
                }),
            },
            "begin" => Some(ControlEvent::Unknown {
                line: line.to_string(),
            }),

            "end" | "error" => Some(ControlEvent::Unknown {
                line: line.to_string(),
            }),

            "output" => parse_output_event(line, rest),
            "extended-output" => parse_extended_output_event(line, rest),

            "session-changed" => split_after_first(rest).map(|(session_id, name)| {
                ControlEvent::SessionChanged {
                    session_id: session_id.to_string(),
                    name: name.to_string(),
                }
            }),
            "session-renamed" => split_after_first(rest).map(|(session_id, name)| {
                ControlEvent::SessionRenamed {
                    session_id: session_id.to_string(),
                    name: name.to_string(),
                }
            }),
            "session-closed" => first_token(rest).map(|session_id| {
                ControlEvent::SessionClosed {
                    session_id: session_id.to_string(),
                }
            }),
            "session-window-changed" => {
                first_two(rest).map(|(session_id, window_id)| {
                    ControlEvent::SessionWindowChanged {
                        session_id: session_id.to_string(),
                        window_id: window_id.to_string(),
                    }
                })
            }
            "sessions-changed" => Some(ControlEvent::SessionsChanged),

            "window-add" => first_token(rest).map(|window_id| ControlEvent::WindowAdd {
                window_id: window_id.to_string(),
            }),
            "window-close" => first_token(rest).map(|window_id| ControlEvent::WindowClose {
                window_id: window_id.to_string(),
            }),
            "window-renamed" => split_after_first(rest).map(|(window_id, name)| {
                ControlEvent::WindowRenamed {
                    window_id: window_id.to_string(),
                    name: name.to_string(),
                }
            }),
            "window-pane-changed" => {
                first_two(rest).map(|(window_id, pane_id)| ControlEvent::WindowPaneChanged {
                    window_id: window_id.to_string(),
                    pane_id: pane_id.to_string(),
                })
            }
            "unlinked-window-add" => first_token(rest).map(|window_id| {
                ControlEvent::UnlinkedWindowAdd {
                    window_id: window_id.to_string(),
                }
            }),
            "unlinked-window-close" => first_token(rest).map(|window_id| {
                ControlEvent::UnlinkedWindowClose {
                    window_id: window_id.to_string(),
                }
            }),

            "layout-change" => parse_layout_change(line, rest),

            "pane-mode-changed" => first_token(rest).map(|pane_id| {
                ControlEvent::PaneModeChanged {
                    pane_id: pane_id.to_string(),
                }
            }),
            "pane-exited" => first_token(rest).map(|pane_id| ControlEvent::PaneExited {
                pane_id: pane_id.to_string(),
            }),
            "pane-died" => first_token(rest).map(|pane_id| ControlEvent::PaneDied {
                pane_id: pane_id.to_string(),
            }),

            "paste-buffer-changed" => Some(ControlEvent::PasteBufferChanged {
                buffer_name: rest.join(" "),
            }),
            "client-detached" => Some(ControlEvent::ClientDetached {
                client: rest.join(" "),
            }),
            "client-session-changed" => {
                // <client> <session_id> <name...>
                if rest.len() >= 3 {
                    Some(ControlEvent::ClientSessionChanged {
                        client: rest[0].to_string(),
                        session_id: rest[1].to_string(),
                        name: rest[2..].join(" "),
                    })
                } else {
                    Some(ControlEvent::Unknown {
                        line: line.to_string(),
                    })
                }
            }

            "exit" => {
                let reason = rest.join(" ");
                Some(ControlEvent::Exit {
                    reason: if reason.is_empty() { None } else { Some(reason) },
                })
            }
            "config-error" => Some(ControlEvent::ConfigError {
                message: rest.join(" "),
            }),

            "pause" => first_token(rest).map(|pane_id| ControlEvent::Pause {
                pane_id: pane_id.to_string(),
            }),
            "continue" => first_token(rest).map(|pane_id| ControlEvent::Continue {
                pane_id: pane_id.to_string(),
            }),

            "popup-open" => Some(ControlEvent::PopupOpen {
                line: rest.join(" "),
            }),
            "popup-output" => Some(ControlEvent::PopupOutput {
                line: rest.join(" "),
            }),
            "popup-close" => Some(ControlEvent::PopupClose {
                line: rest.join(" "),
            }),

            _ => Some(ControlEvent::Unknown {
                line: line.to_string(),
            }),
        }
    }
}

/// Parse `%begin <ts> <id> <flags>` / `%end <ts> <id> <flags>` triple into
/// its three numeric fields. Returns `None` on malformed input.
fn parse_begin_triple(rest: &[&str]) -> Option<(u64, u32, u32)> {
    let timestamp = rest[0].parse::<u64>().ok()?;
    let id = rest[1].parse::<u32>().ok()?;
    let flags = rest[2].parse::<u32>().ok()?;
    Some((timestamp, id, flags))
}

fn first_token<'a>(rest: &'a [&'a str]) -> Option<&'a str> {
    rest.first().copied()
}

fn first_two<'a>(rest: &'a [&'a str]) -> Option<(&'a str, &'a str)> {
    if rest.len() >= 2 {
        Some((rest[0], rest[1]))
    } else {
        None
    }
}

/// `(first, rest_joined_with_spaces)` for the simple `<id> <name...>`
/// pattern. Returns `None` if `rest` is empty.
fn split_after_first<'a>(rest: &'a [&'a str]) -> Option<(&'a str, String)> {
    rest.first().copied().map(|first| (first, rest[1..].join(" ")))
}

fn parse_output_event(line: &str, rest: &[&str]) -> Option<ControlEvent> {
    let pane_id = match first_token(rest) {
        Some(id) => id.to_string(),
        None => {
            return Some(ControlEvent::Unknown {
                line: line.to_string(),
            });
        }
    };
    let data_str = rest[1..].join(" ");
    let data = unescape_output(&data_str);
    Some(ControlEvent::Output { pane_id, data })
}

fn parse_extended_output_event(line: &str, rest: &[&str]) -> Option<ControlEvent> {
    if rest.len() < 4 {
        return Some(ControlEvent::Unknown {
            line: line.to_string(),
        });
    }
    let pane_id = rest[0].to_string();
    let age_ms = match rest[1].parse::<u64>() {
        Ok(n) => n,
        Err(_) => {
            return Some(ControlEvent::Unknown {
                line: line.to_string(),
            });
        }
    };
    // rest[2..] is `<flags...> : <data>`. Find the LAST colon (data is the
    // last field; flags never contain colons in practice but if they do,
    // we still want the trailing data to win).
    let tail = rest[2..].join(" ");
    let data_str = match tail.rsplit_once(':') {
        Some((_flags, data)) => data,
        None => {
            return Some(ControlEvent::Unknown {
                line: line.to_string(),
            });
        }
    };
    let data = unescape_output(data_str.trim_start());
    Some(ControlEvent::ExtendedOutput {
        pane_id,
        age_ms,
        data,
    })
}

fn parse_layout_change(line: &str, rest: &[&str]) -> Option<ControlEvent> {
    if rest.len() < 3 {
        return Some(ControlEvent::Unknown {
            line: line.to_string(),
        });
    }
    Some(ControlEvent::LayoutChange {
        window_id: rest[0].to_string(),
        layout: rest[1].to_string(),
        visible_layout: rest[2].to_string(),
        flags: rest[3..].join(" "),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed_one(parser: &mut ControlParser, line: &str) -> ControlEvent {
        match parser.feed(line) {
            Some(ev) => ev,
            None => panic!("expected Some(event), got None for line {line:?}"),
        }
    }

    // ----- Empty / drop semantics --------------------------------------

    #[test]
    fn empty_line_outside_block_returns_none() {
        let mut p = ControlParser::new();
        assert!(p.feed("").is_none());
    }

    #[test]
    fn whitespace_only_line_outside_block_returns_none() {
        let mut p = ControlParser::new();
        assert!(p.feed("   \t  ").is_none());
    }

    #[test]
    fn empty_line_inside_block_becomes_command_output() {
        let mut p = ControlParser::new();
        p.feed("%begin 1700000000 7 0");
        let ev = feed_one(&mut p, "");
        assert_eq!(
            ev,
            ControlEvent::CommandOutput {
                id: 7,
                line: String::new()
            }
        );
    }

    // ----- Unknown / non-% lines ---------------------------------------

    #[test]
    fn non_percent_line_outside_block_is_unknown() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "hello");
        assert_eq!(ev, ControlEvent::Unknown { line: "hello".into() });
    }

    #[test]
    fn bare_percent_line_is_unknown() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%");
        assert_eq!(ev, ControlEvent::Unknown { line: "%".into() });
    }

    #[test]
    fn unrecognised_percent_line_is_unknown() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%totally-bogus foo bar");
        assert_eq!(
            ev,
            ControlEvent::Unknown {
                line: "%totally-bogus foo bar".into()
            }
        );
    }

    // ----- Output ------------------------------------------------------

    #[test]
    fn output_event_decodes_escaped_payload() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%output %5 hello\\012world");
        assert_eq!(
            ev,
            ControlEvent::Output {
                pane_id: "%5".into(),
                data: b"hello\nworld".to_vec()
            }
        );
    }

    #[test]
    fn output_event_plain_payload() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%output %1 abc");
        assert_eq!(
            ev,
            ControlEvent::Output {
                pane_id: "%1".into(),
                data: b"abc".to_vec()
            }
        );
    }

    #[test]
    fn output_event_with_backslash_in_payload() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%output %1 a\\134b");
        assert_eq!(
            ev,
            ControlEvent::Output {
                pane_id: "%1".into(),
                data: b"a\\b".to_vec()
            }
        );
    }

    // ----- Extended output ----------------------------------------------

    #[test]
    fn extended_output_event_with_flags_and_colon() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%extended-output %5 1234 0,1,2 : hi\\041");
        assert_eq!(
            ev,
            ControlEvent::ExtendedOutput {
                pane_id: "%5".into(),
                age_ms: 1234,
                data: b"hi!".to_vec()
            }
        );
    }

    #[test]
    fn extended_output_event_without_colon_is_unknown() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%extended-output %5 1234 no-colon-here");
        assert_eq!(
            ev,
            ControlEvent::Unknown {
                line: "%extended-output %5 1234 no-colon-here".into()
            }
        );
    }

    // ----- Session / window / pane events ------------------------------

    #[test]
    fn sessions_changed_bare() {
        let mut p = ControlParser::new();
        assert_eq!(feed_one(&mut p, "%sessions-changed"), ControlEvent::SessionsChanged);
    }

    #[test]
    fn session_changed_with_name() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%session-changed $1 main");
        assert_eq!(
            ev,
            ControlEvent::SessionChanged {
                session_id: "$1".into(),
                name: "main".into()
            }
        );
    }

    #[test]
    fn session_renamed_with_multitoken_name() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%session-renamed $7 hello world foo");
        assert_eq!(
            ev,
            ControlEvent::SessionRenamed {
                session_id: "$7".into(),
                name: "hello world foo".into()
            }
        );
    }

    #[test]
    fn session_closed() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%session-closed $3");
        assert_eq!(
            ev,
            ControlEvent::SessionClosed {
                session_id: "$3".into()
            }
        );
    }

    #[test]
    fn session_window_changed() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%session-window-changed $2 @9");
        assert_eq!(
            ev,
            ControlEvent::SessionWindowChanged {
                session_id: "$2".into(),
                window_id: "@9".into()
            }
        );
    }

    #[test]
    fn window_add_close_unlinked() {
        let mut p = ControlParser::new();
        assert_eq!(
            feed_one(&mut p, "%window-add @1"),
            ControlEvent::WindowAdd {
                window_id: "@1".into()
            }
        );
        assert_eq!(
            feed_one(&mut p, "%window-close @2"),
            ControlEvent::WindowClose {
                window_id: "@2".into()
            }
        );
        assert_eq!(
            feed_one(&mut p, "%unlinked-window-add @3"),
            ControlEvent::UnlinkedWindowAdd {
                window_id: "@3".into()
            }
        );
        assert_eq!(
            feed_one(&mut p, "%unlinked-window-close @4"),
            ControlEvent::UnlinkedWindowClose {
                window_id: "@4".into()
            }
        );
    }

    #[test]
    fn window_renamed() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%window-renamed @1 editor — vim");
        assert_eq!(
            ev,
            ControlEvent::WindowRenamed {
                window_id: "@1".into(),
                name: "editor — vim".into()
            }
        );
    }

    #[test]
    fn window_pane_changed() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%window-pane-changed @1 %5");
        assert_eq!(
            ev,
            ControlEvent::WindowPaneChanged {
                window_id: "@1".into(),
                pane_id: "%5".into()
            }
        );
    }

    #[test]
    fn layout_change_four_fields_minimum() {
        let mut p = ControlParser::new();
        let ev = feed_one(
            &mut p,
            "%layout-change @1 abcd,123x45,0,0,0 efgh,80x24,0,0,0 *",
        );
        assert_eq!(
            ev,
            ControlEvent::LayoutChange {
                window_id: "@1".into(),
                layout: "abcd,123x45,0,0,0".into(),
                visible_layout: "efgh,80x24,0,0,0".into(),
                flags: "*".into()
            }
        );
    }

    #[test]
    fn pane_mode_changed_and_pane_exited_and_pane_died() {
        let mut p = ControlParser::new();
        assert_eq!(
            feed_one(&mut p, "%pane-mode-changed %3"),
            ControlEvent::PaneModeChanged {
                pane_id: "%3".into()
            }
        );
        assert_eq!(
            feed_one(&mut p, "%pane-exited %3"),
            ControlEvent::PaneExited {
                pane_id: "%3".into()
            }
        );
        assert_eq!(
            feed_one(&mut p, "%pane-died %3"),
            ControlEvent::PaneDied {
                pane_id: "%3".into()
            }
        );
    }

    // ----- Client / buffer / exit / pause / continue / popups ----------

    #[test]
    fn paste_buffer_changed() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%paste-buffer-changed buffer0");
        assert_eq!(
            ev,
            ControlEvent::PasteBufferChanged {
                buffer_name: "buffer0".into()
            }
        );
    }

    #[test]
    fn client_detached() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%client-detached /dev/tty");
        assert_eq!(
            ev,
            ControlEvent::ClientDetached {
                client: "/dev/tty".into()
            }
        );
    }

    #[test]
    fn client_session_changed_three_fields() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%client-session-changed /dev/pts/0 $1 main");
        assert_eq!(
            ev,
            ControlEvent::ClientSessionChanged {
                client: "/dev/pts/0".into(),
                session_id: "$1".into(),
                name: "main".into()
            }
        );
    }

    #[test]
    fn exit_with_reason() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%exit killed by signal");
        assert_eq!(
            ev,
            ControlEvent::Exit {
                reason: Some("killed by signal".into())
            }
        );
    }

    #[test]
    fn exit_bare() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%exit");
        assert_eq!(ev, ControlEvent::Exit { reason: None });
    }

    #[test]
    fn config_error_carries_full_message() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%config-error unknown key: 'foo-bar'");
        assert_eq!(
            ev,
            ControlEvent::ConfigError {
                message: "unknown key: 'foo-bar'".into()
            }
        );
    }

    #[test]
    fn pause_and_continue() {
        let mut p = ControlParser::new();
        assert_eq!(
            feed_one(&mut p, "%pause %3"),
            ControlEvent::Pause {
                pane_id: "%3".into()
            }
        );
        assert_eq!(
            feed_one(&mut p, "%continue %3"),
            ControlEvent::Continue {
                pane_id: "%3".into()
            }
        );
    }

    #[test]
    fn popup_lines_carry_remainder() {
        let mut p = ControlParser::new();
        let ev1 = feed_one(&mut p, "%popup-open some-raw-payload");
        assert_eq!(ev1, ControlEvent::PopupOpen { line: "some-raw-payload".into() });
        let ev2 = feed_one(&mut p, "%popup-output other things");
        assert_eq!(ev2, ControlEvent::PopupOutput { line: "other things".into() });
        let ev3 = feed_one(&mut p, "%popup-close last");
        assert_eq!(ev3, ControlEvent::PopupClose { line: "last".into() });
    }

    // ----- Command block: begin / output / end -------------------------

    #[test]
    fn begin_creates_command_block() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%begin 1700000000 42 0");
        assert_eq!(
            ev,
            ControlEvent::CommandBegin {
                id: 42,
                timestamp: 1700000000,
                flags: 0
            }
        );
        assert!(p.in_command_block());
    }

    #[test]
    fn begin_emits_body_then_end_returns_end() {
        let mut p = ControlParser::new();
        feed_one(&mut p, "%begin 1 7 0");
        let body = feed_one(&mut p, "line one");
        assert_eq!(
            body,
            ControlEvent::CommandOutput {
                id: 7,
                line: "line one".into()
            }
        );
        let body2 = feed_one(&mut p, "line two");
        assert_eq!(
            body2,
            ControlEvent::CommandOutput {
                id: 7,
                line: "line two".into()
            }
        );
        let end = feed_one(&mut p, "%end 1 7 0");
        assert_eq!(
            end,
            ControlEvent::CommandEnd {
                id: 7,
                timestamp: 1,
                flags: 0
            }
        );
        assert!(!p.in_command_block());
    }

    #[test]
    fn error_inside_block_returns_command_error_and_clears() {
        let mut p = ControlParser::new();
        feed_one(&mut p, "%begin 1 9 0");
        let ev = feed_one(&mut p, "%error 1 9 0 bad command name");
        assert_eq!(
            ev,
            ControlEvent::CommandError {
                id: 9,
                timestamp: 1,
                flags: 0,
                message: "bad command name".into()
            }
        );
        assert!(!p.in_command_block());
    }

    #[test]
    fn mismatched_end_inside_block_becomes_body() {
        let mut p = ControlParser::new();
        feed_one(&mut p, "%begin 1 7 0");
        let ev = feed_one(&mut p, "%end 1 99 0");
        assert_eq!(
            ev,
            ControlEvent::CommandOutput {
                id: 7,
                line: "%end 1 99 0".into()
            }
        );
        // Block stays open with id=7 — still inside.
        assert!(p.in_command_block());
    }

    #[test]
    fn end_outside_block_is_unknown() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%end 1 7 0");
        assert_eq!(
            ev,
            ControlEvent::Unknown {
                line: "%end 1 7 0".into()
            }
        );
    }

    #[test]
    fn error_outside_block_is_unknown() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%error 1 7 0 bad");
        assert_eq!(
            ev,
            ControlEvent::Unknown {
                line: "%error 1 7 0 bad".into()
            }
        );
    }

    #[test]
    fn nested_begin_inside_block_is_command_output() {
        let mut p = ControlParser::new();
        feed_one(&mut p, "%begin 1 7 0");
        // A nested %begin must not update our current_command_id.
        let ev = feed_one(&mut p, "%begin 1 99 0");
        assert_eq!(
            ev,
            ControlEvent::CommandOutput {
                id: 7,
                line: "%begin 1 99 0".into()
            }
        );
        assert!(p.in_command_block());
    }

    #[test]
    fn multi_line_command_body_preserves_blank_lines() {
        let mut p = ControlParser::new();
        feed_one(&mut p, "%begin 1 11 0");
        let l1 = feed_one(&mut p, "first line");
        let l2 = feed_one(&mut p, "");
        let l3 = feed_one(&mut p, "third line");
        assert_eq!(
            l1,
            ControlEvent::CommandOutput {
                id: 11,
                line: "first line".into()
            }
        );
        assert_eq!(
            l2,
            ControlEvent::CommandOutput {
                id: 11,
                line: "".into()
            }
        );
        assert_eq!(
            l3,
            ControlEvent::CommandOutput {
                id: 11,
                line: "third line".into()
            }
        );
    }

    #[test]
    fn trailing_whitespace_tolerated() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%output %1 hello   \t  ");
        assert_eq!(
            ev,
            ControlEvent::Output {
                pane_id: "%1".into(),
                data: b"hello".to_vec()
            }
        );
    }

    #[test]
    fn malformed_begin_emits_unknown() {
        let mut p = ControlParser::new();
        let ev = feed_one(&mut p, "%begin notanumber 7 0");
        assert_eq!(
            ev,
            ControlEvent::Unknown {
                line: "%begin notanumber 7 0".into()
            }
        );
        // Crucially, no state change.
        assert!(!p.in_command_block());
    }

    #[test]
    fn parser_handles_full_session_lifecycle_sequence() {
        // Simulate a realistic tmux -CC stream: a session command reply
        // sandwiched between two unrelated notifications.
        let mut p = ControlParser::new();

        // Standalone event first.
        assert_eq!(
            feed_one(&mut p, "%sessions-changed"),
            ControlEvent::SessionsChanged
        );

        // Start a command block (e.g. list-sessions).
        assert_eq!(
            feed_one(&mut p, "%begin 1700000000 100 0"),
            ControlEvent::CommandBegin {
                id: 100,
                timestamp: 1700000000,
                flags: 0,
            }
        );

        // Body lines (simulated list-sessions output).
        assert_eq!(
            feed_one(&mut p, "$0 main: 1 windows (created …)"),
            ControlEvent::CommandOutput {
                id: 100,
                line: "$0 main: 1 windows (created …)".into(),
            }
        );
        assert_eq!(
            feed_one(&mut p, "$1 scratch: 2 windows"),
            ControlEvent::CommandOutput {
                id: 100,
                line: "$1 scratch: 2 windows".into(),
            }
        );

        // End.
        assert_eq!(
            feed_one(&mut p, "%end 1700000000 100 0"),
            ControlEvent::CommandEnd {
                id: 100,
                timestamp: 1700000000,
                flags: 0,
            }
        );

        // Next standalone event.
        assert_eq!(
            feed_one(&mut p, "%window-add @5"),
            ControlEvent::WindowAdd {
                window_id: "@5".into(),
            }
        );
    }

    #[test]
    fn in_command_block_reflects_state() {
        let mut p = ControlParser::new();
        assert!(!p.in_command_block());
        p.feed("%begin 1 1 0");
        assert!(p.in_command_block());
        p.feed("%end 1 1 0");
        assert!(!p.in_command_block());
        // Error path
        p.feed("%begin 1 2 0");
        p.feed("%error 1 2 0 boom");
        assert!(!p.in_command_block());
    }
}