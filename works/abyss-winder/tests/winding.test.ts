// ============================================================
// winding.test.ts ─ 円周巻き取り判定の作品固有回帰テスト（正本）
// 実行: node --experimental-strip-types --test tests/winding.test.ts
// 正本: docs/architecture.md §3〜§5 の状態機械・円周角度の連続追跡・共通時刻契約。
// 純粋な入力遷移を fake 時計で検証する（受入項目 1・2 の機械部分）。
// ============================================================
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createWindingEngine,
  normalizeAngleDelta,
  planClosureTimes,
  radialBand,
  segmentMinDistance,
} from "../src/winding.ts";
import type { Geometry, WindingEngine, WindingHandlers } from "../src/winding.ts";
import {
  EIGHTH_MS,
  HITSTOP_MS,
  NEXT_TIP_STEP_RAD,
  RING_CLOSE_MS,
  SETTLE_MS,
  START_ANGLE,
  TIP_HIT_RADIUS_PX,
} from "../src/tuning.ts";

const G: Geometry = { cx: 200, cy: 300, radius: 100, rimWidth: 10 };
const T0 = 1000;

interface Log {
  grabs: number;
  contacts: [number, number][];
  accepted: number[];
  committed: number[];
  cancelled: string[];
}

function makeEngine(): { engine: WindingEngine; log: Log } {
  const log: Log = { grabs: 0, contacts: [], accepted: [], committed: [], cancelled: [] };
  const handlers: WindingHandlers = {
    onGrab: () => {
      log.grabs++;
    },
    onContact: (x, y) => {
      log.contacts.push([x, y]);
    },
    onAccepted: (timeline) => {
      log.accepted.push(timeline.token);
    },
    onCommitted: (timeline) => {
      log.committed.push(timeline.token);
    },
    onCancelled: (reason) => {
      log.cancelled.push(reason);
    },
  };
  const engine = createWindingEngine(handlers);
  // 既定では中央タップで intro を抜けた idle から始める（intro 自体の検証は専用テスト）
  engine.tick(T0 - 1000);
  assert.ok(engine.introTap(G.cx, G.cy, T0 - 500, G), "中央タップで idle へ移行する前提が壊れている");
  engine.tick(T0 - 400);
  return { engine, log };
}

/** 索端の現在角（次索の角度）を押す。有効掴みの入口 */
function tapTip(engine: WindingEngine, g: Geometry, timeMs: number, pointerId = 1): void {
  const tip = engine.snapshot().tipAngle;
  engine.pointerDown({ pointerId, x: g.cx + g.radius * Math.cos(tip), y: g.cy + g.radius * Math.sin(tip), timeMs }, g);
}

/** fromAngle から toAngle へ（時計回り = 角度を増やす向き）を等分割でなぞる */
function dragArc(
  engine: WindingEngine,
  g: Geometry,
  fromAngle: number,
  toAngle: number,
  tStart: number,
  tEnd: number,
  pointerId = 1,
  steps = 64,
): void {
  for (let i = 1; i <= steps; i++) {
    const ratio = i / steps;
    const angle = fromAngle + (toAngle - fromAngle) * ratio;
    const timeMs = tStart + (tEnd - tStart) * ratio;
    engine.pointerMove(
      {
        pointerId,
        x: g.cx + g.radius * Math.cos(angle),
        y: g.cy + g.radius * Math.sin(angle),
        timeMs,
      },
      g,
    );
  }
}

function dragFullLap(engine: WindingEngine, g: Geometry, tStart: number, tEnd: number, pointerId = 1): void {
  const start = engine.snapshot().startAngle ?? START_ANGLE;
  dragArc(engine, g, start, start + Math.PI * 2, tStart, tEnd, pointerId);
}

// ============================================================
// 純関数
// ============================================================

test("normalizeAngleDelta は -π..π に正規化し、境界をまたぐ差を連続に扱う", () => {
  // 時計回りに ±π 境界をまたぐ差は小さな正の値になる
  assert.ok(Math.abs(normalizeAngleDelta(-Math.PI + 0.2, Math.PI - 0.1) - 0.3) < 1e-9);
  // 反時計回りは小さな負の値
  assert.ok(Math.abs(normalizeAngleDelta(Math.PI - 0.1, -Math.PI + 0.1) + 0.2) < 1e-9);
  assert.ok(Math.abs(normalizeAngleDelta(0.05, -0.05) - 0.1) < 1e-9);
  assert.ok(Math.abs(normalizeAngleDelta(-0.05, 0.05) + 0.1) < 1e-9);
  assert.ok(Math.abs(normalizeAngleDelta(Math.PI / 2 + Math.PI * 5, Math.PI / 2) - Math.PI) < 1e-9);
});

test("radialBand は max(24, 0.18R)", () => {
  assert.equal(radialBand(100), 24);
  assert.equal(radialBand(200), 36);
});

test("segmentMinDistance は中心横切りの近道を数値で捉える", () => {
  // 円周上の 2 点（角度 0 と π）を結ぶ線分は中心を通る
  const d = segmentMinDistance(300, 300, 100, 300, 200, 300);
  assert.ok(d < 1e-9, `中心直通の最短距離: ${d}`);
  // 円周上の近い 2 点は中心から遠い
  const near = segmentMinDistance(300, 300, 290, 300, 200, 300);
  assert.ok(near > 80, `近傍線分の最短距離: ${near}`);
});

test("planClosureTimes: 停止は常に 140ms、閉鎖は拍グリッド上、停止前の待ち 250ms 未満", () => {
  // 各拍位相で確かめる
  for (let offset = 0; offset < EIGHTH_MS; offset += 37) {
    const beatOriginMs = 1000;
    const acceptedAtMs = beatOriginMs + offset;
    const plan = planClosureTimes(acceptedAtMs, beatOriginMs);
    assert.equal(plan.closeAtMs - plan.freezeAtMs, HITSTOP_MS, `offset ${offset}`);
    assert.equal((plan.closeAtMs - beatOriginMs) % EIGHTH_MS, 0, `offset ${offset} で拍グリッドから外れる`);
    assert.ok(
      plan.freezeAtMs - acceptedAtMs >= 0 && plan.freezeAtMs - acceptedAtMs < EIGHTH_MS,
      `offset ${offset} の停止前の待ち: ${plan.freezeAtMs - acceptedAtMs}`,
    );
  }
  // acceptedAtMs + 140 がちょうど拍境界に乗る場合はその拍（ceil は同値を上げない）
  const onBeat = planClosureTimes(1000 + EIGHTH_MS - HITSTOP_MS, 1000);
  assert.equal(onBeat.closeAtMs, 1000 + EIGHTH_MS);
});

// ============================================================
// 一周成立と緩めない完成判定
// ============================================================

test("中央タップで intro を抜け、その押下は巻き取りに流用されない", () => {
  const log: Log = { grabs: 0, contacts: [], accepted: [], committed: [], cancelled: [] };
  const engine = createWindingEngine({
    onGrab: () => log.grabs++,
    onContact: () => {},
    onAccepted: () => {},
    onCommitted: () => {},
    onCancelled: () => {},
  });
  engine.tick(T0);
  assert.equal(engine.snapshot().state, "intro");
  // 中央の押下（円盤内）で idle へ
  assert.ok(engine.introTap(G.cx, G.cy, T0 + 10, G));
  assert.equal(engine.snapshot().state, "idle");
  // 同じ押下が続いても巻き取りは始まらない（導入押下の流用禁止）
  engine.pointerMove({ pointerId: 1, x: G.cx, y: G.cy, timeMs: T0 + 20 }, G);
  assert.equal(engine.snapshot().state, "idle");
  assert.equal(log.grabs, 0);
  // 円盤外の押下では intro を抜けない
  const outside = createWindingEngine({
    onGrab: () => {},
    onContact: () => {},
    onAccepted: () => {},
    onCommitted: () => {},
    onCancelled: () => {},
  });
  outside.tick(T0);
  assert.ok(!outside.introTap(0, 0, T0 + 10, G));
  assert.equal(outside.snapshot().state, "intro");
});

test("途切れない有効一周で一段だけ閉じる", () => {
  const { engine, log } = makeEngine();
  engine.tick(T0);
  tapTip(engine, G, T0);
  assert.equal(engine.snapshot().state, "winding");
  dragFullLap(engine, G, T0 + 50, T0 + 2050);
  const snap = engine.snapshot();
  assert.equal(log.accepted.length, 1, "accept は 1 回");
  assert.equal(snap.state, "aligning", "一周成立後は aligning");
  assert.ok(snap.progress >= 1, `progress: ${snap.progress}`);

  // 時刻契約を tick で進める
  const timeline = snap;
  assert.ok(timeline.freezeAtMs !== null && timeline.closeAtMs !== null);
  engine.tick(timeline.freezeAtMs - 1);
  assert.equal(engine.snapshot().state, "aligning");
  engine.tick(timeline.freezeAtMs);
  assert.equal(engine.snapshot().state, "hitstop");
  engine.tick(timeline.closeAtMs);
  const closed = engine.snapshot();
  assert.equal(closed.state, "closing");
  assert.equal(log.committed.length, 1, "commit は 1 回");
  assert.equal(closed.closedRingCount, 1, "輪は 1 段");

  // settling → idle
  engine.tick(timeline.closeAtMs + RING_CLOSE_MS);
  assert.equal(engine.snapshot().state, "settling");
  engine.tick(timeline.closeAtMs + SETTLE_MS);
  assert.equal(engine.snapshot().state, "idle");
});

test("359度では閉じない", () => {
  const { engine, log } = makeEngine();
  engine.tick(T0);
  tapTip(engine, G, T0);
  const start = engine.snapshot().startAngle!;
  dragArc(engine, G, start, start + Math.PI * 2 * (359 / 360), T0 + 50, T0 + 2050);
  const snap = engine.snapshot();
  assert.equal(log.accepted.length, 0, "一周未満では accept しない");
  assert.equal(snap.state, "winding");
  assert.ok(snap.progress < 1);
});

test("角度境界（±π）をまたぐ一周が連続に数えられる", () => {
  // 索端（π/2 = 窓の下）から時計回りに一周すると、theta は必ず ±π 境界をまたぐ。
  // atan2 の値域ジャンプが進捗を壊さないことを一周で確かめる
  const { engine, log } = makeEngine();
  engine.tick(T0);
  tapTip(engine, G, T0);
  dragFullLap(engine, G, T0 + 50, T0 + 2050);
  assert.equal(log.accepted.length, 1, "境界をまたぐ一周は accept する");
});

test("半周を離して 2 回押し直しても閉じない", () => {
  const { engine, log } = makeEngine();
  engine.tick(T0);
  tapTip(engine, G, T0);
  const start = engine.snapshot().startAngle!;
  dragArc(engine, G, start, start + Math.PI, T0 + 50, T0 + 550);
  engine.pointerUp({ pointerId: 1, timeMs: T0 + 560 });
  assert.equal(engine.snapshot().state, "cancelled");
  // 押し直し（netAngle は再利用されない）
  engine.tick(T0 + 800);
  tapTip(engine, G, T0 + 800);
  const start2 = engine.snapshot().startAngle!;
  assert.equal(engine.snapshot().netAngle, 0, "押し直しで netAngle は 0 から");
  dragArc(engine, G, start2, start2 + Math.PI * 1.5, T0 + 850, T0 + 1850);
  assert.equal(log.accepted.length, 0, "半周 + 1.5周の累積再利用では閉じない");
});

test("手ぶれ幅の往復では進捗が増えない（ラチェットにしない）", () => {
  const { engine } = makeEngine();
  engine.tick(T0);
  tapTip(engine, G, T0);
  const start = engine.snapshot().startAngle!;
  // 0.06rad の行って戻り（逆走許容 0.08rad 以内の往復）
  dragArc(engine, G, start, start + 0.06, T0 + 50, T0 + 250);
  const forward = engine.snapshot().netAngle;
  dragArc(engine, G, start + 0.06, start, T0 + 250, T0 + 450);
  const back = engine.snapshot().netAngle;
  assert.equal(engine.snapshot().state, "winding", "往復は失敗にしない");
  assert.ok(forward > 0.05);
  assert.ok(Math.abs(back) < 0.01, `往復後の netAngle: ${back}`);
});

test("highWater から 0.08rad を超える逆走はキャンセル", () => {
  const { engine, log } = makeEngine();
  engine.tick(T0);
  tapTip(engine, G, T0);
  const start = engine.snapshot().startAngle!;
  dragArc(engine, G, start, start + 0.5, T0 + 50, T0 + 250);
  assert.equal(engine.snapshot().state, "winding");
  dragArc(engine, G, start + 0.5, start + 0.3, T0 + 250, T0 + 350);
  assert.equal(engine.snapshot().state, "cancelled");
  assert.deepEqual(log.cancelled, ["reversal"]);
});

test("中心を横切る近道はキャンセル", () => {
  const { engine, log } = makeEngine();
  engine.tick(T0);
  tapTip(engine, G, T0);
  const start = engine.snapshot().startAngle!;
  // 円周上を少し進んでから、反対側の円周へ直線移動（線分が中心を通る）
  dragArc(engine, G, start, start + 0.2, T0 + 50, T0 + 150);
  engine.pointerMove({ pointerId: 1, x: G.cx + G.radius * Math.cos(start + 0.2 + Math.PI), y: G.cy + G.radius * Math.sin(start + 0.2 + Math.PI), timeMs: T0 + 200 }, G);
  assert.equal(engine.snapshot().state, "cancelled");
  assert.ok(log.cancelled.includes("center-cross"));
});

test("帯域外への逸脱はキャンセル、押し直すまで再加算しない", () => {
  const { engine, log } = makeEngine();
  engine.tick(T0);
  tapTip(engine, G, T0);
  const start = engine.snapshot().startAngle!;
  dragArc(engine, G, start, start + 0.3, T0 + 50, T0 + 150);
  const progressBefore = engine.snapshot().netAngle;
  assert.ok(progressBefore > 0.25);
  // 帯域外へ逸脱
  engine.pointerMove({ pointerId: 1, x: G.cx + (G.radius + radialBand(G.radius) + 20) * Math.cos(start + 0.4), y: G.cy + (G.radius + radialBand(G.radius) + 20) * Math.sin(start + 0.4), timeMs: T0 + 200 }, G);
  assert.equal(engine.snapshot().state, "cancelled");
  assert.ok(log.cancelled.includes("escape"));
  // 帯域へ戻っても押し直すまでは加算しない
  dragArc(engine, G, start + 0.4, start + 0.6, T0 + 250, T0 + 350);
  assert.equal(engine.snapshot().state, "cancelled");
  assert.equal(log.accepted.length, 0);
});

test("サンプル跳躍（|delta| > π/8）はキャンセル", () => {
  const { engine, log } = makeEngine();
  engine.tick(T0);
  tapTip(engine, G, T0);
  const start = engine.snapshot().startAngle!;
  engine.pointerMove({ pointerId: 1, x: G.cx + G.radius * Math.cos(start + 0.02), y: G.cy + G.radius * Math.sin(start + 0.02), timeMs: T0 + 50 }, G);
  // π/8 超だが中心を横切らない跳躍（0.45rad の弧の弦は中心から十分遠い）
  engine.pointerMove({ pointerId: 1, x: G.cx + G.radius * Math.cos(start + 0.02 + 0.45), y: G.cy + G.radius * Math.sin(start + 0.02 + 0.45), timeMs: T0 + 100 }, G);
  assert.equal(engine.snapshot().state, "cancelled");
  assert.ok(log.cancelled.includes("jump"));
});

test("250ms 超のサンプル欠落 + 0.08rad 超の角差はキャンセル。静止は失敗にしない", () => {
  const { engine, log } = makeEngine();
  engine.tick(T0);
  tapTip(engine, G, T0);
  const start = engine.snapshot().startAngle!;
  engine.pointerMove({ pointerId: 1, x: G.cx + G.radius * Math.cos(start + 0.02), y: G.cy + G.radius * Math.sin(start + 0.02), timeMs: T0 + 50 }, G);
  // 静止（同位置・時間だけ経過）は失敗にしない
  engine.pointerMove({ pointerId: 1, x: G.cx + G.radius * Math.cos(start + 0.02), y: G.cy + G.radius * Math.sin(start + 0.02), timeMs: T0 + 400 }, G);
  assert.equal(engine.snapshot().state, "winding");
  // 長い欠落のあとの移動
  engine.pointerMove({ pointerId: 1, x: G.cx + G.radius * Math.cos(start + 0.3), y: G.cy + G.radius * Math.sin(start + 0.3), timeMs: T0 + 800 }, G);
  assert.equal(engine.snapshot().state, "cancelled");
  assert.ok(log.cancelled.includes("gap"));
});

// ============================================================
// pointer の所有権と中断
// ============================================================

test("別 pointer の move は進捗に使わず、巻き取り中の別 pointerdown は試行をキャンセルする", () => {
  const { engine, log } = makeEngine();
  engine.tick(T0);
  tapTip(engine, G, T0);
  const start = engine.snapshot().startAngle!;
  dragArc(engine, G, start, start + 0.3, T0 + 50, T0 + 150);
  // 別 pointer の move は無視
  dragArc(engine, G, start + 0.3, start + 1.5, T0 + 150, T0 + 350, 2);
  const before = engine.snapshot().netAngle;
  assert.ok(before < 0.4, `別 pointer の進捗が混入: ${before}`);
  // 別 pointerdown でキャンセル
  engine.pointerDown({ pointerId: 2, x: G.cx, y: G.cy, timeMs: T0 + 360 }, G);
  assert.equal(engine.snapshot().state, "cancelled");
  assert.ok(log.cancelled.includes("foreign-pointer"));
  // 全指が離れるまで idle に戻らない（再開しない）
  dragArc(engine, G, start + 0.3, start + 0.6, T0 + 400, T0 + 500, 1);
  assert.equal(log.accepted.length, 0);
});

test("一周前の pointerup はキャンセル、成立後の up は許可する", () => {
  const { engine, log } = makeEngine();
  engine.tick(T0);
  tapTip(engine, G, T0);
  engine.pointerUp({ pointerId: 1, timeMs: T0 + 100 });
  assert.equal(engine.snapshot().state, "cancelled");
  assert.ok(log.cancelled.includes("release"));

  // 成立後の up: 一周を完遂してから離しても、その後の commit は予定どおり行われる
  const second = makeEngine();
  second.engine.tick(T0);
  tapTip(second.engine, G, T0);
  dragFullLap(second.engine, G, T0 + 50, T0 + 2050);
  assert.equal(second.engine.snapshot().state, "aligning");
  second.engine.pointerUp({ pointerId: 1, timeMs: T0 + 2100 });
  const timeline = second.engine.snapshot();
  second.engine.tick(timeline.freezeAtMs!);
  second.engine.tick(timeline.closeAtMs!);
  assert.equal(second.log.committed.length, 1, "成立後の離上で予定は壊れない");
});

test("pointercancel / 予期しない lostpointercapture は一周前の試行を破棄する", () => {
  const cancelCase = makeEngine();
  cancelCase.engine.tick(T0);
  tapTip(cancelCase.engine, G, T0);
  const start = cancelCase.engine.snapshot().startAngle!;
  dragArc(cancelCase.engine, G, start, start + 0.3, T0 + 50, T0 + 150);
  cancelCase.engine.pointerCancel({ pointerId: 1, timeMs: T0 + 160 });
  assert.equal(cancelCase.engine.snapshot().state, "cancelled");
  assert.ok(cancelCase.log.cancelled.includes("pointercancel"));

  const lostCase = makeEngine();
  lostCase.engine.tick(T0);
  tapTip(lostCase.engine, G, T0);
  const start2 = lostCase.engine.snapshot().startAngle!;
  dragArc(lostCase.engine, G, start2, start2 + 0.3, T0 + 50, T0 + 150);
  lostCase.engine.lostPointercapture({ pointerId: 1, timeMs: T0 + 160 });
  assert.equal(lostCase.engine.snapshot().state, "cancelled");
  assert.ok(lostCase.log.cancelled.includes("lostcapture"));
});

test("ページ全体の interrupt 後は旧ID7のrelease欠落でも新ID8で再開できる", () => {
  const { engine, log } = makeEngine();
  engine.tick(T0);
  tapTip(engine, G, T0, 7);
  dragArc(engine, G, START_ANGLE, START_ANGLE + Math.PI, T0 + 50, T0 + 550, 7);
  engine.interrupt(T0 + 560);
  assert.equal(engine.snapshot().state, "cancelled");
  assert.deepEqual(log.cancelled, ["interrupt"]);
  engine.tick(T0 + 739);
  assert.equal(engine.snapshot().state, "cancelled", "戻り演出の180msは維持する");
  engine.tick(T0 + 740);
  assert.equal(engine.snapshot().state, "idle", "旧IDの離上通知には依存しない");

  tapTip(engine, G, T0 + 750, 8);
  assert.equal(engine.snapshot().state, "winding");
  assert.equal(engine.snapshot().netAngle, 0, "中断前の半周は再利用しない");
  // 遅れて届いた旧IDの入力も新しい所有権を壊さない。
  engine.pointerUp({ pointerId: 7, timeMs: T0 + 760 });
  engine.pointerCancel({ pointerId: 7, timeMs: T0 + 770 });
  engine.lostPointercapture({ pointerId: 7, timeMs: T0 + 780 });
  dragFullLap(engine, G, T0 + 800, T0 + 2800, 8);
  assert.equal(log.grabs, 2);
  assert.equal(log.accepted.length, 1);
  engine.tick(engine.snapshot().closeAtMs!);
  assert.equal(engine.snapshot().closedRingCount, 1);
});

test("通常の多指キャンセルは全指のreleaseと180msを待つ", () => {
  const { engine, log } = makeEngine();
  engine.tick(T0);
  tapTip(engine, G, T0, 7);
  tapTip(engine, G, T0 + 10, 8);
  engine.tick(T0 + 1000);
  assert.equal(engine.snapshot().state, "cancelled");
  engine.pointerUp({ pointerId: 7, timeMs: T0 + 1010 });
  engine.tick(T0 + 2000);
  tapTip(engine, G, T0 + 2010, 9);
  assert.equal(engine.snapshot().state, "cancelled", "1指残った状態の新規押下も再開しない");
  assert.equal(log.grabs, 1);
  engine.pointerCancel({ pointerId: 8, timeMs: T0 + 2020 });
  engine.tick(T0 + 3000);
  assert.equal(engine.snapshot().state, "cancelled", "取消中に加わった指も離上待ちの対象");
  engine.pointerUp({ pointerId: 9, timeMs: T0 + 3010 });
  engine.tick(T0 + 3189);
  assert.equal(engine.snapshot().state, "cancelled");
  engine.tick(T0 + 3190);
  assert.equal(engine.snapshot().state, "idle");
  tapTip(engine, G, T0 + 3200, 10);
  assert.equal(engine.snapshot().state, "winding");
  assert.equal(log.grabs, 2);
  assert.deepEqual(log.cancelled, ["foreign-pointer"]);
});

test("多指キャンセル中の interrupt も旧release待ちを失効し重複取消しない", () => {
  const { engine, log } = makeEngine();
  engine.tick(T0);
  tapTip(engine, G, T0, 7);
  tapTip(engine, G, T0 + 10, 8);
  engine.interrupt(T0 + 20);
  engine.interrupt(T0 + 21); // blur / hidden 等の重複でも復帰待ちを延長しない。
  engine.tick(T0 + 199);
  assert.equal(engine.snapshot().state, "cancelled");
  engine.tick(T0 + 200);
  assert.equal(engine.snapshot().state, "idle");
  assert.deepEqual(log.cancelled, ["foreign-pointer"]);
  tapTip(engine, G, T0 + 210, 9);
  assert.equal(engine.snapshot().state, "winding");
  // 旧押下集合が残っていないことを、次の通常取消の復帰でも確認する。
  engine.pointerUp({ pointerId: 9, timeMs: T0 + 220 });
  engine.tick(T0 + 400);
  assert.equal(engine.snapshot().state, "idle");
});

test("hitstop の interrupt は未commitの一周を取り消し旧releaseなしで復帰する", () => {
  const { engine, log } = makeEngine();
  engine.tick(T0);
  tapTip(engine, G, T0, 7);
  dragFullLap(engine, G, T0 + 50, T0 + 2050, 7);
  const timeline = engine.snapshot();
  engine.tick(timeline.freezeAtMs!);
  assert.equal(engine.snapshot().state, "hitstop");
  engine.interrupt(timeline.closeAtMs! - 1);
  assert.equal(engine.snapshot().state, "cancelled");
  assert.equal(engine.snapshot().closeAtMs, null);
  engine.tick(timeline.closeAtMs! + 179);
  assert.equal(engine.snapshot().state, "idle");
  assert.equal(log.accepted.length, 1);
  assert.equal(log.committed.length, 0);
  assert.equal(engine.snapshot().closedRingCount, 0);
  assert.deepEqual(log.cancelled, ["interrupt"]);
});

test("commit後の closing / settling を interrupt しても完了輪は取り消さない", () => {
  for (const offset of [0, RING_CLOSE_MS]) {
    const { engine, log } = makeEngine();
    engine.tick(T0);
    tapTip(engine, G, T0, 7);
    dragFullLap(engine, G, T0 + 50, T0 + 2050, 7);
    const timeline = engine.snapshot();
    engine.tick(timeline.closeAtMs! + offset);
    const before = engine.snapshot();
    assert.equal(before.state, offset === 0 ? "closing" : "settling");
    engine.interrupt(timeline.closeAtMs! + offset + 1);
    assert.equal(engine.snapshot().state, before.state);
    assert.equal(engine.snapshot().committedToken, before.committedToken);
    assert.deepEqual(engine.snapshot().ringStartAngles, [START_ANGLE]);
    assert.equal(log.cancelled.length, 0);
    assert.equal(log.committed.length, 1);
    engine.tick(timeline.closeAtMs! + SETTLE_MS);
    tapTip(engine, G, timeline.closeAtMs! + SETTLE_MS + 10, 8);
    assert.equal(engine.snapshot().state, "winding");
    engine.pointerUp({ pointerId: 8, timeMs: timeline.closeAtMs! + SETTLE_MS + 20 });
    engine.tick(timeline.closeAtMs! + SETTLE_MS + 200);
    assert.equal(engine.snapshot().state, "idle", "完了後も旧ID7の離上待ちを残さない");
    assert.equal(engine.snapshot().closedRingCount, 1);
  }
});

test("blur / 非表示 / resize は winding・aligning・hitstop の予定を破棄する", () => {
  const windingCase = makeEngine();
  windingCase.engine.tick(T0);
  tapTip(windingCase.engine, G, T0);
  windingCase.engine.interrupt(T0 + 10);
  assert.equal(windingCase.engine.snapshot().state, "cancelled");

  const aligningCase = makeEngine();
  aligningCase.engine.tick(T0);
  tapTip(aligningCase.engine, G, T0);
  dragFullLap(aligningCase.engine, G, T0 + 50, T0 + 2050);
  const freezeAt = aligningCase.engine.snapshot().freezeAtMs!;
  aligningCase.engine.interrupt(freezeAt - 1);
  const after = aligningCase.engine.snapshot();
  assert.equal(after.state, "cancelled", "aligning 中の interrupt は予定を破棄");
  assert.equal(aligningCase.log.committed.length, 0, "破棄された予定は commit しない");
  // 破棄後は freezeAtMs を過ぎても予約を発火せず、旧releaseなしで idle に戻る。
  aligningCase.engine.tick(freezeAt + EIGHTH_MS * 3);
  assert.equal(aligningCase.engine.snapshot().state, "idle");
  assert.equal(aligningCase.log.committed.length, 0);
  assert.equal(aligningCase.engine.snapshot().closedRingCount, 0);
});

// ============================================================
// 重複と一回だけの保証
// ============================================================

test("accept 後の追加入力で二重予約しない・token は一回だけ commit する", () => {
  const { engine, log } = makeEngine();
  engine.tick(T0);
  tapTip(engine, G, T0);
  const start = engine.snapshot().startAngle!;
  dragFullLap(engine, G, T0 + 50, T0 + 2050);
  // accept 後にさらに一周ぶん動かしても accept しない
  dragArc(engine, G, start + Math.PI * 2, start + Math.PI * 3, T0 + 2050, T0 + 4050);
  assert.equal(log.accepted.length, 1, "accept は 1 回のみ");
  const timeline = engine.snapshot();
  engine.tick(timeline.freezeAtMs!);
  engine.tick(timeline.closeAtMs!);
  assert.equal(log.committed.length, 1, "commit は 1 回のみ");
  assert.equal(engine.snapshot().closedRingCount, 1);
  // commit 済み token と accepted token が一致
  assert.equal(log.committed[0], log.accepted[0]);
});

test("hitstop 中は sceneTimeMs が増えない（索・泡の位相を固定）", () => {
  const { engine } = makeEngine();
  engine.tick(T0);
  tapTip(engine, G, T0);
  dragFullLap(engine, G, T0 + 50, T0 + 2050);
  const timeline = engine.snapshot();
  engine.tick(timeline.freezeAtMs!);
  assert.equal(engine.snapshot().state, "hitstop");
  const frozenScene = engine.snapshot().sceneTimeMs;
  engine.tick(timeline.freezeAtMs! + 70);
  engine.tick(timeline.closeAtMs! - 1);
  assert.ok(
    Math.abs(engine.snapshot().sceneTimeMs - frozenScene) < 1e-9,
    `hitstop 中の sceneTimeMs: ${engine.snapshot().sceneTimeMs} vs ${frozenScene}`,
  );
  // 停止が明けた後は 140ms ぶんを一括加算しない
  engine.tick(timeline.closeAtMs!);
  const afterClose = engine.snapshot().sceneTimeMs;
  assert.ok(afterClose - frozenScene < 5, `閉鎖直後の sceneTimeMs 跳ね: ${afterClose - frozenScene}`);
});

test("cancelled は全 pointer が離れて 180ms 経過したら idle に戻る", () => {
  const { engine } = makeEngine();
  engine.tick(T0);
  tapTip(engine, G, T0);
  engine.pointerUp({ pointerId: 1, timeMs: T0 + 50 });
  assert.equal(engine.snapshot().state, "cancelled");
  engine.tick(T0 + 50 + 179);
  assert.equal(engine.snapshot().state, "cancelled");
  engine.tick(T0 + 50 + 180);
  assert.equal(engine.snapshot().state, "idle");
});

test("一周ごとに索端が π/6 ずつ動く", () => {
  const { engine } = makeEngine();
  engine.tick(T0);
  assert.ok(Math.abs(engine.snapshot().tipAngle - START_ANGLE) < 1e-9);
  tapTip(engine, G, T0);
  dragFullLap(engine, G, T0 + 50, T0 + 2050);
  const timeline = engine.snapshot();
  engine.tick(timeline.closeAtMs!);
  engine.tick(timeline.closeAtMs! + SETTLE_MS);
  const next = engine.snapshot().tipAngle;
  assert.ok(Math.abs(next - START_ANGLE - NEXT_TIP_STEP_RAD) < 1e-9, `次の索端角: ${next}`);
});

test("索端のヒット半径外の押下は接触として扱い、巻き取りを始めない", () => {
  const { engine, log } = makeEngine();
  engine.tick(T0);
  const tip = engine.snapshot().tipAngle;
  const far = TIP_HIT_RADIUS_PX + 30;
  engine.pointerDown({ pointerId: 1, x: G.cx + (G.radius + far) * Math.cos(tip), y: G.cy + (G.radius + far) * Math.sin(tip), timeMs: T0 }, G);
  assert.equal(engine.snapshot().state, "idle");
  assert.equal(log.grabs, 0);
  assert.ok(log.contacts.length > 0, "円外接触には局所反応を返す");
});

test("ゆっくり正確な巻きほど次の索が長い", () => {
  const slowAccurate = makeEngine();
  slowAccurate.engine.tick(T0);
  tapTip(slowAccurate.engine, G, T0);
  dragFullLap(slowAccurate.engine, G, T0 + 50, T0 + 9000); // 約 0.7 rad/s のゆっくり一周
  const slowRatio = slowAccurate.engine.snapshot().nextRopeLengthRatio;

  const fast = makeEngine();
  fast.engine.tick(T0);
  tapTip(fast.engine, G, T0);
  dragFullLap(fast.engine, G, T0 + 50, T0 + 2100); // 約 3 rad/s
  const fastRatio = fast.engine.snapshot().nextRopeLengthRatio;
  assert.ok(slowRatio > fastRatio, `ゆっくり: ${slowRatio} / 速い: ${fastRatio}`);
});
