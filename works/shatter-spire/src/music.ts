// ============================================================
// music.ts ─ D ドリアンの音程と崩壊段から MIDI を求める純粋関数
// work.json の scale「ドリアン」と対応。正本は docs/architecture.md 第 6 節。
// ============================================================

export const SCALES = {
  マイナーペンタトニック: [0, 3, 5, 7, 10],
  メジャーペンタ: [0, 2, 4, 7, 9],
  ドリアン: [0, 2, 3, 5, 7, 9, 10],
  リディアン: [0, 2, 4, 6, 7, 9, 11],
  // 無調・ノイズ主体は音程を使わない。便宜上 12 半音すべて
  "無調・ノイズ主体": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
} as const;

export type ScaleName = keyof typeof SCALES;

export const SCALE: ScaleName = "ドリアン";
/** D ドリアンのステップ（半音間隔）。正本 §6: [0, 2, 3, 5, 7, 9, 10] */
export const SCALE_STEPS: readonly number[] = SCALES[SCALE];
/** 基準音（D4） */
export const BASE_MIDI = 62;
/** 崩壊音列の上端（D6 付近） */
export const COLLAPSE_TOP_MIDI = 86;
/** 崩壊音列の下端（D3 付近） */
export const COLLAPSE_BOTTOM_MIDI = 50;

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * 崩壊段の MIDI。上段（rowIndex = 0）ほど高く、下段ほど低い。
 * D6 付近から D3 付近まで下降し、音階外へ出さない（正本 §6）。
 * 「直前の段より高くしない」単調非増加の保証は呼び出し側（synth-engine の切断ごとの音列状態）が行う。
 * V-2: この関数は切断を跨ぐ状態を持たない。持ち越された前周の音で丸めると
 * 2 周目以降が下端の一音に固定されるため。
 */
export function collapseMidi(rowIndex: number, rowCount: number): number {
  const t = rowCount <= 1 ? 0 : Math.min(1, Math.max(0, rowIndex / (rowCount - 1)));
  const continuous = COLLAPSE_TOP_MIDI + (COLLAPSE_BOTTOM_MIDI - COLLAPSE_TOP_MIDI) * t;
  return snapToScale(continuous);
}

/** 連続的な MIDI 値を D ドリアンのいずれかの音へスナップする（最も近い音階内の音） */
export function snapToScale(continuous: number): number {
  const steps = SCALE_STEPS;
  let best = BASE_MIDI;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let octave = -3; octave <= 4; octave++) {
    for (const step of steps) {
      const midi = BASE_MIDI + octave * 12 + step;
      const distance = Math.abs(midi - continuous);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = midi;
      }
    }
  }
  return best;
}

/** 砂に触れた位置（0..1）へ D ドリアン内の音を割り当てる。左ほど低い（正本 §4 sand/touch） */
export function sandNoteMidi(normalizedX: number): number {
  const steps = SCALE_STEPS;
  const span = 2; // 2 オクターブ分の幅（D3 付近〜D5 付近の柔らかい音域）
  const total = steps.length * span;
  const index = Math.min(total - 1, Math.max(0, Math.floor(Math.min(1, Math.max(0, normalizedX)) * total)));
  const octave = Math.floor(index / steps.length);
  const degree = index % steps.length;
  return BASE_MIDI - 12 + octave * 12 + steps[degree];
}
