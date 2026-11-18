import type {
  AppScreen,
  GameMode,
  GuidedLessonId,
  InputMode,
  StudioSettings,
} from '../types.ts';

const SETTINGS_KEY = 'clay_hands_settings_v1';

export function createDefaultSettings(): StudioSettings {
  return {
    handSensitivity: 1.0,
    wheelSpeed: 1.0,
    handedness: 'right',
    inferenceFps: 24,
    performanceMode: false,
    reducedMotion: false,
    soundEnabled: true,
    musicVolume: 0.48,
    sfxVolume: 0.72,
    showWebcamPip: true,
  };
}

export class StateManager {
  public screen: AppScreen = 'welcome';
  public previousScreen: AppScreen = 'welcome';
  public modalReturnScreen: AppScreen = 'welcome';
  public mode: GameMode = 'free';
  public inputMode: InputMode = 'webcam';
  public lessonId: GuidedLessonId = 'cup';
  public lessonStepIndex = 0;
  public challengePresetId = 'tapered-vase';
  public selectedGlazeId = 'ocean-blue';
  public selectedGalleryItemId: string | null = null;
  public settings: StudioSettings;
  public statusBanner = '';

  constructor() {
    this.settings = this.loadSettings();
  }

  public navigate(next: AppScreen): void {
    if (next !== this.screen) {
      if (this.screen !== 'tutorial' && this.screen !== 'settings') {
        this.modalReturnScreen = this.screen;
      }
      this.previousScreen = this.screen;
      this.screen = next;
    }
  }

  public updateSettings(partial: Partial<StudioSettings>): StudioSettings {
    this.settings = { ...this.settings, ...partial };
    if (partial.performanceMode !== undefined) {
      this.settings.inferenceFps = partial.performanceMode ? 15 : 24;
    }
    this.saveSettings();
    return this.settings;
  }

  private loadSettings(): StudioSettings {
    const defaults = createDefaultSettings();
    try {
      if (typeof localStorage === 'undefined') return defaults;
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Partial<StudioSettings>;
      return { ...defaults, ...parsed };
    } catch {
      return defaults;
    }
  }

  private saveSettings(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // Ignore storage quota errors for settings
    }
  }
}
