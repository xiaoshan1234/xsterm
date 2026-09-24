import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  setWorkspaces: vi.fn(),
  setSessions: vi.fn(),
  sessions: [
    {
      id: 1,
      configId: "cfg",
      name: "tmux-parent",
      type: "tmux-cc",
      isConnected: true,
      sessionType: { type: "tmux-cc", config: {} },
      tmuxPaneId: "%1",
      tmuxControllerId: 7,
      capabilities: {
        canMultiplex: true,
        canResize: true,
        canReconnect: true,
        canLocalEcho: false,
      },
    },
  ] as Array<Record<string, unknown>>,
}));

vi.mock("../../infra/tauri/commands/tmux", () => ({
  createTmuxPane: vi.fn(),
}));

vi.mock("../../service/session/store", () => ({
  useSessionStore: {
    getState: () => ({ sessions: mocks.sessions, setSessions: mocks.setSessions }),
  },
}));
vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: { getState: () => ({ setWorkspaces: mocks.setWorkspaces }) },
}));

import { createTmuxPane } from "../../infra/tauri/commands/tmux";
import { splitPane } from "./splitPane";

describe("splitPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a tmux pane via backend and updates the pane tree", async () => {
    const info = {
      id: 99,
      name: "new",
      sessionType: { type: "tmux-cc", config: {} },
      isConnected: true,
      tmuxPaneId: "%1",
      tmuxControllerId: 7,
    } as any;
    vi.mocked(createTmuxPane).mockResolvedValue(info);

    await splitPane({
      workspaceId: "ws1",
      windowId: "win1",
      paneId: "pane1",
      direction: "horizontal",
      sessionId: 1,
    });

    expect(createTmuxPane).toHaveBeenCalled();
    expect(mocks.setSessions).toHaveBeenCalled();
    expect(mocks.setWorkspaces).toHaveBeenCalled();
  });

  it("falls back to local split when no sessionId is provided", async () => {
    await splitPane({
      workspaceId: "ws1",
      windowId: "win1",
      paneId: "pane1",
      direction: "vertical",
    });
    expect(createTmuxPane).not.toHaveBeenCalled();
    expect(mocks.setWorkspaces).toHaveBeenCalled();
  });
});
