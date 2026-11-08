import { describe, expect, it } from "vitest";
import { createTmuxPaneId, createTmuxWindowId } from "../ids";
import { type ModelResult } from "../result";
import { createLocalTmuxLaunchConfig } from "../launch/TmuxLaunchConfig";
import {
  addTmuxWindow,
  connectTmuxController,
  createTmuxController,
  findTmuxPaneInController,
} from "./TmuxController";
import { createTmuxPane } from "./TmuxPane";
import { createTmuxPaneLeaf, createTmuxPaneSplit } from "./TmuxPaneLayout";
import { createTmuxWindow } from "./TmuxWindow";

function unwrap<Value>(result: ModelResult<Value>): Value {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

describe("tmux controller model", () => {
  it("owns windows and panes without becoming a generic terminal instance", () => {
    const firstPaneId = createTmuxPaneId("%1");
    const secondPaneId = createTmuxPaneId("%2");
    const firstPane = unwrap(createTmuxPane({ id: "%1", streamId: 101 }));
    const secondPane = unwrap(createTmuxPane({ id: "%2", streamId: 102 }));
    const layout = unwrap(
      createTmuxPaneSplit(
        "horizontal",
        0.5,
        createTmuxPaneLeaf(firstPaneId),
        createTmuxPaneLeaf(secondPaneId),
      ),
    );
    const window = unwrap(
      createTmuxWindow({
        id: "@1",
        name: "editor",
        activePaneId: firstPaneId,
        panes: [firstPane, secondPane],
        layout,
      }),
    );
    const launch = unwrap(
      createLocalTmuxLaunchConfig({
        baseConfigId: " base-shell ",
        socketName: "work",
      }),
    );
    const controller = unwrap(
      createTmuxController({
        id: 7,
        configId: "tmux-config-1",
        launch: launch.transport,
      }),
    );
    const connected = unwrap(connectTmuxController(controller, [window], 1_000));

    expect(connected.windows).toHaveLength(1);
    expect(connected.status).toEqual({ kind: "connected", connectedAt: 1_000 });
    expect(launch.baseConfigId).toBe("base-shell");
    expect(findTmuxPaneInController(connected, secondPaneId)?.pane.streamId).toBe(102);
  });

  it("rejects duplicate window ids and duplicate panes across windows", () => {
    const pane = unwrap(createTmuxPane({ id: "%1", streamId: 201 }));
    const firstWindow = unwrap(
      createTmuxWindow({
        id: "@1",
        name: "first",
        activePaneId: pane.id,
        panes: [pane],
        layout: createTmuxPaneLeaf(pane.id),
      }),
    );
    const duplicatePaneWindow = unwrap(
      createTmuxWindow({
        id: "@2",
        name: "second",
        activePaneId: pane.id,
        panes: [pane],
        layout: createTmuxPaneLeaf(pane.id),
      }),
    );
    const launch = unwrap(createLocalTmuxLaunchConfig());
    const controller = unwrap(
      createTmuxController({
        id: 8,
        configId: "tmux-config-2",
        launch: launch.transport,
      }),
    );
    const connected = unwrap(connectTmuxController(controller, [firstWindow], 2_000));

    expect(addTmuxWindow(connected, duplicatePaneWindow)).toMatchObject({
      ok: false,
      error: { code: "duplicate-id" },
    });
    expect(
      addTmuxWindow(connected, {
        ...firstWindow,
        id: createTmuxWindowId("@1"),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "duplicate-id" },
    });
  });

  it("validates that a window layout references exactly its declared panes", () => {
    const pane = unwrap(createTmuxPane({ id: "%1", streamId: 301 }));
    const otherPaneId = createTmuxPaneId("%2");

    expect(
      createTmuxWindow({
        id: "@1",
        name: "broken",
        activePaneId: pane.id,
        panes: [pane],
        layout: createTmuxPaneLeaf(otherPaneId),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-layout" },
    });
  });
});
