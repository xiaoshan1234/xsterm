/**
 * killTmuxPane — kill a tmux pane via `kill_tmux_pane`. The frontend
 * state update is driven by the `tmux-pane-removed` listener.
 */
import * as tmuxTauri from "../../infra/tauri/commands/tmux";

export function killTmuxPane(xstermSessionId: number): Promise<void> {
  return tmuxTauri.killTmuxPane(xstermSessionId);
}
