/**
 * Tauri-backed implementation of `model/tmux.TmuxRepository`.
 *
 * Wraps the existing `infra/tauri/commands/tmux.ts` `invoke()`
 * functions behind the model-defined `TmuxRepository` interface so
 * the tmux model layer (and tests) can consume the same surface
 * without importing from `infra/*` directly.
 *
 * **Coexistence**: this object is added alongside the legacy
 * function exports (`createTmux`, `attachTmux`, …); no existing call
 * site is migrated in Phase 2 — Phase 3 lands the active `TmuxModel`
 * and switches bridges / use cases over.
 */
import { invoke } from "@tauri-apps/api/core";
import type { TmuxRepository } from "../../../model/tmux/repository";
import type {
  TmuxAttachmentRecord,
  AutoAttachOutcome,
  TmuxSessionInit,
} from "../../../model/tmux/types";
import type { SessionInfo, TmuxCcConfig } from "../../../model/session/types";
import { logger } from "../../logger/logger";

export const tauriTmuxRepository: TmuxRepository = {
  async create(config: TmuxCcConfig): Promise<TmuxSessionInit> {
    logger.debug("tmuxRepo", "create", { config });
    const result = await invoke<TmuxSessionInit>("create_tmux_session", {
      config,
    });
    logger.debug("tmuxRepo", "create:result", {
      windows: result.windows.length,
      panes: result.panes.length,
    });
    return result;
  },

  async attach(config: TmuxCcConfig): Promise<TmuxSessionInit> {
    logger.debug("tmuxRepo", "attach", { config });
    const result = await invoke<TmuxSessionInit>("attach_tmux_session", {
      config,
    });
    logger.debug("tmuxRepo", "attach:result", {
      windows: result.windows.length,
      panes: result.panes.length,
    });
    return result;
  },

  async probeSessionExists(config: TmuxCcConfig): Promise<boolean> {
    logger.debug("tmuxRepo", "probeSessionExists", { config });
    const result = await invoke<boolean>("probe_tmux_session_exists", {
      config,
    });
    return result;
  },

  async capturePane(controllerId, tmuxPaneId, lines) {
    logger.debug("tmuxRepo", "capturePane", { controllerId, tmuxPaneId, lines });
    const result = await invoke<string>("capture_tmux_pane", {
      controllerId,
      tmuxPaneId,
      lines,
    });
    return result;
  },

  async listAttachedServers(): Promise<TmuxAttachmentRecord[]> {
    return invoke<TmuxAttachmentRecord[]>("get_attached_tmux_servers");
  },

  async autoAttachServers(): Promise<AutoAttachOutcome[]> {
    return invoke<AutoAttachOutcome[]>("auto_attach_tmux_servers");
  },

  async splitPane(
    controllerId: number,
    parentTmuxPaneId: string,
    direction: "horizontal" | "vertical",
  ): Promise<SessionInfo> {
    logger.debug("tmuxRepo", "splitPane", {
      controllerId,
      parentTmuxPaneId,
      direction,
    });
    const result = await invoke<SessionInfo>("create_tmux_pane", {
      controllerId,
      parentTmuxPaneId,
      direction,
    });
    return result;
  },

  async killPane(controllerId: number, tmuxPaneId: string): Promise<void> {
    logger.debug("tmuxRepo", "killPane", { controllerId, tmuxPaneId });
    await invoke("kill_tmux_pane", { controllerId, tmuxPaneId });
  },

  async createWindow(controllerId: number, name?: string): Promise<SessionInfo> {
    logger.debug("tmuxRepo", "createWindow", { controllerId, name });
    const result = await invoke<SessionInfo>("create_tmux_window", {
      controllerId,
      name,
    });
    return result;
  },

  async killWindow(controllerId: number, tmuxWindowId: string): Promise<void> {
    logger.debug("tmuxRepo", "killWindow", { controllerId, tmuxWindowId });
    await invoke("kill_tmux_window", { controllerId, tmuxWindowId });
  },

  async renameWindow(controllerId: number, tmuxWindowId: string, name: string): Promise<void> {
    logger.debug("tmuxRepo", "renameWindow", {
      controllerId,
      tmuxWindowId,
      name,
    });
    await invoke("rename_tmux_window", { controllerId, tmuxWindowId, name });
  },

  async detachController(controllerId: number): Promise<void> {
    logger.debug("tmuxRepo", "detachController", { controllerId });
    await invoke("detach_tmux_controller", { controllerId });
  },

  async killServer(controllerId: number): Promise<void> {
    logger.debug("tmuxRepo", "killServer", { controllerId });
    await invoke("kill_server_via_controller", { controllerId });
  },

  async unmarkAttached(controllerId: number): Promise<void> {
    logger.debug("tmuxRepo", "unmarkAttached", { controllerId });
    await invoke("unmark_attached_tmux", { controllerId });
  },
};
