/**
 * Session domain — event subscription contract.
 *
 * Mirrors the surface of the existing
 * `infra/tauri/events/{sessionOutput,sessionClosed}.ts` listeners,
 * but typed so the model can subscribe without importing Tauri
 * directly. The `tmux-pane-*` / `session-disconnected` events live in
 * `../tmux/events.ts` because they are tmux-shaped payloads, not
 * generic session ones.
 *
 * Returns an `Unsubscribe` callable that the model invokes on
 * cleanup. The Tauri implementation in `infra/tauri/eventBuses.ts`
 * resolves to the same `() => void` shape.
 */

export type Unsubscribe = () => void;

/**
 * Raw PTY/SSH/tmux output frames pushed by the backend.
 *
 * The first event arg is the pre-parsed payload (`sessionId` +
 * `data`) — the legacy channel lived in
 * `infra/buffers/sessionOutputChannel.ts`; the new model doesn't
 * speak bytes-only, it speaks frames.
 */
export type SessionOutputHandler = (sessionId: number, data: Uint8Array) => void;

export type SessionLifecycleHandler = (sessionId: number) => void;

export interface SessionEventBus {
  /** Mirrors `subscribeSessionOutput`. */
  onOutput(handler: SessionOutputHandler): Unsubscribe;

  /** Mirrors `subscribeSessionClosed`. */
  onClosed(handler: SessionLifecycleHandler): Unsubscribe;

  /** Mirrors `subscribeSessionDisconnected` (tmux-flavored variant is on the tmux bus). */
  onDisconnected(handler: SessionLifecycleHandler): Unsubscribe;
}
