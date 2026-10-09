// 統計計算と Excel 入出力の照合テスト（node tests/test.js）。不一致が1件でもあれば終了コード 1
// 参照値は tests/make_reference.py（scipy / pandas）で作る
const S = require('../js/stats.js');
const R = require('./reference.json');

let n = 0; const fails = [];
function check(name, got, exp, tol = 1e-10) {
  n++;
  const ok = got === exp || (got == null && exp == null) ||
    (typeof got === 'number' && typeof exp === 'number' && Math.abs(got - exp) <= tol * Math.max(1, Math.abs(exp)));
  if (!ok) fails.push(`${name}: 計算 ${got} / 参照 ${exp}`);
}

for (const r of R.norm) { check(`norm.cdf(${r.x})`, S.normCdf(r.x), r.cdf, 1e-13); check(`norm.sf(${r.x})`, S.normSf(r.x), r.sf, 1e-13); check(`norm.pdf(${r.x})`, S.normPdf(r.x), r.pdf, 1e-13); }
// 裾の確率は相対誤差で比べる
for (const r of R.norm) if (r.cdf > 0) { n++; const rel = Math.abs(S.normCdf(r.x) / r.cdf - 1); if (rel > 1e-12) fails.push(`norm.cdf 相対誤差 x=${r.x}: ${rel}`); }
for (const r of R.normppf) check(`norm.ppf(${r.p})`, S.normPpf(r.p), r.v, 1e-12);
for (const r of R.chi2) check(`chi2.cdf(${r.x},${r.k})`, S.chi2Cdf(r.x, r.k), r.cdf, 1e-12);
for (const r of R.chi2ppf) check(`chi2.ppf(${r.p},${r.k})`, S.chi2Ppf(r.p, r.k), r.v, 1e-10);
for (const r of R.t) { check(`t.cdf(${r.t},${r.df})`, S.tCdf(r.t, r.df), r.cdf, 1e-12); check(`t.pdf(${r.t},${r.df})`, S.tPdf(r.t, r.df), r.pdf, 1e-12); }
for (const r of R.tppf) check(`t.ppf(${r.p},${r.df})`, S.tPpf(r.p, r.df), r.v, 1e-10);
for (const r of R.f) { check(`f.sf(${r.f},${r.d1},${r.d2})`, S.fSf(r.f, r.d1, r.d2), r.sf, 1e-12); check(`f.pdf(${r.f},${r.d1},${r.d2})`, S.fPdf(r.f, r.d1, r.d2), r.pdf, 1e-12); }
for (const r of R.fppf) check(`f.ppf(${r.p},${r.d1},${r.d2})`, S.fPpf(r.p, r.d1, r.d2), r.v, 1e-10);

for (const d of R.desc) {
  check(`${d.name} 平均`, S.mean(d.x), d.mean, 1e-12);
  check(`${d.name} 標準偏差`, S.sd(d.x), d.sd, 1e-12);
  check(`${d.name} 歪度`, S.skewness(d.x), d.skew, 1e-10);
  if (d.kurt != null) check(`${d.name} 尖度`, S.kurtosis(d.x), d.kurt, 1e-10);
  const sw = S.shapiro(d.x);
  check(`${d.name} Shapiro-Wilk W`, sw.W, d.W, 1e-6);
  check(`${d.name} Shapiro-Wilk p`, sw.p, d.p, 1e-5);
}

const T = R.tests;
const f = S.fTest(T.a, T.b);
check('F値', f.F, T.F, 1e-12); check('F 自由度(分子)', f.dfn, T.dfn); check('F 自由度(分母)', f.dfd, T.dfd); check('F 検定 p', f.p, T.pF, 1e-11);
const tp = S.tTest(T.a, T.b, 'pooled'), tw = S.tTest(T.a, T.b, 'welch'), tr = S.tTest(T.a, T.c, 'paired');
check('t 等分散 t', tp.t, T.pooled[0], 1e-12); check('t 等分散 p', tp.p, T.pooled[1], 1e-11);
check('t Welch t', tw.t, T.welch[0], 1e-12); check('t Welch p', tw.p, T.welch[1], 1e-11);
check('t 対応あり t', tr.t, T.paired[0], 1e-12); check('t 対応あり p', tr.p, T.paired[1], 1e-11);
const co = S.correlation(T.a, T.c);
check('相関係数', co.r, T.r, 1e-12); check('回帰 傾き', co.slope, T.fit[0], 1e-10); check('回帰 切片', co.intercept, T.fit[1], 1e-10);

for (const c of R.cap) {
  const r = S.capability(R.capx, c.usl, c.lsl, c.m, c.ddof);
  const tag = `工程能力 n=${c.m} USL=${c.usl} LSL=${c.lsl} ddof=${c.ddof}`;
  check(`${tag} σ群内`, r.sigmaWithin, c.sw, 1e-12); check(`${tag} s`, r.sigmaOverall, c.s, 1e-12);
  check(`${tag} Cp`, r.Cp, c.Cp, 1e-12); check(`${tag} Cpk`, r.Cpk, c.Cpk, 1e-12);
  check(`${tag} Pp`, r.Pp, c.Pp, 1e-12); check(`${tag} Ppk`, r.Ppk, c.Ppk, 1e-12);
  check(`${tag} Ppk下限`, r.PpkCI[0], c.PpkCI[0], 1e-10); check(`${tag} Ppk上限`, r.PpkCI[1], c.PpkCI[1], 1e-10);
  check(`${tag} Pp下限`, r.PpCI[0], c.PpCI[0], 1e-10); check(`${tag} Pp上限`, r.PpCI[1], c.PpCI[1], 1e-10);
}

// d2 係数を数値積分で求め直す：d2(n) = ∫ [1 - (1-Φ)^n - Φ^n] dx
for (const m of Object.keys(S.FACTORS).map(Number)) {
  let s = 0; const h = 0.001;
  for (let x = -12; x < 12; x += h) { const P = S.normCdf(x + h / 2); s += (1 - (1 - P) ** m - P ** m) * h; }
  n++; if (Math.abs(Math.round(s * 1000) / 1000 - S.factor(m, 'd2')) > 1e-9) fails.push(`d2 n=${m}: 表 ${S.factor(m, 'd2')} / 積分 ${s}`);
}

// Excel 入出力のテストは別ファイル
(async () => {
  try { await require('./test-xlsx.js')(check, fails, () => n++); }
  catch (e) { fails.push('Excel 入出力のテストで例外: ' + (e.stack || e)); }
  for (const f of fails) console.log('NG ' + f);
  console.log(fails.length ? `${fails.length} 件不一致 / ${n} 件` : `全 ${n} 件一致`);
  process.exitCode = fails.length ? 1 : 0;
})();
