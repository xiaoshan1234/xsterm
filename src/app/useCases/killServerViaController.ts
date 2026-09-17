/**
 * killServerViaController — shut down the entire tmux server reachable
 * via the given controller. ADR 0009 §2.9.
 */
import * as tmuxTauri from "../../infra/tauri/commands/tmux";

export function killServerViaController(controllerId: number): Promise<void> {
  return tmuxTauri.killServerViaController(controllerId);
}
