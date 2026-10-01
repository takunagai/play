// ============================================================
// synth-engine.ts ─ Web Audio による切断音・ガラス鐘・砂の微音・再生ドローン
// 配線: cutChime / glassStep / sand → glassBus ─┐
//       cutImpact / regrowDrone → bodyBus ──────┼→ fxIn → dry / Convolver(生成 IR) → Compressor → master → Analyser → destination
// 音声ファイル・外部 CDN は使わない。正本は docs/architecture.md 第 5・6 節。
// ============================================================

import { computeCutSchedule, type AudioEngine, type CutEvent, type CutSchedule, type NoteEvent } from "./engine";
import { midiToFrequency, collapseMidi } from "../music";
import {
  COMPRESSOR_RATIO,
  COMPRESSOR_THRESHOLD_DB,
  CUT_CHIME_DECAY_SECONDS,
  CUT_CHIME_FREQ_HZ,
  CUT_CHIME_GAIN,
  CUT_CHIME_PARTIAL_GAIN,
  CUT_CHIME_PARTIAL_RATIO,
  CUT_IMPACT_DEEP_BOOST,
  CUT_IMPACT_DECAY_SECONDS,
  CUT_IMPACT_FREQ_HZ,
  CUT_IMPACT_GAIN,
  CUT_IMPACT_NOISE_GAIN,
  CUT_IMPACT_OCTAVE_GAIN,
  GLASS_BUS_DUCK_DB,
  GLASS_BUS_DUCK_VOICES,
  GLASS_STEP_DECAY_MIN_SECONDS,
  GLASS_STEP_DECAY_SECONDS,
  GLASS_STEP_GAIN,
  GLASS_STEP_NOISE_GAIN,
  GLASS_STEP_PARTIAL_GAINS,
  GLASS_STEP_PARTIAL_RATIOS,
  MASTER_GAIN,
  MAX_VOICES,
  REGROW_DRONE_GAIN,
  REGROW_DRONE_LPF_END_HZ,
  REGROW_DRONE_LPF_START_HZ,
  REGROW_DRONE_MIDIS,
  REGROW_DRONE_RELEASE_SECONDS,
  REVERB_SECONDS,
  REVERB_WET,
  SAND_NOTE_DECAY_SECONDS,
  SAND_NOTE_GAIN,
  SAND_NOTE_MIN_INTERVAL_MS,
  SAND_NOTE_OCTAVE_GAIN,
  SAND_TICK_DECAY_SECONDS,
  SAND_TICK_FILTER_HZ,
  SAND_TICK_GAIN,
  SAND_TICK_MERGE_WINDOW_MS,
  SAND_TICK_TONE_HZ,
  STEAL_FADE_SECONDS,
} from "./audio-tuning";

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/** 進行中の 1 発。同時発音上限の管理と音の stolen 判定に使う */
interface ActiveVoice {
  gain: GainNode;
  startsAtSeconds: number;
  stopAtSeconds: number;
  /** cutChime と cutImpact は奪わない（正本 §6） */
  isProtected: boolean;
}

export class SynthAudioEngine implements AudioEngine {
  private context: AudioContext | null = null;
  private glassBus: GainNode | null = null;
  private bodyBus: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserBuffer: Float32Array<ArrayBuffer> | null = null;
  private smoothedAmp = 0;
  private lastError = "";
  private isWired = false;
  private voices: ActiveVoice[] = [];
  /** glassBus の自動減衰の対象になる直近の glassStep の開始時刻 */
  private recentGlassStarts: number[] = [];
  private lastSandNoteAtMs = 0;
  private lastSandTickAtSeconds = -1;
  private regrowDrone: { gain: GainNode; lpf: BiquadFilterNode; oscillators: OscillatorNode[] } | null = null;
  private energy = 0;

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
    const glassBus = context.createGain();
    const bodyBus = context.createGain();
    const dry = context.createGain();
    const wet = context.createGain();
    const convolver = context.createConvolver();
    const compressor = context.createDynamicsCompressor();
    const master = context.createGain();
    const analyser = context.createAnalyser();

    dry.gain.value = 1 - REVERB_WET;
    wet.gain.value = REVERB_WET;
    compressor.threshold.value = COMPRESSOR_THRESHOLD_DB;
    compressor.ratio.value = COMPRESSOR_RATIO;
    compressor.knee.value = 6;
    master.gain.value = MASTER_GAIN;
    analyser.fftSize = 1024;

    try {
      convolver.buffer = this.buildImpulseResponse(context);
      fxIn.connect(dry).connect(compressor);
      fxIn.connect(convolver).connect(wet).connect(compressor);
    } catch (error) {
      // Convolver の生成に失敗したら dry 経路だけで鳴らす（正本 §9）
      this.lastError = error instanceof Error ? error.message : String(error);
      fxIn.connect(dry).connect(compressor);
    }
    glassBus.connect(fxIn);
    bodyBus.connect(fxIn);
    compressor.connect(master).connect(analyser).connect(context.destination);

    this.glassBus = glassBus;
    this.bodyBus = bodyBus;
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

  // ---- 契約の実装 ----

  beginCut(event: CutEvent): CutSchedule {
    const context = this.context;
    const nowMs = performance.now();
    const schedule = computeCutSchedule(event, nowMs);
    if (!this.isWired || !context || !this.glassBus || !this.bodyBus) return schedule;
    // AudioContext が running のときだけ先行予約する。未解錠なら視覚だけ進む
    // （途中で解錠されても過去の時刻をまとめて鳴らさない。正本 §5）
    if (context.state !== "running") return schedule;

    const ctxOf = (scheduleMs: number): number => context.currentTime + (scheduleMs - nowMs) / 1000;
    this.scheduleCutChime(ctxOf(schedule.cutAtMs), event.sharpness);
    this.scheduleCutImpact(ctxOf(schedule.cutAtMs), event.cutY);
    return schedule;
  }

  note(event: NoteEvent): void {
    // 砂に触れた音（sandNote）。柔らかなサイン + 2.0 倍音（正本 §6）。最大 8回/秒
    const context = this.context;
    const glassBus = this.glassBus;
    if (!this.isWired || !context || !glassBus || context.state !== "running") return;
    const nowMs = performance.now();
    if (nowMs - this.lastSandNoteAtMs < SAND_NOTE_MIN_INTERVAL_MS) return;
    this.lastSandNoteAtMs = nowMs;

    const now = context.currentTime;
    const frequency = midiToFrequency(event.midi);
    const peak = SAND_NOTE_GAIN * (0.6 + 0.8 * Math.min(1, Math.max(0, event.velocity)));
    const voice = context.createGain();
    const panner = context.createStereoPanner();
    panner.pan.value = Math.min(1, Math.max(-1, event.x * 2 - 1));
    voice.gain.setValueAtTime(0.0001, now);
    voice.gain.exponentialRampToValueAtTime(peak, now + 0.012);
    voice.gain.exponentialRampToValueAtTime(0.0001, now + SAND_NOTE_DECAY_SECONDS);
    voice.connect(panner).connect(glassBus);

    const oscillators: OscillatorNode[] = [];
    const gains: GainNode[] = [voice];
    for (const [ratio, gainScale] of [[1, 1], [2, SAND_NOTE_OCTAVE_GAIN]] as const) {
      const oscillator = context.createOscillator();
      const partialGain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency * ratio;
      partialGain.gain.value = gainScale;
      oscillator.connect(partialGain);
      partialGain.connect(panner);
      oscillator.start(now);
      oscillator.stop(now + SAND_NOTE_DECAY_SECONDS + 0.05);
      oscillators.push(oscillator);
      gains.push(partialGain);
    }
    const cleanupAtMs = (SAND_NOTE_DECAY_SECONDS + 0.1) * 1000;
    window.setTimeout(() => {
      for (const oscillator of oscillators) oscillator.disconnect();
      panner.disconnect();
      voice.disconnect();
    }, cleanupAtMs);
  }

  sandSettle(mass: number): void {
    // 着地の微音。30ms 窓内は 1 音へ束ねる（正本 §4・§6）
    const context = this.context;
    const glassBus = this.glassBus;
    if (!this.isWired || !context || !glassBus || context.state !== "running") return;
    const atSeconds = context.currentTime;
    if (atSeconds - this.lastSandTickAtSeconds < SAND_TICK_MERGE_WINDOW_MS / 1000) return;
    this.lastSandTickAtSeconds = atSeconds;

    const clampedMass = Math.min(1, Math.max(0, mass));
    const peak = SAND_TICK_GAIN * (0.5 + 0.7 * clampedMass);
    // bandpass ノイズ
    const noiseLength = Math.max(1, Math.floor(context.sampleRate * SAND_TICK_DECAY_SECONDS));
    const noiseBuffer = context.createBuffer(1, noiseLength, context.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let index = 0; index < noiseLength; index++) {
      noiseData[index] = (Math.random() * 2 - 1) * (1 - index / noiseLength);
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    filter.type = "bandpass";
    filter.frequency.value = SAND_TICK_FILTER_HZ;
    filter.Q.value = 1.2;
    envelope.gain.setValueAtTime(peak, atSeconds);
    envelope.gain.exponentialRampToValueAtTime(0.0001, atSeconds + SAND_TICK_DECAY_SECONDS);
    source.buffer = noiseBuffer;
    source.connect(filter).connect(envelope).connect(glassBus);
    source.start(atSeconds);
    // 小さなサイン
    const tone = context.createOscillator();
    const toneGain = context.createGain();
    tone.type = "sine";
    tone.frequency.value = SAND_TICK_TONE_HZ;
    toneGain.gain.setValueAtTime(peak * 0.5, atSeconds);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, atSeconds + SAND_TICK_DECAY_SECONDS);
    tone.connect(toneGain).connect(glassBus);
    tone.start(atSeconds);
    tone.stop(atSeconds + SAND_TICK_DECAY_SECONDS + 0.05);
    tone.onended = () => {
      tone.disconnect();
      toneGain.disconnect();
      filter.disconnect();
      envelope.disconnect();
      source.disconnect();
    };
  }

  setEnergy(energy: number): void {
    this.energy += (Math.min(1, Math.max(0, energy)) - this.energy) * 0.1;
  }

  /** 再生（regrowing）のドローン。progress で LPF と pitch を緩く上げる（正本 §4・§6） */
  startRegrowDrone(): void {
    const context = this.context;
    const bodyBus = this.bodyBus;
    if (!this.isWired || !context || !bodyBus || context.state !== "running") return;
    this.stopRegrowDrone(0.05);
    const lpf = context.createBiquadFilter();
    const gain = context.createGain();
    lpf.type = "lowpass";
    lpf.frequency.value = REGROW_DRONE_LPF_START_HZ;
    gain.gain.value = 0.0001;
    lpf.connect(gain).connect(bodyBus);
    const oscillators = REGROW_DRONE_MIDIS.map((midi) => {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = midiToFrequency(midi);
      oscillator.connect(lpf);
      oscillator.start();
      return oscillator;
    });
    gain.gain.exponentialRampToValueAtTime(REGROW_DRONE_GAIN, context.currentTime + 0.4);
    this.regrowDrone = { gain, lpf, oscillators };
  }

  /** 再生の進行（0..1）。LPF と pitch を緩く上げる */
  updateRegrowDrone(progress: number): void {
    const context = this.context;
    const drone = this.regrowDrone;
    if (!context || !drone) return;
    const clamped = Math.min(1, Math.max(0, progress));
    drone.lpf.frequency.setTargetAtTime(
      REGROW_DRONE_LPF_START_HZ + (REGROW_DRONE_LPF_END_HZ - REGROW_DRONE_LPF_START_HZ) * clamped,
      context.currentTime,
      0.1,
    );
    drone.oscillators.forEach((oscillator, index) => {
      const base = midiToFrequency(REGROW_DRONE_MIDIS[index]);
      oscillator.frequency.setTargetAtTime(base * (1 + 0.02 * clamped), context.currentTime, 0.2);
    });
  }

  /** 再生ドローンを停止する（ready 遷移で 180ms fade out。正本 §6） */
  stopRegrowDrone(releaseSeconds: number = REGROW_DRONE_RELEASE_SECONDS): void {
    const context = this.context;
    const drone = this.regrowDrone;
    if (!context || !drone) return;
    this.regrowDrone = null;
    const now = context.currentTime;
    try {
      drone.gain.gain.cancelScheduledValues(now);
      drone.gain.gain.setValueAtTime(Math.max(drone.gain.gain.value, 0.0001), now);
      drone.gain.gain.exponentialRampToValueAtTime(0.0001, now + releaseSeconds);
    } catch {
      // 既に停止済みなら何もしない
    }
    const stopAt = now + releaseSeconds + 0.05;
    for (const oscillator of drone.oscillators) oscillator.stop(stopAt);
    window.setTimeout(() => {
      for (const oscillator of drone.oscillators) oscillator.disconnect();
      drone.lpf.disconnect();
      drone.gain.disconnect();
    }, Math.max(0, (stopAt - context.currentTime) * 1000) + 50);
  }

  // ---- 音源 ----

  /** cutChime: 2.4kHz サイン + 2.01 倍の弱い部分音。sharpness が高いほど減衰を短く（正本 §6） */
  private scheduleCutChime(atSeconds: number, sharpness: number): void {
    const context = this.context;
    const glassBus = this.glassBus;
    if (!context || !glassBus) return;
    if (!this.makeRoom(atSeconds, context)) return;
    const clamped = Math.min(1, Math.max(0, sharpness));
    const decay = CUT_CHIME_DECAY_SECONDS * (1 - 0.5 * clamped);
    const voice = context.createGain();
    voice.connect(glassBus);
    const nodes: Array<{ osc: OscillatorNode; gain: GainNode }> = [];
    for (const [ratio, gainScale] of [[1, CUT_CHIME_GAIN], [CUT_CHIME_PARTIAL_RATIO, CUT_CHIME_GAIN * CUT_CHIME_PARTIAL_GAIN]] as const) {
      const oscillator = context.createOscillator();
      const partialGain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = CUT_CHIME_FREQ_HZ * ratio;
      partialGain.gain.setValueAtTime(0.0001, atSeconds);
      partialGain.gain.exponentialRampToValueAtTime(Math.max(gainScale, 0.0002), atSeconds + 0.004);
      partialGain.gain.exponentialRampToValueAtTime(0.0001, atSeconds + decay);
      oscillator.connect(partialGain).connect(voice);
      oscillator.start(atSeconds);
      oscillator.stop(atSeconds + decay + 0.05);
      nodes.push({ osc: oscillator, gain: partialGain });
    }
    this.voices.push({ gain: voice, startsAtSeconds: atSeconds, stopAtSeconds: atSeconds + decay + 0.1, isProtected: true });
    this.scheduleCleanup(atSeconds + decay + 0.15, nodes, voice, null);
  }

  /** cutImpact: 72Hz サイン + 144Hz 三角波 + 低域ノイズ。cutY が低いほど gain 最大 +10%（正本 §6） */
  private scheduleCutImpact(atSeconds: number, cutY: number): void {
    const context = this.context;
    const bodyBus = this.bodyBus;
    if (!context || !bodyBus) return;
    if (!this.makeRoom(atSeconds, context)) return;
    const clampedY = Math.min(1, Math.max(0, cutY));
    const boost = 1 + CUT_IMPACT_DEEP_BOOST * clampedY;
    const voice = context.createGain();
    voice.connect(bodyBus);
    const nodes: Array<{ osc: OscillatorNode; gain: GainNode }> = [];
    // サイン基音
    const sine = context.createOscillator();
    const sineGain = context.createGain();
    sine.type = "sine";
    sine.frequency.value = CUT_IMPACT_FREQ_HZ;
    sineGain.gain.setValueAtTime(0.0001, atSeconds);
    sineGain.gain.exponentialRampToValueAtTime(CUT_IMPACT_GAIN * boost, atSeconds + 0.008);
    sineGain.gain.exponentialRampToValueAtTime(0.0001, atSeconds + CUT_IMPACT_DECAY_SECONDS);
    sine.connect(sineGain).connect(voice);
    sine.start(atSeconds);
    sine.stop(atSeconds + CUT_IMPACT_DECAY_SECONDS + 0.05);
    nodes.push({ osc: sine, gain: sineGain });
    // 144Hz 三角波
    const tri = context.createOscillator();
    const triGain = context.createGain();
    tri.type = "triangle";
    tri.frequency.value = CUT_IMPACT_FREQ_HZ * 2;
    triGain.gain.setValueAtTime(0.0001, atSeconds);
    triGain.gain.exponentialRampToValueAtTime(CUT_IMPACT_GAIN * CUT_IMPACT_OCTAVE_GAIN * boost, atSeconds + 0.006);
    triGain.gain.exponentialRampToValueAtTime(0.0001, atSeconds + CUT_IMPACT_DECAY_SECONDS * 0.6);
    tri.connect(triGain).connect(voice);
    tri.start(atSeconds);
    tri.stop(atSeconds + CUT_IMPACT_DECAY_SECONDS + 0.05);
    nodes.push({ osc: tri, gain: triGain });
    // 低域ノイズ（短い減衰）
    const noiseLength = Math.max(1, Math.floor(context.sampleRate * 0.08));
    const noiseBuffer = context.createBuffer(1, noiseLength, context.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let index = 0; index < noiseLength; index++) {
      noiseData[index] = (Math.random() * 2 - 1) * (1 - index / noiseLength);
    }
    const source = context.createBufferSource();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = 320;
    noiseGain.gain.value = CUT_IMPACT_GAIN * CUT_IMPACT_NOISE_GAIN * boost;
    source.buffer = noiseBuffer;
    source.connect(noiseFilter).connect(noiseGain).connect(voice);
    source.start(atSeconds);

    this.voices.push({ gain: voice, startsAtSeconds: atSeconds, stopAtSeconds: atSeconds + CUT_IMPACT_DECAY_SECONDS + 0.1, isProtected: true });
    this.scheduleCleanup(atSeconds + CUT_IMPACT_DECAY_SECONDS + 0.15, nodes, voice, source);
  }

  /** glassStep: 崩壊段 1 個のガラス鐘。rowIndex → 下降する D ドリアン、x → pan（正本 §6）。今鳴らす */
  scheduleGlassStep(rowIndex: number, rowCount: number, normalizedX: number, sharpness: number): void {
    const context = this.context;
    const glassBus = this.glassBus;
    if (!context || !glassBus) return;
    if (context.state !== "running") return; // 未解錠で後からまとめて鳴らさない（正本 §5）
    const atSeconds = context.currentTime;
    const clampedSharpness = Math.min(1, Math.max(0, Number.isFinite(sharpness) ? sharpness : 0));
    const clampedRow = Number.isFinite(rowIndex) ? Math.max(0, Math.floor(rowIndex)) : 0;
    const clampedRowCount = Number.isFinite(rowCount) ? Math.max(1, Math.floor(rowCount)) : 1;
    const clampedX = Number.isFinite(normalizedX) ? Math.min(1, Math.max(0, normalizedX)) : 0.5;
    const decay = GLASS_STEP_DECAY_MIN_SECONDS + (GLASS_STEP_DECAY_SECONDS - GLASS_STEP_DECAY_MIN_SECONDS) * (1 - clampedSharpness);
    const previousMidi = this.lastGlassMidi;
    const midi = collapseMidi(clampedRow, clampedRowCount, previousMidi);
    this.lastGlassMidi = midi;
    const frequency = midiToFrequency(midi);
    const peak = GLASS_STEP_GAIN * (0.85 + 0.3 * this.energy);
    this.registerGlassStart(atSeconds);

    const voice = context.createGain();
    const panner = context.createStereoPanner();
    panner.pan.value = Math.min(1, Math.max(-1, clampedX * 2 - 1));
    voice.connect(panner).connect(glassBus);

    const nodes: Array<{ osc: OscillatorNode; gain: GainNode }> = [];
    let longestSeconds = 0;
    GLASS_STEP_PARTIAL_RATIOS.forEach((ratio, index) => {
      const oscillator = context.createOscillator();
      const partialGain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency * ratio;
      const gainScale = GLASS_STEP_PARTIAL_GAINS[index];
      const partialDecay = decay * (ratio === 1 ? 1 : 0.6);
      longestSeconds = Math.max(longestSeconds, partialDecay);
      partialGain.gain.setValueAtTime(0.0001, atSeconds);
      partialGain.gain.exponentialRampToValueAtTime(Math.max(peak * gainScale, 0.0002), atSeconds + 0.004);
      partialGain.gain.exponentialRampToValueAtTime(0.0001, atSeconds + partialDecay);
      oscillator.connect(partialGain).connect(voice);
      oscillator.start(atSeconds);
      oscillator.stop(atSeconds + partialDecay + 0.05);
      nodes.push({ osc: oscillator, gain: partialGain });
    });
    // 3ms の高域ノイズ（アタックの質感）
    const noiseLength = Math.max(1, Math.floor(context.sampleRate * 0.003));
    const noiseBuffer = context.createBuffer(1, noiseLength, context.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let index = 0; index < noiseLength; index++) {
      noiseData[index] = (Math.random() * 2 - 1) * (1 - index / noiseLength);
    }
    const source = context.createBufferSource();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();
    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = 6000;
    noiseGain.gain.value = peak * GLASS_STEP_NOISE_GAIN;
    source.buffer = noiseBuffer;
    source.connect(noiseFilter).connect(noiseGain).connect(voice);
    source.start(atSeconds);

    this.voices.push({ gain: voice, startsAtSeconds: atSeconds, stopAtSeconds: atSeconds + longestSeconds + 0.1, isProtected: false });
    this.applyGlassBusDuck(atSeconds);
    this.scheduleCleanup(atSeconds + longestSeconds + 0.15, nodes, voice, source);
  }

  private lastGlassMidi: number | null = null;

  private registerGlassStart(atSeconds: number): void {
    this.recentGlassStarts.push(atSeconds);
    // 古い記録を落とす（直近 1.5 秒ぶんだけ保持）
    this.recentGlassStarts = this.recentGlassStarts.filter((time) => atSeconds - time < 1.5);
  }

  /** glassStep が重なる区間は glassBus を最大 -5dB 自動減衰し、下降音列を濁らせない（正本 §6） */
  private applyGlassBusDuck(atSeconds: number): void {
    const context = this.context;
    const glassBus = this.glassBus;
    if (!context || !glassBus) return;
    const count = this.recentGlassStarts.filter((time) => atSeconds - time < 0.5).length;
    const overflow = Math.max(0, count - GLASS_BUS_DUCK_VOICES);
    if (overflow === 0) return;
    const amount = Math.min(1, overflow / GLASS_BUS_DUCK_VOICES);
    const duck = Math.pow(10, (GLASS_BUS_DUCK_DB * amount) / 20);
    glassBus.gain.cancelScheduledValues(atSeconds);
    glassBus.gain.setValueAtTime(Math.min(glassBus.gain.value, 1), atSeconds);
    glassBus.gain.linearRampToValueAtTime(duck, atSeconds + 0.02);
    glassBus.gain.linearRampToValueAtTime(1, atSeconds + 0.25);
  }

  /** 同時発音上限。最古の sandTick（非 protected・最古）から奪う。cutChime と cutImpact は奪わない（正本 §6） */
  private makeRoom(atSeconds: number, context: AudioContext): boolean {
    this.pruneVoices(atSeconds);
    const overlapping = this.voices.filter(
      (voice) => voice.startsAtSeconds <= atSeconds && voice.stopAtSeconds > atSeconds,
    );
    if (overlapping.length < MAX_VOICES) return true;
    const required = overlapping.length - MAX_VOICES + 1;
    const stealable = overlapping.filter((voice) => !voice.isProtected).slice(0, required);
    if (stealable.length < required) return false;
    for (const voice of stealable) {
      const fadeStart = Math.max(context.currentTime, atSeconds - STEAL_FADE_SECONDS);
      try {
        voice.gain.gain.cancelScheduledValues(fadeStart);
        voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), fadeStart);
        voice.gain.gain.exponentialRampToValueAtTime(0.0001, Math.max(fadeStart + 0.005, atSeconds));
        voice.stopAtSeconds = atSeconds;
      } catch {
        // 既に停止済みなら何もしない
      }
      this.voices = this.voices.filter((entry) => entry !== voice);
    }
    return true;
  }

  private pruneVoices(atSeconds: number): void {
    this.voices = this.voices.filter((voice) => voice.stopAtSeconds > atSeconds);
  }

  /** 発音ノードの後片付けを時刻で予約する */
  private scheduleCleanup(
    cleanupAtSeconds: number,
    nodes: Array<{ osc: OscillatorNode; gain: GainNode }>,
    voice: GainNode,
    extra: AudioBufferSourceNode | null,
  ): void {
    const context = this.context;
    if (!context) return;
    const delayMs = Math.max(0, (cleanupAtSeconds - context.currentTime) * 1000);
    window.setTimeout(() => {
      for (const node of nodes) {
        node.osc.disconnect();
        node.gain.disconnect();
      }
      if (extra) extra.disconnect();
      voice.disconnect();
      this.voices = this.voices.filter((entry) => entry.gain !== voice);
    }, delayMs);
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
      voices: this.voices.length,
      lastAudioError: this.lastError,
    };
  }
}
