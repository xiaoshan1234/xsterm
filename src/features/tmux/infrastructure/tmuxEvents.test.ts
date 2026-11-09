import { describe, expect, it } from "vitest";
import {
  normalizeControllerExited,
  normalizeLayoutChanged,
  normalizePaneAdded,
  normalizePanePaused,
  normalizePaneRemoved,
  normalizeWindowAdded,
  normalizeWindowClosed,
  normalizeWindowRenamed,
} from "./tmuxEvents";
import { toBackendControllerHandle, toBackendWindowHandle } from "./handles";
import { toBackendTerminalHandle } from "../../terminal/infrastructure/handles";

describe("tmux event normalization", () => {
  it("converts snake_case pane and controller payloads", () => {
    expect(
      normalizeControllerExited({
        controller_id: 3,
        reason: "server exited",
      }),
    ).toEqual({
      controllerHandle: toBackendControllerHandle(3),
      reason: "server exited",
    });

    expect(
      normalizePaneAdded({
        controller_id: 3,
        tmux_pane_id: "%2",
        xsterm_session_id: 8,
        parent_tmux_window_id: "@1",
        window_index: 0,
        pane_index: 1,
        width: 88,
        height: 1,
        x: 0,
        y: 0,
        current_command: "bash",
        is_active: true,
      }),
    ).toEqual({
      controllerHandle: toBackendControllerHandle(3),
      terminalHandle: toBackendTerminalHandle(8),
      tmuxPaneId: "%2",
      parentTmuxWindowId: "@1",
      windowIndex: 0,
      paneIndex: 1,
      width: 88,
      height: 1,
      x: 0,
      y: 0,
      currentCommand: "bash",
      isActive: true,
    });

    expect(
      normalizePaneRemoved({
        controller_id: 3,
        tmux_pane_id: "%2",
        xsterm_session_id: 8,
      }),
    ).toEqual({
      controllerHandle: toBackendControllerHandle(3),
      terminalHandle: toBackendTerminalHandle(8),
      tmuxPaneId: "%2",
    });
    expect(normalizePanePaused({ tmux_pane_id: "%2" })).toEqual({
      tmuxPaneId: "%2",
    });
  });

  it("converts snake_case window payloads", () => {
    expect(
      normalizeWindowAdded({
        controller_id: 3,
        tmux_window_id: "@1",
        xsterm_window_id: 12,
        name: "server",
        panes: [
          {
            tmux_pane_id: "%1",
            xsterm_session_id: 8,
            window_index: 0,
            pane_index: 0,
            width: 80,
            height: 24,
            x: 0,
            y: 0,
            current_command: "bash",
            is_active: true,
            window_name: "server",
          },
        ],
        layout: "abcd,80x24,0,0,0",
      }),
    ).toEqual({
      controllerHandle: toBackendControllerHandle(3),
      tmuxWindowId: "@1",
      backendWindowHandle: toBackendWindowHandle(12),
      name: "server",
      panes: [
        {
          terminalHandle: toBackendTerminalHandle(8),
          tmuxPaneId: "%1",
          windowIndex: 0,
          paneIndex: 0,
          width: 80,
          height: 24,
          x: 0,
          y: 0,
          currentCommand: "bash",
          isActive: true,
          windowName: "server",
        },
      ],
      layout: "abcd,80x24,0,0,0",
    });

    expect(
      normalizeWindowClosed({
        controller_id: 3,
        tmux_window_id: "@1",
        xsterm_window_id: 12,
      }),
    ).toEqual({
      controllerHandle: toBackendControllerHandle(3),
      tmuxWindowId: "@1",
      backendWindowHandle: toBackendWindowHandle(12),
    });

    expect(
      normalizeWindowRenamed({
        controller_id: 3,
        tmux_window_id: "@1",
        xsterm_window_id: 12,
        name: "server",
      }),
    ).toEqual({
      controllerHandle: toBackendControllerHandle(3),
      tmuxWindowId: "@1",
      backendWindowHandle: toBackendWindowHandle(12),
      name: "server",
    });
  });

  it("normalizes layout-change pane geometry", () => {
    expect(
      normalizeLayoutChanged({
        controller_id: 3,
        tmux_window_id: "@1",
        session_name: "work",
        panes: [
          {
            tmux_pane_id: "%2",
            xsterm_session_id: 8,
            window_index: 0,
            pane_index: 1,
            width: 88,
            height: 30,
            x: 72,
            y: 0,
            current_command: "bash",
            is_active: true,
            window_name: "editor",
          },
        ],
      }),
    ).toEqual({
      controllerHandle: toBackendControllerHandle(3),
      tmuxWindowId: "@1",
      sessionName: "work",
      panes: [
        {
          terminalHandle: toBackendTerminalHandle(8),
          tmuxPaneId: "%2",
          windowIndex: 0,
          paneIndex: 1,
          width: 88,
          height: 30,
          x: 72,
          y: 0,
          currentCommand: "bash",
          isActive: true,
          windowName: "editor",
        },
      ],
    });
  });
});
