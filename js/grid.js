// 測定値を画面で入力する表
//   model = { cols: [{ name, type: 'num' | 'text' }], rows: [[文字列, ...], ...] }
//   Enter で下へ（最後の行なら行を増やす）、Shift+Enter で上へ、矢印キーで移動、複数セルの貼り付けに対応
(function (root) {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  // 全角数字・記号を半角にして数値に変換（数値でなければ null）
  function toNum(v) {
    if (v == null) return null;
    const s = String(v).replace(/[０-９．－＋]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[−ー]/g, '-').replace(/,/g, '').trim();
    return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? Number(s) : null;
  }
  const MIN_ROWS = 10;

  function emptyModel() { return { cols: [{ name: '項目1', type: 'num' }], rows: Array.from({ length: 20 }, () => ['']) }; }

  // opts: { onChange(model, info), onRename(oldName, newName) }
  function create(container, opts) {
    let model = emptyModel();

    function fixShape() {
      if (!model.cols.length) model.cols.push({ name: '項目1', type: 'num' });
      for (const r of model.rows) { while (r.length < model.cols.length) r.push(''); r.length = model.cols.length; }
      while (model.rows.length < MIN_ROWS) model.rows.push(model.cols.map(() => ''));
    }
    function colStat(c) {
      if (model.cols[c].type === 'text') { const n = model.rows.filter(r => String(r[c]).trim()).length; return n ? `${n} 件` : ''; }
      const v = model.rows.map(r => toNum(r[c])).filter(x => x != null);
      if (!v.length) return '';
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return `n=${v.length}　平均 ${+m.toPrecision(6)}`;
    }
    const isBad = (c, v) => model.cols[c].type === 'num' && String(v).trim() !== '' && toNum(v) == null;

    function render(focus) {
      fixShape();
      const C = model.cols;
      let h = '<table class="grid"><thead><tr><th class="rn">#</th>' + C.map((col, c) =>
        `<th><div class="gh"><input type="text" data-name="${c}" value="${esc(col.name)}" aria-label="項目名 ${c + 1}">` +
        `<div class="gsub"><select data-type="${c}" aria-label="列の種類"><option value="num"${col.type === 'num' ? ' selected' : ''}>数値</option><option value="text"${col.type === 'text' ? ' selected' : ''}>文字</option></select>` +
        `<button type="button" class="gdel" data-del="${c}" title="この列を削除" aria-label="この列を削除">✕</button></div>` +
        `<span class="gstat" data-stat="${c}">${esc(colStat(c))}</span></div></th>`).join('') + '</tr></thead><tbody>';
      model.rows.forEach((row, r) => {
        h += `<tr><td class="rn">${r + 1}</td>` + row.map((v, c) => {
          const txt = C[c].type === 'text';
          return `<td><input type="text" data-r="${r}" data-c="${c}" value="${esc(v)}" inputmode="${txt ? 'text' : 'decimal'}" autocomplete="off" class="${txt ? 'txt' : ''}${isBad(c, v) ? ' bad' : ''}" aria-label="${esc(C[c].name)} ${r + 1}行目"></td>`;
        }).join('') + '</tr>';
      });
      container.innerHTML = h + '</tbody></table>';
      if (focus) focusCell(focus[0], focus[1]);
    }
    function cell(r, c) { return container.querySelector(`input[data-r="${r}"][data-c="${c}"]`); }
    function focusCell(r, c) {
      const el = cell(r, c); if (!el) return;
      el.focus(); el.select();
      // 固定見出しに隠れないようにスクロール
      const wrap = container, top = el.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
      if (top < 60) wrap.scrollTop -= 60 - top;
    }
    function addRows(n) {
      for (let i = 0; i < n; i++) model.rows.push(model.cols.map(() => ''));
    }
    function changed(info) { opts.onChange && opts.onChange(model, info || {}); }

    container.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.r != null) {
        const r = +t.dataset.r, c = +t.dataset.c;
        model.rows[r][c] = t.value;
        t.classList.toggle('bad', isBad(c, t.value));
        const st = container.querySelector(`[data-stat="${c}"]`); if (st) st.textContent = colStat(c);
        changed({ cell: [r, c] });
      } else if (t.dataset.name != null) {
        const c = +t.dataset.name, old = model.cols[c].name;
        model.cols[c].name = t.value;
        opts.onRename && opts.onRename(old, t.value);
        changed({ rename: c });
      }
    });
    container.addEventListener('change', e => {
      const t = e.target;
      // 数値の列は、入力を終えたときに全角数字などを半角にそろえる
      if (t.dataset.r != null) {
        const r = +t.dataset.r, c = +t.dataset.c, n = toNum(t.value);
        if (model.cols[c].type === 'num' && n != null && String(n) !== t.value.trim() && /[０-９．－＋−ー,]/.test(t.value)) { t.value = String(n); model.rows[r][c] = t.value; changed({ cell: [r, c] }); }
        return;
      }
      if (t.dataset.type != null) { model.cols[+t.dataset.type].type = t.value; render(); changed({ type: +t.dataset.type }); }
    });
    container.addEventListener('click', e => {
      const b = e.target.closest('[data-del]'); if (!b) return;
      const c = +b.dataset.del;
      const has = model.rows.some(r => String(r[c]).trim());
      if (has && !confirm(`「${model.cols[c].name}」の列を削除します。入力した値も消えます。よろしいですか？`)) return;
      model.cols.splice(c, 1); model.rows.forEach(r => r.splice(c, 1));
      render(); changed({ remove: c });
    });
    container.addEventListener('keydown', e => {
      const t = e.target; if (t.dataset.r == null || e.isComposing) return;
      const r = +t.dataset.r, c = +t.dataset.c;
      const go = (rr, cc) => { e.preventDefault(); if (rr < 0 || cc < 0 || cc >= model.cols.length) return; if (rr >= model.rows.length) { addRows(Math.max(5, rr - model.rows.length + 1)); render([rr, cc]); return; } focusCell(rr, cc); };
      if (e.key === 'Enter') go(e.shiftKey ? r - 1 : r + 1, c);
      else if (e.key === 'ArrowDown') go(r + 1, c);
      else if (e.key === 'ArrowUp') go(r - 1, c);
      else if (e.key === 'ArrowLeft' && t.selectionStart === 0 && t.selectionEnd === 0) go(r, c - 1);
      else if (e.key === 'ArrowRight' && t.selectionStart === t.value.length) go(r, c + 1);
    });
    // Excel などからの複数セルの貼り付け
    container.addEventListener('paste', e => {
      const t = e.target; if (t.dataset.r == null) return;
      const text = e.clipboardData && e.clipboardData.getData('text/plain');
      if (!text || !/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return; // 1 セル分は通常の貼り付け
      e.preventDefault();
      const lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map(l => l.split('\t'));
      let r0 = +t.dataset.r; const c0 = +t.dataset.c;
      const width = Math.max(...lines.map(l => l.length));
      // 1 行目に数値でない値があれば、項目名として使う
      const header = lines[0].some(v => v.trim() && toNum(v) == null) && lines.length > 1;
      const body = header ? lines.slice(1) : lines;
      while (model.cols.length < c0 + width) model.cols.push({ name: `項目${model.cols.length + 1}`, type: 'num' });
      fixShape();
      for (let j = 0; j < width; j++) {
        const c = c0 + j;
        if (header && lines[0][j] != null && lines[0][j].trim()) {
          const old = model.cols[c].name, nm = lines[0][j].trim();
          if (old !== nm) { model.cols[c].name = nm; opts.onRename && opts.onRename(old, nm); }
        }
        // 貼り付けた値に数値でないものが多い列は「文字」にする
        const vals = body.map(l => (l[j] ?? '').trim()).filter(Boolean);
        if (vals.length && vals.filter(v => toNum(v) == null).length > vals.length / 2) model.cols[c].type = 'text';
      }
      if (header && r0 > 0 && model.rows.slice(0, r0).every(row => row.every(v => !String(v).trim()))) r0 = 0;
      while (model.rows.length < r0 + body.length + 1) addRows(1);
      body.forEach((l, i) => l.forEach((v, j) => { model.rows[r0 + i][c0 + j] = v.trim(); }));
      render([Math.min(r0 + body.length, model.rows.length - 1), c0]);
      changed({ paste: true });
    });

    return {
      get model() { return model; },
      set(m) { model = m && m.cols && m.rows ? m : emptyModel(); render(); },
      render,
      addCol() {
        const used = new Set(model.cols.map(c => c.name)); let i = model.cols.length + 1;
        while (used.has(`項目${i}`)) i++;
        model.cols.push({ name: `項目${i}`, type: 'num' }); render(); changed({ add: true });
        const nm = container.querySelector(`input[data-name="${model.cols.length - 1}"]`); if (nm) { nm.focus(); nm.select(); }
      },
      addRows(n) { addRows(n); render(); },
      clear() { model = emptyModel(); render([0, 0]); changed({ clear: true }); },
      hasData() { return model.rows.some(r => r.some(v => String(v).trim())); },
      // ワークブックのセル [行, 列, 値] に変換（1 行目は項目名）
      toCells() {
        const cells = [];
        const names = new Set();
        model.cols.forEach((col, c) => {
          let nm = String(col.name).trim() || `項目${c + 1}`;
          while (names.has(nm)) nm += '′';
          names.add(nm); cells.push([0, c, nm]);
        });
        model.rows.forEach((row, r) => row.forEach((v, c) => {
          const s = String(v).trim(); if (!s) return;
          const n = model.cols[c].type === 'num' ? toNum(s) : null;
          cells.push([r + 1, c, n != null ? n : s]);
        }));
        return cells;
      },
      // Excel に保存する行（見出し＋値）
      toRows() {
        const last = model.rows.reduce((m, row, i) => row.some(v => String(v).trim()) ? i : m, -1);
        return [model.cols.map(c => c.name), ...model.rows.slice(0, last + 1).map(row => row.map((v, c) => {
          const s = String(v).trim(); if (!s) return null;
          const n = model.cols[c].type === 'num' ? toNum(s) : null; return n != null ? n : s;
        }))];
      },
    };
  }
  root.CpkGrid = { create, toNum, emptyModel };
})(typeof window !== 'undefined' ? window : globalThis);
