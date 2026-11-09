import { describe, expect, it } from "vitest";
import {
  type SavedTerminalConfig,
  type Terminal,
  type Workspace,
} from "../../../models/legacy/terminal";
import { selectTmuxStatusControllers } from "./statusViewModel";

describe("Tmux status view model", () => {
  it("groups panes by controller and tmux window", () => {
    const terminals: Terminal[] = [
      createTmuxTerminal(10, "%1", "@1", true, "cfg-1"),
      createTmuxTerminal(11, "%2", "@1", false, "cfg-1"),
      createTmuxTerminal(12, "%3", "@2", true, "cfg-1"),
    ];
    const workspaces: Workspace[] = [
      {
        id: "workspace-1",
        name: "Default",
        activeWindowId: "window-1",
        terminalIds: [10, 11, 12],
        windows: [
          {
            id: "window-1",
            name: "tmux",
            activePaneId: "pane-1",
            rootPane: {
              id: "split-1",
              type: "split",
              direction: "horizontal",
              size: 100,
              children: [
                { id: "pane-1", type: "leaf", size: 50, terminalId: 10 },
                {
                  id: "split-2",
                  type: "split",
                  direction: "vertical",
                  size: 50,
                  children: [
                    { id: "pane-2", type: "leaf", size: 50, terminalId: 11 },
                    { id: "pane-3", type: "leaf", size: 50, terminalId: 12 },
                  ],
                },
              ],
            },
          },
        ],
      },
    ];

    const savedConfigs: SavedTerminalConfig[] = [
      {
        id: "cfg-1",
        name: "Tmux dev",
        version: 1,
        type: "tmux-pane",
        config: { tmuxSessionName: "work" },
      },
    ];
    const result = selectTmuxStatusControllers(terminals, workspaces, savedConfigs);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      controllerId: 4,
      title: "Tmux dev",
      sessionName: "work",
      status: "connected",
      windows: [
        {
          tmuxWindowId: "@1",
          panes: [{ terminalId: 10 }, { terminalId: 11 }],
        },
        {
          tmuxWindowId: "@2",
          panes: [{ terminalId: 12 }],
        },
      ],
    });
  });

  it("prefers the session name carried by the terminal", () => {
    const terminals = [createTmuxTerminal(10, "%1", "@1", true, "", "work")];
    const result = selectTmuxStatusControllers(terminals, [], []);

    expect(result[0]?.sessionName).toBe("work");
  });

  it("maps tmux window/pane indices and command metadata", () => {
    const terminal: Terminal = {
      ...createTmuxTerminal(10, "%1", "@0", true),
      tmuxWindowName: "editor",
      tmuxWindowIndex: 0,
      tmuxPaneIndex: 1,
      tmuxPaneWidth: 88,
      tmuxPaneHeight: 1,
      tmuxPaneCommand: "bash",
      tmuxPaneActive: true,
    };
    const result = selectTmuxStatusControllers([terminal], [], []);

    expect(result[0]?.windows[0]).toMatchObject({
      tmuxWindowId: "@0",
      windowIndex: 0,
      name: "editor",
      panes: [
        {
          terminalId: 10,
          windowIndex: 0,
          paneIndex: 1,
          width: 88,
          height: 1,
          currentCommand: "bash",
          isActive: true,
        },
      ],
    });
  });
});

function createTmuxTerminal(
  id: number,
  paneId: string,
  windowId: string,
  isConnected: boolean,
  configId = "",
  tmuxSessionName?: string,
): Terminal {
  return {
    id,
    configId,
    name: `tmux ${paneId}`,
    type: "tmux-pane",
    isConnected,
    kind: {
      type: "tmux-pane",
      sessionId: 4,
      paneId,
    },
    tmuxSessionId: 4,
    tmuxPaneId: paneId,
    tmuxWindowId: windowId,
    ...(tmuxSessionName ? { tmuxSessionName } : {}),
    capabilities: {
      supportsResize: true,
      supportsReconnect: true,
      supportsLocalEcho: false,
      supportsMultiplex: true,
    },
  };
}
