import * as THREE from 'three';
import type {
  CalibrationData,
  GestureState,
  SmoothedHand,
} from '../types.ts';

/**
 * Pure coordinate mapping helper from normalized webcam coordinates to 3D wheel space.
 */
export function mapWebcamToWheelSpace(
  normX: number,
  normY: number,
  calibration: CalibrationData,
  clayHeight: number
): THREE.Vector3 {
  const halfSpan = Math.max(0.18, calibration.maxSpan * 0.55);
  const relX = (normX - calibration.centerX) / halfSpan;
  const x = THREE.MathUtils.clamp(relX * 0.24, -0.32, 0.32);

  const ySpan = Math.max(0.15, calibration.maxY - calibration.minY);
  const heightNorm = THREE.MathUtils.clamp(
    1 - (normY - calibration.minY) / ySpan,
    0,
    1.15
  );
  const y = heightNorm * Math.max(0.16, clayHeight);
  const z = 0.04;
  return new THREE.Vector3(x, y, z);
}

/**
 * Visualizes tracked hands (left/right palm + fingertips) and an active
 * horizontal shaping ring around the clay vessel.
 */
export class HandInputMapper {
  public readonly group = new THREE.Group();

  private readonly leftCursor: THREE.Group;
  private readonly rightCursor: THREE.Group;
  private readonly activeRing: THREE.Mesh;
  private readonly activeRingMat: THREE.MeshBasicMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  private readonly _targetPos = new THREE.Vector3();

  constructor() {
    this.group.name = 'HandCursors';

    const palmGeo = new THREE.SphereGeometry(0.022, 16, 12);
    const tipGeo = new THREE.SphereGeometry(0.011, 12, 10);
    const ringGeo = new THREE.TorusGeometry(0.11, 0.0025, 8, 48);
    this.geometries.push(palmGeo, tipGeo, ringGeo);

    const leftMat = new THREE.MeshStandardMaterial({
      color: 0xf4c28c,
      emissive: 0xd97d3a,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.86,
      roughness: 0.35,
    });
    const rightMat = new THREE.MeshStandardMaterial({
      color: 0xf4c28c,
      emissive: 0xd97d3a,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.86,
      roughness: 0.35,
    });
    const tipMat = new THREE.MeshStandardMaterial({
      color: 0xfff0db,
      emissive: 0xffb668,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.9,
      roughness: 0.3,
    });
    this.activeRingMat = new THREE.MeshBasicMaterial({
      color: 0xffd599,
      transparent: true,
      opacity: 0,
    });
    this.materials.push(leftMat, rightMat, tipMat, this.activeRingMat);

    this.leftCursor = this.buildHandCursor(palmGeo, tipGeo, leftMat, tipMat);
    this.rightCursor = this.buildHandCursor(palmGeo, tipGeo, rightMat, tipMat);
    this.leftCursor.visible = false;
    this.rightCursor.visible = false;

    this.activeRing = new THREE.Mesh(ringGeo, this.activeRingMat);
    this.activeRing.rotation.x = Math.PI / 2;
    this.activeRing.visible = false;

    this.group.add(this.leftCursor, this.rightCursor, this.activeRing);
  }

  private buildHandCursor(
    palmGeo: THREE.BufferGeometry,
    tipGeo: THREE.BufferGeometry,
    palmMat: THREE.Material,
    tipMat: THREE.Material
  ): THREE.Group {
    const g = new THREE.Group();
    const palm = new THREE.Mesh(palmGeo, palmMat);
    palm.scale.set(1.1, 1.35, 0.65);

    const thumb = new THREE.Mesh(tipGeo, tipMat);
    thumb.name = 'thumb';
    thumb.position.set(0.025, 0.02, 0.01);

    const index = new THREE.Mesh(tipGeo, tipMat);
    index.name = 'index';
    index.position.set(0.012, 0.042, 0.01);

    g.add(palm, thumb, index);
    return g;
  }

  public updateVisuals(
    hands: SmoothedHand[],
    calibration: CalibrationData,
    gesture: GestureState,
    clayHeight: number,
    activeClayRadiusAtHeight: number,
    isWebXR: boolean,
    dt: number
  ): void {
    const left = hands.find((h) => h.handedness === 'left');
    const right = hands.find((h) => h.handedness === 'right');

    const updateCursor = (
      cursor: THREE.Group,
      hand: SmoothedHand | undefined
    ) => {
      if (!hand || isWebXR) {
        cursor.visible = false;
        return;
      }
      cursor.visible = true;
      this._targetPos.copy(
        mapWebcamToWheelSpace(
          hand.palmCenter.x,
          hand.palmCenter.y,
          calibration,
          clayHeight
        )
      );
      const alpha = 1 - Math.exp(-18 * dt);
      cursor.position.lerp(this._targetPos, alpha);

      const scaleBoost = gesture.isPinching ? 0.85 : 1;
      cursor.scale.setScalar(scaleBoost);
    };

    updateCursor(this.leftCursor, left);
    updateCursor(this.rightCursor, right);

    if (gesture.inZone && gesture.gesture !== 'idle') {
      this.activeRing.visible = true;
      this.activeRing.position.y = gesture.activeHeightNorm * clayHeight;
      const targetR = Math.max(0.028, activeClayRadiusAtHeight + 0.008);
      const scale = targetR / 0.11;
      this.activeRing.scale.set(scale, scale, 1);
      this.activeRingMat.opacity = 0.25 + gesture.strength * 0.45;
      this.activeRingMat.color.setHex(
        gesture.gesture === 'pinch_neck'
          ? 0xff9e66
          : gesture.gesture === 'widen'
            ? 0x9fe0c0
            : 0xffd599
      );
    } else {
      this.activeRing.visible = false;
    }
  }

  public showMouseBrushIndicator(
    active: boolean,
    heightNorm: number,
    clayHeight: number,
    radiusAtHeight: number
  ): void {
    this.leftCursor.visible = false;
    this.rightCursor.visible = false;
    if (!active) {
      this.activeRing.visible = false;
      return;
    }
    this.activeRing.visible = true;
    this.activeRing.position.y = heightNorm * clayHeight;
    const scale = Math.max(0.028, radiusAtHeight + 0.008) / 0.11;
    this.activeRing.scale.set(scale, scale, 1);
    this.activeRingMat.opacity = 0.65;
    this.activeRingMat.color.setHex(0xffd599);
  }

  public dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
