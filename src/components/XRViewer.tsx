import { useEffect, useState, useRef, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import { createXRStore, XR, XROrigin, useXRHitTest } from '@react-three/xr';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

const store = createXRStore({
  offerSession: false,
  hitTest: true,
});

interface XRViewerProps {
  modelData: ArrayBuffer;
  fileName: string;
}

function centerAndScale(object: THREE.Object3D, targetSize = 0.5) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = targetSize / maxDim;
  object.position.sub(center);
  object.scale.multiplyScalar(scale);
}

function LoadModel({ modelData, fileName, onLoaded }: {
  modelData: ArrayBuffer;
  fileName: string;
  onLoaded: (obj: THREE.Object3D) => void;
}) {
  useEffect(() => {
    const ext = fileName.toLowerCase().split('.').pop();
    try {
      if (ext === 'glb' || ext === 'gltf') {
        const loader = new GLTFLoader();
        loader.parse(modelData, '', (gltf) => {
          centerAndScale(gltf.scene);
          onLoaded(gltf.scene);
        });
      } else if (ext === 'obj') {
        const loader = new OBJLoader();
        const text = new TextDecoder().decode(modelData);
        const model = loader.parse(text);
        centerAndScale(model);
        onLoaded(model);
      } else if (ext === 'stl') {
        const loader = new STLLoader();
        const geometry = loader.parse(modelData);
        const material = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.3, roughness: 0.6 });
        const mesh = new THREE.Mesh(geometry, material);
        centerAndScale(mesh);
        onLoaded(mesh);
      }
    } catch (err) {
      console.error('[XRViewer] Load error:', err);
    }
  }, [modelData, fileName, onLoaded]);

  return null;
}

// Reticle + tap-to-place using hit test
function HitTestPlacement({ onPlace }: { onPlace: (pos: THREE.Vector3) => void }) {
  const reticleRef = useRef<THREE.Mesh>(null);
  const lastPosition = useRef<THREE.Vector3 | null>(null);
  const { gl } = useThree();

  const matrixHelper = useRef(new THREE.Matrix4());

  // Hit test callback: receives results array + getWorldMatrix(target, result) => boolean
  useXRHitTest((results, getWorldMatrix) => {
    if (results.length > 0 && reticleRef.current) {
      const valid = getWorldMatrix(matrixHelper.current, results[0]);
      if (valid) {
        reticleRef.current.visible = true;
        reticleRef.current.matrix.copy(matrixHelper.current);
        const pos = new THREE.Vector3();
        pos.setFromMatrixPosition(matrixHelper.current);
        lastPosition.current = pos;
      }
    }
  }, 'viewer');

  // Listen for XR select event (screen tap in AR)
  useEffect(() => {
    const handleSelect = () => {
      if (lastPosition.current) {
        onPlace(lastPosition.current.clone());
      }
    };

    const renderer = gl as THREE.WebGLRenderer;
    const session = renderer.xr?.getSession();
    if (session) {
      session.addEventListener('select', handleSelect);
      return () => session.removeEventListener('select', handleSelect);
    }
  }, [gl, onPlace]);

  return (
    <mesh
      ref={reticleRef}
      visible={false}
      matrixAutoUpdate={false}
      rotation-x={-Math.PI / 2}
    >
      <ringGeometry args={[0.05, 0.07, 32]} />
      <meshBasicMaterial color="#6c63ff" side={THREE.DoubleSide} />
    </mesh>
  );
}

function XRScene({ modelData, fileName }: { modelData: ArrayBuffer; fileName: string }) {
  const [loadedModel, setLoadedModel] = useState<THREE.Object3D | null>(null);
  const [placed, setPlaced] = useState(false);
  const [placedPosition, setPlacedPosition] = useState<THREE.Vector3>(new THREE.Vector3());

  const handlePlace = useCallback((pos: THREE.Vector3) => {
    if (placed) return;
    setPlacedPosition(pos);
    setPlaced(true);
    console.log('[XRViewer] Model placed at:', pos.x.toFixed(2), pos.y.toFixed(2), pos.z.toFixed(2));
  }, [placed]);

  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight position={[5, 5, 5]} intensity={1.2} />

      <LoadModel modelData={modelData} fileName={fileName} onLoaded={setLoadedModel} />

      <XROrigin />

      {!placed && <HitTestPlacement onPlace={handlePlace} />}

      {placed && loadedModel && (
        <group position={placedPosition}>
          <primitive object={loadedModel} />
        </group>
      )}

      <Environment preset="city" />
    </>
  );
}

export function XRViewer({ modelData, fileName }: XRViewerProps) {
  const [xrSupported, setXrSupported] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);

  useEffect(() => {
    if (navigator.xr) {
      navigator.xr.isSessionSupported('immersive-ar').then(setXrSupported);
    }
  }, []);

  const startAR = async () => {
    try {
      store.enterAR();
      setSessionActive(true);
    } catch (err) {
      console.error('[XRViewer] Failed to enter AR:', err);
    }
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#1a1a2e' }}>
      {xrSupported && !sessionActive && (
        <button
          onClick={startAR}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 10,
            background: '#6c63ff',
            color: '#fff',
            border: 'none',
            borderRadius: 16,
            padding: '18px 36px',
            fontSize: 20,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 4px 24px rgba(108,99,255,0.4)',
          }}
        >
          📱 AR starten
        </button>
      )}

      {!xrSupported && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10,
          color: '#888',
          textAlign: 'center',
          padding: 24,
          fontSize: 16,
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📱</div>
          <div>WebXR AR wird auf diesem Geraet nicht unterstuetzt.</div>
          <div style={{ fontSize: 13, color: '#666', marginTop: 8 }}>
            Benoetigt Chrome auf Android mit ARCore oder Quest Browser.
          </div>
        </div>
      )}

      {sessionActive && (
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
          Tippe auf eine Flaeche um das Modell zu platzieren
        </div>
      )}

      <Canvas
        style={{ width: '100%', height: '100%' }}
        camera={{ position: [0, 1.6, 2], fov: 60 }}
      >
        <XR store={store}>
          <XRScene modelData={modelData} fileName={fileName} />
        </XR>
      </Canvas>
    </div>
  );
}
