import * as THREE from 'three';
import * as xb from 'xrblocks';
import type { SmashScope } from '../gallery/PotterySmashSystem.ts';
import { GLAZE_CATALOG } from '../kiln/GlazeManager.ts';
import { CHALLENGE_PRESETS, GUIDED_LESSONS } from '../pottery/PotteryPresets.ts';
import { VILLAGE_PIGMENTS } from '../pottery/VesselPainter.ts';
import type {
  AppScreen,
  BrushSizePreset,
  GameMode,
  GuidedLessonId,
  PotteryPersonality,
  PotteryStage,
  SavedPotteryItem,
  SimilarityResult,
  StudioSettings,
} from '../types.ts';
import { INTERACTIVE_TUTORIAL_STEPS } from '../ui/TutorialManager.ts';

export interface VRStudioPanelActions {
  onNavigate: (screen: AppScreen) => void;
  onStartMode: (
    mode: GameMode,
    lessonId?: GuidedLessonId,
    challengeId?: string
  ) => void;
  onStageSelect: (stage: PotteryStage) => void;
  onWheelSpeedChange: (speed: number) => void;
  onToggleBrush: () => void;
  onSelectBrushColor: (colorId: string) => void;
  onSelectBrushSize: (size: BrushSizePreset) => void;
  onToggleEraser: () => void;
  onUndoPaint: () => void;
  onClearPaint: () => void;
  onToggleGlazePaintMode: (paintMode: boolean) => void;
  onToggleGlazeSpin: () => void;
  onSelectGlaze: (glazeId: string) => void;
  onFireKiln: () => void;
  onFinishPot: () => void;
  onContinueShaping: () => void;
  onSaveToGallery: (customName?: string) => void;
  onSelectGalleryItem: (id: string) => void;
  onDeleteGalleryItem: (id: string) => void;
  onToggleGallerySmash: () => void;
  onSmashAllGallery: () => void;
  onRestoreGallery: () => void;
  onExportGLB: (id?: string) => void;
  onRotateGalleryVessel: (deltaRad: number) => void;
  onToggleGallerySpin: () => void;
  onTutorialSelectStep: (index: number) => void;
  onTutorialPrev: () => void;
  onTutorialNext: () => void;
  onTutorialResetPractice: () => void;
  onUpdateSettings: (partial: Partial<StudioSettings>) => void;
  onUndo: () => void;
  onRequestReset: () => void;
  onConfirmReset: () => void;
  onCancelReset: () => void;
  onRecenterStation: () => void;
  onExitVR: () => void;
}

export interface VRPanelSyncState {
  screen: AppScreen;
  mode: GameMode;
  lessonId: GuidedLessonId;
  challengeId: string;
  stage: PotteryStage;
  wheelSpeed: number;
  brushActive: boolean;
  brushColorId: string;
  brushSize: BrushSizePreset;
  eraserMode: boolean;
  hasPaint: boolean;
  canUndoPaint: boolean;
  canUndo: boolean;
  glazePaintMode: boolean;
  glazeSpinEnabled: boolean;
  glazeId: string;
  gestureDesc: string;
  handsCount: number;
  similarity: SimilarityResult | null;
  personality: PotteryPersonality | null;
  needsResetConfirm: boolean;
  showResetConfirm: boolean;
  showCelebration: boolean;
  kilnCaption: string;
  kilnTemp: string;
  kilnProgress: number;
  kilnFinished: boolean;
  saveStatus: { saved: boolean; message: string };
  galleryItems: SavedPotteryItem[];
  selectedGalleryId: string | null;
  gallerySpinEnabled: boolean;
  gallerySmashMode: boolean;
  gallerySmashScope: SmashScope;
  galleryTotalVessels: number;
  galleryCrackedCount: number;
  gallerySmashedCount: number;
  galleryIsRestoring: boolean;
  galleryFocusedName: string | null;
  galleryFocusedHits: number;
  tutorialStepIndex: number;
  tutorialTitle: string;
  tutorialCue: string;
  tutorialProgress: number;
  tutorialMatched: boolean;
  tutorialFinishedAll: boolean;
  completedTutorialIds: ReadonlySet<string>;
  settings: StudioSettings;
}

const KILN_NAME_PRESETS = [
  'Horizon Amphora',
  'Courtyard Vessel',
  'Sunlit Tea Jar',
  'Hearthstone Bowl',
  'Willow Neck Vase',
  'Terrace Chalice',
];

const GALLERY_PAGE_SIZE = 4;

/**
 * Complete spatial 3D studio interface built with XR Blocks UI components so
 * Meta Quest users can interact with every single screen (Home, Mode Select,
 * Tutorial, Studio, Brush/Glaze, Kiln, Gallery, and Settings) using VR hand
 * rays, pinch selection, or direct touch right from launch.
 */
export class VRStudioPanel extends THREE.Group {
  private readonly actions: VRStudioPanelActions;
  private readonly card: xb.UICard;

  // Header & Navigation
  private readonly headerTitle: xb.UIText;
  private readonly headerSubtitle: xb.UIText;
  private readonly navButtons = new Map<AppScreen, xb.UIButton>();

  // Per-screen root panels
  private readonly screenPanels: Record<AppScreen, xb.UIPanel>;

  // Welcome (Home)
  private readonly welcomeGalleryBtn: xb.UIButton;

  // Start Studio (Mode Selection)
  private startMode: GameMode = 'free';
  private startLesson: GuidedLessonId = 'cup';
  private startChallenge = 'tapered-vase';
  private startModeInitialized = false;
  private readonly startModeBtns = new Map<GameMode, xb.UIButton>();
  private readonly startGuidedRow: xb.UIPanel;
  private readonly startGuidedBtns = new Map<GuidedLessonId, xb.UIButton>();
  private readonly startChallengeRow: xb.UIPanel;
  private readonly startChallengeBtns = new Map<string, xb.UIButton>();
  private readonly startSummaryText: xb.UIText;
  private readonly startOpenBtn: xb.UIButton;

  // Interactive Tutorial
  private readonly tutStepBtns: xb.UIButton[] = [];
  private readonly tutTitleText: xb.UIText;
  private readonly tutCueText: xb.UIText;
  private readonly tutStatusText: xb.UIText;
  private readonly tutProgressFill: xb.UIPanel;
  private readonly tutEnterBtn: xb.UIButton;

  // Studio Controls
  private readonly studioStageBtns = new Map<PotteryStage, xb.UIButton>();
  private readonly studioSpeedSlider: xb.UISlider;
  private readonly studioSpeedVal: xb.UIText;
  private readonly studioModeHintText: xb.UIText;
  private readonly studioBrushToggleBtn: xb.UIButton;
  private readonly studioUndoBtn: xb.UIButton;
  private readonly studioMainControls: xb.UIPanel;
  private readonly studioResetConfirmPanel: xb.UIPanel;
  private readonly studioCelebrationPanel: xb.UIPanel;
  private readonly celebrationTitle: xb.UIText;
  private readonly celebrationDetail: xb.UIText;

  // Shared Brush Palette Panel (reparented or mirrored inside Studio/Glaze; we place one in a shared slot right below Studio/Glaze content)
  private readonly brushSectionPanel: xb.UIPanel;
  private readonly pigmentButtons = new Map<string, xb.UIButton>();
  private readonly brushSizeButtons = new Map<BrushSizePreset, xb.UIButton>();
  private readonly brushEraserBtn: xb.UIButton;
  private readonly brushUndoBtn: xb.UIButton;
  private readonly brushClearBtn: xb.UIButton;

  // Glaze Controls
  private readonly glazeVesselTitle: xb.UIText;
  private readonly glazeVesselMeta: xb.UIText;
  private readonly glazePaintBtn: xb.UIButton;
  private readonly glazeOrbitBtn: xb.UIButton;
  private readonly glazeSpinBtn: xb.UIButton;
  private readonly glazeSwatches = new Map<string, xb.UIButton>();

  // Kiln Controls
  private readonly kilnCaptionText: xb.UIText;
  private readonly kilnTempText: xb.UIText;
  private readonly kilnProgressFill: xb.UIPanel;
  private readonly kilnDonePanel: xb.UIPanel;
  private readonly kilnNameBtn: xb.UIButton;
  private readonly kilnSaveBtn: xb.UIButton;
  private readonly kilnSaveStatusText: xb.UIText;
  private kilnNameIdx = 0;
  private customKilnName = '';

  // Gallery Controls
  private galleryPage = 0;
  private readonly galleryItemTitle: xb.UIText;
  private readonly galleryItemMeta: xb.UIText;
  private readonly gallerySlotBtns: xb.UIButton[] = [];
  private readonly gallerySlotIds: Array<string | null> = [];
  private readonly galleryPageLabel: xb.UIText;
  private readonly galleryPrevPageBtn: xb.UIButton;
  private readonly galleryNextPageBtn: xb.UIButton;
  private readonly gallerySpinBtn: xb.UIButton;
  private readonly galleryRotLeftBtn: xb.UIButton;
  private readonly galleryRotRightBtn: xb.UIButton;
  private readonly galleryExportBtn: xb.UIButton;
  private readonly gallerySmashBtn: xb.UIButton;
  private readonly gallerySmashAllBtn: xb.UIButton;
  private readonly galleryRestoreBtn: xb.UIButton;
  private readonly galleryDeleteBtn: xb.UIButton;

  // Settings Controls
  private readonly setSensSlider: xb.UISlider;
  private readonly setSensVal: xb.UIText;
  private readonly setWheelSlider: xb.UISlider;
  private readonly setWheelVal: xb.UIText;
  private readonly setMusicSlider: xb.UISlider;
  private readonly setMusicVal: xb.UIText;
  private readonly setSfxSlider: xb.UISlider;
  private readonly setSfxVal: xb.UIText;
  private readonly setSoundBtn: xb.UIButton;
  private readonly setMotionBtn: xb.UIButton;
  private readonly setHandBtn: xb.UIButton;

  // External value trackers for sliders so VR dragging isn't overwritten
  private lastStudioWheelSpeed = -1;
  private lastSetSens = -1;
  private lastSetWheel = -1;
  private lastSetMusic = -1;
  private lastSetSfx = -1;

  constructor(actions: VRStudioPanelActions) {
    super();
    this.actions = actions;
    this.name = 'VRStudioPanel';
    this.visible = false;

    // --- 1. Header & Persistent Nav ---
    this.headerTitle = new xb.UIText({
      text: 'CLAY HANDS · META QUEST STUDIO',
      style: { fontSize: 18, fontWeight: 'bold', textAlign: 'left', flexGrow: 1 },
    });
    this.headerSubtitle = new xb.UIText({
      text: 'Point with either hand ray and pinch to interact.',
      style: { fontSize: 13, lineHeight: 1.25, opacity: 0.8, textAlign: 'left' },
    });

    const headerTop = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 6,
      },
      children: [
        this.headerTitle,
        new xb.UIButton({
          label: 'Recenter',
          icon: 'my_location',
          style: { fontSize: 13, padding: 6 },
          onClick: () => actions.onRecenterStation(),
        }),
        new xb.UIButton({
          label: 'Exit VR',
          icon: 'close',
          style: { fontSize: 13, padding: 6 },
          onClick: () => actions.onExitVR(),
        }),
      ],
    });

    const navEntries: Array<[AppScreen, string]> = [
      ['welcome', 'Home'],
      ['start-studio', 'Modes'],
      ['tutorial', 'Guide'],
      ['studio', 'Wheel'],
      ['glaze', 'Glaze'],
      ['gallery', 'Gallery'],
      ['settings', 'Settings'],
    ];
    const navRow = new xb.UIPanel({
      style: { width: '100%', flexDirection: 'row', gap: 4 },
      children: navEntries.map(([scr, lbl]) => {
        const btn = new xb.UIButton({
          label: lbl,
          style: { flexGrow: 1, fontSize: 13, padding: 6 },
          onClick: () => actions.onNavigate(scr),
        });
        this.navButtons.set(scr, btn);
        return btn;
      }),
    });

    // --- 2. WELCOME (HOME) PANEL ---
    this.welcomeGalleryBtn = new xb.UIButton({
      label: 'Pottery Gallery (0)',
      icon: 'collections',
      style: { flexGrow: 1, fontSize: 15, padding: 10 },
      onClick: () => actions.onNavigate('gallery'),
    });
    const welcomePanel = new xb.UIPanel({
      style: { width: '100%', flexDirection: 'column', gap: 10 },
      children: [
        new xb.UIText({
          text: 'Hands-First WebXR Pottery Studio',
          style: { fontSize: 20, fontWeight: 'bold' },
        }),
        new xb.UIText({
          text: '100% controller-free spatial craft. Pinch any button with your hand ray or touch directly, sculpt living clay with both hands, fire glazed vessels, and export 3D .glb models.',
          style: { fontSize: 14, lineHeight: 1.35, opacity: 0.85 },
        }),
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 8 },
          children: [
            new xb.UIButton({
              label: 'Choose Mode & Start',
              icon: 'play_arrow',
              style: { flexGrow: 1, fontSize: 15, padding: 10 },
              onClick: () => actions.onNavigate('start-studio'),
            }),
            new xb.UIButton({
              label: 'Quick Free Wheel',
              icon: 'cyclone',
              style: { flexGrow: 1, fontSize: 15, padding: 10 },
              onClick: () => actions.onStartMode('free'),
            }),
          ],
        }),
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 8 },
          children: [
            new xb.UIButton({
              label: 'Interactive Hand Guide',
              icon: 'school',
              style: { flexGrow: 1, fontSize: 15, padding: 10 },
              onClick: () => actions.onNavigate('tutorial'),
            }),
            this.welcomeGalleryBtn,
          ],
        }),
        new xb.UIButton({
          label: 'Studio Settings & Hand Sensitivity',
          icon: 'tune',
          style: { width: '100%', fontSize: 14, padding: 9 },
          onClick: () => actions.onNavigate('settings'),
        }),
      ],
    });

    // --- 3. START-STUDIO (MODE SELECT) PANEL ---
    const modeDefs: Array<[GameMode, string]> = [
      ['free', 'Free Wheel'],
      ['guided', 'Guided Lesson'],
      ['challenge', 'Shape Match'],
    ];
    const startModeRow = new xb.UIPanel({
      style: { width: '100%', flexDirection: 'row', gap: 6 },
      children: modeDefs.map(([m, lbl]) => {
        const btn = new xb.UIButton({
          label: lbl,
          style: { flexGrow: 1, fontSize: 14, padding: 9 },
          onClick: () => {
            this.startMode = m;
            this.refreshStartSelectionStyles();
          },
        });
        this.startModeBtns.set(m, btn);
        return btn;
      }),
    });

    const shortLessonLabels: Record<GuidedLessonId, string> = {
      cup: 'Tea Cup',
      bowl: 'Open Bowl',
      vase: 'Tall Vase',
    };
    this.startGuidedRow = new xb.UIPanel({
      visible: false,
      style: { display: 'none', width: '100%', flexDirection: 'row', gap: 6 },
      children: GUIDED_LESSONS.map((l) => {
        const btn = new xb.UIButton({
          label: shortLessonLabels[l.id],
          style: { flexGrow: 1, fontSize: 14, padding: 8 },
          onClick: () => {
            this.startMode = 'guided';
            this.startLesson = l.id;
            this.refreshStartSelectionStyles();
          },
        });
        this.startGuidedBtns.set(l.id, btn);
        return btn;
      }),
    });

    const shortChallengeLabels: Record<string, string> = {
      'classic-cup': 'Cup',
      'tea-bowl': 'Bowl',
      'tapered-vase': 'Vase',
      'lantern-amphora': 'Amphora',
    };
    this.startChallengeRow = new xb.UIPanel({
      visible: false,
      style: { display: 'none', width: '100%', flexDirection: 'row', gap: 6 },
      children: CHALLENGE_PRESETS.map((c) => {
        const btn = new xb.UIButton({
          label: shortChallengeLabels[c.id] ?? c.name,
          style: { flexGrow: 1, fontSize: 13, padding: 8 },
          onClick: () => {
            this.startMode = 'challenge';
            this.startChallenge = c.id;
            this.refreshStartSelectionStyles();
          },
        });
        this.startChallengeBtns.set(c.id, btn);
        return btn;
      }),
    });

    this.startSummaryText = new xb.UIText({
      text: 'Open throwing on a fresh mound of wet clay.',
      style: { fontSize: 14, lineHeight: 1.3, opacity: 0.85 },
    });

    this.startOpenBtn = new xb.UIButton({
      label: 'Open Free Wheel',
      icon: 'play_arrow',
      style: {
        flexGrow: 2,
        fontSize: 15,
        padding: 10,
        backgroundColor: '#b84f33',
      },
      onClick: () =>
        actions.onStartMode(
          this.startMode,
          this.startLesson,
          this.startChallenge
        ),
    });

    const startStudioPanel = new xb.UIPanel({
      visible: false,
      style: { display: 'none', width: '100%', flexDirection: 'column', gap: 10 },
      children: [
        new xb.UIText({
          text: 'Choose Pottery Mode',
          style: { fontSize: 18, fontWeight: 'bold' },
        }),
        startModeRow,
        this.startGuidedRow,
        this.startChallengeRow,
        this.startSummaryText,
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 8 },
          children: [
            new xb.UIButton({
              label: 'Back to Home',
              icon: 'arrow_back',
              style: { flexGrow: 1, fontSize: 14, padding: 10 },
              onClick: () => actions.onNavigate('welcome'),
            }),
            this.startOpenBtn,
          ],
        }),
      ],
    });

    // --- 4. INTERACTIVE TUTORIAL PANEL ---
    const tutDotsRow = new xb.UIPanel({
      style: { width: '100%', flexDirection: 'row', gap: 6 },
      children: INTERACTIVE_TUTORIAL_STEPS.map((s, idx) => {
        const btn = new xb.UIButton({
          label: `${idx + 1}. ${s.title.split(' ')[0]}`,
          style: { flexGrow: 1, fontSize: 12, padding: 6 },
          onClick: () => actions.onTutorialSelectStep(idx),
        });
        this.tutStepBtns.push(btn);
        return btn;
      }),
    });
    this.tutTitleText = new xb.UIText({
      text: '1. Compress & Center',
      style: { fontSize: 18, fontWeight: 'bold' },
    });
    this.tutCueText = new xb.UIText({
      text: 'Bring both palms inward around clay',
      style: { fontSize: 14, lineHeight: 1.3 },
    });
    this.tutStatusText = new xb.UIText({
      text: 'Practice with both hands over the wheel.',
      style: { fontSize: 13, opacity: 0.85 },
    });
    this.tutProgressFill = new xb.UIPanel({
      style: {
        width: '0%',
        height: '100%',
        backgroundColor: '#5da66b',
        borderRadius: 6,
      },
    });
    const tutProgressTrack = new xb.UIPanel({
      style: {
        width: '100%',
        height: 12,
        backgroundColor: 'rgba(255,255,255,0.16)',
        borderRadius: 6,
        overflow: 'hidden',
      },
      children: [this.tutProgressFill],
    });
    this.tutEnterBtn = new xb.UIButton({
      label: 'Enter Studio',
      icon: 'play_arrow',
      style: { flexGrow: 1, fontSize: 14, padding: 8 },
      onClick: () => actions.onNavigate('studio'),
    });

    const tutorialPanel = new xb.UIPanel({
      visible: false,
      style: { display: 'none', width: '100%', flexDirection: 'column', gap: 8 },
      children: [
        tutDotsRow,
        this.tutTitleText,
        this.tutCueText,
        this.tutStatusText,
        tutProgressTrack,
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 6 },
          children: [
            new xb.UIButton({
              label: 'Prev',
              icon: 'arrow_back',
              style: { flexGrow: 1, fontSize: 13, padding: 7 },
              onClick: () => actions.onTutorialPrev(),
            }),
            new xb.UIButton({
              label: 'Next',
              icon: 'arrow_forward',
              style: { flexGrow: 1, fontSize: 13, padding: 7 },
              onClick: () => actions.onTutorialNext(),
            }),
            new xb.UIButton({
              label: 'Reset Clay',
              icon: 'restart_alt',
              style: { flexGrow: 1, fontSize: 13, padding: 7 },
              onClick: () => actions.onTutorialResetPractice(),
            }),
            this.tutEnterBtn,
          ],
        }),
      ],
    });

    // --- 5. SHARED BRUSH PALETTE PANEL (used in Studio brush mode & Glaze paint mode) ---
    const pigmentRow = new xb.UIPanel({
      style: { width: '100%', flexDirection: 'row', gap: 6 },
      children: VILLAGE_PIGMENTS.map((p) => {
        const swatch = new xb.UIPanel({
          pointerEvents: 'none',
          style: {
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: p.hex,
            borderWidth: 1.5,
            borderColor: '#ffffff',
          },
        });
        const btn = new xb.UIButton({
          ariaLabel: `Pigment ${p.name}`,
          style: {
            flexGrow: 1,
            height: 36,
            padding: 4,
            justifyContent: 'center',
            alignItems: 'center',
          },
          children: [swatch],
          onClick: () => actions.onSelectBrushColor(p.id),
        });
        this.pigmentButtons.set(p.id, btn);
        return btn;
      }),
    });

    const sizeDefs: Array<[BrushSizePreset, string]> = [
      ['fine', 'Fine'],
      ['medium', 'Med'],
      ['broad', 'Broad'],
    ];
    this.brushEraserBtn = new xb.UIButton({
      label: 'Eraser',
      style: { flexGrow: 1, fontSize: 13, padding: 6 },
      onClick: () => actions.onToggleEraser(),
    });
    this.brushUndoBtn = new xb.UIButton({
      label: 'Undo Ink',
      style: { flexGrow: 1, fontSize: 13, padding: 6 },
      onClick: () => actions.onUndoPaint(),
    });
    this.brushClearBtn = new xb.UIButton({
      label: 'Clear',
      style: { flexGrow: 1, fontSize: 13, padding: 6 },
      onClick: () => actions.onClearPaint(),
    });
    const brushMetaRow = new xb.UIPanel({
      style: { width: '100%', flexDirection: 'row', gap: 5 },
      children: [
        ...sizeDefs.map(([sz, lbl]) => {
          const btn = new xb.UIButton({
            label: lbl,
            style: { flexGrow: 1, fontSize: 13, padding: 6 },
            onClick: () => actions.onSelectBrushSize(sz),
          });
          this.brushSizeButtons.set(sz, btn);
          return btn;
        }),
        this.brushEraserBtn,
        this.brushUndoBtn,
        this.brushClearBtn,
      ],
    });

    this.brushSectionPanel = new xb.UIPanel({
      visible: false,
      style: {
        display: 'none',
        width: '100%',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        borderRadius: 12,
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
      },
      children: [
        new xb.UIText({
          text: 'VILLAGE BRUSH · Aim ray or fingertip & pinch clay to paint',
          style: { fontSize: 12, fontWeight: 'bold', opacity: 0.85 },
        }),
        pigmentRow,
        brushMetaRow,
      ],
    });

    // --- 6. STUDIO PANEL ---
    const stageDefs: Array<[PotteryStage, string]> = [
      ['center', '1.Center'],
      ['open', '2.Open'],
      ['shape', '3.Shape'],
      ['smooth', '4.Smooth'],
    ];
    const studioStageRow = new xb.UIPanel({
      style: { width: '100%', flexDirection: 'row', gap: 6 },
      children: stageDefs.map(([st, lbl]) => {
        const btn = new xb.UIButton({
          label: lbl,
          style: { flexGrow: 1, fontSize: 13, padding: 7 },
          onClick: () => actions.onStageSelect(st),
        });
        this.studioStageBtns.set(st, btn);
        return btn;
      }),
    });

    this.studioSpeedVal = new xb.UIText({
      text: '1.0x',
      style: { fontSize: 14, fontWeight: 'bold' },
    });
    this.studioSpeedSlider = new xb.UISlider({
      ariaLabel: 'Wheel Speed',
      min: 0.2,
      max: 2.0,
      step: 0.1,
      value: 1.0,
      style: { width: '100%', height: 34 },
      onInput: (val) => {
        this.studioSpeedVal.text = `${val.toFixed(1)}x`;
        actions.onWheelSpeedChange(val);
      },
    });
    this.studioModeHintText = new xb.UIText({
      text: '',
      visible: false,
      style: { display: 'none', fontSize: 13, lineHeight: 1.25, opacity: 0.88 },
    });
    this.studioBrushToggleBtn = new xb.UIButton({
      label: 'Brush: Off',
      icon: 'brush',
      style: { flexGrow: 1, fontSize: 14, padding: 8 },
      onClick: () => actions.onToggleBrush(),
    });
    this.studioUndoBtn = new xb.UIButton({
      label: 'Undo',
      icon: 'undo',
      style: { flexGrow: 1, fontSize: 14, padding: 8 },
      onClick: () => actions.onUndo(),
    });

    this.studioMainControls = new xb.UIPanel({
      style: { width: '100%', flexDirection: 'column', gap: 8 },
      children: [
        studioStageRow,
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          },
          children: [
            new xb.UIText({ text: 'Wheel Speed', style: { fontSize: 14 } }),
            this.studioSpeedVal,
          ],
        }),
        this.studioSpeedSlider,
        this.studioModeHintText,
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 6 },
          children: [
            this.studioBrushToggleBtn,
            this.studioUndoBtn,
            new xb.UIButton({
              label: 'Reset',
              icon: 'restart_alt',
              style: { flexGrow: 1, fontSize: 14, padding: 8 },
              onClick: () => actions.onRequestReset(),
            }),
            new xb.UIButton({
              label: 'Finish Pot',
              icon: 'check_circle',
              style: { flexGrow: 1, fontSize: 14, padding: 8 },
              onClick: () => actions.onFinishPot(),
            }),
          ],
        }),
      ],
    });

    this.studioResetConfirmPanel = new xb.UIPanel({
      visible: false,
      style: {
        display: 'none',
        width: '100%',
        flexDirection: 'column',
        gap: 10,
        padding: 12,
        borderRadius: 12,
        backgroundColor: 'rgba(181, 67, 55, 0.25)',
      },
      children: [
        new xb.UIText({
          text: 'Reset Clay?',
          style: { fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
        }),
        new xb.UIText({
          text: 'Resetting returns this vessel to a fresh lump of clay.',
          style: { fontSize: 14, textAlign: 'center', opacity: 0.9 },
        }),
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 8 },
          children: [
            new xb.UIButton({
              label: 'Confirm Reset',
              icon: 'delete',
              style: { flexGrow: 1, fontSize: 14, padding: 9 },
              onClick: () => actions.onConfirmReset(),
            }),
            new xb.UIButton({
              label: 'Keep Working',
              icon: 'close',
              style: { flexGrow: 1, fontSize: 14, padding: 9 },
              onClick: () => actions.onCancelReset(),
            }),
          ],
        }),
      ],
    });

    this.celebrationTitle = new xb.UIText({
      text: 'Vessel Shaped',
      style: { fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
    });
    this.celebrationDetail = new xb.UIText({
      text: '',
      style: { fontSize: 14, lineHeight: 1.3, textAlign: 'center', opacity: 0.9 },
    });
    this.studioCelebrationPanel = new xb.UIPanel({
      visible: false,
      style: {
        display: 'none',
        width: '100%',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        borderRadius: 12,
        backgroundColor: 'rgba(77, 109, 67, 0.28)',
      },
      children: [
        this.celebrationTitle,
        this.celebrationDetail,
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 8 },
          children: [
            new xb.UIButton({
              label: 'Choose Glaze & Fire',
              icon: 'water_drop',
              style: { flexGrow: 1, fontSize: 14, padding: 9 },
              onClick: () => actions.onNavigate('glaze'),
            }),
            new xb.UIButton({
              label: 'Continue Shaping',
              icon: 'edit',
              style: { flexGrow: 1, fontSize: 14, padding: 9 },
              onClick: () => actions.onContinueShaping(),
            }),
          ],
        }),
      ],
    });

    const studioPanel = new xb.UIPanel({
      visible: false,
      style: { display: 'none', width: '100%', flexDirection: 'column', gap: 8 },
      children: [
        this.studioMainControls,
        this.studioResetConfirmPanel,
        this.studioCelebrationPanel,
      ],
    });

    // --- 7. GLAZE & PAINT PANEL ---
    this.glazeVesselTitle = new xb.UIText({
      text: 'Studio Vessel',
      style: { fontSize: 18, fontWeight: 'bold' },
    });
    this.glazeVesselMeta = new xb.UIText({
      text: 'Pick a glaze finish and paint motifs before firing.',
      style: { fontSize: 13, opacity: 0.85 },
    });
    this.glazePaintBtn = new xb.UIButton({
      label: 'Paint Brush',
      icon: 'brush',
      style: { flexGrow: 1, fontSize: 13, padding: 7 },
      onClick: () => actions.onToggleGlazePaintMode(true),
    });
    this.glazeOrbitBtn = new xb.UIButton({
      label: 'Inspect Only',
      icon: 'visibility',
      style: { flexGrow: 1, fontSize: 13, padding: 7 },
      onClick: () => actions.onToggleGlazePaintMode(false),
    });
    this.glazeSpinBtn = new xb.UIButton({
      label: 'Wheel: Still',
      icon: 'sync',
      style: { flexGrow: 1, fontSize: 13, padding: 7 },
      onClick: () => actions.onToggleGlazeSpin(),
    });

    const createGlazeRow = (items: typeof GLAZE_CATALOG) =>
      new xb.UIPanel({
        style: { width: '100%', flexDirection: 'row', gap: 6 },
        children: items.map((g) => {
          const swatch = new xb.UIPanel({
            pointerEvents: 'none',
            style: {
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: g.color,
              borderWidth: 1,
              borderColor: '#ffffff',
            },
          });
          const lbl = new xb.UIText({
            text: g.name.split(' ')[0],
            pointerEvents: 'none',
            style: { fontSize: 12, fontWeight: 'bold' },
          });
          const btn = new xb.UIButton({
            ariaLabel: `${g.name} glaze`,
            style: {
              flexGrow: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              padding: 7,
            },
            children: [swatch, lbl],
            onClick: () => actions.onSelectGlaze(g.id),
          });
          this.glazeSwatches.set(g.id, btn);
          return btn;
        }),
      });

    const glazePanel = new xb.UIPanel({
      visible: false,
      style: { display: 'none', width: '100%', flexDirection: 'column', gap: 8 },
      children: [
        this.glazeVesselTitle,
        this.glazeVesselMeta,
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 6 },
          children: [this.glazePaintBtn, this.glazeOrbitBtn, this.glazeSpinBtn],
        }),
        createGlazeRow(GLAZE_CATALOG.slice(0, 4)),
        createGlazeRow(GLAZE_CATALOG.slice(4, 8)),
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 8 },
          children: [
            new xb.UIButton({
              label: 'Back to Wheel',
              icon: 'arrow_back',
              style: { flexGrow: 1, fontSize: 14, padding: 9 },
              onClick: () => actions.onNavigate('studio'),
            }),
            new xb.UIButton({
              label: 'Fire in Magical Kiln',
              icon: 'local_fire_department',
              style: { flexGrow: 2, fontSize: 14, padding: 9 },
              onClick: () => actions.onFireKiln(),
            }),
          ],
        }),
      ],
    });

    // --- 8. KILN PANEL ---
    this.kilnCaptionText = new xb.UIText({
      text: 'Heating brick kiln...',
      style: { fontSize: 18, fontWeight: 'bold' },
    });
    this.kilnTempText = new xb.UIText({
      text: 'Ambient',
      style: { fontSize: 16, fontWeight: 'bold' },
    });
    this.kilnProgressFill = new xb.UIPanel({
      style: {
        width: '0%',
        height: '100%',
        backgroundColor: '#e19538',
        borderRadius: 6,
      },
    });
    const kilnProgressTrack = new xb.UIPanel({
      style: {
        width: '100%',
        height: 14,
        backgroundColor: 'rgba(255,255,255,0.16)',
        borderRadius: 7,
        overflow: 'hidden',
      },
      children: [this.kilnProgressFill],
    });

    this.kilnNameBtn = new xb.UIButton({
      label: 'Name: Auto',
      icon: 'edit',
      style: { flexGrow: 1, fontSize: 13, padding: 8 },
      onClick: () => {
        this.kilnNameIdx = (this.kilnNameIdx + 1) % KILN_NAME_PRESETS.length;
        this.customKilnName = KILN_NAME_PRESETS[this.kilnNameIdx];
        this.kilnNameBtn.label = `Name: ${this.customKilnName}`;
      },
    });
    this.kilnSaveBtn = new xb.UIButton({
      label: 'Save to Gallery',
      icon: 'bookmark_add',
      style: { flexGrow: 1, fontSize: 14, padding: 9 },
      onClick: () =>
        actions.onSaveToGallery(this.customKilnName || undefined),
    });
    this.kilnSaveStatusText = new xb.UIText({
      text: '',
      visible: false,
      style: { display: 'none', fontSize: 13, color: '#8be09e', textAlign: 'center' },
    });

    this.kilnDonePanel = new xb.UIPanel({
      visible: false,
      style: { display: 'none', width: '100%', flexDirection: 'column', gap: 8 },
      children: [
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 6 },
          children: [this.kilnNameBtn, this.kilnSaveBtn],
        }),
        this.kilnSaveStatusText,
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 6 },
          children: [
            new xb.UIButton({
              label: 'Export GLB',
              icon: 'download',
              style: { flexGrow: 1, fontSize: 13, padding: 8 },
              onClick: () => actions.onExportGLB(),
            }),
            new xb.UIButton({
              label: 'Open Gallery',
              icon: 'collections',
              style: { flexGrow: 1, fontSize: 13, padding: 8 },
              onClick: () => actions.onNavigate('gallery'),
            }),
            new xb.UIButton({
              label: 'Throw Another',
              icon: 'restart_alt',
              style: { flexGrow: 1, fontSize: 13, padding: 8 },
              onClick: () => {
                this.customKilnName = '';
                this.kilnNameIdx = 0;
                this.kilnNameBtn.label = 'Name: Auto';
                actions.onStartMode('free');
              },
            }),
          ],
        }),
      ],
    });

    const kilnPanel = new xb.UIPanel({
      visible: false,
      style: { display: 'none', width: '100%', flexDirection: 'column', gap: 10 },
      children: [
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          },
          children: [this.kilnCaptionText, this.kilnTempText],
        }),
        kilnProgressTrack,
        this.kilnDonePanel,
      ],
    });

    // --- 9. GALLERY PANEL ---
    this.galleryItemTitle = new xb.UIText({
      text: 'Pottery Gallery',
      style: { fontSize: 18, fontWeight: 'bold' },
    });
    this.galleryItemMeta = new xb.UIText({
      text: 'Your fired vessels appear on the pedestal.',
      style: { fontSize: 13, opacity: 0.85 },
    });

    for (let i = 0; i < GALLERY_PAGE_SIZE; i++) {
      this.gallerySlotIds.push(null);
      const slotIndex = i;
      const btn = new xb.UIButton({
        label: `Empty`,
        visible: false,
        style: { display: 'none', flexGrow: 1, fontSize: 12, padding: 7 },
        onClick: () => {
          const id = this.gallerySlotIds[slotIndex];
          if (id) actions.onSelectGalleryItem(id);
        },
      });
      this.gallerySlotBtns.push(btn);
    }

    this.galleryPageLabel = new xb.UIText({
      text: '1 / 1',
      style: { fontSize: 13, textAlign: 'center', flexGrow: 1 },
    });
    this.galleryPrevPageBtn = new xb.UIButton({
      label: 'Prev',
      icon: 'chevron_left',
      style: { fontSize: 13, padding: 6 },
      onClick: () => {
        this.galleryPage = Math.max(0, this.galleryPage - 1);
      },
    });
    this.galleryNextPageBtn = new xb.UIButton({
      label: 'Next',
      icon: 'chevron_right',
      style: { fontSize: 13, padding: 6 },
      onClick: () => {
        this.galleryPage += 1;
      },
    });

    this.gallerySpinBtn = new xb.UIButton({
      label: 'Spin: On',
      icon: 'sync',
      style: { flexGrow: 1, fontSize: 13, padding: 7 },
      onClick: () => actions.onToggleGallerySpin(),
    });
    this.galleryRotLeftBtn = new xb.UIButton({
      label: 'Rotate -45°',
      style: { flexGrow: 1, fontSize: 13, padding: 7 },
      onClick: () => actions.onRotateGalleryVessel(-Math.PI / 4),
    });
    this.galleryRotRightBtn = new xb.UIButton({
      label: 'Rotate +45°',
      style: { flexGrow: 1, fontSize: 13, padding: 7 },
      onClick: () => actions.onRotateGalleryVessel(Math.PI / 4),
    });
    this.galleryExportBtn = new xb.UIButton({
      label: 'Export GLB',
      icon: 'download',
      style: { flexGrow: 1, fontSize: 13, padding: 7 },
      onClick: () => {
        const currentId =
          this.currentSelectedGalleryId ?? this.gallerySlotIds.find(Boolean);
        actions.onExportGLB(currentId ?? undefined);
      },
    });
    this.gallerySmashBtn = new xb.UIButton({
      label: 'Smash (Bat)',
      icon: 'sports_baseball',
      style: { flexGrow: 1, fontSize: 13, padding: 7 },
      onClick: () => actions.onToggleGallerySmash(),
    });
    this.gallerySmashAllBtn = new xb.UIButton({
      label: 'Smash All',
      icon: 'gavel',
      style: { flexGrow: 1, fontSize: 13, padding: 7 },
      onClick: () => actions.onSmashAllGallery(),
    });
    this.galleryRestoreBtn = new xb.UIButton({
      label: 'Restore (Time)',
      icon: 'history',
      visible: false,
      style: {
        display: 'none',
        flexGrow: 1,
        fontSize: 13,
        padding: 7,
        backgroundColor: '#168754',
      },
      onClick: () => actions.onRestoreGallery(),
    });
    this.galleryDeleteBtn = new xb.UIButton({
      label: 'Delete',
      icon: 'delete',
      style: { flexGrow: 1, fontSize: 13, padding: 7 },
      onClick: () => {
        // Delete handled via currently active item in sync callback
        if (this.currentSelectedGalleryId) {
          actions.onDeleteGalleryItem(this.currentSelectedGalleryId);
        }
      },
    });

    const galleryPanel = new xb.UIPanel({
      visible: false,
      style: { display: 'none', width: '100%', flexDirection: 'column', gap: 8 },
      children: [
        this.galleryItemTitle,
        this.galleryItemMeta,
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 5 },
          children: this.gallerySlotBtns,
        }),
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          },
          children: [
            this.galleryPrevPageBtn,
            this.galleryPageLabel,
            this.galleryNextPageBtn,
          ],
        }),
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 5 },
          children: [
            this.gallerySpinBtn,
            this.galleryRotLeftBtn,
            this.galleryRotRightBtn,
            this.galleryExportBtn,
          ],
        }),
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 5 },
          children: [
            this.gallerySmashBtn,
            this.gallerySmashAllBtn,
            this.galleryRestoreBtn,
            this.galleryDeleteBtn,
          ],
        }),
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 8 },
          children: [
            new xb.UIButton({
              label: 'Create Pottery',
              icon: 'add_circle',
              style: { flexGrow: 1, fontSize: 14, padding: 8 },
              onClick: () => actions.onNavigate('start-studio'),
            }),
            new xb.UIButton({
              label: 'Home',
              icon: 'home',
              style: { flexGrow: 1, fontSize: 14, padding: 8 },
              onClick: () => actions.onNavigate('welcome'),
            }),
          ],
        }),
      ],
    });

    // --- 10. SETTINGS PANEL ---
    this.setSensVal = new xb.UIText({
      text: '1.0',
      style: { fontSize: 13, fontWeight: 'bold' },
    });
    this.setSensSlider = new xb.UISlider({
      ariaLabel: 'Hand Sensitivity',
      min: 0.5,
      max: 2.0,
      step: 0.1,
      value: 1.0,
      style: { width: '100%', height: 30 },
      onInput: (val) => {
        this.setSensVal.text = val.toFixed(1);
        actions.onUpdateSettings({ handSensitivity: val });
      },
    });
    this.setWheelVal = new xb.UIText({
      text: '1.0x',
      style: { fontSize: 13, fontWeight: 'bold' },
    });
    this.setWheelSlider = new xb.UISlider({
      ariaLabel: 'Wheel Speed',
      min: 0.2,
      max: 2.0,
      step: 0.1,
      value: 1.0,
      style: { width: '100%', height: 30 },
      onInput: (val) => {
        this.setWheelVal.text = `${val.toFixed(1)}x`;
        actions.onUpdateSettings({ wheelSpeed: val });
      },
    });
    this.setMusicVal = new xb.UIText({
      text: '35%',
      style: { fontSize: 13, fontWeight: 'bold' },
    });
    this.setMusicSlider = new xb.UISlider({
      ariaLabel: 'Music Volume',
      min: 0,
      max: 1,
      step: 0.05,
      value: 0.35,
      style: { width: '100%', height: 30 },
      onInput: (val) => {
        this.setMusicVal.text = `${Math.round(val * 100)}%`;
        actions.onUpdateSettings({ musicVolume: val });
      },
    });
    this.setSfxVal = new xb.UIText({
      text: '72%',
      style: { fontSize: 13, fontWeight: 'bold' },
    });
    this.setSfxSlider = new xb.UISlider({
      ariaLabel: 'SFX Volume',
      min: 0,
      max: 1,
      step: 0.05,
      value: 0.72,
      style: { width: '100%', height: 30 },
      onInput: (val) => {
        this.setSfxVal.text = `${Math.round(val * 100)}%`;
        actions.onUpdateSettings({ sfxVolume: val });
      },
    });

    this.setSoundBtn = new xb.UIButton({
      label: 'Sound: On',
      icon: 'volume_up',
      style: { flexGrow: 1, fontSize: 13, padding: 7 },
      onClick: () =>
        actions.onUpdateSettings({ soundEnabled: !this.latestSoundEnabled }),
    });
    this.setMotionBtn = new xb.UIButton({
      label: 'Motion: Full',
      icon: 'animation',
      style: { flexGrow: 1, fontSize: 13, padding: 7 },
      onClick: () =>
        actions.onUpdateSettings({ reducedMotion: !this.latestReducedMotion }),
    });
    this.setHandBtn = new xb.UIButton({
      label: 'Hand: Right',
      icon: 'pan_tool',
      style: { flexGrow: 1, fontSize: 13, padding: 7 },
      onClick: () =>
        actions.onUpdateSettings({
          handedness: this.latestHandedness === 'right' ? 'left' : 'right',
        }),
    });

    const settingsPanel = new xb.UIPanel({
      visible: false,
      style: { display: 'none', width: '100%', flexDirection: 'column', gap: 6 },
      children: [
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
          },
          children: [
            new xb.UIText({ text: 'Hand Sensitivity', style: { fontSize: 13 } }),
            this.setSensVal,
          ],
        }),
        this.setSensSlider,
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
          },
          children: [
            new xb.UIText({ text: 'Default Wheel Speed', style: { fontSize: 13 } }),
            this.setWheelVal,
          ],
        }),
        this.setWheelSlider,
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
          },
          children: [
            new xb.UIText({ text: 'Music Volume', style: { fontSize: 13 } }),
            this.setMusicVal,
          ],
        }),
        this.setMusicSlider,
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
          },
          children: [
            new xb.UIText({ text: 'Effects Volume', style: { fontSize: 13 } }),
            this.setSfxVal,
          ],
        }),
        this.setSfxSlider,
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 6 },
          children: [this.setSoundBtn, this.setMotionBtn, this.setHandBtn],
        }),
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 8 },
          children: [
            new xb.UIButton({
              label: 'Replay Hand Guide',
              icon: 'school',
              style: { flexGrow: 1, fontSize: 13, padding: 8 },
              onClick: () => actions.onNavigate('tutorial'),
            }),
            new xb.UIButton({
              label: 'Done',
              icon: 'check',
              style: { flexGrow: 1, fontSize: 13, padding: 8 },
              onClick: () => actions.onNavigate('welcome'),
            }),
          ],
        }),
      ],
    });

    this.screenPanels = {
      welcome: welcomePanel,
      'start-studio': startStudioPanel,
      'webcam-permission': welcomePanel,
      'hand-calibration': welcomePanel,
      studio: studioPanel,
      tutorial: tutorialPanel,
      glaze: glazePanel,
      kiln: kilnPanel,
      gallery: galleryPanel,
      settings: settingsPanel,
    };

    this.card = new xb.UICard({
      size: { width: 0.72, height: 'auto' },
      manipulation: true,
      edge: true,
      style: { flexDirection: 'column', gap: 10, padding: 16 },
      children: [
        headerTop,
        this.headerSubtitle,
        navRow,
        welcomePanel,
        startStudioPanel,
        tutorialPanel,
        studioPanel,
        glazePanel,
        this.brushSectionPanel,
        kilnPanel,
        galleryPanel,
        settingsPanel,
      ],
    });
    this.card.add(
      new xb.FaceCamera({
        mode: 'capsule',
        capsuleHalfHeight: 0.28,
        smoothing: 0.14,
      })
    );
    this.add(this.card);
    this.refreshStartSelectionStyles();
  }

  private currentSelectedGalleryId: string | null = null;
  private latestSoundEnabled = true;
  private latestReducedMotion = false;
  private latestHandedness: 'left' | 'right' = 'right';

  private setShown(el: xb.UIElement, show: boolean): void {
    if (el.visible !== show) {
      el.visible = show;
    }
    const nextDisplay = show ? 'flex' : 'none';
    if (el.style.display !== nextDisplay) {
      el.style.display = nextDisplay;
    }
  }

  private refreshStartSelectionStyles(): void {
    for (const [m, btn] of this.startModeBtns.entries()) {
      btn.style.backgroundColor =
        m === this.startMode ? '#b84f33' : undefined;
    }
    this.setShown(this.startGuidedRow, this.startMode === 'guided');
    this.setShown(this.startChallengeRow, this.startMode === 'challenge');

    for (const [id, btn] of this.startGuidedBtns.entries()) {
      btn.style.backgroundColor =
        id === this.startLesson ? '#b84f33' : undefined;
    }
    for (const [id, btn] of this.startChallengeBtns.entries()) {
      btn.style.backgroundColor =
        id === this.startChallenge ? '#b84f33' : undefined;
    }

    if (this.startMode === 'free') {
      this.startSummaryText.text =
        'Free Wheel · Shape any clay vessel freely with both hands, paint folk motifs, and glaze.';
      this.startOpenBtn.label = 'Open Free Wheel';
    } else if (this.startMode === 'guided') {
      const lesson =
        GUIDED_LESSONS.find((l) => l.id === this.startLesson) ??
        GUIDED_LESSONS[0];
      this.startSummaryText.text = `${lesson.title} · ${lesson.subtitle}`;
      this.startOpenBtn.label = `Open ${lesson.title}`;
    } else {
      const challenge =
        CHALLENGE_PRESETS.find((c) => c.id === this.startChallenge) ??
        CHALLENGE_PRESETS[0];
      this.startSummaryText.text = `${challenge.name} (${challenge.difficulty}) · ${challenge.subtitle}`;
      this.startOpenBtn.label = `Open ${challenge.name}`;
    }
  }

  public sync(state: VRPanelSyncState): void {
    // Sync initial start selection from app state once when opening start-studio
    if (!this.startModeInitialized && state.screen === 'start-studio') {
      this.startMode = state.mode;
      this.startLesson = state.lessonId;
      this.startChallenge = state.challengeId;
      this.startModeInitialized = true;
      this.refreshStartSelectionStyles();
    } else if (state.screen !== 'start-studio') {
      this.startModeInitialized = false;
    }

    // Header & status
    this.headerTitle.text = `CLAY HANDS · ${state.handsCount} HAND${state.handsCount === 1 ? '' : 'S'} IN VR`;
    this.headerSubtitle.text = state.gestureDesc;

    // Highlight active nav tab
    for (const [scr, btn] of this.navButtons.entries()) {
      btn.style.backgroundColor =
        scr === state.screen ? '#b84f33' : undefined;
    }

    // Toggle visible screen panel cleanly in both visibility & Yoga layout
    const activePanel = this.screenPanels[state.screen];
    const uniquePanels = new Set(Object.values(this.screenPanels));
    for (const panel of uniquePanels) {
      this.setShown(panel, panel === activePanel);
    }

    // Welcome counts
    this.welcomeGalleryBtn.label = `Pottery Gallery (${state.galleryItems.length})`;

    // Shared Brush section visible only when painting in Studio or Glaze
    const showBrush =
      (state.screen === 'studio' && state.brushActive && !state.showResetConfirm && !state.showCelebration) ||
      (state.screen === 'glaze' && state.glazePaintMode);
    this.setShown(this.brushSectionPanel, showBrush);

    if (showBrush) {
      for (const [cid, btn] of this.pigmentButtons.entries()) {
        btn.style.backgroundColor =
          !state.eraserMode && state.brushColorId === cid ? '#ffffff44' : undefined;
      }
      for (const [sz, btn] of this.brushSizeButtons.entries()) {
        btn.style.backgroundColor =
          state.brushSize === sz ? '#b84f33' : undefined;
      }
      this.brushEraserBtn.style.backgroundColor = state.eraserMode
        ? '#b84f33'
        : undefined;
      this.brushUndoBtn.disabled = !state.canUndoPaint;
      this.brushClearBtn.disabled = !state.hasPaint;
    }

    // Tutorial live state
    if (state.screen === 'tutorial') {
      INTERACTIVE_TUTORIAL_STEPS.forEach((step, idx) => {
        const btn = this.tutStepBtns[idx];
        if (!btn) return;
        const done = state.completedTutorialIds.has(step.id);
        const active = idx === state.tutorialStepIndex;
        btn.label = `${done ? '✓' : idx + 1}.${step.title.split(' ')[0]}`;
        btn.style.backgroundColor = active
          ? '#b84f33'
          : done
            ? '#4d6d43'
            : undefined;
      });
      this.tutTitleText.text = `Step ${state.tutorialStepIndex + 1}/5 · ${state.tutorialTitle}`;
      this.tutCueText.text = state.tutorialCue;
      this.tutStatusText.text = state.tutorialFinishedAll
        ? 'All 5 gestures mastered!'
        : state.completedTutorialIds.has(
              INTERACTIVE_TUTORIAL_STEPS[state.tutorialStepIndex]?.id ?? ''
            )
          ? 'Step complete!'
          : state.tutorialMatched
            ? 'Keep holding…'
            : 'Bring hands over clay and hold the gesture.';
      this.tutProgressFill.style.width = `${Math.round(state.tutorialProgress * 100)}%`;
      this.tutEnterBtn.label = state.tutorialFinishedAll
        ? 'Start Throwing'
        : 'Enter Studio';
    }

    // Studio live state
    if (state.screen === 'studio') {
      this.setShown(
        this.studioMainControls,
        !state.showResetConfirm && !state.showCelebration
      );
      this.setShown(this.studioResetConfirmPanel, state.showResetConfirm);
      this.setShown(
        this.studioCelebrationPanel,
        state.showCelebration && !state.showResetConfirm
      );

      for (const [st, btn] of this.studioStageBtns.entries()) {
        btn.style.backgroundColor = state.stage === st ? '#b84f33' : undefined;
      }

      if (Math.abs(this.lastStudioWheelSpeed - state.wheelSpeed) > 0.01) {
        this.lastStudioWheelSpeed = state.wheelSpeed;
        this.studioSpeedSlider.value = state.wheelSpeed;
        this.studioSpeedVal.text = `${state.wheelSpeed.toFixed(1)}x`;
      }

      if (state.mode === 'guided') {
        const lesson = GUIDED_LESSONS.find((l) => l.id === state.lessonId);
        const step =
          lesson?.steps.find((s) => s.stage === state.stage) ?? lesson?.steps[0];
        this.setShown(this.studioModeHintText, Boolean(step));
        if (step) {
          this.studioModeHintText.text = `${step.title}: ${step.instruction}`;
        }
      } else if (state.mode === 'challenge') {
        const preset = CHALLENGE_PRESETS.find((c) => c.id === state.challengeId);
        this.setShown(this.studioModeHintText, true);
        this.studioModeHintText.text = `Target: ${preset?.name ?? 'Challenge'} · ${state.similarity?.score ?? 0}% match`;
      } else {
        this.setShown(this.studioModeHintText, false);
      }

      this.studioBrushToggleBtn.label = state.brushActive
        ? 'Brush: ON'
        : 'Brush: Off';
      this.studioBrushToggleBtn.style.backgroundColor = state.brushActive
        ? '#b84f33'
        : undefined;
      this.studioUndoBtn.disabled = !state.canUndo;

      if (state.showCelebration && state.personality) {
        this.celebrationTitle.text = state.personality.name;
        const simLine =
          state.mode === 'challenge' && state.similarity
            ? ` · ${state.similarity.score}% match`
            : '';
        this.celebrationDetail.text = `${state.personality.notes} (${state.personality.measurements.heightCm} cm × ${state.personality.measurements.maxWidthCm} cm${simLine})`;
      }
    }

    // Glaze live state
    if (state.screen === 'glaze') {
      const glaze =
        GLAZE_CATALOG.find((g) => g.id === state.glazeId) ?? GLAZE_CATALOG[0];
      this.glazeVesselTitle.text = `${state.personality?.name ?? 'Studio Vessel'} · ${glaze.name} (${glaze.finishLabel})`;
      if (state.personality) {
        const m = state.personality.measurements;
        this.glazeVesselMeta.text = `H ${m.heightCm} cm · W ${m.maxWidthCm} cm · Rim ${m.openingWidthCm} cm`;
      }
      this.glazePaintBtn.style.backgroundColor = state.glazePaintMode
        ? '#b84f33'
        : undefined;
      this.glazeOrbitBtn.style.backgroundColor = !state.glazePaintMode
        ? '#b84f33'
        : undefined;
      this.glazeSpinBtn.label = state.glazeSpinEnabled
        ? 'Wheel: Spin'
        : 'Wheel: Still';
      this.glazeSpinBtn.style.backgroundColor = state.glazeSpinEnabled
        ? '#4d6d43'
        : undefined;
      for (const [gid, btn] of this.glazeSwatches.entries()) {
        btn.style.backgroundColor =
          gid === state.glazeId ? '#b84f33' : undefined;
      }
    }

    // Kiln live state
    if (state.screen === 'kiln') {
      this.kilnCaptionText.text = state.kilnCaption;
      this.kilnTempText.text = state.kilnTemp;
      this.kilnProgressFill.style.width = `${Math.round(state.kilnProgress * 100)}%`;
      this.setShown(this.kilnDonePanel, state.kilnFinished);
      if (state.kilnFinished) {
        const fallbackName = state.personality?.name ?? 'Studio Vessel';
        this.kilnNameBtn.label = `Name: ${this.customKilnName || fallbackName}`;
        this.kilnSaveBtn.disabled = state.saveStatus.saved;
        this.kilnSaveBtn.label = state.saveStatus.saved
          ? 'Saved'
          : 'Save to Gallery';
        this.setShown(this.kilnSaveStatusText, Boolean(state.saveStatus.message));
        this.kilnSaveStatusText.text = state.saveStatus.message;
      }
    }

    // Gallery live state
    if (state.screen === 'gallery') {
      const items = state.galleryItems;
      const totalPages = Math.max(1, Math.ceil(items.length / GALLERY_PAGE_SIZE));
      this.galleryPage = Math.min(this.galleryPage, totalPages - 1);
      const selected =
        items.find((i) => i.id === state.selectedGalleryId) ?? items[0] ?? null;
      this.currentSelectedGalleryId = selected?.id ?? null;

      if (selected) {
        const glaze = GLAZE_CATALOG.find((g) => g.id === selected.glazeId);
        this.galleryItemTitle.text = `${selected.name} (${items.length} saved)`;
        this.galleryItemMeta.text = `${glaze?.name ?? selected.glazeId} · ${selected.measurements.heightCm} cm × ${selected.measurements.maxWidthCm} cm`;
      } else {
        this.galleryItemTitle.text = 'Pottery Gallery (0)';
        this.galleryItemMeta.text =
          'No saved vessels yet. Throw and fire a vessel to see it here!';
      }

      const startIdx = this.galleryPage * GALLERY_PAGE_SIZE;
      for (let i = 0; i < GALLERY_PAGE_SIZE; i++) {
        const item = items[startIdx + i] ?? null;
        const btn = this.gallerySlotBtns[i];
        this.gallerySlotIds[i] = item?.id ?? null;
        this.setShown(btn, Boolean(item));
        if (item) {
          btn.label = item.name.slice(0, 14);
          btn.style.backgroundColor =
            selected?.id === item.id ? '#b84f33' : undefined;
        }
      }

      this.galleryPageLabel.text = `Page ${this.galleryPage + 1} / ${totalPages}`;
      this.galleryPrevPageBtn.disabled = this.galleryPage <= 0;
      this.galleryNextPageBtn.disabled = this.galleryPage >= totalPages - 1;

      const hasSelected = Boolean(selected);
      const smashMode = state.gallerySmashMode;
      const smashScope = state.gallerySmashScope;
      const crackedCount = state.galleryCrackedCount;
      const smashedCount = state.gallerySmashedCount;
      const totalVessels = Math.max(1, state.galleryTotalVessels || items.length);
      const isRestoring = state.galleryIsRestoring;
      const intactInView = Math.max(0, totalVessels - smashedCount);
      const hasDamage = smashedCount > 0 || crackedCount > 0;

      if (isRestoring) {
        this.galleryItemMeta.text =
          'Time Stone active — reversing cracks & shards back into pottery!';
      } else if (smashMode) {
        const focusLine = state.galleryFocusedName
          ? `Focus: ${state.galleryFocusedName} (${state.galleryFocusedHits}/2 hits)`
          : smashScope === 'single'
            ? `Selected: ${selected?.name ?? 'Pottery'}`
            : 'Aim Quest hand or controller at a pot';
        this.galleryItemMeta.text =
          smashedCount > 0
            ? `${focusLine} · ${crackedCount} cracked, ${smashedCount}/${totalVessels} broken · Restore or Exit (deletes broken)`
            : hasDamage
              ? `${focusLine} · ${crackedCount} cracked · Press Restore or hit again to break!`
              : smashScope === 'single'
                ? `${focusLine} · Selected pot only · Hit 1 cracks, Hit 2 shatters!`
                : `${focusLine} · All ${totalVessels} pots · Hit 1 cracks, Hit 2 shatters!`;
      }

      this.gallerySpinBtn.label = state.gallerySpinEnabled
        ? 'Spin: On'
        : 'Spin: Off';
      this.gallerySpinBtn.style.backgroundColor = state.gallerySpinEnabled
        ? '#4d6d43'
        : undefined;
      this.gallerySpinBtn.disabled = !hasSelected || smashMode;
      this.galleryRotLeftBtn.disabled = !hasSelected || smashMode;
      this.galleryRotRightBtn.disabled = !hasSelected || smashMode;
      this.galleryExportBtn.disabled = !hasSelected || smashMode;

      this.gallerySmashBtn.label = smashMode
        ? smashedCount > 0
          ? `Exit (Del ${smashedCount})`
          : 'Exit Bat'
        : 'Smash (Bat)';
      this.gallerySmashBtn.style.backgroundColor = smashMode
        ? '#c46d29'
        : undefined;
      this.gallerySmashBtn.disabled = !hasSelected || isRestoring;

      this.gallerySmashAllBtn.label = `Smash All (${items.length})`;
      this.gallerySmashAllBtn.disabled =
        !hasSelected ||
        isRestoring ||
        (smashMode && smashScope === 'all' && intactInView === 0);

      const showRestore = hasDamage || isRestoring;
      this.setShown(this.galleryRestoreBtn, showRestore);
      this.galleryRestoreBtn.label = isRestoring
        ? 'Reversing…'
        : 'Restore (Time)';
      this.galleryRestoreBtn.disabled = isRestoring;

      this.galleryDeleteBtn.disabled = !hasSelected || isRestoring;
    }

    // Settings live state
    if (state.screen === 'settings') {
      const s = state.settings;
      this.latestSoundEnabled = s.soundEnabled;
      this.latestReducedMotion = s.reducedMotion;
      this.latestHandedness = s.handedness;

      if (Math.abs(this.lastSetSens - s.handSensitivity) > 0.01) {
        this.lastSetSens = s.handSensitivity;
        this.setSensSlider.value = s.handSensitivity;
        this.setSensVal.text = s.handSensitivity.toFixed(1);
      }
      if (Math.abs(this.lastSetWheel - s.wheelSpeed) > 0.01) {
        this.lastSetWheel = s.wheelSpeed;
        this.setWheelSlider.value = s.wheelSpeed;
        this.setWheelVal.text = `${s.wheelSpeed.toFixed(1)}x`;
      }
      if (Math.abs(this.lastSetMusic - s.musicVolume) > 0.01) {
        this.lastSetMusic = s.musicVolume;
        this.setMusicSlider.value = s.musicVolume;
        this.setMusicVal.text = `${Math.round(s.musicVolume * 100)}%`;
      }
      if (Math.abs(this.lastSetSfx - s.sfxVolume) > 0.01) {
        this.lastSetSfx = s.sfxVolume;
        this.setSfxSlider.value = s.sfxVolume;
        this.setSfxVal.text = `${Math.round(s.sfxVolume * 100)}%`;
      }

      this.setSoundBtn.label = s.soundEnabled ? 'Sound: On' : 'Sound: Off';
      this.setMotionBtn.label = s.reducedMotion
        ? 'Motion: Reduced'
        : 'Motion: Full';
      this.setHandBtn.label =
        s.handedness === 'right' ? 'Hand: Right' : 'Hand: Left';
    }
  }
}
