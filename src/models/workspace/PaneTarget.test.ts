import { describe, expect, it } from "vitest";
import { createTerminalId, createTerminalStreamId } from "../ids";
import { type ModelResult } from "../result";
import {
  createPaneTargetDisplayInfo,
  createPaneTargetKey,
  createRawPaneTargetRef,
  createResolvedRawPaneTarget,
  createResolvedTmuxPaneTarget,
  createTmuxPaneTargetRef,
} from "./PaneTarget";

function unwrap<Value>(result: ModelResult<Value>): Value {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

describe("PaneTarget", () => {
  it("keeps stable raw pane identity separate from the terminal stream", () => {
    const target = unwrap(
      createRawPaneTargetRef({
        workspaceId: "workspace-1",
        windowId: "window-1",
        paneId: "pane-1",
      }),
    );
    const resolved = createResolvedRawPaneTarget(target, createTerminalId(42));

    expect(createPaneTargetKey(target)).toBe("raw:workspace-1:window-1:pane-1");
    expect(resolved).toEqual({
      target,
      stream: {
        kind: "terminal",
        terminalId: createTerminalId(42),
      },
    });
  });

  it("includes controller and tmux window in tmux target identity", () => {
    const target = unwrap(
      createTmuxPaneTargetRef({
        controllerId: 3,
        tmuxWindowId: "@1",
        tmuxPaneId: "%2",
      }),
    );
    const resolved = createResolvedTmuxPaneTarget(target, createTerminalStreamId(17));

    expect(createPaneTargetKey(target)).toBe("tmux:3:@1:%2");
    expect(resolved.stream).toEqual({
      kind: "tmux-pane",
      streamId: createTerminalStreamId(17),
      tmuxPaneId: "%2",
    });
  });

  it("normalizes user-facing display information", () => {
    const target = unwrap(
      createRawPaneTargetRef({
        workspaceId: "workspace-1",
        windowId: "window-1",
        paneId: "pane-1",
      }),
    );
    const display = unwrap(
      createPaneTargetDisplayInfo({
        target,
        displayId: " pane-1 ",
        title: " SSH production ",
        breadcrumb: " Workspace A / Window 1 / Pane 1 ",
        isAvailable: true,
      }),
    );

    expect(display).toMatchObject({
      displayId: "pane-1",
      title: "SSH production",
      breadcrumb: "Workspace A / Window 1 / Pane 1",
      isAvailable: true,
    });
  });
});
