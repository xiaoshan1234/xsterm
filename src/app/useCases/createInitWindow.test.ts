import { describe, it, expect } from "vitest";
import { createInitWindow } from "./createInitWindow";

describe("createInitWindow", () => {
  it("returns a Window with windowType=init and a single leaf pane", () => {
    const w = createInitWindow();
    expect(w.windowType).toBe("init");
    expect(w.name).toBe("New Session");
    expect(w.rootPane.type).toBe("leaf");
    expect(w.rootPane.size).toBe(100);
    expect(w.activePaneId).toBe(w.rootPane.id);
  });
});
