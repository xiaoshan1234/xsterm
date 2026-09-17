/**
 * resizeSession — forward PTY resize to the backend.
 */
import * as tauri from "../../infra/tauri/commands/sessions";

export function resizeSession(id: number, rows: number, cols: number): Promise<void> {
  return tauri.resizeSession(id, rows, cols);
}