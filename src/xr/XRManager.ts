import * as THREE from 'three';
import type * as xb from 'xrblocks';
import type {
  CalibrationData,
  HandTrackingFrame,
  SmoothedHand,
  Vec3,
} from '../types.ts';

import {
  isMetaQuestEnvironment,
  mapControllerToWheelHand,
} from './questEnvironment.ts';

export { isMetaQuestEnvironment };

/**
 * Optional WebXR session & hand-joint bridge.
 * Never makes a headset mandatory; gracefully reports availability.
 */
export class XRManager {
  public vrSupported = false;
  public arSupported = false;
  public inXRSession = false;
  public activeSessionMode: 'immersive-vr' | 'immersive-ar' | null = null;
  public passthroughActive = false;
  public handTrackingActive = false;
  public controllerTrackingActive = false;
  public statusMessage = 'Checking WebXR support…';

  private pendingSessionMode: 'immersive-vr' | 'immersive-ar' | null = null;
  private pendingPassthrough: boolean | null = null;
  private startingSession = false;
  private xbCore: typeof xb.core | null = null;

  public attachXRBlocks(core: typeof xb.core): void {
    this.xbCore = core;
  }

  private async resolveXRCore(): Promise<typeof xb.core | null> {
    if (this.xbCore) return this.xbCore;
    if (typeof window === 'undefined') return null;
    try {
      const mod = await import('xrblocks');
      this.xbCore = mod.core;
      return this.xbCore;
    } catch {
      return null;
    }
  }

  public get inARSession(): boolean {
    return this.inXRSession && this.activeSessionMode === 'immersive-ar';
  }

  public isMetaQuest(): boolean {
    return isMetaQuestEnvironment(
      typeof navigator !== 'undefined' ? navigator.userAgent : '',
      this.inXRSession
    );
  }

  private readonly prevPalmPos = new Map<'left' | 'right', THREE.Vector3>();
  private prevTimestamp = 0;

  private readonly _wrist = new THREE.Vector3();
  private readonly _indexTip = new THREE.Vector3();
  private readonly _thumbTip = new THREE.Vector3();
  private readonly _middleTip = new THREE.Vector3();
  private readonly _ringTip = new THREE.Vector3();
  private readonly _pinkyTip = new THREE.Vector3();
  private readonly _localPos = new THREE.Vector3();
  private readonly _batWrist = new THREE.Vector3();
  private readonly _batIndexMcp = new THREE.Vector3();
  private readonly _batIndexTip = new THREE.Vector3();
  private readonly _batThumbTip = new THREE.Vector3();
  private readonly _prevVRBatPos = new THREE.Vector3();
  private readonly _ctrlQuat = new THREE.Quaternion();
  private readonly _alignHeadPos = new THREE.Vector3();
  private readonly _alignForward = new THREE.Vector3();
  private readonly _alignRight = new THREE.Vector3();
  private readonly _ctrlLocalVec: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly _ctrlWorldTipVec: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly _ctrlVelVec: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly handPool: Record<'left' | 'right', SmoothedHand> = {
    left: XRManager.createPooledHand('left'),
    right: XRManager.createPooledHand('right'),
  };
  private readonly tempHands: SmoothedHand[] = [];
  private readonly tempSeen = new Set<'left' | 'right'>();
  private readonly tempCalibration: CalibrationData = {
    calibrated: true,
    centerX: 0.5,
    centerY: 0.5,
    minSpan: 0.14,
    maxSpan: 0.48,
    minY: 0.15,
    maxY: 0.85,
    handScale: 0.14,
    timestamp: 0,
  };
  private readonly tempFrame: HandTrackingFrame = {
    timestamp: 0,
    hands: [],
    source: 'webxr',
  };
  private readonly tempSampleResult: {
    frame: HandTrackingFrame;
    calibration: CalibrationData;
  };
  private hasPrevVRBatPos = false;
  private vrBatLastTime = 0;

  constructor() {
    this.tempSampleResult = {
      frame: this.tempFrame,
      calibration: this.tempCalibration,
    };
  }

  private static createPooledHand(handedness: 'left' | 'right'): SmoothedHand {
    return {
      handedness,
      confidence: 1,
      palmCenter: { x: 0, y: 0, z: 0 },
      wrist: { x: 0, y: 0, z: 0 },
      thumbTip: { x: 0, y: 0, z: 0 },
      indexTip: { x: 0, y: 0, z: 0 },
      middleTip: { x: 0, y: 0, z: 0 },
      ringTip: { x: 0, y: 0, z: 0 },
      pinkyTip: { x: 0, y: 0, z: 0 },
      pinchDistance: 0.1,
      handSpan: 0.14,
      fingerCurl: 0,
      velocity: { x: 0, y: 0, z: 0 },
      speed: 0,
      inInteractionZone: false,
      landmarks: [],
    };
  }

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

    if (this.vrSupported && this.arSupported) {
      this.statusMessage =
        'WebXR ready: Quest VR Studio & Mixed Reality Passthrough both supported.';
    } else if (this.arSupported) {
      this.statusMessage =
        'WebXR Mixed Reality Passthrough (immersive-ar) supported.';
    } else if (this.vrSupported) {
      this.statusMessage =
        'WebXR supported! You can enter VR or continue with Webcam / Mouse.';
    } else {
      this.statusMessage =
        'No WebXR headset session available. Webcam & Mouse Studio ready.';
    }
  }

  public async startXRSession(
    requestedMode: 'immersive-vr' | 'immersive-ar' = 'immersive-vr'
  ): Promise<boolean> {
    const core = await this.resolveXRCore();
    const manager = core?.webXRSessionManager as unknown as
      | {
          getSessionOptions?: () => XRSessionInit;
          startSession?: () => void;
          onSessionStartedInternal?: (session: XRSession) => Promise<void>;
          waitingForXRSession?: boolean;
        }
      | undefined;

    if (this.inXRSession) {
      try {
        const session = core?.renderer?.xr?.getSession?.();
        await session?.end();
      } catch {
        // Session cleanup runs via onXRSessionEnded
      }
      return false;
    }

    if (!manager || typeof navigator === 'undefined' || !navigator.xr) {
      return false;
    }

    if (requestedMode === 'immersive-ar' && !this.arSupported) {
      this.statusMessage =
        'MR Passthrough is not available on this device. Use Enter VR or Desktop Studio.';
      return false;
    }
    if (requestedMode === 'immersive-vr' && !this.vrSupported) {
      if (this.arSupported) {
        return this.startXRSession('immersive-ar');
      }
      this.statusMessage = 'WebXR VR is not supported in this browser.';
      return false;
    }

    if (this.startingSession || manager.waitingForXRSession) {
      return false;
    }

    this.startingSession = true;
    this.pendingSessionMode = requestedMode;
    this.pendingPassthrough = requestedMode === 'immersive-ar';

    try {
      const sessionOptions = manager.getSessionOptions?.() ?? {
        optionalFeatures: ['local-floor', 'hand-tracking'],
      };

      if (typeof manager.onSessionStartedInternal === 'function') {
        manager.waitingForXRSession = true;
        try {
          const session = await navigator.xr.requestSession(
            requestedMode,
            sessionOptions
          );
          await manager.onSessionStartedInternal(session);
          return true;
        } finally {
          manager.waitingForXRSession = false;
        }
      }

      if (requestedMode === 'immersive-vr') {
        manager.startSession?.();
        return true;
      }

      this.pendingSessionMode = null;
      this.pendingPassthrough = null;
      return false;
    } catch {
      this.pendingSessionMode = null;
      this.pendingPassthrough = null;
      this.statusMessage =
        requestedMode === 'immersive-ar'
          ? 'Could not start MR Passthrough. Continuing in studio — try Enter VR Studio if needed.'
          : 'Could not start WebXR session. Continuing in desktop studio.';
      return false;
    } finally {
      this.startingSession = false;
    }
  }

  public async toggleVRSession(
    requestedMode: 'immersive-vr' | 'immersive-ar' = 'immersive-vr'
  ): Promise<boolean> {
    return this.startXRSession(requestedMode);
  }

  public syncSessionStarted(session?: XRSession): boolean {
    const blend = session?.environmentBlendMode;
    const isAR =
      blend === 'alpha-blend' ||
      blend === 'additive' ||
      this.pendingSessionMode === 'immersive-ar';
    this.inXRSession = true;
    this.activeSessionMode = isAR ? 'immersive-ar' : 'immersive-vr';
    this.passthroughActive = isAR ? (this.pendingPassthrough ?? true) : false;
    this.pendingSessionMode = null;
    this.pendingPassthrough = null;
    return this.passthroughActive;
  }

  public syncSessionEnded(): void {
    this.inXRSession = false;
    this.activeSessionMode = null;
    this.passthroughActive = false;
    this.pendingSessionMode = null;
    this.pendingPassthrough = null;
    this.handTrackingActive = false;
    this.controllerTrackingActive = false;
  }

  public togglePassthroughBackdrop(): boolean {
    if (!this.inARSession) {
      this.passthroughActive = false;
      return false;
    }
    this.passthroughActive = !this.passthroughActive;
    return this.passthroughActive;
  }

  public sampleXRHands(
    now: number,
    clayBaseWorld: THREE.Vector3,
    stationaryWheelInverse: THREE.Matrix4,
    wheelSurfaceY: number,
    clayHeight: number
  ): { frame: HandTrackingFrame; calibration: CalibrationData } | null {
    const input = this.xbCore?.input;
    if (!this.inXRSession || !input) {
      this.handTrackingActive = false;
      this.controllerTrackingActive = false;
      return null;
    }

    const dtSec = this.prevTimestamp
      ? Math.max(0.016, (now - this.prevTimestamp) / 1000)
      : 0.03;
    this.prevTimestamp = now;

    const hands = this.tempHands;
    hands.length = 0;
    const seen = this.tempSeen;
    seen.clear();
    const xrHands = input.hands ?? [];

    for (let i = 0; i < xrHands.length; i++) {
      const handSpace = xrHands[i] as THREE.XRHandSpace & {
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

      // Convert palm midpoint relative to stationary wheel group (offset by bat height)
      this._localPos
        .copy(this._wrist)
        .lerp(this._indexTip, 0.38)
        .applyMatrix4(stationaryWheelInverse);
      this._localPos.y -= wheelSurfaceY;

      const handId: 'left' | 'right' =
        rawHandedness === 'left' || rawHandedness === 'right'
          ? rawHandedness
          : this._localPos.x < 0
            ? 'left'
            : 'right';

      if (seen.has(handId)) continue;
      seen.add(handId);

      const pooled = this.handPool[handId];
      const prev = this.prevPalmPos.get(handId);
      if (prev) {
        pooled.velocity.x = (this._localPos.x - prev.x) / dtSec;
        pooled.velocity.y = (this._localPos.y - prev.y) / dtSec;
        pooled.velocity.z = (this._localPos.z - prev.z) / dtSec;
        prev.copy(this._localPos);
      } else {
        pooled.velocity.x = 0;
        pooled.velocity.y = 0;
        pooled.velocity.z = 0;
        this.prevPalmPos.set(handId, this._localPos.clone());
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
        radialDist < 0.36 &&
        this._localPos.y > -0.09 &&
        this._localPos.y < clayHeight + 0.18;

      // Map 3D wheel-local coordinates into normalized gesture space [0..1]
      const normX = 0.5 + this._localPos.x * 1.45;
      const normY = THREE.MathUtils.clamp(
        1 - this._localPos.y / Math.max(0.18, clayHeight),
        0,
        1
      );

      pooled.confidence = 1;
      pooled.palmCenter.x = normX;
      pooled.palmCenter.y = normY;
      pooled.palmCenter.z = this._localPos.z;
      pooled.wrist.x = normX;
      pooled.wrist.y = normY;
      pooled.wrist.z = this._localPos.z;
      pooled.thumbTip.x = this._thumbTip.x - clayBaseWorld.x;
      pooled.thumbTip.y = this._thumbTip.y - clayBaseWorld.y;
      pooled.thumbTip.z = this._thumbTip.z - clayBaseWorld.z;
      pooled.indexTip.x = this._indexTip.x - clayBaseWorld.x;
      pooled.indexTip.y = this._indexTip.y - clayBaseWorld.y;
      pooled.indexTip.z = this._indexTip.z - clayBaseWorld.z;
      pooled.middleTip.x = this._middleTip.x - clayBaseWorld.x;
      pooled.middleTip.y = this._middleTip.y - clayBaseWorld.y;
      pooled.middleTip.z = this._middleTip.z - clayBaseWorld.z;
      pooled.ringTip.x = this._ringTip.x - clayBaseWorld.x;
      pooled.ringTip.y = this._ringTip.y - clayBaseWorld.y;
      pooled.ringTip.z = this._ringTip.z - clayBaseWorld.z;
      pooled.pinkyTip.x = this._pinkyTip.x - clayBaseWorld.x;
      pooled.pinkyTip.y = this._pinkyTip.y - clayBaseWorld.y;
      pooled.pinkyTip.z = this._pinkyTip.z - clayBaseWorld.z;
      pooled.pinchDistance = pinchDist;
      pooled.handSpan = handSpan;
      pooled.fingerCurl = fingerCurl;
      pooled.speed = Math.hypot(pooled.velocity.x, pooled.velocity.y);
      pooled.inInteractionZone = inZone;

      hands.push(pooled);
    }

    this.handTrackingActive = hands.length > 0;

    // Fallback: synthesize Wheel/Name hand entries from Meta Quest Touch controllers when bare hands aren't active
    if (hands.length === 0 && input.controllers?.length) {
      for (let i = 0; i < input.controllers.length; i++) {
        const ctrl = input.controllers[i] as unknown as THREE.Object3D & {
          userData?: { selected?: boolean; squeezed?: boolean };
          inputSource?: XRInputSource;
        };
        if (!ctrl || ctrl.visible === false) continue;
        ctrl.getWorldPosition(this._indexTip);
        if (this._indexTip.lengthSq() < 1e-6) continue;

        this._localPos
          .copy(this._indexTip)
          .applyMatrix4(stationaryWheelInverse);
        this._localPos.y -= wheelSurfaceY;

        const rawHandedness = ctrl.inputSource?.handedness;
        const handId: 'left' | 'right' =
          rawHandedness === 'left' || rawHandedness === 'right'
            ? rawHandedness
            : this._localPos.x < 0
              ? 'left'
              : 'right';
        if (seen.has(handId)) continue;
        seen.add(handId);

        const prev = this.prevPalmPos.get(handId);
        if (prev) {
          this._ctrlVelVec.x = (this._localPos.x - prev.x) / dtSec;
          this._ctrlVelVec.y = (this._localPos.y - prev.y) / dtSec;
          this._ctrlVelVec.z = (this._localPos.z - prev.z) / dtSec;
          prev.copy(this._localPos);
        } else {
          this._ctrlVelVec.x = 0;
          this._ctrlVelVec.y = 0;
          this._ctrlVelVec.z = 0;
          this.prevPalmPos.set(handId, this._localPos.clone());
        }

        this._ctrlLocalVec.x = this._localPos.x;
        this._ctrlLocalVec.y = this._localPos.y;
        this._ctrlLocalVec.z = this._localPos.z;
        this._ctrlWorldTipVec.x = this._indexTip.x - clayBaseWorld.x;
        this._ctrlWorldTipVec.y = this._indexTip.y - clayBaseWorld.y;
        this._ctrlWorldTipVec.z = this._indexTip.z - clayBaseWorld.z;

        hands.push(
          mapControllerToWheelHand({
            handedness: handId,
            localPos: this._ctrlLocalVec,
            worldRelativeTip: this._ctrlWorldTipVec,
            selected: Boolean(ctrl.userData?.selected),
            squeezed: Boolean(ctrl.userData?.squeezed),
            clayHeight,
            velocity: { ...this._ctrlVelVec },
          })
        );
      }
      this.controllerTrackingActive = hands.length > 0;
    } else {
      this.controllerTrackingActive = false;
    }

    this.tempFrame.timestamp = now;
    this.tempFrame.hands = hands;
    this.tempCalibration.timestamp = now;
    return this.tempSampleResult;
  }

  /**
   * Samples real WebXR world-space controller or tracked hand pose for VR Gallery
   * Bat Smash without mixing wheel-normalized [0..1] coordinates into world space.
   */
  public getPrimaryVRBatPose(
    preferredHand: 'left' | 'right',
    outPos: THREE.Vector3,
    outDir: THREE.Vector3
  ): {
    active: boolean;
    source: 'controller' | 'hand' | 'none';
    pinching: boolean;
    triggerPressed: boolean;
    worldSpeed: number;
  } {
    const input = this.xbCore?.input;
    if (!this.inXRSession || !input) {
      this.hasPrevVRBatPos = false;
      return {
        active: false,
        source: 'none',
        pinching: false,
        triggerPressed: false,
        worldSpeed: 0,
      };
    }

    const now = performance.now();
    const dtSec = this.vrBatLastTime
      ? Math.max(0.012, (now - this.vrBatLastTime) / 1000)
      : 0.03;
    this.vrBatLastTime = now;

    // 1. Prefer an actively gripping/selecting Touch controller, or tracked controller with valid pose
    const controllers = input.controllers ?? [];
    let bestCtrl:
      | (THREE.Object3D & {
          userData?: { selected?: boolean; squeezed?: boolean };
          inputSource?: XRInputSource;
        })
      | null = null;
    for (let i = 0; i < controllers.length; i++) {
      const c = controllers[i] as unknown as THREE.Object3D & {
        userData?: { selected?: boolean; squeezed?: boolean };
        inputSource?: XRInputSource;
      };
      if (!c || c.visible === false) continue;
      c.getWorldPosition(outPos);
      if (outPos.lengthSq() < 1e-6) continue;
      if (c.userData?.selected || c.userData?.squeezed) {
        bestCtrl = c;
        break;
      }
      if (
        !bestCtrl ||
        c.inputSource?.handedness === preferredHand
      ) {
        bestCtrl = c;
      }
    }

    // Check WebXR hand tracking joints in true 3D world space
    const hands = input.hands ?? [];
    let bestHandIdx = -1;
    let bestHandPinch = false;
    for (let i = 0; i < hands.length; i++) {
      const h = hands[i] as THREE.XRHandSpace & { inputSource?: XRInputSource };
      if (!h || !h.visible || !h.joints) continue;
      const wrist = h.joints['wrist'];
      const thumbTip = h.joints['thumb-tip'];
      const indexTip = h.joints['index-finger-tip'];
      if (!wrist?.visible || !thumbTip?.visible || !indexTip?.visible) continue;
      wrist.getWorldPosition(this._batWrist);
      if (this._batWrist.lengthSq() < 1e-6) continue;

      thumbTip.getWorldPosition(this._batThumbTip);
      indexTip.getWorldPosition(this._batIndexTip);
      const pinch = this._batThumbTip.distanceTo(this._batIndexTip) < 0.036;
      const handMatchesPref = h.inputSource?.handedness === preferredHand;

      if (bestHandIdx === -1 || pinch || (handMatchesPref && !bestHandPinch)) {
        bestHandIdx = i;
        bestHandPinch = pinch;
        if (pinch) break;
      }
    }

    let source: 'controller' | 'hand' | 'none' = 'none';
    let pinching = false;
    let triggerPressed = false;

    if (bestHandIdx >= 0 && (!bestCtrl || !bestCtrl.userData?.selected)) {
      // Use real 3D WebXR hand palm center & forward ray
      const h = hands[bestHandIdx] as THREE.XRHandSpace;
      const wrist = h.joints['wrist'];
      const indexTip = h.joints['index-finger-tip'];
      const middleMcp =
        h.joints['middle-finger-metacarpal'] ??
        h.joints['index-finger-metacarpal'];
      if (wrist && indexTip) {
        wrist.getWorldPosition(this._batWrist);
        indexTip.getWorldPosition(this._batIndexTip);
        if (middleMcp?.visible) {
          middleMcp.getWorldPosition(this._batIndexMcp);
          outPos.copy(this._batWrist).lerp(this._batIndexMcp, 0.55);
          outDir.copy(this._batIndexTip).sub(this._batWrist);
        } else {
          outPos.copy(this._batWrist).lerp(this._batIndexTip, 0.42);
          outDir.copy(this._batIndexTip).sub(this._batWrist);
        }
        if (outDir.lengthSq() < 1e-6) outDir.set(0, 0, -1);
        else outDir.normalize();

        source = 'hand';
        pinching = bestHandPinch;
      }
    } else if (bestCtrl) {
      bestCtrl.getWorldPosition(outPos);
      bestCtrl.getWorldQuaternion(this._ctrlQuat);
      outDir.set(0, 0, -1).applyQuaternion(this._ctrlQuat).normalize();
      source = 'controller';
      triggerPressed = Boolean(
        bestCtrl.userData?.selected || bestCtrl.userData?.squeezed
      );
    } else {
      this.hasPrevVRBatPos = false;
      return {
        active: false,
        source: 'none',
        pinching: false,
        triggerPressed: false,
        worldSpeed: 0,
      };
    }

    let worldSpeed = 0;
    if (this.hasPrevVRBatPos) {
      worldSpeed = outPos.distanceTo(this._prevVRBatPos) / dtSec;
    }
    this._prevVRBatPos.copy(outPos);
    this.hasPrevVRBatPos = true;

    return {
      active: true,
      source,
      pinching,
      triggerPressed,
      worldSpeed,
    };
  }

  /**
   * Aligns the active studio station (wheel, kiln, or gallery pedestal) and the
   * spatial VR panel comfortably in front of the Meta Quest headset.
   */
  public alignStationForScreen(
    screen: string,
    camera: THREE.Camera,
    wheelGroup: THREE.Object3D,
    kilnGroup: THREE.Object3D | null,
    galleryGroup: THREE.Object3D | null,
    vrPanel: THREE.Object3D | null,
    nameStationGroup?: THREE.Object3D | null
  ): void {
    const headPos = this._alignHeadPos;
    const forward = this._alignForward;
    camera.getWorldPosition(headPos);
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-4) forward.set(0, 0, -1);
    else forward.normalize();

    const right = this._alignRight.set(-forward.z, 0, forward.x);
    const yaw = Math.atan2(forward.x, forward.z) + Math.PI;
    const yOffset =
      headPos.y > 0.35
        ? THREE.MathUtils.clamp(headPos.y - 1.12, -0.22, 0.32)
        : 0;

    if (screen === 'kiln' && kilnGroup) {
      // Place kiln comfortably in front-right so user watches firing & reveal
      kilnGroup.position.set(
        headPos.x + forward.x * 1.15 + right.x * 0.22,
        yOffset,
        headPos.z + forward.z * 1.15 + right.z * 0.22
      );
      kilnGroup.rotation.y = yaw;
    } else if (screen === 'gallery' && galleryGroup) {
      // Center-right showcase arc within comfortable Quest hand/controller reach without hitting left panel
      galleryGroup.position.set(
        headPos.x + forward.x * 0.88 + right.x * 0.16,
        yOffset,
        headPos.z + forward.z * 0.88 + right.z * 0.16
      );
      galleryGroup.rotation.y = yaw;
    } else if (screen === 'name-studio' && nameStationGroup) {
      nameStationGroup.position.set(
        headPos.x + forward.x * 0.54,
        yOffset,
        headPos.z + forward.z * 0.54
      );
      nameStationGroup.rotation.y = yaw;
      wheelGroup.position.set(
        headPos.x + forward.x * 0.54,
        yOffset,
        headPos.z + forward.z * 0.54
      );
      wheelGroup.rotation.y = yaw;
    } else {
      const wheelDist =
        screen === 'welcome' || screen === 'start-studio' || screen === 'settings'
          ? 0.76
          : 0.54;
      const wheelSide =
        screen === 'welcome' || screen === 'start-studio' || screen === 'settings'
          ? 0.28
          : 0;
      wheelGroup.position.set(
        headPos.x + forward.x * wheelDist + right.x * wheelSide,
        yOffset,
        headPos.z + forward.z * wheelDist + right.z * wheelSide
      );
      wheelGroup.rotation.y = yaw;
    }

    if (vrPanel) {
      const isMenuScreen =
        screen === 'welcome' ||
        screen === 'start-studio' ||
        screen === 'settings';
      const isGallery = screen === 'gallery';
      const isStudioWork =
        screen === 'studio' ||
        screen === 'name-studio' ||
        screen === 'tutorial' ||
        screen === 'glaze';
      const panelDist = isMenuScreen || isGallery ? 0.72 : isStudioWork ? 0.66 : 0.62;
      const panelSide = isMenuScreen
        ? -0.18
        : isGallery
          ? -0.58
          : isStudioWork
            ? -0.56
            : -0.44;
      const panelY =
        headPos.y > 0.35
          ? THREE.MathUtils.clamp(headPos.y - 0.08, 0.85, 1.55)
          : yOffset + 1.06;

      vrPanel.position.set(
        headPos.x + forward.x * panelDist + right.x * panelSide,
        panelY,
        headPos.z + forward.z * panelDist + right.z * panelSide
      );
      vrPanel.lookAt(headPos.x, vrPanel.position.y, headPos.z);
    }
  }

  public alignStationToHeadset(
    camera: THREE.Camera,
    wheelGroup: THREE.Object3D,
    vrPanel: THREE.Object3D | null
  ): void {
    this.alignStationForScreen('studio', camera, wheelGroup, null, null, vrPanel);
  }
}
