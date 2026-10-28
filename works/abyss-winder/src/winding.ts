// ============================================================
// winding.ts ─ 円周巻き取りの純粋状態機械（DOM / p5 / 音響に依存しない）
// 正本: docs/architecture.md §3（状態機械と保持する値）§4（円周角度の連続追跡）
// §5（0.14秒と拍の関係・共通時刻契約）。
// 時刻は performance.now() と同じ原点のミリ秒。外部時計はすべてメソッド引数で渡す
// （fake 時計で受入項目を検証できる）。音響カードは ClosureTimeline と planClosureTimes
// の同じ論理時計を使う。
// ============================================================

import {
  CANCEL_RETURN_MS,
  CONTACT_MIN_INTERVAL_MS,
  EIGHTH_MS,
  GAP_ANGLE_RAD,
  HITSTOP_MS,
  MAX_ANGLE_STEP_RAD,
  NEXT_TIP_STEP_RAD,
  RADIAL_BAND_MIN_PX,
  RADIAL_BAND_RATIO,
  REVERSE_TOLERANCE_RAD,
  RING_CLOSE_MS,
  ROPE_LENGTH_MAX_RATIO,
  ROPE_LENGTH_MIN_RATIO,
  SAMPLE_GAP_MS,
  SETTLE_MS,
  SPEED_MAX_RAD_S,
  SPEED_MIN_RAD_S,
  START_ANGLE,
  TIP_HIT_RADIUS_PX,
} from "./tuning.ts";

const TAU = Math.PI * 2;
/** 浮動小数点丸めの吸収のみ。実質的な完成角の緩和（359度等）ではない */
const LAP_EPS = 1e-9;
/** 角速度の平滑係数（サンプルごとの指数移動平均） */
const SPEED_SMOOTHING = 0.25;

export type WindingState =
  | "intro"
  | "idle"
  | "winding"
  | "aligning"
  | "hitstop"
  | "closing"
  | "settling"
  | "cancelled";

export type CancelReason =
  | "release"
  | "escape"
  | "reversal"
  | "jump"
  | "gap"
  | "center-cross"
  | "foreign-pointer"
  | "pointercancel"
  | "lostcapture"
  | "interrupt";

/** 窓の幾何（CSS px）。renderer の computeLayout と同じ値を使う */
export interface Geometry {
  cx: number;
  cy: number;
  radius: number;
  rimWidth: number;
}

/** 一周成立後に確定する共通時刻契約。音響カードが同じ値で音を予約する */
export interface ClosureTimeline {
  token: number;
  freezeAtMs: number;
  closeAtMs: number;
}

export interface PointerSample {
  x: number;
  y: number;
  timeMs: number;
}

export interface PointerEventInput extends PointerSample {
  pointerId: number;
}

/** main.ts が音・演出に接続するための通知（入力と時刻だけで、外部状態に触れない） */
export interface WindingHandlers {
  /** 索端の有効掴み（張りと局所爪音）。掴んだ座標を受け取る */
  onGrab(x: number, y: number): void;
  /** 円外接触（局所音 + 小さな非発光水紋。進捗 0）。engine 側で 50ms 以上間引く */
  onContact(x: number, y: number): void;
  /** 一周受理。音響カードはこの timeline で閉鎖音を予約する */
  onAccepted(timeline: ClosureTimeline): void;
  /** 閉鎖 commit（closeAtMs 到達・一回だけ） */
  onCommitted(timeline: ClosureTimeline): void;
  onCancelled(reason: CancelReason): void;
}

export interface WindingSnapshot {
  state: WindingState;
  /** 未完の巻き進捗 0..1（netAngle / 2π） */
  progress: number;
  /** 平滑化した角速度 rad/s（符号付き） */
  speed: number;
  /** 半径誤差が小さいほど高い 0..1（直近試行） */
  accuracy: number;
  /** 索端の現在角（巻き取り中は巻き先端、それ以外は次索の垂れ角） */
  tipAngle: number;
  /** 閉じた輪の段数 */
  closedRingCount: number;
  /** 各輪の開始角（新しいものほど末尾） */
  ringStartAngles: readonly number[];
  /** 現在 / 直近試行の開始角。試行が無ければ null */
  startAngle: number | null;
  /** 符号付き正味角。cancelled では 180ms の戻り演出込みの表示値 */
  netAngle: number;
  /** 巻き取り開始時に設定する拍の原点（音響カードの共通時計） */
  beatOriginMs: number | null;
  freezeAtMs: number | null;
  closeAtMs: number | null;
  /** commit 済みの直近 token */
  committedToken: number | null;
  /** 直近で輪が閉じた実時刻（閉じアニメ・はじみ・水紋の起点） */
  lastRingCloseAtMs: number | null;
  /** 停止中に増やさない場の時間（索・泡の位相） */
  sceneTimeMs: number;
  /** cancelled の戻り進行 0..1 */
  cancelReturn: number;
  /** ゆっくり正確な巻きほど長い次索の可視長（短辺比 0.30〜0.46） */
  nextRopeLengthRatio: number;
}

/** 前後の角差を -π..π に正規化する。絶対角や abs(delta) を足さないための唯一の入り口 */
export function normalizeAngleDelta(theta: number, previous: number): number {
  return Math.atan2(Math.sin(theta - previous), Math.cos(theta - previous));
}

/** 半径の帯域（設計許容差）。375px で ±24 / 1280px で ±36 */
export function radialBand(radius: number): number {
  return Math.max(RADIAL_BAND_MIN_PX, RADIAL_BAND_RATIO * radius);
}

/** 線分 ab と点 p の最短距離（中心を横切る近道の拒否に使う） */
export function segmentMinDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq <= 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSq));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/**
 * 共通時刻契約の拍計算（architecture.md §5 の式そのもの）。
 * 一周成立時刻に 140ms の停止を先に置き、その終端が次の 8 分拍となるよう予約する。
 * 実装2（音響カード）はこの同じ式を planClosure で使う。
 */
export function planClosureTimes(
  acceptedAtMs: number,
  beatOriginMs: number,
): { freezeAtMs: number; closeAtMs: number } {
  const closeAtMs =
    beatOriginMs + Math.ceil((acceptedAtMs + HITSTOP_MS - beatOriginMs) / EIGHTH_MS) * EIGHTH_MS;
  return { freezeAtMs: closeAtMs - HITSTOP_MS, closeAtMs };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export interface PointerReleaseInput {
  pointerId: number;
  timeMs: number;
}

export interface WindingEngine {
  /** 中央タップ領域（半径 R+rim の円盤）の押下で intro を抜ける。抜けたら true */
  introTap(x: number, y: number, timeMs: number, geometry: Geometry): boolean;
  pointerDown(event: PointerEventInput, geometry: Geometry): void;
  /** coalesced があれば時刻順に処理し、なければ単一サンプルとして扱う */
  pointerMove(event: PointerEventInput, geometry: Geometry, coalesced?: readonly PointerSample[]): void;
  pointerUp(event: PointerReleaseInput): void;
  pointerCancel(event: PointerReleaseInput): void;
  /** 予期しない lostpointercapture。自分で解放した分は main 側で転送しない */
  lostPointercapture(event: PointerReleaseInput): void;
  /** window blur / 非表示 / resize。aligning・hitstop の予定も破棄する */
  interrupt(timeMs: number): void;
  /** 時間による遷移（aligning→hitstop→closing→settling→idle、cancelled→idle） */
  tick(timeMs: number): void;
  snapshot(): WindingSnapshot;
}

export function createWindingEngine(handlers: WindingHandlers): WindingEngine {
  let state: WindingState = "intro";

  // pointer の所有権（architecture.md §4）
  let activePointerId: number | null = null;
  const pointersDown = new Set<number>();
  let lastContactNotifyMs = -Infinity;

  // 円周追跡の保持値（§3）
  let startAngle = 0;
  let previousAngle = 0;
  let netAngle = 0;
  let highWaterAngle = 0;
  let lastSample: PointerSample | null = null;
  let grabX = 0;
  let grabY = 0;
  let speedSmoothed = 0;
  let radiusErrorSum = 0;
  let radiusErrorCount = 0;
  let accuracy = 1;
  let beatOriginMs: number | null = null;
  let nextRopeLengthRatio = ROPE_LENGTH_MAX_RATIO;

  // 閉鎖と蓄積
  let tokenCounter = 0;
  let pendingTimeline: ClosureTimeline | null = null;
  let committedToken: number | null = null;
  let lastRingCloseAtMs: number | null = null;
  let closedRingCount = 0;
  const ringStartAngles: number[] = [];

  // 時間
  let sceneTimeMs = 0;
  let lastTickMs: number | null = null;
  /** 直近サンプルの半径帯域（精度の正規化に使う） */
  let radialBandOfLastGeometry = RADIAL_BAND_MIN_PX;

  // cancelled の戻り演出
  let cancelStartMs = 0;
  let cancelReturnFrom = 0;
  let cancelPointerFreeAtMs: number | null = null;

  const cancellable = (): boolean => state === "winding" || state === "aligning" || state === "hitstop";

  /** 中央タップ領域（半径 R+rim の円盤）の押下で intro を抜ける */
  function enterIdleFromIntro(x: number, y: number, geometry: Geometry): boolean {
    if (state !== "intro") return false;
    const reach = geometry.radius + geometry.rimWidth;
    if (Math.hypot(x - geometry.cx, y - geometry.cy) > reach) return false;
    state = "idle";
    return true;
  }

  function cancel(reason: CancelReason, timeMs: number): void {
    if (!cancellable()) return;
    cancelReturnFrom = netAngle;
    netAngle = 0;
    highWaterAngle = 0;
    previousAngle = startAngle;
    lastSample = null;
    speedSmoothed = 0;
    activePointerId = null;
    pendingTimeline = null;
    state = "cancelled";
    cancelStartMs = timeMs;
    cancelPointerFreeAtMs = pointersDown.size === 0 ? timeMs : null;
    handlers.onCancelled(reason);
  }

  function tryNotifyContact(x: number, y: number, timeMs: number): void {
    // 接触の過密発音を 50ms 以上間引く（architecture.md §8）
    if (timeMs - lastContactNotifyMs < CONTACT_MIN_INTERVAL_MS) return;
    lastContactNotifyMs = timeMs;
    handlers.onContact(x, y);
  }

  function acceptAttempt(timeMs: number): void {
    // 精度: 半径誤差の平均が小さいほど高い（帯域の半分で 0 になる線形写像）
    const averageError = radiusErrorCount > 0 ? radiusErrorSum / radiusErrorCount : 0;
    accuracy = clamp01(1 - averageError / (radialBandOfLastGeometry * 0.5));
    // 速さ（0.8〜1.8 rad/s）と精度から次索の可視長を決める。完成角・拍間隔は変えない
    const speedFactor = clamp01(
      (Math.abs(speedSmoothed) - SPEED_MIN_RAD_S) / (SPEED_MAX_RAD_S - SPEED_MIN_RAD_S),
    );
    nextRopeLengthRatio = ROPE_LENGTH_MIN_RATIO + (ROPE_LENGTH_MAX_RATIO - ROPE_LENGTH_MIN_RATIO) * (1 - speedFactor) * accuracy;

    tokenCounter += 1;
    const plan = planClosureTimes(timeMs, beatOriginMs ?? timeMs);
    pendingTimeline = { token: tokenCounter, freezeAtMs: plan.freezeAtMs, closeAtMs: plan.closeAtMs };
    state = "aligning";
    handlers.onAccepted(pendingTimeline);
  }

  function processSample(x: number, y: number, timeMs: number, geometry: Geometry): void {
    if (state !== "winding" || lastSample === null) return;
    const band = radialBand(geometry.radius);
    radialBandOfLastGeometry = band;
    const dt = timeMs - lastSample.timeMs;
    if (dt < 0) return; // 時刻の巻き戻りは無視する
    const theta = Math.atan2(y - geometry.cy, x - geometry.cx);
    const delta = normalizeAngleDelta(theta, previousAngle);
    const absDelta = Math.abs(delta);

    // 全サンプルで半径の帯域内を確認する（円の外への逸脱は設計許容差で非加算）
    const distance = Math.hypot(x - geometry.cx, y - geometry.cy);
    if (Math.abs(distance - geometry.radius) > band) {
      cancel("escape", timeMs);
      return;
    }
    // 連続する 2 点を結ぶ線分が中心に近づく近道を拒否する（端点だけ円上でも合格にしない）
    if (segmentMinDistance(lastSample.x, lastSample.y, x, y, geometry.cx, geometry.cy) < geometry.radius - band) {
      cancel("center-cross", timeMs);
      return;
    }
    // サンプルの角度跳躍。長い移動を補間して一周を捏造しない
    if (absDelta > MAX_ANGLE_STEP_RAD) {
      cancel("jump", timeMs);
      return;
    }
    // 長いサンプル欠落のあとの移動は拒否（静止そのものは失敗にしない）
    if (dt > SAMPLE_GAP_MS && absDelta > GAP_ANGLE_RAD) {
      cancel("gap", timeMs);
      return;
    }

    // 逆走は必ず差し引く（正の差分だけを足すラチェットにしない）
    netAngle += delta;
    if (highWaterAngle - netAngle > REVERSE_TOLERANCE_RAD) {
      cancel("reversal", timeMs);
      return;
    }
    highWaterAngle = Math.max(highWaterAngle, netAngle);

    if (dt > 0) {
      const instantSpeed = delta / (dt / 1000);
      speedSmoothed += (instantSpeed - speedSmoothed) * SPEED_SMOOTHING;
    }
    radiusErrorSum += Math.abs(distance - geometry.radius);
    radiusErrorCount += 1;
    previousAngle = theta;
    lastSample = { x, y, timeMs };

    // 完遂: 符号付き正味角が 2π 以上、開始点からの距離がヒット半径以内
    if (
      netAngle >= TAU - LAP_EPS &&
      Math.hypot(x - grabX, y - grabY) <= TIP_HIT_RADIUS_PX
    ) {
      acceptAttempt(timeMs);
    }
  }

  function resetToIdle(): void {
    state = "idle";
    netAngle = 0;
    highWaterAngle = 0;
    cancelReturnFrom = 0;
    cancelPointerFreeAtMs = null;
    lastSample = null;
    speedSmoothed = 0;
  }

  return {
    introTap(x, y, _timeMs, geometry) {
      return enterIdleFromIntro(x, y, geometry);
    },

    pointerDown(event, geometry) {
      const { pointerId, x, y, timeMs } = event;
      pointersDown.add(pointerId);
      if (state === "intro") {
        // 中央タップ領域の押下だけが intro を抜ける。導入押下を巻き取りに流用しない
        enterIdleFromIntro(x, y, geometry);
        return;
      }
      if (state === "idle") {
        const tip = START_ANGLE + NEXT_TIP_STEP_RAD * closedRingCount;
        const tipX = geometry.cx + geometry.radius * Math.cos(tip);
        const tipY = geometry.cy + geometry.radius * Math.sin(tip);
        if (Math.hypot(x - tipX, y - tipY) <= TIP_HIT_RADIUS_PX) {
          // 開始角は実際の押下角。描画上の端を円周上へ合わせるのは renderer の仕事
          startAngle = Math.atan2(y - geometry.cy, x - geometry.cx);
          previousAngle = startAngle;
          netAngle = 0;
          highWaterAngle = 0;
          speedSmoothed = 0;
          radiusErrorSum = 0;
          radiusErrorCount = 0;
          accuracy = 1;
          grabX = x;
          grabY = y;
          lastSample = { x, y, timeMs };
          beatOriginMs = timeMs;
          activePointerId = pointerId;
          state = "winding";
          handlers.onGrab(x, y);
          return;
        }
        tryNotifyContact(x, y, timeMs);
        return;
      }
      if (state === "winding" && pointerId !== activePointerId) {
        // 巻き取り中の別 pointerdown は現在の試行をキャンセルし、全指が離れるまで再開しない
        cancel("foreign-pointer", timeMs);
      }
      // aligning / hitstop / closing / settling / cancelled の追加入力は無視する（二重予約しない）
    },

    pointerMove(event, geometry, coalesced) {
      const { pointerId } = event;
      if (!pointersDown.has(pointerId)) return;
      if (state === "idle") {
        // 円外の接触にも局所反応を返す（進捗は増やさない）
        tryNotifyContact(event.x, event.y, event.timeMs);
        return;
      }
      if (state !== "winding" || pointerId !== activePointerId) return;
      if (coalesced && coalesced.length > 0) {
        // getCoalescedEvents 相当。時刻順に処理し、一つでも不正なら残りも加算しない
        for (const sample of coalesced) {
          processSample(sample.x, sample.y, sample.timeMs, geometry);
          if (state !== "winding") return;
        }
        return;
      }
      processSample(event.x, event.y, event.timeMs, geometry);
    },

    pointerUp(event) {
      const { pointerId, timeMs } = event;
      pointersDown.delete(pointerId);
      if (state === "cancelled" && cancelPointerFreeAtMs === null && pointersDown.size === 0) {
        cancelPointerFreeAtMs = timeMs;
        return;
      }
      if (state === "winding" && pointerId === activePointerId) {
        cancel("release", timeMs);
        return;
      }
      if (state === "aligning" || state === "hitstop") {
        // 一周成立後の通常 pointerup は許可する（予定は壊さない）
        if (pointerId === activePointerId) activePointerId = null;
      }
    },

    pointerCancel(event) {
      const { pointerId, timeMs } = event;
      pointersDown.delete(pointerId);
      if (state === "cancelled" && cancelPointerFreeAtMs === null && pointersDown.size === 0) {
        cancelPointerFreeAtMs = timeMs;
        return;
      }
      if ((state === "winding" || state === "aligning" || state === "hitstop") && pointerId === activePointerId) {
        cancel("pointercancel", timeMs);
      }
    },

    lostPointercapture(event) {
      const { pointerId, timeMs } = event;
      if ((state === "winding" || state === "aligning" || state === "hitstop") && pointerId === activePointerId) {
        cancel("lostcapture", timeMs);
      }
    },

    interrupt(timeMs) {
      // window blur / 非表示 / resize。保留中の閉鎖も破棄する（遅延一括発火しない）
      if (cancellable()) cancel("interrupt", timeMs);
    },

    tick(timeMs) {
      if (lastTickMs === null) {
        lastTickMs = timeMs;
        return;
      }
      const delta = timeMs - lastTickMs;
      lastTickMs = timeMs;
      if (delta > 0 && state !== "hitstop") {
        // 停止中は sceneTimeMs を増やさない。明けても経過ぶんを一括加算しない
        sceneTimeMs += delta;
      }

      if (state === "aligning" && pendingTimeline !== null && timeMs >= pendingTimeline.freezeAtMs) {
        state = "hitstop";
      }
      if (state === "hitstop" && pendingTimeline !== null && timeMs >= pendingTimeline.closeAtMs) {
        // 同 token を一回だけ commit する
        committedToken = pendingTimeline.token;
        closedRingCount += 1;
        ringStartAngles.push(startAngle);
        lastRingCloseAtMs = pendingTimeline.closeAtMs;
        netAngle = 0;
        highWaterAngle = 0;
        lastSample = null;
        state = "closing";
        handlers.onCommitted(pendingTimeline);
      }
      if (state === "closing" && pendingTimeline !== null && timeMs >= pendingTimeline.closeAtMs + RING_CLOSE_MS) {
        // 輪が閉じきった（1拍 = 250ms）ら settling へ
        state = "settling";
      }
      if (state === "settling" && pendingTimeline !== null && timeMs >= pendingTimeline.closeAtMs + SETTLE_MS) {
        pendingTimeline = null;
        resetToIdle();
      }
      if (state === "cancelled" && cancelPointerFreeAtMs !== null && timeMs >= cancelPointerFreeAtMs + CANCEL_RETURN_MS) {
        resetToIdle();
      }
    },

    snapshot() {
      const nowMs = lastTickMs ?? 0;
      const cancelReturn = state === "cancelled" ? clamp01((nowMs - cancelStartMs) / CANCEL_RETURN_MS) : 0;
      const displayNetAngle = state === "cancelled" ? cancelReturnFrom * (1 - cancelReturn) : netAngle;
      const tipAngle =
        state === "winding" && lastSample !== null
          ? previousAngle
          : START_ANGLE + NEXT_TIP_STEP_RAD * closedRingCount;
      return {
        state,
        progress: clamp01(displayNetAngle / TAU),
        speed: speedSmoothed,
        accuracy,
        tipAngle,
        closedRingCount,
        ringStartAngles,
        startAngle: state === "winding" || state === "aligning" || state === "hitstop" || state === "closing" || state === "settling" ? startAngle : null,
        netAngle: displayNetAngle,
        beatOriginMs,
        freezeAtMs: pendingTimeline?.freezeAtMs ?? null,
        closeAtMs: pendingTimeline?.closeAtMs ?? null,
        committedToken,
        lastRingCloseAtMs,
        sceneTimeMs,
        cancelReturn,
        nextRopeLengthRatio,
      };
    },
  };
}
