// ============================================================
// scale.ts ─ work.json の語彙と音階ステップの対応表
// 語彙は docs/work-json.md の scale と完全一致させる。
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

/** 指定した音階の degree を、baseMidi から topMidi まで MIDI 昇順で列挙する。 */
export function scaleMidiRange(scale: ScaleName, baseMidi: number, topMidi: number): number[] {
  if (topMidi < baseMidi) return [];
  const steps: readonly number[] = SCALES[scale];
  const midis: number[] = [];
  for (let octave = 0; baseMidi + octave * 12 <= topMidi; octave++) {
    for (const step of steps) {
      const midi = baseMidi + octave * 12 + step;
      if (midi <= topMidi) midis.push(midi);
    }
  }
  return midis;
}
