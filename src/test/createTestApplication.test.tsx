/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSavedLaunchConfigs } from "../features/launch-config";
import { useSessionPreferences } from "../features/settings";
import { useTerminalRuntime } from "../features/terminal";
import { usePaneIntents, useWorkspaceLayout } from "../features/workspace";
import { createTestApplication } from "./createTestApplication";

function ContextProbe() {
  const launchConfig = useSavedLaunchConfigs();
  const preferences = useSessionPreferences();
  const terminal = useTerminalRuntime();
  const workspace = useWorkspaceLayout();
  const paneIntents = usePaneIntents();

  return (
    <div>
      {launchConfig.groups.length}:{preferences.globalLocalEcho ? "echo" : "silent"}:
      {terminal.terminals.length}:{workspace.workspaces.length}:
      {typeof paneIntents.closePane === "function" ? "intents" : "missing"}
    </div>
  );
}

describe("createTestApplication", () => {
  it("provides default feature contexts", () => {
    const app = createTestApplication();

    render(
      <app.Application>
        <ContextProbe />
      </app.Application>,
    );

    expect(screen.getByText("0:silent:0:0:intents")).toBeTruthy();
  });

  it("allows focused context overrides", () => {
    const app = createTestApplication({
      launchConfig: {
        groups: [{ id: 0, name: "default", configIds: [], collapsed: false }],
      },
      preferences: { globalLocalEcho: true },
    });

    render(
      <app.Application>
        <ContextProbe />
      </app.Application>,
    );

    expect(screen.getByText("1:echo:0:0:intents")).toBeTruthy();
  });
});
