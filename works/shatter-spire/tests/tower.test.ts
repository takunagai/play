// ============================================================
// tower.test.ts ─ tower.ts（切断幾何）の作品固有回帰テスト
// 実行: node --test --experimental-strip-types tests/tower.test.ts
// レビュー V-1（t_7645e978）の回帰: px→local の直線変換が正しいこと、
// 中央水平線で切断すれば上下に分かれること。
// ============================================================
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTower, classifyCell, lineToLocal, localToPx, pxToLocal, polygonArea, splitCell } from "../src/tower.ts";

const frame = { leftPx: 485, bottomPx: 704, widthPx: 310, heightPx: 520 };

test("pxToLocal / localToPx が互いの逆写像", () => {
  const points = [
    { x: 485, y: 704 },
    { x: 640, y: 400 },
    { x: 795, y: 184 },
    { x: 300, y: 900 },
  ];
  for (const point of points) {
    const local = pxToLocal(point, frame);
    const back = localToPx(local, frame);
    assert.ok(Math.abs(back.x - point.x) < 1e-9, `x: ${back.x} vs ${point.x}`);
    assert.ok(Math.abs(back.y - point.y) < 1e-9, `y: ${back.y} vs ${point.y}`);
  }
});

test("V-1 回帰: 中央水平切断線が塔のローカルで a={0,-1}、b=線上の点の高さになる", () => {
  // 画面中央 (640, 400) を通る上向き法線 (0,1) の水平線（reviewer プローブと同じ入力）
  const { a, b } = lineToLocal({ x: 0, y: 1 }, { x: 640, y: 400 }, frame);
  assert.ok(Math.abs(a.x) < 1e-9, `a.x: ${a.x}`);
  assert.ok(Math.abs(Math.abs(a.y) - 1) < 1e-9, `|a.y|: ${a.y}`);
  const centerLocal = pxToLocal({ x: 640, y: 400 }, frame);
  // a·p = b が線上の点を通る（符号は a の向きに従う）
  const side = a.x * centerLocal.x + a.y * centerLocal.y - b;
  assert.ok(Math.abs(side) < 1e-9, `線上の点の符号付き距離: ${side}`);
});

test("V-1 回帰: 中央水平線で塔が上下に分かれる（upper/lower が両方存在）", () => {
  const { a, b } = lineToLocal({ x: 0, y: 1 }, { x: 640, y: 400 }, frame);
  const tower = buildTower(9, 1);
  const counts = { upper: 0, lower: 0, crossing: 0 };
  for (const cell of tower.cells) counts[classifyCell(cell, a, b)]++;
  assert.ok(counts.upper > 0, `upper 0: ${JSON.stringify(counts)}`);
  assert.ok(counts.lower > 0, `lower 0: ${JSON.stringify(counts)}`);
  assert.equal(counts.upper + counts.lower + counts.crossing, tower.cells.length);
});

test("V-1 回帰: 交差セルは上下 2 片に分かれ、面積の合計が元セルとほぼ一致", () => {
  const { a, b } = lineToLocal({ x: 0, y: 1 }, { x: 640, y: 400 }, frame);
  const tower = buildTower(9, 1);
  let checked = 0;
  for (const cell of tower.cells) {
    if (classifyCell(cell, a, b) !== "crossing") continue;
    const split = splitCell(cell, a, b);
    if (!split) continue; // 退化は本テストの対象外（正本 §9 の重心フォールバック）
    const upperArea = polygonArea(split.upper);
    const lowerArea = polygonArea(split.lower);
    assert.ok(Math.abs(upperArea + lowerArea - cell.mass) < 1e-9, `面積合計不一致: ${upperArea + lowerArea} vs ${cell.mass}`);
    checked++;
  }
  assert.ok(checked > 0, "交差セルが 1 つも無い");
});
