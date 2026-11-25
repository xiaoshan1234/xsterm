/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalPropertiesDialog } from "./TerminalPropertiesDialog";

afterEach(cleanup);

describe("TerminalPropertiesDialog", () => {
  it("emits live terminal-property patches without a save step", () => {
    const onChange = vi.fn();
    render(
      <TerminalPropertiesDialog
        isOpen
        terminalName="shell"
        properties={{}}
        onChange={onChange}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByText("Terminal", { selector: ".dialog-sidebar-item-label" }));
    fireEvent.click(screen.getByRole("checkbox"));

    expect(onChange).toHaveBeenCalledWith({ gutterEnabled: false });
  });

  it("edits appearance properties immediately", () => {
    const onChange = vi.fn();
    render(
      <TerminalPropertiesDialog
        isOpen
        terminalName="shell"
        properties={{ fontSize: 14 }}
        onChange={onChange}
        onClose={() => undefined}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("14"), { target: { value: "18" } });

    expect(onChange).toHaveBeenCalledWith({ fontSize: 18 });
  });
});
