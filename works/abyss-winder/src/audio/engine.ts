// ============================================================
// engine.ts ─ AudioEngine 契約 + Noop 実装 + ファクトリ
// main.ts は createAudioEngine() 経由でのみ音響に触る（Web Audio を直接触らない）。
// 機能を足すときもこの契約を拡張する。正本は docs/architecture.md §7（AudioEngine 契約）。
// ClosureTimeline と拍の式は winding.ts（共通時刻契約 §5）を正本とし、ここで再定義しない。
// ============================================================

import { planClosureTimes, type ClosureTimeline } from "../winding";

/** 一周受理後に確定する共通時刻契約。正本は winding.ts（architecture.md §5） */
export type { ClosureTimeline };

export interface NoteEvent {
  /** 0..1（画面幅で正規化）。音程には使わない（位置で音階を上げない） */
  x: number;
  /** 0..1（画面高さで正規化） */
  y: number;
  midi: number;
  /** 0..1 の強さ */
  velocity: number;
}

/** 巻き取り中の音響 cue。main.ts の draw ループから 1 フレーム 1 回以下で送る */
export interface WindingCue {
  /** 巻き取り試行の識別子。main.ts が掴みごとに採番する */
  gestureId: number;
  /** start: 索端の掴み / move: 巻き中 / cancel: 試行の取消（同 gesture の摩擦・拍予約を消す） */
  phase: "start" | "move" | "cancel";
  /** 未完の巻き進捗 0..1。音側は完成条件に使わない */
  progress: number;
  /** 平滑化角速度 rad/s（符号付き）。摩擦ゲインと爪音の長さに写像する */
  speed: number;
  /** 0..1（半径誤差が小さいほど高い） */
  accuracy: number;
  /** performance.now() と同じ原点のミリ秒 */
  atMs: number;
  /** 巻き取り開始時に設定された拍の原点（共通時刻契約） */
  beatOriginMs: number;
}

export interface AudioEngine {
  /**
   * ユーザー操作のハンドラ内で呼ぶ。resume() の解決を待たずに配線まで済ませ、
   * 常駐の解錠リスナー（pointerup / touchend / click / keydown）を置く。
   * タッチは pointerdown では解錠できず、指を離した時に初めて解錠できるため
   */
  start(): Promise<void>;
  /** 配線が済んでいるか。context が running とは限らない。false の間、他メソッドは何もしない */
  readonly isReady: boolean;
  note(event: NoteEvent): void;
  winding(cue: WindingCue): void;
  /**
   * 一周受理後の閉鎖予定を音側の時計へ対応付け、閉鎖音（クリック・木胴・ベル）を予約する。
   * 拍の式は winding.ts の planClosureTimes（architecture §5）と同じ。同 token に対して
   * 同じ予定を返す冪等操作
   */
  planClosure(token: number, acceptedAtMs: number, beatOriginMs: number): ClosureTimeline;
  /** 対応 token の未発音の閉鎖音・摩擦・拍予約を止める（冪等。他の達成済み輪へ作用しない） */
  cancelClosure(token: number): void;
  /**
   * 非表示時の予約・摩擦を止め、再開時の過去音バーストを防ぐ。
   * visibility の判定自体と状態遷移は main の責務
   */
  suspend(): void;
  /** 毎フレーム呼ばれてよい（内部で平滑化） */
  setEnergy(energy: number): void;
  /** マスター振幅 0..1。1 フレーム 1 回だけ呼ぶ */
  getAmp(): number;
  /** ?debug 表示用 */
  getDiagnostics(): Record<string, string | number | boolean>;
}

export class NoopAudioEngine implements AudioEngine {
  readonly isReady = false;
  async start(): Promise<void> {}
  note(): void {}
  winding(): void {}
  /** mute / 非対応でも視覚と同じ論理時計を返す（architecture.md §5）。純関数なので冪等 */
  planClosure(token: number, acceptedAtMs: number, beatOriginMs: number): ClosureTimeline {
    const plan = planClosureTimes(acceptedAtMs, beatOriginMs);
    return { token, freezeAtMs: plan.freezeAtMs, closeAtMs: plan.closeAtMs };
  }
  cancelClosure(): void {}
  suspend(): void {}
  setEnergy(): void {}
  getAmp(): number {
    return 0;
  }
  getDiagnostics(): Record<string, string | number | boolean> {
    return { engine: "noop" };
  }
}

import { SynthAudioEngine } from "./synth-engine";

/** URL に ?mute を付けると無音（視覚のみ）で起動する */
export function createAudioEngine(): AudioEngine {
  if (new URLSearchParams(location.search).has("mute")) {
    return new NoopAudioEngine();
  }
  return new SynthAudioEngine();
}
