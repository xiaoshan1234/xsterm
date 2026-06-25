import { readImage } from "@tauri-apps/plugin-clipboard-manager";

/**
 * Collects image files from clipboardData items and files list.
 */
function collectImagesFromClipboardData(
  items: DataTransferItemList | null | undefined,
  files: FileList | null | undefined
): File[] {
  const result: File[] = [];

  if (items) {
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) result.push(file);
      }
    }
  }

  if (result.length === 0 && files) {
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        result.push(file);
      }
    }
  }

  return result;
}

/**
 * Reads image files from a clipboard event.
 * First tries the browser's clipboardData API, then falls back to Tauri.
 * Returns an empty array if no images are found.
 */
export async function getClipboardImages(e: ClipboardEvent): Promise<File[]> {
  const imageItems = collectImagesFromClipboardData(
    e.clipboardData?.items,
    e.clipboardData?.files
  );

  if (imageItems.length > 0) {
    return imageItems;
  }

  // Fallback to Tauri readImage
  try {
    const img = await readImage();
    if (img) {
      const blob = new Blob([await img.rgba()], { type: "image/png" });
      return [new File([blob], "paste_image.png", { type: "image/png" })];
    }
  } catch (err) {
    console.error("[xsterm] Failed to read image from clipboard:", err);
  }

  return [];
}