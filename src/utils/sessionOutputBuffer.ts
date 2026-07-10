/**
 * 每个 session 的原始输出缓冲区。
 * 用于在 pane 被 split/remount 时恢复终端内容，避免历史输出丢失。
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
