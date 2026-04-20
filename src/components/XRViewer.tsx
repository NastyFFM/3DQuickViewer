import { useRef, useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { createXRStore, XR, XROrigin } from '@react-three/xr';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

const store = createXRStore({
  hand: { touchPointer: true, rayPointer: true },
  controller: { rayPointer: true },
});

interface XRViewerProps {
  modelData: ArrayBuffer;
  fileName: string;
  scale?: number;
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
 * Same grab pattern as VRScene but for AR (immersive-ar).
 * Model appears in front of the user in the real world.
 * No floor/grid — you see the real environment through the camera.
 */
function GrabbableModel({ modelData, fileName }: { modelData: ArrayBuffer; fileName: string }) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
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
      console.error('[XR] Load error:', err);
    }
  }, [modelData, fileName]);

  // Setup XR controller grab events — identical to VRScene
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

    const controller0 = renderer.xr.getController(0);
    const controller1 = renderer.xr.getController(1);

    controller0.addEventListener('selectstart', onSelectStart);
    controller0.addEventListener('selectend', onSelectEnd);
    controller1.addEventListener('selectstart', onSelectStart);
    controller1.addEventListener('selectend', onSelectEnd);

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

  if (!object) return null;

  // Spawn in front of user, slightly below eye level
  return (
    <group ref={groupRef} position={[0, 0.8, -1]}>
      <primitive object={object} />
    </group>
  );
}

export function XRViewer({ modelData, fileName, scale = 1 }: XRViewerProps) {
  const [xrSupported, setXrSupported] = useState(false);

  useEffect(() => {
    if (navigator.xr) {
      navigator.xr.isSessionSupported('immersive-ar').then(setXrSupported);
    }
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#1a1a2e' }}>
      {xrSupported && (
        <button
          onClick={() => store.enterAR()}
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

      <Canvas
        style={{ width: '100%', height: '100%' }}
        camera={{ position: [0, 1.6, 2], fov: 60 }}
      >
        <XR store={store}>
          <ambientLight intensity={1} />
          <directionalLight position={[5, 5, 5]} intensity={1.5} />
          <XROrigin />
          <group scale={[scale, scale, scale]}>
            <GrabbableModel modelData={modelData} fileName={fileName} />
          </group>
        </XR>
      </Canvas>
    </div>
  );
}
