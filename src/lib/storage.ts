import { openDB, type IDBPDatabase } from 'idb';
import type { StoredModel, ModelMeta } from '../types';

const DB_NAME = '3dquickviewer';
const DB_VERSION = 1;
const STORE_NAME = 'models';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveModel(model: StoredModel): Promise<void> {
  const db = await getDB();
  await db.put(STORE_NAME, model);
}

export async function getModel(id: string): Promise<StoredModel | undefined> {
  const db = await getDB();
  return db.get(STORE_NAME, id);
}

export async function getAllModels(): Promise<StoredModel[]> {
  const db = await getDB();
  return db.getAll(STORE_NAME);
}

export async function deleteModel(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}

export async function getModelMetas(): Promise<ModelMeta[]> {
  const models = await getAllModels();
  return models.map(({ id, name, fileName, fileSize, thumbnail }) => ({
    id,
    name,
    fileName,
    fileSize,
    thumbnail,
  }));
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Room persistence
const ROOM_KEY = '3dqv-room-id';

export function getSavedRoomId(): string | null {
  return localStorage.getItem(ROOM_KEY);
}

export function saveRoomId(roomId: string): void {
  localStorage.setItem(ROOM_KEY, roomId);
}
