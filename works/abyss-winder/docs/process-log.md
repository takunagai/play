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

## Phase 1: 実装（円周操作・海底窓の描画 ─ 完了）

- デザイン確定値（375px/1280px の2サイズ案）を `src/tuning.ts` へ転記。窓半径は2比率式（base 0.27 / narrow 0.34・min(w,h)<480 / cap 200）、索の巻き位置は半径 R−2（索と金属の輝度差 1.02:1 のためリム上に置かない）、誘導オフセット max(40, 0.25R)。
- 円周判定は p5・DOM に依存しない純粋状態機械 `src/winding.ts` に分離。符号付き正味角の連続追跡（前後差を -π..π に正規化し abs(delta) を足さない）、帯域外・逆走（highWater から 0.08rad 超）・跳躍（π/8 超）・250ms 欠落+0.08rad 超の拒否、中心を横切る近道の拒否（線分と中心の最短距離）、別 pointer の拒否、pointercancel/lostcapture/blur/hidden/resize での未完破棄、aligning/hitstop の予定破棄を実装。完遂は「符号付き正味角 ≥ 2π かつ開始点から 28px 以内」のみ（359度では閉じない。EPS 1e-9 は浮動小数点丸めの吸収のみ）。
- 共通時刻契約（architecture §5 の式）を `planClosureTimes` として公開。音響カード（実装2）は同じ式を planClosure で使う想定。hitstop 中は `sceneTimeMs` を増やさず、明けても 140ms ぶんを一括加算しない。
- 描画は `src/renderer.ts`（読み取り専用 snapshot → Canvas 2D）。索は巻き弧（下縁/本体/髪線の3層+撚り目）とベジェの垂れ索で、指への直線吸着は描かない。発光は閉じる輪（輪型ハロー・ピーク alpha 0.20）と最終目盛りのみ。既存輪は直近6本を個別に、超えた分は R−52 から 6px 刻みの等高線へ集約。粒子は窓中心の円形空間・画面外で再流入、巻き取りの遠のきは netAngle から写像（完成角・拍間隔は変えない）。
- 入力配線は `src/main.ts`。`getCoalescedEvents()` を時刻順に処理（ない場合は単一サンプル）。索端掴みで pointer capture を試み（合成イベントでは期待される例外を握りつぶす）、`lostpointercapture` は engine 側の所有権照合で自分で解放した分を無視する。接触音は既存 `note` で局所音のみ（音程は位置で変えない・雛形の横移動音階を持ち込まない）、50ms 以上間引く。
- 回帰テスト `tests/winding.test.ts`（25件・fake時計）を追加: 有効一周で一段だけ、359度で閉じない、±π 境界をまたぐ一周、半周ずつ2回の拒否、往復で進捗増えない、逆走・中心横切・帯域外・跳躍・欠落・別pointer・pointercancel・lostcapture・blur/hidden/resize の破棄、二重 accept/commit の不在、hitstop 中の sceneTimeMs 固定、cancel からの 180ms 復帰、索端 π/6、ゆっくり正確な巻きほど次索が長い。
- TDD の過程で判明した仕様の落とし込み: 判定チェックの順序は「帯域 → 中心横切 → 跳躍 → 欠落」が正（中心横切りの近道は跳躍より先に検出される）。往復の「手ぶれ許容」は逆走許容 0.08rad 以内の行って戻りを意味し、それを超える戻しは逆走として cancel になる。
- 誘導文の配置は `measureText` 実幅と候補評価（既定は時計回りの進む向きの先、窓の縁リム外周+6px との非重なり・垂れ索帯（tip±10px）との距離 8px 以上・画面マージン 14px を満たす側へ反転）。評価矩形は textBaseline top から文字インク分（約6px）下げたインク基準。実描画ピクセル解析（headless Chromium・実行中ページの getImageData）で 375px / 1280px / 768px とも「窓の縁から離れる（最小距離 149.9 / 231.7 / 231.7、要求 143.5 / 217 / 217）・垂れ索と 8px 以上（23 / 8 / 31.8）」を数値確認。375px の実測 bbox x 229〜313 はデザインカンプの実測（x 228〜318）と一致。
- 中央タップの案内文（gate の copy）は雛形既定文言「触れて、はじめる」を暫定使用。デザイン must-fix の「writer 確定」は後続カードへ引き継ぐ。プレースホルダのまま出荷しない方針のため、確定文言が渡されたら `index.html` の1行を差し替えるだけで済む。
- ハーネス実測: `pnpm exec tsc --noEmit`（exit 0）、`node --experimental-strip-types --test tests/winding.test.ts`（25 pass / 0 fail）、`pnpm build`（exit 0）、`pnpm check`（pass 5作品）、`pnpm verify abyss-winder`（pass: console 0 / 404 0、mouse maxAmp 0.0633、touch maxAmp 0.0612、横スクロールなし、meanDrawMs 1280=1.67 / 375=1.19）。`node --test scripts/tests/work-json.test.mjs` は 75 pass / 1 fail（Phase 0 で記録済みの既存固定期待値。範囲外のため触らない）。
- カード制約との衝突を lead へ記録: 本番コードは「最大3コードファイル（main/tuning/renderer）」に対し、テストから参照可能にするため判定を独立ファイル `src/winding.ts` に置いた（4枚目）。architecture §2 が「円周判定の回帰テストは作品内 tests/winding.test.ts を正本に追加」（テストは3枚とは別）と定める一方、`tests/` から `src/main.ts` を import すると p5 が DOM を要求して Node の `--test` が実行不能のため、分離が必須だった。黙って省略せず明記する。

## Phase 2: 完成作品の検証（未着手）

`pnpm verify abyss-winder`、専用の連続円周・キャンセル・多pointer・時刻同期テスト、実画面の見た目判定は後続。雛形のビルド成功は作品体験の完成を意味しない。root/作品にlint/test/typecheck scriptは未定義で、直接tscを実行する。

## Phase 3: 公開（未着手）

構想の成果をmain baseのdraft PRへ載せるまでが本段階。独立検証・レビューと統合判断の後、mergeは人間に委ねる。本番deployは実行しない。
