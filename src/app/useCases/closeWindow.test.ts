import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  workspaces: [
    {
      id: "ws1",
      name: "default",
      windows: [
        {
          id: "win-1",
          name: "Local",
          kind: "terminal",
          rootPane: {
            id: "pane1",
            kind: "leaf",
            size: 100,
            binding: { sessionId: 7, configId: "cfg7" },
          },
          activePaneId: "pane1",
        },
      ],
      activeWindowId: "win-1",
      sessionIds: [7],
    },
  ] as Array<Record<string, unknown>>,
  setSessions: vi.fn(),
  setWorkspaces: vi.fn(),
}));

vi.mock("../../infra/tauri/commands/sessions", () => ({
  closeSession: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../infra/tauri/commands/tmux", () => ({
  unmarkAttachedTmux: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../infra/buffers/sessionOutputBuffer", () => ({
  clearSessionOutput: vi.fn(),
}));
vi.mock("../../service/session/store", () => ({
  useSessionStore: { getState: () => ({ setSessions: mocks.setSessions }) },
}));
vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: {
    getState: () => ({ workspaces: mocks.workspaces, setWorkspaces: mocks.setWorkspaces }),
  },
}));

import { closeWindow } from "./closeWindow";

describe("closeWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drops the window and closes the leaf session", async () => {
    await vi.waitFor(() => {});
    closeWindow("ws1", "win-1");
    expect(mocks.setWorkspaces).toHaveBeenCalledTimes(1);
    expect(mocks.setSessions).toHaveBeenCalledTimes(1);
  });

  it("does nothing for unknown windowId", () => {
    closeWindow("ws1", "missing");
    expect(mocks.setWorkspaces).not.toHaveBeenCalled();
  });
});
