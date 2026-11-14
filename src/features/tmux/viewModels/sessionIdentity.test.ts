import { describe, expect, it } from "vitest";
import { type SavedTerminalConfig, type TmuxSessionConfig } from "../../../models/legacy/terminal";
import {
  defaultTmuxDisplayName,
  findOpenTmuxControllerId,
  generatedTmuxSessionName,
  isTmuxDisplayNameAvailable,
  tmuxSessionBaseKey,
  tmuxSessionKey,
  uniqueTmuxDisplayName,
} from "./sessionIdentity";

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

describe("tmux session identity", () => {
  it("uses transport, socket and session name for identity", () => {
    expect(tmuxSessionKey(wslConfig)).toBe("wsl:Debian|dev|work");
    expect(tmuxSessionBaseKey(wslConfig)).toBe("wsl-base|dev|work");
    expect(tmuxSessionKey({ ...wslConfig, socketName: undefined })).toBe("wsl:Debian|default|work");
  });

  it("builds a session:socket default display name", () => {
    expect(defaultTmuxDisplayName(wslConfig)).toBe("work:dev");
    expect(defaultTmuxDisplayName({ tmuxSessionName: "codex" })).toBe("codex:default");
    expect(generatedTmuxSessionName()).toMatch(/^xsterm-[0-9a-f]{8}$/);
  });

  it("keeps tmux display names unique", () => {
    const configs = [tmuxConfig("one", "work:dev"), tmuxConfig("two", "work:dev (2)")];
    const scope = { baseConfigId: "wsl-base" };
    expect(isTmuxDisplayNameAvailable("work:dev", configs, scope)).toBe(false);
    expect(uniqueTmuxDisplayName("work:dev", configs, scope)).toBe("work:dev (3)");
    expect(
      uniqueTmuxDisplayName("work:dev", configs, {
        ...scope,
        excludeConfigId: "one",
      }),
    ).toBe("work:dev");
  });

  it("allows the same display name in different base groups", () => {
    const configs = [tmuxConfig("one", "work:dev")];
    expect(
      isTmuxDisplayNameAvailable("work:dev", configs, {
        baseConfigId: "ssh-base",
      }),
    ).toBe(true);
  });

  it("finds an already-open controller for the same tmux session", () => {
    const savedConfigs = [tmuxConfig("one", "work:dev")];
    const terminals = [
      {
        id: 4,
        configId: "one",
        name: "work",
        type: "tmux-pane" as const,
        isConnected: true,
        kind: { type: "tmux-pane" as const, sessionId: 8, paneId: "%1" },
        tmuxSessionId: 8,
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
