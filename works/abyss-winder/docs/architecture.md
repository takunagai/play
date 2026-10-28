# 深窓の索 ─ 設計の正本

本書は初回実装と唯一の修正ラウンドR1（A〜F）の実コードへ整合した設計記録。雛形段階の予定APIではない。Gは記録だけを更新し、コード・定数・テスト・依存を変更しない。実装と自動検証の完了は、実機検証や独立した最終判定の完了を意味しない（§11）。

## 1. 体験の核と範囲

「緊張と畏怖」を、錆びた索の途切れない一周と、最終目盛りの0.14秒停止から次拍の閉鎖へ至る手応えで作る。コア操作は巻き取り、契約語彙は「引き寄せと反発」。トーンは「モノクロ＋単色差し」、音は「アコースティック風」・「ドリアン」。抽選より人間のお題を優先する。

Tier 1 だけ。既存のp5インスタンスモード + Canvas 2D / Vite / TypeScript / Web Audioを維持。DB、認証、決済、外部API、CDN、マイク、カメラ、パターン層、追加フレームワーク、保存機能は設けない。生成画像0枚。相対アセットのビルド方式を維持する。

## 2. モジュール構成と担当境界

```text
PointerEvent / performance.now()
    → main.ts（DOM・p5・入力・音響・描画の配線）
        → winding.ts（純粋状態機械・完遂token・共通時刻計算の正本）
            → WindingSnapshot → renderer.ts（Canvas 2D）
            → handlers → main.ts → AudioEngine → synth-engine.ts
        ← getAmp()（1フレーム1回、局所光の微調整）
tuning.ts → 操作・描画・拍の定数
music.ts → ドリアンの相対度数・BASE_MIDI・周波数変換
quality.ts / art-hook.ts → 既存の画質調整と常設検証フック
```

- 状態遷移・押下集合・未完角・完了輪・`ClosureTimeline` / `planClosureTimes` の正本は `winding.ts`。時計は引数として渡し、DOM・p5・Web Audioに依存させない。`main.ts` はエンジンを呼ぶ配線で、状態の正本ではない。
- 純粋状態機械への分離（code N5）は、p5のDOM依存を切り、Nodeの受入テストを成立させるため統合担当が妥当な例外として採用済み。mainへ再結合しない。
- `renderer.ts` はwindingの型を `import type` で読み、snapshotを変更しない。粒子・接触水紋・案内alpha・現在の索長はrenderer自身の演出状態として保持し、入力・音響を直接呼ばない。
- `main.ts` は `src/audio/engine.ts` 経由でのみ音に触る。AudioContextを直接作らない。音量・解錠の成否で完成判定を変えない。
- `onAccepted` の共通予定を音側の `planClosure` へ接続し、返されたfreeze/close時刻との一致を検査する。不一致はdebugの `lastError` へ出す。音側が状態機械の予定を後から書き換える構成ではない。
- 公開予定は `performance.now()` と同じ原点のミリ秒。AudioContextの秒への変換は音側だけ。場の時間 `sceneTimeMs` と拍の原点を混ぜない（§5）。

### R1で反映した境界

| 担当 | 実装・記録 | 検証の範囲 |
|---|---|---|
| A | source個別終了とgroup解放、閉鎖tokenのcleanup | 音源回帰9件。模擬Web Audioで寿命・自然完了・上限・取消・suspendを検査 |
| B | BASE_MIDI相対のAドリアン下降 | 音源回帰3件追加、計12件。3オクターブ・負剰余・下端後を検査 |
| C | 全体中断時の旧pointer失効 | winding既存25件を維持し5件追加、計30件。模擬hidden/blur/resizeのページ配線は別証跡 |
| D | 停止中の索保持・閉鎖への引継ぎ・次索長・画面外垂下 | 実Canvas12件、375/1280px |
| E | 粒子の正規化半径・250ms拍位相 | 実Canvas8件追加、計20件。決定的描画と実rAF計測を区別 |
| F | 上部題名・確定開始案内・introからの索端案内 | 5画面サイズのDOM/Canvas補助検査。独立審美判定は別 |
| G | concept / architecture / READMEの整合のみ | 既存62件と型・build・check・verifyを再実行 |

共有作業場の変更はA〜Gを直列化。後続の独立検証・レビューは同じ最終SHAから行い、本記録で自己承認しない。`process-log.md` は初回段階の履歴として保持し、今回の現状は本書とREADMEを参照する。

## 3. 状態機械と保持する値

```text
intro → idle → winding → aligning → hitstop → closing → settling → idle
                   └→ cancelled → idle
                         ↑
           aligning / hitstop（非表示などによる無効化）
```

| 状態（getState） | 入口・出口 | 表示・入力 |
|---|---|---|
| `intro` | 中央円盤（R+rim内）の押下でidleへ。離上は音声解錠 | 実作品の丸窓・索・索端案内。題名と開始案内は上部。導入押下を巻き取りへ流用しない |
| `idle` | 索端の有効押下でwinding | 索端を白線と曲率で誘う。円外接触にも局所音、進捗0 |
| `winding` | 同pointerの有効一周でaligning。離上・逸脱等でcancelled | 正味角で通過済み目盛りが消え、索が巻かれ、粒子が遠のく |
| `aligning` | 完遂tokenを一度発行、freezeAtMsでhitstop | 受理済み全周の巻き索と垂れ索を保持。停止前の待ちは0以上250ms未満。新しい巻き取り不可 |
| `hitstop` | freezeAtMs〜closeAtMs、論理140ms | 全周索・垂れ索・泡の位相と摩擦を停止、最終目盛りだけ局所発光 |
| `closing` | closeAtMsで同tokenを一回だけcommit。250ms後settling | 青輪を一段閉じ、金属クリック・木胴・ベル。受理済み索を全周の蓄積索へクロスフェード |
| `settling` | closeAtMsから900msでidle、新しい押下を要求 | 魚影が退き、水紋・輪・巻き索を保持。次索が垂れる |
| `cancelled` | 未完角を0へ戻し、全pointer解放から180msでidle | 未完分だけ戻す。全体中断なら旧押下集合を失効するため、欠落releaseを待たない |

状態機械はactivePointerId・押下中ID集合、startAngle・previousAngle・符号付きnetAngle・highWaterAngle、前サンプル位置/時刻、平滑速度、半径誤差の合計と件数、完遂token・pendingTimeline・closedRingCount・ringStartAngles等を保持する。音響cueのgestureIdはmainが採番する。初期化・取消では未完値だけ消し、commit済み輪は残す。

`WindingSnapshot` はstate / progress / speed / accuracy / tipAngle / startAngle / netAngle / beatOriginMs / closedRingCount / ringStartAngles / freezeAtMs / closeAtMs / committedToken / lastRingCloseAtMs / sceneTimeMs / cancelReturn / nextRopeLengthRatioを返す。Rendererは生pointer座標へ索端を引かず、中心・半径・有効な巻き角から形を作る。

## 4. 円周角度の連続追跡・許容差・キャンセル

### 幾何と連続性

- 確定半径は `minEdge = min(width,height)` とし、`R = min(200, minEdge × (minEdge < 480 ? 0.34 : 0.27))` CSS px。中心は画面中央、リム幅は `max(10, round(0.055R))`。入力もrendererの `computeLayout` と同じ幾何を使い、DPRで縮めない。
- 最初の索端は下側（`π/2`）、端のヒット半径28px、半径帯域は `max(24px,0.18R)`。索の描画位置はR−2。
- 時計回りを正とし、`theta = atan2(y-cy,x-cx)`。前後差は `atan2(sin(theta-previous),cos(theta-previous))` で−π..πへ正規化。絶対角やabs(delta)を足さない。
- 有効な端押下だけで開始し、開始角は実際の押下角、最初の差分0。全サンプルが半径帯域内、かつ連続2点の線分と中心の最短距離がR−band以上であること。中心横断の近道を拒否する。
- `getCoalescedEvents()` の取得列を処理し、なければ通常の1イベント。一つでも不正なら残りを加算しない。長い移動を補間しない。
- `abs(delta) > π/8` は取消。250ms超のサンプル間隔かつ角差0.08rad超も取消。静止だけでは失敗にしない。
- 逆走はnetAngleから差し引き、highWaterAngleから0.08rad超戻れば取消。微小手ぶれは許すが往復で進捗を増やさない。
- 完遂は符号付き正味角2π以上・開始位置から28px以内・全経路有効・同pointer。丸め吸収の `LAP_EPS=1e-9` のみで、359度に緩めない。半周ずつ2回・開始点への転送では閉じない。
- 平滑速度0.8〜1.8rad/sと半径精度から次索長比0.30〜0.46を決める。速さで完成角・拍間隔を変えない。長さ比は短辺に対する可視弧長へ写像し、内向きベジェを経て末端は常に画面外へ続く。

### pointerの所有権と中断

- 有効なpointerIdを所有者に固定し、可能ならcanvasでcaptureする。タッチは `touch-action: none`。captureできない合成入力でもwindowリスナーの所有者判定を守る。
- 別pointerのmove/upは進捗に使わない。winding中の別pointerdownは取消し、通常の多指取消では全指release + 180msまで再開しない。所有権を移譲しない。
- 一周前のup、cancel、予期しないlostcapture、帯域外・逆走・跳躍で未完を破棄。押し直すまで加算しない。一周受理後の通常upは許可し、自分の解放後のlostcaptureは所有者照合で無視する。追加入力で二重予約しない。
- blur / hidden / resizeからの `interrupt` は旧所有者と押下集合を失効し、winding / aligning / hitstopの未commit予定を破棄する。既に取消中でも重複通知せず、欠落release待ちを解消する。
- 非表示時はmainからaudio.suspendも呼び、未来予約・摩擦・発音中groupを停止。復帰後は新しい押下から再開し、過去音を一括発火しない。commit後のclosing / settlingの輪は取り消さない。

## 5. 0.14秒と拍の関係（共通時刻契約）

四分音符120 BPM、8分拍 `EIGHTH_MS=250`。巻き取り開始時のbeatOriginMsから一定間隔で下降音を出す。一周成立acceptedAtMsに140ms停止を先に置き、その終端が次の8分拍となるよう `winding.ts` の純関数で計画する。

```ts
const closeAtMs = beatOriginMs
  + Math.ceil((acceptedAtMs + HITSTOP_MS - beatOriginMs) / EIGHTH_MS) * EIGHTH_MS;
const freezeAtMs = closeAtMs - HITSTOP_MS;
```

- HITSTOP_MS=140、aligningは0以上250ms未満、閉鎖は拍グリッド上。停止後に別の次拍待ちを足さない。最終目盛りはfreezeAtMsで整列する。
- mainは受理timelineのfreezeAtMsを同式の不動点としてaudio.planClosureへ渡す。音側の戻りと状態機械の予定の一致を検査し、別timerで140msを足さない。
- 音声有効時はgetOutputTimestampがあれば対応付け、なければcurrentTimeとperformance.nowの同時標本で秒へ変換。閉鎖3声部は同じcontext時刻に予約する。拍lookaheadは50ms、更新はwinding cueを送るdrawに依存するため、常に10〜25ms間隔と保証するものではない。過去拍は飛ばし、一括再生しない。
- 下降列はSCALES["ドリアン"]の相対度数をBASE_MIDI=57（A）から判定する。A5→A2の22音を一度数ずつ下降し、下端後は摩擦・無音程の爪のみ。掴みごとにリセットする。
- 摩擦はdry専用で残響へ送らず、freezeの最大5msランプを停止区間内に置く。ベル等の閉鎖音は別経路で閉鎖後に鳴る。
- `sceneTimeMs` はhitstop中に増やさず、索・泡を固定する。rAF・フレーム計測は継続し、明けたとき140msを一括加算しない。
- 目盛りの拍位相は `(beatTimeMs-beatOriginMs) % EIGHTH_MS`。hitstop中だけbeatTimeMsをfreezeAtMsに固定し、通常・停止後はperformance原点のnowMsを使う。sceneTimeMsの累積停止ぶんを音側の拍へ混入させない。
- mute / AudioContext非対応でもNoop/論理時計は同じ予定を返す。suspend中の視覚予定を解錠後に作り直さない。
- 論理予定140msとrAFの表示量子化を区別する。Eの実rAF補助計測は両幅150msであり、物理出力同期の証明ではない。低fpsに合わせて停止定数を変更しない。

## 6. 音視覚マッピング

| イベント | 視覚反応 | 音響反応 |
|---|---|---|
| 中央の開始タップ | 同じ丸窓のまま上部導入文が200msで退く | resumeを待たず同期配線、短い局所爪音 |
| 索端押下 | 張りと最初の白線、進捗0、索端案内が退く | gestureを開始、小さな爪・摩擦 |
| 円外接触・短いなぞり | 小さい非発光水紋、輪は不変 | 間引き・音量制限した接触音 |
| 有効な前進 | 正味角で目盛り・巻き索・粒子の遠のき | 速度で摩擦と爪の短さを変える |
| 250ms拍 | 60msの小さい非発光整列 | Aドリアンを一度数下降、テンポ一定 |
| 中断・逸脱・逆走 | 未完だけ戻る、達成済みは保持 | 摩擦・未発音予約を消す |
| 一周受理 | 全周索・垂れ索を保持、最終目盛りの予備整列 | 共通timelineで閉鎖音を予約 |
| freezeAtMs | 索と泡を140ms固定、最後の短線が発光 | 摩擦停止 |
| closeAtMs | 青輪一段、受理索から蓄積索へ引継ぎ | クリック・木胴・ベルを同時発音 |
| 閉鎖後 | 輪・索を蓄積、魚影が退き水紋、π/6ずれた次端 | ベルの短い余韻 |
| getAmp | 閉鎖輪の光を小さく補正 | 実analyser測定。完成判定に逆流させない |

## 7. AudioEngine 契約と寿命管理

実装済み契約の正本は `src/audio/engine.ts`。`start(): Promise<void>`、`readonly isReady`、`note(NoteEvent)`、`winding(WindingCue)`、`planClosure(token,acceptedAtMs,beatOriginMs): ClosureTimeline`、`cancelClosure(token)`、`suspend()`、`setEnergy(number)`、`getAmp(): number`、`getDiagnostics()`。

- NoteEventはx/y・midi・velocity。位置だけで音階を上げない。WindingCueはgestureId、phase（start/move/cancel）、progress、speed、accuracy、atMs、beatOriginMs。通常のmoveは1フレーム1回以下で送る。
- ClosureTimelineはtoken・freezeAtMs・closeAtMs。型と拍の式はwinding.tsから共有し、二重定義しない。音側で完成条件を再判定せず、明示planだけで閉鎖を予約する。
- `planClosure` は同tokenに同予定を返す。`cancelClosure` は対応groupを停止・解放する冪等操作。`suspend` は発音中・予約中の全groupと摩擦を停止し、過去拍のバーストを防ぐ。
- R1-Aではsource個別のonendedでそのsourceだけを切断・参照除去し、最後のsource終了時にgroupを解放する。短いノイズで長い木胴・ベルを止めない。
- groupの自然終了・24声上限の追い出し・明示取消は共通disposeGroupへ集約。対応pendingClosuresのtoken、sources、gain、途中ノードを解放する。明示取消は残りsourceを全停止し、隣tokenには作用しない。
- `start` は配線と常駐pointerup/touchend/click/keydown解錠リスナーを同期設置し、resumeを待たない。isReadyは配線済みであってrunning保証ではない。非対応・拒否でも描画を止めない。
- NoopAudioEngine / createAudioEngineを維持し、`?mute` は振幅0で視覚のみ。実音源のgetAmpはanalyserの測定であり、擬似振幅ではない。

## 8. 音響設計

| 声部 | 合成と写像 | 上限・減衰 |
|---|---|---|
| 濡れた索 | ローカルnoise → bandpass → levelGain → freezeGain → dry | 連続bus1、速度で平滑化、停止・cancelで消音 |
| 金属の爪 | 正弦の非整数倍音1/2.37/3.61 + 短いnoise | 拍爪は遅いと60ms・速いと20ms、接触爪65ms。接触は50ms以上間引く |
| 木箱の胴 | 92/138Hzの共鳴2本 + 低域noise励振 | 減衰160ms、source停止180ms |
| 青いベル | A5基音880Hz + 控えめな非整数倍音 | 減衰550ms、source停止600ms、閉鎖のみ |
| マスター | dry/wet → compressor → master → analyser | 最大24 voice group、古い予約から破棄 |

閉鎖3声部は同context時刻。接触音 < 拍爪 < 閉鎖音の序列。爪・閉鎖音の生成IRは0.9秒、wet=0.25であり、source寿命と残響経路の長さを同一視しない。摩擦はwetへ送らず停止区間に尾を残さない。実機聴感・出力同期は未確認。

## 9. ビジュアル・蓄積・性能

- パレットは背景#08152B、金属#56616B、索#8A4F38、水圧輪#43B9D8。白目盛りは非発光。局所の錆を茶色の背景へ拡大しない。
- 索はR−2の円弧と下へ垂れるベジェ。aligning / hitstopで全周・垂れ索を保持し、sceneTimeMs固定でstrokeも止める。closingの250msで蓄積した全周索へ渡す。受理時に計算する次索長で現在の索の張りを変えないようrendererに索長を保持する。
- 次索長比0.30〜0.46は画面内の内向き曲線の可視弧長へ反映し、その先は画面外へ沈む。次端は一周ごとにπ/6移動。閉鎖後+300msから400msで伸びる。
- 粒子baseRadiusは0..1の正規化値、描画時のみ短辺×0.62を乗算。初期・resize・品質180→100→50→180でも決定的な同分布を復元する。sceneTimeMsで奥行き位相を動かす。魚影は意図的な微弱シルエットで、初回閉鎖後に退きガラス水紋が残る。
- 青輪は細い芯と局所ハロー。個別描画は直近6本まで、古い輪は内周の静的等高線へ集約する。ただし状態機械のringStartAngles配列自体は一周ごとに増えるため、全体の記憶量が一定とは主張しない（§11）。
- introも同じrenderer。題名は上部中央26/40px、開始案内は13/14pxの1行「窓に触れて、はじめる」。暗幕なし、索端の「端から、時計回りに一周」は開始前から表示し、掴み後に退く。375/1280のF計測では窓との最短距離4.61/19.35pxで非交差だが、一律6px以上とはしない。
- qualityは粒子180/100/50・魚影3/2/1など装飾密度だけを変える。円周・停止時計・音響予定を変えない。60fpsは目標で、保証ではない。FES停止とcreateCanvas後のpixelDensity(1)を維持。画面揺れ・横スクロール・説明カードなし。

## 10. 調整ノブ

視覚・操作・拍の定数は `src/tuning.ts`。voice/gain・IR等は `synth-engine.ts` 内。導入DOMの大きさ・配置・退場は `src/style.css`、開始copyは `index.html`。定数がすべてtuningだけに存在すると誤読しない。

| 定数名 | 確定値 | 作用 |
|---|---|---|
| WINDOW_RADIUS_RATIO / WINDOW_RADIUS_RATIO_NARROW | 0.27 / 0.34 | 通常/狭幅の円周比率 |
| WINDOW_RADIUS_NARROW_MAX_MIN_EDGE_PX / WINDOW_RADIUS_MAX_PX | 480 / 200 | 狭幅条件（未満）/半径上限 |
| TIP_HIT_RADIUS_PX / ROPE_RADIUS_OFFSET_PX | 28 / 2 | 掴み範囲/巻き位置R−2 |
| RADIAL_BAND_MIN_PX / RADIAL_BAND_RATIO | 24 / 0.18 | 半径許容差 |
| MAX_ANGLE_STEP_RAD / REVERSE_TOLERANCE_RAD | π/8 / 0.08 | 跳躍拒否/逆走の境界 |
| SAMPLE_GAP_MS / GAP_ANGLE_RAD | 250 / 0.08 | 欠落サンプル拒否 |
| EIGHTH_MS / HITSTOP_MS / BEAT_SETTLE_MS | 250 / 140 / 60 | 拍/停止/非発光整列 |
| RING_CLOSE_MS / SETTLE_MS / CANCEL_RETURN_MS | 250 / 900 / 180 | 閉鎖/再開/取消戻り |
| ROPE_LENGTH_MIN_RATIO / ROPE_LENGTH_MAX_RATIO | 0.30 / 0.46 | 次索の可視長比 |
| VISIBLE_RING_CAP | 6 | 個別描画と等高線集約の境界 |
| GUIDE_FADE_MS / TITLE_FONT_SIZE_NARROW_PX / TITLE_FONT_SIZE_PX | 200 / 26 / 40 | 索端案内/Canvas側の題名関連定数。DOM題名はCSSも参照 |

## 11. 受入と段階の区別

30秒の因果シナリオはconceptを正本とする。R1-Gでは変更前winding30件、既存winding30 + audio-lifecycle12 + renderer20 = 62件を実流し成功。既存25件を減らしていない。コマンド・exit・一般verifyの値はREADMEを参照。

1. 完了: fake時計の円周・所有者・token・140ms式の回帰、模擬Web Audioのsource寿命・参照解放・A相対音階、実Canvasの決定的snapshotによる索保持・次索長・粒子・拍位相。実機操作や物理出力の証明ではない。
2. 完了: 直接tsc、作品build、pnpm check（5作品）、一般verifyの5項目。verifyの短いなぞりは局所音・console/network・横スクロール・描画時間の検査であり、一周完成の証明ではない。frame-statsは計測のみで品質の最終合否ではない。
3. 完了: 常設window.__art（getAmp/getState/getFrameStats）、intro、?mute / ?debugの実装、実画面2輪サムネイル。Fでは375×812 / 1280×800に加えて375×667 / 480×800 / 768×1024の導入補助検査を実施。合成一周・模擬中断・rAF補助計測の証跡は担当別に分ける。
4. 実装したが未検証: 実機の指遮蔽・多指・実タブ切替、物理音響の同期・聴感、6輪超・12周・長時間、上記以外の高さ。code N6のringStartAnglesは小さい数値配列で長時間実害未再現のため今回見送り。音声ノード解放の修正と同一視しない。
5. 未着手: R1最終同SHAによる後続の独立テスト・コード/見た目再判定・統合採否。初回判定は別で実施済み。全仕様成功・実機成功とは書かず、draftを維持する。
6. 未着手（範囲外）: 固定4作品を期待する共通テストの修正。初回75成功/1失敗を維持し、人間の基盤PR判断へ返す。作品/rootのlint/test/typecheckスクリプトは未定義で新設しない。Workers poolは対象外で移行しない。
