// ============================================================
// engine.ts ─ AudioEngine 契約 + Noop 実装 + ファクトリ
// main.ts は createAudioEngine() 経由でのみ音響に触る（Web Audio を直接触らない）。
// 機能を足すときもこの契約を拡張する。正本は docs/architecture.md 第 5 節。
// ============================================================

export interface ChainEvent {
  /** 0..1（画面幅で正規化） */
  x: number;
  /** 0..1（画面高さで正規化） */
  y: number;
  /** music.ts が決める */
  midi: number;
  /** 0..1 */
  velocity: number;
}

export interface ChainSchedule {
  /** performance.now() と同じ時刻系。板 i の倒れ始め（最後の 1 枚は視覚では hushAtMs から倒れる） */
  fallAtMs: readonly number[];
  /** 「間」の始まり。最後の板が倒れ始める直前で、ここから終演まで新しい打音を鳴らさない */
  hushAtMs: number;
  /** 最後の板が床へ触れる瞬間。和音・発光・衝撃波をこの時刻へ揃える */
  finaleAtMs: number;
  /** 曲線を静的な光跡へ焼き付けて板を破棄できる時刻 */
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
  /** 板を 1 枚置いた（なぞり中）。位置で pan、小さな木製クリック */
  place(x: number, y: number): void;
  /** 指を離して列が確定した（吸着の合図）。低い木のクリック 1 音 */
  align(tileCount: number): void;
  /**
   * 連鎖を始める。単音と終演和音を内部の時刻系で先行予約し、視覚が使う ChainSchedule を返す。
   * 音声が未解錠でも同じ純粋なスケジュールを返し、視覚だけが進む。
   */
  beginChain(events: readonly ChainEvent[]): ChainSchedule;
  /** マスター振幅 0..1。1 フレーム 1 回だけ呼ぶ */
  getAmp(): number;
  /** ?debug 表示用 */
  getDiagnostics(): Record<string, string | number | boolean>;
}

import { buildFallTimes } from "../chain";
import {
  CHAIN_DURATION_MAX_MS,
  CHAIN_DURATION_MIN_MS,
  CHAIN_FIRST_DELAY_MS,
  CHAIN_INTERVAL_END_MS,
  CHAIN_INTERVAL_START_MS,
  FALL_MS,
  FINALE_SETTLE_MS,
  PREFINALE_HUSH_MS,
} from "../tuning";

/**
 * 連鎖の純粋なタイムライン計算。Synth / Noop 両エンジンが使い、
 * 無音時（?mute・未解錠）でも視覚の速さが変わらないようにする。
 *
 * 時刻の定義:
 * - fallAtMs[i]: 板 i の倒れ始め（音の予約もここ）
 * - hushAtMs = fallAtMs[n-1] + FALL_MS - PREFINALE_HUSH_MS（最後の板の着地の 160ms 前）
 * - finaleAtMs = fallAtMs[n-1] + FALL_MS（最後の板の着地）
 */
export function computeChainSchedule(events: readonly ChainEvent[], nowMs: number): ChainSchedule {
  const fallAtMs = buildFallTimes(
    events.length,
    CHAIN_FIRST_DELAY_MS,
    CHAIN_INTERVAL_START_MS,
    CHAIN_INTERVAL_END_MS,
    CHAIN_DURATION_MIN_MS,
    CHAIN_DURATION_MAX_MS,
  ).map((offset) => nowMs + offset);
  const lastFall = fallAtMs[fallAtMs.length - 1] ?? nowMs;
  const finaleAtMs = lastFall + FALL_MS;
  const hushAtMs = Math.max(nowMs, finaleAtMs - PREFINALE_HUSH_MS);
  return {
    fallAtMs,
    hushAtMs,
    finaleAtMs,
    settleAtMs: finaleAtMs + FINALE_SETTLE_MS,
  };
}

export class NoopAudioEngine implements AudioEngine {
  readonly isReady = false;
  async start(): Promise<void> {}
  place(): void {}
  align(): void {}
  beginChain(events: readonly ChainEvent[]): ChainSchedule {
    return computeChainSchedule(events, performance.now());
  }
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
