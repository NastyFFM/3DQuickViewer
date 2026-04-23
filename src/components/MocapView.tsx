import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Environment, Html } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { PoseLandmarker, FilesetResolver, type NormalizedLandmark, type Landmark } from '@mediapipe/tasks-vision';

// MediaPipe Pose landmark indices (33-point BlazePose topology)
const L = {
  nose: 0,
  leftEar: 7, rightEar: 8,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
};

const SKELETON_EDGES: [number, number][] = [
  [L.leftShoulder, L.rightShoulder],
  [L.leftShoulder, L.leftElbow], [L.leftElbow, L.leftWrist],
  [L.rightShoulder, L.rightElbow], [L.rightElbow, L.rightWrist],
  [L.leftHip, L.rightHip],
  [L.leftShoulder, L.leftHip], [L.rightShoulder, L.rightHip],
  [L.leftHip, L.leftKnee], [L.leftKnee, L.leftAnkle],
  [L.rightHip, L.rightKnee], [L.rightKnee, L.rightAnkle],
];

interface PoseRef {
  landmarks: NormalizedLandmark[] | null;
  worldLandmarks: Landmark[] | null;
}

interface MocapViewProps {
  modelData: ArrayBuffer;
  fileName: string;
  scale?: number;
  /** Called after user confirms Save in the post-record dialog. Parent
   * persists the mocap (GLB animation + audio blob) to storage. */
  onMocapSaved?: (params: {
    name: string;
    clipTracksPayload: ArrayBuffer;
    audioBlob: Blob;
    audioMimeType: string;
    durationSec: number;
  }) => Promise<void> | void;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 10));
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000);
  const pad = (n: number, w = 2) => n.toString().padStart(w, '0');
  return `${pad(m)}:${pad(s)}.${pad(cs)}`;
}

export function MocapView({ modelData, fileName, scale = 1, onMocapSaved }: MocapViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const poseRef = useRef<PoseRef>({ landmarks: null, worldLandmarks: null });
  const rafRef = useRef<number | null>(null);
  // Audio-only stream derived from getUserMedia — fed into MediaRecorder
  // when the user starts a recording.
  const audioStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  // Ref-driven so per-frame driving code in PoseDrivenModel can observe
  // recording state without re-render churn.
  const recordingActiveRef = useRef(false);
  // Shared buffer: PoseDrivenModel pushes per-bone quaternions while
  // recording, MocapView reads them on stop to build the AnimationClip.
  const recordBufferRef = useRef<{
    startTime: number;
    frames: Array<{ t: number; quats: Array<{ boneName: string; x: number; y: number; z: number; w: number }> }>;
  }>({ startTime: 0, frames: [] });
  const [status, setStatus] = useState<'init' | 'webcam' | 'ready' | 'error'>('init');
  const [err, setErr] = useState<string>('');
  const [showWebcam, setShowWebcam] = useState(true);
  const [camSize, setCamSize] = useState({ w: 360, h: 270 });
  const [bonesInfo, setBonesInfo] = useState<{ mapping: Record<string, string | null>; all: string[] } | null>(null);
  const [showBones, setShowBones] = useState(false);
  // Global axis permutation: which MediaPipe axis becomes which Three.js
  // axis when computing per-bone deltas. Cycles through the 6 possible
  // orderings (XYZ identity through ZYX full reverse). Combined with the
  // per-axis Flip toggles you can dial in all 48 axis-mapping conventions.
  const [axisPerm, setAxisPerm] = useState<AxisPerm>(() => {
    try {
      const raw = localStorage.getItem('3dqv-mocap-axisperm');
      if (raw && PERMS.includes(raw as AxisPerm)) return raw as AxisPerm;
    } catch { /* fall through */ }
    // Default tuned for Tripo3D auto-rigged models (combined with flip X+Z).
    return 'ZYX';
  });
  useEffect(() => {
    try { localStorage.setItem('3dqv-mocap-axisperm', axisPerm); } catch { /* ignore */ }
  }, [axisPerm]);
  const [axisFlip, setAxisFlip] = useState<{ x: boolean; y: boolean; z: boolean }>(() => {
    try {
      const raw = localStorage.getItem('3dqv-mocap-flip');
      if (raw) return JSON.parse(raw);
    } catch { /* fall through */ }
    // Default tuned for Tripo3D auto-rigged models (combined with axisPerm=ZYX).
    return { x: true, y: false, z: true };
  });
  useEffect(() => {
    try { localStorage.setItem('3dqv-mocap-flip', JSON.stringify(axisFlip)); } catch { /* ignore */ }
  }, [axisFlip]);
  // 0 = never calibrated → no mocap driving. >0 = calibrated; bumping
  // re-captures the rest pose from the current frame.
  const [calibrateToken, setCalibrateToken] = useState(0);
  type CountdownMode = 'calibrate' | 'record';
  const [countdown, setCountdown] = useState<number | null>(null);
  const [countdownMode, setCountdownMode] = useState<CountdownMode | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordStartMs, setRecordStartMs] = useState<number | null>(null);
  const [recordElapsedMs, setRecordElapsedMs] = useState(0);
  const [pendingSave, setPendingSave] = useState<{
    clipTracksPayload: ArrayBuffer;
    audioBlob: Blob;
    audioMimeType: string;
    durationSec: number;
    defaultName: string;
  } | null>(null);

  const startCalibration = () => {
    if (countdown !== null || isRecording) return;
    setCountdownMode('calibrate');
    setCountdown(3);
  };

  const startRecording = () => {
    if (countdown !== null || isRecording) return;
    if (calibrateToken === 0) {
      setErr('Bitte zuerst kalibrieren.');
      setTimeout(() => setErr(''), 3000);
      return;
    }
    if (!audioStreamRef.current) {
      setErr('Audio-Stream fehlt — Webcam-Permission enthaelt kein Mikrofon?');
      setTimeout(() => setErr(''), 3000);
      return;
    }
    setCountdownMode('record');
    setCountdown(3);
  };

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      if (countdownMode === 'calibrate') {
        setCalibrateToken((t) => t + 1);
      } else if (countdownMode === 'record') {
        setTimeout(() => beginRecordingNow(), 50);
      }
      const t = setTimeout(() => { setCountdown(null); setCountdownMode(null); }, 400);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, countdownMode]);

  // UI-side timer while recording; buffer itself is ref-written per frame.
  useEffect(() => {
    if (!isRecording || recordStartMs === null) return;
    const id = setInterval(() => {
      setRecordElapsedMs(performance.now() - recordStartMs);
    }, 100);
    return () => clearInterval(id);
  }, [isRecording, recordStartMs]);

  const pickAudioMime = (): string => {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/mp4',
    ];
    for (const c of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(c)) return c;
    }
    return 'audio/webm';
  };

  const beginRecordingNow = () => {
    const audio = audioStreamRef.current;
    if (!audio) return;
    audioChunksRef.current = [];
    recordBufferRef.current = { startTime: performance.now(), frames: [] };
    recordingActiveRef.current = true;

    const mime = pickAudioMime();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(audio, { mimeType: mime });
    } catch (e) {
      console.error('[Mocap] MediaRecorder init failed:', e);
      recordingActiveRef.current = false;
      setErr('MediaRecorder konnte nicht gestartet werden: ' + (e as Error).message);
      return;
    }
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: mime });
      finalizeRecording(audioBlob, mime);
    };
    recorder.start(500);
    mediaRecorderRef.current = recorder;

    setIsRecording(true);
    setRecordStartMs(performance.now());
    setRecordElapsedMs(0);
  };

  const stopRecording = () => {
    if (!isRecording) return;
    recordingActiveRef.current = false;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop(); // triggers onstop → finalizeRecording
    } else {
      finalizeRecording(new Blob([], { type: 'audio/webm' }), 'audio/webm');
    }
    setIsRecording(false);
  };

  const handleSaveMocap = async (
    name: string,
    payload: {
      clipTracksPayload: ArrayBuffer;
      audioBlob: Blob;
      audioMimeType: string;
      durationSec: number;
    },
  ) => {
    if (!onMocapSaved) {
      setErr('Save-Handler fehlt (onMocapSaved nicht gesetzt)');
      setTimeout(() => setErr(''), 3000);
      return;
    }
    try {
      await onMocapSaved({
        name,
        clipTracksPayload: payload.clipTracksPayload,
        audioBlob: payload.audioBlob,
        audioMimeType: payload.audioMimeType,
        durationSec: payload.durationSec,
      });
      setPendingSave(null);
    } catch (e) {
      console.error('[Mocap] save failed:', e);
      setErr('Speichern fehlgeschlagen: ' + (e as Error).message);
      setTimeout(() => setErr(''), 3000);
    }
  };

  const finalizeRecording = (audioBlob: Blob, audioMime: string) => {
    const buffer = recordBufferRef.current;
    const durationSec = buffer.frames.length > 0
      ? buffer.frames[buffer.frames.length - 1].t
      : 0;
    if (buffer.frames.length === 0 || durationSec < 0.1) {
      setErr('Aufnahme zu kurz — keine Frames erfasst.');
      setTimeout(() => setErr(''), 3000);
      return;
    }
    const json = JSON.stringify({
      startTime: buffer.startTime,
      frames: buffer.frames,
    });
    const payload = new TextEncoder().encode(json).buffer as ArrayBuffer;
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const defaultName = `Mocap ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
    setPendingSave({
      clipTracksPayload: payload,
      audioBlob,
      audioMimeType: audioMime,
      durationSec,
      defaultName,
    });
  };
  const dragRef = useRef<null | {
    corner: 'tl' | 'tr' | 'bl' | 'br';
    startX: number; startY: number; startW: number; startH: number;
  }>(null);

  useEffect(() => {
    let active = true;
    let stream: MediaStream | null = null;

    // Sanity checks — bail early with a clear error
    if (!window.isSecureContext) {
      setErr('Webcam braucht HTTPS (secure context). Lade die Seite ueber https:// statt http://.');
      setStatus('error');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr('Dieser Browser unterstuetzt getUserMedia nicht.');
      setStatus('error');
      return;
    }

    // 1) Request webcam + microphone IMMEDIATELY — browser prompt should
    // appear instantly. Audio is needed later for the Record feature; we
    // isolate just the audio track into a separate stream for MediaRecorder
    // so video frames don't bleed into the recording.
    const webcamP = (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: true,
        });
        if (!active) { s.getTracks().forEach((t) => t.stop()); return null; }
        stream = s;
        const audioTrack = s.getAudioTracks()[0];
        if (audioTrack) {
          audioStreamRef.current = new MediaStream([audioTrack]);
        }
        if (videoRef.current) {
          // Feed only the video track into the preview element (no local
          // echo of our own microphone).
          const videoTrack = s.getVideoTracks()[0];
          videoRef.current.srcObject = videoTrack ? new MediaStream([videoTrack]) : s;
          await videoRef.current.play();
        }
        setStatus('webcam');
        return s;
      } catch (e) {
        console.error('[Mocap] webcam error:', e);
        setErr('Webcam-Zugriff verweigert: ' + (e as Error).message);
        setStatus('error');
        return null;
      }
    })();

    // 2) Load MediaPipe in parallel (slower — ~6MB WASM + model)
    const mpP = (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm',
        );
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
        if (!active) { landmarker.close(); return null; }
        landmarkerRef.current = landmarker;
        return landmarker;
      } catch (e) {
        console.error('[Mocap] MediaPipe init failed:', e);
        setErr('MediaPipe konnte nicht geladen werden: ' + (e as Error).message);
        setStatus('error');
        return null;
      }
    })();

    // 3) Once both ready, start detection loop
    Promise.all([webcamP, mpP]).then(([s, lm]) => {
      if (!active || !s || !lm) return;
      setStatus('ready');
      const loop = () => {
        if (!active) return;
        const video = videoRef.current;
        const overlay = overlayRef.current;
        if (video && landmarkerRef.current && video.readyState >= 2) {
          try {
            const res = landmarkerRef.current.detectForVideo(video, performance.now());
            poseRef.current.landmarks = res.landmarks?.[0] ?? null;
            poseRef.current.worldLandmarks = res.worldLandmarks?.[0] ?? null;
            if (overlay) drawSkeleton(overlay, video, poseRef.current.landmarks);
          } catch {
            // ignore per-frame errors
          }
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    });

    return () => {
      active = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#0d0d1a' }}>
      <Canvas camera={{ position: [0, 1, 3], fov: 50 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={1.2} />
        <group scale={[scale, scale, scale]} rotation={[0, Math.PI, 0]}>
          <PoseDrivenModel
            modelData={modelData}
            fileName={fileName}
            poseRef={poseRef}
            onBonesDiscovered={setBonesInfo}
            axisFlip={axisFlip}
            calibrateToken={calibrateToken}
            axisPerm={axisPerm}
            recordingActiveRef={recordingActiveRef}
            recordBufferRef={recordBufferRef}
          />
        </group>
        <ContactShadows position={[0, -1, 0]} opacity={0.4} blur={2} />
        <OrbitControls />
        <Environment preset="city" />
      </Canvas>

      {showWebcam && (
        <div
          style={{
            position: 'absolute', bottom: 16, right: 16,
            width: camSize.w, height: camSize.h,
            borderRadius: 12, overflow: 'hidden',
            border: '2px solid #6c63ff', boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            background: '#000', zIndex: 5,
          }}
        >
          <video
            ref={videoRef}
            playsInline muted autoPlay
            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
          />
          <canvas
            ref={overlayRef}
            width={640} height={480}
            style={{
              position: 'absolute', top: 0, left: 0,
              width: '100%', height: '100%', transform: 'scaleX(-1)',
              pointerEvents: 'none',
            }}
          />
          {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => {
            const pos = {
              tl: { top: -6, left: -6, cursor: 'nwse-resize' },
              tr: { top: -6, right: -6, cursor: 'nesw-resize' },
              bl: { bottom: -6, left: -6, cursor: 'nesw-resize' },
              br: { bottom: -6, right: -6, cursor: 'nwse-resize' },
            }[corner];
            return (
              <div
                key={corner}
                onPointerDown={(e) => {
                  e.preventDefault();
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  dragRef.current = {
                    corner,
                    startX: e.clientX, startY: e.clientY,
                    startW: camSize.w, startH: camSize.h,
                  };
                }}
                onPointerMove={(e) => {
                  const d = dragRef.current;
                  if (!d) return;
                  const dx = e.clientX - d.startX;
                  const dy = e.clientY - d.startY;
                  // Panel is anchored bottom-right. Each corner grows away from the anchor:
                  // tl: grow up+left (−dx widens, −dy heightens)
                  // tr: grow up (−dy). dx has no effect because right is pinned.
                  // bl: grow left (−dx). dy has no effect because bottom is pinned.
                  // br: acts like native resize (dx, dy); mostly useless at screen edge but kept for completeness.
                  let w = d.startW, h = d.startH;
                  if (corner === 'tl') { w = d.startW - dx; h = d.startH - dy; }
                  if (corner === 'tr') { h = d.startH - dy; }
                  if (corner === 'bl') { w = d.startW - dx; }
                  if (corner === 'br') { w = d.startW + dx; h = d.startH + dy; }
                  const maxW = window.innerWidth * 0.9;
                  const maxH = window.innerHeight * 0.9;
                  setCamSize({
                    w: Math.max(160, Math.min(maxW, w)),
                    h: Math.max(120, Math.min(maxH, h)),
                  });
                }}
                onPointerUp={(e) => {
                  (e.target as HTMLElement).releasePointerCapture(e.pointerId);
                  dragRef.current = null;
                }}
                style={{
                  position: 'absolute', ...pos,
                  width: 18, height: 18, background: '#6c63ff',
                  borderRadius: 4, opacity: 0.85,
                  touchAction: 'none',
                }}
                title="Ziehen zum Vergroessern"
              />
            );
          })}
        </div>
      )}

      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 5,
        display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <div style={{
          padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
          background: status === 'ready' ? 'rgba(46,125,50,0.3)' : status === 'error' ? 'rgba(211,47,47,0.3)' : 'rgba(255,152,0,0.3)',
          color: '#fff',
        }}>
          {status === 'init' && '🎥 Starte Webcam...'}
          {status === 'webcam' && '🎥 Webcam an — lade MediaPipe...'}
          {status === 'ready' && '🎥 Mocap aktiv'}
          {status === 'error' && `⚠ ${err}`}
        </div>
        <button
          onClick={() => setShowWebcam(!showWebcam)}
          style={{
            padding: '6px 12px', borderRadius: 8,
            background: showWebcam ? '#6c63ff' : 'rgba(255,255,255,0.08)',
            color: '#fff', border: '1px solid #333', fontSize: 12, cursor: 'pointer',
          }}
        >
          {showWebcam ? '📷 Webcam' : '📷 Webcam zeigen'}
        </button>
        {bonesInfo && (
          <button
            onClick={() => setShowBones(!showBones)}
            style={{
              padding: '6px 12px', borderRadius: 8,
              background: showBones ? '#6c63ff' : 'rgba(255,255,255,0.08)',
              color: '#fff', border: '1px solid #333', fontSize: 12, cursor: 'pointer',
            }}
          >
            🦴 Bones ({Object.values(bonesInfo.mapping).filter(Boolean).length}/{Object.keys(bonesInfo.mapping).length})
          </button>
        )}
        <div style={{
          display: 'flex', gap: 4, padding: '4px 6px', borderRadius: 8,
          background: 'rgba(255,255,255,0.06)', alignItems: 'center',
        }}>
          <span style={{ color: '#888', fontSize: 11, marginRight: 2 }}>Map:</span>
          <button
            onClick={() => {
              const i = PERMS.indexOf(axisPerm);
              setAxisPerm(PERMS[(i + 1) % PERMS.length]);
            }}
            title="Achsen-Reihenfolge zyklen (XYZ → XZY → YXZ → YZX → ZXY → ZYX → XYZ)"
            style={{
              padding: '4px 10px', borderRadius: 6,
              background: axisPerm !== 'XYZ' ? '#6c63ff' : 'rgba(255,255,255,0.05)',
              color: '#fff', border: '1px solid #333', fontSize: 12,
              fontFamily: 'monospace', fontWeight: 700, cursor: 'pointer',
              minWidth: 54, textAlign: 'center',
            }}
          >
            {axisPerm}
          </button>
          {axisPerm !== 'XYZ' && (
            <button
              onClick={() => setAxisPerm('XYZ')}
              title="Zuruecksetzen auf XYZ"
              style={{
                padding: '4px 8px', borderRadius: 6,
                background: '#d32f2f', color: '#fff', border: 'none',
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}
            >
              ↺
            </button>
          )}
        </div>
        <div style={{
          display: 'flex', gap: 4, padding: '4px 6px', borderRadius: 8,
          background: 'rgba(255,255,255,0.06)', alignItems: 'center',
        }}>
          <span style={{ color: '#888', fontSize: 11, marginRight: 2 }}>Flip:</span>
          {(['x', 'y', 'z'] as const).map((axis) => (
            <button
              key={axis}
              onClick={() => setAxisFlip((f) => ({ ...f, [axis]: !f[axis] }))}
              style={{
                padding: '4px 10px', borderRadius: 6,
                background: axisFlip[axis] ? '#6c63ff' : 'rgba(255,255,255,0.05)',
                color: '#fff', border: '1px solid #333', fontSize: 12,
                fontWeight: 700, cursor: 'pointer', minWidth: 28,
              }}
              title={`${axis.toUpperCase()} invertieren`}
            >
              {axis.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          onClick={startCalibration}
          disabled={countdown !== null || isRecording}
          style={{
            padding: '6px 12px', borderRadius: 8,
            background: (countdown !== null || isRecording) ? '#555' : '#2d6a4f',
            color: '#fff',
            border: '1px solid #1b4d36', fontSize: 12,
            fontWeight: 600, cursor: (countdown !== null || isRecording) ? 'default' : 'pointer',
            whiteSpace: 'nowrap', opacity: (countdown !== null || isRecording) ? 0.7 : 1,
          }}
          title="Countdown startet — stelle dich in T-Pose und halt still"
        >
          🔒 Kalibrieren
        </button>
        {!isRecording ? (
          <button
            onClick={startRecording}
            disabled={countdown !== null || calibrateToken === 0}
            style={{
              padding: '6px 12px', borderRadius: 8,
              background: (countdown !== null || calibrateToken === 0) ? '#555' : '#c62828',
              color: '#fff',
              border: '1px solid #8e0000', fontSize: 12,
              fontWeight: 700, cursor: (countdown !== null || calibrateToken === 0) ? 'default' : 'pointer',
              whiteSpace: 'nowrap', opacity: (countdown !== null || calibrateToken === 0) ? 0.7 : 1,
            }}
            title={calibrateToken === 0 ? 'Erst kalibrieren' : 'Recording starten — 3s Countdown'}
          >
            🔴 Aufnehmen
          </button>
        ) : (
          <button
            onClick={stopRecording}
            style={{
              padding: '6px 14px', borderRadius: 8,
              background: '#c62828', color: '#fff',
              border: '2px solid #fff', fontSize: 13,
              fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
              boxShadow: '0 0 0 2px rgba(198,40,40,0.4)',
            }}
            title="Aufnahme stoppen"
          >
            ⏹ Stop
          </button>
        )}
      </div>

      {countdown !== null && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', zIndex: 20,
        }}>
          <div style={{
            fontSize: 'clamp(120px, 22vw, 260px)',
            fontWeight: 900, color: '#fff',
            textShadow: countdownMode === 'record'
              ? '0 6px 40px rgba(198,40,40,0.9), 0 0 20px rgba(0,0,0,0.6)'
              : '0 6px 40px rgba(108,99,255,0.9), 0 0 20px rgba(0,0,0,0.6)',
            lineHeight: 1,
          }}>
            {countdown === 0
              ? (countdownMode === 'record' ? '🔴' : '🔒')
              : countdown}
          </div>
          <div style={{
            marginTop: 16, fontSize: 18, color: '#fff',
            background: 'rgba(22,22,42,0.7)', padding: '8px 20px',
            borderRadius: 20, fontWeight: 600,
          }}>
            {countdownMode === 'record'
              ? (countdown === 0 ? 'Recording laeuft!' : 'Recording startet in...')
              : (countdown === 0 ? 'Kalibriert!' : 'T-Pose einnehmen und still halten')}
          </div>
        </div>
      )}

      {isRecording && (
        <div style={{
          position: 'absolute', top: 58, left: '50%', transform: 'translateX(-50%)',
          zIndex: 7, padding: '8px 18px', borderRadius: 20,
          background: 'rgba(198,40,40,0.9)', color: '#fff',
          fontFamily: 'monospace', fontSize: 16, fontWeight: 700,
          boxShadow: '0 2px 12px rgba(198,40,40,0.5)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{
            width: 10, height: 10, borderRadius: '50%',
            background: '#fff', animation: 'pulse 1s ease-in-out infinite',
          }} />
          REC {formatElapsed(recordElapsedMs)}
        </div>
      )}

      {pendingSave && (
        <div
          onClick={(e) => e.target === e.currentTarget && setPendingSave(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 100, padding: 16,
          }}
        >
          <div style={{
            background: '#16162a', borderRadius: 16, padding: 28,
            maxWidth: 440, width: '100%',
          }}>
            <div style={{ fontSize: 32, marginBottom: 10, textAlign: 'center' }}>💾</div>
            <h3 style={{ color: '#fff', margin: '0 0 14px', fontSize: 18, textAlign: 'center' }}>
              Mocap speichern
            </h3>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 16, textAlign: 'center' }}>
              Dauer: {pendingSave.durationSec.toFixed(1)}s · Audio: {(pendingSave.audioBlob.size / 1024).toFixed(0)} KB
            </div>
            <input
              type="text"
              defaultValue={pendingSave.defaultName}
              id="mocap-save-name"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8,
                background: 'rgba(255,255,255,0.06)', border: '1px solid #333',
                color: '#fff', fontSize: 14, marginBottom: 18, boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setPendingSave(null)}
                style={{
                  flex: 1, padding: '12px 14px', borderRadius: 10,
                  background: 'rgba(255,255,255,0.08)', color: '#fff',
                  border: '1px solid #333', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Abbrechen
              </button>
              <button
                onClick={() => {
                  const el = document.getElementById('mocap-save-name') as HTMLInputElement | null;
                  const name = (el?.value || pendingSave.defaultName).trim() || pendingSave.defaultName;
                  handleSaveMocap(name, pendingSave);
                }}
                style={{
                  flex: 1, padding: '12px 14px', borderRadius: 10,
                  background: '#6c63ff', color: '#fff',
                  border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>


      {bonesInfo && showBones && (
        <div style={{
          position: 'absolute', top: 58, left: 12, zIndex: 6,
          background: 'rgba(22,22,42,0.95)', borderRadius: 12,
          padding: 14, maxWidth: 520, maxHeight: '70vh', overflow: 'auto',
          border: '1px solid #333', boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          fontSize: 12, color: '#ccc',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ color: '#fff', fontSize: 13 }}>Mocap-Bone-Mapping</strong>
            <div style={{ flex: 1 }} />
            <button
              onClick={async () => {
                const text = [
                  '=== Mapping ===',
                  ...Object.entries(bonesInfo.mapping).map(([k, v]) => `${k}: ${v ?? 'NOT FOUND'}`),
                  '',
                  '=== All bones in model ===',
                  ...bonesInfo.all,
                ].join('\n');
                try { await navigator.clipboard.writeText(text); }
                catch { /* clipboard may fail over http or in private tabs */ }
              }}
              style={{
                background: '#6c63ff', color: '#fff', border: 'none',
                borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
              }}
            >
              📋 Kopieren
            </button>
          </div>
          <div style={{ marginBottom: 10 }}>
            {Object.entries(bonesInfo.mapping).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
                <span style={{ color: v ? '#4caf50' : '#d32f2f', width: 14 }}>
                  {v ? '✓' : '✗'}
                </span>
                <span style={{ width: 120, color: '#888' }}>{k}</span>
                <span style={{ color: v ? '#fff' : '#777' }}>{v ?? '— nicht gefunden'}</span>
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid #333', paddingTop: 8 }}>
            <div style={{ color: '#888', marginBottom: 4 }}>
              Alle Bones im Modell ({bonesInfo.all.length}):
            </div>
            <div style={{
              fontFamily: 'monospace', fontSize: 11,
              wordBreak: 'break-all', lineHeight: 1.5,
            }}>
              {bonesInfo.all.join(', ')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function drawSkeleton(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  landmarks: NormalizedLandmark[] | null,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarks) return;
  const w = canvas.width, h = canvas.height;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#6c63ff';
  for (const [a, b] of SKELETON_EDGES) {
    const la = landmarks[a], lb = landmarks[b];
    if (!la || !lb) continue;
    ctx.beginPath();
    ctx.moveTo(la.x * w, la.y * h);
    ctx.lineTo(lb.x * w, lb.y * h);
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  for (const lm of landmarks) {
    ctx.beginPath();
    ctx.arc(lm.x * w, lm.y * h, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Suppress unused warning
  void video;
}

/**
 * Simple pose → bone driver. Maps MediaPipe landmarks to upper-body bones
 * on the loaded rig using name-matching heuristics (Mixamo-style).
 */
// 6 axis orderings for remapping MediaPipe axes onto the model's axes.
// Each name "ABC" means: new vector = (old.A, old.B, old.C). E.g., "YZX"
// means the new X is the old Y, new Y is the old Z, new Z is the old X.
const PERMS = ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'] as const;
type AxisPerm = typeof PERMS[number];

function applyAxisPerm(v: THREE.Vector3, perm: AxisPerm): THREE.Vector3 {
  const { x, y, z } = v;
  switch (perm) {
    case 'XYZ': return v.set(x, y, z);
    case 'XZY': return v.set(x, z, y);
    case 'YXZ': return v.set(y, x, z);
    case 'YZX': return v.set(y, z, x);
    case 'ZXY': return v.set(z, x, y);
    case 'ZYX': return v.set(z, y, x);
  }
}

// Per-bone: which landmark pair defines its direction
const BONE_PAIRS: Record<string, [number, number]> = {
  leftArm: [L.leftShoulder, L.leftElbow],
  leftForeArm: [L.leftElbow, L.leftWrist],
  rightArm: [L.rightShoulder, L.rightElbow],
  rightForeArm: [L.rightElbow, L.rightWrist],
  leftUpLeg: [L.leftHip, L.leftKnee],
  leftLeg: [L.leftKnee, L.leftAnkle],
  rightUpLeg: [L.rightHip, L.rightKnee],
  rightLeg: [L.rightKnee, L.rightAnkle],
};

interface BindState {
  // Snapshotted ONCE at model load — never mutates. All calibrations and
  // per-frame driving compute relative to this, not to the currently-driven
  // (and potentially deformed) state.
  localQuats: Map<THREE.Object3D, THREE.Quaternion>;
  worldQuats: Map<THREE.Object3D, THREE.Quaternion>;
  worldDirs: Map<THREE.Object3D, THREE.Vector3>;
}

interface RestState {
  // MediaPipe reference directions captured when the user clicks Kalibrieren
  // (while model is reset to bind pose). Per-frame delta is computed as
  // rotation from mpDir → current MP dir, then applied on top of bindWorldQuat.
  mpDirs: Map<THREE.Object3D, THREE.Vector3>;
}

interface RecordFrame {
  t: number;
  quats: Array<{ boneName: string; x: number; y: number; z: number; w: number }>;
}
interface RecordBuffer { startTime: number; frames: RecordFrame[] }

function PoseDrivenModel({
  modelData,
  fileName,
  poseRef,
  onBonesDiscovered,
  axisFlip,
  calibrateToken,
  axisPerm,
  recordingActiveRef,
  recordBufferRef,
}: {
  modelData: ArrayBuffer;
  fileName: string;
  poseRef: React.MutableRefObject<PoseRef>;
  onBonesDiscovered?: (info: { mapping: Record<string, string | null>; all: string[] }) => void;
  axisFlip: { x: boolean; y: boolean; z: boolean };
  calibrateToken: number;
  axisPerm: AxisPerm;
  recordingActiveRef?: React.MutableRefObject<boolean>;
  recordBufferRef?: React.MutableRefObject<RecordBuffer>;
}) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const bonesRef = useRef<Record<string, THREE.Object3D | null>>({});

  useEffect(() => {
    const ext = fileName.toLowerCase().split('.').pop();
    if (ext !== 'glb' && ext !== 'gltf') return;
    const loader = new GLTFLoader();
    loader.parse(modelData, '', (gltf) => {
      centerAndScale(gltf.scene);
      setObject(gltf.scene);
    });
  }, [modelData, fileName]);

  // Resolve bones once the model loads
  useEffect(() => {
    if (!object) return;
    const find = (variants: string[]): THREE.Object3D | null => {
      for (const v of variants) {
        const o = object.getObjectByName(v);
        if (o) return o;
      }
      // Fallback: case-insensitive / separator-insensitive
      const norm = (s: string) => s.toLowerCase().replace(/[_.:\s|]/g, '');
      const want = new Set(variants.map(norm));
      let hit: THREE.Object3D | null = null;
      object.traverse((o) => {
        if (hit) return;
        if (o.name && want.has(norm(o.name))) hit = o;
      });
      return hit;
    };
    bonesRef.current = {
      // Arms
      leftArm: find([
        'mixamorigLeftArm', 'LeftArm', 'UpperArm.L', 'upper_arm.L', 'arm_L', 'shoulder.L',
        'L_Upperarm', 'L_UpperArm', 'L_Arm', 'Upperarm_L', 'UpperArm_L',
      ]),
      leftForeArm: find([
        'mixamorigLeftForeArm', 'LeftForeArm', 'ForeArm.L', 'lower_arm.L', 'forearm.L',
        'L_Forearm', 'L_ForeArm', 'Forearm_L', 'ForeArm_L',
      ]),
      rightArm: find([
        'mixamorigRightArm', 'RightArm', 'UpperArm.R', 'upper_arm.R', 'arm_R', 'shoulder.R',
        'R_Upperarm', 'R_UpperArm', 'R_Arm', 'Upperarm_R', 'UpperArm_R',
      ]),
      rightForeArm: find([
        'mixamorigRightForeArm', 'RightForeArm', 'ForeArm.R', 'lower_arm.R', 'forearm.R',
        'R_Forearm', 'R_ForeArm', 'Forearm_R', 'ForeArm_R',
      ]),
      // Legs
      leftUpLeg: find([
        'mixamorigLeftUpLeg', 'LeftUpLeg', 'UpperLeg.L', 'upper_leg.L', 'thigh.L', 'Thigh_L',
        'L_Thigh', 'L_UpLeg', 'L_UpperLeg', 'Thigh_L',
      ]),
      leftLeg: find([
        'mixamorigLeftLeg', 'LeftLeg', 'LowerLeg.L', 'lower_leg.L', 'calf.L', 'shin.L',
        'L_Calf', 'L_LowerLeg', 'L_Shin', 'Calf_L',
      ]),
      rightUpLeg: find([
        'mixamorigRightUpLeg', 'RightUpLeg', 'UpperLeg.R', 'upper_leg.R', 'thigh.R', 'Thigh_R',
        'R_Thigh', 'R_UpLeg', 'R_UpperLeg', 'Thigh_R',
      ]),
      rightLeg: find([
        'mixamorigRightLeg', 'RightLeg', 'LowerLeg.R', 'lower_leg.R', 'calf.R', 'shin.R',
        'R_Calf', 'R_LowerLeg', 'R_Shin', 'Calf_R',
      ]),
      // Spine chain
      spine: find(['mixamorigSpine', 'Spine', 'spine', 'Spine01', 'Spine1', 'Waist']),
      spine1: find(['mixamorigSpine1', 'Spine1', 'Chest', 'chest', 'Spine02', 'Spine2']),
      neck: find(['mixamorigNeck', 'Neck', 'neck', 'NeckTwist01', 'Neck01']),
      head: find(['mixamorigHead', 'Head', 'head']),
    };
    const mapping = Object.fromEntries(
      Object.entries(bonesRef.current).map(([k, v]) => [k, v?.name ?? null]),
    );
    const allBones: string[] = [];
    object.traverse((o) => { if (o.name) allBones.push(o.name); });
    onBonesDiscovered?.({ mapping, all: allBones.sort() });

    // Snapshot bind pose ONCE. This is the immutable "original" rest we
    // return to whenever we recalibrate. Without this, every calibration
    // would compound on top of the previously-driven pose.
    object.updateMatrixWorld(true);
    const localQuats = new Map<THREE.Object3D, THREE.Quaternion>();
    const worldQuats = new Map<THREE.Object3D, THREE.Quaternion>();
    const worldDirs = new Map<THREE.Object3D, THREE.Vector3>();
    for (const bone of Object.values(bonesRef.current)) {
      if (!bone) continue;
      localQuats.set(bone, bone.quaternion.clone());
      worldQuats.set(bone, bone.getWorldQuaternion(new THREE.Quaternion()));
      const dir = computeBoneRestWorldDir(bone);
      if (dir) worldDirs.set(bone, dir);
    }
    bindRef.current = { localQuats, worldQuats, worldDirs };
    // Invalidate any prior calibration — user must recalibrate after remount.
    restRef.current = null;
    lastCalibTokenRef.current = 0;
  }, [object, onBonesDiscovered]);

  const bindRef = useRef<BindState | null>(null);
  const restRef = useRef<RestState | null>(null);
  const lastCalibTokenRef = useRef(0);

  // Helper: compute world direction from MediaPipe landmark indices
  const dirFromLandmarks = (
    wl: Landmark[],
    startIdx: number,
    endIdx: number,
    sx: number, sy: number, sz: number,
  ): THREE.Vector3 | null => {
    const a = wl[startIdx], b = wl[endIdx];
    if (!a || !b) return null;
    const v = new THREE.Vector3(
      (b.x - a.x) * sx,
      (b.y - a.y) * sy,
      (b.z - a.z) * sz,
    );
    if (v.lengthSq() < 1e-6) return null;
    return v.normalize();
  };

  const dirFromMidpoints = (
    wl: Landmark[],
    sa: number, sb: number, ea: number, eb: number,
    sx: number, sy: number, sz: number,
  ): THREE.Vector3 | null => {
    const a1 = wl[sa], a2 = wl[sb], b1 = wl[ea], b2 = wl[eb];
    if (!a1 || !a2 || !b1 || !b2) return null;
    const v = new THREE.Vector3(
      ((b1.x + b2.x) / 2 - (a1.x + a2.x) / 2) * sx,
      ((b1.y + b2.y) / 2 - (a1.y + a2.y) / 2) * sy,
      ((b1.z + b2.z) / 2 - (a1.z + a2.z) / 2) * sz,
    );
    if (v.lengthSq() < 1e-6) return null;
    return v.normalize();
  };

  // Compute the actual world direction this bone points at rest, from the
  // skeleton itself (bone head → first bone-child head). Falls back to
  // applying bone.worldQuaternion to +Y (Mixamo-style length axis).
  const computeBoneRestWorldDir = (bone: THREE.Object3D): THREE.Vector3 | null => {
    const childBone = bone.children.find((c) => (c as THREE.Bone).isBone) as THREE.Object3D | undefined;
    if (childBone) {
      const parentPos = new THREE.Vector3();
      const childPos = new THREE.Vector3();
      bone.getWorldPosition(parentPos);
      childBone.getWorldPosition(childPos);
      const dir = childPos.sub(parentPos);
      if (dir.lengthSq() > 1e-8) return dir.normalize();
    }
    const q = bone.getWorldQuaternion(new THREE.Quaternion());
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    return dir.lengthSq() > 1e-8 ? dir.normalize() : null;
  };

  // Helper: compute the current MediaPipe direction for a bone key
  const currentMpDirFor = (
    key: string,
    wl: Landmark[],
    sx: number, sy: number, sz: number,
  ): THREE.Vector3 | null => {
    const pair = BONE_PAIRS[key];
    if (pair) return dirFromLandmarks(wl, pair[0], pair[1], sx, sy, sz);
    if (key === 'spine' || key === 'spine1') {
      return dirFromMidpoints(wl, L.leftHip, L.rightHip, L.leftShoulder, L.rightShoulder, sx, sy, sz);
    }
    if (key === 'neck') {
      const a1 = wl[L.leftShoulder], a2 = wl[L.rightShoulder], b = wl[L.nose];
      if (a1 && a2 && b) {
        const v = new THREE.Vector3(
          (b.x - (a1.x + a2.x) / 2) * sx,
          (b.y - (a1.y + a2.y) / 2) * sy,
          (b.z - (a1.z + a2.z) / 2) * sz,
        );
        if (v.lengthSq() > 1e-6) return v.normalize();
      }
    }
    return null;
  };

  // Calibration: reset all driven bones to their BIND pose first, then
  // snapshot the user's current MediaPipe directions as the "rest reference".
  // This way each calibration is independent — it never compounds on the
  // previously-driven (deformed) pose.
  useFrame(() => {
    if (!object || !bindRef.current) return;
    if (calibrateToken === 0) return;
    if (calibrateToken === lastCalibTokenRef.current && restRef.current) return;

    const wl = poseRef.current.worldLandmarks;
    if (!wl) return;

    // Reset every driven bone back to bind pose so the snapshot below reads
    // the ORIGINAL rest state, not the currently-driven one.
    for (const [bone, localQ] of bindRef.current.localQuats) {
      bone.quaternion.copy(localQ);
    }
    object.updateMatrixWorld(true);

    const sx = axisFlip.x ? -1 : 1;
    const sy = axisFlip.y ? -1 : 1;
    const sz = axisFlip.z ? -1 : 1;

    const mpDirs = new Map<THREE.Object3D, THREE.Vector3>();
    for (const [key, bone] of Object.entries(bonesRef.current)) {
      if (!bone) continue;
      const dir = currentMpDirFor(key, wl, sx, sy, sz);
      if (!dir) continue;
      mpDirs.set(bone, dir);
    }

    if (mpDirs.size > 0) {
      restRef.current = { mpDirs };
      lastCalibTokenRef.current = calibrateToken;
      console.log(`[Mocap] calibrated ${mpDirs.size} bones (bind-pose reset + fresh MP reference)`);
    }
  });

  // Per-frame: drive each bone using bind pose + (MP rest → MP current) delta.
  useFrame(() => {
    const wl = poseRef.current.worldLandmarks;
    if (!wl || !object || !bindRef.current || !restRef.current) return;

    const sx = axisFlip.x ? -1 : 1;
    const sy = axisFlip.y ? -1 : 1;
    const sz = axisFlip.z ? -1 : 1;

    const tmp = new THREE.Quaternion();
    const tmp2 = new THREE.Quaternion();

    for (const [key, bone] of Object.entries(bonesRef.current)) {
      if (!bone || !bone.parent) continue;
      const bindWorldQuat = bindRef.current.worldQuats.get(bone);
      const mpRestDir = restRef.current.mpDirs.get(bone);
      if (!bindWorldQuat || !mpRestDir) continue;

      const currDir = currentMpDirFor(key, wl, sx, sy, sz);
      if (!currDir) continue;

      // Apply the global axis permutation to BOTH rest and current MP
      // directions. This remaps which MediaPipe axis becomes which Three.js
      // axis (e.g. "YZX" makes X→Y, Y→Z, Z→X) — exactly the "swap axes"
      // operation. Mutates copies; the cached mpRestDir stays intact.
      const restPerm = applyAxisPerm(mpRestDir.clone(), axisPerm);
      const currPerm = applyAxisPerm(currDir, axisPerm);

      // Delta = rotation that took (permuted) MP direction from rest to current.
      const delta = tmp.setFromUnitVectors(restPerm, currPerm);

      // Apply to the IMMUTABLE bind-pose world quaternion.
      const newWorld = delta.multiply(bindWorldQuat);
      // Convert to local relative to parent's CURRENT world.
      const parentInv = bone.parent.getWorldQuaternion(tmp2).invert();
      const newLocal = parentInv.multiply(newWorld);

      bone.quaternion.slerp(newLocal, 0.4);
    }

    // Record-capture: snapshot each tracked bone's current LOCAL quaternion
    // AFTER driving. Local (not world) because that's what an AnimationClip
    // replays — re-attached to the same rig hierarchy.
    if (recordingActiveRef?.current && recordBufferRef) {
      const t = (performance.now() - recordBufferRef.current.startTime) / 1000;
      const quats: RecordFrame['quats'] = [];
      for (const bone of Object.values(bonesRef.current)) {
        if (!bone || !bone.name) continue;
        const q = bone.quaternion;
        quats.push({ boneName: bone.name, x: q.x, y: q.y, z: q.z, w: q.w });
      }
      if (quats.length > 0) {
        recordBufferRef.current.frames.push({ t, quats });
      }
    }
  });

  if (!object) return <Html center><div style={{ color: '#888' }}>Lade Modell...</div></Html>;
  return <primitive object={object} />;
}

function centerAndScale(object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = 2 / maxDim;
  object.position.sub(center);
  object.scale.multiplyScalar(scale);
}
