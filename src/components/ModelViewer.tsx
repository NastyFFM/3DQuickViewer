import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, Html } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

interface ModelViewerProps {
  modelData: ArrayBuffer;
  fileName: string;
  autoRotate?: boolean;
  style?: React.CSSProperties;
}

function LoadedModel({ modelData, fileName }: { modelData: ArrayBuffer; fileName: string }) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    const ext = fileName.toLowerCase().split('.').pop();

    try {
      if (ext === 'glb' || ext === 'gltf') {
        const loader = new GLTFLoader();
        loader.parse(modelData, '', (gltf) => {
          const model = gltf.scene;
          centerAndScale(model);
          setObject(model);
        }, (err) => console.error('GLTF error:', err));
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
    } catch (err) {
      console.error('Failed to load model:', err);
    }
  }, [modelData, fileName]);

  if (!object) return <Html center><div style={{ color: '#888' }}>Lade Modell...</div></Html>;

  return <primitive object={object} />;
}

function centerAndScale(object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = 2 / maxDim;

  object.position.sub(center);
  object.scale.multiplyScalar(scale);
}

export function ModelViewer({ modelData, fileName, autoRotate = true, style }: ModelViewerProps) {
  return (
    <div style={{ width: '100%', height: '100%', background: '#1a1a2e', borderRadius: 12, overflow: 'hidden', ...style }}>
      <Canvas camera={{ position: [0, 1, 3], fov: 50 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 5, 5]} intensity={1} />
        <LoadedModel modelData={modelData} fileName={fileName} />
        <ContactShadows position={[0, -1, 0]} opacity={0.4} blur={2} />
        <OrbitControls autoRotate={autoRotate} autoRotateSpeed={1} />
        <Environment preset="city" />
      </Canvas>
    </div>
  );
}
