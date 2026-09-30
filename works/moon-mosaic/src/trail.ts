// ============================================================
// trail.ts ─ ポインタ履歴・弧長再サンプリング・StarPath（正本 §4.3 / §4.4 / §8.3）
// ============================================================

/** ポインタ履歴の 1 点 */
export interface TrailPoint {
  x: number;
  y: number;
  t: number; // performance.now() 系（ms）
}

/** 確定した航跡。弧長 12px（画質段で変動）ごとに再サンプリングした節点列 */
export interface StarPath {
  points: Array<{ x: number; y: number }>;
  /** 確定時刻（ms）。古い順に alpha を落とすのに使う */
  bornMs: number;
}

/** 指定時刻より新しい点だけを残した履歴を返す（純関数） */
export function pruneTrail(trail: readonly TrailPoint[], nowMs: number, keepMs: number): TrailPoint[] {
  const cutoff = nowMs - keepMs;
  let start = trail.length;
  for (let index = trail.length - 1; index >= 0; index--) {
    if (trail[index].t < cutoff) break;
    start = index;
  }
  return trail.slice(start);
}

/** 履歴から timeMs の時点（過去方向へ timeMs 前）の位置を補間する。履歴が短いときは最古の点 */
export function trailPointAt(trail: readonly TrailPoint[], nowMs: number, delayMs: number): { x: number; y: number } | null {
  if (trail.length === 0) return null;
  const targetMs = nowMs - delayMs;
  if (targetMs <= trail[0].t) return { x: trail[0].x, y: trail[0].y };
  const last = trail[trail.length - 1];
  if (targetMs >= last.t) return { x: last.x, y: last.y };
  for (let index = trail.length - 1; index > 0; index--) {
    const later = trail[index];
    const earlier = trail[index - 1];
    if (targetMs >= earlier.t && targetMs <= later.t) {
      const span = later.t - earlier.t;
      const ratio = span > 0 ? (targetMs - earlier.t) / span : 0;
      return { x: earlier.x + (later.x - earlier.x) * ratio, y: earlier.y + (later.y - earlier.y) * ratio };
    }
  }
  return { x: last.x, y: last.y };
}

/** 直近 windowMs の点列から平均速度ベクトル（px/s）を求める（純関数） */
export function velocityOf(trail: readonly TrailPoint[], nowMs: number, windowMs: number): { vx: number; vy: number } {
  if (trail.length < 2) return { vx: 0, vy: 0 };
  const cutoff = nowMs - windowMs;
  let first = trail.length - 1;
  for (let index = trail.length - 1; index >= 0; index--) {
    if (trail[index].t < cutoff) break;
    first = index;
  }
  if (first >= trail.length - 1) {
    first = Math.max(0, trail.length - 2);
  }
  const earlier = trail[first];
  const later = trail[trail.length - 1];
  const dt = (later.t - earlier.t) / 1000;
  if (dt <= 0) return { vx: 0, vy: 0 };
  return { vx: (later.x - earlier.x) / dt, vy: (later.y - earlier.y) / dt };
}

/** 点列を弧長 stepPx ごとに再サンプリングする（純関数）。端点は必ず含める */
export function resampleByArcLength(points: ReadonlyArray<{ x: number; y: number }>, stepPx: number): Array<{ x: number; y: number }> {
  if (points.length < 2 || stepPx <= 0) return points.map((point) => ({ x: point.x, y: point.y }));
  const out: Array<{ x: number; y: number }> = [{ x: points[0].x, y: points[0].y }];
  let carry = 0;
  let previous = points[0];
  for (let index = 1; index < points.length; index++) {
    const current = points[index];
    const segment = Math.hypot(current.x - previous.x, current.y - previous.y);
    if (segment === 0) continue;
    let traveled = stepPx - carry;
    while (traveled <= segment) {
      const ratio = traveled / segment;
      out.push({ x: previous.x + (current.x - previous.x) * ratio, y: previous.y + (current.y - previous.y) * ratio });
      traveled += stepPx;
    }
    carry = segment - (traveled - stepPx);
    previous = current;
  }
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > stepPx * 0.5) out.push({ x: last.x, y: last.y });
  return out;
}

/** 画面座標を 1 列の航跡へサンプリングした StarPath を作る */
export function buildStarPath(points: ReadonlyArray<{ x: number; y: number }>, sampleStepPx: number, bornMs: number): StarPath {
  return { points: resampleByArcLength(points, sampleStepPx), bornMs };
}

/** StarPath の描画 alpha。新しいほど濃い（正本 §8.3: 0.22 → 0.08） */
export function starPathAlpha(maxCount: number, alphaNew: number, alphaOld: number, order: number): number {
  if (maxCount <= 1) return alphaNew;
  const ratio = Math.min(1, Math.max(0, order / (maxCount - 1)));
  return alphaNew + (alphaOld - alphaNew) * ratio;
}
