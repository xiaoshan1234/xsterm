//! tmux adapter: a thin orchestration layer over xscore's `TmuxControl`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use xscore::platform::ssh::SshOptions;
use xscore::platform::tmux::{
    list_panes_command, parse_pane_line, resize_pane_command, send_keys_literal, TmuxControl,
    TmuxEvent, TmuxHostConfig, TmuxSocket, TmuxSpawnMode,
};

use crate::connect::app_backend::AppBackend;
use crate::connect::forward::spawn_output_forwarder;
use crate::shared::session::{SSHSessionConfig, SplitDirection, TmuxCcConfig};

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
    /// Spawn a control connection that creates a new tmux session.
    pub(crate) async fn spawn_new(
        config: &TmuxCcConfig,
        app_backend: Arc<dyn AppBackend>,
        controller_id: u32,
    ) -> Result<Arc<Self>, String> {
        let session_name = config
            .tmux_session_name
            .clone()
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| format!("xsterm-{controller_id}"));
        Self::spawn_with_mode(
            config,
            app_backend,
            controller_id,
            &session_name,
            TmuxSpawnMode::NewSession {
                cols: config.initial_cols.unwrap_or(80),
                rows: config.initial_rows.unwrap_or(24),
            },
        )
        .await
    }

    /// Spawn a control connection that attaches to an existing session.
    pub(crate) async fn spawn_attach(
        config: &TmuxCcConfig,
        app_backend: Arc<dyn AppBackend>,
        controller_id: u32,
    ) -> Result<Arc<Self>, String> {
        let session_name = config
            .tmux_session_name
            .as_deref()
            .filter(|name| !name.is_empty())
            .ok_or_else(|| "tmux attach requires `tmuxSessionName` in TmuxCcConfig".to_string())?;
        Self::spawn_with_mode(
            config,
            app_backend,
            controller_id,
            session_name,
            TmuxSpawnMode::Attach,
        )
        .await
    }

    async fn spawn_with_mode(
        config: &TmuxCcConfig,
        app_backend: Arc<dyn AppBackend>,
        controller_id: u32,
        session_name: &str,
        mode: TmuxSpawnMode,
    ) -> Result<Arc<Self>, String> {
        let (host, socket) = build_tmux_target(config)?;
        let control = match mode {
            TmuxSpawnMode::Attach => TmuxControl::spawn(&host, &socket, session_name).await,
            TmuxSpawnMode::NewSession { cols, rows } => {
                TmuxControl::spawn_new_session(&host, &socket, session_name, cols, rows).await
            }
        }
        .map_err(|e| e.to_string())?;

        let id_base = controller_id.saturating_mul(1_000_000);
        let session = Arc::new(Self {
            controller_id,
            control: Arc::new(control),
            session_name: Some(session_name.to_string()),
            app_backend: app_backend.clone(),
            pane_bindings: Mutex::new(HashMap::new()),
            pane_window_bindings: Mutex::new(HashMap::new()),
            window_bindings: Mutex::new(HashMap::new()),
            bootstrap_pane: Mutex::new(None),
            pane_tasks: Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(id_base + 1),
            next_xsterm_window_id: AtomicU32::new(id_base + 1),
        });

        session.spawn_event_loop();
        session.bootstrap_window().await?;
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

    /// Create the bootstrap window and register its first pane.
    async fn bootstrap_window(&self) -> Result<(), String> {
        // `new-window -P -F` prints the new window id deterministically.
        let reply = self
            .control
            .send("new-window -P -F '#{window_id}'")
            .await
            .map_err(|e| e.to_string())?;
        let window_id = reply
            .into_iter()
            .find(|line| !line.trim().is_empty())
            .ok_or_else(|| "tmux new-window returned no window id".to_string())?;

        let pane = self
            .control
            .send(&list_panes_command(&window_id))
            .await
            .map_err(|e| e.to_string())?
            .iter()
            .filter_map(|line| parse_pane_line(line))
            .map(|pane| pane.handle)
            .next()
            .ok_or_else(|| "tmux new-window returned no pane".to_string())?;

        let xsterm_window_id = self.allocate_xsterm_window_id();
        let xsterm_id = self.allocate_xsterm_id();
        self.register_pane(pane.clone(), xsterm_id);
        self.record_pane_window(pane.clone(), window_id.clone());
        if let Ok(mut bindings) = self.window_bindings.lock() {
            bindings.insert(window_id, xsterm_window_id);
        }
        if let Ok(mut slot) = self.bootstrap_pane.lock() {
            *slot = Some((xsterm_id, pane.clone()));
        }
        self.spawn_pane_forwarder(&pane, xsterm_id);
        Ok(())
    }

    pub(crate) async fn await_first_pane(&self) -> Result<(u32, String), String> {
        self.bootstrap_pane
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or_else(|| "tmux bootstrap pane not registered".to_string())
    }

    pub(crate) async fn send_keys(&self, pane: &str, data: &[u8]) -> Result<(), String> {
        self.ensure_pane_bound(pane)?;
        let text = String::from_utf8_lossy(data);
        let command = send_keys_literal(pane, &text).map_err(|e| e.to_string())?;
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

        let xsterm_id = self.allocate_xsterm_id();
        self.register_pane(pane.clone(), xsterm_id);
        self.record_pane_window(pane.clone(), window.clone());
        let _ = self.app_backend.emit(
            "tmux-pane-added",
            &serde_json::json!({
                "controller_id": self.controller_id,
                "tmux_pane_id": pane,
                "xsterm_session_id": xsterm_id,
                "parent_tmux_window_id": window,
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
            .control
            .send(&list_panes_command(&window_id))
            .await
            .map_err(|e| e.to_string())?
            .iter()
            .filter_map(|line| parse_pane_line(line))
            .map(|pane| pane.handle)
            .next()
            .ok_or_else(|| "tmux new-window returned no pane".to_string())?;

        let xsterm_window_id = self.allocate_xsterm_window_id();
        let xsterm_id = self.allocate_xsterm_id();
        self.register_pane(pane.clone(), xsterm_id);
        self.record_pane_window(pane.clone(), window_id.clone());
        if let Ok(mut bindings) = self.window_bindings.lock() {
            bindings.insert(window_id.clone(), xsterm_window_id);
        }
        let _ = self.app_backend.emit(
            "tmux-pane-added",
            &serde_json::json!({
                "controller_id": self.controller_id,
                "tmux_pane_id": pane,
                "xsterm_session_id": xsterm_id,
                "parent_tmux_window_id": window_id,
            }),
        );
        let _ = self.app_backend.emit(
            "tmux-window-added",
            &serde_json::json!({
                "controller_id": self.controller_id,
                "tmux_window_id": window_id,
                "xsterm_window_id": xsterm_window_id,
                "xsterm_session_id": xsterm_id,
                "xsterm_pane_id": pane,
            }),
        );
        self.spawn_pane_forwarder(&pane, xsterm_id);
        Ok((xsterm_window_id, window_id, xsterm_id, pane))
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

/// Build the xscore tmux target from an xsterm config.
fn build_tmux_target(config: &TmuxCcConfig) -> Result<(TmuxHostConfig, TmuxSocket), String> {
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

/// Map an xsterm SSH config onto xscore's `SshOptions`.
pub(crate) fn ssh_options_from_config(config: &SSHSessionConfig) -> SshOptions {
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
