/**
 * lib/harness.ts — xsterm UI test harness
 *
 * Provides WebDriver lifecycle management, polling waits, failure
 * artifact collection, and a node:test wrapper (`tc`) that produces
 * uniformly-named test cases.
 *
 * Reuses:
 *   - createDriver() from test/remote/driver.ts (tauri-driver session)
 *   - quit fault-tolerance pattern from test/remote/drive.ts
 *     (driver.quit().catch(() => {}) — prevents after-hook double-throw
 *     when the session is already dead)
 *
 * App-ready signal: [aria-label="Minimize"] is visible (30s timeout).
 * Crash detection: NoSuchSessionError → writes crashed.txt to artifacts.
 */

import { By, WebDriver, WebElement, error as SeleniumError } from "selenium-webdriver";
import { it } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDriver } from "../../remote/driver.ts";

// ── constants ────────────────────────────────────────────────────────────────

/** CSS selector for the Minimize button — the app-ready signal. */
const APP_READY_SELECTOR = '[aria-label="Minimize"]';

/** Timeout for app-ready check after session creation. */
const APP_READY_TIMEOUT_MS = 30_000;

/** Default polling interval for waitUntil (ms). */
const DEFAULT_INTERVAL_MS = 500;

/** Default timeout for waitUntil (ms). */
const DEFAULT_TIMEOUT_MS = 5_000;

/** Base directory for failure artifacts. */
const ARTIFACTS_BASE = path.join(import.meta.dirname, "..", "artifacts");

// ── module-level active driver ───────────────────────────────────────────────
//
// appFixture().before() sets this; tc() reads it. This couples the two
// functions, but matches the expected usage pattern:
//
//   const fixture = appFixture();
//   describe("spec", () => {
//     before(() => fixture.before());
//     after(() => fixture.after());
//     tc("001", "does something", async (driver) => { ... });
//   });

let activeDriver: WebDriver | null = null;

// ── exported types ───────────────────────────────────────────────────────────

export interface AppFixture {
  driver: WebDriver;
}

// ── appFixture ───────────────────────────────────────────────────────────────

/**
 * Creates a WebDriver session lifecycle fixture.
 *
 * `before()` creates a driver (via tauri-driver, which launches xsterm.exe)
 * and waits for the app-ready signal ([aria-label="Minimize"] visible, 30s).
 *
 * `after()` quits the driver with fault-tolerance — `.catch(() => {})` —
 * so a dead session doesn't cause a double-throw in the after hook.
 *
 * `getDriver()` returns the active driver (throws if before() hasn't run).
 */
export function appFixture(): {
  before: () => Promise<WebDriver>;
  after: () => Promise<void>;
  getDriver: () => WebDriver;
} {
  return {
    async before(): Promise<WebDriver> {
      const driver = await createDriver();
      activeDriver = driver;
      await waitForElement(driver, APP_READY_SELECTOR, {
        timeout: APP_READY_TIMEOUT_MS,
        visible: true,
      });
      return driver;
    },

    async after(): Promise<void> {
      if (activeDriver) {
        // Fault-tolerant quit: if the session is already dead (app crashed,
        // driver timed out, etc.), swallow the NoSuchSessionError so the
        // after hook doesn't mask the original test failure.
        await activeDriver.quit().catch(() => {});
        activeDriver = null;
      }
    },

    getDriver(): WebDriver {
      if (!activeDriver) {
        throw new Error(
          "appFixture.before() must be called before getDriver()"
        );
      }
      return activeDriver;
    },
  };
}

// ── waitUntil ────────────────────────────────────────────────────────────────

/**
 * Polls `condition()` until it returns a truthy value, or times out.
 *
 * The condition returns `T | false | null | undefined`:
 *   - Any value that is not `false`, `null`, or `undefined` is a success.
 *   - `false`, `null`, `undefined` mean "not ready, keep polling".
 *
 * This distinction matters for conditions that return `0` or `""` (falsy
 * but valid success values).
 *
 * @param condition  Async function that returns a result or a "not ready" value
 * @param opts.timeout   Max wait time in ms (default 5000)
 * @param opts.interval  Polling interval in ms (default 500)
 * @param opts.message   Error message on timeout
 * @returns The first truthy result from condition()
 */
export async function waitUntil<T>(
  condition: () => Promise<T | false | null | undefined>,
  opts: { timeout?: number; interval?: number; message?: string }
): Promise<T> {
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS;
  const interval = opts.interval ?? DEFAULT_INTERVAL_MS;
  const message =
    opts.message ?? `Condition not met within ${timeout}ms`;

  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await condition();
    if (result !== false && result !== null && result !== undefined) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(message);
}

// ── waitForElement ───────────────────────────────────────────────────────────

/**
 * Waits for an element matching `css` to appear in the DOM.
 *
 * @param driver   WebDriver instance
 * @param css      CSS selector string
 * @param opts.timeout  Max wait time in ms (default 5000)
 * @param opts.visible  If true, also require the element to be displayed
 * @returns The first matching WebElement
 */
export async function waitForElement(
  driver: WebDriver,
  css: string,
  opts?: { timeout?: number; visible?: boolean }
): Promise<WebElement> {
  const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
  const visible = opts?.visible ?? false;

  return waitUntil(async () => {
    const elements = await driver.findElements(By.css(css));
    if (elements.length === 0) return false;
    if (visible && !(await elements[0].isDisplayed())) return false;
    return elements[0];
  }, {
    timeout,
    message: `Element "${css}" not found within ${timeout}ms`,
  });
}

// ── captureArtifacts ─────────────────────────────────────────────────────────

/**
 * Collects failure artifacts: screenshot PNG, <body> outerHTML, and all
 * .xterm-rows text content.
 *
 * Files are written to:
 *   test/sys-test/artifacts/<specName>/<testName>-<timestamp>.{png,html,txt}
 *
 * If the WebDriver throws NoSuchSessionError (app crashed), writes
 * `crashed.txt` to the artifacts directory instead.
 *
 * This function is best-effort: all errors are swallowed so that artifact
 * collection never masks the original test failure.
 *
 * @param driver    WebDriver instance
 * @param specName  Spec identifier (becomes the artifacts subdirectory)
 * @param testName  Test name (becomes part of the filename)
 */
export async function captureArtifacts(
  driver: WebDriver,
  specName: string,
  testName: string
): Promise<void> {
  const dir = path.join(ARTIFACTS_BASE, specName);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${testName}-${timestamp}`;

  try {
    await mkdir(dir, { recursive: true });

    // Screenshot → PNG
    const png = await driver.takeScreenshot();
    await writeFile(path.join(dir, `${base}.png`), Buffer.from(png, "base64"));

    // <body> outerHTML → HTML
    const html = await driver.executeScript("return document.body.outerHTML;");
    await writeFile(path.join(dir, `${base}.html`), String(html));

    // All .xterm-rows text → TXT
    const rows = await driver.findElements(By.css(".xterm-rows"));
    const texts = await Promise.all(rows.map((el) => el.getText()));
    const content =
      texts.length > 0
        ? texts.join("\n---\n")
        : "(no .xterm-rows elements found)";
    await writeFile(path.join(dir, `${base}.txt`), content);
  } catch (err) {
    // App crash: WebDriver session is dead.
    // Write crashed.txt so the failure is distinguishable from a normal
    // test assertion failure.
    const isNoSession =
      err instanceof SeleniumError.NoSuchSessionError ||
      (err instanceof Error && err.name === "NoSuchSessionError");

    if (isNoSession) {
      try {
        await mkdir(dir, { recursive: true });
        const detail = err instanceof Error ? err.message : String(err);
        await writeFile(
          path.join(dir, "crashed.txt"),
          [
            "App crashed during artifact capture.",
            `specName: ${specName}`,
            `testName: ${testName}`,
            `timestamp: ${timestamp}`,
            `error: ${detail}`,
            "",
            "The WebDriver session is dead (NoSuchSessionError).",
            "The app process likely exited unexpectedly.",
          ].join("\n")
        );
      } catch {
        // Even crashed.txt write failed — nothing more we can do.
      }
    }
    // Swallow all errors: artifact collection must not mask the test failure.
  }
}

// ── tc (test-case wrapper) ───────────────────────────────────────────────────

/**
 * Registers a node:test test case with a uniform naming convention.
 *
 * The test name is formatted as `TC-<id>: <name>`.
 *
 * The test function receives the active WebDriver (set by appFixture().before()).
 * On failure, captureArtifacts() is called before rethrowing, so failure
 * evidence is always collected.
 *
 * @param id   Test case ID (e.g. "001")
 * @param name Human-readable test name
 * @param fn   Test body, receives the active WebDriver
 */
export function tc(
  id: string,
  name: string,
  fn: (driver: WebDriver) => Promise<void>
): void {
  it(`TC-${id}: ${name}`, async () => {
    if (!activeDriver) {
      throw new Error(
        "appFixture.before() must be called before tc() — no active driver"
      );
    }
    const driver = activeDriver;
    try {
      await fn(driver);
    } catch (err) {
      // Best-effort artifact capture before rethrowing the original error.
      await captureArtifacts(driver, id, name).catch(() => {});
      throw err;
    }
  });
}
