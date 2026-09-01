/**
 * Binary wire format for `session-output` — JS-side decoder.
 *
 * Mirrors `src-tauri/src/infrastructure/binary_frame.rs` (Perf 001).
 *
 * Layout, 10-byte header plus payload:
 *
 *   0    1    2..5            6..9
 * +----+----+---------------+--------------+================+
 * |A1  |01  | session_id BE | payload_len BE|    payload     |
 * +----+----+---------------+--------------+================+
 *
 * Big-endian chosen so the framing is byte-order independent for
 * cross-platform transport (x86 / ARM).
 */

export const FRAME_MAGIC = 0xa1;
export const FRAME_VERSION = 0x01;
export const HEADER_LEN = 10;

export interface ParsedSessionOutput {
  sessionId: number;
  data: Uint8Array;
}

/**
 * Parse a binary `session-output` frame. Returns `null` for a malformed
 * frame: short buffer, wrong magic, unknown version, or declared length
 * exceeding the actual buffer. The caller is expected to drop the chunk
 * in that case (a protocol violation should never be silently accepted).
 */
export function parseSessionOutputFrame(frame: Uint8Array): ParsedSessionOutput | null {
  if (frame.byteLength < HEADER_LEN) return null;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  if (view.getUint8(0) !== FRAME_MAGIC || view.getUint8(1) !== FRAME_VERSION) {
    return null;
  }
  const sessionId = view.getUint32(2, false);
  const payloadLen = view.getUint32(6, false);
  if (frame.byteLength < HEADER_LEN + payloadLen) return null;
  const data = new Uint8Array(
    frame.buffer,
    frame.byteOffset + HEADER_LEN,
    payloadLen,
  );
  return { sessionId, data };
}