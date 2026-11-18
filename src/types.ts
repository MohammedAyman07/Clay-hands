export type AppScreen =
  | 'welcome'
  | 'start-studio'
  | 'webcam-permission'
  | 'hand-calibration'
  | 'studio'
  | 'name-studio'
  | 'tutorial'
  | 'glaze'
  | 'kiln'
  | 'gallery'
  | 'settings';

export type GameMode = 'free' | 'guided' | 'challenge';

export type InputMode = 'webcam' | 'mouse' | 'webxr';

export type PotteryStage = 'center' | 'open' | 'shape' | 'smooth' | 'finished';

export type GuidedLessonId = 'cup' | 'bowl' | 'vase';

export type ShapingGesture =
  | 'idle'
  | 'compress'
  | 'widen'
  | 'raise'
  | 'pinch_neck'
  | 'open'
  | 'one_side'
  | 'smooth';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface RawLandmark {
  x: number;
  y: number;
  z: number;
}

export interface SmoothedHand {
  handedness: 'left' | 'right';
  confidence: number;
  palmCenter: Vec3;
  wrist: Vec3;
  thumbTip: Vec3;
  indexTip: Vec3;
  middleTip: Vec3;
  ringTip: Vec3;
  pinkyTip: Vec3;
  pinchDistance: number;
  handSpan: number;
  fingerCurl: number;
  velocity: Vec3;
  speed: number;
  inInteractionZone: boolean;
  landmarks: RawLandmark[];
}

export interface HandTrackingFrame {
  timestamp: number;
  hands: SmoothedHand[];
  source: InputMode;
}

export interface CalibrationData {
  calibrated: boolean;
  centerX: number;
  centerY: number;
  minSpan: number;
  maxSpan: number;
  minY: number;
  maxY: number;
  handScale: number;
  timestamp: number;
}

export interface GestureState {
  gesture: ShapingGesture;
  strength: number; // 0..1 estimated shaping effort from distance, gesture strength & motion
  activeHeightNorm: number; // 0..1 along vessel height
  activeAngle: number; // radians for one-side shaping
  targetRadiusNorm: number;
  isPinching: boolean;
  handsCount: number;
  inZone: boolean;
  description: string;
}

export interface ClayProfileState {
  ringCount: number;
  angularSegments: number;
  outerRadii: number[];
  innerRadii: number[];
  heights: number[];
  /** 0 = solid mound, 1 = fully opened hollow interior */
  openDepth: number;
  /** Centering wobble / stability: 1 = uncentered mound, 0 = centered */
  wobble: number;
  /** Angular radial offsets [ring * angularSegments + seg] */
  angularOffsets: number[];
  /** Surface micro-roughness 0..1 */
  surfaceRoughness: number;
}

export interface VesselMeasurements {
  maxWidthCm: number;
  heightCm: number;
  neckWidthCm: number;
  openingWidthCm: number;
  baseWidthCm: number;
  bodyCurvature: number;
  smoothness: number;
  openDepth: number;
}

export interface PotteryPersonality {
  name: string;
  archetype: string;
  notes: string;
  measurements: VesselMeasurements;
}

export interface GlazeDefinition {
  id: string;
  name: string;
  color: string;
  secondaryColor: string;
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  speckleIntensity: number;
  finishLabel: 'Glossy' | 'Satin' | 'Matte' | 'Luster';
  description: string;
}

export interface BrushColorDefinition {
  id: string;
  name: string;
  hex: string;
}

export type BrushSizePreset = 'fine' | 'medium' | 'broad';

export type ClayNameTool =
  | 'sculpt_write'
  | 'sculpt_puff'
  | 'sculpt_carve'
  | 'sculpt_smooth'
  | 'stamp_heart'
  | 'paint';

export type ClayNamePlaqueShape = 'tablet' | 'oval' | 'ribbon' | 'heart';

export interface SavedClayNameData {
  text: string;
  plaqueShape: ClayNamePlaqueShape;
  letterRelief: number;
  letterBoldness: number;
  cols: number;
  rows: number;
  sculptDeltas: number[];
}

export type GalleryFilter = 'all' | 'vessel' | 'name';

export interface SavedPotteryItem {
  id: string;
  name: string;
  createdAt: string;
  glazeId: string;
  mode: GameMode;
  kind?: 'vessel' | 'name';
  measurements: VesselMeasurements;
  paintDataUrl?: string;
  nameData?: SavedClayNameData;
  profile: {
    outerRadii: number[];
    innerRadii: number[];
    heights: number[];
    openDepth: number;
    angularOffsets?: number[];
  };
}

export interface ChallengePreset {
  id: string;
  name: string;
  subtitle: string;
  difficulty: 'Gentle' | 'Balanced' | 'Artisan';
  targetHeight: number;
  targetRadii: number[];
  openDepth: number;
}

export interface SimilarityResult {
  score: number; // 0..100
  heightMatch: number;
  profileMatch: number;
  proportionNote: string;
}

export interface StudioSettings {
  handSensitivity: number; // 0.5..2.0
  wheelSpeed: number; // 0.2..2.0
  handedness: 'right' | 'left';
  inferenceFps: number; // 12..30
  performanceMode: boolean;
  reducedMotion: boolean;
  soundEnabled: boolean;
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
  showWebcamPip: boolean;
}

export type TrackingErrorType =
  | 'none'
  | 'permission-denied'
  | 'no-camera'
  | 'model-load-failed'
  | 'tracking-lost'
  | 'webgl-unavailable';
