// ============================================================
// music.test.ts ─ music.ts（崩壊音列）の作品固有回帰テスト
// 実行: node --test --experimental-strip-types tests/music.test.ts
// レビュー V-2（t_7645e978）の回帰: 音列の状態は切断ごとに作り直す（synth-engine.ts の
// glassRun。beginCut で null に戻る）。切断を跨いで前周の音を持ち越すと
// 単調非増加クランプで 2 周目以降が下端の一音に固定される、のが旧不具合。
// collapseMidi は状態を持たない純粋関数になったため、ここでは
// 「持ち越しが起きると固定する」壊れ方の仕様と、「リセットすれば
// 2 周連続でも同じ下降列になる」ことを engine 層の呼び出し規約込みで確かめる。
// ============================================================
import assert from "node:assert/strict";
import { test } from "node:test";

import { COLLAPSE_BOTTOM_MIDI, COLLAPSE_TOP_MIDI, collapseMidi, SCALE_STEPS, snapToScale } from "../src/music.ts";

/** 崩壊段 1 周ぶんの音列。previousMidi の扱いで旧実装（持ち越し）と新実装（切断ごとに null）を模倣する */
function playCut(rowCount: number, carriedPrevious: number | null): number[] {
  let previousMidi = carriedPrevious;
  const notes: number[] = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const midi = collapseMidi(rowIndex, rowCount);
    // synth-engine.scheduleGlassStep と同じ単調非増加クランプ
    previousMidi = previousMidi !== null && midi > previousMidi ? previousMidi : midi;
    notes.push(previousMidi);
  }
  return notes;
}

test("1 周目の音列は上端から下端まで単調非増加", () => {
  const first = playCut(9, null);
  assert.equal(first.length, 9);
  assert.equal(first[0], COLLAPSE_TOP_MIDI, `先頭: ${first[0]}`);
  assert.equal(first[first.length - 1], COLLAPSE_BOTTOM_MIDI, `末尾: ${first[first.length - 1]}`);
  for (let index = 1; index < first.length; index++) {
    assert.ok(first[index] <= first[index - 1], `index ${index} で上昇: ${first[index - 1]} → ${first[index]}`);
  }
});

test("V-2 回帰: 前周の最終音を持ち越すと 2 周目が下端の一音に固定する（旧不具合の再現）", () => {
  const first = playCut(9, null);
  const secondCarried = playCut(9, first[first.length - 1]);
  assert.ok(secondCarried.every((midi) => midi === COLLAPSE_BOTTOM_MIDI), `持ち越すと全段が下端: ${secondCarried.join(",")}`);
});

test("V-2 回帰: 切断ごとに状態をリセットすれば 2 周連続でも上端からの下降列になる", () => {
  const first = playCut(9, null);
  const second = playCut(9, null); // beginCut() が glassRun を作り直すのと同じ（previous = null から再開）
  assert.equal(second[0], COLLAPSE_TOP_MIDI, `2 周目の先頭: ${second[0]}`);
  assert.notEqual(second[0], COLLAPSE_BOTTOM_MIDI, "2 周目の先頭が下端のままになっていない");
  assert.deepEqual(second, first, "2 周目は 1 周目と同じ音列を繰り返す");
});

test("崩壊音列はすべて D ドリアンの音階内", () => {
  for (let rowCount = 9; rowCount <= 13; rowCount++) {
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const midi = collapseMidi(rowIndex, rowCount);
      const pitchClass = ((midi % 12) + 12) % 12;
      assert.ok(
        SCALE_STEPS.some((step) => (62 + step) % 12 === pitchClass),
        `rowCount ${rowCount} row ${rowIndex} midi ${midi} が音階外`,
      );
    }
  }
});

test("snapToScale は最も近い音階内の音へ丸める", () => {
  assert.equal(snapToScale(62), 62); // D4 は音階内
  assert.equal(snapToScale(63.5), 64); // 63 は D4 と E4 のちょうど中間 → 低い側の D4 が先に確定
  assert.equal(snapToScale(64), 64); // E4 は音階内
  assert.equal(snapToScale(61), 60); // C#4 → C4
});
