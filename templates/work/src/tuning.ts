// ============================================================
// tuning.ts ─ 視覚・操作・画質の定数（一元管理）
// 体感の調整はここだけを触る。数値の意味は docs/architecture.md に書く。
// ============================================================

// ---- パレット ----
export const PALETTE_BACKGROUND = "#07070d";
/** 度数ごとの色（music.ts の音階の度数と対応させる） */
export const PALETTE_DEGREE_COLORS = ["#5fe3ff", "#7c9bff", "#b69cff", "#ff7ad9", "#ffc46b", "#7dffb2", "#e6e6ff"];

// ---- 入力 ----
/** なぞりで音を出す最小の移動距離（px） */
export const DRAG_TRIGGER_DISTANCE_PX = 48;

// ---- 波紋 ----
export const RIPPLE_LIFE_MS = 900;
export const RIPPLE_MAX_RADIUS_RATIO = 0.18; // 画面短辺比
export const RIPPLE_CAP_STEPS = [120, 80, 40]; // 画質の段（quality.ts）ごとの同時数上限

// ---- 画質の自動調整（quality.ts） ----
export const QUALITY_WINDOW_MS = 2000;
export const QUALITY_WARMUP_MS = 3000;
/** 窓の中央値フレーム間隔がこれを超えたら 1 段下げる */
export const QUALITY_SLOW_FRAME_MEDIAN_MS = 24;
/** フレーム間隔の変動係数がこれ未満なら、遅くても rAF 制限（省エネの 30Hz 等）とみなして下げない */
export const QUALITY_THROTTLE_MAX_VARIATION = 0.12;
