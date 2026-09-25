// ============================================================
// music.ts ─ 音階・音程決定・度数色（音響と視覚の共通定義）
// 正本は docs/architecture.md 6 節「音程決定」・7.2 節「度数色」
// ============================================================

/** 主音 F3 */
export const ROOT_MIDI = 53;

/** F リディアン（F G A B C D E）の主音からの半音数 */
export const LYDIAN_STEPS = [0, 2, 4, 6, 7, 9, 11] as const;

/** 和声音（degree 0..4 = 1, 3, 5, #4, 7）の主音からの半音数 */
export const CHORD_DEGREES = ["1", "3", "5", "#4", "7"] as const;
export const CHORD_SEMITONES = [0, 4, 7, 6, 11] as const;

/** 度数色（degree と同じ並び）。明るい要素にだけ使う */
export const DEGREE_COLORS = ["#C6FF00", "#3DFFB8", "#5CC8FF", "#7C4DFF", "#FF5CE1"] as const;

/** サイズで決まるレジスタの両端（size 1 = 大きい泡 = 低い） */
export const REGISTER_LOW_MIDI = 53; // F3
export const REGISTER_HIGH_MIDI = 89; // F6
/** コンボで駆け上がる上限 */
export const LADDER_TOP_MIDI = 96; // C7

/**
 * 駆け上がりのはしご。1-3-5-7 の上に #4 を 1 オクターブ上で置く（Fmaj7#11 の開いた配置）。
 * B と C を同じオクターブに並べると短 2 度でぶつかるため、#4 は常に上の段へ逃がす。
 */
const LADDER_VOICING: ReadonlyArray<{ semitone: number; degree: number }> = [
  { semitone: 0, degree: 0 },
  { semitone: 4, degree: 1 },
  { semitone: 7, degree: 2 },
  { semitone: 11, degree: 4 },
  { semitone: 18, degree: 3 },
];
const LADDER_PERIOD = 24; // 上の配置は 2 オクターブで 1 周する

export interface LadderNote {
  midi: number;
  degree: number;
}

export const LADDER: ReadonlyArray<LadderNote> = (() => {
  const notes: LadderNote[] = [];
  for (let base = ROOT_MIDI; base <= LADDER_TOP_MIDI; base += LADDER_PERIOD) {
    for (const voice of LADDER_VOICING) {
      const midi = base + voice.semitone;
      if (midi <= LADDER_TOP_MIDI) notes.push({ midi, degree: voice.degree });
    }
  }
  return notes.sort((a, b) => a.midi - b.midi);
})();

const LADDER_STEPS_PER_OCTAVE = 5 / 2; // 2 オクターブで 5 段

/** サイズ 0..1 → レジスタの MIDI 番号（連続値） */
export function registerMidiForSize(size: number): number {
  const clamped = Math.min(1, Math.max(0, size));
  return REGISTER_HIGH_MIDI + (REGISTER_LOW_MIDI - REGISTER_HIGH_MIDI) * clamped;
}

/** 目標の MIDI 番号に最も近いはしごの段 */
export function nearestLadderIndex(targetMidi: number): number {
  let bestIndex = 0;
  let bestDistance = Infinity;
  LADDER.forEach((note, index) => {
    const distance = Math.abs(note.midi - targetMidi);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

/** コンボの起点となる段。combo=1 の pop で main.ts が記録する */
export function anchorForSize(size: number): number {
  return nearestLadderIndex(registerMidiForSize(size));
}

/**
 * pop の音程を決める。
 * - combo 1: サイズのレジスタに最も近い和声音
 * - combo 2 以降: 起点の段から combo に応じて 1 段ずつ上がる。サイズで ±1 段だけ揺らす
 * - 上限を超えたら 2 オクターブ（5 段）ずつ下へ折り返し、上昇感を保ったまま音域に収める
 */
export function noteForPop(size: number, combo: number, anchorIndex: number): LadderNote {
  if (combo <= 1) return LADDER[anchorForSize(size)];
  const sizeNudge = Math.round((0.5 - Math.min(1, Math.max(0, size))) * 2);
  let index = anchorIndex + (combo - 1) + sizeNudge;
  const foldSteps = Math.round(LADDER_STEPS_PER_OCTAVE * 2);
  while (index >= LADDER.length) index -= foldSteps;
  return LADDER[Math.max(0, index)];
}

/** マイルストーンのグリッサンド（1-3-5-#4-7-1'）。level で開始オクターブを上げる */
export function milestoneGlissando(level: number): number[] {
  // level 1: F4 から / level 2 以上: F5 から（最高音 F7 = 101 で頭打ちにならないよう 2 段まで）
  const startMidi = ROOT_MIDI + 12 + 12 * Math.min(1, Math.max(0, Math.floor(level) - 1));
  const semitones = [0, 4, 7, 18, 23, 24];
  return semitones.map((semitone) => startMidi + semitone);
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function colorForDegree(degree: number): string {
  return DEGREE_COLORS[((degree % DEGREE_COLORS.length) + DEGREE_COLORS.length) % DEGREE_COLORS.length];
}
