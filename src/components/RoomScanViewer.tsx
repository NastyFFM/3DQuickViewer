import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { createXRStore, XR, XROrigin } from '@react-three/xr';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';

// Two stores: AR for scanning, VR for viewing
const arStore = createXRStore({
  hand: { touchPointer: true, rayPointer: true },
  controller: { rayPointer: true },
  hitTest: 'required',
});

const vrStore = createXRStore({
  hand: { touchPointer: true, rayPointer: true },
  controller: { rayPointer: true },
});

type ViewMode = 'setup' | 'ar' | 'vr';

interface ColoredPoint {
  x: number; y: number; z: number;
  r: number; g: number; b: number;
}

/**
 * NxN hit-test grid for AR scanning
 */
function HitTestGrid({ gridSize, onSnapshot, onLiveInfo }: {
  gridSize: number;
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
    onLiveInfo(`Live: ${currentPoints.length}/${gridSize * gridSize} Hits`);
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

/**
 * Renders points as WebGL Points
 */
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
 * VR environment for viewing scan data
 */
function VRScanScene({ points, pointSize }: { points: ColoredPoint[]; pointSize: number }) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      <XROrigin />
      <ScanPoints points={points} pointSize={pointSize} />
      <gridHelper args={[20, 20, '#333', '#222']} position={[0, 0.01, 0]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#1a1a2e" transparent opacity={0.8} />
      </mesh>
      <Environment preset="city" />
    </>
  );
}

export function RoomScanViewer() {
  const [xrSupported, setXrSupported] = useState(false);
  const [vrSupported, setVrSupported] = useState(false);
  const [mode, setMode] = useState<ViewMode>('setup');
  const [gridSize, setGridSize] = useState(10);
  const [pointSize, setPointSize] = useState(4);
  const [points, setPoints] = useState<ColoredPoint[]>([]);
  const [snaps, setSnaps] = useState(0);
  const [liveInfo, setLiveInfo] = useState('');

  useEffect(() => {
    if (navigator.xr) {
      navigator.xr.isSessionSupported('immersive-ar').then(setXrSupported);
      navigator.xr.isSessionSupported('immersive-vr').then(setVrSupported);
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

  const switchToAR = () => { setMode('ar'); arStore.enterAR(); };
  const switchToVR = () => { setMode('vr'); vrStore.enterVR(); };
  const switchToSetup = () => { setMode('setup'); };

  const pxSize = pointSize * 0.003;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#1a1a2e' }}>

      {/* Setup screen */}
      {mode === 'setup' && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)', zIndex: 10, textAlign: 'center',
        }}>
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
          <br />
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            {xrSupported && (
              <button onClick={switchToAR} style={btnMain('#6c63ff')}>
                📷 AR Scan
              </button>
            )}
            {vrSupported && points.length > 0 && (
              <button onClick={switchToVR} style={btnMain('#2d6a4f')}>
                🥽 VR Ansicht ({points.length.toLocaleString()} Pkt)
              </button>
            )}
          </div>
          {points.length > 0 && (
            <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={handleExport} style={btnSmall('#2d6a4f')}>PLY Export</button>
              <button onClick={() => { setPoints([]); setSnaps(0); }} style={btnSmall('#d32f2f')}>Reset</button>
            </div>
          )}
          {!xrSupported && !vrSupported && (
            <div style={{ color: '#888', marginTop: 16 }}>WebXR benoetigt (Quest Browser)</div>
          )}
        </div>
      )}

      {/* HUD in AR/VR */}
      {mode !== 'setup' && (
        <>
          <div style={{
            position: 'absolute', top: 16, left: '50%',
            transform: 'translateX(-50%)', zIndex: 10,
            background: 'rgba(0,0,0,0.7)', color: '#fff',
            borderRadius: 8, padding: '8px 16px', fontSize: 14,
            pointerEvents: 'none',
          }}>
            {mode === 'ar' ? `Pinch = Snapshot (${gridSize}x${gridSize})` : `VR Ansicht · ${points.length.toLocaleString()} Punkte`}
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
              {mode === 'ar' ? liveInfo + ' · ' : ''}{points.length.toLocaleString()} Pkt · {snaps} Snaps
            </div>
            {mode === 'ar' && vrSupported && points.length > 0 && (
              <button onClick={switchToVR} style={btnSmall('#2d6a4f')}>🥽 VR</button>
            )}
            {mode === 'vr' && xrSupported && (
              <button onClick={switchToAR} style={btnSmall('#6c63ff')}>📷 AR</button>
            )}
          </div>
        </>
      )}

      {/* AR Canvas */}
      {(mode === 'setup' || mode === 'ar') && (
        <Canvas style={{ width: '100%', height: '100%' }} camera={{ position: [0, 1.6, 0], fov: 60 }}>
          <XR store={arStore}>
            <ambientLight intensity={1} />
            <XROrigin />
            {mode === 'ar' && <HitTestGrid gridSize={gridSize} onSnapshot={handleSnapshot} onLiveInfo={handleLiveInfo} />}
            <ScanPoints points={points} pointSize={pxSize} />
          </XR>
        </Canvas>
      )}

      {/* VR Canvas */}
      {mode === 'vr' && (
        <Canvas style={{ width: '100%', height: '100%' }} camera={{ position: [0, 1.6, 2], fov: 60 }}>
          <XR store={vrStore}>
            <VRScanScene points={points} pointSize={pxSize} />
          </XR>
        </Canvas>
      )}
    </div>
  );
}

function btnMain(bg: string): React.CSSProperties {
  return {
    background: bg, color: '#fff', border: 'none',
    borderRadius: 16, padding: '18px 36px', fontSize: 20,
    fontWeight: 700, cursor: 'pointer',
    boxShadow: `0 4px 24px ${bg}66`,
  };
}

function btnSmall(bg: string): React.CSSProperties {
  return {
    background: bg, color: '#fff', border: 'none',
    borderRadius: 8, padding: '8px 14px', fontSize: 13,
    fontWeight: 600, cursor: 'pointer',
  };
}
