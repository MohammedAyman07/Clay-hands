import * as THREE from 'three';
import type { BrushColorDefinition, BrushSizePreset } from '../types.ts';

export const VILLAGE_PIGMENTS: BrushColorDefinition[] = [
  { id: 'indigo', name: 'Village Indigo', hex: '#244b74' },
  { id: 'crimson', name: 'Kiln Ochre Red', hex: '#a63a2b' },
  { id: 'sage', name: 'Meadow Sage', hex: '#4a6b44' },
  { id: 'gold', name: 'Harvest Gold', hex: '#d39234' },
  { id: 'charcoal', name: 'Hearth Charcoal', hex: '#241e1a' },
  { id: 'chalk', name: 'Limestone Chalk', hex: '#f4ede0' },
  { id: 'plum', name: 'Mulberry Slip', hex: '#6c3758' },
  { id: 'teal', name: 'River Celadon', hex: '#2c7572' },
];

export const BRUSH_SIZE_PX: Record<BrushSizePreset, number> = {
  fine: 7,
  medium: 15,
  broad: 28,
};

export interface UVPoint {
  u: number;
  v: number;
}

/**
 * Pure helper: computes intermediate UV sample points between two UVs,
 * automatically taking the shortest wrapped path across the horizontal u=0/1 seam.
 */
export function interpolateWrappedUVStroke(
  from: UVPoint,
  to: UVPoint,
  canvasSize = 512,
  stepPx = 3
): UVPoint[] {
  let du = to.u - from.u;
  if (du > 0.5) du -= 1;
  if (du < -0.5) du += 1;
  const dv = to.v - from.v;

  const distPx = Math.hypot(du * canvasSize, dv * canvasSize);
  const steps = Math.max(1, Math.ceil(distPx / Math.max(1, stepPx)));
  const points: UVPoint[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let u = (from.u + du * t) % 1;
    if (u < 0) u += 1;
    const v = Math.min(1, Math.max(0, from.v + dv * t));
    points.push({ u, v });
  }
  return points;
}

/**
 * Manages the user's hand-painted brush layer on a pottery vessel,
 * composited cleanly over either raw wet clay or any fired glaze texture.
 */
export class VesselPainter {
  public readonly size = 512;
  public readonly compositeTexture: THREE.Texture;

  private readonly paintCanvas: HTMLCanvasElement | null = null;
  private readonly paintCtx: CanvasRenderingContext2D | null = null;
  private readonly compositeCanvas: HTMLCanvasElement | null = null;
  private readonly compositeCtx: CanvasRenderingContext2D | null = null;

  private undoStack: ImageData[] = [];
  private readonly maxUndo = 20;
  private lastUV: UVPoint | null = null;
  private lastBaseTexture: THREE.Texture | null = null;
  private recompositeDirty = false;
  private lastRecompositeMs = 0;
  private paintLoadSeq = 0;

  private cachedHex = '';
  private rgbaInner = 'rgba(36,75,116,0.94)';
  private rgbaMid = 'rgba(36,75,116,0.78)';
  private rgbaOuter = 'rgba(36,75,116,0)';
  private readonly _lookTarget = new THREE.Vector3();

  public activeColorId: string = VILLAGE_PIGMENTS[0].id;
  public activeSize: BrushSizePreset = 'medium';
  public eraserMode = false;
  public hasPaint = false;

  // 3D rustic wooden brush visual cursor
  public readonly cursorGroup = new THREE.Group();
  private readonly tipMat: THREE.MeshStandardMaterial;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly cursorGeos: THREE.BufferGeometry[] = [];
  private readonly cursorMats: THREE.Material[] = [];

  constructor(maxAnisotropy = 4) {
    if (typeof document !== 'undefined') {
      this.paintCanvas = document.createElement('canvas');
      this.paintCanvas.width = this.size;
      this.paintCanvas.height = this.size;
      this.paintCtx = this.paintCanvas.getContext('2d', {
        willReadFrequently: true,
      });

      this.compositeCanvas = document.createElement('canvas');
      this.compositeCanvas.width = this.size;
      this.compositeCanvas.height = this.size;
      this.compositeCtx = this.compositeCanvas.getContext('2d');

      const tex = new THREE.CanvasTexture(this.compositeCanvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = maxAnisotropy;
      this.compositeTexture = tex;
    } else {
      const tex = new THREE.DataTexture(
        new Uint8Array([168, 124, 96, 255]),
        1,
        1
      );
      tex.needsUpdate = true;
      this.compositeTexture = tex;
    }

    // Build 3D wooden craft brush cursor
    this.cursorGroup.name = 'PaintBrushCursor';
    this.cursorGroup.visible = false;

    const handleGeo = new THREE.CylinderGeometry(0.004, 0.0065, 0.14, 12);
    const ferruleGeo = new THREE.CylinderGeometry(0.0065, 0.0055, 0.024, 12);
    const tipGeo = new THREE.ConeGeometry(0.006, 0.026, 12);
    const ringGeo = new THREE.RingGeometry(0.008, 0.0115, 24);
    this.cursorGeos.push(handleGeo, ferruleGeo, tipGeo, ringGeo);

    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x8f5d38,
      roughness: 0.65,
      metalness: 0.04,
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xc29b4e,
      roughness: 0.35,
      metalness: 0.72,
    });
    this.tipMat = new THREE.MeshStandardMaterial({
      color: VILLAGE_PIGMENTS[0].hex,
      roughness: 0.45,
      metalness: 0.05,
    });
    this.ringMat = new THREE.MeshBasicMaterial({
      color: VILLAGE_PIGMENTS[0].hex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
      depthTest: false,
    });
    this.cursorMats.push(woodMat, brassMat, this.tipMat, this.ringMat);

    // Orient brush along +Z pointing toward -Z tip at origin (0,0,0)
    const tip = new THREE.Mesh(tipGeo, this.tipMat);
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = 0.013;

    const ferrule = new THREE.Mesh(ferruleGeo, brassMat);
    ferrule.rotation.x = Math.PI / 2;
    ferrule.position.z = 0.038;

    const handle = new THREE.Mesh(handleGeo, woodMat);
    handle.rotation.x = Math.PI / 2;
    handle.position.z = 0.12;

    const aimRing = new THREE.Mesh(ringGeo, this.ringMat);
    aimRing.position.z = 0.002;
    aimRing.renderOrder = 20;

    this.cursorGroup.add(tip, ferrule, handle, aimRing);
  }

  public get activeColor(): BrushColorDefinition {
    return (
      VILLAGE_PIGMENTS.find((c) => c.id === this.activeColorId) ??
      VILLAGE_PIGMENTS[0]
    );
  }

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public setColor(colorId: string): void {
    this.activeColorId = colorId;
    this.eraserMode = false;
    this.syncCursorAppearance();
  }

  public setSize(size: BrushSizePreset): void {
    this.activeSize = size;
    this.syncCursorAppearance();
  }

  public setEraser(enabled: boolean): void {
    this.eraserMode = enabled;
    this.syncCursorAppearance();
  }

  private isPinchPreview = false;

  public setPinchPreview(pinching: boolean): void {
    if (this.isPinchPreview === pinching) return;
    this.isPinchPreview = pinching;
    this.syncCursorAppearance();
  }

  private syncCursorAppearance(): void {
    const col = this.eraserMode ? '#e6d8c3' : this.activeColor.hex;
    this.tipMat.color.set(col);
    this.ringMat.color.set(col);
    this.ringMat.opacity = this.isPinchPreview ? 0.98 : 0.62;
    const baseScale =
      this.activeSize === 'fine'
        ? 0.72
        : this.activeSize === 'broad'
          ? 1.55
          : 1.05;
    this.cursorGroup.scale.setScalar(
      this.isPinchPreview ? baseScale * 0.92 : baseScale
    );
  }

  public updateCursorPose(
    worldPoint: THREE.Vector3 | null,
    worldNormal: THREE.Vector3 | null
  ): void {
    if (!worldPoint || !worldNormal) {
      this.cursorGroup.visible = false;
      return;
    }
    this.cursorGroup.visible = true;
    const offset = this.isPinchPreview ? 0.001 : 0.008;
    this.cursorGroup.position
      .copy(worldPoint)
      .addScaledVector(worldNormal, offset);
    this._lookTarget.copy(worldPoint).add(worldNormal);
    this.cursorGroup.lookAt(this._lookTarget);
  }

  public beginStroke(uv: UVPoint): void {
    this.pushUndoSnapshot();
    this.lastUV = { u: uv.u, v: uv.v };
    this.dabAtUV(uv);
    this.recomposite();
  }

  public continueStroke(uv: UVPoint): void {
    if (!this.lastUV) {
      this.beginStroke(uv);
      return;
    }
    const pts = interpolateWrappedUVStroke(
      this.lastUV,
      uv,
      this.size,
      Math.max(2, BRUSH_SIZE_PX[this.activeSize] * 0.28)
    );
    for (const pt of pts) {
      this.dabAtUV(pt);
    }
    this.lastUV = { u: uv.u, v: uv.v };
    this.recompositeDirty = true;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (now - this.lastRecompositeMs >= 22) {
      this.recomposite();
    }
  }

  public endStroke(): void {
    this.lastUV = null;
    if (this.recompositeDirty) {
      this.recomposite();
    }
  }

  private pushUndoSnapshot(): void {
    if (!this.paintCtx) return;
    const snap = this.paintCtx.getImageData(0, 0, this.size, this.size);
    this.undoStack.push(snap);
    if (this.undoStack.length > this.maxUndo) {
      this.undoStack.shift();
    }
  }

  private ensureCachedPigment(): void {
    const hex = this.activeColor.hex;
    if (this.cachedHex === hex) return;
    this.cachedHex = hex;
    const c = new THREE.Color(hex);
    const r = Math.round(c.r * 255);
    const g = Math.round(c.g * 255);
    const b = Math.round(c.b * 255);
    this.rgbaInner = `rgba(${r},${g},${b},0.94)`;
    this.rgbaMid = `rgba(${r},${g},${b},0.78)`;
    this.rgbaOuter = `rgba(${r},${g},${b},0)`;
  }

  private dabAtUV(uv: UVPoint): void {
    if (!this.paintCtx) return;
    const ctx = this.paintCtx;
    const x = (((uv.u % 1) + 1) % 1) * this.size;
    // Flip V to match Three.js CanvasTexture default flipY = true
    const y = (1 - Math.min(1, Math.max(0, uv.v))) * this.size;
    const radius = BRUSH_SIZE_PX[this.activeSize];
    if (!this.eraserMode) {
      this.ensureCachedPigment();
    }

    ctx.save();
    if (this.eraserMode) {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      this.hasPaint = true;
    }

    // Stamp at x, x-size, x+size so strokes wrap cleanly across the UV seam
    for (const ox of [x, x - this.size, x + this.size]) {
      if (ox + radius < 0 || ox - radius > this.size) continue;
      const grad = ctx.createRadialGradient(ox, y, radius * 0.25, ox, y, radius);
      if (this.eraserMode) {
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(0.7, 'rgba(0,0,0,0.8)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
      } else {
        grad.addColorStop(0, this.rgbaInner);
        grad.addColorStop(0.72, this.rgbaMid);
        grad.addColorStop(1, this.rgbaOuter);
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ox, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  public undo(): boolean {
    if (!this.paintCtx || this.undoStack.length === 0) return false;
    const snap = this.undoStack.pop()!;
    this.paintCtx.putImageData(snap, 0, 0);
    this.hasPaint = this.detectAnyPaint();
    this.recomposite();
    return true;
  }

  public clear(saveUndo = false): void {
    if (!this.paintCtx) {
      this.hasPaint = false;
      return;
    }
    if (saveUndo && this.hasPaint) {
      this.pushUndoSnapshot();
    } else if (!saveUndo) {
      this.undoStack = [];
    }
    this.paintCtx.clearRect(0, 0, this.size, this.size);
    this.hasPaint = false;
    this.lastUV = null;
    this.recomposite();
  }

  private detectAnyPaint(): boolean {
    if (!this.paintCtx) return false;
    const data = this.paintCtx.getImageData(0, 0, this.size, this.size).data;
    for (let i = 3; i < data.length; i += 16) {
      if (data[i] > 8) return true;
    }
    return false;
  }

  public setBaseTexture(baseTexture: THREE.Texture): void {
    this.lastBaseTexture = baseTexture;
    this.recomposite();
  }

  public recomposite(): void {
    if (!this.compositeCtx) return;
    this.recompositeDirty = false;
    this.lastRecompositeMs =
      typeof performance !== 'undefined' ? performance.now() : 0;
    const ctx = this.compositeCtx;
    ctx.clearRect(0, 0, this.size, this.size);

    const img = this.lastBaseTexture?.image as
      | HTMLCanvasElement
      | HTMLImageElement
      | ImageBitmap
      | undefined;

    if (img) {
      ctx.drawImage(img, 0, 0, this.size, this.size);
    } else {
      ctx.fillStyle = '#b78464';
      ctx.fillRect(0, 0, this.size, this.size);
    }

    if (this.paintCanvas && this.hasPaint) {
      ctx.drawImage(this.paintCanvas, 0, 0, this.size, this.size);
    }

    this.compositeTexture.needsUpdate = true;
  }

  public exportPaintDataUrl(): string | undefined {
    if (!this.paintCanvas || !this.hasPaint) return undefined;
    // Downscale to 256x256 PNG for compact localStorage persistence
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = 256;
    exportCanvas.height = 256;
    const ectx = exportCanvas.getContext('2d');
    if (!ectx) return undefined;
    ectx.drawImage(this.paintCanvas, 0, 0, 256, 256);
    return exportCanvas.toDataURL('image/png');
  }

  public loadPaintDataUrl(dataUrl?: string): void {
    const loadId = ++this.paintLoadSeq;
    this.clear(false);
    if (!dataUrl || !this.paintCtx || typeof Image === 'undefined') return;
    const ctx = this.paintCtx;
    const img = new Image();
    img.onload = () => {
      if (loadId !== this.paintLoadSeq) return;
      ctx.clearRect(0, 0, this.size, this.size);
      ctx.drawImage(img, 0, 0, this.size, this.size);
      this.hasPaint = this.detectAnyPaint();
      this.recomposite();
    };
    img.src = dataUrl;
  }

  public dispose(): void {
    this.compositeTexture.dispose();
    this.cursorGeos.forEach((g) => g.dispose());
    this.cursorMats.forEach((m) => m.dispose());
  }
}
