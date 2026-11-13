/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type TmuxStatusControllerViewData } from "../viewModels/statusViewModel";
import { TmuxStatusPanel } from "./TmuxStatusPanel";

afterEach(cleanup);

const controllers: TmuxStatusControllerViewData[] = [
  {
    controllerId: 1,
    title: "main",
    sessionName: "work",
    status: "connected",
    transport: "ssh",
    windows: [
      {
        tmuxWindowId: "@1",
        windowIndex: 0,
        name: "editor",
        status: "connected",
        panes: [
          {
            terminalId: 8,
            tmuxPaneId: "%1",
            tmuxWindowId: "@1",
            windowIndex: 0,
            paneIndex: 1,
            width: 88,
            height: 1,
            currentCommand: "bash",
            isActive: true,
            title: "bash",
            status: "connected",
          },
        ],
      },
    ],
  },
];

describe("TmuxStatusPanel", () => {
  it("collapses the session level", () => {
    render(
      <TmuxStatusPanel
        controllers={controllers}
        onFocusPane={() => undefined}
        onReconnectSession={() => undefined}
        onDetachSession={() => undefined}
      />,
    );
    expect(screen.getByText("work:1")).toBeTruthy();
    expect(screen.queryByText(/panes/)).toBeNull();
    expect(screen.queryByText(/88x1/)).toBeNull();
    expect(screen.getByText("bash")).toBeTruthy();

    const [sessionCollapse] = screen.getAllByRole("button", { name: "Collapse" });
    fireEvent.click(sessionCollapse);
    expect(screen.queryByText("editor")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByText("editor")).toBeTruthy();
  });

  it("collapses the window level", () => {
    render(
      <TmuxStatusPanel
        controllers={controllers}
        onFocusPane={() => undefined}
        onReconnectSession={() => undefined}
        onDetachSession={() => undefined}
      />,
    );
    const collapseButtons = screen.getAllByRole("button", { name: "Collapse" });
    fireEvent.click(collapseButtons[1]);

    expect(screen.getByText("editor")).toBeTruthy();
    expect(screen.queryByText("bash")).toBeNull();
  });

  it("focuses the window's first pane on click and the pane itself on click", () => {
    const onFocusPane = vi.fn();
    render(
      <TmuxStatusPanel
        controllers={controllers}
        onFocusPane={onFocusPane}
        onReconnectSession={() => undefined}
        onDetachSession={() => undefined}
      />,
    );

    const rows = screen.getAllByRole("option");
    fireEvent.click(rows[1]);
    expect(onFocusPane).toHaveBeenCalledWith(8);

    onFocusPane.mockClear();
    fireEvent.click(rows[2]);
    expect(onFocusPane).toHaveBeenCalledWith(8);
  });

  it("reconnects and detaches from the session context menu", () => {
    const onReconnect = vi.fn();
    const onDetach = vi.fn();
    render(
      <TmuxStatusPanel
        controllers={controllers}
        onFocusPane={() => undefined}
        onReconnectSession={onReconnect}
        onDetachSession={onDetach}
      />,
    );

    fireEvent.contextMenu(screen.getAllByRole("option")[0]);
    expect(screen.queryByRole("button", { name: "Close All Windows" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Focus First Pane" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect Session" }));
    expect(onReconnect).toHaveBeenCalledWith(1);

    fireEvent.contextMenu(screen.getAllByRole("option")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Detach Session" }));
    expect(onDetach).toHaveBeenCalledWith(1);
  });

  it("does not expose focus actions in window or pane context menus", () => {
    render(
      <TmuxStatusPanel
        controllers={controllers}
        onFocusPane={() => undefined}
        onReconnectSession={() => undefined}
        onDetachSession={() => undefined}
      />,
    );

    const rows = screen.getAllByRole("option");
    fireEvent.contextMenu(rows[1]);
    expect(screen.queryByRole("button", { name: "Focus First Pane" })).toBeNull();

    fireEvent.contextMenu(rows[2]);
    expect(screen.queryByRole("button", { name: "Focus" })).toBeNull();
  });
});
