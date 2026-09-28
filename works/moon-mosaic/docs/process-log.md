# Moon Mosaic ─ 制作記録

<!-- フェーズごとに、判断とつまずき（症状・原因・対処）を書く -->

## Phase 0: アイデア具体化

構想カード（t_ff069da7）で確定済み。slug `moon-mosaic`、3 色パレット（墨青 #08111F / 青灰 #1D3A52 / 銀白 #EAF6FF）、D ドリアン、発注画像 0 枚（image-order.md 参照）。

## Phase 1: 実装

- 雛形からの全面置換で実装した。状態機械は `intro → gathering → hush(150ms) → reveal(900ms) → sway(2400ms) → spawning(600ms) → gathering`。`complete()` が返す `CompletionSchedule` の時刻で視覚と音を切替え、`?mute` でも Noop が同じ間を返すため視覚の間が変わらない
- 欠片の物理は docs/architecture.md §4 のとおり: 指速度の EMA（80ms 窓）、影響半径 64→132px の逃避、180ms 遅れの航跡 + chirality 固定の弧オフセット（420ms で減衰）、spring 追従（stiffness 7.5 / damping 4.8、最高 260px/s）、捕捉域は月半径 × 1.18 と指 × 1.55
- 描画は 2D context 直（`Path2D` 相当の path 操作 + `save/restore`）。色は `hexAlpha()` の rgba 文字列キャッシュで表引き。`getAmp()` は 1 フレーム 1 回の巻き上げ
- 画面端の扱い: 逃避方向を内側へ投影して折り返す（正本 §4.2）。画面外へ出た欠片は RETURN_MARGIN_PX からの復帰力で戻す

### つまずき: draw の途中で生まれた波紋が負の半径で arc 例外 → 描画ループ全死

- **症状**: 初回 `pnpm verify` で `pageerror: The radius provided (-0.50) is negative` が 2 画面分。タッチ側は以後無音（draw が死んだため amp が 0 のまま）、マウス側は偶然死ぬ前に amp を記録して pass していた
- **原因**: `addRipple()` は draw ループの途中（欠片更新後）に `performance.now()` で bornMs を刻む。同じフレームの後段の波紋描画では `nowMs - bornMs` が負になり、`progress < 0` → `eased < 0` → 半径負の `arc()` が例外を投げ、p5 の draw が止まった
- **対処**: 波紋の progress を 0..1 に clamp。draw 内で「未来の時刻」を参照する全ての進行値は clamp する方針に統一した

### つまずき: verify の合成 PointerEvent で音が出たが画面が暗いままに見えた

- **症状**: after スクショの明度統計が mean≈27 と、雛形の夜空比で極端に暗い。水面の放射（alpha 0.20）がほぼ見えない
- **原因**: 毎フレーム不透明の墨青で塗り潰した後に alpha 0.04〜0.20 の青灰を 1 回重ねる構成では、合成後の持ち上がりが 1 フレーム分しかない（残像方式の作品と異なり蓄積しない）。設計の alpha 値は「積算後」の印象で書かれており、1 回描きの実効値になっていなかった
- **対処**: 放射中心を 0.30、横濃淡の峰值を 0.16 へ実測で上げ、375px の暗部でも水面の屈折が読めるようにした。3 色の枠組みは変えていない

### 判断: verify の 10 回の操作で完成（reveal）まで到達しない前提の実装

`pnpm verify` のコア操作は欠片を捕まえる確率が低く、result.json の states は `gathering` 止まりになる。契約（押す→なぞる→離すで音が出る、`__art` 公開、横スクロール無し）はこの範囲で検証される。完成タイムライン（hush→reveal→sway→spawning）は schedule 時刻で機械的に進むため、到達自体はコードの時間経過でしか確認できない。ローカルで状態遷移の単体確認（debug オーバーレイの state 表示）を行い、収録はスクショで補った

## Phase 2: 検証（pnpm verify）

- `pnpm check` exit 0 / `pnpm verify moon-mosaic` exit 0（全 5 項目 pass）
- 数値: mouse-sound maxAmp 0.291 / touch-sound maxAmp 0.324 / meanDrawMs 1280=0.54ms・375=0.86ms（60fps に十分）
- taste-guide の合否チェックリストで自己点検: 泥色なし／導入と操作後で材質同一／直線切断なし／375px の存在感（MOBILE_SIZE_SCALE 1.15）／操作の痕跡が波紋・航跡で残る／白飛びなし／タイトル判読／重なりなし／安っぽい輪なし／3 色の統一感

## Phase 3: 公開

- サムネイル: `pnpm verify` の after-1280.png から `prepare-image.mjs --cover 1200x630` で生成
- merge は人間が行う（Workers Builds が自動デプロイ）
