import * as THREE from 'three';
import type { GlazeDefinition } from '../types.ts';

export const GLAZE_CATALOG: GlazeDefinition[] = [
  {
    id: 'ocean-blue',
    name: 'Ocean Blue',
    color: '#1f5e7a',
    secondaryColor: '#5fb0c9',
    roughness: 0.14,
    metalness: 0.08,
    clearcoat: 0.92,
    clearcoatRoughness: 0.1,
    speckleIntensity: 0.18,
    finishLabel: 'Glossy',
    description: 'Deep coastal cobalt pooling lighter near the rim.',
  },
  {
    id: 'forest-green',
    name: 'Forest Green',
    color: '#2e5945',
    secondaryColor: '#77a387',
    roughness: 0.2,
    metalness: 0.05,
    clearcoat: 0.78,
    clearcoatRoughness: 0.16,
    speckleIntensity: 0.15,
    finishLabel: 'Glossy',
    description: 'Translucent celadon jade with gentle mineral depth.',
  },
  {
    id: 'sunset-orange',
    name: 'Sunset Orange',
    color: '#c95c32',
    secondaryColor: '#f2a266',
    roughness: 0.16,
    metalness: 0.06,
    clearcoat: 0.88,
    clearcoatRoughness: 0.12,
    speckleIntensity: 0.14,
    finishLabel: 'Glossy',
    description: 'Warm ember persimmon with luminous glassy reflections.',
  },
  {
    id: 'royal-purple',
    name: 'Royal Purple',
    color: '#58346e',
    secondaryColor: '#9f76b8',
    roughness: 0.22,
    metalness: 0.34,
    clearcoat: 0.8,
    clearcoatRoughness: 0.14,
    speckleIntensity: 0.24,
    finishLabel: 'Luster',
    description: 'Plum-violet reduction luster with subtle metallic sheen.',
  },
  {
    id: 'pearl-white',
    name: 'Pearl White',
    color: '#ebe6dc',
    secondaryColor: '#d4cab8',
    roughness: 0.26,
    metalness: 0.03,
    clearcoat: 0.65,
    clearcoatRoughness: 0.22,
    speckleIntensity: 0.12,
    finishLabel: 'Satin',
    description: 'Soft eggshell porcelain with warm ivory undertone.',
  },
  {
    id: 'midnight-black',
    name: 'Midnight Black',
    color: '#222428',
    secondaryColor: '#484d57',
    roughness: 0.62,
    metalness: 0.22,
    clearcoat: 0.18,
    clearcoatRoughness: 0.45,
    speckleIntensity: 0.2,
    finishLabel: 'Matte',
    description: 'Velvet obsidian basalt with quiet mineral shimmer.',
  },
  {
    id: 'terracotta',
    name: 'Terracotta',
    color: '#b85d41',
    secondaryColor: '#8d4129',
    roughness: 0.78,
    metalness: 0.02,
    clearcoat: 0.05,
    clearcoatRoughness: 0.65,
    speckleIntensity: 0.26,
    finishLabel: 'Matte',
    description: 'Earthy kiln-baked red earthenware with organic warmth.',
  },
  {
    id: 'golden-sand',
    name: 'Golden Sand',
    color: '#cbb07a',
    secondaryColor: '#8f7245',
    roughness: 0.38,
    metalness: 0.28,
    clearcoat: 0.48,
    clearcoatRoughness: 0.28,
    speckleIntensity: 0.34,
    finishLabel: 'Satin',
    description: 'Speckled toasted stoneware kissed with warm mica flecks.',
  },
];

export class GlazeManager {
  private readonly materialCache = new Map<string, THREE.MeshPhysicalMaterial>();
  private readonly textureCache = new Map<string, THREE.CanvasTexture>();
  private readonly maxAnisotropy: number;

  constructor(maxAnisotropy = 4) {
    this.maxAnisotropy = maxAnisotropy;
  }

  public getGlazeById(id: string): GlazeDefinition {
    return GLAZE_CATALOG.find((g) => g.id === id) ?? GLAZE_CATALOG[0];
  }

  public getTexture(glazeId: string): THREE.CanvasTexture {
    const existing = this.textureCache.get(glazeId);
    if (existing) return existing;
    const glaze = this.getGlazeById(glazeId);
    const tex = this.createGlazeTexture(glaze);
    this.textureCache.set(glaze.id, tex);
    return tex;
  }

  public getMaterial(glazeId: string): THREE.MeshPhysicalMaterial {
    const cached = this.materialCache.get(glazeId);
    if (cached) return cached;

    const glaze = this.getGlazeById(glazeId);
    const map = this.getTexture(glaze.id);

    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map,
      roughness: glaze.roughness,
      metalness: glaze.metalness,
      clearcoat: glaze.clearcoat,
      clearcoatRoughness: glaze.clearcoatRoughness,
      envMapIntensity: 1.15,
    });
    this.materialCache.set(glaze.id, mat);
    return mat;
  }

  public applyGlazeProperties(
    mat: THREE.MeshPhysicalMaterial,
    glazeId: string
  ): void {
    const glaze = this.getGlazeById(glazeId);
    mat.roughness = glaze.roughness;
    mat.metalness = glaze.metalness;
    mat.clearcoat = glaze.clearcoat;
    mat.clearcoatRoughness = glaze.clearcoatRoughness;
    mat.envMapIntensity = 1.15;
    mat.needsUpdate = true;
  }

  private createGlazeTexture(glaze: GlazeDefinition): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      // Vertical ceramic glaze pooling gradient (UV v runs from bottom -> rim -> interior)
      const grad = ctx.createLinearGradient(0, 0, 0, size);
      grad.addColorStop(0, glaze.color);
      grad.addColorStop(0.42, glaze.color);
      grad.addColorStop(0.5, glaze.secondaryColor);
      grad.addColorStop(0.62, glaze.color);
      grad.addColorStop(1, glaze.secondaryColor);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);

      // Subtle throwing rings & mineral speckles
      for (let y = 0; y < size; y += 3) {
        ctx.fillStyle =
          y % 6 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)';
        ctx.fillRect(0, y, size, 1.5);
      }

      const speckCount = Math.floor(900 * glaze.speckleIntensity);
      for (let i = 0; i < speckCount; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = 0.7 + Math.random() * 1.4;
        ctx.fillStyle =
          Math.random() > 0.45
            ? 'rgba(30, 20, 15, 0.22)'
            : 'rgba(255, 248, 232, 0.2)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.maxAnisotropy;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  public dispose(): void {
    this.materialCache.forEach((m) => m.dispose());
    this.textureCache.forEach((t) => t.dispose());
    this.materialCache.clear();
    this.textureCache.clear();
  }
}
