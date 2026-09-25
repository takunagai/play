// ============================================================
// effects.ts ─ しぶき粒子・リング・波紋（p5 canvas に描く）
// 大量の粒子は p5 の stroke()/fill() を経由せず、2D context に直接 fillRect する
// （p5 v2 は fill/stroke をキャッシュするため、混ぜると意図しない見た目になる）。
// 呼び出し側は必ず ctx.save()/restore() で挟むこと。正本は docs/architecture.md 7.3・7.4 節。
// ============================================================

import { MISS_RIPPLE_LIFE_MS, RING_LIFE_MS, RIPPLE_LIFE_MS, SPLASH_PARTICLE_LIFE_MS_MAX, SPLASH_PARTICLE_LIFE_MS_MIN } from "./tuning";

interface SplashParticle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ageMs: number;
  lifeMs: number;
  size: number;
  colorHex: string;
}

interface Ring {
  x: number;
  y: number;
  ageMs: number;
  lifeMs: number;
  maxRadius: number;
  colorHex: string;
  isRainbow: boolean;
}

interface Ripple {
  x: number;
  y: number;
  ageMs: number;
  lifeMs: number;
  maxRadius: number;
  colorHex: string;
  strength: number;
}

export interface EffectsState {
  particles: SplashParticle[];
  particleCap: number;
  rings: Ring[];
  ripples: Ripple[];
}

/** particlePoolSize は想定される最大値（rich 上限）で確保し、standard では particleCap で絞る */
export function createEffectsState(particlePoolSize: number): EffectsState {
  const particles: SplashParticle[] = [];
  for (let i = 0; i < particlePoolSize; i++) {
    particles.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, ageMs: 0, lifeMs: 0, size: 0, colorHex: "#ffffff" });
  }
  return { particles, particleCap: particlePoolSize, rings: [], ripples: [] };
}

export function setParticleCap(state: EffectsState, cap: number): void {
  state.particleCap = Math.min(cap, state.particles.length);
}

function countActiveParticles(state: EffectsState): number {
  let count = 0;
  for (const p of state.particles) if (p.active) count++;
  return count;
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 泡が割れた瞬間のしぶき。数は size に比例させて呼び出し側が決める */
export function spawnSplash(state: EffectsState, x: number, y: number, colorHex: string, count: number, speedScale: number): void {
  let activeCount = countActiveParticles(state);
  if (activeCount >= state.particleCap) return;

  for (let i = 0; i < count; i++) {
    if (activeCount >= state.particleCap) break;
    let slot = -1;
    for (let j = 0; j < state.particles.length; j++) {
      if (!state.particles[j].active) {
        slot = j;
        break;
      }
    }
    if (slot === -1) break;

    const angle = Math.random() * Math.PI * 2;
    const speed = randomRange(60, 260) * speedScale;
    const particle = state.particles[slot];
    particle.active = true;
    particle.x = x;
    particle.y = y;
    particle.vx = Math.cos(angle) * speed;
    particle.vy = Math.sin(angle) * speed - randomRange(20, 80); // わずかに上方向へ弾く
    particle.ageMs = 0;
    particle.lifeMs = randomRange(SPLASH_PARTICLE_LIFE_MS_MIN, SPLASH_PARTICLE_LIFE_MS_MAX);
    particle.size = randomRange(1.5, 4.5);
    particle.colorHex = colorHex;
    activeCount++;
  }
}

export function spawnRing(
  state: EffectsState,
  x: number,
  y: number,
  colorHex: string,
  maxRadius: number,
  isRainbow: boolean,
  lifeMs: number = RING_LIFE_MS,
): void {
  state.rings.push({ x, y, ageMs: 0, lifeMs, maxRadius, colorHex, isRainbow });
}

export function spawnRipple(state: EffectsState, x: number, y: number, colorHex: string, maxRadius: number, strength: number): void {
  state.ripples.push({ x, y, ageMs: 0, lifeMs: RIPPLE_LIFE_MS, maxRadius, colorHex, strength });
}

export function spawnMissRipple(state: EffectsState, x: number, y: number, maxRadius: number): void {
  state.ripples.push({ x, y, ageMs: 0, lifeMs: MISS_RIPPLE_LIFE_MS, maxRadius, colorHex: "#ffffff", strength: 0.35 });
}

export function updateEffects(state: EffectsState, dtMs: number): void {
  for (const p of state.particles) {
    if (!p.active) continue;
    p.ageMs += dtMs;
    if (p.ageMs >= p.lifeMs) {
      p.active = false;
      continue;
    }
    const dtS = dtMs / 1000;
    p.vy += 420 * dtS; // 重力
    p.vx *= 1 - 0.6 * dtS; // 空気抵抗
    p.x += p.vx * dtS;
    p.y += p.vy * dtS;
  }
  state.rings = state.rings.filter((r) => {
    r.ageMs += dtMs;
    return r.ageMs < r.lifeMs;
  });
  state.ripples = state.ripples.filter((r) => {
    r.ageMs += dtMs;
    return r.ageMs < r.lifeMs;
  });
}

// ---- 色キャッシュ: 量子化した alpha ごとに rgba() 文字列を使い回す ----
const RGBA_ALPHA_STEPS = 24;
const rgbaCache = new Map<string, string[]>();

function hexToRgbTuple(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function quantizedRgba(colorHex: string, alpha: number): string {
  let steps = rgbaCache.get(colorHex);
  if (!steps) {
    const [r, g, b] = hexToRgbTuple(colorHex);
    steps = new Array(RGBA_ALPHA_STEPS + 1);
    for (let i = 0; i <= RGBA_ALPHA_STEPS; i++) {
      steps[i] = `rgba(${r}, ${g}, ${b}, ${(i / RGBA_ALPHA_STEPS).toFixed(3)})`;
    }
    rgbaCache.set(colorHex, steps);
  }
  const bucket = Math.max(0, Math.min(RGBA_ALPHA_STEPS, Math.round(alpha * RGBA_ALPHA_STEPS)));
  return steps[bucket];
}

/** 虹色（度数色 5 色を角度で巡回）を返す。プリズムバーストの輪に使う */
const RAINBOW_HUES = ["#C6FF00", "#3DFFB8", "#5CC8FF", "#7C4DFF", "#FF5CE1"];

export function drawEffects(ctx: CanvasRenderingContext2D, state: EffectsState): void {
  ctx.save();

  // しぶき粒子: fillRect で直接描く（大量描画のため stroke() を経由しない）
  for (const p of state.particles) {
    if (!p.active) continue;
    const lifeRatio = 1 - p.ageMs / p.lifeMs;
    ctx.fillStyle = quantizedRgba(p.colorHex, Math.max(0, lifeRatio));
    const halfSize = p.size / 2;
    ctx.fillRect(p.x - halfSize, p.y - halfSize, p.size, p.size);
  }

  // リング
  for (const r of state.rings) {
    const t = r.ageMs / r.lifeMs;
    const radius = r.maxRadius * easeOutCubic(t);
    const alpha = 1 - t;
    ctx.lineWidth = Math.max(1, 3 * (1 - t));
    if (r.isRainbow) {
      const segments = 24;
      for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        ctx.strokeStyle = quantizedRgba(RAINBOW_HUES[i % RAINBOW_HUES.length], alpha);
        ctx.beginPath();
        ctx.arc(r.x, r.y, radius, a0, a1);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = quantizedRgba(r.colorHex, alpha);
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.lineWidth = 1;

  // 波紋（柔らかい放射グラデーション）
  for (const r of state.ripples) {
    const t = r.ageMs / r.lifeMs;
    const radius = r.maxRadius * easeOutCubic(t);
    const alpha = (1 - t) * r.strength;
    if (radius <= 0 || alpha <= 0.002) continue;
    const gradient = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, radius);
    gradient.addColorStop(0, quantizedRgba(r.colorHex, 0));
    gradient.addColorStop(0.7, quantizedRgba(r.colorHex, alpha * 0.5));
    gradient.addColorStop(1, quantizedRgba(r.colorHex, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
}

export function activeParticleCount(state: EffectsState): number {
  return countActiveParticles(state);
}
