import { useRef, useEffect, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { createXRStore, XR, XROrigin } from '@react-three/xr';
import * as THREE from 'three';

const store = createXRStore({
  meshDetection: true,
});

/**
 * Live depth mesh overlay — reads XRFrame.detectedMeshes every frame,
 * renders as semi-transparent colored surfaces over the real camera.
 */
function LiveDepthOverlay() {
  const { gl, scene } = useThree();
  const groupRef = useRef(new THREE.Group());
  const meshMapRef = useRef(new Map<any, THREE.Mesh>());

  useEffect(() => {
    scene.add(groupRef.current);
    return () => { scene.remove(groupRef.current); };
  }, [scene]);

  useFrame(() => {
    const renderer = gl as THREE.WebGLRenderer;
    const frame = (renderer.xr as any).getFrame?.() as XRFrame | null;
    const refSpace = renderer.xr.getReferenceSpace();
    if (!frame || !refSpace) return;

    const detected = (frame as any).detectedMeshes as Set<any> | undefined;
    if (!detected) return;

    const alive = new Set<any>();

    detected.forEach((xrMesh: any) => {
      alive.add(xrMesh);
      const pose = frame.getPose(xrMesh.meshSpace, refSpace);
      if (!pose) return;

      let mesh = meshMapRef.current.get(xrMesh);
      const changed = (mesh as any)?._ts !== xrMesh.lastChangedTime;

      if (!mesh || changed) {
        if (mesh) { groupRef.current.remove(mesh); mesh.geometry.dispose(); }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(xrMesh.vertices), 3));
        if (xrMesh.indices) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(xrMesh.indices), 1));
        geo.computeVertexNormals();

        mesh = new THREE.Mesh(geo, new THREE.MeshNormalMaterial({
          transparent: true,
          opacity: 0.45,
          side: THREE.DoubleSide,
        }));
        (mesh as any)._ts = xrMesh.lastChangedTime;
        meshMapRef.current.set(xrMesh, mesh);
        groupRef.current.add(mesh);
      }

      mesh.matrix.fromArray(pose.transform.matrix);
      mesh.matrixAutoUpdate = false;
    });

    // Remove gone meshes
    for (const [k, m] of meshMapRef.current) {
      if (!alive.has(k)) {
        groupRef.current.remove(m);
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        meshMapRef.current.delete(k);
      }
    }
  });

  return null;
}

export function RoomScanViewer() {
  const [xrSupported, setXrSupported] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (navigator.xr) {
      navigator.xr.isSessionSupported('immersive-ar').then(setXrSupported);
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
              📷 Depth View starten
            </button>
          ) : (
            <div style={{ color: '#888' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📷</div>
              WebXR AR benoetigt (Quest Browser)
            </div>
          )}
        </div>
      )}

      <Canvas style={{ width: '100%', height: '100%' }} camera={{ position: [0, 1.6, 0], fov: 60 }}>
        <XR store={store}>
          <ambientLight intensity={1} />
          <XROrigin />
          <LiveDepthOverlay />
        </XR>
      </Canvas>
    </div>
  );
}
