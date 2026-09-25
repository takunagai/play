// ============================================================
// main.ts ─ 状態機械・ポインタ入力・連鎖タイムライン・描画ループ（p5 インスタンスモード）
// 正本は docs/architecture.md。状態機械: intro → tracing → aligned → chain → finale
// 開発用クエリ: ?mute（無音）/ ?debug（診断オーバーレイ）
// ============================================================

import P5 from "p5";
import "./style.css";

import { fallProgress } from "./chain";
import { createFrameCounter, installArtHook } from "./art-hook";
import { buildDominoes, pathLength, resampleByArcLength, smoothPoints, type Domino, type Vec2 } from "./path";
import { pitchForProgress } from "./music";
import { QualityController } from "./quality";
import type { ChainEvent, ChainSchedule } from "./audio/engine";
import { createAudioEngine } from "./audio/engine";
import {
  DOMINO_SPACING_MAX_PX,
  DOMINO_SPACING_MIN_PX,
  DOMINO_SPACING_RATIO,
  ENDPOINT_BLINK_HZ,
  ENDPOINT_FLASH_MS,
  ENDPOINT_HIT_MIN_PX,
  ENDPOINT_HIT_RATIO,
  FALL_ANGLE_RAD,
  FALL_MS,
  FINALE_GLOW_MS,
  GLOW_CANVAS_DIVISOR,
  GLOW_FINALE_ALPHA,
  GLOW_PULSE_AMPLITUDE,
  GLOW_TILE_ALPHA,
  HUSH_GLOW_DIM,
  INPUT_EDGE_INSET_PX,
  INTRO_FADE_MS,
  MAX_COMMITTED_TRAILS,
  MAX_DOMINOES,
  MIN_DOMINOES,
  MIN_PATH_LENGTH_PX,
  PALETTE_BACKGROUND,
  PALETTE_GOLD,
  PALETTE_TILE,
  PARTICLE_CAP_STEPS,
  RAW_POINT_MIN_DISTANCE_PX,
  RAW_POINT_MIN_INTERVAL_MS,
  SHOCKWAVE_MS,
  SMOOTHING_WINDOW_POINTS,
  SPARK_LIFE_MAX_MS,
  SPARK_LIFE_MIN_MS,
  SPARK_SPEED_MAX_PX_S,
  SPARK_SPEED_MIN_PX_S,
  STROKE_DISCARD_MS,
  TILE_FADE_IN_MS,
  TILE_LENGTH_MAX_PX,
  TILE_LENGTH_MIN_PX,
  TILE_LENGTH_RATIO,
  TILE_THICKNESS_PX,
  TRAIL_FADE_MS,
  TRAIL_WIDTH_PX,
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

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bornAtMs: number;
  lifeMs: number;
}

interface Shockwave {
  x: number;
  y: number;
  bornAtMs: number;
}

interface CommittedTrail {
  /** 画面正規化座標の点列 */
  points: Vec2[];
  bornAtMs: number;
  fadingSinceMs: number | null;
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
let sparks: Spark[] = [];
let shockwaves: Shockwave[] = [];
let trails: CommittedTrail[] = [];
let introTiles: Domino[] = []; // 導入画面の休止中の板
let introFadeStartedMs: number | null = null;
let endpointFlashAtMs: { start: number; end: number } | null = null;

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
  return Math.min(DOMINO_SPACING_MAX_PX, Math.max(DOMINO_SPACING_MIN_PX, shortEdge * DOMINO_SPACING_RATIO));
}

function tileLengthPx(shortEdge: number): number {
  return Math.min(TILE_LENGTH_MAX_PX, Math.max(TILE_LENGTH_MIN_PX, shortEdge * TILE_LENGTH_RATIO));
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
  const count = 9;
  const points: Vec2[] = [];
  for (let index = 0; index < count; index++) {
    const t = (index - (count - 1) / 2) * spacing;
    points.push({ x: cx + t, y: cy + Math.sin(index * 0.9) * spacing * 0.35 });
  }
  return buildDominoes(points, width, height, 0);
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

new P5((p: P5) => {
  let glowCanvas: HTMLCanvasElement | null = null;
  let trailCanvas: HTMLCanvasElement | null = null;

  const ensureLayers = (): void => {
    // グローは縮小キャンバスを別 DOM レイヤーへ置き、CSS 拡大 + screen 合成でぼかす
    // （本体への加算はトレイルと帰還ループになり白飽和する。pitfalls.md）
    if (!glowCanvas && glowHostEl) {
      glowCanvas = document.createElement("canvas");
      glowCanvas.width = Math.max(1, Math.floor(p.width / GLOW_CANVAS_DIVISOR));
      glowCanvas.height = Math.max(1, Math.floor(p.height / GLOW_CANVAS_DIVISOR));
      glowHostEl.appendChild(glowCanvas);
    } else if (glowCanvas && (glowCanvas.width !== Math.floor(p.width / GLOW_CANVAS_DIVISOR) || glowCanvas.height !== Math.floor(p.height / GLOW_CANVAS_DIVISOR))) {
      glowCanvas.width = Math.max(1, Math.floor(p.width / GLOW_CANVAS_DIVISOR));
      glowCanvas.height = Math.max(1, Math.floor(p.height / GLOW_CANVAS_DIVISOR));
    }
    if (!trailCanvas) {
      trailCanvas = document.createElement("canvas");
      trailCanvas.width = p.width;
      trailCanvas.height = p.height;
      hostEl?.appendChild(trailCanvas);
    } else if (trailCanvas.width !== p.width || trailCanvas.height !== p.height) {
      // 同じ DOM canvas を再利用する。寸法変更で画素は消えるが、直後に正規化データから再描画する。
      trailCanvas.width = p.width;
      trailCanvas.height = p.height;
    }
  };

  /** 光跡レイヤーを確定曲線で塗る（resize / fade の再描画） */
  const repaintTrailLayer = (): void => {
    if (!trailCanvas) return;
    const ctx = trailCanvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = PALETTE_GOLD;
    for (const trail of trails) {
      let alpha = 1;
      if (trail.fadingSinceMs !== null) {
        alpha = Math.max(0, 1 - (performance.now() - trail.fadingSinceMs) / TRAIL_FADE_MS);
      }
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = TRAIL_WIDTH_PX;
      ctx.beginPath();
      trail.points.forEach((point, index) => {
        const x = point.x * p.width;
        const y = point.y * p.height;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (trail.points.length === 1) {
        const only = trail.points[0];
        ctx.lineTo(only.x * p.width + 0.01, only.y * p.height);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
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
  const recordPointer = (x: number, y: number): void => {
    if (!stroke) return;
    const nowMs = performance.now();
    const last = stroke.rawPoints[stroke.rawPoints.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) < RAW_POINT_MIN_DISTANCE_PX) return;
    if (nowMs - stroke.lastRecordedAtMs < RAW_POINT_MIN_INTERVAL_MS) return;
    stroke.lastRecordedAtMs = nowMs;
    stroke.rawPoints.push({ x, y });
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
    chainEvents = ordered.map((domino) => {
      const pitch = pitchForProgress(domino.progress);
      return { x: domino.nx, y: domino.ny, midi: pitch.midi, velocity: 0.85 };
    });
    schedule = audio.beginChain(chainEvents);
    settled.goldThrough = -1;
    finaleAtMs = null;
    setStage("chain");
  };

  const commitTrailAndSparks = (): void => {
    if (!settled || !normalizedStrokePoints) return;
    // 光跡を静的レイヤーへ焼き付ける
    trails.push({ points: normalizedStrokePoints.map((point) => ({ x: point.x, y: point.y })), bornAtMs: performance.now(), fadingSinceMs: null });
    if (trails.length > MAX_COMMITTED_TRAILS) {
      const oldest = trails[0];
      if (oldest.fadingSinceMs === null) oldest.fadingSinceMs = performance.now();
    }
    trails = trails.filter((trail) => trail.fadingSinceMs === null || performance.now() - trail.fadingSinceMs < TRAIL_FADE_MS);
    repaintTrailLayer();

    // 終演の衝撃波とスパークル
    const mid = normalizedStrokePoints[Math.floor(normalizedStrokePoints.length / 2)];
    shockwaves.push({ x: mid.x * p.width, y: mid.y * p.height, bornAtMs: performance.now() });
    const cap = PARTICLE_CAP_STEPS[quality.getLevel()];
    const originPoints = normalizedStrokePoints.filter((_, index) => index % Math.max(1, Math.ceil(normalizedStrokePoints!.length / cap)) === 0);
    for (const point of originPoints) {
      const angle = Math.random() * Math.PI * 2;
      const speed = SPARK_SPEED_MIN_PX_S + Math.random() * (SPARK_SPEED_MAX_PX_S - SPARK_SPEED_MIN_PX_S);
      sparks.push({
        x: point.x * p.width,
        y: point.y * p.height,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        bornAtMs: performance.now(),
        lifeMs: SPARK_LIFE_MIN_MS + Math.random() * (SPARK_LIFE_MAX_MS - SPARK_LIFE_MIN_MS),
      });
    }
    if (sparks.length > cap) sparks = sparks.slice(sparks.length - cap);
  };

  p.setup = () => {
    const canvas = p.createCanvas(window.innerWidth, window.innerHeight);
    if (hostEl) canvas.parent(hostEl);
    // p5 v2 の既知の制約: pixelDensity は createCanvas の後に呼ぶ
    p.pixelDensity(1);
    introTiles = buildIntroTiles(p.width, p.height);
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
            beginChainFrom(x, y);
          } else {
            // 誤タップ: 列は消さず、最寄りの端を一度だけ明るくする
            endpointFlashAtMs = { start: performance.now(), end: performance.now() + ENDPOINT_FLASH_MS };
          }
          return;
        }
        if (state === "finale") {
          // 光跡は残したまま次の道を描ける
          beginTrace(x, y);
        }
        // chain 状態では入力を受けない（タイムラインは中断しない）
      },
      { passive: true },
    );

    window.addEventListener(
      "pointermove",
      (event: PointerEvent) => {
        if (!event.isPrimary || state !== "tracing" || !stroke) return;
        // aligned で端以外を押して動いた場合は pointerdown 側で新しい列を開始する設計のため、
        // ここでは tracing 中の記録だけを見る
        recordPointer(event.clientX, event.clientY);
      },
      { passive: true },
    );

    const releasePointer = (event: PointerEvent): void => {
      if (!event.isPrimary) return;
      if (state === "tracing" && stroke) {
        // aligned からのドラッグ再開（aligned で端以外を押した場合）は
        // 誤タップ扱いで列を残す設計のため、ここでは tracing のみ扱う
        finishTrace();
      }
    };
    window.addEventListener("pointerup", releasePointer, { passive: true });
    window.addEventListener("pointercancel", releasePointer, { passive: true });

    window.addEventListener("dragstart", (event) => event.preventDefault());
  };

  p.draw = () => {
    const drawStartMs = performance.now();
    const nowMs = drawStartMs;
    quality.recordFrame(Math.min(p.deltaTime || 16.7, 100));
    lastAmp = audio.getAmp(); // analyser の読み出しは 1 フレーム 1 回

    ensureLayers();
    if (trails.some((trail) => trail.fadingSinceMs !== null)) {
      trails = trails.filter((trail) => trail.fadingSinceMs === null || nowMs - trail.fadingSinceMs < TRAIL_FADE_MS);
      repaintTrailLayer();
    }
    const ctx = p.drawingContext;

    // ---- 状態の進行 ----
    if (discardDeadlineMs !== null && nowMs >= discardDeadlineMs && stroke) {
      stroke = null;
      discardDeadlineMs = null;
    }
    if (state === "chain" && schedule && settled) {
      const idx = settled.goldThrough;
      let next = idx;
      while (next + 1 < schedule.fallAtMs.length && nowMs >= schedule.fallAtMs[next + 1]) next++;
      settled.goldThrough = next;
      if (finaleAtMs === null && nowMs >= schedule.finaleAtMs) {
        finaleAtMs = schedule.finaleAtMs;
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

    // ---- 1. 墨色の床（不透明・source-over）----
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE_BACKGROUND;
    ctx.fillRect(0, 0, p.width, p.height);
    ctx.restore();

    // ---- 2. 静的な光跡レイヤー（trail canvas は DOM で下に置く方式に変更）----
    // trailCanvas は p5 キャンバスの下に置くため、ここでは触らない

    // ---- 3. 板列 ----
    const shortEdge = Math.min(p.width, p.height);
    const tileLen = tileLengthPx(shortEdge);
    const glowCtx = glowCanvas?.getContext("2d") ?? null;
    if (glowCtx && glowCanvas) {
      glowCtx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
    }

    // 終演パルス（amp 0..1 で ±8%）。音→視覚の逆流線はこの 1 本
    let glowPulse = 1;
    if (finaleAtMs !== null) {
      const glowElapsed = nowMs - finaleAtMs;
      const rise = Math.min(1, glowElapsed / FINALE_GLOW_MS);
      glowPulse = (1 + GLOW_PULSE_AMPLITUDE * lastAmp * 2) * (0.4 + 0.6 * rise);
    }

    // 連鎖中の描画準備。hushAtMs は「間」の開始（最後の板の着地の 160ms 前）
    const hushStartMs = schedule ? schedule.hushAtMs : Number.POSITIVE_INFINITY;
    const finaleActive = finaleAtMs !== null && nowMs < (schedule?.settleAtMs ?? Number.POSITIVE_INFINITY);

    const drawDomino = (domino: Domino, color: string, alpha: number, fallMsOffset: number | null): void => {
      const x = domino.nx * p.width;
      const y = domino.ny * p.height;
      let angle = Math.atan2(domino.ty, domino.tx);
      let scaleX = 1;
      let scaleY = 1;
      if (fallMsOffset !== null) {
        // 倒れ: 接線方向へ中心をずらし、長さ方向を広げ、厚みを縮める
        const progress = fallProgress(fallMsOffset, FALL_MS);
        angle += FALL_ANGLE_RAD * progress;
        scaleX = 1 + 0.9 * progress;
        scaleY = Math.max(0.35, 1 - 0.65 * progress);
      }
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.scale(scaleX, scaleY);
      ctx.fillStyle = color;
      // 板は中心の周りに短冊（長さ × 厚み）。影を 1 本だけ添える
      if (fallMsOffset === null) {
        ctx.globalAlpha = alpha * 0.25;
        ctx.fillRect(-tileLen / 2 + 1.5, -TILE_THICKNESS_PX / 2 + 2, tileLen, TILE_THICKNESS_PX);
        ctx.globalAlpha = alpha;
      }
      ctx.fillRect(-tileLen / 2, -TILE_THICKNESS_PX / 2, tileLen, TILE_THICKNESS_PX);
      ctx.restore();
    };

    const glowTile = (domino: Domino, alpha: number, scale: number): void => {
      if (!glowCtx || !glowCanvas) return;
      const x = (domino.nx * p.width) / GLOW_CANVAS_DIVISOR;
      const y = (domino.ny * p.height) / GLOW_CANVAS_DIVISOR;
      glowCtx.save();
      glowCtx.globalCompositeOperation = "lighter";
      glowCtx.globalAlpha = alpha;
      glowCtx.fillStyle = PALETTE_TILE;
      const size = ((tileLen * 1.6) / GLOW_CANVAS_DIVISOR) * scale;
      glowCtx.beginPath();
      glowCtx.ellipse(x, y, size, (TILE_THICKNESS_PX * 1.6) / GLOW_CANVAS_DIVISOR + size * 0.25, Math.atan2(domino.ty, domino.tx), 0, Math.PI * 2);
      glowCtx.fill();
      glowCtx.restore();
    };

    const glowGoldPath = (points: readonly Vec2[], alpha: number): void => {
      if (!glowCtx || !glowCanvas) return;
      glowCtx.save();
      glowCtx.globalCompositeOperation = "lighter";
      glowCtx.globalAlpha = alpha;
      glowCtx.strokeStyle = PALETTE_GOLD;
      glowCtx.lineWidth = (TRAIL_WIDTH_PX * 2.5) / GLOW_CANVAS_DIVISOR;
      glowCtx.lineCap = "round";
      glowCtx.beginPath();
      points.forEach((point, index) => {
        const x = (point.x * p.width) / GLOW_CANVAS_DIVISOR;
        const y = (point.y * p.height) / GLOW_CANVAS_DIVISOR;
        if (index === 0) glowCtx.moveTo(x, y);
        else glowCtx.lineTo(x, y);
      });
      glowCtx.stroke();
      glowCtx.restore();
    };

    // 導入の板（フェードアウト）
    if (introTiles.length > 0 && introFadeStartedMs !== null) {
      const fade = Math.max(0, 1 - (nowMs - introFadeStartedMs) / INTRO_FADE_MS);
      if (fade <= 0) introTiles = [];
      else for (const domino of introTiles) drawDomino(domino, PALETTE_TILE, fade * 0.7, null);
    } else if (state === "intro") {
      for (const domino of introTiles) drawDomino(domino, PALETTE_TILE, 0.7, null);
    }

    // なぞり中の仮配置（温かい白。110ms で立ち上がる）
    if (stroke && stroke.dominoes.length > 0) {
      for (const domino of stroke.dominoes) {
        const appear = Math.min(1, (nowMs - domino.bornAtMs) / TILE_FADE_IN_MS);
        drawDomino(domino, PALETTE_TILE, 0.92 * appear, null);
      }
    }

    // aligned / chain の列
    if (settled) {
      const blink = 0.5 + 0.5 * Math.sin((nowMs / 1000) * ENDPOINT_BLINK_HZ * Math.PI * 2);
      const dominoes = settled.dominoes;
      const goldThrough = settled.goldThrough;
      for (let index = 0; index < dominoes.length; index++) {
        const domino = dominoes[index];
        let color = PALETTE_TILE;
        let alpha = 0.95;
        let fallOffset: number | null = null;
        if (goldThrough >= 0 && schedule) {
          // 連鎖中: goldThrough は「倒れ始めた板の最大 index（連鎖順）」
          const orderIndex = chainDirectionFromEnd ? dominoes.length - 1 - index : index;
          if (orderIndex <= goldThrough) {
            const fallStart = schedule.fallAtMs[orderIndex] ?? nowMs;
            const sinceFall = nowMs - fallStart;
            const isLast = orderIndex === schedule.fallAtMs.length - 1;
            if (isLast) {
              // 最後の 1 枚: finale（着地）で金へ開く。hush の間は白のまま倒れる
              if (nowMs < schedule.finaleAtMs) {
                fallOffset = Math.max(0, sinceFall);
                color = PALETTE_TILE;
              } else {
                color = PALETTE_GOLD;
              }
            } else if (sinceFall < FALL_MS) {
              // 倒れ始めは白、途中から金へ切り替わる
              fallOffset = sinceFall;
              color = sinceFall < FALL_MS * 0.4 ? PALETTE_TILE : PALETTE_GOLD;
            } else {
              color = PALETTE_GOLD;
            }
          }
          // hush の間は道の光量を少し引く（最後の板の直前の静けさ）
          if (nowMs >= hushStartMs && nowMs < schedule.finaleAtMs) {
            alpha *= HUSH_GLOW_DIM;
          }
        }
        drawDomino(domino, color, alpha, fallOffset);
        if (color === PALETTE_TILE && alpha > 0.5) glowTile(domino, GLOW_TILE_ALPHA * glowPulse, 1);
      }
      // 端の明滅（aligned のみ。chain 中は先頭が金に変わるので不要）
      if (state === "aligned") {
        const endpoints = endpointPositions(settled, p.width, p.height);
        const flashBoost = endpointFlashAtMs && nowMs >= endpointFlashAtMs.start && nowMs < endpointFlashAtMs.end ? 0.8 : 0;
        if (endpoints) {
          for (const point of [endpoints.start, endpoints.end]) {
            ctx.save();
            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = 0.25 + 0.55 * blink + flashBoost;
            ctx.fillStyle = PALETTE_TILE;
            ctx.beginPath();
            ctx.arc(point.x, point.y, tileLen * 0.42, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
        if (endpointFlashAtMs && nowMs >= endpointFlashAtMs.end) endpointFlashAtMs = null;
      }
    }

    // ---- 4. 終演の周辺光・衝撃波・スパークル ----
    if (finaleActive && settled && normalizedStrokePoints) {
      const glowElapsed = nowMs - (finaleAtMs ?? nowMs);
      const rise = Math.min(1, glowElapsed / FINALE_GLOW_MS);
      glowGoldPath(normalizedStrokePoints, GLOW_FINALE_ALPHA * rise * glowPulse);
    }
    if (finaleActive && finaleAtMs !== null) {
      const sinceFinale = nowMs - finaleAtMs;
      // 衝撃波（細い輪を 1 回だけ）
      sparks = sparks.filter((spark) => nowMs - spark.bornAtMs < spark.lifeMs);
      for (const shock of shockwaves) {
        const progress = (nowMs - shock.bornAtMs) / SHOCKWAVE_MS;
        if (progress < 0 || progress > 1) continue;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = (1 - progress) * 0.5;
        ctx.strokeStyle = PALETTE_TILE;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(shock.x, shock.y, 20 + 160 * (1 - Math.pow(1 - progress, 3)), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      shockwaves = shockwaves.filter((shock) => nowMs - shock.bornAtMs < SHOCKWAVE_MS);
      if (sinceFinale < 2000) {
        // スパークル（画質段で上限が変わる。2D context へ直接）
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (const spark of sparks) {
          const age = (nowMs - spark.bornAtMs) / spark.lifeMs;
          const x = spark.x + spark.vx * (sinceFinale / 1000);
          const y = spark.y + spark.vy * (sinceFinale / 1000);
          ctx.globalAlpha = (1 - age) * 0.7;
          ctx.fillStyle = PALETTE_GOLD;
          ctx.fillRect(x, y, 1.6, 1.6);
        }
        ctx.restore();
      }
    }

    // ---- glow canvas の合成は CSS（mix-blend-mode: screen）で行う ----

    // ---- 5. 導入 UI は DOM（#gate）。?debug 診断 ----
    frameCounter.record(performance.now() - drawStartMs);
    if (isDebugMode && p.frameCount % 6 === 0) renderDebugOverlay();
  };
});
