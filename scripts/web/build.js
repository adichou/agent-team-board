'use strict';
// 构建模块前端（REQ-20260913-001，版本管理 + 分支浏览与同步）—— 由 app.js 在 view=build 时激活。
// 界面：模块内两个子页签——版本计划（默认）：左版本列表 + 右版本详情（信息编辑 / 条目 ↔ commit 关联
// 与增删）；版本操作（AI 完善 / 合并入 main / 删除）直接放在左侧每张版本卡片内
//（BUG-20260913-004 参照需求列表行内操作口径；删除为 REQ-20260913-004）；分支浏览：左分支列表
//（当前 / 本地 / 远端分组）+ 右提交记录。
// 语义边界（与后端一致，design.md 落定口径）：
//   - 仅已完成（done）的需求单 / Bug 单可纳入版本（BUG-20260913-001）：新建版本 / 添加条目
//     候选只列 done 条目（后端接口已收窄，前端再过滤一次防御旧数据）；无候选时给明确空态；
//   - 新建版本 / 添加条目走右侧侧拉面板：选单支持全选 / 全不选（全选只纳入有 commit 候选的条目）；
//   - 「AI 完善」（原「提示词与回答回填」，BUG-20260913-004 更名）为同一弹窗两段式：上段复制提示词、
//     下段粘贴回答解析回填，无需关闭再打开；解析成功后预览区为可编辑表单（REQ-20260913-006）——
//     名称 / 描述预填解析值，可直接修改，「应用」保存编辑后的值（回答原文是唯一解析来源，
//     重新解析以最新结果预填并覆盖未保存的手工修改）；
//   - 合并入 main 前弹确认框（列 commit 清单），确认即授权；执行中禁用重复触发；
//   - 删除版本（REQ-20260913-004）必经确认弹窗：按状态差异化提示（draft/failed 不可恢复，
//     merged 仅移除看板记录；merging 禁删）；执行中确认键禁用防重复，成功后列表与详情同步回落；
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
    // { verId, text, parsed, draft, error, busy, copied }  AI 完善弹窗（提示词与回答回填）
    // parsed: parseAnswer 成功结果；draft: { name, description } 回填编辑表单当前值（REQ-20260913-006，
    // 解析时以解析结果预填，编辑 / 后台重渲染前从输入框同步，应用保存该值而非解析原值）
    answer: null,
    // BUG-20260913-005：弹窗「去新建 XX 会话」宿主探测——状态机与 app.js state.workspaceApps
    // 同款；模块级缓存且不随 enter(project) 重置（宿主安装是机器级事实，与项目无关）
    workspaceApps: { zcode: undefined, codex: undefined, loaded: false, probing: false, failed: false },
    mergeConfirm: null,  // { verId }
    pushConfirm: null,   // { branch }
    mergeBusy: false,
    deleteConfirm: null, // { verId } REQ-20260913-004 删除确认弹窗
    deleteBusy: false,
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
  // BUG-20260913-005：透传 isErr（错误 toast 与普通提示在任务面板口径下有样式差异）
  const toast = (m, isErr) => { try { if (typeof window !== 'undefined' && window.toast) window.toast(m, isErr); } catch { /* 测试环境无 toast */ } };

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
        deleteConfirm: null, deleteBusy: false,
        branches: null, branchesPhase: 'idle', branchesError: null,
        logBranch: null, branchLog: null, logPhase: 'idle', syncBusy: false, pushBusy: false,
        rendered: false, pendingRestore: state.pendingRestore,
      });
      render(); // 拉取前先呈现加载态
    }
    refreshWorkspaceApps(); // BUG-20260913-005：宿主探测预热（fire-and-forget，loaded 后为 no-op）
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

  // 全选 / 全不选：仅对「有 commit 候选」的条目生效；返回跳过的无提交条目数。
  // BUG-20260914-002：与 pickItem 同口径在内部统一 render——点击后复选框 / 「已选 N 项」计数 /
  // commit 下拉解禁态立即同步，避免内部 picked 集合与界面显示错位（跳过提示由调用方补充 toast）。
  function pickAll(panelKey, on) {
    const p = state[panelKey];
    if (!p || !p.candidates) return 0;
    const selectable = selectableCandidates(p.candidates);
    for (const it of selectable) {
      if (on) p.picked.add(it.itemId); else p.picked.delete(it.itemId);
    }
    render();
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

  function findVersion(id) {
    return (state.data?.versions || []).find((v) => v.id === id) || null;
  }

  function selVersion() {
    return findVersion(state.selVerId);
  }

  async function saveInfo(id, patch) {
    try {
      const r = await post('/version/save', { id, ...patch });
      if (!r.ok) throw new Error(await errOf(r, '保存失败'));
      toast('✓ 已保存版本信息');
      await refresh();
      return true;
    } catch (e) {
      toast(`✕ 保存失败：${e.message}`, true); // ✕ 前缀为失败口径：错误样式（REQ-20260913-006 与弹窗反馈一致）
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

  /* ---------- AI 完善（提示词与回答回填，同一弹窗两段式） ---------- */

  // BUG-20260913-004：入口迁入版本卡片后按 verId 打开（对按钮所在卡片生效）；
  // 不带参时回落当前选中版本（向后兼容），带参但版本已不存在时不弹窗。
  function openAnswerModal(verId) {
    const v = verId ? findVersion(verId) : selVersion();
    if (!v) return;
    state.answer = { verId: v.id, text: '', parsed: null, draft: null, error: null, busy: false, copied: false };
    render();
    refreshWorkspaceApps(); // BUG-20260913-005：入口探测（fire-and-forget；loaded / 进行中 / 已失败不重探）
  }

  // BUG-20260913-005：剪贴板写入，返回布尔（与任务面板 copyDispatchText 同口径）；
  // 失败 toast 由调用方给完整补救指引，不在此处重复提示
  async function copyText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* 剪贴板不可用：走失败分支 */ }
    return false;
  }

  async function copyPrompt() {
    const a = state.answer;
    if (!a) return;
    const v = findVersion(a.verId);
    if (!v) return;
    const copied = await copyText(buildPrompt(v));
    a.copied = copied;
    if (copied) toast('✓ 提示词已复制，去 Agent 粘贴执行后把回答粘贴到下方');
    else toast('剪贴板不可用：请在提示词文本框中全选（⌘A）并手动复制');
    render();
  }

  // BUG-20260913-005：弹窗内「去新建 XX 会话」点击——与任务面板 copyPromptAndOpenSession 同构
  // （BUG-20260910-005 / REQ-20260911-008 口径）：先复制本弹窗当前版本提示词（buildPrompt(v)），
  // 复制动作完成后才触发深链跳转（zcode 只打开工作区、codex 落在新会话输入框，均不传 prompt、
  // 不自动发送）；失败不静默且深链打开不依赖复制成败；busy 防重复点击（在途点击直接忽略）。
  // 版本提示词为前端本地生成，无「提示词获取失败」分支；版本缺失（弹窗已关）仅作防御路径。
  let bldSessionBusy = false;
  async function copyPromptAndOpenSession(agent, url) {
    if (bldSessionBusy) return;
    bldSessionBusy = true;
    try {
      const label = agent === 'codex' ? 'Codex 新会话' : 'Zcode 工作区';
      const v = state.answer ? findVersion(state.answer.verId) : null;
      const prompt = v ? buildPrompt(v) : '';
      if (!prompt) {
        location.href = url;
        toast(`当前弹窗暂无版本提示词；已请求打开 ${label}（${state.project}）`);
        return;
      }
      const copied = await copyText(prompt); // 失败时由下方 toast 给手动复制补救指引
      location.href = url;
      if (copied) {
        toast(`✓ 已复制提示词并请求打开 ${label}（${state.project}）：请在新建会话中粘贴发送；回答仍粘贴回本弹窗`);
      } else {
        toast(`复制失败：已请求打开 ${label}（${state.project}），请点弹窗内「复制提示词」手动复制后再粘贴；回答仍粘贴回本弹窗`, true);
      }
    } finally {
      bldSessionBusy = false;
    }
  }

  // BUG-20260913-005：弹窗「去新建 XX 会话」宿主探测——状态机与任务面板（app.js
  // refreshWorkspaceApps）同款：probing 标记进行中；成功置 loaded（zcode/codex 为明确 boolean）；
  // 失败置 failed 且不置 loaded（保持未知，不当作未安装），重试走 force（「重新检测」）。
  // 探测异步 fire-and-forget，结束仅在弹窗打开时重渲染刷出最终态，不阻断复制与回填。
  async function refreshWorkspaceApps(force = false) {
    const w = state.workspaceApps;
    if (w.loaded || w.probing || (w.failed && !force)) return;
    w.probing = true;
    w.failed = false;
    try {
      const r = await fetch('/api/workspace/apps'); // 全局只读接口（不挂 /api/build 前缀）
      if (!r.ok) throw new Error(`探测失败（${r.status}）`);
      const d = await r.json();
      w.zcode = !!d.zcode;
      w.codex = !!d.codex;
      w.loaded = true;
    } catch {
      w.failed = true; // 保持未知：不置 loaded、不当作未安装；手动「重新检测」恢复
    } finally {
      w.probing = false;
      // 入口只在回填弹窗内：仅在弹窗打开时刷最终态；刷前先保留未解析草稿防丢输入
      if (state.answer) { syncAnswerDraft(); render(); }
    }
  }

  // 探测结束重渲染前，把回答框当前值同步回 state.answer.text，避免丢用户已粘贴未解析的草稿；
  // REQ-20260913-006：解析成功后同时同步回填编辑表单（名称 / 描述）当前值到 a.draft，
  // 使任何后台重渲染（宿主探测刷新、复制提示词、应用失败重试等）都不冲掉未保存的编辑
  function syncAnswerDraft() {
    const a = state.answer;
    if (!a) return;
    const view = $('#buildView');
    if (!view) return;
    const input = $('.bld-answer-input', view);
    if (input) a.text = input.value ?? a.text;
    if (!a.parsed) return;
    const nameEl = $('.bld-name-edit', view);
    const descEl = $('.bld-desc-edit', view);
    if (nameEl || descEl) {
      a.draft = {
        name: nameEl ? nameEl.value : (a.draft?.name ?? ''),
        description: descEl ? descEl.value : (a.draft?.description ?? ''),
      };
    }
  }

  // REQ-20260913-006：回填编辑输入即时校验——名称空即刻显错并禁用「应用」（title 说明），
  // 只改错误提示显隐与按钮态、不整页重渲染（保输入焦点）；数据层 saveInfo 校验兜底双保险
  function onAnswerEditInput() {
    const a = state.answer;
    if (!a?.parsed) return;
    syncAnswerDraft();
    const nameEmpty = !String(a.draft?.name ?? '').trim();
    const view = $('#buildView');
    if (!view) return;
    $('.bld-name-err', view)?.classList.toggle('hidden', !nameEmpty);
    const applyBtn = $('#bldApplyBtn', view);
    if (applyBtn) {
      applyBtn.disabled = !!(a.busy || nameEmpty);
      applyBtn.title = nameEmpty ? '版本名称不能为空' : '';
    }
  }

  // BUG-20260913-005：弹窗上段「去新建 XX 会话」入口（参照任务面板 newSessionLinksHtml 口径，
  // BUG-20260910-005 / REQ-20260911-008）。取材与 title 均为本弹窗版本提示词（非主调度提示词）；
  // 状态机同款：检测中显示检测态（不把未知当未检测到）；失败给说明 +「重新检测」+ 手动打开指引
  // （不砍入口区）；未检测到宿主该端禁用 +（未检测到）；未选项目两端禁用 + title 说明。
  function answerSessionLinksHtml() {
    const w = state.workspaceApps;
    if (w.failed && !w.loaded) {
      return '<span class="muted small">客户端检测失败：无法确认本机 Zcode / Codex 是否可用</span>'
        + '<a class="ws-entry-link" href="#" data-bld-ws-retry title="重新检测本机 Zcode / Codex 客户端（只读存在性检查）">重新检测</a>'
        + '<span class="muted small">或直接打开 ZCode / ChatGPT 手动新建会话并粘贴提示词</span>';
    }
    if (w.probing || !w.loaded) {
      return '<span class="muted small">正在检测本机 Agent 客户端…</span>';
    }
    const noProject = !state.project;
    const cfg = [
      { agent: 'zcode', label: '去新建 Zcode 会话',
        okTitle: `自动复制本弹窗版本提示词后打开 Zcode（${state.project}）：深链只打开工作区，会话需手动新建并粘贴提示词`,
        missingTitle: '未检测到 ZCode.app（zcode:// 深链宿主）：可能未安装或装在非默认路径；可直接打开 Zcode 手动新建会话并粘贴提示词' },
      { agent: 'codex', label: '去新建 Codex 会话',
        okTitle: `自动复制本弹窗版本提示词后打开 Codex 新会话（${state.project}）：深链不传提示词，不会自动发送，请粘贴发送`,
        missingTitle: '未检测到 ChatGPT.app（codex:// 深链宿主）：可能未安装或装在非默认路径；可直接打开 ChatGPT 手动新建会话并粘贴提示词' },
    ];
    return cfg.map((c) => {
      if (w[c.agent] === false) {
        return `<a class="ws-entry-link is-off" aria-disabled="true" data-bld-new-session="${c.agent}" title="${esc(c.missingTitle)}">${c.label}<span class="ws-entry-note">（未检测到）</span></a>`;
      }
      if (noProject) {
        return `<a class="ws-entry-link is-off" aria-disabled="true" data-bld-new-session="${c.agent}" title="未选择项目：请先在顶栏选择项目后再新建会话">${c.label}</a>`;
      }
      const url = c.agent === 'codex'
        ? `codex://threads/new?path=${encodeURIComponent(state.project)}`
        : `zcode://workspace/open?path=${encodeURIComponent(state.project)}`;
      return `<a class="ws-entry-link" href="${url}" data-bld-new-session="${c.agent}" title="${esc(c.okTitle)}">${c.label}</a>`;
    }).join('');
  }

  function parseAnswerPreview() {
    const a = state.answer;
    if (!a || a.busy) return;
    a.text = ($('.bld-answer-input', $('#buildView'))?.value) ?? a.text;
    const r = parseAnswer(a.text);
    if (!r.ok) {
      a.parsed = null;
      a.draft = null;
      a.error = r.error; // 原文保留在输入框，可在弹窗内修改重试
    } else {
      a.parsed = r;
      // REQ-20260913-006：以最新解析结果预填编辑表单，覆盖未保存的手工修改——
      // 回答原文是唯一解析来源，避免两处编辑互相覆盖产生歧义
      a.draft = { name: r.name, description: r.description };
      a.error = null;
    }
    // 解析结果即最新事实：跳过草稿回同步，防止旧 DOM 输入值覆盖刚解析的预填值
    render(false);
  }

  // REQ-20260913-006：「应用」保存编辑后的名称与描述（未修改时即解析原值）；名称空由前端
  // 即时校验拦截不发请求，数据层 saveInfo「版本名称不能为空」校验兜底双保险
  async function applyParsed() {
    const a = state.answer;
    if (!a?.parsed || a.busy) return;
    syncAnswerDraft(); // 以编辑框当前值为准（含测试直调等未触发 input 事件的路径）
    const name = String(a.draft?.name ?? '');
    if (!name.trim()) {
      render(); // 显即时错误并禁用应用，不发保存请求
      return;
    }
    a.busy = true;
    render();
    const ok = await saveInfo(a.verId, { name, description: String(a.draft?.description ?? '') });
    if (ok) {
      state.answer = null;
      toast('✓ 已应用回填：版本名称与描述已更新');
    } else {
      a.busy = false; // 失败：弹窗与编辑内容保留，可修改后重试
    }
    render();
  }

  /* ---------- 合并入 main ---------- */

  function openMergeConfirm(verId) {
    const v = verId ? findVersion(verId) : selVersion();
    if (!v || state.mergeBusy) return;
    state.mergeConfirm = { verId: v.id };
    render();
  }

  async function doMerge() {
    const v = findVersion(state.mergeConfirm?.verId);
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

  /* ---------- 删除版本（REQ-20260913-004） ---------- */

  // 打开删除确认弹窗：按所在卡片版本定位（无参回落当前选中，向后兼容）；
  // 已有删除弹窗 / 删除执行中 / 合并执行中不再开新弹窗（弹窗打开期间列表不可再触发其他删除）。
  function openDeleteConfirm(verId) {
    const v = verId ? findVersion(verId) : selVersion();
    if (!v || state.deleteConfirm || state.deleteBusy || state.mergeBusy) return;
    state.deleteConfirm = { verId: v.id };
    render();
  }

  // 确认删除：执行期间弹窗保持展示、确认键禁用防重复触发；成功关闭弹窗、刷新列表
  // （选中失效回落既有规则：取列表最新，空则显示空态）；失败关闭弹窗、toast 错误、
  // 数据保持原状（版本仍留在列表，可重新打开弹窗重试）。
  async function doDelete() {
    const v = findVersion(state.deleteConfirm?.verId);
    if (!v || state.deleteBusy) return;
    state.deleteBusy = true;
    render();
    try {
      const r = await post('/version/delete', { id: v.id });
      if (!r.ok) throw new Error(await errOf(r, '删除失败'));
      state.deleteConfirm = null;
      toast(`✓ 已删除版本（${v.id}）`);
      await refresh();
    } catch (e) {
      state.deleteConfirm = null;
      toast(`✕ 删除失败：${e.message}`, true);
    } finally {
      state.deleteBusy = false;
      render();
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
    // BUG-20260913-004：版本操作直接放在每张卡片内（参照需求列表 row-acts 口径），
    // 状态禁用/文案规则逐卡继承原详情底部逻辑；mergeBusy 为全局口径（执行中禁所有卡片的合并键）。
    return versions.map((v) => {
      const mergeLabel = v.status === 'failed' ? '重试合并入 main' : '合并入 main';
      const answerBtn = `<button type="button" class="btn small bld-ver-answer" data-ver-answer="${esc(v.id)}"${v.status === 'merging' ? ` disabled title="合并中，请稍候……"` : ''} aria-label="AI 完善 ${esc(v.id)}"${v.status === 'merging' ? '' : ` title="复制提示词给 Agent，回答直接粘贴回本弹窗自动解析"`}>AI 完善</button>`;
      const mergeBtn = `<button type="button" class="btn small primary bld-ver-merge" data-ver-merge="${esc(v.id)}"${v.status === 'merging' || v.status === 'merged' || state.mergeBusy ? ` disabled title="${v.status === 'merged' ? '已合并入 main' : '合并中，请勿重复触发'}"` : ''} aria-label="${mergeLabel} ${esc(v.id)}">${mergeLabel}</button>`;
      // REQ-20260913-004 删除键：排在两键之后、quiet 危险弱化样式（不抢主操作）；
      // merging 卡片禁用（title 单列口径）；mergeBusy 为全局口径（与合并键一并禁用）。
      const delDisabled = v.status === 'merging' || state.mergeBusy;
      const delBtn = `<button type="button" class="btn small quiet bld-ver-del" data-ver-delete="${esc(v.id)}"${delDisabled ? ` disabled title="${v.status === 'merging' ? '合并中，不可删除' : '合并中，请勿重复触发'}"` : ''} aria-label="删除 ${esc(v.id)}"${delDisabled ? '' : ' title="删除该版本计划（需确认，删除后不可恢复）"'}>删除</button>`;
      return `
      <div class="rel-card${v.id === state.selVerId ? ' sel' : ''}" data-ver-id="${esc(v.id)}" role="button" tabindex="0">
        <div class="t"><strong>${esc(v.name || v.id)}</strong> ${statusChip(v.status)}</div>
        <div class="meta">${esc(v.id)} · ${v.items.length} 个关联单 · 更新 ${esc(fmtTime(v.updatedAt))}</div>
        <div class="card-acts">${answerBtn}${mergeBtn}${delBtn}</div>
      </div>`;
    }).join('');
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
        <span class="bld-cand-title" title="${esc(it.title || '')}">${esc(it.itemId)} ${esc(it.title || '')}</span>${commits}
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
      </div>`; // BUG-20260913-004：原 footer.rel-acts（AI 完善 / 合并入 main）已迁入左侧版本卡片，详情不再重复渲染
  }

  function renderAnswerModal() {
    const a = state.answer;
    if (!a) return '';
    const v = (state.data?.versions || []).find((x) => x.id === a.verId);
    // REQ-20260913-006：解析成功后预览区为可编辑表单（名称单行 / 描述多行，预填解析值），
    // label 内以 muted「当前：<旧值>」保留对照语境；名称空即时显错并禁用「应用」
    const nameEmpty = !!a.parsed && !String(a.draft?.name ?? '').trim();
    const applyDisabled = a.busy || !a.parsed || nameEmpty;
    return `
      <div class="rel-modal-wrap" id="bldAnswerWrap" role="dialog" aria-label="AI 完善">
        <div class="rel-modal">
          <h3>AI 完善（${esc(v?.id || '')}）</h3>
          <div class="rel-modal-body">
            <p class="muted small">上段：复制提示词交给 Agent；下段：把回答粘贴回来，解析预览后应用——全程无需关闭本弹窗。</p>
            <div class="bld-prompt-box">
              <textarea class="bld-prompt-text" rows="7" readonly>${esc(v ? buildPrompt(v) : '')}</textarea>
              <button type="button" class="btn small primary" id="bldCopyPrompt">复制提示词</button>
              ${a.copied ? '<span class="muted small">已复制 ✓</span>' : ''}
              <div class="bld-session-entry">${answerSessionLinksHtml()}</div>
            </div>
            <div class="bld-answer-box">
              <label class="field">Agent 回答（粘贴后点「解析并预览」）
                <textarea class="bld-answer-input" rows="5" placeholder="版本名称：…&#10;版本描述：…">${esc(a.text)}</textarea></label>
              ${a.error ? `<p class="rel-form-err" role="alert">${esc(a.error)}</p>` : ''}
              ${a.parsed ? `<div class="bld-preview bld-edit-form">
                <p class="muted small">解析结果可直接修改，点「应用」保存修改后的值</p>
                <label class="field">版本名称（当前：${esc(v?.name || '（空）')}）
                  <input class="bld-name-edit" type="text" value="${esc(a.draft?.name ?? '')}"></label>
                <p class="rel-form-err bld-name-err${nameEmpty ? '' : ' hidden'}" role="alert">版本名称不能为空</p>
                <label class="field">版本描述（当前：${esc(v?.description || '（空）')}）
                  <textarea class="bld-desc-edit" rows="4">${esc(a.draft?.description ?? '')}</textarea></label>
              </div>` : ''}
            </div>
          </div>
          <footer class="modal-foot">
            <button type="button" class="btn" id="bldAnswerClose">关闭</button>
            <button type="button" class="btn" id="bldParseBtn" ${a.busy ? 'disabled' : ''}>解析并预览</button>
            <button type="button" class="btn primary" id="bldApplyBtn"${applyDisabled ? ' disabled' : ''}${nameEmpty && !a.busy ? ' title="版本名称不能为空"' : ''}>${a.busy ? '应用中…' : '应用'}</button>
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

  // REQ-20260913-004 删除确认弹窗（沿用 rel-modal 居中口径）：正文列名称 / 状态 / 关联单数，
  // 按状态给差异化不可恢复提示；确认键危险主样式，执行期间（deleteBusy）双键禁用防重复触发。
  function renderDeleteConfirm() {
    const m = state.deleteConfirm;
    if (!m) return '';
    const v = (state.data?.versions || []).find((x) => x.id === m.verId);
    if (!v) { state.deleteConfirm = null; return ''; }
    const statusHint = v.status === 'merged'
      ? '仅删除看板版本记录，不影响已合并入 main 的提交与代码。'
      : '删除后不可恢复，关联条目与 commit 关联一并移除；条目本身可重新纳入其他版本。';
    return `
      <div class="rel-modal-wrap" id="bldDeleteWrap" role="dialog" aria-label="删除版本确认">
        <div class="rel-modal">
          <h3>删除版本（${esc(v.id)}）</h3>
          <div class="rel-modal-body">
            <p>版本「<strong>${esc(v.name || v.id)}</strong>」当前状态：${statusChip(v.status)}，共 ${v.items.length} 个关联单。</p>
            <p class="muted small">${statusHint}</p>
            <p class="muted small">此操作不可撤销，请确认后再继续。</p>
          </div>
          <footer class="modal-foot">
            <button type="button" class="btn" id="bldDeleteCancel"${state.deleteBusy ? ' disabled' : ''}>取消</button>
            <button type="button" id="bldDeleteGo"${state.deleteBusy ? ' disabled' : ''} class="btn danger">${state.deleteBusy ? '删除中…' : '确认删除'}</button>
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
      // BUG-20260914-003：本地有分支但缺 main 时给出可解释提示（与「合并入 main」
      // precheckMerge「main 分支不存在」报错口径一致），引导经设置页 Git 工作流幂等补建。
      // 空仓库（无任何本地分支 = 尚无提交、无补建基点）不出提示。
      const locals = b.local || [];
      const mainMissing = locals.length > 0 && !locals.includes('main');
      const mainHint = mainMissing
        ? `<p class="bld-main-hint" role="note">⚠ 本地缺少 main 分支：版本计划「合并入 main」将报「main 分支不存在」。可到「设置 → Git 工作流」执行初始化（幂等，将在首个提交上补建 main，不推送远端）。</p>`
        : '';
      list = `
        <div class="bld-branch-group"><div class="bld-group-head">本地</div>${cur}${local || '<p class="muted small">（无其他本地分支）</p>'}${mainHint}</div>
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

  // syncModalDrafts=false 供 parseAnswerPreview 跳过草稿回同步（解析结果刚写入 state，
  // 旧 DOM 输入值不应覆盖预填值）；其余调用方默认 true——重渲染前把弹窗内未保存的
  // 回答草稿与回填编辑值写回 state，防止后台刷新冲掉用户输入（REQ-20260913-006）
  function render(syncModalDrafts = true) {
    const view = $('#buildView');
    if (!view) return;
    if (syncModalDrafts && state.rendered && state.answer) syncAnswerDraft();
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
      ${renderPushConfirm()}
      ${renderDeleteConfirm()}`;
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
    // 卡片行内操作（BUG-20260913-004：按钮迁入版本卡片，按所在卡片版本绑定；
    // .rel-list 点击处理已忽略 button 点击，点按钮不会改变选中态）
    for (const el of view.querySelectorAll('[data-ver-answer]')) {
      el.addEventListener('click', () => openAnswerModal(el.dataset.verAnswer));
    }
    for (const el of view.querySelectorAll('[data-ver-merge]')) {
      el.addEventListener('click', () => openMergeConfirm(el.dataset.verMerge));
    }
    // REQ-20260913-004 删除确认（按所在卡片版本打开；遮罩点击关闭，执行中不关防误触）
    for (const el of view.querySelectorAll('[data-ver-delete]')) {
      el.addEventListener('click', () => openDeleteConfirm(el.dataset.verDelete));
    }
    q('#bldDeleteCancel')?.addEventListener('click', () => {
      if (state.deleteBusy) return;
      state.deleteConfirm = null;
      render();
    });
    q('#bldDeleteGo')?.addEventListener('click', doDelete);
    q('#bldDeleteWrap')?.addEventListener('click', (e) => {
      if (state.deleteBusy || e.target !== e.currentTarget) return;
      state.deleteConfirm = null;
      render();
    });
    // 回填弹窗（同一弹窗内完成复制 → 粘贴 → 解析 → 编辑 → 应用）
    q('#bldCopyPrompt')?.addEventListener('click', copyPrompt);
    q('#bldParseBtn')?.addEventListener('click', parseAnswerPreview);
    q('#bldApplyBtn')?.addEventListener('click', applyParsed);
    // REQ-20260913-006：回填编辑表单输入即时校验（名称空显错禁用应用；描述无即时校验）
    q('.bld-name-edit')?.addEventListener('input', onAnswerEditInput);
    q('.bld-desc-edit')?.addEventListener('input', onAnswerEditInput);
    q('#bldAnswerClose')?.addEventListener('click', () => { state.answer = null; render(); });
    // BUG-20260913-005：弹窗内「去新建 XX 会话」——守卫与点击口径同任务面板
    // （未选项目 / 未检测到 → 仅 toast 说明，不复制不导航；守卫通过后先复制本弹窗提示词后跳深链）。
    // 单一触发路径（preventDefault 后统一按最新 state.project 构造深链），键盘 Enter 同路径。
    for (const el of view.querySelectorAll('[data-bld-new-session]')) {
      el.addEventListener('click', (ev) => {
        ev?.preventDefault?.();
        const agent = el.dataset.bldNewSession;
        if (!state.project) {
          toast('未选择项目：请先在顶栏选择项目后再新建会话', true);
          return;
        }
        if (state.workspaceApps[agent] === false) {
          toast(agent === 'codex'
            ? '未检测到 ChatGPT.app：可能未安装或装在非默认路径，可直接打开 ChatGPT 手动新建会话并粘贴提示词'
            : '未检测到 ZCode.app：可能未安装或装在非默认路径，可直接打开 Zcode 手动新建会话并粘贴提示词', true);
          return;
        }
        const url = agent === 'codex'
          ? `codex://threads/new?path=${encodeURIComponent(state.project)}`
          : `zcode://workspace/open?path=${encodeURIComponent(state.project)}`;
        copyPromptAndOpenSession(agent, url); // fire-and-forget：先复制后跳转（含失败/空态 toast）
      });
    }
    // 探测失败后的「重新检测」（force 绕过 failed 防重，探测结束自动刷出结果）
    q('[data-bld-ws-retry]')?.addEventListener('click', (ev) => { ev?.preventDefault?.(); refreshWorkspaceApps(true); });
    // 合并确认
    q('#bldMergeCancel')?.addEventListener('click', () => { state.mergeConfirm = null; render(); });
    q('#bldMergeGo')?.addEventListener('click', doMerge);
    // 新建 / 添加面板
    q('#bldPanelClose')?.addEventListener('click', () => { state.createPanel = null; state.addPanel = null; render(); });
    q('#bldPanelMask')?.addEventListener('click', () => { state.createPanel = null; state.addPanel = null; render(); });
    q('#bldPanelRetry')?.addEventListener('click', () => { if (state.createPanel) openCreatePanel(); else openAddPanel(); });
    q('#bldCreateBtn')?.addEventListener('click', submitCreate);
    q('#bldAddSubmit')?.addEventListener('click', submitAdd);
    // BUG-20260914-002：pickAll 内部统一 render——「全选」的跳过提示与界面更新同时生效
    //（提示不替代渲染）；「全不选」同样即时清空界面，两个面板共用该路径。
    q('#bldPickAll')?.addEventListener('click', () => {
      const key = state.createPanel ? 'createPanel' : 'addPanel';
      const skipped = pickAll(key, true);
      if (skipped) toast(`已全选有 commit 候选的条目；${skipped} 个条目暂无关联提交已跳过`);
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
    if (state.deleteConfirm) { if (!state.deleteBusy) { state.deleteConfirm = null; render(); } return; }
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
    // 行为接缝（BUG-20260913-004：openAnswerModal / openMergeConfirm 支持 verId 定位卡片版本；
    // REQ-20260913-004：openDeleteConfirm / doDelete 删除确认与执行）
    openAnswerModal, openMergeConfirm, openDeleteConfirm, doDelete,
    getCandidates: () => state.createPanel?.candidates || [],
    searchStats,
  };
})();

window.ATBBuild = ATBBuild;
