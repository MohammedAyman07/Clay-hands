import type { HandTrackingFrame, SmoothedHand } from '../types.ts';

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

const CLICKABLE_SELECTOR = [
  'button:not(:disabled)',
  '.mode-card',
  'input[type="range"]',
  'input[type="checkbox"]',
  'label',
  '[role="button"]',
].join(',');

const HUD_CONTAINER_SELECTOR = [
  '.hud-quick-actions',
  '.bottom-dock',
  '.dock-toggle-btn',
  '.brush-side-rail',
  '.tut-step-dots',
  '.tut-card-foot',
  '.celebration-banner',
  '.confirm-dialog',
].join(',');

export interface CursorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Pure helper: checks whether a viewport point lies inside or within `margin` px of any HUD box.
 */
export function isPointNearAnyRect(
  x: number,
  y: number,
  rects: ReadonlyArray<CursorRect>,
  margin = 60
): boolean {
  for (const r of rects) {
    if (r.right - r.left <= 0 || r.bottom - r.top <= 0) continue;
    if (
      x >= r.left - margin &&
      x <= r.right + margin &&
      y >= r.top - margin &&
      y <= r.bottom + margin
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Pure helper: selects the preferred active hand (or first visible hand) for 2D cursor navigation.
 */
export function selectCursorHand(
  hands: SmoothedHand[],
  preferredHandedness: 'left' | 'right'
): SmoothedHand | null {
  if (hands.length === 0) return null;
  return (
    hands.find((h) => h.handedness === preferredHandedness) ?? hands[0]
  );
}

/**
 * Pure helper: computes normalized pinch distance combining 3D distance and
 * 2D image-plane distance so camera-facing pinches aren't blocked by noisy Z depth.
 */
export function computeCursorPinchRatio(
  hand: Pick<SmoothedHand, 'indexTip' | 'thumbTip' | 'pinchDistance' | 'handSpan'>
): number {
  const span = Math.max(0.05, hand.handSpan);
  const ratio3D = hand.pinchDistance / span;
  const dist2D = Math.hypot(
    hand.indexTip.x - hand.thumbTip.x,
    hand.indexTip.y - hand.thumbTip.y
  );
  const ratio2D = dist2D / span;
  return Math.min(ratio3D, ratio2D * 1.15);
}

/**
 * Finds the nearest scrollable ancestor container for hand-cursor edge scrolling.
 */
function findScrollableAncestor(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el;
  while (cur && cur !== document.body) {
    if (cur.scrollHeight > cur.clientHeight + 8) {
      const style = window.getComputedStyle(cur);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        return cur;
      }
    }
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Webcam-driven 2D hand cursor that works from Home and across every 2D screen
 * (buttons, sliders, checkboxes, cards) via index pointing + thumb pinch or
 * brief steady hover dwell. While actively sculpting/painting clay, stays hidden
 * over the center wheel and automatically appears whenever the hand moves toward
 * or onto any HUD button/control.
 */
export class HandCursorController {
  public enabled = false;
  private isPinching = false;
  private readonly enterThreshold = 0.44;
  private readonly exitThreshold = 0.56;
  private readonly dwellWarmupMs = 240;
  private readonly dwellTriggerMs = 1150;
  private readonly clickCooldownMs = 420;
  private readonly hudProximityMarginPx = 6;
  private smoothX = 0.5;
  private smoothY = 0.5;
  private hasPosition = false;
  private lastHovered: HTMLElement | null = null;
  private activeSlider: HTMLInputElement | null = null;
  private hoverStartMs = 0;
  private dwellFiredForTarget = false;
  private clickCooldownUntil = 0;

  private readonly cursorEl: HTMLDivElement;
  private readonly ringEl: HTMLDivElement;
  private readonly dotEl: HTMLDivElement;

  constructor(parent: HTMLElement = document.body) {
    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'hand-cursor-overlay';
    this.cursorEl.style.display = 'none';

    this.ringEl = document.createElement('div');
    this.ringEl.className = 'hand-cursor-ring';

    this.dotEl = document.createElement('div');
    this.dotEl.className = 'hand-cursor-dot';

    this.cursorEl.appendChild(this.ringEl);
    this.cursorEl.appendChild(this.dotEl);
    parent.appendChild(this.cursorEl);
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.hide();
    }
  }

  public hide(): void {
    this.isPinching = false;
    this.activeSlider = null;
    this.resetHoverAndDwell();
    this.cursorEl.classList.remove('hand-cursor-pinching');
    this.cursorEl.style.display = 'none';
  }

  private resetHoverAndDwell(): void {
    this.hoverStartMs = 0;
    this.dwellFiredForTarget = false;
    this.cursorEl.style.setProperty('--dwell', '0');
    this.cursorEl.classList.remove('hand-cursor-dwelling');
    this.clearHover();
  }

  public update(
    frame: HandTrackingFrame,
    preferredHandedness: 'left' | 'right',
    sensitivity = 1.0,
    inXRSession = false,
    playSculptMode = false,
    suppressForSculpt = false
  ): { overUI: boolean } {
    if (
      !this.enabled ||
      inXRSession ||
      frame.source === 'webxr' ||
      (suppressForSculpt && !this.activeSlider)
    ) {
      this.hide();
      return { overUI: false };
    }

    const hand = selectCursorHand(frame.hands, preferredHandedness);
    if (!hand) {
      this.hide();
      return { overUI: false };
    }

    const now = performance.now();
    const tipX = hand.indexTip.x * 0.7 + hand.thumbTip.x * 0.3;
    const tipY = hand.indexTip.y * 0.7 + hand.thumbTip.y * 0.3;

    // Slight center magnification so edges & HUD corners are effortless to reach
    const gain = clamp(1.15 + sensitivity * 0.25, 1.1, 1.75);
    const targetNormX = clamp(0.5 + (tipX - 0.5) * gain, 0.01, 0.99);
    const targetNormY = clamp(0.5 + (tipY - 0.48) * gain, 0.01, 0.99);

    if (!this.hasPosition) {
      this.smoothX = targetNormX;
      this.smoothY = targetNormY;
      this.hasPosition = true;
    } else {
      this.smoothX += (targetNormX - this.smoothX) * 0.45;
      this.smoothY += (targetNormY - this.smoothY) * 0.45;
    }

    const clientX = this.smoothX * window.innerWidth;
    const clientY = this.smoothY * window.innerHeight;

    const pinchRatio = computeCursorPinchRatio(hand);
    const wasPinching = this.isPinching;
    this.isPinching = wasPinching
      ? pinchRatio < this.exitThreshold
      : pinchRatio < this.enterThreshold;

    // Continuously scrub range slider while pinched
    if (this.activeSlider) {
      this.cursorEl.style.display = 'block';
      this.cursorEl.style.transform = `translate3d(${clientX}px, ${clientY}px, 0)`;
      this.cursorEl.classList.toggle('hand-cursor-pinching', this.isPinching);
      if (this.isPinching) {
        this.scrubSlider(this.activeSlider, clientX);
        return { overUI: true };
      } else {
        this.activeSlider.dispatchEvent(new Event('change', { bubbles: true }));
        this.activeSlider = null;
      }
    }

    if (this.lastHovered && !this.lastHovered.isConnected) {
      this.lastHovered = null;
      this.hoverStartMs = now;
      this.dwellFiredForTarget = false;
      this.clickCooldownUntil = Math.max(
        this.clickCooldownUntil,
        now + this.clickCooldownMs
      );
    }

    const hitEl = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const target = hitEl?.closest(CLICKABLE_SELECTOR) as HTMLElement | null;
    const hudContainerHit = Boolean(hitEl?.closest(HUD_CONTAINER_SELECTOR));

    if (playSculptMode) {
      const hudRects: CursorRect[] = [];
      document.querySelectorAll(HUD_CONTAINER_SELECTOR).forEach((el) => {
        hudRects.push(el.getBoundingClientRect());
      });
      const nearHUD =
        Boolean(target) ||
        hudContainerHit ||
        isPointNearAnyRect(clientX, clientY, hudRects, this.hudProximityMarginPx);

      if (!nearHUD) {
        this.resetHoverAndDwell();
        this.cursorEl.classList.remove('hand-cursor-pinching');
        this.cursorEl.style.display = 'none';
        return { overUI: false };
      }
    }

    this.cursorEl.style.display = 'block';
    this.cursorEl.style.transform = `translate3d(${clientX}px, ${clientY}px, 0)`;
    this.cursorEl.classList.toggle('hand-cursor-pinching', this.isPinching);

    // Smooth auto-scroll if hovering near top/bottom edge of a scrollable modal panel
    if (!playSculptMode) {
      const scroller = findScrollableAncestor(hitEl);
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        const edgeBand = 52;
        if (clientY > rect.bottom - edgeBand) {
          scroller.scrollTop += 7;
        } else if (clientY < rect.top + edgeBand) {
          scroller.scrollTop -= 7;
        }
      }
    }

    if (target !== this.lastHovered) {
      this.clearHover();
      this.hoverStartMs = now;
      this.dwellFiredForTarget = false;
      if (target) {
        target.classList.add('hand-cursor-hover');
        this.lastHovered = target;
      }
    }

    const isRangeInput =
      target instanceof HTMLInputElement && target.type === 'range';
    const overUI = Boolean(
      target || this.activeSlider || (playSculptMode && hudContainerHit)
    );

    // Immediate click on pinch onset
    if (!wasPinching && this.isPinching && target && now >= this.clickCooldownUntil) {
      if (isRangeInput) {
        this.activeSlider = target;
        this.scrubSlider(target, clientX);
      } else {
        this.dwellFiredForTarget = true;
        this.clickCooldownUntil = now + this.clickCooldownMs;
        target.click();
      }
      this.cursorEl.style.setProperty('--dwell', '0');
      this.cursorEl.classList.remove('hand-cursor-dwelling');
      return { overUI: true };
    }

    // Hover-dwell auto-click assist for buttons/cards when steady without pinching
    if (
      target &&
      !isRangeInput &&
      !this.dwellFiredForTarget &&
      !this.isPinching &&
      now >= this.clickCooldownUntil
    ) {
      const elapsed = now - this.hoverStartMs;
      if (elapsed >= this.dwellWarmupMs) {
        const progress = clamp(
          (elapsed - this.dwellWarmupMs) /
            (this.dwellTriggerMs - this.dwellWarmupMs),
          0,
          1
        );
        this.cursorEl.style.setProperty('--dwell', progress.toFixed(3));
        this.cursorEl.classList.add('hand-cursor-dwelling');
        if (progress >= 1) {
          this.dwellFiredForTarget = true;
          this.clickCooldownUntil = now + this.clickCooldownMs;
          this.cursorEl.style.setProperty('--dwell', '0');
          this.cursorEl.classList.remove('hand-cursor-dwelling');
          target.click();
        }
        return { overUI };
      }
    }

    this.cursorEl.style.setProperty('--dwell', '0');
    this.cursorEl.classList.remove('hand-cursor-dwelling');
    return { overUI };
  }

  private scrubSlider(slider: HTMLInputElement, clientX: number): void {
    const rect = slider.getBoundingClientRect();
    if (rect.width <= 1) return;
    const min = parseFloat(slider.min || '0');
    const max = parseFloat(slider.max || '100');
    const step = parseFloat(slider.step || '1');
    const t = clamp((clientX - rect.left) / rect.width, 0, 1);
    const raw = min + t * (max - min);
    const stepped =
      step > 0 ? Math.round((raw - min) / step) * step + min : raw;
    const nextVal = clamp(Number(stepped.toFixed(4)), min, max);
    if (parseFloat(slider.value) !== nextVal) {
      slider.value = String(nextVal);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  private clearHover(): void {
    if (this.lastHovered) {
      this.lastHovered.classList.remove('hand-cursor-hover');
      this.lastHovered = null;
    }
  }

  public dispose(): void {
    this.clearHover();
    this.cursorEl.remove();
  }
}
