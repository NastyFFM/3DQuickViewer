import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { createXRStore, XR, XROrigin } from '@react-three/xr';
import * as THREE from 'three';

const store = createXRStore({
  hand: { touchPointer: true, rayPointer: true },
  controller: { rayPointer: true },
});

/**
 * Live: every frame, read detectedMeshes from XRFrame and render
 * every vertex as a small colored point. No click needed.
 * Also reports mesh count + vertex count to parent.
 */
function LiveMeshPoints({ onInfo }: { onInfo: (info: string) => void }) {
  const { gl } = useThree();
  const groupRef = useRef(new THREE.Group());
  const pointsRef = useRef<THREE.Points | null>(null);

  useFrame(() => {
    const renderer = gl as THREE.WebGLRenderer;
    const frame = (renderer.xr as any).getFrame?.() as XRFrame | null;
    const refSpace = renderer.xr.getReferenceSpace();
    if (!frame || !refSpace) return;

    const detected = (frame as any).detectedMeshes as Set<any> | undefined;

    // Remove old points
    if (pointsRef.current) {
      groupRef.current.remove(pointsRef.current);
      pointsRef.current.geometry.dispose();
      (pointsRef.current.material as THREE.Material).dispose();
      pointsRef.current = null;
    }

    if (!detected || detected.size === 0) {
      onInfo('Keine Meshes erkannt — schaue dich um');
      return;
    }

    // Collect ALL vertices from ALL detected meshes
    const positions: number[] = [];
    const colors: number[] = [];
    let meshCount = 0;

    detected.forEach((xrMesh: any) => {
      const pose = frame.getPose(xrMesh.meshSpace, refSpace);
      if (!pose) return;
      meshCount++;

      const mat4 = new THREE.Matrix4().fromArray(pose.transform.matrix);
      const verts: Float32Array = xrMesh.vertices;
      const count = verts.length / 3;

      for (let i = 0; i < count; i++) {
        const wp = new THREE.Vector3(
          verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]
        ).applyMatrix4(mat4);

        positions.push(wp.x, wp.y, wp.z);

        // Color by height: low=green, mid=blue, high=red
        const h = wp.y;
        const t = Math.min(Math.max((h + 0.5) / 3, 0), 1);
        colors.push(t, 1 - t * 0.5, 0.5);
      }
    });

    if (positions.length === 0) {
      onInfo(`${detected.size} Meshes, aber keine Vertices`);
      return;
    }

    // Create Points geometry
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.008,
      vertexColors: true,
      sizeAttenuation: true,
    });

    const pts = new THREE.Points(geo, mat);
    pointsRef.current = pts;
    groupRef.current.add(pts);

    onInfo(`${meshCount} Meshes · ${positions.length / 3} Vertices live`);
  });

  return <primitive object={groupRef.current} />;
}

export function RoomScanViewer() {
  const [xrSupported, setXrSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [info, setInfo] = useState('');

  useEffect(() => {
    if (navigator.xr) {
      navigator.xr.isSessionSupported('immersive-ar').then(setXrSupported);
    }
  }, []);

  // Throttle info updates to avoid re-render every frame
  const infoRef = useRef('');
  const handleInfo = useCallback((text: string) => {
    if (text !== infoRef.current) {
      infoRef.current = text;
      setInfo(text);
    }
  }, []);

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
          background: 'rgba(0,0,0,0.7)', color: '#fff',
          borderRadius: 8, padding: '8px 16px', fontSize: 14,
          fontFamily: 'monospace', pointerEvents: 'none',
        }}>
          {info || 'Starte...'}
        </div>
      )}

      <Canvas style={{ width: '100%', height: '100%' }} camera={{ position: [0, 1.6, 0], fov: 60 }}>
        <XR store={store}>
          <ambientLight intensity={1} />
          <XROrigin />
          <LiveMeshPoints onInfo={handleInfo} />
        </XR>
      </Canvas>
    </div>
  );
}
