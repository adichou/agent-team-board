'use strict';
// 开放式讨论模块前端（REQ-20260909-004 重构，前身 REQ-20260907-001 咨询看板）——
// 由 app.js 在 view=oncall 时激活。讨论在 Agent 外部会话进行，看板负责：
// 启动/继续讨论/整理结论提示词（复制到 Agent 会话）、逐轮交流记录与纪要读取（REQ-20260910-018
// 起每轮经统一入口落盘，看板轮询自动刷新，无需收尾发布）、候选草稿编辑勾选后批量创建
// 需求/Bug（初始待接受，双向跳转）、归档与继续讨论。
// 持久化状态仅「讨论中 / 已归档」两态；逐轮记录中/纪要已生成/有待创建草稿仅为阶段提示。
// 旧单（看板代答时期的问答轮次）无逐轮记录，在「交流记录」页签尾部只读保留；沿用 ASK 编号与
// /api/oncall/ticket 附件端点（兼容旧数据），新交互全部走 /api/discussion*。
// REQ-20260909-012：详情多页签布局；REQ-20260910-018 收敛为「讨论纪要 / 交流记录 / 后续行动」
// 三页签——概况元信息并入详情头部，提示词改由顶部操作区承载（页签行下可折叠块）。

const ATBOncall = (() => {
  const $ = (s, el = document) => el.querySelector(s);

  const STATUS_LABEL = { discussing: '讨论中', archived: '已归档' };
  const STATUS_CLASS = { discussing: 'oc-discussing', archived: 'oc-archived' };
  // 阶段提示（非状态，不参与筛选）：列表行副标题与详情通知条共用
  const PHASE_HINT = {
    recording: '逐轮记录中',
    waiting: '等待纪要',
    ready: '纪要已生成',
    drafts: '有待创建草稿',
    error: '纪要读取失败',
    none: '外部会话中',
    archived: '成果已保留',
  };
  const FILTERS = [
    ['discussing', '讨论中'],
    ['archived', '已归档'],
  ];
  const ITEM_TYPE_LABEL = { requirement: '需求', bug: 'Bug' };

  // REQ-20260910-018 详情三页签：讨论纪要（背景 + 最新纪要 + 待更新徽标 + 旧单历史问答）/
  // 交流记录（逐轮：用户原文 + 回复总结 + 时间 + 轮次 + 来源会话）/ 后续行动（已创建 + 候选草稿）。
  // 原「概况」元信息并入详情头部、「提示词」改由顶部操作区按钮 + 页签行下可折叠块承载。
  const DISC_TABS = [
    { key: 'minutes', label: '讨论纪要' },
    { key: 'rounds', label: '交流记录' },
    { key: 'actions', label: '后续行动' },
  ];
  const DISC_DEFAULT_TAB = 'minutes';
  // 当前页签记忆（无效值回落默认，同 taskPaneOf / drawerTabValid 先例）：跨轮询重渲染保持
  function discTabOf() {
    return DISC_TABS.some((p) => p.key === state.tab) ? state.tab : DISC_DEFAULT_TAB;
  }

  const state = {
    project: null,
    board: null,        // /api/discussion/board 最近响应
    boardSig: '',
    filter: 'discussing',
    q: '',
    selectedId: null,   // 当前详情讨论编号（null = 未选，窄屏回列表）
    detail: null,       // /api/discussion/:id 全量
    detailSig: '',
    tab: DISC_DEFAULT_TAB, // 讨论纪要 | 交流记录 | 后续行动 → 见 DISC_TABS（REQ-20260910-018）
    prompt: null,       // { kind: 'start'|'finish' } 提示词展示框（文本渲染时现算）
    reading: false,     // 纪要读取中（仅显式读取时展示，后台轮询不闪加载态）
    draftEdits: {},     // `${discId}/${draftId}` → 编辑值（切换记录保留，会话内不丢）
    createResults: null, // 最近一次批量创建逐项结果（`${discId}/${draftId}` → { ok, error }）
    creating: false,
    listScrollTop: 0,   // 窄屏进入详情前的列表滚动位置（返回恢复）
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
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
    el.replaceChildren();
    el.textContent = msg;
    clearTimeout(toast.__t);
    toast.__t = setTimeout(() => el.classList.add('hidden'), 3600);
  }

  // 复制提示词：剪贴板 + execCommand 双回退；都失败时全选文本提示手动 ⌘C / Ctrl+C
  async function copyPlain(text, textareaEl = null) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) return true;
    } catch {}
    if (textareaEl) {
      textareaEl.focus();
      textareaEl.select();
    }
    return false;
  }

  /* ---------- 列表视图 ---------- */

  function phaseHintOf(d) {
    if (d.status === 'archived') return PHASE_HINT.archived;
    return PHASE_HINT[d.phase] || PHASE_HINT.none;
  }

  function renderView() {
    const view = $('#oncallView');
    const b = state.board;
    if (!view || !b) return;
    if (!b.initialized) {
      // REQ-20260910-012：工作区改行向（左缘纵向筛选栏 + 右内容）后，未初始化空卡由
      // .disc-empty-wrap 在内容区居中（原列向布局下卡片自身居中）
      view.innerHTML = '<div class="disc-empty-wrap"><div class="empty-card oncall-empty"><h2>讨论</h2><p>当前项目尚未初始化看板，请先到「需求」模块完成初始化。</p></div></div>';
      return;
    }
    view.innerHTML = `
      <nav class="oncall-filters disc-filters" role="group" aria-label="按状态筛选">
        ${FILTERS.map(([k, label]) => {
          const count = (b.discussions || []).filter((x) => x.status === k).length;
          return `<button type="button" class="filter-chip${state.filter === k ? ' active' : ''}" data-filter="${k}">${label} <span class="filter-count">${count}</span></button>`;
        }).join('')}
      </nav>
      <div class="req-split disc-split">
        <section class="req-list-wrap" aria-label="讨论记录">
          <!-- REQ-20260910-008：.req-caption 已是单行工具栏容器，记录计数直接置于其中 -->
          <div class="req-caption"><span class="muted small">${(b.discussions || []).filter((x) => x.status === state.filter).length} 条记录 · 按最近更新</span></div>
          <div id="ocList" class="req-list disc-list"></div>
        </section>
        <aside id="ocDetail" class="drawer${state.selectedId ? ' has-item' : ''}" aria-label="讨论详情"></aside>
      </div>
      <div id="discMask" class="mask disc-mask${state.selectedId ? ' on' : ''}"></div>`;
    for (const chip of view.querySelectorAll('.filter-chip')) {
      chip.addEventListener('click', () => {
        state.filter = chip.dataset.filter;
        emitState(); // REQ-20260910-001：筛选档变化通知 app.js 落盘快照
        renderView();
        renderList();
      });
    }
    view.querySelector('#discMask')?.addEventListener('click', closeDetail);
    renderList();
    renderDetail();
  }

  function setQuery(q) {
    state.q = String(q || '').trim();
    if (state.board) renderList();
  }

  // REQ-20260910-009：只读搜索统计（供 app.js 统一反馈条呈现「命中 N / 共 T」，不改变列表行为）
  function searchStats() {
    const discs = state.board?.discussions || [];
    const ql = (state.q || '').toLowerCase();
    const matched = discs.filter((x) => !ql || `${x.id} ${x.title}`.toLowerCase().includes(ql));
    return {
      q: state.q,
      matched: matched.length,
      visible: matched.filter((x) => x.status === state.filter).length,
      total: discs.length,
    };
  }

  function renderList() {
    const list = $('#ocList');
    if (!list) return;
    const discs = state.board?.discussions || [];
    const ql = state.q.toLowerCase();
    const matched = discs.filter((x) => !ql || `${x.id} ${x.title}`.toLowerCase().includes(ql));
    // 按最近更新排序（updatedAt desc，同值回退编号），列表滚动位置跨重渲染保留
    const shown = [...matched.filter((x) => x.status === state.filter)]
      .sort((a, b) => (String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))) || String(b.id).localeCompare(String(a.id)));
    if (!shown.length) {
      list.innerHTML = `<div class="notice oncall-empty-tip">${
        ql
          ? `没有匹配「${esc(state.q)}」的讨论记录，清空搜索恢复。`
          : discs.length
            ? '当前筛选下没有讨论记录。'
            : '暂无讨论记录：点击右上「＋ 新建」选择讨论，创建第一条开放式讨论。'
      }</div>`;
      return;
    }
    list.replaceChildren(...shown.map((d) => {
      const card = document.createElement('article');
      card.className = `oncall-card disc-card${state.selectedId === d.id ? ' selected' : ''}`;
      // REQ-20260910-018：卡片增加已保存轮数与最新回复摘要（新轮落盘后随轮询自动刷新）
      const roundInfo = d.roundCount
        ? `<span title="已保存交流轮数">💬 已保存 ${d.roundCount} 轮</span>`
        : '';
      const lastSummary = d.lastSummary
        ? `<div class="disc-last-summary" title="最新回复摘要">${esc(d.lastSummary)}</div>`
        : '';
      card.innerHTML = `
        <div class="card-top">
          <span class="cid">${esc(d.id)}</span>
          <span class="chip ${STATUS_CLASS[d.status] || ''}">${STATUS_LABEL[d.status] || d.status}</span>
          ${d.phase === 'error' ? '<span class="chip oc-failed" title="纪要读取失败">⚠ 读取失败</span>' : ''}
        </div>
        <div class="card-title">${esc(d.title)}</div>
        ${lastSummary}
        <div class="card-meta">
          <span class="disc-phase">${esc(phaseHintOf(d))}</span>
          ${roundInfo}
          ${d.createdCount ? `<span title="已创建成果">🧩 ${d.createdCount} 条已生成</span>` : ''}
          <span class="m-time">${fmtTime(d.updatedAt)}</span>
        </div>`;
      card.addEventListener('click', () => openItem(d.id));
      return card;
    }));
    list.scrollTop = state.listScrollTop;
  }

  /* ---------- 详情（右栏 / 窄屏覆盖） ---------- */

  function openItem(id) {
    if (state.selectedId && state.selectedId !== id) state.listScrollTop = 0; // 换记录不再回旧位置
    const list = $('#ocList');
    if (list) state.listScrollTop = list.scrollTop; // 保存滚动位置，返回列表恢复
    state.selectedId = id;
    state.detail = null;
    state.detailSig = '';
    state.prompt = null;
    state.tab = DISC_DEFAULT_TAB; // 切换讨论记录：页签回落默认「讨论纪要」
    // 草稿编辑与创建结果按 讨论编号/草稿id 记录，切换记录不丢失（刷新页面才清空）
    const detail = $('#ocDetail');
    detail?.classList.add('has-item');
    $('#discMask')?.classList.add('on');
    emitState(); // REQ-20260910-001：详情打开通知 app.js 落盘快照
    refreshDetail({ loading: true });
  }

  function closeDetail() {
    state.selectedId = null;
    state.detail = null;
    state.detailSig = '';
    state.prompt = null;
    state.tab = DISC_DEFAULT_TAB; // 关闭详情重置默认页签（再次进入从讨论纪要开始）
    $('#ocDetail')?.classList.remove('has-item');
    $('#discMask')?.classList.remove('on');
    emitState(); // REQ-20260910-001：详情关闭通知 app.js 落盘快照
    renderDetail();
    renderList();
  }

  // 兼容 app.js 既有调用（项目切换时关闭讨论详情）
  function closeDrawer() {
    closeDetail();
  }

  /* ---------- 刷新状态快照接缝（REQ-20260910-001） ---------- */

  // 当前浏览态快照：app.js 落盘时读取（单一写者）；tab 经 discTabOf 校验（无效值回落概况）
  function snapshot() {
    return { filter: state.filter, selectedId: state.selectedId, tab: discTabOf() };
  }

  // 状态变化通知：app.js 监听 atb:oncall-state 统一落盘（同 atb:open-req 自定义事件先例，
  // 不向 app.js 暴露内部 state 对象）
  function emitState() {
    window.dispatchEvent(new CustomEvent('atb:oncall-state', { detail: snapshot() }));
  }

  // 刷新后恢复（app.js boot 首轮数据到位后调用）：筛选档 / 详情 / 页签落位 state；
  // 详情经 refreshDetail({restore}) 拉取，讨论在刷新间隙被删时静默 closeDetail（无 toast）。
  // 首次 renderView 会按 state 重建容器（含筛选 chips 选中态与详情 has-item）。
  async function restoreView(snap) {
    if (!snap || typeof snap !== 'object') return;
    if (FILTERS.some(([k]) => k === snap.filter)) state.filter = snap.filter;
    const tab = DISC_TABS.some((p) => p.key === snap.tab) ? snap.tab : DISC_DEFAULT_TAB;
    if (typeof snap.selectedId === 'string' && snap.selectedId) {
      state.selectedId = snap.selectedId;
      state.tab = tab;
      $('#ocDetail')?.classList.add('has-item');
      $('#discMask')?.classList.add('on');
      await refreshDetail({ loading: true, restore: true });
    }
  }

  // 详情编辑态保护：有输入聚焦时跳过重渲染，待失焦后应用（防 2s 轮询打断草稿编辑）
  function detailEditing() {
    const el = document.activeElement;
    return !!(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && $('#ocDetail')?.contains(el));
  }

  async function refreshDetail({ force = false, loading = false, restore = false } = {}) {
    if (!state.selectedId) return;
    const id = state.selectedId;
    if (loading) {
      state.reading = true;
      renderDetailNoticeOnly();
    }
    try {
      const res = await api(`/api/discussion/${encodeURIComponent(id)}`);
      if (state.selectedId !== id) return; // 已切走，丢弃过期响应
      state.reading = false;
      state.detail = res.discussion;
      const sig = JSON.stringify([res.discussion, state.prompt?.kind, state.tab, state.createResults, state.draftEdits]);
      if (!force && sig === state.detailSig) return;
      state.detailSig = sig;
      renderDetail();
    } catch (e) {
      state.reading = false;
      // REQ-20260910-001：恢复路径的失效回落——讨论在刷新间隙被删时静默回列表（不报错、不卡死）
      if (restore) {
        closeDetail();
        return;
      }
      toast(e.message, true);
    }
  }

  // 仅刷新通知条（读取中反馈），不动正文避免闪烁
  function renderDetailNoticeOnly() {
    if (!state.reading) return;
    const notice = $('#ocNotice');
    if (notice) {
      notice.className = 'notice loading';
      notice.textContent = '正在读取讨论记录……（逐轮记录与纪要按约定目录读取）';
    }
  }

  function noticeOf(d) {
    if (state.reading) return { cls: 'notice loading', text: '正在读取讨论记录……（逐轮记录与纪要按约定目录读取）' };
    const o = d.outcome || {};
    if (o.state === 'error') return { cls: 'notice warn', text: `纪要读取失败：${o.reason || '未知原因'}` };
    // 逐轮记录反馈：最新保存时间与轮数（REQ-20260910-018：每轮保存后自动更新，无需收尾发布）
    if (d.roundCount > 0) {
      const stale = d.minutes?.stale ? '纪要待更新：可在 Agent 会话点「整理结论」重整纪要。' : '';
      return {
        cls: 'notice ok',
        text: `已保存 ${d.roundCount} 轮交流记录${d.lastRoundAt ? `，最新保存 ${fmtTime(d.lastRoundAt)}` : ''}。${stale}`,
      };
    }
    if (o.state === 'published') {
      const pending = d.draftCount - d.createdCount;
      return pending > 0
        ? { cls: 'notice ok', text: `纪要已生成，有 ${pending} 项候选草稿待确认创建。` }
        : { cls: 'notice ok', text: '纪要已读取，可编辑候选条目并创建需求或 Bug。' };
    }
    return { cls: 'notice', text: '复制启动提示词到 Agent 会话开始讨论：每轮交流（用户原文 + 回复总结）将逐轮保存并在「交流记录」展示。' };
  }

  // 草稿编辑值：纪要草稿为基线，叠加用户编辑（按 讨论编号/草稿id 记录，切换记录不丢）
  const draftKey = (discId, draftId) => `${discId}/${draftId}`;
  function editOf(d, draft) {
    const base = {
      selected: true,
      title: draft.title || '',
      description: draft.description || '',
      repro: draft.repro || '',
      actual: draft.actual || '',
      expected: draft.expected || '',
      acceptance: draft.acceptance || '',
    };
    return { ...base, ...(state.draftEdits[draftKey(d.id, draft.id)] || {}) };
  }

  // 提示词折叠块（REQ-20260910-018：无提示词页签；启动/整理结论两类，常驻页签行之下、
  // 通知条之后；未生成/已收起时空态说明，不隐藏区块）。复制继续讨论提示词直接复制不展开本块。
  function promptHtml(promptText) {
    if (!state.prompt) return '';
    const isOrganize = state.prompt.kind === 'organize';
    return `
        <div class="disc-prompt">
          <label class="muted small" for="ocPromptText">${isOrganize ? '整理结论提示词（复制到 Agent 会话；整理不终止讨论）' : '启动提示词（复制到 Agent 新会话）'}</label>
          <textarea id="ocPromptText" readonly rows="8">${esc(promptText || '')}</textarea>
          <div class="dep-toolbar">
            <button type="button" class="btn primary" id="ocCopyPrompt">复制提示词</button>
            <button type="button" class="btn" id="ocHidePrompt">收起</button>
            <span class="muted small">复制只代表提示词已生成，不代表 Agent 已连接</span>
          </div>
        </div>`;
  }

  // REQ-20260910-028：讨论背景（question.md）里的相对截图引用（attachments/<文件名>，创建讨论时
  // 随背景一次性写入）在看板内解析。看板是 SPA（页面路径恒为 /），相对图片不接管会按页面 URL
  // 解析到站点根而必然 404。只接管「attachments/ 单文件名」形态（./ 前缀与裸相对均可），改写到
  // 讨论附件端点 /api/discussion/:id/attachment/:name（口径对齐 app.js linkupDocImages 条目文档图片
  // 先例）；http(s)/data: 等协议绝对地址、根相对路径、子目录形态保持原有行为不动（旧单轮次附件
  // 本就走绝对端点地址，不受影响）。点击放大复用 #oncallLightbox；加载失败就地替换为占位说明，
  // 不渲染空白破图。旧讨论（背景无引用行）无相对图可接管，展示不变。
  function linkupDiscImages(view, id) {
    if (!view || !id) return;
    for (const img of view.querySelectorAll('img')) {
      const raw = img.getAttribute('src') || '';
      if (!raw || raw.startsWith('#') || raw.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
      const m = /^(?:\.\/)?attachments\/([^/]+)$/.exec(raw);
      if (!m) continue;
      let name = m[1];
      try { name = decodeURIComponent(name); } catch { /* 保留原样 */ }
      const url = apiUrl(`/api/discussion/${encodeURIComponent(id)}/attachment/${encodeURIComponent(name)}`);
      img.src = url;
      img.loading = 'lazy';
      img.classList.add('doc-shot');
      img.addEventListener('click', () => {
        const box = $('#oncallLightbox');
        if (!box) return;
        box.querySelector('img').src = url;
        box.classList.remove('hidden');
      });
      img.addEventListener('error', () => {
        const p = document.createElement('p');
        p.className = 'muted small';
        p.textContent = `截图 ${name} 无法加载（文件可能被移动、删除或超过 8MB 上限）`;
        img.replaceWith(p);
      });
    }
  }

  function renderDetail() {
    const wrap = $('#ocDetail');
    if (!wrap) return;
    if (!state.selectedId || !state.detail) {
      wrap.classList.remove('has-item');
      wrap.innerHTML = `<div class="drawer-empty"><p class="muted">从左侧选择一条讨论记录，或在 Agent 会话讨论后回看逐轮记录、纪要与成果。</p></div>`;
      return;
    }
    const d = state.detail;
    const tab = discTabOf(); // 页签记忆：无效值回落默认；轮询重渲染不重置（detailSig 已含 tab）
    const notice = noticeOf(d);
    const createdIds = new Set((d.created || []).map((c) => c.draftId));
    // 后续行动页签计数角标：待创建候选草稿 + 已创建成果（为 0 不显示括号）
    const draftsCount = (d.created || []).length + (d.candidates || []).filter((x) => !createdIds.has(x.id)).length;
    // 提示词文本渲染时现算（按钮先设 kind，详情到达后自然带出全文；启动/整理两类）
    const promptText = state.prompt ? (state.prompt.kind === 'organize' ? d.organizePrompt : d.startPrompt) : null;
    // 头部元信息（原「概况」页签归并）：创建 + 最近保存（逐轮记录口径）
    const metaLine = d.roundCount > 0
      ? `已保存 ${d.roundCount} 轮 · 最新保存 ${fmtTime(d.lastRoundAt || d.updatedAt)} · 创建 ${fmtTime(d.createdAt)}`
      : `创建 ${fmtTime(d.createdAt)} · 尚无已保存交流`;
    wrap.innerHTML = `
      <header class="drawer-head">
        <div class="card-top">
          <button type="button" class="btn drawer-back" id="ocBack" title="返回列表" aria-label="返回列表">← 返回列表</button>
          <span class="cid">${esc(d.id)}</span>
          <span class="chip ${STATUS_CLASS[d.status] || ''}">${STATUS_LABEL[d.status] || d.status}</span>
          ${d.reqId ? '<button type="button" class="link oc-req" id="ocGotoReq" title="旧绑定需求，点击查看需求详情">🔗 ' + esc(d.reqId) + '</button>' : ''}
        </div>
        <h2>${esc(d.title)}</h2>
        <p class="muted small disc-head-meta">${esc(metaLine)}</p>
        <div class="disc-actions">
          <button type="button" class="btn" id="ocStart" ${state.reading ? 'disabled' : ''} title="生成新会话启动提示词（逐轮保存约定）">启动提示词</button>
          <button type="button" class="btn" id="ocCopyContinue" ${state.reading ? 'disabled' : ''} title="复制继续讨论提示词：在任意能访问本项目文档的 Agent 会话接续同一讨论">复制继续讨论提示词</button>
          <button type="button" class="btn" id="ocOrganize" ${state.reading ? 'disabled' : ''} title="生成整理结论提示词：重整纪要与可选候选草稿；不终止讨论">整理结论</button>
          <span class="grow"></span>
          <button type="button" class="btn ${d.status === 'archived' ? 'primary' : ''}" id="ocArchive" ${state.reading ? 'disabled' : ''}>${d.status === 'archived' ? '继续讨论' : '归档讨论'}</button>
        </div>
      </header>
      <nav class="tabs drawer-tabs" role="tablist" aria-label="讨论详情分区">
        <button type="button" class="tab drawer-tab${tab === 'minutes' ? ' active' : ''}" role="tab" aria-selected="${tab === 'minutes' ? 'true' : 'false'}" data-tab="minutes">讨论纪要${d.minutes?.stale ? ' · 待更新' : ''}</button>
        <button type="button" class="tab drawer-tab${tab === 'rounds' ? ' active' : ''}" role="tab" aria-selected="${tab === 'rounds' ? 'true' : 'false'}" data-tab="rounds">交流记录${d.roundCount ? ` (${d.roundCount})` : ''}</button>
        <button type="button" class="tab drawer-tab${tab === 'actions' ? ' active' : ''}" role="tab" aria-selected="${tab === 'actions' ? 'true' : 'false'}" data-tab="actions">后续行动${draftsCount ? ` (${draftsCount})` : ''}</button>
      </nav>
      <div class="drawer-body">
        <div id="ocNotice" class="${notice.cls}" role="status" aria-live="polite">${esc(notice.text)}
          ${d.outcome && d.outcome.state === 'error' ? ' <button type="button" class="btn small" id="ocReread">重新读取纪要</button>' : ''}
        </div>
        ${promptHtml(promptText)}
        <section class="drawer-pane disc-pane${tab === 'minutes' ? '' : ' hidden'}" data-pane="minutes" role="tabpanel" aria-label="讨论纪要">${minutesHtml(d)}</section>
        <section class="drawer-pane disc-pane${tab === 'rounds' ? '' : ' hidden'}" data-pane="rounds" role="tabpanel" aria-label="交流记录">${roundsHtml(d)}</section>
        <section id="ocPane" class="drawer-pane disc-pane${tab === 'actions' ? '' : ' hidden'}" data-pane="actions" role="tabpanel" aria-label="后续行动">${draftsHtml(d, createdIds)}</section>
      </div>`;
    linkupDiscImages(wrap, d.id); // REQ-20260910-028：讨论背景相对截图接管（旧讨论无图不受影响）
    wrap.querySelector('#ocBack')?.addEventListener('click', closeDetail);
    // 旧绑定需求：跳回需求详情（REQ-20260908-022 兼容，新讨论不再绑定）
    wrap.querySelector('#ocGotoReq')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('atb:open-req', { detail: { id: d.reqId } }));
    });
    wrap.querySelector('#ocStart')?.addEventListener('click', () => {
      state.prompt = { kind: 'start' };
      renderDetail();
    });
    // 整理结论：展示整理提示词（不终止讨论、不是交流保存的前提，纯前端生成）
    wrap.querySelector('#ocOrganize')?.addEventListener('click', doOrganize);
    // 复制继续讨论提示词：直接复制并反馈（不展开提示词块）
    wrap.querySelector('#ocCopyContinue')?.addEventListener('click', async () => {
      const ok = await copyPlain(d.continuePrompt || '');
      toast(ok ? '✓ 继续讨论提示词已复制：粘贴到任意能访问本项目文档的 Agent 会话即可接续同一讨论' : '剪贴板不可用：请点「启动提示词」展开后手动选择复制', !ok);
    });
    wrap.querySelector('#ocArchive')?.addEventListener('click', doArchiveToggle);
    wrap.querySelector('#ocReread')?.addEventListener('click', doReread);
    wrap.querySelector('#ocHidePrompt')?.addEventListener('click', () => {
      state.prompt = null; // 收起 = 清除提示词展示（当前页签保持）
      renderDetail();
    });
    wrap.querySelector('#ocCopyPrompt')?.addEventListener('click', async () => {
      const ok = await copyPlain(promptText || '', wrap.querySelector('#ocPromptText'));
      toast(ok ? '✓ 提示词已复制，请粘贴到 Agent 会话' : '剪贴板不可用：已全选提示词，请按 ⌘C / Ctrl+C 手动复制', !ok);
    });
    for (const b of wrap.querySelectorAll('[data-tab]')) {
      b.addEventListener('click', () => {
        state.tab = b.dataset.tab;
        renderDetail();
        emitState(); // REQ-20260910-001：详情页签变化通知 app.js 落盘快照
      });
    }
    if (tab === 'actions') bindDrafts(d, createdIds);
    for (const img of wrap.querySelectorAll('[data-lightbox]')) {
      img.addEventListener('click', () => {
        const box = $('#oncallLightbox');
        if (!box) return;
        box.querySelector('img').src = img.dataset.lightbox;
        box.classList.remove('hidden');
      });
    }
  }

  /* ---------- 背景与纪要 / 逐轮交流记录（REQ-20260910-018） ---------- */

  function legacyRoundsHtml(d) {
    const rounds = d.legacyRounds || [];
    if (!rounds.length) return '';
    return `
      <section class="disc-legacy">
        <h4>历史问答（旧版看板代答记录，只读保留；旧单无逐轮记录，不补造）</h4>
        ${rounds.map((r) => `
          <section class="oncall-round">
            <header class="oncall-round-head"><span class="chip">第 ${r.no} 轮</span>${r.mode ? `<span class="chip oc-mode">${esc(r.mode)}</span>` : ''}</header>
            ${r.question ? `<div class="oncall-q md">${renderMd(r.question)}</div>` : ''}
            ${(r.attachments || []).map((name) => `
              <figure class="oncall-fig">
                <img src="${apiUrl(`/api/oncall/ticket/${encodeURIComponent(d.id)}/attachment/${encodeURIComponent(name)}`)}" alt="附件 ${esc(name)}" data-lightbox="${apiUrl(`/api/oncall/ticket/${encodeURIComponent(d.id)}/attachment/${encodeURIComponent(name)}`)}" loading="lazy">
                <figcaption class="muted small">${esc(name)}（点击放大）</figcaption>
              </figure>`).join('')}
            ${r.answer ? `<div class="oncall-a md">${renderMd(r.answer)}</div>` : ''}
          </section>`).join('')}
      </section>`;
  }

  function minutesHtml(d) {
    const m = d.minutes || {};
    let minutesBody;
    if (state.reading) minutesBody = '<p class="muted">读取中……</p>';
    else if (m.content && String(m.content).trim()) minutesBody = `<div class="md">${renderMd(m.content)}</div>`;
    else minutesBody = '<p class="muted">尚无纪要：交流记录已逐轮保存，可点「整理结论」生成整理提示词重整纪要。</p>';
    // 纪要落后于最新轮次：显示待更新徽标（纪要可从逐轮记录重新整理）
    const staleBadge = m.stale ? '<span class="chip oc-failed" title="纪要落后于最新已保存轮次">⚠ 纪要待更新</span>' : '';
    return `
      <section class="disc-paper">
        <h4>讨论背景</h4>
        <div class="md">${d.background && d.background.trim() ? renderMd(d.background) : '<p class="muted">（未填写背景）</p>'}</div>
        <h4>讨论纪要 ${staleBadge}</h4>
        ${minutesBody}
      </section>`;
  }

  // 单轮渲染：用户原文 + 回复总结 + 时间 + 稳定轮次标识 + 来源会话（长内容随区块自然展开阅读）
  function roundHtml(r, isLatest = false) {
    return `
      <article class="disc-round${isLatest ? ' latest' : ''}" id="round-${esc(r.roundId)}">
        <header class="oncall-round-head">
          <span class="chip">第 ${r.no} 轮 · ${esc(r.roundId)}</span>
          ${isLatest ? '<span class="chip oc-mode">最新</span>' : ''}
          <span class="muted small">${fmtTime(r.at)}${r.session ? ` · 来源会话 ${esc(r.session)}` : ''}</span>
        </header>
        <div class="oncall-q md"><p class="muted small">用户原文</p>${renderMd(r.user)}</div>
        <div class="oncall-a md"><p class="muted small">回复总结</p>${renderMd(r.summary)}</div>
      </article>`;
  }

  // 交流记录：按时间从早到晚；历史轮次可折叠，最新轮常驻展开（定位最新）；
  // 空态说明尚无已保存交流；旧单历史问答只读保留（不伪造逐轮记录）。
  function roundsHtml(d) {
    const rounds = d.rounds || [];
    if (!rounds.length) {
      return `
      <div class="disc-empty-rounds">
        <p>尚无已保存交流：复制「启动提示词」到 Agent 会话开始讨论，每轮（用户原文 + 回复总结）将逐轮保存并在此展示。</p>
        <p class="muted small">补充、纠正与确认也算一轮；工具调用与进度播报不单独计轮；旧讨论的轮次编号自动接续。</p>
      </div>
      ${legacyRoundsHtml(d)}`;
    }
    const latest = rounds[rounds.length - 1];
    const earlier = rounds.slice(0, -1);
    return `
      <section class="disc-rounds">
        ${earlier.length ? `
        <details class="disc-rounds-history">
          <summary>历史轮次（${earlier.length} 轮，点击展开）</summary>
          ${earlier.map((r) => roundHtml(r)).join('')}
        </details>` : ''}
        ${roundHtml(latest, true)}
      </section>
      ${legacyRoundsHtml(d)}`;
  }

  /* ---------- 生成需求 / Bug（候选草稿与已创建成果） ---------- */

  function createdHtml(d) {
    const created = d.created || [];
    if (!created.length) return '';
    return `
      <section class="disc-created">
        <h4>已创建成果（待接受；不可重复创建）</h4>
        ${created.map((c) => `
          <div class="disc-draft created">
            <div class="card-top">
              <span class="chip">${ITEM_TYPE_LABEL[c.type] || esc(c.type)}</span>
              <strong>${esc(c.itemTitle || c.title)}</strong>
            </div>
            <p class="small ${c.missing ? 'result-fail' : 'result-ok'}">
              ${c.missing ? `${esc(c.itemId)} · 条目已删除（记录保留）` : `<span class="cid link" data-goto-item="${esc(c.itemId)}" role="button" title="跳转条目详情">${esc(c.itemId)}</span> · ${esc(itemStatusLabel(c.itemStatus))} · 来源 ${esc(d.id)}`}
            </p>
            ${c.missing ? '' : '<button type="button" class="btn small" data-jump-item="' + esc(c.itemId) + '">跳转条目详情</button>'}
          </div>`).join('')}
      </section>`;
  }

  function itemStatusLabel(status) {
    const M = { submitted: '待接受', accepted: '已接受', planned: '已计划', 'pending-alignment': '待对齐', 'in-progress': '开发中', done: '已完成' };
    return M[status] || status || '—';
  }

  function draftsHtml(d, createdIds) {
    const drafts = (d.candidates || []).filter((x) => !createdIds.has(x.id));
    const created = createdHtml(d);
    if (!drafts.length) {
      return created || `
        <div class="disc-empty-drafts">
          <p>当前没有候选条目。纪要可以只有结论，不必生成需求或 Bug。</p>
          <p class="muted small">（零候选为正常空态；归档无须以生成条目为前提）</p>
        </div>`;
    }
    return `
      ${created}
      <section class="disc-drafts">
        ${drafts.map((dr) => {
          const e = editOf(d, dr);
          const res = state.createResults?.[draftKey(d.id, dr.id)];
          const disabled = state.creating ? 'disabled' : '';
          return `
          <div class="disc-draft" data-draft="${esc(dr.id)}">
            <label class="disc-draft-check">
              <input type="checkbox" data-field="selected" ${e.selected ? 'checked' : ''} ${disabled}>
              <span>创建${ITEM_TYPE_LABEL[dr.type] || esc(dr.type)}${dr.type === 'bug' ? '（含复现 / 实际 / 预期）' : ''}</span>
            </label>
            <p class="muted small">类型：${ITEM_TYPE_LABEL[dr.type] || esc(dr.type)} · 由纪要草稿生成，未经确认不会自动创建</p>
            <label class="field">标题<input type="text" data-field="title" value="${esc(e.title)}" maxlength="120" ${disabled}></label>
            <label class="field">描述 / 现象<textarea rows="3" data-field="description" ${disabled}>${esc(e.description)}</textarea></label>
            ${dr.type === 'bug' ? `
              <label class="field">复现步骤<textarea rows="2" data-field="repro" ${disabled}>${esc(e.repro)}</textarea></label>
              <label class="field">实际结果<input type="text" data-field="actual" value="${esc(e.actual)}" ${disabled}></label>
              <label class="field">预期结果<input type="text" data-field="expected" value="${esc(e.expected)}" ${disabled}></label>` : ''}
            <label class="field">验收标准<textarea rows="2" data-field="acceptance" ${disabled}>${esc(e.acceptance)}</textarea></label>
            ${res && !res.ok ? `<p class="result-fail small">创建失败：${esc(res.error || '未知原因')}</p><button type="button" class="btn small" data-retry="${esc(dr.id)}">重试此项</button>` : ''}
          </div>`;
        }).join('')}
        <button type="button" class="btn primary" id="ocCreate" ${state.creating ? 'disabled' : ''}>${state.creating ? '创建中……' : '创建勾选的条目'}</button>
      </section>`;
  }

  function bindDrafts(d, createdIds) {
    const wrap = $('#ocPane');
    if (!wrap) return;
    for (const el of wrap.querySelectorAll('[data-draft] [data-field]')) {
      const key = draftKey(d.id, el.closest('[data-draft]').dataset.draft);
      const field = el.dataset.field;
      const apply = () => {
        state.draftEdits[key] = state.draftEdits[key] || {};
        state.draftEdits[key][field] = el.type === 'checkbox' ? el.checked : el.value;
      };
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', apply);
      if (el.type !== 'checkbox') {
        el.addEventListener('blur', () => {
          apply();
          if (state.pendingRefresh) {
            state.pendingRefresh = false;
            renderView(); // 编辑期间被跳过的整体重绘（筛选计数/详情）在失焦后补上
            refreshDetail({ force: true });
          }
        });
      }
    }
    wrap.querySelector('#ocCreate')?.addEventListener('click', () => {
      const drafts = (d.candidates || []).filter((x) => !createdIds.has(x.id));
      doCreate(drafts);
    });
    for (const b of wrap.querySelectorAll('[data-retry]')) {
      b.addEventListener('click', () => {
        const dr = (d.candidates || []).find((x) => x.id === b.dataset.retry);
        if (dr) doCreate([dr]);
      });
    }
    for (const b of wrap.querySelectorAll('[data-jump-item], [data-goto-item]')) {
      const id = b.dataset.jumpItem || b.dataset.gotoItem;
      b.addEventListener('click', () => gotoItem(id));
    }
  }

  // 跳转条目详情：派发自定义事件由 app.js 打开需求模块条目抽屉（双向关联的条目侧入口）
  function gotoItem(itemId) {
    window.dispatchEvent(new CustomEvent('atb:open-item', { detail: { id: itemId } }));
  }

  // 整理结论（原「讨论完毕」，REQ-20260910-018）：生成整理提示词重整纪要与可选候选草稿；
  // 纯前端展示，不改变状态、不终止讨论、不是交流保存的前提。
  function doOrganize() {
    const d = state.detail;
    if (!d) return;
    state.prompt = { kind: 'organize' };
    renderDetail();
    toast('已生成整理结论提示词：复制到 Agent 会话重整纪要与可选候选草稿；整理不终止讨论。');
  }

  function doArchiveToggle() {
    const d = state.detail;
    if (!d) return;
    const action = d.status === 'archived' ? 'resume' : 'archive';
    api(`/api/discussion/${encodeURIComponent(d.id)}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then((res) => {
        state.detail = res.discussion;
        state.filter = res.discussion.status; // 归档/恢复后筛选跟随
        emitState(); // REQ-20260910-001：筛选跟随变化通知 app.js 落盘快照
        renderView();
        toast(res.discussion.status === 'archived'
          ? '讨论已归档（无须先生成条目）；纪要与已创建成果仍保留展示。'
          : '讨论已恢复「讨论中」；此前纪要与已生成条目不丢失。');
        poll(state.project, true);
      })
      .catch((e) => toast(e.message, true));
  }

  function doReread() {
    const id = state.selectedId;
    if (!id) return;
    api(`/api/discussion/${encodeURIComponent(id)}/reread`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(() => refreshDetail({ force: true, loading: true }))
      .catch((e) => toast(e.message, true));
  }

  function doCreate(drafts) {
    const d = state.detail;
    if (!d || state.creating) return;
    const payload = [];
    const problems = [];
    for (const dr of drafts) {
      const e = editOf(d, dr);
      if (!e.selected) continue;
      if (!e.title.trim() || !e.description.trim()) {
        problems.push(`「${dr.title || dr.id}」的标题与描述为必填`);
        continue;
      }
      payload.push({
        id: dr.id, type: dr.type, title: e.title.trim(), description: e.description,
        repro: e.repro, actual: e.actual, expected: e.expected, acceptance: e.acceptance,
      });
    }
    if (problems.length) {
      toast(`请先补全勾选条目的必填字段：${problems.join('；')}`, true);
      if (!payload.length) return;
    }
    if (!payload.length) {
      toast('请先勾选候选条目。');
      return;
    }
    state.creating = true;
    renderDetail();
    api(`/api/discussion/${encodeURIComponent(d.id)}/create-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: payload }),
    })
      .then((res) => {
        state.creating = false;
        state.detail = res.discussion;
        state.createResults = Object.fromEntries((res.results || []).map((r) => [draftKey(d.id, r.draftId), r]));
        state.tab = 'actions'; // 创建完成后回到「后续行动」分区
        renderDetail();
        const ok = (res.results || []).filter((r) => r.ok).length;
        const fail = (res.results || []).length - ok;
        toast(fail
          ? `创建完成：成功 ${ok} 条，失败 ${fail} 条；失败项可单独重试，成功项不会重复创建。`
          : `创建完成：成功 ${ok} 条，均为待接受；刷新或重试不会重复创建。`, fail > 0);
        poll(state.project, true);
      })
      .catch((e) => {
        state.creating = false;
        toast(`创建失败：${e.message}`, true);
        renderDetail();
      });
  }

  // 创建成功后定位新讨论（app.js 统一新建入口调用）：选中并展示启动提示词（页签行下折叠块）
  async function reveal(id) {
    state.filter = 'discussing';
    await poll(state.project, true);
    if (state.selectedId !== id) openItem(id);
    state.prompt = { kind: 'start' };
    renderDetail();
  }

  /* ---------- 轮询（由 app.js 主循环在 view=oncall 时驱动） ---------- */

  async function poll(project, force = false) {
    state.project = project || state.project;
    if (project) state.project = project;
    try {
      const b = await api('/api/discussion/board');
      const sig = JSON.stringify([b.initialized, b.discussions]);
      if (!force && sig === state.boardSig) {
        if (state.selectedId && !detailEditing()) await refreshDetail();
        else if (state.selectedId) state.pendingRefresh = true;
        return;
      }
      state.board = b;
      state.boardSig = sig;
      if (detailEditing()) {
        // 草稿编辑中：只更新列表行（不重建详情 DOM，避免打断输入）；失焦后再整体重绘
        renderList();
        state.pendingRefresh = true;
        return;
      }
      renderView();
      if (state.selectedId) await refreshDetail();
    } catch {
      /* 主轮询已有离线指示 */
    }
  }

  function init() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const lb = $('#oncallLightbox');
      if (lb && !lb.classList.contains('hidden')) {
        lb.classList.add('hidden');
        return;
      }
      if (state.selectedId) closeDetail();
    });
    $('#oncallLightbox')?.addEventListener('click', () => $('#oncallLightbox').classList.add('hidden'));
  }
  init();

  // app.js 挂钩：poll / setQuery（主循环与搜索）、reveal（统一新建定位）、openItem（跨模块跳入）、
  // snapshot / restoreView（REQ-20260910-001 刷新恢复：读取快照与刷新后落位）
  return { poll, closeDrawer, setQuery, searchStats, openItem, reveal, snapshot, restoreView };
})();

window.ATBOncall = ATBOncall;
