/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTerminalId, createWorkspaceId } from "../../../models";
import {
  terminalSessionActions,
  type Terminal,
  type TerminalConnectionInfo,
} from "../../../features/terminal";
import type {
  LocalTerminalConfig,
  SavedTerminalConfig,
  SshConfig,
} from "../../../features/launch-config";
import { useLocalTerminalCreationActions } from "./useLocalTerminalCreationActions";

function localInfo(id: number): TerminalConnectionInfo {
  return {
    id: createTerminalId(id),
    name: "backend-local",
    kind: { type: "local", shell: "pwsh", cwd: "C:\\" },
    isConnected: true,
    capabilities: {
      supportsResize: true,
      supportsReconnect: true,
      supportsLocalEcho: true,
      supportsMultiplex: false,
    },
  };
}

function sshInfo(id: number): TerminalConnectionInfo {
  return {
    id: createTerminalId(id),
    name: "backend-ssh",
    kind: { type: "ssh", host: "example.com", port: 22, user: "dev" },
    isConnected: true,
    capabilities: {
      supportsResize: true,
      supportsReconnect: true,
      supportsLocalEcho: false,
      supportsMultiplex: false,
    },
  };
}

function localConfig(): LocalTerminalConfig {
  return { shell: "pwsh", cwd: "C:\\work" };
}

function sshConfig(): SshConfig {
  return { host: "example.com", port: 22, username: "dev", authType: "password" };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useLocalTerminalCreationActions", () => {
  it("creates a local session, saves its config, and opens a window", async () => {
    let sessions: Terminal[] = [];
    let configs: SavedTerminalConfig[] = [];
    const createWindowFromSession = vi.fn();
    vi.spyOn(terminalSessionActions, "createLocal").mockResolvedValue(localInfo(42));
    const { result } = renderHook(() =>
      useLocalTerminalCreationActions({
        activeWorkspaceId: createWorkspaceId("ws"),
        createWindowFromSession,
        setTerminals: (action) => {
          sessions = typeof action === "function" ? action(sessions) : action;
        },
        updateConfigs: (action) => {
          configs = typeof action === "function" ? action(configs) : action;
        },
      }),
    );

    const terminal = await act(() => result.current.createLocalSession(localConfig()));

    expect(terminalSessionActions.createLocal).toHaveBeenCalledWith(localConfig(), undefined);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(createTerminalId(42));
    expect(configs).toHaveLength(1);
    expect(configs[0].type).toBe("local");
    expect(configs[0].id).toBe(sessions[0].configId);
    expect(configs[0].config).toEqual(localConfig());
    expect(createWindowFromSession).toHaveBeenCalledWith(
      createTerminalId(42),
      sessions[0].configId,
      "backend-local",
      createWorkspaceId("ws"),
    );
    expect(terminal.id).toBe(createTerminalId(42));
  });

  it("creates an SSH session through the SSH adapter", async () => {
    let sessions: Terminal[] = [];
    let configs: SavedTerminalConfig[] = [];
    const createWindowFromSession = vi.fn();
    vi.spyOn(terminalSessionActions, "createSsh").mockResolvedValue(sshInfo(43));
    const { result } = renderHook(() =>
      useLocalTerminalCreationActions({
        activeWorkspaceId: null,
        createWindowFromSession,
        setTerminals: (action) => {
          sessions = typeof action === "function" ? action(sessions) : action;
        },
        updateConfigs: (action) => {
          configs = typeof action === "function" ? action(configs) : action;
        },
      }),
    );

    await act(() => result.current.createSshSession(sshConfig()));

    expect(terminalSessionActions.createSsh).toHaveBeenCalledWith(sshConfig(), undefined);
    expect(sessions[0].type).toBe("ssh");
    expect(configs[0].type).toBe("ssh");
    expect(configs[0].config).toEqual(sshConfig());
  });

  it("skips both the window and the saved config when asked", async () => {
    let sessions: Terminal[] = [];
    let configs: SavedTerminalConfig[] = [];
    const createWindowFromSession = vi.fn();
    vi.spyOn(terminalSessionActions, "createLocal").mockResolvedValue(localInfo(44));
    const { result } = renderHook(() =>
      useLocalTerminalCreationActions({
        activeWorkspaceId: createWorkspaceId("ws"),
        createWindowFromSession,
        setTerminals: (action) => {
          sessions = typeof action === "function" ? action(sessions) : action;
        },
        updateConfigs: (action) => {
          configs = typeof action === "function" ? action(configs) : action;
        },
      }),
    );

    await act(() => result.current.createLocalSessionOnly(localConfig(), false));

    expect(sessions).toHaveLength(1);
    expect(configs).toHaveLength(0);
    expect(createWindowFromSession).not.toHaveBeenCalled();
  });
});
