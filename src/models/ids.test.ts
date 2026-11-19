import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createLaunchConfigId,
  createPaneId,
  createSshCredentialId,
  createTerminalId,
  createTmuxPaneId,
  createTmuxWindowId,
  createWorkspaceId,
  createXstermWindowId,
  type PaneId,
  type TerminalId,
  type TmuxPaneId,
  type WindowId,
  type WorkspaceId,
} from "./ids";

describe("branded ids", () => {
  it("trims string identifiers before branding them", () => {
    expect(createWorkspaceId(" workspace-1 ")).toBe("workspace-1");
    expect(createPaneId(" pane-1 ")).toBe("pane-1");
    expect(createLaunchConfigId(" config-1 ")).toBe("config-1");
    expect(createSshCredentialId(" credential-1 ")).toBe("credential-1");
  });

  it("rejects blank identifiers", () => {
    expect(() => createWorkspaceId("   ")).toThrow(/non-empty/);
  });

  it("rejects invalid numeric identifiers", () => {
    expect(() => createTerminalId(-1)).toThrow(/non-negative safe integer/);
    expect(() => createXstermWindowId(1.5)).toThrow(/non-negative safe integer/);
  });

  it("keeps tmux window and pane id shapes distinct", () => {
    expect(createTmuxWindowId("@1")).toBe("@1");
    expect(createTmuxPaneId("%1")).toBe("%1");
    expect(() => createTmuxWindowId("%1")).toThrow(/@1/);
    expect(() => createTmuxPaneId("@1")).toThrow(/%1/);
  });

  it("keeps aggregate id brands nominally distinct", () => {
    expectTypeOf<WorkspaceId>().not.toEqualTypeOf<WindowId>();
    expectTypeOf<WindowId>().not.toEqualTypeOf<PaneId>();
    expectTypeOf<TerminalId>().not.toEqualTypeOf<PaneId>();
    expectTypeOf<TmuxPaneId>().not.toEqualTypeOf<PaneId>();
  });
});
