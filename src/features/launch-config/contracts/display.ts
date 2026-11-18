export interface TerminalDisplayConfig {
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
  lineNumberEnabled?: boolean;
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
  logging?: TerminalLoggingConfig;
  showSidebar?: boolean;
}

export interface TerminalLoggingConfig {
  enabled?: boolean;
  append?: boolean;
  fileNameTemplate?: string;
  maxSizeMb?: number;
  lineFormat?: string;
}
