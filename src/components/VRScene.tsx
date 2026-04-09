import { useRef, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import { createXRStore, XR, XROrigin } from '@react-three/xr';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

const store = createXRStore();

interface VRSceneProps {
  modelData: ArrayBuffer;
  fileName: string;
}

function VRModel({ modelData, fileName }: { modelData: ArrayBuffer; fileName: string }) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    const ext = fileName.toLowerCase().split('.').pop();

    if (ext === 'glb' || ext === 'gltf') {
      const loader = new GLTFLoader();
      loader.parse(modelData, '', (gltf) => {
        centerAndScale(gltf.scene);
        setObject(gltf.scene);
      });
    } else if (ext === 'obj') {
      const loader = new OBJLoader();
      const text = new TextDecoder().decode(modelData);
      const model = loader.parse(text);
      centerAndScale(model);
      setObject(model);
    } else if (ext === 'stl') {
      const loader = new STLLoader();
      const geometry = loader.parse(modelData);
      const material = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.3, roughness: 0.6 });
      const mesh = new THREE.Mesh(geometry, material);
      centerAndScale(mesh);
      setObject(mesh);
    }
  }, [modelData, fileName]);

  if (!object) return null;

  return (
    <group ref={groupRef} position={[0, 1.2, -1.5]}>
      <primitive object={object} />
    </group>
  );
}

function centerAndScale(object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = 1.5 / maxDim;

  object.position.sub(center);
  object.scale.multiplyScalar(scale);
}

function Floor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[20, 20]} />
      <meshStandardMaterial color="#1a1a2e" transparent opacity={0.8} />
    </mesh>
  );
}

function GridFloor() {
  return (
    <gridHelper args={[20, 20, '#333', '#222']} position={[0, 0.01, 0]} />
  );
}

export function VRScene({ modelData, fileName }: VRSceneProps) {
  const [vrSupported, setVrSupported] = useState(false);

  useEffect(() => {
    if (navigator.xr) {
      navigator.xr.isSessionSupported('immersive-vr').then(setVrSupported);
    }
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {vrSupported && (
        <button
          onClick={() => store.enterVR()}
          style={{
            position: 'absolute',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            background: '#6c63ff',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            padding: '14px 32px',
            fontSize: 18,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 4px 24px rgba(108,99,255,0.4)',
          }}
        >
          🥽 Enter VR
        </button>
      )}
      <Canvas camera={{ position: [0, 1.6, 2], fov: 60 }}>
        <XR store={store}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 5, 5]} intensity={1} castShadow />
          <XROrigin />
          <VRModel modelData={modelData} fileName={fileName} />
          <Floor />
          <GridFloor />
          <Environment preset="city" />
        </XR>
      </Canvas>
    </div>
  );
}
