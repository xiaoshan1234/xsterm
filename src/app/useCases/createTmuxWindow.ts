/**
 * createTmuxWindow — open a new tmux window on a controller via the
 * `create_tmux_window` command. The matching `Window` row arrives via
 * the `tmux-window-added` listener (idempotent).
 */
import * as tmuxTauri from "../../infra/tauri/commands/tmux";

export function createTmuxWindow(controllerId: number, name?: string): Promise<void> {
  return tmuxTauri.createTmuxWindow(controllerId, name).then(() => undefined);
}
