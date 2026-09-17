import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../infra/tauri/commands/tmux", () => ({
  renameTmuxWindow: vi.fn(() => Promise.resolve()),
}));

import { renameTmuxWindow } from "../../infra/tauri/commands/tmux";
import { renameTmuxWindow as useCase } from "./renameTmuxWindow";

describe("renameTmuxWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards id and name", async () => {
    await useCase(11, "newname");
    expect(renameTmuxWindow).toHaveBeenCalledWith(11, "newname");
  });
});
