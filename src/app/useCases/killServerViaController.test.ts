import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../infra/tauri/commands/tmux", () => ({
  killServerViaController: vi.fn(() => Promise.resolve()),
}));

import { killServerViaController } from "../../infra/tauri/commands/tmux";
import { killServerViaController as useCase } from "./killServerViaController";

describe("killServerViaController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards controllerId", async () => {
    await useCase(7);
    expect(killServerViaController).toHaveBeenCalledWith(7);
  });
});
