# Cloudbreak ─ 設計の正本

**このファイルが実装仕様の正本。実装はすべて本書に従い、仕様変更は必ず本書を先に更新する。**

## 1. 体験の核

- 感情ゴール: カタルシス解放。重い雲の中で緊張を積み、最後の 1 層を越えた瞬間に視界と和音を同時に開く
- コア操作: 沈黙を破る。長押し中は上昇し、離すと慣性で減速してから沈む
- トーン: 白＋淡色ミニマル。雲影 `#6E7B96`、雲明部 `#E8EEF7`、晴天 `#7EC8F8`、朝光 `#FFE3B8`
- 音: C メジャーペンタのアンビエント・ドローン。層ごとに和音の明度を増すが、最終層直前だけ最もこもらせ、突破で急開放する
- 最優先の手応え: 押して 150ms 以内に上昇、雲の相対流、風の開きが同じ方向へ応答し、突破時だけ青空、広い和音、高いベルが揃うこと

迷ったら機能を増やさず、押下への即応、3 層の差、最終層の圧迫、突破後 4 秒の余韻を優先する。得点、収集、説明カード、全面フラッシュは追加しない。

## 2. モジュール構成

```text
works/cloudbreak/
  index.html / src/style.css   canvas、導入ゲート、診断表示
  src/
    main.ts                    状態機械、Pointer Events、飛行物理、描画ループ
    tuning.ts                  パレット、物理、層、時間、描画上限を一元管理
    clouds.ts                  seed 付き雲形状生成、層別パララックス、雲海描画
    music.ts                   C メジャーペンタの音程と層別ボイシング
    quality.ts                 雛形の自動画質判定。品質段を下げるだけ
    art-hook.ts                window.__art 契約。雛形を維持
    audio/
      engine.ts                AudioEngine 契約、Noop、ファクトリ
      synth-engine.ts          Web Audio によるドローン、風、境界ベル、突破和音
      audio-tuning.ts          音量、フィルター、残響、同時発音上限
```

呼び出し関係:

```text
Pointer Events / Space ─→ main.ts ─→ FlightState（高度・速度・押下）
                                      │
                                      ├──→ clouds.ts ─→ 2D canvas 描画
                                      ├──→ music.ts ─→ LayerVoicing / BellNote
                                      ├──→ AudioEngine（下記契約）
                                      ├──→ QualityController ─→ 描画上限だけを選ぶ
                                      └──→ 雲の縁の呼吸 ←── getAmp()
```

状態機械の正本は `main.ts` とし、音側は通知された飛行状態とイベントへ反応するだけにする。`main.ts` は `AudioEngine` 契約以外から Web Audio API に触れない。音から視覚への逆流線は `getAmp()` 1 本だけとする。

## 3. 状態機械と飛行物理

`window.__art.getState()` は次の英字値を返す。

```ts
type State = "intro" | "drifting" | "ascending" | "coasting" | "descending" | "breakthrough" | "clear";
```

```text
intro
  └ 中央の pointerup → drifting

drifting
  ├ primary pointerdown / Space keydown → ascending
  └ 高度 MIN_ALTITUDE で小さく浮遊

ascending
  ├ pointerup / pointercancel / Space keyup / visibilitychange(hidden) → coasting
  ├ LAYER_BOUNDARIES を上向きに通過 → layerCross()（状態維持）
  └ CLEAR_ALTITUDE を上向きに通過し突破が armed → breakthrough

coasting
  ├ pointerdown / Space keydown → ascending
  └ velocity <= 0 → descending

descending
  ├ pointerdown / Space keydown → ascending
  └ altitude <= MIN_ALTITUDE → drifting

breakthrough
  └ BREAKTHROUGH_MS 経過 → clear
clear
  ├ CLEAR_HOLD_MS 未満 → clear
  ├ CLEAR_HOLD_MS 後かつ押下中 → clear
  └ CLEAR_HOLD_MS 後かつ非押下 → descending
```

### 3.1 物理

- `altitude` は `0..1.06`。開始値と下限は `0.04`、雲海の上端は `1.00`
- `velocity` は高度/秒。`ascending` は `+0.48/s²` で加速し `+0.15/s` を上限とする。押し始めには最低 `+0.035/s` を与え、150ms 以内に応答を見せる
- `coasting` は空気抵抗 `0.15/s²` で上向き速度を 0 へ近づける。典型的には 350〜500ms で頂点へ達する
- `descending` は `-0.11/s²` で加速し `-0.10/s` を下限とする。上昇より少し遅くして、戻りを罰にしない
- `breakthrough` の 650ms は高度 `1.00..1.025` を ease-out で進める。`clear` の最初の 4 秒は `1.02 ± 0.008` の低周波浮遊とし、入力による高度変化を止める
- `clear` の 4 秒後、押下中なら `1.02` 近辺を保つ。非押下なら `descending` へ移る
- 高度が `0.78` 未満へ下がった時だけ次の突破を armed にする。境界付近の振動でベルと突破演出を連打しない
- `deltaTime` は 50ms で上限を取り、タブ復帰時の高度飛びを防ぐ。状態時間には `performance.now()` を使う

### 3.2 入力

1. Pointer Events でマウスとタッチを統一し、`isPrimary` の 1 本だけを受ける。`touch-action: none` とし、`setPointerCapture()` で画面外へ出ても release を取る
2. `intro` の中央タップでは `pointerdown` 内で `audio.start()` を呼び、解決を待たず配線する。`pointerup` で導入を閉じて `drifting` へ進む。このタップ自体は上昇量へ数えない
3. 導入後の `pointerdown` で `ascending`、`pointerup` / `pointercancel` / `lostpointercapture` で `coasting`。複数ポインタを同時に加算しない
4. `pointermove` の x 座標は `pan = -1..1` へ平滑化し、風と和音の定位へ最大 0.35 だけ反映する。高度、層境界、成功条件には使わない
5. キーボードでは Space の keydown / keyup を同じ押下へ写像する。repeat は無視する。`keydown` も音声解錠の常駐入口に含める
6. `window.blur` と `document.visibilitychange` で押下を必ず解除し、戻った時に勝手に上昇し続けない
7. 自動検証の約 0.3 秒の「押す、なぞる、離す」でも、上昇ドローンまたは release の風尾が `getAmp() > 0` になるようにする

## 4. 層モデルと状態別表示

層境界は `0.34`、`0.67`、晴天境界 `1.00`。seed 付き PRNG でリサイズ後も同じ構図を再生成し、フレームごとに形を乱数生成しない。

| 層 | 雲の形状生成 | 速度・方向 | 密度・奥行き | 音の開き |
|---|---|---|---|---|
| 毛布 0.04〜0.34 | 5〜8 個の大きな楕円を不規則に重ねた横長塊。裾は平らにせず低い波形 | 遅い水平。遠景 0.10、近景 0.24 画面幅/分 | 遠 50% / 中 35% / 近 15%。隙間 25〜35% | C2/G2、LPF 420Hz |
| 風路 0.34〜0.67 | 斜め 12〜24°の細長い筋、途中で切れる裂け目、小さな wisps | 毛布の約 1.8 倍。遠近で左右を逆にして剪断 | 遠 25% / 中 55% / 近 20%。裂け目 18〜28% | D3/A3 を加え LPF 780Hz |
| 蓋 0.67〜1.00 | 大きなドーム 3〜5 個と細かな前景片。0.85 以降は塊同士を重ねる | ドームは遅く、前景片だけ毛布の 2.2 倍 | 遠 15% / 中 35% / 近 50%。0.85 以降は可視空 8〜14% | E3 を加えるが LPF を 620→260Hz へ閉じる |
| 晴天 1.00〜 | 画面下 38〜46% に連続する雲海。上面は複数周期の波形を合成 | 全体が極低速で横流れ | 近景なし。地平線と上空の余白で奥行きを作る | C3/G3/D4/E4/A4、LPF 4.8kHz、C6/E6 ベル |

各層は雲形状の楕円比、個数、切れ目、方向、パララックス比を別テーブルで持つ。同一の雲 bitmap を拡大・色替えして使い回さない。

### 4.1 描画レイヤー

下から順に描く。

1. 高度連動の不透明背景。雲中は `#6E7B96` から淡い青灰へ、晴天は `#7EC8F8`
2. 遠景雲。通常合成、低コントラスト
3. 中景雲。通常合成。高度に応じて下向きへ流し、上昇感を作る
4. 雲の裂け目と上向きの細い流線。押下中だけ最大 0.22 の明度差で見せる
5. 近景雲。最終層で画面を最も覆うが、輪郭と影を残す
6. 突破後の雲海と朝光。`#FFE3B8` は地平線近くの不透明な明るい面として描き、暗い背景へ低 alpha で重ねない
7. 導入 UI と `?debug` 診断

雲の芯は `#E8EEF7` に近い不透明面、影は `#6E7B96` からの補間で作る。低 alpha の白を何十回も加算して白飛びさせない。突破時は 650ms で前景雲を画面下へ退かせ、空の面積を増やす。純白の全画面矩形、太いリング、画面揺れは使わない。

## 5. 音視覚マッピング

| イベント | 引数 | 視覚反応 | 音響反応 |
|---|---|---|---|
| intro/start | なし | 導入が薄れ、下層雲の流れが見える | AudioContext を配線・解錠。発音はしない |
| lift/start | altitude, pan | 近景雲が下へ動き、細い上向き流線が生まれる | 80ms attack でドローンと風を立ち上げる |
| flight/update | altitude, velocity, layer, pan | 雲の相対速度、裂け目、背景明度を連続更新 | 高度→和音明度、速度→風量、layer→LPF/ボイシング、pan→定位 |
| lift/end | altitude, velocity | 流線が消え、雲の相対移動が慣性で弱まる | 風を 450ms で弱め、ドローンは小音量で残す |
| layer/cross | layer 1 or 2, pan | 境界付近の雲が左右へ 220ms 開き、次の層が覗く | メジャーペンタの境界ベルを 1 音。新しい和音構成音を加える |
| cap/pressure | pressure 0..1 | 前景片と密度が増し、視界が最小になる | LPF 620→260Hz、風の高域を抑え、低い圧力音を増やす |
| breakthrough | pan | 前景雲が下へ退き、青空と朝光が 650ms で現れる | LPF を 180ms で 4.8kHz へ開き、広い和音と C6/E6 ベルを鳴らす |
| clear/float | phase, pan | 雲海が小さく呼吸し、朝光の面がゆっくり移る | 広い和音を保ち、風を弱く開いたままにする |
| 毎フレーム | amp 0..1 | 雲縁の明度を最大 ±4%、朝光面を最大 ±2% 呼吸させる | ─（音→視覚の逆流線はこの 1 本のみ） |

層境界イベントは上向き通過時に各 1 回だけ。下降時はベルを鳴らさず、フィルターとボイシングを連続的に戻す。

## 6. AudioEngine 契約

`src/audio/engine.ts` のファクトリ、Noop、解錠、診断の役割を維持し、作品固有イベントへ置き換える。`start()` はユーザー操作中に同期的に Context 作成と配線まで行い、`resume()` の解決を待たない。

```ts
export interface FlightSample {
  altitude: number;       // 0..1.06
  velocity: number;       // -0.10..0.15 altitude/second
  layer: 0 | 1 | 2 | 3;  // 3 = clear
  pressure: number;       // 最終層内 0..1。それ以外 0
  pan: number;            // -1..1
  isPressing: boolean;
}

export interface LayerCrossEvent {
  layer: 1 | 2;
  altitude: number;
  pan: number;
}

export interface BreakthroughEvent {
  pan: number;
  intensity: number; // 通常 1。将来も 0..1 に clamp
}

export interface AudioEngine {
  start(): Promise<void>;
  readonly isReady: boolean;
  beginLift(sample: FlightSample): void;
  updateFlight(sample: FlightSample): void;
  endLift(sample: FlightSample): void;
  layerCross(event: LayerCrossEvent): void;
  breakthrough(event: BreakthroughEvent): void;
  getAmp(): number;
  getDiagnostics(): Record<string, string | number | boolean>;
}
```

- `beginLift()` は 80ms attack の風とドローンを開始する。未解錠でもノードを予定どおり作り、後から過去イベントをまとめて再生しない
- `updateFlight()` は毎フレーム呼べる。内部で AudioParam を 30Hz 以下に間引き、20〜80ms の ramp で平滑化する
- `endLift()` は風を 450ms で弱める。境界ベルや突破ベルの release は切らない
- `layerCross()` は各上向き境界で 1 回。レイヤー 1 は G5、レイヤー 2 は A5 を基準にし、C メジャーペンタ外へ出さない
- `breakthrough()` は同一 armed 周期で 1 回。広い和音と C6/E6 のベルを共通時刻に schedule する
- `NoopAudioEngine` は全メソッドを安全に受け、視覚の状態時間を変えない。`?mute` でも突破は同じ 650ms で進む
- `getAmp()` は描画ループから 1 フレーム 1 回だけ読む。無音、未対応、`?mute` では 0
- `pointerup` / `touchend` / `click` / `keydown` の常駐解錠リスナーを維持する

## 7. 音響設計

音階は C メジャーペンタ `C D E G A`、半音間隔 `[0, 2, 4, 7, 9]`。雲中の中心を C2/G2、晴天の和音を C3/G3/D4/E4/A4 とする。

| 名前 | 合成方式 | パラメータ写像 |
|---|---|---|
| cloudDrone | サイン + ごく弱い三角波を 2〜5 声、各声を数 cent デチューン | layer→声数と音域、altitude→明度。最終層でも音量を上げすぎない |
| windBed | 生成 white noise → bandpass / lowpass、左右に異なる緩い LFO | 上向き velocity→音量と帯域、pan→定位、pressure→高域減衰 |
| pressureTone | C2 のサイン + G2 の弱い倍音 | pressure→音量 0..小、LPF 620→260Hz。身体的圧力を作るが轟音にしない |
| layerBell | サイン部分音比 `1 / 2 / 3.01`、0.9s 減衰 | layer 1→G5、layer 2→A5、pan→定位。突破ベルより 6dB 以上小さい |
| clearChord | C3/G3/D4/E4/A4 のサイン + 三角波、2.8s attack/release | breakthrough で立ち上げ、clear 中保持、下降で 1.8s fade |
| clearBell | C6 と E6、非整数倍音 `2.7` を少量、2.4s 減衰 | breakthrough で 1 回。intensity→音量、pan は最大 ±0.2 |

配線:

```text
cloudDrone / pressureTone ─→ droneBus ─┐
windBed ───────────────────→ windBus ──┼→ shared LPF → dry / generated Convolver → DynamicsCompressor → master → Analyser → destination
layerBell / clearBell ─────→ bellBus ──┘
clearChord ────────────────────────────┘
```

- 外部音源、外部 IR、外部通信は使わない。残響 IR は起動時に生成する
- 同時発音上限は 20。持続ドローンは 5 声以内、ベルは 6 声以内。超過時は最古の layerBell を 20ms fade し、clearBell は奪わない
- master は十分な headroom を取り、DynamicsCompressor を通す。突破時の和音とベルが重なってもクリップさせない
- 最終層の圧迫は音量増加ではなく LPF の閉鎖と高域風の減衰で作る
- `?mute` では AudioContext を作らず、視覚と入力を同じ状態機械で進める

## 8. 画質の自動調整と性能

雛形の `QualityController` と `quality.ts` の判定式を維持する。`main.ts` は `QualityController(3)` を 1 個持ち、`recordFrame()` を毎フレーム 1 回呼ぶ。品質段は上げ直さず、次だけを段階的に減らす。

| 品質段 | 雲塊上限（遠/中/近） | 前景片上限 | 雲縁の補助面 | 背景バッファ解像度 |
|---:|---:|---:|---:|---:|
| 0 | 28 / 34 / 24 | 42 | 2 層 | 1/2 |
| 1 | 20 / 26 / 16 | 26 | 1 層 | 1/3 |
| 2 | 14 / 18 / 10 | 14 | なし | 1/4 |

- 品質段で高度物理、状態遷移、層境界、雲の主要シルエット、パレット、650ms の突破、4 秒の余韻、音響を変えない
- 全品質段で同じ雲形状データと通常合成の芯を使い、補助面だけを減らす。品質低下で輪郭線や単色ベタへ別物化しない
- `P5.disableFriendlyErrors = true`、`createCanvas` 後に `pixelDensity(1)`。雲は p5 の大量 API 呼び出しを避け、2D context の Path2D と楕円をまとめて描く
- 不変の遠景と朝光は offscreen canvas へ焼き、リサイズ時と品質変更時だけ再生成する。雲配列、Path2D、音声ボイスには上限を置く
- 375px では雲塊の半径を短辺比で決め、近景が細片にならないよう最小 72px。1280px では個数ではなく塊サイズも増やし、疎に見せない
- 雲の有機的輪郭を canvas 四辺で直線的に切らない。中心を画面外 0.35 半径まで流し、画面外で生成・再流入させる
- `prefers-reduced-motion` ではパララックス速度と clear の浮遊幅を 50% にするが、上昇距離、層境界、突破時間、音視覚同期は維持する
- `getAmp()` は 1 フレーム 1 回、デバッグ表示は 6 フレームに 1 回まで。375px〜1280px で横スクロールを出さない

## 9. Tier 1 とフォールバック

- Tier 1 のみ: 2D canvas + Web Audio + Pointer Events。生成画像、WebGL、外部 API、パターン層、マイク、カメラは使わない
- AudioContext 非対応、`?mute`、解錠失敗でも Noop で視覚作品として最後まで進み、再挑戦できる
- Convolver の生成に失敗した場合は dry 経路だけで鳴らす。音響失敗で入力、上昇、突破を止めない
- offscreen canvas または Path2D の構築に失敗した場合は、同じ seed の直接楕円描画へ退避する。単色矩形にはしない
- 端末回転とリサイズでは正規化した高度、速度、状態時間を保持し、雲の位置だけ新しい画面比へ再投影する

## 10. `window.__art` と開発クエリ

`src/art-hook.ts` の interface と `installArtHook()` を変更せず、初期化直後から常時公開する。

```ts
window.__art = {
  getAmp(): number,
  getState(): string,
  getFrameStats(): { frames: number; meanDrawMs: number },
};
```

- 導入中の `getState()` は必ず `"intro"`。それ以外は第 3 節の state 文字列を返す
- `getAmp()` は直近の analyser RMS を 0..1 へ clamp した値。無音なら 0
- `getFrameStats()` は draw 末尾で計測した実値。描画以外の待ち時間を足さない
- `?mute`: `NoopAudioEngine` を選び、AudioContext を作らない。視覚、状態、時間は通常と同一
- `?debug`: state、altitude、velocity、layer、pressure、isPressing、armed、qualityLevel、amp、frames、meanDrawMs、AudioEngine 診断を表示する。デバッグ UI は入力を奪わない

## 11. 雛形資産の扱い

| ファイル | 雛形の役割 | Cloudbreak での方針 |
|---|---|---|
| `src/main.ts` | intro / idle / pressing、Pointer Events、波紋描画 | 7 状態、飛行物理、層イベント、雲描画へ置き換える。導入と検証入力契約は維持 |
| `src/tuning.ts` | パレット、入力、画質定数 | 第 12 節の作品定数へ置き換える |
| `src/music.ts` | 音階と位置→音程 | C メジャーペンタ、層別ボイシング、ベル音程の純粋関数へ置き換える |
| `src/quality.ts` | フレーム中央値と変動係数による段階低下 | 判定式を維持し、雲の上限表だけ作品用にする |
| `src/audio/engine.ts` | interface、Noop、`?mute` ファクトリ | 第 6 節の契約へ置き換える |
| `src/audio/synth-engine.ts` | ベル音源、残響、解錠リスナー | 第 7 節のドローン、風、ベル、突破和音へ置き換える |
| `src/art-hook.ts` | 読み取り専用テストフック | ファイルと interface を維持する |

## 12. 調整ノブ

視覚、入力、状態時間は `src/tuning.ts`、音量と合成値は `src/audio/audio-tuning.ts` へ集約する。初期値は次のとおり。

| 定数 | 初期値 | 効き方 |
|---|---:|---|
| `MIN_ALTITUDE` | `0.04` | 開始・沈降の下限 |
| `CLEAR_ALTITUDE` | `1.00` | 最終層の上端、突破境界 |
| `BREAKTHROUGH_REARM_ALTITUDE` | `0.78` | 再突破を許可する下降高度 |
| `ASCEND_ACCEL_PER_S2` | `0.48` | 押下中の上向き加速度 |
| `ASCEND_MAX_SPEED_PER_S` | `0.15` | 上昇速度上限 |
| `ASCEND_IMPULSE_PER_S` | `0.035` | 押下直後の最小上向き速度 |
| `COAST_DECEL_PER_S2` | `0.15` | release 後の上向き減速 |
| `DESCEND_ACCEL_PER_S2` | `0.11` | 沈降加速度 |
| `DESCEND_MAX_SPEED_PER_S` | `0.10` | 沈降速度上限 |
| `LAYER_BOUNDARIES` | `[0.34, 0.67, 1.00]` | 毛布、風路、蓋、晴天の境界 |
| `CAP_PRESSURE_START` | `0.85` | 最濃・最もこもる区間の開始高度 |
| `BREAKTHROUGH_MS` | `650` | 雲が退き空が開く時間 |
| `CLEAR_HOLD_MS` | `4000` | 入力にかかわらず晴天を保持する余韻 |
| `CLEAR_FLOAT_AMPLITUDE` | `0.008` | 晴天浮遊の高度振幅 |
| `CLEAR_FLOAT_PERIOD_MS` | `5200` | 晴天浮遊の周期 |
| `POINTER_PAN_SMOOTHING` | `0.08` | x 位置から音の定位への追従率 |
| `CLOUD_CAP_STEPS` | 第 8 節の表 | 品質段ごとの遠・中・近の上限 |
| `FOREGROUND_WISP_CAP_STEPS` | `[42, 26, 14]` | 最終層の前景片上限 |
| `PALETTE_CLOUD_SHADOW` | `#6E7B96` | 雲影 |
| `PALETTE_CLOUD_LIGHT` | `#E8EEF7` | 雲の明部 |
| `PALETTE_CLEAR_SKY` | `#7EC8F8` | 晴天の不透明背景 |
| `PALETTE_MORNING_LIGHT` | `#FFE3B8` | 地平線の明るい面 |
| `QUALITY_WINDOW_MS` / `_WARMUP_MS` | `2000 / 3000` | 雛形の品質判定窓とウォームアップ |
| `QUALITY_SLOW_FRAME_MEDIAN_MS` / `_THROTTLE_MAX_VARIATION` | `24 / 0.12` | 雛形の負荷判定閾値 |
