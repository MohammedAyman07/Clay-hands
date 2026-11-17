import * as THREE from 'three';
import type { ClayProfileState } from '../types.ts';
import { CLAY_LIMITS } from './PotteryPresets.ts';

/**
 * Fixed-topology, double-walled hollow procedural radial pottery BufferGeometry.
 * Updates vertex positions in-place without reallocating buffers per frame.
 */
export class ClayGeometry {
  public readonly geometry: THREE.BufferGeometry;
  public readonly ringCount: number;
  public readonly angularSegments: number;
  private readonly cols: number;
  private readonly totalRows: number;
  private readonly positions: Float32Array;
  private readonly uvs: Float32Array;
  private readonly positionAttr: THREE.BufferAttribute;

  constructor(ringCount: number, angularSegments: number) {
    this.ringCount = ringCount;
    this.angularSegments = angularSegments;
    this.cols = angularSegments + 1;
    // Rows:
    // 0: outer bottom center
    // 1: outer bottom edge
    // 2 .. 2 + ringCount - 1: outer wall
    // 2 + ringCount: lip outer bevel
    // 3 + ringCount: lip inner bevel
    // 4 + ringCount .. 3 + 2 * ringCount: inner wall (top down to floor edge)
    // 4 + 2 * ringCount: inner floor mid
    // 5 + 2 * ringCount: inner floor center
    this.totalRows = 6 + ringCount * 2;

    const vertexCount = this.totalRows * this.cols;
    this.positions = new Float32Array(vertexCount * 3);
    this.uvs = new Float32Array(vertexCount * 2);

    this.geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(this.positions, 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttr);

    this.buildUvsAndIndices(vertexCount);
  }

  private buildUvsAndIndices(vertexCount: number): void {
    for (let row = 0; row < this.totalRows; row++) {
      const v = row / (this.totalRows - 1);
      for (let col = 0; col < this.cols; col++) {
        const u = col / this.angularSegments;
        const idx = (row * this.cols + col) * 2;
        this.uvs[idx] = u;
        this.uvs[idx + 1] = v;
      }
    }
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2));

    const quadCount = (this.totalRows - 1) * this.angularSegments;
    const indices =
      vertexCount > 65535
        ? new Uint32Array(quadCount * 6)
        : new Uint16Array(quadCount * 6);

    let ptr = 0;
    for (let row = 0; row < this.totalRows - 1; row++) {
      for (let col = 0; col < this.angularSegments; col++) {
        const a = row * this.cols + col;
        const b = (row + 1) * this.cols + col;
        const c = (row + 1) * this.cols + (col + 1);
        const d = row * this.cols + (col + 1);

        // CCW outward winding
        indices[ptr++] = a;
        indices[ptr++] = b;
        indices[ptr++] = d;

        indices[ptr++] = b;
        indices[ptr++] = c;
        indices[ptr++] = d;
      }
    }

    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  }

  public updateFromProfile(profile: ClayProfileState, time = 0): void {
    const R = this.ringCount;
    const S = this.angularSegments;
    const cols = this.cols;
    const pos = this.positions;

    const topHeight = profile.heights[R - 1];
    const minFloorY = Math.min(CLAY_LIMITS.floorThickness, topHeight * 0.45);
    // When openDepth is near 0, interior cavity sits right near the top as a shallow dimple
    const innerFloorY =
      topHeight - 0.008 - profile.openDepth * (topHeight - 0.008 - minFloorY);

    const wobbleScale = profile.wobble * 0.007;

    const writeRing = (
      row: number,
      baseRadius: number,
      y: number,
      ringIndexForOffset: number,
      offsetWeight: number
    ) => {
      const wobblePhase = time * 2.1 + row * 0.14;
      for (let col = 0; col < cols; col++) {
        const seg = col % S;
        const theta = (seg / S) * Math.PI * 2;
        const angularDelta =
          ringIndexForOffset >= 0
            ? (profile.angularOffsets[ringIndexForOffset * S + seg] ?? 0) *
              offsetWeight
            : 0;
        const wobbleDelta =
          wobbleScale > 0.0002
            ? Math.sin(theta + wobblePhase) *
              wobbleScale *
              (ringIndexForOffset >= 0 ? ringIndexForOffset / (R - 1) : 0)
            : 0;

        const r = Math.max(0, baseRadius + angularDelta + wobbleDelta);
        const x = r * Math.cos(theta);
        const z = r * Math.sin(theta);

        const idx = (row * cols + col) * 3;
        pos[idx] = x;
        pos[idx + 1] = y;
        pos[idx + 2] = z;
      }
    };

    // Row 0: bottom center
    writeRing(0, 0, profile.heights[0], -1, 0);
    // Row 1: bottom outer corner
    writeRing(1, profile.outerRadii[0], profile.heights[0], 0, 0.5);

    // Rows 2 .. R+1: outer wall
    for (let i = 0; i < R; i++) {
      writeRing(2 + i, profile.outerRadii[i], profile.heights[i], i, 1);
    }

    // Lip bevel rows for smooth ceramic rim
    const topOuter = profile.outerRadii[R - 1];
    const topInner = Math.max(
      0.004,
      Math.min(
        topOuter - CLAY_LIMITS.minWallThickness * 0.75,
        profile.innerRadii[R - 1]
      )
    );
    const lipLift = 0.0035;
    writeRing(
      2 + R,
      topOuter * 0.72 + topInner * 0.28,
      topHeight + lipLift,
      R - 1,
      0.7
    );
    writeRing(
      3 + R,
      topOuter * 0.28 + topInner * 0.72,
      topHeight + lipLift,
      R - 1,
      0.5
    );

    // Rows 4+R .. 3+2R: inner wall descending from rim to innerFloorY
    for (let k = 0; k < R; k++) {
      const i = R - 1 - k;
      const fracFromTop = k / (R - 1);
      const y = topHeight * (1 - fracFromTop) + innerFloorY * fracFromTop;
      const maxAllowedInner = Math.max(
        0.004,
        profile.outerRadii[i] - CLAY_LIMITS.minWallThickness * 0.75
      );
      const effectiveInner =
        profile.openDepth < 0.15
          ? Math.min(maxAllowedInner, profile.innerRadii[i] * 0.4 + 0.006)
          : Math.min(maxAllowedInner, profile.innerRadii[i]);
      writeRing(4 + R + k, effectiveInner, y, i, 0.45);
    }

    // Inner cavity floor mid and center
    const bottomInner = Math.min(
      Math.max(0.004, profile.outerRadii[0] - CLAY_LIMITS.minWallThickness),
      profile.innerRadii[0]
    );
    writeRing(4 + R * 2, bottomInner * 0.48, innerFloorY, -1, 0);
    writeRing(5 + R * 2, 0, innerFloorY, -1, 0);

    this.positionAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.stitchSeamNormals();
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
  }

  private stitchSeamNormals(): void {
    const normalAttr = this.geometry.attributes.normal;
    if (!normalAttr) return;
    const normals = normalAttr.array as Float32Array;
    const cols = this.cols;

    for (let row = 0; row < this.totalRows; row++) {
      const firstIdx = (row * cols + 0) * 3;
      const lastIdx = (row * cols + this.angularSegments) * 3;

      const nx = normals[firstIdx] + normals[lastIdx];
      const ny = normals[firstIdx + 1] + normals[lastIdx + 1];
      const nz = normals[firstIdx + 2] + normals[lastIdx + 2];
      const len = Math.hypot(nx, ny, nz) || 1;

      normals[firstIdx] = nx / len;
      normals[firstIdx + 1] = ny / len;
      normals[firstIdx + 2] = nz / len;

      normals[lastIdx] = nx / len;
      normals[lastIdx + 1] = ny / len;
      normals[lastIdx + 2] = nz / len;
    }
    normalAttr.needsUpdate = true;
  }

  public dispose(): void {
    this.geometry.dispose();
  }
}

export function createWetClayTexture(size = 256): THREE.Texture {
  if (typeof document === 'undefined') {
    const tex = new THREE.DataTexture(
      new Uint8Array([168, 124, 96, 255]),
      1,
      1
    );
    tex.needsUpdate = true;
    return tex;
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#a87c60';
    ctx.fillRect(0, 0, size, size);
    // Horizontal throwing bands + subtle mineral grain
    for (let y = 0; y < size; y += 2) {
      const band = Math.sin(y * 0.35) * 8 + (Math.random() - 0.5) * 9;
      const r = Math.min(255, Math.max(0, 168 + band));
      const g = Math.min(255, Math.max(0, 124 + band * 0.8));
      const b = Math.min(255, Math.max(0, 96 + band * 0.7));
      ctx.fillStyle = `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
      ctx.fillRect(0, y, size, 2);
    }
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      ctx.fillStyle =
        Math.random() > 0.5 ? 'rgba(60,40,28,0.12)' : 'rgba(230,205,180,0.1)';
      ctx.fillRect(x, y, 2, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
