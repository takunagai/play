# play

ブラウザで遊ぶインタラクティブ作品集。触ると動き、音が鳴る作品を集めています。

https://play.nagai-shouten.com/

- **AI 自律制作**: AI のチーム（VPS の Hermes）が週 2 本のペースで自律制作する小品
- **対話制作**: 人と AI が対話を重ねて作り込んだ作品（Prism Pop・Heartburst）

## 構成

```
works/<slug>/        作品 1 本 = 1 フォルダ（Vite + TypeScript。作品ごとに package.json と pnpm-lock.yaml）
  work.json          作品の情報（契約: docs/work-json.md）
gallery/             作品一覧ページ（render.mjs が work.json から dist/index.html を生成）
templates/work/      自律作品の雛形（scripts/new-work.mjs がコピーする）
scripts/             build / check / verify / new-work / prepare-image
docs/                work.json の契約・審美基準・制作記録
wrangler.jsonc       1 つの Worker（静的アセットのみ）で dist/ を配信
```

| URL | 中身 |
|---|---|
| `/` | 作品一覧 |
| `/works/<slug>/` | 各作品 |

## 動かし方

必要なもの: Node.js 26（`.node-version`）、pnpm 11（`package.json` の `packageManager`）

```bash
pnpm install
pnpm build                 # 全作品をビルドして dist/ を作る（1 作品でも失敗したら exit 1）
node scripts/lib/static-server.mjs dist 4173   # http://127.0.0.1:4173/ で確認
cd works/prism-pop && pnpm dev                 # 1 作品だけ開発サーバーで
```

## 作品の足し方

```bash
node scripts/new-work.mjs <slug> --title "<作品名>" --summary "<1 行説明>" \
  --emotion <語> --verb <語> --tone <語> --sound <語> --scale <語>
# 実装 → サムネイル（public/thumbnail.webp）→
pnpm check                 # work.json の契約・サムネイル・一覧のリンク（ビルドを含む）
pnpm verify <slug>         # ヘッドレス Chromium で発音・タッチ・横スクロール・エラーを検証
```

1 作品 = 1 PR（ブランチ `feat/work-<slug>`、変更は `works/<slug>/` の中だけ）。詳細は [AGENTS.md](AGENTS.md)。語彙と契約は [docs/work-json.md](docs/work-json.md)、見た目の合否は [docs/taste-guide.md](docs/taste-guide.md)。

## 検証環境

`pnpm verify` は Playwright 1.63.0（`package.json` で固定）のヘッドレス Chromium を使います。必要なブラウザは `chromium_headless_shell-1243`（Playwright 1.63.0 の Chromium headless shell）です。

```bash
pnpm exec playwright install chromium --only-shell        # 初回だけ（Linux では --with-deps で依存ライブラリも入る）
VERIFY_CHROMIUM_PATH=/path/to/chromium pnpm verify <slug> # 別の Chromium を使うとき
```

## 公開（デプロイ）

Cloudflare Workers Builds が GitHub の `main` をビルドして本番に反映します（ビルド `pnpm install --frozen-lockfile && pnpm build`、デプロイ `npx wrangler deploy`）。PR ブランチはプレビュー版がビルドされ（`npx wrangler preview`。`wrangler.jsonc` の `previews` と `preview_urls` が必要）、`https://<ブランチ名>-play.nagai-shouten.workers.dev` が PR にコメントされます。手元から `wrangler deploy` はしません。

## ライセンス

- Heartburst（`works/heartburst/`）: [AGPL-3.0](works/heartburst/LICENSE)（音楽パターン層に AGPL-3.0 の Strudel を使っているため）
- それ以外: [MIT](LICENSE) © 2026 ながたく (Taku Nagai) ─ [ナガイ商店.com](https://nagai-shouten.com/)

移植した 2 作品の元リポジトリ: [takunagai/prism-pop](https://github.com/takunagai/prism-pop)・[takunagai/heartburst](https://github.com/takunagai/heartburst)（コミット履歴はこのリポジトリにも subtree で引き継いでいます）
