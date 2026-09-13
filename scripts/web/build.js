'use strict';
// 构建模块前端（REQ-20260913-001，版本管理 + 分支浏览与同步）—— 由 app.js 在 view=build 时激活。
// 界面：模块内两个子页签——版本计划（默认）：左版本列表 + 右版本详情（信息编辑 / 条目 ↔ commit 关联
// 与增删 / 提示词与回答回填 / 合并入 main）；分支浏览：左分支列表（当前 / 本地 / 远端分组）+ 右提交记录。
// 语义边界（与后端一致，design.md 落定口径）：
//   - 仅已完成（done）的需求单 / Bug 单可纳入版本（BUG-20260913-001）：新建版本 / 添加条目
//     候选只列 done 条目（后端接口已收窄，前端再过滤一次防御旧数据）；无候选时给明确空态；
//   - 新建版本 / 添加条目走右侧侧拉面板：选单支持全选 / 全不选（全选只纳入有 commit 候选的条目）；
//   - 「提示词与回答回填」为同一弹窗两段式：上段复制提示词、下段粘贴回答解析回填，无需关闭再打开；
//   - 合并入 main 前弹确认框（列 commit 清单），确认即授权；执行中禁用重复触发；
//   - 分支浏览只读；同步仅「同步远端（fetch --prune）」与本地分支「推送」两个显式入口；
//   - 非 git 仓库显示引导空态，不出现可点击但必然失败的入口。
// 状态机：loading → ready | error（读取失败重试）。

const ATBBuild = (() => {
  const $ = (s, el = document) => el.querySelector(s);

  const STATUS_LABEL = { draft: '计划中', merging: '合并中', merged: '已合并', failed: '失败' };
  const STATUS_CLS = { draft: 'st-mute', merging: 'st-run', merged: 'st-ok', failed: 'st-fail' };
  const TABS = [['versions', '版本计划'], ['branches', '分支浏览']];
  const HASH_RE = /^[0-9a-f]{40}$/i;

  const state = {
    project: null,
    phase: 'loading', // loading | ready | error
    error: null,
    data: null,          // /api/build/state 响应 { initialized, isRepo, currentBranch, versions }
    tab: 'versions',
    query: '',
    selVerId: null,
    edit: null,          // { id, field: 'name'|'desc' } 行内编辑态
    createPanel: null,   // { candidates, picked:Set, commits:{itemId:hash}, name, busy, error }
    addPanel: null,      // { verId, candidates, picked:Set, commits:{itemId:hash}, busy, error }
    answer: null,        // { verId, text, parsed, error, busy }  提示词与回答回填弹窗
    mergeConfirm: null,  // { verId }
    pushConfirm: null,   // { branch }
    mergeBusy: false,
    branches: null,      // /api/build/branches 响应
    branchesPhase: 'idle', // idle | loading | error
    branchesError: null,
    logBranch: null,
    branchLog: null,     // { branch, commits }
    logPhase: 'idle',
    syncBusy: false,
    pushBusy: false,
    rendered: false,
    pendingRestore: null,
  };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtTime = (iso) => (iso ? String(iso).replace('T', ' ').slice(0, 16) : '—');
  const short = (h) => String(h || '').slice(0, 8);
  const toast = (m) => { try { if (typeof window !== 'undefined' && window.toast) window.toast(m); } catch { /* 测试环境无 toast */ } };

  function api(path, opts = {}) {
    const sep = path.includes('?') ? '&' : '?';
    const project = state.project ? `${sep}project=${encodeURIComponent(state.project)}` : '';
    return fetch(`/api/build${path}${project}`, opts);
  }
  const post = (path, body) => api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const errOf = async (r, fallback) => {
    const data = await r.json().catch(() => ({}));
    return data.error || `${fallback}（${r.status}）`;
  };

  /* ---------- 纯函数（导出供测试与面板复用） ---------- */

  // BUG-20260913-001 口径：仅已完成（done）条目可纳入版本——候选接口已在后端收窄，
  // 前端再过滤一次防御旧缓存 / 混杂数据，保证界面与数据口径一致。
  function doneCandidates(items) {
    return (items || []).filter((x) => x.status === 'done');
  }

  // 全选口径：只纳入有 commit 候选的条目（无提交条目自动跳过并提示）
  function selectableCandidates(items) {
    return (items || []).filter((x) => Array.isArray(x.commits) && x.commits.length > 0);
  }

  function buildPrompt(v) {
    const lines = [];
    lines.push(`请为看板版本 ${v.id} 生成「版本名称」与「版本描述」。`);
    lines.push(`当前信息：名称「${v.name || '（空）'}」；描述「${v.description || '（空）'}」。`);
    lines.push('关联条目：');
    for (const it of v.items || []) lines.push(`- ${it.itemId} ${it.title || ''}（commit ${short(it.commit)}）`);
    lines.push('请综合以上条目给出更完整的版本名称与描述；只按以下格式回答，不要附加其他内容：');
    lines.push('版本名称：<一行>');
    lines.push('版本描述：<可多行>');
    return lines.join('\n');
  }

  // 解析 Agent 回答（约定：以「版本名称：」「版本描述：」起行；名称必含，描述可空）
  function parseAnswer(text) {
    const raw = String(text || '');
    const nameM = raw.match(/(?:^|\n)\s*版本名称\s*[:：]\s*(.*)/);
    if (!nameM) {
      return { ok: false, error: '未解析到「版本名称：」行：请检查回答是否按提示词约定格式（版本名称：… / 版本描述：…），或关闭弹窗改用手动编辑。' };
    }
    const descM = raw.match(/(?:^|\n)\s*版本描述\s*[:：]\s*\n?([\s\S]*)/);
    return {
      ok: true,
      name: nameM[1].trim(),
      description: descM ? descM[1].replace(/\s+$/, '') : '',
    };
  }

  /* ---------- 数据 ---------- */

  async function refresh() {
    try {
      const r = await api('/state');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      state.data = data;
      state.phase = 'ready';
      state.error = null;
      // 选中版本失效回落：无选中或已删除 → 取列表最新（缓存仍在时恢复浏览态）
      const ids = new Set((data.versions || []).map((v) => v.id));
      if (!state.selVerId || !ids.has(state.selVerId)) {
        state.selVerId = (data.versions || [])[0]?.id || null;
      }
    } catch (e) {
      state.phase = state.data ? 'ready' : 'error';
      state.error = e.message;
    }
    render();
  }

  async function enter(project) {
    const changed = project !== state.project;
    if (changed) {
      Object.assign(state, {
        project: project ?? null, phase: 'loading', error: null, data: null, tab: 'versions',
        selVerId: null, edit: null, createPanel: null, addPanel: null, answer: null,
        mergeConfirm: null, pushConfirm: null, mergeBusy: false,
        branches: null, branchesPhase: 'idle', branchesError: null,
        logBranch: null, branchLog: null, logPhase: 'idle', syncBusy: false, pushBusy: false,
        rendered: false, pendingRestore: state.pendingRestore,
      });
      render(); // 拉取前先呈现加载态
    }
    if (!state.data || changed) {
      await refresh();
      if (state.pendingRestore && state.phase === 'ready') {
        applyPendingRestore();
        render();
      }
      return;
    }
    if (!state.rendered) render();
  }

  async function loadBranches() {
    state.branchesPhase = 'loading';
    state.branchesError = null;
    render();
    try {
      const r = await api('/branches');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      state.branches = data;
      state.branchesPhase = 'idle';
    } catch (e) {
      state.branchesPhase = 'error';
      state.branchesError = e.message;
    }
    render();
  }

  async function selectBranch(branch) {
    state.logBranch = branch;
    state.logPhase = 'loading';
    render();
    try {
      const r = await api(`/branch-log?branch=${encodeURIComponent(branch)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      state.branchLog = data;
      state.logPhase = 'idle';
    } catch (e) {
      state.branchLog = null;
      state.logPhase = 'error';
      state.logError = e.message;
    }
    render();
  }

  /* ---------- 版本计划：创建 / 编辑 / 条目 ---------- */

  async function openCreatePanel() {
    state.createPanel = { candidates: null, picked: new Set(), commits: {}, name: '', busy: false, error: null, loadError: null };
    render();
    try {
      const r = await api('/candidates');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      state.createPanel.candidates = doneCandidates(data.items || []); // BUG-20260913-001：仅 done 条目进候选
      for (const it of selectableCandidates(state.createPanel.candidates)) {
        state.createPanel.commits[it.itemId] = it.commits[0]; // 默认取最近一次关联提交
      }
    } catch (e) {
      state.createPanel.loadError = e.message;
    }
    render();
  }

  function pickItem(panelKey, itemId, on) {
    const p = state[panelKey];
    if (!p) return;
    if (on) p.picked.add(itemId); else p.picked.delete(itemId);
    render();
  }

  // 全选 / 全不选：仅对「有 commit 候选」的条目生效；返回跳过的无提交条目数
  function pickAll(panelKey, on) {
    const p = state[panelKey];
    if (!p || !p.candidates) return 0;
    const selectable = selectableCandidates(p.candidates);
    for (const it of selectable) {
      if (on) p.picked.add(it.itemId); else p.picked.delete(it.itemId);
    }
    return p.candidates.length - selectable.length;
  }

  function setPanelCommit(panelKey, itemId, commit) {
    const p = state[panelKey];
    if (p && HASH_RE.test(String(commit || ''))) p.commits[itemId] = commit;
    render();
  }

  async function submitCreate() {
    const p = state.createPanel;
    if (!p) return;
    const items = [...p.picked].map((itemId) => ({ itemId, commit: p.commits[itemId] }));
    if (!items.length) {
      p.error = '请至少勾选一个条目（无关联 commit 的条目不可纳入版本）';
      render();
      return;
    }
    p.busy = true;
    p.error = null;
    render();
    try {
      const r = await post('/version', { name: p.name, items });
      if (!r.ok) throw new Error(await errOf(r, '创建失败'));
      state.createPanel = null;
      state.selVerId = null; // refresh 后自动选中最新（即刚创建的）
      toast('✓ 版本计划已创建');
      await refresh();
    } catch (e) {
      p.busy = false;
      p.error = e.message;
      render();
    }
  }

  function selVersion() {
    return (state.data?.versions || []).find((v) => v.id === state.selVerId) || null;
  }

  async function saveInfo(id, patch) {
    try {
      const r = await post('/version/save', { id, ...patch });
      if (!r.ok) throw new Error(await errOf(r, '保存失败'));
      toast('✓ 已保存版本信息');
      await refresh();
      return true;
    } catch (e) {
      toast(`✕ 保存失败：${e.message}`);
      return false;
    }
  }

  async function itemAction(action, payload) {
    const v = selVersion();
    if (!v) return;
    try {
      const r = await post('/version/items', { id: v.id, action, ...payload });
      if (!r.ok) throw new Error(await errOf(r, '操作失败'));
      toast(action === 'remove' ? '✓ 已移出条目' : action === 'add' ? '✓ 已添加条目' : '✓ 已更新 commit 关联');
      await refresh();
    } catch (e) {
      toast(`✕ ${e.message}`);
    }
  }

  async function openAddPanel() {
    const v = selVersion();
    if (!v) return;
    state.addPanel = { verId: v.id, candidates: null, picked: new Set(), commits: {}, busy: false, error: null, loadError: null };
    render();
    try {
      const r = await api('/candidates');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      const have = new Set(v.items.map((x) => x.itemId));
      // BUG-20260913-001：与新建版本同口径——仅 done 条目进候选，且排除已在本版本中的条目
      state.addPanel.candidates = doneCandidates(data.items || []).filter((x) => !have.has(x.itemId));
      for (const it of selectableCandidates(state.addPanel.candidates)) {
        state.addPanel.commits[it.itemId] = it.commits[0];
      }
    } catch (e) {
      state.addPanel.loadError = e.message;
    }
    render();
  }

  async function submitAdd() {
    const p = state.addPanel;
    if (!p) return;
    const items = [...p.picked].map((itemId) => ({ itemId, commit: p.commits[itemId] }));
    if (!items.length) {
      p.error = '请至少勾选一个条目（无关联 commit 的条目不可纳入版本）';
      render();
      return;
    }
    p.busy = true;
    p.error = null;
    render();
    try {
      const r = await post('/version/items', { id: p.verId, action: 'add', items });
      if (!r.ok) throw new Error(await errOf(r, '添加失败'));
      state.addPanel = null;
      toast('✓ 已添加条目');
      await refresh();
    } catch (e) {
      p.busy = false;
      p.error = e.message;
      render();
    }
  }

  /* ---------- 提示词与回答回填（同一弹窗两段式） ---------- */

  function openAnswerModal() {
    const v = selVersion();
    if (!v) return;
    state.answer = { verId: v.id, text: '', parsed: null, error: null, busy: false, copied: false };
    render();
  }

  async function copyPrompt() {
    const a = state.answer;
    if (!a) return;
    const v = selVersion();
    if (!v) return;
    const text = buildPrompt(v);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        a.copied = true;
        toast('✓ 提示词已复制，去 Agent 粘贴执行后把回答粘贴到下方');
        render();
        return;
      }
    } catch { /* 剪贴板不可用：降级为手动全选复制 */ }
    a.copied = false;
    toast('剪贴板不可用：请在提示词文本框中全选（⌘A）并手动复制');
    render();
  }

  function parseAnswerPreview() {
    const a = state.answer;
    if (!a) return;
    a.text = ($('.bld-answer-input', $('#buildView'))?.value) ?? a.text;
    const r = parseAnswer(a.text);
    if (!r.ok) {
      a.parsed = null;
      a.error = r.error; // 原文保留在输入框，可在弹窗内修改重试
    } else {
      a.parsed = r;
      a.error = null;
    }
    render();
  }

  async function applyParsed() {
    const a = state.answer;
    if (!a?.parsed) return;
    a.busy = true;
    render();
    const ok = await saveInfo(a.verId, { name: a.parsed.name, description: a.parsed.description });
    if (ok) {
      state.answer = null;
      toast('✓ 已应用回填：版本名称与描述已更新');
    } else {
      a.busy = false;
    }
    render();
  }

  /* ---------- 合并入 main ---------- */

  function openMergeConfirm() {
    const v = selVersion();
    if (!v || state.mergeBusy) return;
    state.mergeConfirm = { verId: v.id };
    render();
  }

  async function doMerge() {
    const v = selVersion();
    if (!v || state.mergeBusy) return;
    state.mergeConfirm = null;
    state.mergeBusy = true;
    render();
    try {
      const r = await post('/version/merge', { id: v.id });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `合并失败（${r.status}）`);
      if (data.version?.status === 'merged') toast(`✓ 已合并入 main（${v.id}）`);
      else toast(`✕ 合并失败：${data.version?.merge?.error || '详见版本详情'}`);
      if (data.version?.mergeWarnings?.length) toast(`⚠ ${data.version.mergeWarnings[0]}`);
    } catch (e) {
      toast(`✕ 合并失败：${e.message}`);
    } finally {
      state.mergeBusy = false;
      await refresh();
    }
  }

  /* ---------- 分支浏览与同步 ---------- */

  async function doFetch() {
    if (state.syncBusy) return;
    state.syncBusy = true;
    render();
    try {
      const r = await post('/fetch', {});
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `同步失败（${r.status}）`);
      toast('✓ 已同步远端（fetch --prune）');
      await loadBranches();
      if (state.logBranch) await selectBranch(state.logBranch);
    } catch (e) {
      toast(`✕ 同步远端失败：${e.message}`);
    } finally {
      state.syncBusy = false;
      render();
    }
  }

  function openPushConfirm(branch) {
    if (state.pushBusy) return;
    state.pushConfirm = { branch };
    render();
  }

  async function doPush() {
    const p = state.pushConfirm;
    if (!p || state.pushBusy) return;
    state.pushConfirm = null;
    state.pushBusy = true;
    render();
    try {
      const remote = $('.bld-push-remote', $('#buildView'))?.value || 'origin';
      const r = await post('/push', { remote, branch: p.branch });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `推送失败（${r.status}）`);
      toast(`✓ 已推送 ${p.branch} → ${data.remoteBranch || remote}${data.setUpstream ? '（已建立上游跟踪）' : ''}`);
      await loadBranches();
    } catch (e) {
      toast(`✕ 推送失败：${e.message}`);
    } finally {
      state.pushBusy = false;
      render();
    }
  }

  /* ---------- 搜索 / 快照 ---------- */

  function filteredVersions() {
    const q = state.query.trim().toLowerCase();
    const versions = state.data?.versions || [];
    if (!q) return versions;
    return versions.filter((v) => `${v.id} ${v.name} ${(v.items || []).map((x) => x.itemId).join(' ')}`.toLowerCase().includes(q));
  }

  function setQuery(q) {
    state.query = String(q || '');
    render();
  }

  function searchStats() {
    const q = state.query.trim().toLowerCase();
    const all = state.data?.versions || [];
    if (!q) return null;
    return { matched: filteredVersions().length, total: all.length };
  }

  function snapshot() {
    return { tab: state.tab, selVerId: state.selVerId, logBranch: state.logBranch };
  }

  function restoreView(snap) {
    state.pendingRestore = snap && typeof snap === 'object' ? snap : null;
  }

  function applyPendingRestore() {
    const snap = state.pendingRestore;
    if (!snap) return;
    if (TABS.some(([k]) => k === snap.tab)) state.tab = snap.tab;
    const known = (state.data?.versions || []).some((v) => v.id === snap.selVerId);
    state.selVerId = known ? snap.selVerId : null;
    state.logBranch = typeof snap.logBranch === 'string' ? snap.logBranch : null;
    state.pendingRestore = null;
    if (state.tab === 'branches' && !state.branches) loadBranches();
    if (state.logBranch) selectBranch(state.logBranch);
  }

  function setTab(t) {
    state.tab = TABS.some(([k]) => k === t) ? t : 'versions';
    if (state.tab === 'branches' && !state.branches && state.data?.isRepo) loadBranches();
    render();
  }

  /* ---------- 渲染 ---------- */

  function statusChip(status) {
    return `<span class="st ${STATUS_CLS[status] || 'st-mute'}">${esc(STATUS_LABEL[status] || status)}</span>`;
  }

  function renderVersionList() {
    const versions = filteredVersions();
    if (!versions.length) {
      return state.query.trim()
        ? '<div class="rel-empty-mini muted">没有匹配的版本（按名称 / 单号过滤）</div>'
        : '<div class="rel-empty-mini muted">暂无版本计划：点右上「＋ 新建版本」从需求单 / Bug 单创建</div>';
    }
    return versions.map((v) => `
      <div class="rel-card${v.id === state.selVerId ? ' sel' : ''}" data-ver-id="${esc(v.id)}" role="button" tabindex="0">
        <div class="t"><strong>${esc(v.name || v.id)}</strong> ${statusChip(v.status)}</div>
        <div class="meta">${esc(v.id)} · ${v.items.length} 个关联单 · 更新 ${esc(fmtTime(v.updatedAt))}</div>
      </div>`).join('');
  }

  function renderCandidateRows(p, panelKey, disabledIds) {
    return (p.candidates || []).map((it) => {
      const selectable = (it.commits || []).length > 0;
      const checked = p.picked.has(it.itemId) ? ' checked' : '';
      const dis = selectable ? '' : ' disabled';
      const commits = selectable
        ? `<select class="bld-commit-sel" data-panel="${panelKey}" data-item="${esc(it.itemId)}"${p.picked.has(it.itemId) ? '' : ' disabled'}>${(it.commits || []).map((h) => `<option value="${esc(h)}"${p.commits[it.itemId] === h ? ' selected' : ''}>${esc(short(h))}</option>`).join('')}</select>`
        : '<span class="muted small">暂无关联提交（先完成开发提交）</span>';
      return `<label class="check bld-cand${disabledIds?.has(it.itemId) ? ' off' : ''}">
        <input type="checkbox" data-pick="${panelKey}" data-item="${esc(it.itemId)}"${checked}${dis}>
        <span class="bld-cand-title">${esc(it.itemId)} ${esc(it.title || '')}</span>${commits}
      </label>`;
    }).join('');
  }

  function renderPanel(p, title, scope, footId, footLabel) {
    if (!p) return '';
    const skipped = p.candidates ? p.candidates.length - selectableCandidates(p.candidates).length : 0;
    return `
      <div class="rel-panel-mask" id="bldPanelMask"></div>
      <aside class="rel-panel" role="dialog" aria-label="${esc(title)}">
        <header class="rel-panel-head">
          <div class="rel-panel-title"><h3>${esc(title)}</h3><p class="side-panel-scope">${esc(scope)}</p></div>
          <button type="button" class="icon-btn" id="bldPanelClose" aria-label="关闭面板">✕</button>
        </header>
        <div class="rel-panel-body">
          ${p.loadError ? `<p class="rel-form-err" role="alert">${esc(p.loadError)} <button type="button" class="btn small" id="bldPanelRetry">重试</button></p>` : ''}
          ${!p.candidates ? '<p class="muted">正在读取条目…</p>'
            : p.candidates.length === 0 ? '<p class="muted bld-cand-empty">暂无可纳入版本的条目：仅已完成（done）的需求单 / Bug 单会出现在候选中</p>'
            : `
          <div class="bld-pick-bar">
            <button type="button" class="btn small" id="bldPickAll">全选</button>
            <button type="button" class="btn small" id="bldPickNone">全不选</button>
            <span class="muted small">已选 ${p.picked.size} 项${skipped ? ` · ${skipped} 个条目暂无关联提交将被跳过` : ''}</span>
          </div>
          ${renderCandidateRows(p, p === state.createPanel ? 'createPanel' : 'addPanel')}
          ${p === state.createPanel ? `<label class="field">版本名称（留空自动命名「版本 YYYYMMDD-HHMM」）
            <input id="bldNewName" value="${esc(p.name)}" placeholder="v1.0 / 2026-09 冲刺"></label>` : ''}
          ${p.error ? `<p class="rel-form-err" role="alert">${esc(p.error)}</p>` : ''}`}
        </div>
        <footer class="rel-panel-foot">
          <button type="button" class="btn primary" id="${footId}" ${p.busy || !p.candidates ? 'disabled' : ''}>${esc(footLabel)}</button>
        </footer>
      </aside>`;
  }

  function renderDetail(v) {
    if (!v) return '<div class="rel-detail muted">点击左侧版本查看详情</div>';
    const lockItems = ['merging', 'merged'].includes(v.status);
    const editing = state.edit && state.edit.id === v.id ? state.edit : null;
    const nameCell = editing?.field === 'name'
      ? `<div class="bld-edit-row"><input class="bld-name-input" value="${esc(v.name)}"><button type="button" class="btn small primary" id="bldSaveName">保存</button><button type="button" class="btn small" id="bldCancelEdit">取消</button></div>`
      : `<strong class="bld-name" title="点击编辑名称" role="button" tabindex="0">${esc(v.name || v.id)}</strong> ${statusChip(v.status)}`;
    const descCell = editing?.field === 'desc'
      ? `<div class="bld-edit-row"><textarea class="bld-desc-input" rows="3">${esc(v.description)}</textarea><button type="button" class="btn small primary" id="bldSaveDesc">保存</button><button type="button" class="btn small" id="bldCancelEdit">取消</button></div>`
      : `<span class="bld-desc" title="点击编辑描述" role="button" tabindex="0">${v.description ? esc(v.description) : '<span class="muted">（无描述，点击补充）</span>'}</span>`;
    const itemRows = v.items.map((it) => `
      <div class="bld-item-row" data-row-item="${esc(it.itemId)}">
        <span class="bld-item-id">${esc(it.itemId)}</span>
        <span class="bld-item-title" title="${esc(it.title || '')}">${esc(it.title || '')}</span>
        <select class="bld-commit-sel" data-commit-item="${esc(it.itemId)}" ${lockItems ? 'disabled' : ''}>
          <option value="${esc(it.commit)}">${esc(short(it.commit))}</option>
        </select>
        ${it.mergedAt ? `<span class="st st-ok" title="已合并入 main">✓</span>` : it.mergeError ? `<span class="st st-fail" title="${esc(it.mergeError)}">✕</span>` : ''}
        <button type="button" class="btn small quiet bld-item-remove" data-remove-item="${esc(it.itemId)}" ${lockItems ? 'disabled title="合并中/已合并状态锁定条目增删"' : 'title="移出该条目（连同 commit 关联）"'}>移出</button>
      </div>`).join('');
    const mergeState = v.status === 'merging'
      ? '<p class="muted small bld-merge-note">合并中，请稍候……（执行中已禁用重复触发与条目编辑）</p>'
      : v.status === 'failed' && v.merge?.error
        ? `<p class="rel-form-err bld-merge-note" role="alert">合并失败：${esc(v.merge.error)}（可重试，只补未合并条目）</p>`
        : '';
    return `
      <div class="rel-detail">
        <header class="rel-detail-head">
          <div>
            <h3>${nameCell}</h3>
            <p class="muted small">${esc(v.id)} · 目标分支 main${v.merge?.baseBranch ? ` · 来源分支 ${esc(v.merge.baseBranch)}` : ''} · 更新 ${esc(fmtTime(v.updatedAt))}</p>
          </div>
        </header>
        <div class="bld-desc-block"><span class="muted small">描述</span>${descCell}</div>
        <div class="bld-items">
          <div class="bld-items-head"><strong>关联条目与 commit</strong>
            <button type="button" class="btn small" id="bldAddItem" ${lockItems ? 'disabled title="合并中/已合并状态锁定条目增删"' : ''}>＋ 添加条目</button>
          </div>
          ${itemRows || '<p class="muted small">暂无条目：点「＋ 添加条目」纳入需求单 / Bug 单</p>'}
        </div>
        ${mergeState}
        <footer class="rel-acts">
          <button type="button" class="btn" id="bldAnswerBtn" ${v.status === 'merging' ? 'disabled' : ''} title="复制提示词给 Agent，回答直接粘贴回本弹窗自动解析">提示词与回答回填</button>
          <button type="button" class="btn primary" id="bldMergeBtn" ${v.status === 'merging' || v.status === 'merged' || state.mergeBusy ? `disabled title="${v.status === 'merged' ? '已合并入 main' : '合并中，请勿重复触发'}"` : ''}>${v.status === 'failed' ? '重试合并入 main' : '合并入 main'}</button>
        </footer>
      </div>`;
  }

  function renderAnswerModal() {
    const a = state.answer;
    if (!a) return '';
    const v = (state.data?.versions || []).find((x) => x.id === a.verId);
    return `
      <div class="rel-modal-wrap" id="bldAnswerWrap" role="dialog" aria-label="提示词与回答回填">
        <div class="rel-modal">
          <h3>提示词与回答回填（${esc(v?.id || '')}）</h3>
          <div class="rel-modal-body">
            <p class="muted small">上段：复制提示词交给 Agent；下段：把回答粘贴回来，解析预览后应用——全程无需关闭本弹窗。</p>
            <div class="bld-prompt-box">
              <textarea class="bld-prompt-text" rows="7" readonly>${esc(v ? buildPrompt(v) : '')}</textarea>
              <button type="button" class="btn small primary" id="bldCopyPrompt">复制提示词</button>
              ${a.copied ? '<span class="muted small">已复制 ✓</span>' : ''}
            </div>
            <div class="bld-answer-box">
              <label class="field">Agent 回答（粘贴后点「解析并预览」）
                <textarea class="bld-answer-input" rows="5" placeholder="版本名称：…&#10;版本描述：…">${esc(a.text)}</textarea></label>
              ${a.error ? `<p class="rel-form-err" role="alert">${esc(a.error)}</p>` : ''}
              ${a.parsed ? `<div class="bld-preview">
                <div><span class="muted small">名称</span>：${esc(v?.name || '（空）')} → <strong>${esc(a.parsed.name)}</strong></div>
                <div><span class="muted small">描述</span>：${esc(v?.description || '（空）')} → <strong>${esc(a.parsed.description || '（空）')}</strong></div>
              </div>` : ''}
            </div>
          </div>
          <footer class="modal-foot">
            <button type="button" class="btn" id="bldAnswerClose">关闭</button>
            <button type="button" class="btn" id="bldParseBtn" ${a.busy ? 'disabled' : ''}>解析并预览</button>
            <button type="button" class="btn primary" id="bldApplyBtn" ${a.busy || !a.parsed ? 'disabled' : ''}>应用</button>
          </footer>
        </div>
      </div>`;
  }

  function renderMergeConfirm() {
    const m = state.mergeConfirm;
    if (!m) return '';
    const v = (state.data?.versions || []).find((x) => x.id === m.verId);
    if (!v) { state.mergeConfirm = null; return ''; }
    return `
      <div class="rel-modal-wrap" id="bldMergeWrap" role="dialog" aria-label="合并入 main 确认">
        <div class="rel-modal">
          <h3>合并入 main 确认（${esc(v.id)}）</h3>
          <div class="rel-modal-body">
            <p>将把以下提交逐条合并入 <strong>main</strong>（--no-ff，在临时工作树执行，不影响当前分支与未提交改动）：</p>
            <ul>${v.items.map((it) => `<li>${esc(it.itemId)} ${esc(short(it.commit))} ${esc(it.title || '')}</li>`).join('')}</ul>
            <p class="muted small">确认即授权本合并计划；合并中不可重复触发或增删条目。</p>
          </div>
          <footer class="modal-foot">
            <button type="button" class="btn" id="bldMergeCancel">取消</button>
            <button type="button" class="btn primary" id="bldMergeGo">确认合并</button>
          </footer>
        </div>
      </div>`;
  }

  function renderPushConfirm() {
    const p = state.pushConfirm;
    if (!p) return '';
    const branches = state.branches || { local: [], remote: [] };
    const remoteNames = [...new Set((branches.remote || []).map((r) => r.split('/')[0]))];
    const hasUp = (branches.remote || []).some((r) => r === `origin/${p.branch}` || r.endsWith(`/${p.branch}`));
    return `
      <div class="rel-modal-wrap" id="bldPushWrap" role="dialog" aria-label="推送分支确认">
        <div class="rel-modal">
          <h3>推送分支 ${esc(p.branch)}</h3>
          <div class="rel-modal-body">
            <label class="field">目标远端
              <select class="bld-push-remote">${(remoteNames.length ? remoteNames : ['origin']).map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
            <p class="muted small">${hasUp
              ? `该分支已有远端分支：本次推送将更新 origin/${esc(p.branch)}。`
              : '该分支尚未建立上游跟踪：首推将加 -u 建立跟踪。'}</p>
          </div>
          <footer class="modal-foot">
            <button type="button" class="btn" id="bldPushCancel">取消</button>
            <button type="button" class="btn primary" id="bldPushGo" ${state.pushBusy ? 'disabled' : ''}>确认推送</button>
          </footer>
        </div>
      </div>`;
  }

  function renderBranchesPane() {
    if (!state.data?.isRepo) {
      return `<div class="rel-empty"><h3>当前项目不是 git 仓库</h3>
        <p class="muted">分支浏览与同步需要 git 仓库：可在终端执行 git init，或经 <code>atb init</code> 初始化项目（设置模块「Git 工作流」亦有初始化入口）。</p></div>`;
    }
    const b = state.branches;
    let list = '';
    if (state.branchesPhase === 'loading' || !b) {
      list = '<p class="muted">加载分支中…</p>';
    } else if (state.branchesPhase === 'error') {
      list = `<p class="rel-form-err" role="alert">分支读取失败：${esc(state.branchesError || '')} <button type="button" class="btn small" id="bldBranchRetry">重试</button></p>`;
    } else {
      const cur = b.current ? `<div class="bld-branch bld-cur" data-branch="${esc(b.current)}" role="button" tabindex="0"><strong>${esc(b.current)}</strong> <span class="st st-run">当前</span></div>` : '';
      const local = (b.local || []).filter((x) => x !== b.current).map((x) => `
        <div class="bld-branch" data-branch="${esc(x)}" role="button" tabindex="0"><span>${esc(x)}</span>
          <button type="button" class="btn small quiet bld-push" data-push="${esc(x)}" title="推送到远端">推送</button></div>`).join('');
      const remote = (b.remote || []).map((x) => `<div class="bld-branch bld-remote" data-branch="${esc(x)}" role="button" tabindex="0"><span>${esc(x)}</span></div>`).join('');
      list = `
        <div class="bld-branch-group"><div class="bld-group-head">本地</div>${cur}${local || '<p class="muted small">（无其他本地分支）</p>'}</div>
        <div class="bld-branch-group"><div class="bld-group-head">远端</div>${remote || '<p class="muted small">（无远端分支：先「同步远端」或推送本地分支）</p>'}</div>`;
    }
    const log = state.logBranch ? (() => {
      if (state.logPhase === 'loading') return '<p class="muted">加载提交记录中…</p>';
      if (state.logPhase === 'error') return `<p class="rel-form-err" role="alert">提交记录读取失败：${esc(state.logError || '')}</p>`;
      const commits = state.branchLog?.commits || [];
      if (!commits.length) return '<p class="muted small">该分支暂无提交</p>';
      return `<ul class="bld-log">${commits.map((c) => `<li>
        <code>${esc(c.short || c.hash.slice(0, 8))}</code> <span>${esc(c.subject)}</span>
        <span class="muted small">${esc(c.author)} · ${esc(fmtTime(c.date))}</span></li>`).join('')}</ul>`;
    })() : '<div class="rel-detail muted">点击左侧分支查看提交记录</div>';
    return `
      <div class="rel-split bld-branch-split">
        <div class="rel-list" aria-label="分支列表">
          <div class="bld-branch-tools">
            <button type="button" class="btn small" id="bldFetchBtn" ${state.syncBusy ? 'disabled' : ''} title="fetch --all --prune：拉取远端最新并清理失效引用">${state.syncBusy ? '同步中…' : '⟳ 同步远端'}</button>
            <button type="button" class="btn small quiet" id="bldBranchRefresh">刷新</button>
          </div>
          ${list}
        </div>
        <div class="rel-detail" aria-label="提交记录">
          <div class="bld-log-head"><strong>${esc(state.logBranch || '提交记录')}</strong>
            ${state.logBranch ? '<button type="button" class="btn small quiet" id="bldLogRefresh">刷新</button>' : ''}</div>
          ${log}
        </div>
      </div>`;
  }

  function render() {
    const view = $('#buildView');
    if (!view) return;
    if (state.phase === 'loading') {
      view.innerHTML = '<div class="rel-loading muted">加载构建模块…</div>';
      state.rendered = true;
      return;
    }
    if (state.phase === 'error') {
      view.innerHTML = `<div class="rel-error"><p>构建模块读取失败：${esc(state.error || '')}</p>
        <button type="button" class="btn" id="bldRetryLoad">重试</button></div>`;
      bindCommon(view);
      state.rendered = true;
      return;
    }
    const d = state.data;
    const tabs = TABS.map(([k, label]) => `<button type="button" class="rel-tab${state.tab === k ? ' active' : ''}" data-bld-tab="${k}">${label}</button>`).join('');
    let body = '';
    if (!d?.isRepo) {
      // 非 git 仓库：版本计划同样受不可用（创建 / 合并均需 git），给统一引导空态
      body = `<div class="rel-empty"><h3>当前项目不是 git 仓库</h3>
        <p class="muted">构建模块基于 git（版本计划合并入 main、分支浏览与同步）：可在终端执行 git init，或经 <code>atb init</code> 初始化项目（设置模块「Git 工作流」亦有初始化入口）。</p></div>`;
    } else if (state.tab === 'versions') {
      body = `
        <div class="bld-toolbar">
          <button type="button" class="btn primary" id="bldNewBtn">＋ 新建版本</button>
        </div>
        <div class="rel-split">
          <div class="rel-list" aria-label="版本列表">${renderVersionList()}</div>
          ${renderDetail(selVersion())}
        </div>`;
    } else {
      body = renderBranchesPane();
    }
    view.innerHTML = `
      <nav class="rel-tabs bld-tabs" aria-label="构建子页签">${tabs}</nav>
      ${body}
      ${d?.isRepo ? renderPanel(state.createPanel, '新建版本', '仅已完成（done）的需求单 / Bug 单可纳入版本；全选只纳入有 commit 候选的条目', 'bldCreateBtn', '创建版本计划') : ''}
      ${d?.isRepo ? renderPanel(state.addPanel, '添加条目', '仅已完成（done）的需求单 / Bug 单可加入本版本（已在本版本中的条目不再出现）', 'bldAddSubmit', '添加所选条目') : ''}
      ${renderAnswerModal()}
      ${renderMergeConfirm()}
      ${renderPushConfirm()}`;
    bindCommon(view);
    state.rendered = true;
  }

  function bindCommon(view) {
    const q = (s) => view.querySelector(s);
    q('#bldRetryLoad')?.addEventListener('click', () => refresh());
    // 子页签
    for (const el of view.querySelectorAll('[data-bld-tab]')) {
      el.addEventListener('click', () => setTab(el.dataset.bldTab));
    }
    // 版本列表
    const list = q('.rel-list');
    list?.addEventListener('click', (e) => {
      if (e.target?.closest?.('button')) return;
      const card = e.target?.closest?.('[data-ver-id]');
      if (card?.dataset?.verId) {
        state.edit = null;
        state.selVerId = card.dataset.verId;
        render();
        window.dispatchEvent?.(new CustomEvent('atb:build-state'));
      }
    });
    // 详情
    q('#bldNewBtn')?.addEventListener('click', openCreatePanel);
    q('.bld-name')?.addEventListener('click', () => { const v = selVersion(); if (v) { state.edit = { id: v.id, field: 'name' }; render(); } });
    q('.bld-desc')?.addEventListener('click', () => { const v = selVersion(); if (v) { state.edit = { id: v.id, field: 'desc' }; render(); } });
    q('#bldSaveName')?.addEventListener('click', () => { const v = selVersion(); const val = q('.bld-name-input')?.value; if (v && val != null) { state.edit = null; saveInfo(v.id, { name: val }); } });
    q('#bldSaveDesc')?.addEventListener('click', () => { const v = selVersion(); const val = q('.bld-desc-input')?.value; if (v && val != null) { state.edit = null; saveInfo(v.id, { description: val }); } });
    q('#bldCancelEdit')?.addEventListener('click', () => { state.edit = null; render(); });
    // 条目增删与 commit 换选
    q('#bldAddItem')?.addEventListener('click', openAddPanel);
    for (const el of view.querySelectorAll('[data-remove-item]')) {
      el.addEventListener('click', () => itemAction('remove', { itemIds: [el.dataset.removeItem] }));
    }
    for (const el of view.querySelectorAll('[data-commit-item]')) {
      el.addEventListener('change', () => itemAction('commit', { itemId: el.dataset.commitItem, commit: el.value }));
    }
    // 操作区
    q('#bldAnswerBtn')?.addEventListener('click', openAnswerModal);
    q('#bldMergeBtn')?.addEventListener('click', openMergeConfirm);
    // 回填弹窗（同一弹窗内完成复制 → 粘贴 → 解析 → 应用）
    q('#bldCopyPrompt')?.addEventListener('click', copyPrompt);
    q('#bldParseBtn')?.addEventListener('click', parseAnswerPreview);
    q('#bldApplyBtn')?.addEventListener('click', applyParsed);
    q('#bldAnswerClose')?.addEventListener('click', () => { state.answer = null; render(); });
    // 合并确认
    q('#bldMergeCancel')?.addEventListener('click', () => { state.mergeConfirm = null; render(); });
    q('#bldMergeGo')?.addEventListener('click', doMerge);
    // 新建 / 添加面板
    q('#bldPanelClose')?.addEventListener('click', () => { state.createPanel = null; state.addPanel = null; render(); });
    q('#bldPanelMask')?.addEventListener('click', () => { state.createPanel = null; state.addPanel = null; render(); });
    q('#bldPanelRetry')?.addEventListener('click', () => { if (state.createPanel) openCreatePanel(); else openAddPanel(); });
    q('#bldCreateBtn')?.addEventListener('click', submitCreate);
    q('#bldAddSubmit')?.addEventListener('click', submitAdd);
    q('#bldPickAll')?.addEventListener('click', () => {
      const key = state.createPanel ? 'createPanel' : 'addPanel';
      const skipped = pickAll(key, true);
      if (skipped) toast(`已全选有 commit 候选的条目；${skipped} 个条目暂无关联提交已跳过`);
      else render();
    });
    q('#bldPickNone')?.addEventListener('click', () => {
      const key = state.createPanel ? 'createPanel' : 'addPanel';
      pickAll(key, false);
    });
    for (const el of view.querySelectorAll('[data-pick]')) {
      el.addEventListener('change', () => pickItem(el.dataset.pick, el.dataset.item, el.checked));
    }
    for (const el of view.querySelectorAll('[data-panel]')) {
      el.addEventListener('change', () => setPanelCommit(el.dataset.panel, el.dataset.item, el.value));
    }
    const nameInput = q('#bldNewName');
    nameInput?.addEventListener('input', () => { if (state.createPanel) state.createPanel.name = nameInput.value; });
    // 分支浏览
    q('#bldFetchBtn')?.addEventListener('click', doFetch);
    q('#bldBranchRefresh')?.addEventListener('click', loadBranches);
    q('#bldBranchRetry')?.addEventListener('click', loadBranches);
    q('#bldLogRefresh')?.addEventListener('click', () => state.logBranch && selectBranch(state.logBranch));
    for (const el of view.querySelectorAll('[data-branch]')) {
      el.addEventListener('click', (e) => {
        if (e.target?.closest?.('button')) return;
        selectBranch(el.dataset.branch);
      });
    }
    for (const el of view.querySelectorAll('[data-push]')) {
      el.addEventListener('click', () => openPushConfirm(el.dataset.push));
    }
    q('#bldPushCancel')?.addEventListener('click', () => { state.pushConfirm = null; render(); });
    q('#bldPushGo')?.addEventListener('click', doPush);
  }

  document.addEventListener?.('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.pushConfirm) { state.pushConfirm = null; render(); return; }
    if (state.mergeConfirm) { state.mergeConfirm = null; render(); return; }
    if (state.answer) { state.answer = null; render(); return; }
    if (state.createPanel || state.addPanel) { state.createPanel = null; state.addPanel = null; render(); }
  });
  // 浏览态变化落快照（app.js 统一监听本事件持久化）
  const notify = () => window.dispatchEvent?.(new CustomEvent('atb:build-state'));

  return {
    enter, refresh, setTab, setQuery, snapshot, restoreView, notifyState: notify,
    openCreatePanel, openAddPanel, selectBranch,
    // 纯函数接缝（测试与面板复用）
    doneCandidates, selectableCandidates, parseAnswer, buildPrompt,
    getCandidates: () => state.createPanel?.candidates || [],
    searchStats,
  };
})();

window.ATBBuild = ATBBuild;
