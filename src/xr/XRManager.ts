import * as THREE from 'three';
import * as xb from 'xrblocks';
import type {
  CalibrationData,
  HandTrackingFrame,
  SmoothedHand,
  Vec3,
} from '../types.ts';

import { isMetaQuestEnvironment } from './questEnvironment.ts';

export { isMetaQuestEnvironment };

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
  private hasPrevVRBatPos = false;
  private vrBatLastTime = 0;

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
    clayBaseWorld: THREE.Vector3,
    stationaryWheelInverse: THREE.Matrix4,
    wheelSurfaceY: number,
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

      hands.push({
        handedness: handId,
        confidence: 1,
        palmCenter: { x: normX, y: normY, z: this._localPos.z },
        wrist: { x: normX, y: normY, z: this._localPos.z },
        thumbTip: {
          x: this._thumbTip.x - clayBaseWorld.x,
          y: this._thumbTip.y - clayBaseWorld.y,
          z: this._thumbTip.z - clayBaseWorld.z,
        },
        indexTip: {
          x: this._indexTip.x - clayBaseWorld.x,
          y: this._indexTip.y - clayBaseWorld.y,
          z: this._indexTip.z - clayBaseWorld.z,
        },
        middleTip: {
          x: this._middleTip.x - clayBaseWorld.x,
          y: this._middleTip.y - clayBaseWorld.y,
          z: this._middleTip.z - clayBaseWorld.z,
        },
        ringTip: {
          x: this._ringTip.x - clayBaseWorld.x,
          y: this._ringTip.y - clayBaseWorld.y,
          z: this._ringTip.z - clayBaseWorld.z,
        },
        pinkyTip: {
          x: this._pinkyTip.x - clayBaseWorld.x,
          y: this._pinkyTip.y - clayBaseWorld.y,
          z: this._pinkyTip.z - clayBaseWorld.z,
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
    const input = xb.core?.input;
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
      const panelDist = isMenuScreen ? 0.72 : isGallery ? 0.72 : 0.62;
      const panelSide = isMenuScreen ? -0.18 : isGallery ? -0.58 : -0.44;
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
