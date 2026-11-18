/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppShellPreview } from "./AppShellPreview";

afterEach(cleanup);

function toggleSenderFromViewMenu(): void {
  fireEvent.click(screen.getByRole("button", { name: "View" }));
  const sender = screen.getByRole("menuitemcheckbox", { name: "Sender" });
  expect(sender.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(sender);
}

describe("AppShellPreview", () => {
  it("keeps Help as the last primary navigation entry", () => {
    const { container } = render(<AppShellPreview />);

    const entries = Array.from(
      container.querySelectorAll(
        ".navbar-menu > .navbar-item, .navbar-menu > .navbar-menu-root > .navbar-item",
      ),
    );
    const labels = entries.map((element) =>
      element.querySelector(".navbar-primary-label")?.textContent?.trim(),
    );

    expect(labels).toEqual(["Terminal", "View", "Workspace", "Help"]);
    expect(
      entries.every((element) => element.querySelector(".navbar-primary-label") !== null),
    ).toBe(true);
  });

  it("shows a check mark beside Sender while the sender panel is open", () => {
    render(<AppShellPreview />);

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Sender" }));
    fireEvent.click(screen.getByRole("button", { name: "View" }));

    const sender = screen.getByRole("menuitemcheckbox", { name: "Sender" });
    expect(sender.getAttribute("aria-checked")).toBe("true");
    expect(sender.textContent).toContain("✓");
  });

  it("lists default-group terminals from the Terminal menu", () => {
    render(<AppShellPreview />);

    fireEvent.click(screen.getByRole("button", { name: "Terminal" }));

    expect(screen.getByRole("menuitem", { name: "Local PowerShell" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Production SSH" })).toBeTruthy();
  });

  it("opens the version dialog from Help", () => {
    render(<AppShellPreview />);

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Version" }));

    expect(screen.getByRole("heading", { name: "Version" })).toBeTruthy();
    expect(screen.getByText("Version 0.2.2")).toBeTruthy();
  });

  it("opens the update dialog from Help", () => {
    render(<AppShellPreview />);

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Update" }));

    expect(screen.getByRole("heading", { name: "Update" })).toBeTruthy();
    expect(screen.getByText("Current version: 0.2.2")).toBeTruthy();
  });

  it("opens the license dialog from Help", () => {
    render(<AppShellPreview />);

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "License" }));

    expect(screen.getByRole("heading", { name: "License" })).toBeTruthy();
    expect(screen.getByText(/xscore is distributed under the following MIT license/)).toBeTruthy();
  });

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

    toggleSenderFromViewMenu();
    expect(screen.getByRole("region", { name: "Global text sender" })).toBeTruthy();
    expect(container.querySelector(".shell-text-sender-slot")).toBeTruthy();
  });

  it("shows the focused pane details in the bottom bar", () => {
    const { container } = render(<AppShellPreview />);

    const runtimeStatus = container.querySelector(".shell-bottom-runtime");
    expect(runtimeStatus?.textContent).toContain("Local PowerShell");
    expect(runtimeStatus?.textContent).toContain("Local");
    expect(runtimeStatus?.textContent).toContain("pwsh / Main");
    expect(runtimeStatus?.textContent).toContain("120×36");
    expect(runtimeStatus?.textContent).toContain("Pane 1/2");
    expect(screen.queryByRole("button", { name: /Runtime status/ })).toBeNull();
    expect(container.querySelector(".shell-bottom-bar")?.querySelectorAll("button")).toHaveLength(
      0,
    );
  });

  it("shows saved tmux sessions grouped by their base configuration", () => {
    render(<AppShellPreview />);

    fireEvent.click(screen.getByRole("button", { name: "Tmux Manager" }));
    expect(screen.getByRole("button", { name: "WSL" })).toBeTruthy();
    expect(screen.getByText("WSL work")).toBeTruthy();
    expect(screen.getByText("WSL codex")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mac" })).toBeTruthy();

    fireEvent.contextMenu(screen.getByText("WSL work"));
    expect(screen.getByRole("button", { name: "Detach" })).toBeTruthy();
  });

  it("closes a specific non-default workspace from the workspace menu", () => {
    render(<AppShellPreview />);

    fireEvent.click(screen.getByRole("button", { name: "Switch workspace: Default" }));
    expect(screen.queryByRole("button", { name: "Close workspace Default" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close workspace Project X" }));

    fireEvent.click(screen.getByRole("button", { name: "Switch workspace: Default" }));
    expect(screen.queryByRole("menuitemradio", { name: "Project X" })).toBeNull();
    expect(screen.getByRole("menuitemradio", { name: "Infrastructure" })).toBeTruthy();
  });

  it("switches the active workspace from the nav bar", () => {
    render(<AppShellPreview />);

    fireEvent.click(screen.getByRole("button", { name: "Switch workspace: Default" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Project X" }));

    expect(screen.getByRole("button", { name: "Switch workspace: Project X" })).toBeTruthy();
  });

  it("resizes the Sender panel with the keyboard", () => {
    const { container } = render(<AppShellPreview />);

    toggleSenderFromViewMenu();
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
