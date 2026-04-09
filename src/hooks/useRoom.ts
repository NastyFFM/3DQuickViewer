import { useState, useEffect, useRef, useCallback } from 'react';
import { RoomPeer } from '../lib/peer';
import { saveRoomId } from '../lib/storage';
import type { ModelMeta, StoredModel, TransferProgress } from '../types';

interface UseRoomOptions {
  roomId: string;
  isHost: boolean;
  enabled?: boolean;
}

interface UseRoomReturn {
  connected: boolean;
  peers: string[];
  remoteModels: ModelMeta[];
  transfers: TransferProgress[];
  requestModel: (modelId: string) => void;
  sendModelToPeers: (modelId: string) => Promise<void>;
  broadcastModelList: () => Promise<void>;
  error: string | null;
}

export function useRoom({ roomId, isHost, enabled = true }: UseRoomOptions): UseRoomReturn {
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState<string[]>([]);
  const [remoteModels, setRemoteModels] = useState<ModelMeta[]>([]);
  const [transfers, setTransfers] = useState<TransferProgress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const peerRef = useRef<RoomPeer | null>(null);
  const onModelReceivedRef = useRef<((model: StoredModel) => void) | null>(null);

  // Expose a way for the page to know when a model is received
  const [, setLastReceived] = useState<number>(0);

  useEffect(() => {
    if (!enabled || !roomId) return;

    const peer = new RoomPeer(roomId, isHost);
    peerRef.current = peer;

    peer.onConnected = () => {
      setConnected(true);
      saveRoomId(roomId);
    };

    peer.onError = (err) => {
      setError(err.message);
    };

    peer.onPeerConnected = () => {
      setPeers(peer.connectedPeers);
    };

    peer.onPeerDisconnected = () => {
      setPeers(peer.connectedPeers);
    };

    peer.onModelList = (models) => {
      setRemoteModels(models);
    };

    peer.onTransferProgress = (modelId, progress) => {
      setTransfers((prev) => {
        const existing = prev.find((t) => t.modelId === modelId);
        if (existing) {
          return prev.map((t) =>
            t.modelId === modelId ? { ...t, progress } : t
          );
        }
        const meta = remoteModels.find((m) => m.id === modelId);
        return [
          ...prev,
          {
            modelId,
            fileName: meta?.fileName ?? 'unknown',
            progress,
            direction: 'receive' as const,
          },
        ];
      });
    };

    peer.onModelReceived = (model) => {
      setTransfers((prev) => prev.filter((t) => t.modelId !== model.id));
      setLastReceived(Date.now());
      onModelReceivedRef.current?.(model);
    };

    peer.connect().catch((err) => {
      setError(err.message);
    });

    return () => {
      peer.destroy();
      peerRef.current = null;
      setConnected(false);
      setPeers([]);
    };
  }, [roomId, isHost, enabled]);

  const requestModel = useCallback((modelId: string) => {
    peerRef.current?.requestModel(modelId);
  }, []);

  const sendModelToPeers = useCallback(async (modelId: string) => {
    if (peerRef.current) {
      await peerRef.current.sendModel(modelId);
    }
  }, []);

  const broadcastModelList = useCallback(async () => {
    if (peerRef.current) {
      await peerRef.current.broadcastModelList();
    }
  }, []);

  return {
    connected,
    peers,
    remoteModels,
    transfers,
    requestModel,
    sendModelToPeers,
    broadcastModelList,
    error,
  };
}
