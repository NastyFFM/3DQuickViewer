/**
 * Pose stabilisation layer between MediaPipe worldLandmarks and the 3D rig.
 *
 * Problems it solves:
 *   - MediaPipe per-frame output jitters, especially on the Z axis (monocular
 *     depth estimation is inherently noisy).
 *   - Low-visibility landmarks produce large jumps that translate into bone
 *     pops in the driven model.
 *
 * Approach: per-axis OneEuroFilter (Casiez et al., CHI 2012) with stronger
 * smoothing on Z, plus a visibility gate that holds the last valid value
 * when a landmark goes out of frame or becomes occluded.
 *
 * Zero allocations per frame: the output array and its 33 landmark objects
 * are created once and mutated in place.
 */

export interface Landmark3D {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface PoseStabilizerConfig {
  /** OneEuroFilter min cutoff for X/Y axes, in Hz. Lower = smoother but laggier. */
  minCutoffXY: number;
  /** OneEuroFilter min cutoff for Z axis. Typically lower (more smoothing)
   * than XY because MediaPipe Z is much noisier. */
  minCutoffZ: number;
  /** OneEuroFilter beta (speed coefficient). Higher = more responsive to fast
   * motion, at the cost of letting a bit more noise through at slow speeds. */
  beta: number;
  /** Visibility value (0..1) below which a landmark is considered unreliable
   * for the current frame. Hold last value instead of updating. */
  visibilityThreshold: number;
}

export const DEFAULT_STABILIZER_CONFIG: PoseStabilizerConfig = {
  minCutoffXY: 1.0,
  minCutoffZ: 0.3,
  beta: 0.05,
  visibilityThreshold: 0.5,
};

const N_LANDMARKS = 33;

/** Standard OneEuroFilter. Adaptive cutoff: more smoothing at rest, more
 * responsiveness during fast motion. See https://cristal.univ-lille.fr/~casiez/1euro/ */
class OneEuroFilter {
  minCutoff: number;
  beta: number;
  dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrevMs = 0;

  constructor(minCutoff: number, beta: number, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  filter(x: number, tNowMs: number): number {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrevMs = tNowMs;
      return x;
    }
    const dt = Math.max(1e-6, (tNowMs - this.tPrevMs) / 1000);
    this.tPrevMs = tNowMs;

    // Filter the derivative first (at dCutoff) so the adaptive cutoff below
    // reacts to *smoothed* motion, not per-frame jitter.
    const dx = (x - this.xPrev) / dt;
    const aD = alpha(dt, this.dCutoff);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;

    // Cutoff rises with motion speed — fast moves let more signal through.
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = alpha(dt, cutoff);
    const xHat = a * x + (1 - a) * this.xPrev;

    this.xPrev = xHat;
    this.dxPrev = dxHat;
    return xHat;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrevMs = 0;
  }
}

function alpha(dt: number, cutoffHz: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
}

export class PoseStabilizer {
  private config: PoseStabilizerConfig;
  // 33 landmarks × 3 filters (x, y, z). Z gets its own minCutoff.
  private filters: OneEuroFilter[][];
  private lastValid: Float32Array; // 33 × 3 flat buffer
  private framesSinceValid: Int32Array;
  // Reused output array — downstream code sees the same object shape as
  // MediaPipe's worldLandmarks, so integration is a single-line change.
  private out: Landmark3D[];

  constructor(config: Partial<PoseStabilizerConfig> = {}) {
    this.config = { ...DEFAULT_STABILIZER_CONFIG, ...config };
    this.filters = [];
    for (let i = 0; i < N_LANDMARKS; i++) {
      this.filters.push([
        new OneEuroFilter(this.config.minCutoffXY, this.config.beta),
        new OneEuroFilter(this.config.minCutoffXY, this.config.beta),
        new OneEuroFilter(this.config.minCutoffZ, this.config.beta),
      ]);
    }
    this.lastValid = new Float32Array(N_LANDMARKS * 3);
    this.framesSinceValid = new Int32Array(N_LANDMARKS);
    this.out = [];
    for (let i = 0; i < N_LANDMARKS; i++) {
      this.out.push({ x: 0, y: 0, z: 0, visibility: 0 });
    }
  }

  /** Run the stabilizer for one frame. Returns the reused output array, or
   * null when the input is missing/has wrong arity. Do NOT retain the return
   * value across frames — it's mutated in place. */
  process(worldLandmarks: Landmark3D[] | null | undefined, tNowMs: number): Landmark3D[] | null {
    if (!worldLandmarks || worldLandmarks.length !== N_LANDMARKS) return null;
    const vThreshold = this.config.visibilityThreshold;

    for (let i = 0; i < N_LANDMARKS; i++) {
      const lm = worldLandmarks[i];
      const o = this.out[i];
      const base = i * 3;
      const vis = lm.visibility ?? 1.0;
      o.visibility = vis;

      if (vis >= vThreshold) {
        const fx = this.filters[i][0].filter(lm.x, tNowMs);
        const fy = this.filters[i][1].filter(lm.y, tNowMs);
        const fz = this.filters[i][2].filter(lm.z, tNowMs);
        o.x = fx; o.y = fy; o.z = fz;
        this.lastValid[base + 0] = fx;
        this.lastValid[base + 1] = fy;
        this.lastValid[base + 2] = fz;
        this.framesSinceValid[i] = 0;
      } else {
        // Hold last valid sample. (A future refinement could fade toward a
        // rest pose after N frames — noted in the plan but not needed yet.)
        this.framesSinceValid[i]++;
        o.x = this.lastValid[base + 0];
        o.y = this.lastValid[base + 1];
        o.z = this.lastValid[base + 2];
      }
    }
    return this.out;
  }

  updateConfig(partial: Partial<PoseStabilizerConfig>) {
    this.config = { ...this.config, ...partial };
    for (let i = 0; i < N_LANDMARKS; i++) {
      this.filters[i][0].minCutoff = this.config.minCutoffXY;
      this.filters[i][1].minCutoff = this.config.minCutoffXY;
      this.filters[i][2].minCutoff = this.config.minCutoffZ;
      this.filters[i][0].beta = this.config.beta;
      this.filters[i][1].beta = this.config.beta;
      this.filters[i][2].beta = this.config.beta;
    }
  }

  getConfig(): PoseStabilizerConfig {
    return { ...this.config };
  }

  reset() {
    for (let i = 0; i < N_LANDMARKS; i++) {
      this.filters[i][0].reset();
      this.filters[i][1].reset();
      this.filters[i][2].reset();
      this.framesSinceValid[i] = 0;
    }
    this.lastValid.fill(0);
  }
}
