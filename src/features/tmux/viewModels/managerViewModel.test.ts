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

    const groups = selectTmuxManagerGroups(savedConfigs, new Set(["wsl:Debian|default|work"]));
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
          isOpen: true,
        },
        {
          configId: "tmux-wsl-codex",
          baseConfigId: "wsl-base",
          transport: "wsl",
          isOpen: false,
        },
      ],
    });
    expect(groups[1]).toMatchObject({
      key: "unassigned",
      name: "Unassigned",
      items: [{ configId: "tmux-unassigned" }],
    });
  });

  it("keeps display names unique", () => {
    const savedConfigs: SavedTerminalConfig[] = [
      {
        id: "tmux-1",
        name: "work:dev",
        version: 1,
        type: "tmux-pane",
        config: { tmuxSessionName: "work", socketName: "dev" },
      },
      {
        id: "tmux-2",
        name: "work:dev",
        version: 1,
        type: "tmux-pane",
        config: { tmuxSessionName: "work", socketName: "dev" },
      },
    ];

    const [group] = selectTmuxManagerGroups(savedConfigs);
    expect(group.items.map((item) => item.name)).toEqual(["work:dev", "work:dev (2)"]);
  });

  it("uses session:socket when the saved display name is empty", () => {
    const savedConfigs: SavedTerminalConfig[] = [
      {
        id: "tmux-1",
        name: "",
        version: 1,
        type: "tmux-pane",
        config: { tmuxSessionName: "codex", socketName: "dev" },
      },
    ];

    const [group] = selectTmuxManagerGroups(savedConfigs);
    expect(group.items[0].name).toBe("codex:dev");
  });
});
