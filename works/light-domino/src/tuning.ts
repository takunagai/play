// ============================================================
// tuning.ts ─ 視覚・入力・時間・画質の定数（一元管理）
// 体感の調整はここだけを触る。数値の意味は docs/architecture.md 第 10 節に書く。
// 音響の数値は src/audio/audio-tuning.ts。
// ============================================================

// ---- パレット（docs/concept.md の指定色）----
export const PALETTE_BACKGROUND = "#111318";
export const PALETTE_TILE = "#FFF4E0";
export const PALETTE_GOLD = "#FFC857";

// ---- 入力（なぞり）----
/** 生の入力点を記録する最小移動距離（px） */
export const RAW_POINT_MIN_DISTANCE_PX = 4;
/** 生の入力点を記録する最小間隔（ms）。最大約 60Hz */
export const RAW_POINT_MIN_INTERVAL_MS = 16;
/** 手ぶれ補正の移動平均に使う直近点数 */
export const SMOOTHING_WINDOW_POINTS = 5;
/** 入力を画面端から内側へ clamp する幅（px） */
export const INPUT_EDGE_INSET_PX = 12;
/** aligned で端以外を押して、ここを超えた移動で新しい列の描画を始める距離（px） */
export const DRAG_START_DISTANCE_PX = 10;

// ---- 板（ドミノ）----
/** 板の長さ = clamp(短辺 × 0.032, 14px, 24px) */
export const TILE_LENGTH_RATIO = 0.032;
export const TILE_LENGTH_MIN_PX = 14;
export const TILE_LENGTH_MAX_PX = 24;
/** 板の見かけの厚み（px） */
export const TILE_THICKNESS_PX = 3;
/** 板中心の間隔 = clamp(短辺 × 0.035, 15px, 25px) */
export const DOMINO_SPACING_RATIO = 0.035;
export const DOMINO_SPACING_MIN_PX = 15;
export const DOMINO_SPACING_MAX_PX = 25;
/** 1 本の列の上限枚数 */
export const MAX_DOMINOES = 180;
/** 有効な列の最小弧長（px）と最小枚数 */
export const MIN_PATH_LENGTH_PX = 96;
export const MIN_DOMINOES = 8;
/** 指を離してから板が最終位置へ吸着する時間（ms） */
export const ALIGN_MS = 220;
/** なぞり中の板が立ち上がる時間（ms） */
export const TILE_FADE_IN_MS = 110;
/** 満たない列を消す時間（ms） */
export const STROKE_DISCARD_MS = 240;

// ---- 端の操作 ----
/** 両端の明滅の周波数（Hz） */
export const ENDPOINT_BLINK_HZ = 0.9;
/** 端のヒット範囲 = max(44px, 板長 × 2.5) */
export const ENDPOINT_HIT_MIN_PX = 44;
export const ENDPOINT_HIT_RATIO = 2.5;
/** 誤タップ時に最寄りの端を一度だけ明るくする時間（ms） */
export const ENDPOINT_FLASH_MS = 320;

// ---- 連鎖 ----
/** 先頭の板が倒れ始めるまでの遅延（ms） */
export const CHAIN_FIRST_DELAY_MS = 80;
/** 板間隔の始まりと終わり（ms）。easeInQuad で縮める */
export const CHAIN_INTERVAL_START_MS = 190;
export const CHAIN_INTERVAL_END_MS = 95;
/** 列全体の連鎖時間の下限と上限（ms）。間隔を一様に伸縮して収める */
export const CHAIN_DURATION_MIN_MS = 1400;
export const CHAIN_DURATION_MAX_MS = 9000;
/** 1 枚が倒れる見た目の時間（ms） */
export const FALL_MS = 140;
/** 倒れの回転角（rad。約 85 度） */
export const FALL_ANGLE_RAD = 1.48;
/** 最後の 1 枚前で音を引く「間」（ms）。最優先の調整点 */
export const PREFINALE_HUSH_MS = 160;

// ---- 終演 ----
/** 道全体の発光の立ち上がり時間（ms） */
export const FINALE_GLOW_MS = 650;
/** 曲線を静的な光跡へ焼き付けるまでの時間（ms） */
export const FINALE_SETTLE_MS = 1200;
/** 衝撃波の寿命（ms） */
export const SHOCKWAVE_MS = 650;

// ---- 光跡 ----
/** 確定光跡の上限本数 */
export const MAX_COMMITTED_TRAILS = 24;
/** 上限超過時に最古の光跡を消す時間（ms） */
export const TRAIL_FADE_MS = 1500;
/** 光跡の線幅（px） */
export const TRAIL_WIDTH_PX = 2.5;

// ---- グロー（別レイヤー。pitfalls.md の白飽和対策）----
/** グローキャンバスの縮小率（1/6 サイズで描き CSS 拡大） */
export const GLOW_CANVAS_DIVISOR = 6;
/** 立っている板のグロー alpha（最大値。薄く重ねない） */
export const GLOW_TILE_ALPHA = 0.1;
/** 終演の周辺光 alpha（最大値） */
export const GLOW_FINALE_ALPHA = 0.16;
/** 終演中の amp による脈動幅（±8%） */
export const GLOW_PULSE_AMPLITUDE = 0.08;
/** hush の間、道の光量を掛ける率 */
export const HUSH_GLOW_DIM = 0.6;

// ---- 終演スパークル ----
export const SPARK_SPEED_MIN_PX_S = 40;
export const SPARK_SPEED_MAX_PX_S = 170;
export const SPARK_LIFE_MIN_MS = 450;
export const SPARK_LIFE_MAX_MS = 900;

// ---- 導入 ----
/** 導入画面で見せている休止中の板が消える時間（ms） */
export const INTRO_FADE_MS = 300;

// ---- 画質の自動調整（quality.ts）----
/** 画質の段ごとの終演スパークル上限 */
export const PARTICLE_CAP_STEPS = [240, 120, 60];
export const QUALITY_WINDOW_MS = 2000;
export const QUALITY_WARMUP_MS = 3000;
/** 窓の中央値フレーム間隔がこれを超えたら 1 段下げる */
export const QUALITY_SLOW_FRAME_MEDIAN_MS = 24;
/** フレーム間隔の変動係数がこれ未満なら、遅くても rAF 制限（省エネの 30Hz 等）とみなして下げない */
export const QUALITY_THROTTLE_MAX_VARIATION = 0.12;
