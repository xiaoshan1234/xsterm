//! tmux adapter: a thin orchestration layer over xscore's `TmuxControl`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use xscore::platform::ssh::SshOptions;
use xscore::platform::tmux::{
    list_windows_command, parse_window_line, resize_pane_command, socket_args, TmuxControl,
    TmuxEvent, TmuxHostConfig, TmuxSocket,
};

use crate::connect::app_backend::AppBackend;
use crate::connect::forward::spawn_output_forwarder;
use crate::connect::ssh_exec::ssh_exec_status;
use crate::shared::session::{SplitDirection, SshConfig, TmuxSessionConfig};

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

/// One tmux control connection owning N panes (and therefore N xsterm
/// sessions). All state is guarded by `std::sync::Mutex` so the shared
/// adapter can be stored in an `Arc` and used from Tauri IPC threads.
pub(crate) struct TmuxSession {
    controller_id: u32,
    control: Arc<TmuxControl>,
    session_name: Option<String>,
    app_backend: Arc<dyn AppBackend>,
    pane_bindings: Mutex<HashMap<String, u32>>,
    pane_window_bindings: Mutex<HashMap<String, String>>,
    window_bindings: Mutex<HashMap<String, u32>>,
    bootstrap_pane: Mutex<Option<(u32, String)>>,
    pane_tasks: Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
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
        Self::build_session(controller_id, control, session_name, app_backend).await
    }

    async fn build_session(
        controller_id: u32,
        control: TmuxControl,
        session_name: String,
        app_backend: Arc<dyn AppBackend>,
    ) -> Result<Arc<Self>, String> {
        let id_base = controller_id.saturating_mul(1_000_000);
        let session = Arc::new(Self {
            controller_id,
            control: Arc::new(control),
            session_name: Some(session_name),
            app_backend,
            pane_bindings: Mutex::new(HashMap::new()),
            pane_window_bindings: Mutex::new(HashMap::new()),
            window_bindings: Mutex::new(HashMap::new()),
            bootstrap_pane: Mutex::new(None),
            pane_tasks: Mutex::new(HashMap::new()),
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

    fn handle_event(&self, event: TmuxEvent) {
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

    pub(crate) fn unbind_pane(&self, pane: &str) -> Result<(), String> {
        self.remove_pane(pane);
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

    pub(crate) async fn capture_pane(&self, pane: &str, lines: i32) -> Result<String, String> {
        self.ensure_pane_bound(pane)?;
        let start = if lines >= 0 {
            format!("-{lines}")
        } else {
            lines.to_string()
        };
        let command = format!("capture-pane -p -e -J -S {start} -t {pane}");
        self.control
            .send(&command)
            .await
            .map(|lines| lines.join("\n"))
            .map_err(|e| e.to_string())
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
        Some(ssh) => TmuxHostConfig::Ssh {
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
        },
        None => TmuxHostConfig::Local,
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
                .arg(session_name);
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
        TmuxHostConfig::Wsl { .. } => {
            Err("tmux session existence checks over WSL are not supported".to_string())
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

/// Build a `send-keys -l` command that delivers arbitrary bytes to a pane
/// without letting tmux's command-line tokenizer eat whitespace or treat key
/// names specially. Control bytes, backslash and non-ASCII bytes are emitted
/// as `\nnn` octal escapes and the whole payload is wrapped in double quotes;
/// tmux's `-l` literal mode decodes those escapes back to the original bytes.
fn send_keys_command(pane: &str, payload: &[u8]) -> Result<String, String> {
    use std::fmt::Write as _;

    if payload.contains(&0) {
        return Err("tmux control mode cannot carry a NUL byte".to_string());
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
    use super::send_keys_command;

    #[test]
    fn send_keys_command_preserves_spaces() {
        assert_eq!(
            send_keys_command("%5", b" ").unwrap(),
            r#"send-keys -l -t %5 " ""#
        );
    }

    #[test]
    fn send_keys_command_octal_escapes_control_backslash_and_utf8() {
        assert_eq!(
            send_keys_command("%0", b"hello\nworld").unwrap(),
            r#"send-keys -l -t %0 "hello\012world""#
        );
        assert_eq!(
            send_keys_command("%0", b"a\\b").unwrap(),
            r#"send-keys -l -t %0 "a\134b""#
        );
        assert_eq!(
            send_keys_command("%0", "é".as_bytes()).unwrap(),
            r#"send-keys -l -t %0 "\303\251""#
        );
    }

    #[test]
    fn send_keys_command_escapes_embedded_quote_and_rejects_nul() {
        assert_eq!(
            send_keys_command("%0", b"say \"hi\"").unwrap(),
            r#"send-keys -l -t %0 "say \"hi\"""#
        );
        assert!(send_keys_command("%0", b"a\0b").is_err());
    }
}
