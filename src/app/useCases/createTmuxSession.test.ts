import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  setWorkspaces: vi.fn(),
  addSession: vi.fn(),
}));

vi.mock("../../infra/tauri/commands/sessions", () => ({}));
vi.mock("../../infra/tauri/commands/tmux", () => ({
  createTmux: vi.fn(),
  attachTmux: vi.fn(),
  probeTmuxSessionExists: vi.fn(),
}));

vi.mock("../../service/session/store", () => ({
  useSessionStore: { getState: () => ({ addSession: mocks.addSession }) },
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

describe("createTmuxSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls createTmux when probe returns false", async () => {
    const mockInfo = {
      id: 99,
      name: "t1",
      sessionType: { type: "tmux-cc", config: {} },
      isConnected: true,
      tmuxPaneId: "%1",
      tmuxControllerId: 5,
    } as any;
    vi.mocked(probeTmuxSessionExists).mockResolvedValue(false);
    vi.mocked(createTmux).mockResolvedValue(mockInfo);

    const session = await createTmuxSession({});

    expect(probeTmuxSessionExists).toHaveBeenCalled();
    expect(createTmux).toHaveBeenCalled();
    expect(attachTmux).not.toHaveBeenCalled();
    expect(session.type).toBe("tmux-cc");
    expect(session.tmuxControllerId).toBe(5);
    expect(mocks.setWorkspaces).toHaveBeenCalled();
  });

  it("routes through attachTmux when probe returns true", async () => {
    const mockInfo = {
      id: 100,
      name: "t2",
      sessionType: { type: "tmux-cc", config: {} },
      isConnected: true,
      tmuxPaneId: "%1",
      tmuxControllerId: 6,
    } as any;
    vi.mocked(probeTmuxSessionExists).mockResolvedValue(true);
    vi.mocked(attachTmux).mockResolvedValue(mockInfo);

    const session = await createTmuxSession({});

    expect(attachTmux).toHaveBeenCalled();
    expect(createTmux).not.toHaveBeenCalled();
    expect(session.tmuxControllerId).toBe(6);
  });

  it("falls back to createTmux when probe fails", async () => {
    const mockInfo = {
      id: 101,
      name: "t3",
      sessionType: { type: "tmux-cc", config: {} },
      isConnected: true,
      tmuxPaneId: "%1",
      tmuxControllerId: 7,
    } as any;
    vi.mocked(probeTmuxSessionExists).mockRejectedValue(new Error("probe fail"));
    vi.mocked(createTmux).mockResolvedValue(mockInfo);

    await createTmuxSession({});
    expect(createTmux).toHaveBeenCalled();
  });
});
