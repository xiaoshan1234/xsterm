import { describe, expect, it } from "vitest";
import { type SavedTerminalConfig } from "../../../models/legacy/terminal";
import { selectTmuxManagerGroups } from "./managerViewModel";

describe("Tmux manager view model", () => {
  it("groups tmux sessions by their base configuration", () => {
    const savedConfigs: SavedTerminalConfig[] = [
      {
        id: "wsl-base",
        name: "WSL",
        version: 1,
        type: "local",
        config: { shellTemplate: "wsl" },
      },
      {
        id: "tmux-wsl-work",
        name: "WSL work",
        version: 1,
        type: "tmux-pane",
        config: {
          baseConfigId: "wsl-base",
          tmuxSessionName: "work",
          transport: "wsl",
          wslDistribution: "Debian",
        },
      },
      {
        id: "tmux-wsl-codex",
        name: "WSL codex",
        version: 1,
        type: "tmux-pane",
        config: {
          baseConfigId: "wsl-base",
          tmuxSessionName: "codex",
          transport: "wsl",
          wslDistribution: "Debian",
        },
      },
      {
        id: "tmux-unassigned",
        name: "Legacy",
        version: 1,
        type: "tmux-pane",
        config: { tmuxSessionName: "legacy" },
      },
    ];

    const groups = selectTmuxManagerGroups(savedConfigs);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      key: "base:wsl-base",
      name: "WSL",
      items: [
        {
          configId: "tmux-wsl-work",
          baseConfigId: "wsl-base",
          wslDistribution: "Debian",
          transport: "wsl",
        },
        {
          configId: "tmux-wsl-codex",
          baseConfigId: "wsl-base",
          transport: "wsl",
        },
      ],
    });
    expect(groups[1]).toMatchObject({
      key: "unassigned",
      name: "Unassigned",
      items: [{ configId: "tmux-unassigned" }],
    });
  });
});
