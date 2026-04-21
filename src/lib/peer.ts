import { io, type Socket } from 'socket.io-client';
import type { PeerMessage, ModelMeta, ModelChunk, StoredModel } from '../types';
import { getModel, getAllModels, saveModel } from './storage';

const SIGNALING_SERVER = 'https://web-production-84380f.up.railway.app';
const CHUNK_SIZE = 64 * 1024; // 64KB chunks (safe for all browsers)
const MAX_BUFFERED = 256 * 1024; // Wait when buffer exceeds 256KB
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

type OnModelList = (models: ModelMeta[]) => void;
type OnTransferProgress = (modelId: string, progress: number) => void;
type OnModelReceived = (model: StoredModel) => void;
type OnPeerConnected = (peerId: string) => void;
type OnPeerDisconnected = (peerId: string) => void;

interface DataChannelWrapper {
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  peerId: string;
}

export class RoomPeer {
  private socket: Socket | null = null;
  private peers: Map<string, DataChannelWrapper> = new Map();
  private roomId: string;
  private pendingChunks: Map<string, { meta: ModelMeta; chunks: string[]; received: number }> = new Map();

  // Callbacks
  onModelList: OnModelList = () => {};
  onTransferProgress: OnTransferProgress = () => {};
  onModelReceived: OnModelReceived = () => {};
  onPeerConnected: OnPeerConnected = () => {};
  onPeerDisconnected: OnPeerDisconnected = () => {};
  onConnected: () => void = () => {};
  onError: (err: Error) => void = () => {};

  constructor(roomId: string, _isHost: boolean) {
    this.roomId = roomId;
  }

  async connect(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.socket = io(SIGNALING_SERVER, {
        transports: ['websocket', 'polling'],
      });

      this.socket.on('connect', () => {
        console.log('[3DQV] Socket connected:', this.socket!.id);
        // Join room
        this.socket!.emit('join-room', { roomId: this.roomId });
        this.onConnected();
        resolve(this.socket!.id!);
      });

      this.socket.on('connect_error', (err) => {
        console.error('[3DQV] Socket connect error:', err);
        this.onError(new Error(`Verbindung fehlgeschlagen: ${err.message}`));
        reject(err);
      });

      this.socket.on('disconnect', () => {
        console.log('[3DQV] Socket disconnected');
      });

      // Room events
      this.socket.on('room-users', async ({ roomId, users }: { roomId: string; users: string[] }) => {
        console.log(`[3DQV] Joined room ${roomId}, ${users.length} existing peers`);
        // Create WebRTC connections to all existing users (we are the initiator)
        for (const userId of users) {
          await this.createPeerConnection(userId, true);
        }
      });

      this.socket.on('room-full', ({ roomId, maxUsers }: { roomId: string; maxUsers: number }) => {
        this.onError(new Error(`Raum "${roomId}" ist voll (max ${maxUsers} Nutzer)`));
      });

      this.socket.on('user-joined', ({ userId }: { userId: string }) => {
        console.log('[3DQV] User joined:', userId);
        // Don't initiate — wait for their offer (they got us in room-users)
      });

      this.socket.on('user-left', ({ userId }: { userId: string }) => {
        console.log('[3DQV] User left:', userId);
        this.removePeer(userId);
      });

      // WebRTC signaling
      this.socket.on('offer', async ({ offer, senderId }: { offer: RTCSessionDescriptionInit; senderId: string; roomId: string }) => {
        console.log('[3DQV] Received offer from:', senderId);
        const wrapper = await this.createPeerConnection(senderId, false);
        await wrapper.pc.setRemoteDescription(offer);
        const answer = await wrapper.pc.createAnswer();
        await wrapper.pc.setLocalDescription(answer);
        this.socket!.emit('answer', { roomId: this.roomId, answer, targetId: senderId });
      });

      this.socket.on('answer', async ({ answer, senderId }: { answer: RTCSessionDescriptionInit; senderId: string }) => {
        console.log('[3DQV] Received answer from:', senderId);
        const wrapper = this.peers.get(senderId);
        if (wrapper) {
          await wrapper.pc.setRemoteDescription(answer);
        }
      });

      this.socket.on('ice-candidate', async ({ candidate, senderId }: { candidate: RTCIceCandidateInit; senderId: string }) => {
        const wrapper = this.peers.get(senderId);
        if (wrapper && candidate) {
          await wrapper.pc.addIceCandidate(candidate);
        }
      });
    });
  }

  private async createPeerConnection(targetId: string, isInitiator: boolean): Promise<DataChannelWrapper> {
    // Close existing if any
    if (this.peers.has(targetId)) {
      this.peers.get(targetId)!.pc.close();
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const wrapper: DataChannelWrapper = { pc, channel: null, peerId: targetId };
    this.peers.set(targetId, wrapper);

    // ICE candidates
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.socket!.emit('ice-candidate', {
          roomId: this.roomId,
          candidate: e.candidate,
          targetId,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[3DQV] RTC ${targetId}: ${pc.connectionState}`);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.removePeer(targetId);
      }
    };

    if (isInitiator) {
      // Create data channel
      const dc = pc.createDataChannel('models', { ordered: true });
      wrapper.channel = dc;
      this.setupDataChannel(dc, targetId);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.socket!.emit('offer', { roomId: this.roomId, offer, targetId });
    } else {
      // Wait for data channel from initiator
      pc.ondatachannel = (e) => {
        wrapper.channel = e.channel;
        this.setupDataChannel(e.channel, targetId);
      };
    }

    return wrapper;
  }

  private setupDataChannel(dc: RTCDataChannel, peerId: string) {
    dc.onopen = async () => {
      console.log(`[3DQV] DataChannel open with ${peerId}`);
      this.onPeerConnected(peerId);

      // Send model list on connect
      const models = await getAllModels();
      const metas: ModelMeta[] = models.map(({ id, name, fileName, fileSize, thumbnail }) => ({
        id, name, fileName, fileSize, thumbnail,
      }));
      this.sendToPeer(peerId, { type: 'model-list', payload: metas });
    };

    dc.onmessage = (e) => {
      try {
        const msg: PeerMessage = JSON.parse(e.data);
        this.handleMessage(peerId, msg);
      } catch (err) {
        console.error('[3DQV] Failed to parse message:', err);
      }
    };

    dc.onclose = () => {
      console.log(`[3DQV] DataChannel closed with ${peerId}`);
      this.onPeerDisconnected(peerId);
    };

    dc.onerror = (err) => {
      console.error(`[3DQV] DataChannel error with ${peerId}:`, err);
    };
  }

  // Wait until the DataChannel buffer drains below threshold
  private async waitForBuffer(channel: RTCDataChannel): Promise<void> {
    let waited = 0;
    while (channel.bufferedAmount > MAX_BUFFERED && waited < 30000) {
      await new Promise((r) => setTimeout(r, 100));
      waited += 100;
    }
    if (waited >= 30000) {
      console.warn('[3DQV] Buffer drain timeout after 30s, continuing anyway');
    }
  }

  private sendToPeer(peerId: string, msg: PeerMessage) {
    const wrapper = this.peers.get(peerId);
    if (wrapper?.channel?.readyState === 'open') {
      wrapper.channel.send(JSON.stringify(msg));
    }
  }

  private broadcast(msg: PeerMessage) {
    const data = JSON.stringify(msg);
    for (const wrapper of this.peers.values()) {
      if (wrapper.channel?.readyState === 'open') {
        wrapper.channel.send(data);
      }
    }
  }

  private removePeer(peerId: string) {
    const wrapper = this.peers.get(peerId);
    if (wrapper) {
      wrapper.channel?.close();
      wrapper.pc.close();
      this.peers.delete(peerId);
      this.onPeerDisconnected(peerId);
    }
  }

  private async handleMessage(fromPeerId: string, msg: PeerMessage) {
    switch (msg.type) {
      case 'model-list': {
        this.onModelList(msg.payload as ModelMeta[]);
        break;
      }
      case 'model-request': {
        const modelId = msg.payload as string;
        await this.sendModelToPeer(fromPeerId, modelId);
        break;
      }
      case 'model-meta': {
        const meta = msg.payload as ModelMeta;
        const totalChunks = Math.ceil(meta.fileSize / CHUNK_SIZE);
        this.pendingChunks.set(meta.id, { meta, chunks: new Array(totalChunks), received: 0 });
        this.onTransferProgress(meta.id, 0);
        break;
      }
      case 'model-chunk': {
        const chunk = msg.payload as ModelChunk;
        const pending = this.pendingChunks.get(chunk.modelId);
        if (!pending) break;

        pending.chunks[chunk.chunkIndex] = chunk.data;
        pending.received++;
        this.onTransferProgress(chunk.modelId, pending.received / chunk.totalChunks);
        break;
      }
      case 'model-complete': {
        const completeId = msg.payload as string;
        const completed = this.pendingChunks.get(completeId);
        if (!completed) break;

        try {
          // Decode each base64 chunk individually (each has its own padding)
          const decodedChunks: Uint8Array[] = [];
          let totalLength = 0;
          for (const b64Chunk of completed.chunks) {
            const binary = atob(b64Chunk);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            decodedChunks.push(bytes);
            totalLength += bytes.length;
          }

          // Concatenate all decoded chunks
          const fullBytes = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of decodedChunks) {
            fullBytes.set(chunk, offset);
            offset += chunk.length;
          }

          console.log(`[3DQV] Model reassembled: ${completed.meta.fileName}, ${totalLength} bytes`);

          const model: StoredModel = {
            id: completed.meta.id,
            name: completed.meta.name,
            fileName: completed.meta.fileName,
            fileSize: completed.meta.fileSize,
            thumbnail: completed.meta.thumbnail,
            data: fullBytes.buffer,
            createdAt: Date.now(),
            roomId: this.roomId,
          };

          await saveModel(model);
          console.log(`[3DQV] Model saved to IndexedDB: ${model.id}`);
          this.pendingChunks.delete(completeId);
          this.onModelReceived(model);
        } catch (err) {
          console.error('[3DQV] Failed to reassemble/save model:', err);
        }
        break;
      }
    }
  }

  private async sendModelToPeer(peerId: string, modelId: string) {
    const model = await getModel(modelId);
    if (!model) return;

    const wrapper = this.peers.get(peerId);
    if (!wrapper?.channel || wrapper.channel.readyState !== 'open') return;

    const meta: ModelMeta = {
      id: model.id,
      name: model.name,
      fileName: model.fileName,
      fileSize: model.fileSize,
      thumbnail: model.thumbnail,
    };

    this.sendToPeer(peerId, { type: 'model-meta', payload: meta });

    const bytes = new Uint8Array(model.data);
    const totalChunks = Math.ceil(bytes.length / CHUNK_SIZE);

    for (let i = 0; i < totalChunks; i++) {
      // Wait for buffer to drain before sending next chunk
      await this.waitForBuffer(wrapper.channel);

      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, bytes.length);
      const chunkBytes = bytes.slice(start, end);

      let binary = '';
      for (let j = 0; j < chunkBytes.length; j++) {
        binary += String.fromCharCode(chunkBytes[j]);
      }
      const base64 = btoa(binary);

      const chunk: ModelChunk = {
        modelId,
        chunkIndex: i,
        totalChunks,
        data: base64,
      };

      this.sendToPeer(peerId, { type: 'model-chunk', payload: chunk });
    }

    this.sendToPeer(peerId, { type: 'model-complete', payload: modelId });
  }

  async sendModel(modelId: string): Promise<void> {
    const model = await getModel(modelId);
    if (!model) return;

    const meta: ModelMeta = {
      id: model.id,
      name: model.name,
      fileName: model.fileName,
      fileSize: model.fileSize,
      thumbnail: model.thumbnail,
    };

    this.broadcast({ type: 'model-meta', payload: meta });

    const bytes = new Uint8Array(model.data);
    const totalChunks = Math.ceil(bytes.length / CHUNK_SIZE);

    for (let i = 0; i < totalChunks; i++) {
      // Wait for all channels to drain
      for (const wrapper of this.peers.values()) {
        if (wrapper.channel?.readyState === 'open') {
          await this.waitForBuffer(wrapper.channel);
        }
      }

      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, bytes.length);
      const chunkBytes = bytes.slice(start, end);

      let binary = '';
      for (let j = 0; j < chunkBytes.length; j++) {
        binary += String.fromCharCode(chunkBytes[j]);
      }
      const base64 = btoa(binary);

      const chunk: ModelChunk = {
        modelId,
        chunkIndex: i,
        totalChunks,
        data: base64,
      };

      this.broadcast({ type: 'model-chunk', payload: chunk });
    }

    this.broadcast({ type: 'model-complete', payload: modelId });
  }

  requestModel(modelId: string) {
    this.broadcast({ type: 'model-request', payload: modelId });
  }

  async broadcastModelList() {
    const models = await getAllModels();
    const metas: ModelMeta[] = models.map(({ id, name, fileName, fileSize, thumbnail }) => ({
      id, name, fileName, fileSize, thumbnail,
    }));
    this.broadcast({ type: 'model-list', payload: metas });
  }

  get connectedPeers(): string[] {
    return [...this.peers.entries()]
      .filter(([, w]) => w.channel?.readyState === 'open')
      .map(([id]) => id);
  }

  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  destroy() {
    for (const wrapper of this.peers.values()) {
      wrapper.channel?.close();
      wrapper.pc.close();
    }
    this.peers.clear();
    this.socket?.disconnect();
    this.socket = null;
  }
}
