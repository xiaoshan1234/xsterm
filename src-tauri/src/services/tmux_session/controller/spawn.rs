//! `TmuxController` constructors + argv / shell / process helpers.
//!
//! Anything needed only to create a new controller lives here. The
//! `TmuxController` struct definition stays in `super`; this file
//! extends its `impl` block with the four constructors and the
//! helpers they share.

/// How this controller was created — drives the constructor's choice
/// of bootstrap path (an unconditional `new-window` vs the
/// `list-windows` / `list-panes` attach dance).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SpawnMode {
    /// `spawn_create` / `spawn_with_args`. We asked tmux to
    /// `new-session -A`; the server creates exactly one window for
    /// us. The bootstrap path relies on `record_pane_window`
    /// inserting `window_bindings` synchronously, so no extra
    /// `new-window` is enqueued.
    Create,
    /// `spawn_attach`. We asked tmux to `attach-session -t <name>`;
    /// the server has *N existing windows and panes*. The bootstrap
    /// path explicitly runs `list-windows` + per-window `list-panes`
    /// so xsterm mirrors the server's full state.
    Attach,
}

use super::super::bridge::TmuxBridge;
use super::super::dispatch::spawn_dispatch_task;
use super::super::errors::{spawn_err, TmuxError};
use super::super::protocol::events::ProtocolEvent;
use super::super::protocol::wire as tmux_cmd;
use super::id_map::CommandRegistry;
use super::io_tasks::{
    schedule_initial_state_sync, spawn_monitor_task, spawn_reader_task, spawn_stderr_drain_task,
    spawn_writer_task,
};
use super::subscriber::RouterState;
use super::{
    lock_or_warn, TmuxController, DEFAULT_INITIAL_COLS, DEFAULT_INITIAL_ROWS,
    DEFAULT_TMUX_SOCKET_NAME, TMUX_REPLY_TIMEOUT,
};
use std::collections::{HashMap, HashSet};
use std::process::Stdio;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot};

use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::ssh::SshBackend;
use crate::infrastructure::tmux::backend::{LocalTmuxBackend, SshTmuxBackend, TmuxBackend};
use crate::models::session::TmuxCcConfig;

impl TmuxController {
    /// Spawn a `tmux -CC` controller for a [`TmuxCcConfig`] and wire the
    /// internal dispatch task.
    ///
    /// routes through SSH when [`TmuxCcConfig::ssh`] is `Some(_)`
    /// (uses [`SshBackend::connect_exec`] to open a remote exec channel
    /// running `tmux -CC <args>`) and through a local `tokio::process::Command`
    /// child otherwise. Both paths feed into the same reader / writer /
    /// monitor task machinery via the [`TmuxBackend`] trait.
    ///
    /// `ssh_backend` is unused on the local path but the parameter exists
    /// so callers don't have to branch before calling.
    pub fn spawn_create(
        config: &TmuxCcConfig,
        app_backend: Arc<dyn AppBackend>,
        ssh_backend: &dyn SshBackend,
        controller_id: u32,
        session_id_allocator: Arc<dyn Fn() -> u32 + Send + Sync>,
    ) -> Result<Arc<Self>, TmuxError> {
        // Required: without a name tmux auto-generates a numeric id that
        // `list-windows -t <name>` cannot address.
        let session_name = config
            .tmux_session_name
            .as_deref()
            .ok_or_else(|| TmuxError::Ipc {
                context: "tmux -CC create requires `tmuxSessionName` in TmuxCcConfig",
                source: None,
            })?;

        if let Some(ssh_cfg) = config.ssh.as_ref() {
            // SSH path: build the remote `tmux -CC ...` argv, run
            // it through an SSH exec channel, and wrap the resulting
            // `SshConnectResult` in a `SshTmuxBackend`.
            //
            // `connect_exec` returns `Result<_, String>` (russh has
            // no `Error: Send + Sync + 'static` blanket, so the
            // SshBackend trait is stuck with `String` for now).
            // We map the error to `TmuxError::Ipc` so the caller
            // can still pattern-match on the variant.
            let argv_strings = build_tmux_argv(config)?;
            let command = format!(
                "tmux {}",
                argv_strings
                    .iter()
                    .map(|s| shell_quote(s))
                    .collect::<Vec<_>>()
                    .join(" ")
            );
            let result = ssh_backend
                .connect_exec(ssh_cfg, &command)
                .map_err(|msg| spawn_err("ssh_backend.connect_exec", msg))?;
            let backend: Box<dyn TmuxBackend> =
                Box::new(SshTmuxBackend::from_connect_result(result));
            Self::spawn_with_backend(
                backend,
                app_backend,
                controller_id,
                SpawnMode::Create,
                Arc::clone(&session_id_allocator),
                Some(session_name),
            )
        } else {
            let argv_strings = build_tmux_argv(config)?;
            let argv_refs: Vec<&str> = argv_strings.iter().map(String::as_str).collect();
            let backend: Box<dyn TmuxBackend> = Box::new(build_local_tmux_backend(&argv_refs)?);
            Self::spawn_with_backend(
                backend,
                app_backend,
                controller_id,
                SpawnMode::Create,
                Arc::clone(&session_id_allocator),
                Some(session_name),
            )
        }
    }

    /// Lower-level constructor — spawns tmux with `argv[1..]` already
    /// built. `argv[0]` is always `"tmux"` and is added internally.
    ///
    /// takes a `tokio::process::Child` instead of building one
    /// internally; the SSH path goes through [`spawn_create`] instead.
    /// Kept for backward compatibility with the existing test suite.
    #[allow(dead_code)] // exercised only by the unit-test fixture suite
    pub fn spawn_with_args(
        args: &[&str],
        app_backend: Arc<dyn AppBackend>,
        controller_id: u32,
        session_id_allocator: Arc<dyn Fn() -> u32 + Send + Sync>,
    ) -> Result<Arc<Self>, TmuxError> {
        let backend: Box<dyn TmuxBackend> = Box::new(build_local_tmux_backend(args)?);
        Self::spawn_with_backend(
            backend,
            app_backend,
            controller_id,
            SpawnMode::Create,
            Arc::clone(&session_id_allocator),
            None,
        )
    }

    /// build a [`TmuxController`] around an already-constructed
    /// [`TmuxBackend`]. Used by both the local and SSH spawn paths.
    ///
    /// The backend is wrapped in an `Arc<Mutex<Option<_>>>` so
    /// [`TmuxController::close`] (via `try_lock`) and the monitor task
    /// (via `lock().await`) race for ownership exactly the same way the
    /// Wave 1 `Arc<Mutex<Option<Child>>>` design did. Whoever wins runs
    /// with the backend; the loser sees `None` and exits silently.
    pub(super) fn spawn_with_backend(
        mut backend: Box<dyn TmuxBackend>,
        app_backend: Arc<dyn AppBackend>,
        controller_id: u32,
        mode: SpawnMode,
        session_id_allocator: Arc<dyn Fn() -> u32 + Send + Sync>,
        session_name: Option<&str>,
    ) -> Result<Arc<Self>, TmuxError> {
        let stdout = backend
            .take_stdout()
            .map_err(|e| format!("tmux backend has no stdout: {e}"))?;
        let stdin = backend
            .take_stdin()
            .map_err(|e| format!("tmux backend has no stdin: {e}"))?;
        let stderr = backend
            .take_stderr()
            .map_err(|e| format!("tmux backend has no stderr: {e}"))?;

        let (stdin_tx, stdin_rx) = mpsc::unbounded_channel::<String>();
        let (dispatch_tx, dispatch_rx) = mpsc::unbounded_channel::<ProtocolEvent>();
        let (pane_tx_init, pane_rx_init) = oneshot::channel::<(u32, String)>();
        let (initial_state_tx_init, initial_state_rx_init) = oneshot::channel::<()>();

        let is_killed = Arc::new(AtomicBool::new(false));
        let backend_slot: Arc<tokio::sync::Mutex<Option<Box<dyn TmuxBackend>>>> =
            Arc::new(tokio::sync::Mutex::new(Some(backend)));

        spawn_reader_task(stdout, dispatch_tx.clone());
        spawn_writer_task(stdin, stdin_rx);
        spawn_stderr_drain_task(stderr);
        spawn_monitor_task(Arc::clone(&backend_slot), is_killed.clone(), dispatch_tx);

        let controller = Arc::new(Self {
            controller_id,
            backend: backend_slot,
            is_killed,
            stdin_tx,
            app_backend,
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_id_allocator,
            first_pane_tx: std::sync::Mutex::new(Some(pane_tx_init)),
            first_pane_rx: tokio::sync::Mutex::new(Some(pane_rx_init)),
            initial_windows: std::sync::Mutex::new(None),
            initial_panes: std::sync::Mutex::new(None),
            initial_state_rx: tokio::sync::Mutex::new(Some(initial_state_rx_init)),
            initial_state_tx: std::sync::Mutex::new(Some(initial_state_tx_init)),
            window_bindings: std::sync::Mutex::new(HashSet::new()),
            session_name: std::sync::Mutex::new(None),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: TMUX_REPLY_TIMEOUT,
            registry: CommandRegistry::new(),
            router_state: std::sync::Mutex::new(RouterState::default()),
        });

        spawn_dispatch_task(
            dispatch_rx,
            controller.clone(),
            TmuxBridge::new(Arc::clone(&controller.app_backend), controller.clone()),
        );

        if mode == SpawnMode::Create {
            tracing::info!(
                "tmux controller {}: Create mode — relying on Bug 0009 fix \
                 (record_pane_window inserts window_bindings synchronously) \
                 and NOT enqueuing a stray new-window",
                controller_id
            );
        } else {
            tracing::info!(
                "tmux controller {}: attach mode — skipping new-window (server already has panes)",
                controller_id
            );
        }

        if mode == SpawnMode::Create {
            schedule_initial_state_sync(controller.clone(), controller.stdin_tx.clone());
        } else {
            // Both required: list-windows installs bootstrap Windows, list-panes
            // installs bootstrap pane bindings. Detached thread avoids
            // blocking the spawn path on a sync stdin send.
            let stdin_tx = controller.stdin_tx.clone();
            let controller_for_attach = controller.clone();
            std::thread::spawn(move || {
                let session_name = controller_for_attach.session_name().unwrap_or_default();
                let cmds = [
                    tmux_cmd::list_windows(&session_name),
                    tmux_cmd::list_panes_with_format("", tmux_cmd::DEFAULT_PANE_LIST_FORMAT),
                ];
                for cmd in cmds {
                    if stdin_tx.send(cmd).is_err() {
                        tracing::debug!(
                            "tmux controller attach: controller already closed stdin_tx; skipping"
                        );
                        break;
                    }
                }
            });
        }
        tracing::info!(
            "tmux controller {}: spawn complete (mode={:?}); reader/writer/dispatch/monitor tasks running",
            controller_id, mode
        );

        if let Some(name) = session_name {
            if let Some(mut slot) =
                lock_or_warn(&controller.session_name, "session_name", controller_id)
            {
                *slot = Some(name.to_string());
            }
        }

        Ok(controller)
    }

    /// spawn a `tmux -CC attach-session` child process and wire the
    /// internal dispatch task.
    ///
    /// Currently has zero callers — kept around in case the SSH attach
    /// path is reactivated. Wire up from
    /// `SessionManager::attach_tmux` when the time comes.
    #[allow(dead_code)]
    pub fn spawn_attach(
        config: &TmuxCcConfig,
        app_backend: Arc<dyn AppBackend>,
        ssh_backend: &dyn SshBackend,
        controller_id: u32,
        session_id_allocator: Arc<dyn Fn() -> u32 + Send + Sync>,
    ) -> Result<Arc<Self>, TmuxError> {
        let session_name = config.tmux_session_name.as_deref().ok_or_else(|| {
            "tmux -CC attach requires `tmuxSessionName` in TmuxCcConfig".to_string()
        })?;

        let backend: Box<dyn TmuxBackend> = if let Some(ssh_cfg) = config.ssh.as_ref() {
            let socket = tmux_socket_name(config);
            let command = format!(
                "tmux -CC -L {} attach-session -t {}",
                shell_quote(socket),
                shell_quote(session_name)
            );
            let result = ssh_backend.connect_exec(ssh_cfg, &command)?;
            Box::new(SshTmuxBackend::from_connect_result(result))
        } else {
            let socket = tmux_socket_name(config);
            let argv: Vec<String> = vec![
                "-CC".to_string(),
                "-L".to_string(),
                socket.to_string(),
                "attach-session".to_string(),
                "-t".to_string(),
                session_name.to_string(),
            ];
            let argv_refs: Vec<&str> = argv.iter().map(String::as_str).collect();
            Box::new(build_local_tmux_backend(&argv_refs)?)
        };

        Self::spawn_with_backend(
            backend,
            app_backend,
            controller_id,
            SpawnMode::Attach,
            Arc::clone(&session_id_allocator),
            Some(session_name),
        )
    }
}

/// Resolve the tmux socket name, falling back to
/// [`DEFAULT_TMUX_SOCKET_NAME`] when the config leaves it `None`.
fn tmux_socket_name(config: &TmuxCcConfig) -> &str {
    config
        .socket_name
        .as_deref()
        .unwrap_or(DEFAULT_TMUX_SOCKET_NAME)
}

/// Build the `argv` slice for `tmux -CC …` from a [`TmuxCcConfig`].
///
/// Returns owned args so we can hand `&[&str]` to [`Command::args`] without
/// lifetime gymnastics. The layout is:
///
/// ```text
/// tmux -CC [-L <socket>] new-session -d -s <name> -x <cols> -y <rows>
/// ```
///
/// `-d` starts the session detached so the bootstrap pane does not grab
/// the terminal; `-x` / `-y` fix the initial geometry.
pub(crate) fn build_tmux_argv(config: &TmuxCcConfig) -> Result<Vec<String>, TmuxError> {
    let mut argv: Vec<String> = Vec::with_capacity(10);
    argv.push("-CC".to_string());

    let socket = tmux_socket_name(config);
    argv.push("-L".to_string());
    argv.push(socket.to_string());

    argv.push("new-session".to_string());
    // `-A` (attach) instead of `-d` (detached) so the control-mode
    // client is bound to the newly created session immediately. With
    // `-d` tmux creates a detached session and the server closes the
    // control session as soon as `refresh-client -C` arrives (Bug 014).
    argv.push("-A".to_string());

    if let Some(session_name) = config.tmux_session_name.as_deref() {
        argv.push("-s".to_string());
        argv.push(session_name.to_string());
    }

    let rows = config.initial_rows.unwrap_or(DEFAULT_INITIAL_ROWS);
    let cols = config.initial_cols.unwrap_or(DEFAULT_INITIAL_COLS);
    argv.push("-x".to_string());
    argv.push(cols.to_string());
    argv.push("-y".to_string());
    argv.push(rows.to_string());

    Ok(argv)
}

/// Translate a `std::io::Error` from spawning the `tmux` child into
/// a user-friendly message.
///
/// The most common failure on Windows is `tmux` not being on `PATH`
/// — users who have not installed tmux via WSL / MSYS2 / git-bash
/// yet hit this when they try to create their first tmux session.
/// `tokio::process::Command::spawn` reports that as
/// `io::ErrorKind::NotFound`, whose `Display` is the unhelpful
/// `"program not found"` — there is no hint of *which* program was
/// missing. This helper upgrades that single case into an actionable
/// error that names `tmux`, points to common Windows install paths,
/// and shows the argv that was being attempted.
fn tmux_spawn_err(e: std::io::Error, argv: &[&str]) -> TmuxError {
    if e.kind() == std::io::ErrorKind::NotFound {
        let msg = format!(
            "tmux executable not found in PATH. Please install tmux (>= 3.0) and \
             ensure `tmux -V` works from your shell. On Windows, common sources are \
             WSL (`wsl --install`, then install tmux inside the distro), MSYS2 \
             (`pacman -S tmux`), or git-bash (which bundles tmux on newer \
             releases). \
             (Original error: {e}; argv: tmux {})",
            argv.join(" ")
        );
        TmuxError::Internal(msg)
    } else {
        spawn_err("cmd.spawn", e)
    }
}

/// POSIX shell-style single-quote escape. Used to compose a single
/// `tmux -CC ...` command string for the SSH exec path. tmux argv
/// arguments may contain spaces (session names with spaces, socket
/// names with hyphens, etc.); wrapping every argument in single quotes
/// with embedded single quotes doubled is the standard portable form.
fn shell_quote(s: &str) -> String {
    let escaped = s.replace('\'', "'\\''");
    format!("'{}'", escaped)
}

/// Spawn a local `tmux` child process with stdin/stdout/stderr piped
/// and wrap it in a [`LocalTmuxBackend`]. Used by every constructor
/// that takes the local path (vs the SSH exec path).
fn build_local_tmux_backend(argv: &[&str]) -> Result<LocalTmuxBackend, TmuxError> {
    let mut cmd = Command::new("tmux");
    cmd.args(argv)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child = cmd.spawn().map_err(|e| tmux_spawn_err(e, argv))?;
    Ok(LocalTmuxBackend::new(child))
}
