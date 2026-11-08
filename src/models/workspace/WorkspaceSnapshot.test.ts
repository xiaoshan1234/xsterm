import { describe, expect, it } from "vitest";
import { type ModelResult } from "../result";
import { parseWorkspaceSnapshot } from "./WorkspaceSnapshot";

function unwrap<Value>(result: ModelResult<Value>): Value {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

const validSnapshot = {
  version: 1,
  id: "workspace-1",
  name: "Workspace",
  activeWindowId: "window-1",
  windows: [
    {
      kind: "raw-window",
      id: "window-1",
      name: "Main",
      activePaneId: "pane-1",
      layout: {
        kind: "leaf",
        id: "pane-1",
        content: {
          kind: "terminal",
          configId: "config-1",
        },
      },
    },
    {
      kind: "tmux-window-reference",
      id: "window-2",
      controllerConfigId: "tmux-config-1",
      tmuxWindowId: "@1",
    },
  ],
};

describe("WorkspaceSnapshot", () => {
  it("parses and normalizes a valid snapshot", () => {
    const snapshot = unwrap(
      parseWorkspaceSnapshot({
        ...validSnapshot,
        id: " workspace-1 ",
        windows: [
          {
            ...validSnapshot.windows[0],
            id: " window-1 ",
            activePaneId: " pane-1 ",
            layout: {
              ...validSnapshot.windows[0].layout,
              id: " pane-1 ",
              content: {
                kind: "terminal",
                configId: " config-1 ",
              },
            },
          },
          validSnapshot.windows[1],
        ],
      }),
    );

    expect(snapshot.id).toBe("workspace-1");
    expect(snapshot.activeWindowId).toBe("window-1");
    expect(snapshot.windows).toHaveLength(2);
  });

  it("rejects unsupported versions and invalid active windows", () => {
    expect(
      parseWorkspaceSnapshot({
        ...validSnapshot,
        version: 99,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-value" },
    });

    expect(
      parseWorkspaceSnapshot({
        ...validSnapshot,
        activeWindowId: "missing-window",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-layout" },
    });
  });

  it("rejects duplicate pane ids and malformed split ratios", () => {
    expect(
      parseWorkspaceSnapshot({
        ...validSnapshot,
        windows: [
          {
            ...validSnapshot.windows[0],
            activePaneId: "pane-1",
            layout: {
              kind: "split",
              id: "split-1",
              direction: "horizontal",
              ratio: 0.5,
              children: [validSnapshot.windows[0].layout, validSnapshot.windows[0].layout],
            },
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "duplicate-id" },
    });

    expect(
      parseWorkspaceSnapshot({
        ...validSnapshot,
        windows: [
          {
            ...validSnapshot.windows[0],
            layout: {
              kind: "split",
              id: "split-1",
              direction: "horizontal",
              ratio: 1,
              children: [
                validSnapshot.windows[0].layout,
                {
                  kind: "leaf",
                  id: "pane-2",
                  content: { kind: "empty" },
                },
              ],
            },
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-layout" },
    });
  });
});
