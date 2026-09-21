import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  setWorkspaces: vi.fn(),
  setSessions: vi.fn(),
  addSession: vi.fn(),
}));

vi.mock("../../infra/tauri/commands/sessions", () => ({}));
vi.mock("../../infra/tauri/commands/tmux", () => ({
  createTmux: vi.fn(),
  attachTmux: vi.fn(),
  probeTmuxSessionExists: vi.fn(),
}));

vi.mock("../../service/session/store", () => ({
  useSessionStore: {
    getState: () => ({
      addSession: mocks.addSession,
      setSessions: mocks.setSessions,
    }),
  },
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

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: { getState: () => ({ upsertSavedConfig: vi.fn() }) },
}));

import { createTmux, attachTmux, probeTmuxSessionExists } from "../../infra/tauri/commands/tmux";
import { createTmuxSession } from "./createTmuxSession";

function makeMockInit(sessionId: number, controllerId: number) {
  return {
    session: {
      id: sessionId,
      name: `tmux-${controllerId}`,
      sessionType: { type: "tmux-cc", controllerId, paneId: "%1", sessionName: "", socketName: undefined },
      isConnected: true,
      tmuxPaneId: "%1",
      tmuxControllerId: controllerId,
      tmuxWindowId: "@1",
    },
    windows: [
      { tmuxWindowId: "@1", name: "win-1", active: true, layout: "" },
    ],
    panes: [
      {
        sessionId,
        tmuxPaneId: "%1",
        tmuxWindowId: "@1",
        active: true,
        width: 80,
        height: 24,
        title: "bash",
        cwd: "/home/u",
      },
    ],
    controlWindow: { tmuxControllerId: controllerId, name: `tmux-${controllerId}` },
  };
}

describe("createTmuxSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls createTmux when probe returns false", async () => {
    const mockInit = makeMockInit(99, 5) as any;
    vi.mocked(probeTmuxSessionExists).mockResolvedValue(false);
    vi.mocked(createTmux).mockResolvedValue(mockInit);

    const session = await createTmuxSession({});

    expect(probeTmuxSessionExists).toHaveBeenCalled();
    expect(createTmux).toHaveBeenCalled();
    expect(attachTmux).not.toHaveBeenCalled();
    expect(session.type).toBe("tmux-cc");
    expect(session.id).toBe(99);
    expect(mocks.setWorkspaces).toHaveBeenCalled();
    expect(mocks.setSessions).toHaveBeenCalled();
  });

  it("routes through attachTmux when probe returns true", async () => {
    const mockInit = makeMockInit(100, 6) as any;
    vi.mocked(probeTmuxSessionExists).mockResolvedValue(true);
    vi.mocked(attachTmux).mockResolvedValue(mockInit);

    const session = await createTmuxSession({});

    expect(attachTmux).toHaveBeenCalled();
    expect(createTmux).not.toHaveBeenCalled();
    expect(session.id).toBe(100);
  });

  it("falls back to createTmux when probe fails", async () => {
    const mockInit = makeMockInit(101, 7) as any;
    vi.mocked(probeTmuxSessionExists).mockRejectedValue(new Error("probe fail"));
    vi.mocked(createTmux).mockResolvedValue(mockInit);

    await createTmuxSession({});
    expect(createTmux).toHaveBeenCalled();
  });
});
