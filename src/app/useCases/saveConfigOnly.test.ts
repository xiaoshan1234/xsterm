import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ upsertSavedConfig: vi.fn() }));

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: { getState: () => ({ upsertSavedConfig: mocks.upsertSavedConfig }) },
}));

import { saveConfigOnly } from "./saveConfigOnly";

describe("saveConfigOnly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves a local config", () => {
    const out = saveConfigOnly("local", { shell: "bash" });
    expect(out.type).toBe("local");
    expect(mocks.upsertSavedConfig).toHaveBeenCalled();
  });

  it("saves an SSH config with derived default name", () => {
    const out = saveConfigOnly(
      "ssh",
      { host: "h", port: 22, username: "u", auth_type: "password" },
    );
    expect(out.name).toBe("u@h");
    expect(mocks.upsertSavedConfig).toHaveBeenCalled();
  });

  it("saves a tmux config with derived name", () => {
    const out = saveConfigOnly("tmux-cc", { tmuxSessionName: "work" });
    expect(out.name).toBe("work");
    expect(mocks.upsertSavedConfig).toHaveBeenCalled();
  });
});