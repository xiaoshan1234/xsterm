import { describe, expect, it } from "vitest";
import { type SavedTerminalConfig } from "../../../../models/legacy/terminal";
import { buildTmuxConfigForBase, isTmuxWslBaseConfig } from "./TmuxForm";

describe("tmux base transport", () => {
  it("maps a WSL shell base to the WSL tmux transport", () => {
    const base: SavedTerminalConfig = {
      id: "wsl-base",
      name: "WSL",
      version: 1,
      type: "local",
      config: { shellTemplate: "wsl" },
    };

    const config = buildTmuxConfigForBase(
      {
        baseConfigId: base.id,
        tmuxSessionName: "work",
        wslDistribution: " Debian ",
      },
      base,
    );

    expect(isTmuxWslBaseConfig(base)).toBe(true);
    expect(config).toMatchObject({
      baseConfigId: "wsl-base",
      tmuxSessionName: "work",
      transport: "wsl",
      wslDistribution: "Debian",
    });
    expect(config.ssh).toBeUndefined();
  });

  it("clears stale WSL fields when the base is a normal shell", () => {
    const base: SavedTerminalConfig = {
      id: "local-base",
      name: "PowerShell",
      version: 1,
      type: "local",
      config: { shellTemplate: "powershell" },
    };

    const config = buildTmuxConfigForBase(
      {
        baseConfigId: base.id,
        transport: "wsl",
        wslDistribution: "Debian",
      },
      base,
    );

    expect(config.transport).toBe("local");
    expect(config.wslDistribution).toBeUndefined();
  });

  it("keeps SSH transport when the base is an SSH config", () => {
    const base: SavedTerminalConfig = {
      id: "ssh-base",
      name: "SSH",
      version: 1,
      type: "ssh",
      config: {
        host: "example.com",
        port: 22,
        username: "dev",
        auth_type: "password",
      },
    };

    const config = buildTmuxConfigForBase({ baseConfigId: base.id }, base);

    expect(config.ssh).toMatchObject({ host: "example.com", username: "dev" });
    expect(config.transport).toBeUndefined();
  });
});
