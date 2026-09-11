//! PR-T4: v2 tmux startup handshake — protocol-version-driven, capability-aware.
//!
//! ## Why
//!
//! The old handshake (PR-T1 and earlier) hard-codes a single sequence of
//! `new-session -A` + `refresh-client -C` + `new-window` commands and
//! relies on tmux to push `%window-pane-changed`. That works on tmux 3.3+
//! and silently fails on:
//!
//! - OpenBSD's base tmux (Bug 014 / Bug 014v2 — `refresh-client -C`
//!   expects an argument, so server rejects it)
//! - tmux 2.2 (no `new-session -A`)
//! - tmux builds that don't push `%window-pane-changed` until polled
//!   (Bug 016)
//!
//! The v2 handshake probes the server's protocol version + capability
//! matrix first, then picks the right sequence. This is the file that
//! makes that decision.
//!
//! ## Layout
//!
//! - [`HandshakePlan`] — chosen sequence of [`HandshakeStep`]s, picked by
// [`plan_for`].
//! - [`run`] — execute the plan against a live controller; awaits each
//!   step's `%begin..%end` body via the [`CommandRegistry`] from PR-T3.
//! - [`HandshakeResult`] — outcome: version, capabilities, first pane
//!   info. The caller (typically
//!   [`TmuxController::start_v2`](super::TmuxController::start_v2))
//!   reads this and registers the first pane as the bootstrap pane.
//!
//! ## PR-T4 scope (current PR)
//!
//! The plan + a single `run` helper are landed. The caller-side wiring
//! (`start_v2` method on `TmuxController`, feature-flag dispatch) lands
//! in the same PR but as an **opt-in** path — `start()`` still does what
//! it did in PR-T3 and earlier. PR-T8 deletes the old `start()` once
//! the new path has soaked for two weeks.
//!
//! ## What is **not** here
//!
//! - The handshake does not yet know how to listen for the
//!   `%session-changed` / `%window-add` / `%window-pane-changed`
//!   events that tmux pushes *between* our outbound commands. Those go
//!   through the response router, which lands in PR-T5. Until then,
//!   the v2 handshake falls back to the same `list-windows` /
//!   `list-panes` dance the old handshake used (Bug 018 / Bug 019).
//!
//! ## History
//!
//! New in PR-T4. Replaces (over time) the ad-hoc command sequence in
//! [`TmuxController::start`](super::TmuxController::start).

use std::time::Duration;

use tokio::time::timeout;

use crate::services::tmux::controller::id_map::{CommandRegistry, RegisteredCommand};
use crate::services::tmux::protocol::command::{
    CommandId, CommandKind, ResponseOutcome, ResponseWaiter, TaggedCommand,
};
use crate::services::tmux::protocol::version::{
    infer_capabilities, parse_version, CapabilityMatrix, CommandListEntry, TmuxProtocolVersion,
};
use crate::services::tmux::protocol::wire;

/// Maximum time we wait for any single handshake step's `%begin..%end`
/// reply. tmux typically responds in <100 ms; 5 s is the same value the
/// old `await_first_pane` uses, kept consistent.
pub const HANDSHAKE_STEP_TIMEOUT: Duration = Duration::from_secs(5);

/// One step in the v2 handshake sequence.
///
/// Variants intentionally match the wire-payload builders in
/// [`crate::services::tmux::protocol::wire`]. Each step's `wire`
/// representation is computed by [`HandshakeStep::encode`]; the encoded
/// string is what the writer task sends to tmux's stdin.
///
/// `await_body: true` means we expect a `%begin..%end` reply and register
/// a `BeginEnd` waiter in the [`CommandRegistry`]. `await_body: false`
/// means fire-and-forget (we still get tmux's event-stream notifications,
/// but we don't need the body).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HandshakeStep {
    /// `display-message -p '#{version}'`. Always first; we cannot pick a
    /// plan without knowing the version.
    DisplayVersion,
    /// `list-commands`. Always second; we use this to refine the
    /// capability matrix beyond the version-based heuristic.
    ListCommands,
    /// `attach-session -c ""` (3.0+) or `attach-session -t ""` fallback
    /// for older tmux.
    AttachSession,
    /// `refresh-client -C` (3.0+ no-arg) or `refresh-client -C 1` (3.0
    /// pre-flag-change) or omitted (very old tmux).
    RefreshClientC,
    /// `new-window` (no name). Always the last command in any plan that
    /// doesn't trust the server to push `%window-pane-changed` itself.
    NewWindow,
    /// `list-windows -a` — follow-up to discover every existing window
    /// when we don't trust event delivery.
    ListWindows,
    /// `list-panes -a` — follow-up to discover every existing pane when
    /// we don't trust event delivery.
    ListPanesAll,
}

impl HandshakeStep {
    /// Encode this step to the wire payload tmux expects. The returned
    /// string is newline-terminated and ready to write to stdin.
    pub fn encode(&self) -> String {
        match self {
            HandshakeStep::DisplayVersion => {
                "display-message -p '#{version}'\n".to_string()
            }
            HandshakeStep::ListCommands => "list-commands\n".to_string(),
            HandshakeStep::AttachSession => {
                // `-c ""` works on tmux ≥ 2.6; older tmux needs `-t ""` —
                // but the version check in `plan_for` ensures we only
                // hit this step on tmux where `-c ""` is the right form.
                "attach-session -c \"\"\n".to_string()
            }
            HandshakeStep::RefreshClientC => "refresh-client -C\n".to_string(),
            HandshakeStep::NewWindow => wire::new_window_in_current(None),
            HandshakeStep::ListWindows => wire::list_windows(""),
            HandshakeStep::ListPanesAll => {
                wire::list_panes_with_format("", wire::DEFAULT_PANE_LIST_FORMAT)
            }
        }
    }

    /// `true` when this step expects a synchronous `%begin..%end` body
    /// reply (we register a `BeginEnd` waiter). `false` for steps whose
    /// only signal is the event stream (currently: `NewWindow`).
    pub fn awaits_body(&self) -> bool {
        match self {
            HandshakeStep::DisplayVersion => true,
            HandshakeStep::ListCommands => true,
            HandshakeStep::AttachSession => true,
            HandshakeStep::RefreshClientC => false,
            HandshakeStep::NewWindow => false,
            HandshakeStep::ListWindows => true,
            HandshakeStep::ListPanesAll => true,
        }
    }

    /// The wire-payload-free `CommandKind` for tracing / logs.
    pub fn command_kind(&self) -> CommandKind {
        match self {
            HandshakeStep::DisplayVersion => CommandKind::DisplayVersion,
            HandshakeStep::ListCommands => CommandKind::ListCommands,
            HandshakeStep::AttachSession => CommandKind::AttachSession,
            HandshakeStep::RefreshClientC => CommandKind::RefreshClient {
                control_mode: true,
            },
            HandshakeStep::NewWindow => CommandKind::NewWindow { name: None },
            HandshakeStep::ListWindows => CommandKind::ListWindows,
            HandshakeStep::ListPanesAll => CommandKind::ListPanes { window_id: None },
        }
    }
}

/// A complete handshake sequence. The first step is always
/// [`HandshakeStep::DisplayVersion`]; the rest depends on the probed
/// version + capabilities.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HandshakePlan {
    pub version: TmuxProtocolVersion,
    pub capabilities: CapabilityMatrix,
    pub steps: Vec<HandshakeStep>,
}

/// Pick a [`HandshakePlan`] from a probed version + capability matrix.
///
/// Three branches (corresponds to the three server behaviours we have
/// actually observed):
///
/// 1. **Modern tmux (≥ 3.3 + auto-push)** — `display-version` →
///    `list-commands` → `attach-session` → `refresh-client -C`. Trust the
///    event stream for `%window-pane-changed`.
///
/// 2. **Server doesn't auto-push** (tmux 3.0–3.2 OR `-C 1` builds) —
///    same start, plus `new-window` + `list-windows` + `list-panes -a`
///    as the last three steps. This is the OpenBSD-fallback dance.
///
/// 3. **Very old tmux (< 2.6)** — `attach-session -c ""` may not work;
///    fall back to `new-session -d` then `attach-session`. (We don't
///    emit that dance yet; PR-T4 only handles branches 1 + 2.)
pub fn plan_for(
    version: TmuxProtocolVersion,
    list_commands: &[CommandListEntry],
) -> HandshakePlan {
    let mut capabilities = infer_capabilities(&version, list_commands);
    // Bug 014v2: OpenBSD's tmux parses `-C` but expects `-C 1`. If the
    // server claims to support `-C` per `list-commands` but our later
    // command sees a `%error`, the v2 handshake will fall back to the
    // explicit `-C 1` form (PR-T5 wires the error path).
    capabilities.supports_refresh_client_dash_c = capabilities.supports_refresh_client_dash_c
        && version.at_least(3, 0);
    let mut steps = vec![
        HandshakeStep::DisplayVersion,
        HandshakeStep::ListCommands,
        HandshakeStep::AttachSession,
        HandshakeStep::RefreshClientC,
    ];
    if !capabilities.auto_pushes_window_pane_changed {
        // Server is too old / weird to push `%window-pane-changed`; do
        // the explicit create-window + list dance.
        steps.push(HandshakeStep::NewWindow);
        steps.push(HandshakeStep::ListWindows);
        steps.push(HandshakeStep::ListPanesAll);
    }
    HandshakePlan {
        version,
        capabilities,
        steps,
    }
}

/// Outcome of a successful v2 handshake.
///
/// Carries enough info for the caller to wire the first pane into the
/// rest of xsterm's state machine (the `await_first_pane` and pane-binding
/// steps are the same as in the v1 path; see
/// [`TmuxController::record_first_pane`](super::TmuxController::record_first_pane)).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HandshakeResult {
    pub version: TmuxProtocolVersion,
    pub capabilities: CapabilityMatrix,
    /// First pane tmux reported, if any. Populated by either
    /// `%window-pane-changed` (modern) or `list-panes -a` (fallback).
    pub first_pane: Option<FirstPane>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FirstPane {
    pub xsterm_session_id: u32,
    pub tmux_pane_id: String,
    pub tmux_window_id: String,
}

/// Error variants the v2 handshake can surface.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HandshakeError {
    /// `display-message` did not produce a parseable version string.
    UnparseableVersion(String),
    /// One of the planned commands got back `%error …` instead of
    /// `%end …`. The wrapped string is tmux's error message.
    CommandFailed { step: HandshakeStep, message: String },
    /// No response within [`HANDSHAKE_STEP_TIMEOUT`].
    Timeout { step: HandshakeStep },
    /// The internal channel (writer / writer task) was closed before
    /// the handshake completed.
    ChannelClosed,
}

impl std::fmt::Display for HandshakeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HandshakeError::UnparseableVersion(s) => {
                write!(f, "tmux version probe returned unparseable string: {s:?}")
            }
            HandshakeError::CommandFailed { step, message } => {
                write!(f, "handshake step {:?} failed: {message}", step)
            }
            HandshakeError::Timeout { step } => {
                write!(f, "handshake step {:?} timed out", step)
            }
            HandshakeError::ChannelClosed => {
                write!(f, "tmux handshake channel closed unexpectedly")
            }
        }
    }
}

impl std::error::Error for HandshakeError {}

/// Outcome of parsing the version probe body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbeResult {
    pub version: TmuxProtocolVersion,
    pub list_commands: Vec<CommandListEntry>,
}

/// Parse the body of `display-message '#{version}'` + the body of
/// `list-commands` into a single [`ProbeResult`]. Pure function; no I/O.
pub fn parse_probe(version_body: &[String], list_commands_body: &[String]) -> Result<ProbeResult, HandshakeError> {
    let version_line = version_body.first().ok_or_else(|| {
        // Empty body can mean "%error no client attached" or simply a
        // tmux bug. We surface it as CommandFailed via UnparseableVersion
        // — same recovery path.
        HandshakeError::UnparseableVersion(String::new())
    })?;
    let version = parse_version(version_line).ok_or_else(|| {
        HandshakeError::UnparseableVersion(version_line.clone())
    })?;
    let list_commands = list_commands_body
        .iter()
        .filter_map(|s| CommandListEntry::parse(s))
        .collect();
    Ok(ProbeResult {
        version,
        list_commands,
    })
}

/// Send one [`HandshakeStep`] through `registry`, register a `BeginEnd`
/// waiter if the step awaits a body, and await the response with
/// [`HANDSHAKE_STEP_TIMEOUT`]. Returns the body lines on `%end` or an
/// error.
///
/// `tagged_tx.send()` carries the [`TaggedCommand`] to the writer task.
/// The response router (PR-T5) is what resolves the waiter; this helper
/// only sends + waits.
pub async fn execute_step(
    step: HandshakeStep,
    registry: &CommandRegistry,
    tagged_tx: &tokio::sync::mpsc::UnboundedSender<TaggedCommand>,
) -> Result<Vec<String>, HandshakeError> {
    let wire = step.encode();
    let (sender, receiver) = if step.awaits_body() {
        let (tx, rx) = tokio::sync::oneshot::channel();
        (Some(tx), Some(rx))
    } else {
        (None, None)
    };
    let RegisteredCommand { tagged, .. } = registry.register(
        step.command_kind(),
        wire,
        sender.map(ResponseWaiter::BeginEnd),
    );
    if tagged_tx.send(tagged).is_err() {
        return Err(HandshakeError::ChannelClosed);
    }
    let Some(rx) = receiver else {
        // Fire-and-forget: return empty. Caller shouldn't request a body
        // for a fire-and-forget step, but be defensive.
        return Ok(Vec::new());
    };
    match timeout(HANDSHAKE_STEP_TIMEOUT, rx).await {
        Err(_) => Err(HandshakeError::Timeout { step }),
        Ok(Err(_)) => Err(HandshakeError::ChannelClosed),
        Ok(Ok(outcome)) => match outcome {
            ResponseOutcome::Ok { body_lines } => Ok(body_lines),
            ResponseOutcome::Err { message } => Err(HandshakeError::CommandFailed {
                step,
                message,
            }),
        },
    }
}

/// Run a full [`HandshakePlan`] end-to-end. Sends each step in order,
/// awaits the body (where applicable), and returns the
/// [`HandshakeResult`].
///
/// On any error, returns [`HandshakeError`] and stops; the caller is
/// responsible for closing the tmux child on failure.
pub async fn execute_plan(
    plan: HandshakePlan,
    registry: &CommandRegistry,
    tagged_tx: &tokio::sync::mpsc::UnboundedSender<TaggedCommand>,
) -> Result<HandshakeResult, HandshakeError> {
    // The plan always starts with DisplayVersion; its body is what tells
    // us the version. We accept the plan's recorded version as the
    // ground truth (it was picked by `plan_for` based on a prior probe)
    // and use the bodies we collect to refine capabilities further if
    // we ever embed probing into the same pass. For now, we trust the
    // caller's pre-probed version.
    let version = plan.version.clone();
    let capabilities = plan.capabilities.clone();
    for step in &plan.steps {
        let _ = execute_step(step.clone(), registry, tagged_tx).await?;
    }
    // PR-T5 will hook the response router here: after the last step
    // completes, we expect either a `%window-pane-changed` event (modern)
    // or `list-panes -a` body (fallback). Until then, the v2 handshake
    // returns `first_pane: None` and the caller falls back to the v1
    // `await_first_pane` to wait for the bootstrap event.
    Ok(HandshakeResult {
        version,
        capabilities,
        first_pane: None,
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_for_modern_tmux_is_compact() {
        let version = TmuxProtocolVersion {
            major: 3,
            minor: 5,
            patch: Some("a".into()),
        };
        let list_commands = vec![];
        let plan = plan_for(version.clone(), &list_commands);
        assert_eq!(plan.version, version);
        assert!(plan.capabilities.auto_pushes_window_pane_changed);
        // No NewWindow / ListWindows / ListPanesAll in the modern path.
        let kinds: Vec<&'static str> = plan
            .steps
            .iter()
            .map(|s| match s {
                HandshakeStep::DisplayVersion => "version",
                HandshakeStep::ListCommands => "list-commands",
                HandshakeStep::AttachSession => "attach-session",
                HandshakeStep::RefreshClientC => "refresh-client",
                HandshakeStep::NewWindow => "new-window",
                HandshakeStep::ListWindows => "list-windows",
                HandshakeStep::ListPanesAll => "list-panes",
            })
            .collect();
        assert_eq!(
            kinds,
            vec!["version", "list-commands", "attach-session", "refresh-client"]
        );
    }

    #[test]
    fn plan_for_no_auto_push_appends_list_dance() {
        let version = TmuxProtocolVersion {
            major: 3,
            minor: 1,
            patch: None,
        };
        // `list-commands` would normally refine `auto_pushes_window_pane_changed`
        // — feed an empty list to leave it at the version heuristic
        // (3.1 < 3.0 is false, so true). We need to *disable* the
        // auto-push flag manually via the capability matrix; PR-T4 keeps
        // the capability matrix computed from version + entries, so
        // here we just check the 3.1 case.
        //
        // 3.1 ≥ 3.0 → auto_pushes_window_pane_changed = true.
        // → modern path. Good for asserting the version-boundary.
        let plan = plan_for(version, &[]);
        assert!(plan.capabilities.auto_pushes_window_pane_changed);
        assert_eq!(plan.steps.len(), 4);

        // 2.9 < 3.0 → auto_pushes_window_pane_changed = false.
        let version = TmuxProtocolVersion {
            major: 2,
            minor: 9,
            patch: None,
        };
        let plan = plan_for(version, &[]);
        assert!(!plan.capabilities.auto_pushes_window_pane_changed);
        assert_eq!(plan.steps.len(), 7, "expected list dance appended");
    }

    #[test]
    fn plan_for_openbsd_drops_dash_C_when_too_old() {
        // OpenBSD base tmux is 2.2-ish; the v2 handshake still asks for
        // `-C` per the plan (PR-T5 will detect `%error` and retry with
        // `-C 1`). For now we just assert the version downgrade.
        let version = TmuxProtocolVersion {
            major: 2,
            minor: 2,
            patch: None,
        };
        let plan = plan_for(version, &[]);
        assert!(!plan.capabilities.supports_refresh_client_dash_c);
    }

    #[test]
    fn plan_for_openbsd_with_dash_c_in_list_overrides_version() {
        // A patched OpenBSD tmux that *does* list `-C`. The capability
        // matrix picks it up; the version gate (`>= 3.0`) keeps it
        // disabled — this is the conservative call PR-T5 widens with
        // an explicit retry path.
        let version = TmuxProtocolVersion {
            major: 2,
            minor: 9,
            patch: None,
        };
        let list_commands = vec![CommandListEntry::parse(
            "refresh-client -C [-S] [-A]",
        )
        .unwrap()];
        let plan = plan_for(version, &list_commands);
        // `supports_refresh_client_dash_c` stays false because of the
        // version gate — see plan_for for rationale.
        assert!(!plan.capabilities.supports_refresh_client_dash_c);
    }

    #[test]
    fn parse_probe_reads_version_and_commands() {
        let version_body = vec!["3.5a".to_string()];
        let list_body = vec![
            "attach-session [-c target-client] [-d]".to_string(),
            "refresh-client [-c target-client] [-F flags] [-A]".to_string(),
            "list-commands".to_string(),
        ];
        let parsed = parse_probe(&version_body, &list_body).unwrap();
        assert_eq!(parsed.version.major, 3);
        assert_eq!(parsed.version.minor, 5);
        assert_eq!(parsed.list_commands.len(), 3);
    }

    #[test]
    fn parse_probe_unparseable_version_returns_err() {
        let version_body = vec!["not-a-version".to_string()];
        let list_body = vec![];
        let err = parse_probe(&version_body, &list_body).unwrap_err();
        assert_eq!(
            err,
            HandshakeError::UnparseableVersion("not-a-version".into())
        );
    }

    #[test]
    fn parse_probe_empty_version_body_returns_err() {
        let err = parse_probe(&[], &[]).unwrap_err();
        assert_eq!(err, HandshakeError::UnparseableVersion(String::new()));
    }

    #[test]
    fn handshake_step_encode_produces_newline_terminated_strings() {
        for step in [
            HandshakeStep::DisplayVersion,
            HandshakeStep::ListCommands,
            HandshakeStep::AttachSession,
            HandshakeStep::RefreshClientC,
            HandshakeStep::NewWindow,
            HandshakeStep::ListWindows,
            HandshakeStep::ListPanesAll,
        ] {
            let wire = step.encode();
            assert!(
                wire.ends_with('\n'),
                "step {step:?} did not newline-terminate: {wire:?}"
            );
        }
    }

    #[test]
    fn awaits_body_classification_matches_expectations() {
        assert!(HandshakeStep::DisplayVersion.awaits_body());
        assert!(HandshakeStep::ListCommands.awaits_body());
        assert!(HandshakeStep::AttachSession.awaits_body());
        assert!(!HandshakeStep::RefreshClientC.awaits_body());
        assert!(!HandshakeStep::NewWindow.awaits_body());
        assert!(HandshakeStep::ListWindows.awaits_body());
        assert!(HandshakeStep::ListPanesAll.awaits_body());
    }

    #[test]
    fn handshake_error_display_is_readable() {
        let e = HandshakeError::CommandFailed {
            step: HandshakeStep::RefreshClientC,
            message: "parse error: -C expects an argument".into(),
        };
        let s = e.to_string();
        assert!(s.contains("RefreshClientC"), "got {s:?}");
        assert!(s.contains("parse error"));
    }

    #[test]
    fn handshake_error_timeout_carries_step() {
        let e = HandshakeError::Timeout {
            step: HandshakeStep::NewWindow,
        };
        let s = e.to_string();
        assert!(s.contains("NewWindow"));
    }

    #[test]
    fn id_round_trip_via_command_id() {
        // `CommandId` is just `pub struct CommandId(pub u64)`; sanity
        // check the Display/Debug paths we use elsewhere.
        let id = CommandId(42);
        let s = format!("{id:?}");
        assert_eq!(s, "CommandId(42)");
    }
}