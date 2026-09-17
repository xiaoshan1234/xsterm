import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  addSession: vi.fn(),
  addWindow: vi.fn(),
  savedConfigs: [
    {
      id: "cfg-local",
      name: "Local1",
      version: 1,
      type: "local",
      config: { shell: "bash" },
    },
  ] as Array<Record<string, unknown>>,
}));

vi.mock("../../infra/tauri/commands/sessions", () => ({
  createLocal: vi.fn(),
  createSsh: vi.fn(),
}));
vi.mock("../../infra/tauri/commands/tmux", () => ({
  createTmux: vi.fn(),
}));

vi.mock("../../service/session/store", () => ({
  useSessionStore: { getState: () => ({ addSession: mocks.addSession }) },
}));
vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: {
    getState: () => ({
      workspaces: [{ id: "ws1" }],
      activeWorkspaceId: "ws1",
      addWindow: mocks.addWindow,
    }),
  },
}));
vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: {
    getState: () => ({ savedConfigs: mocks.savedConfigs, upsertSavedConfig: vi.fn() }),
  },
}));

import { createLocal, createSsh } from "../../infra/tauri/commands/sessions";
import { createTmux } from "../../infra/tauri/commands/tmux";
import { openSavedSession } from "./openSavedSession";

describe("openSavedSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.savedConfigs.length = 0;
    mocks.savedConfigs.push({
      id: "cfg-local",
      name: "Local1",
      version: 1,
      type: "local",
      config: { shell: "bash" },
    });
  });

  it("recreates a local session from saved config", async () => {
    const mockInfo = {
      id: 200,
      name: "Local1",
      sessionType: { type: "local", config: {} },
      isConnected: true,
    } as any;
    vi.mocked(createLocal).mockResolvedValue(mockInfo);

    const session = await openSavedSession("cfg-local");
    expect(createLocal).toHaveBeenCalled();
    expect(session.id).toBe(200);
    expect(session.type).toBe("local");
  });

  it("throws when saved config not found", async () => {
    await expect(openSavedSession("missing")).rejects.toThrow("Saved config not found");
  });

  it("routes SSH configs through createSsh", async () => {
    mocks.savedConfigs.length = 0;
    mocks.savedConfigs.push({
      id: "cfg-ssh",
      name: "Ssh1",
      version: 1,
      type: "ssh",
      config: { host: "h", port: 22, username: "u", auth_type: "password" },
    });
    const mockInfo = { id: 201, name: "Ssh1", sessionType: { type: "ssh", config: {} }, isConnected: true } as any;
    vi.mocked(createSsh).mockResolvedValue(mockInfo);

    await openSavedSession("cfg-ssh");
    expect(createSsh).toHaveBeenCalled();
  });

  it("routes tmux configs through createTmux and skips window creation", async () => {
    mocks.savedConfigs.length = 0;
    mocks.savedConfigs.push({
      id: "cfg-tmux",
      name: "Tmux1",
      version: 1,
      type: "tmux-cc",
      config: {},
    });
    const mockInfo = {
      id: 202,
      name: "Tmux1",
      sessionType: { type: "tmux-cc", config: {} },
      isConnected: true,
      tmuxPaneId: "%1",
      tmuxControllerId: 1,
    } as any;
    vi.mocked(createTmux).mockResolvedValue(mockInfo);

    await openSavedSession("cfg-tmux");
    expect(createTmux).toHaveBeenCalled();
    expect(mocks.addWindow).not.toHaveBeenCalled();
  });
});
