/**
 * Procedural Web Audio synthesizer for CraftScape.
 * Lazily creates an AudioContext on first browser interaction and safely no-ops
 * in headless Node/Vitest environments where AudioContext is unavailable.
 */

const SURFACE_PROFILES = Object.freeze({
  stone: { freqStart: 190, freqEnd: 88, filterFreq: 950, filterType: 'bandpass', q: 1.4, dur: 0.075 },
  grass: { freqStart: 135, freqEnd: 65, filterFreq: 680, filterType: 'lowpass', q: 0.8, dur: 0.08 },
  wood: { freqStart: 255, freqEnd: 130, filterFreq: 1150, filterType: 'bandpass', q: 1.8, dur: 0.085 },
  sand: { freqStart: 120, freqEnd: 70, filterFreq: 1650, filterType: 'bandpass', q: 1.2, dur: 0.085 },
  water: { freqStart: 360, freqEnd: 720, filterFreq: 750, filterType: 'bandpass', q: 1.6, dur: 0.12 },
});

export class SoundEngine {
  constructor(options = {}) {
    this.volume = Math.min(1, Math.max(0, options.volume ?? 0.6));
    this.muted = Boolean(options.muted);
    this._ctx = null;
    this._masterGain = null;
    this._noiseBuffer = null;
  }

  _ensureContext() {
    if (this.muted || this.volume <= 0) return null;
    if (typeof window === 'undefined') return null;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this._ctx) {
      try {
        this._ctx = new AudioCtx();
        this._masterGain = this._ctx.createGain();
        this._masterGain.gain.value = this.muted ? 0 : this.volume;
        this._masterGain.connect(this._ctx.destination);
        this._noiseBuffer = this._createNoiseBuffer(this._ctx);
      } catch {
        this._ctx = null;
        return null;
      }
    }

    if (this._ctx.state === 'suspended') {
      this._ctx.resume().catch(() => {});
    }
    return this._ctx;
  }

  _createNoiseBuffer(ctx) {
    const length = Math.floor(ctx.sampleRate * 1.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  setVolume(volume) {
    this.volume = Math.min(1, Math.max(0, Number(volume) || 0));
    if (this._masterGain && this._ctx) {
      this._masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this._ctx.currentTime);
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this._masterGain && this._ctx) {
      this._masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this._ctx.currentTime);
    }
  }

  _playSurface(soundGroup, gainScale, pitchScale, durScale) {
    const ctx = this._ensureContext();
    if (!ctx || !this._masterGain || !this._noiseBuffer) return;

    const profile = SURFACE_PROFILES[soundGroup] ?? SURFACE_PROFILES.stone;
    const now = ctx.currentTime;
    const dur = profile.dur * durScale;
    const jitter = 0.92 + Math.random() * 0.16;

    // 1. Body thud oscillator
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = soundGroup === 'wood' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(profile.freqStart * pitchScale * jitter, now);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(25, profile.freqEnd * pitchScale * jitter),
      now + dur,
    );
    oscGain.gain.setValueAtTime(0.28 * gainScale, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(oscGain);
    oscGain.connect(this._masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.01);

    // 2. Filtered noise texture
    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = profile.filterType;
    filter.frequency.setValueAtTime(profile.filterFreq * pitchScale * jitter, now);
    filter.Q.setValueAtTime(profile.q, now);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.32 * gainScale, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this._masterGain);
    noise.start(now, Math.random() * 0.5, dur + 0.01);
  }

  playStep(soundGroup = 'stone') {
    this._playSurface(soundGroup, 0.35, 1.0, 0.9);
  }

  playMineHit(soundGroup = 'stone') {
    this._playSurface(soundGroup, 0.42, 1.18, 0.75);
  }

  playBreak(soundGroup = 'stone') {
    this._playSurface(soundGroup, 0.85, 0.92, 1.55);
  }

  playPlace(soundGroup = 'stone') {
    this._playSurface(soundGroup, 0.7, 0.85, 1.0);
  }

  playPickup() {
    const ctx = this._ensureContext();
    if (!ctx || !this._masterGain) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const base = 560 + Math.random() * 90;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 1.65, now + 0.085);

    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);

    osc.connect(gain);
    gain.connect(this._masterGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  playExplosion() {
    const ctx = this._ensureContext();
    if (!ctx || !this._masterGain || !this._noiseBuffer) return;

    const now = ctx.currentTime;

    // Sub-bass shockwave
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(105, now);
    sub.frequency.exponentialRampToValueAtTime(26, now + 0.55);
    subGain.gain.setValueAtTime(0.65, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    sub.connect(subGain);
    subGain.connect(this._masterGain);
    sub.start(now);
    sub.stop(now + 0.62);

    // Filtered lowpass blast roar
    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(520, now);
    filter.frequency.exponentialRampToValueAtTime(75, now + 0.85);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.75, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this._masterGain);
    noise.start(now, 0, 0.92);
  }

  playHurt() {
    const ctx = this._ensureContext();
    if (!ctx || !this._masterGain || !this._noiseBuffer) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(210, now);
    osc.frequency.exponentialRampToValueAtTime(72, now + 0.14);

    gain.gain.setValueAtTime(0.38, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(this._masterGain);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  playClick() {
    const ctx = this._ensureContext();
    if (!ctx || !this._masterGain) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(780, now);
    osc.frequency.exponentialRampToValueAtTime(480, now + 0.032);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.036);

    osc.connect(gain);
    gain.connect(this._masterGain);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  playFuse() {
    const ctx = this._ensureContext();
    if (!ctx || !this._masterGain || !this._noiseBuffer) return;

    const now = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(2100, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this._masterGain);
    noise.start(now, 0, 0.58);
  }

  dispose() {
    if (this._ctx) {
      this._ctx.close().catch(() => {});
      this._ctx = null;
      this._masterGain = null;
      this._noiseBuffer = null;
    }
  }
}
