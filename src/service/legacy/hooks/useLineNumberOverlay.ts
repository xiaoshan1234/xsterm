import { useEffect, type RefObject } from "react";
import { type Terminal as XTerm } from "@xterm/xterm";

/**
 * Line-number gutter, rendered as a plain overlay `<div>` that is a *sibling*
 * of xterm's mount node.
 *
 * xterm 6.x's Decoration API (`registerMarker` + `registerDecoration`) does not
 * place decoration elements per row in this app: every decoration collapses to
 * the bottom of the viewport regardless of container positioning, so only the
 * last few numbers were ever visible. Instead of fighting the API we read the
 * buffer directly and paint the gutter ourselves:
 *
 *   - the overlay box is aligned with `.xterm-screen` (the visible rows area),
 *   - one `<span>` per visible row, positioned at `row * cellHeight`,
 *   - the label is the absolute buffer line (`viewportY + row + 1`, 1-indexed),
 *   - the gutter is hidden entirely while the alternate screen buffer is active
 *     (vim / htop / less own the full screen there).
 *
 * The overlay is purely visual: it never modifies terminal output, and
 * `pointer-events: none` (see Terminal.css) keeps input/selection untouched.
 */

type ActiveBuffer = XTerm["buffer"]["active"];

const ROW_CLASS = "line-number-overlay-row";
/** xterm's own default when `lineHeight` is not configured. */
const DEFAULT_LINE_HEIGHT = 1.0;
/** xterm's own default when `fontSize` is not configured. */
const DEFAULT_FONT_SIZE = 15;

interface UseLineNumberOverlayOptions {
  /** xterm instance owner (created by `useXterm`). */
  termRef: RefObject<XTerm | null>;
  /** Positioned ancestor that holds both the xterm mount node and the overlay. */
  hostRef: RefObject<HTMLDivElement | null>;
  /** The overlay element itself. */
  overlayRef: RefObject<HTMLDivElement | null>;
  /** Re-initialises the overlay when the pane is bound to another session. */
  sessionId: number;
  /** Show or hide the line number gutter. @default true */
  enabled?: boolean;
}

/**
 * Height of one terminal row in CSS pixels. `.xterm-screen` is sized by xterm to
 * exactly `rows * cellHeight`, which already accounts for `lineHeight`,
 * device-pixel rounding and font metrics — far more reliable than recomputing
 * it from options. Options are only the fallback for the first paint, before
 * xterm has sized the screen element.
 */
function paintNormalRows(
  overlay: HTMLDivElement,
  screenRect: DOMRect,
  viewportY: number,
  cellHeight: number,
  lastRow: number,
): void {
  const fragment = document.createDocumentFragment();
  for (let row = 0; row <= lastRow; row++) {
    const rowTop = row * cellHeight;
    // Never let a half-clipped number hang out of the viewport.
    if (rowTop + cellHeight > screenRect.height + 1) break;
    const span = document.createElement("span");
    span.className = ROW_CLASS;
    span.style.top = `${rowTop}px`;
    span.style.height = `${cellHeight}px`;
    span.textContent = String(viewportY + row + 1);
    fragment.appendChild(span);
  }
  overlay.replaceChildren(fragment);
}

/**
 * Height of one terminal row in CSS pixels. `.xterm-screen` is sized by xterm to
 * exactly `rows * cellHeight`, which already accounts for `lineHeight`,
 * device-pixel rounding and font metrics — far more reliable than recomputing
 * it from options. Options are only the fallback for the first paint, before
 * xterm has sized the screen element.
 */
function measureCellHeight(term: XTerm, screenEl: HTMLElement): number {
  const screenHeight = screenEl.getBoundingClientRect().height;
  if (screenHeight > 0 && term.rows > 0) {
    return screenHeight / term.rows;
  }
  const fontSize = term.options.fontSize ?? DEFAULT_FONT_SIZE;
  const lineHeight = term.options.lineHeight ?? DEFAULT_LINE_HEIGHT;
  return fontSize * lineHeight;
}

/**
 * Index (relative to the top of the viewport) of the last row that deserves a
 * line number, or -1 when the viewport carries nothing at all.
 *
 * Rows past the end of the content are left blank so a freshly opened shell
 * shows a single "1" instead of numbering every empty row down to the bottom.
 * The cursor row always counts, otherwise the line being typed on would lose
 * its number as soon as it is empty.
 */
function findLastNumberedRow(buffer: ActiveBuffer, viewportY: number, rows: number): number {
  const cursorRow = buffer.baseY + buffer.cursorY - viewportY;
  let last = cursorRow >= 0 && cursorRow < rows ? cursorRow : -1;
  for (let row = rows - 1; row > last; row--) {
    const line = buffer.getLine(viewportY + row);
    if (line && line.translateToString(true).length > 0) {
      last = row;
      break;
    }
  }
  return last;
}

export function useLineNumberOverlay({
  termRef,
  hostRef,
  overlayRef,
  sessionId,
  enabled = true,
}: UseLineNumberOverlayOptions): void {
  useEffect(() => {
    if (enabled === false) {
      const overlay = overlayRef.current;
      if (overlay) {
        overlay.replaceChildren();
        overlay.style.display = "none";
      }
      return;
    }

    const term = termRef.current;
    if (!term) return;

    let rafId: number | null = null;
    // Signature of the last painted state. onRender fires on every frame of
    // heavy output, and rebuilding ~40 spans per frame is pure waste when the
    // viewport, geometry and last numbered row are unchanged.
    let lastSignature = "";

    const hideOverlay = (overlay: HTMLDivElement) => {
      if (lastSignature === "hidden") return;
      lastSignature = "hidden";
      overlay.replaceChildren();
      overlay.style.display = "none";
    };

    const paint = () => {
      const host = hostRef.current;
      const overlay = overlayRef.current;
      if (!host || !overlay) return;

      const termEl = term.element;
      const screenEl = termEl?.querySelector<HTMLElement>(".xterm-screen") ?? null;
      if (!screenEl) return;

      const buffer = term.buffer.active;
      if (buffer.type === "alternate") {
        hideOverlay(overlay);
        return;
      }

      const rows = term.rows;
      const viewportY = buffer.viewportY;
      const lastRow = findLastNumberedRow(buffer, viewportY, rows);
      if (lastRow < 0) {
        hideOverlay(overlay);
        return;
      }

      const screenRect = screenEl.getBoundingClientRect();
      const cellHeight = measureCellHeight(term, screenEl);

      const signature = `${viewportY}|${lastRow}|${rows}|${cellHeight}|${screenRect.height}`;
      if (signature === lastSignature) return;
      lastSignature = signature;

      overlay.style.display = "block";

      paintNormalRows(overlay, screenRect, viewportY, cellHeight, lastRow);
    };

    const schedule = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        paint();
      });
    };

    const disposables = [term.onRender(schedule), term.onScroll(schedule), term.onResize(schedule)];

    // Scrolling the scrollback moves `viewportY` without necessarily emitting
    // onScroll for wheel-driven viewport scrolls, so listen on the DOM too.
    const viewportEl = term.element?.querySelector<HTMLElement>(".xterm-viewport") ?? null;
    viewportEl?.addEventListener("scroll", schedule, { passive: true });

    // Pane resize changes both the row count and the overlay's origin.
    const host = hostRef.current;
    const resizeObserver = new ResizeObserver(schedule);
    if (host) resizeObserver.observe(host);

    schedule();

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      for (const disposable of disposables) disposable.dispose();
      viewportEl?.removeEventListener("scroll", schedule);
      resizeObserver.disconnect();
      const overlay = overlayRef.current;
      if (overlay) {
        overlay.replaceChildren();
        overlay.style.display = "none";
      }
    };
  }, [termRef, hostRef, overlayRef, sessionId, enabled]);
}
