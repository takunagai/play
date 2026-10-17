// ============================================================
// audio-tuning.ts ─ 音量・フィルター・残響・同時発音上限（一元管理）
// 数値の意味は docs/architecture.md 第 7 節。体感の調整はここだけを触る。
// ============================================================

// ---- マスター系 ----
export const MASTER_GAIN = 0.42;
export const COMP_THRESHOLD_DB = -14;
export const COMP_RATIO = 8;
export const ANALYSER_FFT_SIZE = 1024;

// ---- 残響（生成 IR。外部音源・外部 IR は使わない） ----
export const REVERB_SECONDS = 2.6;
export const REVERB_WET = 0.32;

// ---- 同時発音 ----
export const MAX_VOICES = 20;
export const DRONE_MAX_VOICES = 5;
export const BELL_MAX_VOICES = 6;

// ---- 時間 ----
/** updateFlight の AudioParam 更新を 30Hz 以下に間引く間隔 */
export const PARAM_UPDATE_MIN_INTERVAL_MS = 33;
/** AudioParam の ramp。20〜80ms の中間 */
export const PARAM_RAMP_SECONDS = 0.06;
/** 押下開始の風とドローンの attack */
export const LIFT_ATTACK_SECONDS = 0.08;
/** 離した後の風のフェード */
export const WIND_RELEASE_SECONDS = 0.45;
/** 突破時のフィルター急開放 */
export const BREAKTHROUGH_FILTER_SECONDS = 0.18;
/** layerCross で加わるドローン音の立ち上がり */
export const DRONE_VOICE_FADE_SECONDS = 1.2;
/** 引かれるドローン音のフェードアウト */
export const DRONE_VOICE_OUT_SECONDS = 1.5;
/** clearChord */
export const CHORD_ATTACK_SECONDS = 2.8;
export const CHORD_RELEASE_SECONDS = 1.8;
/** ベル */
export const LAYER_BELL_DECAY_SECONDS = 0.9;
export const CLEAR_BELL_DECAY_SECONDS = 2.4;
/** 同時発音超過時に最古の境界ベルをフェードさせる時間 */
export const BELL_STEAL_FADE_SECONDS = 0.02;

// ---- 音量 ----
/** ドローン 1 声の音量 */
export const DRONE_VOICE_GAIN = 0.05;
/** ドローンの三角波成分（ごく弱い） */
export const DRONE_TRIANGLE_GAIN = 0.22;
/** ドローンのデチューン（cent） */
export const DRONE_DETUNE_CENTS = 6;
/** 風の基本音量（浮遊中も残る床） */
export const WIND_BASE_GAIN = 0.045;
/** 押下時の風の最大増分 */
export const WIND_PRESS_GAIN = 0.11;
/** 風の帯域中心（Hz）。velocity と pressure で動く */
export const WIND_BAND_CENTER_HZ = 900;
export const WIND_BAND_LOW_HZ = 380;
export const WIND_BAND_Q = 1.1;
/** 圧力音の最大音量 */
export const PRESSURE_MAX_GAIN = 0.09;
/** 境界ベルの音量（突破ベルより 6dB 以上小さい = 1/2 以下） */
export const LAYER_BELL_GAIN = 0.085;
/** 突破ベルの音量 */
export const CLEAR_BELL_GAIN = 0.2;
/** 突破ベルの定位は最大 ±0.2 */
export const CLEAR_BELL_PAN_LIMIT = 0.2;
/** clearChord 1 音の音量 */
export const CHORD_VOICE_GAIN = 0.032;
/** 風の定位への指位置の反映幅 */
export const WIND_PAN_AMOUNT = 0.35;
