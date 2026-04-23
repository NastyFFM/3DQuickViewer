// Lazy-imported MP3 encoder wrapper. Loaded on demand from lamejs, which
// ships as plain JS without types — we declare a minimal surface below.

// @ts-expect-error lamejs has no TS types
import lamejs from 'lamejs';

interface Mp3EncoderCtor {
  new (channels: number, sampleRate: number, bitrate: number): Mp3Encoder;
}
interface Mp3Encoder {
  encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
  flush(): Int8Array;
}

/**
 * Convert a browser-native audio blob (WebM/Opus, Ogg, MP4/AAC…) into MP3.
 * Uses the page's AudioContext to decode the input, then lamejs to encode.
 */
export async function encodeToMp3(input: Blob, bitrateKbps = 128): Promise<Blob> {
  const buf = await input.arrayBuffer();
  const AudioCtx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new AudioCtx();
  try {
    // decodeAudioData copies the buffer internally, so we can detach.
    const decoded = await ctx.decodeAudioData(buf.slice(0));
    const sampleRate = decoded.sampleRate;
    const channels = Math.min(decoded.numberOfChannels, 2);

    const left = float32ToInt16(decoded.getChannelData(0));
    const right = channels > 1 ? float32ToInt16(decoded.getChannelData(1)) : undefined;

    const Mp3Encoder = (lamejs as unknown as { Mp3Encoder: Mp3EncoderCtor }).Mp3Encoder;
    const encoder = new Mp3Encoder(channels, sampleRate, bitrateKbps);

    const BLOCK = 1152; // lamejs expects frames of this size
    const parts: Uint8Array[] = [];
    for (let i = 0; i < left.length; i += BLOCK) {
      const l = left.subarray(i, i + BLOCK);
      const r = right ? right.subarray(i, i + BLOCK) : undefined;
      const enc = r ? encoder.encodeBuffer(l, r) : encoder.encodeBuffer(l);
      if (enc.length > 0) parts.push(new Uint8Array(enc.buffer, enc.byteOffset, enc.byteLength));
    }
    const tail = encoder.flush();
    if (tail.length > 0) parts.push(new Uint8Array(tail.buffer, tail.byteOffset, tail.byteLength));

    return new Blob(parts as BlobPart[], { type: 'audio/mpeg' });
  } finally {
    try { await ctx.close(); } catch { /* ignore */ }
  }
}

function float32ToInt16(f32: Float32Array): Int16Array {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return out;
}
