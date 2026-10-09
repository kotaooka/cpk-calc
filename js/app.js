// 画面処理：データ読み込み、工程能力解析、2群の検定、結果の表示と保存
(function () {
  'use strict';
  const S = window.CpkStats, X = window.CpkXlsx, C = window.CpkCharts;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // ---------- 状態 ----------
  const st = {
    wb: null, fileName: '', sheet: 0, firstRowData: false, firstColData: false, dir: '列方向',
    table: null, targets: [], spec: {}, sameSpec: false, subgroup: 5, std: 'サンプル標準偏差',
    show: { hist: true, qq: true, density: true, xbar: true, r: true, s: true },
    capResult: null, testResult: null,
  };
  const charts = []; // 再描画用 [{ el, render }]

  // ---------- 共通 ----------
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 2600);
  }
  const fmt = (v, d = 3) => v == null || !Number.isFinite(v) ? '―' : v.toFixed(d);
  // 有効数字で表示（平均や σ など桁がデータ次第の値）
  const sig = (v, n = 5) => {
    if (v == null || !Number.isFinite(v)) return '―';
    if (v === 0) return '0';
    const d = Math.max(0, n - 1 - Math.floor(Math.log10(Math.abs(v))));
    return v.toFixed(Math.min(d, 10));
  };
  // 測定値・規格値など入力された値：10 桁に丸めて末尾の 0 を付けない
  const num = v => v == null || !Number.isFinite(v) ? '―' : String(+v.toPrecision(10));
  const fmtP = p => p == null ? '―' : p < 0.0001 ? p.toExponential(2) : p.toFixed(4);
  const stamp = () => { const d = new Date(), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`; };
  const safeName = s => String(s).replace(/[\\/:*?"<>|\s]+/g, '_');
  function download(data, name, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  // 数値に変換（pandas の to_numeric(errors="coerce") と同じく、数値に見える文字列も数値にする）
  function toNum(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    const s = v.trim().replace(/,/g, '');
    return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? Number(s) : null;
  }
  function segInit(id, onChange) {
    const seg = $(id);
    seg.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      onChange(b.dataset.v);
    });
  }
  const segSet = (id, v) => $(id).querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === v)));

  // ---------- テーマ ----------
  const THEMES = ['auto', 'light', 'dark'], THEME_LABEL = { auto: '表示：自動', light: '表示：ライト', dark: '表示：ダーク' };
  function applyTheme(t) {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
    $('#themeBtn').textContent = THEME_LABEL[t];
    redrawCharts();
  }
  let theme = 'auto';
  try { theme = localStorage.getItem('cpk-calc-theme') || 'auto'; } catch (e) { /* 保存できない環境 */ }
  $('#themeBtn').addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % 3];
    try { localStorage.setItem('cpk-calc-theme', theme); } catch (e) { /* 無視 */ }
    applyTheme(theme);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (theme === 'auto') redrawCharts(); });

  // ---------- タブ ----------
  $$('nav.tabs button').forEach(b => b.addEventListener('click', () => {
    $$('nav.tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== b.dataset.tab; });
    $('#dataSec').hidden = b.dataset.tab === 'explain';
    window.scrollTo({ top: 0 });
  }));

  // ---------- データ読み込み ----------
  async function loadFile(name, buf) {
    try {
      st.wb = /\.(csv|tsv|txt)$/i.test(name) ? X.readCsv(decodeText(buf)) : await X.readXlsx(buf);
    } catch (e) {
      toast('読み込めませんでした：' + e.message); console.error(e); return;
    }
    st.fileName = name; st.sheet = Math.max(0, st.wb.sheets.findIndex(s => s.cells.length));
    $('#fileName').textContent = name;
    $('#fileBar').hidden = false;
    $('#sheetField').hidden = st.wb.sheets.length < 2;
    $('#sheetSel').innerHTML = st.wb.sheets.map((s, i) => `<option value="${i}"${i === st.sheet ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
    $('#readOpts').hidden = false;
    rebuild();
  }
  // CSV の文字コード：UTF-8 として不正なら Shift_JIS とみなす
  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return new TextDecoder('shift_jis').decode(buf); }
  }
  $('#fileIn').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    await loadFile(f.name, await f.arrayBuffer()); e.target.value = '';
  });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', async e => {
    const f = e.dataTransfer.files[0]; if (f) await loadFile(f.name, await f.arrayBuffer());
  });
  $('#sampleBtn').addEventListener('click', async () => {
    try {
      const r = await fetch('samples/sample.xlsx'); if (!r.ok) throw new Error(r.status);
      await loadFile('サンプル測定結果.xlsx', await r.arrayBuffer());
    } catch (e) { toast('サンプルデータを読み込めませんでした'); }
  });
  $('#sheetSel').addEventListener('change', e => { st.sheet = +e.target.value; rebuild(); });
  $('#firstRowData').addEventListener('change', e => { st.firstRowData = e.target.checked; rebuild(); });
  $('#firstColData').addEventListener('change', e => { st.firstColData = e.target.checked; rebuild(); });
  segInit('#dirSeg', v => { st.dir = v; rebuild(); });

  // シートのセルから、行・列の名前つきの表を作る
  function buildTable() {
    const cells = st.wb.sheets[st.sheet].cells;
    if (!cells.length) return null;
    let r0 = Infinity, r1 = -1, c0 = Infinity, c1 = -1;
    const map = new Map();
    for (const [r, c, v] of cells) { map.set(r * 16384 + c, v); r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); }
    const get = (r, c) => map.has(r * 16384 + c) ? map.get(r * 16384 + c) : null;
    const hr = !st.firstRowData, hc = !st.firstColData;
    const rows = [], cols = [];
    for (let r = r0 + (hr ? 1 : 0); r <= r1; r++) rows.push(r);
    for (let c = c0 + (hc ? 1 : 0); c <= c1; c++) cols.push(c);
    const name = v => v == null ? '' : typeof v === 'number' ? String(v) : String(v).trim();
    const uniq = labels => { const seen = {}; return labels.map(l => { seen[l] = (seen[l] || 0) + 1; return seen[l] > 1 ? `${l} (${seen[l]})` : l; }); };
    const colLabels = uniq(cols.map(c => (hr && name(get(r0, c))) || X.colName(c)));
    const rowLabels = uniq(rows.map(r => (hc && name(get(r, c0))) || String(r + 1)));
    return { rows, cols, colLabels, rowLabels, get };
  }
  // 解析対象の名前一覧と、名前から値の列（欠損は null）を取り出す関数
  const labels = () => !st.table ? [] : st.dir === '列方向' ? st.table.colLabels : st.table.rowLabels;
  function series(label) {
    const T = st.table;
    if (st.dir === '列方向') { const c = T.cols[T.colLabels.indexOf(label)]; return T.rows.map(r => toNum(T.get(r, c))); }
    const r = T.rows[T.rowLabels.indexOf(label)]; return T.cols.map(c => toNum(T.get(r, c)));
  }

  function rebuild() {
    st.table = buildTable();
    const T = st.table;
    if (!T) { $('#preview').innerHTML = ''; $('#previewNote').textContent = 'このシートにはデータがありません。'; return; }
    // プレビュー（先頭 5 行）
    const shown = T.rows.slice(0, 5);
    let h = '<table><thead><tr><th class="l"></th>' + T.colLabels.map(l => `<th>${esc(l)}</th>`).join('') + '</tr></thead><tbody>';
    shown.forEach((r, i) => {
      h += `<tr><td class="lab">${esc(T.rowLabels[i])}</td>` + T.cols.map(c => { const v = T.get(r, c); return `<td class="num">${v == null ? '' : esc(typeof v === 'number' ? num(v) : v)}</td>`; }).join('') + '</tr>';
    });
    $('#preview').innerHTML = h + '</tbody></table>';
    $('#previewNote').textContent = `${T.rows.length} 行 × ${T.cols.length} 列（先頭 5 行を表示）`;
    // 解析対象の候補が変わったら選択を引き継ぐ
    const L = labels();
    st.targets = st.targets.filter(t => L.includes(t));
    renderTargets();
    $('#capSetup').hidden = $('#capOpts').hidden = false;
    $('#testSetup').hidden = false;
    $('#tA').innerHTML = $('#tB').innerHTML = L.map(l => `<option>${esc(l)}</option>`).join('');
    if (L.length > 1) $('#tB').selectedIndex = 1;
  }

  // ---------- 解析対象と規格値 ----------
  function renderTargets() {
    const L = labels();
    $('#targetChips').innerHTML = L.map(l => `<label><input type="checkbox" value="${esc(l)}"${st.targets.includes(l) ? ' checked' : ''}>${esc(l)}</label>`).join('');
    renderSpec();
  }
  $('#targetChips').addEventListener('change', () => {
    const on = new Set($$('#targetChips input:checked').map(i => i.value));
    st.targets = labels().filter(l => on.has(l));
    renderSpec();
  });
  $('#selAll').addEventListener('click', () => { st.targets = [...labels()]; renderTargets(); });
  $('#selNone').addEventListener('click', () => { st.targets = []; renderTargets(); });
  function renderSpec() {
    $('#specWrap').hidden = !st.targets.length;
    $('#specBody').innerHTML = st.targets.map((t, i) => {
      const s = st.spec[t] || (st.spec[t] = { usl: '', lsl: '' });
      const dis = st.sameSpec && i > 0 ? ' disabled' : '';
      const v = st.sameSpec && i > 0 ? st.spec[st.targets[0]] : s;
      const n = series(t).filter(x => x != null).length;
      return `<tr><td class="l">${esc(t)}</td><td><input class="num" type="text" inputmode="decimal" data-t="${esc(t)}" data-k="usl" value="${esc(v.usl)}"${dis}></td>` +
        `<td><input class="num" type="text" inputmode="decimal" data-t="${esc(t)}" data-k="lsl" value="${esc(v.lsl)}"${dis}></td><td class="num">${n}</td></tr>`;
    }).join('');
  }
  $('#specBody').addEventListener('input', e => {
    const i = e.target; if (!i.dataset.t) return;
    st.spec[i.dataset.t][i.dataset.k] = i.value;
    if (st.sameSpec && i.dataset.t === st.targets[0]) $$(`#specBody input[data-k="${i.dataset.k}"]`).slice(1).forEach(x => { x.value = i.value; });
  });
  $('#sameSpec').addEventListener('change', e => { st.sameSpec = e.target.checked; renderSpec(); });

  // ---------- 解析オプション ----------
  $('#subgroup').addEventListener('change', e => { st.subgroup = +e.target.value; });
  segInit('#stdSeg', v => { st.std = v; });
  $$('[data-show]').forEach(c => c.addEventListener('change', () => { st.show[c.dataset.show] = c.checked; }));

  // ---------- グラフ ----------
  function addChart(container, name, render) {
    const div = document.createElement('div');
    div.className = 'chart';
    div.innerHTML = render() + `<button class="btn small save" type="button">PNG で保存</button>`;
    div.querySelector('.save').addEventListener('click', () => C.svgToPng(div.querySelector('svg'), `${stamp()}_${safeName(name)}.png`));
    container.appendChild(div);
    charts.push({ div, render });
  }
  function redrawCharts() {
    for (const c of charts) { if (!c.div.isConnected) continue; c.div.querySelector('svg').outerHTML = c.render(); }
  }
  // 規格線・平均線
  function specLines(usl, lsl, mu) {
    const L = [];
    if (mu != null) L.push({ type: 'vline', x: mu, color: 'var(--s2)', text: `平均 ${sig(mu)}` });
    if (usl != null) L.push({ type: 'vline', x: usl, color: 'var(--ng)', width: 2, text: `USL ${num(usl)}` });
    if (lsl != null) L.push({ type: 'vline', x: lsl, color: 'var(--ng)', width: 2, text: `LSL ${num(lsl)}` });
    return L;
  }
  function histChart(x, usl, lsl, mu, label) {
    const n = x.length, k = Math.max(5, Math.ceil(Math.log2(n) + 1));
    let lo = Math.min(...x), hi = Math.max(...x);
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    const w = (hi - lo) / k, cnt = new Array(k).fill(0);
    for (const v of x) cnt[Math.min(k - 1, Math.floor((v - lo) / w))]++;
    const bars = cnt.map((h, i) => ({ x0: lo + i * w, x1: lo + (i + 1) * w, h }));
    return C.plot({ title: `ヒストグラム（${label}）`, xLabel: '値', yLabel: '度数', yZero: true, legend: false,
      layers: [{ type: 'bars', data: bars, color: 'var(--s1)' }, ...specLines(usl, lsl, mu)] });
  }
  function qqChart(x, label) {
    // scipy.stats.probplot と同じ Filliben の順序統計量中央値
    const n = x.length, ys = [...x].sort((a, b) => a - b), m = new Array(n);
    m[n - 1] = 0.5 ** (1 / n); m[0] = 1 - m[n - 1];
    for (let i = 1; i < n - 1; i++) m[i] = (i + 1 - 0.3175) / (n + 0.365);
    const xs = m.map(S.normPpf);
    const f = S.correlation(xs, ys);
    const ends = [Math.min(...xs), Math.max(...xs)];
    return C.plot({ title: `QQプロット（${label}）`, xLabel: '理論分位点（標準正規分布）', yLabel: '測定値（小さい順）',
      layers: [{ type: 'points', data: xs.map((v, i) => [v, ys[i]]), color: 'var(--s1)', label: '測定値' },
        { type: 'line', data: ends.map(v => [v, f.intercept + f.slope * v]), color: 'var(--ng)', label: `直線 R²=${f.r2.toFixed(4)}` }] });
  }
  function densityChart(mu, s, usl, lsl, label) {
    const pts = []; for (let i = 0; i <= 200; i++) { const v = mu - 4 * s + 8 * s * i / 200; pts.push([v, S.normPdf(v, mu, s)]); }
    return C.plot({ title: `確率密度分布（${label}）`, xLabel: '値', yLabel: '確率密度', yZero: true, legend: false,
      layers: [{ type: 'area', data: pts, color: 'var(--s1)' },
        { type: 'vline', x: mu - 3 * s, color: 'var(--muted)', dash: '5 4', text: `−3σ ${sig(mu - 3 * s)}` },
        { type: 'vline', x: mu + 3 * s, color: 'var(--muted)', dash: '5 4', text: `+3σ ${sig(mu + 3 * s)}` },
        ...specLines(usl, lsl, mu)] });
  }
  function ctrlChart(title, xLabel, yLabel, c) {
    const start = c.start || 1;
    const data = c.points.map((v, i) => [start + i, v]);
    const out = c.points.map(v => v > c.ucl + 1e-12 || v < c.lcl - 1e-12);
    return C.plot({ title, xLabel, yLabel, legend: false,
      layers: [{ type: 'line', data, color: 'var(--s1)', width: 1.5 },
        { type: 'points', data, colors: out.map(o => o ? 'var(--ng)' : 'var(--s1)'), r: 3.2 },
        { type: 'hline', y: c.cl, color: 'var(--ok)', dash: '6 4', text: `CL ${sig(c.cl)}` },
        { type: 'hline', y: c.ucl, color: 'var(--ng)', dash: '6 4', text: `UCL ${sig(c.ucl)}` },
        { type: 'hline', y: c.lcl, color: 'var(--ng)', dash: '6 4', text: `LCL ${sig(c.lcl)}` }] });
  }

  // ---------- 工程能力解析 ----------
  const level = v => v == null ? null : v >= 1.67 ? ['ex', '◎ 非常に良好'] : v >= 1.33 ? ['gd', '○ 良好'] : v >= 1 ? ['wa', '△ 要注意'] : ['ng', '✕ 不良'];
  const lvCell = v => { const L = level(v); return L ? `<span class="lv ${L[0]}">${fmt(v)}</span>` : '―'; };

  $('#runCap').addEventListener('click', () => {
    if (!st.targets.length) { toast('解析対象を選んでください'); return; }
    const log = [], rows = [];
    const m = st.subgroup, ddof = st.std === '母集団標準偏差' ? 0 : 1;
    const specOf = (t, i) => st.sameSpec ? st.spec[st.targets[0]] : st.spec[t];
    st.targets.forEach((t, i) => {
      const raw = series(t), x = raw.filter(v => v != null);
      if (x.length < raw.length) log.push(['info', `${t}: 空欄・数値でない ${raw.length - x.length} 件を除外しました（${raw.length} → ${x.length}）`]);
      if (x.length < 2) { log.push(['err', `${t}: 有効なデータが ${x.length} 件のため解析できません`]); return; }
      const sp = specOf(t, i), us = String(sp.usl).trim(), ls = String(sp.lsl).trim();
      if (!us && !ls) { log.push(['warn', `${t}: 規格値（上限・下限）が両方空欄のため解析しません`]); return; }
      const usl = us ? toNum(us) : null, lsl = ls ? toNum(ls) : null;
      if ((us && usl == null) || (ls && lsl == null)) { log.push(['err', `${t}: 規格値が数値ではありません`]); return; }
      if (usl != null && lsl != null && usl <= lsl) { log.push(['err', `${t}: 規格上限値（${usl}）が下限値（${lsl}）以下です`]); return; }
      const cap = S.capability(x, usl, lsl, m, ddof);
      if (!(cap.sigmaOverall > 0)) { log.push(['err', `${t}: 標準偏差が 0 のため工程能力指数を計算できません`]); return; }
      for (const note of cap.notes) log.push(['warn', `${t}: ${note}`]);
      const sw = x.length >= 3 && x.length <= 5000 ? S.shapiro(x) : null;
      if (sw && sw.p < 0.05) log.push(['warn', `${t}: Shapiro-Wilk 検定で p = ${fmtP(sw.p)} < 0.05。正規分布でない可能性があり、工程能力指数の解釈に注意が必要です`]);
      rows.push({ t, x, usl, lsl, cap, sw, max: Math.max(...x), min: Math.min(...x), skew: S.skewness(x), kurt: S.kurtosis(x),
        type: usl != null && lsl != null ? '両側' : usl != null ? '上側のみ' : '下側のみ' });
    });
    st.capResult = { rows, log, m, ddof };
    renderCap();
  });

  function renderCap() {
    const { rows, log, m } = st.capResult;
    $('#capResult').hidden = false;
    $('#capLog').innerHTML = log.map(([k, s]) => `<li class="${k}">${esc(s)}</li>`).join('');
    if (!rows.length) { $('#summary').innerHTML = ''; $('#capDetail').innerHTML = ''; $('#capResult').scrollIntoView({ behavior: 'smooth' }); return; }
    $('#summary').innerHTML = '<table><thead><tr><th class="l">解析対象</th><th>n</th><th>平均</th><th>σ(群内)</th><th>σ(全体)</th><th>Cp</th><th>Cpk</th><th>Pp</th><th>Ppk</th><th>Ppk 95%信頼区間</th><th>判定</th></tr></thead><tbody>' +
      rows.map(r => {
        const c = r.cap, j = c.Cpk != null ? c.Cpk : c.Ppk, L = level(j);
        return `<tr><td class="l">${esc(r.t)}</td><td class="num">${c.n}</td><td class="num">${sig(c.mean)}</td><td class="num">${sig(c.sigmaWithin, 4)}</td><td class="num">${sig(c.sigmaOverall, 4)}</td>` +
          `<td class="num">${fmt(c.Cp)}</td><td class="num">${lvCell(c.Cpk)}</td><td class="num">${fmt(c.Pp)}</td><td class="num">${lvCell(c.Ppk)}</td>` +
          `<td class="num">${c.PpkCI[0] != null ? `${fmt(c.PpkCI[0])} ～ ${fmt(c.PpkCI[1])}` : '―'}</td><td>${L ? `<span class="lv ${L[0]}">${L[1]}${c.Cpk == null ? '（Ppk）' : ''}</span>` : '―'}</td></tr>`;
      }).join('') + '</tbody></table>';
    const det = $('#capDetail'); det.innerHTML = '';
    charts.splice(0, charts.length, ...charts.filter(c => c.div.isConnected));
    for (const r of rows) {
      const c = r.cap, sec = document.createElement('div');
      sec.className = 'target';
      const kv = [
        ['規格', `${r.type}<br><small>USL ${num(r.usl)} ／ LSL ${num(r.lsl)}</small>`],
        ['n', c.n], ['最大／最小', `${num(r.max)}<br><small>${num(r.min)}</small>`], ['平均', sig(c.mean)],
        ['σ(群内)', `${sig(c.sigmaWithin, 4)}<br><small>${esc(c.sigmaWithinMethod || '計算できません')}</small>`], ['σ(全体)', sig(c.sigmaOverall, 4)],
        ['Cp', fmt(c.Cp)], ['Cpk', `${lvCell(c.Cpk)}<br><small>CPU ${fmt(c.Cpu)} ／ CPL ${fmt(c.Cpl)}</small>`],
        ['Pp', `${fmt(c.Pp)}<br><small>95%: ${c.PpCI[0] != null ? `${fmt(c.PpCI[0])}～${fmt(c.PpCI[1])}` : '―'}</small>`],
        ['Ppk', `${lvCell(c.Ppk)}<br><small>95%: ${c.PpkCI[0] != null ? `${fmt(c.PpkCI[0])}～${fmt(c.PpkCI[1])}` : '―'}</small>`],
        ['歪度／尖度', `${fmt(r.skew)}<br><small>${fmt(r.kurt)}</small>`], ['Shapiro-Wilk p', r.sw ? fmtP(r.sw.p) : '―'],
      ];
      sec.innerHTML = `<h3>${esc(r.t)}</h3><dl class="kv">${kv.map(([k, v]) => `<div><dt>${k}</dt><dd class="num">${v}</dd></div>`).join('')}</dl><div class="charts"></div>`;
      det.appendChild(sec);
      const g = sec.querySelector('.charts'), sh = st.show;
      if (sh.hist) addChart(g, `hist_${r.t}`, () => histChart(r.x, r.usl, r.lsl, c.mean, r.t));
      if (sh.qq) addChart(g, `qq_${r.t}`, () => qqChart(r.x, r.t));
      if (sh.density) addChart(g, `density_${r.t}`, () => densityChart(c.mean, c.sigmaOverall, r.usl, r.lsl, r.t));
      const cc = S.controlCharts(r.x, m);
      if (!cc) continue;
      if (m === 1) {
        if (sh.xbar) addChart(g, `i_${r.t}`, () => ctrlChart(`I 管理図（${r.t}）`, 'データ点', '値', cc.main));
        if (sh.r) addChart(g, `mr_${r.t}`, () => ctrlChart(`MR 管理図（${r.t}）`, 'データ点（2番目以降）', '移動範囲', cc.range));
      } else {
        if (sh.xbar) addChart(g, `xbar_${r.t}`, () => ctrlChart(`X̄ 管理図（${r.t}）`, 'サブグループ番号', 'サブグループ平均', cc.main));
        if (sh.r) addChart(g, `r_${r.t}`, () => ctrlChart(`R 管理図（${r.t}）`, 'サブグループ番号', '範囲', cc.range));
        if (sh.s) addChart(g, `s_${r.t}`, () => ctrlChart(`s 管理図（${r.t}）`, 'サブグループ番号', '標準偏差', cc.s));
      }
    }
    $('#capResult').scrollIntoView({ behavior: 'smooth' });
  }

  $('#dlCap').addEventListener('click', () => {
    const R = st.capResult; if (!R || !R.rows.length) { toast('保存する結果がありません'); return; }
    const head = ['解析対象', 'サンプル数', '規格種別', '上限規格', '下限規格', '最大値', '最小値', '平均値', 'σ(群内)', 'σ(群内)の推定方法', '標準偏差(全体)',
      'Cp', 'Cpk', 'Pp', 'Pp_lower (95%)', 'Pp_upper (95%)', 'Ppk', 'Ppk_lower (95%, Bissell)', 'Ppk_upper (95%, Bissell)', '尖度', '歪度', 'Shapiro-Wilk p値'];
    const rows = R.rows.map(r => { const c = r.cap; return [r.t, c.n, r.type, r.usl, r.lsl, r.max, r.min, c.mean, c.sigmaWithin, c.sigmaWithinMethod, c.sigmaOverall,
      c.Cp, c.Cpk, c.Pp, c.PpCI[0], c.PpCI[1], c.Ppk, c.PpkCI[0], c.PpkCI[1], r.kurt, r.skew, r.sw ? r.sw.p : null]; });
    const cond = [['項目', '値'], ['ファイル', st.fileName], ['シート', st.wb.sheets[st.sheet].name], ['計算対象の方向', st.dir], ['サブグループサイズ', R.m],
      ['全体の標準偏差', R.ddof ? '標本標準偏差（n−1）' : '母集団標準偏差（n）'], ['作成', new Date().toLocaleString('ja-JP')]];
    download(X.writeXlsx([{ name: '工程能力', rows: [head, ...rows] }, { name: 'ログ', rows: [['区分', '内容'], ...R.log.map(([k, s]) => [{ info: '情報', warn: '注意', err: 'エラー' }[k], s])] }, { name: '条件', rows: cond }]),
      `${stamp()}_results.xlsx`, XLSX_TYPE);
  });

  // ---------- 設定の保存・読み込み（CpkTools-WebUI の JSON と互換） ----------
  $('#exportSettings').addEventListener('click', () => {
    const s = {
      schema_version: '1.0', exported_at: new Date().toISOString(), subgroup_size: st.subgroup, std_method: st.std,
      include_first_row: st.firstRowData, include_first_column: st.firstColData, calc_direction: st.dir,
      show_hist: st.show.hist, show_qq: st.show.qq, show_density: st.show.density, show_xbar: st.show.xbar, show_r: st.show.r, show_s: st.show.s,
      same_spec: st.sameSpec, selected_targets: st.targets,
      spec_table: st.targets.map((t, i) => { const sp = st.sameSpec ? st.spec[st.targets[0]] : st.spec[t]; return [t, String(sp.usl), String(sp.lsl)]; }),
    };
    download(JSON.stringify(s, null, 2), `${stamp()}_settings.json`, 'application/json');
  });
  $('#importSettings').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    let s;
    try { s = JSON.parse(await f.text()); if (!s || typeof s !== 'object') throw new Error(); } catch (err) { toast('設定ファイルを読み込めませんでした'); return; }
    if (s.subgroup_size >= 1 && s.subgroup_size <= 10) { st.subgroup = +s.subgroup_size; $('#subgroup').value = st.subgroup; }
    if (s.std_method) { st.std = s.std_method; segSet('#stdSeg', st.std); }
    for (const k of ['hist', 'qq', 'density', 'xbar', 'r', 's']) if (typeof s['show_' + k] === 'boolean') { st.show[k] = s['show_' + k]; $(`[data-show="${k}"]`).checked = st.show[k]; }
    st.firstRowData = !!s.include_first_row; st.firstColData = !!s.include_first_column; $('#firstRowData').checked = st.firstRowData; $('#firstColData').checked = st.firstColData;
    if (s.calc_direction) { st.dir = s.calc_direction; segSet('#dirSeg', st.dir); }
    st.sameSpec = !!s.same_spec; $('#sameSpec').checked = st.sameSpec;
    for (const row of s.spec_table || []) if (Array.isArray(row) && row.length >= 3) st.spec[String(row[0])] = { usl: String(row[1] ?? ''), lsl: String(row[2] ?? '') };
    st.targets = (s.selected_targets || []).map(String);
    if (st.wb) rebuild();
    const missing = (s.selected_targets || []).filter(t => !st.targets.includes(String(t)));
    toast(missing.length ? `設定を読み込みました（今のデータにない解析対象 ${missing.length} 件は外しました）` : '設定を読み込みました');
  });

  // ---------- 2群の検定・相関 ----------
  $('#runTest').addEventListener('click', () => {
    const a = $('#tA').value, b = $('#tB').value;
    if (!a || !b) { toast('検定する対象を選んでください'); return; }
    if (a === b) { toast('異なる2つの対象を選んでください'); return; }
    const ra = series(a), rb = series(b), log = [];
    const doF = $('#doF').checked, doT = $('#doT').checked, kind = $('#tKind').value, doOv = $('#doOverlay').checked, doCorr = $('#doCorr').checked;
    const alphaF = +$('#alphaF').value, alphaT = +$('#alphaT').value;
    if (!(alphaF > 0 && alphaF < 1) || !(alphaT > 0 && alphaT < 1)) { toast('有意水準は 0 と 1 の間で入力してください'); return; }
    const pairs = []; for (let i = 0; i < Math.max(ra.length, rb.length); i++) if (ra[i] != null && rb[i] != null) pairs.push([ra[i], rb[i]]);
    const paired = doT && kind === 'paired';
    let x, y;
    if (paired) {
      x = pairs.map(p => p[0]); y = pairs.map(p => p[1]);
      log.push(['info', `対応ありの t 検定のため、両方に値がある ${pairs.length} 組で計算します（F 検定も同じ組で計算します）`]);
      if (pairs.length < 2) { toast('対応ありの t 検定に使える組が 2 組未満です'); return; }
    } else { x = ra.filter(v => v != null); y = rb.filter(v => v != null); }
    if (x.length < 2 || y.length < 2) { toast('どちらかの対象のデータが 2 件未満です'); return; }
    const R = { a, b, kind, alphaF, alphaT, n1: x.length, n2: y.length, m1: S.mean(x), m2: S.mean(y), v1: S.variance(x), v2: S.variance(y), x, y, log };
    if (doF) {
      const f = S.fTest(x, y);
      if (!f) log.push(['warn', '分散が 0 のため F 検定を行いません']); else R.f = f;
    }
    if (doT) {
      const t = S.tTest(x, y, kind);
      if (!Number.isFinite(t.t)) log.push(['warn', '標準偏差が 0 のため t 検定を行いません']); else R.t = t;
    }
    if (doCorr) {
      if (pairs.length < 3) log.push(['warn', '両方に値がある組が 3 組未満のため、相関を計算しません']);
      else { R.corr = S.correlation(pairs.map(p => p[0]), pairs.map(p => p[1])); R.corr.n = pairs.length; R.pairs = pairs; }
      if (!paired && (pairs.length < x.length || pairs.length < y.length)) log.push(['info', `相関は両方に値がある ${pairs.length} 組で計算しました`]);
    }
    R.overlay = doOv;
    st.testResult = R;
    renderTest();
  });

  const kindName = { paired: '対応あり', pooled: '独立・分散が等しい', welch: '独立・分散が異なる（Welch）' };
  function renderTest() {
    const R = st.testResult;
    $('#testResult').hidden = false;
    const card = (title, rows, verdict) => `<div class="res"><h3>${title}</h3>${verdict || ''}<dl class="kv">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd class="num">${v}</dd></div>`).join('')}</dl></div>`;
    const vd = (p, a) => `<div class="verdict ${p < a ? 'sig' : 'nsig'}">${p < a ? '有意差あり' : '有意差なし'}<span class="hint">（有意水準 ${a}）</span></div>`;
    let h = card('データ', [[`n（${esc(R.a)}）`, R.n1], [`n（${esc(R.b)}）`, R.n2], ['平均 1', sig(R.m1)], ['平均 2', sig(R.m2)], ['分散 1', sig(R.v1, 4)], ['分散 2', sig(R.v2, 4)]]);
    if (R.f) h += card('F 検定（分散の比較）', [['F 値', fmt(R.f.F, 4)], ['自由度', `(${R.f.dfn}, ${R.f.dfd})`], ['p 値（両側）', fmtP(R.f.p)]], vd(R.f.p, R.alphaF));
    if (R.t) h += card(`t 検定（${kindName[R.kind]}）`, [['t 値', fmt(R.t.t, 4)], ['自由度', R.kind === 'welch' ? fmt(R.t.df, 2) : R.t.df], ['p 値（両側）', fmtP(R.t.p)], ['平均の差（1−2）', sig(R.m1 - R.m2)]], vd(R.t.p, R.alphaT));
    if (R.corr) h += card('相関', [['相関係数 r', fmt(R.corr.r, 4)], ['決定係数 R²', fmt(R.corr.r2, 4)], ['回帰式', `y = ${sig(R.corr.slope, 4)}x ${R.corr.intercept < 0 ? '−' : '+'} ${sig(Math.abs(R.corr.intercept), 4)}`], ['組数', R.corr.n]]);
    $('#testCards').innerHTML = h;
    $('#testLog').innerHTML = R.log.map(([k, s]) => `<li class="${k}">${esc(s)}</li>`).join('');
    const g = $('#testCharts'); g.innerHTML = '';
    charts.splice(0, charts.length, ...charts.filter(c => c.div.isConnected));
    if (R.overlay) addChart(g, 'density_overlay', () => {
      const s1 = Math.sqrt(R.v1), s2 = Math.sqrt(R.v2);
      const lo = Math.min(...R.x, ...R.y), hi = Math.max(...R.x, ...R.y), pad = (hi - lo) * 0.1 || 1;
      const xs = []; for (let i = 0; i <= 200; i++) xs.push(lo - pad + (hi - lo + 2 * pad) * i / 200);
      return C.plot({ title: '正規分布の重ね描き', xLabel: '値', yLabel: '確率密度', yZero: true,
        layers: [{ type: 'line', data: xs.map(v => [v, S.normPdf(v, R.m1, s1)]), color: 'var(--s1)', label: `${R.a}（μ=${sig(R.m1, 4)}, σ=${sig(s1, 3)}）` },
          { type: 'line', data: xs.map(v => [v, S.normPdf(v, R.m2, s2)]), color: 'var(--s2)', label: `${R.b}（μ=${sig(R.m2, 4)}, σ=${sig(s2, 3)}）` }] });
    });
    if (R.corr) addChart(g, 'scatter', () => {
      const xs = R.pairs.map(p => p[0]), ends = [Math.min(...xs), Math.max(...xs)];
      return C.plot({ title: `散布図（r = ${fmt(R.corr.r)}, R² = ${fmt(R.corr.r2)}）`, xLabel: R.a, yLabel: R.b,
        layers: [{ type: 'points', data: R.pairs, color: 'var(--s1)', label: 'データ' },
          { type: 'line', data: ends.map(v => [v, R.corr.intercept + R.corr.slope * v]), color: 'var(--ng)', label: '回帰直線' }] });
    });
    if (R.t) addChart(g, 't_distribution', () => {
      const df = R.t.df, lo = Math.min(S.tPpf(0.001, df), R.t.t * 1.1), hi = Math.max(S.tPpf(0.999, df), R.t.t * 1.1);
      const pts = []; for (let i = 0; i <= 300; i++) { const v = lo + (hi - lo) * i / 300; pts.push([v, S.tPdf(v, df)]); }
      const crit = S.tPpf(1 - R.alphaT / 2, df);
      return C.plot({ title: `t 分布（自由度 ${R.kind === 'welch' ? fmt(df, 2) : df}）`, xLabel: 't 値', yLabel: '確率密度', yZero: true, legend: false,
        layers: [{ type: 'area', data: pts, color: 'var(--s4)' },
          { type: 'vline', x: -crit, color: 'var(--muted)', dash: '5 4', text: `棄却限界 −${fmt(crit)}` }, { type: 'vline', x: crit, color: 'var(--muted)', dash: '5 4', text: `棄却限界 ${fmt(crit)}` },
          { type: 'vline', x: R.t.t, color: 'var(--ng)', width: 2, text: `t = ${fmt(R.t.t)}（p = ${fmtP(R.t.p)}）` }] });
    });
    if (R.f) addChart(g, 'f_distribution', () => {
      const { F, dfn, dfd } = R.f, hi = Math.max(S.fPpf(0.999, dfn, dfd), F * 1.1);
      const pts = []; for (let i = 1; i <= 300; i++) { const v = hi * i / 300; pts.push([v, S.fPdf(v, dfn, dfd)]); }
      const crit = S.fPpf(1 - R.alphaF / 2, dfn, dfd);
      return C.plot({ title: `F 分布（自由度 ${dfn}, ${dfd}）`, xLabel: 'F 値', yLabel: '確率密度', yZero: true, legend: false, x: [0, hi],
        layers: [{ type: 'area', data: pts, color: 'var(--s2)' },
          { type: 'vline', x: crit, color: 'var(--muted)', dash: '5 4', text: `棄却限界 ${fmt(crit)}` },
          { type: 'vline', x: F, color: 'var(--ng)', width: 2, text: `F = ${fmt(F)}（p = ${fmtP(R.f.p)}）` }] });
    });
    $('#testResult').scrollIntoView({ behavior: 'smooth' });
  }
  $('#dlTest').addEventListener('click', () => {
    const R = st.testResult; if (!R) return;
    const row = { '検定対象1': R.a, '検定対象2': R.b, 'サンプル数1': R.n1, 'サンプル数2': R.n2, '平均1': R.m1, '平均2': R.m2, '分散1': R.v1, '分散2': R.v2 };
    if (R.f) Object.assign(row, { 'F値': R.f.F, '自由度 (F検定)': `(${R.f.dfn}, ${R.f.dfd})`, 'P値 (F検定)': R.f.p, '判定 (F検定)': R.f.p < R.alphaF ? '有意差あり' : '有意差なし' });
    if (R.t) Object.assign(row, { 't検定の種類': kindName[R.kind], 't値': R.t.t, '自由度 (t検定)': R.t.df, 'P値 (t検定)': R.t.p, '判定 (t検定)': R.t.p < R.alphaT ? '有意差あり' : '有意差なし' });
    if (R.corr) Object.assign(row, { '相関係数': R.corr.r, '決定係数': R.corr.r2, '回帰 傾き': R.corr.slope, '回帰 切片': R.corr.intercept });
    download(X.writeXlsx([{ name: '検定結果', rows: [Object.keys(row), Object.values(row)] }]), `${stamp()}_stat_test_results.xlsx`, XLSX_TYPE);
  });

  // ---------- 起動 ----------
  applyTheme(theme);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
