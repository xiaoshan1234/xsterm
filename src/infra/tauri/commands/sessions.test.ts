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

// Imported lazily so the mock above is registered first.
import {
  createLocal,
  createSession,
  createSsh,
  closeSession,
  listSessions,
  resizePtySession,
  resizeSession,
  resizeSshSession,
  resizeTmuxPane,
  uploadImageToSshSession,
  writeSession,
  writeSessionBytes,
} from "./sessions";
import type { SessionInfo } from "./sessions";
import type { LocalSessionConfig, SSHSessionConfig, TmuxCcConfig } from "../../../model";

const sampleInfo: SessionInfo = {
  id: 7,
  name: "demo",
  sessionType: { type: "local", config: { shell: "/bin/bash" } },
  isConnected: true,
};

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

describe("createSession", () => {
  it("invokes create_session with the config payload and returns the SessionInfo", async () => {
    invokeMock.mockResolvedValueOnce(sampleInfo);
    const cfg: LocalSessionConfig = { shell: "/bin/bash" };
    const result = await createSession({ type: "local", config: cfg });
    expect(result).toEqual(sampleInfo);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("create_session", {
      config: { type: "local", config: cfg },
    });
  });
});

describe("listSessions", () => {
  it("invokes list_sessions and returns the array", async () => {
    invokeMock.mockResolvedValueOnce([sampleInfo]);
    const result = await listSessions();
    expect(result).toEqual([sampleInfo]);
    expect(invokeMock).toHaveBeenCalledWith("list_sessions");
  });
});

describe("createLocal / createSsh", () => {
  it("createLocal wraps the LocalSessionConfig into a SessionType", async () => {
    invokeMock.mockResolvedValueOnce(sampleInfo);
    const cfg: LocalSessionConfig = { shell: "sh" };
    await createLocal(cfg);
    expect(invokeMock).toHaveBeenCalledWith("create_session", {
      config: { type: "local", config: cfg },
    });
  });

  it("createSsh wraps the SSHSessionConfig into a SessionType", async () => {
    invokeMock.mockResolvedValueOnce(sampleInfo);
    const cfg: SSHSessionConfig = {
      host: "h",
      port: 22,
      username: "u",
      auth_type: "password",
      password: "p",
    };
    await createSsh(cfg);
    expect(invokeMock).toHaveBeenCalledWith("create_session", {
      config: { type: "ssh", config: cfg },
    });
  });
});

describe("writeSession", () => {
  it("encodes data as UTF-8 and invokes write_session with a Uint8Array", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await writeSession(3, "abc");
    const [, payload] = invokeMock.mock.calls[0];
    expect(payload).toEqual({ sessionId: 3, data: new Uint8Array([0x61, 0x62, 0x63]) });
  });

  it("swallows errors from the backend so the caller is never rejected", async () => {
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    await expect(writeSession(1, "x")).resolves.toBeUndefined();
  });
});

describe("writeSessionBytes", () => {
  it("forwards the raw Uint8Array without re-encoding", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const bytes = new Uint8Array([0x01, 0x02, 0x03]);
    await writeSessionBytes(11, bytes);
    expect(invokeMock).toHaveBeenCalledWith("write_session", { sessionId: 11, data: bytes });
  });

  it("swallows errors from the backend", async () => {
    invokeMock.mockRejectedValueOnce(new Error("nope"));
    await expect(writeSessionBytes(1, new Uint8Array())).resolves.toBeUndefined();
  });
});

describe("resizeSession", () => {
  it("invokes resize_pty_session with rows/cols (legacy fallback for unknown transports)", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await resizeSession(5, 24, 80);
    expect(invokeMock).toHaveBeenCalledWith("resize_pty_session", {
      sessionId: 5,
      rows: 24,
      cols: 80,
    });
  });
});

describe("resizeTmuxPane", () => {
  it("invokes resize_tmux_pane with controllerId/tmuxPaneId/rows/cols", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await resizeTmuxPane(1, "%5", 24, 80);
    expect(invokeMock).toHaveBeenCalledWith("resize_tmux_pane", {
      controllerId: 1,
      tmuxPaneId: "%5",
      rows: 24,
      cols: 80,
    });
  });
});

describe("resizePtySession", () => {
  it("invokes resize_pty_session with sessionId/rows/cols", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await resizePtySession(5, 24, 80);
    expect(invokeMock).toHaveBeenCalledWith("resize_pty_session", {
      sessionId: 5,
      rows: 24,
      cols: 80,
    });
  });
});

describe("resizeSshSession", () => {
  it("invokes resize_ssh_session with sessionId/rows/cols", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await resizeSshSession(5, 24, 80);
    expect(invokeMock).toHaveBeenCalledWith("resize_ssh_session", {
      sessionId: 5,
      rows: 24,
      cols: 80,
    });
  });
});

describe("closeSession", () => {
  it("invokes close_session with the session id", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await closeSession(42);
    expect(invokeMock).toHaveBeenCalledWith("close_session", { sessionId: 42 });
  });
});

describe("uploadImageToSshSession", () => {
  it("invokes upload_image_to_ssh_session and returns the result string", async () => {
    invokeMock.mockResolvedValueOnce("/tmp/uploaded.png");
    const result = await uploadImageToSshSession(2, "x.png", [1, 2, 3]);
    expect(result).toBe("/tmp/uploaded.png");
    expect(invokeMock).toHaveBeenCalledWith("upload_image_to_ssh_session", {
      sessionId: 2,
      filename: "x.png",
      data: [1, 2, 3],
    });
  });
});

// Reference a TmuxCcConfig type so the test file surfaces type drift
// in the re-export when model/entities changes.
const _tmuxCfgRef: TmuxCcConfig | undefined = undefined;
void _tmuxCfgRef;
