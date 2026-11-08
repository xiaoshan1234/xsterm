import { describe, expect, it } from "vitest";
import { type Terminal, type Workspace } from "../../../models/legacy/terminal";
import { selectTmuxStatusControllers } from "./statusViewModel";

describe("tmux status view model", () => {
  it("groups panes by controller and tmux window", () => {
    const terminals: Terminal[] = [
      createTmuxTerminal(10, "%1", "@1", true),
      createTmuxTerminal(11, "%2", "@1", false),
      createTmuxTerminal(12, "%3", "@2", true),
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

    const result = selectTmuxStatusControllers(terminals, workspaces, []);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      controllerId: 4,
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
});

function createTmuxTerminal(
  id: number,
  paneId: string,
  windowId: string,
  isConnected: boolean,
): Terminal {
  return {
    id,
    configId: "",
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
    capabilities: {
      supportsResize: true,
      supportsReconnect: true,
      supportsLocalEcho: false,
      supportsMultiplex: true,
    },
  };
}
