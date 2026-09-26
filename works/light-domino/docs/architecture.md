# 光のドミノ ─ 設計の正本

**このファイルが仕様の正本。実装はすべて本書と `art-direction.md` に従い、仕様変更は必ず本書を先に更新する。**

実装の注意（再設計にあたっての優先順）: 実装は本書（architecture.md）と `art-direction.md` に従う。粒子の単純増量・既存禁止色（濁った茶色・オリーブ、白飛び、太い原色リング）の導入はしない。

## 1. 体験の核

- 感情ゴール: 緊張と畏怖。自分で作った長い列が、制御を離れて加速していく期待を味わう
- コア操作: 撫でる・かき混ぜる。なぞって道を描き、列の端をタップして倒す
- トーン: ダーク＋ネオンの「暗い展示室」。墨色 `#111318` の床、温かい白 `#FFF4E0`、不透明な金 `#FFC857`。床には冷たい低コントラストの照り `#1A1F29`（連鎖で `#2A2620` へ温まる）と、かすかな格子・等高線、四辺の周辺減光を置く。色は 4 系統に絞り、状態ごとに新しい色を作らない（`art-direction.md` 第 0 章のカラートークンと合成の規律が最優先）
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
    quality.ts                 既存の自動画質判定。判定段は ?debug 診断表示に載せる
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
  ├ 1200ms: 曲線を静的な星図レイヤーへ焼き付け（settleAtMs。自動確定）、板列を解放
  └ 次の pointerdown → tracing（星図は残す）
```

### 3.1 導入 ─ 床の生命

- 墨色の床と少数の休止中の板に加え、下の「床の常駐描画」を置く。タイトル「光のドミノ」と案内「なぞって、端を押す」は下部帯の脇役
- **床の常駐描画（intro の主役）**: 操作前から床が見える。冷たい照り・格子・周辺減光（第 7.1 節の L0〜L3）に加え、**寝ている光の断片**を 12〜18 個常駐させる。`gold` 半径 1〜2px・alpha 0.5〜0.9 + 各点 alpha 0.05 のグロー 1 層、周期 4〜7s の明滅（位相は点ごとにずらす）。確定済み星図があるときは節点が alpha 0.35 に沈んで眠る。描画は静的キャンバスへ 1 回焼き、明滅のみ毎フレームで alpha を掛ける（rAF 負荷を増やさない）
- 文字は脇役: タイトル 22px（alpha 0.85）+ 案内 13px（alpha 0.55）を画面下部 22% の帯に置き、床の主役を文字より先に見せる（taste-guide 合否 7 の「埋もれない」は脇役化で満たす）
- 最初の指が触れた瞬間、触点に近い寝ている点 2〜3 個が alpha 0.9 に立ち上がる（文字より先に世界が応える）
- 画面中央の最初のタップでオーバーレイを消し、`audio.start()` を呼ぶ。このタップ自体は道の始点にしない
- `start()` は配線後、`pointerup` / `touchend` / `click` / `keydown` の常駐リスナーでも `AudioContext.resume()` を試す。Promise の解決待ちで描画を止めない

### 3.2 なぞりと補正

1. Pointer Events でマウス・タッチを統一し、主ポインタ 1 本だけを受ける。`touch-action: none` とし、ページのスクロールや長押しメニューを止める
2. 生の入力点は 4px 以上離れたときだけ最大 60Hz で記録する
3. 直近 5 点の重み付き移動平均で手ぶれを弱める。指から見た遅れが 24px を超えたときは補正率を下げ、追従性を優先する
4. 補正曲線を弧長で再サンプリングし、板中心を一定間隔に置く。間隔は `clamp(短辺 × 0.035, 15px, 25px)`（375px では 12px。第 10 節のモバイル独立スケール）
5. 板の向きは前後の再サンプル点から求めた接線に直交させる。鋭い折れは接線を前後で平均し、がたついた線でも向きが急反転しないようにする
6. 最大 180 枚。上限後も入力自体は受けるが、最後の板を穏やかに脈動させて上限を知らせる
7. 有効な列は 8 枚以上かつ弧長 96px 以上。満たさない列は失敗扱いにせず 240ms で消す

仮配置はなぞり中にも温かい白の板として現れる。**tracing の視覚（主役 = 指先の仮板列）**: 仮板列は立板と同じ形で `warmWhite` alpha 0.55、影なし・縁取りなし。指位置（最新点）から直近 3 枚は alpha 0.55 → 0.9 で濃く、描いた端が「生きて」いる。板列は指の最新点へ即時に追従する（手の延長感。実測では専用の遅延定数は置かず即時追従）。通過直後の点に半径 6px・alpha 0.15 の丸を 120ms だけ置いてフェードアウトし、積算しない。新しい板が増えたときだけ小さな「カチ」音を鳴らす。発音は最大 12 回/秒に間引くが、板の視覚配置は間引かない。画面下部 48px は誤操作防止の無視領域（枠は描かない）

### 3.3 整列と端の判定

- 指を離した時点で同じ補正処理を最終入力全体へ 1 回かけ、補正後の最終位置へ板を配置する（実装は吸着アニメーションなしの即時配置。旧記載の 220ms 吸着は `ALIGN_MS` として legacy キー保持。第 10 節）
- 整列後、全板が「立ち」の完全表現（床影 + 縁取り + エッジ反射付き。第 7.2 節）へ昇格する
- **押せる端の強調（aligned の主役）**: 押せる端（始点側）の板 3 枚（375px では 2 枚）を幅 +2px、alpha 0.85 ↔ 1.0 の緩い明滅 1.2Hz で示す。位相は端から順に 80ms ずつ遅らせ、押したくなる波にする。既存の「どちらの端からでも始められる」入力契約は維持し、反対側の端を押したときも同じ強調で始められる。文章による追加説明は出さない（案内は 1 語のみ、画面下部 12%・`warmWhite` alpha 0.6）
- ヒット範囲は端の中心から `max(44px, 板長 × 2.5)`。どちらの端からでも始められ、タップした端から配列を並べ替えて連鎖する
- 端以外を押して 10px 以上動かしたら新しい列の描画を始める。単なる誤タップでは列を消さず、最寄りの端を一度だけ明るくする

### 3.4 連鎖タイムライン

- `AudioEngine.beginChain(events)` が `performance.now()` と同じ時刻系の `ChainSchedule` を返す。音側が拍の時刻を決め、`main.ts` はその時刻で板の倒れ始めを描く
- 先頭は操作から 80ms 後。板間隔は 190ms から 95ms へ `easeInQuad` で縮める
- 列全体は短い道でも 1.4 秒以上、長い道でも 9 秒以下。枚数に応じて間隔を一様に伸縮し、この範囲へ収める
- 最後から 1 枚前の減衰を早め、その後 160ms は新しい打音を鳴らさない。最後の板の単音は終演和音に置き換える
- 1 枚の倒れは 140ms。回転角に相当する `fallProgress 0..1` を `easeInQuad` で進める（art-direction 第 3 章と同じ。跳ね返りを作らない）。白から金への切替は倒れ角 60 度の 2 値切替で、途中混合は作らない
- 連鎖中は入力を受けず、`pointercancel` や画面外への移動でもタイムラインを中断しない
- **chain の視覚（主役 = 板を追う発光パルスと床の照りの移動）**:
  - 倒れの視覚は第 7.2 節の「倒れ中」のとおり（着地 0ms で反応。連鎖間隔を拍に乗せるのは音側の設計で、視覚は着地に追従するだけ）
  - **発光パルス**: 着地した板の位置に `gold` alpha 0.10 の円、半径 18px（375px では 14px）→ 140ms で 34px（375px では 28px）へ拡大しながら alpha → 0。同時存在数は最大 2（連鎖が速くても画面を濁さない）
  - **床の局所灯**: 第 7.1 節 L1 の照りの中心を、直近 4 枚の倒れた板の重心へ 0.5s かけて線形スライドする。床が連鎖を追いかけて照らされる
  - **明度・色温度の物語**: 連鎖進行度 t（0 → 1）で照りの alpha 0.5 → 0.8、照りの色 `#1A1F29` → `#2A2620` へ線形補間（照り 1 層の内部補間のみ。板・蕊は混色しない）、未倒れの立板は alpha 0.9 → 1.0 へわずかに上がる
  - 板の厚み・影・エッジの式は連鎖中も変えない。光の担い手は倒れた板だけ
  - 休止: 板列が 2s 以上途切れたらパルスを止め、床を静寂に戻す（aligned の端の明滅で再誘い）

### 3.5 終演と次の道

- 最後の板が床へ触れるフレームを `finaleAtMs` とし、終演和音の開始をこの時刻にそろえる。道の視覚は本節のとおり段階的に進む
- **finale の視覚（主役 = 道に沿った柔らかい光の開花）**:
  - トリガ: 最終板の着地から 200ms 後
  - **開花**: 道の全点に沿い、始点 → 終点へ 800ms で走る明るさの波。金の蕊が一時的に線幅 1.5 → 3px、伴うグローは `gold` alpha 0.10・幅 24px（加算 1 層）。全画面フラッシュは作らない（最大輝度は `warmWhite` 未満）
  - **衝撃波**: 終点から 1 回だけ。commit と同じ `settleAtMs`（finaleAtMs + 1200ms）の開始で、半径 0 → `min(w, h) × 0.4` を 600ms、線幅 1px・`gold` alpha 0.12 → 0 の細い円弧（寿命は `SHOCKWAVE_MS`）。太いリング禁止のため 1px・低 alpha・1 回限り
  - **余韻**: 開花と並行して全板のグローが alpha 0.08 → 0.03 へ落ち着き、その後 commit 待ちの静寂を置く（解放前の間の視覚版）
- **確定は対話を待たない**: 終演和音の開始から 1200ms 後（`settleAtMs`。`FINALE_SETTLE_MS`）に、倒れた板列を自動で静的な星図へ焼き付ける。ユーザー操作は確定の条件にならず、次の pointerdown は確定後の新しい道の始点として扱う
- 全画面を白くせず、補正済み曲線の周囲だけを柔らかく明るくする。主役の金の芯は常に読めるようにする。終演中も墨色が画面面積の 70% 以上残る
- 確定の瞬間、星図の焼き付けと同時に終点から金の描線が終点 → 始点へ 500ms で逆走する（`COMMIT_RETRACE_MS`。グロー層の走査演出。「重ねて描いた道」の演出。art-direction 第 4 章の「commit の誘い」の操作は再設計で置かず、自動確定に同期した演出として行う）
- **確定の絵（commit 後・第 7.2 節「確定道」のとおり）**: 蕊 `gold` alpha 1.0・1.5px の 1 回描き + 節点（板 1 枚につき `gold` alpha 1.0・半径 2px の円 + alpha 0.3・半径 5px の外殻。通常合成の 2 層）+ 残光（直近 1 回の演奏は 10s かけてグロー alpha 0.03 → 0 へ減衰し「昨日の星」になる）
- 星図は蓄積の上限を超えても蕊と節点は消さない（星図＝記憶は消えない。上限の振る舞いは第 7.2 節）。次の演奏の intro では星図が眠る星として床に残る

## 4. 音視覚マッピング

| イベント | 引数 | 視覚反応 | 音響反応 |
|---|---|---|---|
| intro/start | なし | オーバーレイが 300ms で消え、床（照り・格子・眠る光の断片）が見える | AudioContext を配線・解錠。音は鳴らさない |
| trace/place | x,y,index | 温かい白の板が 110ms で立ち上がる。直近 3 枚は alpha 0.55 → 0.9 で濃い | 最大 12回/秒の木製クリック。位置で pan、音程なし |
| trace/release | tileCount | 列が補正後の位置へ即時吸着（旧 220ms 吸着は legacy。第 10 節）、押せる端が 1.2Hz の波で明滅 | 低い木のクリック 1 音。残響は短い |
| chain/start | direction,events | タップした端が金に変わり連鎖開始 | 全単音と終演和音を AudioContext 時刻へ先行予約し、`ChainSchedule` を返す |
| chain/fall | x,y,midi,index,count | 1 枚が 140ms で倒れ、金の蕊を持つ短冊になる。着地点に発光パルス（最大 2 同時）、床の照りの中心が直近 4 枚の重心へ 0.5s でスライド、照りは進行度 t で alpha 0.5 → 0.8・`#1A1F29` → `#2A2620` へ温まる | マリンバ／カリンバ風の短音。C メジャーペンタを進行率で上昇、pan ∝ x。**velocity は交叉・並走・蓄積の反映で変わる（下の表）** |
| chain/hush | 160ms | 最後の板だけが温かい白で残り、道の光量を少し引く | 新しい打音を止め、既存音も短くダックする |
| finale | x,y,rootMidi | 最後の板が倒れ、道に沿って始点 → 終点へ 800ms の開花、終点から細い衝撃波 1 回、余韻 0.8s | C2/C3 の低音 + C4/E4/G4/A4 の長い和音、4.8秒減衰 |
| trail/commit | path | 金の描線が終点 → 始点へ 500ms で逆走し、蕊 + 節点光点として静的レイヤーへ焼き付ける | 音なし。和音の残響だけを残す |
| 毎フレーム | amp 0..1 | 終演中だけ周辺光が ±8% 脈動 | ─（音→視覚の逆流線はこの 1 本のみ） |

### 4.1 交差・並走・蓄積の反応（velocity の写像）

交叉・並走・複数回の蓄積でリズムや小さな和音的な反応を増やす。**視覚と `ChainEvent.velocity` の調整だけで行い、score 表示や説明カードは作らない。** 音声側の契約（engine.ts / synth-engine.ts）は変えない。velocity は既存どおり 0..1 で、`synth-engine.ts` が音量に反映する既存経路（`0.8 + 0.4 × velocity`）を使う。

| 起きていること | velocity の写像（main.ts 側） | 視覚 |
|---|---|---|
| 基準 | `0.85`（現行の固定値。この値を基点に加算する） | 変化なし |
| 交叉点を通過する板（自道の交差判定。path.ts に追加する交差検出に置く） | `+0.08`（上限 1.0） | 交叉点に節点を置かず蕊を積算しない（濁り対策。第 7.2 節） |
| 直近の確定道と 6px 未満で並走する区間の板 | `+0.08`（上限 1.0） | 並走区間は新しい道のグローを 0 にして蕊だけで描く |
| 同じ床への 2 回目以降の演奏（確定星図が 1 本以上ある状態での連鎖） | 列全体へ `+0.05`（上限 1.0） | intro の眠る星が増える。節点の蓄積そのものが報酬 |
| 上記が重複するときは加算するが上限 1.0 | ─ | 画面は濁さない。変化は音の強さだけ |

判定の置き場所: **交叉検出と並走判定は `path.ts`（純粋関数として追加）**、星図の本数参照は `main.ts`、**velocity への写像は `music.ts` が担う**（板列 + 判定結果から `ChainEvent[]` を組み立てる既存の流れの中で、音程と同じく「音への写像」は music.ts の責務とする）。chain.ts は時刻計算のみのままとし、velocity を触らせない。

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

**契約は本節のとおり不変。** 再設計で変わるのは `velocity` の値の決め方（第 4.1 節の写像を main.ts / music.ts / path.ts で組む）だけで、interface・`window.__art`・`tuning.ts` の既存キーの削除・破壊的変更はしない。

- `NoopAudioEngine.beginChain()` も同じ純粋なタイムライン計算を使い、無音時に視覚の速さが変わらないようにする
- `?mute` では Noop、通常は `SynthAudioEngine`
- `beginChain()` は AudioContext が `running` なら音を先行予約し、未解錠なら視覚だけ同じスケジュールで進める。途中で解錠されても進行済みの音をまとめて鳴らさない
- `getAmp()` は 1 フレームにつき 1 回だけ呼ぶ

## 6. 音響設計

音階は C メジャーペンタ `C D E G A`。`music.ts` に `[0, 2, 4, 7, 9]` と基音 MIDI 60 を置く。各板の進行率をスケール段数へ写し、C4 から E6 まで単調に上昇させる。同じ音が数枚続いてもよいが、音程が逆行しないことを優先する。再設計で音階・和音・時刻の設計は変えない。**変わるのは velocity の入力値だけ**（第 4.1 節）で、velocity は既存の音量写像 `0.8 + 0.4 × velocity` を通る。

| 名前 | 合成方式 | パラメータ写像 |
|---|---|---|
| placeClick | 2ms ノイズ + 900Hz の短いサイン、減衰 35ms | x→pan。速度に依存させず小音量 |
| domino | マリンバ風モーダル合成。サイン部分音比 `1 / 3.98 / 10.65`、減衰 `0.52s / 0.18s / 0.07s` + 4ms のマレットノイズ | midi→基音、進行率→明るさ、x→pan、velocity→音量（第 4.1 節）。終盤は残響を少し増やす |
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

視覚仕様の正本は `art-direction.md`。本節はそれを実装可能な形で転記する。数値は art-direction 第 6 章のとおり ±20% の調整を許容するが、**第 0 章の合成の規律（金は alpha 1.0 で 1 回描き、グロー積算 alpha ≤ 0.12・最大 2 層、混色は照り 1 層の内部のみ、最大輝度は warmWhite 未満）と第 6 章の禁則は調整対象外**。

### 7.1 描画レイヤー（暗い展示室）

下から順に。L0〜L3 は art-direction 第 1 章の床 4 層で、いずれも静的式（画質段が変わっても同じ式）:

1. **L0 床ベタ**: `ink`（`#111318`）で毎フレーム `source-over` 不透明に塗る
2. **L1 冷たい照り**: 画面中心（chain 中は直近 4 枚の倒れた板の重心へスライド）を中心とする放射。`coolGlow`（`#1A1F29`、chain で `warmGlow` `#2A2620` へ t 補間）、半径 = `min(w, h) × 0.55`、中心 alpha 0.5（chain の終盤 0.8）→ 縁 0 の 1 層。縦長画面では縦:横 ≈ 4:3 の楕円
3. **L2 ガイド線**: 間隔 48px（375px では 32px）の格子、`warmWhite` alpha 0.03、線幅 1px。動かさない。等高線（同心円・間隔 64px・alpha 0.025）でもよいが必ずどちらか 1 本。静的キャンバスへ 1 回焼く
4. **確定道の永続レイヤー**: 確定済み星図（蕊 + 節点）。offscreen canvas に保持し毎フレーム 1 回合成。「L2 ガイド線の直上・L3 周辺減光の直下」に置き、以後減衰しない（残光のみ減衰）。旧「静的な光跡レイヤー」の後継
5. **L3 周辺減光**: 四辺へ向かって `ink` alpha 0 → 0.55 の上塗り。長辺方向は短辺より緩く効かせる
6. 現在の板列。2D context の `save/translate/rotate/scale/fillRect` でまとめて描く（床影 → 上面 → 手前側面 → エッジ反射の順。第 7.2 節）
7. 終演光（開花の波・衝撃波・発光パルス）。縮小した glow canvas を CSS で拡大し、芯へ再帰的に焼き込まない。glow 積算は `gold` のみ・同一地点 alpha ≤ 0.12・最大 2 層
8. 導入 UI（下部帯・脇役）/ `?debug` 診断

床影の原則: 影は `ink` alpha 0.5 の 1 回描きで、照りの内側でだけ視認される。方向はスポットライトの逆、offset (3, 4)px。**光源は全状態を通じて不変**（影の方向を状態で変えない）。

### 7.2 板と星図（板の物語性）

板 = ドミノ 1 枚。線に沿って間隔 16px（375px では 12px）で配置。真上俯瞰に擬似 3D を足す。**レンダリング不可マージン: 画面端 24px、下部無視領域 48px**（枠は描かない）。

- **立ち（idle）**: 上面 `warmWhite` alpha 1.0 の矩形・幅 10px（375px では 8px）・奥行 6px（375px では 5px）。周囲 1px を `ink` alpha 0.25 で縁取り。手前側面は幅 2px の帯を `warmWhite` alpha 0.35 で 1 回（多層にしない。明度差が厚みを読ませる）。床影 `ink` alpha 0.5・板+2px・offset (3,4)px。エッジ反射は上面の長辺両端に `warmWhite` alpha 0.4・1px（リング状の縁取りは作らない）
- 倒れ中（falling）: 1 枚 140ms、倒れ角 0 → 90 度を easeInQuad（跳ね返りを作らない。実装の `fallProgress` は cubic 相当で、60 度切替の実測は経過 2/3・cubic 進行度 0.30）。上面の奥行 6px → 線方向 22px（375px では 18px）へ伸び、手前側面の帯は消える。倒れ角 60 度で上面を `warmWhite` → `gold` に 2 値切替（混色して茶色を作らない）。床影の offset を (3,4) → (0,8) へ lerp、着地で alpha 0.5 → 0.15（板自身が光源になり影が消える）
- **倒れた（fallen）**: 上面 `gold` alpha 1.0 の 1 回描き。蕊は板中心線に `gold` alpha 1.0・線幅 1.5px。エッジ反射は立ちと同式（`warmWhite` alpha 0.4・1px。質感が状態で別物にならない）。グローは `gold` alpha 0.08・板+8px の加算 1 層で、着地から 300ms で alpha 0.03 まで減衰し**0.03 を維持**（倒れた板は消灯しない「灯り続ける楽器」。操作結果が絵に残る = taste-guide 合否 5）
- **確定道（星図）**: 蕊 `gold` alpha 1.0・1.5px の 1 回描き。節点は板 1 枚につき `gold` alpha 1.0・半径 2px の円 + alpha 0.3・半径 5px の外殻（加算でなく通常合成の 2 層）。残光は直近 1 回の演奏が確定後 10s かけてグロー alpha 0.03 → 0 へ減衰し、蕊と節点だけが残る。**交叉点では節点を置かず蕊を alpha 積算しない**（通常合成の上書き描き）。**並走（既存蕊と 6px 未満）では新しい道のグローを 0 にして蕊だけで描く**。蓄積の上限は節点 300 個/画面。超えたら古い演奏の残光から消し、蕊は alpha 1.0 → 0.5 に減衰して**消さない**
- 発光: 金の芯とは別レイヤー（第 7.1 節の 7）で扱い、同一地点の積算 alpha は 0.12 以下・最大 2 層。通常時は弱く、finale だけ強める
- 背景には橙〜黄緑の半透明面を置かない。白飛びを避け、どの状態でも最大輝度は `warmWhite` 未満、終演中も墨色が画面面積の 70% 以上残る

### 7.3 レスポンシブと性能

- **375px は独立設計**（1280 の縮小版にしない）。独立スケール表: 板間隔 16→12px、板幅 10→8px、立板の奥行 6→5px、倒れ後の板長 22→18px、描線判定半径 12→22px（指の太さ前提）、パルス半径 18→34px を 14→28px へ、**節点半径 2px は縮小しない**（星図が読めなくなる）。縦長補正: 幅 < 高さのとき板の奥行と倒れ後の長さを 1.2 倍（2 倍にしない。列が崩れるため）
- 375px（375 × 667 想定）の各状態の主役と占有率: intro は床の照りと眠る光の断片（画面上半分 ≈ 55%・文字帯は下 22%）、tracing は指先の仮板列（道は ≈ 70% 横断可・下部 48px 無視領域）、aligned は板列全体（中央 ≈ 50%・明滅する端は 2 枚まで）、chain はパルスの走り（同時 2 枚制限据え置き）、finale は道の開花（衝撃波は縦長の `min(w, h)` で縦に伸びる）、星図は節点 2px 据え置き（近接する道の蕊は alpha 0.8 に下げ混線を防ぐ）
- リサイズ時は正規化座標から現在列と確定星図を再構築する。画面四辺で曲線を直線的に切らず、端から 24px 内側へ入力を clamp する（実装キーは `INPUT_EDGE_INSET_PX`。第 10 節参照）
- 目標 60fps。`P5.disableFriendlyErrors = true`、`createCanvas` 後に `pixelDensity(1)`、`getAmp()` は 1 フレーム 1 回
- 板上限 180、確定節点 300 個。板は 1 つずつ p5 API を呼ばず、2D context へ直接描く
- 床 4 層（L0〜L3）とガイド線は静的キャンバスへ 1 回焼き、リサイズ時だけ再焼きする。明滅する眠る光の断片のみ alpha 合成を毎フレーム行う
- 画質の自動判定（`quality.ts`）は維持するが、再設計で終演スパークルを削除したため判定段は `?debug` 診断表示に載せるだけ。板数、連鎖時間、星図の形は画質で変えない

## 8. Tier 設計とフォールバック

- Tier 1 のみ: 2D canvas + Web Audio + Pointer Events。画像、WebGL、外部 API、パターン層は使わない
- AudioContext 非対応・`?mute`・解錠失敗でも、NoopAudioEngine のスケジュールで視覚作品として最後まで進む
- Convolver の生成に失敗した場合は dry 経路だけで鳴らす
- 画質判定に失敗した場合は最も低い判定段で継続し（再設計で終演スパークルは削除済み。判定段の効き先は第 7.3 節）、入力補正・板・星図は維持する

## 9. 雛形からの作り替え

| ファイル | 雛形 | 光のドミノでの置き換え |
|---|---|---|
| `src/main.ts` | `intro / idle / pressing`、位置で音程を決める波紋 | `intro / tracing / aligned / chain / finale`、補正した道、板列、音側のスケジュールで進む連鎖、永続星図へ全面置換 |
| `src/tuning.ts` | 波紋寿命・半径・個数 | パレット、入力平滑化、板間隔・上限、端ヒット範囲、倒れ時間、190→95ms の加速、160ms の間、星図上限へ置換 |
| `src/audio/engine.ts` | `note()` と `setEnergy()` | `place()`、`align()`、`beginChain()` と `ChainSchedule` へ契約を置換。Noop も同じスケジュールを返す。**契約は不変** |
| `src/audio/synth-engine.ts` | 汎用ベル 1 音 | マリンバ／カリンバ短音、打音バスの hush、低音付き終演和音、音声時刻への先行予約へ置換 |
| `src/music.ts` | x 座標でメジャーペンタを選ぶ | 板の進行率で C4→E6 を単調上昇させる関数、終演和音の音列、**交叉・並走・蓄積判定から velocity を組み立てる写像**へ置換 |
| `src/style.css` / `index.html` | 波紋作品の案内 | 墨色の床、下部帯のタイトルと案内「なぞって、端を押す」へ置換 |
| `src/quality.ts` / `src/art-hook.ts` | 雛形の自動調整と検証契約 | 構造を維持。画質判定は判定段の記録だけを担い（効き先は第 7.3 節）、`window.__art` は常時公開 |

## 10. 調整ノブ

すべて `src/tuning.ts`（音響値は `src/audio/audio-tuning.ts`）へ集約する。既存キーは削除しない。

**ベース定数（初代から引き継いだ既存キー。再設計でも値を変えていない）:**

| 定数 | 初期値 | 効き方 |
|---|---:|---|
| `RAW_POINT_MIN_DISTANCE_PX` | 4 | 小さいほど細かな手ぶれも拾う |
| `RAW_POINT_MIN_INTERVAL_MS` | 16 | 生の入力点の記録間隔（最大約 60Hz） |
| `SMOOTHING_WINDOW_POINTS` | 5 | 大きいほど滑らかだが指への追従が遅れる |
| `DRAG_START_DISTANCE_PX` | 10 | aligned で端以外を押して新列を始める移動距離 |
| `TILE_LENGTH_RATIO` / `_MIN_PX` / `_MAX_PX` | 0.032 / 14 / 24 | 板の長さ = clamp(短辺 × 比, min, max) |
| `TILE_THICKNESS_PX` | 3 | 板の見かけの厚み |
| `DOMINO_SPACING_RATIO` / `_MIN_PX` / `_MAX_PX` | 0.035 / 15 / 25 | 板中心の間隔 = clamp(短辺 × 比, min, max) |
| `MIN_PATH_LENGTH_PX` / `MIN_DOMINOES` | 96 / 8 | 短い誤操作を列にしない境界 |
| `MAX_DOMINOES` | 180 | 1 本の列の上限 |
| `TILE_FADE_IN_MS` | 110 | なぞり中の板が立ち上がる時間 |
| `STROKE_DISCARD_MS` | 240 | 満たない列をフェードで消す時間 |
| `ENDPOINT_HIT_MIN_PX` / `_RATIO` | 44 / 2.5 | 端のヒット範囲 = max(min, 板長 × ratio) |
| `ENDPOINT_FLASH_MS` | 320 | 誤タップ時に端を一度だけ明るくする時間 |
| `FALL_MS` | 140 | 1 枚が倒れる見た目の時間 |
| `CHAIN_FIRST_DELAY_MS` | 80 | 先頭の板が倒れ始めるまでの遅延 |
| `CHAIN_INTERVAL_START_MS` / `_END_MS` | 190 / 95 | 連鎖の加速幅（間隔を easeInQuad で縮める） |
| `CHAIN_DURATION_MIN_MS` / `_MAX_MS` | 1400 / 9000 | 短すぎ・長すぎを防ぐ |
| `FALL_ANGLE_RAD` | 1.48 | 倒れの回転角（約 85 度） |
| `PREFINALE_HUSH_MS` | 160 | 「間」の長さ。最優先の調整点 |
| `FINALE_SETTLE_MS` | 1200 | 終演和音の開始から星図へ確定するまでの時間（`settleAtMs` の算出に使用） |
| `SHOCKWAVE_MS` | 650 | 衝撃波の寿命（§3.5） |
| `MAX_COMMITTED_TRAILS` | 24 | 確定道（星図の 1 単位）の本数上限 |
| `INTRO_FADE_MS` | 300 | 導入オーバーレイの退場時間 |
| `GLOW_CANVAS_DIVISOR` | 6 | グロー縮小キャンバスの縮小率 |
| `GLOW_TILE_ALPHA` / `GLOW_FINALE_ALPHA` | 0.1 / 0.16 | グロー層の立板時・終演時の alpha |
| `GLOW_PULSE_AMPLITUDE` / `HUSH_GLOW_DIM` | 0.08 / 0.6 | 終演の amp 脈動幅と hush 中の光量率 |
| `QUALITY_WINDOW_MS` / `_WARMUP_MS` | 2000 / 3000 | 画質判定の窓とウォームアップ |
| `QUALITY_SLOW_FRAME_MEDIAN_MS` / `_THROTTLE_MAX_VARIATION` | 24 / 0.12 | 画質判定の閾値 |

**legacy キー（コードには残るが本ラウンドの実装では未使用。既存キー保持ルールにより削除しない）:**

| 定数 | 初期値 | 状態 |
|---|---:|---|
| `ALIGN_MS` | 220 | 吸着は視覚即時のため未参照。将来の吸着アニメ用に保持 |
| `ENDPOINT_BLINK_HZ` | 0.9 | aligned の明滅は `ENDPOINT_BLINK_HZ_ALIGNED`（1.2）へ移行済み |
| `FINALE_GLOW_MS` | 650 | 終演の発光は bloom 系定数へ置き換わり未参照 |
| `SPARK_SPEED_MIN_PX_S` / `_MAX_PX_S` | 40 / 170 | 終演スパークルは削除済み（§7.3・§8） |
| `SPARK_LIFE_MIN_MS` / `_MAX_MS` | 450 / 900 | 同上 |
| `PARTICLE_CAP_STEPS` | `[240, 120, 60]` | 画質判定段の配列として quality.ts 初期化にのみ使用（§7.3） |

**再設計で採用した定数（床・照り・板の物体表現・各状態の主役・星図。tuning.ts に実在）:**

| 定数 | 初期値 | 効き方 |
|---|---:|---|
| `MOBILE_BREAKPOINT_PX` | 430 | モバイル判定の境界。密度ノブは短辺 min(w, h) で決める |
| `MOBILE_DOMINO_SPACING_PX` | 12 | モバイルの板中心間隔 |
| `FLOOR_GUIDE_SPACING_PX` / `MOBILE_FLOOR_GUIDE_SPACING_PX` | 48 / 32 | L2 ガイド線の格子間隔 |
| `FLOOR_GUIDE_ALPHA` | 0.03 | 格子線の alpha |
| `FLOOR_GLOW_RADIUS_RATIO` | 0.55 | L1 照りの半径 = `min(w, h) × この値` |
| `FLOOR_GLOW_ALPHA_START` / `_END` | 0.5 / 0.8 | 連鎖進行度 t での照り alpha の補間 |
| `CHAIN_LIGHT_SLIDE_MS` | 500 | 照りの中心が直近 4 枚の重心へ追従する時間 |
| `CHAIN_LIGHT_RECENT_TILES` | 4 | 照りの中心の計算に使う直近の倒れた板数 |
| `VIGNETTE_RADIUS_RATIO` | 0.56 | 周辺減光の半径 = 画面対角 × この値 |
| `VIGNETTE_INNER_RADIUS_RATIO` | 0.18 | 周辺減光の内側開始半径 = 短辺 × この値 |
| `VIGNETTE_MID_STOP` / `VIGNETTE_MID_ALPHA` | 0.72 / 0.12 | 周辺減光の中間ストップ（位置と alpha） |
| `VIGNETTE_EDGE_ALPHA` | 0.68 | 周辺減光の外縁 alpha |
| `TILE_WIDTH_PX` / `TILE_DEPTH_PX` | 10 / 6 | 立板の幅と奥行。375px では 8 / 5 |
| `MOBILE_TILE_WIDTH_PX` / `MOBILE_TILE_DEPTH_PX` | 8 / 5 | モバイルの立板の幅と奥行 |
| `FALLEN_TILE_LENGTH_PX` / `MOBILE_FALLEN_TILE_LENGTH_PX` | 22 / 18 | 倒れ後の板長 |
| `PORTRAIT_SCALE` | 1.2 | 縦長画面の板の奥行・倒れ後長さの倍率 |
| `TILE_SIDE_BAND_ALPHA` | 0.35 | 立板の手前側面の帯の alpha（2px 固定） |
| `TILE_OUTLINE_ALPHA` | 0.25 | 立板の縁取り（1px） |
| `EDGE_REFLECTION_ALPHA` | 0.4 | 板のエッジ反射の alpha（1px 固定） |
| `SHADOW_ALPHA` | 0.5 | 床影の alpha |
| `SHADOW_OFFSET_X_PX` / `SHADOW_OFFSET_Y_PX` | 0 / 8 | 床影の offset（立板は固定）。倒れ中は X = X×(1-p)、Y = Y/2×(1-p) + Y×p へ lerp し着地で (0, 8) |
| `FALLEN_GLOW_ALPHA` / `_REST_ALPHA` | 0.08 / 0.03 | 倒れた板のグローの初期値と維持値 |
| `SLEEPING_LIGHT_COUNT_MIN` / `_MAX` | 12 / 18 | intro の眠る光の断片の個数範囲 |
| `SLEEPING_LIGHT_PERIOD_MIN_MS` / `_MAX_MS` | 4000 / 7000 | 眠る光の明滅周期の範囲 |
| `SLEEPING_LIGHT_RADIUS_MIN_PX` / `_MAX_PX` | 1 / 2 | 眠る光の半径範囲（1 + (index % 3) × (max-min) / 2 の 3 段） |
| `SLEEPING_LIGHT_ALPHA` | 0.5 | 眠る光の core alpha の基準 |
| `SLEEPING_LIGHT_WAVE_AMPLITUDE` | 0.35 | 眠る光の明滅振幅（alpha = min(AWAKEN_LIGHT_ALPHA, 基準 + 振幅×wave + 加算×awaken)） |
| `SLEEPING_LIGHT_AWAKEN_BOOST` | 0.2 | 覚醒時の alpha 加算 |
| `SLEEPING_AWAKEN_MS` | 500 | 覚醒窓。最初の接触からこの間だけ立ち上がる |
| `SLEEPING_LIGHT_GLOW_RADIUS_FACTOR` | 4.5 | 眠る光のグロー半径 = core 半径 × この値 |
| `SLEEPING_GLOW_ALPHA` | 0.05 | 眠る光 1 点あたりのグロー alpha |
| `AWAKEN_LIGHT_ALPHA` | 0.9 | 覚醒時の alpha 上限 |
| `TRACING_TILE_ALPHA` | 0.55 | 仮板列の基本 alpha |
| `TRACING_TILE_HEAD_ALPHA` | 0.9 | 指位置から直近 3 枚の濃さ |
| `TRACING_ECHO_RADIUS_PX` / `_ALPHA` / `_MS` | 6 / 0.15 / 120 | 通過直後の残像の丸 |
| `ENDPOINT_BLINK_HZ_ALIGNED` | 1.2 | aligned の押せる端の明滅周波数。旧 `ENDPOINT_BLINK_HZ`（0.9）は legacy キーとして保持 |
| `ENDPOINT_BLINK_TILES` / `MOBILE_ENDPOINT_BLINK_TILES` | 3 / 2 | 端の強調対象枚数 |
| `ENDPOINT_BLINK_PHASE_STAGGER_MS` | 80 | 端から順に遅らせる明滅の位相差 |
| `PULSE_START_RADIUS_PX` / `_END_RADIUS_PX` | 18 / 34 | 連鎖パルスの拡大幅。375px では 14 / 28 |
| `MOBILE_PULSE_START_RADIUS_PX` / `_END_RADIUS_PX` | 14 / 28 | モバイルの連鎖パルスの拡大幅 |
| `PULSE_MAX_CONCURRENT` | 2 | 同時に存在できるパルス数 |
| `PULSE_ALPHA` | 0.1 | 着地パルスの塗りの alpha（§3.4 の gold alpha 0.10） |
| `NODE_RADIUS_PX` | 2 | 星図の節点半径。375px でも縮小しない |
| `NODE_HALO_RADIUS_PX` / `NODE_HALO_ALPHA` | 5 / 0.3 | 節点の外殻 |
| `MAX_LIVE_NODES` | 300 | 画面あたりの節点上限。超過で古い演奏から残光段階へ落とす（§7.2） |
| `FINALE_BLOOM_DELAY_MS` | 200 | 開花の波の開始遅延（最終板の着地から） |
| `FINALE_BLOOM_MS` | 800 | 道に沿った開花の波の走破時間 |
| `FINALE_BLOOM_CORE_WIDTH_PX` | 3 | 開花中の一時的な蕊の線幅 |
| `FINALE_BLOOM_CORE_ALPHA` | 0.92 | 開花中の蕊（本体の描線）の alpha |
| `FINALE_BLOOM_GLOW_ALPHA` / `_WIDTH_PX` | 0.10 / 24 | 開花の伴走グロー |
| `FINALE_SHOCKWAVE_RADIUS_RATIO` | 0.4 | 衝撃波の最大半径 = `min(w, h) × この値` |
| `FINALE_SHOCKWAVE_ALPHA` | 0.12 | 衝撃波の初期 alpha（線幅 1px 固定） |
| `INTRO_TILE_ALPHA` | 0.42 | 導入画面の休止中の板の alpha |
| `COMMIT_RETRACE_MS` | 500 | 確定の逆走描線（グロー層の走査）の時間 |
| `AFTERGLOW_FADE_MS` | 10000 | 直近演奏の残光が消える時間（「昨日の星」） |
| `TRAIL_CORE_ALPHA_COMMIT` / `_AFTERGLOW` | 1.0 / 0.5 | 確定直後の蕊 alpha と残光段階（節点上限超過後）の蕊 alpha（修正 2 カードで追加） |
| `TRAIL_WIDTH_PX` | 1.5 | 確定道の蕊の線幅。正本 §7.2 の 1.5px への値変更は eng-lead 承認済みの唯一の例外（修正 4 カード） |
| `CROSSING_VELOCITY_BOOST` | 0.08 | 交叉点通過板の velocity 加算 |
| `PARALLEL_VELOCITY_BOOST` | 0.08 | 並走区間板の velocity 加算 |
| `ACCUMULATION_VELOCITY_BOOST` | 0.05 | 2 回目以降の演奏の列全体の velocity 加算 |
| `PARALLEL_RUN_MIN_GAP_PX` | 6 | 並走判定の閾値。この値未満の並走でグロー 0 |
| `IGNORE_BAND_BOTTOM_PX` | 48 | 下部の無視領域 |
| `INPUT_EDGE_INSET_PX` | 24 | 画面端の入力 clamp 幅（§7.2・§7.3 の 24px マージン。正本旧記載の `DRAW_FORBIDDEN_MARGIN_PX` に相当） |

移行メモ: 正本旧 §10 記載の `FINALE_AFTERGLOW_MS`（余韻の静寂）は、実装が bloom 系の時間だけで終演を構成するため採用しない。`TRACING_FOLLOW_DELAY_MS` は仮板列が指へ即時追従（§3.2）のため採用しない。`SLEEPING_LIGHT_RADIUS_PX` / `SLEEPING_LIGHT_ALPHA` は配列型の想定だったが、実装は MIN/MAX 型と「基準値 + 明滅振幅 + 覚醒加算」の合成へ置き換わっている（上の表のとおり）。`SHADOW_OFFSET_PX` は `SHADOW_OFFSET_X_PX` / `_Y_PX` へ分割。`DRAW_FORBIDDEN_MARGIN_PX` は既存の `INPUT_EDGE_INSET_PX` が同一の役割を担うため新設しない。
