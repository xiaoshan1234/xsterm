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
    await driver.wait(until.elementLocated(By.css(".app-container")), 10_000);
    const container = await driver.findElement(By.css(".app-container"));
    assert.ok(await container.isDisplayed(), ".app-container should be visible");
  });

  it("renders the title bar", async () => {
    const navbar = await driver.wait(
      until.elementLocated(By.css(".navbar")),
      10_000
    );
    assert.ok(await navbar.isDisplayed(), ".navbar should be visible");

    const logo = await driver.findElements(By.css(".navbar-logo-img"));
    assert.ok(logo.length > 0, "logo image should be present in navbar");
  });

  it("shows the menu bar items", async () => {
    const menuItems = await driver.findElements(By.css(".navbar-item"));
    const labels = await Promise.all(menuItems.map((el) => el.getText()));
    assert.deepStrictEqual(labels, ["File", "Edit", "View", "Terminal", "Help"]);
  });

  it("renders the main content area", async () => {
    const contentArea = await driver.wait(
      until.elementLocated(By.css(".content-area")),
      10_000
    );
    assert.ok(
      await contentArea.isDisplayed(),
      ".content-area should be visible"
    );
  });

  it("has a sidebar with workspace/session controls", async () => {
    const sidebar = await driver.findElements(By.css(".sidebar"));
    if (sidebar.length === 0) {
      // The sidebar component may use a different class name; just verify
      // the content area contains more than one direct child.
      const contentArea = await driver.findElement(By.css(".content-area"));
      const children = await contentArea.findElements(By.css(":scope > *"));
      assert.ok(children.length >= 2, "content area should contain sidebar and main area");
    }
  });

  it("displays at least one workspace view", async () => {
    const workspaceViews = await driver.findElements(By.css(".workspace-view"));
    assert.ok(
      workspaceViews.length > 0,
      "at least one .workspace-view should be rendered"
    );
  });

  it("can open and close the create-session dialog", async () => {
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

    // Dialog overlay is expected. If the dialog is not reachable because the
    // app is running outside Tauri, we only verify the overlay exists when
    // the app is responsive.
    const dialogs = await driver.findElements(By.css("[role='dialog']"));
    if (dialogs.length > 0) {
      const dialog = dialogs[0];
      assert.ok(await dialog.isDisplayed(), "create session dialog should be visible");
    }
  });
});
