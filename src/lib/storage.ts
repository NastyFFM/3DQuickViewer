import { openDB, type IDBPDatabase } from 'idb';
import type { StoredModel, ModelMeta } from '../types';

const DB_NAME = '3dquickviewer';
const DB_VERSION = 3; // v3: unified models + animations into one store via `type` field
const MODELS_STORE = 'models';
const ANIMS_STORE = 'animations'; // legacy — only read during migration

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, tx) {
        if (!db.objectStoreNames.contains(MODELS_STORE)) {
          db.createObjectStore(MODELS_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(ANIMS_STORE)) {
          db.createObjectStore(ANIMS_STORE, { keyPath: 'id' });
        }
        if (oldVersion > 0 && oldVersion < 3) {
          // Migrate old animations into the unified models store
          const modelsStore = tx.objectStore(MODELS_STORE);
          const animsStore = tx.objectStore(ANIMS_STORE);
          const anims = await animsStore.getAll();
          for (const a of anims) {
            await modelsStore.put({ ...a, type: 'animation' });
          }
          await animsStore.clear();
        }
      },
    });
  }
  return dbPromise;
}

export async function saveModel(model: StoredModel): Promise<void> {
  const db = await getDB();
  await db.put(MODELS_STORE, model);
}

export async function getModel(id: string): Promise<StoredModel | undefined> {
  const db = await getDB();
  return db.get(MODELS_STORE, id);
}

export async function getAllModels(): Promise<StoredModel[]> {
  const db = await getDB();
  return db.getAll(MODELS_STORE);
}

export async function deleteModel(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(MODELS_STORE, id);
}

export async function getModelMetas(): Promise<ModelMeta[]> {
  const models = await getAllModels();
  return models.map(({ id, name, fileName, fileSize, thumbnail, type }) => ({
    id, name, fileName, fileSize, thumbnail, type,
  }));
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const ROOM_KEY = '3dqv-room-id';

export function getSavedRoomId(): string | null {
  return localStorage.getItem(ROOM_KEY);
}

export function saveRoomId(roomId: string): void {
  localStorage.setItem(ROOM_KEY, roomId);
}
