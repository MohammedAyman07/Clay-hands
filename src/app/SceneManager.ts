import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type CameraPreset =
  | 'welcome'
  | 'studio'
  | 'name-studio'
  | 'glaze'
  | 'kiln'
  | 'gallery';

const PRESET_TARGETS: Record<
  CameraPreset,
  { pos: THREE.Vector3; target: THREE.Vector3 }
> = {
  welcome: {
    pos: new THREE.Vector3(0.55, 1.38, 1.25),
    target: new THREE.Vector3(0.08, 0.88, 0),
  },
  studio: {
    pos: new THREE.Vector3(0, 1.15, 0.9),
    target: new THREE.Vector3(0, 0.81, 0),
  },
  'name-studio': {
    pos: new THREE.Vector3(0, 1.16, 0.86),
    target: new THREE.Vector3(0, 0.90, 0.02),
  },
  glaze: {
    pos: new THREE.Vector3(0.22, 1.03, 0.8),
    target: new THREE.Vector3(0, 0.78, 0),
  },
  kiln: {
    pos: new THREE.Vector3(1.55, 1.22, 1.48),
    target: new THREE.Vector3(1.85, 0.86, -0.35),
  },
  gallery: {
    pos: new THREE.Vector3(-1.35, 1.25, 0.92),
    target: new THREE.Vector3(-1.65, 0.94, -0.35),
  },
};

function createWoodGrainTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#7e5a3d';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 2) {
      const wave = Math.sin(y * 0.045) * 10 + Math.cos(y * 0.13) * 6;
      const r = Math.min(255, Math.max(0, 126 + wave));
      const g = Math.min(255, Math.max(0, 90 + wave * 0.78));
      const b = Math.min(255, Math.max(0, 61 + wave * 0.58));
      ctx.fillStyle = `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
      ctx.fillRect(0, y, size, 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

function createPlasterFloorTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#cfc3b0';
    ctx.fillRect(0, 0, size, size);
    // Subtle stone/terracotta tile seams
    ctx.strokeStyle = 'rgba(110, 95, 80, 0.22)';
    ctx.lineWidth = 3;
    const step = size / 4;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * step);
      ctx.lineTo(size, i * step);
      ctx.stroke();
    }
    for (let i = 0; i < 1600; i++) {
      ctx.fillStyle =
        Math.random() > 0.5
          ? 'rgba(90, 78, 65, 0.06)'
          : 'rgba(255, 250, 240, 0.06)';
      ctx.fillRect(Math.random() * size, Math.random() * size, 3, 3);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  return tex;
}

function createDustTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255, 244, 214, 0.9)');
    grad.addColorStop(0.5, 'rgba(255, 232, 185, 0.35)');
    grad.addColorStop(1, 'rgba(255, 232, 185, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class SceneManager {
  public readonly studioGroup = new THREE.Group();
  public readonly kilnPosition = new THREE.Vector3(1.85, 0, -0.35);
  public readonly galleryPosition = new THREE.Vector3(-1.65, 0, -0.35);
  public readonly galleryGroup = new THREE.Group();
  public readonly galleryPedestalAnchor = new THREE.Group();
  public controls: OrbitControls | null = null;

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private envRT: THREE.WebGLRenderTarget | null = null;

  private dustPoints: THREE.Points | null = null;
  private dustBasePositions: Float32Array | null = null;
  private currentPreset: CameraPreset = 'welcome';
  private transitioningCamera = false;
  private reducedMotion = false;
  private elapsed = 0;

  private readonly _targetPos = new THREE.Vector3();
  private readonly _targetLook = new THREE.Vector3();

  public init(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    isSoftwareGl: boolean
  ): void {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 1.75)
    );
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = this.envRT.texture;
    pmrem.dispose();

    const horizonColor = 0xe8dac6;
    scene.background = new THREE.Color(horizonColor);
    scene.fog = new THREE.FogExp2(horizonColor, 0.055);

    this.setupLighting(scene, isSoftwareGl);
    this.buildWorkshopRoom(renderer.capabilities.getMaxAnisotropy(), isSoftwareGl);
    scene.add(this.studioGroup);

    // Camera & OrbitControls (enabled for inspection in Glaze/Gallery or right-drag)
    camera.fov = 46;
    camera.near = 0.05;
    camera.far = 40;
    camera.updateProjectionMatrix();
    camera.position.copy(PRESET_TARGETS.welcome.pos);

    this.controls = new OrbitControls(camera, renderer.domElement);
    this.controls.enableDamping = !isSoftwareGl;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.45;
    this.controls.maxDistance = 3.6;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minPolarAngle = 0.25;
    this.controls.target.copy(PRESET_TARGETS.welcome.target);
    this.controls.enabled = false;
    this.controls.addEventListener('start', () => {
      this.transitioningCamera = false;
    });
  }

  private setupLighting(scene: THREE.Scene, isSoftwareGl: boolean): void {
    // Cool sky / warm terracotta floor hemisphere fill
    const hemi = new THREE.HemisphereLight(0xfff4e0, 0x8d6f56, 1.35);
    scene.add(hemi);

    // Warm sunlight entering from left studio window
    const sunKey = new THREE.DirectionalLight(0xffe6bd, 2.35);
    sunKey.position.set(-3.4, 3.8, 2.4);
    if (!isSoftwareGl) {
      sunKey.castShadow = true;
      sunKey.shadow.mapSize.set(1024, 1024);
      sunKey.shadow.camera.near = 0.5;
      sunKey.shadow.camera.far = 12;
      const d = 2.8;
      sunKey.shadow.camera.left = -d;
      sunKey.shadow.camera.right = d;
      sunKey.shadow.camera.top = d;
      sunKey.shadow.camera.bottom = -d;
      sunKey.shadow.bias = -0.0005;
      sunKey.shadow.normalBias = 0.02;
    }
    scene.add(sunKey);

    // Subtle cool rim light from back-right to sculpt silhouettes
    const rimLight = new THREE.DirectionalLight(0xd9e8ff, 0.72);
    rimLight.position.set(2.8, 2.2, -2.6);
    scene.add(rimLight);
  }

  private buildWorkshopRoom(
    maxAnisotropy: number,
    isSoftwareGl: boolean
  ): void {
    const floorTex = createPlasterFloorTexture();
    floorTex.anisotropy = maxAnisotropy;
    const woodTex = createWoodGrainTexture();
    woodTex.anisotropy = maxAnisotropy;
    const dustTex = createDustTexture();
    this.textures.push(floorTex, woodTex, dustTex);

    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.85,
      metalness: 0.02,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xe6d6be,
      roughness: 0.92,
      metalness: 0,
    });
    const woodMat = new THREE.MeshStandardMaterial({
      map: woodTex,
      roughness: 0.72,
      metalness: 0.04,
    });
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0xb7aa98,
      roughness: 0.86,
      metalness: 0.02,
    });
    const ceramicAccentMat = new THREE.MeshStandardMaterial({
      color: 0x3b6e75,
      roughness: 0.25,
      metalness: 0.05,
    });
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0x567754,
      roughness: 0.65,
      metalness: 0.02,
    });
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x99c4cf,
      roughness: 0.12,
      metalness: 0.1,
      transparent: true,
      opacity: 0.72,
    });
    this.materials.push(
      floorMat,
      wallMat,
      woodMat,
      stoneMat,
      ceramicAccentMat,
      leafMat,
      waterMat
    );

    // 1. Stone workshop floor
    const floorGeo = new THREE.PlaneGeometry(14, 14);
    this.geometries.push(floorGeo);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.studioGroup.add(floor);

    // 2. Back plaster wall + side window wall
    const backWallGeo = new THREE.PlaneGeometry(12, 5);
    const sideWallGeo = new THREE.PlaneGeometry(10, 5);
    this.geometries.push(backWallGeo, sideWallGeo);

    const backWall = new THREE.Mesh(backWallGeo, wallMat);
    backWall.position.set(0, 2.5, -2.5);
    backWall.receiveShadow = true;

    const leftWall = new THREE.Mesh(sideWallGeo, wallMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-3.4, 2.5, 0);
    leftWall.receiveShadow = true;
    this.studioGroup.add(backWall, leftWall);

    // 3. Sunlit studio window frame on left wall + warm sunbeam plane
    const frameBarGeo = new THREE.BoxGeometry(0.08, 1.8, 0.08);
    const sillGeo = new THREE.BoxGeometry(0.22, 0.06, 1.5);
    const paneMat = new THREE.MeshBasicMaterial({
      color: 0xfff3d4,
      transparent: true,
      opacity: 0.85,
    });
    const paneGeo = new THREE.PlaneGeometry(1.36, 1.72);
    this.geometries.push(frameBarGeo, sillGeo, paneGeo);
    this.materials.push(paneMat);

    const windowGroup = new THREE.Group();
    windowGroup.position.set(-3.36, 1.75, -0.5);
    windowGroup.rotation.y = Math.PI / 2;
    const pane = new THREE.Mesh(paneGeo, paneMat);
    const sill = new THREE.Mesh(sillGeo, woodMat);
    sill.rotation.y = Math.PI / 2;
    sill.position.set(0, -0.88, 0.06);
    const vBar = new THREE.Mesh(frameBarGeo, woodMat);
    windowGroup.add(pane, sill, vBar);
    this.studioGroup.add(windowGroup);

    // 4. Potter's Oak Side Workbench (behind-left of wheel for tools & water bowl)
    const benchTopGeo = new THREE.BoxGeometry(1.45, 0.05, 0.58);
    const benchLegGeo = new THREE.BoxGeometry(0.06, 0.72, 0.06);
    this.geometries.push(benchTopGeo, benchLegGeo);

    const bench = new THREE.Group();
    bench.position.set(-1.15, 0, -0.95);
    bench.rotation.y = 0.25;
    const benchTop = new THREE.Mesh(benchTopGeo, woodMat);
    benchTop.position.y = 0.74;
    benchTop.castShadow = true;
    benchTop.receiveShadow = true;
    bench.add(benchTop);

    for (const lx of [-0.64, 0.64]) {
      for (const lz of [-0.22, 0.22]) {
        const leg = new THREE.Mesh(benchLegGeo, woodMat);
        leg.position.set(lx, 0.36, lz);
        leg.castShadow = true;
        bench.add(leg);
      }
    }

    // Water bowl on bench
    const bowlPts = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.065, 0),
      new THREE.Vector2(0.095, 0.075),
      new THREE.Vector2(0.086, 0.075),
      new THREE.Vector2(0.056, 0.014),
      new THREE.Vector2(0, 0.014),
    ];
    const bowlGeo = new THREE.LatheGeometry(bowlPts, 24);
    const waterDiscGeo = new THREE.CircleGeometry(0.078, 20);
    const spongeGeo = new THREE.SphereGeometry(0.028, 12, 10);
    this.geometries.push(bowlGeo, waterDiscGeo, spongeGeo);

    const waterBowl = new THREE.Mesh(bowlGeo, stoneMat);
    waterBowl.position.set(0.32, 0.765, 0.06);
    waterBowl.castShadow = true;
    const waterDisc = new THREE.Mesh(waterDiscGeo, waterMat);
    waterDisc.rotation.x = -Math.PI / 2;
    waterDisc.position.set(0.32, 0.82, 0.06);

    const ribToolGeo = new THREE.BoxGeometry(0.09, 0.008, 0.045);
    this.geometries.push(ribToolGeo);
    const ribTool = new THREE.Mesh(ribToolGeo, woodMat);
    ribTool.position.set(0.12, 0.77, 0.14);
    ribTool.rotation.y = 0.4;

    // Potted studio plant on left end of bench
    const potPts = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.055, 0),
      new THREE.Vector2(0.075, 0.13),
      new THREE.Vector2(0.068, 0.13),
      new THREE.Vector2(0.048, 0.02),
      new THREE.Vector2(0, 0.02),
    ];
    const plantPotGeo = new THREE.LatheGeometry(potPts, 20);
    const leafGeo = new THREE.ConeGeometry(0.04, 0.16, 7);
    this.geometries.push(plantPotGeo, leafGeo);

    const plantPot = new THREE.Mesh(plantPotGeo, ceramicAccentMat);
    plantPot.position.set(-0.46, 0.765, -0.05);
    plantPot.castShadow = true;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(
        -0.46 + Math.cos(a) * 0.03,
        0.92,
        -0.05 + Math.sin(a) * 0.03
      );
      leaf.rotation.z = -Math.cos(a) * 0.45;
      leaf.rotation.x = Math.sin(a) * 0.45;
      bench.add(leaf);
    }

    bench.add(waterBowl, waterDisc, ribTool, plantPot);
    this.studioGroup.add(bench);

    // 5. Back wooden display shelf with studio sample vessels
    const shelfGeo = new THREE.BoxGeometry(1.9, 0.04, 0.3);
    const sampleVaseGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.05, 0),
        new THREE.Vector2(0.08, 0.09),
        new THREE.Vector2(0.04, 0.17),
        new THREE.Vector2(0.052, 0.21),
      ],
      20
    );
    this.geometries.push(shelfGeo, sampleVaseGeo);

    const shelf = new THREE.Mesh(shelfGeo, woodMat);
    shelf.position.set(-0.2, 1.48, -2.32);
    shelf.castShadow = true;
    shelf.receiveShadow = true;
    this.studioGroup.add(shelf);

    const shelfVase = new THREE.Mesh(sampleVaseGeo, ceramicAccentMat);
    shelfVase.position.set(-0.65, 1.5, -2.32);
    shelfVase.castShadow = true;
    const shelfBowl = new THREE.Mesh(bowlGeo, stoneMat);
    shelfBowl.position.set(0.25, 1.5, -2.32);
    shelfBowl.castShadow = true;
    this.studioGroup.add(shelfVase, shelfBowl);

    // 6. Gallery Display Pedestal on the left side of the studio
    const galPedGeo = new THREE.CylinderGeometry(0.22, 0.25, 0.8, 28);
    const galTopGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.025, 28);
    this.geometries.push(galPedGeo, galTopGeo);

    const galGroup = this.galleryGroup;
    galGroup.position.copy(this.galleryPosition);
    const galPed = new THREE.Mesh(galPedGeo, stoneMat);
    galPed.position.y = 0.4;
    galPed.castShadow = true;
    galPed.receiveShadow = true;
    const galTop = new THREE.Mesh(galTopGeo, woodMat);
    galTop.position.y = 0.812;
    galTop.receiveShadow = true;
    this.galleryPedestalAnchor.position.set(0, 0.825, 0);
    galGroup.add(galPed, galTop, this.galleryPedestalAnchor);
    this.studioGroup.add(galGroup);

    // 7. Subtle floating sunlit dust particles (low count for Intel Iris Xe)
    const count = isSoftwareGl ? 32 : 56;
    const dustGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    this.dustBasePositions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 3.8;
      const y = 0.55 + Math.random() * 1.9;
      const z = (Math.random() - 0.5) * 2.8;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      this.dustBasePositions[i * 3] = x;
      this.dustBasePositions[i * 3 + 1] = y;
      this.dustBasePositions[i * 3 + 2] = z;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geometries.push(dustGeo);

    const dustMat = new THREE.PointsMaterial({
      map: dustTex,
      size: 0.032,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.materials.push(dustMat);
    this.dustPoints = new THREE.Points(dustGeo, dustMat);
    this.dustPoints.frustumCulled = false;
    this.studioGroup.add(this.dustPoints);
  }

  public setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (this.controls) {
      this.controls.enableDamping = !reduced;
    }
  }

  public setCameraPreset(preset: CameraPreset, allowOrbit: boolean): void {
    this.currentPreset = preset;
    this.transitioningCamera = true;
    const targetCfg = PRESET_TARGETS[preset];
    this._targetPos.copy(targetCfg.pos);
    this._targetLook.copy(targetCfg.target);
    if (this.controls) {
      this.controls.enabled = allowOrbit;
    }
  }

  public setGalleryFraming(vesselCount: number, smashMode: boolean): void {
    this.currentPreset = 'gallery';
    this.transitioningCamera = true;
    if (smashMode && vesselCount > 1) {
      const pull = vesselCount <= 3 ? 0.34 : vesselCount <= 5 ? 0.62 : 0.85;
      this._targetPos.set(-1.32 + pull * 0.14, 1.32 + pull * 0.16, 0.96 + pull);
      this._targetLook.set(-1.65, 0.94, -0.26);
    } else {
      this._targetPos.copy(PRESET_TARGETS.gallery.pos);
      this._targetLook.copy(PRESET_TARGETS.gallery.target);
    }
  }

  public setOrbitEnabled(enabled: boolean): void {
    if (this.controls) {
      this.controls.enabled = enabled;
    }
  }

  public update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    isInXR: boolean,
    isWelcomeScreen: boolean
  ): void {
    this.elapsed += dt;

    // Animate subtle dust motes
    if (this.dustPoints && this.dustBasePositions && !this.reducedMotion) {
      const attr = this.dustPoints.geometry.attributes
        .position as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const count = arr.length / 3;
      for (let i = 0; i < count; i++) {
        arr[i * 3] =
          this.dustBasePositions[i * 3] + Math.sin(this.elapsed * 0.35 + i) * 0.06;
        arr[i * 3 + 1] =
          this.dustBasePositions[i * 3 + 1] +
          Math.cos(this.elapsed * 0.28 + i * 1.3) * 0.045;
      }
      attr.needsUpdate = true;
    }

    if (isInXR) return;

    // Gentle atmospheric hero camera pan on Welcome screen
    if (isWelcomeScreen && this.currentPreset === 'welcome' && !this.reducedMotion) {
      const base = PRESET_TARGETS.welcome;
      const swayX = Math.sin(this.elapsed * 0.25) * 0.24;
      const swayY = Math.cos(this.elapsed * 0.18) * 0.04;
      this._targetPos.set(base.pos.x + swayX, base.pos.y + swayY, base.pos.z);
      this._targetLook.copy(base.target);
      this.transitioningCamera = true;
    }

    if (this.transitioningCamera) {
      const lambda = this.reducedMotion ? 16 : 5.2;
      camera.position.x = THREE.MathUtils.damp(
        camera.position.x,
        this._targetPos.x,
        lambda,
        dt
      );
      camera.position.y = THREE.MathUtils.damp(
        camera.position.y,
        this._targetPos.y,
        lambda,
        dt
      );
      camera.position.z = THREE.MathUtils.damp(
        camera.position.z,
        this._targetPos.z,
        lambda,
        dt
      );

      if (this.controls) {
        this.controls.target.x = THREE.MathUtils.damp(
          this.controls.target.x,
          this._targetLook.x,
          lambda,
          dt
        );
        this.controls.target.y = THREE.MathUtils.damp(
          this.controls.target.y,
          this._targetLook.y,
          lambda,
          dt
        );
        this.controls.target.z = THREE.MathUtils.damp(
          this.controls.target.z,
          this._targetLook.z,
          lambda,
          dt
        );
      } else {
        camera.lookAt(this._targetLook);
      }

      if (
        !isWelcomeScreen &&
        camera.position.distanceTo(this._targetPos) < 0.008
      ) {
        this.transitioningCamera = false;
      }
    }

    this.controls?.update();
  }

  public dispose(): void {
    this.controls?.dispose();
    this.envRT?.dispose();
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
  }
}
