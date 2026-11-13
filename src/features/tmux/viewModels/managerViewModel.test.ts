import { describe, expect, it } from "vitest";
import { type SavedTerminalConfig } from "../../../models/legacy/terminal";
import { selectTmuxManagerItems } from "./managerViewModel";

describe("Tmux manager view model", () => {
  it("reports a native WSL transport", () => {
    const savedConfigs: SavedTerminalConfig[] = [
      {
        id: "wsl-base",
        name: "WSL",
        version: 1,
        type: "local",
        config: { shellTemplate: "wsl" },
      },
      {
        id: "tmux-wsl",
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
    ];

    expect(selectTmuxManagerItems(savedConfigs)[0]).toMatchObject({
      configId: "tmux-wsl",
      baseConfigName: "WSL",
      wslDistribution: "Debian",
      transport: "wsl",
    });
  });
});
