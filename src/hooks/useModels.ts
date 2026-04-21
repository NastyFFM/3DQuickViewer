import { useState, useEffect, useCallback, useMemo } from 'react';
import { getAllModels, saveModel, deleteModel as removeModel, generateId } from '../lib/storage';
import type { StoredModel, ItemType } from '../types';

function detectTypeFromFileName(fileName: string): ItemType {
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
      type: detectTypeFromFileName(file.name),
    };
    await saveModel(model);
    await refresh();
    return model;
  }, [refresh]);

  const deleteModelById = useCallback(async (id: string) => {
    await removeModel(id);
    await refresh();
  }, [refresh]);

  const models = useMemo(() => items.filter((m) => m.type !== 'animation'), [items]);
  const animations = useMemo(() => items.filter((m) => m.type === 'animation'), [items]);

  return { models, animations, items, loading, refresh, addModelFromFile, deleteModelById };
}
