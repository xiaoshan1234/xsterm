/**
 * Persistence domain — on-disk shapes persisted via
 * `tauri-plugin-store` (`sessions.json`).
 *
 * **Scope**
 * - `SavedSessionConfig` — `SavedSessionConfig` extends the runtime
 *   `CreateSessionInput` (from `../session`) with the persisted
 *   `id` / `name` / `version` envelope.
 * - `SessionGroup` — sidebar grouping of saved configs.
 * - `SavedWindow` / `SavedWindowConfig` — frozen window snapshot;
 *   legacy alias `SavedWindowConfig` is preserved.
 * - `SavedWorkspace` — frozen workspace snapshot (a `SavedWindow[]`).
 *
 * **Out of scope** (sibling domains):
 * - `CreateSessionInput` / `LocalSessionConfig` / etc. — runtime input
 *   shapes, live in `../session`.
 * - `SavedPaneNode` — frozen pane tree, lives in `../pane`.
 * - `AttachedTmuxServer` — per-controller tmux attach record, lives in
 *   `../tmux`.
 *
 * **Why persistence has its own domain (not the runtime domains)**
 * The on-disk envelope (`id` / `name` / `version`) is conceptually
 * distinct from the runtime input it carries. Mixing them
 * (`session-config.ts` did this historically) makes it easy for
 * migrations and runtime updates to drift out of sync.
 */
import type { SavedPaneNode } from "../pane";
import type { CreateSessionInput, SessionDisplayConfig, SessionType } from "../session";

/**
 * Persisted shape of a user-saved session config. Adds `id` / `name`
 * / `version` over `CreateSessionInput` (the version drives the
 * `migrateSavedConfig` matrix in `infra/store/migrations.ts`).
 */
export type SavedSessionConfig = {
  id: string;
  name: string;
  version: number;
} & CreateSessionInput & {
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
  /** Ids of `SavedSessionConfig`s in this group. */
  configIds: string[];
  /** Whether the group is collapsed in the sidebar. */
  collapsed: boolean;
}

/**
 * Frozen window stored in `SavedWorkspace`. Mirrors `Window` but without
 * runtime-only fields (`activePaneId`, tmux handles).
 */
export interface SavedWindow {
  id: string;
  name: string;
  rootPane: SavedPaneNode;
}

/**
 * Legacy alias for `SavedWindow`. Older code paths (especially
 * `service/legacy/contexts/session/types.ts` and the persistence
 * store) imported `SavedWindowConfig` from `./persistence` /
 * `./window-config`. The current canonical name is `SavedWindow`;
 * this alias preserves the old import surface.
 */
export type SavedWindowConfig = SavedWindow;

export interface SavedWorkspace {
  id: string;
  name: string;
  windows: SavedWindow[];
}

/** Convenience re-export so older callers can still `import { SessionType } from "../model/persistence"`. */
export type { SessionType };
