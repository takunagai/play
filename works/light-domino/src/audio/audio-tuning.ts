// ============================================================
// audio-tuning.ts ─ 音響の数値（一元管理）
// 意味は docs/architecture.md 第 6 節。
// ============================================================

export const MASTER_GAIN = 0.55;
/** 生成 IR の長さ（秒） */
export const REVERB_SECONDS = 2.2;
export const REVERB_WET = 0.22;
/** 連鎖の後半で少し増やす wet の加算 */
export const REVERB_WET_LATE = 0.1;

// ---- マリンバ風のモーダル合成（サイン部分音）----
/** 基音に対する部分音の比率と減衰（秒） */
export const MARIMBA_PARTIALS: ReadonlyArray<{ ratio: number; decaySeconds: number; gain: number }> = [
  { ratio: 1, decaySeconds: 0.52, gain: 1 },
  { ratio: 3.98, decaySeconds: 0.18, gain: 0.38 },
  { ratio: 10.65, decaySeconds: 0.07, gain: 0.14 },
];
/** マレットの打撃ノイズ（秒） */
export const MALLET_NOISE_SECONDS = 0.004;
/** 単音 1 発の音量。進行率で明るさが変わる程度には揃える */
export const DOMINO_GAIN = 0.24;
/** 終盤（進行率 0.7 以降）で足す残響の倍率分の音量持ち上げ */
export const LATE_VELOCITY_LIFT = 0.15;

// ---- placeClick（板を置く音）----
export const PLACE_CLICK_GAIN = 0.05;
export const PLACE_CLICK_DECAY_SECONDS = 0.035;
export const PLACE_CLICK_FREQ_HZ = 900;
/** 発音の間引き（ms）。これより短い間隔の place は鳴らさない */
export const PLACE_MIN_INTERVAL_MS = 84;

// ---- align（吸着の音）----
export const ALIGN_CLICK_GAIN = 0.09;
export const ALIGN_CLICK_FREQ_HZ = 520;
export const ALIGN_CLICK_DECAY_SECONDS = 0.06;

// ---- 終演 ----
export const FINALE_BASS_GAIN = 0.3;
export const FINALE_BASS_DECAY_SECONDS = 2.8;
export const FINALE_BASS_ATTACK_SECONDS = 0.018;
/** C2 の下に重ねる C3 倍音の音量比（小型スピーカー対策） */
export const FINALE_BASS_OCTAVE_GAIN = 0.35;
export const FINALE_CHORD_GAIN = 0.17;
export const FINALE_CHORD_DECAY_SECONDS = 4.8;
/** 和音の最初の立ち上がり（明るく聴かせる区間、秒） */
export const FINALE_CHORD_BRIGHT_SECONDS = 0.5;
/** 和音のサイン層（柔らかさ）の音量比 */
export const FINALE_CHORD_SINE_GAIN = 0.4;
/** 和音の左右の広がり（pan の最大絶対値） */
export const FINALE_CHORD_SPREAD = 0.6;

// ---- hush（最後の「間」）----
/** 打音バスを下げる深さ（dB） */
export const HUSH_DUCK_DB = -12;
/** ダックの時間（秒） */
export const HUSH_DUCK_SECONDS = 0.08;
/** 終演でダックを戻す時間（秒） */
export const HUSH_RECOVER_SECONDS = 0.18;

// ---- 同時発音と飽和対策 ----
export const MAX_VOICES = 28;
/** 250ms 窓内の発音数がこれを超えたら通常音を下げ始める */
export const BUSY_WINDOW_MS = 250;
export const BUSY_VOICE_THRESHOLD = 8;
/** 飽和対策の最大ダック（dB） */
export const BUSY_DUCK_MAX_DB = -6;
/** 音を奪うときのフェード（秒） */
export const STEAL_FADE_SECONDS = 0.02;

// ---- リミッタ ----
export const COMPRESSOR_THRESHOLD_DB = -12;
export const COMPRESSOR_RATIO = 12;
