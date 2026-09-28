# Moon Mosaic ─ 設計の正本

**このファイルが仕様の正本。実装はすべて本書に従い、仕様変更は必ず本書を先に更新する。**

## 1. 体験の核

- 感情ゴール: 驚き・発見。指で追うと逃げる欠片が、ゆっくり導くと弧を描いて従う法則を発見する
- コア操作: 引き寄せと反発。欠片へ近づき、速度を落として中央へ先導する
- トーン: モノクロ＋単色差し。墨青 `#08111F`、青灰 `#1D3A52`、銀白 `#EAF6FF` の 3 色だけを alpha 差で使う
- 音: 水滴、短いグラスハープ、低い胴鳴り。D ドリアンを 8 分拍で上り、完成音だけ長く残す

迷ったときは、機能追加より「近づくと逃げ、待つと弧でついてくる手触り」と「150ms の無音から月の輪が開く同期」を優先する。欠片を即座に吸着させない。完成前に未回収の欠片や水面を消さない。完成演出でも水面の青を白で覆わない。

## 2. モジュール構成

```text
works/moon-mosaic/
  index.html / src/style.css       canvas、導入オーバーレイ、診断表示
  src/
    main.ts                        状態機械、Pointer Events、描画ループ、完成タイムライン
    fragment.ts                    欠片の状態、速度場、追従弧、月スロットへの収束
    trail.ts                       ポインタ履歴と星図の弧長再サンプリング
    music.ts                       D ドリアン、回収数から音階度を決める純粋関数
    tuning.ts                      視覚・入力・時間・品質の定数を一元管理
    quality.ts                     雛形の自動画質判定。低下方向にだけ切り替える
    art-hook.ts                    window.__art 契約。雛形を維持
    audio/
      engine.ts                    AudioEngine 契約、Noop、ファクトリ
      synth-engine.ts              Web Audio による水滴、グラス音、ドローン、完成音
      audio-tuning.ts              音量、音色、8 分拍、残響、同時発音数
```

呼び出し関係:

```text
Pointer Events ──→ main.ts ──→ pointer history ──→ fragment.ts
                        │                              │
                        │                              ├─ Fragment[] / Ripple[]
                        │                              └─ trail.ts ─→ StarPath[]
                        ├─→ music.ts ─→ AudioEngine
                        ├─→ AudioEngine.complete() ─→ CompletionSchedule
                        │                           └─ revealAtMs（音が着弾時刻を決定）
                        └─→ canvas 描画 ←─ getAmp()（音→視覚の唯一の逆流線）
```

`main.ts` は `AudioEngine` 契約越しにだけ音へ触れ、Web Audio API を直接使わない。状態機械と契約の正本は本書。実装側には「正本は docs/architecture.md」とコメントを置く。

## 3. 状態機械

`main.ts` が状態の唯一の正本である。`window.__art.getState()` は下記の英字値を返す。

```text
intro（導入）
  └ 画面中央の pointerdown → audio.start()（resume の解決を待たない）→ gathering

gathering（集め中）
  ├ pointermove → 欠片の逃避／弧追従を更新
  ├ 欠片が月スロットへ入る → placed、波紋と短音、次の欠片を探す
  └ 最後の欠片がスロットへ入る → audio.complete() → hush

hush（閉じる直前 0.15 秒）
  └ revealAtMs まで 150ms: 波紋、漂い、追従、音、amp 反応を停止 → reveal

reveal（月出現）
  ├ 0ms: 月面を閉じる、高いガラス音 + 輪郭クリック + 低い胴鳴り
  ├ 0..900ms: 輪が輪郭を一周、航跡を星図として確定
  └ 900ms → sway

sway（揺れ）
  ├ 月と星図が水面の低周波で静かに揺れる
  └ 2400ms → spawning

spawning（次の欠片）
  ├ 600ms かけて別の外周領域へ次の欠片群を出す
  └ 月と既存星図を残して gathering
```

### 3.1 intro

- 最初から 12 個の銀片を表示する。欠片数は画面サイズで変えず、モバイルだけ各片を 1.15 倍にして存在感を保つ
- 中央には完成月の輪郭を線で描かず、水面の青灰をわずかに暗くした直径 `min(w,h) × 0.28` の空の円を置く
- タイトル「Moon Mosaic」と案内「ゆっくり、月へ」を下部へ小さく置く。中央タップで 300ms かけて退場する
- 最初のタップは回収操作に使わない。`audio.start()` は配線を済ませ、`pointerup` / `touchend` / `click` / `keydown` の常駐リスナーでも `AudioContext.resume()` を試す

### 3.2 欠片ごとの状態

```text
drifting ──指が影響半径へ入る──→ fleeing
fleeing  ──低速が 120ms 継続────→ following
following ├─高速化または離脱────→ fleeing / drifting
          └─指と欠片が中央捕捉域へ→ settling → placed
placed    └─月のスロットで固定。消さない
```

欠片は 12 個。各欠片へ月内の扇形スロットを seeded shuffle で割り当て、完成時に隙間の少ない 1 枚の円へ見えるようにする。形は 5〜8 頂点の凸多角形で、同じ seed から再現する。生成画像は使わない。

## 4. 欠片の物理

座標と速度は CSS px、時刻は秒で計算し、`dt` は 1/120〜1/30 秒へ clamp する。フレーム落ちで欠片が飛び越えないよう、力を積分してから最高速度を制限する。

### 4.1 指速度

直近 80ms のポインタ履歴から速度ベクトル `vp` を求め、EMA（`alpha = 0.24`）で平滑化する。

- 低速域: `|vp| <= 180 px/s`
- 遷移域: `180 < |vp| < 650 px/s`
- 高速域: `|vp| >= 650 px/s`
- 速度係数: `speedT = smoothstep(180, 650, |vp|)`

入力点が 120ms 以上来ない場合は `|vp| = 0` へ減衰させる。タッチとマウスで閾値を分けない。

### 4.2 逃避

ポインタから欠片への単位ベクトルを `away`、距離を `d` とする。影響半径は速度により `64px → 132px`、逃避の目標距離は `24px → 88px` へ増える。

```text
influenceRadius = lerp(64, 132, speedT)
repelDistance   = lerp(24, 88, speedT)
repelStrength   = (1 - clamp(d / influenceRadius, 0, 1))²
forceRepel      = away × repelStrength × lerp(380, 980, speedT)
```

初接近では速度が遅くても最低 120ms は `fleeing` に置き、「いったん小さく逃げる」を必ず見せる。画面端 28px 以内では逃避方向を接線方向へ投影し、外へ押し出さない。中心の月を横切る逃避には弱い周方向バイアスを足し、欠片が月面を突き抜ける直線に見えないようにする。

### 4.3 弧の追従

`fleeing` 中に低速が 120ms 続き、欠片が影響半径の 1.25 倍以内なら `following` へ入る。追従先は現在の指ではなく、ポインタ履歴の 180ms 前の点 `trailTarget`。欠片ごとに固定した向き `chirality ∈ {-1, 1}` を持ち、ポインタ進行方向の法線へ弧オフセットを加える。

```text
arcOffset = normal(vp) × chirality × lerp(34, 12, distanceToPointer / 180)
target    = trailTarget + arcOffset
forceSeek = spring(target - position, stiffness=7.5, damping=4.8)
```

最高速度は 260px/s。追従中の arcOffset は 420ms で 0 へ減衰するので、最初は大きな弧を描き、遅れて指の航跡へ合流する。指速度が 650px/s を超える、指から 190px 以上離れる、または `pointercancel` が起きると追従を外し、短い逃避の後に漂いへ戻す。欠片をカーソル座標へ直接代入しない。

### 4.4 月への収束

月中心から `moonRadius × 1.18` を捕捉域とする。`following` の欠片が捕捉域へ入り、指も `moonRadius × 1.55` 以内にあると `settling` へ移る。350ms の `easeOutCubic` で割当スロットへ収束し、回転をスロット角へそろえる。判定は見た目より広く、指が中心を正確になぞらなくてもよい。

収束開始時点でその欠片の追従航跡を `StarPath` として固定し、弧長 12px ごとに再サンプリングする。`placed` 後も欠片は月面に残り、未回収の欠片は外周で漂い続ける。

### 4.5 水面と波紋

- 漂いは欠片ごとの位相を持つ 7〜13 秒周期の低周波 2 本で作る。ランダムウォークは使わず再現可能にする
- 逃避開始時に小さな青灰の波紋 1 本、配置時に 2 本を作る。最大半径は短辺比 0.18、寿命 1.2 秒
- 配置数が増えるほど、中央近くの波紋の alpha を `0.08 → 0.16` へ上げるが、銀白にはしない
- `hush` へ入ったフレームで波紋の半径進行と漂いの位相を凍結する。150ms の間に消すのではなく、止まった水面を見せる

## 5. 音視覚マッピング

| イベント | 引数 | 視覚反応 | 音響反応 |
|---|---|---|---|
| intro/start | なし | オーバーレイが 300ms で消え、欠片の漂いが続く | AudioContext を配線・解錠。発音しない |
| fragment/flee | x,y,speedT | 欠片が 24〜88px 逃げ、青灰の小波紋を 1 本出す | 35ms の短い水滴。速度でノイズ量を少し増やし、x で pan |
| fragment/follow | x,y,arc | 指の 180ms 後ろを 34→12px の弧で追い、細い航跡を残す | ドローンのフィルタをわずかに開く。個別音は鳴らさない |
| fragment/place | index,count | スロットへ 350ms で収束、青灰の波紋 2 本、航跡を固定 | 水滴 + 短いグラス音。回収数に対応する D ドリアン音。短く減衰 |
| eighth/pulse | count,beat | 配置済み欠片の継ぎ目を 1 拍だけ薄く明るくする | 8 分拍ごとに現在の回収数まで上がった音階度を短く鳴らす |
| completion/hush | 150ms | 波紋、漂い、航跡の進行、amp 反応を全停止 | transient bus と drone を 25ms で絞り、残響も completion bus 直前で止める |
| completion/reveal | x,y | 月面が閉じ、細い輪が 900ms で一周、航跡を星図へ確定 | 高いグラス音 + 輪郭クリック列 + 低い胴鳴りを同時開始 |
| 毎フレーム | amp 0..1 | `reveal` と `sway` の月縁だけが ±6% 脈動 | ─（音→視覚の逆流線はこの 1 本のみ） |

## 6. AudioEngine 契約

`src/audio/engine.ts` は次の契約へ置き換える。

```ts
export interface FragmentEvent {
  x: number;          // 0..1
  y: number;          // 0..1
  index: number;      // 0..fragmentCount-1
  collected: number;  // 配置後の回収数
  speed: number;      // 0..1
}

export interface CompletionSchedule {
  revealAtMs: number; // performance.now() と同じ時刻系
  ringEndAtMs: number;
  swayAtMs: number;
}

export interface AudioEngine {
  start(): Promise<void>;
  readonly isReady: boolean;
  flee(event: Pick<FragmentEvent, "x" | "y" | "speed">): void;
  follow(amount: number): void;
  place(event: FragmentEvent): void;
  complete(): CompletionSchedule;
  resetCycle(): void;
  getAmp(): number;
  getDiagnostics(): Record<string, string | number | boolean>;
}
```

- `complete()` が 150ms 後の `revealAtMs` を決めて返す。`main.ts` はこの時刻で `hush → reveal` を切り替え、音と視覚を同期する
- NoopAudioEngine も `performance.now() + 150` を基準に同じ `CompletionSchedule` を返し、`?mute` でも視覚の間を変えない
- 音声が未解錠でも状態機械を止めない。途中で解錠されても進行済みの音をまとめて鳴らさない
- `getAmp()` は 1 フレームにつき 1 回だけ呼ぶ

## 7. 音響設計

基準テンポは 72 BPM。8 分音符は約 416.7ms。音階は D ドリアン `D E F G A B C`、基音 MIDI 62。配置数 `collected` を `[0,2,3,5,7,9,10]` へ写し、完成へ向かって 2 オクターブ以内で単調に上げる。個別の配置音は即時に鳴らし、常駐する 8 分拍の pulse が現在の進行度を反復する。反応性を拍待ちで損なわない。

| 名前 | 合成方式 | パラメータ写像 |
|---|---|---|
| waterDrop | サイン 1.8kHz→900Hz の 35ms pitch envelope + filtered noise 18ms | x→pan、speed→noise gain。逃避音は小さく、配置時は少し明瞭 |
| glassTick | サイン部分音比 `1 / 2.76 / 5.4`、減衰 `0.32 / 0.18 / 0.08s` | collected→D ドリアン音程、x→pan。各欠片は短く鳴らす |
| gatherDrone | D2/A2 のサイン + triangle、ごく低い gain | collected→LPF 220→900Hz。8 分拍の pulse で 3% だけ呼吸 |
| revealGlass | D6/A6 と非整数倍音のグラスハープ | 18ms attack、4.8s decay。完成音だけ長く伸ばす |
| rimClicks | band-pass noise の 12 個の短いクリック | 900ms で月の輪郭を一周。pan は円周 x 座標へ従う |
| bodyResonance | D2 73.4Hz + D3 146.8Hz のサイン／三角 | 25ms attack、3.6s decay。小型スピーカー用に D3 を薄く重ねる |

配線:

```text
waterDrop / glassTick / pulse ─→ transientBus ─┐
gatherDrone ───────────────────→ droneBus ──────┼→ fxIn → dry / generated Convolver
revealGlass / rimClicks / body ─→ completionBus ┘       → DynamicsCompressor → master → Analyser → destination
```

`hush` では transientBus と droneBus を 25ms で -60dB へ落とし、Convolver の戻りも 60ms で絞る。completionBus は閉じたまま待ち、`revealAtMs` に 3 音を同時に開く。最大同時発音数は 24。通常音が上限を超えたら最古の glassTick を 20ms で奪い、完成音は奪わない。外部音源と外部通信は使わず、残響 IR は起動時に生成する。

## 8. ビジュアル設計

### 8.1 描画レイヤー

下から順に描く。

1. 墨青 `#08111F` の不透明な最背面
2. 青灰 `#1D3A52` の水面。中心 alpha 0.20 の緩い放射と、12秒周期の横方向の濃淡 1 層
3. 低 alpha の青灰波紋。線幅 1px、太いリングを作らない
4. 確定した `StarPath` の芯。銀白 alpha 0.22・線幅 0.75px、節点は半径 1.5px
5. 未回収の銀片と配置済みの月片。影 → 面 → 片側の縁の順で描き、全状態で同じ材質を保つ
6. 現在追従中の航跡。銀白 alpha 0.14、最後の 120px だけ表示
7. 完成時の月輪。銀白 alpha 0.85・線幅 1.25px、外側グローは alpha 0.08 の 1 層のみ
8. 導入 UI / `?debug` 診断

月直径は `clamp(min(w,h) × 0.28, 112px, 280px)`。完成中も銀白の面積は月内に限定し、画面面積の 75% 以上を墨青／青灰の水面として残す。航跡や波紋を画面四辺に沿う直線で切らず、端へ近づくほど alpha を下げる。

### 8.2 欠片と月

- 12 個の欠片は銀白 alpha 0.72〜0.94。面積は月面積の約 1/12、5〜8 頂点の凸多角形
- 各片の縁は銀白 alpha 0.35・1px、影は墨青 alpha 0.45・offset (2,3)px。グローを常時付けない
- `fleeing` は進行方向へ最大 1.06 倍に伸びるが、形状自体を別素材に切り替えない
- `following` は速度方向へ ±8度だけ傾き、弧が読めるようにする
- `settling` は位置・角度・scale を同時に補間し、吸い込みではなく最後の 25% でゆっくり収まる
- `placed` の継ぎ目は青灰 alpha 0.35 の 0.75px。最後の片が入るまで円の欠けを残す
- `reveal` で継ぎ目を 450ms かけて薄くし、月輪だけを一周させる。全画面フラッシュは使わない

### 8.3 水面の揺れと星図

月と星図の揺れは、描画座標へ `sin(y × 0.022 + time × 0.7) × 1.6px` の水平変位を与える。`reveal` の 900ms 中は揺れを弱め、輪が閉じる形を読みやすくする。`sway` で通常振幅へ戻す。`prefers-reduced-motion` では振幅を 0.4px、漂い速度を 50% にするが、逃避、追従、150ms の間、音視覚同期は維持する。

星図は各 `StarPath` を弧長 12px で再サンプリングし、最大 12 本を保持する。次サイクルでも消さず、古い順に alpha 0.22→0.08 へ落とす。上限超過時は最古の航跡の外側グローだけを消し、芯は夜の地図として残す。

## 9. 画質の自動調整

雛形の `quality.ts` と `QualityController` を維持し、描画ループで `recordFrame(deltaMs)` を 1 フレーム 1 回呼ぶ。画質は高→中→低へ下げるだけで、復帰によるちらつきを作らない。

| 品質段 | 波紋上限 | 航跡サンプル間隔 | 水面濃淡 | 月輪グロー |
|---|---:|---:|---|---|
| high | 36 | 12px | 毎フレーム | 1/4 解像度の別 canvas |
| medium | 24 | 18px | 2 フレームに 1 回 | 1/6 解像度の別 canvas |
| low | 14 | 24px | 静的な 1 層 | 1/8 解像度の別 canvas |

品質段で変えてよいのは、同時波紋数、航跡の再サンプル密度、水面濃淡の更新頻度、グロー用 canvas の解像度だけ。欠片数、物理閾値、状態時間、月サイズ、3 色、航跡の芯、完成音は変えない。どの段でも同じ光学モデルに見えるよう、輪の芯の線幅と alpha は固定する。

静的な水面下地と周辺減光は offscreen canvas へ焼き付け、リサイズ時だけ再生成する。動的な欠片は p5 API を 1 個ずつ重ねず、2D context の `Path2D` または path 操作で描く。`createCanvas` 後に `pixelDensity(1)`、`P5.disableFriendlyErrors = true`、`getAmp()` は 1 フレーム 1 回。60fps を目標とする。

## 10. Tier 設計とフォールバック

- Tier 1 のみ: 2D canvas + Web Audio + Pointer Events。画像、WebGL、外部 API、パターン層は使わない
- AudioContext 非対応、`?mute`、解錠失敗でも NoopAudioEngine の時刻で最後まで進む
- Convolver 生成失敗時は dry 経路だけで鳴らす
- 画質判定に失敗した場合は low 相当で継続し、欠片の物理と完成タイミングは維持する
- Pointer Events 非対応は対象外。`pointercancel` 時は追従中の欠片を漂いへ戻し、配置済みの進行は失わない

## 11. 雛形からの作り替え

| ファイル | 雛形 | Moon Mosaic での置き換え |
|---|---|---|
| `src/main.ts` | `intro / idle / pressing`、位置で音程が決まる波紋 | `intro / gathering / hush / reveal / sway / spawning`、欠片群、月、星図へ全面置換 |
| `src/tuning.ts` | 波紋寿命・半径・個数 | 3 色、指速度、逃避／追従、月捕捉、150ms の間、品質段の定数へ置換 |
| `src/quality.ts` | 3 段の負荷判定 | 判定式を維持し、波紋上限・サンプル密度・更新頻度へ接続 |
| `src/audio/engine.ts` | `note()` と `setEnergy()` | `flee()`、`follow()`、`place()`、`complete()` と CompletionSchedule へ置換 |
| `src/audio/synth-engine.ts` | 汎用ベル | 水滴、グラス音、D ドリアンのドローン、完成時の 3 音へ置換 |
| `src/music.ts` | x 座標でメジャーペンタを選ぶ | 回収数から D ドリアンを単調上昇させる純粋関数へ置換 |
| `src/style.css` / `index.html` | 波紋作品の案内 | 墨青の水面、下部の「ゆっくり、月へ」へ置換 |
| `src/art-hook.ts` | 検証契約 | 構造を維持し、全状態で常時公開 |

## 12. 調整ノブ

視覚・入力・時間の値は `src/tuning.ts`、音響値は `src/audio/audio-tuning.ts` へ集約する。

| 定数 | 初期値 | 効き方 |
|---|---:|---|
| `FRAGMENT_COUNT` | 12 | 1 周期の欠片数。画面サイズで変えない |
| `POINTER_SPEED_SLOW_PX_S` | 180 | これ以下が 120ms 続くと弧追従へ移れる |
| `POINTER_SPEED_FAST_PX_S` | 650 | これ以上で反発最大、追従解除 |
| `FOLLOW_DWELL_MS` | 120 | 初接近の逃避を必ず見せる最短時間 |
| `FOLLOW_TRAIL_DELAY_MS` | 180 | 欠片が追うポインタ履歴の遅れ |
| `FOLLOW_ARC_MAX_PX` / `_MIN_PX` | 34 / 12 | 追従開始から航跡へ合流する弧の大きさ |
| `FOLLOW_MAX_SPEED_PX_S` | 260 | 追従時の欠片最高速度 |
| `FOLLOW_BREAK_DISTANCE_PX` | 190 | 指から離れすぎたとき追従を外す距離 |
| `REPEL_RADIUS_MIN_PX` / `_MAX_PX` | 64 / 132 | 指速度で広がる逃避影響半径 |
| `REPEL_DISTANCE_MIN_PX` / `_MAX_PX` | 24 / 88 | 指速度で伸びる逃避目標距離 |
| `EDGE_INSET_PX` | 28 | 欠片を画面内へ戻す余白 |
| `MOON_DIAMETER_RATIO` | 0.28 | 月直径の短辺比（112〜280pxへ clamp） |
| `MOON_CAPTURE_RATIO` | 1.18 | 欠片の捕捉域 = 月半径 × この値 |
| `POINTER_CAPTURE_RATIO` | 1.55 | 指の許容域 = 月半径 × この値 |
| `SETTLE_MS` | 350 | 月スロットへ収まる時間 |
| `HUSH_MS` | 150 | 波紋も音も停止する最優先の間 |
| `RING_TRAVEL_MS` | 900 | 月輪クリックと視覚輪が一周する時間 |
| `SWAY_HOLD_MS` | 2400 | 月の揺れを見せてから次の欠片へ進む時間 |
| `SPAWN_MS` | 600 | 次の欠片群の出現時間 |
| `EIGHTH_BPM` | 72 | 8 分拍の基準テンポ |
| `RIPPLE_CAP_STEPS` | `[36, 24, 14]` | quality.ts の段ごとの波紋上限 |
| `TRAIL_SAMPLE_STEPS_PX` | `[12, 18, 24]` | quality.ts の段ごとの航跡間隔 |
| `QUALITY_WINDOW_MS` / `_WARMUP_MS` | 2000 / 3000 | 雛形どおりの判定窓とウォームアップ |
| `QUALITY_SLOW_FRAME_MEDIAN_MS` / `_THROTTLE_MAX_VARIATION` | 24 / 0.12 | 雛形どおりの負荷判定閾値 |
