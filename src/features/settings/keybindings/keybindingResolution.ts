import { chordSignature, formatChord, matchesChord } from "../../../shared/keyboard";
import type { KeyChord } from "../../../shared/keyboard";
import { KEYBINDING_ACTIONS } from "./keybindingDefaults";
import type {
  KeybindingAction,
  KeybindingActionId,
  KeybindingContextName,
  KeybindingEntry,
} from "./keybindingContracts";

export function resolveKeybindings(overrides: readonly KeybindingEntry[]): KeybindingEntry[] {
  const overrideByAction = new Map(overrides.map((entry) => [entry.actionId, entry]));
  return KEYBINDING_ACTIONS.map((action) => {
    const override = overrideByAction.get(action.id);
    return override ? normalizeEntry(override, action) : entryFromAction(action);
  });
}

export function findMatchingKeybinding(
  bindings: readonly KeybindingEntry[],
  chord: KeyChord,
  context: KeybindingContextName,
): KeybindingEntry | undefined {
  return bindings.find((binding) => {
    const action = actionForId(binding.actionId);
    if (!action || action.context !== context || !binding.enabled) {
      return false;
    }
    return binding.chords.some((candidate) => matchesChord(candidate, chord));
  });
}

export function findConflictingChords(bindings: readonly KeybindingEntry[]): Set<string> {
  const seen = new Map<string, KeybindingActionId>();
  const conflicts = new Set<string>();
  for (const entry of bindings) {
    const action = actionForId(entry.actionId);
    if (!action) continue;
    for (const chord of entry.chords) {
      const signature = `${action.context}:${chordSignature(chord)}`;
      if (seen.has(signature)) {
        conflicts.add(signature);
      } else {
        seen.set(signature, entry.actionId);
      }
    }
  }
  return conflicts;
}

export function validateKeybindingOverrides(overrides: readonly KeybindingEntry[]): string[] {
  const messages: string[] = [];
  const seen = new Map<string, KeybindingActionId>();
  for (const entry of overrides) {
    const action = actionForId(entry.actionId);
    if (!action) {
      messages.push(`Unknown action: ${entry.actionId}`);
      continue;
    }
    if (entry.chords.length === 0) {
      messages.push(`"${action.label}" must have at least one shortcut`);
      continue;
    }
    for (const chord of entry.chords) {
      const signature = `${action.context}:${chordSignature(chord)}`;
      const existing = seen.get(signature);
      if (existing && existing !== entry.actionId) {
        const existingAction = actionForId(existing);
        messages.push(
          `"${existingAction?.label ?? existing}" and "${action.label}" both use ${formatChord(chord)}`,
        );
      } else {
        seen.set(signature, entry.actionId);
      }
    }
  }
  return messages;
}

export function sanitizeKeybindingOverrides(
  overrides: readonly KeybindingEntry[],
): KeybindingEntry[] {
  const sanitized: KeybindingEntry[] = [];
  const seenActions = new Set<KeybindingActionId>();
  for (const entry of overrides) {
    if (!actionForId(entry.actionId) || seenActions.has(entry.actionId)) {
      continue;
    }
    seenActions.add(entry.actionId);
    const chords = (entry.chords ?? [])
      .map(normalizeChord)
      .filter((chord) => chord.code.length > 0);
    if (chords.length === 0) {
      continue;
    }
    sanitized.push({ actionId: entry.actionId, chords, enabled: entry.enabled !== false });
  }
  return sanitized;
}

export function actionForId(actionId: KeybindingActionId): KeybindingAction | undefined {
  return KEYBINDING_ACTIONS.find((action) => action.id === actionId);
}

function entryFromAction(action: KeybindingAction): KeybindingEntry {
  return { actionId: action.id, chords: [...action.defaultChords], enabled: true };
}

function normalizeEntry(entry: KeybindingEntry, action: KeybindingAction): KeybindingEntry {
  const chords =
    entry.chords.length > 0 ? entry.chords.map(normalizeChord) : [...action.defaultChords];
  return { actionId: action.id, chords, enabled: entry.enabled };
}

function normalizeChord(chord: KeyChord): KeyChord {
  return {
    code: chord.code,
    ctrl: chord.ctrl === true,
    shift: chord.shift === true,
    alt: chord.alt === true,
    meta: chord.meta === true,
  };
}
