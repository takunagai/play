// ============================================================
// quality.ts ─ 適応型画質（standard / rich）の判定ロジック
// 判定の核（median・evaluateRichTrial・isDegradedWindow）は状態を持たない純関数にし、
// フレーム間隔の配列を渡すだけでテストできるようにする。正本は docs/architecture.md 8 節。
// ============================================================

import {
  QUALITY_BASELINE_DELAY_MS,
  QUALITY_DOWNGRADE_CONSECUTIVE,
  QUALITY_DOWNGRADE_RATIO,
  QUALITY_DOWNGRADE_WINDOW_MS,
  QUALITY_MIN_HARDWARE_CONCURRENCY,
  QUALITY_RICH_KEEP_RATIO,
  QUALITY_RICH_KEEP_SLOW_FRAME_RATIO,
  QUALITY_RICH_TRIAL_MS,
  QUALITY_SLOW_FRAME_MS,
  QUALITY_STORAGE_KEY,
} from "./tuning";

export type QualityTier = "standard" | "rich";
export type QualityPhase = "fixed" | "baseline" | "trial" | "monitoring" | "idle";

// ---- 純関数（テスト対象の核） ----

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function slowFrameRatio(values: readonly number[], thresholdMs: number): number {
  if (values.length === 0) return 0;
  const slowCount = values.filter((v) => v > thresholdMs).length;
  return slowCount / values.length;
}

/** rich 試行を維持してよいか（docs 8 節 5.） */
export function evaluateRichTrial(samples: readonly number[], baselineMedianMs: number): boolean {
  if (baselineMedianMs <= 0 || samples.length === 0) return false;
  const ratio = median(samples) / baselineMedianMs;
  const slowRatio = slowFrameRatio(samples, QUALITY_SLOW_FRAME_MS);
  return ratio <= QUALITY_RICH_KEEP_RATIO && slowRatio < QUALITY_RICH_KEEP_SLOW_FRAME_RATIO;
}

/** 監視窓 1 つが悪化ウィンドウか（docs 8 節 6.） */
export function isDegradedWindow(samples: readonly number[], baselineMedianMs: number): boolean {
  if (baselineMedianMs <= 0 || samples.length === 0) return false;
  return median(samples) > baselineMedianMs * QUALITY_DOWNGRADE_RATIO;
}

// ---- localStorage（端末の便宜。読み書きは try-catch で囲む） ----

function readStoredTier(): QualityTier | null {
  try {
    const value = localStorage.getItem(QUALITY_STORAGE_KEY);
    return value === "standard" || value === "rich" ? value : null;
  } catch {
    return null;
  }
}

function writeStoredTier(tier: QualityTier): void {
  try {
    localStorage.setItem(QUALITY_STORAGE_KEY, tier);
  } catch {
    // 保存できなくても動作は継続する
  }
}

function readQualityOverride(): QualityTier | null {
  const value = new URLSearchParams(location.search).get("quality");
  return value === "standard" || value === "rich" ? value : null;
}

/** WebGL2 コンテキストを実際に作れるか（一度だけ判定する） */
export function canCreateWebGL2(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    return gl !== null;
  } catch {
    return false;
  }
}

function meetsHardwarePrerequisite(): boolean {
  const concurrency = navigator.hardwareConcurrency;
  return concurrency === undefined || concurrency >= QUALITY_MIN_HARDWARE_CONCURRENCY;
}

export interface QualityDiagnostics {
  tier: QualityTier;
  phase: QualityPhase;
  baselineMedianMs: number | null;
  canUpgrade: boolean;
}

/**
 * standard → rich への自動昇格・降格を管理する。main.ts は毎フレーム recordFrame() を呼ぶだけでよい。
 */
export class QualityController {
  private tier: QualityTier;
  private phase: QualityPhase;
  private readonly canUpgrade: boolean;
  private readonly storedPreference: QualityTier | null;
  private elapsedPlayMs = 0;
  private baselineSamples: number[] = [];
  private baselineMedianMs: number | null = null;
  private trialElapsedMs = 0;
  private trialSamples: number[] = [];
  private monitorWindowElapsedMs = 0;
  private monitorSamples: number[] = [];
  private consecutiveBadWindows = 0;

  constructor() {
    const override = readQualityOverride();
    this.storedPreference = readStoredTier();
    this.canUpgrade = canCreateWebGL2() && meetsHardwarePrerequisite();

    if (override) {
      this.tier = override;
      this.phase = "fixed";
    } else {
      // rule 1: 起動は必ず standard
      this.tier = "standard";
      this.phase = "baseline";
    }
  }

  getTier(): QualityTier {
    return this.tier;
  }

  /** WebGL2 のコンパイル失敗・コンテキスト喪失を rich-gl.ts 側が検知したら呼ぶ。以後このセッションは standard 固定 */
  forceStandardFallback(): void {
    this.tier = "standard";
    this.phase = "idle";
    writeStoredTier("standard");
  }

  /** 毎フレーム呼ぶ。dtMs はこのフレームの実測間隔（rAF の呼び出し間隔） */
  recordFrame(dtMs: number): void {
    this.elapsedPlayMs += dtMs;

    switch (this.phase) {
      case "fixed":
        return;

      case "baseline": {
        this.baselineSamples.push(dtMs);
        if (this.elapsedPlayMs < QUALITY_BASELINE_DELAY_MS) return;
        this.baselineMedianMs = median(this.baselineSamples);
        this.baselineSamples = [];

        if (!this.canUpgrade) {
          this.phase = "idle";
          return;
        }
        if (this.storedPreference === "standard") {
          this.phase = "idle";
          return;
        }
        if (this.storedPreference === "rich") {
          // 前回 rich が通っているので判定試行を省き、そのまま昇格する
          this.tier = "rich";
          this.phase = "monitoring";
          this.monitorWindowElapsedMs = 0;
          this.monitorSamples = [];
          return;
        }
        this.tier = "rich";
        this.phase = "trial";
        this.trialElapsedMs = 0;
        this.trialSamples = [];
        return;
      }

      case "trial": {
        this.trialElapsedMs += dtMs;
        this.trialSamples.push(dtMs);
        if (this.trialElapsedMs < QUALITY_RICH_TRIAL_MS) return;

        const baseline = this.baselineMedianMs ?? 16.7;
        const keepRich = evaluateRichTrial(this.trialSamples, baseline);
        this.trialSamples = [];
        if (keepRich) {
          this.tier = "rich";
          this.phase = "monitoring";
          this.monitorWindowElapsedMs = 0;
          this.monitorSamples = [];
          writeStoredTier("rich");
        } else {
          this.tier = "standard";
          this.phase = "idle"; // このセッションでは再試行しない
          writeStoredTier("standard");
        }
        return;
      }

      case "monitoring": {
        this.monitorWindowElapsedMs += dtMs;
        this.monitorSamples.push(dtMs);
        if (this.monitorWindowElapsedMs < QUALITY_DOWNGRADE_WINDOW_MS) return;

        const baseline = this.baselineMedianMs ?? 16.7;
        const degraded = isDegradedWindow(this.monitorSamples, baseline);
        this.monitorWindowElapsedMs = 0;
        this.monitorSamples = [];
        this.consecutiveBadWindows = degraded ? this.consecutiveBadWindows + 1 : 0;

        if (this.consecutiveBadWindows >= QUALITY_DOWNGRADE_CONSECUTIVE) {
          this.tier = "standard";
          this.phase = "idle"; // 降格後は再昇格を狙わない（往復振動を避ける）
          writeStoredTier("standard");
        }
        return;
      }

      case "idle":
        return;
    }
  }

  getDiagnostics(): QualityDiagnostics {
    return {
      tier: this.tier,
      phase: this.phase,
      baselineMedianMs: this.baselineMedianMs,
      canUpgrade: this.canUpgrade,
    };
  }
}
