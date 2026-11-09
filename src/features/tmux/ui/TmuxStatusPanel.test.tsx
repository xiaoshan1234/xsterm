/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type TmuxStatusControllerViewData } from "../viewModels/statusViewModel";
import { TmuxStatusPanel } from "./TmuxStatusPanel";

afterEach(cleanup);

const controllers: TmuxStatusControllerViewData[] = [
  {
    controllerId: 1,
    title: "main",
    status: "connected",
    transport: "ssh",
    windows: [
      {
        tmuxWindowId: "@1",
        name: "editor",
        status: "connected",
        panes: [
          {
            terminalId: 8,
            tmuxPaneId: "%1",
            tmuxWindowId: "@1",
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
    render(<TmuxStatusPanel controllers={controllers} onFocusPane={() => undefined} />);
    expect(screen.getByText("bash")).toBeTruthy();

    const [sessionCollapse] = screen.getAllByRole("button", { name: "Collapse" });
    fireEvent.click(sessionCollapse);
    expect(screen.queryByText("editor")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByText("editor")).toBeTruthy();
  });

  it("collapses the window level", () => {
    render(<TmuxStatusPanel controllers={controllers} onFocusPane={() => undefined} />);
    const collapseButtons = screen.getAllByRole("button", { name: "Collapse" });
    fireEvent.click(collapseButtons[1]);

    expect(screen.getByText("editor")).toBeTruthy();
    expect(screen.queryByText("bash")).toBeNull();
  });
});
