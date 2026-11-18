import * as THREE from 'three';
import { GlazeManager } from '../kiln/GlazeManager.ts';
import {
  ClayNameGeometry,
  createInitialClayNameState,
  NAME_DEFAULT_COLS,
  NAME_DEFAULT_ROWS,
} from '../names/ClayNameGeometry.ts';
import { ClayGeometry } from '../pottery/ClayGeometry.ts';
import {
  createInitialClayProfile,
  DEFAULT_ANGULAR_SEGMENTS,
} from '../pottery/PotteryPresets.ts';
import type { GalleryFilter, SavedPotteryItem } from '../types.ts';
import { PotteryStorage, type StorageResult } from './PotteryStorage.ts';

/**
 * Pure helper: normalizes legacy and current gallery items to 'vessel' | 'name'.
 */
export function getCreationKind(
  item: Pick<SavedPotteryItem, 'kind' | 'nameData'>
): 'vessel' | 'name' {
  return item.kind === 'name' || Boolean(item.nameData) ? 'name' : 'vessel';
}

/**
 * Pure helper: filters the unified gallery by 'all', 'vessel', or 'name'.
 */
export function filterGalleryItems(
  items: SavedPotteryItem[],
  filter: GalleryFilter
): SavedPotteryItem[] {
  if (filter === 'all') return items;
  return items.filter((item) => getCreationKind(item) === filter);
}

/**
 * Pure helper: formats display metadata consistently for both Pottery Wheel vessels and 3D Clay Names.
 */
export function formatGalleryItemMeta(
  item: SavedPotteryItem,
  glazeName?: string
): string {
  const glazeLabel = glazeName ?? item.glazeId;
  if (getCreationKind(item) === 'name' && item.nameData) {
    const shapeNames: Record<string, string> = {
      tablet: 'Tablet',
      oval: 'Oval',
      ribbon: 'Banner',
      heart: 'Heart',
    };
    const shapeLabel =
      shapeNames[item.nameData.plaqueShape] ?? item.nameData.plaqueShape;
    const reliefMm = Math.round(item.nameData.letterRelief * 1000);
    const boldLabel = item.nameData.letterBoldness.toFixed(2);
    return `${glazeLabel} · Clay Name · ${shapeLabel} · 56 × 27 cm · Relief ${reliefMm} mm · ${boldLabel}x`;
  }
  return `${glazeLabel} · Pottery Wheel · ${item.measurements.heightCm} cm × ${item.measurements.maxWidthCm} cm`;
}

export class GalleryManager {
  public readonly storage: PotteryStorage;
  public readonly displayGroup = new THREE.Group();

  private readonly glazeManager: GlazeManager;
  private activeGeometry: ClayGeometry | null = null;
  private activeNameGeometry: ClayNameGeometry | null = null;
  private activeMesh: THREE.Mesh | null = null;
  private activeCustomMaterial: THREE.Material | null = null;
  private activeCustomTexture: THREE.Texture | null = null;
  private items: SavedPotteryItem[] = [];
  public lastError = '';

  constructor(glazeManager: GlazeManager, storage?: PotteryStorage) {
    this.glazeManager = glazeManager;
    this.storage = storage ?? new PotteryStorage();
    this.displayGroup.name = 'GalleryDisplay';
    this.refresh();
  }

  public getItems(): SavedPotteryItem[] {
    return this.items;
  }

  public refresh(): StorageResult<SavedPotteryItem[]> {
    const res = this.storage.loadAll();
    this.items = res.data ?? [];
    this.lastError = res.error ?? '';
    return res;
  }

  public save(item: SavedPotteryItem): StorageResult<SavedPotteryItem[]> {
    const res = this.storage.saveItem(item);
    if (res.ok && res.data) {
      this.items = res.data;
      this.lastError = '';
    } else {
      this.lastError = res.error ?? 'Save failed.';
    }
    return res;
  }

  public rename(id: string, name: string): StorageResult<SavedPotteryItem[]> {
    const res = this.storage.renameItem(id, name);
    if (res.ok && res.data) {
      this.items = res.data;
      this.lastError = '';
    }
    return res;
  }

  public delete(id: string): StorageResult<SavedPotteryItem[]> {
    const res = this.storage.deleteItem(id);
    if (res.ok && res.data) {
      this.items = res.data;
      this.lastError = '';
    }
    return res;
  }

  public buildMeshFromSaved(item: SavedPotteryItem): {
    mesh: THREE.Mesh;
    clayGeometry: ClayGeometry | null;
    nameGeometry: ClayNameGeometry | null;
    customMaterial: THREE.Material | null;
    customTexture: THREE.Texture | null;
  } {
    let clayGeometry: ClayGeometry | null = null;
    let nameGeometry: ClayNameGeometry | null = null;
    let bufferGeo: THREE.BufferGeometry;
    const isName = item.kind === 'name' && Boolean(item.nameData);

    if (isName && item.nameData) {
      const nd = item.nameData;
      const cols = nd.cols ?? NAME_DEFAULT_COLS;
      const rows = nd.rows ?? NAME_DEFAULT_ROWS;
      nameGeometry = new ClayNameGeometry(cols, rows);
      const state = createInitialClayNameState(
        nd.text,
        nd.plaqueShape,
        cols,
        rows
      );
      state.letterRelief = nd.letterRelief;
      state.letterBoldness = nd.letterBoldness;
      for (
        let i = 0;
        i < Math.min(state.sculptDeltas.length, nd.sculptDeltas.length);
        i++
      ) {
        state.sculptDeltas[i] = nd.sculptDeltas[i];
      }
      nameGeometry.updateFromState(state);
      bufferGeo = nameGeometry.geometry;
    } else {
      const ringCount = item.profile.outerRadii.length;
      clayGeometry = new ClayGeometry(ringCount, DEFAULT_ANGULAR_SEGMENTS);
      const profile = createInitialClayProfile(ringCount, DEFAULT_ANGULAR_SEGMENTS);
      profile.outerRadii = [...item.profile.outerRadii];
      profile.innerRadii = [...item.profile.innerRadii];
      profile.heights = [...item.profile.heights];
      profile.openDepth = item.profile.openDepth;
      profile.wobble = 0;
      if (
        item.profile.angularOffsets &&
        item.profile.angularOffsets.length === profile.angularOffsets.length
      ) {
        profile.angularOffsets = [...item.profile.angularOffsets];
      }
      clayGeometry.updateFromProfile(profile, 0);
      bufferGeo = clayGeometry.geometry;
    }

    const baseMat = this.glazeManager.getMaterial(item.glazeId);
    let mat: THREE.Material = baseMat;
    let customMaterial: THREE.Material | null = null;
    let customTexture: THREE.Texture | null = null;

    if (item.paintDataUrl && typeof document !== 'undefined') {
      const glaze = this.glazeManager.getGlazeById(item.glazeId);
      const baseTex = this.glazeManager.getTexture(item.glazeId);
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      if (ctx && baseTex.image) {
        ctx.drawImage(baseTex.image as HTMLCanvasElement, 0, 0, 512, 512);
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = isName ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;

      const paintedMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: tex,
        roughness: glaze.roughness,
        metalness: glaze.metalness,
        clearcoat: glaze.clearcoat,
        clearcoatRoughness: glaze.clearcoatRoughness,
        envMapIntensity: 1.15,
      });

      const img = new Image();
      img.onload = () => {
        if (ctx) {
          ctx.clearRect(0, 0, 512, 512);
          if (baseTex.image) {
            ctx.drawImage(baseTex.image as HTMLCanvasElement, 0, 0, 512, 512);
          }
          ctx.drawImage(img, 0, 0, 512, 512);
          tex.needsUpdate = true;
        }
      };
      img.src = item.paintDataUrl;

      mat = paintedMat;
      customMaterial = paintedMat;
      customTexture = tex;
    }

    const mesh = new THREE.Mesh(bufferGeo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = item.name;
    if (isName) {
      mesh.position.y = 0.145;
    }
    return { mesh, clayGeometry, nameGeometry, customMaterial, customTexture };
  }

  public showItemOnPedestal(item: SavedPotteryItem | null): THREE.Mesh | null {
    this.clearPedestal();
    if (!item) return null;

    const { mesh, clayGeometry, nameGeometry, customMaterial, customTexture } =
      this.buildMeshFromSaved(item);
    this.activeGeometry = clayGeometry;
    this.activeNameGeometry = nameGeometry;
    this.activeMesh = mesh;
    this.activeCustomMaterial = customMaterial;
    this.activeCustomTexture = customTexture;
    this.displayGroup.add(mesh);
    return mesh;
  }

  public clearPedestal(): void {
    if (this.activeMesh) {
      this.displayGroup.remove(this.activeMesh);
      this.activeMesh = null;
    }
    if (this.activeGeometry) {
      this.activeGeometry.dispose();
      this.activeGeometry = null;
    }
    if (this.activeNameGeometry) {
      this.activeNameGeometry.dispose();
      this.activeNameGeometry = null;
    }
    if (this.activeCustomTexture) {
      this.activeCustomTexture.dispose();
      this.activeCustomTexture = null;
    }
    if (this.activeCustomMaterial) {
      this.activeCustomMaterial.dispose();
      this.activeCustomMaterial = null;
    }
  }

  public getActiveMesh(): THREE.Mesh | null {
    return this.activeMesh;
  }

  public dispose(): void {
    this.clearPedestal();
  }
}
