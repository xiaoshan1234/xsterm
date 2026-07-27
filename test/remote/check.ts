import { By, WebDriver } from "selenium-webdriver";
import { writeFile, mkdir } from "node:fs/promises";
import {
  applicationPath,
  createDriver,
  remoteWebDriverUrl,
} from "./driver.ts";

const SCREENSHOT_PATH = "test/remote/out/check.png";
const STEP_TIMEOUT_MS = 15_000;

let failures = 0;

function pass(step: string, detail = ""): void {
  console.log(`  PASS  ${step}${detail ? ` - ${detail}` : ""}`);
}

function fail(step: string, err: unknown, remediation: string): void {
  failures++;
  console.error(`  FAIL  ${step}`);
  console.error(`        ${err instanceof Error ? err.message : String(err)}`);
  console.error(`        -> ${remediation}`);
}

async function main(): Promise<void> {
  console.log("xsterm remote WebDriver self-check\n");

  const url = remoteWebDriverUrl();
  console.log(`       endpoint: ${url}`);

  console.log("[1/3] tauri-driver reachability (GET /sessions)");
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STEP_TIMEOUT_MS);
    const res = await fetch(`${url}/sessions`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pass("GET /sessions", "tauri-driver is responding");
  } catch (err) {
    fail(
      "GET /sessions",
      err,
      "On Windows run: powershell -ExecutionPolicy Bypass -File scripts\\windows\\start-webdriver.ps1\n" +
        "        Or from WSL: bash scripts/start-webdriver.sh",
    );
  }

  console.log("[2/3] WebDriver session (launches xsterm.exe on Windows)");
  let driver: WebDriver | null = null;
  if (failures === 0) {
    try {
      console.log(`       application: ${applicationPath()}`);
      driver = await createDriver();
      pass("session created", `title="${await driver.getTitle()}"`);
    } catch (err) {
      fail(
        "create session",
        err,
        "Check that TAURI_APPLICATION points to an existing Windows exe path (C:\\...). " +
          "If tauri-driver reports a driver mismatch, rerun start-webdriver.ps1 to reinstall msedgedriver.",
      );
    }
  }

  console.log("[3/3] page sanity + screenshot round-trip");
  if (driver) {
    try {
      const container = await driver.findElement(By.css(".app-container"));
      if (!(await container.isDisplayed())) {
        throw new Error(".app-container exists but is not visible");
      }
      pass(".app-container visible");

      await mkdir("test/remote/out", { recursive: true });
      const png = await driver.takeScreenshot();
      await writeFile(SCREENSHOT_PATH, Buffer.from(png, "base64"));
      pass("screenshot saved", SCREENSHOT_PATH);
    } catch (err) {
      fail(
        "page sanity / screenshot",
        err,
        "The app launched but the UI did not render as expected. " +
          "Make sure the Vite dev server (npm run dev) is running ON WINDOWS.",
      );
    }
  }

  if (driver) await driver.quit().catch(() => {});

  console.log(
    failures === 0
      ? "\nAll checks passed. The remote driving loop is ready: npm run test:remote:drive"
      : `\n${failures} check(s) failed - see remediation hints above.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});