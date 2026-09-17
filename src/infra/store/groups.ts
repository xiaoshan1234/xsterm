import { load, type Store } from "@tauri-apps/plugin-store";
import { type SessionGroup } from "../../model/entities";
import { logger } from "../logger/logger";

export interface GroupStore {
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

export async function loadSavedGroups(): Promise<GroupStore> {
  logger.debug("sessionStorage", "loadSavedGroups", undefined);
  try {
    const store = await getStore();
    const groups = await store.get<SessionGroup[]>("groups");
    const nextGroupId = (await store.get<number>("nextGroupId")) || 1;
    const result = { groups: groups || [], nextGroupId };
    logger.debug("sessionStorage", "loadSavedGroups:result", {
      groupCount: result.groups.length,
      nextGroupId,
    });
    return result;
  } catch (e) {
    console.error("Failed to load groups:", e);
    return { groups: [], nextGroupId: 1 };
  }
}

export async function persistGroups(groupsData: GroupStore): Promise<void> {
  logger.debug("sessionStorage", "persistGroups", {
    groupCount: groupsData.groups.length,
    nextGroupId: groupsData.nextGroupId,
  });
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
