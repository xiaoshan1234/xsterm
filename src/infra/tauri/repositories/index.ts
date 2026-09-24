/**
 * Tauri-backed implementation of model-defined Repository contracts.
 *
 * Single barrel re-exporting the per-domain `*Repository` objects so
 * the (Phase 3) `model/<domain>/model.ts` factory functions can wire
 * them in one import site. Tests can swap in fake implementations
 * by overriding one import.
 */
export { tauriSessionRepository } from "./sessions";
export { tauriConfigRepository } from "./persistence";
export { tauriTmuxRepository } from "./tmux";
