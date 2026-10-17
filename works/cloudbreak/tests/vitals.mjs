#!/usr/bin/env node
// pnpm build の後に node works/cloudbreak/tests/vitals.mjs ─ レビュー指摘の再発防止テスト。
// ヘッドレス Chromium（Playwright）で長押し上昇を駆動し、3 項目を確認する:
//   1. dark-band: 上昇中（高度 0.5 以上）の連続フレームで、RGB<64 の不透明暗部が画面の 1% 未満
//      （背景 gradient の色混ぜが崩れると、画面上端から約 39% が純黒で塗られていた）
//   2. clear-pressure: clear 到達 1.2 秒後以降、pressure（描画と音響が受け取る値）が 0.02 未満で
//      共有 LPF が晴天の開放値（FILTER_HZ_BY_LAYER[3]）に近いこと
//   3. clear-sky: clear の空（画面の上 5%〜40% 帯）の平均色がお題 #7EC8F8 に近いこと（距離 45 未満）
// 使うのは window.__art と ?debug のオーバーレイ表示のみ。exit 0 で合格。
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK_DIR = join(HERE, "..");
const REPO_ROOT = join(WORK_DIR, "..", "..");
const { startStaticServer } = await import(join(REPO_ROOT, "scripts", "lib", "static-server.mjs"));

const VIEWPORTS = [
  { label: "1280", width: 1280, height: 800 },
  { label: "375", width: 375, height: 812 },
];
const DARK_RATIO_LIMIT = 0.01;
const CLEAR_PRESSURE_LIMIT = 0.02;
const CLEAR_FILTER_MIN_HZ = 4000; // FILTER_HZ_BY_LAYER[3] = 4800
const CLEAR_SKY = [126, 200, 248]; // #7EC8F8
const CLEAR_SKY_DISTANCE_LIMIT = 45;
const SETTLE_MS = 1200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function syntheticPointer(page, type, x, y) {
  await page.evaluate(
    ({ type, x, y }) => {
      const target = window.__pt && type !== "pointerdown" ? window.__pt : document.elementFromPoint(x, y) ?? document.body;
      if (type === "pointerdown") window.__pt = target;
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: x,
          clientY: y,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          button: type === "pointermove" ? -1 : 0,
          buttons: type === "pointerup" ? 0 : 1,
        }),
      );
      if (type === "pointerup") window.__pt = null;
    },
    { type, x, y },
  );
}

// ?debug オーバーレイの値と上端帯の暗部率を 16ms ごとに記録する計測器
async function installProbe(page) {
  await page.evaluate(() => {
    const canvas = document.querySelector("#p5-host canvas");
    const overlay = document.querySelector("#debug-overlay");
    // 計測に DOM が写らないようオーバーレイ自体は透明化する（テキストは読める）
    overlay.style.color = "transparent";
    overlay.style.background = "transparent";
    const ctx = canvas.getContext("2d");
    window.__vitals = { frames: [], running: true };
    window.__vitalsTimer = setInterval(() => {
      if (!window.__vitals.running) return;
      const text = overlay.textContent ?? "";
      const pick = (key) => (text.match(new RegExp(`${key}: ([0-9.]+)`)) ?? [])[1];
      const w = canvas.width;
      const h = canvas.height;
      const bandH = Math.min(320, h);
      let dark = 0;
      let total = 0;
      let topR = 0;
      let topG = 0;
      let topB = 0;
      let topN = 0;
      try {
        const image = ctx.getImageData(0, 0, w, h);
        const data = image.data;
        for (let y = 0; y < h; y += 4) {
          for (let x = 0; x < w; x += 4) {
            const i = (y * w + x) * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            if (y < bandH && r < 64 && g < 64 && b < 64 && data[i + 3] > 0) dark++;
            if (y >= h * 0.05 && y < h * 0.4) {
              topR += r;
              topG += g;
              topB += b;
              topN++;
            }
            total++;
          }
        }
      } catch {
        return;
      }
      window.__vitals.frames.push({
        state: (text.match(/state: (\w+)/) ?? [])[1] ?? null,
        altitude: pick("altitude") ? parseFloat(pick("altitude")) : null,
        pressure: pick("pressure") ? parseFloat(pick("pressure")) : null,
        filterHz: pick("filterHz") ? parseInt(pick("filterHz"), 10) : null,
        darkRatio: total > 0 ? dark / total : 1,
        sky: topN > 0 ? [Math.round(topR / topN), Math.round(topG / topN), Math.round(topB / topN)] : null,
      });
    }, 16);
  });
}

async function runViewport(serverUrl, viewport) {
  const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  try {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${serverUrl}/works/cloudbreak/?debug`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__art && typeof window.__art.getAmp === "function", null, { timeout: 8000 });
    await sleep(SETTLE_MS);
    const center = { x: viewport.width / 2, y: viewport.height / 2 };
    // 導入画面を抜けてから、離さずに押し続けて 1 回で最終層から突破する
    await syntheticPointer(page, "pointerdown", center.x, center.y);
    await sleep(120);
    await syntheticPointer(page, "pointerup", center.x, center.y);
    await sleep(600);
    await installProbe(page);
    await syntheticPointer(page, "pointerdown", center.x, center.y);
    await page.waitForFunction(() => String(window.__art.getState()) === "clear", null, { timeout: 30000 });
    // clear の余韻（CLEAR_HOLD_MS）と pressure の減衰が落ち着くまで待つ
    await sleep(1500);
    const frames = await page.evaluate(() => {
      window.__vitals.running = false;
      clearInterval(window.__vitalsTimer);
      return window.__vitals.frames;
    });
    await syntheticPointer(page, "pointerup", center.x, center.y);
    await context.close();

    const ascending = frames.filter((f) => f.state === "ascending" && f.altitude !== null && f.altitude >= 0.5);
    const maxDark = ascending.length > 0 ? Math.max(...ascending.map((f) => f.darkRatio)) : 1;
    const clear = frames.filter((f) => f.state === "clear" && f.altitude !== null);
    const clearSettled = clear.slice(Math.max(0, Math.floor(clear.length * 0.6)));
    const clearPressure = clearSettled.length > 0 ? Math.max(...clearSettled.map((f) => f.pressure ?? 1)) : 1;
    const clearFilter = clearSettled.length > 0 ? Math.min(...clearSettled.map((f) => f.filterHz ?? 0)) : 0;
    const sky = clearSettled.length > 0 ? clearSettled[clearSettled.length - 1].sky : null;
    const skyDistance = sky ? Math.round(Math.sqrt(CLEAR_SKY.reduce((sum, value, i) => sum + (value - sky[i]) ** 2, 0))) : 999;

    return {
      viewport: viewport.label,
      frames: frames.length,
      ascendingFrames: ascending.length,
      darkBand: { pass: ascending.length > 0 && maxDark < DARK_RATIO_LIMIT, maxDarkRatio: +maxDark.toFixed(4), limit: DARK_RATIO_LIMIT },
      clearPressure: { pass: clearSettled.length > 0 && clearPressure < CLEAR_PRESSURE_LIMIT && clearFilter >= CLEAR_FILTER_MIN_HZ, pressure: clearPressure, filterHz: clearFilter },
      clearSky: { pass: skyDistance < CLEAR_SKY_DISTANCE_LIMIT, sky, distance: skyDistance, target: "#7EC8F8" },
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const distIndex = join(REPO_ROOT, "dist", "works", "cloudbreak", "index.html");
  if (!existsSync(distIndex)) {
    console.error("vitals: dist/works/cloudbreak/index.html が無い。先に pnpm build");
    process.exit(1);
  }
  const server = await startStaticServer(join(REPO_ROOT, "dist"));
  const results = [];
  try {
    for (const viewport of VIEWPORTS) results.push(await runViewport(server.url, viewport));
  } finally {
    await server.close();
  }
  const pass = results.every((r) => r.darkBand.pass && r.clearPressure.pass && r.clearSky.pass);
  for (const r of results) {
    console.log(`${r.viewport}px: dark ${r.darkBand.pass ? "pass" : "FAIL"} (max ${(r.darkBand.maxDarkRatio * 100).toFixed(2)}%) / clearPressure ${r.clearPressure.pass ? "pass" : "FAIL"} (pressure ${r.clearPressure.pressure}, filterHz ${r.clearPressure.filterHz}) / clearSky ${r.clearSky.pass ? "pass" : "FAIL"} (dist ${r.clearSky.distance}, rgb(${r.clearSky.sky}))`);
  }
  console.log(`vitals: ${pass ? "pass" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}

main().catch((error) => {
  console.error(`vitals: ${error.stack ?? error.message}`);
  process.exit(1);
});
