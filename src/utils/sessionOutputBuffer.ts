/**
 * Raw output buffer for each session.
 * Used to restore terminal content when a pane is split/remounted, preventing loss of historical output.
 *
 * Per-session size is capped at MAX_BUFFER_BYTES. On overflow the buffer is
 * truncated at the next line boundary past the cap so the newest lines survive
 * intact and ANSI sequences are not split mid-stream. See
 * doc/maintenance/perf.md Perf 009.
 */

const MAX_BUFFER_BYTES = 4 * 1024 * 1024; // 4 MB per session

const buffers = new Map<number, string>();

export function appendSessionOutput(sessionId: number, data: string): void {
  const combined = (buffers.get(sessionId) ?? "") + data;
  if (combined.length > MAX_BUFFER_BYTES) {
    // Drop oldest content at the next line boundary to keep ANSI sequences intact.
    const overflow = combined.length - MAX_BUFFER_BYTES;
    const sliceFrom = combined.indexOf("\n", overflow);
    buffers.set(
      sessionId,
      sliceFrom === -1 ? combined.slice(-MAX_BUFFER_BYTES) : combined.slice(sliceFrom + 1),
    );
  } else {
    buffers.set(sessionId, combined);
  }
}

export function getSessionOutput(sessionId: number): string | undefined {
  return buffers.get(sessionId);
}

export function clearSessionOutput(sessionId: number): void {
  buffers.delete(sessionId);
}

export function hasSessionOutput(sessionId: number): boolean {
  return buffers.has(sessionId);
}
