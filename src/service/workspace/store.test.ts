/**
 * Smoke test for the workspace service store — verifies initial state
 * and that setWorkspaces / setActiveWorkspaceId work.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useWorkspaceStore } from "./store";

describe("useWorkspaceStore", () => {
  beforeEach(() => {
    useWorkspaceStore.getState().reset();
  });

  it("starts empty with a null active id", () => {
    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toEqual([]);
    expect(state.activeWorkspaceId).toBeNull();
  });

  it("setWorkspaces accepts both an array and an updater fn", () => {
    const ws1 = {
      id: "ws-1",
      name: "Workspace 1",
      windows: [],
      activeWindowId: null,
      sessionIds: [],
    };
    useWorkspaceStore.getState().setWorkspaces([ws1]);
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);

    useWorkspaceStore
      .getState()
      .setWorkspaces((prev) => [...prev, { ...ws1, id: "ws-2", name: "Workspace 2" }]);
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
    expect(useWorkspaceStore.getState().workspacesRef.current).toHaveLength(2);
  });

  it("setActiveWorkspaceId toggles the active id", () => {
    useWorkspaceStore.getState().setActiveWorkspaceId("ws-1");
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-1");
    useWorkspaceStore.getState().setActiveWorkspaceId(null);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
  });
});
