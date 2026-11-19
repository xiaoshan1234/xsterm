import { describe, expect, it } from "vitest";
import { createPaneId, createTerminalId, createWindowId, createWorkspaceId } from "../../../models";
import type { Workspace } from "../../../features/workspace";
import { findTerminalPaneLocation, focusTerminalInWorkspaces } from "./terminalPaneLocation";

function createWorkspaces(): Workspace[] {
  return [
    {
      id: createWorkspaceId("workspace-1"),
      name: "default",
      activeWindowId: createWindowId("window-1"),
      terminalIds: [createTerminalId(11)],
      windows: [
        {
          id: createWindowId("window-1"),
          name: "one",
          activePaneId: createPaneId("pane-1"),
          rootPane: {
            id: createPaneId("pane-1"),
            type: "leaf",
            size: 100,
            terminalId: createTerminalId(11),
          },
        },
      ],
    },
    {
      id: createWorkspaceId("workspace-2"),
      name: "second",
      activeWindowId: createWindowId("window-2"),
      terminalIds: [createTerminalId(22)],
      windows: [
        {
          id: createWindowId("window-2"),
          name: "two",
          activePaneId: createPaneId("pane-2"),
          rootPane: {
            id: createPaneId("pane-2"),
            type: "leaf",
            size: 100,
            terminalId: createTerminalId(22),
          },
        },
      ],
    },
  ];
}

describe("terminalPaneLocation", () => {
  it("finds a terminal across workspaces and windows", () => {
    expect(findTerminalPaneLocation(createWorkspaces(), createTerminalId(22))).toEqual({
      workspaceId: "workspace-2",
      windowId: "window-2",
      paneId: "pane-2",
    });
  });

  it("returns undefined when the terminal is not attached", () => {
    expect(findTerminalPaneLocation(createWorkspaces(), createTerminalId(99))).toBeUndefined();
  });

  it("focuses the target workspace, window, and pane without mutating input", () => {
    const workspaces = createWorkspaces();
    workspaces[1].activeWindowId = null;
    workspaces[1].windows[0].activePaneId = createPaneId("previous-pane");
    const focused = focusTerminalInWorkspaces(workspaces, {
      workspaceId: createWorkspaceId("workspace-2"),
      windowId: createWindowId("window-2"),
      paneId: createPaneId("pane-2"),
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
