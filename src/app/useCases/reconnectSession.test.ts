import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const baseSession = {
    id: 1,
    configId: "cfg1",
    name: "Local1",
    type: "local" as const,
    isConnected: true,
    sessionType: { type: "local" as const, config: {} },
  };
  return {
    sessions: [baseSession],
    addSession: vi.fn(),
    removeSession: vi.fn(),
    setWorkspaces: vi.fn(),
    savedConfigs: [
      {
        id: "cfg1",
        name: "Local1",
        version: 1,
        type: "local",
        config: { shell: "bash" },
      },
    ] as Array<Record<string, unknown>>,
  };
});

vi.mock("../../infra/tauri/commands/sessions", () => ({
  createLocal: vi.fn(),
  closeSession: vi.fn(),
}));
vi.mock("../../infra/tauri/commands/tmux", () => ({
  createTmux: vi.fn(),
}));
vi.mock("../../infra/buffers/sessionOutputBuffer", () => ({
  clearSessionOutput: vi.fn(),
}));

vi.mock("../../service/session/store", () => ({
  useSessionStore: {
    getState: () => ({
      sessions: mocks.sessions,
      addSession: mocks.addSession,
      removeSession: mocks.removeSession,
    }),
  },
}));

vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: { getState: () => ({ setWorkspaces: mocks.setWorkspaces }) },
}));

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: {
    getState: () => ({ savedConfigs: mocks.savedConfigs }),
  },
}));

import { createLocal, closeSession as closeBackend } from "../../infra/tauri/commands/sessions";
import { reconnectSession } from "./reconnectSession";

describe("reconnectSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessions.length = 0;
    mocks.sessions.push({
      id: 1,
      configId: "cfg1",
      name: "Local1",
      type: "local",
      isConnected: true,
      sessionType: { type: "local", config: {} },
    });
    mocks.savedConfigs.length = 0;
    mocks.savedConfigs.push({
      id: "cfg1",
      name: "Local1",
      version: 1,
      type: "local",
      config: { shell: "bash" },
    });
  });

  it("recreates session from saved config and swaps session ids in pane trees", async () => {
    const newInfo = {
      id: 99,
      name: "Local1",
      sessionType: { type: "local", config: {} },
      isConnected: true,
    } as any;
    vi.mocked(createLocal).mockResolvedValue(newInfo);

    const session = await reconnectSession(1);

    expect(createLocal).toHaveBeenCalled();
    expect(session.id).toBe(99);
    expect(session.configId).toBe("cfg1");
    expect(mocks.addSession).toHaveBeenCalled();
    expect(mocks.removeSession).toHaveBeenCalledWith(1);
    expect(mocks.setWorkspaces).toHaveBeenCalled();
    expect(closeBackend).toHaveBeenCalledWith(1);
  });

  it("throws when session not found", async () => {
    await expect(reconnectSession(999)).rejects.toThrow("Session not found");
  });

  it("throws when saved config missing", async () => {
    mocks.sessions.length = 0;
    mocks.sessions.push({
      id: 2,
      configId: "missing",
      name: "X",
      type: "local",
      isConnected: true,
      sessionType: { type: "local", config: {} },
    });
    mocks.savedConfigs.length = 0;
    await expect(reconnectSession(2)).rejects.toThrow("Saved config not found");
  });
});
