import type { ShapingGesture, StudioSettings } from '../types.ts';

export type MusicMood = 'welcome' | 'studio' | 'glaze' | 'kiln' | 'gallery';

interface ChordSpec {
  bass: number;
  pad: number[];
  arp: number[];
  melody: number[];
}

// 100% original procedural harmonic progression (serene F Lydian / C Major, zero dissonance/beating)
// Open intervals keep every chord crystal clear with zero mud or low-frequency vibration
const PROGRESSION: ChordSpec[] = [
  // Section A: Sunlit Courtyard
  {
    // Fmaj9
    bass: 174.61, // F3 (warm cello register, zero sub-bass rumble)
    pad: [174.61, 261.63, 329.63], // F3 C4 E4
    arp: [261.63, 329.63, 392.0, 440.0, 523.25, 659.25],
    melody: [523.25, 587.33, 659.25, 783.99, 880.0],
  },
  {
    // G6
    bass: 196.0, // G3
    pad: [196.0, 293.66, 329.63], // G3 D4 E4
    arp: [293.66, 329.63, 392.0, 493.88, 587.33, 783.99],
    melody: [587.33, 659.25, 783.99, 880.0, 987.77],
  },
  {
    // Em7
    bass: 164.81, // E3
    pad: [164.81, 246.94, 293.66], // E3 B3 D4
    arp: [246.94, 293.66, 392.0, 493.88, 587.33, 659.25],
    melody: [493.88, 587.33, 659.25, 783.99, 987.77],
  },
  {
    // Am9
    bass: 220.0, // A3
    pad: [220.0, 261.63, 329.63], // A3 C4 E4
    arp: [261.63, 329.63, 392.0, 493.88, 523.25, 659.25],
    melody: [523.25, 659.25, 783.99, 880.0, 1046.5],
  },
  // Section B: Artisan Flow
  {
    // Dm9
    bass: 146.83, // D3
    pad: [146.83, 220.0, 261.63], // D3 A3 C4
    arp: [220.0, 261.63, 329.63, 349.23, 440.0, 523.25],
    melody: [523.25, 587.33, 659.25, 698.46, 880.0],
  },
  {
    // G13sus4
    bass: 196.0, // G3
    pad: [196.0, 261.63, 329.63], // G3 C4 E4
    arp: [261.63, 293.66, 329.63, 392.0, 440.0, 587.33],
    melody: [587.33, 659.25, 783.99, 880.0, 1046.5],
  },
  {
    // Cmaj9
    bass: 130.81, // C3
    pad: [196.0, 246.94, 329.63], // G3 B3 E4
    arp: [246.94, 293.66, 329.63, 392.0, 493.88, 587.33],
    melody: [523.25, 587.33, 659.25, 783.99, 987.77],
  },
  {
    // G/B -> Am7 lift
    bass: 196.0, // G3
    pad: [196.0, 246.94, 392.0], // G3 B3 G4
    arp: [246.94, 293.66, 329.63, 440.0, 587.33, 783.99],
    melody: [587.33, 659.25, 783.99, 880.0, 1174.66],
  },
];

// Gentle rolling felt-piano / harp arpeggio patterns (uncluttered, with peaceful breath)
const ARP_PATTERNS: Array<Array<number | null>> = [
  [0, 2, 4, null, 5, 4, 2, null],
  [0, 3, 2, 4, null, 3, 4, null],
  [1, 2, 4, null, 3, 4, 2, null],
];

// Simple, singing pentatonic/lyrical melody phrases with generous breathing space
const MELODY_PHRASES: Array<Array<number | null>> = [
  [2, null, null, 3, 4, null, 3, null],
  [null, 1, 2, null, 4, null, 3, null],
  [4, null, 3, null, 2, null, 1, null],
  [0, null, 2, null, 3, null, 4, null],
];

/**
 * 100% Procedural, Copyright-Free Web Audio API Soundtrack & Tactile Pottery Audio Engine.
 * Zero noise generators or vibrating detune drones in the music bus — pure singing felt-piano,
 * acoustic harp, celesta chimes, and silky multi-tap hall reflections generated in real time.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;

  // Music mastering & pure-tone spatial echo buses (zero noise, zero hum)
  private musicDryBus: GainNode | null = null;
  private musicHallSend: GainNode | null = null;
  private musicDelaySend: GainNode | null = null;

  // Continuous wheel & clay shaping nodes
  private wheelOsc: OscillatorNode | null = null;
  private wheelGain: GainNode | null = null;
  private claySource: AudioBufferSourceNode | null = null;
  private clayFilter: BiquadFilterNode | null = null;
  private clayGain: GainNode | null = null;
  private kilnSource: AudioBufferSourceNode | null = null;
  private kilnFireGain: GainNode | null = null;
  private cachedSfxNoiseBuffer: AudioBuffer | null = null;

  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicMood: MusicMood = 'welcome';
  private activeShapingIntensity = 0;

  private enabled = true;
  private musicVolume = 0.42;
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

    this.setupMusicBuses();
    this.setupContinuousLoops();
    this.startOriginalSoundtrack();
    this.unlocked = true;
  }

  public setMusicMood(mood: MusicMood): void {
    this.musicMood = mood;
  }

  private setupMusicBuses(): void {
    if (!this.ctx || !this.musicGain) return;

    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 16;
    compressor.ratio.value = 2.4;
    compressor.attack.value = 0.03;
    compressor.release.value = 0.3;
    compressor.connect(this.musicGain);

    this.musicDryBus = this.ctx.createGain();
    this.musicDryBus.gain.value = 0.88;
    this.musicDryBus.connect(compressor);

    // Pure noiseless multi-tap acoustic hall echo (zero Convolver white-noise hiss)
    this.musicHallSend = this.ctx.createGain();
    this.musicHallSend.gain.value = 0.38;

    const hallFilter = this.ctx.createBiquadFilter();
    hallFilter.type = 'lowpass';
    hallFilter.frequency.value = 2100;
    hallFilter.connect(compressor);

    const hallTaps = [
      { time: 0.14, gain: 0.32, pan: -0.45 },
      { time: 0.23, gain: 0.26, pan: 0.45 },
      { time: 0.37, gain: 0.19, pan: -0.25 },
      { time: 0.53, gain: 0.14, pan: 0.25 },
    ];
    for (const tap of hallTaps) {
      const d = this.ctx.createDelay(1.0);
      d.delayTime.value = tap.time;
      const g = this.ctx.createGain();
      g.gain.value = tap.gain;
      const p = this.ctx.createStereoPanner();
      p.pan.value = tap.pan;
      this.musicHallSend.connect(d);
      d.connect(g);
      g.connect(p);
      p.connect(hallFilter);
    }

    // Gentle silky stereo shimmer echo
    const delayL = this.ctx.createDelay(1.0);
    const delayR = this.ctx.createDelay(1.0);
    delayL.delayTime.value = 0.41;
    delayR.delayTime.value = 0.62;

    const fbL = this.ctx.createGain();
    const fbR = this.ctx.createGain();
    fbL.gain.value = 0.2;
    fbR.gain.value = 0.18;

    const delayFilter = this.ctx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = 1750;

    const merger = this.ctx.createChannelMerger(2);
    this.musicDelaySend = this.ctx.createGain();
    this.musicDelaySend.gain.value = 0.18;

    this.musicDelaySend.connect(delayL);
    this.musicDelaySend.connect(delayR);
    delayL.connect(fbL);
    fbL.connect(delayR);
    delayR.connect(fbR);
    fbR.connect(delayL);

    delayL.connect(merger, 0, 0);
    delayR.connect(merger, 0, 1);
    merger.connect(delayFilter);
    delayFilter.connect(compressor);
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

    // 2. Wet clay shaping friction loop (and cached 1s noise buffer for transient SFX)
    const noiseBuf = this.createNoiseBuffer(2);
    if (noiseBuf) {
      this.cachedSfxNoiseBuffer = noiseBuf;
      const claySource = this.ctx.createBufferSource();
      claySource.buffer = noiseBuf;
      claySource.loop = true;
      this.claySource = claySource;

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
      this.kilnSource = kilnSource;

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

  private routeMusicVoice(node: AudioNode, pan: number, hallAmt = 0.5, delayAmt = 0.28): void {
    if (!this.ctx || !this.musicDryBus) return;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    node.connect(panner);
    panner.connect(this.musicDryBus);

    if (this.musicHallSend && hallAmt > 0) {
      const hallSend = this.ctx.createGain();
      hallSend.gain.value = hallAmt;
      panner.connect(hallSend);
      hallSend.connect(this.musicHallSend);
    }
    if (this.musicDelaySend && delayAmt > 0) {
      const delSend = this.ctx.createGain();
      delSend.gain.value = delayAmt;
      panner.connect(delSend);
      delSend.connect(this.musicDelaySend);
    }
  }

  private playWarmPadChord(freqs: number[], startTime: number, durationSec: number, gainScale = 1): void {
    if (!this.ctx || !this.musicDryBus) return;

    const env = this.ctx.createGain();
    const peak = 0.026 * gainScale;
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(peak, startTime + 1.15);
    env.gain.setValueAtTime(peak * 0.88, startTime + durationSec - 1.15);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec + 0.2);

    this.routeMusicVoice(env, 0, 0.72, 0.08);

    // Pure sine voicings with ZERO detune so the pad never vibrates or beats
    freqs.forEach((f) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, startTime);
      osc.connect(env);
      osc.start(startTime);
      osc.stop(startTime + durationSec + 0.25);
    });
  }

  private playAcousticHarpNote(freq: number, startTime: number, pan: number, level = 1): void {
    if (!this.ctx || !this.musicDryBus) return;

    const env = this.ctx.createGain();
    const peak = 0.072 * level;
    // Soft felt-piano / harp attack (22ms) eliminates harsh transients; warm singing decay
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(peak, startTime + 0.022);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.95);

    const fundamental = this.ctx.createOscillator();
    fundamental.type = 'sine';
    fundamental.frequency.setValueAtTime(freq, startTime);

    // Gentle pure 2x octave warmth that fades slightly faster than fundamental
    const harmonic = this.ctx.createOscillator();
    harmonic.type = 'sine';
    harmonic.frequency.setValueAtTime(freq * 2, startTime);
    const overtoneEnv = this.ctx.createGain();
    overtoneEnv.gain.setValueAtTime(0.0001, startTime);
    overtoneEnv.gain.linearRampToValueAtTime(peak * 0.16, startTime + 0.02);
    overtoneEnv.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.75);

    fundamental.connect(env);
    harmonic.connect(overtoneEnv);
    this.routeMusicVoice(env, pan, 0.58, 0.34);
    this.routeMusicVoice(overtoneEnv, pan, 0.3, 0.18);

    fundamental.start(startTime);
    harmonic.start(startTime);
    fundamental.stop(startTime + 2.0);
    harmonic.stop(startTime + 0.8);
  }

  private playWarmBassNote(freq: number, startTime: number, durationSec: number, level = 1): void {
    if (!this.ctx || !this.musicDryBus) return;

    const env = this.ctx.createGain();
    const peak = 0.075 * level;
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(peak, startTime + 0.06);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    // Smooth pure sine cello-register tone (no low-frequency rumble/vibration)
    const root = this.ctx.createOscillator();
    root.type = 'sine';
    root.frequency.setValueAtTime(freq, startTime);

    root.connect(env);
    this.routeMusicVoice(env, 0, 0.25, 0);

    root.start(startTime);
    root.stop(startTime + durationSec + 0.05);
  }

  private playKalimbaSparkle(freq: number, startTime: number, pan: number, level = 1): void {
    if (!this.ctx || !this.musicDryBus) return;

    const env = this.ctx.createGain();
    const peak = 0.058 * level;
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(peak, startTime + 0.016);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.85);

    const fundamental = this.ctx.createOscillator();
    fundamental.type = 'sine';
    fundamental.frequency.setValueAtTime(freq, startTime);

    // Soft glass-bell octave sparkle (pure 2x sine, zero metallic harshness)
    const chime = this.ctx.createOscillator();
    chime.type = 'sine';
    chime.frequency.setValueAtTime(freq * 2, startTime);
    const chimeEnv = this.ctx.createGain();
    chimeEnv.gain.setValueAtTime(0.0001, startTime);
    chimeEnv.gain.linearRampToValueAtTime(peak * 0.14, startTime + 0.012);
    chimeEnv.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.55);

    fundamental.connect(env);
    chime.connect(chimeEnv);
    this.routeMusicVoice(env, pan, 0.65, 0.42);
    this.routeMusicVoice(chimeEnv, pan, 0.35, 0.2);

    fundamental.start(startTime);
    chime.start(startTime);
    fundamental.stop(startTime + 1.9);
    chime.stop(startTime + 0.6);
  }

  private startOriginalSoundtrack(): void {
    if (this.musicTimer !== null) return;

    // Peaceful 72 BPM eighth-note grid (~416 ms per step, 8 steps per bar, 2 bars per chord)
    const stepMs = 416;
    const stepSec = stepMs / 1000;

    this.musicTimer = window.setInterval(() => {
      if (!this.ctx || !this.musicGain || !this.enabled || this.musicVolume <= 0.01) {
        return;
      }
      if (this.ctx.state !== 'running' || document.hidden) return;

      const step = this.musicStep++;
      const bar = Math.floor(step / 8);
      const stepInBar = step % 8;
      const chord = PROGRESSION[Math.floor(bar / 2) % PROGRESSION.length];
      const lookahead = this.ctx.currentTime + 0.06;
      const mood = this.musicMood;

      // 1. Pure open breath pad swell on every chord change
      if (step % 16 === 0) {
        const padGain = mood === 'kiln' ? 1.2 : mood === 'welcome' ? 1.05 : 0.95;
        this.playWarmPadChord(chord.pad, lookahead, stepSec * 15.8, padGain);
      }

      // 2. Gentle warm cello-register root note on downbeat
      if (stepInBar === 0) {
        this.playWarmBassNote(chord.bass, lookahead, stepSec * 5.5, 0.85);
      }

      // 3. Uncluttered felt-piano / harp arpeggio
      const arpPattern = ARP_PATTERNS[bar % ARP_PATTERNS.length];
      const noteIdx = arpPattern[stepInBar];
      if (noteIdx !== null) {
        const playArp =
          mood === 'studio' || mood === 'glaze'
            ? true
            : stepInBar % 2 === 0;
        if (playArp) {
          const idx = noteIdx % chord.arp.length;
          const pan = ((stepInBar % 4) - 1.5) * 0.18;
          const level = mood === 'welcome' ? 0.78 : 0.92;
          this.playAcousticHarpNote(chord.arp[idx], lookahead, pan, level);
        }
      }

      // 4. Pure singing melody with calm open space
      const phrase = MELODY_PHRASES[bar % MELODY_PHRASES.length];
      const melIdx = phrase[stepInBar];
      if (melIdx !== null) {
        const baseFreq = chord.melody[melIdx % chord.melody.length];
        const pan = Math.sin(step * 0.45) * 0.3;
        const level =
          mood === 'kiln'
            ? 1.08
            : mood === 'studio'
              ? 0.85 + this.activeShapingIntensity * 0.25
              : 0.9;
        this.playKalimbaSparkle(baseFreq, lookahead, pan, level);
      }
    }, stepMs);
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
    _wheelSpeed: number,
    shapingGesture: ShapingGesture,
    shapingStrength: number
  ): void {
    const isShaping = wheelActive && shapingGesture !== 'idle' && shapingStrength > 0.05;
    this.activeShapingIntensity = isShaping ? Math.min(1, shapingStrength) : 0;

    if (!this.ctx || !this.wheelGain || !this.clayGain || !this.clayFilter) {
      return;
    }
    const now = this.ctx.currentTime;

    // Keep low-frequency wheel drone silent so music stays completely free of vibration & hum
    this.wheelGain.gain.setTargetAtTime(0, now, 0.08);

    // Whisper-soft wet clay glide only while actively shaping
    const targetClayGain = isShaping ? 0.015 + shapingStrength * 0.035 : 0;
    const targetFreq =
      shapingGesture === 'pinch_neck'
        ? 680
        : shapingGesture === 'smooth'
          ? 520
          : shapingGesture === 'compress'
            ? 340
            : 440;
    this.clayGain.gain.setTargetAtTime(targetClayGain, now, 0.08);
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
    const buf =
      this.cachedSfxNoiseBuffer ??
      (this.cachedSfxNoiseBuffer = this.createNoiseBuffer(2));
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

  public playBatSwing(intensity = 0.85): void {
    if (!this.ctx || !this.sfxGain || !this.enabled) return;
    const now = this.ctx.currentTime;
    const buf =
      this.cachedSfxNoiseBuffer ??
      (this.cachedSfxNoiseBuffer = this.createNoiseBuffer(2));
    if (!buf) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.3;
    filter.frequency.setValueAtTime(240, now);
    filter.frequency.exponentialRampToValueAtTime(920, now + 0.08);
    filter.frequency.exponentialRampToValueAtTime(310, now + 0.21);

    const gain = this.ctx.createGain();
    const peak = 0.18 * Math.max(0.3, Math.min(1, intensity));
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.24);
  }

  public playCeramicCrack(intensity = 0.85): void {
    if (!this.ctx || !this.sfxGain || !this.enabled) return;
    const now = this.ctx.currentTime;
    const level = Math.max(0.3, Math.min(1, intensity));

    // Crisp dry wooden tap against fired ceramic
    const tapOsc = this.ctx.createOscillator();
    const tapGain = this.ctx.createGain();
    tapOsc.type = 'triangle';
    tapOsc.frequency.setValueAtTime(520, now);
    tapOsc.frequency.exponentialRampToValueAtTime(140, now + 0.055);
    tapGain.gain.setValueAtTime(0.22 * level, now);
    tapGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
    tapOsc.connect(tapGain);
    tapGain.connect(this.sfxGain);
    tapOsc.start(now);
    tapOsc.stop(now + 0.075);

    // Sharp brittle fracture crack noise snap
    const noiseBuf =
      this.cachedSfxNoiseBuffer ??
      (this.cachedSfxNoiseBuffer = this.createNoiseBuffer(2));
    if (noiseBuf) {
      const noiseSrc = this.ctx.createBufferSource();
      noiseSrc.buffer = noiseBuf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2600, now);
      bp.frequency.exponentialRampToValueAtTime(1400, now + 0.09);
      bp.Q.value = 1.9;
      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.2 * level, now);
      nGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
      noiseSrc.connect(bp);
      bp.connect(nGain);
      nGain.connect(this.sfxGain);
      noiseSrc.start(now);
      noiseSrc.stop(now + 0.11);
    }

    // Tight porcelain stress ring overtones
    [1880, 2640, 3420].forEach((freq, i) => {
      if (!this.ctx || !this.sfxGain) return;
      const start = now + i * 0.018;
      const ping = this.ctx.createOscillator();
      const pGain = this.ctx.createGain();
      ping.type = 'sine';
      ping.frequency.setValueAtTime(freq, start);
      ping.frequency.exponentialRampToValueAtTime(freq * 0.94, start + 0.07);
      pGain.gain.setValueAtTime(0.0001, start);
      pGain.gain.linearRampToValueAtTime(0.065 * level, start + 0.003);
      pGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.08);
      ping.connect(pGain);
      pGain.connect(this.sfxGain);
      ping.start(start);
      ping.stop(start + 0.09);
    });
  }

  public playCeramicShatter(vesselCount = 1): void {
    if (!this.ctx || !this.sfxGain || !this.enabled) return;
    const now = this.ctx.currentTime;
    const burstCount = Math.min(22, 10 + vesselCount * 4);

    // 1. Crisp wooden-bat-on-fired-clay impact thump + crack transient
    const crackOsc = this.ctx.createOscillator();
    const crackGain = this.ctx.createGain();
    crackOsc.type = 'triangle';
    crackOsc.frequency.setValueAtTime(340, now);
    crackOsc.frequency.exponentialRampToValueAtTime(75, now + 0.09);
    crackGain.gain.setValueAtTime(0.28, now);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    crackOsc.connect(crackGain);
    crackGain.connect(this.sfxGain);
    crackOsc.start(now);
    crackOsc.stop(now + 0.12);

    const noiseBuf =
      this.cachedSfxNoiseBuffer ??
      (this.cachedSfxNoiseBuffer = this.createNoiseBuffer(2));
    if (noiseBuf) {
      const noiseSrc = this.ctx.createBufferSource();
      noiseSrc.buffer = noiseBuf;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1800;
      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.24, now);
      nGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
      noiseSrc.connect(hp);
      hp.connect(nGain);
      nGain.connect(this.sfxGain);
      noiseSrc.start(now);
      noiseSrc.stop(now + 0.28);
    }

    // 2. Cascading ceramic shard clinks & scatter pings
    for (let i = 0; i < burstCount; i++) {
      const delay = (i / burstCount) * 0.36 + Math.random() * 0.05;
      const start = now + delay;
      const ping = this.ctx.createOscillator();
      const pGain = this.ctx.createGain();
      ping.type = i % 3 === 0 ? 'triangle' : 'sine';
      const baseFreq = 1350 + Math.random() * 2900;
      ping.frequency.setValueAtTime(baseFreq, start);
      ping.frequency.exponentialRampToValueAtTime(baseFreq * 0.88, start + 0.09);

      const level = (0.075 + Math.random() * 0.055) * (1 - delay * 1.4);
      pGain.gain.setValueAtTime(0.0001, start);
      pGain.gain.linearRampToValueAtTime(Math.max(0.02, level), start + 0.004);
      pGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);

      ping.connect(pGain);
      pGain.connect(this.sfxGain);
      ping.start(start);
      ping.stop(start + 0.13);
    }
  }

  public playTimeStoneRestore(): void {
    if (!this.ctx || !this.sfxGain || !this.enabled) return;
    const now = this.ctx.currentTime;

    // 1. Reverse-envelope crystalline shimmer sweep (Doctor Strange rewind feel)
    const revOsc = this.ctx.createOscillator();
    const revOsc2 = this.ctx.createOscillator();
    const revFilter = this.ctx.createBiquadFilter();
    const revGain = this.ctx.createGain();

    revOsc.type = 'sine';
    revOsc2.type = 'triangle';
    revOsc.frequency.setValueAtTime(220, now);
    revOsc.frequency.exponentialRampToValueAtTime(880, now + 2.05);
    revOsc2.frequency.setValueAtTime(330, now);
    revOsc2.frequency.exponentialRampToValueAtTime(1320, now + 2.05);

    revFilter.type = 'bandpass';
    revFilter.Q.value = 3.2;
    revFilter.frequency.setValueAtTime(420, now);
    revFilter.frequency.exponentialRampToValueAtTime(2800, now + 2.05);

    revGain.gain.setValueAtTime(0.001, now);
    revGain.gain.exponentialRampToValueAtTime(0.14, now + 1.85);
    revGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.35);

    revOsc.connect(revFilter);
    revOsc2.connect(revFilter);
    revFilter.connect(revGain);
    revGain.connect(this.sfxGain);
    revOsc.start(now);
    revOsc2.start(now);
    revOsc.stop(now + 2.4);
    revOsc2.stop(now + 2.4);

    // 2. Backwards staggered shard-reassembly crystalline chimes
    const rewindNotes = [1318.5, 1174.7, 987.8, 880.0, 784.0, 659.3, 587.3, 523.3];
    rewindNotes.forEach((f, idx) => {
      if (!this.ctx || !this.sfxGain) return;
      const noteStart = now + idx * 0.2;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f * 0.96, noteStart);
      osc.frequency.exponentialRampToValueAtTime(f, noteStart + 0.18);

      // Reverse-envelope attack (swells up sharply to a crisp cutoff)
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.08, noteStart + 0.16);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.24);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(noteStart);
      osc.stop(noteStart + 0.26);
    });

    // 3. Crisp emerald time-lock chime as vessel snaps whole at ~2.15s
    const lockTime = now + 2.12;
    [523.25, 659.25, 783.99, 1046.5].forEach((f) => {
      if (!this.ctx || !this.sfxGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, lockTime);
      gain.gain.setValueAtTime(0.0001, lockTime);
      gain.gain.linearRampToValueAtTime(0.11, lockTime + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, lockTime + 1.15);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(lockTime);
      osc.stop(lockTime + 1.2);
    });
  }

  public dispose(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    try {
      this.wheelOsc?.stop();
    } catch {
      /* already stopped */
    }
    try {
      this.claySource?.stop();
    } catch {
      /* already stopped */
    }
    try {
      this.kilnSource?.stop();
    } catch {
      /* already stopped */
    }
    this.cachedSfxNoiseBuffer = null;
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.unlocked = false;
  }
}
