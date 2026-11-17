import * as THREE from 'three';
import type {
  ChallengePreset,
  ClayProfileState,
  GestureState,
  PotteryStage,
} from '../types.ts';
import { ClayDeformer } from './ClayDeformer.ts';
import { ClayGeometry, createWetClayTexture } from './ClayGeometry.ts';
import {
  cloneClayProfile,
  createInitialClayProfile,
  DEFAULT_ANGULAR_SEGMENTS,
  DEFAULT_RING_COUNT,
} from './PotteryPresets.ts';

const MAX_UNDO = 30;

export class ClaySculptingController {
  public profile: ClayProfileState;
  public readonly clayGeometry: ClayGeometry;
  public readonly clayMesh: THREE.Mesh;
  public readonly rawClayMaterial: THREE.MeshPhysicalMaterial;
  public readonly silhouetteGroup = new THREE.Group();

  public readonly wetClayTexture: THREE.Texture;
  private silhouetteMesh: THREE.LineSegments | null = null;
  private undoStack: ClayProfileState[] = [];
  private lastUndoSnapshotTime = 0;
  private hasSubstantialEdits = false;
  private strokeActive = false;

  public stage: PotteryStage = 'center';
  public elapsedTime = 0;

  constructor(maxAnisotropy = 4) {
    this.profile = createInitialClayProfile(
      DEFAULT_RING_COUNT,
      DEFAULT_ANGULAR_SEGMENTS
    );
    this.clayGeometry = new ClayGeometry(
      this.profile.ringCount,
      this.profile.angularSegments
    );
    this.wetClayTexture = createWetClayTexture();
    this.wetClayTexture.anisotropy = maxAnisotropy;

    this.rawClayMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xb78464,
      map: this.wetClayTexture,
      roughness: 0.42,
      metalness: 0.02,
      clearcoat: 0.35,
      clearcoatRoughness: 0.28,
    });

    this.clayMesh = new THREE.Mesh(
      this.clayGeometry.geometry,
      this.rawClayMaterial
    );
    this.clayMesh.name = 'SculptableClay';
    this.clayMesh.castShadow = true;
    this.clayMesh.receiveShadow = true;

    this.clayGeometry.updateFromProfile(this.profile, 0);
  }

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public get isSubstantiallyModified(): boolean {
    return this.hasSubstantialEdits || this.undoStack.length > 0;
  }

  public get currentHeight(): number {
    return (
      this.profile.heights[this.profile.ringCount - 1] - this.profile.heights[0]
    );
  }

  public pushUndoSnapshot(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastUndoSnapshotTime < 650) return;
    this.lastUndoSnapshotTime = now;
    this.undoStack.push(cloneClayProfile(this.profile));
    if (this.undoStack.length > MAX_UNDO) {
      this.undoStack.shift();
    }
  }

  public undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.profile = prev;
    this.clayGeometry.updateFromProfile(this.profile, this.elapsedTime);
    this.syncWetnessVisual();
    this.recomputeStage();
    return true;
  }

  public reset(): void {
    this.profile = createInitialClayProfile(
      DEFAULT_RING_COUNT,
      DEFAULT_ANGULAR_SEGMENTS
    );
    this.undoStack = [];
    this.hasSubstantialEdits = false;
    this.stage = 'center';
    this.clayMesh.material = this.rawClayMaterial;
    this.clayGeometry.updateFromProfile(this.profile, 0);
    this.syncWetnessVisual();
  }

  public loadProfile(saved: {
    outerRadii: number[];
    innerRadii: number[];
    heights: number[];
    openDepth: number;
    angularOffsets?: number[];
  }): void {
    const p = createInitialClayProfile(
      saved.outerRadii.length,
      DEFAULT_ANGULAR_SEGMENTS
    );
    p.outerRadii = [...saved.outerRadii];
    p.innerRadii = [...saved.innerRadii];
    p.heights = [...saved.heights];
    p.openDepth = saved.openDepth;
    p.wobble = 0;
    if (saved.angularOffsets && saved.angularOffsets.length === p.angularOffsets.length) {
      p.angularOffsets = [...saved.angularOffsets];
    }
    this.profile = p;
    this.clayGeometry.updateFromProfile(this.profile, 0);
  }

  public setChallengeSilhouette(preset: ChallengePreset | null): void {
    if (this.silhouetteMesh) {
      this.silhouetteGroup.remove(this.silhouetteMesh);
      this.silhouetteMesh.geometry.dispose();
      (this.silhouetteMesh.material as THREE.Material).dispose();
      this.silhouetteMesh = null;
    }
    if (!preset) return;

    const points: THREE.Vector3[] = [];
    const ringCount = preset.targetRadii.length;
    const radialLines = 12;

    // Horizontal rings + vertical guide ribs for crisp non-intrusive silhouette
    for (let i = 0; i < ringCount; i += 3) {
      const y = (i / (ringCount - 1)) * preset.targetHeight;
      const r = preset.targetRadii[i];
      const segs = 36;
      for (let s = 0; s < segs; s++) {
        const a0 = (s / segs) * Math.PI * 2;
        const a1 = ((s + 1) / segs) * Math.PI * 2;
        points.push(
          new THREE.Vector3(Math.cos(a0) * r, y, Math.sin(a0) * r),
          new THREE.Vector3(Math.cos(a1) * r, y, Math.sin(a1) * r)
        );
      }
    }

    for (let s = 0; s < radialLines; s++) {
      const a = (s / radialLines) * Math.PI * 2;
      for (let i = 0; i < ringCount - 1; i++) {
        const y0 = (i / (ringCount - 1)) * preset.targetHeight;
        const y1 = ((i + 1) / (ringCount - 1)) * preset.targetHeight;
        const r0 = preset.targetRadii[i];
        const r1 = preset.targetRadii[i + 1];
        points.push(
          new THREE.Vector3(Math.cos(a) * r0, y0, Math.sin(a) * r0),
          new THREE.Vector3(Math.cos(a) * r1, y1, Math.sin(a) * r1)
        );
      }
    }

    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: 0xffe2a8,
      transparent: true,
      opacity: 0.42,
    });
    this.silhouetteMesh = new THREE.LineSegments(geo, mat);
    this.silhouetteGroup.add(this.silhouetteMesh);
  }

  public applyGesture(gesture: GestureState, dt: number): boolean {
    this.elapsedTime += dt;
    if (this.stage === 'finished' || gesture.gesture === 'idle' || gesture.strength <= 0.02) {
      this.strokeActive = false;
      if (this.profile.wobble > 0.01 && this.stage !== 'finished') {
        this.clayGeometry.updateFromProfile(this.profile, this.elapsedTime);
      }
      return false;
    }

    if (!this.strokeActive) {
      this.pushUndoSnapshot(true);
      this.strokeActive = true;
    } else {
      this.pushUndoSnapshot(false);
    }

    this.hasSubstantialEdits = true;

    const params = {
      heightNorm: gesture.activeHeightNorm,
      strength: gesture.strength,
      dt,
      angle: gesture.activeAngle,
    };

    switch (gesture.gesture) {
      case 'compress':
        if (this.stage === 'center') {
          ClayDeformer.centerClay(this.profile, params);
        } else {
          ClayDeformer.compress(this.profile, params);
        }
        break;
      case 'open':
        ClayDeformer.openClay(this.profile, params);
        break;
      case 'widen':
        ClayDeformer.widen(this.profile, params);
        break;
      case 'raise':
        ClayDeformer.raise(this.profile, params);
        break;
      case 'pinch_neck':
        if (this.stage === 'open' || (this.stage === 'center' && gesture.activeHeightNorm > 0.65)) {
          ClayDeformer.openClay(this.profile, params);
        } else {
          ClayDeformer.pinchNeck(this.profile, params);
        }
        break;
      case 'one_side':
        ClayDeformer.shapeOneSide(this.profile, {
          ...params,
          pushInward: gesture.targetRadiusNorm < 0.5,
        });
        break;
      case 'smooth':
        ClayDeformer.smooth(this.profile, params);
        break;
    }

    this.recomputeStage();
    this.syncWetnessVisual();
    this.clayGeometry.updateFromProfile(this.profile, this.elapsedTime);
    return true;
  }

  public setStage(nextStage: PotteryStage): void {
    this.stage = nextStage;
  }

  public finishPot(): void {
    this.profile.wobble = 0;
    this.stage = 'finished';
    this.clayGeometry.updateFromProfile(this.profile, this.elapsedTime);
  }

  private recomputeStage(): void {
    if (this.stage === 'finished') return;
    if (this.stage === 'center' && this.profile.wobble <= 0.16) {
      this.stage = 'open';
    } else if (this.stage === 'open' && this.profile.openDepth >= 0.72) {
      this.stage = 'shape';
    }
  }

  private syncWetnessVisual(): void {
    // Smoother surface becomes subtly glossier like burnished wet clay
    const smoothness = 1 - this.profile.surfaceRoughness;
    this.rawClayMaterial.roughness = 0.52 - smoothness * 0.22;
    this.rawClayMaterial.clearcoat = 0.25 + smoothness * 0.35;
  }

  public dispose(): void {
    this.clayGeometry.dispose();
    this.rawClayMaterial.dispose();
    this.wetClayTexture.dispose();
    if (this.silhouetteMesh) {
      this.silhouetteMesh.geometry.dispose();
      (this.silhouetteMesh.material as THREE.Material).dispose();
    }
  }
}
