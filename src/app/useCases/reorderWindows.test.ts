import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const windows = [
    { id: "a", name: "A", windowType: "terminal", rootPane: { id: "p1", type: "leaf", size: 100 }, activePaneId: "p1" },
    { id: "b", name: "B", windowType: "terminal", rootPane: { id: "p2", type: "leaf", size: 100 }, activePaneId: "p2" },
    { id: "c", name: "C", windowType: "terminal", rootPane: { id: "p3", type: "leaf", size: 100 }, activePaneId: "p3" },
  ];
  return {
    workspaces: [{ id: "ws1", name: "default", windows, activeWindowId: "a", sessionIds: [] }],
    setWorkspaces: vi.fn(),
  };
});

vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: { getState: () => ({ workspaces: mocks.workspaces, setWorkspaces: mocks.setWorkspaces }) },
}));

import { reorderWindows } from "./reorderWindows";

describe("reorderWindows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves a window from one index to another", () => {
    reorderWindows("ws1", 0, 2);
    expect(mocks.setWorkspaces).toHaveBeenCalled();
    const updater = mocks.setWorkspaces.mock.calls[0][0];
    const result = updater(mocks.workspaces);
    expect(result[0].windows.map((w: { id: string }) => w.id)).toEqual(["b", "c", "a"]);
  });

  it("does nothing when fromIndex === toIndex", () => {
    reorderWindows("ws1", 1, 1);
    expect(mocks.setWorkspaces).not.toHaveBeenCalled();
  });

  it("does nothing for negative indices", () => {
    reorderWindows("ws1", -1, 2);
    expect(mocks.setWorkspaces).not.toHaveBeenCalled();
  });
});
