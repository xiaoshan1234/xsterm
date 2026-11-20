import { describe, expect, it } from "vitest";
import { createTerminalId } from "../../../models";
import { buildTmuxPaneTree, type TmuxPaneGeometry } from "./tmuxWorkspacePaneTree";

describe("tmux workspace pane tree building", () => {
  it("maps layout rectangles to terminal ids and preserves split direction", () => {
    const panes: TmuxPaneGeometry[] = [
      { terminalId: createTerminalId(8), width: 50, height: 24, x: 0, y: 0 },
      { terminalId: createTerminalId(9), width: 49, height: 24, x: 51, y: 0 },
    ];
    const tree = buildTmuxPaneTree("abcd,100x24,0,0{50x24,0,0,0,49x24,51,0,1}", panes, "cfg-1");

    expect(tree).toMatchObject({
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", terminalId: 8, configId: "cfg-1" },
        { type: "leaf", terminalId: 9, configId: "cfg-1" },
      ],
    });
  });

  it("falls back to a vertical stack when layout is missing", () => {
    const panes: TmuxPaneGeometry[] = [
      { terminalId: createTerminalId(8), width: 80, height: 24, x: 0, y: 0 },
      { terminalId: createTerminalId(9), width: 80, height: 24, x: 0, y: 13 },
    ];
    const tree = buildTmuxPaneTree("", panes, "cfg-1");
    expect(tree).toMatchObject({ type: "split", direction: "vertical" });
  });
});
