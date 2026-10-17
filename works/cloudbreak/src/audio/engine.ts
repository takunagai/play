// ============================================================
// engine.ts ─ AudioEngine 契約 + Noop 実装 + ファクトリ
// main.ts は createAudioEngine() 経由でのみ音響に触る（Web Audio を直接触らない）。
// 正本は docs/architecture.md の「AudioEngine 契約」。
// ============================================================

export interface FlightSample {
  /** 0..1.06 */
  altitude: number;
  /** -0.10..0.15 altitude/second */
  velocity: number;
  /** 0 毛布 / 1 風路 / 2 蓋 / 3 晴天 */
  layer: 0 | 1 | 2 | 3;
  /** 最終層内 0..1。それ以外 0 */
  pressure: number;
  /** -1..1 */
  pan: number;
  isPressing: boolean;
}

export interface LayerCrossEvent {
  layer: 1 | 2;
  altitude: number;
  pan: number;
}

export interface BreakthroughEvent {
  /** 通常 1。将来も 0..1 に clamp */
  intensity: number;
  pan: number;
}

export interface AudioEngine {
  /**
   * ユーザー操作のハンドラ内で呼ぶ。resume() の解決を待たずに Context 作成と配線まで済ませ、
   * 常駐の解錠リスナー（pointerup / touchend / click / keydown）を置く。
   * タッチは pointerdown では解錠できず、指を離した時に初めて解錠できるため
   */
  start(): Promise<void>;
  /** 配線が済んでいるか。false の間、他メソッドは何もしない */
  readonly isReady: boolean;
  /** 押下開始。80ms attack で風とドローンを立ち上げる。未解錠でもノードは作る */
  beginLift(sample: FlightSample): void;
  /** 毎フレーム呼んでよい。内部で AudioParam を 30Hz 以下に間引き、ramp で平滑化する */
  updateFlight(sample: FlightSample): void;
  /** 離す。風を 450ms で弱める。ベルの release は切らない */
  endLift(sample: FlightSample): void;
  /** 上向きに層境界を通過（各境界で 1 回）。境界ベルを 1 音鳴らす */
  layerCross(event: LayerCrossEvent): void;
  /** 突破（同一 armed 周期で 1 回）。フィルター急開放、広い和音、C6/E6 ベル */
  breakthrough(event: BreakthroughEvent): void;
  /** マスター振幅 0..1。描画ループから 1 フレーム 1 回だけ呼ぶ */
  getAmp(): number;
  /** ?debug 表示用 */
  getDiagnostics(): Record<string, string | number | boolean>;
}

export class NoopAudioEngine implements AudioEngine {
  readonly isReady = false;
  async start(): Promise<void> {}
  beginLift(): void {}
  updateFlight(): void {}
  endLift(): void {}
  layerCross(): void {}
  breakthrough(): void {}
  getAmp(): number {
    return 0;
  }
  getDiagnostics(): Record<string, string | number | boolean> {
    return { engine: "noop" };
  }
}

import { SynthAudioEngine } from "./synth-engine";

/** URL に ?mute を付けると無音（視覚のみ）で起動する。視覚と状態は通常と同一 */
export function createAudioEngine(): AudioEngine {
  if (new URLSearchParams(location.search).has("mute")) {
    return new NoopAudioEngine();
  }
  return new SynthAudioEngine();
}
