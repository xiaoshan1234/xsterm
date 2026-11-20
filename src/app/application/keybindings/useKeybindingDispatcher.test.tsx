/** @vitest-environment jsdom */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPaneId, createWindowId, createWorkspaceId } from "../../../models";
import type { EditablePaneNode, Workspace } from "../../../features/workspace";
import { createTestApplication } from "../../../test/createTestApplication";
import { useKeybindingDispatcher } from "./useKeybindingDispatcher";

function KeybindingHarness({
  onCreateSession,
  onToggleLogs,
  onToggleToolPanel,
  onCycleToolPanel = () => undefined,
}: {
  onCreateSession: () => void;
  onToggleLogs: () => void;
  onToggleToolPanel: () => void;
  onCycleToolPanel?: (step: 1 | -1) => void;
}) {
  useKeybindingDispatcher({
    onCreateSession,
    onToggleLogs,
    onToggleToolPanel,
    onCycleToolPanel,
  });
  return null;
}

function makeTwoPaneWorkspace(activePane: "a" | "b") {
  const workspaceId = createWorkspaceId("workspace-1");
  const windowId = createWindowId("window-1");
  const paneA = createPaneId("pane-a");
  const paneB = createPaneId("pane-b");
  const rootPane: EditablePaneNode = {
    id: createPaneId("root"),
    type: "split",
    direction: "vertical",
    size: 1,
    children: [
      { id: paneA, type: "leaf", size: 0.5 },
      { id: paneB, type: "leaf", size: 0.5 },
    ],
  };
  const workspace: Workspace = {
    id: workspaceId,
    name: "workspace",
    windows: [
      { id: windowId, name: "window", rootPane, activePaneId: activePane === "a" ? paneA : paneB },
    ],
    activeWindowId: windowId,
    terminalIds: [],
  };
  return { workspaceId, windowId, paneA, paneB, workspace };
}

function dispatchChord(init: KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
}

function makeTwoWindowWorkspace(activeWindow: "a" | "b") {
  const workspaceId = createWorkspaceId("workspace-windows");
  const windowA = {
    id: createWindowId("window-a"),
    name: "window-a",
    rootPane: { id: createPaneId("pane-a"), type: "leaf", size: 1 },
    activePaneId: createPaneId("pane-a"),
  } as Workspace["windows"][number];
  const windowB = {
    id: createWindowId("window-b"),
    name: "window-b",
    rootPane: { id: createPaneId("pane-b"), type: "leaf", size: 1 },
    activePaneId: createPaneId("pane-b"),
  } as Workspace["windows"][number];
  const workspace: Workspace = {
    id: workspaceId,
    name: "workspace",
    windows: [windowA, windowB],
    activeWindowId: activeWindow === "a" ? windowA.id : windowB.id,
    terminalIds: [],
  };
  return { workspaceId, windowA, windowB, workspace };
}

describe("useKeybindingDispatcher", () => {
  afterEach(() => {
    cleanup();
  });

  it("switches to the next pane on Ctrl+Tab", () => {
    const { workspaceId, windowId, paneB, workspace } = makeTwoPaneWorkspace("a");
    const setActivePane = vi.fn();
    const app = createTestApplication({
      workspace: {
        workspaces: [workspace],
        activeWorkspaceId: workspaceId,
        setActivePane,
      },
    });

    render(
      <app.Application>
        <KeybindingHarness
          onCreateSession={() => undefined}
          onToggleLogs={() => undefined}
          onToggleToolPanel={() => undefined}
        />
      </app.Application>,
    );

    dispatchChord({ key: "Tab", ctrlKey: true });

    expect(setActivePane).toHaveBeenCalledWith(workspaceId, windowId, paneB);
  });

  it("switches to the previous pane on Ctrl+Shift+Tab", () => {
    const { workspaceId, windowId, paneA, workspace } = makeTwoPaneWorkspace("b");
    const setActivePane = vi.fn();
    const app = createTestApplication({
      workspace: {
        workspaces: [workspace],
        activeWorkspaceId: workspaceId,
        setActivePane,
      },
    });

    render(
      <app.Application>
        <KeybindingHarness
          onCreateSession={() => undefined}
          onToggleLogs={() => undefined}
          onToggleToolPanel={() => undefined}
        />
      </app.Application>,
    );

    dispatchChord({ key: "Tab", ctrlKey: true, shiftKey: true });

    expect(setActivePane).toHaveBeenCalledWith(workspaceId, windowId, paneA);
  });

  it("switches to the next window on Ctrl+PageDown", () => {
    const { workspaceId, windowB, workspace } = makeTwoWindowWorkspace("a");
    const setActiveWindow = vi.fn();
    const app = createTestApplication({
      workspace: {
        workspaces: [workspace],
        activeWorkspaceId: workspaceId,
        setActiveWindow,
      },
    });

    render(
      <app.Application>
        <KeybindingHarness
          onCreateSession={() => undefined}
          onToggleLogs={() => undefined}
          onToggleToolPanel={() => undefined}
        />
      </app.Application>,
    );

    dispatchChord({ key: "PageDown", ctrlKey: true });

    expect(setActiveWindow).toHaveBeenCalledWith(workspaceId, windowB.id);
  });

  it("switches to the previous window on Ctrl+PageUp", () => {
    const { workspaceId, windowA, workspace } = makeTwoWindowWorkspace("b");
    const setActiveWindow = vi.fn();
    const app = createTestApplication({
      workspace: {
        workspaces: [workspace],
        activeWorkspaceId: workspaceId,
        setActiveWindow,
      },
    });

    render(
      <app.Application>
        <KeybindingHarness
          onCreateSession={() => undefined}
          onToggleLogs={() => undefined}
          onToggleToolPanel={() => undefined}
        />
      </app.Application>,
    );

    dispatchChord({ key: "PageUp", ctrlKey: true });

    expect(setActiveWindow).toHaveBeenCalledWith(workspaceId, windowA.id);
  });

  it("opens a new init window on Ctrl+Shift+T", () => {
    const { workspaceId, workspace } = makeTwoWindowWorkspace("a");
    const createWindow = vi.fn();
    const app = createTestApplication({
      workspace: {
        workspaces: [workspace],
        activeWorkspaceId: workspaceId,
        createWindow,
      },
    });

    render(
      <app.Application>
        <KeybindingHarness
          onCreateSession={() => undefined}
          onToggleLogs={() => undefined}
          onToggleToolPanel={() => undefined}
        />
      </app.Application>,
    );

    dispatchChord({ key: "t", ctrlKey: true, shiftKey: true });

    expect(createWindow).toHaveBeenCalledWith(workspaceId, undefined, undefined, undefined, "init");
  });

  it("closes the active window on Ctrl+Shift+Q", () => {
    const { workspaceId, windowA, workspace } = makeTwoWindowWorkspace("a");
    const closeWindow = vi.fn();
    const app = createTestApplication({
      workspace: {
        workspaces: [workspace],
        activeWorkspaceId: workspaceId,
        closeWindow,
      },
    });

    render(
      <app.Application>
        <KeybindingHarness
          onCreateSession={() => undefined}
          onToggleLogs={() => undefined}
          onToggleToolPanel={() => undefined}
        />
      </app.Application>,
    );

    dispatchChord({ key: "q", ctrlKey: true, shiftKey: true });

    expect(closeWindow).toHaveBeenCalledWith(workspaceId, windowA.id);
  });

  it("toggles the tool panel on Ctrl+Shift+E", () => {
    const { workspaceId, workspace } = makeTwoPaneWorkspace("a");
    const onToggleToolPanel = vi.fn();
    const app = createTestApplication({
      workspace: {
        workspaces: [workspace],
        activeWorkspaceId: workspaceId,
      },
    });

    render(
      <app.Application>
        <KeybindingHarness
          onCreateSession={() => undefined}
          onToggleLogs={() => undefined}
          onToggleToolPanel={onToggleToolPanel}
        />
      </app.Application>,
    );

    dispatchChord({ key: "e", ctrlKey: true, shiftKey: true });

    expect(onToggleToolPanel).toHaveBeenCalledTimes(1);
  });

  it("cycles to the next tool panel on Ctrl+Shift+]", () => {
    const { workspaceId, workspace } = makeTwoPaneWorkspace("a");
    const onCycleToolPanel = vi.fn();
    const app = createTestApplication({
      workspace: {
        workspaces: [workspace],
        activeWorkspaceId: workspaceId,
      },
    });

    render(
      <app.Application>
        <KeybindingHarness
          onCreateSession={() => undefined}
          onToggleLogs={() => undefined}
          onToggleToolPanel={() => undefined}
          onCycleToolPanel={onCycleToolPanel}
        />
      </app.Application>,
    );

    dispatchChord({ key: "]", code: "BracketRight", ctrlKey: true, shiftKey: true });

    expect(onCycleToolPanel).toHaveBeenCalledWith(1);
  });

  it("cycles to the previous tool panel on Ctrl+Shift+[", () => {
    const { workspaceId, workspace } = makeTwoPaneWorkspace("a");
    const onCycleToolPanel = vi.fn();
    const app = createTestApplication({
      workspace: {
        workspaces: [workspace],
        activeWorkspaceId: workspaceId,
      },
    });

    render(
      <app.Application>
        <KeybindingHarness
          onCreateSession={() => undefined}
          onToggleLogs={() => undefined}
          onToggleToolPanel={() => undefined}
          onCycleToolPanel={onCycleToolPanel}
        />
      </app.Application>,
    );

    dispatchChord({ key: "[", code: "BracketLeft", ctrlKey: true, shiftKey: true });

    expect(onCycleToolPanel).toHaveBeenCalledWith(-1);
  });
});
