'use strict';
// 构建模块前端（REQ-20260913-001，版本管理 + 分支浏览与同步）—— 由 app.js 在 view=build 时激活。
// 界面：模块内两个子页签——版本计划（默认）：左版本列表 + 右版本详情（信息编辑 / 条目 ↔ commit 关联
// 与增删）；版本操作（AI 完善 / 合并入 main / 删除）直接放在左侧每张版本卡片内
//（BUG-20260913-004 参照需求列表行内操作口径；删除为 REQ-20260913-004）；分支浏览：左分支列表
//（当前 / 本地 / 远端分组）+ 右提交记录。
// 语义边界（与后端一致，design.md 落定口径）：
//   - 仅已完成（done）的需求单 / Bug 单可纳入版本（BUG-20260913-001）：新建版本 / 添加条目
//     候选只列 done 条目（后端接口已收窄，前端再过滤一次防御旧数据）；无候选时给明确空态；
//   - 一条目至多纳入一个版本（BUG-20260914-004）：已纳入任一版本（draft/merging/merged/failed
//     任一状态）的条目不再出现在新建 / 添加候选（后端已收窄，前端据 state.versions 再过滤一次
//     防御旧缓存）；空态区分「无 done 条目」与「done 条目均已被版本占用」；服务端对跨版本重复
//     纳入兜底拒绝；从 draft/failed 版本移出或删除版本后条目重新可选；
//   - 新建版本 / 添加条目走右侧侧拉面板：选单支持全选 / 全不选（全选只纳入有 commit 候选的条目）；
//   - 「AI 完善」（原「提示词与回答回填」，BUG-20260913-004 更名）为同一弹窗两段式：上段复制提示词、
//     下段粘贴回答解析回填，无需关闭再打开；解析成功后预览区为可编辑表单（REQ-20260913-006）——
//     名称 / 描述预填解析值，可直接修改，「应用」保存编辑后的值（回答原文是唯一解析来源，
//     重新解析以最新结果预填并覆盖未保存的手工修改）；
//   - 合并入 main 前弹确认框（列 commit 清单），确认即授权；执行中禁用重复触发；
//   - 删除版本（REQ-20260913-004）必经确认弹窗：按状态差异化提示（draft/failed 不可恢复，
//     merged 仅移除看板记录；merging 禁删）；执行中确认键禁用防重复，成功后列表与详情同步回落；
//   - 分支浏览只读；同步仅「和远端同步（fetch --prune）」（原「同步远端」，BUG-20260914-005 更名）
//     与本地分支「推送」两个显式入口；
//   - 非 git 仓库显示引导空态，不出现可点击但必然失败的入口。
// BUG-20260915-014：右侧版本详情新增「概况 / 发布」页签——发布记录按当前项目 + 当前版本
//（bldId）就地展示（列表 / 详情 / 预检 / 计划确认 / 重试沿用现有产品发布流程与允许状态），
// 「查看发布记录」与创建成功后的落点均为本页签，不再跳转被暂态隐藏的发布模块（旧跨模块
// 跳转即缺陷根因：setView 对 HIDDEN_VIEWS 回落需求模块并 toast「已暂时隐藏」）。
// 状态机：loading → ready | error（读取失败重试）；发布页签数据独立
//（idle → loading → ready | error，详情 detailPhase 单独管理）。

const ATBBuild = (() => {
  const $ = (s, el = document) => el.querySelector(s);

  const STATUS_LABEL = { draft: '计划中', merging: '合并中', merged: '已合并', failed: '失败' };
  const STATUS_CLS = { draft: 'st-mute', merging: 'st-run', merged: 'st-ok', failed: 'st-fail' };
  // BUG-20260915-014：发布页签运行 / 阶段 / 目标状态标签（沿用 release.js 产品发布口径：
  // succeeded 为「已发布」，与版本计划的「已合并」区分；draft 是草稿，不显示为已发布）
  const REL_STATUS_LABEL = { draft: '草稿', prechecking: '预检', running: '进行中', 'waiting-manual': '等待人工', succeeded: '已发布', failed: '失败', canceled: '已取消' };
  const REL_STEP_LABEL = { pending: '待执行', running: '进行中', done: '已完成', failed: '失败', canceled: '已取消' };
  const TABS = [['versions', '版本计划'], ['branches', '分支浏览']];
  const HASH_RE = /^[0-9a-f]{40}$/i;
  // REQ-20260915-003：关联条目联合列表每页条数——产品参数待确认（条目 README「待确认」：
  // 演示用 5 条不代表产品默认值），先取 10（版本关联单通常个位到十位数，10 条平衡翻页与扫视）
  const ITEMS_PAGE_SIZE = 10;

  const state = {
    project: null,
    phase: 'loading', // loading | ready | error
    error: null,
    data: null,          // /api/build/state 响应 { initialized, isRepo, currentBranch, versions }
    tab: 'versions',
    query: '',
    selVerId: null,
    // REQ-20260915-003：关联条目联合列表搜索与分页——itemsQuery 为已生效关键词（空 = 全量），
    // itemsQueryInput 为输入框草稿（重渲染回填防丢字），itemsPage 当前页（1 起）；
    // 切换版本清空搜索并回第一页，数据减少导致页码越界时回落最后有效页（渲染时校正回写）
    itemsQuery: '',
    itemsQueryInput: '',
    itemsPage: 1,
    edit: null,          // { id, field: 'name'|'desc' } 行内编辑态
    createPanel: null,   // { candidates, picked:Set, commits:{itemId:hash}, name, totalDone, busy, error }
    addPanel: null,      // { verId, candidates, picked:Set, commits:{itemId:hash}, totalDone, busy, error }
    //（totalDone：候选接口占用过滤前的 done 条目总数，用于空态区分「无 done 条目」与
    // 「done 条目均已被版本占用」——BUG-20260914-004）
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
    // REQ-20260915-002 产品发布：从已合并版本创建发布（弹层仅核对发行版本号，其余自动带入）
    releaseConfirm: null, // { verId, version, busy, error }
    // REQ-20260920-003 五步流程：右侧详情按 版本计划 → 关联条目与提交 → 文档编写 → 合并入
    // main → 正式发布 分步导航（替代原「概况 / 发布」两页签）；随项目 / 版本切换重置回 plan
    step: 'plan', // plan | link | docs | merge | release
    // 发布流程数据（/api/build/publish-plan + /api/build/docs 装配；以 verId 归属隔离，
    // seq 丢弃切换版本 / 项目后迟到的旧响应）：phase: idle → loading → ready | error
    pf: null, // { verId, seq, phase, error, plan, file, mode, content, busy, savedMsg, commitMsg, ideMsg, siteBusy }
    // 官网检测轮询句柄（60 秒一轮；离开发布步 / 切换版本 / 切换页签即停止，返回可继续核对）
    siteTimer: null,
    // 发布页签数据（以 verId 归属隔离；seq/detailSeq 丢弃切换版本 / 项目后迟到的旧响应）
    // phase: idle → loading → ready | error；detailPhase: idle | loading | ready | error
    rel: null, // { verId, seq, phase, error, runs, runId, detailSeq, detailPhase, detailError, detail, planModal, busy }
    branches: null,      // /api/build/branches 响应
    branchesPhase: 'idle', // idle | loading | error
    branchesError: null,
    logBranch: null,
    branchLog: null,     // { branch, commits, total, limit, offset }（BUG-20260914-009：total 供分页）
    logPhase: 'idle',
    logError: null,      // 翻页失败行内错误（保留已加载内容时展示；首次加载失败走 logPhase='error'）
    logPage: 1,          // BUG-20260914-009：当前渲染页（1 起）
    logPageSize: 50,     // 每页条数（20/50/100）
    logRetryTarget: null, // 翻页失败后重试的目标页
    // REQ-20260920-001：历史拓扑图选中节点（hash）；切换分支重置，跨页保留
    logSelected: null,
    // REQ-20260914-002：提交记录关键词搜索——logQuery 为已提交生效的关键词（空 = 默认分页列表，
    // 搜索范围 = 当前所选分支全部提交，服务端过滤）；logQueryInput 为输入框草稿（重渲染回填防丢字），
    // 与顶部模块搜索 state.query 互不串扰
    logQuery: '',
    logQueryInput: '',
    syncBusy: false,
    pushBusy: false,
    // BUG-20260914-011：最近一次同步结果（{ pushed, failed, skipped, remote }）——空态细分依据；
    // pushed/failed 逐分支收集（服务端 syncRemote），null = 本会话尚未成功同步过
    lastSync: null,
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

  // BUG-20260914-004 口径：一条目至多纳入一个版本——已纳入任一版本（draft/merging/merged/
  // failed 任一状态）的条目视为占用。候选接口已在后端源头收窄，前端据 state.data.versions
  // 再过滤一次防御旧缓存 / 混杂数据（占用状态可跨版本任一状态成立，与版本状态机无关）。
  function occupiedItemIds(versions) {
    const set = new Set();
    for (const v of versions || []) {
      for (const it of v.items || []) set.add(it.itemId);
    }
    return set;
  }

  // 全选口径：只纳入有 commit 候选的条目（无提交条目自动跳过并提示）
  function selectableCandidates(items) {
    return (items || []).filter((x) => Array.isArray(x.commits) && x.commits.length > 0);
  }

  // REQ-20260915-003：关联条目联合行过滤（纯函数，渲染与测试共用）——一条关联单及其所选
  // commit 为一个联合行；关键词覆盖条目 ID、标题与完整/短 commit 哈希（短哈希是完整哈希的
  // 前缀，包含匹配天然覆盖）；忽略英文大小写、去首尾空白、按包含关系匹配、保持原顺序。
  // 字段间以 \t 分隔，避免标题结尾与哈希开头在拼接边界串出假词误命中。
  function filterVersionItems(items, q) {
    const list = items || [];
    const kw = String(q || '').trim().toLowerCase();
    if (!kw) return list;
    return list.filter((it) => `${it.itemId}\t${it.title || ''}\t${it.commit || ''}`.toLowerCase().includes(kw));
  }

  // REQ-20260915-003：关联列表分页（纯函数）——页码从 1 起；页码越界回落最后有效页
  // （数据减少导致当前页失效时回退）；零结果 total=0 / pages=0（不产生可翻页的虚假页数）。
  function paginateItems(list, page, size) {
    const src = list || [];
    const total = src.length;
    const n = Math.max(1, Math.floor(Number(size)) || 1);
    const pages = total ? Math.ceil(total / n) : 0;
    const p = Math.max(1, Math.min(pages || 1, Math.floor(Number(page)) || 1));
    const start = (p - 1) * n;
    return { total, pages, page: p, size: n, start, rows: src.slice(start, start + n) };
  }

  // BUG-20260914-009：提交记录分页条（纯函数，渲染与测试共用）——上一页 / 页码（首末 + 当前±1，
  // 中间折叠 …）/ 下一页 + 每页条数下拉（20/50/100）+「第 x–y 条 / 共 N 条」进度。
  function logPagerHtml(page, pages, size, total) {
    const p = Math.max(1, Math.min(pages, page));
    const start = (p - 1) * size;
    const len = Math.max(0, Math.min(size, total - start));
    const want = [];
    for (let i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - p) <= 1) want.push(i);
      else if (want[want.length - 1] !== '…') want.push('…');
    }
    const nums = want.map((w) => w === '…'
      ? '<span class="bld-log-gap">…</span>'
      : `<button type="button" data-pg="${w}"${w === p ? ' class="on" aria-current="page"' : ''}>${w}</button>`).join('');
    const sizes = [20, 50, 100].map((n) => `<option value="${n}"${n === size ? ' selected' : ''}>${n} 条/页</option>`).join('');
    return `
      <div class="bld-log-pager" role="navigation" aria-label="提交记录分页">
        <button type="button" data-pg="prev"${p <= 1 ? ' disabled' : ''}>上一页</button>
        ${nums}
        <button type="button" data-pg="next"${p >= pages ? ' disabled' : ''}>下一页</button>
        <select id="bldLogSize" aria-label="每页条数">${sizes}</select>
        <span class="bld-log-range">第 ${start + 1}–${start + len} 条 / 共 ${total} 条</span>
      </div>`;
  }

  // REQ-20260914-002：命中关键词高亮（可选增强落地口径）——转义后按大小写不敏感固定子串
  // 切分包裹 <mark>（非正则；q 空或未命中返回纯转义文本）。toLowerCase 改变长度的大小写
  // 特例（罕见 Unicode）下退回纯转义，保证不切错位。
  function markMatch(text, q) {
    const s = String(text == null ? '' : text);
    const kw = String(q || '');
    if (!kw) return esc(s);
    const lower = s.toLowerCase();
    const kLower = kw.toLowerCase();
    if (lower.length !== s.length || kLower.length !== kw.length) return esc(s);
    const i = lower.indexOf(kLower);
    if (i < 0) return esc(s);
    const end = i + kw.length;
    return esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, end)) + '</mark>' + markMatch(s.slice(end), kw);
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
    const prevSel = state.selVerId;
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
    // REQ-20260915-003：选中版本变化（回落 / 删除后失效）时按切换版本口径重置关联列表；
    // 同版本刷新（移出条目等数据操作后）保留搜索条件，仅由渲染层校正越界页码
    if (state.selVerId !== prevSel) resetItemsList();
    render();
  }

  // REQ-20260915-003：切换选中版本——清空关联列表搜索（关键词与草稿）并回第一页
  //（口径同分支浏览切分支重置搜索）；同时清行内编辑态，与原卡片点击行为一致。
  // BUG-20260915-014：一并清空发布页签数据（旧版本记录 / 选中运行 / 错误不带入新版本）。
  // REQ-20260920-003：五步流程数据与轮询一并重置（step 回「版本计划」，旧版本轮询停止）。
  function selectVersion(id) {
    state.selVerId = id;
    state.edit = null;
    state.rel = null;
    state.pf = null;
    stopSiteTimer();
    resetItemsList();
  }

  // REQ-20260915-003：重置关联列表搜索与分页状态（切换版本 / 切换项目 / 恢复快照时）
  function resetItemsList() {
    state.itemsQuery = '';
    state.itemsQueryInput = '';
    state.itemsPage = 1;
  }

  async function enter(project) {
    const changed = project !== state.project;
    if (changed) {
      Object.assign(state, {
        project: project ?? null, phase: 'loading', error: null, data: null, tab: 'versions',
        selVerId: null, edit: null, createPanel: null, addPanel: null, answer: null,
        itemsQuery: '', itemsQueryInput: '', itemsPage: 1, // REQ-20260915-003：关联列表搜索分页随项目切换重置
        // BUG-20260915-014：详情页签与发布数据随项目切换重置（页签回概况，旧项目记录不串用）；
        // REQ-20260920-003：五步流程与官网轮询随项目切换重置（step 回 plan）
        step: 'plan', rel: null, pf: null,
        mergeConfirm: null, pushConfirm: null, mergeBusy: false,
        deleteConfirm: null, deleteBusy: false,
        branches: null, branchesPhase: 'idle', branchesError: null,
        logBranch: null, branchLog: null, logPhase: 'idle', logError: null,
        logPage: 1, logPageSize: 50, logRetryTarget: null, // BUG-20260914-009：分页状态随项目切换重置
        logQuery: '', logQueryInput: '', // REQ-20260914-002：搜索状态随项目切换重置
        logSelected: null, // REQ-20260920-001：拓扑图选中节点随项目切换重置
        syncBusy: false, pushBusy: false,
        remoteSynced: false, // BUG-20260914-006：本会话是否已成功同步远端——空态区分依据
        lastSync: null, // BUG-20260914-011：同步结果明细（pushed/failed/skipped）随项目切换重置
        rendered: false, pendingRestore: state.pendingRestore,
      });
      stopSiteTimer(); // REQ-20260920-003：切换项目停止旧项目官网轮询
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

  // BUG-20260914-009：选中分支查看提交记录（分页）——切换分支重置回第一页（page 可省略）。
  // REQ-20260914-002：切换分支同时重置搜索（关键词与草稿清空、回默认列表）；同分支重载
  //（「⟳ 和远端同步」后 doSync 内本函数同名重载链路）不重置，保持关键词口径重查。
  function selectBranch(branch, page = 1) {
    if (branch !== state.logBranch) {
      state.logQuery = '';
      state.logQueryInput = '';
      state.logSelected = null; // REQ-20260920-001：切分支清空拓扑图选中节点
    }
    state.logBranch = branch;
    return loadLog(page);
  }

  // 加载指定页提交记录：请求带 limit/offset；翻页失败保留已加载内容（页码回退）+
  // 行内错误与重试入口；首次加载失败维持原口径（清空 + error 态）。
  // REQ-20260914-002：logQuery 非空时请求附加 q（服务端全量过滤分页，能命中当前页之外的提交）。
  async function loadLog(page = 1) {
    const branch = state.logBranch;
    if (!branch) return;
    const prev = { page: state.logPage, data: state.branchLog, branch: state.branchLog?.branch };
    state.logPage = Math.max(1, Math.floor(page) || 1);
    state.logPhase = 'loading';
    state.logError = null;
    render();
    try {
      const size = state.logPageSize;
      const q = state.logQuery ? `&q=${encodeURIComponent(state.logQuery)}` : '';
      const r = await api(`/branch-log?branch=${encodeURIComponent(branch)}&limit=${size}&offset=${(state.logPage - 1) * size}${q}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      state.branchLog = data;
      state.logPhase = 'idle';
      state.logRetryTarget = null;
    } catch (e) {
      state.logError = e.message;
      if (prev.data && prev.branch === branch) {
        // 翻页/换页失败：保留已加载页内容与页码，重试重发目标页
        state.logPage = prev.page;
        state.logPhase = 'idle';
        state.logRetryTarget = Math.max(1, Math.floor(page) || 1);
      } else {
        state.branchLog = null;
        state.logPhase = 'error';
      }
    }
    render();
  }

  // REQ-20260914-002：提交搜索——提交当前输入框草稿为生效关键词并回第一页；
  // 空白关键词等同清除（恢复默认列表）；执行中（loading）忽略重复触发。
  function submitLogSearch() {
    if (state.logPhase === 'loading') return;
    state.logQuery = String(state.logQueryInput || '').trim();
    return loadLog(1);
  }

  // REQ-20260914-002：清除搜索——关键词与草稿清空，回默认全量分页列表第一页。
  function clearLogSearch() {
    if (state.logPhase === 'loading') return;
    state.logQuery = '';
    state.logQueryInput = '';
    return loadLog(1);
  }

  function gotoLogPage(page) {
    if (!state.logBranch) return;
    const total = Number(state.branchLog?.total ?? 0);
    const pages = Math.max(1, Math.ceil(total / state.logPageSize));
    const p = Math.max(1, Math.min(pages, Math.floor(page) || 1));
    if (p === state.logPage && state.logPhase === 'idle' && !state.logError) return;
    loadLog(p);
  }

  function retryLogPage() {
    const target = state.logRetryTarget;
    state.logRetryTarget = null;
    loadLog(target ?? state.logPage);
  }

  function setLogPageSize(size) {
    const n = [20, 50, 100].includes(Number(size)) ? Number(size) : 50;
    if (n === state.logPageSize && !state.logError) return;
    state.logPageSize = n;
    if (state.logBranch) loadLog(1); // 换每页条数回第一页
  }

  /* ---------- REQ-20260920-001 历史拓扑图（logGraph 纯函数 + 行内 SVG + 节点选择） ---------- */

  // 轨道调色板类数（lg-c0..lg-c5 循环，颜色走 style.css 的 --git-lg*，深浅色自适应）
  const GRAPH_LANES = 6;
  const GRAPH_ROW_H = 30;  // 行内图形高度（与 .bld-graph 样式一致）
  const GRAPH_LANE_W = 13; // 每条轨道列宽

  // 纯函数：按真实父子关系计算每行轨道与连线（新→旧 commits，含 hash / parents；缺 parents 视为无父）。
  // 布局同 `git log --graph` 直觉：lanes 为跨行延续的线（下标即列位），提交命中已有线则该线终止于节点，
  // 第一父优先复用节点原槽位（主线直下），其余父向右分叉或汇入已有线；父提交不在当前展示集合
  //（搜索过滤 / 页边界未加载）时不画实线直连，改虚线延续并计入 hiddenParents。根提交（无父）无向下边。
  // hasAbove：首行上方是否还有未随行加载的上下文（翻页 offset>0 或搜索态）——有真实父提交时画上方虚线桩，
  // 不把页边界提交误判成根。
  // BUG-20260920-002：colorOf(hash) → 色号（可选）——按分支身份稳定配色（main→0 / dev→1）：
  // 命中时节点与父边用分支色（同 hash 恒同色，翻页 / 搜索子集不跳变；节点在 dev 色线上时仍按
  // 自身 side 配色，汇聚点不误染）；未命中（单支 / 缺 side 的隐藏上下文）回落既有槽位分配。
  // mergeBase（可选）：命中行的 mergeBase=true 并给 mbTo（水平汇聚虚线目标车道——取该行上方
  // 其他延续线中最近的车道，单线汇聚时用相邻车道），供渲染层画汇聚连线与「Merge-base」标注。
  // 输出 { rows, laneCount }；row = { hash, lane, color, merge, parentCount,
  // hiddenParents, stubAbove, segments, mergeBase, mbTo }；segment = { x1, x2, color, dashed, fromNode }
  //（x 为列号；fromNode=父边自节点半高处出发，否则为贯穿行的延续线；dashed=上下文缺失虚线）。
  function logGraph(commits, { hasAbove = false, colorOf = null, mergeBase = null } = {}) {
    const list = Array.isArray(commits) ? commits : [];
    const shown = new Set(list.map((c) => c.hash));
    const tint = (hash, fallback) => { // 分支色优先，未命中回落槽位（fallback 惰性求值保持 nextColor 语义）
      if (colorOf) {
        const n = colorOf(hash);
        if (Number.isInteger(n)) return n;
      }
      return fallback();
    };
    let lanes = []; // 上一行底部延续下来的线：{ hash, color }
    let nextColor = 0;
    let laneCount = 1;
    const rows = list.map((c, i) => {
      const parents = Array.isArray(c.parents) ? c.parents : [];
      let nodeX;
      let ownColor;
      const kept = []; // 本节点以下继续的线（保持相对顺序；节点所在线终止于节点）
      lanes.forEach((l) => {
        if (nodeX === undefined && l.hash === c.hash) { nodeX = kept.length; ownColor = l.color; return; }
        kept.push(l);
      });
      const stubAbove = nodeX === undefined && parents.length > 0 && (i > 0 || hasAbove);
      const ownTint = colorOf ? colorOf(c.hash) : undefined;
      if (nodeX === undefined) { nodeX = kept.length; ownColor = Number.isInteger(ownTint) ? ownTint : nextColor++ % GRAPH_LANES; }
      else if (Number.isInteger(ownTint)) ownColor = ownTint; // 命中已有线也按分支色覆盖线色
      const bottom = kept.slice(); // 底部线槽（顺序即下行位置；父边新槽插入其中）
      const hiddenParents = [];
      const hiddenEdges = [];
      const parentEdges = [];
      parents.forEach((p, pi) => {
        const existIdx = bottom.findIndex((l) => l.hash === p);
        if (!shown.has(p)) {
          // 父提交不在展示集合：虚线延续（临时槽，不进入下一行状态）
          hiddenParents.push(p);
          return;
        }
        if (existIdx >= 0) {
          // 汇入已有线（分支合并回该线）：沿用该线颜色
          parentEdges.push({ target: existIdx, color: bottom[existIdx].color });
          return;
        }
        // 新线：第一父复用节点原槽位（主线直下、同色），其余父新色右移
        const color = pi === 0 ? ownColor : tint(p, () => nextColor++ % GRAPH_LANES);
        const slot = Math.min(pi === 0 ? nodeX : bottom.length, bottom.length);
        bottom.splice(slot, 0, { hash: p, color });
        parentEdges.push({ target: slot, color });
      });
      // 隐藏父边落位在最右（绘制专用，不影响真实线）
      hiddenParents.forEach(() => {
        hiddenEdges.push({ target: bottom.length + hiddenEdges.length, color: ownColor });
      });
      // 延续线段：顶部位置（before 下标）→ 底部位置（bottom 下标）；位置变化画曲线绕行
      const segments = kept.map((l) => ({
        x1: lanes.indexOf(l), x2: bottom.indexOf(l), color: l.color, dashed: false, fromNode: false,
      }));
      for (const e of parentEdges) segments.push({ x1: nodeX, x2: e.target, color: e.color, dashed: false, fromNode: true });
      for (const e of hiddenEdges) segments.push({ x1: nodeX, x2: e.target, color: e.color, dashed: true, fromNode: true });
      // BUG-20260920-002：merge-base 行汇聚标记（mbTo = 上方其他延续线中最近车道；无则相邻车道）
      let isMb = false;
      let mbTo = null;
      if (mergeBase && c.hash === mergeBase) {
        isMb = true;
        const others = [];
        lanes.forEach((l, idx) => { if (l.hash !== c.hash) others.push(idx); });
        mbTo = others.length
          ? others.reduce((best, idx) => (Math.abs(idx - nodeX) < Math.abs(best - nodeX) ? idx : best))
          : nodeX + 1;
      }
      laneCount = Math.max(laneCount, lanes.length, bottom.length + hiddenEdges.length, nodeX + 1, mbTo != null ? mbTo + 1 : 0);
      lanes = bottom;
      return {
        hash: c.hash, lane: nodeX, color: ownColor, merge: parents.length >= 2, parentCount: parents.length,
        hiddenParents, stubAbove, segments, mergeBase: isMb, mbTo,
      };
    });
    return { rows, laneCount };
  }

  // 行内 SVG：每行固定高度、按 laneCount 自适应宽（flex 布局下列宽恒定，行不错位）。
  // 合并节点双圈（非仅颜色），配合行内「合并 · N 父提交」文字标签。
  // BUG-20260920-002：opts.head 画分支头节点外圈；mergeBase 行画水平汇聚虚线（lg-mb，宽度覆盖 mbTo）。
  function graphSvg(row, laneCount, opts = {}) {
    const w = Math.max(laneCount, row.lane + 1, row.mbTo != null ? row.mbTo + 1 : 0) * GRAPH_LANE_W + 4;
    const mid = GRAPH_ROW_H / 2;
    const x = (col) => col * GRAPH_LANE_W + 4;
    const parts = row.segments.map((s) => {
      const cls = `lg-c${s.color}`;
      const dash = s.dashed ? ' stroke-dasharray="4 3"' : '';
      if (s.fromNode) {
        const d = s.x1 === s.x2
          ? `M ${x(s.x1)} ${mid} V ${GRAPH_ROW_H}`
          : `M ${x(s.x1)} ${mid} C ${x(s.x1)} ${mid + 7}, ${x(s.x2)} ${GRAPH_ROW_H - 8}, ${x(s.x2)} ${GRAPH_ROW_H}`;
        return `<path d="${d}" class="${cls}"${dash}/>`;
      }
      const d = s.x1 === s.x2
        ? `M ${x(s.x1)} 0 V ${GRAPH_ROW_H}`
        : `M ${x(s.x1)} 0 C ${x(s.x1)} 8, ${x(s.x2)} ${mid - 7}, ${x(s.x2)} ${mid} L ${x(s.x2)} ${GRAPH_ROW_H}`;
      return `<path d="${d}" class="${cls}"/>`;
    });
    if (row.stubAbove) parts.push(`<path d="M ${x(row.lane)} 0 V ${mid}" class="lg-c${row.color}" stroke-dasharray="4 3"/>`);
    const nx = x(row.lane);
    const mb = row.mergeBase && row.mbTo != null && row.mbTo !== row.lane
      ? `<path d="M ${nx} ${mid} H ${x(row.mbTo)}" class="lg-mb"/>` : '';
    const node = row.merge
      ? `<circle cx="${nx}" cy="${mid}" r="6" class="lg-node lg-c${row.color}"/><circle cx="${nx}" cy="${mid}" r="2.4" class="lg-dot" fill="var(--git-lg${row.color})"/>`
      : `<circle cx="${nx}" cy="${mid}" r="4" class="lg-node lg-c${row.color}"/>`;
    const headRing = opts.head ? `<circle cx="${nx}" cy="${mid}" r="8.5" class="lg-head"/>` : '';
    return `<svg class="bld-graph" width="${w}" height="${GRAPH_ROW_H}" viewBox="0 0 ${w} ${GRAPH_ROW_H}" aria-hidden="true"><g class="lg-lines">${parts.join('')}</g>${mb}${node}${headRing}</svg>`;
  }

  // REQ-20260920-001：选中提交节点（click 切换 / focus 直选同一路径）——重渲染出详情区；
  // 渲染后回焦选中行，键盘 Tab 浏览不丢焦点。已选中重复触发（focus 重入）不重渲染防循环。
  function selectLogRow(hash, opts = {}) {
    if (opts.toggle && state.logSelected === hash) {
      state.logSelected = null;
      render();
      return;
    }
    if (state.logSelected === hash) return;
    state.logSelected = hash;
    render();
    try {
      document.querySelector('#buildView')?.querySelector(`[data-log-row="${hash}"]`)?.focus?.();
    } catch { /* 测试桩环境无 DOM focus */ }
  }

  /* ---------- REQ-20260915-003 关联条目联合列表：搜索与分页（纯客户端） ---------- */

  // 关联列表数据快照：当前选中版本 → 全量过滤 → 分页；渲染层把越界页码校正回写
  // state.itemsPage（数据减少导致当前页失效时回落最后有效页）。无选中版本返回 null。
  function itemsPageView() {
    const v = selVersion();
    if (!v) return null;
    const pg = paginateItems(filterVersionItems(v.items, state.itemsQuery), state.itemsPage, ITEMS_PAGE_SIZE);
    state.itemsPage = pg.page;
    return pg;
  }

  // 提交搜索：输入框草稿去首尾空白后生效（空白等同清除），关键词变化回第一页。
  // 数据为当前版本全量关联行（客户端过滤），不涉及请求。
  function submitItemsSearch() {
    state.itemsQuery = String(state.itemsQueryInput || '').trim();
    state.itemsPage = 1;
    render();
  }

  // 清空搜索：关键词与草稿清空，回全量列表第一页。
  function clearItemsSearch() {
    state.itemsQuery = '';
    state.itemsQueryInput = '';
    state.itemsPage = 1;
    render();
  }

  // 翻页：页码经 paginateItems 收口（越界回落），相同页不重渲染。
  function gotoItemsPage(page) {
    const v = selVersion();
    if (!v) return;
    const pg = paginateItems(filterVersionItems(v.items, state.itemsQuery), page, ITEMS_PAGE_SIZE);
    if (pg.page === state.itemsPage) return;
    state.itemsPage = pg.page;
    render();
  }

  /* ---------- 版本计划：创建 / 编辑 / 条目 ---------- */

  async function openCreatePanel() {
    state.createPanel = { candidates: null, picked: new Set(), commits: {}, name: '', totalDone: null, busy: false, error: null, loadError: null };
    render();
    try {
      const r = await api('/candidates');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      const occupied = occupiedItemIds(state.data?.versions); // BUG-20260914-004：已纳入任一版本的条目不进候选
      state.createPanel.candidates = doneCandidates(data.items || []).filter((x) => !occupied.has(x.itemId)); // BUG-20260913-001：仅 done 条目进候选
      state.createPanel.totalDone = Number.isInteger(data.totalDone) ? data.totalDone : null;
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
    state.addPanel = { verId: v.id, candidates: null, picked: new Set(), commits: {}, totalDone: null, busy: false, error: null, loadError: null };
    render();
    try {
      const r = await api('/candidates');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      const have = new Set(v.items.map((x) => x.itemId));
      const occupied = occupiedItemIds(state.data?.versions); // BUG-20260914-004：其他版本占用条目同样排除
      // BUG-20260913-001：与新建版本同口径——仅 done 条目进候选，且排除已在本版本中的条目；
      // BUG-20260914-004：再排除已纳入任一版本（含本版本与其他版本）的条目
      state.addPanel.candidates = doneCandidates(data.items || []).filter((x) => !have.has(x.itemId) && !occupied.has(x.itemId));
      state.addPanel.totalDone = Number.isInteger(data.totalDone) ? data.totalDone : null;
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
  // BUG-20260920-005：锁定基准后移——推送完成（正式发布）后不允许再 AI 完善（卡片按钮已
  // 禁用），此处对带参直调与无参回落两条路径兜底校验（merging 同步收口），锁定态一律不弹窗；
  // merged（已合并未推送）放开，可完整走通复制 → 解析 → 应用回填。
  function openAnswerModal(verId) {
    const v = verId ? findVersion(verId) : selVersion();
    if (!v) return;
    if (v.status === 'merging' || pushedOf(v)) return;
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

  // BUG-20260920-006：「合并入 main」不可合并真实原因（详情页主按钮与卡片行内按钮共用，
  // 返回 '' 表示可合并）。优先级：全局合并执行中 > 版本 merging > 已正式发布（BUG-20260920-005
  // 基准，merged 未推送可增量重开）> 五步门禁（暂无关联条目 / 文档未编写 / 未提交 / 范围过期，
  // 口径同 publishStepsState 与服务端守卫）> 不在 dev（含 detached HEAD）。
  // 门禁与分支仅当前选中版本已加载五步装配（pfOf(v).plan）时可知；未加载时不猜测，
  // 放行至确认后由后端守卫 409 + toast 给出真实原因（反馈链路完整，不误报）。
  function mergeBlockReason(v) {
    if (!v) return '';
    if (state.mergeBusy || v.status === 'merging') return '合并中，请勿重复触发';
    if (pushedOf(v)) return '已正式发布，不可再合并（如需调整请新建版本）';
    const p = pfOf(v)?.plan || null;
    const gate = p ? (p.steps || []).find((s) => s.key === 'merge') : null;
    if (gate?.locked) return gate.reason || '前置条件未满足';
    if (p && p.currentBranch !== 'dev') {
      return p.currentBranch
        ? `当前分支是 ${p.currentBranch}，不在 dev：请自行切换回 dev 后重试（不自动切分支）`
        : '当前处于 detached HEAD，不在 dev：请自行切换回 dev 后重试（不自动切分支）';
    }
    return '';
  }

  // 打开合并确认弹窗。BUG-20260920-006：守卫分支不再静默——版本不存在（如另一标签页
  // 已删除、本页按钮残留）提示刷新；不可合并（含全局合并执行中）toast 真实原因
  //（口径同 mergeBlockReason），点击不再「消失」。
  function openMergeConfirm(verId) {
    const v = verId ? findVersion(verId) : selVersion();
    if (!v) {
      toast('未找到该版本（可能已被删除）：请刷新页面后重试', true);
      return;
    }
    const reason = mergeBlockReason(v);
    if (reason) {
      toast(reason, true);
      return;
    }
    state.mergeConfirm = { verId: v.id };
    render();
  }

  async function doMerge() {
    // BUG-20260920-006：先查全局合并执行中（防重复触发的真实保护仍在此状态守卫）——
    // 执行中再点（含确认键双击）提示勿重复触发，不再静默；
    // 确认时版本已不存在（删除后残留触发）关闭弹窗并提示刷新。
    if (state.mergeBusy) {
      toast('合并中，请勿重复触发', true);
      return;
    }
    const v = findVersion(state.mergeConfirm?.verId);
    if (!v) {
      state.mergeConfirm = null;
      toast('未找到该版本（可能已被删除）：请刷新页面后重试', true);
      render();
      return;
    }
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

  /* ---------- REQ-20260915-002 产品发布入口 ---------- */

  // 从已合并版本创建发布：弹层仅核对发行版本号（BLD 信息 / 条目 / 冻结事实由服务端自动带入）
  function openReleaseConfirm(verId) {
    const v = verId ? findVersion(verId) : selVersion();
    if (!v) return;
    if (v.status !== 'merged') {
      toast('仅已合并（merged）的版本计划可创建发布：请先完成「合并入 main」', true);
      return;
    }
    state.releaseConfirm = { verId: v.id, version: '', busy: false, error: null };
    render();
  }

  // BUG-20260915-014：发布页签数据（概况/发布两页签中的「发布」）——按当前项目 + 当前版本
  //（bldId）就地展示产品发布记录，替代原跨模块跳转（跳转命中 app.js HIDDEN_VIEWS 回落，
  // 用户被弹回需求模块，即本 Bug 根因）。数据全部只读拉取；预检 / 计划确认 / 启动 / 重试 /
  // 取消沿用既有产品发布流程与允许状态，均需显式点击（start 必经计划确认弹窗）。
  function defaultRel(verId) {
    return {
      verId, seq: 0, phase: 'idle', error: null, runs: null,
      runId: null, detailSeq: 0, detailPhase: 'idle', detailError: null, detail: null,
      planModal: null, busy: false,
    };
  }

  // 当前版本对应的发布页签数据（版本不匹配视为未加载——切换版本 / 项目后整体替换）
  function relOf(v) {
    return state.rel && state.rel.verId === v.id ? state.rel : null;
  }

  // 拉取当前版本的发布记录（GET state 后前端按 bldId 过滤；只读）。
  // force 用于重试 / 动作完成后的刷新；静默丢弃迟到响应：闭包对象与 state.rel 身份
  // 不一致（切换版本 / 项目已重置）或 seq 已前进（新一轮加载）即放弃。
  async function ensureReleaseData(force = false) {
    const v = selVersion();
    if (!v || !state.project) return;
    let rel = relOf(v);
    if (!rel) { rel = defaultRel(v.id); state.rel = rel; }
    if (!force && (rel.phase === 'loading' || (rel.phase === 'ready' && rel.runs))) return;
    const seq = ++rel.seq;
    rel.phase = 'loading';
    rel.error = null;
    render();
    try {
      const r = await fetch(`/api/build-publish/state?project=${encodeURIComponent(state.project)}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      if (state.rel !== rel || rel.seq !== seq) return;
      rel.config = data.config || {};
      rel.runs = (data.runs || []).filter((x) => x.bldId === v.id);
      rel.phase = 'ready';
      if (!rel.runs.some((x) => x.id === rel.runId)) rel.runId = rel.runs[0]?.id || null;
    } catch (e) {
      if (state.rel !== rel || rel.seq !== seq) return;
      rel.runs = null;
      rel.phase = 'error';
      rel.error = e.message;
      render();
      return;
    }
    if (rel.runId) await fetchRelDetail(rel.runId);
    else render();
  }

  // 拉取运行详情（GET run/:id；选择记录与刷新共用；detailSeq 丢弃迟到的旧详情）
  async function fetchRelDetail(id) {
    const rel = state.rel;
    const v = selVersion();
    if (!rel || !v || rel.verId !== v.id) return;
    const seq = ++rel.detailSeq;
    if (rel.runId !== id) rel.directoryActions = {};
    rel.runId = id;
    rel.detailPhase = 'loading';
    rel.detailError = null;
    render();
    try {
      const r = await fetch(`/api/build-publish/run/${encodeURIComponent(id)}?project=${encodeURIComponent(state.project)}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      if (state.rel !== rel || rel.detailSeq !== seq) return;
      rel.detail = data;
      rel.detailPhase = 'ready';
    } catch (e) {
      if (state.rel !== rel || rel.detailSeq !== seq) return;
      rel.detail = null;
      rel.detailPhase = 'error';
      rel.detailError = e.message;
    }
    render();
  }

  function selectReleaseRun(id) {
    if (!id) return;
    return fetchRelDetail(id);
  }

  // 发布动作（POST precheck / refreeze / start / retry / cancel）：显式点击触发；
  // 执行中 busy 禁用防重复；完成只刷新（重发 state + run 读取，不重复执行）
  async function relAction(id, action, payload = {}) {
    const rel = state.rel;
    if (!rel || rel.busy || !id || !action) return;
    rel.busy = true;
    render();
    try {
      const r = await fetch(`/api/build-publish/run/${encodeURIComponent(id)}/${action}?project=${encodeURIComponent(state.project)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `操作失败（${r.status}）`);
      toast(`✓ 已提交发布操作（${action}）：状态刷新后查看结果`);
    } catch (e) {
      toast(`✕ 发布操作失败：${e.message}`, true);
    } finally {
      if (state.rel === rel) rel.busy = false;
      await ensureReleaseData(true);
      // BUG-20260917-001：发布动作完成后顺带重取构建 state，让左侧卡片「已发布」标识随
      // 最新发布状态更新（单次显式动作触发一次刷新，不引入轮询）
      await refresh();
    }
  }

  // 预览发布计划（GET plan，只读装配）：弹窗展示明确计划，确认才 start（沿用既有确认口径）
  async function openRelPlan(id) {
    const rel = state.rel;
    if (!id || !state.project) return;
    try {
      const r = await fetch(`/api/build-publish/run/${encodeURIComponent(id)}/plan?project=${encodeURIComponent(state.project)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      if (state.rel !== rel) return;
      rel.planModal = { runId: id, plan: data.plan || {} };
      render();
    } catch (e) {
      toast(`✕ 发布计划读取失败：${e.message}`, true);
    }
  }

  function closeRelPlan() {
    if (state.rel) state.rel.planModal = null;
    render();
  }

  async function confirmRelStart() {
    const rel = state.rel;
    const id = rel?.planModal?.runId;
    const token = rel?.planModal?.plan?.token;
    if (!rel) return;
    rel.planModal = null;
    if (!id) return;
    await relAction(id, 'start', { token });
  }

  function refreshReleasePane() {
    // BUG-20260917-001：「刷新状态」除重读发布记录外一并重取构建 state，
    // 让左侧卡片「已发布」标识随最新发布状态更新（单次显式动作触发，不引入轮询）
    return ensureReleaseData(true).finally(() => refresh());
  }

  /* ---------- REQ-20260920-003 发布流程数据（publish-plan / docs / release） ---------- */

  function defaultPf(verId) {
    return {
      verId, seq: 0, phase: 'idle', error: null, plan: null,
      file: 'README.md', mode: 'edit', content: null, loadedFile: null,
      busy: false, savedMsg: null, commitMsg: null, ideMsg: null, siteBusy: false,
    };
  }

  const pfOf = (v) => (state.pf && state.pf.verId === v.id ? state.pf : null);

  // 拉取五步装配（GET publish-plan，只读；steps 门禁 / 文档状态 / 提示词 / 影响分析 / 发布状态）。
  // force 用于动作完成后的刷新；迟到响应按闭包身份 + seq 丢弃。
  async function ensurePublishPlan(force = false) {
    const v = selVersion();
    if (!v || !state.project) return;
    let pf = pfOf(v);
    if (!pf) { pf = defaultPf(v.id); state.pf = pf; }
    if (!force && (pf.phase === 'loading' || (pf.phase === 'ready' && pf.plan))) return;
    const seq = ++pf.seq;
    pf.phase = 'loading';
    pf.error = null;
    render();
    try {
      const r = await fetch(`/api/build/publish-plan?project=${encodeURIComponent(state.project)}&id=${encodeURIComponent(v.id)}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      if (state.pf !== pf || pf.seq !== seq) return;
      pf.plan = data;
      pf.phase = 'ready';
    } catch (e) {
      if (state.pf !== pf || pf.seq !== seq) return;
      pf.plan = null;
      pf.phase = 'error';
      pf.error = e.message;
    }
    render();
    if (pf.phase === 'ready' && (state.step === 'docs')) await loadDocFile(pf.file);
  }

  // 读取单个文档内容（GET docs；编辑态回填，测试环境无 DOM 时跳过）
  async function loadDocFile(file) {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf || !state.project) return;
    const seq = ++pf.seq;
    pf.file = file;
    try {
      const r = await fetch(`/api/build/docs?project=${encodeURIComponent(state.project)}&id=${encodeURIComponent(v.id)}&file=${encodeURIComponent(file)}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      if (state.pf !== pf || pf.seq !== seq) return;
      pf.content = data.content == null ? '' : data.content;
      pf.loadedFile = file;
      const box = $('#buildView')?.querySelector('.bld-doc-editor');
      if (box) box.value = pf.content;
    } catch (e) {
      toast(`✕ 文档读取失败：${e.message}`, true);
    }
  }

  function selectDocFile(file) {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf || pf.busy) return;
    // 编辑内容草稿回同步（防切文档丢字）；保存后切换以磁盘为准重读
    syncDocDraft();
    pf.savedMsg = null;
    loadDocFile(file);
  }

  // 重渲染前把编辑框当前值同步回 pf.content（防后台刷新冲掉未保存输入）
  function syncDocDraft() {
    const pf = state.pf;
    if (!pf || pf.mode !== 'edit') return;
    const view = $('#buildView');
    const box = view?.querySelector?.('.bld-doc-editor');
    if (box) pf.content = box.value;
  }

  async function saveDocFile() {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf || pf.busy || !state.project) return;
    syncDocDraft();
    pf.busy = true;
    pf.savedMsg = null;
    render();
    try {
      const r = await fetch(`/api/build/docs/save?project=${encodeURIComponent(state.project)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id, file: pf.file, content: String(pf.content ?? '') }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `保存失败（${r.status}）`);
      pf.savedMsg = `已保存 ${pf.file}（未提交：需「提交文档到 Git」后才能合并）`;
      toast(`✓ 已保存 ${pf.file}`);
      await ensurePublishPlan(true);
    } catch (e) {
      pf.savedMsg = `保存失败：${e.message}（内容已保留，可重试）`;
      toast(`✕ 保存失败：${e.message}`, true);
    } finally {
      pf.busy = false;
      if (state.pf === pf) render();
    }
  }

  async function commitDocs() {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf || pf.busy || !state.project) return;
    syncDocDraft();
    pf.busy = true;
    pf.commitMsg = null;
    render();
    try {
      const r = await fetch(`/api/build/docs/commit?project=${encodeURIComponent(state.project)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `提交失败（${r.status}）`);
      pf.commitMsg = data.noop
        ? '文档没有变化，未制造空提交'
        : `已提交文档（${String(data.commitHash || '').slice(0, 12)}；范围：${(data.files || []).join('、')}）`;
      toast(data.noop ? '文档无变化，未空提交' : `✓ 文档已提交到 Git（${String(data.commitHash || '').slice(0, 8)}）`);
      await Promise.all([ensurePublishPlan(true), refresh()]);
    } catch (e) {
      pf.commitMsg = `提交失败：${e.message}（内容已保留，可重试）`;
      toast(`✕ 文档提交失败：${e.message}`, true);
    } finally {
      pf.busy = false;
      if (state.pf === pf) render();
    }
  }

  async function openIdeApp(app) {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf || pf.busy || !state.project) return;
    pf.busy = true;
    pf.ideMsg = null;
    render();
    try {
      const r = await fetch(`/api/build/docs/open-ide?project=${encodeURIComponent(state.project)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id, app }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `打开失败（${r.status}）`);
      pf.ideMsg = data.message;
      toast(`✓ ${data.message}`);
    } catch (e) {
      pf.ideMsg = e.message; // 未安装 / 启动失败：提示与手动打开路径就地展示
      toast(`✕ ${e.message}`, true);
    } finally {
      pf.busy = false;
      if (state.pf === pf) render();
    }
  }

  /* ---------- 官网检测轮询（60 秒一轮 + 立即检测；离开发布步即停止） ---------- */

  function stopSiteTimer() {
    if (state.siteTimer) { clearInterval(state.siteTimer); state.siteTimer = null; }
  }

  function startSiteTimer() {
    stopSiteTimer();
    if (typeof setInterval !== 'function') return; // 测试沙箱无定时器：跳过（浏览器正常轮询）
    state.siteTimer = setInterval(() => { siteScan(false); }, 60_000);
  }

  async function siteScan(force) {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf || !state.project || pf.siteBusy) return;
    if (!force && state.step !== 'release') return; // 离开发布步不触发
    pf.siteBusy = true;
    try {
      const r = await fetch(`/api/build/release/site-scan?project=${encodeURIComponent(state.project)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id, force: !!force }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `检测失败（${r.status}）`);
      if (state.pf === pf && selVersion()?.id === v.id && data.site) {
        pf.plan = { ...(pf.plan || {}), release: { ...(pf.plan?.release || {}), site: data.site }, siteNotice: data.notice || '' };
        render();
      }
    } catch (e) {
      toast(`✕ 官网检测失败：${e.message}`, true);
    } finally {
      pf.siteBusy = false;
    }
  }

  // 正式发布第一步：推送主分支（只推 main/master 解析结果；成功记录推送完成时间）
  async function pushMain() {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf || pf.busy || !state.project) return;
    const remote = $('#buildView')?.querySelector('.bld-push-main-remote')?.value || 'origin';
    pf.busy = true;
    render();
    try {
      const r = await fetch(`/api/build/release/push?project=${encodeURIComponent(state.project)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id, remote }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `推送失败（${r.status}）`);
      toast(`✓ 已推送主分支 ${data.pushed?.branch || ''} → ${data.pushed?.remote || remote}（推送完成时间已记录，官网检测从该时间起）`);
      await Promise.all([ensurePublishPlan(true), refresh()]);
    } catch (e) {
      toast(`✕ 推送失败：${e.message}（可重试；失败不进入完成状态）`, true);
    } finally {
      pf.busy = false;
      if (state.pf === pf) render();
    }
  }

  // REQ-20260920-003 五步导航切换：步进 / 回退均为浏览位置，数据按需拉取；进入「正式发布」
  // 步启动官网检测轮询（60 秒一轮），离开（任意切步 / 切版本 / 切页签 / 切项目）即停止。
  function setStep(step) {
    const s = ['plan', 'link', 'docs', 'merge', 'release'].includes(step) ? step : 'plan';
    state.step = s;
    stopSiteTimer();
    render();
    if (s === 'docs' || s === 'merge' || s === 'release') ensurePublishPlan();
    if (s === 'release') {
      ensureReleaseData(); // BUG-20260915-014：产品发布记录就地展示（沿用）
      startSiteTimer();
    }
  }

  // 「查看发布记录」新落点：选中所在卡片版本并进入「正式发布」步（不跳隐藏模块）
  function openReleaseTab(verId) {
    const v = verId ? findVersion(verId) : selVersion();
    if (!v) return;
    if (v.id !== state.selVerId) selectVersion(v.id); // 清空旧版本发布数据（含记录与错误）
    state.step = 'release';
    stopSiteTimer();
    render();
    startSiteTimer();
    return ensureReleaseData();
  }

  async function doCreateRelease() {
    const rc = state.releaseConfirm;
    const project = state.project;
    const view = $('#buildView');
    const v = findVersion(rc?.verId);
    if (!v || rc.busy) return;
    const version = (view?.querySelector('#bldRelVersion')?.value || rc.version || '').trim();
    if (!version) {
      state.releaseConfirm.error = '请填写发行版本号（如 1.2.0）';
      render();
      return;
    }
    rc.version = version;
    rc.busy = true;
    rc.error = null;
    render();
    try {
      const sep = state.project ? `?project=${encodeURIComponent(state.project)}` : '';
      const r = await fetch(`/api/build-publish/from-build${sep}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bldId: v.id, version }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `创建失败（${r.status}）`);
      if (state.project !== project || state.releaseConfirm !== rc) return;
      state.releaseConfirm = null;
      const runId = data.run?.id || null;
      toast(`✓ 已创建产品发布 ${runId || ''}（草稿）：请在本页签预检并启动`);
      // BUG-20260915-014：创建成功落在当前版本的发布页签并选中新草稿（不跳隐藏模块）；
      // REQ-20260920-003：落点为五步流程的「正式发布」步
      if (state.selVerId !== v.id) selectVersion(v.id);
      state.step = 'release';
      const rel = relOf(v) || defaultRel(v.id);
      state.rel = rel;
      if (runId) rel.runId = runId;
      render();
      await ensureReleaseData(true);
      if (state.project === project && state.selVerId === v.id && runId) await relAction(runId, 'precheck');
    } catch (e) {
      rc.busy = false;
      rc.error = e.message;
      render();
    }
  }

  function renderReleaseConfirm() {
    const rc = state.releaseConfirm;
    if (!rc) return '';
    const v = findVersion(rc.verId);
    if (!v) { state.releaseConfirm = null; return ''; }
    return `
      <div class="rel-modal-wrap" id="bldReleaseWrap" role="dialog" aria-label="创建产品发布">
        <div class="rel-modal">
          <h3>创建产品发布（${esc(v.id)}）</h3>
          <div class="rel-modal-body">
            <p>版本「<strong>${esc(v.name || v.id)}</strong>」已合并 main，将创建产品发布草稿：</p>
            <ul>
              <li>自动带入：产品、${esc(v.id)}、版本名称与描述、${v.items.length} 个关联条目与 commit、合并证据</li>
              <li>发布目标：Web App 与官网/用户文档（两个必备目标）；源码 main/dev 双分支原子推送为必经前置</li>
              <li>构建命令、产物目录与本机部署环境自动识别配置，无需填写</li>
            </ul>
            <label class="field">发行版本号（与版本显示名分开）
              <input id="bldRelVersion" value="${esc(rc.version)}" placeholder="1.2.0（实际对外发行号）"></label>
            ${rc.error ? `<p class="rel-form-err" role="alert">${esc(rc.error)}</p>` : ''}
            <p class="muted small">创建即冻结 main/dev 分支头与远端目标；预检通过并预览计划后才启动执行。</p>
          </div>
          <footer class="modal-foot">
            <button type="button" class="btn" id="bldRelCancel"${rc.busy ? ' disabled' : ''}>取消</button>
            <button type="button" class="btn primary" id="bldRelGo"${rc.busy ? ' disabled' : ''}>${rc.busy ? '创建中…' : '创建发布草稿'}</button>
          </footer>
        </div>
      </div>`;
  }

  /* ---------- BUG-20260915-014 发布页签渲染（当前项目 + 当前版本 bldId 的产品发布记录） ---------- */

  const relStatusChip = (s) => `<span class="st ${s === 'succeeded' ? 'st-ok' : s === 'failed' ? 'st-fail' : s === 'running' || s === 'prechecking' ? 'st-run' : s === 'waiting-manual' ? 'st-wait' : 'st-mute'}">${esc(REL_STATUS_LABEL[s] || s || '未提供')}</span>`;
  const relStepChip = (s) => `<span class="st ${s === 'done' ? 'st-ok' : s === 'failed' ? 'st-fail' : s === 'running' ? 'st-run' : 'st-mute'}">${esc(REL_STEP_LABEL[s] || s || '未提供')}</span>`;

  // 创建入口（发布页签内，与版本卡片同键 data-ver-release → openReleaseConfirm 同一校验弹层）；
  // 未合并版本禁用并说明前置条件（口径与卡片按钮一致）
  function relCreateBtnHtml(v) {
    const locked = v.status !== 'merged';
    return `<button type="button" class="btn small primary" data-rel-create data-ver-release="${esc(v.id)}"${locked
      ? ' disabled title="请先完成合并入 main（仅已合并 merged 的版本计划可创建发布）"'
      : ' title="从本版本创建产品发布草稿（自动带入条目与冻结信息）"'}>创建并预检</button>`;
  }


  // 构建发布操作区始终可见，缺配置和预检问题就近说明。
  function renderPublishActions(v, rel) {
    const run = rel?.detail?.run;
    const configured = !!rel?.config?.homepageRepoRoot;
    const ready = configured && !!run?.precheck?.ok && ['draft', 'failed', 'canceled'].includes(run?.status) && !rel?.busy;
    const reason = !configured ? '请先配置官网仓库' : !run ? '请先创建并预检' : run.status === 'running' ? '发布中…' : run.status === 'succeeded' ? '已发布' : !run.precheck?.ok ? '请重新预检并处理阻塞项' : '';
    return `<section class="bld-publish-actions"><strong>本版本发布</strong><p>
      <button type="button" class="btn primary" data-rel-act="plan" data-rel-run="${esc(run?.id || '')}"${ready ? '' : ' disabled'}>${run?.status === 'running' ? '发布中…' : run?.status === 'succeeded' ? '已发布' : '发布'}</button>
      ${relCreateBtnHtml(v)} <span class="muted">${esc(reason)}</span>
      ${!configured ? '<button type="button" class="btn" data-publish-settings>前往设置</button>' : ''}</p></section>`;
  }

  function renderPublishDirectories(rel) {
    const dirs = rel.detail.directories || {};
    return `<section><h4>发布目录</h4><div style="display:flex;flex-wrap:wrap;gap:16px">${['webapp', 'site'].map(target => {
      const d = dirs[target] || { reason: '未记录（待确认）' };
      const action = rel.directoryActions?.[target];
      return `<div style="flex:1 1 260px;min-width:0"><strong>${target === 'webapp' ? '构建物目录' : '官网目录'}</strong>
        <p style="overflow-wrap:anywhere;user-select:text">${esc(d.path || d.reason)}</p>
        ${d.repoRoot ? `<p style="overflow-wrap:anywhere">官网仓库根目录：${esc(d.repoRoot)}</p>` : ''}
        <button type="button" class="btn small" data-publish-open="${target}"${d.available && !action?.busy ? '' : ' disabled'}>${action?.busy ? '正在打开…' : '在 Finder 中打开'}</button>
        <p role="status">${esc(action?.message || (!d.available ? d.reason : '') || '')}</p></div>`;
    }).join('')}</div></section>`;
  }

  async function openPublishDirectory(target) {
    const rel = state.rel;
    if (!rel?.runId || rel.directoryActions?.[target]?.busy) return;
    rel.directoryActions ||= {};
    rel.directoryActions[target] = { busy: true }; render();
    try {
      const r = await fetch(`/api/build-publish/run/${encodeURIComponent(rel.runId)}/open?project=${encodeURIComponent(state.project)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '打开失败');
      rel.directoryActions[target] = { message: data.message };
    } catch (e) { rel.directoryActions[target] = { message: e.message }; }
    if (state.rel === rel) render();
  }

  function goPublishSettings() {
    window.dispatchEvent(new CustomEvent('atb:publish-settings', { detail: { project: state.project, versionId: state.selVerId } }));
  }

  function renderReleasePane(v) {
    const rel = relOf(v);
    const pane = (body) => `<div class="bld-rel-pane" data-rel-ver="${esc(v.id)}">${renderPublishActions(v, rel)}${body}</div>`;
    if (!rel || rel.phase === 'loading') {
      return pane('<p class="muted" role="status">正在加载发布记录…</p>'); // 页签与版本选择仍可用，不以旧记录顶替
    }
    if (rel.phase === 'error') {
      return pane(`<p class="rel-form-err" role="alert">发布记录读取失败：${esc(rel.error || '未知原因')}</p>
        <p><button type="button" class="btn small" id="bldRelRetry">重试</button>
          <span class="muted small">重试只重新读取记录，不执行任何发布操作。</span></p>`);
    }
    const runs = rel.runs || [];
    if (!runs.length) {
      return pane(`<p class="muted">当前版本暂无发布记录</p>
        <p>${relCreateBtnHtml(v)}${v.status !== 'merged' ? ' <span class="muted small">请先完成合并入 main</span>' : ''}</p>`);
    }
    const cards = runs.map((r) => `
      <div class="rel-card${r.id === rel.runId ? ' sel' : ''}" data-rel-run="${esc(r.id)}" role="button" tabindex="0">
        <div class="t"><strong>${esc(r.id)}</strong> ${relStatusChip(r.status)}</div>
        <div class="meta">v${esc(r.version || '未提供')} · Web App ${esc(REL_STEP_LABEL[r.targets?.webapp] || r.targets?.webapp || '未提供')} · 官网 ${esc(REL_STEP_LABEL[r.targets?.site] || r.targets?.site || '未提供')}</div>
        ${r.error?.message ? `<div class="meta err">${esc(String(r.error.message).slice(0, 120))}</div>` : ''}
      </div>`).join('');
    return pane(`
      <div class="bld-rel-split">
        <div class="bld-rel-list" aria-label="发布记录">${cards}
          <p>${relCreateBtnHtml(v)}</p>
        </div>
        ${renderRelDetailPane(rel)}
      </div>`);
  }

  // 运行详情：运行 ID / 发行版本号 / 状态 / 阶段 / Web App 与官网目标结果 / 失败阶段与错误信息；
  // 字段缺失显示「未提供」，不猜测结果。动作区沿用 release.js 产品页签的允许状态。
  function renderRelDetailPane(rel) {
    if (!rel.runId) return '<div class="bld-rel-detail muted">点击左侧运行查看详情</div>';
    if (rel.detailPhase === 'loading') return '<div class="bld-rel-detail"><p class="muted" role="status">加载运行详情…</p></div>';
    if (rel.detailPhase === 'error' || !rel.detail) {
      return `<div class="bld-rel-detail"><p class="rel-form-err" role="alert">详情读取失败：${esc(rel.detailError || rel.error || '未知原因')}</p>
        <p><button type="button" class="btn small" data-rel-detail-retry>重试</button></p></div>`;
    }
    const run = rel.detail.run || {};
    const stages = run.stages || [];
    const failed = stages.find((s) => s.status === 'failed');
    const errText = (failed && (failed.error?.message || failed.error)) || run.error?.message || rel.detail.error?.message || null;
    const tgt = (label, t) => `<div class="bld-rel-target"><strong>${label}</strong> ${relStepChip(t?.status)}${t?.localUrl ? ` <a href="${esc(t.localUrl)}" target="_blank" rel="noreferrer">${esc(t.localUrl)}</a>` : ''}</div>`;
    const dis = rel.busy ? ' disabled' : '';
    const acts = [];
    if (['draft', 'failed', 'canceled'].includes(run.status)) {
      acts.push(`<button type="button" class="btn small" data-rel-act="precheck" data-rel-run="${esc(run.id)}"${dis}>预检</button>`);
      acts.push(`<button type="button" class="btn small" data-rel-act="refreeze" data-rel-run="${esc(run.id)}"${dis} title="main 已前进时按当前 main 重新冻结（旧预检失效后须重新预检）">重新冻结</button>`);
      acts.push(`<button type="button" class="btn small primary" data-rel-act="plan" data-rel-run="${esc(run.id)}"${run.precheck?.ok ? dis : ' disabled title="请先预检（预检不推送 / 不部署）"'}>预览发布计划</button>`);
    }
    if (run.status === 'failed') {
      acts.push(`<button type="button" class="btn small warn" data-rel-act="plan" data-rel-run="${esc(run.id)}"${dis}>重试失败阶段</button>`);
      acts.push(`<button type="button" class="btn small" data-rel-act="refreeze" data-rel-run="${esc(run.id)}"${dis}>重新冻结</button>`);
    }
    if (['prechecking', 'running'].includes(run.status)) {
      acts.push(`<button type="button" class="btn small" data-rel-act="cancel" data-rel-run="${esc(run.id)}"${dis}>取消后续阶段</button>`);
    }
    acts.push(`<button type="button" class="btn small quiet" data-rel-act="refresh" data-rel-run="${esc(run.id)}">刷新状态</button>`);
    return `
      <div class="bld-rel-detail" aria-label="运行详情">
        <header class="rel-detail-head"><div>
          <h3>${esc(run.id)} ${relStatusChip(run.status)}</h3>
          <p class="muted small">来源 ${esc(run.bldId || '未提供')}${run.bldName ? ` · ${esc(run.bldName)}` : ''} · 更新 ${esc(fmtTime(run.updatedAt))}</p>
        </div></header>
        <dl class="rel-kv">
          <dt>运行 ID</dt><dd>${esc(run.id || '未提供')}</dd>
          <dt>发行版本号</dt><dd>v${esc(run.version || '未提供')}</dd>
          <dt>状态</dt><dd>${relStatusChip(run.status)}</dd>
        </dl>
        <div class="bld-rel-targets">
          ${tgt('Web App', run.targets?.webapp)}
          ${tgt('官网与文档', run.targets?.site)}
        </div>
        ${run.status === 'failed' ? `<p class="meta err small" role="note">失败阶段：${esc(failed?.label || failed?.key || '未提供')}${errText ? `：${esc(String(errText))}` : ''}</p>` : ''}
        ${renderPublishDirectories(rel)}
        ${run.precheck ? `<div><strong>预检</strong>${run.precheck.stale ? '<p class="err">配置或冻结输入已变化，请重新预检</p>' : ''}<ul>${(run.precheck.checks || []).map(c => `<li>${esc(c.label)}：${c.ok ? '通过' : esc(c.detail || '未通过')}</li>`).join('')}</ul></div>` : ''}
        <details><summary>执行日志</summary><pre>${esc((rel.detail.logs || []).map(x => `${x.at} ${x.message}`).join('\n'))}</pre></details>
        <div class="bld-rel-stages"><strong>阶段</strong>
          <ul>${stages.length ? stages.map((s) => `<li class="${s.status === 'failed' ? 'err' : ''}">${esc(s.label || s.key || '未提供')} ${relStepChip(s.status)}${s.status === 'failed' && (s.error?.message || s.error) ? `<span class="muted small">${esc(String(s.error?.message || s.error))}</span>` : ''}</li>`).join('') : '<li class="muted small">未提供</li>'}</ul>
        </div>
        <footer class="bld-rel-acts">${acts.join('')}</footer>
      </div>`;
  }

  // 发布计划确认弹窗（沿用 release.js 口径：展示明确计划，确认即授权 start；取消不发任何请求）
  function renderRelPlanModal() {
    const m = state.rel?.planModal;
    if (!m) return '';
    const plan = m.plan || {};
    return `
      <div class="rel-modal-wrap" id="bldRelPlanWrap" role="dialog" aria-label="发布计划确认（产品发布）">
        <div class="rel-modal">
          <h3>发布计划确认（产品发布）</h3>
          <div class="rel-modal-body">
            <ul>${(plan.steps || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
            ${plan.warning ? `<p class="meta err small" role="note">${esc(plan.warning)}</p>` : ''}
            <p class="muted small">用户启动即授权以上明确操作；预检不推送、不上传、不部署。取消不会发出任何执行请求。</p>
          </div>
          <footer class="modal-foot">
            <button type="button" class="btn" id="bldRelPlanCancel">取消</button>
            <button type="button" class="btn primary" id="bldRelPlanConfirm">确认发布</button>
          </footer>
        </div>
      </div>`;
  }

  /* ---------- 分支浏览与同步 ---------- */

  // BUG-20260914-011：与远端同步 = 先 fetch 再推送除 main 外的本地分支（服务端 syncRemote
  // 逐分支收集结果）。fetch 失败整体报错（口径不变）；推送结果不静默：部分失败时错误 toast
  // 列明失败分支与首个原因（可重试），成功 toast 汇总两步；lastSync 供远端空态细分。
  async function doSync() {
    if (state.syncBusy) return;
    state.syncBusy = true;
    render();
    try {
      const r = await post('/sync', {});
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `同步失败（${r.status}）`);
      const pushed = data.pushed || [];
      const failed = data.failed || [];
      state.remoteSynced = true; // fetch 成功（BUG-20260914-006：空态区分依据；细分见 lastSync）
      state.lastSync = { pushed, failed, skipped: data.skipped || [], remote: data.remote || 'origin' };
      // BUG-20260914-017：main 被跳过必须在结果反馈中明示（不静默）——直接用服务端 skipped
      // 数据判断，本地无 main（skipped 不含 main）时不误报。
      const mainNote = state.lastSync.skipped.includes('main') ? '；main 已跳过，请通过发布流程推送' : '';
      if (failed.length) {
        toast(`✕ 同步完成但部分推送失败：${failed.map((f) => f.branch).join('、')}（${failed[0].error || '未知原因'}）${mainNote}`, true);
      } else if (pushed.length) {
        toast(`✓ 已同步远端：fetch 完成，已推送 ${pushed.map((p) => p.branch).join('、')} → ${state.lastSync.remote}${mainNote}`);
      } else if (mainNote) {
        toast('✓ 已同步远端：fetch 完成，没有可推送的开发分支；main 必须通过发布流程推送');
      } else {
        toast('✓ 已同步远端：fetch 完成，无可推送的开发分支');
      }
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
    // BUG-20260915-014：详情页签进快照（刷新后保留正确页签；运行选中不持久化，
    // 重进发布页签自动选最新一条，不混入其他版本记录——README「待确认」最低要求）；
    // REQ-20260920-003：改为五步流程 step（仅认合法值；轮询句柄不进快照，重进自愈恢复）
    const steps = ['plan', 'link', 'docs', 'merge', 'release'];
    return { tab: state.tab, selVerId: state.selVerId, logBranch: state.logBranch, step: steps.includes(state.step) ? state.step : 'plan' };
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
    resetItemsList(); // REQ-20260915-003：恢复浏览位置视为重新选中版本，清空关联列表搜索回第一页
    state.rel = null; // BUG-20260915-014：恢复视为重新选中版本，发布数据按需重载
    state.pf = null;  // REQ-20260920-003：发布流程数据按需重载
    state.step = ['plan', 'link', 'docs', 'merge', 'release'].includes(snap.step) ? snap.step : 'plan'; // 仅认合法值
    state.logBranch = typeof snap.logBranch === 'string' ? snap.logBranch : null;
    state.pendingRestore = null;
    if (state.tab === 'branches' && !state.branches) loadBranches();
    if (state.logBranch) selectBranch(state.logBranch);
  }

  function setTab(t) {
    state.tab = TABS.some(([k]) => k === t) ? t : 'versions';
    if (state.tab !== 'versions') stopSiteTimer(); // REQ-20260920-003：离开版本计划页签即停止官网轮询
    if (state.tab === 'branches' && !state.branches && state.data?.isRepo) loadBranches();
    render();
  }

  /* ---------- 渲染 ---------- */

  function statusChip(status) {
    return `<span class="st ${STATUS_CLS[status] || 'st-mute'}">${esc(STATUS_LABEL[status] || status)}</span>`;
  }

  // BUG-20260920-005：锁定基准后移——「关联条目与提交 / 合并入 main / AI 完善」三类操作的
  // 锁定从 merged 后移到推送完成（正式发布）。/api/build/state 随版本附带 pushed
  //（五步流程「正式发布 → 推送主分支」成功，release.pushedAt 落盘）；merged（已合并
  // 未推送）三类操作全部可用。
  const pushedOf = (v) => !!(v && v.pushed);

  // BUG-20260917-001：左侧版本卡片状态标签——该版本存在发布成功（succeeded）的运行时
  //（/api/build/state 附带的 release.published，任一成功运行即成立），以绿色「已发布」
  // 替换原合并状态标签（口径与右侧「发布」页签 relStatusChip 一致，title 提示成功运行）；
  // 未发布成功（无运行 / 草稿 / 预检 / 进行中 / 失败 / 已取消）保持原四态标签与按钮规则不变，
  // 中间态不上卡片（在「发布」页签查看）。
  function versionChip(v) {
    if (v.release?.published) {
      const tip = `发布成功：${v.release.runId || ''}${v.release.version ? `（v${v.release.version}）` : ''}`;
      return `<span class="st st-ok" title="${esc(tip)}">${esc(REL_STATUS_LABEL.succeeded)}</span>`;
    }
    return statusChip(v.status);
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
      // BUG-20260920-005：锁定基准后移——merged（已合并未推送）「AI 完善 / 合并入 main」可用
      //（补关联后可重开合并）；推送完成（正式发布）后禁用（title 说明已正式发布）；
      // merging 维持「合并中」口径；draft / failed 仍可用。
      const vPushed = pushedOf(v);
      const answerLocked = v.status === 'merging' || vPushed;
      const answerBtn = `<button type="button" class="btn small bld-ver-answer" data-ver-answer="${esc(v.id)}"${answerLocked ? ` disabled title="${vPushed ? '已正式发布，不允许再 AI 完善' : '合并中，请稍候……'}"` : ''} aria-label="AI 完善 ${esc(v.id)}"${answerLocked ? '' : ` title="复制提示词给 Agent，回答直接粘贴回本弹窗自动解析"`}>AI 完善</button>`;
      // BUG-20260920-006：合并键禁用改 aria-disabled（HTML disabled 不派发 click，点击无反馈），
      // 原因统一走 mergeBlockReason 与详情页主按钮同口径（含全局合并执行中 / 已正式发布 /
      // 五步门禁 / 不在 dev，选中版本装配已加载时同查门禁与分支）；点击由 openMergeConfirm
      // 守卫 toast 真实原因，防重复触发仍由 state.mergeBusy 状态守卫保证。
      const mergeReason = mergeBlockReason(v);
      const mergeBtn = `<button type="button" class="btn small primary bld-ver-merge" data-ver-merge="${esc(v.id)}"${mergeReason ? ` aria-disabled="true" title="${esc(mergeReason)}"` : ''} aria-label="${mergeLabel} ${esc(v.id)}">${mergeLabel}</button>`;
      // REQ-20260915-003：产品发布操作迁入版本卡片按钮区（与 AI 完善 / 合并 / 删除集中展示），
      // 右侧详情不再重复显示发布操作区。创建发布仅 merged 可用；draft / merging / failed 禁用并
      // 可见说明「请先完成合并入 main」；沿用 openReleaseConfirm 既有发布校验与核对弹层，
      // 按所在卡片版本绑定（data-ver-release 带卡片 id），不依赖右侧选中态。
      const releaseLocked = v.status !== 'merged';
      const releaseBtn = `<button type="button" class="btn small primary bld-ver-release" data-ver-release="${esc(v.id)}"${releaseLocked ? ` disabled title="请先完成合并入 main（仅已合并 merged 的版本计划可创建发布）"` : ` title="从本版本创建产品发布草稿（自动带入条目与冻结信息）"`} aria-label="创建发布 ${esc(v.id)}">创建并预检</button>`;
      // BUG-20260915-014：「查看发布记录」就地激活所在卡片版本的发布页签（不跳隐藏模块）
      const releaseViewBtn = `<button type="button" class="btn small bld-ver-release-view" data-ver-release-view="${esc(v.id)}" title="在当前版本详情的「发布」页签查看本版本的发布记录" aria-label="查看发布记录 ${esc(v.id)}">查看发布记录</button>`;
      // REQ-20260913-004 删除键：排在两键之后、quiet 危险弱化样式（不抢主操作）；
      // merging 卡片禁用（title 单列口径）；mergeBusy 为全局口径（与合并键一并禁用）。
      const delDisabled = v.status === 'merging' || state.mergeBusy;
      const delBtn = `<button type="button" class="btn small quiet bld-ver-del" data-ver-delete="${esc(v.id)}"${delDisabled ? ` disabled title="${v.status === 'merging' ? '合并中，不可删除' : '合并中，请勿重复触发'}"` : ''} aria-label="删除 ${esc(v.id)}"${delDisabled ? '' : ' title="删除该版本计划（需确认，删除后不可恢复）"'}>删除</button>`;
      // REQ-20260920-003：列表展示计划号 + 提取版本号（保留前导零）+ 阶段
      const verNo = /^BLD-\d{8}-\d{3}$/.test(v.id) ? v.id.replace(/^BLD-/, '') : '';
      const stage = v.status === 'merged' ? '正式发布' : v.status === 'merging' ? '合并中' : v.status === 'failed' ? '失败（可重试）' : '计划中';
      return `
      <div class="rel-card${v.id === state.selVerId ? ' sel' : ''}" data-ver-id="${esc(v.id)}" role="button" tabindex="0">
        <div class="t"><strong>${esc(v.name || v.id)}</strong> ${versionChip(v)}</div>
        <div class="meta">${esc(v.id)}${verNo ? ` · 版本号 ${esc(verNo)}` : ''} · 阶段 ${esc(stage)} · ${v.items.length} 个关联单 · 更新 ${esc(fmtTime(v.updatedAt))}</div>
        <div class="card-acts">${answerBtn}${mergeBtn}${releaseBtn}${releaseViewBtn}${delBtn}</div>
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
            : p.candidates.length === 0 ? `<p class="muted bld-cand-empty">${p.totalDone
              ? '已完成的条目均已纳入版本计划：可从「计划中 / 失败」版本移出条目，或删除版本后重新纳入' // BUG-20260914-004：区分「均已被占用」空态
              // BUG-20260914-008：口径已在头部副标题（side-panel-scope），空态正文精简不再复述，避免同面板口径出现两次
              : '暂无可纳入版本的条目'}</p>`
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

  /* ---------- REQ-20260920-003 五步流程渲染（plan / link / docs / merge / release） ---------- */

  const STEP_LABEL = { plan: '版本计划', link: '关联条目与提交', docs: '文档编写', merge: '合并入 main', release: '正式发布' };
  const DOC_STATE_LABEL = { unwritten: '未编写', uncommitted: '未提交', committed: '已提交', 'needs-rewrite': '需重新编写' };
  const DOC_STATE_CLS = { unwritten: 'st-mute', uncommitted: 'st-run', committed: 'st-ok', 'needs-rewrite': 'st-wait' };
  const SITE_STATE_LABEL = { waiting: '等待官网同步', scanning: '扫描中', missed: '未命中（可继续检测）', hit: '已检测到官网同步', failed: '读取失败' };

  function renderStepNav(v) {
    const pf = pfOf(v);
    const steps = pf?.plan?.steps || null;
    return `
        <nav class="rel-tabs bld-detail-tabs" role="tablist" aria-label="发布五步流程">
          ${['plan', 'link', 'docs', 'merge', 'release'].map((k) => {
            const gate = steps?.find((s) => s.key === k) || null;
            const locked = !!gate?.locked;
            return `<button type="button" class="rel-tab${state.step === k ? ' active' : ''}" data-step="${k}" role="tab" aria-selected="${state.step === k}"${locked && state.step !== k ? ` disabled title="${esc(gate.reason || '前置条件未满足')}"` : ''}>${STEP_LABEL[k]}</button>`;
          }).join('')}
        </nav>`;
  }

  // 文档编写步：上部 AI 写作（提示词 + IDE 入口），下部文档与语言选择、编辑 / 预览、提交状态与 Git 按钮
  function renderDocsPane(v) {
    const pf = pfOf(v);
    if (!pf || pf.phase === 'loading') return '<div class="bld-docs-pane"><p class="muted" role="status">正在加载发布流程数据…</p></div>';
    if (pf.phase === 'error' || !pf.plan) {
      return `<div class="bld-docs-pane"><p class="rel-form-err" role="alert">发布流程数据读取失败：${esc(pf.error || '未知原因')}</p>
        <p><button type="button" class="btn small" data-pf-retry>重试</button></p></div>`;
    }
    const p = pf.plan;
    const docs = p.docs || { files: [], overall: 'none', reasons: [] };
    const key = String(pf.file || 'README.md').replace(/\.en\.md$|\.md$/, '');
    const lang = String(pf.file || '').endsWith('.en.md') ? 'en' : 'zh';
    const editing = pf.mode !== 'preview';
    const content = pf.content == null ? '' : String(pf.content);
    const editor = editing
      ? `<textarea class="bld-doc-editor" rows="14" spellcheck="false">${esc(content)}</textarea>`
      : `<pre class="bld-doc-preview">${esc(content) || '（空文档）'}</pre>`;
    const fileRows = (docs.files || []).map((f) => `<span class="bld-doc-chip" data-doc-file="${esc(f.file)}" role="button" tabindex="0" title="${esc(DOC_STATE_LABEL[f.state] || f.state)}">${esc(f.file)} <span class="st ${DOC_STATE_CLS[f.state] || 'st-mute'}">${esc(DOC_STATE_LABEL[f.state] || f.state)}</span></span>`).join('');
    const gateBar = docs.overall !== 'committed'
      ? `<div class="bld-docs-gate" role="note">${(docs.reasons || []).map((x) => `<p class="small">${esc(x)}</p>`).join('') || '<p class="small">文档未完成提交，暂不可合并</p>'}</div>`
      : `<p class="small muted">文档已提交（${String(docs.commitHash || '').slice(0, 12)}）：满足合并前置</p>`;
    return `
      <div class="bld-docs-pane">
        <section class="bld-docs-ai">
          <strong>AI 写作</strong>
          <p class="muted small">由「技术写作人员」角色的子代理完成当前版本文档任务：主会话派发下方提示词并接收短回执；子代理按关联条目与实际代码核实变化，简练通俗，不编造能力。</p>
          <textarea class="bld-docs-prompt" rows="7" readonly>${esc(p.docsPrompt || '')}</textarea>
          <p><button type="button" class="btn small primary" data-pf-copy-prompt>复制提示词</button>
            <button type="button" class="btn small" data-pf-ide="trae-cn" title="用 TRAE CN 打开当前项目编辑文档（未安装会明确提示并给手动路径）">TRAE CN 打开</button>
            <button type="button" class="btn small" data-pf-ide="trae" title="用 TRAE 打开当前项目编辑文档（未安装会明确提示并给手动路径）">TRAE 打开</button></p>
          ${pf.ideMsg ? `<p class="small" role="status">${esc(pf.ideMsg)}</p>` : ''}
        </section>
        <section class="bld-docs-edit">
          <div class="bld-docs-head">
            <strong>文档</strong>
            <label class="small">类型
              <select class="bld-doc-key">${['README', 'CHANGELOG', 'FEATURES', 'AGENTS'].map((k) => `<option value="${k}"${k === key ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
            <label class="small">语言
              <select class="bld-doc-lang"><option value="zh"${lang === 'zh' ? ' selected' : ''}>中文</option><option value="en"${lang === 'en' ? ' selected' : ''}>英文</option></select></label>
            <div class="bld-doc-mode" role="group" aria-label="编辑或预览">
              <button type="button" class="btn small${editing ? ' on' : ''}" data-pf-mode="edit">编辑</button>
              <button type="button" class="btn small${!editing ? ' on' : ''}" data-pf-mode="preview">预览</button>
            </div>
            <button type="button" class="btn small primary" data-pf-save${pf.busy ? ' disabled' : ''}>${pf.busy ? '处理中…' : '保存'}</button>
          </div>
          ${editor}
          ${pf.savedMsg ? `<p class="small" role="status">${esc(pf.savedMsg)}</p>` : ''}
          ${pf.file === 'README.md' || pf.file === 'README.en.md' ? `<p class="muted small">README 需链接同语言 CHANGELOG 与 FEATURES（${pf.file === 'README.md' ? 'CHANGELOG.md、FEATURES.md' : 'CHANGELOG.en.md、FEATURES.en.md'}）。</p>` : ''}
        </section>
        <section class="bld-docs-commit">
          <div class="bld-docs-files">${fileRows}</div>
          ${gateBar}
          <p><button type="button" class="btn primary" data-pf-commit${pf.busy || docs.overall === 'none' ? ' disabled title="先编写并保存文档"' : ''}>${pf.busy ? '提交中…' : '提交文档到 Git'}</button>
            <span class="muted small">只提交上述八个文档，不夹带业务源码；无变化不空提交。</span></p>
          ${pf.commitMsg ? `<p class="small" role="status">${esc(pf.commitMsg)}</p>` : ''}
        </section>
      </div>`;
  }

  // 合并入 main 步：范围与隔离分析、禁用原因、合并结果
  function renderMergePane(v) {
    const pf = pfOf(v);
    if (!pf || pf.phase === 'loading') return '<div class="bld-merge-pane"><p class="muted" role="status">正在加载合并分析…</p></div>';
    if (pf.phase === 'error' || !pf.plan) {
      return `<div class="bld-merge-pane"><p class="rel-form-err" role="alert">合并分析读取失败：${esc(pf.error || '未知原因')}</p>
        <p><button type="button" class="btn small" data-pf-retry>重试</button></p></div>`;
    }
    const p = pf.plan;
    const gate = (p.steps || []).find((s) => s.key === 'merge');
    const an = p.mergeAnalysis || { perItem: [], blocked: [], notes: [] };
    const onDev = p.currentBranch === 'dev';
    const scopeRows = (v.items || []).map((it) => `<li>${esc(it.itemId)} <code>${esc(short(it.commit))}</code> ${it.mergedAt ? '<span class="st st-ok">已合并</span>' : ''}${it.mergeError ? `<span class="st st-fail" title="${esc(it.mergeError)}">失败</span>` : ''}</li>`).join('');
    const interRows = (an.perItem || []).filter((x) => (x.intermediates || []).length).map((x) => `
      <li>${esc(x.itemId)}：${x.count} 个未选祖先提交（普通 merge 会一并带入 main；隔离合并不带入，依赖其内容将冲突阻止）
        <ul>${(x.intermediates || []).slice(0, 5).map((i) => `<li><code>${esc(short(i.hash))}</code> ${esc(i.subject || '')}</li>`).join('')}</ul></li>`).join('');
    const devBar = onDev
      ? `<p class="small muted">当前分支 dev · 目标主分支 ${esc(p.mainBranch || 'main')}（合并经临时工作树隔离执行，完成后工作目录仍在 dev）</p>`
      : `<p class="rel-form-err" role="alert">当前分支${p.currentBranch ? `是 ${esc(p.currentBranch)}` : '处于 detached HEAD'}，不在 dev：请自行切换回 dev 后重试（不自动切分支）。</p>`;
    const merged = v.status === 'merged';
    // BUG-20260920-006：主按钮禁用改 aria-disabled（HTML disabled 不派发 click，点击无反馈）；
    // title 归因统一走 mergeBlockReason——不在 dev / 合并执行中不再误回落「前置条件未满足」，
    // 与真实禁用原因一一对应；点击由 openMergeConfirm 守卫 toast 真实原因。
    const mergeReason = mergeBlockReason(v);
    return `
      <div class="bld-merge-pane">
        <section><strong>发布范围</strong>
          <ul>${scopeRows || '<li class="muted small">（无关联条目：回到「关联条目与提交」步骤关联）</li>'}</ul>
          ${p.docs?.commitHash ? `<p class="small muted">文档提交：<code>${esc(short(p.docs.commitHash))}</code>（只随本版发布最新文档提交）</p>` : ''}
        </section>
        <section><strong>隔离分析</strong>
          ${(an.blocked || []).length ? `<p class="rel-form-err" role="alert">${(an.blocked || []).map((x) => esc(x)).join('；')}</p>` : ''}
          ${(an.notes || []).map((x) => `<p class="small muted">${esc(x)}</p>`).join('')}
          ${interRows ? `<ul>${interRows}</ul>` : '<p class="small muted">所选提交无未选祖先：变更可独立进入主分支。</p>'}
        </section>
        ${devBar}
        ${gate?.locked ? `<p class="rel-form-err" role="alert">暂不可合并：${esc(gate.reason || '前置条件未满足')}</p>` : ''}
        <p><button type="button" class="btn primary" data-ver-merge="${esc(v.id)}"${mergeReason ? ` aria-disabled="true" title="${esc(mergeReason)}"` : ''}>${v.status === 'failed' ? '重试合并入 main' : '合并入 main'}</button>
          <span class="muted small">只发布所选条目提交与最新文档提交；冲突或依赖未选变化会阻止并说明原因。</span></p>
        ${v.status === 'failed' && v.merge?.error ? `<p class="rel-form-err" role="alert">合并失败：${esc(v.merge.error)}（可重试，只补未合并条目）</p>` : ''}
        ${merged && v.merge?.mainSha ? `<p class="small muted">合并完成：主分支头 <code>${esc(short(v.merge.mainSha))}</code>；重放证据 ${(v.merge?.replays || []).length} 条。</p>` : ''}
      </div>`;
  }

  // 正式发布步：主分支推送 → 官网 AI 写作提示词 → 同步检测（60 秒轮询 + 立即检测）
  function renderReleaseFlowPane(v) {
    const pf = pfOf(v);
    if (!pf || pf.phase === 'loading') return '<div class="bld-release-pane"><p class="muted" role="status">正在加载发布状态…</p></div>';
    if (pf.phase === 'error' || !pf.plan) {
      return `<div class="bld-release-pane"><p class="rel-form-err" role="alert">发布状态读取失败：${esc(pf.error || '未知原因')}</p>
        <p><button type="button" class="btn small" data-pf-retry>重试</button></p></div>`;
    }
    const p = pf.plan;
    const rel = p.release || {};
    const remotes = (p.remotes || []).length ? p.remotes : ['origin'];
    const onDev = p.currentBranch === 'dev';
    const pushState = rel.pushedAt
      ? `<p class="small" role="status">已推送主分支 ${esc(rel.pushRemote || '')}（完成时间 ${esc(fmtTime(rel.pushedAt))}，基准 <code>${esc(short(rel.pushedSha))}</code>）；官网检测从该时间起。</p>`
      : '<p class="small muted">尚未推送主分支（未推送过官网；推送成功时间将作为官网检测时间窗口起点）。</p>';
    const site = rel.site || { status: 'waiting' };
    const siteCls = site.status === 'hit' ? 'st-ok' : site.status === 'failed' ? 'st-fail' : site.status === 'scanning' ? 'st-run' : 'st-mute';
    const evidence = site.status === 'hit' && site.evidence
      ? `<p class="small">匹配提交 <code>${esc(short(site.evidence.hash))}</code>（分支 ${esc(site.branch || '—')}，检测时间 ${esc(fmtTime(site.evidence.matchedAt))}）<br>主题：${esc(site.evidence.subject || '')}</p>`
      : '';
    const siteInfo = site.reason ? `<p class="small">${esc(site.reason)}</p>` : '';
    const times = `<p class="muted small">官网路径：${esc(p.siteRepoRoot || '未配置（设置中配置官网仓库根目录）')} · 实际分支：${esc(site.branch || '—')} · 上次检测 ${esc(fmtTime(site.lastScanAt))}${site.nextScanAt ? ` · 下一次 ${esc(fmtTime(site.nextScanAt))}` : ''}${site.since ? ` · 扫描起点 ${esc(fmtTime(site.since))}` : ''}</p>`;
    return `
      <div class="bld-release-pane">
        <section><strong>第一步 · 推送主分支</strong>
          ${pushState}
          <p><label class="small">目标远端 <select class="bld-push-main-remote">${remotes.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
            <button type="button" class="btn primary" data-pf-push${v.status === 'merged' && onDev && !pf.busy ? '' : ` disabled title="${esc(v.status !== 'merged' ? '先完成合并入 main' : '请自行切换回 dev 后重试')}"`}>${pf.busy ? '推送中…' : '推送主分支'}</button>
            <span class="muted small">只推主分支（${esc(p.mainBranch || 'main')}）：不推 dev、不强推；失败可重试，不进入完成状态。</span></p>
        </section>
        <section><strong>第二步 · 官网 AI 写作</strong>
          <p class="muted small">推送成功后进行：提示词在官网仓库执行，读取本项目已发布版本 CHANGELOG / FEATURES 中英文材料，按官网自身架构更新；完成提交消息须含完整计划号。</p>
          ${p.sitePrompt ? `<textarea class="bld-site-prompt" rows="7" readonly>${esc(p.sitePrompt)}</textarea>
          <p><button type="button" class="btn small primary" data-pf-copy-site>复制官网提示词</button></p>` : '<p class="small muted">未配置官网仓库：先在设置中配置官网仓库根目录。</p>'}
        </section>
        <section><strong>第三步 · 官网同步检测</strong>
          <p><span class="st ${siteCls}">${esc(SITE_STATE_LABEL[site.status] || site.status)}</span>
            <button type="button" class="btn small" data-pf-scan${pf.siteBusy ? ' disabled' : ''}>${pf.siteBusy ? '检测中…' : '立即检测'}</button></p>
          ${evidence}${siteInfo}${times}
          <p class="muted small" role="note">${esc(p.siteNotice || pf.plan?.siteNotice || '每分钟检查官网本地主分支；匹配仅表示本地提交已同步，不代表已推送或网站已部署')}</p>
        </section>
      </div>`;
  }

  function renderDetail(v) {
    if (!v) return '<div class="rel-detail muted">点击左侧版本查看详情</div>';
    // BUG-20260920-005：条目锁基准后移——merging 与推送完成（正式发布）锁定增删 / 换 commit，
    // merged（已合并未推送）放开（补关联后重开合并只补未合并条目）。
    const lockItems = v.status === 'merging' || pushedOf(v);
    const itemsLockTitle = v.status === 'merging' ? '合并中，条目不可增删' : '已正式发布，条目已锁定';
    const editing = state.edit && state.edit.id === v.id ? state.edit : null;
    const nameCell = editing?.field === 'name'
      ? `<div class="bld-edit-row"><input class="bld-name-input" value="${esc(v.name)}"><button type="button" class="btn small primary" id="bldSaveName">保存</button><button type="button" class="btn small" id="bldCancelEdit">取消</button></div>`
      : `<strong class="bld-name" title="点击编辑名称" role="button" tabindex="0">${esc(v.name || v.id)}</strong> ${statusChip(v.status)}`;
    const descCell = editing?.field === 'desc'
      ? `<div class="bld-edit-row"><textarea class="bld-desc-input" rows="3">${esc(v.description)}</textarea><button type="button" class="btn small primary" id="bldSaveDesc">保存</button><button type="button" class="btn small" id="bldCancelEdit">取消</button></div>`
      : `<span class="bld-desc" title="点击编辑描述" role="button" tabindex="0">${v.description ? esc(v.description) : '<span class="muted">（无描述，点击补充）</span>'}</span>`;
    // REQ-20260915-003：关联条目联合列表——先对当前版本全量关联行按关键词过滤（覆盖所有页），
    // 再分页（每页 ITEMS_PAGE_SIZE）；渲染时把越界页码校正回写（数据减少回落最后有效页）。
    const searching = !!state.itemsQuery;
    const pg = itemsPageView() || paginateItems([], 1, ITEMS_PAGE_SIZE);
    const itemRows = pg.rows.map((it) => `
      <div class="bld-item-row" data-row-item="${esc(it.itemId)}">
        <span class="bld-item-id">${esc(it.itemId)}</span>
        <span class="bld-item-title" title="${esc(it.title || '')}">${esc(it.title || '')}</span>
        <select class="bld-commit-sel" data-commit-item="${esc(it.itemId)}" ${lockItems ? `disabled title="${itemsLockTitle}"` : ''}>
          <option value="${esc(it.commit)}">${esc(short(it.commit))}</option>
        </select>
        ${it.mergedAt ? `<span class="st st-ok" title="已合并入 main">✓</span>` : it.mergeError ? `<span class="st st-fail" title="${esc(it.mergeError)}">✕</span>` : ''}
        <button type="button" class="btn small quiet bld-item-remove" data-remove-item="${esc(it.itemId)}" ${lockItems ? `disabled title="${itemsLockTitle}"` : 'title="移出该条目（连同 commit 关联）"'}>移出</button>
      </div>`).join('');
    // 计数行：搜索态显示「匹配 X / 共 Y 条」（零结果显示 0 条，不伪装成空数据），默认显示总数
    const countBar = searching || pg.total
      ? `<div class="bld-items-count small" role="status">${searching ? `匹配 ${pg.total} / 共 ${v.items.length} 条` : `共 ${pg.total} 条`}</div>`
      : '';
    // 分页条：仅在有数据时出现（零结果 / 零关联不出可翻页的虚假页数）；首末页禁用对应按钮
    const pager = pg.total ? `
          <div class="bld-items-pager" role="navigation" aria-label="关联条目分页">
            <button type="button" data-items-pg="prev"${pg.page <= 1 ? ' disabled' : ''}>上一页</button>
            <span class="bld-items-pageinfo">第 ${pg.page} / ${pg.pages} 页</span>
            <button type="button" data-items-pg="next"${pg.page >= pg.pages ? ' disabled' : ''}>下一页</button>
          </div>` : '';
    // 空态区分：零关联给添加引导；有数据但无匹配给关键词与清空入口（两种空态互斥）
    const listBody = !v.items.length
      ? '<p class="muted small">暂无条目：点「＋ 添加条目」纳入需求单 / Bug 单</p>'
      : !pg.total
        ? `<p class="muted small">没有匹配的关联条目（关键词：${esc(state.itemsQuery)}）</p>
          <p><button type="button" class="btn small quiet" data-items-search-clear>清空</button></p>`
        : itemRows;
    const mergeState = v.status === 'merging'
      ? '<p class="muted small bld-merge-note">合并中，请稍候……（执行中已禁用重复触发与条目编辑）</p>'
      : v.status === 'failed' && v.merge?.error
        ? `<p class="rel-form-err bld-merge-note" role="alert">合并失败：${esc(v.merge.error)}（可重试，只补未合并条目）</p>`
        : '';
    // REQ-20260920-003：右侧详情改为五步流程导航——1 版本计划（信息编辑）→ 2 关联条目与提交
    //（原概况的关联列表）→ 3 文档编写 → 4 合并入 main → 5 正式发布（含原产品发布记录页签）
    const versionNumber = (v.id && /^BLD-\d{8}-\d{3}$/.test(v.id)) ? v.id.replace(/^BLD-/, '') : '';
    const planBody = `
        <p class="muted small">计划号 ${esc(v.id)}${versionNumber ? ` · 版本号 ${esc(versionNumber)}` : ''} · 目标分支 ${esc(v.targetBranch || 'main')}${v.merge?.baseBranch ? ` · 来源分支 ${esc(v.merge.baseBranch)}` : ''}</p>
        <div class="bld-desc-block"><span class="muted small">描述</span>${descCell}</div>
        ${mergeState}`;
    const linkBody = `
        <div class="bld-items">
          <div class="bld-items-head"><strong>关联条目与 commit</strong>
            <div class="bld-items-search" role="search">
              <input type="search" id="bldItemsSearchInput" placeholder="搜单号 / 标题 / commit…" value="${esc(state.itemsQueryInput)}" aria-label="搜索关联条目与 commit">
              <button type="button" class="btn small" id="bldItemsSearchGo">搜索</button>
              ${state.itemsQuery ? '<button type="button" class="btn small quiet" data-items-search-clear>清空</button>' : ''}
            </div>
            <button type="button" class="btn small" id="bldAddItem" ${lockItems ? `disabled title="${itemsLockTitle}"` : ''}>＋ 添加条目</button>
          </div>
          ${countBar}
          ${listBody}
          ${pager}
        </div>`;
    let stepBody;
    if (state.step === 'link') stepBody = linkBody;
    else if (state.step === 'docs') stepBody = renderDocsPane(v);
    else if (state.step === 'merge') stepBody = renderMergePane(v);
    else if (state.step === 'release') stepBody = `${renderReleaseFlowPane(v)}${renderReleasePane(v)}`;
    else stepBody = planBody;
    return `
      <div class="rel-detail">
        <header class="rel-detail-head">
          <div>
            <h3>${nameCell}</h3>
            <p class="muted small">${esc(v.id)}${versionNumber ? ` · 版本号 ${esc(versionNumber)}` : ''} · 更新 ${esc(fmtTime(v.updatedAt))}</p>
          </div>
        </header>
        ${renderStepNav(v)}
        ${stepBody}
      </div>`; // REQ-20260915-003：产品发布操作区（原 bld-release-block）已迁入左侧版本卡片，详情不再重复渲染
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

  // BUG-20260914-011：同步（fetch + push）成功后远端列表仍为空的确定性解释——按推送结果细分：
  // 有失败分支 → 解释推送失败并引导重试（fetch 拉到的新分支已在列表，推送可重试）；
  // 一支未推 → 本地无开发分支可推（main 由发布模块管理，不在此推送）；
  // 推送成功却仍空 → 正常不可达（推送成功远端必非空），保留 BUG-20260914-006 断言兜底时序窗口。
  function remoteSyncedEmptyHint() {
    const ls = state.lastSync || { pushed: [], failed: [] };
    if ((ls.failed || []).length) {
      return `<div class="bld-remote-hint" role="note"><strong>同步拉取已完成，但推送失败。</strong>
        <span class="small">本次推送未能完成：失败分支与原因见上方提示。可在上方「本地」分组对分支点「推送」重试，或再次点击「⟳ 和远端同步」。</span></div>`;
    }
    if (!(ls.pushed || []).length) {
      return `<div class="bld-remote-hint" role="note"><strong>远端仓库尚无任何分支（从未推送）。</strong>
        <span class="small">本次同步未推送任何分支：没有可推送的开发分支；main 必须通过发布流程推送。</span></div>`;
    }
    return `<div class="bld-remote-hint" role="note"><strong>远端仓库尚无任何分支（从未推送）。</strong>
      <span class="small">刚才的同步已成功——列表仍为空说明远端仓库本身就是空的。可在上方「本地」分组对分支点「推送」，首推将建立上游跟踪。</span></div>`;
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
      const remotes = b.remotes || [];
      // BUG-20260914-006：同步成功后仍为空 ⇒ 远端仓库确实为空——本地分支「推送」高亮为出路。
      const pushAttn = remotes.length > 0 && state.remoteSynced && (b.remote || []).length === 0;
      const cur = b.current ? `<div class="bld-branch bld-cur" data-branch="${esc(b.current)}" role="button" tabindex="0"><strong>${esc(b.current)}</strong> <span class="st st-run">当前</span></div>` : '';
      // BUG-20260914-018：main 行不再渲染「通过发布流程推送」说明徽标（用户要求删掉该文字，
      // 亦不新增任何替代说明）；main 既不随「和远端同步」推送（BUG-20260914-011），推送按钮也已按
      // BUG-20260914-012 去除，行上仅保留分支名，行点击查看提交记录语义不变。
      const local = (b.local || []).filter((x) => x !== b.current).map((x) => `
        <div class="bld-branch" data-branch="${esc(x)}" role="button" tabindex="0"><span>${esc(x)}</span>${x === 'main' ? '' : `
          <button type="button" class="btn small quiet bld-push${pushAttn ? ' attn' : ''}" data-push="${esc(x)}" title="推送到远端">推送</button>`}</div>`).join('');
      const remote = (b.remote || []).map((x) => `<div class="bld-branch bld-remote" data-branch="${esc(x)}" role="button" tabindex="0"><span>${esc(x)}</span></div>`).join('');
      // BUG-20260914-006：远端空态三分支——未配置远端保持既有文案（范围外）；
      // 已配置远端未同步 → 解释成因并引导同步；本会话同步成功后仍为空 → 按 BUG-20260914-011
      // 的推送结果细分（同步含推送后「推送成功 ⇒ 远端必非空」，见 remoteSyncedEmptyHint）。
      const remoteEmpty = !remotes.length
        ? '<p class="muted small">（无远端分支：先「和远端同步」或推送本地分支）</p>'
        : state.remoteSynced
          ? remoteSyncedEmptyHint()
          : '<p class="muted small">本地无远端跟踪分支：尚未与远端同步，可点上方「⟳ 和远端同步」拉取并推送；若同步后仍为空，说明推送未成功或远端仓库尚无任何分支（从未推送），可在上方「本地」分组推送分支。</p>';
      // BUG-20260914-003：本地有分支但缺 main 时给出可解释提示（与「合并入 main」
      // precheckMerge「main 分支不存在」报错口径一致），引导经设置页 Git 工作流幂等补建。
      // 空仓库（无任何本地分支 = 尚无提交、无补建基点）不出提示。
      // REQ-20260916-005：主分支按解析结果判定（/api/build/branches 的 mainBranch 字段；
      // 旧载荷无该字段时回退「local 含 main」推断）——仅 master 的历史仓库主分支已解析
      // 为 master，不再显示「本地缺少 main」误导提示。
      const locals = b.local || [];
      const mainBranch = b.mainBranch || (locals.includes('main') ? 'main' : null);
      const mainMissing = locals.length > 0 && !mainBranch;
      const mainHint = mainMissing
        ? `<p class="bld-main-hint" role="note">⚠ 本地缺少 main 分支：版本计划「合并入 main」将报「main 分支不存在」。可到「设置 → Git 工作流」执行初始化（幂等，将在首个提交上补建 main，不推送远端）。</p>`
        : '';
      list = `
        <div class="bld-branch-group"><div class="bld-group-head">本地</div>${cur}${local || '<p class="muted small">（无其他本地分支）</p>'}${mainHint}</div>
        <div class="bld-branch-group"><div class="bld-group-head">远端</div>${remote || remoteEmpty}</div>`;
    }
    const log = state.logBranch ? (() => {
      // REQ-20260914-002：搜索执行中指示与默认加载同范式（防重复：输入框与按钮随 loading 禁用）
      if (state.logPhase === 'loading') return `<p class="muted">${state.logQuery ? '搜索中…' : '加载提交记录中…'}</p>`;
      if (state.logPhase === 'error') return `<p class="rel-form-err" role="alert">提交记录读取失败：${esc(state.logError || '')}</p>`;
      const commits = state.branchLog?.commits || [];
      const inSearch = !!state.logQuery;
      // REQ-20260914-002：无命中空态（与「该分支暂无提交」区分；一键清除回默认列表）
      if (inSearch && !commits.length && !state.logError) {
        return `<p class="muted small">没有匹配的提交（关键词：${esc(state.logQuery)}）</p>
          <p><button type="button" class="btn small quiet" data-log-search-clear>清除</button></p>`;
      }
      if (!commits.length) return '<p class="muted small">该分支暂无提交</p>';
      // BUG-20260914-009：分页展示全部提交（替代 50 条静默截断）——翻页失败保留旧内容时
      // 在列表上方显示行内错误 + 重试（重发失败时的目标页）
      const errBar = state.logError ? `<p class="rel-form-err" role="alert">提交记录读取失败：${esc(state.logError)} <button type="button" class="btn small" id="bldLogRetry">重试</button></p>` : '';
      // REQ-20260914-002：命中计数行——仅在展示数据与当前关键词一致时显示（翻页失败保留旧
      // 内容时不误报计数）；行渲染沿用既有口径 + 命中词高亮
      const countBar = inSearch && state.branchLog?.query === state.logQuery && !state.logError
        ? `<div class="bld-log-count small" role="status">共 ${state.branchLog.total} 条匹配（关键词：${esc(state.logQuery)}）</div>`
        : '';
      // BUG-20260920-002：双支并集上下文——载荷含 heads（≥2 支本地头）即双支模式（选中
      // 主分支 / dev 且两支并存）。轨道颜色按提交 side 稳定分配（main→lg0 / dev→lg1：同 hash
      // 恒同色，翻页 / 搜索子集不跳变）；mergeBase 行画水平汇聚虚线并加「Merge-base」文字标注。
      const heads = Array.isArray(state.branchLog?.heads) ? state.branchLog.heads.filter((x) => x && x.name && x.hash) : [];
      const dual = heads.length >= 2;
      const mergeBase = state.branchLog?.mergeBase || null;
      const sideMap = new Map(commits.map((c) => [c.hash, c.side]));
      const headByHash = new Map(heads.map((x) => [x.hash, x.name]));
      // REQ-20260920-001：历史拓扑图——按真实父子关系绘制轨道连线（logGraph）；
      // 行内容为可聚焦按钮（click 切换选中 / focus 直选，键盘可达），选中行出详情区。
      // hasAbove：翻页 offset>0 或搜索态时首行上方存在未随行加载的上下文（虚线桩，不误判根）。
      const inSearchCtx = inSearch || Number(state.branchLog?.offset) > 0;
      const g = logGraph(commits, {
        hasAbove: inSearchCtx,
        colorOf: dual ? (hsh) => (sideMap.get(hsh) === 'dev' ? 1 : sideMap.has(hsh) ? 0 : undefined) : null,
        mergeBase: dual ? mergeBase : null,
      });
      // 并集提示：双支模式常驻说明（真实分支名插值，含未合并提交口径）
      const unionHint = dual
        ? `<div class="bld-log-union muted small" role="note">并集视图：同时显示 ${esc(heads[0].name)} 与 ${esc(heads[1].name)} 的提交（含未合并提交）</div>`
        : '';
      const selRow = state.logSelected ? g.rows.find((r) => r.hash === state.logSelected) : null;
      const selCommit = selRow ? commits.find((c) => c.hash === selRow.hash) : null;
      const detail = selCommit ? (() => {
        const parentsPart = (selCommit.parents || []).length
          ? `<span>父提交：</span>${selCommit.parents.map((p) => `<code>${esc(short(p))}</code>`).join(' ')}`
          : '<span>无父提交（根提交）</span>';
        const hiddenPart = selRow.hiddenParents.length
          ? ` <span class="muted">${selRow.hiddenParents.length} 个父提交未显示（虚线延续）</span>`
          : '';
        const mbPart = dual && mergeBase && selCommit.hash === mergeBase
          ? ' <span class="bld-branch-tag bt-mb" title="main 与 dev 的汇聚点（merge-base）">main ∩ dev 汇聚点</span>'
          : '';
        return `<div class="bld-log-detail" id="bldLogDetail" role="status"><code>${esc(selCommit.short || selCommit.hash.slice(0, 8))}</code> ${esc(selCommit.subject)}；${parentsPart}${hiddenPart}${mbPart}</div>`;
      })() : '';
      // 搜索隐藏中间提交：顶部统一说明（虚线语义）；无断档时不打扰
      const searchHint = inSearch && g.rows.some((r) => r.hiddenParents.length)
        ? '<div class="bld-log-eof muted small" role="note">搜索已隐藏中间提交：虚线不表示直接父子关系。</div>'
        : '';
      const listHtml = `<ul class="bld-log">${commits.map((c, i) => {
        const row = g.rows[i];
        const mergeTag = row.merge ? `<span class="bld-merge-tag">合并 · ${row.parentCount} 父提交</span>` : '';
        const gapNote = row.hiddenParents.length ? `<span class="muted small">${row.hiddenParents.length} 个父提交未显示（虚线延续）</span>` : '';
        // BUG-20260920-002：分支头名称标签（真实 heads 命中行；配色按 side 走轨道色）+
        // merge-base 汇聚标注（虚线描边，非颜色提示；悬停说明）
        const headName = dual ? headByHash.get(c.hash) : null;
        const headTag = headName ? `<span class="bld-branch-tag bt-${sideMap.get(c.hash) === 'dev' ? 'dev' : 'main'}">${esc(headName)}</span>` : '';
        const mbTag = row.mergeBase ? '<span class="bld-branch-tag bt-mb" title="main 与 dev 的汇聚点（merge-base）">Merge-base</span>' : '';
        return `<li><button type="button" class="bld-log-row${state.logSelected === c.hash ? ' sel' : ''}" data-log-row="${esc(c.hash)}">${graphSvg(row, g.laneCount, { head: dual && headByHash.has(c.hash) })}<code>${markMatch(c.short || c.hash.slice(0, 8), state.logQuery)}</code> ${headTag}${mbTag}<span>${markMatch(c.subject, state.logQuery)}</span>${mergeTag}<span class="muted small">${markMatch(c.author, state.logQuery)} · ${esc(fmtTime(c.date))}</span>${gapNote}</button></li>`;
      }).join('')}</ul>`;
      const total = Number(state.branchLog?.total ?? commits.length);
      // 页边界延续提示：本页未到分支历史末尾时，最老行的父提交必在后续页（父提交恒更旧）——
      // 提示轨道继续，不把页边界提交画成根。
      const boundary = !inSearch && Number(state.branchLog?.offset ?? 0) + commits.length < total
        ? '<div class="bld-log-eof muted small" role="note">父提交在后续页，轨道继续；此处不是历史起点。</div>'
        : '';
      const size = state.logPageSize;
      const pages = Math.max(1, Math.ceil(total / size));
      const page = Math.min(Math.max(1, state.logPage), pages);
      const start = (page - 1) * size;
      // 末页反馈按展示数据自身模式选词（搜索态 = 匹配 / 默认 = 提交）
      const eof = page === pages
        ? (state.branchLog?.query
          ? `<div class="bld-log-eof muted small" role="note">已到末尾 · 共 ${total} 条匹配</div>`
          : `<div class="bld-log-eof muted small" role="note">已到末尾 · 共 ${total} 条提交（可翻至分支首个提交）</div>`)
        : '';
      return errBar + countBar + unionHint + detail + searchHint + listHtml + boundary + eof + logPagerHtml(page, pages, size, total);
    })() : '<div class="rel-detail muted">点击左侧分支查看提交记录</div>';
    // REQ-20260914-002：搜索控件——关键词输入 + 搜索触发 + 清除入口；执行中禁用防重复触发；
    // 清除入口仅在已有生效关键词时出现（无匹配空态内另有同口径入口）。
    // BUG-20260914-016：搜索控件并入 bld-log-head 头部行（与分支名同一行），
    // 不再在头部行下方独占一行；搜索行为与状态反馈口径不变。
    const searchRow = state.logBranch ? `
          <div class="bld-log-search" role="search">
            <input type="search" id="bldLogSearchInput" placeholder="搜提交说明 / 作者 / hash…" value="${esc(state.logQueryInput)}" aria-label="搜索提交记录"${state.logPhase === 'loading' ? ' disabled' : ''}>
            <button type="button" class="btn small" id="bldLogSearchGo"${state.logPhase === 'loading' ? ' disabled' : ''}>${state.logPhase === 'loading' ? '搜索中…' : '搜索'}</button>
            ${state.logQuery ? '<button type="button" class="btn small quiet" data-log-search-clear>清除</button>' : ''}
          </div>` : '';
    return `
      <div class="rel-split bld-branch-split">
        <div class="rel-list" aria-label="分支列表">
          <div class="bld-branch-tools">
            <button type="button" class="btn small" id="bldFetchBtn" ${state.syncBusy ? 'disabled' : ''} title="fetch --all --prune 拉取远端，再推送本地开发分支（main 除外）：确保本地与远端一致">${state.syncBusy ? '同步中…' : '⟳ 和远端同步'}</button>
            <button type="button" class="btn small quiet" id="bldBranchRefresh">刷新</button>
          </div>
          <p class="bld-sync-note" role="note">同步仅推送 main 以外的本地分支；main 必须通过发布流程推送。</p>
          ${list}
        </div>
        <div class="rel-detail" aria-label="提交记录">
          <div class="bld-log-head"><strong>${esc(state.logBranch || '提交记录')}</strong>${searchRow}
            ${state.logBranch ? '<button type="button" class="btn small quiet" id="bldLogRefresh">刷新</button>' : ''}</div>
          ${log}
        </div>
      </div>`;
  }

  // syncModalDrafts=false 供 parseAnswerPreview 跳过草稿回同步（解析结果刚写入 state，
  // 旧 DOM 输入值不应覆盖预填值）；其余调用方默认 true——重渲染前把弹窗内未保存的
  // 回答草稿与回填编辑值写回 state，防止后台刷新冲掉用户输入（REQ-20260913-006）；
  // REQ-20260920-003：文档编辑框同样回同步（syncDocDraft，防轮询 / 刷新冲掉未保存文档）
  function render(syncModalDrafts = true) {
    const view = $('#buildView');
    if (!view) return;
    if (syncModalDrafts && state.rendered) {
      syncAnswerDraft();
      syncDocDraft();
    }
    if (state.phase === 'loading') {
      view.innerHTML = '<div class="rel-loading muted">加载发布模块…</div>';
      state.rendered = true;
      return;
    }
    if (state.phase === 'error') {
      view.innerHTML = `<div class="rel-error"><p>发布模块读取失败：${esc(state.error || '')}</p>
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
        <p class="muted">发布模块基于 git（版本计划合并入 main、分支浏览与同步）：可在终端执行 git init，或经 <code>atb init</code> 初始化项目（设置模块「Git 工作流」亦有初始化入口）。</p></div>`;
    } else if (state.tab === 'versions') {
      body = `
        <div class="rel-split">
          <div class="rel-list" aria-label="版本列表">${renderVersionList()}</div>
          ${renderDetail(selVersion())}
        </div>`;
    } else {
      body = renderBranchesPane();
    }
    // REQ-20260915-003：「＋ 新建版本」上移至页签工具行右端（取消单独占一行的工具栏容器）；
    // 仅版本计划页提供入口（分支浏览页维持既有可用范围），非 git 仓库不可用。
    const newBtn = state.tab === 'versions' && d?.isRepo
      ? '<button type="button" class="btn primary" id="bldNewBtn">＋ 新建版本</button>'
      : '';
    view.innerHTML = `
      <nav class="rel-tabs bld-tabs" aria-label="构建子页签">${tabs}<span class="bld-tabs-tools">${newBtn}</span></nav>
      ${body}
      ${d?.isRepo ? renderPanel(state.createPanel, '新建版本', '仅已完成（done）且未纳入任何版本的需求单 / Bug 单可纳入版本；全选只纳入有 commit 候选的条目', 'bldCreateBtn', '创建版本计划') : ''}
      ${d?.isRepo ? renderPanel(state.addPanel, '添加条目', '仅已完成（done）且未纳入任何版本的需求单 / Bug 单可加入本版本（已纳入版本的条目不再出现）', 'bldAddSubmit', '添加所选条目') : ''}
      ${renderAnswerModal()}
      ${renderMergeConfirm()}
      ${renderPushConfirm()}
      ${renderDeleteConfirm()}
      ${renderReleaseConfirm()}
      ${renderRelPlanModal()}`;
    bindCommon(view);
    // REQ-20260920-003：文档 / 合并 / 正式发布步按需自愈加载——详情在这些步但 pf 数据缺失 /
    // 版本不匹配（切换版本 / 选中失效回落 / 恢复快照）时只读拉取；ensurePublishPlan 同步置
    // loading 态，重入 render 不再触发（无请求循环）
    if (state.tab === 'versions' && d?.isRepo) {
      const v0 = selVersion();
      const needPf = v0 && ['docs', 'merge', 'release'].includes(state.step) && (!state.pf || state.pf.verId !== v0.id);
      if (needPf) ensurePublishPlan();
      // BUG-20260915-014：正式发布步同时自愈加载产品发布记录（原发布页签数据）
      if (v0 && state.step === 'release' && (!state.rel || state.rel.verId !== v0.id)) ensureReleaseData();
      // 官网检测轮询自愈：处于正式发布步且未启动时启动（离开发布步由 setStep / selectVersion 停止）
      if (v0 && state.step === 'release' && !state.siteTimer) startSiteTimer();
    }
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
        // REQ-20260915-003：切换版本清空关联列表搜索并回第一页（selectVersion 统一口径）
        selectVersion(card.dataset.verId);
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
    // 条目增删与 commit 换选（REQ-20260915-003：行来自过滤分页后的当前页，data-* 均绑定真实条目 ID）
    q('#bldAddItem')?.addEventListener('click', openAddPanel);
    for (const el of view.querySelectorAll('[data-remove-item]')) {
      el.addEventListener('click', () => itemAction('remove', { itemIds: [el.dataset.removeItem] }));
    }
    for (const el of view.querySelectorAll('[data-commit-item]')) {
      el.addEventListener('change', () => itemAction('commit', { itemId: el.dataset.commitItem, commit: el.value }));
    }
    // REQ-20260915-003：关联条目联合列表搜索与分页——草稿随输入回写（防重渲染丢字）、
    // 回车 / 按钮提交、一键清除（头部行与无匹配空态共用 data-items-search-clear 口径）、翻页
    const itemsSearchInput = q('#bldItemsSearchInput');
    itemsSearchInput?.addEventListener('input', () => { state.itemsQueryInput = itemsSearchInput.value; });
    itemsSearchInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitItemsSearch(); });
    q('#bldItemsSearchGo')?.addEventListener('click', submitItemsSearch);
    for (const el of view.querySelectorAll('[data-items-search-clear]')) {
      el.addEventListener('click', clearItemsSearch);
    }
    for (const el of view.querySelectorAll('[data-items-pg]')) {
      el.addEventListener('click', () => {
        const a = el.dataset.itemsPg;
        if (a === 'prev') gotoItemsPage(state.itemsPage - 1);
        else if (a === 'next') gotoItemsPage(state.itemsPage + 1);
        else gotoItemsPage(Number(a));
      });
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
    q('#bldFetchBtn')?.addEventListener('click', doSync);
    q('#bldBranchRefresh')?.addEventListener('click', loadBranches);
    q('#bldBranchRetry')?.addEventListener('click', loadBranches);
    // BUG-20260914-009：刷新=重新加载当前页；翻页失败重试重发目标页
    q('#bldLogRefresh')?.addEventListener('click', () => state.logBranch && loadLog(state.logPage));
    q('#bldLogRetry')?.addEventListener('click', retryLogPage);
    q('#bldLogSize')?.addEventListener('change', (e) => setLogPageSize(Number(e.target?.value)));
    // REQ-20260914-002：提交搜索——草稿随输入回写（防重渲染丢字）、回车 / 按钮提交、
    // 一键清除（搜索行与无匹配空态共用 data-log-search-clear 口径）
    const searchInput = q('#bldLogSearchInput');
    searchInput?.addEventListener('input', () => { state.logQueryInput = searchInput.value; });
    searchInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitLogSearch(); });
    q('#bldLogSearchGo')?.addEventListener('click', submitLogSearch);
    for (const el of view.querySelectorAll('[data-log-search-clear]')) {
      el.addEventListener('click', clearLogSearch);
    }
    // REQ-20260920-001：提交节点选择——click 切换选中 / focus 直选（键盘 Tab 即出详情）
    for (const el of view.querySelectorAll('[data-log-row]')) {
      el.addEventListener('click', () => selectLogRow(el.dataset.logRow, { toggle: true }));
      el.addEventListener('focus', () => selectLogRow(el.dataset.logRow));
    }
    for (const el of view.querySelectorAll('[data-pg]')) {
      el.addEventListener('click', () => {
        const v = el.dataset.pg;
        if (v === 'prev') gotoLogPage(state.logPage - 1);
        else if (v === 'next') gotoLogPage(state.logPage + 1);
        else gotoLogPage(Number(v));
      });
    }
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
    // REQ-20260915-002 产品发布入口（REQ-20260915-003 迁入版本卡片按钮区）：
    // merged 卡片「创建发布」打开核对弹层（按所在卡片版本绑定）；
    // BUG-20260915-014：「查看发布记录」不再跳转被隐藏的发布模块——就地激活所在卡片版本的发布页签
    for (const el of view.querySelectorAll('[data-ver-release]')) {
      el.addEventListener('click', () => openReleaseConfirm(el.dataset.verRelease));
    }
    for (const el of view.querySelectorAll('[data-ver-release-view]')) {
      el.addEventListener('click', () => openReleaseTab(el.dataset.verReleaseView));
    }
    q('#bldRelCancel')?.addEventListener('click', () => { state.releaseConfirm = null; render(); });
    q('#bldRelGo')?.addEventListener('click', doCreateRelease);
    q('#bldReleaseWrap')?.addEventListener('click', (e) => {
      if (e.target?.id === 'bldReleaseWrap' && !state.releaseConfirm?.busy) { state.releaseConfirm = null; render(); }
    });
    // REQ-20260920-003 五步流程导航 + 发布记录选择 / 动作 / 只读重试（BUG-20260915-014 迁移）
    for (const el of view.querySelectorAll('[data-step]')) {
      el.addEventListener('click', () => setStep(el.dataset.step));
    }
    for (const el of view.querySelectorAll('[data-pf-retry]')) {
      el.addEventListener('click', () => ensurePublishPlan(true));
    }
    for (const el of view.querySelectorAll('[data-pf-mode]')) {
      el.addEventListener('click', () => {
        const pf = state.pf;
        if (!pf) return;
        syncDocDraft();
        pf.mode = el.dataset.pfMode === 'preview' ? 'preview' : 'edit';
        render();
      });
    }
    const docKey = q('.bld-doc-key');
    const docLang = q('.bld-doc-lang');
    const docFileFromSel = () => `${docKey?.value || 'README'}${docLang?.value === 'en' ? '.en' : ''}.md`;
    docKey?.addEventListener('change', () => selectDocFile(docFileFromSel()));
    docLang?.addEventListener('change', () => selectDocFile(docFileFromSel()));
    for (const el of view.querySelectorAll('[data-doc-file]')) {
      el.addEventListener('click', () => selectDocFile(el.dataset.docFile));
    }
    q('[data-pf-save]')?.addEventListener('click', saveDocFile);
    q('[data-pf-commit]')?.addEventListener('click', commitDocs);
    for (const el of view.querySelectorAll('[data-pf-ide]')) {
      el.addEventListener('click', () => openIdeApp(el.dataset.pfIde));
    }
    q('[data-pf-copy-prompt]')?.addEventListener('click', async () => {
      const box = q('.bld-docs-prompt');
      const ok = await copyText(box?.value || '');
      if (ok) toast('✓ AI 写作提示词已复制：交给技术写作子代理执行，完成后接收短回执');
      else toast('剪贴板不可用：请在提示词文本框中全选（⌘A）并手动复制', true);
    });
    q('[data-pf-copy-site]')?.addEventListener('click', async () => {
      const box = q('.bld-site-prompt');
      const ok = await copyText(box?.value || '');
      if (ok) toast('✓ 官网提示词已复制：请切换到官网仓库会话粘贴执行（提交消息须含完整计划号）');
      else toast('剪贴板不可用：请在提示词文本框中全选（⌘A）并手动复制', true);
    });
    q('[data-pf-push]')?.addEventListener('click', pushMain);
    q('[data-pf-scan]')?.addEventListener('click', () => siteScan(true));
    for (const el of view.querySelectorAll('[data-rel-run]')) {
      el.addEventListener('click', (e) => {
        if (e.target?.closest?.('button')) return;
        selectReleaseRun(el.dataset.relRun);
      });
    }
    for (const el of view.querySelectorAll('[data-rel-act]')) {
      el.addEventListener('click', () => {
        const act = el.dataset.relAct;
        const id = el.dataset.relRun;
        if (act === 'plan') openRelPlan(id);
        else if (act === 'refresh') refreshReleasePane();
        else relAction(id, act);
      });
    }
    for (const el of view.querySelectorAll('[data-publish-open]')) el.addEventListener('click', () => openPublishDirectory(el.dataset.publishOpen));
    for (const el of view.querySelectorAll('[data-publish-settings]')) el.addEventListener('click', goPublishSettings);
    q('#bldRelRetry')?.addEventListener('click', () => ensureReleaseData(true));
    q('[data-rel-detail-retry]')?.addEventListener('click', () => { if (state.rel?.runId) fetchRelDetail(state.rel.runId); });
    q('#bldRelPlanCancel')?.addEventListener('click', closeRelPlan);
    q('#bldRelPlanConfirm')?.addEventListener('click', confirmRelStart);
  }

  document.addEventListener?.('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.rel?.planModal) { closeRelPlan(); return; } // BUG-20260915-014：发布计划确认弹窗（取消不发请求）
    if (state.pushConfirm) { state.pushConfirm = null; render(); return; }
    if (state.deleteConfirm) { if (!state.deleteBusy) { state.deleteConfirm = null; render(); } return; }
    if (state.releaseConfirm) { if (!state.releaseConfirm.busy) { state.releaseConfirm = null; render(); } return; }
    if (state.mergeConfirm) { state.mergeConfirm = null; render(); return; }
    if (state.answer) { state.answer = null; render(); return; }
    if (state.createPanel || state.addPanel) { state.createPanel = null; state.addPanel = null; render(); }
  });
  // 浏览态变化落快照（app.js 统一监听本事件持久化）
  const notify = () => window.dispatchEvent?.(new CustomEvent('atb:build-state'));

  return {
    enter, refresh, setTab, setQuery, snapshot, restoreView, notifyState: notify,
    openCreatePanel, openAddPanel, selectBranch,
    // BUG-20260914-009：提交记录分页行为接缝（测试与翻页交互）
    gotoLogPage, setLogPageSize, retryLogPage,
    // REQ-20260914-002：提交记录搜索行为接缝（测试与搜索交互）
    submitLogSearch, clearLogSearch, markMatch,
    // REQ-20260920-001：历史拓扑图纯函数与节点选择行为接缝（测试与交互）
    logGraph, selectLogRow,
    // 纯函数接缝（测试与面板复用）
    doneCandidates, selectableCandidates, occupiedItemIds, parseAnswer, buildPrompt, logPagerHtml,
    // REQ-20260915-003：关联条目联合列表搜索 / 分页纯函数与行为接缝（测试与交互）
    filterVersionItems, paginateItems, submitItemsSearch, clearItemsSearch, gotoItemsPage,
    // 行为接缝（BUG-20260913-004：openAnswerModal / openMergeConfirm 支持 verId 定位卡片版本；
    // REQ-20260913-004：openDeleteConfirm / doDelete 删除确认与执行；
    // BUG-20260920-006：doMerge 守卫分支（执行中 / 版本不存在）补反馈测试接缝）
    openAnswerModal, openMergeConfirm, openDeleteConfirm, doDelete, doMerge,
    // REQ-20260915-003：切换选中版本（清空关联列表搜索并回第一页）
    selectVersion,
    // REQ-20260915-002：产品发布入口行为接缝（测试与创建交互）
    openReleaseConfirm, doCreateRelease,
    // BUG-20260915-014：详情「正式发布」步与发布记录接缝（测试与就地查看 / 动作交互）；
    // REQ-20260920-003 更名 setDetailTab → setStep（五步流程）
    setStep, openReleaseTab, selectReleaseRun, relAction,
    openRelPlan, confirmRelStart, refreshReleasePane, openPublishDirectory,
    // REQ-20260920-003：发布流程接缝（文档读存提交 / IDE 入口 / 推送 / 官网检测）
    ensurePublishPlan, loadDocFile, saveDocFile, commitDocs, openIdeApp, pushMain, siteScan, setDocMode: (m) => { if (state.pf) { state.pf.mode = m === 'preview' ? 'preview' : 'edit'; render(); } },
    getCandidates: () => state.createPanel?.candidates || [],
    searchStats,
  };
})();

window.ATBBuild = ATBBuild;
