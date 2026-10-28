// 実行: node --experimental-strip-types --test works/abyss-winder/tests/renderer.test.ts
// 既存のVite/Playwrightで実Canvasを描き、時計だけでなく索strokeとPNGを比較する。
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "vite";
import { after, before, test } from "node:test";
import type { WindingSnapshot } from "../src/winding.ts";

let server: Awaited<ReturnType<typeof createServer>>;
let browser: Awaited<ReturnType<typeof chromium.launch>>;
let baseUrl: string;

before(async () => {
  server = await createServer({
    root: new URL("../", import.meta.url).pathname,
    server: { host: "127.0.0.1", port: 0 },
    logLevel: "error",
  });
  await server.listen();
  baseUrl = server.resolvedUrls.local[0];
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.VERIFY_CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
});

after(async () => {
  await browser?.close();
  await server?.close();
  if (browser) assert.equal(browser.isConnected(), false, "検証用ブラウザを閉じる");
  if (server) assert.equal(server.httpServer?.listening, false, "自前Viteを停止する");
});

async function renderScenario(width: number, scenario: "hold" | "length", duration = 8000) {
  const height = width === 375 ? 812 : 800;
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.goto(`${baseUrl}?mute`);
    return await page.evaluate(async ({ width, height, scenario, duration }) => {
      const rendererPath = "/src/renderer.ts";
      const windingPath = "/src/winding.ts";
      const tuningPath = "/src/tuning.ts";
      const { computeLayout, createRendererState, drawScene } = await import(rendererPath);
      const { createWindingEngine } = await import(windingPath);
      const tuning = await import(tuningPath);
      const geometry = computeLayout(width, height);
      const engine = createWindingEngine({
        onGrab() {}, onContact() {}, onAccepted() {}, onCommitted() {}, onCancelled() {},
      });
      const tau = Math.PI * 2;
      engine.tick(0);
      engine.introTap(geometry.cx, geometry.cy, 100, geometry);
      const startAngle = engine.snapshot().tipAngle;
      const point = (angle: number, timeMs: number) => ({
        pointerId: 1,
        x: geometry.cx + geometry.radius * Math.cos(angle),
        y: geometry.cy + geometry.radius * Math.sin(angle),
        timeMs,
      });
      engine.tick(1000);
      engine.pointerDown(point(startAngle, 1000), geometry);
      let near: WindingSnapshot;
      for (let i = 1; i <= 64; i++) {
        const time = 1000 + duration * i / 64;
        engine.tick(time);
        engine.pointerMove(point(startAngle + tau * i / 64, time), geometry);
        if (i === 63) near = structuredClone(engine.snapshot());
      }
      const accepted: WindingSnapshot = structuredClone(engine.snapshot());
      if (accepted.state !== "aligning") throw new Error("有効一周の前提が壊れている");
      engine.tick(accepted.freezeAtMs);
      const frozen: WindingSnapshot = structuredClone(engine.snapshot());
      engine.tick(accepted.closeAtMs);
      const closing: WindingSnapshot = structuredClone(engine.snapshot());
      engine.pointerUp({ pointerId: 1, timeMs: accepted.closeAtMs });
      engine.tick(accepted.closeAtMs + 1000);
      const idle: WindingSnapshot = structuredClone(engine.snapshot());

      const capture = (snapshot: WindingSnapshot, nowMs: number, state = createRendererState()) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2Dがない");
        type Command = { op: string; args: number[] };
        type Stroke = { color: string; width: number; alpha: number; path: Command[] };
        const strokes: Stroke[] = [];
        let path: Command[] = [];
        const beginPath = ctx.beginPath.bind(ctx);
        ctx.beginPath = () => { path = []; beginPath(); };
        const arc = ctx.arc.bind(ctx);
        ctx.arc = (x, y, r, start, end, counterclockwise) => {
          path.push({ op: "arc", args: [x, y, r, start, end] });
          arc(x, y, r, start, end, counterclockwise);
        };
        const moveTo = ctx.moveTo.bind(ctx);
        ctx.moveTo = (x, y) => { path.push({ op: "move", args: [x, y] }); moveTo(x, y); };
        const lineTo = ctx.lineTo.bind(ctx);
        ctx.lineTo = (x, y) => { path.push({ op: "line", args: [x, y] }); lineTo(x, y); };
        const bezier = ctx.bezierCurveTo.bind(ctx);
        ctx.bezierCurveTo = (a, b, c, d, x, y) => {
          path.push({ op: "bezier", args: [a, b, c, d, x, y] });
          bezier(a, b, c, d, x, y);
        };
        const stroke = ctx.stroke.bind(ctx);
        ctx.stroke = () => {
          if ([tuning.PALETTE_ROPE, tuning.PALETTE_ROPE_DK, tuning.PALETTE_ROPE_HI, tuning.PALETTE_ROPE_TW]
            .map((color: string) => color.toLowerCase()).includes(String(ctx.strokeStyle))) {
            strokes.push({ color: String(ctx.strokeStyle), width: ctx.lineWidth, alpha: ctx.globalAlpha, path: structuredClone(path) });
          }
          stroke();
        };
        state.guideAlpha = 0;
        drawScene(ctx, state, { snapshot, nowMs, width, height, qualityLevel: 0, amp: 0, introHiddenAtMs: 0 });
        const pixels = ctx.getImageData(0, 0, width, height).data;
        let rustPixels = 0;
        let bottomRustPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 45 && pixels[i] > 1.3 * pixels[i + 1] && pixels[i + 1] > 1.1 * pixels[i + 2]) {
            rustPixels++;
            if (i / 4 >= width * (height - 2)) bottomRustPixels++;
          }
        }
        return { strokes, rustPixels, bottomRustPixels, png: canvas.toDataURL("image/png"), snapshot, nowMs };
      };
      if (scenario === "hold") {
        const state = createRendererState();
        return {
          near: capture(near, 1000 + duration * 63 / 64, state),
          // 一周前の索長を保った全周形が期待値。「次索長」への更新で張りを変えない。
          full: capture({ ...accepted, state: "winding", nextRopeLengthRatio: near.nextRopeLengthRatio }, 1000 + duration),
          aligning: capture(accepted, 1000 + duration, state),
          frozenStart: capture(frozen, accepted.freezeAtMs, state),
          frozenEnd: capture(frozen, accepted.closeAtMs - 0.01, state),
          closing: capture(closing, accepted.closeAtMs, state),
          closingMid: capture(closing, accepted.closeAtMs + tuning.RING_CLOSE_MS / 2, state),
          closed: capture({ ...closing, state: "settling" }, accepted.closeAtMs + tuning.RING_CLOSE_MS, state),
        };
      }
      return {
        short: capture({ ...idle, nextRopeLengthRatio: 0.30 }, accepted.closeAtMs + 1000),
        long: capture({ ...idle, nextRopeLengthRatio: 0.46 }, accepted.closeAtMs + 1000),
        natural: capture(idle, accepted.closeAtMs + 1000),
      };
    }, { width, height, scenario, duration });
  } finally {
    await page.close();
  }
}

async function saveEvidence(width: number, captures: Awaited<ReturnType<typeof renderScenario>>, prefix: string) {
  const dir = process.env.RENDERER_EVIDENCE_DIR;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  const measurements = {};
  for (const [name, capture] of Object.entries(captures)) {
    if (!capture) continue;
    const { png, ...measurement } = capture;
    await writeFile(`${dir}/${prefix}-${name}-${width}.png`, Buffer.from(png.split(",")[1], "base64"));
    measurements[name] = measurement;
  }
  await writeFile(`${dir}/${prefix}-${width}.json`, JSON.stringify(measurements, null, 2));
}

// Canvasへ渡した本体ベジェを細分し、画面内に見える弧長だけを積算する。
function visibleSlackLength(capture: { strokes: { color: string; path: { op: string; args: number[] }[] }[] }, width: number): number {
  const height = width === 375 ? 812 : 800;
  const path = capture.strokes.find((stroke) => stroke.color === "#8a4f38" && stroke.path.some((command) => command.op === "bezier"))?.path;
  assert.ok(path, "本体の垂れ索strokeがある");
  const start = path.find((command) => command.op === "move").args;
  const [ax, ay, bx, by, endX, endY] = path.find((command) => command.op === "bezier").args;
  let previous = start;
  let length = 0;
  for (let i = 1; i <= 2000; i++) {
    const t = i / 2000;
    const u = 1 - t;
    const current = [
      u ** 3 * start[0] + 3 * u * u * t * ax + 3 * u * t * t * bx + t ** 3 * endX,
      u ** 3 * start[1] + 3 * u * u * t * ay + 3 * u * t * t * by + t ** 3 * endY,
    ];
    if (current[0] >= 0 && current[0] <= width && current[1] >= 0 && current[1] <= height) {
      length += Math.hypot(current[0] - previous[0], current[1] - previous[1]);
    }
    previous = current;
  }
  return length;
}

for (const width of [375, 1280]) {
  test(`${width}px: 受理した全周索と垂れ索をaligning/hitstopで残して停止する`, async () => {
    const captures = await renderScenario(width, "hold");
    await saveEvidence(width, captures, "hold");
    assert.ok(captures.near.rustPixels > 1000);
    assert.ok(captures.full.strokes.length > 10);
    assert.deepEqual(captures.aligning.strokes, captures.full.strokes, "受理後も全周の同じ索を保持する");
    assert.ok(captures.aligning.rustPixels > 1000, "索の実画素が残る");
    assert.deepEqual(captures.frozenStart.strokes, captures.frozenEnd.strokes, "sceneTimeMs固定中は索の幾何と濃度を固定する");
    assert.ok(captures.frozenStart.rustPixels > 1000);
  });

  test(`${width}px: 速い一周で次索長が変わっても受理時の索形を変えない`, async () => {
    const captures = await renderScenario(width, "hold", 3200);
    await saveEvidence(width, captures, "fast-hold");
    assert.ok(captures.near.snapshot.nextRopeLengthRatio > captures.aligning.snapshot.nextRopeLengthRatio);
    assert.deepEqual(captures.aligning.strokes, captures.full.strokes);
    assert.deepEqual(captures.frozenStart.strokes, captures.frozenEnd.strokes);
  });

  test(`${width}px: 閉鎖境界でも索を消さず蓄積した全周索へ引き継ぐ`, async () => {
    const captures = await renderScenario(width, "hold");
    await saveEvidence(width, captures, "handoff");
    const visible = (capture: typeof captures.closing) => capture.strokes.filter((stroke) => stroke.alpha > 0);
    assert.deepEqual(visible(captures.closing), visible(captures.frozenEnd), "閉鎖開始の全周索と垂れ索は停止終端と同一");
    for (const capture of [captures.closingMid, captures.closed]) {
      assert.ok(visible(capture).some((stroke) => stroke.alpha >= 0.2), "弱い蓄積索の濃度を保つ（錆色の高輝度閾値は適用しない）");
      const arcs = visible(capture).flatMap((stroke) => stroke.path.filter((command) => command.op === "arc"));
      assert.ok(arcs.some((arc) => Math.abs(arc.args[4] - arc.args[3] - Math.PI * 2) < 1e-8), "青輪の閉鎖進捗に索の全周を切り戻さない");
    }
  });

  test(`${width}px: ratio 0.30/0.46で実PNGと画面内の索の弧長が変わる`, async () => {
    const captures = await renderScenario(width, "length");
    await saveEvidence(width, captures, "length");
    assert.ok(captures.short.png !== captures.long.png, "ratioだけの変更がPNGへ届く");
    const shortLength = visibleSlackLength(captures.short, width);
    const longLength = visibleSlackLength(captures.long, width);
    assert.ok(longLength > shortLength + 5, `長い索の可視弧長 ${longLength} > ${shortLength} + 5px`);
  });

  test(`${width}px: 実際の遅い正確な一周後が速い一周後より長い`, async () => {
    const slow = await renderScenario(width, "length", 8000);
    const fast = await renderScenario(width, "length", 3200);
    await saveEvidence(width, slow, "slow");
    await saveEvidence(width, fast, "fast");
    assert.equal(slow.natural.snapshot.state, "idle");
    assert.equal(fast.natural.snapshot.state, "idle");
    assert.ok(slow.natural.snapshot.nextRopeLengthRatio > fast.natural.snapshot.nextRopeLengthRatio);
    assert.ok(visibleSlackLength(slow.natural, width) > visibleSlackLength(fast.natural, width) + 5);
  });

  test(`${width}px: 短索も長索も下端に末端を見せず画面外へ沈む`, async () => {
    const captures = await renderScenario(width, "length");
    for (const capture of [captures.short, captures.long]) {
      assert.ok(capture.bottomRustPixels > 0, "下端2pxまで索の実画素が連続する");
      const curve = capture.strokes.flatMap((stroke) => stroke.path).find((command) => command.op === "bezier");
      assert.ok(curve.args[5] > (width === 375 ? 812 : 800), "索の終点は画面外に置く");
    }
  });
}
