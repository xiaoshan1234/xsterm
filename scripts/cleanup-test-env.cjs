#!/usr/bin/env node

const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const normalizedProjectRoot = projectRoot.toLowerCase();
const isDryRun = process.argv.includes("--dry-run");
const testPorts = new Set([1420, 4444, 4454, 4455]);
const currentProcessId = process.pid;

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
}

function getProcesses() {
  const output = run("powershell.exe", [
    "-NoProfile",
    "-Command",
    [
      "$items = Get-CimInstance Win32_Process | Select-Object",
      "ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine;",
      "$items | ConvertTo-Json -Compress",
    ].join(" "),
  ]);
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function getListeningProcessIds() {
  const output = run("netstat.exe", ["-ano", "-p", "tcp"]);
  const processIds = new Set();
  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 5 || fields[3] !== "LISTENING") continue;
    const localAddress = fields[1];
    const port = Number(localAddress.slice(localAddress.lastIndexOf(":") + 1));
    if (!testPorts.has(port)) continue;
    const processId = Number(fields[4]);
    if (Number.isInteger(processId) && processId > 0) processIds.add(processId);
  }
  return processIds;
}

function processText(processInfo) {
  return `${processInfo.ExecutablePath ?? ""} ${processInfo.CommandLine ?? ""}`.toLowerCase();
}

function isProjectOwned(processInfo) {
  return processText(processInfo).includes(normalizedProjectRoot);
}

function isTestDriver(processInfo) {
  const name = (processInfo.Name ?? "").toLowerCase();
  return ["tauri-driver.exe", "msedgedriver.exe", "chromedriver.exe"].includes(name);
}

function isDevWrapper(processInfo) {
  const name = (processInfo.Name ?? "").toLowerCase();
  if (!["node.exe", "cmd.exe", "powershell.exe"].includes(name)) return false;
  const command = (processInfo.CommandLine ?? "").toLowerCase();
  return (
    command.includes("npm-cli.js") && command.includes("run dev") ||
    command.includes("npm.cmd") && command.includes("run dev") ||
    command.includes("/d /s /c vite") ||
    command.includes("run --no-default-features") ||
    command.includes("tauri dev")
  );
}

function addAncestors(targetIds, processById, processInfo) {
  let parentId = processInfo.ParentProcessId;
  for (let depth = 0; depth < 5 && parentId; depth++) {
    const parent = processById.get(parentId);
    if (!parent || !isDevWrapper(parent)) break;
    targetIds.add(parent.ProcessId);
    parentId = parent.ParentProcessId;
  }
}

function removeFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) return false;
  if (!isDryRun) fs.rmSync(filePath, { force: true });
  return true;
}

function cleanupWslTestSessions() {
  const shellScript = [
    "uid=$(id -u)",
    'for socket in /tmp/tmux-"$uid"/*',
    "do",
    '  [ -S "$socket" ] || continue',
    '  name=${socket##*/}',
    '  case "$name" in',
    "    xsterm-e2e-*|xsterm-debug|xsterm-probe|xsterm-control-probe|xsterm-codex-control)",
    '      tmux -S "$socket" kill-server >/dev/null 2>&1 || true',
    "      ;;",
    "  esac",
    "done",
  ].join("\n");
  if (isDryRun) {
    console.log("[dry-run] clean WSL xsterm test tmux sockets");
    return;
  }
  spawnSync("wsl.exe", ["--exec", "bash", "-lc", shellScript], {
    stdio: "ignore",
    windowsHide: true,
  });
}

function main() {
  console.log(`xsterm test cleanup${isDryRun ? " (dry run)" : ""}`);
  console.log(`project: ${projectRoot}`);

  const processes = getProcesses().filter((item) => item && item.ProcessId);
  const processById = new Map(processes.map((item) => [item.ProcessId, item]));
  const listeningProcessIds = getListeningProcessIds();
  const targetIds = new Set();

  for (const processInfo of processes) {
    if (processInfo.ProcessId === currentProcessId) continue;
    const isRelevantProjectProcess =
      isProjectOwned(processInfo) &&
      (/vite(?:\.js)?/i.test(processInfo.CommandLine ?? "") ||
        /target[\\/]+debug[\\/]+xsterm\.exe/i.test(processInfo.CommandLine ?? "") ||
        /test[\\/]+e2e/i.test(processInfo.CommandLine ?? ""));
    const isTestDriverProcess =
      isTestDriver(processInfo) &&
      /--(?:native-)?port(?:=|\s+)(?:4444|4454|4455)\b/i.test(processInfo.CommandLine ?? "");
    const ownsTestPort = listeningProcessIds.has(processInfo.ProcessId);
    if (
      isRelevantProjectProcess ||
      isTestDriverProcess ||
      (ownsTestPort && isTestDriver(processInfo))
    ) {
      targetIds.add(processInfo.ProcessId);
      addAncestors(targetIds, processById, processInfo);
    }
  }

  const targets = [...targetIds]
    .map((processId) => processById.get(processId))
    .filter(Boolean)
    .sort((left, right) => left.ProcessId - right.ProcessId);

  if (targets.length === 0) {
    console.log("No project-related residual processes found.");
  }

  for (const processInfo of targets) {
    const commandLine = (processInfo.CommandLine ?? "").trim();
    console.log(
      `${isDryRun ? "[dry-run] kill" : "kill"} ${processInfo.ProcessId} ${processInfo.Name}: ${commandLine}`,
    );
    if (isDryRun) continue;
    spawnSync("taskkill.exe", ["/F", "/T", "/PID", String(processInfo.ProcessId)], {
      stdio: "ignore",
      windowsHide: true,
    });
  }

  const markerPath = path.join(
    process.env.USERPROFILE ?? "",
    ".cargo",
    "bin",
    "tmux.exe.xsterm-e2e",
  );
  const shimPath = markerPath.slice(0, -".xsterm-e2e".length);
  if (fs.existsSync(markerPath)) {
    console.log(`${isDryRun ? "[dry-run] remove" : "remove"} ${shimPath}`);
    removeFileIfExists(shimPath);
    removeFileIfExists(markerPath);
  }

  const debugShimPath = path.join(projectRoot, "src-tauri", "target", "debug", "tmux.exe");
  if (removeFileIfExists(debugShimPath)) {
    console.log(`${isDryRun ? "[dry-run] remove" : "remove"} ${debugShimPath}`);
  }

  cleanupWslTestSessions();

  if (!isDryRun) {
    const remaining = getListeningProcessIds();
    if (remaining.size > 0) {
      console.error(`Ports still occupied after cleanup: ${[...testPorts].join(", ")}`);
      process.exitCode = 1;
    } else {
      console.log("Test ports 1420, 4444, 4454 and 4455 are free.");
    }
  }
}

main();
