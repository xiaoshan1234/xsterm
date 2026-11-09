import { readImage } from "@tauri-apps/plugin-clipboard-manager";

/**
 * Collects image files from clipboardData items and files list.
 */
function collectImagesFromClipboardData(
  items: DataTransferItemList | null | undefined,
  files: FileList | null | undefined,
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
  const imageItems = collectImagesFromClipboardData(e.clipboardData?.items, e.clipboardData?.files);

  if (imageItems.length > 0) {
    return imageItems;
  }

  // Fallback to Tauri readImage
  try {
    const img = await readImage();
    if (img) {
      const file = await encodeClipboardImage(img);
      return file ? [file] : [];
    }
  } catch (err) {
    console.error("[xsterm] Failed to read image from clipboard:", err);
  }

  return [];
}

/**
 * Tauri's clipboard `Image` exposes raw RGBA pixels, not an encoded PNG.
 * Encode through a canvas so the file uploaded to the SSH host is a valid PNG.
 */
async function encodeClipboardImage(
  image: Awaited<ReturnType<typeof readImage>>,
): Promise<File | null> {
  const size = await image.size();
  const rgba = await image.rgba();
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const pixels = new Uint8ClampedArray(rgba.length);
  pixels.set(rgba);
  context.putImageData(new ImageData(pixels, size.width, size.height), 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!blob) return null;

  return new File([blob], "paste_image.png", { type: "image/png" });
}
