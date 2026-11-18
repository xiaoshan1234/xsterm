import { describe, expect, it } from "vitest";
import { type Window, type Workspace } from "../../../models/runtime/terminal";
import { isApplicationError } from "../../../models/applicationError";
import { assertSessionNotUsedElsewhere, getUniqueWindowName } from "./windowOperations";

function leafWindow(id: string, terminalId?: number): Window {
  return {
    id,
    name: id,
    windowType: "terminal",
    activePaneId: `${id}-pane`,
    rootPane: {
      id: `${id}-pane`,
      type: "leaf",
      size: 100,
      terminalId,
    },
  };
}

function workspace(id: string, windows: Window[]): Workspace {
  return {
    id,
    name: id,
    windows,
    activeWindowId: windows[0]?.id ?? null,
    terminalIds: [],
  };
}

describe("workspace window operations", () => {
  it("keeps the requested base window name", () => {
    expect(getUniqueWindowName([], "workspace", "Window")).toBe("Window");
  });

  it("allows a terminal in its current window", () => {
    const target = workspace("work", [leafWindow("window", 42)]);
    expect(() => assertSessionNotUsedElsewhere([target], "work", "window", 42)).not.toThrow();
  });

  it("rejects a terminal already attached to another window", () => {
    const first = workspace("first", [leafWindow("window-1", 42)]);
    const second = workspace("second", [leafWindow("window-2", 42)]);

    try {
      assertSessionNotUsedElsewhere([first, second], "second", "window-2", 42);
      throw new Error("Expected terminal-already-attached");
    } catch (error) {
      expect(isApplicationError(error, "terminal-already-attached")).toBe(true);
    }
  });
});
