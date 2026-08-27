//! Wire protocol shared between the main xsterm process and the elevated
//! helper binary (`xsterm-elevated-helper.exe`).
//!
//! Elevated (run-as-administrator) shells cannot run in-process: Windows UAC
//! requires `ShellExecuteEx("runas")`, which does not return a child process
//! handle, and an elevated child cannot inherit a ConPTY created by a
//! non-elevated parent (UIPI). The main process therefore launches the helper
//! elevated; the helper owns the ConPTY and bridges it to the main process
//! over a named pipe using the framing defined here.
//!
//! Every message is framed as `[u8 type][u32 length_be][payload bytes]`:
//!
//! | type | name     | direction        | payload                    |
//! |------|----------|------------------|----------------------------|
//! | 0x01 | data     | helper -> main   | PTY output bytes           |
//! | 0x02 | write    | main -> helper   | user input bytes           |
//! | 0x03 | resize   | main -> helper   | rows u16 BE ++ cols u16 BE |
//! | 0x04 | eof      | helper -> main   | empty (shell exited)       |
//!
//! This module is `pub` (not `pub(crate)`) because the helper is a separate
//! binary target that links against this crate.

use std::io::{ErrorKind, Read, Write};

/// PTY output bytes (helper -> main).
pub const MSG_DATA: u8 = 0x01;
/// User input bytes (main -> helper).
pub const MSG_WRITE: u8 = 0x02;
/// Terminal resize; payload is `rows` u16 BE followed by `cols` u16 BE (main -> helper).
pub const MSG_RESIZE: u8 = 0x03;
/// Shell exited (helper -> main). Payload is empty.
pub const MSG_EOF: u8 = 0x04;

/// Sanity bound for a single frame payload. Guards against corrupt length
/// headers allocating huge buffers; real frames are bounded by PTY output
/// bursts and user input sizes.
pub const MAX_FRAME_PAYLOAD: usize = 16 * 1024 * 1024;

/// Encode a resize payload (`rows` and `cols`, big-endian).
pub fn encode_resize_payload(rows: u16, cols: u16) -> [u8; 4] {
    let mut payload = [0u8; 4];
    payload[..2].copy_from_slice(&rows.to_be_bytes());
    payload[2..].copy_from_slice(&cols.to_be_bytes());
    payload
}

/// Decode a resize payload. Returns `None` when the payload is malformed.
pub fn decode_resize_payload(payload: &[u8]) -> Option<(u16, u16)> {
    if payload.len() != 4 {
        return None;
    }
    let rows = u16::from_be_bytes([payload[0], payload[1]]);
    let cols = u16::from_be_bytes([payload[2], payload[3]]);
    Some((rows, cols))
}

/// Write one framed message.
pub fn write_frame<W: Write>(writer: &mut W, msg_type: u8, payload: &[u8]) -> std::io::Result<()> {
    let mut frame = Vec::with_capacity(5 + payload.len());
    frame.push(msg_type);
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(payload);
    writer.write_all(&frame)?;
    // No flush: FlushFileBuffers on a named pipe server-side blocks until
    // the client has drained the buffer, which can deadlock when the helper
    // writes faster than the client reads. Named pipes buffer up to PIPE_BUFFER_SIZE.
    Ok(())
}

/// Read one framed message.
///
/// Returns `Ok(None)` on a clean EOF before the first byte of a frame (the
/// peer closed the pipe). A truncated frame (EOF mid-frame) is reported as an
/// `UnexpectedEof` error so callers can distinguish a broken stream.
pub fn read_frame<R: Read>(reader: &mut R) -> std::io::Result<Option<(u8, Vec<u8>)>> {
    let mut type_buf = [0u8; 1];
    match reader.read_exact(&mut type_buf) {
        Ok(()) => {}
        Err(e) if e.kind() == ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }

    let mut len_buf = [0u8; 4];
    reader.read_exact(&mut len_buf)?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > MAX_FRAME_PAYLOAD {
        return Err(std::io::Error::new(
            ErrorKind::InvalidData,
            format!("frame payload length {} exceeds limit {}", len, MAX_FRAME_PAYLOAD),
        ));
    }

    let mut payload = vec![0u8; len];
    reader.read_exact(&mut payload)?;
    Ok(Some((type_buf[0], payload)))
}

/// Quote a single command-line argument per MSVCRT parsing rules.
///
/// The helper is launched via `ShellExecuteEx`, whose `lpParameters` string is
/// re-parsed by the CRT; arguments containing whitespace or quotes must be
/// quoted, with backslash runs preceding a quote doubled.
pub fn quote_windows_arg(arg: &str) -> String {
    if !arg.is_empty() && !arg.contains([' ', '\t', '"']) {
        return arg.to_string();
    }
    let mut out = String::with_capacity(arg.len() + 2);
    out.push('"');
    let mut backslashes = 0usize;
    for c in arg.chars() {
        match c {
            '\\' => backslashes += 1,
            '"' => {
                for _ in 0..(backslashes * 2 + 1) {
                    out.push('\\');
                }
                out.push('"');
                backslashes = 0;
            }
            _ => {
                for _ in 0..backslashes {
                    out.push('\\');
                }
                backslashes = 0;
                out.push(c);
            }
        }
    }
    for _ in 0..(backslashes * 2) {
        out.push('\\');
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn frame_roundtrip_preserves_type_and_payload() {
        let mut buf = Vec::new();
        write_frame(&mut buf, MSG_DATA, b"hello").unwrap();
        write_frame(&mut buf, MSG_WRITE, b"").unwrap();
        write_frame(&mut buf, MSG_EOF, &[1, 2, 3]).unwrap();

        let mut cur = Cursor::new(buf);
        assert_eq!(read_frame(&mut cur).unwrap(), Some((MSG_DATA, b"hello".to_vec())));
        assert_eq!(read_frame(&mut cur).unwrap(), Some((MSG_WRITE, Vec::new())));
        assert_eq!(read_frame(&mut cur).unwrap(), Some((MSG_EOF, vec![1, 2, 3])));
        assert_eq!(read_frame(&mut cur).unwrap(), None);
    }

    #[test]
    fn read_frame_on_empty_stream_returns_none() {
        let mut cur = Cursor::new(Vec::new());
        assert_eq!(read_frame(&mut cur).unwrap(), None);
    }

    #[test]
    fn read_frame_truncated_payload_errors() {
        // Header claims 10 bytes but only 2 are present.
        let mut buf = vec![MSG_DATA];
        buf.extend_from_slice(&10u32.to_be_bytes());
        buf.extend_from_slice(b"ab");
        let mut cur = Cursor::new(buf);
        let err = read_frame(&mut cur).unwrap_err();
        assert_eq!(err.kind(), ErrorKind::UnexpectedEof);
    }

    #[test]
    fn read_frame_rejects_oversized_length_header() {
        let mut buf = vec![MSG_DATA];
        buf.extend_from_slice(&((MAX_FRAME_PAYLOAD as u32) + 1).to_be_bytes());
        let mut cur = Cursor::new(buf);
        let err = read_frame(&mut cur).unwrap_err();
        assert_eq!(err.kind(), ErrorKind::InvalidData);
    }

    #[test]
    fn resize_payload_roundtrip() {
        let payload = encode_resize_payload(24, 80);
        assert_eq!(decode_resize_payload(&payload), Some((24, 80)));
        let payload = encode_resize_payload(u16::MAX, 1);
        assert_eq!(decode_resize_payload(&payload), Some((u16::MAX, 1)));
    }

    #[test]
    fn resize_payload_decode_rejects_wrong_length() {
        assert_eq!(decode_resize_payload(&[]), None);
        assert_eq!(decode_resize_payload(&[0, 1, 2]), None);
        assert_eq!(decode_resize_payload(&[0, 1, 2, 3, 4]), None);
    }

    #[test]
    fn quote_windows_arg_leaves_simple_args_untouched() {
        assert_eq!(quote_windows_arg("powershell.exe"), "powershell.exe");
        assert_eq!(quote_windows_arg("-NoLogo"), "-NoLogo");
        assert_eq!(quote_windows_arg(r"\\.\pipe\xsterm-elevated-1"), r"\\.\pipe\xsterm-elevated-1");
    }

    #[test]
    fn quote_windows_arg_quotes_spaces_and_empty() {
        assert_eq!(quote_windows_arg(""), "\"\"");
        assert_eq!(quote_windows_arg("C:\\Program Files\\Git\\bin\\bash.exe"), "\"C:\\Program Files\\Git\\bin\\bash.exe\"");
        assert_eq!(quote_windows_arg("a b"), "\"a b\"");
    }

    #[test]
    fn quote_windows_arg_escapes_embedded_quotes_and_backslashes() {
        // No whitespace or quotes: no quoting needed, trailing backslash is literal.
        assert_eq!(quote_windows_arg("a\\"), "a\\");
        // `a"b` -> `"a\"b"`
        assert_eq!(quote_windows_arg("a\"b"), "\"a\\\"b\"");
        // Backslash run before an embedded quote: `a\"` -> `"a\\\""`
        assert_eq!(quote_windows_arg("a\\\""), "\"a\\\\\\\"\"");
        // Trailing backslashes are doubled before the closing quote: `a b\` -> `"a b\\"`
        assert_eq!(quote_windows_arg("a b\\"), "\"a b\\\\\"");
    }
}
