// ============================================================
// synth-engine.ts ─ Web Audio によるマリンバ／カリンバと終演和音
// 配線: placeClick / domino → transientBus ─┐
//       chainSub / finaleBass / finaleChord ─┼→ fxIn → dry / Convolver(生成 IR) → Compressor → master → Analyser → destination
//                                           └→ hushDuck は transientBus のみ
// 音声ファイル・外部 CDN は使わない。正本は docs/architecture.md 第 5〜6 節。
// ============================================================

import { computeChainSchedule, type AudioEngine, type ChainEvent, type ChainSchedule } from "./engine";
import { midiToFrequency, PITCH_MIDIS } from "../music";
import { CHAIN_DURATION_MAX_MS } from "../tuning";
import {
  ALIGN_CLICK_DECAY_SECONDS,
  ALIGN_CLICK_FREQ_HZ,
  ALIGN_CLICK_GAIN,
  BUSY_DUCK_MAX_DB,
  BUSY_VOICE_THRESHOLD,
  BUSY_WINDOW_MS,
  CHAIN_SUB_BASE_GAIN,
  CHAIN_SUB_BASE_MIDI,
  CHAIN_SUB_BASE_OCTAVE_GAIN,
  CHAIN_SUB_BASE_RELEASE_SECONDS,
  COMPRESSOR_RATIO,
  COMPRESSOR_THRESHOLD_DB,
  DOMINO_GAIN,
  FINALE_BASS_ATTACK_SECONDS,
  FINALE_BASS_DECAY_SECONDS,
  FINALE_BASS_GAIN,
  FINALE_BASS_OCTAVE_GAIN,
  FINALE_CHORD_BRIGHT_SECONDS,
  FINALE_CHORD_DECAY_MAX_SECONDS,
  FINALE_CHORD_DECAY_SECONDS,
  FINALE_CHORD_DECAY_T_FACTOR,
  FINALE_CHORD_GAIN,
  FINALE_CHORD_SINE_GAIN,
  FINALE_CHORD_SPREAD,
  HUSH_DUCK_DB,
  HUSH_DUCK_SECONDS,
  HUSH_RECOVER_SECONDS,
  LATE_VELOCITY_LIFT,
  MALLET_NOISE_SECONDS,
  MARIMBA_PARTIALS,
  MASTER_GAIN,
  MAX_VOICES,
  PLACE_CLICK_DECAY_SECONDS,
  PLACE_CLICK_GAIN,
  PLACE_MIN_INTERVAL_MS,
  REVERB_SECONDS,
  REVERB_WET,
  REVERB_WET_LATE,
  STEAL_FADE_SECONDS,
} from "./audio-tuning";

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/** 進行中の 1 発。音を奪う（steal）ために管理する */
interface ActiveVoice {
  gain: GainNode;
  startsAtSeconds: number;
  stopAtSeconds: number;
  isFinale: boolean;
}

export class SynthAudioEngine implements AudioEngine {
  private context: AudioContext | null = null;
  private fxIn: GainNode | null = null;
  private transientBus: GainNode | null = null;
  private wet: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserBuffer: Float32Array<ArrayBuffer> | null = null;
  private smoothedAmp = 0;
  private lastError = "";
  private isWired = false;
  private voices: ActiveVoice[] = [];
  private recentStarts: number[] = [];
  private lastPlaceAtMs = 0;

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
    const transientBus = context.createGain();
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
      // Convolver の生成に失敗したら dry 経路だけで鳴らす（docs/architecture.md 第 8 節）
      this.lastError = error instanceof Error ? error.message : String(error);
      fxIn.connect(dry).connect(compressor);
    }
    transientBus.connect(fxIn);
    compressor.connect(master).connect(analyser).connect(context.destination);

    this.fxIn = fxIn;
    this.transientBus = transientBus;
    this.wet = convolver.buffer ? wet : null;
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

  place(x: number, y: number): void {
    const now = performance.now();
    if (now - this.lastPlaceAtMs < PLACE_MIN_INTERVAL_MS) return; // 発音だけ間引く（視覚は間引かない）
    this.lastPlaceAtMs = now;
    // 置いた板の音階度（上ほど高音）の短いサイン + ごく短いノイズの木製クリック。描線が旋律として聴こえる
    this.playClick(this.placeClickFrequency(y), PLACE_CLICK_GAIN, PLACE_CLICK_DECAY_SECONDS, x);
    this.playMalletNoise(PLACE_CLICK_GAIN * 0.6, MALLET_NOISE_SECONDS, x);
  }

  /** placeClick のピッチ。置いた板の高さ（正規化 y の上下反転）を既存の C メジャーペンタ割り当てへ写す（正本 §6） */
  private placeClickFrequency(normalizedY: number): number {
    const clamped = Math.min(1, Math.max(0, normalizedY));
    const index = Math.round((1 - clamped) * (PITCH_MIDIS.length - 1));
    return midiToFrequency(PITCH_MIDIS[index]);
  }

  align(_tileCount: number): void {
    this.playClick(ALIGN_CLICK_FREQ_HZ, ALIGN_CLICK_GAIN, ALIGN_CLICK_DECAY_SECONDS, 0.5);
  }

  beginChain(events: readonly ChainEvent[]): ChainSchedule {
    const context = this.context;
    const nowMs = performance.now();
    const audioNowSeconds = context?.currentTime ?? 0;
    const schedule = computeChainSchedule(events, nowMs);
    if (!this.isWired || !context || !this.fxIn || events.length === 0) return schedule;

    // AudioContext が running のときだけ先行予約する。未解錠なら視覚だけ進む
    // （途中で解錠されても過去の時刻の音をまとめて鳴らさない）
    if (context.state !== "running") return schedule;

    const ctxOf = (scheduleMs: number): number => audioNowSeconds + (scheduleMs - nowMs) / 1000;

    // この演奏の連鎖進行率 t（正本 §3.5。開花・衝撃波・サブベース・和音の減衰が共有する値）
    const performanceRatio = Math.min(
      1,
      Math.max(0, (schedule.finaleAtMs - schedule.fallAtMs[0]) / CHAIN_DURATION_MAX_MS),
    );

    events.forEach((event, index) => {
      const isLast = index === events.length - 1;
      if (isLast) return; // 最後の 1 枚は終演和音へ置き換える
      const isSecondLast = index === events.length - 2;
      // 最後から 1 枚前の減衰を早める（「間」の前に音を引く）
      this.scheduleDomino(event, ctxOf(schedule.fallAtMs[index]), isSecondLast ? 0.4 : 1, index / Math.max(1, events.length - 1));
    });

    // 連鎖中のサブベース: C2 サイン（+ C3 倍音）が連鎖進行率 t でフェードインし、
    // hush 開始で素早くフェードアウトして終演ベースへ解消する（正本 §6）。
    // 終演音と同じ fxIn 経由なので、hush の transientBus ダックの対象外（打音だけを引く）。
    // transientBus 輻輳時に makeRoom が最古の通常音を奪う既存機構は、この voice も
    // isFinale: false の通常音として管理するため、新しい sub も同一のダック機構で守られる。
    this.scheduleChainSub(ctxOf(schedule.fallAtMs[0]), ctxOf(schedule.hushAtMs), performanceRatio);

    // hush: transientBus を 80ms で -12dB、finale で 180ms かけて戻す
    if (this.transientBus) {
      const duckAt = ctxOf(schedule.hushAtMs);
      const bus = this.transientBus.gain;
      bus.setValueAtTime(1, Math.max(context.currentTime, duckAt));
      bus.exponentialRampToValueAtTime(Math.pow(10, HUSH_DUCK_DB / 20), duckAt + HUSH_DUCK_SECONDS);
      bus.setValueAtTime(Math.pow(10, HUSH_DUCK_DB / 20), ctxOf(schedule.finaleAtMs));
      bus.exponentialRampToValueAtTime(1, ctxOf(schedule.finaleAtMs) + HUSH_RECOVER_SECONDS);
    }

    // 終演: 低音 + 和音を finaleAtMs に揃える（和音の減衰は t 比例で伸びる）
    this.scheduleFinale(ctxOf(schedule.finaleAtMs), events[events.length - 1], performanceRatio);
    // 進行済みの音を後からまとめて鳴らさないため、hush 以降の grant はここまで
    this.pruneVoices(context.currentTime);
    return schedule;
  }

  // ---- 音源 ----

  /**
   * 連鎖中のサブベース。C2 サイン（+ C3 倍音。終演ベースと同じ音色系）を fromSeconds に立ち上げ、
   * 連鎖進行率 t で gain 0 → CHAIN_SUB_BASE_GAIN へフェードインし、hush 開始で素早く引く（正本 §6）。
   * bus は終演と同じ fxIn ─ hush の transientBus ダックは打音バス限定のため sub は引かれない。
   */
  private scheduleChainSub(fromSeconds: number, hushSeconds: number, performanceRatio: number): void {
    const context = this.context;
    const bus = this.fxIn;
    if (!context || !bus) return;
    if (!this.makeRoom(fromSeconds, context)) return;

    const voice = context.createGain();
    voice.connect(bus);
    const frequencies = [midiToFrequency(CHAIN_SUB_BASE_MIDI), midiToFrequency(CHAIN_SUB_BASE_MIDI + 12)];
    const octaveGains = [1, CHAIN_SUB_BASE_OCTAVE_GAIN];
    const nodes: OscillatorNode[] = [];
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine"; // サブは純粋なサインで床の重みを支える
      oscillator.frequency.value = frequency;
      const peak = CHAIN_SUB_BASE_GAIN * octaveGains[index];
      gain.gain.setValueAtTime(0.0001, fromSeconds);
      gain.gain.linearRampToValueAtTime(Math.max(peak * performanceRatio, 0.0001), hushSeconds);
      gain.gain.exponentialRampToValueAtTime(0.0001, hushSeconds + CHAIN_SUB_BASE_RELEASE_SECONDS);
      oscillator.connect(gain).connect(voice);
      oscillator.start(fromSeconds);
      oscillator.stop(hushSeconds + CHAIN_SUB_BASE_RELEASE_SECONDS + 0.05);
      nodes.push(oscillator);
    });

    const stopAtSeconds = hushSeconds + CHAIN_SUB_BASE_RELEASE_SECONDS + 0.1;
    this.voices.push({ gain: voice, startsAtSeconds: fromSeconds, stopAtSeconds, isFinale: false });
    const cleanupAtMs = (stopAtSeconds - context.currentTime) * 1000;
    window.setTimeout(() => {
      for (const node of nodes) node.disconnect();
      voice.disconnect();
      this.voices = this.voices.filter((entry) => entry.gain !== voice);
    }, Math.max(0, cleanupAtMs));
  }

  private busyDuckLinear(atSeconds: number): number {
    const windowSeconds = BUSY_WINDOW_MS / 1000;
    this.recentStarts = this.recentStarts.filter((time) => atSeconds - time < windowSeconds);
    const count = this.recentStarts.filter((time) => time <= atSeconds).length;
    if (count < BUSY_VOICE_THRESHOLD) return 1;
    const overflow = Math.min(1, (count - BUSY_VOICE_THRESHOLD + 1) / BUSY_VOICE_THRESHOLD);
    return Math.pow(10, (BUSY_DUCK_MAX_DB * overflow) / 20);
  }

  private registerStart(atSeconds: number): void {
    this.recentStarts.push(atSeconds);
  }

  /** 同時発音上限。対象時刻に鳴る最古の通常音を奪い、終演音は奪わない */
  private makeRoom(atSeconds: number, context: AudioContext): boolean {
    this.pruneVoices(atSeconds);
    const overlapping = this.voices.filter(
      (voice) => voice.startsAtSeconds <= atSeconds && voice.stopAtSeconds > atSeconds,
    );
    if (overlapping.length < MAX_VOICES) return true;

    const required = overlapping.length - MAX_VOICES + 1;
    const stealable = overlapping.filter((voice) => !voice.isFinale).slice(0, required);
    if (stealable.length < required) return false;

    for (const voice of stealable) {
      this.fadeOutVoice(voice, atSeconds, context);
      // 同じ voice を後続の予約でも繰り返し steal しないよう、管理対象から直ちに外す。
      this.voices = this.voices.filter((entry) => entry !== voice);
    }
    return true;
  }

  private fadeOutVoice(voice: ActiveVoice, atSeconds: number, context: AudioContext): void {
    const fadeStart = Math.max(context.currentTime, atSeconds - STEAL_FADE_SECONDS);
    try {
      voice.gain.gain.cancelScheduledValues(fadeStart);
      voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), fadeStart);
      if (fadeStart < atSeconds) {
        voice.gain.gain.exponentialRampToValueAtTime(0.0001, atSeconds);
      } else {
        voice.gain.gain.setValueAtTime(0.0001, atSeconds);
      }
      voice.stopAtSeconds = atSeconds;
    } catch {
      // 既に停止済みなら何もしない
    }
  }

  private pruneVoices(atSeconds: number): void {
    this.voices = this.voices.filter((voice) => voice.stopAtSeconds > atSeconds);
  }

  /** 板を置く・吸着の木製クリック（サイン 1 音） */
  private playClick(freqHz: number, gain: number, decaySeconds: number, normalizedX: number): void {
    const context = this.context;
    const bus = this.transientBus;
    if (!this.isWired || !context || !bus) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const panner = context.createStereoPanner();
    panner.pan.value = normalizedX * 2 - 1;
    oscillator.type = "sine";
    oscillator.frequency.value = freqHz;
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + decaySeconds);
    oscillator.connect(envelope).connect(panner).connect(bus);
    oscillator.start(now);
    oscillator.stop(now + decaySeconds + 0.05);
    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
      panner.disconnect();
    };
  }

  /** マレットの打撃ノイズ（ごく短いバースト） */
  private playMalletNoise(gain: number, seconds: number, normalizedX: number): void {
    const context = this.context;
    const bus = this.transientBus;
    if (!this.isWired || !context || !bus) return;
    const length = Math.max(1, Math.floor(context.sampleRate * seconds));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index++) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / length);
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    const panner = context.createStereoPanner();
    panner.pan.value = normalizedX * 2 - 1;
    filter.type = "bandpass";
    filter.frequency.value = 2400;
    filter.Q.value = 1;
    envelope.gain.value = gain;
    source.buffer = buffer;
    source.connect(filter).connect(envelope).connect(panner).connect(bus);
    source.start();
  }

  /** マリンバ風の 1 音を時刻 atSeconds（AudioContext 時刻）に予約する */
  private scheduleDomino(event: ChainEvent, atSeconds: number, gainScale: number, progress: number): void {
    const context = this.context;
    const bus = this.transientBus;
    if (!context || !bus) return;
    if (!this.makeRoom(atSeconds, context)) return;
    const frequency = midiToFrequency(event.midi);
    // 進行率で明るさ（高倍音の減衰を遅く）と音量をわずかに持ち上げる
    const brightness = 0.7 + 0.6 * Math.min(1, Math.max(0, progress));
    const late = progress > 0.7 ? LATE_VELOCITY_LIFT : 0;
    const velocity = Math.min(1, Math.max(0, event.velocity));
    const peak = DOMINO_GAIN * gainScale * (0.8 + 0.4 * velocity) * (1 + late) * this.busyDuckLinear(atSeconds);
    this.registerStart(atSeconds);

    const voice = context.createGain();
    const panner = context.createStereoPanner();
    panner.pan.value = Math.min(1, Math.max(-1, event.x * 2 - 1));
    voice.connect(panner).connect(bus);

    const partialNodes: Array<{ osc: OscillatorNode; gain: GainNode }> = [];
    let longestSeconds = 0;
    for (const partial of MARIMBA_PARTIALS) {
      const oscillator = context.createOscillator();
      const partialGain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency * partial.ratio;
      const partialPeak = partial.gain * peak;
      const decay = partial.decaySeconds * (partial.ratio === 1 ? brightness : 1);
      longestSeconds = Math.max(longestSeconds, decay);
      partialGain.gain.setValueAtTime(0.0001, atSeconds);
      partialGain.gain.exponentialRampToValueAtTime(Math.max(partialPeak, 0.0002), atSeconds + 0.004);
      partialGain.gain.exponentialRampToValueAtTime(0.0001, atSeconds + decay);
      oscillator.connect(partialGain).connect(voice);
      oscillator.start(atSeconds);
      oscillator.stop(atSeconds + decay + 0.05);
      partialNodes.push({ osc: oscillator, gain: partialGain });
    }
    // 4ms のマレットノイズ
    const noiseSeconds = MALLET_NOISE_SECONDS;
    const noiseLength = Math.max(1, Math.floor(context.sampleRate * noiseSeconds));
    const noiseBuffer = context.createBuffer(1, noiseLength, context.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let index = 0; index < noiseLength; index++) {
      noiseData[index] = (Math.random() * 2 - 1) * (1 - index / noiseLength);
    }
    const noiseSource = context.createBufferSource();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = Math.min(context.sampleRate / 2 - 100, frequency * 6);
    noiseGain.gain.value = peak * 0.5;
    noiseSource.buffer = noiseBuffer;
    noiseSource.connect(noiseFilter).connect(noiseGain).connect(voice);
    noiseSource.start(atSeconds);

    const stopAtSeconds = atSeconds + longestSeconds + 0.1;
    this.voices.push({ gain: voice, startsAtSeconds: atSeconds, stopAtSeconds, isFinale: false });
    const cleanupAtMs = (stopAtSeconds - context.currentTime) * 1000;
    window.setTimeout(() => {
      for (const node of partialNodes) {
        node.osc.disconnect();
        node.gain.disconnect();
      }
      noiseSource.disconnect();
      noiseFilter.disconnect();
      noiseGain.disconnect();
      voice.disconnect();
      panner.disconnect();
      this.voices = this.voices.filter((entry) => entry.gain !== voice);
    }, Math.max(0, cleanupAtMs));
  }

  /** 終演: 低音（C2 + C3）と和音（C4/E4/G4/A4）を atSeconds に揃えて鳴らす。和音の減衰は t 比例（4.8 + 1.7t 秒、max 6.5s） */
  private scheduleFinale(atSeconds: number, lastEvent: ChainEvent, performanceRatio: number): void {
    const context = this.context;
    const bus = this.fxIn;
    if (!context || !bus) return;
    if (!this.makeRoom(atSeconds, context)) return;
    // 解放の比例: 長い演奏（t 大）ほど和音の余韻が長く伸びる（正本 §6）
    const chordDecaySeconds = Math.min(
      FINALE_CHORD_DECAY_MAX_SECONDS,
      FINALE_CHORD_DECAY_SECONDS + FINALE_CHORD_DECAY_T_FACTOR * performanceRatio,
    );

    // 低音: C2 + 小音量の C3（小型スピーカーでも低音の存在が分かるように）
    const bass = context.createGain();
    bass.connect(bus);
    const bassFrequencies = [midiToFrequency(36), midiToFrequency(48)];
    const bassGains = [FINALE_BASS_GAIN, FINALE_BASS_GAIN * FINALE_BASS_OCTAVE_GAIN];
    const bassNodes: OscillatorNode[] = [];
    bassFrequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = index === 0 ? "triangle" : "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, atSeconds);
      gain.gain.linearRampToValueAtTime(bassGains[index], atSeconds + FINALE_BASS_ATTACK_SECONDS);
      gain.gain.exponentialRampToValueAtTime(0.0001, atSeconds + FINALE_BASS_DECAY_SECONDS);
      oscillator.connect(gain).connect(bass);
      oscillator.start(atSeconds);
      oscillator.stop(atSeconds + FINALE_BASS_DECAY_SECONDS + 0.1);
      bassNodes.push(oscillator);
    });

    // 和音: マレット音 + 柔らかいサイン層。左右へ広げ、最初の 500ms を最も明るく
    const chord = context.createGain();
    chord.connect(bus);
    const chordMidis = [60, 64, 67, 69];
    const chordPanValues = [-FINALE_CHORD_SPREAD, -FINALE_CHORD_SPREAD / 3, FINALE_CHORD_SPREAD / 3, FINALE_CHORD_SPREAD];
    const chordNodes: Array<{ osc: OscillatorNode; gain: GainNode; pan: StereoPannerNode }> = [];
    chordMidis.forEach((midi, index) => {
      const frequency = midiToFrequency(midi);
      const panner = context.createStereoPanner();
      panner.pan.value = chordPanValues[index];
      panner.connect(chord);
      const tone = context.createOscillator();
      const toneGain = context.createGain();
      tone.type = "triangle";
      tone.frequency.value = frequency;
      toneGain.gain.setValueAtTime(0.0001, atSeconds);
      toneGain.gain.exponentialRampToValueAtTime(FINALE_CHORD_GAIN, atSeconds + 0.012);
      // 最初の 500ms は明るく、そこから減衰曲線へ落とす
      toneGain.gain.exponentialRampToValueAtTime(FINALE_CHORD_GAIN * 0.5, atSeconds + FINALE_CHORD_BRIGHT_SECONDS);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, atSeconds + chordDecaySeconds);
      tone.connect(toneGain).connect(panner);
      tone.start(atSeconds);
      tone.stop(atSeconds + chordDecaySeconds + 0.1);

      const sine = context.createOscillator();
      const sineGain = context.createGain();
      sine.type = "sine";
      sine.frequency.value = frequency;
      sineGain.gain.setValueAtTime(0.0001, atSeconds);
      sineGain.gain.exponentialRampToValueAtTime(FINALE_CHORD_GAIN * FINALE_CHORD_SINE_GAIN, atSeconds + 0.02);
      sineGain.gain.exponentialRampToValueAtTime(0.0001, atSeconds + chordDecaySeconds * 0.8);
      sine.connect(sineGain).connect(panner);
      sine.start(atSeconds);
      sine.stop(atSeconds + chordDecaySeconds + 0.1);
      chordNodes.push({ osc: tone, gain: toneGain, pan: panner });
      chordNodes.push({ osc: sine, gain: sineGain, pan: panner });
    });

    // 進行率 0.7 以降の終演では残響を少し増やす（戻す処理はしない。小さい加算のため）
    if (this.wet && lastEvent.x >= 0) {
      const wetNow = REVERB_WET;
      this.wet.gain.cancelScheduledValues(atSeconds);
      this.wet.gain.setValueAtTime(wetNow, atSeconds);
      this.wet.gain.linearRampToValueAtTime(wetNow + REVERB_WET_LATE, atSeconds + 0.4);
    }

    const stopAtSeconds = atSeconds + chordDecaySeconds + 0.2;
    this.voices.push({ gain: chord, startsAtSeconds: atSeconds, stopAtSeconds, isFinale: true });
    const cleanupAtMs = (stopAtSeconds - context.currentTime) * 1000;
    window.setTimeout(() => {
      for (const node of bassNodes) node.disconnect();
      for (const node of chordNodes) {
        node.osc.disconnect();
        node.gain.disconnect();
        node.pan.disconnect();
      }
      bass.disconnect();
      chord.disconnect();
      this.voices = this.voices.filter((entry) => entry.gain !== chord);
    }, Math.max(0, cleanupAtMs));
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
