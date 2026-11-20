export interface KeyChord {
  /** DOM `KeyboardEvent.code` value: the physical key, independent of layout. */
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

const MODIFIER_KEYS = new Set(["Alt", "AltGraph", "CapsLock", "Control", "Meta", "Shift"]);

export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key);
}

export function chordFromKeyboardEvent(event: KeyboardEvent): KeyChord {
  return {
    code: event.code || normalizeKeyCode(event.key),
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
  };
}

export function matchesChord(candidate: KeyChord, chord: KeyChord): boolean {
  return (
    candidate.code === chord.code &&
    candidate.ctrl === chord.ctrl &&
    candidate.shift === chord.shift &&
    candidate.alt === chord.alt &&
    candidate.meta === chord.meta
  );
}

/** Stable identity for a chord, used for conflict detection and de-duplication. */
export function chordSignature(chord: KeyChord): string {
  return JSON.stringify([chord.code, chord.ctrl, chord.shift, chord.alt, chord.meta]);
}

export function formatChord(chord: KeyChord): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push("Ctrl");
  if (chord.shift) parts.push("Shift");
  if (chord.alt) parts.push("Alt");
  if (chord.meta) parts.push("Meta");
  parts.push(codeToLabel(chord.code));
  return parts.join("+");
}

export function codeToLabel(code: string): string {
  if (code.startsWith("Key") && code.length === 4) {
    return code.slice(3);
  }
  if (code.startsWith("Digit") && code.length === 6) {
    return code.slice(5);
  }

  const labels: Record<string, string> = {
    Space: "Space",
    Enter: "Enter",
    Tab: "Tab",
    Escape: "Esc",
    Backspace: "Backspace",
    Insert: "Insert",
    Delete: "Del",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Backslash: "\\",
    Slash: "/",
    Comma: ",",
    Period: ".",
    Semicolon: ";",
    Quote: "'",
    BracketLeft: "[",
    BracketRight: "]",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
  };
  return labels[code] ?? code;
}

function normalizeKeyCode(key: string): string {
  if (/^[a-zA-Z]$/.test(key)) {
    return `Key${key.toUpperCase()}`;
  }
  if (/^[0-9]$/.test(key)) {
    return `Digit${key}`;
  }
  if (key === " ") {
    return "Space";
  }
  const aliases: Record<string, string> = {
    Esc: "Escape",
    Del: "Delete",
  };
  return aliases[key] ?? key;
}
