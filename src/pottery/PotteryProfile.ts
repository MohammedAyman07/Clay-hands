import type {
  ChallengePreset,
  ClayProfileState,
  PotteryPersonality,
  SimilarityResult,
  VesselMeasurements,
} from '../types.ts';

export function measureVessel(profile: ClayProfileState): VesselMeasurements {
  const { outerRadii, heights, ringCount, surfaceRoughness, openDepth } =
    profile;
  const maxRadius = Math.max(...outerRadii);
  const height = heights[ringCount - 1] - heights[0];
  const baseRadius = outerRadii[0];
  const openingRadius = outerRadii[ringCount - 1];

  // Neck is measured in the upper third (65% to 92% height)
  const neckStart = Math.floor(ringCount * 0.65);
  const neckEnd = Math.floor(ringCount * 0.94);
  let minUpperRadius = openingRadius;
  for (let i = neckStart; i <= neckEnd; i++) {
    if (outerRadii[i] < minUpperRadius) {
      minUpperRadius = outerRadii[i];
    }
  }

  // Body curvature: variance of mid-body bulge vs straight chord from base to rim
  let curvatureAccum = 0;
  for (let i = 1; i < ringCount - 1; i++) {
    const t = i / (ringCount - 1);
    const chord = baseRadius * (1 - t) + openingRadius * t;
    curvatureAccum += Math.abs(outerRadii[i] - chord);
  }
  const avgDiff = curvatureAccum / Math.max(1, ringCount - 2);
  const bodyCurvature = Math.min(1, avgDiff / 0.045);

  const smoothness = Math.max(0, Math.min(1, 1 - surfaceRoughness));

  return {
    maxWidthCm: Number((maxRadius * 200).toFixed(1)),
    heightCm: Number((height * 100).toFixed(1)),
    neckWidthCm: Number((minUpperRadius * 200).toFixed(1)),
    openingWidthCm: Number((openingRadius * 200).toFixed(1)),
    baseWidthCm: Number((baseRadius * 200).toFixed(1)),
    bodyCurvature: Number(bodyCurvature.toFixed(2)),
    smoothness: Number(smoothness.toFixed(2)),
    openDepth: Number(openDepth.toFixed(2)),
  };
}

export function generatePotteryPersonality(
  profile: ClayProfileState
): PotteryPersonality {
  const m = measureVessel(profile);
  const aspectRatio = m.heightCm / Math.max(1, m.maxWidthCm);
  const neckRatio = m.neckWidthCm / Math.max(1, m.maxWidthCm);
  const openRatio = m.openingWidthCm / Math.max(1, m.maxWidthCm);

  let archetype = 'Studio Vessel';
  let name = 'Earth Vessel';
  let notes = 'Balanced hand-thrown proportions.';

  if (aspectRatio < 0.68 && openRatio > 0.85) {
    archetype = 'Open Bowl';
    name = m.maxWidthCm > 22 ? 'Moon Basin' : 'Sunlit Bowl';
    notes = 'Generous open rim rising softly from a grounded base.';
  } else if (neckRatio < 0.62 && aspectRatio >= 1.05) {
    archetype = 'Pinched Vase';
    name = m.heightCm > 22 ? 'Cloud Vase' : 'Willow Flask';
    notes = 'Curved belly gathered into a delicate narrowed neck.';
  } else if (aspectRatio >= 1.15 && m.bodyCurvature < 0.28) {
    archetype = 'Tall Cylinder';
    name = 'Ocean Tumbler';
    notes = 'Clean upright walls pulled steadily from base to lip.';
  } else if (m.bodyCurvature >= 0.38 && aspectRatio < 1.05) {
    archetype = 'Rounded Pot';
    name = m.heightCm < 12 ? 'Little Earth' : 'Desert Bloom';
    notes = 'Warm rounded silhouette shaped by gentle outward curves.';
  } else if (aspectRatio >= 0.72 && aspectRatio < 1.15 && openRatio >= 0.78) {
    archetype = 'Artisan Cup';
    name = m.smoothness > 0.72 ? 'Ocean Cup' : 'Hearth Mug';
    notes = 'Comfortable everyday cup with an inviting rim.';
  } else if (aspectRatio >= 1.1) {
    archetype = 'Sculpted Vase';
    name = 'Terrace Vase';
    notes = 'Graceful vertical profile with subtle hand-thrown contour.';
  } else {
    archetype = 'Hand Vessel';
    name = 'Pebble Jar';
    notes = 'Intimate hand-formed vessel preserving every touch.';
  }

  return {
    name,
    archetype,
    notes,
    measurements: m,
  };
}

export function computeSimilarityScore(
  playerProfile: ClayProfileState,
  target: ChallengePreset
): SimilarityResult {
  const ringCount = playerProfile.ringCount;
  const playerHeight =
    playerProfile.heights[ringCount - 1] - playerProfile.heights[0];
  const heightDiff = Math.abs(playerHeight - target.targetHeight);
  const heightRatio = Math.max(
    0,
    1 - heightDiff / Math.max(0.08, target.targetHeight)
  );

  // Sample target radii to match ringCount
  let sqError = 0;
  for (let i = 0; i < ringCount; i++) {
    const t = i / (ringCount - 1);
    const targetIdx = t * (target.targetRadii.length - 1);
    const lo = Math.floor(targetIdx);
    const hi = Math.min(target.targetRadii.length - 1, lo + 1);
    const frac = targetIdx - lo;
    const expectedR =
      target.targetRadii[lo] * (1 - frac) + target.targetRadii[hi] * frac;
    const diff = playerProfile.outerRadii[i] - expectedR;
    sqError += diff * diff;
  }

  const rmse = Math.sqrt(sqError / ringCount);
  const profileMatch = Math.max(0, Math.min(1, 1 - rmse / 0.055));
  const openMatch =
    1 - Math.min(1, Math.abs(playerProfile.openDepth - target.openDepth) * 0.4);

  const combined =
    (profileMatch * 0.68 + heightRatio * 0.24 + openMatch * 0.08) * 100;
  const score = Math.round(Math.max(0, Math.min(100, combined)));

  let proportionNote = 'Keep shaping the profile toward the silhouette guide.';
  if (score >= 88) {
    proportionNote =
      'Remarkable silhouette harmony — height and curves align closely.';
  } else if (score >= 72) {
    proportionNote =
      'Strong overall silhouette with expressive hand-thrown character.';
  } else if (heightRatio < 0.72) {
    proportionNote =
      playerHeight < target.targetHeight
        ? 'Try raising the walls taller to match the reference height.'
        : 'Vessel is taller than the reference — try a gentler, lower profile.';
  } else if (profileMatch < 0.7) {
    proportionNote =
      'Focus on matching the belly width and upper neck contour.';
  }

  return {
    score,
    heightMatch: Math.round(heightRatio * 100),
    profileMatch: Math.round(profileMatch * 100),
    proportionNote,
  };
}
