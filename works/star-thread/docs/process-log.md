# 星を結ぶ夜 ─ 制作記録

## Phase 0: 構想（2026-11-06）

### 作業場と保全

- fetch 後の exact base: `4bf2a492b06ee16732f0af2d46ed81224d9398ae`。事前に示された origin/main と一致し、この SHA から `feat/work-star-thread` を作成。
- 開始時は `feat/work-abyss-winder` / `16bba0b6e89d9d684d00dacfdc9ea78e68842782`、git status --short は空。既存ブランチ・成果・別 worktree は保持し、reset/delete/stash は行っていない。
- 後工程は作成した作品ブランチを継承する。共有作業場の書込工程は依存で直列化し、素材担当は読取のみ。作品外のファイル・root lockfile は変更しない。
- 指定の PATH を通しただけでは Node v22.22.3 が選ばれた。既存の coder 用 Node キャッシュの bin を追加で PATH の先頭へ置き、Node v26.5.1 / pnpm 11.21.0 を実測して以降の検証を実行。システムの Node・設定・依存版は更新していない。

### ハーネスの生存確認（実装前）

1. 旧作品ブランチで `node --test scripts/tests/work-json.test.mjs` は 76 件中 75 成功・1 失敗。失敗は「実リポジトリの作品が既存 4 本」という固定期待値に abyss-winder が加わる差分。`pnpm check` は 5 作品で pass。
2. 指定 base からの clean な新ブランチで、同テスト **76/76 成功、fail 0、exit 0**。`pnpm check` は **check: pass（4 作品）、exit 0**。基盤の変更はせず、この結果を着手ゲートとした。
3. Workers-pool は本リポジトリのハーネスではないため非対象。Node の既存ハーネスを使用した。

### 設計判断（完了）

- お題「長押しで星を集めて、離すと星座が結ばれて鳴る」を優先し、CRT・ノイズ・マイナーを不採用にした。
- 指定した感情・動詞・トーン・音・音階と date=2026-11-06 / origin=autopilot / license=MIT を work.json に設定。
- `node scripts/new-work.mjs star-thread --title '星を結ぶ夜' --summary '長押しで星を集め、離すと星座が結ばれてオルゴールが鳴る' --emotion '驚き・発見' --verb '引き寄せと反発' --tone 'ダーク＋ネオン' --sound 'アコースティック風' --scale 'メジャーペンタ' --origin autopilot` を実行、exit 0。音階の自動置換以外に本体ソースを変更していない。
- 完全一致の名前検索では同名作品・サービスを確認できなかった。類似名の存在と検索の限界は concept.md に記載。
- concept.md に 30 秒の因果、architecture.md に担当分割・15 検証ケース・0.3 秒報酬・2 指所有・線音時計・寿命・中断時の状態表を定義。
- 生成画像 0 枚、画像発注 0 枚、generatedImages=[]。image-order.md へ明記。
- moon-mosaic の不採用記録、Cloudbreak の人間の不採用理由、運用の訂正集を読んだ。自動 pass と楽しさ・心地よさ・特筆すべき見た目を別の評価にする。

### 初期化物・依存

- 雛形の固定版 p5 2.3.3 / TypeScript 6.0.3 / Vite 8.3.0 をそのまま継承。記憶で版を書き替えておらず、追加依存・npm install・package-lock.json はない。新たな版選定をしていないため npm view は実行していない。
- `pnpm --dir works/star-thread licenses list --json`、exit 0。直接依存のライセンスは p5=LGPL-2.1、TypeScript=Apache-2.0、Vite=MIT。雛形の p5 は GPL/AGPL とは区別する。作品自身の license は MIT。推移依存の一覧にも GPL/AGPL はない。
- 現在は p5 を main.ts、TypeScript を tsc、Vite を起動・build で使用。依存を足して放置していない。
- 作品内 .gitignore に node_modules/dist/秘密ファイル/ログを除外。新しい Cloudflare・Astro・DB の設定や秘密は作らない。
- `public/thumbnail.webp` は `pnpm check` に必須のため、初期化物として構想用の手製模式図を用意。1200×630 WebP、7.5 KiB。実装画面ではなく、仕上げで実画面の結果へ置換する。生成モデルは使っていない。
- README に clone、セットアップ、環境変数不要、起動、テスト、公開手順と現状の未実装を記載。

## Phase 1: 構想成果の検証

| コマンド・検査 | 実測結果 | 達成状態 |
|---|---|---|
| `pnpm install --frozen-lockfile` | exit 0、all 7 workspace projects / Already up to date | 完了 |
| `pnpm --dir works/star-thread exec tsc --noEmit` | exit 0、型エラーなし | 完了（雛形のみ） |
| `pnpm --dir works/star-thread build` | exit 0、Vite 8.3.0、357 modules transformed | 完了（雛形のみ） |
| `pnpm check` | exit 0、check: pass（5 作品）。全作品の型/build・manifest・サムネイル・一覧リンク検査を含む | 完了 |
| `node --test scripts/tests/work-json.test.mjs`（新作追加後） | exit 1、76 件中 pass 75 / fail 1。既定引数の固定 4 作品の期待値へ star-thread が追加された差分のみ | 全件成功は未達。基盤ファイルは変更しない |
| 独立した lint | ルート・雛形にスクリプトなし | 適用外。合格を主張しない |
| `git diff --check` | exit 0、空白エラーなし | 完了 |
| 公開候補のパス・秘密・生成物・未置換文字列検査 | 公開不可パス 0、秘密/生成物 0、未置換文字列 0。本体ソースは雛形同一（new-work による音階変更のみ） | 完了 |
| 設計式の検算 | 0/300/1200/2700ms→3/4/7/12 星、2/3/6/11 線。4 星は 480ms、12 星は 1760ms の旋律 | 完了（計算のみ、実装の挙動ではない） |

既存作品と雛形由来の 500kB 超 chunk 警告があるが build は成功した。構想で依存更新や分割改造を先取りしない。

新作を追加すると失敗する固定作品名のテストについて、作品外で直さず発注元へ報告する。後工程も全件成功と偽らず、基盤の扱いは lead と人間が裁定する。

## Phase 2: 作品の実装・試遊（未着手）

星の吸引、2 指の所有、星座の線、オルゴールの予約・同期・寿命・中断処理は未実装。intro の可視案内文も雛形のまま。構想文書の仕様をコードが既に満たすという意味ではない。

`pnpm verify star-thread` は構想カードでは未実施。console/404、mouse/touch sound、横スクロール、frame-stats の pass/fail と maxAmp/meanDrawMs は未測定。ST-01〜15、iPhone 実機の release 解錠、独立審美・楽しさ・コード審査はすべて未達。仕上げ時に実画面サムネイルと結果を追記する。

## Phase 3: 公開

本工程で作る PR は main base の draft。完成・公開・ready 化を意味しない。プレビューは Cloudflare の PR コメントに出る実 URL を後工程で取得して確認する。人間の merge と Workers Builds が本番反映を担い、worker は merge/deploy を行わない。
