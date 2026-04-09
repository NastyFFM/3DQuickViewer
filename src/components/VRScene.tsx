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
 * Reads the grip position of an XR input source directly from the XRFrame.
 * This is the gold-standard way to get controller/hand positions.
 */
function getInputSourcePosition(
  renderer: THREE.WebGLRenderer,
  source: XRInputSource,
): THREE.Vector3 | null {
  const frame = (renderer.xr as any).getFrame?.();
  const refSpace = renderer.xr.getReferenceSpace();
  if (!frame || !refSpace) return null;

  // Use gripSpace for controllers, targetRaySpace as fallback (hands)
  const space = source.gripSpace ?? source.targetRaySpace;
  const pose = frame.getPose(space, refSpace);
  if (!pose) return null;

  const p = pose.transform.position;
  return new THREE.Vector3(p.x, p.y, p.z);
}

function GrabbableModel({ modelData, fileName }: { modelData: ArrayBuffer; fileName: string }) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const { gl } = useThree();
  const [hovered, setHovered] = useState(false);

  // Store which handedness is grabbing + offset
  const grab = useRef<{
    handedness: XRHandedness;
    offset: THREE.Vector3;
  } | null>(null);

  const secondGrab = useRef<{
    handedness: XRHandedness;
  } | null>(null);

  const twoHandStart = useRef<{
    dist: number;
    scale: number;
    midpoint: THREE.Vector3;
    objectPos: THREE.Vector3;
    angle: number;
    objectRotY: number;
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

  // Find input source position by handedness
  const getPosByHandedness = useCallback((handedness: XRHandedness): THREE.Vector3 | null => {
    const renderer = gl as THREE.WebGLRenderer;
    const session = renderer.xr.getSession();
    if (!session) return null;

    for (const source of session.inputSources) {
      if (source.handedness === handedness) {
        return getInputSourcePosition(renderer, source);
      }
    }
    return null;
  }, [gl]);

  // Determine handedness from the pointer event
  const getHandednessFromEvent = useCallback((e: any): XRHandedness => {
    // Try to get handedness from the event's input source
    if (e.inputSource?.handedness) return e.inputSource.handedness;

    // Fallback: check the nativeEvent or XR details
    const nativeEvent = e.nativeEvent ?? e;
    if (nativeEvent.inputSource?.handedness) return nativeEvent.inputSource.handedness;

    // Last resort: compare ray origin with input source positions
    const rayOrigin = e.ray?.origin;
    if (rayOrigin) {
      const renderer = gl as THREE.WebGLRenderer;
      const session = renderer.xr.getSession();
      if (session) {
        let closest: XRHandedness = 'none';
        let closestDist = Infinity;
        for (const source of session.inputSources) {
          const pos = getInputSourcePosition(renderer, source);
          if (pos) {
            const dist = pos.distanceTo(rayOrigin);
            if (dist < closestDist) {
              closestDist = dist;
              closest = source.handedness;
            }
          }
        }
        if (closest !== 'none') return closest;
      }
    }

    return 'right'; // default fallback
  }, [gl]);

  const handlePointerDown = useCallback((e: any) => {
    if (!groupRef.current) return;

    const handedness = getHandednessFromEvent(e);
    const pos = getPosByHandedness(handedness);
    if (!pos) return;

    if (!grab.current) {
      // First grab
      grab.current = {
        handedness,
        offset: groupRef.current.position.clone().sub(pos),
      };
    } else if (!secondGrab.current && handedness !== grab.current.handedness) {
      // Second grab (other hand)
      secondGrab.current = { handedness };

      const p1 = getPosByHandedness(grab.current.handedness);
      if (p1) {
        const diff = pos.clone().sub(p1);
        twoHandStart.current = {
          dist: p1.distanceTo(pos),
          scale: groupRef.current.scale.x,
          midpoint: p1.clone().add(pos).multiplyScalar(0.5),
          objectPos: groupRef.current.position.clone(),
          angle: Math.atan2(diff.x, diff.z),
          objectRotY: groupRef.current.rotation.y,
        };
      }
    }
  }, [getHandednessFromEvent, getPosByHandedness]);

  const handlePointerUp = useCallback((e: any) => {
    if (!groupRef.current) return;

    const handedness = getHandednessFromEvent(e);

    if (secondGrab.current && secondGrab.current.handedness === handedness) {
      // Secondary released
      secondGrab.current = null;
      twoHandStart.current = null;
      // Update offset for remaining grab hand
      if (grab.current) {
        const p = getPosByHandedness(grab.current.handedness);
        if (p) grab.current.offset = groupRef.current.position.clone().sub(p);
      }
    } else if (grab.current && grab.current.handedness === handedness) {
      // Primary released
      if (secondGrab.current) {
        // Promote secondary
        const secHand = secondGrab.current.handedness;
        const secPos = getPosByHandedness(secHand);
        if (secPos) {
          grab.current = {
            handedness: secHand,
            offset: groupRef.current.position.clone().sub(secPos),
          };
        }
        secondGrab.current = null;
      } else {
        grab.current = null;
      }
      twoHandStart.current = null;
    }
  }, [getHandednessFromEvent, getPosByHandedness]);

  useFrame(() => {
    if (!groupRef.current || !grab.current) return;

    const p1 = getPosByHandedness(grab.current.handedness);
    if (!p1) return;

    if (secondGrab.current && twoHandStart.current) {
      const p2 = getPosByHandedness(secondGrab.current.handedness);
      if (p2) {
        const ts = twoHandStart.current;

        // Scale
        const currentDist = p1.distanceTo(p2);
        if (ts.dist > 0.01) {
          const newScale = Math.max(0.05, Math.min(20, ts.scale * (currentDist / ts.dist)));
          groupRef.current.scale.setScalar(newScale);
        }

        // Rotate Y
        const diff = p2.clone().sub(p1);
        const currentAngle = Math.atan2(diff.x, diff.z);
        groupRef.current.rotation.y = ts.objectRotY + (currentAngle - ts.angle);

        // Move by midpoint delta
        const currentMid = p1.clone().add(p2).multiplyScalar(0.5);
        const midDelta = currentMid.clone().sub(ts.midpoint);
        groupRef.current.position.copy(ts.objectPos).add(midDelta);
      }
    } else {
      // Single hand: object follows hand + offset
      groupRef.current.position.copy(p1).add(grab.current.offset);
    }

    // Highlight
    const isActive = hovered || !!grab.current;
    groupRef.current.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (mat.emissive) mat.emissive.setHex(isActive ? 0x222244 : 0x000000);
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
