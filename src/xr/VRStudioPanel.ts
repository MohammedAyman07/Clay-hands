import * as THREE from 'three';
import * as xb from 'xrblocks';
import { GLAZE_CATALOG } from '../kiln/GlazeManager.ts';
import { VILLAGE_PIGMENTS } from '../pottery/VesselPainter.ts';
import type { PotteryStage } from '../types.ts';

export interface VRStudioPanelActions {
  onStageSelect: (stage: PotteryStage) => void;
  onToggleBrush: () => void;
  onCyclePigment: () => void;
  onSelectGlazeScreen: () => void;
  onCycleGlaze: () => void;
  onFireKiln: () => void;
  onToggleTutorial: () => void;
  onNextTutorial: () => void;
  onUndo: () => void;
  onReset: () => void;
  onRecenterWheel: () => void;
  onExitVR: () => void;
}

export interface VRPanelSyncState {
  screen: string;
  stage: PotteryStage;
  brushActive: boolean;
  brushColorId: string;
  glazeId: string;
  gestureDesc: string;
  handsCount: number;
  tutorialActive: boolean;
  tutorialTitle: string;
  tutorialCue: string;
  tutorialProgress: number;
  tutorialStepText: string;
}

/**
 * Spatial 3D control card built with XR Blocks UI components so Meta Quest
 * judges have full hands-free pinch/ray access to stages, brush, tutorial,
 * glazes, kiln, and recentering inside immersive VR sessions.
 */
export class VRStudioPanel extends THREE.Group {
  private readonly card: xb.UICard;
  private readonly titleText: xb.UIText;
  private readonly statusText: xb.UIText;
  private readonly stageButtons = new Map<PotteryStage, xb.UIButton>();
  private readonly brushButton: xb.UIButton;
  private readonly pigmentButton: xb.UIButton;
  private readonly glazeButton: xb.UIButton;
  private readonly fireButton: xb.UIButton;
  private readonly tutorialButton: xb.UIButton;
  private readonly nextTutorialButton: xb.UIButton;

  constructor(actions: VRStudioPanelActions) {
    super();
    this.name = 'VRStudioPanel';
    this.visible = false;

    this.titleText = new xb.UIText({
      text: 'CLAY HANDS · QUEST STUDIO',
      style: { fontSize: 18, fontWeight: 'bold', textAlign: 'left' },
    });

    this.statusText = new xb.UIText({
      text: 'Bring both hands over the clay to sculpt.',
      style: {
        fontSize: 15,
        lineHeight: 1.3,
        opacity: 0.85,
        textAlign: 'left',
      },
    });

    const stages: Array<[PotteryStage, string]> = [
      ['center', 'Center'],
      ['open', 'Open'],
      ['shape', 'Shape'],
      ['smooth', 'Smooth'],
    ];
    for (const [st, label] of stages) {
      this.stageButtons.set(
        st,
        new xb.UIButton({
          label,
          style: { flexGrow: 1, fontSize: 15, padding: 8 },
          onClick: () => actions.onStageSelect(st),
        })
      );
    }

    this.brushButton = new xb.UIButton({
      label: 'Brush: Off',
      icon: 'brush',
      style: { flexGrow: 1, fontSize: 15 },
      onClick: () => actions.onToggleBrush(),
    });

    this.pigmentButton = new xb.UIButton({
      label: 'Color: Indigo',
      icon: 'palette',
      style: { flexGrow: 1, fontSize: 15 },
      onClick: () => actions.onCyclePigment(),
    });

    this.glazeButton = new xb.UIButton({
      label: 'Glaze & Paint',
      icon: 'water_drop',
      style: { flexGrow: 1, fontSize: 15 },
      onClick: () => actions.onSelectGlazeScreen(),
    });

    this.fireButton = new xb.UIButton({
      label: 'Fire Kiln',
      icon: 'local_fire_department',
      style: { flexGrow: 1, fontSize: 15 },
      onClick: () => actions.onFireKiln(),
    });

    this.tutorialButton = new xb.UIButton({
      label: 'Interactive Guide',
      icon: 'school',
      style: { flexGrow: 1, fontSize: 15 },
      onClick: () => actions.onToggleTutorial(),
    });

    this.nextTutorialButton = new xb.UIButton({
      label: 'Next Lesson',
      icon: 'arrow_forward',
      style: { flexGrow: 1, fontSize: 15 },
      onClick: () => actions.onNextTutorial(),
    });

    this.card = new xb.UICard({
      size: { width: 0.56, height: 'auto' },
      manipulation: true,
      edge: true,
      style: { flexDirection: 'column', gap: 10, padding: 16 },
      children: [
        this.titleText,
        this.statusText,
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 6 },
          children: Array.from(this.stageButtons.values()),
        }),
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 8 },
          children: [this.brushButton, this.pigmentButton],
        }),
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 8 },
          children: [
            this.glazeButton,
            new xb.UIButton({
              label: 'Next Glaze',
              icon: 'style',
              style: { flexGrow: 1, fontSize: 15 },
              onClick: () => actions.onCycleGlaze(),
            }),
            this.fireButton,
          ],
        }),
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 8 },
          children: [this.tutorialButton, this.nextTutorialButton],
        }),
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 8 },
          children: [
            new xb.UIButton({
              label: 'Undo',
              icon: 'undo',
              style: { flexGrow: 1, fontSize: 15 },
              onClick: () => actions.onUndo(),
            }),
            new xb.UIButton({
              label: 'Reset',
              icon: 'restart_alt',
              style: { flexGrow: 1, fontSize: 15 },
              onClick: () => actions.onReset(),
            }),
            new xb.UIButton({
              label: 'Recenter',
              icon: 'my_location',
              style: { flexGrow: 1, fontSize: 15 },
              onClick: () => actions.onRecenterWheel(),
            }),
            new xb.UIButton({
              label: 'Exit VR',
              icon: 'close',
              style: { flexGrow: 1, fontSize: 15 },
              onClick: () => actions.onExitVR(),
            }),
          ],
        }),
      ],
    });

    this.add(this.card);
  }

  public sync(state: VRPanelSyncState): void {
    const pigment =
      VILLAGE_PIGMENTS.find((p) => p.id === state.brushColorId) ??
      VILLAGE_PIGMENTS[0];
    const glaze =
      GLAZE_CATALOG.find((g) => g.id === state.glazeId) ?? GLAZE_CATALOG[0];

    if (state.tutorialActive) {
      const pct = Math.round(state.tutorialProgress * 100);
      this.titleText.text = `GUIDE · ${state.tutorialStepText} (${pct}%)`;
      this.statusText.text = `${state.tutorialTitle}: ${state.tutorialCue}`;
    } else {
      this.titleText.text = `CLAY HANDS · ${state.handsCount} HAND${state.handsCount === 1 ? '' : 'S'} IN VR`;
      this.statusText.text = state.gestureDesc;
    }

    this.brushButton.label = state.brushActive ? 'Brush: ON' : 'Brush: Off';
    this.pigmentButton.label = `Ink: ${pigment.name.split(' ')[0]}`;
    this.glazeButton.label =
      state.screen === 'glaze' ? `Glaze: ${glaze.name.split(' ')[0]}` : 'Glaze Mode';
    this.tutorialButton.label = state.tutorialActive ? 'Exit Guide' : 'Hand Guide';
    this.nextTutorialButton.visible = state.tutorialActive;
  }
}
