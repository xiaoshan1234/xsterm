import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../infra/tauri/commands/tmux", () => ({
  killTmuxWindow: vi.fn(() => Promise.resolve()),
}));

import { killTmuxWindow } from "../../infra/tauri/commands/tmux";
import { killTmuxWindow as useCase } from "./killTmuxWindow";

describe("killTmuxWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the backend command with xstermWindowId", async () => {
    await useCase(11);
    expect(killTmuxWindow).toHaveBeenCalledWith(11);
  });
});
