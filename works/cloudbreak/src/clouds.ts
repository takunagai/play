// ============================================================
// clouds.ts ─ seed 付き雲形状生成、層別パララックス、雲海描画
// 塊は単位空間（半径 1）の Path2D として起動時に 1 回だけ構築し、
// 描画時に setTransform で投影する。同一 bitmap の拡大・色替えの使い回しはしない。
// 正本は docs/architecture.md 第 4・8 節。
// ============================================================

import {
  ALTITUDE_PIXEL_SCALE,
  AUX_LAYER_STEPS,
  BLANKET_DRIFT_PER_MIN,
  CLEAR_CRUISE_ALTITUDE,
  CLOUD_CAP_STEPS,
  CLOUD_SEED,
  FLOW_LINE_COUNT,
  FOREGROUND_WISP_CAP_STEPS,
  NEAR_BLOB_MIN_RADIUS_PX,
  PALETTE_CLOUD_LIGHT,
  PALETTE_CLOUD_SHADOW,
  PALETTE_CLEAR_SKY,
  PALETTE_FLOW_LINE,
  PALETTE_MORNING_LIGHT,
  PALETTE_PRESSURE_VEIL,
  PALETTE_SKY_HIGH,
  PALETTE_SKY_LOW,
  PRESSURE_VEIL_MAX_ALPHA,
  SEA_TOP_ALTITUDE,
  SEA_WAVE_POINT_COUNT,
  STREAK_DRIFT_RATIO,
  WISP_DRIFT_RATIO,
} from "./tuning";

export interface CloudDrawParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  altitude: number;
  /** 押下の滑らかな強さ 0..1。流線の alpha に使う */
  pressLevel: number;
  /** 0..1 晴天要素（雲海・朝光・空色）の混合 */
  clearMix: number;
  /** 0..1 最終層の圧迫 */
  pressure: number;
  /** 0..1 突破演出で雲が画面下へ退く量 */
  sink: number;
  /** 0..1 音の振幅。雲縁の補助面の明度呼吸に使う（音→視覚の逆流線） */
  amp: number;
  /** 品質段の値をそのまま渡す */
  qualityLevel: 0 | 1 | 2;
  timeMs: number;
  /** prefers-reduced-motion で 0.5 */
  motionScale: number;
}

interface CloudBlob {
  body: Path2D;
  light: Path2D;
  depth: 0 | 1 | 2;
  /** 0..1 wrap する初期位置 */
  x: number;
  /** 塊の中心の世界高度 */
  worldAlt: number;
  /** 画面短辺比の半径 */
  scaleRatio: number;
  /** 画面幅比 / 分。遠近で符号を逆にして剪断を作る */
  driftPerMin: number;
  /** 縦方向の視差。遠い塊はゆっくり流れる */
  parallax: number;
}

interface Wisp {
  path: Path2D;
  x: number;
  worldAlt: number;
  scaleRatio: number;
  driftPerMin: number;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const HEX_COLORS = new Map<string, [number, number, number]>();
function parseHex(hex: string): [number, number, number] {
  const cached = HEX_COLORS.get(hex);
  if (cached) return cached;
  const value = parseInt(hex.slice(1), 16);
  const rgb: [number, number, number] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  HEX_COLORS.set(hex, rgb);
  return rgb;
}

function mixColor(from: string, to: string, t: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  const k = clamp(t, 0, 1);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * k)},${Math.round(a[1] + (b[1] - a[1]) * k)},${Math.round(a[2] + (b[2] - a[2]) * k)})`;
}

/** 形状の色（body と明部）。高度と depth を量子化して表引きする */
const BLOB_COLOR_CACHE = new Map<string, [string, string]>();
function blobColors(altNorm: number, depth: 0 | 1 | 2): [string, string] {
  const key = `${Math.round(altNorm * 24)}_${depth}`;
  const cached = BLOB_COLOR_CACHE.get(key);
  if (cached) return cached;
  const depthFactor = [0.34, 0.55, 0.74][depth];
  const pair: [string, string] = [
    mixColor(PALETTE_CLOUD_SHADOW, PALETTE_CLOUD_LIGHT, depthFactor * 0.5 + altNorm * 0.22),
    mixColor(PALETTE_CLOUD_SHADOW, PALETTE_CLOUD_LIGHT, clamp(depthFactor * 0.7 + altNorm * 0.28 + 0.12, 0, 1)),
  ];
  BLOB_COLOR_CACHE.set(key, pair);
  return pair;
}

/** 毛布: 大きく丸い塊（楕円比 0.5〜0.7、5〜8 個、わずかな回転） */
function buildBlanket(rng: () => number): { body: Path2D; light: Path2D } {
  const body = new Path2D();
  const light = new Path2D();
  const count = 5 + Math.floor(rng() * 4);
  for (let index = 0; index < count; index++) {
    const cx = (rng() * 2 - 1) * 0.55;
    const cy = (rng() * 2 - 1) * 0.16;
    const rx = 0.34 + rng() * 0.2;
    const ry = rx * (0.5 + rng() * 0.2);
    const rot = (rng() * 2 - 1) * 0.12;
    body.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
    if (rng() < 0.75) light.ellipse(cx * 0.8, cy * 0.75 - 0.05, rx * 0.72, ry * 0.6, rot * 0.8, 0, Math.PI * 2);
  }
  return { body, light };
}

/** 風路: 斜め 12〜24°の細長い筋、途中で切れる裂け目（2〜3 セグメント） */
function buildStreak(rng: () => number): { body: Path2D; light: Path2D } {
  const body = new Path2D();
  const light = new Path2D();
  const direction = rng() < 0.5 ? -1 : 1;
  const angle = (0.21 + rng() * 0.21) * direction;
  const slope = Math.tan(angle);
  const segments = 2 + Math.floor(rng() * 2);
  const gap = 0.16 + rng() * 0.12;
  const count = 6 + Math.floor(rng() * 7);
  for (let index = 0; index < count; index++) {
    const slot = Math.floor(rng() * segments);
    const slotWidth = 1 / segments;
    const u = -0.85 + (slot + rng()) * slotWidth * 0.94 + slot * gap * 0.5;
    const rx = 0.3 + rng() * 0.16;
    const ry = rx * (0.18 + rng() * 0.12);
    const cx = u * 0.95;
    const cy = cx * slope * 0.55 + (rng() * 2 - 1) * 0.05;
    body.ellipse(cx, cy, rx, ry, angle, 0, Math.PI * 2);
    if (rng() < 0.6) light.ellipse(cx, cy - ry * 0.4, rx * 0.75, ry * 0.6, angle, 0, Math.PI * 2);
  }
  return { body, light };
}

/** 蓋: 重なる大きなドーム（下端を揃え、上に膨らむ） */
function buildDome(rng: () => number): { body: Path2D; light: Path2D } {
  const body = new Path2D();
  const light = new Path2D();
  const count = 4 + Math.floor(rng() * 3);
  const baseY = 0.14;
  for (let index = 0; index < count; index++) {
    const cx = (rng() * 2 - 1) * 0.5;
    const rx = 0.4 + rng() * 0.2;
    const ry = rx * (0.5 + rng() * 0.22);
    const cy = baseY - rng() * 0.08;
    body.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    light.ellipse(cx, cy - ry * 0.28, rx * 0.68, ry * 0.52, 0, 0, Math.PI * 2);
  }
  return { body, light };
}

export class CloudField {
  private farBlobs: CloudBlob[] = [];
  private midBlobs: CloudBlob[] = [];
  private nearBlobs: CloudBlob[] = [];
  private wisps: Wisp[] = [];
  private flowLineXs: number[] = [];
  private veil: HTMLCanvasElement | null = null;
  private morning: HTMLCanvasElement | null = null;
  private bufferedWidth = 0;
  private bufferedHeight = 0;
  private bufferedScale = 0;
  private shapeReady = false;
  private backgroundCache = new Map<string, CanvasGradient>();

  /** 塊の形状と配置は画面寸法に依存しない。起動後に 1 回だけ構築する */
  ensureShapes(): void {
    if (this.shapeReady) return;
    this.shapeReady = true;
    const rng = mulberry32(CLOUD_SEED);
    // 毛布 遠16/中11/近5、風路 遠8/中13/近5、蓋 遠4/中10/近14 = 品質 0 の上限と一致
    const plan: Array<{
      layer: 0 | 1 | 2;
      depth: 0 | 1 | 2;
      count: number;
      band: [number, number];
      bandBias: number;
      scale: [number, number];
      driftBase: number;
      driftSign: number;
    }> = [
      { layer: 0, depth: 0, count: 16, band: [0.02, 0.34], bandBias: 1, scale: [0.3, 0.18], driftBase: 1, driftSign: 1 },
      { layer: 0, depth: 1, count: 11, band: [0.02, 0.34], bandBias: 1, scale: [0.42, 0.26], driftBase: 1.6, driftSign: 1 },
      { layer: 0, depth: 2, count: 5, band: [0.02, 0.34], bandBias: 1, scale: [0.6, 0.35], driftBase: 2.4, driftSign: -1 },
      { layer: 1, depth: 0, count: 8, band: [0.32, 0.37], bandBias: 1, scale: [0.2, 0.14], driftBase: STREAK_DRIFT_RATIO, driftSign: 1 },
      { layer: 1, depth: 1, count: 13, band: [0.32, 0.37], bandBias: 1, scale: [0.3, 0.2], driftBase: STREAK_DRIFT_RATIO * 1.3, driftSign: 1 },
      { layer: 1, depth: 2, count: 5, band: [0.32, 0.37], bandBias: 1, scale: [0.45, 0.25], driftBase: STREAK_DRIFT_RATIO * 1.6, driftSign: -1 },
      { layer: 2, depth: 0, count: 4, band: [0.63, 0.39], bandBias: 1.6, scale: [0.3, 0.2], driftBase: 1.1, driftSign: 1 },
      { layer: 2, depth: 1, count: 10, band: [0.63, 0.39], bandBias: 1.6, scale: [0.45, 0.25], driftBase: 1.5, driftSign: -1 },
      { layer: 2, depth: 2, count: 14, band: [0.63, 0.39], bandBias: 1.6, scale: [0.65, 0.4], driftBase: 1.9, driftSign: -1 },
    ];

    for (const item of plan) {
      for (let index = 0; index < item.count; index++) {
        const shape = item.layer === 0 ? buildBlanket(rng) : item.layer === 1 ? buildStreak(rng) : buildDome(rng);
        // bandBias > 1 で帯の上側へ寄せる（蓋は 0.85 以降を最も密にする）
        const worldAlt = item.band[0] + item.band[1] * (1 - Math.pow(1 - rng(), item.bandBias));
        this.pushBlob({
          ...shape,
          depth: item.depth,
          x: rng(),
          worldAlt,
          scaleRatio: item.scale[0] + rng() * item.scale[1],
          driftPerMin: BLANKET_DRIFT_PER_MIN * item.driftBase * item.driftSign,
          parallax: [0.55, 0.8, 1][item.depth],
        });
      }
    }

    const wispCount = FOREGROUND_WISP_CAP_STEPS[0];
    for (let index = 0; index < wispCount; index++) {
      const path = new Path2D();
      const rx = 0.34 + rng() * 0.3;
      const ry = rx * (0.24 + rng() * 0.14);
      path.ellipse(0, 0, rx, ry, (rng() * 2 - 1) * 0.3, 0, Math.PI * 2);
      this.wisps.push({
        path,
        x: rng(),
        worldAlt: 0.8 + rng() * 0.26,
        scaleRatio: 0.1 + rng() * 0.1,
        driftPerMin: BLANKET_DRIFT_PER_MIN * WISP_DRIFT_RATIO * (rng() < 0.5 ? 1 : -1),
      });
    }

    for (let index = 0; index < FLOW_LINE_COUNT; index++) this.flowLineXs.push(0.08 + rng() * 0.84);
  }

  private pushBlob(blob: CloudBlob): void {
    if (blob.depth === 0) this.farBlobs.push(blob);
    else if (blob.depth === 1) this.midBlobs.push(blob);
    else this.nearBlobs.push(blob);
  }

  /** 静的な遠景の靄と朝光面を offscreen へ焼く。リサイズと品質変更時だけ再生成する */
  resizeBuffers(width: number, height: number, backdropScale: number): void {
    if (this.bufferedWidth === width && this.bufferedHeight === height && this.bufferedScale === backdropScale) return;
    this.bufferedWidth = width;
    this.bufferedHeight = height;
    this.bufferedScale = backdropScale;
    const w = Math.max(2, Math.floor(width / backdropScale));
    const h = Math.max(2, Math.floor(height / backdropScale));

    const veil = document.createElement("canvas");
    veil.width = w;
    veil.height = h;
    const g = veil.getContext("2d");
    if (g) {
      g.scale(w / width, h / height);
      const grad = g.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, "rgba(201,213,232,0)");
      grad.addColorStop(0.7, "rgba(110,123,150,0.1)");
      grad.addColorStop(1, "rgba(110,123,150,0.42)");
      g.fillStyle = grad;
      g.fillRect(0, 0, width, height);
      const rng = mulberry32(CLOUD_SEED + 1);
      for (let index = 0; index < 10; index++) {
        g.globalAlpha = 0.05 + rng() * 0.08;
        g.fillStyle = PALETTE_CLOUD_SHADOW;
        g.beginPath();
        g.ellipse(rng() * width, rng() * height, width * (0.12 + rng() * 0.2), height * (0.04 + rng() * 0.06), 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    this.veil = veil;

    const morning = document.createElement("canvas");
    morning.width = w;
    morning.height = h;
    const mg = morning.getContext("2d");
    if (mg) {
      mg.scale(w / width, h / height);
      // 朝日は雲海の上端の少し上。中心は高く不透明、外縁へ落ちる（低 opacity の全面ベールにはしない）
      const seaTopY = height / 2 + (CLEAR_CRUISE_ALTITUDE - (SEA_TOP_ALTITUDE + 0.05)) * height * ALTITUDE_PIXEL_SCALE * 0.9;
      const cx = width * 0.5;
      const cy = Math.min(height * 0.72, seaTopY - height * 0.1);
      const grad = mg.createRadialGradient(cx, cy, 0, cx, cy, height * 0.42);
      grad.addColorStop(0, "rgba(255,227,184,0.95)");
      grad.addColorStop(0.5, "rgba(255,227,184,0.6)");
      grad.addColorStop(1, "rgba(255,227,184,0)");
      mg.fillStyle = grad;
      mg.fillRect(0, 0, width, height);
    }
    this.morning = morning;
  }

  draw(params: CloudDrawParams): void {
    const { ctx, width, height, altitude, pressLevel, clearMix, pressure, sink, amp, qualityLevel, timeMs, motionScale } = params;
    const shortEdge = Math.min(width, height);
    const ppa = height * ALTITUDE_PIXEL_SCALE;
    const elapsedMin = (timeMs / 60000) * motionScale;
    const altNorm = clamp(altitude / 1.06, 0, 1);
    const timeSec = timeMs / 1000;

    // 1. 高度連動の不透明背景
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.backgroundGradient(ctx, width, height, altNorm, clearMix);
    ctx.fillRect(0, 0, width, height);

    // 2. 遠景の靄（焼き込み。沈むほど濃い）
    if (this.veil) {
      ctx.globalAlpha = (0.3 + 0.34 * (1 - altNorm)) * (1 - sink) * 0.9;
      ctx.drawImage(this.veil, 0, 0, width, height);
    }
    ctx.restore();

    const auxLayers = AUX_LAYER_STEPS[qualityLevel];

    // 3〜6. 遠景 → 中景 → 流線 → 近景の順に通常合成で描く
    this.drawBlobList(ctx, this.farBlobs, cloudCap(qualityLevel, 0), {
      width, height, shortEdge, altitude, ppa, sink, elapsedMin, auxLayers: 0, amp,
    });
    this.drawBlobList(ctx, this.midBlobs, cloudCap(qualityLevel, 1), {
      width, height, shortEdge, altitude, ppa, sink, elapsedMin, auxLayers: 0, amp,
    });
    this.drawFlowLines(ctx, { width, height, pressLevel, timeSec, motionScale });
    this.drawBlobList(ctx, this.nearBlobs, cloudCap(qualityLevel, 2), {
      width, height, shortEdge, altitude, ppa, sink, elapsedMin, auxLayers, amp,
    });
    this.drawWisps(ctx, { width, height, shortEdge, altitude, ppa, sink, elapsedMin, wispCap: FOREGROUND_WISP_CAP_STEPS[qualityLevel], altNorm, pressure });

    // 7. 最終層の圧迫ベール
    if (pressure > 0.02) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = PRESSURE_VEIL_MAX_ALPHA * pressure;
      ctx.fillStyle = PALETTE_PRESSURE_VEIL;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    // 8. 晴天: 雲海と朝光
    if (clearMix > 0.002) {
      this.drawSea(ctx, { width, height, altitude, ppa, clearMix, timeSec, motionScale });
      this.drawMorning(ctx, { width, height, clearMix, timeSec, motionScale });
    }
  }

  private backgroundGradient(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    altNorm: number,
    clearMix: number,
  ): CanvasGradient {
    const key = `${width}x${height}_${Math.round(altNorm * 20)}_${Math.round(clearMix * 16)}`;
    const cached = this.backgroundCache.get(key);
    if (cached) return cached;
    const topColor = mixColor(mixColor(PALETTE_SKY_LOW, PALETTE_SKY_HIGH, 0.35 + 0.65 * altNorm), PALETTE_CLEAR_SKY, clearMix);
    const bottomColor = mixColor(PALETTE_SKY_LOW, PALETTE_CLEAR_SKY, clearMix * 0.85);
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, topColor);
    grad.addColorStop(1, bottomColor);
    this.backgroundCache.set(key, grad);
    return grad;
  }

  private drawBlobList(
    ctx: CanvasRenderingContext2D,
    blobs: CloudBlob[],
    cap: number,
    env: {
      width: number;
      height: number;
      shortEdge: number;
      altitude: number;
      ppa: number;
      sink: number;
      elapsedMin: number;
      auxLayers: number;
      amp: number;
    },
  ): void {
    const altNorm = clamp(env.altitude / 1.06, 0, 1);
    let drawn = 0;
    const alpha = 1 - env.sink * 0.9;
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const blob of blobs) {
      if (drawn >= cap) break;
      let radius = blob.scaleRatio * env.shortEdge;
      if (blob.depth === 2) radius = Math.max(radius, NEAR_BLOB_MIN_RADIUS_PX);
      const baseX = (((blob.x + blob.driftPerMin * env.elapsedMin) % 1) + 1) % 1 * env.width;
      const y = env.height / 2 + (env.altitude - blob.worldAlt) * env.ppa * blob.parallax + env.sink * env.height;
      if (y + radius * 1.4 < 0 || y - radius * 1.4 > env.height) continue;
      const [blobBody, blobLight] = blobColors(altNorm, blob.depth);
      for (const offsetX of [0, -env.width, env.width]) {
        const x = baseX + offsetX;
        if (x + radius * 1.3 < 0 || x - radius * 1.3 > env.width) continue;
        const scale = radius;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = blobBody;
        ctx.setTransform(scale, 0, 0, scale, x, y);
        ctx.fill(blob.body);
        // 雲縁の補助面（品質段で層数を減らす）。明度が amp で ±呼吸する
        for (let aux = 1; aux <= env.auxLayers; aux++) {
          const auxScale = scale * (1 + 0.12 * aux);
          ctx.globalAlpha = alpha * Math.min(1, 0.1 / aux + env.amp * 0.06);
          ctx.fillStyle = blobLight;
          ctx.setTransform(auxScale, 0, 0, auxScale, x, y);
          ctx.fill(blob.light);
        }
        ctx.globalAlpha = alpha * (0.82 + env.amp * 0.18);
        ctx.fillStyle = blobLight;
        ctx.setTransform(scale, 0, 0, scale, x, y);
        ctx.fill(blob.light);
      }
      drawn++; // wrap コピーが 2 回描かれても塊は 1 つとして数える
    }
    ctx.restore();
  }

  /** 押下中だけ見せる上向きの細い流線（最大 0.22 の明度差） */
  private drawFlowLines(
    ctx: CanvasRenderingContext2D,
    env: { width: number; height: number; pressLevel: number; timeSec: number; motionScale: number },
  ): void {
    if (env.pressLevel <= 0.02) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = PALETTE_FLOW_LINE;
    ctx.lineCap = "round";
    for (let index = 0; index < this.flowLineXs.length; index++) {
      const speed = 0.16 + (index % 3) * 0.05;
      const phase = index * 0.137;
      const cycle = (env.timeSec * speed * env.motionScale + phase) % 1;
      const u = 1 - cycle;
      const x = this.flowLineXs[index] * env.width;
      const y = u * env.height;
      const length = env.height * (0.05 + (index % 4) * 0.015);
      ctx.globalAlpha = 0.22 * env.pressLevel * (0.35 + 0.65 * u);
      ctx.lineWidth = 1.4 + (index % 2);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + length);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 蓋の細かな前景片。全体は遅く、この片だけ速く流れる */
  private drawWisps(
    ctx: CanvasRenderingContext2D,
    env: {
      width: number;
      height: number;
      shortEdge: number;
      altitude: number;
      ppa: number;
      sink: number;
      elapsedMin: number;
      wispCap: number;
      altNorm: number;
      pressure: number;
    },
  ): void {
    const alpha = (0.6 + 0.4 * env.pressure) * (1 - env.sink * 0.9);
    if (alpha <= 0.01) return;
    const color = blobColors(env.altNorm, 2)[1];
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = color;
    let drawn = 0;
    for (const wisp of this.wisps) {
      if (drawn >= env.wispCap) break;
      const radius = wisp.scaleRatio * env.shortEdge;
      const baseX = (((wisp.x + wisp.driftPerMin * env.elapsedMin) % 1) + 1) % 1 * env.width;
      const y = env.height / 2 + (env.altitude - wisp.worldAlt) * env.ppa + env.sink * env.height;
      if (y + radius < 0 || y - radius > env.height) continue;
      for (const offsetX of [0, -env.width, env.width]) {
        const x = baseX + offsetX;
        if (x + radius < 0 || x - radius > env.width) continue;
        drawn++;
        ctx.globalAlpha = alpha;
        ctx.setTransform(radius, 0, 0, radius, x, y);
        ctx.fill(wisp.path);
      }
    }
    ctx.restore();
  }

  /** 晴天の雲海。画面下に連続する波形。影 → 明部 → 朝光の帯の順に重ねる */
  private drawSea(
    ctx: CanvasRenderingContext2D,
    env: { width: number; height: number; altitude: number; ppa: number; clearMix: number; timeSec: number; motionScale: number },
  ): void {
    const seaY = env.height / 2 + (env.altitude - SEA_TOP_ALTITUDE) * env.ppa * 0.9;
    if (seaY > env.height + env.height * 0.1) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // 影（一段下の波形）
    ctx.globalAlpha = env.clearMix * 0.5;
    ctx.fillStyle = PALETTE_CLOUD_SHADOW;
    ctx.fill(this.seaPath(env, seaY + env.height * 0.045));
    // 明部（雲海の上面）
    ctx.globalAlpha = env.clearMix;
    ctx.fillStyle = PALETTE_CLOUD_LIGHT;
    ctx.fill(this.seaPath(env, seaY));
    // 朝光の帯: 雲海の上端に沿う不透明な明るい面
    ctx.globalAlpha = env.clearMix * 0.9;
    ctx.fillStyle = PALETTE_MORNING_LIGHT;
    ctx.fill(this.seaBandPath(env, seaY));
    ctx.restore();
  }

  private seaPath(
    env: { width: number; height: number; timeSec: number; motionScale: number },
    baseY: number,
  ): Path2D {
    const path = new Path2D();
    path.moveTo(0, env.height + 4);
    const amp1 = env.height * 0.02;
    const amp2 = env.height * 0.009;
    for (let index = 0; index <= SEA_WAVE_POINT_COUNT; index++) {
      const u = index / SEA_WAVE_POINT_COUNT;
      const x = u * env.width;
      const y = seaWaveY(env, u, baseY, amp1, amp2);
      path.lineTo(x, y);
    }
    path.lineTo(env.width, env.height + 4);
    path.closePath();
    return path;
  }

  /** 雲海の上端に沿う朝光の帯（上端波形 → 下方波形 → 閉じる） */
  private seaBandPath(
    env: { width: number; height: number; timeSec: number; motionScale: number },
    baseY: number,
  ): Path2D {
    const path = new Path2D();
    const amp1 = env.height * 0.02;
    const amp2 = env.height * 0.009;
    const thickness = env.height * 0.05;
    for (let index = 0; index <= SEA_WAVE_POINT_COUNT; index++) {
      const u = index / SEA_WAVE_POINT_COUNT;
      path.lineTo(u * env.width, seaWaveY(env, u, baseY, amp1, amp2));
    }
    for (let index = SEA_WAVE_POINT_COUNT; index >= 0; index--) {
      const u = index / SEA_WAVE_POINT_COUNT;
      path.lineTo(u * env.width, seaWaveY(env, u, baseY + thickness, amp1, amp2));
    }
    path.closePath();
    return path;
  }

  /** 地平線に残る朝光の面（焼き込み。ゆっくり横に移る） */
  private drawMorning(
    ctx: CanvasRenderingContext2D,
    env: { width: number; height: number; clearMix: number; timeSec: number; motionScale: number },
  ): void {
    if (!this.morning) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = env.clearMix * 0.9;
    const drift = Math.sin(env.timeSec * 0.05 * env.motionScale) * env.width * 0.03;
    ctx.drawImage(this.morning, drift, 0, env.width, env.height);
    ctx.restore();
  }
}

/** 雲海波形の 1 点の y */
function seaWaveY(
  env: { width: number; height: number; timeSec: number; motionScale: number },
  u: number,
  baseY: number,
  amp1: number,
  amp2: number,
): number {
  return (
    baseY +
    Math.sin(u * Math.PI * 2 * 1.4 + env.timeSec * 0.22 * env.motionScale) * amp1 +
    Math.sin(u * Math.PI * 2 * 3.1 - env.timeSec * 0.35 * env.motionScale) * amp2
  );
}

/** 品質段の雲塊上限（遠 / 中 / 近） */
function cloudCap(qualityLevel: 0 | 1 | 2, depth: 0 | 1 | 2): number {
  return CLOUD_CAP_STEPS[qualityLevel][depth];
}
