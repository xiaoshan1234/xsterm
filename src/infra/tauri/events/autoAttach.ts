import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AutoAttachOutcome } from "../commands/tmux";

/**
 * Subscribe to the `auto-attach-tmux-servers` Tauri event.
 *
 * Each emission carries one `AutoAttachOutcome` row (one per persisted
 * `attached_tmux.json` entry). The backend emits one event per outcome
 * so the frontend can stream progress to the UI as the startup-time
 * auto-attach sweep runs; the same data is also available as a single
 * array via the `auto_attach_tmux_servers` Tauri command (see
 * `infra/tauri/commands/tmux.autoAttachTmuxServers`).
 */
export function subscribeAutoAttachOutcome(
  handler: (outcome: AutoAttachOutcome) => void,
): Promise<UnlistenFn> {
  return listen<AutoAttachOutcome>("auto-attach-tmux-servers", (e) => handler(e.payload));
}
