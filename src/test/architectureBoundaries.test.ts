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

function collectProductionFeatureEdges(edges: readonly ImportEdge[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.sourcePath.includes(".test.") || !edge.targetPath) continue;
    const source = featureOf(edge.sourcePath);
    const target = featureOf(edge.targetPath);
    if (!source || !target || source.feature === target.feature) continue;
    const targets = graph.get(source.feature) ?? new Set<string>();
    targets.add(target.feature);
    graph.set(source.feature, targets);
  }
  return graph;
}

function findFeatureCycles(graph: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seen = new Set<string>();

  const visit = (feature: string) => {
    state.set(feature, "visiting");
    stack.push(feature);
    for (const target of graph.get(feature) ?? []) {
      if (state.get(target) === "visiting") {
        const cycle = [...stack.slice(stack.indexOf(target)), target];
        const key = [...cycle].sort().join("|");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else if (state.get(target) !== "visited") {
        visit(target);
      }
    }
    stack.pop();
    state.set(feature, "visited");
  };

  for (const feature of graph.keys()) {
    if (state.get(feature) === undefined) visit(feature);
  }
  return cycles;
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
      if (
        edge.sourcePath.includes("/infrastructure/") &&
        target.feature === "terminal-stream" &&
        target.subpath === "adapterContracts"
      ) {
        return [];
      }
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

  it("keeps production feature dependencies acyclic", () => {
    const graph = collectProductionFeatureEdges(importEdges);
    expect(findFeatureCycles(graph)).toEqual([]);
  });

  it("keeps workspace and tmux independent from each other", () => {
    const violations = importEdges.flatMap((edge) => {
      if (edge.sourcePath.includes(".test.") || !edge.targetPath) return [];
      const source = featureOf(edge.sourcePath);
      const target = featureOf(edge.targetPath);
      if (!source || !target) return [];
      const crossesBoundary =
        (source.feature === "workspace" && target.feature === "tmux") ||
        (source.feature === "tmux" && target.feature === "workspace");
      return crossesBoundary
        ? [formatViolation(edge, "workspace and tmux must not depend on each other")]
        : [];
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

  it("uses branded ids in core terminal and workspace contracts", () => {
    const terminal = sourceFiles["/src/features/terminal/contracts.ts"] ?? "";
    const workspace = sourceFiles["/src/features/workspace/contracts/model.ts"] ?? "";
    const paneOps =
      sourceFiles["/src/features/workspace/application/paneTreeOperations.ts"] ?? "";

    expect(terminal).toMatch(/\bid: TerminalId;/);
    expect(workspace).toMatch(/\bid: WorkspaceId;/);
    expect(workspace).toMatch(/\bid: WindowId;/);
    expect(workspace).toMatch(/\bid: PaneId;/);
    expect(workspace).toMatch(/SavedWindowConfig[\s\S]*id: LaunchConfigId;/);
    expect(workspace).toMatch(/SavedWorkspace[\s\S]*id: LaunchConfigId;/);
    expect(paneOps).toMatch(/function generatePaneId\(\): PaneId/);
    expect(paneOps).toMatch(/function generateWindowId\(\): WindowId/);
    expect(paneOps).toMatch(/function generateWorkspaceId\(\): WorkspaceId/);
  });

  it("keeps tmux window commands out of the workspace pane-intent contract", () => {
    const contract = sourceFiles["/src/features/workspace/contracts/paneIntents.ts"] ?? "";
    expect(contract).not.toMatch(/\btmux\b/i);
  });

  it("keeps terminal creation out of the workspace pane-intent contract", () => {
    const contract = sourceFiles["/src/features/workspace/contracts/paneIntents.ts"] ?? "";
    expect(contract).not.toMatch(/launch-config|SavedConfig|create(?:Local|Ssh)Terminal/);

    const sessionContract =
      sourceFiles["/src/features/workspace/contracts/paneSessionIntents.ts"] ?? "";
    expect(sessionContract).toMatch(/interface PaneSessionIntentActions/);
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

  it("keeps the tmux event bridge limited to subscription lifecycle", () => {
    const source = sourceFiles["/src/app/application/session/useTmuxEventBridge.ts"] ?? "";
    expect(source).not.toMatch(/on(?:ControllerExited|PaneAdded|PaneRemoved|WindowAdded|WindowClosed|LayoutChanged)/);
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

  it("keeps feature root exports explicit", () => {
    const violations = Object.entries(sourceFiles).flatMap(([path, source]) => {
      if (!/^\/src\/features\/[^/]+\/index\.ts$/.test(path)) return [];
      return source.includes("export *") ? [path] : [];
    });
    expect(violations).toEqual([]);
  });

  it("does not expose terminal-stream adapter contracts from its root", () => {
    const root = sourceFiles["/src/features/terminal-stream/index.ts"] ?? "";
    expect(root).not.toMatch(
      /adapterContracts|BackendTerminalHandle|\b(?:SshConfigDto|TerminalInfoDto|TerminalKindDto|TerminalCapabilitiesDto)\b/,
    );
  });
});
