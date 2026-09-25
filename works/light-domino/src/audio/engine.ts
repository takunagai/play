// ============================================================
// engine.ts ─ AudioEngine 契約 + Noop 実装 + ファクトリ
// main.ts は createAudioEngine() 経由でのみ音響に触る（Web Audio を直接触らない）。
// 機能を足すときもこの契約を拡張する。正本は docs/architecture.md の「AudioEngine 契約」。
// ============================================================

export interface NoteEvent {
  /** 0..1（画面幅で正規化） */
  x: number;
  /** 0..1（画面高さで正規化） */
  y: number;
  midi: number;
  /** 0..1 の強さ */
  velocity: number;
}

export interface AudioEngine {
  /**
   * ユーザー操作のハンドラ内で呼ぶ。resume() の解決を待たずに配線まで済ませ、
   * 常駐の解錠リスナー（pointerup / touchend / click / keydown）を置く。
   * タッチは pointerdown では解錠できず、指を離した時に初めて解錠できるため
   */
  start(): Promise<void>;
  /** 配線が済んでいるか。false の間、他メソッドは何もしない */
  readonly isReady: boolean;
  note(event: NoteEvent): void;
  /** 毎フレーム呼ばれてよい（内部で平滑化） */
  setEnergy(energy: number): void;
  /** マスター振幅 0..1。1 フレーム 1 回だけ呼ぶ */
  getAmp(): number;
  /** ?debug 表示用 */
  getDiagnostics(): Record<string, string | number | boolean>;
}

export class NoopAudioEngine implements AudioEngine {
  readonly isReady = false;
  async start(): Promise<void> {}
  note(): void {}
  setEnergy(): void {}
  getAmp(): number {
    return 0;
  }
  getDiagnostics(): Record<string, string | number | boolean> {
    return { engine: "noop" };
  }
}

import { SynthAudioEngine } from "./synth-engine";

/** URL に ?mute を付けると無音（視覚のみ）で起動する */
export function createAudioEngine(): AudioEngine {
  if (new URLSearchParams(location.search).has("mute")) {
    return new NoopAudioEngine();
  }
  return new SynthAudioEngine();
}
