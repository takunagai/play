#!/usr/bin/env node
// pnpm verify <slug> [--url <base>] ─ 1 作品をヘッドレス Chromium で検証する（Playwright）。
//
// 既定は dist/ を静的配信して /works/<slug>/ を開く（先に pnpm build）。--url でプレビュー URL や本番も検証できる。
// ページが公開する window.__art（getAmp / getState / getFrameStats）だけを見る。確かめる項目:
//   1. console-and-network: コンソールエラー 0・ネットワーク 404 0
//   2. mouse-sound: 画面中央のタップで導入画面を抜け、合成 PointerEvent でコア操作（押す → なぞる → 離す）を 10 回 → getAmp() の最大値 > 0
//   3. touch-sound: CDP の Input.dispatchTouchEvent（本物のタッチ）で同じことをして getAmp() の最大値 > 0
//      （--autoplay-policy=user-gesture-required で起動する。タッチは指を離した時にしか音声を解錠できないため、マウスだけでは無音を見逃す）
//   4. no-horizontal-scroll: 375px・1280px で横スクロールなし（導入画面と操作後）
//   5. frame-stats: getFrameStats().meanDrawMs を記録（合否に使わない。GPU の無い環境では WebGL がソフトウェア描画になるため）
// 出力: .verify/<slug>/result.json とスクリーンショット 4 枚。1 項目でも fail なら exit 1。
//
// 環境変数 VERIFY_CHROMIUM_PATH: Playwright 同梱でない Chromium を使うときの実行ファイル
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT_DIR, SLUG_PATTERN } from "./lib/work-json.mjs";
import { startStaticServer } from "./lib/static-server.mjs";

const OPERATION_COUNT = 10;
const MOVES_PER_OPERATION = 8;
const MOVE_INTERVAL_MS = 40;
const DRAG_DISTANCE_RATIO = 0.18; // 画面短辺比
const SETTLE_MS = 1200;
const HOOK_TIMEOUT_MS = 8000;
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 375, height: 812 };

function parseArgs(argv) {
  const positional = [];
  let baseUrl = null;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--url") baseUrl = argv[++index];
    else if (argv[index].startsWith("--")) throw new Error(`不明なオプション: ${argv[index]}`);
    else positional.push(argv[index]);
  }
  if (positional.length !== 1 || !SLUG_PATTERN.test(positional[0])) {
    throw new Error("usage: pnpm verify <slug> [--url <base>]");
  }
  if (baseUrl !== null && !/^https?:\/\//.test(baseUrl)) throw new Error("--url は http(s):// から書く");
  return { slug: positional[0], baseUrl };
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** コア操作の 10 か所（画面比の始点と、なぞる向き） */
function operationPaths(viewport) {
  const shortEdge = Math.min(viewport.width, viewport.height);
  const distance = shortEdge * DRAG_DISTANCE_RATIO;
  const starts = [
    [0.3, 0.3], [0.6, 0.35], [0.45, 0.55], [0.25, 0.7], [0.7, 0.65],
    [0.5, 0.4], [0.35, 0.45], [0.65, 0.5], [0.4, 0.7], [0.55, 0.25],
  ];
  return starts.slice(0, OPERATION_COUNT).map(([fx, fy], index) => {
    const angle = (index / OPERATION_COUNT) * Math.PI * 2;
    const x = fx * viewport.width;
    const y = fy * viewport.height;
    return { x, y, dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance };
  });
}

/** ページ内で __art.getAmp() を 16ms ごとに見て最大値を保持する */
async function startAmpSampler(page) {
  await page.evaluate(() => {
    const art = window.__art;
    window.__verifyAmp = { max: 0, states: [] };
    window.__verifyTimer = setInterval(() => {
      if (!art) return;
      const amp = Number(art.getAmp()) || 0;
      if (amp > window.__verifyAmp.max) window.__verifyAmp.max = amp;
      const state = String(art.getState());
      const states = window.__verifyAmp.states;
      if (states[states.length - 1] !== state) states.push(state);
    }, 16);
  });
}

async function stopAmpSampler(page) {
  return page.evaluate(() => {
    clearInterval(window.__verifyTimer);
    return window.__verifyAmp;
  });
}

async function measureHorizontalScroll(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const scrollWidth = Math.max(root.scrollWidth, document.body ? document.body.scrollWidth : 0);
    return { innerWidth: window.innerWidth, scrollWidth, hasHorizontalScroll: scrollWidth > window.innerWidth + 1 };
  });
}

async function waitForHook(page) {
  try {
    await page.waitForFunction(
      () => window.__art && typeof window.__art.getAmp === "function" && typeof window.__art.getState === "function" && typeof window.__art.getFrameStats === "function",
      null,
      { timeout: HOOK_TIMEOUT_MS },
    );
    return true;
  } catch {
    return false;
  }
}

/** コンソールエラー・ページ例外・404 を集める */
function collectProblems(page, label, problems) {
  page.on("console", (message) => {
    if (message.type() === "error") problems.consoleErrors.push(`[${label}] ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.consoleErrors.push(`[${label}] pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() === 404) problems.notFound.push(`[${label}] ${response.url()}`);
  });
  page.on("requestfailed", (request) => problems.requestFailed.push(`[${label}] ${request.url()} ${request.failure()?.errorText ?? ""}`));
}

// ---- 合成 PointerEvent（マウス相当の経路） ----
async function syntheticPointer(page, type, x, y) {
  await page.evaluate(
    ({ type, x, y }) => {
      const target = window.__verifyPointerTarget && type !== "pointerdown" ? window.__verifyPointerTarget : document.elementFromPoint(x, y) ?? document.body;
      if (type === "pointerdown") window.__verifyPointerTarget = target;
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
      if (type === "pointerup") {
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
        window.__verifyPointerTarget = null;
      }
    },
    { type, x, y },
  );
}

async function syntheticOperation(page, path) {
  await syntheticPointer(page, "pointerdown", path.x, path.y);
  for (let step = 1; step <= MOVES_PER_OPERATION; step++) {
    await sleep(MOVE_INTERVAL_MS);
    const ratio = step / MOVES_PER_OPERATION;
    await syntheticPointer(page, "pointermove", path.x + path.dx * ratio, path.y + path.dy * ratio);
  }
  await syntheticPointer(page, "pointerup", path.x + path.dx, path.y + path.dy);
  await sleep(150);
}

// ---- CDP の本物のタッチ ----
async function touch(cdp, type, x, y) {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: type === "touchEnd" ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1, radiusX: 4, radiusY: 4, force: 1 }],
  });
}

async function touchOperation(cdp, path) {
  await touch(cdp, "touchStart", path.x, path.y);
  for (let step = 1; step <= MOVES_PER_OPERATION; step++) {
    await sleep(MOVE_INTERVAL_MS);
    const ratio = step / MOVES_PER_OPERATION;
    await touch(cdp, "touchMove", path.x + path.dx * ratio, path.y + path.dy * ratio);
  }
  await touch(cdp, "touchEnd", path.x + path.dx, path.y + path.dy);
  await sleep(150);
}

async function launch(extraArgs) {
  const executablePath = process.env.VERIFY_CHROMIUM_PATH || undefined;
  return chromium.launch({ headless: true, executablePath, args: extraArgs });
}

/**
 * 1 つの画面サイズで検証する。mode: "mouse"（自動再生許可・合成 PointerEvent）/ "touch"（許可なし・CDP のタッチ）
 */
async function runViewport({ pageUrl, outDir, mode, viewport, problems }) {
  const label = `${viewport.width}`;
  const isTouch = mode === "touch";
  // ヘッドレスは既定で自動再生を許すため、タッチ側は実機と同じ「操作が要る」方針を明示する
  const browser = await launch([`--autoplay-policy=${isTouch ? "user-gesture-required" : "no-user-gesture-required"}`]);
  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      hasTouch: isTouch,
      isMobile: isTouch,
    });
    const page = await context.newPage();
    collectProblems(page, label, problems);
    await page.goto(pageUrl, { waitUntil: "load" });
    const hasHook = await waitForHook(page);
    await sleep(SETTLE_MS);

    const introScroll = await measureHorizontalScroll(page);
    await page.screenshot({ path: join(outDir, `intro-${label}.png`) });
    const introState = hasHook ? await page.evaluate(() => String(window.__art.getState())) : null;

    let amp = { max: 0, states: [] };
    if (hasHook) {
      await startAmpSampler(page);
      const center = { x: viewport.width / 2, y: viewport.height / 2 };
      const paths = operationPaths(viewport);
      if (isTouch) {
        const cdp = await context.newCDPSession(page);
        await touch(cdp, "touchStart", center.x, center.y);
        await sleep(80);
        await touch(cdp, "touchEnd", center.x, center.y);
        await sleep(400);
        for (const path of paths) await touchOperation(cdp, path);
      } else {
        await syntheticPointer(page, "pointerdown", center.x, center.y);
        await sleep(80);
        await syntheticPointer(page, "pointerup", center.x, center.y);
        await sleep(400);
        for (const path of paths) await syntheticOperation(page, path);
      }
      await sleep(300);
      amp = await stopAmpSampler(page);
    }

    const afterScroll = await measureHorizontalScroll(page);
    await page.screenshot({ path: join(outDir, `after-${label}.png`) });
    const frameStats = hasHook ? await page.evaluate(() => window.__art.getFrameStats()) : null;
    const audioState = await page.evaluate(() => (window.__art ? String(window.__art.getState()) : null));
    await context.close();
    return { hasHook, introState, finalState: audioState, maxAmp: amp.max, states: amp.states, introScroll, afterScroll, frameStats };
  } finally {
    await browser.close();
  }
}

async function main() {
  const { slug, baseUrl } = parseArgs(process.argv.slice(2));
  const outDir = join(ROOT_DIR, ".verify", slug);
  await mkdir(outDir, { recursive: true });

  let server = null;
  let base = baseUrl;
  if (!base) {
    const distIndex = join(ROOT_DIR, "dist", "works", slug, "index.html");
    if (!existsSync(distIndex)) throw new Error(`dist/works/${slug}/index.html が無い。先に pnpm build（または --url を指定）`);
    server = await startStaticServer(join(ROOT_DIR, "dist"));
    base = server.url;
  }
  const pageUrl = new URL(`works/${slug}/`, base.endsWith("/") ? base : `${base}/`).href;
  console.log(`verify: ${pageUrl}`);

  const problems = { consoleErrors: [], notFound: [], requestFailed: [] };
  let desktop;
  let mobile;
  try {
    desktop = await runViewport({ pageUrl, outDir, mode: "mouse", viewport: DESKTOP, problems });
    mobile = await runViewport({ pageUrl, outDir, mode: "touch", viewport: MOBILE, problems });
  } finally {
    if (server) await server.close();
  }

  const hookNote = (run) => (run.hasHook ? "" : "window.__art が無い（または 3 関数が揃っていない）");
  const checks = {
    "console-and-network": {
      pass: problems.consoleErrors.length === 0 && problems.notFound.length === 0,
      consoleErrors: problems.consoleErrors,
      notFound: problems.notFound,
      requestFailed: problems.requestFailed,
    },
    "mouse-sound": {
      pass: desktop.hasHook && desktop.maxAmp > 0,
      maxAmp: desktop.maxAmp,
      introState: desktop.introState,
      states: desktop.states,
      note: hookNote(desktop),
    },
    "touch-sound": {
      pass: mobile.hasHook && mobile.maxAmp > 0,
      maxAmp: mobile.maxAmp,
      introState: mobile.introState,
      states: mobile.states,
      note: hookNote(mobile),
    },
    "no-horizontal-scroll": {
      pass: [desktop.introScroll, desktop.afterScroll, mobile.introScroll, mobile.afterScroll].every((item) => !item.hasHorizontalScroll),
      "1280": { intro: desktop.introScroll, after: desktop.afterScroll },
      "375": { intro: mobile.introScroll, after: mobile.afterScroll },
    },
    "frame-stats": {
      pass: true,
      note: "記録のみ（合否に使わない）",
      "1280": desktop.frameStats,
      "375": mobile.frameStats,
    },
  };
  const isPass = Object.values(checks).every((check) => check.pass);
  const result = {
    slug,
    url: pageUrl,
    verifiedAt: new Date().toISOString(),
    playwright: (await import("playwright/package.json", { with: { type: "json" } })).default.version,
    browser: process.env.VERIFY_CHROMIUM_PATH ? `custom: ${process.env.VERIFY_CHROMIUM_PATH}` : "playwright chromium headless shell",
    pass: isPass,
    checks,
    screenshots: ["intro-1280.png", "after-1280.png", "intro-375.png", "after-375.png"],
  };
  await writeFile(join(outDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);

  for (const [name, check] of Object.entries(checks)) {
    let detail = "";
    if (name === "console-and-network") detail = `errors ${check.consoleErrors.length} / 404 ${check.notFound.length}`;
    if (name === "mouse-sound" || name === "touch-sound") detail = `maxAmp ${check.maxAmp.toFixed(4)} states ${check.states.join("→")} ${check.note}`;
    if (name === "frame-stats") detail = `meanDrawMs 1280=${check["1280"]?.meanDrawMs?.toFixed(2)} 375=${check["375"]?.meanDrawMs?.toFixed(2)}`;
    console.log(`  ${check.pass ? "pass" : "FAIL"}  ${name}  ${detail}`);
  }
  for (const line of [...problems.consoleErrors, ...problems.notFound]) console.log(`    - ${line}`);
  console.log(`verify: ${isPass ? "pass" : "FAIL"} → .verify/${slug}/result.json`);
  process.exit(isPass ? 0 : 1);
}

main().catch((error) => {
  console.error(`verify: ${error.stack ?? error.message}`);
  process.exit(1);
});
