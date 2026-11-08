import { describe, expect, it } from "vitest";
import {
  type SavedTerminalConfig,
  type Terminal,
  type TerminalGroup,
  type Workspace,
} from "../../../models/legacy/terminal";
import { selectTerminalManagerGroups } from "./managerViewModel";
import { selectTerminalStatusItems } from "./statusViewModel";

const savedConfigs: SavedTerminalConfig[] = [
  {
    id: "local-1",
    name: "Local PowerShell",
    version: 1,
    type: "local",
    config: { shellTemplate: "powershell" },
  },
  {
    id: "ssh-1",
    name: "Production SSH",
    version: 1,
    type: "ssh",
    config: {
      host: "example.com",
      port: 22,
      username: "deploy",
      auth_type: "password",
    },
  },
  {
    id: "tmux-1",
    name: "tmux dev",
    version: 1,
    type: "tmux-pane",
    config: { baseConfigId: "local-1" },
  },
];

const groups: TerminalGroup[] = [
  { id: 0, name: "Ungrouped", configIds: [], collapsed: false },
  { id: 1, name: "Work", configIds: ["ssh-1"], collapsed: false },
];

const terminals: Terminal[] = [
  createTerminal(1, "Local PowerShell", "local-1", "local", true),
  createTerminal(2, "Production SSH", "ssh-1", "ssh", false),
  createTerminal(3, "tmux dev", "tmux-1", "tmux-pane", true, 4),
];

const workspaces: Workspace[] = [
  {
    id: "workspace-1",
    name: "Default",
    terminalIds: [1, 2, 3],
    activeWindowId: "window-1",
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
            {
              id: "pane-split",
              type: "split",
              direction: "vertical",
              size: 50,
              children: [
                { id: "pane-2", type: "leaf", size: 50, terminalId: 2, configId: "ssh-1" },
                { id: "pane-3", type: "leaf", size: 50, terminalId: 3, configId: "tmux-1" },
              ],
            },
          ],
        },
      },
    ],
  },
];

describe("terminal view models", () => {
  it("keeps tmux configs out of the terminal config manager and groups", () => {
    const result = selectTerminalManagerGroups(savedConfigs, groups);

    expect(result[0].items.map((item) => item.configId)).toEqual(["local-1"]);
    expect(result[1].items.map((item) => item.configId)).toEqual(["ssh-1"]);
    expect(result.flatMap((group) => group.items).some((item) => item.configId === "tmux-1")).toBe(
      false,
    );
  });

  it("derives terminal status and pane location from live state", () => {
    const result = selectTerminalStatusItems(terminals, workspaces, savedConfigs);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      terminalId: 1,
      status: "connected",
      configName: "Local PowerShell",
      location: {
        workspaceName: "Default",
        windowName: "Main",
        paneNumber: 1,
      },
    });
    expect(result[1]).toMatchObject({
      terminalId: 2,
      status: "disconnected",
      location: {
        paneNumber: 2,
      },
    });
  });
});

function createTerminal(
  id: number,
  name: string,
  configId: string,
  type: Terminal["type"],
  isConnected: boolean,
  tmuxSessionId?: number,
): Terminal {
  const kind: Terminal["kind"] =
    type === "tmux-pane"
      ? {
          type: "tmux-pane",
          sessionId: tmuxSessionId ?? 4,
          paneId: "%1",
        }
      : type === "ssh"
        ? {
            type: "ssh",
            host: "example.com",
            port: 22,
            user: "deploy",
          }
        : {
            type: "local",
            shell: "powershell.exe",
            cwd: "C:\\",
          };

  return {
    id,
    name,
    configId,
    type,
    isConnected,
    kind,
    capabilities: {
      supportsResize: true,
      supportsReconnect: true,
      supportsLocalEcho: type !== "tmux-pane",
      supportsMultiplex: type === "tmux-pane",
    },
    ...(type === "tmux-pane"
      ? {
          tmuxSessionId,
          tmuxPaneId: "%1",
          tmuxWindowId: "@1",
        }
      : {}),
  };
}
