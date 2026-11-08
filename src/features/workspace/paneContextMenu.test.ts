import { describe, expect, it } from "vitest";
import { buildPaneContextMenu, type PaneMenuActions } from "./paneContextMenu";
import type { Terminal } from "../../types/terminal";

function terminal(overrides: Partial<Terminal> = {}): Terminal {
  return {
    id: 1,
    configId: "cfg-1",
    name: "s1",
    type: "local",
    isConnected: true,
    kind: { type: "local", shell: "", cwd: "" },
    ...overrides,
  };
}

const noopActions: PaneMenuActions = {
  startSplit: () => undefined,
  startAttach: () => undefined,
  selectAll: () => undefined,
  copy: async () => undefined,
  paste: async () => undefined,
  clear: () => undefined,
  closePane: () => undefined,
  closeTerminal: () => undefined,
};

function labels(items: ReturnType<typeof buildPaneContextMenu>): string[] {
  return items.map((item) => item.label);
}

describe("buildPaneContextMenu", () => {
  it("includes only Split + Attach + Close Pane when there is no terminal", () => {
    const items = buildPaneContextMenu(undefined, noopActions);
    expect(labels(items)).toEqual([
      "Split Horizontal",
      "Split Vertical",
      "Attach Terminal",
      "Close Pane",
    ]);
  });

  it("includes Select All, Copy, Paste, Clear Pane, Close Pane, Close Terminal when a connected terminal is attached", () => {
    const items = buildPaneContextMenu(terminal({ isConnected: true }), noopActions);
    expect(labels(items)).toEqual([
      "Split Horizontal",
      "Split Vertical",
      "Select All",
      "Copy",
      "Paste",
      "Clear Pane",
      "Close Pane",
      "Close Terminal",
    ]);
  });

  it("omits Paste when the terminal exists but is not connected", () => {
    const items = buildPaneContextMenu(terminal({ isConnected: false }), noopActions);
    expect(labels(items)).toEqual([
      "Split Horizontal",
      "Split Vertical",
      "Select All",
      "Copy",
      "Clear Pane",
      "Close Pane",
      "Close Terminal",
    ]);
  });

  it("marks both Close items as danger", () => {
    const items = buildPaneContextMenu(terminal(), noopActions);
    const closePane = items.find((i) => i.label === "Close Pane");
    const closeTerminal = items.find((i) => i.label === "Close Terminal");
    expect(closePane?.danger).toBe(true);
    expect(closeTerminal?.danger).toBe(true);
  });

  it("does not mark non-close items as danger", () => {
    const items = buildPaneContextMenu(terminal(), noopActions);
    const dangerItems = items.filter((i) => i.danger);
    expect(labels(dangerItems)).toEqual(["Close Pane", "Close Terminal"]);
  });

  it("Close Pane comes before Close Terminal when both are present", () => {
    const items = buildPaneContextMenu(terminal(), noopActions);
    const closePaneIdx = items.findIndex((i) => i.label === "Close Pane");
    const closeTerminalIdx = items.findIndex((i) => i.label === "Close Terminal");
    expect(closePaneIdx).toBeLessThan(closeTerminalIdx);
  });

  it("Split Horizontal passes 'horizontal' to startSplit", () => {
    let captured: string | undefined;
    const items = buildPaneContextMenu(undefined, {
      ...noopActions,
      startSplit: (d) => {
        captured = d;
      },
    });
    items.find((i) => i.label === "Split Horizontal")!.onClick();
    expect(captured).toBe("horizontal");
  });

  it("Split Vertical passes 'vertical' to startSplit", () => {
    let captured: string | undefined;
    const items = buildPaneContextMenu(undefined, {
      ...noopActions,
      startSplit: (d) => {
        captured = d;
      },
    });
    items.find((i) => i.label === "Split Vertical")!.onClick();
    expect(captured).toBe("vertical");
  });

  it("Close Pane delegates to actions.closePane", () => {
    let called = false;
    const items = buildPaneContextMenu(terminal(), {
      ...noopActions,
      closePane: () => {
        called = true;
      },
    });
    items.find((i) => i.label === "Close Pane")!.onClick();
    expect(called).toBe(true);
  });
});
