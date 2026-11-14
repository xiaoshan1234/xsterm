import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  Builder,
  By,
  Capabilities,
  Key,
  Select,
  until,
  type WebDriver,
  type WebElement,
} from "selenium-webdriver";

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const e2eRoot = path.join(projectRoot, "test", "e2e");
const cacheRoot = path.join(e2eRoot, ".cache");
const artifactsRoot = path.join(e2eRoot, "artifacts");
const appPath = path.join(projectRoot, "src-tauri", "target", "debug", "xsterm.exe");
const webdriverPort = 4454;
const nativeDriverPort = 4455;
const viteUrl = "http://localhost:1420";
const webdriverUrl = `http://127.0.0.1:${webdriverPort}`;
const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const baseConfigName = `e2e-base-${testId}`;

interface ManagedProcess {
  process: ChildProcess;
  label: string;
}

interface TmuxFixture {
  name: "codex" | "opencode" | "probe" | "shell";
  socketName: string;
  sessionName: string;
  configName: string;
  startCommand?: string;
}

interface TerminalSnapshot {
  hasMouseMode: boolean;
  isAlternateScreen: boolean;
  text: string;
}

const managedProcesses: ManagedProcess[] = [];
const tmuxFixtures: TmuxFixture[] = [];

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
  options: { env?: NodeJS.ProcessEnv } = {},
): ManagedProcess {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: options.env ?? process.env,
    stdio: "ignore",
    windowsHide: true,
  });
  const managed = { process: child, label };
  managedProcesses.push(managed);
  return managed;
}

async function stopProcessTree(managed: ManagedProcess): Promise<void> {
  const processId = managed.process.pid;
  if (!processId || managed.process.killed) return;
  try {
    execFileSync("taskkill.exe", ["/F", "/T", "/PID", String(processId)], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    managed.process.kill();
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

async function ensureVite(): Promise<ManagedProcess | null> {
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
  const versions = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `(Get-ChildItem '${versionsDir}' -Directory | Where-Object { $_.Name -match '^\\d+\\.' } | Sort-Object Name -Descending | Select-Object -First 1).Name`,
    ],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  if (!versions) throw new Error("Microsoft Edge WebView2 runtime was not found");
  return versions;
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
    console.log(`  msedgedriver ${expectedMajor}.x matches WebView2 ${webviewVersion}`);
    return driverPath;
  }

  console.log(`  downloading msedgedriver for WebView2 ${webviewVersion}`);
  run("msedgedriver-tool.exe", [], { cwd: cacheRoot });
  const downloadedPath = path.join(cacheRoot, "msedgedriver.exe");
  if (driverMajorVersion(downloadedPath) !== expectedMajor) {
    throw new Error(`Failed to prepare msedgedriver for WebView2 ${webviewVersion}`);
  }
  return downloadedPath;
}

async function buildApplication(): Promise<void> {
  console.log("  building xsterm debug executable");
  run("cargo", ["build", "--manifest-path", "src-tauri/Cargo.toml"]);
  await mkdir(path.dirname(appPath), { recursive: true });
}

async function startWebdriver(nativeDriverPath: string): Promise<ManagedProcess> {
  const driver = startProcess(
    "tauri-driver",
    "tauri-driver.exe",
    [
      "--port",
      String(webdriverPort),
      "--native-port",
      String(nativeDriverPort),
      "--native-driver",
      nativeDriverPath,
    ],
  );
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

async function waitForElement(
  driver: WebDriver,
  selector: string,
  timeoutMs = 15_000,
): Promise<void> {
  await driver.wait(until.elementLocated(By.css(selector)), timeoutMs);
}

async function clickButtonByText(driver: WebDriver, text: string): Promise<void> {
  const button = await driver.wait(
    until.elementLocated(
      By.xpath(`//button[normalize-space(.)="${text}" or .//*[normalize-space(.)="${text}"]]`),
    ),
    10_000,
  );
  await driver.executeScript("arguments[0].scrollIntoView({block:'center'})", button);
  await button.click();
}

async function fillFieldByLabel(
  driver: WebDriver,
  label: string,
  value: string,
): Promise<void> {
  const field = await driver.wait(
    until.elementLocated(
      By.xpath(
        `//div[contains(@class,"form-field")][.//label[normalize-space(.)="${label}"]]//input`,
      ),
    ),
    5_000,
  );
  await field.sendKeys(Key.chord(Key.CONTROL, "a"), value);
}

async function selectFieldByLabel(
  driver: WebDriver,
  label: string,
  optionTextFragment: string,
): Promise<void> {
  const selectElement = await driver.wait(
    until.elementLocated(
      By.xpath(
        `//div[contains(@class,"form-field")][.//label[normalize-space(.)="${label}"]]//select`,
      ),
    ),
    5_000,
  );
  const select = new Select(selectElement);
  const options = await select.getOptions();
  for (let index = 0; index < options.length; index++) {
    const optionLabel = (await options[index].getText()).trim();
    if (optionLabel.includes(optionTextFragment)) {
      await select.selectByIndex(index);
      return;
    }
  }
  throw new Error(`Option containing "${optionTextFragment}" was not found for ${label}`);
}

async function waitForDialogToClose(driver: WebDriver): Promise<void> {
  try {
    await driver.wait(
      async () => (await driver.findElements(By.css(".dialog"))).length === 0,
      20_000,
    );
  } catch (error) {
    const dialogText = await driver
      .executeScript<string>(
        "return document.querySelector('.dialog')?.innerText ?? '(dialog not found)'",
      )
      .catch(() => "(dialog text unavailable)");
    throw new Error(`Dialog did not close: ${dialogText}`, { cause: error });
  }
}

async function createSavedBaseConfig(driver: WebDriver): Promise<void> {
  console.log(`  creating base config ${baseConfigName}`);
  await ensureToolPanel(driver, "Terminal Manager");
  await clickButtonByText(driver, "New Terminal");
  await waitForElement(driver, ".dialog");
  await selectFieldByLabel(driver, "Shell Template", "WSL");
  await fillFieldByLabel(driver, "Terminal Name", baseConfigName);
  await clickButtonByText(driver, "Save Only");
  await waitForDialogToClose(driver);
}

async function ensureToolPanel(driver: WebDriver, toolLabel: string): Promise<void> {
  const button = await driver.findElement(By.css(`button[aria-label="${toolLabel}"]`));
  if ((await button.getAttribute("aria-pressed")) !== "true") {
    await button.click();
  }
  await driver.wait(
    until.elementLocated(
      By.xpath(`//h2[contains(normalize-space(.), "${toolLabel}")] | //*[contains(@class,"tool-panel")]`),
    ),
    5_000,
  );
}

async function removeConfigFromManager(
  driver: WebDriver,
  toolLabel: string,
  configName: string,
): Promise<void> {
  await ensureToolPanel(driver, toolLabel);
  const row = await driver.findElements(
    By.xpath(`//*[@role="option"][.//strong[normalize-space(.)="${configName}"]]`),
  );
  if (row.length === 0) return;
  await driver.actions().contextClick(row[0]).perform();
  const removeButton = await driver.wait(
    until.elementLocated(By.xpath('//button[normalize-space(.)="Remove"]')),
    5_000,
  );
  await removeButton.click();
  await driver.wait(
    async () =>
      (
        await driver.findElements(
          By.xpath(`//*[@role="option"][.//strong[normalize-space(.)="${configName}"]]`),
        )
      ).length === 0,
    5_000,
  );
}

async function cleanupE2eConfigs(driver: WebDriver): Promise<void> {
  for (const toolLabel of ["Tmux Manager", "Terminal Manager"]) {
    await ensureToolPanel(driver, toolLabel);
    const names = await driver.executeScript<string[]>(`
      return Array.from(document.querySelectorAll('.manager-row strong'))
        .map((element) => element.textContent?.trim() ?? '')
        .filter((name) => name.startsWith('e2e-'));
    `);
    for (const name of names.reverse()) {
      await removeConfigFromManager(driver, toolLabel, name);
    }
  }
}

async function attachTmuxSession(driver: WebDriver, fixture: TmuxFixture): Promise<void> {
  console.log(`  attaching ${fixture.name} session through WebView UI`);
  await ensureToolPanel(driver, "Tmux Manager");
  await clickButtonByText(driver, "Attach Tmux Session");
  await waitForElement(driver, ".dialog");
  await fillFieldByLabel(driver, "Display Name", fixture.configName);
  await selectFieldByLabel(driver, "Rides on", baseConfigName);
  await fillFieldByLabel(driver, "WSL Distribution", "Debian");
  await fillFieldByLabel(driver, "Tmux Session Name", fixture.sessionName);
  await fillFieldByLabel(driver, "Socket Name", fixture.socketName);
  await clickButtonByText(driver, "Attach");
  await waitForDialogToClose(driver);
}

async function readActiveTerminal(driver: WebDriver): Promise<TerminalSnapshot | null> {
  return driver.executeScript<TerminalSnapshot | null>(`
    const hosts = Array.from(document.querySelectorAll('.terminal-host'));
    const host = hosts.reverse().find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (!host) return null;
    const terminal = host.querySelector('.xterm');
    const overlay = host.querySelector('.terminal-line-number-overlay');
    const rows = host.querySelector('.xterm-rows');
    return {
      hasMouseMode: !!terminal?.classList.contains('enable-mouse-events'),
      isAlternateScreen: !!overlay && getComputedStyle(overlay).display === 'none',
      text: rows?.textContent ?? '',
    };
  `);
}

async function waitForTuiRestored(
  driver: WebDriver,
  fixture: TmuxFixture,
  timeoutMs = 30_000,
): Promise<TerminalSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot: TerminalSnapshot | null = null;
  while (Date.now() < deadline) {
    lastSnapshot = await readActiveTerminal(driver);
    if (
      lastSnapshot?.hasMouseMode &&
      lastSnapshot.isAlternateScreen &&
      lastSnapshot.text.trim().length > 0
    ) {
      return lastSnapshot;
    }
    await sleep(250);
  }
  throw new Error(
    `${fixture.name} TUI modes were not restored within ${timeoutMs}ms: ${JSON.stringify(lastSnapshot)}`,
  );
}

async function findTmuxManagerRow(
  driver: WebDriver,
  fixture: TmuxFixture,
): Promise<WebElement> {
  await ensureToolPanel(driver, "Tmux Manager");
  return driver.wait(
    until.elementLocated(
      By.xpath(`//*[@role="option"][.//strong[normalize-space(.)="${fixture.configName}"]]`),
    ),
    10_000,
  );
}

async function assertSingleTmuxInstance(
  driver: WebDriver,
  fixture: TmuxFixture,
): Promise<void> {
  const row = await findTmuxManagerRow(driver, fixture);
  const isConnected = await driver.executeScript<boolean>(
    "return arguments[0].classList.contains('manager-row--connected');",
    row,
  );
  if (!isConnected) {
    throw new Error(`Tmux Manager row ${fixture.configName} was not marked connected`);
  }

  const terminalCountBefore = (await driver.findElements(By.css(".xterm"))).length;
  await driver.actions().doubleClick(row).perform();
  await sleep(1_000);
  const terminalCountAfter = (await driver.findElements(By.css(".xterm"))).length;
  if (terminalCountAfter !== terminalCountBefore) {
    throw new Error(
      `Opening the same tmux config created another instance: before=${terminalCountBefore}, after=${terminalCountAfter}`,
    );
  }
  console.log("  reopening the saved config focused the existing tmux instance");
}

async function detachThroughManager(driver: WebDriver, fixture: TmuxFixture): Promise<void> {
  console.log("  detaching through Tmux Manager context menu");
  const terminalCountBeforeDetach = (await driver.findElements(By.css(".xterm"))).length;
  let sessionRow: WebElement;
  try {
    sessionRow = await findTmuxManagerRow(driver, fixture);
  } catch (error) {
    const panelText = await driver.executeScript<string>(
      "return document.querySelector('.shell-tool-panel')?.innerText ?? '(no panel)'",
    );
    throw new Error(`Tmux Manager row ${fixture.configName} not found: ${panelText}`, {
      cause: error,
    });
  }
  await driver.actions().contextClick(sessionRow).perform();
  const detachButton = await driver.wait(
    until.elementLocated(By.xpath('//button[normalize-space(.)="Detach"]')),
    5_000,
  );
  const isDisabled = await detachButton.getAttribute("disabled");
  if (isDisabled !== null) {
    throw new Error(`Detach was disabled for connected tmux config ${fixture.configName}`);
  }
  await detachButton.click();
  try {
    await driver.wait(
      async () => {
        const terminalCount = (await driver.findElements(By.css(".xterm"))).length;
        const initWindowCount = (await driver.findElements(By.css(".init-window-view"))).length;
        return terminalCount < terminalCountBeforeDetach && initWindowCount === 1;
      },
      20_000,
    );
  } catch (error) {
    const snapshot = await readActiveTerminal(driver);
    const terminalCountAfterDetach = (await driver.findElements(By.css(".xterm"))).length;
    throw new Error(
      `Detach did not remove a tmux terminal (before=${terminalCountBeforeDetach}, after=${terminalCountAfterDetach}): ${JSON.stringify(snapshot)}`,
      { cause: error },
    );
  }
  const initWindowCount = (await driver.findElements(By.css(".init-window-view"))).length;
  if (initWindowCount !== 1) {
    throw new Error(`Detach should leave exactly one init window, found ${initWindowCount}`);
  }
}

async function disconnectTmuxServer(driver: WebDriver, fixture: TmuxFixture): Promise<void> {
  console.log("  disconnecting the tmux server to exercise connection-state cleanup");
  const terminalCountBeforeDisconnect = (await driver.findElements(By.css(".xterm"))).length;
  run("wsl.exe", ["--exec", "tmux", "-L", fixture.socketName, "kill-server"]);
  try {
    await driver.wait(async () => {
      const rows = await driver.findElements(
        By.xpath(`//*[@role="option"][.//strong[normalize-space(.)="${fixture.configName}"]]`),
      );
      if (rows.length === 0) return false;
      return !(await driver.executeScript<boolean>(
        "return arguments[0].classList.contains('manager-row--connected');",
        rows[0],
      ));
    }, 20_000);
    await driver.wait(async () => {
      const terminalCount = (await driver.findElements(By.css(".xterm"))).length;
      const initWindowCount = (await driver.findElements(By.css(".init-window-view"))).length;
      return terminalCount < terminalCountBeforeDisconnect && initWindowCount === 1;
    }, 20_000);
  } catch (error) {
    const rowState = await driver.executeScript<Array<{ text: string; className: string }>>(`
      return Array.from(document.querySelectorAll('.manager-row'))
        .map((row) => ({
          text: row.textContent ?? '',
          className: row.className,
        }));
    `);
    throw new Error(
      `Tmux connection state did not update after server loss: ${JSON.stringify(rowState)}`,
      { cause: error },
    );
  }
}

async function reconnectThroughSavedConfig(
  driver: WebDriver,
  fixture: TmuxFixture,
): Promise<void> {
  console.log("  reconnecting through saved Tmux Manager entry");
  await ensureToolPanel(driver, "Tmux Manager");
  let savedRow: WebElement;
  try {
    savedRow = await driver.wait(
      until.elementLocated(
        By.xpath(`//*[@role="option"][.//strong[normalize-space(.)="${fixture.configName}"]]`),
      ),
      10_000,
    );
  } catch (error) {
    const panelText = await driver.executeScript<string>(
      "return document.querySelector('.shell-tool-panel')?.innerText ?? '(no panel)'",
    );
    throw new Error(`Saved tmux row ${fixture.configName} not found: ${panelText}`, {
      cause: error,
    });
  }
  await driver.actions().doubleClick(savedRow).perform();
  await waitForTuiRestored(driver, fixture);
}

async function sendWheelToTerminal(driver: WebDriver): Promise<void> {
  const screen = await driver.wait(
    until.elementLocated(By.css(".terminal-host .xterm-screen")),
    10_000,
  );
  await driver.executeScript(
    `
      const element = arguments[0];
      const rect = element.getBoundingClientRect();
      for (let index = 0; index < 3; index++) {
        element.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 120,
          deltaMode: 0,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true,
          cancelable: true,
        }));
      }
    `,
    screen,
  );
  await sleep(500);
}

async function focusActiveTerminal(driver: WebDriver): Promise<void> {
  await driver.wait(
    async () =>
      driver.executeScript<boolean>(`
        const hosts = Array.from(document.querySelectorAll('.terminal-host'));
        const host = hosts.reverse().find((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        if (!host) return false;
        host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        const input = host.querySelector('.xterm-helper-textarea');
        if (!input) return false;
        input.focus();
        return true;
      `),
    10_000,
  );
}

async function typeInActiveTerminal(driver: WebDriver, text: string): Promise<void> {
  await focusActiveTerminal(driver);
  for (const character of text) {
    await driver.actions().sendKeys(character).perform();
    await sleep(20);
  }
}

async function typeCommandInActiveTerminal(driver: WebDriver, text: string): Promise<void> {
  await typeInActiveTerminal(driver, text);
  await driver.actions().sendKeys(Key.ENTER).perform();
}

async function assertTmuxPassthroughDaReplyIsNotEchoed(driver: WebDriver): Promise<void> {
  const queryCommand = String.raw`printf '\033Ptmux;\033\033[c\033\\'; printf 'XSTERM_DA_QUERY_SENT\n'`;
  await typeCommandInActiveTerminal(driver, queryCommand);
  await waitForTerminalText(driver, "XSTERM_DA_QUERY_SENT");
  await sleep(1_000);
  await typeCommandInActiveTerminal(driver, "echo XSTERM_AFTER_DA_QUERY");
  await waitForTerminalText(driver, "XSTERM_AFTER_DA_QUERY");
  const text = (await readActiveTerminal(driver))?.text ?? "";
  if (text.includes("1;2c")) {
    throw new Error(`tmux passthrough echoed a terminal device-attributes reply: ${text}`);
  }
}

async function typeSpaceInActiveTerminal(driver: WebDriver): Promise<void> {
  await typeInActiveTerminal(driver, " ");
}

async function waitForTerminalText(
  driver: WebDriver,
  expectedText: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let currentText = "";
  while (Date.now() < deadline) {
    currentText = (await readActiveTerminal(driver))?.text ?? "";
    if (currentText.includes(expectedText)) return;
    await sleep(200);
  }
  throw new Error(`Terminal text did not contain ${expectedText}: ${currentText}`);
}

async function waitForTerminalMatch(
  driver: WebDriver,
  expectedPattern: RegExp,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let currentText = "";
  while (Date.now() < deadline) {
    currentText = (await readActiveTerminal(driver))?.text ?? "";
    if (expectedPattern.test(currentText)) return;
    await sleep(200);
  }
  throw new Error(`Terminal text did not match ${expectedPattern}: ${currentText}`);
}

async function exitCodexAndAssertNoDeviceAttributesEcho(driver: WebDriver): Promise<void> {
  await focusActiveTerminal(driver);
  await driver.actions().keyDown(Key.CONTROL).sendKeys("u").keyUp(Key.CONTROL).perform();
  await driver.actions().keyDown(Key.CONTROL).sendKeys("c").keyUp(Key.CONTROL).perform();
  await sleep(500);
  await driver.actions().keyDown(Key.CONTROL).sendKeys("c").keyUp(Key.CONTROL).perform();
  await driver.wait(async () => (await readActiveTerminal(driver))?.isAlternateScreen === false, 15_000);
  await sleep(1_000);
  const text = (await readActiveTerminal(driver))?.text ?? "";
  if (text.includes("1;2c")) {
    throw new Error(`Exiting Codex echoed a terminal device-attributes reply: ${text}`);
  }
}

async function saveArtifact(driver: WebDriver, name: string): Promise<void> {
  await mkdir(artifactsRoot, { recursive: true });
  const screenshot = await driver.takeScreenshot();
  await writeFile(path.join(artifactsRoot, name), Buffer.from(screenshot, "base64"));
}

async function diagnoseTuiFailure(driver: WebDriver, fixture: TmuxFixture): Promise<void> {
  try {
    const paneState = run("wsl.exe", [
      "--exec",
      "tmux",
      "-L",
      fixture.socketName,
      "list-panes",
      "-a",
      "-F",
      "#{pane_id}|#{pane_current_command}|#{pane_in_mode}|#{alternate_on}|#{mouse_any_flag}|#{mouse_sgr_flag}",
    ]);
    console.error(`  tmux panes: ${paneState}`);
    const paneCapture = run("wsl.exe", [
      "--exec",
      "tmux",
      "-L",
      fixture.socketName,
      "capture-pane",
      "-p",
      "-e",
      "-N",
      "-t",
      `${fixture.sessionName}:0.0`,
    ]);
    await writeFile(
      path.join(artifactsRoot, `${fixture.name}-${testId}-tmux.txt`),
      paneCapture,
    );
    console.error(`  tmux capture:\n${paneCapture.slice(0, 2000)}`);
    await saveArtifact(driver, `${fixture.name}-${testId}-failure.png`);
  } catch (error) {
    console.error(`  failed to collect tmux diagnostics: ${String(error)}`);
  }
}

function findExecutableByName(directory: string, fileName: string): string | null {
  const pending = [directory];
  const matches: Array<{ path: string; modifiedAt: number }> = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
        matches.push({ path: entryPath, modifiedAt: statSync(entryPath).mtimeMs });
      }
      if (entry.isDirectory()) pending.push(entryPath);
    }
  }
  return matches.sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.path ?? null;
}

function resolveCodexExecutable(): string {
  const candidate = path.join(
    process.env.APPDATA ?? "",
    "npm",
    "node_modules",
    "@openai",
    "codex",
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "vendor",
    "x86_64-pc-windows-msvc",
    "bin",
    "codex.exe",
  );
  execFileSync(candidate, ["--version"], { encoding: "utf8", windowsHide: true });
  return candidate;
}

function resolveOpenCodeExecutable(): string {
  execFileSync(
    process.env.ComSpec ?? "cmd.exe",
    ["/d", "/s", "/c", "npx --yes opencode-ai@1.19.5 --version"],
    {
      cwd: projectRoot,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  const npxRoot = path.join(process.env.LOCALAPPDATA ?? "", "npm-cache", "_npx");
  const executable = findExecutableByName(npxRoot, "opencode.exe");
  if (!executable) throw new Error("OpenCode executable was not found after npx installation");
  return executable;
}

function resolveWslPath(windowsPath: string): string {
  return run("wsl.exe", ["--exec", "wslpath", "-u", windowsPath]).trim();
}

function startTmuxFixture(name: "codex" | "opencode", executablePath: string): TmuxFixture {
  const executableInWsl = resolveWslPath(executablePath);
  const fixture = {
    name,
    socketName: `xsterm-e2e-${testId}-${name}`,
    sessionName: `session-${testId}-${name}`,
    configName: `e2e-${name}-${testId}`,
    ...(name === "codex" ? { startCommand: executableInWsl } : {}),
  };
  const script = [
    `tmux -L '${fixture.socketName}' kill-server >/dev/null 2>&1 || true`,
    name === "codex"
      ? `tmux -L '${fixture.socketName}' new-session -d -s '${fixture.sessionName}' "cd /tmp && exec bash -i"`
      : `tmux -L '${fixture.socketName}' new-session -d -s '${fixture.sessionName}' "cd /tmp && exec '${executableInWsl}'"`,
  ].join("\n");
  run("wsl.exe", ["--exec", "bash", "-lc", script], {
    env: { ...process.env, TERM: "xterm-256color" },
  });
  tmuxFixtures.push(fixture);
  return fixture;
}

async function startProbeTmuxFixture(): Promise<TmuxFixture> {
  const fixture: TmuxFixture = {
    name: "probe",
    socketName: `xsterm-e2e-${testId}-probe`,
    sessionName: `session-${testId}-probe`,
    configName: `e2e-probe-${testId}`,
  };
  await mkdir(cacheRoot, { recursive: true });
  const scriptPath = path.join(cacheRoot, `probe-${testId}.py`);
  await writeFile(
    scriptPath,
    [
      "import os",
      "import re",
      "import sys",
      "import termios",
      "import tty",
      "",
      "fd = sys.stdin.fileno()",
      "old_settings = termios.tcgetattr(fd)",
      "try:",
      "    tty.setraw(fd)",
      '    sys.stdout.write("\\x1b[?1049h\\x1b[?1003h\\x1b[?1006h\\x1b[2J\\x1b[H")',
      '    sys.stdout.write("XSTERM_INPUT_PROBE_READY\\r\\nSPACE_EVENTS=0\\r\\nMOUSE_EVENTS=0")',
      "    sys.stdout.flush()",
      "    space_count = 0",
      "    mouse_count = 0",
      "    while True:",
      "        chunk = os.read(fd, 1024)",
      "        has_update = False",
      '        if b" " in chunk:',
      "            space_count += 1",
      "            has_update = True",
      '        mouse_count += len(re.findall(rb"\\x1b\\[<(?:64|65|66|67);", chunk))',
      "        if mouse_count:",
      "            has_update = True",
      "        if has_update:",
      '            sys.stdout.write(f"\\x1b[2;1H\\x1b[2KSPACE_EVENTS={space_count}\\r\\nMOUSE_EVENTS={mouse_count}\\x1b[4;1H")',
      "            sys.stdout.flush()",
      "except OSError:",
      "    pass",
      "finally:",
      "    termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)",
      "",
    ].join("\n"),
  );
  const executableInWsl = resolveWslPath(scriptPath);
  const script = [
    `tmux -L '${fixture.socketName}' kill-server >/dev/null 2>&1 || true`,
    `tmux -L '${fixture.socketName}' new-session -d -s '${fixture.sessionName}' "cd /tmp && exec python3 '${executableInWsl}'"`,
  ].join("\n");
  run("wsl.exe", ["--exec", "bash", "-lc", script], {
    env: { ...process.env, TERM: "xterm-256color" },
  });
  tmuxFixtures.push(fixture);
  return fixture;
}

function startShellTmuxFixture(): TmuxFixture {
  const fixture: TmuxFixture = {
    name: "shell",
    socketName: `xsterm-e2e-${testId}-shell`,
    sessionName: `session-${testId}-shell`,
    configName: `e2e-shell-${testId}`,
  };
  const script = [
    `tmux -L '${fixture.socketName}' kill-server >/dev/null 2>&1 || true`,
    `tmux -L '${fixture.socketName}' new-session -d -s '${fixture.sessionName}' "cd /tmp && exec bash -i"`,
  ].join("\n");
  run("wsl.exe", ["--exec", "bash", "-lc", script], {
    env: { ...process.env, TERM: "xterm-256color" },
  });
  tmuxFixtures.push(fixture);
  return fixture;
}

async function testTui(driver: WebDriver, fixture: TmuxFixture): Promise<void> {
  console.log(`\n[${fixture.name}] ${fixture.sessionName}`);
  await attachTmuxSession(driver, fixture);
  if (fixture.startCommand) {
    await waitForElement(driver, ".xterm", 30_000);
    await typeCommandInActiveTerminal(driver, `'${fixture.startCommand}'`);
  }
  if (fixture.name === "shell") {
    await waitForElement(driver, ".xterm", 30_000);
    await typeCommandInActiveTerminal(driver, "printf 'XSTERM SPACE OK\\n'");
    await waitForTerminalText(driver, "XSTERM SPACE OK");
    console.log("  WSL tmux shell rendered spaced command output");
    await assertTmuxPassthroughDaReplyIsNotEchoed(driver);
    console.log("  tmux passthrough device-attributes query left no characters");
    await assertSingleTmuxInstance(driver, fixture);
    await detachThroughManager(driver, fixture);
    return;
  }
  let initial: TerminalSnapshot;
  try {
    initial = await waitForTuiRestored(driver, fixture);
  } catch (error) {
    await diagnoseTuiFailure(driver, fixture);
    throw error;
  }
  console.log(
    `  restored: alternate=${initial.isAlternateScreen} mouse=${initial.hasMouseMode} chars=${initial.text.trim().length}`,
  );

  if (fixture.name === "probe") {
    await typeSpaceInActiveTerminal(driver);
    await waitForTerminalText(driver, "SPACE_EVENTS=1");
    console.log("  WebView space input reached the WSL tmux pane");
  }

  await assertSingleTmuxInstance(driver, fixture);
  await detachThroughManager(driver, fixture);
  console.log("  detach removed tmux terminal from WebView");

  await reconnectThroughSavedConfig(driver, fixture);
  let reconnected: TerminalSnapshot;
  try {
    reconnected = await waitForTuiRestored(driver, fixture);
  } catch (error) {
    await diagnoseTuiFailure(driver, fixture);
    throw error;
  }
  console.log(
    `  reconnected: alternate=${reconnected.isAlternateScreen} mouse=${reconnected.hasMouseMode} chars=${reconnected.text.trim().length}`,
  );

  if (fixture.name === "probe") {
    await typeSpaceInActiveTerminal(driver);
    try {
      await waitForTerminalText(driver, "SPACE_EVENTS=2");
    } catch (error) {
      await diagnoseTuiFailure(driver, fixture);
      throw error;
    }
    console.log("  WebView space input reached the WSL tmux pane after reconnect");
  } else {
    const inputProbe = process.env.XSTERM_E2E_INPUT ?? `space ${fixture.name}`;
    await typeInActiveTerminal(driver, inputProbe);
    try {
      await waitForTerminalText(driver, inputProbe);
    } catch (error) {
      await diagnoseTuiFailure(driver, fixture);
      throw error;
    }
    console.log(`  WebView input "${inputProbe}" reached the real TUI`);
  }

  await sendWheelToTerminal(driver);
  if (fixture.name === "probe") {
    try {
      await waitForTerminalMatch(driver, /MOUSE_EVENTS=[1-9]\d*/);
    } catch (error) {
      await diagnoseTuiFailure(driver, fixture);
      throw error;
    }
    console.log("  WebView mouse wheel reached the WSL tmux pane after reconnect");
  } else {
    const afterWheel = await waitForTuiRestored(driver, fixture);
    if (!afterWheel.hasMouseMode) {
      throw new Error("Mouse tracking mode disappeared after wheel input");
    }
  }

  await saveArtifact(driver, `${fixture.name}-${testId}.png`);

  if (fixture.name === "codex") {
    await exitCodexAndAssertNoDeviceAttributesEcho(driver);
    console.log("  Codex exited without echoing terminal device-attributes");
  }

  if (fixture.name === "probe") {
    await disconnectTmuxServer(driver, fixture);
    console.log("  tmux Manager cleared its connected state after server loss");
    return;
  }

  await detachThroughManager(driver, fixture);
}

async function cleanupFixtures(): Promise<void> {
  for (const fixture of tmuxFixtures.reverse()) {
    try {
      run("wsl.exe", ["--exec", "tmux", "-L", fixture.socketName, "kill-server"]);
    } catch {
      // Best-effort cleanup.
    }
  }
}

async function main(): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("This E2E test must run from Windows Node so tauri-driver can launch WebView2");
  }

  let driver: WebDriver | null = null;
  const fixtures: TmuxFixture[] = [];
  try {
    await mkdir(artifactsRoot, { recursive: true });
    await ensureVite();
    await buildApplication();
    const nativeDriverPath = await ensureEdgeDriver();

    const requestedTuis = (process.env.XSTERM_E2E_TUIS ?? "codex,opencode")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    for (const name of requestedTuis) {
      try {
        if (name === "codex") fixtures.push(startTmuxFixture("codex", resolveCodexExecutable()));
        else if (name === "opencode")
          fixtures.push(startTmuxFixture("opencode", resolveOpenCodeExecutable()));
        else if (name === "probe") fixtures.push(await startProbeTmuxFixture());
        else if (name === "shell") fixtures.push(startShellTmuxFixture());
        else throw new Error(`Unknown XSTERM_E2E_TUIS value: ${name}`);
      } catch (error) {
        console.warn(`  skip ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (fixtures.length === 0) {
      throw new Error("No requested real TUI executable is available");
    }

    await startWebdriver(nativeDriverPath);
    driver = await createDriver();
    await waitForElement(driver, ".shell-root", 30_000);
    await cleanupE2eConfigs(driver);
    await createSavedBaseConfig(driver);
    for (const fixture of fixtures) {
      await testTui(driver, fixture);
    }
    console.log(`\nE2E passed for: ${fixtures.map((fixture) => fixture.name).join(", ")}`);
  } finally {
    if (driver) {
      await cleanupE2eConfigs(driver).catch((error) => {
        console.warn(`  failed to clean E2E configs: ${String(error)}`);
      });
    }
    await driver?.quit().catch(() => {});
    await cleanupFixtures();
    for (const managed of managedProcesses.reverse()) {
      await stopProcessTree(managed);
    }
  }
}

main().catch((error) => {
  console.error("\nE2E failed:", error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
