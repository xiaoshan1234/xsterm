import { describe, expect, it } from "vitest";
import { type ModelResult } from "../result";
import { createSshConnectionConfig, toSshTerminalTransport } from "./SshConnectionConfig";

function unwrap<Value>(result: ModelResult<Value>): Value {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

describe("SshConnectionConfig", () => {
  it("models authentication and connection-only properties", () => {
    const config = unwrap(
      createSshConnectionConfig({
        host: "example.com",
        port: 22,
        username: "developer",
        authentication: {
          kind: "private-key",
          keyFile: "~/.ssh/id_ed25519",
          passphrase: "secret",
        },
        keepaliveIntervalSeconds: 30,
        connectionTimeoutSeconds: 15,
        tcpNoDelay: true,
        enableCompression: true,
      }),
    );

    expect(config.authentication).toMatchObject({
      kind: "private-key",
      keyFile: "~/.ssh/id_ed25519",
    });
    expect(config.keepaliveIntervalSeconds).toBe(30);
    expect(config.enableCompression).toBe(true);
  });

  it("converts to a runtime transport without exposing credentials", () => {
    const config = unwrap(
      createSshConnectionConfig({
        host: "example.com",
        port: 2222,
        username: "developer",
        authentication: {
          kind: "password",
          password: "top-secret",
        },
      }),
    );
    const transport = toSshTerminalTransport(config);

    expect(transport).toEqual({
      kind: "ssh",
      host: "example.com",
      port: 2222,
      username: "developer",
    });
    expect(transport).not.toHaveProperty("password");
  });

  it("validates authentication and timing properties", () => {
    expect(
      createSshConnectionConfig({
        host: "example.com",
        port: 22,
        username: "developer",
        authentication: { kind: "password", password: "" },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-value" },
    });

    expect(
      createSshConnectionConfig({
        host: "example.com",
        port: 22,
        username: "developer",
        authentication: { kind: "password", password: "secret" },
        connectionTimeoutSeconds: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-value" },
    });
  });
});
