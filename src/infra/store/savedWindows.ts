import { load, type Store } from "@tauri-apps/plugin-store";
import { type SavedWindowConfig } from "../../model/entities";
import { logger } from "../logger/logger";

let storeInstance: Store | null = null;

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await load("sessions.json", { autoSave: true, defaults: {} });
  }
  return storeInstance;
}

export async function loadSavedWindowConfigs(): Promise<SavedWindowConfig[]> {
  logger.debug("sessionStorage", "loadSavedWindowConfigs", undefined);
  try {
    const store = await getStore();
    const configs = (await store.get<SavedWindowConfig[]>("savedWindowConfigs")) || [];
    logger.debug("sessionStorage", "loadSavedWindowConfigs:result", { count: configs.length });
    return configs;
  } catch (e) {
    console.error("Failed to load window configs:", e);
    return [];
  }
}

export async function persistWindowConfigs(configs: SavedWindowConfig[]): Promise<void> {
  logger.debug("sessionStorage", "persistWindowConfigs", { count: configs.length });
  try {
    const store = await getStore();
    await store.set("savedWindowConfigs", configs);
    await store.save();
    logger.debug("sessionStorage", "persistWindowConfigs:result", undefined);
  } catch (e) {
    console.error("Failed to save window configs:", e);
  }
}

export async function deleteSavedWindowConfig(id: string): Promise<void> {
  logger.debug("sessionStorage", "deleteSavedWindowConfig", { id });
  try {
    const store = await getStore();
    const configs = (await store.get<SavedWindowConfig[]>("savedWindowConfigs")) || [];
    const updated = configs.filter((c) => c.id !== id);
    await store.set("savedWindowConfigs", updated);
    await store.save();
    logger.debug("sessionStorage", "deleteSavedWindowConfig:result", { remaining: updated.length });
  } catch (e) {
    console.error("Failed to delete window config:", e);
  }
}
