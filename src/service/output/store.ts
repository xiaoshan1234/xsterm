/**
 * Output service store — session-output buffer registry.
 *
 * **Scope**: the per-session scrollback cache lives in
 * `infra/buffers/sessionOutputBuffer.ts` (the actual data). This
 * store only holds the metadata + flags: which session's buffer
 * has unsynced output, which session was most recently viewed,
 * and which session is currently "muted" for output routing.
 *
 * No state is needed in Commit 3 — the existing infra buffer is
 * the source of truth. The store exists so future mutations
 * (e.g. muting a session's output during a paste burst) have a
 * stable action surface.
 */
import { create } from "zustand";

export interface OutputStoreState {
  /**
   * Currently active (focused) session id. Used by the bridge to
   * decide whether to forward a `session-output` event to the
   * global append-buffer or skip it (when the buffer is consumed
   * live by xterm.js anyway).
   */
  activeSessionId: number | null;
  setActiveSessionId: (id: number | null) => void;

  /** Set of session ids whose buffers have pending writes. */
  dirtySessionIds: Set<number>;
  markDirty: (id: number) => void;
  markClean: (id: number) => void;

  reset: () => void;
}

export const useOutputStore = create<OutputStoreState>((set, get) => ({
  activeSessionId: null,
  setActiveSessionId: (id) => set({ activeSessionId: id }),

  dirtySessionIds: new Set(),
  markDirty: (id) => {
    const next = new Set(get().dirtySessionIds);
    next.add(id);
    set({ dirtySessionIds: next });
  },
  markClean: (id) => {
    const current = get().dirtySessionIds;
    if (!current.has(id)) return;
    const next = new Set(current);
    next.delete(id);
    set({ dirtySessionIds: next });
  },

  reset: () => set({ activeSessionId: null, dirtySessionIds: new Set() }),
}));
