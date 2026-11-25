import type { TerminalLoggingConfig, TerminalProperties } from "../../../models";

/**
 * Creation-time launch template. `logging` is consumed while creating the
 * session; the remaining fields become the new terminal's initial properties.
 */
export interface TerminalDisplayConfig extends TerminalProperties {
  logging?: TerminalLoggingConfig;
}

export type { TerminalLoggingConfig };
