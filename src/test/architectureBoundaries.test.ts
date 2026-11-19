import { describe, expect, it } from "vitest";

const sourceFiles = import.meta.glob("/src/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const importPattern = /(?:from\s+|import\s*)["']([^"']+)["']/g;
const featurePattern = /^\/src\/features\/([^/]+)(?:\/(.*))?$/;

interface ImportEdge {
  sourcePath: string;
  specifier: string;
  targetPath: string | null;
}

function normalizeTargetPath(sourcePath: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const sourceDirectory = sourcePath.slice(0, sourcePath.lastIndexOf("/"));
  const resolved = normalizePath(`${sourceDirectory}/${specifier}`);
  return resolved.replace(/\/index(?:\.[cm]?[jt]sx?)?$/, "");
}

function normalizePath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

function collectImportEdges(): ImportEdge[] {
  const edges: ImportEdge[] = [];
  for (const [sourcePath, source] of Object.entries(sourceFiles)) {
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      edges.push({
        sourcePath,
        specifier,
        targetPath: normalizeTargetPath(sourcePath, specifier),
      });
    }
  }
  return edges;
}

function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function featureOf(path: string): { feature: string; subpath: string } | null {
  const match = path.match(featurePattern);
  if (!match) return null;
  return { feature: match[1], subpath: match[2] ?? "" };
}

function formatViolation(edge: ImportEdge, message: string): string {
  return `${edge.sourcePath}: ${edge.specifier} (${message})`;
}

describe("architecture boundaries", () => {
  const importEdges = collectImportEdges();

  it("keeps app imports on feature root entrypoints", () => {
    const violations = importEdges.flatMap((edge) => {
      if (!edge.sourcePath.startsWith("/src/app/") || !edge.targetPath) return [];
      const target = featureOf(edge.targetPath);
      if (!target || target.subpath === "") return [];
      return [formatViolation(edge, "app must import features through their root index")];
    });

    expect(violations).toEqual([]);
  });

  it("keeps cross-feature imports on public root entrypoints", () => {
    const violations = importEdges.flatMap((edge) => {
      if (!edge.targetPath) return [];
      const source = featureOf(edge.sourcePath);
      const target = featureOf(edge.targetPath);
      if (!source || !target || source.feature === target.feature) return [];
      if (target.subpath === "") return [];
      return [
        formatViolation(
          edge,
          `feature "${source.feature}" must import feature "${target.feature}" through its root index`,
        ),
      ];
    });

    expect(violations).toEqual([]);
  });

  it("keeps feature internals from importing their own root barrel", () => {
    const violations = importEdges.flatMap((edge) => {
      if (!edge.targetPath) return [];
      const source = featureOf(edge.sourcePath);
      const target = featureOf(edge.targetPath);
      if (!source || !target || source.feature !== target.feature || target.subpath !== "") {
        return [];
      }
      if (edge.sourcePath === `/src/features/${source.feature}/index.ts`) return [];
      return [
        formatViolation(edge, "feature internals must import concrete local modules directly"),
      ];
    });

    expect(violations).toEqual([]);
  });

  it("keeps models independent from upper layers and runtime APIs", () => {
    const violations = importEdges.flatMap((edge) => {
      if (!edge.sourcePath.startsWith("/src/models/")) return [];
      const importsRuntime =
        edge.specifier === "react" ||
        edge.specifier === "react-dom" ||
        edge.specifier.startsWith("@tauri-apps/");
      const importsUpperLayer =
        edge.targetPath !== null &&
        ["/src/app", "/src/features", "/src/infra", "/src/shared"].some((root) =>
          isWithin(edge.targetPath!, root),
        );
      if (!importsRuntime && !importsUpperLayer) return [];
      return [formatViolation(edge, "models must remain independent from upper layers")];
    });

    expect(violations).toEqual([]);
  });

  it("keeps shared and infra independent from upper layers", () => {
    const violations = importEdges.flatMap((edge) => {
      if (!edge.targetPath) return [];
      const isShared = edge.sourcePath.startsWith("/src/shared/");
      const isInfra = edge.sourcePath.startsWith("/src/infra/");
      if (!isShared && !isInfra) return [];
      const forbiddenRoots = isShared
        ? ["/src/app", "/src/features", "/src/models", "/src/infra"]
        : ["/src/app", "/src/features", "/src/models"];
      if (!forbiddenRoots.some((root) => isWithin(edge.targetPath!, root))) return [];
      return [
        formatViolation(
          edge,
          `${isShared ? "shared" : "infra"} must not import upper-layer modules`,
        ),
      ];
    });

    expect(violations).toEqual([]);
  });

  it("keeps raw Tauri APIs inside infrastructure adapters", () => {
    const violations = importEdges.flatMap((edge) => {
      const isUiOrApplication =
        (edge.sourcePath.startsWith("/src/app/") ||
          edge.sourcePath.startsWith("/src/features/")) &&
        !edge.sourcePath.includes("/infrastructure/");
      if (!isUiOrApplication) return [];
      const importsRawTauri =
        edge.specifier === "@tauri-apps/api/core" ||
        edge.specifier === "@tauri-apps/api/event" ||
        edge.specifier === "@tauri-apps/api/window" ||
        edge.specifier.startsWith("@tauri-apps/plugin-");
      if (!importsRawTauri) return [];
      return [formatViolation(edge, "raw Tauri APIs must stay in infrastructure adapters")];
    });

    expect(violations).toEqual([]);
  });

  it("keeps tmux runtime metadata nested in the terminal model", () => {
    const contract = sourceFiles["/src/features/terminal/contracts.ts"] ?? "";
    expect(contract).not.toMatch(
      /\btmux(?:PaneId|SessionId|WindowId|SessionName|WindowName|WindowIndex|PaneIndex|PaneWidth|PaneHeight|PaneCommand|PaneActive)\??:/,
    );
  });

  it("does not reintroduce a public aggregate session action type", () => {
    const violations = Object.entries(sourceFiles)
      .filter(([, source]) => /\bSessionActions\b/.test(source))
      .map(([path]) => path);
    expect(violations).toEqual([]);
  });

  it("keeps terminal-surface independent from runtime action implementations", () => {
    const forbidden = [
      "useTerminalRuntime",
      "useTmuxRuntime",
      "terminalSessionActions",
      "terminalStreamActions",
      "tmuxControllerActions",
    ];
    const violations = Object.entries(sourceFiles).flatMap(([path, source]) => {
      if (!path.startsWith("/src/features/terminal-surface/")) return [];
      return forbidden
        .filter((symbol) => new RegExp(`\\b${symbol}\\b`).test(source))
        .map((symbol) => `${path}: ${symbol}`);
    });
    expect(violations).toEqual([]);
  });

  it("keeps SSH wire snake_case outside domain and UI layers", () => {
    const allowedPaths = [
      "/src/features/terminal-stream/application/configWireMappers.ts",
      "/src/features/terminal-stream/infrastructure/tauriContracts.ts",
      "/src/features/launch-config/persistence/launchConfigStorage.ts",
    ];
    const violations = Object.entries(sourceFiles).flatMap(([path, source]) => {
      if (path.includes(".test.") || allowedPaths.includes(path)) return [];
      return /\b(?:auth_type|key_file)\b/.test(source) ? [path] : [];
    });
    expect(violations).toEqual([]);
  });
});
