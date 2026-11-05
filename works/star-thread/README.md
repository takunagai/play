# 星を結ぶ夜

長押しで星を集め、離すと星座が結ばれてオルゴールが鳴る小品の構想。

**現在は設計と雛形の初期化のみ。星座の体験は未実装。** 実行すると雛形のベルと波紋が表示される。サムネイルは構想用の模式図で、完成画面ではない。

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

秘密・API キー・環境変数は不要。`.env` や `.dev.vars` を作らない。依存は雛形固定版を継承し、この構想で追加・更新していない。

## 起動・ビルド

```bash
pnpm --dir works/star-thread dev --host 127.0.0.1
pnpm --dir works/star-thread build
pnpm --dir works/star-thread preview --host 127.0.0.1
```

Vite が表示した URL で開く。開発サーバーは Ctrl+C で終了する。配信先は `/works/star-thread/`、アセットは相対参照。`?mute` は無音、`?debug` は診断表示。

## テスト

リポジトリ直下から実行する。

```bash
node --test scripts/tests/work-json.test.mjs
pnpm --dir works/star-thread exec tsc --noEmit
pnpm --dir works/star-thread build
pnpm check
```

基盤の上記テストには、実リポジトリの作品名を既存 4 本に固定した 1 ケースがある。新しい star-thread を初期化した後は、そのケースだけ期待値との差で失敗する可能性がある。作品から基盤テストを変更せず、結果は失敗として報告する。開始時点の 4 作品だけの base では 76/76 を確認済み。

lint スクリプトは雛形・ルートとも未定義。`tsc` と `pnpm check`、`git diff --check` を実施するが、これを独立した lint の合格と呼ばない。

実装と音響が揃った後のブラウザ検証:

```bash
pnpm exec playwright install chromium --only-shell
pnpm build
pnpm verify star-thread
```

結果は `.verify/star-thread/result.json` と 375/1280px の導入・操作後スクリーンショット。構想時点では verify 未実施で、`maxAmp`・`meanDrawMs` の測定値はない。実装後は [docs/architecture.md](docs/architecture.md) の ST-01〜15 を仕様起点に検証し、0.3 秒・2.7 秒・2 指・中断・寿命と線音同期を別途確かめる。iPhone 実機と Chromium の CDP タッチは分けて報告する。

## 公開・後工程

同じ draft PR に設計・描画・音響・仕上げを順に反映する。Cloudflare が PR コメントへ載せる実際の preview URL で確認する。人間が GitHub 上で main に merge した後、Workers Builds が本番へ反映する。worker は merge や `wrangler deploy` を行わない。

- [構想と30秒シナリオ](docs/concept.md)
- [実装契約・時刻・星数・担当ファイル分割](docs/architecture.md)
- [画像発注0枚](docs/image-order.md)
- [制作記録と検証の達成状態](docs/process-log.md)

調整値は実装工程で `src/tuning.ts` に集める。仕上げ工程では本 README を実装状態に合わせ、模式図を実画面サムネイルに置換し、check/verify の実測値と残課題を制作記録へ追記する。
