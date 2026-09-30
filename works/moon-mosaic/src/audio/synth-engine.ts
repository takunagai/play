// ============================================================
// synth-engine.ts ─ Web Audio による音源（正本: docs/architecture.md §7 音響設計）
// 配線:
//   waterDrop / glassTick / pulse ─→ transientBus ─┐
//   gatherDrone ────────────────→ droneBus ────────┼→ fxIn → dry / 生成 IR Convolver
//   revealGlass / rimClicks / body → completionBus ┘        → Compressor → master → Analyser → destination
// 音声ファイル・外部 CDN は使わない。残響 IR は起動時に生成する。
// hush では transientBus / droneBus を 25ms で -60dB、Convolver の戻りを 60ms で絞る。
// 完成音 3 音は AudioContext 時刻で revealAtMs に直接スケジュールし、reveal と同時に鳴る。
// ============================================================

import type { AudioEngine, CompletionSchedule, FragmentEvent } from "./engine";
import { midiToFrequency } from "../music";
import { RING_TRAVEL_MS, SWAY_HOLD_MS } from "../tuning";
import {
  BODY_ATTACK_MS,
  BODY_DECAY_S,
  BODY_GAIN,
  BODY_MIDIS,
  COMPRESSOR_RATIO,
  COMPRESSOR_THRESHOLD_DB,
  DRONE_LPF_MAX_HZ,
  DRONE_LPF_MIN_HZ,
  DRONE_MIDIS,
  DRONE_PULSE_MOD,
  DROP_END_HZ,
  DROP_GAIN_FLEE,
  DROP_GAIN_PLACE,
  DROP_MS,
  DROP_NOISE_HZ,
  DROP_NOISE_MS,
  DROP_START_HZ,
  EIGHTH_MS,
  GLASS_PARTIALS,
  HUSH_GAIN_MS,
  HUSH_REVERB_MS,
  HUSH_TARGET_DB,
  MASTER_GAIN,
  MAX_VOICES,
  PULSE_GAIN,
  REVEAL_ATTACK_MS,
  REVEAL_GLASS_MIDIS,
  REVEAL_GLASS_PARTIALS,
  REVERB_SECONDS,
  REVERB_WET,
  RIM_CLICK_COUNT,
  RIM_CLICK_GAIN,
  RIM_CLICK_HZ,
  RIM_CLICK_MS,
  RIM_CLICK_Q,
  STEAL_FADE_MS,
} from "./audio-tuning";

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

interface GlassVoice {
  gain: GainNode;
  bornMs: number;
}

export class SynthAudioEngine implements AudioEngine {
  private context: AudioContext | null = null;
  private transientBus: GainNode | null = null;
  private droneBus: GainNode | null = null;
  private completionBus: GainNode | null = null;
  private wetReturn: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private droneOscillators: Array<{ osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode; lfoGain: GainNode }> = [];
  private analyser: AnalyserNode | null = null;
  private analyserBuffer: Float32Array<ArrayBuffer> | null = null;
  private smoothedAmp = 0;
  private followAmount = 0;
  private activeVoices = 0;
  private glassVoices: GlassVoice[] = [];
  private hushed = false;
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
    try {
      this.wire(context);
    } catch (error: unknown) {
      // Convolver 生成等の失敗時は dry 経路だけで鳴らし続ける（正本 §10）
      this.lastError = error instanceof Error ? error.message : String(error);
    }
    this.installUnlockListeners(context);
    // resume() の解決は待たない（解決しない環境で描画ループごと止まるのを防ぐ）
    context.resume().catch((error: unknown) => {
      this.lastError = error instanceof Error ? error.message : String(error);
    });
  }

  private wire(context: AudioContext): void {
    const fxIn = context.createGain();
    const transientBus = context.createGain();
    const droneBus = context.createGain();
    const completionBus = context.createGain();
    const dry = context.createGain();
    const wet = context.createGain();
    const wetReturn = context.createGain();
    const convolver = context.createConvolver();
    const compressor = context.createDynamicsCompressor();
    const master = context.createGain();
    const analyser = context.createAnalyser();

    dry.gain.value = 1 - REVERB_WET;
    wet.gain.value = REVERB_WET;
    wetReturn.gain.value = 1;
    convolver.buffer = this.buildImpulseResponse(context);
    compressor.threshold.value = COMPRESSOR_THRESHOLD_DB;
    compressor.ratio.value = COMPRESSOR_RATIO;
    master.gain.value = MASTER_GAIN;
    analyser.fftSize = 1024;

    fxIn.connect(dry).connect(compressor);
    fxIn.connect(convolver);
    convolver.connect(wetReturn).connect(wet).connect(compressor);
    compressor.connect(master).connect(analyser).connect(context.destination);

    transientBus.connect(fxIn);
    droneBus.connect(fxIn);
    completionBus.connect(fxIn);

    // 常駐ドローン: D2/A2 のサイン + triangle、LPF は follow で開く（正本 §7）
    const droneFilter = context.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = DRONE_LPF_MIN_HZ;
    droneFilter.Q.value = 0.4;
    droneFilter.connect(droneBus);
    for (const midi of DRONE_MIDIS) {
      const frequency = midiToFrequency(midi);
      const osc = context.createOscillator();
      osc.type = "sine";
      osc.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.value = 0.7;
      osc.connect(gain).connect(droneFilter);
      // 8 分拍で 3% だけ呼吸（正本 §7）
      const lfo = context.createOscillator();
      lfo.frequency.value = 1000 / EIGHTH_MS;
      const lfoGain = context.createGain();
      lfoGain.gain.value = DRONE_PULSE_MOD;
      lfo.connect(lfoGain).connect(gain.gain);
      osc.start();
      lfo.start();
      this.droneOscillators.push({ osc, lfo, gain, lfoGain });
    }
    // triangle の 1 本を薄く足す
    const triangle = context.createOscillator();
    triangle.type = "triangle";
    triangle.frequency.value = midiToFrequency(DRONE_MIDIS[1]);
    const triangleGain = context.createGain();
    triangleGain.gain.value = 0.12;
    triangle.connect(triangleGain).connect(droneFilter);
    triangle.start();
    this.droneOscillators.push({ osc: triangle, lfo: triangle, gain: triangleGain, lfoGain: triangleGain });

    this.transientBus = transientBus;
    this.droneBus = droneBus;
    this.completionBus = completionBus;
    this.wetReturn = wetReturn;
    this.droneFilter = droneFilter;
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

  /** 通常音が MAX_VOICES を超えたら最古の glassTick を 20ms で奪う（正本 §7） */
  private ensureVoiceBudget(): void {
    if (this.activeVoices < MAX_VOICES) return;
    const oldest = this.glassVoices.shift();
    if (!oldest || !this.context) return;
    const now = this.context.currentTime;
    try {
      oldest.gain.gain.cancelScheduledValues(now);
      oldest.gain.gain.setValueAtTime(oldest.gain.gain.value, now);
      oldest.gain.gain.exponentialRampToValueAtTime(0.0001, now + STEAL_FADE_MS / 1000);
    } catch {
      // 既に停止済みなら何もしない
    }
    this.activeVoices--;
  }

  /** 水滴: サインの 35ms pitch envelope + filtered noise 18ms（正本 §7） */
  private playWaterDrop(x: number, gainScale: number, noiseAmount: number, atTimeS?: number): void {
    const context = this.context;
    const bus = this.transientBus;
    if (!this.isWired || !context || !bus) return;
    this.ensureVoiceBudget();
    const startS = atTimeS ?? context.currentTime;
    const pan = x * 2 - 1;
    const voice = context.createGain();
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    voice.connect(panner).connect(bus);
    voice.gain.setValueAtTime(0.0001, startS);
    voice.gain.exponentialRampToValueAtTime(gainScale, startS + 0.004);
    voice.gain.exponentialRampToValueAtTime(0.0001, startS + DROP_MS / 1000 + 0.05);

    const osc = context.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(DROP_START_HZ, startS);
    osc.frequency.exponentialRampToValueAtTime(DROP_END_HZ, startS + DROP_MS / 1000);
    osc.connect(voice);
    osc.start(startS);
    osc.stop(startS + DROP_MS / 1000 + 0.1);
    osc.onended = () => {
      osc.disconnect();
      voice.disconnect();
      panner.disconnect();
      this.activeVoices--;
    };
    this.activeVoices++;

    if (noiseAmount > 0) {
      const noiseLength = Math.floor(context.sampleRate * (DROP_NOISE_MS / 1000));
      const noiseBuffer = context.createBuffer(1, Math.max(1, noiseLength), context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let index = 0; index < data.length; index++) {
        data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / data.length, 2);
      }
      const noiseSource = context.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      const noiseFilter = context.createBiquadFilter();
      noiseFilter.type = "bandpass";
      noiseFilter.frequency.value = DROP_NOISE_HZ;
      noiseFilter.Q.value = 1.2;
      const noiseGain = context.createGain();
      noiseGain.gain.value = noiseAmount;
      noiseSource.connect(noiseFilter).connect(noiseGain).connect(voice);
      noiseSource.start(startS);
      noiseSource.onended = () => {
        noiseSource.disconnect();
        noiseFilter.disconnect();
        noiseGain.disconnect();
      };
    }
  }

  /** 短いグラス音（部分音比 1 / 2.76 / 5.4。正本 §7） */
  private playGlassTick(midi: number, x: number, atTimeS?: number): void {
    const context = this.context;
    const bus = this.transientBus;
    if (!this.isWired || !context || !bus) return;
    this.ensureVoiceBudget();
    const startS = atTimeS ?? context.currentTime;
    const frequency = midiToFrequency(midi);
    const voice = context.createGain();
    const panner = context.createStereoPanner();
    panner.pan.value = x * 2 - 1;
    voice.connect(panner).connect(bus);
    voice.gain.setValueAtTime(0.0001, startS);
    voice.gain.exponentialRampToValueAtTime(1, startS + 0.006);
    voice.gain.exponentialRampToValueAtTime(0.0001, startS + GLASS_PARTIALS[0][2] + 0.05);
    this.glassVoices.push({ gain: voice, bornMs: performance.now() });
    if (this.glassVoices.length > 8) this.glassVoices.shift();

    let remaining = GLASS_PARTIALS.length;
    for (const [ratio, gain, decay] of GLASS_PARTIALS) {
      const oscillator = context.createOscillator();
      const partialGain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency * ratio;
      partialGain.gain.value = gain;
      oscillator.connect(partialGain).connect(voice);
      oscillator.start(startS);
      oscillator.stop(startS + decay + 0.1);
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
    this.activeVoices++;
  }

  flee(event: Pick<FragmentEvent, "x" | "y" | "speed">): void {
    if (!this.isWired || this.hushed) return;
    // 速度でノイズ量を少し増やし、x で pan（正本 §5 / §7）
    this.playWaterDrop(event.x, DROP_GAIN_FLEE, 0.3 + event.speed * 0.7);
  }

  follow(amount: number): void {
    // ドローンのフィルタをわずかに開く。個別音は鳴らさない（正本 §5）
    this.followAmount += (Math.min(1, Math.max(0, amount)) - this.followAmount) * 0.08;
    if (!this.droneFilter || !this.context) return;
    const target = DRONE_LPF_MIN_HZ + (DRONE_LPF_MAX_HZ - DRONE_LPF_MIN_HZ) * this.followAmount;
    this.droneFilter.frequency.setTargetAtTime(target, this.context.currentTime, 0.12);
  }

  place(event: FragmentEvent): void {
    if (!this.isWired || this.hushed) return;
    this.playWaterDrop(event.x, DROP_GAIN_PLACE, 0.2 + event.speed * 0.3);
    const midi = event.collected <= 0 ? 62 : midiForEvent(event);
    this.playGlassTick(midi, event.x);
  }

  /** hush: transient / drone を 25ms で -60dB、Convolver の戻りを 60ms で絞る（正本 §7） */
  private enterHush(): void {
    const context = this.context;
    if (!context || !this.transientBus || !this.droneBus || !this.wetReturn) return;
    const now = context.currentTime;
    const target = Math.pow(10, HUSH_TARGET_DB / 20);
    for (const bus of [this.transientBus, this.droneBus]) {
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(bus.gain.value, now);
      bus.gain.exponentialRampToValueAtTime(target, now + HUSH_GAIN_MS / 1000);
    }
    this.wetReturn.gain.cancelScheduledValues(now);
    this.wetReturn.gain.setValueAtTime(this.wetReturn.gain.value, now);
    this.wetReturn.gain.exponentialRampToValueAtTime(target, now + HUSH_REVERB_MS / 1000);
    this.hushed = true;
  }

  /** startS（AudioContext 時刻）に 3 音を同時開始する（正本 §7） */
  private fireCompletion(startS: number): void {
    const context = this.context;
    const completionBus = this.completionBus;
    if (!context || !completionBus) return;
    const now = startS;
    // 高いグラスハープ（D6/A6 と非整数倍音。attack 18ms、decay 4.8s）
    for (const midi of REVEAL_GLASS_MIDIS) {
      const frequency = midiToFrequency(midi);
      const voice = context.createGain();
      voice.connect(completionBus);
      voice.gain.setValueAtTime(0.0001, now);
      voice.gain.exponentialRampToValueAtTime(1, now + REVEAL_ATTACK_MS / 1000);
      voice.gain.exponentialRampToValueAtTime(0.0001, now + REVEAL_GLASS_PARTIALS[0][2] + 0.2);
      for (const [ratio, gain, decay] of REVEAL_GLASS_PARTIALS) {
        const oscillator = context.createOscillator();
        const partialGain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency * ratio;
        partialGain.gain.value = gain;
        oscillator.connect(partialGain).connect(voice);
        oscillator.start(now);
        oscillator.stop(now + decay + 0.3);
        oscillator.onended = () => {
          oscillator.disconnect();
          partialGain.disconnect();
        };
      }
      this.activeVoices++;
    }
    // 低い胴鳴り: D2 73.4Hz + D3 146.8Hz（小型スピーカー用に D3 を薄く）
    for (const [index, midi] of BODY_MIDIS.entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = index === 0 ? "sine" : "triangle";
      oscillator.frequency.value = midiToFrequency(midi);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(index === 0 ? BODY_GAIN : BODY_GAIN * 0.3, now + BODY_ATTACK_MS / 1000);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + BODY_DECAY_S);
      oscillator.connect(gain).connect(completionBus);
      oscillator.start(now);
      oscillator.stop(now + BODY_DECAY_S + 0.2);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      this.activeVoices++;
    }
    // 輪郭クリック列: band-pass noise の 12 個の短いクリックを 900ms で一周（正本 §7）
    for (let index = 0; index < RIM_CLICK_COUNT; index++) {
      const progress = index / (RIM_CLICK_COUNT - 1);
      const angle = -Math.PI / 2 + progress * Math.PI * 2;
      const clickTimeS = now + progress * 0.9;
      const pan = Math.cos(angle);
      const noiseLength = Math.floor(context.sampleRate * (RIM_CLICK_MS / 1000));
      const noiseBuffer = context.createBuffer(1, Math.max(1, noiseLength), context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let sample = 0; sample < data.length; sample++) {
        data[sample] = (Math.random() * 2 - 1) * Math.pow(1 - sample / data.length, 2);
      }
      const source = context.createBufferSource();
      source.buffer = noiseBuffer;
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = RIM_CLICK_HZ;
      filter.Q.value = RIM_CLICK_Q;
      const gain = context.createGain();
      gain.gain.value = RIM_CLICK_GAIN;
      const panner = context.createStereoPanner();
      panner.pan.value = pan;
      source.connect(filter).connect(gain).connect(panner).connect(completionBus);
      source.start(clickTimeS);
      source.onended = () => {
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
        panner.disconnect();
      };
    }
  }

  complete(): CompletionSchedule {
    const nowMs = performance.now();
    const revealAtMs = nowMs + 150;
    const schedule: CompletionSchedule = {
      revealAtMs,
      // swayAtMs は sway の開始時刻（reveal 終了）。spawningAtMs は sway の終了＝spawning の開始時刻。
      // main.ts 側で swayAtMs へ再加算しない（レビュー MF-1）。正本 §3: reveal 900ms → sway 2400ms
      ringEndAtMs: revealAtMs + RING_TRAVEL_MS,
      swayAtMs: revealAtMs + RING_TRAVEL_MS,
      spawningAtMs: revealAtMs + RING_TRAVEL_MS + SWAY_HOLD_MS,
    };
    if (this.isWired && this.context) {
      this.enterHush();
      // 完成音 3 音は AudioContext 時刻で revealAt に直接スケジュールする（レビュー V-2）。
      // 無音タイマー（音声出力への接続は gain 0 を含め一切不可）も onended 遅延方式も使わない
      const delayS = Math.max(0, revealAtMs - performance.now()) / 1000;
      this.fireCompletion(this.context.currentTime + delayS);
    }
    return schedule;
  }

  resetCycle(): void {
    const context = this.context;
    if (!context || !this.transientBus || !this.droneBus || !this.wetReturn) return;
    const now = context.currentTime;
    for (const bus of [this.transientBus, this.droneBus]) {
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(1, now);
    }
    this.wetReturn.gain.cancelScheduledValues(now);
    this.wetReturn.gain.setValueAtTime(1, now);
    this.hushed = false;
    this.followAmount = 0;
  }

  /** 8 分拍の pulse（現在の回収数まで上がった音階度を短く。正本 §5 / §7） */
  pulse(collected: number, x: number): void {
    if (!this.isWired || this.hushed) return;
    const midi = collected <= 0 ? 62 : midiForCollectedPublic(collected);
    const context = this.context;
    const bus = this.transientBus;
    if (!context || !bus) return;
    this.ensureVoiceBudget();
    const now = context.currentTime;
    const frequency = midiToFrequency(midi);
    const voice = context.createGain();
    const panner = context.createStereoPanner();
    panner.pan.value = x * 2 - 1;
    voice.connect(panner).connect(bus);
    voice.gain.setValueAtTime(0.0001, now);
    voice.gain.exponentialRampToValueAtTime(PULSE_GAIN, now + 0.005);
    voice.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    oscillator.connect(voice);
    oscillator.start(now);
    oscillator.stop(now + 0.24);
    oscillator.onended = () => {
      oscillator.disconnect();
      voice.disconnect();
      panner.disconnect();
      this.activeVoices--;
    };
    this.activeVoices++;
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
      hushed: this.hushed,
      lastAudioError: this.lastError,
    };
  }
}

// 循環 import を避けるため music.ts の純粋関数をここで参照する
import { midiForCollected } from "../music";
function midiForEvent(event: FragmentEvent): number {
  return midiForCollected(event.collected, 12);
}
function midiForCollectedPublic(collected: number): number {
  return midiForCollected(collected, 12);
}
