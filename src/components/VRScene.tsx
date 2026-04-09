import { useRef, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
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

/**
 * Standard 6DOF VR grab using controller world positions (not ray-object intersections).
 * - Single hand: grab + full 3D move
 * - Two hands: scale (distance) + move (midpoint)
 */
function GrabbableModel({ modelData, fileName }: { modelData: ArrayBuffer; fileName: string }) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const { gl } = useThree();
  const [hovered, setHovered] = useState(false);

  // Grab tracking - use controller indices (0, 1) not pointer IDs
  const grab = useRef<{
    controllerIndex: number;
    // Offset: objectPos - controllerPos at grab time
    offset: THREE.Vector3;
  } | null>(null);

  const secondGrab = useRef<{
    controllerIndex: number;
  } | null>(null);

  // Two-hand state
  const twoHandStart = useRef<{
    dist: number;
    scale: number;
    midpoint: THREE.Vector3;
    objectPos: THREE.Vector3;
  } | null>(null);

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

  // Helper: get controller world position
  const getControllerPos = useCallback((index: number): THREE.Vector3 | null => {
    const renderer = gl as THREE.WebGLRenderer;
    const controller = renderer.xr.getController(index);
    if (!controller) return null;
    const pos = new THREE.Vector3();
    controller.getWorldPosition(pos);
    // Check if controller is actually tracked (position not zero)
    if (pos.lengthSq() < 0.0001) return null;
    return pos;
  }, [gl]);

  const handlePointerDown = useCallback((e: any) => {
    if (!groupRef.current) return;

    // Determine which controller triggered this
    // Try both controllers - use whichever is closest to the intersection point
    const point: THREE.Vector3 = e.point ?? new THREE.Vector3();
    const pos0 = getControllerPos(0);
    const pos1 = getControllerPos(1);

    let ctrlIdx = 0;
    if (pos0 && pos1) {
      const d0 = pos0.distanceTo(point);
      const d1 = pos1.distanceTo(point);
      ctrlIdx = d1 < d0 ? 1 : 0;
    } else if (pos1 && !pos0) {
      ctrlIdx = 1;
    }

    const ctrlPos = ctrlIdx === 0 ? pos0 : pos1;
    if (!ctrlPos) return;

    if (!grab.current) {
      // First grab
      const offset = groupRef.current.position.clone().sub(ctrlPos);
      grab.current = { controllerIndex: ctrlIdx, offset };
    } else if (!secondGrab.current && ctrlIdx !== grab.current.controllerIndex) {
      // Second grab (different controller)
      secondGrab.current = { controllerIndex: ctrlIdx };

      // Init two-hand state
      const p1 = getControllerPos(grab.current.controllerIndex);
      const p2 = ctrlPos;
      if (p1 && p2) {
        twoHandStart.current = {
          dist: p1.distanceTo(p2),
          scale: groupRef.current.scale.x,
          midpoint: p1.clone().add(p2).multiplyScalar(0.5),
          objectPos: groupRef.current.position.clone(),
        };
      }
    }
  }, [getControllerPos]);

  const handlePointerUp = useCallback((e: any) => {
    if (!groupRef.current) return;

    // Determine which controller released
    const point: THREE.Vector3 = e.point ?? new THREE.Vector3();
    const pos0 = getControllerPos(0);
    const pos1 = getControllerPos(1);

    let ctrlIdx = 0;
    if (pos0 && pos1) {
      const d0 = pos0.distanceTo(point);
      const d1 = pos1.distanceTo(point);
      ctrlIdx = d1 < d0 ? 1 : 0;
    } else if (pos1 && !pos0) {
      ctrlIdx = 1;
    }

    if (secondGrab.current && secondGrab.current.controllerIndex === ctrlIdx) {
      secondGrab.current = null;
      twoHandStart.current = null;
      // Recalculate offset for remaining grab
      if (grab.current) {
        const p = getControllerPos(grab.current.controllerIndex);
        if (p) {
          grab.current.offset = groupRef.current.position.clone().sub(p);
        }
      }
    } else if (grab.current && grab.current.controllerIndex === ctrlIdx) {
      // Primary released
      if (secondGrab.current) {
        // Promote secondary to primary
        const secIdx = secondGrab.current.controllerIndex;
        const secPos = getControllerPos(secIdx);
        if (secPos) {
          grab.current = {
            controllerIndex: secIdx,
            offset: groupRef.current.position.clone().sub(secPos),
          };
        }
        secondGrab.current = null;
      } else {
        grab.current = null;
      }
      twoHandStart.current = null;
    }
  }, [getControllerPos]);

  // Apply transform every frame based on controller positions
  useFrame(() => {
    if (!groupRef.current || !grab.current) return;

    const p1 = getControllerPos(grab.current.controllerIndex);
    if (!p1) return;

    if (secondGrab.current && twoHandStart.current) {
      const p2 = getControllerPos(secondGrab.current.controllerIndex);
      if (p2) {
        const ts = twoHandStart.current;

        // Scale: ratio of current distance to start distance
        const currentDist = p1.distanceTo(p2);
        if (ts.dist > 0.01) {
          const scaleFactor = currentDist / ts.dist;
          const newScale = Math.max(0.05, Math.min(20, ts.scale * scaleFactor));
          groupRef.current.scale.setScalar(newScale);
        }

        // Move: follow midpoint delta
        const currentMid = p1.clone().add(p2).multiplyScalar(0.5);
        const midDelta = currentMid.clone().sub(ts.midpoint);
        groupRef.current.position.copy(ts.objectPos).add(midDelta);
      }
    } else {
      // Single hand: object = controllerPos + offset
      groupRef.current.position.copy(p1).add(grab.current.offset);
    }

    // Hover/grab highlight
    const isActive = hovered || grab.current !== null;
    groupRef.current.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (mat.emissive) {
          mat.emissive.setHex(isActive ? 0x222244 : 0x000000);
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
