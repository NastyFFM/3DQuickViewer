import { useRef, useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { createXRStore, XR, XROrigin } from '@react-three/xr';
import { useModelAnimation } from '../hooks/useModelAnimation';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

// Single store with all features enabled
const store = createXRStore({
  hand: { touchPointer: true, rayPointer: true },
  controller: { rayPointer: true },
  depthSensing: true,
});

interface XRViewerProps {
  modelData: ArrayBuffer;
  fileName: string;
  scale?: number;
  autoEnter?: boolean;
  activeAnimation?: string | null;
  animationLoop?: boolean;
  onAnimationsFound?: (names: string[]) => void;
  depthOcclusion?: boolean;
  showHands?: boolean;
  libraryAnimations?: ArrayBuffer[];
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

function GrabbableModel({ modelData, fileName, scale = 1, activeAnimation = null, animationLoop = true, onAnimationsFound, libraryAnimations = [] }: {
  modelData: ArrayBuffer; fileName: string; scale?: number;
  activeAnimation?: string | null; animationLoop?: boolean;
  onAnimationsFound?: (names: string[]) => void;
  libraryAnimations?: ArrayBuffer[];
}) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const [animations, setAnimations] = useState<THREE.AnimationClip[]>([]);
  const groupRef = useRef<THREE.Group>(null);
  const { gl, scene } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const tempMatrix = useRef(new THREE.Matrix4());
  const grabbedBy = useRef<THREE.XRTargetRaySpace | null>(null);

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
        const material = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.3, roughness: 0.6 });
        const mesh = new THREE.Mesh(geometry, material);
        centerAndScale(mesh);
        setObject(mesh);
      }
    } catch (err) {
      console.error('[XR] Load error:', err);
    }
  }, [modelData, fileName]);

  // Parse library animations and merge with model animations
  useEffect(() => {
    if (libraryAnimations.length === 0) return;
    const loader = new GLTFLoader();
    let cancelled = false;

    const parseAll = async () => {
      const libClips: THREE.AnimationClip[] = [];
      for (const buf of libraryAnimations) {
        try {
          await new Promise<void>((resolve) => {
            loader.parse(buf, '', (gltf) => {
              for (const clip of gltf.animations) {
                // Prefix with 📚 to distinguish from model's own
                if (!clip.name.startsWith('📚')) {
                  clip.name = '📚 ' + clip.name;
                }
                libClips.push(clip);
              }
              resolve();
            }, () => resolve());
          });
        } catch {}
      }
      if (!cancelled && libClips.length > 0) {
        setAnimations((prev) => {
          // Remove old library clips, add new
          const modelClips = prev.filter((c) => !c.name.startsWith('📚'));
          const merged = [...modelClips, ...libClips];
          const allNames = merged.map((c) => c.name);
          onAnimationsFound?.(allNames);
          return merged;
        });
      }
    };
    parseAll();
    return () => { cancelled = true; };
  }, [libraryAnimations]);

  useEffect(() => {
    const renderer = gl as THREE.WebGLRenderer;
    function onSelectStart(this: THREE.XRTargetRaySpace) {
      const controller = this;
      if (!groupRef.current) return;
      tempMatrix.current.identity().extractRotation(controller.matrixWorld);
      raycaster.current.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      raycaster.current.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix.current);
      const intersects = raycaster.current.intersectObject(groupRef.current, true);
      if (intersects.length > 0) {
        controller.attach(groupRef.current);
        grabbedBy.current = controller;
      }
    }
    function onSelectEnd(this: THREE.XRTargetRaySpace) {
      const controller = this;
      if (grabbedBy.current === controller && groupRef.current) {
        scene.attach(groupRef.current);
        grabbedBy.current = null;
      }
    }
    const c0 = renderer.xr.getController(0);
    const c1 = renderer.xr.getController(1);
    c0.addEventListener('selectstart', onSelectStart);
    c0.addEventListener('selectend', onSelectEnd);
    c1.addEventListener('selectstart', onSelectStart);
    c1.addEventListener('selectend', onSelectEnd);
    scene.add(c0); scene.add(c1);
    return () => {
      c0.removeEventListener('selectstart', onSelectStart);
      c0.removeEventListener('selectend', onSelectEnd);
      c1.removeEventListener('selectstart', onSelectStart);
      c1.removeEventListener('selectend', onSelectEnd);
      scene.remove(c0); scene.remove(c1);
    };
  }, [gl, scene]);

  useModelAnimation(object, animations, activeAnimation ?? null, animationLoop ?? true);

  if (!object) return null;

  return (
    <group ref={groupRef} position={[0, 0.8, -1]}>
      <group scale={[scale, scale, scale]}>
        <primitive object={object} />
      </group>
    </group>
  );
}

/**
 * Hides/shows XR hand models at runtime by traversing the XR scene.
 */
function HandVisibility({ visible }: { visible: boolean }) {
  const { gl } = useThree();

  useEffect(() => {
    const renderer = gl as THREE.WebGLRenderer;
    // Hand models are children of getHand(0) and getHand(1)
    for (let i = 0; i < 2; i++) {
      try {
        const hand = renderer.xr.getHand(i);
        if (hand) hand.visible = visible;
      } catch {}
    }
  }, [gl, visible]);

  return null;
}

export function XRViewer({ modelData, fileName, scale = 1, autoEnter = false, activeAnimation, animationLoop = true, onAnimationsFound, showHands = true, libraryAnimations = [] }: XRViewerProps) {
  const [xrSupported, setXrSupported] = useState(false);

  useEffect(() => {
    if (navigator.xr) {
      navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
        setXrSupported(supported);
        if (supported && autoEnter) {
          store.enterAR();
        }
      });
    }
  }, [autoEnter]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#1a1a2e' }}>
      {xrSupported && (
        <button
          onClick={() => store.enterAR()}
          style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)', zIndex: 10,
            background: '#6c63ff', color: '#fff', border: 'none',
            borderRadius: 16, padding: '18px 36px', fontSize: 20,
            fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 4px 24px rgba(108,99,255,0.4)',
          }}
        >
          📱 AR starten
        </button>
      )}

      {!xrSupported && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)', zIndex: 10,
          color: '#888', textAlign: 'center', padding: 24, fontSize: 16,
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📱</div>
          <div>WebXR AR wird auf diesem Geraet nicht unterstuetzt.</div>
        </div>
      )}

      <Canvas style={{ width: '100%', height: '100%' }} camera={{ position: [0, 1.6, 2], fov: 60 }}>
        <XR store={store}>
          <ambientLight intensity={1} />
          <directionalLight position={[5, 5, 5]} intensity={1.5} />
          <XROrigin />
          <GrabbableModel modelData={modelData} fileName={fileName} scale={scale} activeAnimation={activeAnimation} animationLoop={animationLoop} onAnimationsFound={onAnimationsFound} libraryAnimations={libraryAnimations} />
          <HandVisibility visible={showHands} />
        </XR>
      </Canvas>
    </div>
  );
}
