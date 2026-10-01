// ============================================================
// tuning.ts ─ 視覚・入力・状態時間・画質の定数（一元管理）
// 体感の調整はここだけを触る。数値の意味は docs/architecture.md 第 11 節に書く。
// 音響の数値は src/audio/audio-tuning.ts。
// ============================================================

// ---- パレット（docs/concept.md の指定色）----
export const PALETTE_BACKGROUND = "#0A0F2C";
/** 結晶の芯・砂の明色 */
export const PALETTE_CRYSTAL_LIGHT = "#BFEFFF";
/** 結晶の影面・内部反射・砂の暗色 */
export const PALETTE_CRYSTAL_SHADOW = "#B9A7FF";

// ---- 導入 ----
/** 早く導入を抜けた時、塔を完成させる最大時間（ms） */
export const INTRO_FAST_BUILD_MS = 120;

// ---- スワイプ入力 ----
/** 生の入力点を記録する最小移動距離（px） */
export const RAW_POINT_MIN_DISTANCE_PX = 4;
/** 生の入力点を記録する最小間隔（ms）。最大約 60Hz */
export const RAW_POINT_MIN_INTERVAL_MS = 16;
/** 切断候補とする最小軌跡長（px） */
export const SWIPE_MIN_LENGTH_PX = 56;
/** 誤タップをスワイプから除く境界の平均速度（px/s）。verify の CDP タッチ実測が約 115px/s のため 90 に置く */
export const SWIPE_MIN_SPEED_PX_S = 90;
/** sharpness = 1 になる速度（px/s） */
export const SWIPE_SHARP_SPEED_PX_S = 1200;
/** 塔交差の前後に必要な軌跡長（px） */
export const SWIPE_CROSS_MARGIN_PX = 12;
/** 塔を外した軌跡の淡光の寿命（ms） */
export const FACLIGHT_MS = 140;
/** 指の軌跡を表示する時間窓（ms）。architecture.md §4「直近 80ms」 */
export const TRAIL_WINDOW_MS = 80;

// ---- 切断と崩壊の時間 ----
/** 切断後に局所アニメーションを止める時間（ms） */
export const HITSTOP_MS = 100;
/** 上半分が切断面を滑る時間（ms） */
export const SLIDE_MS = 180;
/** 崩壊音のテンポ（BPM）。16 分音符は SIXTEENTH_MS */
export const BPM = 120;
/** 16 分音符 1 拍（ms） */
export const SIXTEENTH_MS = 60000 / BPM / 4;
/** 最後の砕けから settling へ移るまでの余韻（ms） */
export const COLLAPSE_TAIL_MS = 420;
/** 残った欠片を底へ収束させる上限（ms） */
export const SETTLING_MAX_MS = 700;
/** 砂だけを見せる明滅状態の最短時間（ms） */
export const AFTERGLOW_MS = 900;
/** 塔が下から再生する時間（ms） */
export const REGROW_MS = 900;
/** 欠片 1 個の自由落下の初速（px/s）。collapse 開始時に与える */
export const FRAGMENT_GRAVITY_PX_S2 = 2100;

// ---- 塔 ----
export const TOWER_ROWS_MIN = 9;
export const TOWER_ROWS_MAX = 13;
export const CRYSTALS_PER_ROW_MIN = 3;
export const CRYSTALS_PER_ROW_MAX = 5;
/** 塔幅 = clamp(短辺 × この値, TOWER_WIDTH_MIN_PX, TOWER_WIDTH_MAX_PX) */
export const TOWER_WIDTH_RATIO = 0.34;
export const TOWER_WIDTH_MIN_PX = 128;
export const TOWER_WIDTH_MAX_PX = 310;
/** 縦長画面（高さ > 幅 × この比率）では塔幅を短辺の TOWER_WIDTH_PORTRAIT_RATIO へ広げる */
export const TOWER_PORTRAIT_ASPECT = 1.45;
export const TOWER_WIDTH_PORTRAIT_RATIO = 0.44;
/** 塔の高さ = 画面高 × この範囲 */
export const TOWER_HEIGHT_MIN_RATIO = 0.58;
export const TOWER_HEIGHT_MAX_RATIO = 0.72;
/** 塔の底（砂面の基準線）= 画面高 × この値 */
export const TOWER_BASE_Y_RATIO = 0.88;
/** 1 セルの頂点数の範囲 */
export const CELL_VERTICES_MIN = 5;
export const CELL_VERTICES_MAX = 7;

// ---- 欠片と砂 ----
/** 品質段ごとの微小欠片上限 */
export const MICRO_SHARD_CAP_STEPS = [180, 96, 48];
/** 品質段ごとの可視砂粒上限 */
export const VISIBLE_SAND_CAP_STEPS = [220, 160, 100];
/** 沈積高さマップの列数 */
export const SAND_HEIGHT_COLUMNS = 192;
/** 砂の高さ上限 = 画面高 × この値。複数周ぶんは圧縮表示する */
export const SAND_MAX_HEIGHT_RATIO = 0.18;
/** 砂に触れたとき近傍粒子を押しのける最大距離（px） */
export const SAND_TOUCH_PUSH_PX = 6;
/** 砂の微音の最大回数（回/秒） */
export const SAND_TOUCH_RATE_HZ = 8;
/** 砂化した粒子が高さマップへ落ちる速度（px/s の目安。見た目の沈積） */
export const SAND_SETTLE_SPEED_PX_S = 90;

// ---- 明滅と脈動 ----
/** 結晶の呼吸の周期（ms） */
export const IDLE_BREATHE_MS = 4200;
/** 結晶内部光と砂 halo の amp による脈動幅（±6%） */
export const AMP_PULSE_AMPLITUDE = 0.06;

// ---- グロー（別レイヤー。pitfalls.md の白飽和対策）----
/** グローキャンバスの縮小率（1/6 サイズで描き CSS 拡大） */
export const GLOW_CANVAS_DIVISOR = 6;
/** 品質段ごとの glow 解像度の追加の分割（1 = 変更なし） */
export const GLOW_EXTRA_DIVISOR_STEPS = [1, 1.5, 2];
/** 結晶の glow alpha の最大値 */
export const GLOW_CRYSTAL_ALPHA = 0.07;
/** 砂の halo alpha の最大値 */
export const SAND_HALO_ALPHA = 0.08;

// ---- 画質の自動調整（quality.ts）----
export const QUALITY_WINDOW_MS = 2000;
export const QUALITY_WARMUP_MS = 3000;
/** 窓の中央値フレーム間隔がこれを超えたら 1 段下げる */
export const QUALITY_SLOW_FRAME_MEDIAN_MS = 24;
/** フレーム間隔の変動係数がこれ未満なら、遅くても rAF 制限（省エネの 30Hz 等）とみなして下げない */
export const QUALITY_THROTTLE_MAX_VARIATION = 0.12;
