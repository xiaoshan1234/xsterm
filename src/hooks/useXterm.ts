import { useEffect, useRef, RefObject } from "react";
import { Terminal as XTerm, ITerminalOptions } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { TerminalTheme } from "../types/theme";

export function themeToXtermTheme(theme: TerminalTheme) {
  return {
    foreground: theme.foreground,
    background: theme.background,
    cursor: theme.cursor,
    black: theme.black,
    red: theme.red,
    green: theme.green,
    yellow: theme.yellow,
    blue: theme.blue,
    magenta: theme.magenta,
    cyan: theme.cyan,
    white: theme.white,
    brightBlack: theme.brightBlack,
    brightRed: theme.brightRed,
    brightGreen: theme.brightGreen,
    brightYellow: theme.brightYellow,
    brightBlue: theme.brightBlue,
    brightMagenta: theme.brightMagenta,
    brightCyan: theme.brightCyan,
    brightWhite: theme.brightWhite,
  };
}

export interface UseXtermResult {
  termRef: RefObject<XTerm | null>;
  fitAddonRef: RefObject<FitAddon | null>;
}

export function useXterm(
  containerRef: RefObject<HTMLDivElement | null>,
  theme: TerminalTheme,
  options: ITerminalOptions
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

  useEffect(() => {
    const xterm = termRef.current;
    if (!xterm) return;
    xterm.options.theme = themeToXtermTheme(theme);
  }, [theme]);

  return { termRef, fitAddonRef };
}
