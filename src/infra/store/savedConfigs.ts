import { load, type Store } from "@tauri-apps/plugin-store";
import { migrateSavedConfigList, type SavedSessionConfig } from "../../model/entities";
import { logger } from "../logger/logger";

let storeInstance: Store | null = null;

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await load("sessions.json", { autoSave: true, defaults: {} });
  }
  return storeInstance;
}

export async function loadSavedConfigs(): Promise<SavedSessionConfig[]> {
  logger.debug("sessionStorage", "loadSavedConfigs", undefined);
  try {
    const store = await getStore();
    const raw = await store.get<unknown>("savedConfigs");
    const configs = migrateSavedConfigList(raw ?? []);
    logger.debug("sessionStorage", "loadSavedConfigs:result", { count: configs.length });
    return configs;
  } catch (e) {
    console.error("Failed to load configs:", e);
    return [];
  }
}

export async function persistConfigs(configs: SavedSessionConfig[]): Promise<void> {
  logger.debug("sessionStorage", "persistConfigs", { count: configs.length });
  try {
    const store = await getStore();
    await store.set("savedConfigs", configs);
    await store.save();
    logger.debug("sessionStorage", "persistConfigs:result", undefined);
  } catch (e) {
    console.error("Failed to save configs:", e);
  }
}
