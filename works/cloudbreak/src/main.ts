// ============================================================
// main.ts ─ 状態機械・ポインタ入力・描画ループ（p5 インスタンスモード）
// 雛形: 押す / なぞると、位置で音程が決まるベルが鳴り、波紋が広がる。作品に合わせて書き換える。
//
// 状態機械（正本は docs/architecture.md）: intro →（最初の押下）→ idle ⇄ pressing
// 開発用クエリ: ?mute（無音）/ ?debug（診断オーバーレイ + window.__art の値を表示）
// ============================================================

import P5 from "p5";
import "./style.css";

import { createAudioEngine } from "./audio/engine";
import { createFrameCounter, installArtHook } from "./art-hook";
import { noteForPosition } from "./music";
import { QualityController } from "./quality";
import {
  DRAG_TRIGGER_DISTANCE_PX,
  PALETTE_BACKGROUND,
  PALETTE_DEGREE_COLORS,
  RIPPLE_CAP_STEPS,
  RIPPLE_LIFE_MS,
  RIPPLE_MAX_RADIUS_RATIO,
} from "./tuning";

type State = "intro" | "idle" | "pressing";

interface Ripple {
  x: number;
  y: number;
  color: string;
  bornMs: number;
  strength: number;
}

interface PointerTrack {
  lastTriggerX: number;
  lastTriggerY: number;
}

// p5 v2 の FES は偽陽性で fps を落とすため必ず止める
P5.disableFriendlyErrors = true;

const audio = createAudioEngine();
const quality = new QualityController(RIPPLE_CAP_STEPS.length);
const frameCounter = createFrameCounter();

const hostEl = document.querySelector<HTMLDivElement>("#p5-host")!;
const gateEl = document.querySelector<HTMLDivElement>("#gate")!;
const debugOverlayEl = document.querySelector<HTMLPreElement>("#debug-overlay")!;
const isDebugMode = new URLSearchParams(location.search).has("debug");
if (isDebugMode) debugOverlayEl.hidden = false;

let state: State = "intro";
let ripples: Ripple[] = [];
let energy = 0;
let lastAmp = 0;
let lastError = "";
const pointers = new Map<number, PointerTrack>();

installArtHook({
  getAmp: () => lastAmp,
  getState: () => state,
  getFrameStats: () => frameCounter.stats(),
});

function trigger(x: number, y: number, strength: number): void {
  const { midi, degree } = noteForPosition(x / window.innerWidth);
  audio.note({ x: x / window.innerWidth, y: y / window.innerHeight, midi, velocity: strength });
  const cap = RIPPLE_CAP_STEPS[quality.getLevel()];
  if (ripples.length >= cap) ripples.shift();
  ripples.push({ x, y, color: PALETTE_DEGREE_COLORS[degree % PALETTE_DEGREE_COLORS.length], bornMs: performance.now(), strength });
  energy = Math.min(1, energy + 0.15);
}

function renderDebugOverlay(): void {
  const stats = frameCounter.stats();
  const snapshot: Record<string, string | number | boolean> = {
    state,
    amp: Math.round(lastAmp * 1000) / 1000,
    frames: stats.frames,
    meanDrawMs: Math.round(stats.meanDrawMs * 100) / 100,
    qualityLevel: quality.getLevel(),
    ripples: ripples.length,
    lastError,
    ...audio.getDiagnostics(),
  };
  debugOverlayEl.textContent = Object.entries(snapshot)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

new P5((p: P5) => {
  p.setup = () => {
    const canvas = p.createCanvas(window.innerWidth, window.innerHeight);
    canvas.parent(hostEl);
    // p5 v2 の既知の制約: pixelDensity は createCanvas の後に呼ぶ
    p.pixelDensity(1);

    window.addEventListener("resize", () => p.resizeCanvas(window.innerWidth, window.innerHeight), { passive: true });
    window.addEventListener("contextmenu", (event) => event.preventDefault());

    window.addEventListener(
      "pointerdown",
      (event: PointerEvent) => {
        if (state === "intro") {
          gateEl.classList.add("is-hidden");
          // resume() の解決を待たない。音の成否に関わらず描画は続ける
          audio.start().catch((error: unknown) => {
            lastError = error instanceof Error ? error.message : String(error);
          });
        }
        state = "pressing";
        pointers.set(event.pointerId, { lastTriggerX: event.clientX, lastTriggerY: event.clientY });
        trigger(event.clientX, event.clientY, 1);
      },
      { passive: true },
    );

    window.addEventListener(
      "pointermove",
      (event: PointerEvent) => {
        const track = pointers.get(event.pointerId);
        if (!track) return;
        const distance = Math.hypot(event.clientX - track.lastTriggerX, event.clientY - track.lastTriggerY);
        if (distance < DRAG_TRIGGER_DISTANCE_PX) return;
        track.lastTriggerX = event.clientX;
        track.lastTriggerY = event.clientY;
        trigger(event.clientX, event.clientY, 0.6);
      },
      { passive: true },
    );

    const release = (event: PointerEvent): void => {
      pointers.delete(event.pointerId);
      if (pointers.size === 0 && state === "pressing") state = "idle";
    };
    window.addEventListener("pointerup", release, { passive: true });
    window.addEventListener("pointercancel", release, { passive: true });
  };

  p.draw = () => {
    const drawStartMs = performance.now();
    const nowMs = drawStartMs;
    quality.recordFrame(Math.min(p.deltaTime || 16.7, 100));

    lastAmp = audio.getAmp(); // analyser の読み出しは 1 フレーム 1 回
    energy = Math.max(0, energy - (p.deltaTime / 1000) * 0.4);
    audio.setEnergy(energy);

    const ctx = p.drawingContext;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = PALETTE_BACKGROUND;
    ctx.globalAlpha = 0.28; // 薄く塗り重ねて残像を残す
    ctx.fillRect(0, 0, p.width, p.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "lighter";

    const maxRadius = Math.min(p.width, p.height) * RIPPLE_MAX_RADIUS_RATIO;
    ripples = ripples.filter((ripple) => nowMs - ripple.bornMs < RIPPLE_LIFE_MS);
    for (const ripple of ripples) {
      const progress = (nowMs - ripple.bornMs) / RIPPLE_LIFE_MS;
      const eased = 1 - Math.pow(1 - progress, 3);
      ctx.strokeStyle = ripple.color;
      ctx.globalAlpha = (1 - progress) * (0.4 + 0.6 * ripple.strength);
      ctx.lineWidth = 2 + 6 * (1 - progress);
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, maxRadius * eased * (0.6 + 0.4 * ripple.strength), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    frameCounter.record(performance.now() - drawStartMs);
    if (isDebugMode && p.frameCount % 6 === 0) renderDebugOverlay();
  };
});
