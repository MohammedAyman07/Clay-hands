import * as THREE from 'three';
import { GlazeManager } from '../kiln/GlazeManager.ts';
import { ClayGeometry } from '../pottery/ClayGeometry.ts';
import {
  createInitialClayProfile,
  DEFAULT_ANGULAR_SEGMENTS,
} from '../pottery/PotteryPresets.ts';
import type { SavedPotteryItem } from '../types.ts';
import { PotteryStorage, type StorageResult } from './PotteryStorage.ts';

export class GalleryManager {
  public readonly storage: PotteryStorage;
  public readonly displayGroup = new THREE.Group();

  private readonly glazeManager: GlazeManager;
  private activeGeometry: ClayGeometry | null = null;
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
    clayGeometry: ClayGeometry;
    customMaterial: THREE.Material | null;
    customTexture: THREE.Texture | null;
  } {
    const ringCount = item.profile.outerRadii.length;
    const clayGeometry = new ClayGeometry(ringCount, DEFAULT_ANGULAR_SEGMENTS);
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
      tex.wrapS = THREE.RepeatWrapping;
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

    const mesh = new THREE.Mesh(clayGeometry.geometry, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = item.name;
    return { mesh, clayGeometry, customMaterial, customTexture };
  }

  public showItemOnPedestal(item: SavedPotteryItem | null): THREE.Mesh | null {
    this.clearPedestal();
    if (!item) return null;

    const { mesh, clayGeometry, customMaterial, customTexture } =
      this.buildMeshFromSaved(item);
    this.activeGeometry = clayGeometry;
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
