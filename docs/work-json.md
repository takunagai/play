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

## 作品フォルダの列挙と残存物（loadWorks）

一覧ページ・`pnpm build`・`pnpm check`・VPS の kickoff は `scripts/lib/work-json.mjs` の `loadWorks()` で `works/` を列挙する。実在する `work.json` は tracked / untracked を問わず通常どおり読んで検証する。判定が分かれるのは `work.json` が無いフォルダで、Git 作業場では index と HEAD を証拠に決める。

### Git 作業場での判定

- 対象は `git rev-parse --show-toplevel` の実パス（realpath）が ROOT と一致する作業場。index と HEAD の `works/` 配下を 1 回ずつ一括取得し、列挙候補 = 実ディレクトリ ∪ index 上の slug
- `work.json` が無くて index / HEAD に追跡証拠があれば欠落エラー。staged / unstaged の削除のどちらも、生成物だけ残っていてもエラー
- 全削除 unstaged（index に残留・実 dir 不在）は index 候補として欠落エラー。全削除 staged（`git rm -r` 済み）で実 dir も無い場合は意図的削除として列挙しない。削除を commit した後の不在（HEAD にしか証拠が無い slug）も列挙しない
- staged 全削除でも実 dir が残っている間は HEAD 証拠で欠落エラー。削除 commit 後は証拠が消えるので、残った空 dir・生成物 dir は除外できる
- 証拠が無い残存 dir は直下だけ見る。空、または通常 dir の `node_modules` / `dist` のみなら生成物として除外する（内部は走査しない。gitignore を根拠にしない）。`src/`・`package.json`・未知・隠しファイルが混ざる、または同名のファイル / symlink がある場合は欠落エラー
- symlink: 作品 dir の symlink は列挙外（index / HEAD に追跡証拠があるなら黙殺せずエラー）。`work.json` への symlink は読む。dangling は欠落エラー、読取不能・`work.json` が dir・走査エラーは隠さない

### 非 Git と Git 障害

- ROOT に `.git` が無く親リポジトリに属する（top-level 不一致）場合は非 Git として扱う。ROOT に `.git` marker があるのに git が使えない・top-level 不一致・index / HEAD の読み取り異常（未コミット新規 Git 以外）は失敗させる（追跡なしに潰さず、無条件 fallback しない）
- 制限: 非 Git（git 実行ファイル不在を含む）では保守的に、`work.json` が無い dir を空・生成物のみでも全て欠落エラーにする。manifest があるものは通常検証

## 人間が作品制作を安全に再開する手順

作業途中で止めた作品と基盤スクリプトの修正を、人間だけが再開するための手順。以下の現状は 2026-10-21 時点の実測なので、使う前に読み直す。

- 基盤修正: commit `d6d3fa3`（branch `fix/work-discovery-residue`、base `9bc0540` から 1 commit）が repo 外 worktree `/home/hermes/work/play-worktrees/work-discovery-residue` にある。push・PR は未実施
- 主 repo `/home/hermes/work/code/play`: branch `feat/work-abyss-winder`、HEAD = base `9bc0540`、remote に同 branch なし。`works/cloudbreak/` に untracked の生成物残存（`dist/` と `node_modules/` のみ。cloudbreak 本体は `feat/work-cloudbreak`、PR #8 は ready だが未 merge）

### 1. 現状の再確認

並行 worker の停止合意（同期・dev・install・build 等）を人間が取り、元タスクと全後続タスクの status / workspace、branch / HEAD / base / remote を確認してから:

```bash
git -C /home/hermes/work/code/play branch --show-current   # feat/work-abyss-winder
git -C /home/hermes/work/code/play rev-parse HEAD          # 9bc0540 で始まる SHA
git -C /home/hermes/work/code/play status --short          # 空
git -C /home/hermes/work/code/play worktree list
```

実測と違う・未知の変更があったら中止する。

### 2. 基盤修正を本番に反映する（推奨: repo 外 worktree 継続案）

- 基盤 commit（`d6d3fa3`）を現作品 PR に混ぜない。push と新規 PR の承認を取ってから `fix/work-discovery-residue` を独立した基盤 PR として出し、人間が merge する
- merge 後、承認済み base を作品 branch へ反映し、実際の再開 HEAD に修正が含まれることを `git log` で確認する。ローカルで通っただけでは止めたままのタスクは直らない
- 承認前は push / 新規 PR をしない
- 再開作業場は repo 外 worktree（例: `/home/hermes/work/play-worktrees/abyss-winder`）を推奨する。後続タスクの workspace / SHA / 成果受渡しを人間が統合する計画を先に作る
- 主 repo は `feat/work-abyss-winder` を checkout 済みなので、`git checkout --force` で同じ branch を同時 checkout しない

### 3. cloudbreak 残存の退避（任意。未実行の手順）

必要になったときだけ人間が手で実行する。退避先は repo 外（`/home/hermes/work/play-residue-backups`）に作り、`mktemp -d` のテンプレートに元タスクの id を入れて一意先にする。

```bash
set -euo pipefail
mkdir -p /home/hermes/work/play-residue-backups
DEST=$(mktemp -d /home/hermes/work/play-residue-backups/t_11da0136-cloudbreak.XXXXXXXX)
# 事前台帳: realpath・型・所有者・空き容量・FS・権限・ファイル一覧・hash・symlink。
# hash は生成物（node_modules・dist）を除いた中身に絞る（巨大になるため）
realpath /home/hermes/work/code/play/works/cloudbreak
ls -la /home/hermes/work/code/play/works/cloudbreak
du -sh /home/hermes/work/code/play/works/cloudbreak
df -T /home/hermes/work/code/play/works /home/hermes/work/play-residue-backups
find /home/hermes/work/code/play/works/cloudbreak ! -path '*/node_modules/*' ! -path '*/dist/*' -type f -exec sha256sum {} +
mv -n /home/hermes/work/code/play/works/cloudbreak "$DEST/cloudbreak"
# 事後照合: 元の不在は -e と -L の両方で確認（dangling symlink 残留を防ぐ）
test ! -e /home/hermes/work/code/play/works/cloudbreak && test ! -L /home/hermes/work/code/play/works/cloudbreak
```

- 成功の根拠を `mv -n` の exit code だけにしない。台帳の事前事後照合と元の不在確認まで含める
- 失敗・競合が起きたらそこで中止する。上書き・一括削除はしない
- 復元は、元の場所の不在を同じ 2 つの test で確認してから:

```bash
test ! -e /home/hermes/work/code/play/works/cloudbreak && test ! -L /home/hermes/work/code/play/works/cloudbreak
mv -n "$DEST/cloudbreak" /home/hermes/work/code/play/works/cloudbreak
```

- 退避先では node_modules の symlink が壊れるため、退避先で install / build 等の実行環境を掘らない

### 4. 再開前の検証ゲート

選んだ作業場で、Node は `.node-version`（26.5.1）、pnpm は `packageManager`（11.21.0）に合わせ、次を全て exit 0 で実測してから人間だけが元タスクを再開する。

```bash
node --version    # v26.5.1
pnpm --version    # 11.21.0
git rev-parse HEAD                  # 意図した HEAD か（基盤修正を含むか）
git status --short                  # 空
pnpm install --frozen-lockfile
node --test scripts/tests/work-json.test.mjs                                # 列挙回帰 29 件
node --experimental-strip-types --test works/shatter-spire/tests/*.test.ts  # 既存 9 件
pnpm check
pnpm -r --filter './works/*' exec tsc --noEmit
pnpm build
```

- 新規 PR 作成の許可と元タスク再開の許可は別々に取る
- 他の後続タスクが固定している共有 dir / worktree を隠さず、統合計画に沿って作業場を割り当てる

### 5. 個別の処置メモ

- `node scripts/new-work.mjs` の同 slug 拒否は安全機能として維持する。slug を変えたい場合は別途人間が確認する
- 既存のネスト worktree は他者所有なので移動・削除せず、ライフサイクルは人間が確認する。新しい作業場は repo 外に作る
