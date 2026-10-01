# Shatter Spire ─ 画像発注書

## 発注枚数

生成画像なし（0 枚）。

## 判断理由

主役は、スワイプ角度に応じてその場で分割される結晶塔、切断面に沿う滑落、上段から順に砕ける欠片、入力結果として底へ積もる光の砂である。固定画像では任意角度の切断と連続した崩壊・沈積・再生を表せず、操作との一致を弱める。結晶の凸多角形、面の反射、切断線、欠片、砂、glow はすべて 2D canvas で解像度非依存に描けるため、Tier 1 は手続き描画だけで成立させる。

`work.json` の `generatedImages` は `[]` のままとする。`public/thumbnail.webp` はチェック契約を満たすため、本発注とは別に本書のパレットと構図を用いた手書き SVG からリポジトリの `prepare-image.mjs` で書き出したもので、生成モデル由来ではない。したがって `/home/hermes/work/code/play-assets/shatter-spire/` への納品と `node scripts/prepare-image.mjs --black-to-alpha` の対象はない。将来、発光素材を追加する仕様変更が入った場合は、透過を生成モデルへ依頼せず黒背景で生成し、`--black-to-alpha` で透過化するが、本企画には含めない。
