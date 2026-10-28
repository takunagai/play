// ============================================================
// main.ts ─ 状態機械・ポインタ入力・描画ループ（p5 インスタンスモード）
// 状態の正本は winding.ts（純粋状態機械）、描画は renderer.ts。このファイルは配線だけを持つ。
// 正本: docs/architecture.md §2〜§7。
// 開発用クエリ: ?mute（無音）/ ?debug（診断オーバーレイ + window.__art の値を表示）
// ============================================================

import P5 from "p5";
import "./style.css";

import { createAudioEngine } from "./audio/engine";
import { createFrameCounter, installArtHook } from "./art-hook";
import { BASE_MIDI } from "./music";
import { QualityController } from "./quality";
import { computeLayout, createRendererState, drawScene, type Layout, type RendererState } from "./renderer";
import {
  CONTACT_MIN_INTERVAL_MS,
  CONTACT_RIPPLE_STEPS,
  HITSTOP_MS,
  PARTICLE_COUNT_STEPS,
} from "./tuning";
import { createWindingEngine } from "./winding";

// p5 v2 の FES は偽陽性で fps を落とすため必ず止める
P5.disableFriendlyErrors = true;

const audio = createAudioEngine();
const quality = new QualityController(PARTICLE_COUNT_STEPS.length);
const frameCounter = createFrameCounter();
const rendererState: RendererState = createRendererState();

const hostEl = document.querySelector<HTMLDivElement>("#p5-host")!;
const gateEl = document.querySelector<HTMLDivElement>("#gate")!;
const debugOverlayEl = document.querySelector<HTMLPreElement>("#debug-overlay")!;
const isDebugMode = new URLSearchParams(location.search).has("debug");
if (isDebugMode) debugOverlayEl.hidden = false;

let lastAmp = 0;
let energy = 0;
let lastError = "";
let introHiddenAtMs: number | null = null;
/** 円外接触音の間引き（§8: 過密発音を 50ms 以上間引く） */
let lastContactNoteMs = -Infinity;
/** 巻き取り試行の識別子（音響 cue の gestureId。掴みごとに採番する） */
let gestureCounter = 0;
let activeGestureId = 0;
/** planClosure で音側が予約した閉鎖の token（commit までは cancelClosure で取り消せる） */
let plannedToken: number | null = null;

const engine = createWindingEngine({
  onGrab(x, y) {
    // 摩擦・拍下降は winding cue（start）で始める。掴みの局所爪音は接触音の契約のまま
    activeGestureId = ++gestureCounter;
    const grabSnapshot = engine.snapshot();
    if (grabSnapshot.beatOriginMs !== null) {
      audio.winding({
        gestureId: activeGestureId,
        phase: "start",
        progress: 0,
        speed: 0,
        accuracy: 1,
        atMs: performance.now(),
        beatOriginMs: grabSnapshot.beatOriginMs,
      });
    }
    noteAt(x, y, 0.8);
  },
  onContact(x, y) {
    rendererState.spawnContactRipple(x, y, performance.now());
    const nowMs = performance.now();
    if (nowMs - lastContactNoteMs >= CONTACT_MIN_INTERVAL_MS) {
      lastContactNoteMs = nowMs;
      noteAt(x, y, 0.4);
    }
  },
  onAccepted(timeline) {
    // 閉鎖音の予約は音側の時計で行う。音響カードは planClosureTimes（winding.ts）と同じ
    // 拍式を使うため、freezeAtMs（式の不動点）を渡すと戻りは pendingTimeline と厳密に一致する
    const origin = engine.snapshot().beatOriginMs;
    const accepted = timeline.closeAtMs - HITSTOP_MS;
    const planned = audio.planClosure(timeline.token, accepted, origin ?? accepted);
    if (planned.freezeAtMs !== timeline.freezeAtMs || planned.closeAtMs !== timeline.closeAtMs) {
      lastError = `閉鎖予定の不一致: audio=${planned.freezeAtMs}/${planned.closeAtMs}`;
    }
    plannedToken = timeline.token;
  },
  onCommitted(timeline) {
    // 閉鎖音（クリック・木胴・ベル）は planClosure で音側の時計に予約済み。ここでは触らない
    if (plannedToken === timeline.token) plannedToken = null;
  },
  onCancelled() {
    // 罰の大音量なし。未発音の閉鎖予約と同 gesture の摩擦・拍予約を消す
    if (plannedToken !== null) {
      audio.cancelClosure(plannedToken);
      plannedToken = null;
    }
    const cancelSnapshot = engine.snapshot();
    if (cancelSnapshot.beatOriginMs !== null) {
      audio.winding({
        gestureId: activeGestureId,
        phase: "cancel",
        progress: 0,
        speed: 0,
        accuracy: 0,
        atMs: performance.now(),
        beatOriginMs: cancelSnapshot.beatOriginMs,
      });
    }
  },
});

/** 接触音（局所音）。音程は位置で変えない（雛形の横移動音階を持ち込まない） */
function noteAt(x: number, y: number, velocity: number): void {
  audio.note({
    x: x / window.innerWidth,
    y: y / window.innerHeight,
    midi: BASE_MIDI,
    velocity,
  });
}

installArtHook({
  getAmp: () => lastAmp,
  getState: () => engine.snapshot().state,
  getFrameStats: () => frameCounter.stats(),
});

function currentGeometry(): Layout {
  return computeLayout(window.innerWidth, window.innerHeight);
}

function exitIntro(x: number, y: number): void {
  if (gateEl.classList.contains("is-hidden")) return;
  gateEl.classList.add("is-hidden");
  introHiddenAtMs = performance.now();
  // resume() の解決を待たない。音の成否に関わらず描画は続ける
  audio.start().catch((error: unknown) => {
    lastError = error instanceof Error ? error.message : String(error);
  });
  noteAt(x, y, 0.5);
}

new P5((p: P5) => {
  p.setup = () => {
    const canvas = p.createCanvas(window.innerWidth, window.innerHeight);
    canvas.parent(hostEl);
    // p5 v2 の既知の制約: pixelDensity は createCanvas の後に呼ぶ
    p.pixelDensity(1);

    window.addEventListener("pointerdown", (event: PointerEvent) => {
      const geometry = currentGeometry();
      if (engine.snapshot().state === "intro") {
        // 中央円盤内の押下だけが intro を抜ける（判定は engine。抜けた押下は巻き取りに流用されない）
        engine.pointerDown(
          { pointerId: event.pointerId, x: event.clientX, y: event.clientY, timeMs: performance.now() },
          geometry,
        );
        if (engine.snapshot().state !== "intro") exitIntro(event.clientX, event.clientY);
        return;
      }
      engine.pointerDown(
        { pointerId: event.pointerId, x: event.clientX, y: event.clientY, timeMs: performance.now() },
        geometry,
      );
      // 索端を掴めたら pointer capture を試みる（合成イベントでは失敗しうる。期待される例外だけを処理）
      if (engine.snapshot().state === "winding") {
        try {
          canvas.elt.setPointerCapture(event.pointerId);
        } catch {
          // capture できなくても window リスナーで所有権判定は守る
        }
      }
    }, { passive: true });

    window.addEventListener("pointermove", (event: PointerEvent) => {
      const geometry = currentGeometry();
      const timeMs = performance.now();
      const coalesced =
        typeof event.getCoalescedEvents === "function"
          ? event.getCoalescedEvents().map((item) => ({
              x: item.clientX,
              y: item.clientY,
              timeMs: item.timeStamp > 0 ? item.timeStamp : timeMs,
            }))
          : undefined;
      engine.pointerMove(
        { pointerId: event.pointerId, x: event.clientX, y: event.clientY, timeMs },
        geometry,
        coalesced,
      );
    }, { passive: true });

    const release = (event: PointerEvent): void => {
      engine.pointerUp({ pointerId: event.pointerId, timeMs: performance.now() });
    };
    window.addEventListener("pointerup", release, { passive: true });
    window.addEventListener("pointercancel", (event: PointerEvent) => {
      engine.pointerCancel({ pointerId: event.pointerId, timeMs: performance.now() });
    }, { passive: true });
    // 自分で解放した分は up 済みなので engine 側の所有権照合で無視される
    window.addEventListener("lostpointercapture", (event: PointerEvent) => {
      engine.lostPointercapture({ pointerId: event.pointerId, timeMs: performance.now() });
    }, { passive: true });

    window.addEventListener("blur", () => engine.interrupt(performance.now()));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        engine.interrupt(performance.now());
        // 非表示時は音側の予約・摩擦も止める（§7 suspend）。visibility 判定自体は main の責務
        audio.suspend();
      }
    });
    window.addEventListener(
      "resize",
      () => {
        // resize は幾何が変わるため未完の試行を破棄する（architecture.md §4）
        engine.interrupt(performance.now());
        p.resizeCanvas(window.innerWidth, window.innerHeight);
      },
      { passive: true },
    );
    window.addEventListener("contextmenu", (event) => event.preventDefault());
  };

  p.draw = () => {
    const drawStartMs = performance.now();
    const geometry = computeLayout(p.width, p.height);

    engine.tick(drawStartMs);
    lastAmp = audio.getAmp(); // analyser の読み出しは 1 フレーム 1 回
    energy = Math.max(0, energy - (p.deltaTime / 1000) * 0.4);
    audio.setEnergy(energy);
    quality.recordFrame(Math.min(p.deltaTime || 16.7, 100));

    const snapshot = engine.snapshot();
    // 巻き取り中の音響 cue（1 フレーム 1 回以下）。拍の予約は音側の lookahead で行う
    if (snapshot.state === "winding" && snapshot.beatOriginMs !== null) {
      audio.winding({
        gestureId: activeGestureId,
        phase: "move",
        progress: snapshot.progress,
        speed: snapshot.speed,
        accuracy: snapshot.accuracy,
        atMs: drawStartMs,
        beatOriginMs: snapshot.beatOriginMs,
      });
    }
    const ctx = p.drawingContext;
    ctx.save();
    drawScene(ctx, rendererState, {
      snapshot,
      nowMs: drawStartMs,
      width: p.width,
      height: p.height,
      qualityLevel: quality.getLevel(),
      amp: lastAmp,
      introHiddenAtMs,
    });
    ctx.restore();

    // 接触水紋の上限（品質の段ごと）
    const rippleCap = CONTACT_RIPPLE_STEPS[Math.min(quality.getLevel(), CONTACT_RIPPLE_STEPS.length - 1)];
    if (rendererState.contactRipples.length > rippleCap) {
      rendererState.contactRipples.splice(0, rendererState.contactRipples.length - rippleCap);
    }

    frameCounter.record(performance.now() - drawStartMs);
    if (isDebugMode && p.frameCount % 6 === 0) renderDebugOverlay(snapshot.state, geometry);
  };
});

function renderDebugOverlay(state: string, geometry: Layout): void {
  const stats = frameCounter.stats();
  const snapshot = engine.snapshot();
  const overlay: Record<string, string | number | boolean> = {
    state,
    amp: Math.round(lastAmp * 1000) / 1000,
    frames: stats.frames,
    meanDrawMs: Math.round(stats.meanDrawMs * 100) / 100,
    qualityLevel: quality.getLevel(),
    netAngle: Math.round(snapshot.netAngle * 1000) / 1000,
    tipAngle: Math.round(snapshot.tipAngle * 1000) / 1000,
    rings: snapshot.closedRingCount,
    freezeAtMs: snapshot.freezeAtMs ?? "",
    closeAtMs: snapshot.closeAtMs ?? "",
    sceneTimeMs: Math.round(snapshot.sceneTimeMs),
    R: Math.round(geometry.radius),
    lastError,
    ...audio.getDiagnostics(),
  };
  debugOverlayEl.textContent = Object.entries(overlay)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}
