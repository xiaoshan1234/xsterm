/**
 * detachTmux — detach the control client from a tmux server-side
 * session. ADR 0009 §2.9.
 */
import * as tmuxTauri from "../../infra/tauri/commands/tmux";

export function detachTmux(controllerId: number): Promise<void> {
  return tmuxTauri.detachTmux(controllerId);
}