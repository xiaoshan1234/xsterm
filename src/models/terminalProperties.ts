/**
 * Display and interaction settings owned by one running terminal.
 *
 * Launch configurations may use these values as creation-time defaults, but a
 * created terminal always receives its own copy and can be edited independently.
 */
export interface TerminalProperties {
  fontSize?: number;
  fontFamily?: string;
  cursorStyle?: "block" | "underline" | "bar";
  cursorBlink?: boolean;
  scrollback?: number;
  lineHeight?: number;
  letterSpacing?: number;
  cursorWidth?: number;
  lineTimestamp?: boolean;
  timeFormat?: string;
  dateTimeFormat?: string;
  gutterEnabled?: boolean;
  autoWrap?: boolean;
  reverseVideo?: boolean;
  mouseWheelScrollLines?: number;
  syncRemoteTitle?: boolean;
  sizingMode?: "auto" | "fixed";
  cols?: number;
  rows?: number;
  backspaceSends?: "auto" | "backspace" | "delete";
  deleteSends?: "auto" | "backspace" | "delete";
  lineFeedMode?: boolean;
  cursorKeyMode?: "normal" | "application";
  keypadMode?: "normal" | "application";
  modifyOtherKeysFormat?: "xterm" | "fixterm";
  altSendsEscape?: boolean;
  wordSeparatorChars?: string;
  altScreenWordSeparatorChars?: string;
  clipboardRead?: "ask" | "allow" | "deny";
  clipboardWrite?: "ask" | "allow" | "deny";
  showSidebar?: boolean;
}

/** Logging is configured when a terminal session is created. */
export interface TerminalLoggingConfig {
  enabled?: boolean;
  append?: boolean;
  fileNameTemplate?: string;
  maxSizeMb?: number;
  lineFormat?: string;
}
