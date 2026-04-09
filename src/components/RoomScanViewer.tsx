import { useRef, useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { createXRStore, XR, XROrigin } from '@react-three/xr';
import * as THREE from 'three';

// Minimal — no mesh detection, no depth sensing
const store = createXRStore({
  hand: { touchPointer: true, rayPointer: true },
  controller: { rayPointer: true },
});

/**
 * Debug: place a sphere at controller/hand position on each click.
 * Uses the exact same pattern as VRScene grab (which works).
 */
function ClickDebug({ onPoint }: { onPoint: (pos: THREE.Vector3) => void }) {
  const { gl, scene } = useThree();

  useEffect(() => {
    const renderer = gl as THREE.WebGLRenderer;

    function onSelectStart(this: THREE.XRTargetRaySpace) {
      const controller = this;
      const pos = new THREE.Vector3();
      controller.getWorldPosition(pos);
      console.log('[Scan] SELECT at', pos.x.toFixed(2), pos.y.toFixed(2), pos.z.toFixed(2));
      onPoint(pos.clone());
    }

    const c0 = renderer.xr.getController(0);
    const c1 = renderer.xr.getController(1);

    c0.addEventListener('selectstart', onSelectStart);
    c1.addEventListener('selectstart', onSelectStart);

    // IMPORTANT: controllers must be in the scene for events to fire
    scene.add(c0);
    scene.add(c1);

    console.log('[Scan] Controllers added to scene, listening for selectstart');

    return () => {
      c0.removeEventListener('selectstart', onSelectStart);
      c1.removeEventListener('selectstart', onSelectStart);
      scene.remove(c0);
      scene.remove(c1);
    };
  }, [gl, scene, onPoint]);

  return null;
}

/**
 * Renders debug spheres
 */
function DebugPoints({ points }: { points: THREE.Vector3[] }) {
  return (
    <>
      {points.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]}>
          <sphereGeometry args={[0.03, 8, 8]} />
          <meshBasicMaterial color="#ff4444" />
        </mesh>
      ))}
    </>
  );
}

export function RoomScanViewer() {
  const [xrSupported, setXrSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [points, setPoints] = useState<THREE.Vector3[]>([]);

  useEffect(() => {
    if (navigator.xr) {
      navigator.xr.isSessionSupported('immersive-ar').then(setXrSupported);
    }
  }, []);

  const handlePoint = (pos: THREE.Vector3) => {
    setPoints((prev) => [...prev, pos]);
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
              📷 Debug Scan starten
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
          borderRadius: 8, padding: '8px 16px', fontSize: 16,
          fontFamily: 'monospace', pointerEvents: 'none',
        }}>
          {points.length} Punkte — Pinch = roter Punkt
        </div>
      )}

      <Canvas style={{ width: '100%', height: '100%' }} camera={{ position: [0, 1.6, 0], fov: 60 }}>
        <XR store={store}>
          <ambientLight intensity={1} />
          <XROrigin />
          <ClickDebug onPoint={handlePoint} />
          <DebugPoints points={points} />
        </XR>
      </Canvas>
    </div>
  );
}
