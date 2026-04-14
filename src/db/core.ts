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

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
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
