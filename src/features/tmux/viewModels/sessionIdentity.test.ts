import { describe, expect, it } from "vitest";
import { createTerminalId } from "../../../models";
import type { SavedTerminalConfig, TmuxSessionConfig } from "../../launch-config";
import { findOpenTmuxControllerId } from "./sessionIdentity";

const wslConfig: TmuxSessionConfig = {
  baseConfigId: "wsl-base",
  transport: "wsl",
  wslDistribution: "Debian",
  tmuxSessionName: "work",
  socketName: "dev",
};

const tmuxConfig = (id: string, name: string): SavedTerminalConfig => ({
  id,
  name,
  version: 1,
  type: "tmux-pane",
  config: wslConfig,
});

describe("tmux session runtime identity", () => {
  it("finds an already-open controller for the same tmux session", () => {
    const savedConfigs = [tmuxConfig("one", "work:dev")];
    const terminals = [
      {
        id: createTerminalId(4),
        configId: "one",
        name: "work",
        type: "tmux-pane" as const,
        isConnected: true,
        kind: { type: "tmux-pane" as const, sessionId: 8, paneId: "%1" },
        tmux: { controllerId: 8, paneId: "%1" },
      },
    ];
    expect(
      findOpenTmuxControllerId(
        { ...wslConfig, name: "another display name" },
        savedConfigs,
        new Map([[8, "one"]]),
        new Map([[8, wslConfig]]),
        terminals,
      ),
    ).toBe(8);
  });
});
