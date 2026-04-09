import { useState, useEffect, useCallback } from 'react';
import { getAllModels, saveModel, deleteModel as removeModel, generateId } from '../lib/storage';
import type { StoredModel } from '../types';

export function useModels() {
  const [models, setModels] = useState<StoredModel[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const all = await getAllModels();
    setModels(all.sort((a, b) => b.createdAt - a.createdAt));
  }, []);

  useEffect(() => {
    refresh().then(() => setLoading(false));
  }, [refresh]);

  const addModelFromFile = useCallback(async (file: File, roomId?: string): Promise<StoredModel> => {
    const data = await file.arrayBuffer();
    const model: StoredModel = {
      id: generateId(),
      name: file.name.replace(/\.[^.]+$/, ''),
      fileName: file.name,
      fileSize: data.byteLength,
      data,
      createdAt: Date.now(),
      roomId,
    };
    await saveModel(model);
    await refresh();
    return model;
  }, [refresh]);

  const deleteModelById = useCallback(async (id: string) => {
    await removeModel(id);
    await refresh();
  }, [refresh]);

  return { models, loading, refresh, addModelFromFile, deleteModelById };
}
