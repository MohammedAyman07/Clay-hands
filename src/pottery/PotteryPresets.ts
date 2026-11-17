import type {
  ChallengePreset,
  ClayProfileState,
  GuidedLessonId,
} from '../types.ts';

export const DEFAULT_RING_COUNT = 32;
export const DEFAULT_ANGULAR_SEGMENTS = 44;

export const CLAY_LIMITS = {
  minRadius: 0.022,
  maxRadius: 0.21,
  minHeight: 0.055,
  maxHeight: 0.34,
  minWallThickness: 0.011,
  floorThickness: 0.016,
} as const;

export function createInitialClayProfile(
  ringCount = DEFAULT_RING_COUNT,
  angularSegments = DEFAULT_ANGULAR_SEGMENTS
): ClayProfileState {
  const outerRadii: number[] = [];
  const innerRadii: number[] = [];
  const heights: number[] = [];
  const totalHeight = 0.135;

  for (let i = 0; i < ringCount; i++) {
    const t = i / (ringCount - 1);
    // Natural conical clay mound ready to be centered & opened
    const radius = 0.088 * (1 - 0.18 * t) + 0.008 * Math.sin(t * Math.PI);
    outerRadii.push(radius);
    innerRadii.push(Math.max(0.006, radius * 0.22));
    heights.push(t * totalHeight);
  }

  const angularOffsets = new Array<number>(ringCount * angularSegments).fill(0);

  return {
    ringCount,
    angularSegments,
    outerRadii,
    innerRadii,
    heights,
    openDepth: 0.04,
    wobble: 0.65,
    angularOffsets,
    surfaceRoughness: 0.42,
  };
}

export function cloneClayProfile(profile: ClayProfileState): ClayProfileState {
  return {
    ringCount: profile.ringCount,
    angularSegments: profile.angularSegments,
    outerRadii: [...profile.outerRadii],
    innerRadii: [...profile.innerRadii],
    heights: [...profile.heights],
    openDepth: profile.openDepth,
    wobble: profile.wobble,
    angularOffsets: [...profile.angularOffsets],
    surfaceRoughness: profile.surfaceRoughness,
  };
}

function sampleCurve(
  ringCount: number,
  fn: (t: number) => number
): number[] {
  const out: number[] = [];
  for (let i = 0; i < ringCount; i++) {
    out.push(fn(i / (ringCount - 1)));
  }
  return out;
}

export const CHALLENGE_PRESETS: ChallengePreset[] = [
  {
    id: 'classic-cup',
    name: 'Morning Tea Cup',
    subtitle: 'Steady straight walls with a gentle flared lip',
    difficulty: 'Gentle',
    targetHeight: 0.15,
    openDepth: 0.92,
    targetRadii: sampleCurve(DEFAULT_RING_COUNT, (t) => {
      return 0.052 + 0.016 * Math.pow(t, 0.85) + 0.005 * Math.sin(t * Math.PI);
    }),
  },
  {
    id: 'tea-bowl',
    name: 'Quiet Matcha Bowl',
    subtitle: 'Grounded foot widening into an inviting wide rim',
    difficulty: 'Gentle',
    targetHeight: 0.115,
    openDepth: 0.95,
    targetRadii: sampleCurve(DEFAULT_RING_COUNT, (t) => {
      return 0.048 + 0.068 * Math.sin(t * Math.PI * 0.52);
    }),
  },
  {
    id: 'tapered-vase',
    name: 'Willow Neck Vase',
    subtitle: 'Full rounded belly tapering to a delicate pinched neck',
    difficulty: 'Balanced',
    targetHeight: 0.24,
    openDepth: 0.94,
    targetRadii: sampleCurve(DEFAULT_RING_COUNT, (t) => {
      const belly = 0.056 + 0.048 * Math.sin(t * Math.PI * 0.92);
      const neckPinch =
        t > 0.55 ? -0.045 * Math.sin(((t - 0.55) / 0.45) * Math.PI * 0.88) : 0;
      const lipFlare = t > 0.88 ? 0.016 * ((t - 0.88) / 0.12) : 0;
      return Math.max(0.032, belly + neckPinch + lipFlare);
    }),
  },
  {
    id: 'lantern-amphora',
    name: 'Studio Lantern Amphora',
    subtitle: 'Tall sculpted shoulder with an expressive narrow collar',
    difficulty: 'Artisan',
    targetHeight: 0.275,
    openDepth: 0.95,
    targetRadii: sampleCurve(DEFAULT_RING_COUNT, (t) => {
      const shoulder =
        0.048 + 0.058 * Math.pow(Math.sin(t * Math.PI * 0.78), 1.15);
      const collar =
        t > 0.68 ? -0.036 * Math.sin(((t - 0.68) / 0.32) * Math.PI) : 0;
      return Math.max(0.034, shoulder + collar);
    }),
  },
];

export interface GuidedLessonStep {
  stage: 'center' | 'open' | 'shape' | 'smooth';
  title: string;
  instruction: string;
  gestureHint: string;
}

export interface GuidedLesson {
  id: GuidedLessonId;
  title: string;
  subtitle: string;
  targetPresetId: string;
  steps: GuidedLessonStep[];
}

export const GUIDED_LESSONS: GuidedLesson[] = [
  {
    id: 'cup',
    title: 'Everyday Studio Cup',
    subtitle: 'Learn centering, opening, and steady straight walls',
    targetPresetId: 'classic-cup',
    steps: [
      {
        stage: 'center',
        title: '1. Center the Clay',
        instruction:
          'Hold both palms gently around the clay mound and compress inward until it spins steadily.',
        gestureHint: 'Palms inward around clay',
      },
      {
        stage: 'open',
        title: '2. Open the Interior',
        instruction:
          'Bring thumb and index fingertips together above the center to open a hollow cavity.',
        gestureHint: 'Pinch / press center downward',
      },
      {
        stage: 'shape',
        title: '3. Pull Up Straight Walls',
        instruction:
          'Lift both hands slowly upward along the walls to raise a clean cylinder.',
        gestureHint: 'Lift both hands upward smoothly',
      },
      {
        stage: 'smooth',
        title: '4. Smooth the Rim & Finish',
        instruction:
          'Hold your hands steady beside the spinning cup to refine the surface, then finish.',
        gestureHint: 'Hold hands steady near surface',
      },
    ],
  },
  {
    id: 'bowl',
    title: 'Warm Serving Bowl',
    subtitle: 'Master outward widening and balanced open curves',
    targetPresetId: 'tea-bowl',
    steps: [
      {
        stage: 'center',
        title: '1. Center the Mound',
        instruction:
          'Compress gently with both palms to settle the clay evenly on the wheel bat.',
        gestureHint: 'Palms inward around clay',
      },
      {
        stage: 'open',
        title: '2. Create a Deep Basin',
        instruction:
          'Pinch and open the top center until a deep hollow interior forms.',
        gestureHint: 'Pinch at center top',
      },
      {
        stage: 'shape',
        title: '3. Open & Widen Outward',
        instruction:
          'Move both hands apart from the center axis to flare the upper walls into a wide bowl.',
        gestureHint: 'Move hands outward apart',
      },
      {
        stage: 'smooth',
        title: '4. Smooth the Curve',
        instruction:
          'Steady your hands softly near the rim to polish the curve before glazing.',
        gestureHint: 'Hold hands steady near clay',
      },
    ],
  },
  {
    id: 'vase',
    title: 'Tapered Neck Vase',
    subtitle: 'Combine wall raising, belly widening, and neck pinching',
    targetPresetId: 'tapered-vase',
    steps: [
      {
        stage: 'center',
        title: '1. Center Tall',
        instruction:
          'Compress both palms gently to align the clay at the center of the wheel.',
        gestureHint: 'Palms inward around clay',
      },
      {
        stage: 'open',
        title: '2. Open Deeply',
        instruction:
          'Pinch at the top center to open a deep interior cavity for your tall vase.',
        gestureHint: 'Pinch at center top',
      },
      {
        stage: 'shape',
        title: '3. Raise, Belly & Pinch Neck',
        instruction:
          'Lift upward to gain height, widen the middle, then pinch thumb and index near the top to narrow the neck.',
        gestureHint: 'Lift upward · Widen middle · Pinch top',
      },
      {
        stage: 'smooth',
        title: '4. Final Polish',
        instruction:
          'Hold hands steady along the silhouette to smooth throwing lines before firing.',
        gestureHint: 'Hold hands steady',
      },
    ],
  },
];
