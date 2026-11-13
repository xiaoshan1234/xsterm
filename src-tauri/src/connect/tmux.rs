//! tmux adapter: a thin orchestration layer over xscore's `TmuxControl`.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use xscore::platform::ssh::SshOptions;
use xscore::platform::tmux::{
    list_windows_command, parse_window_line, resize_pane_command, socket_args, TmuxControl,
    TmuxEvent, TmuxHostConfig, TmuxSocket,
};

use crate::connect::app_backend::AppBackend;
use crate::connect::forward::spawn_output_forwarder;
use crate::connect::ssh_exec::{ssh_exec_capture, ssh_exec_status};
use crate::shared::session::{AttachedTmuxServer, SplitDirection, SshConfig, TmuxSessionConfig};

const EXTENDED_PANE_FORMAT: &str = "#{window_index}|#{pane_index}|#{pane_id}|#{pane_width}|#{pane_height}|#{pane_left}|#{pane_top}|#{pane_current_command}|#{pane_active}|#{window_name}";

#[derive(Debug, Clone)]
struct ExtendedPaneInfo {
    window_index: u32,
    pane_index: u32,
    handle: String,
    cols: u16,
    rows: u16,
    x: u16,
    y: u16,
    current_command: String,
    is_active: bool,
    window_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PaneTerminalModes {
    alternate: bool,
    cursor: bool,
    insert: bool,
    origin: bool,
    wrap: bool,
    keypad_cursor: bool,
    keypad: bool,
    mouse_standard: bool,
    mouse_button: bool,
    mouse_all: bool,
    mouse_sgr: bool,
    cursor_x: Option<u16>,
    cursor_y: Option<u16>,
}

impl Default for PaneTerminalModes {
    fn default() -> Self {
        Self {
            alternate: false,
            cursor: true,
            insert: false,
            origin: false,
            wrap: true,
            keypad_cursor: false,
            keypad: false,
            mouse_standard: false,
            mouse_button: false,
            mouse_all: false,
            mouse_sgr: false,
            cursor_x: None,
            cursor_y: None,
        }
    }
}

/// One tmux control connection owning N panes (and therefore N xsterm
/// sessions). All state is guarded by `std::sync::Mutex` so the shared
/// adapter can be stored in an `Arc` and used from Tauri IPC threads.
pub(crate) struct TmuxSession {
    controller_id: u32,
    control: Arc<TmuxControl>,
    session_name: Option<String>,
    ssh_config: Option<SshConfig>,
    host_config: TmuxHostConfig,
    socket: TmuxSocket,
    app_backend: Arc<dyn AppBackend>,
    pane_bindings: Mutex<HashMap<String, u32>>,
    pane_window_bindings: Mutex<HashMap<String, String>>,
    window_bindings: Mutex<HashMap<String, u32>>,
    bootstrap_pane: Mutex<Option<(u32, String)>>,
    pane_tasks: Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
    layout_refresh_pending: Mutex<HashSet<String>>,
    layout_refresh_scheduled: AtomicBool,
    next_xsterm_id: AtomicU32,
    next_xsterm_window_id: AtomicU32,
}

impl TmuxSession {
    /// Spawn a control connection that attaches to an existing tmux session
    /// and registers every window / pane it finds.
    pub(crate) async fn spawn_attach(
        config: &TmuxSessionConfig,
        app_backend: Arc<dyn AppBackend>,
        controller_id: u32,
    ) -> Result<Arc<Self>, String> {
        let session_name = config
            .tmux_session_name
            .as_deref()
            .filter(|name| !name.is_empty())
            .ok_or_else(|| {
                "tmux attach requires `tmuxSessionName` in TmuxSessionConfig".to_string()
            })?;

        let (host, socket) = build_tmux_target(config)?;
        let control = TmuxControl::spawn(&host, &socket, session_name)
            .await
            .map_err(|e| e.to_string())?;
        Self::build_session(
            controller_id,
            control,
            session_name.to_string(),
            config.ssh.clone(),
            host,
            socket,
            app_backend,
        )
        .await
    }

    /// Spawn a control connection that creates a new tmux session. Fails when
    /// a session with the requested name already exists.
    pub(crate) async fn spawn_new(
        config: &TmuxSessionConfig,
        app_backend: Arc<dyn AppBackend>,
        controller_id: u32,
    ) -> Result<Arc<Self>, String> {
        let session_name = config
            .tmux_session_name
            .clone()
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| format!("xsterm-{controller_id}"));

        if tmux_session_exists(config, &session_name).await? {
            return Err(format!("tmux session '{session_name}' already exists"));
        }

        let (host, socket) = build_tmux_target(config)?;
        let cols = config.initial_cols.unwrap_or(80);
        let rows = config.initial_rows.unwrap_or(24);
        let control = TmuxControl::spawn_new_session(&host, &socket, &session_name, cols, rows)
            .await
            .map_err(|e| e.to_string())?;
        Self::build_session(
            controller_id,
            control,
            session_name,
            config.ssh.clone(),
            host,
            socket,
            app_backend,
        )
        .await
    }

    async fn build_session(
        controller_id: u32,
        control: TmuxControl,
        session_name: String,
        ssh_config: Option<SshConfig>,
        host_config: TmuxHostConfig,
        socket: TmuxSocket,
        app_backend: Arc<dyn AppBackend>,
    ) -> Result<Arc<Self>, String> {
        let id_base = controller_id.saturating_mul(1_000_000);
        let session = Arc::new(Self {
            controller_id,
            control: Arc::new(control),
            session_name: Some(session_name),
            ssh_config,
            host_config,
            socket,
            app_backend,
            pane_bindings: Mutex::new(HashMap::new()),
            pane_window_bindings: Mutex::new(HashMap::new()),
            window_bindings: Mutex::new(HashMap::new()),
            bootstrap_pane: Mutex::new(None),
            pane_tasks: Mutex::new(HashMap::new()),
            layout_refresh_pending: Mutex::new(HashSet::new()),
            layout_refresh_scheduled: AtomicBool::new(false),
            next_xsterm_id: AtomicU32::new(id_base + 1),
            next_xsterm_window_id: AtomicU32::new(id_base + 1),
        });

        session.spawn_event_loop();
        session.register_existing_windows().await?;
        Ok(session)
    }

    /// Subscribe to structural notifications and translate them into the
    /// frontend's `tmux-*` events.
    fn spawn_event_loop(self: &Arc<Self>) {
        let mut events = self.control.subscribe();
        let session = Arc::clone(self);
        tokio::spawn(async move {
            while let Some(event) = events.recv().await {
                session.handle_event(event);
            }
        });
    }

    fn handle_event(self: &Arc<Self>, event: TmuxEvent) {
        let backend = self.app_backend.as_ref();
        match event {
            TmuxEvent::PaneExited { pane } | TmuxEvent::PaneDied { pane } => {
                let xsterm_id = self.remove_pane(&pane);
                if let Some(xsterm_id) = xsterm_id {
                    let _ = backend.emit(
                        "tmux-pane-removed",
                        &serde_json::json!({
                            "controller_id": self.controller_id,
                            "tmux_pane_id": pane,
                            "xsterm_session_id": xsterm_id,
                        }),
                    );
                }
            }
            TmuxEvent::WindowClose { handle } => {
                if let Some(xsterm_window_id) = self.remove_window(&handle) {
                    let _ = backend.emit(
                        "tmux-window-closed",
                        &serde_json::json!({
                            "controller_id": self.controller_id,
                            "tmux_window_id": handle,
                            "xsterm_window_id": xsterm_window_id,
                        }),
                    );
                }
            }
            TmuxEvent::WindowRenamed { handle, name } => {
                let xsterm_window_id = self
                    .window_bindings
                    .lock()
                    .ok()
                    .and_then(|m| m.get(&handle).copied());
                if let Some(xsterm_window_id) = xsterm_window_id {
                    let _ = backend.emit(
                        "tmux-window-renamed",
                        &serde_json::json!({
                            "controller_id": self.controller_id,
                            "tmux_window_id": handle,
                            "xsterm_window_id": xsterm_window_id,
                            "name": name,
                        }),
                    );
                }
            }
            TmuxEvent::LayoutChange { handle, .. } => self.schedule_layout_refresh(handle),
            TmuxEvent::Exit { reason } => {
                let _ = backend.emit(
                    "tmux-controller-exit",
                    &serde_json::json!({
                        "controller_id": self.controller_id,
                        "reason": reason,
                    }),
                );
            }
            TmuxEvent::Pause { pane } => {
                let _ = backend.emit("tmux-paused", &serde_json::json!({ "tmux_pane_id": pane }));
            }
            TmuxEvent::Continue { pane } => {
                let _ = backend.emit(
                    "tmux-continued",
                    &serde_json::json!({ "tmux_pane_id": pane }),
                );
            }
            _ => {}
        }
    }

    /// Coalesce rapid `%layout-change` notifications and publish the latest
    /// pane geometry to the frontend so Tmux Status tracks window/pane resizes.
    fn schedule_layout_refresh(self: &Arc<Self>, window: String) {
        if let Ok(mut pending) = self.layout_refresh_pending.lock() {
            pending.insert(window);
        }
        if self.layout_refresh_scheduled.swap(true, Ordering::SeqCst) {
            return;
        }

        let session = Arc::clone(self);
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            session
                .layout_refresh_scheduled
                .store(false, Ordering::SeqCst);
            let windows: Vec<String> = session
                .layout_refresh_pending
                .lock()
                .map(|mut pending| pending.drain().collect())
                .unwrap_or_default();
            for window in windows {
                session.refresh_window_layout(&window).await;
            }
        });
    }

    async fn refresh_window_layout(&self, window: &str) {
        let Ok(panes) = self.list_extended_panes(window).await else {
            return;
        };
        let bindings = self
            .pane_bindings
            .lock()
            .map(|bindings| bindings.clone())
            .unwrap_or_default();
        let pane_entries: Vec<_> = panes
            .iter()
            .filter_map(|pane| {
                let xsterm_id = bindings.get(&pane.handle).copied()?;
                Some(serde_json::json!({
                    "tmux_pane_id": pane.handle,
                    "xsterm_session_id": xsterm_id,
                    "window_index": pane.window_index,
                    "pane_index": pane.pane_index,
                    "width": pane.cols,
                    "height": pane.rows,
                    "x": pane.x,
                    "y": pane.y,
                    "current_command": pane.current_command,
                    "is_active": pane.is_active,
                    "window_name": pane.window_name,
                }))
            })
            .collect();
        if pane_entries.is_empty() {
            return;
        }
        let _ = self.app_backend.emit(
            "tmux-layout-changed",
            &serde_json::json!({
                "controller_id": self.controller_id,
                "tmux_window_id": window,
                "session_name": self.session_name.clone().unwrap_or_default(),
                "panes": pane_entries,
            }),
        );
    }

    /// Discover every window and pane already present in the attached tmux
    /// session and register them. Emits `tmux-window-added` for each window
    /// and `tmux-pane-added` for each additional pane so the frontend can
    /// reconstruct the complete window list from a single attach call. The
    /// first pane is also recorded as the bootstrap pane for
    /// [`Self::await_first_pane`], but still emits its window event so
    /// manual attach and startup auto-attach render identically.
    async fn list_extended_panes(&self, window: &str) -> Result<Vec<ExtendedPaneInfo>, String> {
        let command = format!(
            "list-panes -t {} -F {}",
            shell_quote(window),
            shell_quote(EXTENDED_PANE_FORMAT)
        );
        let lines = self
            .control
            .send(&command)
            .await
            .map_err(|e| e.to_string())?;
        Ok(lines
            .iter()
            .filter_map(|line| parse_extended_pane_line(line))
            .collect())
    }

    async fn pane_details(&self, pane: &str) -> Result<ExtendedPaneInfo, String> {
        let command = format!(
            "display-message -p -t {} {}",
            pane,
            shell_quote(EXTENDED_PANE_FORMAT)
        );
        let lines = self
            .control
            .send(&command)
            .await
            .map_err(|e| e.to_string())?;
        lines
            .iter()
            .find_map(|line| parse_extended_pane_line(line))
            .ok_or_else(|| format!("tmux returned no details for pane {pane}"))
    }

    async fn register_existing_windows(&self) -> Result<(), String> {
        let session_name = self
            .session_name
            .clone()
            .ok_or_else(|| "tmux session name is missing".to_string())?;
        let window_lines = self
            .control
            .send(&list_windows_command(&session_name))
            .await
            .map_err(|e| e.to_string())?;

        let mut bootstrap_recorded = false;
        for window in window_lines
            .iter()
            .filter_map(|line| parse_window_line(line))
        {
            let tmux_window_id = window.handle;
            let panes = self.list_extended_panes(&tmux_window_id).await?;
            if panes.is_empty() {
                continue;
            }

            let xsterm_window_id = self.allocate_xsterm_window_id();
            if let Ok(mut bindings) = self.window_bindings.lock() {
                bindings.insert(tmux_window_id.clone(), xsterm_window_id);
            }

            let mut pane_entries = Vec::with_capacity(panes.len());
            for pane in &panes {
                let xsterm_id = self.allocate_xsterm_id();
                self.register_pane(pane.handle.clone(), xsterm_id);
                self.record_pane_window(pane.handle.clone(), tmux_window_id.clone());
                self.spawn_pane_forwarder(&pane.handle, xsterm_id);

                if !bootstrap_recorded {
                    if let Ok(mut slot) = self.bootstrap_pane.lock() {
                        *slot = Some((xsterm_id, pane.handle.clone()));
                    }
                    bootstrap_recorded = true;
                }

                pane_entries.push(serde_json::json!({
                    "tmux_pane_id": pane.handle,
                    "xsterm_session_id": xsterm_id,
                    "window_index": pane.window_index,
                    "pane_index": pane.pane_index,
                    "width": pane.cols,
                    "height": pane.rows,
                    "x": pane.x,
                    "y": pane.y,
                    "current_command": pane.current_command,
                    "is_active": pane.is_active,
                    "window_name": pane.window_name,
                }));
            }

            let _ = self.app_backend.emit(
                "tmux-window-added",
                &serde_json::json!({
                    "controller_id": self.controller_id,
                    "tmux_window_id": tmux_window_id,
                    "xsterm_window_id": xsterm_window_id,
                    "name": window.name,
                    "session_name": session_name.as_str(),
                    "panes": pane_entries,
                    "layout": window.layout,
                }),
            );
        }

        if !bootstrap_recorded {
            return Err(format!("tmux session '{session_name}' has no windows"));
        }
        Ok(())
    }

    pub(crate) async fn await_first_pane(&self) -> Result<(u32, String), String> {
        self.bootstrap_pane
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or_else(|| "tmux bootstrap pane not registered".to_string())
    }

    /// Return every tmux pane id paired with its allocated xsterm id.
    pub(crate) fn registered_panes(&self) -> Vec<(String, u32)> {
        self.pane_bindings
            .lock()
            .map(|m| m.iter().map(|(k, v)| (k.clone(), *v)).collect())
            .unwrap_or_default()
    }

    pub(crate) fn attached_tmux_server(&self, attached_at: u64) -> Option<AttachedTmuxServer> {
        let session_name = self.session_name.clone()?;
        let socket_name = match &self.socket {
            TmuxSocket::Named(name) => Some(name.clone()),
            TmuxSocket::Default | TmuxSocket::Path(_) => None,
        };
        let (transport, wsl_distribution) = match &self.host_config {
            TmuxHostConfig::Wsl { args } => {
                let distribution = args
                    .windows(2)
                    .find(|pair| {
                        matches!(
                            pair[0].as_str(),
                            "--distribution" | "-d" | "--distribution-id"
                        )
                    })
                    .map(|pair| pair[1].clone());
                (Some("wsl".to_string()), distribution)
            }
            TmuxHostConfig::Local => (Some("local".to_string()), None),
            TmuxHostConfig::Ssh { .. } => (None, None),
        };
        Some(AttachedTmuxServer {
            session_name,
            socket_name,
            transport,
            wsl_distribution,
            attached_at,
        })
    }

    pub(crate) async fn send_keys(&self, pane: &str, data: &[u8]) -> Result<(), String> {
        self.ensure_pane_bound(pane)?;
        let command = send_keys_command(pane, data)?;
        self.control
            .send(&command)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub(crate) async fn resize_pane(&self, pane: &str, rows: u16, cols: u16) -> Result<(), String> {
        self.ensure_pane_bound(pane)?;
        let command = resize_pane_command(pane, cols, rows);
        self.control
            .send(&command)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Resize the tmux control client. tmux uses the control client size to
    /// size the attached window, so this is what makes the tmux window track
    /// the xsterm window container instead of the fixed spawn-time PTY size.
    pub(crate) async fn resize_client(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.control
            .send(&format!("refresh-client -C {cols}x{rows}"))
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub(crate) async fn split_pane(
        &self,
        parent_pane: &str,
        direction: SplitDirection,
    ) -> Result<(u32, String, String), String> {
        let window = self
            .tmux_window_id_for_pane(parent_pane)
            .ok_or_else(|| format!("parent pane {parent_pane} is not bound to a window"))?;
        let command = format!(
            "split-window {} -t {} -P -F '#{{pane_id}}'",
            direction.flag(),
            parent_pane
        );
        let pane = self
            .control
            .send(&command)
            .await
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|line| !line.trim().is_empty())
            .ok_or_else(|| "tmux split-window returned no pane id".to_string())?;

        let details = self.pane_details(&pane).await?;
        let xsterm_id = self.allocate_xsterm_id();
        self.register_pane(pane.clone(), xsterm_id);
        self.record_pane_window(pane.clone(), window.clone());
        let session_name = self.session_name.clone().unwrap_or_default();
        let _ = self.app_backend.emit(
            "tmux-pane-added",
            &serde_json::json!({
                "controller_id": self.controller_id,
                "tmux_pane_id": pane,
                "xsterm_session_id": xsterm_id,
                "parent_tmux_window_id": window,
                "session_name": session_name,
                "window_index": details.window_index,
                "pane_index": details.pane_index,
                "width": details.cols,
                "height": details.rows,
                "x": details.x,
                "y": details.y,
                "current_command": details.current_command,
                "is_active": details.is_active,
                "window_name": details.window_name,
            }),
        );
        self.spawn_pane_forwarder(&pane, xsterm_id);
        Ok((xsterm_id, pane, window))
    }

    pub(crate) async fn new_window(
        &self,
        name: Option<&str>,
    ) -> Result<(u32, String, u32, String), String> {
        let command = match name {
            Some(name) => format!(
                "new-window -P -F '#{{window_id}}' -n '{}'",
                shell_quote(name)
            ),
            None => "new-window -P -F '#{window_id}'".to_string(),
        };
        let window_id = self
            .control
            .send(&command)
            .await
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|line| !line.trim().is_empty())
            .ok_or_else(|| "tmux new-window returned no window id".to_string())?;

        let pane = self
            .list_extended_panes(&window_id)
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| "tmux new-window returned no pane".to_string())?;

        let xsterm_window_id = self.allocate_xsterm_window_id();
        let xsterm_id = self.allocate_xsterm_id();
        self.register_pane(pane.handle.clone(), xsterm_id);
        self.record_pane_window(pane.handle.clone(), window_id.clone());
        let session_name = self.session_name.clone().unwrap_or_default();
        if let Ok(mut bindings) = self.window_bindings.lock() {
            bindings.insert(window_id.clone(), xsterm_window_id);
        }
        let _ = self.app_backend.emit(
            "tmux-window-added",
            &serde_json::json!({
                "controller_id": self.controller_id,
                "tmux_window_id": window_id,
                "xsterm_window_id": xsterm_window_id,
                "name": name.unwrap_or_default(),
                "session_name": session_name,
                "panes": [{
                    "tmux_pane_id": pane.handle,
                    "xsterm_session_id": xsterm_id,
                    "window_index": pane.window_index,
                    "pane_index": pane.pane_index,
                    "width": pane.cols,
                    "height": pane.rows,
                    "x": pane.x,
                    "y": pane.y,
                    "current_command": pane.current_command,
                    "is_active": pane.is_active,
                    "window_name": pane.window_name,
                }],
                "layout": "",
            }),
        );
        self.spawn_pane_forwarder(&pane.handle, xsterm_id);
        Ok((xsterm_window_id, window_id, xsterm_id, pane.handle))
    }

    /// Capture a pane's contents for the one-shot scrollback replay the
    /// frontend performs when a tmux pane is first mounted.
    ///
    /// Plain panes keep the historical behaviour: the main-screen scrollback
    /// (`capture-pane -p -e -J -S -<lines>`). When the pane is running a
    /// full-screen TUI inside the alternate screen (vim, less, htop, ...),
    /// tmux does not resend the alternate-screen state on attach, so writing
    /// only that screen would either leave xterm on the main buffer or paint
    /// the TUI into the wrong buffer. For those panes the reply is an ordered
    /// replay script:
    ///
    /// 1. the saved main screen (so quitting the TUI restores the shell),
    /// 2. `ESC[?1049h` to switch xterm into the alternate screen,
    /// 3. the TUI's visible alternate-screen content on its exact row grid,
    /// 4. DEC modes for cursor/wrap/keypad/mouse tracking plus cursor position.
    ///
    /// The frontend keeps applying `normalizeCapturedScrollback` to the whole
    /// payload; the escape sequences carry no newlines, so they pass through
    /// untouched.
    pub(crate) async fn capture_pane(&self, pane: &str, lines: i32) -> Result<String, String> {
        self.ensure_pane_bound(pane)?;

        let modes = match self.pane_terminal_modes(pane).await {
            Ok(modes) => modes,
            Err(error) => {
                tracing::warn!(
                    pane,
                    error,
                    "tmux terminal-mode probe failed; falling back to alternate-screen probe"
                );
                let alternate = self.pane_in_alternate_screen(pane).await.unwrap_or(false);
                PaneTerminalModes {
                    alternate,
                    ..PaneTerminalModes::default()
                }
            }
        };

        if !modes.alternate {
            let normal = self
                .capture_pane_raw(pane, Some(lines), false, false)
                .await?;
            return Ok(format!("{normal}{}", terminal_modes_replay(&modes)));
        }

        let normal = self
            .capture_pane_raw(pane, Some(lines), true, false)
            .await?;
        let alternate = self.capture_pane_raw(pane, None, false, true).await?;
        Ok(format!(
            "{}{}",
            alternate_screen_replay(&normal, &alternate),
            terminal_modes_replay(&modes)
        ))
    }

    /// Query the terminal modes tmux preserved for this pane. tmux does not
    /// replay these DECSET/DECRST sequences when a new control client attaches,
    /// so snapshots must carry them explicitly for TUIs to keep rendering and
    /// receiving wheel/mouse reports correctly.
    async fn pane_terminal_modes(&self, pane: &str) -> Result<PaneTerminalModes, String> {
        let command = format!(
            "display-message -p -t {pane} {}",
            shell_quote(
                "#{alternate_on}|#{cursor_flag}|#{insert_flag}|#{origin_flag}|#{wrap_flag}|#{keypad_cursor_flag}|#{keypad_flag}|#{mouse_standard_flag}|#{mouse_button_flag}|#{mouse_all_flag}|#{mouse_sgr_flag}|#{cursor_x}|#{cursor_y}"
            )
        );
        let reply = self
            .control
            .send(&command)
            .await
            .map_err(|e| e.to_string())?;
        reply
            .iter()
            .find_map(|line| parse_pane_terminal_modes(line))
            .ok_or_else(|| "tmux returned an invalid terminal-mode snapshot".to_string())
    }

    /// Ask tmux whether `pane` currently has an active alternate screen.
    async fn pane_in_alternate_screen(&self, pane: &str) -> Result<bool, String> {
        let command = format!(
            "display-message -p -t {pane} {}",
            shell_quote("#{alternate_on}")
        );
        let reply = self
            .control
            .send(&command)
            .await
            .map_err(|e| e.to_string())?;
        Ok(reply.iter().any(|line| line.trim() == "1"))
    }

    /// Run one `capture-pane` and join the returned rows with `\n`.
    ///
    /// `alternate` flips tmux's `-a` flag so the saved main screen can be
    /// captured while a TUI occupies the alternate screen. `lines = None`
    /// captures only the visible screen. `exact_screen` selects `-N` instead
    /// of `-J` for callers that explicitly need that capture shape.
    async fn capture_pane_raw(
        &self,
        pane: &str,
        lines: Option<i32>,
        alternate: bool,
        exact_screen: bool,
    ) -> Result<String, String> {
        let command = capture_pane_command(pane, lines, alternate, exact_screen);
        match &self.host_config {
            TmuxHostConfig::Local => {
                let output = tokio::process::Command::new("tmux")
                    .args(socket_args(&self.socket))
                    .args(command.split_whitespace())
                    .output()
                    .await
                    .map_err(|e| format!("failed to run tmux capture-pane: {e}"))?;
                if !output.status.success() {
                    return Err(format!(
                        "tmux capture-pane failed: {}",
                        String::from_utf8_lossy(&output.stderr).trim()
                    ));
                }
                Ok(String::from_utf8_lossy(&output.stdout)
                    .replace("\r\n", "\n")
                    .trim_end_matches('\n')
                    .to_string())
            }
            TmuxHostConfig::Wsl { args } => {
                let output = tokio::process::Command::new("wsl.exe")
                    .args(args)
                    .arg("--exec")
                    .arg("tmux")
                    .args(socket_args(&self.socket))
                    .args(command.split_whitespace())
                    .output()
                    .await
                    .map_err(|e| format!("failed to run WSL tmux capture-pane: {e}"))?;
                if !output.status.success() {
                    return Err(format!(
                        "WSL tmux capture-pane failed: {}",
                        String::from_utf8_lossy(&output.stderr).trim()
                    ));
                }
                Ok(String::from_utf8_lossy(&output.stdout)
                    .replace("\r\n", "\n")
                    .trim_end_matches('\n')
                    .to_string())
            }
            TmuxHostConfig::Ssh { .. } => {
                let ssh = self
                    .ssh_config
                    .as_ref()
                    .ok_or_else(|| "tmux SSH capture is missing ssh config".to_string())?;
                let remote_command = std::iter::once("tmux".to_string())
                    .chain(socket_args(&self.socket))
                    .chain(command.split_whitespace().map(str::to_string))
                    .map(|arg| shell_quote(&arg))
                    .collect::<Vec<_>>()
                    .join(" ");
                ssh_exec_capture(ssh, &remote_command)
                    .await
                    .map(|stdout| String::from_utf8_lossy(&stdout).replace("\r\n", "\n"))
            }
        }
    }

    pub(crate) fn kill_pane(&self, pane: &str) -> Result<(), String> {
        self.ensure_pane_bound(pane)?;
        tokio::spawn({
            let control = Arc::clone(&self.control);
            let pane = pane.to_string();
            async move {
                let _ = control.send(&format!("kill-pane -t {pane}")).await;
            }
        });
        Ok(())
    }

    pub(crate) fn kill_window(&self, window: &str) -> Result<(), String> {
        tokio::spawn({
            let control = Arc::clone(&self.control);
            let window = window.to_string();
            async move {
                let _ = control.send(&format!("kill-window -t {window}")).await;
            }
        });
        Ok(())
    }

    pub(crate) fn rename_window(&self, window: &str, name: &str) -> Result<(), String> {
        tokio::spawn({
            let control = Arc::clone(&self.control);
            let window = window.to_string();
            let name = name.to_string();
            async move {
                let _ = control
                    .send(&format!("rename-window -t {window} {}", shell_quote(&name)))
                    .await;
            }
        });
        Ok(())
    }

    pub(crate) fn session_name(&self) -> Option<String> {
        self.session_name.clone()
    }

    pub(crate) fn ssh_config(&self) -> Option<SshConfig> {
        self.ssh_config.clone()
    }

    pub(crate) fn window_bindings(&self) -> Vec<(String, u32)> {
        self.window_bindings
            .lock()
            .map(|m| m.iter().map(|(k, v)| (k.clone(), *v)).collect())
            .unwrap_or_default()
    }

    pub(crate) fn tmux_window_id_for_pane(&self, pane: &str) -> Option<String> {
        self.pane_window_bindings
            .lock()
            .ok()
            .and_then(|m| m.get(pane).cloned())
    }

    pub(crate) async fn close(&self) -> Result<(), String> {
        self.control.close().await.map_err(|e| e.to_string())
    }

    fn ensure_pane_bound(&self, pane: &str) -> Result<(), String> {
        let bound = self
            .pane_bindings
            .lock()
            .map_err(|e| e.to_string())?
            .contains_key(pane);
        if bound {
            Ok(())
        } else {
            Err(format!(
                "tmux pane '{pane}' is not registered with controller {}",
                self.controller_id
            ))
        }
    }

    fn register_pane(&self, pane: String, xsterm_id: u32) {
        if let Ok(mut bindings) = self.pane_bindings.lock() {
            bindings.insert(pane, xsterm_id);
        }
    }

    fn record_pane_window(&self, pane: String, window: String) {
        if let Ok(mut bindings) = self.pane_window_bindings.lock() {
            bindings.insert(pane, window);
        }
    }

    fn spawn_pane_forwarder(&self, pane: &str, xsterm_id: u32) {
        let handle = spawn_output_forwarder(
            self.control.output(pane),
            Arc::clone(&self.app_backend),
            xsterm_id,
        );
        if let Ok(mut tasks) = self.pane_tasks.lock() {
            tasks.insert(pane.to_string(), handle);
        }
    }

    fn remove_pane(&self, pane: &str) -> Option<u32> {
        if let Ok(mut tasks) = self.pane_tasks.lock() {
            if let Some(task) = tasks.remove(pane) {
                task.abort();
            }
        }
        if let Ok(mut bindings) = self.pane_window_bindings.lock() {
            bindings.remove(pane);
        }
        self.pane_bindings
            .lock()
            .ok()
            .and_then(|mut m| m.remove(pane))
    }

    fn remove_window(&self, window: &str) -> Option<u32> {
        if let Ok(mut pane_window) = self.pane_window_bindings.lock() {
            let panes: Vec<String> = pane_window
                .iter()
                .filter_map(|(pane, win)| (win == window).then(|| pane.clone()))
                .collect();
            for pane in panes {
                pane_window.remove(&pane);
                if let Ok(mut tasks) = self.pane_tasks.lock() {
                    if let Some(task) = tasks.remove(&pane) {
                        task.abort();
                    }
                }
                if let Ok(mut bindings) = self.pane_bindings.lock() {
                    bindings.remove(&pane);
                }
            }
        }
        self.window_bindings
            .lock()
            .ok()
            .and_then(|mut m| m.remove(window))
    }

    fn allocate_xsterm_id(&self) -> u32 {
        self.next_xsterm_id.fetch_add(1, Ordering::Relaxed)
    }

    fn allocate_xsterm_window_id(&self) -> u32 {
        self.next_xsterm_window_id.fetch_add(1, Ordering::Relaxed)
    }
}

fn parse_extended_pane_line(line: &str) -> Option<ExtendedPaneInfo> {
    let fields: Vec<&str> = line.split('|').collect();
    if fields.len() != 10 || !fields[2].starts_with('%') {
        return None;
    }
    Some(ExtendedPaneInfo {
        window_index: fields[0].parse().ok()?,
        pane_index: fields[1].parse().ok()?,
        handle: fields[2].to_string(),
        cols: fields[3].parse().ok()?,
        rows: fields[4].parse().ok()?,
        x: fields[5].parse().ok()?,
        y: fields[6].parse().ok()?,
        current_command: fields[7].to_string(),
        is_active: fields[8].trim() == "1",
        window_name: fields[9].to_string(),
    })
}

/// Build the xscore tmux target from an xsterm config.
fn build_tmux_target(config: &TmuxSessionConfig) -> Result<(TmuxHostConfig, TmuxSocket), String> {
    let host = match config.ssh.as_ref() {
        Some(ssh) => {
            if config.transport.as_deref() == Some("wsl") {
                return Err("tmux transport cannot be both SSH and WSL".to_string());
            }
            TmuxHostConfig::Ssh {
                user: ssh.username.clone(),
                host: ssh.host.clone(),
                port: ssh.port,
                identity: match ssh.auth_type.as_str() {
                    "key" => ssh.key_file.clone(),
                    _ => None,
                },
                password: match ssh.auth_type.as_str() {
                    "password" => ssh.password.clone(),
                    _ => None,
                },
                options: ssh_options_from_config(ssh),
            }
        }
        None => match config.transport.as_deref() {
            None | Some("local") => TmuxHostConfig::Local,
            Some("wsl") => {
                let distribution = config
                    .wsl_distribution
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                TmuxHostConfig::Wsl {
                    args: distribution
                        .map(|value| vec!["--distribution".to_string(), value.to_string()])
                        .unwrap_or_default(),
                }
            }
            Some(transport) => {
                return Err(format!("unsupported tmux transport: {transport}"));
            }
        },
    };
    let socket = match config.socket_name.as_deref() {
        Some(name) if !name.is_empty() => TmuxSocket::Named(name.to_string()),
        _ => TmuxSocket::Default,
    };
    Ok((host, socket))
}

/// Check whether a tmux session with `session_name` already exists on the
/// configured target. Uses `tmux has-session` locally or over SSH.
async fn tmux_session_exists(
    config: &TmuxSessionConfig,
    session_name: &str,
) -> Result<bool, String> {
    let (host, socket) = build_tmux_target(config)?;
    let socket = socket_args(&socket);
    match host {
        TmuxHostConfig::Local => {
            let mut command = tokio::process::Command::new("tmux");
            command
                .args(&socket)
                .arg("has-session")
                .arg("-t")
                .arg(session_name)
                .stderr(std::process::Stdio::null());
            let status = command
                .status()
                .await
                .map_err(|e| format!("failed to run tmux has-session: {e}"))?;
            Ok(status.code() == Some(0))
        }
        TmuxHostConfig::Ssh { .. } => {
            let ssh = config
                .ssh
                .as_ref()
                .ok_or_else(|| "tmux SSH target is missing ssh config".to_string())?;
            let mut args = socket;
            args.extend([
                "has-session".to_string(),
                "-t".to_string(),
                session_name.to_string(),
            ]);
            let command = std::iter::once("tmux".to_string())
                .chain(args)
                .map(|arg| shell_quote(&arg))
                .collect::<Vec<_>>()
                .join(" ");
            let status = ssh_exec_status(ssh, &command).await?;
            Ok(status == 0)
        }
        TmuxHostConfig::Wsl { args } => {
            let status = tokio::process::Command::new("wsl.exe")
                .args(args)
                .arg("--exec")
                .arg("tmux")
                .args(socket)
                .arg("has-session")
                .arg("-t")
                .arg(session_name)
                .stderr(std::process::Stdio::null())
                .status()
                .await
                .map_err(|e| format!("failed to run WSL tmux has-session: {e}"))?;
            Ok(status.success())
        }
    }
}

/// Map an xsterm SSH config onto xscore's `SshOptions`.
pub(crate) fn ssh_options_from_config(config: &SshConfig) -> SshOptions {
    SshOptions {
        keepalive_interval: config
            .keepalive_interval
            .map(|seconds| std::time::Duration::from_secs(seconds as u64)),
        connection_timeout: config
            .connection_timeout
            .map(|seconds| std::time::Duration::from_secs(seconds as u64)),
        tcp_nodelay: config.tcp_nodelay,
        so_keepalive: config.so_keepalive,
        enable_compression: config.enable_compression.unwrap_or(false),
        null_packet_keepalive: config.null_packet_keepalive.unwrap_or(false),
        proxy_jump: config.proxy_jump.clone(),
        known_hosts_path: config.known_hosts_path.clone(),
        term_type: config.term_type.clone(),
    }
}

fn shell_quote(s: &str) -> String {
    let escaped = s.replace('\'', "'\\''");
    format!("'{escaped}'")
}

/// Build a `capture-pane` command for a single pane.
///
/// `alternate` selects tmux's `-a` flag (the saved main screen while a TUI
/// occupies the alternate screen). `lines = None` omits `-S` so only the
/// visible screen is captured. `exact_screen` uses `-N` instead of `-J`;
/// `-J` remains the default because it preserves trailing cells and avoids
/// a control-mode reply stall observed with dense full-screen UIs.
fn capture_pane_command(
    pane: &str,
    lines: Option<i32>,
    alternate: bool,
    exact_screen: bool,
) -> String {
    let mut command = String::from("capture-pane -p -e");
    command.push_str(if exact_screen { " -N" } else { " -J" });
    if alternate {
        command.push_str(" -a");
    }
    if let Some(lines) = lines {
        let start = if lines >= 0 {
            format!("-{lines}")
        } else {
            lines.to_string()
        };
        command.push_str(&format!(" -S {start}"));
    }
    command.push_str(&format!(" -t {pane}"));
    command
}

/// Compose an alternate-screen replay payload.
///
/// `normal` is the saved main screen (what should be visible once the TUI
/// exits), `alternate` the TUI's current screen. The `?1049h` sequence flips
/// xterm into the alternate buffer after `normal` has populated the main
/// buffer; `2J`/`H` then give the TUI a clean, deterministic canvas.
fn alternate_screen_replay(normal: &str, alternate: &str) -> String {
    format!("{normal}\u{1b}[?1049h\u{1b}[2J\u{1b}[H{alternate}")
}

fn parse_pane_terminal_modes(line: &str) -> Option<PaneTerminalModes> {
    let values: Vec<&str> = line.trim().split('|').collect();
    if values.len() != 13 {
        return None;
    }
    let is_set = |index: usize| values[index].trim() == "1";
    let cursor_x = values[11].trim().parse::<u16>().ok();
    let cursor_y = values[12].trim().parse::<u16>().ok();
    Some(PaneTerminalModes {
        alternate: is_set(0),
        cursor: is_set(1),
        insert: is_set(2),
        origin: is_set(3),
        wrap: is_set(4),
        keypad_cursor: is_set(5),
        keypad: is_set(6),
        mouse_standard: is_set(7),
        mouse_button: is_set(8),
        mouse_all: is_set(9),
        mouse_sgr: is_set(10),
        cursor_x,
        cursor_y,
    })
}

fn terminal_modes_replay(modes: &PaneTerminalModes) -> String {
    let mut replay = String::new();
    replay.push_str(if modes.insert {
        "\u{1b}[4h"
    } else {
        "\u{1b}[4l"
    });
    replay.push_str(if modes.origin {
        "\u{1b}[?6h"
    } else {
        "\u{1b}[?6l"
    });
    replay.push_str(if modes.wrap {
        "\u{1b}[?7h"
    } else {
        "\u{1b}[?7l"
    });
    replay.push_str(if modes.cursor {
        "\u{1b}[?25h"
    } else {
        "\u{1b}[?25l"
    });
    replay.push_str(if modes.keypad_cursor {
        "\u{1b}[?1h"
    } else {
        "\u{1b}[?1l"
    });
    replay.push_str(if modes.keypad {
        "\u{1b}[?66h"
    } else {
        "\u{1b}[?66l"
    });

    if modes.mouse_all {
        replay.push_str("\u{1b}[?1003h");
    } else if modes.mouse_button {
        replay.push_str("\u{1b}[?1002h");
    } else if modes.mouse_standard {
        replay.push_str("\u{1b}[?1000h");
    }
    if modes.mouse_sgr {
        replay.push_str("\u{1b}[?1006h");
    }

    if let (Some(x), Some(y)) = (modes.cursor_x, modes.cursor_y) {
        replay.push_str(&format!(
            "\u{1b}[{};{}H",
            u32::from(y) + 1,
            u32::from(x) + 1
        ));
    }
    replay
}

/// Build a `send-keys` command for arbitrary bytes. Short payloads containing
/// whitespace, control bytes, or non-ASCII use `-H` hex encoding so tmux's
/// command tokenizer cannot discard spaces or reinterpret key names. Other
/// payloads use `-l` with octal escapes to avoid hex expansion on large pastes.
fn send_keys_command(pane: &str, payload: &[u8]) -> Result<String, String> {
    use std::fmt::Write as _;

    if payload.contains(&0) {
        return Err("tmux control mode cannot carry a NUL byte".to_string());
    }
    const HEX_ENCODING_MAX_BYTES: usize = 4096;
    let needs_unambiguous_bytes = payload.len() <= HEX_ENCODING_MAX_BYTES
        && payload
            .iter()
            .any(|byte| byte.is_ascii_whitespace() || *byte < 0x20 || *byte >= 0x80);
    if needs_unambiguous_bytes {
        let mut command = format!("send-keys -H -t {pane}");
        for byte in payload {
            let _ = write!(command, " {byte:02x}");
        }
        return Ok(command);
    }

    let mut escaped = String::with_capacity(payload.len());
    for &byte in payload {
        if byte < 0x20 || byte == b'\\' || byte >= 0x80 {
            let _ = write!(escaped, "\\{byte:03o}");
        } else {
            escaped.push(byte as char);
        }
    }
    let safe = escaped.replace('"', "\\\"");
    Ok(format!("send-keys -l -t {pane} \"{safe}\""))
}

#[cfg(test)]
mod tests {
    use std::process::Command;
    use std::time::{Duration, Instant};

    use super::{
        alternate_screen_replay, build_tmux_target, capture_pane_command, parse_extended_pane_line,
        parse_pane_terminal_modes, send_keys_command, terminal_modes_replay, PaneTerminalModes,
        TmuxControl, TmuxHostConfig, TmuxSession, TmuxSocket,
    };
    use crate::connect::app_backend::AppBackend;
    use crate::shared::session::{SshConfig, TmuxSessionConfig};

    #[test]
    fn parses_extended_pane_line_with_indices_and_command() {
        let info = parse_extended_pane_line("0|1|%60|88|1|0|0|bash|1|editor").expect("pane line");
        assert_eq!(info.window_index, 0);
        assert_eq!(info.pane_index, 1);
        assert_eq!(info.handle, "%60");
        assert_eq!(info.cols, 88);
        assert_eq!(info.rows, 1);
        assert_eq!(info.current_command, "bash");
        assert!(info.is_active);
        assert_eq!(info.window_name, "editor");
    }

    #[test]
    fn send_keys_command_preserves_spaces() {
        assert_eq!(
            send_keys_command("%5", b" ").unwrap(),
            "send-keys -H -t %5 20"
        );
    }

    #[test]
    fn send_keys_command_hex_encodes_control_and_utf8() {
        assert_eq!(
            send_keys_command("%0", b"hello\nworld").unwrap(),
            "send-keys -H -t %0 68 65 6c 6c 6f 0a 77 6f 72 6c 64"
        );
        assert_eq!(
            send_keys_command("%0", b"a\\b").unwrap(),
            r#"send-keys -l -t %0 "a\134b""#
        );
        assert_eq!(
            send_keys_command("%0", "é".as_bytes()).unwrap(),
            "send-keys -H -t %0 c3 a9"
        );
    }

    #[test]
    fn send_keys_command_escapes_embedded_quote_and_rejects_nul() {
        assert_eq!(
            send_keys_command("%0", b"say \"hi\"").unwrap(),
            "send-keys -H -t %0 73 61 79 20 22 68 69 22"
        );
        assert!(send_keys_command("%0", b"a\0b").is_err());
    }

    #[test]
    fn capture_pane_command_shapes_main_screen_with_scrollback() {
        assert_eq!(
            capture_pane_command("%7", Some(2000), false, false),
            "capture-pane -p -e -J -S -2000 -t %7"
        );
    }

    #[test]
    fn capture_pane_command_shapes_visible_alternate_screen() {
        assert_eq!(
            capture_pane_command("%7", None, false, true),
            "capture-pane -p -e -N -t %7"
        );
        assert_eq!(
            capture_pane_command("%7", None, false, false),
            "capture-pane -p -e -J -t %7"
        );
        assert_eq!(
            capture_pane_command("%7", Some(2000), true, false),
            "capture-pane -p -e -J -a -S -2000 -t %7"
        );
    }

    #[test]
    fn alternate_screen_replay_switches_buffers_in_order() {
        assert_eq!(
            alternate_screen_replay("shell\nprompt", "TUI row 1\nTUI row 2"),
            "shell\nprompt\u{1b}[?1049h\u{1b}[2J\u{1b}[HTUI row 1\nTUI row 2"
        );
    }

    #[test]
    fn parses_tui_terminal_modes_and_cursor_position() {
        let modes =
            parse_pane_terminal_modes("1|1|0|0|1|1|1|0|0|1|1|12|7").expect("terminal modes");
        assert_eq!(
            modes,
            PaneTerminalModes {
                alternate: true,
                cursor: true,
                insert: false,
                origin: false,
                wrap: true,
                keypad_cursor: true,
                keypad: true,
                mouse_standard: false,
                mouse_button: false,
                mouse_all: true,
                mouse_sgr: true,
                cursor_x: Some(12),
                cursor_y: Some(7),
            }
        );
    }

    #[test]
    fn terminal_mode_replay_restores_tui_render_and_mouse_modes() {
        let modes = PaneTerminalModes {
            alternate: true,
            cursor: true,
            insert: false,
            origin: false,
            wrap: true,
            keypad_cursor: true,
            keypad: true,
            mouse_standard: false,
            mouse_button: false,
            mouse_all: true,
            mouse_sgr: true,
            cursor_x: Some(3),
            cursor_y: Some(5),
        };

        assert_eq!(
            terminal_modes_replay(&modes),
            "\u{1b}[4l\u{1b}[?6l\u{1b}[?7h\u{1b}[?25h\u{1b}[?1h\u{1b}[?66h\u{1b}[?1003h\u{1b}[?1006h\u{1b}[6;4H"
        );
    }

    #[test]
    fn build_tmux_target_maps_wsl_transport_and_distribution() {
        let config = TmuxSessionConfig {
            transport: Some("wsl".to_string()),
            wsl_distribution: Some("Debian".to_string()),
            socket_name: Some("dev".to_string()),
            ..TmuxSessionConfig::default()
        };

        let (host, socket) = build_tmux_target(&config).expect("WSL tmux target");
        assert_eq!(
            host,
            TmuxHostConfig::Wsl {
                args: vec!["--distribution".to_string(), "Debian".to_string()],
            }
        );
        assert_eq!(socket, TmuxSocket::Named("dev".to_string()));
    }

    #[test]
    fn build_tmux_target_rejects_ssh_and_wsl_conflict() {
        let config = TmuxSessionConfig {
            transport: Some("wsl".to_string()),
            ssh: Some(SshConfig {
                host: "example.com".to_string(),
                port: 22,
                username: "dev".to_string(),
                auth_type: "password".to_string(),
                ..SshConfig::default()
            }),
            ..TmuxSessionConfig::default()
        };

        assert!(build_tmux_target(&config).is_err());
    }

    struct TestAppBackend;

    impl AppBackend for TestAppBackend {
        fn emit(&self, _event: &str, _payload: &serde_json::Value) -> Result<(), String> {
            Ok(())
        }

        fn emit_bytes(&self, _session_id: u32, _bytes: Vec<u8>) -> Result<(), String> {
            Ok(())
        }
    }

    struct WslTmuxFixture {
        socket_name: String,
        session_name: String,
        script_path: String,
    }

    impl WslTmuxFixture {
        fn start() -> Self {
            let fixture_id = format!(
                "{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .expect("system clock")
                    .as_nanos()
            );
            let fixture = Self {
                socket_name: format!("xsterm-tui-{fixture_id}"),
                session_name: format!("session-{fixture_id}"),
                script_path: format!("/tmp/xsterm-fake-tui-{fixture_id}.py"),
            };
            let setup_script = r#"
set -e
cat > "__SCRIPT_PATH__" <<'PY'
import os
import sys
import termios
import tty

fd = sys.stdin.fileno()
old_settings = termios.tcgetattr(fd)
try:
    tty.setraw(fd)
    sys.stdout.write(
        "\x1b[?1049h"
        "\x1b[?1003h"
        "\x1b[?1006h"
        "\x1b[2J\x1b[H"
        "XSTERM_FAKE_TUI_READY\r\n"
        "WHEEL_EVENTS=0"
    )
    sys.stdout.flush()
    wheel_count = 0
    space_count = 0
    while True:
        chunk = os.read(fd, 1024)
        if b"<64;" in chunk or b"<65;" in chunk:
            wheel_count += 1
            sys.stdout.write(
                f"\x1b[2;1H\x1b[2KWHEEL_EVENTS={wheel_count}\x1b[4;1H"
            )
            sys.stdout.flush()
        if b" " in chunk:
            space_count += 1
            sys.stdout.write(
                f"\x1b[3;1H\x1b[2KSPACE_EVENTS={space_count}\x1b[4;1H"
            )
            sys.stdout.flush()
except OSError:
    pass
finally:
    termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)
PY
tmux -L "__SOCKET_NAME__" kill-server >/dev/null 2>&1 || true
tmux -L "__SOCKET_NAME__" new-session -d -s "__SESSION_NAME__" \
  "python3 -- __SCRIPT_PATH__"
"#
            .replace("__SCRIPT_PATH__", &fixture.script_path)
            .replace("__SOCKET_NAME__", &fixture.socket_name)
            .replace("__SESSION_NAME__", &fixture.session_name);
            let status = Command::new("wsl.exe")
                .args(["--exec", "bash", "-lc", &setup_script])
                .status()
                .expect("start WSL tmux fixture");
            assert!(status.success(), "failed to start WSL tmux fixture");
            fixture
        }

        fn host_config(&self) -> TmuxHostConfig {
            TmuxHostConfig::Wsl { args: Vec::new() }
        }

        fn socket(&self) -> TmuxSocket {
            TmuxSocket::Named(self.socket_name.clone())
        }
    }

    impl Drop for WslTmuxFixture {
        fn drop(&mut self) {
            let cleanup_script = format!(
                "tmux -L '{}' kill-server >/dev/null 2>&1 || true; rm -f '{}'",
                self.socket_name, self.script_path
            );
            let _ = Command::new("wsl.exe")
                .args(["--exec", "bash", "-lc", &cleanup_script])
                .status();
        }
    }

    async fn wait_for_capture(
        session: &TmuxSession,
        pane: &str,
        expected_fragment: &str,
    ) -> String {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut latest_capture = String::new();
        while Instant::now() < deadline {
            latest_capture = session
                .capture_pane(pane, 2000)
                .await
                .expect("capture tmux pane");
            if latest_capture.contains(expected_fragment) {
                return latest_capture;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("tmux pane did not contain {expected_fragment:?}: {latest_capture:?}");
    }

    #[tokio::test]
    #[ignore = "requires WSL2 with tmux/python3; run npm run test:tmux:tui"]
    async fn tmux_tui_detach_reconnect_restores_modes_and_mouse() {
        let fixture = WslTmuxFixture::start();

        let first_control = TmuxControl::spawn(
            &fixture.host_config(),
            &fixture.socket(),
            &fixture.session_name,
        )
        .await
        .expect("spawn first tmux control client");
        let first_session = TmuxSession::build_session(
            1,
            first_control,
            fixture.session_name.clone(),
            None,
            fixture.host_config(),
            fixture.socket(),
            std::sync::Arc::new(TestAppBackend),
        )
        .await
        .expect("build first tmux session");
        let pane = first_session
            .registered_panes()
            .into_iter()
            .next()
            .expect("registered tmux pane")
            .0;

        let first_capture = wait_for_capture(&first_session, &pane, "XSTERM_FAKE_TUI_READY").await;
        assert!(first_capture.contains("\u{1b}[?1049h"));
        assert!(first_capture.contains("\u{1b}[?1003h"));
        assert!(first_capture.contains("\u{1b}[?1006h"));

        first_session
            .control
            .close()
            .await
            .expect("detach first tmux control client");

        let second_control = TmuxControl::spawn(
            &fixture.host_config(),
            &fixture.socket(),
            &fixture.session_name,
        )
        .await
        .expect("spawn reconnected tmux control client");
        let second_session = TmuxSession::build_session(
            2,
            second_control,
            fixture.session_name.clone(),
            None,
            fixture.host_config(),
            fixture.socket(),
            std::sync::Arc::new(TestAppBackend),
        )
        .await
        .expect("build reconnected tmux session");
        let reconnected_pane = second_session
            .registered_panes()
            .into_iter()
            .next()
            .expect("reconnected tmux pane")
            .0;

        let reconnected_capture =
            wait_for_capture(&second_session, &reconnected_pane, "XSTERM_FAKE_TUI_READY").await;
        let modes = second_session
            .pane_terminal_modes(&reconnected_pane)
            .await
            .expect("query reconnected terminal modes");
        assert!(modes.alternate);
        assert!(modes.mouse_all);
        assert!(modes.mouse_sgr);
        assert!(reconnected_capture.contains("\u{1b}[?1049h"));
        assert!(reconnected_capture.contains("\u{1b}[?1003h"));
        assert!(reconnected_capture.contains("\u{1b}[?1006h"));

        second_session
            .send_keys(&reconnected_pane, b"\x1b[<64;5;5M")
            .await
            .expect("send mouse wheel input");
        let wheel_capture =
            wait_for_capture(&second_session, &reconnected_pane, "WHEEL_EVENTS=1").await;
        assert!(wheel_capture.contains("WHEEL_EVENTS=1"));

        second_session
            .send_keys(&reconnected_pane, b" ")
            .await
            .expect("send space input");
        let space_capture =
            wait_for_capture(&second_session, &reconnected_pane, "SPACE_EVENTS=1").await;
        assert!(space_capture.contains("SPACE_EVENTS=1"));

        second_session
            .control
            .close()
            .await
            .expect("close reconnected tmux control client");
    }

    #[tokio::test]
    #[ignore = "requires WSL2 with tmux; run npm run test:tmux:tui"]
    async fn tmux_wsl_create_opens_control_session() {
        let suffix = format!(
            "{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        );
        let socket_name = format!("xsterm-create-{suffix}");
        let session_name = format!("create-{suffix}");
        let config = TmuxSessionConfig {
            tmux_session_name: Some(session_name.clone()),
            socket_name: Some(socket_name.clone()),
            transport: Some("wsl".to_string()),
            ..TmuxSessionConfig::default()
        };

        let session = TmuxSession::spawn_new(&config, std::sync::Arc::new(TestAppBackend), 3)
            .await
            .expect("create native WSL tmux session");
        assert!(!session.registered_panes().is_empty());

        session
            .control
            .close()
            .await
            .expect("close WSL tmux control client");
        let _ = Command::new("wsl.exe")
            .args(["--exec", "tmux", "-L", &socket_name, "kill-server"])
            .status();
    }
}
