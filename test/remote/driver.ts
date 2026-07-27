/**
 * Shared helpers for driving the Windows-hosted xsterm app from WSL
 * through the tauri-driver + TCP relay stack.
 *
 * Chain: WSL client -> relay (windows-ip:4446) -> tauri-driver (127.0.0.1:4444)
 *        -> msedgedriver -> xsterm.exe (WebView2)
 */
import { Builder, Capabilities, WebDriver } from "selenium-webdriver";
import { execSync } from "node:child_process";

/** Default Windows path of the debug binary (as seen by tauri-driver on Windows). */
const DEFAULT_APPLICATION =
  String.raw`C:\Users\LONER\1111\prj\xsterm\src-tauri\target\debug\xsterm.exe`;

const DEFAULT_RELAY_PORT = 4446;

/**
 * Best-effort detection of the Windows host IP from inside WSL2 (NAT mode):
 * the default gateway is the Windows host.
 */
export function detectWindowsHostIp(): string | null {
  try {
    const route = execSync("ip route show default", { encoding: "utf-8" });
    const match = route.match(/default via (\d+\.\d+\.\d+\.\d+)/);
    if (match) return match[1];
  } catch {
    // not on Linux / no iproute2
  }
  try {
    const resolv = execSync("cat /etc/resolv.conf", { encoding: "utf-8" });
    const match = resolv.match(/nameserver (\d+\.\d+\.\d+\.\d+)/);
    if (match) return match[1];
  } catch {
    // ignore
  }
  return null;
}

/**
 * WebDriver endpoint the client should talk to.
 * Priority: REMOTE_WEBDRIVER_URL env > auto-detected gateway IP + RELAY_PORT.
 */
export function remoteWebDriverUrl(): string {
  if (process.env.REMOTE_WEBDRIVER_URL) {
    return process.env.REMOTE_WEBDRIVER_URL;
  }
  const ip = detectWindowsHostIp();
  if (!ip) {
    throw new Error(
      "Could not auto-detect the Windows host IP. " +
        "Set REMOTE_WEBDRIVER_URL=http://<windows-ip>:4446 explicitly."
    );
  }
  const port = process.env.REMOTE_WEBDRIVER_PORT ?? String(DEFAULT_RELAY_PORT);
  return `http://${ip}:${port}`;
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
