# 深窓の索 / abyss-winder

錆びた索を円に沿って巻き取り、静かな青い水圧の輪を閉じる小品。

## 現在の段階

- 完了: 円周巻き取りの状態機械（`src/winding.ts`・純粋で fake時計テスト可）、海底窓の描画（`src/renderer.ts`）、入力配線（`src/main.ts`）、デザイン確定値の転記（`src/tuning.ts`）、円周判定の回帰テスト（`tests/winding.test.ts`）。
- 実装済みの操作: 中央タップで導入を抜け、垂れた索端（ヒット半径28px）をつかみ、時計回りに途切れず一周。途中で離す・円を外す・逆走する・別の指へ渡すと未完分だけ静かに戻る。有効一周で最後の目盛りが合い、0.14秒の停止の後、次の8分拍に輪が一段閉じる。閉じた輪と巻き索は蓄積し、次の索端は π/6 ずつずれて垂れる。
- 未着手（次カード）: 摩擦・拍下降音・閉鎖ベルの音響同期（`src/audio/` の拡張）、実画面からのサムネイル置換、`work.json` の生成画像記録（0枚のまま）。
- `public/thumbnail.webp` は静的な構想図。完成画面・動作確認の証拠ではなく、仕上げ段階で実画面から置換する。

仕様は [concept](docs/concept.md) と [architecture](docs/architecture.md)、素材の決定は [image-order](docs/image-order.md)、経緯は [process-log](docs/process-log.md) を参照。

## cloneとセットアップ

前提: Git、Node **26.5.1**（リポジトリの `.node-version`）、pnpm **11.21.0**。指定バージョンを用意し、`node --version` / `pnpm --version` で確認する。

```bash
git clone https://github.com/takunagai/play.git
cd play
git switch feat/work-abyss-winder
pnpm install --frozen-lockfile
```

作品のlockfileは `works/abyss-winder/pnpm-lock.yaml`。ルートのlockfileを更新しない。依存は既存テンプレートの p5 / Vite / TypeScript のみ。

環境変数・APIキー・サーバー・DBは不要。`.env` / `.dev.vars` は作らない。外部CDNや音声ファイルのダウンロードも不要。自動ブラウザ検証に別のChromiumを用いるときだけ、ルートの規約に従い `VERIFY_CHROMIUM_PATH` を任意設定する。

## 起動・操作

リポジトリのルートから:

```bash
pnpm --dir works/abyss-winder dev --host 127.0.0.1
```

表示されたローカルURLを開き、中央をタップして始める。垂れた索端をつかみ、時計回りに一周。途中で離す・円を外す・逆走する・別の指へ渡すと未完分だけ戻る。有効一周で最後の目盛りが合い、0.14秒の停止の後、次拍に輪が一段閉じる。閉じた輪と巻き索は残り、次の索端は少し離れて垂れる。

- `?mute`: 無音で視覚を確認する。
- `?debug`: 状態・実測振幅・描画時間を表示する。
- 音声解錠にはタップ後に指を離す。音が無くても描画は止めない。

## 型チェック・テスト・ビルド

```bash
# 作品の型検査
pnpm --dir works/abyss-winder exec tsc --noEmit
# 作品の型検査とビルド（dist/を生成）
pnpm --dir works/abyss-winder build
# 円周判定・共通時刻契約の作品固有回帰テスト
node --experimental-strip-types --test works/abyss-winder/tests/winding.test.ts
# 全作品のメタデータ・ビルド・サムネイル・一覧リンク
pnpm check
# 既存の基盤回帰（Nodeテスト）
node --test scripts/tests/work-json.test.mjs
# 既存作品の回帰
node --experimental-strip-types --test works/shatter-spire/tests/*.test.ts
```

作品固有の `test` / `lint`、rootの `test` / `lint` / `typecheck` scriptは現段階では未定義（実行時は `ERR_PNPM_NO_SCRIPT`）。上の直接実行による型チェックと既存テストを、それらの成功に読み替えない。円周判定と時刻境界のテストは `tests/winding.test.ts`（25件・fake時計）に実装済み。

既知の範囲外の失敗: 新作追加後の基盤回帰は75 pass / 1 fail。`scripts/tests/work-json.test.mjs:841-847` が作品名を既存4作品へ固定しており、正しく列挙された `abyss-winder` が期待値にないため失敗する。作品追加前は76 pass。基盤スクリプトは作品PRで変更禁止のため、人間・leadへ別途判断を引き継ぐ。`pnpm check`（5作品）と作品の直接tsc・buildは成功しているが、基盤テスト全件成功とはしない。

実装・仕上げ後にはルートから次も実行する:

```bash
pnpm exec playwright install chromium --only-shell
pnpm verify abyss-winder
```

実装1（円周操作・描画）の実測（2026-10-28）: pass。console errors 0 / 404 0、mouse-sound maxAmp 0.0633、touch-sound maxAmp 0.0612（states intro→idle）、横スクロールなし、meanDrawMs 1280=1.67 / 375=1.19。誘導文は実幅クランプと窓の縁（リム外周+6px）・垂れ索帯（距離≥8px）の候補評価で配置し、375px/1280px/768px の実描画ピクセル解析で「窓の縁から離れる・垂れ索と8px以上」を数値確認済み。一般verifyの短いなぞりは局所音・console/404・横スクロール・描画負荷の検査であり、一周完成の証明ではない。専用の円周操作検証（マウス/実タッチの連続一周・キャンセル・多pointer・140ms同期の実測）は後続の検証担当の領分。実測結果は `.verify/abyss-winder/` に出るがコミットしない。`?mute` の無音は期待動作として別検証する。

## 調整する場所

`src/tuning.ts` に視覚・操作・拍の定数を集約する設計。パレット・幾何（窓半径の2比率式）・円周判定の許容差・共通時刻契約（`EIGHTH_MS` / `HITSTOP_MS`）・品質段階をここで触る。[architectureの調整ノブ](docs/architecture.md#10-調整ノブ) に初期値を記載。完成角 `2π` と停止140msを、verify通過のために緩めない。

## プレビューと公開

```bash
pnpm build
pnpm verify abyss-winder --url <PRに付いたプレビューのベースURL>
```

作品は相対アセットで `/works/abyss-winder/` へ配信される。PRは `main` をbaseにし、変更をこの作品フォルダだけに限定する。構想段階はdraftを維持し、実装・独立検証後のready化は統合担当の判断。CloudflareがPRへ付けたプレビューURLを使い、URLを推測しない。

本番公開は**人間がGitHubでmainへmerge**した後のWorkers Buildsに委ねる。制作担当は `gh pr merge` や `wrangler deploy` を実行しない。開いたローカルdev/previewサーバーは作業後に終了する。

## ライセンス・素材

作品はMIT。生成画像0枚、外部アセット0件。p5は既存テンプレートの依存（LGPL-2.1）、ViteはMIT、TypeScriptはApache-2.0であり、作品のライセンスと依存のライセンスは区別する。AGPL/GPLの新規依存は追加しない。
