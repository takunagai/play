// ============================================================
// fragment.ts ─ 欠片の状態・物理・追従弧・月スロットへの収束（正本 §3.2 / §4 / §8.2）
// 状態: drifting → fleeing → following → settling → placed
// ============================================================

import {
  DRIFT_AMPLITUDE_PX,
  DRIFT_PERIOD_MAX_S,
  DRIFT_PERIOD_MIN_S,
  DT_MAX_S,
  DT_MIN_S,
  EDGE_INSET_PX,
  FOLLOW_ARC_DECAY_MS,
  FOLLOW_ARC_DISTANCE_PX,
  FOLLOW_ARC_MAX_PX,
  FOLLOW_ARC_MIN_PX,
  FOLLOW_BREAK_DISTANCE_PX,
  FOLLOW_DAMPING,
  FOLLOW_DWELL_MS,
  FOLLOW_ENTER_RADIUS_RATIO,
  FOLLOW_MAX_SPEED_PX_S,
  FOLLOW_STIFFNESS,
  FOLLOW_TRAIL_DELAY_MS,
  FRAGMENT_MAX_SPEED_PX_S,
  MOON_CAPTURE_RATIO,
  POINTER_CAPTURE_RATIO,
  POINTER_SPEED_FAST_PX_S,
  POINTER_SPEED_SLOW_PX_S,
  REPEL_DISTANCE_MAX_PX,
  REPEL_DISTANCE_MIN_PX,
  REPEL_FORCE_MAX,
  REPEL_FORCE_MIN,
  REPEL_RADIUS_MAX_PX,
  REPEL_RADIUS_MIN_PX,
  RETURN_MARGIN_PX,
  SETTLE_MS,
  TANGENT_BIAS,
} from "./tuning";
import { trailPointAt, velocityOf, type TrailPoint } from "./trail";

export type FragmentPhase = "drifting" | "fleeing" | "following" | "settling" | "placed";

/** mulberry32。同じ seed から多角形と割当を再現する */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 5〜8 頂点の凸多角形の頂点列（単位半径。中心 0,0。seed で再現） */
export function buildFragmentShape(seed: number): Array<{ x: number; y: number }> {
  const random = makeRandom(seed);
  const count = 5 + Math.floor(random() * 4);
  const angles: number[] = [];
  for (let index = 0; index < count; index++) {
    angles.push((index / count) * Math.PI * 2 + (random() - 0.5) * (Math.PI / count));
  }
  angles.sort((a, b) => a - b);
  return angles.map((angle) => {
    const radius = 0.68 + random() * 0.42;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

/** 月内の扇形スロット列（中心 0,0・単位半径基準の割当角）。seeded shuffle で割り当てる */
export function buildMoonSlots(seed: number, count: number): Array<{ angle: number; radiusRatio: number }> {
  const random = makeRandom(seed);
  const slots: Array<{ angle: number; radiusRatio: number }> = [];
  const ringCount = 3;
  const indexByRing = [4, 4, 4];
  for (let ring = 0; ring < ringCount; ring++) {
    const radiusRatio = (ring + 1) / ringCount;
    const startAngle = random() * Math.PI * 2;
    for (let index = 0; index < indexByRing[ring]; index++) {
      slots.push({
        angle: startAngle + (index / indexByRing[ring]) * Math.PI * 2 + (ring % 2) * (Math.PI / indexByRing[ring]),
        radiusRatio: ring === ringCount - 1 ? 0.18 : radiusRatio * 0.92,
      });
    }
  }
  // seeded shuffle（Fisher-Yates）
  for (let index = slots.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [slots[index], slots[swap]] = [slots[swap], slots[index]];
  }
  return slots.slice(0, count);
}

export interface FragmentVisual {
  alpha: number;
  stretch: number;
  tiltDeg: number;
}

export interface FrameInput {
  pointer: { x: number; y: number } | null;
  /** 指速度（px/s。EMA 平滑化済み。main.ts が履歴から算出する） */
  pointerSpeed: number;
  pointerAngle: number;
  /** ポインタ履歴（following の遅延ターゲット用） */
  trail: readonly TrailPoint[];
  nowMs: number;
  dtMs: number;
  width: number;
  height: number;
  moonCenter: { x: number; y: number };
  moonRadius: number;
  /** hush 中の物理凍結フラグ */
  frozen: boolean;
  /** 漂いの時間倍率（prefers-reduced-motion で 0.5） */
  driftSpeedScale: number;
  /** 新周期の開始直後は drift アンカーを現位置へ据え置く（spawn 直後の完成判定を防ぐ） */
  driftAnchorFreeze: boolean;
}

export class Fragment {
  readonly index: number;
  phase: FragmentPhase = "drifting";
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  /** 表示角度（settling でスロット角へそろえる） */
  angle = 0;
  readonly shape: Array<{ x: number; y: number }>;
  readonly alpha: number;
  readonly chirality: 1 | -1;
  slot: { angle: number; radiusRatio: number } | null = null;
  /** 弧オフセット（following 中に 0 へ減衰する） */
  private arcOffset = FOLLOW_ARC_MAX_PX;
  private fleeStartMs = 0;
  private followStartMs = 0;
  private slowSinceMs: number | null = null;
  private settleStartMs = 0;
  private settleFrom = { x: 0, y: 0, angle: 0 };
  private driftPhase: number;
  private driftPeriod: number;
  /** 漂いのアンカー（周期の途中で据え置いた現位置）。null は画面比の既定アンカー */
  private driftAnchor: { x: number; y: number } | null = null;
  /** settling 中に通過した点（StarPath 化のため main.ts が読む） */
  pathPoints: Array<{ x: number; y: number }> = [];

  constructor(index: number, seed: number) {
    this.index = index;
    const random = makeRandom(seed * 7919 + index * 104729 + 17);
    this.shape = buildFragmentShape(seed * 31 + index * 101);
    this.alpha = 0.72 + random() * (0.94 - 0.72);
    this.chirality = random() < 0.5 ? 1 : -1;
    this.driftPhase = random() * Math.PI * 2;
    this.driftPeriod = DRIFT_PERIOD_MIN_S + random() * (DRIFT_PERIOD_MAX_S - DRIFT_PERIOD_MIN_S);
  }

  get isCollectible(): boolean {
    return this.phase === "drifting" || this.phase === "fleeing" || this.phase === "following";
  }

  /** 画面上の漂いの中心（再現可能な低周波 2 本。正本 §4.5）。freeze 中は前回の中心（現位置）を維持 */
  driftPosition(nowMs: number, width: number, height: number, speedScale: number, freeze = false): { x: number; y: number } {
    if (freeze) {
      if (this.driftAnchor === null) {
        // spawn 直後の 1 回だけ現位置をアンカーへ据え、以後はそこを基準に漂う
        this.driftAnchor = { x: this.x, y: this.y };
      }
      return this.driftAnchor;
    }
    const anchor = this.driftAnchor;
    const timeS = (nowMs / 1000) * speedScale;
    const baseAngle = this.driftPhase;
    const dx = Math.sin((timeS / this.driftPeriod) * Math.PI * 2 + baseAngle);
    const dy = Math.cos((timeS / (this.driftPeriod * 1.37)) * Math.PI * 2 + baseAngle * 1.7);
    const margin = DRIFT_AMPLITUDE_PX + EDGE_INSET_PX + 40;
    const base = anchor
      ? { x: clamp(anchor.x, margin, width - margin), y: clamp(anchor.y, margin, height - margin) }
      : {
          x: lerp(margin, width - margin, 0.5 + 0.42 * Math.sin(baseAngle * 3.1 + this.index * 0.7)),
          y: lerp(margin, height - margin, 0.5 + 0.42 * Math.cos(baseAngle * 2.3 + this.index * 1.3)),
        };
    return {
      x: base.x + dx * DRIFT_AMPLITUDE_PX * 0.6,
      y: base.y + dy * DRIFT_AMPLITUDE_PX,
    };
  }

  /** 1 フレーム分の物理と状態遷移 */
  update(input: FrameInput): void {
    if (this.phase === "placed") return;
    if (this.phase === "settling") {
      this.updateSettling(input);
      return;
    }
    if (input.frozen) return; // hush: 漂いも追従も停止（正本 §3 hush）
    const dtS = clamp(input.dtMs / 1000, DT_MIN_S, DT_MAX_S);

    if (this.phase === "drifting" || this.phase === "fleeing") {
      // 漂いの目標位置へ弱く引き戻す（新周期の直後は現位置をアンカーに据え置く）
      const drift = this.driftPosition(input.nowMs, input.width, input.height, input.driftSpeedScale, input.driftAnchorFreeze);
      this.vx += (drift.x - this.x) * 0.9 * dtS;
      this.vy += (drift.y - this.y) * 0.9 * dtS;
    }

    const pointer = input.pointer;
    if (pointer && this.phase !== "following") {
      this.applyRepel(pointer, input, dtS);
    }

    if (this.phase === "following") {
      this.applyFollow(input, dtS);
    }

    this.integrate(input, dtS);
    this.updatePhaseTransitions(pointer, input);
  }

  /** 逃避の力（正本 §4.2） */
  private applyRepel(pointer: { x: number; y: number }, input: FrameInput, dtS: number): void {
    const speedT = smoothstep(POINTER_SPEED_SLOW_PX_S, POINTER_SPEED_FAST_PX_S, input.pointerSpeed);
    const influenceRadius = lerp(REPEL_RADIUS_MIN_PX, REPEL_RADIUS_MAX_PX, speedT);
    const dx = this.x - pointer.x;
    const dy = this.y - pointer.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > influenceRadius) return;

    const repelDistance = lerp(REPEL_DISTANCE_MIN_PX, REPEL_DISTANCE_MAX_PX, speedT);
    const strength = Math.pow(1 - clamp(d / influenceRadius, 0, 1), 2);
    // 目標距離（repelDistance）までは全力、そこから影響半径まで弱まりながら押す
    const tail = d <= repelDistance ? 1 : lerp(1, 0.35, clamp((d - repelDistance) / Math.max(1, influenceRadius - repelDistance), 0, 1));
    const forceMag = lerp(REPEL_FORCE_MIN, REPEL_FORCE_MAX, speedT) * strength * tail;
    let ax = (dx / d) * forceMag;
    let ay = (dy / d) * forceMag;

    // 画面端 28px 以内では逃避方向を接線へ投影し、外へ押し出さない（正本 §4.2）
    const nearEdge =
      this.x < EDGE_INSET_PX || this.x > input.width - EDGE_INSET_PX || this.y < EDGE_INSET_PX || this.y > input.height - EDGE_INSET_PX;
    if (nearEdge) {
      const inwardX = this.x < input.width / 2 ? 1 : -1;
      const inwardY = this.y < input.height / 2 ? 1 : -1;
      const inward = { x: inwardX * Math.abs(ay) * 0.6, y: inwardY * Math.abs(ax) * 0.6 };
      const inwardMag = Math.hypot(inward.x, inward.y) || 1;
      ax = (ax + (inward.x / inwardMag) * forceMag * 0.8) / 2;
      ay = (ay + (inward.y / inwardMag) * forceMag * 0.8) / 2;
    }

    // 月を横切る逃避には弱い周方向バイアス（正本 §4.2）
    const toMoonX = this.x - input.moonCenter.x;
    const toMoonY = this.y - input.moonCenter.y;
    const moonDist = Math.hypot(toMoonX, toMoonY) || 1;
    if (moonDist < input.moonRadius * MOON_CAPTURE_RATIO * 2.2) {
      const tangent = { x: -toMoonY / moonDist, y: toMoonX / moonDist };
      const side = Math.sign(tangent.x * this.vx + tangent.y * this.vy) || this.chirality;
      ax += tangent.x * side * TANGENT_BIAS * strength * dtS * 60;
      ay += tangent.y * side * TANGENT_BIAS * strength * dtS * 60;
    }

    this.vx += ax * dtS;
    this.vy += ay * dtS;

    // fleeing への移行と最低表示時間（正本 §4.2）
    if (this.phase === "drifting" && d <= influenceRadius) {
      this.phase = "fleeing";
      this.fleeStartMs = input.nowMs;
      this.slowSinceMs = null;
    }
  }

  /** 弧の追従（正本 §4.3）。指の 180ms 後ろ + 固定 chirality の弧オフセット */
  private applyFollow(input: FrameInput, dtS: number): void {
    const pointer = input.pointer;
    this.arcOffset = Math.max(0, this.arcOffset - (FOLLOW_ARC_MAX_PX * input.dtMs) / FOLLOW_ARC_DECAY_MS);
    if (!pointer) return;

    const delayed = trailPointAt(input.trail, input.nowMs, FOLLOW_TRAIL_DELAY_MS) ?? pointer;
    const velocity = velocityOf(input.trail, input.nowMs, 80);
    const speed = Math.hypot(velocity.vx, velocity.vy);
    const heading = speed > 1 ? { x: velocity.vx / speed, y: velocity.vy / speed } : { x: 1, y: 0 };
    const normal = { x: -heading.y, y: heading.x };

    const distanceToPointer = Math.hypot(this.x - pointer.x, this.y - pointer.y);
    const arc = lerp(FOLLOW_ARC_MAX_PX, FOLLOW_ARC_MIN_PX, clamp(distanceToPointer / FOLLOW_ARC_DISTANCE_PX, 0, 1)) * this.arcFactor;
    const target = {
      x: delayed.x + normal.x * this.chirality * arc,
      y: delayed.y + normal.y * this.chirality * arc,
    };

    // spring（stiffness=7.5, damping=4.8。正本 §4.3）
    const stiffness = FOLLOW_STIFFNESS;
    const damping = FOLLOW_DAMPING;
    this.vx += ((target.x - this.x) * stiffness - this.vx * damping) * dtS * 4;
    this.vy += ((target.y - this.y) * stiffness - this.vy * damping) * dtS * 4;

    // 最高速度 260px/s
    const speedNow = Math.hypot(this.vx, this.vy);
    if (speedNow > FOLLOW_MAX_SPEED_PX_S) {
      this.vx = (this.vx / speedNow) * FOLLOW_MAX_SPEED_PX_S;
      this.vy = (this.vy / speedNow) * FOLLOW_MAX_SPEED_PX_S;
    }
  }

  /** 弧の減衰率（0..1）。following の経過時間で 1 → 0 */
  private get arcFactor(): number {
    if (this.phase !== "following") return 0;
    const elapsed = (performance.now() - this.followStartMs) / FOLLOW_ARC_DECAY_MS;
    return clamp(1 - elapsed, 0, 1);
  }

  private integrate(input: FrameInput, dtS: number): void {
    this.x += this.vx * dtS;
    this.y += this.vy * dtS;
    // 追従以外の最高速度制限
    if (this.phase !== "following") {
      const speed = Math.hypot(this.vx, this.vy);
      if (speed > FRAGMENT_MAX_SPEED_PX_S) {
        this.vx = (this.vx / speed) * FRAGMENT_MAX_SPEED_PX_S;
        this.vy = (this.vy / speed) * FRAGMENT_MAX_SPEED_PX_S;
      }
    }
    // 画面内へ戻す（正本 §4.2「端へ近づくほど水面側へ返す」）
    const margin = RETURN_MARGIN_PX;
    if (this.x < margin) this.vx += (margin - this.x) * 6 * dtS;
    if (this.x > input.width - margin) this.vx -= (this.x - (input.width - margin)) * 6 * dtS;
    if (this.y < margin) this.vy += (margin - this.y) * 6 * dtS;
    if (this.y > input.height - margin) this.vy -= (this.y - (input.height - margin)) * 6 * dtS;
    // 向き: 速度があるときだけ進行方向へ寄せる
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > 8) {
      const targetAngle = Math.atan2(this.vy, this.vx);
      let delta = targetAngle - this.angle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.angle += delta * clamp(dtS * 6, 0, 1);
    }
  }

  private updatePhaseTransitions(pointer: { x: number; y: number } | null, input: FrameInput): void {
    const speedT = smoothstep(POINTER_SPEED_SLOW_PX_S, POINTER_SPEED_FAST_PX_S, input.pointerSpeed);
    const influenceRadius = lerp(REPEL_RADIUS_MIN_PX, REPEL_RADIUS_MAX_PX, speedT);
    const pointerDist = pointer ? Math.hypot(this.x - pointer.x, this.y - pointer.y) : Infinity;

    if (this.phase === "fleeing") {
      // 低速が 120ms 続き、影響半径の 1.25 倍以内なら following へ（正本 §4.3）
      const isSlow = input.pointerSpeed <= POINTER_SPEED_SLOW_PX_S;
      if (isSlow && pointer && pointerDist <= influenceRadius * FOLLOW_ENTER_RADIUS_RATIO) {
        if (this.slowSinceMs === null) this.slowSinceMs = input.nowMs;
        if (input.nowMs - this.slowSinceMs >= FOLLOW_DWELL_MS) {
          this.enterFollowing(input);
        }
      } else {
        this.slowSinceMs = null;
      }
      // 高速で指が近い間は fleeing を維持（dwell を満たすまで追従へ行かない）
      if (input.pointerSpeed >= POINTER_SPEED_FAST_PX_S) this.slowSinceMs = null;
    } else if (this.phase === "following") {
      // 解除条件: 高速・遠距離・pointer 無し（正本 §4.3）
      const shouldBreak =
        !pointer ||
        input.pointerSpeed >= POINTER_SPEED_FAST_PX_S ||
        pointerDist >= FOLLOW_BREAK_DISTANCE_PX;
      if (shouldBreak) {
        this.phase = "fleeing";
        this.fleeStartMs = input.nowMs;
        this.slowSinceMs = null;
      }
    }
  }

  private enterFollowing(input: FrameInput): void {
    this.phase = "following";
    this.followStartMs = input.nowMs;
    this.pathPoints = [];
    void this.fleeStartMs;
  }

  /** 捕捉判定に使う prompting。main.ts から呼ぶ（正本 §4.4） */
  tryCapture(input: FrameInput): boolean {
    if (this.phase !== "following" || !input.pointer || this.slot === null) {
      if (this.phase !== "following") return false;
    }
    const moonDist = Math.hypot(this.x - input.moonCenter.x, this.y - input.moonCenter.y);
    const pointerDist = input.pointer ? Math.hypot(input.pointer.x - input.moonCenter.x, input.pointer.y - input.moonCenter.y) : Infinity;
    const withinMoon = moonDist <= input.moonRadius * MOON_CAPTURE_RATIO;
    const pointerNear = pointerDist <= input.moonRadius * POINTER_CAPTURE_RATIO;
    if (!withinMoon || !pointerNear) return false;
    this.phase = "settling";
    this.settleStartMs = input.nowMs;
    this.settleFrom = { x: this.x, y: this.y, angle: this.angle };
    return true;
  }

  private updateSettling(input: FrameInput): void {
    if (this.slot === null) {
      this.phase = "drifting";
      return;
    }
    const progress = clamp((input.nowMs - this.settleStartMs) / SETTLE_MS, 0, 1);
    // easeOutCubic + 最後の 25% でゆっくり収まる（正本 §8.2）
    const eased = 1 - Math.pow(1 - progress, 3);
    const slotRadius = input.moonRadius * this.slot.radiusRatio;
    const targetX = input.moonCenter.x + Math.cos(this.slot.angle) * slotRadius;
    const targetY = input.moonCenter.y + Math.sin(this.slot.angle) * slotRadius;
    this.x = lerp(this.settleFrom.x, targetX, eased);
    this.y = lerp(this.settleFrom.y, targetY, eased);
    let delta = this.slot.angle - this.settleFrom.angle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.angle = this.settleFrom.angle + delta * eased;
    this.vx = 0;
    this.vy = 0;
    if (progress >= 1) {
      this.phase = "placed";
    }
  }

  /** 表示用の視覚パラメータ（正本 §8.2） */
  visual(input: FrameInput): FragmentVisual {
    let stretch = 1;
    let tiltDeg = 0;
    const speed = Math.hypot(this.vx, this.vy);
    if (this.phase === "fleeing") {
      stretch = 1 + clamp(speed / FRAGMENT_MAX_SPEED_PX_S, 0, 1) * (FRAGMENT_STRETCH_LIMIT - 1);
    } else if (this.phase === "following") {
      tiltDeg = this.chirality * FRAGMENT_TILT_MAX;
    }
    void input;
    return { alpha: this.alpha, stretch, tiltDeg };
  }

  /** 月スロットの割当（spawn 時に main.ts が設定する） */
  assignSlot(slot: { angle: number; radiusRatio: number }): void {
    this.slot = slot;
  }
}

// 循環 import を避けるためのローカル定数（値は tuning.ts と同じ）
const FRAGMENT_STRETCH_LIMIT = 1.06;
const FRAGMENT_TILT_MAX = 8;
