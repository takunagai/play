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

## Phase 2: 描画の実装（実装1）

`works/star-thread/src` の指定 3 ファイル（main.ts・tuning.ts・style.css）に視覚コアを実装し、commit `577827e` で同一 draft PR に push した。

- 押下・吸引（約 0.3 秒の短押しでも即時）・解放・星座の線・フェードを main.ts に実装。星数と旋律の時刻式（0/0.3/1.2/2.7 秒 → 3/4/7/12 星、2/3/6/11 線）は architecture.md の式を tuning.ts へ転記。
- 2 指は所有も時刻も独立。近づいても融合させず、片方の解放で他方を解放しない。
- `window.__art = { getAmp, getState, getFrameStats }` を雛形どおり公開。導入画面の状態は `"intro"`、中央タップで抜ける。
- 雛形の説明文（intro の案内文）を非言語の導入演出へ置き換え、文書にある体験を実画面で確認できる形にした。
- この時点では音は未接続。verify の音検査は別工程で通す前提。

## Phase 3: 線と音の同期（実装2）

`audio/engine.ts` に StarAudioEngine 契約（`planSequence` / `getSequenceClock` / `cancelSequence` / `suspend` / `dispose`）とオルゴール音源を実装し、main.ts の解放処理を接続、音響ノブ（master 0.35・voice peak 0.06・reverb tail 1.2s/wet 0.18・倍音 1:0.18:0.06・suspend fade 30ms）を tuning.ts へ転記。commit `0e31f9b`。

- 星 1 個につき 1 音、線の到達と光の増光を同じ時刻にする。main 側は clock のコピーを保存せず、毎フレーム `getSequenceClock(id)` で読み直す。clock の起点は可聴時刻（schedule 起点 + outputLatency/baseLatency）。
- 音声の開始は `resume()` を待たずに配線し、`pointerup` / `touchend` / `click` / `keydown` で再開。
- 実装中の訂正 1 件: 初版の `planSequence` は suspended 中の列を視覚時計に倒して星が先走る仕様差を作ったため、architecture.md の線音時計の定義どおり「AudioContext がある限り pending で保持し running を待つ」へ修正してから再検証した。

### verify 実測（commit `0e31f9b` 時点・Playwright 1.63.0）

| 項目 | 実測 |
|---|---|
| console-and-network | errors 0 / 404 0 — pass |
| mouse-sound | maxAmp 0.0111 |
| touch-sound（CDP 実タッチ） | maxAmp 0.0092 |
| no-horizontal-scroll | 375 / 1280 とも横スクロールなし |
| frame-stats | meanDrawMs 1280=1.23ms / 375=1.14ms |
| 作品内 `tsc --noEmit` / root `pnpm build` / `pnpm check` | いずれも exit 0 / pass（5 作品） |
| `node --test` | 76 件中 pass 75 / fail 1（固定期待値差分・Phase 1 と同一） |

### 中断・2 指の追加実測（ヘッドレス CDP・一時プローブで取得後に削除）

- `?mute`: amp 0、状態遷移は視覚時計で無音時と同一の順序と寿命。
- 無操作 3 秒後: amp 1.9e-11（<0.001）・activeVoices 0。常時音源なし、余韻のみで沈む。
- blur→suspend→focus 復帰: voices 0・新規発音なし、amp は平滑化減衰のみ。
- suspended 中の解放: 列は pending 2 本を保持（state waiting・amp 0・星は微光待機）→ running 復帰後に遅延開始（amp 0.0022・activeVoices 6）。発音は失われない。
- 2 指の独立 2 列: 片方ずつの解放で両方鳴る（指1 解放 amp 0.0040・指2 収集継続、指2 解放 amp 0.0063・activeVoices 12、voice 上限 48 内、console エラー 0）。

## Phase 4: 仕上げ（サムネイル・README・検証記録）

実装後の現在状態の再実測と、公開前の記録整理を行った。視覚・音の実装は変更していない。

| コマンド | 実測結果 |
|---|---|
| `node --test scripts/tests/work-json.test.mjs` | exit 1、76 件中 pass 75 / fail 1。fail は固定 4 作品期待値への star-thread 追加差分のみ（actual の差は作品一覧 1 行） |
| `pnpm build` | exit 0、5 作品 + 一覧ページ、star-thread 3.2s・合計 16.8s。雛形由来の 500kB 超 chunk 警告は既知 |
| `pnpm check` | exit 0、check: pass（5 作品）。型/build・manifest・サムネイル・一覧リンク検査を含む |
| `pnpm verify star-thread` | **pass・exit 0**。console-and-network errors 0 / 404 0、mouse-sound maxAmp 0.0114、touch-sound（CDP 実タッチ）maxAmp 0.0111、no-horizontal-scroll pass（375/1280 とも 0）、frame-stats meanDrawMs 1280=1.20ms / 375=1.13ms |
| `node scripts/prepare-image.mjs .verify/star-thread/after-1280.png works/star-thread/public/thumbnail.webp --cover 1200x630` | exit 0、1200x630・9.2 KiB。最終 verify run の実画面スクリーンショットからサムネイルへ置換（生成モデル不使用） |

- 30 秒シナリオ（concept.md「体験の流れ」）に対し、verify の実タッチ走行は intro→collecting→linking→holding と collecting→linking の繰り返しを記録し、押す長さに応じた星の収集・解放での結線・音の発生が状態遷移として観測できている。0.3 秒操作でも collecting が複数回記録され、短押しが失敗にならないことを自動走行で確認。
- スクリーンショット 4 枚（証跡は `.verify/star-thread/` に保持・コミットしない）: `intro-1280.png`（導入画面）／`after-1280.png`（操作後の星座と余韻・サムネイルの素材）／`intro-375.png`（375px 導入）／`after-375.png`（375px 操作後）。
- work.json は既定どおり `thumbnail: "thumbnail.webp"` / `generatedImages: []` で、変更していない。
- README を実装状態へ更新（未実装の注記を削除、テストの現在の実測と fail の理由、verify 実測表、公開手順を記載）。
- 実装中の訂正（Phase 3 の planSequence 修正）の際に生じた中間状態は commit 前に解消済み。最終 commit 時点の git status は空を維持。

## Phase 5: 公開と未達

本工程で作る PR は main base の draft。完成・公開・ready 化を意味しない。プレビューは Cloudflare の PR コメントに出る実 URL を後工程で取得して確認する。人間の merge と Workers Builds が本番反映を担い、worker は merge/deploy を行わない。

未達（仕上げ時点）:

- iPhone 実機での解放時の音声解錠（ST-09）は未検証。ヘッドレス CDP のタッチ検証とは分けて実機での記録が必要。
- ST-02 の定量（押下 80ms で移動 10px の動画計測）・ST-15 の審美確認は後続の描画検証・審美工程。
- 音量は architecture.md の初期値（voice peak 0.06・master 0.35）のまま。実聴での音量・音色調整は審美工程で判断できる（tuning.ts のノブ）。
- 基盤テストの固定期待値 1 fail は基盤側の扱いとして lead 判断へ。
