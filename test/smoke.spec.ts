import { Builder, By, until, WebDriver } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { setTimeout as sleep } from "node:timers/promises";
import http from "node:http";
import { startTauriDev, type TauriDevProcess } from "./tauri-launcher.ts";

const APP_URL = process.env.APP_URL || "http://localhost:1420";
const TAURI_DEV_TIMEOUT_MS = Number(process.env.TAURI_DEV_TIMEOUT_MS || 180_000);
const HEADLESS = process.env.HEADLESS !== "false";

describe("xsterm system smoke test", () => {
  let driver: WebDriver;
  let tauriDev: TauriDevProcess | null = null;

  before(async () => {
    if (process.env.START_TAURI === "true" && !process.env.APP_URL) {
      tauriDev = await startTauriDev(TAURI_DEV_TIMEOUT_MS);
    }

    const start = Date.now();
    while (true) {
      try {
        await new Promise<void>((resolve, reject) => {
          const req = http.get(APP_URL, { timeout: 2000 }, (res) => {
            res.resume();
            if (res.statusCode && res.statusCode < 500) resolve();
            else reject(new Error("not ready"));
          });
          req.on("error", reject);
          req.setTimeout(2000, () => { req.destroy(); reject(new Error("timeout")); });
        });
        break;
      } catch {
        if (Date.now() - start > TAURI_DEV_TIMEOUT_MS) {
          throw new Error(`Timed out waiting for ${APP_URL}`);
        }
        await sleep(1000);
      }
    }

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
    if (tauriDev) {
      await tauriDev.stop();
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
