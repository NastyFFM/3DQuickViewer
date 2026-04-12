import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { createXRStore, XR, XROrigin } from '@react-three/xr';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';

// Two stores: one without camera, one with (user picks via toggle)
const storeNoCamera = createXRStore({
  hand: { touchPointer: true, rayPointer: true },
  controller: { rayPointer: true },
  hitTest: 'required',
});

const storeWithCamera = createXRStore({
  hand: { touchPointer: true, rayPointer: true },
  controller: { rayPointer: true },
  hitTest: 'required',
  customSessionInit: {
    requiredFeatures: ['local-floor', 'hit-test', 'hand-tracking'],
    optionalFeatures: ['camera-access', 'anchors', 'layers'],
  } as any,
});

interface ColoredPoint {
  x: number; y: number; z: number;
  r: number; g: number; b: number;
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
  // Camera color
  const glBindingRef = useRef<any>(null);
  const cameraFbRef = useRef<WebGLFramebuffer | null>(null);
  const hasCameraRef = useRef(false);

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

        // Try camera access binding
        if (useColor && !glBindingRef.current) {
          try {
            const glCtx = renderer.getContext();
            const Binding = (window as any).XRWebGLBinding;
            if (Binding) {
              glBindingRef.current = new Binding(session, glCtx);
              cameraFbRef.current = glCtx.createFramebuffer();
              hasCameraRef.current = true;
              console.log('[Scan] Camera binding created');
            }
          } catch (e) {
            console.log('[Scan] No camera access:', e);
            hasCameraRef.current = false;
          }
        }
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

    const positions: number[] = [];
    const colors: number[] = [];
    const currentPoints: ColoredPoint[] = [];

    // Try to get camera texture for color sampling
    // Correct API: binding.getCameraImage(view.camera) — takes XRCamera, not XRView
    let camTex: WebGLTexture | null = null;
    let camW = 0, camH = 0;
    const glCtx = (gl as THREE.WebGLRenderer).getContext();
    const viewerPose = frame.getViewerPose(refSpace);

    if (useColor && hasCameraRef.current && glBindingRef.current && viewerPose?.views?.length) {
      try {
        const view = viewerPose.views[0];
        const xrCamera = (view as any).camera; // XRCamera object
        if (xrCamera) {
          camTex = glBindingRef.current.getCameraImage(xrCamera);
          if (camTex) {
            camW = xrCamera.width || 1280;
            camH = xrCamera.height || 960;
            glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, cameraFbRef.current);
            glCtx.framebufferTexture2D(glCtx.FRAMEBUFFER, glCtx.COLOR_ATTACHMENT0, glCtx.TEXTURE_2D, camTex, 0);
          }
        }
      } catch {
        camTex = null;
      }
    }

    const pixel = new Uint8Array(4);
    let srcIdx = 0;
    let colorHits = 0;

    for (const source of hitSourcesRef.current) {
      const results = frame.getHitTestResults(source);
      if (results.length > 0) {
        const pose = results[0].getPose(refSpace);
        if (pose) {
          const p = pose.transform.position;
          let r: number, g: number, b: number;

          if (camTex && camW > 0) {
            // Sample camera pixel at grid UV
            const gx = srcIdx % gridSize;
            const gy = Math.floor(srcIdx / gridSize);
            const u = gx / (gridSize - 1);
            const v = 1 - (gy / (gridSize - 1));
            try {
              glCtx.readPixels(Math.floor(u * (camW - 1)), Math.floor(v * (camH - 1)), 1, 1, glCtx.RGBA, glCtx.UNSIGNED_BYTE, pixel);
              r = pixel[0] / 255; g = pixel[1] / 255; b = pixel[2] / 255;
              colorHits++;
            } catch {
              const t = Math.min(Math.max((p.y + 0.5) / 3, 0), 1);
              r = 0.3 + t * 0.7; g = 0.8 - t * 0.3; b = 0.5;
            }
          } else {
            const t = Math.min(Math.max((p.y + 0.5) / 3, 0), 1);
            r = 0.3 + t * 0.7; g = 0.8 - t * 0.3; b = 0.5;
          }

          positions.push(p.x, p.y, p.z);
          colors.push(r, g, b);
          currentPoints.push({ x: p.x, y: p.y, z: p.z, r, g, b });
        }
      }
      srcIdx++;
    }

    if (camTex) glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, null);
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

    const colorInfo = useColor ? (colorHits > 0 ? ` 🎨${colorHits}` : ' (no cam)') : '';
    onLiveInfo(`Live: ${currentPoints.length}/${gridSize * gridSize} Hits${colorInfo}`);
  });

  useEffect(() => {
    const renderer = gl as THREE.WebGLRenderer;
    const onSelectStart = () => {
      if (livePointsRef.current.length > 0) onSnapshot([...livePointsRef.current]);
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
                    Benoetigt Quest Browser camera-access Support. Falls nicht verfuegbar, wird Hoehen-Faerbung verwendet.
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  const s = useColor ? storeWithCamera : storeNoCamera;
                  s.enterAR();
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
          <div style={{
            position: 'absolute', top: 16, left: '50%',
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
        <XR store={useColor ? storeWithCamera : storeNoCamera}>
          <ambientLight intensity={showVRRoom ? 0.6 : 1} />
          {showVRRoom && <directionalLight position={[5, 5, 5]} intensity={1} />}
          <XROrigin />

          {/* Hit-test scanning (always active in AR) */}
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
