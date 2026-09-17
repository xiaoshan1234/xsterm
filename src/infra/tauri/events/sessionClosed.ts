import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Subscribe to the `session-closed` Tauri event.
 *
 * Backend payload: `sessionId: number`. Emitted when a tmux-backed
 * session's underlying tmux child exits (`%session-closed $<id>` on
 * the tmux control-mode protocol stream).
 *
 * Returns the Tauri unlisten function for cleanup.
 */
export function subscribeSessionClosed(handler: (sessionId: number) => void): Promise<UnlistenFn> {
  return listen<number>("session-closed", (event) => {
    handler(event.payload);
  });
}
