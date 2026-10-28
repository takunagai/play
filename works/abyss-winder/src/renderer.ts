// ============================================================
// renderer.ts ─ 海底窓の描画（読み取り専用 snapshot → Canvas 2D）
// 正本: docs/architecture.md §9 とデザイン確定値（375px/1280px の2サイズ案）。
// main.ts の型を import type で読み、音響や入力を直接呼ばない。
// p5 の fill/stroke キャッシュ漏れを避けるため、描画は ctx.save / restore で囲む。
// ============================================================

import type { WindingSnapshot } from "./winding";
import {
  BEAT_SETTLE_MS,
  BEAT_SETTLE_PX,
  CONTACT_RIPPLE_LIFE_MS,
  CONTACT_RIPPLE_MAX_RADIUS_PX,
  CONTOUR_ALPHA,
  CONTOUR_COUNT,
  CONTOUR_START_INSET_PX,
  CONTOUR_STEP_PX,
  CONTOUR_WIDTH_PX,
  EIGHTH_MS,
  FISH_COUNT_STEPS,
  FISH_DRIFT_SPEED_PX_S,
  FISH_RETREAT_MS,
  FINAL_TICK_RAMP_MS,
  GUIDE_FADE_MS,
  GUIDE_OFFSET_MIN_PX,
  GUIDE_OFFSET_RATIO,
  GUIDE_TEXT_1,
  GUIDE_TEXT_2,
  NEXT_ROPE_DELAY_MS,
  NEXT_ROPE_GROW_MS,
  PARTICLE_ALPHA_MAX,
  PARTICLE_ALPHA_MIN,
  PARTICLE_COUNT_STEPS,
  PARTICLE_RADIUS_MAX_PX,
  PARTICLE_RADIUS_MIN_PX,
  PARTICLE_RECEDING_MAX_PX,
  PALETTE_BG,
  PALETTE_FISH,
  PALETTE_GLASS,
  PALETTE_GLASS_CENTER,
  PALETTE_GLASS_EDGE,
  PALETTE_INK_HIGH,
  PALETTE_INK_MID,
  PALETTE_METAL,
  PALETTE_METAL_DK,
  PALETTE_METAL_HI,
  PALETTE_PARTICLE,
  PALETTE_RING,
  PALETTE_ROPE,
  PALETTE_ROPE_DK,
  PALETTE_ROPE_HI,
  PALETTE_ROPE_TW,
  PALETTE_TICK,
  RING_ALPHAS,
  RING_CLOSE_MS,
  RING_CORE_WIDTH_PX,
  RING_GLOW_OFF_MS,
  RING_GLOW_PEAK_MS,
  RING_HALO_ALPHA,
  RING_HALO_OFFSET_PX,
  RING_RADIUS_INSET_PX,
  RING_STEP_PX,
  RING_WIDTH_PX,
  RIPPLE_FADE_IN_MS,
  RIM_WIDTH_RATIO,
  ROPE_EDGE_EXTRA_PX,
  ROPE_HAIR_OFFSET_PX,
  ROPE_HAIR_WIDTH_PX,
  ROPE_LENGTH_MAX_RATIO,
  ROPE_RADIUS_OFFSET_PX,
  ROPE_SLACK_SWAY_MS,
  ROPE_TWIST_ARC_PX,
  ROPE_TWIST_WIDTH_PX,
  ROPE_WIDTH_PX,
  SCREEN_MARGIN_PX,
  START_ANGLE,
  TIP_PULSE_MS,
  TICK_COUNT,
  TICK_INNER_OFFSET_PX,
  TICK_LENGTH_INSET_PX,
  TICK_WIDTH_PX,
  TITLE,
  TITLE_FONT_SIZE_NARROW_PX,
  TITLE_FONT_SIZE_PX,
  VISIBLE_RING_CAP,
  WINDOW_RADIUS_MAX_PX,
  WINDOW_RADIUS_NARROW_MAX_MIN_EDGE_PX,
  WINDOW_RADIUS_RATIO,
  WINDOW_RADIUS_RATIO_NARROW,
} from "./tuning";

const TAU = Math.PI * 2;
const FONT_STACK = `"Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", sans-serif`;

/** 幾何（CSS px）。engine に渡す値と同じものを使う */
export interface Layout {
  cx: number;
  cy: number;
  radius: number;
  rimWidth: number;
}

/** デザイン確定の 2 比率式: base 0.27 / narrow 0.34（min(w,h)<480）/ cap 200 */
export function computeLayout(width: number, height: number): Layout {
  const minEdge = Math.min(width, height);
  const ratio = minEdge < WINDOW_RADIUS_NARROW_MAX_MIN_EDGE_PX ? WINDOW_RADIUS_RATIO_NARROW : WINDOW_RADIUS_RATIO;
  const radius = Math.min(WINDOW_RADIUS_MAX_PX, ratio * minEdge);
  const rimWidth = Math.max(10, Math.round(RIM_WIDTH_RATIO * radius));
  return { cx: width / 2, cy: height / 2, rimWidth, radius };
}

export interface SceneInput {
  snapshot: WindingSnapshot;
  /** 実時間（閉じアニメ・はじみ・水紋の演出時計）。hitstop でも止まらない */
  nowMs: number;
  width: number;
  height: number;
  qualityLevel: number;
  /** 1 フレーム 1 回の analyser 読み出し。閉じる輪の光だけ ±20% 補正する */
  amp: number;
  /** gate（中央案内）が隠れた時刻。null はまだ intro */
  introHiddenAtMs: number | null;
}

interface Particle {
  angle: number;
  /** 奥行き空間の半径比（0..1）。CSS pxへの変換は描画時のみ */
  baseRadius: number;
  depth: number;
  size: number;
  alpha: number;
  drift: number;
}

interface FishShadow {
  baselineY: number;
  amplitudeX: number;
  phase: number;
  length: number;
  width: number;
}

interface ContactRipple {
  x: number;
  y: number;
  bornMs: number;
}

export interface RendererState {
  particles: Particle[];
  fishes: FishShadow[];
  contactRipples: ContactRipple[];
  /** 接触水紋を足す（main.ts が円外接触の通知に使う） */
  spawnContactRipple(x: number, y: number, nowMs: number): void;
  /** 誘導文のフェード（内部保持。drawScene が進める） */
  guideAlpha: number;
  /** 初回閉鎖時刻（魚影が退く起点。renderer だけが知る） */
  firstRingCloseAtMs: number | null;
  /** 現在の索長。受理時に計算される「次索長」で停止中の形を変えない */
  ropeLengthRatio: number;
}

function createParticles(count: number): Particle[] {
  // 決定的な擬似乱数（起動ごとに絵が変わらない）
  let seed = 20261028;
  const next = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      angle: next() * TAU,
      baseRadius: Math.sqrt(next()),
      depth: 0.35 + next() * 0.65,
      size: PARTICLE_RADIUS_MIN_PX + next() * (PARTICLE_RADIUS_MAX_PX - PARTICLE_RADIUS_MIN_PX),
      alpha: PARTICLE_ALPHA_MIN + next() * (PARTICLE_ALPHA_MAX - PARTICLE_ALPHA_MIN),
      drift: (next() * 2 - 1) * 0.02,
    });
  }
  return particles;
}

function createFishes(count: number): FishShadow[] {
  const fishes: FishShadow[] = [];
  for (let i = 0; i < count; i++) {
    fishes.push({
      baselineY: -0.3 + i * 0.32,
      amplitudeX: 26 + i * 9,
      phase: i * 2.1,
      length: 36 + i * 8,
      width: 1.6 + i * 0.4,
    });
  }
  return fishes;
}

export function createRendererState(): RendererState {
  const state: RendererState = {
    particles: createParticles(PARTICLE_COUNT_STEPS[0]),
    fishes: createFishes(FISH_COUNT_STEPS[0]),
    contactRipples: [],
    guideAlpha: 1,
    firstRingCloseAtMs: null,
    ropeLengthRatio: ROPE_LENGTH_MAX_RATIO,
    spawnContactRipple(x, y, nowMs) {
      state.contactRipples.push({ x, y, bornMs: nowMs });
    },
  };
  return state;
}

function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** 正の角度へ正規化（0..2π） */
function positiveAngle(angle: number): number {
  const mod = angle % TAU;
  return mod < 0 ? mod + TAU : mod;
}

/**
 * 1 フレームの描画。snapshot は読み取り専用で、生の pointer 座標には触れない。
 * 索端は中心・半径・有効な巻き角から形を作る（指への直線吸着は描かない）。
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  state: RendererState,
  input: SceneInput,
): void {
  const { snapshot, nowMs, width, height, amp } = input;
  const layout = computeLayout(width, height);
  const { cx, cy, radius, rimWidth } = layout;
  const sceneTimeMs = snapshot.sceneTimeMs;
  const narrow = Math.min(width, height) < WINDOW_RADIUS_NARROW_MAX_MIN_EDGE_PX;
  if (snapshot.state === "intro" || snapshot.state === "idle" || snapshot.state === "winding") {
    state.ropeLengthRatio = snapshot.nextRopeLengthRatio;
  }

  // 装飾密度だけを品質の段に従わせる（判定ロジック・時刻契約は変えない）
  const particleCount = PARTICLE_COUNT_STEPS[Math.min(input.qualityLevel, PARTICLE_COUNT_STEPS.length - 1)];
  const fishCount = FISH_COUNT_STEPS[Math.min(input.qualityLevel, FISH_COUNT_STEPS.length - 1)];
  if (state.particles.length !== particleCount) state.particles = createParticles(particleCount);
  state.fishes = createFishes(fishCount);

  // 魚影の退避と水紋の立ちは初回閉鎖を起点にする
  if (snapshot.lastRingCloseAtMs !== null && state.firstRingCloseAtMs === null) {
    state.firstRingCloseAtMs = snapshot.lastRingCloseAtMs;
  }
  const fishRetreat =
    state.firstRingCloseAtMs !== null ? clamp01((nowMs - state.firstRingCloseAtMs) / FISH_RETREAT_MS) : 0;
  const rippleAlpha =
    state.firstRingCloseAtMs !== null ? clamp01((nowMs - state.firstRingCloseAtMs) / RIPPLE_FADE_IN_MS) : 0;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";

  // ---- 背景 ----
  ctx.fillStyle = PALETTE_BG;
  ctx.fillRect(0, 0, width, height);

  // ---- ガラス（窓の内側） ----
  const glassGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  glassGradient.addColorStop(0, PALETTE_GLASS_CENTER);
  glassGradient.addColorStop(0.62, PALETTE_GLASS);
  glassGradient.addColorStop(1, PALETTE_GLASS_EDGE);
  ctx.fillStyle = glassGradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.fill();

  // ---- 粒子（窓を中心とする円形の奥行き空間・画面外で再流入） ----
  const particleSpread = Math.min(width, height) * 0.62;
  const maxParticleRadius = particleSpread * 1.25;
  // 巻き取りの遠のき（正味角の前進で中心から外へ）。hitstop 中は netAngle が止まるので静止する
  const recedeBase = Math.min(
    PARTICLE_RECEDING_MAX_PX,
    (snapshot.netAngle / TAU) * PARTICLE_RECEDING_MAX_PX,
  );
  for (const particle of state.particles) {
    const recede = recedeBase * particle.depth;
    let displayRadius = particle.baseRadius * particleSpread + recede;
    if (displayRadius > maxParticleRadius) displayRadius -= maxParticleRadius; // 画面外で再流入
    const angle = particle.angle + sceneTimeMs * 0.000003 * particle.drift * 100;
    const px = cx + Math.cos(angle) * displayRadius;
    const py = cy + Math.sin(angle) * displayRadius;
    ctx.globalAlpha = particle.alpha;
    ctx.fillStyle = PALETTE_PARTICLE;
    ctx.beginPath();
    ctx.arc(px, py, particle.size * particle.depth, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ---- 魚影（窓の内側・意図的な微弱シルエット。閉鎖後に退く） ----
  if (fishRetreat < 1) {
    ctx.strokeStyle = PALETTE_FISH;
    ctx.lineCap = "round";
    for (let i = 0; i < state.fishes.length; i++) {
      const fish = state.fishes[i];
      const driftX = Math.sin(sceneTimeMs * 0.001 * (FISH_DRIFT_SPEED_PX_S / fish.amplitudeX) + fish.phase) * fish.amplitudeX;
      const driftY = Math.cos(sceneTimeMs * 0.0006 + fish.phase) * 8;
      const fx = cx + driftX;
      const fy = cy + fish.baselineY * radius + driftY;
      const bend = Math.sin(sceneTimeMs * 0.0009 + fish.phase) * 5;
      ctx.lineWidth = fish.width;
      ctx.globalAlpha = (1 - fishRetreat) * 0.85;
      ctx.beginPath();
      ctx.moveTo(fx - fish.length / 2, fy - bend);
      ctx.quadraticCurveTo(fx, fy + bend, fx + fish.length / 2, fy - bend * 0.4);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---- 水紋（閉鎖後に静かに立つ破線円弧・非発光） ----
  if (rippleAlpha > 0) {
    ctx.strokeStyle = PALETTE_RING;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 7]);
    const ripples = [0.46, 0.6, 0.74];
    const alphas = [0.13, 0.1, 0.075];
    for (let i = 0; i < ripples.length; i++) {
      ctx.globalAlpha = alphas[i] * rippleAlpha;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * ripples[i], 0, TAU);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // ---- リム ----
  ctx.strokeStyle = PALETTE_METAL;
  ctx.lineWidth = rimWidth;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + rimWidth / 2, 0, TAU);
  ctx.stroke();
  // 内溝
  ctx.strokeStyle = PALETTE_METAL_DK;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 2, 0, TAU);
  ctx.stroke();
  // 左上 135° のハイライト弧
  ctx.strokeStyle = PALETTE_METAL_HI;
  ctx.lineWidth = 1.6;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + rimWidth - 0.8, -Math.PI, -Math.PI + (Math.PI * 3) / 4);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // ---- 目盛り（24 本・非発光・各拍で 1px 沈み込む） ----
  const beatOrigin = snapshot.beatOriginMs;
  // beatOriginMsはperformance原点。停止で遅れるsceneTimeMsとは差を取らない。
  // 停止中だけ論理freeze時刻を保持し、明けたら音側と同じ実時間の拍へ戻す。
  const beatTimeMs = snapshot.state === "hitstop" ? (snapshot.freezeAtMs ?? nowMs) : nowMs;
  const beatPhase = beatOrigin !== null ? ((beatTimeMs - beatOrigin) % EIGHTH_MS + EIGHTH_MS) % EIGHTH_MS : 0;
  const settlePx = easeOutCubic(beatPhase / BEAT_SETTLE_MS) * BEAT_SETTLE_PX;
  // winding の可視進捗（cancelled では 180ms の戻り込み）
  const visibleNetAngle = snapshot.netAngle;
  const winding = snapshot.state === "winding" || (snapshot.state === "cancelled" && visibleNetAngle > 0);
  const holdingRope = snapshot.state === "aligning" || snapshot.state === "hitstop";
  // 受理済みの全周索を閉鎖中に蓄積索へ渡す。青輪の描き始めで索を切り戻さない。
  const handingOffRope = snapshot.state === "closing";
  const ropeHandoff = handingOffRope && snapshot.lastRingCloseAtMs !== null
    ? easeOutCubic((nowMs - snapshot.lastRingCloseAtMs) / RING_CLOSE_MS)
    : 0;
  const ropeNetAngle = handingOffRope ? TAU : visibleNetAngle;
  // 最終目盛りの発光（freezeAtMs の 60ms 前からランプイン、hitstop 中は全開）
  let finalTickGlow = 0;
  if (snapshot.freezeAtMs !== null && snapshot.state !== "cancelled") {
    if (snapshot.state === "hitstop" || snapshot.state === "closing") finalTickGlow = 1;
    else if (snapshot.state === "aligning") {
      finalTickGlow = clamp01((nowMs - (snapshot.freezeAtMs - FINAL_TICK_RAMP_MS)) / FINAL_TICK_RAMP_MS);
    }
  }
  const finalTickIndex = TICK_COUNT - 1;
  ctx.lineCap = "butt";
  for (let i = 0; i < TICK_COUNT; i++) {
    const angle = START_ANGLE + (i / TICK_COUNT) * TAU;
    // 通過した目盛りは順に消える（戻るときは静かに復帰する）
    if (winding) {
      const rel = positiveAngle(angle - (snapshot.startAngle ?? START_ANGLE));
      if (visibleNetAngle >= rel) continue;
    }
    const isFinalTick = i === finalTickIndex;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rInner = radius + TICK_INNER_OFFSET_PX + settlePx;
    const rOuter = radius + rimWidth - TICK_LENGTH_INSET_PX;
    if (isFinalTick && finalTickGlow > 0) {
      // 発光は最終目盛りだけ。白芯 + 青い小さなはじみ
      ctx.save();
      ctx.shadowColor = PALETTE_RING;
      ctx.shadowBlur = 9 * finalTickGlow;
      ctx.strokeStyle = PALETTE_TICK;
      ctx.globalAlpha = 0.55 + 0.45 * finalTickGlow;
      ctx.lineWidth = TICK_WIDTH_PX;
      ctx.beginPath();
      ctx.moveTo(cx + cos * rInner, cy + sin * rInner);
      ctx.lineTo(cx + cos * rOuter, cy + sin * rOuter);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.strokeStyle = PALETTE_TICK;
      ctx.globalAlpha = 0.82;
      ctx.lineWidth = TICK_WIDTH_PX;
      ctx.beginPath();
      ctx.moveTo(cx + cos * rInner, cy + sin * rInner);
      ctx.lineTo(cx + cos * rOuter, cy + sin * rOuter);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // ---- 閉じた輪の蓄積（直近 6 本を個別に、超えた分を等高線へ集約） ----
  const ringRadiusBase = radius - RING_RADIUS_INSET_PX;
  const rings = snapshot.ringStartAngles;
  const contourCount = Math.max(0, rings.length - VISIBLE_RING_CAP);
  if (contourCount > 0) {
    ctx.strokeStyle = PALETTE_RING;
    ctx.lineWidth = CONTOUR_WIDTH_PX;
    for (let i = 0; i < Math.min(CONTOUR_COUNT, contourCount); i++) {
      ctx.globalAlpha = CONTOUR_ALPHA;
      ctx.beginPath();
      ctx.arc(cx, cy, ringRadiusBase - CONTOUR_START_INSET_PX - i * CONTOUR_STEP_PX, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  const visibleCount = Math.min(rings.length, VISIBLE_RING_CAP);
  for (let v = 0; v < visibleCount; v++) {
    const ringIndex = rings.length - visibleCount + v; // 0 = 最も古い可視輪
    const startAngle = rings[ringIndex];
    const ringRadius = ringRadiusBase - v * RING_STEP_PX;
    const alpha = RING_ALPHAS[Math.min(v, RING_ALPHAS.length - 1)];
    const isNewest = ringIndex === rings.length - 1;
    let closeProgress = 1;
    if (isNewest && snapshot.lastRingCloseAtMs !== null) {
      closeProgress = easeOutCubic((nowMs - snapshot.lastRingCloseAtMs) / RING_CLOSE_MS);
    }
    // 輪の芯（閉じ進行中の最新輪は 2.4px、蓄積輪は 1.8px で弱く残る）
    ctx.strokeStyle = PALETTE_RING;
    ctx.lineWidth = isNewest ? RING_CORE_WIDTH_PX : RING_WIDTH_PX;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(cx, cy, ringRadius, startAngle, startAngle + TAU * closeProgress);
    ctx.stroke();
    // はじみは輪型ハロー（円盤状に広げない）。閉じた最新輪だけ +120ms ピーク / +600ms 消灯
    if (isNewest && snapshot.lastRingCloseAtMs !== null) {
      const glowAge = nowMs - snapshot.lastRingCloseAtMs;
      if (glowAge >= 0 && glowAge < RING_GLOW_OFF_MS) {
        const peak = clamp01(glowAge / RING_GLOW_PEAK_MS);
        const fade = clamp01((RING_GLOW_OFF_MS - glowAge) / (RING_GLOW_OFF_MS - RING_GLOW_PEAK_MS));
        const haloAlpha = RING_HALO_ALPHA * peak * fade * (0.8 + 0.2 * Math.min(1, amp * 5));
        ctx.strokeStyle = PALETTE_RING;
        ctx.lineWidth = 2.6;
        ctx.globalAlpha = haloAlpha;
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius + RING_HALO_OFFSET_PX, 0, TAU * closeProgress);
        ctx.stroke();
      }
    }
    // 蓄積した巻き索も残す（弱く）
    ctx.strokeStyle = PALETTE_ROPE;
    ctx.lineWidth = ROPE_WIDTH_PX * 0.8;
    ctx.globalAlpha = alpha * 0.6 * (isNewest && handingOffRope ? ropeHandoff : 1);
    ctx.beginPath();
    ctx.arc(cx, cy, radius - ROPE_RADIUS_OFFSET_PX, startAngle, startAngle + TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // ---- 巻き取り中の索（円周 R−2 に時計回りで巻かれる） ----
  if ((winding || holdingRope || handingOffRope) && snapshot.startAngle !== null) {
    ctx.globalAlpha = 1 - ropeHandoff;
    const ropeAngle = snapshot.startAngle + Math.min(ropeNetAngle, TAU);
    const ropeRadius = radius - ROPE_RADIUS_OFFSET_PX;
    // 下縁 → 本体 → 髪線の 3 層
    ctx.strokeStyle = PALETTE_ROPE_DK;
    ctx.lineWidth = ROPE_WIDTH_PX + ROPE_EDGE_EXTRA_PX * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, ropeRadius, snapshot.startAngle, ropeAngle);
    ctx.stroke();
    ctx.strokeStyle = PALETTE_ROPE;
    ctx.lineWidth = ROPE_WIDTH_PX;
    ctx.beginPath();
    ctx.arc(cx, cy, ropeRadius, snapshot.startAngle, ropeAngle);
    ctx.stroke();
    ctx.strokeStyle = PALETTE_ROPE_HI;
    ctx.lineWidth = ROPE_HAIR_WIDTH_PX;
    ctx.beginPath();
    ctx.arc(cx, cy, ropeRadius - (ROPE_HAIR_OFFSET_PX - ROPE_RADIUS_OFFSET_PX), snapshot.startAngle, ropeAngle);
    ctx.stroke();
    // 撚り目（弧長 14px ごとの半径方向短線。位相は sceneTimeMs でゆっくり進む）
    ctx.strokeStyle = PALETTE_ROPE_TW;
    ctx.lineWidth = ROPE_TWIST_WIDTH_PX;
    const twistPhase = (sceneTimeMs * 0.004) % ROPE_TWIST_ARC_PX;
    const arcLength = Math.min(ropeNetAngle, TAU) * ropeRadius;
    for (let s = twistPhase; s < arcLength; s += ROPE_TWIST_ARC_PX) {
      const a = snapshot.startAngle + s / ropeRadius;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (ropeRadius - 3), cy + Math.sin(a) * (ropeRadius - 3));
      ctx.lineTo(cx + Math.cos(a) * (ropeRadius + 3), cy + Math.sin(a) * (ropeRadius + 3));
      ctx.stroke();
    }

    // 垂れ索（巻かれていない残りが索端から下へ沈む。指への直線は描かない）
    const progress = clamp01(ropeNetAngle / TAU);
    drawSlackRope(
      ctx,
      cx + Math.cos(ropeAngle) * ropeRadius,
      cy + Math.sin(ropeAngle) * ropeRadius,
      1 - progress,
      sceneTimeMs,
      width,
      height,
      state.ropeLengthRatio,
    );
  } else if (snapshot.state === "intro" || (snapshot.state === "idle" && rings.length === 0)) {
    // まだ一周していない: 索端から画面外まで垂れる
    drawSlackRope(
      ctx,
      cx + Math.cos(snapshot.tipAngle) * (radius - ROPE_RADIUS_OFFSET_PX),
      cy + Math.sin(snapshot.tipAngle) * (radius - ROPE_RADIUS_OFFSET_PX),
      1,
      sceneTimeMs,
      width,
      height,
      snapshot.nextRopeLengthRatio,
    );
  } else if (snapshot.state === "closing" || snapshot.state === "settling") {
    // 閉鎖後: 次の索端のたるみが +300ms 後に 400ms で伸びる
    const growStart = (snapshot.closeAtMs ?? nowMs) + NEXT_ROPE_DELAY_MS;
    const growth = clamp01((nowMs - growStart) / NEXT_ROPE_GROW_MS);
    if (growth > 0) {
      drawSlackRope(
        ctx,
        cx + Math.cos(snapshot.tipAngle) * (radius - ROPE_RADIUS_OFFSET_PX),
        cy + Math.sin(snapshot.tipAngle) * (radius - ROPE_RADIUS_OFFSET_PX),
        1 - growth,
        sceneTimeMs,
        width,
        height,
        snapshot.nextRopeLengthRatio,
      );
    }
  } else if (snapshot.state === "idle") {
    // 蓄積後の idle も次索を垂らす（伸びきったたるみ）
    drawSlackRope(
      ctx,
      cx + Math.cos(snapshot.tipAngle) * (radius - ROPE_RADIUS_OFFSET_PX),
      cy + Math.sin(snapshot.tipAngle) * (radius - ROPE_RADIUS_OFFSET_PX),
      0,
      sceneTimeMs,
      width,
      height,
      snapshot.nextRopeLengthRatio,
    );
  }

  ctx.globalAlpha = 1;

  // ---- 索端マーカー（白い接線方向の短線・脈動） ----
  const showMarker =
    snapshot.state === "idle" ||
    snapshot.state === "intro" ||
    snapshot.state === "settling" ||
    snapshot.state === "cancelled";
  if (showMarker) {
    const pulse = 0.65 + 0.35 * (Math.sin((nowMs / TIP_PULSE_MS) * TAU) * 0.5 + 0.5);
    const tipX = cx + Math.cos(snapshot.tipAngle) * (radius - ROPE_RADIUS_OFFSET_PX);
    const tipY = cy + Math.sin(snapshot.tipAngle) * (radius - ROPE_RADIUS_OFFSET_PX);
    const tangentX = -Math.sin(snapshot.tipAngle);
    const tangentY = Math.cos(snapshot.tipAngle);
    ctx.strokeStyle = PALETTE_TICK;
    ctx.globalAlpha = pulse;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(tipX - tangentX * 11, tipY - tangentY * 11);
    ctx.lineTo(tipX + tangentX * 11, tipY + tangentY * 11);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---- 接触水紋（円外接触の小さな非発光反応） ----
  state.contactRipples = state.contactRipples.filter((ripple) => nowMs - ripple.bornMs < CONTACT_RIPPLE_LIFE_MS);
  for (const ripple of state.contactRipples) {
    const progress = (nowMs - ripple.bornMs) / CONTACT_RIPPLE_LIFE_MS;
    const eased = easeOutCubic(progress);
    ctx.strokeStyle = PALETTE_INK_MID;
    ctx.globalAlpha = (1 - progress) * 0.35;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(ripple.x, ripple.y, CONTACT_RIPPLE_MAX_RADIUS_PX * eased, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // ---- 誘導文（索端の誘い。最初の閉鎖以降は二度と出ない） ----
  const guideVisible = snapshot.state === "idle" && snapshot.closedRingCount === 0;
  const guideTarget = guideVisible ? 1 : 0;
  const dtMs = 16.7;
  const guideRate = dtMs / GUIDE_FADE_MS;
  state.guideAlpha += Math.max(-guideRate, Math.min(guideRate, guideTarget - state.guideAlpha));
  if (state.guideAlpha > 0.01) {
    drawGuide(ctx, layout, snapshot.tipAngle, state.guideAlpha, width, height, narrow);
  }

  // ---- 題名（常設・非発光）。gate が退いた後にフェードインする ----
  if (input.introHiddenAtMs !== null) {
    const titleAlpha = clamp01((nowMs - input.introHiddenAtMs - 200) / 300);
    if (titleAlpha > 0) {
      const titleSize = narrow ? TITLE_FONT_SIZE_NARROW_PX : TITLE_FONT_SIZE_PX;
      ctx.font = `bold ${titleSize}px ${FONT_STACK}`;
      ctx.fillStyle = PALETTE_INK_HIGH;
      ctx.globalAlpha = titleAlpha;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(TITLE, width / 2, narrow ? 28 : 44);
      ctx.globalAlpha = 1;
    }
  }

  ctx.restore();
}

/** たるみを持つ垂れ索（ベジェ 3 層）。slack 1 = たるみ最大、0 = 伸びきり */
function drawSlackRope(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  slack: number,
  sceneTimeMs: number,
  width: number,
  height: number,
  lengthRatio: number,
): void {
  // たるみ揺れ: 周期 3.2s、索端 ±6px・画面端 ±14px
  const sway = Math.sin((sceneTimeMs / ROPE_SLACK_SWAY_MS) * TAU) * 6;
  const swayEnd = Math.sin((sceneTimeMs / ROPE_SLACK_SWAY_MS) * TAU + 0.9) * 14;
  const drop = 46 + 120 * slack;
  // 終点を画面外に保ったまま、内側へのたわみで可視弧長を増やす。
  // 画面外の終点だけを伸ばしても見える長さは変わらない。
  const bow = 10 + 34 * slack + Math.min(width, height) * lengthRatio * 0.65;
  const exitSide = tipX < width / 2 ? -1 : 1;
  const exitX = tipX + exitSide * (34 + 30 * slack) + swayEnd;
  const exitY = height + ROPE_WIDTH_PX * 4 + Math.abs(swayEnd) * 0.4;
  ctx.save();
  ctx.lineCap = "round";
  // 下縁 → 本体 → 髪線
  for (const layer of [
    { color: PALETTE_ROPE_DK, lineWidth: ROPE_WIDTH_PX + ROPE_EDGE_EXTRA_PX * 2, offset: 1.6 },
    { color: PALETTE_ROPE, lineWidth: ROPE_WIDTH_PX, offset: 0 },
    { color: PALETTE_ROPE_HI, lineWidth: ROPE_HAIR_WIDTH_PX, offset: -1.4 },
  ]) {
    ctx.strokeStyle = layer.color;
    ctx.lineWidth = layer.lineWidth;
    ctx.beginPath();
    ctx.moveTo(tipX + layer.offset + sway * 0.2, tipY);
    ctx.bezierCurveTo(
      tipX - exitSide * bow + sway * 0.6,
      tipY + drop * 0.5,
      (tipX + exitX) / 2 - exitSide * bow,
      (tipY + exitY) / 2,
      exitX + layer.offset,
      exitY,
    );
    ctx.stroke();
  }
  ctx.restore();
}

/** 誘導文（索端から接線方向の先へ・measureText 実幅クランプ）。モバイルは 2 行折り返し */
function drawGuide(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  tipAngle: number,
  alpha: number,
  width: number,
  height: number,
  narrow: boolean,
): void {
  const fontSize = 14;
  ctx.save();
  ctx.font = `${fontSize}px ${FONT_STACK}`;
  ctx.fillStyle = PALETTE_INK_MID;
  ctx.globalAlpha = alpha;
  ctx.textBaseline = "top";

  const offset = Math.max(GUIDE_OFFSET_MIN_PX, GUIDE_OFFSET_RATIO * layout.radius);
  const fullText = `${GUIDE_TEXT_1}${GUIDE_TEXT_2}`;
  const fullLineWidth = ctx.measureText(fullText).width;
  // 1 行が画面に収まる（オフセット + 幅 + 両マージン）なら 1 行、それ以外は 2 行折り返し
  const oneLine = !narrow && offset + fullLineWidth + SCREEN_MARGIN_PX * 2 <= width;
  const tangentX = -Math.sin(tipAngle);
  const tangentY = Math.cos(tipAngle);
  const tipX = layout.cx + Math.cos(tipAngle) * (layout.radius - 2);
  const tipY = layout.cy + Math.sin(tipAngle) * (layout.radius - 2);

  // 既定は時計回り＝進む向きの先。窓の縁（リム外周+6px）に触れる・垂れ索に近い・画面からはみ出すときは反対側へ反転する
  const textHeight = oneLine ? fontSize : fontSize * 2 + 6;
  const textWidth = oneLine ? fullLineWidth : Math.max(ctx.measureText(GUIDE_TEXT_1).width, ctx.measureText(GUIDE_TEXT_2).width);
  const rimOuterPlus = layout.radius + layout.rimWidth + 6;
  /** textBaseline "top" は em box の上端。CJK の文字インクはその ~6px 下から始まるため、評価矩形はインク基準にする */
  const textInkInsetPx = 6;
  /** 垂れ索は索端から画面下端へ垂れる（たるみ揺れ ±6px + 索の太さ込みの帯） */
  const slackBandHalfWidth = 10;
  const placeText = (sign: number): { x: number; y: number; fits: boolean } => {
    const rawX = tipX + tangentX * offset * sign;
    const yShift = tangentY >= 0 ? 12 : -12 - textHeight;
    const rawY = tipY + tangentY * offset * sign + (oneLine ? 28 : yShift);
    const x = Math.max(SCREEN_MARGIN_PX, Math.min(width - SCREEN_MARGIN_PX - textWidth, rawX));
    const y = Math.max(SCREEN_MARGIN_PX, rawY);
    // 矩形（8 点サンプル・上端はインク基準）と窓の縁+6px の非重なり
    const inkTop = y + textInkInsetPx;
    const inkBottom = y + textHeight;
    let minDistance = Infinity;
    const corners = [
      [x, inkTop],
      [x + textWidth, inkTop],
      [x, inkBottom],
      [x + textWidth, inkBottom],
      [x + textWidth / 2, inkTop],
      [x + textWidth / 2, inkBottom],
      [x, (inkTop + inkBottom) / 2],
      [x + textWidth, (inkTop + inkBottom) / 2],
    ];
    for (const [px, py] of corners) {
      minDistance = Math.min(minDistance, Math.hypot(px - layout.cx, py - layout.cy));
    }
    const clearOfWindow = minDistance >= rimOuterPlus;
    // 垂れ索の帯（x: tip±10、y: 索端より下）との距離 ≥ 8px
    const bandLeft = tipX - slackBandHalfWidth;
    const bandRight = tipX + slackBandHalfWidth;
    const horizontalGap = Math.max(bandLeft - (x + textWidth), x - bandRight);
    const overlapsSlackBand = inkTop <= height && inkBottom >= tipY;
    const clearOfSlackRope = !overlapsSlackBand || horizontalGap >= 8;
    const fitsScreen =
      rawX >= SCREEN_MARGIN_PX - 0.5 &&
      rawX + textWidth <= width - SCREEN_MARGIN_PX + 0.5 &&
      y + textHeight <= height - SCREEN_MARGIN_PX;
    return { x, y, fits: clearOfWindow && clearOfSlackRope && fitsScreen };
  };
  const forward = placeText(1);
  const mirrored = placeText(-1);
  // 収まる側を優先し、どちらも収まるなら進む向きの先を使う
  const chosen = forward.fits ? forward : mirrored;
  const textX = chosen.x;
  const textY = chosen.y;

  if (oneLine) {
    ctx.fillText(fullText, textX, textY);
  } else {
    ctx.fillText(GUIDE_TEXT_1, textX, textY);
    ctx.fillText(GUIDE_TEXT_2, textX, textY + fontSize + 6);
  }
  ctx.restore();
}
