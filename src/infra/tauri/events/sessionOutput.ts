import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Subscribe to the `session-output` Tauri event.
 *
 * Backend payload (per AGENTS.md): `[sessionId: number, data: number[]]`.
 * The callback receives the raw byte array (UTF-8 encoded PTY output).
 *
 * Used by `useTauriTerminalOutput` to stream PTY/SSH/tmux output to the
 * xterm.js terminal. Mirrors the listener body from the legacy
 * `src/hooks/useTauriTerminalOutput.ts` 1:1, minus the React lifecycle.
 *
 * Returns the Tauri unlisten function; callers are responsible for
 * invoking it on cleanup.
 */
export function subscribeSessionOutput(
  handler: (sessionId: number, data: Uint8Array) => void,
): Promise<UnlistenFn> {
  return listen<[number, number[]]>("session-output", (event) => {
    const [id, data] = event.payload;
    handler(id, new Uint8Array(data));
  });
}
