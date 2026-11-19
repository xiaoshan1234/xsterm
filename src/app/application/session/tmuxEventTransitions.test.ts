import { describe, expect, it } from "vitest";
import { createTerminalId } from "../../../models";
import { isTmuxPaneTerminal } from "../../../features/terminal";
import { buildTmuxPaneSession, mergeTmuxPaneMetadata } from "./tmuxEventTransitions";

function createTmuxTerminal() {
  return buildTmuxPaneSession({
    id: createTerminalId(7),
    name: "tmux-1:%1",
    tmuxPaneId: "%1",
    tmuxSessionId: 1,
    tmuxWindowId: "@1",
    tmuxPaneCommand: "zsh",
  });
}

describe("tmuxEventTransitions", () => {
  it("keeps tmux runtime metadata nested when creating a pane terminal", () => {
    const terminal = createTmuxTerminal();

    expect(terminal.kind).toEqual({ type: "tmux-pane", sessionId: 1, paneId: "%1" });
    expect(terminal.tmux).toMatchObject({
      controllerId: 1,
      paneId: "%1",
      windowId: "@1",
      command: "zsh",
    });
  });

  it("updates pane identity and metadata without changing terminal identity", () => {
    const terminal = createTmuxTerminal();

    const updated = mergeTmuxPaneMetadata(terminal, {
      controllerId: 2,
      paneId: "%2",
      tmuxWindowId: "@3",
      tmuxWindowName: "editor",
      tmuxPaneIndex: 1,
      tmuxPaneActive: true,
    });

    expect(updated.id).toBe(terminal.id);
    expect(isTmuxPaneTerminal(updated)).toBe(true);
    if (!isTmuxPaneTerminal(updated)) return;
    expect(updated.kind).toEqual({ type: "tmux-pane", sessionId: 2, paneId: "%2" });
    expect(updated.tmux).toMatchObject({
      controllerId: 2,
      paneId: "%2",
      windowId: "@3",
      windowName: "editor",
      paneIndex: 1,
      isActive: true,
      command: "zsh",
    });
  });

  it("leaves non-tmux terminals unchanged", () => {
    const terminal = {
      id: createTerminalId(8),
      configId: "config-1",
      name: "local",
      type: "local" as const,
      isConnected: true,
      kind: { type: "local" as const, shell: "pwsh", cwd: "C:\\" },
    };

    expect(mergeTmuxPaneMetadata(terminal, { paneId: "%9" })).toBe(terminal);
  });
});
