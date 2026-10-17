// ============================================================
// music.ts ─ C メジャーペンタの音程と層別ボイシング（音響と視覚の共通定義）
// work.json の scale「メジャーペンタ」と対応。正本は docs/architecture.md 第 7 節。
// ============================================================

/** C メジャーペンタ C D E G A の半音間隔 */
export const SCALE_STEPS = [0, 2, 4, 7, 9] as const;

/** MIDI 番号。C4 = 60 */
export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * 層ごとの持続ドローンのボイシング。
 * 0 毛布: C2/G2。1 風路: +D3/A3。2 蓋: +E3。3 晴天: ドローンは静かにし、clearChord に任せる。
 */
export const DRONE_VOICINGS: readonly (readonly number[])[] = [
  [36, 43],
  [36, 43, 50, 57],
  [36, 43, 50, 52, 57],
  [],
];

/** 晴天の広い和音 C3/G3/D4/E4/A4（breakthrough で立ち上げ、clear 中保持） */
export const CLEAR_CHORD_MIDIS = [48, 55, 62, 64, 69] as const;

/** 境界ベル。layer 1 → G5、layer 2 → A5（C メジャーペンタ外へ出さない） */
export const LAYER_BELL_MIDI_BY_LAYER: Record<1 | 2, number> = { 1: 79, 2: 81 };

/** 突破ベル C6/E6 */
export const CLEAR_BELL_MIDIS = [84, 88] as const;

/** 最終層の圧力音。C2 + G2 の弱い倍音 */
export const PRESSURE_TONE_MIDIS = [36, 43] as const;

/**
 * 層ごとの共有 LPF の目標値。
 * 蓋（layer 2）は 620Hz を基準に、pressure で FULL_PRESSURE まで閉じる。
 */
export const FILTER_HZ_BY_LAYER = [420, 780, 620, 4800] as const;
export const FILTER_HZ_FULL_PRESSURE = 260;

/** 蓋の圧力（0..1）での共有 LPF。620 → 260 Hz */
export function pressureFilterHz(pressure: number): number {
  const clamped = Math.min(1, Math.max(0, pressure));
  return 620 + (FILTER_HZ_FULL_PRESSURE - 620) * clamped;
}
