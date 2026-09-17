import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../infra/tauri/commands/tmux", () => ({
  detachTmux: vi.fn(() => Promise.resolve()),
}));

import { detachTmux } from "../../infra/tauri/commands/tmux";
import { detachTmux as useCase } from "./detachTmux";

describe("detachTmux", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards controllerId", async () => {
    await useCase(7);
    expect(detachTmux).toHaveBeenCalledWith(7);
  });
});