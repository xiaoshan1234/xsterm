import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  addSession: vi.fn(),
}));

vi.mock("../../infra/tauri/commands/tmux", () => ({
  createTmux: vi.fn(),
}));

vi.mock("../../service/session/store", () => ({
  useSessionStore: { getState: () => ({ addSession: mocks.addSession }) },
}));

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: { getState: () => ({ upsertSavedConfig: vi.fn() }) },
}));

import { createTmux } from "../../infra/tauri/commands/tmux";
import { createTmuxSessionOnly } from "./createTmuxSessionOnly";

describe("createTmuxSessionOnly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates tmux backend session and adds it to the store", async () => {
    const mockInit = {
      session: {
        id: 50,
        name: "t",
        sessionType: { type: "tmux-cc", config: {} },
        isConnected: true,
        tmuxPaneId: "%1",
        tmuxControllerId: 1,
      },
      windows: [],
      panes: [],
      controlWindow: { tmuxControllerId: 1, name: "tmux-1" },
    } as any;
    vi.mocked(createTmux).mockResolvedValue(mockInit);

    const session = await createTmuxSessionOnly({});

    expect(createTmux).toHaveBeenCalled();
    expect(mocks.addSession).toHaveBeenCalledTimes(1);
    expect(session.id).toBe(50);
  });

  it("propagates backend errors", async () => {
    vi.mocked(createTmux).mockRejectedValue(new Error("tmux fail"));
    await expect(createTmuxSessionOnly({})).rejects.toThrow("tmux fail");
  });
});
