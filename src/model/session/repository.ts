/**
 * Session domain — backend-side data access contract.
 *
 * **Purpose**
 * Define the only surface the `SessionModel` may use to talk to the
 * Tauri backend (or to a fake in tests). The actual implementation
 * lives in `src/infra/tauri/repositories/sessions.ts`; the model never
 * imports from `infra/*` directly.
 *
 * **Why a repository and not raw `invoke`**
 * - Keeps `model/*` free of `@tauri-apps/api/*` imports (boundary rule).
 * - Lets the active `SessionModel` decouple from Tauri IPC — tests can
 *   swap in a `FakeSessionRepository` without stubbing the IPC layer.
 * - Lets Phase 2 land `repository.ts` without changing call sites: the
 *   legacy wrappers in `infra/tauri/commands/sessions.ts` keep
 *   working, and the new object exposes the same operations typed.
 *
 * **Idempotency**: the surface mirrors the existing
 * `infra/tauri/commands/sessions.ts` functions; naming follows the
 * 1:1 map below.
 */
import type { SessionInfo, SessionType } from "./types";

export interface SessionRepository {
  /** Mirrors `list_sessions`. */
  list(): Promise<SessionInfo[]>;

  /** Mirrors `create_session`. */
  create(input: SessionType): Promise<SessionInfo>;

  /** Mirrors `close_session`. */
  close(id: number): Promise<void>;

  /** Mirrors `write_session` (UTF-8 encoded keystroke / paste). */
  write(id: number, data: Uint8Array): Promise<void>;

  /** Mirrors `resize_pty_session`. */
  resizePty(id: number, rows: number, cols: number): Promise<void>;

  /** Mirrors `resize_ssh_session`. */
  resizeSsh(id: number, rows: number, cols: number): Promise<void>;

  /**
   * Mirrors `resize_tmux_pane` — takes the server-side
   * `(controllerId, tmuxPaneId)` pair, no xsterm session id involved.
   */
  resizeTmuxPane(
    controllerId: number,
    tmuxPaneId: string,
    rows: number,
    cols: number,
  ): Promise<void>;

  /** Mirrors `upload_image_to_ssh_session`. */
  uploadImageToSsh(id: number, filename: string, data: number[]): Promise<string>;
}
