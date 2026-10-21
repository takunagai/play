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
- 全削除 unstaged（index に残留・実 dir 不在）は index 候補として欠落エラー。全削除 staged（`git rm -r` 済み・削除はまだ commit していない）で実 dir も無い間は、HEAD に証拠が残っていても意図的削除として列挙しない
- 削除を commit した後は index にも HEAD にも証拠が残らないので、その slug は列挙候補から外れる。残った空 dir・生成物 dir は除外できる
- staged 全削除でも実 dir が残っている間は HEAD 証拠で欠落エラー
- 証拠が無い残存 dir は直下だけ見る。空、または通常 dir の `node_modules` / `dist` のみなら生成物として除外する（内部は走査しない。gitignore を根拠にしない）。`src/`・`package.json`・未知・隠しファイルが混ざる、または同名のファイル / symlink がある場合は欠落エラー
- symlink: 列挙候補は実ディレクトリ ∪ index なので、HEAD にだけ証拠が残る slug の作品 dir symlink は候補にならず列挙外のまま。index 候補（index に slug 配下の追跡証拠がある）で実体が symlink のときは黙殺せずエラーにする。`work.json` への symlink は読む。dangling は欠落エラー、読取不能・`work.json` が dir・走査エラーは隠さない

### 非 Git と Git 障害

- ROOT に `.git` が無く親リポジトリに属する（top-level 不一致）場合は非 Git として扱う。ROOT に `.git` marker があるのに git が使えない・top-level 不一致・index / HEAD の読み取り異常（未コミット新規 Git 以外）は失敗させる（追跡なしに潰さず、無条件 fallback しない）
- 制限: 非 Git（git 実行ファイル不在を含む）では保守的に、`work.json` が無い dir を空・生成物のみでも全て欠落エラーにする。manifest があるものは通常検証

## 人間が作品制作を安全に再開する手順

作業途中で止めた作品と基盤スクリプトの修正を、人間だけが再開するための手順。以下の現状は 2026-10-22 00:33 JST の実測なので、使う前に読み直す。

- 基盤修正: branch `fix/work-discovery-residue`（base `9bc0540` から 4 commits、HEAD `3ba5ec0b`: d6d3fa3 残存物除外の実装 / d6909c8 文書 / f3fdd19 受入テスト / 3ba5ec0b 初回レビュー指摘の是正）が repo 外 worktree `/home/hermes/work/play-worktrees/work-discovery-residue` にある。push・PR は未実施
- 主 repo `/home/hermes/work/code/play`（2026-10-22 00:33 JST の read-only 再測定）: branch `feat/work-abyss-winder`、HEAD = base `9bc0540`、status 空、remote に同 branch なし（remote の branch は main・feat/work-cloudbreak・ci/check-workflow のみ）。worktree 登録は主 repo・基盤成果 dir・review dir の 3 件で、`.worktrees/` は空の容器。`works/cloudbreak/` には生成物だけの残存（`dist/` と `node_modules/`、約 142MB。cloudbreak 本体は `feat/work-cloudbreak`、PR #8 は ready だが未 merge）
- 主 repo の観測は時点で区別して記録する: 構想カード t_11da0136 の着手時（2026-10-20）は status が `?? .worktrees/` の dirty、初回レビュー時（2026-10-22 00:05 JST 前後）は status 空・`.worktrees/` は空容器だった。誰がいつ以前のネスト checkout を整理したかは未確認で、当時 dirty だった事実は現在の空 status で消えたわけではない。これ以後の read-only 測定も同じように時点を付ける

### 1. 現状の再確認

並行 worker の停止合意（同期・dev・install・build 等）を人間が取り、元タスクと全後続タスクの status / workspace、branch / HEAD / base / remote を確認してから:

```bash
git -C /home/hermes/work/code/play branch --show-current   # feat/work-abyss-winder
git -C /home/hermes/work/code/play rev-parse HEAD          # 9bc0540 で始まる SHA
git -C /home/hermes/work/code/play status --short          # 空
git -C /home/hermes/work/code/play worktree list
```

実測と違う・未知の変更があったら中止する。

abyss-winder 系カードの全体表（2026-10-22 00:33 JST に kanban から再帰取得。再開前には必ず再取得する。元カードと既存子の本文・状態・workspace はこの文書からも変更しない）:

| カード | 役割 | 担当 | status | workspace | 依存する親 |
|---|---|---|---|---|---|
| t_11da0136 | 構想（元カード） | coder | blocked | dir /home/hermes/work/code/play | t_b5bd5fa7（完了済み） |
| t_e1a3dbb9 | デザイン | web-designer | todo | dir /home/hermes/work/code/play | t_11da0136 |
| t_085031c7 | 素材 | image-designer | todo | dir /home/hermes/work/code/play | t_11da0136 |
| t_8ddf2fec | 実装 1（円周操作・描写） | coder | todo | dir /home/hermes/work/code/play | t_e1a3dbb9・t_085031c7 |
| t_91bc3972 | 実装 2（音響同期・仕上げ） | coder | todo | dir /home/hermes/work/code/play | t_8ddf2fec |
| t_42c428aa | 検証 | tester | todo | worktree /home/hermes/work/code/play | t_91bc3972 |
| t_deaf60e5 | 見た目 | web-designer | todo | worktree /home/hermes/work/code/play | t_42c428aa |
| t_03b1f641 | レビュー | reviewer | todo | worktree /home/hermes/work/code/play | t_11da0136・t_8ddf2fec・t_91bc3972・t_42c428aa |
| t_3ac0dc1b | 統合 | eng-lead | todo | dir /home/hermes/work/code/play | 上記 8 枚すべて |

- 元カード t_11da0136 の再開は人間だけが行う（取得時点では blocked。着手前の pnpm check 失敗で停止しており、モデル指定は gpt-6.1-sol / openai-codex）
- 実行順序は表の親列のとおり（t_e1a3dbb9 と t_085031c7 は並行可）。統合 t_3ac0dc1b は blocked の元カードを含む 8 枚すべての完了が親条件
- unblock / reclaim / 再割当も行わない。全後継は並行 worker の停止合意（同期・dev・install・build 等）が取れるまで動かさない

### 2. 基盤修正を本番に反映する（推奨: 共有 dir 継続案）

- push と新規 PR の承認を人間から取ってから、`fix/work-discovery-residue`（base `9bc0540` から 4 commits、HEAD `3ba5ec0b`）を独立した基盤 PR として出し、人間が merge する。基盤 commit を現作品 PR に混ぜない。承認前は push / 新規 PR をしない
- 共有 dir 継続（推奨）の経路: 独立基盤 PR の push・新規 PR 承認 → 人間 merge → 承認済み base を作品 branch へ反映 → 全後継タスクの共有 dir 固定・HEAD 整合 → 実作業場で品質ゲート → 別途「元タスク再開の承認」を取り、人間だけが再開する
- この経路はこの文書の観測時点（2026-10-22 00:33 JST）では未実行。基盤のローカル成功（テスト・check・build が緑）だけでは、止めたままの元カードが直ったことにならない
- merge 後、承認済み base を作品 branch へ反映し、実際の再開 HEAD に修正が含まれることを `git log` で確認する
- 代替（repo 外作品 worktree 案）: 例として `/home/hermes/work/play-worktrees/abyss-winder` を新しく掘る。この場合は全後継タスクの workspace / SHA / 成果受渡しを人間が先に統合する計画が必要で、元カードだけは変更しない。主 repo は `feat/work-abyss-winder` を checkout 済みなので、同じ branch を同時 checkout する `git checkout --force` は禁止

### 3. cloudbreak 残存の退避（任意。この文書の観測時点では未実行）

必要になったときだけ人間が手で実行する。退避先は repo 外の親 `/home/hermes/work/play-residue-backups` に作り、`mktemp -d` のテンプレートに元タスクの id を入れて一意先（`$DEST`）にする。一意先には台帳 `ledger.txt` を残す（元と先の realpath・型・所有者・記録時点・直下一覧・hash・symlink・各確認結果・保存先）。移動後・復元後の実在確認はコマンドで実測し、台帳の内容と照合してから台帳に結果を追記する。

```bash
set -euo pipefail
SRC=/home/hermes/work/code/play/works/cloudbreak
PARENT=/home/hermes/work/play-residue-backups
mkdir -p "$PARENT"

# 事前確認（1 つでも失敗・不明ならそこで中止。観測時点の残存は dist/ と node_modules/ の約 142MB）
stat -c '%F %U:%G %a %n' "$SRC"   # directory の実在・型・所有者・権限
realpath "$SRC"
du -sh "$SRC"
df -T "$PARENT" /home/hermes/work/code/play/works   # 両辺の FS・空き容量・権限

# 一意退避先と台帳
DEST=$(mktemp -d "$PARENT/t_11da0136-cloudbreak.XXXXXXXX")
LEDGER="$DEST/ledger.txt"
{
  echo "ledger: t_11da0136-cloudbreak"
  echo "記録時点: $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "元: $SRC realpath=$(realpath "$SRC")"
  echo "先: $DEST/cloudbreak"
  echo "元の型・所有者・権限: $(stat -c '%F %U:%G %a' "$SRC")"
  echo "## listing"
} > "$LEDGER"
(cd "$SRC" && find . -mindepth 1 -maxdepth 1 | sort) >> "$LEDGER"
echo "## hashes" >> "$LEDGER"   # hash は生成物（node_modules・dist）を除いた中身に絞る（巨大になるため）
(cd "$SRC" && find . -type f ! -path './node_modules/*' ! -path './dist/*' -exec sha256sum {} + | sort -k 2) >> "$LEDGER"
echo "## symlinks" >> "$LEDGER"
(cd "$SRC" && find . -type l | sort) >> "$LEDGER"

# 移動（-n は既存先を上書きしない。exit code だけでは成功と判定しない）
mv -n "$SRC" "$DEST/cloudbreak"

# 移動後の確認。どれか 1 つでも失敗したらそこで中止する（上書き・一括削除はしない）
test -d "$DEST/cloudbreak" && test "$(stat -c '%F' "$DEST/cloudbreak")" = directory
diff <(cd "$DEST/cloudbreak" && find . -mindepth 1 -maxdepth 1 | sort) \
     <(awk '/^## listing$/{f=1;next} /^## /{f=0} f' "$LEDGER")
diff <(cd "$DEST/cloudbreak" && find . -type f ! -path './node_modules/*' ! -path './dist/*' -exec sha256sum {} + | sort -k 2) \
     <(awk '/^## hashes$/{f=1;next} /^## /{f=0} f' "$LEDGER")
test ! -e "$SRC" && test ! -L "$SRC"
echo "移動後確認 OK: $(date '+%Y-%m-%d %H:%M:%S %Z')" >> "$LEDGER"
```

- 成功の根拠を `mv -n` の exit code だけにしない。宛先の実在・型、台帳の listing と hash の照合、元の不在（`-e` と `-L` の両方。dangling symlink 残留を防ぐ）まで全部確認してから台帳に OK を書く
- `set -euo pipefail` により、確認のどれかが失敗したらその時点で異常終了する。競合・不足・不明は中止で、リトライ判断も含めて人間がする。上書き・一括削除はしない
- `$DEST` は一意先ごとに値が変わる一時変数なので、復元時は退避先一意先の `ledger.txt` の「先:」行を読んで `$DEST` / `$LEDGER` を確定する（保存先の記録は台帳が正本）
- 復元は、元の場所の不在を同じ 2 つの test で確認してから:

```bash
set -euo pipefail
SRC=/home/hermes/work/code/play/works/cloudbreak
LEDGER=/home/hermes/work/play-residue-backups/t_11da0136-cloudbreak.XXXXXXXX/ledger.txt   # 実在の一意先を指定
DEST=$(dirname "$LEDGER")
test ! -e "$SRC" && test ! -L "$SRC"
mv -n "$DEST/cloudbreak" "$SRC"

# 復元後の確認: 元の実在・型・台帳照合と、退避先の不在（-e と -L の双方）
test -d "$SRC" && test "$(stat -c '%F' "$SRC")" = directory
diff <(cd "$SRC" && find . -mindepth 1 -maxdepth 1 | sort) \
     <(awk '/^## listing$/{f=1;next} /^## /{f=0} f' "$LEDGER")
diff <(cd "$SRC" && find . -type f ! -path './node_modules/*' ! -path './dist/*' -exec sha256sum {} + | sort -k 2) \
     <(awk '/^## hashes$/{f=1;next} /^## /{f=0} f' "$LEDGER")
test ! -e "$DEST/cloudbreak" && test ! -L "$DEST/cloudbreak"
echo "復元後確認 OK: $(date '+%Y-%m-%d %H:%M:%S %Z')" >> "$LEDGER"
```

- 復元後も `set -euo pipefail` で、確認のどれかが失敗したらそこで中止する。上書き・一括削除はしない
- 退避先では node_modules の symlink が壊れるため、退避先で install / build 等の実行環境を掘らない

### 4. 再開前の検証ゲート

選んだ作業場で、Node は `.node-version`（26.5.1）、pnpm は `packageManager`（11.21.0）に合わせ、次を全て exit 0 で実測してから人間だけが元タスクを再開する。

```bash
node --version    # v26.5.1
pnpm --version    # 11.21.0
git rev-parse HEAD                  # 意図した HEAD か（基盤修正を含むか）
git status --short                  # 空
pnpm install --frozen-lockfile
node --test scripts/tests/work-json.test.mjs                                # 列挙回帰（観測時点の HEAD では 55 件。HEAD が進むと件数は増え得るので、fail 0 を確認する）
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
