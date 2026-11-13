import { describe, expect, it } from "vitest";
import { type PaneNode, type Terminal, type Workspace } from "../../models/legacy/terminal";
import { selectRuntimeStatus } from "./runtimeStatusViewModel";

const pane: PaneNode = { id: "pane-1", type: "leaf", size: 1, terminalId: 7 };

function workspaceWithPane(activePaneId = pane.id): Workspace {
  return {
    id: "workspace-1",
    name: "Default",
    activeWindowId: "window-1",
    terminalIds: [7],
    windows: [
      {
        id: "window-1",
        name: "Main",
        rootPane: pane,
        activePaneId,
      },
    ],
  };
}

function terminal(overrides: Partial<Terminal> = {}): Terminal {
  return {
    id: 7,
    configId: "config-1",
    name: "Production SSH",
    type: "ssh",
    isConnected: true,
    kind: { type: "ssh", host: "example.com", port: 22, user: "dev" },
    ...overrides,
  };
}

describe("selectRuntimeStatus", () => {
  it("describes the active non-tmux pane", () => {
    expect(
      selectRuntimeStatus(
        workspaceWithPane(),
        [terminal()],
        [],
        new Map([[7, { rows: 24, cols: 80 }]]),
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
      tmuxSessionId: 3,
      tmuxPaneId: "%2",
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
                terminalId: 7,
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
      selectRuntimeStatus(
        workspaceWithPane(),
        [tmuxTerminal],
        controllers,
        new Map([[7, { rows: 40, cols: 120 }]]),
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
      selectRuntimeStatus(workspaceWithPane("missing"), [terminal()], [], new Map()),
    ).toBeNull();
  });
});
