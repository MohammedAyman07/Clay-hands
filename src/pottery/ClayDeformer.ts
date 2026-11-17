import type { ClayProfileState } from '../types.ts';
import { CLAY_LIMITS } from './PotteryPresets.ts';

export interface DeformParams {
  /** Normalized vertical coordinate along clay height (0 = base, 1 = rim) */
  heightNorm: number;
  /** Operation intensity (0..1) */
  strength: number;
  /** Vertical brush falloff in normalized height units */
  falloff?: number;
  /** Delta time in seconds */
  dt: number;
  /** Target angle in radians for one-side shaping */
  angle?: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function gaussianWeight(distance: number, sigma: number): number {
  const ratio = distance / Math.max(0.01, sigma);
  return Math.exp(-0.5 * ratio * ratio);
}

/**
 * Pure, bounded procedural radial clay deformation functions.
 * Designed to avoid spikes, holes, and self-intersections.
 */
export class ClayDeformer {
  /** Center the clay mound (reduces wobble and balances outer profile). */
  public static centerClay(profile: ClayProfileState, params: DeformParams): void {
    const rate = clamp(params.strength * params.dt * 1.4, 0, 0.35);
    profile.wobble = Math.max(0, profile.wobble - rate * 0.9);
    // Gently calm angular offsets when centering
    for (let i = 0; i < profile.angularOffsets.length; i++) {
      profile.angularOffsets[i] *= 1 - rate * 0.65;
    }
    // Slight gentle inward compression toward centered form
    const R = profile.ringCount;
    for (let i = 1; i < R; i++) {
      const target = 0.082 * (1 - 0.14 * (i / (R - 1)));
      profile.outerRadii[i] += (target - profile.outerRadii[i]) * rate * 0.25;
      ClayDeformer.syncInnerRing(profile, i);
    }
  }

  /** Open the hollow interior at the top center of the clay. */
  public static openClay(profile: ClayProfileState, params: DeformParams): void {
    const step = clamp(params.strength * params.dt * 0.9, 0, 0.16);
    profile.openDepth = clamp(profile.openDepth + step, 0.04, 0.96);
    profile.wobble = Math.max(0, profile.wobble - step * 0.35);

    const R = profile.ringCount;
    for (let i = 0; i < R; i++) {
      const t = i / (R - 1);
      const wallRatio = 0.42 + 0.36 * t * profile.openDepth;
      const desiredInner = Math.max(
        0.008,
        Math.min(
          profile.outerRadii[i] - CLAY_LIMITS.minWallThickness,
          profile.outerRadii[i] * wallRatio
        )
      );
      profile.innerRadii[i] += (desiredInner - profile.innerRadii[i]) * 0.22;
    }
  }

  /** Compress clay inward around active height. */
  public static compress(profile: ClayProfileState, params: DeformParams): void {
    const sigma = params.falloff ?? 0.22;
    const R = profile.ringCount;
    const deltaBase = clamp(params.strength * params.dt * 0.095, 0, 0.015);

    for (let i = 1; i < R; i++) {
      const t = i / (R - 1);
      const weight = gaussianWeight(t - params.heightNorm, sigma);
      if (weight < 0.02) continue;

      const nextR = profile.outerRadii[i] - deltaBase * weight;
      profile.outerRadii[i] = clamp(
        nextR,
        CLAY_LIMITS.minRadius,
        CLAY_LIMITS.maxRadius
      );
      ClayDeformer.syncInnerRing(profile, i);
    }
    ClayDeformer.enforceSmoothGradient(profile, 0.14);
  }

  /** Widen clay outward around active height. */
  public static widen(profile: ClayProfileState, params: DeformParams): void {
    const sigma = params.falloff ?? 0.24;
    const R = profile.ringCount;
    const deltaBase = clamp(params.strength * params.dt * 0.095, 0, 0.015);

    for (let i = 1; i < R; i++) {
      const t = i / (R - 1);
      const weight = gaussianWeight(t - params.heightNorm, sigma);
      if (weight < 0.02) continue;

      const nextR = profile.outerRadii[i] + deltaBase * weight;
      profile.outerRadii[i] = clamp(
        nextR,
        CLAY_LIMITS.minRadius,
        CLAY_LIMITS.maxRadius
      );
      ClayDeformer.syncInnerRing(profile, i);
    }
    ClayDeformer.enforceSmoothGradient(profile, 0.14);
  }

  /** Pinch thumb & index together to form a narrow neck without sharp spikes. */
  public static pinchNeck(profile: ClayProfileState, params: DeformParams): void {
    const sigma = params.falloff ?? 0.15;
    const R = profile.ringCount;
    const targetHeight = clamp(params.heightNorm, 0.35, 0.96);
    const deltaBase = clamp(params.strength * params.dt * 0.115, 0, 0.016);

    for (let i = 2; i < R; i++) {
      const t = i / (R - 1);
      const weight = gaussianWeight(t - targetHeight, sigma);
      if (weight < 0.02) continue;

      const nextR = profile.outerRadii[i] - deltaBase * weight;
      profile.outerRadii[i] = clamp(
        nextR,
        CLAY_LIMITS.minRadius,
        CLAY_LIMITS.maxRadius
      );
      ClayDeformer.syncInnerRing(profile, i);
    }
    ClayDeformer.enforceSmoothGradient(profile, 0.18);
  }

  /** Raise walls gradually upward while keeping the base grounded at y = 0. */
  public static raise(profile: ClayProfileState, params: DeformParams): void {
    const R = profile.ringCount;
    const currentHeight = profile.heights[R - 1] - profile.heights[0];
    if (currentHeight >= CLAY_LIMITS.maxHeight) return;

    const growth = clamp(params.strength * params.dt * 0.085, 0, 0.012);
    const newHeight = clamp(
      currentHeight + growth,
      CLAY_LIMITS.minHeight,
      CLAY_LIMITS.maxHeight
    );
    const scale = newHeight / Math.max(0.001, currentHeight);

    for (let i = 0; i < R; i++) {
      profile.heights[i] = profile.heights[0] + (profile.heights[i] - profile.heights[0]) * scale;
      // Subtle volume-conservation thinning when walls rise
      if (i > 2) {
        const t = i / (R - 1);
        const pullNarrow = growth * 0.18 * t;
        profile.outerRadii[i] = clamp(
          profile.outerRadii[i] - pullNarrow,
          CLAY_LIMITS.minRadius,
          CLAY_LIMITS.maxRadius
        );
        ClayDeformer.syncInnerRing(profile, i);
      }
    }
    ClayDeformer.enforceSmoothGradient(profile, 0.12);
  }

  /** Gentle localized one-side contour shaping blended smoothly around circumference. */
  public static shapeOneSide(
    profile: ClayProfileState,
    params: DeformParams & { pushInward?: boolean }
  ): void {
    const R = profile.ringCount;
    const S = profile.angularSegments;
    const sigmaH = params.falloff ?? 0.22;
    const targetAngle = params.angle ?? 0;
    const dir = params.pushInward ? -1 : 1;
    const delta = clamp(params.strength * params.dt * 0.045, 0, 0.008) * dir;

    for (let i = 2; i < R - 1; i++) {
      const t = i / (R - 1);
      const wH = gaussianWeight(t - params.heightNorm, sigmaH);
      if (wH < 0.03) continue;

      for (let seg = 0; seg < S; seg++) {
        const theta = (seg / S) * Math.PI * 2;
        let diff = theta - targetAngle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        const wA = gaussianWeight(diff, 0.65);
        const idx = i * S + seg;
        const maxOffset = profile.outerRadii[i] * 0.22;
        profile.angularOffsets[idx] = clamp(
          profile.angularOffsets[idx] + delta * wH * wA,
          -maxOffset,
          maxOffset
        );
      }
    }
  }

  /** Smooth small irregularities without erasing the overall vessel silhouette. */
  public static smooth(profile: ClayProfileState, params: DeformParams): void {
    const R = profile.ringCount;
    const S = profile.angularSegments;
    const alpha = clamp(params.strength * params.dt * 1.35, 0, 0.28);

    // Copy current radii for Laplacian pass
    const copyOuter = [...profile.outerRadii];
    for (let i = 1; i < R - 1; i++) {
      const avg = (copyOuter[i - 1] + copyOuter[i] * 2 + copyOuter[i + 1]) * 0.25;
      profile.outerRadii[i] = clamp(
        copyOuter[i] + (avg - copyOuter[i]) * alpha,
        CLAY_LIMITS.minRadius,
        CLAY_LIMITS.maxRadius
      );
      ClayDeformer.syncInnerRing(profile, i);
    }

    // Smooth angular offsets gently
    for (let i = 1; i < R - 1; i++) {
      for (let seg = 0; seg < S; seg++) {
        const prevSeg = (seg - 1 + S) % S;
        const nextSeg = (seg + 1) % S;
        const idx = i * S + seg;
        const avgAng =
          (profile.angularOffsets[i * S + prevSeg] +
            profile.angularOffsets[idx] * 2 +
            profile.angularOffsets[i * S + nextSeg]) *
          0.25;
        profile.angularOffsets[idx] =
          (profile.angularOffsets[idx] +
            (avgAng - profile.angularOffsets[idx]) * alpha) *
          (1 - alpha * 0.35);
      }
    }

    profile.surfaceRoughness = Math.max(0.08, profile.surfaceRoughness - alpha * 0.45);
    profile.wobble = Math.max(0, profile.wobble - alpha * 0.4);
  }

  private static syncInnerRing(profile: ClayProfileState, i: number): void {
    const maxInner = Math.max(
      0.005,
      profile.outerRadii[i] - CLAY_LIMITS.minWallThickness
    );
    const t = i / (profile.ringCount - 1);
    const targetInner =
      profile.openDepth < 0.15
        ? Math.min(maxInner, profile.outerRadii[i] * 0.28)
        : Math.min(
            maxInner,
            Math.max(
              0.008,
              profile.outerRadii[i] - (0.017 - 0.004 * t * profile.openDepth)
            )
          );
    profile.innerRadii[i] = clamp(
      profile.innerRadii[i] + (targetInner - profile.innerRadii[i]) * 0.65,
      0.005,
      maxInner
    );
  }

  private static enforceSmoothGradient(
    profile: ClayProfileState,
    blend: number
  ): void {
    const R = profile.ringCount;
    const prev = [...profile.outerRadii];
    for (let i = 1; i < R - 1; i++) {
      const neighborAvg = (prev[i - 1] + prev[i + 1]) * 0.5;
      profile.outerRadii[i] = clamp(
        prev[i] * (1 - blend) + neighborAvg * blend,
        CLAY_LIMITS.minRadius,
        CLAY_LIMITS.maxRadius
      );
      ClayDeformer.syncInnerRing(profile, i);
    }
  }
}
