// ============================================================
// engine.ts ─ AudioEngine 契約 + Noop 実装 + ファクトリ + CutSchedule の純粋計算
// main.ts は createAudioEngine() 経由でのみ音響に触る（Web Audio を直接触らない）。
// 機能を足すときもこの契約を拡張する。正本は docs/architecture.md 第 5 節。
// ============================================================

import { BPM, COLLAPSE_TAIL_MS, HITSTOP_MS, SLIDE_MS, SIXTEENTH_MS } from "../tuning";

export interface NoteEvent {
  /** 0..1（画面幅で正規化） */
  x: number;
  /** 0..1（画面高さで正規化） */
  y: number;
  /** music.ts が D ドリアンから決める */
  midi: number;
  /** 0..1 の強さ */
  velocity: number;
}

export interface CutEvent {
  /** 切断線の角度（rad） */
  angleRad: number;
  /** 切断線の高さ（0..1。下ほど大） */
  cutY: number;
  /** 鋭さ 0..1（スワイプ速度から） */
  sharpness: number;
  /** 崩壊する段数 */
  rowCount: number;
}

export interface CutSchedule {
  /** performance.now() と同じ時刻系 */
  cutAtMs: number;
  hitStopEndMs: number;
  slideEndMs: number;
  /** 段 i が砕ける時刻（上段から順。16 分拍） */
  collapseStepAtMs: readonly number[];
  settleAtMs: number;
}

export interface AudioEngine {
  /**
   * ユーザー操作のハンドラ内で呼ぶ。resume() の解決を待たずに配線まで済ませ、
   * 常駐の解錠リスナー（pointerup / touchend / click / keydown）を置く。
   * タッチは pointerdown では解錠できず、指を離した時に初めて解錠できるため
   */
  start(): Promise<void>;
  /** 配線が済んでいるか。false の間、音を出すメソッドは黙って何もしない */
  readonly isReady: boolean;
  /** 切断を開始し、16 分拍の時刻表を返す。未解錠でも同じ純粋なスケジュールを返す */
  beginCut(event: CutEvent): CutSchedule;
  /** 崩壊段 1 個のガラス鐘を今鳴らす（16 分拍の時刻合わせは呼び出し側。正本 §4 collapse/step） */
  scheduleGlassStep(rowIndex: number, rowCount: number, normalizedX: number, sharpness: number): void;
  /** 砂の微音へ使う（雛形の note の用途を狭めて維持。正本 §5） */
  note(event: NoteEvent): void;
  /** 砂が着地した（多数は 30ms 窓で束ねる。正本 §4 sand/settle） */
  sandSettle(mass: number): void;
  /** 再生（regrowing）の低いガラス倍音。progress で緩く上げ、ready で stopRegrowDrone する（正本 §4） */
  startRegrowDrone(): void;
  updateRegrowDrone(progress: number): void;
  stopRegrowDrone(): void;
  /** 状態ごとの共鳴量 0..1。setEnergy の用途（正本 §5） */
  setEnergy(energy: number): void;
  /** マスター振幅 0..1。1 フレーム 1 回だけ呼ぶ */
  getAmp(): number;
  /** ?debug 表示用 */
  getDiagnostics(): Record<string, string | number | boolean>;
}

/**
 * CutSchedule の純粋なタイムライン計算。Synth / Noop 両エンジンが使い、
 * 無音時（?mute・未解錠）でも視覚の速さが変わらないようにする（正本 §5・§9）。
 * テンポは BPM、16 分音符は SIXTEENTH_MS。rowCount 個の時刻を作り、
 * 最終時刻 + COLLAPSE_TAIL_MS を settleAtMs とする。
 */
export function computeCutSchedule(event: CutEvent, nowMs: number): CutSchedule {
  const cutAtMs = nowMs;
  const hitStopEndMs = cutAtMs + HITSTOP_MS;
  const slideEndMs = cutAtMs + SLIDE_MS;
  // 砕け始めはヒットストップ明け + 滑落の直後から。16 分拍で rowCount 段分
  const firstStepMs = slideEndMs + SIXTEENTH_MS;
  const collapseStepAtMs = Array.from({ length: Math.max(1, event.rowCount) }, (_, index) => firstStepMs + index * SIXTEENTH_MS);
  const lastStepMs = collapseStepAtMs[collapseStepAtMs.length - 1] ?? firstStepMs;
  return {
    cutAtMs,
    hitStopEndMs,
    slideEndMs,
    collapseStepAtMs,
    settleAtMs: lastStepMs + COLLAPSE_TAIL_MS,
  };
}

/** BPM の公開（診断とデバッグ表示で使う） */
export const CURRENT_BPM = BPM;

export class NoopAudioEngine implements AudioEngine {
  readonly isReady = false;
  async start(): Promise<void> {}
  beginCut(event: CutEvent): CutSchedule {
    return computeCutSchedule(event, performance.now());
  }
  note(): void {}
  sandSettle(): void {}
  setEnergy(): void {}
  /** 崩壊段の音（Noop では無音。視覚の速度を変えない。正本 §5・§9） */
  scheduleGlassStep(): void {}
  startRegrowDrone(): void {}
  updateRegrowDrone(): void {}
  stopRegrowDrone(): void {}
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
