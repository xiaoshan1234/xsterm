import { useEffect, useRef, useState } from "react";
import { Dialog } from "../ui/Dialog";
import {
  applyPasteTransforms,
  countTabs,
  DEFAULT_PASTE_OPTIONS,
  patchPasteOptions,
  type PasteConfirmOptions,
} from "./pasteConfirm";
import { countChars, countLines } from "../../utils/textTransform";
import "./PasteConfirmDialog.css";

interface PasteConfirmDialogProps {
  isOpen: boolean;
  /** The raw text the user pasted, before any transformations. */
  text: string;
  onConfirm: (transformedText: string) => void;
  onCancel: () => void;
}

/**
 * Modal that gates large pastes behind a confirmation step.
 *
 * Shown whenever the pasted text has more than 2 lines (see Terminal.tsx).
 * Lets the user:
 *  - See how big the paste actually is (chars / lines / tabs).
 *  - Expand tabs to N spaces (default 4).
 *  - Collapse CRLF/LF/CR to a single CR (default on).
 *
 * Keyboard: Enter = confirm, Esc = cancel. The base Dialog handles Esc via
 * its close button; we wire Enter to confirm in a window keydown listener
 * scoped to when the dialog is open.
 */
export function PasteConfirmDialog({ isOpen, text, onConfirm, onCancel }: PasteConfirmDialogProps) {
  const [options, setOptions] = useState<PasteConfirmOptions>(DEFAULT_PASTE_OPTIONS);
  const lastIsOpenRef = useRef(isOpen);

  // Reset to defaults every time the dialog re-opens with fresh content.
  // Reading `text.length` as the dependency is enough — opening with the
  // same text after a cancel does not need to reset, but opening with a
  // different paste always should.
  useEffect(() => {
    if (isOpen && !lastIsOpenRef.current) {
      setOptions(DEFAULT_PASTE_OPTIONS);
    }
    lastIsOpenRef.current = isOpen;
  }, [isOpen, text.length]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onConfirm(applyPasteTransforms(text, options));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, text, options, onConfirm]);

  const chars = countChars(text);
  const lines = countLines(text);
  const tabs = countTabs(text);
  const lineLabel = lines.length === 1 ? "1 line" : `${lines.length} lines`;
  const charLabel = chars === 1 ? "1 char" : `${chars} chars`;

  const handleConfirm = () => {
    onConfirm(applyPasteTransforms(text, options));
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onCancel}
      title="Confirm Paste"
      size="small"
      footer={
        <div className="dialog-footer-content">
          <span className="paste-dialog-stats">
            {charLabel} · {lineLabel}
          </span>
          <div className="dialog-footer-buttons">
            <button className="btn btn--secondary" onClick={onCancel}>
              Cancel
            </button>
            <button className="btn btn--primary" onClick={handleConfirm} autoFocus>
              Paste
            </button>
          </div>
        </div>
      }
    >
      <div className="paste-dialog-options">
        <label className="checkbox-group paste-dialog-option">
          <input
            type="checkbox"
            checked={options.convertTabs}
            onChange={(e) => setOptions((prev) => patchPasteOptions(prev, { convertTabs: e.target.checked }))}
          />
          <span>Convert tabs to spaces</span>
          <input
            type="number"
            min={0}
            max={16}
            step={1}
            className="paste-dialog-number"
            value={options.spacesPerTab}
            disabled={!options.convertTabs}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              setOptions((prev) =>
                patchPasteOptions(prev, { spacesPerTab: Number.isNaN(v) ? 0 : v }),
              );
            }}
            aria-label="Spaces per tab"
          />
          <span className="paste-dialog-meta">{tabs === 1 ? "(1 tab)" : `(${tabs} tabs)`}</span>
        </label>

        <label className="checkbox-group paste-dialog-option">
          <input
            type="checkbox"
            checked={options.convertLineEndings}
            onChange={(e) =>
              setOptions((prev) =>
                patchPasteOptions(prev, { convertLineEndings: e.target.checked }),
              )
            }
          />
          <span>Convert CRLF and LF to CR</span>
        </label>
      </div>
    </Dialog>
  );
}