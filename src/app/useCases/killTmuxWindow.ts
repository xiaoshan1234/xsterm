/**
 * killTmuxWindow — kill a tmux server-side window via
 * `kill_tmux_window`. The frontend state update is driven by the
 * `tmux-window-closed` listener.
 */
import * as tmuxTauri from "../../infra/tauri/commands/tmux";

export function killTmuxWindow(xstermWindowId: number): Promise<void> {
  return tmuxTauri.killTmuxWindow(xstermWindowId);
}
