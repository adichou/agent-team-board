'use strict';
// REQ-20260916-006 挂起确认面板「查看差异」语义渲染层。
// 数据仍来自 GET /api/confirms/<id>/diff（只读 git diff HEAD 原文），本文件只做展示层：
//   · 解析 unified diff（文件头元信息 / hunk 头 / 上下文 / 新增 / 删除 / 无末尾换行注记）
//     与未跟踪新文件格式（「（新文件，未纳入版本控制）」+ 分隔行 + 全文），行号与 git 原文一致；
//   · 长段未变更上下文默认折叠（连续 ≥ MIN_FOLD 收中段，头尾各留 KEEP 行），改动行始终可见；
//   · 统一 / 并排两种视图，切换保持展开状态与滚动位置；成对删除/新增行做字符级高亮。
// 行内容置于 CODE（i18n 翻译层跳过用户数据），界面文案（统一 / 并排 / 展开折叠行 /
// 新文件标注）以中文为键、由 i18n.js 词典翻译。app.js 只在成功路径调用 mount，
// 渲染层缺失时回退纯文本 <pre>（优雅降级，加载/失败/重试语义保持在 app.js）。

(function () {
  const KEEP = 3; // 折叠段头尾各保留的上下文行数
  const MIN_FOLD = 8; // 连续上下文达到该长度才折叠
  const NEW_FILE_NOTICE = '（新文件，未纳入版本控制）';
  const EMPTY_DIFF_TEXT = '（与 HEAD 一致：无差异——可能已补交入库）';

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- 解析 ----------

  // unified diff / 新文件全文 → 行模型。行号按 git 原文推进：上下文旷新各 +1、删除旧行 +1、
  // 新增新行 +1；hunk 头计数缺省（@@ -1 +1 @@）按 1 处理；\ No newline 注记不消费行号。
  function parseDiff(text) {
    const src = String(text ?? '');
    if (!src.trim()) return { kind: 'empty', rows: [] };
    const all = src.split('\n');
    if (all[0] === NEW_FILE_NOTICE && /^={10,}$/.test(all[1] || '')) {
      const rows = [];
      let n = 0;
      for (let i = 2; i < all.length; i++) {
        if (i === all.length - 1 && all[i] === '') continue; // 末尾换行产物
        rows.push({ type: 'add', text: all[i], oldLine: null, newLine: ++n });
      }
      return { kind: 'newfile', notice: NEW_FILE_NOTICE, rows };
    }
    const rows = [];
    let inHunk = false;
    let oldNo = 0;
    let newNo = 0;
    for (let i = 0; i < all.length; i++) {
      const raw = all[i];
      if (i === all.length - 1 && raw === '') break; // 末尾换行产物
      if (/^diff --git /.test(raw)) {
        rows.push({ type: 'meta', text: raw, oldLine: null, newLine: null });
        inHunk = false; // 同一 diff 文本可能含多个文件节（目录路径）：行号计数随节重置
        continue;
      }
      const hm = raw.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (hm) {
        oldNo = Number(hm[1]);
        newNo = Number(hm[3]);
        rows.push({ type: 'hunk', text: raw, oldLine: null, newLine: null });
        inHunk = true;
        continue;
      }
      if (!inHunk) {
        rows.push({ type: 'meta', text: raw, oldLine: null, newLine: null });
        continue;
      }
      const mark = raw[0];
      if (mark === '+') rows.push({ type: 'add', text: raw.slice(1), oldLine: null, newLine: newNo++ });
      else if (mark === '-') rows.push({ type: 'del', text: raw.slice(1), oldLine: oldNo++, newLine: null });
      else if (mark === '\\') rows.push({ type: 'note', text: raw, oldLine: null, newLine: null });
      else rows.push({ type: 'ctx', text: raw.slice(1), oldLine: oldNo++, newLine: newNo++ });
    }
    return { kind: 'diff', rows };
  }

  // ---------- 折叠 ----------

  // 连续上下文 ≥ MIN_FOLD 的段落收中段（start..end 不含），头尾各留 KEEP 行。
  // 段 id 按发现次序编号（f0、f1…），统一 / 并排两视图按原文行序产出同一 id，切换不丢状态。
  function foldSegments(rows) {
    const segs = [];
    let i = 0;
    while (i < rows.length) {
      if (rows[i].type !== 'ctx') { i++; continue; }
      let j = i;
      while (j < rows.length && rows[j].type === 'ctx') j++;
      if (j - i >= MIN_FOLD) {
        segs.push({ id: `f${segs.length}`, start: i + KEEP, end: j - KEEP, count: j - KEEP - (i + KEEP) });
      }
      i = j;
    }
    return segs;
  }

  function coverMap(segs) {
    const cover = new Map();
    for (const s of segs) {
      for (let i = s.start; i < s.end; i++) cover.set(i, s);
    }
    return cover;
  }

  // ---------- 配对与字符级高亮 ----------

  // 紧邻的删除段 + 新增段按位置配对（Map：行下标 → 配对行下标，双向），供统一视图成对高亮。
  function pairRuns(rows) {
    const pair = new Map();
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].type !== 'del') continue;
      let j = i;
      while (j < rows.length && rows[j].type === 'del') j++;
      let k = j;
      while (k < rows.length && rows[k].type === 'add') k++;
      const n = Math.min(j - i, k - j);
      for (let x = 0; x < n; x++) {
        pair.set(i + x, j + x);
        pair.set(j + x, i + x);
      }
      i = k - 1;
    }
    return pair;
  }

  // 成对行的公共前后缀外的中段即字符级变化；无中段（纯增删 / 一致 / 一侧为空）或中段过长
  //（整行重写，高亮无意义）时不配对，保持整行着色。
  function highlightPair(a, b) {
    if (!a || !b || a === b) return null;
    let pre = 0;
    const minLen = Math.min(a.length, b.length);
    while (pre < minLen && a[pre] === b[pre]) pre++;
    let post = 0;
    while (post < minLen - pre && a[a.length - 1 - post] === b[b.length - 1 - post]) post++;
    const oldMid = a.slice(pre, a.length - post);
    const newMid = b.slice(pre, b.length - post);
    if (!oldMid || !newMid || oldMid.length > 500 || newMid.length > 500) return null;
    return { pre: a.slice(0, pre), oldMid, newMid, post: a.slice(a.length - post) };
  }

  function hlCode(hl, side) {
    const mid = side === 'old' ? hl.oldMid : hl.newMid;
    return `${esc(hl.pre)}<span class="dv-ch">${esc(mid)}</span>${esc(hl.post)}`;
  }

  // ---------- 渲染 ----------

  function emptyHtml() {
    return `<p class="muted small">${EMPTY_DIFF_TEXT}</p>`;
  }

  function spanRow(viewCls, type, text) {
    return `<div class="dv-row ${viewCls} dv-${type}"><code class="dv-code">${esc(text)}</code></div>`;
  }

  function foldRowHtml(viewCls, s) {
    return `<div class="dv-row ${viewCls} dv-fold"><button type="button" class="dv-unfold" data-dv-unfold="${s.id}">⋯ 展开 ${s.count} 行未变更上下文 ⋯</button></div>`;
  }

  function unifiedRowHtml(rows, i, pair) {
    const r = rows[i];
    if (r.type === 'meta' || r.type === 'hunk' || r.type === 'note') return spanRow('dv-u-row', r.type, r.text);
    const sign = r.type === 'add' ? '+' : r.type === 'del' ? '-' : ' ';
    const signCls = r.type === 'add' ? ' dv-s-add' : r.type === 'del' ? ' dv-s-del' : '';
    let code = esc(r.text);
    const p = pair.get(i);
    if (p != null) {
      // 配对方向按行类型对齐（删除行 = 旧侧，新增行 = 新侧），两行算同一对 (del, add)
      const delRow = r.type === 'del' ? r : rows[p];
      const addRow = r.type === 'add' ? r : rows[p];
      const hl = highlightPair(delRow.text, addRow.text);
      if (hl) code = hlCode(hl, r.type === 'del' ? 'old' : 'new');
    }
    return `<div class="dv-row dv-u-row dv-${r.type}"><span class="dv-no">${r.oldLine ?? ''}</span><span class="dv-no">${r.newLine ?? ''}</span><span class="dv-sign${signCls}">${sign}</span><code class="dv-code">${code}</code></div>`;
  }

  function renderUnified(model, expanded) {
    if (model.kind === 'empty') return emptyHtml();
    const rows = model.rows;
    const cover = coverMap(foldSegments(rows));
    const pair = pairRuns(rows);
    const out = [];
    if (model.kind === 'newfile') out.push(`<div class="dv-row dv-u-row dv-notice">${model.notice}</div>`);
    for (let i = 0; i < rows.length; i++) {
      const s = cover.get(i);
      if (s && !(expanded && expanded.has(s.id))) {
        if (i === s.start) out.push(foldRowHtml('dv-u-row', s));
        continue;
      }
      out.push(unifiedRowHtml(rows, i, pair));
    }
    return out.join('');
  }

  // 并排行：左删右增；成对行左右对齐同一行（dv-mod），未配对行单侧呈现（空侧占位保持分栏对齐）。
  function splitPairRow(dl, al) {
    const kind = dl && al ? 'dv-mod' : dl ? 'dv-del' : 'dv-add';
    let left = '';
    let right = '';
    if (dl && al) {
      const hl = highlightPair(dl.text, al.text);
      left = hl ? hlCode(hl, 'old') : esc(dl.text);
      right = hl ? hlCode(hl, 'new') : esc(al.text);
    } else if (dl) {
      left = esc(dl.text);
    } else {
      right = esc(al.text);
    }
    return `<div class="dv-row dv-s-row ${kind}">`
      + `<span class="dv-no">${dl ? dl.oldLine ?? '' : ''}</span>`
      + (dl ? `<code class="dv-old">${left}</code>` : '<span class="dv-cell-empty"></span>')
      + '<span class="dv-gap"></span>'
      + `<span class="dv-no">${al ? al.newLine ?? '' : ''}</span>`
      + (al ? `<code class="dv-new">${right}</code>` : '<span class="dv-cell-empty"></span>')
      + '</div>';
  }

  function renderSplit(model, expanded) {
    if (model.kind === 'empty') return emptyHtml();
    const rows = model.rows;
    const cover = coverMap(foldSegments(rows));
    const out = [];
    if (model.kind === 'newfile') out.push(`<div class="dv-row dv-s-row dv-notice">${model.notice}</div>`);
    let i = 0;
    while (i < rows.length) {
      const s = cover.get(i);
      if (s && !(expanded && expanded.has(s.id))) {
        if (i === s.start) out.push(foldRowHtml('dv-s-row', s));
        i++;
        continue;
      }
      const r = rows[i];
      if (r.type === 'meta' || r.type === 'hunk' || r.type === 'note') {
        out.push(spanRow('dv-s-row', r.type, r.text));
        i++;
        continue;
      }
      if (r.type === 'ctx') {
        out.push(`<div class="dv-row dv-s-row dv-ctx"><span class="dv-no">${r.oldLine ?? ''}</span><code class="dv-old">${esc(r.text)}</code><span class="dv-gap"></span><span class="dv-no">${r.newLine ?? ''}</span><code class="dv-new">${esc(r.text)}</code></div>`);
        i++;
        continue;
      }
      if (r.type === 'del') {
        let j = i;
        while (j < rows.length && rows[j].type === 'del') j++;
        let k = j;
        while (k < rows.length && rows[k].type === 'add') k++;
        const nDel = j - i;
        const nAdd = k - j;
        for (let x = 0; x < Math.max(nDel, nAdd); x++) {
          out.push(splitPairRow(x < nDel ? rows[i + x] : null, x < nAdd ? rows[j + x] : null));
        }
        i = k;
        continue;
      }
      out.push(splitPairRow(null, r)); // 前无删除段的纯新增
      i++;
    }
    return out.join('');
  }

  // ---------- 挂载（app.js 成功路径调用） ----------

  const states = new WeakMap(); // 面板容器 → { view, expanded, path, model }

  function renderBox(box, st) {
    // 切换视图 / 展开时保留滚动位置（先取当前主体 scrollTop，重渲染后回填）
    const prev = box.querySelector?.('.dv-body');
    const top = prev && typeof prev.scrollTop === 'number' ? prev.scrollTop : 0;
    const body = st.view === 'split' ? renderSplit(st.model, st.expanded) : renderUnified(st.model, st.expanded);
    box.innerHTML = `<div class="dv-head"><span class="dv-title">${esc(st.path ?? '')}（工作区 vs Git 基线）</span><span class="dv-seg" role="group" aria-label="视图切换"><button type="button" data-dv-view="unified" aria-pressed="${st.view !== 'split'}">统一</button><button type="button" data-dv-view="split" aria-pressed="${st.view === 'split'}">并排</button></span></div><div class="dv-body">${body}</div>`;
    const nb = box.querySelector?.('.dv-body');
    if (nb && top) {
      try { nb.scrollTop = top; } catch { /* 假 DOM / 部分环境无 scrollTop */ }
    }
  }

  function mount(box, opts) {
    if (!box || typeof box.addEventListener !== 'function') return;
    const st = states.get(box) || { view: 'unified', expanded: new Set() };
    const src = String((opts && opts.diff) != null ? opts.diff : '');
    const nextPath = opts ? opts.path : '';
    // 换文件（路径或内容变化）时折叠状态重置，不串用上个文件的展开段；视图偏好保留
    if (st.src !== src || st.path !== nextPath) {
      st.src = src;
      st.expanded = new Set();
    }
    st.path = nextPath;
    st.model = parseDiff(src);
    states.set(box, st);
    if (!st.bound) {
      // 事件委托：视图切换 / 折叠段就地展开（不重置其余折叠与滚动）
      box.addEventListener('click', (e) => {
        const el = e && e.target && typeof e.target.closest === 'function'
          ? e.target.closest('[data-dv-view],[data-dv-unfold]') : null;
        if (!el || !el.dataset) return;
        if (el.dataset.dvView) {
          st.view = el.dataset.dvView === 'split' ? 'split' : 'unified';
          renderBox(box, st);
          return;
        }
        if (el.dataset.dvUnfold) {
          st.expanded.add(el.dataset.dvUnfold);
          renderBox(box, st);
        }
      });
      st.bound = true;
    }
    renderBox(box, st);
  }

  const ATBDiffView = {
    KEEP,
    MIN_FOLD,
    parseDiff,
    foldSegments,
    pairRuns,
    highlightPair,
    renderUnified,
    renderSplit,
    mount,
    esc,
  };

  if (typeof window !== 'undefined') window.ATBDiffView = ATBDiffView;
  globalThis.ATBDiffView = ATBDiffView; // Node 测试（vm / import）直接取用
})();
