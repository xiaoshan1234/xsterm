/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useRuntimeShellUiState } from "./useRuntimeShellUiState";

describe("useRuntimeShellUiState", () => {
  it("selects the first pane target and clears stale selections", () => {
    const { result, rerender } = renderHook(
      ({ keys }: { keys: string[] }) => useRuntimeShellUiState(keys),
      { initialProps: { keys: ["pane-1", "pane-2"] } },
    );

    expect(result.current.selectedTargetKey).toBe("pane-1");

    act(() => result.current.setSelectedTargetKey("pane-2"));
    rerender({ keys: ["pane-1"] });
    expect(result.current.selectedTargetKey).toBe("pane-1");

    rerender({ keys: [] });
    expect(result.current.selectedTargetKey).toBe("");
  });

  it("toggles tools and the text sender without coupling them", () => {
    const { result } = renderHook(() => useRuntimeShellUiState([]));

    act(() => result.current.toggleTool("terminal-manager"));
    expect(result.current.activeTool).toBe("terminal-manager");
    expect(result.current.isTextSenderOpen).toBe(false);

    act(() => result.current.toggleTextSender());
    expect(result.current.isTextSenderOpen).toBe(true);
    expect(result.current.activeTool).toBe("terminal-manager");

    act(() => result.current.toggleTool("terminal-manager"));
    expect(result.current.activeTool).toBeNull();
  });
});
