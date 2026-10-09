// 図面の寸法・公差の書き方から、規格上限値（USL）・規格下限値（LSL）・基準値を求める（ブラウザ・Node 共通）
// 対応する書き方の例（全角・空白・φ や R などの記号、単位 mm は無視する）
//   10±0.1 ／ 10 +0.1 -0.05 ／ 10 +0.1/-0.05 ／ 10(+0.1,-0.05) ／ φ10 0/-0.05 ／ 10 +0.2 +0.1
//   9.9～10.1 ／ 9.9〜10.1 ／ 9.9~10.1
//   ≦0.05 ／ <=0.05 ／ 0.05以下 ／ MAX 0.05 ／ 0.05 max ／ ≧5 ／ 5以上 ／ MIN 5
(function (root) {
  'use strict';

  // 全角英数・記号を半角にそろえる
  function normalize(s) {
    return String(s)
      .replace(/[０-９．＋－，（）／]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[−–—‐ー―]/g, '-').replace(/[～〜~]/g, '~').replace(/[≦≤]/g, '<=').replace(/[≧≥]/g, '>=')
      .replace(/[±]/g, '±').replace(/㎜|mm/gi, '').replace(/　/g, ' ').trim();
  }
  // 小数の桁数（丸めて浮動小数点の誤差を消すために使う）
  const decimals = s => { const m = String(s).match(/\.(\d+)/); return m ? m[1].length : 0; };
  const round = (v, d) => +v.toFixed(Math.min(12, d));
  const NUM = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)';

  // 戻り値: { usl, lsl, nominal } （ないものは null）。読めないときは { error: 理由 }
  function parseTolerance(text) {
    let s = normalize(text);
    if (!s) return { error: '空欄です' };
    // 寸法の前の記号（φ・R・□・C・M など）を外す
    s = s.replace(/^(?:[φΦøØ⌀]|SR|SΦ|Sφ|R|□|C|M(?=\d))\s*/i, '');

    // 上限だけ・下限だけ
    let m;
    if ((m = s.match(new RegExp(`^(?:<=?|MAX\\.?|最大)\\s*(${NUM})$`, 'i'))) || (m = s.match(new RegExp(`^(${NUM})\\s*(?:以下|MAX\\.?|未満)$`, 'i'))))
      return { usl: +m[1], lsl: null, nominal: null };
    if ((m = s.match(new RegExp(`^(?:>=?|MIN\\.?|最小)\\s*(${NUM})$`, 'i'))) || (m = s.match(new RegExp(`^(${NUM})\\s*(?:以上|MIN\\.?|超)$`, 'i'))))
      return { usl: null, lsl: +m[1], nominal: null };

    // 範囲（9.9～10.1）
    if ((m = s.match(new RegExp(`^(${NUM})\\s*~\\s*(${NUM})$`)))) {
      const a = +m[1], b = +m[2];
      if (a === b) return { error: '上限と下限が同じです' };
      return { usl: Math.max(a, b), lsl: Math.min(a, b), nominal: null };
    }

    // 基準値 ± 公差
    if ((m = s.match(new RegExp(`^(${NUM})\\s*±\\s*(${NUM})$`)))) {
      const n = +m[1], t = Math.abs(+m[2]), d = Math.max(decimals(m[1]), decimals(m[2]));
      if (t === 0) return { error: '公差が 0 です' };
      return { usl: round(n + t, d), lsl: round(n - t, d), nominal: n };
    }

    // 基準値 と 上・下の寸法許容差（+0.1 -0.05 ／ +0.1/-0.05 ／ (+0.1,-0.05) ／ 0/-0.05）
    m = s.match(new RegExp(`^(${NUM})\\s*\\(?\\s*(${NUM})\\s*[/,]?\\s*(${NUM})\\s*\\)?$`));
    if (m) {
      const n = +m[1], a = +m[2], b = +m[3];
      // 許容差には符号（または 0）が必要。「10 5 3」のような書き方は読まない
      const signed = x => /^[+-]/.test(x) || +x === 0;
      if (!signed(m[2]) || !signed(m[3])) return { error: '寸法許容差には + か − を付けてください（例：10 +0.1 -0.05）' };
      if (a === b) return { error: '上と下の寸法許容差が同じです' };
      const d = Math.max(decimals(m[1]), decimals(m[2]), decimals(m[3]));
      return { usl: round(n + Math.max(a, b), d), lsl: round(n + Math.min(a, b), d), nominal: n };
    }
    return { error: '読めない書き方です（例：10±0.1、10 +0.1/-0.05、9.9～10.1、≦0.05）' };
  }

  const api = { parseTolerance, normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CpkSpec = api;
})(typeof window !== 'undefined' ? window : globalThis);
