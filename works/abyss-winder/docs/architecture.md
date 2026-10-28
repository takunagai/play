# 深窓の索 ─ 設計の正本

実装は本書に従い、仕様変更は本書を先に更新する。**本カードでは設計だけを確定し、実行コードは雛形のまま（現在の状態は `intro` / `idle` / `pressing`）。** 以下の状態・契約拡張・定数は後続で実装する仕様であり、現在の実装済みAPIではない。

## 1. 体験の核と範囲

「緊張と畏怖」を、錆びた索の途切れない一周と、最終目盛りの0.14秒停止から次拍の閉鎖へ至る手応えで作る。コア操作は巻き取り、契約語彙は「引き寄せと反発」。トーンは「モノクロ＋単色差し」、音は「アコースティック風」・「ドリアン」。抽選より人間のお題を優先する。

Tier 1 だけ。既存の p5 インスタンスモード + Canvas 2D / Vite / TypeScript / Web Audio を維持する。DB、認証、決済、外部API、CDN、マイク、カメラ、パターン層、追加フレームワーク、保存機能は設けない。

## 2. モジュール構成と担当境界

```text
PointerEvent → main.ts（入力・状態・完遂token・時刻の正本）
                   ├→ renderer.ts（読み取り専用snapshot → Canvas）
                   ├→ AudioEngine → synth-engine.ts（Web Audio）
                   ├← ClosureTimeline（音側で確定した予定時刻）
                   └← getAmp()（1フレーム1回、局所的な光の微調整のみ）
tuning.ts → 操作・描画・拍の定数
music.ts → 雛形のドリアン音階、BASE_MIDI と周波数変換
quality.ts / art-hook.ts → 既存の画質調整と常設検証フック
```

- 状態を書き換えるのは `main.ts` だけ。音量・音声解錠の成否で完成判定を変えない。
- `renderer.ts` は main の型を `import type` で読み、音響や入力を直接呼ばない。
- `main.ts` は `src/audio/engine.ts` 経由で音に触る。AudioContext を直接作らない。
- 時刻はすべて単位を名前で示す。公開予定時刻は `performance.now()` と同じ原点のミリ秒。AudioContext の秒との変換は音側だけで行う。
- 画像0枚。相対パスの既存ビルド方式を維持。ポート・バックエンドの新設なし。

### 後続2枚の担当ファイル

| 段階 | コード（最大3ファイル） | 記録・成果物 | この段階でしないこと |
|---|---|---|---|
| 円周操作・描画 | `src/main.ts`、`src/tuning.ts`、必要なら `src/renderer.ts` | デザイン担当の構図・トークンを本書へ転記。円周判定の回帰テストは作品内 `tests/winding.test.ts` を正本に追加する方針（テストファイルは本番コード3枚とは別）。追加がカード制約と衝突するならleadへ記録し、黙って省略しない | audio契約・音源の変更、完成音とサムネイルの最終化 |
| 音響同期・仕上げ | `src/audio/engine.ts`、`src/audio/synth-engine.ts`、`src/main.ts` の配線だけ | `public/thumbnail.webp` の実画面への置換、`work.json` の生成画像記録、`README.md`・`docs/process-log.md`。画像0枚なので変換なし | 描画の作り直し、music/quality等の無関係な変更 |

デザイン・素材担当はGitや本番コードを変更せず、コメント・添付で渡す。共有作業場のコード変更は上記2段階で直列。独立検証は別checkoutから同じ成果SHAで行う。

## 3. 状態機械と保持する値

```text
intro → idle → winding → aligning → hitstop → closing → settling → idle
                   └→ cancelled → idle
                         ↑
           aligning / hitstop（非表示などによる無効化）
```

| 状態（getState） | 入口・出口 | 表示・入力 |
|---|---|---|
| `intro` | 中央タップの押下でaudio.startと画面開始、同操作の離上は解錠のみ | 雛形と同じ描画方式の丸窓・索。導入押下を巻き取りに流用しない |
| `idle` | 索端の有効押下で `winding` | 一つの索端を短い白線と曲率で誘う。円外の接触にも局所音は返すが進捗0 |
| `winding` | 同じpointerで連続した有効一周なら `aligning`。離上・逸脱等は `cancelled` | 正味の角度で目盛りが戻り、索が窓縁へ巻かれ、粒子が遠のく |
| `aligning` | 完遂tokenを一度だけ発行。予定の `freezeAtMs` で `hitstop` | 最終目盛りだけ未整列。全周を保ち、残りの微小な撚りを整えて拍へ寄せる。0以上250ms未満。新しい巻き取り不可 |
| `hitstop` | `freezeAtMs` から `closeAtMs` まで140ms | 索・泡・摩擦を停止。最後の目盛りだけ局所発光。入力から進捗を増やさない |
| `closing` | `closeAtMs` 到達時に同tokenを一回だけcommit、直後 `settling` | 青輪を一段閉じ、同時に金属クリック・木胴・ベル。カメラは固定 |
| `settling` | 900msで `idle`、新しい押下を要求 | 魚影が退き、水紋・閉鎖輪・巻いた索が残る。次の索端が少し離れて垂れる |
| `cancelled` | 未完の正味角を0に戻し、全pointerが離れて180ms経過したら `idle` | 未完の目盛りだけ静かに戻す。完了済みの輪・索は保持 |

保持する値: `activePointerId`、押下中ID集合、`startAngle`、`previousAngle`、符号付き `netAngle`、`highWaterAngle`、前サンプル位置/時刻、速度平滑値、半径誤差積分、`gestureId`、完遂token、`ClosureTimeline | null`、`closedRingCount`、保持する巻き索の記述。初期化・キャンセルで未完値だけ消す。

`WindingSnapshot` は読み取り専用で state / progress / speed / accuracy / tipAngle / closedRingCount / freezeAtMs / closeAtMs / sceneTimeMs を含める。Rendererは生のpointer座標へ索端を引かず、中心・半径・有効な巻き角から形を作る。

## 4. 円周角度の連続追跡・許容差・キャンセル

### 幾何と連続性

- レイアウト初期値: 中心は画面中央、半径 `R = min(200, 0.27 × min(width,height))` CSS px。導入文・案内は別領域に置き、375pxでも一周を指で描ける大きさにする。最終構図はデザイン担当の2サイズ案を本書に反映してから実装する。
- 索端は最初は窓の下側（角度 `π/2`）。端のヒット半径は28px。円周の半径許容幅は `max(24px, 0.18R)`。CSS座標で判定し、DPRで縮めない。
- 時計回りを正とする。`theta = atan2(y-cy,x-cx)`。前後差は `atan2(sin(theta-previous), cos(theta-previous))` で `-π..π` に正規化する。角度そのものの絶対値や `abs(delta)` を足さない。
- 端を有効に押した時だけ開始。境界付近でヒットしたときも開始角は実際の押下角とし、描画上の端を円周上へ合わせる。最初の差分は0。
- 全サンプルで半径の帯域内を確認する。連続する2点を結ぶ線分の中心からの最短距離も `R-band` 以上とし、中心を横切る近道を拒否する。端点だけ円上でも合格にしない。
- `getCoalescedEvents()` が利用できれば時刻順に処理し、なければ通常の1イベントを処理する。一つでも不正ならそのイベント内の残りも加算しない。
- サンプルの角度跳躍 `abs(delta) > π/8` はキャンセル。長い移動を内部で補間して一周を捏造しない。250ms超のサンプル間隔かつ角差0.08rad超もキャンセル。静止中にイベントが来ないだけでは失敗にしない。
- 逆走は `netAngle += delta` として必ず差し引く。最大到達角 `highWaterAngle` から `0.08rad` を超えて戻ればキャンセル。微小な手ぶれは許すが、正の差分だけを足すラチェットにしない。往復で進捗は増えない。
- 完遂は **符号付き正味角が `2π` 以上**、開始点からの距離が28px以内、全経路が有効、同じpointer、未発行token、のすべてを満たしたときだけ。一周を359度等へ緩める完成角の許容差は設けない。開始点へ戻っただけ・半周ずつ2回・端点だけの転送では閉じない。
- 速さは見た目・目盛り音の減衰へだけ写像し、完成角や拍間隔は変えない。0.8〜1.8rad/sで半径誤差が小さいときの精度値を使い、次の索の可視長を短辺の0.30〜0.46倍へ伸ばす。画面外へ続く曲線自体は常に維持する。

### pointerの所有権と中断

- 最初の有効な `pointerId` を所有者に固定し、可能ならcanvas上でpointer captureする。タッチは `touch-action: none`。合成PointerEventでcaptureできない場合の期待される例外だけを処理し、通常のwindowイベントでも所有者判定を守る。
- 別pointerのmove/upは進捗へ使わない。巻き取り中の別pointerdownは現在の試行をキャンセルし、全指が離れるまで再開しない。所有権を移譲しない。
- 一周前の `pointerup`、`pointercancel`、予期しない `lostpointercapture`、帯域外・逆走・跳躍、window blur、非表示、resizeで未完を破棄する。途中で帯域へ戻っても押し直すまで再加算しない。
- 有効一周成立後の通常 `pointerup` は許可する（途中離しではない）。自分でcaptureを解放した `lostpointercapture` は区別して無視する。`aligning` / `hitstop` 中の `pointercancel`、非表示、blur、resizeは予定を破棄し `cancelled`。それ以外の追加入力で二重予約しない。
- 非表示で保留中の閉鎖を遅れて一括発火しない。音側の予定もtokenで取り消し、復帰後は新しい押下から再開する。完了済み輪はそのまま。

## 5. 0.14秒と拍の関係（共通時刻契約）

四分音符120 BPM、8分拍の間隔 `EIGHTH_MS = 250`。巻き取り開始時の `beatOriginMs` から一定間隔で下降音を出し、速さでテンポを変えない。

一周成立時刻 `acceptedAtMs` に **140msの停止を先に置き、その終端が次の8分拍となる** よう予約する。

```ts
const closeAtMs = beatOriginMs
  + Math.ceil((acceptedAtMs + HITSTOP_MS - beatOriginMs) / EIGHTH_MS) * EIGHTH_MS;
const freezeAtMs = closeAtMs - HITSTOP_MS;
```

`HITSTOP_MS = 140`。したがって `aligning` は0以上250ms未満、停止は常に140ms、閉鎖は拍グリッド上。停止開始後にさらに「次拍待ち」を足して停止を延ばさない。入力受理直後は未整列の最後の目盛りに向けた予備動作とし、最終目盛りが合うのは `freezeAtMs` とする。

- AudioEngine は `planClosure()` でこの時計に対応する予定を返す。mainは返された同じ予定で描画し、140msの別timerを足さない。
- 音声有効時は `getOutputTimestamp()` があれば出力時刻へ対応付け、なければ `currentTime` と `performance.now()` の同時標本で変換する。音側はクリック・木胴・ベルを同じcontext時刻に予約する。lookaheadは50ms以内、10〜25ms間隔。過去の拍を連続再生しない。
- 巻き取り中の下降列は既存 `SCALES["ドリアン"]` と `BASE_MIDI`（A）を使用し、A5からA2まで一度数度ずつ下降する。下端以降は新しい有音程アタックを止め摩擦・無音程の爪だけを続ける。新しい索端の押下で列をリセットし、同一試行中の上昇折返しを避ける。
- freezeで摩擦busとその残響を止める（クリックノイズ回避の最大5msランプを停止区間の内側へ置く）。既存音の長い尾で停止を埋めない。closureのベル残響は別busで閉鎖後のみ許可。
- `sceneTimeMs` は停止中に増やさず、索・泡の位相を固定。通常描画のrAFとフレーム計測は続ける。停止が明けても経過140msぶんを一度にシミュレーションへ加えない。
- mute / AudioContext非対応では同じ式の論理時計をNoop実装が返し、視覚は完全に動く。音声suspend中も視覚予定を作り直さず、解錠後に過去の音をまとめて鳴らさない。
- rAFの実表示はフレームに量子化される。設計予定は140ms、実計測は通常フレーム1枚程度の表示誤差を別記。低fpsを理由に停止時間の定数を変更しない。

## 6. 音視覚マッピング

| イベント | 引数 | 視覚反応 | 音響反応 |
|---|---|---|---|
| 中央の開始タップ | 座標 | 同じ丸窓のまま導入文が退く | 同期配線、解錠を待たない。短い局所爪音 |
| 索端の押下 | gestureId、端の角度 | 張りと最初の白い短線、進捗0 | 小さな金属の爪、摩擦を開始 |
| 円外への接触・短いなぞり | 正規化座標・速度 | 近傍の小さな非発光の水紋、輪は不変 | 音量制限した接触音。一般verifyにも応える |
| 有効な前進 | 正味角・速度・精度 | 白い目盛りが順に戻り、粒子が奥へ、索が円周へ巻かれる | 摩擦の強さと爪音の短さが変化 |
| 8分拍 | 拍番号 | 目盛りの小さな整列（非発光） | ドリアンを一度数下降。速くても拍は一定 |
| 中断・逸脱・逆走 | gestureId・理由 | 未完分だけ静かに戻る | 摩擦・予約音を消す。罰の大音量なし |
| 一周受理 → planClosureの戻り | token・freezeAtMs・closeAtMs | 最終目盛りの予備整列を開始 | 音側が共通予定時刻を返す（音→視覚の時刻フィードバック） |
| 最終目盛り | freezeAtMs | 索と泡が140ms静止、最後の短線だけ発光 | 摩擦と尾を停止 |
| 輪の閉鎖 | token・closeAtMs | 青輪を一段閉じ、水紋をガラスへ残す | 高い金属クリック・木胴・青いベルを同時発音 |
| 閉鎖後 | 輪数・精度 | 巻き索・輪を蓄積、魚影が退き、次端が少しずれて垂れる | ベルの短い余韻のみ |
| getAmp | 振幅0..1 | 閉じる輪の光を小さく補正するだけ | 出力測定、状態判定へ逆流させない |

## 7. AudioEngine 契約

### 現在の雛形（このカードでは変更しない）

`start(): Promise<void>`、`readonly isReady: boolean`、`note(NoteEvent): void`、`setEnergy(number): void`、`getAmp(): number`、`getDiagnostics(): Record<string,string | number | boolean>`。
`NoteEvent` は x / y（0..1）、midi、velocity（0..1）。`NoopAudioEngine` と `createAudioEngine()` を維持し `?mute` を守る。

### 音響カードで追加する型付き契約

```ts
type WindingCue = {
  gestureId: number;
  phase: "start" | "move" | "cancel";
  progress: number;
  speed: number;
  accuracy: number;
  atMs: number;
  beatOriginMs: number;
};
type ClosureTimeline = {
  token: number;
  freezeAtMs: number;
  closeAtMs: number;
};
// 既存AudioEngineへ追加。Noopも同じ論理予定を実装する。
interface WindingAudioContract {
  winding(cue: WindingCue): void;
  planClosure(token: number, acceptedAtMs: number, beatOriginMs: number): ClosureTimeline;
  cancelClosure(token: number): void;
  suspend(): void;
}
```

- `winding` は1フレーム1回以下。音側は受け取った進捗を完成条件に使わず、mainの明示的なplanだけで閉鎖音を予約する。`cancel` は同gestureの摩擦・拍予約をすべて消す。
- `planClosure` は同tokenに同じ予定を返す冪等操作。`cancelClosure` は冪等で、対応tokenの未発音voiceを停止・切断する。他の達成済み輪へ作用しない。
- `suspend` は非表示時の予約・摩擦を止め、再開時の過去音バーストを防ぐ。visibility判定自体と状態遷移はmainの責務。
- `isReady` は配線済みの意味であり、contextがrunningとは限らない。診断にcontextState、voice数、予定token、最終errorを出す。
- `start` は配線と常駐 `pointerup/touchend/click/keydown` 解錠リスナーを同期的に設置し、`resume()` を待たない。初期化拒否・非対応でも描画を止めない。

### 実装1から実装2への接続

実装1は既存 `note` / `setEnergy` で接触音だけを維持し、main内に型付きのcue送出境界と論理 `ClosureTimeline` を作る。`planClosure` の代わりに上の純粋な拍計算を使い、型を偽装した空エンジンを作らない。実装2はその境界を本物の追加契約へ接続し、戻り時刻を使用する。mainの円周判定・rendererは作り替えない。

## 8. 音響設計

| 声部 | 合成と写像 | 上限・減衰 |
|---|---|---|
| 濡れた索 | ローカル生成の短いnoise buffer → bandpass、速度で摩擦ゲインを平滑化 | 連続bus1、停止・cancelで消音 |
| 金属の爪 | 正弦の非整数倍音 + 短い高域noise | 速いと20ms、遅いと60ms。拍/接触の過密発音を50ms以上間引く |
| 木箱の胴 | 低い共鳴2本と短いnoise励振 | 120〜180ms、低音だけに依存せず中域にも輪郭 |
| 青いベル | 正弦基音 + 控えめな非整数倍音 | 基音700〜1400Hzを中心に、閉鎖だけ。余韻600ms以内 |
| マスター | dry/wet → compressor（リミッタ役）→ master gain → analyser | 最大24voice、古い予約から破棄。接触音は閉鎖音より小さく |

同じcontext時刻にクリック・木胴・ベルを鳴らす。音階はwork.jsonと一致させ、位置を横移動しただけで音階が上昇する雛形ロジックを本番の巻き取り音へ持ち込まない。共通の短い残響を使うが、摩擦の尾は停止区間に残さない。`getAmp` は実analyserから読み、ミュート時0。API成功値や擬似振幅を返さない。

## 9. ビジュアル・蓄積・性能

- パレット: `#08152B`背景、`#56616B`金属、`#8A4F38`索、`#43B9D8`水圧輪。目盛りは白の非発光線。錆は索に不透明な局所色で使い、背景に茶色を薄塗りしない。
- 索は円弧と下へ垂れるベジェ曲線。撚り目は弧長に沿う短線。巻かれた長さと可視の垂れ索を別に持ち、pointerへの直線を描かない。
- 粒子は窓を中心とする円形の奥行き空間に配置。画面四辺で止めず画面外で再流入。魚影は少数の暗い曲線で、閉鎖後に静かな水紋へ置き換える。
- 青輪は細い芯と低輝度の局所的にじみ。既存輪は弱く残し、毎回フラッシュさせない。巻いた索も残す。描画する個別輪は直近6本まで、古い輪は消去せず内周の静的な密な等高線へ集約し、記憶量を一定にする。
- 次の索端は前回の開始角から `π/6` だけずれた場所へ垂れる。円周・半径自体は動かさず、つかむ位置の小さな違いだけで継続を誘う。
- `intro` と操作後は同一renderer。375pxと1280pxとも主役の存在感を確保し、案内文を輪の中央へ重ねない。短い案内だけ、スコアや説明カードなし。横スクロールなし、画面揺れなし。
- `quality.ts` を利用し、粒子180 / 100 / 50、魚影3 / 2 / 1など装飾密度だけを下げる。停止時計・円周判定・輪の質感・音のタイミングは変えない。60fps目標、`pixelDensity(1)` はcreateCanvas後、FES停止を維持する。

## 10. 調整ノブ

定数の置き場は `src/tuning.ts`。音源内部のvoice/gain等は `synth-engine.ts` の既存定数領域。新しい設定ファイルや依存は不要。

| 定数名（実装時） | 初期値 | 作用 |
|---|---|---|
| `WINDOW_RADIUS_RATIO` / `WINDOW_RADIUS_MAX_PX` | 0.27 / 200 | 円周の大きさ |
| `TIP_HIT_RADIUS_PX` | 28 | 索端をつかむ範囲 |
| `RADIAL_BAND_MIN_PX` / `RADIAL_BAND_RATIO` | 24 / 0.18 | 半径許容差 |
| `MAX_ANGLE_STEP` | π/8 | サンプル跳躍の拒否 |
| `REVERSE_TOLERANCE_RAD` | 0.08 | 手ぶれと逆走の境界 |
| `SAMPLE_GAP_MS` / `GAP_ANGLE_RAD` | 250 / 0.08 | 長いサンプル欠落の拒否 |
| `EIGHTH_MS` / `HITSTOP_MS` | 250 / 140 | 拍と停止の共通時計 |
| `SETTLE_MS` / `CANCEL_RETURN_MS` | 900 / 180 | 次の索と再試行 |
| `VISIBLE_RING_CAP` | 6 | 個別輪と静的集約の境界 |

## 11. 受入と段階の区別

30秒の因果シナリオは `concept.md` を正本とする。この段階の実行画面は雛形であり、下記は後続で実施する受入項目。

1. 純粋な入力遷移をfake時計で検証: 有効360度で一段だけ、359度では0、角度境界をまたぐ円、半周を離して2回、往復、逆走、中心横断、帯域外からの復帰、跳躍、別pointer、pointercancel/lostcapture、resize/blur/hidden、重複event・重複token。
2. 時刻の各拍位相で `closeAtMs-freezeAtMs=140`、閉鎖は250msグリッド、停止前の待ちは250ms未満、一回だけcommit、停止中の索/泡位相不変、非表示中の予約破棄。音の波形・実画面の同期は音響担当とtesterが別に計測。
3. `pnpm check` と `pnpm verify abyss-winder`。後者の短い操作は局所音と負荷の検査であり、一周完成の証明ではない。専用の円周入力をマウス/実タッチで追加検証し、閉鎖後の蓄積画面も保存する。
4. `window.__art` の getAmp/getState/getFrameStats と `intro`、`?mute` / `?debug`、常駐音声解錠、375〜1280pxの横スクロールなし、console/404なしを維持する。
5. 構想図thumbnailは仕上げ担当が実画面へ置換。見た目とコードの最終判定は後続の独立担当に委ねる。rootにlint/test/typecheck scriptはなく、未実施を成功とは呼ばない。
