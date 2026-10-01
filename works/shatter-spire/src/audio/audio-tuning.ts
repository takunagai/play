// ============================================================
// audio-tuning.ts ─ 音響の数値（一元管理）
// 意味は docs/architecture.md 第 5・6 節。
// ============================================================

export const MASTER_GAIN = 0.5;
/** 生成 IR の長さ（秒） */
export const REVERB_SECONDS = 2.4;
export const REVERB_WET = 0.26;

// ---- cutChime（切断の高い「キン」）----
/** 基本周波数（Hz） */
export const CUT_CHIME_FREQ_HZ = 2400;
/** 弱い部分音の倍率（2.01 倍。非整数で金属的なうなりを作る） */
export const CUT_CHIME_PARTIAL_RATIO = 2.01;
/** 部分音の音量比 */
export const CUT_CHIME_PARTIAL_GAIN = 0.35;
/** 基音の音量 */
export const CUT_CHIME_GAIN = 0.2;
/** sharpness 0 の減衰（秒）。1 でこの半分へ短くなる（速いほど鋭く） */
export const CUT_CHIME_DECAY_SECONDS = 1.1;

// ---- cutImpact（切断の低い「ドン」）----
/** 基音（Hz）。72Hz サイン */
export const CUT_IMPACT_FREQ_HZ = 72;
/** 144Hz 三角波の音量比（スマホではこの倍音が重量を伝える） */
export const CUT_IMPACT_OCTAVE_GAIN = 0.3;
/** 基音の音量 */
export const CUT_IMPACT_GAIN = 0.4;
/** 減衰（秒） */
export const CUT_IMPACT_DECAY_SECONDS = 0.5;
/** 低域ノイズの音量比 */
export const CUT_IMPACT_NOISE_GAIN = 0.12;
/** cutY（0..1、下ほど大）が効く音量増幅の上限（+10%） */
export const CUT_IMPACT_DEEP_BOOST = 0.1;

// ---- glassStep（崩壊段のガラス鐘）----
/** サイン部分音の比（1 / 2.32 / 4.91。ガラスの非整数倍音） */
export const GLASS_STEP_PARTIAL_RATIOS: readonly [number, number, number] = [1, 2.32, 4.91];
/** 部分音の音量比 */
export const GLASS_STEP_PARTIAL_GAINS: readonly [number, number, number] = [1, 0.42, 0.18];
/** sharpness 0 の減衰（秒）。1 でこの半分へ */
export const GLASS_STEP_DECAY_SECONDS = 0.8;
/** sharpness 1 の減衰（秒） */
export const GLASS_STEP_DECAY_MIN_SECONDS = 0.35;
/** 単音の音量 */
export const GLASS_STEP_GAIN = 0.14;
/** 高域ノイズ（3ms）の音量比 */
export const GLASS_STEP_NOISE_GAIN = 0.08;

// ---- sandTick（着地の微音）----
/** bandpass ノイズの中心周波数（Hz） */
export const SAND_TICK_FILTER_HZ = 5200;
export const SAND_TICK_GAIN = 0.05;
export const SAND_TICK_DECAY_SECONDS = 0.04;
/** 小さなサインの周波数（Hz） */
export const SAND_TICK_TONE_HZ = 3100;
/** 30ms 窓内の着地を 1 音へ束ねる（正本 §4） */
export const SAND_TICK_MERGE_WINDOW_MS = 30;

// ---- sandNote（砂に触れた音）----
export const SAND_NOTE_GAIN = 0.09;
export const SAND_NOTE_DECAY_SECONDS = 0.5;
/** 柔らかさの 2.0 倍音の音量比 */
export const SAND_NOTE_OCTAVE_GAIN = 0.25;
/** 最大発音間隔（ms）。8回/秒 */
export const SAND_NOTE_MIN_INTERVAL_MS = 125;

// ---- regrowDrone（再生の低いガラス倍音）----
/** D2 / D3 を重ねる */
export const REGROW_DRONE_MIDIS: readonly [number, number] = [38, 50];
export const REGROW_DRONE_GAIN = 0.05;
/** LPF の開始 / 終了周波数（Hz）。progress で緩く上げる */
export const REGROW_DRONE_LPF_START_HZ = 420;
export const REGROW_DRONE_LPF_END_HZ = 1400;
/** ready 遷移でのフェードアウト（秒） */
export const REGROW_DRONE_RELEASE_SECONDS = 0.18;

// ---- 同時発音と飽和対策 ----
export const MAX_VOICES = 24;
/** 音を奪うときのフェード（秒） */
export const STEAL_FADE_SECONDS = 0.02;
/** glassBus の自動減衰（dB）。下降音列を濁らせない（正本 §6） */
export const GLASS_BUS_DUCK_DB = -5;
export const GLASS_BUS_DUCK_VOICES = 5;

// ---- リミッタ ----
export const COMPRESSOR_THRESHOLD_DB = -11;
export const COMPRESSOR_RATIO = 12;
