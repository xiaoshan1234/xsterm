import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  addSession: vi.fn(),
  addWindow: vi.fn(),
}));

vi.mock("../../infra/tauri/commands/sessions", () => ({
  createSsh: vi.fn(),
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

import { createSsh } from "../../infra/tauri/commands/sessions";
import { createSshSessionOnly } from "./createSshSessionOnly";

describe("createSshSessionOnly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an SSH session without binding it to a window", async () => {
    const mockInfo = {
      id: 22,
      name: "n",
      sessionType: { type: "ssh", config: {} },
      isConnected: true,
    } as any;
    vi.mocked(createSsh).mockResolvedValue(mockInfo);

    const session = await createSshSessionOnly({
      host: "h",
      port: 22,
      username: "u",
      auth_type: "password",
    });

    expect(createSsh).toHaveBeenCalled();
    expect(mocks.addSession).toHaveBeenCalledTimes(1);
    expect(mocks.addWindow).not.toHaveBeenCalled();
    expect(session.id).toBe(22);
  });

  it("propagates errors", async () => {
    vi.mocked(createSsh).mockRejectedValue(new Error("x"));
    await expect(
      createSshSessionOnly({ host: "h", port: 22, username: "u", auth_type: "password" }),
    ).rejects.toThrow("x");
  });
});
