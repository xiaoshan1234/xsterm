import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  setWorkspaces: vi.fn(),
  sessions: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../service/session/store", () => ({
  useSessionStore: { getState: () => ({ sessions: mocks.sessions, addSession: vi.fn() }) },
}));

vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: {
    getState: () => ({
      workspaces: [{ id: "ws1", windows: [], activeWindowId: null, sessionIds: [] }],
      activeWorkspaceId: "ws1",
      setWorkspaces: mocks.setWorkspaces,
    }),
  },
}));

vi.mock("../../infra/tauri/commands/tmux", () => ({
  createTmuxWindow: vi.fn(),
}));

import { createWindow } from "./createWindow";

describe("createWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an init placeholder window", async () => {
    const w = await createWindow({ variant: "init" });
    expect(w.kind).toBe("init");
  });

  it("creates a window bound to a session (legacy form)", async () => {
    const w = await createWindow({ sessionId: 1, configId: "cfg" });
    expect(w.kind).toBe("terminal");
    expect(mocks.setWorkspaces).toHaveBeenCalled();
  });

  it("creates a window from variant=fromSession", async () => {
    const w = await createWindow({ variant: "fromSession", sessionId: 2, configId: "c2" });
    expect(w.kind).toBe("terminal");
    expect(mocks.setWorkspaces).toHaveBeenCalled();
  });

  it("creates a tmux server-side window (fire-and-forget)", async () => {
    const w = await createWindow({ variant: "tmux", tmuxControlWindowId: 1, name: "tmuxWin" });
    expect(w.name).toBe("tmuxWin");
  });
});
