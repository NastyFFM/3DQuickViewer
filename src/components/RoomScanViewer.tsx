import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { createXRStore, XR, XROrigin } from '@react-three/xr';
import * as THREE from 'three';

// Request depth-sensing feature + configure for CPU access
const store = createXRStore({
  hand: { touchPointer: true, rayPointer: true },
  controller: { rayPointer: true },
  depthSensing: true, // required: 'required' would fail if unsupported
  customSessionInit: {
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['depth-sensing', 'hand-tracking'],
    // @ts-expect-error - depth-sensing init options
    depthSensing: {
      usagePreference: ['cpu-optimized'],
      dataFormatPreference: ['luminance-alpha'],
    },
  } as XRSessionInit,
});

/**
 * Reads the XR depth sensing API each frame and renders a live point cloud
 * from the real-time depth buffer — NOT from cached mesh data.
 */
function LiveDepthPointCloud({ onInfo }: { onInfo: (info: string) => void }) {
  const { gl } = useThree();
  const groupRef = useRef(new THREE.Group());
  const pointsRef = useRef<THREE.Points | null>(null);
  const frameCount = useRef(0);

  useFrame(() => {
    const renderer = gl as THREE.WebGLRenderer;
    const frame = (renderer.xr as any).getFrame?.() as XRFrame | null;
    const refSpace = renderer.xr.getReferenceSpace();
    if (!frame || !refSpace) return;

    frameCount.current++;
    // Update every 10 frames to save performance
    if (frameCount.current % 10 !== 0) return;

    const pose = frame.getViewerPose(refSpace);
    if (!pose) {
      onInfo('Kein Viewer Pose');
      return;
    }

    // Remove old points
    if (pointsRef.current) {
      groupRef.current.remove(pointsRef.current);
      pointsRef.current.geometry.dispose();
      (pointsRef.current.material as THREE.Material).dispose();
      pointsRef.current = null;
    }

    const positions: number[] = [];
    const colors: number[] = [];
    let hasDepth = false;

    for (const view of pose.views) {
      // Try to get depth information for this view
      const depthInfo = (frame as any).getDepthInformation?.(view);
      if (!depthInfo) continue;
      hasDepth = true;

      const w: number = depthInfo.width;
      const h: number = depthInfo.height;

      // Build inverse view-projection to unproject depth pixels
      const viewMatrix = new THREE.Matrix4().fromArray(view.transform.inverse.matrix);
      const projMatrix = new THREE.Matrix4().fromArray(view.projectionMatrix);
      const invProjView = new THREE.Matrix4()
        .multiplyMatrices(projMatrix, viewMatrix)
        .invert();

      // Sample every Nth pixel for performance
      const step = Math.max(1, Math.floor(Math.min(w, h) / 80));

      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          // getDepthInMeters takes normalized (0..1) coords
          const u = x / w;
          const v = y / h;
          const depth = depthInfo.getDepthInMeters(u, v);

          if (depth <= 0.1 || depth > 8 || !isFinite(depth)) continue;

          // Unproject: NDC → world
          const ndcX = u * 2 - 1;
          const ndcY = 1 - v * 2;

          // Point at depth plane in NDC, then unproject
          const near = new THREE.Vector3(ndcX, ndcY, -1).applyMatrix4(invProjView);
          const far = new THREE.Vector3(ndcX, ndcY, 1).applyMatrix4(invProjView);
          const dir = far.sub(near).normalize();

          // view position
          const vp = view.transform.position;
          const origin = new THREE.Vector3(vp.x, vp.y, vp.z);
          const world = origin.add(dir.multiplyScalar(depth));

          positions.push(world.x, world.y, world.z);

          // Color by depth: close = red, far = blue
          const t = Math.min(depth / 5, 1);
          colors.push(1 - t, 0.5, t);
        }
      }
    }

    if (!hasDepth) {
      onInfo('Depth API nicht verfuegbar — Quest muss Depth Sensing unterstuetzen');
      return;
    }

    if (positions.length === 0) {
      onInfo('Keine Tiefendaten im aktuellen Frame');
      return;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.012,
      vertexColors: true,
      sizeAttenuation: true,
    });

    const pts = new THREE.Points(geo, mat);
    pointsRef.current = pts;
    groupRef.current.add(pts);

    onInfo(`Live Depth: ${positions.length / 3} Punkte`);
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
              onClick={async () => {
                try {
                  await store.enterAR();
                  setActive(true);
                } catch (err) {
                  console.error('[Scan] enterAR failed:', err);
                  setInfo('AR start fehlgeschlagen: ' + (err as Error).message);
                }
              }}
              style={{
                background: '#6c63ff', color: '#fff', border: 'none',
                borderRadius: 16, padding: '18px 36px', fontSize: 20,
                fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 4px 24px rgba(108,99,255,0.4)',
              }}
            >
              📷 Depth Scan starten
            </button>
          ) : (
            <div style={{ color: '#888' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📷</div>
              WebXR AR benoetigt (Quest Browser)
            </div>
          )}
          {info && (
            <div style={{ color: '#ff6644', fontSize: 13, marginTop: 16, maxWidth: 300 }}>
              {info}
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
          {info || 'Starte Depth Sensing...'}
        </div>
      )}

      <Canvas style={{ width: '100%', height: '100%' }} camera={{ position: [0, 1.6, 0], fov: 60 }}>
        <XR store={store}>
          <ambientLight intensity={1} />
          <XROrigin />
          <LiveDepthPointCloud onInfo={handleInfo} />
        </XR>
      </Canvas>
    </div>
  );
}
