import { describe, expect, it } from "vitest";
import { createPaneId, createTerminalId, createTmuxControllerId, createWindowId } from "../ids";
import { type ModelResult } from "../result";
import {
  createEmptyDirectPane,
  createDirectPaneSplit,
  collectDirectPaneTerminalIds,
  findDirectPane,
} from "./DirectPaneTree";
import {
  attachTerminalToEmptyPane,
  appendWorkspaceWindow,
  detachTerminalFromWorkspace,
  splitDirectWindowPane,
} from "./WorkspaceOperations";
import { collectWorkspaceTerminalIds, createWorkspace, type Workspace } from "./Workspace";
import {
  createTmuxWindowReference,
  createDirectWindow,
  type DirectWindow,
} from "./WorkspaceWindow";

function unwrap<Value>(result: ModelResult<Value>): Value {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

function createDirectWorkspace(): {
  workspace: Workspace;
  window: DirectWindow;
} {
  const pane = unwrap(createEmptyDirectPane("pane-main"));
  const window = unwrap(
    createDirectWindow({
      id: "window-1",
      name: "Main",
      activePaneId: pane.id,
      layout: pane,
    }),
  );
  const workspace = unwrap(
    createWorkspace({
      id: "workspace-1",
      name: "Default",
      windows: [window],
      activeWindowId: createWindowId("window-1"),
    }),
  );

  return { workspace, window };
}

describe("workspace direct terminal operations", () => {
  it("allows local and SSH terminal instances to coexist in one direct window", () => {
    const { workspace, window } = createDirectWorkspace();
    const localTerminalId = createTerminalId(1);
    const sshTerminalId = createTerminalId(2);

    const attached = unwrap(
      attachTerminalToEmptyPane(workspace, window.id, createPaneId("pane-main"), localTerminalId),
    );
    const split = unwrap(
      splitDirectWindowPane(
        attached,
        window.id,
        createPaneId("pane-main"),
        "pane-split",
        "pane-ssh",
        "horizontal",
        sshTerminalId,
      ),
    );
    const directWindow = split.windows[0] as DirectWindow;

    expect(collectWorkspaceTerminalIds(split)).toEqual([localTerminalId, sshTerminalId]);
    expect(collectDirectPaneTerminalIds(directWindow.layout)).toEqual([
      localTerminalId,
      sshTerminalId,
    ]);
    expect(directWindow.activePaneId).toBe(createPaneId("pane-ssh"));
  });

  it("detaches a terminal by preserving the pane as an empty leaf", () => {
    const { workspace, window } = createDirectWorkspace();
    const terminalId = createTerminalId(3);
    const attached = unwrap(
      attachTerminalToEmptyPane(workspace, window.id, createPaneId("pane-main"), terminalId),
    );
    const detached = unwrap(detachTerminalFromWorkspace(attached, terminalId));
    const directWindow = detached.windows[0] as DirectWindow;
    const pane = findDirectPane(directWindow.layout, createPaneId("pane-main"));

    expect(pane?.kind).toBe("leaf");
    if (pane?.kind === "leaf") {
      expect(pane.content).toEqual({ kind: "empty" });
    }
    expect(collectWorkspaceTerminalIds(detached)).toEqual([]);
  });

  it("rejects attaching the same terminal instance twice", () => {
    const firstPane = unwrap(createEmptyDirectPane("pane-main"));
    const secondPane = unwrap(createEmptyDirectPane("pane-next"));
    const layout = unwrap(
      createDirectPaneSplit("pane-root", "horizontal", 0.5, firstPane, secondPane),
    );
    const window = unwrap(
      createDirectWindow({
        id: "window-1",
        name: "Main",
        activePaneId: firstPane.id,
        layout,
      }),
    );
    const workspace = unwrap(
      createWorkspace({
        id: "workspace-1",
        name: "Default",
        windows: [window],
        activeWindowId: window.id,
      }),
    );
    const terminalId = createTerminalId(4);
    const attached = unwrap(
      attachTerminalToEmptyPane(workspace, window.id, createPaneId("pane-main"), terminalId),
    );

    const result = attachTerminalToEmptyPane(
      attached,
      window.id,
      createPaneId("pane-next"),
      terminalId,
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "duplicate-id" },
    });
  });

  it("allows direct and tmux windows to coexist as workspace tabs", () => {
    const { workspace, window } = createDirectWorkspace();
    const tmuxReference = unwrap(
      createTmuxWindowReference({
        id: "window-tmux-1",
        controllerId: 6,
        tmuxWindowId: "@1",
      }),
    );
    const appended = unwrap(appendWorkspaceWindow(workspace, tmuxReference));

    expect(appended.windows).toHaveLength(2);
    expect(appended.windows[1]).toEqual(tmuxReference);
    expect(appended.activeWindowId).toBe(createWindowId("window-tmux-1"));
    expect(
      appended.windows.some(
        (candidate) =>
          candidate.kind === "tmux-window-reference" &&
          candidate.controllerId === createTmuxControllerId(6),
      ),
    ).toBe(true);
    expect(window.kind).toBe("direct-window");
  });
});
