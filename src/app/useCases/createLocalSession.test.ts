import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../infra/tauri/commands/sessions", () => ({
  createLocal: vi.fn(),
}));

vi.mock("../../service/session/store", () => {
  const addSession = vi.fn();
  return {
    useSessionStore: {
      getState: () => ({ addSession }),
    },
  };
});

vi.mock("../../service/workspace/store", () => {
  const addWindow = vi.fn();
  return {
    useWorkspaceStore: {
      getState: () => ({
        workspaces: [{ id: "ws1" }],
        activeWorkspaceId: "ws1",
        addWindow,
      }),
    },
  };
});

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: {
    getState: () => ({ upsertSavedConfig: vi.fn() }),
  },
}));

import { createLocal } from "../../infra/tauri/commands/sessions";
import { useSessionStore } from "../../service/session/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import { usePersistenceStore } from "../../service/persistence/store";
import { createLocalSession } from "./createLocalSession";

describe("createLocalSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a backend session, adds it to the store, and binds it to a window", async () => {
    const mockInfo = {
      id: 42,
      name: "local-1",
      sessionType: { type: "local", config: {} },
      isConnected: true,
    } as any;
    vi.mocked(createLocal).mockResolvedValue(mockInfo);

    const session = await createLocalSession({ shell: "bash" });

    expect(createLocal).toHaveBeenCalledWith({ shell: "bash" });
    expect(useSessionStore.getState().addSession).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState().addWindow).toHaveBeenCalledTimes(1);
    expect(session.id).toBe(42);
    expect(session.name).toBe("local-1");
    expect(session.type).toBe("local");
  });

  it("propagates backend errors without mutating state", async () => {
    vi.mocked(createLocal).mockRejectedValue(new Error("IPC failed"));

    await expect(createLocalSession({ shell: "bash" })).rejects.toThrow("IPC failed");
    expect(useSessionStore.getState().addSession).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().addWindow).not.toHaveBeenCalled();
  });

  it("skips persistence when save=false", async () => {
    const mockInfo = {
      id: 1,
      name: "n",
      sessionType: { type: "local", config: {} },
      isConnected: true,
    } as any;
    vi.mocked(createLocal).mockResolvedValue(mockInfo);
    const upsertMock = vi.mocked(usePersistenceStore.getState().upsertSavedConfig);

    await createLocalSession({ shell: "bash" }, false);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
