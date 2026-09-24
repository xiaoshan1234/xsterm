import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  groups: [{ id: 1, name: "g1", configIds: ["cfg1", "cfg2"], isCollapsed: false }] as Array<{
    id: number;
    name: string;
    configIds: string[];
    isCollapsed: boolean;
  }>,
  savedConfigs: [{ id: "cfg1", name: "L", version: 1, type: "local", config: {} }] as Array<
    Record<string, unknown>
  >,
  sessions: [
    {
      id: 5,
      configId: "cfg1",
      name: "L",
      type: "local",
      isConnected: true,
      sessionType: { type: "local", config: {} },
    },
  ] as Array<Record<string, unknown>>,
  removeSavedConfig: vi.fn(),
  setGroups: vi.fn(),
  removeSession: vi.fn(),
  setWorkspaces: vi.fn(),
}));

vi.mock("../../infra/tauri/commands/sessions", () => ({
  closeSession: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../infra/buffers/sessionOutputBuffer", () => ({
  clearSessionOutput: vi.fn(),
}));
vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: {
    getState: () => ({
      savedConfigs: mocks.savedConfigs,
      groups: mocks.groups,
      removeSavedConfig: mocks.removeSavedConfig,
      setGroups: mocks.setGroups,
    }),
  },
}));
vi.mock("../../service/session/store", () => ({
  useSessionStore: {
    getState: () => ({ sessions: mocks.sessions, removeSession: mocks.removeSession }),
  },
}));
vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: { getState: () => ({ setWorkspaces: mocks.setWorkspaces }) },
}));

import { removeConfig } from "./removeConfig";

describe("removeConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes a config with a live session bound", () => {
    removeConfig("cfg1");
    expect(mocks.removeSavedConfig).toHaveBeenCalledWith("cfg1");
    expect(mocks.setGroups).toHaveBeenCalled();
    expect(mocks.removeSession).toHaveBeenCalledWith(5);
    expect(mocks.setWorkspaces).toHaveBeenCalled();
  });

  it("removes a config with no live session", () => {
    removeConfig("cfg2");
    expect(mocks.removeSavedConfig).toHaveBeenCalledWith("cfg2");
    expect(mocks.removeSession).not.toHaveBeenCalled();
  });
});
