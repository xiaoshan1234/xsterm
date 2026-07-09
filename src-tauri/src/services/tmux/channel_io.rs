//! Synchronous I/O adapters over async tokio channels.
//!
//! The tmux control-mode forwarder runs on a dedicated blocking thread, but the
//! SSH transport is async. `ChannelReader` and `ChannelWriter` bridge the two
//! worlds so the same forwarder can run over both local PTYs and SSH channels.

use std::collections::VecDeque;
use std::io::{Error as IoError, ErrorKind, Read, Write};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};

use tokio::sync::mpsc::UnboundedSender;

use crate::services::tmux::commands::build_tmux_argv;

/// Queue used to correlate `capture-pane` command responses with pane ids.
pub type CapturePaneQueue = Arc<Mutex<VecDeque<String>>>;

/// Sync `Write` adapter over an async `UnboundedSender`.
pub struct ChannelWriter {
    tx: UnboundedSender<Vec<u8>>,
}

impl ChannelWriter {
    /// Create a writer backed by the given async sender.
    pub fn new(tx: UnboundedSender<Vec<u8>>) -> Self {
        Self { tx }
    }
}

impl Write for ChannelWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.tx.send(buf.to_vec()).map_err(|_| {
            IoError::new(ErrorKind::BrokenPipe, "channel closed")
        })?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Sync `Read` adapter over a `Receiver<Option<Vec<u8>>>`.
pub struct ChannelReader {
    rx: Receiver<Option<Vec<u8>>>,
    buffer: Vec<u8>,
    closed: bool,
}

impl ChannelReader {
    /// Create a reader backed by the given sync receiver.
    pub fn new(rx: Receiver<Option<Vec<u8>>>) -> Self {
        Self {
            rx,
            buffer: Vec::new(),
            closed: false,
        }
    }
}

impl Read for ChannelReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if !self.buffer.is_empty() {
            let n = self.buffer.len().min(buf.len());
            buf[..n].copy_from_slice(&self.buffer[..n]);
            self.buffer.drain(..n);
            return Ok(n);
        }
        if self.closed {
            return Ok(0);
        }
        match self.rx.recv() {
            Ok(Some(data)) => {
                let n = data.len().min(buf.len());
                buf[..n].copy_from_slice(&data[..n]);
                if n < data.len() {
                    self.buffer.extend_from_slice(&data[n..]);
                }
                Ok(n)
            }
            Ok(None) => {
                self.closed = true;
                Ok(0)
            }
            Err(_) => {
                self.closed = true;
                Ok(0)
            }
        }
    }
}

/// Build the full shell command string used to spawn tmux in control mode.
pub fn build_tmux_command(command: &str, target: Option<&str>, socket: Option<&str>) -> String {
    build_tmux_argv(command, target, socket).join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn build_tmux_command_joins_argv() {
        assert_eq!(
            build_tmux_command("new-session", Some("xsterm"), None),
            "tmux -CC new-session -A -D -s xsterm"
        );
    }

    #[test]
    fn channel_writer_sends_bytes() {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let mut writer = ChannelWriter::new(tx);
        assert_eq!(writer.write(b"hello").unwrap(), 5);
        assert_eq!(writer.flush().unwrap(), ());
        assert_eq!(rx.try_recv().unwrap(), b"hello");
    }

    #[test]
    fn channel_reader_returns_received_data() {
        let (tx, rx) = mpsc::channel::<Option<Vec<u8>>>();
        let mut reader = ChannelReader::new(rx);
        tx.send(Some(b"hello".to_vec())).unwrap();
        let mut buf = [0u8; 16];
        let n = reader.read(&mut buf).unwrap();
        assert_eq!(&buf[..n], b"hello");
    }

    #[test]
    fn channel_reader_returns_eof_on_none() {
        let (tx, rx) = mpsc::channel::<Option<Vec<u8>>>();
        let mut reader = ChannelReader::new(rx);
        tx.send(None).unwrap();
        let mut buf = [0u8; 16];
        let n = reader.read(&mut buf).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn channel_reader_buffers_partial_reads() {
        let (tx, rx) = mpsc::channel::<Option<Vec<u8>>>();
        let mut reader = ChannelReader::new(rx);
        tx.send(Some(b"hello world".to_vec())).unwrap();
        let mut buf = [0u8; 5];
        let n = reader.read(&mut buf).unwrap();
        assert_eq!(&buf[..n], b"hello");
        let n = reader.read(&mut buf).unwrap();
        assert_eq!(&buf[..n], b" worl");
        let n = reader.read(&mut buf).unwrap();
        assert_eq!(&buf[..n], b"d");
    }

    #[test]
    fn capture_pane_queue_acts_as_fifo() {
        let queue: CapturePaneQueue = Arc::new(Mutex::new(VecDeque::new()));
        queue.lock().unwrap().push_back("%1".to_string());
        queue.lock().unwrap().push_back("%2".to_string());
        assert_eq!(queue.lock().unwrap().pop_front(), Some("%1".to_string()));
        assert_eq!(queue.lock().unwrap().pop_front(), Some("%2".to_string()));
    }
}
