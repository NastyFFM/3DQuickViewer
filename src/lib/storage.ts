import { openDB, type IDBPDatabase } from 'idb';
import type { StoredModel, ModelMeta } from '../types';

const DB_NAME = '3dquickviewer';
const DB_VERSION = 2; // bumped for animations store
const MODELS_STORE = 'models';
const ANIMS_STORE = 'animations';

export interface StoredAnimation {
  id: string;
  name: string;
  fileName: string;
  fileSize: number;
  data: ArrayBuffer;
  createdAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(MODELS_STORE)) {
          db.createObjectStore(MODELS_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(ANIMS_STORE)) {
          db.createObjectStore(ANIMS_STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

// Models
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
  return models.map(({ id, name, fileName, fileSize, thumbnail }) => ({
    id, name, fileName, fileSize, thumbnail,
  }));
}

// Animations
export async function saveAnimation(anim: StoredAnimation): Promise<void> {
  const db = await getDB();
  await db.put(ANIMS_STORE, anim);
}

export async function getAllAnimations(): Promise<StoredAnimation[]> {
  const db = await getDB();
  return db.getAll(ANIMS_STORE);
}

export async function deleteAnimation(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(ANIMS_STORE, id);
}

// Utils
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
