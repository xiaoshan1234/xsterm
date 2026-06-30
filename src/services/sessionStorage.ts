import { load, Store } from "@tauri-apps/plugin-store";
import { SavedSessionConfig, SavedWorkspace, SessionGroup } from "../types/session";

interface GroupStore {
  groups: SessionGroup[];
  nextGroupId: number;
}

let storeInstance: Store | null = null;

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await load("sessions.json", { autoSave: true, defaults: {} });
  }
  return storeInstance;
}

export async function loadSavedConfigs(): Promise<SavedSessionConfig[]> {
  try {
    const store = await getStore();
    return (await store.get<SavedSessionConfig[]>("savedConfigs")) || [];
  } catch (e) {
    console.error("Failed to load configs:", e);
    return [];
  }
}

export async function persistConfigs(configs: SavedSessionConfig[]): Promise<void> {
  try {
    const store = await getStore();
    await store.set("savedConfigs", configs);
    await store.save();
  } catch (e) {
    console.error("Failed to save configs:", e);
  }
}

export async function loadSavedGroups(): Promise<GroupStore> {
  try {
    const store = await getStore();
    const groups = await store.get<SessionGroup[]>("groups");
    const nextGroupId = (await store.get<number>("nextGroupId")) || 1;
    return { groups: groups || [], nextGroupId };
  } catch (e) {
    console.error("Failed to load groups:", e);
    return { groups: [], nextGroupId: 1 };
  }
}

export async function persistGroups(groupsData: GroupStore): Promise<void> {
  try {
    const store = await getStore();
    await store.set("groups", groupsData.groups);
    await store.set("nextGroupId", groupsData.nextGroupId);
    await store.save();
  } catch (e) {
    console.error("Failed to save groups:", e);
  }
}

export async function loadSavedWorkspaces(): Promise<SavedWorkspace[]> {
  try {
    const store = await getStore();
    return (await store.get<SavedWorkspace[]>("savedWorkspaces")) || [];
  } catch (e) {
    console.error("Failed to load workspaces:", e);
    return [];
  }
}

export async function persistWorkspaces(workspaces: SavedWorkspace[]): Promise<void> {
  try {
    const store = await getStore();
    await store.set("savedWorkspaces", workspaces);
    await store.save();
  } catch (e) {
    console.error("Failed to save workspaces:", e);
  }
}

export async function deleteSavedWorkspace(id: string): Promise<void> {
  try {
    const store = await getStore();
    const workspaces = (await store.get<SavedWorkspace[]>("savedWorkspaces")) || [];
    const updated = workspaces.filter((w) => w.id !== id);
    await store.set("savedWorkspaces", updated);
    await store.save();
  } catch (e) {
    console.error("Failed to delete workspace:", e);
  }
}
