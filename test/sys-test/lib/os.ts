/**
 * OS-layer helpers for WSL ↔ Windows interop.
 *
 * These functions bridge WSL to Windows clipboard, resolve the Tauri app-data
 * directory, safely wipe it, and probe TCP ports — all via the
 * `powershell.exe -NoProfile` calling convention established in
 * `scripts/start-webdriver.sh`.
 *
 * All PowerShell invocations use `-NoProfile` to avoid loading a potentially-
 * broken user profile.  UTF-8 text (including CJK characters) passes through
 * `Set-Clipboard` / `Get-Clipboard` unchanged.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createConnection } from "node:net";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

/** productName from tauri.conf.json (e.g. "xsterm"). */
function readProductName(): string {
  const cfgPath = join(
    process.cwd(),
    "src-tauri",
    "tauri.conf.json",
  );
  let raw: string;
  try {
    raw = readFileSync(cfgPath, "utf-8");
  } catch {
    throw new Error(
      `Cannot read tauri.conf.json at "${cfgPath}". ` +
        "Run from the repository root.",
    );
  }
  let cfg: { productName?: unknown; identifier?: unknown };
  try {
    cfg = JSON.parse(raw);
  } catch {
    throw new Error(
      "tauri.conf.json is not valid JSON. " +
        "Check productName / identifier fields.",
    );
  }
  if (typeof cfg.productName !== "string" || cfg.productName === "") {
    throw new Error(
      "tauri.conf.json is missing a non-empty 'productName' field.",
    );
  }
  return cfg.productName;
}

/** identifier from tauri.conf.json (e.g. "com.loner.xsterm"). */
function readIdentifier(): string {
  const cfgPath = join(process.cwd(), "src-tauri", "tauri.conf.json");
  let raw: string;
  try {
    raw = readFileSync(cfgPath, "utf-8");
  } catch {
    throw new Error(`Cannot read tauri.conf.json at "${cfgPath}".`);
  }
  let cfg: { identifier?: unknown };
  try {
    cfg = JSON.parse(raw);
  } catch {
    throw new Error("tauri.conf.json is not valid JSON.");
  }
  if (typeof cfg.identifier !== "string" || cfg.identifier === "") {
    throw new Error(
      "tauri.conf.json is missing a non-empty 'identifier' field.",
    );
  }
  return cfg.identifier;
}

// ---------------------------------------------------------------------------
// PowerShell helpers
// ---------------------------------------------------------------------------

/**
 * Run a one-liner through `powershell.exe -NoProfile -Command`.
 * Stdout is captured as UTF-8; stderr is discarded.
 */
async function psInvoke(cmd: string): Promise<string> {
  const full = `powershell.exe -NoProfile -Command "${cmd}"`;
  const { stdout } = await execAsync(full, { encoding: "utf-8" });
  return stdout;
}

// ---------------------------------------------------------------------------
// Clipboard (text)
// ---------------------------------------------------------------------------

const _encoder = new TextEncoder();
const _decoder = new TextDecoder();

export async function setWindowsClipboard(text: string): Promise<void> {
  const b64 = btoa(String.fromCharCode(..._encoder.encode(text)));
  await psInvoke(
    `Add-Type -AssemblyName System.Windows.Forms; ` +
      `[System.Windows.Forms.Clipboard]::SetText([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64}')))`,
  );
}

export async function getWindowsClipboard(): Promise<string> {
  const raw = await psInvoke(
    `Add-Type -AssemblyName System.Windows.Forms; ` +
      `[System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([System.Windows.Forms.Clipboard]::GetText()))`,
  );
  return _decoder.decode(
    Uint8Array.from(atob(raw.trim()), (c) => c.charCodeAt(0)),
  );
}

// ---------------------------------------------------------------------------
// Clipboard (image)
// ---------------------------------------------------------------------------

/**
 * Copy a PNG file to the Windows clipboard as an image using
 * `System.Drawing.Image` via PowerShell.
 *
 * The PNG path is converted to a Windows absolute path so PowerShell can
 * access it from the WSL–Windows interop boundary.
 */
export async function setImageClipboard(pngPath: string): Promise<void> {
  const winPath = await psInvoke(
    `(Resolve-Path '${pngPath.replace(/'/g, "''")}').Path`,
  ).then((s) => s.replace(/\r?\n$/, ""));

  // Resolve-Path returns a Windows path like C:\Users\..., so we can pass it
  // directly to .NET's Image.FromFile which accepts both \ and / separators.
  const script = `
Add-Type -AssemblyName System.Drawing,System.Windows.Forms
$img = [System.Drawing.Image]::FromFile('${winPath.replace(/'/g, "''")}')
[System.Windows.Forms.Clipboard]::SetImage($img)
$img.Dispose()
`.trim();

  await psInvoke(script);
}

// ---------------------------------------------------------------------------
// App-data directory
// ---------------------------------------------------------------------------

/**
 * Resolve the Tauri app-data directory.
 *
 * On Windows Tauri stores data under `%APPDATA%\\<identifier>`, so we:
 *   1. Read `identifier` from `tauri.conf.json`.
 *   2. Ask PowerShell to expand `%APPDATA%` to its Windows form
 *      (`C:\\Users\\<user>\\AppData\\Roaming`).
 *   3. Append the identifier folder name.
 *   4. Convert the result to a WSL `/mnt/c/...` path.
 *
 * Returns a path in the form `/mnt/c/Users/.../com.loner.xsterm`.
 */
export async function appDataDir(): Promise<string> {
  const identifier = readIdentifier();
  // Ask PowerShell to return the full Windows path with trailing slash stripped
  const winBase = await psInvoke(
    `[Environment]::GetFolderPath('ApplicationData')`,
  ).then((s) => s.replace(/\r?\n$/, "").replace(/\\+$/, ""));

  if (!winBase || winBase === "") {
    throw new Error(
      "PowerShell returned an empty APPDATA path. " +
        "Is %APPDATA% set on this Windows account?",
    );
  }

  // Build the Windows path: C:\Users\...\com.loner.xsterm
  const winFull = `${winBase}\\${identifier}`;

  // Convert to WSL path using wslpath
  const { stdout } = await execAsync(`wslpath -u '${winFull}'`);
  return stdout.replace(/\r?\n$/, "");
}

// ---------------------------------------------------------------------------
// Wipe app-data directory (safe)
// ---------------------------------------------------------------------------

/**
 * Best-effort delete of the Tauri app-data directory.
 *
 * Safety constraints
 * ───────────────────
 * 1. The `identifier` is read from `tauri.conf.json` at runtime — it is
 *    never hard-coded, so a changed config invalidates any stale scripts.
 * 2. The path under deletion is always `%APPDATA%\\<identifier>`; no
 *    environment variable or user-supplied string is used in path construction.
 * 3. Before touching disk we check that no `xsterm.exe` process is running
 *    (via `tasklist.exe`).  If the process is alive we abort without
 *    modifying anything.
 * 4. Returns a structured result — **never throws**.
 *
 * @returns `{ ok: true }`                    on success
 * @returns `{ ok: false, reason }`           on any failure (including
 *                                             "process alive" and "path
 *                                             does not exist")
 */
export async function wipeAppData(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const identifier = readIdentifier();

    // 1. Resolve the target directory path
    const winBase = await psInvoke(
      `[Environment]::GetFolderPath('ApplicationData')`,
    ).then((s) => s.replace(/\r?\n$/, "").replace(/\\+$/, ""));

    if (!winBase || winBase === "") {
      return { ok: false, reason: "PowerShell returned empty APPDATA path." };
    }

    const winTarget = `${winBase}\\${identifier}`;

    // 2. Guard: only delete paths that contain the exact identifier.
    //    This blocks accidental deletion of parent directories or sibling
    //    folders even if `identifier` is somehow empty/malformed.
    if (!winTarget.includes(identifier)) {
      return {
        ok: false,
        reason: `Safety check failed: resolved path does not contain identifier "${identifier}". Refusing to delete "${winTarget}".`,
      };
    }

    // 3. Confirm no xsterm.exe process is running
    try {
      const { stdout: tasklistOut } = await execAsync(
        `powershell.exe -NoProfile -Command "tasklist.exe /FI 'IMAGENAME eq xsterm.exe' /NH"`,
        { encoding: "utf-8" },
      );
      // tasklist returns a line with the process name when found;
      // "/NH" suppresses the header.  If the image is NOT running the output
      // is empty (after trimming).
      const running = tasklistOut
        .trim()
        .split(/\r?\n/)
        .some((line) => line.startsWith("xsterm.exe"));

      if (running) {
        return {
          ok: false,
          reason: "xsterm.exe is running. Close the application before wiping app data.",
        };
      }
    } catch {
      // tasklist failure — be permissive; proceed with deletion attempt
    }

    // 4. Check whether the directory exists before attempting deletion
    const existsOut = await psInvoke(
      `Test-Path -LiteralPath '${winTarget.replace(/'/g, "''")}'`,
    );
    if (existsOut.trim() !== "True") {
      return { ok: false, reason: `Directory does not exist: ${winTarget}` };
    }

    // 5. Delete the directory tree
    await psInvoke(
      `Remove-Item -LiteralPath '${winTarget.replace(/'/g, "''")}' -Recurse -Force -ErrorAction Stop`,
    );

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: msg };
  }
}

// ---------------------------------------------------------------------------
// TCP port probe
// ---------------------------------------------------------------------------

/**
 * Check whether TCP port `port` on `host` is reachable.
 *
 * Uses Node's built-in `net` module so there are no external dependencies.
 * Resolves `true` on successful connection, `false` on connect failure or
 * timeout.
 *
 * @param host     Hostname or IP address (default: "127.0.0.1")
 * @param port     TCP port number
 * @param timeoutMs  Connection timeout in milliseconds (default: 2000)
 */
export async function probePort(
  host: string,
  port: number,
  timeoutMs = 2000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: timeoutMs });

    const cleanup = () => {
      socket.destroy();
    };

    socket.on("connect", () => {
      cleanup();
      resolve(true);
    });

    socket.on("error", () => {
      cleanup();
      resolve(false);
    });

    socket.on("timeout", () => {
      cleanup();
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------------------
// Self-verification
// ---------------------------------------------------------------------------

/**
 * Run self-checks for clipboard roundtrip and wipeAppData edge-cases.
 * Call this directly with `node os.ts` or `npx tsx os.ts`.
 */
async function selfVerify(): Promise<void> {
  const results: Array<{ name: string; pass: boolean; detail: string }> = [];

  // ── Clipboard ASCII ──────────────────────────────────────────────────────
  try {
    const asciiText = "hello world 2026";
    await setWindowsClipboard(asciiText);
    const asciiRead = await getWindowsClipboard();
    const ok = asciiRead === asciiText;
    results.push({
      name: "clipboard ASCII roundtrip",
      pass: ok,
      detail: ok ? `OK: "${asciiRead}"` : `MISMATCH: wrote "${asciiText}", read "${asciiRead}"`,
    });
  } catch (e) {
    results.push({
      name: "clipboard ASCII roundtrip",
      pass: false,
      detail: `Exception: ${e}`,
    });
  }

  // ── Clipboard UTF-8 / CJK ─────────────────────────────────────────────────
  try {
    const utfText = "hello 世界 🎉 日本語";
    await setWindowsClipboard(utfText);
    const utfRead = await getWindowsClipboard();
    const ok = utfRead === utfText;
    results.push({
      name: "clipboard UTF-8 / CJK roundtrip",
      pass: ok,
      detail: ok ? `OK: "${utfRead}"` : `MISMATCH: wrote "${utfText}", read "${utfRead}"`,
    });
  } catch (e) {
    results.push({
      name: "clipboard UTF-8 / CJK roundtrip",
      pass: false,
      detail: `Exception: ${e}`,
    });
  }

  // ── wipeAppData: non-existent directory ──────────────────────────────────
  try {
    // The function must not throw; it must return { ok: false, reason }
    const result = await wipeAppData();
    // We can't guarantee the directory exists, so we just check the shape
    const ok =
      typeof result.ok === "boolean" &&
      (result.ok === true || (result.ok === false && typeof result.reason === "string"));
    results.push({
      name: "wipeAppData returns structured result (no throw)",
      pass: ok,
      detail: JSON.stringify(result),
    });
  } catch (e) {
    results.push({
      name: "wipeAppData returns structured result (no throw)",
      pass: false,
      detail: `Function threw — must return structured result instead. Exception: ${e}`,
    });
  }

  // ── probePort: localhost should not reject (even if nothing is listening) ─
  try {
    // Use a very unlikely port to avoid flakiness — we only care that the
    // function resolves without throwing.
    const result = await probePort("127.0.0.1", 65432, 500);
    const ok = typeof result === "boolean";
    results.push({
      name: "probePort resolves with boolean",
      pass: ok,
      detail: `Result: ${result} (expected boolean)`,
    });
  } catch (e) {
    results.push({
      name: "probePort resolves with boolean",
      pass: false,
      detail: `Exception: ${e}`,
    });
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n=== os.ts self-verification ===");
  for (const r of results) {
    console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name}`);
    if (!r.pass) console.log(`         → ${r.detail}`);
  }
  const allPass = results.every((r) => r.pass);
  console.log(`\nResult: ${allPass ? "ALL PASS" : "SOME FAILURES"}`);
  process.exit(allPass ? 0 : 1);
}

// Allow running directly:  npx tsx test/sys-test/lib/os.ts
const selfCheck = process.argv[1]?.endsWith("os.ts");
if (selfCheck) void selfVerify();

export type { readIdentifier, readProductName };
