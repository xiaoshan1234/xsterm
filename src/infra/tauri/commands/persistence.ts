import { load, type Store } from "@tauri-apps/plugin-store";

let settingsStoreInstance: Store | null = null;

/**
 * Singleton handle to the `settings.json` plugin-store file. The
 * `settings.json` file holds user-facing app settings (log config,
 * shortcuts, etc.) — distinct from `sessions.json` which holds saved
 * session configs / workspaces / window configs / groups.
 *
 * Mirrors `getSettingsStore` from `src/services/sessionStorage.ts`
 * 1:1, including the lazy `load()` + memoised `Store` instance.
 */
export async function getSettingsStore(): Promise<Store> {
  if (!settingsStoreInstance) {
    settingsStoreInstance = await load("settings.json", { autoSave: true, defaults: {} });
  }
  return settingsStoreInstance;
}
