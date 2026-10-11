// 画面処理：データ読み込み、工程能力解析、2群の検定、結果の表示と保存
(function () {
  'use strict';
  const S = window.CpkStats, X = window.CpkXlsx, C = window.CpkCharts, SP = window.CpkSpec, G = window.CpkGrid;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // ---------- 状態 ----------
  const st = {
    wb: null, fileName: '', sheet: 0, firstRowData: false, firstColData: false, dir: '列方向',
    table: null, targets: [], spec: {}, sameSpec: false, subgroup: 5, std: 'サンプル標準偏差',
    show: { hist: true, qq: true, density: false, xbar: true, r: true, s: true },
    groupBy: '', rules: true, judge: { basis: 'Cpk', ex: 1.67, gd: 1.33, wa: 1.00 },
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
  // ppm の表示
  const fmtPpm = v => v == null || !Number.isFinite(v) ? '―' : v === 0 ? '0' : v < 0.01 ? '< 0.01' : v < 10 ? v.toFixed(2) : v < 1000 ? v.toFixed(1) : Math.round(v).toLocaleString('ja-JP');
  // ppm を % に直して表示（1 % = 10,000 ppm）。有効数字 3 桁、fmtPpm で「< 0.01」になる範囲は「< 0.000001」
  const fmtPct = v => v == null || !Number.isFinite(v) ? '―' : v === 0 ? '0' : v < 0.01 ? '< 0.000001' : (v / 1e4).toPrecision(3);
  // ppm と % を併記
  const ppmPct = v => v == null || !Number.isFinite(v) ? '―' : `${fmtPpm(v)} ppm（${fmtPct(v)} %）`;
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
  // 表示テーマは QC Workbench の全ツールで共通のキーに保存する（旧キーの値は最初の1回だけ引き継ぐ）
  const THEME_KEY = 'qc-workbench-theme', OLD_THEME_KEY = 'cpk-calc-theme';
  const readTheme = () => {
    try {
      let t = localStorage.getItem(THEME_KEY);
      if (t == null) { t = localStorage.getItem(OLD_THEME_KEY); if (THEMES.includes(t)) localStorage.setItem(THEME_KEY, t); }
      return THEMES.includes(t) ? t : 'auto';
    } catch (e) { return 'auto'; }
  };
  let theme = readTheme();
  $('#themeBtn').addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % 3];
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* 無視 */ }
    applyTheme(theme);
  });
  // 別のタブや別のツールで切り替えたら、このページにも反映する
  window.addEventListener('storage', e => { if (e.key === THEME_KEY || e.key === null) { theme = readTheme(); applyTheme(theme); } });
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
    guessFirstCol();
    $('#fileName').textContent = name;
    $('#fileBar').hidden = false;
    $('#sheetField').hidden = st.wb.sheets.length < 2;
    $('#sheetSel').innerHTML = st.wb.sheets.map((s, i) => `<option value="${i}"${i === st.sheet ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
    $('#readOpts').hidden = false;
    rebuild();
  }
  // 先頭列が行の名前か、データかを推定する。
  //   左上が空欄、先頭列に文字が混じる、先頭列が 1, 2, 3… の連番 → 行の名前（従来どおり）
  //   それ以外（左上に見出しがあり、数値が並ぶ） → データ（Excel から列だけをコピーした場合など）
  function guessFirstCol() {
    const cells = st.wb.sheets[st.sheet].cells;
    if (!cells.length) return;
    const r0 = Math.min(...cells.map(c => c[0])), c0 = Math.min(...cells.map(c => c[1]));
    const top = cells.find(c => c[0] === r0 && c[1] === c0);
    const col = cells.filter(c => c[1] === c0 && c[0] > r0).sort((a, b) => a[0] - b[0]).map(c => c[2]);
    const nums = col.map(toNum);
    const serial = nums.length > 1 && nums.every((v, i) => v != null && v === nums[0] + i && Number.isInteger(v));
    const isData = !!top && typeof top[2] === 'string' && top[2].trim() !== '' && nums.length > 0 && nums.every(v => v != null) && !serial;
    st.firstColData = isData; $('#firstColData').checked = isData;
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
  // ① Excel からコピーした範囲（タブ区切りの文字列）を貼り付けて読み込む
  async function loadText(text, name) {
    if (!text || !text.trim()) { toast('貼り付けるデータがありません'); return; }
    st.wb = X.readCsv(text);
    if (!st.wb.sheets[0].cells.length) { toast('貼り付けたデータを読み込めませんでした'); return; }
    st.fileName = name; st.sheet = 0;
    guessFirstCol();
    $('#fileName').textContent = name; $('#fileBar').hidden = false; $('#sheetField').hidden = true; $('#readOpts').hidden = false;
    rebuild();
    toast('貼り付けたデータを読み込みました');
  }
  document.addEventListener('paste', e => {
    const t = e.target;
    // 入力欄への貼り付けはそのまま
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if ($('#dataSec').hidden || st.src === 'grid') return;
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    loadText(text, '貼り付けたデータ');
  });
  $('#pasteBtn').addEventListener('click', async () => {
    try { await loadText(await navigator.clipboard.readText(), '貼り付けたデータ'); }
    catch (e) { toast('クリップボードを読めませんでした。Ctrl+V（⌘+V）で貼り付けてください'); }
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
    let colLabels = uniq(cols.map(c => (hr && name(get(r0, c))) || X.colName(c)));
    let rowLabels = uniq(rows.map(r => (hc && name(get(r, c0))) || String(r + 1)));
    // ⑦ 名前が USL・LSL などの行（行方向のときは列）を規格値として取り出し、データから除く
    const kind = l => { const k = String(l).replace(/[\s　()（）]/g, '').toUpperCase(); return SPEC_USL.includes(k) ? 'usl' : SPEC_LSL.includes(k) ? 'lsl' : null; };
    const sheetSpec = {}, specNames = [];
    if (st.dir === '列方向') {
      const keep = [];
      rows.forEach((r, i) => {
        const k = kind(rowLabels[i]);
        if (!k) { keep.push(i); return; }
        specNames.push(rowLabels[i]);
        cols.forEach((c, j) => { const v = toNum(get(r, c)); if (v != null) (sheetSpec[colLabels[j]] = sheetSpec[colLabels[j]] || {})[k] = v; });
      });
      if (specNames.length) { rowLabels = keep.map(i => rowLabels[i]); rows.splice(0, rows.length, ...keep.map(i => rows[i])); }
    } else {
      const keep = [];
      cols.forEach((c, j) => {
        const k = kind(colLabels[j]);
        if (!k) { keep.push(j); return; }
        specNames.push(colLabels[j]);
        rows.forEach((r, i) => { const v = toNum(get(r, c)); if (v != null) (sheetSpec[rowLabels[i]] = sheetSpec[rowLabels[i]] || {})[k] = v; });
      });
      if (specNames.length) { colLabels = keep.map(j => colLabels[j]); cols.splice(0, cols.length, ...keep.map(j => cols[j])); }
    }
    return { rows, cols, colLabels, rowLabels, get, sheetSpec, specNames };
  }
  const SPEC_USL = ['USL', '上限', '上限値', '規格上限', '規格上限値', '上限規格', '上限規格値', '上側規格', '上側規格限界', 'UPPER', 'UPPERLIMIT'];
  const SPEC_LSL = ['LSL', '下限', '下限値', '規格下限', '規格下限値', '下限規格', '下限規格値', '下側規格', '下側規格限界', 'LOWER', 'LOWERLIMIT'];
  // 解析対象の名前一覧と、名前から値の列（欠損は null）を取り出す関数
  const labels = () => !st.table ? [] : st.dir === '列方向' ? st.table.colLabels : st.table.rowLabels;
  function seriesRaw(label) {
    const T = st.table;
    if (st.dir === '列方向') { const c = T.cols[T.colLabels.indexOf(label)]; return T.rows.map(r => T.get(r, c)); }
    const r = T.rows[T.rowLabels.indexOf(label)]; return T.cols.map(c => T.get(r, c));
  }
  const series = label => seriesRaw(label).map(toNum);

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
    $('#previewNote').textContent = `${T.rows.length} 行 × ${T.cols.length} 列（先頭 5 行を表示）` +
      (T.specNames.length ? `。「${T.specNames.join('」「')}」を規格値として読み込み、データからは除きました` : '');
    // シートの規格値は、まだ入力されていない対象にだけ入れる
    for (const [l, v] of Object.entries(T.sheetSpec)) {
      const cur = st.spec[l];
      if (!cur || (!String(cur.usl).trim() && !String(cur.lsl).trim())) st.spec[l] = { usl: v.usl != null ? String(v.usl) : '', lsl: v.lsl != null ? String(v.lsl) : '', draw: '', nominal: null };
    }
    // 解析対象の候補が変わったら選択を引き継ぐ
    const L = labels();
    st.targets = st.targets.filter(t => L.includes(t));
    renderTargets();
    $('#capSetup').hidden = $('#capOpts').hidden = false;
    $('#testSetup').hidden = false;
    // 検定の対象：選んでいた項目が残っていれば選んだままにする
    const prevA = $('#tA').value, prevB = $('#tB').value;
    $('#tA').innerHTML = $('#tB').innerHTML = L.map(l => `<option>${esc(l)}</option>`).join('');
    if (L.includes(prevA)) $('#tA').value = prevA;
    if (L.includes(prevB) && prevB !== $('#tA').value) $('#tB').value = prevB; else if (L.length > 1) $('#tB').selectedIndex = $('#tA').selectedIndex === 1 ? 0 : 1;
    // ⑤ サブグループの分け方の候補（データの列・行の名前）
    if (!L.includes(st.groupBy)) st.groupBy = '';
    $('#groupBy').innerHTML = `<option value="">連続する n 個ずつ</option>` + L.map(l => `<option value="${esc(l)}"${l === st.groupBy ? ' selected' : ''}>${st.dir === '列方向' ? '列' : '行'}「${esc(l)}」の値で分ける</option>`).join('');
    syncGroupUi();
    renderAttrSetup();
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
  const specOf0 = t => st.spec[t] || (st.spec[t] = { usl: '', lsl: '', draw: '', nominal: null });
  function renderSpec() {
    $('#specWrap').hidden = !st.targets.length;
    // 入力中の欄を描き直しても、フォーカスとカーソル位置を保つ
    const act = document.activeElement, keep = act && act.closest && act.closest('#specBody') ? [act.dataset.t, act.dataset.k, act.selectionStart] : null;
    $('#specBody').innerHTML = st.targets.map((t, i) => {
      const s = specOf0(t);
      const dis = st.sameSpec && i > 0 ? ' disabled' : '';
      const v = st.sameSpec && i > 0 ? specOf0(st.targets[0]) : s;
      const n = series(t).filter(x => x != null).length;
      const pr = v.draw && String(v.draw).trim() ? SP.parseTolerance(v.draw) : null;
      return `<tr><td class="l">${esc(t)}</td>` +
        `<td class="draw l"><input type="text" data-t="${esc(t)}" data-k="draw" value="${esc(v.draw || '')}" placeholder="例：10 +0.1/-0.05" class="${pr && pr.error ? 'bad' : ''}"${dis} aria-label="${esc(t)} の図面の表記">` +
        `<span class="msg">${pr && pr.error ? esc(pr.error) : ''}</span></td>` +
        `<td><input class="num" type="text" inputmode="decimal" data-t="${esc(t)}" data-k="usl" value="${esc(v.usl)}"${dis}></td>` +
        `<td><input class="num" type="text" inputmode="decimal" data-t="${esc(t)}" data-k="lsl" value="${esc(v.lsl)}"${dis}></td><td class="num">${n}</td></tr>`;
    }).join('');
    if (keep) { const el = $(`#specBody input[data-t="${CSS.escape(keep[0])}"][data-k="${keep[1]}"]`); if (el) { el.focus(); try { el.setSelectionRange(keep[2], keep[2]); } catch (e) { /* 無視 */ } } }
  }
  $('#specBody').addEventListener('input', e => {
    const i = e.target; if (!i.dataset.t) return;
    const sp = specOf0(i.dataset.t), k = i.dataset.k;
    const row = i.closest('tr');
    if (k === 'draw') {
      // 図面の表記から上限・下限を計算して入れる
      sp.draw = i.value;
      const pr = i.value.trim() ? SP.parseTolerance(i.value) : null;
      const msg = row.querySelector('.msg');
      i.classList.toggle('bad', !!(pr && pr.error)); msg.textContent = pr && pr.error ? pr.error : '';
      if (pr && !pr.error) {
        sp.usl = pr.usl != null ? String(pr.usl) : ''; sp.lsl = pr.lsl != null ? String(pr.lsl) : ''; sp.nominal = pr.nominal;
        row.querySelector('[data-k="usl"]').value = sp.usl; row.querySelector('[data-k="lsl"]').value = sp.lsl;
      } else if (!pr) sp.nominal = null;
    } else {
      // 上限・下限を直接変えたら、図面の表記とは合わなくなるので表記を消す
      sp[k] = i.value;
      if (sp.draw) { sp.draw = ''; sp.nominal = null; const d = row.querySelector('[data-k="draw"]'); d.value = ''; d.classList.remove('bad'); row.querySelector('.msg').textContent = ''; }
    }
    if (st.sameSpec && i.dataset.t === st.targets[0]) $$('#specBody tr').slice(1).forEach(tr => {
      tr.querySelector('[data-k="draw"]').value = sp.draw || ''; tr.querySelector('[data-k="usl"]').value = sp.usl; tr.querySelector('[data-k="lsl"]').value = sp.lsl;
    });
    saveGridSoon();
    liveSoon();
  });
  $('#sameSpec').addEventListener('change', e => { st.sameSpec = e.target.checked; renderSpec(); });

  // ---------- 解析オプション ----------
  $('#subgroup').addEventListener('change', e => { st.subgroup = +e.target.value; });
  function syncGroupUi() { $('#subgroup').disabled = !!st.groupBy; }
  $('#groupBy').addEventListener('change', e => { st.groupBy = e.target.value; syncGroupUi(); });
  $('#runRules').addEventListener('change', e => { st.rules = e.target.checked; });
  $('#judgeBasis').addEventListener('change', e => { st.judge.basis = e.target.value; });
  for (const [id, k] of [['#thEx', 'ex'], ['#thGd', 'gd'], ['#thWa', 'wa']]) $(id).addEventListener('input', e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) st.judge[k] = v; });
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
  // ③ 工程能力図：ヒストグラムに、群内 σ・全体 σ の正規分布曲線（度数に合わせて拡大）と規格線を重ねる
  function histChart(x, usl, lsl, cap, label, nominal = null) {
    const n = x.length, k = Math.max(5, Math.ceil(Math.log2(n) + 1)), mu = cap.mean;
    let lo = Math.min(...x), hi = Math.max(...x);
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    const w = (hi - lo) / k, cnt = new Array(k).fill(0);
    for (const v of x) cnt[Math.min(k - 1, Math.floor((v - lo) / w))]++;
    const bars = cnt.map((h, i) => ({ x0: lo + i * w, x1: lo + (i + 1) * w, h }));
    const curve = sg => {
      const a = Math.min(lo, mu - 4 * sg, usl ?? Infinity, lsl ?? Infinity), b = Math.max(hi, mu + 4 * sg, usl ?? -Infinity, lsl ?? -Infinity);
      const pts = []; for (let i = 0; i <= 240; i++) { const v = a + (b - a) * i / 240; pts.push([v, n * w * S.normPdf(v, mu, sg)]); }
      return pts;
    };
    const layers = [{ type: 'bars', data: bars, color: 'var(--s1)', label: '度数' }];
    layers.push({ type: 'line', data: curve(cap.sigmaOverall), color: 'var(--ink2)', width: 2, label: '全体（Pp/Ppk）' });
    if (cap.sigmaWithin) layers.push({ type: 'line', data: curve(cap.sigmaWithin), color: 'var(--s3)', width: 2, dash: '6 4', label: '群内（Cp/Cpk）' });
    const nom = nominal != null ? [{ type: 'vline', x: nominal, color: 'var(--muted)', dash: '3 3', text: `基準値 ${num(nominal)}` }] : [];
    return C.plot({ title: `工程能力図（${label}）`, xLabel: '値', yLabel: '度数', yZero: true, layers: [...layers, ...nom, ...specLines(usl, lsl, mu)] });
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
  // hits: 異常判定ルールの結果。ルール 1（管理限界外）の点は赤、ほかのルールが成立した点（並びの最後の点）は橙
  function ctrlChart(title, xLabel, yLabel, c, hits = [], varyBy = 'サブグループのサイズ') {
    const start = c.start || 1;
    const data = c.points.map((v, i) => [start + i, v]);
    const color = c.points.map(() => 'var(--s1)');
    for (const h of hits) for (const i of h.ends) if (color[i] !== 'var(--ng)') color[i] = h.rule === 1 ? 'var(--ng)' : 'var(--warn)';
    const flat = a => a.every(v => Math.abs(v - a[0]) < 1e-12 * Math.max(1, Math.abs(a[0])));
    // 管理限界がサブグループごとに変わるときは階段状に描く
    const line = (arr, col, name) => flat(arr) ? { type: 'hline', y: arr[0], color: col, dash: '6 4', text: `${name} ${sig(arr[0])}` }
      : { type: 'line', data: arr.flatMap((v, i) => [[start + i - 0.5, v], [start + i + 0.5, v]]), color: col, dash: '6 4', width: 1.5 };
    const vary = !flat(c.ucl);
    return C.plot({ title: title + (vary ? `　※管理限界は${varyBy}で変化` : ''), xLabel, yLabel, legend: false,
      layers: [{ type: 'line', data, color: 'var(--s1)', width: 1.5 },
        { type: 'points', data, colors: color, r: 3.4 },
        line(c.cl, 'var(--ok)', 'CL'), line(c.ucl, 'var(--ng)', 'UCL'), line(c.lcl, 'var(--ng)', 'LCL')] });
  }

  // ---------- 工程能力解析 ----------
  const level = (v, J = (st.capResult && st.capResult.judge) || st.judge) => v == null ? null : v >= J.ex ? ['ex', '◎ 非常に良好'] : v >= J.gd ? ['gd', '○ 良好'] : v >= J.wa ? ['wa', '△ 要注意'] : ['ng', '✕ 不良'];
  // 今の Ppk のまま、95% 信頼区間の下限を「○ 良好」の基準値以上にするのに必要なデータ数
  function needN(r, J) {
    const c = r.cap;
    if (c.Ppk == null) return '―';
    if (r.reqN == null) return `届きません<br><small>Ppk ${fmt(c.Ppk)} が ${J.gd} 以下のため、データを増やしても下限は ${J.gd} 以上になりません</small>`;
    return `${r.reqN.toLocaleString('ja-JP')} 個<br><small>${r.reqN <= c.n ? `足りています（今 ${c.n} 個）` : `あと ${(r.reqN - c.n).toLocaleString('ja-JP')} 個（今 ${c.n} 個）`}。95%下限 ≥ ${J.gd} に必要な数</small>`;
  }
  const BASIS = { Cpk: 'Cpk', Ppk: 'Ppk', PpkLow: 'Ppk 95%下限' };
  // 判定に使う値。Cpk を計算できないときは Ppk で代える
  function judgeValue(c, basis) {
    if (basis === 'Cpk') return c.Cpk != null ? [c.Cpk, 'Cpk'] : [c.Ppk, 'Ppk'];
    if (basis === 'Ppk') return [c.Ppk, 'Ppk'];
    return [c.PpkCI[0], 'Ppk 95%下限'];
  }
  const lvCell = v => { const L = level(v); return L ? `<span class="lv ${L[0]}">${fmt(v)}</span>` : '―'; };

  $('#runCap').addEventListener('click', () => runCap({ scroll: true }));
  // quiet: 入力に合わせた自動更新のときは注意を出さず、画面も動かさない
  function runCap({ scroll = false, quiet = false } = {}) {
    if (!st.targets.length) { if (!quiet) toast('解析対象を選んでください'); return; }
    const J = st.judge;
    if (!(J.ex > J.gd && J.gd > J.wa)) { if (!quiet) toast('判定の基準値は ◎ ＞ ○ ＞ △ の順に大きくしてください'); return; }
    const log = [], rows = [];
    const m = st.subgroup, ddof = st.std === '母集団標準偏差' ? 0 : 1, gb = st.groupBy;
    const keys = gb ? seriesRaw(gb).map(v => v == null ? '' : String(v).trim()) : null;
    const specOf = (t, i) => st.sameSpec ? st.spec[st.targets[0]] : st.spec[t];
    st.targets.forEach((t, i) => {
      if (t === gb) { log.push(['warn', `${t}: サブグループの分け方に使っているため解析しません`]); return; }
      const raw = series(t);
      let x = raw.filter(v => v != null), groups = null, groupKeys = null;
      if (gb) {
        // ⑤ 列（行）の値が同じデータを1つのサブグループにする（最初に出てきた順）
        const map = new Map(); let noKey = 0;
        raw.forEach((v, j) => { if (v == null) return; if (!keys[j]) { noKey++; return; } if (!map.has(keys[j])) map.set(keys[j], []); map.get(keys[j]).push(v); });
        if (noKey) log.push(['warn', `${t}: 「${gb}」が空欄のデータ ${noKey} 件は解析から除外しました`]);
        groupKeys = [...map.keys()]; groups = [...map.values()]; x = groups.flat();
      }
      if (x.length < raw.length) log.push(['info', `${t}: 空欄・数値でない ${raw.length - x.length} 件を除外しました（${raw.length} → ${x.length}）`]);
      if (x.length < 2) { log.push(['err', `${t}: 有効なデータが ${x.length} 件のため解析できません`]); return; }
      const sp = specOf(t, i), us = String(sp.usl).trim(), ls = String(sp.lsl).trim();
      if (!us && !ls) { log.push(['warn', `${t}: 規格値（上限・下限）が両方空欄のため解析しません`]); return; }
      const usl = us ? toNum(us) : null, lsl = ls ? toNum(ls) : null;
      if ((us && usl == null) || (ls && lsl == null)) { log.push(['err', `${t}: 規格値が数値ではありません`]); return; }
      if (usl != null && lsl != null && usl <= lsl) { log.push(['err', `${t}: 規格上限値（${usl}）が下限値（${lsl}）以下です`]); return; }
      const cap = S.capability(x, usl, lsl, m, ddof, 0.05, groups);
      if (!(cap.sigmaOverall > 0)) { log.push(['err', `${t}: 標準偏差が 0 のため工程能力指数を計算できません`]); return; }
      for (const note of cap.notes) log.push(['warn', `${t}: ${note}`]);
      const sw = x.length >= 3 && x.length <= 5000 ? S.shapiro(x) : null;
      if (sw && sw.p < 0.05) log.push(['warn', `${t}: Shapiro-Wilk 検定で p = ${fmtP(sw.p)} < 0.05。正規分布でない可能性があり、工程能力指数の解釈に注意が必要です`]);
      if (cap.observed.total) log.push(['warn', `${t}: 規格外れが ${cap.observed.total} 個あります（${ppmPct(cap.observed.ppm)}）`]);
      // 管理図と異常判定（⑥）
      const cc = S.controlCharts(x, m, groups);
      const hits = { main: [], range: [], s: [] };
      if (cc && st.rules) {
        hits.main = S.runRules(cc.main);
        hits.range = S.runRules(cc.range.sigma ? cc.range : { ...cc.range, sigma: cc.range.points.map(() => 1) }, [1]);
        if (cc.s) hits.s = S.runRules({ ...cc.s, sigma: cc.s.points.map(() => 1) }, [1]);
        const name = { main: cc.type === 'I-MR' ? 'I 管理図' : 'X̄ 管理図', range: cc.type === 'I-MR' ? 'MR 管理図' : 'R 管理図', s: 's 管理図' };
        // 点の呼び方：サブグループをキーで分けたときはその値、それ以外は番号
        const ptName = (chart, idx) => {
          const no = (cc[chart].start || 1) + idx;
          return groupKeys && cc.groupIndex ? `「${groupKeys[cc.groupIndex[idx]]}」` : `${no}`;
        };
        for (const ch of ['main', 'range', 's']) for (const h of hits[ch])
          log.push(['warn', `${t}: ${name[ch]} ルール${h.rule}（${h.text}）: 点 ${ptName(ch, h.from)}${h.to > h.from ? `〜${ptName(ch, h.to)}` : ''}`]);
      }
      if (cc && cc.k != null && groups && cc.k < groups.length) log.push(['info', `${t}: サイズが 2〜10 でないサブグループ ${groups.length - cc.k} 組は管理図に描いていません`]);
      const reqN = cap.Ppk != null ? S.requiredN(cap.Ppk, J.gd, 0.05) : null;
      rows.push({ t, x, usl, lsl, nominal: specOf(t, i).nominal ?? null, reqN, cap, sw, cc, hits, groupKeys, max: Math.max(...x), min: Math.min(...x), skew: S.skewness(x), kurt: S.kurtosis(x),
        type: usl != null && lsl != null ? '両側' : usl != null ? '上側のみ' : '下側のみ' });
    });
    st.capResult = { rows, log, m, ddof, gb, judge: { ...J }, rules: st.rules };
    renderCap(scroll);
  }

  function renderCap(scroll = true) {
    const { rows, log, m, gb, judge } = st.capResult;
    $('#capResult').hidden = false;
    $('#judgeNote').textContent = `判定は ${BASIS[judge.basis]} で行います${judge.basis === 'Cpk' ? '（Cpk を計算できないときは Ppk）' : ''}。推定不良率は正規分布を仮定した値です。`;
    const th = v => v.toFixed(2);
    $('#legend').innerHTML = `<span class="lv ex">◎ ${th(judge.ex)} 以上</span><span class="lv gd">○ ${th(judge.gd)} 以上</span><span class="lv wa">△ ${th(judge.wa)} 以上</span><span class="lv ng">✕ ${th(judge.wa)} 未満</span>`;
    $('#printHead').innerHTML = `<h1>工程能力解析</h1>ファイル：${esc(st.fileName)}　シート：${esc(st.wb.sheets[st.sheet].name)}　作成：${esc(new Date().toLocaleString('ja-JP'))}<br>` +
      `サブグループ：${gb ? `「${esc(gb)}」の値で分ける` : `連続する ${m} 個ずつ`}　全体の標準偏差：${st.capResult.ddof ? '標本（n−1）' : '母集団（n）'}　判定：${BASIS[judge.basis]}（◎ ${th(judge.ex)}／○ ${th(judge.gd)}／△ ${th(judge.wa)}）`;
    $('#capLog').innerHTML = log.map(([k, s]) => `<li class="${k}">${esc(s)}</li>`).join('');
    if (!rows.length) { $('#summary').innerHTML = ''; $('#capDetail').innerHTML = ''; if (scroll) $('#capResult').scrollIntoView({ behavior: 'smooth' }); return; }
    $('#summary').innerHTML = `<table><thead><tr><th class="l">解析対象</th><th>n</th><th>平均</th><th>σ(群内)</th><th>σ(全体)</th><th>Cp</th><th>Cpk</th><th>Pp</th><th>Ppk</th><th>Ppk 95%信頼区間</th><th>推定不良率<br><small>群内 ／ 全体</small></th><th>規格外れ<br><small>実測</small></th><th>管理図<br><small>異常</small></th><th>判定（${BASIS[judge.basis]}）</th></tr></thead><tbody>` +
      rows.map(r => {
        const c = r.cap, [j, used] = judgeValue(c, judge.basis), L = level(j);
        const nHits = r.hits.main.length + r.hits.range.length + r.hits.s.length;
        return `<tr><td class="l">${esc(r.t)}</td><td class="num">${c.n}</td><td class="num">${sig(c.mean)}</td><td class="num">${sig(c.sigmaWithin, 4)}</td><td class="num">${sig(c.sigmaOverall, 4)}</td>` +
          `<td class="num">${fmt(c.Cp)}</td><td class="num">${lvCell(c.Cpk)}</td><td class="num">${fmt(c.Pp)}</td><td class="num">${lvCell(c.Ppk)}</td>` +
          `<td class="num">${c.PpkCI[0] != null ? `${fmt(c.PpkCI[0])} ～ ${fmt(c.PpkCI[1])}` : '―'}</td>` +
          `<td class="num">${fmtPpm(c.ppmWithin && c.ppmWithin.total)} ／ ${fmtPpm(c.ppmOverall && c.ppmOverall.total)} ppm<br><small>${fmtPct(c.ppmWithin && c.ppmWithin.total)} ／ ${fmtPct(c.ppmOverall && c.ppmOverall.total)} %</small></td><td class="num">${c.observed.total} 個</td>` +
          `<td class="num">${st.capResult.rules ? (nHits ? `<span class="lv wa">${nHits} 件</span>` : 'なし') : '―'}</td>` +
          `<td>${L ? `<span class="lv ${L[0]}">${L[1]}${used !== BASIS[judge.basis] ? `（${used}）` : ''}</span>` : '―'}</td></tr>`;
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
        ['必要データ数の目安', needN(r, judge)],
        ...[['推定不良率（群内）', c.ppmWithin], ['推定不良率（全体）', c.ppmOverall]].map(([k, p]) => [k, p ? `${fmtPpm(p.total)} ppm<br><small>${fmtPct(p.total)} %<br>上 ${fmtPpm(p.upper)} ／ 下 ${fmtPpm(p.lower)} ppm<br>上 ${fmtPct(p.upper)} ／ 下 ${fmtPct(p.lower)} %</small>` : '―']),
        ['規格外れ（実測）', `${c.observed.total} 個<br><small>上 ${c.observed.upper ?? '―'} ／ 下 ${c.observed.lower ?? '―'}<br>${ppmPct(c.observed.ppm)}</small>`],
        ['サブグループ', gb ? `${c.subgroups} 組<br><small>「${esc(gb)}」で分ける</small>` : m === 1 ? '個別値' : `${c.subgroups} 組<br><small>${m} 個ずつ</small>`],
      ];
      const hitList = st.capResult.rules ? log.filter(([k, s]) => k === 'warn' && s.startsWith(`${r.t}: `) && /管理図 ルール/.test(s)).map(([, s]) => s.slice(r.t.length + 2)) : [];
      sec.innerHTML = `<h3>${esc(r.t)}</h3><dl class="kv">${kv.map(([k, v]) => `<div><dt>${k}</dt><dd class="num">${v}</dd></div>`).join('')}</dl>` +
        (hitList.length ? `<ul class="rulehits">${hitList.map(s => `<li>! ${esc(s)}</li>`).join('')}</ul>` : '') + '<div class="charts"></div>';
      det.appendChild(sec);
      const g = sec.querySelector('.charts'), sh = st.show;
      if (sh.hist) addChart(g, `capability_${r.t}`, () => histChart(r.x, r.usl, r.lsl, c, r.t, r.nominal));
      if (sh.qq) addChart(g, `qq_${r.t}`, () => qqChart(r.x, r.t));
      if (sh.density) addChart(g, `density_${r.t}`, () => densityChart(c.mean, c.sigmaOverall, r.usl, r.lsl, r.t));
      const cc = r.cc, H = r.hits;
      if (!cc) continue;
      if (cc.type === 'I-MR') {
        if (sh.xbar) addChart(g, `i_${r.t}`, () => ctrlChart(`I 管理図（${r.t}）`, 'データ点', '値', cc.main, H.main));
        if (sh.r) addChart(g, `mr_${r.t}`, () => ctrlChart(`MR 管理図（${r.t}）`, 'データ点（2番目以降）', '移動範囲', cc.range, H.range));
      } else {
        if (sh.xbar) addChart(g, `xbar_${r.t}`, () => ctrlChart(`X̄ 管理図（${r.t}）`, 'サブグループ番号', 'サブグループ平均', cc.main, H.main));
        if (sh.r) addChart(g, `r_${r.t}`, () => ctrlChart(`R 管理図（${r.t}）`, 'サブグループ番号', '範囲', cc.range, H.range));
        if (sh.s) addChart(g, `s_${r.t}`, () => ctrlChart(`s 管理図（${r.t}）`, 'サブグループ番号', '標準偏差', cc.s, H.s));
      }
    }
    if (scroll) $('#capResult').scrollIntoView({ behavior: 'smooth' });
  }

  $('#dlCap').addEventListener('click', () => {
    const R = st.capResult; if (!R || !R.rows.length) { toast('保存する結果がありません'); return; }
    const head = ['解析対象', 'サンプル数', '規格種別', '上限規格', '下限規格', '最大値', '最小値', '平均値', 'σ(群内)', 'σ(群内)の推定方法', '標準偏差(全体)',
      'Cp', 'Cpk', 'CPU', 'CPL', 'Pp', 'Pp_lower (95%)', 'Pp_upper (95%)', 'Ppk', 'Ppk_lower (95%, Bissell)', 'Ppk_upper (95%, Bissell)',
      '推定不良率 群内 上側 (ppm)', '推定不良率 群内 下側 (ppm)', '推定不良率 群内 合計 (ppm)', '推定不良率 群内 合計 (%)', '推定不良率 全体 上側 (ppm)', '推定不良率 全体 下側 (ppm)', '推定不良率 全体 合計 (ppm)', '推定不良率 全体 合計 (%)',
      '規格外れ 上側 (個)', '規格外れ 下側 (個)', '規格外れ (ppm)', '規格外れ (%)', 'サブグループ数', '管理図の異常 (件)', '判定に使った値', '判定', '必要データ数 (Ppk 95%下限 ≥ ○の基準)', '図面の表記', '基準値', '尖度', '歪度', 'Shapiro-Wilk p値'];
    const toPct = v => v == null || !Number.isFinite(v) ? null : v / 1e4;  // ppm → %
    const rows = R.rows.map(r => {
      const c = r.cap, pw = c.ppmWithin || {}, po = c.ppmOverall || {}, [j, used] = judgeValue(c, R.judge.basis), L = level(j, R.judge);
      return [r.t, c.n, r.type, r.usl, r.lsl, r.max, r.min, c.mean, c.sigmaWithin, c.sigmaWithinMethod, c.sigmaOverall,
        c.Cp, c.Cpk, c.Cpu, c.Cpl, c.Pp, c.PpCI[0], c.PpCI[1], c.Ppk, c.PpkCI[0], c.PpkCI[1],
        pw.upper, pw.lower, pw.total, toPct(pw.total), po.upper, po.lower, po.total, toPct(po.total), c.observed.upper, c.observed.lower, c.observed.ppm, toPct(c.observed.ppm),
        c.subgroups, R.rules ? r.hits.main.length + r.hits.range.length + r.hits.s.length : null, used, L ? L[1] : null, r.reqN,
        ((st.sameSpec ? st.spec[st.targets[0]] : st.spec[r.t]) || {}).draw || null, r.nominal, r.kurt, r.skew, r.sw ? r.sw.p : null];
    });
    const cond = [['項目', '値'], ['ファイル', st.fileName], ['シート', st.wb.sheets[st.sheet].name], ['計算対象の方向', st.dir],
      ['サブグループ', R.gb ? `「${R.gb}」の値で分ける` : `連続する ${R.m} 個ずつ`],
      ['全体の標準偏差', R.ddof ? '標本標準偏差（n−1）' : '母集団標準偏差（n）'], ['判定に使う値', BASIS[R.judge.basis]],
      ['判定基準', `◎ ${R.judge.ex} 以上 ／ ○ ${R.judge.gd} 以上 ／ △ ${R.judge.wa} 以上`], ['管理図の異常判定ルール', R.rules ? 'JIS Z 9020-2 の 8 ルール（R・MR・s は管理限界外のみ）' : '使わない'],
      ['作成', new Date().toLocaleString('ja-JP')]];
    download(X.writeXlsx([{ name: '工程能力', rows: [head, ...rows] }, { name: 'ログ', rows: [['区分', '内容'], ...R.log.map(([k, s]) => [{ info: '情報', warn: '注意', err: 'エラー' }[k], s])] }, { name: '条件', rows: cond }]),
      `${stamp()}_results.xlsx`, XLSX_TYPE);
  });

  // ---------- 設定の保存・読み込み ----------
  $('#exportSettings').addEventListener('click', () => {
    const s = {
      schema_version: '1.0', exported_at: new Date().toISOString(), subgroup_size: st.subgroup, std_method: st.std,
      include_first_row: st.firstRowData, include_first_column: st.firstColData, calc_direction: st.dir,
      show_hist: st.show.hist, show_qq: st.show.qq, show_density: st.show.density, show_xbar: st.show.xbar, show_r: st.show.r, show_s: st.show.s,
      same_spec: st.sameSpec, selected_targets: st.targets,
      group_by: st.groupBy, run_rules: st.rules, judge_basis: st.judge.basis, judge_thresholds: [st.judge.ex, st.judge.gd, st.judge.wa],
      spec_table: st.targets.map((t, i) => { const sp = st.sameSpec ? st.spec[st.targets[0]] : st.spec[t]; return [t, String(sp.usl), String(sp.lsl), String(sp.draw || '')]; }),
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
    for (const row of s.spec_table || []) if (Array.isArray(row) && row.length >= 3) {
      const draw = String(row[3] ?? ''), pr = draw.trim() ? SP.parseTolerance(draw) : null;
      st.spec[String(row[0])] = { usl: String(row[1] ?? ''), lsl: String(row[2] ?? ''), draw, nominal: pr && !pr.error ? pr.nominal : null };
    }
    st.targets = (s.selected_targets || []).map(String);
    if (typeof s.group_by === 'string') st.groupBy = s.group_by;
    if (typeof s.run_rules === 'boolean') { st.rules = s.run_rules; $('#runRules').checked = st.rules; }
    if (BASIS[s.judge_basis]) { st.judge.basis = s.judge_basis; $('#judgeBasis').value = s.judge_basis; }
    if (Array.isArray(s.judge_thresholds) && s.judge_thresholds.length === 3 && s.judge_thresholds.every(Number.isFinite)) {
      [st.judge.ex, st.judge.gd, st.judge.wa] = s.judge_thresholds; $('#thEx').value = st.judge.ex; $('#thGd').value = st.judge.gd; $('#thWa').value = st.judge.wa;
    }
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

  // ---------- 計数値の管理図 ----------
  const ATTR = {
    p: { name: 'p 管理図（不良率）', d: '不良数', n: '検査数', y: '不良率', hint: '群ごとの不良率 = 不良数 ÷ 検査数 を打点します。検査数が群ごとに違ってもよく、管理限界は群ごとの検査数で変わります。' },
    np: { name: 'np 管理図（不良数）', d: '不良数', n: '検査数', y: '不良数', hint: '不良数をそのまま打点します。検査数がすべての群で同じときに使います（違うときは p 管理図）。' },
    u: { name: 'u 管理図（単位あたりの欠点数）', d: '欠点数', n: '単位数', y: '単位あたりの欠点数', hint: '単位あたりの欠点数 = 欠点数 ÷ 単位数（面積・長さ・台数など）を打点します。単位数が群ごとに違ってもよく、管理限界は単位数で変わります。' },
    c: { name: 'c 管理図（欠点数）', d: '欠点数', n: '', y: '欠点数', hint: '欠点数をそのまま打点します。調べる大きさ（面積・台数など）がすべての群で同じときに使います（違うときは u 管理図）。' },
  };
  st.attr = { kind: 'p', d: '', n: '', nConst: '', rules: true };
  function renderAttrSetup() {
    const L = labels(), A = st.attr, has = !!st.table && L.length > 0;
    $('#attrNoData').hidden = has; $('#attrForm').hidden = !has;
    if (!has) return;
    // 名前から列を推測（初回のみ）
    const guess = re => L.find(l => re.test(l)) || '';
    if (!L.includes(A.d)) A.d = guess(/不良|欠点|NG|不合格|defect/i) || L[0];
    if (A.n && !L.includes(A.n)) A.n = '';
    if (!A.n && A.nConst === '') A.n = guess(/検査|サンプル|数量|個数|単位|^n$|size/i);
    if (A.n === A.d) A.n = '';
    $('#attrD').innerHTML = L.map(l => `<option${l === A.d ? ' selected' : ''}>${esc(l)}</option>`).join('');
    $('#attrN').innerHTML = `<option value="">一定の値を入れる</option>` + L.map(l => `<option value="${esc(l)}"${l === A.n ? ' selected' : ''}>${esc(l)}</option>`).join('');
    syncAttrUi();
  }
  function syncAttrUi() {
    const A = st.attr, K = ATTR[A.kind];
    segSet('#attrKind', A.kind);
    $('#attrDLbl').textContent = `${K.d}の${st.dir === '列方向' ? '列' : '行'}`;
    $('#attrNLbl').textContent = K.n; $('#attrNConstLbl').textContent = `${K.n}（一定）`;
    $('#attrNField').hidden = A.kind === 'c';
    $('#attrNConstField').hidden = A.kind === 'c' || !!A.n;
    $('#attrNConst').value = A.nConst;
    $('#attrKindHint').innerHTML = `<strong>${esc(K.name)}</strong>：${esc(K.hint)}`;
  }
  segInit('#attrKind', v => { st.attr.kind = v; syncAttrUi(); });
  $('#attrD').addEventListener('change', e => { st.attr.d = e.target.value; });
  $('#attrN').addEventListener('change', e => { st.attr.n = e.target.value; syncAttrUi(); });
  $('#attrNConst').addEventListener('input', e => { st.attr.nConst = e.target.value; });
  $('#attrRules').addEventListener('change', e => { st.attr.rules = e.target.checked; });

  // 値の表示：p 管理図は %、それ以外は有効数字
  const attrFmt = (kind, v) => v == null || !Number.isFinite(v) ? '―' : kind === 'p' ? `${sig(v * 100, 4)} %` : sig(v, 4);
  const range = (kind, a) => { const lo = Math.min(...a), hi = Math.max(...a); return Math.abs(hi - lo) < 1e-12 * Math.max(1, Math.abs(hi)) ? attrFmt(kind, lo) : `${attrFmt(kind, lo)} 〜 ${attrFmt(kind, hi)}`; };

  $('#runAttr').addEventListener('click', () => {
    const A = st.attr, K = ATTR[A.kind], log = [];
    const err = msg => { $('#attrResult').hidden = false; $('#attrKv').innerHTML = ''; $('#attrHits').innerHTML = ''; $('#attrCharts').innerHTML = ''; $('#attrLog').innerHTML = `<li class="err">${esc(msg)}</li>`; st.attrResult = null; };
    if (!st.table) return err('データを読み込んでください。');
    const dRaw = series(A.d);
    let nRaw;
    if (A.kind === 'c') nRaw = dRaw.map(() => 1);
    else if (A.n) nRaw = series(A.n);
    else {
      const c = toNum(A.nConst);
      if (!(c > 0)) return err(`${K.n}の列を選ぶか、一定の${K.n}を入れてください。`);
      nRaw = dRaw.map(() => c);
    }
    // 両方そろった行だけ使う
    const d = [], n = [], rowNo = [];
    let skipped = 0;
    for (let i = 0; i < dRaw.length; i++) {
      if (dRaw[i] == null && nRaw[i] == null) continue;
      if (dRaw[i] == null || nRaw[i] == null) { skipped++; continue; }
      d.push(dRaw[i]); n.push(nRaw[i]); rowNo.push(i);
    }
    if (skipped) log.push(['warn', `${K.d}か${K.n || '値'}が空欄の ${skipped} 群を除きました。`]);
    if (d.length < 2) return err('群が 2 つ以上必要です。');
    // 群の名前：行の名前（列方向のとき）が番号だけなら、ロット番号など文字の列があればその値を使う
    let names = st.dir === '列方向' ? st.table.rowLabels : st.table.colLabels;
    if (names.every(v => /^\d+$/.test(String(v)))) {
      const txt = labels().find(l => { const raw = seriesRaw(l); return raw.some(v => v != null) && raw.every(v => v == null || toNum(v) == null); });
      if (txt) names = seriesRaw(txt).map(v => v == null ? '' : String(v));
      else names = names.map(() => '');
    }
    const name = i => names[rowNo[i]] || `群 ${i + 1}`;
    for (let i = 0; i < d.length; i++) {
      if (!(Number.isInteger(d[i]) && d[i] >= 0)) return err(`${name(i)} の${K.d}「${num(d[i])}」は 0 以上の整数ではありません。`);
      if (A.kind !== 'c' && !(n[i] > 0)) return err(`${name(i)} の${K.n}「${num(n[i])}」は正の値ではありません。`);
      if ((A.kind === 'p' || A.kind === 'np') && !Number.isInteger(n[i])) return err(`${name(i)} の検査数「${num(n[i])}」は整数ではありません。`);
      if ((A.kind === 'p' || A.kind === 'np') && d[i] > n[i]) return err(`${name(i)} の不良数が検査数より多くなっています。`);
    }
    if (A.kind === 'np' && n.some(v => v !== n[0])) return err('検査数が群ごとに違うので np 管理図は使えません。p 管理図を選んでください。');
    const c = S.attrChart(A.kind, d, A.kind === 'c' ? null : n);
    if (!c) return err(A.kind === 'p' && d.every((v, i) => v === n[i]) ? 'すべて不良なので管理図を描けません。' : `${K.d}がすべて 0 なので管理図を描けません（中心線が 0 になり、管理限界が決まりません）。`);
    // 二項分布・ポアソン分布の正規近似の目安
    if (A.kind === 'p' || A.kind === 'np') {
      const pb = A.kind === 'p' ? c.center : c.pbar, mn = Math.min(...n);
      if (mn * pb < 5) log.push(['warn', `検査数 × 平均の不良率（最小 ${sig(mn * pb, 3)}）が 5 未満です。不良数の分布が左右非対称になるので、正規近似の管理限界と異常判定ルールは目安として見てください。`]);
    } else if (A.kind === 'c' ? c.center < 5 : Math.min(...n) * c.center < 5) {
      log.push(['warn', `欠点数の平均が 5 未満です。欠点数の分布が左右非対称になるので、正規近似の管理限界と異常判定ルールは目安として見てください。`]);
    }
    if (c.lcl.some(v => v === 0)) log.push(['info', `下側管理限界が 0 になる群があります。その群では、${A.kind === 'c' || A.kind === 'u' ? '欠点' : '不良'}の減少（改善）を管理限界外として検出できません。`]);
    const hits = A.rules ? S.runRules(c) : S.runRules(c, [1]);
    st.attrResult = { kind: A.kind, c, d, n, names: d.map((_, i) => name(i)), hits, rules: A.rules, dLabel: A.d, nLabel: A.kind === 'c' ? '' : (A.n || `一定 ${num(n[0])}`), log };
    renderAttr();
  });
  function renderAttr() {
    const R = st.attrResult, c = R.c, K = ATTR[R.kind];
    $('#attrResult').hidden = false;
    const out = c.points.filter((v, i) => v > c.ucl[i] + 1e-12 || v < c.lcl[i] - 1e-12).length;
    const kv = [['管理図', K.name], ['群の数', c.points.length]];
    if (R.kind !== 'c') kv.push([`${K.n}の合計`, num(c.sumN)]);
    kv.push([`${K.d}の合計`, num(c.sumD)], ['中心線 CL', attrFmt(R.kind, c.center)], ['UCL', range(R.kind, c.ucl)], ['LCL', range(R.kind, c.lcl)], ['管理限界外の群', out]);
    if (R.kind === 'np') kv.push(['平均の不良率', `${sig(c.pbar * 100, 4)} %`]);
    $('#attrKv').innerHTML = kv.map(([k, v]) => `<div><dt>${k}</dt><dd class="num">${v}</dd></div>`).join('');
    const nm = i => R.names[i] && R.names[i] !== `群 ${i + 1}` ? `${i + 1}（${R.names[i]}）` : String(i + 1);
    $('#attrHits').innerHTML = R.hits.map(h => `<li>! ${esc(`ルール${h.rule}：${h.text}　群 ${h.from === h.to ? nm(h.from) : `${nm(h.from)}〜${nm(h.to)}`}`)}</li>`).join('');
    const log = R.log.slice();
    if (!R.hits.length) log.push(['info', R.rules ? '異常判定ルールに当てはまる点はありません。' : '管理限界の外に出た点はありません。']);
    if (R.kind === 'p' || R.kind === 'u') log.push(['info', `管理限界は群ごとの${K.n}で変わります（${K.n}が少ない群ほど広い）。`]);
    $('#attrLog').innerHTML = log.map(([k, s]) => `<li class="${k}">${esc(s)}</li>`).join('');
    const g = $('#attrCharts'); g.innerHTML = '';
    charts.splice(0, charts.length, ...charts.filter(x => x.div.isConnected));
    addChart(g, `${R.kind}_chart`, () => {
      const scale = R.kind === 'p' ? 100 : 1;
      const cs = { ...c, points: c.points.map(v => v * scale), cl: c.cl.map(v => v * scale), ucl: c.ucl.map(v => v * scale), lcl: c.lcl.map(v => v * scale) };
      return ctrlChart(K.name, '群の番号', R.kind === 'p' ? '不良率 [%]' : K.y, cs, R.hits, `群ごとの${K.n}`);
    });
    $('#attrResult').scrollIntoView({ behavior: 'smooth' });
  }
  $('#printAttr').addEventListener('click', () => window.print());
  $('#dlAttr').addEventListener('click', () => {
    const R = st.attrResult; if (!R) return;
    const K = ATTR[R.kind], c = R.c;
    const judge = i => {
      const r = R.hits.filter(h => h.ends.includes(i)).map(h => `ルール${h.rule}`);
      return r.join('・');
    };
    const head = ['群の番号', '群の名前', K.d, ...(R.kind === 'c' ? [] : [K.n]), K.y, '中心線', 'UCL', 'LCL', '異常判定'];
    const rows = c.points.map((v, i) => [i + 1, R.names[i] ?? '', R.d[i], ...(R.kind === 'c' ? [] : [R.n[i]]), v, c.cl[i], c.ucl[i], c.lcl[i], judge(i)]);
    const cond = [['項目', '値'], ['管理図', K.name], [`${K.d}の列`, R.dLabel], ...(R.kind === 'c' ? [] : [[K.n, R.nLabel]]), ['異常判定ルール', R.rules ? 'JIS Z 9020-2 の 8 ルール' : '管理限界外のみ']];
    download(X.writeXlsx([{ name: '管理図', rows: [head, ...rows] }, { name: '条件', rows: cond }]), `${stamp()}_${R.kind}_chart.xlsx`, XLSX_TYPE);
  });

  // ---------- 不良率の比較 ----------
  st.prop = [{ name: '', n: '', x: '' }, { name: '', n: '', x: '' }];
  function renderPropRows() {
    $('#propBody').innerHTML = st.prop.map((r, i) =>
      `<tr><td class="l"><input type="text" data-i="${i}" data-k="name" value="${esc(r.name)}" placeholder="群 ${i + 1}" aria-label="群 ${i + 1} の名前"></td>` +
      `<td><input class="num" type="text" inputmode="numeric" data-i="${i}" data-k="n" value="${esc(r.n)}" aria-label="群 ${i + 1} の検査数"></td>` +
      `<td><input class="num" type="text" inputmode="numeric" data-i="${i}" data-k="x" value="${esc(r.x)}" aria-label="群 ${i + 1} の不良数"></td>` +
      `<td>${st.prop.length > 2 ? `<button class="btn small" type="button" data-del="${i}" aria-label="群 ${i + 1} を削除">削除</button>` : ''}</td></tr>`).join('');
  }
  renderPropRows();
  $('#propBody').addEventListener('input', e => { const t = e.target; if (t.dataset.i == null) return; st.prop[+t.dataset.i][t.dataset.k] = t.value; t.classList.remove('bad'); });
  $('#propBody').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (!b) return; st.prop.splice(+b.dataset.del, 1); renderPropRows(); });
  // Excel の範囲（名前・検査数・不良数）の貼り付け
  $('#propBody').addEventListener('paste', e => {
    const t = e.target; if (t.dataset.i == null) return;
    const txt = (e.clipboardData || window.clipboardData).getData('text');
    if (!/[\t\n]/.test(txt.trim())) return;
    e.preventDefault(); e.stopPropagation();
    const lines = txt.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '').map(l => l.split('\t'));
    const keys = ['name', 'n', 'x'], c0 = keys.indexOf(t.dataset.k);
    let r0 = +t.dataset.i;
    // 1 行目が見出し（数値の欄が数値でない）なら飛ばす
    if (lines.length > 1 && c0 === 0 && lines[0].length >= 2 && toNum(lines[0][1]) == null) lines.shift();
    lines.forEach((cells, j) => {
      const r = r0 + j;
      while (st.prop.length <= r) st.prop.push({ name: '', n: '', x: '' });
      cells.forEach((v, k) => { if (c0 + k < 3) st.prop[r][keys[c0 + k]] = v.trim(); });
    });
    renderPropRows();
  }, true);
  $('#propAdd').addEventListener('click', () => { st.prop.push({ name: '', n: '', x: '' }); renderPropRows(); });
  $('#propExample').addEventListener('click', () => {
    st.prop = [{ name: '変更前', n: '300', x: '12' }, { name: '変更後', n: '310', x: '4' }];
    renderPropRows();
  });
  $('#runProp').addEventListener('click', () => {
    const alpha = +$('#propAlpha').value, log = [];
    const err = msg => { $('#propResult').hidden = false; $('#propTable').innerHTML = ''; $('#propCards').innerHTML = ''; $('#propCharts').innerHTML = ''; $('#propLog').innerHTML = `<li class="err">${esc(msg)}</li>`; st.propResult = null; };
    const groups = [];
    let bad = null;
    st.prop.forEach((r, i) => {
      if (String(r.n).trim() === '' && String(r.x).trim() === '') return;
      const n = toNum(r.n), x = toNum(r.x);
      const mark = k => { const el = $(`#propBody input[data-i="${i}"][data-k="${k}"]`); if (el) el.classList.add('bad'); };
      if (!(Number.isInteger(n) && n > 0)) { mark('n'); bad = bad || `群 ${i + 1} の検査数は 1 以上の整数で入れてください。`; return; }
      if (!(Number.isInteger(x) && x >= 0 && x <= n)) { mark('x'); bad = bad || `群 ${i + 1} の不良数は 0 以上・検査数以下の整数で入れてください。`; return; }
      groups.push({ name: String(r.name).trim() || `群 ${i + 1}`, n, x });
    });
    if (bad) return err(bad);
    if (groups.length < 2) return err('2 つ以上の群に検査数と不良数を入れてください。');
    groups.forEach(g => { g.p = g.x / g.n; g.ci = S.propCI(g.x, g.n, alpha); });
    const R = { groups, alpha, log };
    if (groups.length === 2) {
      const [a, b] = groups;
      R.two = S.twoProp(a.x, a.n, b.x, b.n, alpha);
      if (a.x + b.x === 0) return err('どちらの群も不良が 0 個なので比較できません。');
      if (a.x + b.x === a.n + b.n) return err('どちらの群もすべて不良なので比較できません。');
      // 判定に使う検定：期待度数が 5 以上なら z 検定、5 未満の欄があれば Fisher の正確検定
      R.useFisher = R.two.minExpected < 5;
      log.push(R.useFisher ? ['warn', `期待度数の最小が ${sig(R.two.minExpected, 3)} で 5 未満なので、正規近似の z 検定は使わず、Fisher の正確検定で判定しました。`]
        : ['info', `期待度数の最小は ${sig(R.two.minExpected, 3)} で 5 以上なので、z 検定で判定しました（Fisher の正確検定も参考に表示）。`]);
    } else {
      R.chi = S.propChi2(groups.map(g => g.x), groups.map(g => g.n));
      if (!R.chi) return err('すべての群で不良が 0 個（またはすべて不良）なので比較できません。');
      if (R.chi.smallCells) log.push(['warn', `期待度数が 5 未満の欄が ${R.chi.smallCells} / ${R.chi.cells} あります（最小 ${sig(R.chi.minExpected, 3)}）。χ² 検定の近似が悪くなるので、群をまとめるか、検査数を増やしてください。`]);
    }
    st.propResult = R;
    renderProp();
  });
  const pct = (v, d = 4) => v == null || !Number.isFinite(v) ? '―' : `${sig(v * 100, d)} %`;
  function renderProp() {
    const R = st.propResult, cl = Math.round((1 - R.alpha) * 100);
    $('#propResult').hidden = false;
    $('#propTable').innerHTML = `<table><thead><tr><th class="l">群</th><th>検査数</th><th>不良数</th><th>不良率</th><th>${cl}% 信頼区間（下限）</th><th>${cl}% 信頼区間（上限）</th></tr></thead><tbody>` +
      R.groups.map(g => `<tr><td class="l">${esc(g.name)}</td><td class="num">${g.n}</td><td class="num">${g.x}</td><td class="num">${pct(g.p)}</td><td class="num">${pct(g.ci[0])}</td><td class="num">${pct(g.ci[1])}</td></tr>`).join('') + '</tbody></table>';
    const card = (title, rows, verdict) => `<div class="res"><h3>${title}</h3>${verdict || ''}<dl class="kv">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd class="num">${v}</dd></div>`).join('')}</dl></div>`;
    const vd = (p, a, used = true) => used ? `<div class="verdict ${p < a ? 'sig' : 'nsig'}">${p < a ? '差がある' : '差があるとは言えない'}<span class="hint">（有意水準 ${a}）</span></div>` : '<div class="hint">参考（判定には使っていません）</div>';
    let h = '';
    if (R.two) {
      const T = R.two, [a, b] = R.groups;
      h += card('不良率の差', [[`差（${esc(a.name)} − ${esc(b.name)}）`, pct(T.diff)], [`${cl}% 信頼区間`, `${pct(T.diffCI[0])} 〜 ${pct(T.diffCI[1])}`], ['併合した不良率', pct(T.pooled)]]);
      h += card('z 検定（正規近似）', [['z 値', fmt(T.z, 4)], ['p 値（両側）', fmtP(T.pZ)]], vd(T.pZ, R.alpha, !R.useFisher));
      h += card('Fisher の正確検定', [['p 値（両側）', fmtP(T.pFisher)]], vd(T.pFisher, R.alpha, R.useFisher));
    } else {
      const T = R.chi;
      h += card(`χ² 検定（${R.groups.length} 群の一様性）`, [['χ² 値', fmt(T.chi2, 4)], ['自由度', T.df], ['p 値', fmtP(T.p)], ['全体の不良率', pct(T.pooled)]], vd(T.p, R.alpha));
    }
    $('#propCards').innerHTML = h;
    const log = R.log.slice();
    log.push(['info', `各群の信頼区間は Clopper-Pearson 法（正確法）${R.two ? '、差の信頼区間は Newcombe の方法（Wilson 区間の組み合わせ）' : ''}です。`]);
    if (!R.two) log.push(['info', '3 群以上の χ² 検定は「どこかの群に差がある」かを見るものです。どの群とどの群に差があるかは、2 群ずつ比べてください（何度も比べると、偶然の差を差と判定しやすくなる点に注意）。']);
    $('#propLog').innerHTML = log.map(([k, s]) => `<li class="${k}">${esc(s)}</li>`).join('');
    const g = $('#propCharts'); g.innerHTML = '';
    charts.splice(0, charts.length, ...charts.filter(x => x.div.isConnected));
    addChart(g, 'proportions', () => {
      const layers = R.groups.map((q, i) => ({ type: 'line', data: [[i + 1, q.ci[0] * 100], [i + 1, q.ci[1] * 100]], color: 'var(--s1)', width: 3 }));
      layers.push({ type: 'points', data: R.groups.map((q, i) => [i + 1, q.p * 100]), color: 'var(--ng)', r: 4.5, label: '不良率' });
      const pooled = R.two ? R.two.pooled : R.chi.pooled;
      layers.push({ type: 'hline', y: pooled * 100, color: 'var(--muted)', dash: '5 4', text: `全体 ${pct(pooled, 3)}` });
      layers.push({ type: 'line', data: [], color: 'var(--s1)', width: 3, label: `${cl}% 信頼区間` });
      const k = R.groups.length;
      const xl = R.groups.map((q, i) => `${i + 1}: ${q.name}`).join('　');
      return C.plot({ title: '群ごとの不良率', xLabel: xl.length <= 60 ? xl : '群の番号（名前は上の表のとおり）', yLabel: '不良率 [%]', yZero: true, x: [0.5, k + 0.5], xTicks: R.groups.map((q, i) => i + 1), layers });
    });
    $('#propResult').scrollIntoView({ behavior: 'smooth' });
  }
  $('#printProp').addEventListener('click', () => window.print());
  $('#dlProp').addEventListener('click', () => {
    const R = st.propResult; if (!R) return;
    const cl = Math.round((1 - R.alpha) * 100);
    const g = [['群', '検査数', '不良数', '不良率', `${cl}%信頼区間 下限`, `${cl}%信頼区間 上限`], ...R.groups.map(q => [q.name, q.n, q.x, q.p, q.ci[0], q.ci[1]])];
    const t = [['項目', '値']];
    if (R.two) {
      const T = R.two;
      t.push(['不良率の差', T.diff], [`差の${cl}%信頼区間 下限`, T.diffCI[0]], [`差の${cl}%信頼区間 上限`, T.diffCI[1]], ['z値', T.z], ['P値 (z検定)', T.pZ], ['P値 (Fisherの正確検定)', T.pFisher],
        ['判定に使った検定', R.useFisher ? 'Fisherの正確検定' : 'z検定'], ['判定', (R.useFisher ? T.pFisher : T.pZ) < R.alpha ? '差がある' : '差があるとは言えない']);
    } else {
      const T = R.chi;
      t.push(['χ²値', T.chi2], ['自由度', T.df], ['P値 (χ²検定)', T.p], ['判定', T.p < R.alpha ? '差がある' : '差があるとは言えない']);
    }
    t.push(['有意水準', R.alpha]);
    download(X.writeXlsx([{ name: '群ごと', rows: g }, { name: '検定', rows: t }]), `${stamp()}_proportion_test.xlsx`, XLSX_TYPE);
  });

  // ---------- ④ 印刷・PDF ----------
  // 印刷は常にライト表示にする（グラフの色も描き直す）
  let themeBeforePrint = null;
  window.addEventListener('beforeprint', () => {
    themeBeforePrint = document.documentElement.getAttribute('data-theme');
    document.documentElement.dataset.theme = 'light'; redrawCharts();
  });
  window.addEventListener('afterprint', () => {
    if (themeBeforePrint == null) document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = themeBeforePrint;
    redrawCharts();
  });
  $('#printCap').addEventListener('click', () => window.print());
  $('#printTest').addEventListener('click', () => window.print());

  // ---------- 画面で入力（直接入力・自動保存） ----------
  const GRID_KEY = 'cpk-calc-grid-v1', SRC_KEY = 'cpk-calc-src';
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };
  st.src = 'file';
  let fileState = null; // 「ファイル・貼り付け」に戻したときに元の状態に戻すため
  const knownCols = new Set(); // 自動で解析対象に入れた項目（外した項目を勝手に戻さない）
  const grid = G.create($('#gridWrap'), {
    onChange: () => { gridChangedSoon(); },
    onRename: (oldName, newName) => {
      // 項目名を変えても、規格値と解析対象を引き継ぐ
      if (!oldName || oldName === newName) return;
      if (st.spec[oldName] && !st.spec[newName]) { st.spec[newName] = st.spec[oldName]; delete st.spec[oldName]; }
      st.targets = st.targets.map(t => t === oldName ? newName : t);
      if (st.groupBy === oldName) st.groupBy = newName;
      if (knownCols.has(oldName)) { knownCols.delete(oldName); knownCols.add(newName); }
    },
  });
  function gridToWb() {
    st.wb = { sheets: [{ name: '直接入力', cells: grid.toCells() }] };
    st.fileName = '画面で入力したデータ'; st.sheet = 0;
    st.firstRowData = false; st.firstColData = true; st.dir = '列方向';
  }
  // 数値が 2 個以上入った新しい項目は、自動で解析対象に入れる
  function autoTargets() {
    grid.model.cols.forEach((col, c) => {
      const name = String(col.name).trim(); if (!name || col.type !== 'num' || knownCols.has(name)) return;
      const n = grid.model.rows.filter(r => G.toNum(r[c]) != null).length;
      if (n >= 2) { knownCols.add(name); if (!st.targets.includes(name)) st.targets.push(name); }
    });
  }
  let gridTimer = null, saveTimer = null, liveTimer = null;
  function gridChangedSoon() {
    clearTimeout(gridTimer);
    gridTimer = setTimeout(() => { if (st.src !== 'grid') return; gridToWb(); autoTargets(); rebuild(); saveGridSoon(); liveSoon(); }, 250);
  }
  function saveGridSoon() {
    if (st.src !== 'grid') return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const labels = grid.model.cols.map(c => String(c.name).trim());
      const spec = {}; for (const l of labels) if (st.spec[l]) spec[l] = st.spec[l];
      const ok = store.set(GRID_KEY, { model: grid.model, spec, targets: st.targets, known: [...knownCols], sameSpec: st.sameSpec, savedAt: new Date().toISOString() });
      $('#gSaved').textContent = ok ? `自動保存しました（${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}）` : 'このブラウザでは保存できません（プライベートモードなど）';
    }, 400);
  }
  // 入力に合わせて結果を更新（一度「解析する」を押したあと）
  function liveSoon() {
    if (st.src !== 'grid' || !$('#liveUpdate').checked || !st.capResult) return;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => runCap({ quiet: true }), 600);
  }
  function setSource(src, { silent = false } = {}) {
    if (src === st.src) return;
    if (src === 'grid') {
      fileState = { wb: st.wb, fileName: st.fileName, sheet: st.sheet, firstRowData: st.firstRowData, firstColData: st.firstColData, dir: st.dir, targets: st.targets };
      st.src = 'grid';
      const saved = store.get(GRID_KEY);
      if (saved && saved.model && !grid.hasData()) {
        grid.set(saved.model);
        Object.assign(st.spec, saved.spec || {});
        st.targets = saved.targets || [];
        (saved.known || []).forEach(k => knownCols.add(k));
        st.sameSpec = !!saved.sameSpec; $('#sameSpec').checked = st.sameSpec;
        if (!silent && grid.hasData()) toast('前回入力したデータを読み込みました');
      } else { grid.render(); st.targets = []; }
      gridToWb(); autoTargets();
    } else {
      st.src = 'file';
      if (fileState) Object.assign(st, fileState); else { st.wb = null; st.targets = []; }
      $('#firstRowData').checked = st.firstRowData; $('#firstColData').checked = st.firstColData; segSet('#dirSeg', st.dir);
    }
    segSet('#srcSeg', src);
    $('#srcFile').hidden = src !== 'file'; $('#srcGrid').hidden = src !== 'grid';
    store.set(SRC_KEY, src);
    st.capResult = null; $('#capResult').hidden = true;
    if (st.wb) rebuild(); else { $('#capSetup').hidden = $('#capOpts').hidden = $('#testSetup').hidden = true; }
  }
  segInit('#srcSeg', v => setSource(v));
  $('#gAddCol').addEventListener('click', () => grid.addCol());
  $('#gAddRows').addEventListener('click', () => grid.addRows(10));
  $('#gClear').addEventListener('click', () => {
    if (grid.hasData() && !confirm('入力した値と項目名をすべて消去します。よろしいですか？（元に戻せません）')) return;
    grid.model.cols.forEach(c => { delete st.spec[String(c.name).trim()]; });
    st.targets = []; knownCols.clear(); st.capResult = null; $('#capResult').hidden = true;
    grid.clear();
  });
  $('#gSave').addEventListener('click', () => {
    if (!grid.hasData()) { toast('保存するデータがありません'); return; }
    download(X.writeXlsx([{ name: '測定値', rows: grid.toRows() }]), `${stamp()}_測定値.xlsx`, XLSX_TYPE);
  });

  // ---------- 必要なデータ数の目安（計画用） ----------
  function renderPlanner() {
    const c = parseFloat($('#pnC').value), t = parseFloat($('#pnT').value), a = parseFloat($('#pnA').value);
    const out = $('#pnOut');
    if (!(c > 0) || !(t > 0)) { out.innerHTML = '<span class="hint">見込みの Ppk と示したい値を入れてください</span>'; return; }
    const n = S.requiredN(c, t, a);
    let h = n == null
      ? `<div><span class="big">届きません</span>　見込みの Ppk（${c}）が示したい値（${t}）以下のため、データを増やしても下限は ${t} 以上になりません。</div>`
      : `<div>必要なデータ数：<span class="big">${n.toLocaleString('ja-JP')}</span> 個　<span class="hint">（Ppk が ${c} のとき、${Math.round((1 - a) * 100)}% 信頼区間の下限が ${t} 以上になる最小の数）</span></div>`;
    // 見込みの Ppk ごとの早見表
    let cs = [1.4, 1.5, 1.67, 1.8, 2.0, 2.33, 2.5, 3.0].filter(v => v > t + 1e-9).slice(0, 6);
    if (cs.length < 3) cs = [1.1, 1.2, 1.33, 1.5].map(k => +(t * k).toFixed(2));
    h += '<table><thead><tr><th class="l">見込みの Ppk</th>' + cs.map(v => `<th>${v.toFixed(2)}</th>`).join('') + '</tr></thead><tbody><tr><td class="l">必要なデータ数</td>' +
      cs.map(v => `<td class="num">${(S.requiredN(v, t, a) ?? '―').toLocaleString('ja-JP')}</td>`).join('') + '</tr></tbody></table>';
    out.innerHTML = h;
  }
  ['#pnC', '#pnT', '#pnA'].forEach(id => $(id).addEventListener('input', renderPlanner));
  renderPlanner();

  // ---------- 起動 ----------
  applyTheme(theme);
  if (store.get(SRC_KEY) === 'grid') setSource('grid', { silent: false });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
