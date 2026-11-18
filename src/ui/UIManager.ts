import type { SmashScope } from '../gallery/PotterySmashSystem.ts';
import { GLAZE_CATALOG } from '../kiln/GlazeManager.ts';
import type { KilnStatus } from '../kiln/KilnController.ts';
import {
  CHALLENGE_PRESETS,
  GUIDED_LESSONS,
} from '../pottery/PotteryPresets.ts';
import { VILLAGE_PIGMENTS } from '../pottery/VesselPainter.ts';
import type {
  AppScreen,
  BrushSizePreset,
  ClayNamePlaqueShape,
  ClayNameTool,
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
  TrackingErrorType,
} from '../types.ts';
import type { VesselThumbnailKey } from '../pottery/VesselThumbnailRenderer.ts';
import type { CalibrationProgress } from '../tracking/HandCalibration.ts';
import {
  INTERACTIVE_TUTORIAL_STEPS,
  TutorialManager,
  type TutorialTargetAction,
} from './TutorialManager.ts';

export type MouseToolMode =
  | 'auto'
  | 'open'
  | 'pinch'
  | 'smooth'
  | 'one_side'
  | 'brush';

export interface UIActions {
  onNavigate: (screen: AppScreen) => void;
  onCloseModal: () => void;
  onSelectModeSelection: (
    mode: GameMode,
    lessonId: GuidedLessonId,
    challengeId: string
  ) => void;
  onStartMode: (
    mode: GameMode,
    inputMode: InputMode,
    lessonId?: GuidedLessonId,
    challengeId?: string
  ) => void;
  onRequestWebcam: () => Promise<void>;
  onUseMouseMode: () => void;
  onRecalibrate: () => void;
  onSkipCalibration: () => void;
  onWheelSpeedChange: (speed: number) => void;
  onUndo: () => void;
  onRequestReset: () => void;
  onConfirmReset: () => void;
  onCancelReset: () => void;
  onFinishPot: () => void;
  onSelectGlaze: (glazeId: string) => void;
  onStartKiln: () => void;
  onSaveToGallery: (customName?: string) => void;
  onSelectGalleryItem: (id: string) => void;
  onRenameGalleryItem: (id: string, name: string) => void;
  onDeleteGalleryItem: (id: string) => void;
  onToggleGallerySmash: () => void;
  onSmashAllGallery: () => void;
  onRestoreGallery: () => void;
  onExportGLB: (id?: string) => void;
  onUpdateSettings: (partial: Partial<StudioSettings>) => void;
  onMouseToolChange: (tool: MouseToolMode) => void;
  onSelectBrushColor: (colorId: string) => void;
  onSelectBrushSize: (size: BrushSizePreset) => void;
  onToggleEraser: () => void;
  onUndoPaint: () => void;
  onClearPaint: () => void;
  onToggleGlazePaintMode: (paintMode: boolean) => void;
  onToggleGlazeSpin: () => void;
  onStageJump: (stage: PotteryStage) => void;
  onToggleVR: () => void;
  onToggleHandCursor: () => void;
  onCelebrateCreateAnother: () => void;
  onTutorialSelectStep: (index: number) => void;
  onTutorialPrev: () => void;
  onTutorialNext: () => void;
  onTutorialResetPractice: () => void;
  onEnableWebcamFromTutorial: () => Promise<void>;
  onOpenNameStudio: (inputMode?: InputMode) => void;
  onSetClayNameText: (text: string) => void;
  onSetClayNameShape: (shape: ClayNamePlaqueShape) => void;
  onSetClayNameTool: (tool: ClayNameTool) => void;
  onSetClayNameRelief: (meters: number) => void;
  onSetClayNameBoldness: (boldness: number) => void;
  onUndoClayName: () => void;
  onResetClayName: () => void;
  onFinishClayName: (goToGlaze: boolean) => void;
}

export interface StudioHUDState {
  activeCreationKind: 'vessel' | 'name';
  stage: PotteryStage;
  gesture: GestureState;
  inputMode: InputMode;
  trackingStatus: string;
  trackingError: TrackingErrorType;
  trackingErrorMsg: string;
  trackingLost: boolean;
  canUndo: boolean;
  needsResetConfirm: boolean;
  mouseTool: MouseToolMode;
  brushColorId: string;
  brushSize: BrushSizePreset;
  eraserMode: boolean;
  hasPaint: boolean;
  canUndoPaint: boolean;
  glazePaintMode: boolean;
  glazeSpinEnabled: boolean;
  mode: GameMode;
  lessonId: GuidedLessonId;
  challengeId: string;
  similarity: SimilarityResult | null;
  personality: PotteryPersonality | null;
  selectedGlazeId: string;
  kilnStatus: KilnStatus;
  kilnFinished: boolean;
  saveStatus: { saved: boolean; message: string };
  vrSupported: boolean;
  inVR: boolean;
  vrMessage: string;
  handCursorActive: boolean;
  showHandCursorControl: boolean;
  gallerySmashMode: boolean;
  gallerySmashScope: SmashScope;
  galleryCrackedCount: number;
  gallerySmashedCount: number;
  galleryTotalVessels: number;
  galleryIsRestoring: boolean;
  galleryFocusedName: string | null;
  galleryFocusedHits: number;
  tutorialMatched: boolean;
  tutorialProgress: number;
  tutorialFinishedAll: boolean;
  clayNameText: string;
  clayNameShape: ClayNamePlaqueShape;
  clayNameTool: ClayNameTool;
  clayNameReliefMm: number;
  clayNameBoldness: number;
  canUndoClayName: boolean;
}

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export class UIManager {
  private readonly root: HTMLElement;
  private readonly actions: UIActions;
  private readonly tutorialManager: TutorialManager;
  private readonly getThumbnail: (key: VesselThumbnailKey) => string;

  private currentScreen: AppScreen = 'welcome';
  private dockCollapsed = false;
  private showCelebrationBanner = false;
  private customPotName = '';

  // Persistent canvas elements for live webcam PiP / calibration preview
  private pipCanvas: HTMLCanvasElement | null = null;
  private calCanvas: HTMLCanvasElement | null = null;
  private resetConfirmVisible = false;

  constructor(
    root: HTMLElement,
    actions: UIActions,
    tutorialManager: TutorialManager,
    getThumbnail: (key: VesselThumbnailKey) => string
  ) {
    this.root = root;
    this.actions = actions;
    this.tutorialManager = tutorialManager;
    this.getThumbnail = getThumbnail;
  }

  public showResetConfirmation(visible: boolean): void {
    this.resetConfirmVisible = visible;
  }

  public showCelebration(visible: boolean): void {
    this.showCelebrationBanner = visible;
  }

  public renderScreen(
    screen: AppScreen,
    settings: StudioSettings,
    hud: StudioHUDState,
    galleryItems: SavedPotteryItem[],
    selectedGalleryId: string | null,
    calibrationProgress?: CalibrationProgress
  ): void {
    this.currentScreen = screen;
    this.root.innerHTML = '';

    switch (screen) {
      case 'welcome':
        this.renderWelcome(hud, galleryItems.length);
        break;
      case 'start-studio':
        this.renderStartStudio(hud);
        break;
      case 'webcam-permission':
        this.renderWebcamPermission(hud);
        break;
      case 'hand-calibration':
        this.renderCalibration(calibrationProgress);
        break;
      case 'studio':
        this.renderStudioHUD(settings, hud);
        break;
      case 'name-studio':
        this.renderNameStudioScreen(settings, hud);
        break;
      case 'tutorial':
        this.renderTutorial(settings, hud);
        break;
      case 'glaze':
        this.renderGlazeScreen(settings, hud);
        break;
      case 'kiln':
        this.renderKilnScreen(hud);
        break;
      case 'gallery':
        this.renderGalleryScreen(galleryItems, selectedGalleryId, hud);
        break;
      case 'settings':
        this.renderSettingsScreen(settings, hud);
        break;
    }
  }

  /**
   * High-frequency HUD update inside studio / calibration without rebuilding DOM.
   */
  public updateLiveStudioHUD(
    hud: StudioHUDState,
    frame: HandTrackingFrame,
    video: HTMLVideoElement | null,
    settings: StudioSettings,
    calibrationProgress?: CalibrationProgress
  ): void {
    if (this.currentScreen === 'hand-calibration') {
      const msgEl = document.getElementById('cal-message');
      const barEl = document.getElementById('cal-progress-fill');
      const stepEl = document.getElementById('cal-step-badge');
      if (msgEl && calibrationProgress) {
        msgEl.textContent = calibrationProgress.message;
      }
      if (barEl && calibrationProgress) {
        barEl.style.width = `${Math.round(calibrationProgress.progress * 100)}%`;
      }
      if (stepEl && calibrationProgress) {
        const labels: Record<string, string> = {
          'waiting-hands': 'Step 1 of 3 · Detect Hands',
          'hold-inward': 'Step 2 of 3 · Narrow Span',
          'hold-outward': 'Step 3 of 3 · Wide Span',
          complete: 'Calibrated',
        };
        stepEl.textContent = labels[calibrationProgress.step] ?? 'Calibrating';
      }
      if (this.calCanvas && video && video.readyState >= 2) {
        this.drawWebcamOverlay(this.calCanvas, video, frame);
      }
      return;
    }

    if (this.currentScreen === 'studio') {
      const stageEl = document.getElementById('hud-stage-label');
      const gestureEl = document.getElementById('hud-gesture-desc');
      const trackBadge = document.getElementById('hud-tracking-badge');
      const undoBtn = document.getElementById(
        'hud-undo-btn'
      ) as HTMLButtonElement | null;
      const simScoreEl = document.getElementById('hud-challenge-score');

      if (stageEl) {
        stageEl.textContent = this.formatStageLabel(hud);
      }
      if (gestureEl) {
        if (hud.trackingLost) {
          gestureEl.textContent =
            'Hands out of view — bring hands back or use mouse fallback.';
        } else if (hud.mouseTool === 'brush' && hud.inputMode === 'mouse') {
          gestureEl.textContent =
            'Brush active — drag directly across the clay vessel to paint.';
        } else {
          gestureEl.textContent = hud.gesture.description;
        }
      }
      if (trackBadge) {
        trackBadge.textContent =
          hud.inputMode === 'webcam'
            ? hud.trackingLost
              ? 'Webcam · Tracking Lost'
              : `Webcam · ${frame.hands.length} Hand${frame.hands.length === 1 ? '' : 's'}`
            : hud.inputMode === 'webxr'
              ? `WebXR · ${frame.hands.length} Hand${frame.hands.length === 1 ? '' : 's'}`
              : 'Mouse & Keyboard';
        trackBadge.className = `status-pill ${
          hud.trackingLost ? 'status-warn' : 'status-ok'
        }`;
      }
      if (undoBtn) {
        undoBtn.disabled = !hud.canUndo;
      }
      const paintClearBtn = document.getElementById(
        'btn-paint-clear'
      ) as HTMLButtonElement | null;
      if (paintClearBtn) {
        paintClearBtn.disabled = !hud.hasPaint;
      }
      if (simScoreEl && hud.similarity) {
        simScoreEl.textContent = `${hud.similarity.score}% match`;
      }
      if (
        this.pipCanvas &&
        settings.showWebcamPip &&
        hud.inputMode === 'webcam' &&
        video &&
        video.readyState >= 2
      ) {
        this.drawWebcamOverlay(this.pipCanvas, video, frame);
      }
      return;
    }

    if (this.currentScreen === 'name-studio') {
      const gestureEl = document.getElementById('hud-gesture-desc');
      const trackBadge = document.getElementById('hud-tracking-badge');
      const undoBtn = document.getElementById(
        'name-undo-btn'
      ) as HTMLButtonElement | null;
      const paintClearBtn = document.getElementById(
        'btn-paint-clear'
      ) as HTMLButtonElement | null;
      const reliefVal = document.getElementById('name-relief-val');
      const boldVal = document.getElementById('name-bold-val');
      const reliefSlider = document.getElementById(
        'name-relief-slider'
      ) as HTMLInputElement | null;
      const boldSlider = document.getElementById(
        'name-bold-slider'
      ) as HTMLInputElement | null;

      if (gestureEl) {
        if (hud.trackingLost) {
          gestureEl.textContent =
            'Hands out of view — bring your hand in front of camera or drag plaque with mouse.';
        } else if (hud.inputMode === 'webcam' || hud.inputMode === 'webxr') {
          gestureEl.textContent =
            hud.clayNameTool === 'paint'
              ? 'Point & pinch across the plaque to paint · Pinch or spread both hands to resize letters.'
              : hud.gesture.description;
        } else {
          gestureEl.textContent =
            hud.clayNameTool === 'paint'
              ? 'Drag directly on the clay plaque to paint letters & border.'
              : 'Drag across the clay plaque to sculpt, stamp ♥, or smooth by hand.';
        }
      }
      if (trackBadge) {
        trackBadge.textContent =
          hud.inputMode === 'webcam'
            ? hud.trackingLost
              ? 'Webcam · Show Hand'
              : `Webcam · ${frame.hands.length} Hand${frame.hands.length === 1 ? '' : 's'}`
            : hud.inputMode === 'webxr'
              ? `WebXR · ${frame.hands.length} Hand${frame.hands.length === 1 ? '' : 's'}`
              : 'Mouse & Hand Tools';
        trackBadge.className = `status-pill ${
          hud.trackingLost ? 'status-warn' : 'status-ok'
        }`;
      }
      if (undoBtn) undoBtn.disabled = !hud.canUndoClayName;
      if (paintClearBtn) paintClearBtn.disabled = !hud.hasPaint;
      if (reliefVal) reliefVal.textContent = `${Math.round(hud.clayNameReliefMm)} mm`;
      if (boldVal) boldVal.textContent = `${hud.clayNameBoldness.toFixed(2)}x`;
      if (reliefSlider && document.activeElement !== reliefSlider) {
        reliefSlider.value = String(Math.round(hud.clayNameReliefMm));
      }
      if (boldSlider && document.activeElement !== boldSlider) {
        boldSlider.value = String(hud.clayNameBoldness.toFixed(2));
      }
      if (
        this.pipCanvas &&
        settings.showWebcamPip &&
        hud.inputMode === 'webcam' &&
        video &&
        video.readyState >= 2
      ) {
        this.drawWebcamOverlay(this.pipCanvas, video, frame);
      }
      return;
    }

    if (this.currentScreen === 'tutorial') {
      const step = this.tutorialManager.getCurrentStep();
      const fillEl = document.getElementById('tut-progress-fill');
      const statusEl = document.getElementById('tut-match-status');
      const trackBadge = document.getElementById('hud-tracking-badge');
      const doneStep = this.tutorialManager.isStepCompleted(
        this.tutorialManager.currentStepIndex
      );

      if (fillEl) {
        fillEl.style.width = `${Math.round(hud.tutorialProgress * 100)}%`;
      }
      if (statusEl) {
        if (hud.tutorialFinishedAll) {
          statusEl.textContent = 'All 5 gestures mastered!';
          statusEl.className = 'status-pill status-ok';
        } else if (doneStep) {
          statusEl.textContent = 'Step complete!';
          statusEl.className = 'status-pill status-ok';
        } else if (hud.tutorialMatched) {
          statusEl.textContent = 'Keep holding…';
          statusEl.className = 'status-pill status-ok';
        } else {
          statusEl.textContent =
            hud.inputMode === 'mouse' ? step.mouseCue : step.handCue;
          statusEl.className = 'status-pill status-warn';
        }
      }
      if (trackBadge) {
        trackBadge.textContent =
          hud.inputMode === 'webcam'
            ? hud.trackingLost
              ? 'Webcam · No Hands'
              : `Webcam · ${frame.hands.length} Hand${frame.hands.length === 1 ? '' : 's'}`
            : hud.inputMode === 'webxr'
              ? `WebXR · ${frame.hands.length} Hand${frame.hands.length === 1 ? '' : 's'}`
              : 'Mouse Practice';
        trackBadge.className = `status-pill ${
          hud.trackingLost ? 'status-warn' : 'status-ok'
        }`;
      }
      if (
        this.pipCanvas &&
        settings.showWebcamPip &&
        hud.inputMode === 'webcam' &&
        video &&
        video.readyState >= 2
      ) {
        this.drawWebcamOverlay(this.pipCanvas, video, frame);
      }
      return;
    }

    if (this.currentScreen === 'glaze') {
      const gestureEl = document.getElementById('hud-gesture-desc');
      const trackBadge = document.getElementById('hud-tracking-badge');
      const paintUndoBtn = document.getElementById(
        'btn-paint-undo'
      ) as HTMLButtonElement | null;
      const paintClearBtn = document.getElementById(
        'btn-paint-clear'
      ) as HTMLButtonElement | null;

      if (gestureEl) {
        if (hud.inputMode === 'webcam' || hud.inputMode === 'webxr') {
          gestureEl.textContent = !hud.glazePaintMode
            ? 'Orbit View — drag to inspect, or switch to Paint Brush.'
            : hud.trackingLost
              ? 'Hands out of view — bring your hand back or drag with mouse.'
              : hud.gesture.description;
        } else {
          gestureEl.textContent = hud.glazePaintMode
            ? 'Drag pot to brush paint · Drag background to rotate'
            : 'Drag anywhere to rotate and inspect';
        }
      }
      if (trackBadge) {
        trackBadge.textContent =
          hud.inputMode === 'webcam'
            ? hud.trackingLost
              ? 'Webcam · Tracking Lost'
              : `Webcam · ${frame.hands.length} Hand${frame.hands.length === 1 ? '' : 's'}`
            : hud.inputMode === 'webxr'
              ? `WebXR · ${frame.hands.length} Hand${frame.hands.length === 1 ? '' : 's'}`
              : 'Mouse & Keyboard';
        trackBadge.className = `status-pill ${
          hud.trackingLost ? 'status-warn' : 'status-ok'
        }`;
      }
      if (paintUndoBtn) paintUndoBtn.disabled = !hud.canUndoPaint;
      if (paintClearBtn) paintClearBtn.disabled = !hud.hasPaint;
      if (
        this.pipCanvas &&
        settings.showWebcamPip &&
        hud.inputMode === 'webcam' &&
        video &&
        video.readyState >= 2
      ) {
        this.drawWebcamOverlay(this.pipCanvas, video, frame);
      }
      return;
    }

    if (this.currentScreen === 'kiln') {
      const captionEl = document.getElementById('kiln-caption');
      const tempEl = document.getElementById('kiln-temp');
      const barEl = document.getElementById('kiln-bar-fill');
      if (captionEl) captionEl.textContent = hud.kilnStatus.caption;
      if (tempEl) tempEl.textContent = hud.kilnStatus.temperatureLabel;
      if (barEl) {
        barEl.style.width = `${Math.round(hud.kilnStatus.progress * 100)}%`;
      }
    }
  }

  private drawWebcamOverlay(
    canvas: HTMLCanvasElement,
    video: HTMLVideoElement,
    frame: HandTrackingFrame
  ): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();

    // Draw mirrored 21 landmarks per hand
    for (const hand of frame.hands) {
      const lm = hand.landmarks;
      if (lm.length < 21) continue;
      ctx.strokeStyle =
        hand.handedness === 'left' ? '#ffd08a' : '#9ee5c0';
      ctx.lineWidth = 2;
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.beginPath();
        ctx.moveTo(lm[a].x * w, lm[a].y * h);
        ctx.lineTo(lm[b].x * w, lm[b].y * h);
        ctx.stroke();
      }
      ctx.fillStyle = '#ffffff';
      for (const pt of lm) {
        ctx.beginPath();
        ctx.arc(pt.x * w, pt.y * h, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private renderWelcome(hud: StudioHUDState, galleryCount: number): void {
    const el = document.createElement('div');
    el.className = 'screen screen-welcome';
    el.innerHTML = `
      <div class="welcome-hero village-signboard">
        <div class="brand-lockup">
          <div class="village-crest-wrap" aria-hidden="true">
            <svg class="brand-emblem" viewBox="0 0 64 64" width="54" height="54">
              <path d="M12 46 C7 38, 7 26, 13 18" fill="none" stroke="#4d6d43" stroke-width="2.2" stroke-linecap="round"/>
              <path d="M11 33 C7 31, 6 27, 9 24" fill="none" stroke="#4d6d43" stroke-width="1.8" stroke-linecap="round"/>
              <path d="M52 46 C57 38, 57 26, 51 18" fill="none" stroke="#4d6d43" stroke-width="2.2" stroke-linecap="round"/>
              <path d="M53 33 C57 31, 58 27, 55 24" fill="none" stroke="#4d6d43" stroke-width="1.8" stroke-linecap="round"/>
              <path d="M23 15 C23 20, 16 26, 16 36 C16 46, 22 52, 32 52 C42 52, 48 46, 48 36 C48 26, 41 20, 41 15 Z" fill="rgba(184, 79, 51, 0.14)" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/>
              <ellipse cx="32" cy="15" rx="9" ry="3" fill="#f4e9d6" stroke="currentColor" stroke-width="2.3"/>
              <path d="M17 34 Q32 39 47 34" fill="none" stroke="#4d6d43" stroke-width="1.8" stroke-dasharray="2.5 3.5" stroke-linecap="round"/>
              <path d="M19 56 H45" stroke="#7a5133" stroke-width="2.6" stroke-linecap="round"/>
            </svg>
          </div>
          <div>
            <p class="eyebrow">META VR HACKATHON 2026 · HANDS-FIRST WEBXR</p>
            <h1>CLAY HANDS</h1>
          </div>
        </div>
        <p class="hero-copy">
          Controller-free 3D pottery crafted for natural hand tracking. Sculpt living radial clay on a spinning wheel, brush mineral pigments, fire glazed ceramics in an animated kiln, and export real 3D .glb vessels.
        </p>
        <ul class="welcome-pillars" aria-label="Core capabilities">
          <li><strong>Hands-First Spatial Craft:</strong> Built for Meta Quest WebXR hand tracking &amp; local MediaPipe webcam hands — zero controllers required.</li>
          <li><strong>60 FPS Procedural 3D:</strong> In-place radial mesh deformation, physically-based glazes, and real-time Web Audio feedback.</li>
          <li><strong>Complete Creative Loop:</strong> Guided lessons, 3D silhouette challenges, kiln firing, and persistent .glb gallery export.</li>
        </ul>
        <div class="welcome-actions">
          <div class="welcome-primary-row">
            <button class="btn btn-primary btn-welcome-main" id="btn-enter-studio">Pottery Wheel</button>
            <button class="btn btn-primary btn-welcome-main" id="btn-open-names">Clay Names</button>
            ${
              hud.showHandCursorControl
                ? `<button class="btn ${hud.handCursorActive ? 'btn-hand-active' : 'btn-secondary'} btn-welcome-main" id="btn-welcome-hand-cursor">
                     ${hud.handCursorActive ? 'Hand Cursor: ON' : 'Hand Cursor'}
                   </button>`
                : ''
            }
            ${
              hud.vrSupported
                ? '<button class="btn btn-vr btn-welcome-main" id="btn-welcome-vr">Enter Meta Quest VR</button>'
                : ''
            }
          </div>
          <div class="welcome-secondary-grid">
            <button class="btn btn-secondary" id="btn-open-tutorial">Interactive Guide</button>
            <button class="btn btn-secondary" id="btn-open-gallery">Gallery (${galleryCount})</button>
            <button class="btn btn-secondary" id="btn-open-settings">Settings</button>
          </div>
        </div>
        <div class="control-hint-line">
          <span>Pottery Wheel &amp; 3D Clay Names · Quest Hand Tracking · Local MediaPipe Hands${hud.showHandCursorControl ? ' · Pinch UI Cursor' : ''} · Mouse Fallback</span>
        </div>
      </div>
    `;
    this.root.appendChild(el);

    el.querySelector('#btn-enter-studio')?.addEventListener('click', () =>
      this.actions.onNavigate('start-studio')
    );
    el.querySelector('#btn-open-names')?.addEventListener('click', () =>
      this.actions.onOpenNameStudio()
    );
    el.querySelector('#btn-welcome-hand-cursor')?.addEventListener('click', () =>
      this.actions.onToggleHandCursor()
    );
    el.querySelector('#btn-open-tutorial')?.addEventListener('click', () =>
      this.actions.onNavigate('tutorial')
    );
    el.querySelector('#btn-open-gallery')?.addEventListener('click', () =>
      this.actions.onNavigate('gallery')
    );
    el.querySelector('#btn-open-settings')?.addEventListener('click', () =>
      this.actions.onNavigate('settings')
    );
    el.querySelector('#btn-welcome-vr')?.addEventListener('click', () =>
      this.actions.onToggleVR()
    );
  }

  private renderVesselThumbHTML(
    key: VesselThumbnailKey,
    alt: string,
    className: string
  ): string {
    const src = this.getThumbnail(key);
    if (src) {
      return `<img class="${className}" src="${src}" alt="${alt}" referrerpolicy="no-referrer" />`;
    }
    return `
      <div class="${className} thumb-svg-fallback" aria-label="${alt}">
        <svg viewBox="0 0 80 60" width="56" height="42" aria-hidden="true">
          <path d="M24 14 C24 22, 18 28, 19 39 C20 47, 27 51, 40 51 C53 51, 60 47, 61 39 C62 28, 56 22, 56 14 Z" fill="#b84f33" opacity="0.85"/>
          <ellipse cx="40" cy="14" rx="16" ry="3.5" fill="#d99a74"/>
        </svg>
      </div>
    `;
  }

  private renderStartStudio(hud: StudioHUDState): void {
    const el = document.createElement('div');
    el.className = 'screen screen-modal';

    const shortLessonNames: Record<GuidedLessonId, string> = {
      cup: 'Tea Cup',
      bowl: 'Open Bowl',
      vase: 'Tall Vase',
    };
    const shortChallengeNames: Record<string, string> = {
      'classic-cup': 'Tea Cup',
      'tea-bowl': 'Matcha Bowl',
      'tapered-vase': 'Willow Vase',
      'lantern-amphora': 'Amphora',
    };

    el.innerHTML = `
      <div class="panel-card panel-wide panel-start-studio">
        <div class="panel-header panel-header-compact">
          <div>
            <p class="eyebrow">SELECT VESSEL & INPUT</p>
            <h2>Pottery Studio</h2>
          </div>
          <div class="cta-row">
            ${
              hud.showHandCursorControl
                ? `<button class="btn btn-small ${hud.handCursorActive ? 'btn-hand-active' : 'btn-secondary'}" id="btn-hud-hand-cursor">
                     ${hud.handCursorActive ? 'Hand Cursor: ON' : 'Hand Cursor'}
                   </button>`
                : ''
            }
            <button class="btn btn-small btn-ghost" id="btn-back-welcome">Back</button>
          </div>
        </div>

        <div class="mode-grid">
          <div class="mode-card mode-card-visual" data-mode="free">
            <div class="mode-thumb-frame">
              ${this.renderVesselThumbHTML('free', 'Raw clay mound on wooden plinth', 'mode-thumb-img')}
            </div>
            <div class="mode-card-head">
              <h3>Free Wheel</h3>
              <span class="mode-kicker">Open Throwing</span>
            </div>
            <button class="btn btn-primary btn-small mode-open-btn" id="btn-open-free" data-open-mode="free">
              Open Free Wheel
            </button>
          </div>

          <div class="mode-card mode-card-visual" data-mode="guided">
            <div class="mode-thumb-frame" id="guided-hero-thumb">
              ${this.renderVesselThumbHTML(hud.lessonId, 'Selected guided vessel', 'mode-thumb-img')}
            </div>
            <div class="mode-card-head">
              <h3>Guided Lessons</h3>
              <span class="mode-kicker">Step-by-Step</span>
            </div>
            <div class="preset-thumb-grid" id="guided-choices">
              ${GUIDED_LESSONS.map(
                (l) => `
                  <button class="preset-thumb-btn ${hud.lessonId === l.id ? 'preset-thumb-active' : ''}" data-lesson="${l.id}">
                    ${this.renderVesselThumbHTML(l.id, l.title, 'preset-mini-img')}
                    <span>${shortLessonNames[l.id]}</span>
                  </button>
                `
              ).join('')}
            </div>
            <button class="btn btn-primary btn-small mode-open-btn" id="btn-open-guided" data-open-mode="guided">
              Open ${shortLessonNames[hud.lessonId]}
            </button>
          </div>

          <div class="mode-card mode-card-visual" data-mode="challenge">
            <div class="mode-thumb-frame" id="challenge-hero-thumb">
              ${this.renderVesselThumbHTML(hud.challengeId as VesselThumbnailKey, 'Selected challenge silhouette', 'mode-thumb-img')}
            </div>
            <div class="mode-card-head">
              <h3>Shape Match</h3>
              <span class="mode-kicker">3D Silhouette</span>
            </div>
            <div class="preset-thumb-grid preset-thumb-grid-4" id="challenge-choices">
              ${CHALLENGE_PRESETS.map(
                (p) => `
                  <button class="preset-thumb-btn ${hud.challengeId === p.id ? 'preset-thumb-active' : ''}" data-challenge="${p.id}">
                    ${this.renderVesselThumbHTML(p.id as VesselThumbnailKey, p.name, 'preset-mini-img')}
                    <span>${shortChallengeNames[p.id] ?? p.name}</span>
                  </button>
                `
              ).join('')}
            </div>
            <button class="btn btn-primary btn-small mode-open-btn" id="btn-open-challenge" data-open-mode="challenge">
              Open ${shortChallengeNames[hud.challengeId] ?? 'Challenge'}
            </button>
          </div>
        </div>

        <div class="name-mode-banner">
          <div>
            <p class="eyebrow">NEW HAND CRAFT</p>
            <h3>3D Clay Names &amp; Signs</h3>
            <p class="mouse-tip">Type any name or word, pick tablet / oval / banner / heart clay, and sculpt or paint it easily with your hands.</p>
          </div>
          <div class="cta-row">
            <button class="btn btn-primary btn-small" id="btn-start-names-webcam">Clay Names (Hands)</button>
            <button class="btn btn-secondary btn-small" id="btn-start-names-mouse">Clay Names (Mouse)</button>
          </div>
        </div>

        <div class="input-choice-bar">
          ${
            hud.vrSupported
              ? '<button class="btn btn-vr" id="btn-start-vr">Enter Meta Quest VR</button>'
              : ''
          }
          <button class="btn btn-primary" id="btn-start-webcam">Webcam Hands</button>
          <button class="btn btn-secondary" id="btn-start-mouse">Mouse & Keyboard</button>
        </div>
      </div>
    `;
    this.root.appendChild(el);

    let chosenMode: GameMode = hud.mode;
    let chosenLesson: GuidedLessonId = hud.lessonId;
    let chosenChallenge = hud.challengeId;

    const syncCards = () => {
      el.querySelectorAll('.mode-card').forEach((card) => {
        const m = (card as HTMLElement).dataset.mode;
        card.classList.toggle('mode-card-active', m === chosenMode);
      });
      this.actions.onSelectModeSelection(chosenMode, chosenLesson, chosenChallenge);
    };
    syncCards();

    el.querySelectorAll('.mode-card').forEach((card) => {
      card.addEventListener('click', () => {
        chosenMode = ((card as HTMLElement).dataset.mode as GameMode) ?? 'free';
        syncCards();
      });
    });

    el.querySelectorAll('[data-lesson]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        chosenMode = 'guided';
        chosenLesson = (btn as HTMLElement).dataset.lesson as GuidedLessonId;
        el.querySelectorAll('[data-lesson]').forEach((b) =>
          b.classList.remove('preset-thumb-active')
        );
        btn.classList.add('preset-thumb-active');
        const hero = el.querySelector('#guided-hero-thumb');
        if (hero) {
          hero.innerHTML = this.renderVesselThumbHTML(
            chosenLesson,
            'Selected guided vessel',
            'mode-thumb-img'
          );
        }
        const openBtn = el.querySelector('#btn-open-guided');
        if (openBtn) {
          openBtn.textContent = `Open ${shortLessonNames[chosenLesson]}`;
        }
        syncCards();
      });
    });

    el.querySelectorAll('[data-challenge]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        chosenMode = 'challenge';
        chosenChallenge = (btn as HTMLElement).dataset.challenge ?? 'tapered-vase';
        el.querySelectorAll('[data-challenge]').forEach((b) =>
          b.classList.remove('preset-thumb-active')
        );
        btn.classList.add('preset-thumb-active');
        const hero = el.querySelector('#challenge-hero-thumb');
        if (hero) {
          hero.innerHTML = this.renderVesselThumbHTML(
            chosenChallenge as VesselThumbnailKey,
            'Selected challenge silhouette',
            'mode-thumb-img'
          );
        }
        const openBtn = el.querySelector('#btn-open-challenge');
        if (openBtn) {
          openBtn.textContent = `Open ${shortChallengeNames[chosenChallenge] ?? 'Challenge'}`;
        }
        syncCards();
      });
    });

    el.querySelectorAll('[data-open-mode]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const openMode =
          ((btn as HTMLElement).dataset.openMode as GameMode) ?? chosenMode;
        chosenMode = openMode;
        const preferredInput: InputMode =
          hud.handCursorActive || hud.inputMode === 'webcam' ? 'webcam' : 'mouse';
        void this.actions.onStartMode(
          openMode,
          preferredInput,
          chosenLesson,
          chosenChallenge
        );
      });
    });

    el.querySelector('#btn-back-welcome')?.addEventListener('click', () =>
      this.actions.onNavigate('welcome')
    );
    el.querySelector('#btn-start-names-webcam')?.addEventListener('click', () =>
      this.actions.onOpenNameStudio('webcam')
    );
    el.querySelector('#btn-start-names-mouse')?.addEventListener('click', () =>
      this.actions.onOpenNameStudio('mouse')
    );
    el.querySelector('#btn-start-vr')?.addEventListener('click', () => {
      void this.actions.onStartMode(chosenMode, 'mouse', chosenLesson, chosenChallenge);
      this.actions.onToggleVR();
    });
    el.querySelector('#btn-hud-hand-cursor')?.addEventListener('click', () =>
      this.actions.onToggleHandCursor()
    );
    el.querySelector('#btn-start-webcam')?.addEventListener('click', () =>
      this.actions.onStartMode(chosenMode, 'webcam', chosenLesson, chosenChallenge)
    );
    el.querySelector('#btn-start-mouse')?.addEventListener('click', () =>
      this.actions.onStartMode(chosenMode, 'mouse', chosenLesson, chosenChallenge)
    );
  }

  private renderWebcamPermission(hud: StudioHUDState): void {
    const hasError = hud.trackingError !== 'none';
    const el = document.createElement('div');
    el.className = 'screen screen-modal';
    el.innerHTML = `
      <div class="panel-card">
        <p class="eyebrow">CAMERA PERMISSION</p>
        <h2>Enable Real Hand Tracking</h2>
        <p class="body-copy">
          CLAY HANDS uses MediaPipe Hand Landmarker locally in your browser to track your palms, fingers, and pinches through your webcam. No video is recorded or uploaded anywhere.
        </p>
        ${
          hasError
            ? `<div class="alert-box">
                 <strong>Camera Issue:</strong> ${hud.trackingErrorMsg}
               </div>`
            : ''
        }
        <div class="cta-row">
          <button class="btn btn-primary" id="btn-allow-cam">
            ${hasError ? 'Retry Webcam Access' : 'Allow Webcam & Continue'}
          </button>
          <button class="btn btn-secondary" id="btn-fallback-mouse">Use Mouse & Keyboard Instead</button>
          <button class="btn btn-ghost" id="btn-perm-back">Back</button>
        </div>
      </div>
    `;
    this.root.appendChild(el);

    const allowBtn = el.querySelector('#btn-allow-cam') as HTMLButtonElement | null;
    allowBtn?.addEventListener('click', async () => {
      if (allowBtn) {
        allowBtn.disabled = true;
        allowBtn.textContent = 'Starting Camera & Model…';
      }
      await this.actions.onRequestWebcam();
    });
    el.querySelector('#btn-fallback-mouse')?.addEventListener('click', () =>
      this.actions.onUseMouseMode()
    );
    el.querySelector('#btn-perm-back')?.addEventListener('click', () =>
      this.actions.onNavigate('start-studio')
    );
  }

  private renderCalibration(progress?: CalibrationProgress): void {
    const el = document.createElement('div');
    el.className = 'screen screen-modal';
    el.innerHTML = `
      <div class="panel-card panel-cal">
        <div class="panel-header">
          <div>
            <p class="eyebrow" id="cal-step-badge">Step 1 of 3 · Detect Hands</p>
            <h2>Calibrate Your Hands</h2>
          </div>
          <button class="btn btn-ghost" id="btn-cal-mouse">Switch to Mouse</button>
        </div>
        <div class="cal-preview-wrap">
          <canvas id="cal-canvas" width="360" height="240"></canvas>
        </div>
        <p class="cal-msg" id="cal-message">${
          progress?.message ?? 'Show both hands comfortably in front of your webcam.'
        }</p>
        <div class="progress-track">
          <div class="progress-fill" id="cal-progress-fill" style="width: 0%"></div>
        </div>
        <div class="cta-row">
          <button class="btn btn-secondary" id="btn-cal-restart">Restart Calibration</button>
          <button class="btn btn-ghost" id="btn-cal-skip">Skip & Enter Wheel</button>
        </div>
      </div>
    `;
    this.root.appendChild(el);
    this.calCanvas = el.querySelector('#cal-canvas');

    el.querySelector('#btn-cal-restart')?.addEventListener('click', () =>
      this.actions.onRecalibrate()
    );
    el.querySelector('#btn-cal-skip')?.addEventListener('click', () =>
      this.actions.onSkipCalibration()
    );
    el.querySelector('#btn-cal-mouse')?.addEventListener('click', () =>
      this.actions.onUseMouseMode()
    );
  }

  private renderStudioHUD(settings: StudioSettings, hud: StudioHUDState): void {
    const el = document.createElement('div');
    el.className = 'studio-hud';

    const lesson = GUIDED_LESSONS.find((l) => l.id === hud.lessonId);
    const activeLessonStep = lesson
      ? lesson.steps.find((s) => s.stage === hud.stage) ?? lesson.steps[0]
      : null;

    const challenge = CHALLENGE_PRESETS.find(
      (c) => c.id === hud.challengeId
    );

    el.innerHTML = `
      <div class="hud-top-row">
        <div class="hud-corner-card">
          <div class="hud-title-line">
            <span class="studio-badge">CLAY HANDS</span>
            <span id="hud-tracking-badge" class="status-pill status-ok">Ready</span>
          </div>
          <div class="stage-line" id="hud-stage-label">${this.formatStageLabel(hud)}</div>
          <p class="gesture-desc" id="hud-gesture-desc">${hud.gesture.description}</p>
          ${
            hud.mode === 'guided' && activeLessonStep
              ? `<div class="guided-hint-box">
                   <strong>${activeLessonStep.title}:</strong> ${activeLessonStep.instruction}
                 </div>`
              : ''
          }
          ${
            hud.mode === 'challenge' && challenge
              ? `<div class="guided-hint-box">
                   <strong>Target: ${challenge.name}</strong> · <span id="hud-challenge-score" class="tabular">${hud.similarity?.score ?? 0}% match</span>
                 </div>`
              : ''
          }
        </div>

        <div class="hud-top-right">
          ${
            hud.inputMode === 'webcam' && settings.showWebcamPip
              ? `<div class="webcam-pip-card">
                   <canvas id="pip-canvas" width="192" height="144"></canvas>
                 </div>`
              : ''
          }
          <div class="hud-quick-actions">
            ${
              hud.inputMode === 'webcam'
                ? `<button class="btn btn-small btn-secondary" id="hud-recal-btn">Recalibrate</button>`
                : ''
            }
            ${
              hud.vrSupported
                ? `<button class="btn btn-small btn-secondary" id="hud-vr-btn">${hud.inVR ? 'Exit VR' : 'Enter VR'}</button>`
                : ''
            }
            ${
              hud.showHandCursorControl &&
              (hud.handCursorActive || hud.inputMode === 'webcam')
                ? `<button class="btn btn-small ${hud.handCursorActive ? 'btn-hand-active' : 'btn-secondary'}" id="btn-hud-hand-cursor">${hud.handCursorActive ? 'Hand Cursor: ON' : 'Hand Cursor'}</button>`
                : ''
            }
            <button class="btn btn-small btn-secondary" id="hud-tutorial-btn">Gestures</button>
            <button class="btn btn-small btn-secondary" id="hud-settings-btn">Settings</button>
            <button class="btn btn-small btn-ghost" id="hud-exit-btn">Exit</button>
          </div>
        </div>
      </div>

      ${
        this.showCelebrationBanner && hud.personality
          ? `<div class="celebration-banner">
               <p class="eyebrow">VESSEL SHAPED</p>
               <h3>${hud.personality.name}</h3>
               <p>${hud.personality.notes} (${hud.personality.measurements.heightCm} cm tall · ${hud.personality.measurements.maxWidthCm} cm wide)</p>
               ${
                 hud.mode === 'challenge' && hud.similarity
                   ? `<p class="challenge-result">Silhouette Similarity: <strong>${hud.similarity.score}%</strong> — ${hud.similarity.proportionNote}</p>`
                   : ''
               }
               <div class="cta-row">
                 <button class="btn btn-primary" id="btn-go-glaze">Choose Glaze & Fire</button>
                 <button class="btn btn-secondary" id="btn-keep-shaping">Continue Shaping</button>
               </div>
             </div>`
          : ''
      }

      ${
        this.resetConfirmVisible
          ? `<div class="confirm-dialog">
               <h3>Reset Clay?</h3>
               <p>You have shaped this vessel. Resetting will return to a fresh lump of clay.</p>
               <div class="cta-row">
                 <button class="btn btn-danger" id="btn-confirm-reset">Reset Clay</button>
                 <button class="btn btn-secondary" id="btn-cancel-reset">Keep Working</button>
               </div>
             </div>`
          : ''
      }

      <div class="bottom-dock-wrap ${this.dockCollapsed ? 'dock-collapsed' : ''}">
        <button class="dock-toggle-btn" id="btn-toggle-dock">
          ${this.dockCollapsed ? '▴ Show Controls' : '▾ Hide Controls'}
        </button>
        <div class="bottom-dock">
          <div class="dock-group">
            <label class="dock-label" for="hud-wheel-speed">Wheel Speed</label>
            <input id="hud-wheel-speed" type="range" min="0.2" max="2.0" step="0.1" value="${settings.wheelSpeed}" />
            <span class="tabular dock-val">${settings.wheelSpeed.toFixed(1)}x</span>
          </div>

          <div class="dock-group dock-stages">
            ${(['center', 'open', 'shape', 'smooth'] as PotteryStage[])
              .map(
                (st) =>
                  `<button class="chip ${hud.stage === st ? 'chip-active' : ''}" data-stage="${st}">${st}</button>`
              )
              .join('')}
          </div>

          ${
            hud.inputMode === 'mouse'
              ? `<div class="dock-group dock-tools">
                   ${(
                     [
                       ['auto', 'Shape'],
                       ['open', 'Open'],
                       ['pinch', 'Pinch'],
                       ['smooth', 'Smooth'],
                       ['one_side', '1-Side'],
                       ['brush', 'Brush'],
                     ] as Array<[MouseToolMode, string]>
                   )
                     .map(
                       ([id, label]) =>
                         `<button class="chip ${hud.mouseTool === id ? 'chip-active' : ''}" data-mtool="${id}">${label}</button>`
                     )
                     .join('')}
                 </div>`
              : `<div class="dock-group dock-tools">
                   <button class="chip ${hud.mouseTool === 'brush' ? 'chip-active' : ''}" id="btn-webcam-brush">
                     ${hud.mouseTool === 'brush' ? 'Brush: On (Pinch to Paint)' : 'Brush Paint'}
                   </button>
                 </div>`
          }

          <div class="dock-group dock-actions">
            <button class="btn btn-small btn-secondary" id="hud-undo-btn" ${
              hud.canUndo ? '' : 'disabled'
            }>Undo</button>
            <button class="btn btn-small btn-secondary" id="hud-reset-btn">Reset</button>
            <button class="btn btn-small btn-primary" id="hud-finish-btn">Finish Pot</button>
          </div>
        </div>
      </div>

      ${
        hud.mouseTool === 'brush'
          ? `<aside class="brush-side-rail" aria-label="Village brush controls">
               <p class="rail-eyebrow">VILLAGE BRUSH</p>
               ${this.renderBrushToolbarHTML(hud, false)}
             </aside>`
          : ''
      }
    `;

    this.root.appendChild(el);
    this.pipCanvas = el.querySelector('#pip-canvas');

    el.querySelector('#btn-toggle-dock')?.addEventListener('click', () => {
      this.dockCollapsed = !this.dockCollapsed;
      el.querySelector('.bottom-dock-wrap')?.classList.toggle(
        'dock-collapsed',
        this.dockCollapsed
      );
      const toggle = el.querySelector('#btn-toggle-dock');
      if (toggle) {
        toggle.textContent = this.dockCollapsed
          ? '▴ Show Controls'
          : '▾ Hide Controls';
      }
    });

    const speedInput = el.querySelector(
      '#hud-wheel-speed'
    ) as HTMLInputElement | null;
    speedInput?.addEventListener('input', () => {
      const val = parseFloat(speedInput.value);
      const valSpan = el.querySelector('.dock-val');
      if (valSpan) valSpan.textContent = `${val.toFixed(1)}x`;
      this.actions.onWheelSpeedChange(val);
    });

    el.querySelectorAll('[data-stage]').forEach((b) => {
      b.addEventListener('click', () => {
        const st = (b as HTMLElement).dataset.stage as PotteryStage;
        this.actions.onStageJump(st);
      });
    });

    el.querySelectorAll('[data-mtool]').forEach((b) => {
      b.addEventListener('click', () => {
        const tool = (b as HTMLElement).dataset.mtool as MouseToolMode;
        this.actions.onMouseToolChange(tool);
      });
    });

    el.querySelector('#btn-webcam-brush')?.addEventListener('click', () => {
      this.actions.onMouseToolChange(
        hud.mouseTool === 'brush' ? 'auto' : 'brush'
      );
    });

    this.bindBrushToolbarEvents(el);

    el.querySelector('#hud-undo-btn')?.addEventListener('click', () =>
      this.actions.onUndo()
    );
    el.querySelector('#hud-reset-btn')?.addEventListener('click', () =>
      this.actions.onRequestReset()
    );
    el.querySelector('#hud-finish-btn')?.addEventListener('click', () =>
      this.actions.onFinishPot()
    );
    el.querySelector('#hud-recal-btn')?.addEventListener('click', () =>
      this.actions.onRecalibrate()
    );
    el.querySelector('#hud-vr-btn')?.addEventListener('click', () =>
      this.actions.onToggleVR()
    );
    el.querySelector('#btn-hud-hand-cursor')?.addEventListener('click', () =>
      this.actions.onToggleHandCursor()
    );
    el.querySelector('#hud-tutorial-btn')?.addEventListener('click', () =>
      this.actions.onNavigate('tutorial')
    );
    el.querySelector('#hud-settings-btn')?.addEventListener('click', () =>
      this.actions.onNavigate('settings')
    );
    el.querySelector('#hud-exit-btn')?.addEventListener('click', () =>
      this.actions.onNavigate('welcome')
    );

    el.querySelector('#btn-confirm-reset')?.addEventListener('click', () =>
      this.actions.onConfirmReset()
    );
    el.querySelector('#btn-cancel-reset')?.addEventListener('click', () =>
      this.actions.onCancelReset()
    );
    el.querySelector('#btn-go-glaze')?.addEventListener('click', () =>
      this.actions.onNavigate('glaze')
    );
    el.querySelector('#btn-keep-shaping')?.addEventListener('click', () => {
      this.showCelebrationBanner = false;
      this.actions.onStageJump('shape');
    });
  }

  private renderNameStudioScreen(
    settings: StudioSettings,
    hud: StudioHUDState
  ): void {
    const el = document.createElement('div');
    el.className = 'studio-hud';
    const safeNameVal = hud.clayNameText.replace(/"/g, '&quot;');
    const presets = ['CLAY', 'LOVE', 'PEACE', 'HOME', 'STAR', 'SMILE'];
    const shapes: Array<[ClayNamePlaqueShape, string]> = [
      ['tablet', 'Tablet'],
      ['oval', 'Oval'],
      ['ribbon', 'Banner'],
      ['heart', 'Heart'],
    ];
    const tools: Array<[ClayNameTool, string]> = [
      ['sculpt_puff', 'Raise Clay'],
      ['sculpt_carve', 'Carve In'],
      ['sculpt_smooth', 'Smooth'],
      ['stamp_heart', 'Stamp ♥'],
      ['paint', 'Paint Brush'],
    ];

    el.innerHTML = `
      <div class="hud-top-row">
        <div class="hud-corner-card">
          <div class="hud-title-line">
            <span class="studio-badge">CLAY NAMES</span>
            <span id="hud-tracking-badge" class="status-pill ${hud.trackingLost ? 'status-warn' : 'status-ok'}">${
              hud.inputMode === 'webcam'
                ? 'Webcam · Hands Ready'
                : hud.inputMode === 'webxr'
                  ? 'WebXR · Hands Ready'
                  : 'Mouse & Hand Tools'
            }</span>
          </div>
          <h2 class="compact-title">3D Clay Nameplate</h2>
          <p class="gesture-desc" id="hud-gesture-desc">${
            hud.inputMode === 'webcam' || hud.inputMode === 'webxr'
              ? 'Point index finger & pinch plaque to sculpt/paint · Spread hands = Bolder · Raise hands = Deeper 3D.'
              : 'Drag across the clay plaque to sculpt or paint · Switch to Webcam Hands anytime.'
          }</p>
        </div>

        <div class="hud-top-right">
          ${
            hud.inputMode === 'webcam' && settings.showWebcamPip
              ? `<div class="webcam-pip-card">
                   <canvas id="pip-canvas" width="192" height="144"></canvas>
                 </div>`
              : ''
          }
          <div class="hud-quick-actions">
            ${
              hud.inputMode !== 'webcam'
                ? `<button class="btn btn-small btn-primary" id="btn-name-webcam">Use Hand Camera</button>`
                : `<button class="btn btn-small btn-secondary" id="hud-recal-btn">Recalibrate</button>`
            }
            ${
              hud.vrSupported
                ? `<button class="btn btn-small btn-vr" id="hud-vr-btn">${hud.inVR ? 'Exit VR' : 'Enter VR'}</button>`
                : ''
            }
            ${
              hud.showHandCursorControl
                ? `<button class="btn btn-small ${hud.handCursorActive ? 'btn-hand-active' : 'btn-secondary'}" id="btn-hud-hand-cursor">${hud.handCursorActive ? 'Hand Cursor: ON' : 'Hand Cursor'}</button>`
                : ''
            }
            <button class="btn btn-small btn-secondary" id="btn-name-wheel">Pottery Wheel</button>
            <button class="btn btn-small btn-secondary" id="btn-name-gal">Gallery</button>
            <button class="btn btn-small btn-ghost" id="hud-exit-btn">Home</button>
          </div>
        </div>
      </div>

      ${
        hud.clayNameTool === 'paint'
          ? `<aside class="brush-side-rail" aria-label="Clay name paint brush">
               <p class="rail-eyebrow">VILLAGE BRUSH</p>
               ${this.renderBrushToolbarHTML(hud, false)}
             </aside>`
          : ''
      }

      <div class="bottom-dock-wrap ${this.dockCollapsed ? 'dock-collapsed' : ''}">
        <button class="dock-toggle-btn" id="btn-toggle-dock">
          ${this.dockCollapsed ? '▴ Show Name Controls' : '▾ Hide Name Controls'}
        </button>
        <div class="bottom-dock bottom-dock-names">
          <div class="name-dock-row">
            <div class="name-input-row">
              <label class="dock-label" for="name-text-input">Name</label>
              <input id="name-text-input" class="text-input name-word-input" type="text" maxlength="16" value="${safeNameVal}" placeholder="Type name..." />
            </div>
            <div class="name-preset-chips">
              ${presets
                .map(
                  (w) =>
                    `<button class="chip ${hud.clayNameText.toUpperCase() === w ? 'chip-active' : ''}" data-name-word="${w}">${w}</button>`
                )
                .join('')}
            </div>
            <div class="name-shape-chips">
              ${shapes
                .map(
                  ([sId, label]) =>
                    `<button class="chip ${hud.clayNameShape === sId ? 'chip-active' : ''}" data-name-shape="${sId}">${label}</button>`
                )
                .join('')}
            </div>
          </div>

          <div class="name-dock-row">
            <div class="dock-tools">
              ${tools
                .map(
                  ([tId, label]) =>
                    `<button class="chip ${hud.clayNameTool === tId ? 'chip-active' : ''}" data-name-tool="${tId}">${label}</button>`
                )
                .join('')}
            </div>
            <div class="dock-group">
              <label class="dock-label" for="name-relief-slider">Relief</label>
              <input id="name-relief-slider" type="range" min="8" max="34" step="1" value="${Math.round(hud.clayNameReliefMm)}" />
              <span id="name-relief-val" class="tabular dock-val">${Math.round(hud.clayNameReliefMm)} mm</span>
            </div>
            <div class="dock-group">
              <label class="dock-label" for="name-bold-slider">Bold</label>
              <input id="name-bold-slider" type="range" min="0.65" max="1.55" step="0.05" value="${hud.clayNameBoldness.toFixed(2)}" />
              <span id="name-bold-val" class="tabular dock-val">${hud.clayNameBoldness.toFixed(2)}x</span>
            </div>
            <div class="dock-actions">
              <button class="btn btn-small btn-secondary" id="name-undo-btn" ${hud.canUndoClayName ? '' : 'disabled'}>Undo</button>
              <button class="btn btn-small btn-secondary" id="name-reset-btn">Reset</button>
              <button class="btn btn-small btn-secondary" id="name-save-btn">Save Now</button>
              <button class="btn btn-small btn-primary" id="name-glaze-btn">Glaze & Fire</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.root.appendChild(el);
    this.pipCanvas = el.querySelector('#pip-canvas');

    el.querySelector('#btn-toggle-dock')?.addEventListener('click', () => {
      this.dockCollapsed = !this.dockCollapsed;
      el.querySelector('.bottom-dock-wrap')?.classList.toggle(
        'dock-collapsed',
        this.dockCollapsed
      );
      const toggle = el.querySelector('#btn-toggle-dock');
      if (toggle) {
        toggle.textContent = this.dockCollapsed
          ? '▴ Show Name Controls'
          : '▾ Hide Name Controls';
      }
    });

    const nameInput = el.querySelector('#name-text-input') as HTMLInputElement | null;
    nameInput?.addEventListener('input', () => {
      this.actions.onSetClayNameText(nameInput.value);
      el.querySelectorAll('[data-name-word]').forEach((b) => {
        const w = (b as HTMLElement).dataset.nameWord ?? '';
        b.classList.toggle('chip-active', nameInput.value.trim().toUpperCase() === w);
      });
    });

    el.querySelectorAll('[data-name-word]').forEach((b) => {
      b.addEventListener('click', () => {
        const word = (b as HTMLElement).dataset.nameWord ?? 'CLAY';
        if (nameInput) nameInput.value = word;
        this.actions.onSetClayNameText(word);
        el.querySelectorAll('[data-name-word]').forEach((btn) =>
          btn.classList.toggle('chip-active', btn === b)
        );
      });
    });

    el.querySelectorAll('[data-name-shape]').forEach((b) => {
      b.addEventListener('click', () => {
        const shape = (b as HTMLElement).dataset.nameShape as ClayNamePlaqueShape;
        if (shape) this.actions.onSetClayNameShape(shape);
      });
    });

    el.querySelectorAll('[data-name-tool]').forEach((b) => {
      b.addEventListener('click', () => {
        const tool = (b as HTMLElement).dataset.nameTool as ClayNameTool;
        if (tool) this.actions.onSetClayNameTool(tool);
      });
    });

    const reliefSlider = el.querySelector('#name-relief-slider') as HTMLInputElement | null;
    reliefSlider?.addEventListener('input', () => {
      const mm = parseFloat(reliefSlider.value);
      const lbl = el.querySelector('#name-relief-val');
      if (lbl) lbl.textContent = `${Math.round(mm)} mm`;
      this.actions.onSetClayNameRelief(mm / 1000);
    });

    const boldSlider = el.querySelector('#name-bold-slider') as HTMLInputElement | null;
    boldSlider?.addEventListener('input', () => {
      const bold = parseFloat(boldSlider.value);
      const lbl = el.querySelector('#name-bold-val');
      if (lbl) lbl.textContent = `${bold.toFixed(2)}x`;
      this.actions.onSetClayNameBoldness(bold);
    });

    this.bindBrushToolbarEvents(el);

    el.querySelector('#name-undo-btn')?.addEventListener('click', () =>
      this.actions.onUndoClayName()
    );
    el.querySelector('#name-reset-btn')?.addEventListener('click', () =>
      this.actions.onResetClayName()
    );
    el.querySelector('#name-save-btn')?.addEventListener('click', () =>
      this.actions.onFinishClayName(false)
    );
    el.querySelector('#name-glaze-btn')?.addEventListener('click', () =>
      this.actions.onFinishClayName(true)
    );
    el.querySelector('#btn-name-webcam')?.addEventListener('click', () => {
      void this.actions.onRequestWebcam();
    });
    el.querySelector('#hud-recal-btn')?.addEventListener('click', () =>
      this.actions.onRecalibrate()
    );
    el.querySelector('#hud-vr-btn')?.addEventListener('click', () =>
      this.actions.onToggleVR()
    );
    el.querySelector('#btn-hud-hand-cursor')?.addEventListener('click', () =>
      this.actions.onToggleHandCursor()
    );
    el.querySelector('#btn-name-wheel')?.addEventListener('click', () =>
      this.actions.onNavigate('start-studio')
    );
    el.querySelector('#btn-name-gal')?.addEventListener('click', () =>
      this.actions.onNavigate('gallery')
    );
    el.querySelector('#hud-exit-btn')?.addEventListener('click', () =>
      this.actions.onNavigate('welcome')
    );
  }

  private renderBrushToolbarHTML(
    hud: StudioHUDState,
    includeUndoButton: boolean
  ): string {
    return `
      <div class="brush-toolbar">
        <div class="pigment-row" role="group" aria-label="Village brush pigments">
          ${VILLAGE_PIGMENTS.map(
            (c) => `
              <button
                class="pigment-dot ${!hud.eraserMode && hud.brushColorId === c.id ? 'pigment-dot-active' : ''}"
                data-brush-color="${c.id}"
                title="${c.name}"
                aria-label="${c.name}"
                style="background: ${c.hex}"
              ></button>
            `
          ).join('')}
        </div>
        <div class="brush-meta-row">
          ${(
            [
              ['fine', 'Fine'],
              ['medium', 'Med'],
              ['broad', 'Broad'],
            ] as Array<[BrushSizePreset, string]>
          )
            .map(
              ([sz, label]) =>
                `<button class="chip ${hud.brushSize === sz ? 'chip-active' : ''}" data-brush-size="${sz}">${label}</button>`
            )
            .join('')}
          <button class="chip ${hud.eraserMode ? 'chip-active' : ''}" id="btn-brush-eraser">Eraser</button>
          ${
            includeUndoButton
              ? `<button class="chip" id="btn-paint-undo" ${hud.canUndoPaint ? '' : 'disabled'}>Undo Paint</button>`
              : ''
          }
          <button class="chip" id="btn-paint-clear" ${hud.hasPaint ? '' : 'disabled'}>Clear</button>
        </div>
      </div>
    `;
  }

  private bindBrushToolbarEvents(rootEl: HTMLElement): void {
    rootEl.querySelectorAll('[data-brush-color]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.brushColor;
        if (id) this.actions.onSelectBrushColor(id);
      });
    });

    rootEl.querySelectorAll('[data-brush-size]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sz = (btn as HTMLElement).dataset.brushSize as BrushSizePreset;
        if (sz) this.actions.onSelectBrushSize(sz);
      });
    });

    rootEl.querySelector('#btn-brush-eraser')?.addEventListener('click', () =>
      this.actions.onToggleEraser()
    );
    rootEl.querySelector('#btn-paint-undo')?.addEventListener('click', () =>
      this.actions.onUndoPaint()
    );
    rootEl.querySelector('#btn-paint-clear')?.addEventListener('click', () =>
      this.actions.onClearPaint()
    );
  }

  private renderHandDiagramSVG(action: TutorialTargetAction): string {
    const vesselSilhouette = `
      <path d="M56 36 C56 44, 48 52, 49 66 C50 75, 58 80, 70 80 C82 80, 90 75, 91 66 C92 52, 84 44, 84 36 Z"
            fill="rgba(184, 79, 51, 0.24)" stroke="#8b472d" stroke-width="2.2" />
      <ellipse cx="70" cy="36" rx="14" ry="3.2" fill="#d99a74" stroke="#8b472d" stroke-width="1.6" />
    `;
    const leftHand = `
      <path d="M22 68 C17 62, 18 44, 24 41 C28 39, 32 45, 32 54 L33 66 C33 72, 26 73, 22 68 Z"
            fill="#f5d5b8" stroke="#5d3b24" stroke-width="2" />
    `;
    const rightHand = `
      <path d="M118 68 C123 62, 122 44, 116 41 C112 39, 108 45, 108 54 L107 66 C107 72, 114 73, 118 68 Z"
            fill="#f5d5b8" stroke="#5d3b24" stroke-width="2" />
    `;

    switch (action) {
      case 'compress':
        return `
          <svg class="tut-diagram-svg" viewBox="0 0 140 94" aria-hidden="true">
            ${vesselSilhouette}
            <g class="anim-hand-in-left">${leftHand}<path d="M36 55 L46 55 M42 51 L46 55 L42 59" fill="none" stroke="#b84f33" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g>
            <g class="anim-hand-in-right">${rightHand}<path d="M104 55 L94 55 M98 51 L94 55 L98 59" fill="none" stroke="#b84f33" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g>
          </svg>`;
      case 'widen':
        return `
          <svg class="tut-diagram-svg" viewBox="0 0 140 94" aria-hidden="true">
            ${vesselSilhouette}
            <g class="anim-hand-out-left">${leftHand}<path d="M44 55 L34 55 M38 51 L34 55 L38 59" fill="none" stroke="#4d6d43" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g>
            <g class="anim-hand-out-right">${rightHand}<path d="M96 55 L106 55 M102 51 L106 55 L102 59" fill="none" stroke="#4d6d43" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g>
          </svg>`;
      case 'raise':
        return `
          <svg class="tut-diagram-svg" viewBox="0 0 140 94" aria-hidden="true">
            ${vesselSilhouette}
            <g class="anim-hand-up">${leftHand}${rightHand}
              <path d="M38 66 L38 38 M34 43 L38 38 L42 43" fill="none" stroke="#b84f33" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M102 66 L102 38 M98 43 L102 38 L106 43" fill="none" stroke="#b84f33" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
            </g>
          </svg>`;
      case 'open':
        return `
          <svg class="tut-diagram-svg" viewBox="0 0 140 94" aria-hidden="true">
            ${vesselSilhouette}
            <g class="anim-pinch-top">
              <path d="M58 14 C62 10, 68 15, 67 24" fill="none" stroke="#5d3b24" stroke-width="4" stroke-linecap="round"/>
              <path d="M82 14 C78 10, 72 15, 73 24" fill="none" stroke="#5d3b24" stroke-width="4" stroke-linecap="round"/>
              <circle cx="70" cy="26" r="5" fill="#b84f33"/>
              <path d="M70 30 L70 43 M66 39 L70 43 L74 39" fill="none" stroke="#b84f33" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            </g>
          </svg>`;
      case 'brush':
        return `
          <svg class="tut-diagram-svg" viewBox="0 0 140 94" aria-hidden="true">
            ${vesselSilhouette}
            <path d="M53 56 Q70 63 87 56" fill="none" stroke="#1e4976" stroke-width="3.2" stroke-linecap="round"/>
            <g class="anim-brush-sweep">
              <path d="M114 26 L86 52" stroke="#5d3b24" stroke-width="4.5" stroke-linecap="round"/>
              <path d="M86 52 L79 58" stroke="#1e4976" stroke-width="4" stroke-linecap="round"/>
              <circle cx="96" cy="43" r="4" fill="#d99a74" stroke="#5d3b24" stroke-width="1.6"/>
            </g>
          </svg>`;
    }
  }

  private renderTutorial(settings: StudioSettings, hud: StudioHUDState): void {
    const step = this.tutorialManager.getCurrentStep();
    const stepIdx = this.tutorialManager.currentStepIndex;
    const total = INTERACTIVE_TUTORIAL_STEPS.length;
    const doneStep = this.tutorialManager.isStepCompleted(stepIdx);
    const pct = Math.round(hud.tutorialProgress * 100);

    const el = document.createElement('div');
    el.className = 'studio-hud';
    el.innerHTML = `
      <div class="hud-top-row">
        <div class="tutorial-live-card">
          <div class="tut-card-head">
            <div class="tut-step-dots" role="tablist" aria-label="Tutorial steps">
              ${INTERACTIVE_TUTORIAL_STEPS.map((s, idx) => {
                const done = this.tutorialManager.isStepCompleted(idx);
                const active = idx === stepIdx;
                return `<button class="tut-dot ${active ? 'tut-dot-active' : ''} ${done ? 'tut-dot-done' : ''}" data-tut-step="${idx}" title="${s.title}">${done ? '✓' : idx + 1}</button>`;
              }).join('')}
            </div>
            <span id="hud-tracking-badge" class="status-pill ${hud.trackingLost ? 'status-warn' : 'status-ok'}">
              ${
                hud.inputMode === 'webcam'
                  ? 'Webcam Practice'
                  : hud.inputMode === 'webxr'
                    ? 'WebXR Hands'
                    : 'Mouse Practice'
              }
            </span>
          </div>

          <div class="tut-practice-body">
            <div class="tut-diagram-box">
              ${this.renderHandDiagramSVG(step.diagram)}
            </div>
            <div class="tut-info-col">
              <p class="eyebrow">PRACTICE ${stepIdx + 1} / ${total}</p>
              <h2 class="compact-title">${step.title}</h2>
              <p class="tut-cue-line">${
                hud.inputMode === 'mouse' ? step.mouseCue : step.handCue
              }</p>
              <div class="tut-status-row">
                <span id="tut-match-status" class="status-pill ${doneStep || hud.tutorialMatched ? 'status-ok' : 'status-warn'}">
                  ${
                    hud.tutorialFinishedAll
                      ? 'All 5 gestures mastered!'
                      : doneStep
                        ? 'Step complete!'
                        : hud.inputMode === 'mouse'
                          ? step.mouseCue
                          : step.handCue
                  }
                </span>
              </div>
              <div class="progress-track tut-progress-track">
                <div class="progress-fill" id="tut-progress-fill" style="width: ${pct}%"></div>
              </div>
            </div>
          </div>

          <div class="tut-card-foot">
            <button class="btn btn-small btn-secondary" id="btn-tut-prev">Prev</button>
            <button class="btn btn-small btn-secondary" id="btn-tut-next">Next</button>
            <button class="btn btn-small btn-primary" id="btn-tut-enter-studio">
              ${hud.tutorialFinishedAll ? 'Start Throwing' : 'Enter Studio'}
            </button>
          </div>
        </div>

        <div class="hud-top-right">
          ${
            hud.inputMode === 'webcam' && settings.showWebcamPip
              ? `<div class="webcam-pip-card">
                   <canvas id="pip-canvas" width="192" height="144"></canvas>
                 </div>`
              : ''
          }
          <div class="hud-quick-actions">
            ${
              hud.inputMode === 'mouse'
                ? '<button class="btn btn-small btn-primary" id="btn-tut-webcam">Use Webcam Hands</button>'
                : '<button class="btn btn-small btn-secondary" id="hud-recal-btn">Recalibrate</button>'
            }
            ${
              hud.vrSupported
                ? `<button class="btn btn-small btn-vr" id="hud-vr-btn">${hud.inVR ? 'Exit VR' : 'Enter VR'}</button>`
                : ''
            }
            ${
              hud.showHandCursorControl
                ? `<button class="btn btn-small ${hud.handCursorActive ? 'btn-hand-active' : 'btn-secondary'}" id="btn-hud-hand-cursor">
                     ${hud.handCursorActive ? 'Hand Cursor: ON' : 'Hand Cursor'}
                   </button>`
                : ''
            }
            <button class="btn btn-small btn-ghost" id="btn-tut-close">Back</button>
          </div>
        </div>
      </div>
    `;
    this.root.appendChild(el);
    this.pipCanvas = el.querySelector('#pip-canvas');

    el.querySelectorAll('[data-tut-step]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number((btn as HTMLElement).dataset.tutStep ?? 0);
        this.actions.onTutorialSelectStep(idx);
      });
    });

    el.querySelector('#btn-tut-prev')?.addEventListener('click', () =>
      this.actions.onTutorialPrev()
    );
    el.querySelector('#btn-tut-next')?.addEventListener('click', () =>
      this.actions.onTutorialNext()
    );
    el.querySelector('#btn-tut-enter-studio')?.addEventListener('click', () =>
      this.actions.onNavigate('studio')
    );
    el.querySelector('#btn-tut-webcam')?.addEventListener('click', () =>
      void this.actions.onEnableWebcamFromTutorial()
    );
    el.querySelector('#hud-recal-btn')?.addEventListener('click', () =>
      this.actions.onRecalibrate()
    );
    el.querySelector('#hud-vr-btn')?.addEventListener('click', () =>
      this.actions.onToggleVR()
    );
    el.querySelector('#btn-hud-hand-cursor')?.addEventListener('click', () =>
      this.actions.onToggleHandCursor()
    );
    el.querySelector('#btn-tut-close')?.addEventListener('click', () =>
      this.actions.onCloseModal()
    );
  }

  private renderGlazeScreen(
    settings: StudioSettings,
    hud: StudioHUDState
  ): void {
    const personality = hud.personality;
    if (!this.customPotName && personality) {
      this.customPotName = personality.name;
    }

    const initialDesc =
      hud.inputMode === 'webcam' || hud.inputMode === 'webxr'
        ? hud.glazePaintMode
          ? 'Aim with your index finger — pinch thumb & index to brush paint.'
          : 'Orbit View — drag to inspect, or switch to Paint Brush.'
        : hud.glazePaintMode
          ? `${personality?.archetype ?? 'Handcrafted Vessel'} · Drag pot to brush paint · Drag background to rotate`
          : `${personality?.archetype ?? 'Handcrafted Vessel'} · Drag anywhere to rotate and inspect`;

    const el = document.createElement('div');
    el.className = 'studio-hud';
    el.innerHTML = `
      <div class="hud-top-row">
        <div class="hud-corner-card">
          <div class="hud-title-line">
            <p class="eyebrow">VILLAGE BRUSH & GLAZE</p>
            <span id="hud-tracking-badge" class="status-pill ${hud.trackingLost ? 'status-warn' : 'status-ok'}">${
              hud.inputMode === 'webcam'
                ? 'Webcam · Brush Ready'
                : hud.inputMode === 'webxr'
                  ? 'WebXR · Brush Ready'
                  : 'Mouse & Keyboard'
            }</span>
          </div>
          <h2 class="compact-title">${personality?.name ?? 'Studio Vessel'}</h2>
          <p class="gesture-desc" id="hud-gesture-desc">${initialDesc}</p>
          ${
            personality
              ? `<div class="spec-grid tabular">
                   <span>Height: ${personality.measurements.heightCm} cm</span>
                   <span>Width: ${personality.measurements.maxWidthCm} cm</span>
                   <span>Neck: ${personality.measurements.neckWidthCm} cm</span>
                   <span>Rim: ${personality.measurements.openingWidthCm} cm</span>
                 </div>`
              : ''
          }
          ${
            hud.similarity && hud.mode === 'challenge'
              ? `<div class="guided-hint-box">Challenge Match: <strong>${hud.similarity.score}%</strong> — ${hud.similarity.proportionNote}</div>`
              : ''
          }
        </div>
        <div class="hud-top-right">
          ${
            hud.inputMode === 'webcam' && settings.showWebcamPip
              ? `<div class="webcam-pip-card">
                   <canvas id="pip-canvas" width="192" height="144"></canvas>
                 </div>`
              : ''
          }
          <div class="hud-quick-actions">
            ${
              hud.inputMode === 'webcam'
                ? `<button class="btn btn-small btn-secondary" id="hud-recal-btn">Recalibrate</button>`
                : ''
            }
            ${
              hud.vrSupported
                ? `<button class="btn btn-small btn-vr" id="hud-vr-btn">${hud.inVR ? 'Exit VR' : 'Enter VR'}</button>`
                : ''
            }
            ${
              hud.showHandCursorControl
                ? `<button class="btn btn-small ${hud.handCursorActive ? 'btn-hand-active' : 'btn-secondary'}" id="btn-hud-hand-cursor">
                     ${hud.handCursorActive ? 'Hand Cursor: ON' : 'Hand Cursor'}
                   </button>`
                : ''
            }
            <button class="btn btn-small btn-secondary" id="btn-glaze-back">${
              hud.activeCreationKind === 'name' ? 'Back to Name' : 'Back to Wheel'
            }</button>
          </div>
        </div>
      </div>

      <aside class="brush-side-rail" aria-label="Village brush and view controls">
        <div class="rail-mode-row">
          <button class="chip ${hud.glazePaintMode ? 'chip-active' : ''}" id="btn-glaze-mode-paint">Paint Brush</button>
          <button class="chip ${!hud.glazePaintMode ? 'chip-active' : ''}" id="btn-glaze-mode-orbit">Orbit</button>
          <button class="chip ${hud.glazeSpinEnabled ? 'chip-active' : ''}" id="btn-glaze-spin">
            ${hud.glazeSpinEnabled ? 'Wheel: Spin' : 'Wheel: Still'}
          </button>
        </div>
        ${this.renderBrushToolbarHTML(hud, true)}
      </aside>

      <div class="bottom-dock-wrap ${this.dockCollapsed ? 'dock-collapsed' : ''}">
        <button class="dock-toggle-btn" id="btn-toggle-dock">
          ${this.dockCollapsed ? '▴ Show Glazes' : '▾ Hide Glazes'}
        </button>
        <div class="bottom-dock bottom-dock-glaze">
          <div class="glaze-swatch-row">
            ${GLAZE_CATALOG.map(
              (g) => `
                <button class="glaze-swatch ${hud.selectedGlazeId === g.id ? 'glaze-swatch-active' : ''}" data-glaze="${g.id}" title="${g.name} (${g.finishLabel})">
                  <span class="swatch-dot" style="background: linear-gradient(135deg, ${g.color}, ${g.secondaryColor})"></span>
                  <span class="swatch-name">${g.name}</span>
                </button>
              `
            ).join('')}
          </div>
          <div class="dock-actions glaze-fire-action">
            <button class="btn btn-small btn-primary" id="btn-fire-kiln">Fire in Magical Kiln</button>
          </div>
        </div>
      </div>
    `;
    this.root.appendChild(el);
    this.pipCanvas = el.querySelector('#pip-canvas');

    el.querySelector('#btn-toggle-dock')?.addEventListener('click', () => {
      this.dockCollapsed = !this.dockCollapsed;
      el.querySelector('.bottom-dock-wrap')?.classList.toggle(
        'dock-collapsed',
        this.dockCollapsed
      );
      const toggle = el.querySelector('#btn-toggle-dock');
      if (toggle) {
        toggle.textContent = this.dockCollapsed
          ? '▴ Show Glazes'
          : '▾ Hide Glazes';
      }
    });

    this.bindBrushToolbarEvents(el);
    el.querySelector('#btn-glaze-mode-paint')?.addEventListener('click', () =>
      this.actions.onToggleGlazePaintMode(true)
    );
    el.querySelector('#btn-glaze-mode-orbit')?.addEventListener('click', () =>
      this.actions.onToggleGlazePaintMode(false)
    );
    el.querySelector('#btn-glaze-spin')?.addEventListener('click', () =>
      this.actions.onToggleGlazeSpin()
    );
    el.querySelector('#hud-recal-btn')?.addEventListener('click', () =>
      this.actions.onRecalibrate()
    );
    el.querySelectorAll('[data-glaze]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.glaze ?? 'ocean-blue';
        this.actions.onSelectGlaze(id);
      });
    });
    el.querySelector('#btn-glaze-back')?.addEventListener('click', () =>
      this.actions.onNavigate(
        hud.activeCreationKind === 'name' ? 'name-studio' : 'studio'
      )
    );
    el.querySelector('#hud-vr-btn')?.addEventListener('click', () =>
      this.actions.onToggleVR()
    );
    el.querySelector('#btn-hud-hand-cursor')?.addEventListener('click', () =>
      this.actions.onToggleHandCursor()
    );
    el.querySelector('#btn-fire-kiln')?.addEventListener('click', () =>
      this.actions.onStartKiln()
    );
  }

  private renderKilnScreen(hud: StudioHUDState): void {
    const el = document.createElement('div');
    el.className = 'studio-hud';
    const done = hud.kilnFinished;
    const defaultName =
      hud.activeCreationKind === 'name'
        ? `${hud.clayNameText.trim() || 'Clay'} Nameplate`
        : this.customPotName || hud.personality?.name || 'Studio Vessel';

    el.innerHTML = `
      <div class="hud-top-row">
        <div class="hud-corner-card">
          <p class="eyebrow">VILLAGE BRICK KILN</p>
          <div class="kiln-head-line">
            <h2 class="compact-title" id="kiln-caption">${hud.kilnStatus.caption}</h2>
            <span class="status-pill status-ok tabular" id="kiln-temp">${hud.kilnStatus.temperatureLabel}</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill kiln-fill" id="kiln-bar-fill" style="width: ${Math.round(hud.kilnStatus.progress * 100)}%"></div>
          </div>
        </div>
        <div class="hud-top-right">
          <div class="hud-quick-actions">
            ${
              hud.vrSupported
                ? `<button class="btn btn-small btn-vr" id="hud-vr-btn">${hud.inVR ? 'Exit VR' : 'Enter VR'}</button>`
                : ''
            }
            ${
              hud.showHandCursorControl && hud.handCursorActive
                ? `<button class="btn btn-small btn-hand-active" id="btn-hud-hand-cursor">Hand Cursor: ON</button>`
                : ''
            }
          </div>
        </div>
      </div>

      ${
        done
          ? `<div class="bottom-dock-wrap">
               <div class="bottom-dock bottom-dock-reveal">
                 <div class="reveal-name-group">
                   <label class="dock-label" for="vessel-name-input">${
                     hud.activeCreationKind === 'name' ? 'Nameplate Title' : 'Vessel Name'
                   }</label>
                   <input id="vessel-name-input" class="text-input" type="text" maxlength="40" value="${defaultName}" />
                 </div>
                 <div class="dock-actions">
                   <button class="btn btn-primary" id="btn-save-gal" ${hud.saveStatus.saved ? 'disabled' : ''}>
                     ${hud.saveStatus.saved ? 'Saved to Gallery' : 'Save to Gallery'}
                   </button>
                   <button class="btn btn-secondary" id="btn-export-glb">Export GLB</button>
                   <button class="btn btn-secondary" id="btn-view-gal">Open Gallery</button>
                   <button class="btn btn-ghost" id="btn-new-pot">${
                     hud.activeCreationKind === 'name' ? 'Craft Another Name' : 'Throw Another'
                   }</button>
                 </div>
                 ${
                   hud.saveStatus.message
                     ? `<p class="save-feedback">${hud.saveStatus.message}</p>`
                     : ''
                 }
               </div>
             </div>`
          : ''
      }
    `;
    this.root.appendChild(el);

    const nameInput = el.querySelector(
      '#vessel-name-input'
    ) as HTMLInputElement | null;
    nameInput?.addEventListener('input', () => {
      this.customPotName = nameInput.value;
    });

    el.querySelector('#btn-save-gal')?.addEventListener('click', () =>
      this.actions.onSaveToGallery(nameInput?.value || defaultName)
    );
    el.querySelector('#btn-export-glb')?.addEventListener('click', () =>
      this.actions.onExportGLB()
    );
    el.querySelector('#btn-view-gal')?.addEventListener('click', () =>
      this.actions.onNavigate('gallery')
    );
    el.querySelector('#hud-vr-btn')?.addEventListener('click', () =>
      this.actions.onToggleVR()
    );
    el.querySelector('#btn-hud-hand-cursor')?.addEventListener('click', () =>
      this.actions.onToggleHandCursor()
    );
    el.querySelector('#btn-new-pot')?.addEventListener('click', () => {
      this.customPotName = '';
      this.actions.onCelebrateCreateAnother();
    });
  }

  private renderGalleryScreen(
    items: SavedPotteryItem[],
    selectedId: string | null,
    hud: StudioHUDState
  ): void {
    const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null;
    const smashMode = hud.gallerySmashMode;
    const smashScope = hud.gallerySmashScope;
    const crackedCount = hud.galleryCrackedCount;
    const smashedCount = hud.gallerySmashedCount;
    const totalVessels = Math.max(1, hud.galleryTotalVessels || items.length);
    const isRestoring = hud.galleryIsRestoring;
    const intactCount = Math.max(0, totalVessels - smashedCount);
    const hasDamage = smashedCount > 0 || crackedCount > 0;
    const smashAllDisabled =
      isRestoring ||
      (smashMode && smashScope === 'all' && intactCount === 0);

    let subtitleText = 'Your fired vessels will be preserved here.';
    if (isRestoring) {
      subtitleText =
        'Time Stone active — reversing time to restore cracked & shattered pottery!';
    } else if (smashMode) {
      const targetSummary = hud.galleryFocusedName
        ? hud.galleryFocusedHits >= 1
          ? `Target: ${hud.galleryFocusedName} (Cracked 1/2 — hit once more to shatter!)`
          : `Target: ${hud.galleryFocusedName} (Intact 0/2 — Hit 1 cracks, Hit 2 shatters)`
        : smashedCount > 0 && intactCount === 0
          ? 'Shattered! Press Restore to rewind time, or Exit to delete.'
          : 'Move hand, bat, or pointer onto any pot to focus.';
      const countsSummary = `${crackedCount} cracked · ${smashedCount}/${totalVessels} shattered`;
      subtitleText =
        smashedCount > 0
          ? `${targetSummary} · ${countsSummary} · Restore to keep, or Exit to delete!`
          : hasDamage
            ? `${targetSummary} · ${countsSummary} · Press Restore to rewind time!`
            : smashScope === 'single'
              ? `${targetSummary} · Showing only selected pottery · Swipe, punch, or click!`
              : `${targetSummary} · Showing all ${totalVessels} vessels · Swipe or hit Smash All!`;
    } else if (selected) {
      subtitleText = `${GLAZE_CATALOG.find((g) => g.id === selected.glazeId)?.name ?? selected.glazeId} · ${selected.measurements.heightCm} cm × ${selected.measurements.maxWidthCm} cm · Drag scene to inspect`;
    }

    const el = document.createElement('div');
    el.className = 'studio-hud';
    el.innerHTML = `
      <div class="hud-top-row">
        <div class="hud-corner-card ${isRestoring ? 'hud-card-timestorm' : ''}">
          <p class="eyebrow">${isRestoring ? 'TIME REVERSAL' : smashMode ? (smashScope === 'single' ? 'SMASH BAT · SELECTED POTTERY' : 'SMASH ALL · 2 HITS TO BREAK') : `VILLAGE COLLECTION (${items.length})`}</p>
          <h2 class="compact-title">${smashMode ? (hud.galleryFocusedName ? `Focus: ${hud.galleryFocusedName} (${hud.galleryFocusedHits}/2)` : smashScope === 'all' && totalVessels > 1 ? `All ${totalVessels} Vessels Spaced Safely` : selected?.name ?? 'Pottery Gallery') : selected ? selected.name : 'Pottery Gallery'}</h2>
          <p class="gesture-desc">${subtitleText}</p>
        </div>
        <div class="hud-top-right">
          <div class="hud-quick-actions">
            ${
              hud.vrSupported
                ? `<button class="btn btn-small btn-vr" id="hud-vr-btn">${hud.inVR ? 'Exit VR' : 'Enter VR'}</button>`
                : ''
            }
            ${
              hud.showHandCursorControl
                ? `<button class="btn btn-small ${hud.handCursorActive ? 'btn-hand-active' : 'btn-secondary'}" id="btn-hud-hand-cursor">
                     ${hud.handCursorActive ? 'Hand Cursor: ON' : 'Hand Cursor'}
                   </button>`
                : ''
            }
            <button class="btn btn-small btn-primary" id="btn-gal-new">Create Pottery</button>
            <button class="btn btn-small btn-secondary" id="btn-gal-names">Clay Names</button>
            <button class="btn btn-small btn-ghost" id="btn-gal-home">Home</button>
          </div>
        </div>
      </div>

      <div class="bottom-dock-wrap">
        <div class="bottom-dock bottom-dock-gallery">
          ${
            items.length === 0
              ? '<p class="empty-gallery-msg">No saved pottery yet. Shape and fire your first vessel in the studio!</p>'
              : `<div class="gallery-strip">
                   ${items
                     .map((item) => {
                       const glaze = GLAZE_CATALOG.find(
                         (g) => g.id === item.glazeId
                       );
                       const active = selected?.id === item.id;
                       return `
                         <button class="gallery-chip ${active ? 'gallery-chip-active' : ''}" data-gal-id="${item.id}">
                           <span class="swatch-dot" style="background: ${glaze?.color ?? '#b85d41'}"></span>
                           <span class="gallery-chip-info">
                             <strong>${item.name}</strong>
                             <small>${new Date(item.createdAt).toLocaleDateString()}</small>
                           </span>
                         </button>
                       `;
                     })
                     .join('')}
                 </div>
                 ${
                   selected
                     ? `<div class="gallery-item-actions">
                          <input id="gal-rename-input" class="text-input" type="text" maxlength="40" value="${selected.name}" ${smashMode ? 'disabled' : ''} />
                          <button class="btn btn-small btn-secondary" id="btn-gal-rename" ${smashMode ? 'disabled' : ''}>Rename</button>
                          <button class="btn btn-small btn-secondary" id="btn-gal-glb" ${smashMode ? 'disabled' : ''}>Export GLB</button>
                          <button class="btn btn-small ${smashMode ? 'btn-smash-active' : 'btn-smash'}" id="btn-gal-smash" ${isRestoring ? 'disabled' : ''}>
                            ${smashMode ? (smashedCount > 0 ? `Exit (Delete ${smashedCount})` : 'Exit Bat') : 'Smash (Bat)'}
                          </button>
                          <button class="btn btn-small btn-smash" id="btn-gal-smash-all" ${smashAllDisabled ? 'disabled' : ''}>
                            Smash All (${items.length})
                          </button>
                          ${
                            hasDamage || isRestoring
                              ? `<button class="btn btn-small btn-timestorm" id="btn-gal-restore" ${isRestoring ? 'disabled' : ''}>
                                   ${isRestoring ? 'Reversing Time…' : 'Restore (Time)'}
                                 </button>`
                              : ''
                          }
                          <button class="btn btn-small btn-danger" id="btn-gal-del" ${isRestoring ? 'disabled' : ''}>Delete</button>
                        </div>`
                     : ''
                 }`
          }
        </div>
      </div>
    `;
    this.root.appendChild(el);

    el.querySelectorAll('[data-gal-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.galId;
        if (id) this.actions.onSelectGalleryItem(id);
      });
    });

    el.querySelector('#btn-gal-rename')?.addEventListener('click', () => {
      if (!selected) return;
      const input = el.querySelector(
        '#gal-rename-input'
      ) as HTMLInputElement | null;
      if (input && input.value.trim()) {
        this.actions.onRenameGalleryItem(selected.id, input.value.trim());
      }
    });

    el.querySelector('#btn-gal-glb')?.addEventListener('click', () => {
      if (selected) this.actions.onExportGLB(selected.id);
    });

    el.querySelector('#btn-gal-smash')?.addEventListener('click', () => {
      this.actions.onToggleGallerySmash();
    });

    el.querySelector('#btn-gal-smash-all')?.addEventListener('click', () => {
      this.actions.onSmashAllGallery();
    });

    el.querySelector('#btn-gal-restore')?.addEventListener('click', () => {
      this.actions.onRestoreGallery();
    });

    el.querySelector('#btn-gal-del')?.addEventListener('click', () => {
      if (selected) this.actions.onDeleteGalleryItem(selected.id);
    });

    el.querySelector('#btn-gal-new')?.addEventListener('click', () =>
      this.actions.onNavigate('start-studio')
    );
    el.querySelector('#btn-gal-names')?.addEventListener('click', () =>
      this.actions.onOpenNameStudio()
    );
    el.querySelector('#btn-gal-home')?.addEventListener('click', () =>
      this.actions.onNavigate('welcome')
    );
    el.querySelector('#hud-vr-btn')?.addEventListener('click', () =>
      this.actions.onToggleVR()
    );
    el.querySelector('#btn-hud-hand-cursor')?.addEventListener('click', () =>
      this.actions.onToggleHandCursor()
    );
  }

  private renderSettingsScreen(
    settings: StudioSettings,
    hud: StudioHUDState
  ): void {
    const el = document.createElement('div');
    el.className = 'screen screen-modal';
    el.innerHTML = `
      <div class="panel-card panel-wide">
        <div class="panel-header">
          <div>
            <p class="eyebrow">PREFERENCES & ACCESSIBILITY</p>
            <h2>Studio Settings</h2>
          </div>
          <div class="cta-row">
            ${
              hud.vrSupported
                ? `<button class="btn btn-small btn-vr" id="hud-vr-btn">${hud.inVR ? 'Exit VR' : 'Enter VR'}</button>`
                : ''
            }
            ${
              hud.showHandCursorControl
                ? `<button class="btn btn-small ${hud.handCursorActive ? 'btn-hand-active' : 'btn-secondary'}" id="btn-hud-hand-cursor">
                     ${hud.handCursorActive ? 'Hand Cursor: ON' : 'Hand Cursor'}
                   </button>`
                : ''
            }
            <button class="btn btn-primary" id="btn-set-close">Done</button>
          </div>
        </div>

        <div class="settings-grid">
          <div class="setting-row">
            <label for="set-sens">Hand Sensitivity (<span id="val-sens">${settings.handSensitivity.toFixed(1)}</span>)</label>
            <input id="set-sens" type="range" min="0.5" max="2.0" step="0.1" value="${settings.handSensitivity}" />
          </div>

          <div class="setting-row">
            <label for="set-wheel">Default Wheel Speed (<span id="val-wheel">${settings.wheelSpeed.toFixed(1)}x</span>)</label>
            <input id="set-wheel" type="range" min="0.2" max="2.0" step="0.1" value="${settings.wheelSpeed}" />
          </div>

          <div class="setting-row">
            <label for="set-music">Music Volume (<span id="val-music">${Math.round(settings.musicVolume * 100)}%</span>)</label>
            <input id="set-music" type="range" min="0" max="1" step="0.05" value="${settings.musicVolume}" />
          </div>

          <div class="setting-row">
            <label for="set-sfx">Effects Volume (<span id="val-sfx">${Math.round(settings.sfxVolume * 100)}%</span>)</label>
            <input id="set-sfx" type="range" min="0" max="1" step="0.05" value="${settings.sfxVolume}" />
          </div>

          <div class="setting-row setting-check">
            <label><input id="set-sound" type="checkbox" ${settings.soundEnabled ? 'checked' : ''} /> Enable Studio Sound</label>
          </div>

          <div class="setting-row setting-check">
            <label><input id="set-perf" type="checkbox" ${settings.performanceMode ? 'checked' : ''} /> Performance Mode (15 FPS Hand Tracking)</label>
          </div>

          <div class="setting-row setting-check">
            <label><input id="set-reduced" type="checkbox" ${settings.reducedMotion ? 'checked' : ''} /> Reduced Motion</label>
          </div>

          <div class="setting-row setting-check">
            <label><input id="set-pip" type="checkbox" ${settings.showWebcamPip ? 'checked' : ''} /> Show Small Webcam Preview</label>
          </div>

          <div class="setting-row">
            <label>Dominant Hand</label>
            <div class="sub-choices">
              <button class="chip ${settings.handedness === 'right' ? 'chip-active' : ''}" id="set-hand-r">Right-Handed</button>
              <button class="chip ${settings.handedness === 'left' ? 'chip-active' : ''}" id="set-hand-l">Left-Handed</button>
            </div>
          </div>

          <div class="setting-row">
            <label>WebXR Headset Status</label>
            <p class="mouse-tip">${hud.vrMessage}</p>
          </div>
        </div>

        <div class="cta-row">
          <button class="btn btn-secondary" id="btn-set-recal">Recalibrate Hands</button>
          <button class="btn btn-secondary" id="btn-set-tut">Replay Tutorial</button>
        </div>
      </div>
    `;
    this.root.appendChild(el);

    const bindRange = (
      id: string,
      valId: string,
      fmt: (n: number) => string,
      apply: (n: number) => void
    ) => {
      const inp = el.querySelector(id) as HTMLInputElement | null;
      const lbl = el.querySelector(valId);
      inp?.addEventListener('input', () => {
        const n = parseFloat(inp.value);
        if (lbl) lbl.textContent = fmt(n);
        apply(n);
      });
    };

    bindRange(
      '#set-sens',
      '#val-sens',
      (n) => n.toFixed(1),
      (n) => this.actions.onUpdateSettings({ handSensitivity: n })
    );
    bindRange(
      '#set-wheel',
      '#val-wheel',
      (n) => `${n.toFixed(1)}x`,
      (n) => this.actions.onUpdateSettings({ wheelSpeed: n })
    );
    bindRange(
      '#set-music',
      '#val-music',
      (n) => `${Math.round(n * 100)}%`,
      (n) => this.actions.onUpdateSettings({ musicVolume: n })
    );
    bindRange(
      '#set-sfx',
      '#val-sfx',
      (n) => `${Math.round(n * 100)}%`,
      (n) => this.actions.onUpdateSettings({ sfxVolume: n })
    );

    (el.querySelector('#set-sound') as HTMLInputElement)?.addEventListener(
      'change',
      (e) =>
        this.actions.onUpdateSettings({
          soundEnabled: (e.target as HTMLInputElement).checked,
        })
    );
    (el.querySelector('#set-perf') as HTMLInputElement)?.addEventListener(
      'change',
      (e) =>
        this.actions.onUpdateSettings({
          performanceMode: (e.target as HTMLInputElement).checked,
        })
    );
    (el.querySelector('#set-reduced') as HTMLInputElement)?.addEventListener(
      'change',
      (e) =>
        this.actions.onUpdateSettings({
          reducedMotion: (e.target as HTMLInputElement).checked,
        })
    );
    (el.querySelector('#set-pip') as HTMLInputElement)?.addEventListener(
      'change',
      (e) =>
        this.actions.onUpdateSettings({
          showWebcamPip: (e.target as HTMLInputElement).checked,
        })
    );

    el.querySelector('#set-hand-r')?.addEventListener('click', () => {
      this.actions.onUpdateSettings({ handedness: 'right' });
      el.querySelector('#set-hand-r')?.classList.add('chip-active');
      el.querySelector('#set-hand-l')?.classList.remove('chip-active');
    });
    el.querySelector('#set-hand-l')?.addEventListener('click', () => {
      this.actions.onUpdateSettings({ handedness: 'left' });
      el.querySelector('#set-hand-l')?.classList.add('chip-active');
      el.querySelector('#set-hand-r')?.classList.remove('chip-active');
    });

    el.querySelector('#btn-set-recal')?.addEventListener('click', () =>
      this.actions.onRecalibrate()
    );
    el.querySelector('#btn-set-tut')?.addEventListener('click', () =>
      this.actions.onNavigate('tutorial')
    );
    el.querySelector('#hud-vr-btn')?.addEventListener('click', () =>
      this.actions.onToggleVR()
    );
    el.querySelector('#btn-hud-hand-cursor')?.addEventListener('click', () =>
      this.actions.onToggleHandCursor()
    );
    el.querySelector('#btn-set-close')?.addEventListener('click', () =>
      this.actions.onCloseModal()
    );
  }

  private formatStageLabel(hud: StudioHUDState): string {
    const names: Record<PotteryStage, string> = {
      center: 'Stage 1 · Center the Clay',
      open: 'Stage 2 · Open the Hollow Center',
      shape: 'Stage 3 · Shape the Vessel',
      smooth: 'Stage 4 · Smooth the Surface',
      finished: 'Stage 5 · Vessel Complete',
    };
    return names[hud.stage];
  }
}
