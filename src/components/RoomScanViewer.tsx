import { useRef, useEffect, useState, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { createXRStore, XR, XROrigin } from '@react-three/xr';
import * as THREE from 'three';

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
      <sphereGeometry args={[0.005, 6, 6]} />
      <meshBasicMaterial vertexColors toneMapped={false} />
    </instancedMesh>
  );
}

/**
 * Extracts ALL vertices from the XR detected meshes when the user clicks.
 * This captures the depth sensor mesh — like a snapshot of the LiDAR grid.
 */
function MeshSnapshotController({ onSnapshot }: { onSnapshot: (points: ScanPoint[]) => void }) {
  const { gl } = useThree();

  const captureSnapshot = useCallback(() => {
    const renderer = gl as THREE.WebGLRenderer;
    const frame = (renderer.xr as any).getFrame?.() as XRFrame | null;
    const refSpace = renderer.xr.getReferenceSpace();

    if (!frame || !refSpace) {
      console.warn('[Scan] No XR frame or reference space');
      return;
    }

    // Access detected meshes from the XR frame
    const detectedMeshes = (frame as any).detectedMeshes as Set<any> | undefined;
    if (!detectedMeshes || detectedMeshes.size === 0) {
      console.warn('[Scan] No detected meshes available. Make sure mesh detection is enabled.');
      return;
    }

    const newPoints: ScanPoint[] = [];

    detectedMeshes.forEach((xrMesh: any) => {
      // Get the mesh pose in world space
      const meshPose = frame.getPose(xrMesh.meshSpace, refSpace);
      if (!meshPose) return;

      const transform = meshPose.transform;
      const mat4 = new THREE.Matrix4().fromArray(transform.matrix);
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(mat4);

      const vertices: Float32Array = xrMesh.vertices;
      const indices: Uint32Array | undefined = xrMesh.indices;

      // Compute face normals for coloring
      // First pass: accumulate normals per vertex from faces
      const vertexNormals = new Float32Array(vertices.length);

      if (indices && indices.length >= 3) {
        for (let i = 0; i < indices.length; i += 3) {
          const i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];

          const v0 = new THREE.Vector3(vertices[i0 * 3], vertices[i0 * 3 + 1], vertices[i0 * 3 + 2]);
          const v1 = new THREE.Vector3(vertices[i1 * 3], vertices[i1 * 3 + 1], vertices[i1 * 3 + 2]);
          const v2 = new THREE.Vector3(vertices[i2 * 3], vertices[i2 * 3 + 1], vertices[i2 * 3 + 2]);

          const edge1 = v1.clone().sub(v0);
          const edge2 = v2.clone().sub(v0);
          const faceNormal = edge1.cross(edge2).normalize();

          for (const idx of [i0, i1, i2]) {
            vertexNormals[idx * 3] += faceNormal.x;
            vertexNormals[idx * 3 + 1] += faceNormal.y;
            vertexNormals[idx * 3 + 2] += faceNormal.z;
          }
        }
      }

      // Extract each vertex as a point
      const vertexCount = vertices.length / 3;
      for (let i = 0; i < vertexCount; i++) {
        // Local position
        const localPos = new THREE.Vector3(
          vertices[i * 3],
          vertices[i * 3 + 1],
          vertices[i * 3 + 2]
        );

        // Transform to world space
        const worldPos = localPos.applyMatrix4(mat4);

        // Get normal in world space
        let normal = new THREE.Vector3(
          vertexNormals[i * 3],
          vertexNormals[i * 3 + 1],
          vertexNormals[i * 3 + 2]
        );
        if (normal.lengthSq() > 0) {
          normal = normal.normalize().applyMatrix3(normalMatrix).normalize();
        } else {
          normal.set(0, 1, 0);
        }

        // Color based on surface orientation:
        // Floor (normal up) = green, Walls = blue, Ceiling = warm
        const r = Math.abs(normal.x) * 0.4 + 0.4;
        const g = Math.max(0, normal.y) * 0.6 + 0.3;
        const b = Math.abs(normal.z) * 0.4 + 0.4;

        newPoints.push({
          position: [worldPos.x, worldPos.y, worldPos.z],
          color: [r, g, b],
          normal: [normal.x, normal.y, normal.z],
        });
      }
    });

    console.log(`[Scan] Snapshot: ${newPoints.length} points from ${detectedMeshes.size} meshes`);
    if (newPoints.length > 0) {
      onSnapshot(newPoints);
    }
  }, [gl, onSnapshot]);

  // Listen for select events on controllers (finger pinch / trigger)
  useEffect(() => {
    const renderer = gl as THREE.WebGLRenderer;

    function onSelect() {
      captureSnapshot();
    }

    const controller0 = renderer.xr.getController(0);
    const controller1 = renderer.xr.getController(1);

    controller0.addEventListener('select', onSelect);
    controller1.addEventListener('select', onSelect);

    return () => {
      controller0.removeEventListener('select', onSelect);
      controller1.removeEventListener('select', onSelect);
    };
  }, [gl, captureSnapshot]);

  return null;
}

/**
 * Shows a live wireframe preview of detected meshes
 */
function LiveMeshPreview({ onVertexCount }: { onVertexCount?: (count: number) => void }) {
  const { gl, scene } = useThree();
  const meshGroupRef = useRef<THREE.Group>(new THREE.Group());
  const meshObjectsRef = useRef<Map<any, THREE.Mesh>>(new Map());

  useEffect(() => {
    scene.add(meshGroupRef.current);
    return () => {
      scene.remove(meshGroupRef.current);
    };
  }, [scene]);

  useFrame(() => {
    const renderer = gl as THREE.WebGLRenderer;
    const frame = (renderer.xr as any).getFrame?.() as XRFrame | null;
    const refSpace = renderer.xr.getReferenceSpace();
    if (!frame || !refSpace) return;

    const detectedMeshes = (frame as any).detectedMeshes as Set<any> | undefined;
    if (!detectedMeshes) return;

    // Track which meshes are still present
    const currentMeshes = new Set<any>();

    detectedMeshes.forEach((xrMesh: any) => {
      currentMeshes.add(xrMesh);

      const meshPose = frame.getPose(xrMesh.meshSpace, refSpace);
      if (!meshPose) return;

      let threeMesh = meshObjectsRef.current.get(xrMesh);

      // Check if mesh geometry needs update
      const lastUpdate = (threeMesh as any)?._lastUpdate;
      if (!threeMesh || lastUpdate !== xrMesh.lastChangedTime) {
        // Remove old
        if (threeMesh) {
          meshGroupRef.current.remove(threeMesh);
          threeMesh.geometry.dispose();
        }

        // Create new geometry from XR mesh vertices/indices
        const vertices: Float32Array = xrMesh.vertices;
        const indices: Uint32Array | undefined = xrMesh.indices;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
        if (indices) {
          geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
        }
        geometry.computeVertexNormals();

        const material = new THREE.MeshBasicMaterial({
          wireframe: true,
          color: 0x44ff88,
          transparent: true,
          opacity: 0.3,
          side: THREE.DoubleSide,
        });

        threeMesh = new THREE.Mesh(geometry, material);
        (threeMesh as any)._lastUpdate = xrMesh.lastChangedTime;
        meshObjectsRef.current.set(xrMesh, threeMesh);
        meshGroupRef.current.add(threeMesh);
      }

      // Update transform
      const mat4 = new THREE.Matrix4().fromArray(meshPose.transform.matrix);
      threeMesh.matrix.copy(mat4);
      threeMesh.matrixAutoUpdate = false;
    });

    // Remove meshes that are no longer detected
    for (const [xrMesh, threeMesh] of meshObjectsRef.current) {
      if (!currentMeshes.has(xrMesh)) {
        meshGroupRef.current.remove(threeMesh);
        threeMesh.geometry.dispose();
        (threeMesh.material as THREE.Material).dispose();
        meshObjectsRef.current.delete(xrMesh);
      }
    }

    // Report total vertex count
    if (onVertexCount) {
      let total = 0;
      for (const m of meshObjectsRef.current.values()) {
        total += (m.geometry.getAttribute('position')?.count ?? 0);
      }
      onVertexCount(total);
    }
  });

  return null;
}

function ScanScene({ onSnapshot, onVertexCount }: { onSnapshot: (points: ScanPoint[]) => void; onVertexCount?: (count: number) => void }) {
  return (
    <>
      <ambientLight intensity={1} />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      <XROrigin />
      <MeshSnapshotController onSnapshot={onSnapshot} />
      <LiveMeshPreview onVertexCount={onVertexCount} />
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
  const [meshVertices, setMeshVertices] = useState(0);

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
  }, []);

  const handleExport = useCallback(() => {
    if (onExport) onExport(points);

    // Download as PLY
    const header = [
      'ply',
      'format ascii 1.0',
      `element vertex ${points.length}`,
      'property float x',
      'property float y',
      'property float z',
      'property float nx',
      'property float ny',
      'property float nz',
      'property uchar red',
      'property uchar green',
      'property uchar blue',
      'end_header',
    ].join('\n');

    const body = points.map((p) => {
      const r = Math.round(p.color[0] * 255);
      const g = Math.round(p.color[1] * 255);
      const b = Math.round(p.color[2] * 255);
      return `${p.position[0].toFixed(6)} ${p.position[1].toFixed(6)} ${p.position[2].toFixed(6)} ${p.normal[0].toFixed(4)} ${p.normal[1].toFixed(4)} ${p.normal[2].toFixed(4)} ${r} ${g} ${b}`;
    }).join('\n');

    const ply = header + '\n' + body;
    const blob = new Blob([ply], { type: 'application/x-ply' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `room-scan-${Date.now()}.ply`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [points, onExport]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#1a1a2e' }}>
      {/* Start button */}
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
              📷 Scan starten
            </button>
          ) : (
            <div style={{ color: '#888', fontSize: 14 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📷</div>
              WebXR AR benoetigt (Quest Browser / Chrome Android)
            </div>
          )}
        </div>
      )}

      {/* Scan instructions */}
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
        }}>
          Schaue umher — Tippe fuer Mesh-Snapshot
        </div>
      )}

      {/* Stats + controls */}
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
          {points.length.toLocaleString()} Punkte · {snapshots} Snaps · Mesh: {meshVertices.toLocaleString()} V
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
          <ScanScene onSnapshot={handleSnapshot} onVertexCount={setMeshVertices} />
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
