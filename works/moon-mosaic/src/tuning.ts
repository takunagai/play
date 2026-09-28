// ============================================================
// tuning.ts ─ 視覚・入力・時間・画質の定数（一元管理）
// 体感の調整はここだけを触る。数値の意味は docs/architecture.md に書く。
// 音響の数値は src/audio/audio-tuning.ts。
// ============================================================

// ---- パレット（docs/concept.md の 3 色だけを使う）----
/** 墨青: 最背面・欠片の影 */
export const PALETTE_INK = "#08111F";
/** 青灰: 水面・波紋・空の円・継ぎ目 */
export const PALETTE_WATER = "#1D3A52";
/** 銀白: 欠片・月・月輪・星図の芯 */
export const PALETTE_SILVER = "#EAF6FF";

// ---- 欠片 ----
/** 1 周期の欠片数。画面サイズで変えない（正本 §3.1） */
export const FRAGMENT_COUNT = 12;
/** モバイル（短辺 430px 以下）で欠片を広げる倍率。存在感を保つ（正本 §3.1） */
export const MOBILE_SIZE_SCALE = 1.15;
/** 欠片 1 片の目標面積 = 月面積 / この値（正本 §8.2） */
export const FRAGMENT_AREA_DIVISOR = 12;
/** 欠片の多角形の頂点数（5〜8。seed で決める） */
export const FRAGMENT_VERTICES = [5, 6, 7, 8] as const;
/** 面の銀白 alpha の範囲（正本 §8.2） */
export const FRAGMENT_ALPHA_MIN = 0.72;
export const FRAGMENT_ALPHA_MAX = 0.94;
/** 縁の銀白 alpha と線幅（正本 §8.2） */
export const FRAGMENT_EDGE_ALPHA = 0.35;
export const FRAGMENT_EDGE_WIDTH_PX = 1;
/** 影の墨青 alpha と offset（正本 §8.2） */
export const FRAGMENT_SHADOW_ALPHA = 0.45;
export const FRAGMENT_SHADOW_OFFSET_PX = [2, 3] as const;
/** fleeing で進行方向へ伸びる倍率の上限（正本 §8.2） */
export const FRAGMENT_STRETCH_MAX = 1.06;
/** following で速度方向へ傾く最大角度（度。正本 §8.2） */
export const FRAGMENT_TILT_MAX_DEG = 8;
/** settling の最後 25% でゆっくり収まるための ease 比率（正本 §8.2） */

// ---- 指の速度（正本 §4.1）----
/** 低速域の上限（px/s）。これ以下が FOLLOW_DWELL_MS 続くと弧追従へ移れる */
export const POINTER_SPEED_SLOW_PX_S = 180;
/** 高速域の下限（px/s）。これ以上で反発最大・追従解除 */
export const POINTER_SPEED_FAST_PX_S = 650;
/** 指速度の EMA 平滑化係数 */
export const POINTER_SPEED_EMA_ALPHA = 0.24;
/** ポインタ履歴を参照する窓（ms） */
export const POINTER_SPEED_WINDOW_MS = 80;
/** 入力が途切れてから速度を 0 へ落とすまでの時間（ms） */
export const POINTER_IDLE_TIMEOUT_MS = 120;
/** ポインタ履歴を保持する秒数（古い点は捨てる） */
export const TRAIL_HISTORY_MS = 1600;

// ---- 逃避（正本 §4.2）----
/** 指速度で広がる影響半径（px/s の 0 → 1 で lerp） */
export const REPEL_RADIUS_MIN_PX = 64;
export const REPEL_RADIUS_MAX_PX = 132;
/** 指速度で伸びる逃避目標距離（px） */
export const REPEL_DISTANCE_MIN_PX = 24;
export const REPEL_DISTANCE_MAX_PX = 88;
/** 反発力の強さ（px/s²。speedT で lerp） */
export const REPEL_FORCE_MIN = 380;
export const REPEL_FORCE_MAX = 980;
/** 画面端の内側余白。ここ以内では逃避方向を接線へ投影する */
export const EDGE_INSET_PX = 28;
/** 初接近でも最低この時間は fleeing を見せる（ms。正本 §4.2） */
export const FOLLOW_DWELL_MS = 120;

// ---- 弧の追従（正本 §4.3）----
/** 欠片が追うポインタ履歴の遅れ（ms 前） */
export const FOLLOW_TRAIL_DELAY_MS = 180;
/** 弧オフセットの大きさ（影響半径比 → px。近いほど小さくなる） */
export const FOLLOW_ARC_MAX_PX = 34;
export const FOLLOW_ARC_MIN_PX = 12;
/** 弧の基準距離。この距離（px）で弧は MIN の半分になる */
export const FOLLOW_ARC_DISTANCE_PX = 180;
/** 追従の spring 剛性と減衰 */
export const FOLLOW_STIFFNESS = 7.5;
export const FOLLOW_DAMPING = 4.8;
/** 追従中の欠片最高速度（px/s） */
export const FOLLOW_MAX_SPEED_PX_S = 260;
/** 指からこの距離（px）を超えたら追従を外す */
export const FOLLOW_BREAK_DISTANCE_PX = 190;
/** 追従に入る条件の 1 つ: 影響半径のこの倍率以内 */
export const FOLLOW_ENTER_RADIUS_RATIO = 1.25;
/** following の弧オフセットを 0 へ減衰させる時間（ms） */
export const FOLLOW_ARC_DECAY_MS = 420;

// ---- 月への収束（正本 §4.4）----
/** 月直径の短辺比。clamp(min(w,h) × 0.28, 112px, 280px) */
export const MOON_DIAMETER_RATIO = 0.28;
export const MOON_DIAMETER_MIN_PX = 112;
export const MOON_DIAMETER_MAX_PX = 280;
/** 欠片の捕捉域 = 月半径 × この値 */
export const MOON_CAPTURE_RATIO = 1.18;
/** 指の許容域 = 月半径 × この値 */
export const POINTER_CAPTURE_RATIO = 1.55;
/** 月スロットへ収まる時間（ms） */
export const SETTLE_MS = 350;

// ---- 完成タイムライン（正本 §3）----
/** 波紋も音も停止する最優先の間（ms） */
export const HUSH_MS = 150;
/** 月輪クリックと視覚輪が一周する時間（ms） */
export const RING_TRAVEL_MS = 900;
/** 月の揺れを見せてから次の欠片へ進む時間（ms。reveal 終了から） */
export const SWAY_HOLD_MS = 2400;
/** 次の欠片群の出現時間（ms） */
export const SPAWN_MS = 600;
/** 継ぎ目を薄くする時間（ms。正本 §8.2） */
export const SEAM_FADE_MS = 450;

// ---- 波紋（正本 §4.5）----
/** 波紋の最大半径（画面短辺比） */
export const RIPPLE_MAX_RADIUS_RATIO = 0.18;
/** 波紋の寿命（ms） */
export const RIPPLE_LIFE_MS = 1200;
/** 波紋 alpha の範囲。配置数で中央の波紋を濃くする（正本 §4.5） */
export const RIPPLE_ALPHA_MIN = 0.08;
export const RIPPLE_ALPHA_MAX = 0.16;
/** 画質の段（quality.ts）ごとの同時波紋上限（正本 §9） */
export const RIPPLE_CAP_STEPS = [36, 24, 14];

// ---- 航跡・星図（正本 §8.3）----
/** 現在追従中の航跡を表示する長さ（px。末尾のみ） */
export const TRAIL_VISIBLE_PX = 120;
export const TRAIL_ALPHA = 0.14;
/** 確定した StarPath の芯の alpha と線幅（正本 §8） */
export const STARPATH_CORE_ALPHA = 0.22;
export const STARPATH_CORE_WIDTH_PX = 0.75;
export const STARPATH_NODE_RADIUS_PX = 1.5;
/** 保持する StarPath の上限。超えたら古い順に落とす */
export const STARPATH_MAX = 12;
/** 星図の alpha の範囲（古い順に薄くする） */
export const STARPATH_ALPHA_NEW = 0.22;
export const STARPATH_ALPHA_OLD = 0.08;
/** 画質の段ごとの航跡の再サンプル間隔（px。正本 §9） */
export const TRAIL_SAMPLE_STEPS_PX = [12, 18, 24];

// ---- 水面（正本 §8）----
/** 水面の放射中心 alpha */
export const WATER_CENTER_ALPHA = 0.2;
/** 水面の横濃淡の周期（s） */
export const WATER_BAND_PERIOD_S = 12;
/** 月と星図の揺れの振幅（px）と空間・時間周波数（正本 §8.3） */
export const SWAY_AMPLITUDE_PX = 1.6;
export const SWAY_SPATIAL_FREQ = 0.022;
export const SWAY_TEMPORAL_FREQ = 0.7;
/** prefers-reduced-motion 時の揺れ振幅（px）と漂い速度の倍率（正本 §8.3） */
export const REDUCED_MOTION_AMPLITUDE_PX = 0.4;
export const REDUCED_MOTION_SPEED_SCALE = 0.5;
/** 月縁の amp による脈動の割合（±6%。正本 §5） */
export const MOON_PULSE_RATIO = 0.06;

// ---- 導入画面（正本 §3.1）----
/** 空の円の直径（min(w,h) 比） */
export const INTRO_EMPTY_MOON_RATIO = 0.28;
/** 導入オーバーレイの退場時間（ms） */
export const INTRO_EXIT_MS = 300;

// ---- 周辺減光 ----
/** 画面四辺へ近づくほど落とす vignette の最大強さ（0..1 の alpha 比） */
export const VIGNETTE_MAX_ALPHA = 0.5;

// ---- 8 分拍（視覚の pulse 用。音側は audio-tuning.ts）----
export const EIGHTH_BPM = 72;

// ---- 画質の自動調整（quality.ts。雛形どおり）----
export const QUALITY_WINDOW_MS = 2000;
export const QUALITY_WARMUP_MS = 3000;
/** 窓の中央値フレーム間隔がこれを超えたら 1 段下げる */
export const QUALITY_SLOW_FRAME_MEDIAN_MS = 24;
/** フレーム間隔の変動係数がこれ未満なら、遅くても rAF 制限（省エネの 30Hz 等）とみなして下げない */
export const QUALITY_THROTTLE_MAX_VARIATION = 0.12;

// ---- その他 ----
/** 物理の dt を clamp する範囲（秒。正本 §4） */
export const DT_MIN_S = 1 / 120;
export const DT_MAX_S = 1 / 30;
/** 欠片の漂いの周期範囲（秒。正本 §4.5） */
export const DRIFT_PERIOD_MIN_S = 7;
export const DRIFT_PERIOD_MAX_S = 13;
/** 漂いの変位の振幅（px） */
export const DRIFT_AMPLITUDE_PX = 22;
/** 欠片の最高速度（追従以外。px/s。正本 §4） */
export const FRAGMENT_MAX_SPEED_PX_S = 420;
/** 未回収欠片を画面内へ戻す力の開始距離（画面端からの px） */
export const RETURN_MARGIN_PX = 40;
/** 月面を横切る逃避に足す周方向バイアスの強さ（px/s²） */
export const TANGENT_BIAS = 240;
