/**
 * Tmux service store — tmux-side derived state.
 *
 * **Scope**: per-controller config / window-list caches that the
 * tmuxBridge writes to and the retry-banner + windows-control UI
 * reads from. The session-store keeps its own
 * `tmuxControllerErrors` map (the retry-banner needs a single
 * lookup path through `useSession()`); this store is the
 * "persistence" / "derived cache" slice — the place where the
 * controller-id → config / window-list mappings live so the
 * tmuxBridge can write without going through `session:*` actions
 * for purely tmux-side state.
 *
 * **Service isolation**: `service/tmux/store.ts` does NOT import
 * from `service/session/store.ts`. The bridge layer is the only
 * place that fans tmux events out to multiple stores.
 *
 * **Stub actions** are filled in by Commit 4.
 */
import { create } from "zustand";
import type { TmuxCcConfig, TmuxWindowListEntry } from "../../model";

export interface TmuxStoreState {
  /** `controllerId → TmuxCcConfig` (proxy — kept in sync with session store). */
  tmuxControllerConfigs: Map<number, TmuxCcConfig>;
  setTmuxControllerConfigs: (
    next: Map<number, TmuxCcConfig> | ((p: Map<number, TmuxCcConfig>) => Map<number, TmuxCcConfig>),
  ) => void;
  /** `controllerId → TmuxWindowListEntry[]` (the windows-control cache). */
  tmuxWindowLists: Map<number, TmuxWindowListEntry[]>;
  setTmuxWindowLists: (
    next:
      | Map<number, TmuxWindowListEntry[]>
      | ((p: Map<number, TmuxWindowListEntry[]>) => Map<number, TmuxWindowListEntry[]>),
  ) => void;

  rememberControllerConfig: (controllerId: number, config: TmuxCcConfig) => void;
  forgetControllerConfig: (controllerId: number) => void;
  rememberWindowList: (controllerId: number, entries: TmuxWindowListEntry[]) => void;
  upsertWindowListEntry: (controllerId: number, entry: TmuxWindowListEntry) => void;
  removeWindowListEntry: (controllerId: number, tmuxWindowId: string) => void;
  renameWindowListEntry: (controllerId: number, tmuxWindowId: string, name: string) => void;
  reset: () => void;
}

const initialConfigs = new Map<number, TmuxCcConfig>();
const initialWindows = new Map<number, TmuxWindowListEntry[]>();

export const useTmuxStore = create<TmuxStoreState>((set, get) => ({
  tmuxControllerConfigs: initialConfigs,
  setTmuxControllerConfigs: (next) => {
    set((state) => ({
      tmuxControllerConfigs:
        typeof next === "function"
          ? (next as (p: Map<number, TmuxCcConfig>) => Map<number, TmuxCcConfig>)(
              state.tmuxControllerConfigs,
            )
          : next,
    }));
  },
  tmuxWindowLists: initialWindows,
  setTmuxWindowLists: (next) => {
    set((state) => ({
      tmuxWindowLists:
        typeof next === "function"
          ? (next as (p: Map<number, TmuxWindowListEntry[]>) => Map<number, TmuxWindowListEntry[]>)(
              state.tmuxWindowLists,
            )
          : next,
    }));
  },

  rememberControllerConfig: (controllerId, config) => {
    const state = get();
    const next = new Map(state.tmuxControllerConfigs);
    next.set(controllerId, config);
    set({ tmuxControllerConfigs: next });
  },
  forgetControllerConfig: (controllerId) => {
    const state = get();
    if (!state.tmuxControllerConfigs.has(controllerId)) return;
    const next = new Map(state.tmuxControllerConfigs);
    next.delete(controllerId);
    set({ tmuxControllerConfigs: next });
  },
  rememberWindowList: (controllerId, entries) => {
    const state = get();
    const next = new Map(state.tmuxWindowLists);
    next.set(controllerId, entries);
    set({ tmuxWindowLists: next });
  },
  upsertWindowListEntry: (controllerId, entry) => {
    const state = get();
    const existing = state.tmuxWindowLists.get(controllerId) ?? [];
    const filtered = existing.filter((e) => e.tmuxWindowId !== entry.tmuxWindowId);
    const next = new Map(state.tmuxWindowLists);
    next.set(controllerId, [...filtered, entry]);
    set({ tmuxWindowLists: next });
  },
  removeWindowListEntry: (controllerId, tmuxWindowId) => {
    const state = get();
    const existing = state.tmuxWindowLists.get(controllerId);
    if (!existing) return;
    const filtered = existing.filter((e) => e.tmuxWindowId !== tmuxWindowId);
    const next = new Map(state.tmuxWindowLists);
    if (filtered.length === 0) {
      next.delete(controllerId);
    } else {
      next.set(controllerId, filtered);
    }
    set({ tmuxWindowLists: next });
  },
  renameWindowListEntry: (controllerId, tmuxWindowId, name) => {
    const state = get();
    const existing = state.tmuxWindowLists.get(controllerId);
    if (!existing) return;
    const renamed = existing.map((e) => (e.tmuxWindowId === tmuxWindowId ? { ...e, name } : e));
    const next = new Map(state.tmuxWindowLists);
    next.set(controllerId, renamed);
    set({ tmuxWindowLists: next });
  },
  reset: () => {
    set({
      tmuxControllerConfigs: new Map(),
      tmuxWindowLists: new Map(),
    });
  },
}));
