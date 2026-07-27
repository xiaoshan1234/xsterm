/**
 * Shared helpers for driving the Windows-hosted xsterm app from WSL
 * through the tauri-driver stack.
 *
 * Chain: WSL client -> 127.0.0.1:4444 (forwarded by WSL2 NAT)
 *       -> tauri-driver (127.0.0.1:4444)
 *       -> msedgedriver -> xsterm.exe (WebView2)
 *
 * WSL2 NAT mode auto-forwards Windows loopback ports to WSL, so a WSL
 * process can talk to tauri-driver on 127.0.0.1 directly without any
 * relay. Override with REMOTE_WEBDRIVER_URL when needed (e.g. when
 * driving from a non-WSL host).
 */
import { Builder, Capabilities, WebDriver } from "selenium-webdriver";

/** Default Windows path of the debug binary (as seen by tauri-driver on Windows). */
const DEFAULT_APPLICATION =
  String.raw`C:\Users\LONER\1111\prj\xsterm\src-tauri\target\debug\xsterm.exe`;

const DEFAULT_URL = "http://127.0.0.1:4444";

export function remoteWebDriverUrl(): string {
  return process.env.REMOTE_WEBDRIVER_URL ?? DEFAULT_URL;
}

/**
 * Windows-side path of the xsterm executable that tauri-driver should launch.
 * MUST be a Windows path (C:\...), not a /mnt/c WSL path.
 */
export function applicationPath(): string {
  return process.env.TAURI_APPLICATION ?? DEFAULT_APPLICATION;
}

/** Create a WebDriver session; tauri-driver launches the app itself. */
export async function createDriver(): Promise<WebDriver> {
  const capabilities = new Capabilities();
  capabilities.setBrowserName("wry");
  capabilities.set("tauri:options", {
    application: applicationPath(),
    args: [],
  });

  const url = remoteWebDriverUrl();
  return new Builder().usingServer(url).withCapabilities(capabilities).build();
}
