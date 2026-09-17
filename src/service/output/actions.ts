/**
 * Output service — action function surface.
 *
 * **Scope**: output-buffer metadata + active-session focus
 * tracking. The actual scrollback buffer is `infra/buffers/
 * sessionOutputBuffer.ts`; this store just flags which session
 * is active and which buffers have unsynced writes (so the
 * outputBridge can decide whether to forward an event to the
 * UI synchronously or rely on the buffer).
 */
import { useOutputStore, type OutputStoreState } from "./store";

export function setActiveSessionId(id: number | null): void {
  useOutputStore.getState().setActiveSessionId(id);
}

export function markOutputDirty(id: number): void {
  useOutputStore.getState().markDirty(id);
}

export function markOutputClean(id: number): void {
  useOutputStore.getState().markClean(id);
}

export function getActiveSessionId(): number | null {
  return useOutputStore.getState().activeSessionId;
}

export function isOutputDirty(id: number): boolean {
  return useOutputStore.getState().dirtySessionIds.has(id);
}

export function resetOutputService(): void {
  useOutputStore.getState().reset();
}

export function useOutputActions(): Pick<OutputStoreState, "activeSessionId" | "dirtySessionIds"> {
  return useOutputStore((s) => ({
    activeSessionId: s.activeSessionId,
    dirtySessionIds: s.dirtySessionIds,
  }));
}
