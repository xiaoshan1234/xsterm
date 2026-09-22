import { describe, it, expect } from "vitest";
import { createInitWindow } from "./createInitWindow";

describe("createInitWindow", () => {
  it("returns a Window with kind=init and an empty active-pane", () => {
    const w = createInitWindow();
    expect(w.kind).toBe("init");
    expect(w.name).toBe("New Session");
    expect(w.activePaneId).toBeNull();
  });
});
