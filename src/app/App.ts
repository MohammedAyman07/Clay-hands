import * as THREE from 'three';
import * as xb from 'xrblocks';
import { AudioManager } from '../audio/AudioManager.ts';
import { GalleryManager } from '../gallery/GalleryManager.ts';
import { PotteryExporter } from '../gallery/PotteryExporter.ts';
import { PotterySmashSystem } from '../gallery/PotterySmashSystem.ts';
import { GLAZE_CATALOG, GlazeManager } from '../kiln/GlazeManager.ts';
import { KilnController, type KilnStatus } from '../kiln/KilnController.ts';
import { ClaySculptingController } from '../pottery/ClaySculptingController.ts';
import { HandBrushTracker } from '../pottery/HandBrushMapper.ts';
import {
  VesselPainter,
  VILLAGE_PIGMENTS,
} from '../pottery/VesselPainter.ts';
import {
  CHALLENGE_PRESETS,
  GUIDED_LESSONS,
} from '../pottery/PotteryPresets.ts';
import { VesselThumbnailRenderer } from '../pottery/VesselThumbnailRenderer.ts';
import {
  computeSimilarityScore,
  generatePotteryPersonality,
} from '../pottery/PotteryProfile.ts';
import { PotteryWheel } from '../pottery/PotteryWheel.ts';
import {
  GestureRecognizer,
} from '../tracking/GestureRecognizer.ts';
import {
  HandCalibration,
  type CalibrationProgress,
} from '../tracking/HandCalibration.ts';
import { HandInputMapper } from '../tracking/HandInputMapper.ts';
import { HandTracker } from '../tracking/HandTracker.ts';
import type {
  AppScreen,
  BrushSizePreset,
  CalibrationData,
  GameMode,
  GestureState,
  GuidedLessonId,
  HandTrackingFrame,
  InputMode,
  PotteryPersonality,
  PotteryStage,
  SavedPotteryItem,
  SimilarityResult,
  StudioSettings,
} from '../types.ts';
import { HandCursorController } from '../ui/HandCursorController.ts';
import { TutorialManager } from '../ui/TutorialManager.ts';
import {
  UIManager,
  type MouseToolMode,
  type StudioHUDState,
} from '../ui/UIManager.ts';
import { VRStudioPanel } from '../xr/VRStudioPanel.ts';
import { XRManager } from '../xr/XRManager.ts';
import { SceneManager } from './SceneManager.ts';
import { StateManager } from './StateManager.ts';

const IDLE_GESTURE: GestureState = {
  gesture: 'idle',
  strength: 0,
  activeHeightNorm: 0.5,
  activeAngle: 0,
  targetRadiusNorm: 0.5,
  isPinching: false,
  handsCount: 0,
  inZone: false,
  description: 'Bring your hands into the shaping zone or drag the clay.',
};

export class ClayHandsApp extends xb.Script {
  private readonly isSoftwareGl: boolean;
  private readonly state = new StateManager();
  private readonly sceneManager = new SceneManager();
  private readonly audio = new AudioManager();
  private readonly handTracker = new HandTracker();
  private readonly calibration = new HandCalibration();
  private readonly gestureRecognizer = new GestureRecognizer();
  private readonly handMapper = new HandInputMapper();
  private readonly handBrushTracker = new HandBrushTracker();
  private readonly kiln = new KilnController();
  private readonly exporter = new PotteryExporter();
  private readonly xrManager = new XRManager();
  private readonly thumbnails = new VesselThumbnailRenderer();
  private readonly tutorial = new TutorialManager();
  private readonly handCursor = new HandCursorController();

  private wheel!: PotteryWheel;
  private sculpting!: ClaySculptingController;
  private painter!: VesselPainter;
  private paintedRawMaterial!: THREE.MeshPhysicalMaterial;
  private paintedGlazeMaterial!: THREE.MeshPhysicalMaterial;
  private glazeManager!: GlazeManager;
  private gallery!: GalleryManager;
  private smashSystem!: PotterySmashSystem;
  private ui!: UIManager;
  private vrPanel!: VRStudioPanel;

  // Mouse fallback & brush raycasting state
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNDC = new THREE.Vector2();
  private readonly _handAimNDC = new THREE.Vector2();
  private readonly _worldNormal = new THREE.Vector3();
  private readonly _normalMatrix = new THREE.Matrix3();
  private readonly _handRayOrigin = new THREE.Vector3();
  private readonly _handRayDir = new THREE.Vector3();
  private readonly _hoverPoint = new THREE.Vector3();
  private readonly _cameraNormal = new THREE.Vector3();
  private readonly _clayCenterWorld = new THREE.Vector3();
  private readonly _xrBatPos = new THREE.Vector3();
  private readonly _xrBatDir = new THREE.Vector3();
  private sculptingProxy!: THREE.Mesh;
  private mouseSculpting = false;
  private mousePainting = false;
  private mouseGallerySwinging = false;
  private handGalleryPinching = false;
  private vrBatTriggerHeld = false;
  private handGallerySwingCooldown = 0;
  private readonly onUnloadCommitSmash = () => {
    this.commitUnrestoredSmashedVessels();
  };
  private handBrushActive = false;
  private glazePaintMode = true;
  private glazeSpinEnabled = false;
  private gallerySpinEnabled = true;
  private handCursorActive = false;
  private handCursorUserDisabled = false;
  private showResetConfirm = false;
  private showCelebration = false;
  private mouseTool: MouseToolMode = 'auto';
  private mouseLastX = 0;
  private mouseLastY = 0;
  private mouseActiveHeightNorm = 0.5;
  private mouseActiveAngle = 0;
  private mouseSideSign = 1;
  private mouseGesture: GestureState = { ...IDLE_GESTURE };
  private mouseDragTimeout = 0;

  // Live session state
  private currentGesture: GestureState = { ...IDLE_GESTURE };
  private latestFrame: HandTrackingFrame = {
    timestamp: 0,
    hands: [],
    source: 'mouse',
  };
  private latestCalProgress?: CalibrationProgress;
  private currentPersonality: PotteryPersonality | null = null;
  private currentSimilarity: SimilarityResult | null = null;
  private kilnStatus: KilnStatus = {
    phase: 'idle',
    progress: 0,
    temperatureLabel: 'Ambient',
    caption: 'Ready to fire',
  };
  private kilnFinished = false;
  private kilnLastPhase = 'idle';
  private saveStatus = { saved: false, message: '' };
  private activeGlazeClone: THREE.Mesh | null = null;
  private tutorialMatched = false;
  private tutorialAdvanceTimer = 0;
  private postCalibrationScreen: AppScreen = 'studio';

  private readonly _wheelWorld = new THREE.Vector3();
  private readonly _wheelInverse = new THREE.Matrix4();

  constructor(isSoftwareGl: boolean) {
    super();
    this.isSoftwareGl = isSoftwareGl;
  }

  public async init(): Promise<void> {
    const renderer = xb.core.renderer as THREE.WebGLRenderer;
    const scene = xb.core.scene;
    const camera = xb.core.camera;

    this.sceneManager.init(renderer, scene, camera, this.isSoftwareGl);
    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    this.wheel = new PotteryWheel(maxAniso);
    this.sculpting = new ClaySculptingController(maxAniso);
    this.painter = new VesselPainter(maxAniso);
    this.glazeManager = new GlazeManager(maxAniso);
    this.gallery = new GalleryManager(this.glazeManager);
    this.smashSystem = new PotterySmashSystem({
      onBatSwing: (intensity) => this.audio.playBatSwing(intensity),
      onCeramicCrack: () => {
        this.audio.playCeramicCrack(0.9);
        this.rerenderUI();
      },
      onCeramicShatter: (count) => this.audio.playCeramicShatter(count),
      onTimeRestoreStart: () => {
        this.audio.playTimeStoneRestore();
        this.rerenderUI();
      },
      onTimeRestoreComplete: () => {
        this.rerenderUI();
      },
      onStateChanged: () => {
        this.rerenderUI();
      },
    });
    this.thumbnails.prewarmAll(renderer, this.glazeManager);

    this.paintedRawMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: this.painter.compositeTexture,
      roughness: 0.42,
      metalness: 0.02,
      clearcoat: 0.35,
      clearcoatRoughness: 0.28,
    });
    this.paintedGlazeMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: this.painter.compositeTexture,
      roughness: 0.16,
      metalness: 0.08,
      clearcoat: 0.9,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.15,
    });
    this.painter.setBaseTexture(this.sculpting.wetClayTexture);
    this.sculpting.clayMesh.material = this.paintedRawMaterial;

    // Mount clay & challenge silhouette & hand cursors onto wheel
    this.wheel.clayMount.add(this.sculpting.clayMesh);
    this.wheel.group.add(this.sculpting.silhouetteGroup);
    this.sculpting.silhouetteGroup.position.y = this.wheel.wheelSurfaceY;
    this.wheel.group.add(this.handMapper.group);
    this.handMapper.group.position.y = this.wheel.wheelSurfaceY;
    this.add(this.painter.cursorGroup);

    // Invisible sculpting proxy cylinder for ergonomic mouse raycasting
    this.sculptingProxy = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 0.36, 16),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.sculptingProxy.position.y = this.wheel.wheelSurfaceY + 0.17;
    this.wheel.group.add(this.sculptingProxy);

    // Place wheel at studio center (0, 0, 0) and kiln on the right alcove
    this.add(this.wheel.group);
    this.kiln.group.position.copy(this.sceneManager.kilnPosition);
    this.kiln.group.rotation.y = -0.52;
    this.add(this.kiln.group);

    // Mount gallery pedestal display & smash system
    this.sceneManager.galleryPedestalAnchor.add(this.gallery.displayGroup);
    this.gallery.displayGroup.add(this.smashSystem.group);

    // Apply initial settings
    this.applySettings(this.state.settings);

    // Setup Spatial VR Panel (visible inside Meta Quest immersive-vr sessions across all pages)
    this.vrPanel = new VRStudioPanel({
      onNavigate: (screen) => this.navigate(screen),
      onStartMode: (mode, lessonId, challengeId) =>
        void this.startSession(mode, 'mouse', lessonId, challengeId),
      onStageSelect: (stage) => {
        this.sculpting.setStage(stage);
        this.showCelebration = false;
        this.ui.showCelebration(false);
        this.rerenderUI();
      },
      onWheelSpeedChange: (speed) => this.updateSettings({ wheelSpeed: speed }),
      onToggleBrush: () => {
        this.mouseTool = this.mouseTool === 'brush' ? 'auto' : 'brush';
        if (this.mouseTool !== 'brush') {
          this.stopHandBrushSession();
        }
        this.handMapper.group.visible =
          (this.state.screen === 'studio' || this.state.screen === 'tutorial') &&
          this.mouseTool !== 'brush';
        this.rerenderUI();
      },
      onSelectBrushColor: (colorId) => {
        this.painter.setColor(colorId);
        this.rerenderUI();
      },
      onSelectBrushSize: (size: BrushSizePreset) => {
        this.painter.setSize(size);
        this.rerenderUI();
      },
      onToggleEraser: () => {
        this.painter.setEraser(!this.painter.eraserMode);
        this.rerenderUI();
      },
      onUndoPaint: () => {
        if (this.painter.undo()) {
          this.audio.playBrushSwish(0.5);
          this.rerenderUI();
        }
      },
      onClearPaint: () => {
        this.painter.clear(true);
        this.rerenderUI();
      },
      onToggleGlazePaintMode: (paintMode: boolean) => {
        this.glazePaintMode = paintMode;
        if (!paintMode) {
          this.stopHandBrushSession();
        }
        this.rerenderUI();
      },
      onToggleGlazeSpin: () => {
        this.glazeSpinEnabled = !this.glazeSpinEnabled;
        this.rerenderUI();
      },
      onSelectGlaze: (glazeId) => this.selectGlaze(glazeId),
      onFireKiln: () => {
        if (this.state.screen !== 'kiln') {
          if (this.sculpting.stage !== 'finished') {
            this.sculpting.finishPot();
            this.currentPersonality = generatePotteryPersonality(
              this.sculpting.profile
            );
          }
          this.startKilnSequence();
        }
      },
      onFinishPot: () => this.handleFinishPot(),
      onContinueShaping: () => {
        this.showCelebration = false;
        this.ui.showCelebration(false);
        this.sculpting.setStage('shape');
        this.rerenderUI();
      },
      onSaveToGallery: (name) => this.saveCurrentToGallery(name),
      onSelectGalleryItem: (id) => this.selectGalleryItem(id),
      onDeleteGalleryItem: (id) => this.deleteGalleryItem(id),
      onToggleGallerySmash: () => this.toggleGallerySmash(),
      onSmashAllGallery: () => this.smashAllGallery(),
      onRestoreGallery: () => this.restoreGallery(),
      onExportGLB: (id) => void this.exportCreationGLB(id),
      onRotateGalleryVessel: (deltaRad) => {
        this.gallerySpinEnabled = false;
        const galMesh = this.gallery.getActiveMesh();
        if (galMesh) {
          galMesh.rotation.y += deltaRad;
        }
      },
      onToggleGallerySpin: () => {
        this.gallerySpinEnabled = !this.gallerySpinEnabled;
      },
      onTutorialSelectStep: (index) => {
        this.tutorial.goTo(index);
        this.tutorialAdvanceTimer = 0;
        this.applyTutorialStepState();
        this.rerenderUI();
      },
      onTutorialPrev: () => {
        this.tutorial.prev();
        this.tutorialAdvanceTimer = 0;
        this.applyTutorialStepState();
        this.rerenderUI();
      },
      onTutorialNext: () => {
        this.tutorial.next();
        this.tutorialAdvanceTimer = 0;
        this.applyTutorialStepState();
        this.rerenderUI();
      },
      onTutorialResetPractice: () => {
        this.tutorial.start();
        this.tutorialAdvanceTimer = 0;
        this.performReset();
        this.applyTutorialStepState();
        this.rerenderUI();
      },
      onUpdateSettings: (partial) => this.updateSettings(partial),
      onUndo: () => {
        if (this.mouseTool === 'brush' && this.painter.undo()) {
          this.audio.playBrushSwish(0.5);
          this.rerenderUI();
          return;
        }
        if (this.sculpting.undo()) {
          this.audio.playCompressionPulse();
          this.refreshSimilarity();
          this.rerenderUI();
        }
      },
      onRequestReset: () => {
        if (this.sculpting.isSubstantiallyModified || this.painter.hasPaint) {
          this.showResetConfirm = true;
          this.ui.showResetConfirmation(true);
          this.rerenderUI();
        } else {
          this.performReset();
        }
      },
      onConfirmReset: () => this.performReset(),
      onCancelReset: () => {
        this.showResetConfirm = false;
        this.ui.showResetConfirmation(false);
        this.rerenderUI();
      },
      onRecenterStation: () => {
        if (this.xrManager.inXRSession) {
          this.xrManager.alignStationForScreen(
            this.state.screen,
            xb.core.camera,
            this.wheel.group,
            this.kiln.group,
            this.sceneManager.galleryGroup,
            this.vrPanel
          );
        }
      },
      onExitVR: () => void this.xrManager.toggleVRSession(),
    });
    this.add(this.vrPanel);

    // Setup UI root
    const uiRoot = document.getElementById('ui-root') ?? document.body;
    this.ui = new UIManager(
      uiRoot,
      {
        onNavigate: (screen) => this.navigate(screen),
        onCloseModal: () => this.navigate(this.state.modalReturnScreen),
        onSelectModeSelection: (mode, lessonId, challengeId) => {
          this.state.mode = mode;
          this.state.lessonId = lessonId;
          this.state.challengePresetId = challengeId;
        },
        onStartMode: (mode, inputMode, lessonId, challengeId) =>
          void this.startSession(mode, inputMode, lessonId, challengeId),
        onRequestWebcam: () => this.requestWebcamAndCalibrate(),
        onUseMouseMode: () => this.switchToMouseMode(),
        onRecalibrate: () => this.startCalibration(),
        onSkipCalibration: () => this.finishCalibrationToStudio(),
        onWheelSpeedChange: (speed) => this.updateSettings({ wheelSpeed: speed }),
        onUndo: () => {
          if (this.mouseTool === 'brush' && this.painter.undo()) {
            this.audio.playBrushSwish(0.5);
            this.rerenderUI();
            return;
          }
          if (this.sculpting.undo()) {
            this.audio.playCompressionPulse();
            this.refreshSimilarity();
            this.rerenderUI();
          }
        },
        onRequestReset: () => {
          if (this.sculpting.isSubstantiallyModified || this.painter.hasPaint) {
            this.showResetConfirm = true;
            this.ui.showResetConfirmation(true);
            this.rerenderUI();
          } else {
            this.performReset();
          }
        },
        onConfirmReset: () => this.performReset(),
        onCancelReset: () => {
          this.showResetConfirm = false;
          this.ui.showResetConfirmation(false);
          this.rerenderUI();
        },
        onFinishPot: () => this.handleFinishPot(),
        onSelectGlaze: (glazeId) => this.selectGlaze(glazeId),
        onStartKiln: () => this.startKilnSequence(),
        onSaveToGallery: (name) => this.saveCurrentToGallery(name),
        onSelectGalleryItem: (id) => this.selectGalleryItem(id),
        onRenameGalleryItem: (id, name) => this.renameGalleryItem(id, name),
        onDeleteGalleryItem: (id) => this.deleteGalleryItem(id),
        onToggleGallerySmash: () => this.toggleGallerySmash(),
        onSmashAllGallery: () => this.smashAllGallery(),
        onRestoreGallery: () => this.restoreGallery(),
        onExportGLB: (id) => void this.exportCreationGLB(id),
        onUpdateSettings: (partial) => this.updateSettings(partial),
        onMouseToolChange: (tool) => {
          this.mouseTool = tool;
          if (tool !== 'brush') {
            this.stopHandBrushSession();
          }
          this.handMapper.group.visible =
            (this.state.screen === 'studio' || this.state.screen === 'tutorial') &&
            tool !== 'brush';
          this.rerenderUI();
        },
        onSelectBrushColor: (colorId) => {
          this.painter.setColor(colorId);
          this.rerenderUI();
        },
        onSelectBrushSize: (size: BrushSizePreset) => {
          this.painter.setSize(size);
          this.rerenderUI();
        },
        onToggleEraser: () => {
          this.painter.setEraser(!this.painter.eraserMode);
          this.rerenderUI();
        },
        onUndoPaint: () => {
          if (this.painter.undo()) {
            this.audio.playBrushSwish(0.5);
            this.rerenderUI();
          }
        },
        onClearPaint: () => {
          this.painter.clear(true);
          this.rerenderUI();
        },
        onToggleGlazePaintMode: (paintMode: boolean) => {
          this.glazePaintMode = paintMode;
          if (!paintMode) {
            this.stopHandBrushSession();
          }
          this.sceneManager.setOrbitEnabled(true);
          this.rerenderUI();
        },
        onToggleGlazeSpin: () => {
          this.glazeSpinEnabled = !this.glazeSpinEnabled;
          this.rerenderUI();
        },
        onStageJump: (stage) => {
          this.sculpting.setStage(stage);
          this.showCelebration = false;
          this.ui.showCelebration(false);
          this.rerenderUI();
        },
        onToggleVR: () => void this.xrManager.toggleVRSession(),
        onToggleHandCursor: () => void this.toggleHandCursor(),
        onCelebrateCreateAnother: () => {
          this.performReset();
          this.navigate('studio');
        },
        onTutorialSelectStep: (index) => {
          this.tutorial.goTo(index);
          this.tutorialAdvanceTimer = 0;
          this.applyTutorialStepState();
          this.rerenderUI();
        },
        onTutorialPrev: () => {
          this.tutorial.prev();
          this.tutorialAdvanceTimer = 0;
          this.applyTutorialStepState();
          this.rerenderUI();
        },
        onTutorialNext: () => {
          this.tutorial.next();
          this.tutorialAdvanceTimer = 0;
          this.applyTutorialStepState();
          this.rerenderUI();
        },
        onTutorialResetPractice: () => {
          this.tutorial.start();
          this.tutorialAdvanceTimer = 0;
          this.performReset();
          this.applyTutorialStepState();
          this.rerenderUI();
        },
        onEnableWebcamFromTutorial: async () => {
          this.audio.unlock();
          this.state.inputMode = 'webcam';
          if (this.handTracker.isReady) {
            if (!this.calibration.data.calibrated) {
              this.postCalibrationScreen = 'tutorial';
              this.startCalibration();
              return;
            }
            this.rerenderUI();
            return;
          }
          this.postCalibrationScreen = 'tutorial';
          const res = await this.handTracker.startWebcamAndModel();
          if (res.ok) {
            if (!this.shouldHideHandCursor() && !this.handCursorUserDisabled) {
              this.handCursorActive = true;
              this.handCursor.setEnabled(true);
            }
            this.startCalibration();
          } else {
            this.navigate('webcam-permission');
          }
        },
      },
      this.tutorial,
      (key) => this.thumbnails.getThumbnail(key)
    );

    this.bindPointerAndKeyboard(renderer.domElement);
    window.addEventListener('pagehide', this.onUnloadCommitSmash);
    window.addEventListener('beforeunload', this.onUnloadCommitSmash);

    await this.xrManager.probeSupport();
    this.navigate('welcome');
    void this.tryAutoStartHandCursor();
  }

  private shouldHideHandCursor(): boolean {
    return this.xrManager.isMetaQuest();
  }

  private async tryAutoStartHandCursor(): Promise<void> {
    await Promise.resolve();
    if (this.shouldHideHandCursor() || this.handCursorUserDisabled) return;
    const res = await this.handTracker.startWebcamAndModel();
    if (
      res.ok &&
      !this.shouldHideHandCursor() &&
      !this.handCursorUserDisabled
    ) {
      this.handCursorActive = true;
      this.handCursor.setEnabled(true);
      this.rerenderUI();
    }
  }

  private bindPointerAndKeyboard(canvas: HTMLCanvasElement): void {
    const unlockAudio = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlockAudio, { once: true });

    const raycastVessel = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      this.pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      this.pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointerNDC, xb.core.camera);
      const hits = this.raycaster.intersectObject(this.sculpting.clayMesh, false);
      if (hits.length === 0) return null;
      const hit = hits[0];
      if (hit.face) {
        this._normalMatrix.getNormalMatrix(this.sculpting.clayMesh.matrixWorld);
        this._worldNormal
          .copy(hit.face.normal)
          .applyMatrix3(this._normalMatrix)
          .normalize();
      } else {
        this._worldNormal.set(0, 0, 1);
      }
      return hit;
    };

    const isBrushContext = () =>
      ((this.state.screen === 'studio' || this.state.screen === 'tutorial') &&
        this.mouseTool === 'brush' &&
        this.sculpting.stage !== 'finished') ||
      (this.state.screen === 'glaze' && this.glazePaintMode);

    canvas.addEventListener('pointerdown', (e) => {
      this.audio.unlock();

      // Bat smash swing in Gallery when Smash Mode is active
      if (
        this.state.screen === 'gallery' &&
        this.smashSystem.isSmashMode() &&
        !this.smashSystem.isRestoring() &&
        e.button === 0
      ) {
        const rect = canvas.getBoundingClientRect();
        this.pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        this.mouseGallerySwinging = true;
        this.mouseLastX = e.clientX;
        this.sceneManager.setOrbitEnabled(false);
        this.smashSystem.aimBatFromNDC(
          this.pointerNDC.x,
          this.pointerNDC.y,
          xb.core.camera
        );
        this.smashSystem.triggerBatSwing(-1, true);
        return;
      }

      // Brush painting in Studio/Tutorial (Brush tool) or Glaze & Paint screen
      if (isBrushContext() && e.button === 0) {
        const hit = raycastVessel(e.clientX, e.clientY);
        if (hit && hit.uv) {
          this.mousePainting = true;
          this.painter.setPinchPreview(true);
          this.sceneManager.setOrbitEnabled(false);
          this.painter.updateCursorPose(hit.point, this._worldNormal);
          this.painter.beginStroke({ u: hit.uv.x, v: hit.uv.y });
          this.audio.playBrushSwish(0.75);
          return;
        }
        // In Glaze screen, dragging outside the pot orbits smoothly
        if (this.state.screen === 'glaze') {
          this.sceneManager.setOrbitEnabled(true);
          return;
        }
      }

      if (this.state.screen !== 'studio' && this.state.screen !== 'tutorial') return;
      if (this.sculpting.stage === 'finished' || this.mouseTool === 'brush') return;

      const rect = canvas.getBoundingClientRect();
      this.pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.pointerNDC, xb.core.camera);
      const hits = this.raycaster.intersectObject(this.sculptingProxy, false);
      if (hits.length === 0) return;

      this.mouseSculpting = true;
      this.mouseLastX = e.clientX;
      this.mouseLastY = e.clientY;
      this.updateMouseHitMetrics(hits[0].point);
      this.sceneManager.setOrbitEnabled(false);
    });

    window.addEventListener('pointermove', (e) => {
      if (this.state.screen === 'gallery' && this.smashSystem.isSmashMode()) {
        const rect = canvas.getBoundingClientRect();
        this.pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        this.smashSystem.aimBatFromNDC(
          this.pointerNDC.x,
          this.pointerNDC.y,
          xb.core.camera
        );
        if (this.mouseGallerySwinging) {
          const dx = e.clientX - this.mouseLastX;
          this.mouseLastX = e.clientX;
          if (Math.abs(dx) > 10) {
            this.smashSystem.triggerBatSwing(dx, true);
          }
        }
        return;
      }

      if (isBrushContext()) {
        const hit = raycastVessel(e.clientX, e.clientY);
        if (hit && hit.uv) {
          this.painter.updateCursorPose(hit.point, this._worldNormal);
          if (this.mousePainting) {
            this.painter.continueStroke({ u: hit.uv.x, v: hit.uv.y });
            this.audio.playBrushSwish(0.65);
          }
        } else {
          this.painter.updateCursorPose(null, null);
        }
        if (this.mousePainting) return;
      } else {
        this.painter.updateCursorPose(null, null);
      }

      if (
        !this.mouseSculpting ||
        (this.state.screen !== 'studio' && this.state.screen !== 'tutorial')
      ) {
        return;
      }

      const dx = e.clientX - this.mouseLastX;
      const dy = e.clientY - this.mouseLastY;
      this.mouseLastX = e.clientX;
      this.mouseLastY = e.clientY;

      // Also update height under pointer if available
      const rect = canvas.getBoundingClientRect();
      this.pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointerNDC, xb.core.camera);
      const hits = this.raycaster.intersectObject(this.sculptingProxy, false);
      if (hits.length > 0) {
        this.updateMouseHitMetrics(hits[0].point);
      }

      const sens = this.state.settings.handSensitivity;
      const speed = Math.hypot(dx, dy);
      this.mouseDragTimeout = performance.now();

      let gesture: GestureState['gesture'] = 'smooth';
      let strength = Math.min(1, Math.max(0.25, speed * 0.045 * sens));
      let desc = 'Smoothing clay surface with pointer.';
      let targetRadiusNorm = 0.5;

      if (e.shiftKey || this.mouseTool === 'pinch') {
        gesture = 'pinch_neck';
        strength = 0.72 * sens;
        desc = 'Pinching neck inward.';
      } else if (
        this.mouseTool === 'open' ||
        (this.state.screen === 'tutorial' &&
          this.tutorial.getCurrentStep().targetAction === 'open' &&
          speed >= 0.4)
      ) {
        gesture = 'open';
        strength = 0.8 * sens;
        desc = 'Opening hollow interior.';
      } else if (e.altKey || this.mouseTool === 'smooth') {
        gesture = 'smooth';
        strength = 0.75 * sens;
        desc = 'Smoothing ridges along the vessel.';
      } else if (e.ctrlKey || this.mouseTool === 'one_side') {
        gesture = 'one_side';
        targetRadiusNorm = dx * this.mouseSideSign < 0 ? 0.2 : 0.8;
        strength = 0.65 * sens;
        desc = 'Contouring one side of the vessel.';
      } else if (dy < -1.8 && Math.abs(dy) > Math.abs(dx) * 0.9) {
        gesture = 'raise';
        strength = Math.min(1, (-dy * 0.065) * sens);
        desc = 'Raising walls upward.';
      } else if (Math.abs(dx) >= 0.8) {
        // Dragging toward center compresses, away from center widens
        const inward = dx * this.mouseSideSign < 0;
        gesture = inward ? 'compress' : 'widen';
        strength = Math.min(1, (Math.abs(dx) * 0.065) * sens);
        desc = inward ? 'Compressing clay inward.' : 'Widening vessel outward.';
      } else if (this.sculpting.stage === 'open' && dy > 1.5) {
        gesture = 'open';
        strength = 0.75 * sens;
        desc = 'Opening hollow interior.';
      }

      this.mouseGesture = {
        gesture,
        strength,
        activeHeightNorm: this.mouseActiveHeightNorm,
        activeAngle: this.mouseActiveAngle,
        targetRadiusNorm,
        isPinching: gesture === 'pinch_neck',
        handsCount: 0,
        inZone: true,
        description: desc,
      };
    });

    const endDrag = () => {
      if (this.mouseGallerySwinging) {
        this.mouseGallerySwinging = false;
        if (this.state.screen === 'gallery') {
          this.sceneManager.setOrbitEnabled(true);
        }
      }
      if (this.mousePainting) {
        this.mousePainting = false;
        this.painter.setPinchPreview(false);
        this.painter.endStroke();
        if (this.state.screen === 'glaze') {
          this.sceneManager.setOrbitEnabled(true);
        }
        this.rerenderUI();
      }
      if (!this.mouseSculpting) return;
      this.mouseSculpting = false;
      this.mouseGesture = { ...IDLE_GESTURE };
      this.handMapper.showMouseBrushIndicator(false, 0.5, 0.15, 0.08);
    };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('blur', endDrag);

    window.addEventListener('keydown', (e) => {
      if (this.state.screen !== 'studio') return;
      if (
        document.activeElement &&
        ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)
      ) {
        return;
      }
      if (e.key.toLowerCase() === 'z') {
        if (this.mouseTool === 'brush' && this.painter.undo()) {
          this.audio.playBrushSwish(0.5);
          this.rerenderUI();
          return;
        }
        if (this.sculpting.undo()) {
          this.refreshSimilarity();
          this.rerenderUI();
        }
      } else if (e.key.toLowerCase() === 'b') {
        this.mouseTool = this.mouseTool === 'brush' ? 'auto' : 'brush';
        if (this.mouseTool !== 'brush') {
          this.stopHandBrushSession();
        }
        this.handMapper.group.visible = this.mouseTool !== 'brush';
        this.rerenderUI();
      } else if (e.key.toLowerCase() === 'm') {
        this.updateSettings({ soundEnabled: !this.state.settings.soundEnabled });
        this.rerenderUI();
      } else if (e.key === '1') {
        this.sculpting.setStage('center');
        this.rerenderUI();
      } else if (e.key === '2') {
        this.sculpting.setStage('open');
        this.rerenderUI();
      } else if (e.key === '3') {
        this.sculpting.setStage('shape');
        this.rerenderUI();
      } else if (e.key === '4') {
        this.sculpting.setStage('smooth');
        this.rerenderUI();
      }
    });
  }

  private stopHandBrushSession(): void {
    if (this.handBrushActive) {
      this.handBrushActive = false;
      this.painter.endStroke();
    }
    this.handBrushTracker.reset();
    this.painter.setPinchPreview(false);
    this.painter.updateCursorPose(null, null);
  }

  private runHandBrushPainting(
    activeCal: CalibrationData,
    usingWebXR: boolean
  ): void {
    const evalRes = this.handBrushTracker.evaluate(
      this.latestFrame.hands,
      activeCal,
      this.state.settings.handedness,
      this.state.settings.handSensitivity
    );

    this.currentGesture = {
      ...IDLE_GESTURE,
      handsCount: this.latestFrame.hands.length,
      inZone: evalRes.inZone,
      isPinching: evalRes.isPinching,
      description: evalRes.description,
    };
    this.painter.setPinchPreview(evalRes.isPinching);

    if (!evalRes.hand) {
      if (this.handBrushActive) {
        this.handBrushActive = false;
        this.painter.endStroke();
      }
      this.painter.updateCursorPose(null, null);
      return;
    }

    if (usingWebXR) {
      // First check if either Meta Quest hand/controller ray is directly pointing at the clay mesh
      let rayHit: THREE.Intersection | null = null;
      let raySelecting = false;
      const controllers = xb.core?.input?.controllers ?? [];
      for (let i = 0; i < controllers.length; i++) {
        const inter = xb.core?.user?.getIntersectionAt(this.sculpting.clayMesh, i);
        if (inter && inter.uv) {
          if (!rayHit || Boolean(controllers[i]?.userData?.selected)) {
            rayHit = inter;
            raySelecting = Boolean(controllers[i]?.userData?.selected);
            if (raySelecting) break;
          }
        }
      }

      if (rayHit && rayHit.uv) {
        if (rayHit.face) {
          this._normalMatrix.getNormalMatrix(this.sculpting.clayMesh.matrixWorld);
          this._worldNormal
            .copy(rayHit.face.normal)
            .applyMatrix3(this._normalMatrix)
            .normalize();
        } else {
          this._worldNormal.set(0, 0, 1);
        }
        const shouldPaint = raySelecting || evalRes.isPinching;
        this.painter.setPinchPreview(shouldPaint);
        this.painter.updateCursorPose(rayHit.point, this._worldNormal);

        if (shouldPaint) {
          if (!this.handBrushActive) {
            this.handBrushActive = true;
            this.painter.beginStroke({ u: rayHit.uv.x, v: rayHit.uv.y });
          } else {
            this.painter.continueStroke({ u: rayHit.uv.x, v: rayHit.uv.y });
          }
          this.audio.playBrushSwish(0.62);
        } else if (this.handBrushActive) {
          this.handBrushActive = false;
          this.painter.endStroke();
        }
        return;
      }

      // Fallback: close-range fingertip proximity raycast toward clay axis
      this.wheel.clayMount.getWorldPosition(this._wheelWorld);
      const tipX =
        evalRes.hand.indexTip.x * 0.68 + evalRes.hand.thumbTip.x * 0.32;
      const tipY =
        evalRes.hand.indexTip.y * 0.68 + evalRes.hand.thumbTip.y * 0.32;
      const tipZ =
        evalRes.hand.indexTip.z * 0.68 + evalRes.hand.thumbTip.z * 0.32;
      this._handRayOrigin.set(
        this._wheelWorld.x + tipX,
        this._wheelWorld.y + tipY,
        this._wheelWorld.z + tipZ
      );
      this._handRayDir
        .set(this._wheelWorld.x - this._handRayOrigin.x, 0, this._wheelWorld.z - this._handRayOrigin.z)
        .normalize();
      if (this._handRayDir.lengthSq() < 0.001) {
        this._handRayDir.set(0, 0, -1);
      }
      // Step slightly outward so fingertips touching the wall still intersect from outside
      this._handRayOrigin.addScaledVector(this._handRayDir, -0.18);
      this.raycaster.set(this._handRayOrigin, this._handRayDir);
    } else {
      this._handAimNDC.set(evalRes.aimNDC.x, evalRes.aimNDC.y);
      this.raycaster.setFromCamera(this._handAimNDC, xb.core.camera);
    }

    const hits = this.raycaster.intersectObject(this.sculpting.clayMesh, false);
    const hit = hits[0];
    const uv = hit?.uv;
    if (hit && uv) {
      if (hit.face) {
        this._normalMatrix.getNormalMatrix(this.sculpting.clayMesh.matrixWorld);
        this._worldNormal
          .copy(hit.face.normal)
          .applyMatrix3(this._normalMatrix)
          .normalize();
      } else {
        this._worldNormal.set(0, 0, 1);
      }
      this.painter.updateCursorPose(hit.point, this._worldNormal);

      if (evalRes.isPinching) {
        if (!this.handBrushActive) {
          this.handBrushActive = true;
          this.painter.beginStroke({ u: uv.x, v: uv.y });
        } else {
          this.painter.continueStroke({ u: uv.x, v: uv.y });
        }
        this.audio.playBrushSwish(0.62);
      } else if (this.handBrushActive) {
        this.handBrushActive = false;
        this.painter.endStroke();
      }
      return;
    }

    if (this.handBrushActive) {
      this.handBrushActive = false;
      this.painter.endStroke();
    }

    // Show floating 3D brush hover reticle when aiming near the pot
    if (!usingWebXR) {
      this.wheel.clayMount.getWorldPosition(this._clayCenterWorld);
      this._clayCenterWorld.y += this.sculpting.currentHeight * 0.5;
      const dist = xb.core.camera.position.distanceTo(this._clayCenterWorld);
      this._hoverPoint
        .copy(this.raycaster.ray.origin)
        .addScaledVector(this.raycaster.ray.direction, Math.max(0.3, dist - 0.08));
      this._cameraNormal
        .copy(xb.core.camera.position)
        .sub(this._hoverPoint)
        .normalize();
      this.painter.updateCursorPose(this._hoverPoint, this._cameraNormal);
    } else {
      this.painter.updateCursorPose(null, null);
    }
  }

  private updateMouseHitMetrics(point: THREE.Vector3): void {
    const localY = point.y - this.wheel.wheelSurfaceY;
    const h = Math.max(0.06, this.sculpting.currentHeight);
    this.mouseActiveHeightNorm = THREE.MathUtils.clamp(localY / h, 0.04, 0.98);
    this.mouseSideSign = point.x >= 0 ? 1 : -1;
    this.mouseActiveAngle = Math.atan2(point.z, point.x);
  }

  private applyTutorialStepState(): void {
    const step = this.tutorial.getCurrentStep();
    this.sculpting.setStage(step.recommendedStage);
    if (step.targetAction === 'brush') {
      this.mouseTool = 'brush';
      this.handMapper.group.visible = false;
    } else {
      this.mouseTool = 'auto';
      this.stopHandBrushSession();
      this.handMapper.group.visible = true;
    }
  }

  private navigate(screen: AppScreen): void {
    const prevScreen = this.state.screen;
    this.state.navigate(screen);
    this.stopHandBrushSession();
    if (screen !== 'gallery' && this.smashSystem.isSmashMode()) {
      this.commitUnrestoredSmashedVessels();
      this.smashSystem.exitSmashMode();
      this.mouseGallerySwinging = false;
      this.sceneManager.setOrbitEnabled(true);
      this.sceneManager.setGalleryFraming(this.gallery.getItems().length, false);
    }

    const musicMood =
      screen === 'glaze'
        ? 'glaze'
        : screen === 'kiln'
          ? 'kiln'
          : screen === 'gallery'
            ? 'gallery'
            : screen === 'studio' || screen === 'tutorial'
              ? 'studio'
              : 'welcome';
    this.audio.setMusicMood(musicMood);

    if (prevScreen === 'tutorial' && screen === 'studio') {
      this.mouseTool = 'auto';
      this.sculpting.reset();
      this.painter.clear(false);
    }

    // Ensure clay returns to wheel if leaving glaze/kiln prematurely
    if (
      screen === 'studio' ||
      screen === 'tutorial' ||
      screen === 'welcome' ||
      screen === 'start-studio'
    ) {
      if (this.sculpting.clayMesh.parent !== this.wheel.clayMount) {
        this.wheel.clayMount.add(this.sculpting.clayMesh);
        this.sculpting.clayMesh.position.set(0, 0, 0);
        this.sculpting.clayMesh.rotation.set(0, 0, 0);
      }
      if (this.sculpting.stage !== 'finished') {
        this.painter.setBaseTexture(this.sculpting.wetClayTexture);
        this.sculpting.clayMesh.material = this.paintedRawMaterial;
      }
      this.handMapper.group.visible =
        (screen === 'studio' || screen === 'tutorial') &&
        this.mouseTool !== 'brush';
    } else {
      this.handMapper.group.visible = false;
    }

    if (screen === 'tutorial') {
      this.sculpting.reset();
      this.painter.clear(false);
      this.painter.setBaseTexture(this.sculpting.wetClayTexture);
      this.sculpting.clayMesh.material = this.paintedRawMaterial;
      this.tutorial.start();
      this.tutorialMatched = false;
      this.tutorialAdvanceTimer = 0;
      this.applyTutorialStepState();
    }

    // Configure camera & OrbitControls per screen
    if (screen === 'welcome' || screen === 'start-studio' || screen === 'webcam-permission' || screen === 'hand-calibration') {
      this.sceneManager.setCameraPreset('welcome', false);
    } else if (screen === 'studio' || screen === 'tutorial' || screen === 'settings') {
      this.sceneManager.setCameraPreset('studio', false);
    } else if (screen === 'glaze') {
      if (this.sculpting.clayMesh.parent !== this.wheel.clayMount) {
        this.wheel.clayMount.add(this.sculpting.clayMesh);
        this.sculpting.clayMesh.position.set(0, 0, 0);
        this.sculpting.clayMesh.rotation.set(0, 0, 0);
      }
      this.glazePaintMode = true;
      this.glazeSpinEnabled = false;
      this.sceneManager.setCameraPreset('glaze', true);
      this.applyPreviewGlaze();
    } else if (screen === 'kiln') {
      this.sceneManager.setCameraPreset('kiln', false);
    } else if (screen === 'gallery') {
      this.sceneManager.setCameraPreset('gallery', true);
      const items = this.gallery.getItems();
      const targetId = this.state.selectedGalleryItemId ?? items[0]?.id ?? null;
      this.state.selectedGalleryItemId = targetId;
      const item = items.find((i) => i.id === targetId) ?? null;
      if (!this.smashSystem.isSmashMode()) {
        this.gallery.showItemOnPedestal(item);
      }
    }

    if (this.xrManager.inXRSession) {
      if (screen !== 'kiln') {
        this.kiln.group.position.copy(this.sceneManager.kilnPosition);
        this.kiln.group.rotation.y = -0.52;
      }
      if (screen !== 'gallery') {
        this.sceneManager.galleryGroup.position.copy(
          this.sceneManager.galleryPosition
        );
        this.sceneManager.galleryGroup.rotation.y = 0;
      }
      this.xrManager.alignStationForScreen(
        screen,
        xb.core.camera,
        this.wheel.group,
        this.kiln.group,
        this.sceneManager.galleryGroup,
        this.vrPanel
      );
    }

    this.rerenderUI();
  }

  private async toggleHandCursor(): Promise<void> {
    this.audio.unlock();
    if (this.shouldHideHandCursor()) {
      this.handCursorActive = false;
      this.handCursor.setEnabled(false);
      this.rerenderUI();
      return;
    }
    if (this.handCursorActive) {
      this.handCursorUserDisabled = true;
      this.handCursorActive = false;
      this.handCursor.setEnabled(false);
      if (this.state.inputMode !== 'webcam' && !this.xrManager.inXRSession) {
        this.handTracker.stop();
      }
      this.rerenderUI();
      return;
    }

    this.handCursorUserDisabled = false;
    if (!this.handTracker.isReady) {
      const res = await this.handTracker.startWebcamAndModel();
      if (!res.ok) {
        this.postCalibrationScreen =
          this.state.screen === 'webcam-permission'
            ? 'welcome'
            : this.state.screen;
        this.navigate('webcam-permission');
        return;
      }
    }

    this.handCursorActive = true;
    this.handCursor.setEnabled(true);
    this.rerenderUI();
  }

  private async startSession(
    mode: GameMode,
    inputMode: InputMode,
    lessonId?: GuidedLessonId,
    challengeId?: string
  ): Promise<void> {
    this.audio.unlock();
    this.state.mode = mode;
    if (lessonId) this.state.lessonId = lessonId;
    if (challengeId) this.state.challengePresetId = challengeId;

    this.sculpting.reset();
    this.painter.clear(false);
    this.painter.setBaseTexture(this.sculpting.wetClayTexture);
    this.sculpting.clayMesh.material = this.paintedRawMaterial;
    this.showCelebration = false;
    this.showResetConfirm = false;
    this.ui.showCelebration(false);
    this.ui.showResetConfirmation(false);
    this.saveStatus = { saved: false, message: '' };
    this.kilnFinished = false;

    // Set challenge silhouette if mode is challenge (or guided target)
    if (mode === 'challenge') {
      const preset =
        CHALLENGE_PRESETS.find((c) => c.id === this.state.challengePresetId) ??
        CHALLENGE_PRESETS[0];
      this.sculpting.setChallengeSilhouette(preset);
    } else if (mode === 'guided') {
      const lesson = GUIDED_LESSONS.find((l) => l.id === this.state.lessonId);
      const preset = CHALLENGE_PRESETS.find(
        (c) => c.id === lesson?.targetPresetId
      );
      this.sculpting.setChallengeSilhouette(preset ?? null);
    } else {
      this.sculpting.setChallengeSilhouette(null);
    }

    this.refreshSimilarity();

    if (this.xrManager.inXRSession) {
      this.state.inputMode = 'webxr';
      this.navigate('studio');
      return;
    }

    if (inputMode === 'webcam') {
      this.state.inputMode = 'webcam';
      if (this.handTracker.isReady) {
        if (!this.shouldHideHandCursor() && !this.handCursorUserDisabled) {
          this.handCursorActive = true;
          this.handCursor.setEnabled(true);
        }
        if (this.calibration.data.calibrated) {
          this.navigate('studio');
        } else {
          this.startCalibration();
        }
      } else {
        this.navigate('webcam-permission');
      }
    } else {
      this.state.inputMode = 'mouse';
      if (!this.handCursorActive) {
        this.handTracker.stop();
      }
      this.navigate('studio');
    }
  }

  private async requestWebcamAndCalibrate(): Promise<void> {
    const res = await this.handTracker.startWebcamAndModel();
    if (!res.ok) {
      this.rerenderUI();
      return;
    }
    if (!this.shouldHideHandCursor() && !this.handCursorUserDisabled) {
      this.handCursorActive = true;
      this.handCursor.setEnabled(true);
    }
    this.startCalibration();
  }

  private startCalibration(): void {
    if (!this.handTracker.isReady) {
      this.navigate('webcam-permission');
      return;
    }
    this.calibration.start();
    this.latestCalProgress = undefined;
    this.navigate('hand-calibration');
  }

  private finishCalibrationToStudio(): void {
    this.calibration.data.calibrated = true;
    this.calibration.save();
    const target = this.postCalibrationScreen;
    this.postCalibrationScreen = 'studio';
    this.navigate(target);
  }

  private switchToMouseMode(): void {
    this.state.inputMode = 'mouse';
    if (!this.handCursorActive) {
      this.handTracker.stop();
    }
    const target = this.postCalibrationScreen;
    this.postCalibrationScreen = 'studio';
    this.navigate(target);
  }

  private performReset(): void {
    this.sculpting.reset();
    this.painter.clear(false);
    this.painter.setBaseTexture(this.sculpting.wetClayTexture);
    this.sculpting.clayMesh.material = this.paintedRawMaterial;
    this.showResetConfirm = false;
    this.showCelebration = false;
    this.ui.showResetConfirmation(false);
    this.ui.showCelebration(false);
    this.currentPersonality = null;
    this.saveStatus = { saved: false, message: '' };
    this.refreshSimilarity();
    this.rerenderUI();
  }

  private handleFinishPot(): void {
    this.sculpting.finishPot();
    this.currentPersonality = generatePotteryPersonality(this.sculpting.profile);
    this.refreshSimilarity();
    this.showCelebration = true;
    this.ui.showCelebration(true);
    this.audio.playFinishChime();
    this.rerenderUI();
  }

  private selectGlaze(glazeId: string): void {
    this.state.selectedGlazeId = glazeId;
    this.applyPreviewGlaze();
    this.rerenderUI();
  }

  private applyPreviewGlaze(): void {
    this.painter.setBaseTexture(
      this.glazeManager.getTexture(this.state.selectedGlazeId)
    );
    this.glazeManager.applyGlazeProperties(
      this.paintedGlazeMaterial,
      this.state.selectedGlazeId
    );
    this.sculpting.clayMesh.material = this.paintedGlazeMaterial;
  }

  private startKilnSequence(): void {
    this.kilnFinished = false;
    this.kilnLastPhase = 'opening-door';
    this.saveStatus = { saved: false, message: '' };

    // Apply raw clay + painted underglaze initially, then transform to fired glaze mid-firing
    this.painter.setBaseTexture(this.sculpting.wetClayTexture);
    this.sculpting.clayMesh.material = this.paintedRawMaterial;
    this.navigate('kiln');
    this.audio.playKilnDoor(true);

    this.kiln.startFiring(this.sculpting.clayMesh, {
      reducedMotion: this.state.settings.reducedMotion,
      onTransform: () => {
        this.applyPreviewGlaze();
        this.audio.playFinishChime();
      },
      onComplete: () => {
        this.kilnFinished = true;
        this.audio.setKilnHeatAmbience(0);
        this.audio.playCompletionBell();
        this.rerenderUI();
      },
    });
  }

  private saveCurrentToGallery(customName?: string): void {
    if (!this.currentPersonality) {
      this.currentPersonality = generatePotteryPersonality(
        this.sculpting.profile
      );
    }
    const name = (customName ?? this.currentPersonality.name).trim() || this.currentPersonality.name;

    const item: SavedPotteryItem = {
      id: `pot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      createdAt: new Date().toISOString(),
      glazeId: this.state.selectedGlazeId,
      mode: this.state.mode,
      measurements: this.currentPersonality.measurements,
      paintDataUrl: this.painter.exportPaintDataUrl(),
      profile: {
        outerRadii: this.sculpting.profile.outerRadii.map((n) => Number(n.toFixed(4))),
        innerRadii: this.sculpting.profile.innerRadii.map((n) => Number(n.toFixed(4))),
        heights: this.sculpting.profile.heights.map((n) => Number(n.toFixed(4))),
        openDepth: Number(this.sculpting.profile.openDepth.toFixed(3)),
        angularOffsets: this.sculpting.profile.angularOffsets.map((n) =>
          Number(n.toFixed(4))
        ),
      },
    };

    const res = this.gallery.save(item);
    if (res.ok) {
      this.state.selectedGalleryItemId = item.id;
      this.saveStatus = {
        saved: true,
        message: `"${name}" saved to your personal pottery gallery.`,
      };
    } else {
      this.saveStatus = {
        saved: false,
        message: res.error ?? 'Failed to save pottery creation.',
      };
    }
    this.rerenderUI();
  }

  private commitUnrestoredSmashedVessels(): number {
    if (!this.smashSystem.isSmashMode()) return 0;
    const smashedIds = this.smashSystem.getSmashedItemIds();
    if (smashedIds.length === 0) return 0;
    let deletedCount = 0;
    for (const id of smashedIds) {
      if (this.gallery.delete(id).ok) {
        deletedCount++;
      }
    }
    const remaining = this.gallery.getItems();
    if (
      !this.state.selectedGalleryItemId ||
      !remaining.some((item) => item.id === this.state.selectedGalleryItemId)
    ) {
      this.state.selectedGalleryItemId = remaining[0]?.id ?? null;
    }
    return deletedCount;
  }

  private selectGalleryItem(id: string): void {
    if (this.smashSystem.isRestoring()) return;
    if (this.smashSystem.isSmashMode()) {
      if (this.smashSystem.getScope() === 'single') {
        if (
          id === this.state.selectedGalleryItemId &&
          this.smashSystem.getStatus().totalVessels === 1
        ) {
          this.rerenderUI();
          return;
        }
        this.commitUnrestoredSmashedVessels();
        const items = this.gallery.getItems();
        const nextItem = items.find((i) => i.id === id) ?? items[0] ?? null;
        if (!nextItem) {
          this.smashSystem.exitSmashMode();
          this.mouseGallerySwinging = false;
          this.sceneManager.setOrbitEnabled(true);
          this.sceneManager.setGalleryFraming(0, false);
          this.state.selectedGalleryItemId = null;
          this.gallery.showItemOnPedestal(null);
        } else {
          this.state.selectedGalleryItemId = nextItem.id;
          this.smashSystem.enterSmashMode(
            [nextItem],
            nextItem.id,
            (it) => this.gallery.buildMeshFromSaved(it),
            'single'
          );
          this.sceneManager.setGalleryFraming(1, true);
        }
      } else {
        this.state.selectedGalleryItemId = id;
        this.smashSystem.focusVesselById(id);
      }
      this.rerenderUI();
      return;
    }

    this.state.selectedGalleryItemId = id;
    const item = this.gallery.getItems().find((i) => i.id === id) ?? null;
    this.gallery.showItemOnPedestal(item);
    this.rerenderUI();
  }

  private renameGalleryItem(id: string, name: string): void {
    const res = this.gallery.rename(id, name);
    if (res.ok) {
      this.rerenderUI();
    }
  }

  private deleteGalleryItem(id: string): void {
    if (this.smashSystem.isRestoring()) return;
    const wasSmash = this.smashSystem.isSmashMode();
    if (wasSmash) {
      this.commitUnrestoredSmashedVessels();
      this.smashSystem.exitSmashMode();
      this.mouseGallerySwinging = false;
      this.sceneManager.setOrbitEnabled(true);
      this.sceneManager.setGalleryFraming(0, false);
    }
    const res = this.gallery.delete(id);
    if (res.ok || wasSmash) {
      const items = this.gallery.getItems();
      this.state.selectedGalleryItemId = items[0]?.id ?? null;
      const nextItem =
        items.find((i) => i.id === this.state.selectedGalleryItemId) ?? null;
      this.gallery.showItemOnPedestal(nextItem);
      this.rerenderUI();
    }
  }

  private toggleGallerySmash(): void {
    if (this.smashSystem.isRestoring()) return;
    if (this.smashSystem.isSmashMode()) {
      // If any pottery was shattered and not restored, delete it permanently upon exiting
      this.commitUnrestoredSmashedVessels();
      this.smashSystem.exitSmashMode();
      this.mouseGallerySwinging = false;
      this.sceneManager.setOrbitEnabled(true);
      const remaining = this.gallery.getItems();
      this.sceneManager.setGalleryFraming(remaining.length, false);
      const selected =
        remaining.find((i) => i.id === this.state.selectedGalleryItemId) ??
        remaining[0] ??
        null;
      this.state.selectedGalleryItemId = selected?.id ?? null;
      this.gallery.showItemOnPedestal(selected);
    } else {
      const items = this.gallery.getItems();
      if (items.length > 0) {
        const selected =
          items.find((i) => i.id === this.state.selectedGalleryItemId) ??
          items[0];
        this.state.selectedGalleryItemId = selected.id;
        this.gallery.clearPedestal();
        // Smash (Bat) shows ONLY the selected pottery!
        this.smashSystem.enterSmashMode(
          [selected],
          selected.id,
          (item) => this.gallery.buildMeshFromSaved(item),
          'single'
        );
        this.sceneManager.setGalleryFraming(1, true);
      }
    }
    this.rerenderUI();
  }

  private smashAllGallery(): void {
    if (this.smashSystem.isRestoring()) return;
    if (
      this.smashSystem.isSmashMode() &&
      this.smashSystem.getScope() === 'single'
    ) {
      this.commitUnrestoredSmashedVessels();
      this.smashSystem.exitSmashMode();
    }

    const items = this.gallery.getItems();
    if (items.length === 0) {
      this.mouseGallerySwinging = false;
      this.sceneManager.setOrbitEnabled(true);
      this.sceneManager.setGalleryFraming(0, false);
      this.gallery.showItemOnPedestal(null);
      this.rerenderUI();
      return;
    }

    if (!this.smashSystem.isSmashMode()) {
      this.gallery.clearPedestal();
      // Smash All shows ALL saved pottery spaced cleanly
      this.smashSystem.enterSmashMode(
        items,
        this.state.selectedGalleryItemId,
        (item) => this.gallery.buildMeshFromSaved(item),
        'all'
      );
      this.sceneManager.setGalleryFraming(items.length, true);
    }
    this.smashSystem.smashAllWithBatSweep();
    this.rerenderUI();
  }

  private restoreGallery(): void {
    if (this.smashSystem.startRestore()) {
      this.rerenderUI();
    }
  }

  private async exportCreationGLB(id?: string): Promise<void> {
    if (id) {
      const item = this.gallery.getItems().find((i) => i.id === id);
      const mesh = this.gallery.getActiveMesh();
      if (item && mesh) {
        await this.exporter.exportGLB(mesh, item.name);
      }
    } else {
      const name = this.currentPersonality?.name ?? 'clay-hands-vessel';
      await this.exporter.exportGLB(this.sculpting.clayMesh, name);
    }
  }

  private updateSettings(partial: Partial<StudioSettings>): void {
    const updated = this.state.updateSettings(partial);
    this.applySettings(updated);
  }

  private applySettings(settings: StudioSettings): void {
    this.handTracker.setInferenceFps(settings.inferenceFps);
    this.handTracker.setSmoothing(settings.handSensitivity);
    this.gestureRecognizer.setSensitivity(settings.handSensitivity);
    this.sceneManager.setReducedMotion(settings.reducedMotion);
    this.smashSystem.setReducedMotion(settings.reducedMotion);
    this.audio.applySettings(settings);
  }

  private refreshSimilarity(): void {
    if (this.state.mode !== 'challenge') {
      this.currentSimilarity = null;
      return;
    }
    const preset = CHALLENGE_PRESETS.find(
      (c) => c.id === this.state.challengePresetId
    );
    if (preset) {
      this.currentSimilarity = computeSimilarityScore(
        this.sculpting.profile,
        preset
      );
    }
  }

  private buildHUDState(): StudioHUDState {
    const smashStatus = this.smashSystem.getStatus();
    return {
      stage: this.sculpting.stage,
      gesture: this.currentGesture,
      inputMode: this.xrManager.inXRSession ? 'webxr' : this.state.inputMode,
      trackingStatus: this.handTracker.status,
      trackingError: this.handTracker.errorType,
      trackingErrorMsg: this.handTracker.errorMessage,
      trackingLost: this.handTracker.isTrackingLost,
      canUndo:
        this.mouseTool === 'brush'
          ? this.painter.canUndo || this.sculpting.canUndo
          : this.sculpting.canUndo,
      needsResetConfirm:
        this.sculpting.isSubstantiallyModified || this.painter.hasPaint,
      mouseTool: this.mouseTool,
      brushColorId: this.painter.activeColorId || VILLAGE_PIGMENTS[0].id,
      brushSize: this.painter.activeSize,
      eraserMode: this.painter.eraserMode,
      hasPaint: this.painter.hasPaint,
      canUndoPaint: this.painter.canUndo,
      glazePaintMode: this.glazePaintMode,
      glazeSpinEnabled: this.glazeSpinEnabled,
      mode: this.state.mode,
      lessonId: this.state.lessonId,
      challengeId: this.state.challengePresetId,
      similarity: this.currentSimilarity,
      personality: this.currentPersonality,
      selectedGlazeId: this.state.selectedGlazeId,
      kilnStatus: this.kilnStatus,
      kilnFinished: this.kilnFinished,
      saveStatus: this.saveStatus,
      vrSupported: this.xrManager.vrSupported,
      inVR: this.xrManager.inXRSession,
      vrMessage: this.xrManager.statusMessage,
      handCursorActive: this.handCursorActive && !this.shouldHideHandCursor(),
      showHandCursorControl: !this.shouldHideHandCursor(),
      gallerySmashMode: smashStatus.smashMode,
      gallerySmashScope: smashStatus.smashScope,
      galleryCrackedCount: smashStatus.crackedCount,
      gallerySmashedCount: smashStatus.smashedCount,
      galleryTotalVessels: smashStatus.totalVessels,
      galleryIsRestoring: smashStatus.isRestoring,
      galleryFocusedName: smashStatus.focusedVesselName,
      galleryFocusedHits: smashStatus.focusedVesselHits,
      tutorialMatched: this.tutorialMatched,
      tutorialProgress: this.tutorial.getProgress(),
      tutorialFinishedAll: this.tutorial.finishedAll,
    };
  }

  private rerenderUI(): void {
    this.ui.renderScreen(
      this.state.screen,
      this.state.settings,
      this.buildHUDState(),
      this.gallery.getItems(),
      this.state.selectedGalleryItemId,
      this.latestCalProgress
    );
  }

  public onXRSessionStarted(): void {
    this.audio.unlock();
    this.xrManager.inXRSession = true;
    this.vrPanel.visible = true;
    this.handCursor.setEnabled(false);
    this.handCursor.hide();
    if (
      this.state.screen === 'webcam-permission' ||
      this.state.screen === 'hand-calibration'
    ) {
      this.navigate('studio');
    } else {
      this.xrManager.alignStationForScreen(
        this.state.screen,
        xb.core.camera,
        this.wheel.group,
        this.kiln.group,
        this.sceneManager.galleryGroup,
        this.vrPanel
      );
      this.rerenderUI();
    }
  }

  public onXRSessionEnded(): void {
    this.xrManager.inXRSession = false;
    this.vrPanel.visible = false;
    if (
      this.handCursorActive &&
      this.handTracker.isReady &&
      !this.shouldHideHandCursor()
    ) {
      this.handCursor.setEnabled(true);
    }
    this.wheel.group.position.set(0, 0, 0);
    this.wheel.group.rotation.y = 0;
    this.kiln.group.position.copy(this.sceneManager.kilnPosition);
    this.kiln.group.rotation.y = -0.52;
    this.sceneManager.galleryGroup.position.copy(
      this.sceneManager.galleryPosition
    );
    this.sceneManager.galleryGroup.rotation.y = 0;
    this.rerenderUI();
  }

  public update(): void {
    if (document.hidden) return;
    const rawDt = xb.getDeltaTime();
    const dt = Math.min(rawDt > 0 ? rawDt : 0.016, 0.05);
    const now = performance.now();

    // 1. Update wheel spinning (stops when finished or in kiln/gallery; optional slow spin in glaze)
    const wheelSpinning =
      this.state.screen === 'welcome' ||
      this.state.screen === 'start-studio' ||
      this.state.screen === 'webcam-permission' ||
      this.state.screen === 'hand-calibration' ||
      this.state.screen === 'tutorial' ||
      (this.state.screen === 'studio' && this.sculpting.stage !== 'finished') ||
      (this.state.screen === 'glaze' && this.glazeSpinEnabled);

    const spinRate =
      this.state.screen === 'glaze' ? 0.35 : this.state.settings.wheelSpeed;
    this.wheel.update(dt, spinRate, wheelSpinning);

    // 2. Poll hand tracking if active
    let activeCal = this.calibration.data;
    let usingWebXR = false;

    if (this.xrManager.inXRSession) {
      this.wheel.clayMount.getWorldPosition(this._wheelWorld);
      this.wheel.group.updateMatrixWorld();
      this._wheelInverse.copy(this.wheel.group.matrixWorld).invert();
      const xrSample = this.xrManager.sampleXRHands(
        now,
        this._wheelWorld,
        this._wheelInverse,
        this.wheel.wheelSurfaceY,
        this.sculpting.currentHeight
      );
      if (xrSample && xrSample.frame.hands.length > 0) {
        this.latestFrame = xrSample.frame;
        activeCal = xrSample.calibration;
        usingWebXR = true;
      }
    }

    if (
      !usingWebXR &&
      (this.state.inputMode === 'webcam' || this.handCursorActive) &&
      this.handTracker.isReady
    ) {
      this.latestFrame = this.handTracker.pollFrame(now, this.calibration.data);
    }

    const playSculptMode =
      (this.state.screen === 'studio' ||
        this.state.screen === 'tutorial' ||
        this.state.screen === 'glaze' ||
        (this.state.screen === 'gallery' && this.smashSystem.isSmashMode())) &&
      !this.showResetConfirm &&
      !this.showCelebration;

    const activeSculptHands =
      this.state.inputMode === 'webcam' &&
      (this.state.screen === 'studio' || this.state.screen === 'tutorial') &&
      this.mouseTool !== 'brush' &&
      !this.showResetConfirm &&
      !this.showCelebration
        ? this.latestFrame.hands.filter((h) => h.inInteractionZone).length
        : 0;
    const suppressCursorForSculpt = activeSculptHands >= 2;

    // 2D hand cursor stays hidden on Meta Quest & XR sessions; active on desktop webcam menus
    const cursorStatus = this.handCursor.update(
      this.latestFrame,
      this.state.settings.handedness,
      this.state.settings.handSensitivity,
      this.shouldHideHandCursor(),
      playSculptMode,
      suppressCursorForSculpt
    );

    const pointingAtVRUI =
      usingWebXR &&
      this.vrPanel.visible &&
      Boolean(
        xb.core?.user?.isPointingAt(this.vrPanel) ||
          xb.core?.user?.isSelectingAt(this.vrPanel)
      );
    const pauseForUI = pointingAtVRUI || cursorStatus.overUI;

    // 3. Calibration screen progression
    if (this.state.screen === 'hand-calibration') {
      const progress = this.calibration.update(this.latestFrame, dt);
      this.latestCalProgress = progress;
      this.ui.updateLiveStudioHUD(
        this.buildHUDState(),
        this.latestFrame,
        this.handTracker.videoElement,
        this.state.settings,
        progress
      );
      if (progress.step === 'complete') {
        this.audio.playFinishChime();
        const target = this.postCalibrationScreen;
        this.postCalibrationScreen = 'studio';
        this.navigate(target);
      }
    }

    // 4. Studio & Interactive Tutorial sculpting / hand-tracked brush update
    if (this.state.screen === 'studio' || this.state.screen === 'tutorial') {
      const usingHandInput =
        (this.state.inputMode === 'webcam' || usingWebXR) &&
        !this.mouseSculpting &&
        !this.mousePainting;
      const handBrushMode =
        usingHandInput &&
        this.mouseTool === 'brush' &&
        this.sculpting.stage !== 'finished';

      if (pauseForUI) {
        this.stopHandBrushSession();
        this.currentGesture = {
          ...IDLE_GESTURE,
          handsCount: this.latestFrame.hands.length,
          description: pointingAtVRUI
            ? 'Interacting with Quest Studio panel.'
            : 'Pointing at button — pinch or hold to click.',
        };
      } else if (handBrushMode) {
        this.handMapper.group.visible = false;
        this.runHandBrushPainting(activeCal, usingWebXR);
      } else if (usingHandInput) {
        this.handMapper.group.visible = true;
        this.currentGesture = this.gestureRecognizer.recognize(
          this.latestFrame.hands,
          activeCal,
          this.sculpting.stage
        );

        const activeRingIdx = Math.min(
          this.sculpting.profile.ringCount - 1,
          Math.max(
            0,
            Math.round(
              this.currentGesture.activeHeightNorm *
                (this.sculpting.profile.ringCount - 1)
            )
          )
        );
        const radiusAtH = this.sculpting.profile.outerRadii[activeRingIdx];

        this.handMapper.updateVisuals(
          this.latestFrame.hands,
          activeCal,
          this.currentGesture,
          this.sculpting.currentHeight,
          radiusAtH,
          usingWebXR,
          dt
        );
      } else {
        // Mouse & keyboard fallback
        if (this.mouseSculpting && now - this.mouseDragTimeout > 120) {
          // Holding steady on clay while mouse button down -> smooth!
          this.mouseGesture = {
            ...this.mouseGesture,
            gesture:
              this.mouseTool === 'pinch'
                ? 'pinch_neck'
                : this.mouseTool === 'open'
                  ? 'open'
                  : 'smooth',
            strength: 0.55 * this.state.settings.handSensitivity,
            description:
              this.mouseTool === 'pinch'
                ? 'Pinching neck inward.'
                : this.mouseTool === 'open'
                  ? 'Opening hollow interior.'
                  : 'Holding steady to smooth surface.',
          };
        }
        this.currentGesture = this.mouseSculpting
          ? this.mouseGesture
          : { ...IDLE_GESTURE };

        const activeRingIdx = Math.min(
          this.sculpting.profile.ringCount - 1,
          Math.max(
            0,
            Math.round(
              this.currentGesture.activeHeightNorm *
                (this.sculpting.profile.ringCount - 1)
            )
          )
        );
        this.handMapper.showMouseBrushIndicator(
          this.mouseSculpting,
          this.currentGesture.activeHeightNorm,
          this.sculpting.currentHeight,
          this.sculpting.profile.outerRadii[activeRingIdx]
        );
      }

      const skipSculpt = this.mouseTool === 'brush';
      const prevStage = this.sculpting.stage;
      const modified = skipSculpt
        ? false
        : this.sculpting.applyGesture(this.currentGesture, dt);
      if (modified) {
        this.refreshSimilarity();
        if (this.sculpting.stage !== prevStage) {
          this.audio.playCompressionPulse();
          this.rerenderUI();
        }
      }

      this.audio.updateStudioAudio(
        wheelSpinning,
        this.state.settings.wheelSpeed,
        skipSculpt ? 'idle' : this.currentGesture.gesture,
        skipSculpt ? 0 : this.currentGesture.strength
      );

      if (this.state.screen === 'tutorial') {
        if (this.tutorialAdvanceTimer > 0) {
          this.tutorialAdvanceTimer -= dt;
          if (this.tutorialAdvanceTimer <= 0 && !this.tutorial.finishedAll) {
            this.tutorialAdvanceTimer = 0;
            this.tutorial.next();
            this.applyTutorialStepState();
            this.rerenderUI();
          }
        } else {
          const practice = this.tutorial.updatePractice(
            this.currentGesture,
            this.mousePainting || this.handBrushActive,
            dt
          );
          this.tutorialMatched = practice.matched;
          if (practice.completedStep) {
            this.audio.playFinishChime();
            this.tutorialAdvanceTimer = practice.finishedAll ? 0 : 0.6;
            this.rerenderUI();
          }
        }
      }

      this.ui.updateLiveStudioHUD(
        this.buildHUDState(),
        this.latestFrame,
        this.handTracker.videoElement,
        this.state.settings
      );
    } else if (this.state.screen === 'glaze') {
      if (
        (this.state.inputMode === 'webcam' || usingWebXR) &&
        this.glazePaintMode &&
        !this.mousePainting &&
        !pauseForUI
      ) {
        this.runHandBrushPainting(activeCal, usingWebXR);
      } else if (pauseForUI) {
        this.stopHandBrushSession();
      }
      this.audio.updateStudioAudio(
        wheelSpinning,
        spinRate,
        'idle',
        0
      );
      this.ui.updateLiveStudioHUD(
        this.buildHUDState(),
        this.latestFrame,
        this.handTracker.videoElement,
        this.state.settings
      );
    } else {
      this.audio.updateStudioAudio(false, 0, 'idle', 0);
    }

    // 5. Kiln animation update
    if (this.state.screen === 'kiln') {
      this.kilnStatus = this.kiln.update(dt);
      if (this.kilnStatus.phase !== this.kilnLastPhase) {
        if (
          this.kilnStatus.phase === 'closing-door' ||
          this.kilnStatus.phase === 'opening-reveal'
        ) {
          this.audio.playKilnDoor(this.kilnStatus.phase === 'opening-reveal');
        }
        this.kilnLastPhase = this.kilnStatus.phase;
      }
      const heat =
        this.kilnStatus.phase === 'heating' ||
        this.kilnStatus.phase === 'transforming'
          ? 0.9
          : this.kilnStatus.phase === 'cooling'
            ? 0.35
            : 0;
      this.audio.setKilnHeatAmbience(heat);
      this.ui.updateLiveStudioHUD(
        this.buildHUDState(),
        this.latestFrame,
        this.handTracker.videoElement,
        this.state.settings
      );
    }

    // 6. Gallery Bat Smash, Time-Stone Reversal, or gentle pedestal rotation
    if (this.state.screen === 'gallery') {
      const smashStatus = this.smashSystem.getStatus();
      if (smashStatus.smashMode) {
        if (this.handGallerySwingCooldown > 0) {
          this.handGallerySwingCooldown = Math.max(0, this.handGallerySwingCooldown - dt);
        }

        if (!smashStatus.isRestoring && !this.mouseGallerySwinging && !pauseForUI) {
          if (this.xrManager.inXRSession) {
            const vrPose = this.xrManager.getPrimaryVRBatPose(
              this.state.settings.handedness,
              this._xrBatPos,
              this._xrBatDir
            );
            if (vrPose.active) {
              this.smashSystem.aimBatFromWorldPoint(this._xrBatPos, this._xrBatDir);
              const wantsStrike =
                vrPose.worldSpeed > 0.95 ||
                (vrPose.pinching && !this.handGalleryPinching) ||
                (vrPose.triggerPressed && !this.vrBatTriggerHeld);
              if (wantsStrike && this.handGallerySwingCooldown <= 0) {
                this.smashSystem.triggerBatSwing(
                  vrPose.source === 'hand' ? -1 : 1,
                  true
                );
                this.handGallerySwingCooldown = 0.36;
              }
              this.handGalleryPinching = vrPose.pinching;
              this.vrBatTriggerHeld = vrPose.triggerPressed;
            }
          } else if (
            this.latestFrame.hands.length > 0 &&
            (this.state.inputMode === 'webcam' || this.handCursorActive)
          ) {
            const hand =
              this.latestFrame.hands.find(
                (h) => h.handedness === this.state.settings.handedness
              ) ?? this.latestFrame.hands[0];
            const sens = this.state.settings.handSensitivity;
            const spanX = Math.max(0.14, activeCal.maxSpan * 0.65);
            const spanY = Math.max(
              0.16,
              (activeCal.maxY - activeCal.minY) * 0.6
            );
            const midY = (activeCal.minY + activeCal.maxY) * 0.5;
            const ndcX = THREE.MathUtils.clamp(
              ((activeCal.centerX - hand.palmCenter.x) / spanX) * sens,
              -1,
              1
            );
            const ndcY = THREE.MathUtils.clamp(
              ((midY - hand.palmCenter.y) / spanY) * sens,
              -1,
              1
            );
            this.smashSystem.aimBatFromNDC(ndcX, ndcY, xb.core.camera);
            const pinching =
              hand.handSpan > 0 && hand.pinchDistance / hand.handSpan < 0.4;
            const fastSwipe = hand.speed > 0.34;
            const forwardPunch = hand.velocity.z < -0.26;
            if (
              (fastSwipe ||
                forwardPunch ||
                (pinching && !this.handGalleryPinching)) &&
              this.handGallerySwingCooldown <= 0
            ) {
              this.smashSystem.triggerBatSwing(
                hand.velocity.x >= 0 ? -1 : 1,
                true
              );
              this.handGallerySwingCooldown = 0.36;
            }
            this.handGalleryPinching = pinching;
          }
        }
        this.smashSystem.update(dt, xb.core.camera);
      } else {
        const galMesh = this.gallery.getActiveMesh();
        if (
          galMesh &&
          this.gallerySpinEnabled &&
          !this.state.settings.reducedMotion
        ) {
          galMesh.rotation.y += dt * 0.35;
        }
      }
    }

    // 7. Update studio environment, particles, & damped camera
    this.sceneManager.update(
      dt,
      xb.core.camera,
      this.xrManager.inXRSession,
      this.state.screen === 'welcome'
    );

    // 8. Sync Quest VR spatial UI panel across all screens
    if (this.xrManager.inXRSession && this.vrPanel.visible) {
      const tutStep = this.tutorial.getCurrentStep();
      const smashStatusGallery = this.smashSystem.getStatus();
      this.vrPanel.sync({
        screen: this.state.screen,
        mode: this.state.mode,
        lessonId: this.state.lessonId,
        challengeId: this.state.challengePresetId,
        stage: this.sculpting.stage,
        wheelSpeed: this.state.settings.wheelSpeed,
        brushActive: this.mouseTool === 'brush',
        brushColorId: this.painter.activeColorId || VILLAGE_PIGMENTS[0].id,
        brushSize: this.painter.activeSize,
        eraserMode: this.painter.eraserMode,
        hasPaint: this.painter.hasPaint,
        canUndoPaint: this.painter.canUndo,
        canUndo:
          this.mouseTool === 'brush'
            ? this.painter.canUndo || this.sculpting.canUndo
            : this.sculpting.canUndo,
        glazePaintMode: this.glazePaintMode,
        glazeSpinEnabled: this.glazeSpinEnabled,
        glazeId: this.state.selectedGlazeId,
        gestureDesc:
          usingWebXR && this.latestFrame.hands.length > 0
            ? this.currentGesture.description
            : 'Aim your Quest hand ray at any button & pinch to select.',
        handsCount: this.latestFrame.hands.length,
        similarity: this.currentSimilarity,
        personality: this.currentPersonality,
        needsResetConfirm:
          this.sculpting.isSubstantiallyModified || this.painter.hasPaint,
        showResetConfirm: this.showResetConfirm,
        showCelebration: this.showCelebration,
        kilnCaption: this.kilnStatus.caption,
        kilnTemp: this.kilnStatus.temperatureLabel,
        kilnProgress: this.kilnStatus.progress,
        kilnFinished: this.kilnFinished,
        saveStatus: this.saveStatus,
        galleryItems: this.gallery.getItems(),
        selectedGalleryId: this.state.selectedGalleryItemId,
        gallerySpinEnabled: this.gallerySpinEnabled,
        gallerySmashMode: smashStatusGallery.smashMode,
        gallerySmashScope: smashStatusGallery.smashScope,
        galleryTotalVessels: smashStatusGallery.totalVessels,
        galleryCrackedCount: smashStatusGallery.crackedCount,
        gallerySmashedCount: smashStatusGallery.smashedCount,
        galleryIsRestoring: smashStatusGallery.isRestoring,
        galleryFocusedName: smashStatusGallery.focusedVesselName,
        galleryFocusedHits: smashStatusGallery.focusedVesselHits,
        tutorialStepIndex: this.tutorial.currentStepIndex,
        tutorialTitle: tutStep.title,
        tutorialCue: tutStep.handCue,
        tutorialProgress: this.tutorial.getProgress(),
        tutorialMatched: this.tutorialMatched,
        tutorialFinishedAll: this.tutorial.finishedAll,
        completedTutorialIds: this.tutorial.completedSteps,
        settings: this.state.settings,
      });
    }
  }

  public dispose(): void {
    this.commitUnrestoredSmashedVessels();
    window.removeEventListener('pagehide', this.onUnloadCommitSmash);
    window.removeEventListener('beforeunload', this.onUnloadCommitSmash);
    this.handCursor.dispose();
    this.handTracker.dispose();
    this.handMapper.dispose();
    this.painter.dispose();
    this.paintedRawMaterial.dispose();
    this.paintedGlazeMaterial.dispose();
    this.sculpting.dispose();
    this.wheel.dispose();
    this.kiln.dispose();
    this.glazeManager.dispose();
    this.smashSystem.dispose();
    this.gallery.dispose();
    this.sceneManager.dispose();
    this.audio.dispose();
    this.sculptingProxy.geometry.dispose();
    (this.sculptingProxy.material as THREE.Material).dispose();
    if (this.activeGlazeClone) {
      this.activeGlazeClone.geometry.dispose();
    }
  }
}
