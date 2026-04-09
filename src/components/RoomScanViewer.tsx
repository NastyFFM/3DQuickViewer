import { useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { createXRStore, XR, XROrigin } from '@react-three/xr';
import * as THREE from 'three';

// Enable mesh detection so we get depth mesh from the Quest sensors
const store = createXRStore({
  hand: { touchPointer: true, rayPointer: true },
  controller: { rayPointer: true },
  meshDetection: true,
});

interface ColoredPoint {
  x: number; y: number; z: number;
  r: number; g: number; b: number;
}

/**
 * On each pinch:
 * 1. Red debug point at hand position
 * 2. ALL vertices from detected depth meshes as colored points (snapshot)
 */
function ScanController({ onPoints }: { onPoints: (pts: ColoredPoint[]) => void }) {
  const { gl, scene } = useThree();

  useEffect(() => {
    const renderer = gl as THREE.WebGLRenderer;

    function onSelectStart(this: THREE.XRTargetRaySpace) {
      const controller = this;
      const handPos = new THREE.Vector3();
      controller.getWorldPosition(handPos);

      const newPoints: ColoredPoint[] = [];

      // 1. Red debug point at hand
      newPoints.push({
        x: handPos.x, y: handPos.y, z: handPos.z,
        r: 1, g: 0, b: 0,
      });

      // 2. Read ALL mesh vertices from the depth sensor (fresh from this frame)
      const frame = (renderer.xr as any).getFrame?.() as XRFrame | null;
      const refSpace = renderer.xr.getReferenceSpace();

      if (frame && refSpace) {
        const detected = (frame as any).detectedMeshes as Set<any> | undefined;
        if (detected) {
          detected.forEach((xrMesh: any) => {
            const pose = frame.getPose(xrMesh.meshSpace, refSpace);
            if (!pose) return;

            const mat4 = new THREE.Matrix4().fromArray(pose.transform.matrix);
            const verts: Float32Array = xrMesh.vertices;
            const count = verts.length / 3;

            // Compute vertex normals for coloring
            const indices: Uint32Array | undefined = xrMesh.indices;
            const normals = new Float32Array(verts.length);

            if (indices && indices.length >= 3) {
              const v = (idx: number) => new THREE.Vector3(verts[idx * 3], verts[idx * 3 + 1], verts[idx * 3 + 2]);
              for (let i = 0; i < indices.length; i += 3) {
                const i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];
                const fn = v(i1).sub(v(i0)).cross(v(i2).sub(v(i0))).normalize();
                for (const idx of [i0, i1, i2]) {
                  normals[idx * 3] += fn.x;
                  normals[idx * 3 + 1] += fn.y;
                  normals[idx * 3 + 2] += fn.z;
                }
              }
            }

            const normalMat = new THREE.Matrix3().getNormalMatrix(mat4);

            for (let i = 0; i < count; i++) {
              const wp = new THREE.Vector3(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]).applyMatrix4(mat4);

              // World normal for coloring
              let wn = new THREE.Vector3(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
              if (wn.lengthSq() > 0) {
                wn = wn.normalize().applyMatrix3(normalMat).normalize();
              } else {
                wn.set(0, 1, 0);
              }

              // Color by normal: floor=green, walls=blue/red
              const r = Math.abs(wn.x) * 0.5 + 0.3;
              const g = Math.max(0, wn.y) * 0.6 + 0.3;
              const b = Math.abs(wn.z) * 0.5 + 0.3;

              newPoints.push({ x: wp.x, y: wp.y, z: wp.z, r, g, b });
            }
          });

          console.log(`[Scan] Pinch: 1 hand + ${newPoints.length - 1} mesh vertices from ${detected.size} meshes`);
        } else {
          console.log('[Scan] Pinch: no detectedMeshes in frame');
        }
      } else {
        console.log('[Scan] Pinch: no frame/refSpace');
      }

      onPoints(newPoints);
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
  }, [gl, scene, onPoints]);

  return null;
}

/**
 * Renders all points as instanced mesh for performance
 */
function PointCloud({ points }: { points: ColoredPoint[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useRef(new THREE.Object3D());

  useEffect(() => {
    if (!meshRef.current || points.length === 0) return;

    const colors = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      dummy.current.position.set(points[i].x, points[i].y, points[i].z);
      dummy.current.scale.setScalar(1);
      dummy.current.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.current.matrix);
      colors[i * 3] = points[i].r;
      colors[i * 3 + 1] = points[i].g;
      colors[i * 3 + 2] = points[i].b;
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    meshRef.current.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    meshRef.current.instanceColor.needsUpdate = true;
    meshRef.current.count = points.length;
  }, [points]);

  if (points.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, Math.max(points.length, 1)]}>
      <sphereGeometry args={[0.006, 4, 4]} />
      <meshBasicMaterial vertexColors toneMapped={false} />
    </instancedMesh>
  );
}

export function RoomScanViewer() {
  const [xrSupported, setXrSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [points, setPoints] = useState<ColoredPoint[]>([]);
  const [snaps, setSnaps] = useState(0);

  useEffect(() => {
    if (navigator.xr) {
      navigator.xr.isSessionSupported('immersive-ar').then(setXrSupported);
    }
  }, []);

  const handlePoints = (newPts: ColoredPoint[]) => {
    setPoints((prev) => [...prev, ...newPts]);
    setSnaps((s) => s + 1);
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#1a1a2e' }}>
      {!active && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)', zIndex: 10, textAlign: 'center',
        }}>
          {xrSupported ? (
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
          ) : (
            <div style={{ color: '#888' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📷</div>
              WebXR AR benoetigt (Quest Browser)
            </div>
          )}
        </div>
      )}

      {active && (
        <div style={{
          position: 'absolute', bottom: 20, left: '50%',
          transform: 'translateX(-50%)', zIndex: 10,
          display: 'flex', gap: 8, alignItems: 'center', pointerEvents: 'auto',
        }}>
          <div style={{
            background: 'rgba(0,0,0,0.7)', color: '#fff',
            borderRadius: 8, padding: '8px 16px', fontSize: 14,
            fontFamily: 'monospace',
          }}>
            {points.length.toLocaleString()} Punkte · {snaps} Snaps
          </div>
          {points.length > 0 && (
            <button
              onClick={() => { setPoints([]); setSnaps(0); }}
              style={{
                background: '#d32f2f', color: '#fff', border: 'none',
                borderRadius: 8, padding: '8px 14px', fontSize: 13,
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              Reset
            </button>
          )}
        </div>
      )}

      <Canvas style={{ width: '100%', height: '100%' }} camera={{ position: [0, 1.6, 0], fov: 60 }}>
        <XR store={store}>
          <ambientLight intensity={1} />
          <XROrigin />
          <ScanController onPoints={handlePoints} />
          <PointCloud points={points} />
        </XR>
      </Canvas>
    </div>
  );
}
