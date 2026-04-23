import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

function normalize(s: string): string {
  return s.toLowerCase().replace(/[_.:\s|]/g, '');
}

/**
 * Generate candidate target-bone names for a given source bone name from a
 * Mixamo clip. Covers most common rigging conventions seen in the wild.
 */
function candidateNames(sourceName: string): string[] {
  const cands: string[] = [sourceName];

  // Strip "mixamorig", "mixamorig:", "mixamorig_"
  const stripped = sourceName.replace(/^mixamorig[:_]?/i, '');
  if (stripped !== sourceName) {
    cands.push(stripped);
    cands.push(stripped.toLowerCase());
    cands.push(stripped.charAt(0).toUpperCase() + stripped.slice(1));
  }

  // Add mixamorig prefix (in case target IS Mixamo but source isn't)
  cands.push('mixamorig' + sourceName);
  cands.push('mixamorig:' + sourceName);
  cands.push('mixamorig_' + sourceName);

  // Side-aware rewrites: "LeftArm" → "Arm.L", "arm_L", "arm.l", "Left_Arm", etc.
  const sideMatch = stripped.match(/^(Left|Right)(.+)$/);
  if (sideMatch) {
    const [, sideWord, boneRaw] = sideMatch;
    const S = sideWord === 'Left' ? 'L' : 'R';
    const s = S.toLowerCase();
    const sideLower = sideWord.toLowerCase();

    // Bone-name synonyms (Mixamo → common alternatives)
    const synonyms: Record<string, string[]> = {
      Arm: ['UpperArm', 'upper_arm', 'upperarm', 'shoulder'],
      ForeArm: ['LowerArm', 'lower_arm', 'lowerarm', 'Forearm', 'elbow'],
      Hand: ['hand', 'wrist'],
      UpLeg: ['UpperLeg', 'upper_leg', 'upperleg', 'Thigh', 'thigh'],
      Leg: ['LowerLeg', 'lower_leg', 'lowerleg', 'Calf', 'calf', 'Shin', 'shin'],
      Foot: ['foot', 'ankle'],
      ToeBase: ['toe', 'toes', 'Toe'],
      Shoulder: ['shoulder', 'clavicle', 'Clavicle'],
    };

    const variants = [boneRaw, ...(synonyms[boneRaw] ?? [])];
    for (const v of variants) {
      const vLower = v.toLowerCase();
      // Every separator style × every side suffix style
      cands.push(
        `${v}.${S}`, `${v}_${S}`, `${v}${S}`, `${v} ${S}`,
        `${v}.${s}`, `${v}_${s}`, `${v}${s}`,
        `${vLower}.${S}`, `${vLower}_${S}`, `${vLower}${S}`,
        `${vLower}.${s}`, `${vLower}_${s}`, `${vLower}${s}`,
        `${v}_${sideLower}`, `${vLower}_${sideLower}`,
        `${sideWord}${v}`, `${sideLower}${v}`, `${sideLower}${vLower}`,
        `${sideWord}_${v}`, `${sideLower}_${vLower}`,
      );
    }
  } else {
    // Centerline bones — common synonyms
    const centerSynonyms: Record<string, string[]> = {
      Hips: ['hip', 'hips', 'Hip', 'Pelvis', 'pelvis', 'Root', 'root'],
      Spine: ['spine'],
      Spine1: ['spine1', 'Spine_1', 'spine_1', 'Chest', 'chest'],
      Spine2: ['spine2', 'Spine_2', 'spine_2', 'UpperChest', 'upperchest', 'upper_chest'],
      Neck: ['neck'],
      Head: ['head'],
      HeadTop_End: ['head_end', 'HeadEnd'],
    };
    if (centerSynonyms[stripped]) cands.push(...centerSynonyms[stripped]);
  }

  return [...new Set(cands)];
}

/**
 * Rename clip tracks so they resolve against the target object's node names.
 * Falls back to normalized (lowercase, separator-stripped) matching.
 */
function retargetClipToObject(clip: THREE.AnimationClip, target: THREE.Object3D): {
  clip: THREE.AnimationClip;
  unmatched: string[];
  matchedCount: number;
} {
  const names = new Set<string>();
  const byNormalized = new Map<string, string>();
  target.traverse((o) => {
    if (o.name && !names.has(o.name)) {
      names.add(o.name);
      const norm = normalize(o.name);
      if (!byNormalized.has(norm)) byNormalized.set(norm, o.name);
    }
  });

  const newTracks: THREE.KeyframeTrack[] = [];
  const unmatched = new Set<string>();
  let changed = false;
  let matchedCount = 0;

  for (const track of clip.tracks) {
    const dotIdx = track.name.indexOf('.');
    if (dotIdx < 0) {
      newTracks.push(track);
      continue;
    }
    const boneName = track.name.slice(0, dotIdx);
    const propPath = track.name.slice(dotIdx);

    if (names.has(boneName)) {
      newTracks.push(track);
      matchedCount++;
      continue;
    }

    let match: string | undefined;
    for (const c of candidateNames(boneName)) {
      if (names.has(c)) {
        match = c;
        break;
      }
    }

    // Normalized fallback: strip case + separators
    if (!match) {
      const stripped = boneName.replace(/^mixamorig[:_]?/i, '');
      const norm = normalize(stripped);
      if (byNormalized.has(norm)) match = byNormalized.get(norm);
    }

    if (match) {
      const renamed = track.clone();
      renamed.name = match + propPath;
      newTracks.push(renamed);
      matchedCount++;
      changed = true;
    } else {
      unmatched.add(boneName);
      changed = true;
    }
  }

  return {
    clip: changed ? new THREE.AnimationClip(clip.name, clip.duration, newTracks) : clip,
    unmatched: [...unmatched],
    matchedCount,
  };
}

export function useModelAnimation(
  object: THREE.Object3D | null,
  animations: THREE.AnimationClip[],
  activeAnimation: string | null,
  loop: boolean,
) {
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);

  const retargetedClips = useMemo(() => {
    if (!object) return [];
    return animations.map((c) => {
      const result = retargetClipToObject(c, object);
      if (result.unmatched.length > 0) {
        const targetBones: string[] = [];
        object.traverse((o) => { if (o.name) targetBones.push(o.name); });
        console.warn(
          `[retarget] "${c.name}": matched ${result.matchedCount} tracks, ` +
          `${result.unmatched.length} unmatched bones:`,
          result.unmatched,
        );
        console.warn(`[retarget] target bones available:`, targetBones.sort());
      }
      return result.clip;
    });
  }, [object, animations]);

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

  useEffect(() => {
    if (!mixerRef.current || retargetedClips.length === 0) return;

    if (actionRef.current) {
      actionRef.current.stop();
      actionRef.current = null;
    }

    if (!activeAnimation) return;

    const clip = retargetedClips.find((a) => a.name === activeAnimation);
    if (!clip) return;

    const action = mixerRef.current.clipAction(clip);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.play();
    actionRef.current = action;
  }, [activeAnimation, loop, retargetedClips]);

  useFrame((_, delta) => {
    mixerRef.current?.update(delta);
  });
}
