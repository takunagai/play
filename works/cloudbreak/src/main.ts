// ============================================================
// main.ts ─ 状態機械・飛行物理・Pointer Events・描画ループ
// 状態機械と物理の正本は docs/architecture.md 第 3 節。音響は AudioEngine 契約越しにのみ触る。
// 状態: intro → drifting ⇄ ascending → coasting → descending、
//       ascending（armed・最終境界上向き）→ breakthrough → clear → descending →（再武装）→ 再挑戦
// 開発用クエリ: ?mute（無音）/ ?debug（診断オーバーレイ）
// ============================================================

import P5 from "p5";
import "./style.css";

import { createAudioEngine } from "./audio/engine";
import type { FlightSample } from "./audio/engine";
import { createFrameCounter, installArtHook } from "./art-hook";
import { CloudField } from "./clouds";
import { QualityController } from "./quality";
import {
  ASCEND_ACCEL_PER_S2,
  ASCEND_IMPULSE_PER_S,
  ASCEND_MAX_SPEED_PER_S,
  BACKDROP_SCALE_STEPS,
  BREAKTHROUGH_MS,
  BREAKTHROUGH_REARM_ALTITUDE,
  CLEAR_ALTITUDE,
  CLEAR_CRUISE_ALTITUDE,
  CLEAR_FLOAT_AMPLITUDE,
  CLEAR_FLOAT_PERIOD_MS,
  CLEAR_HOLD_MS,
  COAST_DECEL_PER_S2,
  CAP_PRESSURE_START,
  DELTA_TIME_MAX_MS,
  DESCEND_ACCEL_PER_S2,
  DESCEND_MAX_SPEED_PER_S,
  LAYER_BOUNDARIES,
  MAX_ALTITUDE,
  MIN_ALTITUDE,
  POINTER_PAN_SMOOTHING,
} from "./tuning";

type State = "intro" | "drifting" | "ascending" | "coasting" | "descending" | "breakthrough" | "clear";

interface Flight {
  state: State;
  altitude: number;
  velocity: number;
  pressing: boolean;
  armed: boolean;
  enteredAtMs: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function layerOf(altitude: number): 0 | 1 | 2 | 3 {
  if (altitude >= LAYER_BOUNDARIES[2]) return 3;
  if (altitude >= LAYER_BOUNDARIES[1]) return 2;
  if (altitude >= LAYER_BOUNDARIES[0]) return 1;
  return 0;
}

/** 最終層内の圧迫 0..1。それ以外 0 */
function pressureOf(altitude: number): number {
  if (altitude < CAP_PRESSURE_START) return 0;
  return clamp((altitude - CAP_PRESSURE_START) / (CLEAR_ALTITUDE - CAP_PRESSURE_START), 0, 1);
}

// p5 v2 の FES は偽陽性で fps を落とすため必ず止める
P5.disableFriendlyErrors = true;

const audio = createAudioEngine();
const quality = new QualityController(BACKDROP_SCALE_STEPS.length);
const clouds = new CloudField();
const frameCounter = createFrameCounter();
clouds.ensureShapes();

const hostEl = document.querySelector<HTMLDivElement>("#p5-host")!;
const gateEl = document.querySelector<HTMLDivElement>("#gate")!;
const debugOverlayEl = document.querySelector<HTMLPreElement>("#debug-overlay")!;
const isDebugMode = new URLSearchParams(location.search).has("debug");
if (isDebugMode) debugOverlayEl.hidden = false;

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

const flight: Flight = {
  state: "intro",
  altitude: MIN_ALTITUDE,
  velocity: 0,
  pressing: false,
  armed: true,
  enteredAtMs: performance.now(),
};
let pan = 0;
let targetPan = 0;
let pressLevel = 0;
let pressureLevel = 0;
let lastAmp = 0;
let sink = 0;
let lastError = "";
let pointerActive = false;
let spacePressed = false;
// primary pointer の capture 先。viewport 外 release でも up / cancel を同じ要素で受け止める（MF-2）
let captureEl: Element | null = null;
let capturedPointerId: number | null = null;

installArtHook({
  getAmp: () => lastAmp,
  getState: () => flight.state,
  getFrameStats: () => frameCounter.stats(),
});

function sampleOf(): FlightSample {
  return {
    altitude: flight.altitude,
    velocity: flight.velocity,
    layer: layerOf(flight.altitude),
    pressure: pressureLevel,
    pan,
    isPressing: flight.pressing,
  };
}

/** 最終層の圧迫 0..1。突破（armed 解除）したら 0 のまま。再武装は下降で BREAKTHROUGH_REARM_ALTITUDE 未満まで起きない */
function pressureTargetOf(): number {
  return flight.armed ? pressureOf(flight.altitude) : 0;
}

function enterState(next: State, nowMs: number): void {
  if (flight.state === next) return;
  flight.state = next;
  flight.enteredAtMs = nowMs;
}

/** 押下開始。intro では音の配線だけを行い、状態は pointerup で進める */
function pressStart(nowMs: number): void {
  flight.pressing = true;
  if (flight.state === "breakthrough" || flight.state === "clear") return;
  if (flight.state === "drifting" || flight.state === "coasting" || flight.state === "descending") {
    // 押し始めに最低の上向き速度を与え、150ms 以内に応答を見せる
    flight.velocity = Math.max(flight.velocity, ASCEND_IMPULSE_PER_S);
    enterState("ascending", nowMs);
    audio.beginLift(sampleOf());
  }
}

/** 押下終了。上昇中なら慣性の coasting へ。突破後の離しでも state にかかわらず風を床へ戻す */
function pressEnd(nowMs: number): void {
  flight.pressing = false;
  if (flight.state === "ascending") {
    enterState("coasting", nowMs);
  }
  audio.endLift(sampleOf());
}

function updateFlight(dtSeconds: number, nowMs: number): void {
  const prevAltitude = flight.altitude;
  switch (flight.state) {
    case "drifting": {
      // 下限で小さく浮遊
      flight.velocity = 0;
      flight.altitude = MIN_ALTITUDE + Math.sin((nowMs / 2400) * Math.PI * 2) * 0.004 * (motionQuery.matches ? 0.5 : 1);
      break;
    }
    case "ascending": {
      flight.velocity = Math.min(ASCEND_MAX_SPEED_PER_S, flight.velocity + ASCEND_ACCEL_PER_S2 * dtSeconds);
      flight.altitude += flight.velocity * dtSeconds;
      if (flight.altitude >= CLEAR_ALTITUDE) {
        if (flight.armed) {
          flight.altitude = CLEAR_ALTITUDE;
          flight.armed = false;
          enterState("breakthrough", nowMs);
          audio.breakthrough({ intensity: 1, pan });
        } else {
          // 再武装前の最終層上端では押しても昇り切れない。沈み直して再挑戦する
          flight.altitude = CLEAR_ALTITUDE;
          flight.velocity = 0;
          enterState("descending", nowMs);
        }
      }
      break;
    }
    case "coasting": {
      // 空気抵抗で上向き速度を 0 へ近づける（350〜500ms で頂点）
      flight.velocity = Math.max(0, flight.velocity - COAST_DECEL_PER_S2 * dtSeconds);
      flight.altitude += flight.velocity * dtSeconds;
      if (flight.velocity <= 0) enterState("descending", nowMs);
      break;
    }
    case "descending": {
      // 上昇より少し遅く沈み、戻りを罰にしない
      flight.velocity = Math.max(-DESCEND_MAX_SPEED_PER_S, flight.velocity - DESCEND_ACCEL_PER_S2 * dtSeconds);
      flight.altitude += flight.velocity * dtSeconds;
      if (flight.altitude <= MIN_ALTITUDE) {
        flight.altitude = MIN_ALTITUDE;
        enterState("drifting", nowMs);
      }
      break;
    }
    case "breakthrough": {
      const progress = clamp((nowMs - flight.enteredAtMs) / BREAKTHROUGH_MS, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      flight.altitude = CLEAR_ALTITUDE + (CLEAR_CRUISE_ALTITUDE - CLEAR_ALTITUDE) * eased;
      if (progress >= 1) enterState("clear", nowMs);
      break;
    }
    case "clear": {
      const heldMs = nowMs - flight.enteredAtMs;
      if (heldMs < CLEAR_HOLD_MS || flight.pressing) {
        // 最初の 4 秒は入力にかかわらず低周波で浮遊し、余韻を聴せる
        const floatPhase = (nowMs / CLEAR_FLOAT_PERIOD_MS) * Math.PI * 2;
        const amplitude = CLEAR_FLOAT_AMPLITUDE * (motionQuery.matches ? 0.5 : 1);
        flight.altitude = CLEAR_CRUISE_ALTITUDE + Math.sin(floatPhase) * amplitude;
        flight.velocity = 0;
      } else {
        flight.velocity = 0;
        enterState("descending", nowMs);
      }
      break;
    }
  }
  flight.altitude = clamp(flight.altitude, 0, MAX_ALTITUDE);
  // 0.78 未満まで下がったら次の突破を armed にする（境界付近の連打を防ぐ）
  if (!flight.armed && flight.altitude < BREAKTHROUGH_REARM_ALTITUDE) flight.armed = true;
  // 上向きの層境界通過で各 1 回だけベル。下降時は鳴らさない
  for (const boundaryIndex of [0, 1] as const) {
    const boundary = LAYER_BOUNDARIES[boundaryIndex];
    if (prevAltitude < boundary && flight.altitude >= boundary) {
      audio.layerCross({ layer: (boundaryIndex + 1) as 1 | 2, altitude: flight.altitude, pan });
    }
  }
}

function renderDebugOverlay(): void {
  const stats = frameCounter.stats();
  const snapshot: Record<string, string | number | boolean> = {
    state: flight.state,
    altitude: Math.round(flight.altitude * 1000) / 1000,
    velocity: Math.round(flight.velocity * 1000) / 1000,
    layer: layerOf(flight.altitude),
    pressure: Math.round(pressureLevel * 100) / 100,
    isPressing: flight.pressing,
    armed: flight.armed,
    qualityLevel: quality.getLevel(),
    amp: Math.round(lastAmp * 1000) / 1000,
    frames: stats.frames,
    meanDrawMs: Math.round(stats.meanDrawMs * 100) / 100,
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
    clouds.resizeBuffers(p.width, p.height, BACKDROP_SCALE_STEPS[quality.getLevel()]);

    window.addEventListener(
      "resize",
      () => {
        p.resizeCanvas(window.innerWidth, window.innerHeight);
        clouds.resizeBuffers(p.width, p.height, BACKDROP_SCALE_STEPS[quality.getLevel()]);
      },
      { passive: true },
    );
    window.addEventListener("contextmenu", (event) => event.preventDefault());

    /** capture 中の primary pointer を安全に解放する。pointerup の後は UA が暗黙解放済みで
     *  NotFoundError になることがあるが、どちらでも結果は同じなので握りつぶす */
    const releasePointerCaptureSafely = (): void => {
      const element = captureEl;
      const captured = capturedPointerId;
      captureEl = null;
      capturedPointerId = null;
      if (element === null || captured === null) return;
      try {
        element.releasePointerCapture(captured);
      } catch {
        // 既に解放済み
      }
    };

    window.addEventListener(
      "pointerdown",
      (event: PointerEvent) => {
        if (!event.isPrimary) return;
        pointerActive = true;
        targetPan = (event.clientX / window.innerWidth) * 2 - 1;
        // concrete Element に capture して viewport 外 release でも up / cancel を受け止める（MF-2）。
        // capture に失敗した場合は従来どおり window への bubble に任せる
        if (event.target instanceof Element) {
          try {
            event.target.setPointerCapture(event.pointerId);
            captureEl = event.target;
            capturedPointerId = event.pointerId;
          } catch {
            captureEl = null;
            capturedPointerId = null;
          }
        }
        if (flight.state === "intro") {
          // resume() の解決を待たずに配線まで済ませる。成否に関わらず描画は続ける
          audio.start().catch((error: unknown) => {
            lastError = error instanceof Error ? error.message : String(error);
          });
          return;
        }
        pressStart(performance.now());
      },
      { passive: true },
    );

    window.addEventListener(
      "pointermove",
      (event: PointerEvent) => {
        if (!event.isPrimary) return;
        targetPan = (event.clientX / window.innerWidth) * 2 - 1;
      },
      { passive: true },
    );

    const release = (event: PointerEvent): void => {
      if (!event.isPrimary || !pointerActive) return;
      pointerActive = false;
      releasePointerCaptureSafely();
      if (flight.state === "intro") {
        // 中央の pointerup で導入を抜ける（このタップ自体は上昇量へ数えない）
        gateEl.classList.add("is-hidden");
        enterState("drifting", performance.now());
        return;
      }
      pressEnd(performance.now());
    };
    window.addEventListener("pointerup", release, { passive: true });
    window.addEventListener("pointercancel", release, { passive: true });
    // lostpointercapture はバブリングしないため capture フェーズで受ける。
    // up / cancel が届かない状況（明示解放・要素消失等）でも release が通る解放保険（MF-2）
    window.addEventListener("lostpointercapture", release, { passive: true, capture: true });

    window.addEventListener(
      "keydown",
      (event: KeyboardEvent) => {
        if (event.code !== "Space" || event.repeat) return;
        event.preventDefault();
        if (spacePressed) return;
        spacePressed = true;
        if (flight.state === "intro") {
          audio.start().catch((error: unknown) => {
            lastError = error instanceof Error ? error.message : String(error);
          });
          return;
        }
        pressStart(performance.now());
      },
      { passive: false },
    );
    window.addEventListener(
      "keyup",
      (event: KeyboardEvent) => {
        if (event.code !== "Space" || !spacePressed) return;
        spacePressed = false;
        if (flight.state === "intro") return;
        pressEnd(performance.now());
      },
      { passive: true },
    );

    // 戻った時に勝手に上昇し続けない（押下の後始末は pressEnd と同じく state 非依存で行う）
    const forceRelease = (): void => {
      if (!spacePressed && !pointerActive) return;
      spacePressed = false;
      pointerActive = false;
      releasePointerCaptureSafely();
      if (flight.state === "ascending") {
        enterState("coasting", performance.now());
      }
      flight.pressing = false;
      audio.endLift(sampleOf());
    };
    window.addEventListener("blur", forceRelease, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) forceRelease();
    });
  };

  p.draw = () => {
    const drawStartMs = performance.now();
    const dtMs = Math.min(p.deltaTime || 16.7, DELTA_TIME_MAX_MS);
    const dtSeconds = dtMs / 1000;

    if (quality.recordFrame(dtMs)) {
      // 品質段が下がったら offscreen バッファの解像度だけ落とす（物理・色・演出は変えない）
      clouds.resizeBuffers(p.width, p.height, BACKDROP_SCALE_STEPS[quality.getLevel()]);
    }

    updateFlight(dtSeconds, drawStartMs);

    // 指の x 位置は風と和音の定位へだけ弱く反映する（フレームレート非依存の追従）
    pan += (targetPan - pan) * (1 - Math.pow(1 - POINTER_PAN_SMOOTHING, dtSeconds * 60));

    // 圧迫の目標値へ pressLevel と同じ時定数で追従する。突破中に 0 へ滑らかに落ちる
    pressureLevel += (pressureTargetOf() - pressureLevel) * (1 - Math.pow(0.002, dtSeconds));

    const sample = sampleOf();
    audio.updateFlight(sample);
    lastAmp = audio.getAmp(); // analyser の読み出しは 1 フレーム 1 回

    const pressTarget = flight.pressing ? 1 : 0;
    pressLevel += (pressTarget - pressLevel) * (1 - Math.pow(0.002, dtSeconds));
    sink = smoothstep(0.97, 1.02, flight.altitude);
    const clearMix = smoothstep(0.98, 1.015, flight.altitude);

    clouds.draw({
      ctx: p.drawingContext as CanvasRenderingContext2D,
      width: p.width,
      height: p.height,
      altitude: flight.altitude,
      pressLevel,
      clearMix,
      pressure: pressureLevel,
      sink,
      amp: lastAmp,
      qualityLevel: quality.getLevel() as 0 | 1 | 2,
      timeMs: drawStartMs,
      motionScale: motionQuery.matches ? 0.5 : 1,
    });

    frameCounter.record(performance.now() - drawStartMs);
    if (isDebugMode && p.frameCount % 6 === 0) renderDebugOverlay();
  };
});
