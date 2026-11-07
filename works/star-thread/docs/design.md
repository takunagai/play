# 星を結ぶ夜 ─ ビジュアルデザイン仕様

本書は設計正本（docs/architecture.md）の視覚・反応の数値を具体化したデザイン工程の成果物である。正本との矛盾があれば正本を優先し、本書を合わせて直す。本書の変更対象はこの文書だけ。生成画像は 0 枚、コード・依存の変更は含まない。参照画像は渡されておらず、構想文書の「濃紺の夜空・温かい光点・細い光の糸・小さなオルゴール」という記述を唯一の参照として数値化した。既存の星座名・実在する星座の図形は使わない（解放時の並びは角度順の一本の折れ線）。

カンプは本文中の SVG（375px×812 と 1280px×800 の実寸）で示す。SVG 内の配色・寸法は第 5〜8 章のトークンどおりであり、実装は SVG を写すのではなくトークンを実装言語へ転記する。SVG の座標はカンプ上の例であって、実装は式（N(t)・R(t)・指位置）から計算する。

## 1. デザインの方向（判断の要約）

- **静けさを壊すのは 3 つの遷移だけ**: 星が指へ寄る（吸引）・糸が順に結ばれる（結線）・全体が薄れて空へ戻る（消退）。それ以外の常時アニメーションは背景星の微明滅と保持中の微明滅のみ。爆発・フラッシュ・CRT・ノイズ・太い輪・文字の操作説明は存在しない。
- **質感の単一性**: 導入・収集・結線・保持・消退の全状態で、星は同じ「芯＋暈」の 1 関数、線は同じ「細い芯＋淡い暈」の 1 関数で描く。状態の差は半径・不透明度・動きの 3 パラメータだけ。導入画面と操作後で主役の質感が別物に見える欠陥（審美基準 2）はこの一点で防ぐ。
- **加算合成を禁止する**: 暈・線・星の重ねはすべて source-over。`lighter` 等の加算モードでは暈 3 層＋芯の加重で (255,255,255) に到達する（第 12 章の実測）。背景も毎フレーム不透明の濃紺で 1 回塗りし、テンプレートの半透明の塗り重ね（残像）は使わない。低い不透明度の暖色を全面へ積算しない（正本の規定）。
- **星の大きさは画面寸法に比例しない**: 芯・暈は CSS px の固定値。星座の半径だけが短辺 S に従う。375px では星座半径 90px の円に固定寸法の星が並ぶため、星 1 個の存在感が 1280px より高くなる。これは狙いであり、375px で主役が塵になる欠陥（審美基準 4）を防ぐ方向である。
- **2 指・複数星座は色で区別しない**: すべて同じ金色。区別は位置と寿命だけで行う（パレットを増やさない）。

## 2. カンプ（375px × 812、短辺 S=375）

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="375" height="812" viewBox="0 0 375 812">
  <defs><radialGradient id="h"><stop offset="0" stop-color="#FFD27A" stop-opacity="1"/><stop offset="0.25" stop-color="#FFD27A" stop-opacity="0.68"/><stop offset="0.5" stop-color="#FFD27A" stop-opacity="0.30"/><stop offset="1" stop-color="#FFD27A" stop-opacity="0"/></radialGradient></defs>
<rect width="375" height="812" fill="#0B1026"/>
<circle cx="216.3" cy="164.2" r="1.8" fill="#FFD27A" opacity="0.38"/>
<circle cx="175.8" cy="535.5" r="1.2" fill="#FFD27A" opacity="0.23"/>
<circle cx="112.4" cy="558.4" r="1.2" fill="#FFD27A" opacity="0.39"/>
<circle cx="35" cy="163.1" r="1.1" fill="#FFD27A" opacity="0.35"/>
<circle cx="125.7" cy="514.8" r="1.3" fill="#FFD27A" opacity="0.23"/>
<circle cx="162.7" cy="251" r="1.1" fill="#FFD27A" opacity="0.36"/>
<circle cx="251.5" cy="536.5" r="1.7" fill="#FFD27A" opacity="0.27"/>
<circle cx="144.6" cy="345" r="1.3" fill="#FFD27A" opacity="0.33"/>
<circle cx="12.3" cy="377.6" r="1.4" fill="#FFD27A" opacity="0.26"/>
<circle cx="17.8" cy="568" r="1" fill="#FFD27A" opacity="0.3"/>
<circle cx="64.4" cy="37.4" r="1.1" fill="#FFD27A" opacity="0.19"/>
<circle cx="63.5" cy="552.4" r="1.6" fill="#FFD27A" opacity="0.26"/>
<circle cx="187" cy="703.7" r="1.2" fill="#FFD27A" opacity="0.37"/>
<circle cx="255.3" cy="551.3" r="1" fill="#FFD27A" opacity="0.2"/>
<circle cx="21.4" cy="283.8" r="1.8" fill="#FFD27A" opacity="0.37"/>
<circle cx="307.7" cy="104.1" r="1.6" fill="#FFD27A" opacity="0.35"/>
<circle cx="297.3" cy="637.4" r="1.1" fill="#FFD27A" opacity="0.22"/>
<circle cx="291.4" cy="594.7" r="1.7" fill="#FFD27A" opacity="0.28"/>
<circle cx="325.8" cy="120.4" r="1.8" fill="#FFD27A" opacity="0.37"/>
<circle cx="129.8" cy="63.5" r="1.4" fill="#FFD27A" opacity="0.33"/>
<circle cx="134.4" cy="55.5" r="1.2" fill="#FFD27A" opacity="0.36"/>
<circle cx="42.2" cy="752.3" r="1.2" fill="#FFD27A" opacity="0.22"/>
<circle cx="49.8" cy="787" r="1.7" fill="#FFD27A" opacity="0.25"/>
<circle cx="43.9" cy="527.4" r="1.7" fill="#FFD27A" opacity="0.18"/>
<circle cx="234.7" cy="688.5" r="1.4" fill="#FFD27A" opacity="0.31"/>
<circle cx="295.5" cy="198.9" r="1.2" fill="#FFD27A" opacity="0.33"/>
<circle cx="216.3" cy="164.2" r="5.7" fill="url(#h)" opacity="0.10"/>
<circle cx="216.3" cy="164.2" r="1.8" fill="#FFF3D6" opacity="0.48"/>
<circle cx="251.5" cy="536.5" r="5.5" fill="url(#h)" opacity="0.10"/>
<circle cx="251.5" cy="536.5" r="1.7" fill="#FFF3D6" opacity="0.37"/>
<circle cx="187" cy="703.7" r="4" fill="url(#h)" opacity="0.10"/>
<circle cx="187" cy="703.7" r="1.2" fill="#FFF3D6" opacity="0.47"/>
<circle cx="325.8" cy="120.4" r="5.7" fill="url(#h)" opacity="0.10"/>
<circle cx="325.8" cy="120.4" r="1.8" fill="#FFF3D6" opacity="0.47"/>
<circle cx="201.7" cy="405.1" r="13.3" fill="url(#h)" opacity="0.26"/>
<circle cx="201.7" cy="405.1" r="2.7" fill="#FFF3D6" opacity="1.0"/>
<circle cx="197.6" cy="426.4" r="12.9" fill="url(#h)" opacity="0.26"/>
<circle cx="197.6" cy="426.4" r="2.7" fill="#FFF3D6" opacity="1.0"/>
<circle cx="170.1" cy="417.3" r="12.3" fill="url(#h)" opacity="0.26"/>
<circle cx="170.1" cy="417.3" r="2.5" fill="#FFF3D6" opacity="1.0"/>
<circle cx="173.8" cy="395.9" r="12.3" fill="url(#h)" opacity="0.26"/>
<circle cx="173.8" cy="395.9" r="2.7" fill="#FFF3D6" opacity="1.0"/>
<circle cx="194.8" cy="388.8" r="13.2" fill="url(#h)" opacity="0.26"/>
<circle cx="194.8" cy="388.8" r="2.7" fill="#FFF3D6" opacity="1.0"/>
</svg>
```

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="375" height="812" viewBox="0 0 375 812">
  <defs><radialGradient id="h"><stop offset="0" stop-color="#FFD27A" stop-opacity="1"/><stop offset="0.25" stop-color="#FFD27A" stop-opacity="0.68"/><stop offset="0.5" stop-color="#FFD27A" stop-opacity="0.30"/><stop offset="1" stop-color="#FFD27A" stop-opacity="0"/></radialGradient></defs>
<rect width="375" height="812" fill="#0B1026"/>
<circle cx="62.6" cy="497.8" r="1.1" fill="#FFD27A" opacity="0.34"/>
<circle cx="225.8" cy="314.4" r="1.5" fill="#FFD27A" opacity="0.3"/>
<circle cx="25.3" cy="429.9" r="1.5" fill="#FFD27A" opacity="0.29"/>
<circle cx="322.2" cy="592.4" r="1.3" fill="#FFD27A" opacity="0.23"/>
<circle cx="55.5" cy="651.7" r="1.6" fill="#FFD27A" opacity="0.31"/>
<circle cx="166.8" cy="406.8" r="1.2" fill="#FFD27A" opacity="0.3"/>
<circle cx="61.6" cy="501.9" r="1.5" fill="#FFD27A" opacity="0.33"/>
<circle cx="97.5" cy="82.9" r="1.3" fill="#FFD27A" opacity="0.33"/>
<circle cx="191" cy="602.1" r="1.3" fill="#FFD27A" opacity="0.27"/>
<circle cx="332.2" cy="142.3" r="1.2" fill="#FFD27A" opacity="0.31"/>
<circle cx="234.1" cy="352.8" r="1.4" fill="#FFD27A" opacity="0.28"/>
<circle cx="247.4" cy="713.9" r="1.7" fill="#FFD27A" opacity="0.32"/>
<circle cx="176.9" cy="760.5" r="1.4" fill="#FFD27A" opacity="0.32"/>
<circle cx="318.3" cy="551.3" r="1.3" fill="#FFD27A" opacity="0.34"/>
<circle cx="223.1" cy="734.7" r="1.5" fill="#FFD27A" opacity="0.3"/>
<circle cx="355.8" cy="427.9" r="1.3" fill="#FFD27A" opacity="0.39"/>
<circle cx="345.1" cy="146.2" r="1.1" fill="#FFD27A" opacity="0.37"/>
<circle cx="323.4" cy="314.5" r="1.2" fill="#FFD27A" opacity="0.33"/>
<circle cx="343.7" cy="178.8" r="1.4" fill="#FFD27A" opacity="0.33"/>
<circle cx="88.4" cy="338.6" r="1.1" fill="#FFD27A" opacity="0.29"/>
<circle cx="91.6" cy="73.9" r="1.3" fill="#FFD27A" opacity="0.21"/>
<circle cx="52.2" cy="129.3" r="1.3" fill="#FFD27A" opacity="0.25"/>
<circle cx="268.5" cy="338.2" r="1.2" fill="#FFD27A" opacity="0.22"/>
<circle cx="115.5" cy="598.7" r="1.2" fill="#FFD27A" opacity="0.28"/>
<circle cx="296.4" cy="667.2" r="1.4" fill="#FFD27A" opacity="0.37"/>
<circle cx="238" cy="189.7" r="1.1" fill="#FFD27A" opacity="0.22"/>
<circle cx="62.6" cy="497.8" r="3.6" fill="url(#h)" opacity="0.10"/>
<circle cx="62.6" cy="497.8" r="1.1" fill="#FFF3D6" opacity="0.44000000000000006"/>
<circle cx="61.6" cy="501.9" r="4.8" fill="url(#h)" opacity="0.10"/>
<circle cx="61.6" cy="501.9" r="1.5" fill="#FFF3D6" opacity="0.43000000000000005"/>
<circle cx="176.9" cy="760.5" r="4.3" fill="url(#h)" opacity="0.10"/>
<circle cx="176.9" cy="760.5" r="1.4" fill="#FFF3D6" opacity="0.42000000000000004"/>
<circle cx="343.7" cy="178.8" r="4.3" fill="url(#h)" opacity="0.10"/>
<circle cx="343.7" cy="178.8" r="1.4" fill="#FFF3D6" opacity="0.43000000000000005"/>
<circle cx="216" cy="458" r="14" fill="url(#h)" opacity="0.3"/>
<circle cx="216" cy="458" r="3.2" fill="#FFF3D6" opacity="1.0"/>
<circle cx="190" cy="446" r="13" fill="url(#h)" opacity="0.28"/>
<circle cx="190" cy="446" r="3" fill="#FFF3D6" opacity="1.0"/>
<circle cx="225" cy="487" r="12" fill="url(#h)" opacity="0.27"/>
<circle cx="225" cy="487" r="2.9" fill="#FFF3D6" opacity="1.0"/>
<circle cx="197" cy="505" r="12" fill="url(#h)" opacity="0.26"/>
<circle cx="197" cy="505" r="2.8" fill="#FFF3D6" opacity="1.0"/>
</svg>
```

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="375" height="812" viewBox="0 0 375 812">
  <defs><radialGradient id="h"><stop offset="0" stop-color="#FFD27A" stop-opacity="1"/><stop offset="0.25" stop-color="#FFD27A" stop-opacity="0.68"/><stop offset="0.5" stop-color="#FFD27A" stop-opacity="0.30"/><stop offset="1" stop-color="#FFD27A" stop-opacity="0"/></radialGradient></defs>
<rect width="375" height="812" fill="#0B1026"/>
<circle cx="357.6" cy="371.4" r="1.6" fill="#FFD27A" opacity="0.34"/>
<circle cx="86.3" cy="71.8" r="1.5" fill="#FFD27A" opacity="0.21"/>
<circle cx="145.7" cy="714.6" r="1.7" fill="#FFD27A" opacity="0.21"/>
<circle cx="39.2" cy="186.2" r="1.7" fill="#FFD27A" opacity="0.19"/>
<circle cx="89.9" cy="94.9" r="1.1" fill="#FFD27A" opacity="0.3"/>
<circle cx="75.1" cy="334.3" r="1.6" fill="#FFD27A" opacity="0.34"/>
<circle cx="157.3" cy="632.6" r="1.5" fill="#FFD27A" opacity="0.36"/>
<circle cx="98.4" cy="302.3" r="1.5" fill="#FFD27A" opacity="0.39"/>
<circle cx="229.5" cy="386" r="1.2" fill="#FFD27A" opacity="0.24"/>
<circle cx="86.6" cy="791.2" r="1.7" fill="#FFD27A" opacity="0.38"/>
<circle cx="197.6" cy="571" r="1.2" fill="#FFD27A" opacity="0.29"/>
<circle cx="61.7" cy="342.8" r="1.2" fill="#FFD27A" opacity="0.2"/>
<circle cx="336.4" cy="86.6" r="1.7" fill="#FFD27A" opacity="0.33"/>
<circle cx="42" cy="394.2" r="1.8" fill="#FFD27A" opacity="0.4"/>
<circle cx="210" cy="621.3" r="1.6" fill="#FFD27A" opacity="0.24"/>
<circle cx="149.9" cy="658.6" r="1.4" fill="#FFD27A" opacity="0.34"/>
<circle cx="33" cy="362.3" r="1" fill="#FFD27A" opacity="0.32"/>
<circle cx="319.8" cy="440.4" r="1.5" fill="#FFD27A" opacity="0.32"/>
<circle cx="91.3" cy="315.9" r="1.5" fill="#FFD27A" opacity="0.32"/>
<circle cx="144.9" cy="388.1" r="1.3" fill="#FFD27A" opacity="0.3"/>
<circle cx="250" cy="269.6" r="1.5" fill="#FFD27A" opacity="0.37"/>
<circle cx="200.4" cy="786.5" r="1.2" fill="#FFD27A" opacity="0.38"/>
<circle cx="74.6" cy="297.8" r="1.7" fill="#FFD27A" opacity="0.19"/>
<circle cx="228.1" cy="700.1" r="1.8" fill="#FFD27A" opacity="0.33"/>
<circle cx="132.7" cy="273.2" r="1.5" fill="#FFD27A" opacity="0.19"/>
<circle cx="20" cy="708.3" r="1.5" fill="#FFD27A" opacity="0.22"/>
<circle cx="357.6" cy="371.4" r="5" fill="url(#h)" opacity="0.10"/>
<circle cx="357.6" cy="371.4" r="1.6" fill="#FFF3D6" opacity="0.44000000000000006"/>
<circle cx="157.3" cy="632.6" r="4.7" fill="url(#h)" opacity="0.10"/>
<circle cx="157.3" cy="632.6" r="1.5" fill="#FFF3D6" opacity="0.45999999999999996"/>
<circle cx="336.4" cy="86.6" r="5.3" fill="url(#h)" opacity="0.10"/>
<circle cx="336.4" cy="86.6" r="1.7" fill="#FFF3D6" opacity="0.43000000000000005"/>
<circle cx="91.3" cy="315.9" r="4.7" fill="url(#h)" opacity="0.10"/>
<circle cx="91.3" cy="315.9" r="1.5" fill="#FFF3D6" opacity="0.42000000000000004"/>
<g opacity="1.0"><path d="M 203.5 428.5 L 246.1 471.3" fill="none" stroke="#FFD27A" stroke-width="2.5" stroke-opacity="0.18" stroke-linejoin="round"/><path d="M 203.5 428.5 L 246.1 471.3" fill="none" stroke="#FFD27A" stroke-width="0.8" stroke-opacity="0.85" stroke-linejoin="round"/></g>
<g><path d="M 246.1 471.3 L 230.5 486.8" fill="none" stroke="#FFD27A" stroke-width="2.5" stroke-opacity="0.18"/><path d="M 246.1 471.3 L 230.5 486.8" fill="none" stroke="#FFD27A" stroke-width="0.8" stroke-opacity="0.85"/></g>
<circle cx="230.5" cy="486.8" r="11" fill="url(#h)" opacity="0.3"/>
<circle cx="230.5" cy="486.8" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="203.5" cy="428.5" r="14" fill="url(#h)" opacity="0.32"/>
<circle cx="203.5" cy="428.5" r="3.4" fill="#FFF3D6" opacity="1.0"/>
<circle cx="246.1" cy="471.3" r="14" fill="url(#h)" opacity="0.32"/>
<circle cx="246.1" cy="471.3" r="3.4" fill="#FFF3D6" opacity="1.0"/>
<circle cx="204.7" cy="512.6" r="12" fill="url(#h)" opacity="0.24"/>
<circle cx="204.7" cy="512.6" r="2.8" fill="#FFF3D6" opacity="1.0"/>
<circle cx="161.8" cy="474" r="11" fill="url(#h)" opacity="0.22"/>
<circle cx="161.8" cy="474" r="2.6" fill="#FFF3D6" opacity="1.0"/>
</svg>
```

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="375" height="812" viewBox="0 0 375 812">
  <defs><radialGradient id="h"><stop offset="0" stop-color="#FFD27A" stop-opacity="1"/><stop offset="0.25" stop-color="#FFD27A" stop-opacity="0.68"/><stop offset="0.5" stop-color="#FFD27A" stop-opacity="0.30"/><stop offset="1" stop-color="#FFD27A" stop-opacity="0"/></radialGradient></defs>
<rect width="375" height="812" fill="#0B1026"/>
<circle cx="350.8" cy="700.5" r="1.6" fill="#FFD27A" opacity="0.23"/>
<circle cx="127.4" cy="575.3" r="1.6" fill="#FFD27A" opacity="0.18"/>
<circle cx="69.2" cy="719.2" r="1.1" fill="#FFD27A" opacity="0.32"/>
<circle cx="127" cy="521.2" r="1.7" fill="#FFD27A" opacity="0.31"/>
<circle cx="148.9" cy="265.3" r="1.5" fill="#FFD27A" opacity="0.32"/>
<circle cx="155.4" cy="379.3" r="1.4" fill="#FFD27A" opacity="0.24"/>
<circle cx="73.8" cy="460.3" r="1.1" fill="#FFD27A" opacity="0.31"/>
<circle cx="294.6" cy="665.8" r="1.2" fill="#FFD27A" opacity="0.27"/>
<circle cx="337.8" cy="287.1" r="1.8" fill="#FFD27A" opacity="0.22"/>
<circle cx="308.5" cy="42.4" r="1.5" fill="#FFD27A" opacity="0.36"/>
<circle cx="204.4" cy="511.1" r="1.7" fill="#FFD27A" opacity="0.4"/>
<circle cx="73.7" cy="424" r="1" fill="#FFD27A" opacity="0.26"/>
<circle cx="61.5" cy="136.9" r="1.5" fill="#FFD27A" opacity="0.2"/>
<circle cx="64.7" cy="17.8" r="1.7" fill="#FFD27A" opacity="0.23"/>
<circle cx="35.7" cy="501.8" r="1.6" fill="#FFD27A" opacity="0.32"/>
<circle cx="265.5" cy="255.7" r="1.7" fill="#FFD27A" opacity="0.33"/>
<circle cx="314.7" cy="715.3" r="1.7" fill="#FFD27A" opacity="0.29"/>
<circle cx="195.4" cy="591.1" r="1.5" fill="#FFD27A" opacity="0.19"/>
<circle cx="335.5" cy="167.7" r="1.4" fill="#FFD27A" opacity="0.28"/>
<circle cx="43.1" cy="468" r="1.5" fill="#FFD27A" opacity="0.36"/>
<circle cx="227.3" cy="252.8" r="1.5" fill="#FFD27A" opacity="0.39"/>
<circle cx="236" cy="678.3" r="1" fill="#FFD27A" opacity="0.33"/>
<circle cx="85" cy="138.9" r="1.3" fill="#FFD27A" opacity="0.22"/>
<circle cx="40.4" cy="177.1" r="1.2" fill="#FFD27A" opacity="0.23"/>
<circle cx="350.8" cy="700.5" r="5.1" fill="url(#h)" opacity="0.10"/>
<circle cx="350.8" cy="700.5" r="1.6" fill="#FFF3D6" opacity="0.33"/>
<circle cx="73.8" cy="460.3" r="3.5" fill="url(#h)" opacity="0.10"/>
<circle cx="73.8" cy="460.3" r="1.1" fill="#FFF3D6" opacity="0.41000000000000003"/>
<circle cx="61.5" cy="136.9" r="4.8" fill="url(#h)" opacity="0.10"/>
<circle cx="61.5" cy="136.9" r="1.5" fill="#FFF3D6" opacity="0.30000000000000004"/>
<circle cx="335.5" cy="167.7" r="4.4" fill="url(#h)" opacity="0.10"/>
<circle cx="335.5" cy="167.7" r="1.4" fill="#FFF3D6" opacity="0.38"/>
<g opacity="1.0"><path d="M 189.1 339.4 L 241.5 356.7 L 268.8 384.7 L 279.9 424.1 L 269.4 478.8 L 240.2 502.1 L 198 523 L 144.5 501.9 L 103.3 469 L 98.8 427.1 L 113.7 393 L 147.8 355.9" fill="none" stroke="#FFD27A" stroke-width="2.5" stroke-opacity="0.18" stroke-linejoin="round"/><path d="M 189.1 339.4 L 241.5 356.7 L 268.8 384.7 L 279.9 424.1 L 269.4 478.8 L 240.2 502.1 L 198 523 L 144.5 501.9 L 103.3 469 L 98.8 427.1 L 113.7 393 L 147.8 355.9" fill="none" stroke="#FFD27A" stroke-width="0.8" stroke-opacity="0.85" stroke-linejoin="round"/></g>
<circle cx="189.1" cy="339.4" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="189.1" cy="339.4" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="241.5" cy="356.7" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="241.5" cy="356.7" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="268.8" cy="384.7" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="268.8" cy="384.7" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="279.9" cy="424.1" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="279.9" cy="424.1" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="269.4" cy="478.8" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="269.4" cy="478.8" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="240.2" cy="502.1" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="240.2" cy="502.1" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="198" cy="523" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="198" cy="523" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="144.5" cy="501.9" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="144.5" cy="501.9" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="103.3" cy="469" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="103.3" cy="469" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="98.8" cy="427.1" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="98.8" cy="427.1" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="113.7" cy="393" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="113.7" cy="393" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="147.8" cy="355.9" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="147.8" cy="355.9" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<g opacity="0.9"><path d="M 294.8 130.9 L 336.4 176.4 L 299.4 217.4 L 250.1 177.1" fill="none" stroke="#FFD27A" stroke-width="2.5" stroke-opacity="0.18" stroke-linejoin="round"/><path d="M 294.8 130.9 L 336.4 176.4 L 299.4 217.4 L 250.1 177.1" fill="none" stroke="#FFD27A" stroke-width="0.8" stroke-opacity="0.85" stroke-linejoin="round"/></g>
<circle cx="294.8" cy="130.9" r="11" fill="url(#h)" opacity="0.2"/>
<circle cx="294.8" cy="130.9" r="2.4" fill="#FFF3D6" opacity="0.95"/>
<circle cx="336.4" cy="176.4" r="11" fill="url(#h)" opacity="0.2"/>
<circle cx="336.4" cy="176.4" r="2.4" fill="#FFF3D6" opacity="0.95"/>
<circle cx="299.4" cy="217.4" r="11" fill="url(#h)" opacity="0.2"/>
<circle cx="299.4" cy="217.4" r="2.4" fill="#FFF3D6" opacity="0.95"/>
<circle cx="250.1" cy="177.1" r="11" fill="url(#h)" opacity="0.2"/>
<circle cx="250.1" cy="177.1" r="2.4" fill="#FFF3D6" opacity="0.95"/>
</svg>
```

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="375" height="812" viewBox="0 0 375 812">
  <defs><radialGradient id="h"><stop offset="0" stop-color="#FFD27A" stop-opacity="1"/><stop offset="0.25" stop-color="#FFD27A" stop-opacity="0.68"/><stop offset="0.5" stop-color="#FFD27A" stop-opacity="0.30"/><stop offset="1" stop-color="#FFD27A" stop-opacity="0"/></radialGradient></defs>
<rect width="375" height="812" fill="#0B1026"/>
<circle cx="321.7" cy="286.5" r="1.6" fill="#FFD27A" opacity="0.39"/>
<circle cx="120.8" cy="618.5" r="1.3" fill="#FFD27A" opacity="0.22"/>
<circle cx="133.6" cy="605" r="1.1" fill="#FFD27A" opacity="0.33"/>
<circle cx="134.7" cy="143.9" r="1.3" fill="#FFD27A" opacity="0.27"/>
<circle cx="173.4" cy="707.9" r="1.7" fill="#FFD27A" opacity="0.23"/>
<circle cx="360.7" cy="494.7" r="1.8" fill="#FFD27A" opacity="0.36"/>
<circle cx="196.6" cy="208.7" r="1.7" fill="#FFD27A" opacity="0.4"/>
<circle cx="231.8" cy="102.2" r="1.7" fill="#FFD27A" opacity="0.35"/>
<circle cx="322.3" cy="783.2" r="1.8" fill="#FFD27A" opacity="0.34"/>
<circle cx="149.3" cy="431.5" r="1.4" fill="#FFD27A" opacity="0.35"/>
<circle cx="232.3" cy="664.3" r="1.4" fill="#FFD27A" opacity="0.31"/>
<circle cx="352.1" cy="637.1" r="1.7" fill="#FFD27A" opacity="0.33"/>
<circle cx="54.1" cy="341.8" r="1.2" fill="#FFD27A" opacity="0.24"/>
<circle cx="55.1" cy="97.5" r="1.4" fill="#FFD27A" opacity="0.35"/>
<circle cx="317.9" cy="776.3" r="1.5" fill="#FFD27A" opacity="0.18"/>
<circle cx="77.9" cy="55.3" r="1.7" fill="#FFD27A" opacity="0.25"/>
<circle cx="266.9" cy="367.4" r="1.5" fill="#FFD27A" opacity="0.37"/>
<circle cx="243.3" cy="69.3" r="1.5" fill="#FFD27A" opacity="0.26"/>
<circle cx="356.7" cy="222" r="1.2" fill="#FFD27A" opacity="0.38"/>
<circle cx="157" cy="75.6" r="1.6" fill="#FFD27A" opacity="0.38"/>
<circle cx="184.7" cy="142.4" r="1.7" fill="#FFD27A" opacity="0.25"/>
<circle cx="97.2" cy="44.5" r="1.7" fill="#FFD27A" opacity="0.23"/>
<circle cx="52.7" cy="298.2" r="1.6" fill="#FFD27A" opacity="0.4"/>
<circle cx="85" cy="499.1" r="1.2" fill="#FFD27A" opacity="0.37"/>
<circle cx="183" cy="551.5" r="1.7" fill="#FFD27A" opacity="0.3"/>
<circle cx="177.2" cy="17.5" r="1.1" fill="#FFD27A" opacity="0.33"/>
<circle cx="321.7" cy="286.5" r="5.2" fill="url(#h)" opacity="0.10"/>
<circle cx="321.7" cy="286.5" r="1.6" fill="#FFF3D6" opacity="0.49"/>
<circle cx="196.6" cy="208.7" r="5.6" fill="url(#h)" opacity="0.10"/>
<circle cx="196.6" cy="208.7" r="1.7" fill="#FFF3D6" opacity="0.5"/>
<circle cx="54.1" cy="341.8" r="3.9" fill="url(#h)" opacity="0.10"/>
<circle cx="54.1" cy="341.8" r="1.2" fill="#FFF3D6" opacity="0.33999999999999997"/>
<circle cx="356.7" cy="222" r="3.8" fill="url(#h)" opacity="0.10"/>
<circle cx="356.7" cy="222" r="1.2" fill="#FFF3D6" opacity="0.48"/>
<g opacity="0.33">
<path d="M 189.1 339.4 L 241.5 356.7 L 268.8 384.7 L 279.9 424.1 L 269.4 478.8 L 240.2 502.1 L 198 523 L 144.5 501.9 L 103.3 469 L 98.8 427.1 L 113.7 393 L 147.8 355.9" fill="none" stroke="#FFD27A" stroke-width="2.5" stroke-opacity="0.18"/><path d="M 189.1 339.4 L 241.5 356.7 L 268.8 384.7 L 279.9 424.1 L 269.4 478.8 L 240.2 502.1 L 198 523 L 144.5 501.9 L 103.3 469 L 98.8 427.1 L 113.7 393 L 147.8 355.9" fill="none" stroke="#FFD27A" stroke-width="0.8" stroke-opacity="0.85"/>
<circle cx="189.1" cy="339.4" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="189.1" cy="339.4" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="241.5" cy="356.7" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="241.5" cy="356.7" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="268.8" cy="384.7" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="268.8" cy="384.7" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="279.9" cy="424.1" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="279.9" cy="424.1" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="269.4" cy="478.8" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="269.4" cy="478.8" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="240.2" cy="502.1" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="240.2" cy="502.1" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="198" cy="523" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="198" cy="523" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="144.5" cy="501.9" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="144.5" cy="501.9" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="103.3" cy="469" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="103.3" cy="469" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="98.8" cy="427.1" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="98.8" cy="427.1" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="113.7" cy="393" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="113.7" cy="393" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="147.8" cy="355.9" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="147.8" cy="355.9" r="2.4" fill="#FFF3D6" opacity="0.8"/>
</g>
<g opacity="0.5">
<circle cx="294.7" cy="122.9" r="10" fill="url(#h)" opacity="0.16"/>
<circle cx="294.7" cy="122.9" r="2.0" fill="#FFF3D6" opacity="0.9"/>
<circle cx="344.4" cy="176.7" r="10" fill="url(#h)" opacity="0.16"/>
<circle cx="344.4" cy="176.7" r="2.0" fill="#FFF3D6" opacity="0.9"/>
<circle cx="300.2" cy="225.4" r="10" fill="url(#h)" opacity="0.16"/>
<circle cx="300.2" cy="225.4" r="2.0" fill="#FFF3D6" opacity="0.9"/>
<circle cx="242.1" cy="177.5" r="10" fill="url(#h)" opacity="0.16"/>
<circle cx="242.1" cy="177.5" r="2.0" fill="#FFF3D6" opacity="0.9"/>
</g>
</svg>
```

| 図 | 状態 | 条件・時刻 | 見どころ（検収の観点） |
|---|---|---|---|
| A1 | intro | 読み込み直後 | 中央の 5 星（暈 12〜14px・芯 2.4〜2.8px・暈 alpha 0.26）が唯一の明るい塊。文字なし・薄幕なし。星群は 3.4 秒周期の呼吸（広がり 24px 前後で脈動）と明滅で誘う |
| B1 | 収集中 | 押下 300ms・指 (205,470) | 4 星が指の周囲 12〜35px の不規則な雲で寄り、暈 alpha 0.26〜0.30・芯 2.8〜3.2px に増光。次の候補 2 星はまだ弱い輝度 |
| C0 | 結線中 | 解放 260ms 後 | 始点増光と 1 音目から 160ms 刻みで進む。1 本目完了、2 本目は 37.5% まで伸び、先端に 2.6px の先端光点。増光は到達星だけで線には音を足さない |
| C1 | 保持 | 解放から約 27 秒後（12 星＋先の 4 星） | 12 星・11 線が R=90px で完成。先に結んだ 4 星星座（R=43px・alpha 0.9）が別位置に残る。閉路・星座間の線はない。最上部の星から時計回り |
| D1 | 余韻 | 12 星は消退 p=0.5（alpha 約 0.33）／4 星は帰還中（alpha 0.5・線なし・星が外へ散る） | 消退は線幅を変えず alpha のみ。帰還は 0.6 秒で元の空の位置へ戻る。両方とも新しい操作を妨げない |

## 3. カンプ（1280px × 800、短辺 S=720）

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
  <defs><radialGradient id="h"><stop offset="0" stop-color="#FFD27A" stop-opacity="1"/><stop offset="0.25" stop-color="#FFD27A" stop-opacity="0.68"/><stop offset="0.5" stop-color="#FFD27A" stop-opacity="0.30"/><stop offset="1" stop-color="#FFD27A" stop-opacity="0"/></radialGradient></defs>
<rect width="1280" height="800" fill="#0B1026"/>
<circle cx="94.5" cy="264" r="1" fill="#FFD27A" opacity="0.24"/>
<circle cx="958.4" cy="551.2" r="1.4" fill="#FFD27A" opacity="0.35"/>
<circle cx="578.3" cy="684.4" r="1.5" fill="#FFD27A" opacity="0.21"/>
<circle cx="685.1" cy="177.8" r="1.6" fill="#FFD27A" opacity="0.22"/>
<circle cx="387.4" cy="196.9" r="1.2" fill="#FFD27A" opacity="0.22"/>
<circle cx="959" cy="529.1" r="1" fill="#FFD27A" opacity="0.31"/>
<circle cx="108.4" cy="512" r="1.3" fill="#FFD27A" opacity="0.3"/>
<circle cx="969.7" cy="617.5" r="1.5" fill="#FFD27A" opacity="0.24"/>
<circle cx="129.1" cy="465.3" r="1.4" fill="#FFD27A" opacity="0.38"/>
<circle cx="1120.9" cy="156.3" r="1.3" fill="#FFD27A" opacity="0.34"/>
<circle cx="537.6" cy="763.6" r="1" fill="#FFD27A" opacity="0.27"/>
<circle cx="1072" cy="749.7" r="1.4" fill="#FFD27A" opacity="0.24"/>
<circle cx="755.4" cy="258.7" r="1.6" fill="#FFD27A" opacity="0.26"/>
<circle cx="251.8" cy="468.3" r="1.6" fill="#FFD27A" opacity="0.29"/>
<circle cx="757" cy="455" r="1.4" fill="#FFD27A" opacity="0.18"/>
<circle cx="479.5" cy="691.3" r="1.4" fill="#FFD27A" opacity="0.35"/>
<circle cx="1212.9" cy="39.1" r="1.6" fill="#FFD27A" opacity="0.29"/>
<circle cx="13.1" cy="180.7" r="1.4" fill="#FFD27A" opacity="0.28"/>
<circle cx="1106.9" cy="287" r="1.6" fill="#FFD27A" opacity="0.27"/>
<circle cx="1198.3" cy="772.1" r="1.1" fill="#FFD27A" opacity="0.36"/>
<circle cx="152.2" cy="271.7" r="1.7" fill="#FFD27A" opacity="0.28"/>
<circle cx="35.7" cy="13.7" r="1.8" fill="#FFD27A" opacity="0.37"/>
<circle cx="1224.7" cy="275.7" r="1.2" fill="#FFD27A" opacity="0.33"/>
<circle cx="71.9" cy="477.4" r="1.1" fill="#FFD27A" opacity="0.22"/>
<circle cx="963.2" cy="195.5" r="1.8" fill="#FFD27A" opacity="0.33"/>
<circle cx="766" cy="511.3" r="1.2" fill="#FFD27A" opacity="0.39"/>
<circle cx="60.6" cy="717.9" r="1.4" fill="#FFD27A" opacity="0.31"/>
<circle cx="695.5" cy="312.8" r="1.1" fill="#FFD27A" opacity="0.26"/>
<circle cx="816.8" cy="252.8" r="1.6" fill="#FFD27A" opacity="0.33"/>
<circle cx="47.5" cy="82.4" r="1.7" fill="#FFD27A" opacity="0.3"/>
<circle cx="178.1" cy="422.8" r="1.4" fill="#FFD27A" opacity="0.34"/>
<circle cx="610.9" cy="736" r="1" fill="#FFD27A" opacity="0.38"/>
<circle cx="900.6" cy="303.8" r="1.1" fill="#FFD27A" opacity="0.21"/>
<circle cx="896.3" cy="529.4" r="1.4" fill="#FFD27A" opacity="0.2"/>
<circle cx="94.5" cy="264" r="3.2" fill="url(#h)" opacity="0.10"/>
<circle cx="94.5" cy="264" r="1" fill="#FFF3D6" opacity="0.33999999999999997"/>
<circle cx="108.4" cy="512" r="4.2" fill="url(#h)" opacity="0.10"/>
<circle cx="108.4" cy="512" r="1.3" fill="#FFF3D6" opacity="0.4"/>
<circle cx="755.4" cy="258.7" r="5" fill="url(#h)" opacity="0.10"/>
<circle cx="755.4" cy="258.7" r="1.6" fill="#FFF3D6" opacity="0.36"/>
<circle cx="1106.9" cy="287" r="5.2" fill="url(#h)" opacity="0.10"/>
<circle cx="1106.9" cy="287" r="1.6" fill="#FFF3D6" opacity="0.37"/>
<circle cx="664.6" cy="398.6" r="13.3" fill="url(#h)" opacity="0.26"/>
<circle cx="664.6" cy="398.6" r="2.7" fill="#FFF3D6" opacity="1.0"/>
<circle cx="657.6" cy="434" r="12.9" fill="url(#h)" opacity="0.26"/>
<circle cx="657.6" cy="434" r="2.7" fill="#FFF3D6" opacity="1.0"/>
<circle cx="611.9" cy="418.8" r="12.3" fill="url(#h)" opacity="0.26"/>
<circle cx="611.9" cy="418.8" r="2.5" fill="#FFF3D6" opacity="1.0"/>
<circle cx="618" cy="383.2" r="12.3" fill="url(#h)" opacity="0.26"/>
<circle cx="618" cy="383.2" r="2.7" fill="#FFF3D6" opacity="1.0"/>
<circle cx="653.1" cy="371.3" r="13.2" fill="url(#h)" opacity="0.26"/>
<circle cx="653.1" cy="371.3" r="2.7" fill="#FFF3D6" opacity="1.0"/>
</svg>
```

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
  <defs><radialGradient id="h"><stop offset="0" stop-color="#FFD27A" stop-opacity="1"/><stop offset="0.25" stop-color="#FFD27A" stop-opacity="0.68"/><stop offset="0.5" stop-color="#FFD27A" stop-opacity="0.30"/><stop offset="1" stop-color="#FFD27A" stop-opacity="0"/></radialGradient></defs>
<rect width="1280" height="800" fill="#0B1026"/>
<circle cx="972.5" cy="512.9" r="1.3" fill="#FFD27A" opacity="0.22"/>
<circle cx="862.6" cy="766" r="1.3" fill="#FFD27A" opacity="0.37"/>
<circle cx="55.5" cy="421.7" r="1.2" fill="#FFD27A" opacity="0.29"/>
<circle cx="780.2" cy="677.6" r="1.4" fill="#FFD27A" opacity="0.37"/>
<circle cx="421.7" cy="110.2" r="1.4" fill="#FFD27A" opacity="0.34"/>
<circle cx="902" cy="38.7" r="1.2" fill="#FFD27A" opacity="0.24"/>
<circle cx="604.2" cy="682.1" r="1.2" fill="#FFD27A" opacity="0.19"/>
<circle cx="1141.5" cy="688" r="1.6" fill="#FFD27A" opacity="0.19"/>
<circle cx="338.5" cy="147.9" r="1.7" fill="#FFD27A" opacity="0.21"/>
<circle cx="170.6" cy="182.1" r="1.6" fill="#FFD27A" opacity="0.22"/>
<circle cx="1249.1" cy="250.4" r="1.5" fill="#FFD27A" opacity="0.22"/>
<circle cx="378" cy="685" r="1.8" fill="#FFD27A" opacity="0.23"/>
<circle cx="450.4" cy="54.8" r="1.2" fill="#FFD27A" opacity="0.26"/>
<circle cx="450.3" cy="133.3" r="1.4" fill="#FFD27A" opacity="0.26"/>
<circle cx="444.9" cy="769.1" r="1.5" fill="#FFD27A" opacity="0.18"/>
<circle cx="1215.9" cy="766.4" r="1.3" fill="#FFD27A" opacity="0.4"/>
<circle cx="142.3" cy="726.6" r="1.1" fill="#FFD27A" opacity="0.37"/>
<circle cx="863.5" cy="757.5" r="1.2" fill="#FFD27A" opacity="0.32"/>
<circle cx="1195.1" cy="110.5" r="1.1" fill="#FFD27A" opacity="0.3"/>
<circle cx="178.5" cy="52.5" r="1" fill="#FFD27A" opacity="0.26"/>
<circle cx="828.9" cy="373.4" r="1.5" fill="#FFD27A" opacity="0.19"/>
<circle cx="137.6" cy="451" r="1.1" fill="#FFD27A" opacity="0.18"/>
<circle cx="87.6" cy="518.5" r="1.8" fill="#FFD27A" opacity="0.29"/>
<circle cx="17.9" cy="161.9" r="1.5" fill="#FFD27A" opacity="0.35"/>
<circle cx="269.6" cy="374.6" r="1" fill="#FFD27A" opacity="0.3"/>
<circle cx="962.7" cy="399.7" r="1.6" fill="#FFD27A" opacity="0.23"/>
<circle cx="849.2" cy="377.2" r="1.5" fill="#FFD27A" opacity="0.2"/>
<circle cx="581.9" cy="493.6" r="1.2" fill="#FFD27A" opacity="0.3"/>
<circle cx="34.8" cy="336" r="1.8" fill="#FFD27A" opacity="0.32"/>
<circle cx="647.7" cy="689.4" r="1.6" fill="#FFD27A" opacity="0.29"/>
<circle cx="482.7" cy="691.5" r="1.5" fill="#FFD27A" opacity="0.29"/>
<circle cx="478" cy="129.2" r="1.2" fill="#FFD27A" opacity="0.31"/>
<circle cx="687" cy="614.2" r="1.4" fill="#FFD27A" opacity="0.26"/>
<circle cx="709.7" cy="206" r="1.8" fill="#FFD27A" opacity="0.32"/>
<circle cx="972.5" cy="512.9" r="4.2" fill="url(#h)" opacity="0.10"/>
<circle cx="972.5" cy="512.9" r="1.3" fill="#FFF3D6" opacity="0.32"/>
<circle cx="604.2" cy="682.1" r="3.9" fill="url(#h)" opacity="0.10"/>
<circle cx="604.2" cy="682.1" r="1.2" fill="#FFF3D6" opacity="0.29000000000000004"/>
<circle cx="450.4" cy="54.8" r="3.7" fill="url(#h)" opacity="0.10"/>
<circle cx="450.4" cy="54.8" r="1.2" fill="#FFF3D6" opacity="0.36"/>
<circle cx="1195.1" cy="110.5" r="3.7" fill="url(#h)" opacity="0.10"/>
<circle cx="1195.1" cy="110.5" r="1.1" fill="#FFF3D6" opacity="0.4"/>
<circle cx="715" cy="413" r="14" fill="url(#h)" opacity="0.3"/>
<circle cx="715" cy="413" r="3.2" fill="#FFF3D6" opacity="1.0"/>
<circle cx="679" cy="397" r="13" fill="url(#h)" opacity="0.28"/>
<circle cx="679" cy="397" r="3" fill="#FFF3D6" opacity="1.0"/>
<circle cx="727" cy="454" r="12" fill="url(#h)" opacity="0.27"/>
<circle cx="727" cy="454" r="2.9" fill="#FFF3D6" opacity="1.0"/>
<circle cx="688" cy="479" r="12" fill="url(#h)" opacity="0.26"/>
<circle cx="688" cy="479" r="2.8" fill="#FFF3D6" opacity="1.0"/>
</svg>
```

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
  <defs><radialGradient id="h"><stop offset="0" stop-color="#FFD27A" stop-opacity="1"/><stop offset="0.25" stop-color="#FFD27A" stop-opacity="0.68"/><stop offset="0.5" stop-color="#FFD27A" stop-opacity="0.30"/><stop offset="1" stop-color="#FFD27A" stop-opacity="0"/></radialGradient></defs>
<rect width="1280" height="800" fill="#0B1026"/>
<circle cx="124.4" cy="666.8" r="1.5" fill="#FFD27A" opacity="0.23"/>
<circle cx="992.4" cy="473.8" r="1.7" fill="#FFD27A" opacity="0.31"/>
<circle cx="921.3" cy="614.5" r="1.3" fill="#FFD27A" opacity="0.2"/>
<circle cx="1141.2" cy="101.6" r="1.4" fill="#FFD27A" opacity="0.4"/>
<circle cx="451.6" cy="213.9" r="1.3" fill="#FFD27A" opacity="0.22"/>
<circle cx="954.8" cy="242.5" r="1.1" fill="#FFD27A" opacity="0.31"/>
<circle cx="336.6" cy="149.6" r="1" fill="#FFD27A" opacity="0.36"/>
<circle cx="485.9" cy="478" r="1.4" fill="#FFD27A" opacity="0.37"/>
<circle cx="94.8" cy="504.5" r="1.7" fill="#FFD27A" opacity="0.24"/>
<circle cx="556.5" cy="272.5" r="1.3" fill="#FFD27A" opacity="0.39"/>
<circle cx="298" cy="585.5" r="1" fill="#FFD27A" opacity="0.35"/>
<circle cx="111.3" cy="625.7" r="1.1" fill="#FFD27A" opacity="0.23"/>
<circle cx="342.4" cy="229.6" r="1.6" fill="#FFD27A" opacity="0.29"/>
<circle cx="67.7" cy="152.5" r="1.3" fill="#FFD27A" opacity="0.34"/>
<circle cx="817.2" cy="384.4" r="1.6" fill="#FFD27A" opacity="0.39"/>
<circle cx="1206.3" cy="783.4" r="1.7" fill="#FFD27A" opacity="0.4"/>
<circle cx="912.7" cy="550" r="1.5" fill="#FFD27A" opacity="0.27"/>
<circle cx="1064.7" cy="307.9" r="1.7" fill="#FFD27A" opacity="0.28"/>
<circle cx="37.9" cy="671.2" r="1.4" fill="#FFD27A" opacity="0.18"/>
<circle cx="1040.6" cy="629.6" r="1.7" fill="#FFD27A" opacity="0.28"/>
<circle cx="221.3" cy="179.3" r="1.4" fill="#FFD27A" opacity="0.33"/>
<circle cx="712.1" cy="197.7" r="1.1" fill="#FFD27A" opacity="0.39"/>
<circle cx="1267.3" cy="743.5" r="1.4" fill="#FFD27A" opacity="0.2"/>
<circle cx="288" cy="441.3" r="1.7" fill="#FFD27A" opacity="0.33"/>
<circle cx="146.4" cy="724.4" r="1.5" fill="#FFD27A" opacity="0.27"/>
<circle cx="980.2" cy="329.3" r="1.4" fill="#FFD27A" opacity="0.19"/>
<circle cx="105.9" cy="735.4" r="1.3" fill="#FFD27A" opacity="0.35"/>
<circle cx="478" cy="316.1" r="1.1" fill="#FFD27A" opacity="0.38"/>
<circle cx="327.8" cy="607.7" r="1.1" fill="#FFD27A" opacity="0.25"/>
<circle cx="121.5" cy="552.6" r="1.7" fill="#FFD27A" opacity="0.32"/>
<circle cx="821.9" cy="204" r="1.8" fill="#FFD27A" opacity="0.2"/>
<circle cx="325.5" cy="451.6" r="1.5" fill="#FFD27A" opacity="0.24"/>
<circle cx="754.6" cy="99.8" r="1" fill="#FFD27A" opacity="0.27"/>
<circle cx="736.9" cy="698.7" r="1.4" fill="#FFD27A" opacity="0.39"/>
<circle cx="124.4" cy="666.8" r="4.7" fill="url(#h)" opacity="0.10"/>
<circle cx="124.4" cy="666.8" r="1.5" fill="#FFF3D6" opacity="0.33"/>
<circle cx="336.6" cy="149.6" r="3.2" fill="url(#h)" opacity="0.10"/>
<circle cx="336.6" cy="149.6" r="1" fill="#FFF3D6" opacity="0.45999999999999996"/>
<circle cx="342.4" cy="229.6" r="5.2" fill="url(#h)" opacity="0.10"/>
<circle cx="342.4" cy="229.6" r="1.6" fill="#FFF3D6" opacity="0.39"/>
<circle cx="37.9" cy="671.2" r="4.4" fill="url(#h)" opacity="0.10"/>
<circle cx="37.9" cy="671.2" r="1.4" fill="#FFF3D6" opacity="0.28"/>
<g opacity="1.0"><path d="M 700.4 343.7 L 780.7 437.8" fill="none" stroke="#FFD27A" stroke-width="2.5" stroke-opacity="0.18" stroke-linejoin="round"/><path d="M 700.4 343.7 L 780.7 437.8" fill="none" stroke="#FFD27A" stroke-width="0.8" stroke-opacity="0.85" stroke-linejoin="round"/></g>
<g><path d="M 780.7 437.8 L 748.7 466.8" fill="none" stroke="#FFD27A" stroke-width="2.5" stroke-opacity="0.18"/><path d="M 780.7 437.8 L 748.7 466.8" fill="none" stroke="#FFD27A" stroke-width="0.8" stroke-opacity="0.85"/></g>
<circle cx="748.7" cy="466.8" r="11" fill="url(#h)" opacity="0.3"/>
<circle cx="748.7" cy="466.8" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="700.4" cy="343.7" r="14" fill="url(#h)" opacity="0.32"/>
<circle cx="700.4" cy="343.7" r="3.4" fill="#FFF3D6" opacity="1.0"/>
<circle cx="780.7" cy="437.8" r="14" fill="url(#h)" opacity="0.32"/>
<circle cx="780.7" cy="437.8" r="3.4" fill="#FFF3D6" opacity="1.0"/>
<circle cx="695.3" cy="515.1" r="12" fill="url(#h)" opacity="0.24"/>
<circle cx="695.3" cy="515.1" r="2.8" fill="#FFF3D6" opacity="1.0"/>
<circle cx="620.7" cy="427.3" r="11" fill="url(#h)" opacity="0.22"/>
<circle cx="620.7" cy="427.3" r="2.6" fill="#FFF3D6" opacity="1.0"/>
</svg>
```

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
  <defs><radialGradient id="h"><stop offset="0" stop-color="#FFD27A" stop-opacity="1"/><stop offset="0.25" stop-color="#FFD27A" stop-opacity="0.68"/><stop offset="0.5" stop-color="#FFD27A" stop-opacity="0.30"/><stop offset="1" stop-color="#FFD27A" stop-opacity="0"/></radialGradient></defs>
<rect width="1280" height="800" fill="#0B1026"/>
<circle cx="510.1" cy="76.7" r="1.5" fill="#FFD27A" opacity="0.21"/>
<circle cx="617.4" cy="269.1" r="1.6" fill="#FFD27A" opacity="0.21"/>
<circle cx="1228.8" cy="66.5" r="1.1" fill="#FFD27A" opacity="0.33"/>
<circle cx="1249.9" cy="682" r="1.7" fill="#FFD27A" opacity="0.21"/>
<circle cx="259.7" cy="239.3" r="1.2" fill="#FFD27A" opacity="0.22"/>
<circle cx="393.7" cy="304.3" r="1.3" fill="#FFD27A" opacity="0.36"/>
<circle cx="1061" cy="114.8" r="1.4" fill="#FFD27A" opacity="0.34"/>
<circle cx="54.2" cy="746.6" r="1.5" fill="#FFD27A" opacity="0.28"/>
<circle cx="519.7" cy="713.8" r="1.4" fill="#FFD27A" opacity="0.28"/>
<circle cx="1211" cy="152.9" r="1.4" fill="#FFD27A" opacity="0.38"/>
<circle cx="1066.8" cy="617.3" r="1.7" fill="#FFD27A" opacity="0.21"/>
<circle cx="858.1" cy="404.3" r="1.8" fill="#FFD27A" opacity="0.39"/>
<circle cx="507.7" cy="640.5" r="1.3" fill="#FFD27A" opacity="0.27"/>
<circle cx="916" cy="698.6" r="1.6" fill="#FFD27A" opacity="0.22"/>
<circle cx="92.9" cy="746" r="1.4" fill="#FFD27A" opacity="0.31"/>
<circle cx="894.9" cy="745.6" r="1.6" fill="#FFD27A" opacity="0.32"/>
<circle cx="583.7" cy="547.5" r="1.6" fill="#FFD27A" opacity="0.3"/>
<circle cx="1227.4" cy="297" r="1.7" fill="#FFD27A" opacity="0.4"/>
<circle cx="939.5" cy="324.9" r="1.4" fill="#FFD27A" opacity="0.26"/>
<circle cx="1020.3" cy="608.8" r="1.1" fill="#FFD27A" opacity="0.26"/>
<circle cx="968.4" cy="136.5" r="1.6" fill="#FFD27A" opacity="0.3"/>
<circle cx="219.2" cy="293" r="1.7" fill="#FFD27A" opacity="0.2"/>
<circle cx="610.3" cy="779.9" r="1.2" fill="#FFD27A" opacity="0.35"/>
<circle cx="522.7" cy="736.4" r="1.8" fill="#FFD27A" opacity="0.34"/>
<circle cx="267.2" cy="737.4" r="1.3" fill="#FFD27A" opacity="0.36"/>
<circle cx="848.2" cy="489.7" r="1.3" fill="#FFD27A" opacity="0.35"/>
<circle cx="1244.9" cy="688.2" r="1.7" fill="#FFD27A" opacity="0.24"/>
<circle cx="319.9" cy="591" r="1.4" fill="#FFD27A" opacity="0.38"/>
<circle cx="642.1" cy="763" r="1" fill="#FFD27A" opacity="0.38"/>
<circle cx="377.5" cy="591.2" r="1.5" fill="#FFD27A" opacity="0.32"/>
<circle cx="510.1" cy="76.7" r="4.7" fill="url(#h)" opacity="0.10"/>
<circle cx="510.1" cy="76.7" r="1.5" fill="#FFF3D6" opacity="0.31"/>
<circle cx="1061" cy="114.8" r="4.5" fill="url(#h)" opacity="0.10"/>
<circle cx="1061" cy="114.8" r="1.4" fill="#FFF3D6" opacity="0.44000000000000006"/>
<circle cx="507.7" cy="640.5" r="4.1" fill="url(#h)" opacity="0.10"/>
<circle cx="507.7" cy="640.5" r="1.3" fill="#FFF3D6" opacity="0.37"/>
<circle cx="939.5" cy="324.9" r="4.6" fill="url(#h)" opacity="0.10"/>
<circle cx="939.5" cy="324.9" r="1.4" fill="#FFF3D6" opacity="0.36"/>
<g opacity="1.0"><path d="M 607.6 243.7 L 710.4 273.2 L 769.3 321.5 L 792.7 431.2 L 764.8 503.8 L 719.9 557.7 L 617.1 583.8 L 527.6 559.4 L 483.4 509.4 L 443.2 401.5 L 475.6 320.8 L 521.5 282.4" fill="none" stroke="#FFD27A" stroke-width="2.5" stroke-opacity="0.18" stroke-linejoin="round"/><path d="M 607.6 243.7 L 710.4 273.2 L 769.3 321.5 L 792.7 431.2 L 764.8 503.8 L 719.9 557.7 L 617.1 583.8 L 527.6 559.4 L 483.4 509.4 L 443.2 401.5 L 475.6 320.8 L 521.5 282.4" fill="none" stroke="#FFD27A" stroke-width="0.8" stroke-opacity="0.85" stroke-linejoin="round"/></g>
<circle cx="607.6" cy="243.7" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="607.6" cy="243.7" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="710.4" cy="273.2" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="710.4" cy="273.2" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="769.3" cy="321.5" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="769.3" cy="321.5" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="792.7" cy="431.2" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="792.7" cy="431.2" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="764.8" cy="503.8" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="764.8" cy="503.8" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="719.9" cy="557.7" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="719.9" cy="557.7" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="617.1" cy="583.8" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="617.1" cy="583.8" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="527.6" cy="559.4" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="527.6" cy="559.4" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="483.4" cy="509.4" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="483.4" cy="509.4" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="443.2" cy="401.5" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="443.2" cy="401.5" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="475.6" cy="320.8" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="475.6" cy="320.8" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<circle cx="521.5" cy="282.4" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="521.5" cy="282.4" r="2.6" fill="#FFF3D6" opacity="1.0"/>
<g opacity="0.9"><path d="M 1017.6 130.8 L 1097.7 201.2 L 1015.2 289.2 L 928.4 207.4" fill="none" stroke="#FFD27A" stroke-width="2.5" stroke-opacity="0.18" stroke-linejoin="round"/><path d="M 1017.6 130.8 L 1097.7 201.2 L 1015.2 289.2 L 928.4 207.4" fill="none" stroke="#FFD27A" stroke-width="0.8" stroke-opacity="0.85" stroke-linejoin="round"/></g>
<circle cx="1017.6" cy="130.8" r="11" fill="url(#h)" opacity="0.2"/>
<circle cx="1017.6" cy="130.8" r="2.4" fill="#FFF3D6" opacity="0.95"/>
<circle cx="1097.7" cy="201.2" r="11" fill="url(#h)" opacity="0.2"/>
<circle cx="1097.7" cy="201.2" r="2.4" fill="#FFF3D6" opacity="0.95"/>
<circle cx="1015.2" cy="289.2" r="11" fill="url(#h)" opacity="0.2"/>
<circle cx="1015.2" cy="289.2" r="2.4" fill="#FFF3D6" opacity="0.95"/>
<circle cx="928.4" cy="207.4" r="11" fill="url(#h)" opacity="0.2"/>
<circle cx="928.4" cy="207.4" r="2.4" fill="#FFF3D6" opacity="0.95"/>
</svg>
```

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
  <defs><radialGradient id="h"><stop offset="0" stop-color="#FFD27A" stop-opacity="1"/><stop offset="0.25" stop-color="#FFD27A" stop-opacity="0.68"/><stop offset="0.5" stop-color="#FFD27A" stop-opacity="0.30"/><stop offset="1" stop-color="#FFD27A" stop-opacity="0"/></radialGradient></defs>
<rect width="1280" height="800" fill="#0B1026"/>
<circle cx="557.4" cy="575.1" r="1.4" fill="#FFD27A" opacity="0.29"/>
<circle cx="1239.4" cy="414.1" r="1.1" fill="#FFD27A" opacity="0.34"/>
<circle cx="297.7" cy="768.9" r="1.5" fill="#FFD27A" opacity="0.22"/>
<circle cx="1223.2" cy="261.1" r="1.8" fill="#FFD27A" opacity="0.18"/>
<circle cx="385.5" cy="498.7" r="1.2" fill="#FFD27A" opacity="0.25"/>
<circle cx="141.1" cy="482.4" r="1.7" fill="#FFD27A" opacity="0.25"/>
<circle cx="857" cy="425.4" r="1.6" fill="#FFD27A" opacity="0.4"/>
<circle cx="687.7" cy="294.3" r="1.4" fill="#FFD27A" opacity="0.34"/>
<circle cx="1267.9" cy="777.3" r="1.2" fill="#FFD27A" opacity="0.2"/>
<circle cx="1204.3" cy="170.1" r="1.5" fill="#FFD27A" opacity="0.21"/>
<circle cx="642.2" cy="574.7" r="1.8" fill="#FFD27A" opacity="0.26"/>
<circle cx="545.3" cy="639.1" r="1.4" fill="#FFD27A" opacity="0.2"/>
<circle cx="437.8" cy="196.6" r="1.6" fill="#FFD27A" opacity="0.32"/>
<circle cx="118.8" cy="399.8" r="1.6" fill="#FFD27A" opacity="0.36"/>
<circle cx="921.9" cy="464.6" r="1.4" fill="#FFD27A" opacity="0.39"/>
<circle cx="596.5" cy="209.5" r="1.2" fill="#FFD27A" opacity="0.26"/>
<circle cx="522.3" cy="222.7" r="1.3" fill="#FFD27A" opacity="0.37"/>
<circle cx="202.5" cy="111.9" r="1.2" fill="#FFD27A" opacity="0.22"/>
<circle cx="1249.3" cy="659.8" r="1.7" fill="#FFD27A" opacity="0.18"/>
<circle cx="856.6" cy="579.1" r="1.2" fill="#FFD27A" opacity="0.24"/>
<circle cx="653.4" cy="322.3" r="1.3" fill="#FFD27A" opacity="0.3"/>
<circle cx="1000.2" cy="610.1" r="1.7" fill="#FFD27A" opacity="0.36"/>
<circle cx="247.7" cy="496" r="1.2" fill="#FFD27A" opacity="0.3"/>
<circle cx="475.5" cy="728.4" r="1.4" fill="#FFD27A" opacity="0.29"/>
<circle cx="381.6" cy="408.4" r="1.5" fill="#FFD27A" opacity="0.21"/>
<circle cx="1213.9" cy="408.6" r="1.2" fill="#FFD27A" opacity="0.36"/>
<circle cx="72.3" cy="561.3" r="1.3" fill="#FFD27A" opacity="0.39"/>
<circle cx="101.1" cy="710.7" r="1.5" fill="#FFD27A" opacity="0.34"/>
<circle cx="535" cy="266" r="1.5" fill="#FFD27A" opacity="0.24"/>
<circle cx="1144.9" cy="420.5" r="1.6" fill="#FFD27A" opacity="0.34"/>
<circle cx="270.8" cy="384.6" r="1.1" fill="#FFD27A" opacity="0.2"/>
<circle cx="97.2" cy="774.4" r="1.4" fill="#FFD27A" opacity="0.27"/>
<circle cx="906.2" cy="180.5" r="1.1" fill="#FFD27A" opacity="0.2"/>
<circle cx="190" cy="235.4" r="1.2" fill="#FFD27A" opacity="0.28"/>
<circle cx="557.4" cy="575.1" r="4.6" fill="url(#h)" opacity="0.10"/>
<circle cx="557.4" cy="575.1" r="1.4" fill="#FFF3D6" opacity="0.39"/>
<circle cx="857" cy="425.4" r="5" fill="url(#h)" opacity="0.10"/>
<circle cx="857" cy="425.4" r="1.6" fill="#FFF3D6" opacity="0.5"/>
<circle cx="437.8" cy="196.6" r="5.1" fill="url(#h)" opacity="0.10"/>
<circle cx="437.8" cy="196.6" r="1.6" fill="#FFF3D6" opacity="0.42000000000000004"/>
<circle cx="1249.3" cy="659.8" r="5.3" fill="url(#h)" opacity="0.10"/>
<circle cx="1249.3" cy="659.8" r="1.7" fill="#FFF3D6" opacity="0.28"/>
<g opacity="0.33">
<path d="M 607.6 243.7 L 710.4 273.2 L 769.3 321.5 L 792.7 431.2 L 764.8 503.8 L 719.9 557.7 L 617.1 583.8 L 527.6 559.4 L 483.4 509.4 L 443.2 401.5 L 475.6 320.8 L 521.5 282.4" fill="none" stroke="#FFD27A" stroke-width="2.5" stroke-opacity="0.18"/><path d="M 607.6 243.7 L 710.4 273.2 L 769.3 321.5 L 792.7 431.2 L 764.8 503.8 L 719.9 557.7 L 617.1 583.8 L 527.6 559.4 L 483.4 509.4 L 443.2 401.5 L 475.6 320.8 L 521.5 282.4" fill="none" stroke="#FFD27A" stroke-width="0.8" stroke-opacity="0.85"/>
<circle cx="607.6" cy="243.7" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="607.6" cy="243.7" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="710.4" cy="273.2" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="710.4" cy="273.2" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="769.3" cy="321.5" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="769.3" cy="321.5" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="792.7" cy="431.2" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="792.7" cy="431.2" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="764.8" cy="503.8" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="764.8" cy="503.8" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="719.9" cy="557.7" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="719.9" cy="557.7" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="617.1" cy="583.8" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="617.1" cy="583.8" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="527.6" cy="559.4" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="527.6" cy="559.4" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="483.4" cy="509.4" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="483.4" cy="509.4" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="443.2" cy="401.5" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="443.2" cy="401.5" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="475.6" cy="320.8" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="475.6" cy="320.8" r="2.4" fill="#FFF3D6" opacity="0.8"/>
<circle cx="521.5" cy="282.4" r="12" fill="url(#h)" opacity="0.22"/>
<circle cx="521.5" cy="282.4" r="2.4" fill="#FFF3D6" opacity="0.8"/>
</g>
<g opacity="0.5">
<circle cx="1018.5" cy="121.8" r="10" fill="url(#h)" opacity="0.16"/>
<circle cx="1018.5" cy="121.8" r="2.0" fill="#FFF3D6" opacity="0.9"/>
<circle cx="1106.7" cy="200.3" r="10" fill="url(#h)" opacity="0.16"/>
<circle cx="1106.7" cy="200.3" r="2.0" fill="#FFF3D6" opacity="0.9"/>
<circle cx="1015.8" cy="298.2" r="10" fill="url(#h)" opacity="0.16"/>
<circle cx="1015.8" cy="298.2" r="2.0" fill="#FFF3D6" opacity="0.9"/>
<circle cx="919.4" cy="207.1" r="10" fill="url(#h)" opacity="0.16"/>
<circle cx="919.4" cy="207.1" r="2.0" fill="#FFF3D6" opacity="0.9"/>
</g>
</svg>
```

| 図 | 状態 | 条件・時刻 | 見どころ |
|---|---|---|---|
| A2 | intro | 読み込み直後 | 中央星群の広がりは 40px（比 S×0.064・上限 40px）。星の寸法は 375px と同一。背景星は 375px より疎に見えるが密度の式は同じ |
| B2 | 収集中 | 押下 300ms・指 (700,430) | 星座半径の目標 R(300)=83.2px に対し、星はまだ指の近くに雲状に寄る。星座半径は離すまで決まらない |
| C0 | 結線中 | 解放 260ms 後 | R=83.2px の 4 星。線の伸びと先端光点は 375px と同じ寸法・同じ速度 |
| C1 | 保持 | 12 星 R=172.8px ＋ 先の 4 星 R=83.2px | 1280px では星座半径が 2 倍近くになるため、線の長さの違い（旋律の長さ）が視覚で直接読める。2 星座の間隔は充分で融合しない |
| D2 | 余韻 | 消退 p=0.5／帰還中 | 375px と同一の alpha 規則。画面が広い分、薄れ方は静かに見える |

## 4. 幾何注釈図（実装が数値を読むための図）

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="375" height="812" viewBox="0 0 375 812">
  <defs><radialGradient id="h"><stop offset="0" stop-color="#FFD27A" stop-opacity="1"/><stop offset="0.25" stop-color="#FFD27A" stop-opacity="0.68"/><stop offset="0.5" stop-color="#FFD27A" stop-opacity="0.30"/><stop offset="1" stop-color="#FFD27A" stop-opacity="0"/></radialGradient></defs>
<rect width="375" height="812" fill="#0B1026"/>
<circle cx="262.3" cy="723.7" r="1" fill="#FFD27A" opacity="0.39"/>
<circle cx="301.5" cy="54.9" r="1.6" fill="#FFD27A" opacity="0.36"/>
<circle cx="76.6" cy="779.3" r="1.3" fill="#FFD27A" opacity="0.28"/>
<circle cx="242.1" cy="556.6" r="1.6" fill="#FFD27A" opacity="0.24"/>
<circle cx="181.8" cy="118.8" r="1.2" fill="#FFD27A" opacity="0.29"/>
<circle cx="36.5" cy="286.3" r="1.7" fill="#FFD27A" opacity="0.22"/>
<circle cx="163.9" cy="39.6" r="1.6" fill="#FFD27A" opacity="0.2"/>
<circle cx="74.5" cy="600.3" r="1.4" fill="#FFD27A" opacity="0.3"/>
<circle cx="226.3" cy="403.4" r="1.3" fill="#FFD27A" opacity="0.21"/>
<circle cx="60.5" cy="171.4" r="1.2" fill="#FFD27A" opacity="0.25"/>
<circle cx="326.6" cy="179.1" r="1.1" fill="#FFD27A" opacity="0.24"/>
<circle cx="56.8" cy="666.6" r="1.8" fill="#FFD27A" opacity="0.35"/>
<circle cx="348.5" cy="445.5" r="1.4" fill="#FFD27A" opacity="0.26"/>
<circle cx="241.7" cy="199.6" r="1.4" fill="#FFD27A" opacity="0.27"/>
<circle cx="247.3" cy="700.2" r="1.5" fill="#FFD27A" opacity="0.21"/>
<circle cx="220.7" cy="589.2" r="1.4" fill="#FFD27A" opacity="0.19"/>
<circle cx="43.4" cy="436.8" r="1.6" fill="#FFD27A" opacity="0.29"/>
<circle cx="268.7" cy="445.2" r="1.7" fill="#FFD27A" opacity="0.23"/>
<circle cx="262.3" cy="723.7" r="3.2" fill="url(#h)" opacity="0.10"/>
<circle cx="262.3" cy="723.7" r="1" fill="#FFF3D6" opacity="0.49"/>
<circle cx="163.9" cy="39.6" r="5.1" fill="url(#h)" opacity="0.10"/>
<circle cx="163.9" cy="39.6" r="1.6" fill="#FFF3D6" opacity="0.30000000000000004"/>
<circle cx="348.5" cy="445.5" r="4.4" fill="url(#h)" opacity="0.10"/>
<circle cx="348.5" cy="445.5" r="1.4" fill="#FFF3D6" opacity="0.36"/>
<circle cx="205" cy="470" r="112.5" fill="none" stroke="#8A93B8" stroke-width="1" stroke-dasharray="4 4" opacity="0.7"/>
<circle cx="205" cy="470" r="43.3" fill="none" stroke="#8A93B8" stroke-width="1" stroke-dasharray="2 3" opacity="0.9"/>
<circle cx="205" cy="470" r="90" fill="none" stroke="#8A93B8" stroke-width="1" stroke-dasharray="6 4" opacity="0.8"/>
<rect x="18" y="18" width="339" height="776" fill="none" stroke="#8A93B8" stroke-width="0.8" stroke-dasharray="3 5" opacity="0.5"/>
<path d="M 197 470 H 213 M 205 462 V 478" stroke="#8A93B8" stroke-width="1.2"/>
<circle cx="150" cy="445" r="14" fill="url(#h)" opacity="0.3"/>
<circle cx="150" cy="445" r="3.2" fill="#FFF3D6" opacity="1.0"/>
<circle cx="150" cy="457" r="12" fill="url(#h)" opacity="0.27"/>
<circle cx="150" cy="457" r="2.9" fill="#FFF3D6" opacity="1.0"/>
<path d="M 150 445 V 457" stroke="#8A93B8" stroke-width="0.8"/>
<circle cx="150" cy="445" r="14" fill="none" stroke="#8A93B8" stroke-width="0.7" stroke-dasharray="2 3"/>
<text x="205" y="349" font-family="'Noto Sans CJK JP',sans-serif" font-size="11" fill="#8A93B8" text-anchor="middle">吸引候補 半径112.5=S×0.30</text>
<text x="205" y="373" font-family="'Noto Sans CJK JP',sans-serif" font-size="11" fill="#8A93B8" text-anchor="middle">R(2700ms)=90</text>
<text x="258" y="441" font-family="'Noto Sans CJK JP',sans-serif" font-size="11" fill="#8A93B8" text-anchor="start">R(300ms)=43.3</text>
<text x="24" y="34" font-family="'Noto Sans CJK JP',sans-serif" font-size="11" fill="#8A93B8" text-anchor="start">余白 18px</text>
<text x="128" y="455" font-family="'Noto Sans CJK JP',sans-serif" font-size="11" fill="#8A93B8" text-anchor="end">12px以上</text>
<text x="28" y="500" font-family="'Noto Sans CJK JP',sans-serif" font-size="11" fill="#8A93B8" text-anchor="start">暈 半径 8〜14px / 芯 1.4〜2.6px</text>
<text x="28" y="514" font-family="'Noto Sans CJK JP',sans-serif" font-size="11" fill="#8A93B8" text-anchor="start">吸引時 暈 10〜16px / 芯 2.4〜3.6px</text>
</svg>
```

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
  <defs><radialGradient id="h"><stop offset="0" stop-color="#FFD27A" stop-opacity="1"/><stop offset="0.25" stop-color="#FFD27A" stop-opacity="0.68"/><stop offset="0.5" stop-color="#FFD27A" stop-opacity="0.30"/><stop offset="1" stop-color="#FFD27A" stop-opacity="0"/></radialGradient></defs>
<rect width="1280" height="800" fill="#0B1026"/>
<circle cx="20.9" cy="248" r="1.6" fill="#FFD27A" opacity="0.37"/>
<circle cx="1138.7" cy="768.2" r="1.1" fill="#FFD27A" opacity="0.24"/>
<circle cx="674.1" cy="517.2" r="1.2" fill="#FFD27A" opacity="0.34"/>
<circle cx="355.8" cy="539.7" r="1.5" fill="#FFD27A" opacity="0.25"/>
<circle cx="545" cy="543.9" r="1.4" fill="#FFD27A" opacity="0.25"/>
<circle cx="1192.2" cy="279.6" r="1.3" fill="#FFD27A" opacity="0.2"/>
<circle cx="1204.8" cy="552.9" r="1.5" fill="#FFD27A" opacity="0.29"/>
<circle cx="248.5" cy="20.2" r="1.4" fill="#FFD27A" opacity="0.36"/>
<circle cx="1257.9" cy="83.5" r="1.1" fill="#FFD27A" opacity="0.2"/>
<circle cx="203.9" cy="597.1" r="1.5" fill="#FFD27A" opacity="0.36"/>
<circle cx="496.6" cy="142.7" r="1.7" fill="#FFD27A" opacity="0.4"/>
<circle cx="158.9" cy="55.1" r="1.1" fill="#FFD27A" opacity="0.25"/>
<circle cx="838.7" cy="550.7" r="1.2" fill="#FFD27A" opacity="0.22"/>
<circle cx="685.3" cy="773.6" r="1.8" fill="#FFD27A" opacity="0.19"/>
<circle cx="151.8" cy="39.2" r="1.4" fill="#FFD27A" opacity="0.28"/>
<circle cx="941.8" cy="268.8" r="1.7" fill="#FFD27A" opacity="0.35"/>
<circle cx="373.1" cy="740.2" r="1.5" fill="#FFD27A" opacity="0.18"/>
<circle cx="956.6" cy="520.9" r="1.6" fill="#FFD27A" opacity="0.31"/>
<circle cx="510.5" cy="579.9" r="1.5" fill="#FFD27A" opacity="0.19"/>
<circle cx="545.8" cy="367.6" r="1.2" fill="#FFD27A" opacity="0.33"/>
<circle cx="320.1" cy="738.1" r="1.5" fill="#FFD27A" opacity="0.22"/>
<circle cx="453.7" cy="150.2" r="1.4" fill="#FFD27A" opacity="0.27"/>
<circle cx="313.6" cy="227.3" r="1.3" fill="#FFD27A" opacity="0.4"/>
<circle cx="195.6" cy="761.6" r="1.2" fill="#FFD27A" opacity="0.26"/>
<circle cx="20.9" cy="248" r="5.1" fill="url(#h)" opacity="0.10"/>
<circle cx="20.9" cy="248" r="1.6" fill="#FFF3D6" opacity="0.47"/>
<circle cx="1204.8" cy="552.9" r="4.9" fill="url(#h)" opacity="0.10"/>
<circle cx="1204.8" cy="552.9" r="1.5" fill="#FFF3D6" opacity="0.39"/>
<circle cx="838.7" cy="550.7" r="3.8" fill="url(#h)" opacity="0.10"/>
<circle cx="838.7" cy="550.7" r="1.2" fill="#FFF3D6" opacity="0.32"/>
<circle cx="510.5" cy="579.9" r="4.8" fill="url(#h)" opacity="0.10"/>
<circle cx="510.5" cy="579.9" r="1.5" fill="#FFF3D6" opacity="0.29000000000000004"/>
<circle cx="700" cy="430" r="216" fill="none" stroke="#8A93B8" stroke-width="1" stroke-dasharray="4 4" opacity="0.7"/>
<circle cx="700" cy="430" r="83.2" fill="none" stroke="#8A93B8" stroke-width="1" stroke-dasharray="2 3" opacity="0.9"/>
<circle cx="700" cy="430" r="172.8" fill="none" stroke="#8A93B8" stroke-width="1" stroke-dasharray="6 4" opacity="0.8"/>
<rect x="18" y="18" width="1244" height="764" fill="none" stroke="#8A93B8" stroke-width="0.8" stroke-dasharray="3 5" opacity="0.5"/>
<path d="M 692 430 H 708 M 700 422 V 438" stroke="#8A93B8" stroke-width="1.2"/>
<circle cx="560" cy="540" r="14" fill="url(#h)" opacity="0.3"/>
<circle cx="560" cy="540" r="3.2" fill="#FFF3D6" opacity="1.0"/>
<circle cx="560" cy="552" r="12" fill="url(#h)" opacity="0.27"/>
<circle cx="560" cy="552" r="2.9" fill="#FFF3D6" opacity="1.0"/>
<path d="M 560 540 V 552" stroke="#8A93B8" stroke-width="0.8"/>
<circle cx="560" cy="540" r="14" fill="none" stroke="#8A93B8" stroke-width="0.7" stroke-dasharray="2 3"/>
<text x="700" y="204" font-family="'Noto Sans CJK JP',sans-serif" font-size="11" fill="#8A93B8" text-anchor="middle">吸引候補 半径216=S×0.30</text>
<text x="700" y="248" font-family="'Noto Sans CJK JP',sans-serif" font-size="11" fill="#8A93B8" text-anchor="middle">R(2700ms)=172.8</text>
<text x="700" y="336" font-family="'Noto Sans CJK JP',sans-serif" font-size="11" fill="#8A93B8" text-anchor="middle">R(300ms)=83.2</text>
<text x="24" y="34" font-family="'Noto Sans CJK JP',sans-serif" font-size="11" fill="#8A93B8" text-anchor="start">余白 18px</text>
<text x="538" y="550" font-family="'Noto Sans CJK JP',sans-serif" font-size="11" fill="#8A93B8" text-anchor="end">12px以上</text>
<text x="640" y="546" font-family="'Noto Sans CJK JP',sans-serif" font-size="11" fill="#8A93B8" text-anchor="start">暈 半径 8〜14px / 芯 1.4〜2.6px（吸引時 暈 10〜16px / 芯 2.4〜3.6px）</text>
</svg>
```

- 破線の 3 円: 吸引候補の選定半径（S×0.30・下限 96px）、R(300ms)、R(2700ms)。R(t) = S×(0.10 + 0.14×min(t/2700, 1))（正本どおり）。S=375 で 37.5→90.0px、S=720 で 72.0→172.8px。
- 内側の破線矩形: 画面端 18px の余白。星座全体がこの内側へ収まるように星群ごと平行移動する（星ごとに x/y を clamp しない）。背景星は画面外で出入りさせ、端に列を作らない。
- 十字: 指の平滑化位置（時定数 90ms）。星はこの点を中心に、捕獲順に位相をずらした不規則な軌道で寄る（式は第 9 章）。
- 「12px以上」: 隣接星の中心間隔の目標。暈（半径 14px）が 2 重になるのはこの間隔のときだけで、積算 alpha の上限 0.45 と合わせて暈の濁りを防ぐ（第 12 章）。

## 5. カラートークン

色は 3 色しか使わない。alpha を変えて明るさを作り、色相を増やさない。以下の輝度 Y は相対輝度（WCAG の定義）の実測値。

| トークン（tuning.ts の定数名） | 値 | HSL | Y | 用途 |
|---|---|---|---|---|
| `PALETTE_BACKGROUND` | `#0B1026` | 229°, 0.55, 0.096 | 0.0058 | 背景の夜空。毎フレーム不透明で 1 回塗り |
| `PALETTE_STAR` | `#FFD27A` | 40°, 1.0, 0.739 | 0.6876 | 星の暈・線・先端光点。背景とのコントラスト 13.22:1 |
| `PALETTE_CORE` | `#FFF3D6` | 42°, 1.0, 0.92 | 0.9022 | 星の芯のみ。背景とのコントラスト 17.06:1 |

派生値（同じ 3 色の alpha 指定。独立した色定数は作らない）:

| トークン（提案名） | 値 | 用途 |
|---|---|---|
| `LINE_CORE_WIDTH_PX` / `LINE_HALO_WIDTH_PX` | 0.8 / 2.5 | 線の芯・暈の幅（正本の範囲 0.7〜1px／2〜3px の採用値） |
| `LINE_CORE_ALPHA` / `LINE_HALO_ALPHA` | 0.85 / 0.18 | 芯の実効コントラスト 9.69:1、暈は 2.04:1 の淡いグロー |
| `HALO_IDLE_ALPHA_MIN`〜`MAX` | 0.10〜0.16 | 未所属星・背景星の暈 |
| `HALO_ACTIVE_ALPHA_MIN`〜`MAX` | 0.24〜0.32 | 収集中・発音増光中の暈 |
| `BG_STAR_ALPHA_MIN`〜`MAX` | 0.18〜0.40 | 背景星の芯の明るさ幅（等級差） |

- **白の禁止**: `#FFFFFF` は使わない。画面で最も明るいのは芯 `#FFF3D6`（Y 0.902）であり、これを超える輝度の要素は存在しない（審美基準 6 の白飽和を構造的に排除）。
- debug オーバーレイ（`?debug` のみ）はテンプレートのままとし、作品画面の審美判定の対象外とする。

## 6. 星・線の描画トークン

| トークン | 値 | 根拠 |
|---|---|---|
| `STAR_CORE_IDLE_MIN`〜`MAX_PX` | 1.4〜2.6 | 正本の固定値 |
| `STAR_CORE_ACTIVE_MIN`〜`MAX_PX` | 2.4〜3.6 | 正本の固定値（収集中・発音増光時） |
| `STAR_HALO_IDLE_MIN`〜`MAX_PX` | 8〜14 | 正本の固定値 |
| `STAR_HALO_ACTIVE_MIN`〜`MAX_PX` | 10〜16 | デザイン追加（収集中の暈拡大） |
| 暈のグラデ | 半径方向に alpha = A×(1−r/R)^1.8 の近似（4 停止点: 0 で 1.0、0.25 で 0.68、0.5 で 0.30、1 で 0） | 第 12 章の茶色帯対策。外周を急に落として alpha 0.2〜0.35 の帯の面積を芯の下へ隠す |
| `HALO_MAX_STACK_ALPHA` | 0.45 | 同一画素への暈の積算上限。隣接星の重なりでも超えない |
| 合成モード | source-over のみ。`lighter`・`screen`・`add` 禁止 | 第 12 章の実測（加算では白飛び） |
| `HOLD_PULSE_MS` / `HOLD_PULSE_AMPLITUDE` | 1600 / ±0.08 | 2.7 秒到達後と保持中の微明滅（正本「穏やかな呼吸」の採用値） |
| `WAITING_HALO_SCALE` | 0.7 | 音声 suspended 中の微光待機（正本 §3 の採用値） |

線の形状: 芯 0.8px は `#FFD27A` alpha 0.85 の直線、その下に幅 2.5px alpha 0.18 の暈を 1 本重ねる。保持中の線 alpha は完成時の 0.9 倍以上（0.765 以上＝コントラスト 7.98:1 以上）を維持し、FADE の 2 秒で 0 へ向かう。線幅は全状態で変えない。角は `round` 結合で折れ線の屈曲を滑らかにする。

## 7. 幾何・余白トークン

| トークン | 値 | 根拠 |
|---|---|---|
| `STAR_POOL_SIZE` / `MAX_POINTERS` / `MAX_CONSTELLATIONS` | 96 / 2 / 4 | 正本の固定値 |
| `MIN_STARS` / `MAX_STARS` / `STAR_ADD_MS` | 3 / 12 / 300 | N(t) = min(12, 3 + floor(max(0,t)/300))。0/300/1200/2700ms で 3/4/7/12 星・線は N−1 本 |
| `RADIUS_MIN_RATIO` / `RADIUS_MAX_RATIO` | 0.10 / 0.24 | R(t) = S×(0.10 + 0.14×min(t/2700,1))、S = min(width, height, 720) |
| `EDGE_MARGIN_PX` | 18 | 星座全体を画面内へ平行移動するときの余白 |
| `STAR_MIN_GAP_PX` | 12 | 隣接星の中心間隔の目標 |
| `ATTRACT_CANDIDATE_RADIUS_RATIO` / `ATTRACT_CANDIDATE_RADIUS_MIN_PX` | 0.30 / 96 | 押下時に近い未所属星を選ぶ範囲（S×0.30、下限 96px）。375px で 112.5px |
| `ATTRACT_SPAWN_RING_MIN`〜`MAX_PX` | 48〜90 | 範囲内に星が足りないとき、指の周囲のこのリング上へ同質の星を新規配置（プール総数 96 は維持） |
| `ATTRACT_SPAWN_FADE_MS` | 250 | 新規配置星の立ち上がり時間 |
| 背景星の寸法 | 半径 1.0〜1.8px・暈なし（上位の等級のみ微小暈 alpha 0.10・半径 3.2〜5.8px） | デザイン追加。星 96 個と同じ芯＋暈の関数から暈を弱めた同一質感 |

375px と 1280px の構図の差は「星座半径と背景星の疎密」だけ。星の寸法・線幅・alpha・時間は共通（第 2・3 章の比較参照）。

## 8. 時間トークン

正本の固定値（転記）:

| トークン | 値 | 意味 |
|---|---|---|
| `CHARGE_MAX_MS` | 2700 | 長押しの成長上限。以後は星数・半径を増やさず微明滅のみ |
| `FOLLOW_TAU_MS` | 90 | 指追従の指数平滑の時定数（dt 上限 50ms） |
| `FIRST_NOTE_DELAY_MS` | 40 | 解放から最初の発音・始点増光まで |
| `STEP_MS` | 160 | 音と線の刻み。4 星は 480ms、12 星は 1760ms の旋律 |
| `HOLD_MS` / `FADE_MS` / `RETURN_MS` | 2000 / 2000 / 600 | 最終音後の保持・消退・帰還。合計 4.6 秒結果が残る |
| 最初の可聴・増光の上限 | 120ms | 音声稼働時。視覚との許容差 50ms |

デザイン追加:

| トークン | 値 | 意味 |
|---|---|---|
| `INTRO_STAR_COUNT` / `INTRO_SPREAD_RATIO` / `INTRO_SPREAD_MAX_PX` | 5 / 0.064 / 40 | 中央星群の構成（375px で 24px、S=720 で 40px） |
| `INTRO_BREATH_MS` | 3400 | 中央星群の呼吸周期（広がり ±15% と明滅 ±0.06 を同期） |
| `BRIGHTEN_RISE_MS` / `BRIGHTEN_DECAY_MS` | 60 / 420 | 発音・到達増光の立ち上がりと減衰（指数減衰） |
| `BRIGHTEN_CORE_SCALE` / `BRIGHTEN_HALO_ALPHA_SCALE` | 1.35 / 1.6 | 増光の芯の半径倍率・暈 alpha 倍率（暈 alpha は 0.45 の積算上限内） |
| `HEAD_DOT_CORE_PX` / `HEAD_DOT_HALO_PX` / `HEAD_DOT_ALPHA` | 2.6 / 11 / 0.30 | 結線中の先端光点 |
| `FADE_CURVE_EXP` | 1.6 | 消退の alpha 曲線 (1−p)^1.6（p=0.25 で 0.63、p=0.5 で 0.33、p=0.75 で 0.11） |
| `RETURN_EASING` | cubic-out（1−(1−p)^3） | 帰還 600ms の位置のイージング |
| `BG_STAR_TWINKLE_AMPLITUDE` / 周期 | ±0.06 / 4〜7 秒（星ごとに乱数） | 背景星の微明滅。画質の低段では停止させる（軽量化の対象） |
| `GATE_HIDE_MS` | 500 | 導入画面の退場時間（既存の opacity 遷移を維持） |

## 9. 反応トークン（操作から見える変化）

1. **押下 80ms 規則の具体化**: 指数平滑 τ=90ms は 80ms で距離の 58.9% を進む。指から 100px の星は 80ms で約 59px 動く。合格の下限として「押下 80ms 後に、確保済みの最近接星が指方向へ 10px 以上移動し、暈 alpha が 0.05 以上上がる」を実装後の動画・フレーム差分で確認する（正本 ST-02 に対応）。
2. **吸引の軌道**: 星の目標点は星座円上の角度位置だが、到達までの間は角度 φ = θ_target + 0.35×sin(2π×t/2400 + phase_i)、半径の揺らぎ ±6% の不規則軌道で寄る。phase_i は捕獲順に黄金比（0.618×i×2π）でずらす。星を中心 1 点へ潰さない（正本の規定の採用式）。
3. **解放 → 結線**: 解放時刻で星の位置を固定し角度順に確定（同角度は starId 順）。始点の星は `FIRST_NOTE_DELAY_MS`(40ms) 後に増光のみ、以後 160ms 刻みで線 i が `at(i−1)` から `at(i)` まで線形に伸び、到達星が 60ms で立ち上がり 420ms で減衰する増光を示す。線の伸びの途中に先端光点（2.6px）を置く。音は既存の接点（正本 §4・§5）に従い、視覚は返された可聴時刻を読む。suspended 中は星と線を先走らせない。
4. **0.3 秒の成功基準**: 300ms の押しで 4 星・3 線・4 音。最終音は解放後 520ms、旋律は 480ms。星座は最終音から 2 秒保持＋2 秒消退＋0.6 秒帰還で、解放後約 5.1 秒間、画面に結果が残る。短押しを失敗にしない（正本の手応えの約束 2）。
5. **2.7 秒以降**: 星数・半径は増やさず、保持星の微明滅（±0.08・1.6 秒周期）だけを続ける。自動暴発しない。
6. **2 指の独立**: 各指の星群は各指の平滑位置へ寄る。近接しても融合・再割当せず、片方の解放で他方を解放しない。カンプ C1・D1 の 2 星座が視覚の正である。

## 10. 導入画面（intro）の非言語設計

- **画面の内容**: 文字ゼロ・部品ゼロの星空。中央の 5 星だけが呼吸（3.4 秒周期・広がり ±15%）と明滅（±0.06）でわずかに生きて見える。他の背景星より明るい（暈 alpha 0.26 に対し 0.10〜0.16）ため、視線は自然に中央へ落ちる。
- **style.css の変更（描画工程が行う）**: `--palette-base` を `#0B1026` へ。`#gate` の背景 `rgba(7,7,13,0.35)` の薄幕を撤去（transparent）し、導入中も星空をそのまま見せる。`#gate-title` と `#gate-text` を `display: none` にする。操作説明を別の場所へ移さない。`#gate` は全面の透明なヒット領域として残し、`cursor: pointer` と退場の opacity 遷移（0.5s）は維持。`#gate.is-hidden` の機構はそのまま使う。
- **押下後の連続性**: 中央星群は未所属プールと同一の描画関数で描かれた星であり、最初の押下で他の星と同じ吸引規則に従う。特別な変形演出を作らない（押下 80ms 後には動き始めるため、導入から収集へ質感を保ったまま連続する）。初回タップも 3 星以上の小さな報酬を返す。
- **html の title/meta・favicon は現状のまま**（担当外の index.html は変更しない。favicon は作品画面外であり質感一致の審美判定の対象外とする）。

## 11. 状態別の見え方

| 状態 | 星 | 線 | 音 | 視覚の要点 |
|---|---|---|---|---|
| intro | 中央 5 星が呼吸・明滅。背景星は微明滅 | なし | なし | 文字なし薄幕なし。中央タップで開始 |
| collecting | 指へ不規則軌道で寄り増光（芯 2.8〜3.2px・暈 0.26〜0.30）。300ms ごとに +1 星 | なし | なし（ドローンも作らない） | 増光は押下 80ms 以内に始まる |
| waiting（音声解錠待ち） | 固定位置で微光待機（暈 ×0.7） | なし | なし | 描画を止めない。解錠後に結線へ |
| linking | 到達星が順に増光（60ms 立ち上がり・420ms 減衰） | 線形に伸びる＋先端光点 | 1 星 1 音・160ms 刻み | 音と増光は同じ時刻（許容差 50ms）。pending 中は先走らない |
| holding | 増光が減衰し芯 2.4〜2.8px へ落ち着く。微明滅 ±0.08 | alpha 0.765 以上を保持 | 余韻のみ | 最終音後 2 秒。次の操作を受け付ける |
| fading | 全体 alpha (1−p)^1.6 | 同（線幅は変えない） | なし | 2 秒かけて静かに薄れる。フラッシュしない |
| returning | 線なし。星が cubic-out 600ms で元の空の位置へ | なし | なし | 到着後、未所属の質感（暈 0.10〜0.16）へ 250ms で戻る |

中断・音声停止・5 個目の解放などの扱いは正本 §3 の状態表に従う（視覚は「静かに 300ms で空へ戻す」「微光で待機」など正本の記述を実装する）。

## 12. 審美基準（定量・実測つき）

以下は本書の策定時に実測した数値に基づく。実装後は ST-15 のスクリーンショット判定で同じ項目を確認する。

1. **茶色・オリーブの回避**: `#FFD27A` を単層で背景に重ねると、alpha 0.20〜0.30 の帯は色相 23°（L 0.26 の暗い茶色寄り）になる実測がある（alpha 0.18 では青寄り 330°、alpha 0.44 以上では金 36〜38°）。対策は (a) 暈のグラデを急峻にして（(1−r/R)^1.8）この帯の面積を芯の直径の下へ隠す、(b) 暈の積算 alpha を 0.45 以下に抑える（2 重・3 重の重なりでも合成は B/R ≥ 0.55 の金系を保つ）、(c) 暈の帯を面として使わない（全面への暖色の積算は禁止）。検収は「星から 24px 以上離れた点の輝度 Y ≤ 0.06（背景とほぼ同値）」「画面の平均輝度が背景のみの状態から +0.01 を超えない」で判定する。
2. **白飽和の回避**: `lighter` 加算の最悪ケース（暈 0.25×3 層＋芯）は (255,255,255) に到達する実測。よって加算モード禁止（第 6 章）と `#FFFFFF` 不使用（第 5 章）で構造的に排除する。検収は「Y ≥ 0.92 の画素が画面のどこにも現れない（芯 Y 0.902 が上限）」。
3. **質感の一致**: 全状態で同一の星描画・線描画（第 1 章）。検収は「intro と操作後のスクショから星を並べ、芯の色相同一・暈の形同一・差が半径と alpha のみであること」。
4. **矩形端の堰き止め回避**: 背景星は画面外で出入りし、端に列状・矩形状の配置を作らない。星座は星群ごとの平行移動で 18px 余白へ収める。検収は「画面の四辺に沿った直線の切り欠き・粒子の列が見えない」。
5. **太い原色輪・単調グラデの回避**: 輪（stroke の円）は常時描かない。背景にグラデーションを置かない（単色 `#0B1026` のみ）。
6. **線の視認性**: 線の芯は背景に対し 9.69:1、保持中でも 7.98:1 以上。375px でも線が塵に埋もれず、解放後の輪郭が読める（正本 §7 の要求）。
7. **静けさの維持**: 常時動くのは背景星の微明滅（±0.06）だけ。画面全体の明るさの瞬間変化（フラッシュ）は存在しない。

## 13. 検収チェックリスト（実装後・375px と 1280px の両幅で）

1. intro に文字・部品・薄幕がなく、中央の星群が唯一の明るい焦点である
2. intro の星と操作後の星が同じ質感（芯・暈の形と色相同一）
3. 押下 80ms 後に星が動き始め増光する（動画またはフレーム差分で 10px 以上）
4. 0.3 秒操作後に 4 星・3 線の星座が残り、4 音が鳴る
5. 結線中、線は 160ms 刻みで伸び、先端に小さな光点がある。到達星だけが増光する
6. 12 星完成時、閉路・星座間の線がなく、最上部始点の時計回りの折れ線である
7. 2 指で 2 つの星群が独立し、融合しない。片方だけ解放できる
8. 保持中の線が視認できる（完成時の 0.9 倍以上の濃さ）
9. 消退はフラッシュなしの静かな alpha 減衰で、線幅が変わらない
10. 画面のどこにも白飛び（Y ≥ 0.92）がなく、暈に茶色・オリーブの帯面がない
11. 画面四辺に粒子の列・直線の堰き止めがない
12. 375px で星が塵にならず、1280px と同じ質感・存在感で星座が読める
13. 375px・1280px とも横スクロールがない（正本 ST-14 と重複確認）

## 14. 実装への引き渡しメモ

- **tuning.ts**: 第 5〜8 章の表の定数名で転記する。正本 §7 の表にある定数（`PALETTE_*`・`STAR_POOL_SIZE`・`MAX_POINTERS`・`MAX_CONSTELLATIONS`・`MIN_STARS`・`MAX_STARS`・`STAR_ADD_MS`・`CHARGE_MAX_MS`・`FOLLOW_TAU_MS`・`RADIUS_MIN_RATIO`・`RADIUS_MAX_RATIO`・`FIRST_NOTE_DELAY_MS`・`STEP_MS`・`HOLD_MS`・`FADE_MS`・`RETURN_MS`・`MAX_VOICES`・`NOTE_ATTACK_MS`・`NOTE_DECAY_MS`）は正本の値をそのまま使い、それ以外は本書の「デザイン追加」の値を使う。実装では「正本は docs/architecture.md」とコメントする（正本の規定）。
- **style.css**: 第 10 章の 4 点（`--palette-base`・薄幕撤去・文字非表示・ヒット領域維持）。
- **main.ts**: 第 6 章の描画関数・第 9 章の反応・第 11 章の状態ごとの差分パラメータ。背景は毎フレーム不透明で 1 回塗り（テンプレートの半透明の残像塗りは廃止）。
- **音**: 本書は視覚のみを扱う。音色・音量・同期の実装は音響工程が正本 §4〜6 に従って行う。
- **画質の自動調整**: 暈の層数（2→1）と背景星の微明滅の停止のみを軽量化の対象にし、収集数・音数・色・寿命・同期は全段階共通（正本の規定）。
- **生成画像は 0 枚**（画像発注書どおり）。本書の SVG カンプは仕様の図であって作品のアセットではない。サムネイルは仕上げ工程が実画面のスクリーンショットから作る。
