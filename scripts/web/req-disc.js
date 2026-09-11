'use strict';
// 需求文档引用讨论前端（REQ-20260909-003）—— 由 app.js 在需求抽屉挂载（#reqDocDisc）。
// 单人文档工作流：开始讨论（生成 DISC 编号 + 启动提示词，用户复制到 Agent 新会话持续讨论）→
// 阅读模式选中/点行号复制引用（含需求/讨论编号、文档路径、源行范围、版本、原文快照）→
// 讨论完毕（收尾提示词）→ Agent 成套落盘纪要与 README 修改草稿并最后写发布标记 →
// 看板随主轮询自动检测发布 → 人工独立「确认归档」与逐项「确认应用」（基线校验、保留旧版、幂等）。
// 界面不虚构 Agent 在线状态：复制提示词只表示已复制，成果一律以落盘文件为准。

const ATBReqDisc = (() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const PHASE_LABEL = {
    idle: '尚未开始讨论',
    active: '提示词已生成',
    waiting: '等待纪要与草稿',
    error: '读取失败',
    review: '成果已读取',
  };

  const state = {
    reqId: null,
    project: null,
    data: null,          // /api/req-disc 响应 discussion（含 rounds/quotes/outcome/prompts）
    sig: '',
    tab: 'doc',          // doc | minutes
    prompt: null,        // { kind, title, text } 打开的提示词/引用预览
    busy: false,         // 创建/收尾/归档/应用进行中（禁重复提交）
    actionError: null,   // 最近一次操作失败原因（保留草稿与选择，供重试）
    checked: new Set(),  // 草稿勾选的 change id
    checkedSig: '',      // 勾选集所属草稿签名（换草稿重置为默认全勾）
    reader: { blocks: null, sig: '', error: null, loading: false },
    quote: null,         // { blockIndex, startLine, endLine, text, whole }
  };

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function sanitizeHtml(html) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  }

  function renderMd(md) {
    try {
      return sanitizeHtml(window.marked.parse(md || ''));
    } catch {
      return `<pre>${esc(md)}</pre>`;
    }
  }

  function apiUrl(pathname) {
    const p = state.project;
    if (!p) return pathname;
    return `${pathname}${pathname.includes('?') ? '&' : '?'}project=${encodeURIComponent(p)}`;
  }

  async function api(pathname, opts) {
    const r = await fetch(apiUrl(pathname), opts);
    let j = {};
    try { j = await r.json(); } catch {}
    if (!r.ok) throw new Error(j.error || `${r.status} ${r.statusText}`);
    return j;
  }

  function toast(msg, isErr = false) {
    const el = document.querySelector('#toast');
    if (!el) return;
    el.classList.toggle('err', isErr);
    el.classList.remove('hidden');
    el.textContent = msg;
    clearTimeout(toast.__t);
    toast.__t = setTimeout(() => el.classList.add('hidden'), 3600);
  }

  async function copyPlain(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      let ok = false;
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch {}
      return ok;
    }
  }

  /* ---------- 阶段推导 ---------- */

  function phaseOf() {
    if (!state.data) return 'idle';
    const r = state.data.rounds[state.data.rounds.length - 1];
    if (state.data.outcome?.state === 'published') return 'review';
    if (state.data.outcome?.state === 'error') return 'error';
    if (r?.finishPromptAt) return 'waiting';
    return 'active';
  }

  function latestRound() {
    return state.data?.rounds?.[state.data.rounds.length - 1] || null;
  }

  /* ---------- 挂载与刷新（app.js renderDrawer / poll 调用） ---------- */

  function mount(reqId, project) {
    const box = $('#reqDocDisc');
    const isSame = box && box.dataset.req === reqId;
    if (!isSame) {
      // 新抽屉/切需求：完整重置；同一需求重渲染（条目变化触发 renderDrawer）保留页签、勾选与提示词
      state.data = null;
      state.sig = '';
      state.tab = 'doc';
      state.prompt = null;
      state.busy = false;
      state.actionError = null;
      state.checked = new Set();
      state.checkedSig = '';
      state.quote = null;
      state.reader = { blocks: null, sig: '', error: null, loading: false };
      if (box) box.dataset.req = reqId;
    }
    state.reqId = reqId;
    state.project = project || null;
    refresh(true);
  }

  async function refresh(force = false) {
    const box = $('#reqDocDisc');
    if (!box || !state.reqId || box.dataset.req !== state.reqId) return; // 抽屉已切走
    if (state.busy) return; // 操作进行中不打断（下一轮轮询再来）
    let res;
    try {
      res = await api(`/api/req-disc?req=${encodeURIComponent(state.reqId)}`);
    } catch (e) {
      // 网络级失败：保留已读成果，仅在错误变化时重渲染一次（避免每 2 秒打断交互）
      const msg = `读取讨论状态失败：${e.message}`;
      if (msg !== state.actionError) {
        state.actionError = msg;
        render();
      }
      return;
    }
    const hadError = Boolean(state.actionError);
    state.actionError = null;
    const sig = JSON.stringify(res.discussion);
    if (!force && sig === state.sig && !hadError) return; // 无变化不重渲染（不打断选择/滚动）
    state.sig = sig;
    state.data = res.discussion;
    // 新草稿（讨论/轮次/草稿内容变化）→ 勾选重置为默认全勾（有明确共识依据的项）
    const draft = state.data?.outcome?.draft || null;
    const dSig = draft ? `${state.data.id}#${draft.round}#${JSON.stringify(draft.changes)}` : '';
    if (dSig !== state.checkedSig) {
      state.checkedSig = dSig;
      state.checked = new Set((draft?.changes || []).map((c) => String(c.id)));
      state.quote = null;
    }
    render();
  }

  /* ---------- 渲染 ---------- */

  function render() {
    const box = $('#reqDocDisc');
    if (!box || !state.reqId || box.dataset.req !== state.reqId) return;
    const ph = phaseOf();
    const d = state.data;
    const round = latestRound();
    box.replaceChildren(buildActionBar(ph, d, round), buildPromptPanel(), buildTabs(), state.tab === 'doc' ? buildDocPane(ph, d) : buildMinutes());
    // 阅读模式懒加载：说明页签首次渲染时读取 README（与是否已有讨论无关；引用复制需先有讨论）
    if (state.tab === 'doc' && !state.reader.blocks && !state.reader.loading && !state.reader.error) loadReader();
    // 还原打开的引用操作条（重渲染后重新定位到对应段落）
    if (state.quote && state.tab === 'doc') positionQuoteBar();
  }

  function buildActionBar(ph, d, round) {
    const bar = document.createElement('div');
    bar.className = 'rd-bar';
    const row = document.createElement('div');
    row.className = 'rd-bar-row';
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = PHASE_LABEL[ph];
    row.appendChild(chip);
    const bind = document.createElement('span');
    bind.className = 'muted rd-bind';
    bind.textContent = ph === 'idle'
      ? '在 Agent 会话讨论，在看板归档与应用（不改变需求状态）'
      : `${d.id} · 第 ${round.no} 轮 · 绑定 ${d.reqId}`;
    bind.style.flex = '1';
    row.appendChild(bind);

    const mk = (label, cls, fn, title) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn small ${cls || ''}`;
      b.textContent = label;
      b.disabled = state.busy;
      if (title) b.title = title;
      b.addEventListener('click', fn);
      return b;
    };
    if (ph === 'idle') {
      row.appendChild(mk('开始讨论', 'primary', onStartDiscussion, '创建唯一讨论编号并生成启动提示词（复制到 Agent 新会话）'));
    } else {
      row.appendChild(mk('启动提示词', '', () => openPrompt('start'), '再次查看/复制启动提示词'));
      if (ph === 'active') {
        row.appendChild(mk('讨论完毕', 'primary', onFinishDiscussion, '生成收尾提示词：在原 Agent 会话执行，要求同时落盘纪要与说明修改草稿'));
      }
      if (ph === 'error' || ph === 'waiting') {
        row.appendChild(mk('再次查看收尾提示词', '', () => openPrompt('finish')));
      }
      if (ph === 'error') {
        row.appendChild(mk('重试', 'primary', () => refresh(true), '重新读取纪要与草稿'));
      }
    }
    bar.appendChild(row);

    const guide = document.createElement('p');
    guide.className = 'muted rd-guide';
    if (state.actionError) {
      if (/失败|错误/.test(state.actionError)) guide.classList.add('rd-error-text');
      guide.textContent = state.actionError;
    } else if (ph === 'idle') {
      guide.textContent = '生成提示词后复制到 Agent 新会话；看板不派单、不感知 Agent 在线状态。';
    } else if (ph === 'active') {
      guide.textContent = '提示词需由你在原 Agent 会话执行；复制记录不等于实际讨论，讨论不改变需求状态。';
    } else if (ph === 'waiting') {
      guide.textContent = '等待 Agent 完整发布纪要与草稿；未发布或缺少任一成果均不会开放应用，本页自动检测。';
    } else if (ph === 'error') {
      guide.textContent = `读取失败：${state.data.outcome?.reason || '未知原因'}。未更新说明，可重试读取完整成果。`;
    } else {
      guide.textContent = '归档纪要与应用修改分别操作；引用快照与旧版说明均已保留。';
    }
    bar.appendChild(guide);
    return bar;
  }

  function buildPromptPanel() {
    const wrap = document.createElement('div');
    wrap.className = 'rd-prompt';
    wrap.hidden = !state.prompt;
    if (!state.prompt) return wrap;
    const head = document.createElement('div');
    head.className = 'rd-bar-row';
    const h = document.createElement('h4');
    h.textContent = state.prompt.title;
    h.style.flex = '1';
    h.style.margin = '0';
    head.appendChild(h);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn small';
    close.textContent = '收起';
    close.addEventListener('click', () => { state.prompt = null; render(); });
    head.appendChild(close);
    wrap.appendChild(head);
    const ta = document.createElement('textarea');
    ta.readOnly = true;
    ta.className = 'rd-prompt-text';
    ta.setAttribute('aria-label', '可手工复制的提示词或引用');
    ta.value = state.prompt.text;
    wrap.appendChild(ta);
    const foot = document.createElement('div');
    foot.className = 'rd-bar-row';
    const hint = document.createElement('span');
    hint.className = 'muted';
    hint.style.flex = '1';
    hint.textContent = state.prompt.hint || '复制不代表 Agent 已连接或成果已生成；请在 Agent 会话执行。';
    foot.appendChild(hint);
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn small primary';
    copy.textContent = '复制内容';
    copy.addEventListener('click', async () => {
      const ok = await copyPlain(ta.value);
      if (ok) {
        toast('已复制。请粘贴到 Agent 会话；此操作不代表 Agent 已连接。');
      } else {
        ta.focus();
        ta.select();
        state.prompt = { ...state.prompt, hint: '自动复制失败，文本已选中，请按 ⌘C / Ctrl+C 手工复制。' };
        render();
      }
    });
    foot.appendChild(copy);
    wrap.appendChild(foot);
    return wrap;
  }

  function buildTabs() {
    const nav = document.createElement('nav');
    nav.className = 'tabs';
    nav.setAttribute('role', 'tablist');
    for (const [key, label] of [['doc', '说明'], ['minutes', '讨论纪要']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `tab${state.tab === key ? ' active' : ''}`;
      b.setAttribute('aria-pressed', String(state.tab === key));
      b.textContent = label;
      b.addEventListener('click', () => { state.tab = key; render(); });
      nav.appendChild(b);
    }
    return nav;
  }

  /* ---------- 说明：阅读模式（源行映射 + 复制引用） ---------- */

  function buildDocPane(ph, d) {
    const pane = document.createElement('article');
    pane.className = 'rd-doc';
    const ver = document.createElement('p');
    ver.className = 'muted';
    ver.textContent = `需求 README · v${d ? d.readmeVersion : 1}（阅读模式保留原文换行，便于精确引用；完整渲染请用上方文档标签）`;
    pane.appendChild(ver);

    const art = document.createElement('div');
    art.className = 'rd-article';
    if (state.reader.loading) {
      art.appendChild(mutedLine('正在读取说明…'));
    } else if (state.reader.error) {
      const p = mutedLine(`说明读取失败：${state.reader.error}`);
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn small';
      retry.textContent = '重试';
      retry.addEventListener('click', loadReader);
      p.appendChild(document.createTextNode(' '));
      p.appendChild(retry);
      art.appendChild(p);
    } else if (state.reader.blocks) {
      renderBlocks(art);
    } else {
      art.appendChild(mutedLine('尚无说明内容'));
    }
    pane.appendChild(art);

    // 引用操作条（选中后出现在对应段落下方）
    const qb = document.createElement('div');
    qb.className = 'notice rd-quote-bar';
    qb.id = 'rdQuoteBar';
    qb.hidden = true;
    pane.appendChild(qb);

    const hint = document.createElement('p');
    hint.className = 'muted';
    hint.textContent = '点击行号引用整段，或在段落/代码内选择文字后复制。行号为源码行（视觉换行不增加行号）；列表、表格内选文不支持精确映射，请点击行号。';
    pane.appendChild(hint);

    if (d && (d.quotes || []).length) {
      const det = document.createElement('details');
      det.className = 'rd-quotes';
      const sum = document.createElement('summary');
      sum.textContent = `已保存的引用快照（${d.quotes.length}）`;
      det.appendChild(sum);
      for (const q of [...d.quotes].reverse()) {
        const pre = document.createElement('pre');
        pre.className = 'rd-quote-snap';
        pre.textContent = `${q.doc} · 第 ${q.startLine}${q.endLine > q.startLine ? `–${q.endLine}` : ''} 行 · v${q.version} · ${fmtTime(q.at)}\n${q.text}`;
        det.appendChild(pre);
      }
      pane.appendChild(det);
    }
    return pane;
  }

  function mutedLine(text) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = text;
    return p;
  }

  function renderBlocks(art) {
    state.reader.blocks.forEach((b, i) => {
      const row = document.createElement('div');
      row.className = 'rd-block';
      row.dataset.b = String(i);
      const ln = document.createElement('button');
      ln.type = 'button';
      ln.className = 'rd-ln';
      const label = b.start === b.end ? String(b.start + 1) : `${b.start + 1}–${b.end + 1}`;
      ln.textContent = label;
      ln.setAttribute('aria-label', `引用源文件第 ${label} 行`);
      ln.title = '引用整段（含源行范围与版本）';
      ln.addEventListener('click', () => {
        if (!state.data) {
          toast('请先开始讨论并生成绑定编号，再复制引用。', true);
          return;
        }
        showQuoteBar(i, b.start + 1, b.end + 1, b.text, true);
      });
      row.appendChild(ln);
      const body = document.createElement('div');
      body.className = 'rd-text';
      if (b.kind === 'para' || b.kind === 'heading') {
        // pre-line 保留源换行 → 选文可按 \n 计数映射源行（不伪造行号）
        body.classList.add('rd-selectable');
        if (b.kind === 'heading') {
          const h = document.createElement('h4');
          h.style.margin = '0';
          h.className = 'rd-selectable';
          h.textContent = b.text.replace(/^#{1,6}\s+/, '');
          body.appendChild(h);
        } else {
          body.style.whiteSpace = 'pre-line';
          body.textContent = b.text;
        }
      } else if (b.kind === 'fence') {
        const pre = document.createElement('pre');
        pre.className = 'rd-selectable rd-code';
        pre.textContent = b.text;
        body.appendChild(pre);
      } else {
        // 列表/引用/表格等：正常渲染，不做选文行映射（引导行号整段引用）
        body.classList.add('rd-rich');
        body.innerHTML = renderMd(b.text);
      }
      row.appendChild(body);
      art.appendChild(row);
    });
    art.addEventListener('mouseup', onReaderSelect);
  }

  // 段落/代码内选文 → 按源换行映射行范围；跨块或富文本元素 → 引导行号整段引用
  function onReaderSelect() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    if (!state.data) {
      toast('请先开始讨论并生成绑定编号，再复制引用。', true);
      return;
    }
    const range = sel.getRangeAt(0);
    const container = this;
    const target = $$('.rd-selectable', container).find((t) => t.contains(range.startContainer) && t.contains(range.endContainer));
    const selected = sel.toString();
    if (!target || !selected.trim()) {
      hideQuoteBar();
      toast('该选择无法精确映射源行（跨段或列表/表格内），请点击源行号引用整段。', true);
      return;
    }
    const row = target.closest('.rd-block');
    if (!row) return;
    const b = state.reader.blocks[Number(row.dataset.b)];
    const before = range.cloneRange();
    before.selectNodeContents(target);
    before.setEnd(range.startContainer, range.startOffset);
    const startLine = b.start + before.toString().split('\n').length;
    const endLine = startLine + selected.split('\n').length - 1;
    showQuoteBar(Number(row.dataset.b), startLine, endLine, selected, false);
  }

  function showQuoteBar(blockIndex, startLine, endLine, text, whole) {
    state.quote = { blockIndex, startLine, endLine, text, whole };
    render();
  }

  // 把引用操作条定位到对应段落下（render 后调用；state.quote 为当前引用）
  function positionQuoteBar() {
    const bar = $('#rdQuoteBar');
    if (!bar || !state.quote) return;
    const art = $('.rd-article');
    const row = art ? art.querySelector(`.rd-block[data-b="${state.quote.blockIndex}"]`) : null;
    if (!row) {
      bar.hidden = true;
      return;
    }
    row.after(bar);
    bar.hidden = false;
    const sum = document.createElement('span');
    sum.style.flex = '1';
    sum.textContent = `源行 ${state.quote.startLine}${state.quote.endLine > state.quote.startLine ? `–${state.quote.endLine}` : ''} · v${state.data.readmeVersion} · ${state.quote.whole ? '整段' : `已选 ${state.quote.text.length} 字`}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn small primary';
    btn.textContent = '复制引用';
    btn.addEventListener('click', onCopyQuote);
    bar.replaceChildren(sum, btn);
  }

  function hideQuoteBar() {
    state.quote = null;
    const bar = $('#rdQuoteBar');
    if (bar) bar.hidden = true;
  }

  async function onCopyQuote() {
    const q = state.quote;
    if (!q || !state.data) return;
    const d = state.data;
    const round = latestRound();
    const docPath = `${d.projectRoot}/docs/agent-team-board/requirements/${d.reqId}/README.md`;
    const text = [
      `${d.reqId} / ${d.id}（第 ${round ? round.no : 1} 轮）`,
      `项目：${d.projectRoot}`,
      `文档：${docPath}`,
      `源行：${q.startLine}${q.endLine > q.startLine ? `–${q.endLine}` : ''}；版本：v${d.readmeVersion}`,
      '原文快照：',
      q.text,
      '',
      '我的问题：',
    ].join('\n');
    // 先落引用快照（复制记录 ≠ 讨论记录），失败不阻断复制但提示
    try {
      await api(`/api/req-disc/${d.id}/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc: 'README.md', startLine: q.startLine, endLine: q.endLine, version: d.readmeVersion, text: q.text }),
      });
    } catch (e) {
      toast(`引用快照保存失败：${e.message}`, true);
    }
    const ok = await copyPlain(text);
    if (ok) {
      toast('已复制引用（快照已保存）。请粘贴到原 Agent 会话补充问题。');
      refresh(true);
    } else {
      openPrompt('quote', text);
      toast('自动复制失败：文本已展开，请手工复制。', true);
    }
  }

  async function loadReader() {
    const hadBlocks = Boolean(state.reader.blocks);
    state.reader.loading = !hadBlocks; // 已有内容时不闪加载态，仅后台刷新
    state.reader.error = null;
    if (state.reader.loading) render();
    try {
      const res = await api(`/api/item/${encodeURIComponent(state.reqId)}/doc/README.md`);
      const md = String(res.content ?? '');
      const sig = `${md.length}#${md.slice(0, 64)}#v${state.data?.readmeVersion ?? 1}`;
      if (sig !== state.reader.sig) {
        state.reader.sig = sig;
        state.reader.blocks = parseBlocks(md);
      }
    } catch (e) {
      state.reader.error = e.message;
    } finally {
      state.reader.loading = false;
      render();
    }
  }

  /* ---------- Markdown 源行块解析（1 基行号，源码行而非视觉行） ---------- */

  function kindOfLine(l) {
    if (/^\s*(```|~~~)/.test(l)) return 'fence';
    if (/^#{1,6}\s+\S/.test(l)) return 'heading';
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) return 'list';
    if (/^>/.test(l)) return 'quote';
    if (/^\s*\|.*\|/.test(l)) return 'table';
    if (/^(---|\*\*\*|___)\s*$/.test(l)) return 'hr';
    if (/^<\/?\w+/.test(String(l).trim())) return 'html';
    return 'para';
  }

  function parseBlocks(md) {
    const lines = String(md ?? '').split('\n');
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      if (!lines[i].trim()) { i++; continue; }
      const start = i;
      const kind = kindOfLine(lines[i]);
      if (kind === 'fence') {
        const fence = lines[i].trim().startsWith('```') ? '```' : '~~~';
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence)) i++;
        if (i < lines.length) i++; // 收束栅栏（或 EOF）
        blocks.push({ kind, start, end: i - 1, text: lines.slice(start, i).join('\n') });
        continue;
      }
      if (kind === 'heading' || kind === 'hr') {
        blocks.push({ kind, start, end: i, text: lines[i] });
        i++;
        continue;
      }
      if (kind === 'para') {
        i++;
        while (i < lines.length && lines[i].trim() && kindOfLine(lines[i]) === 'para') i++;
      } else {
        i++;
        while (i < lines.length && lines[i].trim() && kindOfLine(lines[i]) === kind) i++;
      }
      blocks.push({ kind, start, end: i - 1, text: lines.slice(start, i).join('\n') });
    }
    return blocks;
  }

  /* ---------- 讨论纪要：空态 / 等待 / 失败 / 成果（归档 + 逐项应用） ---------- */

  function buildMinutes() {
    const pane = document.createElement('article');
    pane.className = 'rd-minutes';
    const ph = phaseOf();
    if (ph === 'idle' || ph === 'active') {
      const empty = document.createElement('div');
      empty.className = 'rd-empty';
      const h = document.createElement('h4');
      h.textContent = '尚无讨论纪要';
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = '先开始讨论，在原 Agent 会话执行收尾提示词后，等待完整成果（纪要与说明修改草稿成套发布）。';
      empty.append(h, p);
      pane.appendChild(empty);
      return pane;
    }
    if (ph === 'waiting') {
      const n = document.createElement('div');
      n.className = 'notice';
      n.setAttribute('role', 'status');
      n.textContent = '等待 Agent 完整发布纪要与草稿；未发布或缺少任一成果均不会开放应用。本页自动检测，落盘后自动展示。';
      pane.appendChild(n);
      const row = document.createElement('div');
      row.className = 'rd-bar-row';
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'btn small';
      again.textContent = '再次查看收尾提示词';
      again.addEventListener('click', () => openPrompt('finish'));
      row.appendChild(again);
      pane.appendChild(row);
      return pane;
    }
    if (ph === 'error') {
      const n = document.createElement('div');
      n.className = 'notice warn';
      n.setAttribute('role', 'alert');
      n.textContent = `读取失败：${state.data.outcome?.reason || '未知原因'}。未把上一版内容当作新成果，未写入 README。`;
      pane.appendChild(n);
      const row = document.createElement('div');
      row.className = 'rd-bar-row';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn small primary';
      retry.textContent = '重试读取';
      retry.addEventListener('click', () => refresh(true));
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'btn small';
      again.textContent = '再次查看收尾提示词';
      again.addEventListener('click', () => openPrompt('finish'));
      row.append(retry, again);
      pane.appendChild(row);
      return pane;
    }

    // review：成果展示
    const d = state.data;
    const round = latestRound();
    const out = d.outcome;
    const head = document.createElement('div');
    head.className = 'rd-bar-row';
    const h = document.createElement('h4');
    h.textContent = `讨论纪要 · 第 ${round.no} 轮`;
    h.style.margin = '0';
    h.style.flex = '1';
    head.appendChild(h);
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = round.archivedAt ? '已归档' : '待归档';
    head.appendChild(chip);
    pane.appendChild(head);

    const meta = document.createElement('p');
    meta.className = 'muted';
    meta.textContent = `${d.id} · README.md · 读取于 ${fmtTime(out.publishedAt)}（区分明确共识 / Agent 建议 / 未决问题由纪要原文给出）`;
    pane.appendChild(meta);

    const body = document.createElement('div');
    body.className = 'rd-min-body md';
    body.innerHTML = renderMd(out.minutes);
    pane.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'rd-bar-row';
    const cont = document.createElement('button');
    cont.type = 'button';
    cont.className = 'btn small';
    cont.textContent = '继续讨论';
    cont.title = '同一讨论开新一轮；已归档纪要与应用记录保留';
    cont.disabled = state.busy;
    cont.addEventListener('click', onContinueDiscussion);
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    const archive = document.createElement('button');
    archive.type = 'button';
    archive.className = 'btn small primary';
    archive.textContent = round.archivedAt ? '已归档' : '确认归档';
    archive.disabled = state.busy || Boolean(round.archivedAt);
    archive.title = '归档纪要（不改 README；说明修改需独立确认应用）';
    archive.addEventListener('click', onArchive);
    actions.append(cont, spacer, archive);
    pane.appendChild(actions);

    pane.appendChild(buildDraftSection(d, round, out));
    return pane;
  }

  function buildDraftSection(d, round, out) {
    const wrap = document.createElement('div');
    wrap.className = 'rd-draft';
    const h = document.createElement('h4');
    h.textContent = '说明修改草稿';
    h.style.margin = '8px 0 4px';
    wrap.appendChild(h);
    const changes = out.draft?.changes || [];

    if (round.applied) {
      const a = round.applied;
      const n = document.createElement('div');
      n.className = 'notice ok';
      n.textContent = `已应用 ${a.items.length} 项（v${a.beforeVersion} → v${a.afterVersion}）· ${fmtTime(a.at)} · 来源 ${a.sourceDiscussion || d.id} · 已保留 v${a.beforeVersion} 旧版快照；未勾选项未写入。重复点击或刷新不会再次写入。`;
      wrap.appendChild(n);
      for (const c of a.items) wrap.appendChild(buildChangeCard(c, true, true));
      if (state.actionError) {
        const w = document.createElement('p');
        w.className = 'muted rd-error-text';
        w.textContent = state.actionError;
        wrap.appendChild(w);
      }
      return wrap;
    }

    const base = document.createElement('p');
    base.className = 'muted';
    if (!changes.length) {
      base.textContent = '本次无说明修改（草稿无勾选项）：应用已禁用，纪要仍可独立归档。';
      wrap.appendChild(base);
      return wrap;
    }
    base.textContent = `基于 README 基线（草稿生成时内容）· 只同步以下勾选项（均有明确共识依据，可逐项取消）`;
    wrap.appendChild(base);

    for (const c of changes) {
      const card = buildChangeCard(c, false, state.checked.has(String(c.id)));
      card.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
        if (e.target.checked) state.checked.add(String(c.id));
        else state.checked.delete(String(c.id));
        renderApplyArea();
      });
      wrap.appendChild(card);
    }

    const area = document.createElement('div');
    area.className = 'rd-bar-row';
    area.id = 'rdApplyArea';
    const note = document.createElement('span');
    note.className = 'muted';
    note.style.flex = '1';
    note.textContent = '保留前版本 · 不改变需求状态';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'btn small primary';
    apply.addEventListener('click', onApply);
    area.append(note, apply);
    wrap.appendChild(area);
    renderApplyArea();
    return wrap;

    function renderApplyArea() {
      const btn = wrap.querySelector('#rdApplyArea button');
      if (!btn) return;
      const n = state.checked.size;
      btn.disabled = state.busy || n === 0;
      btn.textContent = n ? `确认应用 ${n} 项修改` : '未选择修改';
    }
  }

  function buildChangeCard(c, disabled, checked) {
    const card = document.createElement('div');
    card.className = 'rd-change';
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.change = String(c.id);
    cb.checked = Boolean(checked);
    cb.disabled = Boolean(disabled);
    const title = document.createElement('span');
    title.textContent = String(c.title || c.id);
    label.append(cb, title);
    card.appendChild(label);
    const before = document.createElement('div');
    before.className = 'rd-before';
    before.textContent = `− ${c.before}`;
    const after = document.createElement('div');
    after.className = 'rd-after';
    after.textContent = `＋ ${c.after}`;
    card.append(before, after);
    if (c.basis) {
      const basis = document.createElement('p');
      basis.className = 'muted';
      basis.textContent = `依据：${c.basis}`;
      card.appendChild(basis);
    }
    return card;
  }

  /* ---------- 操作 ---------- */

  function openPrompt(kind, quoteText) {
    const d = state.data;
    if (kind === 'start') {
      state.prompt = { kind, title: '启动提示词 · 复制到 Agent 新会话', text: d?.startPrompt || '' };
    } else if (kind === 'finish') {
      state.prompt = { kind, title: '收尾提示词 · 复制到原 Agent 会话', text: d?.finishPrompt || '', hint: '请在原 Agent 会话执行；要求同时落盘纪要与说明修改草稿并最后写发布标记。' };
    } else {
      state.prompt = { kind: 'quote', title: '文档引用 · 复制到原会话', text: quoteText || '', hint: '自动复制失败时请手工复制（⌘C / Ctrl+C）。' };
    }
    render();
  }

  async function onStartDiscussion() {
    state.busy = true;
    state.actionError = '正在创建讨论…';
    render();
    try {
      const res = await api('/api/req-disc/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reqId: state.reqId }),
      });
      state.actionError = null;
      state.sig = JSON.stringify(res.discussion);
      state.data = res.discussion;
      state.checkedSig = '';
      state.checked = new Set();
      openPrompt('start');
      toast(`✓ 已创建讨论 ${res.discussion.id}；请复制启动提示词到 Agent 新会话。`);
      loadReader();
    } catch (e) {
      state.actionError = `创建讨论失败：${e.message}`;
      render();
    } finally {
      state.busy = false;
      render();
    }
  }

  async function onFinishDiscussion() {
    const d = state.data;
    if (!d) return;
    state.busy = true;
    state.actionError = '正在生成收尾提示词…';
    render();
    try {
      const res = await api(`/api/req-disc/${d.id}/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      state.actionError = null;
      state.sig = JSON.stringify(res.discussion);
      state.data = res.discussion;
      state.tab = 'minutes';
      openPrompt('finish');
      toast('已生成收尾提示词；请在原 Agent 会话执行，等待纪要与草稿成套发布。');
    } catch (e) {
      state.actionError = `生成收尾提示词失败：${e.message}`;
      render();
    } finally {
      state.busy = false;
      render();
    }
  }

  async function onContinueDiscussion() {
    const d = state.data;
    if (!d) return;
    state.busy = true;
    state.actionError = '正在开启新一轮讨论…';
    render();
    try {
      const res = await api(`/api/req-disc/${d.id}/continue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      state.actionError = null;
      state.tab = 'doc';
      state.prompt = null;
      refresh(true);
      openPrompt('start');
      toast(`已开第 ${res.discussion.rounds.length} 轮；既有归档与应用记录保留，请复制新的启动提示词继续。`);
    } catch (e) {
      state.actionError = `继续讨论失败：${e.message}`;
      render();
    } finally {
      state.busy = false;
      render();
    }
  }

  async function onArchive() {
    const d = state.data;
    if (!d) return;
    state.busy = true;
    state.actionError = '正在归档纪要…';
    render();
    try {
      const res = await api(`/api/req-disc/${d.id}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      state.actionError = null;
      state.sig = JSON.stringify(res.discussion);
      state.data = res.discussion;
      render();
      toast('纪要已归档（README 未改动；说明修改需独立确认应用）。');
    } catch (e) {
      state.actionError = `归档失败：${e.message}`;
      render();
    } finally {
      state.busy = false;
      render();
    }
  }

  async function onApply() {
    const d = state.data;
    if (!d || !state.checked.size) return;
    const selected = [...state.checked];
    state.busy = true;
    state.actionError = `正在应用 ${selected.length} 项修改…`;
    render();
    try {
      const res = await api(`/api/req-disc/${d.id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected }),
      });
      state.actionError = null;
      if (res.applied?.alreadyApplied) {
        toast('该草稿此前已应用，未重复写入。');
      } else {
        toast(`✓ 已应用 ${selected.length} 项修改（v${res.applied.beforeVersion} → v${res.applied.afterVersion}，旧版已保留）。`);
      }
      state.tab = 'minutes';
      refresh(true);
      loadReader();
    } catch (e) {
      // 失败保留选择与草稿，展示原因（含「说明已变化」基线拦截）供重试或回原会话重新生成
      state.actionError = `应用失败：${e.message}`;
      render();
    } finally {
      state.busy = false;
      render();
    }
  }

  /* ---------- 对外（app.js 调用） ---------- */

  return { mount, refresh };
})();

window.ATBReqDisc = ATBReqDisc;
