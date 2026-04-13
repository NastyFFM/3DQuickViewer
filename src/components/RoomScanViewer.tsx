import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { createXRStore, XR, XROrigin } from '@react-three/xr';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';

// Single store — no customSessionInit (it overrides everything)
const store = createXRStore({
  hand: { touchPointer: true, rayPointer: true },
  controller: { rayPointer: true },
  hitTest: 'required',
});

// Inject camera-access into AR session requests.
// customSessionInit would override all built-in features (hit-test, hand tracking, etc.),
// so we patch requestSession to append camera-access as optional instead.
if (typeof navigator !== 'undefined' && navigator.xr) {
  const _origRequestSession = navigator.xr.requestSession.bind(navigator.xr);
  (navigator.xr as any).requestSession = (mode: XRSessionMode, init?: any) => {
    if (mode === 'immersive-ar') {
      init = init || {};
      init.optionalFeatures = [...(init.optionalFeatures || []), 'camera-access'];
    }
    return _origRequestSession(mode, init);
  };
}

/**
 * Diagnostic component — checks every frame what XR features are available
 * and reports to parent via callback. Completely independent of hit-tests.
 */
function CameraDiagnostics({ onLog }: { onLog: (log: string) => void }) {
  const { gl } = useThree();
  const frameCount = useRef(0);

  useFrame(() => {
    frameCount.current++;
    if (frameCount.current % 60 !== 1) return; // Update once per second

    const renderer = gl as THREE.WebGLRenderer;
    const lines: string[] = [];

    // Session
    const session = renderer.xr.getSession();
    lines.push(session ? 'Session: ✓' : 'Session: ✗');

    if (!session) { onLog(lines.join(' | ')); return; }

    // Reference space
    const refSpace = renderer.xr.getReferenceSpace();
    lines.push(refSpace ? 'RefSpace: ✓' : 'RefSpace: ✗');

    // Frame
    const frame = (renderer.xr as any).getFrame?.() as XRFrame | null;
    lines.push(frame ? 'Frame: ✓' : 'Frame: ✗');

    if (!frame || !refSpace) { onLog(lines.join(' | ')); return; }

    // Viewer pose
    const pose = frame.getViewerPose(refSpace);
    lines.push(pose ? `Views: ${pose.views.length}` : 'Pose: ✗');

    if (pose?.views?.length) {
      const view = pose.views[0];
      // view.camera
      const xrCam = (view as any).camera;
      lines.push(xrCam ? `XRCamera: ${xrCam.width}x${xrCam.height}` : 'XRCamera: null');

      // getCameraTexture
      const fn = (renderer.xr as any).getCameraTexture;
      lines.push(typeof fn === 'function' ? 'getCamTex: ✓' : 'getCamTex: ✗');

      // Try calling it
      if (xrCam && typeof fn === 'function') {
        try {
          const tex = fn.call(renderer.xr, xrCam);
          lines.push(tex ? `Texture: ✓ (${tex.constructor.name})` : 'Texture: null');
        } catch (e: any) {
          lines.push(`Texture: ERR ${e.message?.substring(0, 30)}`);
        }
      }
    }

    // Enabled features
    const ef = (session as any).enabledFeatures as string[] | undefined;
    const hasCamFeature = ef?.includes('camera-access');
    lines.push(hasCamFeature ? 'cam-access: ✓' : 'cam-access: ✗');

    // Input sources
    lines.push(`Inputs: ${session.inputSources.length}`);

    onLog(lines.join(' | '));
  });

  return null;
}

interface ColoredPoint {
  x: number; y: number; z: number;
  r: number; g: number; b: number;
}

/** Project a 3D world point to camera pixel coords via view + projection matrices. */
function worldToPixel(
  pt: { x: number; y: number; z: number },
  viewMatrix: Float32Array,
  projMatrix: Float32Array,
  width: number,
  height: number,
): { px: number; py: number } | null {
  const { x, y, z } = pt;
  // World → View space (column-major 4x4)
  const vx = viewMatrix[0] * x + viewMatrix[4] * y + viewMatrix[8] * z + viewMatrix[12];
  const vy = viewMatrix[1] * x + viewMatrix[5] * y + viewMatrix[9] * z + viewMatrix[13];
  const vz = viewMatrix[2] * x + viewMatrix[6] * y + viewMatrix[10] * z + viewMatrix[14];
  const vw = viewMatrix[3] * x + viewMatrix[7] * y + viewMatrix[11] * z + viewMatrix[15];
  // View → Clip space
  const cx = projMatrix[0] * vx + projMatrix[4] * vy + projMatrix[8] * vz + projMatrix[12] * vw;
  const cy = projMatrix[1] * vx + projMatrix[5] * vy + projMatrix[9] * vz + projMatrix[13] * vw;
  const cw = projMatrix[3] * vx + projMatrix[7] * vy + projMatrix[11] * vz + projMatrix[15] * vw;
  if (cw <= 0) return null; // behind camera
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1) return null;
  // NDC → pixel  (readRenderTargetPixels origin = bottom-left, y-up = NDC y-up)
  const px = Math.min(Math.max(Math.round(((ndcX + 1) / 2) * (width - 1)), 0), width - 1);
  const py = Math.min(Math.max(Math.round(((ndcY + 1) / 2) * (height - 1)), 0), height - 1);
  return { px, py };
}

/**
 * NxN hit-test grid for scanning
 */
function HitTestGrid({ gridSize, useColor, onSnapshot, onLiveInfo }: {
  gridSize: number;
  useColor: boolean;
  onSnapshot: (points: ColoredPoint[]) => void;
  onLiveInfo: (info: string) => void;
}) {
  const { gl, scene } = useThree();
  const hitSourcesRef = useRef<any[]>([]);
  const livePointsRef = useRef<ColoredPoint[]>([]);
  const previewGroupRef = useRef(new THREE.Group());
  const previewPointsRef = useRef<THREE.Points | null>(null);
  const sourcesCreated = useRef(false);
  const lastGridSize = useRef(0);

  // Ref to avoid stale closure on useColor in event handlers
  const useColorRef = useRef(useColor);
  useColorRef.current = useColor;

  // getUserMedia video fallback for devices without camera-access WebXR feature
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoReadyRef = useRef(false);

  // Snapshot debug feedback (shown in HUD for 8 seconds)
  const snapInfoRef = useRef('');
  const snapTimeRef = useRef(0);

  useEffect(() => {
    if (!useColor) return;
    let cancelled = false;
    navigator.mediaDevices?.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
    }).then((stream) => {
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
      const video = document.createElement('video');
      video.setAttribute('playsinline', '');
      video.srcObject = stream;
      video.onloadedmetadata = () => { videoReadyRef.current = true; };
      video.play();
      videoRef.current = video;
      console.log('[Scan] getUserMedia fallback ready');
    }).catch((err) => {
      console.log('[Scan] getUserMedia fallback unavailable:', err.message);
    });
    return () => {
      cancelled = true;
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      }
      videoRef.current = null;
      videoReadyRef.current = false;
    };
  }, [useColor]);

  useEffect(() => {
    scene.add(previewGroupRef.current);
    return () => { scene.remove(previewGroupRef.current); };
  }, [scene]);

  useEffect(() => {
    const renderer = gl as THREE.WebGLRenderer;
    const createSources = async () => {
      const session = renderer.xr.getSession();
      if (!session) return;
      for (const src of hitSourcesRef.current) { src.cancel(); }
      hitSourcesRef.current = [];
      sourcesCreated.current = false;
      try {
        const viewerSpace = await session.requestReferenceSpace('viewer');
        const fovRad = (60 * Math.PI) / 180;
        for (let y = 0; y < gridSize; y++) {
          for (let x = 0; x < gridSize; x++) {
            const nx = (x / (gridSize - 1)) - 0.5;
            const ny = (y / (gridSize - 1)) - 0.5;
            const ray = new XRRay(
              new DOMPoint(0, 0, 0, 1),
              new DOMPoint(Math.tan(nx * fovRad), -Math.tan(ny * fovRad), -1, 0)
            );
            const source = await session.requestHitTestSource!({ space: viewerSpace, offsetRay: ray });
            hitSourcesRef.current.push(source);
          }
        }
        sourcesCreated.current = true;
        lastGridSize.current = gridSize;
      } catch (err) {
        onLiveInfo('Hit-Test Error: ' + (err as Error).message);
      }
    };
    const check = setInterval(() => {
      if (renderer.xr.getSession() && (lastGridSize.current !== gridSize || !sourcesCreated.current)) createSources();
    }, 500);
    return () => {
      clearInterval(check);
      for (const src of hitSourcesRef.current) { try { src.cancel(); } catch {} }
      hitSourcesRef.current = [];
    };
  }, [gl, gridSize, onLiveInfo]);

  useFrame(() => {
    const renderer = gl as THREE.WebGLRenderer;
    const frame = (renderer.xr as any).getFrame?.() as XRFrame | null;
    const refSpace = renderer.xr.getReferenceSpace();
    if (!frame || !refSpace || !sourcesCreated.current) return;

    if (previewPointsRef.current) {
      previewGroupRef.current.remove(previewPointsRef.current);
      previewPointsRef.current.geometry.dispose();
      (previewPointsRef.current.material as THREE.Material).dispose();
      previewPointsRef.current = null;
    }

    // Live preview: ALWAYS use fast height-coloring (no GPU readback)
    const positions: number[] = [];
    const colors: number[] = [];
    const currentPoints: ColoredPoint[] = [];

    for (const source of hitSourcesRef.current) {
      const results = frame.getHitTestResults(source);
      if (results.length > 0) {
        const pose = results[0].getPose(refSpace);
        if (pose) {
          const p = pose.transform.position;
          const t = Math.min(Math.max((p.y + 0.5) / 3, 0), 1);
          positions.push(p.x, p.y, p.z);
          colors.push(0.3 + t * 0.7, 0.8 - t * 0.3, 0.5);
          currentPoints.push({ x: p.x, y: p.y, z: p.z, r: 0.3 + t * 0.7, g: 0.8 - t * 0.3, b: 0.5 });
        }
      }
    }
    livePointsRef.current = currentPoints;

    if (positions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      previewPointsRef.current = new THREE.Points(geo, new THREE.PointsMaterial({
        size: 0.015, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.6,
      }));
      previewGroupRef.current.add(previewPointsRef.current);
    }
    // Check camera availability for info display
    let camStatus = '';
    if (useColor) {
      const vp = frame.getViewerPose(refSpace);
      const hasViewCam = !!(vp?.views?.[0] as any)?.camera;
      const hasVideo = videoReadyRef.current;
      camStatus = hasViewCam ? ' 📷XR' : hasVideo ? ' 📷Video' : ' 📷✗';
    }
    const snapAge = Date.now() - snapTimeRef.current;
    const snapInfo = snapAge < 8000 && snapInfoRef.current ? ` · ${snapInfoRef.current}` : '';
    onLiveInfo(`Live: ${currentPoints.length}/${gridSize * gridSize} Hits${camStatus}${snapInfo}`);
  });

  useEffect(() => {
    const renderer = gl as THREE.WebGLRenderer;
    const onSelectStart = () => {
      if (livePointsRef.current.length === 0) return;

      let snapshotPoints = [...livePointsRef.current];

      // If color mode, try camera-access first, then getUserMedia video fallback
      if (useColorRef.current) {
        let status = 'color: ';
        try {
          const frame = (renderer.xr as any).getFrame?.() as XRFrame | null;
          const refSpace = renderer.xr.getReferenceSpace();
          if (!frame || !refSpace) { status += 'no frame/ref'; }
          else {
            const viewerPose = frame.getViewerPose(refSpace);
            if (!viewerPose?.views?.length) { status += 'no pose'; }
            else {
              const view = viewerPose.views[0];
              const xrCamera = (view as any).camera;
              const viewMatrix = view.transform.inverse.matrix as Float32Array;
              const projMatrix = view.projectionMatrix as Float32Array;
              let colored = 0;

              // --- Path A: WebXR camera-access (best quality) ---
              if (xrCamera) {
                const camTexture = (renderer.xr as any).getCameraTexture?.(xrCamera);
                if (camTexture) {
                  const camW: number = xrCamera.width || 1280;
                  const camH: number = xrCamera.height || 960;
                  const rt = new THREE.WebGLRenderTarget(camW, camH);
                  const prevRT = renderer.getRenderTarget();
                  const copyScene = new THREE.Scene();
                  const copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
                  const quad = new THREE.Mesh(
                    new THREE.PlaneGeometry(2, 2),
                    new THREE.MeshBasicMaterial({ map: camTexture }),
                  );
                  copyScene.add(quad);
                  renderer.setRenderTarget(rt);
                  renderer.render(copyScene, copyCam);
                  const allPixels = new Uint8Array(camW * camH * 4);
                  renderer.readRenderTargetPixels(rt, 0, 0, camW, camH, allPixels);
                  renderer.setRenderTarget(prevRT);
                  rt.dispose();
                  quad.geometry.dispose();
                  (quad.material as THREE.Material).dispose();

                  snapshotPoints = snapshotPoints.map((pt) => {
                    const pixel = worldToPixel(pt, viewMatrix, projMatrix, camW, camH);
                    if (!pixel) return pt;
                    const offset = (pixel.py * camW + pixel.px) * 4;
                    colored++;
                    return { ...pt, r: allPixels[offset] / 255, g: allPixels[offset + 1] / 255, b: allPixels[offset + 2] / 255 };
                  });
                  status += `XR ${colored}/${snapshotPoints.length} ${camW}x${camH}`;
                }
              }

              // --- Path B: getUserMedia video fallback ---
              if (colored === 0) {
                const video = videoRef.current;
                const ready = videoReadyRef.current;
                const vw = video?.videoWidth ?? 0;
                const vh = video?.videoHeight ?? 0;
                const rs = video?.readyState ?? -1;
                status += `video: ref=${!!video} ready=${ready} rs=${rs} ${vw}x${vh} `;

                if (video && ready && vw > 0 && vh > 0) {
                  const canvas = document.createElement('canvas');
                  canvas.width = vw;
                  canvas.height = vh;
                  const ctx = canvas.getContext('2d')!;
                  ctx.drawImage(video, 0, 0, vw, vh);
                  const imgData = ctx.getImageData(0, 0, vw, vh);

                  // Sample a few pixels to check if video is blank
                  const mid = ((vh >> 1) * vw + (vw >> 1)) * 4;
                  const sampleR = imgData.data[mid], sampleG = imgData.data[mid + 1], sampleB = imgData.data[mid + 2];
                  status += `sample=${sampleR},${sampleG},${sampleB} `;

                  snapshotPoints = snapshotPoints.map((pt) => {
                    const pixel = worldToPixel(pt, viewMatrix, projMatrix, vw, vh);
                    if (!pixel) return pt;
                    // Canvas origin = top-left → flip Y
                    const canvasY = (vh - 1) - pixel.py;
                    const offset = (canvasY * vw + pixel.px) * 4;
                    colored++;
                    return { ...pt, r: imgData.data[offset] / 255, g: imgData.data[offset + 1] / 255, b: imgData.data[offset + 2] / 255 };
                  });
                  status += `colored=${colored}/${snapshotPoints.length}`;
                } else {
                  status += 'SKIP';
                }
              }
            }
          }
        } catch (err: any) {
          status += `ERR: ${err.message?.substring(0, 50)}`;
        }
        snapInfoRef.current = status;
        snapTimeRef.current = Date.now();
      }

      onSnapshot(snapshotPoints);
    };
    const c0 = renderer.xr.getController(0);
    const c1 = renderer.xr.getController(1);
    c0.addEventListener('selectstart', onSelectStart);
    c1.addEventListener('selectstart', onSelectStart);
    scene.add(c0); scene.add(c1);
    return () => {
      c0.removeEventListener('selectstart', onSelectStart);
      c1.removeEventListener('selectstart', onSelectStart);
      scene.remove(c0); scene.remove(c1);
    };
  }, [gl, scene, onSnapshot]);

  return null;
}

function ScanPoints({ points, pointSize }: { points: ColoredPoint[]; pointSize: number }) {
  const ref = useRef<THREE.Points>(null);
  useEffect(() => {
    if (!ref.current || points.length === 0) return;
    const positions = new Float32Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      positions[i * 3] = points[i].x;
      positions[i * 3 + 1] = points[i].y;
      positions[i * 3 + 2] = points[i].z;
      colors[i * 3] = points[i].r;
      colors[i * 3 + 1] = points[i].g;
      colors[i * 3 + 2] = points[i].b;
    }
    ref.current.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    ref.current.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }, [points]);
  if (points.length === 0) return null;
  return (
    <points ref={ref}>
      <bufferGeometry />
      <pointsMaterial size={pointSize} vertexColors sizeAttenuation toneMapped={false} />
    </points>
  );
}

/**
 * Virtual room that renders around the user inside the AR session.
 * Floor, walls, ceiling — toggleable overlay, not a session switch.
 */
function VirtualRoom() {
  const roomSize = 10;
  const wallHeight = 3;
  const wallMat = (
    <meshStandardMaterial color="#2a2a3e" transparent opacity={0.85} side={THREE.DoubleSide} />
  );

  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[roomSize, roomSize]} />
        <meshStandardMaterial color="#1a1a2e" transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
      {/* Grid */}
      <gridHelper args={[roomSize, roomSize, '#444', '#333']} position={[0, 0.01, 0]} />
      {/* Ceiling */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, wallHeight, 0]}>
        <planeGeometry args={[roomSize, roomSize]} />
        <meshStandardMaterial color="#151525" transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      {/* Front wall */}
      <mesh position={[0, wallHeight / 2, -roomSize / 2]}>
        <planeGeometry args={[roomSize, wallHeight]} />
        {wallMat}
      </mesh>
      {/* Back wall */}
      <mesh position={[0, wallHeight / 2, roomSize / 2]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[roomSize, wallHeight]} />
        {wallMat}
      </mesh>
      {/* Left wall */}
      <mesh position={[-roomSize / 2, wallHeight / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[roomSize, wallHeight]} />
        {wallMat}
      </mesh>
      {/* Right wall */}
      <mesh position={[roomSize / 2, wallHeight / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[roomSize, wallHeight]} />
        {wallMat}
      </mesh>
      {/* Environment lighting for the VR room */}
      <Environment preset="city" />
    </group>
  );
}

/**
 * Floating 3D toggle button in XR space.
 */
function XRToggleButton({ active, onPress }: { active: boolean; onPress: () => void }) {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const { camera } = useThree();

  useFrame(() => {
    if (!groupRef.current) return;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    groupRef.current.position.copy(camera.position)
      .add(dir.multiplyScalar(1.0))
      .add(right.multiplyScalar(-0.3))
      .add(up.multiplyScalar(-0.2));
    groupRef.current.quaternion.copy(camera.quaternion);
  });

  const color = active ? '#2d6a4f' : '#6c63ff';

  return (
    <group ref={groupRef}>
      <mesh
        onPointerDown={onPress}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry args={[0.18, 0.07, 0.015]} />
        <meshStandardMaterial
          color={hovered ? '#ffffff' : color}
          emissive={color}
          emissiveIntensity={hovered ? 0.6 : 0.25}
        />
      </mesh>
      {/* Indicator dot */}
      <mesh position={[0, 0, 0.01]}>
        <sphereGeometry args={[0.012, 8, 8]} />
        <meshBasicMaterial color={active ? '#4caf50' : '#9c27b0'} />
      </mesh>
    </group>
  );
}

export function RoomScanViewer() {
  const [xrSupported, setXrSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [showVRRoom, setShowVRRoom] = useState(false);
  const [useColor, setUseColor] = useState(false);
  const [gridSize, setGridSize] = useState(10);
  const [pointSize, setPointSize] = useState(4);
  const [points, setPoints] = useState<ColoredPoint[]>([]);
  const [snaps, setSnaps] = useState(0);
  const [liveInfo, setLiveInfo] = useState('');
  const [debugLog, setDebugLog] = useState('Warte auf XR...');

  useEffect(() => {
    if (navigator.xr) {
      navigator.xr.isSessionSupported('immersive-ar').then(setXrSupported);
    }
  }, []);

  const infoRef = useRef('');
  const handleLiveInfo = useCallback((text: string) => {
    if (text !== infoRef.current) { infoRef.current = text; setLiveInfo(text); }
  }, []);

  const handleSnapshot = useCallback((newPts: ColoredPoint[]) => {
    setPoints((prev) => [...prev, ...newPts]);
    setSnaps((s) => s + 1);
  }, []);

  const handleExport = useCallback(() => {
    const header = [
      'ply', 'format ascii 1.0', `element vertex ${points.length}`,
      'property float x', 'property float y', 'property float z',
      'property uchar red', 'property uchar green', 'property uchar blue',
      'end_header',
    ].join('\n');
    const body = points.map((p) =>
      `${p.x.toFixed(6)} ${p.y.toFixed(6)} ${p.z.toFixed(6)} ${Math.round(p.r * 255)} ${Math.round(p.g * 255)} ${Math.round(p.b * 255)}`
    ).join('\n');
    const blob = new Blob([header + '\n' + body], { type: 'application/x-ply' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `room-scan-${Date.now()}.ply`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }, [points]);

  const pxSize = pointSize * 0.003;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#1a1a2e' }}>
      {/* Setup screen */}
      {!active && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)', zIndex: 10, textAlign: 'center',
        }}>
          {xrSupported ? (
            <>
              <div style={{ color: '#fff', fontSize: 16, marginBottom: 12 }}>
                Grid: {gridSize}x{gridSize} = {gridSize * gridSize} Rays
              </div>
              <input type="range" min={3} max={30} value={gridSize}
                onChange={(e) => setGridSize(Number(e.target.value))}
                style={{ width: 250, marginBottom: 16, accentColor: '#6c63ff' }} />
              <div style={{ color: '#fff', fontSize: 16, marginBottom: 12 }}>
                Punktgroesse: {pointSize}px
              </div>
              <input type="range" min={1} max={20} value={pointSize}
                onChange={(e) => setPointSize(Number(e.target.value))}
                style={{ width: 250, marginBottom: 24, accentColor: '#6c63ff' }} />
              {/* Color toggle */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ color: useColor ? '#4caf50' : '#888', fontSize: 15, fontWeight: 600 }}>
                    {useColor ? '🎨 Kamerafarbe AN' : '⬜ Kamerafarbe AUS'}
                  </span>
                  <button
                    onClick={() => setUseColor(!useColor)}
                    style={{
                      background: useColor ? '#4caf50' : '#444',
                      color: '#fff', border: 'none', borderRadius: 20,
                      padding: '6px 16px', fontSize: 13, cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    {useColor ? 'Ausschalten' : 'Einschalten'}
                  </button>
                </div>
                {useColor && (
                  <div style={{ color: '#ff9800', fontSize: 11, maxWidth: 280 }}>
                    Nutzt WebXR camera-access oder getUserMedia Fallback fuer Kamerafarben.
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  store.enterAR();
                  setActive(true);
                }}
                style={{
                  background: '#6c63ff', color: '#fff', border: 'none',
                  borderRadius: 16, padding: '18px 36px', fontSize: 20,
                  fontWeight: 700, cursor: 'pointer',
                  boxShadow: '0 4px 24px rgba(108,99,255,0.4)',
                }}
              >
                📷 Room Scan starten
              </button>
            </>
          ) : (
            <div style={{ color: '#888' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📷</div>
              WebXR AR benoetigt (Quest Browser)
            </div>
          )}
          {points.length > 0 && (
            <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={handleExport} style={btnSmall('#2d6a4f')}>PLY Export</button>
              <button onClick={() => { setPoints([]); setSnaps(0); }} style={btnSmall('#d32f2f')}>Reset</button>
            </div>
          )}
        </div>
      )}

      {/* HUD */}
      {active && (
        <>
          {/* Debug panel — always visible */}
          <div style={{
            position: 'absolute', top: 8, left: 8, right: 8, zIndex: 20,
            background: 'rgba(0,0,0,0.85)', color: '#0f0',
            borderRadius: 8, padding: '8px 12px', fontSize: 11,
            fontFamily: 'monospace', pointerEvents: 'none',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {debugLog}
          </div>
          <div style={{
            position: 'absolute', top: 80, left: '50%',
            transform: 'translateX(-50%)', zIndex: 10,
            background: 'rgba(0,0,0,0.7)', color: '#fff',
            borderRadius: 8, padding: '8px 16px', fontSize: 14,
            pointerEvents: 'none',
          }}>
            Pinch = Snapshot ({gridSize}x{gridSize}) {showVRRoom ? '· VR Raum AN' : ''}
          </div>
          <div style={{
            position: 'absolute', bottom: 20, left: '50%',
            transform: 'translateX(-50%)', zIndex: 10,
            display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
            justifyContent: 'center', pointerEvents: 'auto',
          }}>
            <div style={{
              background: 'rgba(0,0,0,0.7)', color: '#fff',
              borderRadius: 8, padding: '8px 12px', fontSize: 13, fontFamily: 'monospace',
            }}>
              {liveInfo} · {points.length.toLocaleString()} Pkt · {snaps} Snaps
            </div>
            {points.length > 0 && (
              <button onClick={handleExport} style={btnSmall('#2d6a4f')}>PLY</button>
            )}
          </div>
        </>
      )}

      {/* Single AR Canvas — VR room is just a toggle overlay */}
      <Canvas style={{ width: '100%', height: '100%' }} camera={{ position: [0, 1.6, 0], fov: 60 }}>
        <XR store={store}>
          <ambientLight intensity={showVRRoom ? 0.6 : 1} />
          {showVRRoom && <directionalLight position={[5, 5, 5]} intensity={1} />}
          <XROrigin />

          {/* Hit-test scanning (always active in AR) */}
          {active && <CameraDiagnostics onLog={setDebugLog} />}
          {active && <HitTestGrid gridSize={gridSize} useColor={useColor} onSnapshot={handleSnapshot} onLiveInfo={handleLiveInfo} />}

          {/* Accumulated points (always visible) */}
          <ScanPoints points={points} pointSize={pxSize} />

          {/* VR Room overlay — just toggled on/off, same session */}
          {showVRRoom && <VirtualRoom />}

          {/* Floating toggle button */}
          {active && (
            <XRToggleButton
              active={showVRRoom}
              onPress={() => setShowVRRoom((v) => !v)}
            />
          )}
        </XR>
      </Canvas>
    </div>
  );
}

function btnSmall(bg: string): React.CSSProperties {
  return {
    background: bg, color: '#fff', border: 'none',
    borderRadius: 8, padding: '8px 14px', fontSize: 13,
    fontWeight: 600, cursor: 'pointer',
  };
}
