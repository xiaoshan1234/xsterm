import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  addSession: vi.fn(),
  addWindow: vi.fn(),
}));

vi.mock("../../infra/tauri/commands/sessions", () => ({
  createLocal: vi.fn(),
}));

vi.mock("../../service/session/store", () => ({
  useSessionStore: { getState: () => ({ addSession: mocks.addSession }) },
}));

vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: {
    getState: () => ({ workspaces: [], activeWorkspaceId: null, addWindow: mocks.addWindow }),
  },
}));

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: { getState: () => ({ upsertSavedConfig: vi.fn() }) },
}));

import { createLocal } from "../../infra/tauri/commands/sessions";
import { createLocalSessionOnly } from "./createLocalSessionOnly";

describe("createLocalSessionOnly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a backend session without binding it to a window", async () => {
    const mockInfo = {
      id: 11,
      name: "n",
      sessionType: { type: "local", config: {} },
      isConnected: true,
    } as any;
    vi.mocked(createLocal).mockResolvedValue(mockInfo);

    const session = await createLocalSessionOnly({ shell: "bash" });

    expect(createLocal).toHaveBeenCalled();
    expect(mocks.addSession).toHaveBeenCalledTimes(1);
    // No window created.
    expect(mocks.addWindow).not.toHaveBeenCalled();
    expect(session.id).toBe(11);
  });

  it("propagates errors", async () => {
    vi.mocked(createLocal).mockRejectedValue(new Error("x"));
    await expect(createLocalSessionOnly({ shell: "bash" })).rejects.toThrow("x");
  });
});
