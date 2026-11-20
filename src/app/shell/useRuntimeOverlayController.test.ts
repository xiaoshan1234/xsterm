/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApplicationPersistenceSaveError } from "../application/runtime/types";
import { useRuntimeOverlayController } from "./useRuntimeOverlayController";

function renderController(saveError: ApplicationPersistenceSaveError | null = null) {
  const clearSaveError = vi.fn();
  return {
    clearSaveError,
    ...renderHook(() =>
      useRuntimeOverlayController({
        saveError,
        clearSaveError,
      }),
    ),
  };
}

describe("useRuntimeOverlayController", () => {
  it("converts thrown causes into error dialog data", () => {
    const { result } = renderController();
    const cause = new Error("backend failed");

    act(() => result.current.showError("Operation failed", cause));

    expect(result.current.error).toEqual({
      title: "Operation failed",
      message: "backend failed",
      details: cause.stack,
    });
  });

  it("surfaces persistence save errors once and dismisses the source", () => {
    const { result, clearSaveError } = renderController({
      source: "workspace",
      operation: "save workspace snapshots",
      message: "disk full",
    });

    expect(result.current.error).toMatchObject({
      title: "Unable to save workspace configuration",
      message: "disk full",
    });
    expect(clearSaveError).toHaveBeenCalledTimes(1);
  });

  it("does not replace an error that is already visible", () => {
    const clearSaveError = vi.fn();
    const props = {
      saveError: null as ApplicationPersistenceSaveError | null,
      clearSaveError,
    };
    const { result, rerender } = renderHook(
      (options: typeof props) => useRuntimeOverlayController(options),
      { initialProps: props },
    );

    act(() => result.current.showError("First error", new Error("first")));
    rerender({
      ...props,
      saveError: {
        source: "settings",
        operation: "save terminal preferences",
        message: "second",
      },
    });

    expect(result.current.error?.title).toBe("First error");
    expect(clearSaveError).not.toHaveBeenCalled();

    act(() => result.current.acknowledgeError());
    expect(result.current.error?.title).toBe("Unable to save terminal preferences");
    expect(clearSaveError).toHaveBeenCalledTimes(1);
  });
});
