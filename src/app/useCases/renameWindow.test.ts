import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  setWorkspaces: vi.fn(),
  workspaces: [
    {
      id: "ws1",
      name: "default",
      windows: [
        {
          id: "w1",
          name: "Old",
          windowType: "terminal",
          rootPane: { id: "p1", type: "leaf", size: 100 },
          activePaneId: "p1",
        },
      ],
      activeWindowId: "w1",
      sessionIds: [],
    },
  ] as Array<Record<string, unknown>>,
}));

vi.mock("../../infra/tauri/commands/tmux", () => ({
  renameTmuxWindow: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: {
    getState: () => ({ workspaces: mocks.workspaces, setWorkspaces: mocks.setWorkspaces }),
  },
}));

import { renameTmuxWindow } from "../../infra/tauri/commands/tmux";
import { renameWindow } from "./renameWindow";

describe("renameWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renames a local window via the store", () => {
    renameWindow("ws1", "w1", "NewName");
    expect(mocks.setWorkspaces).toHaveBeenCalledTimes(1);
    expect(renameTmuxWindow).not.toHaveBeenCalled();
  });

  it("routes tmux-backed windows to backend", () => {
    (mocks.workspaces[0].windows as Array<Record<string, unknown>>)[0] = {
      id: "w1",
      name: "Old",
      windowType: "terminal",
      rootPane: { id: "p1", type: "leaf", size: 100 },
      activePaneId: "p1",
      tmuxControllerId: 1,
      tmuxServerWindowId: "@5",
    };
    renameWindow("ws1", "w1", "NewName");
    expect(renameTmuxWindow).toHaveBeenCalledWith(1, "@5", "NewName");
    expect(mocks.setWorkspaces).not.toHaveBeenCalled();
  });

  it("ignores empty names", () => {
    renameWindow("ws1", "w1", "   ");
    expect(mocks.setWorkspaces).not.toHaveBeenCalled();
  });
});
