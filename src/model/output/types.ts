/**
 * Output domain — runtime PTY/SSH/tmux output frame shapes.
 *
 * **Scope**
 * - `ParsedSessionOutput` — decoded `session-output` Tauri event frame.
 *
 * **Out of scope** (lives in `infra/buffers/`):
 * - Binary wire format (`sessionOutputFrame.ts`) — owned by `infra`.
 * - Per-session output buffer (`sessionOutputBuffer.ts`) — owned by
 *   `infra`. The model layer would only see this via an
 *   `OutputRepository` interface in a future phase.
 */

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
