/**
 * Shared parsers / narrowers used across the dialog forms.
 */

/**
 * Parse a string input into an integer, treating blank input as `undefined`.
 * Used by every form that exposes an optional numeric input (port, delay, etc).
 */
export function parseOptionalInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse a string input into a float, treating blank input as `undefined`.
 * Used by numeric fields that accept decimal values (line height, letter spacing).
 */
export function parseOptionalFloat(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = parseFloat(trimmed);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Narrow an HTML `<select>` value (which the DOM types as `string`) to one of
 * the literal values declared in an `as const` option list. Falls back to the
 * first option so the controlled-component contract is always honoured.
 */
export function narrowToLiteral<T extends string>(
  value: string,
  options: ReadonlyArray<{ value: T }>,
): T {
  return options.some((o) => o.value === (value as T)) ? (value as T) : options[0].value;
}
