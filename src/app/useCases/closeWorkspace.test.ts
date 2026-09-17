import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  workspaces: [
    {
      id: "ws-default",
      name: "default",
      windows: [],
      activeWindowId: null,
      sessionIds: [],
    },
    {
      id: "ws-x",
      name: "X",
      windows: [],
      activeWindowId: null,
      sessionIds: [5, 7],
    },
  ] as Array<Record<string, unknown>>,
  setWorkspaces: vi.fn(),
  setActiveWorkspaceId: vi.fn(),
  setSessions: vi.fn(),
}));

vi.mock("../../infra/tauri/commands/sessions", () => ({
  closeSession: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../infra/buffers/sessionOutputBuffer", () => ({
  clearSessionOutput: vi.fn(),
}));
vi.mock("../../service/session/store", () => ({
  useSessionStore: { getState: () => ({ setSessions: mocks.setSessions }) },
}));
vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: { getState: () => ({ workspaces: mocks.workspaces, setWorkspaces: mocks.setWorkspaces, setActiveWorkspaceId: mocks.setActiveWorkspaceId }) },
}));

import { closeWorkspace } from "./closeWorkspace";

describe("closeWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes a non-default workspace and closes its sessions", () => {
    closeWorkspace("ws-x");
    expect(mocks.setWorkspaces).toHaveBeenCalledTimes(1);
    expect(mocks.setSessions).toHaveBeenCalledTimes(1);
  });

  it("ignores the default workspace", () => {
    closeWorkspace("ws-default");
    expect(mocks.setWorkspaces).not.toHaveBeenCalled();
  });
});