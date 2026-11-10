export type TextSenderMode = "line" | "character";

export interface TextSenderTab {
  id: string;
  title: string;
  text: string;
}

export const MIN_SENDER_RATE = 1;
export const MAX_SENDER_RATE = 1000;

export const DEFAULT_SENDER_RATES: Record<TextSenderMode, number> = {
  line: 5,
  character: 50,
};

export function createTextSenderTab(tabNumber: number): TextSenderTab {
  return {
    id: `sender-tab-${tabNumber}`,
    title: `Tab ${tabNumber}`,
    text: "",
  };
}

export function splitTextForSender(text: string, mode: TextSenderMode): string[] {
  if (text.length === 0) return [];

  if (mode === "character") {
    return Array.from(text);
  }

  const inputLines = text.replace(/\r\n?/g, "\n").split("\n");
  if (inputLines[inputLines.length - 1] === "") {
    inputLines.pop();
  }
  return inputLines.map((line) => `${line}\n`);
}

export function normalizeSenderRate(rate: number): number {
  if (!Number.isFinite(rate)) return MIN_SENDER_RATE;
  return Math.min(MAX_SENDER_RATE, Math.max(MIN_SENDER_RATE, rate));
}

export function getSenderIntervalMs(rate: number): number {
  return Math.round(1000 / normalizeSenderRate(rate));
}

export function getSenderUnitLabel(mode: TextSenderMode, count: number): string {
  const label = mode === "line" ? "line" : "character";
  return count === 1 ? label : `${label}s`;
}
