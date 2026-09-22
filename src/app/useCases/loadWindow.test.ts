import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  savedWindowConfigs: [
    {
      id: "snap-w",
      name: "SnapWin",
      rootPane: {
        id: "p-snap",
        kind: "leaf",
        size: 100,
        binding: { sessionId: 0, configId: "cfg-snap" },
      },
    },
  ] as Array<Record<string, unknown>>,
  workspaces: [
    { id: "ws1", name: "default", windows: [], activeWindowId: null, sessionIds: [] },
  ] as Array<Record<string, unknown>>,
  setWorkspaces: vi.fn(),
}));

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: { getState: () => ({ savedWindowConfigs: mocks.savedWindowConfigs }) },
}));
vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: {
    getState: () => ({ workspaces: mocks.workspaces, setWorkspaces: mocks.setWorkspaces }),
  },
}));
vi.mock("./openSavedSession", () => ({
  openSavedSession: vi.fn(async () => ({
    id: 51,
    configId: "cfg-snap",
    name: "Recreated",
    type: "local",
    isConnected: true,
    sessionType: { type: "local", config: {} },
  })),
}));

import { loadWindow } from "./loadWindow";

describe("loadWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rebuilds a window and inserts it into the target workspace", async () => {
    const w = await loadWindow("snap-w", "ws1");
    expect(w.name).toBe("SnapWin");
    expect(mocks.setWorkspaces).toHaveBeenCalledTimes(1);
  });

  it("throws when saved window is missing", async () => {
    await expect(loadWindow("missing")).rejects.toThrow("Saved window config not found");
  });
});
