import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { createXRStore, XR, XROrigin } from '@react-three/xr';
import * as THREE from 'three';

const store = createXRStore({
  hand: { touchPointer: true, rayPointer: true },
  controller: { rayPointer: true },
  hitTest: 'required',
});

interface ColoredPoint {
  x: number; y: number; z: number;
  r: number; g: number; b: number;
}

/**
 * Creates a grid of NxN hit-test sources from the viewer's perspective.
 * Each frame, reads all hit-test results as live preview points.
 * On pinch, snapshots all current hit points into the accumulated list.
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

  // Add preview group to scene
  useEffect(() => {
    scene.add(previewGroupRef.current);
    return () => { scene.remove(previewGroupRef.current); };
  }, [scene]);

  // Create hit-test sources when session starts or grid size changes
  useEffect(() => {
    const renderer = gl as THREE.WebGLRenderer;

    const createSources = async () => {
      const session = renderer.xr.getSession();
      if (!session) return;

      // Clean up old sources
      for (const src of hitSourcesRef.current) {
        src.cancel();
      }
      hitSourcesRef.current = [];
      sourcesCreated.current = false;

      try {
        const viewerSpace = await session.requestReferenceSpace('viewer');
        const fovDeg = 60; // approximate Quest FOV to cover
        const fovRad = (fovDeg * Math.PI) / 180;

        for (let y = 0; y < gridSize; y++) {
          for (let x = 0; x < gridSize; x++) {
            // Spread rays across the FOV
            const nx = (x / (gridSize - 1)) - 0.5; // -0.5 to 0.5
            const ny = (y / (gridSize - 1)) - 0.5;
            const dirX = Math.tan(nx * fovRad);
            const dirY = Math.tan(ny * fovRad);

            const ray = new XRRay(
              new DOMPoint(0, 0, 0, 1),
              new DOMPoint(dirX, -dirY, -1, 0) // -Y because screen Y is inverted
            );

            const source = await session.requestHitTestSource!({
              space: viewerSpace,
              offsetRay: ray,
            });
            hitSourcesRef.current.push(source);
          }
        }

        sourcesCreated.current = true;
        lastGridSize.current = gridSize;
        console.log(`[Scan] Created ${hitSourcesRef.current.length} hit-test sources (${gridSize}x${gridSize})`);
      } catch (err) {
        console.error('[Scan] Failed to create hit-test sources:', err);
        onLiveInfo('Hit-Test nicht verfuegbar: ' + (err as Error).message);
      }
    };

    // Wait for session to be ready
    const check = setInterval(() => {
      if (renderer.xr.getSession() && (lastGridSize.current !== gridSize || !sourcesCreated.current)) {
        createSources();
      }
    }, 500);

    return () => {
      clearInterval(check);
      for (const src of hitSourcesRef.current) {
        try { src.cancel(); } catch {}
      }
      hitSourcesRef.current = [];
    };
  }, [gl, gridSize, onLiveInfo]);

  // Each frame: read all hit-test results, update live preview
  useFrame(() => {
    const renderer = gl as THREE.WebGLRenderer;
    const frame = (renderer.xr as any).getFrame?.() as XRFrame | null;
    const refSpace = renderer.xr.getReferenceSpace();

    if (!frame || !refSpace || !sourcesCreated.current) return;

    // Remove old preview
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
          const r = 0.3 + t * 0.7;
          const g = 0.8 - t * 0.3;
          const b = 0.5;

          positions.push(p.x, p.y, p.z);
          colors.push(r, g, b);
          currentPoints.push({ x: p.x, y: p.y, z: p.z, r, g, b });
        }
      }
    }

    livePointsRef.current = currentPoints;

    if (positions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

      const mat = new THREE.PointsMaterial({
        size: 0.015,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.6,
      });

      previewPointsRef.current = new THREE.Points(geo, mat);
      previewGroupRef.current.add(previewPointsRef.current);
    }

    onLiveInfo(`Live: ${currentPoints.length}/${gridSize * gridSize} Hits`);
  });

  // Listen for pinch to snapshot
  useEffect(() => {
    const renderer = gl as THREE.WebGLRenderer;

    function onSelectStart() {
      if (livePointsRef.current.length > 0) {
        console.log(`[Scan] Snapshot: ${livePointsRef.current.length} points`);
        onSnapshot([...livePointsRef.current]);
      }
    }

    const c0 = renderer.xr.getController(0);
    const c1 = renderer.xr.getController(1);
    c0.addEventListener('selectstart', onSelectStart);
    c1.addEventListener('selectstart', onSelectStart);
    scene.add(c0);
    scene.add(c1);

    return () => {
      c0.removeEventListener('selectstart', onSelectStart);
      c1.removeEventListener('selectstart', onSelectStart);
      scene.remove(c0);
      scene.remove(c1);
    };
  }, [gl, scene, onSnapshot]);

  return null;
}

/**
 * Renders accumulated snapshot points as instanced spheres
 */
function SnapshotPoints({ points, pointSize }: { points: ColoredPoint[]; pointSize: number }) {
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
    ref.current.geometry.attributes.position.needsUpdate = true;
    ref.current.geometry.attributes.color.needsUpdate = true;
  }, [points]);

  if (points.length === 0) return null;

  return (
    <points ref={ref}>
      <bufferGeometry />
      <pointsMaterial size={pointSize} vertexColors sizeAttenuation toneMapped={false} />
    </points>
  );
}

export function RoomScanViewer() {
  const [xrSupported, setXrSupported] = useState(false);
  const [active, setActive] = useState(false);
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
    a.href = url;
    a.download = `room-scan-${Date.now()}.ply`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [points]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#1a1a2e' }}>
      {/* Start screen with grid size selector */}
      {!active && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)', zIndex: 10, textAlign: 'center',
        }}>
          {xrSupported ? (
            <>
              <div style={{ color: '#fff', fontSize: 16, marginBottom: 12 }}>
                Strahlen-Grid: {gridSize} x {gridSize} = {gridSize * gridSize} Rays
              </div>
              <input
                type="range"
                min={3} max={30} value={gridSize}
                onChange={(e) => setGridSize(Number(e.target.value))}
                style={{ width: 250, marginBottom: 16, accentColor: '#6c63ff' }}
              />
              <div style={{ color: '#fff', fontSize: 16, marginBottom: 12 }}>
                Punktgroesse: {pointSize}px
              </div>
              <input
                type="range"
                min={1} max={20} value={pointSize}
                onChange={(e) => setPointSize(Number(e.target.value))}
                style={{ width: 250, marginBottom: 24, accentColor: '#6c63ff' }}
              />
              <br />
              <button
                onClick={() => { store.enterAR(); setActive(true); }}
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
        </div>
      )}

      {/* Live info + controls */}
      {active && (
        <div style={{
          position: 'absolute', bottom: 20, left: '50%',
          transform: 'translateX(-50%)', zIndex: 10,
          display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
          justifyContent: 'center', pointerEvents: 'auto',
        }}>
          <div style={{
            background: 'rgba(0,0,0,0.7)', color: '#fff',
            borderRadius: 8, padding: '8px 12px', fontSize: 13,
            fontFamily: 'monospace',
          }}>
            {liveInfo} · {points.length.toLocaleString()} gesamt · {snaps} Snaps
          </div>
          {points.length > 0 && (
            <>
              <button onClick={handleExport} style={btnSmall('#2d6a4f')}>PLY Export</button>
              <button onClick={() => { setPoints([]); setSnaps(0); }} style={btnSmall('#d32f2f')}>Reset</button>
            </>
          )}
        </div>
      )}

      {active && (
        <div style={{
          position: 'absolute', top: 16, left: '50%',
          transform: 'translateX(-50%)', zIndex: 10,
          background: 'rgba(0,0,0,0.7)', color: '#fff',
          borderRadius: 8, padding: '8px 16px', fontSize: 14,
          pointerEvents: 'none',
        }}>
          Umherschauen — Pinch = Snapshot ({gridSize}x{gridSize})
        </div>
      )}

      <Canvas style={{ width: '100%', height: '100%' }} camera={{ position: [0, 1.6, 0], fov: 60 }}>
        <XR store={store}>
          <ambientLight intensity={1} />
          <XROrigin />
          {active && <HitTestGrid gridSize={gridSize} onSnapshot={handleSnapshot} onLiveInfo={handleLiveInfo} />}
          <SnapshotPoints points={points} pointSize={pointSize * 0.003} />
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
