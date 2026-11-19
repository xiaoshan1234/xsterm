import { describe, expect, it } from "vitest";
import { createPaneId, createTerminalId, createWindowId, createWorkspaceId } from "../../../models";
import type { Window, Workspace } from "../contracts";
import { isApplicationError } from "../../../models/applicationError";
import { assertSessionNotUsedElsewhere, getUniqueWindowName } from "./windowOperations";

function leafWindow(id: string, terminalId?: number): Window {
  return {
    id: createWindowId(id),
    name: id,
    windowType: "terminal",
    activePaneId: createPaneId(`${id}-pane`),
    rootPane: {
      id: createPaneId(`${id}-pane`),
      type: "leaf",
      size: 100,
      ...(terminalId !== undefined ? { terminalId: createTerminalId(terminalId) } : {}),
    },
  };
}

function workspace(id: string, windows: Window[]): Workspace {
  return {
    id: createWorkspaceId(id),
    name: id,
    windows,
    activeWindowId: windows[0]?.id ?? null,
    terminalIds: [],
  };
}

describe("workspace window operations", () => {
  it("keeps the requested base window name", () => {
    expect(getUniqueWindowName([], createWorkspaceId("workspace"), "Window")).toBe("Window");
  });

  it("allows a terminal in its current window", () => {
    const target = workspace("work", [leafWindow("window", 42)]);
    expect(() =>
      assertSessionNotUsedElsewhere(
        [target],
        createWorkspaceId("work"),
        createWindowId("window"),
        createTerminalId(42),
      ),
    ).not.toThrow();
  });

  it("rejects a terminal already attached to another window", () => {
    const first = workspace("first", [leafWindow("window-1", 42)]);
    const second = workspace("second", [leafWindow("window-2", 42)]);

    try {
      assertSessionNotUsedElsewhere(
        [first, second],
        createWorkspaceId("second"),
        createWindowId("window-2"),
        createTerminalId(42),
      );
      throw new Error("Expected terminal-already-attached");
    } catch (error) {
      expect(isApplicationError(error, "terminal-already-attached")).toBe(true);
    }
  });
});
