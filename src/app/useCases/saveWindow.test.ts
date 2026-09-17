import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  workspaces: [
    {
      id: "ws1",
      name: "default",
      windows: [{ id: "w1", name: "L", windowType: "terminal", rootPane: { id: "p1", type: "leaf", size: 100, sessionId: 5 }, activePaneId: "p1" }],
      activeWindowId: "w1",
      sessionIds: [5],
    },
  ] as Array<Record<string, unknown>>,
  upsertSavedWindowConfig: vi.fn(),
}));

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: { getState: () => ({ upsertSavedWindowConfig: mocks.upsertSavedWindowConfig }) },
}));
vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: { getState: () => ({ workspaces: mocks.workspaces }) },
}));

import { saveWindow } from "./saveWindow";

describe("saveWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves the window snapshot", () => {
    saveWindow("ws1", "w1", "MyWin");
    expect(mocks.upsertSavedWindowConfig).toHaveBeenCalledTimes(1);
  });

  it("does nothing for unknown window", () => {
    saveWindow("ws1", "missing", "x");
    expect(mocks.upsertSavedWindowConfig).not.toHaveBeenCalled();
  });
});