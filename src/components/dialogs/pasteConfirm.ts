import { convertLineEndings, convertTabs } from "../../utils/textTransform";

/**
 * Pure state + transformation logic for the paste-confirmation dialog.
 * Kept separate from the React component so the behavior can be unit-tested
 * without jsdom.
 */

export const DEFAULT_TAB_WIDTH = 4;

export interface PasteConfirmOptions {
  /** Replace each `\t` with this many spaces. 0 disables expansion. */
  convertTabs: boolean;
  spacesPerTab: number;
  /** Replace every CRLF / CR / LF with a single CR. */
  convertLineEndings: boolean;
}

export const DEFAULT_PASTE_OPTIONS: PasteConfirmOptions = {
  convertTabs: true,
  spacesPerTab: DEFAULT_TAB_WIDTH,
  convertLineEndings: true,
};

/**
 * Count the number of `\t` characters in `text`. Used by the dialog to show
 * "(N tabs found)" next to the checkbox so the user knows the conversion
 * has visible effect.
 */
export function countTabs(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\t") count++;
  }
  return count;
}

/**
 * Apply the user-selected transformations in a deterministic order:
 * tabs first (so a tab character that lands at the start of a "line" doesn't
 * survive into the line-ending pass), then line endings.
 *
 * Both transformations are pure functions and may be no-ops (see
 * `convertTabs` / `convertLineEndings` in textTransform.ts), so calling this
 * with every checkbox unchecked returns `text` unchanged.
 */
export function applyPasteTransforms(text: string, options: PasteConfirmOptions): string {
  let result = text;
  if (options.convertTabs && options.spacesPerTab > 0) {
    result = convertTabs(result, options.spacesPerTab);
  }
  if (options.convertLineEndings) {
    result = convertLineEndings(result);
  }
  return result;
}

/**
 * Merge a partial options patch into a previous state. Centralised here so
 * checkbox and number-input handlers stay one-liners in the component.
 */
export function patchPasteOptions(
  prev: PasteConfirmOptions,
  patch: Partial<PasteConfirmOptions>,
): PasteConfirmOptions {
  return { ...prev, ...patch };
}