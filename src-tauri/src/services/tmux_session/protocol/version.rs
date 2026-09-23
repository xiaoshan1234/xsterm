//! tmux protocol version + capability probing.
//!
//! This module is **stateless**: it owns no I/O, no channels, no runtime
//! state. It exposes:
//!
//! 1. [`TmuxProtocolVersion`] — parsed `#{version}` string (e.g. `"3.4"`).
//! 2. [`CapabilityMatrix`] — a flag bag of features we care about for
//!    picking a handshake sequence in PR-T4. The matrix is *derived* from
//!    the version + the `list-commands` reply (which lists every tmux
//!    command the server supports, including flags).
//! 3. [`parse_version`] / [`infer_capabilities`] — pure functions,
//!    exhaustively unit-tested in this file. They never talk to a real tmux
//!    process; the caller feeds them the bytes it received from tmux.
//!
//! ## Why a separate module?
//!
//! The old controller hard-coded a single startup sequence that worked on
//! "modern" tmux (3.3+) and silently failed on OpenBSD's base tmux (Bug 014
//! series). Once we have [`infer_capabilities`], the handshake plan in
//! PR-T4 can pick the right sequence based on what the server actually
//! supports instead of guessing.
//!
//! ## What "capabilities" actually map to
//!
//! | capability                               | probed via                              | used by handshake to       |
//! |------------------------------------------|-----------------------------------------|----------------------------|
//! | `supports_new_session_dash_a`            | version ≥ 3.2 OR `list-commands` row   | `new-session -A`           |
//! | `supports_refresh_client_dash_c`        | version ≥ 2.2 OR `list-commands` row    | `refresh-client -C`        |
//! | `auto_pushes_window_pane_changed`       | version ≥ 3.0 (heuristic)               | skip `list-windows` query  |
//! | `supports_attach_session_dash_c_empty`   | version ≥ 2.6                           | `attach-session -c ""`     |
//! | `uses_dcs_passthrough`                   | heuristic + list-commands `refresh-client -C` | SSH exec wire-format strip |
//!
//! Heuristics are deliberate fallbacks for tmux versions that predate the
//! version-string changes that broke us before. The real fallback path is
//! "emit every command and watch for `%error`" — implemented by the
//! handshake plan, not by this module.
//!
//! ## History
//!
//! New in PR-T2. Originally the controller assumed `new-session -A` +
//! `refresh-client -C` + `new-window` worked on every tmux — false on
//! OpenBSD's bundled tmux (Bug 014). The `CapabilityMatrix` is the
//! machine-readable fix for that assumption.

use serde::{Deserialize, Serialize};

/// Parsed result of tmux's `#{version}` format string.
///
/// tmux formats it as `"<major>.<minor>[a|p]"` (e.g. `"3.4"`, `"3.5a"`,
/// `"2.2"`). Pre-3.0 versions sometimes emit just `"<major>.<minor>"`
/// without the patch component.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TmuxProtocolVersion {
    pub major: u32,
    pub minor: u32,
    /// Optional patch / pre-release tag (e.g. `"a"` for `"3.5a"`).
    /// `None` when tmux omits it (e.g. `"3.4"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch: Option<String>,
}

impl TmuxProtocolVersion {
    /// True when `self >= (major, minor)` — used for capability heuristics
    /// that depend on a minimum tmux version (e.g. `refresh-client -C`
    /// exists since 2.2, `new-session -A` since 3.2).
    pub fn at_least(&self, major: u32, minor: u32) -> bool {
        (self.major, self.minor) >= (major, minor)
    }
}

/// Capability flags the handshake plan needs to pick a startup sequence.
///
/// See module docs for what each flag means and how each one is derived.
/// The fields default to `false` so `CapabilityMatrix::default()` produces
/// "old tmux, walk the cautious path".
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityMatrix {
    /// `new-session -A` is accepted. PR-T4 uses this to skip the manual
    /// `attach-session` step on tmux 3.2+.
    pub supports_new_session_dash_a: bool,
    /// `refresh-client -C` (the **control-mode** flag without an
    /// argument) is accepted. Old versions need `-C 1` or refuse it
    /// outright (Bug 014v2 hit `refresh-client: -C expects an argument`
    /// on OpenBSD tmux).
    pub supports_refresh_client_dash_c: bool,
    /// Server pushes `%window-pane-changed` immediately after a
    /// `new-window` command. If `false`, the handshake must follow up with
    /// an explicit `list-windows` + `list-panes -a` to learn the pane id
    /// (Bug 016 / Bug 018 dance).
    pub auto_pushes_window_pane_changed: bool,
    /// `attach-session -c ""` (empty session name = "create if absent")
    /// is accepted. PR-T4 uses this to bootstrap the control session in
    /// one step on tmux 2.6+.
    pub supports_attach_session_dash_c_empty: bool,
    /// Server wraps `%xxx` notifications in DCS passthrough
    /// (`\x1bP1000p ... \x1b\\`) over SSH exec channels. PR-T5's reader
    /// strips this prefix/suffix (Bug 009); setting the flag tells the
    /// reader to strip or not.
    pub uses_dcs_passthrough: bool,
}

impl CapabilityMatrix {
    /// Conservative heuristic for tmux versions where we have no better
    /// signal. Used as the starting point before any `list-commands`
    /// probing — the `infer_capabilities` upgrader flips bits on top.
    ///
    /// Truth table (all "since version" numbers taken from tmux CHANGES):
    /// - `new-session -A` — tmux 3.2
    /// - `refresh-client -C` — tmux 2.2 (no-arg form is 3.0+; pre-3.0
    ///   requires `-C 1`, which `parse_command_list` would catch as
    ///   "missing flag" if we probed it)
    /// - `auto_pushes_window_pane_changed` — heuristic: tmux 3.0+
    /// - `attach-session -c ""` — tmux 2.6
    /// - `uses_dcs_passthrough` — heuristic: always true on SSH exec
    ///   channels (it's how OpenSSH propagates control sequences)
    fn from_version(v: &TmuxProtocolVersion) -> Self {
        Self {
            supports_new_session_dash_a: v.at_least(3, 2),
            supports_refresh_client_dash_c: v.at_least(3, 0),
            auto_pushes_window_pane_changed: v.at_least(3, 0),
            supports_attach_session_dash_c_empty: v.at_least(2, 6),
            // DCS passthrough is a property of how the SSH channel carries
            // binary-ish data, not of tmux itself. Set conservatively to
            // `true` so the reader always strips it; the strip is a no-op
            // on clean line-oriented output.
            uses_dcs_passthrough: true,
        }
    }
}

/// Parse tmux's `#{version}` expansion. tmux prints it as the first
/// body line of `display-message -p '#{version}'`.
///
/// Accepted forms (all return `Some`):
/// - `"3.4"`        → `major=3, minor=4, patch=None`
/// - `"3.5a"`       → `major=3, minor=5, patch=Some("a")`
/// - `"3.5p"`       → `major=3, minor=5, patch=Some("p")`
/// - `"2.2"`        → `major=2, minor=2, patch=None`
/// - `""`           → `None` (server gave us nothing)
///
/// Malformed input (non-ASCII, missing minor, etc.) returns `None`.
pub fn parse_version(s: &str) -> Option<TmuxProtocolVersion> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    // Major = leading digits.
    let (major, rest) = split_digits(s)?;
    // Skip the dot.
    let rest = rest.strip_prefix('.')?;
    // Minor = next run of digits.
    let (minor, rest) = split_digits(rest)?;
    // Patch = whatever is left (letters, e.g. "a" or "p"). Stripped of
    // leading/trailing whitespace just in case.
    let patch = rest.trim();
    let patch_opt = if patch.is_empty() {
        None
    } else {
        Some(patch.to_string())
    };
    Some(TmuxProtocolVersion {
        major,
        minor,
        patch: patch_opt,
    })
}

/// Eat a run of ASCII digits from the start of `s`; return `(value, remainder)`.
fn split_digits(s: &str) -> Option<(u32, &str)> {
    let end = s
        .as_bytes()
        .iter()
        .take_while(|b| b.is_ascii_digit())
        .count();
    if end == 0 {
        return None;
    }
    let (digits, rest) = s.split_at(end);
    let value: u32 = digits.parse().ok()?;
    Some((value, rest))
}

/// One line of `list-commands` output. tmux formats it as
/// `<command> [<usage>]` per line, but we only care about the leading
/// command name and a few key flags.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandListEntry {
    pub command: String,
    pub usage: String,
}

impl CommandListEntry {
    /// Parse one `list-commands` line. Splits on the first run of
    /// whitespace; anything after is the usage string.
    pub fn parse(line: &str) -> Option<Self> {
        let line = line.trim();
        if line.is_empty() {
            return None;
        }
        let (cmd, usage) = match line.find(char::is_whitespace) {
            Some(idx) => (line[..idx].to_string(), line[idx..].trim().to_string()),
            None => (line.to_string(), String::new()),
        };
        Some(Self {
            command: cmd,
            usage,
        })
    }

    /// True when this entry's usage string contains `flag` as a standalone
    /// flag (preceded by whitespace or start, followed by whitespace or
    /// end). Also recognises the `[-XYZ]` shorthand tmux uses in some
    /// `list-commands` replies to show bundled flags.
    ///
    /// Matches:
    /// - `refresh-client -C` (standalone `-C`)
    /// - `new-session [-A]` (bundled inside `[-A]`)
    /// - `new-session -A` (standalone `-A`)
    ///
    /// Does **not** match `-CSomething` (substring of a longer token).
    pub fn has_flag(&self, flag: &str) -> bool {
        // Bracket shorthand: `[-A]`, `[-AdE]`, etc. Strip brackets and check
        // character-by-character. Match `flag` (e.g. `-A`) iff it appears
        // as a single char inside the bracket group.
        let bracket_re = regex_lite_find_brackets(&self.usage);
        for inside in bracket_re {
            if inside.len() == flag.len() + 1 && inside.starts_with('-') && inside.ends_with('}') {
                // e.g. `{-A}` — should not occur but be defensive.
                return flag == &inside[1..inside.len() - 1];
            }
            if flag.starts_with('-') && flag.len() == 2 {
                let ch = flag.as_bytes()[1];
                if inside.as_bytes().iter().any(|&b| b == ch) {
                    return true;
                }
            }
        }
        // Standalone whitespace-delimited token.
        self.usage.split_whitespace().any(|tok| tok == flag)
    }
}

/// Naive bracket extractor: returns the text inside every `[...]` group.
/// No nested-bracket support (tmux's `list-commands` doesn't nest).
fn regex_lite_find_brackets(s: &str) -> Vec<&str> {
    let bytes = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'[' {
            if let Some(end_rel) = bytes[i + 1..].iter().position(|&b| b == b']') {
                let end = i + 1 + end_rel;
                out.push(&s[i + 1..end]);
                i = end + 1;
                continue;
            }
        }
        i += 1;
    }
    out
}

/// Inspect the `list-commands` reply and refine a starting
/// [`CapabilityMatrix`]. `entries` should be one parsed [`CommandListEntry`]
/// per line of the reply (empty lines are skipped by the parser).
///
/// Refinement rules:
///
/// - `refresh-client -C` (no-arg) → `supports_refresh_client_dash_c = true`
///   even when the version heuristic said `false` (handles tmux 2.2–2.9
///   where `-C` was a boolean flag, plus patched 3.x builds).
/// - `new-session -A` → `supports_new_session_dash_a = true` (override).
/// - `attach-session -c` → `supports_attach_session_dash_c_empty = true`.
/// - If `list-panes` appears in the reply → trust that the server has it
///   (no flag flip, but documents presence for logging).
///
/// When `entries` is empty (e.g. `list-commands` failed), the starting
/// matrix is returned unchanged.
pub fn infer_capabilities(
    version: &TmuxProtocolVersion,
    entries: &[CommandListEntry],
) -> CapabilityMatrix {
    let mut matrix = CapabilityMatrix::from_version(version);
    for entry in entries {
        match entry.command.as_str() {
            "refresh-client" if entry.has_flag("-C") => {
                matrix.supports_refresh_client_dash_c = true;
            }
            "new-session" if entry.has_flag("-A") => {
                matrix.supports_new_session_dash_a = true;
            }
            "attach-session" if entry.has_flag("-c") => {
                matrix.supports_attach_session_dash_c_empty = true;
            }
            _ => {}
        }
    }
    matrix
}

#[cfg(test)]
mod tests {
    use super::*;

    // ------------------- parse_version -----------------------------------

    #[test]
    fn parse_version_3_4() {
        assert_eq!(
            parse_version("3.4"),
            Some(TmuxProtocolVersion {
                major: 3,
                minor: 4,
                patch: None,
            })
        );
    }

    #[test]
    fn parse_version_3_5a() {
        assert_eq!(
            parse_version("3.5a"),
            Some(TmuxProtocolVersion {
                major: 3,
                minor: 5,
                patch: Some("a".into()),
            })
        );
    }

    #[test]
    fn parse_version_2_2() {
        assert_eq!(
            parse_version("2.2"),
            Some(TmuxProtocolVersion {
                major: 2,
                minor: 2,
                patch: None,
            })
        );
    }

    #[test]
    fn parse_version_trims_whitespace() {
        assert_eq!(
            parse_version("  3.4  \n"),
            Some(TmuxProtocolVersion {
                major: 3,
                minor: 4,
                patch: None,
            })
        );
    }

    #[test]
    fn parse_version_empty_returns_none() {
        assert_eq!(parse_version(""), None);
        assert_eq!(parse_version("   \n"), None);
    }

    #[test]
    fn parse_version_malformed_returns_none() {
        // Missing minor
        assert_eq!(parse_version("3"), None);
        // Missing major
        assert_eq!(parse_version(".4"), None);
        // No digits at all
        assert_eq!(parse_version("tmux"), None);
        // Letters in major
        assert_eq!(parse_version("a.4"), None);
    }

    #[test]
    fn parse_version_pre_release_p() {
        assert_eq!(
            parse_version("3.5p"),
            Some(TmuxProtocolVersion {
                major: 3,
                minor: 5,
                patch: Some("p".into()),
            })
        );
    }

    // ------------------- at_least ----------------------------------------

    #[test]
    fn at_least_returns_true_for_equal_or_greater() {
        let v = TmuxProtocolVersion {
            major: 3,
            minor: 4,
            patch: None,
        };
        assert!(v.at_least(3, 4));
        assert!(v.at_least(3, 0));
        assert!(v.at_least(2, 9));
        assert!(!v.at_least(3, 5));
        assert!(!v.at_least(4, 0));
    }

    // ------------------- CapabilityMatrix::from_version -------------------

    #[test]
    fn capability_matrix_3_5a_enables_modern_features() {
        let v = TmuxProtocolVersion {
            major: 3,
            minor: 5,
            patch: Some("a".into()),
        };
        let m = CapabilityMatrix::from_version(&v);
        assert!(m.supports_new_session_dash_a);
        assert!(m.supports_refresh_client_dash_c);
        assert!(m.auto_pushes_window_pane_changed);
        assert!(m.supports_attach_session_dash_c_empty);
    }

    #[test]
    fn capability_matrix_3_1_disables_new_session_dash_a() {
        let v = TmuxProtocolVersion {
            major: 3,
            minor: 1,
            patch: None,
        };
        let m = CapabilityMatrix::from_version(&v);
        assert!(!m.supports_new_session_dash_a, "3.1 < 3.2");
        assert!(m.supports_refresh_client_dash_c);
        assert!(m.supports_attach_session_dash_c_empty);
    }

    #[test]
    fn capability_matrix_2_5_disables_dash_C_and_dash_A() {
        let v = TmuxProtocolVersion {
            major: 2,
            minor: 5,
            patch: None,
        };
        let m = CapabilityMatrix::from_version(&v);
        assert!(!m.supports_new_session_dash_a);
        assert!(!m.supports_refresh_client_dash_c, "2.5 < 3.0");
        assert!(!m.auto_pushes_window_pane_changed);
        assert!(!m.supports_attach_session_dash_c_empty, "2.5 < 2.6");
    }

    #[test]
    fn capability_matrix_2_2_disables_dash_c_empty() {
        let v = TmuxProtocolVersion {
            major: 2,
            minor: 2,
            patch: None,
        };
        let m = CapabilityMatrix::from_version(&v);
        assert!(!m.supports_attach_session_dash_c_empty, "2.2 < 2.6");
        assert!(!m.supports_new_session_dash_a);
        assert!(!m.supports_refresh_client_dash_c);
    }

    // ------------------- CommandListEntry --------------------------------

    #[test]
    fn command_list_entry_parses_command_and_usage() {
        let e = CommandListEntry::parse("refresh-client [-c target-client] [-F flags]");
        assert_eq!(
            e,
            Some(CommandListEntry {
                command: "refresh-client".into(),
                usage: "[-c target-client] [-F flags]".into(),
            })
        );
    }

    #[test]
    fn command_list_entry_no_usage() {
        let e = CommandListEntry::parse("list-commands").unwrap();
        assert_eq!(e.command, "list-commands");
        assert_eq!(e.usage, "");
    }

    #[test]
    fn command_list_entry_empty_line_returns_none() {
        assert!(CommandListEntry::parse("").is_none());
        assert!(CommandListEntry::parse("   ").is_none());
    }

    #[test]
    fn command_list_entry_has_flag_matches_exact_token() {
        let e = CommandListEntry::parse("refresh-client -C").unwrap();
        assert!(e.has_flag("-C"));
        assert!(!e.has_flag("-CSomething"));
        assert!(!e.has_flag("C"));
    }

    #[test]
    fn command_list_entry_has_flag_handles_multiple_flags() {
        // `[-AdE]` is tmux's shorthand for "any combination of -A, -d, -E".
        let e = CommandListEntry::parse("new-session [-AdE] [-F format]").unwrap();
        assert!(e.has_flag("-A"), "should match inside [-AdE]");
        assert!(e.has_flag("-d"), "should match inside [-AdE]");
        assert!(e.has_flag("-E"), "should match inside [-AdE]");
        assert!(!e.has_flag("-X"), "should not match");
    }

    #[test]
    fn command_list_entry_has_flag_recognises_standalone_flag() {
        let e = CommandListEntry::parse("refresh-client -C").unwrap();
        assert!(e.has_flag("-C"));
        assert!(!e.has_flag("-A"));
    }

    // ------------------- infer_capabilities ------------------------------

    #[test]
    fn infer_capabilities_refines_3_1_with_explicit_flags() {
        // tmux 3.1 doesn't know `new-session -A` per the version heuristic,
        // but if `list-commands` actually lists it, trust the server.
        let v = TmuxProtocolVersion {
            major: 3,
            minor: 1,
            patch: None,
        };
        let entries = vec![CommandListEntry::parse("new-session [-AdE] [-F format]").unwrap()];
        let m = infer_capabilities(&v, &entries);
        assert!(m.supports_new_session_dash_a, "list-commands override");
    }

    #[test]
    fn infer_capabilities_empty_entries_returns_version_heuristic() {
        let v = TmuxProtocolVersion {
            major: 3,
            minor: 5,
            patch: None,
        };
        let m = infer_capabilities(&v, &[]);
        let expected = CapabilityMatrix::from_version(&v);
        assert_eq!(m, expected);
    }

    #[test]
    fn infer_capabilities_does_not_disable_when_command_missing() {
        // If list-commands doesn't mention `refresh-client -C`, the
        // version heuristic still wins. This protects against partial
        // list-commands replies (e.g. a tmux build that silently dropped
        // some commands from the reply).
        let v = TmuxProtocolVersion {
            major: 2,
            minor: 9,
            patch: None,
        };
        let entries = vec![CommandListEntry::parse("kill-pane -a").unwrap()];
        let m = infer_capabilities(&v, &entries);
        // 2.9 < 3.0 → -C still disabled (heuristic wins)
        assert!(!m.supports_refresh_client_dash_c);
    }

    #[test]
    fn infer_capabilities_realistic_3_4_reply() {
        // Excerpt from a real tmux 3.4 `list-commands` reply.
        let raw = "\
attach-session [-c target-client] [-d] [-r] [-t target-session]
new-session [-AdE] [-F format] [-P printer] [-S name] [-t target-session] [-x width] [-y height]
refresh-client [-c target-client] [-F flags] [-S] [-A]
list-commands [-F format]
";
        let entries: Vec<CommandListEntry> =
            raw.lines().map(CommandListEntry::parse).flatten().collect();
        let v = TmuxProtocolVersion {
            major: 3,
            minor: 4,
            patch: None,
        };
        let m = infer_capabilities(&v, &entries);
        assert!(m.supports_new_session_dash_a);
        assert!(m.supports_refresh_client_dash_c);
        assert!(m.supports_attach_session_dash_c_empty);
        assert!(m.auto_pushes_window_pane_changed);
    }

    #[test]
    fn infer_capabilities_old_tmux_with_no_dash_C() {
        // tmux 2.2 lists `refresh-client` without `-C` (that flag didn't
        // exist). Capability should stay false.
        let raw = "\
refresh-client [-c target-client] [-f flags] [-S size] [-A]
";
        let entries: Vec<CommandListEntry> =
            raw.lines().map(CommandListEntry::parse).flatten().collect();
        let v = TmuxProtocolVersion {
            major: 2,
            minor: 2,
            patch: None,
        };
        let m = infer_capabilities(&v, &entries);
        assert!(!m.supports_refresh_client_dash_c);
        assert!(!m.supports_attach_session_dash_c_empty);
    }
}
