/**
 * renameTmuxWindow — issue `rename-window`. The frontend state update
 * is driven by the `tmux-window-renamed` listener.
 */
import * as tmuxTauri from "../../infra/tauri/commands/tmux";

export function renameTmuxWindow(xstermWindowId: number, name: string): Promise<void> {
  return tmuxTauri.renameTmuxWindow(xstermWindowId, name);
}