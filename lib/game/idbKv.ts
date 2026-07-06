/**
 * Minimal promise-based key-value layer over one IndexedDB object store.
 *
 * Deliberately tiny (no `idb` dependency): the save store needs exactly
 * get/put/delete plus one unload-path escape hatch. The factory is injectable
 * so tests can pass fake-indexeddb's IDBFactory without touching globals, and
 * nothing here reads `indexedDB` at module top level (SSR-import safe).
 */

export type AsyncKv = {
  /** Resolves false when IndexedDB is unusable here (missing global, open() failed). */
  ready(): Promise<boolean>;
  /** Resolves undefined when the key is absent. */
  get(key: string): Promise<unknown>;
  /** Resolves once the transaction commits — "saved" must mean durable. */
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * Begins a put synchronously on an already-open connection and returns
   * whether it could. For pagehide/visibilitychange handlers, which cannot
   * await: a transaction created before teardown commits on its own.
   */
  tryPutSync(key: string, value: unknown): boolean;
};

export function createIdbKv(dbName: string, storeName: string, factory?: IDBFactory): AsyncKv {
  // The open is lazy and cached; onclose/onversionchange clear the cache so
  // the next operation reopens instead of failing forever.
  let connection: Promise<IDBDatabase | null> | null = null;
  let openDb: IDBDatabase | null = null;

  const resolveFactory = (): IDBFactory | null => {
    if (factory) return factory;
    return typeof indexedDB === "undefined" ? null : indexedDB;
  };

  const connect = (): Promise<IDBDatabase | null> => {
    connection ??= new Promise((resolve) => {
      const idb = resolveFactory();
      if (!idb) return resolve(null);
      try {
        const request = idb.open(dbName, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(storeName);
        request.onsuccess = () => {
          const db = request.result;
          // Both fire when the browser or another tab tears the connection
          // down (eviction, version bump); dropping the cache lets us reopen.
          db.onclose = db.onversionchange = () => {
            openDb = null;
            connection = null;
            db.close();
          };
          openDb = db;
          resolve(db);
        };
        request.onerror = () => resolve(null);
      } catch {
        resolve(null); // e.g. privacy modes that throw from open() itself
      }
    });
    return connection;
  };

  /** Runs one request in its own transaction, resolving on commit (not request success). */
  const run = <T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    connect().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          if (!db) return reject(new Error("IndexedDB unavailable"));
          try {
            const tx = db.transaction(storeName, mode);
            const request = op(tx.objectStore(storeName));
            tx.oncomplete = () => resolve(request.result);
            tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        })
    );

  return {
    ready: () => connect().then((db) => db !== null),
    get: (key) => run("readonly", (store) => store.get(key)),
    put: (key, value) => run("readwrite", (store) => store.put(value, key)).then(() => undefined),
    delete: (key) => run("readwrite", (store) => store.delete(key)).then(() => undefined),
    tryPutSync: (key, value) => {
      if (!openDb) return false;
      try {
        const tx = openDb.transaction(storeName, "readwrite");
        tx.objectStore(storeName).put(value, key);
        // Explicit commit, not auto-commit: auto-commit waits for request
        // callbacks that a document mid-teardown never runs, and the browser
        // then aborts the transaction — losing exactly the unload save this
        // path exists for (verified against headless Chromium reloads).
        // Optional-called for old engines; there the put still auto-commits
        // whenever the page survives (tab switch), which is the common case.
        tx.commit?.();
        return true;
      } catch {
        return false;
      }
    }
  };
}
