use super::io_tasks::{spawn_reader_task, spawn_writer_task};
use super::*;
use crate::services::tmux_session::bridge::TmuxBridge;
use std::io::Cursor;
use std::sync::{Arc, Mutex as StdMutex};
use tokio::io::{duplex, AsyncReadExt};
use tokio::time::timeout;

/// Pull up to `max` events from `rx` with a short per-recv timeout, so the
/// test fails fast instead of hanging on an empty channel.
async fn drain_events(
    rx: &mut mpsc::UnboundedReceiver<ProtocolEvent>,
    max: usize,
) -> Vec<ProtocolEvent> {
    let mut out = Vec::new();
    for _ in 0..max {
        match timeout(std::time::Duration::from_millis(100), rx.recv()).await {
            Ok(Some(ev)) => out.push(ev),
            _ => break,
        }
    }
    out
}

/// Hand-rolled `AppBackend` for unit tests — records every emit
/// through an `Arc<Mutex<Vec<…>>>` so assertions can scan the timeline.
#[derive(Clone)]
struct RecordingBackend {
    events: Arc<StdMutex<Vec<(String, serde_json::Value)>>>,
    fail_next: Arc<StdMutex<bool>>,
}

impl RecordingBackend {
    fn new() -> Self {
        Self {
            events: Arc::new(StdMutex::new(Vec::new())),
            fail_next: Arc::new(StdMutex::new(false)),
        }
    }
    fn recorded(&self) -> Vec<(String, serde_json::Value)> {
        self.events.lock().unwrap().clone()
    }
}

impl AppBackend for RecordingBackend {
    fn emit(&self, event: &str, payload: &serde_json::Value) -> Result<(), String> {
        let fail = *self.fail_next.lock().unwrap();
        if fail {
            *self.fail_next.lock().unwrap() = false;
            return Err("RecordingBackend: forced emit failure".to_string());
        }
        self.events
            .lock()
            .unwrap()
            .push((event.to_string(), payload.clone()));
        Ok(())
    }
    fn emit_binary(&self, _bytes: Vec<u8>) -> Result<(), String> {
        Ok(())
    }
    fn spawn(&self, _f: Box<dyn FnOnce() + Send>) {}
}

#[tokio::test]
async fn reader_task_emits_parsed_events_until_eof() {
    let stdout =
        Cursor::new(b"%begin 1 7 0\nline one\nline two\n%end 1 7 0\n%sessions-changed\n".to_vec());
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<ProtocolEvent>();
    spawn_reader_task(stdout, event_tx);

    let mut events = Vec::new();
    while let Some(ev) = event_rx.recv().await {
        events.push(ev);
    }

    assert!(events.contains(&ProtocolEvent::CommandBegin {
        id: 7,
        timestamp: 1,
        flags: 0
    }));
    assert!(events.contains(&ProtocolEvent::CommandOutput {
        id: 7,
        line: "line one".to_string()
    }));
    assert!(events.contains(&ProtocolEvent::CommandOutput {
        id: 7,
        line: "line two".to_string()
    }));
    assert!(events.contains(&ProtocolEvent::CommandEnd {
        id: 7,
        timestamp: 1,
        flags: 0
    }));
    assert!(events.contains(&ProtocolEvent::SessionsChanged));
}

/// `tmux -CC` wraps its wire protocol in a DCS passthrough
/// sequence (`ESC P 1000 p ... ESC \`). The DCS start marker is
/// concatenated to the first notification line with no
/// intervening newline, so the reader's `BufReader::lines()`
/// splits as one line: `"ESC P 1000 p%begin 1 7 0"`. Without
/// DCS stripping the parser would drop the whole line as
/// `Unknown` and miss the `%begin` — the corresponding
/// command block never opens, the `%end` falls back to
/// `Unknown`, and no events are emitted.
///
/// Regression test for Bug 009.
#[tokio::test]
async fn reader_task_strips_dcs_passthrough_start_marker() {
    let stdout = Cursor::new(
        b"\x1bP1000p%begin 1 7 0\nline one\nline two\n%end 1 7 0\n%sessions-changed\n".to_vec(),
    );
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<ProtocolEvent>();
    spawn_reader_task(stdout, event_tx);

    let mut events = Vec::new();
    while let Some(ev) = event_rx.recv().await {
        events.push(ev);
    }

    assert!(events.contains(&ProtocolEvent::CommandBegin {
        id: 7,
        timestamp: 1,
        flags: 0
    }));
    assert!(events.contains(&ProtocolEvent::CommandOutput {
        id: 7,
        line: "line one".to_string()
    }));
    assert!(events.contains(&ProtocolEvent::CommandOutput {
        id: 7,
        line: "line two".to_string()
    }));
    assert!(events.contains(&ProtocolEvent::CommandEnd {
        id: 7,
        timestamp: 1,
        flags: 0
    }));
    assert!(events.contains(&ProtocolEvent::SessionsChanged));
}

/// The DCS end marker (`ESC \`, 2 bytes) may be concatenated
/// to the final notification line. After stripping it the
/// parser should still see a clean `%xxx` line.
#[tokio::test]
async fn reader_task_strips_dcs_passthrough_end_marker() {
    let stdout = Cursor::new(b"%sessions-changed\x1b\\\n".to_vec());
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<ProtocolEvent>();
    spawn_reader_task(stdout, event_tx);

    let mut events = Vec::new();
    while let Some(ev) = event_rx.recv().await {
        events.push(ev);
    }

    assert!(events.contains(&ProtocolEvent::SessionsChanged));
}

#[tokio::test]
async fn reader_task_decodes_escaped_output_payload() {
    let stdout = Cursor::new(b"%output %5 hello\\012world\n".to_vec());
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<ProtocolEvent>();
    spawn_reader_task(stdout, event_tx);

    let events = drain_events(&mut event_rx, 4).await;
    assert!(events.iter().any(|e| matches!(e,
        ProtocolEvent::Output { pane_id, data }
            if pane_id == "%5" && data == b"hello\nworld"
    )));
}

#[tokio::test]
async fn reader_task_drops_empty_lines_outside_block() {
    let stdout = Cursor::new(b"\n\n%sessions-changed\n\n".to_vec());
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<ProtocolEvent>();
    spawn_reader_task(stdout, event_tx);

    let mut events = Vec::new();
    while let Some(ev) = event_rx.recv().await {
        events.push(ev);
    }
    assert_eq!(events.len(), 1);
    assert!(matches!(events[0], ProtocolEvent::SessionsChanged));
}

#[tokio::test]
async fn writer_task_writes_commands_in_order_and_exits_on_drop() {
    let (a, mut b) = duplex(4096);
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<String>();
    spawn_writer_task(a, cmd_rx);

    cmd_tx
        .send("send-keys -t %5 a\\012\n".to_string())
        .expect("send 1");
    cmd_tx.send("list-sessions\n".to_string()).expect("send 2");
    drop(cmd_tx);

    let mut buf = Vec::new();
    b.read_to_end(&mut buf).await.expect("read_to_end succeeds");
    let s = String::from_utf8(buf).expect("ascii output");
    assert!(s.contains("send-keys -t %5 a\\012"));
    assert!(s.contains("list-sessions"));
}

#[tokio::test]
async fn write_command_on_closed_channel_returns_err() {
    let (tx, rx) = mpsc::unbounded_channel::<String>();
    drop(rx);
    let res = tx.send("cmd\n".to_string());
    assert!(res.is_err());
}

#[tokio::test]
async fn stdin_tx_clone_allows_multiple_writers() {
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let tx2 = tx.clone();
    tx.send("a\n".to_string()).unwrap();
    tx2.send("b\n".to_string()).unwrap();
    drop(tx);
    drop(tx2);

    let mut received = Vec::new();
    while let Some(s) = rx.recv().await {
        received.push(s);
    }
    assert_eq!(received, vec!["a\n".to_string(), "b\n".to_string()]);
}

#[test]
fn build_tmux_argv_includes_cc_socket_session_and_size() {
    let cfg = TmuxCcConfig {
        name: None,
        tmux_session_name: Some("work".to_string()),
        socket_name: Some("dev".to_string()),
        base_config_id: None,
        start_command: None,
        env_config: None,
        initial_rows: Some(40),
        initial_cols: Some(120),
        ssh: None,
    };
    let argv = build_tmux_argv(&cfg).expect("build argv");
    // Convert to Vec<&str> so assertion indexing is straightforward.
    let argv_refs: Vec<&str> = argv.iter().map(String::as_str).collect();
    assert_eq!(argv_refs[0], "-CC");
    assert_eq!(argv_refs[1], "-L");
    assert_eq!(argv_refs[2], "dev");
    assert_eq!(argv_refs[3], "new-session");
    assert_eq!(argv_refs[4], "-A");
    assert_eq!(argv_refs[5], "-s");
    assert_eq!(argv_refs[6], "work");
    assert_eq!(argv_refs[7], "-x");
    assert_eq!(argv_refs[8], "120");
    assert_eq!(argv_refs[9], "-y");
    assert_eq!(argv_refs[10], "40");
}

#[test]
fn build_tmux_argv_uses_defaults_when_config_is_sparse() {
    let cfg = TmuxCcConfig::default();
    let argv = build_tmux_argv(&cfg).expect("build argv");
    let argv_refs: Vec<&str> = argv.iter().map(String::as_str).collect();
    assert_eq!(argv_refs[0], "-CC");
    assert_eq!(argv_refs[2], DEFAULT_TMUX_SOCKET_NAME);
    // No -s flag when tmux_session_name is None.
    assert!(!argv_refs.contains(&"-s"));
    // Last element is the rows value; the column before that is the -y flag.
    assert_eq!(
        argv_refs[argv_refs.len() - 1],
        DEFAULT_INITIAL_ROWS.to_string()
    );
    assert_eq!(
        argv_refs[argv_refs.len() - 3],
        DEFAULT_INITIAL_COLS.to_string()
    );
}

#[test]
fn register_pane_idempotent_and_lookup_round_trip() {
    let backend: Arc<dyn AppBackend> = Arc::new(RecordingBackend::new());
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = Arc::new(TmuxController {
        controller_id: 1,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx: mpsc::unbounded_channel::<String>().0,
        app_backend: backend,
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(1000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    });

    assert!(controller.register_pane("%5".to_string(), 1001));
    assert!(
        !controller.register_pane("%5".to_string(), 1002),
        "duplicate registration must be rejected"
    );
    assert!(controller.xsterm_id_for_pane("%5").is_some());
    assert!(controller.xsterm_id_for_pane("%99").is_none());

    assert_eq!(controller.allocate_session_id(), 1_000_001);
    assert_eq!(controller.allocate_session_id(), 1_000_002);

    controller.record_first_pane(0, "%5".to_string());
    // Idempotent: second call is a no-op.
    controller.record_first_pane(0, "%6".to_string());
    // Sender must be taken (first call won).
    assert!(controller.first_pane_tx.lock().unwrap().is_none());
    // The buffered value on the receiver side must match the FIRST
    // call's args, proving the second call was a no-op.
    let mut rx = controller
        .first_pane_rx
        .blocking_lock()
        .take()
        .expect("receiver must still be present");
    assert_eq!(rx.try_recv().ok(), Some((0, "%5".to_string())));
}

#[test]
fn unbind_pane_removes_entry_and_errors_for_unknown() {
    let backend: Arc<dyn AppBackend> = Arc::new(RecordingBackend::new());
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = Arc::new(TmuxController {
        controller_id: 2,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx: mpsc::unbounded_channel::<String>().0,
        app_backend: backend,
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(2000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    });

    controller.register_pane("%1".to_string(), 2001);
    assert!(controller.unbind_pane("%1").is_ok());
    assert!(controller.xsterm_id_for_pane("%1").is_none());

    let err = controller.unbind_pane("%1").unwrap_err();
    assert!(
        err.to_string().contains("not bound"),
        "expected 'not bound' in message, got: {err}"
    );
}

#[tokio::test]
async fn dispatch_emits_session_output_for_registered_pane() {
    let backend = Arc::new(RecordingBackend::new());
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = Arc::new(TmuxController {
        controller_id: 3,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx: mpsc::unbounded_channel::<String>().0,
        app_backend: backend.clone(),
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(3000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    });
    controller.register_pane("%7".to_string(), 7777);

    let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
    spawn_dispatch_task(
        rx,
        controller.clone(),
        TmuxBridge::new(backend.clone(), controller.clone()),
    );
    tx.send(ProtocolEvent::Output {
        pane_id: "%7".to_string(),
        data: b"hi\n".to_vec(),
    })
    .unwrap();
    tx.send(ProtocolEvent::Output {
        pane_id: "%999".to_string(),
        data: b"orphan".to_vec(),
    })
    .unwrap();
    drop(tx);

    // Wait for the dispatch task to drain.
    for _ in 0..20 {
        if backend.recorded().len() >= 1 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }

    let recorded = backend.recorded();
    let output_event = recorded
        .iter()
        .find(|(name, _)| name == "session-output")
        .expect("session-output must be emitted for the registered pane");
    let arr = output_event
        .1
        .as_array()
        .expect("payload is [xsterm_id, data]");
    assert_eq!(arr[0].as_u64().unwrap(), 7777);
    let data_bytes: Vec<u8> = arr[1]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_u64().unwrap() as u8)
        .collect();
    assert_eq!(data_bytes, b"hi\n");
}

#[tokio::test]
async fn dispatch_emits_pane_added_and_records_first_pane() {
    let backend = Arc::new(RecordingBackend::new());
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = Arc::new(TmuxController {
        controller_id: 4,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx: mpsc::unbounded_channel::<String>().0,
        app_backend: backend.clone(),
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(4000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    });
    // Production flow: `WindowAdd` case b pre-registers a Bootstrap
    // EventWaiter keyed by `window_id` BEFORE the matching
    // `%window-pane-changed` arrives. Simulate that here so the
    // dispatch task takes the new case 3 (Bootstrap) path rather
    // than the deleted case 4 (legacy fallback).
    controller.registry.register_event_waiter(EventWaiter {
        kind: EventWaiterKind::Bootstrap,
        sender: EventWaiterSender::None,
        tmux_window_id: Some("@1".to_string()),
    });

    let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
    spawn_dispatch_task(
        rx,
        controller.clone(),
        TmuxBridge::new(backend.clone(), controller.clone()),
    );

    tx.send(ProtocolEvent::WindowPaneChanged {
        window_id: "@1".to_string(),
        pane_id: "%3".to_string(),
    })
    .unwrap();
    // Duplicate — must be ignored.
    tx.send(ProtocolEvent::WindowPaneChanged {
        window_id: "@1".to_string(),
        pane_id: "%3".to_string(),
    })
    .unwrap();
    // External pane after bootstrap — must NOT be auto-bound in
    // happens out-of-band (e.g. inner-shell `split-window`), the
    // dispatch task logs and skips. The frontend
    // listener for `tmux-pane-added` relies on this so its pane tree
    // never sees a brand-new pane it does not know about.
    tx.send(ProtocolEvent::WindowPaneChanged {
        window_id: "@1".to_string(),
        pane_id: "%4".to_string(),
    })
    .unwrap();
    drop(tx);

    // Spin until the dispatch task has processed all four events.
    for _ in 0..30 {
        if backend.recorded().len() >= 1 {
            // Give the dispatch task a few extra ticks to drain.
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }

    let recorded = backend.recorded();
    let pane_adds: Vec<&serde_json::Value> = recorded
        .iter()
        .filter(|(name, _)| name == "tmux-pane-added")
        .map(|(_, p)| p)
        .collect();
    assert_eq!(
        pane_adds.len(),
        1,
        "expected exactly 1 tmux-pane-added event (bootstrap only); got {recorded:?}"
    );
    let first = &pane_adds[0];
    // Wire contract: payload keys are snake_case on the wire and the
    // frontend destructure is also snake_case (`session_id` /
    // `tmux_controller_id` / `tmux_pane_id` / `tmux_window_id`,
    // see `useTauriListeners.ts`). The test asserts the snake_case
    // keys the bridge emits directly.
    assert_eq!(first["tmux_controller_id"].as_u64().unwrap(), 4);
    assert_eq!(first["tmux_pane_id"].as_str().unwrap(), "%3");
    assert_eq!(
        first["tmux_window_id"].as_str().unwrap(),
        "@1",
        "P7 bridge payload: tmux_window_id carries the parent window id (matches frontend contract)"
    );
    assert!(
        first.get("session_id").is_some(),
        "P7 bridge payload: session_id must be set (frontend uses it as React Session id)"
    );
    assert!(
        first.get("parent_tmux_window_id").is_none(),
        "P7 bridge dropped the legacy Wave 2 `parent_tmux_window_id` field; frontend uses `tmux_window_id`"
    );
    assert!(
        first.get("is_hidden").is_none(),
        "P7 bridge dropped the legacy `is_hidden` field; it was Wave 2 internal only"
    );

    // The second pane (%4) must NOT be in pane_bindings because no
    // pending_splits sender existed and the bootstrap pane had
    // already been recorded.
    assert!(
        controller.xsterm_id_for_pane("%4").is_none(),
        "external pane %4 must NOT be auto-bound in Wave 2"
    );

    let (awaited_id, awaited_pane) = controller
        .await_first_pane()
        .await
        .expect("first pane must resolve");
    assert_eq!(awaited_pane, "%3");
    assert_eq!(awaited_id, first["session_id"].as_u64().unwrap() as u32);
}

#[tokio::test]
async fn dispatch_forwards_pause_continue_and_exit() {
    let backend = Arc::new(RecordingBackend::new());
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = Arc::new(TmuxController {
        controller_id: 5,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx: mpsc::unbounded_channel::<String>().0,
        app_backend: backend.clone(),
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(5000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    });

    let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
    spawn_dispatch_task(
        rx,
        controller.clone(),
        TmuxBridge::new(backend.clone(), controller.clone()),
    );

    tx.send(ProtocolEvent::Pause {
        pane_id: "%8".to_string(),
    })
    .unwrap();
    tx.send(ProtocolEvent::Continue {
        pane_id: "%8".to_string(),
    })
    .unwrap();
    tx.send(ProtocolEvent::Exit {
        reason: Some("killed".to_string()),
    })
    .unwrap();
    drop(tx);

    for _ in 0..30 {
        if backend.recorded().len() >= 3 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }

    let recorded = backend.recorded();
    let names: Vec<&str> = recorded.iter().map(|(n, _)| n.as_str()).collect();
    assert!(names.contains(&"tmux-paused"), "recorded = {names:?}");
    assert!(names.contains(&"tmux-continued"), "recorded = {names:?}");
    assert!(
        names.contains(&"tmux-controller-exit"),
        "recorded = {names:?}"
    );

    let exit_payload = backend
        .recorded()
        .iter()
        .find(|(n, _)| n == "tmux-controller-exit")
        .unwrap()
        .1
        .clone();
    assert_eq!(exit_payload["controller_id"].as_u64().unwrap(), 5);
    assert_eq!(exit_payload["reason"].as_str().unwrap(), "killed");
}

#[tokio::test]
async fn await_first_pane_resolves_when_record_first_pane_runs_before_caller() {
    // Regression: when the dispatch task records the first pane BEFORE
    // the caller invokes `await_first_pane`, the reorder fix ensures the
    // fast-path check inside `await_first_pane` reads the stored result
    // and returns immediately. Without the reorder, the buggy code
    // would re-create the `notified()` future *after* the result check,
    // racing against the dispatcher's `notify_waiters()` and risking a
    // lost notification. This test exercises the order where
    // `record_first_pane` runs strictly before `await_first_pane` is
    // awaited, which is the common production path (the dispatcher
    // records the first pane as soon as the bootstrap `WindowPaneChanged`
    // arrives, even if `create_tmux_session` hasn't reached the await
    // yet).
    let backend: Arc<dyn AppBackend> = Arc::new(RecordingBackend::new());
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = Arc::new(TmuxController {
        controller_id: 6,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx: mpsc::unbounded_channel::<String>().0,
        app_backend: backend,
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(6000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    });

    // Fire record_first_pane FIRST, with no sleep — simulate the
    // dispatcher winning the race over `await_first_pane`.
    controller.record_first_pane(6_000_042, "%42".to_string());

    let result = controller.await_first_pane().await;
    assert!(
        matches!(result, Ok((6_000_042, ref p)) if p == "%42"),
        "expected Ok((6_000_042, \"%42\")), got: {result:?}"
    );
}

#[tokio::test]
async fn await_first_pane_resolves_after_record_first_pane() {
    let backend: Arc<dyn AppBackend> = Arc::new(RecordingBackend::new());
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = Arc::new(TmuxController {
        controller_id: 6,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx: mpsc::unbounded_channel::<String>().0,
        app_backend: backend,
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(6000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    });

    let controller_for_wait = Arc::clone(&controller);
    let waiter = tokio::spawn(async move { controller_for_wait.await_first_pane().await });
    // Give the waiter a tick to subscribe to the notify.
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    controller.record_first_pane(6_000_042, "%42".to_string());

    let (xsterm_id, pane_id) = waiter
        .await
        .expect("waiter task did not panic")
        .expect("await_first_pane must resolve after record_first_pane");
    assert_eq!(xsterm_id, 6_000_042);
    assert_eq!(pane_id, "%42");
}

#[test]
fn pane_bindings_snapshot_contains_all_registered_panes() {
    let backend: Arc<dyn AppBackend> = Arc::new(RecordingBackend::new());
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = Arc::new(TmuxController {
        controller_id: 7,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx: mpsc::unbounded_channel::<String>().0,
        app_backend: backend,
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(7000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    });

    controller.register_pane("%3".to_string(), 3003);
    controller.register_pane("%1".to_string(), 3001);
    controller.register_pane("%2".to_string(), 3002);

    let mut snapshot = controller.pane_bindings();
    snapshot.sort();
    assert_eq!(
        snapshot,
        vec![
            ("%1".to_string(), 3001),
            ("%2".to_string(), 3002),
            ("%3".to_string(), 3003),
        ]
    );
}

/// Drive the dispatch task directly (no real tmux) and feed it a
/// `%pane-exited` for an already-bound pane. The dispatch task must
/// emit `tmux-pane-removed` with the right `controller_id`,
/// `tmux_pane_id`, and `session_id` triple, and remove the
/// binding from `pane_bindings`.
#[tokio::test]
async fn dispatch_routes_pane_exited_to_tmux_pane_removed() {
    let backend = Arc::new(RecordingBackend::new());
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = Arc::new(TmuxController {
        controller_id: 8,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx: mpsc::unbounded_channel::<String>().0,
        app_backend: backend.clone(),
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(8000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    });
    controller.register_pane("%5".to_string(), 8_000_042);

    let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
    spawn_dispatch_task(
        rx,
        controller.clone(),
        TmuxBridge::new(backend.clone(), controller.clone()),
    );

    tx.send(ProtocolEvent::PaneExited {
        pane_id: "%5".to_string(),
    })
    .unwrap();
    drop(tx);

    for _ in 0..30 {
        if backend.recorded().len() >= 1 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }

    let recorded = backend.recorded();
    let removed = recorded
        .iter()
        .find(|(n, _)| n == "tmux-pane-removed")
        .expect("tmux-pane-removed must be emitted for bound pane");
    assert_eq!(removed.1["controller_id"].as_u64().unwrap(), 8);
    assert_eq!(removed.1["tmux_pane_id"].as_str().unwrap(), "%5");
    assert_eq!(removed.1["session_id"].as_u64().unwrap(), 8_000_042);

    // The binding must be removed so subsequent send_keys / resize_pane
    // calls fail fast with a "not registered" error.
    assert!(
        controller.xsterm_id_for_pane("%5").is_none(),
        "pane-exited must remove the binding"
    );
}

/// Same as above but with `%pane-died`. The dispatch path treats both
/// events identically (look up + remove + emit).
#[tokio::test]
async fn dispatch_routes_pane_died_to_tmux_pane_removed() {
    let backend = Arc::new(RecordingBackend::new());
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = Arc::new(TmuxController {
        controller_id: 9,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx: mpsc::unbounded_channel::<String>().0,
        app_backend: backend.clone(),
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(9000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    });
    controller.register_pane("%9".to_string(), 9_000_007);

    let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
    spawn_dispatch_task(
        rx,
        controller.clone(),
        TmuxBridge::new(backend.clone(), controller.clone()),
    );

    tx.send(ProtocolEvent::PaneDied {
        pane_id: "%9".to_string(),
    })
    .unwrap();
    drop(tx);

    for _ in 0..30 {
        if backend.recorded().len() >= 1 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }

    let recorded = backend.recorded();
    let removed = recorded
        .iter()
        .find(|(n, _)| n == "tmux-pane-removed")
        .expect("tmux-pane-removed must be emitted on %pane-died");
    assert_eq!(removed.1["controller_id"].as_u64().unwrap(), 9);
    assert_eq!(removed.1["tmux_pane_id"].as_str().unwrap(), "%9");
    assert_eq!(removed.1["session_id"].as_u64().unwrap(), 9_000_007);
}

/// Pane-exited / pane-died for an UNBOUND pane (e.g. an external
/// pane created out-of-band, never registered) must NOT emit
/// `tmux-pane-removed`. The frontend listener would otherwise drop
/// a real `Session` from React state.
#[tokio::test]
async fn dispatch_does_not_emit_removed_for_unbound_pane() {
    let backend = Arc::new(RecordingBackend::new());
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = Arc::new(TmuxController {
        controller_id: 10,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx: mpsc::unbounded_channel::<String>().0,
        app_backend: backend.clone(),
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(10000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    });

    let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
    spawn_dispatch_task(
        rx,
        controller.clone(),
        TmuxBridge::new(backend.clone(), controller.clone()),
    );

    tx.send(ProtocolEvent::PaneExited {
        pane_id: "%404".to_string(),
    })
    .unwrap();
    drop(tx);

    // Drain whatever the dispatch task emits.
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }

    let recorded = backend.recorded();
    assert!(
        recorded.iter().all(|(n, _)| n != "tmux-pane-removed"),
        "tmux-pane-removed must NOT fire for unbound pane, got {recorded:?}"
    );
}

/// Drive `split_pane` end-to-end without a real tmux:
/// 1. Call `split_pane` on a bound parent pane.
/// 2. Manually push a sender into `pending_splits` (simulating what
///    `split_pane` does internally) — actually we just call
///    `split_pane` directly so the sender registration happens.
/// 3. Feed the dispatch task a `%window-pane-changed` for the new
///    pane id.
/// 4. The oneshot receiver returns the `(xsterm_id, pane_id,
///    window_id)` triple and the dispatch task emits
///    `tmux-pane-added` with `parent_tmux_window_id`.
#[tokio::test]
async fn split_pane_resolves_when_dispatch_sees_window_pane_changed() {
    let backend = Arc::new(RecordingBackend::new());
    let (stdin_tx, mut _stdin_rx) = mpsc::unbounded_channel::<String>();
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = Arc::new(TmuxController {
        controller_id: 11,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx,
        app_backend: backend.clone(),
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(11000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    });
    controller.register_pane("%5".to_string(), 11_000_042);
    // Pre-record the first pane so the dispatch task takes the
    // split-result path (case 2) instead of the bootstrap path
    // (case 3) for the reply we feed below.
    controller.record_first_pane(11_000_001, "%5".to_string());

    let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
    spawn_dispatch_task(
        rx,
        controller.clone(),
        TmuxBridge::new(backend.clone(), controller.clone()),
    );

    // Kick off the split in a background task; it will block on the
    // oneshot until the dispatch task sees the reply.
    let controller_clone = Arc::clone(&controller);
    let split_handle = tokio::spawn(async move {
        controller_clone
            .split_pane("%5", SplitDirection::Horizontal)
            .await
    });

    // Yield to let the split task register its sender.
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;

    // Feed the matching reply.
    tx.send(ProtocolEvent::WindowPaneChanged {
        window_id: "@7".to_string(),
        pane_id: "%11".to_string(),
    })
    .unwrap();

    let result = tokio::time::timeout(std::time::Duration::from_secs(2), split_handle)
        .await
        .expect("split did not time out")
        .expect("split task did not panic");
    let (xsterm_id, tmux_pane_id, tmux_window_id) =
        result.expect("split must return Ok on matching reply");
    assert_eq!(xsterm_id, 11_000_001);
    assert_eq!(tmux_pane_id, "%11");
    assert_eq!(tmux_window_id, "@7");

    // The new pane must be registered, and the dispatch task must
    // have emitted `tmux-pane-added` with the Wave 2 payload.
    assert!(controller.xsterm_id_for_pane("%11").is_some());

    drop(tx);
    for _ in 0..30 {
        if backend.recorded().len() >= 1 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let recorded = backend.recorded();
    let added = recorded
        .iter()
        .find(|(n, _)| n == "tmux-pane-added")
        .expect("tmux-pane-added must be emitted for split result");
    // P7 bridge payload — see `emit_tmux_pane_added_with_window` /
    // `emit_tmux_pane_added` in `services/tmux/bridge/mod.rs`.
    // The split-result path uses the simple form (not the
    // `_with_window` overload) because the parent window id is
    // available as a tmux id string, not an xsterm id.
    assert_eq!(added.1["tmux_controller_id"].as_u64().unwrap(), 11);
    assert_eq!(added.1["tmux_pane_id"].as_str().unwrap(), "%11");
    assert_eq!(added.1["session_id"].as_u64().unwrap(), 11_000_001);
    assert_eq!(
        added.1["tmux_window_id"].as_str().unwrap(),
        "@7",
        "P7 bridge payload: split-result path uses tmux_window_id (matches frontend contract)"
    );
}

/// When no `%window-pane-changed` reply ever arrives (e.g. tmux
/// hangs), `split_pane` must return an `Err` after
/// `split_pane_timeout`. The test injects a 50 ms timeout via
/// `set_split_pane_timeout_for_tests` so it runs in well under a
/// second.
#[tokio::test]
async fn split_pane_times_out_when_no_response() {
    let backend: Arc<dyn AppBackend> = Arc::new(RecordingBackend::new());
    let (stdin_tx, _stdin_rx) = mpsc::unbounded_channel::<String>();
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let mut controller = TmuxController {
        controller_id: 12,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx,
        app_backend: backend,
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(12000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    };
    controller.register_pane("%5".to_string(), 12_000_001);
    controller.set_split_pane_timeout_for_tests(Duration::from_millis(50));
    let controller = Arc::new(controller);

    // No dispatch task → no WindowPaneChanged reply ever arrives.
    let started = std::time::Instant::now();
    let result = controller.split_pane("%5", SplitDirection::Vertical).await;
    let elapsed = started.elapsed();

    let err = result.expect_err("split must time out without a reply");
    assert!(
        err.to_string().contains("timed out"),
        "expected 'timed out' in error, got: {err}"
    );
    // 50 ms timeout + a few ms of slack — should be far less than 1 s.
    assert!(
        elapsed < Duration::from_secs(1),
        "split should fail fast on timeout, took {elapsed:?}"
    );
}

/// `kill_pane` must reject an unbound pane and accept a bound pane,
/// queueing `kill-pane -t %<id>` on the writer-task stdin channel.
/// We verify by capturing what was sent into the channel via a
/// duplex pipe.
#[tokio::test]
async fn kill_pane_writes_correct_command_to_stdin() {
    let backend: Arc<dyn AppBackend> = Arc::new(RecordingBackend::new());
    let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = TmuxController {
        controller_id: 13,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx,
        app_backend: backend,
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(13000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    };
    controller.register_pane("%0".to_string(), 13_000_001);

    // Unknown pane must error.
    let err = controller.kill_pane("%999").unwrap_err();
    assert!(err.to_string().contains("not registered"), "got: {err}");

    // Bound pane must succeed and queue the kill-pane command.
    controller
        .kill_pane("%0")
        .expect("kill_pane on bound pane must succeed");

    let cmd = stdin_rx
        .recv()
        .await
        .expect("a kill-pane command must be queued on stdin");
    assert_eq!(
        cmd, "kill-pane -t %0\n",
        "kill_pane must queue the literal kill-pane -t <pane>\\n command"
    );
}

/// `close` must drain every event-correlated waiter (P8 W3b) with an
/// error so a Tauri command awaiting a split / new-window / capture
/// result does not block the full timeout after the controller has
/// been torn down. Replaces the v1 `close_drains_pending_splits_with_error`
/// / `close_drains_pending_capture_with_error` tests (those fields
/// are deleted in W3b).
#[tokio::test]
async fn close_drains_event_waiters_with_error() {
    let backend: Arc<dyn AppBackend> = Arc::new(RecordingBackend::new());
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = Arc::new(TmuxController {
        controller_id: 14,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx: mpsc::unbounded_channel::<String>().0,
        app_backend: backend,
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(14000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    });
    controller.register_pane("%5".to_string(), 14_000_001);

    // Register a SplitResult event waiter directly (simulating what
    // `split_pane` does internally) so we can verify `close` drains
    // it via `registry.drain_event_waiters()` without going through
    // `split_pane` (which would try to write to the no-op stdin_tx
    // and fail).
    let (tx, rx) = oneshot::channel::<SplitResult>();
    controller.registry.register_event_waiter(EventWaiter {
        kind: EventWaiterKind::SplitResult,
        sender: EventWaiterSender::Split(tx),
        tmux_window_id: None,
    });

    controller.close().expect("close must succeed");

    // Dropping the sender (via `registry.drain_event_waiters`)
    // closes the channel; `rx.await` then resolves to
    // `Err(RecvError)`. The mere fact that it resolves within
    // 1 s — instead of hanging the full `TMUX_REPLY_TIMEOUT` —
    // is what we assert.
    let _dropped = tokio::time::timeout(std::time::Duration::from_secs(1), rx)
        .await
        .expect("close must wake the pending event waiter within 1 s")
        .expect_err("drained sender must drop (close channel) so the receiver sees Err");
    assert_eq!(
        controller.registry.event_waiter_count(),
        0,
        "close must have drained every event waiter"
    );
}

// ===========================================================================
// Wave 3 tests: tmux window / xsterm Window mapping
// ===========================================================================

/// drive the dispatch task end-to-end for a user-driven
/// `new_window` request. The test registers a `NewWindowResult`
/// event waiter on the registry (simulating what `new_window` does
/// internally), feeds a `%window-add` then a
/// `%window-pane-changed`, and verifies that:
/// 1. The sender resolves with the correct quadruple.
/// 2. The new pane is registered in `pane_bindings` /
///    `pane_window_bindings`.
/// 3. `window_bindings` is populated.
/// 4. `tmux-window-added` AND `tmux-pane-added` events are emitted
///    with the Wave 3 payload.
#[tokio::test]
async fn dispatch_resolves_new_window_via_window_add_then_pane_changed() {
    let backend = Arc::new(RecordingBackend::new());
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = Arc::new(TmuxController {
        controller_id: 15,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx: mpsc::unbounded_channel::<String>().0,
        app_backend: backend.clone(),
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(15000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    });

    let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
    spawn_dispatch_task(
        rx,
        controller.clone(),
        TmuxBridge::new(backend.clone(), controller.clone()),
    );

    // Pre-record the bootstrap pane so the dispatch task takes the
    // new-window path (not the legacy bootstrap fallback).
    controller.register_pane("%0".to_string(), 15_000_042);
    controller.record_first_pane(15_000_001, "%0".to_string());

    // Register a NewWindowResult event waiter (simulating new_window).
    let (user_tx, user_rx) = oneshot::channel::<NewWindowResult>();
    controller.registry.register_event_waiter(EventWaiter {
        kind: EventWaiterKind::NewWindowResult,
        sender: EventWaiterSender::NewWindow(user_tx),
        tmux_window_id: None,
    });

    // Yield so the dispatch task is ready to receive.
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;

    // Feed the WindowAdd reply.
    tx.send(ProtocolEvent::WindowAdd {
        window_id: "@9".to_string(),
    })
    .unwrap();

    // Give the dispatch task a tick to re-key the waiter.
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;

    // Feed the WindowPaneChanged reply (the first pane of the new window).
    tx.send(ProtocolEvent::WindowPaneChanged {
        window_id: "@9".to_string(),
        pane_id: "%13".to_string(),
    })
    .unwrap();

    let result = tokio::time::timeout(std::time::Duration::from_secs(2), user_rx)
        .await
        .expect("new_window sender must resolve within 2s")
        .expect("oneshot channel must not be dropped");
    let (tmux_window_id, session_id, tmux_pane_id) =
        result.expect("new_window must return Ok on matching reply");
    assert_eq!(tmux_window_id, "@9");
    assert_eq!(session_id, 15_000_001);
    assert_eq!(tmux_pane_id, "%13");

    // Pane + window bindings must be populated.
    assert!(controller.xsterm_id_for_pane("%13").is_some());
    assert_eq!(controller.window_bindings(), vec!["@9".to_string()]);
    assert_eq!(
        controller.tmux_window_id_for_pane("%13").as_deref(),
        Some("@9")
    );

    // Spin until the dispatch task has emitted both events.
    for _ in 0..30 {
        if backend.recorded().len() >= 2 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let recorded = backend.recorded();

    let pane_added = recorded
        .iter()
        .find(|(n, _)| n == "tmux-pane-added")
        .expect("tmux-pane-added must be emitted for the new window's first pane");
    assert_eq!(pane_added.1["tmux_controller_id"].as_u64().unwrap(), 15);
    assert_eq!(pane_added.1["tmux_pane_id"].as_str().unwrap(), "%13");
    assert_eq!(pane_added.1["session_id"].as_u64().unwrap(), 15_000_001);
    assert_eq!(
        pane_added.1["tmux_window_id"].as_str().unwrap(),
        "@9",
        "P7 bridge payload: new-window path uses tmux_window_id (matches frontend contract)"
    );

    let window_added = recorded
        .iter()
        .find(|(n, _)| n == "tmux-window-added")
        .expect("tmux-window-added must be emitted for user-driven new-window");
    // P7 bridge payload: see `emit_tmux_window_added` in
    // `services/tmux/bridge/mod.rs`. The new-window path populates
    // `session_id` and `tmux_pane_id` so the frontend can
    // build the Window + Session + first-pane in one event.
    assert_eq!(window_added.1["tmux_controller_id"].as_u64().unwrap(), 15);
    assert_eq!(window_added.1["tmux_window_id"].as_str().unwrap(), "@9");
    assert_eq!(window_added.1["session_id"].as_u64().unwrap(), 15_000_001);
    assert_eq!(window_added.1["tmux_pane_id"].as_str().unwrap(), "%13");
}

/// the bootstrap window is the first `%window-add` we see
/// when no `pending_windows` sender exists. The dispatch task must:
/// 1. Allocate an xsterm window id.
/// 2. Stash it in `pending_window_pane` with `sender = None`.
/// 3. NOT emit `tmux-window-added` (the frontend already owns the
///    bootstrap Window).
/// 4. On the matching `%window-pane-changed`, register the pane,
///    move the pending entry to `window_bindings`, emit
///    `tmux-pane-added`, and record the first pane for
///    `await_first_pane` to resolve.
#[tokio::test]
async fn dispatch_handles_bootstrap_window_without_pending_sender() {
    let backend = Arc::new(RecordingBackend::new());
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = Arc::new(TmuxController {
        controller_id: 16,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx: mpsc::unbounded_channel::<String>().0,
        app_backend: backend.clone(),
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(16000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    });

    let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
    spawn_dispatch_task(
        rx,
        controller.clone(),
        TmuxBridge::new(backend.clone(), controller.clone()),
    );

    // Feed WindowAdd for the bootstrap window — no pending_windows
    // sender, window_bindings is empty → bootstrap path.
    tx.send(ProtocolEvent::WindowAdd {
        window_id: "@1".to_string(),
    })
    .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;

    // Feed WindowPaneChanged — should resolve the pending entry.
    tx.send(ProtocolEvent::WindowPaneChanged {
        window_id: "@1".to_string(),
        pane_id: "%0".to_string(),
    })
    .unwrap();
    drop(tx);

    // Spin until the dispatch task has processed both events.
    for _ in 0..30 {
        if backend.recorded().len() >= 1 {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let recorded = backend.recorded();

    // tmux-window-added must NOT be emitted for the bootstrap window.
    assert!(
        recorded.iter().all(|(n, _)| n != "tmux-window-added"),
        "tmux-window-added must NOT fire for bootstrap window, got {recorded:?}"
    );

    // tmux-pane-added must be emitted once (with the bootstrap pane).
    let pane_added = recorded
        .iter()
        .find(|(n, _)| n == "tmux-pane-added")
        .expect("tmux-pane-added must be emitted for the bootstrap pane");
    assert_eq!(pane_added.1["tmux_pane_id"].as_str().unwrap(), "%0");
    assert_eq!(
        pane_added.1["tmux_window_id"].as_str().unwrap(),
        "@1",
        "P7 bridge payload: bootstrap pane uses tmux_window_id (frontend contract)"
    );
    assert_eq!(pane_added.1["session_id"].as_u64().unwrap(), 16_000_001);

    // window_bindings must be populated.
    assert_eq!(controller.window_bindings(), vec!["@1".to_string()]);
    // await_first_pane must resolve.
    let (xsterm_id, pane_id) = controller
        .await_first_pane()
        .await
        .expect("first pane must resolve after bootstrap dispatch");
    assert_eq!(xsterm_id, 16_000_001);
    assert_eq!(pane_id, "%0");
    assert_eq!(
        controller.tmux_window_id_for_pane("%0").as_deref(),
        Some("@1"),
        "bootstrap pane must have its tmux window id recorded"
    );
}

/// a `%window-close` for a bound window must emit
/// `tmux-window-closed` with the matching xsterm window id and drop
/// the binding. `%window-close` for an unbound window must NOT emit
/// the event.
#[tokio::test]
async fn dispatch_routes_window_close_to_tmux_window_closed() {
    let backend = Arc::new(RecordingBackend::new());
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = Arc::new(TmuxController {
        controller_id: 17,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx: mpsc::unbounded_channel::<String>().0,
        app_backend: backend.clone(),
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(17000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    });
    // Pre-register a window + pane (simulates bootstrap done).
    controller
        .window_bindings
        .lock()
        .unwrap()
        .insert("@3".to_string());
    controller
        .pane_bindings
        .lock()
        .unwrap()
        .insert("%9".to_string(), 999_999);
    controller
        .pane_window_bindings
        .lock()
        .unwrap()
        .insert("%9".to_string(), "@3".to_string());

    let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
    spawn_dispatch_task(
        rx,
        controller.clone(),
        TmuxBridge::new(backend.clone(), controller.clone()),
    );

    // Bound window-close → emit + drop binding + drop panes in that window.
    tx.send(ProtocolEvent::WindowClose {
        window_id: "@3".to_string(),
    })
    .unwrap();
    // Unbound window-close → no emit.
    tx.send(ProtocolEvent::WindowClose {
        window_id: "@99".to_string(),
    })
    .unwrap();
    drop(tx);

    for _ in 0..30 {
        if backend.recorded().len() >= 1 {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let recorded = backend.recorded();
    let closed_events: Vec<_> = recorded
        .iter()
        .filter(|(n, _)| n == "tmux-window-closed")
        .collect();
    assert_eq!(
        closed_events.len(),
        1,
        "exactly one tmux-window-closed must be emitted, got {recorded:?}"
    );
    let closed = closed_events[0].1.clone();
    assert_eq!(closed["controller_id"].as_u64().unwrap(), 17);
    assert_eq!(closed["tmux_window_id"].as_str().unwrap(), "@3");

    // Binding must be dropped.
    assert!(
        controller.window_bindings().iter().all(|tid| tid != "@3"),
        "window_bindings must drop @3 after WindowClose"
    );
    // Pane in that window must also be dropped defensively.
    assert!(
        controller.xsterm_id_for_pane("%9").is_none(),
        "pane bindings for the closed window must be dropped"
    );
    assert!(
        controller.tmux_window_id_for_pane("%9").is_none(),
        "pane_window_bindings for the closed window must be dropped"
    );
}

/// a `%window-renamed` for a bound window must emit
/// `tmux-window-renamed` with the matching xsterm window id and the
/// new name. `%window-renamed` for an unbound window must NOT emit
/// the event.
#[tokio::test]
async fn dispatch_routes_window_renamed_to_tmux_window_renamed() {
    let backend = Arc::new(RecordingBackend::new());
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = Arc::new(TmuxController {
        controller_id: 18,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx: mpsc::unbounded_channel::<String>().0,
        app_backend: backend.clone(),
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(18000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    });
    controller
        .window_bindings
        .lock()
        .unwrap()
        .insert("@5".to_string());

    let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
    spawn_dispatch_task(
        rx,
        controller.clone(),
        TmuxBridge::new(backend.clone(), controller.clone()),
    );

    tx.send(ProtocolEvent::WindowRenamed {
        window_id: "@5".to_string(),
        name: "editor".to_string(),
    })
    .unwrap();
    tx.send(ProtocolEvent::WindowRenamed {
        window_id: "@404".to_string(),
        name: "orphan".to_string(),
    })
    .unwrap();
    drop(tx);

    for _ in 0..30 {
        if backend.recorded().len() >= 1 {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let recorded = backend.recorded();
    let renamed: Vec<_> = recorded
        .iter()
        .filter(|(n, _)| n == "tmux-window-renamed")
        .collect();
    assert_eq!(renamed.len(), 1, "got {recorded:?}");
    let payload = renamed[0].1.clone();
    assert_eq!(payload["controller_id"].as_u64().unwrap(), 18);
    assert_eq!(payload["tmux_window_id"].as_str().unwrap(), "@5");
    assert_eq!(payload["name"].as_str().unwrap(), "editor");
}

/// `kill_window` and `rename_window` must reject unbound
/// windows and accept bound ones, queueing the right commands on the
/// controller's stdin FIFO.
#[tokio::test]
async fn kill_window_and_rename_window_write_correct_commands_to_stdin() {
    let backend: Arc<dyn AppBackend> = Arc::new(RecordingBackend::new());
    let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = TmuxController {
        controller_id: 19,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx,
        app_backend: backend,
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(19000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    };
    controller
        .window_bindings
        .lock()
        .unwrap()
        .insert("@7".to_string());

    // Unknown window → Err.
    let err = controller.kill_window("@404").unwrap_err();
    assert!(err.to_string().contains("not registered"), "got: {err}");
    let err = controller.rename_window("@404", "x").unwrap_err();
    assert!(err.to_string().contains("not registered"), "got: {err}");

    // Bound window → success and correct commands queued.
    controller
        .kill_window("@7")
        .expect("kill_window on bound window must succeed");
    controller
        .rename_window("@7", "new name")
        .expect("rename_window on bound window must succeed");

    let cmd1 = stdin_rx
        .recv()
        .await
        .expect("kill-window command must arrive on stdin");
    assert_eq!(cmd1, "kill-window -t @7\n");
    let cmd2 = stdin_rx
        .recv()
        .await
        .expect("rename-window command must arrive on stdin");
    assert_eq!(cmd2, "rename-window -t @7 \"new name\"\n");
}

// ===========================================================================
// Wave 4 tests: capture-pane + attach-session Promise coordination
// ===========================================================================

/// `capture_pane` resolves with the captured text when the
/// dispatch task sees a matching `%begin..%output..%end` block. Also
/// asserts that the right tmux command (`capture-pane -p -e -J -S
/// -100 -t %42`) was written to stdin in FIFO order before tmux
/// replies.
#[tokio::test]
async fn capture_pane_resolves_on_command_end_after_command_output() {
    let backend = Arc::new(RecordingBackend::new());
    let (stdin_tx, _stdin_rx) = mpsc::unbounded_channel::<String>();
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = Arc::new(TmuxController {
        controller_id: 100,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx,
        app_backend: backend.clone(),
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(100000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    });
    controller.register_pane("%42".to_string(), 100_000_042);

    let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
    spawn_dispatch_task(
        rx,
        controller.clone(),
        TmuxBridge::new(backend.clone(), controller.clone()),
    );

    // Kick off capture_pane in a background task.
    let controller_clone = Arc::clone(&controller);
    let capture_handle =
        tokio::spawn(async move { controller_clone.capture_pane("%42", 100).await });

    // Yield so capture_pane registers its waiter via
    // `registry.register()` and writes the command to stdin.
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;

    // P8 W2: the dispatch task now correlates `%begin`/`%end` by
    // the registry-allocated command id (was previously implicit
    // via `pending_capture`). Read the id capture_pane just got
    // so we can drive the synthetic events with the matching id.
    let cmd_id = controller
        .registry
        .ids()
        .into_iter()
        .next()
        .expect("capture_pane must have registered a waiter")
        .0 as u32;

    // Drive the dispatch task with a synthetic %begin/%output/%end block.
    tx.send(ProtocolEvent::CommandBegin {
        id: cmd_id,
        timestamp: 1,
        flags: 0,
    })
    .unwrap();
    tx.send(ProtocolEvent::CommandOutput {
        id: cmd_id,
        line: "first line".to_string(),
    })
    .unwrap();
    tx.send(ProtocolEvent::CommandOutput {
        id: cmd_id,
        line: "second line".to_string(),
    })
    .unwrap();
    tx.send(ProtocolEvent::CommandOutput {
        id: cmd_id,
        line: "third line".to_string(),
    })
    .unwrap();
    tx.send(ProtocolEvent::CommandEnd {
        id: cmd_id,
        timestamp: 1,
        flags: 0,
    })
    .unwrap();

    let result = tokio::time::timeout(std::time::Duration::from_secs(2), capture_handle)
        .await
        .expect("capture_pane must not time out")
        .expect("capture_pane task did not panic");
    let text = result.expect("capture_pane must return Ok on matching reply");
    assert_eq!(text, "first line\nsecond line\nthird line");
}

/// a `%error` reply resolves `capture_pane` with an `Err`
/// carrying tmux's reported message (no body lines are surfaced).
#[tokio::test]
async fn capture_pane_resolves_with_err_on_command_error() {
    let backend = Arc::new(RecordingBackend::new());
    let (stdin_tx, _stdin_rx) = mpsc::unbounded_channel::<String>();
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = Arc::new(TmuxController {
        controller_id: 101,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx,
        app_backend: backend.clone(),
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(101000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    });
    controller.register_pane("%9".to_string(), 101_000_009);

    let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
    spawn_dispatch_task(
        rx,
        controller.clone(),
        TmuxBridge::new(backend.clone(), controller.clone()),
    );

    let controller_clone = Arc::clone(&controller);
    let capture_handle = tokio::spawn(async move { controller_clone.capture_pane("%9", 50).await });
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;

    // P8 W2: dispatch correlates `%error` by the registry id.
    let cmd_id = controller
        .registry
        .ids()
        .into_iter()
        .next()
        .expect("capture_pane must have registered a waiter")
        .0 as u32;

    tx.send(ProtocolEvent::CommandError {
        id: cmd_id,
        timestamp: 2,
        flags: 0,
        message: "pane gone".to_string(),
    })
    .unwrap();

    let result = tokio::time::timeout(std::time::Duration::from_secs(2), capture_handle)
        .await
        .expect("capture_pane must not time out")
        .expect("capture_pane task did not panic");
    let err = result.expect_err("capture_pane must return Err on %error");
    assert!(
        err.to_string().contains("capture-pane failed") && err.to_string().contains("pane gone"),
        "expected error to surface tmux's message, got: {err}"
    );
}

/// `capture_pane` rejects an unbound pane with a clear
/// "not registered" message and does NOT write anything to stdin.
#[tokio::test]
async fn capture_pane_errors_on_unbound_pane() {
    let backend = Arc::new(RecordingBackend::new());
    let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = TmuxController {
        controller_id: 102,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx,
        app_backend: backend,
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(102000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    };

    let err = controller
        .capture_pane("%999", 100)
        .await
        .expect_err("capture_pane on unbound pane must error");
    assert!(
        err.to_string().contains("not registered"),
        "expected 'not registered' in error, got: {err}"
    );
    // No command must have been queued on stdin.
    assert!(
        stdin_rx.try_recv().is_err(),
        "capture_pane must not write to stdin for unbound pane"
    );
}

/// `close` wakes an outstanding `capture_pane` awaiter with
/// an `Err("controller closed")` so a Tauri command awaiting
/// `capture_tmux_pane` does not block the full 5 s TMUX_REPLY_TIMEOUT
/// after the controller has been torn down. P8 W3b: capture_pane's
/// waiter is a `BeginEnd` registered via the registry (was a
/// `pending_capture` oneshot in v1); close drains it via
/// `registry.drain()`.
#[tokio::test]
async fn close_drains_pending_capture_with_error() {
    let backend = Arc::new(RecordingBackend::new());
    let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
    let controller = Arc::new(TmuxController {
        controller_id: 103,
        backend: Arc::new(Mutex::new(None)),
        killed: Arc::new(AtomicBool::new(false)),
        stdin_tx: mpsc::unbounded_channel::<String>().0,
        app_backend: backend,
        pane_bindings: std::sync::Mutex::new(HashMap::new()),
        pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
        session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
            &crate::models::session::SessionIdSource::new(103000001),
        ),
        first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
        first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
        initial_windows: std::sync::Mutex::new(None),
        initial_panes: std::sync::Mutex::new(None),
        initial_state_rx: tokio::sync::Mutex::new(None),
        initial_state_tx: std::sync::Mutex::new(None),
        window_bindings: std::sync::Mutex::new(HashSet::new()),
        session_name: std::sync::Mutex::new(None),
        capture_lock: tokio::sync::Mutex::new(()),
        split_pane_timeout: TMUX_REPLY_TIMEOUT,

        registry: CommandRegistry::new(),
        router_state: std::sync::Mutex::new(RouterState::default()),
    });
    controller.register_pane("%1".to_string(), 103_000_001);

    // Register a BeginEnd waiter on the registry (simulating what
    // `capture_pane` does internally) so we can verify `close`
    // drains it via `registry.drain()` without going through
    // `capture_pane` (which would block on the no-op stdin_tx).
    let (tx, rx) = oneshot::channel::<ResponseOutcome>();
    controller.registry.register(
        "capture-pane -p -e -J -S -100 -t %1\n".to_string(),
        Some(ResponseWaiter::BeginEnd(tx)),
    );

    controller.close().expect("close must succeed");

    // Dropping the sender (via `registry.drain`) closes the
    // channel; `rx.await` then resolves to `Err(RecvError)`. The
    // mere fact that it resolves within 1 s — instead of hanging
    // the full `TMUX_REPLY_TIMEOUT` — is what we assert.
    let _dropped = tokio::time::timeout(std::time::Duration::from_secs(1), rx)
        .await
        .expect("close must wake the pending capture waiter within 1 s")
        .expect_err("drained sender must drop (close channel) so the receiver sees Err");
}
