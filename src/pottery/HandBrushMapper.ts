import type { CalibrationData, SmoothedHand } from '../types.ts';

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export interface HandBrushEvaluation {
  hand: SmoothedHand | null;
  inZone: boolean;
  isPinching: boolean;
  aimNDC: { x: number; y: number };
  description: string;
}

/**
 * Selects which tracked hand controls the paintbrush, preferring the user's
 * configured dominant hand when active in the interaction zone.
 */
export function selectBrushHand(
  hands: SmoothedHand[],
  preferredHandedness: 'left' | 'right'
): SmoothedHand | null {
  const active = hands.filter((h) => h.inInteractionZone);
  if (active.length === 0) return null;
  return (
    active.find((h) => h.handedness === preferredHandedness) ?? active[0]
  );
}

/**
 * Maps a tracked hand's stabilized fingertip (index + thumb blend) from
 * calibrated webcam coordinates into camera NDC [-1..1] for vessel raycasting.
 */
export function mapHandTipToBrushNDC(
  hand: SmoothedHand,
  calibration: CalibrationData,
  sensitivity = 1.0
): { x: number; y: number } {
  const tipX = hand.indexTip.x * 0.68 + hand.thumbTip.x * 0.32;
  const tipY = hand.indexTip.y * 0.68 + hand.thumbTip.y * 0.32;

  const halfSpanX = Math.max(0.16, calibration.maxSpan * 0.52);
  const centerY = (calibration.minY + calibration.maxY) * 0.5;
  const halfSpanY = Math.max(0.14, (calibration.maxY - calibration.minY) * 0.5);

  const gain = clamp(0.85 + sensitivity * 0.15, 0.85, 1.2);
  const normX = ((tipX - calibration.centerX) / halfSpanX) * gain;
  // Screen Y increases downward, Three.js NDC Y increases upward
  const normY = -((tipY - centerY) / halfSpanY) * gain;

  return {
    x: clamp(normX * 0.56, -0.78, 0.78),
    y: clamp(normY * 0.54, -0.72, 0.72),
  };
}

/**
 * Stateful evaluator for hand-tracked brush aiming and pinch-to-paint hysteresis.
 */
export class HandBrushTracker {
  private wasPinching = false;
  private readonly enterThreshold = 0.36;
  private readonly exitThreshold = 0.45;

  public reset(): void {
    this.wasPinching = false;
  }

  public evaluate(
    hands: SmoothedHand[],
    calibration: CalibrationData,
    preferredHandedness: 'left' | 'right',
    sensitivity = 1.0
  ): HandBrushEvaluation {
    const hand = selectBrushHand(hands, preferredHandedness);
    if (!hand) {
      this.wasPinching = false;
      return {
        hand: null,
        inZone: false,
        isPinching: false,
        aimNDC: { x: 0, y: 0 },
        description:
          hands.length === 0
            ? 'Show your hand in view — pinch thumb & index to brush paint.'
            : 'Bring your hand closer to center to aim the brush.',
      };
    }

    const pinchRatio = hand.pinchDistance / Math.max(0.05, hand.handSpan);
    if (this.wasPinching) {
      this.wasPinching = pinchRatio < this.exitThreshold;
    } else {
      this.wasPinching = pinchRatio < this.enterThreshold;
    }

    const aimNDC = mapHandTipToBrushNDC(hand, calibration, sensitivity);
    return {
      hand,
      inZone: true,
      isPinching: this.wasPinching,
      aimNDC,
      description: this.wasPinching
        ? 'Pinch painting on clay — move hand to paint, open fingers to lift.'
        : 'Aiming brush with hand — pinch thumb & index to apply pigment.',
    };
  }
}
