import { DB_NAME, DB_VERSION, STORES } from './schema';

let dbInstance: IDBDatabase | null = null;

export async function initDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;

      if (!db.objectStoreNames.contains(STORES.EVENTS)) {
        const eventsStore = db.createObjectStore(STORES.EVENTS, { keyPath: 'id' });
        eventsStore.createIndex('startsAt', 'startsAt', { unique: false });
        eventsStore.createIndex('priority', 'priority', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.PROJECTS)) {
        db.createObjectStore(STORES.PROJECTS, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(STORES.TODOS)) {
        const todosStore = db.createObjectStore(STORES.TODOS, { keyPath: 'id' });
        todosStore.createIndex('status', 'status', { unique: false });
        todosStore.createIndex('projectId', 'projectId', { unique: false });
        todosStore.createIndex('eventId', 'eventId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.TIME_ENTRIES)) {
        const timeStore = db.createObjectStore(STORES.TIME_ENTRIES, { keyPath: 'id' });
        timeStore.createIndex('todoId', 'todoId', { unique: false });
        timeStore.createIndex('startAt', 'startAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.TIME_BLOCKS)) {
        const blocksStore = db.createObjectStore(STORES.TIME_BLOCKS, { keyPath: 'id' });
        blocksStore.createIndex('date', 'date', { unique: false });
        blocksStore.createIndex('todoId', 'todoId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
        db.createObjectStore(STORES.SETTINGS, { keyPath: 'id' });
      }

      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(STORES.LOCATIONS)) {
          const locationsStore = db.createObjectStore(STORES.LOCATIONS, { keyPath: 'id' });
          locationsStore.createIndex('name', 'name', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.SCHEDULE_SKELETON)) {
          const skeletonStore = db.createObjectStore(STORES.SCHEDULE_SKELETON, { keyPath: 'id' });
          skeletonStore.createIndex('kind', 'kind', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.SCHEDULE_OVERRIDES)) {
          const overridesStore = db.createObjectStore(STORES.SCHEDULE_OVERRIDES, { keyPath: 'id' });
          overridesStore.createIndex('date', 'date', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.HABIT_MODEL)) {
          db.createObjectStore(STORES.HABIT_MODEL, { keyPath: 'id' });
        }
      }

      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains(STORES.GOALS)) {
          const goalsStore = db.createObjectStore(STORES.GOALS, { keyPath: 'id' });
          goalsStore.createIndex('status', 'status', { unique: false });
        }
      }

      if (oldVersion < 4) {
        if (!db.objectStoreNames.contains(STORES.QUICK_NOTES)) {
          const notesStore = db.createObjectStore(STORES.QUICK_NOTES, { keyPath: 'id' });
          notesStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
      }

      if (oldVersion < 5) {
        // Add updatedAt + tags indexes to the quickNotes store, and migrate any
        // existing rows so they have the new fields.  Schema changes can only
        // happen inside an upgrade transaction, so we use the one provided.
        const tx = (event.target as IDBOpenDBRequest).transaction!;
        let notesStore;
        if (db.objectStoreNames.contains(STORES.QUICK_NOTES)) {
          notesStore = tx.objectStore(STORES.QUICK_NOTES);
        } else {
          notesStore = db.createObjectStore(STORES.QUICK_NOTES, { keyPath: 'id' });
          notesStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!notesStore.indexNames.contains('updatedAt')) {
          notesStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!notesStore.indexNames.contains('tags')) {
          notesStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
        }
        // Backfill any rows missing the new fields
        const cursorReq = notesStore.openCursor();
        cursorReq.onerror = () => {
          console.error('[db migration v5] failed to open cursor on quickNotes:', cursorReq.error);
        };
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          const value = cursor.value as Partial<{
            id: string; title: string; text: string; tags: string[];
            createdAt: string; updatedAt: string;
          }>;
          let dirty = false;
          if (typeof value.title !== 'string') { value.title = ''; dirty = true; }
          if (!Array.isArray(value.tags)) { value.tags = []; dirty = true; }
          if (typeof value.updatedAt !== 'string') {
            value.updatedAt = value.createdAt ?? new Date().toISOString();
            dirty = true;
          }
          if (dirty) {
            const updateReq = cursor.update(value);
            updateReq.onerror = () => {
              // Log but keep iterating — one bad row shouldn't abort the migration.
              console.error('[db migration v5] failed to backfill quickNote row:', updateReq.error);
            };
          }
          cursor.continue();
        };
      }
      if (oldVersion < 6) {
        // Add `projectId` to quickNotes and backfill existing rows with null
        // so they remain valid standalone notes after the schema bump.
        const tx = (event.target as IDBOpenDBRequest).transaction!;
        if (db.objectStoreNames.contains(STORES.QUICK_NOTES)) {
          const notesStore = tx.objectStore(STORES.QUICK_NOTES);
          if (!notesStore.indexNames.contains('projectId')) {
            notesStore.createIndex('projectId', 'projectId', { unique: false });
          }
          const cursorReq = notesStore.openCursor();
          cursorReq.onerror = () => {
            console.error('[db migration v6] failed to open cursor on quickNotes:', cursorReq.error);
          };
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) return;
            const value = cursor.value as Partial<{ projectId: string | null }>;
            if (value.projectId === undefined) {
              value.projectId = null;
              const updateReq = cursor.update(value);
              updateReq.onerror = () => {
                console.error('[db migration v6] failed to backfill quickNote projectId:', updateReq.error);
              };
            }
            cursor.continue();
          };
        }
      }

      if (oldVersion < 7) {
        // Backfill `icon`, `description`, `status` on every project row so the
        // new optional-but-typed fields are present.  Old rows without these
        // fields would otherwise serialise as `undefined`, breaking strict
        // equality checks and falling through to "no icon" rendering anyway —
        // but we want the data to match the schema for export/import too.
        const tx = (event.target as IDBOpenDBRequest).transaction!;
        if (db.objectStoreNames.contains(STORES.PROJECTS)) {
          const projectsStore = tx.objectStore(STORES.PROJECTS);
          if (!projectsStore.indexNames.contains('status')) {
            projectsStore.createIndex('status', 'status', { unique: false });
          }
          const cursorReq = projectsStore.openCursor();
          cursorReq.onerror = () => {
            console.error('[db migration v7] failed to open cursor on projects:', cursorReq.error);
          };
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) return;
            const value = cursor.value as Partial<{
              icon: string | null;
              description: string;
              status: 'active' | 'paused' | 'archived';
            }>;
            let dirty = false;
            if (value.icon === undefined) { value.icon = null; dirty = true; }
            if (typeof value.description !== 'string') { value.description = ''; dirty = true; }
            if (value.status !== 'active' && value.status !== 'paused' && value.status !== 'archived') {
              value.status = 'active';
              dirty = true;
            }
            if (dirty) {
              const updateReq = cursor.update(value);
              updateReq.onerror = () => {
                console.error('[db migration v7] failed to backfill project row:', updateReq.error);
              };
            }
            cursor.continue();
          };
        }
      }
      if (oldVersion < 8) {
        // New per-day status store.  Keyed by `date` (yyyy-MM-dd) so each
        // calendar day has at most one row; absence of a row means 'active'.
        if (!db.objectStoreNames.contains(STORES.DAY_STATUSES)) {
          const dayStore = db.createObjectStore(STORES.DAY_STATUSES, { keyPath: 'date' });
          dayStore.createIndex('status', 'status', { unique: false });
        }
      }
    };
  });
}

export async function getDB(): Promise<IDBDatabase> {
  if (!dbInstance) {
    return initDB();
  }
  return dbInstance;
}

export async function transaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = callback(store);
    let requestResult: T;
    let requestCompleted = false;
    let settled = false;

    request.onsuccess = () => {
      requestResult = request.result;
      requestCompleted = true;
    };

    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error);
    };

    tx.oncomplete = () => {
      if (settled) return;
      if (!requestCompleted) {
        settled = true;
        reject(new Error('IndexedDB request did not complete before transaction completion'));
        return;
      }
      settled = true;
      resolve(requestResult);
    };

    tx.onerror = () => {
      if (settled) return;
      settled = true;
      reject(tx.error ?? request.error ?? new Error('IndexedDB transaction failed'));
    };

    tx.onabort = () => {
      if (settled) return;
      settled = true;
      reject(tx.error ?? request.error ?? new Error('IndexedDB transaction aborted'));
    };
  });
}

export async function getAll<T>(storeName: string): Promise<T[]> {
  return transaction(storeName, 'readonly', (store) => store.getAll());
}

export async function getByKey<T>(storeName: string, key: string): Promise<T | undefined> {
  return transaction(storeName, 'readonly', (store) => store.get(key));
}

export async function add<T>(storeName: string, value: T): Promise<IDBValidKey> {
  return transaction(storeName, 'readwrite', (store) => store.add(value));
}

export async function put<T>(storeName: string, value: T): Promise<IDBValidKey> {
  return transaction(storeName, 'readwrite', (store) => store.put(value));
}

export async function remove(storeName: string, key: string): Promise<void> {
  return transaction(storeName, 'readwrite', (store) => store.delete(key));
}

export async function clearStore(storeName: string): Promise<void> {
  return transaction(storeName, 'readwrite', (store) => store.clear());
}

export async function getAllByIndex<T>(
  storeName: string,
  indexName: string,
  query?: IDBValidKey | IDBKeyRange
): Promise<T[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const request = query ? index.getAll(query) : index.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
