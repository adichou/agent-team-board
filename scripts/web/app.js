'use strict';
// Status Board 前端 —— 每 2 秒轮询 /api/board；人工操作走 POST API。

const $ = (s, el = document) => el.querySelector(s);

const STATE_LABEL = { submitted: '待接受', accepted: '已接受', planned: '已计划', 'in-progress': '开发中', done: '已完成' };
const ACTION_LABEL = { accepted: '接受', done: '确认完成', 'in-progress': '驳回完成（退回开发）', 'submitted': '驳回接受（退回待接受）' };

// 看板六列（REQ-20260906-013 五列 + REQ-20260908-010「已计划」独立档）：「待测试」
// （REQ-20260907-005 由「待确认」更名）是展示层派生分类，位于「开发中」与「已完成」之间——
// in-progress 且 agentCompletedAt（Agent 已上报）归 confirming，其余 in-progress 归 developing；
// 状态机为 submitted → accepted → planned → in-progress → done，列只是分组视图。
const LANES = ['submitted', 'accepted', 'planned', 'developing', 'confirming', 'done'];
const LANE_LABEL = { submitted: '待接受', accepted: '已接受', planned: '已计划', developing: '开发中', confirming: '待测试', done: '已完成' };
const LANE_HINT = {
  submitted: '新条目，等待人工接受',
  accepted: '已接受，可在详情页「移入计划」排入开发计划',
  planned: '已排入开发计划，开发启动后最旧优先处理',
  developing: 'Agent 开发中（未上报）',
  confirming: 'Agent 已上报完成，等待人工测试',
  done: '已人工确认完成',
};
function laneOf(it) {
  if (it.status === 'in-progress') return it.agentCompletedAt ? 'confirming' : 'developing';
  return it.status;
}
// BUG-20260907-016（归属 REQ-20260907-006）：恢复 REQ-20260907-004 第四行状态筛选条，
// 但去掉「全部」档——用户原意是去掉名为「全部」的过滤条件，而非整条移除筛选条。
// 六档即 LANES 派生分类（待接受/已接受/已计划/开发中/待测试/已完成），默认选中第一档「待接受」。
const REQ_FILTERS = LANES.map((lane) => ({ key: lane, label: LANE_LABEL[lane] }));
// REQ-20260908-002：所有列表提供排序——需求视图五档列表共用一组排序键；
// 「已完成」档默认（未搜索时）仅显示最新 REQ_DONE_LIST_LIMIT 项，更早条目用搜索获取
// （/api/search 覆盖全量条目，截断不影响可检索性）。
const REQ_SORTS = [
  ['updated-desc', '最新更新'],
  ['updated-asc', '最早更新'],
  ['created-desc', '最新创建'],
  ['created-asc', '最早创建'],
  ['id-asc', '单号'],
];
const REQ_SORT_DEFAULT = 'updated-desc';
const REQ_DONE_LIST_LIMIT = 100;
const REQ_SORT_STORAGE_KEY = 'atb.req.sort';
function loadReqSort() {
  try {
    const v = localStorage.getItem(REQ_SORT_STORAGE_KEY);
    if (REQ_SORTS.some(([k]) => k === v)) return v;
  } catch { /* localStorage 不可用（隐私模式等）回退默认 */ }
  return REQ_SORT_DEFAULT;
}
function isReqSortKey(v) {
  return REQ_SORTS.some(([k]) => k === v);
}
// 稳定排序：时间键同值回退单号；返回新数组，不改入参
function sortReqItems(items, key = state.reqSort) {
  const timeKey = key === 'created-asc' || key === 'created-desc' ? 'createdAt' : 'updatedAt';
  const dir = key === 'updated-asc' || key === 'created-asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    if (key === 'id-asc') return String(a.id || '').localeCompare(String(b.id || ''));
    const d = String(a[timeKey] || '').localeCompare(String(b[timeKey] || '')) * dir;
    return d !== 0 ? d : String(a.id || '').localeCompare(String(b.id || ''));
  });
}
// REQ-20260907-005：上报未确认（待测试）角标。agentCompletedAt 在人工确认完成后保留
// （上报事实记录，仅人工驳回 done→in-progress 时清空），已完成界面不再渲染该角标与上报提示。
// BUG-20260907-010：列表卡片的状态 chip 已按 lane 显示「待测试」，再渲染角标会同卡片重复；
// 角标仅用于无 lane 状态 chip 的位置（详情抽屉头部、下属 Bug 列表）。
function testFlagHtml(it) {
  return it.agentCompletedAt && it.status !== 'done' ? '<span class="flag">待测试</span>' : '';
}
// REQ-20260907-012 曾以批次进入状态 chip（in-batch / not-in-batch）替代已接受便签；
// REQ-20260908-010 起批次候选口径切换为已计划单，该显示失效，BUG-20260908-020 删除之，
// 已接受行恢复通用 chip 与 LANE_HINT 悬停。
// REQ-20260913-003：去批次概念——条目入轮状态字段随服务端数据源下线，前端不再消费。
// REQ-20260907-004：看板模式与拖拽换列已随布局重构移除；状态流转走详情页按钮与批量接受。
const DOC_LABEL = {
  'README.md': '说明',
  'design.md': '设计',
  'licenses.md': '开源许可', // REQ-20260909-015：条目引用开源库时维护 licenses.md，页签插在「设计」之后
  'test-cases.md': '测试用例',
  'test-report.md': '测试报告',
};
// REQ-20260909-006：详情抽屉页签式布局——头部下方固定页签（基本信息/说明/设计/测试用例/讨论纪要）。
// 说明/设计/测试用例三份文档页签固定显示（缺失时空态提示，不隐藏）；test-report.md 不在页签之列，
// 文件存在时作为「测试用例」之后的附加页签保留测试报告入口。
// REQ-20260909-013：「讨论纪要」页签随讨论模块暂态隐藏（模板与数据机制保留，恢复见条目 design.md）。
const DRAWER_TAB_LABEL = { info: '基本信息', disc: '讨论纪要' };
const DRAWER_FIXED_DOC_TABS = ['README.md', 'design.md', 'test-cases.md'];
// REQ-20260909-015：licenses.md 存在时作为附加页签插在「设计」之后、「测试用例」之前（存在才显示，同 test-report 口径）；
// test-report.md 仍排文档页签末位。页签切换 / 按需加载 / 缓存 / 失效回落均走既有通用链路，无需额外分支。
function drawerDocTabs(it) {
  const tabs = [...DRAWER_FIXED_DOC_TABS];
  if ((it.docs || []).includes('licenses.md')) {
    tabs.splice(tabs.indexOf('design.md') + 1, 0, 'licenses.md');
  }
  if ((it.docs || []).includes('test-report.md')) tabs.push('test-report.md');
  return tabs;
}
function drawerTabValid(tab, it) {
  if (tab === 'info') return true;
  // REQ-20260909-013：disc 页签已隐藏时视为失效（快照 / 会话内残留的激活态经既有回落收敛到基本信息）
  if (tab === 'disc') return !HIDDEN_VIEWS.has('oncall');
  return drawerDocTabs(it).includes(tab);
}

/* ---------- 刷新状态快照（REQ-20260910-001：Cmd+R 刷新回到刷新前界面） ---------- */

// 通道选型见条目 design.md：sessionStorage 会话级（刷新恢复、新开窗口回默认），
// 键按项目根绝对路径隔离（switchProject 按项目重置的既有先例），URL ?project=/?view=
// 深链优先于快照（REQ-20260907-004 深链能力不回归）。不进快照（README 边界）：
// 表单草稿、勾选集合、toast、列表滚动位置、深浅色。
const VIEW_SNAPSHOT_VERSION = 1;
// 文件模块失效回落文案：刷新前查看的文件在刷新间隙被删时的查看器引导（静默降级，非报错）
const FILE_VIEWER_FALLBACK_HINT = '<p class="muted">刷新前查看的文件已不存在；请从上方横幅选择其他文件。</p>';

function viewSnapshotStorageKey(project) {
  return `atb.viewstate:${project}`;
}

function readViewSnapshot(project) {
  if (!project) return null;
  try {
    const raw = sessionStorage.getItem(viewSnapshotStorageKey(project));
    if (!raw) return null;
    const snap = JSON.parse(raw);
    if (!snap || snap.v !== VIEW_SNAPSHOT_VERSION) return null; // 版本不符：视为无快照
    return snap;
  } catch {
    return null; // 存储不可用 / JSON 损坏：按无快照处理，不阻塞 boot
  }
}

// 单一写者：各交互挂点（切模块/筛选/抽屉/页签/搜索/任务页签/目录/文件/讨论事件）即时调用。
// 讨论模块状态经 atb:oncall-state 事件驱动（oncall.js 内部 state 不外露，同 atb:open-req 先例）。
function saveViewSnapshot() {
  if (!state.project) return;
  const snap = {
    v: VIEW_SNAPSHOT_VERSION,
    view: state.view,
    reqFilter: state.reqFilter,
    searchQ: state.search.q || '',
    drawer: state.drawer.id ? { id: state.drawer.id, tab: state.drawer.tab } : null,
    batchMode: state.batch.mode,
    batchPane: state.batch.pane,
    refinePane: state.refine.pane,
    // REQ-20260910-003：全局总览筛选档（状态 / 类型）随快照恢复
    // BUG-20260910-004：面板内独立搜索词一并入快照（面板为临时层，刷新后不自动打开，重开恢复词与档位）
    globalStatus: state.global.statusFilter,
    globalKind: state.global.kindFilter,
    globalQ: state.global.q || '',
    oncall: window.ATBOncall?.snapshot?.() || null,
    // REQ-20260910-019：营销模块浏览态（页签 / 选中版本；表单草稿与未保存内容不进快照）
    marketing: window.ATBMarketing?.snapshot?.() || null,
    // REQ-20260910-029：发布模块浏览态（选中运行 / 页签 / 筛选）
    release: window.ATBRelease?.snapshot?.() || null,
    // REQ-20260913-001：构建模块浏览态（子页签 / 选中版本 / 当前分支）
    build: window.ATBBuild?.snapshot?.() || null,
    files: state.banner.layers.length ? {
      layers: state.banner.layers,
      activeFile: state.banner.activeFile,
      mdSource: !!state.banner.mdSource,
    } : null,
  };
  try {
    sessionStorage.setItem(viewSnapshotStorageKey(state.project), JSON.stringify(snap));
  } catch { /* 存储不可用（隐私模式等）：放弃记忆，不影响功能 */ }
}

// 刷新后恢复：boot() 首轮 poll（数据到位）后调用一次，此后行为与现状完全一致。
// 恢复目标失效时按各模块既有回落先例静默降级（详见条目 design.md「失效回落汇总」）。
// 返回 { view, search }：view 供 boot 与 URL 深链取舍；search 标记是否需要重发模块搜索。
async function applyViewSnapshot(snap) {
  if (!snap) return { view: 'status', search: false };
  if (LANES.includes(snap.reqFilter)) {
    state.reqFilter = snap.reqFilter;
    if (state.board?.initialized) renderBoard(); // 首轮 poll 已按默认档渲染，此处按恢复档重绘 chips 与列表
  }
  let searchRestored = false;
  if (typeof snap.searchQ === 'string' && snap.searchQ) {
    state.search.q = snap.searchQ;
    const input = $('#searchInput');
    if (input) input.value = snap.searchQ;
    syncSearchClearBtn(); // REQ-20260910-009：恢复关键词后清除按钮同步可见
    searchRestored = true; // 请求在 setView 之后由 boot 统一按当前模块解释（runSearch）
  }
  // REQ-20260911-010：批量 Commit 面板已回退——batchMode 不再接受 'commit'（存量快照静默忽略）
  if (['refine', 'develop', 'codex'].includes(snap.batchMode)) state.batch.mode = snap.batchMode; // codex 为存量深链保留
  if (TASK_PANES.some((p) => p.key === snap.batchPane)) state.batch.pane = snap.batchPane;
  if (TASK_PANES.some((p) => p.key === snap.refinePane)) state.refine.pane = snap.refinePane;
  // REQ-20260910-003：全局总览筛选档恢复（非法值回落「全部」）
  if (GLOBAL_STATUS_FILTERS.some((f) => f.key === snap.globalStatus)) state.global.statusFilter = snap.globalStatus;
  if (GLOBAL_KIND_FILTERS.some((f) => f.key === snap.globalKind)) state.global.kindFilter = snap.globalKind;
  // BUG-20260910-004：面板独立搜索词恢复（面板不自动打开；重开面板时词与筛选档就位）
  if (typeof snap.globalQ === 'string') {
    state.global.q = snap.globalQ;
    const gin = $('#globalSearchInput');
    if (gin) gin.value = snap.globalQ;
  }
  // 讨论模块：委托 oncall.js 落位（filter/详情/页签）；讨论已删时其内部静默回列表
  // REQ-20260909-013：讨论模块暂隐藏——跳过其快照落位（不发起讨论内部请求；恢复后照常恢复）
  if (!HIDDEN_VIEWS.has('oncall') && snap.oncall && typeof snap.oncall === 'object') await window.ATBOncall?.restoreView?.(snap.oncall);
  // REQ-20260910-019：营销模块浏览态（页签 / 选中版本）——暂存待 enter 时数据到位后落位
  if (snap.marketing && typeof snap.marketing === 'object') window.ATBMarketing?.restoreView?.(snap.marketing);
  // REQ-20260910-029：发布模块浏览态——暂存待 enter 时数据到位后落位（运行已删则回落列表）
  if (snap.release && typeof snap.release === 'object') window.ATBRelease?.restoreView?.(snap.release);
  // REQ-20260913-001：构建模块浏览态——暂存待 enter 时数据到位后落位（版本已删则回落列表）
  if (snap.build && typeof snap.build === 'object') window.ATBBuild?.restoreView?.(snap.build);
  // 文件模块：层栈与当前文件暂存，initFileBoard 首次初始化时逐层展开消费（失效逐层回落）
  // REQ-20260909-013：文件模块暂隐藏——跳过其快照层栈落位（隐藏期间不初始化文件横幅；恢复后照常）
  if (!HIDDEN_VIEWS.has('files') && snap.files && Array.isArray(snap.files.layers) && snap.files.layers.length) {
    const layers = snap.files.layers.filter((p) => typeof p === 'string');
    if (layers.length) {
      state.banner.restoredLayers = layers;
      state.banner.restoredFile = typeof snap.files.activeFile === 'string' ? snap.files.activeFile : null;
      if (state.banner.restoredFile) state.banner.mdSource = !!snap.files.mdSource; // md 渲染/源码态随快照
    }
  }
  // 需求抽屉：条目仍存活才重开（刷新间隙被删 → 静默保持空态，不触发 refreshDrawer 的报错 toast）；
  // 页签失效（文档被删）由 activateDrawerTab 内 drawerTabValid 回落「基本信息」
  if (snap.drawer && typeof snap.drawer.id === 'string'
    && (state.board?.items || []).some((it) => it.id === snap.drawer.id)) {
    await openDrawer(snap.drawer.id);
    if (state.drawer.id === snap.drawer.id && typeof snap.drawer.tab === 'string') {
      activateDrawerTab(snap.drawer.tab);
    }
  }
  // BUG-20260910-004：旧快照 view='global'（全局曾是主视图）保留原样交 boot setView 收敛为打开面板
  return { view: VIEWS.includes(snap.view) || snap.view === 'global' ? snap.view : 'status', search: searchRestored };
}

const state = {
  board: null,
  boardJson: '',
  drawer: { id: null, item: null, doc: null, navIds: null, deps: null, depsFetched: false, depFilter: '', itemModel: null, tab: 'info', docCache: {} },
  batch: { open: false, mode: 'refine', pane: 'overview' },
  // pane：批量开发运行面板二级页签记忆（REQ-20260909-008，概况/队列/提示词/记录）；
  // REQ-20260909-011：devAgent / refine.mode Agent 选择草稿已随启动区去 Agent 化移除
  batchData: null, // /api/batch/current 最近一次响应
  batchSig: '',    // 变更签名：轮询无变化不重渲染（避免打断面板内点击/输入）
  codex: {         // Codex 自动派发（REQ-20260906-003；REQ-20260907-004 起运行配置在设置模块同步呈现）
    settings: null, status: null, statusSig: '',
    preflight: null, modelProbe: null, probing: false,
    runs: [], runsTotal: 0,
    detail: null, // { runId, run, logName, logData, logOffset, logEof, testReport }
    // REQ-20260906-024：模型目录（只读能力）、继承解析展示、待处理记录
    models: undefined,   // undefined=未加载；null=加载失败；{ok, models, reason}
    inherit: null,       // /api/dispatch/codex/model-inherit 结果
  },
  codexPending: { count: 0, items: [], byItem: new Set() }, // 顶栏徽标 + 行标记（每轮询刷新）
  // REQ-20260911-009 设置页「Git 工作流」分区：分支状态加载/执行反馈
  git: { loading: false, data: null, error: null, busy: false, sig: '' },
  project: null, // 当前展示项目的根绝对路径
  // REQ-20260910-002：深链宿主探测；BUG-20260910-005 补 probing/failed 状态机
  // （undefined=未知；loaded=探测完成；probing=探测进行中；failed=探测通道失败——不等于未安装）
  workspaceApps: { zcode: undefined, codex: undefined, loaded: false, probing: false, failed: false },
  projects: [],  // 已知项目（注册表）
  view: 'status', // status | oncall | runs | files | settings（REQ-20260907-004 五模块）
  reqFilter: LANES[0], // 需求状态筛选档（BUG-20260907-016：五档无「全部」，默认第一档「待接受」）
  reqSort: loadReqSort(), // REQ-20260908-002：列表排序键（localStorage 记忆，非法值回退默认）
  listSig: '',   // 列表内容签名（增量渲染，替代原看板列签名）
  search: { q: '', seq: 0, res: null, resQ: '', timer: null, loading: false, error: null }, // 模块搜索（REQ-20260906-015 起；REQ-20260907-004 移至第三行随模块解释；REQ-20260910-009 增 resQ 结果对应词与 error 持久失败态）
  banner: { initialized: false, layers: [], entriesByPath: {}, activeFile: null, refreshing: false }, // 文件横幅层栈（REQ-20260906-007）
  knownIds: null, // 当前项目已见条目 id 基线；null = 待首轮播种（REQ-20260908-017 起仅登记，不再驱动自动导航）
  acceptance: { selected: new Set(), pending: false, message: '', failures: [] },
  impl: {        // 已计划条目多选（REQ-20260906-018；BUG-20260909-006 起勾选仅为「移出计划」服务，
    //          「进入批量开发」入口与勾选范围推送链路已移除，批量开发入口唯一收敛任务模块）
    selected: new Set(),  // 勾选集合（资格 = planned 且未认领，随轮询剪枝）
    pending: false,       // 批量移出计划进行中（REQ-20260908-010）
    message: '',          // 批量移出计划结果反馈（成功/失败清单，对齐批量接受）
    failures: [],
  },
  plan: {        // 已接受条目多选批量移入计划（REQ-20260908-018）：与详情页「移入计划」同口径
    selected: new Set(),  // 勾选集合（资格 = accepted，随轮询剪枝）
    pending: false,       // 批量移入计划进行中
    message: '',          // 批量移入计划结果反馈（成功/失败清单，对齐批量接受）
    failures: [],
  },
  reject: {      // REQ-20260908-027：已接受条目批量驳回待接受（accepted → submitted），
    // 与批量移入计划共用 plan.selected 勾选集合；pending/message/failures 独立（同档两个操作先后执行互不覆盖状态）
    pending: false,
    message: '',
    failures: [],
  },
  refine: {       // 批量完善（REQ-20260907-003；REQ-20260908-020 起面向已接受单）
    pane: 'overview',    // 运行面板二级页签记忆（REQ-20260909-008；与 state.batch.pane 相互独立）
    data: null,           // /api/refine/current + candidates 快照
    sig: '',              // 渲染签名（轮询剪枝）
  },
  commitStatus: { // 已完成条目提交状态（BUG-20260910-014 保留部分）：/api/commit/item-status 快照
    // REQ-20260911-010：取数换源为 REQ-20260911-009 索引（自动提交账本 + git 历史）；
    // 批量 Commit 面板及其面板数据链路已随回退移除
    map: {},      // itemId → { commits: [完整 hash] }；经核验/自动提交的成功提交
    sig: '',      // 变更签名（轮询剪枝：状态无变化不重绘列表/详情）
    loading: false,
    error: null,  // 查询失败原因（保留上次数据，不伪装成未提交）
  },
  holds: {        // REQ-20260911-007 待人工确认聚合区：/api/holds 快照（持久呈现，不随批次结束消失）
    data: null,   // { count, items: [...] }；null = 尚未加载
    sig: '',      // 渲染签名（轮询剪枝，避免打断展开/点击）
    error: null,  // 加载失败原因（错误条 + 重试入口）
    expanded: new Set(), // 卡片「查看进展记录」展开集合（跨轮询保持）
    events: new Map(),   // itemId → 事件时间线缓存（展开时拉取）
  },
  confirms: {     // REQ-20260914-001 任务页「待人工确认」挂起确认区：/api/confirms 快照
    data: null,   // { count, items: [...] }（含历史账本恢复视图）；null = 尚未加载
    sig: '',      // 渲染签名（轮询剪枝）
    error: null,  // 加载失败原因（错误条 + 重试）
    busyId: null, // 操作中的条目（按钮禁用防重复：核验中/确认中）
    detail: new Map(), // itemId → 详情缓存（卡片展开文件表 / 面板打开时刷新）
  },
  global: {       // REQ-20260910-003 全局任务总览（跨项目只读聚合，不随项目切换重置）；
    //          BUG-20260910-004 起为顶栏入口 + 右侧面板呈现（不再是主视图）
    open: false,           // 面板开合（打开才随轮询拉取；重复打开幂等）
    data: null,           // /api/batch/global 最近一次响应（projects 行）；null=尚未加载成功
    sig: '',              // 渲染签名（轮询 + 筛选 / 搜索变化才重渲染）
    loading: false,       // 首载骨架
    error: null,          // 聚合接口失败原因（保留上次数据 + 顶部提示「刷新失败，正在重试」）
    statusFilter: 'all',  // 状态筛选（GLOBAL_STATUS_FILTERS 键）
    kindFilter: 'all',    // 类型筛选（GLOBAL_KIND_FILTERS 键）
    q: '',                // 面板内独立搜索词（BUG-20260910-004：不写第三行 state.search，不污染原页面搜索条件）
    qTimer: null,         // 面板搜索防抖定时器
  },
  // REQ-20260908-020 批量任务设置；REQ-20260909-001 界面仅剩隐藏开关（模型/档位底层存储保留），
  // loading/error 供设置视图渲染「正在加载任务设置 / 加载失败重试」
  tasks: { settings: null, sig: '', loading: false, error: null },
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

function shortOwner(o) {
  return String(o || '').length > 18 ? String(o).slice(0, 17) + '…' : o;
}

// 本地看板的内容来自自己仓库的 markdown；这里做一层轻量兜底防注入
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

// 所有数据 API 统一携带当前项目参数
function apiUrl(pathname, project = state.project) {
  if (!project) return pathname;
  return `${pathname}${pathname.includes('?') ? '&' : '?'}project=${encodeURIComponent(project)}`;
}

// BUG-20260908-021：条目文档里的相对 .html 演示链接（./ui-demo.html 约定，REQ-20260908-021）在看板内解析。
// 看板是 SPA（页面路径恒为 /），相对链接若不接管会按页面 URL 解析到站点根而必然 404。条目文档均平铺
// 于条目目录，这里只接管「单文件名 .html/.htm」形态（./ 前缀与裸文件名），改写到条目演示端点
// /api/item/:id/demo/:name（服务端按条目目录定位 + CSP 收敛沙箱），并新开标签打开
// （noopener：演示页拿不到看板页引用）。其余链接——http(s) 等协议绝对地址、# 锚点、带子目录或
// 越出条目的相对路径——保持原有行为不动；条目 markdown 源（含 ./ui-demo.html 写法）不改。
function linkupDocDemo(view, itemId) {
  if (!view || !itemId) return;
  for (const a of view.querySelectorAll('a[href]')) {
    const raw = a.getAttribute('href') || '';
    if (!raw || raw.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    const name = raw.replace(/^\.\//, '');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(html|htm)$/i.test(name)) continue;
    a.href = apiUrl(`/api/item/${encodeURIComponent(itemId)}/demo/${encodeURIComponent(name)}`);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    if (!a.title) a.title = '在新标签页打开交互演示';
    // BUG-20260909-005：点击预检接管（见 guardDemoLinkClick）——新标签直接导航不经
    // api() 封装，服务过旧的「未知接口」指引会丢失，这里先同步占位再预检分流。
    a.addEventListener('click', (e) => guardDemoLinkClick(e, a.href));
  }
}

// BUG-20260909-005：演示链接点击预检。演示链接是 target=_blank 直接导航，绕过 api() 封装——
// 当常驻服务进程早于演示端点（BUG-20260908-021 引入）启动时，路由缺失落入「未知接口」JSON
// 兜底，用户只会看到新标签里的裸报错（版本错配类型归纳见 BUG-20260907-017）。静态前端实时
// 读盘、永远最新，因此在最前端补一道预检：
// - 点击时同步开 about:blank 占位标签（保住用户手势，避免异步后再 window.open 被弹窗拦截）；
// - 预检 2xx → 编程式 noopener（tab.opener = null，等效 rel=noopener 防护）后真实导航，
//   由浏览器加载服务端带 CSP 沙箱的响应（不用 document.write，CSP 不走样）；
// - 预检命中「未知接口」类 JSON 404（服务过旧）→ 关闭占位标签，toast 给出 atb serve 自愈指引；
// - 预检网络异常等 → 兜底直接导航占位标签（服务端人读提示页/演示页，与旧版直开等价）。
// 仅拦截普通左键；中键/修饰键点击保留浏览器原生行为。弹窗被拦（tab 为 null）时交还默认导航。
function guardDemoLinkClick(e, href) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const tab = window.open('about:blank', '_blank');
  if (!tab) return; // 占位标签拿不到：不拦截默认导航，按原生 target=_blank 打开
  e.preventDefault();
  const nav = () => {
    tab.opener = null; // 编程式 noopener：演示页拿不到看板页引用（同 rel=noopener 口径）
    tab.location.href = href;
  };
  return fetch(href)
    .then((r) => {
      if (!r.ok && (r.headers.get('content-type') || '').includes('application/json')) {
        return r.json().then((j) => {
          if (typeof j.error === 'string' && j.error.startsWith('未知接口：')) {
            tab.close(); // 不给用户留下裸 JSON 新标签
            toast(`${j.error}。看板服务版本过旧：请在终端运行 atb serve 自动重启过旧服务，然后重试`, true);
            return;
          }
          nav();
        });
      }
      nav();
    })
    .catch(nav);
}

// REQ-20260909-009：条目文档里的相对截图引用（attachments/<文件名>，创建时写入 README
// 描述节）在看板内解析。看板是 SPA（页面路径恒为 /），相对图片若不接管会按页面 URL
// 解析到站点根而必然 404（接管方式参照 linkupDocDemo 先例）。只接管「attachments/ 单
// 文件名」形态（./ 前缀与裸相对均可），改写到条目附件端点 /api/item/:id/attachment/:name
// （端点口径对齐讨论单附件：白名单 MIME + nosniff + 收敛 CSP + no-store + 8MB）；
// http(s)/data: 等协议绝对地址、根相对路径、子目录形态保持原有行为不动。
// 点击放大复用 #oncallLightbox（点击任意处 / Esc 关闭，对齐讨论单交互）；加载失败就地
// 替换为占位说明，不渲染空白破图。
function linkupDocImages(view, itemId) {
  if (!view || !itemId) return;
  for (const img of view.querySelectorAll('img')) {
    const raw = img.getAttribute('src') || '';
    if (!raw || raw.startsWith('#') || raw.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    const m = /^(?:\.\/)?attachments\/([^/]+)$/.exec(raw);
    if (!m) continue;
    let name = m[1];
    try { name = decodeURIComponent(name); } catch { /* 保留原样 */ }
    const url = apiUrl(`/api/item/${encodeURIComponent(itemId)}/attachment/${encodeURIComponent(name)}`);
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

async function api(pathname, opts, project = state.project) {
  const r = await fetch(apiUrl(pathname, project), opts);
  let j = {};
  try { j = await r.json(); } catch {}
  if (!r.ok) {
    // BUG-20260907-017：常驻服务版本过旧（路由集启动时固化）而静态前端已更新时，
    // 新功能接口得 404「未知接口」——补上可操作指引而非裸报错，用户跑 atb serve 即自愈。
    if (typeof j.error === 'string' && j.error.startsWith('未知接口：')) {
      throw new Error(`${j.error}。看板服务版本过旧：请在终端运行 atb serve 自动重启过旧服务，然后刷新页面`);
    }
    throw new Error(j.error || `${r.status} ${r.statusText}`);
  }
  return j;
}

let toastTimer = null;
// REQ-20260906-014：toast 支持可选操作按钮（详情页免确认后的「撤销」入口）。
// 有 action 时文本用 textContent 组装（无 innerHTML 注入面），停留 8 秒给足点击窗口；
// 无 action 时保持旧契约（纯文本 + 3.2 秒自动隐藏）。
function toast(msg, isErr = false, action = null) {
  const el = $('#toast');
  el.classList.toggle('err', isErr);
  el.classList.remove('hidden');
  if (action) {
    const text = document.createElement('span');
    text.textContent = msg;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-act';
    btn.textContent = action.label;
    btn.addEventListener('click', async () => {
      clearTimeout(toastTimer);
      el.classList.add('hidden');
      el.replaceChildren();
      try { await action.run(); } catch (e) { toast(e.message, true); }
    });
    el.replaceChildren(text, btn);
  } else {
    el.replaceChildren();
    el.textContent = msg;
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), action ? 8000 : 3200);
}

/* ---------- 页内确认对话框（BUG-20260907-009） ---------- */

// 同步 window.confirm 在 ZCode 内置浏览器（IAB）中会冻结主线程且无可见弹窗，
// 导致整页卡死、轮询停摆。uiConfirm 是异步页面内自绘对话框：返回 Promise<boolean>，
// 不阻塞事件循环；样式复用 .modal-wrap / .modal / .modal-foot / .btn。
let confirmActive = null; // 未决确认的收尾函数：同屏互斥，后来者自动取消旧框
function uiConfirm({ title, message = '', confirmText = '确定', cancelText = '取消', danger = false } = {}) {
  return new Promise((resolve) => {
    if (confirmActive) confirmActive(false); // 同屏至多一个确认框
    const close = (ok) => {
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      confirmActive = null;
      resolve(ok);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      else if (e.key === 'Enter') { e.preventDefault(); close(true); }
    };
    const overlay = document.createElement('div');
    overlay.className = 'modal-wrap confirm-wrap';
    const box = document.createElement('div');
    box.className = 'modal confirm-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const head = document.createElement('div');
    head.className = 'confirm-title';
    head.textContent = title;
    box.appendChild(head);
    if (message) {
      const body = document.createElement('div');
      body.className = 'confirm-message';
      body.textContent = message;
      box.appendChild(body);
    }
    const actions = document.createElement('div');
    actions.className = 'modal-foot';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = cancelText;
    cancel.addEventListener('click', () => close(false));
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = `btn ${danger ? 'danger' : 'primary'}`;
    ok.textContent = confirmText;
    ok.addEventListener('click', () => close(true));
    actions.appendChild(cancel);
    actions.appendChild(ok);
    box.appendChild(actions);
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    document.body.appendChild(overlay);
    window.addEventListener('keydown', onKey, true);
    confirmActive = close;
    ok.focus(); // 打开即聚焦确认按钮，Enter/Escape 可达
  });
}

/* ---------- 项目定位与切换 ---------- */

function shortProject(p) {
  const parts = String(p).split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(p);
}

function syncProjectUrl() {
  const params = new URLSearchParams();
  if (state.project) params.set('project', state.project);
  if (state.view !== 'status') params.set('view', state.view);
  const q = params.toString();
  history.replaceState(null, '', location.pathname + (q ? `?${q}` : ''));
}

function renderProjectSel() {
  const sel = $('#projectSel');
  if (!sel) return;
  const list = [...state.projects];
  if (state.project && !list.includes(state.project)) list.unshift(state.project);
  sel.innerHTML = '';
  for (const p of list) {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = shortProject(p);
    opt.title = p;
    opt.selected = p === state.project;
    sel.appendChild(opt);
  }
  sel.classList.toggle('hidden', list.length === 0);
}

async function refreshHealth() {
  try {
    const h = await api('/api/health');
    state.projects = h.projects || [];
  } catch {}
  renderProjectSel();
}

async function switchProject(p) {
  if (!p || p === state.project) return;
  state.project = p;
  state.acceptance = { selected: new Set(), pending: false, message: '', failures: [] };
  state.impl = { selected: new Set(), pending: false, message: '', failures: [] }; // BUG-20260909-006：范围推送链路移除，勾选按项目隔离重置
  state.plan = { selected: new Set(), pending: false, message: '', failures: [] }; // REQ-20260908-018：按项目隔离
  state.reject = { pending: false, message: '', failures: [] }; // REQ-20260908-027：批量驳回态按项目隔离
  state.refine = { mode: 'zcode', data: null, sig: '' }; // 完善面板按项目隔离
  state.commitStatus = { map: {}, sig: '', loading: false, error: null }; // 提交状态随项目切换重置，不串项目数据
  state.board = null;
  state.banner = newBannerState(); // 文件横幅按项目隔离，切换后重进文件视图重新加载
  $('#board').classList.add('hidden');
  state.listSig = ''; // 新项目数据不同，列表签名失效
  localStorage.setItem('atb.project', p);
  syncProjectUrl();
  closeDrawer();
  closeBatchDrawer(); // 批次账本按项目隔离，切换后重新拉取
  state.batchData = null;
  state.batchSig = '';
  state.boardJson = ''; // 强制整板重渲染
  state.knownIds = null; // REQ-20260906-016：基线随项目重置，新项目首轮播种（既有条目不算新建）
  state.search.res = null; // 旧项目搜索结果失效：条带先清，关键词保留并按新项目重新解释（REQ-20260906-015）
  state.search.resQ = ''; // REQ-20260910-009：结果对应词一并失效，切换视图时按需重发
  state.search.error = null;
  renderSearchHits();
  if (state.search.q) runSearch();
  await refreshHealth();
  window.ATBOncall?.closeDrawer(); // oncall 抽屉随项目关闭，数据按新项目重新拉取
  window.ATBMarketing?.reset?.(); // REQ-20260910-019：营销档案按项目隔离，切换后重新拉取（草稿由守卫确认丢弃或保存）
  window.ATBRelease?.reset?.(); // REQ-20260910-029：发布配置与运行历史按项目隔离，切换后重新拉取
  if (state.view === 'oncall') await window.ATBOncall?.poll(p, true);
  await poll();
  saveViewSnapshot(); // REQ-20260910-001：项目切换按项目重置——用重置后的默认态覆盖新项目快照，
  // 保证「切换项目后立刻刷新」恢复出的正是刷新前所见（默认初始界面），不残留该项目更早旧浏览态
}

/* ---------- 项目管理（REQ-20260910-005）：初始化 / 导入 / 移出 ---------- */

// 面板内交互态（列表数据用 state.projects / state.project，与切换器同源）
const projPanel = {
  busy: false,        // 任一管理操作进行中：禁用重复提交与冲突操作
  mode: 'init',       // init | import（表单操作切换，切换或改路径即重置确认步）
  preview: null,      // 初始化两步走：preview 成功后的 {input, root, wouldWrite}；null=未在确认步
  pendingRemove: null,// 待确认移出的项目根（确认区内展示，取消即清）
  // REQ-20260910-010 目录存在性检测：phase=idle|scanning|done|error；
  // rows=Map<path, {path, state: exists|missing|error, reason}>；error=整体失败原因
  scan: null,
  batchCandidates: null, // 批量移出确认区展示的候选完整路径（确认后由服务端重新核实）
  opener: null,       // REQ-20260910-014：打开入口（顶栏 / 空态卡按钮），关闭后焦点返回
};

function projNotice(text, isErr = false) {
  const el = $('#projNotice');
  el.textContent = text || '';
  el.classList.toggle('err', !!(isErr && text));
}

function syncProjSubmitLabel() {
  const s = $('#projSubmit');
  s.textContent = projPanel.mode === 'import' ? '导入项目' : (projPanel.preview ? '确认初始化' : '解析路径');
}

// busy 态：提交按钮 + 表单 + 列表操作 + 单项/批量移出确认整体禁用，完成后恢复
function projSetBusy(on, label) {
  projPanel.busy = on;
  const s = $('#projSubmit');
  s.disabled = on;
  if (on) s.textContent = label || '处理中…';
  else syncProjSubmitLabel();
  $('#projMode').disabled = on;
  $('#projPath').disabled = on;
  $('#projRemoveOk').disabled = on;
  $('#projRemoveCancel').disabled = on;
  $('#projBatchOk').disabled = on;
  $('#projBatchCancel').disabled = on;
  for (const b of $('#projList').querySelectorAll('button')) b.disabled = on;
  renderProjScanBar(); // 检测条按钮随 busy 与检测态一并刷新
}

/* ---------- REQ-20260910-010 目录存在性检测 + 一键移出所有不存在的目录 ---------- */

// 行内存在性状态（文字承载，颜色仅辅助）：检测中 / 待检测 / 存在 / 不存在 / 检测失败：原因
function projScanState(p) {
  const scan = projPanel.scan;
  if (!scan || scan.phase === 'idle') return { cls: 'checking', text: '待检测' };
  if (scan.phase === 'scanning') return { cls: 'checking', text: '检测中' };
  if (scan.phase === 'error') return { cls: 'error', text: '检测失败' };
  const row = scan.rows?.get(p);
  if (!row) return { cls: 'checking', text: '待检测' };
  if (row.state === 'exists') return { cls: 'exists', text: '存在' };
  if (row.state === 'missing') return { cls: 'missing', text: '不存在' };
  return { cls: 'error', text: `检测失败${row.reason ? `：${row.reason}` : ''}` };
}

// 检测摘要 + 「重新检测」「移出所有不存在目录（N）」按钮状态
function renderProjScanBar() {
  const sum = $('#projScanSummary');
  const scanBtn = $('#projScanBtn');
  const rmBtn = $('#projRemoveMissingBtn');
  if (!sum || !scanBtn || !rmBtn) return;
  scanBtn.disabled = projPanel.busy;
  rmBtn.textContent = '移出所有不存在目录';
  const scan = projPanel.scan;
  if (!scan || scan.phase === 'idle') {
    sum.textContent = '尚未检测目录存在性。';
    rmBtn.disabled = true;
    return;
  }
  if (scan.phase === 'scanning') {
    sum.textContent = '检测中…';
    rmBtn.disabled = true;
    return;
  }
  if (scan.phase === 'error') {
    // 整体检测失败：不沿用旧结果继续批量操作，提供「重新检测」重试入口
    sum.textContent = `检测失败：${scan.error}——不使用旧结果，请重新检测。`;
    rmBtn.disabled = true;
    return;
  }
  const rows = [...scan.rows.values()];
  const missing = rows.filter((r) => r.state === 'missing');
  const errored = rows.filter((r) => r.state === 'error');
  sum.textContent = `共 ${rows.length} 项，不存在 ${missing.length} 项，检测失败 ${errored.length} 项。`
    + (missing.length ? '' : ' 未发现不存在的目录。');
  rmBtn.textContent = `移出所有不存在目录（${missing.length}）`;
  rmBtn.disabled = projPanel.busy || missing.length === 0; // 检测中/失败/无候选均不可批量提交
}

// 批量移出候选 = 最近一次成功扫描判「不存在」的完整路径（检测失败/存在不进候选）
function batchMissingPaths() {
  const scan = projPanel.scan;
  if (!scan || scan.phase !== 'done' || !scan.rows) return [];
  return [...scan.rows.values()].filter((r) => r.state === 'missing').map((r) => r.path);
}

async function scanProjPanel({ silent = false } = {}) {
  if (projPanel.busy) return;
  projPanel.scan = { phase: 'scanning', rows: null, error: '' };
  hideBatchRemoveConfirm(); // 重新检测更新状态，不执行移出；旧确认区随之失效
  if (!silent) projNotice('检测中…');
  renderProjScanBar();
  renderProjPanelList();
  try {
    const r = await api('/api/project/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, null);
    projPanel.scan = { phase: 'done', rows: new Map((r.projects || []).map((row) => [row.path, row])), error: '' };
  } catch (e) {
    projPanel.scan = { phase: 'error', rows: null, error: e.message };
    projNotice(`检测失败：${e.message}（批量移出不可用，请重新检测）`, true);
  }
  renderProjScanBar();
  renderProjPanelList();
}

function showBatchRemoveConfirm() {
  const list = batchMissingPaths();
  if (!list.length || projPanel.busy) return;
  projPanel.batchCandidates = list;
  $('#projBatchText').textContent = `将移出 ${list.length} 个不存在的目录（仅从列表移出，不删除目录与文档，不停止任务；目录恢复后可重新导入）：\n${list.join('\n')}`;
  $('#projBatchConfirm').classList.remove('hidden');
  $('#projBatchOk').focus(); // 键盘可达：确认按钮聚焦，Enter 确认 / Esc 区域内取消
}

function hideBatchRemoveConfirm() {
  projPanel.batchCandidates = null;
  $('#projBatchConfirm')?.classList.add('hidden');
}

async function confirmBatchRemove() {
  const list = projPanel.batchCandidates;
  if (!list || !list.length || projPanel.busy) return; // 防重复提交
  projSetBusy(true, '移出中…');
  try {
    // 服务端确认时逐项重新核实候选：已恢复存在/已被移出/无法确定的一律跳过并说明原因
    const r = await api('/api/project/remove-missing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: list }),
    }, null);
    state.projects = r.projects || [];
    hideBatchRemoveConfirm();
    renderProjectSel(); // 列表与项目切换器同步更新
    const removed = r.removed || [];
    const skipped = r.skipped || [];
    const failed = r.failed || [];
    if (removed.includes(state.project)) {
      const next = state.projects[0] ?? null; // 当前项目被移出 → 剩余首项；无剩余 → 无项目空态
      if (next) await switchProject(next);
      else await clearProjectState();
    }
    const lines = [`成功 ${removed.length} 项，跳过 ${skipped.length} 项，失败 ${failed.length} 项。`];
    for (const s of skipped) lines.push(`跳过 ${s.path}（${s.reason}）`);
    for (const f of failed) lines.push(`失败 ${f.path}（${f.reason}）`);
    if (failed.length) lines.push('失败的项目已保留在列表中，可重新检测后重试。');
    projNotice(lines.join('\n'), failed.length > 0); // 有失败时按错误样式呈现，不显示全部成功
    toast(`批量移出完成：成功 ${removed.length}，跳过 ${skipped.length}，失败 ${failed.length}`, failed.length > 0);
  } catch (e) {
    projNotice(`批量移出失败：${e.message}`, true);
  } finally {
    projSetBusy(false);
    renderProjPanelList();
    await scanProjPanel({ silent: true }); // 移出后刷新行状态与候选（静默：成功时不清结果提示）
  }
}

function renderProjPanelList() {
  const listEl = $('#projList');
  const projects = state.projects;
  if (!projects.length) {
    listEl.innerHTML = '<div class="notice">暂无项目。使用上方表单初始化或导入项目。</div>';
    return;
  }
  // 同名目录靠完整路径区分；路径可换行不被截断（.proj-path overflow-wrap:anywhere）
  listEl.innerHTML = projects.map((p) => {
    const st = projScanState(p);
    return `
    <div class="proj-row">
      <div class="proj-info">
        <div class="proj-name">${esc(shortProject(p))}${p === state.project ? '<span class="proj-cur">当前</span>' : ''}</div>
        <div class="proj-path" title="${esc(p)}">${esc(p)}</div>
        <div class="proj-scan-state ${st.cls}">${esc(st.text)}</div>
      </div>
      <div class="proj-acts">
        <button type="button" class="btn small"${projPanel.busy ? ' disabled' : ''} data-pj-switch="${esc(p)}">切换</button>
        <button type="button" class="btn small warn"${projPanel.busy ? ' disabled' : ''} data-pj-remove="${esc(p)}">移出</button>
      </div>
    </div>`;
  }).join('');
}

function showRemoveConfirm(p) {
  projPanel.pendingRemove = p;
  $('#projConfirmText').textContent = `移出 ${shortProject(p)}？\n${p}\n仅从列表移出，目录及需求、Bug 文档保留；之后可重新导入。`;
  $('#projConfirm').classList.remove('hidden');
}

function hideRemoveConfirm() {
  projPanel.pendingRemove = null;
  $('#projConfirm').classList.add('hidden');
}

async function openProjPanel() {
  // REQ-20260910-014：已打开时幂等守卫（重复点击不叠加面板、不重置已填内容）
  if (!$('#projModalWrap').classList.contains('hidden')) return;
  projPanel.opener = document.activeElement; // 记录打开入口（顶栏 / 空态卡），关闭后焦点返回
  projPanel.preview = null;
  projPanel.scan = null; // 重置检测态：打开面板按最新列表自动检测（REQ-20260910-010）
  hideRemoveConfirm();
  hideBatchRemoveConfirm();
  const target = $('#projTarget');
  target.classList.add('hidden');
  target.textContent = '';
  projNotice('初始化 = 在新目录创建看板数据；导入 = 加入已有看板数据的项目；移出仅移出列表，目录与文档保留。');
  projSetBusy(false);
  $('#projModalWrap').classList.remove('hidden');
  $('#btnProjManage')?.setAttribute('aria-expanded', 'true'); // REQ-20260910-014：入口开合联动
  await refreshHealth(); // 打开即取最新注册表（其他窗口可能已变更）
  renderProjPanelList();
  $('#projPath').focus(); // 焦点进入面板首控件（沿弹窗先例：路径输入框）
  await scanProjPanel(); // 打开面板即自动检测全部已登记根目录（REQ-20260910-010）
}

function closeProjPanel({ focus = true } = {}) {
  $('#projModalWrap').classList.add('hidden');
  $('#btnProjManage')?.setAttribute('aria-expanded', 'false'); // REQ-20260910-014：入口开合联动
  hideRemoveConfirm();
  hideBatchRemoveConfirm();
  if (!focus) return;
  // 焦点返回打开入口；入口已从 DOM 移除（如空态卡消失）时回落顶栏入口
  const opener = projPanel.opener;
  projPanel.opener = null;
  if (opener && opener.isConnected) opener.focus?.();
  else $('#btnProjManage')?.focus?.();
}

// 移出最后一项：清理当前项目选择与旧条目画面，进入无项目引导空态
async function clearProjectState() {
  state.project = null;
  localStorage.removeItem('atb.project'); // 记忆选择不再指向旧项目
  state.board = { noProject: true, initialized: false, dataDir: null, projectRoot: null, items: [] };
  state.boardJson = '';
  state.listSig = '';
  state.knownIds = null;
  state.search.res = null; // 旧项目搜索结果失效
  state.search.resQ = ''; // REQ-20260910-009：结果对应词一并失效
  state.search.error = null;
  renderSearchHits();
  closeDrawer();
  closeBatchDrawer();
  state.batchData = null;
  state.batchSig = '';
  renderProjectSel();
  setView('status'); // 回到需求模块展示无项目引导卡
  renderBoard();
  await poll(); // 服务器空态 /api/board → noProject 载荷，渲染与本地合成态一致
}

// 初始化两步走 · 第一步：解析路径并展示实际将写入的目标位置（不落盘）
async function submitProjInit(raw) {
  if (projPanel.preview && projPanel.preview.input === raw) return runProjInit(raw); // 第二步：确认执行
  projSetBusy(true, '解析中…');
  try {
    const r = await api('/api/project/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: raw }),
    }, null); // 不带 ?project=：目标由 body.path 显式指定，不受当前项目影响
    const target = $('#projTarget');
    target.classList.remove('hidden');
    if (r.initialized) {
      target.textContent = `${r.root} 已有看板数据（${r.dataDir}），不会覆盖；如需加入列表请切换到「导入项目」。`;
      projPanel.preview = null;
      projSetBusy(false);
      projNotice('该目录已初始化：请改用「导入项目」。', true);
      return;
    }
    const direct = `${r.root.replace(/\/+$/, '')}/docs/agent-team-board`;
    target.textContent = `将写入：${r.wouldWrite}`
      + (r.wouldWrite !== direct ? `（目录位于 git 仓库内，数据写入仓库根；输入：${raw}）` : '');
    projPanel.preview = { input: raw, root: r.root, wouldWrite: r.wouldWrite };
    projSetBusy(false);
    projNotice('请确认实际写入位置后，再次点击「确认初始化」。');
  } catch (e) {
    projSetBusy(false);
    projNotice(`解析失败：${e.message}`, true);
  }
}

// 初始化两步走 · 第二步：确认目标后创建看板数据、加入列表并切换
async function runProjInit(raw) {
  projSetBusy(true, '初始化中…');
  try {
    const r = await api('/api/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: raw }),
    }, null);
    state.projects = r.projects || [];
    closeProjPanel();
    toast(`✓ 已初始化并切换到 ${shortProject(r.root)}（${r.dataDir}）`);
    state.knownIds = null; // 初始化是目录状态变化，首轮重新播种基线（对齐 #btnInit 口径）
    await switchProject(r.root);
    if (r.root === state.project) await poll(); // 初始化的就是当前项目：switchProject 同名早退，主动刷新
  } catch (e) {
    projSetBusy(false);
    projNotice(`初始化失败：${e.message}`, true);
  }
}

async function submitProjImport(raw) {
  projSetBusy(true, '导入中…');
  try {
    const r = await api('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: raw, requireInitialized: true }), // 未初始化目录由服务端拒绝并提示改用初始化
    }, null);
    const existed = state.projects.includes(r.root);
    state.projects = r.projects || [];
    closeProjPanel();
    toast(existed
      ? `已在列表中，已切换到 ${shortProject(r.root)}`
      : `✓ 已导入并切换到 ${shortProject(r.root)}（条目与状态保持原样）`);
    await switchProject(r.root);
    if (r.root === state.project) await poll();
  } catch (e) {
    projSetBusy(false);
    projNotice(`导入失败：${e.message}`, true);
  }
}

async function submitProjForm(e) {
  e.preventDefault();
  if (projPanel.busy) return;
  const raw = $('#projPath').value.trim();
  // 空路径 / 相对路径提交前就地提示（输入保留），存在性与权限由服务端校验结果反馈
  if (!raw) {
    projNotice('请输入项目根目录的绝对路径', true);
    $('#projPath').focus();
    return;
  }
  if (!raw.startsWith('/')) {
    projNotice('路径必须是绝对路径（以 / 开头）', true);
    return;
  }
  if (projPanel.mode === 'import') return submitProjImport(raw);
  return submitProjInit(raw);
}

async function confirmRemoveProject() {
  const p = projPanel.pendingRemove;
  if (!p || projPanel.busy) return;
  projSetBusy(true, '移出中…');
  try {
    const r = await api('/api/project/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: p }),
    }, null);
    state.projects = r.projects || [];
    hideRemoveConfirm();
    renderProjectSel();
    if (p === state.project) {
      const next = state.projects[0] ?? null; // 移出当前项目 → 剩余首项；无剩余 → 无项目空态
      if (next) await switchProject(next);
      else await clearProjectState();
    }
    renderProjPanelList();
    projNotice(`已移出 ${shortProject(p)}（目录与文档保留，可重新导入）`);
    toast(`已移出 ${shortProject(p)}：仅从列表移出，目录与文档保留`);
  } catch (e) {
    projNotice(`移出失败：${e.message}`, true);
  } finally {
    projSetBusy(false);
    renderProjPanelList();
  }
}

async function projListClick(e) {
  const sw = e.target.closest?.('[data-pj-switch]');
  if (sw) {
    if (projPanel.busy) return;
    const p = sw.dataset.pjSwitch;
    projSetBusy(true, '切换中…');
    try {
      await switchProject(p);
      projNotice(`已切换：${p}`);
    } catch (err) {
      projNotice(`切换失败：${err.message}`, true);
    } finally {
      projSetBusy(false);
      renderProjPanelList();
    }
    return;
  }
  const rm = e.target.closest?.('[data-pj-remove]');
  if (rm && !projPanel.busy) showRemoveConfirm(rm.dataset.pjRemove);
}

/* ---------- File Board：横幅文件浏览 + 语法高亮（REQ-20260906-007） ---------- */

const HL_LANG = {
  md: 'markdown', markdown: 'markdown',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript',
  json: 'json', css: 'css', scss: 'scss', less: 'less',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  py: 'python', swift: 'swift', yml: 'yaml', yaml: 'yaml',
  java: 'java', go: 'go', rs: 'rust', rb: 'ruby', sql: 'sql',
};

// REQ-20260906-010：图片直接预览（/api/fs/raw 白名单同步）；md 默认渲染可切源码
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif']);
const MD_EXT = new Set(['md', 'markdown']);

// REQ-20260907-004 第三行：各模块副标题（不显示模块大标题）
// BUG-20260909-002：设置模块的派发默认值副标题删除（保留空串占位，其余模块不受影响）
// BUG-20260909-013：讨论副标题精简为简凑口径（筛选条行末同义提示已删，避免同屏重复）
// REQ-20260909-013：讨论 / 文件模块随入口暂态隐藏，其副标题项一并移出（恢复时按 design.md 加回）
// REQ-20260911-002：营销 / 发布模块随入口暂态隐藏，其副标题项一并移出（恢复时按条目 design.md 加回；
// release 副标题沿用 BUG-20260911-002 通用化文案，不回退渠道枚举口径）
const MODULE_SUB = {
  status: '从想法到验收，跟进每一项工作',
  // REQ-20260913-001：构建模块（版本管理 + 分支浏览与同步）插在需求与任务之间
  build: '版本计划与分支，集中在这里',
  runs: '进度、队列与结果集中在这里',
  settings: '',
};

// REQ-20260907-004：模块视图（讨论 / 需求 / 任务 / 文件 / 营销 / 发布 / 设置）。
// REQ-20260910-019：新增营销模块（档案 / 定位与定价 / 渠道与行动 / 效果与复盘四页签，后两页暂不可用）。
// REQ-20260910-029：新增发布模块（Git 远端 / Apple App Store 发布流水线，插在营销与设置之间）。
// REQ-20260913-001：新增构建模块（版本管理 + 分支浏览与同步，插在需求与任务之间）。
// BUG-20260910-004：全局任务总览不再是主视图（入口移至顶栏「管理项目」右侧，打开右侧面板），
// 旧 view=global 深链 / 快照 / 浏览器回放经 setView 收敛为打开面板，见 setView 内分支
const VIEWS = ['status', 'oncall', 'build', 'runs', 'files', 'marketing', 'release', 'settings'];

// REQ-20260909-013：讨论（oncall）/ 文件（files）模块暂态隐藏开关——暂态隐藏，不是功能删除。
// 仅收敛界面入口与间接跳转（顶栏按钮、详情讨论纪要、来源讨论、搜索跨模块入口、旧深链 / 快照回落），
// 服务端接口、docs 数据与既有 JS 机制零改动。恢复步骤见条目 design.md：
// 从本集合移除键 + 还原 index.html 两处入口（module-nav 按钮、新建类型 <option value="ask">）。
// REQ-20260911-002：营销（marketing）/ 发布（release）同口径暂态隐藏——仅收敛顶栏按钮与旧深链 /
// 快照回落；模块源码、#marketingView / #releaseView 容器、服务端接口与数据零改动，
// 恢复步骤见 REQ-20260911-002 条目 design.md。
const HIDDEN_VIEWS = new Set(['oncall', 'files', 'marketing', 'release']);

// REQ-20260911-002：隐藏模块回落 toast 的模块名（与顶栏入口文案一致；恢复入口时同步加回）
const HIDDEN_VIEW_LABEL = { oncall: '讨论', files: '文件', marketing: '营销', release: '发布' };

function setView(v) {
  // BUG-20260910-004：global 收敛为打开全局任务面板——不切换当前项目模块（state.view 不变），
  // 关闭面板后回到打开前的模块与搜索 / 筛选 / 浏览上下文
  if (v === 'global') {
    openGlobalPanel();
    return;
  }
  // REQ-20260909-013 / REQ-20260911-002：隐藏模块统一兜底——旧深链（?view=oncall / ?view=files /
  // ?view=marketing / ?view=release）、刷新快照与残余跨模块入口一律回落需求模块（无空白视图）；
  // toast 按模块名一次性提示，URL 由下方 syncProjectUrl 按回落后的模块重写
  // （view 参数清理、project 等无关参数保留）
  if (HIDDEN_VIEWS.has(v)) {
    toast(`「${HIDDEN_VIEW_LABEL[v] || v}」模块已暂时隐藏，已回到需求模块`);
    v = 'status';
  }
  if (!VIEWS.includes(v)) v = 'status';
  state.view = v;
  for (const b of document.querySelectorAll('.view-tab')) b.classList.toggle('active', b.dataset.view === v);
  const b = state.board;
  const showStatus = v === 'status';
  $('#reqView').classList.toggle('hidden', !showStatus);
  $('#board').classList.toggle('hidden', !showStatus || !b?.initialized);
  $('#emptyState').classList.toggle('hidden', !showStatus || !!b?.initialized);
  syncEmptyCards(); // REQ-20260910-005：无项目空态引导卡（noProject 载荷）
  $('#filterBar')?.classList.toggle('hidden', !showStatus || !b?.initialized); // BUG-20260907-016 恢复第四行筛选条显隐
  $('#fileView').classList.toggle('hidden', v !== 'files');
  // REQ-20260907-001/004：讨论视图（独立 ASK 讨论单，不与其他视图共享容器）
  $('#oncallView').classList.toggle('hidden', v !== 'oncall');
  // REQ-20260907-004：任务模块页面化（原批量开发抽屉），离开视图时停用轮询刷新
  $('#runsView').classList.toggle('hidden', v !== 'runs');
  // REQ-20260910-019：营销模块（enter 幂等：数据已就绪不重复拉取，编辑中的草稿不受进入影响）
  $('#marketingView').classList.toggle('hidden', v !== 'marketing');
  if (v === 'marketing') window.ATBMarketing?.enter(state.project);
  // REQ-20260910-029：发布模块（enter 幂等：只读拉取与轮询，不触发任何执行）
  $('#releaseView').classList.toggle('hidden', v !== 'release');
  if (v === 'release') window.ATBRelease?.enter(state.project);
  // REQ-20260913-001：构建模块（enter 幂等：只读拉取版本与分支数据，不触发任何 git 写操作）
  $('#buildView').classList.toggle('hidden', v !== 'build');
  if (v === 'build') {
    window.ATBBuild?.enter(state.project);
    window.ATBBuild?.setQuery(state.search.q); // 搜索词随模块解释：构建按版本名 / 单号前端过滤
  }
  // BUG-20260910-004：全局任务总览改为顶栏入口 + 右侧面板（#globalPanel），不再占主视图容器
  $('#settingsView').classList.toggle('hidden', v !== 'settings');
  state.batch.open = v === 'runs';
  if (v !== 'status') closeDrawer();
  updatePageHead();
  syncReqSortVisibility(); // REQ-20260910-016：切模块隐藏需求排序菜单 / 回到需求恢复
  updateSearchPlaceholder();
  renderSearchHits(); // 关键词保留，按新视图重新解释（REQ-20260906-015）
  ensureSearchForView(); // REQ-20260910-009：需求/文件视图缺本词结果时补发，避免反馈条停留「搜索中」
  syncProjectUrl();
  if (v === 'files') initFileBoard();
  if (v === 'oncall') {
    window.ATBOncall?.setQuery(state.search.q); // 搜索词随模块解释：讨论按标题/编号前端过滤
    window.ATBOncall?.poll(state.project, true);
  }
  if (v === 'runs') refreshBatch();
  if (v === 'settings') renderSettingsView();
  saveViewSnapshot(); // REQ-20260910-001：模块切换进入快照（含恢复路径自身，幂等）
}

// 第三行内容同步：副标题 + 搜索框显隐（设置模块无搜索对象）
function updatePageHead() {
  const sub = $('#moduleSub');
  if (sub) sub.textContent = MODULE_SUB[state.view] || '';
  const search = $('#pageHead .module-search');
  // REQ-20260910-019：营销模块无全局搜索对象（档案表单内检索不适用），与设置同法隐藏搜索框；
  // REQ-20260910-029：发布模块筛选在模块工具栏内（目标 / 状态），与设置同法隐藏全局搜索框
  if (search) search.classList.toggle('hidden', state.view === 'settings' || state.view === 'marketing' || state.view === 'release');
}

// REQ-20260910-016：需求排序菜单迁至第三行定位组（搜索框左侧）——仅需求模块且看板已初始化时可见；
// 切其他模块隐藏（各模块搜索解释不变），回到需求模块恢复当前排序；未初始化 / 无项目不出现可操作入口。
// setView（切模块）与 renderBoard（初始化状态随轮询变化）两处接入
function syncReqSortVisibility() {
  const sel = $('#reqSort');
  if (sel) sel.classList.toggle('hidden', state.view !== 'status' || !state.board?.initialized);
}

/* ---------- 模块搜索（REQ-20260906-015；REQ-20260907-004 移至第三行随模块解释） ---------- */

const SEARCH_DEBOUNCE_MS = 250; // 输入防抖

// 各模块搜索对象说明（占位符）：讨论与任务为前端过滤，需求/文件沿用 /api/search。
// BUG-20260910-004：全局不再是模块视图——全局搜索移入右侧面板（#globalSearchInput，词存 state.global.q）
// REQ-20260909-013：讨论 / 文件模块随入口暂态隐藏，其占位符与范围标签项一并移出（恢复时按 design.md 加回）
const SEARCH_PLACEHOLDER = {
  status: '搜需求 / Bug / 文档…',
  // REQ-20260913-001：构建模块搜索为前端过滤（版本名 / 单号 / 分支名）
  build: '搜版本 / 单号 / 分支…',
  runs: '搜任务、编号或执行器…',
};

// REQ-20260910-009：各模块搜索范围标签——常显于输入框旁（#searchScope），输入前后均可见，
// 不再只靠占位符表达范围；语义与 SEARCH_PLACEHOLDER 同键（设置模块无搜索，整组隐藏）
const SEARCH_SCOPE = {
  status: '需求',
  build: '构建',
  runs: '任务',
};

function updateSearchPlaceholder() {
  const input = $('#searchInput');
  if (!input) return;
  input.placeholder = SEARCH_PLACEHOLDER[state.view] || '';
  const scope = $('#searchScope');
  const label = SEARCH_SCOPE[state.view] || '';
  if (scope) scope.textContent = label;
  if (label) input.setAttribute('aria-label', `在${label}中搜索`); // 范围随模块同步到输入框无障碍名称
}

// REQ-20260910-009：显式清除按钮仅在有词时显示（无词时隐藏，不提供无意义目标）
function syncSearchClearBtn() {
  const btn = $('#searchClear');
  if (!btn) return;
  btn.classList.toggle('hidden', !($('#searchInput')?.value || '').trim());
}

// 搜索过滤生效中且已有结果：返回可见条目（id/标题命中集合）；未搜索/结果未到不过滤
function searchVisibleItems(items) {
  const s = state.search;
  if (!s.q || !s.res) return items;
  const hit = new Set((s.res.items || []).map((it) => it.id));
  return items.filter((it) => hit.has(it.id));
}

function clearSearch() {
  const s = state.search;
  if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  s.q = '';
  s.seq++; // 在途响应作废：清空后迟到的旧结果不得覆盖恢复后的模块内容
  s.res = null;
  s.resQ = '';
  s.loading = false;
  s.error = null;
  const input = $('#searchInput');
  if (input) {
    input.value = '';
    input.closest('.global-search')?.classList.remove('loading');
    input.focus(); // 焦点留在输入框：清空后可继续输入新关键词（不关闭已打开详情）
  }
  syncSearchClearBtn();
  saveViewSnapshot(); // REQ-20260910-001：清空后的空关键词进入快照
  // 讨论/任务/构建为前端过滤：清空即时恢复全量
  if (state.view === 'oncall') window.ATBOncall?.setQuery('');
  if (state.view === 'build') window.ATBBuild?.setQuery('');
  if (state.view === 'runs' && state.batchData) { state.batchSig = ''; renderBatchDrawer(); }
  renderSearchHits();
  renderBoard();
}

async function runSearch() {
  const input = $('#searchInput');
  const q = (input?.value || '').trim();
  const s = state.search;
  s.q = q;
  s.error = null; // 新一轮搜索开始：上一次失败说明不再保留（重试成功的口径一致）
  syncSearchClearBtn();
  saveViewSnapshot(); // REQ-20260910-001：关键词落定即进入快照（结果不进快照，恢复后按模块重新解释）
  // REQ-20260907-004：讨论按标题/编号前端过滤；任务按编号/标题/执行器前端过滤，不发 API；
  // REQ-20260913-001：构建按版本名 / 单号前端过滤，不发 API
  if (state.view === 'oncall') {
    window.ATBOncall?.setQuery(q);
    renderSearchHits();
    return;
  }
  if (state.view === 'build') {
    window.ATBBuild?.setQuery(q);
    renderSearchHits();
    return;
  }
  if (state.view === 'runs') {
    if (state.batchData) { state.batchSig = ''; renderBatchDrawer(); }
    renderSearchHits();
    return;
  }
  if (!q) {
    s.res = null;
    s.resQ = '';
    s.loading = false;
    input?.closest('.global-search')?.classList.remove('loading');
    renderSearchHits();
    renderBoard();
    return;
  }
  const seq = ++s.seq;
  s.loading = true;
  input?.closest('.global-search')?.classList.add('loading');
  renderSearchHits(); // 反馈条先进入「正在搜索」，旧结果保留并标注为旧结果
  try {
    const res = await api(`/api/search?q=${encodeURIComponent(q)}`);
    if (s.seq !== seq) return; // 竞态防护：旧响应不覆盖新输入
    s.res = res;
    s.resQ = q; // 结果对应的关键词：加载 / 切模块期间据此判断是否为旧结果
    s.loading = false;
    input?.closest('.global-search')?.classList.remove('loading');
    renderSearchHits();
    renderBoard();
  } catch (e) {
    if (s.seq !== seq) return;
    s.loading = false;
    s.error = e.message; // REQ-20260910-009：失败持久显示在反馈条内（含重试入口），关键词保留
    input?.closest('.global-search')?.classList.remove('loading');
    renderSearchHits();
  }
}

// REQ-20260910-009：失败重试——用当前关键词再搜一次，成功后 runSearch 清除 error
function retrySearch() {
  const s = state.search;
  if (!s.q) return;
  runSearch();
}

// REQ-20260910-009：模块切换后补发搜索——需求 / 文件共用 /api/search 响应，当前关键词尚无
// 对应结果（如在讨论视图输入后切来，resQ 不一致）且未在加载时重发，修复切视图后停留「搜索中」
function ensureSearchForView() {
  const s = state.search;
  if (!s.q) return;
  if (state.view !== 'status' && state.view !== 'files') return;
  if (!s.loading && s.resQ !== s.q) runSearch();
}

function bindSearchOnce() {
  const input = $('#searchInput');
  if (!input || input.dataset.searchBound) return;
  input.dataset.searchBound = '1';
  input.addEventListener('input', () => {
    const s = state.search;
    if (s.timer) clearTimeout(s.timer);
    syncSearchClearBtn();
    if (!input.value.trim()) { // ✕ 清空 / 删空：立即恢复
      clearSearch();
      return;
    }
    s.timer = setTimeout(() => { s.timer = null; runSearch(); }, SEARCH_DEBOUNCE_MS);
  });
  input.addEventListener('search', () => clearSearch()); // type=search 自带清空按钮
  input.addEventListener('keydown', (e) => {
    const s = state.search;
    // Enter：不等防抖窗口，清掉定时器立即按当前关键词搜索
    if (e.key === 'Enter') {
      if (s.timer) { clearTimeout(s.timer); s.timer = null; }
      e.preventDefault();
      runSearch();
    }
    // 输入框内 Esc 只清空搜索，不冒泡触发全局 Esc 关抽屉
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (input.value) clearSearch();
    }
  });
  // REQ-20260910-009：显式清除按钮——清空并把焦点交还输入框（clearSearch 内落焦）
  $('#searchClear')?.addEventListener('click', () => clearSearch());
}

// 按当前视图渲染搜索反馈（旧名保留：原 #docHits / #fileSearchHits 两条带已统一到 #searchFeedback）
function renderSearchHits() {
  renderSearchFeedback();
}

// REQ-20260910-009：统一搜索反馈条 #searchFeedback——紧邻搜索输入组、位于模块内容之前，五模块共用。
// 状态机：未输入（隐藏，不显示「无匹配」）/ 加载（正在搜索，旧结果标注不冒充新词结果）/
// 正常（关键词 + 范围 + 分组数量 + 可点击结果）/ 空结果 / 失败（持久说明 + 重试，关键词保留）/ 截断。
// 渲染本身不发请求：需求 / 文件读 state.search.res（/api/search 同一响应），讨论 / 任务用前端过滤计数
//（BUG-20260910-004：全局改为右侧面板独立搜索，不再经本反馈条计数）
function renderSearchFeedback() {
  const el = $('#searchFeedback');
  if (!el) return;
  const s = state.search;
  const view = state.view;
  syncSearchClearBtn();
  if (view === 'settings' || !s.q) { // 未输入：隐藏反馈条，仅范围标签可见
    el.classList.add('hidden');
    el.replaceChildren();
    return;
  }
  el.classList.remove('hidden');
  const remote = view === 'status' || view === 'files'; // 需求 / 文件读既有搜索接口的同一响应
  const stale = !!s.res && s.resQ !== s.q; // 上一关键词的结果：加载新词期间保留并标注
  const head = [`<span class="hits-title">「${esc(s.q)}」<span class="search-scope">· ${esc(SEARCH_SCOPE[view] || '')}</span></span>`];
  if (s.error) {
    head.push(`<span class="hits-error">搜索失败：${esc(s.error)}</span>`);
  } else if (s.loading && remote) {
    head.push('<span class="hits-loading">正在搜索……</span>');
  }
  if (stale) head.push(`<span class="hits-stale">旧结果（「${esc(s.resQ)}」）</span>`);
  head.push('<button type="button" class="btn small hits-clear">清除搜索</button>');
  let body = '';
  if (s.error) {
    body = '<span class="hits-note">关键词已保留：点击「重试」用当前词重新搜索，或修改关键词后再试。</span>';
  } else if (remote) {
    if (s.res && !stale) {
      const r = s.res;
      const empty = !(r.items || []).length && !(r.docs || []).length && !(r.files || []).length;
      body = empty
        ? '<span class="hits-note">未找到匹配结果：换个关键词试试，或清除搜索恢复模块内容。</span>'
        : (view === 'status' ? renderDocHits() : renderFileHits());
    } // 结果未到 / 加载新词：只显示「正在搜索」，不显示「无匹配」
  } else if (view === 'oncall') {
    const st = window.ATBOncall?.searchStats?.();
    if (st) body = `<span class="hits-note">命中 ${st.matched} / 共 ${st.total}（当前筛选可见 ${st.visible}）</span>`;
  } else if (view === 'runs') {
    // BUG-20260910-009：两面板列表真实按关键词前端过滤后，口径说明与行为一致
    body = '<span class="hits-note">关键词在下方面板内前端过滤（编号 / 标题 / 执行器），不发请求</span>';
  } else if (view === 'build') {
    // REQ-20260913-001：构建模块搜索为前端过滤（版本名 / 单号）
    const st = window.ATBBuild?.searchStats?.();
    body = st
      ? `<span class="hits-note">命中 ${st.matched} / 共 ${st.total} 个版本（按版本名 / 单号）</span>`
      : '<span class="hits-note">关键词在版本列表内前端过滤（版本名 / 单号），不发请求</span>';
  }
  const truncated = remote && s.res && !stale && (s.res.truncated || []).length
    ? '<span class="hits-trunc">仅显示部分结果（每类前 50 条），请缩小关键词</span>'
    : '';
  el.innerHTML = `
    <div class="hits-head">${head.join('')}${truncated}${s.error ? '<button type="button" class="btn small warn hits-retry">重试</button>' : ''}</div>
    <div class="hits-body">${body}</div>`;
  el.querySelector('.hits-clear')?.addEventListener('click', () => clearSearch());
  el.querySelector('.hits-retry')?.addEventListener('click', () => retrySearch());
  for (const b of el.querySelectorAll('.hit-row.item')) {
    b.addEventListener('click', () => openDrawer(b.dataset.hitId)); // 条目命中打开详情
  }
  for (const b of el.querySelectorAll('.hit-row.doc')) {
    b.addEventListener('click', async () => {
      await openDrawer(b.dataset.hitId);
      loadDoc(b.dataset.hitDoc, true); // 文档命中：打开对应条目并定位到命中文档
    });
  }
  for (const b of el.querySelectorAll('.hit-file')) {
    b.addEventListener('click', () => openFile(b.dataset.path)); // 文件命中打开预览
  }
  for (const b of el.querySelectorAll('[data-goto-view]')) {
    b.addEventListener('click', () => setView(b.dataset.gotoView)); // 跨模块入口：只切视图，关键词保留由目标模块重新解释
  }
}

// REQ-20260910-009：需求视图分组构建（函数名保留旧契约）——「条目」「文档」两组各标数量，
// 文件命中以跨模块入口呈现；条目命中同时过滤下方列表（searchVisibleItems），返回片段供反馈条组装
function renderDocHits() {
  const res = state.search.res || {};
  const items = res.items || [];
  const docs = res.docs || [];
  const files = res.files || [];
  const itemRows = items.map((it) => `
      <button type="button" class="hit-row item" data-hit-id="${esc(it.id)}" title="${esc(it.id)} ${esc(it.title)}">
        <span class="hit-id">${esc(it.id)}</span><span class="hit-text">${esc(it.title)}</span>
      </button>`).join('');
  const docRows = docs.map((d) => `
      <button type="button" class="hit-row doc" data-hit-id="${esc(d.id)}" data-hit-doc="${esc(d.name)}" title="${esc(d.id)} / ${esc(d.name)}:${d.line}">
        <span class="hit-id">${esc(d.id)}</span><span class="hit-doc">${esc(d.name)}:${d.line}</span>
        <span class="hit-text">${esc(d.text)}</span>
      </button>`).join('');
  return `
    <div class="hits-group"><span class="hits-group-title">条目 ${items.length}</span>${itemRows || '<span class="muted small">无命中</span>'}</div>
    <div class="hits-group"><span class="hits-group-title">文档 ${docs.length}</span>${docRows || '<span class="muted small">无命中</span>'}</div>
    ${HIDDEN_VIEWS.has('files') ? '' : `<button type="button" class="btn small quiet hits-goto" data-goto-view="files">文件 ${files.length} · 在文件查看</button>`}`;
}

// REQ-20260910-009：文件视图分组构建（函数名保留旧契约）——路径 chip 列表（点击 openFile 预览）
// + 返回需求查看条目 / 文档命中的跨模块入口；文件模块横幅保持原有内容，不再被搜索替代
function renderFileHits() {
  const res = state.search.res || {};
  const files = res.files || [];
  const others = (res.items || []).length + (res.docs || []).length;
  const chips = files.map((f) => `
      <button type="button" class="fchip file hit-file" data-path="${esc(f.path)}" data-kind="file" title="${esc(f.path)}">
        <span class="fchip-icon file" aria-hidden="true"></span><span class="fchip-name">${esc(f.path)}</span>
      </button>`).join('');
  return `
    <div class="hits-group"><span class="hits-group-title">文件 ${files.length}</span>${chips || '<span class="muted small">无命中文件</span>'}</div>
    <button type="button" class="btn small quiet hits-goto" data-goto-view="status">需求 / Bug / 文档命中 ${others} · 在需求查看</button>`;
}

// 横幅状态工厂：layers 为从根到最深层的目录路径栈（首元素 ''），
// entriesByPath 缓存每层 /api/fs 结果（模块切回时经 refreshBannerLayers 重拉，BUG-20260907-011），
// activeFile 记录当前选中文件 chip，refreshing 为重拉单飞标记；
// restoredLayers/restoredFile 为刷新恢复暂存（REQ-20260910-001，initFileBoard 首次初始化消费后置空）
function newBannerState() {
  return { initialized: false, layers: [], entriesByPath: {}, activeFile: null, mdSource: false, wrap: false, refreshing: false, restoredLayers: null, restoredFile: null };
}

async function fetchDirEntries(dirPath) {
  const j = await api(`/api/fs?path=${encodeURIComponent(dirPath)}`);
  return j.entries; // [{ name, dir, size, mtime }]，目录在前、文件在后（服务端排序）
}

// 目录/文件 chip：data-path 为从项目根起的完整路径，data-kind 区分动作
function fchipHtml(en, dirPath) {
  const p = dirPath ? `${dirPath}/${en.name}` : en.name;
  const isDir = !!en.dir;
  const active = !isDir && p === state.banner.activeFile ? ' active' : '';
  return `<button type="button" class="fchip ${isDir ? 'dir' : 'file'}${active}" data-path="${esc(p)}" data-kind="${isDir ? 'dir' : 'file'}" title="${esc(p)}" aria-label="${isDir ? '打开目录' : '打开文件'} ${esc(en.name)}"><span class="fchip-icon ${isDir ? 'dir' : 'file'}" aria-hidden="true"></span><span class="fchip-name">${esc(en.name)}</span></button>`;
}

// 整段重建面包屑 + 层栈条带：层栈浅、不参与 2 秒轮询（模块切回时经 refreshBannerLayers 重拉，
// BUG-20260907-011），重建成本可忽略
function renderBanner() {
  const crumbEl = $('#fileCrumb');
  const stackEl = $('#bannerStack');
  const segs = ATBBanner.crumbOf(state.banner.layers, shortProject(state.project || '项目'));
  crumbEl.replaceChildren(...segs.map((s, i) => {
    const item = document.createElement('span');
    item.className = 'crumb-item';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `crumb-seg${i === segs.length - 1 ? ' current' : ''}`;
    b.dataset.path = s.path;
    b.textContent = s.name;
    item.appendChild(b);
    if (i < segs.length - 1) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = '›';
      item.appendChild(sep);
    }
    return item;
  }));
  stackEl.innerHTML = state.banner.layers.map((dirPath) => {
    const entries = state.banner.entriesByPath[dirPath] || [];
    const chips = entries.length
      ? entries.map((en) => fchipHtml(en, dirPath)).join('')
      : '<span class="muted small banner-empty">（空目录）</span>';
    return `<div class="banner-row" role="group" aria-label="${esc(dirPath || '项目根')}下的条目">${chips}</div>`;
  }).join('');
}

// 进入目录：状态机截断或追加层；仅新最深层需要拉取（浅层沿用缓存）。
// 失败 throw 由调用方决定提示方式；成功后最深层条带滚入视野
async function openDirLayer(dirPath) {
  const layers = ATBBanner.openLayer(state.banner.layers, dirPath);
  const deepest = layers[layers.length - 1];
  if (!deepest && deepest !== '') return;
  if (!state.banner.entriesByPath[deepest]) {
    state.banner.entriesByPath[deepest] = await fetchDirEntries(deepest);
  }
  state.banner.layers = layers;
  renderBanner();
  saveViewSnapshot(); // REQ-20260910-001：目录层级进入快照
  const rows = $('#bannerStack').querySelectorAll('.banner-row');
  rows[rows.length - 1]?.scrollIntoView({ block: 'nearest', inline: 'start' });
}

// BUG-20260907-011：模块切回文件视图时对当前层栈做后台重拉——entriesByPath 是会话级
// 缓存，外部（Agent 会话/编辑器/构建）新增文件否则必须整页刷新才可见。
// 单飞（refreshing 标记）防并发重复拉取；快照层栈，重拉期间用户增删层互不影响；
// 单层失败保留该层旧缓存（横幅仍可用、不打断阅读），全部完成后重建一次条带。
async function refreshBannerLayers() {
  if (state.banner.refreshing) return;
  state.banner.refreshing = true;
  try {
    const layers = state.banner.layers.slice(); // 快照：重拉期间层栈可能被截断/下钻
    const fresh = await Promise.all(layers.map(async (dirPath) => {
      try {
        return [dirPath, await fetchDirEntries(dirPath)];
      } catch {
        return null; // 单层失败：保留旧缓存，其余层照常更新
      }
    }));
    for (const r of fresh) if (r) state.banner.entriesByPath[r[0]] = r[1];
    renderBanner();
  } finally {
    state.banner.refreshing = false;
  }
}

async function openFile(key, opts = {}) {
  state.banner.activeFile = key;
  renderBanner(); // 同步文件 chip 选中态
  const viewer = $('#fileViewer');
  viewer.innerHTML = '<p class="muted">加载中…</p>';
  const ext = key.includes('.') ? key.split('.').pop().toLowerCase() : '';
  // REQ-20260906-010：图片直接经 raw 端点以 <img> 预览（文本端点会按二进制拒绝）
  if (IMAGE_EXT.has(ext)) {
    saveViewSnapshot(); // REQ-20260910-001：当前文件进入快照（md 渲染/源码态仅 md 有意义，图片沿用现值）
    viewer.replaceChildren(elFromHtml(viewerBarHtml(key, { isMd: false })));
    const wrap = document.createElement('figure');
    wrap.className = 'file-image-wrap';
    const img = document.createElement('img');
    img.className = 'file-image';
    img.alt = key;
    img.src = apiUrl(`/api/fs/raw?path=${encodeURIComponent(key)}`);
    img.addEventListener('error', () => {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = `⚠ 图片加载失败：${key}（超过 8MB 或读取异常）`;
      wrap.replaceChildren(p);
    });
    wrap.appendChild(img);
    viewer.appendChild(wrap);
    return;
  }
  const isMd = MD_EXT.has(ext);
  const source = opts.source ?? !isMd; // md 默认渲染视图，其余一律源码视图
  if (isMd) state.banner.mdSource = source;
  saveViewSnapshot(); // REQ-20260910-001：当前文件与 md 渲染/源码态（换行开关翻转亦经 openFile 重开）进入快照
  try {
    const f = await api(`/api/fs/file?path=${encodeURIComponent(key)}`);
    if (state.banner.activeFile !== key) return; // 异步竞态：已切看其他文件，丢弃过期响应
    if (isMd && !source) {
      viewer.replaceChildren(elFromHtml(viewerBarHtml(key, { isMd, mdSource: source })));
      const div = document.createElement('div');
      div.className = 'md file-md';
      div.innerHTML = renderMd(f.content);
      viewer.appendChild(div);
      return;
    }
    viewer.replaceChildren(elFromHtml(viewerBarHtml(key, { isMd, mdSource: source, wrap: state.banner.wrap })));
    viewer.appendChild(buildCodeView(key, f.content, f.ext, state.banner.wrap));
  } catch (e) {
    viewer.innerHTML = `<p class="muted">⚠ ${esc(e.message)}</p>`;
  }
}

// 查看器工具条：当前文件相对路径 + 复制路径（md 追加 源码/渲染 切换；源码态追加 自动换行 开关）
// wrap 仅源码视图调用点传入（boolean）：渲染态 md / 图片不传（undefined）→ 按钮不出现
function viewerBarHtml(key, { isMd, mdSource, wrap }) {
  return `
    <div class="file-viewer-bar">
      <span class="path" title="${esc(key)}">${esc(key)}</span>
      <span class="file-viewer-acts">
        ${isMd ? `<button type="button" class="btn" data-md-toggle title="切换 Markdown 的渲染 / 源码视图">${mdSource ? '渲染' : '源码'}</button>` : ''}
        ${wrap === undefined ? '' : `<button type="button" class="btn${wrap ? ' active' : ''}" data-wrap-toggle aria-pressed="${wrap}" title="切换自动换行（设置在切换文件后保持）">${wrap ? '不换行' : '自动换行'}</button>`}
        <button type="button" class="btn" data-copy-path="${esc(key)}" title="复制文件相对路径">复制路径</button>
      </span>
    </div>`;
}

function elFromHtml(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// 源码视图：行号槽 + 语法高亮代码。两栏同一字体行高、代码不换行（水平滚动），
// 行号与内容恒 1:1 对齐；行号槽 sticky 跟随，横向滚动时保持可见。
// wrap=true（REQ-20260906-021）时容器挂 wrap class → CSS 软换行并隐藏行号槽
function buildCodeView(key, content, ext, wrap) {
  const wrapEl = document.createElement('div');
  wrapEl.className = 'file-code';
  if (wrap) wrapEl.classList.add('wrap');
  const lns = document.createElement('div');
  lns.className = 'code-lns';
  const lines = content.split('\n');
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= lines.length; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ln';
    b.setAttribute('data-line', String(i));
    b.setAttribute('data-path', key);
    b.title = `复制 ${fileLineRef(key, i)} 到剪贴板`;
    b.textContent = String(i);
    frag.appendChild(b);
  }
  lns.appendChild(frag);
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  const lang = HL_LANG[ext];
  if (lang) code.classList.add(`language-${lang}`);
  code.textContent = content;
  pre.appendChild(code);
  wrapEl.append(lns, pre);
  if (window.hljs) {
    try { window.hljs.highlightElement(code); } catch {}
  }
  return wrapEl;
}

// 讨论引用格式：相对路径:行号（如 scripts/web/app.js:123）
function fileLineRef(p, n) {
  return `${p}:${n}`;
}

// 通用剪贴板复制：navigator.clipboard 优先，非安全上下文/权限拒绝时 execCommand 降级
async function copyPlain(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    let ok = false;
    let ta; // execCommand 抛错也要清理临时文本域（REQ-20260906-011）
    try {
      ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
    } catch {} finally {
      ta?.remove();
    }
    return ok;
  }
}

// 工具条与行号点击统一委托（查看器内容随打开文件整段重建，绑子节点会失效）
function bindFileViewerOnce() {
  const viewer = $('#fileViewer');
  if (!viewer || viewer.dataset.viewerBound) return;
  viewer.dataset.viewerBound = '1';
  viewer.addEventListener('click', async (e) => {
    const ln = e.target.closest('.ln');
    if (ln) {
      const ref = fileLineRef(ln.dataset.path, ln.dataset.line);
      const ok = await copyPlain(ref);
      toast(ok ? `已复制 ${ref}` : '复制失败，请手动复制', !ok);
      return;
    }
    const cp = e.target.closest('[data-copy-path]');
    if (cp) {
      const ok = await copyPlain(cp.dataset.copyPath);
      toast(ok ? `已复制 ${cp.dataset.copyPath}` : '复制失败，请手动复制', !ok);
      return;
    }
    if (e.target.closest('[data-md-toggle]')) {
      openFile(state.banner.activeFile, { source: !state.banner.mdSource });
      return;
    }
    // REQ-20260906-021：换行开关存于 banner 状态（随文件切换保持），翻转后重开当前文件生效
    if (e.target.closest('[data-wrap-toggle]')) {
      state.banner.wrap = !state.banner.wrap;
      openFile(state.banner.activeFile);
    }
  });
}

// 幂等：首次进入加载根层，并逐层展开默认路径（与旧目录树行为一致）；
// 默认路径任一层缺失（如未初始化看板的项目）时静默停在已展开层
async function initFileBoard() {
  const banner = $('#fileBanner');
  if (!banner.dataset.bannerBound) {
    banner.dataset.bannerBound = '1';
    // chip/面包屑点击统一走事件委托（renderBanner 整段重建，绑子节点会失效）
    $('#fileBanner').addEventListener('click', (e) => {
      const chip = e.target.closest('.fchip');
      if (chip) {
        if (chip.dataset.kind === 'dir') openDirLayer(chip.dataset.path).catch((err) => toast(`读取目录失败：${err.message}`, true));
        else openFile(chip.dataset.path);
        return;
      }
      const seg = e.target.closest('.crumb-seg');
      if (seg) {
        state.banner.layers = ATBBanner.truncateTo(state.banner.layers, seg.dataset.path ?? '');
        renderBanner();
        saveViewSnapshot(); // REQ-20260910-001：面包屑回跳后层栈进入快照
      }
    });
  }
  bindFileViewerOnce(); // 工具条/行号点击委托（REQ-20260906-010，同样只绑一次）
  if (state.banner.initialized) {
    refreshBannerLayers(); // 模块切回：后台重拉当前层栈，外部新增文件可见（BUG-20260907-011）
    return;
  }
  if (!window.ATBBanner || !window.hljs) {
    $('#fileViewer').innerHTML = '<p class="muted">⚠ 文件视图组件（banner.js / highlight.js）未加载</p>';
    return;
  }
  state.banner.initialized = true;
  try {
    await openDirLayer('');
  } catch (err) {
    state.banner.initialized = false;
    $('#fileViewer').innerHTML = `<p class="muted">⚠ 文件横幅初始化失败：${esc(err && err.message)}</p>`;
    return;
  }
  // REQ-20260910-001：刷新恢复——优先展开快照层栈（根层已开，逐层下钻；任一层失效
  // 即停在已展开前缀 = 失效回落，不视为错误），再核验并重开快照文件（md 渲染/源码态随快照）。
  const restoredLayers = state.banner.restoredLayers;
  const restoredFile = state.banner.restoredFile;
  state.banner.restoredLayers = null;
  state.banner.restoredFile = null;
  if (Array.isArray(restoredLayers) && restoredLayers.length) {
    for (const dir of restoredLayers.slice(1)) {
      try {
        await openDirLayer(dir);
      } catch {
        break; // 目录在刷新间隙被删/不可读：保留已展开前缀（极端回项目根）
      }
    }
    if (restoredFile) {
      // 文件存活核验：父层条目已随层栈展开拉取，命中才重开（被删则回默认引导，不显示报错）
      const parent = restoredFile.includes('/') ? restoredFile.slice(0, restoredFile.lastIndexOf('/')) : '';
      const entries = state.banner.entriesByPath[parent] || [];
      const alive = entries.some((en) => !en.dir && `${parent ? `${parent}/` : ''}${en.name}` === restoredFile);
      if (alive) await openFile(restoredFile, { source: state.banner.mdSource });
      else {
        state.banner.activeFile = null;
        renderBanner();
        $('#fileViewer').innerHTML = FILE_VIEWER_FALLBACK_HINT;
      }
    }
    return;
  }
  let prefix = '';
  for (const seg of ATBBanner.DEFAULT_PATH.split('/').filter(Boolean)) {
    prefix = prefix ? `${prefix}/${seg}` : seg;
    try {
      await openDirLayer(prefix);
    } catch {
      break; // 默认路径到此为止：保留已展开层，不视为错误
    }
  }
}

/* ---------- 轮询与渲染 ---------- */

// REQ-20260906-016 基线登记；REQ-20260908-017 修订：检测到新单不再自动导航或提示，
// 轮询只刷新列表（renderBoard），何时点开详情由人决定。基线登记保留以防误跳回归。
function detectNewItem(b) {
  const items = b?.items || [];
  if (!state.knownIds) {
    state.knownIds = new Set(items.map((it) => it.id));
    return;
  }
  for (const it of items) state.knownIds.add(it.id);
}

async function poll() {
  const project = state.project;
  try {
    const b = await api('/api/board');
    if (state.project !== project) return;
    $('#pollState').textContent = '●';
    $('#pollState').title = '实时连接：每 2 秒自动刷新';
    $('#pollState').classList.remove('off');
    // generatedAt 每次响应都变，须排除后再比较，否则每 2 秒全量重渲染，
    // 点击/拖拽会因节点被替换而随机失效
    const j = JSON.stringify(b, (k, v) => (k === 'generatedAt' ? undefined : v));
    if (j !== state.boardJson) {
      state.board = b;
      state.boardJson = j;
      detectNewItem(b); // REQ-20260908-017：只登记基线；新单不自动跳转、不弹「已定位」提示，列表由下方渲染刷新
      renderBoard();
      if (state.drawer.id) {
        refreshDrawer();
      }
    }
    // 批量开发抽屉随主轮询刷新（签名无变化不重渲染）
    if (state.batch.open) await refreshBatch();
    // REQ-20260911-007：待人工确认聚合区随主轮询刷新（独立请求；失败保留上次数据并显示错误条 + 重试）
    if (b?.initialized) await refreshHolds();
    // BUG-20260910-014（REQ-20260911-010 换源保留）：已完成条目提交状态随主轮询刷新
    // （独立请求 /api/commit/item-status，源为 REQ-20260911-009 索引；失败保留上次数据并
    // 提示重试，不伪装成未提交）；仅初始化项目拉取
    if (b?.initialized) await refreshCommitStatus();
    // BUG-20260910-004：全局任务面板随主轮询刷新（面板打开才拉取；内部签名剪枝；新任务出现 / 收尾移出自动反映）
    if (state.global.open) await refreshGlobal();
    // REQ-20260907-001：Oncall 咨询视图随主轮询刷新（内部按签名去重；codex 回传后状态自动流转）
    if (state.view === 'oncall') await window.ATBOncall?.poll(project);
    // REQ-20260908-022：需求抽屉「需求讨论」区块随主轮询刷新（讨论状态不在 /api/board 响应内）；
    // REQ-20260909-013：讨论模块暂隐藏——隐藏态不发起讨论相关请求（机制保留待恢复）
    if (!HIDDEN_VIEWS.has('oncall') && state.drawer.id && state.drawer.item?.type === 'requirement') await refreshReqDiscussions();
    // REQ-20260909-003：文档讨论区块随主轮询刷新（内部按签名去重；发布标记出现后自动展示纪要与草稿）；
    // REQ-20260909-013：同上，隐藏态不发起 /api/req-disc 请求
    if (!HIDDEN_VIEWS.has('oncall') && state.drawer.id && state.drawer.item?.type === 'requirement') await window.ATBReqDisc?.refresh();
    // REQ-20260906-024：待处理记录随主轮询刷新（顶栏徽标 + 卡片标记 + Codex 面板待处理区）
    const pendingChanged = await refreshCodexPending();
    if (pendingChanged && state.batch.open && state.batch.mode === 'codex') renderBatchDrawer();
  } catch {
    if (state.project !== project) return;
    $('#pollState').textContent = '○';
    $('#pollState').title = '服务离线：数据停止刷新';
    $('#pollState').classList.add('off');
  }
}

// REQ-20260907-004 需求列表：列表行 + 选择工具条（替代原五列看板）；
// BUG-20260907-016：第四行状态筛选条恢复为五档（无「全部」），列表按当前档过滤，
// 与第三行搜索叠加（REQ-20260907-006 曾整条移除，本 Bug 修正为仅去掉「全部」档）
function applyReqFilter(items) {
  return items.filter((it) => laneOf(it) === state.reqFilter);
}

// REQ-20260908-002：可见条目管线 = 档位过滤 → 搜索过滤 → 排序 → 已完成档默认截断。
// 截断仅在「未搜索」时生效（搜索词一出现即恢复全量池，避免老条目在防抖窗口内被截断而无法命中）。
function visibleItems() {
  const sorted = sortReqItems(searchVisibleItems(applyReqFilter(state.board?.items || [])), state.reqSort);
  if (state.reqFilter === 'done' && !state.search.q && sorted.length > REQ_DONE_LIST_LIMIT) {
    return sorted.slice(0, REQ_DONE_LIST_LIMIT);
  }
  return sorted;
}

function renderFilterBar() {
  const bar = $('#filterBar');
  if (!bar) return;
  const items = state.board?.items || [];
  bar.innerHTML = REQ_FILTERS.map(({ key, label }) => {
    const count = items.filter((it) => laneOf(it) === key).length;
    return `<button type="button" class="filter-chip${state.reqFilter === key ? ' active' : ''}" data-filter="${key}">${label} <span class="filter-count">${count}</span></button>`;
  }).join('');
}

// REQ-20260908-020：已接受单完善三态徽标（未完善/完善中/已完善）；点击跳任务模块「批量完善」面板
const REFINE_BADGE = {
  unrefined: { label: '未完善', cls: 'rf-unrefined', hint: '已接受未完善：可由 AI 分析任务补全文档；点击查看 AI 分析面板' },
  refining: { label: '完善中', cls: 'rf-refining', hint: '子代理正在完善本文档；点击查看 AI 分析面板' },
  refined: { label: '已完善', cls: 'rf-refined', hint: '文档已由 AI 分析补全；点击查看 AI 分析面板' },
};
function refineBadgeHtml(it, { clickable = true } = {}) {
  if (it.status !== 'accepted') return '';
  const m = REFINE_BADGE[it.refineState] || REFINE_BADGE.unrefined;
  return `<button type="button" class="refine-badge ${m.cls}" ${clickable ? 'data-goto-refine' : 'disabled'} title="${esc(m.hint)}">${m.label}</button>`;
}

function reqRowEl(it) {
  const el = document.createElement('article');
  const lane = laneOf(it);
  const picked = state.drawer.id === it.id;
  el.className = `req-row s-${it.status}${picked ? ' picked' : ''}`;
  el.dataset.id = it.id;
  // BUG-20260908-020：已接受行悬停恢复 LANE_HINT（不再显示批次进入状态）
  // BUG-20260910-010：picked 行（详情抽屉正展示此条目）悬停在档位说明外补充标记含义，
  // 样式改中性 var(--text)（style.css），不再被误读成状态/待测试标识
  const laneHint = LANE_HINT[lane] || '';
  el.title = picked ? `${laneHint ? `${laneHint}；` : ''}详情打开中（右侧抽屉正展示此条目）` : laneHint;
  // BUG-20260909-004：列表按档过滤（applyReqFilter），六档卡片均不再渲染与所在档位
  // 重复的状态 chip（BUG-20260908-024 曾仅收敛「已计划」档）；状态语义仍由顶部筛选条、
  // 行悬停 LANE_HINT 与详情抽屉状态字段承载，完善徽标 / 模型配置提示等非档位信息不受影响
  el.innerHTML = `
    <div class="card-top">
      ${it.status === 'submitted' ? `<input type="checkbox" class="accept-check" data-select-id="${esc(it.id)}" aria-label="选择 ${esc(it.id)}">` : ''}
      ${it.status === 'accepted' ? `<input type="checkbox" class="accept-check" data-plan-id="${esc(it.id)}" aria-label="选择 ${esc(it.id)}">` : ''}
      ${it.status === 'planned' ? `<input type="checkbox" class="accept-check" data-impl-id="${esc(it.id)}" aria-label="选择 ${esc(it.id)}">` : ''}
      ${itemIdHtml(it.id, { copy: false })} <!-- REQ-20260910-006：单号归信息区；BUG-20260910-007：操作图标化并与单号同排 -->
      ${refineBadgeHtml(it)}
      ${commitBadgeHtml(it, { inline: true })} <!-- BUG-20260912-003：完成条目提交状态原位直显短提交号（无「已提交」徽标与折叠层） -->
      ${it.hold ? `<span class="flag hold-flag" title="待人工决策：${it.hold.unanswered} 项未答；到列表下方「待人工确认」区补决策并复工">⚠ 等人工决策</span>` : ''}
      ${it.confirm && it.confirm.state === 'waiting' ? `<span class="flag confirm-flag" title="${it.confirm.kind === 'develop' ? '自动提交不完整，队列已挂起' : '分析问题待人工确认，队列已挂起'}：${it.confirm.reason || ''}；到任务页「待人工确认」完成确认">⚠ ${it.confirm.kind === 'develop' ? '待确认提交' : '待确认分析'}</span>` : ''}
      ${state.codexPending.byItem.has(it.id) ? '<span class="flag warn" title="模型配置待处理：点击行查看，或到设置模块的「模型与推理强度」处理">模型配置待处理</span>' : ''}
      <!-- BUG-20260910-007：四操作仅图标（⧉/✓/✎/🗑），动作与单号由 aria-label/title 提示，顺序与显隐规则不变 -->
      <span class="row-acts">
        ${copyIdBtnHtml(it.id, { icon: true })}
        ${it.status === 'submitted' ? `<button type="button" class="btn small card-accept-btn icon-act" data-accept-id="${esc(it.id)}" aria-label="接受 ${esc(it.id)}" title="接受（仅待接受）">✓</button>` : ''}
        ${it.status === 'submitted' ? `<button type="button" class="btn small card-rename-btn icon-act" data-rename-id="${esc(it.id)}" aria-label="编辑 ${esc(it.id)} 标题与描述" title="编辑标题与描述（仅待接受）">✎</button>` : ''}
        ${it.status === 'submitted' ? `<button type="button" class="btn small card-del-btn icon-act" data-delete-id="${esc(it.id)}" aria-label="删除 ${esc(it.id)}" title="删除（仅待接受，移除整个条目目录且不可恢复）">🗑</button>` : ''}
      </span>
    </div>
    <div class="card-title">${esc(it.title)}</div>
    <div class="card-meta">
      ${it.type === 'requirement' && it.bugCount
        ? `<span title="下属 Bug">🛠 ${it.bugCount}${it.openBugCount ? ` 未完成 ${it.openBugCount}` : ''}</span>` : ''}
      ${it.owner ? `<span title="认领者">👤 ${esc(shortOwner(it.owner))}</span>` : ''}
      <span class="m-time">${fmtTime(it.updatedAt)}</span>
    </div>`;
  // BUG-20260910-007：极窄容器单号省略号截断时，悬停单号可看完整值
  const cid = el.querySelector('.cid');
  if (cid) cid.title = it.id;
  if (it.status === 'submitted') {
    const check = el.querySelector('[data-select-id]');
    check.checked = state.acceptance.selected.has(it.id);
    check.disabled = state.acceptance.pending;
    check.addEventListener('click', (e) => e.stopPropagation());
    check.addEventListener('change', () => {
      if (state.acceptance.pending) return;
      if (check.checked) state.acceptance.selected.add(it.id);
      else state.acceptance.selected.delete(it.id);
      syncAcceptance();
    });
    const accept = el.querySelector('[data-accept-id]');
    accept.disabled = state.acceptance.pending;
    accept.addEventListener('click', (e) => {
      e.stopPropagation();
      return acceptItems([it.id], { single: true }); // REQ-20260910-011：免确认，成功 toast 附撤销
    });
    bindRenameButtons(el); // REQ-20260908-011：待接受卡片编辑标题/描述（点击不冒泡打开详情）
    bindDeleteButtons(el); // REQ-20260908-003：待接受卡片删除（点击不冒泡打开详情）
  }
  if (it.status === 'accepted') {
    // REQ-20260908-018：已接受行批量移入计划多选（交互对齐待接受/已计划勾选）
    const check = el.querySelector('[data-plan-id]');
    check.checked = state.plan.selected.has(it.id);
    check.disabled = state.plan.pending;
    check.addEventListener('click', (e) => e.stopPropagation());
    check.addEventListener('change', () => {
      if (state.plan.pending) return;
      if (check.checked) state.plan.selected.add(it.id);
      else state.plan.selected.delete(it.id);
      syncPlan(false);
    });
    // REQ-20260908-020：完善徽标点击跳任务模块「批量完善」面板（不冒泡打开详情）
    const badge = el.querySelector('[data-goto-refine]');
    if (badge) badge.addEventListener('click', (e) => {
      e.stopPropagation();
      gotoRuns('refine');
    });
  }
  if (it.status === 'planned') {
    // 已计划多选（REQ-20260906-018 引入；BUG-20260909-006 起仅为「移出计划」服务）：复选框常驻
    const check = el.querySelector('[data-impl-id]');
    check.checked = state.impl.selected.has(it.id);
    check.addEventListener('click', (e) => e.stopPropagation());
    check.addEventListener('change', () => {
      if (check.checked) state.impl.selected.add(it.id);
      else state.impl.selected.delete(it.id);
      syncImpl(false);
    });
  }
  bindCopyIdButtons(el);
  bindCommitWidgets(el); // BUG-20260910-014：提交号复制 / 徽标重试不冒泡打开详情
  el.addEventListener('click', () => openDrawer(it.id));
  return el;
}

// REQ-20260910-005：空态双卡切换——当前项目未初始化（#initCard）/ 暂无项目（#noProjectCard）
function syncEmptyCards() {
  const noProject = !!state.board?.noProject;
  $('#initCard')?.classList.toggle('hidden', noProject);
  $('#noProjectCard')?.classList.toggle('hidden', !noProject);
}

function renderBoard() {
  const b = state.board;
  // REQ-20260910-012：项目路径默认不再显示于顶栏——完整路径移入「管理项目」弹窗的项目列表
  // （带「当前」标记、可换行）。顶栏仅在无项目时给简短引导文案（不含路径）；
  // 已初始化 / 未初始化均置空，空行由 .path:empty 隐藏不占位（初始化引导沿用内容区卡片）
  $('#dataDir').textContent = b.noProject ? '暂无项目：打开「管理项目」初始化或导入' : '';
  const showStatus = state.view === 'status';
  $('#board').classList.toggle('hidden', !showStatus || !b.initialized);
  $('#emptyState').classList.toggle('hidden', !showStatus || b.initialized);
  syncEmptyCards(); // 未初始化与无项目共用空态容器，按载荷切换卡片
  $('#filterBar')?.classList.toggle('hidden', !showStatus || !b.initialized); // BUG-20260907-016 恢复第四行筛选条
  syncReqSortVisibility(); // REQ-20260910-016：定位组排序入口随初始化状态显隐（未初始化 / 无项目隐藏）
  renderHolds(); // REQ-20260911-007：待人工确认聚合区随看板渲染（未初始化 / 非需求模块隐藏）
  if (!b.initialized) return;

  renderFilterBar(); // BUG-20260907-016：五档 chips 带计数，随轮询刷新
  // REQ-20260907-004：列表行按内容签名增量更新，轮询刷新不打断点击/勾选；
  // 签名含搜索关键词、状态筛选档、排序键（REQ-20260908-002）与待处理标记，变化即时重绘
  // （BUG-20260907-016 恢复筛选档）
  const items = visibleItems();
  // REQ-20260910-008：普通「N 个条目」与顶部分类标签计数重复，已从列表头移除；
  // #reqCount 转条件提示——已完成档默认截断（显示范围 / 总量 / 搜索更早条目引导）与
  // 搜索命中「搜索命中 N 项」（命中数不冒充分类总数；结果未到不显示，避免全量被误称命中）
  const laneTotal = (state.board?.items || []).filter((it) => laneOf(it) === state.reqFilter).length;
  const doneCapped = state.reqFilter === 'done' && !state.search.q && laneTotal > REQ_DONE_LIST_LIMIT;
  const countHint = $('#reqCount');
  if (countHint) {
    const s = state.search;
    let hintText = '';
    if (s.q && s.res && s.resQ === s.q) {
      // REQ-20260910-009：总命中与当前状态档可见数分开表述，可见数不冒充总命中数
      const totalHits = (s.res.items || []).length;
      hintText = items.length
        ? `搜索命中条目 ${totalHits} 项（当前档可见 ${items.length} 项）`
        : `搜索命中条目 ${totalHits} 项（当前档可见 0 项）：当前档无可见命中，切换状态筛选可查看其他档命中`;
    } else if (doneCapped) {
      // BUG-20260911-008：文案精简（去「个条目」「已完成默认」等冗余字词），三要素保留——
      // 显示数 / 总数、默认仅列最新 100 项、更早用搜索获取
      hintText = `${items.length} / ${laneTotal} 项，仅列最新 ${REQ_DONE_LIST_LIMIT}，更早请搜索`;
    }
    if (countHint.textContent !== hintText) countHint.textContent = hintText;
    countHint.classList.toggle('hidden', !hintText);
  }
  // BUG-20260910-014：签名计入已完成条目提交状态与查询失败态——徽标随提交回执核验自动刷新
  const commitParts = [state.commitStatus.error || '', items.filter((it) => it.status === 'done')
    .map((it) => [it.id, (state.commitStatus.map[it.id]?.commits || []).join(',')])];
  const sig = JSON.stringify([state.search.q, state.reqFilter, state.reqSort, state.drawer.id, [...state.codexPending.byItem], commitParts, items.map((it) => [it.id, it.title, it.owner, it.agentCompletedAt, it.updatedAt, it.bugCount, it.openBugCount, it.status, it.refineState || '', it.hold ? `${it.hold.unanswered}/${it.hold.total}` : ''])]);
  if (sig !== state.listSig) {
    state.listSig = sig;
    const list = $('#reqList');
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'notice req-empty';
      empty.textContent = (b.items || []).length ? '当前筛选与搜索下没有条目。' : '暂无需求或 Bug：点击右上「＋ 新建」创建第一条。';
      list.replaceChildren(empty);
    } else {
      list.replaceChildren(...items.map(reqRowEl));
    }
  }
  syncAcceptance();
  syncImpl();
  syncPlan(); // REQ-20260908-018：已接受勾选随轮询剪枝（对齐 impl 的 notify 语义）
}

/* ---------- 单号显式复制按钮（REQ-20260906-006） ---------- */

// REQ-20260910-006：复制按钮模板独立——列表行操作区与单号内嵌（详情抽屉等）两处复用
// BUG-20260910-007：列表行操作区改图标按钮（icon: true，⧉ 图标 + title 悬停提示）；
// 详情抽屉等单号内嵌位置仍用默认文本「复制」按钮
function copyIdBtnHtml(id, { icon = false } = {}) {
  return icon
    ? `<button type="button" class="btn copy-id-btn icon-act" data-copy-id="${esc(id)}" aria-label="复制单号 ${esc(id)}" title="复制单号 ${esc(id)}" aria-live="polite">⧉</button>`
    : `<button type="button" class="btn copy-id-btn" data-copy-id="${esc(id)}" aria-label="复制单号 ${esc(id)}" aria-live="polite">复制</button>`;
}

function itemIdHtml(id, { copy = true } = {}) {
  return `<span class="item-id"><span class="cid">${esc(id)}</span>${copy ? copyIdBtnHtml(id) : ''}</span>`;
}

function bindCopyIdButtons(root) {
  for (const button of root.querySelectorAll('[data-copy-id]')) {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      return copyId(button.dataset.copyId, button);
    });
  }
}

async function copyId(id, el) {
  if (!el || el.disabled || el.dataset.copied) return;
  el.disabled = true; // 异步复制和反馈期间防止重复提交
  let ok = false;
  try {
    await navigator.clipboard.writeText(id);
    ok = true;
  } catch {
    // 非安全上下文/权限拒绝：execCommand 降级
    let ta;
    try {
      ta = document.createElement('textarea');
      ta.value = id;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
    } catch {} finally {
      ta?.remove();
    }
  }
  if (ok) {
    el.dataset.copied = '1';
    const original = el.textContent;
    const originalTitle = el.title || '';
    // BUG-20260910-007：图标复制按钮的反馈不放大段中文回工具行——图标位换 ✓ 并就地
    // 更新 title 提示；文本按钮（详情抽屉内嵌）仍用「已复制 ✓」文案
    if (el.classList.contains('icon-act')) {
      el.textContent = '✓';
      el.title = `已复制 ${id}`;
    } else {
      el.textContent = '已复制 ✓';
    }
    el.classList.add('copied');
    setTimeout(() => {
      el.textContent = original;
      el.title = originalTitle;
      el.classList.remove('copied');
      delete el.dataset.copied;
      el.disabled = false;
    }, 1200);
  } else {
    el.disabled = false;
    toast('复制失败，请手动框选单号', true);
  }
}

/* ---------- 详情页上一条/下一条导航（REQ-20260901-001；2026-09-01 修订：底部两翼布局）---------- */

// 导航范围在打开抽屉那一刻冻结为同状态条目序列（BUG-20260903-001）：
// 曾直接按当前条目实时 status 过滤，点「接受」等操作按钮状态流转后，
// 过滤条件跟着漂移，导航就跳进了新状态列表。点卡片/跳转链接仍按新条目重算。
function scopeIdsFor(id) {
  const all = state.board?.items || [];
  const me = all.find((it) => it.id === id);
  if (!me) return null;
  return all.filter((it) => it.status === me.status).map((it) => it.id);
}

function drawerNeighbors() {
  const all = state.board?.items || [];
  const me = all.find((it) => it.id === state.drawer.id);
  if (!me) return { idx: -1, prev: null, next: null, total: 0 };
  // 优先用打开时冻结的快照；快照不可得时回退实时同状态过滤。
  // 快照里的单号可能已被删除，按存活条目剔除防点空。
  const fallback = all.filter((it) => it.status === me.status).map((it) => it.id);
  const alive = new Set(all.map((it) => it.id));
  const ids = (state.drawer.navIds?.length ? state.drawer.navIds : fallback).filter((id) => alive.has(id));
  const idx = ids.indexOf(me.id);
  const at = (i) => all.find((it) => it.id === ids[i]) || null;
  return {
    idx,
    total: ids.length,
    prev: idx > 0 ? at(idx - 1) : null,
    next: idx >= 0 && idx < ids.length - 1 ? at(idx + 1) : null,
  };
}

function navDrawer(dir) {
  const n = drawerNeighbors();
  const target = dir === 'prev' ? n.prev : n.next;
  if (target) openDrawer(target.id, true); // 沿用冻结范围，不按目标条目实时状态重算
}

function drawerNavBtn(dir, target) {
  const isPrev = dir === 'prev';
  // 文案只留方向词（2026-09-01 二次修订）；目标单号放悬停提示
  const label = isPrev ? '← 上一条' : '下一条 →';
  const disabled = target ? '' : ' aria-disabled="true" data-disabled="1"';
  // REQ-20260910-007：标注键盘可达的方向键（快捷键说明 + aria-keyshortcuts；边界提示不循环）
  const keyHint = isPrev ? '快捷键 ←' : '快捷键 →';
  const title = target
    ? `${target.id} ${target.title}（${keyHint}）`
    : `${isPrev ? '已是第一条' : '已是最后一条'}（${keyHint}）`;
  return `<button type="button" class="btn drawer-nav-btn" data-nav="${dir}"${disabled} title="${esc(title)}" aria-keyshortcuts="${isPrev ? 'ArrowLeft' : 'ArrowRight'}">${label}</button>`;
}

/* ---------- 快捷键（REQ-20260910-007：/ 聚焦搜索、? 帮助面板、方向键与 Esc 收敛守卫） ---------- */

// 输入态判定：焦点在可编辑控件（含 contenteditable）时不响应单键快捷键，
// 也不 preventDefault——输入的 / ? 等字符照常上屏（不吞字符）
function isEditableTarget(t) {
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

  // 任一弹窗 / 面板开启（统一新建 / 项目管理 / 待接受编辑侧拉面板 / 页内确认弹层）→ 单键快捷键让位，
  // Escape 沿用下方既有关闭优先级链
  function anyModalOpen() {
    if (!$('#modalWrap').classList.contains('hidden')) return true;
    if (!$('#projModalWrap').classList.contains('hidden')) return true;
    if (!$('#editModalWrap').classList.contains('hidden')) return true; // REQ-20260911-001 编辑侧拉面板
    if (!$('#holdPanel').classList.contains('hidden')) return true; // REQ-20260911-007 人工决策侧拉面板
    if (!$('#confirmPanel').classList.contains('hidden')) return true; // REQ-20260914-001 挂起确认侧拉面板
    return !!document.querySelector('.confirm-wrap'); // uiConfirm 动态弹层
  }

// 当前模块搜索入口可用（设置模块隐藏搜索行时不响应 /）
function searchEntryAvailable() {
  const box = $('#pageHead .module-search');
  return !!box && !box.classList.contains('hidden');
}

// 快捷键帮助面板：节点常驻 index.html；打开记录入口焦点，关闭恢复；重复打开直接返回（不叠加面板）
const shortcutHelp = { opener: null };

function shortcutHelpOpen() {
  const wrap = $('#shortcutHelpWrap');
  return !!wrap && !wrap.classList.contains('hidden');
}

function openShortcutHelp() {
  if (shortcutHelpOpen()) return; // 重复按 ? / 重复点击按钮不叠加面板
  shortcutHelp.opener = document.activeElement;
  $('#shortcutHelpWrap').classList.remove('hidden');
  $('#shortcutHelpClose').focus(); // 焦点进入帮助（关闭按钮即首个可达控件）
}

function closeShortcutHelp() {
  if (!shortcutHelpOpen()) return;
  $('#shortcutHelpWrap').classList.add('hidden');
  const opener = shortcutHelp.opener;
  shortcutHelp.opener = null;
  if (opener && opener.isConnected) opener.focus(); // 关闭恢复至打开入口
  else $('#btnShortcuts')?.focus(); // 入口已从 DOM 移除：回落始终可见的帮助按钮
}

// 帮助模态开启期间 Tab / Shift+Tab 圈定在面板内（首末回绕，Shift 反向）
function trapShortcutHelpFocus(e) {
  if (e.key !== 'Tab') return;
  const panel = $('#shortcutHelpWrap');
  const focusables = [...panel.querySelectorAll('button, [href], input, select, textarea')]
    .filter((el) => !el.disabled && !el.closest('.hidden'));
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  const inPanel = focusables.includes(active);
  if (e.shiftKey) {
    if (!inPanel || active === first) { e.preventDefault(); last.focus(); }
  } else if (!inPanel || active === last) {
    e.preventDefault();
    first.focus();
  }
}

// 全局单键快捷键处理器（REQ-20260910-007 收敛既有匿名处理器；document 冒泡阶段全页唯一注册点，
// 单次按键只触发一次）。只触发现有界面入口对应行为（聚焦搜索 / 打开帮助 / 抽屉导航 / 关闭最上层
// 面板），不发业务请求，不直接接受、计划、删除条目或启动批次。
function onGlobalKeydown(e) {
  // 带 Ctrl / ⌘ / Alt 的组合键保留浏览器默认行为
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // 帮助模态处于最上层：Tab 焦点圈定、Esc 只关帮助（一次只关一层），其余单键不响应
  if (shortcutHelpOpen()) {
    if (e.key === 'Tab') { trapShortcutHelpFocus(e); return; }
    if (e.key === 'Escape') { e.preventDefault(); closeShortcutHelp(); return; }
    return;
  }
  // 按住不放产生的重复事件与中文输入法组合输入不触发（长按不连发）
  if (e.repeat || e.isComposing) return;
  const typing = isEditableTarget(e.target);
  const modalOpen = anyModalOpen();
  // `/` 聚焦当前模块搜索框：无弹窗、非输入态、搜索入口可用（设置模块隐藏搜索）
  if (e.key === '/' && !typing && !modalOpen && searchEntryAvailable()) {
    e.preventDefault(); // 阻止 / 落入页面；聚焦后输入框内输入不受影响
    $('#searchInput')?.focus();
    return;
  }
  // `?` 打开快捷键帮助：非输入态且无其他弹窗
  if (e.key === '?' && !typing && !modalOpen) {
    e.preventDefault();
    openShortcutHelp();
    return;
  }
  // 详情页上一条/下一条（REQ-20260901-001）：详情打开、非输入态、无弹窗时左右切换；边界停止不循环
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && state.drawer.id && !typing && !modalOpen) {
    e.preventDefault();
    navDrawer(e.key === 'ArrowLeft' ? 'prev' : 'next');
    return;
  }
  // Escape 关闭最上层可关闭面板（一次只关一层）：
  // REQ-20260911-001：待接受编辑面板位于详情抽屉之上（卡片 / 详情入口均可打开），先于抽屉关闭；
  // 保存中（editSide.busy）暂不可关闭——忽略本次 Esc，也不关其他层。
  // REQ-20260910-005：项目管理面板处于最上层优先关（内嵌移出确认随面板一起取消），
  // 关闭后才走既有链（新建面板 → 全局面板 → 详情抽屉）。
  // BUG-20260910-004：全局任务面板覆盖主工作区（含需求抽屉），优先于抽屉关闭；
  // REQ-20260910-014：新建 / 项目管理已迁侧拉面板，链序不变
  if (e.key === 'Escape') {
    // REQ-20260910-017：截图预览处于最上层（覆盖新建面板）→ 只关预览一次只关一层；
    // 正常路径由 onShotPreviewKey 窗口捕获先拦截，此处为同一语义的链上兜底
    if (shotPreviewOpen()) {
      shotPreviewClose();
      return;
    }
    if (editPanelOpen()) { // REQ-20260911-001：编辑面板层，详情保留
      if (!editSide.busy) closeEditPanel();
      return;
    }
    if (holdPanelOpen()) { // REQ-20260911-007：人工决策面板层（保存中暂不可关闭）
      if (!holdSide.busy) closeHoldPanel();
      return;
    }
    if (confirmPanelOpen()) { // REQ-20260914-001：挂起确认面板层（确认中暂不可关闭）
      if (!confirmSide.busy) closeConfirmPanel();
      return;
    }
    if (!$('#projModalWrap').classList.contains('hidden')) {
      closeProjPanel();
      return;
    }
    if (!$('#modalWrap').classList.contains('hidden')) {
      closeModal();
      return;
    }
    if (state.global.open) {
      closeGlobalPanel();
      return;
    }
    closeDrawer();
  }
}

/* ---------- 剪贴板（REQ-20260907-007 起详情页一键派单已删除，现役调用方为批量开发提示词复制） ---------- */

// 复制成功与否都返回布尔，失败给 toast
function copyDispatchText(text) {
  return navigator.clipboard.writeText(text)
    .then(() => true)
    .catch(() => { toast('复制失败，请手动复制提示词', true); return false; });
}

/* ---------- 状态变更（人工） ---------- */

function submittedItems() {
  // REQ-20260906-015：搜索叠加生效时，批量接受只作用于搜索可见行；
  // BUG-20260907-016：五档筛选（无「全部」档）只影响列表展示，勾选资格不随档位收窄——
  // 否则默认「待接受」档下待接受勾选与可实施勾选无法并存，切档即丢选择
  return searchVisibleItems(state.board?.items || []).filter((it) => it.status === 'submitted');
}

// REQ-20260908-027：选择按档隔离——当前筛选档 → 勾选集合模块映射；
// 开发中 / 待测试 / 已完成档无可勾选条目，不参与工具条计数与操作。
const LANE_SELECTION = { submitted: 'acceptance', accepted: 'plan', planned: 'impl' };
function currentLaneSelection() {
  const key = LANE_SELECTION[state.reqFilter];
  return key ? state[key].selected : null;
}
// 任一批量操作进行中（接受 / 移入计划 / 驳回待接受 / 移出计划）：全选 / 全不选与复选框防误触
function anyBatchPending() {
  return state.acceptance.pending || state.plan.pending || state.impl.pending || state.reject.pending;
}

// 只更新控件，不重建列表行，避免轮询打断焦点；新到条目不会继承全选。
function syncAcceptance() {
  const a = state.acceptance;
  const eligible = new Set(submittedItems().map((it) => it.id));
  for (const id of a.selected) if (!eligible.has(id)) a.selected.delete(id);
  // REQ-20260909-002：批量操作并入列表头右组——当前档选中数 >0 时出现（含分隔线），
  // 零选择整体隐藏无空占位；计数与动作仍按 REQ-20260908-027 档位隔离口径收窄。
  const lane = state.reqFilter;
  const plan = state.plan;
  const cur = currentLaneSelection();
  const curCount = cur ? cur.size : 0;
  const busy = anyBatchPending();
  const group = $('#selGroup');
  if (group) {
    group.classList.toggle('hidden', curCount === 0);
    const count = $('#selCount');
    // REQ-20260909-002 文案精简：去档位括号，数量只在右组计数处显示一次
    if (count) count.textContent = `已选 ${curCount} 项`;
    // 按档显隐：待接受→接受所选；已接受→移入计划+驳回待接受；已计划→移出计划
    // （BUG-20260909-006：「进入批量开发」按钮移除，已计划档仅剩「移出计划」）
    const laneOfBtn = { '#acceptSelected': 'submitted', '#planAdd': 'accepted', '#planReject': 'accepted', '#planRemove': 'planned' };
    for (const [sel, laneKey] of Object.entries(laneOfBtn)) {
      $(sel)?.classList.toggle('hidden', lane !== laneKey);
    }
    const submit = $('#acceptSelected');
    if (submit) {
      submit.disabled = a.pending || a.selected.size === 0;
      submit.textContent = a.pending ? '接受中…' : '接受所选';
    }
    // REQ-20260908-018：批量移入计划（排入开发计划），仅作用于已接受勾选；同档驳回进行中亦防误触
    const planAdd = $('#planAdd');
    if (planAdd) {
      planAdd.disabled = plan.pending || state.reject.pending || plan.selected.size === 0;
      planAdd.textContent = plan.pending ? '移入中…' : '移入计划';
    }
    // REQ-20260908-027：批量驳回待接受（accepted → submitted），与移入计划共用已接受勾选
    const planReject = $('#planReject');
    if (planReject) {
      planReject.disabled = state.reject.pending || plan.pending || plan.selected.size === 0;
      planReject.textContent = state.reject.pending ? '驳回中…' : '驳回待接受';
    }
    // REQ-20260908-010：批量移出计划（退回已接受），仅作用于已计划勾选；进行中防误触
    const planRemove = $('#planRemove');
    if (planRemove) {
      planRemove.disabled = state.impl.pending || state.impl.selected.size === 0;
      planRemove.textContent = state.impl.pending ? '移出中…' : '移出计划';
    }
    // 结果区按档呈现：只显示当前档对应模块的批量反馈（切档不打扰，切回仍可见）
    const resultMods = lane === 'submitted' ? [a] : lane === 'accepted' ? [plan, state.reject] : lane === 'planned' ? [state.impl] : [];
    const result = $('#acceptResult');
    const html = resultMods.map((m) => `${esc(m.message)}${m.failures.length ? `<ul>${m.failures.map((f) => `<li>${esc(f.id)}：${esc(f.error)}</li>`).join('')}</ul>` : ''}`).join('');
    if (result.innerHTML !== html) result.innerHTML = html;
    result.classList.toggle('hidden', !resultMods.some((m) => m.message));
    result.classList.toggle('err', resultMods.some((m) => m.failures.length > 0));
  }
  // REQ-20260909-007：列表头常驻快捷入口（与勾选无关，仅导航不创建任务、不弹确认）——
  // 已接受档「开始完善」→ 任务模块批量完善面板；已计划档「开始开发」→ 任务模块批量开发面板。
  // REQ-20260911-010：已完成档的 Commit 快捷入口随批量 Commit 回退移除（本地提交唯一路径为
  // 开发完成到待测试的自动提交，无需入口），done 档不再显示快捷入口。
  // 口径：BUG-20260909-006 后批量开发入口唯一收敛任务模块，范围恒为已计划队列（勾选仅为「移出计划」服务）；
  // 其余档不显示。随本函数每轮同步（切档即时、轮询只改控件态不重建容器，无闪烁）。
  const quick = $('#laneQuickEntry');
  if (quick) {
    const conf = lane === 'accepted'
      ? { label: '▶ AI 分析', title: '进入任务模块 AI 分析面板：对已接受未完善条目批量补全文档（与勾选无关）' }
      : lane === 'planned'
        ? { label: '▶ AI 开发', title: '进入任务模块 AI 开发面板：以已计划队列（最旧优先）为范围，由面板内「启动」创建任务' }
        : null;
    quick.classList.toggle('hidden', !conf);
    if (conf) {
      if (quick.textContent !== conf.label) quick.textContent = conf.label;
      if (quick.title !== conf.title) quick.title = conf.title;
      quick.setAttribute('aria-label', conf.label);
    }
    quick.disabled = false; // 仅导航：批量操作进行中也不禁用，任务创建由面板内「启动」承接
  }
  // REQ-20260908-027：成对全选 / 全不选入口，均只作用于当前筛选档（叠搜索范围）；批量进行中防误触。
  // REQ-20260910-008：单行工具栏下按控件粒度显隐（#selectRow 第二行已随两行结构取消）——
  // 选择档恒可见（勾选首项右组出现/消失在同一行内，不改变工具栏结构）；非选择档整体隐藏，无空占位。
  // BUG-20260909-008：非选择档（开发中 / 待测试 / 已完成）无可勾选条目，两按钮按档整体隐藏，
  // 不以 disabled 灰显残留死控件——静态节点保留（REQ-20260907-004 绑定一次策略），
  // 仅由本函数每轮 toggle('hidden')，与 #selGroup / #laneQuickEntry 显隐口径一致（切档即时、无闪烁）。
  const laneSelectable = Boolean(LANE_SELECTION[lane]);
  const selectBtn = $('#selectOperable');
  if (selectBtn) {
    selectBtn.classList.toggle('hidden', !laneSelectable);
    selectBtn.disabled = busy || !laneSelectable || operableInCurrentLane().length === 0;
  }
  const selectNoneBtn = $('#selectNone');
  if (selectNoneBtn) {
    selectNoneBtn.classList.toggle('hidden', !laneSelectable);
    selectNoneBtn.disabled = busy || curCount === 0;
  }
  // REQ-20260908-027：勾选视觉只保留复选框打勾态，不再加行级主题色边框
  for (const check of document.querySelectorAll('[data-select-id]')) {
    check.checked = a.selected.has(check.dataset.selectId);
    check.disabled = busy;
  }
  for (const button of document.querySelectorAll('[data-accept-id], [data-act="accepted"]')) button.disabled = a.pending;
}

// REQ-20260910-011：接受可撤销（驳回接受，REQ-20260907-011 合法回退边），免去二次确认，
// 点击立即逐条流转；single=true 为卡片「✓ 接受」/ 详情页单条入口，成功 toast 附「撤销」
// 按钮（对齐 REQ-20260906-014 详情页范式），批量误操作走反向批量操作回退。
async function acceptItems(ids, { single = false } = {}) {
  const a = state.acceptance;
  if (a.pending) return;
  const eligible = new Set(submittedItems().map((it) => it.id));
  const selected = [...new Set(ids)].filter((id) => eligible.has(id));
  if (!selected.length) return;
  const project = state.project;
  a.pending = true;
  a.failures = [];
  let succeeded = 0;
  a.message = `正在接受 0 / ${selected.length}…`;
  syncAcceptance();
  try {
    for (const id of selected) {
      // 切换项目后停止尚未发送的请求；在途请求仍绑定原项目。
      if (state.acceptance !== a) return;
      try {
        await api(`/api/item/${encodeURIComponent(id)}/status`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: 'accepted' }),
        }, project);
        succeeded++;
        a.selected.delete(id);
      } catch (e) {
        a.failures.push({ id, error: e.message });
        a.selected.add(id);
      }
      if (state.acceptance !== a) return;
      a.message = `正在接受 ${succeeded + a.failures.length} / ${selected.length}…`;
      syncAcceptance();
    }
    if (single && succeeded === 1 && a.failures.length === 0) {
      a.message = `✓ ${selected[0]} 已接受`;
      toast(a.message, false, undoActionTo(selected[0], 'submitted'));
    } else {
      a.message = `接受完成：成功 ${succeeded} 条，失败 ${a.failures.length} 条`;
      toast(a.message, a.failures.length > 0);
    }
    await poll();
  } finally {
    a.pending = false;
    if (state.acceptance === a) syncAcceptance();
  }
}

/* ---------- 待接受条目编辑标题与描述（REQ-20260908-011，卡片与详情页共用；
   REQ-20260911-001 容器迁右侧侧拉面板 #editModalWrap，对齐「＋ 新建」） ---------- */

// 描述节口径与服务端 core.editItem 一致：需求「## 描述」、Bug「## 现象」。
function descHeadingOf(it) {
  return it.type === 'bug' ? '## 现象' : '## 描述';
}

// 从 README 全文截取描述节原文（去首尾空行）；缺节返回 null。
function extractDocSection(text, heading) {
  const lines = String(text ?? '').split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

// 仅 submitted 可改（服务端 core.editItem 同口径二次校验）；取消 / 无变化不发写请求；
// 保存失败面板内容保留可重试（失败不丢输入）。
// REQ-20260911-001：容器自居中弹窗 + 全屏遮罩迁为右侧贴边通高侧拉面板（#editModalWrap，
// 几何与开合对齐「＋ 新建」的 .side-panel）：无遮罩不压暗看板、头部常驻、内容区三态
// （读取中 / 读取失败或缺节 / 表单）。读取与保存均绑定打开时的项目与条目（editSide 快照），
// 面板重开或关闭即递增 seq，迟到响应不得写入新面板。
const editSide = { open: false, busy: false, id: null, project: null, heading: null, opener: null, origTitle: '', origDesc: '', seq: 0 };

function editPanelOpen() {
  return !$('#editModalWrap').classList.contains('hidden');
}

// 内容区三态切换：loading（读取中）/ error（读取失败或缺节）/ form（可编辑表单）
function setEditView(mode) {
  $('#editLoading').classList.toggle('hidden', mode !== 'loading');
  $('#editError').classList.toggle('hidden', mode !== 'error');
  $('#editForm').classList.toggle('hidden', mode !== 'form');
}

// 面板反馈消息（校验 / 保存结果）：可被辅助技术读取（role=status aria-live=polite）
function editMsg(text, isErr = false) {
  const el = $('#editMsg');
  el.textContent = text;
  el.classList.toggle('err', isErr);
}

// 保存中锁定：禁用字段与全部关闭入口（✕ / 取消 / Esc），防未完成请求被误认为取消；
// 读取中的禁用由 setEditView 隐藏表单 + disabled 兜底（保留关闭入口）。
function setEditBusy(on) {
  editSide.busy = on;
  $('#eTitle').disabled = on;
  $('#eDesc').disabled = on;
  $('#editSave').disabled = on;
  $('#editCancel').disabled = on;
  $('#editClose').disabled = on;
  $('#editSave').textContent = on ? '保存中…' : '保存';
}

// 焦点返回发起入口；看板重渲染后原按钮被替换时，按条目编号找回当前 DOM 的编辑入口
function restoreEditFocus(opener, id) {
  if (opener && opener.isConnected) { opener.focus?.(); return; }
  const sel = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : String(id).replace(/["\\]/g, '\\$&');
  document.querySelector(`[data-rename-id="${sel}"]`)?.focus?.();
}

function openEditPanel(id, it, opener) {
  editSide.open = true;
  editSide.id = id;
  editSide.project = state.project; // 读取与保存绑定打开时的项目
  editSide.heading = descHeadingOf(it);
  editSide.opener = opener || document.activeElement || null;
  editSide.origTitle = it.title;
  editSide.origDesc = '';
  editSide.seq += 1;
  $('#editItemTitle').textContent = `编辑 ${id}`; // 长编号随头部布局换行，不挤压 ✕
  $('#editScope').textContent = `仅待接受条目可改；保存后标题与条目文档首行同步，描述整体替换 README「${editSide.heading}」节。`;
  editMsg('');
  setEditBusy(false);
  $('#editModalWrap').classList.remove('hidden');
  return loadEditContent();
}

// 读取当前已保存内容：面板先进入加载态；失败或缺节进错误态（原因 + 重试 / 关闭），
// 不展示可提交的伪空表单（缺节不能当空描述覆盖文档）。
async function loadEditContent() {
  const token = editSide.seq;
  const { id, project, heading } = editSide;
  setEditBusy(false);
  $('#editSave').disabled = true; // 读取中禁用提交（保留关闭入口）
  setEditView('loading');
  try {
    const res = await api(`/api/item/${encodeURIComponent(id)}/doc/README.md`, undefined, project);
    if (!editSide.open || token !== editSide.seq) return; // 迟到响应丢弃
    const desc = extractDocSection(res.content, heading);
    if (desc == null) throw new Error(`README 缺少「${heading}」节，无法编辑描述`);
    $('#eTitle').value = editSide.origTitle;
    $('#eDesc').value = desc;
    editSide.origDesc = desc;
    $('#editSave').disabled = false;
    setEditView('form');
    $('#eTitle').focus(); // 读取完成聚焦标题，Enter 保存 / Esc 取消可达
  } catch (e) {
    if (!editSide.open || token !== editSide.seq) return;
    $('#editErrorText').textContent = `读取描述失败：${e.message}`;
    setEditView('error');
    $('#editRetry').focus();
  }
}

function closeEditPanel({ focus = true } = {}) {
  const { opener, id } = editSide;
  $('#editModalWrap').classList.add('hidden');
  editSide.open = false;
  editSide.busy = false;
  editSide.id = null;
  editSide.seq += 1; // 使在途读取 / 保存回调失效（关闭后不回写、不重复提示）
  setEditBusy(false);
  if (focus) restoreEditFocus(opener, id);
}

async function submitEditPanel() {
  if (!editSide.open || editSide.busy) return;
  const { id, project } = editSide;
  const title = String($('#eTitle').value || '').trim();
  const desc = String($('#eDesc').value || '');
  if (!title) {
    editMsg('标题不能为空', true); // 面板内反馈，不发写请求
    $('#eTitle').focus();
    return;
  }
  if (title === editSide.origTitle && desc.trim() === editSide.origDesc.trim()) {
    editMsg('标题与描述均无变化'); // 明确提示，不发写请求，面板保持
    return;
  }
  setEditBusy(true);
  editMsg('保存中…');
  try {
    await api(`/api/item/${encodeURIComponent(id)}/content`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description: desc.trim() }),
    }, project);
  } catch (e) {
    setEditBusy(false); // 失败恢复操作且保留草稿，可重试或取消
    editMsg(`保存失败：${e.message}`, true);
    return;
  }
  const opener = editSide.opener;
  closeEditPanel({ focus: false });
  toast(`✓ ${id} 标题与描述已更新`);
  await poll();
  if (state.drawer.id === id) await refreshDrawer(); // 详情打开该条目：编辑层关闭后详情仍保留并刷新
  restoreEditFocus(opener, id); // 看板已重渲染：入口失联时按编号回落找回
}

async function editItem(id, opener = null) {
  const it = (state.board?.items || []).find((x) => x.id === id) || state.drawer.item;
  if (!it || it.status !== 'submitted') return;
  if (editSide.busy) {
    toast('正在保存上一条编辑，请稍候', true); // 保存中不得被静默覆盖（草稿取舍待确认口径下的保守策略）
    return;
  }
  if (editSide.open && editSide.id === id) return; // 重复点击同一入口不叠加面板、不重置草稿
  await openEditPanel(id, it, opener);
}

function bindRenameButtons(root) {
  for (const button of root.querySelectorAll('[data-rename-id]')) {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      return editItem(button.dataset.renameId, button); // 入口按钮作为关闭后焦点返回锚点
    });
  }
}

/* ---------- 待接受条目删除（REQ-20260908-003，卡片与详情页共用） ---------- */

// 删除移除整个条目目录，看板层面不可撤销（找回只能依赖 git 历史），因此保留一次
// 页面内 danger 确认；REQ-20260906-014 的「免确认 + 撤销」范式仅适用于可撤销的状态流转。
async function deleteItem(id) {
  const it = (state.board?.items || []).find((x) => x.id === id) || state.drawer.item;
  if (!it || it.status !== 'submitted') return;
  const ok = await uiConfirm({
    title: `删除 ${id}？`,
    message: `「${it.title}」仍在待接受阶段；删除将移除整个条目目录（含全部文档），看板层面不可恢复。`,
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/item/${encodeURIComponent(id)}`, { method: 'DELETE' }, state.project);
    toast(`✓ 已删除 ${id}`);
    if (state.drawer.id === id) closeDrawer();
    await poll();
  } catch (e) {
    toast(e.message, true);
  }
}

function bindDeleteButtons(root) {
  for (const button of root.querySelectorAll('[data-delete-id]')) {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      return deleteItem(button.dataset.deleteId);
    });
  }
}

// 状态流转 POST 与刷新副作用（拖拽 / 详情页 / 撤销共用）
async function postTransition(id, to, opts = {}) {
  await api(`/api/item/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // REQ-20260911-007：force 仅为确认完成越过未答决策的显式口径（服务端仍校验状态机）
    body: JSON.stringify({ to, ...(opts.force ? { force: true } : {}) }),
  });
}

async function refreshAfterTransition() {
  await poll();
  if (state.drawer.id) await refreshDrawer();
}

// 遗留路径（拖拽换列随 REQ-20260907-004 移除后已无调用方）：非 accepted 目标仍保留二次确认；
// accepted 目标复用免确认的批量函数（REQ-20260910-011）。
async function attemptTransition(id, to, label) {
  if (to === 'accepted') {
    const cur = (state.board?.items || []).find((x) => x.id === id);
    if (cur && cur.status === 'planned') return removeFromPlan([id]); // 已计划 → 已接受 = 移出计划
    return acceptItems([id]);
  }
  label = label || ACTION_LABEL[to] || to;
  // BUG-20260907-009：window.confirm 冻结内置浏览器，改页面内异步确认对话框
  if (!await uiConfirm({ title: `确定「${label}」 ${id}？`, confirmText: label })) return;
  try {
    if (to === 'done') {
      // REQ-20260911-007：确认完成再经待人工决策防呆（未答项二次确认 → force）
      const guard = await confirmDoneGuard(id);
      if (!guard.proceed) return;
      await postTransition(id, to, { force: guard.force });
    } else {
      await postTransition(id, to);
    }
    toast(`✓ ${id} 已${label}`);
    await refreshAfterTransition();
  } catch (e) {
    toast(e.message, true);
  }
}

/* ---------- 详情页免二次确认 + 撤销（REQ-20260906-014） ---------- */

// 撤销映射：只走状态机合法回退边。core.mjs 人工回退边两条（REQ-20260903-001 驳回完成、
// REQ-20260907-011 驳回接受），接受（→ accepted）因此也有撤销；映射边须与 TRANSITIONS 保持一致。
// REQ-20260910-011：补 submitted → accepted（撤销「驳回接受」= 重新接受），四个免确认流转
// 的单条入口均有反向操作可回退。
const ACTION_UNDO = {
  done: { to: 'in-progress' },        // 撤销「确认完成」= 驳回完成
  'in-progress': { to: 'done' },      // 撤销「驳回完成」= 重新确认完成
  accepted: { to: 'submitted' },      // 撤销「接受」= 驳回接受（REQ-20260907-011）
  submitted: { to: 'accepted' },      // 撤销「驳回接受」= 重新接受（REQ-20260910-011）
  planned: { to: 'accepted' },        // 撤销「移入计划」= 移出计划（REQ-20260908-010）
};

// 指定回退目标的撤销动作：移出计划（planned → accepted）的撤销是重新移入计划（accepted →
// planned），与「接受」同样落到 accepted 但回退目标不同，故由调用方显式传入 undoTo。
function undoActionTo(id, undoTo) {
  return {
    label: '撤销',
    run: async () => {
      try {
        await postTransition(id, undoTo);
        toast(`↩ 已撤销 ${id}，状态已回退`);
        await refreshAfterTransition();
      } catch (e) {
        // 常见：超过撤销窗口后状态已被其他操作变更，服务端按状态机拒绝
        toast(`撤销失败：${e.message}`, true);
      }
    },
  };
}

function undoActionFor(id, to) {
  const undo = ACTION_UNDO[to];
  return undo ? undoActionTo(id, undo.to) : null;
}

// 详情页（抽屉）操作按钮：点击立即执行，不再二次确认；可回退操作附带撤销按钮
// REQ-20260911-007：确认完成（done）先经待人工决策防呆——未答项时显式二次确认，确认后带 force 提交
async function drawerAction(id, to, label) {
  label = label || ACTION_LABEL[to] || to;
  try {
    if (to === 'accepted') {
      // accepted 目标有两种来源：待接受「接受」走批量接受；已计划「移出计划」走批量移入（REQ-20260908-010）
      // REQ-20260910-011：批量函数本身已免确认；single 让成功 toast 附「撤销」按钮
      const cur = (state.board?.items || []).find((x) => x.id === id) || state.drawer.item;
      if (cur && cur.status === 'planned') return await removeFromPlan([id], { single: true });
      return await acceptItems([id], { single: true });
    }
    if (to === 'done') {
      const guard = await confirmDoneGuard(id);
      if (!guard.proceed) return;
      await postTransition(id, to, { force: guard.force });
    } else {
      await postTransition(id, to);
    }
    toast(`✓ ${id} 已${label}`, false, undoActionFor(id, to));
    await refreshAfterTransition();
  } catch (e) {
    toast(e.message, true);
  }
}

/* ---------- 待人工决策承接（REQ-20260911-007）：持久聚合区 + 决策侧拉面板 + 复工 + 确认完成防呆 ---------- */

// 事件类型 → 中文标签（详情时间线用；与 hold-states 事件 kinds 一一对应）
const HOLD_EVENT_LABEL = { declared: '声明', answered: '已作答', resumed: '已复工', cancelled: '已作废', 'closed-done': '随完成闭环' };

function fmtWait(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '—';
  let s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return '刚刚';
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d} 天`;
  if (h >= 1) return `${h} 小时`;
  return `${m} 分`;
}

// 拉取待人工确认清单：失败保留上次数据并记录错误（下轮 / 重试自动恢复）
async function refreshHolds() {
  const project = state.project;
  try {
    const r = await api('/api/holds', undefined, project);
    if (state.project !== project) return;
    state.holds.data = r;
    state.holds.error = null;
  } catch (e) {
    if (state.project !== project) return;
    state.holds.error = String(e.message || e);
  }
  renderHolds();
}

function holdTimelineHtml(h) {
  const events = state.holds.events.get(h.itemId) || [];
  const rows = events.slice().reverse().map((e) => {
    const label = HOLD_EVENT_LABEL[e.kind] || e.kind;
    return `<li>${esc(fmtTime(e.at))} · ${esc(label)}${e.by ? `（${esc(e.by)}）` : ''}</li>`;
  }).join('');
  const runLine = h.runId ? `<p class="hold-run">运行：${esc(h.runId)}（详情见 docs/agent-team-board/dispatch/runs/，决策留痕见条目目录 decisions.md）</p>` : '<p class="hold-run">决策留痕见条目目录 decisions.md</p>';
  return `<div class="hold-timeline" data-hold-timeline="${esc(h.itemId)}">
    ${h.reason ? `<p class="hold-reason">受阻原因：${esc(h.reason)}</p>` : ''}
    ${runLine}
    ${rows ? `<ul class="hold-events">${rows}</ul>` : '<p class="muted small">（暂无事件）</p>'}
  </div>`;
}

function holdCardHtml(h) {
  const qs = h.questions.map((q) => `<li class="${q.answer ? 'answered' : 'open'}" title="${esc(q.answer ? `已答：${q.answer}` : '未答')}">${q.answer ? '✓' : '○'} ${esc(q.text)}</li>`).join('');
  const expanded = state.holds.expanded.has(h.itemId);
  const resumeDisabled = h.unanswered > 0 ? ' disabled' : '';
  const resumeTitle = h.unanswered > 0 ? ` title="尚缺 ${h.unanswered} 项决策，补齐后可复工"` : ' title="决策已齐备：条目回已计划队列，可被 AI 开发重新取单"';
  return `<article class="hold-card" data-hold-id="${esc(h.itemId)}">
    <div class="card-top">
      ${itemIdHtml(h.itemId)}
      <span class="flag hold-flag" title="worker 已声明待人工决策">⚠ 等人工决策</span>
      <span class="muted small">已等待 ${esc(fmtWait(h.declaredAt))}</span>
    </div>
    <div class="card-title">${esc(h.title || '（条目已删除）')}</div>
    <div class="hold-q-summary"><span class="muted small">未答 ${h.unanswered}/${h.total}</span>
      <ul class="hold-qs">${qs}</ul>
    </div>
    <div class="hold-acts">
      <button type="button" class="btn small" data-hold-toggle="${esc(h.itemId)}">${expanded ? '收起记录' : '查看进展记录'}</button>
      <button type="button" class="btn small primary" data-hold-answer="${esc(h.itemId)}">补决策</button>
      <button type="button" class="btn small accent" data-hold-resume="${esc(h.itemId)}"${resumeDisabled}${resumeTitle}>复工</button>
      <button type="button" class="btn small" data-hold-done="${esc(h.itemId)}">确认完成</button>
    </div>
    ${expanded ? holdTimelineHtml(h) : ''}
  </article>`;
}

// 聚合区渲染：仅需求模块且已初始化时可见；空态整体隐藏（不占版面）；
// 加载失败显示错误条 + 重试；签名剪枝避免轮询打断展开 / 点击
function renderHolds() {
  const area = $('#holdArea');
  if (!area) return;
  const showStatus = state.view === 'status';
  const b = state.board;
  if (!showStatus || !b?.initialized || state.holds.error) {
    if (state.holds.error && showStatus && b?.initialized) {
      area.classList.remove('hidden');
      area.innerHTML = `<div class="hold-error" role="alert">
        <span>待确认清单加载失败：${esc(state.holds.error)}</span>
        <button type="button" class="btn small" data-hold-retry>重试</button>
      </div>`;
      area.querySelector('[data-hold-retry]')?.addEventListener('click', () => refreshHolds());
      return;
    }
    area.classList.add('hidden');
    area.replaceChildren();
    return;
  }
  const items = state.holds.data?.items || [];
  if (!items.length) {
    area.classList.add('hidden');
    area.replaceChildren();
    return;
  }
  const sig = JSON.stringify([items.map((h) => [h.itemId, h.unanswered, h.total, h.declaredAt, h.reason, h.runId, h.questions.map((q) => q.answer || '')]), [...state.holds.expanded]]);
  if (sig === state.holds.sig && area.dataset.rendered === '1') return;
  state.holds.sig = sig;
  area.dataset.rendered = '1';
  area.classList.remove('hidden');
  area.innerHTML = `<header class="hold-area-head">⚠ 待人工确认（${items.length}）</header>
    <p class="muted small hold-area-sub">worker 声明受阻待人工决策的条目在此承接：补决策 → 复工回已计划队列；清单不随本轮任务结束消失</p>
    ${items.map((h) => holdCardHtml(h)).join('')}`;
  for (const btn of area.querySelectorAll('[data-hold-toggle]')) {
    btn.addEventListener('click', () => toggleHoldTimeline(btn.dataset.holdToggle));
  }
  for (const btn of area.querySelectorAll('[data-hold-answer]')) {
    btn.addEventListener('click', () => openHoldPanel(btn.dataset.holdAnswer, btn));
  }
  for (const btn of area.querySelectorAll('[data-hold-resume]')) {
    btn.addEventListener('click', () => resumeHoldItem(btn.dataset.holdResume, btn));
  }
  for (const btn of area.querySelectorAll('[data-hold-done]')) {
    btn.addEventListener('click', () => holdCardConfirmDone(btn.dataset.holdDone));
  }
}

// 展开 / 收起进展记录：展开时拉取最新详情（事件时间线 + 受阻原因）
async function toggleHoldTimeline(id) {
  if (state.holds.expanded.has(id)) {
    state.holds.expanded.delete(id);
    renderHolds();
    return;
  }
  try {
    const d = await api(`/api/hold/${encodeURIComponent(id)}`);
    state.holds.events.set(id, d.events || []);
    state.holds.expanded.add(id);
  } catch (e) {
    toast(`进展记录读取失败：${e.message}`, true);
    return;
  }
  renderHolds();
}

// 卡片「确认完成」：与详情抽屉同一防呆口径（未答项显式二次确认 → force 提交）
async function holdCardConfirmDone(id) {
  const guard = await confirmDoneGuard(id);
  if (!guard.proceed) return;
  try {
    await postTransition(id, 'done', { force: guard.force });
    toast(`✓ ${id} 已确认完成`);
    await refreshAfterTransition();
  } catch (e) {
    toast(e.message, true);
  }
}

// 确认完成防呆：待人工决策未答项 > 0 时显式二次确认；返回 { proceed, force }
async function confirmDoneGuard(id) {
  const it = (state.board?.items || []).find((x) => x.id === id);
  const n = it?.hold?.unanswered ?? 0;
  if (!n) return { proceed: true, force: false };
  const ok = await uiConfirm({
    title: `尚有 ${n} 项决策未答，仍要确认完成吗？`,
    message: '常规路径是补齐决策并复工；确认后将越过未答决策完成条目（留痕写入条目 decisions.md）。',
    confirmText: '仍要确认完成',
    danger: true,
  });
  return ok ? { proceed: true, force: true } : { proceed: false };
}

// ---------- 决策侧拉面板（补决策）：读取 → 表单 → 保存草稿 ----------

const holdSide = { open: false, busy: false, id: null, project: null, opener: null, seq: 0 };

function holdPanelOpen() {
  const p = $('#holdPanel');
  return !!p && !p.classList.contains('hidden');
}

function setHoldPanelView(mode) {
  $('#holdPanelLoading').classList.toggle('hidden', mode !== 'loading');
  $('#holdPanelError').classList.toggle('hidden', mode !== 'error');
  $('#holdForm').classList.toggle('hidden', mode !== 'form');
}

function holdPanelMsg(text, isErr = false) {
  const el = $('#holdPanelMsg');
  el.textContent = text;
  el.classList.toggle('err', isErr);
}

async function openHoldPanel(id, opener) {
  holdSide.open = true;
  holdSide.id = id;
  holdSide.project = state.project;
  holdSide.opener = opener || document.activeElement || null;
  holdSide.seq += 1;
  $('#holdPanelTitle').textContent = `人工决策 · ${id}`;
  holdPanelMsg('');
  $('#holdPanel').classList.remove('hidden');
  return loadHoldQuestions();
}

function closeHoldPanel() {
  holdSide.open = false;
  holdSide.seq += 1; // 迟到响应丢弃
  $('#holdPanel').classList.add('hidden');
  const opener = holdSide.opener;
  if (opener && opener.isConnected) opener.focus?.();
}

async function loadHoldQuestions() {
  const token = holdSide.seq;
  const { id, project } = holdSide;
  setHoldPanelView('loading');
  try {
    const d = await api(`/api/hold/${encodeURIComponent(id)}`, undefined, project);
    if (!holdSide.open || token !== holdSide.seq) return;
    const rows = d.questions.map((q) => `
      <fieldset class="hold-q">
        <legend class="${q.answer ? 'answered' : 'open'}">${q.answer ? '✓' : '○'} ${esc(q.id)} · ${esc(q.text)}</legend>
        <textarea rows="2" data-hq="${esc(q.id)}" placeholder="人工答复（必填才计入已答）">${esc(q.answer || '')}</textarea>
        <input type="text" data-hq-note="${esc(q.id)}" placeholder="补充说明（可选）" value="${esc(q.note || '')}">
      </fieldset>`).join('');
    $('#holdQuestions').innerHTML = rows;
    $('#holdFormMeta').textContent = `声明：${fmtTime(d.declaredAt)}（${d.declaredBy || '?'}）${d.reason ? ` · ${d.reason}` : ''} · 未答 ${d.unanswered}/${d.total}`;
    setHoldPanelView('form');
    $('#holdQuestions textarea')?.focus();
  } catch (e) {
    if (!holdSide.open || token !== holdSide.seq) return;
    $('#holdPanelErrorText').textContent = `决策项读取失败：${e.message}`;
    setHoldPanelView('error');
  }
}

// 保存决策（草稿）：逐项收集非空答复；全部作答后提示可复工并保持面板开合由人工决定
async function saveHoldAnswers() {
  if (holdSide.busy) return;
  const { id, project } = holdSide;
  const answers = [];
  for (const ta of $('#holdQuestions').querySelectorAll('textarea[data-hq]')) {
    const text = ta.value.trim();
    if (!text) continue;
    const note = $(`#holdQuestions [data-hq-note="${ta.dataset.hq}"]`)?.value?.trim() || '';
    answers.push({ q: ta.dataset.hq, text, note });
  }
  if (!answers.length) {
    holdPanelMsg('请至少填写一项答复再保存', true);
    return;
  }
  holdSide.busy = true;
  $('#holdPanelSave').disabled = true;
  $('#holdPanelSave').textContent = '保存中…';
  try {
    const r = await api(`/api/hold/${encodeURIComponent(id)}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    }, project);
    if (r.unanswered > 0) {
      holdPanelMsg(`草稿已保存，尚缺 ${r.unanswered} 项（${(r.missing || []).join('、')}），复工保持禁用`);
      toast(`草稿已保存，尚缺 ${r.unanswered} 项`);
    } else {
      holdPanelMsg('决策已齐备，可复工（回到已计划队列）');
      toast('决策已齐备，可复工');
    }
    await refreshHolds();
    await poll();
  } catch (e) {
    holdPanelMsg(`保存失败：${e.message}（输入已保留，可重试）`, true);
  } finally {
    holdSide.busy = false;
    $('#holdPanelSave').disabled = false;
    $('#holdPanelSave').textContent = '保存决策';
  }
}

// 复工：决策齐备后条目回已计划队列；失败（如状态已变化）如实提示、不静默变更
async function resumeHoldItem(id, btn) {
  if (btn?.disabled) return;
  const prev = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = '复工中…'; }
  try {
    await api(`/api/hold/${encodeURIComponent(id)}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    toast(`已复工 ${id}：回到已计划队列，可被 AI 开发重新取单`);
    await refreshAfterTransition();
  } catch (e) {
    toast(`复工失败：${e.message}`, true);
    if (btn) { btn.disabled = false; btn.textContent = prev || '复工'; }
    await refreshHolds();
  }
}

/* ---------- REQ-20260914-001 挂起确认区（任务页置顶卡片 + 统一侧拉确认面板） ---------- */

// 拉取挂起确认清单（失败保留上次数据并记录错误，下轮 / 重试自动恢复）
async function refreshConfirms(force = false) {
  if (!state.batch.open) return;
  if (!force && state.confirms.busyId) return; // 操作进行中不刷新（防打断表单）
  try {
    const r = await api('/api/confirms');
    state.confirms.data = r;
    state.confirms.error = null;
  } catch (e) {
    state.confirms.error = String(e.message || e);
  }
  renderConfirmArea();
}

function confirmKindChip(c) {
  return `<span class="chip confirm-kind k-${esc(c.kind)}" title="${esc(c.kindLabel)}阻塞">${esc(c.kindLabel)}</span>`;
}

function confirmCardHtml(c) {
  const busy = state.confirms.busyId === c.itemId;
  const isDev = c.kind === 'develop';
  const badge = c.partialBadge && isDev
    ? '<span class="flag confirm-flag" title="部分提交，开发未完成——文档或部分文件提交不构成完成">部分提交，开发未完成</span>'
    : '';
  let bodyLine = '';
  if (isDev) {
    bodyLine = `已提交：${c.committedCount} 组 · 待人工：${c.pendingCount} 路径${c.legacy ? ' · 历史账本恢复' : ''}`;
  } else {
    const miss = Array.isArray(c.unansweredRequired) ? c.unansweredRequired.length : 0;
    bodyLine = `${c.total} 项问题（必答未答 ${miss}）${c.state === 'confirmed' ? ' · 已确认，续跑中' : ''}`;
  }
  const verifyLine = isDev && c.verify && c.verify.lastCheckAt
    ? `<p class="confirm-verify ${c.verify.ok ? 'ok' : 'bad'}">最近核验（${fmtTime(c.verify.lastCheckAt)}）：${c.verify.ok ? '通过' : `未通过——${(c.verify.reasons || [])[0] || '见面板明细'}`}</p>`
    : '';
  return `<article class="confirm-card" data-confirm-card="${esc(c.itemId)}">
    <header class="confirm-card-head">
      <div>
        ${confirmKindChip(c)}
        <span class="chip confirm-type t-${esc(c.blockType)}">${esc(c.blockTypeLabel)}</span>
        <span class="cid link" data-goto-item="${esc(c.itemId)}" role="button">${esc(c.itemId)}</span>
        <span class="confirm-title">${esc(shortOwner(c.title))}</span>
        ${badge}
      </div>
      <span class="muted small">已等待 ${fmtElapsed(c.declaredAt)}</span>
    </header>
    <p class="confirm-reason">${esc(c.reason || '')}</p>
    <p class="confirm-counts">${esc(bodyLine)}</p>
    ${verifyLine}
    ${c.keepNote ? `<p class="confirm-keep-note muted small">保持挂起说明：${esc(c.keepNote)}</p>` : ''}
    <div class="confirm-acts">
      <button type="button" class="btn small" data-confirm-panel="${esc(c.itemId)}">查看并确认</button>
      ${isDev ? `<button type="button" class="btn small" data-confirm-verify="${esc(c.itemId)}"${busy ? ' disabled' : ''}>${busy ? '正在核验提交与测试…' : '重新核验'}</button>` : ''}
    </div>
  </article>`;
}

// 任务页置顶渲染（renderBatchDrawer 调用；无活动挂起时隐藏，不影响既有面板）
function renderConfirmArea() {
  const area = $('#confirmArea');
  if (!area) return;
  const items = (state.confirms.data?.items || []).filter((c) => c.state === 'waiting' || c.state === 'confirmed');
  if (state.confirms.error && !state.confirms.data) {
    area.classList.remove('hidden');
    area.innerHTML = `<div class="hold-error" role="alert">
      <span>挂起确认清单加载失败：${esc(state.confirms.error)}</span>
      <button type="button" class="btn small" data-confirm-retry>重试</button>
    </div>`;
    area.querySelector('[data-confirm-retry]')?.addEventListener('click', () => refreshConfirms(true));
    return;
  }
  if (!items.length) {
    area.classList.add('hidden');
    area.replaceChildren();
    return;
  }
  const sig = JSON.stringify([items.map((c) => [c.itemId, c.state, c.reason, c.verify?.lastCheckAt || '', c.keepNote || '', c.committedCount ?? c.answered ?? 0, c.pendingCount ?? (Array.isArray(c.unansweredRequired) ? c.unansweredRequired.length : 0)]), state.confirms.busyId]);
  if (sig === state.confirms.sig && area.dataset.rendered === '1') return;
  state.confirms.sig = sig;
  area.dataset.rendered = '1';
  area.classList.remove('hidden');
  area.innerHTML = `<header class="hold-area-head">⚠ 待人工确认（${items.length}）——阻塞队列，确认后才继续</header>
    ${items.map((c) => confirmCardHtml(c)).join('')}`;
  for (const btn of area.querySelectorAll('[data-confirm-panel]')) {
    btn.addEventListener('click', () => openConfirmPanel(btn.dataset.confirmPanel, btn));
  }
  for (const btn of area.querySelectorAll('[data-confirm-verify]')) {
    btn.addEventListener('click', () => verifyConfirmItem(btn.dataset.confirmVerify, btn));
  }
}

// 队列区暂停横幅（develop / refine 面板 overview 共用）
function confirmQueueBannerHtml(kind) {
  const items = (state.confirms.data?.items || []).filter((c) => c.kind === kind && c.state === 'waiting');
  if (!items.length) return '';
  const c = items[0];
  return `<div class="notice warn confirm-queue-banner">${esc(c.kindLabel)}队列：已暂停 · 阻塞于 <span class="cid" data-goto-item="${esc(c.itemId)}" role="button">${esc(c.itemId)}</span> · ${esc(c.blockTypeLabel)}（${esc(c.reason || '')}）</div>`;
}

// 卡片「重新核验」：服务端重算剩余路径 + 跑测试；期间按钮禁用防重复
async function verifyConfirmItem(id, btn) {
  if (btn?.disabled || state.confirms.busyId) return;
  state.confirms.busyId = id;
  renderConfirmArea();
  try {
    const r = await api(`/api/confirms/${encodeURIComponent(id)}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (r.ok) toast(`✓ ${id} 核验通过：提交完整${r.test && !r.test.skipped ? '，测试通过' : ''}`);
    else toast(`核验未通过：${(r.reasons || [])[0] || '见卡片与面板明细'}`, true);
    await refreshConfirms(true);
    if (confirmSide.open && confirmSide.id === id) await loadConfirmDetail(true);
  } catch (e) {
    toast(`核验失败：${e.message}`, true);
  } finally {
    state.confirms.busyId = null;
    renderConfirmArea();
  }
}

/* ---------- 挂起确认侧拉面板（统一入口：提交核验 / 分析表单按阻塞类型分形态） ---------- */

const confirmSide = { open: false, busy: false, id: null, seq: 0, detail: null };

function confirmPanelOpen() {
  const p = $('#confirmPanel');
  return !!p && !p.classList.contains('hidden');
}

function setConfirmPanelView(mode) {
  $('#confirmPanelLoading').classList.toggle('hidden', mode !== 'loading');
  $('#confirmPanelError').classList.toggle('hidden', mode !== 'error');
  $('#confirmForm').classList.toggle('hidden', mode !== 'form');
}

function confirmPanelMsg(text, isErr = false) {
  const el = $('#confirmPanelMsg');
  // 首次打开时表单尚未渲染，消息节点不存在，不应阻断详情加载。
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('err', isErr);
}

async function openConfirmPanel(id, opener) {
  confirmSide.open = true;
  confirmSide.id = id;
  confirmSide.seq += 1;
  confirmSide.opener = opener || document.activeElement || null;
  $('#confirmPanel').classList.remove('hidden');
  confirmPanelMsg('');
  return loadConfirmDetail();
}

function closeConfirmPanel() {
  confirmSide.open = false;
  confirmSide.seq += 1; // 迟到响应丢弃
  $('#confirmPanel').classList.add('hidden');
  const opener = confirmSide.opener;
  if (opener && opener.isConnected) opener.focus?.();
}

async function loadConfirmDetail(silent = false) {
  const token = confirmSide.seq;
  const { id } = confirmSide;
  if (!silent) setConfirmPanelView('loading');
  try {
    const d = await api(`/api/confirms/${encodeURIComponent(id)}`);
    if (!confirmSide.open || token !== confirmSide.seq) return;
    confirmSide.detail = d;
    state.confirms.detail.set(id, d);
    renderConfirmForm(d);
    setConfirmPanelView('form');
  } catch (e) {
    if (!confirmSide.open || token !== confirmSide.seq) return;
    $('#confirmPanelErrorText').textContent = `挂起详情读取失败：${e.message}`;
    setConfirmPanelView('error');
  }
}

function renderConfirmForm(d) {
  $('#confirmPanelTitle').textContent = `${d.blockTypeLabel} · ${d.itemId}`;
  $('#confirmPanelScope').textContent = d.kind === 'develop'
    ? '核对文件与差异后确认：服务端将重新核验、补交并验证测试，通过后恢复队列'
    : '逐项作答后确认：答案回传当前条目继续分析，未决问题清零才处理下一条';
  const form = $('#confirmForm');
  const busy = confirmSide.busy || state.confirms.busyId === d.itemId;
  const resolved = d.state !== 'waiting';
  if (d.kind === 'develop') {
    const files = (d.files || []).map((f) => `
      <tr>
        <td title="${esc(f.path)}">${esc(f.path)}</td>
        <td>${f.state === '已入库' ? '已入库' : '未提交'}</td>
        <td><button type="button" class="btn small" data-confirm-diff="${esc(f.path)}">查看差异</button></td>
      </tr>`).join('');
    const heldCount = d.pendingCount || 0;
    const verifyRows = d.verify && d.verify.lastCheckAt
      ? `<p class="confirm-verify ${d.verify.ok ? 'ok' : 'bad'}">最近核验（${fmtTime(d.verify.lastCheckAt)}）：${d.verify.ok ? '通过' : '未通过'}</p>
        ${(d.verify.reasons || []).map((r) => `<p class="confirm-verify-reason">· ${esc(r)}</p>`).join('')}
        ${d.verify.test && d.verify.test.tail ? `<details class="confirm-test-tail"><summary>测试输出（${esc(d.verify.test.cmd || 'npm test')} 退出码 ${d.verify.test.exitCode ?? '—'}）</summary><pre>${esc(d.verify.test.tail)}</pre></details>` : ''}`
      : '<p class="muted small">尚未核验：确认时将自动重新核验并运行测试</p>';
    form.innerHTML = `
      <p class="confirm-reason">${esc(d.reason || '')}${d.legacy ? '（历史账本恢复）' : ''}</p>
      <p class="confirm-counts">已提交：${d.committedCount} 组（补交 ${(d.supplementCommits || []).length} 组）· 待人工：${heldCount} 路径</p>
      ${files ? `<table class="confirm-files"><thead><tr><th>文件</th><th>状态</th><th>差异</th></tr></thead><tbody>${files}</tbody></table>` : ''}
      <div id="confirmDiffBox" class="confirm-diff-box"></div>
      ${verifyRows}
      <label class="field">处理说明（保持挂起时记录；确认时可留空）
        <textarea id="confirmNote" rows="2" placeholder="如：已核对归属，整文件归本单">${esc(d.keepNote || '')}</textarea>
      </label>
      <p id="confirmPanelMsg" class="edit-msg" role="status" aria-live="polite"></p>
      <footer class="modal-foot">
        <button type="button" class="btn" id="confirmPanelCancel">关闭</button>
        <button type="button" class="btn" id="confirmKeepBtn"${busy || resolved ? ' disabled' : ''}>保持挂起</button>
        <button type="button" class="btn" id="confirmVerifyBtn"${busy || resolved ? ' disabled' : ''}>${busy ? '正在核验提交与测试…' : '重新核验'}</button>
        <button type="button" class="btn primary" id="confirmContinueBtn"${busy || resolved ? ' disabled' : ''}>${resolved ? '已确认恢复' : '确认并继续'}</button>
      </footer>`;
    bindConfirmFormActions(d);
  } else {
    const qs = (d.questions || []).map((q) => {
      const opts = (q.options || []).map((o, i) => `
        <label class="confirm-option">
          <input type="radio" name="cq-${esc(q.id)}" value="${esc(o.label)}"${(q.answer || '') === o.label ? ' checked' : ''}>
          <span>${esc(o.label)}${o.recommended ? '<em class="confirm-rec">（推荐）</em>' : ''}${o.impact ? `<small class="muted">——${esc(o.impact)}</small>` : ''}</small></span>
        </label>`).join('');
      return `
      <fieldset class="hold-q confirm-q">
        <legend class="${q.answer ? 'answered' : 'open'}">${q.answer ? '✓' : '○'} ${esc(q.id)} · ${esc(q.text)}${q.required ? '' : '（选答）'}</legend>
        ${opts || ''}
        <textarea rows="2" data-cq="${esc(q.id)}" placeholder="${(q.options || []).length ? '选择方案，可在此补充意见' : '人工答复（必答）'}">${esc(q.answer || '')}</textarea>
      </fieldset>`;
    }).join('');
    const miss = Array.isArray(d.unansweredRequired) ? d.unansweredRequired.length : 0;
    form.innerHTML = `
      ${d.background ? `<p class="confirm-background">背景：${esc(d.background)}</p>` : ''}
      <p class="confirm-counts">问题 ${d.total} 项 · 已答 ${d.answered} · 必答未答 ${miss}${d.state === 'confirmed' ? ' · 已确认，答案续跑中' : ''}</p>
      ${qs}
      <label class="field">处理说明（保持挂起时记录）
        <textarea id="confirmNote" rows="2" placeholder="可留空">${esc(d.keepNote || '')}</textarea>
      </label>
      <p id="confirmPanelMsg" class="edit-msg" role="status" aria-live="polite"></p>
      <footer class="modal-foot">
        <button type="button" class="btn" id="confirmPanelCancel">关闭</button>
        <button type="button" class="btn" id="confirmKeepBtn"${busy || resolved ? ' disabled' : ''}>保持挂起</button>
        <button type="button" class="btn" id="confirmDraftBtn"${busy || resolved ? ' disabled' : ''}>保存草稿</button>
        <button type="button" class="btn primary" id="confirmContinueBtn"${busy || resolved ? ' disabled' : ''}>${resolved ? '已确认续跑' : '确认并继续'}</button>
      </footer>`;
    bindConfirmFormActions(d);
  }
}

// 面板动作绑定（差异查看 / 保持挂起 / 重新核验 / 保存草稿 / 确认并继续）
function bindConfirmFormActions(d) {
  const form = $('#confirmForm');
  form.querySelector('#confirmPanelCancel')?.addEventListener('click', () => { if (!confirmSide.busy) closeConfirmPanel(); });
  form.querySelector('#confirmKeepBtn')?.addEventListener('click', () => confirmKeepAction(d));
  form.querySelector('#confirmVerifyBtn')?.addEventListener('click', () => verifyConfirmItem(d.itemId, null).then(() => {}));
  form.querySelector('#confirmDraftBtn')?.addEventListener('click', () => confirmDraftAction(d));
  form.querySelector('#confirmContinueBtn')?.addEventListener('click', () => confirmContinueAction(d));
  for (const btn of form.querySelectorAll('[data-confirm-diff]')) {
    btn.addEventListener('click', async () => {
      const p = btn.dataset.confirmDiff;
      const box = form.querySelector('#confirmDiffBox');
      if (!box) return;
      box.innerHTML = '<p class="muted small">正在读取差异…</p>';
      try {
        const r = await api(`/api/confirms/${encodeURIComponent(d.itemId)}/diff?path=${encodeURIComponent(p)}`);
        box.innerHTML = `<details open class="confirm-diff"><summary>${esc(p)}</summary><pre>${esc(r.diff || '（与 HEAD 一致：无差异——可能已补交入库）')}</pre></details>`;
      } catch (e) {
        box.innerHTML = `<p class="edit-error-text">差异读取失败：${esc(e.message)}</p>`;
      }
    });
  }
}

async function confirmKeepAction(d) {
  if (confirmSide.busy) return;
  const note = $('#confirmForm #confirmNote')?.value?.trim() || '';
  confirmSide.busy = true;
  setConfirmButtonsDisabled(true);
  try {
    await api(`/api/confirms/${encodeURIComponent(d.itemId)}/keep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });
    confirmPanelMsg('已保持挂起：现场与队列暂停保留（取消队列须显式终止任务或恢复领取）');
    toast(`已保持挂起 ${d.itemId}`);
    await refreshConfirms(true);
    await loadConfirmDetail(true);
  } catch (e) {
    confirmPanelMsg(`保持挂起失败：${e.message}`, true);
  } finally {
    confirmSide.busy = false;
    setConfirmButtonsDisabled(false);
  }
}

// 分析草稿：收集选项 + 文本（文本优先；选了方案又有补充意见时合并），保存不解除阻塞
function collectAnalysisAnswers() {
  const answers = [];
  for (const ta of $('#confirmForm').querySelectorAll('textarea[data-cq]')) {
    const qid = ta.dataset.cq;
    const picked = $('#confirmForm').querySelector(`input[name="cq-${CSS.escape(qid)}"]:checked`)?.value || '';
    const text = ta.value.trim();
    const merged = picked && text && text !== picked ? `${picked}（补充：${text}）` : (text || picked);
    if (!merged) continue;
    answers.push({ q: qid, text: merged });
  }
  return answers;
}

async function confirmDraftAction(d) {
  if (confirmSide.busy) return;
  const answers = collectAnalysisAnswers();
  if (!answers.length) {
    confirmPanelMsg('请至少填写或选择一项再保存草稿', true);
    return;
  }
  confirmSide.busy = true;
  setConfirmButtonsDisabled(true);
  try {
    const r = await api(`/api/confirms/${encodeURIComponent(d.itemId)}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
    if (r.ready) confirmPanelMsg('草稿已保存：必答已齐，可「确认并继续」');
    else confirmPanelMsg(`草稿已保存（缺 ${(r.missing || []).join('、')}）：保存草稿不解除阻塞`);
    await refreshConfirms(true);
    await loadConfirmDetail(true);
  } catch (e) {
    confirmPanelMsg(`草稿保存失败：${e.message}（输入已保留，可重试）`, true);
  } finally {
    confirmSide.busy = false;
    setConfirmButtonsDisabled(false);
  }
}

async function confirmContinueAction(d) {
  if (confirmSide.busy) return;
  const isDev = d.kind === 'develop';
  // 必答校验（就地提示，禁用继续）：推荐选项不自动视为已答
  if (!isDev) {
    const answers = collectAnalysisAnswers();
    const answeredIds = new Set(answers.map((a) => a.q));
    const missing = (d.questions || []).filter((q) => q.required && !answeredIds.has(q.id)).map((q) => q.id);
    if (missing.length) {
      confirmPanelMsg(`必答项未完成（缺 ${missing.join('、')}）：完成作答后才能确认并继续`, true);
      return;
    }
    if (!answers.length) {
      confirmPanelMsg('请完成作答后再确认', true);
      return;
    }
    // 先保存答案再确认（确认绑定当前作答）
    confirmSide.busy = true;
    setConfirmButtonsDisabled(true);
    try {
      await api(`/api/confirms/${encodeURIComponent(d.itemId)}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
    } catch (e) {
      confirmPanelMsg(`作答保存失败：${e.message}`, true);
      confirmSide.busy = false;
      setConfirmButtonsDisabled(false);
      return;
    }
  } else {
    confirmSide.busy = true;
    setConfirmButtonsDisabled(true);
  }
  const btn = $('#confirmContinueBtn');
  const prev = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = isDev ? '正在核验提交与测试…' : '确认中…'; }
  try {
    const body = isDev
      ? { fingerprint: d.fingerprint, note: $('#confirmForm #confirmNote')?.value?.trim() || '' }
      : { version: d.questionsVersion };
    const r = await api(`/api/confirms/${encodeURIComponent(d.itemId)}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      if (isDev) {
        const n = (r.supplementCommits || []).length;
        confirmPanelMsg(`已确认恢复：${n ? `补交 ${n} 组提交` : '无需补交（已完整入库）'}，核验通过，队列已恢复；条目验收仍走「确认完成」`);
        toast(`✓ ${d.itemId} 已确认恢复：队列继续`);
      } else {
        confirmPanelMsg('已确认，正在继续当前条目分析（完成后才处理下一条）');
        toast(`✓ ${d.itemId} 已确认：答案回传续跑`);
      }
      await refreshConfirms(true);
      await loadConfirmDetail(true);
      await poll();
    } else {
      confirmPanelMsg(`确认未通过，保持挂起：\n· ${(r.reasons || ['未知原因']).join('\n· ')}`, true);
      await refreshConfirms(true);
      await loadConfirmDetail(true);
    }
  } catch (e) {
    confirmPanelMsg(`确认失败：${e.message}（可重试）`, true);
  } finally {
    confirmSide.busy = false;
    setConfirmButtonsDisabled(false);
    if (btn) { btn.disabled = false; btn.textContent = prev || '确认并继续'; }
  }
}

function setConfirmButtonsDisabled(disabled) {
  for (const sel of ['#confirmKeepBtn', '#confirmVerifyBtn', '#confirmDraftBtn', '#confirmContinueBtn']) {
    const el = $(sel);
    if (el) el.disabled = disabled;
  }
}

/* ---------- 已计划列多选（REQ-20260906-018 引入；BUG-20260909-006 起仅为「移出计划」服务，交互对齐批量接受：常驻无模式） ---------- */

// 可实施资格与后端 candidateItems 一致：planned（已计划）且未被认领
// REQ-20260906-015：搜索叠加生效时，批量操作资格只作用于搜索可见行；
// BUG-20260907-016：勾选资格不随档位筛选收窄（同 submittedItems，避免切档丢勾选）
function implCandidates() {
  return searchVisibleItems(state.board?.items || []).filter((it) => it.status === 'planned' && !it.owner);
}

// REQ-20260908-010 开发启动队列预览：已计划未认领，最旧（创建时间）优先，与调度口径一致
function plannedQueue() {
  return [...(state.board?.items || [])]
    .filter((it) => it.status === 'planned' && !it.owner)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)));
}

// REQ-20260907-009：「选择可操作项」一键全选只覆盖当前筛选档内可见的可操作条目
// （叠搜索范围）——此前跨档全选会让工具条计数计入大量当前档不可见条目，与所见不符。
// 仅此入口按档收窄；手动勾选资格与轮询剪枝仍跨档（BUG-20260907-016 契约不回退）。
function operableInCurrentLane() {
  return [...submittedItems(), ...planCandidates(), ...implCandidates()].filter((it) => laneOf(it) === state.reqFilter);
}

// 「全选」点击逻辑（具名函数：事件绑定区直调，测试可直接验证；原「选择可操作项」）。
// REQ-20260908-027：当前档勾选集合替换为当前筛选档内可见的可操作条目（叠搜索范围，
// 所见即所选）；其他档勾选不动（BUG-20260907-016 跨档保留契约不因全选被清空）。
// 待接受 → 批量接受集合；已接受 → 批量移入计划/驳回集合（REQ-20260908-018/027）；
// 已计划 → 移出计划集合（REQ-20260908-010；BUG-20260909-006 起勾选仅服务移出计划）。
function selectOperable() {
  if (anyBatchPending()) return;
  const key = LANE_SELECTION[state.reqFilter];
  if (!key) return;
  state[key].selected = new Set(operableInCurrentLane().map((it) => it.id));
  syncAcceptance();
  syncPlan(false);
  syncImpl(false);
}

// REQ-20260908-027：「全不选」——仅取消当前筛选档的勾选（其他档保留）。
function deselectOperable() {
  if (anyBatchPending()) return;
  const key = LANE_SELECTION[state.reqFilter];
  if (!key) return;
  state[key].selected = new Set();
  syncAcceptance();
  syncPlan(false);
  syncImpl(false);
}

// 只更新控件，不重建列表行（对齐批量接受的同步策略）；
// notify=true（轮询路径）时失效剔除给 toast，用户主动操作传 false 不打扰
function syncImpl(notify = true) {
  const m = state.impl;
  const eligible = new Set(implCandidates().map((it) => it.id));
  const removed = [...m.selected].filter((id) => !eligible.has(id));
  for (const id of removed) m.selected.delete(id);
  if (removed.length && notify) {
    toast(`${removed.join('、')} 已不在已计划状态，已从选择中移除`, true);
  }
  for (const check of document.querySelectorAll('[data-impl-id]')) {
    check.checked = m.selected.has(check.dataset.implId);
    check.disabled = anyBatchPending(); // REQ-20260908-027：批量进行中复选框防误触；勾选不再加行级边框
  }
  syncAcceptance(); // 选择工具条按当前档收窄（REQ-20260908-027）
}

// REQ-20260908-010 批量移出计划：已计划且未进入开发中的勾选逐条 planned → accepted（服务端
// setStatus 流转校验），成功/失败分列反馈、不因单项失败回滚（对齐批量接受 acceptItems）。
// 已进入开发中（in-progress）的单无勾选资格，即便混入也被 eligible 过滤并如实提示。
// REQ-20260910-011：移出计划可撤销（重新移入计划），免去二次确认；single=true 为详情页单条
// 入口，成功 toast 附「撤销」按钮。
async function removeFromPlan(ids, { single = false } = {}) {
  const m = state.impl;
  if (m.pending) return;
  const eligible = new Set(implCandidates().map((it) => it.id));
  const ineligible = [...new Set(ids)].filter((id) => !eligible.has(id));
  const selected = [...new Set(ids)].filter((id) => eligible.has(id));
  if (!selected.length) {
    toast('没有可移出计划的已计划条目（已进入开发中的单不能移出计划）', true);
    return;
  }
  const project = state.project;
  m.pending = true;
  m.failures = [];
  let succeeded = 0;
  m.message = `正在移出计划 0 / ${selected.length}…`;
  syncAcceptance();
  try {
    for (const id of selected) {
      // 切换项目后停止尚未发送的请求；在途请求仍绑定原项目。
      if (state.impl !== m) return;
      try {
        await api(`/api/item/${encodeURIComponent(id)}/status`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: 'accepted' }),
        }, project);
        succeeded++;
        m.selected.delete(id);
      } catch (e) {
        m.failures.push({ id, error: e.message });
        m.selected.add(id);
      }
      if (state.impl !== m) return;
      m.message = `正在移出计划 ${succeeded + m.failures.length} / ${selected.length}…`;
      syncAcceptance();
    }
    if (single && succeeded === 1 && m.failures.length === 0) {
      m.message = `✓ ${selected[0]} 已移出计划`;
      toast(m.message, false, undoActionTo(selected[0], 'planned'));
    } else {
      m.message = `移出计划完成：成功 ${succeeded} 条，失败 ${m.failures.length} 条`
        + (ineligible.length ? `（另 ${ineligible.length} 条已进入开发中，不能移出计划）` : '');
      toast(m.message, m.failures.length > 0);
    }
    await poll();
  } finally {
    m.pending = false;
    if (state.impl === m) syncAcceptance();
  }
}

/* ---------- 已接受列表批量移入计划（REQ-20260908-018） ---------- */

// 移入计划资格 = 已接受条目（与详情页「移入计划」单条按钮同口径）。
// REQ-20260906-015：搜索叠加生效时只作用于搜索可见行；
// BUG-20260907-016：勾选资格不随档位筛选收窄（同 submittedItems/implCandidates，避免切档丢勾选）
function planCandidates() {
  return searchVisibleItems(state.board?.items || []).filter((it) => it.status === 'accepted');
}

// 只更新控件，不重建列表行（对齐 syncImpl 的同步策略）；
// notify=true（轮询路径）时失效剔除给 toast，用户主动操作传 false 不打扰
function syncPlan(notify = true) {
  const m = state.plan;
  const eligible = new Set(planCandidates().map((it) => it.id));
  const removed = [...m.selected].filter((id) => !eligible.has(id));
  for (const id of removed) m.selected.delete(id);
  if (removed.length && notify) {
    toast(`${removed.join('、')} 已不在已接受状态，已从选择中移除`, true);
  }
  for (const check of document.querySelectorAll('[data-plan-id]')) {
    check.checked = m.selected.has(check.dataset.planId);
    check.disabled = m.pending || state.reject.pending; // REQ-20260908-027：移入计划/驳回进行中防误触；勾选不再加行级边框
  }
  syncAcceptance(); // 选择工具条按当前档收窄（REQ-20260908-027）
}

// REQ-20260908-018 批量移入计划：已接受勾选逐条 accepted → planned（服务端 setStatus
// 流转校验），成功/失败分列反馈、不因单项失败回滚（对齐批量接受 acceptItems /
// 批量移出计划 removeFromPlan）。已进入开发中等非已接受单无勾选资格，混入被过滤。
// REQ-20260910-011：移入计划可撤销（移出计划），免去二次确认；单条入口（详情页按钮）走
// drawerAction 通用路径，成功 toast 自带撤销。
async function moveToPlan(ids) {
  const m = state.plan;
  if (m.pending) return;
  const eligible = new Set(planCandidates().map((it) => it.id));
  const selected = [...new Set(ids)].filter((id) => eligible.has(id));
  if (!selected.length) {
    toast('没有可移入计划的已接受条目', true);
    return;
  }
  const project = state.project;
  m.pending = true;
  m.failures = [];
  let succeeded = 0;
  m.message = `正在移入计划 0 / ${selected.length}…`;
  syncAcceptance();
  try {
    for (const id of selected) {
      // 切换项目后停止尚未发送的请求；在途请求仍绑定原项目。
      if (state.plan !== m) return;
      try {
        await api(`/api/item/${encodeURIComponent(id)}/status`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: 'planned' }),
        }, project);
        succeeded++;
        m.selected.delete(id);
      } catch (e) {
        m.failures.push({ id, error: e.message });
        m.selected.add(id); // 失败保留勾选，便于处理完重试
      }
      if (state.plan !== m) return;
      m.message = `正在移入计划 ${succeeded + m.failures.length} / ${selected.length}…`;
      syncAcceptance();
    }
    m.message = `移入计划完成：成功 ${succeeded} 条，失败 ${m.failures.length} 条`;
    toast(m.message, m.failures.length > 0);
    await poll();
  } finally {
    m.pending = false;
    if (state.plan === m) syncPlan(false);
  }
}

/* ---------- 已接受列表批量驳回待接受（REQ-20260908-027） ---------- */

// REQ-20260908-027 批量驳回待接受：已接受勾选（与批量移入计划共用 plan.selected）逐条
// accepted → submitted（服务端 setStatus 流转校验，口径对齐详情页单条「驳回接受」），
// 成功/失败分列反馈、不因单项失败回滚（对齐 acceptItems / moveToPlan / removeFromPlan）。
// 完善中（refineState=refining）的单被服务端拦截并计入失败清单（core.mjs setStatus 现有校验）。
// REQ-20260910-011：驳回待接受可撤销（重新接受），免去二次确认；单条入口（详情页按钮）走
// drawerAction 通用路径，成功 toast 自带撤销。
async function rejectToSubmitted(ids) {
  const m = state.reject;
  if (m.pending) return;
  const eligible = new Set(planCandidates().map((it) => it.id));
  const selected = [...new Set(ids)].filter((id) => eligible.has(id));
  if (!selected.length) {
    toast('没有可驳回待接受的已接受条目', true);
    return;
  }
  const project = state.project;
  m.pending = true;
  m.failures = [];
  let succeeded = 0;
  m.message = `正在驳回待接受 0 / ${selected.length}…`;
  syncAcceptance();
  try {
    for (const id of selected) {
      // 切换项目后停止尚未发送的请求；在途请求仍绑定原项目。
      if (state.reject !== m) return;
      try {
        await api(`/api/item/${encodeURIComponent(id)}/status`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: 'submitted' }),
        }, project);
        succeeded++;
        state.plan.selected.delete(id);
      } catch (e) {
        m.failures.push({ id, error: e.message });
        state.plan.selected.add(id); // 失败保留勾选，便于处理完重试
      }
      if (state.reject !== m) return;
      m.message = `正在驳回待接受 ${succeeded + m.failures.length} / ${selected.length}…`;
      syncAcceptance();
    }
    m.message = `驳回待接受完成：成功 ${succeeded} 条，失败 ${m.failures.length} 条`;
    toast(m.message, m.failures.length > 0);
    await poll();
  } finally {
    m.pending = false;
    if (state.reject === m) syncAcceptance();
  }
}

// REQ-20260909-002：「清空选择」入口移除——清除选择统一用「全不选」图标按钮（REQ-20260910-026
// 起去文字仅图标，aria-label=全不选；BUG-20260910-019 起图标为内联 SVG 空方框；deselectOperable，仅清当前档）。
// BUG-20260909-006：列表「进入批量开发」入口与勾选范围推送链路整体移除——批量开发入口唯一收敛
// 任务模块（gotoRuns('develop')），口径唯一化为已计划队列（最旧优先、运行中新置计划自动进入队列）。

/* ---------- 需求完善入口（REQ-20260907-003）：REQ-20260908-027 起选择工具条不再设「批量完善」按钮
   （REQ-20260908-020 起批量完善面向已接受未完善单、与勾选无关）——入口收敛为任务模块
   「批量完善」面板与已接受行/详情页完善徽标（gotoRuns('refine')，见 refineBadgeHtml 绑定）。 ---------- */

/* ---------- 抽屉 ---------- */

// REQ-20260907-004：宽屏列表与详情并排（split 第二栏），窄屏（≤1020）为覆盖式抽屉 + 返回入口
function drawerOverlayMode() {
  return window.matchMedia ? window.matchMedia('(max-width: 1020px)').matches : true;
}

async function openDrawer(id, keepScope = false) {
  // keepScope：prev/next 导航沿用打开时冻结的范围；点行/跳转链接则按新条目重算
  const navIds = keepScope && state.drawer.navIds?.length ? state.drawer.navIds : scopeIdsFor(id);
  state.drawer = { id, item: null, doc: null, navIds: navIds || null, deps: null, depsFetched: false, depFilter: '', tab: 'info', docCache: {} };
  if (state.view !== 'status') setView('status'); // 从其他模块定位条目时回到需求模块
  const drawer = $('#drawer');
  drawer.classList.add('has-item');
  drawer.classList.remove('hidden');
  drawer.innerHTML = '<div class="drawer-empty muted">加载中…</div>';
  $('#mask').classList.toggle('hidden', !drawerOverlayMode());
  state.listSig = ''; // 重算行选中态
  await refreshDrawer();
  saveViewSnapshot(); // REQ-20260910-001：抽屉条目进入快照（加载失败被关闭时按关闭态落盘）
}

function closeDrawer() {
  closeDocCtxMenu(); // REQ-20260909-014：关闭抽屉收起右键菜单
  state.drawer = { id: null, item: null, doc: null, navIds: null, deps: null, depsFetched: false, depFilter: '', tab: 'info', docCache: {} };
  const drawer = $('#drawer');
  if (!drawer) return;
  drawer.classList.remove('has-item');
  renderDrawerEmpty();
  $('#mask')?.classList.add('hidden');
  state.listSig = '';
  if (state.board?.initialized) renderBoard(); // 重算行选中态
  saveViewSnapshot(); // REQ-20260910-001：关闭后的空抽屉进入快照
}

// 详情空态：宽屏常驻右栏显示引导；窄屏由 has-item 控制滑出，空态不覆盖列表
function renderDrawerEmpty() {
  const drawer = $('#drawer');
  if (drawer) drawer.innerHTML = '<div class="drawer-empty muted">选择左侧列表中的条目查看详情</div>';
}

async function refreshDrawer() {
  if (!state.drawer.id) return;
  try {
    const item = await api(`/api/item/${encodeURIComponent(state.drawer.id)}`);
    state.drawer.item = item;
    const j = JSON.stringify(item);
    if (j === state.drawer.itemJson) return; // 条目没变化，不重渲染（避免打断抽屉内点击）
    state.drawer.itemJson = j;
    renderDrawer();
    if (state.drawer.doc) {
      const cur = state.drawer.doc;
      if (item.docs.includes(cur)) await loadDoc(cur, false);
      else if (state.drawer.tab === cur) {
        // REQ-20260909-006：当前页签的文档已不存在：回落基本信息，不停在打不开的文档页签
        state.drawer.doc = null;
        activateDrawerTab('info');
      } else {
        state.drawer.doc = null;
        $('#docView').innerHTML = '<p class="muted">选择上方文档查看</p>';
      }
    }
  } catch (e) {
    toast(e.message, true);
    closeDrawer();
  }
}

// 操作描述（notice）与操作按钮拆分（REQ-20260901-001 三次修订）：
// notice 独立占操作行上方整行；导航按钮只与按钮行对齐
function drawerActionsNoticeHtml(it) {
  switch (it.status) {
    case 'accepted':
      // BUG-20260908-020：删除 REQ-20260907-012 的批次进入状态分支（批次候选口径已切换为已计划单），
      // 恒为不含批次内容的移入计划 / /dev 指引
      return `<div class="notice info">未入计划。可点「移入计划」排入开发计划（开发启动后最旧优先处理），或在 ZCode 会话运行 <code>/dev ${esc(it.id)}</code> 让 Agent 直接认领。</div>`;
    case 'planned': {
      // REQ-20260908-010：已计划——等待开发启动按最旧优先处理；未进入开发中前可移出计划
      // REQ-20260913-003：去批次概念——不再显示入轮状态（对应数据源已下线）
      return `<div class="notice info">已排入开发计划，开发启动后最旧优先自动处理；未进入开发中前可「移出计划」退回已接受。</div>`;
    }
    default:
      return '';
  }
}

function drawerActionsButtonHtml(it) {
  switch (it.status) {
    case 'submitted':
      return `<button class="btn primary" data-act="accepted">✓ 接受</button>
        <button class="btn" data-rename-id="${esc(it.id)}" aria-label="编辑 ${esc(it.id)} 标题与描述" title="编辑标题与描述（仅待接受）">✎ 修改</button>
        <button class="btn danger" data-delete-id="${esc(it.id)}" aria-label="删除 ${esc(it.id)}" title="删除（仅待接受，移除整个条目目录且不可恢复）">🗑 删除</button>`;
    case 'accepted': {
      // REQ-20260908-010：移入计划（人工排期，免二次确认，对齐驳回接受交互；BUG-20260908-006 统一文案）；
      // REQ-20260907-011：驳回接受，退回待接受（免二次确认，与详情页其他操作一致）
      // REQ-20260908-020：完善中的单驳回入口禁用并提示（CLI atb status 同口径拦截）
      const refining = it.refineState === 'refining';
      return `<button class="btn" data-act="planned" data-label="移入计划">➤ 移入计划</button>
        <button class="btn warn" data-act="submitted" data-label="驳回接受（退回待接受）"${refining ? ' disabled title="完善中，待本轮 AI 分析结束后再驳回"' : ''}>↩ 驳回接受</button>`;
    }
    case 'planned':
      // REQ-20260908-010：移出计划退回已接受（免二次确认，可撤销=重新置计划）
      return `<button class="btn warn" data-act="accepted" data-label="移出计划（退回已接受）">↩ 移出计划</button>`;
    case 'in-progress':
      return `<button class="btn primary" data-act="done">✓ 确认完成</button>`;
    case 'done':
      return `<button class="btn warn" data-act="in-progress" data-label="驳回完成（退回开发）">↩ 驳回完成</button>`;
    default:
      return '';
  }
}

function renderDrawer() {
  const it = state.drawer.item;
  if (!it) return;
  closeDocCtxMenu(); // REQ-20260909-014：抽屉重渲染即收起右键菜单（菜单引用的 DOM 已重建）
  // REQ-20260909-006：页签失效（如文档被删）回落基本信息；有效页签跨轮询重渲染保持，不重置当前页签
  if (!drawerTabValid(state.drawer.tab, it)) state.drawer.tab = 'info';
  const tab = state.drawer.tab;
  const drawer = $('#drawer');
  drawer.innerHTML = `
    <header class="drawer-head">
      <div class="card-top">
        ${itemIdHtml(it.id)}
        <button class="icon-btn" id="drawerClose" title="关闭" aria-label="关闭">✕</button>
        ${testFlagHtml(it)}
      </div>
      <h2>${esc(it.title)}</h2>
    </header>
    <nav class="tabs drawer-tabs" role="tablist" aria-label="详情分页">
      <button type="button" class="tab drawer-tab${tab === 'info' ? ' active' : ''}" role="tab" aria-selected="${tab === 'info' ? 'true' : 'false'}" data-tab="info">基本信息</button>
      ${drawerDocTabs(it).map((d) => `<button type="button" class="tab drawer-tab${tab === d ? ' active' : ''}" role="tab" aria-selected="${tab === d ? 'true' : 'false'}" data-tab="${esc(d)}">${esc(DOC_LABEL[d] || d)}</button>`).join('')}
      ${HIDDEN_VIEWS.has('oncall') ? '' : `<button type="button" class="tab drawer-tab${tab === 'disc' ? ' active' : ''}" role="tab" aria-selected="${tab === 'disc' ? 'true' : 'false'}" data-tab="disc">讨论纪要</button>`}
    </nav>
    <div class="drawer-body">
      <section class="drawer-pane${tab === 'info' ? '' : ' hidden'}" data-pane="info" role="tabpanel" aria-label="基本信息">
      <section class="meta-grid">
        <div><label>状态</label><span class="state s-${it.status}">${STATE_LABEL[it.status]}</span>${it.status === 'accepted' ? refineBadgeHtml(it) : ''}</div>
        <div><label>类型</label><span>${it.type === 'requirement' ? '需求' : 'Bug'}</span></div>
        ${it.parent ? `<div><label>归属</label><span class="link" data-goto="${esc(it.parent)}">${esc(it.parent)}</span></div>` : ''}
        ${!HIDDEN_VIEWS.has('oncall') && it.sourceDiscussion ? `<div><label>来源讨论</label><span class="link" data-goto-disc="${esc(it.sourceDiscussion.id)}" title="跳转到来源讨论详情">${esc(it.sourceDiscussion.id)}</span></div>` : ''}
        <div><label>认领者</label><span>${esc(it.owner || '—')}</span></div>
        <div><label>创建</label><span>${fmtTime(it.createdAt)}</span></div>
        <div><label>更新</label><span>${fmtTime(it.updatedAt)}</span></div>
        ${it.lastReport ? `<div><label>最近报告</label><span>${fmtTime(it.lastReport.at)}${it.lastReport.coverage != null ? ` · ${it.lastReport.coverage}%` : ''}</span></div>` : ''}
        ${it.status === 'done' || (it.status === 'in-progress' && it.agentCompletedAt) // REQ-20260911-009：待测试条目同样展示提交状态
          ? `<div class="commit-status-cell-wide"><label>提交状态</label><span class="commit-status-cell">${commitBadgeHtml(it)}${commitStatusDetailHtml(it)}</span></div>` : ''}
      </section>
      ${it.agentCompletedAt && it.status !== 'done' // REQ-20260907-005：已完成界面去掉上报待确认提示
        ? `<div class="notice ok">⚑ Agent 已上报完成${it.lastReport && it.lastReport.coverage != null ? `（覆盖率 ${it.lastReport.coverage}%）` : ''}，请人工测试。</div>`
        : ''}
      ${drawerActionsNoticeHtml(it)}
      <div class="drawer-actions">
        ${drawerNavBtn('prev', drawerNeighbors().prev)}
        <div class="drawer-actions-center">
          ${drawerActionsButtonHtml(it) || '<span class="muted" style="font-size:12px">—</span>'}
          <span class="drawer-nav-pos">${drawerNeighbors().idx + 1} / ${drawerNeighbors().total}</span>
        </div>
        ${drawerNavBtn('next', drawerNeighbors().next)}
      </div>
      ${it.type === 'requirement' && it.bugs && it.bugs.length
        ? `<section>
            <h4 style="margin:4px 0 6px">下属 Bug（${it.bugCount}，未完成 ${it.openBugCount}）</h4>
            <ul class="bug-list">
              ${it.bugs.map((b) => `
                <li class="link" data-goto="${esc(b.id)}">
                  <span class="state-dot s-${b.status}"></span>
                  ${itemIdHtml(b.id)}
                  <span>${esc(b.title)}</span>
                  ${testFlagHtml(b)}
                </li>`).join('')}
            </ul>
          </section>`
        : ''}
      ${batchSettingsHtml(it)}
      </section>
      <section class="drawer-pane${tab !== 'info' && tab !== 'disc' ? '' : ' hidden'}" data-pane="doc" role="tabpanel" aria-label="文档">
        <article id="docView" class="md"><p class="muted">选择上方文档查看</p></article>
      </section>
      ${HIDDEN_VIEWS.has('oncall') ? '' : `<section class="drawer-pane${tab === 'disc' ? '' : ' hidden'}" data-pane="disc" role="tabpanel" aria-label="讨论纪要">
        ${reqDiscussionsHtml(it)}
        ${it.type === 'requirement' ? '<section id="reqDocDisc" class="req-doc-disc" aria-label="文档讨论、纪要归档与说明同步"></section>' : ''}
      </section>`}
    </div>`;

  $('#drawerClose').addEventListener('click', closeDrawer); // 唯一头部关闭出口；窄屏另有 Escape / 遮罩（BUG-20260909-007 移除冗余返回按钮）
  for (const b of drawer.querySelectorAll('[data-nav]')) {
    b.addEventListener('click', () => {
      if (!b.dataset.disabled) navDrawer(b.dataset.nav);
    });
  }
  for (const b of drawer.querySelectorAll('[data-goto]')) {
    b.addEventListener('click', () => openDrawer(b.dataset.goto));
  }
  // REQ-20260909-004：来源讨论跳回讨论模块详情（双向关联的条目侧入口）
  for (const b of drawer.querySelectorAll('[data-goto-disc]')) {
    b.addEventListener('click', () => {
      setView('oncall');
      window.ATBOncall?.openItem(b.dataset.gotoDisc);
    });
  }
  bindCopyIdButtons(drawer);
  bindRenameButtons(drawer); // REQ-20260908-011：详情页待接受编辑标题/描述
  bindDeleteButtons(drawer); // REQ-20260908-003：详情页待接受删除
  bindCommitWidgets(drawer); // BUG-20260910-014：详情页提交号复制与提交状态重试
  for (const b of drawer.querySelectorAll('[data-act]')) {
    // REQ-20260906-014：详情页按钮免二次确认，改为事后撤销（drawerAction）
    b.addEventListener('click', () => drawerAction(it.id, b.dataset.act, b.dataset.label));
  }
  // REQ-20260909-006：详情页签切换（纯前端行为；文档按需加载与缓存回填见 activateDrawerTab）
  for (const b of drawer.querySelectorAll('.drawer-tab')) {
    b.addEventListener('click', () => activateDrawerTab(b.dataset.tab));
  }
  // REQ-20260908-020：详情页完善徽标点击跳任务模块「批量完善」面板
  for (const b of drawer.querySelectorAll('[data-goto-refine]')) {
    b.addEventListener('click', () => gotoRuns('refine'));
  }
  bindBatchSettings(drawer, it);
  // REQ-20260909-013：讨论纪要页签随讨论模块暂隐藏——关联讨论刷新（/api/oncall/tickets）不发起
  if (!HIDDEN_VIEWS.has('oncall')) bindReqDiscussions(it);
  // REQ-20260909-003：需求抽屉挂载「文档讨论」区块（提示词/引用/纪要/应用；随主轮询自动检测发布）；
  // REQ-20260909-013：隐藏态不挂载（不发起 /api/req-disc 请求），机制保留待恢复
  if (!HIDDEN_VIEWS.has('oncall') && it.type === 'requirement') window.ATBReqDisc?.mount(it.id, state.project);
  syncAcceptance();
}

// REQ-20260909-006：切换详情页签。失效页签（如对应文档已删）回落基本信息；文档页签首次激活
// 经 loadDoc 加载（加载态占位），再次激活命中 docCache 直接回填不重复请求；固定文档页签缺失
// 文件时给空态提示且不发请求、不置当前文档。切换只动 DOM 显隐，不重新拉取条目。
function activateDrawerTab(tab) {
  const drawer = $('#drawer');
  closeDocCtxMenu(); // REQ-20260909-014：切换页签收起右键菜单（不执行）
  const it = state.drawer.item;
  if (!drawer || !it || !drawerTabValid(tab, it)) tab = 'info';
  state.drawer.tab = tab;
  saveViewSnapshot(); // REQ-20260910-001：详情页签进入快照（失效页签已按回落值落盘）
  for (const b of drawer.querySelectorAll('.drawer-tab')) {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  const paneKey = tab === 'info' || tab === 'disc' ? tab : 'doc';
  for (const p of drawer.querySelectorAll('.drawer-pane')) p.classList.toggle('hidden', p.dataset.pane !== paneKey);
  if (paneKey !== 'doc') return;
  const view = $('#docView');
  if (!view) return;
  if (!(it.docs || []).includes(tab)) { // 页签固定显示但文档尚未创建：空态而非请求报错
    state.drawer.doc = null;
    view.innerHTML = '<p class="muted">尚未创建，开发阶段补充。</p>';
    return;
  }
  if (state.drawer.doc === tab) return; // 已在展示：不重复请求
  const cached = state.drawer.docCache[tab];
  if (cached != null) { // 再次激活：缓存回填（linkupDocDemo / linkupDocImages 需对回填内容重新接管）
    state.drawer.doc = tab;
    view.innerHTML = cached;
    linkupDocDemo(view, state.drawer.id);
    linkupDocImages(view, state.drawer.id); // REQ-20260909-009：回填内容重新接管相对截图
    return;
  }
  view.innerHTML = '<p class="muted">加载中…</p>';
  loadDoc(tab, false);
}

/* ---------- 需求讨论（REQ-20260908-022 旧绑定记录）：只读保留，双向可见 ----------
   REQ-20260909-004 起讨论不再绑定需求（新建入口已移除，绑需求的文档讨论由 REQ-20260909-003 承接）；
   旧绑定讨论按「讨论中 / 已归档」两态口径展示，点击跳入讨论模块详情。 */

// 讨论状态徽标（两态口径；旧执行状态 pending/answering/answered/failed 归一为讨论中）
function discStatusLabel(status) {
  return status === 'archived' ? '已归档' : '讨论中';
}

function reqDiscussionsHtml(it) {
  // REQ-20260909-006：Bug 单无讨论绑定能力，「讨论纪要」页签给空态而非空白
  if (it.type !== 'requirement') return '<p class="muted">Bug 单暂不支持关联讨论；如需讨论请到「讨论」模块发起。</p>';
  return `
      <section class="req-disc">
        <div class="req-disc-head">
          <h4 style="margin:4px 0 6px">关联讨论（旧绑定记录） <span id="reqDiscCount" class="muted"></span></h4>
        </div>
        <ul class="bug-list" id="reqDiscList"><li class="muted">加载中…</li></ul>
      </section>`;
}

// 列表内容随主轮询由 refreshReqDiscussions 填充（见 poll）
function bindReqDiscussions(it) {
  refreshReqDiscussions();
}

// 拉取本需求的讨论列表并渲染（按签名去重；讨论状态变化不受 /api/board 影响，故挂主轮询独立刷新）
async function refreshReqDiscussions() {
  const id = state.drawer.id;
  const item = state.drawer.item;
  const list = $('#reqDiscList');
  if (!id || !item || item.type !== 'requirement' || !list) return;
  try {
    const res = await api(`/api/oncall/tickets?req=${encodeURIComponent(id)}`);
    if (state.drawer.id !== id) return; // 抽屉已切走，丢弃过期响应
    const sig = JSON.stringify(res.tickets);
    if (list.dataset.sig === sig) return;
    list.dataset.sig = sig;
    const count = $('#reqDiscCount');
    if (count) count.textContent = `（${res.tickets.length}）`;
    if (!res.tickets.length) {
      list.innerHTML = '<li class="muted">无关联讨论记录。新版讨论不绑定需求；就本需求文档讨论请用上方「文档讨论」区块。</li>';
      return;
    }
    list.replaceChildren(...res.tickets.map((tk) => {
      const li = document.createElement('li');
      li.className = 'link';
      li.title = '点击进入讨论详情';
      li.innerHTML = `
        <span class="cid">${esc(tk.id)}</span>
        <span style="flex:1;min-width:120px">${esc(tk.title)}</span>
        <span class="chip oc-${tk.status === 'archived' ? 'archived' : 'discussing'}">${discStatusLabel(tk.status)}</span>
        <span class="muted small">${tk.roundCount || 0} 轮 · ${fmtTime(tk.updatedAt)}</span>`;
      li.addEventListener('click', () => {
        // 跳入讨论模块并打开该讨论详情（旧绑定记录双向跳转）
        setView('oncall');
        window.ATBOncall?.openItem(tk.id);
      });
      return li;
    }));
  } catch { /* 静默重试：随主轮询 2 秒后再拉 */ }
}

async function loadDoc(name, setActive) {
  if (!state.drawer.id) return;
  try {
    const res = await api(`/api/item/${encodeURIComponent(state.drawer.id)}/doc/${encodeURIComponent(name)}`);
    state.drawer.doc = name;
    let html = renderMd(res.content);
    const view = $('#docView');
    if (view) view.innerHTML = renderMd(res.content);
    linkupDocDemo(view, state.drawer.id); // BUG-20260908-021：接管相对 .html 演示链接（防站点根 404）
    linkupDocImages(view, state.drawer.id); // REQ-20260909-009：接管相对截图引用（防站点根 404 + 点击放大）
    // REQ-20260909-014：渲染后为顶层块标注源行（右键「讨论」引用映射）；缓存取标注后的 HTML，回填保留标注
    if (view) {
      if (name === 'licenses.md') decorateLicensesDoc(view); // REQ-20260909-015：开源许可警示在写缓存前处理，缓存回填自带标识
      annotateDocLines(view, res.content);
      html = view.innerHTML;
    }
    state.drawer.docCache[name] = html; // REQ-20260909-006：缓存渲染结果，页签再次激活不重复请求
    if (setActive) activateDrawerTab(name); // REQ-20260909-006：搜索命中等入口切到对应文档页签
  } catch (e) {
    toast(e.message, true);
  }
}

/* ---------- 开源许可页签展示层警示（REQ-20260909-015） ----------
   licenses.md 表格按 License 列（表头含 license / 许可）逐行标注：禁用名单（GPL / LGPL / AGPL / SSPL 等
   强传染许可）行尾红标「禁止引入，请替换」；白名单（MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC /
   0BSD / Unlicense）无警示；白名单外未知 / 待裁定许可（如 MPL-2.0）黄标「待确认」。纯展示层提示，不做
   合规硬校验、不阻塞阅读；无 License 列的表格整表跳过，不误标。 */

const OSS_LICENSE_WHITELIST = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Unlicense'];
const OSS_LICENSE_BANNED_RE = /\b(?:AGPL|LGPL|GPL|SSPL)\b/i;
function decorateLicensesDoc(view) {
  if (!view) return;
  for (const table of view.querySelectorAll('table')) {
    const rows = [...table.querySelectorAll('tr')];
    if (!rows.length) continue;
    const heads = [...rows[0].querySelectorAll('th')].map((th) => th.textContent.trim());
    const licCol = heads.findIndex((h) => /licen[cs]e|许可/i.test(h));
    if (licCol < 0) continue;
    for (const tr of rows.slice(1)) {
      const cells = [...tr.querySelectorAll('td')];
      const licCell = cells[licCol];
      const lic = String(licCell?.textContent || '').trim();
      if (!lic) continue;
      let cls = '', text = '';
      if (OSS_LICENSE_BANNED_RE.test(lic)) {
        cls = 'lic-flag lic-banned';
        text = '禁止引入，请替换';
      } else if (!OSS_LICENSE_WHITELIST.some((w) => new RegExp(`(?:^|[^\\w.-])${w}(?:[^\\w.-]|$)`, 'i').test(lic))) {
        cls = 'lic-flag lic-unknown';
        text = '待确认';
      }
      if (!cls) continue;
      const flag = document.createElement('span');
      flag.className = cls;
      flag.textContent = text;
      (cells[cells.length - 1] || licCell).appendChild(flag);
    }
  }
}

/* ---------- 文档页签右键「讨论」轻量引用入口（REQ-20260909-014，纯前端剪贴板） ----------
   说明/设计/测试用例页签是渲染态展示、无视觉行号；loadDoc 渲染后为 #docView 顶层块标注源行
   （data-doc-start/end/kind），右键菜单「讨论」据此把「所选文字（或右键落点）+ 文档路径 + 源码
   行号」复制到剪贴板，用户粘贴到任意 Agent 会话即可讨论。免流程口径：不生成讨论编号、不保存
   引用快照、不写任何记录（成套讨论仍走 REQ-20260909-003「文档讨论」区块，两者并存互不影响）。
   行号映射沿用 req-disc.js parseBlocks 的 1 基源码行口径；为保证与 marked 渲染顶层节点 1:1
   配对，本副本对列表/引用块做了两处吸收增强（跨空行合并同类行、吸收缩进续行/嵌套栅栏）。 */

// 行种类判定（同 req-disc kindOfLine 口径）
function docKindOfLine(l) {
  if (/^\s*(```|~~~)/.test(l)) return 'fence';
  if (/^#{1,6}\s+\S/.test(l)) return 'heading';
  if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) return 'list';
  if (/^>/.test(l)) return 'quote';
  if (/^\s*\|.*\|/.test(l)) return 'table';
  if (/^(---|\*\*\*|___)\s*$/.test(l)) return 'hr';
  if (/^<\/?\w+/.test(String(l).trim())) return 'html';
  return 'para';
}

// 1 基源行块解析（适配自 req-disc parseBlocks，为与 marked 顶层节点 1:1 配对做了 CommonMark 化增强：
// 松散列表跨空行合并、缩进续行/嵌套栅栏并入、段后未缩进懒续行并入、围栏按开栏记号长度收束、
// 引用跨空行分块、异族列表相邻分块。返回 {kind, start, end, text}，start/end 为 1 基闭区间）
function parseDocBlocks(md) {
  const lines = String(md ?? '').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue; }
    const start = i; // 0 基
    const kind = docKindOfLine(lines[i]);
    if (kind === 'fence') {
      const open = /^\s*(`{3,}|~{3,})/.exec(lines[i])[1];
      i++;
      while (i < lines.length) {
        const cl = /^\s*(`{3,}|~{3,})\s*$/.exec(lines[i]);
        if (cl && cl[1][0] === open[0] && cl[1].length >= open.length) { i++; break; } // 同字符且不短于开栏记号
        i++;
      }
      blocks.push({ kind, start: start + 1, end: i, text: lines.slice(start, i).join('\n') });
      continue;
    }
    if (kind === 'heading' || kind === 'hr') {
      blocks.push({ kind, start: start + 1, end: start + 1, text: lines[start] });
      i++;
      continue;
    }
    if (kind === 'list' || kind === 'quote') {
      const fam = (l) => (/^\s*\d+[.)]\s/.test(l) ? 'ol' : 'ul'); // 列表族（有序/无序）
      const family = fam(lines[start]);
      let last = lines[start]; // 上一吸收行：懒续行只跟在段文本后，不跟在围栏收束行后
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          // 空行前瞻：松散列表跨空行合并同类同族行/缩进续行；引用跨空行即分块（marked 同口径）
          if (kind === 'quote') break;
          let j = i;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && ((docKindOfLine(lines[j]) === 'list' && fam(lines[j]) === family) || /^\s+\S/.test(lines[j]))) { i = j; last = lines[j - 1]; continue; }
          break;
        }
        const lk = docKindOfLine(l);
        if (/^\s+\S/.test(l)) { i++; last = l; continue; } // 缩进续行（含嵌套栅栏/子列表）
        if (lk === kind && fam(l) === family) { i++; last = l; continue; } // 同族同类行
        if (lk === 'para' && last.trim() && docKindOfLine(last) !== 'fence') { i++; last = l; continue; } // 懒续行
        break; // 其余（异族列表/标题/围栏/表格等）：顶层新块
      }
      blocks.push({ kind, start: start + 1, end: i, text: lines.slice(start, i).join('\n') });
      continue;
    }
    // para / table / html：连续同类非空行合并
    i++;
    while (i < lines.length && lines[i].trim() && docKindOfLine(lines[i]) === kind) i++;
    blocks.push({ kind, start: start + 1, end: i, text: lines.slice(start, i).join('\n') });
  }
  return blocks;
}

// 配对校验：渲染元素文本应是块源文本（仅留字母数字后）的子序列——marked 只删改标记不改字符顺序
function docBlockMatches(elText, blockText) {
  const hay = String(blockText ?? '').replace(/[^\p{L}\p{N}]/gu, '');
  const needle = String(elText ?? '').replace(/[^\p{L}\p{N}]/gu, '');
  if (!needle) return true; // hr 等无文本元素
  let k = 0;
  for (const ch of hay) {
    if (ch === needle[k] && ++k >= needle.length) return true;
  }
  return false;
}

// 渲染后标注：#docView 顶层元素与块按序 1:1 配对写 data-doc-*。一旦失准立即停止——失准区域
// 右键不弹菜单（宁缺勿错，绝不给错行号）
function annotateDocLines(view, md) {
  if (!view) return;
  const blocks = parseDocBlocks(md);
  const tops = [...view.children];
  let bi = 0;
  for (const el of tops) {
    if (bi >= blocks.length) break;
    if (!docBlockMatches(el.textContent, blocks[bi].text)) break;
    el.dataset.docStart = String(blocks[bi].start);
    el.dataset.docEnd = String(blocks[bi].end);
    el.dataset.docKind = blocks[bi].kind;
    bi++;
  }
}

// 块内选文 → 精确行（同 req-disc onReaderSelect 口径：段落/围栏按换行计数；富文本回退整块范围）
function docSelLines(blockStart, blockEnd, kind, beforeText, selText) {
  if (kind !== 'para' && kind !== 'fence') return { start: blockStart, end: blockEnd };
  const off = kind === 'fence' ? 1 : 0; // 围栏渲染文本不含首行 ``` 围栏
  const start = blockStart + off + beforeText.split('\n').length - 1;
  const end = Math.min(blockEnd - off, start + selText.split('\n').length - 1);
  return { start, end };
}

// 选文节点 → 所在已标注块元素（选区端点常是文本节点，需上溯其元素）
function docBlockElFromNode(node, view) {
  const el = node && node.nodeType === 3 ? node.parentElement : node;
  if (!el || !el.closest || !view.contains(el)) return null;
  return el.closest('[data-doc-start]');
}

// 选区 → 源行映射：两端都落在已标注块内才可用；单块段落/代码内精确到行，跨块/富文本取覆盖范围
function resolveDocSelection(sel, view) {
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const sEl = docBlockElFromNode(range.startContainer, view);
  const eEl = docBlockElFromNode(range.endContainer, view);
  if (!sEl || !eEl) return null; // 选区越出文档区或落在未标注内容：交回落点模式
  const text = sel.toString();
  if (!text.trim()) return null;
  const kind = sEl.dataset.docKind;
  if (sEl === eEl && (kind === 'para' || kind === 'fence')) {
    const before = range.cloneRange();
    before.selectNodeContents(sEl);
    before.setEnd(range.startContainer, range.startOffset);
    return { ...docSelLines(Number(sEl.dataset.docStart), Number(sEl.dataset.docEnd), kind, before.toString(), text), text };
  }
  return { // 跨块或列表/表格等富文本：可确定的行范围（整块覆盖）
    start: Math.min(Number(sEl.dataset.docStart), Number(eEl.dataset.docStart)),
    end: Math.max(Number(sEl.dataset.docEnd), Number(eEl.dataset.docEnd)),
    text,
  };
}

// 文档磁盘路径（BUG-20260913-003：按条目类型 / 归属拼装真实磁盘位置，口径同 core.mjs resolveItemDir——
// 需求 requirements/<单号>/；独立 Bug bugs/<编号>/；归属需求的 Bug requirements/<REQ>/bugs/<编号>/）
function docRefPath(projectRoot, itemId, name, parent = null) {
  let rel;
  if (itemId.startsWith('REQ-')) {
    rel = `docs/agent-team-board/requirements/${itemId}/${name}`;
  } else if (parent) {
    rel = `docs/agent-team-board/requirements/${parent}/bugs/${itemId}/${name}`;
  } else {
    rel = `docs/agent-team-board/bugs/${itemId}/${name}`;
  }
  return projectRoot ? `${projectRoot}/${rel}` : rel;
}

// 组装剪贴板文本：自包含（分区标记+单号+文档名+行范围+路径[+原文]），Agent 不打开看板也能定位；
// REQ-20260914-004 追加「讨论要求」：改文件同轮同步 commit、message 含单号+问题摘要+回答摘要、
// 回显本轮 commit log 与 commit 号（约定层面，看板不校验执行结果）；
// BUG-20260914-019 末尾恰追加一个换行：用户粘贴后光标已在新行，随后输入的问题与提示词明确分行
function buildDocRef({ id, name, path, start, end, text }) {
  const lines = [
    '【文档讨论引用】',
    `${id} / ${name} ${start === end ? `第 ${start} 行` : `第 ${start}–${end} 行`}`,
    `文档：${path}`,
  ];
  if (text != null && text !== '') lines.push('原文：', text);
  lines.push(
    '',
    '【讨论要求】请在本轮及后续讨论中遵守：',
    '1. 围绕上方引用（文档路径 + 源码行范围）展开讨论与修改。',
    '2. 每轮回答中如需修改相关文件：修改完成后同轮同步执行 git commit，不留未提交改动。',
    `3. commit message 须包含：条目单号（如 ${id}）、本轮用户问题摘要、本轮回答（改动）摘要。`,
    '4. 每轮回答回显本轮 commit log 与 commit 号（短哈希即可）。',
  );
  return lines.join('\n') + '\n';
}

let docCtxMenuEl = null;      // 菜单浮层单例
let docCtxMenuInfo = null;    // 打开时的引用快照（点击时使用，防点击清除文档选区丢内容）
let docCtxMenuCleanup = null; // 打开期间注册的临时监听清理函数

function closeDocCtxMenu() {
  if (docCtxMenuCleanup) { docCtxMenuCleanup(); docCtxMenuCleanup = null; }
  docCtxMenuEl?.remove();
  docCtxMenuEl = null;
  docCtxMenuInfo = null;
}

function openDocCtxMenu(x, y, info) {
  // 单例：再次右键先关旧菜单，位置跟随更新
  closeDocCtxMenu();
  docCtxMenuInfo = info;
  const menu = document.createElement('div');
  menu.className = 'doc-ctx-menu';
  menu.setAttribute('role', 'menu');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'doc-ctx-item';
  btn.setAttribute('role', 'menuitem');
  btn.textContent = '💬 讨论';
  btn.addEventListener('click', onDocCtxDiscuss);
  menu.appendChild(btn);
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${x + r.width > window.innerWidth ? Math.max(8, x - r.width) : x}px`; // 视口右缘内收
  menu.style.top = `${y + r.height > window.innerHeight ? Math.max(8, y - r.height) : y}px`; // 视口下缘内收
  docCtxMenuEl = menu;
  // 收起通道：点外部 / Esc / 任意滚动（含文档区滚动）/ 视口变化——关闭且不执行；不阻止滚动与选择
  const onDown = (e) => { if (!docCtxMenuEl?.contains(e.target)) closeDocCtxMenu(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDocCtxMenu(); }
  };
  const onScroll = () => closeDocCtxMenu();
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);
  docCtxMenuCleanup = () => {
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onScroll);
  };
}

async function onDocCtxDiscuss() {
  const info = docCtxMenuInfo;
  closeDocCtxMenu();
  if (!info) return;
  const ok = await copyPlain(info.text);
  if (ok) toast(`已复制 引用：${info.name} ${info.rangeLabel}`);
  else {
    toast('自动复制失败，请在弹出的文本框中手动复制', true);
    uiCopyBox('手动复制讨论引用', info.text);
  }
}

// 文档级 contextmenu 委托（绑定一次，见文件底部全局绑定区）：仅需求抽屉文档页签内容区且当前
// 文档已就绪时拦截弹菜单；链接/图片与文档区外一律放行浏览器原生右键
function onDocCtxMenu(e) {
  const view = $('#docView');
  if (!view || !e.target || typeof e.target.closest !== 'function' || !view.contains(e.target)) return;
  const dtype = state.drawer.item?.type;
  if (dtype !== 'requirement' && dtype !== 'bug') return; // 需求/Bug 详情抽屉启用（BUG-20260913-003：Bug 单同口径），讨论等其余类型不启用
  if (e.target.closest('a, img')) return; // 链接/图片：放行原生菜单（复制链接/存图保留）
  const name = state.drawer.doc;
  if (!name || state.drawer.tab !== name) return; // 未创建/加载中/加载失败态：不弹菜单
  const selInfo = resolveDocSelection(window.getSelection(), view);
  const pointEl = e.target.closest('[data-doc-start]');
  let ref = null;
  if (selInfo) ref = selInfo; // 有选中：所选文字 + 对应源行（范围）
  else if (pointEl) ref = { start: Number(pointEl.dataset.docStart), end: Number(pointEl.dataset.docEnd), text: null }; // 无选中：落点块行范围
  if (!ref) return; // 落点未标注（占位/配对失准区）：放行原生
  const path = docRefPath(state.project, state.drawer.id, name, state.drawer.item?.parent || null);
  e.preventDefault();
  openDocCtxMenu(e.clientX, e.clientY, {
    name,
    rangeLabel: ref.start === ref.end ? `第 ${ref.start} 行` : `第 ${ref.start}–${ref.end} 行`,
    text: buildDocRef({ id: state.drawer.id, name, path, start: ref.start, end: ref.end, text: ref.text }),
  });
}

// 页内自绘手动复制引导（自绘原因同 uiConfirm：IAB 内同步 window.prompt 会冻结页面）
function uiCopyBox(title, text) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-wrap confirm-wrap';
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  const close = () => {
    window.removeEventListener('keydown', onKey, true);
    overlay.remove();
  };
  const box = document.createElement('div');
  box.className = 'modal confirm-box';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  const head = document.createElement('div');
  head.className = 'confirm-title';
  head.textContent = title;
  box.appendChild(head);
  const area = document.createElement('textarea');
  area.rows = 8;
  area.readOnly = true;
  area.value = text;
  area.style.cssText = 'width:100%;box-sizing:border-box;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical'; // 等宽便于核对行号
  box.appendChild(area);
  const foot = document.createElement('div');
  foot.className = 'modal-foot';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn primary';
  btn.textContent = '关闭';
  btn.addEventListener('click', close);
  foot.appendChild(btn);
  box.appendChild(foot);
  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  window.addEventListener('keydown', onKey, true);
  area.focus();
  area.select(); // 全选便于直接 Ctrl/⌘+C
}

/* ---------- 统一新建弹窗（REQ-20260907-004：需求 / Bug / 讨论三类同一表单；
   REQ-20260909-004：讨论改为标题 + 背景（可选）；REQ-20260910-028：讨论同口径支持截图） ---------- */

/* REQ-20260909-009：新建需求 / Bug 的描述支持截图（REQ-20260910-028 起讨论同口径开放，
   推翻 REQ-20260909-004「讨论不回加」旧口径）。
   添加入口：文件选择（accept 图片、多选）+ 弹窗打开期间粘贴剪贴板图片（自动命名）。
   本地即时校验仅是体验优化（白名单 / 单张 8MB / 张数上限），服务端在 /api/new、/api/discussion
   二次校验兜底；校验口径与服务端 core（ATTACHMENT_IMAGE_MIME / ATTACHMENT_MAX_BYTES / ITEM_ATTACHMENTS_MAX）对齐。 */

const SHOT_MAX_COUNT = 9;               // 张数上限（design.md 定稿：README 建议 ≤9）
const SHOT_MAX_BYTES = 8 * 1024 * 1024; // 单张上限，与 core.ATTACHMENT_MAX_BYTES / /api/fs/raw 一致
const SHOT_IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'];
const SHOT_MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/bmp': 'bmp', 'image/avif': 'avif',
};
let newShots = [];   // { name, size, dataUrl, base64 }：dataUrl 供缩略图，base64 随创建提交
let shotBusy = false; // 创建提交中禁用添加 / 移除入口（防竞态，与提交按钮禁用同步）

function shotExtOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : '';
}

// 粘贴的剪贴板图片自动命名：paste-<毫秒时间戳>.<后缀>（MIME 推断，未知兜底 png；无路径、白名单后缀）
function shotPasteName(file) {
  const fromName = shotExtOf(file.name);
  const ext = SHOT_IMAGE_EXT.includes(fromName)
    ? fromName
    : (SHOT_MIME_EXT[String(file.type || '').toLowerCase()] || 'png');
  return `paste-${Date.now()}.${ext}`;
}

function shotError(msg) {
  const el = $('#fShotError');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
}

function shotSizeText(n) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
}

// 本地即时校验：返回错误文案或 null；不合法的项不进入缩略图列表，单张失败不影响其余
function shotValidate(name, size) {
  if (!SHOT_IMAGE_EXT.includes(shotExtOf(name))) return `仅支持 ${SHOT_IMAGE_EXT.join(' / ')}：${name}`;
  if (size > SHOT_MAX_BYTES) return `截图 ${(size / 1024 / 1024).toFixed(1)}MB 超过 8MB 上限（${name}）`;
  if (newShots.length >= SHOT_MAX_COUNT) return `截图最多 ${SHOT_MAX_COUNT} 张，已达上限`;
  return null;
}

// 就地校验 + 入列 + 重渲染（dataUrl 已由 FileReader 读好，缩略图与提交共用一次读取）
function shotAddFile(shot) {
  const err = shotValidate(shot.name, shot.size);
  if (err) {
    shotError(err);
    return false;
  }
  const dataUrl = String(shot.dataUrl || '');
  const comma = dataUrl.indexOf(',');
  newShots.push({
    name: String(shot.name),
    size: Number(shot.size) || 0,
    dataUrl,
    base64: comma >= 0 ? dataUrl.slice(comma + 1) : '',
  });
  shotError('');
  renderShots();
  return true;
}

// 读文件为 dataURL 后入列（文件选择与粘贴共用；nameOverride 供粘贴自动命名）
function addShotFile(file, nameOverride) {
  return new Promise((resolve) => {
    const name = nameOverride || file.name;
    const reader = new FileReader();
    reader.onload = () => resolve(shotAddFile({ name, size: file.size, dataUrl: String(reader.result || '') }));
    reader.onerror = () => {
      shotError(`读取 ${name} 失败，请重试`);
      resolve(false);
    };
    reader.readAsDataURL(file);
  });
}

function shotRemove(i) {
  if (shotBusy) return; // 创建提交中禁止移除（防竞态）
  newShots.splice(i, 1);
  renderShots();
}

function renderShots() {
  const count = $('#fShotCount');
  if (count) count.textContent = `${newShots.length} / ${SHOT_MAX_COUNT}`;
  const empty = $('#fShotEmpty');
  if (empty) empty.classList.toggle('hidden', newShots.length > 0);
  const list = $('#fShotList');
  if (!list) return;
  list.classList.toggle('hidden', newShots.length === 0);
  // REQ-20260910-017：缩略图带「查看大图」入口（type=button 不提交表单）与双击提示；
  // 无截图时列表整体隐藏，不渲染预览入口
  list.innerHTML = newShots.map((s, i) => `
      <div class="shot-item" data-shot-i="${i}" title="${esc(s.name)} · 双击查看大图">
        <img src="${s.dataUrl}" alt="${esc(s.name)}">
        <span class="shot-meta">${esc(s.name)} · ${shotSizeText(s.size)}</span>
        <button type="button" class="shot-view" data-shot-view="${i}" aria-label="查看大图 ${esc(s.name)}">查看大图</button>
        <button type="button" class="shot-x" data-shot-i="${i}" aria-label="移除 ${esc(s.name)}"${shotBusy ? ' disabled' : ''}>✕</button>
      </div>`).join('');
  const pick = $('#fShotPick');
  if (pick) pick.disabled = shotBusy || newShots.length >= SHOT_MAX_COUNT; // 达上限禁用入口（粘贴路径仍有提示兜底）
  for (const b of list.querySelectorAll('.shot-x')) {
    b.addEventListener('click', () => shotRemove(Number(b.dataset.shotI)));
  }
  // REQ-20260910-017：双击缩略图查看大图（键盘路径走「查看大图」按钮）；
  // 双击落在移除 / 查看按钮上不触发（按钮有自己的单击行为）
  for (const item of list.querySelectorAll('.shot-item')) {
    item.addEventListener('dblclick', (e) => {
      if (e.target && e.target.closest && e.target.closest('.shot-x, .shot-view')) return;
      shotPreviewShow(Number(item.dataset.shotI), item.querySelector('.shot-view'));
    });
  }
  for (const b of list.querySelectorAll('.shot-view')) {
    b.addEventListener('click', () => shotPreviewShow(Number(b.dataset.shotView), b));
  }
}

/* ---------- REQ-20260910-017 新建表单截图双击放大预览 ---------- */

// 只查看本次表单已添加的截图（newShots 的 dataUrl），不创建条目、不新增附件、不改顺序；
// 预览层 #shotPreview 常驻 index.html，覆盖在新建侧拉面板之上（style.css z-index 35 > 25）。
// idx：当前预览的 newShots 下标；token：打开 / 关闭 / 重试时递增，使迟到的 load / error
// 回调失效（关闭或切换图片后不再被旧结果显示）；opener：触发入口（关闭后恢复焦点）。
const shotPreview = { idx: -1, token: 0, opener: null };

function shotPreviewOpen() {
  const el = $('#shotPreview');
  return !!el && !el.classList.contains('hidden');
}

// 打开第 i 张：先渲染「图片加载中」（图片隐藏挂载，load 后显示），失败换失败态（重试仅重载）
function shotPreviewShow(i, opener) {
  const shot = newShots[i];
  const box = $('#shotPreview');
  if (!shot || !box) return;
  shotPreview.idx = i;
  if (opener) shotPreview.opener = opener; // 重试路径不传：保留首次打开的触发入口
  const token = ++shotPreview.token; // 旧预览的迟到加载结果自此全部失效
  $('#shotPreviewName').textContent = shot.name;
  const body = $('#shotPreviewBody');
  const img = document.createElement('img');
  img.alt = `放大查看 ${shot.name}`;
  img.classList.add('hidden'); // 解码完成前不显示，先出「图片加载中」
  img.src = shot.dataUrl;
  const tip = document.createElement('p');
  tip.className = 'shot-preview-msg';
  tip.textContent = '图片加载中…';
  body.replaceChildren(img, tip);
  box.classList.remove('hidden');
  window.addEventListener?.('keydown', onShotPreviewKey, true); // Esc / Tab 捕获（对齐 uiConfirm 先例）
  $('#shotPreviewClose').focus(); // 焦点进入预览（关闭按钮即首个可达控件）
  img.addEventListener('load', () => {
    if (token !== shotPreview.token) return; // 迟到结果忽略：已关闭 / 已切换 / 已重试
    img.classList.remove('hidden');
    body.replaceChildren(img);
  });
  img.addEventListener('error', () => {
    if (token !== shotPreview.token) return;
    const err = document.createElement('p');
    err.className = 'shot-preview-msg shot-preview-err';
    err.textContent = `图片无法加载：${shot.name}`;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn small';
    retry.textContent = '重试';
    retry.addEventListener('click', () => shotPreviewShow(shotPreview.idx)); // 仅重载当前图，不新增附件
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn small';
    close.textContent = '关闭';
    close.addEventListener('click', () => shotPreviewClose());
    body.replaceChildren(err, retry, close);
  });
}

// 关闭预览：只关一层（新建面板保持），恢复触发点焦点；restoreFocus=false 供退出整个表单时
// 由 closeModal / openModal 走各自焦点口径
function shotPreviewClose({ restoreFocus = true } = {}) {
  const box = $('#shotPreview');
  if (!box || box.classList.contains('hidden')) return; // 幂等：未开不做事
  box.classList.add('hidden');
  shotPreview.token++; // 在途加载结果全部失效
  shotPreview.idx = -1;
  const body = $('#shotPreviewBody');
  if (body) body.replaceChildren(); // 不遗留上一张大图
  window.removeEventListener?.('keydown', onShotPreviewKey, true);
  const opener = shotPreview.opener;
  shotPreview.opener = null;
  if (restoreFocus && opener && opener.isConnected) opener.focus(); // 关闭后回到触发入口
}

// 预览打开期间 Esc / Tab 的窗口捕获处理：Esc 只关预览（stopPropagation 不外溢关闭背景新建
// 面板——一次只关一层），Tab 圈定在预览内循环不落背景表单
function onShotPreviewKey(e) {
  if (!shotPreviewOpen()) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    shotPreviewClose();
    return;
  }
  if (e.key === 'Tab') trapShotPreviewFocus(e);
}

// Tab / Shift+Tab 在预览内首末回绕（对齐快捷键帮助面板圈定先例；仅关闭与失败态按钮可达）
function trapShotPreviewFocus(e) {
  if (e.key !== 'Tab') return;
  const panel = $('#shotPreview');
  const focusables = [...panel.querySelectorAll('button')]
    .filter((el) => !el.disabled && !el.closest('.hidden'));
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  const inPanel = focusables.includes(active);
  if (e.shiftKey) {
    if (!inPanel || active === first) { e.preventDefault(); last.focus(); }
  } else if (!inPanel || active === last) {
    e.preventDefault(); first.focus();
  }
}

// 按类型切换字段：讨论显示背景（可选）标签（REQ-20260909-004：无关联需求；
// Bug 一律独立，不再有归属下拉 REQ-20260908-009）；「创建并接受」仅需求 / Bug 显示
// （REQ-20260910-015：讨论无接受概念）。REQ-20260910-028：截图区块三类类型统一显示
// （推翻 REQ-20260909-004「讨论不回加」旧口径——讨论已改为外部 Agent 会话自由讨论，截图有用）。
function syncNewFormFields() {
  const type = $('#fType').value;
  const label = $('#fDescLabel');
  const desc = $('#fDesc');
  const acceptBtn = $('#fSubmitAccept');
  if (acceptBtn) acceptBtn.classList.toggle('hidden', type === 'ask');
  if (type === 'ask') {
    // 背景（可选）：讨论在 Agent 外部会话进行，看板保存标题、背景与截图（REQ-20260910-028）
    label.textContent = '背景（可选）';
    desc.placeholder = '填写讨论背景，不需要关联需求；留空也可创建';
  } else {
    label.textContent = '描述';
    desc.placeholder = '验收标准、现象与复现步骤等（可留空，后续补充）';
  }
}

function openModal(type) {
  const b = state.board;
  if (!b || !b.initialized) {
    toast('请先初始化看板', true);
    return;
  }
  // REQ-20260910-014：已打开时幂等守卫（重复点击不叠加面板、不重置已填内容）
  if (!$('#modalWrap').classList.contains('hidden')) return;
  $('#fType').value = type === 'bug' || type === 'ask' ? type : 'req';
  $('#fTitle').value = '';
  $('#fDesc').value = '';
  newShots = [];        // REQ-20260909-009：重新打开弹窗清空上次截图（对齐标题 / 描述重置口径）
  shotBusy = false;
  shotError('');
  shotPreviewClose({ restoreFocus: false }); // REQ-20260910-017：重开面板不遗留预览遮罩（随后焦点进标题框）
  renderShots();
  syncNewFormFields();
  const submit = $('#fSubmit');
  submit.disabled = false;
  submit.textContent = '创建';
  const acceptBtn = $('#fSubmitAccept'); // REQ-20260910-015：重开弹窗同步重置「创建并接受」按钮
  if (acceptBtn) {
    acceptBtn.disabled = false;
    acceptBtn.textContent = '创建并接受';
  }
  $('#modalWrap').classList.remove('hidden');
  $('#btnNew')?.setAttribute('aria-expanded', 'true'); // REQ-20260910-014：入口开合联动
  $('#fTitle').focus(); // 焦点进入面板首控件（沿弹窗先例：标题输入框）
}

function closeModal({ focus = true } = {}) {
  shotPreviewClose({ restoreFocus: false }); // REQ-20260910-017：退出整个新建表单同步清理预览遮罩
  $('#modalWrap').classList.add('hidden');
  $('#btnNew')?.setAttribute('aria-expanded', 'false'); // REQ-20260910-014：入口开合联动
  if (focus) $('#btnNew')?.focus?.(); // 焦点返回入口
}

// BUG-20260909-010：带截图创建前预检条目附件端点，收敛「新前端 + 旧常驻服务」版本错配下的
// 静默丢数据——旧进程不认识 /api/new 请求体里的 attachments 字段（JSON 多余字段被忽略后仍按
// 旧口径创建返回 201，截图无痕丢失、README 无引用行、无任何报错）。预检判定口径对齐
// BUG-20260909-005 演示链接预检：GET 条目附件端点命中「未知接口：」JSON 404 = 该路由不存在
// = 服务进程早于截图功能（REQ-20260909-009）上线，此时拒绝提交并给 atb serve 自愈指引。
// 只做「确定过旧」的保守拦截：2xx / 新进程对占位条目的 400 业务错误 / 网络异常一律放行，
// 交由真正的创建请求成败说话（预检本身不创建任何数据，占位编号走不存在分支即止）。
async function shotServeSupportsAttachments() {
  try {
    const r = await fetch(apiUrl('/api/item/REQ-20990101-999/attachment/probe.png'));
    if (r.ok) return true;
    const j = await r.json().catch(() => ({}));
    return !(typeof j.error === 'string' && j.error.startsWith('未知接口：'));
  } catch {
    return true; // 预检网络异常等：放行，不放大误伤面
  }
}

// REQ-20260910-028：带截图创建讨论前的同口径预检——旧服务进程的 POST /api/discussion 不读
// attachments 字段（JSON 多余字段被忽略后仍按旧口径 200 创建，截图无痕丢失）。预检探针为
// GET /api/discussion/<占位编号>/attachment/probe.png：该路由随本需求上线，旧进程返回路由兜底
// 404「未知接口」；新进程对占位编号必返回 400 类业务错误。判定与保守拦截口径对齐
// BUG-20260909-010（shotServeSupportsAttachments）：2xx / 业务 4xx / 网络异常一律放行。
async function discussionServeSupportsAttachments() {
  try {
    const r = await fetch(apiUrl('/api/discussion/ASK-20990101-999/attachment/probe.png'));
    if (r.ok) return true;
    const j = await r.json().catch(() => ({}));
    return !(typeof j.error === 'string' && j.error.startsWith('未知接口：'));
  } catch {
    return true; // 预检网络异常等：放行，不放大误伤面
  }
}

// REQ-20260910-015：accept=true 走「创建并接受」——同一次操作直达 accepted（与分步接受等价）；
// 与普通创建共用标题校验、截图预检、防重复提交与失败保留口径（仅请求体多 accept 标记、toast 文案不同）
async function submitNew(e, { accept = false } = {}) {
  e.preventDefault();
  const btn = $('#fSubmit');
  if (btn.disabled || $('#fSubmitAccept')?.disabled) return; // 提交中防重复（REQ-20260907-004）
  const type = $('#fType').value;
  const title = $('#fTitle').value.trim();
  const desc = $('#fDesc').value.trim();
  if (!title) {
    toast('标题不能为空', true);
    return;
  }
  btn.disabled = true;
  btn.textContent = '创建中…';
  const acceptBtn = $('#fSubmitAccept'); // REQ-20260910-015：两按钮同步进入在途态（防重复互斥）
  if (acceptBtn) {
    acceptBtn.disabled = true;
    acceptBtn.textContent = '创建中…';
  }
  shotBusy = true; // 创建中禁用截图添加 / 移除入口（防竞态）
  renderShots();
  try {
    if (type === 'ask') {
      // 开放式讨论（REQ-20260909-004）：走 /api/discussion 创建（独立 ASK 序列，两态：讨论中/已归档），
      // 保存后进入讨论模块定位新讨论并直接展示启动提示词（复制到 Agent 新会话）。
      // REQ-20260910-028：讨论与需求 / Bug 同口径支持截图——带截图先预检讨论附件端点（过旧服务
      // 拒绝提交保留弹窗与附件，不静默丢截图）；无截图不预检，兼容早于本功能的服务。
      if (newShots.length) {
        const served = await discussionServeSupportsAttachments();
        if (!served) {
          toast('创建失败：看板服务版本过旧，提交会丢弃截图。请在终端运行 atb serve 自动重启过旧服务，然后重试', true);
          return;
        }
      }
      const res = await api('/api/discussion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          background: desc,
          // REQ-20260910-028：截图随创建一次提交（形态与 /api/new 一致，按添加顺序）
          ...(newShots.length ? { attachments: newShots.map((s) => ({ name: s.name, dataBase64: s.base64 })) } : {}),
        }),
      });
      closeModal();
      toast(`✓ 已创建 ${res.discussion.id}（讨论中，无关联需求），请复制启动提示词到 Agent 新会话`);
      setView('oncall');
      await window.ATBOncall?.reveal(res.discussion.id); // 刷新列表并定位新讨论 + 启动提示词
    } else {
      // BUG-20260909-010：带截图先预检服务能力，过旧服务拒绝提交（保留弹窗与附件供重启后重试），
      // 不再静默丢数据；无截图走旧口径创建，不预检（兼容早于截图功能的服务）。
      if (newShots.length) {
        const served = await shotServeSupportsAttachments();
        if (!served) {
          toast('创建失败：看板服务版本过旧，提交会丢弃截图。请在终端运行 atb serve 自动重启过旧服务，然后重试', true);
          return;
        }
      }
      const st = await api('/api/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title,
          description: desc,
          // REQ-20260910-015：创建并接受标记（仅 accept 路径携带；普通创建不带字段、服务端缺省 submitted）
          ...(accept ? { accept: true } : {}),
          // REQ-20260909-009：截图与标题 / 描述一次提交（形态沿用讨论单 dataBase64，按添加顺序）
          attachments: newShots.map((s) => ({ name: s.name, dataBase64: s.base64 })),
        }),
      });
      closeModal();
      toast(accept ? `✓ 已创建 ${st.id}（已接受）` : `✓ 已创建 ${st.id}（待接受）`);
      if (state.view !== 'status') setView('status'); // REQ-20260908-017：进入需求模块返回列表即可，不再自动打开详情
      await poll(); // 刷新列表使新单出现；此前手动打开的详情走常规刷新，不切换不关闭
    }
  } catch (err) {
    // 失败保留已填写内容与附件，明确提示后可重试（REQ-20260907-004）；不产生重复条目（服务端整单拒绝）
    toast(`创建失败：${err.message}`, true);
  } finally {
    shotBusy = false;
    renderShots();
    btn.disabled = false;
    btn.textContent = '创建';
    if (acceptBtn) {
      acceptBtn.disabled = false;
      acceptBtn.textContent = '创建并接受';
    }
  }
}

/* ---------- 批量开发抽屉（REQ-20260906-002；REQ-20260908-010 改名） ---------- */

// 批次阶段 → 面板文案；待启动/执行中严格区分：复制成功≠启动，登记运行后才算执行中
// REQ-20260913-003：去批次概念——「排队中」（非队首排队批次）分支随批次排队移除
// REQ-20260908-020：aborted（人工终止）显示「已终止」
function batchStatusLabel(s) {
  const LABELS = {
    prepared: '待启动',
    running: '执行中',
    paused: '已暂停',
    needs_attention: '执行状态待核对',
    finished: '已结束',
  };
  return LABELS[s] || s;
}

// REQ-20260909-011：运行概况行的模式口径——存量批次（agent=zcode/codex）保持
// 「执行 Agent xxx（子代理模式）」不回溯；新批次（通用标识 subagent / 缺字段）仅展示「子代理模式」。
function taskAgentModeText(b) {
  const agent = b && b.agent;
  return agent === 'zcode' || agent === 'codex'
    ? `执行 Agent ${agent}（子代理模式）`
    : '子代理模式（提示词通用，任意 Agent 会话可执行）';
}
const RUN_RESULT_LABEL = {
  reported: '已上报', blocked: '受阻', failed: '失败',
  interrupted: '已释放', skipped: '已出局', 'in-flight': '进行中', reserved: '进行中',
};

// 需求完善运行结果（REQ-20260907-003）：done 表示文档已补全（条目保持待接受）
const REFINE_RESULT_LABEL = {
  done: '已完成', failed: '失败', skipped: '已出局', interrupted: '已释放',
  'in-flight': '进行中', queued: '排队中', reserved: '进行中', running: '进行中',
};

/* ---------- REQ-20260908-026：任务面板共用渲染（计数行 / 最近两条 / 耗时 / 重新执行） ---------- */

// 当前项耗时：mm:ss（满 1 小时 h:mm:ss）；随 2s 轮询自然刷新
function fmtElapsed(fromIso, nowMs = Date.now()) {
  const t = Date.parse(fromIso);
  if (!Number.isFinite(t) || t > nowMs) return '—';
  let s = Math.floor((nowMs - t) / 1000);
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

// 运行面板计数行：已处理 / 异常 / 处理中 / 待处理（真实计数；终态待处理记 0，账面以附注保留）
function taskStatsLine({ done, abnormal, active, remaining, total, extra = '' }) {
  return `
    <div class="task-stats">
      <span>已处理 <b>${done}</b></span>
      <span>异常 <b>${abnormal}</b></span>
      <span>处理中 <b>${active}</b></span>
      <span>待处理 <b>${remaining}</b></span>
      <span class="muted small">共 ${total}${extra}</span>
    </div>`;
}

// 条目类型标签（需求 / Bug）：按编号前缀判定，本轮处理记录据此区分
function itemKindLabel(id) {
  return String(id || '').startsWith('BUG-') ? 'Bug' : '需求';
}

// 待处理队列（REQ-20260908-026）：只显示最近加入的 2 条（最新在前），上限仅为展示限制——
// 不改变实际领取顺序、不缩减队列；「最近 X 条 / 共 N 条」给全量计数
// BUG-20260910-009：q（state.search.q）前端过滤（编号 / 标题，大小写不敏感、包含即命中，
// 口径对齐 renderCxRuns）——命中行收窄并标注「（N 条被搜索过滤）」，「最近 / 共」随命中收窄；
// 无匹配与全量即空两种空态互斥，清空关键词（q 为空串）恢复全量
function pendingQueueHtml(pending, { action = '待处理', q = '' } = {}) {
  const ql = String(q || '').trim().toLowerCase();
  const items = Array.isArray(pending) ? pending : [];
  const total = items.length;
  const shown = ql ? items.filter((x) => [x.id, x.title].some((f) => String(f || '').toLowerCase().includes(ql))) : items;
  const hidden = total - shown.length;
  const recent = shown.slice(-2).reverse();
  const rows = recent.map((x) => `
    <li class="task-queue-item">
      <span class="cid link" data-goto-item="${esc(x.id)}" role="button" title="查看条目">${esc(x.id)}</span>
      <span class="dep-title" title="${esc(x.title || '')}">${esc(shortOwner(x.title || ''))}</span>
      ${(x.reasons || []).length ? `<span class="task-queue-reasons">${x.reasons.map((rr) => `<span class="chip refine-lack" title="缺失原因">${esc(rr)}</span>`).join('')}</span>` : ''}
      <span class="muted small">${esc(action)}</span>
    </li>`).join('');
  return `
    <section class="task-queue">
      <div class="dep-toolbar">
        <span class="muted small">待处理队列${hidden ? `（${hidden} 条被搜索过滤）` : ''}</span>
        <span class="muted small">最近 ${recent.length} 条 / 共 ${shown.length} 条</span>
      </div>
      ${total
        ? (shown.length
          ? `<ul class="task-queue-list">${rows}</ul>${shown.length > 2 ? '<p class="muted small" style="margin:2px 0 0">仅显示最近 2 条；其余条目仍在本轮处理范围内，实际领取顺序不变。</p>' : ''}`
          : '<p class="muted small" style="margin:2px 0 0">没有匹配的待处理条目，清空搜索恢复。</p>')
        : '<p class="muted small" style="margin:2px 0 0">暂无待处理条目。</p>'}
    </section>`;
}

// 本轮处理记录（REQ-20260908-026）：四列表格，只显示最近创建的 2 次执行尝试——
// 保留完整账本与计数（条目详情沿用需求面板查看，不提供完整列表/复核面板）
const ATTEMPT_RESULT_LABEL = {
  reported: '已处理', done: '已处理', failed: '异常', blocked: '受阻', interrupted: '已中断',
  skipped: '已出局', 'in-flight': '处理中', reserved: '处理中', running: '处理中', queued: '排队中',
};
// REQ-20260909-010：完善后自动流转结果的可读标注（仅 refine 运行携带 autoPlan 字段时渲染，
// develop 记录无该字段不受影响；文案与 refine-store.autoPlanResultText 同口径）
function autoPlanNoteOf(plan) {
  if (!plan) return '';
  if (plan.transitioned) return '已自动转入计划（planned）';
  const reason = String(plan.reason || '');
  if (reason === 'not-enabled') return ''; // 未开启（默认）：输出与现状一致，不加标注
  if (reason.startsWith('not-accepted:')) {
    const st = reason.slice('not-accepted:'.length);
    return st === 'planned'
      ? '未自动转入计划（条目当前为 planned）：无需自动转入'
      : `未自动转入计划（条目当前为 ${st}）`;
  }
  const label = {
    'settings-read-failed': '设置读取失败',
    'status-read-failed': '条目状态读取失败',
    'transition-failed': '流转执行失败',
  }[reason] || reason || '未知原因';
  return `自动转入计划失败（${label}${plan.error ? `：${plan.error}` : ''}）：请人工移入计划`;
}

// BUG-20260910-009：q（state.search.q）前端过滤（执行编号 / 条目编号 / 标题 / 执行器，
// 大小写不敏感、包含即命中，口径对齐 renderCxRuns）——过滤仅作用于已加载记录（服务端最近 5 条），
// 「共 N 条」保持全量账面口径不随关键词收窄；无匹配空态与「暂无执行记录」互斥
function runAttemptsHtml(records, total, kind, q = '') {
  const ql = String(q || '').trim().toLowerCase();
  const match = (r) => !ql || [r.runId, r.itemId, r.title, r.owner]
    .some((f) => String(f || '').toLowerCase().includes(ql));
  const all = Array.isArray(records) ? records : [];
  const shown = ql ? all.filter(match) : all;
  const hidden = all.length - shown.length;
  const n = Math.max(Number(total ?? all.length), all.length);
  const recent = shown.slice(0, 2); // 记录本身最新在前
  const retryable = (r) => ['failed', 'interrupted', 'blocked'].includes(r.result);
  const rows = recent.map((r) => `
    <tr>
      <td>
        <span class="chip kind-chip">${esc(itemKindLabel(r.itemId))}</span>
        <span class="cid link" data-goto-item="${esc(r.itemId)}" role="button" title="查看条目">${esc(r.itemId)}</span>
        <span class="small rec-title" title="${esc(r.title || '')}">${esc(shortOwner(r.title || ''))}</span>
      </td>
      <td>
        <span class="chip rs-${esc(r.result)}">${esc(ATTEMPT_RESULT_LABEL[r.result] || r.result)}</span>
        ${r.summary ? `<div class="muted small" title="${esc(r.summary)}">${esc(shortOwner(String(r.summary)))}</div>` : ''}
        ${r.reason ? `<div class="muted small" title="${esc(r.reason)}">${esc(shortOwner(String(r.reason)))}</div>` : ''}
        ${r.autoPlan && autoPlanNoteOf(r.autoPlan) ? `<div class="muted small" title="${esc(autoPlanNoteOf(r.autoPlan))}">${esc(shortOwner(autoPlanNoteOf(r.autoPlan)))}</div>` : ''}
      </td>
      <td>第 ${Number(r.attempt || 1)} 次</td>
      <td>${retryable(r)
        ? `<button type="button" class="btn small" data-retry-run="${esc(r.runId)}" data-retry-kind="${esc(kind)}" title="保留原记录并增加一次执行尝试；不可重试时会给出原因与后续操作">重新执行</button>`
        : '—'}</td>
    </tr>`).join('');
  return `
    <section class="task-records">
      <div class="dep-toolbar">
        <span class="muted small">本轮处理记录${hidden ? `（${hidden} 条被搜索过滤）` : ''}</span>
        <span class="muted small">最近 ${recent.length} 条 / 共 ${n} 条</span>
      </div>
      <div class="attempt-table-wrap"><table class="attempt-table">
        <thead><tr><th>需求 / Bug</th><th>执行状态</th><th>次数</th><th>操作</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="muted small">${ql && all.length ? '没有匹配的处理记录，清空搜索恢复。' : '暂无执行记录'}</td></tr>`}</tbody>
      </table></div>
    </section>`;
}

// 重新执行（REQ-20260908-026）：活跃任务核验后重排队本轮（遵守暂停与串行领取）；
// 终态任务以该条目重建新的待启动任务并自动复制调度提示词（复制成功 ≠ 执行成功）。
async function retryRunFromRecord(runId, kind) {
  if (!runId) return;
  const isRefine = kind === 'refine';
  const b = isRefine ? state.refine.data?.batch : state.batchData?.batch;
  const terminal = !!(b && (b.aborted || b.status === 'finished'));
  try {
    if (terminal) {
      const rec = (isRefine ? state.refine.data?.records : state.batchData?.records || []).find((x) => x.runId === runId);
      if (!rec) { toast('未找到该执行记录，请刷新后重试', true); return; }
      if (isRefine) {
        // REQ-20260909-011：去 Agent 化——重建只带条目（提示词单一通用版，mode 不再提交）；
        // REQ-20260910-027：开发人员设置已移除，请求不再携带该值
        const res = await api('/api/refine/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [rec.itemId] }),
        });
        const copied = await copyDispatchText(res.prompt);
        toast(copied
          ? `任务已创建、提示词已复制，请在对应项目会话粘贴发送（条目 ${rec.itemId}；状态：待启动）`
          : '任务已创建，但复制失败：请展开提示词手动复制', !copied);
      } else {
        await createBatchAndCopy({ ids: [rec.itemId] });
      }
      return;
    }
    const r = await api(isRefine ? '/api/refine/retry' : '/api/batch/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    });
    toast(`✓ ${r.notice || '已加入本轮重试队列'}`);
  } catch (e) {
    toast(e.message, true); // 不可重试：后端给出具体原因与人工处理指引
  } finally {
    if (isRefine) { state.refine.sig = ''; await refreshRefine(); }
    else { state.batchSig = ''; await refreshBatch(); }
  }
}

// REQ-20260907-004：批量开发页面化为「任务」模块；各入口经 gotoRuns 切换到任务视图（mode 指定子面板）
// REQ-20260908-020：子面板收敛为「批量完善 / 批量开发」两类；旧 'zcode' 入口兼容映射到批量开发，
// 'codex' 仅保留给存量执行记录深链（后台派发入口已隐藏）。
async function gotoRuns(mode) {
  if (mode) state.batch.mode = mode;
  if (state.batch.mode === 'zcode') state.batch.mode = 'develop';
  setView('runs'); // 激活视图（state.batch.open = true）并拉取面板数据
  await refreshBatch();
}

// 兼容旧调用名：打开批量开发 = 进入任务模块「批量开发」子面板
async function openBatchDrawer() {
  await gotoRuns('develop');
}

function closeBatchDrawer() {
  // 页面化后不再有抽屉遮罩；保留状态重置供项目切换复用
  state.batch.open = false;
}

/* ---------- 全局任务总览（REQ-20260910-003）：跨项目只读聚合 + 跳转 ---------- */
/* BUG-20260910-004：入口自第二行模块导航移至顶栏「管理项目」右侧；呈现自主视图改为右侧面板
   （打开不切换当前项目模块，关闭回到打开前上下文；聚合口径与跳转语义不变） */

// 面板开合（顶栏 #btnGlobal ↔ #globalPanel）。打开幂等（重复点击不叠加面板）；
// 关闭归还焦点给入口；面板为临时层，不写入地址栏（旧 view=global 深链进入后由 syncProjectUrl 规范化）
function openGlobalPanel() {
  const panel = $('#globalPanel');
  if (!panel || state.global.open) return; // 已打开：幂等守卫，不重复渲染 / 不叠加面板
  state.global.open = true;
  panel.classList.remove('hidden');
  $('#btnGlobal')?.setAttribute('aria-expanded', 'true');
  syncProjectUrl(); // 规范化旧 view=global 深链残留（面板状态不进 URL）
  renderGlobalView();
  refreshGlobal(); // 数据随打开拉取（首载骨架 → 轮询刷新）
  $('#globalPanelClose')?.focus(); // 焦点进入面板（关闭按钮为首个可达控件，与帮助面板先例一致）
}

function closeGlobalPanel({ focus = true } = {}) {
  const panel = $('#globalPanel');
  if (!panel || !state.global.open) return;
  state.global.open = false;
  panel.classList.add('hidden');
  $('#btnGlobal')?.setAttribute('aria-expanded', 'false');
  if (state.global.qTimer) { clearTimeout(state.global.qTimer); state.global.qTimer = null; }
  saveViewSnapshot(); // 面板筛选档与搜索词随快照（下次打开恢复；面板开合本身不进快照）
  if (focus) $('#btnGlobal')?.focus(); // 焦点返回入口
}

// 面板内独立搜索（前端过滤，不发请求）：词存 state.global.q，与第三行模块搜索互不影响；
// 防抖复用 SEARCH_DEBOUNCE_MS；输入框内 Esc 只清空不冒泡（不触发全局关面板链）
function bindGlobalPanelOnce() {
  const input = $('#globalSearchInput');
  if (!input || input.dataset.searchBound) return;
  input.dataset.searchBound = '1';
  const settle = () => {
    state.global.q = input.value.trim();
    saveViewSnapshot();
    renderGlobalView();
  };
  input.addEventListener('input', () => {
    const g = state.global;
    if (g.qTimer) clearTimeout(g.qTimer);
    if (!input.value.trim()) { // 清空 / 删空：立即恢复全量
      g.qTimer = null;
      settle();
      return;
    }
    g.qTimer = setTimeout(() => { g.qTimer = null; settle(); }, SEARCH_DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    // Enter：不等防抖窗口，立即按当前关键词过滤
    if (e.key === 'Enter') {
      if (state.global.qTimer) { clearTimeout(state.global.qTimer); state.global.qTimer = null; }
      e.preventDefault();
      settle();
    }
    // Esc 只清空面板搜索，不冒泡触发全局 Esc 关面板
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (input.value) { input.value = ''; settle(); }
    }
  });
  $('#globalPanelClose')?.addEventListener('click', () => closeGlobalPanel());
}

// 状态筛选档：与批次状态词表对齐（aborted/finished 不出现——接口侧已排除；queued 并入待启动口径展示）
const GLOBAL_STATUS_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'running', label: '执行中' },
  { key: 'prepared', label: '待启动' },
  { key: 'paused', label: '已暂停' },
  { key: 'needs_attention', label: '待核对' },
];
// 类型筛选档：批量开发 / 批量完善两类账本（Codex 后台执行器不聚合，口径见条目 README）
// REQ-20260911-010：批量 Commit 类型档随 CMT 批次简报回退移除
const GLOBAL_KIND_FILTERS = [
  { key: 'all', label: '全部类型' },
  { key: 'develop', label: 'AI 开发' },
  { key: 'refine', label: 'AI 分析' },
];
const GLOBAL_KIND_LABEL = { develop: 'AI 开发', refine: 'AI 分析' };
// BUG-20260911-007：kind 兜底前缀表——账本目录前缀与任务类型的固定对应（refine-store RFB- /
// dispatch batch-）。前端实时读盘而看板服务为常驻进程（路由启动时固化，
// BUG-20260907-017 同型机制），旧服务进程可能返回缺 kind / 未知 kind 的旧口径简报。
// REQ-20260911-010：CMT- 前缀随批量 Commit 回退移除（服务端不再产出 CMT 简报行）。
const GLOBAL_KIND_PREFIXES = [['RFB-', 'refine'], ['batch-', 'develop']];

// BUG-20260911-007：任务行类型兜底。原始 kind 缺失 / 不在词表时按简报携带的账本标识前缀推断
//（REQ-20260913-003 起简报不再透出批次号，此处仅兼容旧服务进程残留的 batchId 字段，不作渲染）；
// 前缀也认不出则归 'unknown'（中性档，至少在「全部类型」筛选下可见）。没有本兜底时类型筛选
// 裸比对 t.kind，外来简报会在所有筛选档位下静默消失——而汇总行按 status 计数不看 kind，于是
// 出现「执行中 1 但 0 匹配」的自相矛盾态。返回 { kind, inferred }（inferred=true 供行内诊断 flag）。
function globalTaskKind(task) {
  const rawKind = task && task.kind;
  // Object.prototype.hasOwnProperty：词表对象键不得混入原型链键（如 'toString'）
  if (Object.prototype.hasOwnProperty.call(GLOBAL_KIND_LABEL, rawKind)) return { kind: rawKind, inferred: false };
  const id = String((task && task.batchId) || '');
  const hit = GLOBAL_KIND_PREFIXES.find(([p]) => id.startsWith(p));
  return { kind: hit ? hit[1] : 'unknown', inferred: true };
}

// 任务行的状态归类键（筛选与 chip 共用）：排队中的 prepared 归「待启动」档参与筛选
function globalTaskStatusKey(task) {
  if (task.aborted) return 'aborted';
  return task.status || 'prepared';
}

// 计数行口径与项目内任务面板 taskStatsLine 一致：develop 异常 = 失败 + 受阻回执 + 中断账，
// refine 异常 = 失败 + 中断；已上报 / 已完成键随类型区分（服务端 brief 透传各自面板原始计数）
// REQ-20260911-010：commit（已提交键）分支随 CMT 简报回退移除
function globalCountsParts(task) {
  const c = task.counts || {};
  const kind = globalTaskKind(task).kind; // BUG-20260911-007：先兜底再分支（缺 kind 的旧口径简报按推断类型计数）
  if (kind === 'refine') {
    return {
      doneLabel: '已完成',
      done: c.done ?? 0,
      abnormal: (c.failed ?? 0) + (c.interrupted ?? 0),
      remaining: c.remaining ?? 0,
      total: c.total ?? 0,
    };
  }
  return {
    doneLabel: '已上报',
    done: c.reported ?? 0,
    abnormal: (c.failed ?? 0) + (c.blocked ?? 0) + (c.interrupted ?? 0),
    remaining: c.remaining ?? 0,
    total: c.total ?? 0,
  };
}

// 关键词过滤（前端，不发请求）：项目名 / 项目路径 / 当前条目编号与标题 / owner
// REQ-20260913-003：去批次概念——批次号不再是匹配字段
// REQ-20260910-027：开发人员不再是匹配字段
function globalTaskMatches(task, projRow, q) {
  if (!q) return true;
  const cur = task.current || {};
  return [projRow.name, projRow.root, cur.itemId, cur.title, cur.owner]
    .some((x) => String(x || '').toLowerCase().includes(q));
}

// 数据拉取（随主轮询）：/api/batch/global 与项目无关；失败保留上次数据并提示重试中。
// BUG-20260910-004：拉取条件自「全局为主视图」改为「面板打开」
async function refreshGlobal() {
  if (!state.global.open) return;
  if (!state.global.data) {
    state.global.loading = true; // 首载先渲染骨架占位（不阻塞面板关闭）
    renderGlobalView();
  }
  try {
    const data = await api('/api/batch/global');
    state.global.loading = false;
    state.global.error = null;
    state.global.data = data;
    renderGlobalView();
  } catch (e) {
    state.global.loading = false;
    state.global.error = e.message; // 保留上一次数据（#pollState 口径），下一轮轮询自动重试
    renderGlobalView();
  }
}

function globalSummaryText(projects) {
  const tasks = projects.flatMap((p) => p.tasks || []);
  // REQ-20260913-003：去批次概念——汇总条只按本轮执行状态计数
  const by = { running: 0, prepared: 0, paused: 0, needs_attention: 0 };
  for (const t of tasks) {
    if (by[t.status] != null) by[t.status]++;
  }
  return `执行中 <b>${by.running}</b> · 待启动 <b>${by.prepared}</b> · 已暂停 <b>${by.paused}</b> · 待核对 <b>${by.needs_attention}</b>`;
}

function globalFilterChipsHtml() {
  const g = state.global;
  const chip = ({ key, label }, cur) =>
    `<button type="button" class="filter-chip${cur === key ? ' active' : ''}" data-gfilter="${esc(key)}">${esc(label)}</button>`;
  return `
    <nav class="global-filters" aria-label="全局任务筛选">
      ${GLOBAL_STATUS_FILTERS.map((f) => chip(f, g.statusFilter)).join('')}
      <span class="global-filter-sep" aria-hidden="true"></span>
      ${GLOBAL_KIND_FILTERS.map((f) => chip(f, g.kindFilter)).join('')}
    </nav>`;
}

// 项目组内单条任务行（纯展示 + 跳转挂点，无任何写操作入口）
function globalTaskRowHtml(task) {
  const stKey = globalTaskStatusKey(task);
  const { kind: effKind, inferred } = globalTaskKind(task); // BUG-20260911-007：类型兜底
  const cnt = globalCountsParts(task);
  const cur = task.current;
  const kindLabel = GLOBAL_KIND_LABEL[effKind] || '未知类型';
  // 诊断线索（BUG-20260911-007）：kind 缺失 / 未知时行内 flag 标注推断结果与自愈指引，
  // 绝不静默消失。unknown 档仅在「全部类型」筛选下可见（前缀推不出时无类型档可归）。
  const rawKind = task && task.kind;
  const kindWarn = inferred
    ? `<span class="flag" title="${esc(`简报类型字段缺失或未知（${rawKind == null || rawKind === '' ? '缺失' : `原始值 ${rawKind}`}），已按账本标识前缀${effKind === 'unknown' ? '未能识别类型，按「未知类型」兜底展示（仅在「全部类型」筛选下可见）' : `推断为${kindLabel}`}。常驻看板服务的路由在启动时固化而静态前端实时读盘，服务进程可能旧于前端：请重启看板服务（atb serve / npm run app）后刷新；若重启后仍出现请按 BUG-20260911-007 反馈`)}">${effKind === 'unknown' ? '类型未知' : '类型推断'}</span>`
    : '';
  return `
    <article class="global-task" data-ggoto-runs="${esc(effKind)}" data-gproject="${esc(task.root || '')}"
             title="点击进入该项目任务模块（${esc(kindLabel)}）">
      <div class="global-task-top">
        <span class="chip batch-st ${task.aborted ? 's-aborted' : `s-${esc(stKey)}`}">${esc(batchStatusLabel(task.status))}</span>
        ${task.pauseRequested ? '<span class="flag" title="已请求暂停后续领取：当前项继续，完成后暂停">已请求暂停</span>' : ''}
        <span class="chip kind-chip">${esc(kindLabel)}</span>
        ${kindWarn}
        <button type="button" class="btn small global-enter">进入项目任务</button>
      </div>
      <div class="global-task-mid">
        ${cur
          ? `<span class="muted">当前：</span><span class="cid link" data-ggoto-item="${esc(cur.itemId)}" data-gproject="${esc(task.root || '')}" role="button" title="查看条目 ${esc(cur.itemId)}">${esc(cur.itemId)}</span><span class="dep-title" title="${esc(cur.title || '')}">${esc(shortOwner(cur.title || ''))}</span><span class="muted small">子代理会话 ${esc(shortOwner(cur.owner || ''))}</span>`
          : '<span class="muted small">待启动：请在对应项目的 Agent 会话粘贴调度提示词后登记运行</span>'}
      </div>
      <div class="global-task-meta">
        <span>${cnt.doneLabel} <b>${cnt.done}</b></span>
        <span>异常 <b>${cnt.abnormal}</b></span>
        <span>待处理 <b>${cnt.remaining}</b></span>
        <span class="muted small">共 ${cnt.total}</span>
        <span>创建 ${fmtTime(task.createdAt)}</span>
        <span>活动 ${fmtTime(task.lastActivityAt)}</span>
      </div>
    </article>`;
}

// 面板内容渲染（写入 #globalPanelBody；头部 / 关闭按钮 / 搜索为常驻节点不随内容重渲染，
// 加载与失败状态均不阻塞关闭）。BUG-20260910-004：搜索词取面板独立 state.global.q
function renderGlobalView() {
  const view = $('#globalPanelBody');
  if (!view) return;
  const g = state.global;
  const q = (state.global.q || '').trim().toLowerCase(); // 面板独立搜索词（不读第三行模块搜索状态）
  // 签名含数据、筛选与搜索词：无变化不重渲染（轮询不打断筛选与悬停）
  const sig = JSON.stringify([g.data, g.error, g.loading, g.statusFilter, g.kindFilter, q]);
  if (sig === g.sig) return;
  g.sig = sig;

  if (!g.data) {
    // 首载：骨架占位（不阻塞头部导航切换）；失败给错误说明（下轮轮询自动重试）
    view.innerHTML = g.loading
      ? `<div class="global-wrap">${[1, 2, 3].map(() => '<div class="global-skeleton-row"></div>').join('')}</div>`
      : `<div class="global-wrap"><div class="notice warn">全局任务加载失败：${esc(g.error || '未知原因')}。正在随轮询自动重试；也可刷新页面重试。</div></div>`;
    return;
  }

  const projects = g.data.projects || [];
  if (!projects.length) {
    view.innerHTML = `
      <div class="global-wrap">
        <div class="empty global-empty"><div class="empty-card">
          <h2>尚无注册项目</h2>
          <p>全局总览聚合所有已注册项目的批量任务。请先在顶栏「＋ 新建」旁的项目选择器打开 / 注册项目，或运行 <code>atb serve</code> 在项目内初始化看板。</p>
        </div></div>
      </div>`;
    return;
  }

  const filtered = projects.map((p) => ({
    ...p,
    // 行内跳转需要项目根：把所属项目 root 附到每条任务上（错误行无任务，不受影响）
    matched: (p.tasks || []).map((t) => ({ ...t, root: p.root })).filter((t) =>
      (g.statusFilter === 'all' || globalTaskStatusKey(t) === g.statusFilter)
      && (g.kindFilter === 'all' || globalTaskKind(t).kind === g.kindFilter) // BUG-20260911-007：类型筛选经兜底 kind（缺 kind / 未知 kind 的简报按批次号前缀归类，不静默丢失）
      && globalTaskMatches(t, p, q)),
  }));
  const taskTotal = filtered.reduce((n, p) => n + p.matched.length, 0);
  const hasTasks = projects.some((p) => (p.tasks || []).length > 0);

  // 汇总条计数按「全部在工作的任务」口径（不随筛选缩减，与需求筛选条计数口径一致）
  const groupsHtml = filtered.map((p) => {
    if (p.status === 'error') {
      return `
        <section class="global-group">
          <header class="global-group-head">
            <span class="global-proj-name" title="${esc(p.root)}">${esc(p.name || shortProject(p.root))}</span>
            <span class="cid" title="${esc(p.root)}">${esc(p.root)}</span>
          </header>
          <div class="notice warn global-error-row">读取失败：${esc(p.error || '未知原因')}（随下轮轮询自动重试）</div>
        </section>`;
    }
    if (!p.matched.length) return '';
    return `
      <section class="global-group">
        <header class="global-group-head">
          <span class="global-proj-name">${esc(p.name || shortProject(p.root))}</span>
          <span class="muted small" title="${esc(p.root)}">${esc(p.root)}</span>
          <span class="muted small">${p.matched.length} 个任务</span>
        </header>
        ${p.matched.map(globalTaskRowHtml).join('')}
      </section>`;
  }).join('');

  view.innerHTML = `
    <div class="global-wrap">
      ${g.error ? `<div class="notice warn">刷新失败，正在重试：${esc(g.error)}（已保留上一次数据）</div>` : ''}
      <div class="global-summary">
        <span>${projects.length} 个项目 · <b>${taskTotal}</b> 个在工作的批量任务</span>
        <span class="global-summary-detail">${globalSummaryText(projects)}</span>
      </div>
      ${globalFilterChipsHtml()}
      ${hasTasks
        ? (groupsHtml || '<div class="notice">当前筛选与搜索下没有匹配的任务。</div>')
        : '<div class="empty global-empty"><div class="empty-card"><h2>所有项目的批量任务均已收尾</h2><p>到各项目的任务模块（「任务」页签）可启动新的 AI 开发 / AI 分析任务；新任务登记运行后会自动出现在这里。</p></div></div>'}
      <p class="muted small global-note">数据随看板轮询自动刷新（2 秒）；「暂停 / 终止 / 删除」等操作请点击任务进入对应项目的任务模块执行。</p>
    </div>`;
  bindGlobalView(view);
}

function bindGlobalView(view) {
  // 筛选 chips：纯前端过滤（汇总条「全部在工作」计数不变，任务列表随筛选联动）
  for (const chip of view.querySelectorAll('[data-gfilter]')) {
    chip.addEventListener('click', () => {
      const key = chip.dataset.gfilter;
      if (GLOBAL_STATUS_FILTERS.some((f) => f.key === key)) state.global.statusFilter = key;
      else if (GLOBAL_KIND_FILTERS.some((f) => f.key === key)) state.global.kindFilter = key;
      else return;
      saveViewSnapshot(); // REQ-20260910-001：筛选档进入快照
      renderGlobalView();
    });
  }
  // 当前条目编号：进入对应项目并打开条目详情（复用 data-goto-item 跳转语义）
  for (const el of view.querySelectorAll('[data-ggoto-item]')) {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      gotoProjectTask(el.dataset.gproject, el.closest('.global-task')?.dataset.ggotoRuns, el.dataset.ggotoItem);
    });
  }
  // 任务行 / 「进入项目任务」按钮：切换项目 → 任务模块对应子面板
  for (const row of view.querySelectorAll('.global-task')) {
    row.addEventListener('click', () => gotoProjectTask(row.dataset.gproject, row.dataset.ggotoRuns));
  }
  for (const btn of view.querySelectorAll('.global-enter')) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = btn.closest('.global-task');
      gotoProjectTask(row?.dataset.gproject, row?.dataset.ggotoRuns);
    });
  }
}

// 跳转到对应项目：任务行 → 任务模块子面板（批量完善 / 批量开发）；条目编号 → 需求详情。
// BUG-20260910-004：跳转即关闭全局面板（目标项目 / 任务与被点击行一致；焦点交给目标模块）。
// 切换前压入一条历史项（pushState），浏览器返回可回到跳转前的项目与模块（popstate 统一回放）。
async function gotoProjectTask(projectRoot, kind, itemId = null) {
  if (!projectRoot) return;
  closeGlobalPanel({ focus: false }); // 跳转前关面板：焦点不回顶栏，交给目标模块
  try {
    history.pushState(null, '', location.pathname + location.search);
  } catch { /* 历史 API 不可用（极少数嵌入环境）：跳转照常，仅失去返回能力 */ }
  const mode = kind === 'refine' ? 'refine' : 'develop'; // REQ-20260911-010：commit 页签已随批量 Commit 回退移除
  if (projectRoot !== state.project) await switchProject(projectRoot);
  if (itemId) {
    setView('status');
    await openDrawer(itemId);
    return;
  }
  await gotoRuns(mode);
}

// REQ-20260910-003：浏览器返回 / 前进按 URL 回放视图（仅全局跳转产生同文档历史项；
// 其余交互仍是 replaceState，不新增历史项，本监听对其不触发，既有行为零回归）。
// BUG-20260910-004：global 不再是主视图，旧 view=global 历史项 / 深链回放收敛为打开全局面板
window.addEventListener('popstate', () => {
  try {
    const params = new URLSearchParams(location.search);
    const p = params.get('project');
    const v = params.get('view') || 'status';
    const apply = async () => {
      if (p && p !== state.project) {
        await switchProject(p);
      } else {
        syncProjectUrl();
      }
      if ((VIEWS.includes(v) || v === 'global') && v !== state.view) setView(v);
    };
    apply();
  } catch { /* 回放失败保持当前视图，不阻塞页面 */ }
});


/* ---------- 开发启动（REQ-20260908-010；REQ-20260909-011 去 Agent 化）：统一入口 ---------- */

// 启动前面板：「启动」按钮（REQ-20260908-026 文案统一为「启动」）。
// REQ-20260909-011：不再选择执行 Agent——点击即创建任务并复制通用主调度提示词（可在任意
// 一种 Agent 会话粘贴执行）；复制成功 ≠ 启动成功（登记运行后才算执行中）。
// REQ-20260910-027：开发人员设置已移除——顶行只剩「启动」按钮。
// 无已计划候选时启动禁用并说明原因（与完善侧对齐，不靠创建接口报错兜底）。
function renderDevStartBar() {
  const queue = plannedQueue();
  const preview = queue.length
    ? `${queue.slice(0, 3).map((it) => esc(it.id)).join('、')}${queue.length > 3 ? ` 等 ${queue.length} 项` : ''}`
    : '（空，等待已计划条目）';
  return `
    <section class="dev-start">
      <div class="cx-head-line">
        <button type="button" class="btn primary" id="devStart" ${queue.length ? '' : 'disabled title="暂无已计划候选：请先在看板接受条目并「移入计划」"'}>启动</button>
      </div>
      <p class="muted small">已计划队列（最旧优先）：${preview}——运行中新置计划的条目自动进入队列。启动 = 创建任务并复制调度提示词（复制成功 ≠ 执行中，登记运行后才算执行中）；提示词通用，可在任意一种 Agent 会话粘贴执行。</p>
    </section>`;
}

// 启动 = 批次创建 + 复制通用主调度提示词（子代理模式；模型跟随主调度会话）。
async function startDevelopment() {
  await createBatchAndCopy();
}

function bindDevStart(drawer) {
  const start = drawer.querySelector('#devStart');
  if (start) start.addEventListener('click', () => startDevelopment());
}

// 随主轮询刷新（2s）：签名无变化不重渲染，避免打断输入/点击
async function refreshBatch() {
  if (!state.batch.open) return;
  try {
    if (state.batch.mode === 'codex') {
      await refreshCodex();
      return;
    }
    if (state.batch.mode === 'refine') {
      await refreshRefine();
      return;
    }
    // 批量开发（develop；旧 'zcode' 入口已归一；REQ-20260911-010：'commit' 面板已回退）
    state.batch.mode = 'develop';
    // BUG-20260909-006：不再按勾选集合过滤统计（?ids= 随范围链路移除），口径恒为已计划队列全量
    const data = await api('/api/batch/current');
    await refreshConfirms(); // REQ-20260914-001：挂起确认区随轮询刷新（独立于批次签名）
    // stats（创建面板候选/受阻数）变化须计入签名，否则候选变化不重渲染；
    // REQ-20260913-003：批次排队列表（queue）已移除，不再计入签名；
    // pending/recordsTotal/attempt（REQ-20260908-026）：队列与最近记录变化触发重渲染
    const sig = JSON.stringify({
      b: data.batch, c: data.current, n: data.counts, s: data.stats,
      p: data.pending, rt: data.recordsTotal,
      r: (data.records || []).map((x) => x.runId + x.result + x.attempt),
    });
    state.batchData = data;
    if (sig === state.batchSig) return;
    state.batchSig = sig;
    renderBatchDrawer();
  } catch (e) {
    toast(e.message, true);
  }
}

// REQ-20260908-020 批量任务设置：进入任务/设置模块时加载一次（保存后刷新）
// REQ-20260909-001：加载态与错误入 state.tasks —— 设置视图据此显示「正在加载任务设置」
// 骨架与「任务设置加载失败 + 重试」；失败不抛出（任务模块轮询不受影响）。
// REQ-20260909-011：设置区仅剩完善流转开关（按 Agent 的配置已移除），启动区不再消费。
async function ensureTaskSettings(force = false) {
  if (!force && state.tasks.settings) return;
  state.tasks.loading = true;
  state.tasks.error = null;
  try {
    const r = await api('/api/tasks/settings');
    state.tasks.settings = r.settings || {}; // 空对象也视为已加载，避免每轮轮询重复拉取
  } catch (e) {
    state.tasks.error = e.message;
    if (!state.tasks.settings) state.tasks.settings = null;
  } finally {
    state.tasks.loading = false;
  }
}

function renderBatchDrawer() {
  const drawer = $('#batchDrawer');
  const mode = state.batch.mode;
  const q = (state.search.q || '').trim().toLowerCase(); // 任务搜索（REQ-20260907-004）：编号/标题/执行器前端过滤
  // BUG-20260910-009：q 只传给存量 Codex 深链面板；批量完善 / 批量开发面板各自在函数体内
  // 消费 state.search?.q 过滤列表（renderRefinePanel / renderZcodeBatchPanel，见各函数头注释）
  // REQ-20260908-020：任务模块收敛为「批量完善 / 批量开发」两类子面板；
  // REQ-20260911-010：「批量 Commit」页签与面板随人工批量提交流程回退移除（无禁用态残留）；
  // Codex 后台自动派发入口隐藏（面板代码与 'codex' 渲染分支保留给存量执行记录深链，不再提供入口）。
  // BUG-20260908-009：头部不再渲染「任务」模块大标题（模块归属由导航 Tab + 第三行副标题承担）。
  // REQ-20260908-026：无进行中任务时才渲染启动区（有批次由运行面板承接）。
  // BUG-20260909-002：头部「任务设置」入口删除，设置统一走主导航「设置」页签。
  // BUG-20260909-014：头部整行移除 .batch-head——项目路径与顶栏 #dataDir 重复、「✕」关闭按钮
  // 与第二行导航「需求」页签重复；头部只剩一级页签并收紧间距，离开模块统一走导航页签。
  // BUG-20260910-005：页签旁补「去新建 Zcode / Codex 会话」文字超链接（newSessionLinksHtml，
  // 两类面板共用，与页签样式区分），原提示词分区底部工作区按钮迁走不再重复。
  drawer.innerHTML = `
    <header class="drawer-head">
      <nav class="tabs batch-modes">
        <button class="tab ${mode === 'refine' ? 'active' : ''}" data-bmode="refine">AI 分析</button>
        <button class="tab ${mode === 'develop' ? 'active' : ''}" data-bmode="develop">AI 开发</button>
      </nav>
      <div class="ws-entry">${newSessionLinksHtml()}</div>
    </header>
      <div class="drawer-body">
        <div id="confirmArea" class="confirm-area hidden" role="region" aria-label="待人工确认" aria-live="polite"></div>
        ${mode === 'refine' ? renderRefinePanel() : `${!state.batchData?.batch ? renderDevStartBar() : ''}${mode === 'codex' ? renderCodexPanel(q) : renderZcodeBatchPanel()}`}
      </div>`;
  renderConfirmArea(); // REQ-20260914-001：任务页置顶「待人工确认」挂起卡片
  bindBatchDrawer();
  bindDevStart(drawer); // REQ-20260908-010：统一开发启动入口（执行 Agent zcode / codex，仅子代理模式）
  if (mode === 'codex') bindCodexPanel(drawer);
}

/* ---------- Codex 自动派发面板（REQ-20260906-003） ---------- */

const CX_PHASE_LABEL = {
  reserved: '准备中', starting: '启动中', running: '执行中', reported: '已上报',
  blocked: '受阻', failed: '失败', interrupted: '已中断',
  cleanup_pending: '收尾待核对', needs_attention: '待人工核对',
};
const CX_WAITING_LABEL = {
  empty: '队列已空：等待已计划条目（新置计划的条目可继续派发）',
  disabled: '自动派发未开启',
  no_cli: '未配置 codex CLI：请先完成运行环境检查',
  retry_backoff: '网络错误退避重试中',
  continuation: '按会话 ID 续跑中',
  'model-config': '模型配置待处理：解析继承值失败，已暂停派发。请刷新配置或显式选择模型后重新开启。',
};

// REQ-20260906-024 待处理分类 → 中文标签
const CX_PENDING_LABEL = {
  'config-unresolved': '配置无法解析',
  'model-missing': '模型不存在',
  'model-denied': '账户无权使用该模型',
  'effort-unsupported': '推理强度不支持',
  'model-mismatch': '请求与运行时模型不一致',
  'provider-changed': '提供方身份变化',
};

// REQ-20260906-024：从已加载目录中取模型能力（无目录/未知模型不伪报）
function cxModelInfo(modelId) {
  const models = state.codex.models && state.codex.models.ok ? state.codex.models.models : [];
  return models.find((m) => m.slug === modelId) || null;
}

function cxWaitingText(w) {
  if (!w) return '';
  // 汇点转义：reason/holder 可能包含错误正文/路径，统一在此 esc 后返回，调用方不再重复转义
  if (w.kind === 'paused') return `执行器已暂停：${esc(w.reason || '环境错误')}`;
  if (w.kind === 'project-busy') return `项目被占用：${esc(w.holder || '未知执行')}（核对后自动继续）`;
  if (w.kind === 'global-busy') return `全局执行中（首期全服务并发 1）：等待 ${esc(w.holder || '其他项目')}`;
  if (w.kind === 'deps-blocked') return cxDepBlockedText(w); // BUG-20260906-005：与队列已空明确区分
  return esc(CX_WAITING_LABEL[w.kind] || w.kind);
}

/* ---------- REQ-20260906-024 模型与推理强度 ---------- */

const CX_SOURCE_LABEL = {
  'item-explicit': '本项指定', 'project-explicit': '项目指定', inherit: '继承本机配置',
  'user-config': '用户配置', 'profile-table': 'Profile', 'profile-file': 'Profile 文件',
  'project-config': '项目配置', 'catalog-default': '模型目录默认档位',
};

// 目录 datalist：可搜索选择，也允许手动输入（标注尚未验证）——不把固定清单当账户可用列表
function cxModelDatalistHtml(listId) {
  const models = state.codex.models && state.codex.models.ok ? state.codex.models.models : [];
  return `<datalist id="${listId}">${models.map((m) => `<option value="${esc(m.slug)}">${esc(m.displayName || '')}</option>`).join('')}</datalist>`;
}

function cxInheritInfoHtml() {
  const inh = state.codex.inherit;
  if (!inh) return '<p class="muted small">继承值未加载：点击「刷新配置」解析本机有效配置。</p>';
  const i = inh.inherit || {};
  if (!i.modelId) {
    const missing = (i.unresolved || []).join('、') || '模型';
    return `<div class="notice warn">无法解析继承值（缺失：${esc(missing)}）。已阻止依赖该配置的新派发；可刷新配置或改为显式选择，不猜测默认模型。</div>`
      + `<p class="muted small">配置层：${(inh.layers || []).map((l) => `${esc(l.kind)}${l.exists ? '' : '（缺）'}`).join(' → ') || '无'} · 解析时间 ${fmtTime(inh.resolvedAt)}</p>`;
  }
  return `
    <div class="meta-grid cx-inherit-info">
      <div><label>模型</label><span><code>${esc(i.modelId)}</code>${cxModelInfo(i.modelId) ? '' : ' <span class="muted small">（目录未收录）</span>'}</span></div>
      <div><label>推理强度</label><span>${esc(i.reasoningEffort || '未设置')}</span></div>
      <div><label>来源</label><span>${esc(CX_SOURCE_LABEL[(i.sources || {}).model] || (i.sources || {}).model || '未知')} / 强度 ${esc(CX_SOURCE_LABEL[(i.sources || {}).reasoningEffort] || '未设置')}</span></div>
      <div><label>解析时间</label><span>${fmtTime(inh.resolvedAt)}</span></div>
    </div>
    <p class="muted small">按实际 CLI、CODEX_HOME、Profile 与项目 .codex 配置层解析；模型列表存在不等于账户可用。</p>`;
}

// 验证结果展示：绑定模型/强度；当前表单值与验证时不一致 → 标注需要重新验证（旧响应不覆盖新配置）
function cxVerificationHtml(modelId, effort) {
  const lv = state.codex.settings && state.codex.settings.codex ? state.codex.settings.codex.lastVerification : null;
  if (!lv) return '<p class="muted small">尚未进行真实验证（验证会产生一次模型请求，仅按钮触发）。</p>';
  const stale = lv.modelId !== modelId || lv.reasoningEffort !== effort;
  const label = stale ? '需要重新验证（配置已变化，旧结果不适用）'
    : lv.ok ? `验证通过 · ${fmtTime(lv.at)}${lv.error ? '' : ''}`
    : `验证失败 · ${fmtTime(lv.at)}${lv.error ? ` · ${esc(String(lv.error).slice(0, 120))}` : ''}`;
  return `<div class="notice ${!stale && lv.ok ? 'ok' : 'warn'}">${stale ? '⏳ ' : ''}${label}</div>`;
}

function cxModelBlockHtml(cfg) {
  const saved = cfg.modelSelection || { mode: 'inherit' };
  const draft = state.codex.modelDraft || {};
  const sel = {
    mode: draft.mode ?? saved.mode ?? 'inherit',
    modelId: draft.modelId ?? saved.modelId ?? '',
    reasoningEffort: draft.effortId ?? saved.reasoningEffort ?? '',
  };
  const explicit = sel.mode === 'explicit';
  const modelsOk = state.codex.models != null && state.codex.models.ok;
  const models = modelsOk ? state.codex.models.models : [];
  const info = explicit ? cxModelInfo(sel.modelId) : null;
  const efforts = info ? info.efforts : [];
  return `
    <label class="field-inline">配置方式
      <select id="cxModelMode">
        <option value="inherit" ${explicit ? '' : 'selected'}>沿用本机配置</option>
        <option value="explicit" ${explicit ? 'selected' : ''}>指定模型</option>
      </select>
    </label>
    ${explicit ? `
      <div class="cx-model-form">
        <label class="field-inline">模型（可搜索，或手动输入 ID）
          <input id="cxModelId" list="cxModelList" value="${esc(sel.modelId || '')}" placeholder="如 gpt-6-astra" size="24">
          ${cxModelDatalistHtml('cxModelList')}
          ${info ? '' : '<span class="muted small">尚未验证（目录未收录或未加载；验证按钮可真实触发一次）</span>'}
        </label>
        <label class="field-inline">推理强度
          <input id="cxEffortId" list="cxEffortList" value="${esc(sel.reasoningEffort || '')}" placeholder="如 high" size="12">
          <datalist id="cxEffortList">${efforts.map((e) => `<option value="${esc(e)}">`).join('')}</datalist>
          ${info && info.efforts.length ? `<span class="muted small">该模型支持：${esc(info.efforts.join(' / '))}${info.defaultEffort ? `（默认 ${esc(info.defaultEffort)}）` : ''}</span>` : '<span class="muted small">该模型能力未知：强度不做兼容性冒认</span>'}
        </label>
        <div id="cxModelEffortHint" class="dep-error" aria-live="polite"></div>
        ${cxVerificationHtml(sel.modelId, sel.reasoningEffort)}
      </div>
    ` : `
      ${cxInheritInfoHtml()}
      <div class="dep-toolbar">
        <button type="button" class="btn" id="cxModelRefresh" title="重新解析本机有效配置（只读，不发模型请求）">刷新配置</button>
      </div>
      ${cxVerificationHtml('', '')}
    `}
    ${state.codex.models && !state.codex.models.ok
      ? `<div class="notice warn">模型目录加载失败：${esc(state.codex.models.reason || '未知原因')}。可手动输入模型 ID（标注尚未验证）。</div>`
      : ''}
    ${modelsOk ? `<p class="muted small">目录 ${models.length} 个模型（CLI 只读能力，${esc(state.codex.models.loadedAt ? fmtTime(state.codex.models.loadedAt) : '')}）；账户可用性以真实验证与实际运行为准。</p>` : ''}`;
}

// 待处理区（M11）：持久提示；关闭抽屉只关闭展示，修复并执行成功后才自动关闭
function renderCxPendingSection() {
  const items = state.codexPending.items || [];
  if (!items.length) return '';
  return `
    <section class="cx-pending">
      <h4>模型配置待处理（${items.length}）</h4>
      <ul class="cx-pending-list">
        ${items.map((p) => `
          <li class="batch-record">
            <span class="chip rs-blocked">${esc(CX_PENDING_LABEL[p.kind] || p.kind)}</span>
            <span class="cid link" data-goto-item="${esc(p.itemId)}" role="button">${esc(p.itemId)}</span>
            ${p.runId ? `<span class="cid link" data-cxrun="${esc(p.runId)}" role="button" title="查看执行详情与日志">${esc(p.runId)}</span>` : '<span class="muted small">未启动执行</span>'}
            <span class="muted small">${esc(String(p.summary || '').slice(0, 120))} · ${fmtTime(p.updatedAt)}</span>
          </li>`).join('')}
      </ul>
      <p class="muted small">已暂停本项目 Codex 自动派发（不自动换模型/降级强度）。修复后在下方「检查设置」「重新验证」，或到执行详情「按原配置恢复本项 / 以新配置重试本项」。</p>
    </section>`;
}

// 任务模块 Codex 面板；q 为任务搜索词（runId/itemId/标题/执行来源，前端过滤，不匹配的执行记录隐藏）
function renderCodexPanel(q = '') {
  const c = state.codex;
  if (!c.status) return '<p class="muted">加载中…</p>';
  const st = c.status;
  const cfg = (c.settings && c.settings.codex) || {};
  const pre = c.preflight;
  const cur = st.current;
  return `
    <section>
      <p class="muted small" style="margin:0 0 6px">Codex 后台自动派发（REQ-20260906-003）：每项直接启动独立 codex exec 会话，事件与错误日志落盘、进程受管回收，结果在看板查看。</p>
      <div class="cx-head-line">
        <label class="switch-line" title="开启后看板服务串行取单：每项后台启动独立 codex exec 会话；关闭只停止领取新项，当前项继续">
          <input type="checkbox" id="cxToggle" ${st.enabled ? 'checked' : ''}>
          <b>自动派发</b>
        </label>
        <span class="muted small">项目并发 1 · 全服务并发 1</span>
      </div>
      ${st.paused ? `<div class="notice warn">${esc(st.pauseReason || '执行器已暂停')}</div>` : ''}
      ${st.recoveryNote && !cur ? `<div class="notice info">${esc(st.recoveryNote)}</div>` : ''}
      ${!cur && st.waiting ? `<div class="notice">${cxWaitingText(st.waiting)}</div>` : ''}
    </section>
    ${cur ? renderCxCurrent(cur) : ''}
    ${renderCxPendingSection()}
    <section class="cx-config">
      <h4>运行配置</h4>
      <div class="cx-model-block">
        <h5>模型与推理强度</h5>
        ${cxModelBlockHtml(cfg)}
      </div>
      <label class="field-inline">CLI 路径
        <input id="cxCliPath" type="text" placeholder="自动探测（PATH / ChatGPT.app 内置）" value="${esc(cfg.cliPath || '')}" size="34">
      </label>
      <label class="field-inline">单项时限（分钟）
        <input id="cxTimeout" type="number" min="5" max="240" value="${cfg.timeoutMin ?? 60}">
      </label>
      <label class="field-inline">网络重试次数
        <input id="cxRetries" type="number" min="0" max="3" value="${cfg.retries ?? 2}">
      </label>
      <label class="field-inline" title="服务重启后核对通过时自动恢复取单（默认关闭）">
        <input type="checkbox" id="cxResumeRestart" ${cfg.resumeAfterRestart ? 'checked' : ''}> 重启后自动继续
      </label>
      <label class="field-inline" title="允许 Codex 在此项目没有 Git 仓库时执行，沙箱和审批沿用本机设置">
        <input type="checkbox" id="cxAllowNonGit" ${cfg.allowNonGit ? 'checked' : ''}> 允许非 Git 项目执行
      </label>
      <div class="dep-toolbar">
        <button type="button" class="btn" id="cxSaveCfg">保存配置</button>
        <span class="muted small">不在此收集任何密钥；沿用本机 codex 登录与模型配置。</span>
      </div>
    </section>
    <section class="cx-preflight">
      <h4>运行环境</h4>
      <div class="dep-toolbar">
        <button type="button" class="btn" id="cxPreflight">检查运行环境（静态）</button>
        <button type="button" class="btn" id="cxModelProbe" ${c.probing ? 'disabled' : ''} title="会真实发起一次最小 codex exec（消耗一次模型请求），需明确点击触发">验证模型可达</button>
      </div>
      ${pre ? `<ul class="cx-checks">${pre.checks.map((x) => `
        <li class="${x.ok ? 'ok' : 'bad'}">${x.ok ? '✓' : '✗'} ${esc(x.label)}<span class="muted small"> ${esc(x.detail || '')}</span></li>`).join('')}
      </ul><p class="muted small">${esc(pre.note || '')}</p>` : ''}
      ${c.modelProbe ? `<div class="notice ${c.modelProbe.ok ? 'ok' : 'warn'}">模型验证${c.modelProbe.ok ? '通过' : '失败'}：${fmtTime(new Date().toISOString())}${c.modelProbe.durationMs ? ` · ${Math.round(c.modelProbe.durationMs / 100) / 10}s` : ''}${c.modelProbe.finalMessage ? ` · 回复「${esc(c.modelProbe.finalMessage.slice(0, 40))}」` : c.modelProbe.error ? `<br>${esc(c.modelProbe.error)}` : ''}</div>` : ''}
    </section>
    ${renderCxRuns(q)}
    ${c.detail ? renderCxDetail() : ''}`;
}

function renderCxCurrent(cur) {
  const phase = CX_PHASE_LABEL[cur.phase] || cur.phase;
  const stopping = cur.cancelRequested || cur.stopping;
  return `
    <section class="cx-current">
      <h4>当前执行</h4>
      <div class="meta-grid">
        <div><label>条目</label><span><span class="cid link" data-goto-item="${esc(cur.itemId)}" role="button">${esc(cur.itemId)}</span> ${esc(shortOwner(cur.title || ''))}</span></div>
        <div><label>阶段</label><span>${stopping ? '<b>停止中…</b>' : esc(phase)}</span></div>
        <div><label>开始时间</label><span>${fmtTime(cur.startedAt)}</span></div>
        <div><label>最后事件</label><span>${cur.lastEventAt ? fmtTime(cur.lastEventAt) : '—'}</span></div>
        <div><label>尝试次数</label><span>${cur.attempts}（续跑/重试计入）</span></div>
        <div><label>会话 ID</label><span title="thread.started 提供的确切 ID；未获得不显示假 ID">${cur.threadId ? `<code>${esc(cur.threadId)}</code>` : '等待会话创建'}</span></div>
        <div><label>模型</label><span title="本次执行创建时的配置快照；续跑/重试保持不变">${cur.model ? `<code>${esc(cur.model)}</code> / ${esc(cur.reasoningEffort || '')} · ${esc(CX_SOURCE_LABEL[cur.modelSource] || cur.modelSource || '')}` : '未记录'}</span></div>
      </div>
      <div class="drawer-actions batch-actions">
        <button type="button" class="btn warn" id="cxStopCurrent" ${stopping ? 'disabled' : ''}>停止当前执行</button>
        <span class="muted small">先请求中断，确认回收后显示「已中断」；收尾未确认不放锁、不派下一项。</span>
      </div>
    </section>`;
}

// BUG-20260906-005 依赖阻塞文案：指出被阻塞条目与需完成的前置条目，区别于空队列。
// 动态值在拼入前逐一经 esc()（who/deps 为已转义片段），数字（count/items.length）无注入面。
function cxDepBlockedText(w) {
  const items = Array.isArray(w.items) ? w.items : [];
  const parts = items.map((x) => {
    const who = x.title ? `${esc(x.id)} ${esc(x.title)}` : esc(String(x.id || ''));
    const deps = (x.unsatisfied || []).map((u) => esc(String(u))).join('、') || '未知';
    return `${who} ← 前置未完成：${deps}`;
  });
  const count = Number(w.count) || items.length;
  const more = count > items.length ? `（仅列前 ${items.length} 项，共 ${count} 项）` : '';
  return `依赖阻塞：${count} 项已计划条目因前置条目未完成暂不派发${more} —— ${parts.join('；')}。这与队列已空不同：前置条目完成人工验收后将自动继续派发。`;
}

function renderCxRuns(q = '') {
  const c = state.codex;
  // 任务搜索（REQ-20260907-004）：覆盖执行编号、条目编号与执行来源，前端过滤
  const ql = String(q || '').toLowerCase();
  const matchQ = (r) => !ql || [r.runId, r.itemId, r.modelSnapshot?.modelId, r.result?.reason]
    .some((x) => String(x || '').toLowerCase().includes(ql));
  const runs = (c.runs || []).filter(matchQ);
  const hidden = (c.runs || []).length - runs.length;
  const rows = runs.map((r) => `
    <li class="batch-record">
      <span class="chip rs-${esc(r.phase)}">${CX_PHASE_LABEL[r.phase] || esc(r.phase)}</span>
      <span class="cid link" data-goto-item="${esc(r.itemId)}" role="button">${esc(r.itemId)}</span>
      <span class="cid link" data-cxrun="${esc(r.runId)}" role="button" title="查看执行详情（摘要/日志/最终回复/测试报告）">${esc(r.runId)}</span>
      <span class="muted small">${r.threadId ? '' : '无会话 ID · '}${(r.attempts || []).length || 0} 次尝试 · ${r.startedAt ? fmtTime(r.startedAt) : '—'}${r.result?.reason ? ` · ${esc(r.result.reason)}` : ''}</span>
    </li>`).join('');
  const more = (c.runs || []).length < c.runsTotal
    ? `<button type="button" class="btn" id="cxMoreRuns">加载更多（${c.runs.length}/${c.runsTotal}）</button>`
    : `<span class="muted small">共 ${c.runsTotal} 条</span>`;
  return `
    <section>
      <h4>执行记录${hidden ? ` <span class="muted small">（${hidden} 条被搜索过滤）</span>` : ''}</h4>
      ${c.runsTotal ? `${runs.length ? `<ul class="batch-record-list">${rows}</ul>` : '<p class="muted small">没有匹配的执行记录，清空搜索恢复。</p>'}<div class="dep-foot">${more}</div>` : '<p class="muted small">（暂无执行记录）</p>'}
    </section>`;
}

// 以新配置重试本项（M12）：当前执行已收尾时展开新配置表单；按钮旁直接展示目标与影响范围
function cxRetryFormHtml(r) {
  if (!['failed', 'blocked', 'interrupted', 'reported'].includes(r.phase)) return '';
  const lastModel = r.modelSnapshot ? `${r.modelSnapshot.modelId} / ${r.modelSnapshot.reasoningEffort}` : '历史记录未记录';
  return `
    <details class="dep-settings cx-retry" id="cxRetryForm">
      <summary>需要改模型？以新配置重试本项</summary>
      <p class="muted small">原执行（${esc(r.runId)}，模型 ${esc(lastModel)}）与记录保留；本操作为本项建立关联的新执行，仍受互斥与会话恢复检查约束，重复点击只产生一次执行。</p>
      <label class="field-inline">配置方式
        <select id="cxRetryMode">
          <option value="explicit" selected>本项指定</option>
          <option value="inherit">继承项目设置 / 本机配置</option>
        </select>
      </label>
      <label class="field-inline">模型
        <input id="cxRetryModel" list="cxModelList" value="${esc(r.modelSnapshot ? r.modelSnapshot.modelId : '')}" placeholder="模型 ID" size="24">
      </label>
      <label class="field-inline">推理强度
        <input id="cxRetryEffort" value="${esc(r.modelSnapshot ? r.modelSnapshot.reasoningEffort : '')}" placeholder="如 high" size="12">
      </label>
      <div class="dep-foot">
        <span id="cxRetryTarget" class="muted small"></span>
        <button type="button" class="btn" id="cxRetryItem">以新配置重试本项</button>
      </div>
    </details>`;
}

function bindCxRetryForm(drawer, r) {
  const form = drawer.querySelector('#cxRetryForm');
  if (!form) return;
  const mode = drawer.querySelector('#cxRetryMode');
  const model = drawer.querySelector('#cxRetryModel');
  const effort = drawer.querySelector('#cxRetryEffort');
  const target = drawer.querySelector('#cxRetryTarget');
  const update = () => {
    if (target) target.textContent = mode.value === 'inherit'
      ? `目标：${r.itemId} 新执行 · 继承项目设置（保存后影响本项后续新执行）`
      : `目标：${r.itemId} 新执行 · 模型 ${model.value.trim() || '（未填）'} / 强度 ${effort.value.trim() || '（未填）'}`;
  };
  for (const el of [mode, model, effort]) el.addEventListener('input', update);
  update();
  const btn = drawer.querySelector('#cxRetryItem');
  if (btn) btn.addEventListener('click', async () => {
    btn.disabled = true; // 双击期间禁用；结果反馈后恢复
    try {
      const selection = mode.value === 'inherit'
        ? { mode: 'inherit' }
        : { mode: 'explicit', modelId: model.value.trim(), reasoningEffort: effort.value.trim() };
      const resp = await api('/api/dispatch/codex/retry-item', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: r.runId, modelSelection: selection }),
      });
      if (resp.ok) {
        toast(`✓ 已以新配置启动 ${resp.runId}（关联原执行 ${resp.supersedes}）`);
        state.codex.detail = null;
        state.codex.statusSig = '';
        await refreshCodex();
      } else {
        toast(resp.error || '无法重试', true);
        btn.disabled = false;
      }
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false;
    }
  });
}

// 读取模型表单为 modelSelection（显式时模型+强度成对；缺一按未填处理，后端 400 就地提示）
function cxReadModelForm(drawer, { forVerify = false } = {}) {
  const draft = state.codex.modelDraft || {};
  const saved = (state.codex.settings?.codex)?.modelSelection || { mode: 'inherit' };
  const mode = drawer.querySelector('#cxModelMode') ? drawer.querySelector('#cxModelMode').value : (draft.mode ?? saved.mode);
  if (mode !== 'explicit') return { mode: 'inherit' };
  const modelId = (drawer.querySelector('#cxModelId')?.value ?? draft.modelId ?? saved.modelId ?? '').trim();
  const effort = (drawer.querySelector('#cxEffortId')?.value ?? draft.effortId ?? saved.reasoningEffort ?? '').trim();
  return { mode: 'explicit', modelId, reasoningEffort: effort };
}

// onRerender：配置方式切换（结构变化）后的重渲染回调；缺省重渲染任务面板（REQ-20260907-004 设置模块复用时传自身）
function bindCxModelBlock(drawer, onRerender) {
  const modeSel = drawer.querySelector('#cxModelMode');
  const modelInput = drawer.querySelector('#cxModelId');
  const effortInput = drawer.querySelector('#cxEffortId');
  if (!modeSel) return;
  state.codex.modelDraft = state.codex.modelDraft || {};
  // 配置方式切换：结构变化需重渲染；草稿保留已输入值
  modeSel.addEventListener('change', () => {
    state.codex.modelDraft.mode = modeSel.value;
    (onRerender || renderBatchDrawer)();
  });
  // 刷新继承解析（只读，不发模型请求）
  const refresh = drawer.querySelector('#cxModelRefresh');
  if (refresh) refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    try {
      state.codex.inherit = await api('/api/dispatch/codex/model-inherit');
      state.codex.models = await api('/api/dispatch/codex/models?refresh=1');
    } catch (e) { toast(e.message, true); }
    (onRerender || renderBatchDrawer)();
  });
  // 模型输入变化：更新强度档位提示；原强度不兼容时清空并提示重新选择（不静默替换）
  const syncEffort = () => {
    if (!modelInput || !effortInput) return;
    const info = cxModelInfo(modelInput.value.trim());
    state.codex.modelDraft.modelId = modelInput.value;
    const list = drawer.querySelector('#cxEffortList');
    if (list && info) list.innerHTML = info.efforts.map((e) => `<option value="${esc(e)}">`).join('');
    const hint = drawer.querySelector('#cxModelEffortHint');
    const cur = effortInput.value.trim();
    if (info && info.efforts.length && cur && !info.efforts.includes(cur)) {
      effortInput.value = '';
      state.codex.modelDraft.effortId = '';
      if (hint) hint.textContent = `已切换模型：原强度 ${cur} 不被 ${info.slug} 支持，请重新选择（支持：${info.efforts.join(' / ')}）`;
    } else if (hint) {
      hint.textContent = '';
    }
  };
  if (modelInput) modelInput.addEventListener('input', syncEffort);
  if (effortInput) effortInput.addEventListener('input', () => {
    state.codex.modelDraft.effortId = effortInput.value;
  });
}

function renderCxDetail() {
  const d = state.codex.detail;
  const r = d.run;
  const tabs = [
    ['summary', '摘要'], ['events', '执行日志'], ['stderr', '错误输出'], ['final', '最终回复'], ['report', '测试报告'],
  ];
  return `
    <section class="cx-detail">
      <h4>执行详情 · ${esc(r.runId)}</h4>
      <div class="batch-status-line">
        <span class="chip rs-${esc(r.phase)}">${CX_PHASE_LABEL[r.phase] || esc(r.phase)}</span>
        <span class="cid link" data-goto-item="${esc(r.itemId)}" role="button">${esc(r.itemId)}</span>
        <span class="muted small">${r.threadId ? `会话 ${esc(r.threadId)}` : '无会话 ID'} · ${(r.attempts || []).length} 次尝试${r.result?.reason ? ` · ${esc(r.result.reason)}` : ''}</span>
        <button type="button" class="icon-btn" id="cxCloseDetail" title="收起详情">✕</button>
      </div>
      ${r.recoveryNote ? `<div class="notice info">${esc(r.recoveryNote)}</div>` : ''}
      <div class="drawer-actions batch-actions">
        ${(r.phase === 'blocked' || r.phase === 'interrupted') && r.threadId
          ? '<button type="button" class="btn primary" id="cxResumeItem" title="使用已记录的确切会话 ID 与原配置快照续跑本项（不新开上下文）">按原配置恢复本项</button>'
          : '<span class="muted small">（仅记录了会话 ID 且已收尾的执行可恢复）</span>'}
        <button type="button" class="btn" disabled title="普通 codex exec 会话默认不进入桌面侧栏；可见性未验证前不提供跳转，请在看板查看日志">桌面入口未接通，请查看看板日志</button>
      </div>
      ${cxRetryFormHtml(r)}
      <nav class="tabs">${tabs.map(([k, label]) => `<button class="tab ${d.logName === k ? 'active' : ''}" data-cxlog="${k}">${label}</button>`).join('')}</nav>
      <div id="cxDetailBody">${cxDetaiBodyHtml()}</div>
    </section>`;
}

function cxDetaiBodyHtml() {
  const d = state.codex.detail;
  const r = d.run;
  if (d.logName === 'summary') {
    const ms = r.modelSnapshot || null;
    return `<pre class="batch-prompt" tabindex="0">${esc(JSON.stringify({
      runId: r.runId, itemId: r.itemId, phase: r.phase, threadId: r.threadId,
      startedAt: r.startedAt, endedAt: r.endedAt, retriesUsed: r.retriesUsed,
      cancelRequested: r.cancelRequested, result: r.result,
      modelSnapshot: ms || '历史记录未记录（创建于模型配置记录之前）',
      modelConfirmed: r.modelConfirmed || null, // M17：null = 按记录配置请求，实际模型未返回
      supersedes: r.supersedes || null,
      attempts: (r.attempts || []).map((a) => ({ no: a.attemptNo, kind: a.kind, pid: a.pid, exitCode: a.exitCode, signal: a.signal, lingerKilled: a.lingerKilled })),
    }, null, 2))}</pre>
    ${ms ? `<p class="muted small">请求模型 <code>${esc(ms.modelId)}</code> / 强度 ${esc(ms.reasoningEffort)} · 来源 ${esc(CX_SOURCE_LABEL[ms.source] || ms.source || '')} · 快照时间 ${fmtTime(ms.resolvedAt)}${r.modelConfirmed ? ` · 运行时确认 <code>${esc(r.modelConfirmed)}</code>` : ' · 按记录配置请求，实际模型未返回'}</p>`
      : '<p class="muted small">该执行缺少模型快照（历史记录未记录）；恢复前需以新配置重试建立一次明确选择，不伪造旧模型。</p>'}`;
  }
  if (d.logName === 'report') {
    return d.testReport == null
      ? '<p class="muted">尚无测试报告（条目未上报）</p>'
      : `<pre class="batch-prompt" tabindex="0">${esc(d.testReport)}</pre>`;
  }
  if (d.logName === 'final') {
    return `<pre class="batch-prompt" tabindex="0">${d.logData ? esc(d.logData) : '尚无最终回复'}</pre>`;
  }
  return `<pre id="cxLogPre" class="batch-prompt" tabindex="0">${esc(d.logData || '')}</pre>
    <div class="dep-foot">${d.logEof && !d.logData ? '<span class="muted small">（暂无内容）</span>' : ''}${d.logEof ? '<span class="muted small">已到末尾</span>' : '<button type="button" class="btn" id="cxMoreLog">加载更多日志</button>'} <span class="muted small">已加载 ${d.logData.length} 字符（增量读取，不整载全量）</span></div>`;
}

async function refreshCodex() {
  const c = state.codex;
  try {
    const [status, runs] = await Promise.all([
      api('/api/dispatch/status'),
      api('/api/dispatch/runs?limit=10'),
    ]);
    if (!c.settings) c.settings = (await api('/api/dispatch/settings')).settings;
    // REQ-20260906-024：模型目录与继承解析只加载一次（不发模型请求；刷新由按钮触发）
    if (c.models === undefined) {
      try { c.models = await api('/api/dispatch/codex/models'); } catch { c.models = null; }
    }
    if (!c.inherit) {
      try { c.inherit = await api('/api/dispatch/codex/model-inherit'); } catch { c.inherit = null; }
    }
    await refreshCodexPending();
    const sig = JSON.stringify([status, runs.items.map((x) => [x.runId, x.phase, x.result?.reason, (x.attempts || []).length, x.threadId])]);
    const wantRender = sig !== c.statusSig || !c.status;
    c.status = status;
    c.runs = runs.items;
    c.runsTotal = runs.total;
    if (wantRender) {
      c.statusSig = sig;
      renderBatchDrawer();
    }
    // 详情打开时增量拉日志（不整板重渲染，避免滚动位置被打断）
    if (c.detail && (c.detail.logName === 'events' || c.detail.logName === 'stderr')) {
      await appendRunLog(c.detail.runId, c.detail.logName);
    }
  } catch { /* 主轮询已有离线指示，静默 */ }
}

// REQ-20260906-024：待处理记录刷新（顶栏徽标 + 面板待处理区 + 卡片标记共用）
async function refreshCodexPending() {
  try {
    const r = await api('/api/dispatch/pending');
    const changed = r.count !== state.codexPending.count
      || JSON.stringify(r.items.map((x) => [x.requestId, x.status, x.updatedAt])) !== state.codexPending.sig;
    state.codexPending = { count: r.count, items: r.items, byItem: new Set(r.items.map((x) => x.itemId)), sig: JSON.stringify(r.items.map((x) => [x.requestId, x.status, x.updatedAt])) };
    const badge = $('#cxPendingBadge');
    if (badge) {
      badge.classList.toggle('hidden', !r.count);
      badge.textContent = `待处理 ${r.count}`;
    }
    return changed;
  } catch {
    return false;
  }
}

function bindCodexPanel(drawer) {
  const toggle = drawer.querySelector('#cxToggle');
  if (toggle) toggle.addEventListener('change', async () => {
    try {
      await api('/api/dispatch/codex/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: toggle.checked }),
      });
      toast(toggle.checked ? '✓ 自动派发已开启：将串行处理已计划条目（最旧优先）' : '已关闭自动派发：当前执行完成后停止派发');
      state.codex.statusSig = '';
      await refreshCodex();
    } catch (e) {
      toggle.checked = !toggle.checked;
      toast(e.message, true);
    }
  });
  const save = drawer.querySelector('#cxSaveCfg');
  if (save) save.addEventListener('click', async () => {
    const codex = {
      cliPath: drawer.querySelector('#cxCliPath').value.trim() || null,
      timeoutMin: Number(drawer.querySelector('#cxTimeout').value) || 60,
      retries: Number(drawer.querySelector('#cxRetries').value) || 0,
      resumeAfterRestart: drawer.querySelector('#cxResumeRestart').checked,
      allowNonGit: drawer.querySelector('#cxAllowNonGit').checked,
      // REQ-20260906-024：模型选择（显式时模型+强度成对；后端校验非法组合，不静默替换）
      modelSelection: cxReadModelForm(drawer),
    };
    try {
      const r = await api('/api/dispatch/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codex }),
      });
      state.codex.settings = r.settings;
      state.codex.modelDraft = null; // 已保存：草稿清空回填正式值
      toast('✓ 已保存运行配置（模型设置将用于后续新执行；进行中的执行与续跑保持原设置）');
      renderBatchDrawer();
    } catch (e) { toast(e.message, true); }
  });
  bindCxModelBlock(drawer);
  const pre = drawer.querySelector('#cxPreflight');
  if (pre) pre.addEventListener('click', async () => {
    try {
      state.codex.preflight = await api('/api/dispatch/preflight');
      renderBatchDrawer();
    } catch (e) { toast(e.message, true); }
  });
  const probe = drawer.querySelector('#cxModelProbe');
  if (probe) probe.addEventListener('click', async () => {
    state.codex.probing = true;
    probe.disabled = true;
    probe.textContent = '验证中…（真实最小执行）';
    try {
      // M07：验证使用当前待验证配置（表单值优先），与正式运行同一解析与参数构造
      const sel = cxReadModelForm(drawer, { forVerify: true });
      state.codex.modelProbe = await api('/api/dispatch/preflight/model', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sel.mode === 'explicit' ? { modelSelection: sel } : {}),
      });
    } catch (e) {
      state.codex.modelProbe = { ok: false, error: e.message };
    }
    state.codex.probing = false;
    // 刷新设置里的 lastVerification（验证结果绑定配置指纹）
    try { state.codex.settings = (await api('/api/dispatch/settings')).settings; } catch {}
    renderBatchDrawer();
  });
  const stop = drawer.querySelector('#cxStopCurrent');
  if (stop) stop.addEventListener('click', async () => {
    // BUG-20260907-009：window.confirm 冻结内置浏览器，改页面内异步确认对话框
    if (!await uiConfirm({
      title: '确定停止当前执行？',
      message: '将先请求中断，确认回收后才释放占用。',
      confirmText: '停止',
      danger: true,
    })) return;
    try {
      const r = await api('/api/dispatch/codex/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      toast(r.ok ? '停止请求已发出：显示「停止中」，确认回收后转为已中断' : (r.error || '无法停止'), !r.ok);
      state.codex.statusSig = '';
      await refreshCodex();
    } catch (e) { toast(e.message, true); }
  });
  for (const el of drawer.querySelectorAll('[data-cxrun]')) {
    el.addEventListener('click', () => openRunDetail(el.dataset.cxrun));
  }
  const moreRuns = drawer.querySelector('#cxMoreRuns');
  if (moreRuns) moreRuns.addEventListener('click', async () => {
    try {
      const r = await api(`/api/dispatch/runs?limit=10&offset=${state.codex.runs.length}`);
      state.codex.runs.push(...r.items);
      state.codex.runsTotal = r.total;
      renderBatchDrawer();
    } catch (e) { toast(e.message, true); }
  });
  const closeDetail = drawer.querySelector('#cxCloseDetail');
  if (closeDetail) closeDetail.addEventListener('click', () => {
    state.codex.detail = null;
    renderBatchDrawer();
  });
  for (const b of drawer.querySelectorAll('[data-cxlog]')) {
    b.addEventListener('click', () => switchRunLog(b.dataset.cxlog));
  }
  const moreLog = drawer.querySelector('#cxMoreLog');
  if (moreLog) moreLog.addEventListener('click', () => appendRunLog(state.codex.detail.runId, state.codex.detail.logName, true));
  const resumeItem = drawer.querySelector('#cxResumeItem');
  if (resumeItem) resumeItem.addEventListener('click', async () => {
    // BUG-20260906-008：恢复必须绑定当前查看的执行详情，服务端按 runId 精确续跑
    if (!state.codex.detail?.runId) {
      toast('缺少当前查看的执行详情，无法恢复', true);
      return;
    }
    try {
      const r = await api('/api/dispatch/codex/resume-item', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: state.codex.detail.runId }) });
      if (r.ok) {
        toast(`✓ 已按原配置恢复执行：${r.runId}`);
        state.codex.detail = null;
        state.codex.statusSig = '';
        await refreshCodex();
      } else {
        toast(r.error || '无法恢复', true);
      }
    } catch (e) { toast(e.message, true); }
  });
  // REQ-20260906-024：执行详情的「以新配置重试本项」表单
  if (state.codex.detail?.run) bindCxRetryForm(drawer, state.codex.detail.run);
}

async function openRunDetail(runId) {
  try {
    const run = await api(`/api/dispatch/runs/${encodeURIComponent(runId)}`);
    state.codex.detail = { runId, run, logName: 'summary', logData: '', logOffset: 0, logEof: false, testReport: null };
    renderBatchDrawer();
    await switchRunLog('summary');
  } catch (e) { toast(e.message, true); }
}

async function switchRunLog(name) {
  const d = state.codex.detail;
  if (!d) return;
  d.logName = name;
  d.logData = '';
  d.logOffset = 0;
  d.logEof = false;
  if (name === 'report') {
    try {
      const r = await api(`/api/item/${encodeURIComponent(d.run.itemId)}/doc/test-report.md`);
      d.testReport = r.content;
    } catch { d.testReport = null; }
  } else if (name === 'summary') {
    d.testReport = d.testReport ?? null;
  } else {
    await appendRunLog(d.runId, name);
  }
  renderBatchDrawer();
}

async function appendRunLog(runId, name, manual = false) {
  const d = state.codex.detail;
  if (!d || d.runId !== runId || d.logName !== name) return;
  if (d.logEof && !manual) return;
  try {
    const r = await api(`/api/dispatch/runs/${encodeURIComponent(runId)}/log?name=${name}&offset=${d.logOffset}&limit=65536`);
    if (r.nextOffset > d.logOffset || r.data) {
      d.logData += r.data;
      d.logOffset = r.nextOffset;
      d.logEof = r.eof;
    } else {
      d.logEof = r.eof;
    }
    const pre = document.querySelector('#cxLogPre');
    if (pre) {
      pre.textContent = d.logData || '';
      pre.scrollTop = pre.scrollHeight;
      const foot = pre.parentElement.querySelector('.dep-foot');
      const more = foot?.querySelector('#cxMoreLog');
      if (more) more.style.display = d.logEof ? 'none' : '';
    }
  } catch (e) {
    if (manual) toast(e.message, true);
  }
}

// REQ-20260910-027：开发人员输入初值链路（重渲染保留值 / localStorage 记忆 / git user.name 预填）
// 已随输入框一并移除。

/* ---------- 任务运行面板二级页签（REQ-20260909-008） ---------- */

// 运行态四分区：概况（状态/通知/详情/计数/操作）、队列（待处理）、提示词、记录。
// 启动态（无进行中任务）不拆页签，保持启动区 + 队列单屏。
const TASK_PANES = [
  { key: 'overview', label: '概况' },
  { key: 'queue', label: '队列' },
  { key: 'prompt', label: '提示词' },
  { key: 'records', label: '记录' }];

// 当前分区记忆（无效值回落「概况」）；store 为 state.batch / state.refine（各自独立记忆）
function taskPaneOf(store) {
  return TASK_PANES.some((p) => p.key === store.pane) ? store.pane : 'overview';
}

// 二级页签壳：渲染页签行 + 四个分区，当前分区无 hidden、其余隐藏（沿用 .hidden class 口径）。
// 只组织布局，不拉数据（数据随 2 秒轮询更新，签名变化触发重渲染后按 store.pane 恢复当前分区）。
function taskPaneShell(scope, store, panes) {
  const cur = taskPaneOf(store);
  const tabs = TASK_PANES.map((p) => `<button type="button" class="tab task-pane-tab${cur === p.key ? ' active' : ''}" role="tab" aria-selected="${cur === p.key ? 'true' : 'false'}" data-task-pane="${p.key}" data-task-scope="${scope}">${p.label}</button>`).join('');
  const wrap = (p) => `<section class="task-pane${cur === p.key ? '' : ' hidden'}" data-pane="${p.key}" data-pane-scope="${scope}" role="tabpanel" aria-label="${p.label}">${panes[p.key] || ''}</section>`;
  return `
    <nav class="tabs task-subtabs" role="tablist" aria-label="任务分区">${tabs}</nav>
    ${TASK_PANES.map(wrap).join('')}`;
}

// 二级页签切换：纯前端行为（不发起请求、不弹确认）；当前页签写入对应面板的记忆
// （批量开发 state.batch.pane / 批量完善 state.refine.pane），一级页签来回切换与
// 轮询重渲染均不重置；失效页签（含 Codex 深链等无归属入口）回落「概况」。
function activateTaskPane(scope, pane) {
  if (!TASK_PANES.some((p) => p.key === pane)) pane = 'overview';
  const store = scope === 'refine' ? state.refine : state.batch;
  store.pane = pane;
  saveViewSnapshot(); // REQ-20260910-001：二级页签进入快照（两面板各自记忆、互不串扰）
  const drawer = $('#batchDrawer');
  if (!drawer) return;
  for (const b of drawer.querySelectorAll('.task-pane-tab')) {
    if (b.dataset.taskScope !== scope) continue; // 只动当前面板的页签（另一面板记忆不受影响）
    const on = b.dataset.taskPane === pane;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  for (const p of drawer.querySelectorAll('.task-pane')) {
    if (p.dataset.paneScope !== scope) continue;
    p.classList.toggle('hidden', p.dataset.pane !== pane);
  }
}

/* ---------- 头部「去新建 XX 会话」入口（BUG-20260910-005，批量完善 / 批量开发共用） ---------- */

// 一级页签旁的文字超链接（区别于页签胶囊样式），替代 REQ-20260910-002 提示词分区底部的
// 「打开 XX 工作区」按钮（迁走避免重复）。只打开/聚焦本项目相关界面，不注入/不发送提示词
// （REQ-20260911-008 起点击时先自动复制当前面板最新提示词，打开后仍由用户手动粘贴发送）。
// 状态口径（README 期望行为）：
// - 探测中 / 首帧未知：显示「正在检测」，不把未知当未检测到；
// - 探测失败（通道故障 ≠ 未安装）：说明 + 「重新检测」+ 手动打开指引；
// - 未检测到宿主 app：该端链接禁用 + 可见「（未检测到）」说明（留非默认路径余地）；
// - 未选择项目：两端禁用，title 说明先选择项目；
// - zcode：官方深链只有 workspace/open（打开工作区，无会话创建参数）——title/提示均明确
//   需手动新建会话，不宣称自动新建；codex：threads/new?path= 落在新会话输入框，不传 prompt。
function newSessionLinksHtml() {
  const w = state.workspaceApps;
  if (w.failed && !w.loaded) {
    return '<span class="ws-entry-state muted small">客户端检测失败：无法确认本机 Zcode / Codex 是否可用</span>'
      + '<a class="ws-entry-link" href="#" data-ws-retry title="重新检测本机 Zcode / Codex 客户端（只读存在性检查）">重新检测</a>'
      + '<span class="ws-entry-state muted small">或直接打开 ZCode / ChatGPT 手动新建会话并粘贴提示词</span>';
  }
  if (w.probing || !w.loaded) {
    return '<span class="ws-entry-state muted small">正在检测本机 Agent 客户端…</span>';
  }
  const noProject = !state.project;
  const cfg = [
    { agent: 'zcode', label: '去新建 Zcode 会话',
      // REQ-20260911-008：title 更新为「自动复制提示词后打开」口径（自动的只是剪贴板写入）
      okTitle: `自动复制当前面板最新主调度提示词后打开 Zcode（${state.project}）：深链只打开工作区，会话需手动新建并粘贴提示词`,
      missingTitle: '未检测到 ZCode.app（zcode:// 深链宿主）：可能未安装或装在非默认路径；可直接打开 Zcode 手动新建会话并粘贴提示词' },
    { agent: 'codex', label: '去新建 Codex 会话',
      okTitle: `自动复制当前面板最新主调度提示词后打开 Codex 新会话（${state.project}）：深链不传提示词，不会自动发送，请粘贴发送`,
      missingTitle: '未检测到 ChatGPT.app（codex:// 深链宿主）：可能未安装或装在非默认路径；可直接打开 ChatGPT 手动新建会话并粘贴提示词' },
  ];
  return cfg.map((c) => {
    if (w[c.agent] === false) {
      return `<a class="ws-entry-link is-off" aria-disabled="true" data-new-session="${c.agent}" title="${esc(c.missingTitle)}">${c.label}<span class="ws-entry-note">（未检测到）</span></a>`;
    }
    if (noProject) {
      return `<a class="ws-entry-link is-off" aria-disabled="true" data-new-session="${c.agent}" title="未选择项目：请先在顶栏选择项目后再新建会话">${c.label}</a>`;
    }
    const url = c.agent === 'codex'
      ? `codex://threads/new?path=${encodeURIComponent(state.project)}`
      : `zcode://workspace/open?path=${encodeURIComponent(state.project)}`;
    return `<a class="ws-entry-link" href="${url}" data-new-session="${c.agent}" title="${esc(c.okTitle)}">${c.label}</a>`;
  }).join('');
}

// 深链宿主 app 探测：GET /api/workspace/apps（只读存在性检查）。
// BUG-20260910-005 状态机：probing 标记探测进行中；成功置 loaded（zcode/codex 为明确 boolean）；
// 失败置 failed 且不置 loaded（保持未知，不当作未安装），重试走 force（「重新检测」）。
// 探测结束（成功/失败）都重渲染一次，把「正在检测」刷成链接 / 禁用 / 失败重试态；
// 探测通道故障不得砍掉功能入口，且探测不阻断页签与提示词复制（异步 fire-and-forget）。
async function refreshWorkspaceApps(force = false) {
  const w = state.workspaceApps;
  if (w.loaded || w.probing || (w.failed && !force)) return;
  w.probing = true;
  w.failed = false;
  try {
    const r = await api('/api/workspace/apps');
    w.zcode = !!r.zcode;
    w.codex = !!r.codex;
    w.loaded = true;
  } catch {
    w.failed = true; // 保持未知：不置 loaded、不当作未安装；下次绑定不自动重试（手动「重新检测」）
  } finally {
    w.probing = false;
    renderBatchDrawer(); // 刷出头部入口的最终态（正在检测 → 链接 / 禁用 / 失败重试）
  }
}

function renderZcodeBatchPanel() {
  const data = state.batchData;
  if (!data) return '<p class="muted">加载中…</p>';
  // BUG-20260910-009：任务搜索（state.search.q）前端过滤本面板列表——待开发/待处理队列按编号/标题、
  // 处理记录按执行编号/编号/标题/执行器；概况页签与统计保持全量账面口径。
  // REQ-20260913-003：排队批次节已移除（去批次概念），本面板仅过滤队列与记录。
  // 可选链兼容既有 vm 桩测试的最小 state（无 search 时不过滤）
  const ql = String(state.search?.q || '').trim().toLowerCase();
  // BUG-20260909-006：勾选范围行（scopeLine）已随「进入批量开发」入口移除，候选恒为已计划队列
  if (!data.batch) {
    // 无任务：启动区（renderDevStartBar 已含「启动」按钮）+ 待处理队列（最近 2 条）
    const stats = data.stats || { candidates: 0, blocked: 0 };
    const queue = plannedQueue().map((it) => ({ id: it.id, title: it.title }));
    return `
      <section class="batch-create">
        <div class="batch-stats">已计划候选 <b>${stats.candidates}</b> · 受依赖阻塞 <b>${stats.blocked}</b>（最旧优先，实时读取；运行中新置计划的条目自动进入队列）</div>
        ${stats.candidates ? '' : '<div class="notice">暂无已计划候选：请先在看板接受条目，并在详情页「移入计划」（仅已计划且未被认领的条目进入实时队列）。</div>'}
      </section>
      ${pendingQueueHtml(queue, { action: '待开发', q: ql })}`;
  }
  const b = data.batch;
  const counts = data.counts || {};
  const rec = data.current;
  // REQ-20260909-011：终态「启动新一轮」去 Agent 化——无候选时禁用并说明原因（不靠接口报错兜底）
  const nextCandidates = plannedQueue().length > 0;
  // REQ-20260908-026：终态（已终止/已结束）不显示暂停/恢复控件，待处理记 0
  const terminal = b.aborted || b.status === 'finished';
  const batchDone = b.status === 'finished' && (counts.remaining ?? 0) === 0;
  // 无当前项按真实阶段展示：待启动 / 等待领取 / 已暂停 / 已结束（终态绝不显示等待领取）
  const currentText = rec
    ? `<span class="cid link" data-goto-item="${esc(rec.itemId)}" role="button">${esc(rec.itemId)}</span> ${esc(shortOwner(rec.title))}`
    : (b.aborted ? '任务已终止' : batchDone ? '本轮已结束' : b.pauseRequested ? '已暂停，等待恢复' : b.status === 'prepared' ? '待启动：请在 Agent 会话粘贴调度提示词' : '等待领取下一项');
  // 异常口径：失败 + 受阻回执 + 中断账（真实计数；出局/受阻待处理以附注保留账面）
  const abnormal = (counts.failed ?? 0) + (counts.blockedRuns ?? 0) + (counts.interrupted ?? 0);
  const extraParts = [];
  if (counts.skipped) extraParts.push(`出局 ${counts.skipped}`);
  if (counts.blocked) extraParts.push(`受阻待处理 ${counts.blocked}`);
  const nextDisabled = !nextCandidates;
  const nextTitle = nextCandidates ? '以已计划队列（最旧优先）重建任务并复制提示词' : '暂无已计划候选：请先在看板接受条目并「移入计划」';
  // REQ-20260909-008：运行态按二级页签归组（概况/队列/提示词/记录），单屏切换不再长滚动；
  // 当前分区记忆在 state.batch.pane，一级页签切换与轮询重渲染均不重置
  // REQ-20260913-003：去批次概念——概况不再显示轮次编号 chip；轮次排队节与相关排队/删除
  // 入口随批次排队能力一并移除；队列分区仅保留实时待处理队列。
  return taskPaneShell('develop', state.batch, {
    overview: `
      <div class="batch-status-line">
        <span class="chip batch-st ${b.aborted ? 's-aborted' : `s-${esc(b.status)}`}">${b.aborted ? '已终止' : batchStatusLabel(b.status)}</span>
        <span class="muted small">${taskAgentModeText(b)} · 创建 ${fmtTime(b.createdAt)}</span>
      </div>
      ${data.nextAction === 'needs_attention' ? `<div class="notice warn">${esc(data.notice || '执行状态待核对')}</div>` : ''}
      ${confirmQueueBannerHtml('develop')}
      ${b.aborted ? '<div class="notice warn">任务已人工终止：本轮全部处理记录已保留；在途子代理请在对应子代理会话人工停止。</div>' : ''}
      ${b.pauseRequested ? '<div class="notice info">已请求暂停后续领取：当前项继续执行，完成后暂停，不再领取下一项。</div>' : ''}
      ${batchDone && !b.aborted ? `<div class="notice ok">${esc(data.notice || '本轮已处理完毕')}</div>` : ''}
      ${batchDone ? `<div class="drawer-actions batch-actions">
        <button type="button" class="btn primary" id="batchNext" ${nextDisabled ? `disabled title="${nextTitle}"` : `title="${nextTitle}"`}>启动新一轮</button>
      </div>` : ''}
      <section class="meta-grid">
        <div><label>当前条目</label><span>${currentText}</span></div>
        <div><label>子代理会话</label><span>${rec ? esc(rec.owner) : '—'}</span></div>
        <div><label>开始时间</label><span>${rec ? fmtTime(rec.createdAt) : '—'}</span></div>
        <div><label>耗时</label><span>${rec ? `已用时 ${fmtElapsed(rec.createdAt)}` : '—'}</span></div>
        <div><label>最后活动</label><span>${fmtTime(b.lastActivityAt)}</span></div>
      </section>
      ${taskStatsLine({
        done: counts.reported ?? 0,
        abnormal,
        active: rec ? 1 : 0,
        remaining: terminal ? 0 : counts.remaining ?? 0,
        total: counts.total ?? 0,
        extra: extraParts.length ? ` · ${extraParts.join(' · ')}` : '',
      })}
      <div class="drawer-actions batch-actions">
        ${!terminal ? `<button type="button" class="btn ${b.pauseRequested ? 'primary' : 'warn'}" id="batchPause">${b.pauseRequested ? '恢复后续领取' : '暂停后续领取'}</button>` : ''}
        ${!batchDone ? '<button type="button" class="btn danger" id="batchAbort" title="停止派发后续项；剩余项出局；本轮记录保留；在途子代理需在对应会话人工停止">终止任务</button>' : ''}
      </div>
      <p class="muted small">「暂停后续领取」只阻止领取下一项（当前项继续）；立即停止正在运行的工具请到 Zcode 原生任务界面操作。</p>`,
    // 队列分区：仅实时待处理队列（终态待处理记 0，给空态说明而非空白）
    queue: !terminal
      ? pendingQueueHtml(data.pending || [], { action: '待开发', q: ql })
      : '<p class="muted small" style="margin:2px 0 0">任务已收尾：本轮待处理队列已清空。</p>',
    prompt: `
      <div class="batch-prompt-block">
        <div class="dep-toolbar">
          <span class="muted small">主调度提示词（在本项目的 Agent 会话粘贴发送，提示词通用）：</span>
          <button type="button" class="btn" id="batchRecopy" title="复制失败可重试；重试复制不会创建新任务">重新复制</button>
          <button type="button" class="btn" id="batchResumeCopy" title="主会话退出/压缩后，新会话用同一提示词续接">复制续接提示词</button>
        </div>
        <pre id="batchPrompt" class="batch-prompt" tabindex="0">${esc(b.prompt)}</pre>
      </div>`,
    records: runAttemptsHtml(data.records || [], data.recordsTotal ?? (data.records || []).length, 'develop', ql),
  });
}

/* ---------- 需求完善面板（REQ-20260907-003）：待接受条目批量补文档，Zcode / Codex 两种模式 ---------- */

// 数据拉取（随主轮询）：current（批次/计数/记录）+ candidates（创建面板候选与缺失原因）
// REQ-20260908-026：记录固定展示最近 2 次（服务端带 recordsTotal 与 attempt），分页加载已随上限移除
async function refreshRefine() {
  try {
    const [cur, cands] = await Promise.all([
      api('/api/refine/current'),
      api('/api/refine/candidates'),
    ]);
    const data = { ...cur, candidates: cands.candidates || [] };
    state.refine.data = data;
    await refreshConfirms(); // REQ-20260914-001：挂起确认区随轮询刷新（独立签名）
    const sig = JSON.stringify({
      b: data.batch, c: data.counts, n: data.nextAction, t: data.stats, rt: data.recordsTotal,
      d: data.candidates.map((x) => x.id + x.reasons.join()),
      r: (data.records || []).map((x) => x.runId + x.result + x.attempt + (x.summary || '') + (x.reason || '')),
    });
    if (sig === state.refine.sig) return;
    state.refine.sig = sig;
    renderBatchDrawer();
  } catch (e) {
    toast(e.message, true);
  }
}

// 候选缺失原因 chips 由共用 pendingQueueHtml 随队列行渲染（REQ-20260908-026）

function renderRefinePanel() {
  const data = state.refine.data;
  if (!data) return '<p class="muted">加载中…</p>';
  // BUG-20260910-009：任务搜索（state.search.q）前端过滤本面板列表——候选/待完善队列按编号/标题、
  // 处理记录按执行编号/编号/标题/执行器；候选统计与启动按钮资格保持全量口径。
  // 可选链兼容既有 vm 桩测试的最小 state（无 search 时不过滤）
  const ql = String(state.search?.q || '').trim().toLowerCase();
  if (!data.batch) {
    // 启动区：无进行中任务时显示；候选 = 已接受未完善（每轮实时读取），队列仅展示最近 2 条（REQ-20260908-026）
    // REQ-20260909-011：去 Agent 化——点击「启动」直接创建任务并复制通用主调度提示词；
    // 无候选时禁用并说明原因（BUG-20260908-016 口径保留，不再依赖 Agent 选择）
    const cands = data.candidates || [];
    return `
      <section class="batch-create refine-create">
        <p class="muted small" style="margin:0 0 6px">AI 分析：对已接受条目批量补全文档——需求补 README（描述 + 验收标准；涉及 UI 需含界面展示），Bug 补现象/复现步骤/期望行为/验收说明（涉及 UI 的 Bug 同样须提供可交互 ui-demo.html 演示）。派子代理只补文档：条目保持已接受、不写业务源码、未知事实标「待确认」。</p>
        <div class="batch-stats">候选：已接受未完善 <b>${cands.length}</b> 项（每轮实时读取，含本轮新接受的单）</div>
        ${cands.length ? `
        <div class="dep-toolbar">
          <button type="button" class="btn primary" id="refineCreate" title="创建任务并复制通用主调度提示词（子代理模型跟随主调度会话）">启动</button>
        </div>
        <p class="muted small">启动 = 创建任务并复制主调度提示词（复制成功 ≠ 执行中，登记运行后才算执行中）；提示词通用，可在任意一种 Agent 会话粘贴执行；条目保持 accepted，不占实施互斥。</p>` : `<div class="notice">暂无可完善候选：已接受条目均已完善（或尚无已接受条目）。</div>`}
      </section>
      ${pendingQueueHtml(cands, { action: '待完善', q: ql })}`;
  }
  const b = data.batch;
  const counts = data.counts || {};
  const rec = data.current;
  const lastReceipt = (data.records || [])[0] || null;
  const batchDone = b.status === 'finished' && (counts.remaining ?? 0) === 0;
  // BUG-20260914-001：正常收尾态（finished、未终止、未暂停、剩余 0）时服务端 notice 即收尾文案
  // （checkRefineBatch 同口径生成，与 CLI `atb refine check` 逐字一致），改由下方绿色 notice ok 条
  // 单条承接展示，不再以普通 notice 叠加重复渲染；终止/暂停/运行中等其余场景 notice 展示口径不变
  const doneNoticeOnly = batchDone && !b.aborted && !b.pauseRequested;
  // BUG-20260908-015：终态批次（已终止/已结束）不再提供「暂停后续」入口，与「终止任务」收尾后隐藏口径一致
  const batchTerminal = b.aborted || b.status === 'finished';
  // BUG-20260908-014：重启动口按「批次已收尾」判定（含终止态），终止后仍可启动新任务；
  // 无候选（实时口径）时按钮禁用并说明，不靠创建接口报错兜底
  // REQ-20260909-011：终态「启动新一轮」去 Agent 化（不再内嵌执行 Agent 选择）
  const nextCands = (data.candidates || []).length > 0;
  const nextDisabled = !nextCands;
  const nextTitle = !nextCands
    ? '暂无可完善候选：已接受条目均已完善（或尚无已接受条目）'
    : '以当前已接受未完善候选创建新任务';
  const curTitle = rec ? (rec.itemTitle || '') : '';
  // REQ-20260908-026：无当前项按真实阶段展示；终态绝不显示「等待领取」
  const currentText = rec
    ? `<span class="cid link" data-goto-item="${esc(rec.itemId)}" role="button">${esc(rec.itemId)}</span> ${esc(shortOwner(curTitle))}`
    : (b.aborted ? '任务已终止' : batchDone ? '本轮已结束' : b.pauseRequested ? '已暂停，等待恢复' : b.status === 'prepared' ? '待启动：请在 Agent 会话粘贴调度提示词' : '等待领取下一项');
  // REQ-20260909-008：运行态按二级页签归组（概况/队列/提示词/记录），当前分区记忆在
  // state.refine.pane（与批量开发相互独立），一级页签切换与轮询重渲染均不重置
  return taskPaneShell('refine', state.refine, {
    overview: `
      <div class="batch-status-line">
        <span class="chip batch-st ${b.aborted ? 's-aborted' : `s-${esc(b.status)}`}">${b.aborted ? '已终止' : batchStatusLabel(b.status)}</span>
        <span class="muted small">${taskAgentModeText(b)} · 创建 ${fmtTime(b.createdAt)}</span>
      </div>
      ${data.notice && !doneNoticeOnly ? `<div class="notice">${esc(data.notice)}</div>` : ''}
      ${confirmQueueBannerHtml('analyze')}
      ${b.aborted ? '<div class="notice warn">任务已人工终止：本轮全部处理记录已保留；在途子代理请在对应子代理会话人工停止；终止后可立即「启动新一轮」。</div>' : ''}
      ${b.pauseRequested ? '<div class="notice info">已请求暂停后续领取：当前项继续执行，完成后暂停，不再领取下一项。</div>' : ''}
      ${batchDone && !b.aborted ? `<div class="notice ok">${esc(data.notice || '本轮完善队列已处理完毕（条目均保持已接受，后续流转由人工判断）')}</div>` : ''}
      ${batchDone ? `<div class="drawer-actions batch-actions">
        <button type="button" class="btn primary" id="refineNext" ${nextDisabled ? `disabled title="${nextTitle}"` : `title="${nextTitle}"`}>启动新一轮</button>
      </div>` : ''}
      <section class="meta-grid">
        <div><label>当前条目</label><span>${currentText}</span></div>
        <div><label>子代理会话</label><span>${rec ? esc(rec.owner) : '—'}</span></div>
        <div><label>开始时间</label><span>${rec ? fmtTime(rec.createdAt) : '—'}</span></div>
        <div><label>耗时</label><span>${rec ? `已用时 ${fmtElapsed(rec.createdAt)}` : '—'}</span></div>
        <div><label>最近回执</label><span class="small" title="${esc(String(lastReceipt ? (lastReceipt.summary || lastReceipt.reason || '') : ''))}">${esc(shortOwner(String(lastReceipt ? (lastReceipt.summary || lastReceipt.reason || '—') : '—')))}</span></div>
        <div><label>最后活动</label><span>${fmtTime(b.lastActivityAt)}</span></div>
      </section>
      ${taskStatsLine({
        done: counts.done ?? 0,
        abnormal: (counts.failed ?? 0) + (counts.interrupted ?? 0),
        active: rec ? 1 : 0,
        remaining: batchTerminal ? 0 : counts.remaining ?? 0,
        total: counts.total ?? 0,
        extra: counts.skipped ? ` · 出局 ${counts.skipped}` : '',
      })}
      <div class="drawer-actions batch-actions">
        ${!batchTerminal ? `<button type="button" class="btn ${b.pauseRequested ? 'primary' : 'warn'}" id="refinePause">${b.pauseRequested ? '恢复后续领取' : '暂停后续领取'}</button>` : ''}
        ${!batchDone ? '<button type="button" class="btn danger" id="refineAbort" title="停止派发后续项；剩余项出局；本轮记录保留；在途子代理需在对应会话人工停止">终止任务</button>' : ''}
      </div>`,
    // 队列分区：待完善队列（终态给空态说明而非空白）
    queue: !batchTerminal
      ? pendingQueueHtml(data.candidates || [], { action: '待完善', q: ql })
      : '<p class="muted small" style="margin:2px 0 0">任务已收尾：待完善队列已清空（条目保持已接受）。</p>',
    // 提示词分区：存量批次可能缺失提示词，页签保留并给空态说明；
    // 会话入口已迁至头部一级页签旁（BUG-20260910-005），提示词分区不再承载
    prompt: b.prompt ? `
      <div class="batch-prompt-block">
        <div class="dep-toolbar">
          <span class="muted small">主调度提示词（在本项目的 Agent 会话粘贴发送，提示词通用）：</span>
          <button type="button" class="btn" id="refineRecopy" title="重试复制不会创建新任务">重新复制</button>
        </div>
        <pre id="refinePrompt" class="batch-prompt" tabindex="0">${esc(b.prompt)}</pre>
      </div>` : '<p class="muted small">暂无调度提示词。</p>',
    records: runAttemptsHtml(data.records || [], data.recordsTotal ?? (data.records || []).length, 'refine', ql),
  });
}

// 完善执行记录渲染已由 REQ-20260908-026 的共用 runAttemptsHtml 承接（四列表格、最近 2 次尝试）；
// BUG-20260908-018 的记录分页交互随 2 条展示上限移除——完整账本与计数不受影响。

// 启动完善任务（REQ-20260908-020 子代理模式）：创建任务并复制通用主调度提示词
// REQ-20260909-011：去 Agent 化——不再选择/提交执行 Agent（提示词单一通用版，
// 可在任意一种 Agent 会话粘贴执行；服务端忽略遗留的 mode 入参）
// REQ-20260910-027：开发人员设置已移除——不再提交该值、无 localStorage 记忆回退
async function createRefineBatchAndCopy() {
  try {
    const res = await api('/api/refine/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (res.created === false) {
      const copied = await copyDispatchText(res.prompt);
      toast(`未新建完善任务：已有未结束的完善任务（幂等返回）${copied ? '，已复制其提示词' : ''}`, true);
    } else {
      const copied = await copyDispatchText(res.prompt);
      // REQ-20260908-026：统一成功口径——任务已创建、提示词已复制（复制成功 ≠ 执行中）
      if (copied) toast(`✓ 任务已创建、提示词已复制，请在对应项目会话粘贴发送（候选 ${res.counts.candidates}，子代理模式；状态：待启动）`);
      else toast('任务已创建，但复制失败：请展开提示词手动复制，或点「重新复制」（不会创建新任务）', true);
    }
    state.refine.sig = '';
    await refreshRefine();
  } catch (e) {
    toast(e.message, true);
  }
}

async function toggleRefinePause() {
  const b = state.refine.data?.batch;
  if (!b) return;
  try {
    await api('/api/refine/pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // REQ-20260913-003：缺省解析队首账本，前端不再传批次号
      body: JSON.stringify({ paused: !b.pauseRequested }),
    });
    state.refine.sig = '';
    await refreshRefine();
  } catch (e) {
    toast(e.message, true);
  }
}

// REQ-20260908-020 终止批量完善任务：二次确认 → 停止派发、剩余项出局、在途提示人工停止
async function abortRefineTask() {
  const b = state.refine.data?.batch;
  if (!b) return;
  const ok = await uiConfirm({
    title: '终止 AI 分析任务？',
    message: '确认后停止派发后续项：账本剩余未领取项标记出局，在途项标记人工终止并释放占用；本轮全部处理记录保留。在途子代理需在对应 Agent 会话人工停止。终止后可立即「启动新一轮」。',
    confirmText: '终止任务',
    danger: true,
  });
  if (!ok) return;
  try {
    const r = await api('/api/refine/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    toast(`✓ 已终止完善任务：${r.notice || ''}`);
    state.refine.sig = '';
    await refreshRefine();
  } catch (e) {
    toast(e.message, true);
  }
}

// REQ-20260908-020 终止批量开发任务：二次确认 → 停止派发、剩余项出局、在途提示人工停止
async function abortDevTask() {
  const b = state.batchData?.batch;
  if (!b) return;
  const ok = await uiConfirm({
    title: '终止 AI 开发任务？',
    message: '确认后停止派发后续项：账本剩余未领取项标记出局，在途项标记人工终止并释放项目占用（已认领条目的业务状态不动，由人工后续处理）；本轮全部处理记录保留。在途子代理需在对应 Agent 会话人工停止。终止后可立即「启动新一轮」。',
    confirmText: '终止任务',
    danger: true,
  });
  if (!ok) return;
  try {
    const r = await api('/api/batch/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    toast(`✓ 已终止开发任务：${r.notice || ''}`);
    state.batchSig = '';
    await refreshBatch();
  } catch (e) {
    toast(e.message, true);
  }
}

/* ---------- 已完成条目提交状态（BUG-20260910-014 保留部分）：列表徽标 + 详情字段 ---------- */
/* REQ-20260911-010：批量 Commit 面板（页签/启动区/运行面板/记录/创建/暂停/终止）已随人工
   批量提交流程回退整体移除；本节仅保留提交状态展示（取数换源 /api/commit/item-status →
   REQ-20260911-009 索引）。BUG-20260912-003：展示格式调整——去掉「已提交」徽标与
   「N 个提交号」折叠层，提交号只显示前 5 位短号直显，双击短号复制完整 40 位 hash。 */

// BUG-20260912-003：提交号只展示前 5 位（用户明确要求 5 位）；完整值保留在 title 与复制口径中
function commitShortHash(h) {
  return String(h).slice(0, 5);
}

// 提交号列表：5 位短号直显（完整 hash 悬停 title 可见）；双击短号复制完整值（data-copy-hash →
// bindCommitWidgets dblclick），复制失败可手动框选完整值
function commitHashListHtml(hashes) {
  return `<div class="commit-hash-list">${hashes.map((h) => `
    <code class="commit-hash" title="完整提交号：${esc(h)}（双击复制完整值）" data-copy-hash="${esc(h)}">${esc(commitShortHash(h))}</code>`).join('')}</div>`;
}

// 已完成（done）条目专属：默认未提交；有经核验的成功提交记录（item-status 索引）原位直显短提交号。
// 查询失败显示「提交状态加载失败」并给重试入口——不伪装成未提交，也不抹掉已成功加载的数据。
// REQ-20260911-009：待测试（in-progress 且已上报）条目同样展示——到待测试自动提交完成后
// 提交号随之点亮（与「待测试」角标并列，索引同源）。
// BUG-20260912-003：不再渲染「已提交」徽标——inline（列表卡片）在有记录时直显短提交号；
// 详情位（非 inline）返回空串，由 commitStatusDetailHtml 渲染同一列表，口径一致不重复。
function commitBadgeHtml(it, { inline = false } = {}) {
  if (it.status !== 'done' && !(it.status === 'in-progress' && it.agentCompletedAt)) return '';
  const cs = state.commitStatus || { map: {}, error: null };
  if (cs.error) {
    return `<button type="button" class="commit-badge cm-error" data-commit-retry title="提交状态查询失败：${esc(cs.error)}。点击重试；已加载的成功记录保留。">提交状态加载失败</button>`;
  }
  const rec = (cs.map || {})[it.id];
  const hashes = (rec && rec.commits) || [];
  if (!hashes.length) {
    return `<span class="commit-badge cm-uncommitted" title="尚无关联提交（自动提交完成后更新标记）">未提交</span>`;
  }
  return inline ? commitHashListHtml(hashes) : '';
}

// 详情页提交状态补充：短提交号列表（双击逐个复制完整值）；错误态给重试按钮
function commitStatusDetailHtml(it) {
  const cs = state.commitStatus || { map: {}, error: null };
  if (cs.error) {
    return ' <button type="button" class="btn small" data-commit-retry title="重新读取提交状态">重试读取</button>';
  }
  const rec = (cs.map || {})[it.id];
  const hashes = (rec && rec.commits) || [];
  return hashes.length ? commitHashListHtml(hashes) : '';
}

// 数据拉取（随主轮询，独立于 /api/board）：失败保留上次数据并记录错误（下轮自动重试）
async function refreshCommitStatus() {
  const cs = state.commitStatus;
  cs.loading = true;
  try {
    const r = await api('/api/commit/item-status');
    cs.loading = false;
    cs.error = null;
    cs.map = r.statuses || {};
  } catch (e) {
    cs.loading = false;
    cs.error = e.message; // 保留上一次数据：已有成功记录不因后续失败消失
  }
  const sig = JSON.stringify([cs.error, cs.map]);
  if (sig === cs.sig) return;
  cs.sig = sig;
  renderBoard(); // 列表徽标随提交状态刷新（列表签名内部剪枝）
  if (state.drawer.id && state.drawer.item) renderDrawer(); // 详情提交状态字段同步
}

// 重试入口（徽标 / 详情「重试读取」）：绕过签名强制重拉
async function retryCommitStatus() {
  state.commitStatus.sig = '';
  await refreshCommitStatus();
}

// 提交号双击复制 / 状态重试：均不冒泡（不打断行点击打开详情）
function bindCommitWidgets(root) {
  for (const el of root.querySelectorAll('[data-copy-hash]')) {
    el.addEventListener('click', (e) => e.stopPropagation()); // BUG-20260912-003：双击前的单击不冒泡（不误开详情抽屉）
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      return copyHash(el.dataset.copyHash, el); // 双击短号复制完整 40 位 hash
    });
  }
  for (const el of root.querySelectorAll('[data-commit-retry]')) {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      return retryCommitStatus();
    });
  }
}

// 完整提交号复制（口径对齐 copyId：clipboard → execCommand 降级；失败提示手动框选完整值）。
// BUG-20260912-003：复制对象从「复制」按钮变为短提交号 code——成功反馈改为 copied 高亮 +
// toast（不再改写文本内容），复制内容仍为完整 40 位 hash。
async function copyHash(hash, el) {
  if (!el || el.dataset.copied) return;
  el.dataset.copied = '1'; // 异步复制和反馈期间防止重复触发
  let ok = false;
  try {
    await navigator.clipboard.writeText(hash);
    ok = true;
  } catch {
    let ta;
    try {
      ta = document.createElement('textarea');
      ta.value = hash;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
    } catch {} finally {
      ta?.remove();
    }
  }
  if (ok) {
    el.classList.add('copied');
    toast(`✓ 已复制完整提交号 ${commitShortHash(hash)}…`);
    setTimeout(() => {
      el.classList.remove('copied');
      delete el.dataset.copied;
    }, 1200);
  } else {
    delete el.dataset.copied;
    toast('复制失败，请手动框选完整提交号', true);
  }
}

// 开发批次记录渲染已由 REQ-20260908-026 的共用 runAttemptsHtml 承接（四列表格、最近 2 次尝试）；
// 批次记录全量列表与分页随之移除——完整账本与计数不受影响，条目详情沿用需求面板查看。

// REQ-20260911-008「去新建 XX 会话」两步并一步：守卫通过后，先把当前面板任务的最新主调度
// 提示词写入剪贴板（copyDispatchText），复制动作完成后才触发深链跳转——用户到新会话直接
// 粘贴发送（深链不会自动发送：zcode 只打开工作区、codex 不传 prompt）。
// 取材与各面板提示词分区、「重新复制」同源：批量完善 = state.refine 当前任务提示词；
// 批量开发（含存量 codex 深链面板，条目待确认项定案：同批量开发口径）= GET /api/batch/prompt
// （解析队首批次，不新建批次；存量提示词按 BUG-20260910-001 归一口径返回）。
// REQ-20260911-010：批量 Commit 提示词取材分支随面板回退移除。
// 失败不静默且深链照常打开（打开不依赖提示词；获取/复制失败各有明确 toast 与回面板
// 「重新复制」的补救指引）；GET 失败单次尝试不自动重试；busy 防重复点击（在途点击直接忽略）。
let sessionEntryBusy = false;
async function copyPromptAndOpenSession(agent, url) {
  if (sessionEntryBusy) return;
  sessionEntryBusy = true;
  try {
    const label = agent === 'codex' ? 'Codex 新会话' : 'Zcode 工作区';
    let prompt = null;
    let fetchErr = null;
    if (state.batch.mode === 'refine') {
      prompt = state.refine.data?.batch?.prompt || null;
    } else {
      try {
        const res = await api('/api/batch/prompt'); // 同「重新复制」：重复获取同一批次提示词，不新建批次
        prompt = res?.prompt || null;
      } catch (e) {
        fetchErr = e;
      }
    }
    if (fetchErr) {
      location.href = url;
      toast(`提示词获取失败（${fetchErr.message}）：已请求打开 ${label}，请回任务面板点「重新复制」后再粘贴`, true);
      return;
    }
    if (!prompt) {
      location.href = url;
      toast(`当前面板暂无任务提示词，请先创建任务；已请求打开 ${label}（${state.project}），可稍后从提示词分区「重新复制」`);
      return;
    }
    const copied = await copyDispatchText(prompt); // 失败时其 toast 由下方完整指引覆盖
    location.href = url;
    if (copied) {
      toast(`✓ 已复制提示词并请求打开 ${label}（${state.project}）：请在新建会话中粘贴发送`);
    } else {
      toast(`复制失败：已请求打开 ${label}（${state.project}），请回任务面板点「重新复制」后再粘贴`, true);
    }
  } finally {
    sessionEntryBusy = false;
  }
}

function bindBatchDrawer() {
  const drawer = $('#batchDrawer');
  // BUG-20260909-002：头部「任务设置」按钮及其跳转绑定已删除（设置统一走主导航「设置」页签）
  // BUG-20260909-014：头部「✕」关闭按钮及其返回需求模块绑定已删除（离开任务模块走第二行导航页签）
  for (const b of drawer.querySelectorAll('[data-bmode]')) {
    b.addEventListener('click', () => {
      state.batch.mode = b.dataset.bmode;
      saveViewSnapshot(); // REQ-20260910-001：任务一级页签进入快照
      renderBatchDrawer();
      refreshBatch(); // 切换子面板即时拉取该面板数据（不等下一轮轮询）
    });
  }
  // REQ-20260909-008：二级页签切换（纯前端；当前页签随 state.batch.pane / state.refine.pane
  // 各自记忆，一级页签来回切换与轮询重渲染均不重置，切回时恢复对应分区）
  for (const b of drawer.querySelectorAll('.task-pane-tab')) {
    b.addEventListener('click', () => activateTaskPane(b.dataset.taskScope, b.dataset.taskPane));
  }
  // REQ-20260909-011：收尾「启动新一轮」去 Agent 化——点击直接复用创建流程（REQ-20260906-022），
  // 不再校验/提交执行 Agent 选择
  const nextBtn = drawer.querySelector('#batchNext');
  if (nextBtn) nextBtn.addEventListener('click', () => createBatchAndCopy());
  const recopy = drawer.querySelector('#batchRecopy');
  if (recopy) recopy.addEventListener('click', () => copyBatchPrompt('已复制提示词；请在当前项目的 Agent 会话粘贴发送'));
  const resumeCopy = drawer.querySelector('#batchResumeCopy');
  if (resumeCopy) resumeCopy.addEventListener('click', () => copyBatchPrompt('已复制续接提示词；新主会话粘贴发送后先核对再继续'));
  // BUG-20260910-005：头部「去新建 XX 会话」超链接（两面板共用绑定，data-new-session=zcode|codex）。
  // 单一触发路径（preventDefault 后统一按最新 state.project 构造深链）：鼠标点击与键盘
  // （聚焦后 Enter 触发 click）行为一致；点击不切页签、不重渲染、不动批次与队列；
  // zcode 沿用官方 workspace/open 深链（只打开工作区，会话需手动新建）、codex 走
  // threads/new?path=（不传 prompt，不注入、不发送）。
  // REQ-20260911-008：守卫通过后先自动复制当前面板最新提示词再跳深链（copyPromptAndOpenSession，
  // 复制完成后在函数内触发深链与 toast）；浏览器无法确认外部应用启动结果：只提示「已请求打开」，
  // 不宣称会话创建成功；未选项目 / 未检测到时点击仅说明原因，不导航也不复制。
  for (const el of drawer.querySelectorAll('[data-new-session]')) {
    el.addEventListener('click', (ev) => {
      ev?.preventDefault?.();
      const agent = el.dataset.newSession;
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
  // 探测失败后的「重新检测」（force 绕过 failed 防重，探测结束自动重渲染刷出结果）
  const wsRetry = drawer.querySelector('[data-ws-retry]');
  if (wsRetry) wsRetry.addEventListener('click', (ev) => { ev?.preventDefault?.(); refreshWorkspaceApps(true); });
  refreshWorkspaceApps(); // 宿主探测（fire-and-forget；成功/失败均重渲染刷出头部入口最终态）
  const pauseBtn = drawer.querySelector('#batchPause');
  if (pauseBtn) pauseBtn.addEventListener('click', toggleBatchPause);
  // REQ-20260913-003：去批次概念——轮次排队与删除相关入口随批次排队能力移除
  // REQ-20260908-026：本轮处理记录「重新执行」（异常/已中断记录）
  for (const el of drawer.querySelectorAll('[data-retry-run]')) {
    el.addEventListener('click', () => retryRunFromRecord(el.dataset.retryRun, el.dataset.retryKind));
  }
  // 需求完善面板（REQ-20260907-003；REQ-20260909-011 起 Agent 选择控件已移除，无 change 草稿）
  const rfCreate = drawer.querySelector('#refineCreate');
  if (rfCreate) rfCreate.addEventListener('click', createRefineBatchAndCopy);
  const rfNext = drawer.querySelector('#refineNext');
  if (rfNext) rfNext.addEventListener('click', createRefineBatchAndCopy); // 复用同一创建流程
  const rfPause = drawer.querySelector('#refinePause');
  if (rfPause) rfPause.addEventListener('click', toggleRefinePause);
  const rfAbort = drawer.querySelector('#refineAbort');
  if (rfAbort) rfAbort.addEventListener('click', abortRefineTask);
  const devAbort = drawer.querySelector('#batchAbort');
  if (devAbort) devAbort.addEventListener('click', abortDevTask);
  const rfRecopy = drawer.querySelector('#refineRecopy');
  if (rfRecopy) rfRecopy.addEventListener('click', async () => {
    const p = state.refine.data?.batch?.prompt;
    const copied = p ? await copyDispatchText(p) : false;
    toast(copied ? '已复制提示词；请在当前项目的 Agent 会话粘贴发送' : '复制失败：请手动选中提示词文本复制', !copied);
  });
  // REQ-20260911-010：批量 Commit 面板按钮绑定（启动/暂停/终止/重新复制）已随面板回退移除；
  // bindCommitWidgets 保留——已完成条目徽标/详情的提交号复制与提交状态重试共用
  bindCommitWidgets(drawer);
  for (const el of drawer.querySelectorAll('[data-goto-item]')) {
    el.addEventListener('click', () => openDrawer(el.dataset.gotoItem));
  }
}

async function createBatchAndCopy(opts = {}) {
  // REQ-20260908-019：上限设置已移除，创建请求只带范围
  // REQ-20260909-011：去 Agent 化——不再提交执行 Agent（提示词单一通用版，可在任意一种
  // Agent 会话粘贴执行；服务端忽略遗留的 agent 入参）
  // REQ-20260910-027：开发人员设置已移除——不再提交该值、无 localStorage 记忆回退
  // REQ-20260908-026：opts.ids 显式范围（终态任务重试以单条目重建新任务）；
  // BUG-20260909-006：列表勾选集合回退已移除——缺省即为已计划队列全量候选
  // REQ-20260913-003：去批次概念——重复启动由服务端 400 明确提示（同一时间只有一轮执行），
  // 不再存在排队/幂等返回分支；成功回执不携带批次号。
  const ids = (opts.ids && opts.ids.length) ? [...opts.ids] : null;
  try {
    const res = await api('/api/batch/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids ? { ids } : {}),
    });
    if (res.created === false) {
      // 幂等返回旧轮（并发窗口）：如实说明未新建，不宣称「已创建」（REQ-20260906-022）
      const copied0 = await copyDispatchText(res.prompt);
      toast(`未新建任务：当前任务尚未结束${copied0 ? '，已复制其提示词' : '；复制失败请在下方手动复制'}`, true);
    } else {
      const copied = await copyDispatchText(res.prompt);
      if (copied) {
        // REQ-20260908-026：统一成功口径——任务已创建、提示词已复制
        toast(`✓ 任务已创建、提示词已复制，请在对应项目会话粘贴发送（候选 ${res.counts.candidates}，受阻 ${res.counts.blocked}；状态：待启动）`);
      } else {
        toast('任务已创建，但复制失败：请在下方选中提示词手动复制，或点「重新复制」（不会产生新任务）', true);
      }
    }
    state.batchSig = '';
    await refreshBatch();
  } catch (e) {
    toast(e.message, true);
  }
}

async function copyBatchPrompt(okMsg) {
  try {
    const res = await api('/api/batch/prompt'); // 重复获取同一轮任务提示词，不新建任务
    const copied = await copyDispatchText(res.prompt);
    if (copied) toast(`✓ ${okMsg}`);
    else toast('复制失败：请手动选中提示词文本复制', true);
  } catch (e) {
    toast(e.message, true);
  }
}

// REQ-20260913-003：删除未在执行轮次的页面入口随批次排队概念移除——
// 前端不再提供该删除操作（服务端删除路由保留，供 CLI 处理存量账本）。

async function toggleBatchPause() {
  const b = state.batchData?.batch;
  if (!b) return;
  try {
    await api('/api/batch/pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // REQ-20260913-003：缺省解析队首账本，前端不再传批次号
      body: JSON.stringify({ paused: !b.pauseRequested }),
    });
    state.batchSig = '';
    await refreshBatch();
  } catch (e) {
    toast(e.message, true);
  }
}

/* ---------- 条目详情：批量执行设置（依赖策略，REQ-20260906-002） ---------- */

function depOptionsHtml(it) {
  const q = (state.drawer.depFilter || '').toLowerCase();
  const deps = new Set(state.drawer.deps || []);
  const items = (state.board?.items || [])
    .filter((x) => x.id !== it.id)
    .filter((x) => !q || x.id.toLowerCase().includes(q) || String(x.title || '').toLowerCase().includes(q));
  if (!items.length) return '<p class="muted small">没有匹配的条目</p>';
  return items.map((x) => `
    <label class="dep-option">
      <input type="checkbox" value="${esc(x.id)}" ${deps.has(x.id) ? 'checked' : ''}>
      <span class="state-dot s-${x.status}"></span>
      <span class="cid dep-id">${esc(x.id)}</span>
      <span class="dep-title">${esc(x.title)}</span>
    </label>`).join('');
}

function batchSettingsHtml(it) {
  const deps = state.drawer.deps || [];
  const lastRec = (state.batchData?.records || []).find((r) => r.itemId === it.id);
  const lastCx = it.lastCodexRun;
  const cxModel = lastCx && lastCx.model;
  return `
    <details class="dep-settings" id="depSettings">
      <summary>批量执行设置（依赖 ${deps.length} 项）</summary>
      <p class="muted small">前置条目人工验收完成后才自动实施；父子归属不算依赖。</p>
      ${lastRec ? `<p class="small dep-last">最近 Zcode 执行：${RUN_RESULT_LABEL[lastRec.result] || esc(lastRec.result)} · ${fmtTime(lastRec.at)} · <span class="link" id="depOpenRecords" role="button">查看执行记录</span></p>` : ''}
      ${lastCx ? `<p class="small dep-last">最近 Codex 执行：${CX_PHASE_LABEL[lastCx.phase] || esc(lastCx.phase)} · ${fmtTime(lastCx.endedAt)}${cxModel ? ` · 模型 <code>${esc(cxModel.modelId)}</code> / ${esc(cxModel.reasoningEffort)}（${esc(CX_SOURCE_LABEL[cxModel.source] || cxModel.source || '')}）` : ' · 历史记录未记录模型'} · <span class="link" id="depOpenCodexRun" data-cxrun="${esc(lastCx.runId)}" role="button">查看执行记录</span></p>` : ''}
      ${it.modelPending ? `<div class="notice warn">模型配置待处理：${esc(CX_PENDING_LABEL[it.modelPending.kind] || it.modelPending.kind)} —— ${esc(String(it.modelPending.summary || '').slice(0, 140))}。请到「设置 → 模型与推理强度」处理。</div>` : ''}
      <div class="dep-toolbar"><input id="depFilter" type="search" placeholder="搜索编号 / 标题过滤条目"></div>
      <div class="dep-list" id="depList">${depOptionsHtml(it)}</div>
      <div class="dep-foot">
        <span id="depError" class="dep-error"></span>
        <button type="button" class="btn" id="depSave">保存依赖</button>
      </div>
      <details class="dep-settings cx-item-model" id="cxItemModel" style="margin-top:8px">
        <summary>Codex 模型（默认继承项目设置）</summary>
        <p class="muted small">本项指定优先于项目默认；保存仅影响本项后续新执行，进行中的执行与续跑保持原设置。</p>
        <label class="field-inline">配置方式
          <select id="cxItemModelMode">
            <option value="inherit" ${(state.drawer.itemModel || { mode: 'inherit' }).mode !== 'explicit' ? 'selected' : ''}>继承项目设置</option>
            <option value="explicit" ${(state.drawer.itemModel || {}).mode === 'explicit' ? 'selected' : ''}>本项指定</option>
          </select>
        </label>
        <div id="cxItemModelForm" class="cx-model-form">
          <label class="field-inline">模型
            <input id="cxItemModelId" list="cxItemModelList" value="${esc((state.drawer.itemModel || {}).modelId || '')}" placeholder="模型 ID" size="24">
            <datalist id="cxItemModelList">${(state.codex.models && state.codex.models.ok ? state.codex.models.models : []).map((m) => `<option value="${esc(m.slug)}">`).join('')}</datalist>
            <span class="muted small">不在目录中也可输入（标注尚未验证）</span>
          </label>
          <label class="field-inline">推理强度
            <input id="cxItemEffortId" value="${esc((state.drawer.itemModel || {}).reasoningEffort || '')}" placeholder="如 high" size="12">
          </label>
        </div>
        <div class="dep-foot">
          <span id="cxItemModelError" class="dep-error"></span>
          <button type="button" class="btn" id="cxItemModelSave">保存本项模型设置</button>
        </div>
      </details>
    </details>`;
}

function bindBatchSettings(drawer, it) {
  const details = drawer.querySelector('#depSettings');
  if (!details) return;
  details.addEventListener('toggle', async () => {
    if (!details.open || state.drawer.depsFetched) return;
    state.drawer.depsFetched = true;
    // 模型目录懒加载（REQ-20260906-024）：条目模型选择复用同一只读目录
    if (state.codex.models === undefined) {
      try { state.codex.models = await api('/api/dispatch/codex/models'); } catch { state.codex.models = null; }
    }
    try {
      const p = await api(`/api/item/${encodeURIComponent(it.id)}/policy`);
      state.drawer.deps = p.dependsOn || [];
      state.drawer.itemModel = p.modelSelection || { mode: 'inherit' }; // REQ-20260906-024
      details.querySelector('#depList').innerHTML = depOptionsHtml(it);
      const sum = details.querySelector('summary');
      if (sum) sum.textContent = `批量执行设置（依赖 ${state.drawer.deps.length} 项）`;
      // 直接回填模型表单（不重渲染抽屉，避免折叠态被打断）
      const sel = state.drawer.itemModel;
      const modeEl = details.querySelector('#cxItemModelMode');
      if (modeEl) modeEl.value = sel.mode === 'explicit' ? 'explicit' : 'inherit';
      const idEl = details.querySelector('#cxItemModelId');
      if (idEl) idEl.value = sel.mode === 'explicit' ? (sel.modelId || '') : '';
      const efEl = details.querySelector('#cxItemEffortId');
      if (efEl) efEl.value = sel.mode === 'explicit' ? (sel.reasoningEffort || '') : '';
      const dl = details.querySelector('#cxItemModelList');
      if (dl && state.codex.models && state.codex.models.ok) {
        dl.innerHTML = state.codex.models.models.map((m) => `<option value="${esc(m.slug)}">`).join('');
      }
      syncItemModelForm(details);
    } catch (e) {
      toast(e.message, true);
    }
  });
  const filter = drawer.querySelector('#depFilter');
  if (filter) filter.addEventListener('input', () => {
    state.drawer.depFilter = filter.value;
    details.querySelector('#depList').innerHTML = depOptionsHtml(it);
  });
  const save = drawer.querySelector('#depSave');
  if (save) save.addEventListener('click', async () => {
    const ids = [...drawer.querySelectorAll('#depList input[type="checkbox"]:checked')].map((x) => x.value);
    const err = drawer.querySelector('#depError');
    if (err) err.textContent = '';
    try {
      const res = await api(`/api/item/${encodeURIComponent(it.id)}/policy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependsOn: ids }),
      });
      state.drawer.deps = res.dependsOn || [];
      toast(`✓ 已保存 ${it.id} 的批量执行依赖（${state.drawer.deps.length} 项）`);
    } catch (e) {
      if (err) err.textContent = e.message; // 校验错误（不存在/自依赖/环）就地反馈
    }
  });
  const openCx = drawer.querySelector('#depOpenCodexRun');
  if (openCx) openCx.addEventListener('click', async (e) => {
    e.preventDefault();
    await gotoRuns('codex');
    openRunDetail(openCx.dataset.cxrun);
  });
  const openRecs = drawer.querySelector('#depOpenRecords');
  if (openRecs) openRecs.addEventListener('click', () => {
    // REQ-20260908-026：批次记录入口收敛为任务面板「本轮处理记录」（最近 2 次，条目详情沿用需求面板查看）
    gotoRuns('develop');
  });
  bindCxItemModel(drawer, it);
}

// REQ-20260906-024：条目级「Codex 模型」折叠区交互（保存仅影响本项后续新执行）
function syncItemModelForm(scope) {
  const mode = scope.querySelector('#cxItemModelMode');
  const form = scope.querySelector('#cxItemModelForm');
  if (mode && form) form.style.display = mode.value === 'explicit' ? '' : 'none';
}

function bindCxItemModel(drawer, it) {
  const scope = drawer.querySelector('#cxItemModel');
  if (!scope) return;
  const mode = scope.querySelector('#cxItemModelMode');
  if (mode) mode.addEventListener('change', () => syncItemModelForm(scope));
  const save = scope.querySelector('#cxItemModelSave');
  if (save) save.addEventListener('click', async () => {
    const err = scope.querySelector('#cxItemModelError');
    if (err) err.textContent = '';
    const sel = mode.value === 'explicit'
      ? { mode: 'explicit', modelId: scope.querySelector('#cxItemModelId').value.trim(), reasoningEffort: scope.querySelector('#cxItemEffortId').value.trim() }
      : { mode: 'inherit' };
    try {
      const res = await api(`/api/item/${encodeURIComponent(it.id)}/policy`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelSelection: sel }),
      });
      state.drawer.itemModel = res.modelSelection;
      toast(`✓ 已保存 ${it.id} 的模型设置：将用于后续新执行；当前执行与续跑保持原设置`);
    } catch (e) {
      if (err) err.textContent = e.message; // 非法组合/形态就地提示，不静默替换
    }
  });
}

/* ---------- 事件绑定与启动 ---------- */

// REQ-20260907-004：任务模块页面化（原批量抽屉遮罩移除）；
// REQ-20260908-020：Codex 自动派发入口已隐藏，顶栏待处理徽标改跳设置模块（模型与推理强度），无死链
$('#cxPendingBadge').addEventListener('click', () => setView('settings'));
$('#btnNew').addEventListener('click', () => openModal());
$('#modalClose').addEventListener('click', closeModal);
$('#modalCancel').addEventListener('click', closeModal);
// REQ-20260910-014：新建迁右侧侧拉面板（无全屏遮罩），取消「点击遮罩空白关闭」，
// 关闭收敛为 ✕ / 取消 / Esc（对齐全局面板）
$('#newForm').addEventListener('submit', submitNew);
// REQ-20260910-015：创建并接受入口——与表单提交共用 submitNew（标题校验 / 预检 / 防重复 / 失败保留口径）
$('#fSubmitAccept').addEventListener('click', () => submitNew({ preventDefault() {} }, { accept: true }));
$('#fType').addEventListener('change', () => syncNewFormFields());
// REQ-20260909-009：截图添加入口——文件选择（多选图片）与剪贴板粘贴（弹窗打开期间、需求 / Bug 类型）
$('#fShotPick').addEventListener('click', () => {
  if (!shotBusy) $('#fShotFile').click();
});
$('#fShotFile').addEventListener('change', async () => {
  const input = $('#fShotFile');
  const files = [...(input.files || [])];
  input.value = ''; // 复位以允许再次选择同一文件
  for (const f of files) await addShotFile(f);
});
document.addEventListener('paste', (e) => {
  if (shotBusy || $('#modalWrap').classList.contains('hidden') || $('#fType').value === 'ask') return;
  const items = [...((e.clipboardData && e.clipboardData.items) || [])]
    .filter((it) => it && it.kind === 'file' && String(it.type || '').startsWith('image/'));
  if (!items.length) return; // 纯文本粘贴走默认行为（标题 / 描述输入不受影响）
  e.preventDefault();
  for (const it of items) {
    const file = it.getAsFile ? it.getAsFile() : null;
    if (file) void addShotFile(file, shotPasteName(file)); // 自动命名 paste-<时间戳>.<后缀>
  }
});
// REQ-20260910-017：截图预览关闭——顶部关闭按钮；遮罩空白处点击关闭（点击图片本身 /
// 按钮不关闭，背景新建表单被遮罩覆盖不可操作）；双击 / 键盘入口的绑定在 renderShots 内随
// 缩略图列表重建，Esc / Tab 走 onShotPreviewKey 窗口捕获（打开时注册、关闭时移除）
$('#shotPreviewClose')?.addEventListener('click', () => shotPreviewClose());
$('#shotPreview')?.addEventListener('click', (e) => {
  if (e.target && e.target.closest && e.target.closest('button, img')) return; // 图片与按钮本身不关闭
  shotPreviewClose(); // 点在遮罩空白处：仅关闭预览
});
// REQ-20260907-004：选择工具条（静态节点，绑定一次）；REQ-20260908-027 起按档显隐、含批量驳回与全不选；
// BUG-20260909-006：已计划档仅「移出计划」（「进入批量开发」入口移除，批量开发入口唯一收敛任务模块）
$('#acceptSelected').addEventListener('click', () => acceptItems([...state.acceptance.selected]));
$('#planAdd').addEventListener('click', () => moveToPlan([...state.plan.selected])); // REQ-20260908-018：批量移入计划
$('#planReject').addEventListener('click', () => rejectToSubmitted([...state.plan.selected])); // REQ-20260908-027：批量驳回待接受
$('#planRemove').addEventListener('click', () => removeFromPlan([...state.impl.selected])); // REQ-20260908-010：批量移出计划
$('#selectOperable').addEventListener('click', selectOperable);
$('#selectNone').addEventListener('click', deselectOperable); // REQ-20260908-027：全不选（仅当前档）
// REQ-20260909-007：列表头常驻快捷入口（仅导航）——已接受档进批量完善、已计划档进批量开发子面板；
// REQ-20260911-010：已完成档「开始 Commit」入口已随批量 Commit 回退移除（done 档入口隐藏，不进此绑定）；
// 点击不创建任务、不弹确认（创建仍由面板内「启动」承接）
$('#laneQuickEntry')?.addEventListener('click', () => gotoRuns(state.reqFilter === 'accepted' ? 'refine' : 'develop'));
$('#mask').addEventListener('click', closeDrawer);
// REQ-20260914-001：挂起确认面板头部关闭 / 错误重试（表单内按钮随渲染动态绑定）
$('#confirmPanelClose')?.addEventListener('click', () => { if (!confirmSide.busy) closeConfirmPanel(); });
$('#confirmPanelErrorClose')?.addEventListener('click', () => closeConfirmPanel());
$('#confirmPanelErrorRetry')?.addEventListener('click', () => loadConfirmDetail());
// REQ-20260909-014 / BUG-20260913-003：需求与 Bug 抽屉文档页签右键「讨论」菜单（document 级委托绑定一次，#docView 随抽屉重建不重绑）
document.addEventListener('contextmenu', onDocCtxMenu);
document.addEventListener('keydown', onGlobalKeydown); // REQ-20260910-007：全局单键快捷键唯一注册点（具名处理器定义于绑定区之前）
// 帮助面板入口接线（顶栏按钮 / 关闭按钮 / 遮罩点击，均走 open/closeShortcutHelp 同一守卫）
$('#btnShortcuts')?.addEventListener('click', openShortcutHelp);
$('#shortcutHelpClose')?.addEventListener('click', closeShortcutHelp);
$('#shortcutHelpWrap')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeShortcutHelp(); });
$('#btnInit').addEventListener('click', async () => {
  try {
    await api('/api/init', { method: 'POST' });
    toast('✓ 已初始化 docs/agent-team-board/');
    state.knownIds = null; // REQ-20260906-016：初始化是目录状态变化，既有条目不算新建，首轮重新播种
    await refreshHealth();
    await poll();
  } catch (e) {
    toast(e.message, true);
  }
});
$('#projectSel').addEventListener('change', (e) => {
  const next = e.target.value;
  // REQ-20260910-019：营销档案有未保存内容时先确认——保存并切换 / 放弃 / 取消
  //（取消回弹项目选择器，不切换；保存失败弹窗保留可重试）
  if (window.ATBMarketing?.hasUnsaved?.()) {
    window.ATBMarketing.guardProjectSwitch(next, () => switchProject(next), () => renderProjectSel());
    return;
  }
  switchProject(next);
});
// REQ-20260910-005 项目管理入口与面板接线（顶栏按钮 + 无项目引导卡）
$('#btnProjManage').addEventListener('click', openProjPanel);
// BUG-20260910-004：全局任务面板接线（顶栏「全局」入口；面板内搜索与关闭为常驻节点一次性绑定）
$('#btnGlobal')?.addEventListener('click', openGlobalPanel);
bindGlobalPanelOnce();
$('#btnOpenProjManage')?.addEventListener('click', openProjPanel);
$('#projClose').addEventListener('click', closeProjPanel);
$('#projCancel').addEventListener('click', closeProjPanel);
$('#projForm').addEventListener('submit', submitProjForm);
$('#projRemoveOk').addEventListener('click', confirmRemoveProject);
$('#projRemoveCancel').addEventListener('click', hideRemoveConfirm); // 取消不改变列表
// REQ-20260910-010 目录存在性检测 + 一键移出所有不存在的目录
$('#projScanBtn').addEventListener('click', () => scanProjPanel());
$('#projRemoveMissingBtn').addEventListener('click', showBatchRemoveConfirm);
$('#projBatchOk').addEventListener('click', confirmBatchRemove);
$('#projBatchCancel').addEventListener('click', () => { // 取消不产生任何变更
  hideBatchRemoveConfirm();
  projNotice('已取消，项目列表未变更。');
});
$('#projList').addEventListener('click', projListClick);
// REQ-20260911-001 待接受编辑侧拉面板接线（常驻节点一次性绑定；卡片 / 详情入口经 bindRenameButtons）
$('#editClose')?.addEventListener('click', () => { if (!editSide.busy) closeEditPanel(); }); // 保存中禁止关闭
$('#editCancel')?.addEventListener('click', () => { if (!editSide.busy) closeEditPanel(); }); // 取消不保存、不发写请求
$('#editForm')?.addEventListener('submit', (e) => { e.preventDefault(); submitEditPanel(); });
$('#eTitle')?.addEventListener('keydown', (e) => { // 标题 Enter 发起保存（preventDefault 防与表单 submit 双触发）
  if (e.key === 'Enter') { e.preventDefault(); submitEditPanel(); }
});
// 描述文本域不接管 Enter（保持换行）；点击面板外不关闭（无遮罩，仅 ✕ / 取消 / Esc 关闭）
$('#editRetry')?.addEventListener('click', () => loadEditContent()); // 读取失败重试：重新拉当前已保存内容
$('#editErrorClose')?.addEventListener('click', () => closeEditPanel());
// REQ-20260911-007 人工决策侧拉面板：关闭 / 重试 / 保存（保存中禁止关闭，防未完成请求被误认为取消）
$('#holdPanelClose')?.addEventListener('click', () => { if (!holdSide.busy) closeHoldPanel(); });
$('#holdPanelCancel')?.addEventListener('click', () => { if (!holdSide.busy) closeHoldPanel(); });
$('#holdPanelErrorClose')?.addEventListener('click', () => closeHoldPanel());
$('#holdPanelRetry')?.addEventListener('click', () => loadHoldQuestions());
$('#holdForm')?.addEventListener('submit', (e) => { e.preventDefault(); return saveHoldAnswers(); });
// 操作切换 / 路径修改重置初始化确认步（目标位置可能已变，须重新解析确认）
$('#projMode').addEventListener('change', () => {
  projPanel.mode = $('#projMode').value;
  projPanel.preview = null;
  $('#projTarget').classList.add('hidden');
  projNotice('');
  syncProjSubmitLabel();
});
$('#projPath').addEventListener('input', () => {
  if (!projPanel.preview) return;
  projPanel.preview = null;
  $('#projTarget').classList.add('hidden');
  syncProjSubmitLabel();
});
for (const b of document.querySelectorAll('.view-tab')) {
  b.addEventListener('click', () => setView(b.dataset.view));
}
// BUG-20260907-016：第四行筛选条 chips 点击委托（容器常驻，chips 随轮询重建不重绑）
$('#filterBar')?.addEventListener('click', (e) => {
  const chip = e.target.closest?.('.filter-chip');
  if (!chip) return;
  state.reqFilter = chip.dataset.filter;
  renderBoard(); // 签名含 reqFilter，切档即时重绘列表与 chips 选中态
  saveViewSnapshot(); // REQ-20260910-001：筛选档进入快照
});
// REQ-20260908-002：需求列表排序下拉（五档共用）；初始值取记忆偏好，切换即重排并记忆。
// REQ-20260910-016：控件迁至第三行定位组（搜索框左侧），绑定与记忆口径不变（显隐见 syncReqSortVisibility）
const reqSortSel = $('#reqSort');
if (reqSortSel) {
  reqSortSel.value = state.reqSort;
  reqSortSel.addEventListener('change', () => {
    state.reqSort = isReqSortKey(reqSortSel.value) ? reqSortSel.value : REQ_SORT_DEFAULT;
    try { localStorage.setItem(REQ_SORT_STORAGE_KEY, state.reqSort); } catch { /* 记忆失败不阻塞排序 */ }
    renderBoard(); // 签名含 reqSort，切键即时按新序重绘
  });
}

/* ---------- 设置模块（REQ-20260907-004；BUG-20260909-002 精简：模型/强度配置与运行环境检查移除） ---------- */

// 模型块渲染（cxModelBlockHtml / cxReadModelForm / bindCxModelBlock）仅剩任务模块 Codex 存量面板使用。
// REQ-20260909-011 设置区去 Agent 化：删除批量完善/批量开发两张 Agent 配置表格（执行 Agent 隐藏
// 开关、按 Agent 的模型来源/子代理模型/推理强度列）及「全部隐藏禁用启动」联动——两类任务均为
// 同一子代理模式，提示词单一通用版，子代理模型与智能/推理档位跟随主调度会话（REQ-20260909-005
// follow 语义为固定口径，手动覆盖入口随之移除，见 design.md 待确认项结论）。
// 分区仅保留：标题 + 一句通用说明 +「完善完成后自动转入计划」开关（REQ-20260909-010，行为不变）+
// 保存按钮与就近状态反馈。存量 tasks/settings.json 的 agents/models 字段保留忽略（底层存储不动）。
// BUG-20260909-016 文案精简（仅改文案不改行为）：分区说明与开关说明各压缩为一句短句（119→39 / 93→27 字），
// title 悬停提示与开关可见说明统一为同一短句，不再两处长文重复；「可在任意一种 Agent 会话粘贴执行」
// 口径移出设置分区，由批量开发 / 批量完善页签的启动说明继续承载。
function taskSettingsHtml(ts) {
  // REQ-20260909-010：完善完成后自动转入计划开关（默认关闭；按已保存值回显勾选，存量缺字段按关闭回退）
  const autoPlan = !!(ts && ts.refine && ts.refine.autoPlanAfterDone === true);
  return `
    <section class="cx-config task-settings">
      <h4>批量任务</h4>
      <p class="muted small">两类批量任务均为子代理模式，子代理模型跟随主调度会话；保存仅对后续新任务生效。</p>
      <div class="ts-block">
        <label class="field-inline" title="开启后完善完成即自动移入计划；默认关闭＝人工移入计划。">
          <input type="checkbox" id="tsAutoPlan" aria-label="完善完成后自动转入计划"${autoPlan ? ' checked' : ''}> 完善完成后自动转入计划
        </label>
        <p class="muted small" style="margin:2px 0 0">开启后完善完成即自动移入计划；默认关闭＝人工移入计划。</p>
      </div>
      <div class="dep-toolbar">
        <button type="button" class="btn primary" id="tsSave">保存批量任务设置</button>
        <span class="muted small" id="tsStatus" role="status">已加载设置</span>
      </div>
    </section>`;
}

// REQ-20260909-001：批量任务分区按加载状态渲染——
//   加载中（「正在加载任务设置」，不渲染编辑与保存，避免未加载完成覆盖配置）、
//   失败（错误 + 重试）、就绪（REQ-20260909-011：仅完善流转开关）。
function taskSettingsAreaHtml() {
  if (state.tasks.loading) {
    return `
    <section class="cx-config task-settings" aria-busy="true">
      <h4>批量任务</h4>
      <p class="muted small">正在加载任务设置…</p>
    </section>`;
  }
  if (state.tasks.error) {
    return `
    <section class="cx-config task-settings">
      <h4>批量任务</h4>
      <div class="notice err">任务设置加载失败：${esc(state.tasks.error)} <button type="button" class="btn small" id="tsRetry">重试</button></div>
    </section>`;
  }
  const ts = state.tasks.settings || { refine: { autoPlanAfterDone: false } };
  return taskSettingsHtml(ts);
}

// REQ-20260912-001：Git 工作流详细描述——dev + main 双分支协作总述、分支职责
// （dev 承载需求设计/开发/测试，main 承载版本构建与发布构建物）、每个需求或 Bug
// 单开发完自动提交到本地。就绪态（含非 git 仓库）始终展示，初始化前即可了解全貌。
function gitWorkflowDescHtml() {
  return `
      <p class="muted small" style="margin:0 0 2px">采用 dev + main 双分支协作：</p>
      <ul class="muted small" style="margin:2px 0 4px;padding-left:18px">
        <li>dev 分支承载需求设计、开发和测试；main 分支承载版本构建，发布构建物。</li>
        <li>每个需求或 Bug 单开发完自动提交到本地（仅本地分支操作，不 push）。</li>
      </ul>`;
}

// REQ-20260911-009 设置页「Git 工作流」分区：展示当前分支与 dev 分支状态，
// 主操作「初始化 dev 分支」（按需创建 + 整体切换，幂等）；加载/执行期间按钮禁用，
// 非 git 仓库禁用并提示（不出现可点击但必然失败的入口），失败给原因与重试。
// REQ-20260912-001：单行提示升级为详细工作流描述（gitWorkflowDescHtml），
// 非 git 仓库在其后保留初始化指引。
function gitWorkflowAreaHtml() {
  const g = state.git;
  if (g.loading) {
    return `
    <section class="cx-config git-workflow" aria-busy="true">
      <h4>Git 工作流</h4>
      <p class="muted small">正在获取 Git 状态…</p>
    </section>`;
  }
  if (g.error) {
    return `
    <section class="cx-config git-workflow">
      <h4>Git 工作流</h4>
      <div class="notice err">Git 状态加载失败：${esc(g.error)} <button type="button" class="btn small" id="gwRetry">重试</button></div>
    </section>`;
  }
  const d = g.data || { isRepo: false, branch: null, devExists: false };
  const onDev = d.isRepo && d.branch === 'dev' && d.devExists;
  // BUG-20260912-001：分支名与 dev 状态词各包一层 <span>——拆成独立文本节点后，
  // 英文词典的全文匹配才能逐段命中（整句动态回填会把「已存在/未创建」原样带进英文）。
  const statusLine = !d.isRepo
    ? '当前分支：—（不是 git 仓库）'
    : `当前分支：<span>${esc(d.branch || '未知')}</span> · dev 分支：<span>${d.devExists ? '已存在' : '未创建'}</span>`;
  const btn = onDev
    ? `<button type="button" class="btn" id="gwInit" disabled>已在 dev 分支</button>`
    : `<button type="button" class="btn primary" id="gwInit"${(!d.isRepo || g.busy) ? ' disabled' : ''}>初始化 dev 分支</button>`;
  const notRepo = !d.isRepo
    ? `<p class="muted small" style="margin:0 0 2px">项目不是 git 仓库：请先在终端完成 git 初始化（新项目可经 atb init 自动初始化）。</p>`
    : '';
  return `
    <section class="cx-config git-workflow">
      <h4>Git 工作流</h4>
      ${gitWorkflowDescHtml()}
      ${notRepo}
      <div class="ts-block"><p style="margin:2px 0 0">${statusLine}</p></div>
      <div class="dep-toolbar">
        ${btn}
        <span class="muted small" id="gwStatus" role="status"></span>
      </div>
    </section>`;
}

// Git 状态加载（设置页进入时；失败保留上次数据并记录错误，可重试）
async function refreshGitState() {
  state.git.loading = true;
  try {
    const d = await api('/api/git/branch-state');
    state.git.loading = false;
    state.git.error = null;
    state.git.data = d;
  } catch (e) {
    state.git.loading = false;
    state.git.error = e.message;
  }
}

// BUG-20260909-011：设置页删除「运行参数」分区（标题、CLI 路径 / 单项时限 / 网络重试 /
// 重启后自动继续 / 允许非 Git 项目执行五控件、保存按钮与密钥说明），仅保留「批量任务」分区。
// 服务端 /api/dispatch/settings 与派发消费逻辑不在本单范围：仍读取既有落盘配置，不清空、不改执行行为。
// REQ-20260911-009：并列新增「Git 工作流」分区（dev 分支初始化）。
function paintSettingsView(view) {
  view.innerHTML = `
    <div class="drawer-body settings-body">
      ${taskSettingsAreaHtml()}
      ${gitWorkflowAreaHtml()}
    </div>`;
  bindSettingsView(view);
}

async function renderSettingsView() {
  const view = $('#settingsView');
  if (!view) return;
  // 阶段一（REQ-20260909-001）：先渲染加载骨架——任务设置区显示「正在加载任务设置」，
  // 编辑与保存禁用，避免未加载完成就覆盖配置
  state.tasks.loading = true;
  state.git.loading = true;
  paintSettingsView(view);
  const gitLoad = refreshGitState(); // REQ-20260911-009：Git 状态与任务设置并行加载
  try {
    if (!state.codex.settings) state.codex.settings = (await api('/api/dispatch/settings')).settings;
  } catch (e) {
    state.tasks.loading = false;
    view.innerHTML = `<div class="notice err">设置加载失败：${esc(e.message)} <button type="button" class="btn small" id="stRetry">重试</button></div>`;
    view.querySelector('#stRetry')?.addEventListener('click', () => renderSettingsView());
    return;
  }
  await ensureTaskSettings(true); // REQ-20260908-020：批量任务分区随设置视图实时读取（失败记录于 state.tasks.error）
  await gitLoad;
  paintSettingsView(view); // 阶段二：就绪渲染隐藏开关（或失败态错误 + 重试）
}

function bindSettingsView(view) {
  // REQ-20260909-011：批量任务设置 = 仅完善流转开关（按 Agent 的隐藏/模型配置已移除）。
  // 草稿变更就近提示「有未保存的更改」；保存只提交 refine 开关（服务端忽略遗留的 agents/models 键）
  const tsRetry = view.querySelector('#tsRetry');
  if (tsRetry) tsRetry.addEventListener('click', () => renderSettingsView()); // 加载失败重试
  const tsStatus = view.querySelector('#tsStatus');
  const tsDirty = () => {
    if (tsStatus) tsStatus.textContent = '有未保存的更改';
  };
  // REQ-20260909-010：完善流转开关草稿——切换只改本地草稿提示未保存，保存时提交
  const tsAutoPlan = view.querySelector('#tsAutoPlan');
  if (tsAutoPlan) tsAutoPlan.addEventListener('change', tsDirty);
  const tsSave = view.querySelector('#tsSave');
  if (tsSave) tsSave.addEventListener('click', async () => {
    tsSave.disabled = true; // 防重复提交
    tsSave.textContent = '保存中…';
    try {
      const r = await api('/api/tasks/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // REQ-20260909-010：完善流转开关（非法值服务端整体拒绝，不落半截配置）；
        // REQ-20260909-011：保存载荷仅含该开关（agents/models 不再有界面入口）
        body: JSON.stringify({ refine: { autoPlanAfterDone: !!view.querySelector('#tsAutoPlan')?.checked } }),
      });
      state.tasks.settings = r.settings;
      if (tsStatus) tsStatus.textContent = '已保存，仅对后续启动的任务生效';
      toast('✓ 已保存批量任务设置（流转开关仅对后续完善回执生效）');
    } catch (e) {
      // 保存失败：草稿保留在复选框中，就近显示错误（不误报成功），可再次点击重试
      if (tsStatus) tsStatus.textContent = `保存失败：${e.message}（草稿已保留，可重试）`;
    } finally {
      tsSave.disabled = false;
      tsSave.textContent = '保存批量任务设置';
    }
  });

  // REQ-20260911-009「Git 工作流」分区：状态重试 + 初始化 dev 分支（确认 → 执行 → 就近反馈）
  const gwRetry = view.querySelector('#gwRetry');
  if (gwRetry) gwRetry.addEventListener('click', async () => {
    state.git.loading = true;
    paintSettingsView(view);
    await refreshGitState();
    paintSettingsView(view);
  });
  const gwInit = view.querySelector('#gwInit');
  const gwStatus = view.querySelector('#gwStatus');
  if (gwInit && !gwInit.disabled) gwInit.addEventListener('click', async () => {
    const ok = await uiConfirm({
      title: '初始化 dev 分支？',
      message: '将按需创建 dev 分支，并把整个项目工作区切换到 dev（已在 dev 则仅提示就绪；仅本地分支操作，不 push）。',
      confirmText: '初始化并切换',
    });
    if (!ok) return;
    state.git.busy = true;
    gwInit.disabled = true;
    if (gwStatus) gwStatus.textContent = '正在创建并切换到 dev 分支…';
    try {
      await api('/api/git/init-dev', { method: 'POST' });
      state.git.busy = false;
      await refreshGitState();
      paintSettingsView(view); // 成功：状态区刷新，按钮转「已在 dev 分支」就绪态
      toast('✓ 已就绪：当前分支 dev（开发在 dev 分支进行，到待测试自动提交）');
    } catch (e) {
      // 失败：保留当前状态与原因，按钮恢复可点（重试不重复创建已存在的分支）
      state.git.busy = false;
      paintSettingsView(view);
      const st2 = view.querySelector('#gwStatus');
      if (st2) st2.textContent = `失败：${e.message}（可重试；已存在的分支不会重复创建）`;
    }
  });
}

/* ---------- 启动 ---------- */

async function boot() {
  // 项目定位：URL 深链（/board 带入的会话项目）> 上次选择 > 服务端默认项目
  const urlParams = new URLSearchParams(location.search);
  const fromUrl = urlParams.get('project');
  const saved = localStorage.getItem('atb.project');
  try {
    const h = await api('/api/health');
    state.projects = h.projects || [];
    state.project = fromUrl || saved || h.defaultProject || null;
  } catch {
    state.project = fromUrl || saved || null;
  }
  if (state.project) localStorage.setItem('atb.project', state.project);
  // REQ-20260907-004：深链兼容五个模块；无旧深链默认进入需求列表。
  // BUG-20260910-004：旧 view=global 深链仍有效——经 setView 收敛为打开全局任务面板（不切换模块）。
  // REQ-20260910-001：显式深链是用户意图，模块级优先于刷新快照（快照只补模块内浏览状态），
  // 无深链时采用快照模块（快照缺失时 applyViewSnapshot 回落 'status'，默认语义不变）
  const viewRaw = urlParams.get('view');
  let viewParam = (viewRaw === 'global' || (VIEWS.includes(viewRaw) && viewRaw !== 'status')) ? viewRaw : null;
  bindSearchOnce();       // 模块搜索输入绑定（第三行）
  updateSearchPlaceholder();
  await poll();
  // REQ-20260910-001：Cmd+R 刷新回到刷新前——首轮数据到位后应用本项目会话快照
  // （恢复目标失效时静默回落；此后行为与现状完全一致，后续交互持续更新快照）
  const restored = await applyViewSnapshot(readViewSnapshot(state.project));
  if (!viewParam) viewParam = restored.view; // URL 深链优先，其次快照模块，最后默认需求模块
  renderDrawerEmpty();   // 详情右栏初始空态引导
  // BUG-20260907-002：默认需求视图也必须走 setView 初始化容器显隐——#reqView 在
  // index.html 初始 hidden，renderBoard 只切换其子容器，跳过 setView 会导致手动刷新
  // 需求界面整页无数据，须切到其他栏目再切回才显示。setView 内部已含 syncProjectUrl。
  setView(viewParam);
  renderProjectSel();
  if (restored.search) runSearch(); // 恢复的搜索词按当前模块重新解释（需求/文件重发 /api/search）
  setInterval(poll, 2000);
}

// REQ-20260908-022：讨论侧「归属需求」徽标跳回需求详情（oncall.js 派发自定义事件，避免暴露全局对象）
window.addEventListener('atb:open-req', (e) => {
  const id = e.detail && e.detail.id;
  if (id) openDrawer(id);
});

// REQ-20260910-001：讨论模块浏览态变化（筛选/详情/页签）由 oncall.js 派发本事件，
// app.js 统一读取 ATBOncall.snapshot() 落盘（单一写者，oncall 内部 state 不外露）
window.addEventListener('atb:oncall-state', () => saveViewSnapshot());

// REQ-20260910-029：发布模块浏览态变化（选中运行/页签/筛选）由 release.js 派发本事件，统一落快照
window.addEventListener('atb:release-state', () => saveViewSnapshot());

// REQ-20260910-019：营销模块浏览态变化（页签 / 选中版本）由 marketing.js 派发本事件，
// app.js 统一读取 ATBMarketing.snapshot() 落盘（表单草稿与未保存内容不进快照）
window.addEventListener('atb:marketing-state', () => saveViewSnapshot());

// REQ-20260909-004：讨论详情「已创建成果」跳回条目详情（讨论侧派发；需求模块承接）
window.addEventListener('atb:open-item', (e) => {
  const id = e.detail && e.detail.id;
  if (id) {
    setView('status');
    openDrawer(id);
  }
});

boot();

// REQ-20260907-008：讨论模块头部新建按钮删除后，window.ATBApp.openNewModal 接缝无消费者，已移除；
// 新建（需求/Bug/讨论单）统一由顶栏「＋ 新建」openModal 承接。
