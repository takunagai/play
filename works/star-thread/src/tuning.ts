// ============================================================
// tuning.ts ─ 視覚・操作・画質の定数（一元管理）
// 正本は docs/architecture.md（§7 の表の値はそのまま転記）。視覚の数値は
// docs/design.md 第5〜9章の転記。design.md の表に値がないもの
// （芯の alpha の幅・装飾星の密度など）は同書のカンプ実測値で、
// コメントに由来を書く。体感の調整はここだけを触る。
// ============================================================

// ---- パレット（design.md 第5章。色は 3 色のみ。#FFFFFF は不使用） ----
export const PALETTE_BACKGROUND = "#0B1026";
export const PALETTE_STAR = "#FFD27A";
export const PALETTE_CORE = "#FFF3D6";

// ---- 数の上限（正本 §3 の固定値） ----
export const STAR_POOL_SIZE = 96;
export const MAX_POINTERS = 2;
export const MAX_CONSTELLATIONS = 4;
export const MIN_STARS = 3;
export const MAX_STARS = 12;
export const STAR_ADD_MS = 300;

// ---- 時間（正本 §7 の表 + design.md 第8章） ----
export const CHARGE_MAX_MS = 2700;
export const FOLLOW_TAU_MS = 90;
/** 指数平滑に渡す dt の上限（正本 §3） */
export const FOLLOW_DT_MAX_MS = 50;
export const FIRST_NOTE_DELAY_MS = 40;
export const STEP_MS = 160;
export const HOLD_MS = 2000;
export const FADE_MS = 2000;
export const RETURN_MS = 600;
/** returning の位置到着後に未所属の質感へ戻す時間（design.md 第11章） */
export const HOME_FADE_MS = 250;
/** pointercancel で収集を静かに空へ戻す時間（正本 §3 の状態表） */
export const CANCEL_RETURN_MS = 300;

// ---- 幾何（正本 §7 の表 + design.md 第7章） ----
export const RADIUS_MIN_RATIO = 0.1;
export const RADIUS_MAX_RATIO = 0.24;
/** S = min(width, height, 720)（正本 §3） */
export const SIZE_SATURATION_PX = 720;
export const EDGE_MARGIN_PX = 18;
export const STAR_MIN_GAP_PX = 12;
export const ATTRACT_CANDIDATE_RADIUS_RATIO = 0.3;
export const ATTRACT_CANDIDATE_RADIUS_MIN_PX = 96;
export const ATTRACT_SPAWN_RING_MIN_PX = 48;
export const ATTRACT_SPAWN_RING_MAX_PX = 90;
export const ATTRACT_SPAWN_FADE_MS = 250;
/** 吸引の不規則軌道（design.md 第9章の提案値。同書が tuning.ts での調整可と規定） */
export const ORBIT_SWING_RAD = 0.35;
export const ORBIT_SWING_PERIOD_MS = 2400;
export const ORBIT_RADIUS_WOBBLE = 0.06;
/** 捕獲順の位相ずらしに使う黄金比（design.md 第9章） */
export const GOLDEN_RATIO = 0.618;

// ---- 星の描画（design.md 第6章） ----
export const STAR_CORE_IDLE_MIN_PX = 1.4;
export const STAR_CORE_IDLE_MAX_PX = 2.6;
export const STAR_CORE_ACTIVE_MIN_PX = 2.4;
export const STAR_CORE_ACTIVE_MAX_PX = 3.6;
export const STAR_HALO_IDLE_MIN_PX = 8;
export const STAR_HALO_IDLE_MAX_PX = 14;
export const STAR_HALO_ACTIVE_MIN_PX = 10;
export const STAR_HALO_ACTIVE_MAX_PX = 16;
export const HALO_IDLE_ALPHA_MIN = 0.1;
export const HALO_IDLE_ALPHA_MAX = 0.16;
export const HALO_ACTIVE_ALPHA_MIN = 0.24;
export const HALO_ACTIVE_ALPHA_MAX = 0.32;
/** 暈のグラデの半径方向停止点（alpha = A×(1−r/R)^1.8 の 4 点近似。design.md 第6章） */
export const HALO_GRADIENT_STOPS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0.25, 0.68],
  [0.5, 0.3],
  [1, 0],
];
/** 同一画素への暈の積算 alpha 上限（design.md 第6章。増光後もこれで切る） */
export const HALO_MAX_STACK_ALPHA = 0.45;
/** 芯の alpha。design.md の表に明記がないため、同書第2章カンプの実測値
 *  （未所属星 0.29〜0.49、収集中・確定後・中央 5 星は 1.0）を採る */
export const CORE_IDLE_ALPHA_MIN = 0.3;
export const CORE_IDLE_ALPHA_MAX = 0.49;
export const CORE_ACTIVE_ALPHA = 1.0;

// ---- 線の描画（design.md 第6章） ----
export const LINE_CORE_WIDTH_PX = 0.8;
export const LINE_HALO_WIDTH_PX = 2.5;
export const LINE_CORE_ALPHA = 0.85;
export const LINE_HALO_ALPHA = 0.18;

// ---- 保持・消退（design.md 第6・8章） ----
export const HOLD_PULSE_MS = 1600;
export const HOLD_PULSE_AMPLITUDE = 0.08;
export const FADE_CURVE_EXP = 1.6;

// ---- 増光（design.md 第8章のデザイン追加） ----
export const BRIGHTEN_RISE_MS = 60;
export const BRIGHTEN_DECAY_MS = 420;
export const BRIGHTEN_CORE_SCALE = 1.35;
export const BRIGHTEN_HALO_ALPHA_SCALE = 1.6;
export const HEAD_DOT_CORE_PX = 2.6;
export const HEAD_DOT_HALO_PX = 11;
export const HEAD_DOT_ALPHA = 0.3;

// ---- 導入画面（design.md 第8・10章。A1 カンプ: 芯 2.4〜2.8px・暈 12〜14px・暈 alpha 0.26） ----
export const INTRO_STAR_COUNT = 5;
export const INTRO_SPREAD_RATIO = 0.064;
export const INTRO_SPREAD_MAX_PX = 40;
export const INTRO_BREATH_MS = 3400;
export const INTRO_BREATH_SPREAD = 0.15;
export const INTRO_BREATH_ALPHA = 0.06;
export const INTRO_HALO_ALPHA = 0.26;
export const INTRO_CORE_MIN_PX = 2.4;
export const INTRO_CORE_MAX_PX = 2.8;
export const INTRO_HALO_MIN_PX = 12;
export const INTRO_HALO_MAX_PX = 14;

// ---- 装飾の背景星（design.md 第5・7章「背景星の寸法」。星 96 個のプールとは別の装飾） ----
/** 面積比の密度。カンプ実測（375×812 で 26 個 / 1280×800 で約 41 個）に合わせる */
export const BG_STAR_DENSITY = 8.5e-5;
export const BG_STAR_COUNT_MIN = 16;
export const BG_STAR_COUNT_MAX = 48;
export const BG_STAR_RADIUS_MIN_PX = 1.0;
export const BG_STAR_RADIUS_MAX_PX = 1.8;
export const BG_STAR_ALPHA_MIN = 0.18;
export const BG_STAR_ALPHA_MAX = 0.4;
/** 上位の等級（約 15%）だけが持つ微小暈 */
export const BG_STAR_TOP_GRADE_RATIO = 0.15;
export const BG_STAR_TOP_HALO_ALPHA = 0.1;
export const BG_STAR_TOP_HALO_MIN_PX = 3.2;
export const BG_STAR_TOP_HALO_MAX_PX = 5.8;
/** 背景星の微明滅（design.md 第8章。画質の低段では停止させる） */
export const BG_STAR_TWINKLE_AMPLITUDE = 0.06;
export const BG_STAR_TWINKLE_MIN_MS = 4000;
export const BG_STAR_TWINKLE_MAX_MS = 7000;

// ---- 反応（design.md 第9章・正本 §3） ----
/** 音声 suspended 中の微光待機（正本 §3 の採用値） */
export const WAITING_HALO_SCALE = 0.7;

// ---- 音響ノブ（正本 §6・§7 の表。engine.ts のオルゴール音源が読む） ----
export const MAX_VOICES = 48;
export const NOTE_ATTACK_MS = 8;
export const NOTE_DECAY_MS = 900;
export const AUDIO_MASTER_GAIN = 0.35;
export const AUDIO_VOICE_PEAK = 0.06;
export const AUDIO_REVERB_TAIL_S = 1.2;
export const AUDIO_REVERB_WET = 0.18;
/** cancel / background での消音時間（正本 §3 の状態表「音源を 30ms で消音」） */
export const AUDIO_SUSPEND_FADE_MS = 30;
/** オルゴールの倍音比 基音:2倍音:3倍音 = 1:0.18:0.06（正本 §6。鋭い click・ノイズ源なし） */
export const AUDIO_PARTIALS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [2, 0.18],
  [3, 0.06],
];

// ---- 画質の自動調整（quality.ts。design.md 第14章の軽量化の対象のみを足す） ----
export const QUALITY_WINDOW_MS = 2000;
export const QUALITY_WARMUP_MS = 3000;
export const QUALITY_SLOW_FRAME_MEDIAN_MS = 24;
export const QUALITY_THROTTLE_MAX_VARIATION = 0.12;
/** 段ごとの暈の層数（design.md 第14章「暈の層数 2→1」）。
 *  2 層 = 星の暈＋装飾星の上位等級の微小暈。1 層 = 星の暈のみ（微小暈と微明滅を止める）。
 *  星の暈の寸法・alpha・グラデは全段階で同一。 */
export const HALO_LAYER_STEPS = [2, 2, 1];
