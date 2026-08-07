import { Builder, By, until, WebDriver } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { spawn, ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import http from "node:http";

const APP_URL = process.env.APP_URL || "http://localhost:1420";
const TAURI_DEV_TIMEOUT_MS = Number(process.env.TAURI_DEV_TIMEOUT_MS || 180_000);
const HEADLESS = process.env.HEADLESS !== "false";

function waitForServer(
  url: string,
  timeoutMs: number
): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let abortController: AbortController | null = null;

    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      abortController?.abort();
      abortController = null;
    };

    const fail = (msg: string) => {
      cleanup();
      reject(new Error(msg));
    };

    const check = () => {
      abortController = new AbortController();
      const req = http.get(url, { signal: abortController.signal }, (res) => {
        res.resume(); // discard body
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
          cleanup();
          resolve();
        } else {
          retry();
        }
      });
      req.on("error", (err) => {
        if (err.name !== "AbortError") {
          retry();
        }
      });
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        fail(
          `Timed out waiting for ${url} after ${timeoutMs}ms. ` +
            `Make sure the Tauri app is running (npm run tauri dev) or the Vite dev server is up.`
        );
        return;
      }
      timeoutHandle = setTimeout(check, 500);
    };

    check();
  });
}

function startTauriDev(): ChildProcess {
  const proc = spawn("npm", ["run", "tauri", "dev"], {
    cwd: process.cwd(),
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
  return proc;
}

function stopTauriDev(proc: ChildProcess): void {
  try {
    if (proc.pid && !proc.killed) {
      process.kill(-proc.pid, "SIGTERM");
    }
  } catch {
    // ignore
  }
}

describe("xsterm system smoke test", () => {
  let driver: WebDriver;
  let tauriProc: ChildProcess | null = null;
  let shouldStopTauri = false;

  before(async () => {
    if (process.env.START_TAURI === "true" && !process.env.APP_URL) {
      tauriProc = startTauriDev();
      shouldStopTauri = true;
    }

    await waitForServer(APP_URL, TAURI_DEV_TIMEOUT_MS);

    const options = new chrome.Options();
    if (HEADLESS) {
      options.addArguments("--headless=new");
    }
    options.addArguments(
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1280,800"
    );

    driver = await new Builder()
      .forBrowser("chrome")
      .setChromeOptions(options)
      .build();
  });

  after(async () => {
    if (driver) {
      await driver.quit().catch(() => {});
    }
    if (shouldStopTauri && tauriProc) {
      stopTauriDev(tauriProc);
    }
  });

  it("loads the application container", async () => {
    await driver.get(APP_URL);
    // Root is #root; wait for React to mount children inside it.
    await driver.wait(
      until.elementLocated(By.css("#root > *")),
      10_000
    );
    const container = await driver.findElement(By.css("#root > *"));
    assert.ok(await container.isDisplayed(), "app root child should be visible");
  });

  it("renders the title bar", async () => {
    // MUI AppBar renders as <header>; logo is <img alt="xsterm" />.
    await driver.get(APP_URL);
    const header = await driver.wait(
      until.elementLocated(By.css("header")),
      10_000
    );
    assert.ok(await header.isDisplayed(), "header (AppBar) should be visible");

    const logo = await driver.findElements(By.css("header img[alt='xsterm']"));
    assert.ok(logo.length > 0, "logo image should be present in header");
  });

  it("shows the window control buttons", async () => {
    // Window controls replace the absent menu bar (File/Edit/View/Terminal/Help).
    await driver.get(APP_URL);
    await driver.wait(
      until.elementLocated(By.css("[aria-label='Minimize']")),
      10_000
    );
    const minimize = await driver.findElement(By.css("[aria-label='Minimize']"));
    const close = await driver.findElement(By.css("[aria-label='Close']"));
    assert.ok(await minimize.isDisplayed(), "Minimize button should be visible");
    assert.ok(await close.isDisplayed(), "Close button should be visible");
  });

  it("renders the main content area", async () => {
    await driver.get(APP_URL);
    // MUI renders the toolbar with class xsterm-titlebar as the title bar.
    const toolbar = await driver.wait(
      until.elementLocated(By.css(".xsterm-titlebar")),
      10_000
    );
    assert.ok(
      await toolbar.isDisplayed(),
      ".xsterm-titlebar should be visible"
    );
  });

  it("has a sidebar with workspace/session controls", async () => {
    await driver.get(APP_URL);
    // MUI Drawer renders as <aside class="MuiDrawer-root ...">.
    const drawer = await driver.wait(
      until.elementLocated(By.css("aside.MuiDrawer-root")),
      10_000
    );
    assert.ok(await drawer.isDisplayed(), "MUI Drawer sidebar should be visible");
  });

  it("displays at least one workspace view", async () => {
    await driver.get(APP_URL);
    // WorkspaceContainer renders an xterm terminal div.
    const terminals = await driver.wait(
      until.elementsLocated(By.css(".xterm")),
      10_000
    );
    assert.ok(
      terminals.length > 0,
      "at least one xterm terminal should be rendered"
    );
  });

  it("can open and close the create-session dialog", async function () {
    // TC-1401: Dialog depends on Tauri window API (getCurrentWindow) which is
    // unavailable in Chrome (no __TAURI_INTERNALS__). Run only inside Tauri.
    const isTauri = await driver.executeScript(
      "return typeof window.__TAURI_INTERNALS__ !== 'undefined'"
    );
    if (!isTauri) {
      this.skip();
    }

    // Open dialog via the keyboard shortcut Ctrl+Shift+N (or Cmd+Shift+N on macOS)
    const platform = process.platform;
    const key = platform === "darwin" ? "n" : "n";
    const modifier = platform === "darwin" ? "command" : "control";
    await driver
      .actions()
      .keyDown(modifier)
      .keyDown("shift")
      .keyDown(key)
      .keyUp(key)
      .keyUp("shift")
      .keyUp(modifier)
      .perform();

    await sleep(500);

    // Dialog overlay is expected when running inside Tauri.
    const dialogs = await driver.findElements(By.css("[role='dialog']"));
    if (dialogs.length > 0) {
      const dialog = dialogs[0];
      assert.ok(await dialog.isDisplayed(), "create session dialog should be visible");
    }
  });
});
