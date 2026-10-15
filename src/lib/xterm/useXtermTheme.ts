import { useMemo } from "react";
import type { ITheme } from "@xterm/xterm";

import { XTERM_THEME } from "./theme";

export function useXtermTheme(): ITheme {
  return useMemo(() => XTERM_THEME, []);
}
