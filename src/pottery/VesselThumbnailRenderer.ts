import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { GlazeManager } from '../kiln/GlazeManager.ts';
import type { ClayProfileState } from '../types.ts';
import { ClayGeometry } from './ClayGeometry.ts';
import {
  CHALLENGE_PRESETS,
  createInitialClayProfile,
  DEFAULT_ANGULAR_SEGMENTS,
  DEFAULT_RING_COUNT,
} from './PotteryPresets.ts';

export type VesselThumbnailKey =
  | 'free'
  | 'cup'
  | 'bowl'
  | 'vase'
  | 'classic-cup'
  | 'tea-bowl'
  | 'tapered-vase'
  | 'lantern-amphora';

function buildProfileFromPreset(
  presetId: string
): ClayProfileState | null {
  const preset = CHALLENGE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;
  const profile = createInitialClayProfile(
    DEFAULT_RING_COUNT,
    DEFAULT_ANGULAR_SEGMENTS
  );
  for (let i = 0; i < profile.ringCount; i++) {
    const t = i / (profile.ringCount - 1);
    const r = preset.targetRadii[i] ?? 0.06;
    profile.outerRadii[i] = r;
    profile.innerRadii[i] = Math.max(0.012, r - 0.013);
    profile.heights[i] = t * preset.targetHeight;
  }
  profile.openDepth = preset.openDepth;
  profile.wobble = 0;
  profile.surfaceRoughness = 0.06;
  return profile;
}

/**
 * Renders crisp studio-lit 3D thumbnails of the actual ceramic vessels once on
 * startup so mode & preset selectors display authentic ceramic photography.
 */
export class VesselThumbnailRenderer {
  private readonly cache = new Map<VesselThumbnailKey, string>();

  public getThumbnail(key: VesselThumbnailKey): string {
    return this.cache.get(key) ?? '';
  }

  public prewarmAll(
    renderer: THREE.WebGLRenderer,
    glazeManager: GlazeManager
  ): void {
    const width = 240;
    const height = 180;
    const rt = new THREE.WebGLRenderTarget(width, height, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xefe3ce);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight(0xfff5e4, 0x9b7b5f, 1.45);
    const key = new THREE.DirectionalLight(0xffe6c0, 2.3);
    key.position.set(-2.2, 2.8, 2.4);
    const rim = new THREE.DirectionalLight(0xd9e8ff, 0.85);
    rim.position.set(2.0, 1.8, -2.0);
    scene.add(hemi, key, rim);

    const camera = new THREE.PerspectiveCamera(34, width / height, 0.05, 10);

    // Subtle timber plinth disc under each vessel
    const plinthGeo = new THREE.CylinderGeometry(0.145, 0.155, 0.022, 36);
    const plinthMat = new THREE.MeshStandardMaterial({
      color: 0x9b724f,
      roughness: 0.65,
      metalness: 0.04,
    });
    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.y = -0.011;
    scene.add(plinth);

    const clayGeo = new ClayGeometry(
      DEFAULT_RING_COUNT,
      DEFAULT_ANGULAR_SEGMENTS
    );
    const rawMat = new THREE.MeshPhysicalMaterial({
      color: 0x9a6447,
      roughness: 0.54,
      metalness: 0.02,
      clearcoat: 0.25,
      clearcoatRoughness: 0.32,
    });
    const glazeMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.18,
      metalness: 0.06,
      clearcoat: 0.9,
      clearcoatRoughness: 0.12,
    });
    const vesselMesh = new THREE.Mesh(clayGeo.geometry, rawMat);
    scene.add(vesselMesh);

    const pixelBuffer = new Uint8Array(width * height * 4);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const prevTarget = renderer.getRenderTarget();
    const prevXrEnabled = renderer.xr.enabled;
    renderer.xr.enabled = false;

    const specs: Array<{
      key: VesselThumbnailKey;
      presetId: string | null;
      glazeId: string | null;
    }> = [
      { key: 'free', presetId: null, glazeId: null },
      { key: 'classic-cup', presetId: 'classic-cup', glazeId: 'ocean-blue' },
      { key: 'tea-bowl', presetId: 'tea-bowl', glazeId: 'forest-green' },
      { key: 'tapered-vase', presetId: 'tapered-vase', glazeId: 'sunset-orange' },
      { key: 'lantern-amphora', presetId: 'lantern-amphora', glazeId: 'terracotta' },
    ];

    try {
      for (const spec of specs) {
        const profile = spec.presetId
          ? buildProfileFromPreset(spec.presetId) ?? createInitialClayProfile()
          : createInitialClayProfile();
        clayGeo.updateFromProfile(profile, 0);

        if (spec.glazeId) {
          glazeManager.applyGlazeProperties(glazeMat, spec.glazeId);
          glazeMat.map = glazeManager.getTexture(spec.glazeId);
          glazeMat.needsUpdate = true;
          vesselMesh.material = glazeMat;
        } else {
          vesselMesh.material = rawMat;
        }

        const totalH =
          profile.heights[profile.ringCount - 1] - profile.heights[0];
        const maxR = Math.max(...profile.outerRadii);
        const span = Math.max(totalH, maxR * 2.1, 0.14);
        const dist = span * 2.25;
        camera.position.set(dist * 0.22, totalH * 0.56 + dist * 0.34, dist * 0.96);
        camera.lookAt(0, totalH * 0.44, 0);
        camera.updateMatrixWorld();

        renderer.setRenderTarget(rt);
        renderer.clear();
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(rt, 0, 0, width, height, pixelBuffer);

        if (ctx) {
          const imgData = ctx.createImageData(width, height);
          for (let y = 0; y < height; y++) {
            const srcRow = (height - 1 - y) * width * 4;
            const dstRow = y * width * 4;
            imgData.data.set(
              pixelBuffer.subarray(srcRow, srcRow + width * 4),
              dstRow
            );
          }
          ctx.putImageData(imgData, 0, 0);
          this.cache.set(spec.key, canvas.toDataURL('image/png'));
        }
      }

      // Share lesson thumbnails with their exact target presets
      this.cache.set('cup', this.cache.get('classic-cup') ?? '');
      this.cache.set('bowl', this.cache.get('tea-bowl') ?? '');
      this.cache.set('vase', this.cache.get('tapered-vase') ?? '');
    } catch {
      // Fail gracefully if headless/sandbox blocks readPixels
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.xr.enabled = prevXrEnabled;
      rt.dispose();
      envRT.dispose();
      plinthGeo.dispose();
      plinthMat.dispose();
      clayGeo.dispose();
      rawMat.dispose();
      glazeMat.dispose();
    }
  }
}
