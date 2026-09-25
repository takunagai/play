// ============================================================
// synth-engine.ts ─ Web Audio によるマリンバ／カリンバと終演和音
// 配線: placeClick / domino → transientBus ─┐
//       finaleBass / finaleChord ───────────┼→ fxIn → dry / Convolver(生成 IR) → Compressor → master → Analyser → destination
//                                           └→ hushDuck は transientBus のみ
// 音声ファイル・外部 CDN は使わない。正本は docs/architecture.md 第 5〜6 節。
// ============================================================

import { computeChainSchedule, type AudioEngine, type ChainEvent, type ChainSchedule } from "./engine";
import { midiToFrequency } from "../music";
import {
  ALIGN_CLICK_DECAY_SECONDS,
  ALIGN_CLICK_FREQ_HZ,
  ALIGN_CLICK_GAIN,
  BUSY_DUCK_MAX_DB,
  BUSY_VOICE_THRESHOLD,
  BUSY_WINDOW_MS,
  COMPRESSOR_RATIO,
  COMPRESSOR_THRESHOLD_DB,
  DOMINO_GAIN,
  FINALE_BASS_ATTACK_SECONDS,
  FINALE_BASS_DECAY_SECONDS,
  FINALE_BASS_GAIN,
  FINALE_BASS_OCTAVE_GAIN,
  FINALE_CHORD_BRIGHT_SECONDS,
  FINALE_CHORD_DECAY_SECONDS,
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
  PLACE_CLICK_FREQ_HZ,
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
  stopAtMs: number;
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

  place(x: number, _y: number): void {
    const now = performance.now();
    if (now - this.lastPlaceAtMs < PLACE_MIN_INTERVAL_MS) return; // 発音だけ間引く（視覚は間引かない）
    this.lastPlaceAtMs = now;
    // 900Hz の短いサイン + ごく短いノイズの木製クリック
    this.playClick(PLACE_CLICK_FREQ_HZ, PLACE_CLICK_GAIN, PLACE_CLICK_DECAY_SECONDS, x);
    this.playMalletNoise(PLACE_CLICK_GAIN * 0.6, MALLET_NOISE_SECONDS, x);
  }

  align(_tileCount: number): void {
    this.playClick(ALIGN_CLICK_FREQ_HZ, ALIGN_CLICK_GAIN, ALIGN_CLICK_DECAY_SECONDS, 0.5);
  }

  beginChain(events: readonly ChainEvent[]): ChainSchedule {
    const nowMs = performance.now();
    const schedule = computeChainSchedule(events, nowMs);
    const context = this.context;
    if (!this.isWired || !context || !this.fxIn || events.length === 0) return schedule;

    // AudioContext が running のときだけ先行予約する。未解錠なら視覚だけ進む
    // （途中で解錠されても過去の時刻の音をまとめて鳴らさない）
    if (context.state !== "running") return schedule;

    const origin = context.currentTime + schedule.fallAtMs[0] / 1000 - 0.001;
    const ctxOf = (scheduleMs: number): number => origin + (scheduleMs - schedule.fallAtMs[0]) / 1000;

    events.forEach((event, index) => {
      const isLast = index === events.length - 1;
      if (isLast) return; // 最後の 1 枚は終演和音へ置き換える
      const isSecondLast = index === events.length - 2;
      // 最後から 1 枚前の減衰を早める（「間」の前に音を引く）
      this.scheduleDomino(event, ctxOf(schedule.fallAtMs[index]), isSecondLast ? 0.4 : 1, index / Math.max(1, events.length - 1));
    });

    // hush: transientBus を 80ms で -12dB、finale で 180ms かけて戻す
    if (this.transientBus) {
      const duckAt = ctxOf(schedule.hushAtMs);
      const bus = this.transientBus.gain;
      bus.setValueAtTime(1, Math.max(context.currentTime, duckAt));
      bus.exponentialRampToValueAtTime(Math.pow(10, HUSH_DUCK_DB / 20), duckAt + HUSH_DUCK_SECONDS);
      bus.setValueAtTime(Math.pow(10, HUSH_DUCK_DB / 20), ctxOf(schedule.finaleAtMs));
      bus.exponentialRampToValueAtTime(1, ctxOf(schedule.finaleAtMs) + HUSH_RECOVER_SECONDS);
    }

    // 終演: 低音 + 和音を finaleAtMs に揃える
    this.scheduleFinale(ctxOf(schedule.finaleAtMs), events[events.length - 1]);
    // 進行済みの音を後からまとめて鳴らさないため、hush 以降の grant はここまで
    this.pruneVoices();
    return schedule;
  }

  // ---- 音源 ----

  private busyDuckLinear(): number {
    const now = performance.now();
    this.recentStarts = this.recentStarts.filter((time) => now - time < BUSY_WINDOW_MS);
    const count = this.recentStarts.length;
    if (count < BUSY_VOICE_THRESHOLD) return 1;
    const overflow = Math.min(1, (count - BUSY_VOICE_THRESHOLD + 1) / BUSY_VOICE_THRESHOLD);
    return Math.pow(10, (-BUSY_DUCK_MAX_DB * overflow) / 20);
  }

  private registerStart(): void {
    this.recentStarts.push(performance.now());
  }

  /** 同時発音上限。通常音は最古から奪い、終演音は奪わない */
  private makeRoom(isFinale: boolean, context: AudioContext): void {
    if (this.voices.length < MAX_VOICES) return;
    if (isFinale) {
      // 終演音は最古の通常音を 2 つ奪ってでも鳴らす
      const stealable = this.voices.filter((voice) => !voice.isFinale).slice(0, 2);
      for (const voice of stealable) this.fadeOutVoice(voice, context);
      return;
    }
    const oldest = this.voices.find((voice) => !voice.isFinale);
    if (oldest) this.fadeOutVoice(oldest, context);
  }

  private fadeOutVoice(voice: ActiveVoice, context: AudioContext): void {
    const now = context.currentTime;
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + STEAL_FADE_SECONDS);
      voice.stopAtMs = performance.now() + STEAL_FADE_SECONDS * 1000 + 50;
    } catch {
      // 既に停止済みなら何もしない
    }
  }

  private pruneVoices(): void {
    const now = performance.now();
    this.voices = this.voices.filter((voice) => voice.stopAtMs > now);
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
    this.makeRoom(false, context);
    const frequency = midiToFrequency(event.midi);
    // 進行率で明るさ（高倍音の減衰を遅く）と音量をわずかに持ち上げる
    const brightness = 0.7 + 0.6 * Math.min(1, Math.max(0, progress));
    const late = progress > 0.7 ? LATE_VELOCITY_LIFT : 0;
    const velocity = Math.min(1, Math.max(0, event.velocity));
    const peak = DOMINO_GAIN * gainScale * (0.8 + 0.4 * velocity) * (1 + late) * this.busyDuckLinear();
    this.registerStart();

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

    this.voices.push({ gain: voice, stopAtMs: performance.now() + (atSeconds - context.currentTime) * 1000 + longestSeconds * 1000 + 100, isFinale: false });
    const cleanupAtMs = (atSeconds - context.currentTime) * 1000 + (longestSeconds + 0.1) * 1000;
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

  /** 終演: 低音（C2 + C3）と和音（C4/E4/G4/A4）を atSeconds に揃えて鳴らす */
  private scheduleFinale(atSeconds: number, lastEvent: ChainEvent): void {
    const context = this.context;
    const bus = this.fxIn;
    if (!context || !bus) return;
    this.makeRoom(true, context);

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
      toneGain.gain.exponentialRampToValueAtTime(0.0001, atSeconds + FINALE_CHORD_DECAY_SECONDS);
      tone.connect(toneGain).connect(panner);
      tone.start(atSeconds);
      tone.stop(atSeconds + FINALE_CHORD_DECAY_SECONDS + 0.1);

      const sine = context.createOscillator();
      const sineGain = context.createGain();
      sine.type = "sine";
      sine.frequency.value = frequency;
      sineGain.gain.setValueAtTime(0.0001, atSeconds);
      sineGain.gain.exponentialRampToValueAtTime(FINALE_CHORD_GAIN * FINALE_CHORD_SINE_GAIN, atSeconds + 0.02);
      sineGain.gain.exponentialRampToValueAtTime(0.0001, atSeconds + FINALE_CHORD_DECAY_SECONDS * 0.8);
      sine.connect(sineGain).connect(panner);
      sine.start(atSeconds);
      sine.stop(atSeconds + FINALE_CHORD_DECAY_SECONDS + 0.1);
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

    this.voices.push({ gain: chord, stopAtMs: performance.now() + (atSeconds - context.currentTime) * 1000 + (FINALE_CHORD_DECAY_SECONDS + 0.2) * 1000, isFinale: true });
    const cleanupAtMs = (atSeconds - context.currentTime) * 1000 + (FINALE_CHORD_DECAY_SECONDS + 0.2) * 1000;
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
