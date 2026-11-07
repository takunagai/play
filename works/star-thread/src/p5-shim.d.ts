// ============================================================
// p5-shim.d.ts ─ p5 2.3.3 用の最小アンビエント型宣言
//
// p5@2.3.3 は package.json の exports で "./types/p5.d.ts" を指しているが、
// 実際に配布される npm パッケージにはその types/ ディレクトリが存在しない
// （実測: node_modules/.pnpm/p5@2.3.3/node_modules/p5/ 配下に *.d.ts が 1 つも無い）。
// @types/p5 はこのプロジェクトの依存に無く、v1 用で合わないため、
// ここで使う API 面だけの最小アンビエント宣言を置いて `tsc --noEmit` を通す。
// p5 のフル API を型付けするものではない。
// ============================================================

declare module "p5" {
  export default class P5 {
    constructor(sketch: (instance: P5) => void, node?: HTMLElement | string);

    /** p5 v2 の Friendly Error System を止める静的フラグ（偽陽性が fps を殺すため必須） */
    static disableFriendlyErrors: boolean;

    setup: () => void;
    draw: () => void;
    windowResized: (() => void) | undefined;

    /** p5 単位（pixelDensity(1) 済みなら CSS px と一致する） */
    width: number;
    height: number;
    windowWidth: number;
    windowHeight: number;
    deltaTime: number;
    frameCount: number;

    createCanvas(width: number, height: number): { elt: HTMLCanvasElement; parent(node: HTMLElement | string): void };
    resizeCanvas(width: number, height: number): void;
    /** createCanvas の後に呼ぶこと（p5 v2 の既知の制約） */
    pixelDensity(density?: number): number;

    /** 2D レンダラの生の CanvasRenderingContext2D */
    drawingContext: CanvasRenderingContext2D;

    millis(): number;
    remove(): void;
  }
}
