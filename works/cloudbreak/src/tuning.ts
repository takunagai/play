// ============================================================
// tuning.ts ─ 飛行物理・パレット・層・時間・描画上限（一元管理）
// 数値の意味と正本は docs/architecture.md 第 3・4・8・12 節。体感の調整はここだけを触る。
// ============================================================

// ---- 飛行物理（altitude は 0..1.06。開始値と下限 0.04、雲海の上端 1.00） ----
export const MIN_ALTITUDE = 0.04;
export const MAX_ALTITUDE = 1.06;
export const CLEAR_ALTITUDE = 1.0;
/** 再突破を許可する下降高度。境界付近の振動でベルと突破演出を連打しない */
export const BREAKTHROUGH_REARM_ALTITUDE = 0.78;
export const ASCEND_ACCEL_PER_S2 = 0.48;
export const ASCEND_MAX_SPEED_PER_S = 0.15;
/** 押下直後の最小上向き速度。150ms 以内に応答を見せるため */
export const ASCEND_IMPULSE_PER_S = 0.035;
export const COAST_DECEL_PER_S2 = 0.15;
export const DESCEND_ACCEL_PER_S2 = 0.11;
export const DESCEND_MAX_SPEED_PER_S = 0.1;
/** 毛布 / 風路 / 蓋 / 晴天の境界 */
export const LAYER_BOUNDARIES = [0.34, 0.67, 1.0] as const;
/** 最濃・最もこもる区間の開始高度 */
export const CAP_PRESSURE_START = 0.85;
/** 雲が退き空が開く時間 */
export const BREAKTHROUGH_MS = 650;
/** 入力にかかわらず晴天を保持する余韻 */
export const CLEAR_HOLD_MS = 4000;
export const CLEAR_FLOAT_AMPLITUDE = 0.008;
export const CLEAR_FLOAT_PERIOD_MS = 5200;
/** 晴天高度（clear の浮遊中心） */
export const CLEAR_CRUISE_ALTITUDE = 1.02;
/** 指の x 位置から音の定位への追従率 */
export const POINTER_PAN_SMOOTHING = 0.08;
/** タブ復帰時の高度飛びを防ぐ deltaTime 上限 */
export const DELTA_TIME_MAX_MS = 50;

// ---- パレット ----
export const PALETTE_CLOUD_SHADOW = "#6E7B96";
export const PALETTE_CLOUD_LIGHT = "#E8EEF7";
export const PALETTE_CLEAR_SKY = "#7EC8F8";
export const PALETTE_MORNING_LIGHT = "#FFE3B8";
/** 雲中背景の下端（雲影の暗い版）と上端（淡い青灰） */
export const PALETTE_SKY_LOW = "#7C89A4";
export const PALETTE_SKY_HIGH = "#C9D5E8";
/** 最終層の圧迫で掛ける薄いベール */
export const PALETTE_PRESSURE_VEIL = "#5A6580";
/** 押下中の上向き流線 */
export const PALETTE_FLOW_LINE = "#F4F8FF";

// ---- 画質の自動調整（quality.ts） ----
export const QUALITY_WINDOW_MS = 2000;
export const QUALITY_WARMUP_MS = 3000;
/** 窓の中央値フレーム間隔がこれを超えたら 1 段下げる */
export const QUALITY_SLOW_FRAME_MEDIAN_MS = 24;
/** フレーム間隔の変動係数がこれ未満なら、遅くても rAF 制限（省エネの 30Hz 等）とみなして下げない */
export const QUALITY_THROTTLE_MAX_VARIATION = 0.12;

// ---- 品質段ごとの描画上限（第 8 節の表。index = quality level） ----
/** 雲塊上限（遠 / 中 / 近） */
export const CLOUD_CAP_STEPS: readonly (readonly [number, number, number])[] = [
  [28, 34, 24],
  [20, 26, 16],
  [14, 18, 10],
];
/** 最終層の前景片上限 */
export const FOREGROUND_WISP_CAP_STEPS = [42, 26, 14] as const;
/** 雲縁の補助面の層数 */
export const AUX_LAYER_STEPS = [2, 1, 0] as const;
/** 背景バッファ（offscreen）の解像度分割 */
export const BACKDROP_SCALE_STEPS = [2, 3, 4] as const;

// ---- 描画 ----
/** 画面高さ × この値が高度 1.0 のピクセル数（縦方向のパララックス基準） */
export const ALTITUDE_PIXEL_SCALE = 2.0;
/** 雲形状の seed。リサイズ後も同じ構図を再生成する */
export const CLOUD_SEED = 20261016;
/** 塊の横方向の基礎速度（画面幅 / 分）。毛布の遠景。風路は 1.8 倍、前景片は 2.2 倍 */
export const BLANKET_DRIFT_PER_MIN = 0.1;
export const STREAK_DRIFT_RATIO = 1.8;
export const WISP_DRIFT_RATIO = 2.2;
/** 近景の最小半径（px）。375px で細片にならないようにする */
export const NEAR_BLOB_MIN_RADIUS_PX = 72;
/** 雲海の見え方 */
export const SEA_TOP_ALTITUDE = 0.9;
export const SEA_WAVE_POINT_COUNT = 40;
/** 押下中の上向き流線の本数 */
export const FLOW_LINE_COUNT = 9;
/** 圧迫ベールの最大 alpha */
export const PRESSURE_VEIL_MAX_ALPHA = 0.26;
