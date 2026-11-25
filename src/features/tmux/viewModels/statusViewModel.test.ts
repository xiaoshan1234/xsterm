import { describe, expect, it } from "vitest";
import { createTerminalId } from "../../../models";
import type { Terminal, TmuxPaneTerminal } from "../../../features/terminal";
import type { SavedTerminalConfig } from "../../../features/launch-config";
import { selectTmuxStatusControllers } from "./statusViewModel";

describe("Tmux status view model", () => {
  it("groups panes by controller and tmux window", () => {
    const terminals: Terminal[] = [
      createTmuxTerminal(10, "%1", "@1", true, "cfg-1"),
      createTmuxTerminal(11, "%2", "@1", false, "cfg-1"),
      createTmuxTerminal(12, "%3", "@2", true, "cfg-1"),
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
    const result = selectTmuxStatusControllers(terminals, savedConfigs);

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
    const result = selectTmuxStatusControllers(terminals, []);

    expect(result[0]?.sessionName).toBe("work");
  });

  it("reports WSL as the controller transport", () => {
    const terminals = [createTmuxTerminal(10, "%1", "@1", true, "cfg-wsl")];
    const savedConfigs: SavedTerminalConfig[] = [
      {
        id: "cfg-wsl",
        name: "WSL tmux",
        version: 1,
        type: "tmux-pane",
        config: {
          tmuxSessionName: "work",
          transport: "wsl",
          wslDistribution: "Debian",
        },
      },
    ];

    const result = selectTmuxStatusControllers(terminals, savedConfigs);

    expect(result[0]?.transport).toBe("wsl");
  });

  it("maps tmux window/pane indices and command metadata", () => {
    const base = createTmuxTerminal(10, "%1", "@0", true);
    const terminal: Terminal = {
      ...base,
      tmux: {
        ...base.tmux!,
        windowName: "editor",
        windowIndex: 0,
        paneIndex: 1,
        width: 88,
        height: 1,
        command: "bash",
        isActive: true,
      },
    };
    const result = selectTmuxStatusControllers([terminal], []);

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
): TmuxPaneTerminal {
  return {
    id: createTerminalId(id),
    configId,
    name: `tmux ${paneId}`,
    type: "tmux-pane",
    isConnected,
    properties: {},
    kind: {
      type: "tmux-pane",
      sessionId: 4,
      paneId,
    },
    tmux: {
      controllerId: 4,
      paneId,
      windowId,
      ...(tmuxSessionName ? { sessionName: tmuxSessionName } : {}),
    },
    capabilities: {
      supportsResize: true,
      supportsReconnect: true,
      supportsLocalEcho: false,
      supportsMultiplex: true,
    },
  };
}
