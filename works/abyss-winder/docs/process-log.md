# 深窓の索 ─ 制作記録

## Phase 0: アイデア具体化（完了）

- お題日付は2026-10-20。2026-10-28の人間による制作再開承認後に、既存ブランチを再利用した。開始HEADとfetch後のorigin/mainはいずれも `4bf2a492b06ee16732f0af2d46ed81224d9398ae`。初期statusは空。
- 最初の試行は既存の作品列挙ハーネスの障害で停止し、作品ファイルを作っていなかった。人間が独立した基盤PRをmergeし、実作業場へ反映した後に再開。今回は基盤・既存作品を変更しない。
- Node 26.5.1 / pnpm 11.21.0で着手前に `node --experimental-strip-types --test works/shatter-spire/tests/*.test.ts`（9 pass / 0 fail）、`node --test scripts/tests/work-json.test.mjs`（76 pass / 0 fail）、`pnpm check`（4作品、exit 0）を実行した。Workers poolは存在せず新設しない。
- 人間のお題を抽選より優先。「巻き取る」が契約語彙にないため、メタデータのverbだけ「引き寄せと反発」。タイトル・4色・音の性格・ドリアン・0.14秒停止は維持。
- 一周判定は符号付き正味角と経路の連続性で設計。拍を待つ予備整列と140msの停止を分け、停止終端を次の8分拍へ合わせる。入力角の不足を演出で補わない。
- 画像発注0枚。曲線・円弧・粒子による自力描画。錆は索だけの局所材質色とし、濁った背景にはしない。
- `new-work.mjs` の正規手順で雛形を生成し、日付だけお題指定の2026-10-20へ戻した。実行コードは雛形のまま。初期thumbnailは静的な構想図で、完成画面の証拠ではない。

### 依存バージョンの実測と据え置き理由

初期化前に `npm view vite version` → `8.3.5`、`npm view typescript version` → `7.0.2`、`npm view p5 version` → `2.3.4` を実行した。さらに固定版の `npm view vite@8.3.0 version license` → `8.3.0 / MIT`、`npm view typescript@6.0.3 version license` → `6.0.3 / Apache-2.0`、`npm view p5@2.3.3 version license` → `2.3.3 / LGPL-2.1` を確認した。

このカードは既存テンプレートを正本にする指定のため、その固定版を維持し、新しい最新版への更新や追加依存は行わない。p5の既存LGPL依存とAGPL/GPLの新規追加禁止は区別する。lockfileは作品内だけ追加する。

### 構想段階の生成後ゲート

- `pnpm install --frozen-lockfile`: exit 0、lock変更なし。
- `pnpm --dir works/abyss-winder exec tsc --noEmit`: exit 0。
- `pnpm --dir works/abyss-winder build`: exit 0。雛形の型検査とビルド。
- `pnpm check`: exit 0、`check: pass（5 作品）`。全作品のビルドを含む。Viteの500kB超チャンク警告は既存テンプレート由来で残る。
- `node --experimental-strip-types --test works/shatter-spire/tests/*.test.ts`: 9 pass / 0 fail。
- `node --test scripts/tests/work-json.test.mjs`: **75 pass / 1 fail、exit 1**。841〜847行の既存4作品名の固定期待値に新作がなく、実際の5作品との差で失敗。新作作成前は76 pass。基盤ファイルは本作品PRの変更禁止範囲のため直さず、人間・leadへ判断を引き継ぐ。ハーネス起動失敗ではない。
- rootの `pnpm run lint` / `test` / `typecheck`、作品の `pnpm --dir works/abyss-winder run lint` / `test`: いずれも `ERR_PNPM_NO_SCRIPT`、未定義。成功扱いにしない。

## Phase 1: 実装（未着手）

円周操作・海底窓の描画は実装1、音響契約の拡張・拍同期・閉鎖音・本番サムネイルは実装2に引き継ぐ。担当ファイルと受入項目は `architecture.md`。デザイン担当の2サイズ構図を実装前に反映する。

## Phase 2: 完成作品の検証（未着手）

`pnpm verify abyss-winder`、専用の連続円周・キャンセル・多pointer・時刻同期テスト、実画面の見た目判定は後続。雛形のビルド成功は作品体験の完成を意味しない。root/作品にlint/test/typecheck scriptは未定義で、直接tscを実行する。

## Phase 3: 公開（未着手）

構想の成果をmain baseのdraft PRへ載せるまでが本段階。独立検証・レビューと統合判断の後、mergeは人間に委ねる。本番deployは実行しない。
