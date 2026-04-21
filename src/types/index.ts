export type ItemType = 'model' | 'animation';

export interface StoredModel {
  id: string;
  name: string;
  fileName: string;
  fileSize: number;
  data: ArrayBuffer;
  thumbnail?: string;
  createdAt: number;
  roomId?: string;
  type?: ItemType; // undefined == 'model' for backwards compat
}

export interface RoomState {
  roomId: string;
  peerId: string;
  connected: boolean;
  peers: string[];
}

export interface TransferProgress {
  modelId: string;
  fileName: string;
  progress: number; // 0-1
  direction: 'send' | 'receive';
}

export interface PeerMessage {
  type: 'model-list' | 'model-request' | 'model-chunk' | 'model-meta' | 'model-complete';
  payload: unknown;
}

export interface ModelMeta {
  id: string;
  name: string;
  fileName: string;
  fileSize: number;
  thumbnail?: string;
  type?: ItemType;
}

export interface ModelChunk {
  modelId: string;
  chunkIndex: number;
  totalChunks: number;
  data: string; // base64
}
