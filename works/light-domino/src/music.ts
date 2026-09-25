// ============================================================
// music.ts ─ C メジャーペンタと音程の決定（音響と視覚の共通定義）
// work.json の scale「メジャーペンタ」と対応。正本は docs/architecture.md 第 6 節。
// ============================================================

import { SCALES, type ScaleName } from "./scale";

export const SCALE: ScaleName = "メジャーペンタ";
/** C メジャーペンタのステップ（半音） */
export const SCALE_STEPS: readonly number[] = SCALES[SCALE];
/** 単音の基準（C4） */
export const BASE_MIDI = 60;
/** 単音の上限（E6） */
export const TOP_MIDI = 88;
/** 終演和音（C4 / E4 / G4 / A4） */
export const FINALE_CHORD_MIDIS: readonly number[] = [60, 64, 67, 69];
/** 終演の低音（C2 / C3） */
export const FINALE_BASS_MIDIS: readonly number[] = [36, 48];

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * 板の進行率（0..1、列の始端からの割合）をスケール段数へ写し、C4 から E6 へ単調に上昇させる。
 * 同じ段が数枚続いてもよいが、逆行しないことを優先する。
 */
export function pitchForProgress(progress: number): { midi: number; degree: number } {
  const steps = SCALE_STEPS.length;
  const total = TOP_MIDI - BASE_MIDI; // 28 半音 ≒ 5 オクターブ弱
  const index = Math.round(Math.min(1, Math.max(0, progress)) * total);
  const degree = index % steps;
  const midi = BASE_MIDI + index;
  return { midi, degree };
}
