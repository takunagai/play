// ============================================================
// tuning.ts ─ 視覚・入力・時間・画質の定数（一元管理）
// 体感の調整はここだけを触る。数値の意味は docs/architecture.md 第 10 節に書く。
// 音響の数値は src/audio/audio-tuning.ts。
// ============================================================

// ---- パレット（docs/concept.md の指定色）----
export const PALETTE_BACKGROUND = "#111318";
export const PALETTE_COOL_GLOW = "#1A1F29";
export const PALETTE_WARM_GLOW = "#2A2620";
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
export const INPUT_EDGE_INSET_PX = 24;
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
/** 1 本の列の上限枚数（第 2 強化ラウンドで 180 → 400。正本 §10） */
export const MAX_DOMINOES = 400;
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
/** 板間隔の始まりと終わり（ms）。easeInCubic で縮める（第 2 強化ラウンドで 190/95 → 200/70 に拡大し、加速曲線を easeInQuad → easeInCubic へ変更） */
export const CHAIN_INTERVAL_START_MS = 200;
export const CHAIN_INTERVAL_END_MS = 70;
/** 列全体の連鎖時間の下限と上限（ms）。間隔を一様に伸縮して収める（上限は第 2 強化ラウンドで 9000 → 16000） */
export const CHAIN_DURATION_MIN_MS = 1400;
export const CHAIN_DURATION_MAX_MS = 16000;
/** 1 枚が倒れる見た目の時間（ms） */
export const FALL_MS = 140;
/** 倒れの回転角（rad。約 85 度） */
export const FALL_ANGLE_RAD = 1.48;
/** 最後の 1 枚前で音を引く「間」（ms）。最優先の調整点。HUSH_LONG_CHAIN_MIN_TILES 枚以上の連鎖では PREFINALE_HUSH_LONG_MS を使う */
export const PREFINALE_HUSH_MS = 160;
/** 「間」を 220ms へ伸ばす連鎖の最小枚数（正本 §3.4。短い演奏のテンポを殺さない） */
export const HUSH_LONG_CHAIN_MIN_TILES = 120;
/** 長い連鎖（HUSH_LONG_CHAIN_MIN_TILES 枚以上）の「間」（ms）。第 2 強化ラウンドで緊張を溜める */
export const PREFINALE_HUSH_LONG_MS = 220;

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
/** 確定直後の蕊 alpha（正本 §7.2） */
export const TRAIL_CORE_ALPHA_COMMIT = 1.0;
/** 残光段階の蕊 alpha（正本 §7.2: 節点上限超過後も蕊は消さず 0.5 へ減衰する） */
export const TRAIL_CORE_ALPHA_AFTERGLOW = 0.5;
/** 光跡の蕊の線幅（px）。正本 §7.2 の 1.5px（再設計で 2.5 から変更した唯一の例外的な値変更） */
export const TRAIL_WIDTH_PX = 1.5;

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

// ---- 再設計: 展示室の床 ----
/** モバイル判定の境界（px）。密度ノブは短辺 min(w,h) で決める */
export const MOBILE_BREAKPOINT_PX = 430;
/** モバイルの板中心間隔（px） */
export const MOBILE_DOMINO_SPACING_PX = 12;
export const FLOOR_GUIDE_SPACING_PX = 48;
export const MOBILE_FLOOR_GUIDE_SPACING_PX = 32;
export const FLOOR_GUIDE_ALPHA = 0.03;
export const FLOOR_GLOW_RADIUS_RATIO = 0.55;
export const FLOOR_GLOW_ALPHA_START = 0.5;
export const FLOOR_GLOW_ALPHA_END = 0.8;
export const CHAIN_LIGHT_SLIDE_MS = 500;
export const CHAIN_LIGHT_RECENT_TILES = 4;
/** 周辺減光の半径 = 画面対角 × この値 */
export const VIGNETTE_RADIUS_RATIO = 0.56;
/** 周辺減光の内側開始半径 = 短辺 × この値 */
export const VIGNETTE_INNER_RADIUS_RATIO = 0.18;
/** 周辺減光の中間ストップ（位置と alpha） */
export const VIGNETTE_MID_STOP = 0.72;
export const VIGNETTE_MID_ALPHA = 0.12;
/** 周辺減光の外縁 alpha */
export const VIGNETTE_EDGE_ALPHA = 0.68;

// ---- 再設計: 板の物体表現（数値は第 2 強化ラウンドで拡大。正本 §10・art-direction 第 2・5 章）----
/** 立板の幅。1280px で 13px（第 2 強化ラウンドで 10 から拡大） */
export const TILE_WIDTH_PX = 13;
/** 立板の奥行。1280px で 7px（第 2 強化ラウンドで 6 から拡大） */
export const TILE_DEPTH_PX = 7;
/** モバイル（375px）の立板の幅と奥行（第 2 強化ラウンドで 8/5 → 9/6） */
export const MOBILE_TILE_WIDTH_PX = 9;
export const MOBILE_TILE_DEPTH_PX = 6;
/** 倒れ後の板長。1280px で 32px（第 2 強化ラウンドで 22 から拡大） */
export const FALLEN_TILE_LENGTH_PX = 32;
/** モバイル（375px）の倒れ後の板長（第 2 強化ラウンドで 18 → 24） */
export const MOBILE_FALLEN_TILE_LENGTH_PX = 24;
export const PORTRAIT_SCALE = 1.2;
export const TILE_SIDE_BAND_ALPHA = 0.35;
export const TILE_OUTLINE_ALPHA = 0.25;
export const EDGE_REFLECTION_ALPHA = 0.4;
export const SHADOW_ALPHA = 0.5;
/** 床影の offset（px）。立っている板は (0, 8) の固定（正本 §10 の SHADOW_OFFSET 系） */
export const SHADOW_OFFSET_X_PX = 0;
export const SHADOW_OFFSET_Y_PX = 8;
export const FALLEN_GLOW_ALPHA = 0.08;
export const FALLEN_GLOW_REST_ALPHA = 0.03;

// ---- 再設計: 各状態の主役 ----
export const SLEEPING_LIGHT_COUNT_MIN = 12;
export const SLEEPING_LIGHT_COUNT_MAX = 18;
export const SLEEPING_LIGHT_PERIOD_MIN_MS = 4000;
export const SLEEPING_LIGHT_PERIOD_MAX_MS = 7000;
/** 眠る光の半径範囲（px）。分布式は 1 + (index % 3) × (max - min) / 2 */
export const SLEEPING_LIGHT_RADIUS_MIN_PX = 1;
export const SLEEPING_LIGHT_RADIUS_MAX_PX = 2;
/** 眠る光の core alpha の基準・明滅振幅・覚醒時の加算。上限は AWAKEN_LIGHT_ALPHA */
export const SLEEPING_LIGHT_ALPHA = 0.5;
export const SLEEPING_LIGHT_WAVE_AMPLITUDE = 0.35;
export const SLEEPING_LIGHT_AWAKEN_BOOST = 0.2;
/** 覚醒窓（ms）。最初の接触からこの間だけ眠る光が立ち上がる */
export const SLEEPING_AWAKEN_MS = 500;
/** 眠る光のグロー半径 = core 半径 × この値 */
export const SLEEPING_LIGHT_GLOW_RADIUS_FACTOR = 4.5;
export const SLEEPING_GLOW_ALPHA = 0.05;
export const AWAKEN_LIGHT_ALPHA = 0.9;
export const TRACING_TILE_ALPHA = 0.55;
export const TRACING_TILE_HEAD_ALPHA = 0.9;
export const TRACING_ECHO_RADIUS_PX = 6;
export const TRACING_ECHO_ALPHA = 0.15;
export const TRACING_ECHO_MS = 120;
export const ENDPOINT_BLINK_HZ_ALIGNED = 1.2;
export const ENDPOINT_BLINK_TILES = 3;
export const MOBILE_ENDPOINT_BLINK_TILES = 2;
export const ENDPOINT_BLINK_PHASE_STAGGER_MS = 80;

// ---- 再設計: 連鎖・開花・星図 ----
export const PULSE_START_RADIUS_PX = 18;
export const PULSE_END_RADIUS_PX = 34;
export const MOBILE_PULSE_START_RADIUS_PX = 14;
export const MOBILE_PULSE_END_RADIUS_PX = 28;
export const PULSE_MAX_CONCURRENT = 2;
export const NODE_RADIUS_PX = 2;
export const NODE_HALO_RADIUS_PX = 5;
export const NODE_HALO_ALPHA = 0.3;
export const MAX_LIVE_NODES = 300;
export const FINALE_BLOOM_DELAY_MS = 200;
/** legacy: 開花時間は FINALE_BLOOM_MS_BASE + FINALE_BLOOM_T_FACTOR × t の式へ置き換わり未参照（既存キー保持ルールにより残す） */
export const FINALE_BLOOM_MS = 800;
export const FINALE_BLOOM_CORE_WIDTH_PX = 3;
/** 開花中の蕊（本体の描線）の alpha */
export const FINALE_BLOOM_CORE_ALPHA = 0.92;
export const FINALE_BLOOM_GLOW_ALPHA = 0.1;
export const FINALE_BLOOM_GLOW_WIDTH_PX = 24;
/** 衝撃波の最大半径比の基数（式は 0.4 + FINALE_SHOCKWAVE_T_FACTOR × t。正本 §3.5 の長さ比例） */
export const FINALE_SHOCKWAVE_RADIUS_RATIO = 0.4;
export const FINALE_SHOCKWAVE_ALPHA = 0.12;
/** 着地パルスの塗りの alpha（正本 §3.4 の gold alpha 0.10） */
export const PULSE_ALPHA = 0.1;
/** 導入画面の休止中の板の alpha */
export const INTRO_TILE_ALPHA = 0.42;
export const COMMIT_RETRACE_MS = 500;
export const AFTERGLOW_FADE_MS = 10000;
export const CROSSING_VELOCITY_BOOST = 0.08;
export const PARALLEL_VELOCITY_BOOST = 0.08;
export const ACCUMULATION_VELOCITY_BOOST = 0.05;
export const PARALLEL_RUN_MIN_GAP_PX = 6;
export const IGNORE_BAND_BOTTOM_PX = 48;

// ---- 第 2 強化ラウンド: 時間変化（正本 art-direction 第 7 章・architecture §10）----
/** 床の照りのドリフトの周期。斜めの帯がこの周期で床を線形に横切る */
export const FLOOR_DRIFT_PERIOD_MS = 24000;
/** ドリフト帯の alpha 上限 */
export const FLOOR_DRIFT_ALPHA_MAX = 0.04;
/** ドリフト帯の幅 = min(w, h) × この値 */
export const FLOOR_DRIFT_WIDTH_RATIO = 0.3;
/** 星図の呼吸の alpha 範囲（確定節点が intro / settled 静置で脈動する） */
export const NODE_BREATHE_ALPHA_MIN = 0.35;
export const NODE_BREATHE_ALPHA_MAX = 0.5;
/** 星図の呼吸の周期範囲（節点ごとに位相をずらす） */
export const NODE_BREATHE_PERIOD_MIN_MS = 4000;
export const NODE_BREATHE_PERIOD_MAX_MS = 7000;
/** finale 前の収縮を始める連鎖進行率（最後の 15% で「息を吸う」） */
export const CHAIN_CONTRACT_START_T = 0.85;
/** 収縮後の照り半径比（FLOOR_GLOW_RADIUS_RATIO 0.55 から絞る） */
export const CHAIN_CONTRACT_RADIUS_RATIO = 0.48;
/** 収縮後の照り alpha（FLOOR_GLOW_ALPHA_END 0.8 から絞る） */
export const CHAIN_CONTRACT_ALPHA = 0.85;
/** 開花時間 = base + factor × t（t は §3.5 定義の連鎖進行率。最大 1600ms。FINALE_BLOOM_MS は式へ変更で legacy） */
export const FINALE_BLOOM_MS_BASE = 800;
export const FINALE_BLOOM_T_FACTOR = 800;
/** 衝撃波の最大半径比の t 係数（0.4 + 0.15 × t、最大 0.55） */
export const FINALE_SHOCKWAVE_T_FACTOR = 0.15;
