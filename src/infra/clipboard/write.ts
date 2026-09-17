import { writeText } from "@tauri-apps/plugin-clipboard-manager";

/**
 * Write a plain-text string to the OS clipboard via the
 * `tauri-plugin-clipboard-manager`. Mirrors the inline
 * `writeText(...)` call previously made from
 * `src/hooks/useTauriTerminalOutput.ts` (the OSC52 branch).
 */
export async function writeClipboardText(text: string): Promise<void> {
  await writeText(text);
}
