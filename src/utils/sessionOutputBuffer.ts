/**
 * Raw output buffer for each session.
 * Used to restore terminal content when a pane is split/remounted, preventing loss of historical output.
 */

const buffers = new Map<number, string>();

export function appendSessionOutput(sessionId: number, data: string): void {
  const current = buffers.get(sessionId) ?? "";
  buffers.set(sessionId, current + data);
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
