// 第三者が公開している例題・認証値との照合テスト（node tests/published.js）。不一致が1件でもあれば終了コード 1
// tests/test.js が「別の方法で自分で計算した参照値」との照合なのに対し、ここでは答えが公開されているものだけを使う
//   - NIST StRD（Statistical Reference Datasets）の一変量データ：認証値（平均・標準偏差）
//   - NIST/SEMATECH e-Handbook of Statistical Methods の数値例：工程能力指数、管理図の係数表、I-MR 管理図、c 管理図
// NIST の資料は米国政府の著作物で、米国では著作権の対象外（17 U.S.C. §105）。データファイルは tests/published/ に原本のまま置いている
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('../js/stats.js');

let n = 0; const fails = [];
// 一致桁数（LRE: log relative error）。NIST StRD の評価に使う指標で、15 前後なら倍精度の限界まで一致
const lre = (got, exp) => {
  if (got === exp) return Infinity;
  return exp === 0 ? -Math.log10(Math.abs(got)) : -Math.log10(Math.abs(got - exp) / Math.abs(exp));
};
function digits(name, got, exp, min) {
  n++;
  const d = lre(got, exp);
  if (!(d >= min)) fails.push(`${name}: 計算 ${got} / 認証値 ${exp}（一致 ${d.toFixed(1)} 桁、必要 ${min} 桁）`);
  return d;
}
// 公開されている値は丸めてあるので、表示桁で比べる（dp：小数点以下の桁数）
function rounded(name, got, exp, dp) {
  n++;
  if (Number(got.toFixed(dp)) !== exp) fails.push(`${name}: 計算 ${got}（小数 ${dp} 桁で ${got.toFixed(dp)}）/ 公開値 ${exp}`);
}

// ---- NIST StRD の一変量データ ----
// 必要桁数は NIST の難易度と、入力の値を倍精度で読んだ時点で失われる桁を踏まえて決めた。
// NumAcc3・NumAcc4 は 1000000.2 や 10000000.2 のような値で、読み込んだ時点の丸め誤差だけで
// 標準偏差の一致桁がそれぞれ約 9.5 桁・8.3 桁に限られる（有理数で厳密に計算して確認した上限）
function readStrd(file) {
  const txt = fs.readFileSync(path.join(__dirname, 'published', file), 'utf8');
  const m = txt.match(/Data\s*:\s*lines\s+(\d+)\s+to\s+(\d+)/);
  const lines = txt.split(/\r?\n/).slice(+m[1] - 1, +m[2]);
  return {
    x: lines.map(s => s.trim()).filter(Boolean).map(Number),
    mean: Number(txt.match(/ybar:\s*(\S+)/)[1]),
    sd: Number(txt.match(/\bs:\s*(\S+)/)[1]),
  };
}
const STRD = [
  // [ファイル, NIST の難易度, 平均の必要桁, 標準偏差の必要桁]
  ['PiDigits.dat', 'lower', 13, 13],
  ['Mavro.dat', 'lower', 13, 12],
  ['Michelso.dat', 'lower', 13, 12],
  ['NumAcc1.dat', 'lower', 13, 13],
  ['NumAcc2.dat', 'average', 13, 13],
  ['NumAcc3.dat', 'average', 13, 9],
  ['NumAcc4.dat', 'higher', 13, 8],
];
const strdReport = [];
for (const [file, level, minMean, minSd] of STRD) {
  const d = readStrd(file);
  const name = file.replace('.dat', '');
  const a = digits(`StRD ${name} 平均`, S.mean(d.x), d.mean, minMean);
  const b = digits(`StRD ${name} 標準偏差`, S.sd(d.x), d.sd, minSd);
  // 工程能力解析の全体の標準偏差（Pp・Ppk に使う s）も同じ値になること
  const cap = S.capability(d.x, null, null, 1);
  digits(`StRD ${name} 工程能力の s`, cap.sigmaOverall, d.sd, minSd);
  strdReport.push({ name, level, n: d.x.length, mean: a, sd: b });
}

// ---- e-Handbook 6.1.6：工程能力指数の数値例 ----
// USL = 20、LSL = 8、平均 16、標準偏差 2 → Cp = 1.0、Cpk = 0.6667、Cpu = 0.6667、Cpl = 1.3333
// ツールはデータから計算するので、平均 16・標準偏差 2（n − 1 で割る）になる 2 点 16 ± √2 を入れ、
// 全体の標準偏差による指数（Pp・Ppk）で確かめる
{
  const x = [16 - Math.SQRT2, 16 + Math.SQRT2];
  const r = S.capability(x, 20, 8, 1);
  rounded('e-Handbook 6.1.6 平均', r.mean, 16, 4);
  rounded('e-Handbook 6.1.6 標準偏差', r.sigmaOverall, 2, 4);
  rounded('e-Handbook 6.1.6 Cp（Pp）', r.Pp, 1.0, 4);
  rounded('e-Handbook 6.1.6 Cpk（Ppk）', r.Ppk, 0.6667, 4);
  rounded('e-Handbook 6.1.6 Cpu（Ppu）', r.Ppu, 0.6667, 4);
  rounded('e-Handbook 6.1.6 Cpl（Ppl）', r.Ppl, 1.3333, 4);
}

// ---- e-Handbook 6.3.2.1：X̄-R 管理図の係数表（A2・D3・D4、n = 2〜10） ----
// ツールの係数は AIAG SPC マニュアル・ASTM E2587 の表の値。D4 は n = 3・5 で NIST の表と 0.001 違う
// （NIST 2.575・2.115、AIAG 2.574・2.114）。正確な値 1 + 3d3/d2 は 2.574591…・2.114499… で、
// 4 桁に丸めると n = 3 は NIST、n = 5 は AIAG が正しい（どちらの表も 1 か所ずつずれている）。
// 管理限界への影響は 0.04〜0.05% で実務上は無視できるため、0.001 以内の一致を合格とし、差は README に書く
const NIST_FACTORS = {
  2: [1.880, 0, 3.267], 3: [1.023, 0, 2.575], 4: [0.729, 0, 2.282], 5: [0.577, 0, 2.115], 6: [0.483, 0, 2.004],
  7: [0.419, 0.076, 1.924], 8: [0.373, 0.136, 1.864], 9: [0.337, 0.184, 1.816], 10: [0.308, 0.223, 1.777],
};
const factorDiffs = [];
for (const [m, [A2, D3, D4]] of Object.entries(NIST_FACTORS)) {
  for (const [name, exp] of [['A2', A2], ['D3', D3], ['D4', D4]]) {
    n++;
    const got = S.factor(Number(m), name);
    const diff = Math.abs(got - exp);
    if (diff > 0.001 + 1e-12) fails.push(`e-Handbook 6.3.2.1 ${name}(n=${m}): ツール ${got} / NIST ${exp}`);
    else if (diff > 1e-12) factorDiffs.push(`${name}(n=${m}) ツール ${got} / NIST ${exp}`);
  }
}

// ---- e-Handbook 6.3.2.2：個々の値（I-MR）管理図の数値例 ----
// 流量 10 バッチ。x̄ = 50.81、MR̄ = 1.8778、UCL = 55.8041、LCL = 45.8159
{
  const x = [49.6, 47.6, 49.9, 51.3, 47.8, 51.2, 52.6, 52.4, 53.6, 52.1];
  const mrList = [2.0, 2.3, 1.4, 3.5, 3.4, 1.4, 0.2, 1.2, 1.5];
  const c = S.controlCharts(x, 1);
  c.range.points.forEach((v, i) => rounded(`e-Handbook 6.3.2.2 移動範囲 ${i + 2}`, v, mrList[i], 1));
  rounded('e-Handbook 6.3.2.2 中心線 x̄', c.main.cl[0], 50.81, 2);
  rounded('e-Handbook 6.3.2.2 MR̄', c.range.cl[0], 1.8778, 4);
  rounded('e-Handbook 6.3.2.2 UCL', c.main.ucl[0], 55.8041, 4);
  rounded('e-Handbook 6.3.2.2 LCL', c.main.lcl[0], 45.8159, 4);
  n++;
  if (S.runRules(c.main, [1]).length) fails.push('e-Handbook 6.3.2.2: 管理限界の外の点はないはず');
}

// ---- e-Handbook 6.3.3.1：c 管理図の数値例 ----
// ウェハー 25 枚の欠点数。c̄ = 16、UCL = 28、LCL = 4
{
  const d = [16, 14, 28, 16, 12, 20, 10, 12, 10, 17, 19, 17, 14, 16, 15, 13, 14, 16, 11, 20, 11, 19, 16, 31, 13];
  const c = S.attrChart('c', d);
  rounded('e-Handbook 6.3.3.1 欠点数の合計', c.sumD, 400, 0);
  rounded('e-Handbook 6.3.3.1 c̄', c.center, 16, 4);
  rounded('e-Handbook 6.3.3.1 UCL', c.ucl[0], 28, 4);
  rounded('e-Handbook 6.3.3.1 LCL', c.lcl[0], 4, 4);
}

// ---- 結果 ----
console.log('NIST StRD 一変量データ（一致桁数。15 前後が倍精度の限界）');
for (const r of strdReport) console.log(`  ${r.name.padEnd(9)} n=${String(r.n).padStart(4)} 難易度 ${r.level.padEnd(7)} 平均 ${r.mean === Infinity ? '完全一致' : r.mean.toFixed(1)} 桁  標準偏差 ${r.sd === Infinity ? '完全一致' : r.sd.toFixed(1)} 桁`);
if (factorDiffs.length) console.log(`係数表で 0.001 違うもの（AIAG の表の丸め）: ${factorDiffs.join('、')}`);
if (fails.length) {
  console.log(`\n${n} 項目中 ${fails.length} 項目不一致`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`\n${n} 項目すべて公開値と一致`);
