import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  Builder,
  By,
  Capabilities,
  until,
  type WebDriver,
} from "selenium-webdriver";

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const e2eRoot = path.join(projectRoot, "test", "e2e");
const cacheRoot = path.join(e2eRoot, ".cache");
const appPath = path.join(projectRoot, "src-tauri", "target", "debug", "xsterm.exe");
const viteUrl = "http://localhost:1420";
const webdriverPort = 4456;
const nativeDriverPort = 4457;
const webdriverUrl = `http://127.0.0.1:${webdriverPort}`;

const managedProcesses: ChildProcess[] = [];

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): string {
  return execFileSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }).trim();
}

function startProcess(
  label: string,
  command: string,
  args: string[],
): ChildProcess {
  const child = spawn(command, args, {
    cwd: projectRoot,
    stdio: "ignore",
    windowsHide: true,
  });
  managedProcesses.push(child);
  console.log(`  started ${label} (pid ${child.pid ?? "?"})`);
  return child;
}

async function stopProcessTree(child: ChildProcess): Promise<void> {
  const processId = child.pid;
  if (!processId || child.killed) return;
  try {
    execFileSync("taskkill.exe", ["/F", "/T", "/PID", String(processId)], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    child.kill();
  }
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling until the timeout expires.
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function ensureVite(): Promise<ChildProcess | null> {
  try {
    await waitForHttp(viteUrl, 2_000);
    console.log("  reuse existing Vite server on :1420");
    return null;
  } catch {
    console.log("  starting Windows Vite server on :1420");
    const vite = startProcess("vite", process.env.ComSpec ?? "cmd.exe", [
      "/d",
      "/s",
      "/c",
      "npm run dev",
    ]);
    await waitForHttp(viteUrl, 30_000);
    return vite;
  }
}

function readWebview2Version(): string {
  const versionsDir = String.raw`C:\Program Files (x86)\Microsoft\EdgeWebView\Application`;
  const version = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `(Get-ChildItem '${versionsDir}' -Directory | Where-Object { $_.Name -match '^\\d+\\.' } | Sort-Object Name -Descending | Select-Object -First 1).Name`,
    ],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  if (!version) throw new Error("Microsoft Edge WebView2 runtime was not found");
  return version;
}

function driverMajorVersion(driverPath: string): number | null {
  try {
    const output = run(driverPath, ["--version"]);
    const match = output.match(/(\d+)\.\d+\.\d+\.\d+/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

async function ensureEdgeDriver(): Promise<string> {
  await mkdir(cacheRoot, { recursive: true });
  const driverPath = path.join(cacheRoot, "msedgedriver.exe");
  const webviewVersion = readWebview2Version();
  const expectedMajor = Number(webviewVersion.split(".")[0]);
  const actualMajor = driverMajorVersion(driverPath);
  if (actualMajor === expectedMajor) {
    return driverPath;
  }
  throw new Error(
    `msedgedriver major version ${actualMajor ?? "unknown"} does not match WebView2 ${webviewVersion}`,
  );
}

function buildApplication(): void {
  console.log("  building xsterm debug executable");
  run("cargo", ["build", "--manifest-path", "src-tauri/Cargo.toml"]);
}

async function startWebdriver(nativeDriverPath: string): Promise<ChildProcess> {
  const driver = startProcess("tauri-driver", "tauri-driver.exe", [
    "--port",
    String(webdriverPort),
    "--native-port",
    String(nativeDriverPort),
    "--native-driver",
    nativeDriverPath,
  ]);
  await waitForHttp(`${webdriverUrl}/sessions`, 20_000);
  return driver;
}

async function createDriver(): Promise<WebDriver> {
  const capabilities = new Capabilities();
  capabilities.setBrowserName("wry");
  capabilities.set("tauri:options", {
    application: appPath,
    args: [],
  });
  return new Builder().usingServer(webdriverUrl).withCapabilities(capabilities).build();
}

async function installKeyRecorder(driver: WebDriver): Promise<void> {
  await driver.executeScript(`
    window.__xstermKeys = [];
    window.__xstermHandled = [];
    if (window.__xstermKeyRecorder) {
      window.removeEventListener('keydown', window.__xstermKeyRecorder, true);
    }
    if (window.__xstermKeyBubbleRecorder) {
      window.removeEventListener('keydown', window.__xstermKeyBubbleRecorder, false);
    }
    window.__xstermKeyRecorder = (event) => {
      window.__xstermKeys.push({
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
      });
    };
    window.addEventListener('keydown', window.__xstermKeyRecorder, true);
    window.__xstermKeyBubbleRecorder = (event) => {
      if (event.key === 'Tab') {
        window.__xstermHandled.push({
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          defaultPrevented: event.defaultPrevented,
        });
      }
    };
    window.addEventListener('keydown', window.__xstermKeyBubbleRecorder, false);
  `);
}

async function readRecordedKeys(driver: WebDriver): Promise<unknown[]> {
  return driver.executeScript<unknown[]>("return window.__xstermKeys ?? [];");
}

async function readHandledTabs(driver: WebDriver): Promise<unknown[]> {
  return driver.executeScript<unknown[]>("return window.__xstermHandled ?? [];");
}

async function sendOsKeys(sendKeys: string): Promise<void> {
  const lines = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$wsh = New-Object -ComObject WScript.Shell",
    "if (-not $wsh.AppActivate('xsterm')) { throw 'failed to activate xsterm window' }",
    "Start-Sleep -Milliseconds 500",
    `[System.Windows.Forms.SendKeys]::SendWait('${sendKeys}')`,
  ];
  run("powershell.exe", ["-NoProfile", "-Command", lines.join("; ")]);
}

async function main(): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("This E2E test must run from Windows Node");
  }

  let driver: WebDriver | null = null;
  try {
    await ensureVite();
    buildApplication();
    const nativeDriverPath = await ensureEdgeDriver();
    await startWebdriver(nativeDriverPath);
    driver = await createDriver();
    await driver.wait(until.elementLocated(By.css(".shell-root")), 30_000);
    console.log("  app shell is ready");

    await installKeyRecorder(driver);

    // Positive control: WebDriver-injected keys must reach the page.
    await driver.actions().sendKeys("b").perform();
    await sleep(300);
    const webdriverKeys = await readRecordedKeys(driver);
    const sawWebdriverKey = webdriverKeys.some(
      (entry) =>
        (entry as { key?: string; code?: string }).code === "KeyB" ||
        (entry as { key?: string }).key?.toLowerCase() === "b",
    );
    if (!sawWebdriverKey) {
      throw new Error(`WebDriver control key did not reach the page: ${JSON.stringify(webdriverKeys)}`);
    }
    console.log("  control: WebDriver key reached the page");

    // Real OS-level Ctrl+Tab, the exact key the user reported as dead.
    await sendOsKeys("^{TAB}");
    await sleep(500);
    const osKeys = await readRecordedKeys(driver);
    const sawCtrlTab = osKeys.some(
      (entry) =>
        (entry as { key?: string; ctrlKey?: boolean }).key === "Tab" &&
        (entry as { ctrlKey?: boolean }).ctrlKey === true,
    );
    if (!sawCtrlTab) {
      throw new Error(`OS Ctrl+Tab did not reach the page: ${JSON.stringify(osKeys)}`);
    }
    const handledTabs = await readHandledTabs(driver);
    const handledCtrlTab = handledTabs.some(
      (entry) =>
        (entry as { ctrlKey?: boolean; shiftKey?: boolean; defaultPrevented?: boolean })
          .ctrlKey === true &&
        (entry as { shiftKey?: boolean }).shiftKey === false &&
        (entry as { defaultPrevented?: boolean }).defaultPrevented === true,
    );
    if (!handledCtrlTab) {
      throw new Error(
        `Ctrl+Tab was not consumed by the keybinding dispatcher: ${JSON.stringify(handledTabs)}`,
      );
    }
    console.log("  Ctrl+Tab reached the page and was consumed by the app dispatcher");

    await sendOsKeys("^+{TAB}");
    await sleep(500);
    const osShiftKeys = await readRecordedKeys(driver);
    const sawCtrlShiftTab = osShiftKeys.some(
      (entry) =>
        (entry as { key?: string; ctrlKey?: boolean; shiftKey?: boolean }).key === "Tab" &&
        (entry as { ctrlKey?: boolean }).ctrlKey === true &&
        (entry as { shiftKey?: boolean }).shiftKey === true,
    );
    if (!sawCtrlShiftTab) {
      throw new Error(`OS Ctrl+Shift+Tab did not reach the page: ${JSON.stringify(osShiftKeys)}`);
    }
    const handledShiftTabs = await readHandledTabs(driver);
    const handledCtrlShiftTab = handledShiftTabs.some(
      (entry) =>
        (entry as { ctrlKey?: boolean; shiftKey?: boolean; defaultPrevented?: boolean })
          .ctrlKey === true &&
        (entry as { shiftKey?: boolean }).shiftKey === true &&
        (entry as { defaultPrevented?: boolean }).defaultPrevented === true,
    );
    if (!handledCtrlShiftTab) {
      throw new Error(
        `Ctrl+Shift+Tab was not consumed by the keybinding dispatcher: ${JSON.stringify(handledShiftTabs)}`,
      );
    }
    console.log("  Ctrl+Shift+Tab reached the page and was consumed by the app dispatcher");

    console.log("\nKeybinding E2E passed: the app consumed Ctrl+Tab / Ctrl+Shift+Tab");
  } finally {
    await driver?.quit().catch(() => {});
    for (const child of managedProcesses.reverse()) {
      await stopProcessTree(child);
    }
  }
}

main().catch((error) => {
  console.error("\nKeybinding E2E failed:", error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
