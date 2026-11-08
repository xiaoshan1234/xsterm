import { type Store } from "@tauri-apps/plugin-store";
import { describe, expect, it } from "vitest";
import { type JsonStoreLoader, JsonStore } from "./jsonStore";

function createFakeStore() {
  const values = new Map<string, unknown>();
  let saveCount = 0;
  const store = {
    async get<Value>(key: string): Promise<Value | undefined> {
      return values.get(key) as Value | undefined;
    },
    async set(key: string, value: unknown): Promise<void> {
      values.set(key, value);
    },
    async delete(key: string): Promise<boolean> {
      return values.delete(key);
    },
    async save(): Promise<void> {
      saveCount += 1;
    },
    getSaveCount(): number {
      return saveCount;
    },
  };
  return store;
}

function createLoader(store: ReturnType<typeof createFakeStore>): JsonStoreLoader {
  return async () => store as unknown as Store;
}

describe("JsonStore", () => {
  it("persists generic values and serializes updates", async () => {
    const fakeStore = createFakeStore();
    const jsonStore = new JsonStore("settings.json", {
      loader: createLoader(fakeStore),
    });

    await jsonStore.set("theme", "dark");
    const updated = await jsonStore.update<string[]>("recent", (current) => [
      ...(current ?? []),
      "workspace-1",
    ]);

    expect(await jsonStore.get("theme")).toBe("dark");
    expect(updated).toEqual(["workspace-1"]);
    expect(await jsonStore.get("recent")).toEqual(["workspace-1"]);
    expect(fakeStore.getSaveCount()).toBe(2);
  });

  it("deletes keys and can defer an explicit save", async () => {
    const fakeStore = createFakeStore();
    const jsonStore = new JsonStore("settings.json", {
      loader: createLoader(fakeStore),
    });

    await jsonStore.set("temporary", true, false);
    await jsonStore.delete("temporary", false);

    expect(await jsonStore.get("temporary")).toBeUndefined();
    expect(fakeStore.getSaveCount()).toBe(0);
  });
});
