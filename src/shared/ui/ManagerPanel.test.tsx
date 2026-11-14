/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagerRow } from "./ManagerPanel";

afterEach(cleanup);

describe("ManagerRow", () => {
  it("selects on single click and opens only on double click", () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    render(<ManagerRow title="Row" onSelect={onSelect} onOpen={onOpen} />);

    const row = screen.getByRole("option");
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.doubleClick(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("shows contextual actions on right click", () => {
    const onEdit = vi.fn();
    render(
      <ManagerRow
        title="Row"
        onSelect={() => undefined}
        onOpen={() => undefined}
        contextMenuItems={[{ id: "edit", label: "Edit", onClick: onEdit }]}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("option"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("marks the selected row with the selection class", () => {
    const { container } = render(<ManagerRow title="Row" isSelected />);
    expect(container.querySelector(".manager-row--selected")).toBeTruthy();
  });

  it("marks connected rows for the success border", () => {
    const { container } = render(<ManagerRow title="Row" status="connected" />);
    expect(container.querySelector(".manager-row--connected")).toBeTruthy();
  });
});
