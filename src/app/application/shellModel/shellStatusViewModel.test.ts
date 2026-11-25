import { describe, expect, it } from "vitest";
import { createPaneId, createTerminalId, createWindowId, createWorkspaceId } from "../../../models";
import type { Terminal } from "../../../features/terminal";
import type { EditablePaneNode } from "../../../features/workspace";
import type { Workspace } from "../../../features/workspace";
import { selectShellStatus } from "./shellStatusViewModel";

const pane: EditablePaneNode = {
  id: createPaneId("pane-1"),
  type: "leaf",
  size: 1,
  terminalId: createTerminalId(7),
};

function workspaceWithPane(activePaneId = pane.id): Workspace {
  return {
    id: createWorkspaceId("workspace-1"),
    name: "Default",
    activeWindowId: createWindowId("window-1"),
    terminalIds: [createTerminalId(7)],
    windows: [
      {
        id: createWindowId("window-1"),
        name: "Main",
        rootPane: pane,
        activePaneId,
      },
    ],
  };
}

function terminal(overrides: Partial<Terminal> = {}): Terminal {
  return {
    id: createTerminalId(7),
    configId: "config-1",
    name: "Production SSH",
    type: "ssh",
    isConnected: true,
    kind: { type: "ssh", host: "example.com", port: 22, user: "dev" },
    properties: {},
    ...overrides,
  } as Terminal;
}

describe("selectShellStatus", () => {
  it("describes the active non-tmux pane", () => {
    expect(
      selectShellStatus(
        workspaceWithPane(),
        [terminal()],
        [],
        new Map([[createTerminalId(7), { rows: 24, cols: 80 }]]),
      ),
    ).toEqual({
      terminalId: 7,
      status: "connected",
      name: "Production SSH",
      kind: "SSH",
      detail: "dev@example.com / Main",
      size: { rows: 24, cols: 80 },
      paneNumber: 1,
      paneCount: 1,
    });
  });

  it("uses the tmux session, window and active command hierarchy", () => {
    const tmuxTerminal = terminal({
      type: "tmux-pane",
      name: "terminal",
      tmux: { controllerId: 3, paneId: "%2" },
    });
    const controllers = [
      {
        controllerId: 3,
        title: "dev",
        sessionName: "work",
        status: "connected" as const,
        transport: "wsl" as const,
        windows: [
          {
            tmuxWindowId: "@1",
            name: "editor",
            status: "connected" as const,
            panes: [
              {
                terminalId: createTerminalId(7),
                tmuxPaneId: "%2",
                tmuxWindowId: "@1",
                currentCommand: "codex",
                title: "terminal",
                status: "connected" as const,
              },
            ],
          },
        ],
      },
    ];

    expect(
      selectShellStatus(
        workspaceWithPane(),
        [tmuxTerminal],
        controllers,
        new Map([[createTerminalId(7), { rows: 40, cols: 120 }]]),
      ),
    ).toEqual({
      terminalId: 7,
      status: "connected",
      name: "codex",
      kind: "WSL tmux",
      detail: "work / editor / %2",
      size: { rows: 40, cols: 120 },
      paneNumber: 1,
      paneCount: 1,
    });
  });

  it("returns null when the active pane is not a live terminal", () => {
    expect(
      selectShellStatus(workspaceWithPane(createPaneId("missing")), [terminal()], [], new Map()),
    ).toBeNull();
  });
});
