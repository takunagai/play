// ============================================================
// synth-engine.ts ─ Web Audio による最小の音源（雛形。作品ごとに書き換える）
// 配線: 音源 → fxIn → dry / wet（生成 IR の Convolver）→ Compressor（リミッタ代用）→ Analyser → destination
// 音声ファイル・外部 CDN は使わない。
// ============================================================

import type { AudioEngine, NoteEvent } from "./engine";
import { midiToFrequency } from "../music";

const MASTER_GAIN = 0.5;
const REVERB_SECONDS = 2.2;
const REVERB_WET = 0.3;
const NOTE_DECAY_SECONDS = 1.2;
const MAX_VOICES = 24;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

export class SynthAudioEngine implements AudioEngine {
  private context: AudioContext | null = null;
  private fxIn: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserBuffer: Float32Array<ArrayBuffer> | null = null;
  private smoothedAmp = 0;
  private energy = 0;
  private activeVoices = 0;
  private lastError = "";
  private isWired = false;

  get isReady(): boolean {
    return this.isWired;
  }

  async start(): Promise<void> {
    if (this.context) return;
    const AudioContextClass = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!AudioContextClass) {
      this.lastError = "AudioContext 非対応";
      return;
    }
    const context = new AudioContextClass();
    this.context = context;
    this.wire(context);
    this.installUnlockListeners(context);
    // resume() の解決は待たない（解決しない環境で描画ループごと止まるのを防ぐ）
    context.resume().catch((error: unknown) => {
      this.lastError = error instanceof Error ? error.message : String(error);
    });
  }

  private wire(context: AudioContext): void {
    const fxIn = context.createGain();
    const dry = context.createGain();
    const wet = context.createGain();
    const convolver = context.createConvolver();
    const compressor = context.createDynamicsCompressor();
    const master = context.createGain();
    const analyser = context.createAnalyser();

    dry.gain.value = 1 - REVERB_WET;
    wet.gain.value = REVERB_WET;
    convolver.buffer = this.buildImpulseResponse(context);
    compressor.threshold.value = -10;
    compressor.ratio.value = 12;
    master.gain.value = MASTER_GAIN;
    analyser.fftSize = 1024;

    fxIn.connect(dry).connect(compressor);
    fxIn.connect(convolver).connect(wet).connect(compressor);
    compressor.connect(master).connect(analyser).connect(context.destination);

    this.fxIn = fxIn;
    this.analyser = analyser;
    this.analyserBuffer = new Float32Array(analyser.fftSize);
    this.isWired = true;
  }

  /** 減衰するノイズで残響の IR を生成する（外部 IR ファイル不要） */
  private buildImpulseResponse(context: AudioContext): AudioBuffer {
    const length = Math.floor(context.sampleRate * REVERB_SECONDS);
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < length; index++) {
        data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / length, 3);
      }
    }
    return buffer;
  }

  private installUnlockListeners(context: AudioContext): void {
    const unlock = (): void => {
      if (context.state === "running") return;
      context.resume().catch(() => {});
    };
    for (const type of ["pointerup", "touchend", "click", "keydown"]) {
      window.addEventListener(type, unlock, { passive: true });
    }
  }

  note(event: NoteEvent): void {
    const context = this.context;
    const fxIn = this.fxIn;
    if (!this.isWired || !context || !fxIn || this.activeVoices >= MAX_VOICES) return;

    const now = context.currentTime;
    const frequency = midiToFrequency(event.midi);
    const peak = 0.12 + 0.2 * Math.min(1, Math.max(0, event.velocity));
    const voice = context.createGain();
    const panner = context.createStereoPanner();
    panner.pan.value = event.x * 2 - 1;
    voice.gain.setValueAtTime(0.0001, now);
    voice.gain.exponentialRampToValueAtTime(peak, now + 0.008);
    voice.gain.exponentialRampToValueAtTime(0.0001, now + NOTE_DECAY_SECONDS);
    voice.connect(panner).connect(fxIn);

    // ベル風: 基音 + 非整数倍音
    const partials: Array<[number, number]> = [
      [1, 1],
      [2.76, 0.35 + 0.3 * this.energy],
      [5.4, 0.12],
    ];
    this.activeVoices++;
    let remaining = partials.length;
    for (const [ratio, gain] of partials) {
      const oscillator = context.createOscillator();
      const partialGain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency * ratio;
      partialGain.gain.value = gain;
      oscillator.connect(partialGain).connect(voice);
      oscillator.start(now);
      oscillator.stop(now + NOTE_DECAY_SECONDS + 0.05);
      oscillator.onended = () => {
        oscillator.disconnect();
        partialGain.disconnect();
        remaining--;
        if (remaining === 0) {
          voice.disconnect();
          panner.disconnect();
          this.activeVoices--;
        }
      };
    }
  }

  setEnergy(energy: number): void {
    this.energy += (Math.min(1, Math.max(0, energy)) - this.energy) * 0.1;
  }

  getAmp(): number {
    const analyser = this.analyser;
    const buffer = this.analyserBuffer;
    if (!analyser || !buffer) return 0;
    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (const sample of buffer) sum += sample * sample;
    const rms = Math.sqrt(sum / buffer.length);
    this.smoothedAmp = Math.max(rms, this.smoothedAmp * 0.9);
    return this.smoothedAmp;
  }

  getDiagnostics(): Record<string, string | number | boolean> {
    return {
      engine: "synth",
      contextState: this.context?.state ?? "none",
      isReady: this.isWired,
      voices: this.activeVoices,
      lastAudioError: this.lastError,
    };
  }
}
