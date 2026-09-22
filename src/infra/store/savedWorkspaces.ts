import { load, type Store } from "@tauri-apps/plugin-store";
import { type PaneNode, type SavedWorkspace } from "../../model";
import { logger } from "../logger/logger";

let storeInstance: Store | null = null;

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await load("sessions.json", { autoSave: true, defaults: {} });
  }
  return storeInstance;
}

export async function loadSavedWorkspaces(): Promise<SavedWorkspace[]> {
  logger.debug("sessionStorage", "loadSavedWorkspaces", undefined);
  try {
    const store = await getStore();
    const raw =
      (await store.get<(SavedWorkspace & { rootPane?: unknown })[]>("savedWorkspaces")) || [];
    const workspaces = raw.map((w) => {
      if ("rootPane" in w && w.rootPane !== undefined) {
        const legacy = w as SavedWorkspace & {
          rootPane: { id: string; type: "leaf" | "split"; size: number };
        };
        return {
          id: legacy.id,
          name: legacy.name,
          windows: [
            {
              id: crypto.randomUUID(),
              name: legacy.name || "Window",
              rootPane: legacy.rootPane as unknown as PaneNode,
            },
          ],
        };
      }
      return w as SavedWorkspace;
    });
    logger.debug("sessionStorage", "loadSavedWorkspaces:result", { count: workspaces.length });
    return workspaces;
  } catch (e) {
    console.error("Failed to load workspaces:", e);
    return [];
  }
}

export async function persistWorkspaces(workspaces: SavedWorkspace[]): Promise<void> {
  logger.debug("sessionStorage", "persistWorkspaces", { count: workspaces.length });
  try {
    const store = await getStore();
    await store.set("savedWorkspaces", workspaces);
    await store.save();
    logger.debug("sessionStorage", "persistWorkspaces:result", undefined);
  } catch (e) {
    console.error("Failed to save workspaces:", e);
  }
}

export async function deleteSavedWorkspace(id: string): Promise<void> {
  logger.debug("sessionStorage", "deleteSavedWorkspace", { id });
  try {
    const store = await getStore();
    const workspaces = (await store.get<SavedWorkspace[]>("savedWorkspaces")) || [];
    const updated = workspaces.filter((w) => w.id !== id);
    await store.set("savedWorkspaces", updated);
    await store.save();
    logger.debug("sessionStorage", "deleteSavedWorkspace:result", { remaining: updated.length });
  } catch (e) {
    console.error("Failed to delete workspace:", e);
  }
}
