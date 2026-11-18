import { frontendLogger as logger } from "../../../infra";
import { getJsonStore, type JsonStore } from "../../../infra/storage";
import {
  type PaneNode,
  type SavedWindowConfig,
  type SavedWorkspace,
} from "../../../models/legacy/terminal";

const terminalsStore = getJsonStore("terminals.json");
const settingsStore = getJsonStore("settings.json");

export function getSettingsStore(): JsonStore {
  return settingsStore;
}

export async function loadSavedWindowConfigs(): Promise<SavedWindowConfig[]> {
  logger.debug("terminalStorage", "loadSavedWindowConfigs", undefined);
  try {
    const configs = (await terminalsStore.get<SavedWindowConfig[]>("savedWindowConfigs")) ?? [];
    logger.debug("terminalStorage", "loadSavedWindowConfigs:result", { count: configs.length });
    return configs;
  } catch (error) {
    console.error("Failed to load window configs:", error);
    return [];
  }
}

export async function persistWindowConfigs(configs: SavedWindowConfig[]): Promise<void> {
  logger.debug("terminalStorage", "persistWindowConfigs", { count: configs.length });
  try {
    await terminalsStore.set("savedWindowConfigs", configs);
    logger.debug("terminalStorage", "persistWindowConfigs:result", undefined);
  } catch (error) {
    console.error("Failed to save window configs:", error);
  }
}

export async function deleteSavedWindowConfig(id: string): Promise<void> {
  logger.debug("terminalStorage", "deleteSavedWindowConfig", { id });
  try {
    const configs = (await terminalsStore.get<SavedWindowConfig[]>("savedWindowConfigs")) ?? [];
    const updated = configs.filter((config) => config.id !== id);
    await terminalsStore.set("savedWindowConfigs", updated);
    logger.debug("terminalStorage", "deleteSavedWindowConfig:result", {
      remaining: updated.length,
    });
  } catch (error) {
    console.error("Failed to delete window config:", error);
  }
}

export async function loadSavedWorkspaces(): Promise<SavedWorkspace[]> {
  logger.debug("terminalStorage", "loadSavedWorkspaces", undefined);
  try {
    const raw =
      (await terminalsStore.get<(SavedWorkspace & { rootPane?: unknown })[]>("savedWorkspaces")) ??
      [];
    const workspaces = raw.map((workspace) => {
      if ("rootPane" in workspace && workspace.rootPane !== undefined) {
        const legacy = workspace as SavedWorkspace & {
          rootPane: { id: string; type: "leaf" | "split"; size: number };
        };
        return {
          id: legacy.id,
          name: legacy.name,
          windows: [
            {
              id: crypto.randomUUID(),
              name: legacy.name || "Window",
              rootPane: legacy.rootPane as PaneNode,
            },
          ],
        };
      }
      return workspace as SavedWorkspace;
    });
    logger.debug("terminalStorage", "loadSavedWorkspaces:result", { count: workspaces.length });
    return workspaces;
  } catch (error) {
    console.error("Failed to load workspaces:", error);
    return [];
  }
}

export async function persistWorkspaces(workspaces: SavedWorkspace[]): Promise<void> {
  logger.debug("terminalStorage", "persistWorkspaces", { count: workspaces.length });
  try {
    await terminalsStore.set("savedWorkspaces", workspaces);
    logger.debug("terminalStorage", "persistWorkspaces:result", undefined);
  } catch (error) {
    console.error("Failed to save workspaces:", error);
  }
}

export async function deleteSavedWorkspace(id: string): Promise<void> {
  logger.debug("terminalStorage", "deleteSavedWorkspace", { id });
  try {
    const workspaces = (await terminalsStore.get<SavedWorkspace[]>("savedWorkspaces")) ?? [];
    const updated = workspaces.filter((workspace) => workspace.id !== id);
    await terminalsStore.set("savedWorkspaces", updated);
    logger.debug("terminalStorage", "deleteSavedWorkspace:result", {
      remaining: updated.length,
    });
  } catch (error) {
    console.error("Failed to delete workspace:", error);
  }
}
