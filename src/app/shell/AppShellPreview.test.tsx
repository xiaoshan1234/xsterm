/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppShellPreview } from "./AppShellPreview";

afterEach(cleanup);

describe("AppShellPreview", () => {
  it("opens managers and the global text sender", () => {
    const { container } = render(<AppShellPreview />);

    fireEvent.click(screen.getByRole("button", { name: "Terminal Manager" }));
    expect(screen.getByRole("heading", { name: "Terminal Manager" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close Terminal Manager" })).toBeNull();
    expect(screen.getByRole("button", { name: "New Terminal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New Group" })).toBeTruthy();

    const resizeHandle = screen.getByRole("separator", { name: "Resize Terminal Manager" });
    fireEvent.keyDown(resizeHandle, { key: "ArrowRight" });
    expect(resizeHandle.getAttribute("aria-valuenow")).toBe("208");
    expect(
      screen.getByRole("region", { name: "Terminal Manager" }).getAttribute("style"),
    ).toContain("width: 208px");

    fireEvent.click(screen.getByRole("button", { name: "Sender" }));
    expect(screen.getByRole("region", { name: "Global text sender" })).toBeTruthy();
    expect(container.querySelector(".shell-text-sender-slot")).toBeTruthy();
  });

  it("renders status managers without create footers", () => {
    render(<AppShellPreview />);

    fireEvent.click(screen.getByRole("button", { name: "Terminal Status" }));
    expect(screen.getByRole("heading", { name: "Terminal Status" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New Terminal" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Tmux Status" }));
    expect(screen.getByRole("heading", { name: "Tmux Status" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New Tmux Session" })).toBeNull();
  });

  it("closes a specific non-default workspace from the workspace menu", () => {
    render(<AppShellPreview />);

    fireEvent.click(screen.getByRole("button", { name: "Switch workspace: Default" }));

    expect(screen.queryByRole("menuitem", { name: "Close workspace Default" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Close workspace Project X" }));

    expect(screen.queryByRole("menuitem", { name: "Project X" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Infrastructure" })).toBeTruthy();
  });

  it("resizes the Sender panel with the keyboard", () => {
    const { container } = render(<AppShellPreview />);

    fireEvent.click(screen.getByRole("button", { name: "Sender" }));
    const slot = container.querySelector(".shell-text-sender-slot") as HTMLDivElement;
    const resizer = screen.getByRole("separator", { name: "Resize Sender" });

    expect(slot.style.height).toBe("400px");
    fireEvent.keyDown(resizer, { key: "ArrowUp" });
    expect(slot.style.height).toBe("408px");
    fireEvent.keyDown(resizer, { key: "ArrowDown" });
    expect(slot.style.height).toBe("400px");
  });

  it("blocks the app shell while an error dialog is open", () => {
    const { container } = render(<AppShellPreview />);

    fireEvent.click(screen.getByRole("button", { name: "Error" }));

    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(container.querySelector(".shell-content")?.hasAttribute("inert")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(container.querySelector(".shell-content")?.hasAttribute("inert")).toBe(false);
  });
});
