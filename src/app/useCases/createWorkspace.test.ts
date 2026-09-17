import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  workspaces: [] as Array<Record<string, unknown>>,
  addWorkspace: vi.fn(),
  setActiveWorkspace: vi.fn(),
}));

vi.mock("../../service/session/store", () => ({
  useSessionStore: {
    getState: () => ({
      sessions: [
        {
          id: 1,
          configId: "c",
          name: "L",
          type: "local",
          isConnected: true,
          sessionType: { type: "local", config: {} },
        },
      ],
    }),
  },
}));
vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: {
    getState: () => ({
      workspaces: mocks.workspaces,
      addWorkspace: mocks.addWorkspace,
      setActiveWorkspace: mocks.setActiveWorkspace,
    }),
  },
}));

import { createWorkspace, createDefaultWorkspace } from "./createWorkspace";

describe("createWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspaces.length = 0;
  });

  it("creates a default workspace via variant=default", () => {
    const ws = createWorkspace({ variant: "default" });
    expect(ws.name).toBe("default");
    expect(mocks.addWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.setActiveWorkspace).toHaveBeenCalledTimes(1);
  });

  it("createDefaultWorkspace reuses an existing default", () => {
    mocks.workspaces.push({ id: "existing", name: "default" });
    const ws = createDefaultWorkspace();
    expect(ws.id).toBe("existing");
    expect(mocks.addWorkspace).not.toHaveBeenCalled();
  });

  it("creates a workspace from a session", () => {
    const ws = createWorkspace({ variant: "fromSession", sessionId: 1, configId: "c" });
    expect(ws.sessionIds).toContain(1);
    expect(mocks.addWorkspace).toHaveBeenCalled();
  });

  it("supports replacement variant", () => {
    const injected = {
      id: "replaced",
      name: "X",
      windows: [],
      activeWindowId: null,
      sessionIds: [],
    };
    createWorkspace({ variant: "replacement", workspace: injected as any });
    expect(mocks.addWorkspace).toHaveBeenCalledWith(injected);
  });
});
