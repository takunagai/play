// ============================================================
// music.ts ─ 音階と音程の決定（音響と視覚の共通定義）
// work.json の scale（語彙）と対応させる。
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

export const SCALE: ScaleName = "メジャーペンタ";
export const BASE_MIDI = 57; // A3
export const OCTAVE_SPAN = 3;

/** 画面上の位置（0..1、左 → 右で上がる）から MIDI 番号と度数を決める */
export function noteForPosition(normalizedX: number): { midi: number; degree: number } {
  const steps = SCALES[SCALE];
  const total = steps.length * OCTAVE_SPAN;
  const index = Math.min(total - 1, Math.max(0, Math.floor(normalizedX * total)));
  const degree = index % steps.length;
  const octave = Math.floor(index / steps.length);
  return { midi: BASE_MIDI + 12 * octave + steps[degree], degree };
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
