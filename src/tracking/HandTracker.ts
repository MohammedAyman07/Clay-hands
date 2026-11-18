import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type {
  CalibrationData,
  HandTrackingFrame,
  RawLandmark,
  SmoothedHand,
  TrackingErrorType,
  Vec3,
} from '../types.ts';

const LOCAL_WASM_PATH = '/mediapipe/wasm';
const LOCAL_MODEL_PATH = '/mediapipe/hand_landmarker.task';
const FALLBACK_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

function dist3(a: RawLandmark, b: RawLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

interface FilterState {
  palm: Vec3;
  wrist: Vec3;
  thumb: Vec3;
  index: Vec3;
  middle: Vec3;
  ring: Vec3;
  pinky: Vec3;
  landmarks: RawLandmark[];
  lastTimestamp: number;
}

/**
 * Real MediaPipe Tasks Vision Hand Landmarker wrapper.
 * Requests webcam permission ONLY when explicitly started by the user.
 */
export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private startPromise: Promise<{
    ok: boolean;
    errorType: TrackingErrorType;
    message: string;
  }> | null = null;
  private sessionEpoch = 0;
  private lastInferenceTime = 0;
  private lastVideoTime = -1;
  private inferenceIntervalMs = 1000 / 24;
  private smoothingAlpha = 0.42;

  private readonly filters = new Map<'left' | 'right', FilterState>();
  private latestFrame: HandTrackingFrame = {
    timestamp: 0,
    hands: [],
    source: 'webcam',
  };
  private lastHandSeenTime = 0;

  public status: 'idle' | 'requesting' | 'loading-model' | 'ready' | 'error' =
    'idle';
  public errorType: TrackingErrorType = 'none';
  public errorMessage = '';

  public get videoElement(): HTMLVideoElement | null {
    return this.video;
  }

  public get isReady(): boolean {
    return this.status === 'ready' && this.running;
  }

  public get isTrackingLost(): boolean {
    return (
      this.isReady &&
      this.latestFrame.hands.length === 0 &&
      this.lastHandSeenTime > 0 &&
      performance.now() - this.lastHandSeenTime > 1500
    );
  }

  public setInferenceFps(fps: number): void {
    const clamped = Math.max(10, Math.min(30, fps));
    this.inferenceIntervalMs = 1000 / clamped;
  }

  public setSmoothing(sensitivity: number): void {
    // Higher sensitivity = slightly crisper response (higher alpha)
    this.smoothingAlpha = Math.max(0.22, Math.min(0.68, 0.36 * sensitivity));
  }

  public startWebcamAndModel(): Promise<{
    ok: boolean;
    errorType: TrackingErrorType;
    message: string;
  }> {
    if (this.isReady) {
      return Promise.resolve({
        ok: true,
        errorType: 'none',
        message: 'Hand tracking active.',
      });
    }
    if (this.startPromise) {
      return this.startPromise;
    }

    const epoch = ++this.sessionEpoch;
    this.startPromise = this.runStartWebcamAndModel(epoch).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async runStartWebcamAndModel(epoch: number): Promise<{
    ok: boolean;
    errorType: TrackingErrorType;
    message: string;
  }> {
    this.errorType = 'none';
    this.errorMessage = '';

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw Object.assign(new Error('Camera API unavailable in this browser.'), {
          name: 'NotFoundError',
        });
      }

      this.status = 'requesting';
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
          facingMode: 'user',
        },
        audio: false,
      });

      if (epoch !== this.sessionEpoch) {
        stream.getTracks().forEach((t) => t.stop());
        return {
          ok: false,
          errorType: 'none',
          message: 'Hand tracking stopped.',
        };
      }

      this.stream = stream;

      if (!this.video) {
        this.video = document.createElement('video');
        this.video.playsInline = true;
        this.video.muted = true;
      }
      this.video.srcObject = this.stream;
      await this.video.play();

      this.status = 'loading-model';
      if (!this.landmarker) {
        this.landmarker = await this.createLandmarker();
      }

      if (epoch !== this.sessionEpoch) {
        this.stopStream();
        return {
          ok: false,
          errorType: 'none',
          message: 'Hand tracking stopped.',
        };
      }

      this.running = true;
      this.status = 'ready';
      this.lastHandSeenTime = performance.now();
      return { ok: true, errorType: 'none', message: 'Hand tracking active.' };
    } catch (err) {
      const error = err as Error & { name?: string };
      const name = error?.name ?? '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        this.errorType = 'permission-denied';
        this.errorMessage =
          'Webcam permission was denied. Enable camera access for hand tracking, or use Mouse Fallback.';
      } else if (
        name === 'NotFoundError' ||
        name === 'DevicesNotFoundError' ||
        name === 'NotReadableError'
      ) {
        this.errorType = 'no-camera';
        this.errorMessage =
          'No accessible webcam was detected. Enter Meta Quest VR for hands, or use Mouse Fallback.';
      } else {
        this.errorType = 'model-load-failed';
        this.errorMessage =
          error?.message ||
          'Could not initialize hand tracking model. Mouse Fallback remains available.';
      }
      this.status = 'error';
      this.stopStream();
      return {
        ok: false,
        errorType: this.errorType,
        message: this.errorMessage,
      };
    }
  }

  private async createLandmarker(): Promise<HandLandmarker> {
    const vision = await FilesetResolver.forVisionTasks(LOCAL_WASM_PATH);
    const modelPaths = [LOCAL_MODEL_PATH, FALLBACK_MODEL_URL];

    for (const modelAssetPath of modelPaths) {
      for (const delegate of ['GPU', 'CPU'] as const) {
        try {
          return await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath,
              delegate,
            },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        } catch {
          // Try next delegate or fallback model URL
        }
      }
    }
    throw new Error('Failed to load MediaPipe HandLandmarker model.');
  }

  public pollFrame(
    now: number,
    calibration: CalibrationData
  ): HandTrackingFrame {
    if (
      !this.running ||
      !this.landmarker ||
      !this.video ||
      this.video.readyState < 2
    ) {
      return this.latestFrame;
    }

    if (now - this.lastInferenceTime < this.inferenceIntervalMs) {
      return this.latestFrame;
    }

    const videoTime = this.video.currentTime;
    if (videoTime === this.lastVideoTime) {
      return this.latestFrame;
    }

    this.lastInferenceTime = now;
    this.lastVideoTime = videoTime;

    const result = this.landmarker.detectForVideo(this.video, now);
    this.latestFrame = this.processResult(result, now, calibration);
    if (this.latestFrame.hands.length > 0) {
      this.lastHandSeenTime = now;
    }
    return this.latestFrame;
  }

  private processResult(
    result: HandLandmarkerResult,
    now: number,
    calibration: CalibrationData
  ): HandTrackingFrame {
    const smoothedHands: SmoothedHand[] = [];
    const seen = new Set<'left' | 'right'>();

    const lmList = result.landmarks ?? [];
    for (let i = 0; i < lmList.length; i++) {
      const raw = lmList[i];
      if (!raw || raw.length < 21) continue;

      // Mirror X coordinate so selfie webcam feels natural like a mirror
      const mirrored: RawLandmark[] = raw.map((pt) => ({
        x: 1 - pt.x,
        y: pt.y,
        z: pt.z,
      }));

      // MediaPipe handedness for selfie-mirrored image: flip Left <-> Right label
      const category = result.handednesses?.[i]?.[0];
      const rawLabel = (category?.categoryName ?? 'Right').toLowerCase();
      let handedness: 'left' | 'right' =
        rawLabel === 'left' ? 'right' : 'left';
      if (seen.has(handedness)) {
        handedness = handedness === 'left' ? 'right' : 'left';
      }
      seen.add(handedness);

      const palmRaw: Vec3 = {
        x: (mirrored[0].x + mirrored[5].x + mirrored[9].x + mirrored[17].x) * 0.25,
        y: (mirrored[0].y + mirrored[5].y + mirrored[9].y + mirrored[17].y) * 0.25,
        z: (mirrored[0].z + mirrored[5].z + mirrored[9].z + mirrored[17].z) * 0.25,
      };

      const prev = this.filters.get(handedness);
      const a = this.smoothingAlpha;

      const lerpVec = (cur: Vec3, old?: Vec3): Vec3 =>
        old
          ? {
              x: old.x + (cur.x - old.x) * a,
              y: old.y + (cur.y - old.y) * a,
              z: old.z + (cur.z - old.z) * a,
            }
          : { ...cur };

      const palm = lerpVec(palmRaw, prev?.palm);
      const wrist = lerpVec(mirrored[0], prev?.wrist);
      const thumb = lerpVec(mirrored[4], prev?.thumb);
      const index = lerpVec(mirrored[8], prev?.index);
      const middle = lerpVec(mirrored[12], prev?.middle);
      const ring = lerpVec(mirrored[16], prev?.ring);
      const pinky = lerpVec(mirrored[20], prev?.pinky);

      const smoothedLandmarks: RawLandmark[] = mirrored.map((pt, idx) =>
        prev?.landmarks[idx]
          ? {
              x: prev.landmarks[idx].x + (pt.x - prev.landmarks[idx].x) * a,
              y: prev.landmarks[idx].y + (pt.y - prev.landmarks[idx].y) * a,
              z: prev.landmarks[idx].z + (pt.z - prev.landmarks[idx].z) * a,
            }
          : pt
      );

      const dtSec = prev ? Math.max(0.016, (now - prev.lastTimestamp) / 1000) : 0.04;
      // Note: upward in image (decreasing y) becomes positive velocity.y in studio coordinates!
      const velocity: Vec3 = prev
        ? {
            x: (palm.x - prev.palm.x) / dtSec,
            y: -(palm.y - prev.palm.y) / dtSec,
            z: (palm.z - prev.palm.z) / dtSec,
          }
        : { x: 0, y: 0, z: 0 };

      this.filters.set(handedness, {
        palm,
        wrist,
        thumb,
        index,
        middle,
        ring,
        pinky,
        landmarks: smoothedLandmarks,
        lastTimestamp: now,
      });

      const handSpan = Math.max(0.05, dist3(mirrored[0], mirrored[9]));
      const pinchDistance = dist3(thumb, index);

      // Estimate finger curl from tip-to-wrist vs MCP-to-wrist ratio
      const mcpDist =
        (dist3(mirrored[0], mirrored[5]) +
          dist3(mirrored[0], mirrored[9]) +
          dist3(mirrored[0], mirrored[13])) /
        3;
      const tipDist =
        (dist3(mirrored[0], index) +
          dist3(mirrored[0], middle) +
          dist3(mirrored[0], ring)) /
        3;
      const fingerCurl = Math.max(
        0,
        Math.min(1, 1 - (tipDist / Math.max(0.04, mcpDist) - 0.85) / 1.05)
      );

      const dxFromCenter = Math.abs(palm.x - calibration.centerX);
      const inInteractionZone =
        dxFromCenter <= Math.max(0.42, calibration.maxSpan * 0.72) &&
        palm.y >= 0.08 &&
        palm.y <= 0.94;

      smoothedHands.push({
        handedness,
        confidence: category?.score ?? 0.8,
        palmCenter: palm,
        wrist,
        thumbTip: thumb,
        indexTip: index,
        middleTip: middle,
        ringTip: ring,
        pinkyTip: pinky,
        pinchDistance,
        handSpan,
        fingerCurl,
        velocity,
        speed: Math.hypot(velocity.x, velocity.y),
        inInteractionZone,
        landmarks: smoothedLandmarks,
      });
    }

    // Clear stale filters for hands no longer visible
    for (const key of ['left', 'right'] as const) {
      if (!seen.has(key)) this.filters.delete(key);
    }

    return {
      timestamp: now,
      hands: smoothedHands,
      source: 'webcam',
    };
  }

  public stop(): void {
    this.sessionEpoch++;
    this.running = false;
    this.status = 'idle';
    this.stopStream();
    this.filters.clear();
    this.latestFrame = { timestamp: 0, hands: [], source: 'webcam' };
  }

  private stopStream(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
  }

  public dispose(): void {
    this.stop();
    this.landmarker?.close();
    this.landmarker = null;
  }
}
