#!/usr/bin/env node
// pnpm build の後に node works/cloudbreak/tests/vitals.mjs ─ レビュー指摘の再発防止テスト。
// ヘッドレス Chromium（Playwright）で長押し上昇を駆動し、6 項目を確認する:
//   1. dark-band: 上昇中（高度 0.5 以上）の連続フレームで、RGB<64 の不透明暗部が画面の 1% 未満
//      （背景 gradient の色混ぜが崩れると、画面上端から約 39% が純黒で塗られていた）
//   2. clear-pressure: clear 到達 1.2 秒後以降、pressure（描画と音響が受け取る値）が 0.02 未満で
//      共有 LPF が晴天の開放値（FILTER_HZ_BY_LAYER[3]）に近いこと
//   3. clear-sky: clear の空（画面の上 5%〜40% 帯）の平均色がお題 #7EC8F8 に近いこと（距離 45 未満）
//   4. wind-follow (V-2): 長押し中は風 gain が速度に追従し（高速域 ≥ 0.13、clear 保持中 ≤ 0.095）、
//      突破後の pointerup でも状態にかかわらず release 450ms 後に床 WIND_BASE_GAIN=0.045 へ戻る
//      （以前は clear での release が endLift を通らず風が床に戻らなかった）
//   5. voice-budget (V-3): 退いたドローン声の全 oscillator が同一停止時刻で止まり、突破のたびに
//      active source が持続分（15: chord 10 + 圧力音 2 + 風 1 + LFO 2）へ戻る。2 回突破しても増えない
//      （以前は声ごとに stop 済み 1 本だけが止まり、残り 2 本が停止時刻の無いまま積み上がった）
//   6. dry-fallback (MF-1): createConvolver() の故障注入でも配線は生き（isReady=true）、
//      短い press で amp > 0。dry 経路が先に成立し、wet だけが任意であることの確認
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
// ---- V-2: 風 gain（WIND_BASE_GAIN=0.045、押下最大 0.045+0.11、clear 保持中は押下フロア 0.078） ----
const WIND_HIGH_MIN = 0.13; // 速度上限（0.15）付近での風 gain の下限
const WIND_HOLD_MAX = 0.095; // clear 保持中（速度 0・押下中）の風 gain の上限
const WIND_RELEASE_MAX = 0.047; // 離して 450ms 後の床（0.045 + 許容差）
// ---- V-3: active source 予算 ----
const SUSTAINED_SOURCES = 15; // chord 5音×2 + 圧力音 2 + 風ノイズ 1 + 風 LFO 2
const SOURCE_CEILING = 48; // 持続 15 + ドローン 5声×3 + ベル 6声×3 の絶対上限
// ---- MF-1 ----
const CONVOLVER_FAULT = "injected convolver fault";
const AMPLITUDE_MIN = 0.002;

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

// ?debug オーバーレイの key: value 行を 1 回読む
async function readOverlay(page) {
  return page.evaluate(() => {
    const text = document.querySelector("#debug-overlay")?.textContent ?? "";
    const entries = {};
    for (const line of text.split("\n")) {
      const index = line.indexOf(": ");
      if (index > 0) entries[line.slice(0, index)] = line.slice(index + 2);
    }
    return entries;
  });
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
      const word = (key) => (text.match(new RegExp(`${key}: (\\w+)`)) ?? [])[1] ?? null;
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
        t: performance.now(),
        state: word("state"),
        isPressing: word("isPressing"),
        altitude: pick("altitude") ? parseFloat(pick("altitude")) : null,
        velocity: pick("velocity") ? parseFloat(pick("velocity")) : null,
        pressure: pick("pressure") ? parseFloat(pick("pressure")) : null,
        filterHz: pick("filterHz") ? parseInt(pick("filterHz"), 10) : null,
        amp: pick("amp") ? parseFloat(pick("amp")) : null,
        windGain: pick("windGain") ? parseFloat(pick("windGain")) : null,
        droneVoices: pick("droneVoices") ? parseInt(pick("droneVoices"), 10) : null,
        activeSources: pick("activeSources") ? parseInt(pick("activeSources"), 10) : null,
        darkRatio: total > 0 ? dark / total : 1,
        sky: topN > 0 ? [Math.round(topR / topN), Math.round(topG / topN), Math.round(topB / topN)] : null,
      });
    }, 16);
  });
}

const maxOf = (frames, key) => (frames.length > 0 ? Math.max(...frames.map((f) => f[key] ?? -Infinity)) : null);

async function runViewport(serverUrl, viewport) {
  const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  try {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${serverUrl}/works/cloudbreak/?debug`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__art && typeof window.__art.getAmp === "function", null, { timeout: 8000 });
    await sleep(SETTLE_MS);
    const center = { x: viewport.width / 2, y: viewport.height / 2 };
    // 導入画面を抜けてから計装を置く
    await syntheticPointer(page, "pointerdown", center.x, center.y);
    await sleep(120);
    await syntheticPointer(page, "pointerup", center.x, center.y);
    await sleep(600);
    await installProbe(page);

    // 1 回目の長押し: 上昇 → 突破 → clear を押したまま保持する（V-2 の再現経路）
    await syntheticPointer(page, "pointerdown", center.x, center.y);
    const tPress1 = await page.evaluate(() => performance.now());
    await page.waitForFunction(() => String(window.__art.getState()) === "clear", null, { timeout: 30000 });
    const tClear1 = await page.evaluate(() => performance.now());
    await sleep(2600); // 退いたドローン声のフェード（1.5s+0.1s）と突破ベルの減衰（2.4s）が終わるまで
    const settled1 = await readOverlay(page);

    // clear での離し（以前は state 门番のせいで endLift を通らなかった経路）
    await syntheticPointer(page, "pointerup", center.x, center.y);
    const tRelease1 = await page.evaluate(() => performance.now());
    await sleep(1000);

    // 再武装（高度 < 0.78）まで沈めてから 2 回目の突破（V-3 の蓄積を確かめる）
    await page.waitForFunction(() => {
      const text = document.querySelector("#debug-overlay")?.textContent ?? "";
      return /armed: true/.test(text) && /state: (descending|drifting)/.test(text);
    }, null, { timeout: 30000 });
    await syntheticPointer(page, "pointerdown", center.x, center.y);
    const tPress2 = await page.evaluate(() => performance.now());
    await page.waitForFunction(() => String(window.__art.getState()) === "clear", null, { timeout: 30000 });
    const tClear2 = await page.evaluate(() => performance.now());
    await sleep(2600);
    const settled2 = await readOverlay(page);
    await syntheticPointer(page, "pointerup", center.x, center.y);

    const frames = await page.evaluate(() => {
      window.__vitals.running = false;
      clearInterval(window.__vitalsTimer);
      return window.__vitals.frames;
    });
    await context.close();

    // ---- 既存 3 項目（dark / clearPressure / clearSky）----
    const ascending = frames.filter((f) => f.state === "ascending" && f.altitude !== null && f.altitude >= 0.5);
    const maxDark = ascending.length > 0 ? Math.max(...ascending.map((f) => f.darkRatio)) : 1;
    const clear = frames.filter((f) => f.state === "clear" && f.altitude !== null);
    const clearSettled = clear.slice(Math.max(0, Math.floor(clear.length * 0.6)));
    const clearPressure = clearSettled.length > 0 ? Math.max(...clearSettled.map((f) => f.pressure ?? 1)) : 1;
    const clearFilter = clearSettled.length > 0 ? Math.min(...clearSettled.map((f) => f.filterHz ?? 0)) : 0;
    const sky = clearSettled.length > 0 ? clearSettled[clearSettled.length - 1].sky : null;
    const skyDistance = sky ? Math.round(Math.sqrt(CLEAR_SKY.reduce((sum, value, i) => sum + (value - sky[i]) ** 2, 0))) : 999;

    // ---- V-2: 風 gain の速度追随と release ----
    // 保持中は clear 突入直後の追従（60ms ramp + オーバーレイ更新の遅れ）を避け、落着いた区間を見る
    const withWind = frames.filter((f) => f.windGain !== null);
    const ascendingWind = withWind.filter((f) => f.state === "ascending");
    const holdingWind = withWind.filter(
      (f) => f.state === "clear" && f.isPressing === "true" && f.t >= tClear1 + 600 && f.t < tRelease1 - 200,
    );
    // release の 450ms ramp（dispatch からのイベント伝搬を含め ~0.5s）が終わった後の区間
    const releasedWind = withWind.filter((f) => f.t >= tRelease1 + 600 && f.t <= tRelease1 + 1500);
    const windHigh = maxOf(ascendingWind, "windGain");
    const windHold = maxOf(holdingWind, "windGain");
    const windAfterRelease = maxOf(releasedWind, "windGain");
    const windFollow = {
      pass: windHigh !== null && windHold !== null && windHigh >= WIND_HIGH_MIN && windHold <= WIND_HOLD_MAX,
      windHigh,
      windHold,
      highMin: WIND_HIGH_MIN,
      holdMax: WIND_HOLD_MAX,
    };
    const windRelease = {
      pass: windAfterRelease !== null && windAfterRelease <= WIND_RELEASE_MAX,
      windAfterRelease,
      limit: WIND_RELEASE_MAX,
    };

    // ---- V-3: 突破後の active source 予算 ----
    const settledClear1 = withWind.filter((f) => f.state === "clear" && f.t >= tClear1 + 2400 && f.t < tRelease1);
    const settledClear2 = withWind.filter((f) => f.state === "clear" && f.t >= tClear2 + 2400);
    const budget1 = settledClear1.length > 0 ? settledClear1[settledClear1.length - 1] : null;
    const budget2 = settledClear2.length > 0 ? settledClear2[settledClear2.length - 1] : null;
    const maxSources = maxOf(withWind, "activeSources");
    const isSettledBudget = (frame) =>
      frame !== null && frame.activeSources === SUSTAINED_SOURCES && frame.droneVoices === 0;
    const voiceBudget = {
      pass:
        isSettledBudget(budget1) &&
        isSettledBudget(budget2) &&
        budget1.activeSources === budget2.activeSources &&
        maxSources !== null &&
        maxSources <= SOURCE_CEILING,
      sustained: SUSTAINED_SOURCES,
      after1st: budget1 ? { activeSources: budget1.activeSources, droneVoices: budget1.droneVoices } : null,
      after2nd: budget2 ? { activeSources: budget2.activeSources, droneVoices: budget2.droneVoices } : null,
      maxSources,
      ceiling: SOURCE_CEILING,
    };

    return {
      viewport: viewport.label,
      frames: frames.length,
      ascendingFrames: ascending.length,
      darkBand: { pass: ascending.length > 0 && maxDark < DARK_RATIO_LIMIT, maxDarkRatio: +maxDark.toFixed(4), limit: DARK_RATIO_LIMIT },
      clearPressure: { pass: clearSettled.length > 0 && clearPressure < CLEAR_PRESSURE_LIMIT && clearFilter >= CLEAR_FILTER_MIN_HZ, pressure: clearPressure, filterHz: clearFilter },
      clearSky: { pass: skyDistance < CLEAR_SKY_DISTANCE_LIMIT, sky, distance: skyDistance, target: "#7EC8F8" },
      windFollow,
      windRelease,
      voiceBudget,
      diagnostics: { settled1, settled2 },
    };
  } finally {
    await browser.close();
  }
}

// MF-1: createConvolver() だけを故障させ、dry 経路の成立を確かめる
async function runDryFallback(serverUrl) {
  const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await context.addInitScript(() => {
      AudioContext.prototype.createConvolver = function createConvolverFault() {
        throw new Error("injected convolver fault");
      };
    });
    const page = await context.newPage();
    await page.goto(`${serverUrl}/works/cloudbreak/?debug`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__art && typeof window.__art.getAmp === "function", null, { timeout: 8000 });
    await sleep(SETTLE_MS);
    const center = { x: 640, y: 400 };
    // 短い press（押す → なぞる → 離す）でも音が出ること
    await syntheticPointer(page, "pointerdown", center.x, center.y);
    await sleep(250);
    await syntheticPointer(page, "pointerup", center.x, center.y);
    let snapshot = null;
    let maxAmp = 0;
    for (let index = 0; index < 6; index++) {
      await sleep(120);
      snapshot = await readOverlay(page);
      const amp = parseFloat(snapshot.amp ?? "0");
      if (Number.isFinite(amp) && amp > maxAmp) maxAmp = amp;
    }
    await context.close();
    return {
      pass: snapshot?.isReady === "true" && snapshot?.lastAudioError === CONVOLVER_FAULT && maxAmp >= AMPLITUDE_MIN,
      isReady: snapshot?.isReady ?? null,
      lastAudioError: snapshot?.lastAudioError ?? null,
      maxAmp,
      amplitudeMin: AMPLITUDE_MIN,
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
  let dryFallback = null;
  try {
    for (const viewport of VIEWPORTS) results.push(await runViewport(server.url, viewport));
    dryFallback = await runDryFallback(server.url);
  } finally {
    await server.close();
  }
  const pass =
    results.every((r) => r.darkBand.pass && r.clearPressure.pass && r.clearSky.pass && r.windFollow.pass && r.windRelease.pass && r.voiceBudget.pass) &&
    dryFallback !== null &&
    dryFallback.pass;
  for (const r of results) {
    console.log(
      `${r.viewport}px: dark ${r.darkBand.pass ? "pass" : "FAIL"} (max ${(r.darkBand.maxDarkRatio * 100).toFixed(2)}%)` +
        ` / clearPressure ${r.clearPressure.pass ? "pass" : "FAIL"} (pressure ${r.clearPressure.pressure}, filterHz ${r.clearPressure.filterHz})` +
        ` / clearSky ${r.clearSky.pass ? "pass" : "FAIL"} (dist ${r.clearSky.distance}, rgb(${r.clearSky.sky}))` +
        ` / windFollow ${r.windFollow.pass ? "pass" : "FAIL"} (high ${r.windFollow.windHigh}, hold ${r.windFollow.windHold})` +
        ` / windRelease ${r.windRelease.pass ? "pass" : "FAIL"} (after ${r.windRelease.windAfterRelease})` +
        ` / voiceBudget ${r.voiceBudget.pass ? "pass" : "FAIL"} (1st ${JSON.stringify(r.voiceBudget.after1st)}, 2nd ${JSON.stringify(r.voiceBudget.after2nd)}, max ${r.voiceBudget.maxSources})`,
    );
  }
  console.log(
    `dry-fallback: ${dryFallback?.pass ? "pass" : "FAIL"} (isReady ${dryFallback?.isReady}, lastAudioError "${dryFallback?.lastAudioError}", maxAmp ${dryFallback?.maxAmp})`,
  );
  console.log(`vitals: ${pass ? "pass" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}

main().catch((error) => {
  console.error(`vitals: ${error.stack ?? error.message}`);
  process.exit(1);
});
