/**
 * Tauri-backed implementation of `model/session.SessionRepository`.
 *
 * Wraps the existing `infra/tauri/commands/sessions.ts` `invoke()`
 * functions behind the model-defined `SessionRepository` interface so
 * the model layer (and tests) can consume the same surface without
 * importing from `infra/*` directly.
 *
 * **Coexistence**: this object is added alongside the legacy
 * function exports (`createSession`, `closeSession`, …); no existing
 * call site is migrated in Phase 2 — Phase 3 lands the active
 * `SessionModel` and switches bridges / use cases over.
 */
import { invoke } from "@tauri-apps/api/core";
import type { SessionRepository } from "../../../model/session/repository";
import type { SessionInfo, SessionType } from "../../../model/session/types";
import { logger } from "../../logger/logger";

export const tauriSessionRepository: SessionRepository = {
  async list(): Promise<SessionInfo[]> {
    return invoke<SessionInfo[]>("list_sessions");
  },

  async create(input: SessionType): Promise<SessionInfo> {
    logger.debug("sessionRepo", "create", { input });
    const result = await invoke<SessionInfo>("create_session", { config: input });
    logger.debug("sessionRepo", "create:result", result);
    return result;
  },

  async close(id: number): Promise<void> {
    logger.debug("sessionRepo", "close", { id });
    await invoke("close_session", { sessionId: id });
    logger.debug("sessionRepo", "close:result", undefined);
  },

  // Fire-and-forget keystroke writes mirror the existing wrappers:
  // rAF batching lives in Terminal.tsx (Perf 003), so awaiting each IPC
  // would defeat the batching. Errors are logged but not thrown.
  write(id, data) {
    return invoke("write_session", { sessionId: id, data }).then(
      () => undefined,
      (e) => {
        console.error("[xsterm] write_session failed:", e);
      },
    );
  },

  async resizePty(id, rows, cols) {
    logger.debug("sessionRepo", "resizePty", { id, rows, cols });
    await invoke("resize_pty_session", { sessionId: id, rows, cols });
  },

  async resizeSsh(id, rows, cols) {
    logger.debug("sessionRepo", "resizeSsh", { id, rows, cols });
    await invoke("resize_ssh_session", { sessionId: id, rows, cols });
  },

  async resizeTmuxPane(controllerId, tmuxPaneId, rows, cols) {
    logger.debug("sessionRepo", "resizeTmuxPane", {
      controllerId,
      tmuxPaneId,
      rows,
      cols,
    });
    await invoke("resize_tmux_pane", { controllerId, tmuxPaneId, rows, cols });
  },

  async uploadImageToSsh(id, filename, data) {
    logger.debug("sessionRepo", "uploadImageToSsh", {
      id,
      filename,
      dataSize: data.length,
    });
    const result = await invoke<string>("upload_image_to_ssh_session", {
      sessionId: id,
      filename,
      data,
    });
    return result;
  },
};
