/**
 * Tauri-backed implementations of model-defined EventBus contracts.
 *
 * Single barrel re-exporting the per-domain `*EventBus` objects so
 * the (Phase 3) `model/<domain>/model.ts` factory functions can wire
 * them in one import site. Tests can swap in fake implementations by
 * overriding one import.
 */
export { tauriSessionEventBus } from "./session";
export { tauriTmuxEventBus } from "./tmux";
