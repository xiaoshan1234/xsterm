/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type TmuxManagerGroupViewData } from "../viewModels/managerViewModel";
import { TmuxManagerPanel } from "./TmuxManagerPanel";

afterEach(cleanup);

const groups: readonly TmuxManagerGroupViewData[] = [
  {
    key: "wsl-base",
    name: "WSL",
    items: [
      {
        configId: "work",
        name: "WSL work",
        baseConfigId: "wsl-base",
        baseConfigName: "WSL",
        transport: "wsl",
      },
      {
        configId: "codex",
        name: "WSL codex",
        baseConfigId: "wsl-base",
        baseConfigName: "WSL",
        transport: "wsl",
      },
    ],
  },
  {
    key: "unassigned",
    name: "Unassigned",
    items: [
      {
        configId: "legacy",
        name: "Legacy",
        transport: "local",
      },
    ],
  },
];

describe("TmuxManagerPanel", () => {
  it("groups sessions by base configuration and collapses a directory", () => {
    render(
      <TmuxManagerPanel
        groups={groups}
        onCreateTmux={() => undefined}
        onNewTmux={() => undefined}
        onOpenConfig={() => undefined}
        onEditConfig={() => undefined}
        onRemoveConfig={() => undefined}
      />,
    );

    expect(screen.getByText("WSL work")).toBeTruthy();
    expect(screen.getByText("WSL codex")).toBeTruthy();
    expect(screen.getByText("Legacy")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "WSL" }));
    expect(screen.queryByText("WSL work")).toBeNull();
    expect(screen.queryByText("WSL codex")).toBeNull();
  });
});
