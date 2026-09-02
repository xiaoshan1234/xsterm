/**
 * @vitest-environment jsdom
 *
 * Hook tests for `useTerminalResize` covering two gating rules:
 *   1. The ResizeObserver-driven fit+resize path is skipped while
 *      `sizingMode === "fixed"` (container resizes do not affect the
 *      terminal).
 *   2. A runtime-apply effect resizes xterm + the PTY whenever
 *      `sizingMode` / `cols` / `rows` change so EditSessionDialog can
 *      switch modes on a live session without a restart.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { useTerminalResize } from "./useTerminalResize";
import type { SessionDisplayConfig } from "../types/session";

const resizeSessionMock = vi.fn(async (_id: number, _rows: number, _cols: number) => {});
vi.mock("../contexts/SessionContext", () => ({
  useSession: () => ({ resizeSession: resizeSessionMock }),
}));

interface XTermStub {
  cols: number;
  rows: number;
  options: Record<string, unknown>;
  resize: ReturnType<typeof vi.fn>;
}

interface ExposedHarness {
  containerRef: RefObject<HTMLDivElement | null>;
  termRef: RefObject<XTerm | null>;
  fitAddonRef: RefObject<FitAddon | null>;
  resizeSessionCalls: Array<{ rows: number; cols: number }>;
  setDisplayConfig: (next: SessionDisplayConfig) => void;
  xterm: XTermStub;
  fitAddon: { fit: ReturnType<typeof vi.fn> };
}

const observers: Array<{ cb: ResizeObserverCallback }> = [];
class ResizeObserverMock {
  constructor(cb: ResizeObserverCallback) {
    observers.push({ cb });
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  resizeSessionMock.mockClear();
  observers.length = 0;
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
});
afterEach(() => {
  vi.useRealTimers();
});

function buildHarness(
  initial: SessionDisplayConfig,
  opts?: { isWindowActive?: boolean; containerHeight?: number },
) {
  const exposed: Partial<ExposedHarness> = { resizeSessionCalls: [] };

  function Host() {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const termRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const [displayConfig, setDisplayConfig] = useState<SessionDisplayConfig>(initial);

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      Object.defineProperty(el, "offsetWidth", { configurable: true, value: 800 });
      Object.defineProperty(el, "offsetHeight", {
        configurable: true,
        value: opts?.containerHeight ?? 600,
      });
    });

    useEffect(() => {
      const xterm: XTermStub = {
        cols: 80,
        rows: 24,
        options: {},
        resize: vi.fn((cols: number, rows: number) => {
          xterm.cols = cols;
          xterm.rows = rows;
        }),
      };
      const fitAddon: { fit: ReturnType<typeof vi.fn> } = {
        fit: vi.fn(() => {
          // Simulate a real FitAddon: derive cols/rows from container size.
          // 800px / 10px-per-col ≈ 80 cols; 600px / 25px-per-row ≈ 24 rows.
          xterm.cols = 80;
          xterm.rows = 24;
        }),
      };
      termRef.current = xterm as unknown as XTerm;
      fitAddonRef.current = fitAddon as unknown as FitAddon;

      exposed.termRef = termRef;
      exposed.fitAddonRef = fitAddonRef;
      exposed.containerRef = containerRef;
      exposed.xterm = xterm;
      exposed.fitAddon = fitAddon;
      exposed.setDisplayConfig = setDisplayConfig;
    }, []);

    useTerminalResize(
      containerRef,
      termRef,
      fitAddonRef,
      42,
      displayConfig,
      opts?.isWindowActive,
    );

    // Capture each resizeSession call onto exposed for richer assertions.
    useEffect(() => {
      resizeSessionMock.mockImplementation(async (_id, rows, cols) => {
        (exposed.resizeSessionCalls as Array<{ rows: number; cols: number }>).push({
          rows,
          cols,
        });
      });
    });

    return (
      <div
        ref={containerRef}
        data-testid="container"
        style={{ width: 800, height: opts?.containerHeight ?? 600 }}
      />
    );
  }

  return { Host, exposed: exposed as ExposedHarness };
}

describe("useTerminalResize", () => {
  it('auto mode: ResizeObserver fires → after 150ms debounce, fit + resizeSession(rows=24, cols=80) are called', async () => {
    vi.useFakeTimers();
    const { Host, exposed } = buildHarness({ sizingMode: "auto" });
    render(<Host />);

    expect(observers.length).toBeGreaterThan(0);

    await act(async () => {
      observers[0].cb([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
      vi.advanceTimersByTime(200);
    });

    expect(exposed.fitAddon.fit).toHaveBeenCalled();
    expect(exposed.resizeSessionCalls).toContainEqual({ rows: 24, cols: 80 });
  });

  it('fixed mode: ResizeObserver fires → after 150ms, NEITHER fit NOR resizeSession is called', async () => {
    vi.useFakeTimers();
    const { Host, exposed } = buildHarness({ sizingMode: "fixed", cols: 100, rows: 30 });
    render(<Host />);

    await act(async () => {
      observers[0].cb([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
      vi.advanceTimersByTime(200);
    });

    expect(exposed.fitAddon.fit).not.toHaveBeenCalled();
    expect(exposed.resizeSessionCalls).toEqual([]);
  });

  it('sizingMode "auto" → "fixed" with cols=100/rows=30 → xterm.resize(100,30) + resizeSession(rows=30, cols=100)', async () => {
    const { Host, exposed } = buildHarness({ sizingMode: "auto" });
    render(<Host />);

    await act(async () => {
      exposed.setDisplayConfig({ sizingMode: "fixed", cols: 100, rows: 30 });
    });

    expect(exposed.xterm.resize).toHaveBeenCalledWith(100, 30);
    expect(exposed.resizeSessionCalls).toContainEqual({ rows: 30, cols: 100 });
  });

  it('sizingMode "fixed" → "auto" → fit + resizeSession(current xterm dims: rows=24, cols=80)', async () => {
    const { Host, exposed } = buildHarness({ sizingMode: "fixed", cols: 100, rows: 30 });
    render(<Host />);

    await act(async () => {
      exposed.setDisplayConfig({ sizingMode: "auto" });
    });

    expect(exposed.fitAddon.fit).toHaveBeenCalled();
    expect(exposed.resizeSessionCalls).toContainEqual({ rows: 24, cols: 80 });
  });

  it('skip when isWindowActive === false', () => {
    const { Host, exposed } = buildHarness({ sizingMode: "auto" }, { isWindowActive: false });
    render(<Host />);

    expect(exposed.resizeSessionCalls).toEqual([]);
  });

  it('skip when container.offsetHeight === 0', () => {
    const { Host, exposed } = buildHarness({ sizingMode: "auto" }, { containerHeight: 0 });
    render(<Host />);

    expect(exposed.resizeSessionCalls).toEqual([]);
  });
});
