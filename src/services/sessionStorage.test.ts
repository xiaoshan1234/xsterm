import { describe, expect, it } from "vitest";
import {
  migrateSavedConfig,
  migrateSavedConfigList,
  SAVED_SESSION_CONFIG_VERSION,
} from "./sessionStorage";

describe("SAVED_SESSION_CONFIG_VERSION", () => {
  it("is 1 (the current on-disk schema version)", () => {
    expect(SAVED_SESSION_CONFIG_VERSION).toBe(1);
  });
});

describe("migrateSavedConfig — legacy v0 → v1", () => {
  it("converts legacy local shape into v1 with config field", () => {
    const raw = {
      id: "cfg-1",
      name: "bash",
      type: "local",
      localConfig: { shell: "/bin/bash", cwd: "/home/me" },
    };
    const result = migrateSavedConfig(raw);
    expect(result).toEqual({
      id: "cfg-1",
      name: "bash",
      version: 1,
      type: "local",
      config: { shell: "/bin/bash", cwd: "/home/me" },
    });
  });

  it("converts legacy ssh shape into v1 with config field", () => {
    const raw = {
      id: "cfg-2",
      name: "prod",
      type: "ssh",
      sshConfig: {
        host: "example.com",
        port: 22,
        username: "alice",
        auth_type: "key",
        key_file: "/keys/id_ed25519",
      },
    };
    const result = migrateSavedConfig(raw);
    expect(result).toEqual({
      id: "cfg-2",
      name: "prod",
      version: 1,
      type: "ssh",
      config: {
        host: "example.com",
        port: 22,
        username: "alice",
        auth_type: "key",
        key_file: "/keys/id_ed25519",
      },
    });
  });

  it("preserves displayConfig on legacy local shape", () => {
    const raw = {
      id: "cfg-3",
      name: "bash-styled",
      type: "local",
      localConfig: { shell: "zsh" },
      displayConfig: { fontSize: 14, cursorStyle: "bar" },
    };
    const result = migrateSavedConfig(raw);
    expect(result?.displayConfig).toEqual({ fontSize: 14, cursorStyle: "bar" });
  });

  it("preserves displayConfig on legacy ssh shape", () => {
    const raw = {
      id: "cfg-4",
      name: "prod-styled",
      type: "ssh",
      sshConfig: { host: "h", port: 22, username: "u", auth_type: "password", password: "p" },
      displayConfig: { scrollback: 5000 },
    };
    const result = migrateSavedConfig(raw);
    expect(result?.displayConfig).toEqual({ scrollback: 5000 });
  });
});

describe("migrateSavedConfig — new v1 pass-through", () => {
  it("accepts a v1 local config unchanged", () => {
    const raw = {
      id: "cfg-5",
      name: "fish",
      version: 1,
      type: "local",
      config: { shell: "/usr/bin/fish" },
    };
    const result = migrateSavedConfig(raw);
    expect(result).toEqual({
      id: "cfg-5",
      name: "fish",
      version: 1,
      type: "local",
      config: { shell: "/usr/bin/fish" },
    });
  });

describe("SSHSessionConfig — round-trip with knownHostsPath and proxyJump", () => {
  it("preserves knownHostsPath and proxyJump in a v1 ssh config pass-through", () => {
    const raw = {
      id: "cfg-ssh-new",
      name: "bastion",
      version: 1,
      type: "ssh",
      config: {
        host: "bastion.example.com",
        port: 22,
        username: "alice",
        auth_type: "key",
        key_file: "/k",
        knownHostsPath: "/home/alice/.ssh/known_hosts",
        proxyJump: "jump@example.com",
      },
    };
    const result = migrateSavedConfig(raw);
    expect(result?.config).toMatchObject({
      host: "bastion.example.com",
      port: 22,
      username: "alice",
      auth_type: "key",
      key_file: "/k",
      knownHostsPath: "/home/alice/.ssh/known_hosts",
      proxyJump: "jump@example.com",
    });
  });

  it("preserves v1 ssh config when knownHostsPath and proxyJump are absent", () => {
    const raw = {
      id: "cfg-ssh-plain",
      name: "plain-ssh",
      version: 1,
      type: "ssh",
      config: {
        host: "h",
        port: 22,
        username: "u",
        auth_type: "password",
        password: "p",
      },
    };
    const result = migrateSavedConfig(raw);
    expect(result?.config).not.toHaveProperty("knownHostsPath");
    expect(result?.config).not.toHaveProperty("proxyJump");
  });
});

  it("accepts a v1 ssh config unchanged", () => {
    const raw = {
      id: "cfg-6",
      name: "dev",
      version: 1,
      type: "ssh",
      config: { host: "dev.local", port: 2222, username: "dev", auth_type: "key", key_file: "/k" },
    };
    const result = migrateSavedConfig(raw);
    expect(result?.config).toEqual({
      host: "dev.local",
      port: 2222,
      username: "dev",
      auth_type: "key",
      key_file: "/k",
    });
  });

  it("accepts a v1 config whose version field is omitted", () => {
    const raw = {
      id: "cfg-7",
      name: "no-version",
      type: "local",
      config: {},
    };
    const result = migrateSavedConfig(raw);
    expect(result?.version).toBe(1);
  });

  it("loads a v1 local config with only old fields and returns correct field values", () => {
    const raw = {
      id: "cfg-old",
      name: "old-local",
      version: 1,
      type: "local",
      config: { shell: "/bin/bash", cwd: "/home/me" },
    };
    const result = migrateSavedConfig(raw);
    expect(result).not.toBeNull();
    expect(result?.id).toBe("cfg-old");
    expect(result?.name).toBe("old-local");
    expect(result?.version).toBe(1);
    expect(result?.type).toBe("local");
    expect(result?.config).toEqual({ shell: "/bin/bash", cwd: "/home/me" });
  });

  it("loads a v1 ssh config with only old fields and returns correct field values", () => {
    const raw = {
      id: "cfg-old-ssh",
      name: "old-ssh",
      version: 1,
      type: "ssh",
      config: { host: "h", port: 22, username: "u", auth_type: "password", password: "p" },
    };
    const result = migrateSavedConfig(raw);
    expect(result).not.toBeNull();
    expect(result?.id).toBe("cfg-old-ssh");
    expect(result?.name).toBe("old-ssh");
    expect(result?.version).toBe(1);
    expect(result?.type).toBe("ssh");
    expect(result?.config).toEqual({ host: "h", port: 22, username: "u", auth_type: "password", password: "p" });
  });

  it("loads a v1 local config with all new fields and returns them unchanged", () => {
    const raw = {
      id: "cfg-new-local",
      name: "new-local",
      version: 1,
      type: "local",
      config: {
        shell: "/usr/bin/zsh",
        cwd: "/home/me",
        shellTemplate: "zsh" as const,
        termType: "xterm-256color",
        charset: "utf-8",
        startupCommand: "echo hello",
        startupDelayMs: 100,
        lineTimestamp: true,
        autoWrap: false,
        clipboardRead: "allow" as const,
        logging: { enabled: true, path: "/tmp/session.log" },
      },
    };
    const result = migrateSavedConfig(raw);
    expect(result).not.toBeNull();
    expect(result?.config).toMatchObject({
      shell: "/usr/bin/zsh",
      cwd: "/home/me",
      shellTemplate: "zsh",
      termType: "xterm-256color",
      charset: "utf-8",
      startupCommand: "echo hello",
      startupDelayMs: 100,
      lineTimestamp: true,
      autoWrap: false,
      clipboardRead: "allow",
      logging: { enabled: true, path: "/tmp/session.log" },
    });
  });

  it("loads a v1 ssh config with all new fields and returns them unchanged", () => {
    const raw = {
      id: "cfg-new-ssh",
      name: "new-ssh",
      version: 1,
      type: "ssh",
      config: {
        host: "bastion.example.com",
        port: 2222,
        username: "alice",
        auth_type: "key",
        key_file: "/k",
        termType: "xterm-256color",
        tcpNoDelay: true,
        soKeepalive: true,
        nullPacketKeepalive: true,
        charset: "gbk",
      },
    };
    const result = migrateSavedConfig(raw);
    expect(result).not.toBeNull();
    expect(result?.config).toMatchObject({
      host: "bastion.example.com",
      port: 2222,
      username: "alice",
      auth_type: "key",
      key_file: "/k",
      termType: "xterm-256color",
      tcpNoDelay: true,
      soKeepalive: true,
      nullPacketKeepalive: true,
      charset: "gbk",
    });
  });
});

describe("migrateSavedConfig — malformed input", () => {
  it("returns null when type is missing entirely", () => {
    expect(migrateSavedConfig({ id: "x", name: "y" })).toBeNull();
  });

  it("returns null when type is set but no config sibling exists", () => {
    expect(migrateSavedConfig({ id: "x", name: "y", type: "local" })).toBeNull();
  });

  it("returns null when type is an unrecognised string", () => {
    expect(
      migrateSavedConfig({
        id: "x",
        name: "y",
        version: 1,
        type: "tmux",
        config: {},
      })
    ).toBeNull();
  });

  it("returns null when localConfig sibling is null", () => {
    expect(
      migrateSavedConfig({
        id: "x",
        name: "y",
        type: "local",
        localConfig: null,
      })
    ).toBeNull();
  });

  it("returns null when sshConfig sibling is null", () => {
    expect(
      migrateSavedConfig({
        id: "x",
        name: "y",
        type: "ssh",
        sshConfig: null,
      })
    ).toBeNull();
  });

  it("returns null when v1 config field is null", () => {
    expect(
      migrateSavedConfig({
        id: "x",
        name: "y",
        version: 1,
        type: "local",
        config: null,
      })
    ).toBeNull();
  });

  it("returns null when id is missing on legacy shape", () => {
    expect(
      migrateSavedConfig({ name: "y", type: "local", localConfig: { shell: "sh" } })
    ).toBeNull();
  });

  it("returns null when name is missing on legacy shape", () => {
    expect(
      migrateSavedConfig({ id: "x", type: "local", localConfig: { shell: "sh" } })
    ).toBeNull();
  });

  it("returns null for null input", () => {
    expect(migrateSavedConfig(null)).toBeNull();
  });

  it("returns null for primitive input", () => {
    expect(migrateSavedConfig("not-an-object")).toBeNull();
    expect(migrateSavedConfig(42)).toBeNull();
    expect(migrateSavedConfig(true)).toBeNull();
  });

  it("returns null when version mismatches the current schema version", () => {
    expect(
      migrateSavedConfig({
        id: "x",
        name: "y",
        version: 99,
        type: "local",
        config: {},
      })
    ).toBeNull();
  });
});

describe("migrateSavedConfigList", () => {
  it("migrates a mixed list and drops malformed entries", () => {
    const raw = [
      { id: "1", name: "n1", type: "local", localConfig: { shell: "sh" } },
      { id: "2", name: "n2", version: 1, type: "ssh", config: { host: "h", port: 22, username: "u", auth_type: "password", password: "p" } },
      { id: "3", name: "n3" }, // missing type — should be skipped
      null,                    // not an object — should be skipped
      { id: "4", name: "n4", type: "local", localConfig: null }, // null localConfig — skipped
    ];
    const list = migrateSavedConfigList(raw);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: "1", type: "local", version: 1, config: { shell: "sh" } });
    expect(list[1]).toMatchObject({ id: "2", type: "ssh", version: 1 });
  });

  it("returns an empty array for non-array input", () => {
    expect(migrateSavedConfigList(undefined)).toEqual([]);
    expect(migrateSavedConfigList(null)).toEqual([]);
    expect(migrateSavedConfigList({ id: "x" })).toEqual([]);
    expect(migrateSavedConfigList("not-an-array")).toEqual([]);
  });

  it("returns an empty array for an empty input array", () => {
    expect(migrateSavedConfigList([])).toEqual([]);
  });
});
