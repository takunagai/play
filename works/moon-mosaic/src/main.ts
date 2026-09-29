// ============================================================
// main.ts ─ 状態機械・Pointer Events・描画ループ・完成タイムライン（p5 インスタンスモード）
// 正本: docs/architecture.md。状態: intro → gathering → hush(150ms) → reveal → sway → spawning → gathering
// 開発用クエリ: ?mute（無音）/ ?debug（診断オーバーレイ）
// ============================================================

import P5 from "p5";
import "./style.css";

import { createAudioEngine, type AudioEngine, type CompletionSchedule } from "./audio/engine";
import { createFrameCounter, installArtHook } from "./art-hook";
import { Fragment, clamp, lerp, makeRandom } from "./fragment";
import { midiForCollected } from "./music";
import { QualityController } from "./quality";
import {
  DRIFT_AMPLITUDE_PX,
  EIGHTH_BPM,
  FRAGMENT_AREA_DIVISOR,
  FRAGMENT_COUNT,
  FRAGMENT_EDGE_ALPHA,
  FRAGMENT_EDGE_WIDTH_PX,
  FRAGMENT_SHADOW_ALPHA,
  FRAGMENT_SHADOW_OFFSET_PX,
  INTRO_EMPTY_MOON_RATIO,
  INTRO_EXIT_MS,
  MOBILE_SIZE_SCALE,
  MOON_DIAMETER_MAX_PX,
  MOON_DIAMETER_MIN_PX,
  MOON_DIAMETER_RATIO,
  MOON_PULSE_RATIO,
  PALETTE_INK,
  PALETTE_SILVER,
  PALETTE_WATER,
  POINTER_IDLE_TIMEOUT_MS,
  POINTER_SPEED_EMA_ALPHA,
  POINTER_SPEED_FAST_PX_S,
  REDUCED_MOTION_AMPLITUDE_PX,
  REDUCED_MOTION_SPEED_SCALE,
  RIPPLE_ALPHA_MAX,
  RIPPLE_ALPHA_MIN,
  RIPPLE_CAP_STEPS,
  RIPPLE_LIFE_MS,
  RIPPLE_MAX_RADIUS_RATIO,
  RING_TRAVEL_MS,
  SEAM_FADE_MS,
  SPAWN_MS,
  STARPATH_ALPHA_NEW,
  STARPATH_ALPHA_OLD,
  STARPATH_CORE_ALPHA,
  STARPATH_CORE_WIDTH_PX,
  STARPATH_MAX,
  STARPATH_NODE_RADIUS_PX,
  SWAY_AMPLITUDE_PX,
  SWAY_SPATIAL_FREQ,
  SWAY_TEMPORAL_FREQ,
  TRAIL_ALPHA,
  TRAIL_HISTORY_MS,
  TRAIL_SAMPLE_STEPS_PX,
  TRAIL_VISIBLE_PX,
  VIGNETTE_MAX_ALPHA,
  WATER_BAND_PERIOD_S,
  WATER_CENTER_ALPHA,
} from "./tuning";
import { buildMoonSlots, buildFragmentShape } from "./fragment";
import { buildStarPath, starPathAlpha, velocityOf, type StarPath, type TrailPoint } from "./trail";

type State = "intro" | "gathering" | "hush" | "reveal" | "sway" | "spawning";

interface Ripple {
  x: number;
  y: number;
  bornMs: number;
  /** 0..1。配置の波紋は逃げの波紋より濃い */
  strength: number;
}

/** p5 v2 の FES は偽陽性で fps を落とすため必ず止める */
P5.disableFriendlyErrors = true;

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const swayAmplitude = prefersReducedMotion ? REDUCED_MOTION_AMPLITUDE_PX : SWAY_AMPLITUDE_PX;
const driftSpeedScale = prefersReducedMotion ? REDUCED_MOTION_SPEED_SCALE : 1;

const audio: AudioEngine = createAudioEngine();
const quality = new QualityController(RIPPLE_CAP_STEPS.length);
const frameCounter = createFrameCounter();

const hostEl = document.querySelector<HTMLDivElement>("#p5-host")!;
const gateEl = document.querySelector<HTMLDivElement>("#gate")!;
const debugOverlayEl = document.querySelector<HTMLPreElement>("#debug-overlay")!;
const isDebugMode = new URLSearchParams(location.search).has("debug");
if (isDebugMode) debugOverlayEl.hidden = false;

let state: State = "intro";
let lastAmp = 0;
let lastError = "";
let firstPointerHeld = false;

/** 欠片・波紋・航跡 */
const fragments: Fragment[] = [];
const seed = 20260929;
const random = makeRandom(seed);
for (let index = 0; index < FRAGMENT_COUNT; index++) {
  fragments.push(new Fragment(index, seed));
}
const slots = buildMoonSlots(seed, FRAGMENT_COUNT);
const fragmentShapes = fragments.map((_, index) => buildFragmentShape(seed * 31 + index * 101));

let ripples: Ripple[] = [];
let starPaths: StarPath[] = [];
/** 追従中の航跡（欠片 index → 点列） */
const liveTrails = new Map<number, Array<{ x: number; y: number }>>();

/** ポインタ */
const trail: TrailPoint[] = [];
let pointerPos: { x: number; y: number } | null = null;
let smoothedSpeed = 0;
let lastPointerMoveMs = 0;

/** 完成タイムライン（complete() が返す時刻。正本 §6。spawningAtMs は sway の終了＝spawning の開始時刻） */
let schedule: CompletionSchedule | null = null;
let spawnStartMs = 0;
let collectedCount = 0;
/** 8 分拍 */
let lastPulseMs = 0;
let pulseBeat = 0;
/** fleeing の検知済みフラグ（逃避音を 1 回だけ鳴らす） */
const fledAnnounced = new Set<number>();
/** reveal の月面出現の進行（0..1）と月輪の進行 */
let moonRevealStartMs = 0;
/** 継ぎ目を薄くする開始時刻 */
let seamFadeStartMs = 0;
/** 新周期の開始直後、drift アンカーを欠片の現位置へ据え置く期限（ms） */
let driftAnchorFreezeUntilMs = 0;

installArtHook({
  getAmp: () => lastAmp,
  getState: () => state,
  getFrameStats: () => frameCounter.stats(),
});

function addRipple(x: number, y: number, strength: number): void {
  const cap = RIPPLE_CAP_STEPS[quality.getLevel()];
  if (ripples.length >= cap) ripples.shift();
  ripples.push({ x, y, bornMs: performance.now(), strength });
}

/** spawn: 全欠片（placed 含む）を新しい外周領域へ出し、新周期の drifting へ戻す（正本 §3 spawning） */
function spawnFragments(width: number, height: number): void {
  const slotAssignments = [...slots];
  // seeded shuffle で欠片へ割り当てる
  for (let index = slotAssignments.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [slotAssignments[index], slotAssignments[swap]] = [slotAssignments[swap], slotAssignments[index]];
  }
  let slotIndex = 0;
  for (const fragment of fragments) {
    // placed も含めて全欠片を新周期へ戻す。placed を除外すると完成後の周期で未配置が 0 枚のまま
    // gathering が即完成判定になり、hush → reveal が入力なしで無限反復する（レビュー V-1）
    fragment.assignSlot(slotAssignments[slotIndex % slotAssignments.length]);
    slotIndex++;
    // 別の外周領域へ出す（前回の位置から離す）
    const angle = random() * Math.PI * 2;
    const radius = Math.min(width, height) * 0.5 - DRIFT_AMPLITUDE_PX - 30;
    const drift = fragment.driftPosition(performance.now(), width, height, driftSpeedScale);
    fragment.x = clamp(window.innerWidth / 2 + Math.cos(angle) * radius, 40, width - 40) || drift.x;
    fragment.y = clamp(window.innerHeight / 2 + Math.sin(angle) * radius, 40, height - 40) || drift.y;
    fragment.phase = "drifting";
    fragment.vx = 0;
    fragment.vy = 0;
  }
}

function startCycle(width: number, height: number): void {
  spawnFragments(width, height);
  audio.resetCycle();
}

/** 最後の欠片が収まった瞬間（正本 §3 gathering → hush） */
function beginHush(nowMs: number): void {
  void nowMs;
  state = "hush";
  schedule = audio.complete();
}

/** reveal 開始: 月面を閉じ、StarPath を確定済みのまま月輪を走らせる */
function beginReveal(nowMs: number): void {
  state = "reveal";
  moonRevealStartMs = nowMs;
  seamFadeStartMs = nowMs;
}

function beginSway(nowMs: number): void {
  state = "sway";
  void nowMs;
}

function beginSpawning(nowMs: number): void {
  state = "spawning";
  spawnStartMs = nowMs;
}
new P5((p: P5) => {
  p.setup = () => {
    const canvas = p.createCanvas(window.innerWidth, window.innerHeight);
    canvas.parent(hostEl);
    // p5 v2 の既知の制約: pixelDensity は createCanvas の後に呼ぶ
    p.pixelDensity(1);

    window.addEventListener("resize", () => p.resizeCanvas(window.innerWidth, window.innerHeight), { passive: true });
    window.addEventListener("contextmenu", (event) => event.preventDefault());

    // ---- 導入: 画面中央の pointerdown で抜ける（正本 §3.1）----
    window.addEventListener(
      "pointerdown",
      (event: PointerEvent) => {
        if (state === "intro") {
          gateEl.classList.add("is-hidden");
          setTimeout(() => gateEl.remove(), INTRO_EXIT_MS + 400);
          // resume() の解決を待たない。音の成否に関わらず描画は続ける
          audio.start().catch((error: unknown) => {
            lastError = error instanceof Error ? error.message : String(error);
          });
          state = "gathering";
          addRipple(event.clientX, event.clientY, 0.4);
        }
        firstPointerHeld = true;
        pointerPos = { x: event.clientX, y: event.clientY };
        lastPointerMoveMs = performance.now();
      },
      { passive: true },
    );

    window.addEventListener(
      "pointermove",
      (event: PointerEvent) => {
        if (!firstPointerHeld) return;
        const nowMs = performance.now();
        const last = trail[trail.length - 1];
        if (last && nowMs - last.t < 8) return; // 同一フレームの多重点を間引く
        pointerPos = { x: event.clientX, y: event.clientY };
        trail.push({ x: event.clientX, y: event.clientY, t: nowMs });
        lastPointerMoveMs = nowMs;
      },
      { passive: true },
    );

    const release = (event: PointerEvent): void => {
      void event;
      firstPointerHeld = false;
      pointerPos = null;
      // 追従中の欠片は漂いへ戻す（pointercancel も同じ扱い。正本 §10）
      for (const fragment of fragments) {
        if (fragment.phase === "following") {
          fragment.phase = "fleeing";
          liveTrails.delete(fragment.index);
        }
      }
    };
    window.addEventListener("pointerup", release, { passive: true });
    window.addEventListener("pointercancel", release, { passive: true });

    startCycle(window.innerWidth, window.innerHeight);
  };

  p.draw = () => {
    const drawStartMs = performance.now();
    const nowMs = drawStartMs;
    quality.recordFrame(Math.min(p.deltaTime || 16.7, 100));

    lastAmp = audio.getAmp(); // analyser の読み出しは 1 フレーム 1 回

    // ---- 完成タイムライン（schedule の時刻で切替。音と視覚を同期。正本 §3）----
    if (schedule) {
      if (state === "hush" && nowMs >= schedule.revealAtMs) beginReveal(nowMs);
      else if (state === "reveal" && nowMs >= schedule.ringEndAtMs) beginSway(nowMs);
      // sway の長さは schedule.spawningAtMs（sway 開始 + 2400ms）で決める。main 側で swayAtMs に再加算しない（レビュー MF-1）
      else if (state === "sway" && nowMs >= schedule.spawningAtMs) beginSpawning(nowMs);
    }
    if (state === "spawning" && nowMs - spawnStartMs >= SPAWN_MS) {
      // 周期の初期化: 収集系の状態（回収数・波紋・追従航跡・逃避済みフラグ）を戻す。星図（starPaths）は残す
      collectedCount = 0;
      ripples = [];
      liveTrails.clear();
      fledAnnounced.clear();
      schedule = null;
      startCycle(p.width, p.height);
      state = "gathering";
      // 新周期の漂いのアンカーを今の欠片位置へ据え置く。placed から戻した欠片の driftPosition は
      // 月の中心の近くになり、spawn 直後から捕捉域内で完成判定（hush）が起きて無限反復する（レビュー V-1）。
      // 入力が無くても hush に入らないよう、漂いの再設置を最初の 1 フレームだけ遅らせる
      driftAnchorFreezeUntilMs = nowMs + SPAWN_MS;
    }

    // ---- 入力の速度計算（EMA。正本 §4.1）----
    while (trail.length > 0 && nowMs - trail[0].t > TRAIL_HISTORY_MS) trail.shift();
    let rawSpeed = 0;
    let rawAngle = 0;
    if (pointerPos && nowMs - lastPointerMoveMs <= POINTER_IDLE_TIMEOUT_MS) {
      const velocity = velocityOf(trail, nowMs, 80);
      rawSpeed = Math.hypot(velocity.vx, velocity.vy);
      rawAngle = Math.atan2(velocity.vy, velocity.vx);
    } else if (pointerPos) {
      rawSpeed = 0; // 入力点が 120ms 来ない場合は 0 へ減衰（正本 §4.1）
    }
    smoothedSpeed += (rawSpeed - smoothedSpeed) * POINTER_SPEED_EMA_ALPHA;

    const frozen = state === "hush";
    const moonDiameter = clamp(Math.min(p.width, p.height) * MOON_DIAMETER_RATIO, MOON_DIAMETER_MIN_PX, MOON_DIAMETER_MAX_PX);
    const moonRadius = moonDiameter / 2;
    const moonCenter = { x: p.width / 2, y: p.height / 2 };
    const isMobile = Math.min(p.width, p.height) <= 430;
    const sizeScale = isMobile ? MOBILE_SIZE_SCALE : 1;
    const placedCount = fragments.filter((f) => f.phase === "placed").length;
    const seamAlpha = state === "reveal" || state === "sway" || state === "spawning"
      ? 0.35 * clamp(1 - (nowMs - seamFadeStartMs) / SEAM_FADE_MS, 0, 1)
      : 0.35;

    // ---- 欠片の更新（正本 §4）----
    const dtMs = Math.min(p.deltaTime || 16.7, 100);
    const frameInput = {
      pointer: pointerPos,
      pointerSpeed: smoothedSpeed,
      pointerAngle: rawAngle,
      trail,
      nowMs,
      dtMs,
      width: p.width,
      height: p.height,
      moonCenter,
      moonRadius,
      frozen,
      driftSpeedScale,
      driftAnchorFreeze: nowMs < driftAnchorFreezeUntilMs,
    };
    for (const fragment of fragments) {
      fragment.update(frameInput);
      // 追従中は航跡を記録し、捕捉判定（正本 §4.4）
      if (fragment.phase === "following") {
        const points = liveTrails.get(fragment.index) ?? [];
        const lastPoint = points[points.length - 1];
        if (!lastPoint || Math.hypot(fragment.x - lastPoint.x, fragment.y - lastPoint.y) > 4) {
          points.push({ x: fragment.x, y: fragment.y });
        }
        liveTrails.set(fragment.index, points);
        const pointerX = pointerPos?.x ?? fragment.x;
        const pointerY = pointerPos?.y ?? fragment.y;
        audio.follow(clamp(1 - Math.hypot(fragment.x - pointerX, fragment.y - pointerY) / 220, 0, 1));
        const captured = fragment.tryCapture(frameInput);
        if (captured) {
          // 収束開始時点で追従航跡を StarPath として固定（正本 §4.4）
          const sampleStep = TRAIL_SAMPLE_STEPS_PX[quality.getLevel()];
          starPaths.push(buildStarPath(liveTrails.get(fragment.index) ?? [], sampleStep, nowMs));
          liveTrails.delete(fragment.index);
          if (starPaths.length > STARPATH_MAX) starPaths.shift();
          collectedCount++;
          audio.place({
            x: fragment.x / p.width,
            y: fragment.y / p.height,
            index: fragment.index,
            collected: collectedCount,
            speed: clamp(smoothedSpeed / POINTER_SPEED_FAST_PX_S, 0, 1),
          });
          addRipple(fragment.x, fragment.y, 1);
          addRipple(fragment.x + 8, fragment.y - 6, 0.7);
        }
      }
    }

    // gathering の逃避音: fleeing に入った最初のフレームだけ水滴と波紋（正本 §5 fragment/flee）
    for (const fragment of fragments) {
      if (fragment.phase === "fleeing" && !fledAnnounced.has(fragment.index)) {
        fledAnnounced.add(fragment.index);
        if (state === "gathering") {
          audio.flee({
            x: fragment.x / p.width,
            y: fragment.y / p.height,
            speed: clamp(smoothedSpeed / POINTER_SPEED_FAST_PX_S, 0, 1),
          });
          addRipple(fragment.x, fragment.y, 0.5);
        }
      }
      if (fragment.phase !== "fleeing") fledAnnounced.delete(fragment.index);
    }

    // 8 分拍の pulse（正本 §5 eighth/pulse）
    const eighthMs = 60000 / EIGHTH_BPM / 2;
    if (!frozen && state === "gathering" && collectedCount > 0 && nowMs - lastPulseMs >= eighthMs) {
      lastPulseMs = nowMs;
      pulseBeat++;
      audio.pulse(collectedCount, 0.5);
    }

    // 全て配置 → complete（正本 §3）
    if (state === "gathering" && placedCount >= FRAGMENT_COUNT) {
      beginHush(nowMs);
    }

    // ---- 描画（正本 §8.1 のレイヤー順）----
    const ctx = p.drawingContext;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";

    // 1. 墨青の不透明な最背面
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE_INK;
    ctx.fillRect(0, 0, p.width, p.height);

    // 2. 水面: 中心 alpha 0.20 の放射 + 12 秒周期の横濃淡 1 層（low では静的な 1 層）
    // 描画の初回フレームで確実に下地を敷く（p5 v2 の fill キャッシュ対策の save/restore は既に効いている）
    const bandInterval = quality.getLevel() >= 2 ? 0 : 2;
    if (quality.getLevel() < 2 || p.frameCount % Math.max(1, bandInterval) === 0 || placedCount === 0) {
      const gradient = ctx.createRadialGradient(moonCenter.x, moonCenter.y, 0, moonCenter.x, moonCenter.y, Math.max(p.width, p.height) * 0.6);
      gradient.addColorStop(0, hexAlpha(PALETTE_WATER, WATER_CENTER_ALPHA * 1.5));
      gradient.addColorStop(1, hexAlpha(PALETTE_WATER, 0.06));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, p.width, p.height);
      const bandPhase = (nowMs / 1000 / WATER_BAND_PERIOD_S) * Math.PI * 2;
      const bandGradient = ctx.createLinearGradient(0, 0, p.width, 0);
      bandGradient.addColorStop(0, hexAlpha(PALETTE_WATER, 0.07));
      bandGradient.addColorStop(0.5 + 0.3 * Math.sin(bandPhase), hexAlpha(PALETTE_WATER, 0.16));
      bandGradient.addColorStop(1, hexAlpha(PALETTE_WATER, 0.07));
      ctx.fillStyle = bandGradient;
      ctx.fillRect(0, 0, p.width, p.height);
    }

    // intro: 完成月の空の円（水面の青灰をわずかに暗くした直径 min(w,h)×0.28。正本 §3.1）
    if (state === "intro") {
      ctx.fillStyle = hexAlpha(PALETTE_INK, 0.5);
      ctx.beginPath();
      ctx.arc(moonCenter.x, moonCenter.y, Math.min(p.width, p.height) * INTRO_EMPTY_MOON_RATIO / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. 波紋（青灰・線幅 1px。hush では凍結。正本 §4.5 / §8）
    // progress は 0..1 に clamp する（addRipple は draw の途中で生まれるため bornMs > nowMs のフレームがある）
    if (!frozen) ripples = ripples.filter((ripple) => nowMs - ripple.bornMs < RIPPLE_LIFE_MS);
    const rippleAlphaBoost = placedCount / FRAGMENT_COUNT; // 配置数で中央の波紋を濃く
    for (const ripple of ripples) {
      const progress = frozen ? 0 : clamp((nowMs - ripple.bornMs) / RIPPLE_LIFE_MS, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const distToCenter = Math.hypot(ripple.x - moonCenter.x, ripple.y - moonCenter.y);
      const centerBoost = clamp(1 - distToCenter / (Math.min(p.width, p.height) * 0.5), 0, 1);
      const alpha = lerp(RIPPLE_ALPHA_MIN, RIPPLE_ALPHA_MAX, rippleAlphaBoost * centerBoost) * (1 - progress) * (0.7 + 0.3 * ripple.strength);
      ctx.strokeStyle = hexAlpha(PALETTE_WATER, alpha + 0.03);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, Math.min(p.width, p.height) * RIPPLE_MAX_RADIUS_RATIO * eased, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 揺れの変位（月と星図。正本 §8.3）
    const swayTime = nowMs / 1000;
    const swayDamp = state === "reveal" ? 0.4 : 1;
    const swayOffsetY = (y: number): number => Math.sin(y * SWAY_SPATIAL_FREQ + swayTime * SWAY_TEMPORAL_FREQ) * swayAmplitude * swayDamp;

    // 4. 確定した StarPath の芯（銀白 alpha 0.22・0.75px、節点 1.5px。古い順に薄く。正本 §8.3）
    for (let index = 0; index < starPaths.length; index++) {
      const path = starPaths[index];
      const alpha = starPathAlpha(starPaths.length, STARPATH_ALPHA_NEW, STARPATH_ALPHA_OLD, index);
      ctx.strokeStyle = hexAlpha(PALETTE_SILVER, alpha * STARPATH_CORE_ALPHA / STARPATH_ALPHA_NEW);
      ctx.lineWidth = STARPATH_CORE_WIDTH_PX;
      ctx.beginPath();
      for (let pointIndex = 0; pointIndex < path.points.length; pointIndex++) {
        const point = path.points[pointIndex];
        const offsetY = swayOffsetY(point.y);
        if (pointIndex === 0) ctx.moveTo(point.x, point.y + offsetY);
        else ctx.lineTo(point.x, point.y + offsetY);
      }
      ctx.stroke();
      ctx.fillStyle = hexAlpha(PALETTE_SILVER, alpha);
      for (const point of path.points) {
        ctx.beginPath();
        ctx.arc(point.x, point.y + swayOffsetY(point.y), STARPATH_NODE_RADIUS_PX, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 6. 現在追従中の航跡（銀白 alpha 0.14、最後の 120px だけ。正本 §8）
    for (const [, points] of liveTrails) {
      if (points.length < 2) continue;
      ctx.strokeStyle = hexAlpha(PALETTE_SILVER, TRAIL_ALPHA);
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      let started = false;
      let accumulated = 0;
      for (let index = points.length - 1; index > 0; index--) {
        const from = points[index];
        const to = points[index - 1];
        accumulated += Math.hypot(from.x - to.x, from.y - to.y);
        if (accumulated > TRAIL_VISIBLE_PX) break;
        if (!started) {
          ctx.moveTo(from.x, from.y);
          started = true;
        }
        ctx.lineTo(to.x, to.y);
      }
      ctx.stroke();
    }

    // 5. 未回収の銀片と配置済みの月片（影 → 面 → 縁。全状態で同じ材質。正本 §8.2）
    for (const fragment of fragments) {
      const shape = fragmentShapes[fragment.index];
      const offsetY = fragment.phase === "placed" || fragment.phase === "settling" ? swayOffsetY(fragment.y) : 0;
      const visual = fragment.visual(frameInput);
      const fragmentArea = Math.PI * moonRadius * moonRadius / FRAGMENT_AREA_DIVISOR;
      const fragmentRadius = Math.sqrt(fragmentArea / Math.PI) * sizeScale;
      ctx.save();
      ctx.translate(fragment.x, fragment.y + offsetY);
      ctx.rotate(fragment.angle + (visual.tiltDeg * Math.PI) / 180);
      ctx.scale(visual.stretch, 1);
      // 影（墨青 alpha 0.45・offset (2,3)）
      ctx.fillStyle = hexAlpha(PALETTE_INK, FRAGMENT_SHADOW_ALPHA);
      drawPolygon(ctx, shape, fragmentRadius, FRAGMENT_SHADOW_OFFSET_PX[0], FRAGMENT_SHADOW_OFFSET_PX[1]);
      ctx.fill();
      // 面（銀白）
      ctx.fillStyle = hexAlpha(PALETTE_SILVER, visual.alpha);
      drawPolygon(ctx, shape, fragmentRadius, 0, 0);
      ctx.fill();
      // 縁（銀白 alpha 0.35・1px）
      ctx.strokeStyle = hexAlpha(PALETTE_SILVER, FRAGMENT_EDGE_ALPHA);
      ctx.lineWidth = FRAGMENT_EDGE_WIDTH_PX;
      drawPolygon(ctx, shape, fragmentRadius, 0, 0);
      ctx.stroke();
      ctx.restore();
    }

    // placed の継ぎ目（青灰 alpha 0.35 → reveal で 450ms かけて薄く。正本 §8.2）
    if (placedCount >= 2 && seamAlpha > 0.01) {
      ctx.strokeStyle = hexAlpha(PALETTE_WATER, seamAlpha);
      ctx.lineWidth = 0.75;
      for (let index = 0; index < fragments.length; index++) {
        const fragment = fragments[index];
        if (fragment.phase !== "placed") continue;
        for (let other = index + 1; other < fragments.length; other++) {
          const neighbor = fragments[other];
          if (neighbor.phase !== "placed") continue;
          const dist = Math.hypot(fragment.x - neighbor.x, fragment.y - neighbor.y);
          if (dist < moonRadius * 0.75) {
            ctx.beginPath();
            ctx.moveTo(fragment.x, fragment.y + swayOffsetY(fragment.y));
            ctx.lineTo(neighbor.x, neighbor.y + swayOffsetY(neighbor.y));
            ctx.stroke();
          }
        }
      }
    }

    // hush が明けた瞬間から月面を閉じる（正本 §3 reveal: 0ms で月面を閉じる）
    if (state === "reveal" || state === "sway" || state === "spawning") {
      const revealProgress = clamp((nowMs - moonRevealStartMs) / 120, 0, 1);
      const pulse = 1 + lastAmp * MOON_PULSE_RATIO; // amp 0..1 で月縁だけ ±6% 脈動
      const fillRadius = moonRadius * revealProgress * pulse;
      ctx.fillStyle = hexAlpha(PALETTE_SILVER, 0.92);
      ctx.beginPath();
      ctx.arc(moonCenter.x, moonCenter.y + swayOffsetY(moonCenter.y), fillRadius, 0, Math.PI * 2);
      ctx.fill();
      // 月輪: 銀白 alpha 0.85・1.25px + 外側グロー alpha 0.08 の 1 層のみ（正本 §8）
      const ringProgress = clamp((nowMs - moonRevealStartMs) / RING_TRAVEL_MS, 0, 1);
      if (ringProgress > 0) {
        const ringAngle = -Math.PI / 2 + ringProgress * Math.PI * 2;
        ctx.strokeStyle = hexAlpha(PALETTE_SILVER, 0.08);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(moonCenter.x, moonCenter.y + swayOffsetY(moonCenter.y), moonRadius * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = hexAlpha(PALETTE_SILVER, 0.85);
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.arc(moonCenter.x, moonCenter.y + swayOffsetY(moonCenter.y), moonRadius * pulse, -Math.PI / 2, ringAngle);
        ctx.stroke();
      }
    }

    // 8. 周辺減光（画面四辺へ近づくほど alpha を落とす。静的な下地は offscreen へ焼くのが理想だが、
    // グラデーション 1 回の fill で同効果を出す。正本 §8「端の alpha」/ §9 の静的下地）
    const vignette = ctx.createRadialGradient(moonCenter.x, moonCenter.y, Math.min(p.width, p.height) * 0.32, moonCenter.x, moonCenter.y, Math.hypot(p.width, p.height) * 0.62);
    vignette.addColorStop(0, hexAlpha(PALETTE_INK, 0));
    vignette.addColorStop(1, hexAlpha(PALETTE_INK, VIGNETTE_MAX_ALPHA * 0.5));
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, p.width, p.height);

    ctx.restore();

    frameCounter.record(performance.now() - drawStartMs);
    if (isDebugMode && p.frameCount % 6 === 0) renderDebugOverlay();
  };

  function drawPolygon(context: CanvasRenderingContext2D, shape: Array<{ x: number; y: number }>, radius: number, offsetX: number, offsetY: number): void {
    context.beginPath();
    for (let index = 0; index < shape.length; index++) {
      const point = shape[index];
      const x = point.x * radius + offsetX;
      const y = point.y * radius + offsetY;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
  }

  function renderDebugOverlay(): void {
    const stats = frameCounter.stats();
    const snapshot: Record<string, string | number | boolean> = {
      state,
      amp: Math.round(lastAmp * 1000) / 1000,
      frames: stats.frames,
      meanDrawMs: Math.round(stats.meanDrawMs * 100) / 100,
      qualityLevel: quality.getLevel(),
      fragments: fragments.map((f) => f.phase[0]).join(""),
      collected: collectedCount,
      ripples: ripples.length,
      starPaths: starPaths.length,
      speed: Math.round(smoothedSpeed),
      midi: collectedCount > 0 ? midiForCollected(collectedCount, FRAGMENT_COUNT) : 0,
      lastError,
      ...audio.getDiagnostics(),
    };
    debugOverlayEl.textContent = Object.entries(snapshot)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
  }
});

/** #RRGGBB と alpha から rgba 文字列を作る（色の表引き。毎フレームの parse を避ける） */
const colorCache = new Map<string, string>();
function hexAlpha(hex: string, alpha: number): string {
  const key = `${hex}|${Math.round(alpha * 1000)}`;
  const cached = colorCache.get(key);
  if (cached) return cached;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const value = `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
  colorCache.set(key, value);
  return value;
}

