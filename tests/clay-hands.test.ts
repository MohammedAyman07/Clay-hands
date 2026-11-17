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
});
