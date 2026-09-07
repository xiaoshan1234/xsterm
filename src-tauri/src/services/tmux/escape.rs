//! Octal escape codec for the tmux `-CC` wire format.
//!
//! When tmux prints binary-ish bytes (e.g. ANSI escape sequences, control
//! characters, or a literal backslash) inside a `%output` / `%extended-output`
//! line, it escapes them as `\nnn` — three octal digits. Bytes that are safe
//! to print as-is pass through verbatim.
//!
//! Both directions live here so that the parser and the `send-keys`
//! command builder share the exact same encoding rules and a single
//! round-trip test can lock both down.
//!
//! tmux 3.x escapes the set `< 0x20 || > 0x7E || == 0x5C`. We mirror that
//! exactly so an `escape → unescape → escape` triple round-trips byte-for-byte
//! through the protocol regardless of which side of the channel produced the
//! data.

use std::fmt::Write as _;

/// Decode a tmux-encoded line back into raw bytes.
///
/// When the function sees a `\` followed by three octal digits, it emits the
/// byte they represent and advances by 4. Any other `\` (e.g. `\12` with only
/// two digits, or `\xyz` with non-octal characters) is emitted **literally**
/// and the parser advances by one byte. This matches tmux's own decoder
/// behaviour and ensures that malformed sequences never abort the parser.
pub fn unescape_output(s: &str) -> Vec<u8> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' && i + 3 < bytes.len() {
            let d1 = bytes[i + 1];
            let d2 = bytes[i + 2];
            let d3 = bytes[i + 3];
            if is_octal_byte(d1) && is_octal_byte(d2) && is_octal_byte(d3) {
                let value = (d1 - b'0') * 64 + (d2 - b'0') * 8 + (d3 - b'0');
                out.push(value);
                i += 4;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    out
}

/// Encode raw bytes into a tmux-encoded string.
///
/// Inverts [`unescape_output`] byte-for-byte. Control bytes, backslash, and
/// any non-ASCII byte (≥ 0x80) are emitted as 3-digit octal escapes; the
/// remaining printable ASCII bytes are pushed through verbatim.
///
/// This is the exact function used by
/// [`crate::services::tmux::commands::send_keys`]. Callers that need
/// to embed arbitrary UTF-8 text should send it through `escape_output`
/// first so tmux's decoder sees the same `\nnn` sequences we encode here.
pub fn escape_output(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len());
    for &b in bytes {
        if b < 0x20 || b == 0x5C || b >= 0x80 {
            write!(&mut out, "\\{:03o}", b).expect("writing to String never fails");
        } else {
            out.push(b as char);
        }
    }
    out
}

#[inline]
fn is_octal_byte(b: u8) -> bool {
    (b'0'..=b'7').contains(&b)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_escape(input: &[u8], expected: &str) {
        assert_eq!(escape_output(input), expected);
    }

    fn assert_unescape(input: &str, expected: &[u8]) {
        assert_eq!(unescape_output(input), expected);
    }

    #[test]
    fn unescape_empty() {
        assert_unescape("", b"");
    }

    #[test]
    fn unescape_passthrough_printable() {
        assert_unescape("hello world!", b"hello world!");
    }

    #[test]
    fn unescape_backslash_literal() {
        // `\xy` is not a valid octal escape — `\` is kept literal.
        assert_unescape("\\xy", b"\\xy");
    }

    #[test]
    fn unescape_two_digit_octal_leaves_literal() {
        assert_unescape("\\12", b"\\12");
    }

    #[test]
    fn unescape_three_octal_digits_decodes() {
        assert_unescape("\\012", &[0o012]);
        assert_unescape("\\134", &[0o134]);
        assert_unescape("\\000", &[0o000]);
        assert_unescape("\\037", &[0o037]);
    }

    #[test]
    fn unescape_mixed_escapes_and_text() {
        assert_unescape("hello\\012world\\134!", b"hello\nworld\\!");
    }

    #[test]
    fn unescape_unicode_pass_through() {
        assert_unescape("中文", "中文".as_bytes());
        assert_unescape("🐱", "🐱".as_bytes());
    }

    #[test]
    fn unescape_high_bit_octal() {
        // tmux 3.x may emit `\200` for high-bit bytes; our decoder
        // understands them (0o200 == 128).
        assert_unescape("\\200", &[0o200]);
    }

    #[test]
    fn unescape_trailing_incomplete_escape() {
        assert_unescape("a\\12", b"a\\12");
        assert_unescape("a\\", b"a\\");
    }

    #[test]
    fn escape_empty() {
        assert_escape(b"", "");
    }

    #[test]
    fn escape_passthrough_printable() {
        assert_escape(b"hello", "hello");
    }

    #[test]
    fn escape_control_bytes() {
        assert_escape(&[0x00], "\\000");
        assert_escape(&[0x01], "\\001");
        assert_escape(&[0x1F], "\\037");
    }

    #[test]
    fn escape_backslash() {
        assert_escape(b"\\", "\\134");
    }

    #[test]
    fn escape_mixed() {
        assert_escape(b"hello\nworld", "hello\\012world");
        assert_escape(b"a\\b", "a\\134b");
        assert_escape(b"\x00\x01\x02", "\\000\\001\\002");
    }

    #[test]
    fn escape_high_bit_byte() {
        // A non-ASCII byte is escaped to octal so the resulting string
        // remains valid ASCII.
        assert_escape(&[0xC3], "\\303");
    }

    #[test]
    fn round_trip_empty() {
        let input: &[u8] = b"";
        let encoded = escape_output(input);
        assert_eq!(unescape_output(&encoded), input);
    }

    #[test]
    fn round_trip_single_byte_each_class() {
        for &b in &[
            0x00u8, 0x01, 0x09, 0x0A, 0x0D, 0x1F, 0x20, 0x21, 0x5B, 0x5C, 0x5D, 0x7E, 0x7F, 0x80,
            0xFF,
        ] {
            let encoded = escape_output(&[b]);
            let decoded = unescape_output(&encoded);
            assert_eq!(
                decoded,
                vec![b],
                "byte 0x{:02X} round-trip failed (encoded={:?})",
                b,
                encoded
            );
        }
    }

    #[test]
    fn round_trip_printable_ascii() {
        let input = b"The quick brown fox jumps over the lazy dog.";
        let encoded = escape_output(input);
        let decoded = unescape_output(&encoded);
        assert_eq!(decoded, input);
    }

    #[test]
    fn round_trip_chinese_utf8() {
        let input = "中文 hello \n \\ back".as_bytes();
        let encoded = escape_output(input);
        let decoded = unescape_output(&encoded);
        assert_eq!(decoded, input);
    }

    #[test]
    fn round_trip_long_buffer() {
        let mut input = Vec::with_capacity(16 * 1024);
        for i in 0u32..(16 * 1024) {
            let b = ((i.wrapping_mul(2654435761)) & 0xFF) as u8;
            input.push(b);
        }
        let encoded = escape_output(&input);
        let decoded = unescape_output(&encoded);
        assert_eq!(decoded, input);
    }

    #[test]
    fn round_trip_all_bytes_zero_to_255() {
        let input: Vec<u8> = (0u8..=255).collect();
        let encoded = escape_output(&input);
        let decoded = unescape_output(&encoded);
        assert_eq!(decoded, input);
    }
}
