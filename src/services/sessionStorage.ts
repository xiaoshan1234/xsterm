import { load, Store } from "@tauri-apps/plugin-store";
import { logger } from "../contexts/LoggerContext";
import { SavedSessionConfig, SavedWorkspace, SessionGroup } from "../types/session";

interface GroupStore {
  groups: SessionGroup[];
  nextGroupId: number;
}

let storeInstance: Store | null = null;
let settingsStoreInstance: Store | null = null;

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await load("sessions.json", { autoSave: true, defaults: {} });
  }
  return storeInstance;
}

export async function getSettingsStore(): Promise<Store> {
  if (!settingsStoreInstance) {
    settingsStoreInstance = await load("settings.json", { autoSave: true, defaults: {} });
  }
  return settingsStoreInstance;
}

export async function loadSavedConfigs(): Promise<SavedSessionConfig[]> {
  logger.debug("sessionStorage", "loadSavedConfigs", undefined);
  try {
    const store = await getStore();
    const configs = (await store.get<SavedSessionConfig[]>("savedConfigs")) || [];
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

export async function loadSavedGroups(): Promise<GroupStore> {
  logger.debug("sessionStorage", "loadSavedGroups", undefined);
  try {
    const store = await getStore();
    const groups = await store.get<SessionGroup[]>("groups");
    const nextGroupId = (await store.get<number>("nextGroupId")) || 1;
    const result = { groups: groups || [], nextGroupId };
    logger.debug("sessionStorage", "loadSavedGroups:result", { groupCount: result.groups.length, nextGroupId });
    return result;
  } catch (e) {
    console.error("Failed to load groups:", e);
    return { groups: [], nextGroupId: 1 };
  }
}

export async function persistGroups(groupsData: GroupStore): Promise<void> {
  logger.debug("sessionStorage", "persistGroups", { groupCount: groupsData.groups.length, nextGroupId: groupsData.nextGroupId });
  try {
    const store = await getStore();
    await store.set("groups", groupsData.groups);
    await store.set("nextGroupId", groupsData.nextGroupId);
    await store.save();
    logger.debug("sessionStorage", "persistGroups:result", undefined);
  } catch (e) {
    console.error("Failed to save groups:", e);
  }
}

export async function loadSavedWorkspaces(): Promise<SavedWorkspace[]> {
  logger.debug("sessionStorage", "loadSavedWorkspaces", undefined);
  try {
    const store = await getStore();
    const workspaces = (await store.get<SavedWorkspace[]>("savedWorkspaces")) || [];
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
