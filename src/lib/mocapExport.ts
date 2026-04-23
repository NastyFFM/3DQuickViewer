import * as THREE from 'three';

/**
 * Mocap recordings use a custom JSON format rather than GLB/FBX to avoid
 * GLTFExporter's "needs a scene with bones" requirement. The saved file is
 * just UTF-8-encoded JSON with per-frame bone quaternions. Playback
 * deserializes and constructs an AnimationClip on-the-fly.
 */

export interface MocapFrame {
  /** seconds since recording start */
  t: number;
  quats: Array<{ boneName: string; x: number; y: number; z: number; w: number }>;
}

export interface MocapPayload {
  startTime: number;
  frames: MocapFrame[];
  /** Optional embedded audio. Present when the user exported via "Speichern"
   * on a mocap with hasAudio=true. Import strips this field back out and
   * stores the audio blob separately in IndexedDB (mocap-audio store). */
  audio?: {
    mimeType: string;
    /** Base64 encoding of the raw audio bytes (webm/opus, ogg, mp4…). */
    data: string;
  };
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  return btoa(binary);
}

export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const MOCAP_FILE_EXT = '.mocap.json';
export const MOCAP_MIME_TYPE = 'application/x-mocap-json';

/** Prefix used on mocap clip names in the animation picker so they can be
 * identified apart from model and FBX library animations. */
export const MOCAP_CLIP_PREFIX = '🎬🔊 ';

/** Shape passed from Room to each viewer for playback of stored mocap
 * recordings. Viewers lazily parse the JSON + fetch audio from IndexedDB. */
export interface LibraryMocap {
  id: string;
  name: string;
  /** UTF-8 encoded MocapPayload JSON */
  data: ArrayBuffer;
  hasAudio: boolean;
}

/** Parse a mocap payload (ArrayBuffer of UTF-8 JSON) into frames. */
export function parseMocapPayload(data: ArrayBuffer): MocapPayload {
  const text = new TextDecoder().decode(data);
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.frames)) {
    throw new Error('Invalid mocap payload: missing frames[]');
  }
  return parsed as MocapPayload;
}

/**
 * Build a THREE.AnimationClip from mocap frames. Track names are
 * "<boneName>.quaternion" — matches what AnimationMixer expects when
 * binding to a bone by name.
 */
export function buildAnimationClip(payload: MocapPayload, name = 'Mocap'): THREE.AnimationClip {
  if (payload.frames.length === 0) {
    return new THREE.AnimationClip(name, 0, []);
  }

  // Group frame samples by bone name. Each bone gets its own KeyframeTrack.
  const byBone = new Map<string, { times: number[]; values: number[] }>();
  for (const frame of payload.frames) {
    for (const q of frame.quats) {
      let bucket = byBone.get(q.boneName);
      if (!bucket) {
        bucket = { times: [], values: [] };
        byBone.set(q.boneName, bucket);
      }
      bucket.times.push(frame.t);
      bucket.values.push(q.x, q.y, q.z, q.w);
    }
  }

  const tracks: THREE.KeyframeTrack[] = [];
  for (const [boneName, { times, values }] of byBone) {
    tracks.push(new THREE.QuaternionKeyframeTrack(
      `${boneName}.quaternion`,
      times,
      values,
    ));
  }

  const duration = payload.frames[payload.frames.length - 1].t;
  return new THREE.AnimationClip(name, duration, tracks);
}
