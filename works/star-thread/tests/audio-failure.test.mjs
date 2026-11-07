// ============================================================
// tests/audio-failure.test.mjs ─ MF-1 の回帰テスト
// MusicBoxAudioEngine.start の配線失敗（createConvolver 故障注入 + suspended）で
// 作成済み context が残留せず、列が視覚時計へ退避して同じ星列・順序・寿命で
// 進むことを headless Chromium で検証する。
// 故障注入は合成条件であり、自然実機故障の主張ではない（有限観測プローブ）。
// 実行: リポジトリルートで node --test works/star-thread/tests/audio-failure.test.mjs
// ブラウザはルートの Playwright（verify ハーネスと同じ既定 Chromium）を使う。
// ============================================================

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";

const workDir = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const distDir = join(workDir, "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

async function ensureDist() {
  try {
    await stat(join(distDir, "index.html"));
    return;
  } catch {
    // dist が無いときだけビルドする（常時ビルドでテストを遅くしない）
  }
  const result = spawnSync("pnpm", ["--dir", workDir, "build"], { encoding: "utf8" });
  assert.equal(result.status, 0, `ビルドに失敗: ${result.stderr || result.stdout}`);
}

let server;
let baseUrl;

test.before(async () => {
  await ensureDist();
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      let path = decodeURIComponent(url.pathname);
      if (path.endsWith("/")) path += "index.html";
      const file = join(distDir, path.replace(/^\//, ""));
      if (!file.startsWith(distDir)) throw new Error("path traversal");
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function launchBrowser() {
  return chromium.launch({
    headless: true,
    executablePath: process.env.VERIFY_CHROMIUM_PATH || undefined,
    args: ["--autoplay-policy=user-gesture-required"],
  });
}

async function openWork(browser, { query = "", initScript } = {}) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    hasTouch: true,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  if (initScript) await page.addInitScript(initScript);
  const url = query ? `${baseUrl}?${query}` : baseUrl;
  await page.goto(url);
  await page.waitForFunction(() => typeof window.__art?.getState === "function", null, {
    timeout: 15_000,
  });
  return { context, page, pageErrors };
}

/** 導入の中央タップ（正本 §3。同一タップの解放で 3 星の最小報酬が星座になる） */
function tapOnce(page, x, y) {
  return page.touchscreen.tap(x, y);
}

/** MF-1 の症状＝firstAtMs が null の pending から進まない永久 waiting。寿命が進むこと */
function waitLeaveWaiting(page, timeout) {
  return page.waitForFunction(
    () => {
      const state = window.__art?.getState?.();
      return (
        state === "linking" ||
        state === "holding" ||
        state === "fading" ||
        state === "returning" ||
        state === "idle"
      );
    },
    null,
    { timeout, polling: 200 },
  );
}

const readProbe = (page) => page.evaluate(() => window.__probe ?? null);
const readAmp = (page) => page.evaluate(() => window.__art.getAmp());

test("MF-1: start の配線失敗で context を回収し、列は視覚時計へ退避する", { timeout: 90_000 }, async (t) => {
  // createConvolver を常に故障させ、かつ resume しても running にならない
  // suspended 環境を模擬する（故障注入と同じく合成条件。レビュー再現条件に合わせる）
  const initScript = `
    window.__probe = { created: 0, closed: 0, convolverCalls: 0 };
    const Native = window.AudioContext;
    class FaultContext extends Native {
      constructor(...args) {
        super(...args);
        window.__probe.created++;
      }
      get state() {
        return "suspended";
      }
      resume() {
        // 解錠が成立しない環境の模擬。解決しない Promise を返す
        return new Promise(() => {});
      }
      createConvolver() {
        window.__probe.convolverCalls++;
        throw new Error("probe: createConvolver fault");
      }
      close() {
        window.__probe.closed++;
        return super.close();
      }
    }
    window.AudioContext = FaultContext;
  `;
  const browser = await launchBrowser();
  t.after(async () => {
    await browser.close();
  });
  const { context, page, pageErrors } = await openWork(browser, { initScript });

  await tapOnce(page, 187, 333);
  // 変更前は context が残留して解錠登録も無いため、ここで永久 waiting になる
  await waitLeaveWaiting(page, 8_000);
  // 寿命も同じ（3 星 ≈ 最終音から保持+消退+返却で idle）
  await page.waitForFunction(() => window.__art?.getState?.() === "idle", null, {
    timeout: 12_000,
    polling: 250,
  });

  const probe = await readProbe(page);
  const amp = await readAmp(page);
  assert.ok(probe.created >= 1, "start 失敗でも context は一度は作られている");
  assert.equal(probe.closed, probe.created, "作成済み context は全て回収（close）される");
  assert.equal(probe.convolverCalls, probe.created, "故障は各 context の配線で 1 回ずつ起きている");
  assert.equal(amp, 0, "実振幅は 0（偽装しない）");
  assert.deepEqual(pageErrors, [], "故障がページエラーとして漏れない");

  // dispose（pagehide 経由）が回収済み状態でも冪等に受かること
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.waitForTimeout(300);
  assert.deepEqual(pageErrors, [], "回収後の dispose でエラーが出ない");
  const probeAfter = await readProbe(page);
  assert.equal(probeAfter.closed, probe.created, "dispose で二重 close しない");
  await context.close();
});

test("正常系: 解錠できれば音が出て、退避せず星座が進む", { timeout: 90_000 }, async (t) => {
  // 故障は注入せず、context の生成/回収だけ数える
  const initScript = `
    window.__probe = { created: 0, closed: 0, convolverCalls: 0 };
    const Native = window.AudioContext;
    class CountingContext extends Native {
      constructor(...args) {
        super(...args);
        window.__probe.created++;
      }
      createConvolver() {
        window.__probe.convolverCalls++;
        return super.createConvolver();
      }
      close() {
        window.__probe.closed++;
        return super.close();
      }
    }
    window.AudioContext = CountingContext;
  `;
  const browser = await launchBrowser();
  t.after(async () => {
    await browser.close();
  });
  const { context, page } = await openWork(browser, { initScript });

  await tapOnce(page, 187, 333);
  await waitLeaveWaiting(page, 8_000);
  await page.waitForFunction(() => (window.__art?.getAmp?.() ?? 0) > 0.001, null, {
    timeout: 6_000,
    polling: 100,
  });
  const amp = await readAmp(page);
  assert.ok(amp > 0.001, `実発音が観測できる（amp=${amp}）`);

  const probe = await readProbe(page);
  assert.equal(probe.created, 1, "context は 1 個だけ作る");
  assert.equal(probe.closed, 0, "正常系では回収しない");
  assert.equal(probe.convolverCalls, 1, "残響の IR 生成で Convolver を 1 回だけ作る");
  await context.close();
});

test("mute: Noop は context を作らず視覚時計で寿命を進める", { timeout: 90_000 }, async (t) => {
  const initScript = `
    window.__probe = { created: 0, closed: 0, convolverCalls: 0 };
    const Native = window.AudioContext;
    class CountingContext extends Native {
      constructor(...args) {
        super(...args);
        window.__probe.created++;
      }
    }
    window.AudioContext = CountingContext;
  `;
  const browser = await launchBrowser();
  t.after(async () => {
    await browser.close();
  });
  const { context, page } = await openWork(browser, { query: "mute", initScript });

  await tapOnce(page, 187, 333);
  await waitLeaveWaiting(page, 8_000);
  await page.waitForFunction(() => window.__art?.getState?.() === "idle", null, {
    timeout: 12_000,
    polling: 250,
  });

  const probe = await readProbe(page);
  const amp = await readAmp(page);
  assert.equal(probe.created, 0, "?mute は AudioContext を作らない");
  assert.equal(amp, 0, "mute の振幅は常に 0");
  await context.close();
});
