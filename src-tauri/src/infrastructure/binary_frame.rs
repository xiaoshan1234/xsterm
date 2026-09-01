//! Binary wire format for the `session-output` event.
//!
//! Replaces the historical JSON `[session_id, [byte, byte, ...]]` shape to
//! eliminate per-byte `Number` allocation on the frontend and the ~4× payload
//! expansion of JSON-serialized `Vec<u8>` on the backend (Perf 001).
//!
//! Frame layout, 10-byte header plus payload:
//!
//! ```text
//!   0    1    2..5            6..9
//! +----+----+---------------+--------------+================+
//! |A1  |01  | session_id BE | payload_len BE|    payload     |
//! +----+----+---------------+--------------+================+
//! ```
//!
//! Big-endian chosen so the framing is byte-order independent for cross-
//! platform transport (x86 / ARM).
//!
//! On the JS side the same layout is parsed with a `DataView` and a
//! `Uint8Array` slice — no JSON.parse, no `Number` objects per byte.

/// Magic byte that marks the start of every `session-output` frame.
pub const FRAME_MAGIC: u8 = 0xA1;

/// Current frame version. Bump when the layout changes; decoders must
/// reject frames whose version they don't understand.
pub const FRAME_VERSION: u8 = 0x01;

/// Length of the fixed header (magic + version + session_id + payload_len).
pub const HEADER_LEN: usize = 1 + 1 + 4 + 4;

/// Encode a `(session_id, data)` pair into the binary frame format.
pub fn encode_session_output_frame(session_id: u32, data: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(HEADER_LEN + data.len());
    buf.push(FRAME_MAGIC);
    buf.push(FRAME_VERSION);
    buf.extend_from_slice(&session_id.to_be_bytes());
    buf.extend_from_slice(&(data.len() as u32).to_be_bytes());
    buf.extend_from_slice(data);
    buf
}

/// Decode the frame header. Returns `(session_id, payload_offset,
/// payload_len)` where `payload_offset == HEADER_LEN` and `payload_len`
/// is the byte length declared by the frame.
///
/// Returns `None` for a malformed header: short buffer, wrong magic, or a
/// version we don't understand. Callers should treat that as a protocol
/// violation and drop the chunk.
pub fn decode_session_output_header(frame: &[u8]) -> Option<(u32, usize, usize)> {
    if frame.len() < HEADER_LEN {
        return None;
    }
    if frame[0] != FRAME_MAGIC || frame[1] != FRAME_VERSION {
        return None;
    }
    let session_id = u32::from_be_bytes([frame[2], frame[3], frame[4], frame[5]]);
    let payload_len =
        u32::from_be_bytes([frame[6], frame[7], frame[8], frame[9]]) as usize;
    Some((session_id, HEADER_LEN, payload_len))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_ascii_payload() {
        let frame = encode_session_output_frame(42, b"hello");
        let (sid, off, len) = decode_session_output_header(&frame).unwrap();
        assert_eq!(sid, 42);
        assert_eq!(off, HEADER_LEN);
        assert_eq!(len, 5);
        assert_eq!(&frame[off..off + len], b"hello");
    }

    #[test]
    fn decoder_rejects_bad_magic_byte() {
        // Only the magic + version bytes are protected header fields. The
        // session_id and payload_len bytes are just metadata — corrupting
        // them changes the values but the frame still parses. (The JS-side
        // parser additionally verifies payload_len fits in the buffer; see
        // `sessionOutputFrame.ts`.)
        let frame = encode_session_output_frame(7, b"abc");
        for (i, label) in [(0_usize, "magic"), (1, "version")] {
            let mut bad = frame.clone();
            bad[i] ^= 0xFF;
            assert!(
                decode_session_output_header(&bad).is_none(),
                "decoder accepted frame with corrupted {label} byte",
            );
        }
    }

    #[test]
    fn roundtrip_empty_payload() {
        let frame = encode_session_output_frame(0, b"");
        assert_eq!(frame.len(), HEADER_LEN);
        let (sid, off, len) = decode_session_output_header(&frame).unwrap();
        assert_eq!(sid, 0);
        assert_eq!(off, HEADER_LEN);
        assert_eq!(len, 0);
    }

    #[test]
    fn rejects_short_buffer() {
        assert!(decode_session_output_header(&[]).is_none());
        assert!(decode_session_output_header(&[0xA1]).is_none());
        assert!(decode_session_output_header(&[0xA1, 0x01, 0, 0, 0]).is_none());
    }

    #[test]
    fn rejects_wrong_magic() {
        let mut frame = encode_session_output_frame(1, b"x");
        frame[0] = 0xFF;
        assert!(decode_session_output_header(&frame).is_none());
    }

    #[test]
    fn rejects_wrong_version() {
        let mut frame = encode_session_output_frame(1, b"x");
        frame[1] = 0x99;
        assert!(decode_session_output_header(&frame).is_none());
    }

    #[test]
    fn roundtrip_large_payload_at_drain_budget_boundary() {
        // 64 KiB matches DRAIN_SIZE_BYTES in local_session.rs — the common
        // emit size. Make sure the encoding doesn't choke at that size.
        let data = vec![0xAB; 64 * 1024];
        let frame = encode_session_output_frame(u32::MAX, &data);
        let (sid, off, len) = decode_session_output_header(&frame).unwrap();
        assert_eq!(sid, u32::MAX);
        assert_eq!(len, 64 * 1024);
        assert_eq!(&frame[off..off + len], &data[..]);
    }

    #[test]
    fn roundtrip_session_id_at_max() {
        let frame = encode_session_output_frame(u32::MAX, b"x");
        let (sid, _, _) = decode_session_output_header(&frame).unwrap();
        assert_eq!(sid, u32::MAX);
    }
}