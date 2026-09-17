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
  setSessions: vi.fn(),
  setWorkspaces: vi.fn(),
}));

vi.mock("../../infra/tauri/commands/sessions", () => ({
  closeSession: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../infra/buffers/sessionOutputBuffer", () => ({
  clearSessionOutput: vi.fn(),
}));
vi.mock("../../service/session/store", () => ({
  useSessionStore: { getState: () => ({ setSessions: mocks.setSessions }) },
}));
vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: { getState: () => ({ workspaces: mocks.workspaces, setWorkspaces: mocks.setWorkspaces }) },
}));

import { closePane } from "./closePane";

describe("closePane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("closes the session and updates the pane tree", async () => {
    await closePane("ws1", "w1", "p1");
    expect(mocks.setSessions).toHaveBeenCalledTimes(1);
    expect(mocks.setWorkspaces).toHaveBeenCalledTimes(1);
  });

  it("does nothing for unknown paneId", async () => {
    await closePane("ws1", "w1", "missing");
    expect(mocks.setSessions).not.toHaveBeenCalled();
    expect(mocks.setWorkspaces).not.toHaveBeenCalled();
  });
});