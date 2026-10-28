# 深窓の索 / abyss-winder

錆びた索を円に沿って巻き取り、静かな青い水圧の輪を閉じる小品。

## 現在の段階

- 完了: 円周状態機械（`src/winding.ts`）、海底窓の描画（`src/renderer.ts`）、入力・音響の配線（`src/main.ts`）、確定幾何（`src/tuning.ts`）、Web Audioの型付き契約と音源、実画面サムネイルを実装。状態機械の純粋分離は統合担当が妥当な例外として採用済みで、mainへ再結合しない。
- 完了: 唯一の修正ラウンドR1のA〜Fで音源寿命と閉鎖tokenの解放・A相対ドリアン・中断後の旧pointer失効・停止中の索保持と次索長・粒子単位と250ms拍位相・導入階層と確定copy「窓に触れて、はじめる」を反映。Gは本書・concept・architectureの記録整合のみ。
- 完了: Gで既存回帰62件、直接型検査・作品build・`pnpm check`（5作品）・一般verifyの5項目を実行し成功。下記の自動検証と実機検証を区別する。
- 実装したが未検証: 実機の指遮蔽・多指・実タブ切替、物理出力での140ms音視覚同期・聴感、6輪超・12周・長時間継続、計測条件以外の高さ。合成入力やfake時計を実機成功へ読み替えない。
- 未着手: R1最終同SHAによる後続独立テスト・コード/見た目の再判定、統合採否、人間による公開判断。初回独立判定は別途実施済みで、R1合格ではない。PRはdraftを維持する。

`public/thumbnail.webp` は実画面（2輪閉鎖の蓄積・閉鎖輪の発光ピーク付近）から撮影した1200×630。生成画像0枚（`generatedImages=[]`）。仕様は [concept](docs/concept.md) と [architecture](docs/architecture.md)、素材方針は [image-order](docs/image-order.md)、初回段階の履歴は [process-log](docs/process-log.md) を参照。現状の正本は本書とarchitecture。

## cloneとセットアップ

前提: Git、Node **26.5.1**（`.node-version`）、pnpm **11.21.0**（ルートpackageManager）。指定バージョンを用意して確認する。古いNodeがPATH上で先行していないことにも注意する。

```bash
git clone https://github.com/takunagai/play.git
cd play
git switch feat/work-abyss-winder
node --version
pnpm --version
pnpm install --frozen-lockfile
# renderer testとverifyの初回だけ、既存Playwrightに対応するChromiumを導入
pnpm exec playwright install chromium --only-shell
```

作品lockfileは `works/abyss-winder/pnpm-lock.yaml`。ルートからのinstallはworkspaceも対象とし、既存pinと各lockfileを維持する。ルートlockfileを更新しない。作品依存は既存のp5 / Vite / TypeScriptのみ。依存の追加・更新はしない。

**作品の環境変数・APIキー・バックエンド・DBは不要。** `.env` / `.dev.vars` は作らない。実行時の外部CDN・音声ファイルのダウンロードも不要。自動検証で別のChromiumを使う場合だけ `VERIFY_CHROMIUM_PATH` を任意指定できる。通常の鑑賞・操作には不要。

## 起動・操作

以降はすべてリポジトリのルートから実行する。

```bash
pnpm --dir works/abyss-winder dev --host 127.0.0.1
```

表示されたローカルURLを開く。導入は上部の題名（狭幅26px / 通常40px）、1行の開始案内「窓に触れて、はじめる」（13px / 14px）、窓下の索端案内を分離し、暗幕は置かない。中央の窓をタップすると導入が200msで退く。その押下は巻き取りに流用せず、指を離してから索端をつかむ。

端のヒット半径は28px。時計回りに途切れず一周すると全周索と垂れ索を保ち、最終目盛りで論理140ms停止後、次の8分拍に青輪が一段閉じる。閉鎖開始から250msで輪が閉じ、900msで次の操作へ戻る。閉じた輪と巻き索は残り、次端はπ/6ずつ移動する。遅く正確な一周ほど次索の可視弧長が長く、末端は画面外へ沈む。

途中で離す・帯域を外す・逆走する・別の指を加えると未完分だけ戻る。通常の多指取消は全指のreleaseと180msを待つ。blur / 非表示 / resizeによる全体中断は旧pointerを失効し、欠落releaseで復帰が詰まらないようにする。commit前の予定は破棄し、完了済み輪は残す。

巻き中は摩擦と250ms間隔のA相対ドリアン下降（A5→A2の22音）。速く巻くと爪は短くなるが、拍は速くならない。下端後は無音程の爪と摩擦のみ。閉鎖は金属クリック・木胴・青いベルを同じ予定時刻に鳴らす。

- `?mute`: 無音で視覚を確認する。
- `?debug`: 状態・実測振幅・描画時間・音源診断を表示する。
- 音声解錠にはタップ後に指を離す。resume完了を待たず描画を続ける。
- dev/previewを終えたら起動したターミナルでCtrl+C。自分のサーバーを残さない。

## 型チェック・既存テスト・ビルド

```bash
pnpm --dir works/abyss-winder exec tsc --noEmit
# fake時計の円周・所有権・token・共通時刻の回帰（30件）
node --experimental-strip-types --test works/abyss-winder/tests/winding.test.ts
# 模擬Web Audio境界を使う実音源コードの寿命・解放・音階回帰（12件）
node --experimental-strip-types --test works/abyss-winder/tests/audio-lifecycle.test.ts
# 実Canvasの索保持・次索長・粒子・拍位相（20件、既存Playwright/Vite使用）
node --experimental-strip-types --test works/abyss-winder/tests/renderer.test.ts
# 全62件をまとめて1回実行する場合
node --experimental-strip-types --test works/abyss-winder/tests/winding.test.ts works/abyss-winder/tests/audio-lifecycle.test.ts works/abyss-winder/tests/renderer.test.ts
# tscとVite build（作品dist/を生成）
pnpm --dir works/abyss-winder build
# 全作品のメタデータ・ビルド・サムネイル・一覧リンク
pnpm check
# console/network・接触音・横スクロール・描画時間
pnpm verify abyss-winder
```

renderer testはbefore/afterで検証用Viteとブラウザを自動起動・終了する。任意の `RENDERER_EVIDENCE_DIR` を指定すると状態別PNG / Canvas stroke等のJSONを保存する。作品コードや秘密ファイルを置く場所ではなく、Git追跡外の証跡置き場を指定する。

作品とrootの `test` / `lint` / `typecheck` スクリプトは未定義。新設せず上の直接コマンドを使い、未定義スクリプトの成功とは呼ばない。Workers poolも対象外で新設・移行しない。

### R1-Gの実測（2026-10-28、Node26.5.1 / pnpm11.21.0）

| コマンド・項目 | 結果 |
|---|---|
| 変更前のwinding単独 | exit 0、30成功 / 0失敗（初回25件を維持） |
| 上記3ファイルのNode同時実行 | exit 0、62成功 / 0失敗（winding30 / audio12 / renderer20） |
| 直接tsc | exit 0 |
| 作品build | exit 0、既存500kB超chunk警告あり |
| pnpm check | exit 0、5作品 |
| pnpm verify abyss-winder | exit 0、5項目成功 |
| console-and-network | 成功、console errors / 404 / requestFailedは各0 |
| mouse-sound / touch-sound | 成功、maxAmp 0.004514859893246704 / 0.004952188931075258 |
| no-horizontal-scroll | 成功、375/1280pxの導入・操作後とも差0px |
| frame-stats | 成功（計測のみ）、meanDrawMs 1280=1.0303493618444584 / 375=1.0336617444732115 |

一般verifyの短いなぞりは接触音・負荷の検査であり、一周完成の証明ではない。音源テストは実装コードのsource予約・終了・参照を模擬contextで検査し、実機の音や聴感を測るものではない。rendererの決定的snapshot検査も実機操作とは別。結果と4枚の画像は `.verify/abyss-winder/` に出るがコミットしない。

親成果の補助証跡: 初回visualは375/1280で各3周の合成操作、Cは両幅×模擬hidden/blur/resizeの6条件、Eは論理140msに対する実rAF観測150ms（両幅）、Fは375×812 / 1280×800 / 375×667 / 480×800 / 768×1024の5条件×19確認を実施した。Fの索端案内は窓との最短距離4.61/19.35pxで非交差であり、一律6px以上とはしない。これらをGで再実行した、または実機・独立審美が成功したとは主張しない。

### 既知の範囲外・未確認

- 共通テスト `node --test scripts/tests/work-json.test.mjs` は初回の記録で75成功 / 1失敗（追加前76成功）。841〜847行の期待値が既存4作品に固定され、新作abyss-winderが含まれない。R1-Gでは未実行・未変更。人間の基盤PR判断へ返し、`pnpm check` の成功を共通テスト全件成功に読み替えない。
- 個別輪の描画は6本を上限として等高線へ集約するが、状態側 `ringStartAngles` は一周ごとに増える。小さい数値配列の長時間実害は未再現につきcode N6は今回見送り。6輪超・12周・長時間の確認は残る。
- デザインのnarrow閾値・ガラス面通過・微弱な魚影は意図として維持。π/6移動の受入記録や論理140msがあっても、12周・実機出力同期まで確認したことにはならない。
- 実機・聴感は人間確認推奨。後続の独立tester / reviewer / visual担当が同じ最終SHAでR1を確認し、統合担当が採否を判断する。

## 調整する場所

`src/tuning.ts` にパレット・確定半径の2比率式・円周許容差・拍/停止・品質段階を集約。音源のvoice/gain等は `src/audio/synth-engine.ts`、導入の題名・配置・退場は `src/style.css`、開始案内は `index.html`。[調整ノブ](docs/architecture.md#10-調整ノブ) を参照。完成角2πと論理停止140msをverify通過のために緩めない。

## プレビューと公開

```bash
# 全作品をまとめてローカル出力
pnpm build
# PRコメントに実在する最新headのプレビューを確認してから実行
pnpm verify abyss-winder --url <PRに付いたプレビューのベースURL>
```

相対アセットで `/works/abyss-winder/` へ配信する。PRはmainをbaseとし、変更は作品フォルダ内だけ。CloudflareがPRに付けるプレビューURLを使い、URLを推測しない。ローカルverifyとプレビューverifyの成功を混同せず、対象commitも照合する。

R1の独立検証・レビュー・統合判断まではdraftを維持する。ready化・採否更新は別の統合判断に委ねる。**人間がGitHubでmainへmergeした後にWorkers Buildsが本番公開する。** 制作担当は `gh pr merge` / `wrangler deploy` を実行しない。

## ライセンス・素材

作品はMIT。生成画像0枚、外部アセット0件。p5は既存テンプレートの依存（LGPL-2.1）、ViteはMIT、TypeScriptはApache-2.0であり、作品と依存のライセンスは区別する。AGPL/GPLの新規依存は追加しない。
