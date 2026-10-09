# 開発者向け情報（cpk-calc）

利用者向けの説明は [README.md](README.md) にあります。

## ファイル構成

```
index.html             画面（スタイルを含む）。解説は docs/explanation.md から埋め込む
js/stats.js            統計計算（分布関数、Shapiro-Wilk、検定、工程能力指数、管理図）。Node でも読み込み可
js/xlsx.js             .xlsx の読み書きと CSV の読み込み（外部ライブラリなし）
js/charts.js           SVG のグラフと PNG 保存
js/app.js              画面処理
sw.js                  オフライン用のキャッシュ処理（Service Worker）
manifest.webmanifest   アプリとして追加するための設定
icons/                 アプリアイコン
samples/sample.xlsx    「サンプルデータで試す」のデータ
docs/explanation.md    「解説」タブの原稿
docs/screenshots/      README 用のスクリーンショット
tools/build.py         解説を index.html に埋め込む
tests/                 テスト（下記）
.github/workflows/     push 時の自動テスト
```

## 更新して公開するとき

- `index.html`・`js/`・`icons/`・`samples/` を変更したら、**`sw.js` 先頭の `VERSION` を必ず上げてから** push してください。上げないと、すでに使っている人の端末に古いファイルが残り続けます
- 解説を直すときは `docs/explanation.md` を編集し、`python tools/build.py`（`pip install markdown`）で index.html に埋め込んでください。埋め込み忘れは CI で検出します
- GitHub Pages は main ブランチのルートを公開しています

## テスト

```
node tests/test.js                    # 不一致があれば終了コード 1
python tests/make_reference.py        # 参照値 tests/reference.json を作り直す（numpy・scipy・pandas）
python tests/make_xlsx_fixtures.py    # Excel 入出力テスト用のファイルと期待値を作り直す（openpyxl）
```

- `tests/test.js`：分布関数・Shapiro-Wilk・歪度・尖度・検定・相関・工程能力指数・推定不良率（ppm）・サイズが揃わないサブグループの σ と管理限界を scipy / numpy / pandas の参照値と照合し、d2 係数を数値積分で求め直して照合します。管理図の異常判定ルールは、ルールごとに作った並びで判定結果を確認します
- `tests/test-xlsx.js`：openpyxl で作ったファイルと Excel で作ったサンプルを読み、openpyxl で読んだ値と全セル照合します。書き出したファイルは自分で読み戻し、openpyxl でも読めることを確認します（python と openpyxl がない環境ではこの確認だけ省略）
- 工程能力指数の参照値は、同じ定義を numpy で独立に書いて求めています

## 実装のメモ

- **Shapiro-Wilk 検定**：Royston (1995) の AS R94（scipy.stats.shapiro と同じアルゴリズム）。n は 3〜5000
- **正規分布**：相補誤差関数は W. J. Cody の有理近似、分位点は Wichura の AS241
- **t・F・カイ二乗分布**：不完全ベータ関数・不完全ガンマ関数（連分数展開）から計算し、分位点は二分法
- **xlsx の読み込み**：ZIP をブラウザ標準の `DecompressionStream('deflate-raw')` で展開し、`xl/workbook.xml`・共有文字列・ワークシートの XML を読みます。ふりがな（`rPh`）は除きます
- **サイズが揃わないサブグループ**：σ(群内) は各サブグループの R/d2(n) の平均。管理限界は X̄: X̄̄ ± A2(n)·d2(n)·σ、R: D3(n)·d2(n)·σ 〜 D4(n)·d2(n)·σ、s: B3(n)·c4(n)·σs 〜 B4(n)·c4(n)·σs（σs は s/c4(n) の平均）。サイズが揃えば通常の A2·R̄、D4·R̄、B4·s̄ と一致します
- **異常判定ルール**：JIS Z 9020-2 の 8 ルール（`runRules`）。点ごとの σ（管理限界までの 1/3）で領域を決めるので、管理限界が変わる図にも使えます
- **xlsx の書き出し**：無圧縮 ZIP の最小構成（インライン文字列、1 行目を太字・固定）
