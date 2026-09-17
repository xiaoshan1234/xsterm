import { getCurrentWindow as tauriGetCurrentWindow } from "@tauri-apps/api/window";

/**
 * Re-export the current Tauri window handle so UI code can avoid a
 * direct `@tauri-apps/api/window` import (boundary rule).
 *
 * The returned value mirrors `@tauri-apps/api/window`'s `Window`
 * shape exactly (startDragging, minimize, maximize, …) — this is a
 * pure pass-through.
 */
export const getCurrentWindow = (): ReturnType<typeof tauriGetCurrentWindow> =>
  tauriGetCurrentWindow();