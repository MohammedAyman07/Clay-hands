import * as THREE from 'three';

export type KilnPhase =
  | 'idle'
  | 'opening-door'
  | 'moving-in'
  | 'closing-door'
  | 'heating'
  | 'transforming'
  | 'cooling'
  | 'opening-reveal'
  | 'revealing'
  | 'complete';

export interface KilnStatus {
  phase: KilnPhase;
  progress: number; // 0..1
  temperatureLabel: string;
  caption: string;
}

const FIRE_PARTICLE_COUNT = 36;

/**
 * Separate magical brick & iron kiln alcove with animated door,
 * interior ember glow, heating coils, and pooled spark particles.
 */
export class KilnController {
  public readonly group = new THREE.Group();
  public readonly hearthAnchor = new THREE.Group();
  public readonly revealPedestal = new THREE.Group();

  private readonly doorPivot = new THREE.Group();
  private readonly glowLight: THREE.PointLight;
  private readonly coilMat: THREE.MeshStandardMaterial;
  private readonly hearthFloorMat: THREE.MeshStandardMaterial;
  private readonly sparkPoints: THREE.Points;
  private readonly sparkPositions: Float32Array;
  private readonly sparkVelocities: Float32Array;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  private running = false;
  private elapsed = 0;
  private duration = 6.2;
  private reducedMotion = false;
  private vesselMesh: THREE.Object3D | null = null;
  private onTransformCallback: (() => void) | null = null;
  private onCompleteCallback: (() => void) | null = null;
  private transformed = false;
  private lastPhase: KilnPhase = 'idle';

  constructor() {
    this.group.name = 'MagicalKiln';

    const brickMat = new THREE.MeshStandardMaterial({
      color: 0x8f513d,
      roughness: 0.88,
      metalness: 0.04,
    });
    const darkBrickMat = new THREE.MeshStandardMaterial({
      color: 0x4b2f28,
      roughness: 0.9,
      metalness: 0.06,
    });
    const ironMat = new THREE.MeshStandardMaterial({
      color: 0x2c2b2e,
      roughness: 0.48,
      metalness: 0.78,
    });
    this.coilMat = new THREE.MeshStandardMaterial({
      color: 0x3b2620,
      emissive: 0xff5a12,
      emissiveIntensity: 0,
      roughness: 0.45,
      metalness: 0.6,
    });
    this.hearthFloorMat = new THREE.MeshStandardMaterial({
      color: 0x5c463d,
      emissive: 0xff4500,
      emissiveIntensity: 0,
      roughness: 0.85,
    });
    this.materials.push(
      brickMat,
      darkBrickMat,
      ironMat,
      this.coilMat,
      this.hearthFloorMat
    );

    // 1. Stone plinth grounded at y = 0
    const plinthGeo = new THREE.BoxGeometry(0.95, 0.56, 0.86);
    this.geometries.push(plinthGeo);
    const plinth = new THREE.Mesh(plinthGeo, darkBrickMat);
    plinth.position.y = 0.28;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    this.group.add(plinth);

    // 2. Kiln chamber outer walls (left, right, back, roof dome)
    const sideGeo = new THREE.BoxGeometry(0.14, 0.62, 0.72);
    const backGeo = new THREE.BoxGeometry(0.84, 0.62, 0.14);
    const roofGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.72, 20, 1, false, 0, Math.PI);
    const chimneyGeo = new THREE.CylinderGeometry(0.08, 0.11, 0.55, 16);
    this.geometries.push(sideGeo, backGeo, roofGeo, chimneyGeo);

    const leftWall = new THREE.Mesh(sideGeo, brickMat);
    leftWall.position.set(-0.35, 0.87, 0);
    leftWall.castShadow = true;

    const rightWall = new THREE.Mesh(sideGeo, brickMat);
    rightWall.position.set(0.35, 0.87, 0);
    rightWall.castShadow = true;

    const backWall = new THREE.Mesh(backGeo, brickMat);
    backWall.position.set(0, 0.87, -0.29);
    backWall.castShadow = true;

    const roof = new THREE.Mesh(roofGeo, brickMat);
    roof.rotation.z = Math.PI / 2;
    roof.rotation.y = Math.PI / 2;
    roof.position.set(0, 1.18, 0);
    roof.castShadow = true;

    const chimney = new THREE.Mesh(chimneyGeo, darkBrickMat);
    chimney.position.set(0, 1.65, -0.1);
    chimney.castShadow = true;

    this.group.add(leftWall, rightWall, backWall, roof, chimney);

    // 3. Iron structural bands
    const bandGeo = new THREE.BoxGeometry(0.87, 0.04, 0.75);
    this.geometries.push(bandGeo);
    const band = new THREE.Mesh(bandGeo, ironMat);
    band.position.set(0, 0.62, 0);
    this.group.add(band);

    // 4. Interior hearth floor & glowing coils
    const hearthGeo = new THREE.BoxGeometry(0.56, 0.04, 0.54);
    const coilGeo = new THREE.TorusGeometry(0.22, 0.012, 8, 28, Math.PI * 1.4);
    this.geometries.push(hearthGeo, coilGeo);

    const hearthFloor = new THREE.Mesh(hearthGeo, this.hearthFloorMat);
    hearthFloor.position.set(0, 0.58, 0.02);
    hearthFloor.receiveShadow = true;
    this.group.add(hearthFloor);

    const coil1 = new THREE.Mesh(coilGeo, this.coilMat);
    coil1.position.set(0, 0.72, -0.02);
    coil1.rotation.x = Math.PI / 2;
    coil1.rotation.z = Math.PI * 0.8;
    const coil2 = new THREE.Mesh(coilGeo, this.coilMat);
    coil2.position.set(0, 0.92, -0.02);
    coil2.rotation.x = Math.PI / 2;
    coil2.rotation.z = Math.PI * 0.8;
    this.group.add(coil1, coil2);

    // 5. Hinged kiln door on left frame
    this.doorPivot.position.set(-0.34, 0.58, 0.36);
    const doorPanelGeo = new THREE.BoxGeometry(0.68, 0.6, 0.055);
    const handleGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.14, 10);
    const windowFrameGeo = new THREE.TorusGeometry(0.08, 0.014, 10, 20);
    this.geometries.push(doorPanelGeo, handleGeo, windowFrameGeo);

    const doorPanel = new THREE.Mesh(doorPanelGeo, ironMat);
    doorPanel.position.set(0.34, 0.3, 0);
    doorPanel.castShadow = true;

    const handle = new THREE.Mesh(handleGeo, brickMat);
    handle.position.set(0.62, 0.3, 0.045);

    const peepFrame = new THREE.Mesh(windowFrameGeo, ironMat);
    peepFrame.position.set(0.34, 0.36, 0.03);

    this.doorPivot.add(doorPanel, handle, peepFrame);
    this.group.add(this.doorPivot);

    // 6. Anchors for pottery inside hearth vs reveal pedestal in front
    this.hearthAnchor.position.set(0, 0.6, 0.02);
    this.revealPedestal.position.set(0, 0.58, 0.78);
    const pedGeo = new THREE.CylinderGeometry(0.18, 0.21, 0.58, 24);
    this.geometries.push(pedGeo);
    const pedMesh = new THREE.Mesh(pedGeo, darkBrickMat);
    pedMesh.position.set(0, 0.29, 0.78);
    pedMesh.receiveShadow = true;
    this.group.add(pedMesh, this.hearthAnchor, this.revealPedestal);

    // 7. Kiln interior magical fire PointLight
    this.glowLight = new THREE.PointLight(0xff6b1a, 0, 3.2, 1.6);
    this.glowLight.position.set(0, 0.85, 0.05);
    this.group.add(this.glowLight);

    // 8. Pooled fire & ember particles
    const sparkGeo = new THREE.BufferGeometry();
    this.sparkPositions = new Float32Array(FIRE_PARTICLE_COUNT * 3);
    this.sparkVelocities = new Float32Array(FIRE_PARTICLE_COUNT);
    for (let i = 0; i < FIRE_PARTICLE_COUNT; i++) {
      this.resetSpark(i);
    }
    sparkGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.sparkPositions, 3)
    );
    this.geometries.push(sparkGeo);

    const sparkMat = new THREE.PointsMaterial({
      color: 0xffa73b,
      size: 0.032,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.materials.push(sparkMat);

    this.sparkPoints = new THREE.Points(sparkGeo, sparkMat);
    this.sparkPoints.frustumCulled = false;
    this.group.add(this.sparkPoints);
  }

  private resetSpark(i: number): void {
    this.sparkPositions[i * 3] = (Math.random() - 0.5) * 0.42;
    this.sparkPositions[i * 3 + 1] = 0.6 + Math.random() * 0.15;
    this.sparkPositions[i * 3 + 2] = (Math.random() - 0.5) * 0.36;
    this.sparkVelocities[i] = 0.25 + Math.random() * 0.45;
  }

  public startFiring(
    vessel: THREE.Object3D,
    options: {
      reducedMotion: boolean;
      onTransform: () => void;
      onComplete: () => void;
    }
  ): void {
    this.vesselMesh = vessel;
    this.reducedMotion = options.reducedMotion;
    this.duration = options.reducedMotion ? 3.2 : 6.2;
    this.onTransformCallback = options.onTransform;
    this.onCompleteCallback = options.onComplete;
    this.elapsed = 0;
    this.transformed = false;
    this.running = true;
    this.lastPhase = 'opening-door';

    // Start vessel on reveal pedestal in front of kiln
    this.revealPedestal.add(vessel);
    vessel.position.set(0, 0, 0);
    vessel.rotation.set(0, 0, 0);
    this.doorPivot.rotation.y = 0;
  }

  public update(dt: number): KilnStatus {
    if (!this.running || !this.vesselMesh) {
      return {
        phase: 'idle',
        progress: 0,
        temperatureLabel: 'Ambient',
        caption: 'Ready to fire',
      };
    }

    this.elapsed += dt;
    const t = Math.min(1, this.elapsed / this.duration);

    let phase: KilnPhase = 'heating';
    let caption = 'Kiln heating...';
    let glow = 0;
    let tempC = 25;

    const sparkMat = this.sparkPoints.material as THREE.PointsMaterial;

    if (t < 0.14) {
      // 1. Open kiln door
      phase = 'opening-door';
      const p = t / 0.14;
      this.doorPivot.rotation.y = -THREE.MathUtils.smoothstep(p, 0, 1) * 1.85;
      caption = 'Opening the kiln door…';
    } else if (t < 0.28) {
      // 2. Move pottery inside hearth
      phase = 'moving-in';
      const p = (t - 0.14) / 0.14;
      const eased = THREE.MathUtils.smoothstep(p, 0, 1);
      if (this.vesselMesh.parent !== this.group) {
        this.group.add(this.vesselMesh);
      }
      this.vesselMesh.position.lerpVectors(
        this.revealPedestal.position,
        this.hearthAnchor.position,
        eased
      );
      caption = 'Placing vessel inside hearth…';
    } else if (t < 0.4) {
      // 3. Close door
      phase = 'closing-door';
      const p = (t - 0.28) / 0.12;
      this.doorPivot.rotation.y = -(1 - THREE.MathUtils.smoothstep(p, 0, 1)) * 1.85;
      caption = 'Sealing the kiln chamber…';
    } else if (t < 0.65) {
      // 4-6. Warm orange glow, heating coils, fire particles
      phase = 'heating';
      const p = (t - 0.4) / 0.25;
      glow = THREE.MathUtils.smoothstep(p, 0, 1);
      tempC = Math.round(25 + glow * 1175);
      caption = 'Magical embers awakening the glaze…';
    } else if (t < 0.74) {
      // 7. Transform glaze
      phase = 'transforming';
      glow = 1.0;
      tempC = 1200;
      if (!this.transformed) {
        this.transformed = true;
        this.onTransformCallback?.();
      }
      caption = 'Glaze vitrifying into luminous ceramic…';
    } else if (t < 0.84) {
      // 8. Cooling down
      phase = 'cooling';
      const p = (t - 0.74) / 0.1;
      glow = 1 - THREE.MathUtils.smoothstep(p, 0, 1) * 0.78;
      tempC = Math.round(1200 - p * 920);
      caption = 'Cooling gently…';
    } else if (t < 0.92) {
      // 9. Open door for reveal
      phase = 'opening-reveal';
      const p = (t - 0.84) / 0.08;
      glow = 0.22 * (1 - p);
      tempC = Math.round(280 - p * 200);
      this.doorPivot.rotation.y = -THREE.MathUtils.smoothstep(p, 0, 1) * 1.85;
      caption = 'Revealing your creation…';
    } else if (t < 1.0) {
      // 10. Glide finished pottery out to pedestal
      phase = 'revealing';
      const p = (t - 0.92) / 0.08;
      const eased = THREE.MathUtils.smoothstep(p, 0, 1);
      this.vesselMesh.position.lerpVectors(
        this.hearthAnchor.position,
        this.revealPedestal.position,
        eased
      );
      tempC = 60;
      caption = 'Fired and luminous!';
    } else {
      phase = 'complete';
      glow = 0;
      tempC = 30;
      this.running = false;
      this.revealPedestal.add(this.vesselMesh);
      this.vesselMesh.position.set(0, 0, 0);
      this.doorPivot.rotation.y = -1.6;
      caption = 'Firing complete!';
      this.onCompleteCallback?.();
    }

    // Apply glow & fire particles
    this.glowLight.intensity = glow * 6.5;
    this.coilMat.emissiveIntensity = glow * 2.8;
    this.hearthFloorMat.emissiveIntensity = glow * 1.4;
    sparkMat.opacity = this.reducedMotion ? glow * 0.45 : glow * 0.9;

    if (glow > 0.05 && !this.reducedMotion) {
      const posAttr = this.sparkPoints.geometry.attributes
        .position as THREE.BufferAttribute;
      for (let i = 0; i < FIRE_PARTICLE_COUNT; i++) {
        this.sparkPositions[i * 3 + 1] += this.sparkVelocities[i] * dt;
        this.sparkPositions[i * 3] += Math.sin(this.elapsed * 4 + i) * 0.08 * dt;
        if (this.sparkPositions[i * 3 + 1] > 1.25) {
          this.resetSpark(i);
        }
      }
      posAttr.needsUpdate = true;
    }

    if (this.vesselMesh && phase === 'revealing') {
      this.vesselMesh.rotation.y += dt * 0.8;
    }

    this.lastPhase = phase;
    return {
      phase: this.lastPhase,
      progress: t,
      temperatureLabel: `${tempC}°C`,
      caption,
    };
  }

  public dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
