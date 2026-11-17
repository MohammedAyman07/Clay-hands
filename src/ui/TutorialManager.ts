import type { GestureState, PotteryStage, ShapingGesture } from '../types.ts';

export interface GestureTutorialCard {
  gesture: ShapingGesture;
  title: string;
  handCue: string;
  effect: string;
  mouseTip: string;
}

export type TutorialTargetAction =
  | 'compress'
  | 'open'
  | 'raise'
  | 'widen'
  | 'brush';

export interface InteractiveTutorialStep {
  id: string;
  title: string;
  handCue: string;
  mouseCue: string;
  targetAction: TutorialTargetAction;
  recommendedStage: PotteryStage;
  diagram: TutorialTargetAction;
  requiredHoldSec: number;
}

export interface TutorialPracticeResult {
  matched: boolean;
  progress: number;
  completedStep: boolean;
  finishedAll: boolean;
}

export const INTERACTIVE_TUTORIAL_STEPS: InteractiveTutorialStep[] = [
  {
    id: 'center-compress',
    title: 'Compress & Center',
    handCue: 'Bring both palms inward around clay',
    mouseCue: 'Drag inward toward center',
    targetAction: 'compress',
    recommendedStage: 'center',
    diagram: 'compress',
    requiredHoldSec: 1.05,
  },
  {
    id: 'open-hollow',
    title: 'Open Center',
    handCue: 'Pinch thumb & index above clay',
    mouseCue: 'Click & drag vertically on clay',
    targetAction: 'open',
    recommendedStage: 'open',
    diagram: 'open',
    requiredHoldSec: 0.95,
  },
  {
    id: 'raise-walls',
    title: 'Raise Walls',
    handCue: 'Lift both hands steadily upward',
    mouseCue: 'Drag straight upward on clay',
    targetAction: 'raise',
    recommendedStage: 'shape',
    diagram: 'raise',
    requiredHoldSec: 1.05,
  },
  {
    id: 'widen-belly',
    title: 'Widen Rim',
    handCue: 'Spread both hands smoothly apart',
    mouseCue: 'Drag outward from center',
    targetAction: 'widen',
    recommendedStage: 'shape',
    diagram: 'widen',
    requiredHoldSec: 1.05,
  },
  {
    id: 'village-brush',
    title: 'Brush Paint',
    handCue: 'Aim index & pinch to stroke pigment',
    mouseCue: 'Drag across the vessel surface',
    targetAction: 'brush',
    recommendedStage: 'shape',
    diagram: 'brush',
    requiredHoldSec: 0.85,
  },
];

export const GESTURE_TUTORIAL_CARDS: GestureTutorialCard[] = [
  {
    gesture: 'compress',
    title: 'Compress & Center',
    handCue: 'Bring both open palms closer together around the clay',
    effect: 'Steadies wobble and narrows the vessel walls inward.',
    mouseTip: 'Drag horizontally inward toward the center axis.',
  },
  {
    gesture: 'widen',
    title: 'Widen Body',
    handCue: 'Move both hands smoothly outward away from each other',
    effect: 'Expands the clay belly or flares out an open bowl rim.',
    mouseTip: 'Drag horizontally outward from the center axis.',
  },
  {
    gesture: 'raise',
    title: 'Raise Walls',
    handCue: 'Keep both hands near the clay and lift gently upward',
    effect: 'Draws the walls taller while keeping the base grounded.',
    mouseTip: 'Click and drag straight upward along the vessel.',
  },
  {
    gesture: 'pinch_neck',
    title: 'Pinch Neck / Open Top',
    handCue: 'Pinch thumb and index finger together, then release to hold',
    effect: 'Opens the hollow interior at the start, or shapes a narrow neck.',
    mouseTip: 'Hold Shift + Drag (or use the Pinch tool button).',
  },
  {
    gesture: 'smooth',
    title: 'Smooth Surface',
    handCue: 'Hold both hands steady beside the spinning vessel',
    effect: 'Softens ridges into a serene, silky ceramic finish.',
    mouseTip: 'Hold Alt + Drag (or use the Smooth tool button).',
  },
];

export class TutorialManager {
  public currentCardIndex = 0;
  public currentStepIndex = 0;
  public stepHoldSeconds = 0;
  public readonly completedSteps = new Set<string>();
  public finishedAll = false;

  public start(): void {
    this.currentStepIndex = 0;
    this.currentCardIndex = 0;
    this.stepHoldSeconds = 0;
    this.completedSteps.clear();
    this.finishedAll = false;
  }

  public getCurrentStep(): InteractiveTutorialStep {
    return (
      INTERACTIVE_TUTORIAL_STEPS[this.currentStepIndex] ??
      INTERACTIVE_TUTORIAL_STEPS[0]
    );
  }

  public goTo(index: number): number {
    const len = INTERACTIVE_TUTORIAL_STEPS.length;
    this.currentStepIndex = ((index % len) + len) % len;
    this.currentCardIndex = this.currentStepIndex;
    this.stepHoldSeconds = this.completedSteps.has(this.getCurrentStep().id)
      ? this.getCurrentStep().requiredHoldSec
      : 0;
    return this.currentStepIndex;
  }

  public next(): number {
    return this.goTo(this.currentStepIndex + 1);
  }

  public prev(): number {
    return this.goTo(this.currentStepIndex - 1);
  }

  public getProgress(): number {
    const step = this.getCurrentStep();
    if (this.completedSteps.has(step.id)) return 1;
    return Math.min(1, Math.max(0, this.stepHoldSeconds / step.requiredHoldSec));
  }

  public isStepCompleted(index: number): boolean {
    const step = INTERACTIVE_TUTORIAL_STEPS[index];
    return step ? this.completedSteps.has(step.id) : false;
  }

  public updatePractice(
    gesture: GestureState,
    isPainting: boolean,
    dt: number
  ): TutorialPracticeResult {
    const step = this.getCurrentStep();
    const alreadyDone = this.completedSteps.has(step.id);

    const matched = this.doesActionMatch(step.targetAction, gesture, isPainting);

    if (alreadyDone) {
      return {
        matched,
        progress: 1,
        completedStep: false,
        finishedAll: this.finishedAll,
      };
    }

    if (matched) {
      this.stepHoldSeconds += Math.max(0, dt);
    } else {
      this.stepHoldSeconds = Math.max(0, this.stepHoldSeconds - dt * 0.25);
    }

    let completedStep = false;
    if (this.stepHoldSeconds >= step.requiredHoldSec) {
      this.stepHoldSeconds = step.requiredHoldSec;
      this.completedSteps.add(step.id);
      completedStep = true;
      this.finishedAll =
        this.completedSteps.size >= INTERACTIVE_TUTORIAL_STEPS.length;
    }

    return {
      matched,
      progress: this.getProgress(),
      completedStep,
      finishedAll: this.finishedAll,
    };
  }

  private doesActionMatch(
    target: TutorialTargetAction,
    gesture: GestureState,
    isPainting: boolean
  ): boolean {
    if (target === 'brush') {
      return isPainting;
    }
    if (!gesture.inZone || gesture.strength < 0.08) {
      return false;
    }
    if (target === 'open') {
      return gesture.gesture === 'open' || gesture.gesture === 'pinch_neck';
    }
    return gesture.gesture === target;
  }
}
