/**
 * writeSession — keystroke write IPC, fire-and-forget. The terminal
 * pipeline (Terminal.tsx) rAF-batches calls so awaiting here would
 * defeat the batching.
 */
import * as tauri from "../../infra/tauri/commands/sessions";

export function writeSession(id: number, data: string): Promise<void> {
  return tauri.writeSession(id, data);
}
