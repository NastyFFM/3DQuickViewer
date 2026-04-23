import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, Html } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';
import { useModelAnimation } from '../hooks/useModelAnimation';
import { buildAnimationClip, parseMocapPayload } from '../lib/mocapExport';
import { getMocapAudio } from '../lib/storage';

/** Prefix used on mocap clip names so the animation picker + audio-sync
 * logic can identify them apart from FBX/GLB library animations. */
export const MOCAP_CLIP_PREFIX = '🎬🔊 ';

export interface LibraryMocap {
  id: string;
  name: string;
  /** UTF-8 encoded MocapPayload JSON */
  data: ArrayBuffer;
  hasAudio: boolean;
}

interface ModelViewerProps {
  modelData: ArrayBuffer;
  fileName: string;
  autoRotate?: boolean;
  scale?: number;
  style?: React.CSSProperties;
  activeAnimation?: string | null;
  animationLoop?: boolean;
  onAnimationsFound?: (names: string[]) => void;
  libraryAnimations?: { data: ArrayBuffer; fileName: string }[];
  libraryMocaps?: LibraryMocap[];
}

function LoadedModel({
  modelData,
  fileName,
  activeAnimation = null,
  animationLoop = true,
  onAnimationsFound,
  libraryAnimations = [],
  libraryMocaps = [],
}: {
  modelData: ArrayBuffer;
  fileName: string;
  activeAnimation?: string | null;
  animationLoop?: boolean;
  onAnimationsFound?: (names: string[]) => void;
  libraryAnimations?: { data: ArrayBuffer; fileName: string }[];
  libraryMocaps?: LibraryMocap[];
}) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const [animations, setAnimations] = useState<THREE.AnimationClip[]>([]);

  useEffect(() => {
    const ext = fileName.toLowerCase().split('.').pop();
    try {
      if (ext === 'glb' || ext === 'gltf') {
        const loader = new GLTFLoader();
        loader.parse(modelData, '', (gltf) => {
          centerAndScale(gltf.scene);
          setObject(gltf.scene);
          if (gltf.animations.length > 0) {
            // Merge with any library clips already parsed — preserves them
            // regardless of parse-order race between model and library.
            setAnimations((prev) => {
              // Preserve BOTH library animation clips AND mocap clips when the
              // model re-parses — otherwise re-parsing drops any mocap clips
              // that the libraryMocaps effect already injected (and that effect
              // won't re-run unless libraryMocaps itself changes).
              const libClips = prev.filter((c) =>
                c.name.startsWith('📚') || c.name.startsWith(MOCAP_CLIP_PREFIX),
              );
              const merged = [...gltf.animations, ...libClips];
              onAnimationsFound?.(merged.map((c) => c.name));
              return merged;
            });
          }
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

  // Parse library animations and merge with model animations
  useEffect(() => {
    if (libraryAnimations.length === 0) return;
    const gltfLoader = new GLTFLoader();
    const fbxLoader = new FBXLoader();
    let cancelled = false;

    const parseAll = async () => {
      const libClips: THREE.AnimationClip[] = [];
      for (const { data, fileName: fn } of libraryAnimations) {
        const ext = fn.toLowerCase().split('.').pop();
        try {
          if (ext === 'fbx') {
            const group = fbxLoader.parse(data, '');
            if (group.animations) {
              for (const clip of group.animations) {
                if (!clip.name.startsWith('📚')) clip.name = '📚 ' + clip.name;
                libClips.push(clip);
              }
            }
          } else {
            await new Promise<void>((resolve) => {
              gltfLoader.parse(data, '', (gltf) => {
                for (const clip of gltf.animations) {
                  if (!clip.name.startsWith('📚')) clip.name = '📚 ' + clip.name;
                  libClips.push(clip);
                }
                resolve();
              }, () => resolve());
            });
          }
        } catch (err) {
          console.warn('[3D] Failed to parse library animation:', fn, err);
        }
      }
      if (!cancelled && libClips.length > 0) {
        setAnimations((prev) => {
          const modelClips = prev.filter((c) => !c.name.startsWith('📚'));
          const merged = [...modelClips, ...libClips];
          onAnimationsFound?.(merged.map((c) => c.name));
          return merged;
        });
      }
    };
    parseAll();
    return () => { cancelled = true; };
  }, [libraryAnimations]);

  // Parse mocap recordings and merge into animations (labelled with prefix).
  const mocapIdByClipNameRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    mocapIdByClipNameRef.current = new Map();
    if (libraryMocaps.length === 0) return;
    const mocapClips: THREE.AnimationClip[] = [];
    for (const m of libraryMocaps) {
      try {
        const payload = parseMocapPayload(m.data);
        const clipName = MOCAP_CLIP_PREFIX + m.name;
        const clip = buildAnimationClip(payload, clipName);
        mocapClips.push(clip);
        if (m.hasAudio) mocapIdByClipNameRef.current.set(clipName, m.id);
      } catch (err) {
        console.warn('[3D] Failed to parse mocap:', m.name, err);
      }
    }
    if (mocapClips.length > 0) {
      setAnimations((prev) => {
        const keep = prev.filter((c) => !c.name.startsWith(MOCAP_CLIP_PREFIX));
        const merged = [...keep, ...mocapClips];
        onAnimationsFound?.(merged.map((c) => c.name));
        return merged;
      });
    }
  }, [libraryMocaps]);

  // Audio playback synced with the active mocap clip. Audio plays once from
  // the start, matching the AnimationMixer starting at t=0 when clipAction is
  // activated. Loop behaviour follows animationLoop.
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  useEffect(() => {
    const stop = () => {
      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current = null;
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    };
    if (!activeAnimation) { stop(); return; }
    const mocapId = mocapIdByClipNameRef.current.get(activeAnimation);
    if (!mocapId) { stop(); return; }
    let cancelled = false;
    (async () => {
      const stored = await getMocapAudio(mocapId);
      if (cancelled || !stored) return;
      stop();
      const blob = new Blob([stored.data], { type: stored.mimeType });
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const el = new Audio(url);
      el.loop = animationLoop;
      audioElRef.current = el;
      el.play().catch((e) => console.warn('[3D] audio play failed:', e));
    })();
    return () => { cancelled = true; stop(); };
  }, [activeAnimation, animationLoop]);

  useModelAnimation(object, animations, activeAnimation, animationLoop);

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

export function ModelViewer({
  modelData,
  fileName,
  autoRotate = true,
  scale = 1,
  style,
  activeAnimation,
  animationLoop,
  onAnimationsFound,
  libraryAnimations,
  libraryMocaps,
}: ModelViewerProps) {
  return (
    <div style={{ width: '100%', height: '100%', background: '#1a1a2e', borderRadius: 12, overflow: 'hidden', ...style }}>
      <Canvas camera={{ position: [0, 1, 3], fov: 50 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 5, 5]} intensity={1} />
        <group scale={[scale, scale, scale]}>
          <LoadedModel
            modelData={modelData}
            fileName={fileName}
            activeAnimation={activeAnimation}
            animationLoop={animationLoop}
            onAnimationsFound={onAnimationsFound}
            libraryAnimations={libraryAnimations}
            libraryMocaps={libraryMocaps}
          />
        </group>
        <ContactShadows position={[0, -1, 0]} opacity={0.4} blur={2} />
        <OrbitControls autoRotate={autoRotate} autoRotateSpeed={1} />
        <Environment preset="city" />
      </Canvas>
    </div>
  );
}
