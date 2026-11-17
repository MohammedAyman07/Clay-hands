import * as THREE from 'three';

function createWheelHeadTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const cx = size / 2;
    const cy = size / 2;
    const grad = ctx.createRadialGradient(cx, cy, 8, cx, cy, cx);
    grad.addColorStop(0, '#c8c5be');
    grad.addColorStop(0.7, '#ada9a0');
    grad.addColorStop(1, '#8c8880');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Subtle concentric centering grooves
    ctx.strokeStyle = 'rgba(55, 52, 48, 0.55)';
    ctx.lineWidth = 2;
    for (let r = 42; r < cx - 18; r += 36) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Center crosshairs
    ctx.strokeStyle = 'rgba(55, 52, 48, 0.32)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 28, cy);
    ctx.lineTo(cx + 28, cy);
    ctx.moveTo(cx, cy - 28);
    ctx.lineTo(cx, cy + 28);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createWoodBatTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#9b734e';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < size; i += 3) {
      const shade = Math.sin(i * 0.14) * 14 + (Math.random() - 0.5) * 10;
      ctx.fillStyle = `rgb(${150 + shade}, ${112 + shade * 0.75}, ${74 + shade * 0.5})`;
      ctx.fillRect(0, i, size, 3);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Composite 7-part 3D pottery wheel assembly grounded at y = 0.
 * The spinning head & wooden bat rotate independently around Y.
 */
export class PotteryWheel {
  public readonly group = new THREE.Group();
  public readonly spinnerGroup = new THREE.Group();
  public readonly clayMount = new THREE.Group();

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];

  public readonly wheelSurfaceY = 0.765;
  public rpm = 65;

  constructor(maxAnisotropy = 4) {
    this.group.name = 'PotteryWheel';
    this.build(maxAnisotropy);
  }

  private build(maxAnisotropy: number): void {
    const ironMat = new THREE.MeshStandardMaterial({
      color: 0x353230,
      roughness: 0.55,
      metalness: 0.65,
    });
    const oakMat = new THREE.MeshStandardMaterial({
      color: 0x6e4f37,
      roughness: 0.72,
      metalness: 0.04,
    });
    const panMat = new THREE.MeshStandardMaterial({
      color: 0xd9cfc1,
      roughness: 0.42,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xb88b4a,
      roughness: 0.32,
      metalness: 0.82,
    });

    const wheelTex = createWheelHeadTexture();
    wheelTex.anisotropy = maxAnisotropy;
    const batTex = createWoodBatTexture();
    batTex.anisotropy = maxAnisotropy;
    this.textures.push(wheelTex, batTex);

    const headMat = new THREE.MeshStandardMaterial({
      map: wheelTex,
      roughness: 0.34,
      metalness: 0.72,
    });
    const batMat = new THREE.MeshStandardMaterial({
      map: batTex,
      roughness: 0.78,
      metalness: 0.02,
    });

    this.materials.push(ironMat, oakMat, panMat, brassMat, headMat, batMat);

    // 1. Tripod cast-iron & oak legs (grounded at y = 0)
    const legGeo = new THREE.CylinderGeometry(0.026, 0.032, 0.66, 14);
    const footGeo = new THREE.CylinderGeometry(0.042, 0.046, 0.024, 16);
    this.geometries.push(legGeo, footGeo);

    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const r = 0.31;
      const leg = new THREE.Mesh(legGeo, ironMat);
      leg.position.set(Math.cos(angle) * r, 0.33, Math.sin(angle) * r);
      leg.rotation.z = Math.cos(angle) * 0.08;
      leg.rotation.x = -Math.sin(angle) * 0.08;
      leg.castShadow = true;
      leg.receiveShadow = true;

      const foot = new THREE.Mesh(footGeo, oakMat);
      foot.position.set(Math.cos(angle) * (r + 0.025), 0.012, Math.sin(angle) * (r + 0.025));
      foot.receiveShadow = true;

      this.group.add(leg, foot);
    }

    // 2. Motor body & oak table deck
    const deckGeo = new THREE.CylinderGeometry(0.36, 0.34, 0.065, 32);
    const motorGeo = new THREE.CylinderGeometry(0.14, 0.16, 0.24, 24);
    this.geometries.push(deckGeo, motorGeo);

    const deck = new THREE.Mesh(deckGeo, oakMat);
    deck.position.y = 0.65;
    deck.castShadow = true;
    deck.receiveShadow = true;

    const motor = new THREE.Mesh(motorGeo, ironMat);
    motor.position.y = 0.51;
    motor.castShadow = true;
    this.group.add(deck, motor);

    // 3. Curved Splash Pan (LatheGeometry)
    const panPoints = [
      new THREE.Vector2(0.06, 0.682),
      new THREE.Vector2(0.285, 0.682),
      new THREE.Vector2(0.32, 0.72),
      new THREE.Vector2(0.325, 0.778),
      new THREE.Vector2(0.308, 0.778),
      new THREE.Vector2(0.305, 0.715),
      new THREE.Vector2(0.06, 0.695),
    ];
    const panGeo = new THREE.LatheGeometry(panPoints, 40);
    this.geometries.push(panGeo);
    const splashPan = new THREE.Mesh(panGeo, panMat);
    splashPan.castShadow = true;
    splashPan.receiveShadow = true;
    this.group.add(splashPan);

    // 4. Brass drive spindle collar
    const collarGeo = new THREE.CylinderGeometry(0.036, 0.042, 0.06, 20);
    this.geometries.push(collarGeo);
    const collar = new THREE.Mesh(collarGeo, brassMat);
    collar.position.y = 0.71;
    this.group.add(collar);

    // 5. Spinning Wheel Head + Wooden Bat
    this.spinnerGroup.position.y = 0.742;
    const headGeo = new THREE.CylinderGeometry(0.245, 0.242, 0.022, 44);
    const batGeo = new THREE.CylinderGeometry(0.195, 0.198, 0.014, 40);
    this.geometries.push(headGeo, batGeo);

    const wheelHead = new THREE.Mesh(headGeo, headMat);
    wheelHead.castShadow = true;
    wheelHead.receiveShadow = true;

    const bat = new THREE.Mesh(batGeo, batMat);
    bat.position.y = 0.016;
    bat.receiveShadow = true;

    this.spinnerGroup.add(wheelHead, bat);

    // Clay sits directly on top of the wooden bat (local y = 0.023 -> world y = 0.765)
    this.clayMount.position.y = 0.023;
    this.spinnerGroup.add(this.clayMount);
    this.group.add(this.spinnerGroup);

    // 6. Brass & iron foot pedal on floor to the right
    const pedalBaseGeo = new THREE.BoxGeometry(0.11, 0.025, 0.22);
    const pedalTopGeo = new THREE.BoxGeometry(0.09, 0.018, 0.18);
    this.geometries.push(pedalBaseGeo, pedalTopGeo);

    const pedalBase = new THREE.Mesh(pedalBaseGeo, ironMat);
    pedalBase.position.set(0.36, 0.013, 0.18);
    pedalBase.receiveShadow = true;

    const pedalTop = new THREE.Mesh(pedalTopGeo, brassMat);
    pedalTop.position.set(0.36, 0.038, 0.18);
    pedalTop.rotation.x = 0.18;
    pedalTop.castShadow = true;

    this.group.add(pedalBase, pedalTop);
  }

  public update(dt: number, speedMultiplier: number, isSpinning: boolean): void {
    if (!isSpinning) return;
    const angularSpeed = (this.rpm / 60) * Math.PI * 2 * speedMultiplier;
    this.spinnerGroup.rotation.y += angularSpeed * dt;
  }

  public dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
  }
}
