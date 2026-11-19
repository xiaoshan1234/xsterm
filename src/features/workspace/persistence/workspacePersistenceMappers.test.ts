import { describe, expect, it } from "vitest";
import {
  parseEditablePaneNode,
  parseLegacySavedWorkspace,
  parseSavedWorkspace,
} from "./workspacePersistenceMappers";

const rawPane = {
  id: "pane-1",
  type: "leaf",
  size: 100,
  terminalId: 7,
  configId: "config-1",
};

describe("workspace persistence mappers", () => {
  it("brands structural ids at the persisted-data boundary", () => {
    const pane = parseEditablePaneNode(rawPane);
    const workspace = parseSavedWorkspace({
      id: "saved-workspace-1",
      name: "Work",
      windows: [{ id: "saved-window-1", name: "Window", rootPane: rawPane }],
    });

    expect(pane.id).toBe("pane-1");
    expect(pane.terminalId).toBe(7);
    expect(workspace.windows[0].rootPane.id).toBe("pane-1");
  });

  it("migrates the legacy workspace root pane", () => {
    const workspace = parseLegacySavedWorkspace({
      id: "saved-workspace-1",
      name: "Legacy",
      rootPane: rawPane,
    });

    expect(workspace.windows).toHaveLength(1);
    expect(workspace.windows[0].name).toBe("Legacy");
    expect(workspace.windows[0].rootPane).toMatchObject({
      id: "pane-1",
      terminalId: 7,
      configId: "config-1",
    });
  });

  it("rejects malformed persisted pane trees", () => {
    expect(() => parseEditablePaneNode({ id: "", type: "leaf", size: 100 })).toThrow(
      /non-empty string/,
    );
    expect(() =>
      parseEditablePaneNode({
        id: "split-1",
        type: "split",
        size: 100,
        direction: "diagonal",
        children: [rawPane, rawPane],
      }),
    ).toThrow(/horizontal or vertical/);
  });
});
