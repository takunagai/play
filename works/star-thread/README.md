# 星を結ぶ夜

長押しで星を集め、離すと星座が結ばれてオルゴールが鳴る小品。視覚は Canvas2D の手続き描画、音は Web Audio の自前合成オルゴール。生成画像・外部アセット・通信なし。サムネイルは `verify` の実画面スクリーンショットから作成している。

## セットアップ

リポジトリの `.node-version`（Node 26.5.1）とルート `package.json` の `packageManager`（pnpm 11.21.0）に合わせる。版を確認してからリポジトリ直下で実行する。

```bash
git clone https://github.com/takunagai/play.git
cd play
git switch feat/work-star-thread
node --version
pnpm --version
pnpm install --frozen-lockfile
```

秘密・API キー・環境変数は不要。`.env` や `.dev.vars` を作らない。依存は雛形固定版（p5 2.3.3 / TypeScript 6.0.3 / Vite 8.3.0）を継承し、この作品で追加・更新していない。

## 起動・ビルド

```bash
pnpm --dir works/star-thread dev --host 127.0.0.1
pnpm --dir works/star-thread build
pnpm --dir works/star-thread preview --host 127.0.0.1
```

Vite が表示した URL で開く。開発サーバーは Ctrl+C で終了する。配信先は `/works/star-thread/`、アセットは相対参照。`?mute` は無音、`?debug` は診断表示。リポジトリ直下の `pnpm build` は全作品と一覧ページを `dist/` に作る。

## テスト

リポジトリ直下から実行する。

```bash
node --test scripts/tests/work-json.test.mjs
pnpm --dir works/star-thread exec tsc --noEmit
pnpm build
pnpm check
```

`node --test` は現在 **76 件中 pass 75 / fail 1**。fail は「実リポジトリの作品名を既存 4 本に固定した」基盤テストの期待値に star-thread が加わる差分のみで、star-thread 初期化前の base（4bf2a49）では 76/76 を確認済み。作品から基盤テストを変更せず、結果は失敗として報告する。基盤側の扱いは lead 判断に委ねる。

lint スクリプトは雛形・ルートとも未定義。`tsc --noEmit` と `pnpm check`、`git diff --check` を実施するが、これを独立した lint の合格と呼ばない。

### ブラウザ検証

```bash
pnpm exec playwright install chromium --only-shell
pnpm build
pnpm verify star-thread
```

2026-11-06 の実測（Playwright 1.63.0・ヘッドレス Chromium）:

| 項目 | 実測 | 判定 |
|---|---|---|
| console-and-network | errors 0 / 404 0 | pass |
| mouse-sound | maxAmp 0.0114、collecting→linking→holding の繰り返し | pass |
| touch-sound（CDP 実タッチ） | maxAmp 0.0111 | pass |
| no-horizontal-scroll | 375 / 1280 とも横スクロールなし | pass |
| frame-stats | meanDrawMs 1280=1.20ms / 375=1.13ms（記録のみ） | pass |

結果は `.verify/star-thread/result.json` とスクリーンショット 4 枚（`intro-1280.png` / `after-1280.png` / `intro-375.png` / `after-375.png`）。証跡はコミットしない。

[docs/architecture.md](docs/architecture.md) の ST-01〜15 のうち、自動検証が覆わないものは未達: iPhone 実機での解放時の音声解錠（ST-09）、押下 80ms 反応の動画定量（ST-02）、審美確認（ST-15）は後続工程。操作フローの詳細は [docs/process-log.md](docs/process-log.md)。

## 公開

人間が GitHub 上で main に merge した後、Workers Builds が本番（play.nagai-shouten.com）へ反映する。worker は merge や `wrangler deploy` を行わない。PR の確認は Cloudflare が PR コメントに載せる実際の preview URL で行う。

- [構想と30秒シナリオ](docs/concept.md)
- [実装契約・時刻・星数・担当ファイル分割](docs/architecture.md)
- [画像発注0枚](docs/image-order.md)
- [制作記録と検証の達成状態](docs/process-log.md)

調整値は `src/tuning.ts` に集める。星数・時刻・音響ノブは構想文書の仕様値を転記したもので、音量・音色の審美調整は後続工程で行える。
