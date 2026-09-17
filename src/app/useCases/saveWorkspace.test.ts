import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  workspaces: [
    {
      id: "ws1",
      name: "default",
      windows: [
        {
          id: "w1",
          name: "L",
          windowType: "terminal",
          rootPane: { id: "p1", type: "leaf", size: 100, sessionId: 5 },
          activePaneId: "p1",
        },
      ],
      activeWindowId: "w1",
      sessionIds: [5],
    },
  ] as Array<Record<string, unknown>>,
  savedWorkspaces: [] as Array<Record<string, unknown>>,
  upsertSavedWorkspace: vi.fn(),
}));

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: {
    getState: () => ({
      savedWorkspaces: mocks.savedWorkspaces,
      upsertSavedWorkspace: mocks.upsertSavedWorkspace,
    }),
  },
}));
vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: { getState: () => ({ workspaces: mocks.workspaces }) },
}));

import { saveWorkspace } from "./saveWorkspace";

describe("saveWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.savedWorkspaces.length = 0;
  });

  it("saves a non-default workspace", () => {
    mocks.workspaces[0].name = "MyWorkspace";
    saveWorkspace("ws1", "MyWorkspace");
    expect(mocks.upsertSavedWorkspace).toHaveBeenCalledTimes(1);
  });

  it("refuses the reserved 'default' name", () => {
    expect(() => saveWorkspace("ws1", "default")).toThrow("Workspace name is reserved");
  });

  it("throws when a default-named workspace collides", () => {
    mocks.workspaces[0].name = "default";
    mocks.savedWorkspaces.push({ id: "x", name: "snap", windows: [] });
    expect(() => saveWorkspace("ws1", "snap")).toThrow("Workspace name already exists");
  });
});
