import type { CalibrationData, HandTrackingFrame } from '../types.ts';

const STORAGE_KEY = 'clay_hands_calibration_v1';

export type CalibrationStep =
  | 'waiting-hands'
  | 'hold-inward'
  | 'hold-outward'
  | 'complete';

export interface CalibrationProgress {
  step: CalibrationStep;
  progress: number; // 0..1
  message: string;
  data: CalibrationData;
}

export function createDefaultCalibration(): CalibrationData {
  return {
    calibrated: false,
    centerX: 0.5,
    centerY: 0.54,
    minSpan: 0.14,
    maxSpan: 0.46,
    minY: 0.25,
    maxY: 0.78,
    handScale: 0.14,
    timestamp: 0,
  };
}

export class HandCalibration {
  public data: CalibrationData;
  public step: CalibrationStep = 'waiting-hands';
  private stepTimer = 0;
  private accumCenterX = 0;
  private accumCenterY = 0;
  private accumSpan = 0;
  private accumScale = 0;
  private sampleCount = 0;

  constructor() {
    this.data = this.load() ?? createDefaultCalibration();
  }

  public start(): void {
    this.step = 'waiting-hands';
    this.resetAccumulators();
  }

  private resetAccumulators(): void {
    this.stepTimer = 0;
    this.accumCenterX = 0;
    this.accumCenterY = 0;
    this.accumSpan = 0;
    this.accumScale = 0;
    this.sampleCount = 0;
  }

  public update(frame: HandTrackingFrame, dt: number): CalibrationProgress {
    if (this.step === 'complete') {
      return {
        step: 'complete',
        progress: 1,
        message: 'Calibration complete! Your hands are mapped to the wheel.',
        data: this.data,
      };
    }

    if (frame.hands.length < 2) {
      this.stepTimer = Math.max(0, this.stepTimer - dt * 0.5);
      return {
        step: this.step,
        progress: Math.min(1, this.stepTimer / 1.2),
        message:
          frame.hands.length === 1
            ? 'One hand detected — bring your second hand into camera view.'
            : 'Show both hands comfortably in front of your webcam.',
        data: this.data,
      };
    }

    const left =
      frame.hands.find((h) => h.handedness === 'left') ?? frame.hands[0];
    const right =
      frame.hands.find((h) => h.handedness === 'right') ?? frame.hands[1];

    const midX = (left.palmCenter.x + right.palmCenter.x) * 0.5;
    const midY = (left.palmCenter.y + right.palmCenter.y) * 0.5;
    const span = Math.abs(right.palmCenter.x - left.palmCenter.x);
    const avgScale = (left.handSpan + right.handSpan) * 0.5;

    this.stepTimer += dt;
    this.accumCenterX += midX;
    this.accumCenterY += midY;
    this.accumSpan += span;
    this.accumScale += avgScale;
    this.sampleCount += 1;

    if (this.step === 'waiting-hands') {
      const progress = Math.min(1, this.stepTimer / 1.1);
      if (this.stepTimer >= 1.1 && this.sampleCount > 0) {
        this.data.centerX = this.accumCenterX / this.sampleCount;
        this.data.centerY = this.accumCenterY / this.sampleCount;
        this.data.handScale = Math.max(0.06, this.accumScale / this.sampleCount);
        this.data.minY = Math.max(0.12, this.data.centerY - 0.28);
        this.data.maxY = Math.min(0.88, this.data.centerY + 0.24);
        this.step = 'hold-inward';
        this.resetAccumulators();
      }
      return {
        step: this.step,
        progress,
        message: 'Hold both hands steady in front of you…',
        data: this.data,
      };
    }

    if (this.step === 'hold-inward') {
      const progress = Math.min(1, this.stepTimer / 1.25);
      if (this.stepTimer >= 1.25 && this.sampleCount > 0) {
        this.data.minSpan = Math.max(
          0.06,
          Math.min(0.28, this.accumSpan / this.sampleCount)
        );
        this.step = 'hold-outward';
        this.resetAccumulators();
      }
      return {
        step: this.step,
        progress,
        message: 'Now move both palms slightly inward together (narrowest shape)…',
        data: this.data,
      };
    }

    // hold-outward
    const progress = Math.min(1, this.stepTimer / 1.25);
    if (this.stepTimer >= 1.25 && this.sampleCount > 0) {
      const measuredMax = this.accumSpan / this.sampleCount;
      this.data.maxSpan = Math.max(
        this.data.minSpan + 0.14,
        Math.min(0.72, measuredMax)
      );
      this.data.calibrated = true;
      this.data.timestamp = Date.now();
      this.step = 'complete';
      this.save();
    }

    return {
      step: this.step,
      progress,
      message: 'Now move both hands slightly outward apart (widest shape)…',
      data: this.data,
    };
  }

  public save(): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      return true;
    } catch {
      return false;
    }
  }

  public load(): CalibrationData | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<CalibrationData>;
      if (
        typeof parsed.centerX === 'number' &&
        typeof parsed.minSpan === 'number' &&
        typeof parsed.maxSpan === 'number'
      ) {
        return {
          ...createDefaultCalibration(),
          ...parsed,
        };
      }
      return null;
    } catch {
      return null;
    }
  }
}
