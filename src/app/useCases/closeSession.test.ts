import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  removeSession: vi.fn(),
  setWorkspaces: vi.fn(),
}));

vi.mock("../../infra/tauri/commands/sessions", () => ({
  closeSession: vi.fn(),
}));

vi.mock("../../infra/buffers/sessionOutputBuffer", () => ({
  clearSessionOutput: vi.fn(),
}));

vi.mock("../../service/session/store", () => ({
  useSessionStore: { getState: () => ({ removeSession: mocks.removeSession }) },
}));

vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: { getState: () => ({ setWorkspaces: mocks.setWorkspaces }) },
}));

import { closeSession as closeSessionBackend } from "../../infra/tauri/commands/sessions";
import { clearSessionOutput } from "../../infra/buffers/sessionOutputBuffer";
import { closeSession } from "./closeSession";

describe("closeSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls backend close, clears buffer, removes from store, updates pane trees", async () => {
    vi.mocked(closeSessionBackend).mockResolvedValue(undefined);

    await closeSession(42);

    expect(closeSessionBackend).toHaveBeenCalledWith(42);
    expect(clearSessionOutput).toHaveBeenCalledWith(42);
    expect(mocks.removeSession).toHaveBeenCalledWith(42);
    expect(mocks.setWorkspaces).toHaveBeenCalledTimes(1);
  });

  it("still updates local state when backend close throws", async () => {
    vi.mocked(closeSessionBackend).mockRejectedValue(new Error("IPC fail"));

    await expect(closeSession(42)).resolves.toBeUndefined();
    expect(clearSessionOutput).toHaveBeenCalledWith(42);
    expect(mocks.removeSession).toHaveBeenCalledWith(42);
  });
});
