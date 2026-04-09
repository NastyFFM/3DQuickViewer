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

// Standard 6DOF grab: object follows controller position + rotation
// Two-hand grab: scale by changing distance between hands
function GrabbableModel({ modelData, fileName }: { modelData: ArrayBuffer; fileName: string }) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  // Grab state
  // We store the offset matrix: when grabbed, offsetMatrix = controller.inverse * object
  // Each frame: object.matrix = controller * offsetMatrix
  const grabState = useRef<{
    pointerId: number;
    // The world-space position of the pointer at grab start
    startPointerPos: THREE.Vector3;
    // The object's position at grab start
    startObjectPos: THREE.Vector3;
    // The object's quaternion at grab start
    startObjectQuat: THREE.Quaternion;
    // Pointer direction at grab start (for rotation tracking)
    startPointerDir: THREE.Vector3;
  } | null>(null);

  // Second grab for scale
  const secondGrab = useRef<{
    pointerId: number;
    startPointerPos: THREE.Vector3;
  } | null>(null);
  const initialGrabDist = useRef<number>(1);
  const initialScale = useRef<number>(1);

  // Track current pointer positions per frame via the ray intersection
  const pointerPositions = useRef<Map<number, THREE.Vector3>>(new Map());

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

  const handlePointerDown = useCallback((e: any) => {
    if (!groupRef.current) return;
    const pointerId = e.pointerId ?? 0;
    const point: THREE.Vector3 = e.point ?? new THREE.Vector3();

    if (!grabState.current) {
      // First grab — 6DOF move
      grabState.current = {
        pointerId,
        startPointerPos: point.clone(),
        startObjectPos: groupRef.current.position.clone(),
        startObjectQuat: groupRef.current.quaternion.clone(),
        startPointerDir: point.clone().sub(groupRef.current.position).normalize(),
      };
      pointerPositions.current.set(pointerId, point.clone());
    } else if (!secondGrab.current && pointerId !== grabState.current.pointerId) {
      // Second grab — scale
      secondGrab.current = {
        pointerId,
        startPointerPos: point.clone(),
      };
      pointerPositions.current.set(pointerId, point.clone());
      const p1 = pointerPositions.current.get(grabState.current.pointerId) ?? grabState.current.startPointerPos;
      initialGrabDist.current = p1.distanceTo(point);
      initialScale.current = groupRef.current.scale.x;
    }
  }, []);

  const handlePointerMove = useCallback((e: any) => {
    const pointerId = e.pointerId ?? 0;
    const point: THREE.Vector3 = e.point ?? new THREE.Vector3();

    // Always update tracked position
    if (pointerPositions.current.has(pointerId)) {
      pointerPositions.current.set(pointerId, point.clone());
    }
  }, []);

  const handlePointerUp = useCallback((e: any) => {
    const pointerId = e.pointerId ?? 0;
    pointerPositions.current.delete(pointerId);

    if (secondGrab.current && secondGrab.current.pointerId === pointerId) {
      secondGrab.current = null;
    } else if (grabState.current && grabState.current.pointerId === pointerId) {
      grabState.current = null;
      // If second was active, promote it to primary
      if (secondGrab.current && groupRef.current) {
        const sp = secondGrab.current;
        const currentPos = pointerPositions.current.get(sp.pointerId) ?? sp.startPointerPos;
        grabState.current = {
          pointerId: sp.pointerId,
          startPointerPos: currentPos.clone(),
          startObjectPos: groupRef.current.position.clone(),
          startObjectQuat: groupRef.current.quaternion.clone(),
          startPointerDir: currentPos.clone().sub(groupRef.current.position).normalize(),
        };
        secondGrab.current = null;
      }
    }
  }, []);

  // Apply transforms each frame
  useFrame(() => {
    if (!groupRef.current) return;

    const g = grabState.current;
    if (!g) return;

    const currentP1 = pointerPositions.current.get(g.pointerId);
    if (!currentP1) return;

    if (secondGrab.current) {
      // Two-hand: scale based on distance between pointers
      const currentP2 = pointerPositions.current.get(secondGrab.current.pointerId);
      if (currentP2 && initialGrabDist.current > 0.01) {
        const currentDist = currentP1.distanceTo(currentP2);
        const scaleFactor = currentDist / initialGrabDist.current;
        const newScale = Math.max(0.05, Math.min(20, initialScale.current * scaleFactor));
        groupRef.current.scale.setScalar(newScale);
      }

      // Also move to midpoint of both hands
      const currentP2b = pointerPositions.current.get(secondGrab.current.pointerId);
      if (currentP2b) {
        const midpoint = currentP1.clone().add(currentP2b).multiplyScalar(0.5);
        const startMid = g.startPointerPos.clone().add(secondGrab.current.startPointerPos).multiplyScalar(0.5);
        const delta = midpoint.clone().sub(startMid);
        groupRef.current.position.copy(g.startObjectPos).add(delta);
      }
    } else {
      // Single hand: move object (full 3D, follows pointer)
      const delta = currentP1.clone().sub(g.startPointerPos);
      groupRef.current.position.copy(g.startObjectPos).add(delta);
    }

    // Hover highlight
    groupRef.current.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (mat.emissive) {
          mat.emissive.setHex(hovered || grabState.current ? 0x222244 : 0x000000);
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
