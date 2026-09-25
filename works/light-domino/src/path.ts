// ============================================================
// path.ts ─ 入力点の平滑化・弧長再サンプリング・板配置（純粋関数）
// 正本は docs/architecture.md 第 3.2 節。DOM・canvas に依存しない。
// ============================================================

export interface Vec2 {
  x: number;
  y: number;
}

/** 板 1 枚。中心は正規化座標（0..1）、接線は px 空間の向き */
export interface Domino {
  /** 中心（正規化座標 0..1） */
  nx: number;
  ny: number;
  /** 接線の単位ベクトル（px 空間。描画時の回転にそのまま使う） */
  tx: number;
  ty: number;
  /** 始端からの弧長比率 0..1（音程の決定に使う） */
  progress: number;
  /** 現れた瞬間（performance.now() 系）。フェードインに使う */
  bornAtMs: number;
}

/**
 * 直近 windowPoints 点の重み付き移動平均で手ぶれを弱める。
 * 窓の中で新しい点ほど強く効く。元の配列は壊さない。
 */
export function smoothPoints(points: readonly Vec2[], windowPoints: number): Vec2[] {
  if (points.length === 0) return [];
  if (windowPoints <= 1) return [...points];
  const out: Vec2[] = [];
  for (let index = 0; index < points.length; index++) {
    const start = Math.max(0, index - windowPoints + 1);
    let weightSum = 0;
    let x = 0;
    let y = 0;
    for (let j = start; j <= index; j++) {
      const weight = Math.pow(2, j - start);
      weightSum += weight;
      x += points[j].x * weight;
      y += points[j].y * weight;
    }
    out.push({ x: x / weightSum, y: y / weightSum });
  }
  return out;
}

/** 折れ線の弧長。単位は呼び出し側（通常 CSS px） */
export function pathLength(points: readonly Vec2[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

/**
 * ポリラインを弧長 spacing ごとに再サンプリングする。
 * 終点は必ず取る（直前の放出点と 35% 間隔より近い場合は統合）。
 */
export function resampleByArcLength(points: readonly Vec2[], spacing: number): Vec2[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [points[0]];
  if (spacing <= 0) return [...points];
  const out: Vec2[] = [{ x: points[0].x, y: points[0].y }];
  let ax = points[0].x;
  let ay = points[0].y;
  let carried = 0; // 最後の放出点から歩いた距離
  for (let index = 1; index < points.length; index++) {
    const bx = points[index].x;
    const by = points[index].y;
    let remaining = Math.hypot(bx - ax, by - ay);
    while (remaining > 0 && carried + remaining >= spacing) {
      const t = (spacing - carried) / remaining;
      ax += (bx - ax) * t;
      ay += (by - ay) * t;
      out.push({ x: ax, y: ay });
      remaining = Math.hypot(bx - ax, by - ay);
      carried = 0;
    }
    carried += remaining;
  }
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > spacing * 0.35) out.push({ x: last.x, y: last.y });
  else out[out.length - 1] = { x: last.x, y: last.y };
  return out;
}

/** 各点の接線。鋭い折れで急反転しないよう、前後の接線と平均してから正規化する */
function tangentsOf(points: readonly Vec2[]): Vec2[] {
  const raw: Vec2[] = new Array(points.length);
  for (let index = 0; index < points.length; index++) {
    const prev = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const length = Math.hypot(dx, dy);
    raw[index] = length === 0 ? { x: 1, y: 0 } : { x: dx / length, y: dy / length };
  }
  const smoothed: Vec2[] = new Array(points.length);
  for (let index = 0; index < points.length; index++) {
    const prev = raw[Math.max(0, index - 1)];
    const self = raw[index];
    const next = raw[Math.min(points.length - 1, index + 1)];
    let x = (prev.x + self.x * 2 + next.x) / 4;
    let y = (prev.y + self.y * 2 + next.y) / 4;
    const length = Math.hypot(x, y);
    if (length < 1e-6) {
      // 完全に打ち消し合った（行って戻った）場合は自分の接線を保つ。反転させない
      x = self.x;
      y = self.y;
    } else {
      x /= length;
      y /= length;
    }
    smoothed[index] = { x, y };
  }
  return smoothed;
}

/**
 * 補正済みの点列（px 空間）を板の中心列へ変換する。
 * progress は始端からの弧長比率。
 */
export function buildDominoes(points: readonly Vec2[], widthPx: number, heightPx: number, bornAtMs: number): Domino[] {
  if (points.length < 2 || widthPx <= 0 || heightPx <= 0) return [];
  const tangents = tangentsOf(points);
  const totalLength = pathLength(points);
  const dominoes: Domino[] = [];
  let cumulative = 0;
  for (let index = 0; index < points.length; index++) {
    if (index > 0) {
      cumulative += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    }
    dominoes.push({
      nx: points[index].x / widthPx,
      ny: points[index].y / heightPx,
      tx: tangents[index].x,
      ty: tangents[index].y,
      progress: totalLength === 0 ? 0 : cumulative / totalLength,
      bornAtMs,
    });
  }
  return dominoes;
}

function orientation(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

/** 自道の非隣接セグメントとの交差に接する点を返す。DOM・canvas 非依存。 */
export function crossingFlags(points: readonly Vec2[]): boolean[] {
  const flags = points.map(() => false);
  for (let first = 0; first < points.length - 1; first++) {
    for (let second = first + 2; second < points.length - 1; second++) {
      if (!segmentsCross(points[first], points[first + 1], points[second], points[second + 1])) continue;
      flags[first] = true;
      flags[first + 1] = true;
      flags[second] = true;
      flags[second + 1] = true;
    }
  }
  return flags;
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = dx * dx + dy * dy;
  if (denominator === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator));
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}

/** 既存道のいずれかと thresholdPx 未満で並走する点を返す。 */
export function parallelFlags(points: readonly Vec2[], committedPaths: readonly (readonly Vec2[])[], thresholdPx: number): boolean[] {
  return points.map((point) =>
    committedPaths.some((path) => {
      for (let index = 1; index < path.length; index++) {
        if (distanceToSegment(point, path[index - 1], path[index]) < thresholdPx) return true;
      }
      return false;
    }),
  );
}
