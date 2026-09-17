import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  setWorkspaces: vi.fn(),
  workspaces: [
    {
      id: "ws1",
      name: "default",
      windows: [
        { id: "a", name: "A", windowType: "terminal", rootPane: { id: "p1", type: "leaf", size: 100 }, activePaneId: "p1" },
        { id: "b", name: "B", windowType: "terminal", rootPane: { id: "p2", type: "leaf", size: 100 }, activePaneId: "p2" },
      ],
      activeWindowId: "a",
      sessionIds: [],
    },
  ] as Array<Record<string, unknown>>,
}));

vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: { getState: () => ({ setWorkspaces: mocks.setWorkspaces, workspaces: mocks.workspaces }) },
}));

import { setActiveWindow } from "./setActiveWindow";

describe("setActiveWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the store setter with an updater", () => {
    setActiveWindow("ws1", "b");
    expect(mocks.setWorkspaces).toHaveBeenCalledTimes(1);
    const updater = mocks.setWorkspaces.mock.calls[0][0];
    const out = updater(mocks.workspaces);
    expect(out[0].activeWindowId).toBe("b");
  });
});