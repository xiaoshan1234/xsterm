import { frontendLogger as logger } from "../../../infra";
import { getJsonStore } from "../../../infra/storage";
import type { EditablePaneNode } from "../../../models/workspace/EditablePaneTree";
import type {
  SavedWindowConfig,
  SavedWorkspace,
} from "../../../models/workspace/EditableWorkspace";

const workspaceStore = getJsonStore("terminals.json");

export async function loadSavedWindowConfigs(): Promise<SavedWindowConfig[]> {
  logger.debug("workspaceStorage", "loadSavedWindowConfigs", undefined);
  try {
    const configs = (await workspaceStore.get<SavedWindowConfig[]>("savedWindowConfigs")) ?? [];
    logger.debug("workspaceStorage", "loadSavedWindowConfigs:result", { count: configs.length });
    return configs;
  } catch (error) {
    console.error("Failed to load window configs:", error);
    return [];
  }
}

export async function persistWindowConfigs(configs: SavedWindowConfig[]): Promise<void> {
  logger.debug("workspaceStorage", "persistWindowConfigs", { count: configs.length });
  try {
    await workspaceStore.set("savedWindowConfigs", configs);
    logger.debug("workspaceStorage", "persistWindowConfigs:result", undefined);
  } catch (error) {
    console.error("Failed to save window configs:", error);
  }
}

export async function deleteSavedWindowConfig(id: string): Promise<void> {
  logger.debug("workspaceStorage", "deleteSavedWindowConfig", { id });
  try {
    const configs = (await workspaceStore.get<SavedWindowConfig[]>("savedWindowConfigs")) ?? [];
    const updated = configs.filter((config) => config.id !== id);
    await workspaceStore.set("savedWindowConfigs", updated);
    logger.debug("workspaceStorage", "deleteSavedWindowConfig:result", {
      remaining: updated.length,
    });
  } catch (error) {
    console.error("Failed to delete window config:", error);
  }
}

export async function loadSavedWorkspaces(): Promise<SavedWorkspace[]> {
  logger.debug("workspaceStorage", "loadSavedWorkspaces", undefined);
  try {
    const raw =
      (await workspaceStore.get<(SavedWorkspace & { rootPane?: unknown })[]>("savedWorkspaces")) ??
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
              rootPane: legacy.rootPane as EditablePaneNode,
            },
          ],
        };
      }
      return workspace as SavedWorkspace;
    });
    logger.debug("workspaceStorage", "loadSavedWorkspaces:result", { count: workspaces.length });
    return workspaces;
  } catch (error) {
    console.error("Failed to load workspaces:", error);
    return [];
  }
}

export async function persistWorkspaces(workspaces: SavedWorkspace[]): Promise<void> {
  logger.debug("workspaceStorage", "persistWorkspaces", { count: workspaces.length });
  try {
    await workspaceStore.set("savedWorkspaces", workspaces);
    logger.debug("workspaceStorage", "persistWorkspaces:result", undefined);
  } catch (error) {
    console.error("Failed to save workspaces:", error);
  }
}

export async function deleteSavedWorkspace(id: string): Promise<void> {
  logger.debug("workspaceStorage", "deleteSavedWorkspace", { id });
  try {
    const workspaces = (await workspaceStore.get<SavedWorkspace[]>("savedWorkspaces")) ?? [];
    const updated = workspaces.filter((workspace) => workspace.id !== id);
    await workspaceStore.set("savedWorkspaces", updated);
    logger.debug("workspaceStorage", "deleteSavedWorkspace:result", {
      remaining: updated.length,
    });
  } catch (error) {
    console.error("Failed to delete workspace:", error);
  }
}
