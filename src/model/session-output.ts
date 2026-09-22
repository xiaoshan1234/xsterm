/**
 * Parsed `session-output` frame.
 *
 * Mirrors the binary wire format decoded by
 * `infra/buffers/sessionOutputFrame.ts` (Perf 001). The 10-byte header
 * carries a magic byte, a version byte, the session id (BE u32), and
 * the payload length (BE u32); `data` is a Uint8Array slice into the
 * original buffer.
 */
export interface ParsedSessionOutput {
  sessionId: number;
  data: Uint8Array;
}
