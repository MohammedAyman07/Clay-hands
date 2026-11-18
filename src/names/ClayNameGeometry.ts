import * as THREE from 'three';
import type { ClayNamePlaqueShape } from '../types.ts';

export interface ClayNameState {
  text: string;
  plaqueShape: ClayNamePlaqueShape;
  letterRelief: number; // 0.008..0.036 m
  letterBoldness: number; // 0.65..1.55 multiplier
  cols: number;
  rows: number;
  sculptDeltas: Float32Array;
}

export const NAME_PLAQUE_WIDTH = 0.56;
export const NAME_PLAQUE_HEIGHT = 0.27;
export const NAME_DEFAULT_COLS = 136;
export const NAME_DEFAULT_ROWS = 64;

// Minimal crisp 5x7 uppercase bitmap glyphs used as deterministic fallback in Node/headless environments
const BITMAP_FONT_5X7: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10011', '10101', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['10010', '10010', '10010', '11111', '00010', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['01110', '10000', '11110', '10001', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '♥': ['01010', '11111', '11111', '01110', '00100', '00000', '00000'],
};

/**
 * Pure helper: computes a 2D letter coverage mask [0..1] for any user text string.
 * Uses smooth anti-aliased HTML5 Canvas typography in browser environments, and
 * falls back cleanly to crisp 5x7 glyphs in headless Node tests.
 */
export function generateLetterMask(
  rawText: string,
  width: number,
  height: number
): Float32Array {
  const text = rawText.trim().slice(0, 16);
  const mask = new Float32Array(width * height);
  if (!text) {
    return mask;
  }

  if (typeof document !== 'undefined') {
    const scale = 2;
    const cw = width * scale;
    const ch = height * scale;
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, cw, ch);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      let fontSize = Math.floor(ch * 0.56);
      const maxTextW = cw * 0.8;
      while (fontSize > 16) {
        ctx.font = `900 ${fontSize}px "Fraunces", "Georgia", "Arial Black", sans-serif`;
        if (ctx.measureText(text).width <= maxTextW) break;
        fontSize -= 2;
      }

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, fontSize * 0.08);
      ctx.strokeText(text, cw * 0.5, ch * 0.51);
      ctx.fillText(text, cw * 0.5, ch * 0.51);

      const img = ctx.getImageData(0, 0, cw, ch).data;
      for (let y = 0; y < height; y++) {
        const sy = Math.min(ch - 1, Math.floor(y * scale));
        for (let x = 0; x < width; x++) {
          const sx = Math.min(cw - 1, Math.floor(x * scale));
          // Downsample average 2x2 block for silky anti-aliased gradient
          let sum = 0;
          for (let oy = 0; oy < scale; oy++) {
            const yy = Math.min(ch - 1, sy + oy);
            for (let ox = 0; ox < scale; ox++) {
              const xx = Math.min(cw - 1, sx + ox);
              sum += img[(yy * cw + xx) * 4 + 3] / 255;
            }
          }
          mask[y * width + x] = sum / (scale * scale);
        }
      }
      return mask;
    }
  }

  // Headless bitmap fallback
  const chars = text.toUpperCase().split('');
  const glyphW = 5;
  const glyphH = 7;
  const gap = 1;
  const totalUnitsW = Math.max(1, chars.length * glyphW + (chars.length - 1) * gap);
  const availW = width * 0.78;
  const availH = height * 0.52;
  const cellSize = Math.max(1, Math.min(availW / totalUnitsW, availH / glyphH));
  const startX = (width - totalUnitsW * cellSize) * 0.5;
  const startY = (height - glyphH * cellSize) * 0.5;

  for (let cIdx = 0; cIdx < chars.length; cIdx++) {
    const ch = chars[cIdx];
    const glyph = BITMAP_FONT_5X7[ch] ?? BITMAP_FONT_5X7['-'];
    const gx0 = startX + cIdx * (glyphW + gap) * cellSize;
    for (let gy = 0; gy < glyphH; gy++) {
      const rowStr = glyph[gy];
      for (let gx = 0; gx < glyphW; gx++) {
        if (rowStr[gx] !== '1') continue;
        const px0 = Math.max(0, Math.floor(gx0 + gx * cellSize));
        const px1 = Math.min(width - 1, Math.ceil(gx0 + (gx + 1) * cellSize));
        const py0 = Math.max(0, Math.floor(startY + gy * cellSize));
        const py1 = Math.min(height - 1, Math.ceil(startY + (gy + 1) * cellSize));
        for (let py = py0; py <= py1; py++) {
          for (let px = px0; px <= px1; px++) {
            mask[py * width + px] = 1;
          }
        }
      }
    }
  }

  return mask;
}

/**
 * Pure O(W * H) signed Chamfer distance transform computing smooth Euclidean-like
 * distance INSIDE (positive) and OUTSIDE (negative) binary glyph strokes so 3D clay
 * letters form plump rounded clay coils instead of stair-stepped blocks.
 */
export function computeSignedDistanceField(
  mask: Float32Array,
  width: number,
  height: number
): Float32Array {
  const n = width * height;
  const INF = 1e6;
  const distIn = new Float32Array(n);
  const distOut = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const inside = mask[i] >= 0.42;
    distIn[i] = inside ? INF : 0;
    distOut[i] = inside ? 0 : INF;
  }

  const pass = (arr: Float32Array) => {
    const d1 = 1;
    const d2 = Math.SQRT2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        let v = arr[idx];
        if (x > 0) v = Math.min(v, arr[idx - 1] + d1);
        if (y > 0) {
          v = Math.min(v, arr[idx - width] + d1);
          if (x > 0) v = Math.min(v, arr[idx - width - 1] + d2);
          if (x < width - 1) v = Math.min(v, arr[idx - width + 1] + d2);
        }
        arr[idx] = v;
      }
    }
    for (let y = height - 1; y >= 0; y--) {
      for (let x = width - 1; x >= 0; x--) {
        const idx = y * width + x;
        let v = arr[idx];
        if (x < width - 1) v = Math.min(v, arr[idx + 1] + d1);
        if (y < height - 1) {
          v = Math.min(v, arr[idx + width] + d1);
          if (x < width - 1) v = Math.min(v, arr[idx + width + 1] + d2);
          if (x > 0) v = Math.min(v, arr[idx + width - 1] + d2);
        }
        arr[idx] = v;
      }
    }
  };

  pass(distIn);
  pass(distOut);

  const sdf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Subpixel feather from mask alpha near boundary for extra smoothness
    sdf[i] =
      distIn[i] > 0
        ? distIn[i] + (mask[i] - 0.5) * 0.35
        : -distOut[i] + (mask[i] - 0.42) * 0.35;
  }
  return sdf;
}

/**
 * Pure helper mapping rectangular normalized grid (uNorm, vNorm in [-1, 1]) onto
 * physical XY coordinates shaped to the chosen clay plaque silhouette.
 */
export function mapGridToPlaqueXY(
  uNorm: number,
  vNorm: number,
  shape: ClayNamePlaqueShape,
  width = NAME_PLAQUE_WIDTH,
  height = NAME_PLAQUE_HEIGHT
): { x: number; y: number; edgeFactor: number } {
  const halfW = width * 0.5;
  const halfH = height * 0.5;
  const boxD = Math.max(Math.abs(uNorm), Math.abs(vNorm));

  if (boxD < 1e-6) {
    return { x: 0, y: 0, edgeFactor: 0 };
  }

  const dx = uNorm / boxD;
  const dy = vNorm / boxD;

  if (shape === 'tablet') {
    // Smooth rounded rectangular clay plaque via superellipse exponent 5
    const normR = Math.pow(
      Math.pow(Math.abs(dx), 5) + Math.pow(Math.abs(dy), 5),
      1 / 5
    );
    const scale = 1 / Math.max(1, normR);
    return {
      x: uNorm * scale * halfW,
      y: vNorm * scale * halfH,
      edgeFactor: boxD,
    };
  }

  if (shape === 'oval') {
    const normR = Math.hypot(dx, dy);
    const scale = 1 / Math.max(1, normR);
    return {
      x: uNorm * scale * halfW,
      y: vNorm * scale * halfH * 1.06,
      edgeFactor: boxD,
    };
  }

  if (shape === 'ribbon') {
    const normR = Math.pow(
      Math.pow(Math.abs(dx), 6) + Math.pow(Math.abs(dy), 6),
      1 / 6
    );
    const scale = 1 / Math.max(1, normR);
    const xRaw = uNorm * scale;
    const yRaw = vNorm * scale;
    // Gentle curved banner undulation & flared side wings
    const waveY = Math.cos(xRaw * Math.PI * 1.4) * 0.08 * (1 - boxD * 0.25);
    const pinchH = 0.86 + 0.18 * Math.pow(Math.abs(xRaw), 1.4);
    return {
      x: xRaw * halfW * 1.03,
      y: (yRaw * pinchH + waveY) * halfH,
      edgeFactor: boxD,
    };
  }

  // 'heart' silhouette mapped cleanly so the word spans the wide upper-mid lobes
  const normR = Math.hypot(dx, dy);
  const scale = 1 / Math.max(1, normR);
  const discX = uNorm * scale;
  const discY = vNorm * scale;
  const pinchTop = 0.34 * Math.pow(Math.abs(discX), 0.72) * (discY > 0 ? discY : 0);
  const bottomTaper = discY < 0 ? 1 - Math.abs(discY) * 0.56 : 1;
  const heartX = discX * (0.94 + 0.14 * Math.max(0, discY)) * bottomTaper;
  const heartY = discY * 1.04 + 0.26 * Math.sqrt(Math.abs(discX)) * Math.max(0, discY) - pinchTop;

  return {
    x: heartX * halfW * 0.94,
    y: heartY * halfH * 1.18,
    edgeFactor: boxD,
  };
}

export function createInitialClayNameState(
  text = 'CLAY HANDS',
  plaqueShape: ClayNamePlaqueShape = 'tablet',
  cols = NAME_DEFAULT_COLS,
  rows = NAME_DEFAULT_ROWS
): ClayNameState {
  return {
    text,
    plaqueShape,
    letterRelief: 0.024,
    letterBoldness: 1.0,
    cols,
    rows,
    sculptDeltas: new Float32Array(cols * rows),
  };
}

/**
 * Procedural 3D manifold BufferGeometry representing a hand-sculptable clay nameplate
 * with smooth SDF-rounded raised lettering, chamfered edges, and aligned UVs for painting.
 */
export class ClayNameGeometry {
  public readonly cols: number;
  public readonly rows: number;
  public readonly geometry: THREE.BufferGeometry;
  public readonly baseLetterHeight: Float32Array;
  private readonly positions: Float32Array;
  private readonly uvs: Float32Array;

  private readonly shapeX: Float32Array;
  private readonly shapeY: Float32Array;
  private readonly shapeU: Float32Array;
  private readonly shapeV: Float32Array;
  private readonly shapeEdgeBevel: Float32Array;
  private readonly shapeRimBead: Float32Array;
  private cachedGridShape: ClayNamePlaqueShape | '' = '';

  private cachedText = '';
  private cachedShape: ClayNamePlaqueShape | '' = '';
  private cachedBoldness = -1;
  private cachedSdf: Float32Array | null = null;
  private readonly sdfWidth = 220;
  private readonly sdfHeight = 106;

  constructor(cols = NAME_DEFAULT_COLS, rows = NAME_DEFAULT_ROWS) {
    this.cols = cols;
    this.rows = rows;
    const faceCount = cols * rows;
    const totalVerts = faceCount * 2;

    this.baseLetterHeight = new Float32Array(faceCount);
    this.positions = new Float32Array(totalVerts * 3);
    this.uvs = new Float32Array(totalVerts * 2);

    this.shapeX = new Float32Array(faceCount);
    this.shapeY = new Float32Array(faceCount);
    this.shapeU = new Float32Array(faceCount);
    this.shapeV = new Float32Array(faceCount);
    this.shapeEdgeBevel = new Float32Array(faceCount);
    this.shapeRimBead = new Float32Array(faceCount);

    this.geometry = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(this.positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', posAttr);
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2));

    const indices: number[] = [];

    // 1. Front sculpted surface (+Z)
    for (let iy = 0; iy < rows - 1; iy++) {
      for (let ix = 0; ix < cols - 1; ix++) {
        const a = iy * cols + ix;
        const b = a + 1;
        const c = (iy + 1) * cols + ix + 1;
        const d = (iy + 1) * cols + ix;
        indices.push(a, b, c, a, c, d);
      }
    }

    // 2. Back plaque surface (-Z)
    const backOffset = faceCount;
    for (let iy = 0; iy < rows - 1; iy++) {
      for (let ix = 0; ix < cols - 1; ix++) {
        const a = backOffset + iy * cols + ix;
        const b = a + 1;
        const c = backOffset + (iy + 1) * cols + ix + 1;
        const d = backOffset + (iy + 1) * cols + ix;
        indices.push(a, c, b, a, d, c);
      }
    }

    // 3. Perimeter waterproof thickness skirt
    for (let ix = 0; ix < cols - 1; ix++) {
      // Bottom edge (iy = 0)
      const f0 = ix;
      const f1 = ix + 1;
      const b0 = backOffset + f0;
      const b1 = backOffset + f1;
      indices.push(f0, b0, f1, b0, b1, f1);

      // Top edge (iy = rows - 1)
      const tf0 = (rows - 1) * cols + ix;
      const tf1 = tf0 + 1;
      const tb0 = backOffset + tf0;
      const tb1 = backOffset + tf1;
      indices.push(tf0, tf1, tb0, tb0, tf1, tb1);
    }

    for (let iy = 0; iy < rows - 1; iy++) {
      // Left edge (ix = 0)
      const lf0 = iy * cols;
      const lf1 = (iy + 1) * cols;
      const lb0 = backOffset + lf0;
      const lb1 = backOffset + lf1;
      indices.push(lf0, lf1, lb0, lb0, lf1, lb1);

      // Right edge (ix = cols - 1)
      const rf0 = iy * cols + (cols - 1);
      const rf1 = (iy + 1) * cols + (cols - 1);
      const rb0 = backOffset + rf0;
      const rb1 = backOffset + rf1;
      indices.push(rf0, rb0, rf1, rb0, rb1, rf1);
    }

    this.geometry.setIndex(indices);
  }

  public getCachedShapeXY(shape: ClayNamePlaqueShape): {
    x: Float32Array;
    y: Float32Array;
  } {
    this.ensureShapeCache(shape);
    return { x: this.shapeX, y: this.shapeY };
  }

  private ensureShapeCache(shape: ClayNamePlaqueShape): boolean {
    if (this.cachedGridShape === shape) return false;
    this.cachedGridShape = shape;

    const { cols, rows, positions, uvs } = this;
    const faceCount = cols * rows;
    const backZ = -0.013;

    for (let iy = 0; iy < rows; iy++) {
      const vNorm = (iy / (rows - 1)) * 2 - 1;
      for (let ix = 0; ix < cols; ix++) {
        const uNorm = (ix / (cols - 1)) * 2 - 1;
        const idx = iy * cols + ix;

        const { x, y, edgeFactor } = mapGridToPlaqueXY(
          uNorm,
          vNorm,
          shape,
          NAME_PLAQUE_WIDTH,
          NAME_PLAQUE_HEIGHT
        );

        const u = THREE.MathUtils.clamp(x / NAME_PLAQUE_WIDTH + 0.5, 0.01, 0.99);
        const v = THREE.MathUtils.clamp(y / NAME_PLAQUE_HEIGHT + 0.5, 0.01, 0.99);

        const edgeBevel =
          edgeFactor > 0.91
            ? Math.max(0.18, 1 - Math.pow((edgeFactor - 0.91) / 0.09, 1.5) * 0.82)
            : 1;
        const rimBeadDist = Math.abs(edgeFactor - 0.87) / 0.045;
        const rimBead =
          rimBeadDist < 1
            ? Math.cos(rimBeadDist * Math.PI * 0.5) * 0.0042
            : 0;

        this.shapeX[idx] = x;
        this.shapeY[idx] = y;
        this.shapeU[idx] = u;
        this.shapeV[idx] = v;
        this.shapeEdgeBevel[idx] = edgeBevel;
        this.shapeRimBead[idx] = rimBead;

        const fPosOff = idx * 3;
        positions[fPosOff] = x;
        positions[fPosOff + 1] = y;

        const bPosOff = (faceCount + idx) * 3;
        positions[bPosOff] = x;
        positions[bPosOff + 1] = y;
        positions[bPosOff + 2] = backZ;

        const uvOff = idx * 2;
        uvs[uvOff] = u;
        uvs[uvOff + 1] = v;

        const bUvOff = (faceCount + idx) * 2;
        uvs[bUvOff] = u;
        uvs[bUvOff + 1] = v;
      }
    }
    return true;
  }

  public updateFromState(state: ClayNameState): void {
    const cleanText = state.text.trim().slice(0, 16);
    const isBlank = cleanText.length === 0;
    if (isBlank) {
      if (this.cachedText !== '' || this.cachedSdf !== null) {
        this.cachedText = '';
        this.cachedSdf = null;
        this.baseLetterHeight.fill(0);
      }
    } else if (cleanText !== this.cachedText || !this.cachedSdf) {
      const mask = generateLetterMask(cleanText, this.sdfWidth, this.sdfHeight);
      this.cachedSdf = computeSignedDistanceField(
        mask,
        this.sdfWidth,
        this.sdfHeight
      );
      this.cachedText = cleanText;
      this.cachedShape = ''; // trigger SDF sampling refresh
    }

    const shapeChanged = this.ensureShapeCache(state.plaqueShape);
    const needResampleBase =
      !isBlank &&
      (this.cachedShape !== state.plaqueShape ||
        Math.abs(this.cachedBoldness - state.letterBoldness) > 0.001);

    const { cols, rows, positions } = this;
    const faceCount = cols * rows;
    const sdf = this.cachedSdf;
    const boldnessShift = (state.letterBoldness - 1.0) * 2.2;
    const backZ = -0.013;
    const minFrontZ = backZ + 0.005;
    const baseFrontZ = 0.012;
    const relief = state.letterRelief;
    const sculptDeltas = state.sculptDeltas;

    for (let idx = 0; idx < faceCount; idx++) {
      if (needResampleBase && sdf) {
        const u = this.shapeU[idx];
        const v = this.shapeV[idx];
        const sx = THREE.MathUtils.clamp(
          u * (this.sdfWidth - 1),
          0,
          this.sdfWidth - 1
        );
        const sy = THREE.MathUtils.clamp(
          (1 - v) * (this.sdfHeight - 1),
          0,
          this.sdfHeight - 1
        );
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const x1 = Math.min(this.sdfWidth - 1, x0 + 1);
        const y1 = Math.min(this.sdfHeight - 1, y0 + 1);
        const fx = sx - x0;
        const fy = sy - y0;
        const d00 = sdf[y0 * this.sdfWidth + x0];
        const d10 = sdf[y0 * this.sdfWidth + x1];
        const d01 = sdf[y1 * this.sdfWidth + x0];
        const d11 = sdf[y1 * this.sdfWidth + x1];
        const d = THREE.MathUtils.lerp(
          THREE.MathUtils.lerp(d00, d10, fx),
          THREE.MathUtils.lerp(d01, d11, fx),
          fy
        );

        const shifted = d + boldnessShift;
        const normDist = THREE.MathUtils.clamp((shifted + 1.1) / 5.4, 0, 1);
        const dome =
          normDist <= 0
            ? 0
            : Math.sqrt(Math.max(0, 1 - Math.pow(1 - normDist, 2))) * 0.92 +
              normDist * 0.08;
        this.baseLetterHeight[idx] = dome;
      }

      const edgeBevel = this.shapeEdgeBevel[idx];
      const rimBead = this.shapeRimBead[idx];
      const letterZ = this.baseLetterHeight[idx] * relief;
      const userDelta = sculptDeltas[idx] ?? 0;
      const rawFrontZ =
        baseFrontZ * edgeBevel + (letterZ + rimBead + userDelta) * edgeBevel;
      positions[idx * 3 + 2] = rawFrontZ > minFrontZ ? rawFrontZ : minFrontZ;
    }

    this.cachedShape = state.plaqueShape;
    this.cachedBoldness = state.letterBoldness;

    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate =
      true;
    if (shapeChanged) {
      (this.geometry.attributes.uv as THREE.BufferAttribute).needsUpdate = true;
      this.geometry.computeBoundingSphere();
      this.geometry.computeBoundingBox();
    }
    this.geometry.computeVertexNormals();
  }

  public dispose(): void {
    this.geometry.dispose();
  }
}
