import { load, type Store } from "@tauri-apps/plugin-store";

export interface JsonStoreLoadOptions {
  autoSave?: boolean;
  defaults?: Record<string, unknown>;
}

export type JsonStoreLoader = (fileName: string, options: JsonStoreLoadOptions) => Promise<Store>;

export interface JsonStoreOptions {
  autoSave?: boolean;
  defaults?: Record<string, unknown>;
  loader?: JsonStoreLoader;
}

/**
 * Generic JSON-backed configuration store. Schema, validation, and migration
 * stay in the owning feature repository.
 */
export class JsonStore {
  private readonly fileName: string;
  private readonly options: JsonStoreLoadOptions;
  private readonly loader: JsonStoreLoader;
  private storePromise: Promise<Store> | null = null;
  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor(fileName: string, options: JsonStoreOptions = {}) {
    const normalizedFileName = fileName.trim();
    if (!normalizedFileName) {
      throw new Error("JSON store file name must not be empty");
    }

    this.fileName = normalizedFileName;
    this.options = {
      autoSave: options.autoSave ?? true,
      defaults: options.defaults ?? {},
    };
    this.loader = options.loader ?? defaultLoader;
  }

  get<Value>(key: string): Promise<Value | undefined> {
    return this.enqueue(async () => {
      const store = await this.getStore();
      return store.get<Value>(key);
    });
  }

  set<Value>(key: string, value: Value, shouldSave = true): Promise<void> {
    return this.enqueue(async () => {
      const store = await this.getStore();
      await store.set(key, value);
      if (shouldSave) {
        await store.save();
      }
    });
  }

  delete(key: string, shouldSave = true): Promise<void> {
    return this.enqueue(async () => {
      const store = await this.getStore();
      await store.delete(key);
      if (shouldSave) {
        await store.save();
      }
    });
  }

  update<Value>(key: string, updater: (current: Value | undefined) => Value): Promise<Value> {
    return this.enqueue(async () => {
      const store = await this.getStore();
      const current = await store.get<Value>(key);
      const updated = updater(current);
      await store.set(key, updated);
      await store.save();
      return updated;
    });
  }

  save(): Promise<void> {
    return this.enqueue(async () => {
      const store = await this.getStore();
      await store.save();
    });
  }

  private getStore(): Promise<Store> {
    if (!this.storePromise) {
      this.storePromise = this.loader(this.fileName, this.options);
    }
    return this.storePromise;
  }

  private enqueue<Value>(operation: () => Promise<Value>): Promise<Value> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const stores = new Map<string, JsonStore>();

export function getJsonStore(fileName: string, options: JsonStoreOptions = {}): JsonStore {
  const normalizedFileName = fileName.trim();
  const existing = stores.get(normalizedFileName);
  if (existing) {
    return existing;
  }

  const store = new JsonStore(normalizedFileName, options);
  stores.set(normalizedFileName, store);
  return store;
}

async function defaultLoader(fileName: string, options: JsonStoreLoadOptions): Promise<Store> {
  return load(fileName, {
    autoSave: options.autoSave ?? true,
    defaults: options.defaults ?? {},
  });
}
