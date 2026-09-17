/**
 * setActiveWorkspace — make a workspace the active one.
 */
import { useWorkspaceStore } from "../../service/workspace/store";

export function setActiveWorkspace(workspaceId: string): void {
  useWorkspaceStore.getState().setActiveWorkspace(workspaceId);
}