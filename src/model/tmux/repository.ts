/**
 * Tmux domain — backend-side data access contract for tmux -CC IPC.
 *
 * **Scope**
 * Defines the surface the `TmuxModel` (Phase 3) uses to talk to the
 * tmux controllers via Tauri commands. The actual implementation
 * lives in `src/infra/tauri/repositories/tmux.ts`.
 *
 * **Why a repository**
 * Same rationale as `SessionRepository`. The TmuxRepository methods
 * mirror the existing `infra/tauri/commands/tmux.ts` exports 1:1.
 */
import type {
  AttachedTmuxServer,
  AutoAttachOutcome,
  TmuxControlWindowInit,
  TmuxPaneInit,
  TmuxSessionInit,
  TmuxWindowInit,
} from "./types";
import type { SessionInfo, TmuxCcConfig } from "../session/index";

export interface TmuxRepository {
  /** Mirrors `createTmux`. */
  create(config: TmuxCcConfig): Promise<TmuxSessionInit>;

  /** Mirrors `attachTmux`. */
  attach(config: TmuxCcConfig): Promise<TmuxSessionInit>;

  /** Mirrors `probeTmuxSessionExists`. */
  probeSessionExists(config: TmuxCcConfig): Promise<boolean>;

  /** Mirrors `captureTmuxPane`. */
  capturePane(controllerId: number, tmuxPaneId: string, lines: number): Promise<string>;

  /** Mirrors `getAttachedTmuxServers`. */
  listAttachedServers(): Promise<AttachedTmuxServer[]>;

  /** Mirrors `autoAttachTmuxServers`. */
  autoAttachServers(): Promise<AutoAttachOutcome[]>;

  /** Mirrors `createTmuxPane`. */
  splitPane(
    controllerId: number,
    parentTmuxPaneId: string,
    direction: "horizontal" | "vertical",
  ): Promise<SessionInfo>;

  /** Mirrors `killTmuxPane`. */
  killPane(controllerId: number, tmuxPaneId: string): Promise<void>;

  /** Mirrors `createTmuxWindow`. */
  createWindow(controllerId: number, name?: string): Promise<SessionInfo>;

  /** Mirrors `killTmuxWindow`. */
  killWindow(controllerId: number, tmuxWindowId: string): Promise<void>;

  /** Mirrors `renameTmuxWindow`. */
  renameWindow(controllerId: number, tmuxWindowId: string, name: string): Promise<void>;

  /** Mirrors `detachTmux`. */
  detachController(controllerId: number): Promise<void>;

  /** Mirrors `killServerViaController`. */
  killServer(controllerId: number): Promise<void>;

  /** Mirrors `unmarkAttachedTmux`. */
  unmarkAttached(controllerId: number): Promise<void>;
}

/** Re-exports for callers that need the initial-state shapes. */
export type {
  AutoAttachOutcome,
  TmuxControlWindowInit,
  TmuxPaneInit,
  TmuxSessionInit,
  TmuxWindowInit,
};
