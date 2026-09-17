import {
  getCurrentWindow as tauriGetCurrentWindow,
  type Window as TauriWindow,
} from "@tauri-apps/api/window";

/**
 * Re-export the current Tauri window handle so UI code can avoid a
 * direct `@tauri-apps/api/window` import (boundary rule).
 *
 * The returned value mirrors `@tauri-apps/api/window`'s `Window`
 * shape exactly (startDragging, minimize, maximize, …) — this is a
 * pure pass-through.
 *
 * **Tauri guard**: returns `null` when running outside the Tauri
 * webview (i.e. `window.__TAURI_INTERNALS__` is undefined). UI code
 * that depends on the window handle should null-check the result
 * before invoking methods; the legacy NavBar pattern of doing
 * `const appWindow = getCurrentWindow();` and reading
 * `appWindow.isMaximized()` on render is what blew up React 19 when
 * the page loaded in a standalone browser (no Tauri bridge → sync
 * throw on `window.__TAURI_INTERNALS__.metadata.currentWindow.label`).
 */
export function getCurrentWindow(): TauriWindow | null {
  if (typeof window === "undefined") return null;
  const internals = (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  if (!internals) return null;
  return tauriGetCurrentWindow();
}
