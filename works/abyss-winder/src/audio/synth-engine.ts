// ============================================================
// synth-engine.ts ─ Web Audio による音源（アコースティック風・ドリアン下降）
// 正本: docs/architecture.md §5（共通時刻契約）§7（AudioEngine 契約）§8（音響設計）。
// 配線:
//   toneIn（爪・接触・閉鎖）→ dry → compressor
//   toneIn → wetSend → convolver（生成 IR・短い残響）→ wet → compressor
//   friction（濡れた索の摩擦）→ levelGain → freezeGain → dry（残響に送らない。停止区間に尾を残さない）
//   compressor → master → analyser → destination
// 音声ファイル・外部 CDN は使わない。拍の進行は main の draw が送る winding cue 駆動
// （lookahead は 50ms 以内、cue 間隔はフレームの 16.7ms ≒ §5 の 10〜25ms 間隔）。
// ============================================================

import type { AudioEngine, ClosureTimeline, NoteEvent, WindingCue } from "./engine";
import { SCALES, midiToFrequency } from "../music";
import { planClosureTimes } from "../winding";
import { EIGHTH_MS, SPEED_MAX_RAD_S } from "../tuning";

const MASTER_GAIN = 0.5;
/** 共通の短い残響。摩擦は送らず、爪と閉鎖音（ベル余韻 ≤600ms）にだけ掛ける */
const REVERB_SECONDS = 0.9;
const REVERB_WET = 0.25;
/** voice group（爪・閉鎖等の 1 発音単位）の上限。超過時は古い予約から破棄（§8） */
const MAX_VOICES = 24;
/** 拍の予約は cue.atMs からこの未来時刻以内に限る（§5: lookahead は 50ms 以内） */
const LOOKAHEAD_MS = 50;
/** freeze 消音のランプ。最大 5ms を停止区間の内側へ置く（§5） */
const FRICTION_FREEZE_RAMP_S = 0.005;
/** 摩擦ゲインの平滑（速度の変化に追従させる） */
const FRICTION_SMOOTH_S = 0.03;
const FRICTION_GAIN_MIN = 0.015;
const FRICTION_GAIN_MAX = 0.06;
/** 爪音の長さ。速度で 60ms（遅い）→ 20ms（速い）に変化（§8 金属の爪） */
const CLAW_MS_AT_REST = 60;
const CLAW_MS_AT_MAX_SPEED = 20;
/** 音量の序列は接触 < 拍爪 < 閉鎖（§8: 接触音は閉鎖音より小さい） */
const CONTACT_PEAK_BASE = 0.035;
const CONTACT_PEAK_PER_VELOCITY = 0.05;
const BEAT_CLAW_PEAK = 0.1;
const CLOSURE_CLICK_PEAK = 0.12;
const CLOSURE_WOOD_PEAK = 0.2;
const CLOSURE_BELL_PEAK = 0.22;
/** 青いベルの基音 A5（880Hz）。§8: 基音 700〜1400Hz、余韻 600ms 以内 */
const BELL_BASE_MIDI = 81;
const BELL_DECAY_S = 0.55;
/** 木箱の胴。低い共鳴 2 本 + 短い noise 励振。§8: 120〜180ms */
const WOOD_DECAY_S = 0.16;
/** 巻き途中の下降列の音域: A5 → A2 をドリアン度数で一段ずつ下げる（§5） */
const DESCENT_BOTTOM_MIDI = 45;
const DESCENT_TOP_MIDI = 81;

/** 爪・閉鎖等の 1 発音単位。上限管理と cancelClosure / suspend での一括破棄の対象 */
interface VoiceGroup {
  gain: GainNode;
  /** パン等、group 固有の途中ノード（dispose で切り離す） */
  extraNodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
  gestureId: number;
  kind: "beat" | "closure" | "contact";
  /** 予約（または発音）開始の context 時刻 */
  startAtCtx: number;
  disposed: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** A5 から A2 へ、ドリアン度数だけを辿る下降列（拍番号で一段ずつ下げる） */
const DESCENT: readonly number[] = (() => {
  const steps: readonly number[] = SCALES["ドリアン"];
  const out: number[] = [];
  for (let midi = DESCENT_TOP_MIDI; midi >= DESCENT_BOTTOM_MIDI; midi--) {
    if (steps.includes(((midi % 12) + 12) % 12)) out.push(midi);
  }
  return out;
})();

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

export class SynthAudioEngine implements AudioEngine {
  private context: AudioContext | null = null;
  private toneIn: GainNode | null = null;
  private dry: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserBuffer: Float32Array<ArrayBuffer> | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private smoothedAmp = 0;
  private lastError = "";
  private isWired = false;

  // 濡れた索の摩擦（連続 bus 1 本。掴み〜freeze だけ鳴る）
  private frictionSource: AudioBufferSourceNode | null = null;
  private frictionFilter: BiquadFilterNode | null = null;
  private frictionLevel: GainNode | null = null;
  private frictionFreeze: GainNode | null = null;

  // winding cue による拍スケジューラ
  private gestureId = 0;
  private cueBeatOriginMs: number | null = null;
  private nextBeatIndex = 0;

  // 閉鎖予約（token ごと。planClosure の冪等と cancelClosure の対象）
  private plannedToken: number | null = null;
  private plannedTimeline: ClosureTimeline | null = null;
  private pendingClosures = new Map<number, VoiceGroup>();

  // 発音中・予約中の voice group
  private voiceGroups: VoiceGroup[] = [];

  // performance.now() ↔ context 時刻の同時標本
  private perfAtCtxSample = 0;
  private ctxAtPerfSample = 0;

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
    const toneIn = context.createGain();
    const dry = context.createGain();
    const wet = context.createGain();
    const wetSend = context.createGain();
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

    toneIn.connect(dry).connect(compressor);
    toneIn.connect(wetSend).connect(convolver).connect(wet).connect(compressor);
    compressor.connect(master).connect(analyser).connect(context.destination);

    this.toneIn = toneIn;
    this.dry = dry;
    this.analyser = analyser;
    this.analyserBuffer = new Float32Array(analyser.fftSize);
    this.noiseBuffer = this.buildNoiseBuffer(context);
    this.isWired = true;
  }

  /** 摩擦・爪のアタックに使う短いホワイトノイズ（ローカル生成。外部ファイル不要） */
  private buildNoiseBuffer(context: AudioContext): AudioBuffer {
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 1.5), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index++) {
      data[index] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /** 減衰するノイズで残響の IR を生成する（外部 IR ファイル不要） */
  private buildImpulseResponse(context: AudioContext): AudioBuffer {
    const length = Math.floor(context.sampleRate * REVERB_SECONDS);
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < length; index++) {
        data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / length, 2.5);
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

  // ---- winding cue（architecture.md §7） ----

  winding(cue: WindingCue): void {
    const context = this.context;
    if (!this.isWired || !context) return;
    this.sampleClock();
    const now = context.currentTime;
    if (cue.phase === "start") {
      this.gestureId = cue.gestureId;
      this.cueBeatOriginMs = cue.beatOriginMs;
      this.nextBeatIndex = 0;
      this.restartFriction(now);
      return;
    }
    if (cue.phase === "move") {
      if (cue.gestureId !== this.gestureId || this.cueBeatOriginMs === null) return;
      this.updateFriction(cue, now);
      this.scheduleBeats(cue, now);
      return;
    }
    // cancel: 同 gesture の摩擦と未発音の拍予約をすべて消す。罰の大音量は出さない
    if (cue.gestureId !== this.gestureId) return;
    this.stopFriction(now);
    for (const group of [...this.voiceGroups]) {
      if (group.kind === "beat" && group.gestureId === cue.gestureId && group.startAtCtx > now) {
        this.disposeGroup(group);
      }
    }
    this.cueBeatOriginMs = null;
    this.nextBeatIndex = 0;
  }

  // ---- 共通時刻契約（planClosureTimes は winding.ts と同じ式・§5） ----

  planClosure(token: number, acceptedAtMs: number, beatOriginMs: number): ClosureTimeline {
    const plan = planClosureTimes(acceptedAtMs, beatOriginMs);
    const timeline: ClosureTimeline = { token, freezeAtMs: plan.freezeAtMs, closeAtMs: plan.closeAtMs };
    // 配線前（mute・AudioContext 非対応含む）でも論理時計は壊さない（視覚が止まらない）
    if (!this.isWired || !this.context) return timeline;
    // 冪等: 同 token の再呼び出しは同じ予定を返し、音を二重予約しない（§7）
    if (this.plannedToken === token && this.plannedTimeline !== null) return this.plannedTimeline;
    this.plannedToken = token;
    this.plannedTimeline = timeline;
    this.sampleClock();
    const now = this.context.currentTime;

    // 摩擦の freeze 消音を音側の時計にスケジュールする（ランプは停止区間の内側）
    const freezeCtx = this.msToCtx(timeline.freezeAtMs);
    if (this.frictionFreeze !== null && freezeCtx > now) {
      const freezeGain = this.frictionFreeze.gain;
      freezeGain.cancelScheduledValues(now);
      freezeGain.setValueAtTime(1, freezeCtx);
      freezeGain.linearRampToValueAtTime(0, freezeCtx + FRICTION_FREEZE_RAMP_S);
    } else if (freezeCtx <= now) {
      // 予定時刻が過去になる場合も契約どおり摩擦は止める（長い尾で停止を埋めない）
      this.stopFriction(now);
    }
    // freeze 以降に鳴るはずだった未発音の拍を破棄する（停止区間に既存音を鳴らさない・§5）
    for (const group of [...this.voiceGroups]) {
      if (group.kind === "beat" && group.gestureId === this.gestureId && group.startAtCtx > freezeCtx) {
        this.disposeGroup(group);
      }
    }
    // 閉鎖音（金属クリック・木胴・青いベル）の予約。closeAtMs が過去になるなら鳴らさない
    const closeCtx = this.msToCtx(timeline.closeAtMs);
    if (closeCtx > now) {
      this.scheduleClosureVoice(token, closeCtx);
    }
    return timeline;
  }

  cancelClosure(token: number): void {
    if (this.plannedToken === token) {
      this.plannedToken = null;
      this.plannedTimeline = null;
    }
    const group = this.pendingClosures.get(token);
    if (group === undefined) return; // 冪等。達成済みの輪の音へは作用しない
    this.disposeGroup(group);
    this.pendingClosures.delete(token);
  }

  /** 非表示時: 予約と摩擦を止め、復帰後の過去音バーストを防ぐ（visibility 判定は main の責務） */
  suspend(): void {
    const context = this.context;
    if (!this.isWired || !context) return;
    const now = context.currentTime;
    this.stopFriction(now);
    for (const [token, group] of [...this.pendingClosures]) {
      this.disposeGroup(group);
      this.pendingClosures.delete(token);
    }
    for (const group of [...this.voiceGroups]) {
      if (group.startAtCtx > now) this.disposeGroup(group);
    }
    // 拍ポインタを現在へ進める。解錠後の再開は次の拍から（過去の拍をまとめて鳴らさない）
    if (this.cueBeatOriginMs !== null) {
      const currentBeat = Math.floor((performance.now() - this.cueBeatOriginMs) / EIGHTH_MS);
      this.nextBeatIndex = Math.max(this.nextBeatIndex, currentBeat + 1);
    }
    this.plannedToken = null;
    this.plannedTimeline = null;
  }

  // ---- 接触音（局所音。音程は位置で変えない ─ 雛形の横移動音階を持ち込まない） ----

  note(event: NoteEvent): void {
    const context = this.context;
    const toneIn = this.toneIn;
    if (!this.isWired || !context || !toneIn) return;
    this.sampleClock();
    const now = context.currentTime;
    const group = this.createVoiceGroup("contact");
    const peak = CONTACT_PEAK_BASE + CONTACT_PEAK_PER_VELOCITY * clamp(event.velocity, 0, 1);
    this.addClaw(group, now + 0.005, event.midi, 0.045, peak);
    // 接触の位置感だけ軽いステレオに写す
    const panner = context.createStereoPanner();
    panner.pan.value = clamp(event.x * 2 - 1, -1, 1) * 0.7;
    group.gain.disconnect();
    group.gain.connect(panner).connect(toneIn);
    group.extraNodes.push(panner);
  }

  setEnergy(_energy: number): void {
    // 本作では視覚の状態を音響へ逆流させない（architecture.md §6 getAmp の行）
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
      voices: this.voiceGroups.length,
      plannedToken: this.plannedToken ?? "",
      descentBeats: DESCENT.length,
      scheduler: `cue-driven (lookahead ${LOOKAHEAD_MS}ms)`,
      lastAudioError: this.lastError,
    };
  }

  // ---- 内部: performance.now() ↔ context 時刻 ----

  /** cue や planClosure のたびに同時標本を更新する（§5: currentTime と performance.now() の標本） */
  private sampleClock(): void {
    const context = this.context;
    if (!context) return;
    this.perfAtCtxSample = performance.now();
    this.ctxAtPerfSample = context.currentTime;
  }

  private msToCtx(ms: number): number {
    const context = this.context;
    if (!context) return 0;
    const out = context.getOutputTimestamp();
    if (typeof out.contextTime === "number" && typeof out.performanceTime === "number") {
      return out.contextTime + (ms - out.performanceTime) / 1000;
    }
    return this.ctxAtPerfSample + (ms - this.perfAtCtxSample) / 1000;
  }

  // ---- 内部: 摩擦（濡れた索。連続 bus 1 本） ----

  private restartFriction(now: number): void {
    const context = this.context!;
    if (this.frictionSource === null) {
      const source = context.createBufferSource();
      source.buffer = this.noiseBuffer;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 900;
      filter.Q.value = 0.8;
      const level = context.createGain();
      level.gain.value = 0;
      const freeze = context.createGain();
      freeze.gain.value = 1;
      source.connect(filter).connect(level).connect(freeze).connect(this.dry!);
      source.start(now);
      this.frictionSource = source;
      this.frictionFilter = filter;
      this.frictionLevel = level;
      this.frictionFreeze = freeze;
      return;
    }
    // 前回の freeze ランプや cancel の残留を解いてから無音で立ち上げる
    const freezeGain = this.frictionFreeze!.gain;
    freezeGain.cancelScheduledValues(now);
    freezeGain.setValueAtTime(1, now);
    const levelGain = this.frictionLevel!.gain;
    levelGain.cancelScheduledValues(now);
    levelGain.setValueAtTime(0, now);
  }

  /** 速度で摩擦ゲインを平滑化する（§8 濡れた索）。音側は完成条件に cue を使わない */
  private updateFriction(cue: WindingCue, now: number): void {
    const level = this.frictionLevel;
    const filter = this.frictionFilter;
    if (level === null || filter === null) return;
    const speedNorm = clamp(Math.abs(cue.speed) / SPEED_MAX_RAD_S, 0, 1);
    const target =
      FRICTION_GAIN_MIN +
      (FRICTION_GAIN_MAX - FRICTION_GAIN_MIN) * speedNorm * (0.5 + 0.5 * clamp(cue.accuracy, 0, 1));
    level.gain.setTargetAtTime(target, now, FRICTION_SMOOTH_S);
    // 速いほど輪郭の高い帯域へ寄せる
    filter.frequency.setTargetAtTime(700 + 600 * speedNorm, now, 0.05);
  }

  private stopFriction(now: number): void {
    const level = this.frictionLevel;
    if (level === null) return;
    level.gain.setTargetAtTime(0, now, 0.004);
  }

  // ---- 内部: 拍スケジューラ（cue 駆動・lookahead 50ms 以内・§5） ----

  private scheduleBeats(cue: WindingCue, now: number): void {
    const origin = this.cueBeatOriginMs;
    if (origin === null) return;
    const currentBeat = Math.floor((cue.atMs - origin) / EIGHTH_MS);
    // 過去の拍を連続再生しない。遅れて届いた cue は足下の拍へ跳ぶ（同一試行で折り返さない）
    this.nextBeatIndex = Math.max(this.nextBeatIndex, currentBeat);
    const horizonCtx = this.msToCtx(cue.atMs + LOOKAHEAD_MS);
    for (;;) {
      const atCtx = this.msToCtx(origin + this.nextBeatIndex * EIGHTH_MS);
      if (atCtx > horizonCtx) break;
      if (atCtx > now) this.scheduleBeat(this.nextBeatIndex, atCtx, cue.speed);
      this.nextBeatIndex += 1;
    }
  }

  /** 8 分拍ごとにドリアン下降を一段下げる。下端以降は無音程の爪だけ（§5） */
  private scheduleBeat(beatIndex: number, atCtx: number, speed: number): void {
    const group = this.createVoiceGroup("beat");
    group.startAtCtx = atCtx;
    const speedNorm = clamp(Math.abs(speed) / SPEED_MAX_RAD_S, 0, 1);
    const durationS = (CLAW_MS_AT_REST - (CLAW_MS_AT_REST - CLAW_MS_AT_MAX_SPEED) * speedNorm) / 1000;
    const midi = beatIndex < DESCENT.length ? DESCENT[beatIndex] : null;
    this.addClaw(group, atCtx, midi, durationS, BEAT_CLAW_PEAK);
  }

  // ---- 内部: 閉鎖音 ----

  /** 金属クリック・木胴・青いベルを同じ context 時刻に同時発音（§8） */
  private scheduleClosureVoice(token: number, atCtx: number): void {
    const group = this.createVoiceGroup("closure");
    group.startAtCtx = atCtx;
    this.addClaw(group, atCtx, null, 0.03, CLOSURE_CLICK_PEAK);
    this.addWood(group, atCtx);
    this.addBell(group, atCtx);
    this.pendingClosures.set(token, group);
  }

  // ---- 内部: 音色 ----

  /** 金属の爪: 正弦の非整数倍音 + 短い高域ノイズ。midi が null なら無音程の爪 */
  private addClaw(group: VoiceGroup, t0: number, midi: number | null, durationS: number, peak: number): void {
    const context = this.context!;
    const env = context.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t0 + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + durationS);
    env.connect(group.gain);

    const base = midi !== null ? midiToFrequency(midi) : 1900;
    const partials: ReadonlyArray<readonly [number, number]> =
      midi !== null ? [[1, 1], [2.37, 0.4], [3.61, 0.18]] : [[1, 0.5], [2.37, 0.2]];
    for (const [ratio, gain] of partials) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = base * ratio;
      const partialGain = context.createGain();
      partialGain.gain.value = gain;
      oscillator.connect(partialGain).connect(env);
      oscillator.start(t0);
      oscillator.stop(t0 + durationS + 0.02);
      this.trackSource(group, oscillator);
    }
    this.addNoiseBurst(group, env, t0, 0.006, 2500, "highpass", 0.5);
  }

  /** 木箱の胴: 低い共鳴 2 本 + 短い noise 励振。中域にも輪郭を残す（§8） */
  private addWood(group: VoiceGroup, t0: number): void {
    const context = this.context!;
    const env = context.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(CLOSURE_WOOD_PEAK, t0 + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + WOOD_DECAY_S);
    env.connect(group.gain);
    for (const [frequencyHz, gain] of [[92, 1], [138, 0.55]] as const) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequencyHz;
      const partialGain = context.createGain();
      partialGain.gain.value = gain;
      oscillator.connect(partialGain).connect(env);
      oscillator.start(t0);
      oscillator.stop(t0 + WOOD_DECAY_S + 0.02);
      this.trackSource(group, oscillator);
    }
    this.addNoiseBurst(group, env, t0, 0.02, 450, "lowpass", 0.7);
  }

  /** 青いベル: 正弦基音 + 控えめな非整数倍音。余韻は 600ms 以内（§8、閉鎖のみ） */
  private addBell(group: VoiceGroup, t0: number): void {
    const context = this.context!;
    const env = context.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(CLOSURE_BELL_PEAK, t0 + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + BELL_DECAY_S);
    env.connect(group.gain);
    const base = midiToFrequency(BELL_BASE_MIDI);
    for (const [ratio, gain] of [[1, 1], [2.76, 0.12], [5.4, 0.05]] as const) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = base * ratio;
      const partialGain = context.createGain();
      partialGain.gain.value = gain;
      oscillator.connect(partialGain).connect(env);
      oscillator.start(t0);
      oscillator.stop(t0 + BELL_DECAY_S + 0.05);
      this.trackSource(group, oscillator);
    }
  }

  private addNoiseBurst(
    group: VoiceGroup,
    destination: AudioNode,
    t0: number,
    durationS: number,
    frequencyHz: number,
    type: BiquadFilterType,
    peak: number,
  ): void {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequencyHz;
    const burstGain = context.createGain();
    burstGain.gain.setValueAtTime(peak, t0);
    burstGain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationS);
    source.connect(filter).connect(burstGain).connect(destination);
    source.start(t0);
    source.stop(t0 + durationS + 0.01);
    this.trackSource(group, source);
  }

  // ---- 内部: voice 管理 ----

  private createVoiceGroup(kind: VoiceGroup["kind"]): VoiceGroup {
    const context = this.context!;
    // 上限超過時は古い予約から破棄する（§8 マスター）
    if (this.voiceGroups.length >= MAX_VOICES) {
      this.disposeGroup(this.voiceGroups[0]);
    }
    const gain = context.createGain();
    gain.connect(this.toneIn!);
    const group: VoiceGroup = {
      gain,
      extraNodes: [],
      sources: [],
      gestureId: this.gestureId,
      kind,
      startAtCtx: context.currentTime,
      disposed: false,
    };
    this.voiceGroups.push(group);
    return group;
  }

  private trackSource(group: VoiceGroup, source: AudioScheduledSourceNode): void {
    group.sources.push(source);
    // 鳴り終わったら自壊する（voice の掃除をフレーム側に任せない）
    source.onended = () => {
      this.disposeGroup(group);
    };
  }

  private disposeGroup(group: VoiceGroup): void {
    if (group.disposed) return;
    group.disposed = true;
    for (const source of group.sources) {
      source.onended = null;
      try {
        source.stop(0);
      } catch {
        // start 前の source への stop は期待される例外（未発音の予約音を消すために必須）
      }
      source.disconnect();
    }
    group.gain.disconnect();
    for (const node of group.extraNodes) node.disconnect();
    const index = this.voiceGroups.indexOf(group);
    if (index >= 0) this.voiceGroups.splice(index, 1);
  }
}
