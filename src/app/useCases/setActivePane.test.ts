import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  setWorkspaces: vi.fn(),
  setSessions: vi.fn(),
  workspaces: [
    {
      id: "ws1",
      name: "default",
      windows: [
        {
          id: "a",
          name: "A",
          windowType: "terminal",
          rootPane: { id: "p1", type: "leaf", size: 100, sessionId: 5 },
          activePaneId: "p1",
        },
      ],
      activeWindowId: "a",
      sessionIds: [5],
    },
  ] as Array<Record<string, unknown>>,
}));

vi.mock("../../service/session/store", () => ({
  useSessionStore: { getState: () => ({ setSessions: mocks.setSessions }) },
}));
vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: {
    getState: () => ({ workspaces: mocks.workspaces, setWorkspaces: mocks.setWorkspaces }),
  },
}));

import { setActivePane } from "./setActivePane";

describe("setActivePane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates the active pane and bumps lastActivityAt on the bound session", () => {
    setActivePane("ws1", "a", "p1");
    expect(mocks.setWorkspaces).toHaveBeenCalledTimes(1);
    expect(mocks.setSessions).toHaveBeenCalledTimes(1);
  });

  it("updates only the active pane when no session is bound", () => {
    (mocks.workspaces[0].windows as Array<Record<string, unknown>>)[0] = {
      id: "a",
      name: "A",
      windowType: "terminal",
      rootPane: { id: "p1", type: "leaf", size: 100 },
      activePaneId: "p1",
    };
    setActivePane("ws1", "a", "p1");
    expect(mocks.setWorkspaces).toHaveBeenCalledTimes(1);
    expect(mocks.setSessions).not.toHaveBeenCalled();
  });
});
