import * as THREE from 'three';
import type { ClayNameGeometry } from '../names/ClayNameGeometry.ts';
import type { ClayGeometry } from '../pottery/ClayGeometry.ts';
import type { SavedPotteryItem } from '../types.ts';

export type SmashPhase = 'idle' | 'smashing' | 'smashed' | 'restoring';
export type SmashScope = 'single' | 'all';

export interface VesselSlotLayout {
  x: number;
  y: number;
  z: number;
  scale: number;
}

export interface RecordedTransformFrame {
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface ShardSpec {
  geometry: THREE.BufferGeometry;
  centroid: THREE.Vector3;
  radialDir: THREE.Vector3;
  approxRadius: number;
}

interface ActiveShard {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  homePos: THREE.Vector3;
  homeQuat: THREE.Quaternion;
  velocity: THREE.Vector3;
  angVel: THREE.Vector3;
  radialDir: THREE.Vector3;
  approxRadius: number;
  settled: boolean;
  frames: RecordedTransformFrame[];
  delayOffset: number;
}

export interface SmashableVesselEntry {
  item: SavedPotteryItem;
  root: THREE.Group;
  mesh: THREE.Mesh;
  clayGeometry: ClayGeometry | null;
  nameGeometry?: ClayNameGeometry | null;
  customMaterial: THREE.Material | null;
  customTexture: THREE.Texture | null;
  shardMaterial: THREE.Material;
  crackGroup: THREE.Group;
  crackLineGeo: THREE.BufferGeometry | null;
  crackHighlightGeo: THREE.BufferGeometry | null;
  crackMaterial: THREE.LineBasicMaterial;
  crackHighlightMat: THREE.LineBasicMaterial;
  plinthGroup: THREE.Group | null;
  layout: VesselSlotLayout;
  centerLocal: THREE.Vector3;
  hitRadius: number;
  hits: number;
  maxHits: number;
  hitCooldown: number;
  recoilAngle: THREE.Vector2;
  recoilVel: THREE.Vector2;
  intact: boolean;
  shards: ActiveShard[];
  restoreDelay: number;
}

export interface SmashSystemStatus {
  smashMode: boolean;
  smashScope: SmashScope;
  phase: SmashPhase;
  totalVessels: number;
  crackedCount: number;
  smashedCount: number;
  isRestoring: boolean;
  focusedVesselName: string | null;
  focusedVesselHits: number;
  focusedVesselMaxHits: number;
}

export interface SmashSystemCallbacks {
  onBatSwing?: (intensity: number) => void;
  onCeramicCrack?: (vesselName: string, crackedCount: number) => void;
  onCeramicShatter?: (vesselCount: number) => void;
  onTimeRestoreStart?: () => void;
  onTimeRestoreComplete?: () => void;
  onStateChanged?: () => void;
}

// Pedestal top sits at y=0 in galleryPedestalAnchor space; workshop floor is 0.825m below
const FLOOR_LOCAL_Y = -0.825;
const MAX_RECORDED_FRAMES = 96;
const RECORD_INTERVAL_SEC = 1 / 30;
const RESTORE_DURATION_SEC = 2.35;
const RESTORE_REDUCED_DURATION_SEC = 1.05;
const VESSEL_HIT_COOLDOWN_SEC = 0.34;

const _tmpVec = new THREE.Vector3();
const _tmpVec2 = new THREE.Vector3();
const _tmpVec3 = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _tmpQuat2 = new THREE.Quaternion();
const _tmpEuler = new THREE.Euler();

/**
 * Pure deterministic layout solver arranging 1..N saved pottery vessels with
 * guaranteed non-overlapping clearance so vessels & plinths cannot collide or collapse.
 */
export function computeGalleryLayoutPositions(
  count: number,
  selectedIndex = 0,
  vesselRadii?: readonly number[]
): VesselSlotLayout[] {
  if (count <= 0) return [];
  if (count === 1) {
    return [{ x: 0, y: 0, z: 0, scale: 1 }];
  }

  // Order indices so selected vessel sits closest to center
  const orderedIndices: number[] = [];
  const clampedSel = Math.max(0, Math.min(count - 1, selectedIndex));
  orderedIndices.push(clampedSel);
  for (let i = 0; i < count; i++) {
    if (i !== clampedSel) orderedIndices.push(i);
  }

  // Interleave around center: [sel, left1, right1, left2, right2, ...]
  const slotOrder = new Array<number>(count);
  const centerSlot = Math.floor(count / 2);
  slotOrder[centerSlot] = orderedIndices[0];
  let step = 1;
  for (let k = 1; k < orderedIndices.length; k++) {
    const dir = k % 2 === 1 ? -1 : 1;
    const targetSlot = centerSlot + dir * step;
    if (targetSlot >= 0 && targetSlot < count) {
      slotOrder[targetSlot] = orderedIndices[k];
    }
    if (k % 2 === 0) step++;
  }

  const slots = new Array<VesselSlotLayout>(count);
  const scale =
    count <= 2 ? 0.92 : count <= 4 ? 0.82 : count <= 6 ? 0.72 : 0.64;

  // Estimate scaled physical footprint per vessel (plinth outer ~ 0.145m)
  const effectiveRadius = (idx: number): number => {
    const rawR = Math.max(0.075, vesselRadii?.[idx] ?? 0.09);
    return Math.max(rawR, 0.14) * scale;
  };

  if (count <= 5) {
    // Single wide front-facing concave showcase arc with generous spacing >= 0.42m
    const maxNeighborR = orderedIndices.reduce(
      (acc, id) => Math.max(acc, effectiveRadius(id)),
      0.11
    );
    const colSpacing = Math.max(0.42, maxNeighborR * 2 + 0.18);
    for (let slotIdx = 0; slotIdx < count; slotIdx++) {
      const itemIdx = slotOrder[slotIdx] ?? slotIdx;
      const offset = slotIdx - (count - 1) / 2;
      const norm = count === 1 ? 0 : (slotIdx / (count - 1)) * 2 - 1;
      const x = offset * colSpacing;
      const z = 0.06 + norm * norm * 0.16;
      slots[itemIdx] = { x, y: 0, z, scale };
    }
  } else {
    // 2 staggered rows (front row grounded at y=0, back row raised y=0.18m on tall plinths)
    const frontCount = Math.ceil(count / 2);
    const backCount = count - frontCount;
    const colSpacing = 0.44;

    let frontCursor = 0;
    let backCursor = 0;
    for (let slotIdx = 0; slotIdx < count; slotIdx++) {
      const itemIdx = slotOrder[slotIdx] ?? slotIdx;
      const useFront = slotIdx % 2 === 0 || backCursor >= backCount;
      if (useFront && frontCursor < frontCount) {
        const norm =
          frontCount <= 1 ? 0 : (frontCursor / (frontCount - 1)) * 2 - 1;
        const x = (frontCursor - (frontCount - 1) / 2) * colSpacing;
        const z = 0.24 + norm * norm * 0.12;
        slots[itemIdx] = { x, y: 0, z, scale };
        frontCursor++;
      } else {
        const norm =
          backCount <= 1 ? 0 : (backCursor / (backCount - 1)) * 2 - 1;
        const x = (backCursor - (backCount - 1) / 2) * colSpacing;
        const z = -0.18 + norm * norm * 0.08;
        slots[itemIdx] = { x, y: 0.18, z, scale };
        backCursor++;
      }
    }
  }

  // Iterative pairwise repulsion pass guarantees zero overlap / collapse for any pot widths
  for (let iter = 0; iter < 18; iter++) {
    let adjusted = false;
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const a = slots[i];
        const b = slots[j];
        const minDist = Math.max(
          0.38,
          effectiveRadius(i) + effectiveRadius(j) + 0.14
        );
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        if (dist < minDist) {
          const push = (minDist - dist) * 0.52;
          const nx = dist > 1e-4 ? dx / dist : (i % 2 === 0 ? 1 : -1);
          const nz = dist > 1e-4 ? dz / dist : 0;
          a.x -= nx * push;
          a.z -= nz * push * 0.35;
          b.x += nx * push;
          b.z += nz * push * 0.35;
          adjusted = true;
        }
      }
    }
    if (!adjusted) break;
  }

  return slots;
}

/**
 * Pure interpolation helper used by Chrono Rewind to play
 * recorded physics frames backwards with smooth elastic arrival.
 */
export function sampleReversedTransform(
  frames: readonly RecordedTransformFrame[],
  progress: number,
  outPos: THREE.Vector3,
  outQuat: THREE.Quaternion
): void {
  if (frames.length === 0) return;
  if (frames.length === 1) {
    const f = frames[0];
    outPos.set(f.px, f.py, f.pz);
    outQuat.set(f.qx, f.qy, f.qz, f.qw);
    return;
  }

  const clamped = Math.max(0, Math.min(1, progress));
  // Smooth ease-in-out with crisp time-lock snap at the end
  const eased =
    clamped < 0.5
      ? 2 * clamped * clamped
      : 1 - Math.pow(-2 * clamped + 2, 2) / 2;

  const reverseFloat = (1 - eased) * (frames.length - 1);
  const idxLow = Math.floor(reverseFloat);
  const idxHigh = Math.min(frames.length - 1, idxLow + 1);
  const alpha = reverseFloat - idxLow;

  const a = frames[idxLow];
  const b = frames[idxHigh];

  outPos.set(
    THREE.MathUtils.lerp(a.px, b.px, alpha),
    THREE.MathUtils.lerp(a.py, b.py, alpha),
    THREE.MathUtils.lerp(a.pz, b.pz, alpha)
  );
  _tmpQuat.set(a.qx, a.qy, a.qz, a.qw);
  _tmpQuat2.set(b.qx, b.qy, b.qz, b.qw);
  outQuat.copy(_tmpQuat).slerp(_tmpQuat2, alpha);
}

/**
 * Slices a procedural ClayGeometry vessel into thick, curved, double-walled
 * 3D ceramic shard BufferGeometries preserving original outer & inner UVs.
 */
export function buildShardGeometriesFromClay(
  clayGeometry: ClayGeometry,
  bandsY = 4,
  sectorsTheta = 6
): ShardSpec[] {
  const R = clayGeometry.ringCount;
  const S = clayGeometry.angularSegments;
  const cols = S + 1;

  const posAttr = clayGeometry.geometry.attributes.position;
  const uvAttr = clayGeometry.geometry.attributes.uv;
  if (!posAttr || !uvAttr) return [];

  const positions = posAttr.array as Float32Array;
  const uvs = uvAttr.array as Float32Array;

  const shards: ShardSpec[] = [];

  // Partition height rings (0..R-1) into organic slightly varied bands
  const rBounds: number[] = [0];
  for (let b = 1; b < bandsY; b++) {
    const nominal = Math.round((b / bandsY) * (R - 1));
    rBounds.push(Math.max(rBounds[b - 1] + 2, Math.min(R - 2, nominal)));
  }
  rBounds.push(R - 1);

  for (let b = 0; b < bandsY; b++) {
    const r0 = rBounds[b];
    const r1 = rBounds[b + 1];
    // Stagger angular cuts per vertical band like real fractured terracotta
    const thetaShift = Math.floor(((b % 2) * S) / (sectorsTheta * 2));

    const sBounds: number[] = [0];
    for (let k = 1; k < sectorsTheta; k++) {
      const jitter = ((b * 7 + k * 3) % 3) - 1;
      const seg = Math.round((k / sectorsTheta) * S) + jitter;
      sBounds.push(Math.max(sBounds[k - 1] + 2, Math.min(S - 2, seg)));
    }
    sBounds.push(S);

    for (let k = 0; k < sectorsTheta; k++) {
      const sStart = sBounds[k];
      const sEnd = sBounds[k + 1];

      const shardPos: number[] = [];
      const shardUv: number[] = [];
      const shardIndices: number[] = [];

      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      let vCount = 0;

      const pushVert = (row: number, rawCol: number): number => {
        const col = ((rawCol % S) + S) % S;
        const srcIdx = row * cols + col;
        const x = positions[srcIdx * 3];
        const y = positions[srcIdx * 3 + 1];
        const z = positions[srcIdx * 3 + 2];
        const u = ((rawCol + thetaShift) / S) % 1.0001;
        const v = uvs[srcIdx * 2 + 1];

        shardPos.push(x, y, z);
        shardUv.push(u < 0 ? u + 1 : u, v);
        sumX += x;
        sumY += y;
        sumZ += z;
        return vCount++;
      };

      const rCount = r1 - r0 + 1;
      const sCount = sEnd - sStart + 1;

      const outerGrid: number[][] = [];
      const innerGrid: number[][] = [];

      for (let ri = 0; ri < rCount; ri++) {
        const ring = r0 + ri;
        const outerRow = 2 + ring;
        const innerRow = 3 + 2 * R - ring;
        const outRowArr: number[] = [];
        const inRowArr: number[] = [];

        for (let si = 0; si < sCount; si++) {
          const seg = sStart + si + thetaShift;
          outRowArr.push(pushVert(outerRow, seg));
          inRowArr.push(pushVert(innerRow, seg));
        }
        outerGrid.push(outRowArr);
        innerGrid.push(inRowArr);
      }

      // Outer & inner wall triangles
      for (let ri = 0; ri < rCount - 1; ri++) {
        for (let si = 0; si < sCount - 1; si++) {
          const oa = outerGrid[ri][si];
          const ob = outerGrid[ri + 1][si];
          const oc = outerGrid[ri + 1][si + 1];
          const od = outerGrid[ri][si + 1];
          shardIndices.push(oa, ob, od, ob, oc, od);

          const ia = innerGrid[ri][si];
          const ib = innerGrid[ri + 1][si];
          const ic = innerGrid[ri + 1][si + 1];
          const id = innerGrid[ri][si + 1];
          // Inner wall faces inward (opposite winding of outer)
          shardIndices.push(ia, id, ib, ib, id, ic);
        }
      }

      // Stitch fractured thickness borders around all 4 perimeter edges
      // Top edge
      for (let si = 0; si < sCount - 1; si++) {
        const oa = outerGrid[rCount - 1][si];
        const ob = outerGrid[rCount - 1][si + 1];
        const ia = innerGrid[rCount - 1][si];
        const ib = innerGrid[rCount - 1][si + 1];
        shardIndices.push(oa, ia, ob, ia, ib, ob);
      }
      // Bottom edge
      for (let si = 0; si < sCount - 1; si++) {
        const oa = outerGrid[0][si];
        const ob = outerGrid[0][si + 1];
        const ia = innerGrid[0][si];
        const ib = innerGrid[0][si + 1];
        shardIndices.push(oa, ob, ia, ia, ob, ib);
      }
      // Left edge
      for (let ri = 0; ri < rCount - 1; ri++) {
        const oa = outerGrid[ri][0];
        const ob = outerGrid[ri + 1][0];
        const ia = innerGrid[ri][0];
        const ib = innerGrid[ri + 1][0];
        shardIndices.push(oa, ia, ob, ia, ib, ob);
      }
      // Right edge
      for (let ri = 0; ri < rCount - 1; ri++) {
        const oa = outerGrid[ri][sCount - 1];
        const ob = outerGrid[ri + 1][sCount - 1];
        const ia = innerGrid[ri][sCount - 1];
        const ib = innerGrid[ri + 1][sCount - 1];
        shardIndices.push(oa, ob, ia, ia, ob, ib);
      }

      if (vCount === 0) continue;

      const centroid = new THREE.Vector3(
        sumX / vCount,
        sumY / vCount,
        sumZ / vCount
      );

      // Re-center vertices around centroid so rotation pivots through shard center of mass
      let maxDistSq = 0;
      for (let i = 0; i < vCount; i++) {
        const lx = shardPos[i * 3] - centroid.x;
        const ly = shardPos[i * 3 + 1] - centroid.y;
        const lz = shardPos[i * 3 + 2] - centroid.z;
        shardPos[i * 3] = lx;
        shardPos[i * 3 + 1] = ly;
        shardPos[i * 3 + 2] = lz;
        const dSq = lx * lx + ly * ly + lz * lz;
        if (dSq > maxDistSq) maxDistSq = dSq;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(shardPos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(shardUv, 2));
      geo.setIndex(shardIndices);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();

      const radialDir = new THREE.Vector3(centroid.x, 0.18, centroid.z);
      if (radialDir.lengthSq() < 0.0001) {
        radialDir.set(0, 1, 0);
      } else {
        radialDir.normalize();
      }

      shards.push({
        geometry: geo,
        centroid,
        radialDir,
        approxRadius: Math.max(0.012, Math.sqrt(maxDistSq)),
      });
    }
  }

  return shards;
}

/**
 * Slices a procedural ClayNameGeometry plaque into thick, double-sided ceramic
 * shard BufferGeometries preserving front & back clay/glaze UVs.
 */
export function buildShardGeometriesFromName(
  nameGeometry: ClayNameGeometry,
  bandsY = 3,
  colsX = 6,
  yOffset = 0.145
): ShardSpec[] {
  const C = nameGeometry.cols;
  const R = nameGeometry.rows;
  const faceCount = C * R;

  const posAttr = nameGeometry.geometry.attributes.position;
  const uvAttr = nameGeometry.geometry.attributes.uv;
  if (!posAttr || !uvAttr) return [];

  const positions = posAttr.array as Float32Array;
  const uvs = uvAttr.array as Float32Array;
  const shards: ShardSpec[] = [];

  const rBounds: number[] = [0];
  for (let b = 1; b < bandsY; b++) {
    const jitter = ((b * 5) % 3) - 1;
    const nominal = Math.round((b / bandsY) * (R - 1)) + jitter;
    rBounds.push(Math.max(rBounds[b - 1] + 2, Math.min(R - 2, nominal)));
  }
  rBounds.push(R - 1);

  for (let b = 0; b < bandsY; b++) {
    const r0 = rBounds[b];
    const r1 = rBounds[b + 1];

    const cBounds: number[] = [0];
    for (let k = 1; k < colsX; k++) {
      const jitter = ((b * 7 + k * 3) % 5) - 2;
      const seg = Math.round((k / colsX) * (C - 1)) + jitter;
      cBounds.push(Math.max(cBounds[k - 1] + 2, Math.min(C - 2, seg)));
    }
    cBounds.push(C - 1);

    for (let k = 0; k < colsX; k++) {
      const c0 = cBounds[k];
      const c1 = cBounds[k + 1];

      const shardPos: number[] = [];
      const shardUv: number[] = [];
      const shardIndices: number[] = [];

      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      let vCount = 0;

      const pushVert = (srcIdx: number): number => {
        const x = positions[srcIdx * 3];
        const y = positions[srcIdx * 3 + 1] + yOffset;
        const z = positions[srcIdx * 3 + 2];
        const u = uvs[srcIdx * 2];
        const v = uvs[srcIdx * 2 + 1];

        shardPos.push(x, y, z);
        shardUv.push(u, v);
        sumX += x;
        sumY += y;
        sumZ += z;
        return vCount++;
      };

      const rCount = r1 - r0 + 1;
      const cCount = c1 - c0 + 1;
      const frontGrid: number[][] = [];
      const backGrid: number[][] = [];

      for (let ri = 0; ri < rCount; ri++) {
        const row = r0 + ri;
        const fRow: number[] = [];
        const bRow: number[] = [];
        for (let ci = 0; ci < cCount; ci++) {
          const col = c0 + ci;
          const frontIdx = row * C + col;
          fRow.push(pushVert(frontIdx));
          bRow.push(pushVert(faceCount + frontIdx));
        }
        frontGrid.push(fRow);
        backGrid.push(bRow);
      }

      for (let ri = 0; ri < rCount - 1; ri++) {
        for (let ci = 0; ci < cCount - 1; ci++) {
          const fa = frontGrid[ri][ci];
          const fb = frontGrid[ri][ci + 1];
          const fc = frontGrid[ri + 1][ci + 1];
          const fd = frontGrid[ri + 1][ci];
          shardIndices.push(fa, fb, fc, fa, fc, fd);

          const ba = backGrid[ri][ci];
          const bb = backGrid[ri][ci + 1];
          const bc = backGrid[ri + 1][ci + 1];
          const bd = backGrid[ri + 1][ci];
          shardIndices.push(ba, bc, bb, ba, bd, bc);
        }
      }

      // Stitch fractured thickness borders around all 4 edges
      for (let ci = 0; ci < cCount - 1; ci++) {
        // Bottom
        const fa = frontGrid[0][ci];
        const fb = frontGrid[0][ci + 1];
        const ba = backGrid[0][ci];
        const bb = backGrid[0][ci + 1];
        shardIndices.push(fa, ba, fb, ba, bb, fb);

        // Top
        const tfa = frontGrid[rCount - 1][ci];
        const tfb = frontGrid[rCount - 1][ci + 1];
        const tba = backGrid[rCount - 1][ci];
        const tbb = backGrid[rCount - 1][ci + 1];
        shardIndices.push(tfa, tfb, tba, tba, tfb, tbb);
      }

      for (let ri = 0; ri < rCount - 1; ri++) {
        // Left
        const lfa = frontGrid[ri][0];
        const lfb = frontGrid[ri + 1][0];
        const lba = backGrid[ri][0];
        const lbb = backGrid[ri + 1][0];
        shardIndices.push(lfa, lfb, lba, lba, lfb, lbb);

        // Right
        const rfa = frontGrid[ri][cCount - 1];
        const rfb = frontGrid[ri + 1][cCount - 1];
        const rba = backGrid[ri][cCount - 1];
        const rbb = backGrid[ri + 1][cCount - 1];
        shardIndices.push(rfa, rba, rfb, rba, rbb, rfb);
      }

      if (vCount === 0) continue;

      const centroid = new THREE.Vector3(
        sumX / vCount,
        sumY / vCount,
        sumZ / vCount
      );

      let maxDistSq = 0;
      for (let i = 0; i < vCount; i++) {
        const lx = shardPos[i * 3] - centroid.x;
        const ly = shardPos[i * 3 + 1] - centroid.y;
        const lz = shardPos[i * 3 + 2] - centroid.z;
        shardPos[i * 3] = lx;
        shardPos[i * 3 + 1] = ly;
        shardPos[i * 3 + 2] = lz;
        const dSq = lx * lx + ly * ly + lz * lz;
        if (dSq > maxDistSq) maxDistSq = dSq;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(shardPos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(shardUv, 2));
      geo.setIndex(shardIndices);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();

      const radialDir = new THREE.Vector3(
        centroid.x * 1.4,
        0.24 + (centroid.y - yOffset) * 1.2,
        0.55 + Math.random() * 0.45
      ).normalize();

      shards.push({
        geometry: geo,
        centroid,
        radialDir,
        approxRadius: Math.max(0.012, Math.sqrt(maxDistSq)),
      });
    }
  }

  return shards;
}

function createAshWoodTexture(size = 256): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#c89b62';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 2) {
      const wave = Math.sin(y * 0.08) * 12 + Math.cos(y * 0.21) * 7;
      const r = Math.min(255, Math.max(0, 200 + wave));
      const g = Math.min(255, Math.max(0, 155 + wave * 0.8));
      const b = Math.min(255, Math.max(0, 98 + wave * 0.6));
      ctx.fillStyle = `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
      ctx.fillRect(0, y, size, 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createTimeMandalaTexture(
  variant: 'outer' | 'inner',
  size = 512
): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const cx = size / 2;
  const cy = size / 2;
  ctx.clearRect(0, 0, size, size);

  // Outer emerald aura halo
  const glow = ctx.createRadialGradient(cx, cy, size * 0.14, cx, cy, size * 0.5);
  glow.addColorStop(0, 'rgba(65, 255, 165, 0.22)');
  glow.addColorStop(0.65, 'rgba(20, 220, 120, 0.12)');
  glow.addColorStop(1, 'rgba(0, 180, 90, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.shadowColor = '#46ffaa';
  ctx.shadowBlur = 12;

  if (variant === 'outer') {
    // Concentric Eldritch circles
    ctx.strokeStyle = '#6bffb8';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.44, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(130, 255, 195, 0.85)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.37, 0, Math.PI * 2);
    ctx.stroke();

    // Clock tick ring (Chrono Rewind dial marks)
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const rIn = i % 4 === 0 ? size * 0.37 : size * 0.405;
      const rOut = size * 0.44;
      ctx.strokeStyle = i % 4 === 0 ? '#caffea' : 'rgba(95, 255, 175, 0.75)';
      ctx.lineWidth = i % 4 === 0 ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * rIn, Math.sin(a) * rIn);
      ctx.lineTo(Math.cos(a) * rOut, Math.sin(a) * rOut);
      ctx.stroke();
    }

    // Two overlapping sacred squares (8-point star mandala)
    for (const rot of [0, Math.PI / 4]) {
      ctx.save();
      ctx.rotate(rot);
      const half = size * 0.26;
      ctx.strokeStyle = '#55ffa8';
      ctx.lineWidth = 3;
      ctx.strokeRect(-half, -half, half * 2, half * 2);
      ctx.restore();
    }

    // Eldritch rune notches around perimeter band
    ctx.strokeStyle = '#b4ffe0';
    ctx.lineWidth = 2.2;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.save();
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(-6, -size * 0.34);
      ctx.lineTo(0, -size * 0.31);
      ctx.lineTo(6, -size * 0.34);
      ctx.moveTo(0, -size * 0.355);
      ctx.lineTo(0, -size * 0.31);
      ctx.stroke();
      ctx.restore();
    }
  } else {
    // Inner Time-Eye geometric sigil
    ctx.strokeStyle = '#99ffd2';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.29, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#40ff99';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.2, 0, Math.PI * 2);
    ctx.stroke();

    // Inner hexagonal time sigil + clock hands
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * size * 0.2;
      const y = Math.sin(a) * size * 0.2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();

    // Eye of Agamotto diamond core
    ctx.fillStyle = 'rgba(155, 255, 205, 0.45)';
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.11);
    ctx.lineTo(size * 0.065, 0);
    ctx.lineTo(0, size * 0.11);
    ctx.lineTo(-size * 0.065, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#e2fff2';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Interactive Gallery Pottery Bat-Smash & Chrono Rewind Reversal engine.
 * Works across Desktop Mouse, Webcam Hand Tracking, and Meta Quest WebXR.
 */
export class PotterySmashSystem {
  public readonly group = new THREE.Group();
  private readonly callbacks: SmashSystemCallbacks;

  private vessels: SmashableVesselEntry[] = [];
  private smashMode = false;
  private smashScope: SmashScope = 'all';
  private phase: SmashPhase = 'idle';

  // Composite 3D Wooden Pottery Bat
  private readonly batGroup = new THREE.Group();
  private readonly batSwingPivot = new THREE.Group();
  private batTrailMesh!: THREE.Mesh;
  private readonly batGeos: THREE.BufferGeometry[] = [];
  private readonly batMats: THREE.Material[] = [];
  private readonly batTexs: THREE.Texture[] = [];
  private readonly batTargetLocal = new THREE.Vector3(0, 0.22, 0.28);
  private readonly batCurrentLocal = new THREE.Vector3(0, 0.22, 0.28);
  private readonly prevBatTipWorld = new THREE.Vector3();
  private hasPrevBatTip = false;
  private swingTimer = 0;
  private swingDirSign = 1;
  private sweepAllTimer = -1;
  private sweepAllDuration = 0.52;

  // Emerald Chrono Rewind Mandala & Time Sparks
  private readonly mandalaGroup = new THREE.Group();
  private readonly outerMandalaMesh!: THREE.Mesh;
  private readonly innerMandalaMesh!: THREE.Mesh;
  private readonly portalOuterMesh!: THREE.Mesh;
  private readonly portalInnerMesh!: THREE.Mesh;
  private readonly handMandalaGroup = new THREE.Group();
  private readonly handMandalaOuter!: THREE.Mesh;
  private readonly handMandalaInner!: THREE.Mesh;
  private readonly timeSparks!: THREE.Points;
  private readonly timeSparkBase!: Float32Array;
  private readonly mandalaGeos: THREE.BufferGeometry[] = [];
  private readonly mandalaMats: THREE.Material[] = [];
  private readonly mandalaTexs: THREE.Texture[] = [];

  // Hand Focus Target Ring (shows which vessel hand/bat is currently targeting + crack warning)
  private readonly focusRingGroup = new THREE.Group();
  private readonly focusRingOuter: THREE.Mesh;
  private readonly focusRingInner: THREE.Mesh;
  private readonly focusRingGeos: THREE.BufferGeometry[] = [];
  private readonly focusRingMats: THREE.MeshBasicMaterial[] = [];
  private focusedVesselIndex = -1;
  private hasExternalFocusThisFrame = false;

  // Shared plinth assets for multi-vessel showcase
  private readonly plinthGeo: THREE.CylinderGeometry;
  private readonly plinthColGeo: THREE.CylinderGeometry;
  private readonly plinthWoodMat: THREE.MeshStandardMaterial;
  private readonly plinthStoneMat: THREE.MeshStandardMaterial;

  // Dust / ceramic impact burst particles
  private dustPoints: THREE.Points | null = null;
  private dustVelocities: Float32Array | null = null;
  private dustLife = 0;

  private restoreProgress = 0;
  private reducedMotion = false;
  private recordAccum = 0;
  private mandalaClock = 0;

  // Reusable scratch math
  private readonly _raycaster = new THREE.Raycaster();
  private readonly _plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly _planeHit = new THREE.Vector3();
  private readonly _planeNormal = new THREE.Vector3();
  private readonly _planeCenter = new THREE.Vector3();
  private readonly _batTipWorld = new THREE.Vector3();
  private readonly _batTipLocal = new THREE.Vector3();
  private readonly _swingVelLocal = new THREE.Vector3();
  private readonly _projVec = new THREE.Vector3();
  private readonly _localRayOrigin = new THREE.Vector3();
  private readonly _localRayDir = new THREE.Vector3();
  private sweepPassSwitched = false;

  constructor(callbacks: SmashSystemCallbacks = {}) {
    this.callbacks = callbacks;
    this.group.name = 'PotterySmashSystem';

    this.plinthGeo = new THREE.CylinderGeometry(0.145, 0.145, 0.024, 24);
    this.plinthColGeo = new THREE.CylinderGeometry(0.08, 0.11, 1.0, 20);
    this.plinthWoodMat = new THREE.MeshStandardMaterial({
      color: 0x865d3f,
      roughness: 0.68,
      metalness: 0.04,
    });
    this.plinthStoneMat = new THREE.MeshStandardMaterial({
      color: 0xb5a896,
      roughness: 0.88,
      metalness: 0.02,
    });

    this.buildWoodenBat();
    const {
      outerMesh,
      innerMesh,
      portalOuter,
      portalInner,
      handOuter,
      handInner,
      sparks,
      sparkBase,
    } = this.buildChronoRewindMandala();
    this.outerMandalaMesh = outerMesh;
    this.innerMandalaMesh = innerMesh;
    this.portalOuterMesh = portalOuter;
    this.portalInnerMesh = portalInner;
    this.handMandalaOuter = handOuter;
    this.handMandalaInner = handInner;
    this.timeSparks = sparks;
    this.timeSparkBase = sparkBase;

    // Focus highlight reticle around targeted pottery plinth
    const outerFocusGeo = new THREE.RingGeometry(0.155, 0.18, 36);
    const innerFocusGeo = new THREE.RingGeometry(0.125, 0.136, 36, 1, 0, Math.PI * 1.45);
    const outerFocusMat = new THREE.MeshBasicMaterial({
      color: 0xffc857,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const innerFocusMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.focusRingOuter = new THREE.Mesh(outerFocusGeo, outerFocusMat);
    this.focusRingOuter.rotation.x = -Math.PI / 2;
    this.focusRingInner = new THREE.Mesh(innerFocusGeo, innerFocusMat);
    this.focusRingInner.rotation.x = -Math.PI / 2;
    this.focusRingInner.position.y = 0.004;
    this.focusRingGroup.add(this.focusRingOuter, this.focusRingInner);
    this.focusRingGroup.visible = false;
    this.focusRingGeos.push(outerFocusGeo, innerFocusGeo);
    this.focusRingMats.push(outerFocusMat, innerFocusMat);

    this.buildDustBurst();

    this.batGroup.visible = false;
    this.mandalaGroup.visible = false;
    this.handMandalaGroup.visible = false;
    this.group.add(
      this.batGroup,
      this.mandalaGroup,
      this.handMandalaGroup,
      this.focusRingGroup
    );
  }

  private buildWoodenBat(): void {
    const woodTex = createAshWoodTexture();
    if (woodTex) this.batTexs.push(woodTex);

    const ashWoodMat = new THREE.MeshStandardMaterial({
      color: 0xe3bd88,
      map: woodTex,
      roughness: 0.34,
      metalness: 0.04,
    });
    const gripTapeMat = new THREE.MeshStandardMaterial({
      color: 0x1b1c20,
      roughness: 0.88,
      metalness: 0.04,
    });
    const crimsonStripeMat = new THREE.MeshStandardMaterial({
      color: 0xa82820,
      roughness: 0.42,
      metalness: 0.08,
    });
    const goldRingMat = new THREE.MeshStandardMaterial({
      color: 0xd9aa4c,
      roughness: 0.28,
      metalness: 0.72,
    });
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0xffd28a,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.batMats.push(
      ashWoodMat,
      gripTapeMat,
      crimsonStripeMat,
      goldRingMat,
      trailMat
    );

    // 1. Lathe-turned classic 3D baseball bat silhouette (knob -> handle -> taper -> barrel -> cupped tip)
    const profilePoints: THREE.Vector2[] = [
      new THREE.Vector2(0.0, -0.042),
      new THREE.Vector2(0.014, -0.041),
      new THREE.Vector2(0.025, -0.036),
      new THREE.Vector2(0.027, -0.027),
      new THREE.Vector2(0.021, -0.019),
      new THREE.Vector2(0.0145, -0.013),
      new THREE.Vector2(0.0135, 0.02),
      new THREE.Vector2(0.014, 0.11),
      new THREE.Vector2(0.0165, 0.17),
      new THREE.Vector2(0.0225, 0.24),
      new THREE.Vector2(0.03, 0.31),
      new THREE.Vector2(0.036, 0.38),
      new THREE.Vector2(0.0385, 0.44),
      new THREE.Vector2(0.039, 0.505),
      new THREE.Vector2(0.0375, 0.54),
      new THREE.Vector2(0.031, 0.556),
      new THREE.Vector2(0.021, 0.559),
      new THREE.Vector2(0.012, 0.552),
      new THREE.Vector2(0.0, 0.549),
    ];
    const batBodyGeo = new THREE.LatheGeometry(profilePoints, 28);
    const batBodyMesh = new THREE.Mesh(batBodyGeo, ashWoodMat);
    batBodyMesh.castShadow = true;
    batBodyMesh.receiveShadow = true;

    // 2. Wrapped black athletic grip tape sleeve + raised grip ribs
    const gripSleeveGeo = new THREE.CylinderGeometry(0.0156, 0.0152, 0.165, 24);
    const gripSleeveMesh = new THREE.Mesh(gripSleeveGeo, gripTapeMat);
    gripSleeveMesh.position.y = 0.07;
    gripSleeveMesh.castShadow = true;

    const gripRibGeo = new THREE.TorusGeometry(0.0156, 0.0014, 8, 22);
    const gripRibMeshes: THREE.Mesh[] = [];
    for (let i = 0; i < 8; i++) {
      const rib = new THREE.Mesh(gripRibGeo, gripTapeMat);
      rib.position.y = 0.0 + i * 0.019;
      rib.rotation.x = Math.PI / 2 + 0.18;
      gripRibMeshes.push(rib);
    }

    // 3. Classic slugger stripes between handle & sweet-spot barrel
    const stripeBottomGeo = new THREE.CylinderGeometry(0.0274, 0.0262, 0.012, 24);
    const stripeBottomMesh = new THREE.Mesh(stripeBottomGeo, crimsonStripeMat);
    stripeBottomMesh.position.y = 0.282;

    const stripeGoldGeo = new THREE.CylinderGeometry(0.0296, 0.0288, 0.007, 24);
    const stripeGoldMesh = new THREE.Mesh(stripeGoldGeo, goldRingMat);
    stripeGoldMesh.position.y = 0.302;

    // 4. Brass weight badge on the bottom of the bat knob
    const knobCapGeo = new THREE.CylinderGeometry(0.013, 0.013, 0.003, 20);
    const knobCapMesh = new THREE.Mesh(knobCapGeo, goldRingMat);
    knobCapMesh.position.y = -0.0425;

    // 5. Swing trail swoosh ring aligned to baseball bat barrel sweet spot
    const trailGeo = new THREE.RingGeometry(0.22, 0.44, 20, 1, -0.7, 1.4);
    this.batTrailMesh = new THREE.Mesh(trailGeo, trailMat);
    this.batTrailMesh.position.set(0, 0.44, 0);
    this.batTrailMesh.rotation.x = Math.PI / 2;

    this.batGeos.push(
      batBodyGeo,
      gripSleeveGeo,
      gripRibGeo,
      stripeBottomGeo,
      stripeGoldGeo,
      knobCapGeo,
      trailGeo
    );

    this.batSwingPivot.add(
      batBodyMesh,
      gripSleeveMesh,
      ...gripRibMeshes,
      stripeBottomMesh,
      stripeGoldMesh,
      knobCapMesh,
      this.batTrailMesh
    );
    // Natural batter's ready stance angled cleanly across camera/player view
    this.batSwingPivot.rotation.set(-0.42, 0.25, -0.35);
    this.batGroup.add(this.batSwingPivot);
    this.batGroup.name = 'WoodenBaseballBat';
  }

  private buildChronoRewindMandala(): {
    outerMesh: THREE.Mesh;
    innerMesh: THREE.Mesh;
    portalOuter: THREE.Mesh;
    portalInner: THREE.Mesh;
    handOuter: THREE.Mesh;
    handInner: THREE.Mesh;
    sparks: THREE.Points;
    sparkBase: Float32Array;
  } {
    const outerTex = createTimeMandalaTexture('outer', 512);
    const innerTex = createTimeMandalaTexture('inner', 256);
    if (outerTex) this.mandalaTexs.push(outerTex);
    if (innerTex) this.mandalaTexs.push(innerTex);

    const outerMat = new THREE.MeshBasicMaterial({
      map: outerTex,
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const innerMat = new THREE.MeshBasicMaterial({
      map: innerTex,
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const portalOuterMat = outerMat.clone();
    const portalInnerMat = innerMat.clone();
    const handOuterMat = outerMat.clone();
    const handInnerMat = innerMat.clone();

    this.mandalaMats.push(
      outerMat,
      innerMat,
      portalOuterMat,
      portalInnerMat,
      handOuterMat,
      handInnerMat
    );

    const floorGeo = new THREE.PlaneGeometry(1.4, 1.4);
    const portalGeo = new THREE.PlaneGeometry(0.92, 0.92);
    const handGeo = new THREE.PlaneGeometry(0.3, 0.3);
    this.mandalaGeos.push(floorGeo, portalGeo, handGeo);

    // Horizontal ground/pedestal mandala under vessels
    const outerMesh = new THREE.Mesh(floorGeo, outerMat);
    outerMesh.rotation.x = -Math.PI / 2;
    outerMesh.position.y = 0.015;

    const innerMesh = new THREE.Mesh(floorGeo, innerMat);
    innerMesh.rotation.x = -Math.PI / 2;
    innerMesh.position.y = 0.025;

    // Vertical/angled Eldritch portal behind vessels
    const portalOuter = new THREE.Mesh(portalGeo, portalOuterMat);
    portalOuter.position.set(0, 0.24, -0.14);

    const portalInner = new THREE.Mesh(portalGeo, portalInnerMat);
    portalInner.position.set(0, 0.24, -0.13);

    // Swirling green Chrono Rewind sparks
    const sparkCount = 90;
    const sparkPos = new Float32Array(sparkCount * 3);
    const sparkBase = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.12 + Math.random() * 0.72;
      const y = -0.78 + Math.random() * 1.15;
      sparkBase[i * 3] = Math.cos(angle) * radius;
      sparkBase[i * 3 + 1] = y;
      sparkBase[i * 3 + 2] = Math.sin(angle) * radius * 0.65;
      sparkPos[i * 3] = sparkBase[i * 3];
      sparkPos[i * 3 + 1] = sparkBase[i * 3 + 1];
      sparkPos[i * 3 + 2] = sparkBase[i * 3 + 2];
    }
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    const sparkMat = new THREE.PointsMaterial({
      color: 0x52ffaa,
      size: 0.032,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mandalaGeos.push(sparkGeo);
    this.mandalaMats.push(sparkMat);
    const sparks = new THREE.Points(sparkGeo, sparkMat);
    sparks.frustumCulled = false;

    this.mandalaGroup.add(outerMesh, innerMesh, portalOuter, portalInner, sparks);

    // Caster wrist/cursor Eye of Agamotto ring
    const handOuter = new THREE.Mesh(handGeo, handOuterMat);
    const handInner = new THREE.Mesh(handGeo, handInnerMat);
    handInner.position.z = 0.006;
    this.handMandalaGroup.add(handOuter, handInner);

    return {
      outerMesh,
      innerMesh,
      portalOuter,
      portalInner,
      handOuter,
      handInner,
      sparks,
      sparkBase,
    };
  }

  private buildDustBurst(): void {
    const count = 48;
    const pos = new Float32Array(count * 3);
    this.dustVelocities = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xe6d4be,
      size: 0.025,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.mandalaGeos.push(geo);
    this.mandalaMats.push(mat);
    this.dustPoints = new THREE.Points(geo, mat);
    this.dustPoints.visible = false;
    this.dustPoints.frustumCulled = false;
    this.group.add(this.dustPoints);
  }

  public setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  public getStatus(): SmashSystemStatus {
    const smashedCount = this.vessels.filter((v) => !v.intact).length;
    const crackedCount = this.vessels.filter(
      (v) => v.intact && v.hits > 0
    ).length;
    const focused =
      this.focusedVesselIndex >= 0
        ? this.vessels[this.focusedVesselIndex] ?? null
        : null;
    return {
      smashMode: this.smashMode,
      smashScope: this.smashScope,
      phase: this.phase,
      totalVessels: this.vessels.length,
      crackedCount,
      smashedCount,
      isRestoring: this.phase === 'restoring',
      focusedVesselName: focused?.intact ? focused.item.name : null,
      focusedVesselHits: focused?.intact ? focused.hits : 0,
      focusedVesselMaxHits: focused?.intact ? focused.maxHits : 2,
    };
  }

  public isSmashMode(): boolean {
    return this.smashMode;
  }

  public getScope(): SmashScope {
    return this.smashScope;
  }

  public getSmashedItemIds(): string[] {
    return this.vessels.filter((v) => !v.intact).map((v) => v.item.id);
  }

  public focusVesselById(id: string): boolean {
    if (!this.smashMode) return false;
    const idx = this.vessels.findIndex((v) => v.item.id === id && v.intact);
    if (idx < 0) return false;
    if (idx !== this.focusedVesselIndex) {
      this.focusedVesselIndex = idx;
      this.syncFocusRingVisual();
      this.callbacks.onStateChanged?.();
    }
    return true;
  }

  public getCrackedCount(): number {
    return this.vessels.filter((v) => v.intact && v.hits > 0).length;
  }

  public getSmashedCount(): number {
    return this.vessels.filter((v) => !v.intact).length;
  }

  public getIntactCount(): number {
    return this.vessels.filter((v) => v.intact).length;
  }

  public isRestoring(): boolean {
    return this.phase === 'restoring';
  }

  /**
   * Builds branching 3D fracture lines wrapped onto a vessel's actual outer
   * geometry rings around the impact angle & height so Hit 1 shows crisp visible cracks.
   */
  private buildCrackLinesForImpact(
    vessel: SmashableVesselEntry,
    impactTheta: number,
    impactHeightNorm: number,
    impactLocalX = 0,
    impactLocalY = 0.145
  ): void {
    if (vessel.crackLineGeo) {
      vessel.crackLineGeo.dispose();
      vessel.crackLineGeo = null;
    }
    if (vessel.crackHighlightGeo) {
      vessel.crackHighlightGeo.dispose();
      vessel.crackHighlightGeo = null;
    }
    vessel.crackGroup.clear();

    if (vessel.nameGeometry) {
      const C = vessel.nameGeometry.cols;
      const R = vessel.nameGeometry.rows;
      const posAttr = vessel.nameGeometry.geometry.attributes.position;
      if (!posAttr || C < 4 || R < 4) return;
      const pos = posAttr.array as Float32Array;
      const yOffset = vessel.mesh.position.y;

      const centerCol = Math.round(
        THREE.MathUtils.clamp((impactLocalX / 0.52 + 0.5) * (C - 1), 6, C - 7)
      );
      const centerRow = Math.round(
        THREE.MathUtils.clamp(((impactLocalY - yOffset) / 0.26 + 0.5) * (R - 1), 4, R - 5)
      );

      const mainVerts: number[] = [];
      const hiVerts: number[] = [];

      const samplePlaque = (cFloat: number, rFloat: number, zOff: number): [number, number, number] => {
        const cc = Math.round(THREE.MathUtils.clamp(cFloat, 0, C - 1));
        const rr = Math.round(THREE.MathUtils.clamp(rFloat, 0, R - 1));
        const idx = (rr * C + cc) * 3;
        return [pos[idx], pos[idx + 1] + yOffset, pos[idx + 2] + zOff];
      };

      const addPlaqueCrack = (dc: number, dr: number, steps: number, seed: number) => {
        let curC = centerCol;
        let curR = centerRow;
        for (let s = 0; s < steps; s++) {
          const zig = Math.sin((s + 1) * 2.1 + seed * 3.1) * 1.4;
          const nextC = THREE.MathUtils.clamp(curC + dc + zig, 1, C - 2);
          const nextR = THREE.MathUtils.clamp(curR + dr - zig * 0.4, 1, R - 2);
          const [x0, y0, z0] = samplePlaque(curC, curR, 0.0028);
          const [x1, y1, z1] = samplePlaque(nextC, nextR, 0.0028);
          mainVerts.push(x0, y0, z0, x1, y1, z1);

          const [hx0, hy0, hz0] = samplePlaque(curC + 0.8, curR + 0.4, 0.0034);
          const [hx1, hy1, hz1] = samplePlaque(nextC + 0.8, nextR + 0.4, 0.0034);
          hiVerts.push(hx0, hy0, hz0, hx1, hy1, hz1);

          curC = nextC;
          curR = nextR;
        }
      };

      const branches: Array<[number, number, number]> = [
        [7.5, 2.8, 7],
        [-7.5, 2.2, 7],
        [4.5, -4.2, 6],
        [-5.2, -3.6, 6],
        [1.2, 5.2, 5],
        [-1.8, -5.0, 5],
      ];
      branches.forEach(([dc, dr, steps], idx) => addPlaqueCrack(dc, dr, steps, idx + 1));

      const mainGeo = new THREE.BufferGeometry();
      mainGeo.setAttribute('position', new THREE.Float32BufferAttribute(mainVerts, 3));
      const hiGeo = new THREE.BufferGeometry();
      hiGeo.setAttribute('position', new THREE.Float32BufferAttribute(hiVerts, 3));
      vessel.crackLineGeo = mainGeo;
      vessel.crackHighlightGeo = hiGeo;
      vessel.crackGroup.add(
        new THREE.LineSegments(mainGeo, vessel.crackMaterial),
        new THREE.LineSegments(hiGeo, vessel.crackHighlightMat)
      );
      return;
    }

    if (!vessel.clayGeometry) return;
    const R = vessel.clayGeometry.ringCount;
    const outer = vessel.item.profile.outerRadii;
    const heights = vessel.item.profile.heights;
    if (R < 4 || outer.length < R || heights.length < R) return;

    const minH = heights[0];
    const maxH = heights[R - 1];
    const hSpan = Math.max(0.05, maxH - minH);
    const centerRing = Math.round(
      THREE.MathUtils.clamp(impactHeightNorm, 0.16, 0.86) * (R - 1)
    );

    const samplePoint = (
      ringFloat: number,
      theta: number,
      offsetOut: number
    ): [number, number, number] => {
      const rClamped = THREE.MathUtils.clamp(ringFloat, 0, R - 1);
      const r0 = Math.floor(rClamped);
      const r1 = Math.min(R - 1, r0 + 1);
      const f = rClamped - r0;
      const rad = THREE.MathUtils.lerp(outer[r0], outer[r1], f) + offsetOut;
      const y = THREE.MathUtils.lerp(heights[r0], heights[r1], f);
      return [Math.cos(theta) * rad, y, Math.sin(theta) * rad];
    };

    const mainVerts: number[] = [];
    const hiVerts: number[] = [];

    const addCrackPolyline = (
      startRing: number,
      startTheta: number,
      dRingPerStep: number,
      dThetaPerStep: number,
      steps: number,
      seed: number
    ) => {
      let curR = startRing;
      let curT = startTheta;
      for (let s = 0; s < steps; s++) {
        const nextR = THREE.MathUtils.clamp(
          curR + dRingPerStep,
          0.5,
          R - 1.2
        );
        const zig = Math.sin((s + 1) * 2.3 + seed * 3.7) * 0.095;
        const nextT = curT + dThetaPerStep + zig;

        const [x0, y0, z0] = samplePoint(curR, curT, 0.0026);
        const [x1, y1, z1] = samplePoint(nextR, nextT, 0.0026);
        mainVerts.push(x0, y0, z0, x1, y1, z1);

        // Micro-offset highlight fissure right beside main crack for contrast on dark glazes
        const [hx0, hy0, hz0] = samplePoint(curR, curT + 0.014, 0.003);
        const [hx1, hy1, hz1] = samplePoint(nextR, nextT + 0.014, 0.003);
        hiVerts.push(hx0, hy0, hz0, hx1, hy1, hz1);

        curR = nextR;
        curT = nextT;
        if (nextR <= 0.51 || nextR >= R - 1.21) break;
      }
    };

    // Primary starburst branches radiating from impact epicenter
    const branchSpecs: Array<[number, number, number]> = [
      [1.75, 0.05, 8],
      [-1.7, -0.06, 7],
      [0.85, 0.22, 6],
      [-0.75, -0.24, 6],
      [1.2, -0.19, 6],
      [-0.2, 0.28, 5],
    ];
    branchSpecs.forEach(([dr, dt, steps], bIdx) => {
      addCrackPolyline(centerRing, impactTheta, dr, dt, steps, bIdx + 1);
    });

    // Rim fracture notch running down from lip
    addCrackPolyline(R - 1, impactTheta + 0.18, -1.65, -0.07, 5, 11);

    // Subtle secondary opposite-wall stress crack from vibration
    const backTheta = impactTheta + Math.PI * 0.72;
    addCrackPolyline(
      Math.max(2, Math.floor(R * 0.58)),
      backTheta,
      -1.4,
      0.08,
      5,
      19
    );

    // Impact epicenter micro-chip cross
    const centerY = heights[centerRing] ?? minH + hSpan * 0.5;
    if (Number.isFinite(centerY)) {
      const mainGeo = new THREE.BufferGeometry();
      mainGeo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(mainVerts, 3)
      );
      const hiGeo = new THREE.BufferGeometry();
      hiGeo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(hiVerts, 3)
      );

      vessel.crackLineGeo = mainGeo;
      vessel.crackHighlightGeo = hiGeo;

      const mainLines = new THREE.LineSegments(mainGeo, vessel.crackMaterial);
      const hiLines = new THREE.LineSegments(hiGeo, vessel.crackHighlightMat);
      vessel.crackGroup.add(mainLines, hiLines);
    }
  }

  /**
   * Enters Smash Mode showcasing either ONLY the selected pottery ('single')
   * or ALL done pottery vessels ('all') with safe spacing.
   */
  public enterSmashMode(
    items: SavedPotteryItem[],
    selectedId: string | null,
    buildMeshFn: (item: SavedPotteryItem) => {
      mesh: THREE.Mesh;
      clayGeometry: ClayGeometry | null;
      nameGeometry?: ClayNameGeometry | null;
      customMaterial: THREE.Material | null;
      customTexture: THREE.Texture | null;
    },
    scope: SmashScope = items.length > 1 ? 'all' : 'single'
  ): void {
    this.clearVessels();
    this.smashMode = true;
    this.smashScope = scope;
    this.phase = 'smashing';
    this.sweepAllTimer = -1;
    this.sweepPassSwitched = false;
    this.restoreProgress = 0;
    this.focusedVesselIndex = -1;
    this.hasExternalFocusThisFrame = false;

    if (items.length === 0) {
      this.batGroup.visible = false;
      this.focusRingGroup.visible = false;
      this.callbacks.onStateChanged?.();
      return;
    }

    const selectedIdx = Math.max(
      0,
      items.findIndex((it) => it.id === selectedId)
    );
    const vesselRadii = items.map((it) =>
      it.kind === 'name'
        ? 0.28
        : Math.max(0.075, (it.measurements.maxWidthCm / 100) * 0.55)
    );
    const layouts = computeGalleryLayoutPositions(
      items.length,
      selectedIdx,
      vesselRadii
    );

    // Keep total shard geometry lightweight even when user has many saved pots
    const bandsY = items.length <= 2 ? 4 : 3;
    const sectorsTheta = items.length === 1 ? 7 : items.length <= 3 ? 6 : 5;

    items.forEach((item, idx) => {
      const layout = layouts[idx] ?? { x: 0, y: 0, z: 0, scale: 0.85 };
      const built = buildMeshFn(item);

      const vesselRoot = new THREE.Group();
      vesselRoot.name = `SmashVessel_${item.name}`;
      vesselRoot.position.set(layout.x, layout.y, layout.z);
      vesselRoot.scale.setScalar(layout.scale);
      vesselRoot.add(built.mesh);

      const crackGroup = new THREE.Group();
      crackGroup.visible = false;
      vesselRoot.add(crackGroup);

      const crackMaterial = new THREE.LineBasicMaterial({
        color: 0x1b100b,
        transparent: true,
        opacity: 0.96,
      });
      const crackHighlightMat = new THREE.LineBasicMaterial({
        color: 0xffa66b,
        transparent: true,
        opacity: 0.58,
      });

      // Add grounded companion plinth for any offset or multi-pot vessel so nothing floats or touches
      let plinthGroup: THREE.Group | null = null;
      if (
        Math.abs(layout.x) > 0.03 ||
        Math.abs(layout.z) > 0.03 ||
        Math.abs(layout.y) > 0.01
      ) {
        plinthGroup = new THREE.Group();
        const top = new THREE.Mesh(this.plinthGeo, this.plinthWoodMat);
        top.position.y = layout.y - 0.012;
        top.receiveShadow = true;
        top.castShadow = true;

        const colHeight = Math.max(0.2, layout.y - FLOOR_LOCAL_Y - 0.02);
        const col = new THREE.Mesh(this.plinthColGeo, this.plinthStoneMat);
        col.scale.y = colHeight;
        col.position.y = FLOOR_LOCAL_Y + colHeight * 0.5;
        col.receiveShadow = true;
        col.castShadow = true;

        plinthGroup.add(top, col);
        this.group.add(plinthGroup);
        plinthGroup.position.set(layout.x, 0, layout.z);
        plinthGroup.scale.set(layout.scale, 1, layout.scale);
      }

      // Build ceramic shards from this vessel's actual ClayGeometry & glaze/paint
      const shardMat = (built.mesh.material as THREE.MeshPhysicalMaterial).clone();
      shardMat.side = THREE.DoubleSide;

      const specs = built.nameGeometry
        ? buildShardGeometriesFromName(
            built.nameGeometry,
            3,
            items.length <= 2 ? 6 : 5,
            built.mesh.position.y
          )
        : built.clayGeometry
          ? buildShardGeometriesFromClay(
              built.clayGeometry,
              bandsY,
              sectorsTheta
            )
          : [];
      const shardShadows = items.length === 1;
      const shards: ActiveShard[] = specs.map((spec, sIdx) => {
        const sMesh = new THREE.Mesh(spec.geometry, shardMat);
        sMesh.visible = false;
        sMesh.castShadow = shardShadows;
        sMesh.receiveShadow = shardShadows;
        sMesh.position.copy(spec.centroid);
        vesselRoot.add(sMesh);

        return {
          mesh: sMesh,
          geometry: spec.geometry,
          homePos: spec.centroid.clone(),
          homeQuat: new THREE.Quaternion(),
          velocity: new THREE.Vector3(),
          angVel: new THREE.Vector3(),
          radialDir: spec.radialDir.clone(),
          approxRadius: spec.approxRadius,
          settled: false,
          frames: [],
          delayOffset: ((sIdx % 5) / 5) * 0.14,
        };
      });

      const isName = item.kind === 'name' && Boolean(built.nameGeometry);
      const vesselHeight = isName
        ? 0.28
        : Math.max(0.1, item.measurements.heightCm / 100);
      const vesselRadius = isName
        ? 0.27
        : Math.max(0.07, (item.measurements.maxWidthCm / 100) * 0.55);
      const centerLocal = new THREE.Vector3(
        layout.x,
        layout.y + vesselHeight * 0.5 * layout.scale,
        layout.z
      );

      this.group.add(vesselRoot);
      this.vessels.push({
        item,
        root: vesselRoot,
        mesh: built.mesh,
        clayGeometry: built.clayGeometry,
        nameGeometry: built.nameGeometry ?? null,
        customMaterial: built.customMaterial,
        customTexture: built.customTexture,
        shardMaterial: shardMat,
        crackGroup,
        crackLineGeo: null,
        crackHighlightGeo: null,
        crackMaterial,
        crackHighlightMat,
        plinthGroup,
        layout,
        centerLocal,
        hitRadius: Math.max(0.095, vesselRadius * layout.scale + 0.042),
        hits: 0,
        maxHits: 2,
        hitCooldown: 0,
        recoilAngle: new THREE.Vector2(),
        recoilVel: new THREE.Vector2(),
        intact: true,
        shards,
        restoreDelay: Math.min(0.28, idx * 0.05),
      });
    });

    this.focusedVesselIndex = selectedIdx < this.vessels.length ? selectedIdx : 0;
    this.syncFocusRingVisual();

    this.batTargetLocal.set(0.25, 0.2, 0.34);
    this.batCurrentLocal.copy(this.batTargetLocal);
    this.batGroup.position.copy(this.batCurrentLocal);
    this.batGroup.visible = true;
    this.hasPrevBatTip = false;
    this.mandalaGroup.visible = false;
    this.handMandalaGroup.visible = false;
    this.callbacks.onStateChanged?.();
  }

  public exitSmashMode(): void {
    this.smashMode = false;
    this.phase = 'idle';
    this.sweepAllTimer = -1;
    this.sweepPassSwitched = false;
    this.batGroup.visible = false;
    this.focusRingGroup.visible = false;
    this.mandalaGroup.visible = false;
    this.handMandalaGroup.visible = false;
    this.hasPrevBatTip = false;
    this.focusedVesselIndex = -1;
    this.clearVessels();
    this.callbacks.onStateChanged?.();
  }

  /**
   * Computes hand focus across intact/cracked pottery using normalized screen
   * coordinates (webcam calibrated hand or desktop mouse pointer).
   */
  public updateFocusFromNDC(
    ndcX: number,
    ndcY: number,
    camera: THREE.Camera
  ): SmashableVesselEntry | null {
    if (!this.smashMode || this.phase === 'restoring' || this.vessels.length === 0) {
      return null;
    }
    this.hasExternalFocusThisFrame = true;
    this.group.updateMatrixWorld();

    let bestIdx = -1;
    let bestScore = Infinity;

    for (let i = 0; i < this.vessels.length; i++) {
      const v = this.vessels[i];
      if (!v.intact) continue;
      this._projVec.copy(v.centerLocal).applyMatrix4(this.group.matrixWorld).project(camera);
      if (this._projVec.z > 1) continue;
      const dist = Math.hypot(
        (this._projVec.x - ndcX) * 0.88,
        this._projVec.y - ndcY
      );
      // Gentle sticky hysteresis avoids flickering focus between neighboring pots
      const stickyBonus = i === this.focusedVesselIndex ? -0.045 : 0;
      if (dist + stickyBonus < bestScore && dist < 0.72) {
        bestScore = dist + stickyBonus;
        bestIdx = i;
      }
    }

    if (bestIdx !== this.focusedVesselIndex) {
      this.focusedVesselIndex = bestIdx;
      this.syncFocusRingVisual();
      this.callbacks.onStateChanged?.();
    }
    return bestIdx >= 0 ? this.vessels[bestIdx] : null;
  }

  /**
   * Computes hand/controller focus in 3D world space for Meta Quest VR:
   * prioritizes direct proximity + optional forward aim ray alignment.
   */
  public updateFocusFromWorldPoint(
    worldPoint: THREE.Vector3,
    worldAimDir?: THREE.Vector3
  ): SmashableVesselEntry | null {
    if (!this.smashMode || this.phase === 'restoring' || this.vessels.length === 0) {
      return null;
    }
    this.hasExternalFocusThisFrame = true;
    this.group.updateMatrixWorld();
    this._localRayOrigin.copy(worldPoint);
    this.group.worldToLocal(this._localRayOrigin);

    if (worldAimDir) {
      this._localRayDir.copy(worldAimDir).add(worldPoint);
      this.group.worldToLocal(this._localRayDir);
      this._localRayDir.sub(this._localRayOrigin).normalize();
    }

    let bestIdx = -1;
    let bestScore = Infinity;

    for (let i = 0; i < this.vessels.length; i++) {
      const v = this.vessels[i];
      if (!v.intact) continue;
      const d = this._localRayOrigin.distanceTo(v.centerLocal);
      let score = d;
      if (worldAimDir) {
        _tmpVec3.copy(v.centerLocal).sub(this._localRayOrigin);
        const along = _tmpVec3.dot(this._localRayDir);
        if (along > -0.15) {
          const perpSq = Math.max(0, _tmpVec3.lengthSq() - along * along);
          const perp = Math.sqrt(perpSq);
          // Blend direct reach distance with ray aim perpendicular distance
          score = Math.min(d, perp * 1.45 + 0.08 * Math.max(0, along));
        }
      }
      const stickyBonus = i === this.focusedVesselIndex ? -0.035 : 0;
      if (score + stickyBonus < bestScore && score < 0.75) {
        bestScore = score + stickyBonus;
        bestIdx = i;
      }
    }

    if (bestIdx !== this.focusedVesselIndex) {
      this.focusedVesselIndex = bestIdx;
      this.syncFocusRingVisual();
      this.callbacks.onStateChanged?.();
    }
    return bestIdx >= 0 ? this.vessels[bestIdx] : null;
  }

  /**
   * Moves the 3D bat using screen NDC pointer coordinates (mouse or webcam hand).
   */
  public aimBatFromNDC(ndcX: number, ndcY: number, camera: THREE.Camera): void {
    if (!this.smashMode || this.phase === 'restoring' || this.sweepAllTimer >= 0) {
      return;
    }
    this.updateFocusFromNDC(ndcX, ndcY, camera);
    this.group.updateMatrixWorld();

    const focused =
      this.focusedVesselIndex >= 0
        ? this.vessels[this.focusedVesselIndex] ?? null
        : null;
    const planeZ = focused && focused.intact ? focused.layout.z + 0.14 : 0.18;
    const planeY = focused && focused.intact ? focused.centerLocal.y : 0.16;

    this._planeCenter.set(0, planeY, planeZ).applyMatrix4(this.group.matrixWorld);
    camera.getWorldDirection(this._planeNormal).negate();
    this._plane.setFromNormalAndCoplanarPoint(this._planeNormal, this._planeCenter);

    this._raycaster.setFromCamera(
      _tmpVec2.set(ndcX, ndcY) as unknown as THREE.Vector2,
      camera
    );
    if (this._raycaster.ray.intersectPlane(this._plane, this._planeHit)) {
      this.group.worldToLocal(this._planeHit);
      this.batTargetLocal.set(
        THREE.MathUtils.clamp(this._planeHit.x, -1.25, 1.25),
        THREE.MathUtils.clamp(this._planeHit.y, -0.25, 0.72),
        THREE.MathUtils.clamp(this._planeHit.z + 0.05, -0.48, 0.55)
      );
    }
  }

  /**
   * Moves the 3D bat from a world-space point & optional VR hand/controller aim ray.
   * Supports both 1:1 close-range physical swings and comfortable seated ray reach.
   */
  public aimBatFromWorldPoint(
    worldPoint: THREE.Vector3,
    worldAimDir?: THREE.Vector3
  ): void {
    if (!this.smashMode || this.phase === 'restoring' || this.sweepAllTimer >= 0) {
      return;
    }
    const focused = this.updateFocusFromWorldPoint(worldPoint, worldAimDir);
    this._tmpWorldToLocal(worldPoint, this._planeHit);

    const inDirectReach =
      this._planeHit.lengthSq() < 0.72 * 0.72 && this._planeHit.z > -0.45;
    if (inDirectReach || !worldAimDir) {
      this.batTargetLocal.set(
        THREE.MathUtils.clamp(this._planeHit.x, -1.25, 1.25),
        THREE.MathUtils.clamp(this._planeHit.y, -0.32, 0.78),
        THREE.MathUtils.clamp(this._planeHit.z, -0.48, 0.58)
      );
      return;
    }

    // Ray-extend smoothly toward the focused vessel plane when sitting slightly back
    const targetZ = focused && focused.intact ? focused.layout.z + 0.12 : 0.14;
    const dz = this._localRayDir.z;
    if (Math.abs(dz) > 0.08) {
      const t = (targetZ - this._localRayOrigin.z) / dz;
      if (t > 0.05 && t < 3.5) {
        this._planeHit
          .copy(this._localRayOrigin)
          .addScaledVector(this._localRayDir, t);
        this.batTargetLocal.set(
          THREE.MathUtils.clamp(this._planeHit.x, -1.25, 1.25),
          THREE.MathUtils.clamp(this._planeHit.y, -0.32, 0.78),
          THREE.MathUtils.clamp(this._planeHit.z, -0.48, 0.58)
        );
      }
    }
  }

  private _tmpWorldToLocal(worldPt: THREE.Vector3, out: THREE.Vector3): void {
    out.copy(worldPt);
    this.group.worldToLocal(out);
  }

  /**
   * Triggers a bat swing impulse toward focused vessel or current aim.
   * Deals 1 progressive hit per swing (Hit 1 = visible cracks, Hit 2 = shatter).
   */
  public triggerBatSwing(swipeDx = -1, focusStrike = false): void {
    if (!this.smashMode || this.phase === 'restoring') return;
    this.swingDirSign = swipeDx >= 0 ? 1 : -1;
    this.swingTimer = 0.24;
    this.callbacks.onBatSwing?.(0.95);

    this._swingVelLocal.set(this.swingDirSign * 3.6, 0.55, -2.4);

    if (focusStrike && this.focusedVesselIndex >= 0) {
      const focused = this.vessels[this.focusedVesselIndex] ?? null;
      if (focused && focused.intact) {
        this.batTargetLocal.set(
          focused.centerLocal.x,
          focused.centerLocal.y,
          focused.centerLocal.z + focused.hitRadius * 0.85
        );
        this.batCurrentLocal.lerp(this.batTargetLocal, 0.78);
        if (focused.hitCooldown <= 0) {
          this.applyStrikeToVessel(
            focused,
            this.batCurrentLocal,
            this._swingVelLocal,
            true
          );
        }
        return;
      }
    }

    this.batCurrentLocal.lerp(this.batTargetLocal, 0.6);
    this.checkCollisionsAroundPoint(
      this.batCurrentLocal,
      0.24,
      this._swingVelLocal
    );
  }

  /**
   * Performs a dramatic two-pass sweeping bat strike across ALL done pottery vessels:
   * Pass 1 cracks all intact pots left-to-right, Pass 2 sweeps back right-to-left shattering all!
   */
  public smashAllWithBatSweep(): void {
    if (!this.smashMode || this.phase === 'restoring') return;
    if (this.getIntactCount() === 0) return;

    this.sweepAllTimer = 0;
    this.sweepPassSwitched = false;
    this.sweepAllDuration = 0.86;
    this.swingTimer = this.sweepAllDuration;
    this.swingDirSign = 1;
    this.callbacks.onBatSwing?.(1.0);
  }

  /**
   * Initiates Chrono Rewind reversal:
   * glows emerald geometric mandalas and plays back every shard's recorded trajectory
   * in reverse until all smashed or cracked vessels snap cleanly back intact.
   */
  public startRestore(): boolean {
    if (this.phase === 'restoring') return false;
    const damaged = this.vessels.filter((v) => !v.intact || v.hits > 0);
    if (damaged.length === 0) return false;

    this.phase = 'restoring';
    this.restoreProgress = 0;
    this.sweepAllTimer = -1;
    this.sweepPassSwitched = false;
    this.focusRingGroup.visible = false;
    this.mandalaGroup.visible = true;
    this.handMandalaGroup.visible = true;
    this.callbacks.onTimeRestoreStart?.();
    this.callbacks.onStateChanged?.();
    return true;
  }

  public update(dt: number, camera?: THREE.Camera): void {
    this.mandalaClock += dt;

    if (!this.smashMode) return;

    // 0. Decrement per-vessel hit cooldowns & step damped impact wobble on cracked pots
    for (const v of this.vessels) {
      if (v.hitCooldown > 0) {
        v.hitCooldown = Math.max(0, v.hitCooldown - dt);
      }
      if (v.intact) {
        if (
          v.recoilAngle.lengthSq() > 1e-6 ||
          v.recoilVel.lengthSq() > 1e-6
        ) {
          const k = 190;
          const damp = 14;
          v.recoilVel.x += (-k * v.recoilAngle.x - damp * v.recoilVel.x) * dt;
          v.recoilVel.y += (-k * v.recoilAngle.y - damp * v.recoilVel.y) * dt;
          v.recoilAngle.addScaledVector(v.recoilVel, dt);
          v.root.rotation.set(v.recoilAngle.x, 0, v.recoilAngle.y);
        }
      }
    }

    // Update focus reticle animation / fallback if cursor didn't update focus this frame
    if (
      !this.hasExternalFocusThisFrame &&
      (this.focusedVesselIndex < 0 || !this.vessels[this.focusedVesselIndex]?.intact)
    ) {
      this.focusedVesselIndex = this.vessels.findIndex((v) => v.intact);
    }
    this.hasExternalFocusThisFrame = false;
    this.syncFocusRingVisual();

    // 1. Update dramatic two-pass "Smash All" sweep arc if active
    if (this.sweepAllTimer >= 0) {
      this.sweepAllTimer += dt;
      const t = Math.min(1, this.sweepAllTimer / this.sweepAllDuration);

      // Find full horizontal span of all vessels so wide layouts sweep cleanly end-to-end
      let minX = -0.88;
      let maxX = 0.88;
      for (const v of this.vessels) {
        minX = Math.min(minX, v.layout.x - 0.16);
        maxX = Math.max(maxX, v.layout.x + 0.16);
      }

      if (t < 0.45) {
        // Pass 1: Left -> Right (cracks every intact vessel)
        const p1 = t / 0.45;
        const sweepX = THREE.MathUtils.lerp(minX, maxX, p1);
        const sweepY = 0.14 + Math.sin(p1 * Math.PI) * 0.08;
        const sweepZ = 0.08 + Math.sin(p1 * Math.PI) * 0.12;
        this.batTargetLocal.set(sweepX, sweepY, sweepZ);
        this.batCurrentLocal.copy(this.batTargetLocal);
        this.swingDirSign = 1;
        this._swingVelLocal.set(5.4, 0.65, -1.8);
        this.checkCollisionsAroundPoint(
          this.batCurrentLocal,
          0.32,
          this._swingVelLocal
        );
      } else {
        // Turnaround: guarantee all intact vessels have at least 1 crack before Pass 2 shatters
        if (!this.sweepPassSwitched) {
          this.sweepPassSwitched = true;
          let crackedHere = 0;
          for (const v of this.vessels) {
            if (v.intact && v.hits === 0) {
              this.crackVessel(v, v.centerLocal, this._swingVelLocal, false);
              crackedHere++;
            }
            v.hitCooldown = 0;
          }
          if (crackedHere > 0) {
            this.callbacks.onCeramicCrack?.('All Vessels', this.getCrackedCount());
            this.callbacks.onStateChanged?.();
          }
          this.callbacks.onBatSwing?.(1.0);
        }

        // Pass 2: Right -> Left (shatters every cracked vessel!)
        const p2 = (t - 0.45) / 0.55;
        const sweepX = THREE.MathUtils.lerp(maxX, minX, p2);
        const sweepY = 0.15 + Math.sin(p2 * Math.PI) * 0.08;
        const sweepZ = 0.08 + Math.sin(p2 * Math.PI) * 0.12;
        this.batTargetLocal.set(sweepX, sweepY, sweepZ);
        this.batCurrentLocal.copy(this.batTargetLocal);
        this.swingDirSign = -1;
        this._swingVelLocal.set(-5.6, 0.7, -1.9);
        this.checkCollisionsAroundPoint(
          this.batCurrentLocal,
          0.32,
          this._swingVelLocal
        );
      }

      if (t >= 1) {
        // Follow-through ensures any edge vessel is cleanly shattered at sweep completion
        let newlyShattered = 0;
        for (const v of this.vessels) {
          if (v.intact) {
            this.shatterVessel(v, v.centerLocal, this._swingVelLocal, false);
            newlyShattered++;
          }
        }
        if (newlyShattered > 0) {
          this.callbacks.onCeramicShatter?.(newlyShattered);
          this.callbacks.onStateChanged?.();
        }
        this.sweepAllTimer = -1;
        this.sweepPassSwitched = false;
      }
    }

    // 2. Smoothly move bat & animate swing arc + trail
    if (this.batGroup.visible) {
      const followRate = this.sweepAllTimer >= 0 ? 35 : 22;
      this.batCurrentLocal.lerp(
        this.batTargetLocal,
        1 - Math.exp(-followRate * dt)
      );
      this.batGroup.position.copy(this.batCurrentLocal);

      if (this.swingTimer > 0) {
        this.swingTimer = Math.max(0, this.swingTimer - dt);
        const swingNorm = 1 - Math.min(1, this.swingTimer / 0.24);
        const whip = Math.sin(swingNorm * Math.PI);
        this.batSwingPivot.rotation.set(
          -0.42 - whip * 0.85,
          0.25 + whip * 1.15 * this.swingDirSign,
          -0.35 - whip * 0.9 * this.swingDirSign
        );
        const trailMat = this.batTrailMesh.material as THREE.MeshBasicMaterial;
        trailMat.opacity = whip * 0.42;
      } else {
        this.batSwingPivot.rotation.x = THREE.MathUtils.damp(
          this.batSwingPivot.rotation.x,
          -0.42,
          12,
          dt
        );
        this.batSwingPivot.rotation.y = THREE.MathUtils.damp(
          this.batSwingPivot.rotation.y,
          0.25,
          12,
          dt
        );
        this.batSwingPivot.rotation.z = THREE.MathUtils.damp(
          this.batSwingPivot.rotation.z,
          -0.35,
          12,
          dt
        );
        const trailMat = this.batTrailMesh.material as THREE.MeshBasicMaterial;
        trailMat.opacity = THREE.MathUtils.damp(trailMat.opacity, 0, 14, dt);
      }

      // Continuous collision detection using baseball bat barrel sweet-spot world velocity
      this.batGroup.updateMatrixWorld();
      this._batTipWorld.set(0, 0.44, 0);
      this.batSwingPivot.localToWorld(this._batTipWorld);

      if (this.hasPrevBatTip && this.phase !== 'restoring' && this.sweepAllTimer < 0) {
        const speed =
          this._batTipWorld.distanceTo(this.prevBatTipWorld) /
          Math.max(0.004, dt);
        if (speed > 1.25 || this.swingTimer > 0) {
          this._batTipLocal.copy(this._batTipWorld);
          this.group.worldToLocal(this._batTipLocal);
          this._swingVelLocal
            .copy(this._batTipWorld)
            .sub(this.prevBatTipWorld)
            .divideScalar(Math.max(0.008, dt))
            .clampLength(1.6, 6.2);
          this.checkCollisionsAroundPoint(
            this._batTipLocal,
            0.2,
            this._swingVelLocal
          );
        }
      }
      this.prevBatTipWorld.copy(this._batTipWorld);
      this.hasPrevBatTip = true;
    }

    // 3. Step dust burst particles
    if (this.dustPoints && this.dustVelocities && this.dustLife > 0) {
      this.dustLife = Math.max(0, this.dustLife - dt);
      const posAttr = this.dustPoints.geometry.attributes
        .position as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      for (let i = 0; i < arr.length / 3; i++) {
        this.dustVelocities[i * 3 + 1] -= 4.5 * dt;
        arr[i * 3] += this.dustVelocities[i * 3] * dt;
        arr[i * 3 + 1] += this.dustVelocities[i * 3 + 1] * dt;
        arr[i * 3 + 2] += this.dustVelocities[i * 3 + 2] * dt;
      }
      posAttr.needsUpdate = true;
      (this.dustPoints.material as THREE.PointsMaterial).opacity =
        (this.dustLife / 0.55) * 0.72;
      if (this.dustLife <= 0) {
        this.dustPoints.visible = false;
      }
    }

    // 4. Step forward shard physics OR reverse Chrono Rewind time travel
    if (this.phase === 'restoring') {
      this.updateTimeReversal(dt, camera);
    } else {
      this.updateShardPhysics(dt);
    }
  }

  private syncFocusRingVisual(): void {
    const focused =
      this.focusedVesselIndex >= 0
        ? this.vessels[this.focusedVesselIndex] ?? null
        : null;
    if (!this.smashMode || this.phase === 'restoring' || !focused || !focused.intact) {
      this.focusRingGroup.visible = false;
      return;
    }

    this.focusRingGroup.visible = true;
    this.focusRingGroup.position.set(
      focused.layout.x,
      focused.layout.y + 0.008,
      focused.layout.z
    );
    const scaleBase = Math.max(0.65, focused.layout.scale);
    const pulse =
      focused.hits > 0
        ? 1 + Math.sin(this.mandalaClock * 8.5) * 0.065
        : 1 + Math.sin(this.mandalaClock * 3.5) * 0.03;
    this.focusRingGroup.scale.setScalar(scaleBase * pulse);
    this.focusRingInner.rotation.z =
      this.mandalaClock * (focused.hits > 0 ? 2.6 : 1.1);

    const outerMat = this.focusRingOuter.material as THREE.MeshBasicMaterial;
    const innerMat = this.focusRingInner.material as THREE.MeshBasicMaterial;
    if (focused.hits > 0) {
      // Cracked (1/2) -> urgent fiery orange-red focus ring
      outerMat.color.setHex(0xff5a2c);
      innerMat.color.setHex(0xffd2a6);
      outerMat.opacity = 0.94;
    } else {
      // Intact (0/2) -> warm sunlit gold target ring
      outerMat.color.setHex(0xffc857);
      innerMat.color.setHex(0xffffff);
      outerMat.opacity = 0.82;
    }
  }

  private checkCollisionsAroundPoint(
    localPt: THREE.Vector3,
    batRadius: number,
    swingVel: THREE.Vector3
  ): number {
    let newlyCracked = 0;
    let newlyShattered = 0;
    let lastCrackedName = '';

    for (const v of this.vessels) {
      if (!v.intact || v.hitCooldown > 0) continue;
      const dist = localPt.distanceTo(v.centerLocal);
      if (dist <= v.hitRadius + batRadius) {
        const result = this.applyStrikeToVessel(v, localPt, swingVel, false);
        if (result === 'cracked') {
          newlyCracked++;
          lastCrackedName = v.item.name;
        } else if (result === 'shattered') {
          newlyShattered++;
        }
      }
    }

    if (newlyCracked > 0) {
      this.callbacks.onCeramicCrack?.(
        newlyCracked > 1 ? `${newlyCracked} vessels` : lastCrackedName,
        this.getCrackedCount()
      );
    }
    if (newlyShattered > 0) {
      this.phase = 'smashed';
      this.callbacks.onCeramicShatter?.(newlyShattered);
    }
    if (newlyCracked > 0 || newlyShattered > 0) {
      this.syncFocusRingVisual();
      this.callbacks.onStateChanged?.();
    }
    return newlyCracked + newlyShattered;
  }

  private applyStrikeToVessel(
    vessel: SmashableVesselEntry,
    impactLocal: THREE.Vector3,
    swingVelLocal: THREE.Vector3,
    emitCallback: boolean
  ): 'none' | 'cracked' | 'shattered' {
    if (!vessel.intact || vessel.hitCooldown > 0) return 'none';
    if (vessel.hits === 0) {
      this.crackVessel(vessel, impactLocal, swingVelLocal, emitCallback);
      return 'cracked';
    }
    this.shatterVessel(vessel, impactLocal, swingVelLocal, emitCallback);
    return 'shattered';
  }

  private crackVessel(
    vessel: SmashableVesselEntry,
    impactLocal: THREE.Vector3,
    swingVelLocal: THREE.Vector3,
    emitCallback = true
  ): void {
    if (!vessel.intact || vessel.hits > 0) return;
    vessel.hits = 1;
    vessel.hitCooldown = VESSEL_HIT_COOLDOWN_SEC;

    const invScale = 1 / Math.max(0.25, vessel.layout.scale);
    const localX = (impactLocal.x - vessel.layout.x) * invScale;
    const localY = (impactLocal.y - vessel.layout.y) * invScale;
    const localZ = (impactLocal.z - vessel.layout.z) * invScale;
    const impactTheta =
      Math.hypot(localX, localZ) > 0.015
        ? Math.atan2(localZ, localX)
        : Math.PI * 0.5;
    const vesselH = Math.max(0.08, vessel.item.measurements.heightCm / 100);
    const heightNorm = THREE.MathUtils.clamp(localY / vesselH, 0.2, 0.85);

    this.buildCrackLinesForImpact(vessel, impactTheta, heightNorm, localX, localY);
    vessel.crackGroup.visible = true;

    // Sharp physical impact wobble impulse away from bat strike direction
    const pushX = THREE.MathUtils.clamp(swingVelLocal.x * 0.7, -3.5, 3.5);
    const pushZ = THREE.MathUtils.clamp(swingVelLocal.z * 0.7, -3.5, 3.5);
    vessel.recoilVel.set(pushZ, -pushX);

    this.spawnDustBurst(vessel.centerLocal, 0.45);
    if (emitCallback) {
      this.callbacks.onCeramicCrack?.(vessel.item.name, this.getCrackedCount());
      this.syncFocusRingVisual();
      this.callbacks.onStateChanged?.();
    }
  }

  private shatterVessel(
    vessel: SmashableVesselEntry,
    impactLocal: THREE.Vector3,
    swingVelLocal: THREE.Vector3,
    emitCallback = true
  ): void {
    if (!vessel.intact) return;
    vessel.hits = vessel.maxHits;
    vessel.intact = false;
    vessel.mesh.visible = false;
    vessel.crackGroup.visible = false;
    vessel.recoilAngle.set(0, 0);
    vessel.recoilVel.set(0, 0);
    vessel.root.rotation.set(0, 0, 0);

    const invScale = 1 / Math.max(0.25, vessel.layout.scale);
    const localImpactX = (impactLocal.x - vessel.layout.x) * invScale;
    const localImpactY = (impactLocal.y - vessel.layout.y) * invScale;
    const localImpactZ = (impactLocal.z - vessel.layout.z) * invScale;

    for (const shard of vessel.shards) {
      shard.mesh.visible = true;
      shard.mesh.position.copy(shard.homePos);
      shard.mesh.quaternion.copy(shard.homeQuat);
      shard.settled = false;

      // Frame 0 is always the exact intact vessel origin
      shard.frames = [
        {
          px: shard.homePos.x,
          py: shard.homePos.y,
          pz: shard.homePos.z,
          qx: 0,
          qy: 0,
          qz: 0,
          qw: 1,
        },
      ];

      const dx = shard.homePos.x - localImpactX;
      const dy = shard.homePos.y - localImpactY;
      const dz = shard.homePos.z - localImpactZ;
      const distToHit = Math.hypot(dx, dy, dz);
      const proximity = Math.max(0.25, 1.35 - distToHit * 3.2);

      const outSpeed = (1.1 + Math.random() * 1.45) * proximity;
      shard.velocity.set(
        shard.radialDir.x * outSpeed +
          swingVelLocal.x * 0.42 * proximity +
          (Math.random() - 0.5) * 0.7,
        0.95 + Math.random() * 1.45 + Math.max(0, swingVelLocal.y * 0.3),
        shard.radialDir.z * outSpeed +
          swingVelLocal.z * 0.42 * proximity +
          (Math.random() - 0.5) * 0.7
      );

      shard.angVel.set(
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14
      );
    }

    this.spawnDustBurst(vessel.centerLocal, 1.0);
    this.phase = 'smashed';

    if (emitCallback) {
      this.callbacks.onCeramicShatter?.(1);
      this.syncFocusRingVisual();
      this.callbacks.onStateChanged?.();
    }
  }

  private spawnDustBurst(center: THREE.Vector3, intensity = 1): void {
    if (!this.dustPoints || !this.dustVelocities) return;
    const posAttr = this.dustPoints.geometry.attributes
      .position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < arr.length / 3; i++) {
      arr[i * 3] = center.x + (Math.random() - 0.5) * 0.08 * intensity;
      arr[i * 3 + 1] = center.y + (Math.random() - 0.5) * 0.1 * intensity;
      arr[i * 3 + 2] = center.z + (Math.random() - 0.5) * 0.08 * intensity;

      const a = Math.random() * Math.PI * 2;
      const sp = (0.7 + Math.random() * 1.7) * Math.max(0.55, intensity);
      this.dustVelocities[i * 3] = Math.cos(a) * sp;
      this.dustVelocities[i * 3 + 1] = (0.35 + Math.random() * 1.25) * intensity;
      this.dustVelocities[i * 3 + 2] = Math.sin(a) * sp;
    }
    posAttr.needsUpdate = true;
    this.dustPoints.visible = true;
    this.dustLife = 0.55 * Math.max(0.65, intensity);
  }

  private updateShardPhysics(dt: number): void {
    this.recordAccum += dt;
    const shouldRecord = this.recordAccum >= RECORD_INTERVAL_SEC;
    if (shouldRecord) {
      this.recordAccum %= RECORD_INTERVAL_SEC;
    }

    for (const vessel of this.vessels) {
      if (vessel.intact) continue;
      const scale = Math.max(0.25, vessel.layout.scale);
      const vesselFloorY = (FLOOR_LOCAL_Y - vessel.layout.y) / scale;

      for (const shard of vessel.shards) {
        if (!shard.settled) {
          shard.velocity.y -= 9.8 * dt;
          shard.mesh.position.addScaledVector(shard.velocity, dt);

          _tmpEuler.set(
            shard.angVel.x * dt,
            shard.angVel.y * dt,
            shard.angVel.z * dt
          );
          _tmpQuat.setFromEuler(_tmpEuler);
          shard.mesh.quaternion.multiply(_tmpQuat).normalize();

          // Check own plinth top surface bounce directly beneath vessel
          const radialFromCenterSq =
            shard.mesh.position.x * shard.mesh.position.x +
            shard.mesh.position.z * shard.mesh.position.z;
          const pedMinY = shard.approxRadius * 0.35;
          if (
            radialFromCenterSq < 0.022 &&
            shard.mesh.position.y < pedMinY &&
            shard.mesh.position.y > -0.06 &&
            shard.velocity.y < 0
          ) {
            shard.mesh.position.y = pedMinY;
            shard.velocity.y = -shard.velocity.y * 0.32;
            shard.velocity.x *= 0.82;
            shard.velocity.z *= 0.82;
            shard.angVel.multiplyScalar(0.76);
          }

          // Check stone studio floor bounce
          const floorMinY = vesselFloorY + shard.approxRadius * 0.38;
          if (shard.mesh.position.y <= floorMinY) {
            shard.mesh.position.y = floorMinY;
            if (shard.velocity.y < -0.35) {
              shard.velocity.y = -shard.velocity.y * 0.34;
            } else {
              shard.velocity.y = 0;
            }
            shard.velocity.x *= 0.76;
            shard.velocity.z *= 0.76;
            shard.angVel.multiplyScalar(0.68);

            if (
              shard.velocity.lengthSq() < 0.004 &&
              shard.angVel.lengthSq() < 0.12
            ) {
              shard.velocity.set(0, 0, 0);
              shard.angVel.set(0, 0, 0);
              shard.settled = true;
            }
          }
        }

        if (shouldRecord && shard.frames.length < MAX_RECORDED_FRAMES) {
          const p = shard.mesh.position;
          const q = shard.mesh.quaternion;
          const last = shard.frames[shard.frames.length - 1];
          const moved =
            !last ||
            Math.abs(last.px - p.x) +
              Math.abs(last.py - p.y) +
              Math.abs(last.pz - p.z) >
              0.0025 ||
            !shard.settled;
          if (moved) {
            shard.frames.push({
              px: p.x,
              py: p.y,
              pz: p.z,
              qx: q.x,
              qy: q.y,
              qz: q.z,
              qw: q.w,
            });
          }
        }
      }
    }
  }

  private updateTimeReversal(dt: number, camera?: THREE.Camera): void {
    const duration = this.reducedMotion
      ? RESTORE_REDUCED_DURATION_SEC
      : RESTORE_DURATION_SEC;
    this.restoreProgress = Math.min(1, this.restoreProgress + dt / duration);

    // Animate emerald Chrono Rewind mandalas
    const envelope = Math.sin(this.restoreProgress * Math.PI);
    const scaleCurve = 0.45 + 0.65 * Math.min(1, this.restoreProgress * 2.4);

    this.outerMandalaMesh.rotation.z = -this.mandalaClock * 2.2;
    this.innerMandalaMesh.rotation.z = this.mandalaClock * 3.4;
    this.outerMandalaMesh.scale.setScalar(scaleCurve);
    this.innerMandalaMesh.scale.setScalar(scaleCurve * 0.92);

    this.portalOuterMesh.rotation.z = -this.mandalaClock * 2.6;
    this.portalInnerMesh.rotation.z = this.mandalaClock * 4.1;
    this.portalOuterMesh.scale.setScalar(scaleCurve);
    this.portalInnerMesh.scale.setScalar(scaleCurve * 0.88);

    // Wrist/bat Chrono Rewind spell ring hovers beside active pointer/hand
    this.handMandalaGroup.position.set(
      this.batCurrentLocal.x,
      this.batCurrentLocal.y + 0.12,
      this.batCurrentLocal.z + 0.04
    );
    if (camera) {
      this.handMandalaGroup.lookAt(camera.position);
    }
    this.handMandalaOuter.rotation.z = -this.mandalaClock * 3.8;
    this.handMandalaInner.rotation.z = this.mandalaClock * 5.2;
    this.handMandalaGroup.scale.setScalar(0.75 + 0.35 * envelope);

    const floorOpacity = 0.25 + envelope * 0.68;
    const portalOpacity = 0.18 + envelope * 0.52;
    (this.outerMandalaMesh.material as THREE.MeshBasicMaterial).opacity =
      floorOpacity;
    (this.innerMandalaMesh.material as THREE.MeshBasicMaterial).opacity =
      floorOpacity * 0.95;
    (this.portalOuterMesh.material as THREE.MeshBasicMaterial).opacity =
      portalOpacity;
    (this.portalInnerMesh.material as THREE.MeshBasicMaterial).opacity =
      portalOpacity * 0.9;
    (this.handMandalaOuter.material as THREE.MeshBasicMaterial).opacity =
      0.3 + envelope * 0.68;
    (this.handMandalaInner.material as THREE.MeshBasicMaterial).opacity =
      0.3 + envelope * 0.72;

    // Swirling green time particles converge inward like time reversing
    const sparkAttr = this.timeSparks.geometry.attributes
      .position as THREE.BufferAttribute;
    const sparkArr = sparkAttr.array as Float32Array;
    const invP = 1 - this.restoreProgress;
    for (let i = 0; i < sparkArr.length / 3; i++) {
      const bx = this.timeSparkBase[i * 3];
      const by = this.timeSparkBase[i * 3 + 1];
      const bz = this.timeSparkBase[i * 3 + 2];
      const twist = this.restoreProgress * 4.5 + i * 0.15;
      const cosT = Math.cos(twist);
      const sinT = Math.sin(twist);
      sparkArr[i * 3] = (bx * cosT - bz * sinT) * (0.25 + invP * 0.85);
      sparkArr[i * 3 + 1] = THREE.MathUtils.lerp(0.18, by, invP);
      sparkArr[i * 3 + 2] = (bx * sinT + bz * cosT) * (0.25 + invP * 0.85);
    }
    sparkAttr.needsUpdate = true;
    (this.timeSparks.material as THREE.PointsMaterial).opacity = envelope * 0.95;

    // Reverse every shard along its recorded flight path (or heal cracked vessels)
    for (const vessel of this.vessels) {
      if (vessel.intact && vessel.hits > 0 && this.restoreProgress > 0.6) {
        vessel.crackGroup.visible = false;
      }
      if (vessel.intact) continue;
      const emissiveMat = vessel.shardMaterial as THREE.MeshPhysicalMaterial;
      if (emissiveMat.emissive) {
        emissiveMat.emissive.setHex(0x1ce880);
        emissiveMat.emissiveIntensity = 0.28 + envelope * 0.65;
      }

      for (const shard of vessel.shards) {
        const localT = THREE.MathUtils.clamp(
          (this.restoreProgress - vessel.restoreDelay * 0.45 - shard.delayOffset * 0.35) /
            Math.max(0.35, 1 - vessel.restoreDelay * 0.45 - shard.delayOffset * 0.35),
          0,
          1
        );
        sampleReversedTransform(
          shard.frames,
          localT,
          _tmpVec,
          _tmpQuat
        );
        shard.mesh.position.copy(_tmpVec);
        shard.mesh.quaternion.copy(_tmpQuat);
      }
    }

    if (this.restoreProgress >= 1) {
      // Snap all vessels back to pristine uncracked intact state
      for (const vessel of this.vessels) {
        vessel.intact = true;
        vessel.hits = 0;
        vessel.hitCooldown = 0;
        vessel.mesh.visible = true;
        vessel.crackGroup.visible = false;
        vessel.recoilAngle.set(0, 0);
        vessel.recoilVel.set(0, 0);
        vessel.root.rotation.set(0, 0, 0);
        const emissiveMat = vessel.shardMaterial as THREE.MeshPhysicalMaterial;
        if (emissiveMat.emissive) {
          emissiveMat.emissive.setHex(0x000000);
          emissiveMat.emissiveIntensity = 0;
        }
        for (const shard of vessel.shards) {
          shard.mesh.visible = false;
          shard.frames = [];
        }
      }
      this.mandalaGroup.visible = false;
      this.handMandalaGroup.visible = false;
      this.phase = 'smashing';
      this.restoreProgress = 0;
      this.syncFocusRingVisual();
      this.callbacks.onTimeRestoreComplete?.();
      this.callbacks.onStateChanged?.();
    }
  }

  private clearVessels(): void {
    for (const v of this.vessels) {
      this.group.remove(v.root);
      if (v.plinthGroup) {
        this.group.remove(v.plinthGroup);
      }
      v.clayGeometry?.dispose();
      v.nameGeometry?.dispose();
      v.customTexture?.dispose();
      v.customMaterial?.dispose();
      v.shardMaterial.dispose();
      v.crackLineGeo?.dispose();
      v.crackHighlightGeo?.dispose();
      v.crackMaterial.dispose();
      v.crackHighlightMat.dispose();
      for (const s of v.shards) {
        s.geometry.dispose();
      }
    }
    this.vessels = [];
  }

  public dispose(): void {
    this.clearVessels();
    this.plinthGeo.dispose();
    this.plinthColGeo.dispose();
    this.plinthWoodMat.dispose();
    this.plinthStoneMat.dispose();
    this.batGeos.forEach((g) => g.dispose());
    this.batMats.forEach((m) => m.dispose());
    this.batTexs.forEach((t) => t.dispose());
    this.focusRingGeos.forEach((g) => g.dispose());
    this.focusRingMats.forEach((m) => m.dispose());
    this.mandalaGeos.forEach((g) => g.dispose());
    this.mandalaMats.forEach((m) => m.dispose());
    this.mandalaTexs.forEach((t) => t.dispose());
  }
}
