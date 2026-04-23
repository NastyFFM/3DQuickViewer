import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getAllModels, saveModel, deleteModel as removeModel,
  saveMocapAudio, deleteMocapAudio, generateId,
} from '../lib/storage';
import type { StoredModel, ItemType } from '../types';

export function guessTypeFromFileName(fileName: string): ItemType {
  const ext = fileName.toLowerCase().split('.').pop();
  return ext === 'fbx' ? 'animation' : 'model';
}

export function useModels() {
  const [items, setItems] = useState<StoredModel[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const all = await getAllModels();
    setItems(all.sort((a, b) => b.createdAt - a.createdAt));
  }, []);

  useEffect(() => {
    refresh().then(() => setLoading(false));
  }, [refresh]);

  const addModelFromFile = useCallback(async (file: File, roomId?: string, typeOverride?: ItemType): Promise<StoredModel> => {
    const data = await file.arrayBuffer();
    const model: StoredModel = {
      id: generateId(),
      name: file.name.replace(/\.[^.]+$/, ''),
      fileName: file.name,
      fileSize: data.byteLength,
      data,
      createdAt: Date.now(),
      roomId,
      type: typeOverride ?? guessTypeFromFileName(file.name),
    };
    await saveModel(model);
    await refresh();
    return model;
  }, [refresh]);

  const addMocapRecording = useCallback(async (params: {
    name: string;
    clipTracksPayload: ArrayBuffer;
    audioBlob: Blob;
    audioMimeType: string;
    durationSec: number;
    roomId?: string;
  }): Promise<StoredModel> => {
    const id = generateId();
    const model: StoredModel = {
      id,
      name: params.name,
      fileName: `${params.name}.mocap.json`,
      fileSize: params.clipTracksPayload.byteLength,
      data: params.clipTracksPayload,
      createdAt: Date.now(),
      roomId: params.roomId,
      type: 'mocap',
      hasAudio: params.audioBlob.size > 0,
      durationSec: params.durationSec,
    };
    await saveModel(model);
    if (params.audioBlob.size > 0) {
      await saveMocapAudio(id, params.audioBlob);
    }
    await refresh();
    return model;
  }, [refresh]);

  const deleteModelById = useCallback(async (id: string) => {
    const item = items.find((m) => m.id === id);
    await removeModel(id);
    if (item?.type === 'mocap' && item.hasAudio) {
      await deleteMocapAudio(id);
    }
    await refresh();
  }, [items, refresh]);

  const models = useMemo(() => items.filter((m) => m.type !== 'animation' && m.type !== 'mocap'), [items]);
  const animations = useMemo(() => items.filter((m) => m.type === 'animation'), [items]);
  const mocaps = useMemo(() => items.filter((m) => m.type === 'mocap'), [items]);

  return {
    models, animations, mocaps, items,
    loading, refresh,
    addModelFromFile, addMocapRecording, deleteModelById,
  };
}
