// 作品集 play のテスト用フック（全作品共通の契約。正本: リポジトリの docs/work-json.md「テスト用フック」）
// scripts/verify-work.mjs は window.__art だけを見る。作品の挙動には影響しない読み取り専用の窓口。

export interface FrameStats {
  /** 読み込みから描いたフレーム数 */
  frames: number;
  /** 描画 1 回の処理時間の平均（ms） */
  meanDrawMs: number;
}

export interface ArtHook {
  /** 直近の出力振幅（0〜1 目安）。無音なら 0 */
  getAmp(): number;
  /** 状態機械の現在の状態（導入画面は "intro"） */
  getState(): string;
  getFrameStats(): FrameStats;
}

declare global {
  interface Window {
    __art?: ArtHook;
  }
}

/** 描画ループの計測。draw の末尾で record(処理時間) を呼ぶ */
export function createFrameCounter(): { record(drawMs: number): void; stats(): FrameStats } {
  let frames = 0;
  let totalDrawMs = 0;
  return {
    record(drawMs: number): void {
      frames++;
      totalDrawMs += drawMs;
    },
    stats(): FrameStats {
      return { frames, meanDrawMs: frames > 0 ? totalDrawMs / frames : 0 };
    },
  };
}

export function installArtHook(hook: ArtHook): void {
  window.__art = hook;
}
