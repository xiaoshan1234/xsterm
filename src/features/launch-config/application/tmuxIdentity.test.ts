import { describe, expect, it } from "vitest";
import type { SavedTerminalConfig, TmuxSessionConfig } from "../contracts";
import {
  defaultTmuxDisplayName,
  generatedTmuxSessionName,
  isTmuxDisplayNameAvailable,
  tmuxSessionBaseKey,
  tmuxSessionKey,
  uniqueTmuxDisplayName,
} from "./tmuxIdentity";

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

describe("tmux config identity", () => {
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
});
