import { describe, expect, it } from "vitest";
import { type Terminal, type Workspace } from "../../../models/legacy/terminal";
import { selectPaneTargetDisplayInfos } from "./paneTargetViewModel";

describe("pane target view model", () => {
  it("creates stable raw and tmux targets with human-readable metadata", () => {
    const terminals: Terminal[] = [
      {
        id: 1,
        configId: "local-1",
        name: "Local PowerShell",
        type: "local",
        isConnected: true,
        kind: { type: "local", shell: "pwsh.exe", cwd: "C:\\" },
        capabilities: {
          supportsResize: true,
          supportsReconnect: true,
          supportsLocalEcho: true,
          supportsMultiplex: false,
        },
      },
      {
        id: 2,
        configId: "",
        name: "tmux editor",
        type: "tmux-pane",
        isConnected: true,
        kind: { type: "tmux-pane", sessionId: 4, paneId: "%2" },
        tmuxSessionId: 4,
        tmuxWindowId: "@1",
        tmuxPaneId: "%2",
        capabilities: {
          supportsResize: true,
          supportsReconnect: true,
          supportsLocalEcho: false,
          supportsMultiplex: true,
        },
      },
    ];
    const workspaces: Workspace[] = [
      {
        id: "workspace-1",
        name: "Default",
        activeWindowId: "window-1",
        terminalIds: [1, 2],
        windows: [
          {
            id: "window-1",
            name: "Main",
            activePaneId: "pane-2",
            rootPane: {
              id: "split-1",
              type: "split",
              direction: "horizontal",
              size: 100,
              children: [
                { id: "pane-1", type: "leaf", size: 50, terminalId: 1, configId: "local-1" },
                { id: "pane-2", type: "leaf", size: 50, terminalId: 2 },
              ],
            },
          },
        ],
      },
    ];

    const result = selectPaneTargetDisplayInfos(workspaces, terminals, [
      {
        id: "local-1",
        name: "PowerShell",
        version: 1,
        type: "local",
        config: {},
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      target: {
        kind: "raw-pane",
        workspaceId: "workspace-1",
        windowId: "window-1",
        paneId: "pane-1",
      },
      displayId: "P1",
      title: "Local PowerShell",
      breadcrumb: "Default / 1. PowerShell / Pane 1",
      isAvailable: true,
    });
    expect(result[1]).toMatchObject({
      target: {
        kind: "tmux-pane",
        controllerId: 4,
        tmuxWindowId: "@1",
        tmuxPaneId: "%2",
      },
      technicalId: "@1/%2",
      breadcrumb: "Default / 1. Main / Pane 2",
    });
  });
});
