import { describe, expect, it, vi, beforeEach } from "vitest";

// Stub for `@tauri-apps/plugin-store`'s `load`. Each test calls
// `stubStoreApi.mockResolvedValueOnce(...)` to inject a fresh store.
const stubStoreApi = vi.fn();

vi.mock("@tauri-apps/plugin-store", () => ({
  load: (...args: unknown[]) => stubStoreApi(...args),
}));

vi.mock("../logger/logger", () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}));

interface FakeStore {
  data: Map<string, unknown>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
}

function makeStore(initial: Record<string, unknown> = {}): FakeStore {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    get: vi.fn(async (key: string) => data.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      data.set(key, value);
    }),
    save: vi.fn(async () => {}),
  };
}

beforeEach(async () => {
  stubStoreApi.mockReset();
});

describe("loadSavedConfigs", () => {
  it("reads the savedConfigs key, migrates v0 entries, and returns SavedSessionConfig[]", async () => {
    const store = makeStore({
      savedConfigs: [
        { id: "1", name: "n1", type: "local", localConfig: { shell: "sh" } },
        {
          id: "2",
          name: "n2",
          version: 1,
          type: "ssh",
          config: { host: "h", port: 22, username: "u", auth_type: "password", password: "p" },
        },
      ],
    });
    stubStoreApi.mockResolvedValueOnce(store);

    // Dynamic import: savedConfigs.ts memoises the store at module
    // scope (mirrors legacy sessionStorage.ts); vi.resetModules() in
    // a fresh isolated context per test gives us a clean module
    // instance and re-applies the vi.mock factory automatically.
    vi.resetModules();
    const { loadSavedConfigs } = await import("./savedConfigs");
    const configs = await loadSavedConfigs();
    expect(configs).toHaveLength(2);
    expect(configs[0]).toMatchObject({ id: "1", type: "local", version: 1 });
    expect(configs[1]).toMatchObject({ id: "2", type: "ssh", version: 1 });

    expect(stubStoreApi).toHaveBeenCalledWith("sessions.json", { autoSave: true, defaults: {} });
    expect(store.get).toHaveBeenCalledWith("savedConfigs");
  });

  it("returns [] when no entry exists yet (fresh install)", async () => {
    const store = makeStore({});
    stubStoreApi.mockResolvedValueOnce(store);
    vi.resetModules();
    const { loadSavedConfigs } = await import("./savedConfigs");
    const configs = await loadSavedConfigs();
    expect(configs).toEqual([]);
  });

  it("drops malformed entries (missing type) and returns the survivors", async () => {
    const store = makeStore({
      savedConfigs: [
        { id: "good", name: "g", type: "local", localConfig: { shell: "sh" } },
        { id: "bad", name: "b" },
      ],
    });
    stubStoreApi.mockResolvedValueOnce(store);
    vi.resetModules();
    const { loadSavedConfigs } = await import("./savedConfigs");
    const configs = await loadSavedConfigs();
    expect(configs).toHaveLength(1);
    expect(configs[0].id).toBe("good");
  });

  it("returns [] when load throws (corrupt store / disk error)", async () => {
    stubStoreApi.mockRejectedValueOnce(new Error("disk gone"));
    vi.resetModules();
    const { loadSavedConfigs } = await import("./savedConfigs");
    const configs = await loadSavedConfigs();
    expect(configs).toEqual([]);
  });
});

describe("persistConfigs", () => {
  it("writes the configs and triggers save()", async () => {
    const store = makeStore({});
    stubStoreApi.mockResolvedValueOnce(store);
    vi.resetModules();
    const { persistConfigs } = await import("./savedConfigs");
    const { migrateSavedConfigList } = await import("../../model/entities");

    const cfgs = migrateSavedConfigList([
      {
        id: "c",
        name: "demo",
        version: 1,
        type: "local",
        config: { shell: "sh" },
      },
    ]);
    await persistConfigs(cfgs);

    expect(store.set).toHaveBeenCalledWith("savedConfigs", cfgs);
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it("does not throw when persist fails (best-effort)", async () => {
    stubStoreApi.mockRejectedValueOnce(new Error("write failed"));
    vi.resetModules();
    const { persistConfigs } = await import("./savedConfigs");

    await expect(
      persistConfigs([
        {
          id: "c",
          name: "demo",
          version: 1,
          type: "local",
          config: { shell: "sh" },
        },
      ]),
    ).resolves.toBeUndefined();
  });
});
