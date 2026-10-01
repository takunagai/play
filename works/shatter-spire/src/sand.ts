// ============================================================
// sand.ts ─ 光の砂: 高さマップ + 可視粒子の集約（純粋関数 + 軽い状態）
// 正本は docs/architecture.md 第 3.4・7.3 節。個別粒子を無制限に残さない。
// ============================================================

import { SAND_HEIGHT_COLUMNS } from "./tuning";

/** 砂 1 粒（可視分だけ。古い粒は高さマップへ面積を足して解放する） */
export interface SandGrain {
  /** px 空間の位置 */
  x: number;
  y: number;
  /** 落下速度（px/s。正 = 下向き） */
  vy: number;
  /** 色面。true = PALETTE_CRYSTAL_LIGHT、false = PALETTE_CRYSTAL_SHADOW */
  isLight: boolean;
  /** 半径（px） */
  radius: number;
  /** 高さマップへまだ沈積していない（沈積したら粒子から解放する） */
  settled: boolean;
}

export interface SandField {
  /** 沈積の高さマップ（列ごとの高さ px）。0 = 砂なし */
  heights: number[];
  /** 列ごとの色の占有（明色の割合 0..1。描画の色混ぜに使う） */
  lightRatios: number[];
  /** 列ごとの総質量（複数周の蓄積。圧縮表示に使う） */
  masses: number[];
  /** 可視粒子 */
  grains: SandGrain[];
  /** 砂面の基準 y（px） */
  baseY: number;
  /** 列幅（px） */
  columnWidth: number;
}

export function createSandField(widthPx: number, baseYPx: number): SandField {
  const columns = SAND_HEIGHT_COLUMNS;
  return {
    heights: new Array<number>(columns).fill(0),
    lightRatios: new Array<number>(columns).fill(0),
    masses: new Array<number>(columns).fill(0),
    grains: [],
    baseY: baseYPx,
    columnWidth: widthPx / columns,
  };
}

/** 列 index を求める（範囲外は null。画面外の砂は作らない） */
export function columnAt(field: SandField, xPx: number): number | null {
  const column = Math.floor(xPx / field.columnWidth);
  if (column < 0 || column >= field.heights.length) return null;
  return column;
}

/** 欠片が砂面へ着地したとき、同色・同質量の砂粒へ変換する（正本 §3.4） */
export function deposit(
  field: SandField,
  xPx: number,
  yPx: number,
  mass: number,
  isLight: boolean,
): void {
  const column = columnAt(field, xPx);
  if (column === null) return;
  const radius = Math.max(0.8, Math.min(2.4, Math.sqrt(mass) * 26));
  field.grains.push({ x: xPx, y: yPx, vy: 0, isLight, radius, settled: false });
}

/** 可視粒子の上限。超過した古い粒から高さマップへ面積を足して解放する（正本 §7.3） */
export function capGrains(field: SandField, cap: number): void {
  while (field.grains.length > cap) {
    const grain = field.grains.shift();
    if (!grain) break;
    // 画面外へ捨てない（正本 §3.3）。その場で高さマップへ吸収する
    absorbGrain(field, grain.x, grain.radius, grain.isLight);
  }
}

/** 1 粒ぶんの面積を高さマップへ足す（色の占有も更新） */
export function absorbGrain(field: SandField, xPx: number, radius: number, isLight: boolean): void {
  const center = Math.floor(xPx / field.columnWidth);
  const span = Math.max(0, Math.ceil(radius / field.columnWidth));
  for (let offset = -span; offset <= span; offset++) {
    const column = center + offset;
    if (column < 0 || column >= field.heights.length) continue;
    // 重なり幅に応じて配分する（中心列が全额、端は半分ずつの簡易近似）
    const overlap = Math.max(0, 1 - Math.abs(offset) * 0.5);
    const area = radius * 2 * overlap * 0.5; // 高さへの加算（簡易: 直径の半分を高さとする）
    const previousMass = field.masses[column];
    const newMass = previousMass + area;
    field.lightRatios[column] =
      (field.lightRatios[column] * previousMass + (isLight ? area : 0)) / Math.max(newMass, 1e-6);
    field.heights[column] += area;
    field.masses[column] = newMass;
  }
}

/** 毎フレームの砂の更新。未沈積の粒を沈め、沈み切ったらマップへ足す（粒子は settled のまま可視に残す） */
export function stepGrains(field: SandField, deltaSeconds: number, settleSpeedPxS: number): void {
  for (const grain of field.grains) {
    if (grain.settled) continue;
    // 高さマップの表面（現在の沈積高さ）より下へは沈めない
    const column = columnAt(field, grain.x);
    const surfaceY = field.baseY - (column !== null ? field.heights[column] : 0);
    grain.y += settleSpeedPxS * deltaSeconds;
    if (grain.y >= surfaceY) {
      grain.y = surfaceY;
      grain.settled = true;
      absorbGrain(field, grain.x, grain.radius, grain.isLight);
      // マップへ足したので粒子は解放する（可視は cap で管理。ここでは描画用に settled のまま残す）
    }
  }
}

/**
 * 砂への接触。近傍の未沈積・沈積粒子を 6px 以下だけ押しのけ、押した分の高さはマップから引かない
 * （見た目だけの波打ち。正本 §3.4「砂を画面外へ押し出さない」）。
 */
export function pushGrains(field: SandField, xPx: number, yPx: number, maxPushPx: number): void {
  for (const grain of field.grains) {
    const dx = grain.x - xPx;
    const dy = grain.y - yPx;
    const distance = Math.hypot(dx, dy);
    if (distance > 24 || distance < 1e-3) continue;
    const strength = (1 - distance / 24) * maxPushPx;
    const nx = dx / distance;
    const ny = dy / distance;
    grain.x += nx * strength;
    grain.y += ny * strength * 0.4;
  }
}

/** 複数周の沈積を上限高さへ圧縮した表示高さを返す（正本 §7.3） */
export function displayHeight(field: SandField, column: number, maxHeightPx: number): number {
  const raw = field.heights[column];
  if (raw <= maxHeightPx) return raw;
  // 上限を超えたぶんは漸近曲線へ圧縮する（総量は残し、操作領域を埋めない）
  return maxHeightPx + (raw - maxHeightPx) * 0.12;
}
