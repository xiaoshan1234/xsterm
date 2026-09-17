import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../infra/tauri/commands/sessions", () => ({
  writeSession: vi.fn(() => Promise.resolve()),
}));

import { writeSession } from "../../infra/tauri/commands/sessions";
import { writeSession as useCase } from "./writeSession";

describe("writeSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards id and data", async () => {
    await useCase(1, "abc");
    expect(writeSession).toHaveBeenCalledWith(1, "abc");
  });
});
