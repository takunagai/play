// ============================================================
// tower.ts ─ 結晶塔の生成・切断分類・半平面クリッピング（純粋関数）
// 正本は docs/architecture.md 第 3.3・7.2 節。DOM・canvas に依存しない。
// 座標系: 塔は正規化座標（塔のローカル空間。x: -0.5..0.5、y: 0..1 = 下から上）で持ち、
// 描画時に TowerFrame 経由で px へ戻す。リサイズは frame の張り替えだけで済む。
// ============================================================

import { CELL_VERTICES_MAX, CELL_VERTICES_MIN, CRYSTALS_PER_ROW_MAX, CRYSTALS_PER_ROW_MIN } from "./tuning";

export interface Vec2 {
  x: number;
  y: number;
}

/** 結晶セル 1 個。正規化座標（塔のローカル空間。x: -0.5..0.5、y: 0..1 = 下から上） */
export interface CrystalCell {
  /** 凸多角形の頂点（ローカル正規化座標） */
  polygon: Vec2[];
  /** 段番号（0 = 最下段。崩壊音・砕け順に使う） */
  row: number;
  /** 段の中の index（描画の色面に使う） */
  column: number;
  /** 芯の色面。true = PALETTE_CRYSTAL_LIGHT、false = PALETTE_CRYSTAL_SHADOW */
  isLight: boolean;
  /** 面積（ローカル単位。砂化の質量に使う） */
  mass: number;
}

/** 塔全体の形。正規化座標で持ち、リサイズ時は px への再写像だけで済む */
export interface Tower {
  cells: CrystalCell[];
  /** 段数 */
  rowCount: number;
}

/** px 空間での塔の枠。ローカル正規化座標 ←→ px の変換の正本 */
export interface TowerFrame {
  /** 塔（ローカル x -0.5..0.5）の左端の px */
  leftPx: number;
  /** 塔（ローカル y 0）の底の px */
  bottomPx: number;
  /** 塔幅の px（ローカル x 1.0 に対応） */
  widthPx: number;
  /** 塔高さの px（ローカル y 1.0 に対応） */
  heightPx: number;
}

/** ローカル正規化座標の点を px へ戻す */
export function localToPx(point: Vec2, frame: TowerFrame): Vec2 {
  return {
    x: frame.leftPx + (point.x + 0.5) * frame.widthPx,
    y: frame.bottomPx - point.y * frame.heightPx,
  };
}

/** px の点を塔のローカル正規化座標へ写す */
export function pxToLocal(point: Vec2, frame: TowerFrame): Vec2 {
  return {
    x: (point.x - frame.leftPx) / frame.widthPx - 0.5,
    y: (frame.bottomPx - point.y) / frame.heightPx,
  };
}

/** 決定的な疑似乱数（mulberry32）。seed は 1 周中固定する（正本 §7.2） */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 多角形の面積（ローカル単位。靴ひも公式。凹凸を問わない） */
export function polygonArea(polygon: readonly Vec2[]): number {
  let sum = 0;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** 多角形の重心 */
export function centroid(polygon: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const point of polygon) {
    x += point.x;
    y += point.y;
  }
  return { x: x / polygon.length, y: y / polygon.length };
}

/** 直線 a·p = b の正側（a·p ≥ b）で凸多角形をクリップする（Sutherland–Hodgman の半平面版） */
export function clipHalfPlane(polygon: readonly Vec2[], a: Vec2, b: number): Vec2[] {
  const output: Vec2[] = [];
  const count = polygon.length;
  if (count === 0) return output;
  const side = (point: Vec2): number => a.x * point.x + a.y * point.y - b;
  for (let index = 0; index < count; index++) {
    const current = polygon[index];
    const next = polygon[(index + 1) % count];
    const currentSide = side(current);
    const nextSide = side(next);
    if (currentSide >= 0) output.push(current);
    if ((currentSide > 0 && nextSide < 0) || (currentSide < 0 && nextSide > 0)) {
      const t = currentSide / (currentSide - nextSide);
      output.push({ x: current.x + (next.x - current.x) * t, y: current.y + (next.y - current.y) * t });
    }
  }
  return output;
}

/** セルと切断線（ローカル空間の a·p = b）の位置関係。a は「上半分」の側を指す単位法線 */
export type CellSide = "upper" | "lower" | "crossing";

export function classifyCell(cell: CrystalCell, a: Vec2, b: number): CellSide {
  let positive = 0;
  let negative = 0;
  for (const point of cell.polygon) {
    const side = a.x * point.x + a.y * point.y - b;
    if (side > 1e-6) positive++;
    else if (side < -1e-6) negative++;
  }
  if (positive === 0) return "lower";
  if (negative === 0) return "upper";
  return "crossing";
}

/** セルの多角形を上下 2 片へ分ける。どちらかが退化する場合は null（呼び出し側は重心の符号で分類する。正本 §9） */
export function splitCell(
  cell: CrystalCell,
  a: Vec2,
  b: number,
): { upper: Vec2[]; lower: Vec2[] } | null {
  const upper = clipHalfPlane(cell.polygon, a, b);
  const lower = clipHalfPlane(cell.polygon, { x: -a.x, y: -a.y }, -b);
  if (upper.length < 3 || lower.length < 3) return null;
  return { upper, lower };
}

/** px 空間の切断線（単位法線 normalPx・線上の点 pointPx）を塔のローカル空間へ写す */
export function lineToLocal(normalPx: Vec2, pointPx: Vec2, frame: TowerFrame): { a: Vec2; b: number } {
  // pLocal = S·(pPx - origin)、S = diag(1/widthPx, -1/heightPx)、origin = (leftPx + width/2, bottomPx)
  // 直線 normalPx·pPx = bPx をローカルへ: (S·normalPx)·pLocal = bPx - normalPx·origin
  const originX = frame.leftPx + frame.widthPx * 0.5;
  const originY = frame.bottomPx;
  const scaledX = normalPx.x / frame.widthPx;
  const scaledY = -normalPx.y / frame.heightPx;
  const length = Math.hypot(scaledX, scaledY) || 1;
  const a = { x: scaledX / length, y: scaledY / length };
  const bPx = normalPx.x * pointPx.x + normalPx.y * pointPx.y;
  const b = (bPx - (normalPx.x * originX + normalPx.y * originY)) / length;
  return { a, b };
}

/**
 * 塔を生成する（正本 §7.2）。
 * - rowCount 段、各段 3〜5 個、全体 36〜54 個の凸セル
 * - 各セルは 5〜7 頂点の凸多角形（矩形の周上に頂点を置き、中心寄りへ変形して凸を保つ）
 * - seed を固定すれば同じ塔になる（切断前に形が揺れない）
 */
export function buildTower(rowCount: number, seed: number): Tower {
  const random = makeRandom(seed);
  const cells: CrystalCell[] = [];
  for (let row = 0; row < rowCount; row++) {
    const perRow = CRYSTALS_PER_ROW_MIN + Math.floor(random() * (CRYSTALS_PER_ROW_MAX - CRYSTALS_PER_ROW_MIN + 1));
    const y0 = row / rowCount;
    const y1 = (row + 1) / rowCount;
    // 段ごとに x を分割する。境界を少しジグザグさせて結晶らしく
    const cuts: number[] = [0];
    for (let index = 1; index < perRow; index++) {
      cuts.push((index + (random() - 0.5) * 0.6) / perRow);
    }
    cuts.push(1);
    for (let column = 0; column < perRow; column++) {
      const x0 = cuts[column] - 0.5;
      const x1 = cuts[column + 1] - 0.5;
      const polygon = buildCellPolygon(x0, x1, y0, y1, random);
      cells.push({
        polygon,
        row,
        column,
        isLight: (row + column) % 2 === 0,
        mass: polygonArea(polygon),
      });
    }
  }
  return { cells, rowCount };
}

/** 1 セルの凸多角形（x0 < x1、y0 < y1 の矩形を 5〜7 頂点へ変形） */
function buildCellPolygon(x0: number, x1: number, y0: number, y1: number, random: () => number): Vec2[] {
  const vertexCount = CELL_VERTICES_MIN + Math.floor(random() * (CELL_VERTICES_MAX - CELL_VERTICES_MIN + 1));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const halfWidth = (x1 - x0) / 2;
  const halfHeight = (y1 - y0) / 2;
  const polygon: Vec2[] = [];
  const angleOffset = random() * Math.PI * 2;
  for (let index = 0; index < vertexCount; index++) {
    const angle = angleOffset + (index / vertexCount) * Math.PI * 2;
    const radiusX = halfWidth * (0.82 + random() * 0.18);
    const radiusY = halfHeight * (0.82 + random() * 0.18);
    polygon.push({ x: cx + Math.cos(angle) * radiusX, y: cy + Math.sin(angle) * radiusY });
  }
  return polygon;
}
