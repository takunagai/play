// ============================================================
// quality.ts ─ 画質の自動調整（段を下げるだけの単純版）
// フレーム間隔の中央値が遅く、かつ変動が大きいときだけ負荷とみなして 1 段下げる。
// 変動が小さい遅さは rAF の制限（省エネモードの 30Hz 等）で負荷ではないので下げない。
// 画質段は終演スパークルの上限（tuning.ts の PARTICLE_CAP_STEPS）にだけ効く。
// 板数・連鎖時間・光跡の形は画質で変えない（docs/architecture.md 第 7.3 節）。
// ============================================================

import {
  QUALITY_SLOW_FRAME_MEDIAN_MS,
  QUALITY_THROTTLE_MAX_VARIATION,
  QUALITY_WARMUP_MS,
  QUALITY_WINDOW_MS,
} from "./tuning";

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function coefficientOfVariation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/** 1 つの窓が「負荷で遅い」か（純関数） */
export function isOverloadedWindow(frameIntervalsMs: readonly number[]): boolean {
  return (
    median(frameIntervalsMs) > QUALITY_SLOW_FRAME_MEDIAN_MS &&
    coefficientOfVariation(frameIntervalsMs) >= QUALITY_THROTTLE_MAX_VARIATION
  );
}

export class QualityController {
  /** 0 = 最高。段の数は呼び出し側の配列（例: PARTICLE_CAP_STEPS）の長さ */
  private level = 0;
  private elapsedMs = 0;
  private windowElapsedMs = 0;
  private samples: number[] = [];
  private readonly maxLevel: number;

  constructor(levelCount: number) {
    this.maxLevel = Math.max(0, levelCount - 1);
  }

  getLevel(): number {
    return this.level;
  }

  /** 毎フレーム呼ぶ。段が変わったら true */
  recordFrame(frameIntervalMs: number): boolean {
    this.elapsedMs += frameIntervalMs;
    if (this.elapsedMs < QUALITY_WARMUP_MS || this.level >= this.maxLevel) return false;
    this.samples.push(frameIntervalMs);
    this.windowElapsedMs += frameIntervalMs;
    if (this.windowElapsedMs < QUALITY_WINDOW_MS) return false;
    const isOverloaded = isOverloadedWindow(this.samples);
    this.samples = [];
    this.windowElapsedMs = 0;
    if (!isOverloaded) return false;
    this.level++;
    return true;
  }
}
