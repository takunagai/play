// ============================================================
// engine.ts ─ AudioEngine 契約 + Noop 実装 + ファクトリ
// main.ts は createAudioEngine() 経由でのみ音響に触る（Web Audio を直接触らない）。
// 正本: docs/architecture.md §6「AudioEngine 契約」。
// ============================================================

export interface FragmentEvent {
  /** 0..1（画面幅で正規化） */
  x: number;
  /** 0..1（画面高さで正規化） */
  y: number;
  /** 0..fragmentCount-1 */
  index: number;
  /** 配置後の回収数 */
  collected: number;
  /** 0..1（指速度の正規化） */
  speed: number;
}

export interface CompletionSchedule {
  /** performance.now() と同じ時刻系。hush → reveal の切替時刻 */
  revealAtMs: number;
  ringEndAtMs: number;
  swayAtMs: number;
}

export interface AudioEngine {
  /**
   * ユーザー操作のハンドラ内で呼ぶ。resume() の解決を待たずに配線まで済ませ、
   * 常駐の解錠リスナー（pointerup / touchend / click / keydown）を置く。
   * タッチは pointerdown では解錠できず、指を離した時に初めて解錠できるため
   */
  start(): Promise<void>;
  /** 配線が済んでいるか。false の間、発音メソッドは何もしない */
  readonly isReady: boolean;
  /** 欠片が逃げた（35ms の短い水滴） */
  flee(event: Pick<FragmentEvent, "x" | "y" | "speed">): void;
  /** 追従の継続量（0..1）。ドローンのフィルタをわずかに開く。個別音は鳴らさない */
  follow(amount: number): void;
  /** 欠片が月へ収まった（水滴 + 短いグラス音。回収数の D ドリアン音） */
  place(event: FragmentEvent): void;
  /** 8 分拍の pulse（現在の回収数まで上がった音階度を短く鳴らす。正本 §5） */
  pulse(collected: number, x: number): void;
  /**
   * 最後の欠片が収まった。150ms 後の revealAtMs を決めて返す。
   * main.ts はこの時刻で hush → reveal を切り替え、音と視覚を同期する
   */
  complete(): CompletionSchedule;
  /** 次の周期へ戻す（spawning で呼ぶ。ドローンと bus を元へ戻す） */
  resetCycle(): void;
  /** マスター振幅 0..1。1 フレーム 1 回だけ呼ぶ */
  getAmp(): number;
  /** ?debug 表示用 */
  getDiagnostics(): Record<string, string | number | boolean>;
}

export class NoopAudioEngine implements AudioEngine {
  readonly isReady = false;
  async start(): Promise<void> {}
  flee(): void {}
  follow(): void {}
  place(): void {}
  pulse(): void {}
  /** ?mute でも視覚の間を変えない（正本 §6） */
  complete(): CompletionSchedule {
    const now = performance.now();
    return { revealAtMs: now + 150, ringEndAtMs: now + 150 + 900, swayAtMs: now + 150 + 900 + 2400 };
  }
  resetCycle(): void {}
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
