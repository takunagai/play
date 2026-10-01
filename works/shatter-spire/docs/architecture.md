# Shatter Spire ─ 設計の正本

**このファイルが実装仕様の正本。実装はすべて本書に従い、仕様変更は必ず本書を先に更新する。**

## 1. 体験の核

- 感情ゴール: 癒し・瞑想。破壊を競争にせず、ひと振りの緊張、静止、崩壊、沈積、再生を一つの呼吸として反復する
- コア操作: 弾く・割る。中央の結晶塔を横または斜めにスワイプし、軌跡そのものを切断面にする
- トーン: ダーク＋ネオン。背景 `#0A0F2C`、結晶 `#BFEFFF` / `#B9A7FF`、白は切断面の瞬間光だけ
- 音: 電子シンセで作るガラス鐘とガラスハープ。切断時は高い「キン」+ 低い「ドン」、崩壊時は 16 分音符で上から下へ下降するドリアン音列
- 最優先の手応え: スワイプの角度が切断面へ直結し、約 100ms の完全なヒットストップの後、上半分が切断面に沿って滑り、上段から順に音と一緒に砕けること

迷ったら機能を増やさず、入力への即応、切断線の読みやすさ、100ms の静止、崩壊音と視覚の同期を優先する。全画面フラッシュと画面揺れは使わない。

## 2. モジュール構成

```text
works/shatter-spire/
  index.html / src/style.css   canvas、導入ゲート、診断表示
  src/
    main.ts                    状態機械、Pointer Events、切断判定、描画ループ
    tuning.ts                  パレット、時間、入力閾値、描画上限を一元管理
    music.ts                   D ドリアンの音程と崩壊段から MIDI を求める純粋関数
    quality.ts                 雛形の自動画質判定。品質段を下げるだけ
    art-hook.ts                window.__art 契約。雛形を維持
    audio/
      engine.ts                AudioEngine 契約、Noop、ファクトリ
      synth-engine.ts          Web Audio による切断音、ガラス鐘、砂の微音
      audio-tuning.ts          音量、倍音、残響、同時発音上限
```

呼び出し関係:

```text
Pointer Events ──→ main.ts ──→ 切断線と結晶ポリゴンの交差判定
                         │
                         ├──→ music.ts ──→ CutEvent / NoteEvent
                         ├──→ AudioEngine.beginCut() ──→ CutSchedule
                         │                                  └── 16 分拍の時刻を決定
                         ├──→ QualityController ──→ 描画上限だけを選ぶ
                         └──→ 2D canvas 描画 ←── getAmp()（音→視覚の唯一の逆流線）
```

`main.ts` は `AudioEngine` 契約越しにだけ音へ触れ、Web Audio API を直接使わない。状態機械の正本は `main.ts`、音はイベントを受けて反応する。ただし 16 分拍との同期時刻だけは音側の `beginCut()` が決め、`CutSchedule` として視覚へ返す。

## 3. 状態機械

`main.ts` が唯一の遷移元で、`window.__art.getState()` は次の英字値を返す。

```text
intro（導入）
  └ 中央の pointerup → audio.start() → building
building（積み上がり）
  └ 塔の構築完了 → ready
ready（切断受付）
  ├ 塔と交差する有効な swipe の pointerup → cutting
  ├ 塔を外す / 短すぎる swipe → 淡光を返す → ready
  └ 光の砂への短い接触 → audio.note() → ready
cutting（切断）
  └ 同じフレームでポリゴンを上下へ分割し beginCut() → hitstop
hitstop（ヒットストップ、約 100ms）
  └ CutSchedule.hitStopEndMs → collapse
collapse（滑落崩壊）
  ├ 上半分が切断面の低い側へ滑る
  └ 最終 collapseStepAtMs 経過 → settling
settling（光の砂沈積）
  └ 欠片が底へ着地し速度が閾値未満 → afterglow
afterglow（明滅）
  └ 900ms 経過 → regrowing
regrowing（再生育ち）
  └ 塔が下から伸び切る → ready
```

状態 union は `"intro" | "building" | "ready" | "cutting" | "hitstop" | "collapse" | "settling" | "afterglow" | "regrowing"` とする。

### 3.1 導入と待ち時間の排除

- ページ表示直後から、ゲートの背後で塔を下から積み上げる。中央タップまでに完成していれば `building` は 1 フレームで `ready` へ進む
- 早くタップされた場合は残りの積み上がりを最大 120ms へ短縮する。導入を読ませるための固定待ち時間は置かない
- 最初の中央タップ自体は切断に使わない。次の pointerdown からスワイプを採る
- `audio.start()` は入力ハンドラ内で呼び、解決を待たずに描画を続ける。`pointerup` / `touchend` / `click` / `keydown` の常駐解錠リスナーは雛形どおり維持する

### 3.2 切断受付とスワイプ判定

1. Pointer Events でマウスとタッチを統一し、主ポインタ 1 本だけを受ける。`touch-action: none` とし、ページスクロールと長押しメニューを止める
2. `ready` の pointerdown で `{x, y, time}` を記録し、4px 以上または 12ms 以上離れた pointermove を最大 60Hz で追加する
3. pointerup 時に軌跡長、経過時間、塔の画面上の外接多角形との交差を評価する。有効条件は軌跡長 56px 以上、交差前後に各 12px 以上、平均速度 90px/s 以上。閾値は誤操作除去用で、速さを競わせない（verify の CDP タッチ操作の実測平均が約 115px/s のため、180 では正規のスワイプを誤って拒む）
4. 切断線は軌跡の塔近傍点へ最小二乗直線を当て、その始点から終点への向きを保つ。角度を水平へ丸めないため、斜めのスワイプは斜めの切断面になる
5. `sharpness = clamp((speed - 90) / (1200 - 90), 0, 1)`。速いほど切断線を細く、滑落初速と微小欠片数を増やす。ただし状態遷移、ヒットストップ長、16 分拍の間隔は変えない
6. 塔を外した軌跡は最寄りの結晶面を 140ms だけ淡く光らせる。警告文、失敗音、クールダウンは置かず、同じフレームから次の入力を受ける

### 3.3 切断、ヒットストップ、滑落

- 塔は 9〜13 段、1 段 3〜5 個の凸な結晶ポリゴンとして生成する。各ポリゴンは正規化座標、段番号、色面、質量を持つ
- 切断確定時、直線の符号付き距離で各ポリゴンを分類し、線と交差するポリゴンは半平面クリッピングで上下 2 片へ分ける。切断線より上を上半分、下を土台とする
- `cutting` は 1 フレームだけ。白い切断線を塔幅の内側だけに描き、`AudioEngine.beginCut()` が返す時刻で直ちに `hitstop` へ入る
- `hitstop` 中は塔、欠片、砂、明滅の時刻を進めず、切断線だけを白から透明へ減衰させる。画面全体の時計や canvas は止めず、入力と診断表示を維持する
- `collapse` 開始後、上半分を切断線の接線方向の低い側へ 180ms 滑らせてから重力を加える。画面全体を揺らさず、塔の局所運動と低い「ドン」で重量を伝える
- `collapseStepAtMs` ごとに上の段から 1 段ずつ砕く。大きな片は画面下へ落とし、微小片は画面内へ向けた速度に制限する。四辺に達した片は消さず、底へ引き寄せて砂へ変換する

### 3.4 光の砂、明滅、再生

- 欠片が底の砂面へ達したら、同じ色と質量を持つ砂粒へ変換する。砂粒は横方向の速度を減衰させ、高さマップへ沈積させる
- `settling` は全欠片が砂化するか、最長 700ms で終了する。時間切れの片も現在位置から底へ吸着させ、画面外へ捨てない
- `afterglow` では砂の位置と半径を固定し、4〜7 秒周期の位相差付きサインで `#BFEFFF` / `#B9A7FF` の alpha だけを弱く明滅させる
- 砂への pointerdown / 短い drag は近傍粒子を 6px 以下だけ押しのけ、`audio.note()` で小さなドリアン音を鳴らす。砂を画面外へ押し出さない
- `regrowing` は砂の一部を下から上へ吸い上げるように塔を 900ms で再構築する。砂の総量は少し残し、前回の切断が底に蓄積して見えるようにする
- 再生完了後は説明や得点を出さず `ready` へ戻す。入力がなくても循環は 1 周で止まり、勝手に再切断しない

## 4. 音視覚マッピング

| イベント | 引数 | 視覚反応 | 音響反応 |
|---|---|---|---|
| intro/start | なし | ゲートが薄れ、積み上がった塔が操作可能になる | AudioContext を配線・解錠。発音はしない |
| swipe/track | x, y, speed | 指の直近 80ms だけ `#BFEFFF` の細い軌跡。切断前は白くしない | 発音しない |
| cut | angle, y, speed, rows | 軌跡角度で塔を分割し、塔幅内の切断線だけ白くする | 高い「キン」と低い「ドン」を同時に開始し、16 分拍の `CutSchedule` を返す |
| hitstop | 100ms | 切断線以外の局所アニメーションを完全停止 | 「キン」の短い余韻と「ドン」の立ち上がりだけが進む |
| collapse/step | rowIndex, rowCount | 対応段が上から砕け、欠片が底へ落ちる | ガラス鐘 + ガラスハープ。D ドリアン内で段が下がるほど下降 |
| sand/settle | mass, x | 欠片が同色の砂へ変わり、底へ積もる | ごく短い高域ノイズを小音量で鳴らす。多数着地は 30ms 窓でまとめる |
| sand/touch | x, y, velocity | 近傍の砂が 6px 以下だけ波打つ | 位置対応の小さなドリアン音。最大 8回/秒 |
| regrow | progress 0..1 | 砂から塔が下段順に伸びる | 低いガラス倍音を 1 本だけゆっくり上げ、完了時に消す |
| 毎フレーム | amp 0..1 | 結晶内部光と砂の halo が最大 ±6% 脈動 | ─（音→視覚の逆流線はこの 1 本のみ） |

## 5. AudioEngine 契約

`src/audio/engine.ts` のファクトリ、Noop、解錠、診断の役割を維持し、作品固有イベントだけを追加する。`main.ts` はこの interface 以外から Web Audio に触れない。

```ts
export interface NoteEvent {
  x: number;          // 0..1
  y: number;          // 0..1
  midi: number;       // music.ts が D ドリアンから決める
  velocity: number;   // 0..1
}

export interface CutEvent {
  angleRad: number;
  cutY: number;       // 0..1
  sharpness: number;  // 0..1
  rowCount: number;
}

export interface CutSchedule {
  cutAtMs: number;                 // performance.now() と同じ時刻系
  hitStopEndMs: number;
  slideEndMs: number;
  collapseStepAtMs: readonly number[];
  settleAtMs: number;
}

export interface AudioEngine {
  start(): Promise<void>;
  readonly isReady: boolean;
  beginCut(event: CutEvent): CutSchedule;
  note(event: NoteEvent): void;
  setEnergy(energy: number): void;
  getAmp(): number;
  getDiagnostics(): Record<string, string | number | boolean>;
}
```

- `beginCut()` は `performance.now()` と AudioContext の時刻差を 1 回取得し、`cutAtMs`、100ms 後の `hitStopEndMs`、180ms 後の `slideEndMs`、16 分拍の `collapseStepAtMs` を返す
- テンポは 120 BPM を初期値とし、16 分音符は 125ms。`rowCount` 個の時刻を作り、最終時刻 + 420ms を `settleAtMs` とする
- `NoopAudioEngine.beginCut()` も同じ純粋なスケジュール関数を使う。`?mute` や未解錠でも視覚の速度を変えない
- 雛形の `note()` は砂の微音へ、`setEnergy()` は状態ごとの共鳴量へ用途を狭めて維持する。`getAmp()` は描画ループから 1 フレーム 1 回だけ呼ぶ
- AudioContext が未解錠なら予定時刻を過ぎた音を後からまとめて鳴らさない。視覚は Noop と同じ時刻で最後まで進める

## 6. 音響設計

音階は D ドリアン `D E F G A B C`、半音間隔 `[0, 2, 3, 5, 7, 9, 10]`。崩壊段は上段の D6 付近から下段の D3 付近まで単調下降させ、音階外へ出さない。

| 名前 | 合成方式 | パラメータ写像 |
|---|---|---|
| cutChime | 2.4kHz 付近のサイン + 2.01 倍の弱い部分音、短い指数減衰 | sharpness が高いほど減衰を短くし、倍音を少し増やす。「キン」 |
| cutImpact | 72Hz サイン + 144Hz の小さな三角波 + 低域ノイズの短い減衰 | cutY が低いほど gain を最大 10% 増やす。スマホでは 144Hz 倍音が重量を伝える。「ドン」 |
| glassStep | サイン部分音比 `1 / 2.32 / 4.91` + 3ms ノイズ、0.35〜0.8s 減衰 | rowIndex→下降する D ドリアン、x→pan、sharpness→高域量 |
| sandTick | bandpass noise + 小さなサイン、40ms 減衰 | 着地 mass→音量。30ms 内の着地を 1 音へ束ねる |
| sandNote | 柔らかなサイン + 2.0 倍音、0.5s 減衰 | x→D ドリアン、velocity→音量、x→pan。最大 8回/秒 |
| regrowDrone | D2/D3 のサインを低音量で重ねる | progress→LPF と pitch を緩く上昇。`ready` 遷移で 180ms fade out |

配線:

```text
cutChime / glassStep / sand ─→ glassBus ─┐
cutImpact / regrowDrone ─────→ bodyBus ──┼→ dry + generated Convolver → DynamicsCompressor → master → Analyser → destination
```

- 外部音源・外部通信は使わず、残響 IR は起動時に生成する
- 同時発音上限は 24。超過時は最古の `sandTick`、次に古い `glassStep` の順で 20ms fade out し、`cutChime` と `cutImpact` は奪わない
- `glassStep` が重なる区間は glassBus を最大 -5dB 自動減衰し、下降音列を濁らせない
- DynamicsCompressor と master gain に余裕を持たせ、切断の重ね音でもクリップさせない

## 7. ビジュアル設計

### 7.1 描画レイヤー

下から順に描く。

1. 不透明な背景 `#0A0F2C`
2. 中央へ向かうごく弱い楕円状の青紫光。静的 offscreen canvas へ焼く
3. 底の光の砂。通常合成の芯と、低解像度 glow canvas の halo を分離する
4. 塔の下半分と上半分。結晶面は `#BFEFFF` / `#B9A7FF` の 2 色と alpha だけで作る
5. 落下中の大きな欠片と品質段に応じた微小片
6. 塔幅内の白い切断線。`cutting` / `hitstop` の間だけ
7. 指の直近 80ms の軌跡、導入 UI、`?debug` 診断

切断線以外へ純白を使わない。glow は低解像度 canvas へ 1 回描いて拡大し、結晶の芯へ再帰的に焼き込まない。画面揺れと全画面フラッシュは作らない。

### 7.2 塔と欠片

- 塔幅は `clamp(短辺 × 0.34, 128px, 310px)`、高さは画面高の 58〜72%。縦長 375px では幅を短辺の 44% まで広げ、切断対象を指で狙いやすくする
- 1 段に 3〜5 個、全体 36〜54 個の結晶セルを置く。乱数 seed は 1 周中固定し、切断前に形が揺れないようにする
- 各セルは 5〜7 頂点の凸多角形。面の芯は `#BFEFFF`、隣接面と内部反射は `#B9A7FF`。輪郭を太くせず、1px の淡い稜線で形を読む
- 切断後の上半分は線の接線方向へ滑り、その後に重力を加える。斜め切断では低い側へ滑らせるため、入力角度と結果が一致する
- 大きな欠片はセルを再利用し、微小片だけを追加する。全粒子を画面内へ clamp するのではなく、外向き速度を底向きへ偏向して自然に沈積させる

### 7.3 光の砂

- 砂は個別粒子を無制限に残さず、192 列の高さマップと最大 220 個の可視粒子へ集約する。古い粒子は色別の面積を高さマップへ足して解放する
- 芯は 1〜2px の `#BFEFFF` / `#B9A7FF`、halo は alpha 0.08 以下の 1 層。明滅は位置や半径を変えず alpha だけを変える
- 複数周の砂は下端から画面高の 18% を上限に圧縮表示する。再生で一部を塔へ戻し、操作領域を埋めない

## 8. 画質の自動調整と性能

雛形の `QualityController` と `quality.ts` の判定式を維持する。`main.ts` は `QualityController(3)` を 1 個持ち、`recordFrame()` を毎フレーム 1 回呼ぶ。品質段は上げ直さず、次だけを段階的に減らす。

| 品質段 | 微小欠片上限 | 可視砂粒上限 | 結晶の内部稜線 | glow 解像度 |
|---:|---:|---:|---:|---:|
| 0 | 180 | 220 | 全面 | 1/4 |
| 1 | 96 | 160 | 1/2 | 1/6 |
| 2 | 48 | 100 | 外周優先 | 1/8 |

- 品質段で塔のセル数、切断形状、状態遷移、ヒットストップ、16 分拍、砂の総質量は変えない
- `P5.disableFriendlyErrors = true`、`createCanvas` 後に `pixelDensity(1)`、結晶と粒子は p5 API の大量呼び出しを避け 2D context へ直接描く
- 背景光は offscreen canvas へ焼き、リサイズ時だけ再生成する。粒子配列、音声ボイス、スワイプ点には必ず上限を置く
- `getAmp()` は 1 フレーム 1 回、デバッグ描画は 6 フレームに 1 回まで
- 375px〜1280px で横スクロールを出さず、リサイズ時は正規化座標から塔と砂面を再構築する
- `prefers-reduced-motion` では砂の明滅幅と再生時の上昇速度を半減するが、100ms のヒットストップと音視覚同期は維持する

## 9. Tier 設計とフォールバック

- Tier 1 のみ: 2D canvas + Web Audio + Pointer Events。画像、WebGL、外部 API、パターン層を使わない
- AudioContext 非対応、`?mute`、解錠失敗でも `NoopAudioEngine` の `CutSchedule` で視覚作品として最後まで進む
- Convolver 生成失敗時は dry 経路だけで鳴らす。音の失敗で切断入力や状態遷移を止めない
- 結晶ポリゴンのクリップに数値誤差が出た場合、そのセルだけ重心の符号で上下どちらかへ分類し、周回全体を中断しない

## 10. 雛形資産と契約の維持

| ファイル | 雛形の役割 | Shatter Spire での方針 |
|---|---|---|
| `src/main.ts` | 状態機械、Pointer Events、描画ループ | `intro` 契約と入力方式を維持し、9 状態、切断判定、結晶・砂描画へ置き換える |
| `src/tuning.ts` | 視覚・入力・品質定数の一元管理 | 同じ役割を維持し、本書第 11 節の定数へ置き換える |
| `src/quality.ts` | フレーム中央値と変動係数による段階低下 | 判定ロジックと閾値を維持し、描画上限配列だけを作品用にする |
| `src/audio/engine.ts` | interface、Noop、`?mute` ファクトリ | `start` / `isReady` / `note` / `setEnergy` / `getAmp` / 診断を維持し、`beginCut` と schedule 型を追加する |
| `src/art-hook.ts` | `window.__art` の読み取り専用フック | ファイルと interface を変更せず、全状態で常時公開する |

`window.__art` は雛形どおり次を必ず公開する。

```ts
window.__art = {
  getAmp(): number,
  getState(): string,
  getFrameStats(): { frames: number; meanDrawMs: number },
};
```

導入状態の戻り値は必ず `"intro"`。`getAmp()` は無音なら 0、`getFrameStats()` は `draw` 末尾の実測値を返す。`?mute` と `?debug` も維持する。

## 11. 調整ノブ

視覚・入力・状態時間は `src/tuning.ts`、音量・合成値は `src/audio/audio-tuning.ts` へ集約する。初期値は次のとおり。

| 定数 | 初期値 | 効き方 |
|---|---:|---|
| `INTRO_FAST_BUILD_MS` | 120 | 早く導入を抜けた時、塔を完成させる最大時間 |
| `SWIPE_MIN_LENGTH_PX` | 56 | 切断候補とする最小軌跡長 |
| `SWIPE_MIN_SPEED_PX_S` | 180 | 誤タップをスワイプから除く境界 |
| `SWIPE_SHARP_SPEED_PX_S` | 1200 | `sharpness = 1` になる速度 |
| `SWIPE_CROSS_MARGIN_PX` | 12 | 塔交差の前後に必要な軌跡長 |
| `HITSTOP_MS` | 100 | 切断後に局所アニメーションを止める時間 |
| `SLIDE_MS` | 180 | 上半分が切断面を滑る時間 |
| `BPM` / `SIXTEENTH_MS` | 120 / 125 | 崩壊段の 16 分拍 |
| `SETTLING_MAX_MS` | 700 | 残った欠片を底へ収束させる上限 |
| `AFTERGLOW_MS` | 900 | 砂だけを見せる明滅状態の最短時間 |
| `REGROW_MS` | 900 | 塔が下から再生する時間 |
| `TOWER_ROWS_MIN` / `_MAX` | 9 / 13 | 塔の段数 |
| `CRYSTALS_PER_ROW_MIN` / `_MAX` | 3 / 5 | 1 段の結晶数 |
| `MICRO_SHARD_CAP_STEPS` | `[180, 96, 48]` | 品質段ごとの微小欠片上限 |
| `VISIBLE_SAND_CAP_STEPS` | `[220, 160, 100]` | 品質段ごとの可視砂粒上限 |
| `SAND_HEIGHT_COLUMNS` | 192 | 沈積高さマップの列数 |
| `SAND_TOUCH_RATE_HZ` | 8 | 砂の微音の最大回数 |
| `PALETTE_BACKGROUND` | `#0A0F2C` | 不透明背景 |
| `PALETTE_CRYSTAL_LIGHT` | `#BFEFFF` | 結晶の芯と砂 |
| `PALETTE_CRYSTAL_SHADOW` | `#B9A7FF` | 結晶の影面と砂 |
| `QUALITY_WINDOW_MS` / `_WARMUP_MS` | 2000 / 3000 | 雛形の画質判定窓とウォームアップ |
| `QUALITY_SLOW_FRAME_MEDIAN_MS` / `_THROTTLE_MAX_VARIATION` | 24 / 0.12 | 雛形の負荷判定閾値 |
