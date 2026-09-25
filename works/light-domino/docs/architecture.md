# 光のドミノ ─ 設計の正本

**このファイルが仕様の正本。実装はすべて本書に従い、仕様変更は必ず本書を先に更新する。**

## 1. 体験の核

- 感情ゴール: 緊張と畏怖。自分で作った長い列が、制御を離れて加速していく期待を味わう
- コア操作: 撫でる・かき混ぜる。なぞって道を描き、列の端をタップして倒す
- トーン: ダーク＋ネオン。墨色 `#111318`、温かい白 `#FFF4E0`、不透明な金 `#FFC857`
- 音: マリンバ／カリンバ風の短い減衰音、C メジャーペンタの上昇、最後は低音付きの長い和音

迷ったら、最後の直前の「間」と、その後に視覚・低音・和音が同時に開く瞬間を優先する。機能を増やすより、なぞりやすさ、連鎖が読める速さ、終演の同期を守る。

## 2. モジュール構成

```text
works/light-domino/
  index.html / src/style.css   canvas、導入オーバーレイ、診断表示
  src/
    main.ts                    状態機械、Pointer Events、連鎖タイムライン、描画ループ
    tuning.ts                  視覚・入力・時間・品質の定数を一元管理
    music.ts                   C メジャーペンタ、板番号から音程を決める純粋関数
    path.ts                    入力点の平滑化、弧長再サンプリング、板配置
    quality.ts                 既存の自動画質判定。粒子上限だけを切り替える
    art-hook.ts                window.__art 契約。雛形を維持
    audio/
      engine.ts                AudioEngine 契約、Noop、ファクトリ
      synth-engine.ts          Web Audio によるマリンバ／カリンバと終演和音
      audio-tuning.ts          音量、倍音、残響、同時発音数
```

呼び出し関係:

```text
Pointer Events ──→ main.ts ──→ path.ts ──→ Domino[]
                        │           │
                        │           └── 接線・弧長・描画座標
                        ├──→ music.ts ──→ ChainEvent[]
                        ├──→ AudioEngine.beginChain() ──→ ChainSchedule
                        │                              └── 音の時刻を決定
                        └──→ canvas 描画 ←── getAmp()（音→視覚の唯一の逆流線）
```

`main.ts` は `AudioEngine` 契約越しにだけ音へ触れ、Web Audio API を直接使わない。契約と状態機械の正本は本書であり、実装側には「正本は docs/architecture.md」とコメントを置く。

## 3. 状態機械

`main.ts` が状態の唯一の正本。`window.__art.getState()` は次の英字値を返す。

```text
intro（導入）
  └ 中央の pointerdown → audio.start()（resume を待たない）→ tracing
tracing（なぞり）
  ├ pointermove → 入力点を追加し、補正済みの仮配置を更新
  └ pointerup / pointercancel
      ├ 有効長以上 → aligned
      └ 短すぎる → 仮配置を 240ms で消す → tracing（次の pointerdown 待ち）
aligned（整列）
  ├ 端のタップ → AudioEngine.beginChain() → chain
  └ 端以外からのドラッグ → 未実行の列を置き換えて tracing
chain（連鎖）
  └ ChainSchedule の最後の板の時刻 → finale
finale（終演）
  ├ 0..1200ms: 道全体の発光と和音の立ち上がり
  ├ 1200ms: 曲線を静的な光跡レイヤーへ焼き付け、板を破棄
  └ 次の pointerdown → tracing（光跡は残す）
```

### 3.1 導入

- 墨色の床、少数の休止中の板、タイトル「光のドミノ」、案内「なぞって、端を押す」だけを置く
- 画面中央の最初のタップでオーバーレイを消し、`audio.start()` を呼ぶ。このタップ自体は道の始点にしない
- `start()` は配線後、`pointerup` / `touchend` / `click` / `keydown` の常駐リスナーでも `AudioContext.resume()` を試す。Promise の解決待ちで描画を止めない

### 3.2 なぞりと補正

1. Pointer Events でマウス・タッチを統一し、主ポインタ 1 本だけを受ける。`touch-action: none` とし、ページのスクロールや長押しメニューを止める
2. 生の入力点は 4px 以上離れたときだけ最大 60Hz で記録する
3. 直近 5 点の重み付き移動平均で手ぶれを弱める。指から見た遅れが 24px を超えたときは補正率を下げ、追従性を優先する
4. 補正曲線を弧長で再サンプリングし、板中心を一定間隔に置く。間隔は `clamp(短辺 × 0.035, 15px, 25px)`
5. 板の向きは前後の再サンプル点から求めた接線に直交させる。鋭い折れは接線を前後で平均し、がたついた線でも向きが急反転しないようにする
6. 最大 180 枚。上限後も入力自体は受けるが、最後の板を穏やかに脈動させて上限を知らせる
7. 有効な列は 8 枚以上かつ弧長 96px 以上。満たさない列は失敗扱いにせず 240ms で消す

仮配置はなぞり中にも温かい白の板として現れ、新しい板が増えたときだけ小さな「カチ」音を鳴らす。発音は最大 12 回/秒に間引くが、板の視覚配置は間引かない。

### 3.3 整列と端の判定

- 指を離した時点で同じ補正処理を最終入力全体へ 1 回かけ、板が 220ms で最終位置へ吸着する
- 両端の板を 0.9Hz でごく小さく明滅させ、押せる場所を示す。文章による追加説明は出さない
- ヒット範囲は端の中心から `max(44px, 板長 × 2.5)`。どちらの端からでも始められ、タップした端から配列を並べ替えて連鎖する
- 端以外を押して 10px 以上動かしたら新しい列の描画を始める。単なる誤タップでは列を消さず、最寄りの端を一度だけ明るくする

### 3.4 連鎖タイムライン

- `AudioEngine.beginChain(events)` が `performance.now()` と同じ時刻系の `ChainSchedule` を返す。音側が拍の時刻を決め、`main.ts` はその時刻で板の倒れ始めを描く
- 先頭は操作から 80ms 後。板間隔は 190ms から 95ms へ `easeInQuad` で縮める
- 列全体は短い道でも 1.4 秒以上、長い道でも 9 秒以下。枚数に応じて間隔を一様に伸縮し、この範囲へ収める
- 最後から 1 枚前の減衰を早め、その後 160ms は新しい打音を鳴らさない。最後の板の単音は終演和音に置き換える
- 1 枚の倒れは 140ms。回転角に相当する `fallProgress 0..1` を `easeInCubic` で進め、倒れ始めに白から金へ切り替える
- 連鎖中は入力を受けず、`pointercancel` や画面外への移動でもタイムラインを中断しない

### 3.5 終演と次の道

- 最後の板が床へ触れるフレームを `finaleAtMs` とし、終演和音の開始、道全体の発光、細い衝撃波を同じ時刻にそろえる
- 全画面を白くせず、補正済み曲線の周囲だけを 650ms で柔らかく明るくする。主役の金の芯は常に読めるようにする
- 1200ms 後、倒れた板列を静的な光跡へ焼き付ける。次の道を描けるが、古い光跡は残る
- 光跡は最大 24 本。超過時だけ最古の 1 本を 1500ms で消す。通常は時間で薄くしない

## 4. 音視覚マッピング

| イベント | 引数 | 視覚反応 | 音響反応 |
|---|---|---|---|
| intro/start | なし | オーバーレイが 300ms で消え、床が見える | AudioContext を配線・解錠。音は鳴らさない |
| trace/place | x,y,index | 温かい白の板が 110ms で立ち上がる | 最大 12回/秒の木製クリック。位置で pan、音程なし |
| trace/release | tileCount | 列が 220ms で補正後の位置へ吸着、両端が明滅 | 低い木のクリック 1 音。残響は短い |
| chain/start | direction,events | タップした端が金に変わり連鎖開始 | 全単音と終演和音を AudioContext 時刻へ先行予約し、`ChainSchedule` を返す |
| chain/fall | x,y,midi,index,count | 1 枚が 140ms で倒れ、金の短い筋になる | マリンバ／カリンバ風の短音。C メジャーペンタを進行率で上昇、pan ∝ x |
| chain/hush | 160ms | 最後の板だけが温かい白で残り、道の光量を少し引く | 新しい打音を止め、既存音も短くダックする |
| finale | x,y,rootMidi | 最後の板が倒れ、道全体が 650ms 発光、細い衝撃波 | C2/C3 の低音 + C4/E4/G4/A4 の長い和音、4.8秒減衰 |
| trail/commit | path | 不透明な金の芯を静的レイヤーへ焼き付ける | 音なし。和音の残響だけを残す |
| 毎フレーム | amp 0..1 | 終演中だけ周辺光が ±8% 脈動 | ─（音→視覚の逆流線はこの 1 本のみ） |

## 5. AudioEngine 契約

`src/audio/engine.ts` は次の契約の写しに置き換える。

```ts
export interface ChainEvent {
  x: number;          // 0..1
  y: number;          // 0..1
  midi: number;       // music.ts が決める
  velocity: number;   // 0..1
}

export interface ChainSchedule {
  fallAtMs: readonly number[]; // performance.now() と同じ時刻系
  hushAtMs: number;
  finaleAtMs: number;
  settleAtMs: number;
}

export interface AudioEngine {
  start(): Promise<void>;
  readonly isReady: boolean;
  place(x: number, y: number): void;
  align(tileCount: number): void;
  beginChain(events: readonly ChainEvent[]): ChainSchedule;
  getAmp(): number;
  getDiagnostics(): Record<string, string | number | boolean>;
}
```

- `NoopAudioEngine.beginChain()` も同じ純粋なタイムライン計算を使い、無音時に視覚の速さが変わらないようにする
- `?mute` では Noop、通常は `SynthAudioEngine`
- `beginChain()` は AudioContext が `running` なら音を先行予約し、未解錠なら視覚だけ同じスケジュールで進める。途中で解錠されても進行済みの音をまとめて鳴らさない
- `getAmp()` は 1 フレームにつき 1 回だけ呼ぶ

## 6. 音響設計

音階は C メジャーペンタ `C D E G A`。`music.ts` に `[0, 2, 4, 7, 9]` と基音 MIDI 60 を置く。各板の進行率をスケール段数へ写し、C4 から E6 まで単調に上昇させる。同じ音が数枚続いてもよいが、音程が逆行しないことを優先する。

| 名前 | 合成方式 | パラメータ写像 |
|---|---|---|
| placeClick | 2ms ノイズ + 900Hz の短いサイン、減衰 35ms | x→pan。速度に依存させず小音量 |
| domino | マリンバ風モーダル合成。サイン部分音比 `1 / 3.98 / 10.65`、減衰 `0.52s / 0.18s / 0.07s` + 4ms のマレットノイズ | midi→基音、進行率→明るさ、x→pan。終盤は残響を少し増やす |
| finaleBass | C2 65.4Hz + C3 130.8Hz のサイン／三角、緩いアタック 18ms | 固定中央。2.8秒で減衰 |
| finaleChord | C4/E4/G4/A4 のマレット音 + 柔らかいサイン層 | 左右へ広げ、4.8秒で減衰。最初の 500ms を最も明るくする |
| hushDuck | マスター前の打音バスを 80ms で -12dB、終演時に 180ms で復帰 | 最後の直前の 160ms だけ適用 |

配線:

```text
place / domino ─→ transientBus ─┐
finaleBass / finaleChord ────────┼→ fxIn → dry / generated Convolver → DynamicsCompressor → master → Analyser → destination
                                └→ hushDuck は transientBus のみ
```

- 外部音源・外部通信は使わない。残響 IR は起動時に生成する
- 同時発音上限 28。超過時は最古の通常音を 20ms でフェードして奪い、終演音は奪わない
- 250ms 内の発音数が増えたら通常音を最大 -6dB ダックし、加速時の音量飽和を防ぐ
- Compressor は threshold -12dB、ratio 12:1。マスターは余裕を残し、終演でもクリップさせない
- スマホの小型スピーカーでも低音の存在が分かるよう、C2 に小音量の C3 倍音を重ねる

## 7. ビジュアル設計

### 7.1 描画レイヤー

下から順に:

1. 墨色の床。毎フレーム `source-over` で `#111318` を不透明に描く
2. 静的な光跡レイヤー。オフスクリーン canvas に確定済みの曲線を保持し、毎フレーム 1 回だけ合成する
3. 現在の板列。2D context の `save/translate/rotate/scale/fillRect` でまとめて描く
4. 終演の周辺光と衝撃波。縮小した glow canvas を CSS で拡大し、芯へ再帰的に焼き込まない
5. 導入 UI / `?debug` 診断

### 7.2 板と光跡

- 立っている板: `#FFF4E0`、長さ `clamp(短辺×0.032, 14px, 24px)`、見かけの幅 3px。短い影を 1 本だけ添えて床から立って見せる
- 倒れる途中: `fallProgress` に応じて接線方向へ中心をずらし、長さ方向の見かけを広げ、厚みを縮める。3D/WebGL は使わない
- 倒れた板: `#FFC857` の不透明な短冊。低 alpha の金を何層も重ねない
- 確定光跡: `#FFC857`、幅 2.5px、不透明。交差部も `source-over` の同色なので濁らない
- 発光: 金の芯とは別レイヤーで、`#FFF4E0` のぼかしを最大 alpha 0.16 で 1 回だけ置く。通常時は弱く、終演中だけ強める
- 背景には橙〜黄緑の半透明面を置かない。白飛びを避け、終演中も墨色が画面面積の 70%以上残る

### 7.3 レスポンシブと性能

- 375px では板長と間隔を短辺基準で下限 clamp し、1280px と同程度の密度にする
- リサイズ時は正規化座標から現在列と確定光跡を再構築する。画面四辺で曲線を直線的に切らず、端から 12px 内側へ入力を clamp する
- 目標 60fps。`P5.disableFriendlyErrors = true`、`createCanvas` 後に `pixelDensity(1)`、`getAmp()` は 1 フレーム 1 回
- 板上限 180、確定光跡 24 本。板は 1 つずつ p5 API を呼ばず、2D context へ直接描く
- 画質段は終演スパークル上限のみ `240 / 120 / 60` と切り替える。板数、連鎖時間、光跡の形は画質で変えない

## 8. Tier 設計とフォールバック

- Tier 1 のみ: 2D canvas + Web Audio + Pointer Events。画像、WebGL、外部 API、パターン層は使わない
- AudioContext 非対応・`?mute`・解錠失敗でも、NoopAudioEngine のスケジュールで視覚作品として最後まで進む
- Convolver の生成に失敗した場合は dry 経路だけで鳴らす
- 画質判定に失敗した場合は最軽量のスパークル上限を使い、入力補正・板・光跡は維持する

## 9. 雛形からの作り替え

| ファイル | 雛形 | 光のドミノでの置き換え |
|---|---|---|
| `src/main.ts` | `intro / idle / pressing`、位置で音程を決める波紋 | `intro / tracing / aligned / chain / finale`、補正した道、板列、音側のスケジュールで進む連鎖、永続光跡へ全面置換 |
| `src/tuning.ts` | 波紋寿命・半径・個数 | パレット、入力平滑化、板間隔・上限、端ヒット範囲、倒れ時間、190→95ms の加速、160ms の間、光跡上限へ置換 |
| `src/audio/engine.ts` | `note()` と `setEnergy()` | `place()`、`align()`、`beginChain()` と `ChainSchedule` へ契約を置換。Noop も同じスケジュールを返す |
| `src/audio/synth-engine.ts` | 汎用ベル 1 音 | マリンバ／カリンバ短音、打音バスの hush、低音付き終演和音、音声時刻への先行予約へ置換 |
| `src/music.ts` | x 座標でメジャーペンタを選ぶ | 板の進行率で C4→E6 を単調上昇させる関数と、終演和音の音列へ置換 |
| `src/style.css` / `index.html` | 波紋作品の案内 | 墨色の床、タイトル、案内「なぞって、端を押す」へ置換 |
| `src/quality.ts` / `src/art-hook.ts` | 雛形の自動調整と検証契約 | 構造を維持。画質段はスパークル上限だけへ接続し、`window.__art` は常時公開 |

## 10. 調整ノブ

すべて `src/tuning.ts`（音響値は `src/audio/audio-tuning.ts`）へ集約する。

| 定数 | 初期値 | 効き方 |
|---|---:|---|
| `RAW_POINT_MIN_DISTANCE_PX` | 4 | 小さいほど細かな手ぶれも拾う |
| `SMOOTHING_WINDOW_POINTS` | 5 | 大きいほど滑らかだが指への追従が遅れる |
| `DOMINO_SPACING_MIN_PX` / `MAX_PX` | 15 / 25 | 板列の密度 |
| `MIN_PATH_LENGTH_PX` / `MIN_DOMINOES` | 96 / 8 | 短い誤操作を列にしない境界 |
| `MAX_DOMINOES` | 180 | 1 本の列の上限 |
| `ALIGN_MS` | 220 | 指を離して板が整列する時間 |
| `FALL_MS` | 140 | 1 枚が倒れる見た目の時間 |
| `CHAIN_INTERVAL_START_MS` / `END_MS` | 190 / 95 | 連鎖の加速幅 |
| `CHAIN_DURATION_MIN_MS` / `MAX_MS` | 1400 / 9000 | 短すぎ・長すぎを防ぐ |
| `PREFINALE_HUSH_MS` | 160 | 「間」の長さ。最優先の調整点 |
| `FINALE_GLOW_MS` / `FINALE_SETTLE_MS` | 650 / 1200 | 光の解放と光跡への確定時間 |
| `ENDPOINT_HIT_MIN_PX` | 44 | 端を押しやすくする |
| `MAX_COMMITTED_TRAILS` | 24 | 絵として残る道の本数 |
| `PARTICLE_CAP_STEPS` | `[240, 120, 60]` | 画質別の終演スパークル上限 |
