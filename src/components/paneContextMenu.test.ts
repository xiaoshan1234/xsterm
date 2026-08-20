import { describe, expect, it } from "vitest";
import { buildPaneContextMenu, type PaneMenuActions } from "./paneContextMenu";
import type { Session } from "../types/session";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 1,
    configId: "cfg-1",
    name: "s1",
    type: "local",
    isConnected: true,
    sessionType: { type: "local", config: { shell: "", cwd: "" } },
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
  closeSession: () => undefined,
};

function labels(items: ReturnType<typeof buildPaneContextMenu>): string[] {
  return items.map((item) => item.label);
}

describe("buildPaneContextMenu", () => {
  it("includes only Split + Attach + Close Pane when there is no session", () => {
    const items = buildPaneContextMenu(undefined, noopActions);
    expect(labels(items)).toEqual([
      "Split Horizontal",
      "Split Vertical",
      "Attach Session",
      "Close Pane",
    ]);
  });

  it("includes Select All, Copy, Paste, Clear Pane, Close Pane, Close Session when a connected session is attached", () => {
    const items = buildPaneContextMenu(session({ isConnected: true }), noopActions);
    expect(labels(items)).toEqual([
      "Split Horizontal",
      "Split Vertical",
      "Select All",
      "Copy",
      "Paste",
      "Clear Pane",
      "Close Pane",
      "Close Session",
    ]);
  });

  it("omits Paste when the session exists but is not connected", () => {
    const items = buildPaneContextMenu(session({ isConnected: false }), noopActions);
    expect(labels(items)).toEqual([
      "Split Horizontal",
      "Split Vertical",
      "Select All",
      "Copy",
      "Clear Pane",
      "Close Pane",
      "Close Session",
    ]);
  });

  it("marks both Close items as danger", () => {
    const items = buildPaneContextMenu(session(), noopActions);
    const closePane = items.find((i) => i.label === "Close Pane");
    const closeSession = items.find((i) => i.label === "Close Session");
    expect(closePane?.danger).toBe(true);
    expect(closeSession?.danger).toBe(true);
  });

  it("does not mark non-close items as danger", () => {
    const items = buildPaneContextMenu(session(), noopActions);
    const dangerItems = items.filter((i) => i.danger);
    expect(labels(dangerItems)).toEqual(["Close Pane", "Close Session"]);
  });

  it("Close Pane comes before Close Session when both are present", () => {
    const items = buildPaneContextMenu(session(), noopActions);
    const closePaneIdx = items.findIndex((i) => i.label === "Close Pane");
    const closeSessionIdx = items.findIndex((i) => i.label === "Close Session");
    expect(closePaneIdx).toBeLessThan(closeSessionIdx);
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
    const items = buildPaneContextMenu(session(), {
      ...noopActions,
      closePane: () => {
        called = true;
      },
    });
    items.find((i) => i.label === "Close Pane")!.onClick();
    expect(called).toBe(true);
  });
});
