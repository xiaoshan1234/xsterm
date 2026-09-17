import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  addSession: vi.fn(),
  addWindow: vi.fn(),
  upsertSavedConfig: vi.fn(),
}));

vi.mock("../../infra/tauri/commands/sessions", () => ({
  createSsh: vi.fn(),
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
  usePersistenceStore: { getState: () => ({ upsertSavedConfig: mocks.upsertSavedConfig }) },
}));

import { createSsh } from "../../infra/tauri/commands/sessions";
import { createSshSession } from "./createSshSession";

describe("createSshSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an SSH backend session, adds it to the store, and binds it to a window", async () => {
    const mockInfo = {
      id: 7,
      name: "user@host",
      sessionType: { type: "ssh", config: {} },
      isConnected: true,
    } as any;
    vi.mocked(createSsh).mockResolvedValue(mockInfo);

    const session = await createSshSession({
      host: "h",
      port: 22,
      username: "u",
      auth_type: "password",
    });

    expect(createSsh).toHaveBeenCalled();
    expect(mocks.addSession).toHaveBeenCalledTimes(1);
    expect(mocks.addWindow).toHaveBeenCalledTimes(1);
    expect(session.id).toBe(7);
    expect(session.type).toBe("ssh");
  });

  it("propagates backend errors", async () => {
    vi.mocked(createSsh).mockRejectedValue(new Error("SSH fail"));
    await expect(
      createSshSession({ host: "h", port: 22, username: "u", auth_type: "password" }),
    ).rejects.toThrow("SSH fail");
  });
});
