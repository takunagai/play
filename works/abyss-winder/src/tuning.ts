// ============================================================
// tuning.ts ─ 視覚・操作・拍の定数（一元管理）
// 転記値の正本: docs/architecture.md とデザイン確定値（375px/1280px の2サイズ案）。
// 体感の調整はここだけを触る。数値の意味は docs/architecture.md に書く。
// ============================================================

// ---- パレット（デザイン確定値。コントラスト実測はデザイン spec を正本にする） ----
export const PALETTE_BG = "#08152B";
export const PALETTE_GLASS_CENTER = "#071225";
export const PALETTE_GLASS = "#040B18";
export const PALETTE_GLASS_EDGE = "#02060F";
export const PALETTE_METAL = "#56616B";
export const PALETTE_METAL_HI = "#7A8794";
export const PALETTE_METAL_DK = "#39434D";
export const PALETTE_ROPE = "#8A4F38";
export const PALETTE_ROPE_DK = "#20140E";
export const PALETTE_ROPE_HI = "#B06A4F";
export const PALETTE_ROPE_TW = "#6E3D2C";
/** 水圧の輪。発光を許された唯一のアクセント色 */
export const PALETTE_RING = "#43B9D8";
export const PALETTE_TICK = "#E8EEF2";
export const PALETTE_INK_HIGH = "#D6E2EA";
export const PALETTE_INK_MID = "#A9BAC7";
export const PALETTE_PARTICLE = "#9FB4C4";
export const PALETTE_FISH = "#10263E";

// ---- 幾何 ----
export const WINDOW_RADIUS_RATIO = 0.27;
/** 縦長スマホ（min(w,h) < NARROW_MAX_MIN_EDGE_PX）用の比率 */
export const WINDOW_RADIUS_RATIO_NARROW = 0.34;
export const WINDOW_RADIUS_NARROW_MAX_MIN_EDGE_PX = 480;
export const WINDOW_RADIUS_MAX_PX = 200;
/** 開始角 π/2 = 窓の下。0本目の目盛りもここから時計回り */
export const START_ANGLE = Math.PI / 2;
/** 一周ごとに次の索端が動く角 */
export const NEXT_TIP_STEP_RAD = Math.PI / 6;
export const RIM_WIDTH_MIN_PX = 10;
export const RIM_WIDTH_RATIO = 0.055;
/** 索の巻き位置は半径 R−2（リムの内側・ガラスの縁。索と金属の輝度差 1.02:1 のためリム上に置かない） */
export const ROPE_RADIUS_OFFSET_PX = 2;
export const ROPE_WIDTH_PX = 4;
export const ROPE_EDGE_EXTRA_PX = 1.6;
export const ROPE_HAIR_WIDTH_PX = 1;
export const ROPE_HAIR_OFFSET_PX = 3.4;
export const ROPE_TWIST_ARC_PX = 14;
export const ROPE_TWIST_WIDTH_PX = 1.2;
export const TICK_COUNT = 24;
export const TICK_WIDTH_PX = 2;
export const TICK_INNER_OFFSET_PX = 1.5;
export const TICK_LENGTH_INSET_PX = 3;
/** 索端をつかむヒット半径。開始点への復帰判定も同じ値 */
export const TIP_HIT_RADIUS_PX = 28;
export const RADIAL_BAND_MIN_PX = 24;
export const RADIAL_BAND_RATIO = 0.18;

// ---- 円周判定 ----
export const MAX_ANGLE_STEP_RAD = Math.PI / 8;
export const REVERSE_TOLERANCE_RAD = 0.08;
export const SAMPLE_GAP_MS = 250;
export const GAP_ANGLE_RAD = 0.08;

// ---- 輪 ----
export const RING_RADIUS_INSET_PX = 14;
export const RING_CORE_WIDTH_PX = 2.4;
export const RING_HALO_OFFSET_PX = 11;
export const RING_HALO_ALPHA = 0.2;
export const RING_STEP_PX = 6;
export const RING_WIDTH_PX = 1.8;
export const RING_ALPHAS = [0.42, 0.28, 0.18, 0.12, 0.08] as const;
export const VISIBLE_RING_CAP = 6;
export const CONTOUR_COUNT = 8;
export const CONTOUR_START_INSET_PX = 52;
export const CONTOUR_STEP_PX = 6;
export const CONTOUR_WIDTH_PX = 1;
export const CONTOUR_ALPHA = 0.15;

// ---- 共通時刻契約（architecture.md §5。音響カードが同じ式を使う） ----
export const EIGHTH_MS = 250;
export const HITSTOP_MS = 140;
export const SETTLE_MS = 900;
export const CANCEL_RETURN_MS = 180;
/** 各拍で可視の目盛りが沈み込む時間（60ms ease-out・非発光） */
export const BEAT_SETTLE_MS = 60;
export const BEAT_SETTLE_PX = 1;
/** 輪が閉じる時間（=1拍）。閉じは開始角から時計回り 0→2π */
export const RING_CLOSE_MS = 250;
/** 閉鎖輪のはじみ: +120ms ピーク / +600ms 消灯（ベル残響 ≤600ms と一致） */
export const RING_GLOW_PEAK_MS = 120;
export const RING_GLOW_OFF_MS = 600;
/** 最終目盛りの発光は freezeAtMs の 60ms 前からランプイン */
export const FINAL_TICK_RAMP_MS = 60;
/** 水紋は閉鎖後 500ms でフェードイン */
export const RIPPLE_FADE_IN_MS = 500;
/** たるみ揺れの周期 */
export const ROPE_SLACK_SWAY_MS = 3200;
/** 次の索端のたるみ: +300ms 後に 400ms で伸びる */
export const NEXT_ROPE_DELAY_MS = 300;
export const NEXT_ROPE_GROW_MS = 400;
/** 魚影は閉鎖後に退く */
export const FISH_RETREAT_MS = 600;
export const FISH_DRIFT_SPEED_PX_S = 6;
/** 索端マーカーの脈動（不透明度 0.65↔1.0・周期1.2s） */
export const TIP_PULSE_MS = 1200;
export const GUIDE_FADE_MS = 200;

// ---- 誘導 ----
/** 索端の誘い。concept.md 固定文言 */
export const GUIDE_TEXT_1 = "端から、";
export const GUIDE_TEXT_2 = "時計回りに一周";
export const GUIDE_OFFSET_MIN_PX = 40;
export const GUIDE_OFFSET_RATIO = 0.25;
export const SCREEN_MARGIN_PX = 14;
export const TITLE_FONT_SIZE_NARROW_PX = 26;
export const TITLE_FONT_SIZE_PX = 40;
export const TITLE = "深窓の索";

// ---- 速さと次索長 ----
export const SPEED_MIN_RAD_S = 0.8;
export const SPEED_MAX_RAD_S = 1.8;
export const ROPE_LENGTH_MIN_RATIO = 0.3;
export const ROPE_LENGTH_MAX_RATIO = 0.46;

// ---- 装飾（品質の段ごとの密度） ----
export const PARTICLE_COUNT_STEPS = [180, 100, 50];
export const FISH_COUNT_STEPS = [3, 2, 1];
export const PARTICLE_RADIUS_MIN_PX = 0.7;
export const PARTICLE_RADIUS_MAX_PX = 2.4;
export const PARTICLE_ALPHA_MIN = 0.08;
export const PARTICLE_ALPHA_MAX = 0.26;
/** 巻き取りの遠のきで中心から外へ動く最大量（深い粒子ほどよく動く） */
export const PARTICLE_RECEDING_MAX_PX = 40;

// ---- 円外接触の局所反応（小さな非発光水紋） ----
export const CONTACT_RIPPLE_LIFE_MS = 700;
export const CONTACT_RIPPLE_MAX_RADIUS_PX = 26;
export const CONTACT_RIPPLE_STEPS = [14, 8, 4];
/** 接触音・水紋の間引き（§8: 過密発音を50ms以上間引く） */
export const CONTACT_MIN_INTERVAL_MS = 50;

// ---- 画質の自動調整（quality.ts） ----
export const QUALITY_WINDOW_MS = 2000;
export const QUALITY_WARMUP_MS = 3000;
/** 窓の中央値フレーム間隔がこれを超えたら 1 段下げる */
export const QUALITY_SLOW_FRAME_MEDIAN_MS = 24;
/** フレーム間隔の変動係数がこれ未満なら、遅くても rAF 制限（省エネの 30Hz 等）とみなして下げない */
export const QUALITY_THROTTLE_MAX_VARIATION = 0.12;
