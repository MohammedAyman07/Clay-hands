import type { SmoothedHand, Vec3 } from '../types.ts';

/**
 * Pure helper: detects Meta Quest browser (OculusBrowser / Horizon OS) or an active WebXR session.
 */
export function isMetaQuestEnvironment(
  userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  inXRSession = false
): boolean {
  if (inXRSession) return true;
  return /OculusBrowser|Meta Quest|Quest\s*[234]|Quest Pro/i.test(userAgent);
}

/**
 * Pure helper: maps a Meta Quest Touch controller pose in wheel-local space
 * into a unified SmoothedHand representation so throwing, pinching, and painting
 * work seamlessly even when bare hand tracking is off and controllers are held.
 */
export function mapControllerToWheelHand(params: {
  handedness: 'left' | 'right';
  localPos: Vec3;
  worldRelativeTip: Vec3;
  selected: boolean;
  squeezed: boolean;
  clayHeight: number;
  velocity: Vec3;
}): SmoothedHand {
  const {
    handedness,
    localPos,
    worldRelativeTip,
    selected,
    squeezed,
    clayHeight,
    velocity,
  } = params;

  const radialDist = Math.hypot(localPos.x, localPos.z);
  const inZone =
    radialDist < 0.42 &&
    localPos.y > -0.1 &&
    localPos.y < clayHeight + 0.22;

  const normX = 0.5 + localPos.x * 1.45;
  const normY = Math.min(
    1,
    Math.max(0, 1 - localPos.y / Math.max(0.18, clayHeight))
  );

  const handSpan = 0.14;
  const pinchDistance = selected ? 0.022 : 0.095;
  const fingerCurl = squeezed ? 0.85 : 0.25;

  return {
    handedness,
    confidence: 0.96,
    palmCenter: { x: normX, y: normY, z: localPos.z },
    wrist: { x: normX, y: normY + 0.06, z: localPos.z },
    thumbTip: { ...worldRelativeTip },
    indexTip: { ...worldRelativeTip },
    middleTip: { ...worldRelativeTip },
    ringTip: { ...worldRelativeTip },
    pinkyTip: { ...worldRelativeTip },
    pinchDistance,
    handSpan,
    fingerCurl,
    velocity,
    speed: Math.hypot(velocity.x, velocity.y),
    inInteractionZone: inZone,
    landmarks: [],
  };
}

