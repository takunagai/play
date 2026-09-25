# play ─ 制作記録

作品集の土台づくりと、対話制作 2 作品（prism-pop・heartburst）の移植の判断とつまずき。作品ごとの記録は `works/<slug>/docs/process-log.md`。

## 2026-09-25 土台と移植

### 構成の判断

- 全作品を 1 リポジトリ・1 Worker（静的アセットのみ）で配信。トップ = 一覧、作品 = `/works/<slug>/`
- 移植は `git subtree add` で元の履歴ごと取り込み、`web/` の中身を作品フォルダ直下へ `git mv`。heartburst のネイティブ版（`sc/` `processing/` `tidal/` `bin/`）は `native/` にまとめてビルド対象外にした（`bin/start.sh` は `$(dirname $0)/..` 基準なので、4 つを一緒に動かせば起動できる）
- 作品側の `wrangler.jsonc`・`.node-version` を削除し、ルートに一本化。Vite の `base` を `'./'` にし、`index.html` の先頭 `/` の絶対パス（prism-pop の favicon、heartburst のロゴ）を相対に直した。prism-pop の浮遊生物は `import.meta.env.BASE_URL` 経由なので `'./'` でそのまま動く
- heartburst の OGP（`og:url`・`og:image`）を `play.nagai-shouten.com/works/heartburst/` に、AGPL のソース提供先（遊び方カードとコンソール）を `github.com/takunagai/play/tree/main/works/heartburst` に変えた。移植で変更を加えた版が動くため、提供先はこのリポジトリにする必要がある
- ライセンス: heartburst のフォルダは AGPL-3.0（指示どおり。元はウェブ版だけが AGPL で、ネイティブ版は明示なし）、それ以外は MIT
- 移植で足したのはテスト用フック `window.__art` だけ。既存の `getAmp()`・状態機械・描画時間の計測値を返すだけで、作品の挙動は変えていない

### lockfile を作品ごとにした（sharedWorkspaceLockfile: false）

- 症状: 新作を workspace に足すとルートの `pnpm-lock.yaml` に importer が増え、「作品の PR は `works/<slug>/` だけを触る」規約と両立しない。自律作品の PR が並ぶとルートの lockfile で衝突もする
- 対処: `pnpm-workspace.yaml` に `sharedWorkspaceLockfile: false`（pnpm 公式設定）。各作品が自分の `pnpm-lock.yaml` を持ち、ルートは scripts 用の依存（playwright・sharp・wrangler）だけ
- 副作用として、移植 2 作品は元リポジトリの lockfile をそのまま使えた。依存の版は元と完全一致（prism-pop: p5 2.3.3 / vite 8.3.0 / typescript 6.0.3、heartburst: p5 2.3.0 / @strudel/web 1.3.0 / vite 8.1.4 / typescript 7.0.2。heartburst は `package.json` も同じ版に固定）

### ビルド

- `scripts/build.mjs`: work.json を検証 → 各作品を順にビルド → `dist/works/<slug>/` にコピー → 一覧を生成。1 作品でも失敗したら exit 1
- 所要時間（クリーンな clone、pnpm の store は温まった状態）: `pnpm install --frozen-lockfile && pnpm build` で 7.4 秒（ビルド部分 5.5 秒）。Workers Builds の上限 20 分に対して十分小さい

### 検証コマンド（pnpm verify）

- ヘッドレス Chromium は既定で自動再生を許す。タッチ検証を実機に近づけるため、タッチ側は `--autoplay-policy=user-gesture-required` を明示して起動する
- 陰性対照 1: 雛形から解錠リスナーを外しても touch-sound は pass した。Chromium は「利用者の操作があったフレームで音源を `start()` すると AudioContext を自動で再開する」ため、iOS Safari でだけ起きる「指を離すまで解錠できない」無音は Chromium では再現できない。**iPhone の実機確認は引き続き人が行う**
- 陰性対照 2: 雛形が `pointerType === "touch"` を無視するように壊すと touch-sound が FAIL（maxAmp 0）になった。CDP のタッチが本物のタッチ経路（pointerType touch）を通っていることは確認できた
- 陰性対照 3: `work.json` の `emotion` を語彙外（「爽快感」）にする・`generatedImages` を 11 件にする、のそれぞれで `pnpm check` が exit 1。戻して exit 0
- 2 作品の結果: prism-pop maxAmp マウス 0.45 / タッチ 0.32、heartburst マウス 1.00 / タッチ 1.00（状態 idle → charging → inhale → impact → decay を観測）。エラー 0・404 0・横スクロールなし

### 雛形

- prism-pop の骨格（状態機械・`tuning.ts`・画質の自動調整・AudioEngine 契約・`?mute` / `?debug`）を小さく抜き出し、押す・なぞると位置で音程が決まるベルが鳴る最小作品にした。音声の開始はスキルの落とし穴どおり `resume()` を待たずに配線し、常駐の解錠リスナーを置く
- `new-work.mjs` は語彙をフラグで受ける。省略時は推奨ラベルで埋めて警告し、summary が仮の文のままだと `pnpm check` が落ちる（ビルドは通るので smoke-test は動く）
- `node scripts/new-work.mjs smoke-test && pnpm build` → `pnpm verify smoke-test` 5 項目 pass → サムネイルと summary を入れて `pnpm check` pass → 削除

### prepare-image

- 「明るさ = 不透明度」の変換式は、圧縮なしで黒に重ね直すと誤差 0。lossy の webp は色差の間引きで誤差が出るため、黒背景の透過では `smartSubsample` を使い、変換後に「黒に戻した差（平均・最大）」を表示して自己検証できるようにした（heartburst の og-image で平均 0.71・最大 36、`--lossless` なら平均 0.44・最大 1）
- sharp 0.35.4。lockfile に `@img/sharp-linux-arm64` と libvips の arm64 版が入っている（VPS の linux-arm64 では optional 依存として入る）

### 公開リポジトリにする前の確認

- prism-pop の履歴に LAN の IP アドレス（192.168.x.x）が 2 か所ある（2026-09-24 のコミットで作業ツリーからは伏せ済み。元リポジトリ takunagai/prism-pop は既に公開）。subtree で履歴ごと取り込んだので、play にも同じ履歴が入る

## 2026-09-25 Workers Builds と本番公開

- 一覧ページのデザインは、ユーザーが別セッションの `/design` で作り直した（`c7adc92`）
- Node / pnpm の指定: ビルドログに `Detected the following tools from environment: nodejs@26.5.1, pnpm@11.21.0`。`.node-version` と `packageManager` の両方が効く
- ブランチビルドの既定コマンドは `npx wrangler preview`（Worker Previews）。`wrangler.jsonc` に `previews` ブロックが無いと `Your Wrangler configuration is missing a previews block` で失敗する → 空の `"previews": {}` を追加
- `previews` を足してもビルドは成功するのに PR のコメントは「No Preview URL」だった。`preview_urls: true` が必要で、しかもこの設定は **本番の `wrangler deploy` で反映される**（公式: /workers/previews/custom-domains/）。main に取り込んで本番を再デプロイした後のブランチビルドで、`https://<ブランチ名>-play.nagai-shouten.workers.dev` がコメントされた
- 依存キャッシュ: 効く。1 回目は再利用 0、2 回目は heartburst 89/89・ルート 36/37・prism-pop 13/35 を再利用。install 6.9 秒 → 4.8 秒、ビルド全体 44 秒 → 41 秒（初期化と Node の導入が大半）
- 本番確認: `https://play.nagai-shouten.com/`・`/works/prism-pop/`・`/works/heartburst/` が 200、OGP の URL は本番と一致。`pnpm verify <slug> --url https://play.nagai-shouten.com` で 2 作品ともタッチを含む 5 項目 pass（E2E は agent-browser の代わりに、同じ CDP タッチを使う `pnpm verify` で行った）

## 2026-09-26 light-domino 再設計の状態検品

- 実入力（合成 PointerEvent + CDP タッチ、mouse / touch の 2 経路）で 6 状態 × 375 / 1280px のスクリーンショットを取得（`.verify/light-domino/states/`。コミットしない）。撮り分けは `window.__art.getState()` を見て確認し、tracing はドラッグ 75% 地点、chain は入射 3.5 秒後（中盤）、finale は開花 window、commit は settle 後に撮影
- ピクセル統計（実測）: 全状態 20 枚で白飛び 0（lum≥250 の画素なし。最大明度 245 = warmWhite 未満、p99 の最大は commit-cross-375 の 105 で暗室維持）。濁った茶・オリーブ近似色（RGB を (72,48,24)〜(120,96,48) の箱で分類）は finale 0.06〜0.10% / commit 0.27〜0.30% / 交差 commit 0.54〜0.60% と少量で、その 95〜100% が lum≥150 の明部から 6px 以内＝金の線の縁の落ち影で、面ではない。375px の主役画素比は全状態で 1280px と同等以上（tracing の warmWhite 0.184% vs 0.102%、finale の金 0.461% vs 0.381%）＝独立スケールが効いている
- intro 実測: 床の眠る光の金の小点は lum≥80 の連結成分で 1280=19 個 / 375=18 個（正本の 12〜18 個と整合）、下部帯（y 705〜751）に文字画素 764px（lum≥96）＝タイトル・案内は 375px でも埋もれず画面内（帯背景の中央明度 19 に対し文字は明部）
- 回帰の実測: `?mute` で maxAmp 0 のまま連鎖が視覚だけで進行（4.5 秒サンプリングで chain 到達・amp 0 維持・scrollWidth 375）、1280 → 375 のリサイズ後も aligned を維持し列が再描画（ライブ canvas の lum≥150 画素 746px）・横スクロールなし。`pnpm verify` は mouse maxAmp 0.0156 / touch 0.0071、meanDrawMs 1280 = 0.59ms / 375 = 0.40ms で 5 項目 pass
- 床の温度の実測: 薄明部（40≤lum<110）の平均 R-B が intro 7 → chain 14〜18 → finale 25〜29 → commit 確定後 45 と単調に上がり、照りが冷色から暖色へ補間される正本の物語と整合
- サムネイルを開花の finale（finale-1280）から 1200x630 へ cover 切り出しで更新
