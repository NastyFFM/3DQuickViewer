import { useRef, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import { createXRStore, XR, XROrigin } from '@react-three/xr';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

const store = createXRStore({
  hand: { touchPointer: true, rayPointer: true },
  controller: { rayPointer: true },
});

interface VRSceneProps {
  modelData: ArrayBuffer;
  fileName: string;
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

function GrabbableModel({ modelData, fileName }: { modelData: ArrayBuffer; fileName: string }) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  // Grab state
  const isGrabbed = useRef(false);
  const grabPointerId = useRef<number | null>(null);
  const grabOffset = useRef(new THREE.Vector3());
  const grabStartPos = useRef(new THREE.Vector3());
  const [hovered, setHovered] = useState(false);

  // Scale state (two-hand pinch)
  const activePointers = useRef<Map<number, THREE.Vector3>>(new Map());
  const initialPinchDist = useRef<number | null>(null);
  const initialScale = useRef(1);

  useEffect(() => {
    const ext = fileName.toLowerCase().split('.').pop();
    try {
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
    } catch (err) {
      console.error('[VR] Load error:', err);
    }
  }, [modelData, fileName]);

  const handlePointerDown = useCallback((e: THREE.Event & { pointerId?: number; point?: THREE.Vector3 }) => {
    if ('stopPropagation' in e && typeof e.stopPropagation === 'function') e.stopPropagation();
    if (!groupRef.current) return;

    const pointerId = e.pointerId ?? 0;
    const point = e.point ?? new THREE.Vector3();

    activePointers.current.set(pointerId, point.clone());

    if (activePointers.current.size === 1) {
      // Single grab — move
      isGrabbed.current = true;
      grabPointerId.current = pointerId;
      grabOffset.current.copy(groupRef.current.position).sub(point);
      grabStartPos.current.copy(point);
    } else if (activePointers.current.size === 2) {
      // Two-hand pinch — scale
      const pts = [...activePointers.current.values()];
      initialPinchDist.current = pts[0].distanceTo(pts[1]);
      initialScale.current = groupRef.current.scale.x;
    }
  }, []);

  const handlePointerMove = useCallback((e: THREE.Event & { pointerId?: number; point?: THREE.Vector3 }) => {
    if (!groupRef.current) return;

    const pointerId = e.pointerId ?? 0;
    const point = e.point ?? new THREE.Vector3();

    if (activePointers.current.has(pointerId)) {
      activePointers.current.set(pointerId, point.clone());
    }

    if (activePointers.current.size === 2 && initialPinchDist.current !== null) {
      // Two-hand scale
      const pts = [...activePointers.current.values()];
      const dist = pts[0].distanceTo(pts[1]);
      const scaleFactor = dist / initialPinchDist.current;
      const newScale = Math.max(0.1, Math.min(10, initialScale.current * scaleFactor));
      groupRef.current.scale.setScalar(newScale);
    } else if (isGrabbed.current && grabPointerId.current === pointerId) {
      // Single grab move
      groupRef.current.position.copy(point).add(grabOffset.current);
    }
  }, []);

  const handlePointerUp = useCallback((e: THREE.Event & { pointerId?: number }) => {
    const pointerId = e.pointerId ?? 0;
    activePointers.current.delete(pointerId);

    if (pointerId === grabPointerId.current) {
      isGrabbed.current = false;
      grabPointerId.current = null;
    }

    if (activePointers.current.size < 2) {
      initialPinchDist.current = null;
    }
  }, []);

  // Highlight on hover
  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat.emissive) {
          mat.emissive.setHex(hovered || isGrabbed.current ? 0x222244 : 0x000000);
        }
      }
    });
  });

  if (!object) return null;

  return (
    <group
      ref={groupRef}
      position={[0, 1.2, -1.5]}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      <primitive object={object} />
    </group>
  );
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
          <GrabbableModel modelData={modelData} fileName={fileName} />
          <Floor />
          <GridFloor />
          <Environment preset="city" />
        </XR>
      </Canvas>
    </div>
  );
}
