// ============================================================
// music.ts ─ D ドリアンと、回収数から音階度を決める純粋関数（音響と視覚の共通定義）
// 正本: docs/architecture.md §7。work.json の scale（語彙）と対応させる。
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
/** 基音 D4（MIDI 62）。正本 §7 */
export const BASE_MIDI = 62;
/** 完成へ向かって上る音域の上限（オクターブ）。正本 §7「2 オクターブ以内」 */
export const OCTAVE_SPAN = 2;

/**
 * 回収数 collected（0..FRAGMENT_COUNT）を音階のインデックスへ写す。
 * 正本 §7: collected → [0,2,3,5,7,9,10] へ写し、完成へ向かって単調に上げる。
 * ステップ = FRAGMENT_COUNT / 目標列の長さ で等間隔に分散する。
 */
export const COLLECTED_TO_STEP = [0, 2, 3, 5, 7, 9, 10] as const;

/** 回収数（1..12 を想定）からスケール内ステップ（0 始まり、単調非減少）を返す純粋関数 */
export function stepForCollected(collected: number, fragmentCount: number): number {
  const steps = COLLECTED_TO_STEP;
  const clamped = Math.min(fragmentCount, Math.max(1, collected));
  const ratio = (clamped - 1) / Math.max(1, fragmentCount - 1); // 0..1
  const last = steps.length - 1;
  return Math.round(ratio * last);
}

/** ステップ（スケール内インデックス、2 オクターブ内を巡回）から MIDI 番号を返す純粋関数 */
export function midiForStep(step: number): number {
  const scale = SCALES[SCALE];
  const clamped = Math.max(0, step);
  const octave = Math.floor(clamped / scale.length);
  const degree = clamped % scale.length;
  return BASE_MIDI + 12 * Math.min(OCTAVE_SPAN - 1, octave) + scale[degree];
}

/** 回収数から MIDI 番号を決める（音響の place / pulse の共通入口） */
export function midiForCollected(collected: number, fragmentCount: number): number {
  return midiForStep(stepForCollected(collected, fragmentCount));
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
