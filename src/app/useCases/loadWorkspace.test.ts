import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  savedWorkspaces: [
    {
      id: "snap1",
      name: "MySnapshot",
      windows: [
        {
          id: "w-snap",
          name: "Win1",
          rootPane: {
            id: "p-snap",
            kind: "leaf",
            size: 100,
            binding: { sessionId: 0, configId: "cfg-snap" },
          },
        },
      ],
    },
  ] as Array<Record<string, unknown>>,
  addWorkspace: vi.fn(),
  setActiveWorkspace: vi.fn(),
}));

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: { getState: () => ({ savedWorkspaces: mocks.savedWorkspaces }) },
}));
vi.mock("../../service/session/store", () => ({
  useSessionStore: { getState: () => ({}) },
}));
vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: {
    getState: () => ({
      addWorkspace: mocks.addWorkspace,
      setActiveWorkspace: mocks.setActiveWorkspace,
    }),
  },
}));
vi.mock("./openSavedSession", () => ({
  openSavedSession: vi.fn(async () => ({
    id: 50,
    configId: "cfg-snap",
    name: "Recreated",
    type: "local",
    isConnected: true,
    sessionType: { type: "local", config: {} },
  })),
}));

import { loadWorkspace } from "./loadWorkspace";
import { openSavedSession } from "./openSavedSession";

describe("loadWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rebuilds a workspace from a snapshot", async () => {
    const ws = await loadWorkspace("snap1");
    expect(vi.mocked(openSavedSession)).toHaveBeenCalled();
    expect(ws.name).toBe("MySnapshot");
    expect(ws.windows).toHaveLength(1);
    expect(mocks.addWorkspace).toHaveBeenCalled();
    expect(mocks.setActiveWorkspace).toHaveBeenCalled();
  });

  it("throws when the snapshot is not found", async () => {
    await expect(loadWorkspace("missing")).rejects.toThrow("Saved workspace not found");
  });
});
