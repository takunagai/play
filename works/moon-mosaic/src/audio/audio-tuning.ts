// ============================================================
// audio-tuning.ts ─ 音響の定数（一元管理。正本: docs/architecture.md §7）
// ============================================================

/** 基準テンポ。8 分音符 = 約 416.7ms */
export const EIGHTH_BPM = 72;
/** 8 分音符 1 拍の長さ（ms） */
export const EIGHTH_MS = 60000 / EIGHTH_BPM / 2;

// ---- マスター系統 ----
export const MASTER_GAIN = 0.5;
export const REVERB_SECONDS = 2.4;
export const REVERB_WET = 0.28;
export const COMPRESSOR_THRESHOLD_DB = -10;
export const COMPRESSOR_RATIO = 12;

// ---- 最大同時発音数（正本 §7）----
export const MAX_VOICES = 24;
/** 通常音が上限を超えたら最古の glassTick をこの時間で奪う（ms） */
export const STEAL_FADE_MS = 20;

// ---- waterDrop（逃避の水滴。正本 §7）----
export const DROP_START_HZ = 1800;
export const DROP_END_HZ = 900;
export const DROP_MS = 35;
export const DROP_NOISE_MS = 18;
export const DROP_NOISE_HZ = 5200;
export const DROP_GAIN_FLEE = 0.05;
export const DROP_GAIN_PLACE = 0.09;

// ---- glassTick（配置のグラス音。部分音比と減衰。正本 §7）----
export const GLASS_PARTIALS: ReadonlyArray<readonly [number, number, number]> = [
  // [倍率, gain, decay 秒]
  [1, 0.16, 0.32],
  [2.76, 0.06, 0.18],
  [5.4, 0.025, 0.08],
];

// ---- gatherDrone（D2/A2 の常駐ドローン。正本 §7）----
export const DRONE_MIDIS = [38, 45] as const; // D2, A2
export const DRONE_GAIN = 0.05;
export const DRONE_LPF_MIN_HZ = 220;
export const DRONE_LPF_MAX_HZ = 900;
export const DRONE_PULSE_MOD = 0.03;

// ---- reveal の 3 音（正本 §7）----
/** 高いグラスハープ: D6/A6 と非整数倍音 */
export const REVEAL_GLASS_MIDIS = [86, 81] as const; // D6, A5 上段
export const REVEAL_GLASS_PARTIALS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0.1, 4.8],
  [2.75, 0.035, 3.1],
  [5.1, 0.014, 1.6],
  [7.3, 0.006, 0.9],
];
export const REVEAL_ATTACK_MS = 18;
/** 輪郭クリック列の数と帯域（900ms で一周） */
export const RIM_CLICK_COUNT = 12;
export const RIM_CLICK_HZ = 2400;
export const RIM_CLICK_Q = 6;
export const RIM_CLICK_MS = 26;
export const RIM_CLICK_GAIN = 0.06;
/** 低い胴鳴り */
export const BODY_MIDIS = [26, 38] as const; // D1, D2
export const BODY_GAIN = 0.22;
export const BODY_ATTACK_MS = 25;
export const BODY_DECAY_S = 3.6;

// ---- hush のフェード（正本 §7）----
/** transientBus / droneBus を 25ms で -60dB へ */
export const HUSH_GAIN_MS = 25;
export const HUSH_TARGET_DB = -60;
/** Convolver の戻りを 60ms で絞る */
export const HUSH_REVERB_MS = 60;

// ---- pulse（8 分拍）----
export const PULSE_GAIN = 0.045;
