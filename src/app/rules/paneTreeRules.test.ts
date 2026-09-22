import { describe, expect, it } from "vitest";
import type { PaneLeafNode, PaneSplitNode } from "../../model/pane";
import type { TerminalWindow, Workspace } from "../../model";
import { findSessionWindow, isSessionUsedInOtherWindow } from "./paneTreeRules";

function leaf(size: number, sessionId?: number): PaneLeafNode {
  return {
    id: `leaf-${size}-${sessionId ?? "x"}`,
    kind: "leaf",
    size,
    binding: sessionId !== undefined ? { sessionId, configId: "" } : undefined,
  };
}

function workspace(id: string, windows: Workspace["windows"]): Workspace {
  return { id, name: id, windows, activeWindowId: null };
}

describe("findSessionWindow", () => {
  it("locates the workspace/window holding the session", () => {
    const w1 = workspace("ws1", [
      {
        id: "w1-a",
        name: "A",
        kind: "terminal",
        rootPane: leaf(1, 5),
        activePaneId: null,
      },
    ]);
    const w2 = workspace("ws2", [
      {
        id: "w2-a",
        name: "A",
        kind: "terminal",
        rootPane: leaf(1, 9),
        activePaneId: null,
      },
    ]);
    expect(findSessionWindow([w1, w2], 9)).toEqual({ workspaceId: "ws2", windowId: "w2-a" });
  });

  it("returns null when no window contains the session", () => {
    expect(findSessionWindow([workspace("ws", [])], 99)).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(findSessionWindow([], 1)).toBeNull();
  });

  it("returns the first match when the session appears in multiple panes", () => {
    const split: PaneSplitNode = {
      id: "split",
      kind: "split",
      size: 2,
      layout: { direction: "horizontal", children: [leaf(1, 42), leaf(1, 42)] },
    };
    const window: TerminalWindow = {
      id: "w1",
      name: "W1",
      kind: "terminal",
      rootPane: split,
      activePaneId: null,
    };
    const ws = workspace("ws", [window]);
    expect(findSessionWindow([ws], 42)).toEqual({ workspaceId: "ws", windowId: "w1" });
  });
});

describe("isSessionUsedInOtherWindow", () => {
  const ws1 = workspace("ws1", [
    {
      id: "w1-a",
      name: "A",
      kind: "terminal",
      rootPane: leaf(1, 5),
      activePaneId: null,
    },
  ]);
  const ws2 = workspace("ws2", [
    {
      id: "w2-a",
      name: "A",
      kind: "terminal",
      rootPane: leaf(1, 5),
      activePaneId: null,
    },
  ]);

  it("is true when used in a different window", () => {
    expect(isSessionUsedInOtherWindow([ws1, ws2], "ws1", "w1-a", 5)).toBe(true);
  });

  it("treats null current ids as 'no current window' -> true if found anywhere", () => {
    expect(isSessionUsedInOtherWindow([ws1], null, null, 5)).toBe(true);
  });

  it("is false when the session is not present in any window", () => {
    expect(isSessionUsedInOtherWindow([ws1, ws2], "ws1", "w1-a", 99)).toBe(false);
  });

  it("is false when the session is only in the current window (current ids match)", () => {
    expect(isSessionUsedInOtherWindow([ws1], "ws1", "w1-a", 5)).toBe(false);
  });
});
