import { describe, expect, it } from "vitest";
import { buildTmuxPaneTree, parseTmuxGeometry, type TmuxPaneGeometry } from "./tmuxPaneTree";

describe("tmux layout parsing", () => {
  it("parses a single-pane leaf layout", () => {
    const node = parseTmuxGeometry("abcd,80x24,0,0,0");
    expect(node).toEqual({ kind: "leaf", width: 80, height: 24, x: 0, y: 0 });
  });

  it("parses a side-by-side split as horizontal", () => {
    const node = parseTmuxGeometry("abcd,100x24,0,0{50x24,0,0,0,49x24,51,0,1}");
    expect(node).toMatchObject({
      kind: "split",
      direction: "horizontal",
      children: [
        { kind: "leaf", width: 50, x: 0, y: 0 },
        { kind: "leaf", width: 49, x: 51, y: 0 },
      ],
    });
  });

  it("parses a stacked split as vertical", () => {
    const node = parseTmuxGeometry("abcd,100x24,0,0[100x12,0,0,0,100x11,0,13,1]");
    expect(node).toMatchObject({
      kind: "split",
      direction: "vertical",
      children: [
        { kind: "leaf", height: 12, y: 0 },
        { kind: "leaf", height: 11, y: 13 },
      ],
    });
  });

  it("parses nested mixed-direction layouts", () => {
    const node = parseTmuxGeometry(
      "d5c1,100x30,0,0{50x30,0,0[50x15,0,0,0,50x14,0,16,2],49x30,51,0,1}",
    );
    expect(node).toMatchObject({
      kind: "split",
      direction: "horizontal",
      children: [
        {
          kind: "split",
          direction: "vertical",
          children: [
            { kind: "leaf", width: 50, height: 15, x: 0, y: 0 },
            { kind: "leaf", width: 50, height: 14, x: 0, y: 16 },
          ],
        },
        { kind: "leaf", width: 49, height: 30, x: 51, y: 0 },
      ],
    });
  });
});

describe("tmux pane tree building", () => {
  it("maps layout rectangles to terminal ids and preserves split direction", () => {
    const panes: TmuxPaneGeometry[] = [
      { terminalId: 8, width: 50, height: 24, x: 0, y: 0 },
      { terminalId: 9, width: 49, height: 24, x: 51, y: 0 },
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
      { terminalId: 8, width: 80, height: 24, x: 0, y: 0 },
      { terminalId: 9, width: 80, height: 24, x: 0, y: 13 },
    ];
    const tree = buildTmuxPaneTree("", panes, "cfg-1");
    expect(tree).toMatchObject({ type: "split", direction: "vertical" });
  });
});
