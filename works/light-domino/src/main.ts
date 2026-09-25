// ============================================================
// main.ts ─ 状態機械・ポインタ入力・連鎖タイムライン・描画ループ（p5 インスタンスモード）
// 正本は docs/architecture.md。状態機械: intro → tracing → aligned → chain → finale
// 開発用クエリ: ?mute（無音）/ ?debug（診断オーバーレイ）
// ============================================================

import P5 from "p5";
import "./style.css";

import { fallProgress } from "./chain";
import { createFrameCounter, installArtHook } from "./art-hook";
import {
  buildDominoes,
  crossingFlags,
  parallelFlags,
  pathLength,
  resampleByArcLength,
  smoothPoints,
  type Domino,
  type Vec2,
} from "./path";
import { pitchForChainIndex, velocityForInteraction } from "./music";
import { QualityController } from "./quality";
import type { ChainEvent, ChainSchedule } from "./audio/engine";
import { createAudioEngine } from "./audio/engine";
import {
  AFTERGLOW_FADE_MS,
  CHAIN_LIGHT_RECENT_TILES,
  CHAIN_LIGHT_SLIDE_MS,
  COMMIT_RETRACE_MS,
  DOMINO_SPACING_MAX_PX,
  DOMINO_SPACING_MIN_PX,
  DOMINO_SPACING_RATIO,
  DRAG_START_DISTANCE_PX,
  EDGE_REFLECTION_ALPHA,
  ENDPOINT_BLINK_HZ_ALIGNED,
  ENDPOINT_BLINK_PHASE_STAGGER_MS,
  ENDPOINT_BLINK_TILES,
  ENDPOINT_FLASH_MS,
  ENDPOINT_HIT_MIN_PX,
  ENDPOINT_HIT_RATIO,
  FALL_MS,
  FALLEN_GLOW_ALPHA,
  FALLEN_GLOW_REST_ALPHA,
  FALLEN_TILE_LENGTH_PX,
  FINALE_BLOOM_CORE_WIDTH_PX,
  FINALE_BLOOM_DELAY_MS,
  FINALE_BLOOM_GLOW_ALPHA,
  FINALE_BLOOM_GLOW_WIDTH_PX,
  FINALE_BLOOM_MS,
  FINALE_SHOCKWAVE_ALPHA,
  FINALE_SHOCKWAVE_RADIUS_RATIO,
  FLOOR_GLOW_ALPHA_END,
  FLOOR_GLOW_ALPHA_START,
  FLOOR_GLOW_RADIUS_RATIO,
  FLOOR_GUIDE_ALPHA,
  FLOOR_GUIDE_SPACING_PX,
  GLOW_CANVAS_DIVISOR,
  GLOW_PULSE_AMPLITUDE,
  HUSH_GLOW_DIM,
  IGNORE_BAND_BOTTOM_PX,
  INPUT_EDGE_INSET_PX,
  INTRO_FADE_MS,
  MAX_COMMITTED_TRAILS,
  MAX_DOMINOES,
  MAX_LIVE_NODES,
  MIN_DOMINOES,
  MIN_PATH_LENGTH_PX,
  MOBILE_ENDPOINT_BLINK_TILES,
  MOBILE_FALLEN_TILE_LENGTH_PX,
  MOBILE_FLOOR_GUIDE_SPACING_PX,
  MOBILE_PULSE_END_RADIUS_PX,
  MOBILE_PULSE_START_RADIUS_PX,
  MOBILE_TILE_DEPTH_PX,
  MOBILE_TILE_WIDTH_PX,
  NODE_HALO_ALPHA,
  NODE_HALO_RADIUS_PX,
  NODE_RADIUS_PX,
  PALETTE_BACKGROUND,
  PALETTE_GOLD,
  PALETTE_TILE,
  PARALLEL_RUN_MIN_GAP_PX,
  PARTICLE_CAP_STEPS,
  PORTRAIT_SCALE,
  PULSE_END_RADIUS_PX,
  PULSE_MAX_CONCURRENT,
  PULSE_START_RADIUS_PX,
  RAW_POINT_MIN_DISTANCE_PX,
  RAW_POINT_MIN_INTERVAL_MS,
  SHADOW_ALPHA,
  SHOCKWAVE_MS,
  SLEEPING_GLOW_ALPHA,
  SLEEPING_LIGHT_COUNT_MAX,
  SLEEPING_LIGHT_COUNT_MIN,
  SLEEPING_LIGHT_PERIOD_MAX_MS,
  SLEEPING_LIGHT_PERIOD_MIN_MS,
  SMOOTHING_WINDOW_POINTS,
  STROKE_DISCARD_MS,
  TILE_DEPTH_PX,
  TILE_OUTLINE_ALPHA,
  TILE_SIDE_BAND_ALPHA,
  TILE_WIDTH_PX,
  TRAIL_WIDTH_PX,
  TRACING_ECHO_ALPHA,
  TRACING_ECHO_MS,
  TRACING_ECHO_RADIUS_PX,
  TRACING_TILE_ALPHA,
  TRACING_TILE_HEAD_ALPHA,
} from "./tuning";

type State = "intro" | "tracing" | "aligned" | "chain" | "finale";

/** なぞり 1 回分の生の入力と仮配置 */
interface Stroke {
  rawPoints: Vec2[];
  lastRecordedAtMs: number;
  dominoes: Domino[];
  bornAtMs: number;
}

/** 光跡へ焼き付ける前に一時的に保持する確定列 */
interface SettlingStroke {
  dominoes: Domino[];
  /** aligned に遷移した時刻。吸着アニメに使う（現在は即座に吸着済み扱い） */
  alignedAtMs: number;
  /** 描画で金色へ変わった板の index（連鎖で倒れた板） */
  goldThrough: number;
}

interface LightPulse {
  x: number;
  y: number;
  bornAtMs: number;
}

interface SleepingLight {
  nx: number;
  ny: number;
  radius: number;
  phase: number;
  periodMs: number;
  awakenedAtMs: number | null;
}

interface TraceEcho {
  x: number;
  y: number;
  bornAtMs: number;
}

interface Shockwave {
  x: number;
  y: number;
  bornAtMs: number;
}

/** aligned の端以外を押した後、ドラッグ開始距離を超えるまで保持する入力 */
interface PendingReplacement {
  pointerId: number;
  x: number;
  y: number;
}

interface CommittedTrail {
  /** 画面正規化座標の点列 */
  points: Vec2[];
  bornAtMs: number;
  retraceStartedMs: number;
  crossing: boolean[];
  parallel: boolean[];
}

const audio = createAudioEngine();
const quality = new QualityController(PARTICLE_CAP_STEPS.length);
const frameCounter = createFrameCounter();

const hostEl = document.querySelector<HTMLDivElement>("#p5-host");
const glowHostEl = document.querySelector<HTMLDivElement>("#glow-host");
const gateEl = document.querySelector<HTMLDivElement>("#gate");
const debugOverlayEl = document.querySelector<HTMLPreElement>("#debug-overlay");
const isDebugMode = new URLSearchParams(location.search).has("debug");
if (isDebugMode && debugOverlayEl) debugOverlayEl.hidden = false;

let state: State = "intro";
let lastAmp = 0;
let lastError = "";

let stroke: Stroke | null = null;
let discardDeadlineMs: number | null = null; // 満たない列を消し始める時刻
let settled: SettlingStroke | null = null;
let schedule: ChainSchedule | null = null;
let chainEvents: ChainEvent[] = [];
let chainDirectionFromEnd = false; // true = 列の終端側から倒す
let finaleAtMs: number | null = null; // 最後の板が床へ触れた（発光の起点）
let pulses: LightPulse[] = [];
let shockwaves: Shockwave[] = [];
let traceEchoes: TraceEcho[] = [];
let sleepingLights: SleepingLight[] = [];
let trails: CommittedTrail[] = [];
let introTiles: Domino[] = []; // 導入画面の休止中の板
let introFadeStartedMs: number | null = null;
let endpointFlashAtMs: { start: number; end: number } | null = null;
let pendingReplacement: PendingReplacement | null = null;
let floorLightCenter: Vec2 = { x: 0.5, y: 0.5 };

// リサイズで再構築するため正規化座標を保持する
let normalizedStrokePoints: Vec2[] | null = null;

/** 画面の補正領域（px）。入力はこの内側へ clamp する */
function inputBounds(width: number, height: number): { x: number; y: number; w: number; h: number } {
  const inset = Math.min(INPUT_EDGE_INSET_PX, Math.min(width, height) / 4);
  return { x: inset, y: inset, w: width - inset * 2, h: height - inset * 2 };
}

function clampToBounds(point: Vec2, bounds: { x: number; y: number; w: number; h: number }): Vec2 {
  return {
    x: Math.min(bounds.x + bounds.w, Math.max(bounds.x, point.x)),
    y: Math.min(bounds.y + bounds.h, Math.max(bounds.y, point.y)),
  };
}

function dominoSpacingPx(shortEdge: number): number {
  if (shortEdge <= 430) return 12;
  return Math.min(DOMINO_SPACING_MAX_PX, Math.max(DOMINO_SPACING_MIN_PX, shortEdge * DOMINO_SPACING_RATIO));
}

function tileLengthPx(shortEdge: number): number {
  return shortEdge <= 430 ? MOBILE_FALLEN_TILE_LENGTH_PX : FALLEN_TILE_LENGTH_PX;
}

/** 補正済みの点列から仮配置を作り直す（呼び出し側で発音を間引く） */
function rebuildPreviewDominoes(strokeRef: Stroke, width: number, height: number): void {
  const bounds = inputBounds(width, height);
  const clamped = strokeRef.rawPoints.map((point) => clampToBounds(point, bounds));
  const smoothed = smoothPoints(clamped, SMOOTHING_WINDOW_POINTS);
  const spacing = dominoSpacingPx(Math.min(width, height));
  const resampled = resampleByArcLength(smoothed, spacing);
  strokeRef.dominoes = buildDominoes(resampled, width, height, strokeRef.bornAtMs).slice(0, MAX_DOMINOES);
}

/** 指を離した時の最終補正。仮配置より滑らかな列を作る */
function finalDominoesFromRaw(rawPoints: readonly Vec2[], width: number, height: number): Domino[] {
  const bounds = inputBounds(width, height);
  const clamped = rawPoints.map((point) => clampToBounds(point, bounds));
  const smoothed = smoothPoints(clamped, SMOOTHING_WINDOW_POINTS);
  const spacing = dominoSpacingPx(Math.min(width, height));
  const resampled = resampleByArcLength(smoothed, spacing);
  return buildDominoes(resampled, width, height, performance.now()).slice(0, MAX_DOMINOES);
}

/** 端（始端 / 終端）のヒット半径（px） */
function endpointHitRadiusPx(width: number, height: number): number {
  return Math.max(ENDPOINT_HIT_MIN_PX, tileLengthPx(Math.min(width, height)) * ENDPOINT_HIT_RATIO);
}

/** 正規化済みの板中心を現在の px 空間へ戻し、板数と順序を保ったまま接線を再計算する */
function dominoesFromNormalizedPoints(points: readonly Vec2[], width: number, height: number): Domino[] {
  const bounds = inputBounds(width, height);
  const pixelPoints = points.map((point) => clampToBounds({ x: point.x * width, y: point.y * height }, bounds));
  return buildDominoes(pixelPoints, width, height, performance.now()).slice(0, MAX_DOMINOES);
}

/** 列の両端の画面座標（px）。空列は入力処理と描画を止めずに無視する */
function endpointPositions(settledStroke: SettlingStroke, width: number, height: number): { start: Vec2; end: Vec2 } | null {
  const first = settledStroke.dominoes[0];
  const last = settledStroke.dominoes[settledStroke.dominoes.length - 1];
  if (!first || !last) return null;
  return {
    start: { x: first.nx * width, y: first.ny * height },
    end: { x: last.nx * width, y: last.ny * height },
  };
}

function setStage(next: State): void {
  state = next;
}

/** 導入画面の休止中の板（少数を静かに置く） */
function buildIntroTiles(width: number, height: number): Domino[] {
  const spacing = dominoSpacingPx(Math.min(width, height));
  const cx = width / 2;
  const cy = height * 0.62;
  const count = 5;
  const points: Vec2[] = [];
  for (let index = 0; index < count; index++) {
    const t = (index - (count - 1) / 2) * spacing * 1.35;
    points.push({ x: cx + t, y: cy + Math.sin(index * 0.9) * spacing * 0.35 });
  }
  return buildDominoes(points, width, height, 0);
}

/** リサイズしても配置の物語が変わらない決定的な「眠る光」。 */
function buildSleepingLights(): SleepingLight[] {
  const count = SLEEPING_LIGHT_COUNT_MIN + 3;
  return Array.from({ length: Math.min(count, SLEEPING_LIGHT_COUNT_MAX) }, (_, index) => {
    const column = index % 5;
    const row = Math.floor(index / 5);
    return {
      nx: 0.12 + column * 0.19 + ((row * 0.037 + index * 0.013) % 0.055),
      ny: 0.12 + row * 0.19 + ((column * 0.041 + index * 0.017) % 0.075),
      radius: 1 + (index % 3) * 0.45,
      phase: (index * 1.618) % (Math.PI * 2),
      periodMs: SLEEPING_LIGHT_PERIOD_MIN_MS +
        (index / Math.max(1, count - 1)) * (SLEEPING_LIGHT_PERIOD_MAX_MS - SLEEPING_LIGHT_PERIOD_MIN_MS),
      awakenedAtMs: null,
    };
  });
}

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
    dominoes: settled ? settled.dominoes.length : stroke ? stroke.dominoes.length : 0,
    trails: trails.length,
    lastError,
    ...audio.getDiagnostics(),
  };
  debugOverlayEl.textContent = Object.entries(snapshot)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

P5.disableFriendlyErrors = true;

new P5((p: P5) => {
  let glowCanvas: HTMLCanvasElement | null = null;
  let trailCanvas: HTMLCanvasElement | null = null;

  const ensureLayers = (): void => {
    // グローは縮小キャンバスを別 DOM レイヤーへ置き、CSS 拡大で柔らかくする。
    if (!glowCanvas && glowHostEl) {
      glowCanvas = document.createElement("canvas");
      glowHostEl.appendChild(glowCanvas);
    }
    if (glowCanvas) {
      const width = Math.max(1, Math.floor(p.width / GLOW_CANVAS_DIVISOR));
      const height = Math.max(1, Math.floor(p.height / GLOW_CANVAS_DIVISOR));
      if (glowCanvas.width !== width || glowCanvas.height !== height) {
        glowCanvas.width = width;
        glowCanvas.height = height;
      }
    }
    if (!trailCanvas) trailCanvas = document.createElement("canvas");
    if (trailCanvas.width !== p.width || trailCanvas.height !== p.height) {
      trailCanvas.width = p.width;
      trailCanvas.height = p.height;
    }
  };

  /** 蕊と節点を永続する星図レイヤーへ焼き付ける。 */
  const repaintTrailLayer = (): void => {
    if (!trailCanvas) return;
    const trailCtx = trailCanvas.getContext("2d");
    if (!trailCtx) return;
    trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    trailCtx.lineCap = "round";
    trailCtx.lineJoin = "round";
    trailCtx.strokeStyle = PALETTE_GOLD;
    let nodeCount = 0;
    for (const trail of trails) {
      trailCtx.globalAlpha = trails.length > 8 ? 0.8 : 1;
      trailCtx.lineWidth = TRAIL_WIDTH_PX;
      trailCtx.beginPath();
      trail.points.forEach((point, index) => {
        const x = point.x * p.width;
        const y = point.y * p.height;
        if (index === 0) trailCtx.moveTo(x, y);
        else trailCtx.lineTo(x, y);
      });
      trailCtx.stroke();
      for (let index = 0; index < trail.points.length; index++) {
        const point = trail.points[index];
        if (trail.crossing[index]) continue;
        if (nodeCount >= MAX_LIVE_NODES) break;
        const x = point.x * p.width;
        const y = point.y * p.height;
        trailCtx.globalAlpha = NODE_HALO_ALPHA;
        trailCtx.fillStyle = PALETTE_GOLD;
        trailCtx.beginPath();
        trailCtx.arc(x, y, NODE_HALO_RADIUS_PX, 0, Math.PI * 2);
        trailCtx.fill();
        trailCtx.globalAlpha = 1;
        trailCtx.beginPath();
        trailCtx.arc(x, y, NODE_RADIUS_PX, 0, Math.PI * 2);
        trailCtx.fill();
        nodeCount++;
      }
    }
    trailCtx.globalAlpha = 1;
  };

  const rebuildAfterResize = (): void => {
    // 正規化座標を現在の px 空間へ戻してから、現在列と確定光跡を再構築する。
    if (settled && normalizedStrokePoints) {
      const rebuilt = dominoesFromNormalizedPoints(normalizedStrokePoints, p.width, p.height);
      const matchesChainSchedule = state !== "chain" || !schedule || rebuilt.length === schedule.fallAtMs.length;
      if (rebuilt.length > 0 && matchesChainSchedule) settled.dominoes = rebuilt;
    }
    if (stroke && normalizedStrokePoints) {
      stroke.rawPoints = normalizedStrokePoints.map((point) => ({ x: point.x * p.width, y: point.y * p.height }));
      rebuildPreviewDominoes(stroke, p.width, p.height);
    }
    repaintTrailLayer();
  };

  /** ポインタの現在位置をなぞりに記録する（間引き + 仮配置の更新） */
  const recordPointer = (x: number, y: number, force = false): void => {
    if (!stroke) return;
    const nowMs = performance.now();
    const last = stroke.rawPoints[stroke.rawPoints.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) < RAW_POINT_MIN_DISTANCE_PX) return;
    if (!force && nowMs - stroke.lastRecordedAtMs < RAW_POINT_MIN_INTERVAL_MS) return;
    stroke.lastRecordedAtMs = nowMs;
    stroke.rawPoints.push({ x, y });
    traceEchoes.push({ x, y, bornAtMs: nowMs });
    if (traceEchoes.length > 12) traceEchoes.shift();
    const before = stroke.dominoes.length;
    rebuildPreviewDominoes(stroke, p.width, p.height);
    normalizedStrokePoints = stroke.dominoes.map((domino) => ({ x: domino.nx, y: domino.ny }));
    // 新しい板が増えたときだけ小さな「カチ」を鳴らす（視覚配置は間引かない）
    if (stroke.dominoes.length > before) {
      audio.place(x / p.width, y / p.height);
    }
  };

  const beginTrace = (x: number, y: number): void => {
    stroke = { rawPoints: [{ x, y }], lastRecordedAtMs: performance.now(), dominoes: [], bornAtMs: performance.now() };
    normalizedStrokePoints = null;
    discardDeadlineMs = null;
    setStage("tracing");
  };

  /** 指を離した。有効列なら aligned へ、満たなければ穏やかに消す */
  const finishTrace = (): void => {
    if (!stroke) return;
    const rawPoints = stroke.rawPoints;
    const pxPoints = (() => {
      const bounds = inputBounds(p.width, p.height);
      return rawPoints.map((point) => clampToBounds(point, bounds));
    })();
    const lengthPx = pathLength(pxPoints);
    if (rawPoints.length >= 2 && lengthPx >= MIN_PATH_LENGTH_PX) {
      const dominoes = finalDominoesFromRaw(rawPoints, p.width, p.height);
      if (dominoes.length >= MIN_DOMINOES) {
        settled = { dominoes, alignedAtMs: performance.now(), goldThrough: -1 };
        normalizedStrokePoints = dominoes.map((domino) => ({ x: domino.nx, y: domino.ny }));
        stroke = null;
        audio.align(dominoes.length);
        setStage("aligned");
        return;
      }
    }
    // 満たない列は失敗扱いにせず 240ms で消す
    discardDeadlineMs = performance.now() + STROKE_DISCARD_MS;
    normalizedStrokePoints = null;
    setStage("tracing");
  };

  /** 端をタップした。連鎖を組み、音側に予約させ、スケジュールで視覚を進める */
  const beginChainFrom = (tapX: number, tapY: number): void => {
    if (!settled) return;
    const width = p.width;
    const height = p.height;
    const endpoints = endpointPositions(settled, width, height);
    if (!endpoints) return;
    const hit = endpointHitRadiusPx(width, height);
    const distStart = Math.hypot(tapX - endpoints.start.x, tapY - endpoints.start.y);
    const distEnd = Math.hypot(tapX - endpoints.end.x, tapY - endpoints.end.y);
    if (distStart > hit && distEnd > hit) return;
    chainDirectionFromEnd = distEnd <= distStart;

    const ordered = chainDirectionFromEnd ? [...settled.dominoes].reverse() : settled.dominoes;
    const pixelPoints = settled.dominoes.map((domino) => ({ x: domino.nx * width, y: domino.ny * height }));
    const existingPixelPaths = trails.map((trail) => trail.points.map((point) => ({ x: point.x * width, y: point.y * height })));
    const crossings = crossingFlags(pixelPoints);
    const parallels = parallelFlags(pixelPoints, existingPixelPaths, PARALLEL_RUN_MIN_GAP_PX);
    const orderedCrossings = chainDirectionFromEnd ? [...crossings].reverse() : crossings;
    const orderedParallels = chainDirectionFromEnd ? [...parallels].reverse() : parallels;
    chainEvents = ordered.map((domino, index) => {
      const pitch = pitchForChainIndex(index, ordered.length);
      return {
        x: domino.nx,
        y: domino.ny,
        midi: pitch.midi,
        velocity: velocityForInteraction(orderedCrossings[index] ?? false, orderedParallels[index] ?? false, trails.length > 0),
      };
    });
    schedule = audio.beginChain(chainEvents);
    settled.goldThrough = -1;
    finaleAtMs = null;
    setStage("chain");
  };

  const commitTrailAndSparks = (): void => {
    if (!settled || !normalizedStrokePoints) return;
    const nowMs = performance.now();
    const pixelPoints = normalizedStrokePoints.map((point) => ({ x: point.x * p.width, y: point.y * p.height }));
    const existingPixelPaths = trails.map((trail) => trail.points.map((point) => ({ x: point.x * p.width, y: point.y * p.height })));
    trails.push({
      points: normalizedStrokePoints.map((point) => ({ x: point.x, y: point.y })),
      bornAtMs: nowMs,
      retraceStartedMs: nowMs,
      crossing: crossingFlags(pixelPoints),
      parallel: parallelFlags(pixelPoints, existingPixelPaths, PARALLEL_RUN_MIN_GAP_PX),
    });
    // 既存契約どおり trail の保持単位は最大 24。本数を超えても現在の星図は 24 本分残る。
    if (trails.length > MAX_COMMITTED_TRAILS) trails.shift();
    repaintTrailLayer();

    const endpoint = normalizedStrokePoints[normalizedStrokePoints.length - 1];
    shockwaves.push({ x: endpoint.x * p.width, y: endpoint.y * p.height, bornAtMs: nowMs });
  };

  p.setup = () => {
    const canvas = p.createCanvas(window.innerWidth, window.innerHeight);
    if (hostEl) canvas.parent(hostEl);
    // p5 v2 の既知の制約: pixelDensity は createCanvas の後に呼ぶ
    p.pixelDensity(1);
    introTiles = buildIntroTiles(p.width, p.height);
    sleepingLights = buildSleepingLights();
    ensureLayers();

    const resize = (): void => {
      p.resizeCanvas(window.innerWidth, window.innerHeight);
      introTiles = buildIntroTiles(p.width, p.height);
      ensureLayers();
      rebuildAfterResize();
    };
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("contextmenu", (event) => event.preventDefault());

    // ---- ポインタ入力（主ポインタ 1 本だけ。タッチ・マウス統一）----
    window.addEventListener(
      "pointerdown",
      (event: PointerEvent) => {
        if (!event.isPrimary) return;
        const x = event.clientX;
        const y = event.clientY;
        if (state === "intro") {
          // 最初の接触に近い 3 点が文字より先に目覚める。
          const nearest = sleepingLights
            .map((light, index) => ({ index, distance: Math.hypot(light.nx * p.width - x, light.ny * p.height - y) }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 3);
          for (const item of nearest) sleepingLights[item.index].awakenedAtMs = performance.now();
          // 最初のタップは道の始点にしない。オーバーレイを消して音を配線する
          gateEl?.classList.add("is-hidden");
          introFadeStartedMs = performance.now();
          // resume() の解決を待たない。音の成否に関わらず描画は続ける
          audio.start().catch((error: unknown) => {
            lastError = error instanceof Error ? error.message : String(error);
          });
          setStage("tracing");
          return;
        }
        if (state === "tracing") {
          if (y > p.height - IGNORE_BAND_BOTTOM_PX) return;
          beginTrace(x, y);
          return;
        }
        if (state === "aligned" && settled) {
          const endpoints = endpointPositions(settled, p.width, p.height);
          if (!endpoints) return;
          const hit = endpointHitRadiusPx(p.width, p.height);
          const distStart = Math.hypot(x - endpoints.start.x, y - endpoints.start.y);
          const distEnd = Math.hypot(x - endpoints.end.x, y - endpoints.end.y);
          if (distStart <= hit || distEnd <= hit) {
            pendingReplacement = null;
            beginChainFrom(x, y);
          } else {
            // 単なる誤タップとドラッグ置換を、移動距離が確定するまで区別しない
            pendingReplacement = { pointerId: event.pointerId, x, y };
          }
          return;
        }
        if (state === "finale" && !settled && !schedule) {
          // 光跡は残したまま次の道を描ける。開花中は入力を受けない。
          beginTrace(x, y);
        }
        // chain 状態では入力を受けない（タイムラインは中断しない）
      },
      { passive: true },
    );

    window.addEventListener(
      "pointermove",
      (event: PointerEvent) => {
        if (!event.isPrimary) return;
        if (state === "aligned" && settled && pendingReplacement?.pointerId === event.pointerId) {
          const distance = Math.hypot(event.clientX - pendingReplacement.x, event.clientY - pendingReplacement.y);
          if (distance < DRAG_START_DISTANCE_PX) return;
          const start = { x: pendingReplacement.x, y: pendingReplacement.y };
          pendingReplacement = null;
          endpointFlashAtMs = null;
          settled = null;
          beginTrace(start.x, start.y);
          recordPointer(event.clientX, event.clientY, true);
          return;
        }
        if (state !== "tracing" || !stroke) return;
        recordPointer(event.clientX, event.clientY);
      },
      { passive: true },
    );

    const releasePointer = (event: PointerEvent, flashMisTap: boolean): void => {
      if (!event.isPrimary) return;
      if (state === "aligned" && pendingReplacement?.pointerId === event.pointerId) {
        pendingReplacement = null;
        if (flashMisTap) {
          const nowMs = performance.now();
          endpointFlashAtMs = { start: nowMs, end: nowMs + ENDPOINT_FLASH_MS };
        }
        return;
      }
      if (state === "tracing" && stroke) finishTrace();
    };
    window.addEventListener("pointerup", (event) => releasePointer(event, true), { passive: true });
    window.addEventListener("pointercancel", (event) => releasePointer(event, false), { passive: true });

    window.addEventListener("dragstart", (event) => event.preventDefault());
  };

  p.draw = () => {
    const drawStartMs = performance.now();
    const nowMs = drawStartMs;
    quality.recordFrame(Math.min(p.deltaTime || 16.7, 100));
    lastAmp = audio.getAmp();
    ensureLayers();
    const ctx = p.drawingContext;

    if (discardDeadlineMs !== null && nowMs >= discardDeadlineMs && stroke) {
      stroke = null;
      discardDeadlineMs = null;
    }
    if ((state === "chain" || state === "finale") && schedule && settled) {
      const previous = settled.goldThrough;
      let next = previous;
      while (next + 1 < schedule.fallAtMs.length && nowMs >= schedule.fallAtMs[next + 1]) next++;
      if (next > previous) {
        const ordered = chainDirectionFromEnd ? [...settled.dominoes].reverse() : settled.dominoes;
        for (let index = previous + 1; index <= next; index++) {
          const domino = ordered[index];
          if (domino) pulses.push({ x: domino.nx * p.width, y: domino.ny * p.height, bornAtMs: schedule.fallAtMs[index] });
        }
        pulses = pulses.slice(-PULSE_MAX_CONCURRENT);
        const recent = ordered.slice(Math.max(0, next - CHAIN_LIGHT_RECENT_TILES + 1), next + 1);
        if (recent.length > 0) {
          const target = recent.reduce((sum, domino) => ({ x: sum.x + domino.nx, y: sum.y + domino.ny }), { x: 0, y: 0 });
          const smoothing = Math.min(1, p.deltaTime / CHAIN_LIGHT_SLIDE_MS);
          floorLightCenter.x += (target.x / recent.length - floorLightCenter.x) * smoothing;
          floorLightCenter.y += (target.y / recent.length - floorLightCenter.y) * smoothing;
        }
      }
      settled.goldThrough = next;
      if (finaleAtMs === null && nowMs >= schedule.finaleAtMs) {
        finaleAtMs = schedule.finaleAtMs;
        setStage("finale");
      }
      if (nowMs >= schedule.settleAtMs) {
        commitTrailAndSparks();
        settled = null;
        normalizedStrokePoints = null;
        schedule = null;
        chainEvents = [];
        setStage("finale");
      }
    }

    const chainProgress = settled && schedule
      ? Math.max(0, settled.goldThrough + 1) / Math.max(1, settled.dominoes.length)
      : 0;
    const mixChannel = (start: number, end: number, amount: number): number => Math.round(start + (end - start) * amount);
    const glowColor = `rgb(${mixChannel(26, 42, chainProgress)}, ${mixChannel(31, 38, chainProgress)}, ${mixChannel(41, 32, chainProgress)})`;

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE_BACKGROUND;
    ctx.fillRect(0, 0, p.width, p.height);
    const floorX = floorLightCenter.x * p.width;
    const floorY = floorLightCenter.y * p.height;
    const radius = Math.min(p.width, p.height) * FLOOR_GLOW_RADIUS_RATIO;
    const floorGlow = ctx.createRadialGradient(floorX, floorY, 0, floorX, floorY, Math.max(1, radius));
    floorGlow.addColorStop(0, glowColor);
    floorGlow.addColorStop(1, "rgba(17, 19, 24, 0)");
    ctx.globalAlpha = FLOOR_GLOW_ALPHA_START + (FLOOR_GLOW_ALPHA_END - FLOOR_GLOW_ALPHA_START) * chainProgress;
    ctx.fillStyle = floorGlow;
    const portraitScaleY = p.height > p.width ? 4 / 3 : 1;
    ctx.save();
    ctx.translate(floorX, floorY);
    ctx.scale(1, portraitScaleY);
    ctx.translate(-floorX, -floorY);
    ctx.fillRect(0, 0, p.width, p.height / portraitScaleY);
    ctx.restore();
    const gridSpacing = p.width <= 430 ? MOBILE_FLOOR_GUIDE_SPACING_PX : FLOOR_GUIDE_SPACING_PX;
    ctx.globalAlpha = FLOOR_GUIDE_ALPHA;
    ctx.strokeStyle = PALETTE_TILE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = gridSpacing / 2; x < p.width; x += gridSpacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, p.height);
    }
    for (let y = gridSpacing / 2; y < p.height; y += gridSpacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(p.width, y);
    }
    ctx.stroke();
    ctx.restore();

    if (trailCanvas) ctx.drawImage(trailCanvas, 0, 0);

    const glowCtx = glowCanvas?.getContext("2d") ?? null;
    if (glowCtx && glowCanvas) glowCtx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
    const glowGoldPath = (points: readonly Vec2[], alpha: number, widthPx = 24, fraction = 1): void => {
      if (!glowCtx || !glowCanvas || points.length < 2 || alpha <= 0) return;
      const count = Math.max(2, Math.ceil(points.length * Math.min(1, Math.max(0, fraction))));
      glowCtx.save();
      glowCtx.globalCompositeOperation = "lighter";
      glowCtx.globalAlpha = Math.min(0.12, alpha);
      glowCtx.strokeStyle = PALETTE_GOLD;
      glowCtx.lineWidth = widthPx / GLOW_CANVAS_DIVISOR;
      glowCtx.lineCap = "round";
      glowCtx.lineJoin = "round";
      glowCtx.beginPath();
      points.slice(0, count).forEach((point, index) => {
        const x = (point.x * p.width) / GLOW_CANVAS_DIVISOR;
        const y = (point.y * p.height) / GLOW_CANVAS_DIVISOR;
        if (index === 0) glowCtx.moveTo(x, y);
        else glowCtx.lineTo(x, y);
      });
      glowCtx.stroke();
      glowCtx.restore();
    };
    const newestTrail = trails[trails.length - 1];
    if (newestTrail) {
      const afterglow = Math.max(0, 1 - (nowMs - newestTrail.bornAtMs) / AFTERGLOW_FADE_MS);
      if (newestTrail.parallel.some((isParallel) => !isParallel)) {
        glowGoldPath(newestTrail.points, FALLEN_GLOW_REST_ALPHA * afterglow, 18);
      }
      const retrace = Math.min(1, (nowMs - newestTrail.retraceStartedMs) / COMMIT_RETRACE_MS);
      if (retrace < 1) glowGoldPath([...newestTrail.points].reverse(), 0.08 * (1 - retrace), 10, retrace);
    }

    ctx.save();
    const vignetteRadius = Math.hypot(p.width, p.height) * 0.56;
    const vignette = ctx.createRadialGradient(p.width / 2, p.height / 2, Math.min(p.width, p.height) * 0.18, p.width / 2, p.height / 2, vignetteRadius);
    vignette.addColorStop(0, "rgba(17, 19, 24, 0)");
    vignette.addColorStop(0.72, "rgba(17, 19, 24, 0.12)");
    vignette.addColorStop(1, "rgba(17, 19, 24, 0.68)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, p.width, p.height);
    ctx.restore();

    const introVisibility = introFadeStartedMs === null ? 1 : Math.max(0, 1 - (nowMs - introFadeStartedMs) / INTRO_FADE_MS);
    if (introVisibility > 0) {
      for (const light of sleepingLights) {
        const wave = 0.7 + 0.3 * Math.sin((nowMs / light.periodMs) * Math.PI * 2 + light.phase);
        const awakened = light.awakenedAtMs !== null && nowMs - light.awakenedAtMs < 500 ? 1 : 0;
        const x = light.nx * p.width;
        const y = light.ny * p.height;
        ctx.save();
        ctx.fillStyle = PALETTE_GOLD;
        ctx.globalAlpha = introVisibility * Math.min(0.9, 0.5 + 0.35 * wave + 0.2 * awakened);
        ctx.beginPath();
        ctx.arc(x, y, light.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = introVisibility * SLEEPING_GLOW_ALPHA;
        ctx.beginPath();
        ctx.arc(x, y, light.radius * 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    const mobile = p.width <= 430;
    const tileWidth = mobile ? MOBILE_TILE_WIDTH_PX : TILE_WIDTH_PX;
    const portrait = p.height > p.width ? PORTRAIT_SCALE : 1;
    const tileDepth = (mobile ? MOBILE_TILE_DEPTH_PX : TILE_DEPTH_PX) * portrait;
    const fallenLength = (mobile ? MOBILE_FALLEN_TILE_LENGTH_PX : FALLEN_TILE_LENGTH_PX) * portrait;
    const hushStartMs = schedule ? schedule.hushAtMs : Number.POSITIVE_INFINITY;

    const glowDomino = (domino: Domino, alpha: number, length: number): void => {
      if (!glowCtx || !glowCanvas || alpha <= 0) return;
      glowCtx.save();
      glowCtx.globalCompositeOperation = "lighter";
      glowCtx.globalAlpha = Math.min(0.12, alpha);
      glowCtx.fillStyle = PALETTE_GOLD;
      glowCtx.translate((domino.nx * p.width) / GLOW_CANVAS_DIVISOR, (domino.ny * p.height) / GLOW_CANVAS_DIVISOR);
      glowCtx.rotate(Math.atan2(domino.ty, domino.tx));
      glowCtx.fillRect(-length / GLOW_CANVAS_DIVISOR / 2, -5 / GLOW_CANVAS_DIVISOR, length / GLOW_CANVAS_DIVISOR, 10 / GLOW_CANVAS_DIVISOR);
      glowCtx.restore();
    };

    const drawDomino = (domino: Domino, color: string, alpha: number, fallMsOffset: number | null, preview = false, emphasis = 0): void => {
      const x = domino.nx * p.width;
      const y = domino.ny * p.height;
      const progress = fallMsOffset === null ? (color === PALETTE_GOLD ? 1 : 0) : fallProgress(fallMsOffset, FALL_MS);
      const length = tileWidth + (fallenLength - tileWidth) * progress;
      const depth = Math.max(1.5, tileDepth * (1 - progress * 0.72));
      const angle = Math.atan2(domino.ty, domino.tx) + Math.PI / 2;
      const shadowX = 3 * (1 - progress);
      const shadowY = 4 + 4 * progress;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      if (!preview) {
        ctx.globalAlpha = alpha * SHADOW_ALPHA * (1 - progress * 0.7);
        ctx.fillStyle = PALETTE_BACKGROUND;
        ctx.fillRect(-length / 2 + shadowX, -depth / 2 + shadowY, length + 2, depth + 2);
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fillRect(-length / 2 - emphasis, -depth / 2, length + emphasis * 2, depth);
      if (!preview && progress < 0.6) {
        ctx.globalAlpha = alpha * TILE_SIDE_BAND_ALPHA;
        ctx.fillStyle = PALETTE_TILE;
        ctx.fillRect(-length / 2, depth / 2, length, 2);
        ctx.globalAlpha = alpha * TILE_OUTLINE_ALPHA;
        ctx.strokeStyle = PALETTE_BACKGROUND;
        ctx.lineWidth = 1;
        ctx.strokeRect(-length / 2, -depth / 2, length, depth);
      }
      if (!preview) {
        ctx.globalAlpha = alpha * EDGE_REFLECTION_ALPHA;
        ctx.strokeStyle = PALETTE_TILE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-length / 2, -depth / 2);
        ctx.lineTo(-length / 2, depth / 2);
        ctx.moveTo(length / 2, -depth / 2);
        ctx.lineTo(length / 2, depth / 2);
        ctx.stroke();
      }
      ctx.restore();
      if (color === PALETTE_GOLD) {
        const rest = progress >= 1 ? FALLEN_GLOW_REST_ALPHA : FALLEN_GLOW_ALPHA;
        glowDomino(domino, rest, length + 8);
      }
    };

    if (introTiles.length > 0 && introVisibility > 0) {
      for (const domino of introTiles) drawDomino(domino, PALETTE_TILE, introVisibility * 0.42, null);
    } else if (introVisibility <= 0) {
      introTiles = [];
    }

    traceEchoes = traceEchoes.filter((echo) => nowMs - echo.bornAtMs < TRACING_ECHO_MS);
    for (const echo of traceEchoes) {
      const life = 1 - (nowMs - echo.bornAtMs) / TRACING_ECHO_MS;
      ctx.save();
      ctx.globalAlpha = TRACING_ECHO_ALPHA * life;
      ctx.fillStyle = PALETTE_TILE;
      ctx.beginPath();
      ctx.arc(echo.x, echo.y, TRACING_ECHO_RADIUS_PX, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (stroke && stroke.dominoes.length > 0) {
      const previewDominoes = stroke.dominoes;
      // 満たない列は破棄時刻までの 240ms で alpha を 0 へフェードさせてから捨てる（正本 §3.2）
      const discardFade = discardDeadlineMs === null ? 1 : Math.max(0, (discardDeadlineMs - nowMs) / STROKE_DISCARD_MS);
      const headStart = Math.max(0, previewDominoes.length - 3);
      previewDominoes.forEach((domino, index) => {
        const head = index >= headStart ? (index - headStart + 1) / Math.max(1, previewDominoes.length - headStart) : 0;
        const alpha = (TRACING_TILE_ALPHA + (TRACING_TILE_HEAD_ALPHA - TRACING_TILE_ALPHA) * head) * discardFade;
        drawDomino(domino, PALETTE_TILE, alpha, null, true);
      });
    }

    if (settled) {
      const dominoes = settled.dominoes;
      for (let index = 0; index < dominoes.length; index++) {
        const domino = dominoes[index];
        let color = PALETTE_TILE;
        let alpha = schedule ? 0.9 + 0.1 * chainProgress : 0.95;
        let fallOffset: number | null = null;
        const orderIndex = chainDirectionFromEnd ? dominoes.length - 1 - index : index;
        if (schedule && orderIndex <= settled.goldThrough) {
          const sinceFall = nowMs - (schedule.fallAtMs[orderIndex] ?? nowMs);
          fallOffset = Math.max(0, Math.min(FALL_MS, sinceFall));
          color = sinceFall >= FALL_MS * (2 / 3) ? PALETTE_GOLD : PALETTE_TILE;
          if (sinceFall >= FALL_MS) fallOffset = null;
          if (nowMs >= hushStartMs && nowMs < schedule.finaleAtMs) alpha *= HUSH_GLOW_DIM;
        }
        let emphasis = 0;
        if (state === "aligned") {
          const count = mobile ? MOBILE_ENDPOINT_BLINK_TILES : ENDPOINT_BLINK_TILES;
          const endpointDistance = Math.min(index, dominoes.length - 1 - index);
          if (endpointDistance < count) {
            const phase = (nowMs - endpointDistance * ENDPOINT_BLINK_PHASE_STAGGER_MS) / 1000;
            const blink = 0.5 + 0.5 * Math.sin(phase * ENDPOINT_BLINK_HZ_ALIGNED * Math.PI * 2);
            alpha = 0.85 + 0.15 * blink;
            emphasis = blink;
            if (endpointFlashAtMs && nowMs >= endpointFlashAtMs.start && nowMs < endpointFlashAtMs.end) {
              alpha = 1;
              emphasis += 1;
            }
          }
        }
        drawDomino(domino, color, alpha, fallOffset, false, emphasis);
      }
      if (endpointFlashAtMs && nowMs >= endpointFlashAtMs.end) endpointFlashAtMs = null;
    }

    pulses = pulses.filter((pulse) => nowMs - pulse.bornAtMs < FALL_MS);
    for (const pulse of pulses) {
      const progress = Math.min(1, (nowMs - pulse.bornAtMs) / FALL_MS);
      const startRadius = mobile ? MOBILE_PULSE_START_RADIUS_PX : PULSE_START_RADIUS_PX;
      const endRadius = mobile ? MOBILE_PULSE_END_RADIUS_PX : PULSE_END_RADIUS_PX;
      ctx.save();
      ctx.globalAlpha = 0.1 * (1 - progress);
      ctx.fillStyle = PALETTE_GOLD;
      ctx.beginPath();
      ctx.arc(pulse.x, pulse.y, startRadius + (endRadius - startRadius) * progress, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (finaleAtMs !== null && settled && normalizedStrokePoints) {
      const elapsed = nowMs - finaleAtMs - FINALE_BLOOM_DELAY_MS;
      if (elapsed >= 0 && elapsed <= FINALE_BLOOM_MS) {
        const bloom = Math.min(1, elapsed / FINALE_BLOOM_MS);
        glowGoldPath(
          normalizedStrokePoints,
          FINALE_BLOOM_GLOW_ALPHA * (0.65 + 0.35 * GLOW_PULSE_AMPLITUDE * lastAmp),
          FINALE_BLOOM_GLOW_WIDTH_PX,
          bloom,
        );
        const visibleCount = Math.max(2, Math.ceil(normalizedStrokePoints.length * bloom));
        ctx.save();
        ctx.strokeStyle = PALETTE_GOLD;
        ctx.globalAlpha = 0.92;
        ctx.lineWidth = FINALE_BLOOM_CORE_WIDTH_PX;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        normalizedStrokePoints.slice(0, visibleCount).forEach((point, index) => {
          const x = point.x * p.width;
          const y = point.y * p.height;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.restore();
      }
    }

    for (const shock of shockwaves) {
      const progress = (nowMs - shock.bornAtMs) / SHOCKWAVE_MS;
      if (progress < 0 || progress > 1) continue;
      ctx.save();
      ctx.globalAlpha = FINALE_SHOCKWAVE_ALPHA * (1 - progress);
      ctx.strokeStyle = PALETTE_GOLD;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(shock.x, shock.y, Math.min(p.width, p.height) * FINALE_SHOCKWAVE_RADIUS_RATIO * progress, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    shockwaves = shockwaves.filter((shock) => nowMs - shock.bornAtMs < SHOCKWAVE_MS);

    if (state === "aligned" || (state === "finale" && !settled && !schedule)) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = PALETTE_TILE;
      ctx.font = "13px Helvetica Neue, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(state === "aligned" ? "押す" : "重ねる", p.width / 2, p.height - Math.max(24, IGNORE_BAND_BOTTOM_PX / 2));
      ctx.restore();
    }

    frameCounter.record(performance.now() - drawStartMs);
    if (isDebugMode && p.frameCount % 6 === 0) renderDebugOverlay();
  };
});
