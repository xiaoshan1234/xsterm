import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  workspaces: [
    {
      id: "ws1",
      name: "default",
      windows: [
        {
          id: "win-init",
          name: "New Session",
          windowType: "init",
          rootPane: { id: "pane1", type: "leaf", size: 100 },
          activePaneId: "pane1",
        },
      ],
      activeWindowId: "win-init",
      sessionIds: [],
    },
  ] as Array<Record<string, unknown>>,
  sessions: [
    {
      id: 5,
      configId: "cfg5",
      name: "Local5",
      type: "local",
      isConnected: true,
      sessionType: { type: "local", config: {} },
    },
  ] as Array<Record<string, unknown>>,
  setWorkspaces: vi.fn(),
}));

vi.mock("../../service/session/store", () => ({
  useSessionStore: { getState: () => ({ sessions: mocks.sessions }) },
}));

vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: {
    getState: () => ({ workspaces: mocks.workspaces, setWorkspaces: mocks.setWorkspaces }),
  },
}));

import { replaceInitWindowWithSession } from "./replaceInitWindowWithSession";

describe("replaceInitWindowWithSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("promotes an init window to a terminal window bound to the session", () => {
    replaceInitWindowWithSession("ws1", "win-init", 5, "cfg5", "Local5");
    expect(mocks.setWorkspaces).toHaveBeenCalledTimes(1);
  });

  it("throws when session is already used in another window", () => {
    // mark session 5 as already used in another window
    mocks.workspaces[0].windows = [
      {
        id: "other",
        name: "Other",
        windowType: "terminal",
        rootPane: { id: "pane2", type: "leaf", size: 100, sessionId: 5, configId: "cfg5" },
        activePaneId: "pane2",
      },
      (mocks.workspaces[0] as { windows: unknown[] }).windows[0],
    ];
    expect(() => replaceInitWindowWithSession("ws1", "win-init", 5, "cfg5")).toThrow(
      "Session is already used in another window",
    );
  });
});
