# Cloudbreak ─ 制作記録

## Phase 0: アイデア具体化

- 人間のお題「雲の層を突き抜けて、晴れた空に出る」を、長押し中は上昇、離すと慣性後に沈降する一操作へ絞った。
- 抽選値は「カタルシス解放 / 沈黙を破る / 白＋淡色ミニマル / アンビエント・ドローン / メジャーペンタ」をそのまま採用した。
- 毛布、風路、蓋の 3 層について、形、速度、密度、奥行き、和音の開きを別に設計した。最終層だけは明るい色のまま密度を最大にし、フィルターを最も閉じて突破前の緊張を作る。
- 突破時の明るさは白い全面フラッシュではなく、`#7EC8F8` の空と `#FFE3B8` の明るい面が占める面積の増加で作る。朝光を暗い背景へ低 opacity で重ねない。
- 晴天は 4 秒の浮遊を保証し、その後は非押下なら沈降、押下中なら晴天維持とした。高度 0.78 未満まで戻るまで突破を再武装せず、境界での連打を防ぐ。
- 画像は 0 枚と判断した。高度と入力に連続追従する雲は、固定画像より seed 付き 2D canvas の層別生成が適する。
- 雛形を作成し、実装カードが置き換える状態機械、AudioEngine 契約、品質段階、調整ノブを `architecture.md` に固定した。

## Phase 1: 実装

AudioEngine 契約（engine.ts）を先に固め、その後に音響・視覚を接続した。

- `src/audio/`（engine.ts / synth-engine.ts / audio-tuning.ts）: cloudDrone（層別 2〜5 声、cent デチューン＋弱い三角波）、windBed（生成ノイズ→bandpass、2 本の緩い LFO）、pressureTone（C2+G2、pressure で開く）、layerBell（部分音比 1/2/3.01）、clearChord（C3/G3/D4/E4/A4、attack 2.8s）、clearBell（C6/E6＋非整数倍音 2.7）。全 bus → 共有 LPF → dry / 生成 IR Convolver → コンプレッサ → analyser。AudioParam の更新は 33ms で間引き、ramp 60ms で平滑化。
- `src/clouds.ts`: 塊は単位空間の Path2D（毛布＝丸い楕円 5〜8 個、風路＝斜め 12〜24°の筋＋裂け目、蓋＝下端を揃えたドーム）として起動時に 1 回だけ構築し、描画時に setTransform で世界高度→画面へ投影。wrap は画面幅 3 コピーの視野判定で処理。遠景の靄と朝光面だけ offscreen へ焼き、リサイズ・品質変更時に再生成。
- `src/main.ts`: 7 状態の状態機械（intro/drifting/ascending/coasting/descending/breakthrough/clear）、押下開始に最低速度 0.035/s を与える飛行物理、0.78 未満での再武装、上向き境界通過でのみ layerCross。設計の定数（tuning.ts）は architecture.md 第 12 節の値をそのまま採用した。
- 突破の視覚は純白フラッシュでなく、altitude 0.97〜1.02 の smoothstep で雲を画面下へ退かせ、空色と朝光の面積を増やす方式。朝光の帯は clip でなく上端波形＋下方波形から閉じた専用 Path2D で描く。
- つまずき: TS の noUnusedLocals が未読の private フィールド（windBus）を出した。保持する意味が無かったのでフィールド自体を削除し、wire() 内のローカル変数に留めた。

## Phase 2: 検証（pnpm verify）

- `pnpm check`: pass（5 作品）。`pnpm verify cloudbreak`: 全 5 項目 pass、exit 0。
- mouse（1280px・合成 PointerEvent）: maxAmp 0.0417、状態は intro→drifting→(ascending⇄coasting)→breakthrough→clear。touch（375px・CDP タッチ）: maxAmp 0.0489、同じく突破と余韻まで到達した。verify の約 0.3 秒 × 10 回の press でも押下のたびに impulse が与えられ、沈降が追いつかない間は高度が積み上がるため、SSOT の「短い press でも状態が進む」を満たす。
- meanDrawMs: 1280px = 1.28ms、375px = 1.21ms。
- スクリーンショット 4 枚を sharp で色統計判定: 純白 0%（白飛びなし）、泥色（オリーブ/茶）0%、突破後は朝光面 5.5〜7.0%、主要色は #C9D5E8（雲中背景）・#7EC8F8（晴天）・#E8EEF7（雲明部）のパレット内に収まった。
- サムネイルは verify の after-1280.png（突破後の雲海と朝光）から画像準備スクリプトで 1200×630 cover に変換した（生成画像でないため generatedImages へは記録しない）。

## Phase 3: 公開

draft PR で設計と雛形を共有し、マージは人間の判断に委ねる。手元からデプロイしない。
