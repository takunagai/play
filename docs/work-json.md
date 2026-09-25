# work.json の契約

作品 1 本 = `works/<slug>/` の 1 フォルダ。その直下に `work.json` を置く。VPS の kickoff（hermes-agent 側）と共有する契約で、一覧ページ・`pnpm build`・`pnpm check` はこのファイルだけを読む。

**変更は人間の PR で行う**。キーや語彙を変えるときは、このファイル・`scripts/lib/work-json.mjs`・VPS 側の kickoff を同時に直す。

## 例

```json
{
  "slug": "prism-pop",
  "title": "Prism Pop",
  "date": "2026-09-24",
  "origin": "dialogue",
  "summary": "漂う泡をタップで割ると、ベルが鳴り和音が積み上がる",
  "emotion": "快感・連打",
  "verb": "弾く・割る",
  "tone": "有機的グラデーション",
  "sound": "アコースティック風",
  "scale": "リディアン",
  "thumbnail": "thumbnail.webp",
  "license": "MIT",
  "generatedImages": []
}
```

## キー（すべて必須。表にないキーは置かない）

| キー | 型 | 規則 |
|---|---|---|
| `slug` | string | 英小文字・数字・ハイフン（`^[a-z0-9]+(-[a-z0-9]+)*$`）。フォルダ名と一致。URL は `/works/<slug>/` |
| `title` | string | 作品名。空にしない |
| `date` | string | 公開日 `YYYY-MM-DD`（Asia/Tokyo）。一覧の並び順（新しい順）に使う |
| `origin` | string | `dialogue`（人との対話で制作）/ `autopilot`（VPS の自律制作） |
| `summary` | string | 1 行説明。80 文字以内。一覧のカードに出る |
| `emotion` | string | 感情ゴール。下の語彙表から 1 つ。一覧のタグに出る |
| `verb` | string | コア操作。下の語彙表から 1 つ。一覧のタグに出る |
| `tone` | string | ビジュアルトーン。語彙表から 1 つ |
| `sound` | string | 音の性格。語彙表から 1 つ |
| `scale` | string | 音律・スケール。語彙表から 1 つ |
| `thumbnail` | string | 作品のビルド出力（`dist/`）内の相対パス。`.webp`・1200×630 前後（幅 1000〜1600・縦横比 1.8〜2.0）。通常は `public/thumbnail.webp` に置いて `"thumbnail.webp"` と書く |
| `license` | string | `autopilot` は `MIT` のみ。`dialogue` は `MIT` / `AGPL-3.0` |
| `generatedImages` | array | 画像生成で作った画像の記録。下記 |

### generatedImages

`{ "file", "prompt", "model" }` の配列、**10 件以下**。

- `file`: 作品フォルダ（`works/<slug>/`）からの相対パス。実在すること（例: `public/images/moon.webp`）
- `prompt`: 生成に使ったプロンプト全文
- `model`: 生成モデル名（例: `gpt-image-2`）

`autopilot` の作品は、作品に使った生成画像を必ずすべて記録する（不採用の試作は数えない）。`dialogue` の移植 2 作品は制作時のプロンプトを残していないため `[]` のまま（prism-pop の浮遊生物 6 枚・heartburst のロゴ 1 枚は生成画像。経緯は各作品の `docs/`）。

## 語彙表

スキル `interactive-art-builder` の `references/wizard.md` の選択肢ラベルと完全一致させる（括弧の説明書きは含めない。`＋` は全角）。VPS の kickoff は `emotion` × `verb` の 2 軸で直近の作品との重複を避ける。

| キー | 語彙 |
|---|---|
| `emotion` | カタルシス解放 / 癒し・瞑想 / 快感・連打 / 緊張と畏怖 / 驚き・発見 |
| `verb` | 溜めて解放 / 撫でる・かき混ぜる / 弾く・割る / 育てる・枯らす / 引き寄せと反発 / 沈黙を破る |
| `tone` | ダーク＋ネオン / 白＋淡色ミニマル / 有機的グラデーション / レトロ CRT・グリッチ / モノクロ＋単色差し |
| `sound` | 電子シンセ / アンビエント・ドローン / ノイズ・インダストリアル / アコースティック風 / チップチューン |
| `scale` | マイナーペンタトニック / メジャーペンタ / ドリアン / リディアン / 無調・ノイズ主体 |

## ディレクトリ規約

```
works/<slug>/
  work.json            この契約
  package.json         name は slug。scripts.build が dist/ に index.html を出す（Vite の base は './'）
  pnpm-lock.yaml       作品ごとの lockfile（sharedWorkspaceLockfile: false）
  index.html / src/ / public/
  public/thumbnail.webp
  docs/concept.md / architecture.md / process-log.md
```

- 配信 URL は `https://play.nagai-shouten.com/works/<slug>/`。アセットは相対パスで参照する（先頭 `/` の絶対パスは使わない）
- `pnpm build` は `works/<slug>/dist/` を `dist/works/<slug>/` にそのままコピーする

## テスト用フック（全作品の契約）

ページは常に（`?debug` なしでも）次を公開する。`pnpm verify` はこれだけを見る。

```ts
window.__art = {
  getAmp(): number,        // 直近の出力振幅。無音なら 0
  getState(): string,      // 状態機械の現在の状態。導入画面は "intro"
  getFrameStats(): { frames: number, meanDrawMs: number },
};
```

雛形の `src/art-hook.ts` の `installArtHook()` と `createFrameCounter()` を使う。

`pnpm verify` が行う操作（作品はこれで音が出るように作る）:

- 導入画面: 画面中央を 1 回タップ（押して離す）すると始まる
- コア操作: 画面上のある点を押す → 押したまま短くなぞる（約 0.3 秒・画面短辺の 18%）→ 離す、を場所を変えて 10 回。マウス相当の合成 PointerEvent と、CDP の本物のタッチの両方
