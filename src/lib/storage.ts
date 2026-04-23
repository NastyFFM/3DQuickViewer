import { openDB, type IDBPDatabase } from 'idb';
import type { StoredModel, ModelMeta } from '../types';

const DB_NAME = '3dquickviewer';
const DB_VERSION = 4; // v4: adds mocap-audio store (linked to StoredModel by id)
const MODELS_STORE = 'models';
const ANIMS_STORE = 'animations'; // legacy — only read during migration
const MOCAP_AUDIO_STORE = 'mocap-audio';

export interface StoredMocapAudio {
  id: string;              // matches StoredModel.id of the mocap item
  data: ArrayBuffer;       // webm/ogg/mp4 bytes
  mimeType: string;
}

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
        if (!db.objectStoreNames.contains(MOCAP_AUDIO_STORE)) {
          db.createObjectStore(MOCAP_AUDIO_STORE, { keyPath: 'id' });
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

// --- Mocap audio (linked to mocap StoredModel by shared id) ---

export async function saveMocapAudio(id: string, blob: Blob): Promise<void> {
  const data = await blob.arrayBuffer();
  const db = await getDB();
  await db.put(MOCAP_AUDIO_STORE, { id, data, mimeType: blob.type || 'audio/webm' });
}

export async function getMocapAudio(id: string): Promise<StoredMocapAudio | undefined> {
  const db = await getDB();
  return db.get(MOCAP_AUDIO_STORE, id);
}

export async function deleteMocapAudio(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(MOCAP_AUDIO_STORE, id);
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
