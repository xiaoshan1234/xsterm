import { describe, expect, it } from "vitest";
import {
  createApplicationError,
  isApplicationError,
  type ApplicationErrorCode,
} from "./applicationError";

describe("applicationError", () => {
  it("creates an Error with a stable application code", () => {
    const error = createApplicationError(
      "terminal-already-attached",
      "Terminal is already attached",
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ApplicationError");
    expect(error.code).toBe("terminal-already-attached");
    expect(error.message).toBe("Terminal is already attached");
  });

  it("preserves the underlying cause", () => {
    const cause = new Error("backend failure");
    const error = createApplicationError(
      "workspace-name-conflict",
      "Workspace name already exists",
      cause,
    );

    expect(error.cause).toBe(cause);
  });

  it("matches only application errors with the requested code", () => {
    const error = createApplicationError("workspace-name-reserved", "Reserved");

    expect(isApplicationError(error)).toBe(true);
    expect(isApplicationError(error, "workspace-name-reserved")).toBe(true);
    expect(isApplicationError(error, "workspace-name-conflict")).toBe(false);
    expect(isApplicationError(new Error("Reserved"))).toBe(false);
    expect(isApplicationError("workspace-name-reserved")).toBe(false);
  });

  it("accepts every declared application error code", () => {
    const codes: ApplicationErrorCode[] = [
      "terminal-already-attached",
      "workspace-name-conflict",
      "workspace-name-reserved",
    ];

    for (const code of codes) {
      expect(isApplicationError(createApplicationError(code, code), code)).toBe(true);
    }
  });
});
