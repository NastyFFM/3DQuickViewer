import { useRef, useEffect, useState, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { createXRStore, XR, XROrigin, XRMeshes } from '@react-three/xr';
import * as THREE from 'three';

const store = createXRStore({
  hand: { touchPointer: true, rayPointer: true },
  controller: { rayPointer: true },
  meshDetection: true,
});

interface RoomScanViewerProps {
  onExport?: (points: ScanPoint[]) => void;
}

export interface ScanPoint {
  position: [number, number, number];
  color: [number, number, number];
  normal: [number, number, number];
}

/**
 * Renders all placed scan points as colored spheres.
 * Uses instanced mesh for performance.
 */
function PointCloud({ points }: { points: ScanPoint[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useRef(new THREE.Object3D());
  const colorArray = useRef(new Float32Array(0));

  useEffect(() => {
    if (!meshRef.current || points.length === 0) return;

    // Update instance matrices and colors
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

    // Set instance colors
    meshRef.current.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    meshRef.current.instanceColor.needsUpdate = true;
    meshRef.current.count = points.length;
  }, [points]);

  if (points.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, Math.max(points.length, 1)]}>
      <sphereGeometry args={[0.008, 8, 8]} />
      <meshBasicMaterial vertexColors toneMapped={false} />
    </instancedMesh>
  );
}

/**
 * Visualizes the XR detected meshes as wireframe overlay
 */
function MeshOverlay() {
  return (
    <XRMeshes>
      {(meshes) => (
        <>
          {meshes.map((mesh) => (
            <primitive key={mesh.id} object={mesh}>
              <meshBasicMaterial
                wireframe
                color="#6c63ff"
                transparent
                opacity={0.15}
                side={THREE.DoubleSide}
              />
            </primitive>
          ))}
        </>
      )}
    </XRMeshes>
  );
}

/**
 * Handles tap-to-place points using XR controller select events + raycasting
 */
function ScanController({ onPoint }: { onPoint: (point: ScanPoint) => void }) {
  const { gl, scene } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const tempMatrix = useRef(new THREE.Matrix4());

  useEffect(() => {
    const renderer = gl as THREE.WebGLRenderer;

    function onSelect(this: THREE.XRTargetRaySpace) {
      const controller = this;

      // Raycast from controller
      tempMatrix.current.identity().extractRotation(controller.matrixWorld);
      raycaster.current.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      raycaster.current.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix.current);

      // Intersect with everything in the scene (detected meshes)
      const intersects = raycaster.current.intersectObjects(scene.children, true);

      for (const hit of intersects) {
        // Skip our own point cloud spheres (small geometry)
        if (hit.object.geometry instanceof THREE.SphereGeometry) continue;

        const pos = hit.point;
        const normal = hit.face?.normal ?? new THREE.Vector3(0, 1, 0);

        // Transform normal to world space
        const worldNormal = normal.clone()
          .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
          .normalize();

        // Generate color from surface normal (gives natural variation)
        // Surfaces facing up = green-ish, walls = blue-ish, ceiling = warm
        const r = Math.abs(worldNormal.x) * 0.5 + 0.5;
        const g = Math.abs(worldNormal.y) * 0.5 + 0.5;
        const b = Math.abs(worldNormal.z) * 0.5 + 0.5;

        onPoint({
          position: [pos.x, pos.y, pos.z],
          color: [r, g, b],
          normal: [worldNormal.x, worldNormal.y, worldNormal.z],
        });
        break; // Only use first hit
      }
    }

    const controller0 = renderer.xr.getController(0);
    const controller1 = renderer.xr.getController(1);

    controller0.addEventListener('select', onSelect);
    controller1.addEventListener('select', onSelect);
    scene.add(controller0);
    scene.add(controller1);

    return () => {
      controller0.removeEventListener('select', onSelect);
      controller1.removeEventListener('select', onSelect);
      scene.remove(controller0);
      scene.remove(controller1);
    };
  }, [gl, scene, onPoint]);

  return null;
}

/**
 * Shows a targeting reticle where the controller points
 */
function AimReticle() {
  const { gl, scene } = useThree();
  const reticleRef = useRef<THREE.Mesh>(null);
  const raycaster = useRef(new THREE.Raycaster());
  const tempMatrix = useRef(new THREE.Matrix4());

  useFrame(() => {
    if (!reticleRef.current) return;
    const renderer = gl as THREE.WebGLRenderer;
    const session = renderer.xr.getSession();
    if (!session) return;

    // Try both controllers, use whichever has a hit
    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      if (!controller.visible) continue;

      tempMatrix.current.identity().extractRotation(controller.matrixWorld);
      raycaster.current.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      raycaster.current.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix.current);

      const intersects = raycaster.current.intersectObjects(scene.children, true);
      for (const hit of intersects) {
        if (hit.object.geometry instanceof THREE.SphereGeometry) continue;
        if (hit.object === reticleRef.current) continue;

        reticleRef.current.visible = true;
        reticleRef.current.position.copy(hit.point);

        // Orient reticle to face surface normal
        if (hit.face) {
          const normal = hit.face.normal.clone()
            .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
            .normalize();
          reticleRef.current.lookAt(hit.point.clone().add(normal));
        }
        return;
      }
    }

    reticleRef.current.visible = false;
  });

  return (
    <mesh ref={reticleRef} visible={false}>
      <ringGeometry args={[0.01, 0.015, 16]} />
      <meshBasicMaterial color="#ff6644" side={THREE.DoubleSide} />
    </mesh>
  );
}

function ScanScene({ onPoint }: { onPoint: (point: ScanPoint) => void }) {
  return (
    <>
      <ambientLight intensity={1} />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      <XROrigin />
      <ScanController onPoint={onPoint} />
      <AimReticle />
    </>
  );
}

export function RoomScanViewer({ onExport }: RoomScanViewerProps) {
  const [xrSupported, setXrSupported] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [points, setPoints] = useState<ScanPoint[]>([]);

  useEffect(() => {
    if (navigator.xr) {
      navigator.xr.isSessionSupported('immersive-ar').then(setXrSupported);
    }
  }, []);

  const handlePoint = useCallback((point: ScanPoint) => {
    setPoints((prev) => [...prev, point]);
  }, []);

  const handleClear = useCallback(() => {
    setPoints([]);
  }, []);

  const handleExport = useCallback(() => {
    if (onExport) onExport(points);

    // Also download as PLY point cloud
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
      return `${p.position[0]} ${p.position[1]} ${p.position[2]} ${p.normal[0]} ${p.normal[1]} ${p.normal[2]} ${r} ${g} ${b}`;
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
      {/* Controls overlay */}
      <div style={{
        position: 'absolute',
        top: 12,
        left: 12,
        right: 12,
        zIndex: 10,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        pointerEvents: scanning ? 'none' : 'auto',
      }}>
        {!scanning && xrSupported && (
          <button
            onClick={() => { store.enterAR(); setScanning(true); }}
            style={btnStyle}
          >
            📷 Scan starten
          </button>
        )}
        {!scanning && !xrSupported && (
          <div style={{ color: '#888', fontSize: 14 }}>
            WebXR AR benoetigt (Quest Browser / Chrome Android)
          </div>
        )}
      </div>

      {/* Point counter + export (always visible) */}
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
          {points.length} Punkte
        </div>
        {points.length > 0 && (
          <>
            <button onClick={handleExport} style={{ ...btnSmallStyle, background: '#2d6a4f' }}>
              Export PLY
            </button>
            <button onClick={handleClear} style={{ ...btnSmallStyle, background: '#d32f2f' }}>
              Reset
            </button>
          </>
        )}
      </div>

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
        }}>
          Zeige auf eine Flaeche und tippe um Punkte zu setzen
        </div>
      )}

      <Canvas
        style={{ width: '100%', height: '100%' }}
        camera={{ position: [0, 1.6, 0], fov: 60 }}
      >
        <XR store={store}>
          <ScanScene onPoint={handlePoint} />
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
  borderRadius: 12,
  padding: '14px 28px',
  fontSize: 18,
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
