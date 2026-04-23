import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getAllModels, saveModel, deleteModel as removeModel,
  saveMocapAudio, deleteMocapAudio, generateId,
} from '../lib/storage';
import { base64ToUint8Array } from '../lib/mocapExport';
import type { StoredModel, ItemType } from '../types';

export function guessTypeFromFileName(fileName: string): ItemType {
  const lower = fileName.toLowerCase();
  // Any .json with ".mocap" in the name — tolerates browser-download dupes
  // like `foo.mocap (1).json` and renamed variants.
  if (lower.endsWith('.json') && lower.includes('.mocap')) return 'mocap';
  const ext = lower.split('.').pop();
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

  /** Import a .mocap.json file previously exported via "Speichern". If the
   * file contains an embedded `audio` field (produced by recent exports),
   * extract + store the audio blob separately and strip the field from the
   * stored JSON — so the in-IDB payload stays lean. */
  const addMocapFromJson = useCallback(async (file: File, roomId?: string): Promise<StoredModel> => {
    const rawData = await file.arrayBuffer();
    let parsed: { startTime?: number; frames?: Array<{ t?: number }>; audio?: { mimeType: string; data: string } };
    try {
      const text = new TextDecoder().decode(rawData);
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Kein gueltiges JSON');
    }
    if (!parsed || !Array.isArray(parsed.frames) || parsed.frames.length === 0) {
      throw new Error('Kein gueltiges Mocap-JSON (frames[] fehlt oder leer)');
    }

    const lastFrame = parsed.frames[parsed.frames.length - 1];
    const durationSec = typeof lastFrame?.t === 'number' ? lastFrame.t : 0;

    const id = generateId();
    let hasAudio = false;
    let storedData: ArrayBuffer = rawData;

    // Extract embedded audio → separate IDB blob. Strip from the JSON so
    // subsequent storage/transfer doesn't duplicate it.
    if (parsed.audio && typeof parsed.audio.data === 'string' && parsed.audio.mimeType) {
      try {
        const bytes = base64ToUint8Array(parsed.audio.data);
        // slice() detaches into a fresh ArrayBuffer (not SharedArrayBuffer),
        // which the Blob constructor's TS type requires under strict settings.
        const blob = new Blob([bytes.slice().buffer], { type: parsed.audio.mimeType });
        await saveMocapAudio(id, blob);
        hasAudio = true;
        const { audio: _audio, ...rest } = parsed;
        void _audio;
        storedData = new TextEncoder().encode(JSON.stringify(rest)).buffer as ArrayBuffer;
      } catch (e) {
        console.warn('[Mocap import] audio extract failed:', e);
      }
    }

    // Strip `.mocap(...)?.json` suffix (incl. browser-download dupes like "(1)")
    const displayName = file.name
      .replace(/\.mocap(\s*\(\d+\))?\.json$/i, '')
      .replace(/\.[^.]+$/, '');
    const model: StoredModel = {
      id,
      name: displayName,
      fileName: file.name,
      fileSize: storedData.byteLength,
      data: storedData,
      createdAt: Date.now(),
      roomId,
      type: 'mocap',
      hasAudio,
      durationSec,
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
    addModelFromFile, addMocapFromJson, addMocapRecording, deleteModelById,
  };
}
