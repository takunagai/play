# 星を結ぶ夜 ─ 設計の正本

実装はすべて本書に従い、仕様変更は本書を先に更新する。以下の契約は後工程への指定であり、構想コミットでは未実装。

## 1. 体験の核

感情は「驚き・発見」。長押しで引き寄せ、離すと一星一音の星座になる。
濃紺 `#0B1026` に金 `#FFD27A`、芯のみ `#FFF3D6`。説明文・爆発・外部読み込みはない。
約 0.3 秒でも結果が残り、約 2.7 秒で大きくなり、2 指が独立して二つの結果を作る Tier 1 とする。

## 2. モジュール構成と後工程の担当ファイル

```text
main.ts（入力・星の所有・状態・Canvas2D 描画・共通の星列）
  ├─ tuning.ts（数・時間・半径・色・音響ノブ）
  ├─ quality.ts（既存の自動画質調整）
  ├─ music.ts（既存のメジャーペンタ、位置から音程）
  ├─ art-hook.ts（既存 __art の契約・描画時間）
  └─ audio/engine.ts（factory → StarAudioEngine / 無音実装）
         └─ Web Audio（内部時計・予約・音源・残響・振幅）
```

本書が契約・時刻・定数名の正本。調整値は `src/tuning.ts` へ集約し、実装では「正本は docs/architecture.md」とコメントする。ネットワーク通信・サーバー API・認証・課金・DB の境界はない。

| 工程 | 変更するファイル（作品フォルダ内） | 責務・受け渡し |
|---|---|---|
| 構想 | docs/concept.md、architecture.md、image-order.md、process-log.md、雛形一式 | 設計と初期化のみ。現時点の波紋は完成形でない |
| デザイン | docs/design.md のみ | 375/1280px の構図・星の質感・非言語の導入・トークンを具体化 |
| 素材 | 変更なし | 0 枚を確認、画像生成・課金なし |
| 実装 1（描画） | src/main.ts、src/tuning.ts、src/style.css | 最大 2 指の所有、吸引、星列の確定、線・寿命、導入。音は既存の接点まで。本文の `SequencePlan` に対応したデータと解放処理を main.ts 内で用意 |
| 実装 2（音響） | src/audio/engine.ts、src/main.ts、必要時 src/tuning.ts | 共通星列から予約し、戻る時計を描画へ接続。音源本体は engine.ts 内に実装し、許可されていない synth-engine.ts を改造しない |
| 仕上げ | public/thumbnail.webp、README.md、docs/process-log.md | 実画面のサムネイル、clone〜公開の手順、実測結果と PR 本文の整合 |
| 独立検証・審美・審査 | 原則コード変更なし | 数値と試遊を分離、exact HEAD の証跡を報告 |

雛形の p5 は初期化時には使用中なので固定版を継承する。Canvas2D は p5 の 2D context を直接使う形で成立させ、依存削除や別フレームワーク追加をこのカードから要求しない。`pixelDensity(1)` は createCanvas 後、FES 無効化、直接描画の save/restore を維持。`audio/engine.ts` は既存 `AudioEngine` の基本契約を維持しつつ別の拡張契約を持つため、旧 SynthAudioEngine の型を壊さない。未使用になる旧音源の整理が必要なら lead に対象ファイルの追加許可を返し、勝手に変更しない。

## 3. 状態機械と星の所有

### 全体と個別の状態

入力と状態の正本は main.ts。音側は受けた星列の時刻を管理し、物理や星の選定を行わない。

- 導入 `intro` → 中央を含む画面の pointerdown で配線開始・ゲート非表示 → `collecting`。最初のタップも最低 3 星の小さな報酬にする。pointerup で音声を解錠するまで描画を待たせない。
- 各指: `collecting` → pointerup → `waiting`（解錠待ちのみ）→ `linking` → `holding` → `fading` → `returning` → 解放。
- `window.__art.getState()` は `intro` を最優先、その後 `collecting > waiting > linking > holding > fading > returning > idle` の優先順位で返す。他方の星座が残っていても新しい指で収集できる。
- 解放済み星座は最大 4 個。5 個目の解放時は最古の星座を終了し、その予約・音源・所有を解放する。通常寿命の保証は上限による置換のない場合に適用する。置換数を診断に記録し、無制限の蓄積で報酬を保証したことにはしない。

### 星数・吸引・形

`t` は pointerdown からの経過 ms、`S = min(width, height, 720)` CSS px。

- `N(t) = min(12, 3 + floor(max(0,t) / 300))`。0/300/1200/2700ms で 3/4/7/12 星。pointerup でも式を再評価し rAF の境界ずれを防ぐ。300ms 未満でも 3 星を返す。
- 星座半径の目標 `R(t) = S * (0.10 + 0.14 * min(t/2700,1))`。短辺 375px では約 38〜90px。2.7 秒以降は数・半径を増やさず微かな明滅だけを続ける。
- 背景星プールは 96 個。全星は同じ芯＋暈で描く。所有は未所属／pointerId／constellationId のいずれか一つ。4 星座×12 星＋2 指×12 星でも空きが残る。装飾用星を増やしても所有プールとは混同しない。
- 押下時、近い未所属星を 3 個確保し、80ms 以内に内向き移動と増光を見せる。追加枠は 300ms ごとに近い未所属星から一つ。遠い星しかなければ、近傍へ薄い同質の星を配置して吸引を始め、長距離の飛来待ちを作らない。総数 96 は維持する。
- 移動の追従は指数平滑化（時定数 90ms、dt 上限 50ms）。星を中心一点へ潰さず、捕獲順に位相をずらした不規則な軌道上へ寄せる。隣り合う星の中心間隔は最低 12px を目標にする。
- 指を離した瞬間の位置を固定し、収集した星の並びを角度順（同角度は starId 順）に確定する。始点は最上部の星、以降は時計回りの一本の折れ線。閉路・星座間の線は作らない。星の数を N として線は N−1 本。
- 画面端では星ごとの座標を同じ x/y 境界へ clamp しない。必要時、星群全体を平行移動して 18px の余白へ収め、形を維持。背景の出入りは画面外で処理し、矩形の縁に粒子を列状配置しない。
- 2 指が近接しても再割当しない。3 指目以降はその pointerId を無視し、対応する up も既存 2 指を変更しない。重複 down/up を冪等処理し、touchend と pointerup による二重解放を防ぐ。

### 終了・中断の状態表

| 入力・状態 | 星・描画 | 音・予約 | 再開 |
|---|---|---|---|
| 正常 pointerup（画面外も capture で取得） | 当該所有だけを星座へ移す | 同じ ID を一度だけ予約 | 他指は収集継続 |
| pointercancel / lostpointercapture（正常 up 処理後は無視） | 当該収集だけを静かに 300ms で空へ戻す | 新しい旋律を発火しない | その枠へ次の入力可 |
| blur / visibilitychange hidden | 全収集・星座の所有を解放、rAF 停止 | 全予約を破棄し音源を 30ms で消音、残響も切る | visible 復帰は idle、rAF は一つのみ。過去の音を再生しない |
| resize / orientationchange | 収集を取り消し、既存星座は形を保って画面内へ再投影 | 既存星座の時刻は不変 | 画面寸法・描画キャッシュ更新 |
| 音声が suspended（ページ visible） | 星群は微光で待機、線と星の発音増光を先走らせない | 最大 4 列だけ保持、running で共通起点を確定 | 背景化と違い、解錠後に列を失わず開始 |
| 音声非対応 / start 失敗 / mute | 同じ星列を視覚時計で進める | 発音なし、実振幅は 0 | 診断へ理由、視覚を止めない |
| pagehide / HMR dispose | リスナーと rAF を解除 | ノード・リスナー・context を終了 | 新規初期化時に重複を残さない |

外部 provider・body 読取・非 2xx・quota・課金・返却 API はないため、それらの副作用状態表は適用外。

## 4. 音視覚マッピングと共通時刻

| イベント | 引数 | 視覚反応 | 音響反応 |
|---|---|---|---|
| intro/start | pointerId, x,y | 同質の中央星が収集へ連続して変化 | start を呼ぶが解決は待たない |
| collect/start | pointerId, nowMs | 近い 3 星が直ちに寄り増光 | 発音なし |
| collect/update | t, x,y | 星数・半径・中心位置が追従 | 発音なし、ドローンなし |
| release | sequenceId, 星列 | 確定位置へ落ち着き、開始時刻を待つ | 星列を一度だけ予約、時計を返す |
| step 0 | starId, atMs, midi | 始点だけ短く増光、線はまだ 0 本 | 1 音 |
| step i（i≥1） | 前星/到達星, atMs, midi | 前の音から細線が伸び、atMs に到達星が増光 | 到達星で 1 音。線一本に余分な音を足さない |
| sequence/end | lastAtMs | 2 秒保持→2 秒消退→0.6 秒で空へ戻る | 新規音なし、既発音の余韻のみ |
| cancel / background | id または全体 | 当該所有を返却 | 予約・音源を取り消す |
| frame | amp | 全体フラッシュには使わない | analyser を 1 フレーム 1 回だけ読む |

- 刻み `STEP_MS = 160`。正常稼働時の最初の音は release の約 40ms 後、最初の可聴音と増光の受付上限 120ms。N=4 は 4 音・3 線、最初から最後まで 480ms。N=12 は 12 音・11 線、1760ms。
- 線 i は `at(i−1)` から `at(i)` まで伸び、到達でのみ増光する。音の起点も順序も共通の `SequencePlan` と時計から読む。rAF のたびに note を再発火しない。
- 本書の ms は performance.now() 基準。音側で AudioContext.currentTime へ変換し、利用可能なら getOutputTimestamp、なければ baseLatency 等で可聴時刻を推定する。描画は返された可聴時刻を使い、独自の release+遅延を二重計算しない。
- suspended 中は起点未確定。running になった時点で起点を新たに確定し、音と絵の両方を一緒に遅らせる。音だけ後から一気に追いつかせない。
- mute/非対応では performance 時計の release+40ms を使用し、同じ順序と寿命を維持。`getAmp` を視覚値で偽装しない。

## 5. AudioEngine 契約（実装 2 が接続）

既存 `AudioEngine`（start / isReady / note / setEnergy / getAmp / getDiagnostics）は互換性のため保持する。作品側の factory の戻り値は以下の拡張 `StarAudioEngine` とし、実装を engine.ts 内に閉じる。以下は設計上の型宣言で、現コードの写しではない。

```ts
interface StarStep {
  readonly starId: number;
  readonly x: number; // 0..1
  readonly y: number; // 0..1
  readonly midi: number;
  readonly velocity: number; // 0..1
}
interface SequencePlan {
  readonly id: number; // pointerId とは別の単調増加 ID
  readonly steps: readonly StarStep[]; // 3..12、確定済みの線と同じ順
  readonly releasedAtMs: number;
}
interface SequenceClock {
  readonly mode: "pending" | "audio" | "visual";
  readonly firstAtMs: number | null; // pending のみ null
  readonly stepMs: number; // 160
}
interface StarAudioEngine extends AudioEngine {
  planSequence(plan: SequencePlan): void;
  getSequenceClock(id: number): SequenceClock | null;
  cancelSequence(id: number): void;
  suspend(): void; // 全列・全音源・残響を中断
  dispose(): void; // context と常駐リスナーも解除
}
```

- main は `planSequence` を release ごとに一度だけ呼ぶ。getSequenceClock は副作用なし。pending→audio の変更があるため時計を毎フレーム読み、main 側に古い pending のコピーを保存しない。削除済み ID は null。
- `start()` は最初の操作ハンドラ内で同期的に配線・解錠リスナーを用意し、resume の Promise を待たず戻る。isReady は配線完了であり running の意味ではない。
- pointerup / touchend / click / keydown に常駐の resume リスナーを設置。二つの終了イベントが来ても ID ごとの列は一つ。statechange で running を検知し visible な pending 列だけ開始。ページが hidden なら予約しない。
- 通常の収集には legacy note/setEnergy を使わない。音程は既存 music.ts の noteForPosition(star.x) を使い、SCALE=メジャーペンタ、主音 A3 から 3 オクターブの範囲を継承。音順は音高ソートでなく線の順序とする。
- Noop は AudioContext を作らず視覚時計を返し、全停止メソッドも安全に受ける。start 非対応・失敗は診断へ残し、同じ視覚フォールバックへ。
- 最大 4 列×12 音、最大 48 voice。1 voice あたり最大 3 oscillator。列の置換・cancel では未開始 source も stop/disconnect、終了済み source も冪等に扱う。終了時に disconnect と voice 減算。予約済みノードも上限に含め、無制限の timeout は置かない。
- legacy SynthAudioEngine のファイルは初期化のまま残せるが、最終 factory で旧音源を二重起動しない。拡張契約を旧クラスへ強制して型エラーを cast で消さない。
- `getDiagnostics()` に contextState、isReady、pendingSequences、scheduledNotes、activeVoices、cancelledSequences、lastAudioError を返す。?debug でのみ表示。

## 6. 音響設計

| 要素 | 合成・ノブ | 要件 |
|---|---|---|
| musicBox | sine の基音＋弱い倍音 2 倍/3 倍（比 1:0.18:0.06）、attack 8ms、dry decay 900ms | 小型スピーカーでも聞き取れる中高域。鋭い click・ノイズ源なし |
| spatial | x に対応した stereo pan、最大振幅は中央と端で破綻させない | 2 星座の位置が分かるがモノラルでも体験成立 |
| ambience | 共有の短い残響、tail 上限 1.2 秒、wet 0.18 を初期値 | 外部音声不要。IR を自前生成する場合もノイズを独立した発音レイヤーにしない |
| master | 共有 gain → compressor/limiter → analyser → destination | 最大同時発音でクリップしない。初期 master 0.35、voice peak 0.06 から実測調整 |
| silence | 常時 oscillator / drone / BGM は作らない | 最終 dry+tail 後に振幅が沈み、mute は常時 0 |

2 指だから全体音量を 2 倍にしない。音色・音量は音響工程の実測で調整できるが、音数・順序・同期・上限は維持する。予約された数と実際の発音を区別して記録する。

## 7. ビジュアル・品質・調整ノブ

- 背景は毎フレーム不透明の濃紺で塗り直す。芯は半径 1.4〜2.6 CSS px、吸引・発音時 2.4〜3.6px、暈は半径 8〜14px を初期値とする。低 alpha の暖色を全面へ積算しない。
- 線は芯 0.7〜1px＋淡い暈 2〜3px、太い原色輪なし。intro・収集・解放・余韻の全状態で同じ描画関数を使う。375px でも星座が点の塵にならず、指を離した後に輪郭が読める。
- intro は中央の星群の明滅とごく短い接近運動で誘い、雛形の #gate-text とタイトルの可視文字は style.css で非表示。操作説明を別の場所へ移さない。html の title/meta は作品名として残してよい。
- QualityController は既存のまま接続する。軽量化は暈の層数・背景装飾だけに適用し、収集数・音数・色・寿命・同期は全段階共通。DPR は 1 を基本とし 60fps 目標。
- frameCounter は描画処理の開始/終了で実時間計測。__art の 3 メソッドは debug 無し・intro・無音でも常時公開。

| tuning.ts の定数名 | 設計値 | 意味 |
|---|---|---|
| PALETTE_BACKGROUND / PALETTE_STAR / PALETTE_CORE | #0B1026 / #FFD27A / #FFF3D6 | 背景・星/線・小さい芯 |
| STAR_POOL_SIZE / MAX_POINTERS / MAX_CONSTELLATIONS | 96 / 2 / 4 | 有界な所有 |
| MIN_STARS / MAX_STARS / STAR_ADD_MS | 3 / 12 / 300 | 長さと星数の式 |
| CHARGE_MAX_MS / FOLLOW_TAU_MS | 2700 / 90 | 成長上限・指追従 |
| RADIUS_MIN_RATIO / RADIUS_MAX_RATIO | 0.10 / 0.24 | 短辺基準の半径 |
| FIRST_NOTE_DELAY_MS / STEP_MS | 40 / 160 | 最初の発音・音間隔 |
| HOLD_MS / FADE_MS / RETURN_MS | 2000 / 2000 / 600 | 最終音起点の寿命 |
| MAX_VOICES / NOTE_ATTACK_MS / NOTE_DECAY_MS | 48 / 8 / 900 | 音源の上限・包絡 |

## 8. 30 秒の再現シナリオ

以下の絶対秒は試遊開始基準、細かな許容差は次節。音声が初回タップで running になる環境の例。

| 秒 | 操作 | 観察すること |
|---|---|---|
| 0〜3 | 初期画面を見て中央をタップ | intro と同じ星の質感。3 星の最小報酬と解錠、説明文なし |
| 3.0〜3.3 | 別の位置を押して短辺の 18% なぞり、離す | 4 星。最初の音から 480ms で 4 音・3 線。結果が次の操作時にも残る |
| 6.0〜8.7 | 同じ場所で 2.7 秒保持し、離す | 12 星。短押しより大きい広がり。12 音・11 線が 1760ms で結ばれる |
| 13.0〜14.2 | 離れた 2 点で 2 指同時押下。片方を 1.2 秒で離す | 双方 7 星。解放した 7 星だけが結ばれ、他指の星は所有を維持 |
| 14.2〜15.7 | もう片方を計 2.7 秒まで保持して離す | こちらは 12 星。二つの星座と旋律が別 ID で進む |
| 21〜30 | 観察して再度短く押す | 前の星座は寿命内で保持後静かに消え、空へ戻る。新入力を妨げない |

## 9. 検証基準（設計起点・未実施）

以下を実装前に確認ケースとして採番し、tester は仕様由来と実装後の追加発見を別に数える。本書の全項目は構想時点では未達。自動 verify の pass を楽しさの判定へ読み替えない。

| ID | 入力・測定 | 合格基準 |
|---|---|---|
| ST-01 | 375/1280px の intro と中央タップ | getState=\"intro\" から退出し、可視説明文 0、3 メソッド常設。初回タップも 3 星の報酬 |
| ST-02 | pointerdown の動画/フレーム差分 | 80ms 以内に指方向への移動と増光。静止保持でも動き始める |
| ST-03 | 同じ位置・同じ seed で 300/1200/2700ms 保持 | release の確定星数 4/7/12、線数 3/6/11。時刻入力の境界値は純粋な式で厳密一致、実ブラウザ入力は ±1 フレームとして実際の holdMs を併記 |
| ST-04 | 0.3 秒・短辺 18% の drag | 可視星座が完成し 4 音が出る。速い移動で逃げない。pointerup 後の結果が残る |
| ST-05 | 正常稼働時の release と各ステップ記録 | 最初の可聴 onset/増光まで 120ms 以内。星ごとに onset と到達増光の差 ≤50ms、隣接音 160ms±25ms。予定時刻と実 onset/描画時刻を別に記録 |
| ST-06 | 4/7/12 星の単独解放 | それぞれ 4/7/12 回だけ発音。最初の星は増光のみ、以降 N−1 線。重複イベントや rAF で音を二重化しない |
| ST-07 | 同時 2 指、交差、片指を先に離す、3 指目 | 所有 starId の積集合は空、最大 2 pointer。片方だけ解放、星座間の線なし、3 指目は既存状態に影響しない |
| ST-08 | 最終ステップを tL として無入力 | tL+2000ms まで線を保持、+4000ms で線消失、+4600ms で所有返却（各 ±50ms）。2 秒保持時の線 alpha は完成時の 0.9 倍以上 |
| ST-09 | 初回 touch / visible 中の suspended→running | pointerup/touchend で resume。解決待ちで描画停止なし。pending 星列が running 後も 1 星 1 音で遅延開始し、絵も同じ起点へ合わせる。iPhone 実機は Chromium の CDP 検証と分けて結果を記す |
| ST-10 | ?mute / 音声 API 非対応 | 絵・星数・寿命は同じ、getAmp=0。非対応を診断で区別。偽の振幅を返さない |
| ST-11 | cancel / capture 喪失 / 画面外 up / hidden→visible | 表の取り扱いと一致。cancel で勝手に鳴らない。background 後に古い音が鳴らず rAF は一つ、星の所有漏れなし |
| ST-12 | 5 回以上の解放・長時間保持・2 指反復 | 星プール 96、収集 ≤24、解放済み ≤48、列 ≤4、voice ≤48。古い列の置換と source の解除を診断で確認 |
| ST-13 | 無操作で最終音から 3 秒後 | 新規発音数が増えず、実振幅 <0.001（mute は常に 0）。余韻の録音に clipping がない |
| ST-14 | pnpm check / pnpm verify star-thread | exit 0。errors/404=0、mouse/touch の実振幅がハーネス閾値を超える、375/1280px 横スクロール 0、meanDrawMs <16ms を目標として実値報告 |
| ST-15 | 375/1280px・intro/吸引/解放/余韻のスクショと試遊 | 泥色・白飛び・矩形端の列・太い原色輪なし、全状態で同じ質感。短押し/長押し/2 指の違いと線音の気持ちよさを審美担当が文章で判定。数値 pass と分離 |

音の予定表だけを ST-05/06 の実証としない。音声録音・実 analyser・描画の到達フレーム等、実際の出力と予定表を照合する。iPhone 実機を使えなければ未検証と明記し、CDP タッチの成功で代替済みとしない。

## 10. Tier と構想時点の制約

Tier 1 のみ。Noop は無音時の視覚継続用で、音つき作品の完成判定を免除しない。
現コードは雛形のベル・波紋・可視案内文のままで、上の星座・音響契約・終了処理は未実装。雛形内の固定依存を勝手に更新しない。作品用の最終サムネイルと README の完成記録は仕上げ担当へ渡す。
