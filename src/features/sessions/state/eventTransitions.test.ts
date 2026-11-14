import { describe, expect, it } from "vitest";
import type { PaneNode, Window, Workspace } from "../../../models/legacy/terminal";
import {
  appendOrReplaceInitWindow,
  closeWindow,
  removeControllerFromWorkspaces,
  removeSessionsFromWorkspaces,
  renameWindow,
} from "./eventTransitions";

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

describe("removeControllerFromWorkspaces", () => {
  it("removes every window owned by the controller without touching other windows", () => {
    const ws = workspaceWith(
      terminalWindow("w1", 1, 10),
      terminalWindow("w2", 2, 11),
      terminalWindow("w3", 3, 20),
    );

    const [next] = removeControllerFromWorkspaces([ws], [10, 11]);

    expect(next.windows.map((window) => window.xstermWindowId)).toEqual([3]);
    expect(next.windows[0].name).toBe("win-w3");
    expect(next.activeWindowId).toBe("w3");
    expect(next.terminalIds).toEqual([20]);
  });

  it("keeps the remaining split pane when a controlled terminal shares a window", () => {
    const rootPane: PaneNode = {
      id: "split",
      type: "split",
      direction: "horizontal",
      size: 100,
      children: [leaf("pane-10", 10), leaf("pane-20", 20)],
    };
    const mixedWindow: Window = {
      id: "w1",
      name: "mixed",
      rootPane,
      activePaneId: "pane-10",
    };
    const [next] = removeControllerFromWorkspaces([workspaceWith(mixedWindow)], [10]);

    expect(next.windows).toHaveLength(1);
    expect(next.windows[0].rootPane.type).toBe("split");
    expect(next.windows[0].rootPane.children?.[0].terminalId).toBeUndefined();
    expect(next.windows[0].rootPane.children?.[1].terminalId).toBe(20);
    expect(next.windows[0].activePaneId).toBe("pane-20");
    expect(next.terminalIds).toEqual([20]);
  });

  it("adds an init window after its last controlled window closes", () => {
    const ws = workspaceWith(terminalWindow("w1", 1, 10));
    const [next] = removeControllerFromWorkspaces([ws], [10]);

    expect(next.windows).toHaveLength(1);
    expect(next.windows[0].windowType).toBe("init");
    expect(next.windows[0].name).toBe("New Terminal");
    expect(next.activeWindowId).toBe(next.windows[0].id);
    expect(next.terminalIds).toEqual([]);
  });
});

describe("appendOrReplaceInitWindow", () => {
  it("replaces the placeholder init window when it is the only window", () => {
    const initPane = leaf("init-pane");
    const workspace = workspaceWith({
      id: "init",
      name: "New Terminal",
      rootPane: initPane,
      activePaneId: initPane.id,
      windowType: "init",
    });
    const terminal = terminalWindow("tmux-1", 1, 10);

    const next = appendOrReplaceInitWindow(workspace, terminal);

    expect(next.windows).toEqual([terminal]);
    expect(next.activeWindowId).toBe("tmux-1");
    expect(next.terminalIds).toEqual([10]);
  });

  it("appends when the workspace already contains a terminal window", () => {
    const workspace = workspaceWith(terminalWindow("w1", 1, 10));
    const nextWindow = terminalWindow("w2", 2, 11);

    const next = appendOrReplaceInitWindow(workspace, nextWindow);

    expect(next.windows.map((window) => window.id)).toEqual(["w1", "w2"]);
    expect(next.activeWindowId).toBe("w2");
    expect(next.terminalIds).toEqual([10, 11]);
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
