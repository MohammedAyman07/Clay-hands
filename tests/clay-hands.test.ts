import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PotteryStorage,
  type StorageLike,
} from '../src/gallery/PotteryStorage.ts';
import { ClayDeformer } from '../src/pottery/ClayDeformer.ts';
import { ClayGeometry } from '../src/pottery/ClayGeometry.ts';
import { ClaySculptingController } from '../src/pottery/ClaySculptingController.ts';
import {
  interpolateWrappedUVStroke,
  VesselPainter,
  VILLAGE_PIGMENTS,
} from '../src/pottery/VesselPainter.ts';
import {
  HandBrushTracker,
  mapHandTipToBrushNDC,
  selectBrushHand,
} from '../src/pottery/HandBrushMapper.ts';
import {
  CHALLENGE_PRESETS,
  CLAY_LIMITS,
  createInitialClayProfile,
} from '../src/pottery/PotteryPresets.ts';
import {
  computeSimilarityScore,
  generatePotteryPersonality,
  measureVessel,
} from '../src/pottery/PotteryProfile.ts';
import { GestureRecognizer } from '../src/tracking/GestureRecognizer.ts';
import { createDefaultCalibration } from '../src/tracking/HandCalibration.ts';
import { mapWebcamToWheelSpace } from '../src/tracking/HandInputMapper.ts';
import type { SavedPotteryItem, SmoothedHand } from '../src/types.ts';

function makeHand(
  handedness: 'left' | 'right',
  overrides: Partial<SmoothedHand> = {}
): SmoothedHand {
  const x = handedness === 'left' ? 0.36 : 0.64;
  return {
    handedness,
    confidence: 0.95,
    palmCenter: { x, y: 0.5, z: 0 },
    wrist: { x, y: 0.62, z: 0 },
    thumbTip: { x: x + 0.04, y: 0.45, z: 0 },
    indexTip: { x: x + 0.01, y: 0.35, z: 0 },
    middleTip: { x, y: 0.33, z: 0 },
    ringTip: { x: x - 0.01, y: 0.35, z: 0 },
    pinkyTip: { x: x - 0.03, y: 0.38, z: 0 },
    pinchDistance: 0.1,
    handSpan: 0.15,
    fingerCurl: 0.2,
    velocity: { x: 0, y: 0, z: 0 },
    speed: 0,
    inInteractionZone: true,
    landmarks: [],
    ...overrides,
  };
}

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  public getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  public setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

test('GestureRecognizer detects compress, widen, raise, pinch, smooth, one-side, and idle', () => {
  const cal = createDefaultCalibration();
  const recognizer = new GestureRecognizer();

  // Idle when no hands in zone
  const idle = recognizer.recognize([], cal, 'shape');
  assert.equal(idle.gesture, 'idle');

  // Compress when palms close together
  const compress = recognizer.recognize(
    [
      makeHand('left', { palmCenter: { x: 0.44, y: 0.5, z: 0 }, speed: 0.08 }),
      makeHand('right', { palmCenter: { x: 0.56, y: 0.5, z: 0 }, speed: 0.08 }),
    ],
    cal,
    'shape'
  );
  assert.equal(compress.gesture, 'compress');

  // Widen when palms spread apart
  const widen = recognizer.recognize(
    [
      makeHand('left', { palmCenter: { x: 0.24, y: 0.5, z: 0 }, speed: 0.08 }),
      makeHand('right', { palmCenter: { x: 0.76, y: 0.5, z: 0 }, speed: 0.08 }),
    ],
    cal,
    'shape'
  );
  assert.equal(widen.gesture, 'widen');

  // Raise when both hands move upward
  const raise = recognizer.recognize(
    [
      makeHand('left', {
        palmCenter: { x: 0.38, y: 0.45, z: 0 },
        velocity: { x: 0, y: 0.16, z: 0 },
        speed: 0.16,
      }),
      makeHand('right', {
        palmCenter: { x: 0.62, y: 0.45, z: 0 },
        velocity: { x: 0, y: 0.16, z: 0 },
        speed: 0.16,
      }),
    ],
    cal,
    'shape'
  );
  assert.equal(raise.gesture, 'raise');

  // Pinch detection & hysteresis release
  const pinch = recognizer.recognize(
    [
      makeHand('left', { pinchDistance: 0.03, handSpan: 0.15 }),
      makeHand('right', { pinchDistance: 0.11, handSpan: 0.15 }),
    ],
    cal,
    'shape'
  );
  assert.equal(pinch.gesture, 'pinch_neck');
  assert.equal(pinch.isPinching, true);

  // Release pinch past exit threshold while holding steady position
  const released = recognizer.recognize(
    [
      makeHand('left', {
        palmCenter: { x: 0.36, y: 0.5, z: 0 },
        pinchDistance: 0.09,
        handSpan: 0.15,
        speed: 0.01,
      }),
      makeHand('right', {
        palmCenter: { x: 0.64, y: 0.5, z: 0 },
        pinchDistance: 0.09,
        handSpan: 0.15,
        speed: 0.01,
      }),
    ],
    cal,
    'smooth'
  );
  assert.equal(released.isPinching, false);
  assert.equal(released.gesture, 'smooth');

  // Single hand active -> one_side
  const oneSide = recognizer.recognize(
    [makeHand('right', { speed: 0.06 })],
    cal,
    'shape'
  );
  assert.equal(oneSide.gesture, 'one_side');
});

test('Hand coordinate mapping maps webcam center & vertical range cleanly', () => {
  const cal = createDefaultCalibration();
  const centerPt = mapWebcamToWheelSpace(cal.centerX, cal.maxY, cal, 0.2);
  assert.ok(Math.abs(centerPt.x) < 0.001);
  assert.ok(centerPt.y < 0.02);

  const highRight = mapWebcamToWheelSpace(
    cal.centerX + 0.25,
    cal.minY,
    cal,
    0.2
  );
  assert.ok(highRight.x > 0.1);
  assert.ok(Math.abs(highRight.y - 0.2) < 0.01);
});

test('ClayDeformer updates clay profile and enforces radius & height limits', () => {
  const profile = createInitialClayProfile();
  const midIdx = Math.floor(profile.ringCount / 2);
  const initialMidR = profile.outerRadii[midIdx];

  // Widen
  for (let i = 0; i < 15; i++) {
    ClayDeformer.widen(profile, { heightNorm: 0.5, strength: 1, dt: 0.05 });
  }
  assert.ok(profile.outerRadii[midIdx] > initialMidR);

  // Compress toward minRadius limit
  for (let i = 0; i < 200; i++) {
    ClayDeformer.compress(profile, { heightNorm: 0.5, strength: 1, dt: 0.05 });
  }
  for (const r of profile.outerRadii) {
    assert.ok(r >= CLAY_LIMITS.minRadius);
    assert.ok(r <= CLAY_LIMITS.maxRadius);
  }

  // Widen toward maxRadius limit
  for (let i = 0; i < 250; i++) {
    ClayDeformer.widen(profile, { heightNorm: 0.5, strength: 1, dt: 0.05 });
  }
  for (const r of profile.outerRadii) {
    assert.ok(r <= CLAY_LIMITS.maxRadius);
  }

  // Raise toward maxHeight limit
  for (let i = 0; i < 200; i++) {
    ClayDeformer.raise(profile, { heightNorm: 0.7, strength: 1, dt: 0.05 });
  }
  const finalH = profile.heights[profile.ringCount - 1] - profile.heights[0];
  assert.ok(finalH <= CLAY_LIMITS.maxHeight + 1e-6);
  assert.ok(finalH >= CLAY_LIMITS.minHeight);

  // Open interior deepens hollow floor
  const startOpen = profile.openDepth;
  for (let i = 0; i < 20; i++) {
    ClayDeformer.openClay(profile, { heightNorm: 0.85, strength: 1, dt: 0.05 });
  }
  assert.ok(profile.openDepth > startOpen);
});

test('ClayGeometry builds manifold vertices and finite normals including hollow interior', () => {
  const profile = createInitialClayProfile();
  profile.openDepth = 0.9;
  const clayGeo = new ClayGeometry(profile.ringCount, profile.angularSegments);
  clayGeo.updateFromProfile(profile, 0);

  const pos = clayGeo.geometry.attributes.position;
  const norm = clayGeo.geometry.attributes.normal;
  assert.ok(pos.count > 100);
  assert.equal(pos.count, norm.count);

  for (let i = 0; i < pos.count * 3; i++) {
    assert.ok(Number.isFinite(pos.array[i]));
    assert.ok(Number.isFinite(norm.array[i]));
  }
  clayGeo.dispose();
});

test('ClaySculptingController supports undo and reset', () => {
  const controller = new ClaySculptingController();
  const initialR = controller.profile.outerRadii[16];

  controller.applyGesture(
    {
      gesture: 'widen',
      strength: 1,
      activeHeightNorm: 0.5,
      activeAngle: 0,
      targetRadiusNorm: 0.8,
      isPinching: false,
      handsCount: 2,
      inZone: true,
      description: 'Widening',
    },
    0.05
  );
  assert.ok(controller.profile.outerRadii[16] > initialR);
  assert.equal(controller.canUndo, true);

  assert.equal(controller.undo(), true);
  assert.ok(Math.abs(controller.profile.outerRadii[16] - initialR) < 1e-5);

  controller.applyGesture(
    {
      gesture: 'raise',
      strength: 1,
      activeHeightNorm: 0.6,
      activeAngle: 0,
      targetRadiusNorm: 0.5,
      isPinching: false,
      handsCount: 2,
      inZone: true,
      description: 'Raising',
    },
    0.05
  );
  controller.reset();
  assert.equal(controller.canUndo, false);
  assert.equal(controller.stage, 'center');
  controller.dispose();
});

test('PotteryProfile generates shape-based names and similarity scores', () => {
  const bowl = createInitialClayProfile();
  for (let i = 0; i < bowl.ringCount; i++) {
    const t = i / (bowl.ringCount - 1);
    bowl.outerRadii[i] = 0.05 + 0.08 * t;
    bowl.heights[i] = t * 0.095;
  }
  const bowlPersonality = generatePotteryPersonality(bowl);
  assert.equal(bowlPersonality.archetype, 'Open Bowl');

  const preset = CHALLENGE_PRESETS[0];
  const exact = createInitialClayProfile();
  for (let i = 0; i < exact.ringCount; i++) {
    exact.outerRadii[i] = preset.targetRadii[i];
    exact.heights[i] = (i / (exact.ringCount - 1)) * preset.targetHeight;
  }
  exact.openDepth = preset.openDepth;
  const sim = computeSimilarityScore(exact, preset);
  assert.ok(sim.score >= 95);
});

test('PotteryStorage saves, loads, renames, deletes, and handles corrupt data', () => {
  const mem = new MemoryStorage();
  const storage = new PotteryStorage(mem);
  const profile = createInitialClayProfile();
  const item: SavedPotteryItem = {
    id: 'pot_test_1',
    name: 'Moon Vessel',
    createdAt: '2026-11-17T00:00:00.000Z',
    glazeId: 'ocean-blue',
    mode: 'free',
    measurements: measureVessel(profile),
    paintDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    profile: {
      outerRadii: profile.outerRadii,
      innerRadii: profile.innerRadii,
      heights: profile.heights,
      openDepth: profile.openDepth,
    },
  };

  const saved = storage.saveItem(item);
  assert.equal(saved.ok, true);
  assert.equal(saved.data?.length, 1);

  const loaded = storage.loadAll();
  assert.equal(loaded.ok, true);
  assert.equal(loaded.data?.[0].name, 'Moon Vessel');
  assert.equal(loaded.data?.[0].paintDataUrl, 'data:image/png;base64,iVBORw0KGgo=');

  const renamed = storage.renameItem('pot_test_1', 'Ocean Basin');
  assert.equal(renamed.ok, true);
  assert.equal(renamed.data?.[0].name, 'Ocean Basin');

  const deleted = storage.deleteItem('pot_test_1');
  assert.equal(deleted.ok, true);
  assert.equal(deleted.data?.length, 0);

  // Corrupt JSON handling
  mem.setItem('clay_hands_gallery_v1', '{not valid json');
  const corrupt = storage.loadAll();
  assert.equal(corrupt.ok, false);
  assert.equal(corrupt.data?.length, 0);
});

test('VesselPainter UV interpolation wraps across seam and manages brush state', () => {
  const seamStroke = interpolateWrappedUVStroke(
    { u: 0.96, v: 0.5 },
    { u: 0.04, v: 0.5 },
    512,
    4
  );
  assert.ok(seamStroke.length > 2);
  for (const pt of seamStroke) {
    assert.ok(pt.u >= 0 && pt.u <= 1);
    assert.ok(
      pt.u >= 0.94 || pt.u <= 0.06,
      `Expected wrapped path near seam, got u=${pt.u}`
    );
  }

  const painter = new VesselPainter();
  assert.equal(painter.activeColorId, VILLAGE_PIGMENTS[0].id);
  painter.setEraser(true);
  assert.equal(painter.eraserMode, true);
  painter.setColor('crimson');
  assert.equal(painter.activeColorId, 'crimson');
  assert.equal(painter.eraserMode, false);
  painter.setSize('broad');
  assert.equal(painter.activeSize, 'broad');
  painter.dispose();
});

test('HandBrushMapper selects preferred hand, maps fingertip to NDC, and tracks pinch hysteresis', () => {
  const cal = createDefaultCalibration();
  const left = makeHand('left', {
    indexTip: { x: cal.centerX, y: 0.5, z: 0 },
    thumbTip: { x: cal.centerX, y: 0.5, z: 0 },
    pinchDistance: 0.11,
    handSpan: 0.15,
  });
  const right = makeHand('right', {
    indexTip: { x: cal.centerX + 0.12, y: 0.28, z: 0 },
    thumbTip: { x: cal.centerX + 0.12, y: 0.28, z: 0 },
    pinchDistance: 0.03,
    handSpan: 0.15,
  });

  assert.equal(selectBrushHand([left, right], 'right')?.handedness, 'right');
  assert.equal(selectBrushHand([left, right], 'left')?.handedness, 'left');
  assert.equal(selectBrushHand([left], 'right')?.handedness, 'left');

  const centerNDC = mapHandTipToBrushNDC(left, cal, 1.0);
  assert.ok(Math.abs(centerNDC.x) < 0.05);

  const highRightNDC = mapHandTipToBrushNDC(right, cal, 1.0);
  assert.ok(highRightNDC.x > 0.15);
  assert.ok(highRightNDC.y > 0.15);

  const tracker = new HandBrushTracker();
  const hoverState = tracker.evaluate([left], cal, 'left', 1.0);
  assert.equal(hoverState.inZone, true);
  assert.equal(hoverState.isPinching, false);

  const pinchState = tracker.evaluate([left, right], cal, 'right', 1.0);
  assert.equal(pinchState.isPinching, true);

  // Hysteresis holds pinch until exceeding exit threshold (0.45 * 0.15 = 0.0675)
  const holdInBand = tracker.evaluate(
    [makeHand('right', { pinchDistance: 0.06, handSpan: 0.15 })],
    cal,
    'right',
    1.0
  );
  assert.equal(holdInBand.isPinching, true);

  const releaseState = tracker.evaluate(
    [makeHand('right', { pinchDistance: 0.09, handSpan: 0.15 })],
    cal,
    'right',
    1.0
  );
  assert.equal(releaseState.isPinching, false);

  // Leaving zone resets state cleanly
  const outOfZone = tracker.evaluate([], cal, 'right', 1.0);
  assert.equal(outOfZone.inZone, false);
  assert.equal(outOfZone.isPinching, false);
});

test('TutorialManager tracks interactive hand & brush practice across all 5 steps', async () => {
  const { TutorialManager, INTERACTIVE_TUTORIAL_STEPS } = await import(
    '../src/ui/TutorialManager.ts'
  );
  const tut = new TutorialManager();
  tut.start();
  assert.equal(INTERACTIVE_TUTORIAL_STEPS.length, 5);
  assert.equal(tut.getCurrentStep().targetAction, 'compress');
  assert.equal(tut.getProgress(), 0);

  const makeGesture = (
    gesture: 'idle' | 'compress' | 'open' | 'raise' | 'widen',
    strength = 0.75
  ) => ({
    gesture,
    strength,
    activeHeightNorm: 0.5,
    activeAngle: 0,
    targetRadiusNorm: 0.5,
    isPinching: gesture === 'open',
    handsCount: 2,
    inZone: true,
    description: '',
  });

  // Wrong gesture does not complete compress step
  const wrong = tut.updatePractice(makeGesture('widen'), false, 0.5);
  assert.equal(wrong.matched, false);
  assert.equal(wrong.completedStep, false);

  // Matching compress completes step 1
  const hit1 = tut.updatePractice(makeGesture('compress'), false, 1.2);
  assert.equal(hit1.matched, true);
  assert.equal(hit1.completedStep, true);
  assert.equal(tut.isStepCompleted(0), true);

  // Step 2: open
  tut.next();
  assert.equal(tut.getCurrentStep().targetAction, 'open');
  const hit2 = tut.updatePractice(makeGesture('open'), false, 1.1);
  assert.equal(hit2.completedStep, true);

  // Step 3: raise
  tut.next();
  assert.equal(tut.getCurrentStep().targetAction, 'raise');
  const hit3 = tut.updatePractice(makeGesture('raise'), false, 1.2);
  assert.equal(hit3.completedStep, true);

  // Step 4: widen
  tut.next();
  assert.equal(tut.getCurrentStep().targetAction, 'widen');
  const hit4 = tut.updatePractice(makeGesture('widen'), false, 1.2);
  assert.equal(hit4.completedStep, true);

  // Step 5: brush painting
  tut.next();
  assert.equal(tut.getCurrentStep().targetAction, 'brush');
  const noPaint = tut.updatePractice(makeGesture('idle', 0), false, 0.5);
  assert.equal(noPaint.matched, false);

  const hit5 = tut.updatePractice(makeGesture('idle', 0), true, 1.0);
  assert.equal(hit5.matched, true);
  assert.equal(hit5.completedStep, true);
  assert.equal(hit5.finishedAll, true);
});

test('selectCursorHand, computeCursorPinchRatio, and isPointNearAnyRect support smart UI cursor', async () => {
  const { selectCursorHand, computeCursorPinchRatio, isPointNearAnyRect } =
    await import('../src/ui/HandCursorController.ts');
  const left = makeHand('left');
  const right = makeHand('right');

  assert.equal(selectCursorHand([], 'right'), null);
  assert.equal(selectCursorHand([left, right], 'right')?.handedness, 'right');
  assert.equal(selectCursorHand([left, right], 'left')?.handedness, 'left');
  assert.equal(selectCursorHand([left], 'right')?.handedness, 'left');

  // Visually pinched in 2D even when 3D pinchDistance is inflated by noisy Z depth
  const cameraPinch = makeHand('right', {
    thumbTip: { x: 0.5, y: 0.5, z: 0 },
    indexTip: { x: 0.51, y: 0.51, z: 0.08 },
    pinchDistance: 0.082,
    handSpan: 0.15,
  });
  assert.ok(computeCursorPinchRatio(cameraPinch) < 0.44);

  // Open hand remains clearly above exit threshold
  const openHand = makeHand('right', {
    thumbTip: { x: 0.48, y: 0.45, z: 0 },
    indexTip: { x: 0.62, y: 0.35, z: 0 },
    pinchDistance: 0.16,
    handSpan: 0.15,
  });
  assert.ok(computeCursorPinchRatio(openHand) > 0.56);

  // HUD proximity check hides cursor anywhere over clay/margin and wakes only right on interactive buttons
  const hudRects = [
    { left: 960, top: 16, right: 1260, bottom: 52 },
    { left: 320, top: 690, right: 960, bottom: 752 },
  ];
  assert.equal(isPointNearAnyRect(640, 380, hudRects, 6), false); // center clay pot
  assert.equal(isPointNearAnyRect(640, 640, hudRects, 6), false); // lower clay / above dock stays cursor-free
  assert.equal(isPointNearAnyRect(420, 686, hudRects, 6), true); // right on bottom dock edge
  assert.equal(isPointNearAnyRect(1100, 34, hudRects, 6), true); // directly on top-right quick button

  const { isMetaQuestEnvironment } = await import('../src/xr/questEnvironment.ts');
  assert.equal(
    isMetaQuestEnvironment(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/34.0.0 VR Safari/537.36',
      false
    ),
    true
  );
  assert.equal(
    isMetaQuestEnvironment(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0',
      true
    ),
    true
  );
  assert.equal(
    isMetaQuestEnvironment(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0',
      false
    ),
    false
  );
});

test('PotterySmashSystem enforces non-overlapping distance, 2-hit crack -> shatter, hand focus, and time reversal', async () => {
  const THREE = await import('three');
  const {
    PotterySmashSystem,
    buildShardGeometriesFromClay,
    computeGalleryLayoutPositions,
    sampleReversedTransform,
  } = await import('../src/gallery/PotterySmashSystem.ts');

  // 1. Multi-vessel layout positions guarantee non-overlapping pairwise XZ distance
  const single = computeGalleryLayoutPositions(1, 0);
  assert.equal(single.length, 1);
  assert.equal(single[0].x, 0);

  for (const count of [2, 4, 7]) {
    const radii = Array.from({ length: count }, (_, idx) => 0.1 + (idx % 3) * 0.02);
    const slots = computeGalleryLayoutPositions(count, 1, radii);
    assert.equal(slots.length, count);
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const distXZ = Math.hypot(
          slots[i].x - slots[j].x,
          slots[i].z - slots[j].z
        );
        const minExpected =
          radii[i] * slots[i].scale + radii[j] * slots[j].scale + 0.12;
        assert.ok(
          distXZ >= 0.36 && distXZ >= minExpected,
          `Expected safe distance for pair (${i},${j}) with count=${count}, got ${distXZ.toFixed(3)}`
        );
      }
    }
  }

  // 2. Procedural 3D ceramic shard slicing from ClayGeometry
  const profile = createInitialClayProfile();
  const clayGeo = new ClayGeometry(profile.ringCount, profile.angularSegments);
  clayGeo.updateFromProfile(profile, 0);
  const specs = buildShardGeometriesFromClay(clayGeo, 3, 5);
  assert.equal(specs.length, 15);
  for (const spec of specs) {
    const pos = spec.geometry.attributes.position;
    assert.ok(pos.count > 8);
    assert.ok(spec.approxRadius > 0.01);
    spec.geometry.dispose();
  }
  clayGeo.dispose();

  // 3. Reversed trajectory sampling returns exact start/end frames
  const outPos = new THREE.Vector3();
  const outQuat = new THREE.Quaternion();
  const frames = [
    { px: 0, py: 0.2, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
    { px: 0.4, py: -0.7, pz: 0.2, qx: 0, qy: 0.707, qz: 0, qw: 0.707 },
  ];
  sampleReversedTransform(frames, 0, outPos, outQuat);
  assert.ok(Math.abs(outPos.x - 0.4) < 1e-4);
  sampleReversedTransform(frames, 1, outPos, outQuat);
  assert.ok(Math.abs(outPos.y - 0.2) < 1e-4);

  // 4. Full 2-hit Crack -> Shatter, Hand Focus, Sweep & Chrono Rewind cycle
  let crackCalls = 0;
  let shatterCalls = 0;
  let restoreStarted = false;
  let restoreCompleted = false;
  const smashSys = new PotterySmashSystem({
    onCeramicCrack: () => {
      crackCalls++;
    },
    onCeramicShatter: () => {
      shatterCalls++;
    },
    onTimeRestoreStart: () => {
      restoreStarted = true;
    },
    onTimeRestoreComplete: () => {
      restoreCompleted = true;
    },
  });

  const makeSaved = (id: string, name: string): SavedPotteryItem => ({
    id,
    name,
    createdAt: '2026-11-18T00:00:00.000Z',
    glazeId: 'terracotta',
    mode: 'free',
    measurements: measureVessel(profile),
    profile: {
      outerRadii: [...profile.outerRadii],
      innerRadii: [...profile.innerRadii],
      heights: [...profile.heights],
      openDepth: profile.openDepth,
    },
  });

  const items = [makeSaved('pot_a', 'Sun Jar'), makeSaved('pot_b', 'Moon Vase')];
  const buildMeshForTest = (item: typeof items[number]) => {
    const cg = new ClayGeometry(item.profile.outerRadii.length, 24);
    const p = createInitialClayProfile(item.profile.outerRadii.length, 24);
    cg.updateFromProfile(p, 0);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xb85d41 });
    const mesh = new THREE.Mesh(cg.geometry, mat);
    return { mesh, clayGeometry: cg, customMaterial: mat, customTexture: null };
  };

  // Single Smash (Bat) shows ONLY the selected vessel (not all vessels)
  smashSys.enterSmashMode([items[0]], 'pot_a', buildMeshForTest, 'single');
  assert.equal(smashSys.isSmashMode(), true);
  assert.equal(smashSys.getScope(), 'single');
  assert.equal(smashSys.getStatus().totalVessels, 1);
  assert.equal(smashSys.getStatus().focusedVesselName, 'Sun Jar');
  // 2-hit shatter -> pot_a is tracked in getSmashedItemIds() for deletion if not restored
  smashSys.triggerBatSwing(1, true);
  smashSys.update(0.4);
  smashSys.triggerBatSwing(-1, true);
  assert.deepEqual(smashSys.getSmashedItemIds(), ['pot_a']);
  smashSys.exitSmashMode();

  // Reset counters for Smash All & full 2-hit cycle check
  crackCalls = 0;
  shatterCalls = 0;
  smashSys.enterSmashMode(items, 'pot_a', buildMeshForTest, 'all');

  assert.equal(smashSys.isSmashMode(), true);
  assert.equal(smashSys.getScope(), 'all');
  assert.equal(smashSys.getIntactCount(), 2);
  assert.equal(smashSys.getCrackedCount(), 0);
  assert.equal(smashSys.getSmashedCount(), 0);
  assert.deepEqual(smashSys.getSmashedItemIds(), []);

  // Focus right vessel ('Moon Vase', positioned right of 'Sun Jar') via 3D VR hand coordinate
  const rightLayouts = computeGalleryLayoutPositions(2, 0);
  const rightHandWorld = new THREE.Vector3(
    rightLayouts[1].x,
    rightLayouts[1].y + 0.12,
    rightLayouts[1].z + 0.14
  );
  smashSys.aimBatFromWorldPoint(rightHandWorld, new THREE.Vector3(0, 0, -1));
  const focusedBeforeHit = smashSys.getStatus();
  assert.equal(focusedBeforeHit.focusedVesselName, 'Moon Vase');
  assert.equal(focusedBeforeHit.focusedVesselHits, 0);

  // Hit 1: Cracks Moon Vase (1/2) without shattering yet
  smashSys.triggerBatSwing(1, true);
  assert.equal(crackCalls, 1);
  assert.equal(shatterCalls, 0);
  assert.equal(smashSys.getCrackedCount(), 1);
  assert.equal(smashSys.getSmashedCount(), 0);
  assert.equal(smashSys.getStatus().focusedVesselHits, 1);

  // Immediate double-trigger during hitCooldown should not instant-break
  smashSys.triggerBatSwing(-1, true);
  assert.equal(smashSys.getCrackedCount(), 1);
  assert.equal(smashSys.getSmashedCount(), 0);

  // Advance past cooldown (0.34s), Hit 2 shatters Moon Vase cleanly
  smashSys.update(0.4);
  smashSys.triggerBatSwing(-1, true);
  assert.equal(shatterCalls, 1);
  assert.equal(smashSys.getSmashedCount(), 1);
  assert.equal(smashSys.getCrackedCount(), 0);
  assert.equal(smashSys.getIntactCount(), 1);
  assert.deepEqual(smashSys.getSmashedItemIds(), ['pot_b']);

  // Focus shifts / sweep all cracks remaining intact Sun Jar on Pass 1 & shatters on Pass 2
  smashSys.smashAllWithBatSweep();
  for (let i = 0; i < 45; i++) {
    smashSys.update(0.03);
  }
  assert.ok(crackCalls >= 2);
  assert.ok(shatterCalls >= 2);
  assert.equal(smashSys.getSmashedCount(), 2);
  assert.equal(smashSys.getIntactCount(), 0);
  assert.deepEqual(smashSys.getSmashedItemIds().sort(), ['pot_a', 'pot_b']);

  // Trigger Chrono Rewind -> heals everything to 0/2 intact & clears deletion list
  assert.equal(smashSys.startRestore(), true);
  assert.equal(restoreStarted, true);
  assert.equal(smashSys.isRestoring(), true);

  for (let i = 0; i < 90; i++) {
    smashSys.update(0.03);
  }
  assert.equal(restoreCompleted, true);
  assert.equal(smashSys.isRestoring(), false);
  assert.equal(smashSys.getSmashedCount(), 0);
  assert.equal(smashSys.getCrackedCount(), 0);
  assert.equal(smashSys.getIntactCount(), 2);
  assert.deepEqual(smashSys.getSmashedItemIds(), []);
  assert.equal(smashSys.getStatus().focusedVesselHits, 0);

  smashSys.dispose();
});

test('ClayNameGeometry & ClayNameSculptor support 3D embossed lettering, plaque shapes, hand sculpting, macro gestures, storage, and bat smash + restore', async () => {
  const THREE = await import('three');
  const {
    ClayNameGeometry,
    computeSignedDistanceField,
    createInitialClayNameState,
    generateLetterMask,
  } = await import('../src/names/ClayNameGeometry.ts');
  const { ClayNameSculptor } = await import('../src/names/ClayNameSculptor.ts');
  const {
    PotterySmashSystem,
    buildShardGeometriesFromName,
  } = await import('../src/gallery/PotterySmashSystem.ts');

  // 1. Procedural bitmap font mask & signed distance field
  const cols = 72;
  const rows = 36;
  const mask = generateLetterMask('CLAY', cols, rows);
  assert.equal(mask.length, cols * rows);
  let litCount = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] > 0.5) litCount++;
  }
  assert.ok(litCount > 40, 'Expected embossed letter pixels for CLAY');
  const sdf = computeSignedDistanceField(mask, cols, rows);
  assert.equal(sdf.length, cols * rows);

  // 2. Watertight double-sided BufferGeometry across all plaque shapes
  const geo = new ClayNameGeometry(cols, rows);
  for (const shape of ['tablet', 'oval', 'ribbon', 'heart'] as const) {
    const st = createInitialClayNameState('STAR', shape, cols, rows);
    geo.updateFromState(st);
    const pos = geo.geometry.attributes.position;
    const norm = geo.geometry.attributes.normal;
    assert.equal(pos.count, cols * rows * 2);
    assert.equal(norm.count, pos.count);
    for (let i = 0; i < pos.count * 3; i++) {
      assert.ok(Number.isFinite(pos.array[i]));
      assert.ok(Number.isFinite(norm.array[i]));
    }
  }
  geo.dispose();

  // 3. ClayNameSculptor hand brush sculpting, heart stamp, macro gestures, undo, and serialization
  const sculptor = new ClayNameSculptor();
  sculptor.setNameText('ALICE');
  assert.equal(sculptor.state.text, 'ALICE');

  const centerIdx =
    Math.floor(sculptor.state.rows / 2) * sculptor.state.cols +
    Math.floor(sculptor.state.cols / 2);

  sculptor.beginStroke();
  const puffed = sculptor.applyBrushAtUV(0.5, 0.5, 'sculpt_puff', 1.0, 0.05);
  sculptor.endStroke();
  assert.equal(puffed, true);
  assert.ok(sculptor.state.sculptDeltas[centerIdx] > 0);
  assert.equal(sculptor.canUndo, true);

  assert.equal(sculptor.undo(), true);
  assert.ok(Math.abs(sculptor.state.sculptDeltas[centerIdx]) < 1e-6);

  sculptor.beginStroke();
  assert.equal(
    sculptor.applyBrushAtUV(0.25, 0.5, 'stamp_heart', 1.0, 0.05),
    true
  );
  sculptor.endStroke();

  const baseBold = sculptor.state.letterBoldness;
  assert.equal(sculptor.applyMacroGesture('widen', 0.9, 0.25), true);
  assert.ok(sculptor.state.letterBoldness > baseBold);

  const baseRelief = sculptor.state.letterRelief;
  assert.equal(sculptor.applyMacroGesture('raise', 0.9, 0.25), true);
  assert.ok(sculptor.state.letterRelief > baseRelief);

  const exported = sculptor.exportSavedNameData();
  assert.equal(exported.text, 'ALICE');

  // 4. PotteryStorage persistence for kind === 'name'
  const mem = new MemoryStorage();
  const storage = new PotteryStorage(mem);
  const profile = createInitialClayProfile();
  const savedNameItem: SavedPotteryItem = {
    id: 'name_test_1',
    name: exported.text,
    createdAt: '2026-11-18T00:00:00.000Z',
    glazeId: 'cobalt-wash',
    mode: 'free',
    kind: 'name',
    nameData: exported,
    measurements: measureVessel(profile),
    profile: {
      outerRadii: [...profile.outerRadii],
      innerRadii: [...profile.innerRadii],
      heights: [...profile.heights],
      openDepth: 0,
    },
  };
  assert.equal(storage.saveItem(savedNameItem).ok, true);
  const reloaded = storage.loadAll();
  assert.equal(reloaded.ok, true);
  assert.equal(reloaded.data?.length, 1);
  assert.equal(reloaded.data?.[0].kind, 'name');
  assert.equal(reloaded.data?.[0].nameData?.text, 'ALICE');

  // 5. Nameplate shard slicing & Smash + Chrono Rewind
  const shards = buildShardGeometriesFromName(sculptor.clayGeometry, 3, 5);
  assert.equal(shards.length, 15);
  for (const s of shards) {
    assert.ok(s.geometry.attributes.position.count > 12);
    s.geometry.dispose();
  }

  const smash = new PotterySmashSystem();
  smash.enterSmashMode(
    [savedNameItem],
    savedNameItem.id,
    () => {
      const mat = new THREE.MeshPhysicalMaterial({ color: 0xb85d41 });
      const mesh = new THREE.Mesh(sculptor.clayGeometry.geometry, mat);
      return {
        mesh,
        clayGeometry: null,
        nameGeometry: null,
        customMaterial: mat,
        customTexture: null,
      };
    },
    'single'
  );
  // Hit 1 -> crack; Hit 2 -> shatter
  smash.triggerBatSwing(1, true);
  assert.equal(smash.getCrackedCount(), 1);
  assert.equal(smash.getSmashedCount(), 0);
  smash.update(0.4);
  smash.triggerBatSwing(-1, true);
  assert.equal(smash.getSmashedCount(), 1);
  assert.deepEqual(smash.getSmashedItemIds(), ['name_test_1']);

  assert.equal(smash.startRestore(), true);
  for (let i = 0; i < 90; i++) smash.update(0.03);
  assert.equal(smash.getSmashedCount(), 0);
  assert.deepEqual(smash.getSmashedItemIds(), []);

  smash.dispose();
  sculptor.dispose();
});

test('ClayNameGeometry & ClayNameSculptor support blank hand-write slab, continuous sculpt_write strokes, and undo', async () => {
  const {
    ClayNameGeometry,
    createInitialClayNameState,
    generateLetterMask,
  } = await import('../src/names/ClayNameGeometry.ts');
  const { ClayNameSculptor } = await import('../src/names/ClayNameSculptor.ts');

  const cols = 72;
  const rows = 36;
  const blankMask = generateLetterMask('', cols, rows);
  assert.equal(blankMask.length, cols * rows);
  let litCount = 0;
  for (let i = 0; i < blankMask.length; i++) {
    if (blankMask[i] > 0) litCount++;
  }
  assert.equal(litCount, 0, 'Blank text must produce an all-zero letter mask');

  const geo = new ClayNameGeometry(cols, rows);
  const blankState = createInitialClayNameState('', 'tablet', cols, rows);
  geo.updateFromState(blankState);
  for (let i = 0; i < geo.baseLetterHeight.length; i++) {
    assert.equal(geo.baseLetterHeight[i], 0);
  }
  const pos = geo.geometry.attributes.position;
  for (let i = 0; i < pos.count * 3; i++) {
    assert.ok(Number.isFinite(pos.array[i]));
  }
  geo.dispose();

  const sculptor = new ClayNameSculptor();
  sculptor.setNameText('ARIA');
  sculptor.setBlankForHandWrite();
  assert.equal(sculptor.state.text, '');
  assert.equal(sculptor.activeTool, 'sculpt_write');
  assert.equal(sculptor.canUndo, true);

  // Continuous stroke across spaced UV coordinates must fill intermediate clay cells
  sculptor.beginStroke();
  sculptor.applyBrushAtUV(0.25, 0.5, 'sculpt_write', 1.0, 0.04);
  sculptor.applyBrushAtUV(0.45, 0.5, 'sculpt_write', 1.0, 0.04);
  sculptor.endStroke();

  const midRow = Math.floor(sculptor.state.rows * 0.5);
  const midCol = Math.floor(sculptor.state.cols * 0.35);
  const midIdx = midRow * sculptor.state.cols + midCol;
  assert.ok(
    sculptor.state.sculptDeltas[midIdx] > 0.004,
    'Continuous sculpt_write stroke must raise clay along intermediate segment'
  );

  const savedBlank = sculptor.exportSavedNameData();
  assert.equal(savedBlank.text, '');
  assert.ok(savedBlank.sculptDeltas[midIdx] > 0.004);

  // First undo reverts the hand-written stroke; second undo restores 'ARIA'
  assert.equal(sculptor.undo(), true);
  assert.ok(Math.abs(sculptor.state.sculptDeltas[midIdx]) < 1e-6);
  assert.equal(sculptor.undo(), true);
  assert.equal(sculptor.state.text, 'ARIA');

  sculptor.dispose();
});

test('Meta Quest controller fallback mapping and unified Studio Gallery filtering/reload round-trip', async () => {
  const { mapControllerToWheelHand } = await import('../src/xr/questEnvironment.ts');
  const {
    filterGalleryItems,
    formatGalleryItemMeta,
    getCreationKind,
  } = await import('../src/gallery/GalleryManager.ts');
  const { ClaySculptingController } = await import(
    '../src/pottery/ClaySculptingController.ts'
  );
  const { createInitialClayProfile } = await import(
    '../src/pottery/PotteryPresets.ts'
  );
  const { measureVessel } = await import('../src/pottery/PotteryProfile.ts');
  const { ClayNameSculptor } = await import('../src/names/ClayNameSculptor.ts');

  // 1. Meta Quest Touch controller mapping inside interaction zone
  const pinchedCtrl = mapControllerToWheelHand({
    handedness: 'right',
    localPos: { x: 0.1, y: 0.12, z: 0.05 },
    worldRelativeTip: { x: 0.1, y: 0.12, z: 0.05 },
    selected: true,
    squeezed: false,
    clayHeight: 0.24,
    velocity: { x: 0.02, y: -0.01, z: 0 },
  });
  assert.equal(pinchedCtrl.handedness, 'right');
  assert.equal(pinchedCtrl.inInteractionZone, true);
  assert.ok(pinchedCtrl.pinchDistance < 0.03);
  assert.ok(pinchedCtrl.fingerCurl < 0.5);

  const grippedOutOfZoneCtrl = mapControllerToWheelHand({
    handedness: 'left',
    localPos: { x: -0.65, y: 0.4, z: 0.1 },
    worldRelativeTip: { x: -0.65, y: 0.4, z: 0.1 },
    selected: false,
    squeezed: true,
    clayHeight: 0.2,
    velocity: { x: 0, y: 0, z: 0 },
  });
  assert.equal(grippedOutOfZoneCtrl.inInteractionZone, false);
  assert.ok(grippedOutOfZoneCtrl.fingerCurl > 0.8);
  assert.ok(grippedOutOfZoneCtrl.pinchDistance > 0.08);

  // 2. Unified Gallery helpers across mixed pottery & clay name items
  const sculptor = new ClaySculptingController();
  sculptor.applyGesture(
    {
      gesture: 'widen',
      strength: 0.9,
      activeHeightNorm: 0.55,
      activeAngle: 0,
      targetRadiusNorm: 0.7,
      isPinching: false,
      handsCount: 2,
      inZone: true,
      description: 'Widening belly',
    },
    0.2
  );
  const savedProfile = {
    outerRadii: [...sculptor.profile.outerRadii],
    innerRadii: [...sculptor.profile.innerRadii],
    heights: [...sculptor.profile.heights],
    openDepth: 0.42,
    angularOffsets: [...sculptor.profile.angularOffsets],
  };
  const vesselItem: SavedPotteryItem = {
    id: 'pot_unified_1',
    name: 'Courtyard Jar',
    createdAt: '2026-11-18T00:00:00.000Z',
    glazeId: 'sage-celadon',
    mode: 'free',
    kind: 'vessel',
    measurements: measureVessel(sculptor.profile),
    profile: savedProfile,
  };

  const nameSculptor = new ClayNameSculptor();
  nameSculptor.setNameText('QUEST');
  nameSculptor.setPlaqueShape('heart');
  nameSculptor.setLetterRelief(0.026);
  nameSculptor.setLetterBoldness(1.3);
  const nameData = nameSculptor.exportSavedNameData();
  const baseProfile = createInitialClayProfile();
  const nameItem: SavedPotteryItem = {
    id: 'name_unified_1',
    name: 'QUEST',
    createdAt: '2026-11-18T00:01:00.000Z',
    glazeId: 'terracotta-satin',
    mode: 'free',
    nameData,
    measurements: measureVessel(baseProfile),
    profile: {
      outerRadii: [...baseProfile.outerRadii],
      innerRadii: [...baseProfile.innerRadii],
      heights: [...baseProfile.heights],
      openDepth: 0,
    },
  };

  const mixed = [vesselItem, nameItem];
  assert.equal(getCreationKind(vesselItem), 'vessel');
  assert.equal(getCreationKind(nameItem), 'name');
  assert.equal(filterGalleryItems(mixed, 'all').length, 2);
  assert.deepEqual(
    filterGalleryItems(mixed, 'vessel').map((i) => i.id),
    ['pot_unified_1']
  );
  assert.deepEqual(
    filterGalleryItems(mixed, 'name').map((i) => i.id),
    ['name_unified_1']
  );

  const vesselMeta = formatGalleryItemMeta(vesselItem, 'Sage Celadon');
  assert.ok(vesselMeta.includes('Pottery Wheel'));
  assert.ok(vesselMeta.includes('Sage Celadon'));

  const nameMeta = formatGalleryItemMeta(nameItem, 'Terracotta Satin');
  assert.ok(nameMeta.includes('Clay Name'));
  assert.ok(nameMeta.includes('Heart'));
  assert.ok(nameMeta.includes('Relief 26 mm'));
  assert.ok(nameMeta.includes('1.30x'));

  // 3. Reloading saved creations back into pottery & name controllers
  const reloadVessel = new ClaySculptingController();
  reloadVessel.loadProfile(vesselItem.profile);
  assert.equal(reloadVessel.profile.openDepth, 0.42);
  assert.equal(reloadVessel.isSubstantiallyModified, true);

  const reloadName = new ClayNameSculptor();
  reloadName.loadSavedNameData(nameData);
  assert.equal(reloadName.state.text, 'QUEST');
  assert.equal(reloadName.state.plaqueShape, 'heart');

  sculptor.dispose();
  reloadVessel.dispose();
  nameSculptor.dispose();
  reloadName.dispose();
});

test('StateManager defaults to hands-first inputMode (webcam, never mouse)', async () => {
  const { StateManager } = await import('../src/app/StateManager.ts');
  const state = new StateManager();
  assert.equal(state.inputMode, 'webcam');
  assert.notEqual(state.inputMode, 'mouse');
});

test('KilnController.cancel aborts firing cleanly without triggering transform/complete', async () => {
  const THREE = await import('three');
  const { KilnController } = await import('../src/kiln/KilnController.ts');
  const kiln = new KilnController();
  const vessel = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.1, 0.1),
    new THREE.MeshBasicMaterial()
  );

  let transformed = false;
  let completed = false;
  kiln.startFiring(
    vessel,
    () => {
      transformed = true;
    },
    () => {
      completed = true;
    }
  );

  const mid = kiln.update(1.5);
  assert.notEqual(mid.phase, 'idle');

  kiln.cancel();
  const afterCancel = kiln.update(5.0);
  assert.equal(afterCancel.phase, 'idle');
  assert.equal(afterCancel.progress, 0);
  assert.equal(transformed, false);
  assert.equal(completed, false);
});

test('ClayNameGeometry.getCachedShapeXY matches mapGridToPlaqueXY across plaque shapes', async () => {
  const { ClayNameGeometry, mapGridToPlaqueXY } = await import(
    '../src/names/ClayNameGeometry.ts'
  );
  const geom = new ClayNameGeometry();
  const shapes = ['tablet', 'oval', 'ribbon', 'heart'] as const;

  for (const shape of shapes) {
    const cached = geom.getCachedShapeXY(shape);
    assert.equal(cached.x.length, geom.cols * geom.rows);
    assert.equal(cached.y.length, geom.cols * geom.rows);

    for (let r = 0; r < geom.rows; r += 9) {
      for (let c = 0; c < geom.cols; c += 17) {
        const uNorm = (c / (geom.cols - 1)) * 2 - 1;
        const vNorm = (r / (geom.rows - 1)) * 2 - 1;
        const expected = mapGridToPlaqueXY(uNorm, vNorm, shape);
        const idx = r * geom.cols + c;
        assert.ok(Math.abs(cached.x[idx] - expected.x) < 1e-5);
        assert.ok(Math.abs(cached.y[idx] - expected.y) < 1e-5);
      }
    }
  }

  geom.dispose();
});

test('ClayDeformer smooth & enforceSmoothGradient remain deterministic with pooled scratch buffers', () => {
  const p1 = createInitialClayProfile();
  const p2 = createInitialClayProfile();
  p1.outerRadii[12] += 0.03;
  p2.outerRadii[12] += 0.03;

  ClayDeformer.smooth(p1, { heightNorm: 0.5, strength: 0.7, dt: 0.25 });
  ClayDeformer.smooth(p2, { heightNorm: 0.5, strength: 0.7, dt: 0.25 });

  for (let i = 0; i < p1.ringCount; i++) {
    assert.ok(Number.isFinite(p1.outerRadii[i]));
    assert.ok(Math.abs(p1.outerRadii[i] - p2.outerRadii[i]) < 1e-12);
  }
});

test('XRManager MR Passthrough state transitions, AR backdrop toggle, and capability guards work safely', async () => {
  const { XRManager } = await import('../src/xr/XRManager.ts');
  const xr = new XRManager();

  // Desktop / no WebXR: never throws and disables both VR & AR safely
  await xr.probeSupport();
  assert.equal(xr.inXRSession, false);
  assert.equal(xr.inARSession, false);
  assert.equal(xr.passthroughActive, false);
  assert.equal(await xr.startXRSession('immersive-ar'), false);
  assert.equal(xr.togglePassthroughBackdrop(), false);

  // Simulated immersive-ar session start & live backdrop toggle
  const fakeArSession = { environmentBlendMode: 'alpha-blend' } as XRSession;
  const startedPassthrough = xr.syncSessionStarted(fakeArSession);
  assert.equal(startedPassthrough, true);
  assert.equal(xr.inXRSession, true);
  assert.equal(xr.inARSession, true);
  assert.equal(xr.activeSessionMode, 'immersive-ar');
  assert.equal(xr.passthroughActive, true);

  // Toggle MR Real Desk <-> VR Cozy Room in-place without ending session
  assert.equal(xr.togglePassthroughBackdrop(), false);
  assert.equal(xr.inARSession, true);
  assert.equal(xr.togglePassthroughBackdrop(), true);

  // Ending XR session cleanly clears MR & VR state
  xr.syncSessionEnded();
  assert.equal(xr.inXRSession, false);
  assert.equal(xr.inARSession, false);
  assert.equal(xr.activeSessionMode, null);
  assert.equal(xr.passthroughActive, false);

  // Simulated pure immersive-vr session never allows AR passthrough backdrop toggle
  const fakeVrSession = { environmentBlendMode: 'opaque' } as XRSession;
  assert.equal(xr.syncSessionStarted(fakeVrSession), false);
  assert.equal(xr.inARSession, false);
  assert.equal(xr.togglePassthroughBackdrop(), false);
});



