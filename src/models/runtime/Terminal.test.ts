import { describe, expect, it } from "vitest";
import type { LocalTerminalConfig, SshConfig, SavedTerminalConfig } from "./terminal";

describe("LocalTerminalConfig — name field", () => {
  it("accepts an explicit name", () => {
    const config: LocalTerminalConfig = { name: "my-shell", shell: "/bin/zsh" };
    expect(config.name).toBe("my-shell");
  });

  it("allows name to be omitted", () => {
    const config: LocalTerminalConfig = { shell: "/bin/bash" };
    expect(config.name).toBeUndefined();
  });

  it("round-trips through JSON.stringify/parse preserving name", () => {
    const original: LocalTerminalConfig = {
      name: "dev",
      shell: "/bin/zsh",
      cwd: "/home/me",
      args: ["-l"],
    };
    const json = JSON.stringify(original);
    expect(json).toContain('"name":"dev"');
    const parsed = JSON.parse(json) as LocalTerminalConfig;
    expect(parsed.name).toBe("dev");
    expect(parsed.shell).toBe("/bin/zsh");
    expect(parsed.cwd).toBe("/home/me");
    expect(parsed.args).toEqual(["-l"]);
  });

  it("round-trips without a name field when omitted", () => {
    const original: LocalTerminalConfig = { shell: "/bin/bash" };
    const json = JSON.stringify(original);
    expect(json).not.toContain('"name"');
    const parsed = JSON.parse(json) as LocalTerminalConfig;
    expect(parsed.name).toBeUndefined();
    expect(parsed.shell).toBe("/bin/bash");
  });

  it("preserves empty-string name as-is (caller decides fallback)", () => {
    const config: LocalTerminalConfig = { name: "" };
    const parsed = JSON.parse(JSON.stringify(config)) as LocalTerminalConfig;
    expect(parsed.name).toBe("");
  });
});

describe("SshConfig — name field", () => {
  it("accepts an explicit name", () => {
    const config: SshConfig = {
      name: "production",
      host: "h.example.com",
      port: 22,
      username: "ops",
      auth_type: "password",
      password: "secret",
    };
    expect(config.name).toBe("production");
  });

  it("allows name to be omitted", () => {
    const config: SshConfig = {
      host: "h.example.com",
      port: 22,
      username: "ops",
      auth_type: "password",
      password: "secret",
    };
    expect(config.name).toBeUndefined();
  });

  it("round-trips through JSON.stringify/parse preserving name", () => {
    const original: SshConfig = {
      name: "production-bastion",
      host: "bastion.example.com",
      port: 2222,
      username: "deploy",
      auth_type: "key",
      key_file: "/home/deploy/.ssh/id_ed25519",
      passphrase: "secret",
    };
    const json = JSON.stringify(original);
    expect(json).toContain('"name":"production-bastion"');
    const parsed = JSON.parse(json) as SshConfig;
    expect(parsed.name).toBe("production-bastion");
    expect(parsed.host).toBe("bastion.example.com");
    expect(parsed.port).toBe(2222);
    expect(parsed.username).toBe("deploy");
    expect(parsed.auth_type).toBe("key");
    expect(parsed.key_file).toBe("/home/deploy/.ssh/id_ed25519");
  });

  it("round-trips without a name field when omitted", () => {
    const original: SshConfig = {
      host: "h.example.com",
      port: 22,
      username: "u",
      auth_type: "password",
      password: "p",
    };
    const json = JSON.stringify(original);
    expect(json).not.toContain('"name"');
    const parsed = JSON.parse(json) as SshConfig;
    expect(parsed.name).toBeUndefined();
  });
});

describe("SavedTerminalConfig — shape compatibility", () => {
  it("local saved config embeds LocalTerminalConfig with optional name", () => {
    const saved: SavedTerminalConfig = {
      id: "cfg-1",
      name: "Display Name",
      version: 1,
      type: "local",
      config: { name: "Internal Name", shell: "/bin/bash" } as LocalTerminalConfig,
    };
    const parsed = JSON.parse(JSON.stringify(saved)) as SavedTerminalConfig;
    expect(parsed.id).toBe("cfg-1");
    expect(parsed.name).toBe("Display Name");
    expect(parsed.type).toBe("local");
    if (parsed.type === "local") {
      expect(parsed.config.name).toBe("Internal Name");
      expect(parsed.config.shell).toBe("/bin/bash");
    }
  });

  it("ssh saved config embeds SshConfig with optional name", () => {
    const saved: SavedTerminalConfig = {
      id: "cfg-2",
      name: "Bastion",
      version: 1,
      type: "ssh",
      config: {
        name: "prod",
        host: "bastion.example.com",
        port: 22,
        username: "ops",
        auth_type: "password",
        password: "p",
      } as SshConfig,
    };
    const parsed = JSON.parse(JSON.stringify(saved)) as SavedTerminalConfig;
    expect(parsed.type).toBe("ssh");
    if (parsed.type === "ssh") {
      expect(parsed.config.name).toBe("prod");
      expect(parsed.config.host).toBe("bastion.example.com");
    }
  });
});
