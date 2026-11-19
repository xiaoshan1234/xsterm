import { getCurrentWindow } from "@tauri-apps/api/window";

export async function isMainWindowMaximized(): Promise<boolean> {
  return getCurrentWindow().isMaximized();
}

export async function minimizeMainWindow(): Promise<void> {
  await getCurrentWindow().minimize();
}

export async function toggleMainWindowMaximized(): Promise<void> {
  const currentWindow = getCurrentWindow();
  if (await currentWindow.isMaximized()) {
    await currentWindow.unmaximize();
    return;
  }
  await currentWindow.maximize();
}

export async function closeMainWindow(): Promise<void> {
  await getCurrentWindow().close();
}

export async function listenToMainWindowResize(handler: () => void): Promise<() => void> {
  return getCurrentWindow().onResized(handler);
}
