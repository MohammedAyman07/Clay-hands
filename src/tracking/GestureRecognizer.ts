import type {
  CalibrationData,
  GestureState,
  PotteryStage,
  SmoothedHand,
} from '../types.ts';

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export interface GestureRecognizerConfig {
  sensitivity: number; // 0.5..2.0
  pinchEnterThreshold: number;
  pinchExitThreshold: number;
  steadySpeedThreshold: number;
  raiseVelocityThreshold: number;
}

const DEFAULT_CONFIG: GestureRecognizerConfig = {
  sensitivity: 1.0,
  pinchEnterThreshold: 0.36,
  pinchExitThreshold: 0.45,
  steadySpeedThreshold: 0.045,
  raiseVelocityThreshold: 0.09,
};

/**
 * Pure, unit-testable gesture recognizer mapping tracked hands + calibration
 * into pottery sculpting intents and estimated shaping strength.
 */
export class GestureRecognizer {
  private readonly config: GestureRecognizerConfig;
  private wasPinching = false;
  private prevSpan: number | null = null;

  constructor(config: Partial<GestureRecognizerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  public setSensitivity(sensitivity: number): void {
    this.config.sensitivity = clamp(sensitivity, 0.4, 2.2);
  }

  public reset(): void {
    this.wasPinching = false;
    this.prevSpan = null;
  }

  public recognize(
    hands: SmoothedHand[],
    calibration: CalibrationData,
    stage: PotteryStage
  ): GestureState {
    const activeHands = hands.filter((h) => h.inInteractionZone);
    if (activeHands.length === 0) {
      this.wasPinching = false;
      this.prevSpan = null;
      return {
        gesture: 'idle',
        strength: 0,
        activeHeightNorm: 0.5,
        activeAngle: 0,
        targetRadiusNorm: 0.5,
        isPinching: false,
        handsCount: hands.length,
        inZone: false,
        description:
          hands.length === 0
            ? 'Place your hands in front of the camera to begin shaping.'
            : 'Bring your hands closer to the center shaping zone.',
      };
    }

    const sens = this.config.sensitivity;

    // Single-hand interaction
    if (activeHands.length === 1) {
      const hand = activeHands[0];
      const pinchRatio = hand.pinchDistance / Math.max(0.05, hand.handSpan);
      const isPinching = this.evaluatePinchHysteresis(pinchRatio);
      const heightNorm = this.mapYToHeightNorm(hand.palmCenter.y, calibration);
      const dx = hand.palmCenter.x - calibration.centerX;
      const targetRadiusNorm = clamp(
        (Math.abs(dx) * 2 - calibration.minSpan) /
          Math.max(0.08, calibration.maxSpan - calibration.minSpan),
        0,
        1
      );
      const activeAngle = Math.atan2(
        hand.palmCenter.z || 0.25,
        dx === 0 ? 0.001 : dx
      );

      if (stage === 'open' && isPinching) {
        return {
          gesture: 'open',
          strength: clamp(0.75 * sens, 0.2, 1),
          activeHeightNorm: clamp(heightNorm, 0.65, 1),
          activeAngle,
          targetRadiusNorm,
          isPinching: true,
          handsCount: 1,
          inZone: true,
          description: 'Opening the hollow interior with pinched fingers.',
        };
      }

      if (isPinching && heightNorm > 0.45) {
        return {
          gesture: 'pinch_neck',
          strength: clamp(0.68 * sens, 0.2, 1),
          activeHeightNorm: heightNorm,
          activeAngle,
          targetRadiusNorm,
          isPinching: true,
          handsCount: 1,
          inZone: true,
          description: 'Pinching to narrow the vessel neck.',
        };
      }

      const pushInward = hand.velocity.x * Math.sign(dx || 1) < -0.02;
      const strength = clamp(
        (0.35 + hand.speed * 1.4) * sens,
        0.18,
        0.85
      );
      return {
        gesture: 'one_side',
        strength,
        activeHeightNorm: heightNorm,
        activeAngle,
        targetRadiusNorm: pushInward ? 0.2 : 0.8,
        isPinching,
        handsCount: 1,
        inZone: true,
        description:
          'One hand active — gently contouring one side of the clay.',
      };
    }

    // Two-hand interaction
    const left =
      activeHands.find((h) => h.handedness === 'left') ?? activeHands[0];
    const right =
      activeHands.find((h) => h.handedness === 'right') ?? activeHands[1];

    const avgY = (left.palmCenter.y + right.palmCenter.y) * 0.5;
    const heightNorm = this.mapYToHeightNorm(avgY, calibration);
    const span = Math.abs(right.palmCenter.x - left.palmCenter.x);
    const spanNorm = clamp(
      (span - calibration.minSpan) /
        Math.max(0.08, calibration.maxSpan - calibration.minSpan),
      0,
      1
    );

    const spanDelta =
      this.prevSpan !== null ? (span - this.prevSpan) * sens : 0;
    this.prevSpan = span;

    // Average upward velocity (in webcam normalized coords, up is negative Y; in 3D, up is positive Y.
    // We standardize HandTracker & XRManager so palmCenter.y is 0 at top -> 1 at bottom for webcam OR
    // let's make HandInputMapper normalize upward velocity!
    // Even cleaner: SmoothedHand.velocity.y is positive when moving UP in studio space!)
    const avgVy = (left.velocity.y + right.velocity.y) * 0.5;
    const avgSpeed = (left.speed + right.speed) * 0.5;

    const leftPinch = left.pinchDistance / Math.max(0.05, left.handSpan);
    const rightPinch = right.pinchDistance / Math.max(0.05, right.handSpan);
    const minPinchRatio = Math.min(leftPinch, rightPinch);
    const isPinching = this.evaluatePinchHysteresis(minPinchRatio);

    // 1. Opening stage with pinch near upper clay
    if (stage === 'open' && (isPinching || spanNorm < 0.25)) {
      return {
        gesture: 'open',
        strength: clamp(0.8 * sens, 0.25, 1),
        activeHeightNorm: Math.max(0.7, heightNorm),
        activeAngle: 0,
        targetRadiusNorm: spanNorm,
        isPinching,
        handsCount: 2,
        inZone: true,
        description: 'Opening the hollow center of your vessel.',
      };
    }

    // 2. Pinch neck gesture
    if (isPinching) {
      const pinchStrength = clamp(
        ((this.config.pinchExitThreshold - minPinchRatio) / 0.22) * sens,
        0.3,
        1
      );
      return {
        gesture: 'pinch_neck',
        strength: pinchStrength,
        activeHeightNorm: heightNorm,
        activeAngle: 0,
        targetRadiusNorm: spanNorm,
        isPinching: true,
        handsCount: 2,
        inZone: true,
        description: 'Pinch detected — narrowing the neck cleanly.',
      };
    }

    // 3. Raise walls when both hands lift smoothly upward while keeping contact
    if (avgVy * sens > this.config.raiseVelocityThreshold && spanNorm < 0.72) {
      const strength = clamp((avgVy * 3.8) * sens, 0.28, 1);
      return {
        gesture: 'raise',
        strength,
        activeHeightNorm: heightNorm,
        activeAngle: 0,
        targetRadiusNorm: spanNorm,
        isPinching: false,
        handsCount: 2,
        inZone: true,
        description: 'Raising the walls upward.',
      };
    }

    // 4. Steady hands near clay -> Smooth surface (especially in smooth stage or mid-span steady)
    if (
      avgSpeed < this.config.steadySpeedThreshold &&
      Math.abs(spanDelta) < 0.008 &&
      (stage === 'smooth' || (spanNorm > 0.24 && spanNorm < 0.72))
    ) {
      return {
        gesture: 'smooth',
        strength: clamp(0.65 * sens, 0.25, 0.95),
        activeHeightNorm: heightNorm,
        activeAngle: 0,
        targetRadiusNorm: spanNorm,
        isPinching: false,
        handsCount: 2,
        inZone: true,
        description: 'Hands steady — smoothing the clay surface.',
      };
    }

    // 5. Compress (palms moving inward or held inside narrow shaping band)
    if (spanDelta < -0.005 || spanNorm < 0.36) {
      const inwardEffort = clamp(
        (0.36 - spanNorm) * 1.8 + Math.max(0, -spanDelta * 26),
        0.22,
        1
      );
      return {
        gesture: 'compress',
        strength: clamp(inwardEffort * sens, 0.2, 1),
        activeHeightNorm: heightNorm,
        activeAngle: 0,
        targetRadiusNorm: spanNorm,
        isPinching: false,
        handsCount: 2,
        inZone: true,
        description:
          stage === 'center'
            ? 'Compressing inward to center the clay.'
            : 'Compressing clay inward.',
      };
    }

    // 6. Widen (palms moving outward or held in wide shaping band)
    if (spanDelta > 0.005 || spanNorm > 0.56) {
      const outwardEffort = clamp(
        (spanNorm - 0.52) * 1.8 + Math.max(0, spanDelta * 26),
        0.22,
        1
      );
      return {
        gesture: 'widen',
        strength: clamp(outwardEffort * sens, 0.2, 1),
        activeHeightNorm: heightNorm,
        activeAngle: 0,
        targetRadiusNorm: spanNorm,
        isPinching: false,
        handsCount: 2,
        inZone: true,
        description: 'Widening the vessel body outward.',
      };
    }

    return {
      gesture: 'smooth',
      strength: clamp(0.45 * sens, 0.2, 0.8),
      activeHeightNorm: heightNorm,
      activeAngle: 0,
      targetRadiusNorm: spanNorm,
      isPinching: false,
      handsCount: 2,
      inZone: true,
      description: 'Lightly supporting and smoothing the spinning clay.',
    };
  }

  private evaluatePinchHysteresis(pinchRatio: number): boolean {
    if (this.wasPinching) {
      this.wasPinching = pinchRatio < this.config.pinchExitThreshold;
    } else {
      this.wasPinching = pinchRatio < this.config.pinchEnterThreshold;
    }
    return this.wasPinching;
  }

  private mapYToHeightNorm(y: number, cal: CalibrationData): number {
    // In normalized screen space, minY is top (heightNorm = 1), maxY is bottom (heightNorm = 0)
    const span = Math.max(0.12, cal.maxY - cal.minY);
    const norm = 1 - (y - cal.minY) / span;
    return clamp(norm, 0.05, 0.98);
  }
}
