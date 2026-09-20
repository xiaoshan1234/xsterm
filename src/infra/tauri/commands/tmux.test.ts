import { describe, expect, it, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("../../logger/logger", () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}));

import {
  attachTmux,
  autoAttachTmuxServers,
  captureTmuxPane,
  createTmux,
  createTmuxPane,
  createTmuxWindow,
  detachTmux,
  getAttachedTmuxServers,
  killServerViaController,
  killTmuxPane,
  killTmuxWindow,
  probeTmuxSessionExists,
  renameTmuxWindow,
  unmarkAttachedTmux,
} from "./tmux";
import type { SessionInfo } from "./sessions";
import type { AttachedTmuxServer, TmuxCcConfig } from "../../../model";

const tmuxInfo: SessionInfo = {
  id: 11,
  name: "tmux-demo",
  sessionType: { type: "tmux-cc", config: {} },
  isConnected: true,
  tmuxPaneId: "%1",
  tmuxControllerId: 1,
  tmuxServerWindowId: "@1",
  tmuxWindowId: 101,
};

const tmuxCfg: TmuxCcConfig = { tmuxSessionName: "work" };

beforeEach(() => {
  invokeMock.mockReset();
  // Mock invoke by command name so the logger's "log_message" call (which
  // runs on every log line in the command under test) does not consume
  // the value queued for the command itself via mockResolvedValueOnce.
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "log_message") return Promise.resolve(undefined);
    return undefined;
  });
});

describe("createTmux", () => {
  it("invokes create_tmux_session and returns SessionInfo", async () => {
    invokeMock.mockResolvedValueOnce(tmuxInfo);
    const result = await createTmux(tmuxCfg);
    expect(result).toEqual(tmuxInfo);
    expect(invokeMock).toHaveBeenCalledWith("create_tmux_session", { config: tmuxCfg });
  });
});

describe("probeTmuxSessionExists", () => {
  it("invokes probe_tmux_session_exists and returns the boolean", async () => {
    invokeMock.mockResolvedValueOnce(true);
    const result = await probeTmuxSessionExists(tmuxCfg);
    expect(result).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("probe_tmux_session_exists", { config: tmuxCfg });
  });
});

describe("attachTmux", () => {
  it("invokes attach_tmux_session and returns SessionInfo", async () => {
    invokeMock.mockResolvedValueOnce(tmuxInfo);
    const result = await attachTmux(tmuxCfg);
    expect(result).toEqual(tmuxInfo);
    expect(invokeMock).toHaveBeenCalledWith("attach_tmux_session", { config: tmuxCfg });
  });
});

describe("captureTmuxPane", () => {
  it("invokes capture_tmux_pane with controller/tmuxPaneId/lines", async () => {
    invokeMock.mockResolvedValueOnce("scrollback-text");
    const result = await captureTmuxPane(1, "%5", 100);
    expect(result).toBe("scrollback-text");
    expect(invokeMock).toHaveBeenCalledWith("capture_tmux_pane", {
      controllerId: 1,
      tmuxPaneId: "%5",
      lines: 100,
    });
  });
});

describe("getAttachedTmuxServers", () => {
  it("invokes get_attached_tmux_servers and returns the array", async () => {
    const servers: AttachedTmuxServer[] = [
      { sessionName: "work", socketName: "dev", attachedAt: 1234 },
    ];
    invokeMock.mockResolvedValueOnce(servers);
    const result = await getAttachedTmuxServers();
    expect(result).toBe(servers);
    expect(invokeMock).toHaveBeenCalledWith("get_attached_tmux_servers");
  });
});

describe("autoAttachTmuxServers", () => {
  it("invokes auto_attach_tmux_servers and returns AutoAttachOutcome[]", async () => {
    invokeMock.mockResolvedValueOnce([]);
    const result = await autoAttachTmuxServers();
    expect(result).toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("auto_attach_tmux_servers");
  });
});

describe("createTmuxPane", () => {
  it("invokes create_tmux_pane with controller/parentTmuxPaneId/direction", async () => {
    invokeMock.mockResolvedValueOnce(tmuxInfo);
    const result = await createTmuxPane(1, "%5", "vertical");
    expect(result).toEqual(tmuxInfo);
    expect(invokeMock).toHaveBeenCalledWith("create_tmux_pane", {
      controllerId: 1,
      parentTmuxPaneId: "%5",
      direction: "vertical",
    });
  });
});

describe("killTmuxPane", () => {
  it("invokes kill_tmux_pane with controllerId/tmuxPaneId", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await killTmuxPane(1, "%5");
    expect(invokeMock).toHaveBeenCalledWith("kill_tmux_pane", {
      controllerId: 1,
      tmuxPaneId: "%5",
    });
  });
});

describe("createTmuxWindow", () => {
  it("invokes create_tmux_window with controller and optional name", async () => {
    invokeMock.mockResolvedValueOnce(tmuxInfo);
    await createTmuxWindow(1, "scratch");
    expect(invokeMock).toHaveBeenCalledWith("create_tmux_window", {
      controllerId: 1,
      name: "scratch",
    });
  });

  it("forwards an undefined name when none is supplied", async () => {
    invokeMock.mockResolvedValueOnce(tmuxInfo);
    await createTmuxWindow(1);
    expect(invokeMock).toHaveBeenCalledWith("create_tmux_window", {
      controllerId: 1,
      name: undefined,
    });
  });
});

describe("killTmuxWindow", () => {
  it("invokes kill_tmux_window with controllerId/tmuxWindowId", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await killTmuxWindow(1, "@1");
    expect(invokeMock).toHaveBeenCalledWith("kill_tmux_window", {
      controllerId: 1,
      tmuxWindowId: "@1",
    });
  });
});

describe("renameTmuxWindow", () => {
  it("invokes rename_tmux_window with controllerId/tmuxWindowId/name", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await renameTmuxWindow(1, "@1", "new-name");
    expect(invokeMock).toHaveBeenCalledWith("rename_tmux_window", {
      controllerId: 1,
      tmuxWindowId: "@1",
      name: "new-name",
    });
  });
});

describe("detachTmux", () => {
  it("invokes detach_tmux_controller with controllerId", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await detachTmux(1);
    expect(invokeMock).toHaveBeenCalledWith("detach_tmux_controller", { controllerId: 1 });
  });
});

describe("killServerViaController", () => {
  it("invokes kill_server_via_controller with controllerId", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await killServerViaController(1);
    expect(invokeMock).toHaveBeenCalledWith("kill_server_via_controller", { controllerId: 1 });
  });
});

describe("unmarkAttachedTmux", () => {
  it("invokes unmark_attached_tmux with controllerId", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await unmarkAttachedTmux(1);
    expect(invokeMock).toHaveBeenCalledWith("unmark_attached_tmux", { controllerId: 1 });
  });
});
