/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobalTextSender } from "./GlobalTextSender";

const TARGETS = [
  {
    id: "target-1",
    label: "Local PowerShell",
    breadcrumb: "Default / Main / Pane 1",
    status: "Connected",
    isAvailable: true,
  },
];

afterEach(cleanup);

describe("GlobalTextSender", () => {
  it("keeps text isolated between input tabs", () => {
    render(
      <GlobalTextSender
        targets={TARGETS}
        selectedTargetId="target-1"
        onSelectTarget={vi.fn()}
        onSend={async () => undefined}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Sender input" });
    fireEvent.change(input, { target: { value: "first tab" } });
    fireEvent.click(screen.getByRole("button", { name: "Add sender tab" }));
    expect(screen.getByRole("tab", { name: "Tab 2" }).getAttribute("aria-selected")).toBe("true");
    expect(
      (screen.getByRole("textbox", { name: "Sender input" }) as HTMLTextAreaElement).value,
    ).toBe("");

    fireEvent.change(screen.getByRole("textbox", { name: "Sender input" }), {
      target: { value: "second tab" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Tab 1" }));

    expect(
      (screen.getByRole("textbox", { name: "Sender input" }) as HTMLTextAreaElement).value,
    ).toBe("first tab");
  });

  it("switches between line and character rate controls", () => {
    render(
      <GlobalTextSender
        targets={TARGETS}
        selectedTargetId="target-1"
        onSelectTarget={vi.fn()}
        onSend={async () => undefined}
      />,
    );

    expect(screen.getByRole("spinbutton", { name: "Lines per second" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Character" }));
    expect(screen.getByRole("spinbutton", { name: "Characters per second" })).toBeTruthy();
    expect(screen.getByText("chars/s")).toBeTruthy();
  });
});
