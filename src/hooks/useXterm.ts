import { useEffect, useRef, type RefObject } from "react";
import { Terminal as XTerm, type ITerminalOptions } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { type TerminalTheme } from "../types/theme";

export function themeToXtermTheme(theme: TerminalTheme) {
  // background is intentionally omitted so empty cells stay transparent;
  // the actual terminal surface color comes from .xterm-viewport's CSS
  // background (var(--canvas)), keeping it in lock-step with the line-
  // number gutter. Requires DEFAULT_XTERM_OPTIONS.allowTransparency = true.
  // ANSI escapes that set a per-cell background still render via the
  // theme's color slots (red, blue, etc.).
  const { background: _unused, ...rest } = theme;
  void _unused;
  return {
    ...rest,
    foreground: theme.foreground,
    cursor: theme.cursor,
  };
}

export interface UseXtermResult {
  termRef: RefObject<XTerm | null>;
  fitAddonRef: RefObject<FitAddon | null>;
}

// Keys we forward to xterm.options.set(); theme is handled separately.
// xterm-unsupported fields (lineTimestamp, reverseVideo, mouseWheelScrollLines,
// fitOnResize, syncRemoteTitle, backspaceSends, deleteSends, lineFeedMode,
// cursorKeyMode, keypadMode, modifyOtherKeysFormat, altSendsEscape,
// wordSeparatorChars, altScreenWordSeparatorChars, clipboardRead, clipboardWrite,
// logging) are intentionally kept in config but NOT applied (avoid xterm throw).
const SETTABLE_KEYS = [
  "fontSize",
  "fontFamily",
  "cursorBlink",
  "cursorStyle",
  "cursorWidth",
  "scrollback",
  "lineHeight",
  "letterSpacing",
  "autoWrap",
] as const;

// Map spec field names to xterm.js option names where they differ.
const XTERM_OPTION_MAP: Record<string, string> = {
  autoWrap: "convertEol",
};

export function useXterm(
  containerRef: RefObject<HTMLDivElement | null>,
  theme: TerminalTheme,
  options: ITerminalOptions,
): UseXtermResult {
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const optionsRef = useRef(options);
  const themeRef = useRef(theme);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  // Create the xterm instance on the DOM element pointed to by `containerRef`.
  // Each Terminal component owns its own xterm instance, exposed via refs to
  // callers. FitAddon is loaded alongside xterm so the terminal auto-resizes
  // to the container. `dispose()` is called on unmount and refs are reset to
  // null to avoid leaking the terminal across re-mounts.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const xterm = new XTerm({
      ...optionsRef.current,
      theme: themeToXtermTheme(themeRef.current),
    });
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);

    xterm.open(container);

    termRef.current = xterm;
    fitAddonRef.current = fitAddon;

    return () => {
      xterm.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [containerRef]);

  // Sync the xterm instance's theme configuration when the theme prop changes.
  useEffect(() => {
    const xterm = termRef.current;
    if (!xterm) return;
    xterm.options.theme = themeToXtermTheme(theme);
  }, [theme]);

  // Sync the xterm instance's hot-reloadable display options when any of the
  // settable option keys change.
  useEffect(() => {
    const xterm = termRef.current;
    if (!xterm) return;
    for (const key of SETTABLE_KEYS) {
      const value = (options as Record<string, unknown>)[key];
      if (value !== undefined) {
        const xtermKey = XTERM_OPTION_MAP[key] ?? key;
        (xterm.options as Record<string, unknown>)[xtermKey] = value;
      }
    }
    xterm.refresh(0, xterm.rows - 1);
  }, [
    options.fontSize,
    options.fontFamily,
    options.cursorBlink,
    options.cursorStyle,
    options.cursorWidth,
    options.scrollback,
    options.lineHeight,
    options.letterSpacing,
    // autoWrap is not part of xterm.js ITerminalOptions (it maps to
    // `convertEol`), so we read it off the options bag as an untyped key to
    // include it in the dependency list.
    (options as Record<string, unknown>).autoWrap,
  ]);

  return { termRef, fitAddonRef };
}
