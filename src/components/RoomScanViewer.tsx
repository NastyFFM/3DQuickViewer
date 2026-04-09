import { useRef, useEffect, useState, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { createXRStore, XR, XROrigin } from '@react-three/xr';
import * as THREE from 'three';

// Request depth sensing — raw depth data, no mesh
const store = createXRStore({
  hand: { touchPointer: true, rayPointer: true },
  controller: { rayPointer: true },
  meshDetection: true,
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
    const refSpace = renderer.xr.getReferenceSpace();
    if (!frame || !refSpace) {
      onDepthInfo('Kein XR Frame');
      return;
    }

    const newPoints: ScanPoint[] = [];

    // Try depth sensing API first
    const pose = frame.getViewerPose(refSpace);
    if (pose) {
      for (const view of pose.views) {
        const depthInfo = (frame as any).getDepthInformation?.(view);
        if (depthInfo) {
          const w = depthInfo.width;
          const h = depthInfo.height;
          const viewMatrix = new THREE.Matrix4().fromArray(view.transform.inverse.matrix);
          const projMatrix = new THREE.Matrix4().fromArray(view.projectionMatrix);
          const invProjView = new THREE.Matrix4().multiplyMatrices(projMatrix, viewMatrix).invert();
          const step = Math.max(1, Math.floor(Math.min(w, h) / 120));

          for (let y = 0; y < h; y += step) {
            for (let x = 0; x < w; x += step) {
              const depth = depthInfo.getDepthInMeters(x / w, y / h);
              if (depth <= 0 || depth > 10 || !isFinite(depth)) continue;

              const ndcX = (x / w) * 2 - 1;
              const ndcY = 1 - (y / h) * 2;
              const dir = new THREE.Vector3(ndcX, ndcY, -1).applyMatrix4(invProjView).normalize();
              const vp = view.transform.position;
              const pt = new THREE.Vector3(vp.x, vp.y, vp.z).add(dir.multiplyScalar(depth));
              const t = Math.min(depth / 5, 1);

              newPoints.push({
                position: [pt.x, pt.y, pt.z],
                color: [1 - t * 0.5, 0.5 + t * 0.3, 0.3 + t * 0.7],
                normal: [0, 1, 0],
              });
            }
          }
          onDepthInfo(`Depth: ${w}x${h} step ${step} → ${newPoints.length} Punkte`);
        }
      }
    }

    // Fallback: use mesh detection vertices (fresh from current frame)
    if (newPoints.length === 0) {
      const detectedMeshes = (frame as any).detectedMeshes as Set<any> | undefined;
      if (detectedMeshes && detectedMeshes.size > 0) {
        detectedMeshes.forEach((xrMesh: any) => {
          const meshPose = frame.getPose(xrMesh.meshSpace, refSpace);
          if (!meshPose) return;

          const mat4 = new THREE.Matrix4().fromArray(meshPose.transform.matrix);
          const vertices: Float32Array = xrMesh.vertices;
          const vertexCount = vertices.length / 3;

          for (let i = 0; i < vertexCount; i++) {
            const worldPos = new THREE.Vector3(
              vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]
            ).applyMatrix4(mat4);

            // Color by height
            const h = worldPos.y;
            const t = Math.min(Math.max((h + 1) / 3, 0), 1);
            newPoints.push({
              position: [worldPos.x, worldPos.y, worldPos.z],
              color: [0.4 + t * 0.5, 0.8 - t * 0.3, 0.5],
              normal: [0, 1, 0],
            });
          }
        });
        onDepthInfo(`Mesh: ${detectedMeshes.size} meshes → ${newPoints.length} Punkte`);
      } else {
        onDepthInfo('Keine Tiefendaten — schaue umher damit Quest die Umgebung scannt');
      }
    }

    if (newPoints.length > 0) {
      console.log(`[Scan] Snapshot: ${newPoints.length} points`);
      onSnapshot(newPoints);
    }
  }, [gl, onSnapshot, onDepthInfo]);

  // Listen for select on XR session (works with hands AND controllers)
  useEffect(() => {
    const renderer = gl as THREE.WebGLRenderer;

    const onSelect = () => {
      console.log('[Scan] Select event fired — capturing snapshot');
      captureDepthSnapshot();
    };

    // Poll for session (might not be ready immediately)
    let session: XRSession | null = null;
    const interval = setInterval(() => {
      const s = renderer.xr.getSession();
      if (s && s !== session) {
        session = s;
        session.addEventListener('select', onSelect);
        console.log('[Scan] Listening for select on XR session');
      }
    }, 500);

    // Also listen on controllers as fallback
    const c0 = renderer.xr.getController(0);
    const c1 = renderer.xr.getController(1);
    c0.addEventListener('select', onSelect);
    c1.addEventListener('select', onSelect);

    return () => {
      clearInterval(interval);
      session?.removeEventListener('select', onSelect);
      c0.removeEventListener('select', onSelect);
      c1.removeEventListener('select', onSelect);
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
