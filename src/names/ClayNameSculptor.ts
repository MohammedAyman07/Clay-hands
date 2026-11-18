import * as THREE from 'three';
import type {
  ClayNamePlaqueShape,
  ClayNameTool,
  SavedClayNameData,
  ShapingGesture,
} from '../types.ts';
import {
  ClayNameGeometry,
  createInitialClayNameState,
  mapGridToPlaqueXY,
  NAME_DEFAULT_COLS,
  NAME_DEFAULT_ROWS,
  NAME_PLAQUE_HEIGHT,
  NAME_PLAQUE_WIDTH,
  type ClayNameState,
} from './ClayNameGeometry.ts';

const MAX_UNDO_STEPS = 20;

function distToSegment2D(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-10) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

export class ClayNameSculptor {
  public readonly group = new THREE.Group();
  public readonly easelGroup = new THREE.Group();
  public readonly plaquePivot = new THREE.Group();
  public readonly clayGeometry: ClayNameGeometry;
  public readonly state: ClayNameState;
  public readonly wetClayTexture: THREE.Texture;
  public readonly nameMesh: THREE.Mesh;

  // Invisible flat plane collider aligned to plaque XY front for crisp raycasting & hand projection
  public readonly hitPlaneMesh: THREE.Mesh;

  // 3D Sculpting stylus + contact ring hovering over active hand/mouse spot
  public readonly cursorGroup = new THREE.Group();
  private readonly cursorRingMat: THREE.MeshBasicMaterial;
  private readonly cursorTipMat: THREE.MeshStandardMaterial;

  public activeTool: ClayNameTool = 'sculpt_write';
  public brushRadiusNorm = 0.085;

  private undoStack: Array<{
    text: string;
    sculptDeltas: Float32Array;
    letterRelief: number;
    letterBoldness: number;
    plaqueShape: ClayNamePlaqueShape;
  }> = [];
  private isStrokeActive = false;
  private lastStrokeUV: { u: number; v: number } | null = null;

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly _localPt = new THREE.Vector3();

  constructor(maxAnisotropy = 4) {
    this.group.name = 'ClayNameSculptor';
    this.state = createInitialClayNameState(
      'CLAY HANDS',
      'tablet',
      NAME_DEFAULT_COLS,
      NAME_DEFAULT_ROWS
    );
    this.clayGeometry = new ClayNameGeometry(this.state.cols, this.state.rows);
    this.wetClayTexture = this.createWetTerracottaTexture(maxAnisotropy);

    // Position the sculpting board cleanly centered at ergonomic hand height above workbench (y=0.735 bench top)
    this.group.position.set(0, 0.735, 0.04);

    // Build wooden sculptor's easel stand resting flush on workbench y=0
    this.buildEaselStand();
    this.group.add(this.easelGroup);

    // Tilted plaque holder sitting snugly on easel cradle
    this.plaquePivot.position.set(0, 0.19, -0.01);
    this.plaquePivot.rotation.x = -0.34;
    this.group.add(this.plaquePivot);

    const clayMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: this.wetClayTexture,
      roughness: 0.44,
      metalness: 0.02,
      clearcoat: 0.34,
      clearcoatRoughness: 0.28,
    });
    this.materials.push(clayMat);

    this.nameMesh = new THREE.Mesh(this.clayGeometry.geometry, clayMat);
    this.nameMesh.castShadow = true;
    this.nameMesh.receiveShadow = true;
    this.nameMesh.name = 'ClayNamePlaqueMesh';
    this.plaquePivot.add(this.nameMesh);

    const hitGeo = new THREE.PlaneGeometry(
      NAME_PLAQUE_WIDTH * 1.06,
      NAME_PLAQUE_HEIGHT * 1.12
    );
    const hitMat = new THREE.MeshBasicMaterial({
      visible: false,
      side: THREE.DoubleSide,
    });
    this.geometries.push(hitGeo);
    this.materials.push(hitMat);
    this.hitPlaneMesh = new THREE.Mesh(hitGeo, hitMat);
    this.hitPlaneMesh.position.z = 0.022;
    this.plaquePivot.add(this.hitPlaneMesh);

    // Build 3D hand-sculpting wooden modeling tool cursor
    const ringGeo = new THREE.RingGeometry(0.014, 0.021, 28);
    const tipGeo = new THREE.SphereGeometry(0.008, 16, 12);
    const ferruleGeo = new THREE.CylinderGeometry(0.0045, 0.006, 0.024, 14);
    const stemGeo = new THREE.CylinderGeometry(0.0045, 0.007, 0.13, 14);
    this.geometries.push(ringGeo, tipGeo, ferruleGeo, stemGeo);

    this.cursorRingMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    this.cursorTipMat = new THREE.MeshStandardMaterial({
      color: 0xd9a15b,
      roughness: 0.38,
      metalness: 0.2,
    });
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x7b5032,
      roughness: 0.62,
      metalness: 0.04,
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xd0a24b,
      roughness: 0.28,
      metalness: 0.74,
    });
    this.materials.push(
      this.cursorRingMat,
      this.cursorTipMat,
      woodMat,
      brassMat
    );

    const ring = new THREE.Mesh(ringGeo, this.cursorRingMat);
    ring.renderOrder = 25;

    const tip = new THREE.Mesh(tipGeo, this.cursorTipMat);
    tip.position.z = 0.012;

    const ferrule = new THREE.Mesh(ferruleGeo, brassMat);
    ferrule.rotation.x = Math.PI / 2;
    ferrule.position.z = 0.03;

    const stem = new THREE.Mesh(stemGeo, woodMat);
    stem.rotation.x = Math.PI / 2;
    stem.position.z = 0.105;

    this.cursorGroup.add(ring, tip, ferrule, stem);
    this.cursorGroup.visible = false;
    this.plaquePivot.add(this.cursorGroup);

    this.clayGeometry.updateFromState(this.state);
  }

  private buildEaselStand(): void {
    const walnutMat = new THREE.MeshStandardMaterial({
      color: 0x5f3e28,
      roughness: 0.65,
      metalness: 0.04,
    });
    const oakMat = new THREE.MeshStandardMaterial({
      color: 0x8f6644,
      roughness: 0.56,
      metalness: 0.04,
    });
    const feltMat = new THREE.MeshStandardMaterial({
      color: 0x3f593b,
      roughness: 0.94,
      metalness: 0,
    });
    this.materials.push(walnutMat, oakMat, feltMat);

    // Base plinth bar sitting flush at y=0
    const baseGeo = new THREE.BoxGeometry(0.48, 0.024, 0.2);
    this.geometries.push(baseGeo);
    const baseMesh = new THREE.Mesh(baseGeo, walnutMat);
    baseMesh.position.set(0, 0.012, -0.015);
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;

    // Front wooden ledge shelf supporting bottom edge of clay plaque
    const ledgeGeo = new THREE.BoxGeometry(0.46, 0.022, 0.056);
    this.geometries.push(ledgeGeo);
    const ledgeMesh = new THREE.Mesh(ledgeGeo, oakMat);
    ledgeMesh.position.set(0, 0.06, 0.048);
    ledgeMesh.rotation.x = -0.34;
    ledgeMesh.castShadow = true;

    // Soft forest green felt strip on shelf so clay sits securely
    const feltGeo = new THREE.BoxGeometry(0.44, 0.006, 0.044);
    this.geometries.push(feltGeo);
    const feltMesh = new THREE.Mesh(feltGeo, feltMat);
    feltMesh.position.set(0, 0.071, 0.044);
    feltMesh.rotation.x = -0.34;

    // Angled back support rails & brace
    const railGeo = new THREE.CylinderGeometry(0.014, 0.016, 0.34, 14);
    const strutGeo = new THREE.CylinderGeometry(0.011, 0.013, 0.24, 12);
    this.geometries.push(railGeo, strutGeo);

    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(railGeo, walnutMat);
      rail.position.set(side * 0.145, 0.17, -0.02);
      rail.rotation.x = -0.34;
      rail.castShadow = true;
      this.easelGroup.add(rail);

      const strut = new THREE.Mesh(strutGeo, oakMat);
      strut.position.set(side * 0.145, 0.115, -0.085);
      strut.rotation.x = 0.56;
      strut.castShadow = true;
      this.easelGroup.add(strut);
    }

    this.easelGroup.add(baseMesh, ledgeMesh, feltMesh);
  }

  private createWetTerracottaTexture(maxAnisotropy: number): THREE.Texture {
    if (typeof document === 'undefined') {
      const tex = new THREE.DataTexture(
        new Uint8Array([194, 132, 98, 255]),
        1,
        1
      );
      tex.needsUpdate = true;
      return tex;
    }

    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, '#c78563');
      grad.addColorStop(0.5, '#be7a58');
      grad.addColorStop(1, '#ae6b4a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);

      // Subtle mineral grog flecks for tactile ceramic feel
      for (let i = 0; i < 2200; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        ctx.fillStyle =
          Math.random() > 0.45
            ? 'rgba(72, 42, 28, 0.11)'
            : 'rgba(244, 212, 184, 0.12)';
        ctx.fillRect(x, y, 2, 2);
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAnisotropy;
    return tex;
  }

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public get hasCustomSculpt(): boolean {
    for (let i = 0; i < this.state.sculptDeltas.length; i++) {
      if (Math.abs(this.state.sculptDeltas[i]) > 0.0008) return true;
    }
    return false;
  }

  private pushUndoSnapshot(): void {
    this.undoStack.push({
      text: this.state.text,
      sculptDeltas: new Float32Array(this.state.sculptDeltas),
      letterRelief: this.state.letterRelief,
      letterBoldness: this.state.letterBoldness,
      plaqueShape: this.state.plaqueShape,
    });
    if (this.undoStack.length > MAX_UNDO_STEPS) {
      this.undoStack.shift();
    }
  }

  public setNameText(text: string): void {
    const clean = text.slice(0, 16);
    if (clean === this.state.text) return;
    this.state.text = clean;
    this.clayGeometry.updateFromState(this.state);
  }

  public setBlankForHandWrite(): void {
    this.pushUndoSnapshot();
    this.state.text = '';
    this.state.sculptDeltas.fill(0);
    this.setTool('sculpt_write');
    this.clayGeometry.updateFromState(this.state);
  }

  public setPlaqueShape(shape: ClayNamePlaqueShape): void {
    if (shape === this.state.plaqueShape) return;
    this.pushUndoSnapshot();
    this.state.plaqueShape = shape;
    this.clayGeometry.updateFromState(this.state);
  }

  public setLetterRelief(relief: number): void {
    const clamped = THREE.MathUtils.clamp(relief, 0.008, 0.04);
    if (Math.abs(clamped - this.state.letterRelief) < 0.0002) return;
    this.state.letterRelief = clamped;
    this.clayGeometry.updateFromState(this.state);
  }

  public setLetterBoldness(boldness: number): void {
    const clamped = THREE.MathUtils.clamp(boldness, 0.65, 1.55);
    if (Math.abs(clamped - this.state.letterBoldness) < 0.002) return;
    this.state.letterBoldness = clamped;
    this.clayGeometry.updateFromState(this.state);
  }

  public setTool(tool: ClayNameTool): void {
    this.activeTool = tool;
    const toolColors: Record<ClayNameTool, number> = {
      sculpt_write: 0xf6d37b,
      sculpt_puff: 0xffc66e,
      sculpt_carve: 0xf27d59,
      sculpt_smooth: 0x8ad6b4,
      stamp_heart: 0xf46e88,
      paint: 0x70b8ff,
    };
    const col = toolColors[tool];
    this.cursorRingMat.color.setHex(col);
    this.cursorTipMat.color.setHex(col);
  }

  public beginStroke(): void {
    if (this.isStrokeActive) return;
    this.isStrokeActive = true;
    this.lastStrokeUV = null;
    this.pushUndoSnapshot();
  }

  public endStroke(): void {
    this.isStrokeActive = false;
    this.lastStrokeUV = null;
  }

  /**
   * Sculpt clay heightfield at normalized UV coordinates (u in [0..1], v in [0..1] bottom->top).
   * Interpolates strokes continuously between frames so hand-writing names never skips or dots.
   */
  public applyBrushAtUV(
    u: number,
    v: number,
    tool: ClayNameTool = this.activeTool,
    strength = 0.8,
    dt = 1 / 60
  ): boolean {
    if (tool === 'paint') return false;
    const { cols, rows, sculptDeltas } = this.state;

    const prevUV = this.isStrokeActive && this.lastStrokeUV ? this.lastStrokeUV : { u, v };
    const prevX = (prevUV.u - 0.5) * NAME_PLAQUE_WIDTH;
    const prevY = (prevUV.v - 0.5) * NAME_PLAQUE_HEIGHT;
    const targetX = (u - 0.5) * NAME_PLAQUE_WIDTH;
    const targetY = (v - 0.5) * NAME_PLAQUE_HEIGHT;

    const radiusM =
      tool === 'sculpt_write'
        ? Math.max(
            0.013,
            0.021 * (0.72 + 0.28 * this.state.letterBoldness)
          )
        : Math.max(
            0.018,
            this.brushRadiusNorm *
              NAME_PLAQUE_WIDTH *
              (tool === 'stamp_heart' ? 1.15 : 0.72)
          );

    const useSegment =
      tool === 'sculpt_write' ||
      tool === 'sculpt_puff' ||
      tool === 'sculpt_carve';
    const minX = Math.min(prevX, targetX) - radiusM;
    const maxX = Math.max(prevX, targetX) + radiusM;
    const minY = Math.min(prevY, targetY) - radiusM;
    const maxY = Math.max(prevY, targetY) + radiusM;

    const prevDeltas = tool === 'sculpt_smooth' ? new Float32Array(sculptDeltas) : null;
    let modified = false;

    for (let iy = 0; iy < rows; iy++) {
      const vNorm = (iy / (rows - 1)) * 2 - 1;
      for (let ix = 0; ix < cols; ix++) {
        const uNorm = (ix / (cols - 1)) * 2 - 1;
        const idx = iy * cols + ix;
        const { x, y } = mapGridToPlaqueXY(
          uNorm,
          vNorm,
          this.state.plaqueShape,
          NAME_PLAQUE_WIDTH,
          NAME_PLAQUE_HEIGHT
        );

        if (x < minX || x > maxX || y < minY || y > maxY) continue;

        const dx = x - targetX;
        const dy = y - targetY;
        const dist = useSegment
          ? distToSegment2D(x, y, prevX, prevY, targetX, targetY)
          : Math.hypot(dx, dy);
        if (dist > radiusM) continue;

        const ratio = dist / radiusM;
        const falloff = Math.cos(ratio * Math.PI * 0.5);
        const w = falloff * falloff;

        if (tool === 'sculpt_write') {
          const dome = Math.sqrt(Math.max(0, 1 - ratio * ratio));
          const coilPeak =
            Math.max(0.014, this.state.letterRelief * 0.88) *
            THREE.MathUtils.clamp(strength, 0.72, 1.12);
          const targetH = dome * coilPeak;
          if (sculptDeltas[idx] < targetH) {
            // Reach crisp coil height immediately on finger pass so fast writing stays solid
            sculptDeltas[idx] = Math.min(
              0.036,
              THREE.MathUtils.lerp(sculptDeltas[idx], targetH, 0.86)
            );
            modified = true;
          }
        } else if (tool === 'sculpt_puff') {
          sculptDeltas[idx] = THREE.MathUtils.clamp(
            sculptDeltas[idx] + w * strength * 0.036 * dt,
            -0.01,
            0.036
          );
          modified = true;
        } else if (tool === 'sculpt_carve') {
          sculptDeltas[idx] = THREE.MathUtils.clamp(
            sculptDeltas[idx] - w * strength * 0.034 * dt,
            -0.018,
            0.032
          );
          modified = true;
        } else if (tool === 'sculpt_smooth' && prevDeltas) {
          let sum = 0;
          let cnt = 0;
          for (let oy = -1; oy <= 1; oy++) {
            const ny = iy + oy;
            if (ny < 0 || ny >= rows) continue;
            for (let ox = -1; ox <= 1; ox++) {
              const nx = ix + ox;
              if (nx < 0 || nx >= cols) continue;
              sum += prevDeltas[ny * cols + nx];
              cnt++;
            }
          }
          const avg = cnt > 0 ? sum / cnt : prevDeltas[idx];
          const blend = Math.min(0.65, w * strength * 6.5 * dt);
          sculptDeltas[idx] = THREE.MathUtils.lerp(prevDeltas[idx], avg * 0.96, blend);
          modified = true;
        } else if (tool === 'stamp_heart') {
          // Stamp raised parametric 3D heart relief inside radius
          const hx = dx / (radiusM * 0.68);
          const hy = dy / (radiusM * 0.68) - 0.1;
          const sq = hx * hx + (hy - Math.sqrt(Math.abs(hx)) * 0.65) ** 2;
          if (sq < 0.72) {
            const heartBump = Math.sqrt(Math.max(0, 1 - sq / 0.72)) * 0.016;
            sculptDeltas[idx] = Math.max(sculptDeltas[idx], heartBump);
            modified = true;
          }
        }
      }
    }

    if (this.isStrokeActive) {
      this.lastStrokeUV = { u, v };
    }

    if (modified) {
      this.clayGeometry.updateFromState(this.state);
    }
    return modified;
  }

  /**
   * Easy two-hand / whole-hand gesture control over the entire clay name:
   * - widen/open -> bolder, plumper clay letters
   * - compress -> slimmer, crisper clay letters
   * - raise -> deeper/taller 3D letter relief
   * - smooth -> softly polishes hand-sculpted deltas
   */
  public applyMacroGesture(
    gesture: ShapingGesture,
    strength: number,
    dt: number
  ): boolean {
    if (gesture === 'idle' || strength <= 0.05) return false;
    let changed = false;

    if (gesture === 'widen' || gesture === 'open') {
      const next = THREE.MathUtils.clamp(
        this.state.letterBoldness + strength * 0.42 * dt,
        0.65,
        1.55
      );
      if (Math.abs(next - this.state.letterBoldness) > 1e-4) {
        this.state.letterBoldness = next;
        changed = true;
      }
    } else if (gesture === 'compress') {
      const next = THREE.MathUtils.clamp(
        this.state.letterBoldness - strength * 0.42 * dt,
        0.65,
        1.55
      );
      if (Math.abs(next - this.state.letterBoldness) > 1e-4) {
        this.state.letterBoldness = next;
        changed = true;
      }
    } else if (gesture === 'raise') {
      const next = THREE.MathUtils.clamp(
        this.state.letterRelief + strength * 0.018 * dt,
        0.008,
        0.04
      );
      if (Math.abs(next - this.state.letterRelief) > 1e-5) {
        this.state.letterRelief = next;
        changed = true;
      }
    } else if (gesture === 'smooth') {
      const rate = Math.min(0.45, strength * 2.2 * dt);
      for (let i = 0; i < this.state.sculptDeltas.length; i++) {
        if (Math.abs(this.state.sculptDeltas[i]) > 1e-5) {
          this.state.sculptDeltas[i] *= 1 - rate;
          changed = true;
        }
      }
    }

    if (changed) {
      this.clayGeometry.updateFromState(this.state);
    }
    return changed;
  }

  /**
   * Projects a 3D world-space hand tip or intersection point onto plaque UV [0..1]²
   */
  public worldPointToUV(worldPt: THREE.Vector3): { u: number; v: number } {
    this.plaquePivot.updateMatrixWorld();
    this._localPt.copy(worldPt);
    this.plaquePivot.worldToLocal(this._localPt);
    const u = THREE.MathUtils.clamp(
      this._localPt.x / NAME_PLAQUE_WIDTH + 0.5,
      0.02,
      0.98
    );
    const v = THREE.MathUtils.clamp(
      this._localPt.y / NAME_PLAQUE_HEIGHT + 0.5,
      0.04,
      0.96
    );
    return { u, v };
  }

  public showCursorAtUV(
    visible: boolean,
    u = 0.5,
    v = 0.5,
    pinching = false
  ): void {
    this.cursorGroup.visible = visible;
    if (!visible) return;
    const lx = (u - 0.5) * NAME_PLAQUE_WIDTH;
    const ly = (v - 0.5) * NAME_PLAQUE_HEIGHT;
    this.cursorGroup.position.set(
      lx,
      ly,
      0.018 + this.state.letterRelief * 0.8 + (pinching ? -0.005 : 0.014)
    );
    this.cursorGroup.scale.setScalar(pinching ? 0.88 : 1.05);
  }

  public undo(): boolean {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    this.state.text = snap.text;
    this.state.sculptDeltas.set(snap.sculptDeltas);
    this.state.letterRelief = snap.letterRelief;
    this.state.letterBoldness = snap.letterBoldness;
    this.state.plaqueShape = snap.plaqueShape;
    this.clayGeometry.updateFromState(this.state);
    return true;
  }

  public resetSculpt(keepText = true): void {
    this.pushUndoSnapshot();
    if (!keepText) {
      this.state.text = 'CLAY HANDS';
      this.state.plaqueShape = 'tablet';
    }
    this.state.letterRelief = 0.024;
    this.state.letterBoldness = 1.0;
    this.state.sculptDeltas.fill(0);
    this.clayGeometry.updateFromState(this.state);
  }

  public exportSavedNameData(): SavedClayNameData {
    return {
      text: this.state.text.trim().slice(0, 16),
      plaqueShape: this.state.plaqueShape,
      letterRelief: Number(this.state.letterRelief.toFixed(4)),
      letterBoldness: Number(this.state.letterBoldness.toFixed(3)),
      cols: this.state.cols,
      rows: this.state.rows,
      sculptDeltas: Array.from(this.state.sculptDeltas, (v) =>
        Number(v.toFixed(5))
      ),
    };
  }

  public loadSavedNameData(data: SavedClayNameData): void {
    this.state.text = data.text;
    this.state.plaqueShape = data.plaqueShape;
    this.state.letterRelief = data.letterRelief;
    this.state.letterBoldness = data.letterBoldness;
    if (data.sculptDeltas.length === this.state.sculptDeltas.length) {
      this.state.sculptDeltas.set(data.sculptDeltas);
    } else {
      this.state.sculptDeltas.fill(0);
    }
    this.clayGeometry.updateFromState(this.state);
  }

  public dispose(): void {
    this.clayGeometry.dispose();
    this.wetClayTexture.dispose();
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
