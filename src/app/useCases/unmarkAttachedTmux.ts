/**
 * unmarkAttachedTmux — remove a controller's entry from the persisted
 * `attached_tmux.json` so the next startup does not auto-attach it.
 */
import * as tmuxTauri from "../../infra/tauri/commands/tmux";

export function unmarkAttachedTmux(controllerId: number): Promise<void> {
  return tmuxTauri.unmarkAttachedTmux(controllerId);
}