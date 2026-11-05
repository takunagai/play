// ============================================================
// engine.ts ─ 音響契約（正本 §5）+ オルゴール音源（§6）+ Noop + ファクトリ
// main.ts は createAudioEngine() 経由でのみ音響に触る（Web Audio を直接触らない）。
// 正本は docs/architecture.md の「AudioEngine 契約」「音響設計」。
// 雛形の synth-engine.ts（ベル音源）は最終 factory から外して二重起動を防ぐ。
// 配線: 音源 → fxIn → dry / wet（生成 IR の Convolver、tail 上限 1.2 秒）
//       → Compressor（リミッタ代用）→ Analyser → destination
// 音声ファイル・外部 CDN・常時音源（drone / BGM）は使わない。無操作時は無音。
// ============================================================

import { midiToFrequency } from "../music";
import {
  AUDIO_MASTER_GAIN,
  AUDIO_PARTIALS,
  AUDIO_REVERB_TAIL_S,
  AUDIO_REVERB_WET,
  AUDIO_SUSPEND_FADE_MS,
  AUDIO_VOICE_PEAK,
  FIRST_NOTE_DELAY_MS,
  MAX_CONSTELLATIONS,
  MAX_VOICES,
  NOTE_ATTACK_MS,
  NOTE_DECAY_MS,
  STEP_MS,
} from "../tuning";

export interface NoteEvent {
  /** 0..1（画面幅で正規化） */
  x: number;
  /** 0..1（画面高さで正規化） */
  y: number;
  midi: number;
  /** 0..1 の強さ */
  velocity: number;
}

export interface AudioEngine {
  /**
   * ユーザー操作のハンドラ内で呼ぶ。resume() の解決を待たずに配線まで済ませ、
   * 常駐の解錠リスナー（pointerup / touchend / click / keydown）を置く。
   * タッチは pointerdown では解錠できず、指を離した時に初めて解錠できるため
   */
  start(): Promise<void>;
  /** 配線が済んでいるか（running の意味ではない）。false の間、発音は視覚時計へ退避する */
  readonly isReady: boolean;
  note(event: NoteEvent): void;
  /** 毎フレーム呼ばれてよい（内部で平滑化） */
  setEnergy(energy: number): void;
  /** マスター振幅 0..1。1 フレーム 1 回だけ呼ぶ。実 analyser の実振幅。偽装しない */
  getAmp(): number;
  /** ?debug 表示用 */
  getDiagnostics(): Record<string, string | number | boolean>;
}

// ---- 正本 §5 の拡張契約（視覚と音の共通データ。main はこの形で一度だけ渡す） ----

/** 星列の 1 ステップ。線の確定順と同一順序・同一時刻で 1 星 1 音に使う */
export interface StarStep {
  readonly starId: number;
  /** 0..1（画面幅で正規化） */
  readonly x: number;
  /** 0..1（画面高さで正規化） */
  readonly y: number;
  readonly midi: number;
  /** 0..1 の強さ */
  readonly velocity: number;
}

export interface SequencePlan {
  /** pointerId とは別の単調増加 ID */
  readonly id: number;
  /** 3..12。確定した線と同じ順 */
  readonly steps: readonly StarStep[];
  /** performance.now() 基準 */
  readonly releasedAtMs: number;
}

export interface SequenceClock {
  /** pending: 起点未確定（解錠待ち。絵も先走らない）/ audio: 実発音の可聴時刻 / visual: 無音時の視覚時計 */
  readonly mode: "pending" | "audio" | "visual";
  /** pending のみ null（音声の解錠待ち。星と線は先走らない） */
  readonly firstAtMs: number | null;
  readonly stepMs: number;
}

export interface StarAudioEngine extends AudioEngine {
  /** release ごとに一度だけ呼ぶ。running なら即 schedule、さもなくば pending で保持する */
  planSequence(plan: SequencePlan): void;
  /** 副作用なし。pending→audio の切替があるため main は毎フレーム読み直す。削除済み ID は null */
  getSequenceClock(id: number): SequenceClock | null;
  /** 予約・音源を取り消す。未開始 source も stop、鳴りかけ voice も 30ms で消音。冪等 */
  cancelSequence(id: number): void;
  /** 全列・全音源・残響を中断する（正本 §3 の状態表）。復帰後に古い音を再生しない */
  suspend(): void;
  /** context と常駐リスナーも解除する */
  dispose(): void;
}

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/** 1 note = 1 voice = 3 oscillator（正本 §5「1 voice あたり最大 3 oscillator」） */
interface VoiceHandle {
  gain: GainNode;
  sources: OscillatorNode[];
  startAtAudio: number;
}

interface PlannedSequence {
  readonly id: number;
  readonly plan: SequencePlan;
  /** pending: 起点未確定。scheduled: 発音を AudioContext 時刻へ予約済み */
  state: "pending" | "scheduled";
  clock: SequenceClock;
  voices: VoiceHandle[];
}

export class MusicBoxAudioEngine implements StarAudioEngine {
  private context: AudioContext | null = null;
  private fxIn: GainNode | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserBuffer: Float32Array<ArrayBuffer> | null = null;
  private smoothedAmp = 0;
  private isWired = false;
  private lastError = "";
  private cancelledSequences = 0;
  private readonly sequences = new Map<number, PlannedSequence>();
  /** 未終了の voice。予約済み（未開始）も上限に含める（正本 §5） */
  private readonly voices = new Set<VoiceHandle>();
  private readonly unlockRemovers: Array<() => void> = [];

  get isReady(): boolean {
    return this.isWired;
  }

  async start(): Promise<void> {
    if (this.context) {
      // 配線済み。解錠だけ試みる（resume の解決は待たない）
      this.unlock();
      return;
    }
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
      this.lastError = error instanceof Error ? error.message : String(error);
      return; // 視覚は visualClock へ退避して続く（正本 §4 の状態表）
    }
    this.installUnlockListeners();
    // running を検知したら pending 列を遅延開始する（正本 §3・§5。絵も同じ clock へ合わせる）
    context.onstatechange = () => {
      if (context.state === "running") this.schedulePendingSequences();
    };
    this.unlock();
  }

  private unlock(): void {
    const context = this.context;
    if (!context || context.state === "running") return;
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

    dry.gain.value = 1 - AUDIO_REVERB_WET;
    wet.gain.value = AUDIO_REVERB_WET;
    convolver.buffer = this.buildImpulseResponse(context);
    compressor.threshold.value = -10;
    compressor.ratio.value = 12;
    master.gain.value = AUDIO_MASTER_GAIN;
    analyser.fftSize = 1024;

    fxIn.connect(dry).connect(compressor);
    fxIn.connect(convolver).connect(wet).connect(compressor);
    compressor.connect(master).connect(analyser).connect(context.destination);

    this.fxIn = fxIn;
    this.master = master;
    this.analyser = analyser;
    this.analyserBuffer = new Float32Array(analyser.fftSize);
    this.isWired = true;
  }

  /** 減衰するノイズで残響の IR を生成する（外部 IR ファイル不要。tail 上限 1.2 秒） */
  private buildImpulseResponse(context: AudioContext): AudioBuffer {
    const length = Math.floor(context.sampleRate * AUDIO_REVERB_TAIL_S);
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < length; index++) {
        data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / length, 3);
      }
    }
    return buffer;
  }

  /** pointerup / touchend / click / keydown の常駐解錠（正本 §5）。dispose で解除する */
  private installUnlockListeners(): void {
    const unlock = (): void => this.unlock();
    for (const type of ["pointerup", "touchend", "click", "keydown"]) {
      window.addEventListener(type, unlock, { passive: true });
      this.unlockRemovers.push(() => window.removeEventListener(type, unlock));
    }
  }

  planSequence(plan: SequencePlan): void {
    // 列は最大 4（正本 §5）。main も置換時に cancelSequence を呼ぶが、防御として冪等に消す
    while (this.sequences.size >= MAX_CONSTELLATIONS) {
      const oldest = this.sequences.keys().next();
      if (oldest.done) break;
      this.cancelSequence(oldest.value);
    }
    const context = this.context;
    // AudioContext がある限り列は pending で保持し running を待つ
    // （正本 §3・§4 の状態表「音声が suspended（ページ visible）: 最大 4 列だけ保持、
    // running で共通起点を確定」。絵も pending で微光待機する）。
    // 視覚時計へ退避するのは音声非対応・start 失敗だけ（mute は NoopAudioEngine が担う）
    const sequence: PlannedSequence = {
      id: plan.id,
      plan,
      state: "pending",
      clock: context !== null ? { mode: "pending", firstAtMs: null, stepMs: STEP_MS } : this.visualClock(plan.releasedAtMs),
      voices: [],
    };
    this.sequences.set(plan.id, sequence);
    if (context !== null && context.state === "running" && document.visibilityState === "visible") {
      this.scheduleSequence(sequence, performance.now());
    }
  }

  /** 無音・非対応時の視覚時計。順序と寿命は音つきと同じ（正本 §4） */
  private visualClock(releasedAtMs: number): SequenceClock {
    return { mode: "visual", firstAtMs: releasedAtMs + FIRST_NOTE_DELAY_MS, stepMs: STEP_MS };
  }

  getSequenceClock(id: number): SequenceClock | null {
    return this.sequences.get(id)?.clock ?? null;
  }

  cancelSequence(id: number): void {
    const sequence = this.sequences.get(id);
    if (!sequence) return; // 冪等
    this.sequences.delete(id);
    this.cancelledSequences++;
    const context = this.context;
    const now = context ? context.currentTime : 0;
    for (const voice of sequence.voices) this.silenceVoice(voice, now);
    sequence.voices.length = 0;
  }

  /** blur / hidden / pagehide。全予約を破棄し、音源を 30ms で消音、残響も切る（正本 §3） */
  suspend(): void {
    const context = this.context;
    const now = context ? context.currentTime : 0;
    // 列に属さない voice（legacy note）も含めて全消音する
    for (const voice of this.voices) this.silenceVoice(voice, now);
    for (const sequence of this.sequences.values()) sequence.voices.length = 0;
    this.sequences.clear();
    if (context && this.master) {
      // 残響を含めて沈める。master は次の発音予約時に元へ戻す
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(0.0001, now, AUDIO_SUSPEND_FADE_MS / 3000);
    }
  }

  dispose(): void {
    for (const remove of this.unlockRemovers) remove();
    this.unlockRemovers.length = 0;
    this.suspend();
    const context = this.context;
    this.context = null;
    this.isWired = false;
    this.fxIn = null;
    this.master = null;
    this.analyser = null;
    this.analyserBuffer = null;
    if (context) context.close().catch(() => {});
  }

  /** pending 列を遅延開始する。hidden 中は予約しない（正本 §5） */
  private schedulePendingSequences(): void {
    if (document.visibilityState !== "visible") return;
    for (const sequence of this.sequences.values()) {
      if (sequence.state === "pending") this.scheduleSequence(sequence, performance.now());
    }
  }

  /**
   * 起点を確定して列を AudioContext 時刻へ予約する。basePerfMs は起点の performance 時刻
   * （即 schedule なら release 直後、復帰 schedule なら running を検知した時点 ─
   * 正本 §4「起点を新たに確定し、音と絵の両方を一緒に遅らせる。音だけ一気に追いつかせない」）
   */
  private scheduleSequence(sequence: PlannedSequence, basePerfMs: number): void {
    const context = this.context;
    if (!context || context.state !== "running") return;
    if (document.visibilityState !== "visible") return;
    this.restoreMaster();
    const firstPerfMs = basePerfMs + FIRST_NOTE_DELAY_MS;
    for (const [index, step] of sequence.plan.steps.entries()) {
      const atAudio = this.audioTimeAt(firstPerfMs + index * STEP_MS);
      this.scheduleNote(sequence, step, atAudio);
    }
    sequence.state = "scheduled";
    // 可聴時刻 = 発音スケジュール時刻 + 出力レイテンシ。絵はこの clock.firstAtMs から伸びる
    const latencySec = this.outputLatencySec();
    sequence.clock = { mode: "audio", firstAtMs: firstPerfMs + latencySec * 1000, stepMs: STEP_MS };
  }

  private outputLatencySec(): number {
    const context = this.context;
    if (!context) return 0;
    return context.outputLatency || context.baseLatency || 0;
  }

  /** performance.now() 基準の時刻を AudioContext 時刻へ写像する（正本 §4） */
  private audioTimeAt(performanceMs: number): number {
    const context = this.context;
    if (!context) return 0;
    // 利用可能なら getOutputTimestamp の相関を使い、なければ currentTime と現在時刻で近似
    const timestamp = context.getOutputTimestamp?.();
    if (timestamp && timestamp.performanceTime !== undefined && timestamp.contextTime !== undefined) {
      return timestamp.contextTime + (performanceMs - timestamp.performanceTime) / 1000;
    }
    return context.currentTime + (performanceMs - performance.now()) / 1000;
  }

  private restoreMaster(): void {
    const context = this.context;
    if (!context || !this.master) return;
    this.master.gain.cancelScheduledValues(context.currentTime);
    this.master.gain.setTargetAtTime(AUDIO_MASTER_GAIN, context.currentTime, AUDIO_SUSPEND_FADE_MS / 3000);
  }

  /** オルゴールの 1 voice を作って予約する。sine 基音＋倍音 2 倍/3 倍、attack 8ms・dry decay 900ms（正本 §6） */
  private createVoice(step: StarStep, atAudio: number): VoiceHandle | null {
    const context = this.context;
    const fxIn = this.fxIn;
    if (!context || !fxIn) return null;
    if (this.voices.size >= MAX_VOICES) return null; // 予約済みを含む上限（正本 §5。無制限の timeout を置かない）
    const frequency = midiToFrequency(step.midi);
    const peak = AUDIO_VOICE_PEAK * Math.min(1, Math.max(0, step.velocity));
    const stopAt = atAudio + NOTE_DECAY_MS / 1000 + 0.1;
    const voice = context.createGain();
    const panner = context.createStereoPanner();
    panner.pan.value = Math.min(1, Math.max(-1, step.x * 2 - 1));
    voice.gain.setValueAtTime(0.0001, atAudio);
    voice.gain.exponentialRampToValueAtTime(peak, atAudio + NOTE_ATTACK_MS / 1000);
    voice.gain.exponentialRampToValueAtTime(0.0001, atAudio + NOTE_DECAY_MS / 1000);
    voice.connect(panner).connect(fxIn);
    const sources: OscillatorNode[] = [];
    for (const [ratio, gain] of AUDIO_PARTIALS) {
      const oscillator = context.createOscillator();
      const partial = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency * ratio;
      partial.gain.value = gain;
      oscillator.connect(partial).connect(voice);
      oscillator.start(atAudio);
      oscillator.stop(stopAt);
      sources.push(oscillator);
    }
    const handle: VoiceHandle = { gain: voice, sources, startAtAudio: atAudio };
    this.voices.add(handle);
    // 基音の終了で voice を解放（3 本の stop は同時刻）。disconnect は冪等に扱う（正本 §5）
    sources[0].onended = () => {
      this.voices.delete(handle);
      voice.disconnect();
      panner.disconnect();
      for (const source of sources) source.disconnect();
    };
    return handle;
  }

  private scheduleNote(sequence: PlannedSequence, step: StarStep, atAudio: number): void {
    const voice = this.createVoice(step, atAudio);
    if (voice) sequence.voices.push(voice);
  }

  /** 鳴りかけ・鳴り中の voice を 30ms で消音してから止める（クリックを防ぐ短い減衰） */
  private silenceVoice(voice: VoiceHandle, now: number): void {
    if (!this.voices.has(voice)) return; // 終了済み（onended 済み）の voice は触らない
    const gain = voice.gain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(Math.max(0.0001, gain.value), now);
    gain.setTargetAtTime(0.0001, now, AUDIO_SUSPEND_FADE_MS / 3000);
    const stopAt = now + AUDIO_SUSPEND_FADE_MS / 1000 + 0.05;
    for (const source of voice.sources) {
      try {
        source.stop(stopAt); // 未開始の source も stop できる（鳴らずに破棄される）
      } catch {
        this.lastError = "voice stop に失敗";
      }
    }
  }

  note(event: NoteEvent): void {
    // legacy 契約。通常の収集では使わない（正本 §5）。列に属さない即時の 1 音としてだけ成立させる
    const context = this.context;
    if (!context || !this.isWired) return;
    this.createVoice(
      { starId: -1, x: event.x, y: event.y, midi: event.midi, velocity: event.velocity },
      this.audioTimeAt(performance.now()),
    );
  }

  setEnergy(): void {
    // オルゴールは energy を使わない（正本 §6。音色・音量は固定ノブのみ）
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
    const context = this.context;
    let scheduledNotes = 0;
    for (const voice of this.voices) {
      if (context && voice.startAtAudio > context.currentTime) scheduledNotes++;
    }
    let pendingSequences = 0;
    for (const sequence of this.sequences.values()) {
      if (sequence.state === "pending") pendingSequences++;
    }
    return {
      engine: "musicbox",
      contextState: context?.state ?? "none",
      isReady: this.isWired,
      pendingSequences,
      scheduledNotes,
      activeVoices: this.voices.size,
      cancelledSequences: this.cancelledSequences,
      lastAudioError: this.lastError,
    };
  }
}

/**
 * 無音実装（?mute）。AudioContext を作らず、全列の視覚時計を返し、
 * 全停止メソッドを安全に受ける（正本 §5）。getAmp は常に 0（偽装しない）
 */
export class NoopAudioEngine implements StarAudioEngine {
  readonly isReady = false;
  private readonly plans = new Map<number, SequencePlan>();

  async start(): Promise<void> {}
  note(): void {}
  setEnergy(): void {}
  getAmp(): number {
    return 0;
  }

  planSequence(plan: SequencePlan): void {
    while (this.plans.size >= MAX_CONSTELLATIONS) {
      const oldest = this.plans.keys().next();
      if (oldest.done) break;
      this.plans.delete(oldest.value);
    }
    this.plans.set(plan.id, plan);
  }

  getSequenceClock(id: number): SequenceClock | null {
    const plan = this.plans.get(id);
    if (!plan) return null;
    return { mode: "visual", firstAtMs: plan.releasedAtMs + FIRST_NOTE_DELAY_MS, stepMs: STEP_MS };
  }

  cancelSequence(id: number): void {
    this.plans.delete(id);
  }

  suspend(): void {
    this.plans.clear();
  }

  dispose(): void {
    this.plans.clear();
  }

  getDiagnostics(): Record<string, string | number | boolean> {
    return { engine: "noop" };
  }
}

/** URL に ?mute を付けると無音（視覚のみ）で起動する */
export function createAudioEngine(): StarAudioEngine {
  if (new URLSearchParams(location.search).has("mute")) {
    return new NoopAudioEngine();
  }
  return new MusicBoxAudioEngine();
}
