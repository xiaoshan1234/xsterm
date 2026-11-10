/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTextSenderRun } from "./useTextSenderRun";

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("useTextSenderRun", () => {
  it("pauses between breakpoints and cancels pending chunks", async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const { result, unmount } = renderHook(() =>
      useTextSenderRun(async (text) => {
        writes.push(text);
      }),
    );

    act(() => result.current.start(["a", "b", "c"], 1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(writes).toEqual(["a"]);

    act(() => result.current.pause());
    expect(result.current.status).toBe("paused");
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(writes).toEqual(["a"]);

    act(() => result.current.resume());
    await act(async () => {
      await Promise.resolve();
    });
    expect(writes).toEqual(["a", "b"]);

    act(() => result.current.cancel());
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(result.current.status).toBe("cancelled");
    expect(writes).toEqual(["a", "b"]);

    unmount();
  });
});
