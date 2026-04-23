export type ItemType = 'model' | 'animation' | 'mocap';

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
  /** Only relevant for type==='mocap': whether a linked audio blob exists. */
  hasAudio?: boolean;
  /** Only relevant for type==='mocap': duration in seconds. */
  durationSec?: number;
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
  type:
    | 'model-list' | 'model-request' | 'model-chunk' | 'model-meta' | 'model-complete'
    | 'mocap-audio-request' | 'mocap-audio-meta' | 'mocap-audio-chunk' | 'mocap-audio-complete';
  payload: unknown;
}

export interface MocapAudioMeta {
  id: string;
  mimeType: string;
  fileSize: number;
}

export interface MocapAudioChunk {
  id: string;
  chunkIndex: number;
  totalChunks: number;
  data: string; // base64
}

export interface ModelMeta {
  id: string;
  name: string;
  fileName: string;
  fileSize: number;
  thumbnail?: string;
  type?: ItemType;
  hasAudio?: boolean;
  durationSec?: number;
}

export interface ModelChunk {
  modelId: string;
  chunkIndex: number;
  totalChunks: number;
  data: string; // base64
}
