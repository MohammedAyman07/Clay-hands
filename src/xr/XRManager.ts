import * as THREE from 'three';
import * as xb from 'xrblocks';
import type {
  CalibrationData,
  HandTrackingFrame,
  SmoothedHand,
  Vec3,
} from '../types.ts';

/**
 * Optional WebXR session & hand-joint bridge.
 * Never makes a headset mandatory; gracefully reports availability.
 */
export class XRManager {
  public vrSupported = false;
  public arSupported = false;
  public inXRSession = false;
  public handTrackingActive = false;
  public statusMessage = 'Checking WebXR support…';

  private readonly prevPalmPos = new Map<'left' | 'right', THREE.Vector3>();
  private prevTimestamp = 0;

  private readonly _wrist = new THREE.Vector3();
  private readonly _indexTip = new THREE.Vector3();
  private readonly _thumbTip = new THREE.Vector3();
  private readonly _middleTip = new THREE.Vector3();
  private readonly _ringTip = new THREE.Vector3();
  private readonly _pinkyTip = new THREE.Vector3();
  private readonly _localPos = new THREE.Vector3();

  public async probeSupport(): Promise<void> {
    if (typeof navigator === 'undefined' || !('xr' in navigator) || !navigator.xr) {
      this.vrSupported = false;
      this.arSupported = false;
      this.statusMessage =
        'WebXR not detected in this browser. Using Webcam / Mouse Studio.';
      return;
    }

    try {
      this.vrSupported = await navigator.xr.isSessionSupported('immersive-vr');
    } catch {
      this.vrSupported = false;
    }

    try {
      this.arSupported = await navigator.xr.isSessionSupported('immersive-ar');
    } catch {
      this.arSupported = false;
    }

    if (this.vrSupported || this.arSupported) {
      this.statusMessage =
        'WebXR supported! You can enter VR or continue with Webcam / Mouse.';
    } else {
      this.statusMessage =
        'No WebXR headset session available. Webcam & Mouse Studio ready.';
    }
  }

  public async toggleVRSession(): Promise<boolean> {
    const manager = xb.core?.webXRSessionManager;
    if (!manager || (!this.vrSupported && !this.arSupported)) {
      return false;
    }

    try {
      if (this.inXRSession) {
        const session = xb.core.renderer?.xr?.getSession?.();
        await session?.end();
        return false;
      }
      await manager.startSession?.();
      return true;
    } catch {
      this.statusMessage =
        'Could not start WebXR session. Continuing in desktop studio.';
      return false;
    }
  }

  public sampleXRHands(
    now: number,
    wheelOriginWorld: THREE.Vector3,
    wheelGroupInverse: THREE.Matrix4,
    clayHeight: number
  ): { frame: HandTrackingFrame; calibration: CalibrationData } | null {
    const input = xb.core?.input;
    const xrHands = xb.core?.user?.hands;
    if (!this.inXRSession || !xrHands || !input?.hands) return null;

    const dtSec = this.prevTimestamp
      ? Math.max(0.016, (now - this.prevTimestamp) / 1000)
      : 0.03;
    this.prevTimestamp = now;

    const hands: SmoothedHand[] = [];
    const seen = new Set<'left' | 'right'>();

    for (let i = 0; i < input.hands.length; i++) {
      const handSpace = input.hands[i] as THREE.XRHandSpace & {
        inputSource?: XRInputSource;
      };
      if (!handSpace || !handSpace.visible || !handSpace.joints) continue;

      const wristSpace = handSpace.joints['wrist'];
      const indexSpace = handSpace.joints['index-finger-tip'];
      const thumbSpace = handSpace.joints['thumb-tip'];
      if (
        !wristSpace ||
        !indexSpace ||
        !thumbSpace ||
        !wristSpace.visible ||
        !indexSpace.visible ||
        !thumbSpace.visible
      ) {
        continue;
      }

      const controller = input.controllers[i] as
        | { inputSource?: XRInputSource }
        | undefined;
      const rawHandedness =
        handSpace.inputSource?.handedness ??
        controller?.inputSource?.handedness;

      wristSpace.getWorldPosition(this._wrist);
      indexSpace.getWorldPosition(this._indexTip);
      thumbSpace.getWorldPosition(this._thumbTip);

      // Guard against uninitialized origin transforms
      if (
        this._wrist.lengthSq() < 1e-6 &&
        this._indexTip.lengthSq() < 1e-6
      ) {
        continue;
      }

      const middleSpace = handSpace.joints['middle-finger-tip'];
      const ringSpace = handSpace.joints['ring-finger-tip'];
      const pinkySpace = handSpace.joints['pinky-finger-tip'];
      if (middleSpace?.visible) middleSpace.getWorldPosition(this._middleTip);
      else this._middleTip.copy(this._indexTip);
      if (ringSpace?.visible) ringSpace.getWorldPosition(this._ringTip);
      else this._ringTip.copy(this._middleTip);
      if (pinkySpace?.visible) pinkySpace.getWorldPosition(this._pinkyTip);
      else this._pinkyTip.copy(this._ringTip);

      // Convert palm midpoint relative to clay mount local space
      this._localPos
        .copy(this._wrist)
        .lerp(this._indexTip, 0.38)
        .applyMatrix4(wheelGroupInverse);

      const handId: 'left' | 'right' =
        rawHandedness === 'left' || rawHandedness === 'right'
          ? rawHandedness
          : this._localPos.x < 0
            ? 'left'
            : 'right';

      if (seen.has(handId)) continue;
      seen.add(handId);

      const prev = this.prevPalmPos.get(handId);
      const velocity: Vec3 = prev
        ? {
            x: (this._localPos.x - prev.x) / dtSec,
            y: (this._localPos.y - prev.y) / dtSec,
            z: (this._localPos.z - prev.z) / dtSec,
          }
        : { x: 0, y: 0, z: 0 };

      if (!prev) {
        this.prevPalmPos.set(handId, this._localPos.clone());
      } else {
        prev.copy(this._localPos);
      }

      const pinchDist = this._thumbTip.distanceTo(this._indexTip);
      const handSpan = Math.max(0.075, this._wrist.distanceTo(this._indexTip));
      const avgExtension =
        (this._wrist.distanceTo(this._indexTip) +
          this._wrist.distanceTo(this._middleTip) +
          this._wrist.distanceTo(this._ringTip)) /
        3;
      const fingerCurl = THREE.MathUtils.clamp(
        1 - (avgExtension - 0.065) / 0.115,
        0,
        1
      );

      const radialDist = Math.hypot(this._localPos.x, this._localPos.z);
      const inZone =
        radialDist < 0.4 &&
        this._localPos.y > -0.09 &&
        this._localPos.y < clayHeight + 0.18;

      // Map 3D wheel-local coordinates into normalized gesture space [0..1]
      const normX = 0.5 + this._localPos.x * 1.45;
      const normY = THREE.MathUtils.clamp(
        1 - this._localPos.y / Math.max(0.18, clayHeight),
        0,
        1
      );

      hands.push({
        handedness: handId,
        confidence: 1,
        palmCenter: { x: normX, y: normY, z: this._localPos.z },
        wrist: { x: normX, y: normY, z: this._localPos.z },
        thumbTip: {
          x: this._thumbTip.x - wheelOriginWorld.x,
          y: this._thumbTip.y - wheelOriginWorld.y,
          z: this._thumbTip.z - wheelOriginWorld.z,
        },
        indexTip: {
          x: this._indexTip.x - wheelOriginWorld.x,
          y: this._indexTip.y - wheelOriginWorld.y,
          z: this._indexTip.z - wheelOriginWorld.z,
        },
        middleTip: {
          x: this._middleTip.x - wheelOriginWorld.x,
          y: this._middleTip.y - wheelOriginWorld.y,
          z: this._middleTip.z - wheelOriginWorld.z,
        },
        ringTip: {
          x: this._ringTip.x - wheelOriginWorld.x,
          y: this._ringTip.y - wheelOriginWorld.y,
          z: this._ringTip.z - wheelOriginWorld.z,
        },
        pinkyTip: {
          x: this._pinkyTip.x - wheelOriginWorld.x,
          y: this._pinkyTip.y - wheelOriginWorld.y,
          z: this._pinkyTip.z - wheelOriginWorld.z,
        },
        pinchDistance: pinchDist,
        handSpan,
        fingerCurl,
        velocity,
        speed: Math.hypot(velocity.x, velocity.y),
        inInteractionZone: inZone,
        landmarks: [],
      });
    }

    this.handTrackingActive = hands.length > 0;
    const calibration: CalibrationData = {
      calibrated: true,
      centerX: 0.5,
      centerY: 0.5,
      minSpan: 0.14,
      maxSpan: 0.48,
      minY: 0.15,
      maxY: 0.85,
      handScale: 0.14,
      timestamp: now,
    };

    return {
      frame: { timestamp: now, hands, source: 'webxr' },
      calibration,
    };
  }

  /**
   * Aligns the pottery wheel & spatial VR UI panel comfortably in front of
   * the seated or standing Meta Quest user.
   */
  public alignStationToHeadset(
    camera: THREE.Camera,
    wheelGroup: THREE.Object3D,
    vrPanel: THREE.Object3D | null
  ): void {
    const headPos = new THREE.Vector3();
    const forward = new THREE.Vector3();
    camera.getWorldPosition(headPos);
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-4) forward.set(0, 0, -1);
    else forward.normalize();

    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const wheelDist = 0.52;
    const wheelYOffset =
      headPos.y > 0.35
        ? THREE.MathUtils.clamp(headPos.y - 1.12, -0.22, 0.32)
        : 0;

    wheelGroup.position.set(
      headPos.x + forward.x * wheelDist,
      wheelYOffset,
      headPos.z + forward.z * wheelDist
    );

    const yaw = Math.atan2(forward.x, forward.z) + Math.PI;
    wheelGroup.rotation.y = yaw;

    if (vrPanel) {
      vrPanel.position.set(
        wheelGroup.position.x - right.x * 0.46 + forward.x * 0.08,
        wheelYOffset + 1.04,
        wheelGroup.position.z - right.z * 0.46 + forward.z * 0.08
      );
      vrPanel.lookAt(headPos.x, vrPanel.position.y, headPos.z);
    }
  }
}
