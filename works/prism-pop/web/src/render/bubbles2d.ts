// ============================================================
// render/bubbles2d.ts ─ standard 用の泡描画（事前レンダリングしたスプライト）
// 見た目は rich（render/rich-gl.ts のフラグメントシェーダ）と同じ光学モデルで焼く:
//   球のフレネル反射 + 膜厚の揺らぎ + 3 波長の薄膜干渉 + 上が明るい環境光 + 窓の映り込み
// 半径ごとに量子化した 8 段のスプライトを起動時 / リサイズ時に 1 度だけ画素単位で焼き、
// 毎フレームは drawImage するだけにする。膜の揺らぎは膜厚パターンの異なる 2 枚をクロスフェードして出す。
// シェーダ側の式を変えたら、このファイルの bake 関数も合わせる。
// 正本は docs/architecture.md 7.3 節。
// ============================================================

import type { Bubble } from "../bubbles";
import { BUBBLE_RADIUS_MAX_RATIO, BUBBLE_RADIUS_MIN_RATIO } from "../tuning";

const BUCKET_COUNT = 8;
/** 輪郭のアンチエイリアス分の余白（px） */
const SPRITE_PADDING_PX = 2;
/** 膜厚パターンの 2 枚（シェーダの uTime・seed に相当する値） */
const FILM_VARIANTS = [
  { time: 0, seed: 0.13 },
  { time: 2.7, seed: 0.61 },
] as const;
/** 泡ごとに膜の模様を回して、同じスプライトの使い回しに見えないようにする最大角（ラジアン） */
const FILM_ROTATION_MAX = 0.45;

// シェーダ（rich-gl.ts）と同じ定数
const WAVELENGTH_NM = [650, 532, 450] as const;
const FILM_INDEX = 1.33;
/** 環境光の下半分に映る背景色の近似（rich はその場の背景を評価するが、スプライトは固定値で近似する） */
const BACKGROUND_ESTIMATE = [0.15, 0.13, 0.32] as const;
const SKY_COLOR = [0.92, 0.95, 1.0] as const;

interface BubbleSpriteBucket {
  radiusPx: number;
  /** 膜（フレネル反射と干渉色）。泡ごとに回転して描く */
  filmCanvases: HTMLCanvasElement[];
  /** 窓の映り込み。光源の向きを保つため回転しない */
  windowCanvas: HTMLCanvasElement;
}

export interface BubbleSpriteAtlas {
  buckets: BubbleSpriteBucket[];
  shortEdgePx: number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Math.hypot は V8 で遅いので、画素ループでは平方根を直接使う */
function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** rich-gl.ts の filmThicknessNm と同じ式 */
function filmThicknessNm(ux: number, uy: number, time: number, seed: number): number {
  const swirl =
    0.5 * Math.sin(3.1 * ux + 1.7 * uy + time * 0.45 + seed * 6.2831) +
    0.3 * Math.sin(-2.3 * ux + 2.9 * uy - time * 0.33 + seed * 12.7) +
    0.2 * Math.sin(5.3 * length(ux + 0.2, uy - 0.1) - time * 0.6 + seed * 3.1);
  const drainage = 0.35 * uy;
  return Math.min(760, Math.max(220, 470 + 170 * swirl + 160 * drainage));
}

function createSpriteCanvas(radiusPx: number): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D | null;
  size: number;
} {
  const size = Math.ceil(radiusPx * 2 + SPRITE_PADDING_PX * 2);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return { canvas, context: canvas.getContext("2d"), size };
}

/**
 * 膜の層を画素単位で焼く。rich の合成 `bg * (1 - min(0.8, F)) + reflection` を、
 * source-over の「色 C・不透明度 a」で `C * a + bg * (1 - a)` として再現する
 * （a = max(反射の最大チャンネル, min(0.8, F))、C = 反射 / a）。
 */
function bakeFilmSprite(radiusPx: number, time: number, seed: number): HTMLCanvasElement {
  const { canvas, context, size } = createSpriteCanvas(radiusPx);
  if (!context) return canvas;
  const image = context.createImageData(size, size);
  const data = image.data;
  const center = size / 2;
  const reflection = [0, 0, 0];

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = px + 0.5 - center;
      const dy = py + 0.5 - center;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const edge = smoothstep(radiusPx + 1, radiusPx - 1, distance);
      if (edge <= 0) continue;

      const ux = dx / radiusPx;
      const uy = dy / radiusPx;
      const r = Math.min(1, distance / radiusPx);
      const cosI = Math.sqrt(Math.max(0, 1 - r * r));
      const sinT = r / FILM_INDEX;
      const cosT = Math.sqrt(Math.max(0, 1 - sinT * sinT));
      const oneMinusCos = 1 - cosI;
      const oneMinusCosSquared = oneMinusCos * oneMinusCos;
      const fresnel = 0.02 + 0.98 * oneMinusCosSquared * oneMinusCosSquared * oneMinusCos;
      const reflectance = fresnel * 1.5 + 0.05;
      const thickness = filmThicknessNm(ux, uy, time, seed);
      const skyMix = 0.5 - 0.5 * uy;

      let maxChannel = 0;
      for (let channel = 0; channel < 3; channel++) {
        const phase = (4 * Math.PI * FILM_INDEX * thickness * cosT) / WAVELENGTH_NM[channel];
        const film = 0.5 - 0.5 * Math.cos(phase);
        const lowerEnvironment = BACKGROUND_ESTIMATE[channel] * 1.6 + 0.08;
        const environment = lowerEnvironment + (SKY_COLOR[channel] - lowerEnvironment) * skyMix;
        reflection[channel] = Math.min(1, film * environment * reflectance);
        maxChannel = Math.max(maxChannel, reflection[channel]);
      }

      const alpha = Math.min(1, Math.max(maxChannel, Math.min(0.8, fresnel)));
      if (alpha <= 0.001) continue;
      const offset = (py * size + px) * 4;
      data[offset] = Math.round((reflection[0] / alpha) * 255);
      data[offset + 1] = Math.round((reflection[1] / alpha) * 255);
      data[offset + 2] = Math.round((reflection[2] / alpha) * 255);
      data[offset + 3] = Math.round(alpha * edge * 255);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** 窓の映り込み（rich-gl.ts の windowMain / windowSub と同じ位置・大きさ・強さ） */
function bakeWindowSprite(radiusPx: number): HTMLCanvasElement {
  const { canvas, context, size } = createSpriteCanvas(radiusPx);
  if (!context) return canvas;
  const image = context.createImageData(size, size);
  const data = image.data;
  const center = size / 2;

  // 映り込みがあるのは左上〜右下の 2 か所だけなので、その範囲（u = -0.72..0.6）だけを走査する
  const scanStart = Math.max(0, Math.floor(center - radiusPx * 0.72));
  const scanEnd = Math.min(size, Math.ceil(center + radiusPx * 0.6));
  for (let py = scanStart; py < scanEnd; py++) {
    for (let px = scanStart; px < scanEnd; px++) {
      const ux = (px + 0.5 - center) / radiusPx;
      const uy = (py + 0.5 - center) / radiusPx;
      const windowMain = smoothstep(0.26, 0, length(ux + 0.38, (uy + 0.42) * 1.35));
      const windowSub = smoothstep(0.1, 0, length(ux - 0.42, uy - 0.46));
      const intensity = Math.min(1, windowMain * 0.55 + windowSub * 0.3);
      if (intensity <= 0.001) continue;
      const offset = (py * size + px) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(intensity * 255);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** shortEdgePx（画面短辺の px）が変わるたびに呼び直す（リサイズ時のみでよい） */
export function buildBubbleSpriteAtlas(shortEdgePx: number): BubbleSpriteAtlas {
  const minRadius = shortEdgePx * BUBBLE_RADIUS_MIN_RATIO;
  const maxRadius = shortEdgePx * BUBBLE_RADIUS_MAX_RATIO;
  const buckets: BubbleSpriteBucket[] = [];
  for (let i = 0; i < BUCKET_COUNT; i++) {
    const t = i / (BUCKET_COUNT - 1);
    const radiusPx = minRadius + (maxRadius - minRadius) * t;
    buckets.push({
      radiusPx,
      filmCanvases: FILM_VARIANTS.map((variant) => bakeFilmSprite(radiusPx, variant.time, variant.seed)),
      windowCanvas: bakeWindowSprite(radiusPx),
    });
  }
  return { buckets, shortEdgePx };
}

function nearestBucket(atlas: BubbleSpriteAtlas, radiusPx: number): BubbleSpriteBucket {
  let best = atlas.buckets[0];
  let bestDist = Infinity;
  for (const bucket of atlas.buckets) {
    const dist = Math.abs(bucket.radiusPx - radiusPx);
    if (dist < bestDist) {
      bestDist = dist;
      best = bucket;
    }
  }
  return best;
}

/**
 * 泡 1 個を描く。nowS は経過秒（揺らぎ・スカッシュの位相計算用）、isHovered はホバー中のハイライト強調。
 * amp は audio.getAmp()（1 フレーム 1 回呼んだ値を渡す）で、膜のきらめき量に反映する。
 * ctx.save()/restore() で囲んで呼ぶこと（p5 v2 は fill/stroke をキャッシュするため）。
 */
export function drawBubble2D(
  ctx: CanvasRenderingContext2D,
  bubble: Bubble,
  atlas: BubbleSpriteAtlas,
  nowS: number,
  isHovered: boolean,
  amp: number,
): void {
  const bucket = nearestBucket(atlas, bubble.radius);
  const [filmA, filmB] = bucket.filmCanvases;
  const drawScale = bubble.radius / bucket.radiusPx;
  const drawSize = filmA.width * drawScale;
  const half = drawSize / 2;

  // 膜の揺らぎ: 2 枚を時間でクロスフェード（重みの和が 1 になるよう、2 枚目は lighter で足す）
  const shimmerPhase = nowS * 0.35 + bubble.shimmerSeed * Math.PI * 2;
  const weightA = 0.5 + 0.5 * Math.sin(shimmerPhase);

  // ふわふわした楕円変形（半径 ±3%）
  const squashPhase = nowS * 0.6 + bubble.squashSeed;
  const squashX = 1 + Math.sin(squashPhase) * 0.03;
  const squashY = 1 + Math.cos(squashPhase * 1.13) * 0.03;

  let alpha = 1;
  let scaleBoost = 1;
  if (bubble.state === "popping") {
    if (bubble.popT < 0.35) {
      scaleBoost = 1 + (bubble.popT / 0.35) * 0.12;
    } else {
      const t = (bubble.popT - 0.35) / 0.65;
      scaleBoost = 1.12 + t * 0.18;
      alpha = 1 - t;
    }
  }
  const filmRotation = (bubble.shimmerSeed - 0.5) * 2 * FILM_ROTATION_MAX;

  ctx.save();
  ctx.translate(bubble.x, bubble.y);
  ctx.scale(squashX * scaleBoost, squashY * scaleBoost);

  ctx.save();
  ctx.rotate(filmRotation);
  ctx.globalAlpha = alpha * weightA;
  ctx.drawImage(filmA, -half, -half, drawSize, drawSize);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = alpha * (1 - weightA);
  ctx.drawImage(filmB, -half, -half, drawSize, drawSize);

  // ホバー・getAmp() 由来のきらめき（rich の reflectance への uAmp 加算に相当）
  const sparkle = (isHovered ? 0.3 : 0) + (amp > 0.01 ? amp * 0.3 : 0);
  if (sparkle > 0) {
    ctx.globalAlpha = alpha * sparkle;
    ctx.drawImage(filmA, -half, -half, drawSize, drawSize);
  }
  ctx.restore();

  ctx.globalAlpha = alpha;
  ctx.drawImage(bucket.windowCanvas, -half, -half, drawSize, drawSize);

  ctx.restore();
}
