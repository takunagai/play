// ============================================================
// main.ts ─ 入力・星の所有・状態機械・Canvas2D 描画
// 正本は docs/architecture.md（状態機械・星の所有・音視覚マッピング・
// AudioEngine 契約）。視覚の数値は docs/design.md 第5〜11章の転記で
// tuning.ts に集約。描画はすべて source-over（加算は禁止）。
// 開発用クエリ: ?mute（無音）/ ?debug（診断オーバーレイ）
//
// 状態機械（正本 §3）: intro →（最初の押下）→ collecting ⇄（指ごと）
//   waiting（解錠待ち）→ linking → holding → fading → returning → 解放
// window.__art.getState() の優先順位: intro > collecting > waiting >
// linking > holding > fading > returning > idle
// ============================================================

import P5 from "p5";
import "./style.css";

import { createAudioEngine, type SequencePlan, type StarStep } from "./audio/engine";
import { createFrameCounter, installArtHook } from "./art-hook";
import { noteForPosition } from "./music";
import { QualityController } from "./quality";
import {
  ATTRACT_CANDIDATE_RADIUS_MIN_PX,
  ATTRACT_CANDIDATE_RADIUS_RATIO,
  ATTRACT_SPAWN_FADE_MS,
  ATTRACT_SPAWN_RING_MAX_PX,
  ATTRACT_SPAWN_RING_MIN_PX,
  BG_STAR_ALPHA_MAX,
  BG_STAR_ALPHA_MIN,
  BG_STAR_COUNT_MAX,
  BG_STAR_COUNT_MIN,
  BG_STAR_DENSITY,
  BG_STAR_RADIUS_MAX_PX,
  BG_STAR_RADIUS_MIN_PX,
  BG_STAR_TOP_GRADE_RATIO,
  BG_STAR_TOP_HALO_ALPHA,
  BG_STAR_TOP_HALO_MAX_PX,
  BG_STAR_TOP_HALO_MIN_PX,
  BG_STAR_TWINKLE_AMPLITUDE,
  BG_STAR_TWINKLE_MAX_MS,
  BG_STAR_TWINKLE_MIN_MS,
  BRIGHTEN_CORE_SCALE,
  BRIGHTEN_DECAY_MS,
  BRIGHTEN_HALO_ALPHA_SCALE,
  BRIGHTEN_RISE_MS,
  CANCEL_RETURN_MS,
  CHARGE_MAX_MS,
  CORE_ACTIVE_ALPHA,
  CORE_IDLE_ALPHA_MAX,
  CORE_IDLE_ALPHA_MIN,
  EDGE_MARGIN_PX,
  FADE_CURVE_EXP,
  FADE_MS,
  FOLLOW_DT_MAX_MS,
  FOLLOW_TAU_MS,
  GOLDEN_RATIO,
  HALO_ACTIVE_ALPHA_MAX,
  HALO_ACTIVE_ALPHA_MIN,
  HALO_GRADIENT_STOPS,
  HALO_IDLE_ALPHA_MAX,
  HALO_IDLE_ALPHA_MIN,
  HALO_LAYER_STEPS,
  HALO_MAX_STACK_ALPHA,
  HEAD_DOT_ALPHA,
  HEAD_DOT_CORE_PX,
  HEAD_DOT_HALO_PX,
  HOME_FADE_MS,
  HOLD_MS,
  HOLD_PULSE_AMPLITUDE,
  HOLD_PULSE_MS,
  INTRO_BREATH_ALPHA,
  INTRO_BREATH_MS,
  INTRO_BREATH_SPREAD,
  INTRO_HALO_ALPHA,
  INTRO_SPREAD_MAX_PX,
  INTRO_SPREAD_RATIO,
  INTRO_STAR_COUNT,
  LINE_CORE_ALPHA,
  LINE_CORE_WIDTH_PX,
  LINE_HALO_ALPHA,
  LINE_HALO_WIDTH_PX,
  MAX_CONSTELLATIONS,
  MAX_POINTERS,
  MAX_STARS,
  MIN_STARS,
  ORBIT_RADIUS_WOBBLE,
  ORBIT_SWING_PERIOD_MS,
  ORBIT_SWING_RAD,
  PALETTE_BACKGROUND,
  PALETTE_CORE,
  PALETTE_STAR,
  RADIUS_MAX_RATIO,
  RADIUS_MIN_RATIO,
  RETURN_MS,
  SIZE_SATURATION_PX,
  STAR_ADD_MS,
  STAR_CORE_ACTIVE_MAX_PX,
  STAR_CORE_ACTIVE_MIN_PX,
  STAR_CORE_IDLE_MAX_PX,
  STAR_CORE_IDLE_MIN_PX,
  STAR_HALO_ACTIVE_MAX_PX,
  STAR_HALO_ACTIVE_MIN_PX,
  STAR_HALO_IDLE_MAX_PX,
  STAR_HALO_IDLE_MIN_PX,
  STAR_POOL_SIZE,
  WAITING_HALO_SCALE,
} from "./tuning";

// ============================================================
// 正本 §5 の音響契約のデータ型（StarStep / SequencePlan / SequenceClock）は
// audio/engine.ts へ移した。main は createAudioEngine() の戻り値
// （StarAudioEngine）越しにだけ音響へ触る。
// ============================================================

type WorkState =
  | "intro"
  | "idle"
  | "collecting"
  | "waiting"
  | "linking"
  | "holding"
  | "fading"
  | "returning";

type ConstellationPhase = "waiting" | "linking" | "holding" | "fading" | "returning" | "expired";

type StarOwner = "free" | "pointer" | "constellation";

interface Star {
  id: number;
  homeX: number;
  homeY: number;
  /** 現在の描画位置（収集中は指数平滑で動く。確定後は fixed / 補間） */
  x: number;
  y: number;
  coreIdlePx: number;
  haloIdlePx: number;
  /** 収集中・確定後の寸法（intro の中央 5 星は idle と同値で連続に見える） */
  coreActivePx: number;
  haloActivePx: number;
  haloIdleAlpha: number;
  coreIdleAlpha: number;
  haloActiveAlpha: number;
  twinklePeriodMs: number;
  twinklePhase: number;
  owner: StarOwner;
  /** owner が pointer なら pointerId、constellation なら星座 id */
  ownerId: number;
  captureIndex: number;
  capturedAtMs: number;
  /** 発音・到達増光の起点時刻。まだ決まっていなければ -1 */
  brightenAtMs: number;
  /** リング上へ新配置された時刻（立ち上がり用。なければ -1） */
  spawnAtMs: number;
  /** 解放後の確定位置（linking〜returning で固定） */
  fixedX: number;
  fixedY: number;
  /** cancel の戻り補間の起点。補間が無ければ -1 */
  returnFromX: number;
  returnFromY: number;
  returnStartMs: number;
  /** 帰還（returning）の所有返却後に暈を idle へ戻す 250ms 補間の起点。なければ -1 */
  homeFadeStartMs: number;
}

/** 装飾の背景星（design.md 第7章「背景星の寸法」。星 96 個のプールとは別） */
interface DecoStar {
  x: number;
  y: number;
  radiusPx: number;
  alpha: number;
  twinklePeriodMs: number;
  twinklePhase: number;
  /** 上位の等級だけが持つ微小暈の半径（0 は暈なし） */
  topHaloRadiusPx: number;
}

interface FingerSession {
  pointerId: number;
  /** 指の平滑化位置（時定数 90ms） */
  smoothX: number;
  smoothY: number;
  targetX: number;
  targetY: number;
  /** 捕獲順に積む */
  starIds: number[];
  startMs: number;
}

interface Constellation {
  id: number;
  /** 確定順（最上部始点・時計回り）の音響用データ。音側へ渡したら更新しない */
  steps: readonly StarStep[];
  releasedAtMs: number;
  /** 到達増光を設定済みの clock.firstAtMs。pending→audio の切替検出用（-1 は未確定） */
  brightenSetForMs: number;
}

interface StarView {
  x: number;
  y: number;
  coreR: number;
  haloR: number;
  haloAlpha: number;
  coreAlpha: number;
}

/** starView に渡す 1 フレーム分の参照データ */
interface ViewContext {
  nowMs: number;
  phases: Map<number, ConstellationPhase>;
  constellationsById: Map<number, Constellation>;
  centerX: number;
  centerY: number;
  isReducedQuality: boolean;
}

// ============================================================
// 純粋な数式（正本 §3・design.md 第9章）
// ============================================================

/** N(t) = min(12, 3 + floor(max(0, t) / 300))。300ms 未満でも 3 を返す */
function starCountFor(elapsedMs: number): number {
  return Math.min(MAX_STARS, MIN_STARS + Math.floor(Math.max(0, elapsedMs) / STAR_ADD_MS));
}

/** R(t) = S × (0.10 + 0.14 × min(t / 2700, 1))。S = min(width, height, 720) */
function radiusFor(elapsedMs: number, width: number, height: number): number {
  const s = Math.min(width, height, SIZE_SATURATION_PX);
  return s * (RADIUS_MIN_RATIO + (RADIUS_MAX_RATIO - RADIUS_MIN_RATIO) * Math.min(elapsedMs / CHARGE_MAX_MS, 1));
}

/** 押下時に近い未所属星を選ぶ範囲（S×0.30・下限 96px。design.md 第7章） */
function captureCandidateRadiusPx(width: number, height: number): number {
  const s = Math.min(width, height, SIZE_SATURATION_PX);
  return Math.max(ATTRACT_CANDIDATE_RADIUS_MIN_PX, s * ATTRACT_CANDIDATE_RADIUS_RATIO);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function cubicOut(t: number): number {
  return 1 - Math.pow(1 - clamp01(t), 3);
}

/** 指数平滑の次の値。dt は正本 §3 の上限（50ms）で切る */
function expSmooth(current: number, target: number, dtMs: number, tauMs: number): number {
  const dt = Math.min(Math.max(dtMs, 0), FOLLOW_DT_MAX_MS);
  return target + (current - target) * Math.exp(-dt / tauMs);
}

/** 発音・到達増光の量 0..1（60ms で立ち上がり、以後指数減衰 420ms。design.md 第8章） */
function brightenAmount(elapsedMs: number): number {
  if (elapsedMs < 0) return 0;
  if (elapsedMs < BRIGHTEN_RISE_MS) return elapsedMs / BRIGHTEN_RISE_MS;
  return Math.exp(-(elapsedMs - BRIGHTEN_RISE_MS) / BRIGHTEN_DECAY_MS);
}

/** idle 帯の寸法を active 帯へ写像する（正規化 → 線形写像） */
function activeCoreFromIdle(coreIdlePx: number): number {
  const unit = clamp01(
    (coreIdlePx - STAR_CORE_IDLE_MIN_PX) / (STAR_CORE_IDLE_MAX_PX - STAR_CORE_IDLE_MIN_PX),
  );
  return STAR_CORE_ACTIVE_MIN_PX + unit * (STAR_CORE_ACTIVE_MAX_PX - STAR_CORE_ACTIVE_MIN_PX);
}

function activeHaloFromIdle(haloIdlePx: number): number {
  const unit = clamp01(
    (haloIdlePx - STAR_HALO_IDLE_MIN_PX) / (STAR_HALO_IDLE_MAX_PX - STAR_HALO_IDLE_MIN_PX),
  );
  return STAR_HALO_ACTIVE_MIN_PX + unit * (STAR_HALO_ACTIVE_MAX_PX - STAR_HALO_ACTIVE_MIN_PX);
}

/** 星図を決定的に作るための最小の PRNG（mulberry32）。resize でも同じ相対配置になる */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** 暈のスプライト（design.md 第6章の 4 停止点グラデを事前レンダリングする） */
function buildHaloSprite(): HTMLCanvasElement {
  const sizePx = 64;
  const canvas = document.createElement("canvas");
  canvas.width = sizePx;
  canvas.height = sizePx;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(sizePx / 2, sizePx / 2, 0, sizePx / 2, sizePx / 2, sizePx / 2);
    const [r, g, b] = hexToRgb(PALETTE_STAR);
    for (const [stop, alpha] of HALO_GRADIENT_STOPS) {
      gradient.addColorStop(stop, `rgba(${r}, ${g}, ${b}, ${alpha})`);
    }
    context.fillStyle = gradient;
    context.fillRect(0, 0, sizePx, sizePx);
  }
  return canvas;
}

// ============================================================
// 状態
// ============================================================

const audio = createAudioEngine();
const quality = new QualityController(HALO_LAYER_STEPS.length);
const frameCounter = createFrameCounter();

const hostEl = document.querySelector<HTMLDivElement>("#p5-host")!;
const gateEl = document.querySelector<HTMLDivElement>("#gate")!;
const debugOverlayEl = document.querySelector<HTMLPreElement>("#debug-overlay")!;
const isDebugMode = new URLSearchParams(location.search).has("debug");
if (isDebugMode) debugOverlayEl.hidden = false;

/** 暈のスプライト。setup で作る（PALETTE_STAR を 1 か所だけ使う） */
let haloSprite = buildHaloSprite();

const stars: Star[] = [];
const decoStars: DecoStar[] = [];
const sessions = new Map<number, FingerSession>();
const constellations: Constellation[] = [];

let instance: P5 | null = null;
let isIntro = true;
let pageHidden = false;
let nextSequenceId = 1;
/** 5 個目の解放で最古の星座を置換した回数（診断用。正本 §3） */
let replacementCount = 0;
let lastAmp = 0;
let lastError = "";
let previousWidth = 0;
let previousHeight = 0;

/** 星図の seed。resize で再写像するので初期生成だけに使う */
const STAR_SEED = 0x5eed;
const DECO_SEED = 0xdeca;

// ============================================================
// 星プールと装飾星の生成
// ============================================================

function buildStars(width: number, height: number): void {
  stars.length = 0;
  const rng = createRng(STAR_SEED);
  const centerX = width / 2;
  const centerY = height / 2;
  const spreadPx = Math.min(Math.min(width, height) * INTRO_SPREAD_RATIO, INTRO_SPREAD_MAX_PX);
  for (let index = 0; index < STAR_POOL_SIZE; index++) {
    const isIntroStar = index < INTRO_STAR_COUNT;
    let homeX: number;
    let homeY: number;
    if (isIntroStar) {
      // 中央の 5 星（design.md 第10章。等角配置に軽いゆらぎを足す）
      const angle =
        -Math.PI / 2 + index * ((Math.PI * 2) / INTRO_STAR_COUNT) + (rng() - 0.5) * 0.6;
      const radius = spreadPx * (0.6 + rng() * 0.4);
      homeX = centerX + Math.cos(angle) * radius;
      homeY = centerY + Math.sin(angle) * radius;
    } else {
      // 画面外のはみ出しを含めて全域にちらし、画面端に列を作らない（design.md 第4章の注釈）
      const marginPx = 32;
      homeX = rng() * (width + marginPx * 2) - marginPx;
      homeY = rng() * (height + marginPx * 2) - marginPx;
    }
    const coreIdlePx = isIntroStar
      ? 2.4 + rng() * 0.4 // design.md 第2章 A1: 芯 2.4〜2.8px
      : STAR_CORE_IDLE_MIN_PX + rng() * (STAR_CORE_IDLE_MAX_PX - STAR_CORE_IDLE_MIN_PX);
    const haloIdlePx = isIntroStar
      ? 12 + rng() * 2 // design.md 第2章 A1: 暈 12〜14px
      : STAR_HALO_IDLE_MIN_PX + rng() * (STAR_HALO_IDLE_MAX_PX - STAR_HALO_IDLE_MIN_PX);
    // 中央 5 星は idle = active の寸法にして、intro から収集への遷移で寸法が動かないようにする
    const coreActivePx = isIntroStar ? coreIdlePx : activeCoreFromIdle(coreIdlePx);
    const haloActivePx = isIntroStar ? haloIdlePx : activeHaloFromIdle(haloIdlePx);
    stars.push({
      id: index,
      homeX,
      homeY,
      x: homeX,
      y: homeY,
      coreIdlePx,
      haloIdlePx,
      coreActivePx,
      haloActivePx,
      haloIdleAlpha: HALO_IDLE_ALPHA_MIN + rng() * (HALO_IDLE_ALPHA_MAX - HALO_IDLE_ALPHA_MIN),
      coreIdleAlpha: CORE_IDLE_ALPHA_MIN + rng() * (CORE_IDLE_ALPHA_MAX - CORE_IDLE_ALPHA_MIN),
      haloActiveAlpha: HALO_ACTIVE_ALPHA_MIN + rng() * (HALO_ACTIVE_ALPHA_MAX - HALO_ACTIVE_ALPHA_MIN),
      twinklePeriodMs: BG_STAR_TWINKLE_MIN_MS + rng() * (BG_STAR_TWINKLE_MAX_MS - BG_STAR_TWINKLE_MIN_MS),
      twinklePhase: rng() * Math.PI * 2,
      owner: "free",
      ownerId: 0,
      captureIndex: 0,
      capturedAtMs: -1,
      brightenAtMs: -1,
      spawnAtMs: -1,
      fixedX: homeX,
      fixedY: homeY,
      returnFromX: homeX,
      returnFromY: homeY,
      returnStartMs: -1,
      homeFadeStartMs: -1,
    });
  }
}

function buildDecoStars(width: number, height: number): void {
  decoStars.length = 0;
  const rng = createRng(DECO_SEED);
  const count = Math.round(
    Math.min(BG_STAR_COUNT_MAX, Math.max(BG_STAR_COUNT_MIN, width * height * BG_STAR_DENSITY)),
  );
  const marginPx = 32;
  for (let index = 0; index < count; index++) {
    let x = marginPx / 2;
    let y = marginPx / 2;
    for (let attempt = 0; attempt < 4; attempt++) {
      x = rng() * (width + marginPx * 2) - marginPx;
      y = rng() * (height + marginPx * 2) - marginPx;
      if (!isNearIntroStars(x, y)) break;
    }
    const isTopGrade = rng() < BG_STAR_TOP_GRADE_RATIO;
    decoStars.push({
      x,
      y,
      radiusPx: BG_STAR_RADIUS_MIN_PX + rng() * (BG_STAR_RADIUS_MAX_PX - BG_STAR_RADIUS_MIN_PX),
      alpha: BG_STAR_ALPHA_MIN + rng() * (BG_STAR_ALPHA_MAX - BG_STAR_ALPHA_MIN),
      twinklePeriodMs: BG_STAR_TWINKLE_MIN_MS + rng() * (BG_STAR_TWINKLE_MAX_MS - BG_STAR_TWINKLE_MIN_MS),
      twinklePhase: rng() * Math.PI * 2,
      topHaloRadiusPx: isTopGrade
        ? BG_STAR_TOP_HALO_MIN_PX + rng() * (BG_STAR_TOP_HALO_MAX_PX - BG_STAR_TOP_HALO_MIN_PX)
        : 0,
    });
  }
}

/** intro の中央星群（stars[0..4]）の近くか。装飾星を遠ざけて中央を唯一の焦点に保つ */
function isNearIntroStars(x: number, y: number): boolean {
  const keepOutPx = 30;
  for (let index = 0; index < INTRO_STAR_COUNT; index++) {
    const star = stars[index];
    if (!star) break;
    if (Math.hypot(star.homeX - x, star.homeY - y) < keepOutPx) return true;
  }
  return false;
}

// ============================================================
// 所有・確定・解放（正本 §3）
// ============================================================

function attach(star: Star, session: FingerSession, nowMs: number): void {
  star.owner = "pointer";
  star.ownerId = session.pointerId;
  star.captureIndex = session.starIds.length;
  star.capturedAtMs = nowMs;
  star.brightenAtMs = -1;
  star.returnStartMs = -1;
  star.homeFadeStartMs = -1;
  star.x = star.homeX;
  star.y = star.homeY;
  session.starIds.push(star.id);
}

/** 近い未所属星を確保する。近傍に足りなければリング上へ新配置して吸引を始める */
function captureStars(session: FingerSession, need: number, nowMs: number, width: number, height: number): void {
  if (need <= 0) return;
  const candidateRadiusPx = captureCandidateRadiusPx(width, height);
  const distanceTo = (star: Star): number =>
    Math.hypot(star.homeX - session.smoothX, star.homeY - session.smoothY);
  const free = stars.filter((star) => star.owner === "free" && star.returnStartMs < 0);
  free.sort((a, b) => distanceTo(a) - distanceTo(b));
  let taken = 0;
  for (const star of free) {
    if (taken >= need) break;
    if (distanceTo(star) > candidateRadiusPx) break; // 近い順なので以降は範囲外
    attach(star, session, nowMs);
    taken++;
  }
  // design.md 第7章: 範囲内に星が足りなければ指の周囲のリング上へ同質の星を新配置（プール総数は維持）
  for (const star of free) {
    if (taken >= need) break;
    if (star.owner !== "free") continue;
    const ringPx = ATTRACT_SPAWN_RING_MIN_PX + Math.random() * (ATTRACT_SPAWN_RING_MAX_PX - ATTRACT_SPAWN_RING_MIN_PX);
    const angle = Math.random() * Math.PI * 2;
    star.homeX = session.smoothX + Math.cos(angle) * ringPx;
    star.homeY = session.smoothY + Math.sin(angle) * ringPx;
    star.spawnAtMs = nowMs;
    attach(star, session, nowMs);
    taken++;
  }
}

/** 収集中の星の目標点（指の平滑位置まわりの星座円上・不規則軌道。design.md 第9章）。
 *  隣接星の間隔は黄金角分散が STAR_MIN_GAP_PX の目標を満たす想定で、星ごとの
 *  反発処理は持たない（正本 §3 の規定の式に従う） */
function orbitTarget(star: Star, session: FingerSession, radiusPx: number, nowMs: number): { x: number; y: number } {
  const phase = GOLDEN_RATIO * star.captureIndex * Math.PI * 2;
  const baseAngle = -Math.PI / 2 + star.captureIndex * Math.PI * 2 * GOLDEN_RATIO;
  const angle =
    baseAngle + ORBIT_SWING_RAD * Math.sin((Math.PI * 2 * nowMs) / ORBIT_SWING_PERIOD_MS + phase);
  const radius =
    radiusPx *
    (1 + ORBIT_RADIUS_WOBBLE * Math.sin((Math.PI * 2 * nowMs) / (ORBIT_SWING_PERIOD_MS * 1.7) + phase * 1.618));
  return { x: session.smoothX + Math.cos(angle) * radius, y: session.smoothY + Math.sin(angle) * radius };
}

/** 星群を 18px の余白へ収める平行移動量（星ごとに clamp しない。design.md 第4章の注釈） */
function shiftToKeepMargin(owned: readonly Star[], width: number, height: number): { dx: number; dy: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const star of owned) {
    minX = Math.min(minX, star.x);
    maxX = Math.max(maxX, star.x);
    minY = Math.min(minY, star.y);
    maxY = Math.max(maxY, star.y);
  }
  let dx = 0;
  let dy = 0;
  if (minX < EDGE_MARGIN_PX) dx = EDGE_MARGIN_PX - minX;
  else if (maxX > width - EDGE_MARGIN_PX) dx = width - EDGE_MARGIN_PX - maxX;
  if (minY < EDGE_MARGIN_PX) dy = EDGE_MARGIN_PX - minY;
  else if (maxY > height - EDGE_MARGIN_PX) dy = height - EDGE_MARGIN_PX - maxY;
  return { dx, dy };
}

function releaseSession(session: FingerSession, nowMs: number, width: number, height: number): void {
  const owned = stars.filter((star) => star.owner === "pointer" && star.ownerId === session.pointerId);
  if (owned.length === 0) return;
  const { dx, dy } = shiftToKeepMargin(owned, width, height);
  for (const star of owned) {
    star.x += dx;
    star.y += dy;
    star.fixedX = star.x;
    star.fixedY = star.y;
  }
  // 最上部の星を始点に、時計回りの一本の折れ線へ（正本 §3。同角度は starId 順）
  const centerX = owned.reduce((sum, star) => sum + star.fixedX, 0) / owned.length;
  const centerY = owned.reduce((sum, star) => sum + star.fixedY, 0) / owned.length;
  const angleOf = (star: Star): number => Math.atan2(star.fixedY - centerY, star.fixedX - centerX);
  const topStar = owned.reduce((top, star) => (star.fixedY < top.fixedY ? star : top));
  const topAngle = angleOf(topStar);
  const order = owned.slice().sort((a, b) => {
    const fullCircle = Math.PI * 2;
    const angleA = (angleOf(a) - topAngle + fullCircle) % fullCircle;
    const angleB = (angleOf(b) - topAngle + fullCircle) % fullCircle;
    return angleA !== angleB ? angleA - angleB : a.id - b.id;
  });
  const steps: StarStep[] = order.map((star) => ({
    starId: star.id,
    x: star.fixedX / width,
    y: star.fixedY / height,
    midi: noteForPosition(star.fixedX / width).midi,
    velocity: 1,
  }));
  const plan: SequencePlan = { id: nextSequenceId++, steps, releasedAtMs: nowMs };
  // release ごとに一度だけ音響へ渡す（正本 §4・§5）。1 星 1 音はこの steps の順に鳴る
  audio.planSequence(plan);
  const clock = audio.getSequenceClock(plan.id);
  const firstAt = clock !== null && clock.firstAtMs !== null ? clock.firstAtMs : null;
  const stepMs = clock !== null ? clock.stepMs : 0;
  order.forEach((star, index) => {
    star.owner = "constellation";
    star.ownerId = plan.id;
    star.brightenAtMs = firstAt === null ? -1 : firstAt + index * stepMs;
    star.returnStartMs = -1;
  });
  constellations.push({ id: plan.id, steps, releasedAtMs: nowMs, brightenSetForMs: firstAt ?? -1 });
  // 解放済み星座は最大 4 個。5 個目の解放で最古の星座を終了し所有を返す（正本 §3）
  while (constellations.length > MAX_CONSTELLATIONS) {
    const oldest = constellations.shift();
    if (oldest) {
      // 置換した列の予約・音源も解放する（正本 §3・§5）
      audio.cancelSequence(oldest.id);
      for (const step of oldest.steps) returnConstellationStar(stars[step.starId], nowMs);
      replacementCount++;
    }
  }
}

function returnConstellationStar(star: Star, nowMs: number): void {
  star.owner = "free";
  star.ownerId = 0;
  star.brightenAtMs = -1;
  star.returnStartMs = -1;
  star.x = star.homeX;
  star.y = star.homeY;
  // 所有は返却済み。暈だけ design.md 第11章の「250ms で未所属の質感へ戻る」補間を続ける
  star.homeFadeStartMs = nowMs;
}

/** pointercancel / resize の収集取り消し。静かに 300ms かけて空の位置へ戻す */
function cancelSession(session: FingerSession, nowMs: number): void {
  for (const starId of session.starIds) {
    const star = stars[starId];
    if (star.owner !== "pointer" || star.ownerId !== session.pointerId) continue;
    star.owner = "free";
    star.ownerId = 0;
    star.brightenAtMs = -1;
    star.returnFromX = star.x;
    star.returnFromY = star.y;
    star.returnStartMs = nowMs;
  }
  session.starIds.length = 0;
}

/** blur / visibilitychange hidden / pagehide。全収集・星座の所有を即時に解放する */
function releaseAll(nowMs: number): void {
  for (const session of sessions.values()) {
    for (const starId of session.starIds) {
      const star = stars[starId];
      if (star.owner !== "pointer" || star.ownerId !== session.pointerId) continue;
      star.owner = "free";
      star.ownerId = 0;
      star.brightenAtMs = -1;
      star.returnStartMs = -1;
      star.homeFadeStartMs = -1;
      star.x = star.homeX;
      star.y = star.homeY;
    }
  }
  sessions.clear();
  for (const constellation of constellations) {
    for (const step of constellation.steps) returnConstellationStar(stars[step.starId], nowMs);
  }
  constellations.length = 0;
}

// ============================================================
// 音響への接点（正本 §4・§5）
// ============================================================
// 解放ごとに SequencePlan を一度だけ audio.planSequence() へ渡す。
// steps は線の確定順と同一順序・同一時刻（starId・位置・midi・velocity）を
// 持つため、1 星 1 音が線イベントと同じ順序・同じ時刻で鳴る。
//
// 時計は main 側にコピーを保存せず、getSequenceClock(id) を毎フレーム読み直す
// （正本 §5。pending → audio の切替があるため）。pending のとき firstAtMs は
// null で、星座の phase は waiting になり星は微光待機・増光も線も先走らない。
// running になった時点で音響側が起点を新たに確定し、絵も同じ clock へ揃う。

// ============================================================
// 状態の算出
// ============================================================

function lastNoteAtMs(constellation: Constellation): number {
  // clock は main 側に保存せず毎フレーム engine から読み直す（正本 §5）
  const clock = audio.getSequenceClock(constellation.id);
  if (!clock || clock.firstAtMs === null) return 0;
  return clock.firstAtMs + (constellation.steps.length - 1) * clock.stepMs;
}

function constellationPhase(constellation: Constellation, nowMs: number): ConstellationPhase {
  const clock = audio.getSequenceClock(constellation.id);
  if (!clock) return "expired"; // 音響側に無い列（置換・suspend 済み）は静かに終わらせる
  if (clock.firstAtMs === null) return "waiting";
  const lastAt = lastNoteAtMs(constellation);
  if (nowMs < lastAt) return "linking";
  if (nowMs < lastAt + HOLD_MS) return "holding";
  if (nowMs < lastAt + HOLD_MS + FADE_MS) return "fading";
  // 所有の返却は最終音から HOLD+FADE+RETURN（正本 ST-08 の +4600ms）。
  // その後の暈の 250ms 戻しは所有返却後の見た目の補間（star.homeFadeStartMs）
  if (nowMs < lastAt + HOLD_MS + FADE_MS + RETURN_MS) return "returning";
  return "expired";
}

/** window.__art.getState() の値。正本 §3 の優先順位で返す */
function currentState(nowMs: number): WorkState {
  if (isIntro) return "intro";
  if (pageHidden) return "idle";
  if (sessions.size > 0) return "collecting";
  const phases = constellations.map((constellation) => constellationPhase(constellation, nowMs));
  const has = (phase: ConstellationPhase): boolean => phases.includes(phase);
  if (has("waiting")) return "waiting";
  if (has("linking")) return "linking";
  if (has("holding")) return "holding";
  if (has("fading")) return "fading";
  if (has("returning")) return "returning";
  return "idle";
}

installArtHook({
  getAmp: () => lastAmp,
  getState: () => currentState(performance.now()),
  getFrameStats: () => frameCounter.stats(),
});

// ============================================================
// 描画
// ============================================================

function starView(star: Star, view: ViewContext): StarView {
  let x = star.x;
  let y = star.y;
  let coreR = star.coreIdlePx;
  let haloR = star.haloIdlePx;
  let haloAlpha = star.haloIdleAlpha;
  let coreAlpha = star.coreIdleAlpha;
  let alphaScale = 1;
  // 背景星の微明滅（design.md 第8章。低画質では停止させる）
  const twinkle = view.isReducedQuality
    ? 0
    : BG_STAR_TWINKLE_AMPLITUDE * Math.sin((Math.PI * 2 * view.nowMs) / star.twinklePeriodMs + star.twinklePhase);

  if (star.owner === "free") {
    if (star.returnStartMs >= 0) {
      // cancel の星: 位置は update 側が動かし、質感はここで未所属へ戻す
      const eased = cubicOut(clamp01((view.nowMs - star.returnStartMs) / CANCEL_RETURN_MS));
      coreR = lerp(star.coreActivePx, star.coreIdlePx, eased);
      haloR = lerp(star.haloActivePx, star.haloIdlePx, eased);
      haloAlpha = lerp(star.haloActiveAlpha, star.haloIdleAlpha, eased);
      coreAlpha = lerp(CORE_ACTIVE_ALPHA, star.coreIdleAlpha, eased);
    } else if (star.homeFadeStartMs >= 0) {
      // 帰還の所有返却後: 位置は既に空の位置。暈だけ 250ms で未所属の質感へ戻す
      const eased = cubicOut(clamp01((view.nowMs - star.homeFadeStartMs) / HOME_FADE_MS));
      coreR = lerp(star.coreActivePx, star.coreIdlePx, eased);
      haloR = lerp(star.haloActivePx, star.haloIdlePx, eased);
      haloAlpha = lerp(star.haloActiveAlpha, star.haloIdleAlpha, eased);
      coreAlpha = lerp(CORE_ACTIVE_ALPHA, star.coreIdleAlpha, eased);
    }
    haloAlpha = Math.max(0, haloAlpha + twinkle);
    if (isIntro && star.id < INTRO_STAR_COUNT) {
      // 中央 5 星の呼吸（広がり ±15%）と明滅（±0.06）で誘う（design.md 第10章）
      const breath = Math.sin((Math.PI * 2 * view.nowMs) / INTRO_BREATH_MS + star.twinklePhase);
      const scale = 1 + INTRO_BREATH_SPREAD * breath;
      x = view.centerX + (star.homeX - view.centerX) * scale;
      y = view.centerY + (star.homeY - view.centerY) * scale;
      coreR = star.coreActivePx; // A1 カンプの寸法（芯 2.4〜2.8px・暈 12〜14px）
      haloR = star.haloActivePx;
      haloAlpha = INTRO_HALO_ALPHA + INTRO_BREATH_ALPHA * breath;
      coreAlpha = CORE_ACTIVE_ALPHA;
    }
  } else if (star.owner === "pointer") {
    // 収集中: active 質感への遷移も指と同じ時定数で滑らかに（押下80msで58.9%進む）
    const mix = 1 - Math.exp(-Math.max(0, view.nowMs - star.capturedAtMs) / FOLLOW_TAU_MS);
    coreR = lerp(star.coreIdlePx, star.coreActivePx, mix);
    haloR = lerp(star.haloIdlePx, star.haloActivePx, mix);
    haloAlpha = lerp(star.haloIdleAlpha, star.haloActiveAlpha, mix);
    coreAlpha = CORE_ACTIVE_ALPHA;
    const session = sessions.get(star.ownerId);
    if (session && view.nowMs - session.startMs >= CHARGE_MAX_MS) {
      // 成長上限に達した後は星数・半径を増やさず微明滅だけ続ける（design.md 第9章）
      haloAlpha = Math.min(
        HALO_MAX_STACK_ALPHA,
        haloAlpha + HOLD_PULSE_AMPLITUDE * Math.sin((Math.PI * 2 * view.nowMs) / HOLD_PULSE_MS + star.twinklePhase),
      );
    }
    if (star.spawnAtMs >= 0) {
      alphaScale *= clamp01((view.nowMs - star.spawnAtMs) / ATTRACT_SPAWN_FADE_MS);
    }
  } else {
    const phase = view.phases.get(star.ownerId) ?? "expired";
    const constellation = view.constellationsById.get(star.ownerId);
    coreR = star.coreActivePx;
    haloR = star.haloActivePx;
    haloAlpha = star.haloActiveAlpha;
    coreAlpha = CORE_ACTIVE_ALPHA;
    if (phase === "waiting") {
      // 音声の解錠待ち: 星と線を先走らせず微光で待機する（正本 §3 の状態表）
      haloAlpha *= WAITING_HALO_SCALE;
    } else {
      // 発音・到達増光（60ms 立ち上がり・420ms 減衰。design.md 第8章）
      const brighten = star.brightenAtMs < 0 ? 0 : brightenAmount(view.nowMs - star.brightenAtMs);
      coreR *= 1 + (BRIGHTEN_CORE_SCALE - 1) * brighten;
      haloAlpha = Math.min(HALO_MAX_STACK_ALPHA, haloAlpha * (1 + (BRIGHTEN_HALO_ALPHA_SCALE - 1) * brighten));
      if (phase === "holding" && constellation) {
        // 保持中の微明滅（±0.08・1.6 秒周期。design.md 第6章）
        haloAlpha = Math.min(
          HALO_MAX_STACK_ALPHA,
          haloAlpha + HOLD_PULSE_AMPLITUDE * Math.sin((Math.PI * 2 * view.nowMs) / HOLD_PULSE_MS + star.twinklePhase),
        );
      }
      if (phase === "returning" && constellation) {
        // 到着後、未所属の質感へ 250ms で戻る（design.md 第11章）
        const returnStartedAt = lastNoteAtMs(constellation) + HOLD_MS + FADE_MS;
        const easedHome = cubicOut(clamp01((view.nowMs - returnStartedAt - RETURN_MS) / HOME_FADE_MS));
        coreR = lerp(coreR, star.coreIdlePx, easedHome);
        haloR = lerp(haloR, star.haloIdlePx, easedHome);
        haloAlpha = lerp(haloAlpha, star.haloIdleAlpha, easedHome);
        coreAlpha = lerp(CORE_ACTIVE_ALPHA, star.coreIdleAlpha, easedHome);
      }
      if (phase === "fading" && constellation) {
        // 消退は (1−p)^1.6 の静かな alpha 減衰（design.md 第8章）。線幅は変えない
        const fadeP = clamp01((view.nowMs - lastNoteAtMs(constellation) - HOLD_MS) / FADE_MS);
        alphaScale = Math.pow(1 - fadeP, FADE_CURVE_EXP);
      }
    }
  }
  return {
    x,
    y,
    coreR,
    haloR,
    haloAlpha: Math.max(0, haloAlpha) * alphaScale,
    coreAlpha: Math.max(0, coreAlpha) * alphaScale,
  };
}

/** 1 本の星（芯＋暈）。全状態でこの 1 関数だけを使う（design.md 第1章の質感の単一性） */
function drawStar(ctx: CanvasRenderingContext2D, view: StarView): void {
  ctx.globalAlpha = clamp01(view.haloAlpha);
  const haloDiameter = view.haloR * 2;
  ctx.drawImage(haloSprite, view.x - view.haloR, view.y - view.haloR, haloDiameter, haloDiameter);
  ctx.globalAlpha = clamp01(view.coreAlpha);
  ctx.fillStyle = PALETTE_CORE;
  ctx.beginPath();
  ctx.arc(view.x, view.y, view.coreR, 0, Math.PI * 2);
  ctx.fill();
}

/** 線（暈 2.5px alpha 0.18 を下に、芯 0.8px alpha 0.85 を重ねる。design.md 第6章）。
 *  線 i は at(i−1) から at(i) まで 160ms で線形に伸びる（design.md 第9章） */
function drawConstellationLines(ctx: CanvasRenderingContext2D, nowMs: number, phases: Map<number, ConstellationPhase>): void {
  for (const constellation of constellations) {
    const phase = phases.get(constellation.id) ?? "expired";
    const clock = audio.getSequenceClock(constellation.id);
    if (phase === "waiting" || phase === "returning" || clock === null || clock.firstAtMs === null) continue;
    const stepMs = clock.stepMs;
    const lastAt = lastNoteAtMs(constellation);
    let globalScale = 1;
    if (phase === "fading") {
      globalScale = Math.pow(1 - clamp01((nowMs - lastAt - HOLD_MS) / FADE_MS), FADE_CURVE_EXP);
    }
    const points = constellation.steps.map((step) => stars[step.starId]);
    let headX = 0;
    let headY = 0;
    let hasHead = false;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = PALETTE_STAR;
    for (const [widthPx, alpha] of [
      [LINE_HALO_WIDTH_PX, LINE_HALO_ALPHA],
      [LINE_CORE_WIDTH_PX, LINE_CORE_ALPHA],
    ] as const) {
      ctx.globalAlpha = alpha * globalScale;
      ctx.lineWidth = widthPx;
      ctx.beginPath();
      let any = false;
      for (let index = 1; index < points.length; index++) {
        const progress = clamp01((nowMs - (clock.firstAtMs + (index - 1) * stepMs)) / stepMs);
        if (progress <= 0) break;
        const from = points[index - 1];
        const to = points[index];
        if (!any) {
          ctx.moveTo(from.fixedX, from.fixedY);
          any = true;
        }
        const tipX = from.fixedX + (to.fixedX - from.fixedX) * progress;
        const tipY = from.fixedY + (to.fixedY - from.fixedY) * progress;
        ctx.lineTo(tipX, tipY);
        if (progress < 1) {
          headX = tipX;
          headY = tipY;
          hasHead = true;
          break;
        }
      }
      if (!any) continue;
      ctx.stroke();
    }
    ctx.restore();
    // 先端光点（2.6px 芯・暈 11px alpha 0.30。design.md 第8章）
    if (phase === "linking" && hasHead) {
      ctx.globalAlpha = HEAD_DOT_ALPHA;
      ctx.drawImage(haloSprite, headX - HEAD_DOT_HALO_PX, headY - HEAD_DOT_HALO_PX, HEAD_DOT_HALO_PX * 2, HEAD_DOT_HALO_PX * 2);
      ctx.globalAlpha = CORE_ACTIVE_ALPHA;
      ctx.fillStyle = PALETTE_CORE;
      ctx.beginPath();
      ctx.arc(headX, headY, HEAD_DOT_CORE_PX, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ============================================================
// 毎フレームの状態更新
// ============================================================

function updateSessions(dtMs: number, nowMs: number, width: number, height: number): void {
  for (const session of sessions.values()) {
    const elapsedMs = nowMs - session.startMs;
    // 指の平滑化位置（時定数 90ms・dt 上限 50ms。design.md 第4章の注釈）
    session.smoothX = expSmooth(session.smoothX, session.targetX, dtMs, FOLLOW_TAU_MS);
    session.smoothY = expSmooth(session.smoothY, session.targetY, dtMs, FOLLOW_TAU_MS);
    // STAR_ADD_MS ごとに式を再評価して追加枠を確保する（正本 §3）
    const target = starCountFor(elapsedMs);
    if (session.starIds.length < target) {
      captureStars(session, target - session.starIds.length, nowMs, width, height);
    }
    const radiusPx = radiusFor(elapsedMs, width, height);
    for (const starId of session.starIds) {
      const star = stars[starId];
      const target2 = orbitTarget(star, session, radiusPx, nowMs);
      star.x = expSmooth(star.x, target2.x, dtMs, FOLLOW_TAU_MS);
      star.y = expSmooth(star.y, target2.y, dtMs, FOLLOW_TAU_MS);
    }
  }
}

function updateConstellations(nowMs: number): void {
  // pending だった列が audio 時計に変わったら、到達増光を音と同じ時刻へ設定する
  // （正本 §4・§5。時計のコピーは保存せず毎フレーム読み直す）
  for (const constellation of constellations) {
    const clock = audio.getSequenceClock(constellation.id);
    const firstAt = clock !== null && clock.firstAtMs !== null ? clock.firstAtMs : -1;
    const stepMs = clock !== null ? clock.stepMs : 0;
    if (constellation.brightenSetForMs === firstAt) continue;
    constellation.brightenSetForMs = firstAt;
    for (const [index, step] of constellation.steps.entries()) {
      stars[step.starId].brightenAtMs = firstAt < 0 || clock === null ? -1 : firstAt + index * stepMs;
    }
  }
  // returning 中の星の位置を cubic-out で元の空の位置へ戻す（design.md 第11章）
  for (const constellation of constellations) {
    if (constellationPhase(constellation, nowMs) !== "returning") continue;
    const returnStartedAt = lastNoteAtMs(constellation) + HOLD_MS + FADE_MS;
    const eased = cubicOut(clamp01((nowMs - returnStartedAt) / RETURN_MS));
    for (const step of constellation.steps) {
      const star = stars[step.starId];
      star.x = star.fixedX + (star.homeX - star.fixedX) * eased;
      star.y = star.fixedY + (star.homeY - star.fixedY) * eased;
    }
  }
  // 寿命の終わった星座の所有を返す（最終音から HOLD+FADE+RETURN = 4600ms 後。正本 ST-08）
  for (let index = constellations.length - 1; index >= 0; index--) {
    const constellation = constellations[index];
    if (constellationPhase(constellation, nowMs) !== "expired") continue;
    for (const step of constellation.steps) returnConstellationStar(stars[step.starId], nowMs);
    constellations.splice(index, 1);
  }
}

function updateFreeStars(nowMs: number): void {
  for (const star of stars) {
    if (star.owner !== "free") continue;
    if (star.returnStartMs >= 0) {
      const progress = (nowMs - star.returnStartMs) / CANCEL_RETURN_MS;
      if (progress >= 1) {
        star.returnStartMs = -1;
        star.x = star.homeX;
        star.y = star.homeY;
        continue;
      }
      const eased = cubicOut(progress);
      star.x = star.returnFromX + (star.homeX - star.returnFromX) * eased;
      star.y = star.returnFromY + (star.homeY - star.returnFromY) * eased;
      continue;
    }
    if (star.homeFadeStartMs >= 0 && nowMs - star.homeFadeStartMs >= HOME_FADE_MS) {
      star.homeFadeStartMs = -1; // 質感の戻りが完了
    }
  }
}

// ============================================================
// 診断（?debug のみ）
// ============================================================

function renderDebugOverlay(nowMs: number): void {
  const stats = frameCounter.stats();
  let captured = 0;
  for (const session of sessions.values()) captured += session.starIds.length;
  const snapshot: Record<string, string | number | boolean> = {
    state: currentState(nowMs),
    amp: Math.round(lastAmp * 1000) / 1000,
    frames: stats.frames,
    meanDrawMs: Math.round(stats.meanDrawMs * 100) / 100,
    qualityLevel: quality.getLevel(),
    stars: stars.length,
    captured,
    constellations: constellations.length,
    replaced: replacementCount,
    lastError,
    ...audio.getDiagnostics(),
  };
  debugOverlayEl.textContent = Object.entries(snapshot)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

// ============================================================
// p5 インスタンス（入力・描画ループ）
// ============================================================

const disposers: Array<() => void> = [];

instance = new P5((p: P5) => {
  p.setup = () => {
    const canvas = p.createCanvas(window.innerWidth, window.innerHeight);
    canvas.parent(hostEl);
    // p5 v2 の既知の制約: pixelDensity は createCanvas の後に呼ぶ
    p.pixelDensity(1);
    haloSprite = buildHaloSprite();
    buildStars(p.width, p.height);
    buildDecoStars(p.width, p.height);
    previousWidth = p.width;
    previousHeight = p.height;

    const onPointerDown = (event: PointerEvent): void => {
      if (isIntro) {
        gateEl.classList.add("is-hidden");
        // resume() の解決は待たない。音の成否に関わらず描画は続ける（正本 §3）
        audio.start().catch((error: unknown) => {
          lastError = error instanceof Error ? error.message : String(error);
        });
        isIntro = false;
      }
      if (pageHidden) return;
      if (sessions.size >= MAX_POINTERS) return; // 3 指目以降は無視する（正本 §3）
      if (sessions.has(event.pointerId)) return; // 重複 down は冪等に無視
      // 画面外で指を離しても up を受け取れるよう capture する（正本 §3 の状態表）
      try {
        hostEl.setPointerCapture(event.pointerId);
      } catch {
        // capture できない環境でも window の up で動く
      }
      const nowMs = performance.now();
      const session: FingerSession = {
        pointerId: event.pointerId,
        smoothX: event.clientX,
        smoothY: event.clientY,
        targetX: event.clientX,
        targetY: event.clientY,
        starIds: [],
        startMs: nowMs,
      };
      sessions.set(event.pointerId, session);
      captureStars(session, starCountFor(0), nowMs, p.width, p.height);
    };

    const onPointerMove = (event: PointerEvent): void => {
      const session = sessions.get(event.pointerId);
      if (!session) return;
      session.targetX = event.clientX;
      session.targetY = event.clientY;
    };

    const onPointerUp = (event: PointerEvent): void => {
      const session = sessions.get(event.pointerId);
      if (!session) return; // 正常 up 済みの後の cancel / lostpointercapture は無視（正本 §3）
      sessions.delete(event.pointerId);
      const nowMs = performance.now();
      // pointerup でも星数の式を再評価し、rAF の境界ずれを防ぐ（正本 §3）
      const target = starCountFor(nowMs - session.startMs);
      if (session.starIds.length < target) {
        captureStars(session, target - session.starIds.length, nowMs, p.width, p.height);
      }
      releaseSession(session, nowMs, p.width, p.height);
    };

    const onPointerCancel = (event: PointerEvent): void => {
      const session = sessions.get(event.pointerId);
      if (!session) return;
      sessions.delete(event.pointerId);
      cancelSession(session, performance.now());
    };

    /** hidden / blur / pagehide 共通。所有を解放して描画を休止する */
    const interrupt = (): void => {
      pageHidden = true;
      releaseAll(performance.now());
      // 全予約の破棄・30ms 消音・残響も切る（正本 §3 の状態表）。復帰後に古い音を再生しない
      audio.suspend();
    };

    const onVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") interrupt();
      else pageHidden = false; // visible 復帰は idle。rAF は p5 が常に一本
    };

    const onResize = (): void => {
      p.resizeCanvas(window.innerWidth, window.innerHeight);
      const ratioX = p.width / previousWidth;
      const ratioY = p.height / previousHeight;
      // 収集を取り消す（正本 §3 の状態表）
      const nowMs = performance.now();
      for (const session of [...sessions.values()]) {
        sessions.delete(session.pointerId);
        cancelSession(session, nowMs);
      }
      // 未所属を含む全星の座標を比率で写像し、装飾星は新しい寸法で作り直す
      for (const star of stars) {
        star.homeX *= ratioX;
        star.homeY *= ratioY;
        star.x *= ratioX;
        star.y *= ratioY;
        star.fixedX *= ratioX;
        star.fixedY *= ratioY;
        star.returnFromX *= ratioX;
        star.returnFromY *= ratioY;
      }
      buildDecoStars(p.width, p.height);
      // 既存星座は形を保って 18px の余白へ再投影する（音響の時刻は不変。正本 §3）
      for (const constellation of constellations) {
        const owned = constellation.steps.map((step) => stars[step.starId]);
        for (const star of owned) {
          star.x = star.fixedX;
          star.y = star.fixedY;
        }
        const { dx, dy } = shiftToKeepMargin(owned, p.width, p.height);
        for (const star of owned) {
          star.fixedX += dx;
          star.fixedY += dy;
        }
      }
      previousWidth = p.width;
      previousHeight = p.height;
    };

    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    disposers.push(() => window.removeEventListener("pointerdown", onPointerDown));
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    disposers.push(() => window.removeEventListener("pointermove", onPointerMove));
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    disposers.push(() => window.removeEventListener("pointerup", onPointerUp));
    window.addEventListener("pointercancel", onPointerCancel, { passive: true });
    disposers.push(() => window.removeEventListener("pointercancel", onPointerCancel));
    window.addEventListener("lostpointercapture", onPointerCancel, { passive: true });
    disposers.push(() => window.removeEventListener("lostpointercapture", onPointerCancel));
    window.addEventListener("resize", onResize, { passive: true });
    disposers.push(() => window.removeEventListener("resize", onResize));
    document.addEventListener("visibilitychange", onVisibilityChange);
    disposers.push(() => document.removeEventListener("visibilitychange", onVisibilityChange));
    window.addEventListener("blur", interrupt);
    disposers.push(() => window.removeEventListener("blur", interrupt));
    const onFocus = (): void => {
      pageHidden = false;
    };
    window.addEventListener("focus", onFocus);
    disposers.push(() => window.removeEventListener("focus", onFocus));
    window.addEventListener("pagehide", interrupt);
    disposers.push(() => window.removeEventListener("pagehide", interrupt));
    const onContextMenu = (event: MouseEvent): void => event.preventDefault();
    window.addEventListener("contextmenu", onContextMenu);
    disposers.push(() => window.removeEventListener("contextmenu", onContextMenu));
  };

  p.draw = () => {
    if (pageHidden) return; // 休止中は何も描かない。rAF は p5 が常に一本持つ
    const drawStartMs = performance.now();
    const nowMs = drawStartMs;
    quality.recordFrame(Math.min(p.deltaTime || 16.7, 100));
    lastAmp = audio.getAmp(); // analyser の読み出しは 1 フレーム 1 回

    const dtMs = p.deltaTime || 16.7;
    updateSessions(dtMs, nowMs, p.width, p.height);
    updateConstellations(nowMs);
    updateFreeStars(nowMs);

    const ctx = p.drawingContext;
    ctx.save();
    ctx.globalCompositeOperation = "source-over"; // 加算は禁止（design.md 第12章）
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE_BACKGROUND;
    ctx.fillRect(0, 0, p.width, p.height); // 毎フレーム不透明で 1 回塗り（残像は使わない）

    const isReducedQuality = quality.getLevel() >= HALO_LAYER_STEPS.length - 1;
    const viewContext: ViewContext = {
      nowMs,
      phases: new Map(),
      constellationsById: new Map(),
      centerX: p.width / 2,
      centerY: p.height / 2,
      isReducedQuality,
    };
    for (const constellation of constellations) {
      viewContext.phases.set(constellation.id, constellationPhase(constellation, nowMs));
      viewContext.constellationsById.set(constellation.id, constellation);
    }
    drawDecoStars(ctx, nowMs, isReducedQuality);
    drawConstellationLines(ctx, nowMs, viewContext.phases);
    for (const star of stars) {
      drawStar(ctx, starView(star, viewContext));
    }
    ctx.restore();

    frameCounter.record(performance.now() - drawStartMs);
    if (isDebugMode && p.frameCount % 6 === 0) renderDebugOverlay(nowMs);
  };
});

/** drawDecoStars は sketch の draw からだけ使う（haloSprite を参照するため） */
function drawDecoStars(ctx: CanvasRenderingContext2D, nowMs: number, isReducedQuality: boolean): void {
  ctx.fillStyle = PALETTE_STAR;
  for (const deco of decoStars) {
    const twinkle = isReducedQuality
      ? 0
      : BG_STAR_TWINKLE_AMPLITUDE * Math.sin((Math.PI * 2 * nowMs) / deco.twinklePeriodMs + deco.twinklePhase);
    // 上位等級の微小暈は低画質で止める（暈の層数 2→1。design.md 第14章）
    if (deco.topHaloRadiusPx > 0 && !isReducedQuality) {
      ctx.globalAlpha = BG_STAR_TOP_HALO_ALPHA;
      ctx.drawImage(
        haloSprite,
        deco.x - deco.topHaloRadiusPx,
        deco.y - deco.topHaloRadiusPx,
        deco.topHaloRadiusPx * 2,
        deco.topHaloRadiusPx * 2,
      );
    }
    ctx.globalAlpha = Math.max(0, Math.min(1, deco.alpha + twinkle));
    ctx.beginPath();
    ctx.arc(deco.x, deco.y, deco.radiusPx, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** pagehide / HMR dispose（正本 §3 の状態表）。pagehide は所有の解放と描画の休止のみ
 *  （bfcache 復帰を壊さない）。リスナーの解除と p5 の破棄は HMR dispose が担う */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const dispose of disposers) dispose();
    disposers.length = 0;
    instance?.remove();
    instance = null;
    // context と常駐リスナーも解除する（正本 §5。HMR 再初期化時に重複を残さない）
    audio.dispose();
  });
}
