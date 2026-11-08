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
          passphraseCredentialId: "credential-passphrase",
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
      passphraseCredentialId: "credential-passphrase",
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
          credentialId: "credential-password",
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
    expect(transport).not.toHaveProperty("credentialId");
  });

  it("validates authentication and timing properties", () => {
    expect(
      createSshConnectionConfig({
        host: "example.com",
        port: 22,
        username: "developer",
        authentication: { kind: "password", credentialId: "" },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-id" },
    });

    expect(
      createSshConnectionConfig({
        host: "example.com",
        port: 22,
        username: "developer",
        authentication: { kind: "password", credentialId: "credential-password" },
        connectionTimeoutSeconds: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-value" },
    });
  });
});
