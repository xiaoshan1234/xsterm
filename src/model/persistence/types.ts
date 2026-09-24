/**
 * Persistence domain — on-disk shapes persisted via
 * `tauri-plugin-store` (`sessions.json`).
 *
 * **Scope**
 * - `PersistedSessionConfig` — `PersistedSessionConfig` extends the runtime
 *   `SessionInput` (from `../session`) with the persisted
 *   `id` / `name` / `version` envelope.
 * - `SessionGroup` — sidebar grouping of saved configs.
 * - `PersistedWindow` / `PersistedWindowConfig` — frozen window snapshot;
 *   legacy alias `PersistedWindowConfig` is preserved.
 * - `PersistedWorkspace` — frozen workspace snapshot (a `PersistedWindow[]`).
 *
 * **Out of scope** (sibling domains):
 * - `SessionInput` / `LocalSessionConfig` / etc. — runtime input
 *   shapes, live in `../session`.
 * - `PersistedPaneNode` — frozen pane tree, lives in `../pane`.
 * - `TmuxAttachmentRecord` — per-controller tmux attach record, lives in
 *   `../tmux`.
 *
 * **Why persistence has its own domain (not the runtime domains)**
 * The on-disk envelope (`id` / `name` / `version`) is conceptually
 * distinct from the runtime input it carries. Mixing them
 * (`session-config.ts` did this historically) makes it easy for
 * migrations and runtime updates to drift out of sync.
 */
import type { PersistedPaneNode } from "../pane";
import type { SessionInput, SessionDisplayConfig, SessionType } from "../session";

/**
 * Persisted shape of a user-saved session config. Adds `id` / `name`
 * / `version` over `SessionInput` (the version drives the
 * `migrateSavedConfig` matrix in `infra/store/migrations.ts`).
 */
export type PersistedSessionConfig = {
  id: string;
  name: string;
  version: number;
} & SessionInput & {
    /**
     * Inlined SessionDisplayConfig (per-session visual config).
     * The field set is identical to the runtime one — see
     * `../session.SessionDisplayConfig` for the full schema. Kept
     * inline here to avoid a cycle through `../session`.
     */
    displayConfig?: SessionDisplayConfig;
  };

/** A group of saved session configs in the sidebar. */
export interface SessionGroup {
  id: number;
  name: string;
  /** Ids of `PersistedSessionConfig`s in this group. */
  configIds: string[];
  /** Whether the group is collapsed in the sidebar. */
  collapsed: boolean;
}

/**
 * Frozen window stored in `PersistedWorkspace`. Mirrors `Window` but without
 * runtime-only fields (`activePaneId`, tmux handles).
 */
export interface PersistedWindow {
  id: string;
  name: string;
  rootPane: PersistedPaneNode;
}

/**
 * Legacy alias for `PersistedWindow`. Older code paths (especially
 * `service/legacy/contexts/session/types.ts` and the persistence
 * store) imported `PersistedWindowConfig` from `./persistence` /
 * `./window-config`. The current canonical name is `PersistedWindow`;
 * this alias preserves the old import surface.
 */
export type PersistedWindowConfig = PersistedWindow;

export interface PersistedWorkspace {
  id: string;
  name: string;
  windows: PersistedWindow[];
}

/** Convenience re-export so older callers can still `import { SessionType } from "../model/persistence"`. */
export type { SessionType };
