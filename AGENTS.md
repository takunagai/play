# AGENTS.md ─ play リポジトリの規約

ブラウザで遊ぶインタラクティブ作品集（https://play.nagai-shouten.com/）。作品 1 本 = `works/<slug>/` の 1 フォルダ。`main` への merge がそのまま本番に出る（Cloudflare Workers Builds）。

## 1 作品 = 1 PR

- ブランチは `feat/work-<slug>`。PR が変更してよいのは **`works/<slug>/` の中だけ**
- ルート・`gallery/`・`templates/`・`scripts/`・`docs/` を変える必要が出たら、作品の PR に混ぜず、理由を PR 本文に書いて人間に頼む（これらは人間の PR で変える）
- lockfile は作品ごと（`works/<slug>/pnpm-lock.yaml`）。ルートの `pnpm-lock.yaml` は変えない
- PR を出すと、Cloudflare がプレビュー URL を PR にコメントで付ける。確認はその URL で行う（`pnpm verify <slug> --url <プレビューのベース URL>` でも検証できる）
- コミットメッセージは日本語の Conventional Commits（例: `feat(tide-bloom): 新作を追加`）

## 新作の始め方

```bash
node scripts/new-work.mjs <slug> --title "<作品名>" --summary "<1 行説明>" \
  --emotion <語> --verb <語> --tone <語> --sound <語> --scale <語>
```

- `templates/work/` が `works/<slug>/` にコピーされ、`work.json`（`origin: "autopilot"`・今日の日付）と `index.html` が埋まり、`pnpm install` まで走る
- 語彙は `docs/work-json.md` の語彙表から選ぶ（表記を 1 文字も変えない）
- 雛形は「押す・なぞると、位置で音程が決まるベルが鳴り、波紋が広がる」最小作品。状態機械（`src/main.ts`）・定数（`src/tuning.ts`）・画質の自動調整（`src/quality.ts`）・音響の契約（`src/audio/engine.ts`）・`?mute` / `?debug` を土台に作り替える
- 企画・設計・記録は `works/<slug>/docs/` の concept / architecture / process-log に書く。スキル `interactive-art-builder` のワークフローに従う

## 小品の約束（autopilot の作品）

- **Tier 1 のみ**（視覚 + 音 + 操作のコア体験だけで成立させる）
- **禁止**:
  - AGPL / GPL の依存（例: `@strudel/*`）。依存を足すときはライセンスが MIT / BSD / Apache-2.0 / ISC 等であることを確かめる
  - 外部 CDN・外部サーバへの読み込み（スクリプト・CSS・フォント・画像・音声・`fetch`）。すべて作品のビルド出力に含める
  - マイク・カメラ（`getUserMedia` 等）
- **画像生成は 1 作品 10 枚まで**。作品に使った生成画像はすべて `work.json` の `generatedImages` に `{ file, prompt, model }` で記録する（`file` は `works/<slug>/` からの相対パス）
- 生成画像は `node scripts/prepare-image.mjs <in.png> <out.webp> [--black-to-alpha] [--max <px>]` で webp にする。発光する素材は黒背景で生成し `--black-to-alpha` で透過にする（生成モデルに透過を頼まない）
- ライセンスは MIT（`work.json` の `license: "MIT"`）

## 作品が守る契約

- `window.__art = { getAmp, getState, getFrameStats }` を常に公開する（雛形の `src/art-hook.ts`。消さない）。導入画面の状態は `"intro"`
- 画面中央のタップで導入画面を抜けて始まること。押す → なぞる → 離す、の操作で音が出ること（`pnpm verify` がこの操作をする）
- 音声の開始は `resume()` を待たずに配線し、`pointerup` / `touchend` / `click` / `keydown` で再開する（雛形の `SynthAudioEngine` の形。タッチは指を離した時にしか音声を解錠できない）
- アセットは相対パスで参照する（配信先は `/works/<slug>/`）
- 375px〜1280px で横スクロールを出さない

## サムネイル

`public/thumbnail.webp`（1200×630 前後）。`pnpm verify` のスクリーンショットから作るのが簡単:

```bash
pnpm build && pnpm verify <slug>
node scripts/prepare-image.mjs .verify/<slug>/after-1280.png works/<slug>/public/thumbnail.webp --cover 1200x630
```

## PR を出す前に（両方 exit 0 が必須）

```bash
pnpm check            # 全作品の work.json・サムネイル・一覧からのリンク（ビルドを含む）
pnpm verify <slug>    # コンソールエラー/404・マウスとタッチで音が出る・横スクロール・描画時間
```

- `pnpm verify` の結果は `.verify/<slug>/result.json` とスクリーンショット 4 枚（コミットしない）。PR 本文に各項目の pass/fail と `maxAmp`・`meanDrawMs` を書く
- 見た目の合否は `docs/taste-guide.md` の「自律作品の合否チェックリスト」でスクリーンショットから判定する

## 環境

- Node は `.node-version`（26.5.1）、pnpm は `package.json` の `packageManager`
- `pnpm verify` は Playwright（版は `package.json` で固定）のヘッドレス Chromium を使う。初回は `pnpm exec playwright install chromium --only-shell`。別の Chromium を使うときは環境変数 `VERIFY_CHROMIUM_PATH` に実行ファイルを指定する
