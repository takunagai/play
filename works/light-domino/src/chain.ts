// ============================================================
// chain.ts ─ 連鎖タイムラインの純粋計算（音響・無音で共通）
// 正本は docs/architecture.md 第 3.4 節。AudioContext に依存しない。
// ============================================================

/**
 * 板間隔（ms）。190ms → 95ms へ easeInQuad で縮める。
 * progress は 0..1（列の始端からの割合）。
 */
export function intervalMs(progress: number, startMs: number, endMs: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  const eased = clamped * clamped; // easeInQuad
  return startMs + (endMs - startMs) * eased;
}

/**
 * 連鎖の時刻表を作る。
 * - 先頭は基準時刻 + firstDelayMs
 * - 間隔は intervalMs() で加速するが、全体が [minDurationMs, maxDurationMs] に収まるよう一様に伸縮する
 */
export function buildFallTimes(count: number, firstDelayMs: number, startMs: number, endMs: number, minDurationMs: number, maxDurationMs: number): number[] {
  if (count <= 0) return [];
  const progressAt = (index: number): number => (count === 1 ? 0 : index / (count - 1));
  const raw: number[] = [firstDelayMs];
  for (let index = 1; index < count; index++) {
    raw.push(raw[index - 1] + intervalMs(progressAt(index - 1), startMs, endMs));
  }
  const span = raw[count - 1] - raw[0];
  if (span <= 0) return raw;
  let scale = 1;
  if (span < minDurationMs) scale = minDurationMs / span;
  else if (span > maxDurationMs) scale = maxDurationMs / span;
  if (scale === 1) return raw;
  return raw.map((time, index) => (index === 0 ? time : raw[0] + (time - raw[0]) * scale));
}

/** 倒れの進行 0..1。easeInCubic（最初は重く、倒れ切る寸前で速い） */
export function fallProgress(elapsedMs: number, fallMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs / fallMs));
  return t * t * t;
}
