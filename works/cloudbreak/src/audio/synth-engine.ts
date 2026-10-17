// ============================================================
// synth-engine.ts ─ Web Audio による Cloudbreak の音響
// 配線: cloudDrone / pressureTone → droneBus ─┐
//       windBed → windBus ────────────────────┼→ shared LPF → dry / 生成 IR Convolver →
//       layerBell / clearBell → bellBus ──────┘   DynamicsCompressor → master → Analyser → destination
//       clearChord ───────────────────────────┘
// 外部音源・外部 IR・外部通信は使わない。正本は docs/architecture.md 第 6〜7 節。
// ============================================================

import type { AudioEngine, BreakthroughEvent, FlightSample, LayerCrossEvent } from "./engine";
import {
  BELL_MAX_VOICES,
  BELL_STEAL_FADE_SECONDS,
  BREAKTHROUGH_FILTER_SECONDS,
  CHORD_ATTACK_SECONDS,
  CHORD_RELEASE_SECONDS,
  CHORD_VOICE_GAIN,
  CLEAR_BELL_DECAY_SECONDS,
  CLEAR_BELL_GAIN,
  CLEAR_BELL_PAN_LIMIT,
  COMP_RATIO,
  COMP_THRESHOLD_DB,
  DRONE_DETUNE_CENTS,
  DRONE_MAX_VOICES,
  DRONE_TRIANGLE_GAIN,
  DRONE_VOICE_FADE_SECONDS,
  DRONE_VOICE_GAIN,
  DRONE_VOICE_OUT_SECONDS,
  LAYER_BELL_DECAY_SECONDS,
  LAYER_BELL_GAIN,
  LIFT_ATTACK_SECONDS,
  MASTER_GAIN,
  MAX_VOICES,
  PARAM_RAMP_SECONDS,
  PARAM_UPDATE_MIN_INTERVAL_MS,
  PRESSURE_MAX_GAIN,
  REVERB_SECONDS,
  REVERB_WET,
  WIND_BAND_CENTER_HZ,
  WIND_BAND_LOW_HZ,
  WIND_BAND_Q,
  WIND_BASE_GAIN,
  WIND_PAN_AMOUNT,
  WIND_PRESS_GAIN,
  WIND_RELEASE_SECONDS,
} from "./audio-tuning";
import {
  CLEAR_BELL_MIDIS,
  CLEAR_CHORD_MIDIS,
  DRONE_VOICINGS,
  FILTER_HZ_BY_LAYER,
  LAYER_BELL_MIDI_BY_LAYER,
  midiToFrequency,
  PRESSURE_TONE_MIDIS,
  pressureFilterHz,
} from "../music";

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface DroneVoice {
  midi: number;
  envelope: GainNode;
  oscillators: OscillatorNode[];
  stopping: boolean;
}

interface ActiveBell {
  id: number;
  envelope: GainNode;
  endsAt: number;
}

const LAYER_BELL_PARTIALS: readonly (readonly [number, number])[] = [
  [1, 1],
  [2, 0.42],
  [3.01, 0.16],
];
const CLEAR_BELL_PARTIALS: readonly (readonly [number, number])[] = [
  [1, 1],
  [2, 0.35],
  [2.7, 0.12],
];

export class SynthAudioEngine implements AudioEngine {
  private context: AudioContext | null = null;
  private droneBus: GainNode | null = null;
  private dronePan: StereoPannerNode | null = null;
  private bellBus: GainNode | null = null;
  private chordGain: GainNode | null = null;
  private sharedFilter: BiquadFilterNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserBuffer: Float32Array<ArrayBuffer> | null = null;
  private pressureEnvelope: GainNode | null = null;
  private windEnvelope: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windPan: StereoPannerNode | null = null;
  private windLfoGain: GainNode | null = null;

  private droneVoices = new Map<number, DroneVoice>();
  private bells = new Map<number, ActiveBell>();
  private nextBellId = 1;
  private chordTarget = 0;
  private smoothedAmp = 0;
  private isWired = false;
  private lastError = "";
  private lastParamUpdateAt = 0;
  private lastFilterTargetHz: number = FILTER_HZ_BY_LAYER[0];
  private lastSample: FlightSample = {
    altitude: 0.04,
    velocity: 0,
    layer: 0,
    pressure: 0,
    pan: 0,
    isPressing: false,
  };

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
      // Convolver 等の失敗でも dry 経路は諦めず、入力と描画を止めない
      this.lastError = error instanceof Error ? error.message : String(error);
    }
    this.installUnlockListeners(context);
    // resume() の解決は待たない（解決しない環境で描画ループごと止まるのを防ぐ）
    context.resume().catch((error: unknown) => {
      this.lastError = error instanceof Error ? error.message : String(error);
    });
  }

  private wire(context: AudioContext): void {
    const sharedFilter = context.createBiquadFilter();
    sharedFilter.type = "lowpass";
    sharedFilter.frequency.value = this.lastFilterTargetHz;
    sharedFilter.Q.value = 0.7;

    const dry = context.createGain();
    const wet = context.createGain();
    const convolver = context.createConvolver();
    const compressor = context.createDynamicsCompressor();
    const master = context.createGain();
    const analyser = context.createAnalyser();

    dry.gain.value = 1 - REVERB_WET;
    wet.gain.value = REVERB_WET;
    convolver.buffer = this.buildImpulseResponse(context);
    compressor.threshold.value = COMP_THRESHOLD_DB;
    compressor.ratio.value = COMP_RATIO;
    master.gain.value = MASTER_GAIN;
    analyser.fftSize = 1024;

    sharedFilter.connect(dry).connect(compressor);
    sharedFilter.connect(convolver).connect(wet).connect(compressor);
    compressor.connect(master).connect(analyser).connect(context.destination);

    const droneBus = context.createGain();
    droneBus.gain.value = 1;
    const dronePan = context.createStereoPanner();
    droneBus.connect(dronePan).connect(sharedFilter);

    const windBus = context.createGain();
    windBus.gain.value = 1;
    windBus.connect(sharedFilter);

    const bellBus = context.createGain();
    bellBus.gain.value = 1;
    bellBus.connect(sharedFilter);

    const chordGain = context.createGain();
    chordGain.gain.value = 0.0001;
    chordGain.connect(sharedFilter);
    for (const midi of CLEAR_CHORD_MIDIS) {
      for (const [type, level] of [["sine", 1], ["triangle", 0.18]] as const) {
        const oscillator = context.createOscillator();
        oscillator.type = type;
        oscillator.frequency.value = midiToFrequency(midi);
        const voiceGain = context.createGain();
        voiceGain.gain.value = CHORD_VOICE_GAIN * level;
        oscillator.connect(voiceGain).connect(chordGain);
        oscillator.start();
      }
    }

    // 風: 生成ホワイトノイズ → bandpass → gain → pan。左右に異なる緩い LFO
    const noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let index = 0; index < noiseData.length; index++) noiseData[index] = Math.random() * 2 - 1;
    const windNoise = context.createBufferSource();
    windNoise.buffer = noiseBuffer;
    windNoise.loop = true;
    const windFilter = context.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = WIND_BAND_LOW_HZ;
    windFilter.Q.value = WIND_BAND_Q;
    const windEnvelope = context.createGain();
    windEnvelope.gain.value = WIND_BASE_GAIN;
    const windPan = context.createStereoPanner();
    windNoise.connect(windFilter).connect(windEnvelope).connect(windPan).connect(windBus);
    windNoise.start();

    const windLfo = context.createOscillator();
    windLfo.type = "sine";
    windLfo.frequency.value = 0.07;
    const windLfoGain = context.createGain();
    windLfoGain.gain.value = 260;
    windLfo.connect(windLfoGain).connect(windFilter.frequency);
    windLfo.start();

    const windPanLfo = context.createOscillator();
    windPanLfo.type = "sine";
    windPanLfo.frequency.value = 0.11;
    const windPanLfoGain = context.createGain();
    windPanLfoGain.gain.value = 0.3;
    windPanLfo.connect(windPanLfoGain).connect(windPan.pan);
    windPanLfo.start();

    // 圧力音: C2 + G2 の弱い倍音。gain 0 で常駐し pressure で開く
    const pressureEnvelope = context.createGain();
    pressureEnvelope.gain.value = 0.0001;
    pressureEnvelope.connect(droneBus);
    for (const [index, midi] of PRESSURE_TONE_MIDIS.entries()) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = midiToFrequency(midi);
      const toneGain = context.createGain();
      toneGain.gain.value = index === 0 ? 1 : 0.35;
      oscillator.connect(toneGain).connect(pressureEnvelope);
      oscillator.start();
    }

    this.droneBus = droneBus;
    this.dronePan = dronePan;
    this.bellBus = bellBus;
    this.chordGain = chordGain;
    this.sharedFilter = sharedFilter;
    this.pressureEnvelope = pressureEnvelope;
    this.windEnvelope = windEnvelope;
    this.windFilter = windFilter;
    this.windPan = windPan;
    this.windLfoGain = windLfoGain;
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

  beginLift(sample: FlightSample): void {
    const context = this.context;
    const windEnvelope = this.windEnvelope;
    if (!this.isWired || !context || !windEnvelope) return;
    this.lastSample = sample;
    const now = context.currentTime;
    windEnvelope.gain.cancelScheduledValues(now);
    windEnvelope.gain.setValueAtTime(Math.max(0.0001, windEnvelope.gain.value), now);
    windEnvelope.gain.linearRampToValueAtTime(this.windTargetGain(sample), now + LIFT_ATTACK_SECONDS);
    this.applyFlightParams(sample, true);
  }

  updateFlight(sample: FlightSample): void {
    this.lastSample = sample;
    if (!this.isWired || !this.context) return;
    // AudioParam の更新は 30Hz 以下に間引く
    const nowMs = performance.now();
    if (nowMs - this.lastParamUpdateAt < PARAM_UPDATE_MIN_INTERVAL_MS) return;
    this.lastParamUpdateAt = nowMs;
    this.applyFlightParams(sample, false);
  }

  endLift(sample: FlightSample): void {
    const context = this.context;
    const windEnvelope = this.windEnvelope;
    if (!this.isWired || !context || !windEnvelope) return;
    this.lastSample = { ...sample, isPressing: false };
    const now = context.currentTime;
    windEnvelope.gain.cancelScheduledValues(now);
    windEnvelope.gain.setValueAtTime(Math.max(0.0001, windEnvelope.gain.value), now);
    windEnvelope.gain.linearRampToValueAtTime(WIND_BASE_GAIN, now + WIND_RELEASE_SECONDS);
    this.applyFlightParams(this.lastSample, true);
  }

  /** 風の目標音量。上向き velocity と押下で決まり、沈降では床まで下がる */
  private windTargetGain(sample: FlightSample): number {
    const velocityNorm = clamp(sample.velocity / 0.15, 0, 1);
    const pressFloor = sample.isPressing ? 0.3 : 0;
    const level = Math.max(velocityNorm, pressFloor);
    return WIND_BASE_GAIN + WIND_PRESS_GAIN * level;
  }

  /** 間引き済みの呼び出しでのみ AudioParam を更新する */
  private applyFlightParams(sample: FlightSample, force: boolean): void {
    const context = this.context;
    if (!this.isWired || !context) return;
    const now = context.currentTime;
    const ramp = PARAM_RAMP_SECONDS;

    // 1. 層に応じた持続ドローンの追加と引き
    this.syncDroneVoices(sample.layer, now);

    // 2. 共有 LPF。蓋では pressure で 620 → 260Hz まで閉じる
    const sharedFilter = this.sharedFilter;
    if (sharedFilter) {
      const targetHz =
        sample.layer === 3
          ? FILTER_HZ_BY_LAYER[3]
          : sample.layer === 2
            ? pressureFilterHz(sample.pressure)
            : FILTER_HZ_BY_LAYER[sample.layer];
      this.lastFilterTargetHz = targetHz;
      sharedFilter.frequency.cancelScheduledValues(now);
      sharedFilter.frequency.setValueAtTime(Math.max(40, sharedFilter.frequency.value), now);
      sharedFilter.frequency.linearRampToValueAtTime(targetHz, now + ramp);
    }

    // 3. 風の帯域と定位。pressure で高域を減衰
    const windFilter = this.windFilter;
    const windPan = this.windPan;
    if (windFilter) {
      const level = clamp(clamp(sample.velocity / 0.15, 0, 1) * 0.7 + (sample.isPressing ? 0.3 : 0), 0, 1);
      const center = WIND_BAND_LOW_HZ + (WIND_BAND_CENTER_HZ - WIND_BAND_LOW_HZ) * level;
      const highCut = 1 - 0.6 * clamp(sample.pressure, 0, 1);
      windFilter.frequency.cancelScheduledValues(now);
      windFilter.frequency.setValueAtTime(Math.max(60, windFilter.frequency.value), now);
      windFilter.frequency.linearRampToValueAtTime(center * highCut, now + ramp);
    }
    if (windPan && this.windLfoGain) {
      windPan.pan.cancelScheduledValues(now);
      windPan.pan.setValueAtTime(windPan.pan.value, now);
      windPan.pan.linearRampToValueAtTime(clamp(sample.pan, -1, 1) * WIND_PAN_AMOUNT, now + ramp);
      this.windLfoGain.gain.value = 260 * highCutFromPressure(sample.pressure);
    }

    // 4. ドローン全体の定位
    const dronePan = this.dronePan;
    if (dronePan) {
      dronePan.pan.cancelScheduledValues(now);
      dronePan.pan.setValueAtTime(dronePan.pan.value, now);
      dronePan.pan.linearRampToValueAtTime(clamp(sample.pan, -1, 1) * 0.25, now + ramp);
    }

    // 5. 圧力音。最終層の pressure 0..1 で開く
    const pressureEnvelope = this.pressureEnvelope;
    if (pressureEnvelope) {
      const target = PRESSURE_MAX_GAIN * clamp(sample.pressure, 0, 1);
      pressureEnvelope.gain.cancelScheduledValues(now);
      pressureEnvelope.gain.setValueAtTime(Math.max(0.0001, pressureEnvelope.gain.value), now);
      pressureEnvelope.gain.linearRampToValueAtTime(Math.max(0.0001, target), now + ramp);
    }

    // 6. clearChord。layer 3 を外れたら 1.8s でフェードする
    if (sample.layer !== 3 && this.chordTarget === 1) {
      this.chordTarget = 0;
      const chordGain = this.chordGain;
      if (chordGain) {
        chordGain.gain.cancelScheduledValues(now);
        chordGain.gain.setValueAtTime(Math.max(0.0001, chordGain.gain.value), now);
        chordGain.gain.linearRampToValueAtTime(0.0001, now + CHORD_RELEASE_SECONDS);
      }
    }
    void force;
  }

  /** 層のボイシングに合わせて持続ドローンの声を足す / 引く（上限 5 声） */
  private syncDroneVoices(layer: 0 | 1 | 2 | 3, now: number): void {
    const context = this.context;
    const droneBus = this.droneBus;
    if (!context || !droneBus) return;
    const targetMidis = DRONE_VOICINGS[layer];

    for (const [midi, voice] of this.droneVoices) {
      if (voice.stopping || targetMidis.includes(midi)) continue;
      voice.stopping = true;
      voice.envelope.gain.cancelScheduledValues(now);
      voice.envelope.gain.setValueAtTime(Math.max(0.0001, voice.envelope.gain.value), now);
      voice.envelope.gain.linearRampToValueAtTime(0.0001, now + DRONE_VOICE_OUT_SECONDS);
      const last = voice.oscillators[voice.oscillators.length - 1];
      if (last) {
        last.onended = () => {
          for (const oscillator of voice.oscillators) oscillator.disconnect();
          voice.envelope.disconnect();
          this.droneVoices.delete(midi);
        };
        last.stop(now + DRONE_VOICE_OUT_SECONDS + 0.1);
      } else {
        this.droneVoices.delete(midi);
      }
    }

    if (this.droneVoices.size >= DRONE_MAX_VOICES) return;
    for (const midi of targetMidis) {
      if (this.droneVoices.has(midi) || this.droneVoices.size >= DRONE_MAX_VOICES) continue;
      const envelope = context.createGain();
      envelope.gain.value = 0.0001;
      envelope.connect(droneBus);
      const oscillators: OscillatorNode[] = [];
      const frequency = midiToFrequency(midi);
      for (const detune of [-DRONE_DETUNE_CENTS, DRONE_DETUNE_CENTS]) {
        const oscillator = context.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        oscillator.detune.value = detune;
        oscillator.connect(envelope);
        oscillator.start(now);
        oscillators.push(oscillator);
      }
      const triangle = context.createOscillator();
      triangle.type = "triangle";
      triangle.frequency.value = frequency;
      const triangleGain = context.createGain();
      triangleGain.gain.value = DRONE_TRIANGLE_GAIN;
      triangle.connect(triangleGain).connect(envelope);
      triangle.start(now);
      oscillators.push(triangle);

      envelope.gain.cancelScheduledValues(now);
      envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.linearRampToValueAtTime(DRONE_VOICE_GAIN, now + DRONE_VOICE_FADE_SECONDS);
      this.droneVoices.set(midi, { midi, envelope, oscillators, stopping: false });
    }
  }

  layerCross(event: LayerCrossEvent): void {
    const midi = LAYER_BELL_MIDI_BY_LAYER[event.layer];
    // 突破ベルより 6dB 以上小さい境界ベル。雲中の LPF を通るため自然に埋もれる
    this.playBell([midi], {
      partials: LAYER_BELL_PARTIALS,
      gain: LAYER_BELL_GAIN,
      decaySeconds: LAYER_BELL_DECAY_SECONDS,
      pan: clamp(event.pan, -1, 1) * 0.6,
    });
  }

  breakthrough(event: BreakthroughEvent): void {
    const context = this.context;
    if (!this.isWired || !context) return;
    const now = context.currentTime;
    const intensity = clamp(event.intensity, 0, 1);

    // フィルター急開放
    const sharedFilter = this.sharedFilter;
    if (sharedFilter) {
      sharedFilter.frequency.cancelScheduledValues(now);
      sharedFilter.frequency.setValueAtTime(Math.max(40, sharedFilter.frequency.value), now);
      sharedFilter.frequency.linearRampToValueAtTime(FILTER_HZ_BY_LAYER[3], now + BREAKTHROUGH_FILTER_SECONDS);
      this.lastFilterTargetHz = FILTER_HZ_BY_LAYER[3];
    }

    // 広い和音。既に鳴っている周期では attack を壊さない
    if (this.chordTarget !== 1) {
      this.chordTarget = 1;
      const chordGain = this.chordGain;
      if (chordGain) {
        chordGain.gain.cancelScheduledValues(now);
        chordGain.gain.setValueAtTime(Math.max(0.0001, chordGain.gain.value), now);
        chordGain.gain.linearRampToValueAtTime(1, now + CHORD_ATTACK_SECONDS);
      }
    }

    // 突破ベル C6 + E6。pan は最大 ±0.2
    const bellPan = clamp(event.pan, -1, 1) * CLEAR_BELL_PAN_LIMIT;
    this.playBell(CLEAR_BELL_MIDIS, {
      partials: CLEAR_BELL_PARTIALS,
      gain: CLEAR_BELL_GAIN * (0.7 + 0.3 * intensity),
      decaySeconds: CLEAR_BELL_DECAY_SECONDS,
      pan: bellPan,
      staggerSeconds: 0.09,
    });
  }

  /** ベルを 1 声鳴らす。同時発音上限を超えるときは最古の境界ベルを 20ms でフェードする */
  private playBell(
    midis: readonly number[],
    options: {
      partials: readonly (readonly [number, number])[];
      gain: number;
      decaySeconds: number;
      pan: number;
      staggerSeconds?: number;
    },
  ): void {
    const context = this.context;
    const bellBus = this.bellBus;
    if (!this.isWired || !context || !bellBus) return;

    const sustainedCount = this.droneVoices.size + (this.chordTarget === 1 ? CLEAR_CHORD_MIDIS.length : 0) + 2;
    while (this.bells.size >= BELL_MAX_VOICES || sustainedCount + this.bells.size >= MAX_VOICES) {
      if (!this.stealOldestBell(context.currentTime)) break;
    }

    let startAt = context.currentTime;
    for (const midi of midis) {
      const envelope = context.createGain();
      const panner = context.createStereoPanner();
      panner.pan.value = clamp(options.pan, -1, 1);
      envelope.connect(panner).connect(bellBus);
      const attackAt = startAt;
      const endAt = attackAt + options.decaySeconds;
      envelope.gain.setValueAtTime(0.0001, attackAt);
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, options.gain), attackAt + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, endAt);

      const frequency = midiToFrequency(midi);
      const oscillators: OscillatorNode[] = [];
      for (const [ratio, level] of options.partials) {
        const oscillator = context.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency * ratio;
        const partialGain = context.createGain();
        partialGain.gain.value = level;
        oscillator.connect(partialGain).connect(envelope);
        oscillator.start(attackAt);
        oscillator.stop(endAt + 0.05);
        oscillators.push(oscillator);
      }

      const bellId = this.nextBellId++;
      this.bells.set(bellId, { id: bellId, envelope, endsAt: endAt });
      const last = oscillators[oscillators.length - 1];
      if (last) {
        last.onended = () => {
          for (const oscillator of oscillators) oscillator.disconnect();
          envelope.disconnect();
          panner.disconnect();
          this.bells.delete(bellId);
        };
      }
      startAt += options.staggerSeconds ?? 0;
    }
  }

  /** 最古のベルを 20ms でフェードして声を空ける。clearBell は奪わない（常に最古を奪う） */
  private stealOldestBell(now: number): boolean {
    let oldest: ActiveBell | null = null;
    for (const bell of this.bells.values()) {
      if (oldest === null || bell.id < oldest.id) oldest = bell;
    }
    if (!oldest) return false;
    oldest.envelope.gain.cancelScheduledValues(now);
    oldest.envelope.gain.setValueAtTime(Math.max(0.0001, oldest.envelope.gain.value), now);
    oldest.envelope.gain.linearRampToValueAtTime(0.0001, now + BELL_STEAL_FADE_SECONDS);
    this.bells.delete(oldest.id);
    return true;
  }

  /** マスター振幅。描画ループから 1 フレーム 1 回だけ読む */
  getAmp(): number {
    const analyser = this.analyser;
    const buffer = this.analyserBuffer;
    if (!this.isWired || !analyser || !buffer) return 0;
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
      droneVoices: this.droneVoices.size,
      bells: this.bells.size,
      chordOn: this.chordTarget === 1,
      filterHz: Math.round(this.lastFilterTargetHz),
      lastAudioError: this.lastError,
    };
  }
}

/** pressure 0..1 での風の高域減衰率 */
function highCutFromPressure(pressure: number): number {
  return 1 - 0.6 * clamp(pressure, 0, 1);
}
