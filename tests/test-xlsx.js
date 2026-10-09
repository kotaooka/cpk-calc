// Excel 入出力のテスト（tests/test.js から呼ばれる）
//   1. openpyxl で作ったファイル・Excel で作ったサンプルを読み、openpyxl で読んだ値と照合
//   2. ふりがな（rPh）・エスケープ・CSV の読み込み
//   3. 書き出したファイルを自分で読み戻し、さらに openpyxl でも読めることを確認（python が使える環境のみ）
const fs = require('fs'), path = require('path'), zlib = require('zlib'), { spawnSync } = require('child_process');
const X = require('../js/xlsx.js');
const inflate = async d => new Uint8Array(zlib.inflateRawSync(d));
const F = p => path.join(__dirname, 'fixtures', p);

module.exports = async function (check, fails, count) {
  const same = (name, got, exp) => { count(); if (JSON.stringify(got) !== JSON.stringify(exp)) fails.push(`${name}: 計算 ${JSON.stringify(got).slice(0, 300)} / 期待 ${JSON.stringify(exp).slice(0, 300)}`); };
  for (const [file, exp] of [['made.xlsx', 'made.expected.json'], ['../../samples/sample.xlsx', 'sample.expected.json']]) {
    const wb = await X.readXlsx(fs.readFileSync(F(file)), inflate);
    const e = JSON.parse(fs.readFileSync(F(exp), 'utf8'));
    same(`${file} シート名`, wb.sheets.map(s => s.name), e.map(s => s.name));
    e.forEach((s, i) => same(`${file} ${s.name} の全セル`, wb.sheets[i].cells, s.cells));
  }
  // ふりがな・エスケープ
  same('ふりがなを除く', X.richText('<r><t>外径</t></r><rPh sb="0" eb="2"><t>ガイケイ</t></rPh><phoneticPr fontId="1"/>'), '外径');
  same('エスケープ', X.richText('<t>A&amp;B &lt;1&gt; &#x3C6;_x000D_</t>'), 'A&B <1> φ\r');
  same('インライン文字列と型', X.parseSheet('<sheetData><row r="2"><c r="B2" t="inlineStr"><is><t>あ</t></is></c><c r="C2" t="b"><v>1</v></c><c r="D2" t="e"><v>#DIV/0!</v></c><c r="E2" t="str"><v>式</v></c><c r="F2"><v>2.5</v></c></row></sheetData>', []),
    [[1, 1, 'あ'], [1, 2, 'TRUE'], [1, 4, '式'], [1, 5, 2.5]]);
  same('CSV（引用符・改行・数値）', X.readCsv('﻿a,"b,1","c""d"\r\n1,2.5,"x\ny"\n,-3e-2,\n').sheets[0].cells,
    [[0, 0, 'a'], [0, 1, 'b,1'], [0, 2, 'c"d'], [1, 0, 1], [1, 1, 2.5], [1, 2, 'x\ny'], [2, 1, -0.03]]);
  same('TSV', X.readCsv('a\tb\n1\t2\n').sheets[0].cells, [[0, 0, 'a'], [0, 1, 'b'], [1, 0, 1], [1, 1, 2]]);
  same('列文字', [X.colName(0), X.colName(25), X.colName(26), X.colName(701), X.colIndex('AA'), X.colIndex('ZZ')], ['A', 'Z', 'AA', 'ZZ', 26, 701]);

  // 書き出し → 読み戻し
  const rows = [['解析対象', 'Cpk', '備考'], ['外径 φ10', 1.23456789012345, 'A&B <x>'], ['長さ', -0.5, null], ['空', null, '']];
  const out = X.writeXlsx([{ name: '工程能力', rows }, { name: '検定/結果?', rows: [['F値'], [2.5]] }]);
  const back = await X.readXlsx(out, inflate);
  same('書き出し→読み戻し シート名', back.sheets.map(s => s.name), ['工程能力', '検定_結果_']);
  same('書き出し→読み戻し 値', back.sheets[0].cells,
    [[0, 0, '解析対象'], [0, 1, 'Cpk'], [0, 2, '備考'], [1, 0, '外径 φ10'], [1, 1, 1.23456789012345], [1, 2, 'A&B <x>'], [2, 0, '長さ'], [2, 1, -0.5], [3, 0, '空']]);
  const tmp = path.join(require('os').tmpdir(), 'cpk-calc-test.xlsx');
  fs.writeFileSync(tmp, out);
  const py = spawnSync(process.env.PYTHON || 'python3', ['-c',
    'import openpyxl,json,sys;wb=openpyxl.load_workbook(sys.argv[1]);print(json.dumps([[c.value for c in r] for r in wb.worksheets[0].iter_rows()],ensure_ascii=False))', tmp], { encoding: 'utf8' });
  if (py.status === 0) same('openpyxl で読める', JSON.parse(py.stdout), [['解析対象', 'Cpk', '備考'], ['外径 φ10', 1.23456789012345, 'A&B <x>'], ['長さ', -0.5, null], ['空', null, null]]);
  else console.log('（openpyxl が使えないため、書き出したファイルを openpyxl で読む確認は省略）');
};
