import type { SavedWindowConfig, SavedWorkspace } from "../contracts";
import {
  loadSavedWindowConfigs,
  loadSavedWorkspaces,
  persistWindowConfigs,
  persistWorkspaces,
} from "./workspaceStorage";

export interface WorkspaceRepository {
  loadWindowConfigs: () => Promise<SavedWindowConfig[]>;
  loadWorkspaces: () => Promise<SavedWorkspace[]>;
  persistWindowConfigs: (configs: SavedWindowConfig[]) => Promise<void>;
  persistWorkspaces: (workspaces: SavedWorkspace[]) => Promise<void>;
}

export const workspaceRepository: WorkspaceRepository = {
  loadWindowConfigs: loadSavedWindowConfigs,
  loadWorkspaces: loadSavedWorkspaces,
  persistWindowConfigs,
  persistWorkspaces,
};
