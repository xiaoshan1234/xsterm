//! Bound terminal session: metadata plus a unified xscore transport handle.

use std::sync::Arc;

use xscore::platform::ssh::SshConnection;
use xscore::platform::{LocalPty, Size};

use crate::connect::tmux::TmuxSession;
use crate::shared::capabilities::CapabilityFlags;
use crate::shared::session::{SshConfig, TerminalInfo};

/// Transport backing a bound terminal session.
pub(crate) enum TerminalTransport {
    /// Local PTY / ConPTY subprocess.
    Local(Arc<LocalPty>),
    /// SSH shell channel.
    Ssh(Arc<SshConnection>),
    /// A pane owned by a tmux control connection.
    TmuxPane {
        /// Shared tmux session adapter.
        control: Arc<TmuxSession>,
        /// tmux pane handle (e.g. `%5`).
        pane_id: String,
    },
}

impl TerminalTransport {
    pub(crate) async fn write(&self, data: &[u8]) -> Result<(), String> {
        match self {
            Self::Local(pty) => {
                pty.write(data).map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::Ssh(conn) => {
                conn.write(data).await.map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::TmuxPane { control, pane_id } => control.send_keys(pane_id, data).await,
        }
    }

    pub(crate) async fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        match self {
            Self::Local(pty) => pty.resize(Size::new(cols, rows)).map_err(|e| e.to_string()),
            Self::Ssh(conn) => conn
                .resize(Size::new(cols, rows))
                .await
                .map_err(|e| e.to_string()),
            Self::TmuxPane { control, pane_id } => control.resize_pane(pane_id, rows, cols).await,
        }
    }

    pub(crate) async fn close(&self) -> Result<(), String> {
        match self {
            Self::Local(pty) => pty.close().map_err(|e| e.to_string()),
            Self::Ssh(conn) => conn.close().await.map_err(|e| e.to_string()),
            Self::TmuxPane { control, pane_id } => control.unbind_pane(pane_id),
        }
    }
}

/// Metadata and transport for one active session.
pub(crate) struct BoundTerminal {
    pub info: TerminalInfo,
    pub capabilities: CapabilityFlags,
    pub transport: TerminalTransport,
    pub ssh_config: Option<SshConfig>,
}
