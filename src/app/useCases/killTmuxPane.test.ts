import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../infra/tauri/commands/tmux", () => ({
  killTmuxPane: vi.fn(() => Promise.resolve()),
}));

import { killTmuxPane } from "../../infra/tauri/commands/tmux";
import { killTmuxPane as useCase } from "./killTmuxPane";

describe("killTmuxPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards xstermSessionId", async () => {
    await useCase(8);
    expect(killTmuxPane).toHaveBeenCalledWith(8);
  });
});