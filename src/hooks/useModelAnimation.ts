import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Manages GLTF animations on a loaded model.
 * Returns nothing — side-effect only (plays/stops animations).
 */
export function useModelAnimation(
  object: THREE.Object3D | null,
  animations: THREE.AnimationClip[],
  activeAnimation: string | null,
  loop: boolean,
) {
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);

  // Create/update mixer when object changes
  useEffect(() => {
    if (!object) {
      mixerRef.current = null;
      return;
    }
    mixerRef.current = new THREE.AnimationMixer(object);
    return () => {
      mixerRef.current?.stopAllAction();
      mixerRef.current = null;
    };
  }, [object]);

  // Play/stop animation when activeAnimation or loop changes
  useEffect(() => {
    if (!mixerRef.current || animations.length === 0) return;

    // Stop current
    if (actionRef.current) {
      actionRef.current.stop();
      actionRef.current = null;
    }

    if (!activeAnimation) return;

    const clip = animations.find((a) => a.name === activeAnimation);
    if (!clip) return;

    const action = mixerRef.current.clipAction(clip);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.play();
    actionRef.current = action;
  }, [activeAnimation, loop, animations]);

  // Update mixer each frame
  useFrame((_, delta) => {
    mixerRef.current?.update(delta);
  });
}
