import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../infra/tauri/commands/tmux", () => ({
  createTmuxWindow: vi.fn(() => Promise.resolve()),
}));

import { createTmuxWindow } from "../../infra/tauri/commands/tmux";
import { createTmuxWindow as useCase } from "./createTmuxWindow";

describe("createTmuxWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the backend command", async () => {
    await useCase(7, "win");
    expect(createTmuxWindow).toHaveBeenCalledWith(7, "win");
  });

  it("propagates errors", async () => {
    vi.mocked(createTmuxWindow).mockRejectedValueOnce(new Error("x"));
    await expect(useCase(7)).rejects.toThrow("x");
  });
});
