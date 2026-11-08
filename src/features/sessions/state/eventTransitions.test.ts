import { describe, expect, it } from "vitest";
import type { PaneNode, Window, Workspace } from "../../../models/legacy/terminal";
import { closeWindow, removeSessionsFromWorkspaces, renameWindow } from "./eventTransitions";

function leaf(id: string, terminalId?: number): PaneNode {
  return { id, type: "leaf", size: 100, terminalId };
}

function terminalWindow(id: string, xstermWindowId: number, terminalId: number): Window {
  const rootPane = leaf(`${id}-pane`, terminalId);
  return {
    id,
    name: `win-${id}`,
    rootPane,
    activePaneId: rootPane.id,
    windowType: "terminal",
    xstermWindowId,
  };
}

function workspaceWith(...windows: Window[]): Workspace {
  return {
    id: "ws-1",
    name: "workspace",
    windows,
    activeWindowId: windows[0]?.id ?? null,
    terminalIds: [],
  };
}

describe("removeSessionsFromWorkspaces", () => {
  it("clears the terminal from a single-leaf window and recomputes terminalIds", () => {
    const ws = workspaceWith(terminalWindow("w1", 1, 10));
    const [next] = removeSessionsFromWorkspaces([ws], [10]);
    expect(next.windows[0].rootPane.terminalId).toBeUndefined();
    expect(next.terminalIds).toEqual([]);
  });

  it("removes multiple terminals across windows", () => {
    const ws = workspaceWith(terminalWindow("w1", 1, 10), terminalWindow("w2", 2, 20));
    const [next] = removeSessionsFromWorkspaces([ws], [10, 20]);
    expect(next.windows.map((w) => w.rootPane.terminalId)).toEqual([undefined, undefined]);
    expect(next.terminalIds).toEqual([]);
  });
});

describe("renameWindow", () => {
  it("renames the matching xsterm window", () => {
    const ws = workspaceWith(terminalWindow("w1", 1, 10));
    const [next] = renameWindow([ws], 1, "renamed");
    expect(next.windows[0].name).toBe("renamed");
  });
});

describe("closeWindow", () => {
  it("replaces the only window with an init window", () => {
    const ws = workspaceWith(terminalWindow("w1", 1, 10));
    const [next] = closeWindow([ws], 1);
    expect(next.windows).toHaveLength(1);
    expect(next.windows[0].windowType).toBe("init");
    expect(next.terminalIds).toEqual([]);
  });

  it("shifts the active window to a remaining window", () => {
    const ws = workspaceWith(terminalWindow("w1", 1, 10), terminalWindow("w2", 2, 20));
    const [next] = closeWindow([ws], 1);
    expect(next.windows).toHaveLength(1);
    expect(next.activeWindowId).toBe("w2");
    expect(next.terminalIds).toEqual([20]);
  });
});
