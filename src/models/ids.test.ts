import { describe, expect, it } from "vitest";
import {
  createLaunchConfigId,
  createPaneId,
  createSshCredentialId,
  createWorkspaceId,
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
});
