import { useState, useEffect, useCallback } from 'react';
import { getAllAnimations, saveAnimation, deleteAnimation, generateId, type StoredAnimation } from '../lib/storage';

export function useAnimationLibrary() {
  const [animations, setAnimations] = useState<StoredAnimation[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const all = await getAllAnimations();
    setAnimations(all.sort((a, b) => b.createdAt - a.createdAt));
  }, []);

  useEffect(() => {
    refresh().then(() => setLoading(false));
  }, [refresh]);

  const addAnimationFromFile = useCallback(async (file: File): Promise<StoredAnimation> => {
    const data = await file.arrayBuffer();
    const anim: StoredAnimation = {
      id: generateId(),
      name: file.name.replace(/\.[^.]+$/, ''),
      fileName: file.name,
      fileSize: data.byteLength,
      data,
      createdAt: Date.now(),
    };
    await saveAnimation(anim);
    await refresh();
    return anim;
  }, [refresh]);

  const deleteAnimationById = useCallback(async (id: string) => {
    await deleteAnimation(id);
    await refresh();
  }, [refresh]);

  return { animations, loading, refresh, addAnimationFromFile, deleteAnimationById };
}
