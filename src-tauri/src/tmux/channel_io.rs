//! Synchronous I/O adapters for tmux control mode transports.
//!
//! Tmux control mode reads and writes a plain byte stream. On a local PTY
//! those bytes come from a file-like master; on an SSH connection they flow
//! through async tokio channels. This module provides:
//!
//! - [`CapturePaneQueue`]: a FIFO used to correlate `capture-pane` commands
//!   with their response blocks because tmux does not accept client-assigned
//!   command ids.
//! - [`ChannelWriter`]: a synchronous `Write` adapter over an async tokio
//!   unbounded sender.
//! - [`ChannelReader`]: a synchronous `Read` adapter over a std mpsc receiver,
//!   with internal buffering for chunk-sized reads.
//! - [`build_tmux_command`]: assemble the full `tmux -CC ...` shell command
//!   used for SSH exec channels.

use std::collections::VecDeque;
use std::io::{self, Read, Write};
use std::sync::mpsc as sync_mpsc;
use std::sync::{Arc, Mutex};

use tokio::sync::mpsc::UnboundedSender;

use crate::models::session::TmuxSessionConfig;
use crate::tmux::commands::build_tmux_argv;

/// Queue used to pair outgoing `capture-pane` commands with their responses.
///
/// Tmux control mode does not accept client-assigned command numbers, so we
/// rely on FIFO order: every `capture-pane` request pushes its target pane id
/// here, and the parser pops it when the corresponding `%begin` arrives.
pub type CapturePaneQueue = Arc<Mutex<VecDeque<String>>>;

/// Sync `Write` adapter on top of an async tokio mpsc sender.
///
/// Used to feed tmux control commands into an SSH channel from a synchronous
/// forwarding thread.
pub struct ChannelWriter {
    tx: UnboundedSender<Vec<u8>>,
}

impl ChannelWriter {
    pub fn new(tx: UnboundedSender<Vec<u8>>) -> Self {
        Self { tx }
    }
}

impl Write for ChannelWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.tx
            .send(buf.to_vec())
            .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "SSH channel closed"))?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Sync `Read` adapter on top of a std mpsc receiver.
///
/// Buffers partial reads so the forwarder can consume SSH channel data in
/// arbitrarily-sized chunks.
pub struct ChannelReader {
    rx: sync_mpsc::Receiver<Option<Vec<u8>>>,
    buffer: Vec<u8>,
    pos: usize,
}

impl ChannelReader {
    pub fn new(rx: sync_mpsc::Receiver<Option<Vec<u8>>>) -> Self {
        Self {
            rx,
            buffer: Vec::new(),
            pos: 0,
        }
    }
}

impl Read for ChannelReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.pos >= self.buffer.len() {
            match self.rx.recv() {
                Ok(Some(data)) => {
                    self.buffer = data;
                    self.pos = 0;
                }
                Ok(None) => return Ok(0),
                Err(_) => {
                    return Err(io::Error::new(
                        io::ErrorKind::BrokenPipe,
                        "SSH channel closed",
                    ))
                }
            }
        }
        let remaining = &self.buffer[self.pos..];
        let to_copy = remaining.len().min(buf.len());
        buf[..to_copy].copy_from_slice(&remaining[..to_copy]);
        self.pos += to_copy;
        Ok(to_copy)
    }
}

/// Build the full `tmux -CC ...` command string used for SSH exec.
pub fn build_tmux_command(config: &TmuxSessionConfig) -> String {
    let mut parts = vec!["tmux".to_string(), "-CC".to_string()];
    if let Some(socket) = &config.socket {
        parts.push("-L".to_string());
        parts.push(socket.clone());
    }
    parts.extend(build_tmux_argv(&config.command, config.target.as_deref()));
    parts.join(" ")
}
