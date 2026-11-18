import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getClipboardImages } from "../infrastructure/clipboardGateway";

export const terminalClipboard = {
  readText,
  writeText,
  readImages: getClipboardImages,
};
