import { useEffect, useMemo, useState } from "react";
import {
  chordFromKeyboardEvent,
  chordSignature,
  formatChord,
  isModifierKey,
} from "../../../shared/keyboard";
import { KEYBINDING_ACTIONS } from "../keybindings/keybindingDefaults";
import { findConflictingChords } from "../keybindings/keybindingResolution";
import type {
  KeybindingAction,
  KeybindingActionId,
  KeybindingContextName,
} from "../keybindings/keybindingContracts";
import { useSessionPreferences } from "../state/SessionPreferencesContext";
import "./KeybindingsPanel.css";

const CONTEXT_LABELS: Record<KeybindingContextName, string> = {
  app: "Application",
  terminal: "Terminal",
};

export function KeybindingsPanel() {
  const { keybindings, updateKeybinding, resetKeybinding, resetAllKeybindings } =
    useSessionPreferences();
  const [recordingActionId, setRecordingActionId] = useState<KeybindingActionId | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);

  const conflicts = useMemo(() => findConflictingChords(keybindings), [keybindings]);

  useEffect(() => {
    if (recordingActionId === null) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecordingActionId(null);
        return;
      }
      if (isModifierKey(event.key)) return;

      const chord = chordFromKeyboardEvent(event);
      const action = KEYBINDING_ACTIONS.find((candidate) => candidate.id === recordingActionId);
      if (!action) {
        setRecordingActionId(null);
        return;
      }

      const takenBy = keybindings.find((binding) => {
        if (binding.actionId === recordingActionId) return false;
        const otherAction = KEYBINDING_ACTIONS.find(
          (candidate) => candidate.id === binding.actionId,
        );
        if (!otherAction || otherAction.context !== action.context) return false;
        return binding.chords.some(
          (candidate) => chordSignature(candidate) === chordSignature(chord),
        );
      });
      if (takenBy) {
        const otherAction = KEYBINDING_ACTIONS.find(
          (candidate) => candidate.id === takenBy.actionId,
        );
        setRecordError(
          `${formatChord(chord)} is already used by "${otherAction?.label ?? takenBy.actionId}"`,
        );
        setRecordingActionId(null);
        return;
      }

      const current = keybindings.find((binding) => binding.actionId === recordingActionId);
      updateKeybinding(recordingActionId, {
        actionId: recordingActionId,
        chords: [chord],
        enabled: current?.enabled ?? true,
      });
      setRecordError(null);
      setRecordingActionId(null);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [keybindings, recordingActionId, updateKeybinding]);

  const startRecording = (actionId: KeybindingActionId) => {
    setRecordError(null);
    setRecordingActionId(actionId);
  };

  const toggleEnabled = (action: KeybindingAction) => {
    const binding = keybindings.find((candidate) => candidate.actionId === action.id);
    if (!binding) return;
    updateKeybinding(action.id, { ...binding, enabled: !binding.enabled });
  };

  const renderActionRow = (action: KeybindingAction) => {
    const binding = keybindings.find((candidate) => candidate.actionId === action.id);
    const chords = binding?.chords ?? [];
    const isRecording = recordingActionId === action.id;
    const isDisabled = binding?.enabled === false;

    const rowClassName = [
      "keybindings-panel__row",
      isRecording ? "keybindings-panel__row--recording" : "",
      isDisabled ? "keybindings-panel__row--disabled" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div className={rowClassName} key={action.id}>
        <div className="keybindings-panel__row-main">
          <span className="keybindings-panel__label">{action.label}</span>
          <span
            className={
              isRecording
                ? "keybindings-panel__chords keybindings-panel__chords--recording"
                : "keybindings-panel__chords"
            }
          >
            {isRecording
              ? "Press keys…"
              : chords.map((chord) => {
                  const signature = `${action.context}:${chordSignature(chord)}`;
                  const className = conflicts.has(signature)
                    ? "keybindings-panel__chord keybindings-panel__chord--conflict"
                    : "keybindings-panel__chord";
                  return (
                    <span className={className} key={signature}>
                      {formatChord(chord)}
                    </span>
                  );
                })}
          </span>
        </div>
        <div className="keybindings-panel__actions">
          <label className="checkbox-group">
            <input
              type="checkbox"
              checked={binding?.enabled ?? true}
              onChange={() => toggleEnabled(action)}
            />
            <span>Enabled</span>
          </label>
          <button
            type="button"
            className="btn btn--secondary keybindings-panel__button"
            onClick={() => startRecording(action.id)}
          >
            {isRecording ? "Recording…" : "Change"}
          </button>
          <button
            type="button"
            className="btn btn--secondary keybindings-panel__button"
            onClick={() => resetKeybinding(action.id)}
          >
            Reset
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="keybindings-panel">
      <div className="keybindings-panel__header">
        <h3 className="keybindings-panel__title">Keyboard shortcuts</h3>
        <button
          type="button"
          className="btn btn--secondary keybindings-panel__button"
          onClick={resetAllKeybindings}
        >
          Reset all
        </button>
      </div>
      {recordError && <div className="keybindings-panel__error">{recordError}</div>}
      {(["app", "terminal"] as const).map((context) => (
        <section className="keybindings-panel__section" key={context}>
          <h4 className="keybindings-panel__section-title">{CONTEXT_LABELS[context]}</h4>
          {KEYBINDING_ACTIONS.filter((action) => action.context === context).map(renderActionRow)}
        </section>
      ))}
    </div>
  );
}
