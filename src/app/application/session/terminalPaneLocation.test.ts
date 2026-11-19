import { describe, expect, it } from "vitest";
import type { Workspace } from "../../../features/workspace";
import { findTerminalPaneLocation, focusTerminalInWorkspaces } from "./terminalPaneLocation";

function createWorkspaces(): Workspace[] {
  return [
    {
      id: "workspace-1",
      name: "default",
      activeWindowId: "window-1",
      terminalIds: [11],
      windows: [
        {
          id: "window-1",
          name: "one",
          activePaneId: "pane-1",
          rootPane: { id: "pane-1", type: "leaf", size: 100, terminalId: 11 },
        },
      ],
    },
    {
      id: "workspace-2",
      name: "second",
      activeWindowId: "window-2",
      terminalIds: [22],
      windows: [
        {
          id: "window-2",
          name: "two",
          activePaneId: "pane-2",
          rootPane: { id: "pane-2", type: "leaf", size: 100, terminalId: 22 },
        },
      ],
    },
  ];
}

describe("terminalPaneLocation", () => {
  it("finds a terminal across workspaces and windows", () => {
    expect(findTerminalPaneLocation(createWorkspaces(), 22)).toEqual({
      workspaceId: "workspace-2",
      windowId: "window-2",
      paneId: "pane-2",
    });
  });

  it("returns undefined when the terminal is not attached", () => {
    expect(findTerminalPaneLocation(createWorkspaces(), 99)).toBeUndefined();
  });

  it("focuses the target workspace, window, and pane without mutating input", () => {
    const workspaces = createWorkspaces();
    workspaces[1].activeWindowId = null;
    workspaces[1].windows[0].activePaneId = "previous-pane";
    const focused = focusTerminalInWorkspaces(workspaces, {
      workspaceId: "workspace-2",
      windowId: "window-2",
      paneId: "pane-2",
    });

    expect(focused).not.toBe(workspaces);
    expect(focused[0]).toBe(workspaces[0]);
    expect(focused[1]).not.toBe(workspaces[1]);
    expect(focused[1]).toMatchObject({
      activeWindowId: "window-2",
      windows: [{ activePaneId: "pane-2" }],
    });
    expect(workspaces[1]).toMatchObject({
      activeWindowId: null,
      windows: [{ activePaneId: "previous-pane" }],
    });
  });
});
