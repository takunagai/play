// ============================================================
// main.ts ─ 状態機械・ポインタ入力・切断判定・描画ループ（p5 インスタンスモード）
// 正本は docs/architecture.md。状態機械:
//   intro → building → ready → cutting → hitstop → collapse → settling → afterglow → regrowing → ready
// 開発用クエリ: ?mute（無音）/ ?debug（診断オーバーレイ）
// ============================================================

import P5 from "p5";
import "./style.css";

import { createAudioEngine, type AudioEngine, type CutSchedule } from "./audio/engine";
import { createFrameCounter, installArtHook } from "./art-hook";
import { sandNoteMidi } from "./music";
import { QualityController } from "./quality";
import { capGrains, createSandField, deposit, displayHeight, pushGrains, stepGrains, type SandField } from "./sand";
import {
  buildTower,
  classifyCell,
  centroid,
  lineToLocal,
  localToPx,
  pxToLocal,
  splitCell,
  type Tower,
  type TowerFrame,
  type Vec2,
} from "./tower";
import {
  AMP_PULSE_AMPLITUDE,
  AFTERGLOW_MS,
  BPM,
  FACLIGHT_MS,
  FRAGMENT_GRAVITY_PX_S2,
  GLOW_CANVAS_DIVISOR,
  GLOW_EXTRA_DIVISOR_STEPS,
  GLOW_CRYSTAL_ALPHA,
  HITSTOP_MS,
  IDLE_BREATHE_MS,
  INTRO_FAST_BUILD_MS,
  MICRO_SHARD_CAP_STEPS,
  PALETTE_BACKGROUND,
  PALETTE_CRYSTAL_LIGHT,
  PALETTE_CRYSTAL_SHADOW,
  RAW_POINT_MIN_DISTANCE_PX,
  RAW_POINT_MIN_INTERVAL_MS,
  REGROW_MS,
  SAND_HALO_ALPHA,
  SAND_MAX_HEIGHT_RATIO,
  SAND_SETTLE_SPEED_PX_S,
  SAND_TOUCH_PUSH_PX,
  SAND_TOUCH_RATE_HZ,
  SETTLING_MAX_MS,
  SLIDE_MS,
  SWIPE_MIN_LENGTH_PX,
  SWIPE_MIN_SPEED_PX_S,
  SWIPE_SHARP_SPEED_PX_S,
  TOWER_BASE_Y_RATIO,
  TOWER_HEIGHT_MAX_RATIO,
  TOWER_HEIGHT_MIN_RATIO,
  TOWER_PORTRAIT_ASPECT,
  TOWER_WIDTH_MAX_PX,
  TOWER_WIDTH_MIN_PX,
  TOWER_WIDTH_PORTRAIT_RATIO,
  TOWER_WIDTH_RATIO,
  TRAIL_WINDOW_MS,
  VISIBLE_SAND_CAP_STEPS,
} from "./tuning";

/**
 * 実際に使うエンジンの契約。scheduleGlassStep と再生ドローンは AudioEngine 契約に含まれる
 * （正本 §4・§5。Noop も同じ署名で無音を実装する）。
 */
type AudioEngineContract = AudioEngine;

type State =
  | "intro"
  | "building"
  | "ready"
  | "cutting"
  | "hitstop"
  | "collapse"
  | "settling"
  | "afterglow"
  | "regrowing";

/** 生のスワイプ点 */
interface StrokePoint {
  x: number;
  y: number;
  atMs: number;
}

/** 塔から分離した欠片 */
interface Fragment {
  /** 描画用の多角形（px 空間・現在位置基準のローカル座標） */
  polygon: Vec2[];
  /** 現在位置（px。多角形の重心が原点） */
  x: number;
  y: number;
  /** 速度（px/s） */
  vx: number;
  vy: number;
  /** 回転（rad）と角速度（rad/s） */
  angle: number;
  angularVelocity: number;
  isLight: boolean;
  mass: number;
  /** 崩壊段（音の予約に使う） */
  row: number;
  /** 底へ着地して砂化したら true */
  landed: boolean;
  /** 微小片（品質段で上限を絞る。正本 §8） */
  isMicro: boolean;
}

/** 切断後の上半分の滑落の状態 */
interface UpperHalf {
  /** 上半分のセル（px 多角形） */
  cells: Array<{ polygon: Vec2[]; isLight: boolean; row: number; mass: number }>;
  /** 滑落方向の単位ベクトル（切断面の低い側へ向かう） */
  slideDir: Vec2;
  /** 滑落の進行 0..1 */
  slideProgress: number;
}

/** 塔を外した軌跡の淡光 */
interface FacLight {
  /** 結晶面の近傍点 */
  x: number;
  y: number;
  bornMs: number;
}

interface PointerStroke {
  points: StrokePoint[];
  lastRecordedAtMs: number;
}

// p5 v2 の FES は偽陽性で fps を落とすため必ず止める
P5.disableFriendlyErrors = true;

const audio = createAudioEngine();
const quality = new QualityController(MICRO_SHARD_CAP_STEPS.length);
const frameCounter = createFrameCounter();

const hostEl = document.querySelector<HTMLDivElement>("#p5-host");
const glowHostEl = document.querySelector<HTMLDivElement>("#glow-host");
const gateEl = document.querySelector<HTMLDivElement>("#gate");
const debugOverlayEl = document.querySelector<HTMLPreElement>("#debug-overlay");
const isDebugMode = new URLSearchParams(location.search).has("debug");
if (isDebugMode && debugOverlayEl) debugOverlayEl.hidden = true;
/** reduced-motion 環境。砂の明滅幅と再生の上昇速度を半減する（正本 §8） */
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let state: State = "intro";
let lastAmp = 0;
let lastError = "";

// 塔と砂
let tower: Tower | null = null;
let towerFrame: TowerFrame | null = null;
let towerBuildStartMs: number | null = null; // building の開始時刻
let towerBuildDurationMs = 900; // building の全体時間（intro 抜けが遅かったら短縮する）
let towerSeed = 1;
let sand: SandField | null = null;
let upperHalf: UpperHalf | null = null;
let fragments: Fragment[] = [];
let facLights: FacLight[] = [];

// 切断
let cutLine: { a: Vec2; b: number; frame: TowerFrame } | null = null; // ローカル空間の切断線（hitstop 減衰描画に使う）
let schedule: CutSchedule | null = null;
let cutRowCount = 0;
let cutSharpness = 0;
let collapseThrough = 0; // すでに砕けた段数（schedule.collapseStepAtMs のうち処理済みの数）
let settlingStartMs: number | null = null;
let afterglowStartMs: number | null = null;
let regrowStartMs: number | null = null;

// 入力
let stroke: PointerStroke | null = null;
let lastSandTouchAtMs = 0;

// 背景光（静的 offscreen。リサイズ時だけ焼き直す。正本 §7.1）
let backdropLayer: HTMLCanvasElement | null = null;

installArtHook({
  getAmp: () => lastAmp,
  getState: () => state,
  getFrameStats: () => frameCounter.stats(),
});

function renderDebugOverlay(): void {
  if (!debugOverlayEl) return;
  const stats = frameCounter.stats();
  const snapshot: Record<string, string | number | boolean> = {
    state,
    amp: Math.round(lastAmp * 1000) / 1000,
    frames: stats.frames,
    meanDrawMs: Math.round(stats.meanDrawMs * 100) / 100,
    qualityLevel: quality.getLevel(),
    fragments: fragments.length,
    sandGrains: sand?.grains.length ?? 0,
    bpm: BPM,
    lastError,
    ...audio.getDiagnostics(),
  };
  debugOverlayEl.textContent = Object.entries(snapshot)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

// ============================================================
// 塔の構築と寸法
// ============================================================

function towerDimensions(width: number, height: number): { widthPx: number; heightPx: number; leftPx: number; bottomPx: number } {
  const shortEdge = Math.min(width, height);
  const isPortrait = height > width * TOWER_PORTRAIT_ASPECT;
  const widthPx = isPortrait
    ? Math.min(shortEdge * TOWER_WIDTH_PORTRAIT_RATIO, TOWER_WIDTH_MAX_PX)
    : Math.max(TOWER_WIDTH_MIN_PX, Math.min(TOWER_WIDTH_MAX_PX, shortEdge * TOWER_WIDTH_RATIO));
  const heightPx = height * (TOWER_HEIGHT_MIN_RATIO + (TOWER_HEIGHT_MAX_RATIO - TOWER_HEIGHT_MIN_RATIO) * 0.5);
  const leftPx = width / 2 - widthPx / 2;
  const bottomPx = height * TOWER_BASE_Y_RATIO;
  return { widthPx, heightPx, leftPx, bottomPx };
}

function buildTowerFor(width: number, height: number, seed: number, instantBuild: boolean): void {
  const rowCount = 9 + (seed % 5); // 9〜13 段（正本 §7.2。seed から決定的に）
  tower = buildTower(rowCount, seed);
  const dims = towerDimensions(width, height);
  towerFrame = { leftPx: dims.leftPx, bottomPx: dims.bottomPx, widthPx: dims.widthPx, heightPx: dims.heightPx };
  towerBuildStartMs = performance.now();
  // intro の裏で積み上がる。遅く来たら最大 INTRO_FAST_BUILD_MS へ短縮（正本 §3.1）
  towerBuildDurationMs = instantBuild ? INTRO_FAST_BUILD_MS : 900 + rowCount * 40;
  upperHalf = null;
  cutLine = null;
  schedule = null;
  collapseThrough = 0;
}

/** 塔の構築進行 0..1（下から積み上がる見た目） */
function buildProgress(nowMs: number): number {
  if (!towerBuildStartMs) return 1;
  return Math.min(1, (nowMs - towerBuildStartMs) / towerBuildDurationMs);
}

// ============================================================
// 切断の判定と実行
// ============================================================

/** 軌跡と塔（画面上の外接矩形）の交差を評価する。交差前後の軌跡長も返す */
function evaluateSwipe(pointsPx: readonly StrokePoint[], frame: TowerFrame): { crosses: boolean; lengthPx: number; speedPxS: number; towerLocalPoints: Vec2[] } {
  let lengthPx = 0;
  for (let index = 1; index < pointsPx.length; index++) {
    lengthPx += Math.hypot(pointsPx[index].x - pointsPx[index - 1].x, pointsPx[index].y - pointsPx[index - 1].y);
  }
  const durationS = Math.max(1e-3, (pointsPx[pointsPx.length - 1].atMs - pointsPx[0].atMs) / 1000);
  const speedPxS = lengthPx / durationS;
  const towerLocalPoints = pointsPx.map((point) => pxToLocal({ x: point.x, y: point.y }, frame));
  // 塔のローカル外接矩形（x -0.5..0.5、y 0..1）との交差数
  let insideCount = 0;
  for (const point of towerLocalPoints) {
    if (point.x >= -0.5 && point.x <= 0.5 && point.y >= 0 && point.y <= 1) insideCount++;
  }
  const crosses = insideCount >= 2;
  return { crosses, lengthPx, speedPxS, towerLocalPoints };
}

/** 軌跡の塔近傍点へ最小二乗直線を当て、切断線（px 空間の単位法線と線上の点）を得る（正本 §3.2） */
function fitCutLine(pointsPx: readonly StrokePoint[], frame: TowerFrame): { normal: Vec2; point: Vec2; angleRad: number } | null {
  if (pointsPx.length < 2) return null;
  // 塔近傍の点だけを拾う（塔の外接矩形を 60px 膨らませた領域）
  const margin = 60;
  const nearby = pointsPx.filter((point) => {
    const local = pxToLocal({ x: point.x, y: point.y }, frame);
    return local.x >= -0.5 - margin / frame.widthPx && local.x <= 0.5 + margin / frame.widthPx && local.y >= -margin / frame.heightPx && local.y <= 1 + margin / frame.heightPx;
  });
  const usePoints = nearby.length >= 2 ? nearby : pointsPx;
  // 最小二乗直線（主成分方向）。平均 → 共分散 → 最大固有方向
  let mx = 0;
  let my = 0;
  for (const point of usePoints) {
    mx += point.x;
    my += point.y;
  }
  mx /= usePoints.length;
  my /= usePoints.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const point of usePoints) {
    const dx = point.x - mx;
    const dy = point.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  // 2x2 対称行列の最大固有ベクトル
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dirX = Math.cos(theta);
  const dirY = Math.sin(theta);
  // 切断線の方向ベクトル → 法線
  const normal = { x: -dirY, y: dirX };
  // 線上の点: 塔の中心高さで、直線と塔中心の交点へ寄せる（平均点を使う）
  const point = { x: mx, y: my };
  const angleRad = Math.atan2(dirY, dirX);
  return { normal, point, angleRad };
}

/** 切断を確定させる。ポリゴン分割 → beginCut → cutting へ */
function commitCut(pointsPx: readonly StrokePoint[]): void {
  if (!tower || !towerFrame || !sand) return;
  const frame = towerFrame;
  const fitted = fitCutLine(pointsPx, frame);
  if (!fitted) return;

  const evaluation = evaluateSwipe(pointsPx, frame);
  // 有効条件（正本 §3.2）: 軌跡長 56px 以上、交差、平均速度 90px/s 以上。
  // 閾値は誤操作除去用（verify の CDP タッチ実測が約 115px/s のため 180 では正規操作を拒む）
  const hasMargin = evaluation.towerLocalPoints.length >= 2;
  if (!evaluation.crosses || evaluation.lengthPx < SWIPE_MIN_LENGTH_PX || evaluation.speedPxS < SWIPE_MIN_SPEED_PX_S || !hasMargin) {
    // 塔を外す / 短すぎる swipe は淡光だけ返す（正本 §3.2 の 6）
    const nearest = nearestCrystalPoint(pointsPx[pointsPx.length - 1]);
    if (nearest) facLights.push({ x: nearest.x, y: nearest.y, bornMs: performance.now() });
    if (facLights.length > 8) facLights.shift();
    return;
  }

  const sharpness = Math.min(1, Math.max(0, (evaluation.speedPxS - SWIPE_MIN_SPEED_PX_S) / (SWIPE_SHARP_SPEED_PX_S - SWIPE_MIN_SPEED_PX_S)));
  const { a, b } = lineToLocal(fitted.normal, fitted.point, frame);

  // 切断線と交差するセルを上下へ分割する（正本 §3.3）
  const upperCells: UpperHalf["cells"] = [];
  const lowerPolys: Array<{ polygon: Vec2[]; isLight: boolean; row: number; mass: number }> = [];
  for (const cell of tower.cells) {
    const side = classifyCell(cell, a, b);
    if (side === "lower") {
      lowerPolys.push({ polygon: cell.polygon, isLight: cell.isLight, row: cell.row, mass: cell.mass });
      continue;
    }
    if (side === "upper") {
      upperCells.push({ polygon: cell.polygon, isLight: cell.isLight, row: cell.row, mass: cell.mass });
      continue;
    }
    const split = splitCell(cell, a, b);
    if (!split) {
      // 数値誤差で退化したら重心の符号で分類し、周回全体を中断しない（正本 §9）
      const center = centroid(cell.polygon);
      const sideOfCenter = a.x * center.x + a.y * center.y - b;
      if (sideOfCenter >= 0) upperCells.push({ polygon: cell.polygon, isLight: cell.isLight, row: cell.row, mass: cell.mass });
      else lowerPolys.push({ polygon: cell.polygon, isLight: cell.isLight, row: cell.row, mass: cell.mass });
      continue;
    }
    upperCells.push({ polygon: split.upper, isLight: cell.isLight, row: cell.row, mass: cell.mass * 0.5 });
    lowerPolys.push({ polygon: split.lower, isLight: cell.isLight, row: cell.row, mass: cell.mass * 0.5 });
  }

  if (upperCells.length === 0) {
    // 切れたと見えない浅い切断は淡光で返す
    const nearest = nearestCrystalPoint(pointsPx[pointsPx.length - 1]);
    if (nearest) facLights.push({ x: nearest.x, y: nearest.y, bornMs: performance.now() });
    return;
  }

  // 滑落方向: 切断面の接線方向の「低い側」。接線 = 法線を 90 度回転。
  // px 空間では y が下向き正なので、接線のうち y 成分が大きい向き（= 画面の下側）を採用する。
  // 完全水平切断では塔の外向き（x 方向）へ僅かに倒す代わりに真下を採る
  const tangent = { x: -fitted.normal.y, y: fitted.normal.x };
  const slideDir = tangent.y > 0 || (tangent.y === 0 && tangent.x > 0) ? tangent : { x: -tangent.x, y: -tangent.y };
  if (Math.abs(slideDir.y) < 0.2) {
    // ほぼ水平切断: 滑落は真下へ
    slideDir.x = 0;
    slideDir.y = 1;
  }

  // 上半分を px 多角形へ変換して保持（滑落アニメはこの塊を slideDir へずらす）
  const upperPx = upperCells.map((cell) => ({
    polygon: cell.polygon.map((point) => localToPx(point, frame)),
    isLight: cell.isLight,
    row: cell.row,
    mass: cell.mass,
  }));
  const rowCount = Math.max(1, tower.rowCount - Math.min(...upperCells.map((cell) => cell.row)));
  cutRowCount = rowCount;
  cutSharpness = sharpness;
  upperHalf = { cells: upperPx, slideDir, slideProgress: 0 };

  // 切断線をローカルで保持（hitstop 中の白線の減衰描画に使う）
  cutLine = { a, b, frame };

  // 音側に予約させ、16 分拍の時刻表を受け取る
  const cutY = Math.min(1, Math.max(0, pxToLocal(fitted.point, frame).y));
  schedule = audio.beginCut({ angleRad: fitted.angleRad, cutY, sharpness, rowCount });
  collapseThrough = 0;
  settlingStartMs = null;
  state = "cutting";
}

/** 指の直近点から最も近い結晶面上の点（淡光の位置。ざっくり塔の矩形辺上へ置く） */
function nearestCrystalPoint(pointPx: Vec2): Vec2 | null {
  if (!towerFrame) return null;
  const local = pxToLocal(pointPx, towerFrame);
  // 塔のローカル矩形へ clamp した点を px へ戻す
  const clamped: Vec2 = {
    x: Math.min(0.5, Math.max(-0.5, local.x)),
    y: Math.min(1, Math.max(0, local.y)),
  };
  return localToPx(clamped, towerFrame);
}

// ============================================================
// 崩壊と砂化
// ============================================================

/** collapse の 1 段ぶん: 上半分の上段からセルを欠片へ砕く（正本 §3.3） */
function shatterTopRow(): void {
  if (!upperHalf || !sand || !towerFrame) return;
  const cells = upperHalf.cells;
  if (cells.length === 0) return;
  // 現在の滑落オフセットを考慮したセルの位置で、最も row の小さい（上の）段を選ぶ
  let minRow = Number.POSITIVE_INFINITY;
  for (const cell of cells) if (cell.row < minRow) minRow = cell.row;
  const remaining: typeof cells = [];
  const microCap = MICRO_SHARD_CAP_STEPS[quality.getLevel()];
  let microCount = fragments.filter((fragment) => fragment.isMicro).length;
  for (const cell of cells) {
    if (cell.row === minRow) {
      // px 多角形の重心へ原点を寄せて欠片化する
      const center = centroid(cell.polygon);
      const big: Fragment = {
        polygon: cell.polygon.map((point) => ({ x: point.x - center.x, y: point.y - center.y })),
        x: center.x,
        y: center.y,
        vx: upperHalf.slideDir.x * (30 + 120 * cutSharpness),
        vy: upperHalf.slideDir.y * (30 + 120 * cutSharpness) + 60,
        angle: 0,
        angularVelocity: (Math.random() - 0.5) * (0.6 + cutSharpness),
        isLight: cell.isLight,
        mass: cell.mass,
        row: cell.row,
        landed: false,
        isMicro: false,
      };
      fragments.push(big);
      // 微小片 2〜4 個（品質段で上限。正本 §8）
      const shardCount = 2 + Math.floor(Math.random() * 3);
      for (let index = 0; index < shardCount; index++) {
        if (microCount >= microCap) break;
        microCount++;
        const angle = Math.random() * Math.PI * 2;
        const speed = 40 + Math.random() * 130;
        fragments.push({
          polygon: [{ x: -1.6, y: -1.6 }, { x: 1.6, y: -1.6 }, { x: 0, y: 1.6 }],
          x: center.x + (Math.random() - 0.5) * 24,
          y: center.y + (Math.random() - 0.5) * 24,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed * 0.6 + 40, // 外向き速度を底向きへ偏向（正本 §7.2）
          angle,
          angularVelocity: (Math.random() - 0.5) * 2,
          isLight: cell.isLight,
          mass: cell.mass * 0.05,
          row: cell.row,
          landed: false,
          isMicro: true,
        });
      }
      // 段の砕け音は main から直接予約せず、schedule の時刻で後続の step 処理が鳴らす
    } else {
      remaining.push(cell);
    }
  }
  upperHalf.cells = remaining;
  if (fragments.length > 400) fragments.splice(0, fragments.length - 400);
}

/** 欠片の物理と着地（正本 §3.3・§3.4） */
function stepFragments(p: P5, deltaSeconds: number): void {
  if (!sand) return;
  const width = p.width;
  for (const fragment of fragments) {
    if (fragment.landed) continue;
    fragment.vy += FRAGMENT_GRAVITY_PX_S2 * deltaSeconds;
    fragment.x += fragment.vx * deltaSeconds;
    fragment.y += fragment.vy * deltaSeconds;
    fragment.angle += fragment.angularVelocity * deltaSeconds;
    // 画面の四辺で消さず、底へ引き寄せて砂へ変換する（正本 §3.3）
    const margin = 8;
    if (fragment.x < margin) {
      fragment.x = margin;
      fragment.vx = Math.abs(fragment.vx) * 0.3;
    } else if (fragment.x > width - margin) {
      fragment.x = width - margin;
      fragment.vx = -Math.abs(fragment.vx) * 0.3;
    }
    if (fragment.y < margin) {
      fragment.y = margin;
      fragment.vy = Math.abs(fragment.vy) * 0.3;
    }
    // 砂面へ達したら砂粒へ変換する
    const column = Math.floor(fragment.x / sand.columnWidth);
    const height = column >= 0 && column < sand.heights.length ? displayHeight(sand, column, p.height * SAND_MAX_HEIGHT_RATIO) : 0;
    const surfaceY = sand.baseY - height;
    if (fragment.y >= surfaceY - 2) {
      fragment.y = surfaceY;
      fragment.landed = true;
      deposit(sand, fragment.x, fragment.y, fragment.mass, fragment.isLight);
      audio.sandSettle(Math.min(1, fragment.mass * 12));
    }
  }
  fragments = fragments.filter((fragment) => !fragment.landed);
}

new P5((p: P5) => {
  let glowCanvas: HTMLCanvasElement | null = null;

  const ensureLayers = (): void => {
    // グローは縮小キャンバスを別 DOM レイヤーへ置き、CSS 拡大で柔らかくする（pitfalls の白飽和対策）
    if (!glowCanvas && glowHostEl) {
      glowCanvas = document.createElement("canvas");
      glowHostEl.appendChild(glowCanvas);
    }
    if (glowCanvas) {
      const extraDivisor = GLOW_EXTRA_DIVISOR_STEPS[quality.getLevel()] ?? 1;
      const divisor = GLOW_CANVAS_DIVISOR * extraDivisor;
      const width = Math.max(1, Math.floor(p.width / divisor));
      const height = Math.max(1, Math.floor(p.height / divisor));
      if (glowCanvas.width !== width || glowCanvas.height !== height) {
        glowCanvas.width = width;
        glowCanvas.height = height;
      }
    }
  };

  /** 中央へ向かうごく弱い楕円状の青紫光を静的層へ 1 回焼く（正本 §7.1 の 2）。リサイズ時だけ呼ぶ */
  const repaintBackdrop = (): void => {
    if (!backdropLayer) backdropLayer = document.createElement("canvas");
    if (backdropLayer.width !== p.width || backdropLayer.height !== p.height) {
      backdropLayer.width = p.width;
      backdropLayer.height = p.height;
    }
    const ctx = backdropLayer.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, p.width, p.height);
    const gradient = ctx.createRadialGradient(
      p.width / 2,
      p.height * 0.62,
      Math.min(p.width, p.height) * 0.08,
      p.width / 2,
      p.height * 0.62,
      Math.max(p.width, p.height) * 0.62,
    );
    gradient.addColorStop(0, "rgba(70, 80, 160, 0.16)");
    gradient.addColorStop(0.6, "rgba(40, 46, 110, 0.07)");
    gradient.addColorStop(1, "rgba(10, 15, 44, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, p.width, p.height);
  };

  const rebuildWorld = (instantBuild: boolean): void => {
    buildTowerFor(p.width, p.height, towerSeed, instantBuild);
    sand = createSandField(p.width, p.height * TOWER_BASE_Y_RATIO);
    fragments = [];
    upperHalf = null;
    facLights = [];
    repaintBackdrop();
  };

  p.setup = () => {
    const canvas = p.createCanvas(window.innerWidth, window.innerHeight);
    if (hostEl) canvas.parent(hostEl);
    // p5 v2 の既知の制約: pixelDensity は createCanvas の後に呼ぶ
    p.pixelDensity(1);
    ensureLayers();

    sand = createSandField(p.width, p.height * TOWER_BASE_Y_RATIO);
    // ページ表示直後から、ゲートの背後で塔を下から積み上げる（正本 §3.1）
    buildTowerFor(p.width, p.height, towerSeed, false);
    repaintBackdrop();

    const resize = (): void => {
      p.resizeCanvas(window.innerWidth, window.innerHeight);
      ensureLayers();
      // リサイズ時は正規化座標から塔と砂面を再構築する（正本 §8）
      rebuildWorld(true);
    };
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("contextmenu", (event) => event.preventDefault());

    // ---- ポインタ入力（主ポインタ 1 本だけ。タッチ・マウス統一）----
    window.addEventListener(
      "pointerdown",
      (event: PointerEvent) => {
        if (!event.isPrimary) return;
        if (state === "intro") {
          // 最初の中央タップは切断に使わない。ゲートを消して音を配線する（正本 §3.1）
          gateEl?.classList.add("is-hidden");
          audio.start().catch((error: unknown) => {
            lastError = error instanceof Error ? error.message : String(error);
          });
          // 積み上がりが残っていれば短縮する
          const progress = buildProgress(performance.now());
          if (progress < 1) {
            const remainingMs = (1 - progress) * towerBuildDurationMs;
            towerBuildDurationMs = Math.min(towerBuildDurationMs, Math.max(INTRO_FAST_BUILD_MS, (performance.now() - (towerBuildStartMs ?? performance.now())) + Math.min(remainingMs, INTRO_FAST_BUILD_MS)));
          }
          state = "building";
          return;
        }
        if (state === "ready") {
          stroke = { points: [{ x: event.clientX, y: event.clientY, atMs: performance.now() }], lastRecordedAtMs: performance.now() };
          return;
        }
        if (state === "afterglow" && sand) {
          // 光の砂への接触（正本 §3.4）。近傍粒子を押しのけて音を鳴らす
          const nowMs = performance.now();
          pushGrains(sand, event.clientX, event.clientY, SAND_TOUCH_PUSH_PX);
          if (nowMs - lastSandTouchAtMs > 1000 / SAND_TOUCH_RATE_HZ) {
            lastSandTouchAtMs = nowMs;
            audio.note({
              x: event.clientX / p.width,
              y: event.clientY / p.height,
              midi: sandNoteMidi(event.clientX / p.width),
              velocity: 0.5,
            });
          }
        }
      },
      { passive: true },
    );

    window.addEventListener(
      "pointermove",
      (event: PointerEvent) => {
        if (!event.isPrimary || !stroke) return;
        const nowMs = performance.now();
        const last = stroke.points[stroke.points.length - 1];
        if (Math.hypot(event.clientX - last.x, event.clientY - last.y) < RAW_POINT_MIN_DISTANCE_PX) return;
        if (nowMs - stroke.lastRecordedAtMs < RAW_POINT_MIN_INTERVAL_MS) return;
        stroke.lastRecordedAtMs = nowMs;
        stroke.points.push({ x: event.clientX, y: event.clientY, atMs: nowMs });
        // 軌跡点には上限を置く（正本 §8）
        if (stroke.points.length > 90) stroke.points.shift();
      },
      { passive: true },
    );

    const releasePointer = (event: PointerEvent): void => {
      if (!event.isPrimary) return;
      if (stroke && state === "ready") {
        const pointsPx = stroke.points;
        stroke = null;
        if (pointsPx.length >= 2) commitCut(pointsPx);
      } else {
        stroke = null;
      }
    };
    window.addEventListener("pointerup", releasePointer, { passive: true });
    window.addEventListener("pointercancel", (event) => {
      if (!event.isPrimary) return;
      stroke = null;
    }, { passive: true });

    // 音声の再開は常駐リスナーで（雛形の契約。エンジン側でも設置済みだが、意図を明示して残す）
    window.addEventListener("dragstart", (event) => event.preventDefault());
  };

  p.draw = () => {
    const drawStartMs = performance.now();
    const nowMs = drawStartMs;
    quality.recordFrame(Math.min(p.deltaTime || 16.7, 100));
    lastAmp = audio.getAmp(); // analyser の読み出しは 1 フレーム 1 回
    const deltaSeconds = Math.min(0.05, (p.deltaTime || 16.7) / 1000);
    ensureLayers();
    const ctx = p.drawingContext;

    // ---- 状態の進行 ----
    if (state === "building" && towerBuildStartMs !== null) {
      if (buildProgress(nowMs) >= 1) state = "ready";
    }
    if (state === "cutting") {
      // cutting は 1 フレームだけ。直ちに hitstop へ（正本 §3.3）
      state = "hitstop";
    }
    if (state === "hitstop" && schedule) {
      if (nowMs >= schedule.hitStopEndMs) state = "collapse";
    }
    if (state === "collapse" && schedule && upperHalf) {
      // 滑落: 上半分を切断面の低い側へ 180ms 滑らせてから重力を加える（正本 §3.3）
      upperHalf.slideProgress = Math.min(1, (nowMs - schedule.cutAtMs - HITSTOP_MS) / SLIDE_MS);
      // 16 分拍で上の段から砕く。崩壊音は 16 分の拍に乗せて今鳴らす（schedule の時刻で揃う）
      while (collapseThrough < schedule.collapseStepAtMs.length && nowMs >= schedule.collapseStepAtMs[collapseThrough]) {
        shatterTopRow();
        if (towerFrame) {
          const engine = audio as AudioEngineContract;
          engine.scheduleGlassStep(collapseThrough, cutRowCount, towerFrame.leftPx / p.width + 0.5, cutSharpness);
        }
        collapseThrough++;
      }
      if (upperHalf.cells.length === 0 || nowMs >= schedule.settleAtMs) {
        settlingStartMs = nowMs;
        state = "settling";
      }
    }
    if (state === "settling") {
      // 全欠片が砂化するか、最長 700ms で終了。時間切れの片も現在位置から底へ吸着させ、画面外へ捨てない（正本 §3.4）
      if (settlingStartMs !== null && nowMs - settlingStartMs >= SETTLING_MAX_MS) {
        forceLandFragments(p);
      }
      if (fragments.length === 0) {
        afterglowStartMs = nowMs;
        state = "afterglow";
      }
    }
    if (state === "afterglow" && afterglowStartMs !== null && nowMs - afterglowStartMs >= AFTERGLOW_MS) {
      // 再生: 砂の一部を下から上へ吸い上げるように塔を再構築（正本 §3.4）
      regrowStartMs = nowMs;
      towerSeed = (towerSeed * 1103515245 + 12345) % 2147483647;
      buildTowerFor(p.width, p.height, towerSeed, false);
      towerBuildStartMs = regrowStartMs;
      towerBuildDurationMs = prefersReducedMotion ? REGROW_MS * 2 : REGROW_MS;
      if ("startRegrowDrone" in audio) (audio as { startRegrowDrone(): void }).startRegrowDrone();
      state = "regrowing";
    }
    if (state === "regrowing" && regrowStartMs !== null) {
      const progress = Math.min(1, (nowMs - regrowStartMs) / towerBuildDurationMs);
      if ("updateRegrowDrone" in audio) (audio as { updateRegrowDrone(progress: number): void }).updateRegrowDrone(progress);
      if (progress >= 1) {
        if ("stopRegrowDrone" in audio) (audio as { stopRegrowDrone(): void }).stopRegrowDrone();
        state = "ready";
      }
    }
    if (state === "building" || state === "regrowing") {
      // 砂は沈め続ける（再生の見た目）
    }
    if (sand) {
      stepGrains(sand, deltaSeconds, SAND_SETTLE_SPEED_PX_S);
      const sandCap = VISIBLE_SAND_CAP_STEPS[quality.getLevel()];
      capGrains(sand, sandCap);
    }
    if (state === "collapse" || state === "settling") stepFragments(p, deltaSeconds);
    facLights = facLights.filter((light) => nowMs - light.bornMs < FACLIGHT_MS);

    // ---- 描画 ----
    // 1. 不透明な背景
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE_BACKGROUND;
    ctx.fillRect(0, 0, p.width, p.height);
    // 2. 静的背景光（offscreen へ焼いた 1 枚を転画）
    if (backdropLayer) ctx.drawImage(backdropLayer, 0, 0);
    ctx.restore();

    const glowCtx = glowCanvas?.getContext("2d") ?? null;
    if (glowCtx && glowCanvas) glowCtx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
    const glowDivisor = GLOW_CANVAS_DIVISOR * (GLOW_EXTRA_DIVISOR_STEPS[quality.getLevel()] ?? 1);
    const ampPulse = 1 + AMP_PULSE_AMPLITUDE * lastAmp;

    // 3. 底の光の砂（芯は通常合成、halo は glow レイヤー。正本 §7.1 の 3・§7.3）
    drawSand(ctx, glowCtx, glowDivisor, nowMs, ampPulse);

    // 4. 塔の下半分と上半分（正本 §7.1 の 4）
    drawTowerAndRemains(ctx, glowCtx, glowDivisor, nowMs, ampPulse);

    // 5. 落下中の欠片（品質段に応じた微小片を含む）
    drawFragments(ctx);

    // 6. 塔幅内の白い切断線。cutting / hitstop の間だけ（正本 §7.1 の 6）
    drawCutLine(ctx, nowMs);

    // 7. 指の軌跡（直近 80ms だけ。切断前は白くしない。正本 §4 swipe/track）
    drawPointerTrail(ctx, nowMs);

    frameCounter.record(performance.now() - drawStartMs);
    if (isDebugMode && p.frameCount % 6 === 0) {
      if (debugOverlayEl) debugOverlayEl.hidden = false;
      renderDebugOverlay();
    }
  };

  /** 砂の描画。高さマップの面 + 可視粒子。halo は glow レイヤーへ（正本 §7.3） */
  function drawSand(ctx: CanvasRenderingContext2D, glowCtx: CanvasRenderingContext2D | null, divisor: number, nowMs: number, ampPulse: number): void {
    if (!sand) return;
    const maxHeight = p.height * SAND_MAX_HEIGHT_RATIO;
    // 高さマップの面（列ごと。明暗を lightRatios で混ぜる）
    const columnWidth = sand.columnWidth;
    const breathe = prefersReducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin((nowMs / 4200) * Math.PI * 2);
    for (let column = 0; column < sand.heights.length; column++) {
      const height = displayHeight(sand, column, maxHeight);
      if (height <= 0.2) continue;
      const light = sand.lightRatios[column];
      const color = light > 0.5 ? PALETTE_CRYSTAL_LIGHT : PALETTE_CRYSTAL_SHADOW;
      // 明滅は位置と半径を変えず alpha だけ（正本 §7.3）
      const alpha = (0.55 + 0.3 * breathe * (prefersReducedMotion ? 0.5 : 1)) * ampPulse;
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.fillStyle = color;
      const x = column * columnWidth;
      ctx.fillRect(x, sand.baseY - height, columnWidth + 0.5, height);
      if (glowCtx && column % 4 === 0) {
        glowCtx.globalAlpha = SAND_HALO_ALPHA * Math.min(1, height / 12);
        glowCtx.fillStyle = color;
        glowCtx.fillRect(x / divisor, (sand.baseY - height) / divisor, Math.max(1, columnWidth / divisor), Math.max(1, height / divisor));
      }
    }
    ctx.globalAlpha = 1;
    // 可視粒子（芯 1〜2px）
    for (const grain of sand.grains) {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = grain.isLight ? PALETTE_CRYSTAL_LIGHT : PALETTE_CRYSTAL_SHADOW;
      ctx.beginPath();
      ctx.arc(grain.x, grain.y, grain.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (glowCtx) glowCtx.globalAlpha = 1;
  }

  /** 塔と残骸（下半分・滑落中の上半分）の描画 */
  function drawTowerAndRemains(ctx: CanvasRenderingContext2D, glowCtx: CanvasRenderingContext2D | null, divisor: number, nowMs: number, ampPulse: number): void {
    if (!tower || !towerFrame) return;
    const frame = towerFrame;
    const progress = buildProgress(nowMs);
    const breathePhase = (nowMs % IDLE_BREATHE_MS) / IDLE_BREATHE_MS;
    const breathe = 0.85 + 0.15 * Math.sin(breathePhase * Math.PI * 2);
    const building = progress < 1;

    // 下半分（塔として残っているセル）
    for (const cell of tower.cells) {
      const cellTopY = Math.max(...cell.polygon.map((point) => point.y));
      // 積み上がり: 下から順に現れる（セルの上端が進行線を超えたら表示）
      if (building && cellTopY > progress * 1.02) continue;
      const isUpperSlide = false;
      drawCell(ctx, glowCtx, divisor, cell.polygon, cell.isLight, frame, 0, 0, 0, breathe * ampPulse, isUpperSlide);
    }

    // 上半分（切断後の滑落。collapse 中だけ存在する）
    if (upperHalf) {
      const slide = upperHalf.slideProgress;
      const eased = slide * slide * (3 - 2 * slide); // smoothstep
      const offsetX = upperHalf.slideDir.x * eased * 36;
      const offsetY = upperHalf.slideDir.y * eased * 36;
      for (const cell of upperHalf.cells) {
        drawCellPx(ctx, cell.polygon, cell.isLight, offsetX, offsetY, 0, 0.9 * breathe * ampPulse);
      }
    }
  }

  /** ローカル正規化座標のセルを px へ戻して描く */
  function drawCell(
    ctx: CanvasRenderingContext2D,
    glowCtx: CanvasRenderingContext2D | null,
    divisor: number,
    polygon: readonly Vec2[],
    isLight: boolean,
    frame: TowerFrame,
    offsetX: number,
    offsetY: number,
    angle: number,
    alpha: number,
    isUpperSlide: boolean,
  ): void {
    const color = isLight ? PALETTE_CRYSTAL_LIGHT : PALETTE_CRYSTAL_SHADOW;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = color;
    ctx.beginPath();
    polygon.forEach((point, index) => {
      const px = localToPx(point, frame);
      const x = px.x + offsetX;
      const y = px.y + offsetY;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
    // 1px の淡い稜線で形を読ませる（正本 §7.2）。輪郭を太くしない
    ctx.strokeStyle = PALETTE_BACKGROUND;
    ctx.globalAlpha = Math.min(1, alpha) * 0.35;
    ctx.lineWidth = 1;
    ctx.stroke();
    // 内部稜線 1 本（対角の面の反射）
    if (polygon.length >= 4) {
      const a = localToPx(polygon[0], frame);
      const c = localToPx(polygon[Math.floor(polygon.length / 2)], frame);
      ctx.globalAlpha = Math.min(1, alpha) * 0.25;
      ctx.beginPath();
      ctx.moveTo(a.x + offsetX, a.y + offsetY);
      ctx.lineTo(c.x + offsetX, c.y + offsetY);
      ctx.stroke();
    }
    ctx.restore();
    // glow（結晶の芯の弱い光。burned-in 再帰はしない。正本 §7.1）
    if (glowCtx && isUpperSlide === false) {
      const center = centroid(polygon);
      const px = localToPx(center, frame);
      glowCtx.globalAlpha = GLOW_CRYSTAL_ALPHA * alpha;
      glowCtx.fillStyle = color;
      glowCtx.beginPath();
      glowCtx.arc(px.x / divisor, px.y / divisor, Math.max(2, 14 / divisor), 0, Math.PI * 2);
      glowCtx.fill();
    }
    if (glowCtx) glowCtx.globalAlpha = 1;
    void angle;
  }

  /** px 多角形をそのまま描く（滑落中の上半分・欠片） */
  function drawCellPx(ctx: CanvasRenderingContext2D, polygon: readonly Vec2[], isLight: boolean, offsetX: number, offsetY: number, angle: number, alpha: number): void {
    const color = isLight ? PALETTE_CRYSTAL_LIGHT : PALETTE_CRYSTAL_SHADOW;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = color;
    ctx.translate(offsetX, offsetY);
    if (angle !== 0) ctx.rotate(angle);
    ctx.beginPath();
    polygon.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = Math.min(1, alpha) * 0.3;
    ctx.strokeStyle = PALETTE_BACKGROUND;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  /** 欠片の描画（大きな片 + 品質段で上限を絞った微小片） */
  function drawFragments(ctx: CanvasRenderingContext2D): void {
    for (const fragment of fragments) {
      drawCellPx(ctx, fragment.polygon, fragment.isLight, fragment.x, fragment.y, fragment.angle, 0.95);
    }
  }

  /** 切断線の白い減衰描画。塔幅の内側だけ。hitstop 明けから 160ms で透明へ（正本 §3.3・§7.1 の 6） */
  function drawCutLine(ctx: CanvasRenderingContext2D, nowMs: number): void {
    if (!cutLine || !schedule) return;
    const sinceCut = nowMs - schedule.cutAtMs;
    if (sinceCut < 0 || sinceCut > HITSTOP_MS + 160) return;
    const { a, b, frame } = cutLine;
    // ローカル空間の直線 a·p = b と塔の矩形の交点を求め、塔幅の内側だけを描く
    const corners: Vec2[] = [
      { x: -0.5, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0.5, y: 1 },
      { x: -0.5, y: 1 },
    ];
    const intersections: Vec2[] = [];
    for (let index = 0; index < corners.length; index++) {
      const from = corners[index];
      const to = corners[(index + 1) % corners.length];
      const sideFrom = a.x * from.x + a.y * from.y - b;
      const sideTo = a.x * to.x + a.y * to.y - b;
      if ((sideFrom > 0) === (sideTo > 0)) continue;
      const t = sideFrom / (sideFrom - sideTo);
      intersections.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    }
    if (intersections.length < 2) return;
    const p0 = localToPx(intersections[0], frame);
    const p1 = localToPx(intersections[1], frame);
    const fade = sinceCut <= HITSTOP_MS ? 1 : Math.max(0, 1 - (sinceCut - HITSTOP_MS) / 160);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 1.5 + (1 - cutSharpness) * 1.5; // 速いほど細く鋭く（正本 §3.2 の 5）
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.restore();
  }

  /** 指の軌跡。直近 80ms だけ #BFEFFF の細い線。ready のスワイプ中のみ（正本 §4） */
  function drawPointerTrail(ctx: CanvasRenderingContext2D, nowMs: number): void {
    if (!stroke) return;
    const recent = stroke.points.filter((point) => nowMs - point.atMs <= TRAIL_WINDOW_MS);
    if (recent.length < 2) return;
    ctx.save();
    ctx.strokeStyle = PALETTE_CRYSTAL_LIGHT;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    recent.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  /** settling の時間切れで残った欠片を現在位置から底へ吸着させる（正本 §3.4） */
  function forceLandFragments(p: P5): void {
    if (!sand) return;
    for (const fragment of fragments) {
      const column = Math.floor(fragment.x / sand.columnWidth);
      const height = column >= 0 && column < sand.heights.length ? displayHeight(sand, column, p.height * SAND_MAX_HEIGHT_RATIO) : 0;
      deposit(sand, fragment.x, sand.baseY - height, fragment.mass, fragment.isLight);
    }
    fragments = [];
  }
});
