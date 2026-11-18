import { getClipboardImages, readText, writeText } from "../infrastructure/clipboardGateway";

export const terminalClipboard = {
  readText,
  writeText,
  readImages: getClipboardImages,
};
