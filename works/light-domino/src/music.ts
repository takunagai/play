// ============================================================
// music.ts ─ C メジャーペンタと音程の決定（音響と視覚の共通定義）
// work.json の scale「メジャーペンタ」と対応。正本は docs/architecture.md 第 6 節。
// ============================================================

import { scaleMidiRange, SCALES, type ScaleName } from "./scale";
import { ACCUMULATION_VELOCITY_BOOST, CROSSING_VELOCITY_BOOST, PARALLEL_VELOCITY_BOOST } from "./tuning";

export const SCALE: ScaleName = "メジャーペンタ";
/** C メジャーペンタのステップ（半音） */
export const SCALE_STEPS: readonly number[] = SCALES[SCALE];
/** 単音の基準（C4） */
export const BASE_MIDI = 60;
/** 単音の上限（E6） */
export const TOP_MIDI = 88;
/** 連鎖音に使える C メジャーペンタの MIDI（C4〜E6） */
export const PITCH_MIDIS: readonly number[] = scaleMidiRange(SCALE, BASE_MIDI, TOP_MIDI);
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
  const index = Math.round(Math.min(1, Math.max(0, progress)) * (PITCH_MIDIS.length - 1));
  return { midi: PITCH_MIDIS[index], degree: index };
}

/** タップした端を 0 とする連鎖順から、常に上昇する音程を返す。 */
export function pitchForChainIndex(index: number, count: number): { midi: number; degree: number } {
  return pitchForProgress(count <= 1 ? 0 : index / (count - 1));
}

/** 交叉・並走・蓄積を既存 AudioEngine 契約の velocity へ写像する。 */
export function velocityForInteraction(crossing: boolean, parallel: boolean, accumulated: boolean): number {
  return Math.min(
    1,
    0.85 +
      (crossing ? CROSSING_VELOCITY_BOOST : 0) +
      (parallel ? PARALLEL_VELOCITY_BOOST : 0) +
      (accumulated ? ACCUMULATION_VELOCITY_BOOST : 0),
  );
}
