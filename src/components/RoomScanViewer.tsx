import { useRef, useEffect, useState, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { createXRStore, XR, XROrigin } from '@react-three/xr';
import * as THREE from 'three';

// Request depth sensing — raw depth data, no mesh
const store = createXRStore({
  hand: { touchPointer: true, rayPointer: true },
  controller: { rayPointer: true },
  depthSensing: {
    usagePreference: ['cpu-optimized'],
    dataFormatPreference: ['luminance-alpha'],
  },
});

export interface ScanPoint {
  position: [number, number, number];
  color: [number, number, number];
  normal: [number, number, number];
}

/**
 * Renders scan points as instanced colored spheres.
 */
function PointCloud({ points }: { points: ScanPoint[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useRef(new THREE.Object3D());

  useEffect(() => {
    if (!meshRef.current || points.length === 0) return;

    const colors = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      dummy.current.position.set(p.position[0], p.position[1], p.position[2]);
      dummy.current.scale.setScalar(1);
      dummy.current.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.current.matrix);
      colors[i * 3] = p.color[0];
      colors[i * 3 + 1] = p.color[1];
      colors[i * 3 + 2] = p.color[2];
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    meshRef.current.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    meshRef.current.instanceColor.needsUpdate = true;
    meshRef.current.count = points.length;
  }, [points]);

  if (points.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, Math.max(points.length, 1)]}>
      <sphereGeometry args={[0.005, 4, 4]} />
      <meshBasicMaterial vertexColors toneMapped={false} />
    </instancedMesh>
  );
}

/**
 * Captures raw depth points from the XR depth sensor on each finger tap.
 * No mesh, no interpolation — one point per depth pixel.
 */
function DepthSnapshotController({ onSnapshot, onDepthInfo }: {
  onSnapshot: (points: ScanPoint[]) => void;
  onDepthInfo: (info: string) => void;
}) {
  const { gl } = useThree();

  const captureDepthSnapshot = useCallback(() => {
    const renderer = gl as THREE.WebGLRenderer;
    const frame = (renderer.xr as any).getFrame?.() as XRFrame | null;
    const session = renderer.xr.getSession();
    const refSpace = renderer.xr.getReferenceSpace();
    if (!frame || !session || !refSpace) {
      onDepthInfo('Kein XR Frame');
      return;
    }

    const pose = frame.getViewerPose(refSpace);
    if (!pose || pose.views.length === 0) {
      onDepthInfo('Kein Viewer Pose');
      return;
    }

    const newPoints: ScanPoint[] = [];

    for (const view of pose.views) {
      // Get depth information for this view
      const depthInfo = (frame as any).getDepthInformation?.(view);
      if (!depthInfo) {
        onDepthInfo('Depth API nicht verfuegbar — Quest muss Depth Sensing unterstuetzen');
        continue;
      }

      const width = depthInfo.width;
      const height = depthInfo.height;

      // View and projection matrices
      const viewMatrix = new THREE.Matrix4().fromArray(view.transform.inverse.matrix);
      const projMatrix = new THREE.Matrix4().fromArray(view.projectionMatrix);
      const invProjView = new THREE.Matrix4()
        .multiplyMatrices(projMatrix, viewMatrix)
        .invert();

      // Sample every pixel (or step for performance)
      // Step size: 1 = every pixel, 2 = every other, etc.
      const step = Math.max(1, Math.floor(Math.min(width, height) / 100));

      let sampled = 0;
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          // Get raw depth at this pixel
          const depth = depthInfo.getDepthInMeters(
            x / width,   // normalized x
            y / height    // normalized y
          );

          if (depth <= 0 || depth > 10 || !isFinite(depth)) continue;

          // Convert pixel + depth to NDC
          const ndcX = (x / width) * 2 - 1;
          const ndcY = 1 - (y / height) * 2; // flip Y

          // Unproject to world space
          const worldPos = new THREE.Vector3(ndcX, ndcY, -1)
            .applyMatrix4(invProjView)
            .normalize();

          // Scale by depth along view direction
          const viewPos = view.transform.position;
          const origin = new THREE.Vector3(viewPos.x, viewPos.y, viewPos.z);
          const point = origin.add(worldPos.multiplyScalar(depth));

          // Color by depth: close = warm, far = cool
          const t = Math.min(depth / 5, 1);
          const r = 1 - t * 0.5;
          const g = 0.5 + t * 0.3;
          const b = 0.3 + t * 0.7;

          newPoints.push({
            position: [point.x, point.y, point.z],
            color: [r, g, b],
            normal: [0, 1, 0], // no normal from depth
          });
          sampled++;
        }
      }

      onDepthInfo(`${width}x${height} @ step ${step} → ${sampled} Punkte`);
    }

    if (newPoints.length > 0) {
      console.log(`[Scan] Depth snapshot: ${newPoints.length} points`);
      onSnapshot(newPoints);
    }
  }, [gl, onSnapshot, onDepthInfo]);

  // Listen for select events (finger pinch / trigger)
  useEffect(() => {
    const renderer = gl as THREE.WebGLRenderer;

    const controller0 = renderer.xr.getController(0);
    const controller1 = renderer.xr.getController(1);

    const onSelect = () => captureDepthSnapshot();

    controller0.addEventListener('select', onSelect);
    controller1.addEventListener('select', onSelect);

    return () => {
      controller0.removeEventListener('select', onSelect);
      controller1.removeEventListener('select', onSelect);
    };
  }, [gl, captureDepthSnapshot]);

  return null;
}

function ScanScene({ onSnapshot, onDepthInfo }: {
  onSnapshot: (points: ScanPoint[]) => void;
  onDepthInfo: (info: string) => void;
}) {
  return (
    <>
      <ambientLight intensity={1} />
      <XROrigin />
      <DepthSnapshotController onSnapshot={onSnapshot} onDepthInfo={onDepthInfo} />
    </>
  );
}

interface RoomScanViewerProps {
  onExport?: (points: ScanPoint[]) => void;
}

export function RoomScanViewer({ onExport }: RoomScanViewerProps) {
  const [xrSupported, setXrSupported] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [points, setPoints] = useState<ScanPoint[]>([]);
  const [snapshots, setSnapshots] = useState(0);
  const [depthInfo, setDepthInfo] = useState('');

  useEffect(() => {
    if (navigator.xr) {
      navigator.xr.isSessionSupported('immersive-ar').then(setXrSupported);
    }
  }, []);

  const handleSnapshot = useCallback((newPoints: ScanPoint[]) => {
    setPoints((prev) => [...prev, ...newPoints]);
    setSnapshots((prev) => prev + 1);
  }, []);

  const handleClear = useCallback(() => {
    setPoints([]);
    setSnapshots(0);
    setDepthInfo('');
  }, []);

  const handleExport = useCallback(() => {
    if (onExport) onExport(points);

    const header = [
      'ply',
      'format ascii 1.0',
      `element vertex ${points.length}`,
      'property float x',
      'property float y',
      'property float z',
      'property uchar red',
      'property uchar green',
      'property uchar blue',
      'end_header',
    ].join('\n');

    const body = points.map((p) => {
      const r = Math.round(p.color[0] * 255);
      const g = Math.round(p.color[1] * 255);
      const b = Math.round(p.color[2] * 255);
      return `${p.position[0].toFixed(6)} ${p.position[1].toFixed(6)} ${p.position[2].toFixed(6)} ${r} ${g} ${b}`;
    }).join('\n');

    const blob = new Blob([header + '\n' + body], { type: 'application/x-ply' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `depth-scan-${Date.now()}.ply`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [points, onExport]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#1a1a2e' }}>
      {!scanning && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10,
          textAlign: 'center',
        }}>
          {xrSupported ? (
            <button
              onClick={() => { store.enterAR(); setScanning(true); }}
              style={btnStyle}
            >
              📷 Depth Scan starten
            </button>
          ) : (
            <div style={{ color: '#888', fontSize: 14 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📷</div>
              WebXR AR benoetigt (Quest Browser)
            </div>
          )}
        </div>
      )}

      {scanning && (
        <div style={{
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          background: 'rgba(0,0,0,0.7)',
          color: '#fff',
          borderRadius: 8,
          padding: '8px 16px',
          fontSize: 14,
          pointerEvents: 'none',
          textAlign: 'center',
          maxWidth: '90%',
        }}>
          Schaue umher — Fingerklick = Depth Snapshot
          {depthInfo && <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>{depthInfo}</div>}
        </div>
      )}

      <div style={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        pointerEvents: 'auto',
      }}>
        <div style={{
          background: 'rgba(0,0,0,0.7)',
          color: '#fff',
          borderRadius: 8,
          padding: '8px 16px',
          fontSize: 14,
          fontFamily: 'monospace',
        }}>
          {points.length.toLocaleString()} Punkte · {snapshots} Snaps
        </div>
        {points.length > 0 && (
          <>
            <button onClick={handleExport} style={{ ...btnSmallStyle, background: '#2d6a4f' }}>
              PLY Export
            </button>
            <button onClick={handleClear} style={{ ...btnSmallStyle, background: '#d32f2f' }}>
              Reset
            </button>
          </>
        )}
      </div>

      <Canvas
        style={{ width: '100%', height: '100%' }}
        camera={{ position: [0, 1.6, 0], fov: 60 }}
      >
        <XR store={store}>
          <ScanScene onSnapshot={handleSnapshot} onDepthInfo={setDepthInfo} />
          <PointCloud points={points} />
        </XR>
      </Canvas>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: '#6c63ff',
  color: '#fff',
  border: 'none',
  borderRadius: 16,
  padding: '18px 36px',
  fontSize: 20,
  fontWeight: 700,
  cursor: 'pointer',
  boxShadow: '0 4px 24px rgba(108,99,255,0.4)',
};

const btnSmallStyle: React.CSSProperties = {
  background: '#6c63ff',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};
