import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../infra/tauri/commands/sessions", () => ({
  resizeSession: vi.fn(() => Promise.resolve()),
}));

import { resizeSession } from "../../infra/tauri/commands/sessions";
import { resizeSession as useCase } from "./resizeSession";

describe("resizeSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards id, rows, cols", async () => {
    await useCase(1, 24, 80);
    expect(resizeSession).toHaveBeenCalledWith(1, 24, 80);
  });
});