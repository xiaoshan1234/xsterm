import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../infra/tauri/commands/tmux", () => ({
  unmarkAttachedTmux: vi.fn(() => Promise.resolve()),
}));

import { unmarkAttachedTmux } from "../../infra/tauri/commands/tmux";
import { unmarkAttachedTmux as useCase } from "./unmarkAttachedTmux";

describe("unmarkAttachedTmux", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards controllerId", async () => {
    await useCase(7);
    expect(unmarkAttachedTmux).toHaveBeenCalledWith(7);
  });
});
