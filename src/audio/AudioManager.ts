import type { ShapingGesture, StudioSettings } from '../types.ts';

/**
 * 100% Procedural Web Audio API soundscape & tactile pottery sound synthesizer.
 * Audio starts strictly after a user interaction.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;

  // Continuous wheel & clay shaping nodes
  private wheelOsc: OscillatorNode | null = null;
  private wheelGain: GainNode | null = null;
  private clayFilter: BiquadFilterNode | null = null;
  private clayGain: GainNode | null = null;
  private kilnFireGain: GainNode | null = null;

  private musicTimer: number | null = null;
  private musicStep = 0;

  private enabled = true;
  private musicVolume = 0.35;
  private sfxVolume = 0.7;
  private unlocked = false;

  public unlock(): void {
    if (this.unlocked && this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.enabled ? 1 : 0;
    this.masterGain.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.sfxVolume;
    this.sfxGain.connect(this.masterGain);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.musicGain.connect(this.masterGain);

    this.setupContinuousLoops();
    this.startAmbientMusicLoop();
    this.unlocked = true;
  }

  private createNoiseBuffer(seconds = 2): AudioBuffer | null {
    if (!this.ctx) return null;
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      // Soft brown/pinkish noise for warm organic clay & wheel texture
      data[i] = (lastOut + 0.04 * white) / 1.04;
      lastOut = data[i];
      data[i] *= 2.8;
    }
    return buffer;
  }

  private setupContinuousLoops(): void {
    if (!this.ctx || !this.sfxGain) return;

    // 1. Soft spinning pottery wheel hum
    this.wheelOsc = this.ctx.createOscillator();
    this.wheelOsc.type = 'triangle';
    this.wheelOsc.frequency.value = 72;

    const wheelFilter = this.ctx.createBiquadFilter();
    wheelFilter.type = 'lowpass';
    wheelFilter.frequency.value = 180;

    this.wheelGain = this.ctx.createGain();
    this.wheelGain.gain.value = 0;

    this.wheelOsc.connect(wheelFilter);
    wheelFilter.connect(this.wheelGain);
    this.wheelGain.connect(this.sfxGain);
    this.wheelOsc.start();

    // 2. Wet clay shaping friction loop
    const noiseBuf = this.createNoiseBuffer(2);
    if (noiseBuf) {
      const claySource = this.ctx.createBufferSource();
      claySource.buffer = noiseBuf;
      claySource.loop = true;

      this.clayFilter = this.ctx.createBiquadFilter();
      this.clayFilter.type = 'bandpass';
      this.clayFilter.frequency.value = 420;
      this.clayFilter.Q.value = 1.6;

      this.clayGain = this.ctx.createGain();
      this.clayGain.gain.value = 0;

      claySource.connect(this.clayFilter);
      this.clayFilter.connect(this.clayGain);
      this.clayGain.connect(this.sfxGain);
      claySource.start();

      // 3. Kiln hearth rumble / crackle bed
      const kilnSource = this.ctx.createBufferSource();
      kilnSource.buffer = noiseBuf;
      kilnSource.loop = true;

      const kilnFilter = this.ctx.createBiquadFilter();
      kilnFilter.type = 'lowpass';
      kilnFilter.frequency.value = 260;

      this.kilnFireGain = this.ctx.createGain();
      this.kilnFireGain.gain.value = 0;

      kilnSource.connect(kilnFilter);
      kilnFilter.connect(this.kilnFireGain);
      this.kilnFireGain.connect(this.sfxGain);
      kilnSource.start();
    }
  }

  private startAmbientMusicLoop(): void {
    if (this.musicTimer !== null) return;
    // Peaceful warm pentatonic intervals (C4, D4, E4, G4, A4, C5, D5)
    const notes = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33];
    const pattern = [0, 2, 4, 3, 5, 4, 2, 1];

    this.musicTimer = window.setInterval(() => {
      if (!this.ctx || !this.musicGain || !this.enabled || this.musicVolume <= 0.01) {
        return;
      }
      if (this.ctx.state !== 'running' || document.hidden) return;

      const noteFreq = notes[pattern[this.musicStep % pattern.length]];
      this.musicStep++;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(noteFreq, now);

      env.gain.setValueAtTime(0.0001, now);
      env.gain.exponentialRampToValueAtTime(0.055, now + 0.18);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);

      osc.connect(env);
      env.connect(this.musicGain);
      osc.start(now);
      osc.stop(now + 2.5);
    }, 1650);
  }

  public applySettings(settings: StudioSettings): void {
    this.enabled = settings.soundEnabled;
    this.musicVolume = settings.musicVolume;
    this.sfxVolume = settings.sfxVolume;

    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.enabled ? 1 : 0, now, 0.05);
    }
    if (this.sfxGain) {
      this.sfxGain.gain.setTargetAtTime(this.sfxVolume, now, 0.05);
    }
    if (this.musicGain) {
      this.musicGain.gain.setTargetAtTime(this.musicVolume, now, 0.05);
    }
  }

  public updateStudioAudio(
    wheelActive: boolean,
    wheelSpeed: number,
    shapingGesture: ShapingGesture,
    shapingStrength: number
  ): void {
    if (!this.ctx || !this.wheelGain || !this.wheelOsc || !this.clayGain || !this.clayFilter) {
      return;
    }
    const now = this.ctx.currentTime;

    const targetWheelGain = wheelActive ? 0.045 + wheelSpeed * 0.02 : 0;
    this.wheelGain.gain.setTargetAtTime(targetWheelGain, now, 0.08);
    this.wheelOsc.frequency.setTargetAtTime(58 + wheelSpeed * 28, now, 0.1);

    const isShaping = wheelActive && shapingGesture !== 'idle' && shapingStrength > 0.05;
    const targetClayGain = isShaping ? 0.04 + shapingStrength * 0.12 : 0;
    const targetFreq =
      shapingGesture === 'pinch_neck'
        ? 720
        : shapingGesture === 'smooth'
          ? 560
          : shapingGesture === 'compress'
            ? 320
            : 440;
    this.clayGain.gain.setTargetAtTime(targetClayGain, now, 0.06);
    this.clayFilter.frequency.setTargetAtTime(targetFreq, now, 0.08);
  }

  public setKilnHeatAmbience(intensity: number): void {
    if (!this.ctx || !this.kilnFireGain) return;
    this.kilnFireGain.gain.setTargetAtTime(
      Math.max(0, Math.min(0.28, intensity * 0.26)),
      this.ctx.currentTime,
      0.1
    );
  }

  public playKilnDoor(open: boolean): void {
    if (!this.ctx || !this.sfxGain || !this.enabled) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(open ? 120 : 165, now);
    osc.frequency.exponentialRampToValueAtTime(open ? 185 : 95, now + 0.28);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  private lastBrushSoundAt = 0;

  public playBrushSwish(intensity = 0.6): void {
    if (!this.ctx || !this.sfxGain || !this.enabled) return;
    const nowMs = performance.now();
    if (nowMs - this.lastBrushSoundAt < 75) return;
    this.lastBrushSoundAt = nowMs;

    const now = this.ctx.currentTime;
    const buf = this.createNoiseBuffer(0.12);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1150 + intensity * 420, now);
    filter.Q.value = 1.8;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.045 * Math.max(0.3, intensity), now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.12);
  }

  public playCompressionPulse(): void {
    if (!this.ctx || !this.sfxGain || !this.enabled) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(115, now + 0.18);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  public playFinishChime(): void {
    if (!this.ctx || !this.sfxGain || !this.enabled) return;
    const freqs = [392.0, 493.88, 587.33, 783.99];
    freqs.forEach((f, idx) => {
      if (!this.ctx || !this.sfxGain) return;
      const start = this.ctx.currentTime + idx * 0.09;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.12, start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.1);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(start);
      osc.stop(start + 1.2);
    });
  }

  public playCompletionBell(): void {
    if (!this.ctx || !this.sfxGain || !this.enabled) return;
    const freqs = [523.25, 659.25, 783.99, 1046.5];
    freqs.forEach((f, idx) => {
      if (!this.ctx || !this.sfxGain) return;
      const start = this.ctx.currentTime + idx * 0.11;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.14, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.5);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(start);
      osc.stop(start + 1.6);
    });
  }

  public dispose(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.wheelOsc?.stop();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
