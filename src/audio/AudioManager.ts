import type { ShapingGesture, StudioSettings } from '../types.ts';

export type MusicMood = 'welcome' | 'studio' | 'glaze' | 'kiln' | 'gallery';

interface ChordSpec {
  bass: number;
  pad: number[];
  arp: number[];
  melody: number[];
}

// 100% original procedural harmonic progression (A & B sections, C Major / A Minor / F Lydian warmth)
const PROGRESSION: ChordSpec[] = [
  // Section A: Sunlit Courtyard
  {
    // Fmaj9
    bass: 87.31, // F2
    pad: [174.61, 220.0, 261.63, 329.63, 392.0], // F3 A3 C4 E4 G4
    arp: [261.63, 329.63, 392.0, 440.0, 523.25, 659.25],
    melody: [523.25, 587.33, 659.25, 783.99, 880.0],
  },
  {
    // G6
    bass: 98.0, // G2
    pad: [196.0, 246.94, 293.66, 329.63, 392.0], // G3 B3 D4 E4 G4
    arp: [293.66, 329.63, 392.0, 493.88, 587.33, 783.99],
    melody: [587.33, 659.25, 783.99, 880.0, 987.77],
  },
  {
    // Em7
    bass: 82.41, // E2
    pad: [164.81, 196.0, 246.94, 293.66, 392.0], // E3 G3 B3 D4 G4
    arp: [246.94, 293.66, 392.0, 493.88, 587.33, 659.25],
    melody: [493.88, 587.33, 659.25, 783.99, 987.77],
  },
  {
    // Am9
    bass: 110.0, // A2
    pad: [220.0, 246.94, 261.63, 329.63, 392.0], // A3 B3 C4 E4 G4
    arp: [261.63, 329.63, 392.0, 493.88, 523.25, 659.25],
    melody: [523.25, 659.25, 783.99, 880.0, 1046.5],
  },
  // Section B: Artisan Flow
  {
    // Dm9
    bass: 73.42, // D2
    pad: [146.83, 174.61, 220.0, 261.63, 329.63], // D3 F3 A3 C4 E4
    arp: [220.0, 261.63, 329.63, 349.23, 440.0, 523.25],
    melody: [523.25, 587.33, 659.25, 698.46, 880.0],
  },
  {
    // G13sus4
    bass: 98.0, // G2
    pad: [196.0, 261.63, 293.66, 329.63, 440.0], // G3 C4 D4 E4 A4
    arp: [261.63, 293.66, 329.63, 392.0, 440.0, 587.33],
    melody: [587.33, 659.25, 783.99, 880.0, 1046.5],
  },
  {
    // Cmaj9
    bass: 65.41, // C2
    pad: [130.81, 196.0, 246.94, 293.66, 329.63], // C3 G3 B3 D4 E4
    arp: [246.94, 293.66, 329.63, 392.0, 493.88, 587.33],
    melody: [523.25, 587.33, 659.25, 783.99, 987.77],
  },
  {
    // G/B -> Am7 lift
    bass: 123.47, // B2
    pad: [196.0, 246.94, 293.66, 392.0, 440.0], // G3 B3 D4 G4 A4
    arp: [246.94, 293.66, 392.0, 440.0, 587.33, 783.99],
    melody: [587.33, 659.25, 783.99, 880.0, 1174.66],
  },
];

// Fingerpicked eighth-note arpeggio index patterns (8 steps per bar)
const ARP_PATTERNS: number[][] = [
  [0, 2, 4, 3, 5, 4, 2, 1],
  [0, 3, 2, 4, 5, 3, 4, 2],
  [1, 2, 4, 5, 3, 4, 2, 0],
];

// Lyrical pentatonic motif step triggers (null = rest for breathing room)
const MELODY_PHRASES: Array<Array<number | null>> = [
  [2, null, 3, 4, null, 3, 2, null],
  [null, 1, 2, null, 4, null, 3, 2],
  [4, null, 3, null, 2, 1, 2, null],
  [0, null, 2, 3, null, 4, null, 3],
];

/**
 * 100% Procedural, Copyright-Free Web Audio API Soundtrack & Tactile Pottery Audio Engine.
 * Generates stereo courtyard reverb, warm acoustic harp arpeggios, lush Rhodes-like pads,
 * upright bass, expressive kalimba melodies, and responsive clay/kiln SFX entirely in code.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;

  // Music mastering & spatial FX buses
  private musicDryBus: GainNode | null = null;
  private musicReverbSend: GainNode | null = null;
  private musicDelaySend: GainNode | null = null;

  // Continuous wheel & clay shaping nodes
  private wheelOsc: OscillatorNode | null = null;
  private wheelGain: GainNode | null = null;
  private clayFilter: BiquadFilterNode | null = null;
  private clayGain: GainNode | null = null;
  private kilnFireGain: GainNode | null = null;

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

  private createReverbImpulse(seconds = 2.6, decay = 2.3): AudioBuffer | null {
    if (!this.ctx) return null;
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const impulse = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const channel = impulse.getChannelData(ch);
      let prev = 0;
      for (let i = 0; i < length; i++) {
        const env = Math.pow(1 - i / length, decay);
        // Gentle low-passed noise tail for warm sunlit courtyard acoustics
        const white = (Math.random() * 2 - 1) * env;
        prev = prev * 0.62 + white * 0.38;
        channel[i] = prev * 0.75;
      }
    }
    return impulse;
  }

  private setupMusicBuses(): void {
    if (!this.ctx || !this.musicGain) return;

    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 18;
    compressor.ratio.value = 3.2;
    compressor.attack.value = 0.02;
    compressor.release.value = 0.25;
    compressor.connect(this.musicGain);

    this.musicDryBus = this.ctx.createGain();
    this.musicDryBus.gain.value = 0.85;
    this.musicDryBus.connect(compressor);

    // Stereo courtyard reverb send
    const impulse = this.createReverbImpulse(2.5, 2.2);
    if (impulse) {
      const convolver = this.ctx.createConvolver();
      convolver.buffer = impulse;
      const wetFilter = this.ctx.createBiquadFilter();
      wetFilter.type = 'lowpass';
      wetFilter.frequency.value = 3400;
      this.musicReverbSend = this.ctx.createGain();
      this.musicReverbSend.gain.value = 0.42;
      this.musicReverbSend.connect(convolver);
      convolver.connect(wetFilter);
      wetFilter.connect(compressor);
    }

    // Subtle stereo dotted-eighth echo send
    const delayL = this.ctx.createDelay(1.0);
    const delayR = this.ctx.createDelay(1.0);
    delayL.delayTime.value = 0.34;
    delayR.delayTime.value = 0.51;

    const fbL = this.ctx.createGain();
    const fbR = this.ctx.createGain();
    fbL.gain.value = 0.24;
    fbR.gain.value = 0.22;

    const delayFilter = this.ctx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = 1900;

    const merger = this.ctx.createChannelMerger(2);
    this.musicDelaySend = this.ctx.createGain();
    this.musicDelaySend.gain.value = 0.2;

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

  private routeMusicVoice(node: AudioNode, pan: number, reverbAmt = 0.55, delayAmt = 0.3): void {
    if (!this.ctx || !this.musicDryBus) return;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.85, Math.min(0.85, pan));
    node.connect(panner);
    panner.connect(this.musicDryBus);

    if (this.musicReverbSend && reverbAmt > 0) {
      const revSend = this.ctx.createGain();
      revSend.gain.value = reverbAmt;
      panner.connect(revSend);
      revSend.connect(this.musicReverbSend);
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

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(520, startTime);
    filter.frequency.linearRampToValueAtTime(1180, startTime + durationSec * 0.45);
    filter.frequency.linearRampToValueAtTime(620, startTime + durationSec);
    filter.Q.value = 0.9;

    const env = this.ctx.createGain();
    const peak = 0.042 * gainScale;
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(peak, startTime + 0.85);
    env.gain.setValueAtTime(peak * 0.85, startTime + durationSec - 0.9);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec + 0.15);

    filter.connect(env);
    this.routeMusicVoice(env, 0, 0.8, 0.05);

    freqs.forEach((f, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      osc.type = idx % 2 === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(f, startTime);
      osc.detune.setValueAtTime((idx - 2) * 3.5, startTime);
      osc.connect(filter);
      osc.start(startTime);
      osc.stop(startTime + durationSec + 0.2);
    });
  }

  private playAcousticHarpNote(freq: number, startTime: number, pan: number, level = 1): void {
    if (!this.ctx || !this.musicDryBus) return;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2600, startTime);
    filter.frequency.exponentialRampToValueAtTime(520, startTime + 0.85);
    filter.Q.value = 1.2;

    const env = this.ctx.createGain();
    const peak = 0.085 * level;
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(peak, startTime + 0.014);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.45);

    // Body fundamental + warm 2nd harmonic
    const osc1 = this.ctx.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(freq, startTime);

    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 2, startTime);
    const overtoneGain = this.ctx.createGain();
    overtoneGain.gain.value = 0.22;

    osc1.connect(filter);
    osc2.connect(overtoneGain);
    overtoneGain.connect(filter);
    filter.connect(env);
    this.routeMusicVoice(env, pan, 0.65, 0.45);

    osc1.start(startTime);
    osc2.start(startTime);
    osc1.stop(startTime + 1.5);
    osc2.stop(startTime + 1.5);
  }

  private playWarmBassNote(freq: number, startTime: number, durationSec: number, level = 1): void {
    if (!this.ctx || !this.musicDryBus) return;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(280, startTime);
    filter.frequency.exponentialRampToValueAtTime(140, startTime + durationSec);

    const env = this.ctx.createGain();
    const peak = 0.14 * level;
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(peak, startTime + 0.035);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(freq, startTime);

    const body = this.ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(freq * 2, startTime);
    const bodyGain = this.ctx.createGain();
    bodyGain.gain.value = 0.24;

    sub.connect(filter);
    body.connect(bodyGain);
    bodyGain.connect(filter);
    filter.connect(env);
    this.routeMusicVoice(env, 0, 0.15, 0);

    sub.start(startTime);
    body.start(startTime);
    sub.stop(startTime + durationSec + 0.05);
    body.stop(startTime + durationSec + 0.05);
  }

  private playKalimbaSparkle(freq: number, startTime: number, pan: number, level = 1): void {
    if (!this.ctx || !this.musicDryBus) return;

    const env = this.ctx.createGain();
    const peak = 0.055 * level;
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(peak, startTime + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.35);

    const fundamental = this.ctx.createOscillator();
    fundamental.type = 'sine';
    fundamental.frequency.setValueAtTime(freq, startTime);

    // Subtle bell tine overtone (3x harmonic, short decay)
    const tine = this.ctx.createOscillator();
    tine.type = 'sine';
    tine.frequency.setValueAtTime(freq * 3, startTime);
    const tineEnv = this.ctx.createGain();
    tineEnv.gain.setValueAtTime(0.0001, startTime);
    tineEnv.gain.linearRampToValueAtTime(peak * 0.35, startTime + 0.004);
    tineEnv.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.18);

    fundamental.connect(env);
    tine.connect(tineEnv);
    this.routeMusicVoice(env, pan, 0.78, 0.55);
    this.routeMusicVoice(tineEnv, pan, 0.4, 0.25);

    fundamental.start(startTime);
    tine.start(startTime);
    fundamental.stop(startTime + 1.4);
    tine.stop(startTime + 0.22);
  }

  private startOriginalSoundtrack(): void {
    if (this.musicTimer !== null) return;

    // 84 BPM eighth-note grid (~357 ms per step, 8 steps per bar, 2 bars per chord)
    const stepMs = 357;
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
      const lookahead = this.ctx.currentTime + 0.05;
      const mood = this.musicMood;

      // 1. Lush pad chord swell on every chord change (every 2 bars)
      if (step % 16 === 0) {
        const padGain = mood === 'kiln' ? 1.35 : mood === 'welcome' ? 1.15 : 1.0;
        const padFreqs =
          mood === 'kiln'
            ? chord.pad.map((f) => f * 1.0) // Full resonant chord
            : chord.pad;
        this.playWarmPadChord(padFreqs, lookahead, stepSec * 15.8, padGain);
      }

      // 2. Warm upright bass root & fifth pulse
      if (mood !== 'welcome' || bar % 2 === 0) {
        if (stepInBar === 0) {
          this.playWarmBassNote(chord.bass, lookahead, stepSec * 3.5, 0.95);
        } else if (stepInBar === 5 && (mood === 'studio' || mood === 'glaze')) {
          this.playWarmBassNote(chord.bass * 1.5, lookahead, stepSec * 2.2, 0.68);
        }
      }

      // 3. Acoustic nylon harp arpeggio (gentle in welcome/gallery, flowing in studio/glaze)
      const arpPattern = ARP_PATTERNS[bar % ARP_PATTERNS.length];
      const arpPlay =
        mood === 'studio' || mood === 'glaze'
          ? true
          : mood === 'kiln'
            ? stepInBar % 2 === 0
            : stepInBar === 0 || stepInBar === 2 || stepInBar === 4 || stepInBar === 6;

      if (arpPlay) {
        const idx = arpPattern[stepInBar] % chord.arp.length;
        const pan = ((stepInBar % 4) - 1.5) * 0.24;
        const level = mood === 'welcome' ? 0.72 : 0.92;
        this.playAcousticHarpNote(chord.arp[idx], lookahead, pan, level);
      }

      // 4. Lyrical kalimba / celesta melody + kiln/shaping shimmer
      const phrase = MELODY_PHRASES[bar % MELODY_PHRASES.length];
      const melIdx = phrase[stepInBar];
      if (melIdx !== null) {
        const playMelody =
          mood === 'glaze' ||
          mood === 'kiln' ||
          (mood === 'studio' && (bar % 2 === 1 || this.activeShapingIntensity > 0.1)) ||
          (mood !== 'studio' && bar % 2 === 1);

        if (playMelody) {
          const baseFreq = chord.melody[melIdx % chord.melody.length];
          const freq = mood === 'glaze' ? baseFreq * 1.0 : baseFreq;
          const pan = Math.sin(step * 0.7) * 0.45;
          const level =
            mood === 'kiln'
              ? 1.15
              : mood === 'studio'
                ? 0.8 + this.activeShapingIntensity * 0.4
                : 0.85;
          this.playKalimbaSparkle(freq, lookahead, pan, level);
        }
      } else if (mood === 'kiln' && stepInBar % 2 === 1) {
        // Golden ascending sparkles during kiln firing
        const sparkleFreq = chord.melody[(stepInBar + bar) % chord.melody.length] * 1.5;
        this.playKalimbaSparkle(sparkleFreq, lookahead, (Math.random() - 0.5) * 0.7, 0.7);
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
    wheelSpeed: number,
    shapingGesture: ShapingGesture,
    shapingStrength: number
  ): void {
    const isShaping = wheelActive && shapingGesture !== 'idle' && shapingStrength > 0.05;
    this.activeShapingIntensity = isShaping ? Math.min(1, shapingStrength) : 0;

    if (!this.ctx || !this.wheelGain || !this.wheelOsc || !this.clayGain || !this.clayFilter) {
      return;
    }
    const now = this.ctx.currentTime;

    const targetWheelGain = wheelActive ? 0.045 + wheelSpeed * 0.02 : 0;
    this.wheelGain.gain.setTargetAtTime(targetWheelGain, now, 0.08);
    this.wheelOsc.frequency.setTargetAtTime(58 + wheelSpeed * 28, now, 0.1);

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
