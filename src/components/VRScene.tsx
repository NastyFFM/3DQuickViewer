import { useRef, useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { useModelAnimation } from '../hooks/useModelAnimation';
import { Environment } from '@react-three/drei';
import { createXRStore, XR, XROrigin } from '@react-three/xr';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

const store = createXRStore({
  hand: { touchPointer: true, rayPointer: true },
  controller: { rayPointer: true },
  depthSensing: true,
});

interface VRSceneProps {
  modelData: ArrayBuffer;
  fileName: string;
  scale?: number;
  activeAnimation?: string | null;
  animationLoop?: boolean;
  onAnimationsFound?: (names: string[]) => void;
  depthOcclusion?: boolean;
  showHands?: boolean;
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
 * Uses the same pattern as Three.js webxr_xr_dragging example:
 * - Get XR controllers from renderer
 * - On selectstart: raycast, if hit → controller.attach(object) (6DOF parent)
 * - On selectend: scene.attach(object) (detach, keep world transform)
 */
function GrabbableModel({ modelData, fileName, scale = 1, activeAnimation = null, animationLoop = true, onAnimationsFound }: {
  modelData: ArrayBuffer; fileName: string; scale?: number;
  activeAnimation?: string | null; animationLoop?: boolean;
  onAnimationsFound?: (names: string[]) => void;
}) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const [animations, setAnimations] = useState<THREE.AnimationClip[]>([]);
  const groupRef = useRef<THREE.Group>(null);
  const { gl, scene } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const tempMatrix = useRef(new THREE.Matrix4());
  const grabbedBy = useRef<THREE.XRTargetRaySpace | null>(null);

  // Load model
  useEffect(() => {
    const ext = fileName.toLowerCase().split('.').pop();
    try {
      if (ext === 'glb' || ext === 'gltf') {
        const loader = new GLTFLoader();
        loader.parse(modelData, '', (gltf) => {
          centerAndScale(gltf.scene);
          setObject(gltf.scene);
          if (gltf.animations.length > 0) {
            setAnimations(gltf.animations);
            const names = gltf.animations.map((a) => a.name || `Animation ${gltf.animations.indexOf(a)}`);
            onAnimationsFound?.(names);
          }
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
        const material = new THREE.MeshStandardMaterial({
          color: 0x888888, metalness: 0.3, roughness: 0.6,
        });
        const mesh = new THREE.Mesh(geometry, material);
        centerAndScale(mesh);
        setObject(mesh);
      }
    } catch (err) {
      console.error('[VR] Load error:', err);
    }
  }, [modelData, fileName]);

  // Setup XR controller grab events
  useEffect(() => {
    const renderer = gl as THREE.WebGLRenderer;

    function onSelectStart(this: THREE.XRTargetRaySpace) {
      const controller = this;
      if (!groupRef.current) return;

      // Raycast from controller into scene
      tempMatrix.current.identity().extractRotation(controller.matrixWorld);
      raycaster.current.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      raycaster.current.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix.current);

      const intersects = raycaster.current.intersectObject(groupRef.current, true);
      if (intersects.length > 0) {
        // Attach model to controller — follows position + rotation automatically
        controller.attach(groupRef.current);
        grabbedBy.current = controller;
      }
    }

    function onSelectEnd(this: THREE.XRTargetRaySpace) {
      const controller = this;
      if (grabbedBy.current === controller && groupRef.current) {
        // Detach back to scene, preserving world transform
        scene.attach(groupRef.current);
        grabbedBy.current = null;
      }
    }

    // Register for both controllers (0 = left or first, 1 = right or second)
    const controller0 = renderer.xr.getController(0);
    const controller1 = renderer.xr.getController(1);

    controller0.addEventListener('selectstart', onSelectStart);
    controller0.addEventListener('selectend', onSelectEnd);
    controller1.addEventListener('selectstart', onSelectStart);
    controller1.addEventListener('selectend', onSelectEnd);

    // Add controllers to scene so they're part of the scene graph
    scene.add(controller0);
    scene.add(controller1);

    return () => {
      controller0.removeEventListener('selectstart', onSelectStart);
      controller0.removeEventListener('selectend', onSelectEnd);
      controller1.removeEventListener('selectstart', onSelectStart);
      controller1.removeEventListener('selectend', onSelectEnd);
      scene.remove(controller0);
      scene.remove(controller1);
    };
  }, [gl, scene]);

  useModelAnimation(object, animations, activeAnimation ?? null, animationLoop ?? true);

  if (!object) return null;

  return (
    <group ref={groupRef} position={[0, 1.2, -1.5]}>
      <group scale={[scale, scale, scale]}>
        <primitive object={object} />
      </group>
    </group>
  );
}

function HandVisibility({ visible }: { visible: boolean }) {
  const { gl } = useThree();
  useEffect(() => {
    const renderer = gl as THREE.WebGLRenderer;
    for (let i = 0; i < 2; i++) {
      try { const hand = renderer.xr.getHand(i); if (hand) hand.visible = visible; } catch {}
    }
  }, [gl, visible]);
  return null;
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

export function VRScene({ modelData, fileName, scale = 1, activeAnimation, animationLoop = true, onAnimationsFound, showHands = true }: VRSceneProps) {
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
          <GrabbableModel modelData={modelData} fileName={fileName} scale={scale} activeAnimation={activeAnimation} animationLoop={animationLoop} onAnimationsFound={onAnimationsFound} />
          <HandVisibility visible={showHands} />
          <Floor />
          <GridFloor />
          <Environment preset="city" />
        </XR>
      </Canvas>
    </div>
  );
}
