'use strict';
// 营销模块前端（REQ-20260910-019，营销与增长第一条；REQ-20260910-020 渠道与行动看板；
// REQ-20260910-021 效果与复盘）—— 由 app.js 在 view=marketing 时激活。
// 四页签：概览 / 定位与定价 / 渠道与行动 / 效果与复盘。
// 营销档案初始化由用户点击触发；读取 README 仅形成简介草稿，不代表市场需求已被验证。
// 状态机：loading → empty（建立营销档案引导）| ready | error（读取失败重试）。
// 编辑约定：表单脏标记驱动项目切换守卫（保存并切换 / 放弃 / 取消，弹窗在 index.html）；
// 保存中禁重复提交、成功展示保存时间；校验错误定位字段；保存失败保留编辑内容；
// 409 并发冲突提示「重新载入」并保留本地草稿（不静默覆盖）。
// 定价版本：保存恒新建（候选不会自动成为当前定价），「设为当前方案」为显式操作；
// 历史版本只读查看。本模块只记录方案，不修改商店或支付系统实际价格。
// 渠道与行动（REQ-20260910-020）：工具栏（渠道 / 实验筛选与新建入口）+ 实验条 + 六状态列
// （草稿 / 待发布 / 已发布 / 观察中 / 已复盘 / 已停止）；点击卡片右侧打开详情抽屉
// （基本信息 / 内容素材 / 结果与关联）。状态推进按链式下一步，缺少必填信息留在原状态并
// 定位字段；停止与更正记录原因并入操作历史；复制文案仅写剪贴板不发送；人工登记发布结果
// 后才展示已发布；过期未发布仅显示「逾期」不自动发布。「创建开发需求」经服务端转 submitted
// REQ 并双向关联（幂等 key 重试不重复创建），创建后可跳转（atb:open-item）。
// 已复盘 / 已停止后可「复制为新实验」（新 ID、保留来源、行动置为草稿）。
// 效果与复盘（REQ-20260910-021）：日期范围 + 渠道 / 实验筛选 + 录入 / 导入入口；
// 分类指标卡区分 未录入 / 真实零 / 数值 / 分开呈现（存量不跨日期、关注类不跨平台、
// 不同币种与独立人数分开呈现），点卡展开定义、原始记录与修订历史（含修改理由）；
// 派生转化率仅在口径一致且分母有效时计算，否则「不可计算」并给出原因；
// CSV 导入向导 粘贴 → 字段映射 → 预览校验（错误行带行号禁止提交、不写入部分数据）→
// 确认结果，值冲突逐行选择修订（需理由）或跳过，重复导入为无变化；
// 新建复盘保存固定观察快照（后续数据修订不改变历史复盘依据），无数据可存「数据不足」。
// project-growth 工作流（REQ-20260910-022）：四页右上角 AI 入口（梳理定位 / 分析定价 / 制定渠道计划 /
// 生成内容 / 生成复盘草稿）→ 任务面板展示将使用的资料（引用及版本）与技能缺口 → 复制提示词仅写剪贴板
// 并登记任务（waiting = 尚未收到结果，没有回执不宣称已保存）；回执由外部 Agent 会话经统一 CLI 写入后，
// 草稿分区展示事实 / 假设 / 待确认、证据引用与缺失信息，候选行动逐项 编辑 / 采纳 / 保留草稿；
// 采纳经既有营销数据层落地（候选定价不自动成为当前方案、渠道不自动已验证、行动不自动发布）；
// 数据不足仅显示补采建议不生成虚构结论；输入基线过期的回执被拒绝并可按当前版本重建；
// 「复制继续任务提示词」生成含历史草稿与采纳记录引用的接续任务（跨会话接续）。

const ATBMarketing = (() => {
  const $ = (s, el = document) => el.querySelector(s);

  const TABS = [
    { key: 'overview', label: '概览' },
    { key: 'positioning', label: '定位与定价' },
    { key: 'channels', label: '渠道与行动' },
    { key: 'review', label: '效果与复盘' },
  ];
  const DEFAULT_TAB = 'overview';

  const STAGES = [['exploring', '探索'], ['validating', '验证'], ['launched', '上线'], ['growing', '增长']];
  const STAGE_LABEL = Object.fromEntries(STAGES);
  const EVIDENCE_TYPES = [['fact', '事实'], ['hypothesis', '假设'], ['unverified', '待确认']];
  const EVIDENCE_TYPE_LABEL = Object.fromEntries(EVIDENCE_TYPES);
  const PRICING_MODELS = [['free', '免费'], ['onetime', '买断'], ['subscription', '订阅'], ['usage', '按量'], ['hybrid', '混合']];
  const PRICING_MODEL_LABEL = Object.fromEntries(PRICING_MODELS);
  const CYCLES = [['monthly', '月付'], ['quarterly', '季付'], ['yearly', '年付']];
  const CYCLE_LABEL = Object.fromEntries(CYCLES);

  // REQ-20260910-020 渠道与行动
  const ACTIVITY_COLS = [
    ['draft', '草稿'], ['pending', '待发布'], ['published', '已发布'],
    ['observing', '观察中'], ['reviewed', '已复盘'], ['stopped', '已停止'],
  ];
  const ACTIVITY_STATUS_LABEL = Object.fromEntries(ACTIVITY_COLS);
  const ACTIVITY_NEXT = { draft: 'pending', pending: 'published', published: 'observing', observing: 'reviewed' };
  const ACTIVITY_DECISIONS = [['continue', '继续'], ['adjust', '调整'], ['stop', '停止'], ['undetermined', '暂不能判断']];
  const ACTIVITY_DECISION_LABEL = Object.fromEntries(ACTIVITY_DECISIONS);
  const CHANNEL_PRIORITIES = [['high', '高'], ['medium', '中'], ['low', '低']];

  // REQ-20260910-021 效果与复盘
  const METRIC_CATEGORIES = [['exposure', '曝光'], ['engagement', '互动'], ['following', '持续关注'], ['usage', '使用'], ['commercial', '商业']];
  const METRIC_CATEGORY_LABEL = Object.fromEntries(METRIC_CATEGORIES);
  const METRIC_KINDS = [['stock', '存量'], ['delta', '期间增量'], ['events', '事件次数'], ['unique', '独立人数']];
  const METRIC_KIND_LABEL = Object.fromEntries(METRIC_KINDS);
  const IMPORT_MAP_FIELDS = [
    ['start', '开始日期'], ['end', '结束日期'], ['metric', '指标'], ['value', '值'],
    ['unit', '单位 / 币种'], ['channel', '渠道'], ['experiment', '实验'], ['source', '来源'], ['timezone', '时区'],
  ];
  const IMP_STATUS_LABEL = { new: '新增', same: '无变化', conflict: '值冲突', error: '错误' };

  const state = {
    project: null,
    phase: 'loading',     // loading | empty | ready | error
    loadError: null,
    initError: null,
    busyInit: false,
    data: null,           // /api/marketing/state 最近成功响应（profile + versions + current）
    baseRevision: 1,      // 本地草稿保存基线；409 后由「重新载入」刷新
    tab: DEFAULT_TAB,
    versionSel: null,     // 右侧只读查看的定价版本（vN / null）
    draft: null,          // { positioning, evidence } 定位与证据草稿
    priceDraft: null,     // 新定价候选草稿（保存即新建版本）
    dirty: false,
    priceDirty: false,
    saving: false,
    pricingSaving: false,
    reloading: false,
    settingCurrent: null, // 进行中的「设为当前方案」版本号
    savedAt: null,
    priceSavedAt: null,
    saveError: null,
    priceSaveError: null,
    opError: null,
    conflict: false,      // 409 后：提示重新载入，本地草稿保留
    fieldErrors: {},
    priceFieldErrors: {},
    draftFromReadme: false, // 初始化后未保存过：表单明示 README 草稿来源
    pendingRestore: null, // 刷新快照（app.js applyViewSnapshot 委托）
    pendingSwitch: null,  // 未保存切换项目的待执行切换
    rendered: false,
    // ---- REQ-20260910-020 渠道与行动看板 ----
    board: null,          // /api/marketing/board 最近成功响应
    boardPhase: 'idle',   // idle | loading | ready | error
    boardError: null,
    chanFilter: '',       // 渠道筛选（''=全部）
    expFilter: '',        // 实验筛选（''=全部）
    narrowStatus: '',     // 窄屏状态筛选（''=全部；宽屏不生效）
    drawer: null,         // { id, baseRevision, draft, dirty, saving, fieldErrors, conflict, error, savedAt }
    modal: null,          // { kind, ...draftFields, fieldErrors, error, saving, key? }
    toast: null,          // { msg }
    // ---- REQ-20260910-021 效果与复盘 ----
    effect: null,         // /api/marketing/effect 最近成功响应
    effectPhase: 'idle',  // idle | loading | ready | error
    effectError: null,
    effFrom: '',          // 日期范围筛选（''=不限）
    effTo: '',
    effChan: '',          // 渠道筛选（''=全部）
    effExp: '',           // 实验筛选（''=全部）
    effMetric: null,      // 选中的指标卡（查看定义与原始记录）
    // ---- REQ-20260910-022 project-growth 工作流 ----
    growth: null,         // /api/marketing/growth 最近成功响应（runs + skills）
    growthPhase: 'idle',  // idle | loading | ready | error
    growthError: null,
    aiPanel: null,        // 任务面板 { type, from, to, inputs, inputsPhase, busy, created, error }
    aiRun: null,          // 草稿处理 / 详情（GET run 详情原文；phase=loading 时占位）
    aiRunBusy: false,
    aiRunError: null,
    aiRunNotice: null,    // 采纳 / 保留后的结果提示（渲染进面板，随下次操作刷新）
    aiEdit: null,         // 候选编辑 { runId, candidateId, title, verify, reason, error, saving }
    gtoast: null,         // growth 专属 toast（#mktGrowthToast）
  };

  /* ---------- 工具 ---------- */

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

  function shortName(p) {
    const parts = String(p || '').split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : String(p || '');
  }

  function url(pathname) {
    return state.project ? `${pathname}?project=${encodeURIComponent(state.project)}` : pathname;
  }

  // 与 app.js api() 分离：营销需要按 status 分流（409 冲突 / 400 字段）
  async function apiJson(pathname, body) {
    const opts = body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : undefined;
    const r = await fetch(url(pathname), opts);
    let j = {};
    try { j = await r.json(); } catch { /* 空响应体 */ }
    return { ok: r.ok, status: r.status, json: j };
  }

  function notifyState() {
    try {
      window.dispatchEvent?.(new CustomEvent('atb:marketing-state'));
    } catch { /* 派发失败不影响功能 */ }
  }

  function viewEl() {
    return $('#marketingView');
  }

  /* ---------- 草稿 ---------- */

  function blankPackage() {
    return { name: '', benefits: '', price: '' };
  }

  function blankPricing() {
    return {
      model: 'free', currency: '', cycle: '', packages: [blankPackage()],
      costBasis: '', competitorBasis: '', validationMethod: '',
    };
  }

  function buildDraft() {
    const p = state.data?.profile || {};
    const pos = p.positioning || {};
    state.draft = {
      positioning: {
        intro: pos.intro || '',
        stage: STAGES.some(([k]) => k === pos.stage) ? pos.stage : 'exploring',
        markets: pos.markets || '',
        audience: pos.audience || '',
        scenarios: pos.scenarios || '',
        painPoints: pos.painPoints || '',
        alternatives: pos.alternatives || '',
        differentiators: pos.differentiators || '',
        links: pos.links || '',
        stageGoal: pos.stageGoal || '',
        primaryMetric: pos.primaryMetric || '',
        budget: pos.budget == null ? '' : pos.budget,
        weeklyHours: pos.weeklyHours == null ? '' : pos.weeklyHours,
      },
      evidence: (Array.isArray(p.evidence) ? p.evidence : []).map((e) => ({
        id: e.id || '', type: EVIDENCE_TYPES.some(([k]) => k === e.type) ? e.type : 'unverified',
        content: e.content || '', source: e.source || '', collectedAt: (e.collectedAt || '').slice(0, 10),
      })),
    };
    state.priceDraft = blankPricing();
    state.dirty = false;
    state.priceDirty = false;
    state.fieldErrors = {};
    state.priceFieldErrors = {};
    state.saveError = null;
    state.conflict = false;
  }

  function applyServerState(payload) {
    state.data = payload;
    if (payload?.profile?.revision) state.baseRevision = payload.profile.revision;
    if (!state.versionSel) state.versionSel = defaultVersionSel();
  }

  function defaultVersionSel() {
    if (!state.data) return null;
    if (state.data.current) return state.data.current;
    const vs = state.data.versions || [];
    return vs.length ? vs[vs.length - 1].version : null;
  }

  function currentVersion() {
    const cur = state.data?.current;
    if (!cur) return null;
    return (state.data?.versions || []).find((v) => v.version === cur) || null;
  }

  /* ---------- 读取 / 初始化 ---------- */

  async function refresh() {
    state.phase = 'loading';
    state.loadError = null;
    render();
    let r;
    try {
      r = await apiJson('/api/marketing/state');
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    if (r.ok && r.json && r.json.initialized === true) {
      applyServerState(r.json);
      state.phase = 'ready';
      buildDraft(); // 全量拉取即重建草稿（进入视图 / 切换项目 / 重试路径；编辑中不走本函数）
    } else if (r.ok) {
      state.data = null;
      state.phase = 'empty';
    } else {
      state.phase = 'error';
      state.loadError = r.json?.error || `读取失败（${r.status}）`;
    }
    render();
  }

  async function doInit() {
    if (state.busyInit) return;
    state.busyInit = true;
    state.initError = null;
    const btn = viewEl()?.querySelector('#mktInit');
    if (btn) { btn.disabled = true; btn.textContent = '正在建立…'; }
    let r;
    try {
      r = await apiJson('/api/marketing/init', {});
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    state.busyInit = false;
    if (r.ok && r.json?.initialized === true) {
      applyServerState(r.json);
      state.phase = 'ready';
      state.draftFromReadme = true; // 表单明示草稿来源（README 仅作起点）
      buildDraft();
      notifyState();
    } else {
      state.phase = 'empty';
      state.initError = r.json?.error || `初始化失败（${r.status}），可重试`;
    }
    render();
  }

  /* ---------- 保存（定位 + 证据） ---------- */

  // 客户端只拦「确定非法且常见」的（负数、缺币种 / 缺订阅周期）；其余交服务端权威校验回显
  function clientValidate() {
    const errs = {};
    const p = state.draft?.positioning || {};
    for (const [k, label] of [['budget', '预算'], ['weeklyHours', '每周可投入工时']]) {
      const v = p[k];
      if (v == null || v === '') continue;
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n) && n < 0) errs[`positioning.${k}`] = `${label}不能为负数（未知请留空）`;
    }
    return errs;
  }

  async function saveNow() {
    if (state.saving) return false;
    const errs = clientValidate();
    if (Object.keys(errs).length) {
      state.fieldErrors = { ...state.fieldErrors, ...errs };
      render();
      focusFirstError(errs);
      return false;
    }
    state.saving = true;
    state.saveError = null;
    syncButtons();
    let r;
    try {
      r = await apiJson('/api/marketing/profile', {
        revision: state.baseRevision,
        positioning: state.draft.positioning,
        evidence: state.draft.evidence,
      });
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    state.saving = false;
    if (r.ok && r.json?.initialized === true) {
      applyServerState(r.json);
      state.dirty = false;
      state.savedAt = new Date().toISOString();
      state.conflict = false;
      state.fieldErrors = {};
      state.saveError = null;
      if (state.draftFromReadme) state.draftFromReadme = false; // 首次保存后不再标注 README 草稿
      render();
      notifyState();
      return true;
    }
    if (r.status === 409) {
      state.conflict = true; // 本地草稿保留；「重新载入」更新基线后重试
      render();
      return false;
    }
    if (r.json?.fields) {
      state.fieldErrors = r.json.fields;
      render();
      focusFirstError(r.json.fields);
      return false;
    }
    state.saveError = r.json?.error || `保存失败（${r.status}）`;
    render();
    return false;
  }

  // 409 后显式「重新载入」：拉最新基线与上下文，本地草稿保留（不静默覆盖）
  async function reloadFromServer() {
    if (state.reloading) return;
    state.reloading = true;
    state.saveError = null;
    render();
    let r;
    try {
      r = await apiJson('/api/marketing/state');
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    state.reloading = false;
    if (r.ok && r.json?.initialized === true) {
      applyServerState(r.json);
      state.conflict = false;
      state.fieldErrors = {};
      // 不 buildDraft()：本地草稿保留，仅基线与版本上下文更新
    } else if (r.ok) {
      state.data = null;
      state.phase = 'empty'; // 档案已被删除：回空态引导
    } else {
      state.saveError = r.json?.error || `重新载入失败（${r.status}）`;
    }
    render();
  }

  /* ---------- 定价候选（保存恒新建版本） ---------- */

  function clientValidatePricing() {
    const errs = {};
    const d = state.priceDraft || {};
    if (d.model && d.model !== 'free' && !String(d.currency || '').trim()) {
      errs.currency = '收费定价必须填写币种（如 CNY / USD）';
    }
    if (d.model === 'subscription' && !String(d.cycle || '').trim()) {
      errs.cycle = '订阅模式必须填写收费周期';
    }
    (d.packages || []).forEach((p, i) => {
      const v = p?.price;
      if (v == null || v === '') return;
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n) && n < 0) errs[`packages.${i}.price`] = '候选价格不能为负数（未知请留空）';
    });
    return errs;
  }

  async function savePricingNow() {
    if (state.pricingSaving) return false;
    const errs = clientValidatePricing();
    if (Object.keys(errs).length) {
      state.priceFieldErrors = { ...state.priceFieldErrors, ...errs };
      render();
      focusFirstError(errs);
      return false;
    }
    state.pricingSaving = true;
    state.priceSaveError = null;
    syncButtons();
    const d = state.priceDraft;
    const body = {
      model: d.model,
      currency: String(d.currency || '').trim(),
      cycle: String(d.cycle || '').trim(),
      packages: d.packages,
      costBasis: d.costBasis,
      competitorBasis: d.competitorBasis,
      validationMethod: d.validationMethod,
    };
    let r;
    try {
      r = await apiJson('/api/marketing/pricing', body);
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    state.pricingSaving = false;
    if (r.ok && r.json?.state?.initialized === true) {
      applyServerState(r.json.state);
      state.priceDirty = false;
      state.priceSavedAt = new Date().toISOString();
      state.priceDraft = blankPricing(); // 新候选从头填写；刚保存的版本在右侧版本历史可只读查看
      state.priceFieldErrors = {};
      state.priceSaveError = null;
      if (r.json.version?.version) state.versionSel = r.json.version.version;
      render();
      notifyState();
      return true;
    }
    if (r.json?.fields) {
      state.priceFieldErrors = r.json.fields;
      render();
      focusFirstError(r.json.fields);
      return false;
    }
    state.priceSaveError = r.json?.error || `保存失败（${r.status}）`;
    render();
    return false;
  }

  // 显式「设为当前方案」（候选保存不自动成为当前）
  async function setCurrent(version) {
    if (state.settingCurrent) return;
    state.settingCurrent = version;
    state.opError = null;
    syncButtons();
    let r;
    try {
      r = await apiJson('/api/marketing/pricing/current', { version });
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    state.settingCurrent = null;
    if (r.ok && r.json?.initialized === true) {
      applyServerState(r.json);
    } else {
      state.opError = r.json?.error || `设置失败（${r.status}）`;
    }
    render();
    notifyState();
  }

  /* ---------- 页签 / 版本选择 / 快照 ---------- */

  function setTab(tab) {
    if (!TABS.some((x) => x.key === tab && !x.disabled)) return;
    if (state.tab === tab) return;
    state.tab = tab;
    const view = viewEl();
    if (view) {
      for (const b of view.querySelectorAll('.mkt-tab')) b.classList.toggle('active', b.dataset?.tab === tab);
      for (const p of view.querySelectorAll('.mkt-pane')) p.classList.toggle('hidden', p.dataset?.mktPane !== tab);
    }
    if (tab === 'channels') ensureBoard(); // 首次进入渠道与行动拉取看板数据
    if (tab === 'review') ensureEffect(); // 首次进入效果与复盘拉取效果数据
    notifyState();
  }

  function selectVersion(version) {
    if (!(state.data?.versions || []).some((v) => v.version === version)) return;
    state.versionSel = version;
    render(); // 表单草稿经 draft 保留，重绘不丢编辑
    notifyState();
  }

  function snapshot() {
    return {
      tab: state.tab,
      view: state.versionSel || null,
      // 渠道与行动浏览态（表单草稿不进快照）
      board: state.tab === 'channels' ? {
        channel: state.chanFilter || '',
        experiment: state.expFilter || '',
        drawer: state.drawer?.id || null,
      } : null,
      // 效果与复盘浏览态（录入 / 导入 / 复盘弹层填写不进快照）
      review: state.tab === 'review' ? {
        from: state.effFrom || '',
        to: state.effTo || '',
        channel: state.effChan || '',
        experiment: state.effExp || '',
        metric: state.effMetric || null,
      } : null,
    };
  }

  function restoreView(snap) {
    state.pendingRestore = snap && typeof snap === 'object' ? snap : null;
    if (state.phase === 'ready' && state.pendingRestore) applyPendingRestore();
  }

  function applyPendingRestore() {
    const pr = state.pendingRestore;
    if (!pr) return;
    state.pendingRestore = null;
    if (TABS.some((x) => x.key === pr.tab && !x.disabled)) state.tab = pr.tab;
    if (pr.view && (state.data?.versions || []).some((v) => v.version === pr.view)) state.versionSel = pr.view;
    if (pr.board && typeof pr.board === 'object') {
      state.chanFilter = String(pr.board.channel || '');
      state.expFilter = String(pr.board.experiment || '');
      state.pendingDrawerId = pr.board.drawer || null;
      if (state.tab === 'channels') ensureBoard();
    }
    if (pr.review && typeof pr.review === 'object') {
      state.effFrom = String(pr.review.from || '');
      state.effTo = String(pr.review.to || '');
      state.effChan = String(pr.review.channel || '');
      state.effExp = String(pr.review.experiment || '');
      state.effMetric = pr.review.metric || null;
      if (state.tab === 'review') ensureEffect();
    }
  }

  /* ---------- 未保存切换项目守卫（弹窗在 index.html #mktSwitchWrap） ---------- */

  function hasUnsaved() {
    return state.phase === 'ready' && !!(
      state.dirty
      || state.priceDirty
      || state.drawer?.dirty // 抽屉编辑（内容 / 素材 / 登记信息）
      || state.modal // 新建 / 编辑弹窗中的填写内容
    );
  }

  function discardDraft() {
    if (state.data) buildDraft();
    state.dirty = false;
    state.priceDirty = false;
    state.modal = null;
    if (state.drawer && state.board) {
      const live = boardActivity(state.drawer.id);
      state.drawer = live ? buildDrawerDraft(live) : null;
    }
    render();
  }

  function switchTextDefault(next) {
    return `营销档案有未保存内容：可保存后切换到「${shortName(next)}」，或放弃修改直接切换；取消则留在当前项目。`;
  }

  function guardProjectSwitch(next, apply, cancel) {
    if (!hasUnsaved()) { apply(); return; }
    state.pendingSwitch = { next, apply, cancel };
    const txt = $('#mktSwitchText');
    if (txt) txt.textContent = switchTextDefault(next);
    const wrap = $('#mktSwitchWrap');
    if (wrap) wrap.classList.remove('hidden');
    $('#mktSwitchSave')?.focus?.();
  }

  function closeSwitchDialog() {
    const wrap = $('#mktSwitchWrap');
    if (wrap) wrap.classList.add('hidden');
  }

  function cancelSwitch() {
    const p = state.pendingSwitch;
    if (!p) return;
    state.pendingSwitch = null;
    closeSwitchDialog();
    p.cancel?.();
  }

  async function saveAndSwitch() {
    const p = state.pendingSwitch;
    if (!p) return;
    const saveBtn = $('#mktSwitchSave');
    if (saveBtn) saveBtn.disabled = true;
    const okProfile = state.dirty ? await saveNow() : true;
    const okPrice = state.priceDirty ? await savePricingNow() : true;
    const okDrawer = state.drawer?.dirty ? await saveDrawerNow() : true;
    if (saveBtn) saveBtn.disabled = false;
    if (okProfile && okPrice && okDrawer) {
      state.pendingSwitch = null;
      closeSwitchDialog();
      p.apply();
    } else {
      const txt = $('#mktSwitchText');
      if (txt) txt.textContent = '保存未完成（校验失败 / 并发冲突 / 网络错误）：编辑内容已保留，可重试保存、放弃或取消。';
    }
  }

  function discardAndSwitch() {
    const p = state.pendingSwitch;
    if (!p) return;
    state.pendingSwitch = null;
    closeSwitchDialog();
    discardDraft();
    p.apply();
  }

  /* ---------- 渲染 ---------- */

  function tabBtnsHtml() {
    return TABS.map((t) => {
      const active = state.tab === t.key ? ' active' : '';
      if (t.disabled) {
        return `<button type="button" class="mkt-tab disabled${active}" data-tab="${t.key}" disabled title="${esc(t.hint)}（暂不可用）">${esc(t.label)}<span class="mkt-tab-hint">暂不可用</span></button>`;
      }
      return `<button type="button" class="mkt-tab${active}" data-tab="${t.key}">${esc(t.label)}</button>`;
    }).join('');
  }

  function overviewHtml() {
    const pos = state.data?.profile?.positioning || {};
    const cur = currentVersion();
    const card = (label, val, hint) => `
      <div class="mkt-card">
        <p class="mkt-card-label">${esc(label)}</p>
        <p class="mkt-card-value">${esc(val || '—')}</p>
        ${hint ? `<p class="mkt-card-hint">${esc(hint)}</p>` : ''}
      </div>`;
    const pricingText = cur
      ? `${versionLine(cur)}${(cur.packages || []).length ? ` · ${(cur.packages || []).length} 个套餐` : ''}`
      : '';
    return `
      ${aiButtonsHtml([['positioning', '梳理定位'], ['pricing', '分析定价']])}
      <div class="mkt-cards">
        ${card('阶段', STAGE_LABEL[pos.stage] || pos.stage || '未填写', '探索 / 验证 / 上线 / 增长')}
        ${card('阶段目标', pos.stageGoal, '')}
        ${card('主指标', pos.primaryMetric, '')}
      </div>
      <div class="mkt-summary">
        <section class="mkt-block">
          <h4>定位摘要</h4>
          <dl class="mkt-dl">
            <dt>目标受众</dt><dd>${esc(pos.audience) || '<span class="muted">未填写</span>'}</dd>
            <dt>痛点</dt><dd>${esc(pos.painPoints) || '<span class="muted">未填写</span>'}</dd>
            <dt>差异点</dt><dd>${esc(pos.differentiators) || '<span class="muted">未填写</span>'}</dd>
          </dl>
        </section>
        <section class="mkt-block">
          <h4>当前定价</h4>
          ${cur
            ? `<p class="mkt-pricing-line">${esc(pricingText)}</p><p class="muted small">候选版本保存不会自动成为当前方案；历史版本在「定位与定价」页只读查看。</p>`
            : '<p class="muted">未设定。在「定位与定价」页保存定价方案后，显式点击「设为当前方案」。</p>'}
        </section>
        <section class="mkt-block">
          <h4>下一步</h4>
          <p class="muted">${cur ? '补充证据（事实 / 假设 / 待确认），随阶段推进更新目标与主指标。' : '先完成定位与证据，再保存第一个定价候选并显式设为当前方案。'}</p>
        </section>
      </div>
      ${growthRunsHtml()}`;
  }

  function versionLine(v) {
    const parts = [v.version, PRICING_MODEL_LABEL[v.model] || v.model];
    if (v.currency) parts.push(v.currency);
    if (v.cycle) parts.push(CYCLE_LABEL[v.cycle] || v.cycle);
    return parts.join(' · ');
  }

  function fieldErrHtml(field) {
    return `<p class="field-err" data-err-for="${esc(field)}" role="alert"></p>`;
  }

  function positioningFormHtml() {
    const d = state.draft.positioning;
    const sel = (id, val, opts, label) => `
      <label class="field">${esc(label)}
        <select id="${id}">${opts.map(([k, l]) => `<option value="${esc(k)}"${k === val ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
      </label>`;
    const area = (id, label, rows = 2, ph = '') => `
      <label class="field">${esc(label)}<textarea id="${id}" rows="${rows}" placeholder="${esc(ph)}"></textarea></label>
      ${fieldErrHtml(`positioning.${idToField(id)}`)}`;
    return `
      <div class="mkt-form-head">
        <h4>定位档案</h4>
        ${state.draftFromReadme ? '<p class="mkt-notice muted small">简介当前为 README 草稿：仅作起点，不代表市场需求已被验证。</p>' : ''}
      </div>
      <label class="field">产品简介<textarea id="mktIntro" rows="3" placeholder="一句话说清产品为谁解决什么问题"></textarea></label>
      ${fieldErrHtml('positioning.intro')}
      ${sel('mktStage', d.stage, STAGES, '产品阶段')}
      <label class="field">目标市场与语言<input id="mktMarkets" placeholder="例：北美 / 中文、英文"></label>
      ${fieldErrHtml('positioning.markets')}
      ${area('mktAudience', '目标受众', 2, '谁最需要它：角色、场景、规模')}
      ${area('mktScenarios', '使用场景', 2, '典型使用流程或时刻')}
      ${area('mktPain', '痛点', 2, '现状哪里痛、代价是什么')}
      ${area('mktAlt', '替代产品', 2, '用户今天用什么顶替（含手工 / 表格）')}
      ${area('mktDiff', '差异点', 2, '与替代品相比凭什么赢')}
      ${area('mktLinks', '产品链接', 2, 'https://…（每行一个）')}
      ${fieldErrHtml('positioning.links')}
      <label class="field">阶段目标<input id="mktGoal" placeholder="例：验证首次使用价值"></label>
      ${fieldErrHtml('positioning.stageGoal')}
      <label class="field">主指标<input id="mktMetric" placeholder="例：激活人数"></label>
      ${fieldErrHtml('positioning.primaryMetric')}
      <div class="mkt-num-row">
        <label class="field">预算（可空 = 未知）<input id="mktBudget" type="number" min="0" step="any" placeholder="未知请留空"></label>
        ${fieldErrHtml('positioning.budget')}
        <label class="field">每周可投入工时（小时）<input id="mktHours" type="number" min="0" step="any" placeholder="未知请留空"></label>
        ${fieldErrHtml('positioning.weeklyHours')}
      </div>`;
  }

  function idToField(id) {
    return ({ mktIntro: 'intro', mktMarkets: 'markets', mktAudience: 'audience', mktScenarios: 'scenarios', mktPain: 'painPoints', mktAlt: 'alternatives', mktDiff: 'differentiators', mktLinks: 'links', mktGoal: 'stageGoal', mktMetric: 'primaryMetric' })[id] || id;
  }

  function evidenceHtml() {
    const rows = state.draft.evidence.map((e, i) => `
      <div class="mkt-ev-row" data-ev="${i}">
        <div class="mkt-ev-grid">
          <select id="mktEvType-${i}" title="证据类型">${EVIDENCE_TYPES.map(([k, l]) => `<option value="${esc(k)}"${k === e.type ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
          <input id="mktEvDate-${i}" type="date" value="${esc(e.collectedAt || '')}" title="采集日期">
        </div>
        <input id="mktEvContent-${i}" placeholder="证据内容（事实 / 假设 / 待确认）">
        ${fieldErrHtml(`evidence.${i}.content`)}
        <div class="mkt-ev-source">
          <input id="mktEvSource-${i}" placeholder="来源链接或访谈引用">
          <button type="button" class="btn small quiet" id="mktEvDel-${i}" title="删除本条证据">删除</button>
        </div>
        ${fieldErrHtml(`evidence.${i}.source`)}
      </div>`).join('');
    return `
      <h4>证据</h4>
      <p class="muted small">区分 事实 / 假设 / 待确认：假设需验证后才可作定价与渠道依据。</p>
      <div class="mkt-ev-list">${rows || '<p class="muted">暂无证据条目。</p>'}</div>
      <button type="button" class="btn small" id="mktEvAdd">＋ 添加证据</button>`;
  }

  function pricingFormHtml() {
    const d = state.priceDraft;
    const needCurrency = d.model !== 'free';
    const needCycle = d.model === 'subscription';
    const pkgRows = d.packages.map((p, i) => `
      <div class="mkt-pkg-row" data-pkg="${i}">
        <input id="mktPkgName-${i}" placeholder="套餐名（如 专业版）">
        <input id="mktPkgBenefits-${i}" placeholder="套餐权益">
        <input id="mktPkgPrice-${i}" type="number" min="0" step="any" placeholder="候选价格，未知留空">
        <button type="button" class="btn small quiet" id="mktPkgDel-${i}" title="删除本套餐">删除</button>
        ${fieldErrHtml(`packages.${i}.price`)}
      </div>`).join('');
    return `
      <div class="mkt-form-head">
        <h4>定价候选（新版本）</h4>
        <p class="muted small">保存即新建版本并保留历史；不会自动成为当前定价，「设为当前方案」在右侧版本历史中显式操作。</p>
      </div>
      <label class="field">收费模式
        <select id="mktPriceModel">${PRICING_MODELS.map(([k, l]) => `<option value="${esc(k)}"${k === d.model ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
      </label>
      <div class="mkt-num-row">
        <label class="field">币种${needCurrency ? '' : '（免费可空）'}<input id="mktPriceCurrency" placeholder="例 CNY / USD"></label>
        ${fieldErrHtml('currency')}
        <label class="field">收费周期${needCycle ? '' : '（仅订阅需要）'}
          <select id="mktPriceCycle"><option value="">— 请选择 —</option>${CYCLES.map(([k, l]) => `<option value="${esc(k)}"${k === d.cycle ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
        </label>
        ${fieldErrHtml('cycle')}
      </div>
      <div class="mkt-pkg-list">${pkgRows}</div>
      <button type="button" class="btn small" id="mktPkgAdd">＋ 添加套餐</button>
      <label class="field">成本与竞品依据<textarea id="mktPriceCost" rows="2" placeholder="成本结构、竞品价格与依据"></textarea></label>
      <label class="field">验证方法<textarea id="mktPriceValidation" rows="2" placeholder="如何验证这个价格（如落地页测试、访谈出价）"></textarea></label>
      <div class="mkt-price-foot">
        <button type="button" class="btn primary" id="mktPriceSave">保存为定价新版本</button>
        <span class="muted small" id="mktPriceState" role="status" aria-live="polite"></span>
      </div>`;
  }

  function versionsHtml() {
    const vs = state.data?.versions || [];
    const cur = state.data?.current || null;
    const rows = vs.length ? vs.map((v) => {
      const corrupt = v.corrupt === true;
      const active = state.versionSel === v.version;
      return `
        <div class="mkt-ver-row${active ? ' picked' : ''}">
          <button type="button" class="btn small quiet mkt-ver-btn" id="mktVerBtn-${esc(v.version)}" title="只读查看该版本">${esc(corrupt ? `${v.version}（文件损坏，只读占位）` : versionLine(v))}</button>
          ${v.version === cur ? '<span class="mkt-cur-badge">当前</span>' : ''}
          ${!corrupt && v.version !== cur ? `<button type="button" class="btn small" id="mktSetCurrent-${esc(v.version)}"${state.settingCurrent ? ' disabled' : ''}>设为当前方案</button>` : ''}
        </div>`;
    }).join('') : '<p class="muted">暂无定价版本：在左侧保存第一个候选。</p>';
    return `
      <h4>版本历史</h4>
      <div class="mkt-ver-list">${rows}</div>
      <div id="mktVerDetail" class="mkt-ver-detail" aria-live="polite"></div>
      ${state.opError ? `<p class="notice err">${esc(state.opError)}</p>` : ''}`;
  }

  function versionDetailHtml() {
    const v = (state.data?.versions || []).find((x) => x.version === state.versionSel);
    if (!v) return '<p class="muted small">选择上方版本只读查看。</p>';
    if (v.corrupt) return `<p class="notice err">${esc(v.version)} 文件损坏：只读占位保留历史位，不能设为当前方案。</p>`;
    const pkgs = (v.packages || []).map((p) => `
      <tr><td>${esc(p.name) || '—'}</td><td>${esc(p.benefits) || '—'}</td><td>${p.price == null ? '<span class="muted">未知</span>' : esc(p.price)}</td></tr>`).join('');
    return `
      <p class="mkt-ro-head"><span class="mkt-ro">只读</span> ${esc(versionLine(v))}${v.version === (state.data?.current) ? ' <span class="mkt-cur-badge">当前</span>' : ''}<span class="muted small"> · 创建于 ${esc(fmtTime(v.createdAt))}</span></p>
      <dl class="mkt-dl">
        <dt>成本与竞品依据</dt><dd>${esc(v.costBasis) || '<span class="muted">未填写</span>'}</dd>
        <dt>验证方法</dt><dd>${esc(v.validationMethod) || '<span class="muted">未填写</span>'}</dd>
      </dl>
      ${pkgs ? `<table class="mkt-pkg-table"><thead><tr><th>套餐</th><th>权益</th><th>候选价格</th></tr></thead><tbody>${pkgs}</tbody></table>` : '<p class="muted small">无套餐。</p>'}`;
  }

  /* ================================================================
   * REQ-20260910-021 效果与复盘
   * ================================================================ */

  function effectData() {
    return state.effect && state.effect.initialized === true ? state.effect : null;
  }
  function effCard(metricKey) { return (effectData()?.cards || []).find((c) => c.metricKey === metricKey) || null; }
  function metricNameOf(key) { return (effectData()?.definitions || []).find((d) => d.key === key)?.name || key; }
  function channelLabelOf(id) {
    return id ? ((effectData()?.channels || []).find((c) => c.id === id)?.platform || id) : '未指定归属';
  }
  function expLabelOf(id) { return (effectData()?.experiments || []).find((x) => x.id === id)?.hypothesis || id; }

  function ensureEffect() {
    if (state.effectPhase === 'idle' || state.effectPhase === 'error') refreshEffect();
  }

  function sanitizeEffectRefs() {
    const e = effectData();
    if (!e) return;
    if (state.effChan && !(e.channels || []).some((c) => c.id === state.effChan)) state.effChan = '';
    if (state.effExp && !(e.experiments || []).some((x) => x.id === state.effExp)) state.effExp = '';
    if (state.effMetric && !(e.cards || []).some((c) => c.metricKey === state.effMetric)) state.effMetric = null;
  }

  async function refreshEffect() {
    state.effectPhase = 'loading';
    state.effectError = null;
    render();
    const q = [];
    if (state.effFrom) q.push(`from=${encodeURIComponent(state.effFrom)}`);
    if (state.effTo) q.push(`to=${encodeURIComponent(state.effTo)}`);
    if (state.effChan) q.push(`channel=${encodeURIComponent(state.effChan)}`);
    if (state.effExp) q.push(`experiment=${encodeURIComponent(state.effExp)}`);
    let r;
    try {
      r = await apiJson(`/api/marketing/effect${q.length ? `?${q.join('&')}` : ''}`);
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    if (r.ok && r.json && r.json.initialized === true) {
      state.effect = r.json;
      state.effectPhase = 'ready';
      sanitizeEffectRefs();
    } else if (r.ok) {
      state.effect = null;
      state.effectPhase = 'ready';
    } else {
      state.effectPhase = 'error';
      state.effectError = r.json?.error || `读取失败（${r.status}）`;
    }
    render();
  }

  function fmtNum(n) {
    if (n == null) return '';
    const num = Number(n);
    return Number.isFinite(num) ? num.toLocaleString() : String(n);
  }

  // 客户端日历校验（与服务端一致：2026-02-30 / 09-32 拒绝）
  function isValidDateStr(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
    const [y, m, d] = String(s).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  /* ---------- 渲染 ---------- */

  function effValueHtml(c) {
    if (c.status === 'none') return '<span class="mkt-eff-none">未录入</span>';
    if (c.status === 'split') return '<span class="mkt-eff-split">分开呈现</span>';
    if (c.value == null) return '<span class="mkt-eff-none">未知（空值）</span>';
    return `${esc(fmtNum(c.value))}${c.value === 0 ? '<span class="mkt-zero-badge">真实零</span>' : ''}${c.unitText ? `<span class="mkt-eff-unit">${esc(c.unitText)}</span>` : ''}`;
  }

  function effCardHtml(c) {
    const parts = (c.parts || []).map((p) => `
      <span class="mkt-eff-part">${esc(p.channelLabel || channelLabelOf(p.channelId))} ${p.value == null ? '未知' : esc(fmtNum(p.value))}${p.unit ? ` ${esc(p.unit)}` : ''} · ${esc(p.period)}</span>`).join('');
    const src = (c.sources || []).map((s) => `${esc(s.source)} · ${esc(fmtTime(s.updatedAt))}`).join('；');
    return `
      <button type="button" class="mkt-eff-card${state.effMetric === c.metricKey ? ' picked' : ''}" id="mktEffCard-${esc(c.metricKey)}" data-metric="${esc(c.metricKey)}" title="点击查看指标定义与原始记录">
        <span class="mkt-eff-name">${esc(c.name)}</span>
        <span class="mkt-eff-val">${effValueHtml(c)}</span>
        ${c.status === 'split' && parts ? `<span class="mkt-eff-parts">${parts}</span>` : ''}
        ${c.note ? `<span class="mkt-eff-note">${esc(c.note)}</span>` : ''}
        ${src ? `<span class="mkt-eff-src">来源：${esc(src)}</span>` : ''}
      </button>`;
  }

  function effToolbarHtml(e) {
    const chOpts = `<option value="">全部渠道</option>${(e.channels || []).map((c) => `<option value="${esc(c.id)}"${state.effChan === c.id ? ' selected' : ''}>${esc(c.platform || c.id)}${c.corrupt ? '（损坏）' : ''}</option>`).join('')}`;
    const expOpts = `<option value="">全部实验</option>${(e.experiments || []).map((x) => `<option value="${esc(x.id)}"${state.effExp === x.id ? ' selected' : ''}>${esc(String(x.hypothesis || x.id).slice(0, 18))}${x.corrupt ? '（损坏）' : ''}</option>`).join('')}`;
    const hasFilter = !!(state.effFrom || state.effTo || state.effChan || state.effExp);
    return `
      <div class="mkt-toolbar">
        <label class="mkt-filter">从<input id="mktEffFrom" type="date" value="${esc(state.effFrom)}"></label>
        <label class="mkt-filter">至<input id="mktEffTo" type="date" value="${esc(state.effTo)}"></label>
        <label class="mkt-filter">渠道<select id="mktEffChan">${chOpts}</select></label>
        <label class="mkt-filter">实验<select id="mktEffExp">${expOpts}</select></label>
        ${hasFilter ? '<button type="button" class="btn small quiet" id="mktEffClear">清除筛选</button>' : ''}
        <span class="mkt-toolbar-spacer"></span>
        <button type="button" class="btn small quiet" id="mktAddMetric" title="自定义指标定义">＋ 指标</button>
        <button type="button" class="btn small" id="mktAddObs">录入指标</button>
        <button type="button" class="btn small" id="mktImportCsv">导入CSV</button>
        <button type="button" class="btn small mkt-ai-btn" data-ai-type="review" title="复制提示词到外部 Agent 会话生成复盘草稿">✦ 生成复盘草稿</button>
        <button type="button" class="btn small primary" id="mktAddReview">新建复盘</button>
      </div>`;
  }

  function effDerivedHtml(e) {
    const items = (e.derived || []).map((d) => {
      let val;
      if (d.status === 'value') {
        const pct = Number.isFinite(d.value) ? (d.value * 100).toFixed(1).replace(/\.0$/, '') : '?';
        val = `<b>${esc(pct)}%</b>${d.period ? `<span class="muted small">（${esc(d.period)}）</span>` : ''}`;
      } else {
        val = '<span class="mkt-eff-na">不可计算</span>';
      }
      return `
        <span class="mkt-eff-derive"><span class="mkt-eff-derive-name">${esc(d.name)}</span> ${val}${d.reason ? `<span class="mkt-eff-note">${esc(d.reason)}</span>` : ''}</span>`;
    }).join('');
    return items ? `<div class="mkt-eff-derived" aria-label="派生指标">${items}</div>` : '';
  }

  function effCatsHtml(e) {
    const groups = METRIC_CATEGORIES
      .map(([key, label]) => ({ key, label, cards: (e.cards || []).filter((c) => c.category === key) }))
      .filter((g) => g.cards.length);
    return groups.map((g) => `
      <section class="mkt-eff-cat" aria-label="${esc(g.label)}">
        <h5>${esc(g.label)}<span class="mkt-eff-cat-count">${g.cards.length}</span></h5>
        <div class="mkt-eff-cards">${g.cards.map(effCardHtml).join('')}</div>
      </section>`).join('');
  }

  function effTrendHtml(def, rows) {
    const series = rows.slice().sort((a, b) => String(a.dateEnd).localeCompare(String(b.dateEnd)));
    const max = Math.max(0, ...series.map((o) => (o.value == null ? 0 : o.value)));
    const bars = series.map((o) => {
      const h = max > 0 ? Math.max(4, Math.round(((o.value || 0) / max) * 100)) : 4;
      return `<div class="mkt-cbar" title="${esc(o.dateStart)}~${esc(o.dateEnd)}：${o.value == null ? '未知' : esc(fmtNum(o.value))}"><i style="height:${h}%"></i><span>${esc(String(o.dateEnd).slice(5))}</span></div>`;
    }).join('');
    return `<div class="mkt-trend" aria-label="趋势">${bars}</div><p class="muted small">按周期展示；口径（去重 / 币种 / 归属）不同的记录请分别在筛选中查看。</p>`;
  }

  function effDetailHtml() {
    const key = state.effMetric;
    if (!key) return '';
    const e = effectData();
    const c = effCard(key);
    const def = (e?.definitions || []).find((d) => d.key === key) || null;
    if (!e || !c || !def) return '';
    const rows = (e.observations || []).filter((o) => o.metricKey === key && o.corrupt !== true);
    const hist = rows.map((o) => `
      <details class="mkt-hist">
        <summary>r${o.revision} · ${esc(fmtTime(o.updatedAt))} · ${esc(o.source)}（修订历史 ${(o.history || []).length}）</summary>
        <ul class="mkt-obs-hist">${(o.history || []).slice().reverse().map((hh) => `<li>r${hh.rev} · ${hh.value == null ? '未知' : esc(fmtNum(hh.value))}${hh.reason ? ` · 理由：${esc(hh.reason)}` : ''}${hh.by ? ` · ${esc(hh.by)}` : ''}</li>`).join('')}</ul>
      </details>`).join('');
    const trend = def.kind !== 'stock' && rows.length
      ? effTrendHtml(def, rows)
      : '<p class="muted small">存量指标不跨日期相加，不展示趋势求和。</p>';
    return `
      <section class="mkt-block mkt-eff-detail" aria-label="指标详情">
        <h4>${esc(def.name)} <span class="muted small">${esc(METRIC_KIND_LABEL[def.kind] || '')} · ${def.money ? '币种随记录' : esc(def.unit || '')}</span></h4>
        <dl class="mkt-dl">
          <dt>去重口径</dt><dd>${esc(def.dedup || '—')}</dd>
          <dt>观察记录</dt><dd>${rows.length} 条（当前筛选范围内）</dd>
        </dl>
        ${trend}
        ${rows.length ? `<table class="mkt-obs-table"><thead><tr><th>期间</th><th>值</th><th>口径</th><th>来源</th><th>修订</th></tr></thead><tbody>
          ${rows.map((o) => `<tr><td>${esc(o.dateStart)}~${esc(o.dateEnd)}</td><td>${o.value == null ? '<span class="muted">未知</span>' : esc(fmtNum(o.value))}${o.value === 0 ? ' <span class="mkt-zero-badge">真实零</span>' : ''}${o.unit ? ` ${esc(o.unit)}` : ''}</td><td>${esc(channelLabelOf(o.channelId))}${o.experimentId ? ` · 实验 ${esc(String(expLabelOf(o.experimentId)).slice(0, 12))}` : ''}</td><td>${esc(o.source)}</td><td>r${o.revision}</td></tr>`).join('')}
        </tbody></table>
        ${hist}` : '<p class="muted small">尚无观察记录：点「录入指标」或「导入CSV」。</p>'}
      </section>`;
  }

  function effObsTableHtml(e) {
    const rows = e.observations || [];
    if (!rows.length) return '<section class="mkt-block"><h4>原始观察记录</h4><p class="muted">尚无观察记录：点「录入指标」或「导入CSV」开始积累数据。</p></section>';
    const trs = rows.map((o) => (o.corrupt === true
      ? `<tr><td colspan="7">${esc(o.id)}（文件损坏，只读占位）</td></tr>`
      : `<tr><td>${esc(metricNameOf(o.metricKey))}</td><td>${esc(o.dateStart)}~${esc(o.dateEnd)}</td><td>${o.value == null ? '<span class="muted">未知</span>' : esc(fmtNum(o.value))}${o.value === 0 ? ' <span class="mkt-zero-badge">真实零</span>' : ''}</td><td>${esc(o.unit || '—')}</td><td>${esc(channelLabelOf(o.channelId))}${o.experimentId ? ` · ${esc(String(expLabelOf(o.experimentId)).slice(0, 12))}` : ''}</td><td>${esc(o.source)}</td><td>r${o.revision}</td></tr>`)).join('');
    return `
      <section class="mkt-block" aria-label="原始观察记录">
        <h4>原始观察记录（${rows.length}）</h4>
        <table class="mkt-obs-table"><thead><tr><th>指标</th><th>期间</th><th>值</th><th>单位 / 币种</th><th>口径</th><th>来源</th><th>修订</th></tr></thead><tbody>${trs}</tbody></table>
      </section>`;
  }

  function effReviewsHtml(e) {
    const rows = (e.reviews || []).map((rv) => `
      <article class="mkt-review-card">
        <header>
          <b>${esc(rv.periodStart)}~${esc(rv.periodEnd)}</b>
          ${rv.experimentId ? `<span class="mkt-act-chip">${esc(String(expLabelOf(rv.experimentId)).slice(0, 16))}</span>` : ''}
          ${rv.insufficient
            ? '<span class="mkt-review-flag na">数据不足</span>'
            : `<span class="mkt-review-flag ok">依据快照（固定 ${rv.snapshot.length} 项 · 不随修订改变）</span>`}
        </header>
        ${rv.insufficient ? '' : `<dl class="mkt-dl"><dt>目标</dt><dd>${esc(rv.target) || '—'}</dd><dt>实际</dt><dd>${esc(rv.actual) || '—'}</dd></dl>`}
        <p class="mkt-review-conc">${esc(rv.conclusion)}</p>
        ${rv.nextStep ? `<p class="muted small">下一步：${esc(rv.nextStep)}</p>` : ''}
        ${rv.snapshot.length ? `<details class="mkt-hist"><summary>依据快照（保存时固定，含值与修订号）</summary><ul class="mkt-obs-hist">${rv.snapshot.map((s) => `<li>${esc(s.metricName)} · ${esc(s.dateStart)}~${esc(s.dateEnd)} · ${s.value == null ? '未知' : esc(fmtNum(s.value))} ${esc(s.unit || '')} · r${s.revision}</li>`).join('')}</ul></details>` : ''}
      </article>`).join('');
    return `
      <section class="mkt-block" aria-label="复盘记录">
        <h4>复盘记录（${(e.reviews || []).length}）</h4>
        ${rows || '<p class="muted">尚无复盘：点击「新建复盘」选择观察期与依据（保存后关联实验）。</p>'}
      </section>`;
  }

  function reviewPaneHtml() {
    if (state.effectPhase === 'loading') {
      return '<div class="mkt-phase"><p class="muted">正在加载效果数据…</p></div>';
    }
    if (state.effectPhase === 'error') {
      return `
        <div class="mkt-phase">
          <div class="notice err">效果与复盘读取失败：${esc(state.effectError || '未知错误')}</div>
          <button type="button" class="btn" id="mktEffRetry">重试</button>
        </div>`;
    }
    const e = effectData();
    if (!e) return '<div class="mkt-phase"><p class="muted">营销档案尚未初始化：先在「定位与定价」页建立营销档案。</p></div>';
    return `
      ${effToolbarHtml(e)}
      ${effDerivedHtml(e)}
      ${effCatsHtml(e)}
      ${effDetailHtml()}
      ${effObsTableHtml(e)}
      ${effReviewsHtml(e)}
      ${state.modal ? modalHtml(state.modal) : ''}
      <div id="mktToast" class="mkt-toast" role="status" aria-live="polite"></div>`;
  }

  /* ---------- 弹窗（录入观察 / 导入向导 / 新建复盘 / 自定义指标） ---------- */

  function blankObservationModal() {
    return {
      kind: 'observation', metricKey: '', value: '', unit: '',
      dateStart: todayStr(), dateEnd: todayStr(),
      channelId: '', experimentId: '', source: '手工记录', timezone: 'UTC+8', reason: '',
      fieldErrors: {}, error: null, saving: false,
    };
  }

  function blankImportModal() {
    return {
      kind: 'import', step: 1, csv: '', header: [], colFields: {},
      preview: null, choices: {}, result: null, error: null, busy: false, fieldErrors: {},
    };
  }

  function blankReviewModal() {
    return {
      kind: 'review', experimentId: '', periodStart: '', periodEnd: '',
      target: '', actual: '', basis: '', conclusion: '', nextStep: '', insufficient: false,
      fieldErrors: {}, error: null, saving: false,
    };
  }

  function blankMetricModal() {
    return {
      kind: 'metric', name: '', key: '', category: 'usage', kind: 'delta', unit: '', dedup: '',
      fieldErrors: {}, error: null, saving: false,
    };
  }

  function importModalHtml(m) {
    const errBox = m.error ? `<p class="notice err">${esc(m.error)}</p>` : '';
    const fieldErr = m.fieldErrors && Object.keys(m.fieldErrors).length
      ? `<p class="notice err">${esc(Object.values(m.fieldErrors)[0])}</p>` : '';
    if (m.step === 1) {
      return modalShell('导入 CSV（1/3 粘贴数据）', `
        <div class="mkt-imp-steps">粘贴数据 → 字段映射 → 预览校验 → 确认结果</div>
        <label class="field">CSV 文本（UTF-8，首行为表头）<textarea id="mktImpCsv" rows="8" placeholder="粘贴 CSV 内容（可先下载模板）"></textarea></label>
        ${errBox}
        <p class="muted small"><a id="mktImpTpl" href="${esc(url('/api/marketing/import/template'))}" download="metrics-template.csv">下载模板</a> · 同一文件重复导入为无变化；与现有记录值不同需逐行选择修订或跳过。</p>`,
      `<button type="button" class="btn primary" id="mktImpNext"${m.busy ? ' disabled' : ''}>下一步：字段映射</button>`);
    }
    if (m.step === 2) {
      const rowsHtml = (m.header || []).map((col, i) => `
        <label class="mkt-imp-map-row">「${esc(col)}」映射为
          <select id="mktImpMap-${i}" data-col="${i}">
            <option value="">（按表头自动识别）</option>
            ${IMPORT_MAP_FIELDS.map(([v, l]) => `<option value="${esc(v)}"${(m.colFields || {})[i] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}
          </select>
        </label>`).join('');
      return modalShell('导入 CSV（2/3 字段映射）', `
        <div class="mkt-imp-steps">粘贴数据 → <b>字段映射</b> → 预览校验 → 确认结果</div>
        <p class="muted small">未手动指定时按表头名称自动识别；必填：开始日期 / 结束日期 / 指标 / 值。</p>
        ${rowsHtml}
        ${errBox}`,
      `<button type="button" class="btn" id="mktImpBack"${m.busy ? ' disabled' : ''}>上一步</button><button type="button" class="btn primary" id="mktImpNext"${m.busy ? ' disabled' : ''}>预览校验</button>`);
    }
    if (m.step === 3) {
      const rows = (m.preview?.rows) || [];
      const rowsHtml = rows.map((rw) => {
        const bad = rw.status === 'error';
        const conflict = rw.status === 'conflict';
        return `
        <tr class="${bad ? 'mkt-imp-rowerr' : ''}">
          <td>第 ${rw.rowNo} 行</td>
          <td>${esc(IMP_STATUS_LABEL[rw.status] || rw.status)}</td>
          <td>${esc(rw.metricName || rw.metricKey || '')}</td>
          <td>${esc(rw.dateStart || '')}~${esc(rw.dateEnd || '')}</td>
          <td>${rw.value == null ? '未知' : esc(fmtNum(rw.value))}${rw.unit ? ` ${esc(rw.unit)}` : ''}</td>
          <td>${bad ? `<span class="mkt-imp-errmsg">${esc(rw.error)}</span>`
            : conflict ? `<span class="mkt-imp-errmsg">现有 ${rw.existingValue == null ? '未知' : esc(fmtNum(rw.existingValue))}（r${rw.existingRevision}）</span>`
            : rw.status === 'same' ? '与现有记录一致（无变化）' : ''}</td>
          <td>${conflict ? `
            <label class="mkt-imp-choice"><input type="radio" name="impChoice-${rw.rowNo}" id="mktImpChoice-${rw.rowNo}-revise" value="revise">修订</label>
            <label class="mkt-imp-choice"><input type="radio" name="impChoice-${rw.rowNo}" id="mktImpChoice-${rw.rowNo}-skip" value="skip">跳过</label>
            <input id="mktImpReason-${rw.rowNo}" placeholder="修订理由（选修订时必填）">` : ''}</td>
        </tr>`;
      }).join('');
      const hasErr = rows.some((x) => x.status === 'error');
      return modalShell('导入 CSV（3/3 预览校验）', `
        <div class="mkt-imp-steps">粘贴数据 → 字段映射 → <b>预览校验</b> → 确认结果</div>
        ${hasErr ? '<p class="notice err">存在错误行：修正 CSV 后重新预览。存在错误时不提交、不写入部分数据。</p>' : ''}
        <table class="mkt-obs-table mkt-imp-table"><thead><tr><th>行</th><th>状态</th><th>指标</th><th>期间</th><th>导入值</th><th>说明</th><th>冲突处理</th></tr></thead><tbody>${rowsHtml}</tbody></table>
        ${errBox}${fieldErr}`,
        `<button type="button" class="btn" id="mktImpBack"${m.busy ? ' disabled' : ''}>上一步</button>
         <button type="button" class="btn primary" id="mktImpSubmit"${hasErr || m.busy ? ' disabled' : ''}>${m.busy ? '提交中…' : '确认提交'}</button>`);
    }
    const rst = m.result || {};
    return modalShell('导入完成', `
      <p>新增 ${rst.created ?? 0} · 修订 ${rst.revised ?? 0} · 无变化 ${rst.unchanged ?? 0} · 跳过 ${rst.skipped ?? 0}。</p>
      <p class="muted small">重复导入同文件为无变化；修订记录可在指标详情查看修订历史（含修改理由）。</p>`,
    '<button type="button" class="btn primary" id="mktImpClose">完成</button>');
  }

  /* ---------- 提交 ---------- */

  function importMappingOf(m) {
    const mapping = {};
    for (const [i, f] of Object.entries(m.colFields || {})) if (f) mapping[f] = Number(i);
    return mapping;
  }

  async function importNext() {
    const m = state.modal;
    if (!m || m.busy) return;
    if (m.step === 1) {
      if (!String(m.csv || '').trim()) {
        m.error = '请先粘贴 CSV 内容';
        render();
        return;
      }
      m.error = null;
      const firstLine = String(m.csv).replace(/^\uFEFF/, '').split(/\r?\n/).find((l) => l.trim()) || '';
      m.header = firstLine.split(',').map((s) => s.trim());
      m.step = 2;
      render();
      return;
    }
    if (m.step === 2) {
      m.busy = true;
      m.error = null;
      render();
      let r;
      try {
        r = await apiJson('/api/marketing/import/preview', { csv: m.csv, mapping: importMappingOf(m) });
      } catch (e) {
        r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
      }
      if (state.modal === m) m.busy = false;
      if (r.ok && r.json && Array.isArray(r.json.rows)) {
        m.preview = r.json;
        m.choices = {};
        m.fieldErrors = {};
        m.step = 3;
        render();
      } else {
        m.error = r.json?.error || `预览失败（${r.status}），可重试`;
        render();
      }
    }
  }

  function importBack() {
    const m = state.modal;
    if (!m) return;
    if (m.step === 2) m.step = 1;
    else if (m.step === 3) m.step = 2;
    m.error = null;
    m.fieldErrors = {};
    render();
  }

  async function importSubmit() {
    const m = state.modal;
    if (!m || m.busy) return;
    const rows = m.preview?.rows || [];
    if (rows.some((x) => x.status === 'error')) return; // 按钮已禁用，双保险：错误行不提交
    const errs = {};
    for (const c of rows.filter((x) => x.status === 'conflict')) {
      const ch = m.choices[c.rowNo];
      if (!ch || (ch.action !== 'revise' && ch.action !== 'skip')) {
        errs[`rows.${c.rowNo}`] = `第 ${c.rowNo} 行值冲突：需明确选择修订或跳过（不静默相加）`;
      } else if (ch.action === 'revise' && !String(ch.reason || '').trim()) {
        errs[`rows.${c.rowNo}.reason`] = `第 ${c.rowNo} 行选择修订需填写修改理由`;
      }
    }
    if (Object.keys(errs).length) {
      m.fieldErrors = errs;
      render();
      return;
    }
    m.fieldErrors = {};
    m.busy = true;
    m.error = null;
    render();
    let r;
    try {
      r = await apiJson('/api/marketing/import/commit', { csv: m.csv, mapping: importMappingOf(m), choices: m.choices });
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    if (state.modal === m) m.busy = false;
    if (r.ok && r.json && typeof r.json.created === 'number') {
      m.result = r.json;
      m.step = 4;
      render();
      await refreshEffect();
      notifyState();
      return;
    }
    if (r.json?.fields) m.fieldErrors = r.json.fields;
    m.error = r.json?.error || `提交失败（${r.status}），可重试`;
    render();
  }

  async function submitObservationModal() {
    const m = state.modal;
    if (!m || m.saving) return;
    const errs = {};
    if (!m.metricKey) errs.metricKey = '请选择指标';
    if (!isValidDateStr(m.dateStart)) errs.dateStart = '开始日期应为合法的 YYYY-MM-DD';
    if (!isValidDateStr(m.dateEnd)) errs.dateEnd = '结束日期应为合法的 YYYY-MM-DD';
    if (isValidDateStr(m.dateStart) && isValidDateStr(m.dateEnd) && String(m.dateStart) > String(m.dateEnd)) {
      errs.dateEnd = '结束日期不能早于开始日期';
    }
    if (m.value !== '' && m.value != null) {
      const n = Number(m.value);
      if (!Number.isFinite(n) || n < 0) errs.value = '值必须是不小于 0 的数字（未知请留空，真实零填 0）';
    }
    if (Object.keys(errs).length) {
      m.fieldErrors = { ...m.fieldErrors, ...errs };
      render();
      return;
    }
    m.saving = true;
    m.error = null;
    render();
    const data = {
      metricKey: m.metricKey, dateStart: m.dateStart, dateEnd: m.dateEnd,
      value: m.value === '' || m.value == null ? null : Number(m.value),
      unit: m.unit, channelId: m.channelId || null, experimentId: m.experimentId || null,
      source: m.source || '手工记录', timezone: m.timezone, reason: m.reason,
    };
    let r;
    try {
      r = await apiJson('/api/marketing/observation', { data });
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    if (state.modal === m) m.saving = false;
    if (r.ok && r.json?.observation) {
      state.modal = null;
      showToast(r.json.revised === true ? '已修订（修改理由已入历史）' : r.json.created === false ? '与现有记录一致：无变化（不重复计算）' : '观察已保存');
      render();
      await refreshEffect();
      notifyState();
      return;
    }
    handleModalFail(m, r);
  }

  async function submitReviewModal() {
    const m = state.modal;
    if (!m || m.saving) return;
    const errs = {};
    if (!isValidDateStr(m.periodStart)) errs.periodStart = '观察开始应为合法的 YYYY-MM-DD';
    if (!isValidDateStr(m.periodEnd)) errs.periodEnd = '观察结束应为合法的 YYYY-MM-DD';
    if (isValidDateStr(m.periodStart) && isValidDateStr(m.periodEnd) && String(m.periodStart) > String(m.periodEnd)) {
      errs.periodEnd = '观察结束不能早于观察开始';
    }
    if (!String(m.conclusion || '').trim()) errs.conclusion = '复盘结论不能为空';
    if (!m.insufficient && (!String(m.target || '').trim() || !String(m.actual || '').trim())) {
      errs.insufficient = '缺少目标 / 实际：无数据请勾选「数据不足」（不伪造改善幅度）';
    }
    if (Object.keys(errs).length) {
      m.fieldErrors = { ...m.fieldErrors, ...errs };
      render();
      return;
    }
    m.saving = true;
    m.error = null;
    render();
    const data = {
      experimentId: m.experimentId || null, periodStart: m.periodStart, periodEnd: m.periodEnd,
      target: m.target, actual: m.actual, basis: m.basis, conclusion: m.conclusion,
      nextStep: m.nextStep, insufficient: m.insufficient === true,
    };
    let r;
    try {
      r = await apiJson('/api/marketing/review', { data });
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    if (state.modal === m) m.saving = false;
    if (r.ok && r.json?.review) {
      state.modal = null;
      showToast(m.insufficient ? '复盘已保存（数据不足，不伪造依据）' : '复盘已保存（依据快照已固定，不随修订改变）');
      render();
      await refreshEffect();
      notifyState();
      return;
    }
    handleModalFail(m, r);
  }

  async function submitMetricModal() {
    const m = state.modal;
    if (!m || m.saving) return;
    const errs = {};
    if (!String(m.name || '').trim()) errs.name = '指标名称不能为空';
    if (!String(m.unit || '').trim()) errs.unit = '单位 / 币种不能为空';
    if (Object.keys(errs).length) {
      m.fieldErrors = { ...m.fieldErrors, ...errs };
      render();
      return;
    }
    m.saving = true;
    m.error = null;
    render();
    let r;
    try {
      r = await apiJson('/api/marketing/metric', { data: { ...m } });
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    if (state.modal === m) m.saving = false;
    if (r.ok && r.json?.definition) {
      state.modal = null;
      showToast('自定义指标已保存');
      render();
      await refreshEffect();
      notifyState();
      return;
    }
    handleModalFail(m, r);
  }

  /* ---------- 绑定 ---------- */

  function bindEffect() {
    const view = viewEl();
    if (!view) return;
    const el = (sel) => view.querySelector(sel);
    const e = effectData();

    for (const [sel, key] of [['#mktEffFrom', 'effFrom'], ['#mktEffTo', 'effTo']]) {
      const n = el(sel);
      if (n) n.addEventListener('input', () => { state[key] = n.value || ''; render(); refreshEffect(); });
    }
    const chanSel = el('#mktEffChan');
    if (chanSel) chanSel.addEventListener('input', () => { state.effChan = chanSel.value || ''; render(); refreshEffect(); notifyState(); });
    const expSel = el('#mktEffExp');
    if (expSel) expSel.addEventListener('input', () => { state.effExp = expSel.value || ''; render(); refreshEffect(); notifyState(); });
    el('#mktEffClear')?.addEventListener('click', () => {
      state.effFrom = '';
      state.effTo = '';
      state.effChan = '';
      state.effExp = '';
      render();
      refreshEffect();
      notifyState();
    });
    el('#mktEffRetry')?.addEventListener('click', () => refreshEffect());
    el('#mktAddObs')?.addEventListener('click', () => { state.modal = blankObservationModal(); render(); });
    el('#mktImportCsv')?.addEventListener('click', () => { state.modal = blankImportModal(); render(); });
    el('#mktAddReview')?.addEventListener('click', () => { state.modal = blankReviewModal(); render(); });
    el('#mktAddMetric')?.addEventListener('click', () => { state.modal = blankMetricModal(); render(); });

    for (const c of e?.cards || []) {
      el(`#mktEffCard-${c.metricKey}`)?.addEventListener('click', () => {
        state.effMetric = state.effMetric === c.metricKey ? null : c.metricKey;
        render();
        notifyState();
      });
    }

    const m = state.modal;
    if (m) {
      if (m.kind === 'import') {
        const csvTa = el('#mktImpCsv');
        if (csvTa) {
          csvTa.value = m.csv || '';
          csvTa.addEventListener('input', () => { m.csv = csvTa.value; });
        }
        el('#mktImpNext')?.addEventListener('click', () => importNext());
        el('#mktImpBack')?.addEventListener('click', () => importBack());
        el('#mktImpSubmit')?.addEventListener('click', () => importSubmit());
        el('#mktImpClose')?.addEventListener('click', () => { state.modal = null; render(); });
        if (m.step === 2) {
          for (let i = 0; i < (m.header || []).length; i++) {
            const n = el(`#mktImpMap-${i}`);
            if (!n) continue;
            n.value = (m.colFields || {})[i] || '';
            n.addEventListener('input', () => { m.colFields = { ...(m.colFields || {}), [i]: n.value }; });
          }
        }
        if (m.step === 3) {
          for (const rw of (m.preview?.rows) || []) {
            if (rw.status !== 'conflict') continue;
            for (const act of ['revise', 'skip']) {
              const rEl = el(`#mktImpChoice-${rw.rowNo}-${act}`);
              if (!rEl) continue;
              rEl.addEventListener('input', () => {
                const cur = m.choices[rw.rowNo] || {};
                m.choices = { ...m.choices, [rw.rowNo]: { ...cur, action: act } };
              });
            }
            const ri = el(`#mktImpReason-${rw.rowNo}`);
            if (ri) {
              ri.value = (m.choices[rw.rowNo] || {}).reason || '';
              ri.addEventListener('input', () => {
                const cur = m.choices[rw.rowNo] || { action: '' };
                m.choices = { ...m.choices, [rw.rowNo]: { ...cur, reason: ri.value } };
              });
            }
          }
        }
      } else {
        for (const [sel, key] of MODAL_FIELDS[m.kind] || []) {
          const n = el(sel);
          if (!n) continue;
          n.value = m[key] ?? '';
          n.addEventListener('input', () => { m[key] = n.value; });
        }
        if (m.kind === 'review') {
          const ins = el('#mktRvInsufficient');
          if (ins) {
            ins.checked = m.insufficient === true;
            ins.addEventListener('input', () => { m.insufficient = ins.checked; });
          }
        }
        el('#mktObsSave')?.addEventListener('click', () => submitObservationModal());
        el('#mktRvSave')?.addEventListener('click', () => submitReviewModal());
        el('#mktMdSave')?.addEventListener('click', () => submitMetricModal());
      }
      el('#mktModalCancel')?.addEventListener('click', () => { state.modal = null; render(); });
      paintModalErrors();
    }
  }

  /* ================================================================
   * REQ-20260910-020 渠道与行动看板
   * ================================================================ */

  function boardData() {
    return state.board && state.board.initialized === true ? state.board : null;
  }
  function boardChannel(id) { return (boardData()?.channels || []).find((c) => c.id === id) || null; }
  function boardExperiment(id) { return (boardData()?.experiments || []).find((e) => e.id === id) || null; }
  function boardActivity(id) { return (boardData()?.activities || []).find((a) => a.id === id) || null; }

  function ensureBoard() {
    if (state.boardPhase === 'idle' || state.boardPhase === 'error') refreshBoard();
  }

  function sanitizeBoardRefs() {
    if (state.chanFilter && !boardChannel(state.chanFilter)) state.chanFilter = '';
    if (state.expFilter && !boardExperiment(state.expFilter)) state.expFilter = '';
    if (state.drawer) {
      const live = boardActivity(state.drawer.id);
      if (!live || live.corrupt) state.drawer = null;
      else if (!state.drawer.dirty) state.drawer.baseRevision = live.revision;
    }
    if (state.pendingDrawerId) {
      const live = boardActivity(state.pendingDrawerId);
      if (live && !state.drawer) {
        state.drawer = buildDrawerDraft(live);
        state.pendingDrawerId = null;
      } else if (!live) {
        state.pendingDrawerId = null;
      }
    }
  }

  async function refreshBoard() {
    state.boardPhase = 'loading';
    state.boardError = null;
    render();
    let r;
    try {
      r = await apiJson('/api/marketing/board');
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    if (r.ok && r.json && r.json.initialized === true) {
      state.board = r.json;
      state.boardPhase = 'ready';
      sanitizeBoardRefs();
    } else if (r.ok) {
      state.board = null;
      state.boardPhase = 'ready';
    } else {
      state.boardPhase = 'error';
      state.boardError = r.json?.error || `读取失败（${r.status}）`;
    }
    render();
  }

  function applyBoardResponse(payload) {
    if (payload && payload.board && payload.board.initialized === true) {
      state.board = payload.board;
      state.boardPhase = 'ready';
      sanitizeBoardRefs();
    }
  }

  /* ---------- 抽屉草稿 ---------- */

  function buildDrawerDraft(a) {
    return {
      id: a.id,
      baseRevision: a.revision,
      dirty: false,
      saving: false,
      fieldErrors: {},
      conflict: false,
      error: null,
      savedAt: null,
      draft: {
        channelId: a.channelId || '',
        experimentId: a.experimentId || '',
        title: a.title || '',
        contentDraft: a.contentDraft || '',
        materialRefs: a.materialRefs || '',
        plannedAt: a.plannedAt || '',
        timezone: a.timezone || '',
        owner: a.owner || '',
        nextStep: a.nextStep || '',
        publishUrl: a.publishUrl || '',
        publishedAt: a.publishedAt || '',
        publishCredential: a.publishCredential || '',
        reviewBasis: a.reviewBasis || '',
        decision: a.decision || '',
        stoppedReason: a.stoppedReason || '',
      },
    };
  }

  function openDrawer(id) {
    const a = boardActivity(id);
    if (!a || a.corrupt) return;
    state.drawer = buildDrawerDraft(a);
    state.modal = null;
    render();
    notifyState();
  }

  function closeDrawer() {
    state.drawer = null;
    render();
    notifyState();
  }

  function drawerMarkDirty() {
    if (state.drawer) state.drawer.dirty = true;
  }

  /* ---------- 保存 / 推进 / 更正 / 停止 ---------- */

  async function saveDrawerNow() {
    const d = state.drawer;
    if (!d || d.saving) return false;
    d.saving = true;
    d.error = null;
    render();
    let r;
    try {
      r = await apiJson('/api/marketing/activity/save', {
        id: d.id,
        revision: d.baseRevision,
        data: { ...d.draft },
      });
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    d.saving = false;
    if (r.ok && r.json?.activity) {
      applyBoardResponse(r.json);
      const live = boardActivity(d.id);
      if (live) d.baseRevision = live.revision;
      d.dirty = false;
      d.savedAt = new Date().toISOString();
      d.fieldErrors = {};
      d.conflict = false;
      showToast('行动已保存');
      render();
      return true;
    }
    if (r.status === 409) {
      d.conflict = true; // 本地草稿保留；「重新载入」更新基线后重试
      render();
      return false;
    }
    if (r.json?.fields) {
      d.fieldErrors = r.json.fields;
      render();
      return false;
    }
    d.error = r.json?.error || `保存失败（${r.status}）`;
    render();
    return false;
  }

  // 409 后显式「重新载入」：拉最新看板，本地草稿保留（不静默覆盖）
  async function drawerReload() {
    const d = state.drawer;
    if (!d) return;
    await refreshBoard();
    const live = d.id ? boardActivity(d.id) : null;
    if (live && state.drawer) {
      state.drawer.baseRevision = live.revision;
      state.drawer.conflict = false;
      state.drawer.fieldErrors = {};
      render();
    }
  }

  function drawerClientCheck(to) {
    const errs = {};
    const g = state.drawer?.draft || {};
    if (to === 'pending' && !String(g.contentDraft || '').trim()) {
      errs.contentDraft = '标记待发布前需要内容草稿';
    }
    if (to === 'published') {
      if (!String(g.publishedAt || '').trim()) errs.publishedAt = '请登记发布时间';
      if (!String(g.publishUrl || '').trim() && !String(g.publishCredential || '').trim()) {
        errs.publishUrl = '必须填写发布链接；无法提供公开链接时填写发布凭据说明';
      }
    }
    if (to === 'reviewed') {
      if (!String(g.reviewBasis || '').trim()) errs.reviewBasis = '复盘需记录结果依据';
      if (!g.decision) errs.decision = '请选择决策（数据不足可选「暂不能判断」）';
    }
    if (to === 'stopped' && !String(g.stoppedReason || '').trim()) {
      errs.stopReason = '停止需记录原因';
    }
    return errs;
  }

  // 推进请求只带目标状态需要的登记信息，不携带内容正文（文案不经状态接口发送）
  function advancePayload(to) {
    const g = state.drawer?.draft || {};
    if (to === 'published') {
      return { publishedAt: g.publishedAt, publishUrl: g.publishUrl, publishCredential: g.publishCredential };
    }
    if (to === 'reviewed') {
      return { reviewBasis: g.reviewBasis, decision: g.decision || null };
    }
    if (to === 'stopped') {
      return { stopReason: g.stoppedReason };
    }
    return {};
  }

  async function drawerTransition(to, endpoint = '/api/marketing/activity/status', extra = {}) {
    const d = state.drawer;
    if (!d || d.saving) return false;
    const errs = endpoint === '/api/marketing/activity/correct'
      ? (String(extra.reason || '').trim() ? {} : { reason: '更正需记录原因（误操作说明）' })
      : drawerClientCheck(to);
    if (Object.keys(errs).length) {
      d.fieldErrors = { ...d.fieldErrors, ...errs };
      render();
      focusBoardError(errs);
      return false;
    }
    d.saving = true;
    d.error = null;
    render();
    let r;
    try {
      r = await apiJson(endpoint, {
        id: d.id,
        revision: d.baseRevision,
        to,
        ...extra,
        ...(endpoint === '/api/marketing/activity/status' ? { payload: advancePayload(to) } : {}),
      });
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    d.saving = false;
    if (r.ok && r.json?.board) {
      applyBoardResponse(r.json);
      const live = boardActivity(d.id);
      if (live) d.baseRevision = live.revision;
      d.fieldErrors = {};
      d.conflict = false;
      showToast(endpoint === '/api/marketing/activity/correct' ? '已更正（原因已入操作历史）' : `已${to === 'stopped' ? '停止' : ACTIVITY_STATUS_LABEL[to] ? `标记为${ACTIVITY_STATUS_LABEL[to]}` : '更新'}`);
      render();
      notifyState();
      return true;
    }
    if (r.status === 409) {
      d.conflict = true;
      render();
      return false;
    }
    if (r.json?.fields) {
      d.fieldErrors = r.json.fields;
      render();
      focusBoardError(r.json.fields);
      return false;
    }
    d.error = r.json?.error || `操作失败（${r.status}）`;
    render();
    return false;
  }

  /* ---------- 复制文案（仅写剪贴板，不发送） ---------- */

  async function copyContentText() {
    const text = String(state.drawer?.draft?.contentDraft || '');
    if (!text.trim()) {
      showToast('没有可复制的内容草稿');
      return;
    }
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch { ok = false; }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild?.(ta);
        ta.select?.();
        ok = document.execCommand?.('copy') === true;
        ta.remove?.();
      } catch { ok = false; }
    }
    showToast(ok ? '文案已复制（仅写入剪贴板，不发送内容）' : '复制失败：浏览器未授权剪贴板');
  }

  /* ---------- 轻提示 ---------- */

  function showToast(msg) {
    state.toast = { msg };
    const view = viewEl();
    const n = view?.querySelector('#mktToast');
    if (n) {
      n.textContent = msg;
      n.classList.add('show');
      setTimeout(() => {
        const v2 = viewEl();
        const n2 = v2?.querySelector('#mktToast');
        if (n2 && state.toast?.msg === msg) {
          n2.textContent = '';
          n2.classList.remove('show');
        }
      }, 2600);
    }
  }

  /* ---------- 看板渲染 ---------- */

  function isOverdue(a) {
    if (a.status !== 'draft' && a.status !== 'pending') return false;
    if (!a.plannedAt) return false;
    const t = new Date(a.plannedAt);
    return !Number.isNaN(t.getTime()) && t.getTime() < Date.now();
  }

  function cardHeadline(a) {
    return a.title || String(a.contentDraft || '').split(/\r?\n/).find((l) => l.trim()) || '未命名内容';
  }

  function expChipLine(e) {
    const parts = [];
    if (e.primaryMetric) parts.push(e.primaryMetric);
    if (e.budgetPlanned != null) parts.push(`预算 ${e.currency || '?'} ${e.budgetPlanned}${e.budgetActual != null ? ` / 支出 ${e.currency || '?'} ${e.budgetActual}` : ''}`);
    if (e.pricingVersion) parts.push(e.pricingVersion);
    if (e.decision) parts.push(`决策：${ACTIVITY_DECISION_LABEL[e.decision] || e.decision}`);
    return parts.join(' · ');
  }

  function channelsPaneHtml() {
    if (state.boardPhase === 'loading') {
      return '<div class="mkt-phase"><p class="muted">正在加载渠道与行动…</p></div>';
    }
    if (state.boardPhase === 'error') {
      return `
        <div class="mkt-phase">
          <div class="notice err">渠道与行动读取失败：${esc(state.boardError || '未知错误')}</div>
          <button type="button" class="btn" id="mktBoardRetry">重试</button>
        </div>`;
    }
    const b = boardData();
    if (!b || !(b.channels || []).length) {
      return `
        ${aiButtonsHtml([['channels', '制定渠道计划'], ['content', '生成内容']])}
        <div class="mkt-phase">
          <div class="empty-card">
            <h2>尚未建立渠道</h2>
            <p>渠道是长期触点：平台、账号链接、目标受众、市场语言、内容形式与每周投入。渠道建议是待验证假设，不必预设所有项目适合同一平台——先新建渠道（可编辑空模板），再创建实验与行动。</p>
            <div class="row-gap">
              <button type="button" class="btn primary" id="mktAddChannel">＋ 新建渠道</button>
              <button type="button" class="btn" id="mktAddExperiment">＋ 新建实验</button>
            </div>
          </div>
        </div>`;
    }
    const filtered = filteredActivities();
    const noMatch = (b.channels || []).length > 0 && filtered.length === 0 && (state.chanFilter || state.expFilter || state.narrowStatus);
    return `
      ${aiButtonsHtml([['channels', '制定渠道计划'], ['content', '生成内容']])}
      ${boardToolbarHtml()}
      ${experimentStripHtml()}
      ${noMatch
        ? `<div class="mkt-phase"><p class="muted">没有符合当前筛选的行动。</p><button type="button" class="btn small" id="mktClearFilters">清除筛选</button></div>`
        : boardColumnsHtml()}
      ${state.drawer ? drawerHtml(state.drawer) : ''}
      ${state.tab === 'channels' && state.modal ? modalHtml(state.modal) : ''}
      ${state.tab === 'channels' ? '<div id="mktToast" class="mkt-toast" role="status" aria-live="polite"></div>' : ''}`;
  }

  function boardToolbarHtml() {
    const b = boardData();
    const chOpts = `<option value="">全部渠道</option>${(b.channels || []).map((c) => `<option value="${esc(c.id)}"${state.chanFilter === c.id ? ' selected' : ''}>${esc(c.platform || c.id)}${c.corrupt ? '（损坏）' : ''}</option>`).join('')}`;
    const expOpts = `<option value="">全部实验</option>${(b.experiments || []).filter((e) => !state.chanFilter || e.channelId === state.chanFilter).map((e) => `<option value="${esc(e.id)}"${state.expFilter === e.id ? ' selected' : ''}>${esc((e.hypothesis || '').slice(0, 18) || e.id)}</option>`).join('')}`;
    const hasFilter = !!(state.chanFilter || state.expFilter);
    return `
      <div class="mkt-toolbar">
        <label class="mkt-filter">渠道筛选<select id="mktChanFilter">${chOpts}</select></label>
        <label class="mkt-filter">实验筛选<select id="mktExpFilter">${expOpts}</select></label>
        ${state.chanFilter ? '<button type="button" class="btn small quiet" id="mktEditChannel" title="编辑所选渠道档案">编辑渠道</button>' : ''}
        <span class="mkt-toolbar-spacer"></span>
        ${hasFilter ? '<button type="button" class="btn small quiet" id="mktClearFilters">清除筛选</button>' : ''}
        <button type="button" class="btn small" id="mktAddChannel">＋ 渠道</button>
        <button type="button" class="btn small" id="mktAddExperiment">＋ 实验</button>
        <button type="button" class="btn small primary" id="mktAddActivity">＋ 行动</button>
      </div>`;
  }

  function experimentStripHtml() {
    const b = boardData();
    const exps = (b.experiments || []).filter((e) => !state.chanFilter || e.channelId === state.chanFilter);
    if (!exps.length) return '';
    const chips = exps.map((e) => {
      const actCount = (b.activities || []).filter((a) => a.experimentId === e.id).length;
      const sel = state.expFilter === e.id;
      return `
        <div class="mkt-exp-chip${sel ? ' picked' : ''}${e.corrupt ? ' corrupt' : ''}">
          <button type="button" class="mkt-exp-main" id="mktExpChip-${esc(e.id)}" title="点击按该实验筛选行动">
            <span class="mkt-exp-h">${esc(e.corrupt ? `${e.id}（文件损坏）` : (e.hypothesis || '未填写假设'))}</span>
            <span class="mkt-exp-meta">${esc(expChipLine(e))}${actCount ? ` · ${actCount} 条行动` : ''}</span>
          </button>
          ${e.corrupt ? '' : `
          <button type="button" class="btn small quiet" id="mktExpEdit-${esc(e.id)}" title="编辑实验">编辑</button>
          <button type="button" class="btn small quiet" id="mktExpCopy-${esc(e.id)}" title="复制为新实验（新 ID、保留来源、行动置为草稿）">复制为新实验</button>`}
        </div>`;
    }).join('');
    return `<div class="mkt-exp-strip" aria-label="实验">${chips}</div>`;
  }

  function filteredActivities() {
    const b = boardData();
    return (b.activities || []).filter((a) => a.corrupt !== true)
      .filter((a) => !state.chanFilter || a.channelId === state.chanFilter)
      .filter((a) => !state.expFilter || a.experimentId === state.expFilter);
  }

  function activityCardHtml(a) {
    const ch = boardChannel(a.channelId);
    const exp = a.experimentId ? boardExperiment(a.experimentId) : null;
    const overdue = isOverdue(a);
    return `
      <button type="button" class="mkt-act-card" id="mktCard-${esc(a.id)}" data-act="${esc(a.id)}">
        <span class="mkt-act-title">${esc(cardHeadline(a))}</span>
        <span class="mkt-act-meta">${esc(ch?.platform || a.channelId || '未知渠道')}</span>
        ${a.plannedAt ? `<span class="mkt-act-meta">${esc(a.plannedAt)}${a.timezone ? `（${esc(a.timezone)}）` : ''}</span>` : ''}
        ${exp?.primaryMetric ? `<span class="mkt-act-chip">${esc(exp.primaryMetric)}</span>` : ''}
        ${a.owner ? `<span class="mkt-act-meta">${esc(a.owner)}</span>` : ''}
        ${overdue ? '<span class="mkt-overdue">逾期</span>' : ''}
      </button>`;
  }

  function boardColumnsHtml() {
    const acts = filteredActivities();
    const cols = ACTIVITY_COLS.map(([key, label]) => {
      const list = acts.filter((a) => a.status === key);
      const narrowHide = state.narrowStatus && key !== state.narrowStatus ? ' narrow-hidden' : '';
      return `
        <div class="mkt-col${narrowHide}" data-status="${key}">
          <div class="mkt-col-head"><span>${esc(label)}</span><span class="mkt-col-count">${list.length}</span></div>
          <div class="mkt-col-body">${list.map(activityCardHtml).join('') || '<p class="muted small">—</p>'}</div>
        </div>`;
    }).join('');
    return `
      <div class="mkt-narrow-filter">
        <label class="mkt-filter">状态筛选<select id="mktNarrowStatus"><option value="">全部状态</option>${ACTIVITY_COLS.map(([k, l]) => `<option value="${esc(k)}"${state.narrowStatus === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      </div>
      <div class="mkt-board" aria-label="行动状态列">${cols}</div>`;
  }

  /* ---------- 详情抽屉（基本信息 / 内容素材 / 结果与关联） ---------- */

  function bFieldErr(field) {
    return `<p class="field-err" data-err-for="${esc(field)}" role="alert"></p>`;
  }

  function drawerStatusActionsHtml(a, d) {
    const next = ACTIVITY_NEXT[a.status];
    const nextLabel = next ? ACTIVITY_STATUS_LABEL[next] : '';
    const btn = (id, label, title = '') => `<button type="button" class="btn small primary" id="${id}"${d.saving ? ' disabled' : ''} title="${esc(title)}">${esc(label)}</button>`;
    let html = '';
    if (next) {
      if (next === 'pending') {
        html += btn('mktAdvance', '标记待发布', '需要内容草稿；未发布前不发送内容');
      } else if (next === 'published') {
        html += `
          <div class="mkt-drawer-sub">人工登记发布结果（登记后才展示已发布；无法提供公开链接时填凭据说明）</div>
          <label class="field">发布时间<input id="mktPubAt" type="datetime-local" placeholder="YYYY-MM-DDTHH:mm"></label>
          ${bFieldErr('publishedAt')}
          <label class="field">发布链接<input id="mktPubUrl" placeholder="https://…"></label>
          ${bFieldErr('publishUrl')}
          <label class="field">发布凭据说明（无公开链接时必填）<input id="mktPubCredential" placeholder="如：社群内发帖截图存档位置"></label>
          ${btn('mktAdvance', '登记发布结果并标记已发布')}`;
      } else if (next === 'observing') {
        html += btn('mktAdvance', '进入观察');
      } else if (next === 'reviewed') {
        html += `
          <div class="mkt-drawer-sub">复盘（数据不足可选「暂不能判断」，不等同验证成功）</div>
          <label class="field">结果依据（数据来源与口径）<textarea id="mktReviewBasis" rows="2" placeholder="例：两周内落地页访问 62 次（口径：仅本链接 UTM）"></textarea></label>
          ${bFieldErr('reviewBasis')}
          <label class="field">决策
            <select id="mktReviewDecision"><option value="">— 请选择 —</option>${ACTIVITY_DECISIONS.map(([k, l]) => `<option value="${esc(k)}"${d.draft.decision === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
          </label>
          ${bFieldErr('decision')}
          ${btn('mktAdvance', '完成复盘')}`;
      }
    }
    if (a.status !== 'reviewed' && a.status !== 'stopped') {
      html += `
        <div class="mkt-drawer-sub">停止（未复盘状态可停止，记录原因）</div>
        <label class="field">停止原因<input id="mktStopReason" placeholder="为什么停止这条行动"></label>
        ${bFieldErr('stopReason')}
        <button type="button" class="btn small quiet" id="mktStopBtn"${d.saving ? ' disabled' : ''}>停止</button>`;
    }
    if (a.status === 'reviewed' || a.status === 'stopped') {
      const summary = a.status === 'reviewed'
        ? `复盘结论：${esc(a.reviewBasis || '—')} · 决策：${esc(ACTIVITY_DECISION_LABEL[a.decision] || '—')}`
        : `停止原因：${esc(a.stoppedReason || '—')}`;
      html += `<p class="muted small">${summary}</p>${btn('mktCopyExp', '复制为新实验', '新实验新 ID、保留来源；行动复制为草稿')}`;
    }
    if (a.status !== 'draft') {
      const back = ACTIVITY_COLS.map(([k, l]) => [k, l]).filter(([k]) => k !== a.status);
      html += `
        <div class="mkt-drawer-sub">更正（误操作回退，记录原因与历史）</div>
        <div class="mkt-correct-row">
          <select id="mktCorrectTo">${back.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('')}</select>
          <input id="mktCorrectReason" placeholder="误操作说明（必填）">
          <button type="button" class="btn small quiet" id="mktCorrectBtn"${d.saving ? ' disabled' : ''}>更正</button>
        </div>
        ${bFieldErr('reason')}`;
    }
    return html;
  }

  function drawerHtml(d) {
    const a = boardActivity(d.id);
    if (!a) return '';
    const b = boardData();
    const chOpts = `<option value="">— 选择渠道 —</option>${(b.channels || []).map((c) => `<option value="${esc(c.id)}"${d.draft.channelId === c.id ? ' selected' : ''}>${esc(c.platform || c.id)}</option>`).join('')}`;
    const expOpts = `<option value="">（不关联实验）</option>${(b.experiments || []).map((e) => `<option value="${esc(e.id)}"${d.draft.experimentId === e.id ? ' selected' : ''}>${esc((e.hypothesis || '').slice(0, 18) || e.id)}</option>`).join('')}`;
    const hist = (a.statusHistory || []).slice(-8).reverse().map((h) => `
      <li><span class="muted small">${esc(fmtTime(h.at))}</span> ${h.from ? `${esc(ACTIVITY_STATUS_LABEL[h.from] || h.from)}→` : ''}${esc(ACTIVITY_STATUS_LABEL[h.to] || h.to)}${h.type === 'correct' ? '（更正）' : ''}${h.note ? `<span class="muted small">：${esc(h.note)}</span>` : ''}</li>`).join('');
    const reqRows = (a.linkedReqs || []).map((l) => l.id
      ? `<li><button type="button" class="btn small quiet mkt-req-link" id="mktReqLink-${esc(l.id)}" title="跳转到需求详情">${esc(l.id)}</button><span class="muted small">${esc(l.title)}</span></li>`
      : `<li><span class="muted">${esc(l.title)}（创建中 / 上次失败，重试同一 key）</span></li>`).join('');
    return `
      <div class="mkt-drawer-wrap">
        <aside class="mkt-drawer" id="mktDrawer" aria-label="行动详情">
          <header class="mkt-drawer-head">
            <h4>行动详情 <span class="mkt-status-chip" data-status="${esc(a.status)}">${esc(ACTIVITY_STATUS_LABEL[a.status] || a.status)}</span>${isOverdue(a) ? '<span class="mkt-overdue">逾期</span>' : ''}</h4>
            <button type="button" class="btn small quiet" id="mktDrawerClose">关闭</button>
          </header>
          <div class="mkt-drawer-body">
            <section class="mkt-drawer-sec" aria-label="基本信息">
              <h5>基本信息</h5>
              <label class="field">渠道<select id="mktDrawerChannel">${chOpts}</select></label>
              ${bFieldErr('channelId')}
              <label class="field">实验（一条实验可有多条行动）<select id="mktDrawerExp">${expOpts}</select></label>
              ${bFieldErr('experimentId')}
              <div class="mkt-num-row">
                <label class="field">计划时间<input id="mktPlannedAt" type="datetime-local"></label>
                <label class="field">时区<input id="mktTimezone" placeholder="Asia/Shanghai"></label>
              </div>
              ${bFieldErr('plannedAt')}${bFieldErr('timezone')}
              <label class="field">负责人<input id="mktOwner" placeholder="谁负责这篇内容"></label>
              ${bFieldErr('owner')}
              ${hist ? `<details class="mkt-hist"><summary>操作历史（${(a.statusHistory || []).length}）</summary><ul>${hist}</ul></details>` : ''}
            </section>
            <section class="mkt-drawer-sec" aria-label="内容素材">
              <h5>内容素材</h5>
              <label class="field">标题 / 主题<input id="mktTitle" placeholder="如：演示视频"></label>
              ${bFieldErr('title')}
              <label class="field">内容草稿<textarea id="mktContent" rows="5" placeholder="内容草稿；复制文案仅写入剪贴板，不发送"></textarea></label>
              ${bFieldErr('contentDraft')}
              <label class="field">素材引用<textarea id="mktMaterial" rows="2" placeholder="素材位置或引用（如 demo.mp4）"></textarea></label>
              ${bFieldErr('materialRefs')}
              <button type="button" class="btn small" id="mktCopyText">复制文案</button>
            </section>
            <section class="mkt-drawer-sec" aria-label="结果与关联">
              <h5>结果与关联</h5>
              ${drawerStatusActionsHtml(a, d)}
              ${d.conflict ? `<p class="notice err">检测到并发修改：点「重新载入」更新基线（本地草稿已保留），再操作。</p><button type="button" class="btn small" id="mktDrawerReload">重新载入</button>` : ''}
              ${d.error ? `<p class="notice err">${esc(d.error)}</p>` : ''}
              <label class="field">下一步<input id="mktNextStep" placeholder="发布后要做什么"></label>
              <div class="mkt-drawer-sub">关联开发需求（人工创建，进入 submitted；不自动接受或实施）</div>
              ${reqRows ? `<ul class="mkt-req-list">${reqRows}</ul>` : '<p class="muted small">尚无关联需求。</p>'}
              <button type="button" class="btn small" id="mktCreateReq">创建开发需求</button>
            </section>
          </div>
          <footer class="mkt-save-foot">
            <button type="button" class="btn primary" id="mktDrawerSave"${d.saving ? ' disabled' : ''}>${d.saving ? '保存中…' : '保存'}</button>
            ${d.dirty ? '<button type="button" class="btn small quiet" id="mktDrawerDiscard">放弃修改</button>' : ''}
            <span class="muted small" id="mktDrawerState" role="status" aria-live="polite">${d.savedAt ? `已保存 · ${esc(fmtTime(d.savedAt))}` : (d.dirty ? '有未保存的修改' : '')}</span>
          </footer>
        </aside>
      </div>`;
  }

  /* ---------- 弹窗（渠道 / 实验 / 行动 / 开发需求） ---------- */

  function modalShell(title, inner, foot) {
    return `
      <div class="mkt-modal-wrap" id="mktModalWrap">
        <div class="mkt-modal" role="dialog" aria-label="${esc(title)}">
          <header class="mkt-drawer-head"><h4>${esc(title)}</h4><button type="button" class="btn small quiet" id="mktModalCancel">取消</button></header>
          <div class="mkt-modal-body">${inner}</div>
          <footer class="mkt-save-foot">${foot}</footer>
        </div>
      </div>`;
  }

  function mErr(field) {
    return `<p class="field-err" data-err-for="m.${esc(field)}" role="alert"></p>`;
  }

  function modalHtml(m) {
    if (m.kind === 'import') return importModalHtml(m);
    const errBox = m.error ? `<p class="notice err">${esc(m.error)}</p>` : '';
    const saveBtn = (id, label) => `<button type="button" class="btn primary" id="${id}"${m.saving ? ' disabled' : ''}>${m.saving ? '提交中…' : label}</button>`;
    if (m.kind === 'observation') {
      const e = effectData();
      const metOpts = `<option value="">— 选择指标 —</option>${(e?.definitions || []).map((d) => `<option value="${esc(d.key)}"${m.metricKey === d.key ? ' selected' : ''}>${esc(d.name)}${d.money ? '（需币种）' : ''}</option>`).join('')}`;
      const chOpts = `<option value="">（无渠道归属）</option>${(e?.channels || []).map((c) => `<option value="${esc(c.id)}"${m.channelId === c.id ? ' selected' : ''}>${esc(c.platform || c.id)}</option>`).join('')}`;
      const expOpts = `<option value="">（无实验归属）</option>${(e?.experiments || []).map((x) => `<option value="${esc(x.id)}"${m.experimentId === x.id ? ' selected' : ''}>${esc(String(x.hypothesis || x.id).slice(0, 18))}</option>`).join('')}`;
      return modalShell('录入指标观察', `
        <p class="muted small">空值 = 未知，0 = 真实零；同周期同归属同指标为同一观察——数值变化走修订（需理由），不重复累计。</p>
        <label class="field">指标（必填）<select id="mktObsMetric">${metOpts}</select></label>
        ${mErr('metricKey')}
        <div class="mkt-num-row">
          <label class="field">值（空 = 未知）<input id="mktObsValue" type="number" min="0" step="any" placeholder="未知留空，真实零填 0"></label>
          <label class="field">单位 / 币种<input id="mktObsUnit" placeholder="金额类必填，如 CNY"></label>
        </div>
        ${mErr('value')}${mErr('unit')}
        <div class="mkt-num-row">
          <label class="field">开始日期<input id="mktObsStart" type="date"></label>
          <label class="field">结束日期<input id="mktObsEnd" type="date"></label>
        </div>
        ${mErr('dateStart')}${mErr('dateEnd')}
        <div class="mkt-num-row">
          <label class="field">渠道归属<select id="mktObsChannel">${chOpts}</select></label>
          <label class="field">实验归属<select id="mktObsExp">${expOpts}</select></label>
        </div>
        <div class="mkt-num-row">
          <label class="field">来源<input id="mktObsSource" placeholder="默认 手工记录"></label>
          <label class="field">时区<input id="mktObsTz" placeholder="如 UTC+8 / Asia/Shanghai"></label>
        </div>
        <label class="field">修改理由（修订已有数值时必填）<textarea id="mktObsReason" rows="2" placeholder="为什么修改这一数值（入修订历史，可追溯）"></textarea></label>
        ${mErr('reason')}
        ${errBox}`, saveBtn('mktObsSave', '保存观察'));
    }
    if (m.kind === 'review') {
      const e = effectData();
      const expOpts = `<option value="">（不关联实验）</option>${(e?.experiments || []).map((x) => `<option value="${esc(x.id)}"${m.experimentId === x.id ? ' selected' : ''}>${esc(String(x.hypothesis || x.id).slice(0, 18))}</option>`).join('')}`;
      return modalShell('新建复盘', `
        <p class="muted small">保存时固定观察快照（值与修订号），后续数据修订不改变本次复盘依据；无数据可保存「数据不足」。</p>
        <label class="field">关联实验（保存后复盘归属该实验）<select id="mktRvExp">${expOpts}</select></label>
        ${mErr('experimentId')}
        <div class="mkt-num-row">
          <label class="field">观察开始<input id="mktRvStart" type="date"></label>
          <label class="field">观察结束<input id="mktRvEnd" type="date"></label>
        </div>
        ${mErr('periodStart')}${mErr('periodEnd')}${mErr('insufficient')}
        <div class="mkt-num-row">
          <label class="field">目标<input id="mktRvTarget" placeholder="例：订阅新增 ≥ 5 人"></label>
          <label class="field">实际<input id="mktRvActual" placeholder="例：4 人"></label>
        </div>
        ${mErr('target')}${mErr('actual')}
        <label class="field">依据说明<textarea id="mktRvBasis" rows="2" placeholder="数据来源与口径说明（观察快照自动附带）"></textarea></label>
        <label class="field">结论（必填）<textarea id="mktRvConclusion" rows="2" placeholder="观察期结论"></textarea></label>
        ${mErr('conclusion')}
        <label class="field">下一步<input id="mktRvNext" placeholder="基于结论的下一步行动"></label>
        <label class="mkt-check"><input type="checkbox" id="mktRvInsufficient"${m.insufficient ? ' checked' : ''}> 数据不足（不伪造目标 / 实际与改善幅度）</label>
        ${errBox}`, saveBtn('mktRvSave', '保存复盘'));
    }
    if (m.kind === 'metric') {
      return modalShell('自定义指标', `
        <p class="muted small">指标 key 与名称唯一（观察键依赖）；口径随定义保存，聚合规则按 种类 区分。</p>
        <label class="field">名称（必填，唯一）<input id="mktMdName" placeholder="如：邮件打开"></label>
        ${mErr('name')}
        <label class="field">key（可空自动分配）<input id="mktMdKey" placeholder="如 emailOpens"></label>
        ${mErr('key')}
        <div class="mkt-num-row">
          <label class="field">分类<select id="mktMdCategory">${METRIC_CATEGORIES.map(([k, l]) => `<option value="${esc(k)}"${m.category === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          <label class="field">种类<select id="mktMdKind">${METRIC_KINDS.map(([k, l]) => `<option value="${esc(k)}"${m.kind === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          <label class="field">单位 / 币种<input id="mktMdUnit" placeholder="如 次 / 人 / CNY"></label>
        </div>
        ${mErr('unit')}
        <label class="field">去重口径<input id="mktMdDedup" placeholder="如 按账号去重"></label>
        ${errBox}`, saveBtn('mktMdSave', '保存指标'));
    }
    if (m.kind === 'channel') {
      return modalShell(m.editId ? '编辑渠道' : '新建渠道（可编辑空模板）', `
        <label class="field">平台（必填）<input id="mktChPlatform" placeholder="如 X / Reddit / 邮件列表"></label>
        ${mErr('platform')}
        <label class="field">账号 / 社区链接<input id="mktChLink" placeholder="https://…"></label>
        <label class="field">目标受众<input id="mktChAudience" placeholder="谁在这个渠道"></label>
        <label class="field">市场语言<input id="mktChLanguages" placeholder="如 中文 / 英文"></label>
        <label class="field">内容形式<input id="mktChFormats" placeholder="如 短帖 / 长文 / 视频"></label>
        <label class="field">优先级<select id="mktChPriority">${CHANNEL_PRIORITIES.map(([k, l]) => `<option value="${esc(k)}"${m.priority === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="field">选择理由（待验证假设）<textarea id="mktChReason" rows="2" placeholder="为什么选这个渠道"></textarea></label>
        <div class="mkt-num-row">
          <label class="field">每周投入（小时，可空）<input id="mktChEffort" type="number" min="0" step="any" placeholder="未知留空"></label>
        </div>
        <label class="field">获取数据方式<input id="mktChDataAccess" placeholder="如 后台分析 / 手工记录"></label>
        <label class="field">可用能力<textarea id="mktChCapabilities" rows="2" placeholder="可发帖 / 可评论 / 可私信…"></textarea>
        </label>
        ${errBox}`, saveBtn('mktChSave', '保存渠道'));
    }
    if (m.kind === 'experiment') {
      const b = boardData();
      const chOpts = `<option value="">（不绑定渠道）</option>${(b?.channels || []).map((c) => `<option value="${esc(c.id)}"${m.channelId === c.id ? ' selected' : ''}>${esc(c.platform || c.id)}</option>`).join('')}`;
      const vOpts = `<option value="">（不绑定定价）</option>${(state.data?.versions || []).map((v) => `<option value="${esc(v.version)}"${m.pricingVersion === v.version ? ' selected' : ''}>${esc(v.version)}${v.corrupt ? '（损坏）' : ''}</option>`).join('')}`;
      return modalShell(m.editId ? '编辑实验' : '新建实验', `
        <label class="field">渠道${chOpts ? `<select id="mktExpChannel">${chOpts}</select>` : ''}</label>
        ${mErr('channelId')}
        <label class="field">假设（必填，待验证）<textarea id="mktExpHypothesis" rows="2" placeholder="如：日更短帖 2 周带来 50 次产品页访问"></textarea></label>
        ${mErr('hypothesis')}
        <label class="field">主指标<input id="mktExpMetric" placeholder="例：产品页访问数"></label>
        <div class="mkt-num-row">
          <label class="field">观察开始<input id="mktExpStart" type="date"></label>
          <label class="field">观察结束<input id="mktExpEnd" type="date"></label>
        </div>
        <label class="field">成功标准<textarea id="mktExpSuccess" rows="2" placeholder="达到什么算验证成功"></textarea></label>
        <div class="mkt-num-row">
          <label class="field">币种<input id="mktExpCurrency" placeholder="如 CNY / USD"></label>
          <label class="field">预算（可空 = 未知；0 = 零预算）<input id="mktExpBudgetPlanned" type="number" min="0" step="any" placeholder="未知留空"></label>
          <label class="field">实际支出<input id="mktExpBudgetActual" type="number" min="0" step="any" placeholder="未知留空"></label>
        </div>
        ${mErr('currency')}
        <div class="mkt-num-row">
          <label class="field">预计工时<input id="mktExpHoursPlanned" type="number" min="0" step="any" placeholder="未知留空"></label>
          <label class="field">实际工时<input id="mktExpHoursActual" type="number" min="0" step="any" placeholder="未知留空"></label>
          <label class="field">绑定定价版本<select id="mktExpPricing">${vOpts}</select></label>
        </div>
        ${mErr('pricingVersion')}
        ${m.editId ? `
          <label class="field">最终决策<select id="mktExpDecision"><option value="">（未决策）</option>${ACTIVITY_DECISIONS.map(([k, l]) => `<option value="${esc(k)}"${m.decision === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          ${mErr('decision')}
          <label class="field">决策依据<textarea id="mktExpDecisionBasis" rows="2" placeholder="记录决策时必填"></textarea></label>
          ${mErr('decisionBasis')}` : ''}
        ${errBox}`, saveBtn('mktExpSave', '保存实验'));
    }
    if (m.kind === 'activity') {
      const b = boardData();
      const chOpts = `<option value="">— 选择渠道（必填）—</option>${(b?.channels || []).map((c) => `<option value="${esc(c.id)}"${m.channelId === c.id ? ' selected' : ''}>${esc(c.platform || c.id)}</option>`).join('')}`;
      const expOpts = `<option value="">（不关联实验）</option>${(b?.experiments || []).filter((e) => !m.channelId || e.channelId === m.channelId).map((e) => `<option value="${esc(e.id)}"${m.experimentId === e.id ? ' selected' : ''}>${esc((e.hypothesis || '').slice(0, 18) || e.id)}</option>`).join('')}`;
      return modalShell('新建行动', `
        <label class="field">标题 / 主题<input id="mktActTitle" placeholder="如：演示视频"></label>
        <label class="field">渠道（必填）<select id="mktActChannel">${chOpts}</select></label>
        ${mErr('channelId')}
        <label class="field">实验<select id="mktActExperiment">${expOpts}</select></label>
        <div class="mkt-num-row">
          <label class="field">计划时间<input id="mktActPlannedAt" type="datetime-local"></label>
          <label class="field">时区<input id="mktActTimezone" placeholder="Asia/Shanghai"></label>
        </div>
        ${mErr('timezone')}
        <label class="field">负责人<input id="mktActOwner" placeholder="谁负责"></label>
        <p class="muted small">创建后为草稿；内容草稿在详情抽屉填写。</p>
        ${errBox}`, saveBtn('mktActSave', '创建行动'));
    }
    // kind === 'req'
    return modalShell('创建开发需求（进入 submitted，不自动接受或实施）', `
      <label class="field">标题（必填）<input id="mktReqTitle" placeholder="如：落地页埋点"></label>
      ${mErr('title')}
      <label class="field">描述<textarea id="mktReqDesc" rows="3" placeholder="要做什么、验收口径"></textarea></label>
      <p class="muted small">创建后在需求模块出现（submitted）；行动与需求双向关联，重试不重复创建。</p>
      ${errBox}`, saveBtn('mktReqSubmit', '创建需求'));
  }

  function blankChannelModal() {
    return {
      kind: 'channel', editId: null, baseRevision: 1,
      platform: '', link: '', audience: '', languages: '', formats: '',
      priority: 'medium', reason: '', weeklyEffort: '', dataAccess: '', capabilities: '',
      fieldErrors: {}, error: null, saving: false,
    };
  }

  function blankExperimentModal() {
    return {
      kind: 'experiment', editId: null, baseRevision: 1,
      channelId: '', hypothesis: '', primaryMetric: '', observationStart: '', observationEnd: '',
      successCriteria: '', currency: '', budgetPlanned: '', budgetActual: '',
      hoursPlanned: '', hoursActual: '', pricingVersion: '', decision: '', decisionBasis: '',
      fieldErrors: {}, error: null, saving: false,
    };
  }

  function blankActivityModal() {
    return {
      kind: 'activity',
      title: '', channelId: state.chanFilter || '', experimentId: state.expFilter || '',
      plannedAt: '', timezone: '', owner: '',
      fieldErrors: {}, error: null, saving: false,
    };
  }

  function openReqModal() {
    state.modal = {
      kind: 'req',
      key: `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, // 幂等 key：同弹窗重试复用
      title: '', description: '',
      fieldErrors: {}, error: null, saving: false,
    };
    render();
  }

  /* ---------- 弹窗提交 ---------- */

  async function submitChannelModal() {
    const m = state.modal;
    if (!m || m.saving) return;
    m.saving = true;
    m.error = null;
    render();
    const data = {
      platform: m.platform, link: m.link, audience: m.audience, languages: m.languages,
      formats: m.formats, priority: m.priority, reason: m.reason,
      weeklyEffort: m.weeklyEffort === '' ? null : Number(m.weeklyEffort),
      dataAccess: m.dataAccess, capabilities: m.capabilities,
    };
    let r;
    try {
      r = m.editId
        ? await apiJson('/api/marketing/channel/save', { id: m.editId, revision: m.baseRevision, data })
        : await apiJson('/api/marketing/channel', { data });
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    if (state.modal === m) m.saving = false;
    if (r.ok && r.json?.channel) {
      applyBoardResponse(r.json);
      state.modal = null;
      showToast('渠道已保存');
      render();
      notifyState();
      return;
    }
    handleModalFail(m, r);
  }

  async function submitExperimentModal() {
    const m = state.modal;
    if (!m || m.saving) return;
    m.saving = true;
    m.error = null;
    render();
    const data = {
      channelId: m.channelId || null,
      hypothesis: m.hypothesis, primaryMetric: m.primaryMetric,
      observationStart: m.observationStart || null, observationEnd: m.observationEnd || null,
      successCriteria: m.successCriteria, currency: m.currency,
      budgetPlanned: m.budgetPlanned === '' ? null : Number(m.budgetPlanned),
      budgetActual: m.budgetActual === '' ? null : Number(m.budgetActual),
      hoursPlanned: m.hoursPlanned === '' ? null : Number(m.hoursPlanned),
      hoursActual: m.hoursActual === '' ? null : Number(m.hoursActual),
      pricingVersion: m.pricingVersion || null,
      decision: m.decision || null,
      decisionBasis: m.decisionBasis,
    };
    let r;
    try {
      r = m.editId
        ? await apiJson('/api/marketing/experiment/save', { id: m.editId, revision: m.baseRevision, data })
        : await apiJson('/api/marketing/experiment', { data });
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    if (state.modal === m) m.saving = false;
    if (r.ok && r.json?.experiment) {
      applyBoardResponse(r.json);
      state.modal = null;
      showToast('实验已保存');
      render();
      notifyState();
      return;
    }
    handleModalFail(m, r);
  }

  async function submitActivityModal() {
    const m = state.modal;
    if (!m || m.saving) return;
    if (!m.channelId) {
      m.fieldErrors = { ...m.fieldErrors, channelId: '请选择渠道' };
      render();
      return;
    }
    if (m.plannedAt && !String(m.timezone || '').trim()) {
      m.fieldErrors = { ...m.fieldErrors, timezone: '填写计划时间时必须指定时区' };
      render();
      return;
    }
    m.saving = true;
    m.error = null;
    render();
    const data = {
      channelId: m.channelId, experimentId: m.experimentId || null, title: m.title,
      plannedAt: m.plannedAt || '', timezone: m.timezone || '', owner: m.owner,
    };
    let r;
    try {
      r = await apiJson('/api/marketing/activity', { data });
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    if (state.modal === m) m.saving = false;
    if (r.ok && r.json?.activity) {
      applyBoardResponse(r.json);
      const id = r.json.activity.id;
      state.modal = null;
      state.drawer = buildDrawerDraft(r.json.activity); // 创建后直接打开详情抽屉
      showToast('行动已创建（草稿）');
      render();
      notifyState();
      return;
    }
    handleModalFail(m, r);
  }

  async function submitReqModal() {
    const m = state.modal;
    const d = state.drawer;
    if (!m || !d || m.saving) return;
    if (!String(m.title || '').trim()) {
      m.fieldErrors = { ...m.fieldErrors, title: '开发需求标题不能为空' };
      render();
      return;
    }
    m.saving = true;
    m.error = null;
    render();
    let r;
    try {
      r = await apiJson('/api/marketing/activity/req', {
        id: d.id, key: m.key, title: m.title, description: m.description,
      });
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    if (state.modal === m) m.saving = false;
    if (r.ok && r.json?.link?.id) {
      // 就地合并关联（响应 board 缺该条时也可展示）
      const live = boardActivity(d.id);
      if (live) {
        live.linkedReqs = [...(live.linkedReqs || []).filter((l) => l.key !== r.json.link.key), r.json.link];
      }
      applyBoardResponse(r.json);
      const live2 = boardActivity(d.id);
      if (live2 && !(live2.linkedReqs || []).some((l) => l.id === r.json.link.id)) {
        live2.linkedReqs = [...(live2.linkedReqs || []), r.json.link];
      }
      state.modal = null;
      showToast(r.json.created === false ? '已存在同 key 关联需求（未重复创建）' : `已创建 ${r.json.link.id}（submitted）`);
      render();
      notifyState();
      return;
    }
    handleModalFail(m, r); // 失败保留填写内容与 key，可重试
  }

  function handleModalFail(m, r) {
    if (r.status === 409) {
      m.error = `检测到并发修改（服务端 revision ${r.json?.currentRevision ?? '?'}）：请关闭后重新打开编辑。`;
    } else if (r.json?.fields) {
      m.fieldErrors = r.json.fields;
    } else {
      m.error = r.json?.error || `提交失败（${r.status}），可重试`;
    }
    render();
  }

  async function copyExperimentNow(expId, fromActivityId) {
    let r;
    try {
      r = await apiJson('/api/marketing/experiment/copy', { id: expId, fromActivityId: fromActivityId || null });
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    if (r.ok && r.json?.experiment) {
      applyBoardResponse(r.json);
      showToast('已复制为新实验（行动置为草稿）');
      render();
      notifyState();
    } else {
      state.toast = { msg: r.json?.error || '复制失败，可重试' };
      showToast(state.toast.msg);
    }
  }

  function focusBoardError(errs) {
    const view = viewEl();
    if (!view) return;
    const map = {
      contentDraft: '#mktContent', publishedAt: '#mktPubAt', publishUrl: '#mktPubUrl',
      publishCredential: '#mktPubCredential', reviewBasis: '#mktReviewBasis', decision: '#mktReviewDecision',
      stopReason: '#mktStopReason', reason: '#mktCorrectReason', timezone: '#mktTimezone',
      plannedAt: '#mktPlannedAt', title: '#mktTitle', channelId: '#mktDrawerChannel',
    };
    const first = Object.keys(errs)[0];
    if (!first) return;
    view.querySelector(map[first] || `#mktCard-x`)?.focus?.();
  }

  function positioningPaneHtml() {
    return `
      ${aiButtonsHtml([['positioning', '梳理定位'], ['pricing', '分析定价']])}
      <div class="mkt-split">
        <section class="mkt-form" aria-label="定位与定价表单">
          ${positioningFormHtml()}
          <div class="mkt-divider"></div>
          ${pricingFormHtml()}
          <footer class="mkt-save-foot">
            <button type="button" class="btn primary" id="mktSave">保存定位与证据</button>
            ${state.conflict ? '<button type="button" class="btn" id="mktReload">重新载入</button>' : ''}
            <span class="muted small" id="mktSaveState" role="status" aria-live="polite"></span>
          </footer>
        </section>
        <aside class="mkt-side" aria-label="证据与版本">
          ${evidenceHtml()}
          <div class="mkt-divider"></div>
          ${versionsHtml()}
        </aside>
      </div>`;
  }

  /* ================================================================
   * REQ-20260910-022 project-growth 工作流（AI 任务面板 / 草稿采纳 / 运行记录）
   * ================================================================ */

  const AI_ENTRIES = [
    ['positioning', '梳理定位'], ['pricing', '分析定价'], ['channels', '制定渠道计划'],
    ['content', '生成内容'], ['review', '复盘'],
  ];
  const AI_TYPE_LABEL = Object.fromEntries(AI_ENTRIES);
  const AI_RUN_STATUS_LABEL = { waiting: '等待回执 · 尚未收到结果', received: '草稿待处理', done: '已处理', corrupt: '记录损坏' };
  const AI_CAND_KIND_LABEL = {
    positioning: '定位', pricing: '定价', channel: '渠道', experiment: '实验', activity: '行动', review: '复盘',
  };
  const AI_ADOPT_TOAST = {
    positioning: '定位候选已作为「假设」证据写入档案（来源指向 agent-runs，可追溯）',
    pricing: '已写入候选定价版本（候选不自动成为当前方案，需显式设为当前）',
    channel: '渠道已创建（候选渠道不自动变为已验证，需按验证方法执行实验）',
    experiment: '实验已创建（草稿状态，人工确认后开始观察）',
    activity: '行动草稿已创建（人工复制发布，不自动发送）',
    review: '复盘已创建（依据固定为保存时观察快照）',
  };

  function growthData() {
    return state.growth && state.growth.initialized === true ? state.growth : null;
  }

  function ensureGrowth() {
    if (state.growthPhase === 'idle' || state.growthPhase === 'error') refreshGrowth();
  }

  async function refreshGrowth() {
    state.growthPhase = 'loading';
    state.growthError = null;
    render();
    let r;
    try {
      r = await apiJson('/api/marketing/growth');
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    if (r.ok && r.json && r.json.initialized === true) {
      state.growth = r.json;
      state.growthPhase = 'ready';
    } else if (r.ok) {
      state.growth = null;
      state.growthPhase = 'ready';
    } else {
      state.growthPhase = 'error';
      state.growthError = r.json?.error || `读取失败（${r.status}）`;
    }
    render();
  }

  function showToastGrowth(msg) {
    state.gtoast = { msg };
    const n = viewEl()?.querySelector('#mktGrowthToast');
    if (n) {
      n.textContent = msg;
      n.classList.add('show');
      setTimeout(() => {
        const n2 = viewEl()?.querySelector('#mktGrowthToast');
        if (n2 && state.gtoast?.msg === msg) {
          n2.textContent = '';
          n2.classList.remove('show');
        }
      }, 3600);
    }
  }

  async function copyTextGrowth(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      showToastGrowth(`${label}已复制到剪贴板（仅复制，不执行）`);
      return true;
    } catch {
      showToastGrowth(`剪贴板在当前环境不可用：${label}已生成于面板中，可全选后手动复制`);
      return false;
    }
  }

  /* ---------- 任务面板 ---------- */

  function openAiPanel(type, observation = null) {
    const ty = AI_TYPE_LABEL[type] ? type : 'positioning';
    state.aiPanel = {
      type: ty,
      from: observation?.from || state.effFrom || todayStr(),
      to: observation?.to || state.effTo || todayStr(),
      inputs: null, inputsPhase: 'loading',
      busy: false, created: null, error: null,
    };
    render();
    aiLoadInputs();
  }

  async function aiLoadInputs() {
    const p = state.aiPanel;
    if (!p) return;
    const q = [`type=${encodeURIComponent(p.type)}`];
    if (p.type === 'review') {
      q.push(`from=${encodeURIComponent(p.from)}`);
      q.push(`to=${encodeURIComponent(p.to)}`);
    }
    let r;
    try {
      r = await apiJson(`/api/marketing/growth/inputs?${q.join('&')}`);
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    if (state.aiPanel !== p) return;
    if (r.ok) {
      p.inputs = Array.isArray(r.json.inputs) ? r.json.inputs : [];
      p.inputsPhase = 'ready';
    } else {
      p.inputsPhase = 'error';
      p.error = r.json?.error || `读取失败（${r.status}）`;
    }
    render();
  }

  async function aiCopyPrompt() {
    const p = state.aiPanel;
    if (!p || p.busy) return;
    if (p.created) {
      copyTextGrowth(p.created.prompt, '任务提示词');
      return;
    }
    p.busy = true;
    p.error = null;
    render();
    const body = { type: p.type };
    if (p.type === 'review') {
      body.from = p.from;
      body.to = p.to;
    }
    let r;
    try {
      r = await apiJson('/api/marketing/growth/run', body);
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    if (state.aiPanel !== p) return;
    p.busy = false;
    if (!r.ok) {
      p.error = r.json?.fields
        ? `${r.json.error || '任务创建失败'}：${Object.values(r.json.fields)[0]}`
        : (r.json?.error || `创建失败（${r.status}），可重试`);
      render();
      return;
    }
    p.created = { id: r.json.run.id, prompt: r.json.prompt, status: r.json.run.status };
    render();
    copyTextGrowth(r.json.prompt, '任务提示词');
    refreshGrowth();
  }

  async function aiContinuePrompt(runId) {
    const src = (growthData()?.runs || []).find((x) => x.id === runId) || state.aiRun;
    const body = { type: src?.type || 'positioning', continueOf: runId };
    if (src?.observation) {
      body.from = src.observation.from;
      body.to = src.observation.to;
    }
    let r;
    try {
      r = await apiJson('/api/marketing/growth/run', body);
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    if (!r.ok) {
      showToastGrowth(r.json?.error || `创建接续任务失败（${r.status}）`);
      return;
    }
    copyTextGrowth(r.json.prompt, '继续任务提示词');
    showToastGrowth(`已复制继续任务提示词并登记 ${r.json.run.id}（接续 ${runId}，含历史草稿与采纳记录引用）`);
    refreshGrowth();
  }

  /* ---------- 草稿处理 / 详情 ---------- */

  async function openAiRun(id) {
    state.aiRun = { id: String(id), phase: 'loading' };
    state.aiRunError = null;
    state.aiRunNotice = null;
    render();
    let r;
    try {
      r = await apiJson(`/api/marketing/growth/run/${encodeURIComponent(id)}`);
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    if (!state.aiRun || state.aiRun.id !== String(id)) return;
    if (!r.ok) {
      state.aiRun = null;
      state.aiRunError = r.json?.error || `读取失败（${r.status}）`;
      render();
      return;
    }
    state.aiRun = r.json;
    render();
  }

  async function aiSettle(candidateId, action) {
    const run = state.aiRun;
    if (!run || !run.draft || state.aiRunBusy) return;
    state.aiRunBusy = true;
    state.aiRunError = null;
    state.aiRunNotice = null;
    render();
    let r;
    try {
      r = await apiJson(`/api/marketing/growth/run/${action === 'adopt' ? 'adopt' : 'keep'}`, {
        id: run.id, candidateId, data: null,
      });
    } catch (e) {
      r = { ok: false, status: 0, json: { error: `网络错误：${e.message}` } };
    }
    state.aiRunBusy = false;
    if (!r.ok) {
      state.aiRunError = r.json?.fields
        ? `${r.json.error || '操作失败'}：${Object.values(r.json.fields)[0]}`
        : (r.json?.error || `操作失败（${r.status}），草稿已保留可重试`);
      render();
      return;
    }
    if (action === 'adopt') {
      const kind = (run.draft.candidates || []).find((c) => c.id === candidateId)?.kind;
      state.aiRunNotice = r.json.already
        ? '该候选已采纳（幂等，未重复写入正式档案）'
        : `${AI_ADOPT_TOAST[kind] || '候选已采纳'}${r.json.result?.ref ? ` → ${r.json.result.ref}` : ''}`;
    } else {
      state.aiRunNotice = r.json.already
        ? '该候选已是保留草稿状态（幂等）'
        : '已保留草稿（未写入正式档案）：候选保留在 agent-runs，可随时重新处理';
    }
    const notice = state.aiRunNotice;
    await openAiRun(run.id);
    state.aiRunNotice = notice; // openAiRun 会清空提示，此处恢复渲染
    render();
    refreshGrowth();
    if (action === 'adopt') {
      // 采纳可能改变档案 / 看板 / 效果数据：刷新对应读取（保留旧成果，不重置用户输入）
      refresh();
      refreshBoard();
      refreshEffect();
    }
  }

  function aiEditOpen(cid) {
    const run = state.aiRun;
    const c = run?.draft?.candidates?.find((x) => x.id === cid);
    if (!c || c.state !== 'pending') return;
    state.aiEdit = {
      runId: run.id, candidateId: cid,
      title: c.title, verify: c.verify || '', reason: c.reason || '',
      error: null, saving: false,
    };
    render();
  }

  async function aiEditSave() {
    const e = state.aiEdit;
    if (!e || e.saving) return;
    if (!String(e.title || '').trim()) {
      e.error = '候选标题不能为空';
      render();
      return;
    }
    e.saving = true;
    e.error = null;
    render();
    let r;
    try {
      r = await apiJson('/api/marketing/growth/run/edit', {
        id: e.runId, candidateId: e.candidateId, data: { title: e.title, verify: e.verify, reason: e.reason },
      });
    } catch (err) {
      r = { ok: false, status: 0, json: { error: `网络错误：${err.message}` } };
    }
    if (state.aiEdit !== e) return;
    e.saving = false;
    if (!r.ok) {
      e.error = r.json?.error || `保存失败（${r.status}）`;
      render();
      return;
    }
    state.aiEdit = null;
    openAiRun(e.runId).then(() => {
      state.aiRunNotice = '候选已编辑（保存回草稿，尚未采纳）';
      render();
    });
    refreshGrowth();
  }

  /* ---------- 渲染 ---------- */

  function aiButtonsHtml(types) {
    return `
      <div class="mkt-ai-row">
        ${types.map(([ty, label]) => `<button type="button" class="btn small mkt-ai-btn" data-ai-type="${ty}">✦ ${esc(label)}</button>`).join('')}
        <span class="muted small">复制提示词到外部 Agent 会话执行，回执经统一 CLI 写入；界面不自动运行模型。</span>
      </div>`;
  }

  function aiPanelHtml() {
    const p = state.aiPanel;
    if (!p) return '';
    const skills = state.growth?.skills;
    const typeOpts = AI_ENTRIES.map(([k, l]) => `<option value="${k}"${p.type === k ? ' selected' : ''}>${esc(l)}</option>`).join('');
    const skillNames = skills?.byType?.[p.type] || [];
    const inputsRows = (p.inputs || []).map((i) => `
      <tr><td>${esc(i.ref)}</td><td>${i.revision == null ? '<span class="muted">（无版本要求）</span>' : `r${i.revision}`}</td></tr>`).join('');
    return `
      <div class="mkt-modal-wrap" id="mktAiWrap">
        <div class="mkt-modal" role="dialog" aria-label="project-growth 任务面板">
          <header class="mkt-drawer-head"><h4>project-growth 任务 · ${esc(AI_TYPE_LABEL[p.type])}</h4><button type="button" class="btn small quiet" id="mktAiClose">关闭</button></header>
          <div class="mkt-modal-body">
            <p class="muted small">在可访问项目文件的 Agent 会话中执行；看板只复制提示词，不自动运行任何模型。没有回执不宣称已保存。</p>
            <label class="field">任务入口（五类）<select id="mktAiType">${typeOpts}</select></label>
            ${p.type === 'review' ? `
            <div class="mkt-num-row">
              <label class="field">观察期从<input id="mktAiFrom" type="date" value="${esc(p.from)}"></label>
              <label class="field">至<input id="mktAiTo" type="date" value="${esc(p.to)}"></label>
            </div>
            <p class="muted small">复盘结论必须引用该期实际指标快照；该期无数据时输出「数据不足」与补采建议，不生成虚构业绩或因果结论。</p>` : ''}
            ${skills && skills.installed === false ? `
            <p class="notice warn">技能缺失：外部 skill（${esc(skillNames.join('、') || '—')}）未安装，能力缺口如上；将复制<strong>手工提示词兜底</strong>（不含外部 skill 调用，输出须注明「未经外部 skill」）。看板不会假称已运行外部 skill。</p>` : `
            <p class="notice">外部 skill 按需加载：${esc(skillNames.join('、'))}（来源 ${esc(skills?.source || '')}）。</p>`}
            <h5>将使用的项目资料（按引用版本读取，不读取其他项目）</h5>
            ${p.inputsPhase === 'loading' ? '<p class="muted small">正在读取资料引用…</p>'
              : p.inputsPhase === 'error' ? `<p class="notice err">无法读取项目资料：${esc(p.error || '未知错误')}。空项目仅提供基于 README 的兜底提示词（输出会标注「档案缺失」）。</p>`
              : `<table class="mkt-ai-table"><thead><tr><th>资料引用</th><th>任务输入版本</th></tr></thead><tbody>${inputsRows}</tbody></table>`}
            ${p.error ? `<p class="notice err">${esc(p.error)}</p>` : ''}
            ${p.created ? `
            <p class="notice ok">已登记任务 ${esc(p.created.id)}：提示词已复制（仅复制，不执行）。当前状态：<strong>尚未收到结果</strong>——回执由外部会话写入后此处与运行记录才会更新。</p>
            <h5>任务提示词（留档，可再次复制）</h5>
            <pre class="mkt-ai-pre">${esc(p.created.prompt)}</pre>` : ''}
          </div>
          <footer class="mkt-save-foot">
            <button type="button" class="btn primary" id="mktAiCopy"${p.busy ? ' disabled' : ''}>${p.busy ? '创建中…' : (p.created ? '再次复制任务提示词' : '复制任务提示词')}</button>
          </footer>
        </div>
      </div>`;
  }

  function aiRunHtml() {
    const run = state.aiRun;
    if (!run) {
      if (!state.aiRunError) return '';
      return `
      <div class="mkt-modal-wrap">
        <div class="mkt-modal" role="dialog" aria-label="运行详情读取失败">
          <header class="mkt-drawer-head"><h4>运行详情读取失败</h4><button type="button" class="btn small quiet" id="mktAiRunClose">关闭</button></header>
          <div class="mkt-modal-body"><p class="notice err">${esc(state.aiRunError)}</p></div>
        </div>
      </div>`;
    }
    if (run.phase === 'loading') {
      return `
      <div class="mkt-modal-wrap">
        <div class="mkt-modal" role="dialog" aria-label="读取运行详情"><div class="mkt-modal-body"><p class="muted">正在读取运行详情…</p></div></div>
      </div>`;
    }
    const d = run.draft;
    const meta = (k, v) => `<div><span class="muted small">${k}：</span>${v}</div>`;
    const inputsText = (run.inputs || []).map((i) => `${esc(i.ref)}${i.revision == null ? '' : `@r${i.revision}`}`).join(' · ');
    const sec = (title, arr) => `
      <div class="mkt-ai-dbox"><h6>${esc(title)}</h6><ul>${(arr || []).length ? arr.map((x) => `<li>${esc(x)}</li>`).join('') : '<li class="muted">—</li>'}</ul></div>`;
    const waiting = run.status === 'waiting';
    const stale = waiting && run.receipts && run.receipts.length
      && run.receipts[run.receipts.length - 1].result === 'rejected:stale';
    const lastReceipt = run.receipts?.[run.receipts.length - 1];
    const candHtml = !d ? '' : (d.insufficient
      ? `<p class="notice warn">数据不足：该观察期无观察记录（未录入 ≠ 0）。本草稿仅输出补采建议，不生成业绩结论或因果判断；补采后再生成复盘。</p>${sec('补采建议', d.advice)}`
      : (d.candidates || []).map((c) => {
        const adopted = c.state === 'adopted';
        const kept = c.state === 'kept';
        return `
        <div class="mkt-ai-cand${adopted ? ' adopted' : kept ? ' kept' : ''}">
          <div class="ttl"><span class="mkt-ai-badge acc">${esc(AI_CAND_KIND_LABEL[c.kind] || c.kind || '候选')}</span> ${esc(c.title)}
            ${adopted ? '<span class="mkt-ai-badge ok">已采纳</span>' : ''}${kept ? '<span class="mkt-ai-badge">保留草稿</span>' : ''}
            ${c.resultRef ? `<span class="muted small">→ ${esc(c.resultRef)}</span>` : ''}</div>
          ${c.reason ? `<div class="kv">建议理由：${esc(c.reason)}</div>` : ''}
          ${c.verify ? `<div class="kv">验证方法：${esc(c.verify)}</div>` : ''}
          ${c.adoptTo ? `<div class="kv">显式采纳后写入：${esc(c.adoptTo)}</div>` : ''}
          ${!adopted && !kept && !waiting ? `
          <div class="ops">
            <button type="button" class="btn small quiet" id="mktAiCandEdit-${esc(c.id)}">编辑</button>
            <button type="button" class="btn small primary" id="mktAiCandAdopt-${esc(c.id)}"${state.aiRunBusy ? ' disabled' : ''}>采纳</button>
            <button type="button" class="btn small quiet" id="mktAiCandKeep-${esc(c.id)}"${state.aiRunBusy ? ' disabled' : ''}>保留草稿</button>
          </div>` : ''}
        </div>`;
      }).join(''));
    return `
      <div class="mkt-modal-wrap" id="mktAiRunWrap">
        <div class="mkt-modal" role="dialog" aria-label="返回草稿">
          <header class="mkt-drawer-head"><h4>返回草稿 · ${esc(run.id)}（${esc(AI_TYPE_LABEL[run.type] || run.type)}${run.observation ? ` · ${esc(run.observation.from)}~${esc(run.observation.to)}` : ''}${run.continueOf ? ` · 接续 ${esc(run.continueOf)}` : ''}）</h4><button type="button" class="btn small quiet" id="mktAiRunClose">关闭</button></header>
          <div class="mkt-modal-body">
            <div class="mkt-ai-meta">
              ${meta('来源会话', esc(run.session || '—'))}
              ${meta('写入时间', esc(run.receiptAt ? fmtTime(run.receiptAt) : '—'))}
              ${meta('草稿引用', esc(run.draftRef || '—（未写入）'))}
              ${meta('输入引用及版本', inputsText || '—')}
              ${meta('执行结果', esc(lastReceipt ? lastReceipt.result : 'waiting'))}
            </div>
            ${waiting ? `
            <p class="notice warn">尚未收到结果：提示词已复制（仅复制，不执行），回执由外部会话经统一 CLI 写入后才会展示草稿；没有回执不宣称已保存。</p>
            ${stale ? `<p class="notice err">${esc(lastReceipt.reason || '输入基线过期：回执未写入（不覆盖他人更新）')}——可按当前版本重建任务后重新执行。</p>` : ''}
            <h5>任务提示词（留档）</h5>
            <pre class="mkt-ai-pre">${esc(run.prompt || '')}</pre>` : ''}
            ${state.aiRunNotice ? `<p class="notice ok">${esc(state.aiRunNotice)}</p>` : ''}
            ${state.aiRunError ? `<p class="notice err">${esc(state.aiRunError)}</p>` : ''}
            ${d ? `
            <div class="mkt-ai-cols">${sec('事实', d.facts)}${sec('假设', d.assumptions)}${sec('待确认', d.toConfirm)}</div>
            <h5>证据引用</h5>${sec('证据（含版本）', d.evidence)}
            <h5>候选行动（逐项处理：编辑 → 采纳 / 保留草稿）</h5>${candHtml || '<p class="muted small">无候选行动。</p>'}
            ${!d.insufficient ? `<h5>缺失信息</h5>${sec('缺失信息', d.missing)}` : ''}` : ''}
          </div>
          <footer class="mkt-save-foot">
            ${waiting && stale ? `<button type="button" class="btn small" id="mktAiRebuild-${esc(run.id)}">按当前版本重建任务</button>` : ''}
            <span class="mkt-toolbar-spacer"></span>
            <button type="button" class="btn quiet" id="mktAiRunClose2">关闭</button>
            ${!waiting ? `<button type="button" class="btn primary" id="mktAiRunContinue-${esc(run.id)}">复制继续任务提示词</button>` : ''}
          </footer>
        </div>
      </div>`;
  }

  function aiEditHtml() {
    const e = state.aiEdit;
    if (!e) return '';
    return `
      <div class="mkt-modal-wrap">
        <div class="mkt-modal" role="dialog" aria-label="编辑候选">
          <header class="mkt-drawer-head"><h4>编辑候选（保存回草稿，尚未采纳）</h4><button type="button" class="btn small quiet" id="mktAiEditCancel">取消</button></header>
          <div class="mkt-modal-body">
            <label class="field">标题 / 内容<textarea id="mktAiEditTitle" rows="3">${esc(e.title)}</textarea></label>
            <label class="field">验证方法<textarea id="mktAiEditVerify" rows="2">${esc(e.verify)}</textarea></label>
            <label class="field">建议理由<textarea id="mktAiEditReason" rows="2">${esc(e.reason)}</textarea></label>
            ${e.error ? `<p class="notice err">${esc(e.error)}</p>` : ''}
          </div>
          <footer class="mkt-save-foot">
            <button type="button" class="btn quiet" id="mktAiEditCancel2">取消</button>
            <button type="button" class="btn primary" id="mktAiEditSave"${e.saving ? ' disabled' : ''}>${e.saving ? '保存中…' : '保存编辑'}</button>
          </footer>
        </div>
      </div>`;
  }

  function growthRunsHtml() {
    const g = growthData();
    if (!g) return state.growthPhase === 'error'
      ? `<section class="mkt-block"><h4>AI 运行记录</h4><p class="notice err">运行记录读取失败：${esc(state.growthError || '未知错误')}</p><button type="button" class="btn small" id="mktGrowthRetry">重试</button></section>`
      : '';
    const rows = (g.runs || []).map((r) => {
      if (r.corrupt) {
        return `<tr><td>${esc(r.id)}</td><td colspan="7"><span class="mkt-ai-badge err">记录损坏（只读占位，请人工检查文件，系统不自动覆盖）</span></td></tr>`;
      }
      const inputs = (r.inputs || []).map((i) => `${esc(i.ref)}${i.revision == null ? '' : `@r${i.revision}`}`).join(' · ');
      let status;
      if (r.status === 'waiting') {
        status = r.result === 'rejected:stale'
          ? '<span class="mkt-ai-badge err">输入基线过期（未写入）</span>'
          : '<span class="mkt-ai-badge warn">尚未收到结果</span>';
      } else if (r.status === 'received') status = '<span class="mkt-ai-badge acc">草稿待处理</span>';
      else status = '<span class="mkt-ai-badge ok">已处理</span>';
      const counts = r.candidateCounts;
      const ops = `
        <button type="button" class="btn small quiet" id="mktAiRun-${esc(r.id)}">${r.status === 'waiting' ? '详情' : '查看草稿'}</button>
        ${r.status !== 'waiting' ? `<button type="button" class="btn small quiet" id="mktAiContinue-${esc(r.id)}">复制继续任务提示词</button>` : ''}`;
      return `
        <tr>
          <td>${esc(r.id)}${r.continueOf ? `<div class="muted small">接续 ${esc(r.continueOf)}</div>` : ''}</td>
          <td>${esc(r.typeLabel || AI_TYPE_LABEL[r.type] || r.type)}</td>
          <td class="mkt-ai-inputs">${inputs || '—'}</td>
          <td>${status}${counts && counts.pending ? `<div class="muted small">待处理候选 ${counts.pending} 项</div>` : ''}</td>
          <td>${esc(r.receiptAt ? fmtTime(r.receiptAt) : '—')}</td>
          <td>${esc(r.session || '—')}</td>
          <td>${esc(r.result)}</td>
          <td>${ops}</td>
        </tr>`;
    }).join('');
    return `
      <section class="mkt-block" aria-label="AI 运行记录">
        <h4>AI 运行记录（agent-runs）</h4>
        ${rows ? `<table class="mkt-ai-table"><thead><tr><th>任务 ID</th><th>类型</th><th>输入引用及版本</th><th>状态</th><th>写入时间</th><th>来源会话</th><th>执行结果</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`
          : '<p class="muted small">暂无运行记录：从各页右上角 AI 入口复制任务提示词后，这里会登记任务并显示「尚未收到结果」。</p>'}
        <p class="muted small">回执由外部 Agent 会话经统一 CLI 写入（atb growth receipt）；相同任务重复回执幂等，过期输入与跨项目写入被拒绝。</p>
      </section>`;
  }

  function render() {
    const view = viewEl();
    if (!view) return;
    if (state.phase === 'loading') {
      view.innerHTML = '<div class="mkt-phase"><p class="muted">正在加载营销档案…</p></div>';
      state.rendered = true;
      return;
    }
    if (state.phase === 'error') {
      view.innerHTML = `
        <div class="mkt-phase">
          <div class="notice err">营销档案读取失败：${esc(state.loadError || '未知错误')}</div>
          <button type="button" class="btn" id="mktRetry">重试</button>
        </div>`;
      view.querySelector('#mktRetry')?.addEventListener('click', () => refresh());
      state.rendered = true;
      return;
    }
    if (state.phase === 'empty') {
      view.innerHTML = `
        <div class="mkt-phase">
          <div class="empty-card">
            <h2>尚未建立营销档案</h2>
            <p>为当前项目建立营销档案：定位、证据与定价版本管理。初始化由你显式触发，会读取项目 README 生成简介草稿（仅作起点，不代表市场需求已被验证）。</p>
            ${state.initError ? `<p class="notice err">${esc(state.initError)}</p>` : ''}
            <button type="button" class="btn primary" id="mktInit"${state.busyInit ? ' disabled' : ''}>${state.busyInit ? '正在建立…' : '初始化营销档案'}</button>
          </div>
        </div>`;
      view.querySelector('#mktInit')?.addEventListener('click', doInit);
      state.rendered = true;
      return;
    }
    view.innerHTML = `
      <nav class="mkt-tabs" aria-label="营销页签">${tabBtnsHtml()}</nav>
      <div class="mkt-pane${state.tab === 'overview' ? '' : ' hidden'}" data-mkt-pane="overview">${overviewHtml()}</div>
      <div class="mkt-pane${state.tab === 'positioning' ? '' : ' hidden'}" data-mkt-pane="positioning">${positioningPaneHtml()}</div>
      <div class="mkt-pane${state.tab === 'channels' ? '' : ' hidden'}" data-mkt-pane="channels">${channelsPaneHtml()}</div>
      <div class="mkt-pane${state.tab === 'review' ? '' : ' hidden'}" data-mkt-pane="review">${reviewPaneHtml()}</div>
      ${aiPanelHtml()}${aiRunHtml()}${aiEditHtml()}
      <div id="mktGrowthToast" class="mkt-toast" role="status" aria-live="polite"></div>`;
    bind();
    state.rendered = true;
  }

  /* ---------- 绑定 ---------- */

  const POS_FIELDS = [
    ['#mktIntro', 'intro'], ['#mktMarkets', 'markets'], ['#mktAudience', 'audience'],
    ['#mktScenarios', 'scenarios'], ['#mktPain', 'painPoints'], ['#mktAlt', 'alternatives'],
    ['#mktDiff', 'differentiators'], ['#mktLinks', 'links'], ['#mktGoal', 'stageGoal'],
    ['#mktMetric', 'primaryMetric'],
  ];

  const ERR_FOCUS = {
    'positioning.budget': '#mktBudget',
    'positioning.weeklyHours': '#mktHours',
    currency: '#mktPriceCurrency',
    cycle: '#mktPriceCycle',
  };

  function focusFirstError(errs) {
    const view = viewEl();
    if (!view) return;
    const first = Object.keys(errs)[0];
    if (!first) return;
    let sel = ERR_FOCUS[first];
    if (!sel && /^packages\.(\d+)\.price$/.test(first)) sel = `#mktPkgPrice-${first.match(/^packages\.(\d+)\.price$/)[1]}`;
    if (!sel && /^evidence\.(\d+)/.test(first)) sel = `#mktEvContent-${first.match(/^evidence\.(\d+)/)[1]}`;
    const n = sel ? view.querySelector(sel) : null;
    n?.focus?.();
  }

  function bind() {
    const view = viewEl();
    if (!view || !state.draft) return;
    const el = (sel) => view.querySelector(sel);

    for (const b of view.querySelectorAll('.mkt-tab')) {
      if (b.disabled) continue;
      b.addEventListener('click', () => setTab(b.dataset?.tab));
    }

    // 定位字段
    for (const [sel, key] of POS_FIELDS) {
      const n = el(sel);
      if (!n) continue;
      n.value = state.draft.positioning[key] ?? '';
      n.addEventListener('input', () => {
        state.draft.positioning[key] = n.value;
        markDirty();
      });
    }
    const stage = el('#mktStage');
    if (stage) {
      stage.value = state.draft.positioning.stage;
      stage.addEventListener('input', () => {
        state.draft.positioning.stage = stage.value;
        markDirty();
      });
    }
    for (const [sel, key] of [['#mktBudget', 'budget'], ['#mktHours', 'weeklyHours']]) {
      const n = el(sel);
      if (!n) continue;
      n.value = state.draft.positioning[key] == null ? '' : state.draft.positioning[key];
      n.addEventListener('input', () => {
        state.draft.positioning[key] = n.value === '' ? null : n.value;
        markDirty();
      });
    }

    // 证据
    for (let i = 0; i < state.draft.evidence.length; i++) {
      const row = state.draft.evidence[i];
      const type = el(`#mktEvType-${i}`);
      if (type) {
        type.value = row.type;
        type.addEventListener('input', () => { row.type = type.value; markDirty(); });
      }
      const date = el(`#mktEvDate-${i}`);
      if (date) {
        date.value = row.collectedAt || '';
        date.addEventListener('input', () => { row.collectedAt = date.value; markDirty(); });
      }
      const content = el(`#mktEvContent-${i}`);
      if (content) {
        content.value = row.content;
        content.addEventListener('input', () => { row.content = content.value; markDirty(); });
      }
      const source = el(`#mktEvSource-${i}`);
      if (source) {
        source.value = row.source;
        source.addEventListener('input', () => { row.source = source.value; markDirty(); });
      }
      el(`#mktEvDel-${i}`)?.addEventListener('click', () => {
        state.draft.evidence.splice(i, 1);
        state.fieldErrors = {};
        markDirty();
        render();
      });
    }
    el('#mktEvAdd')?.addEventListener('click', () => {
      state.draft.evidence.push({ id: '', type: 'unverified', content: '', source: '', collectedAt: todayStr() });
      markDirty();
      render();
    });

    // 定价候选
    const pm = el('#mktPriceModel');
    if (pm) {
      pm.value = state.priceDraft.model;
      pm.addEventListener('input', () => {
        state.priceDraft.model = pm.value;
        state.priceDirty = true;
        render(); // 币种 / 周期必填提示随模式切换
      });
    }
    const pc = el('#mktPriceCurrency');
    if (pc) {
      pc.value = state.priceDraft.currency;
      pc.addEventListener('input', () => { state.priceDraft.currency = pc.value; state.priceDirty = true; });
    }
    const pcy = el('#mktPriceCycle');
    if (pcy) {
      pcy.value = state.priceDraft.cycle;
      pcy.addEventListener('input', () => { state.priceDraft.cycle = pcy.value; state.priceDirty = true; });
    }
    for (let i = 0; i < state.priceDraft.packages.length; i++) {
      const p = state.priceDraft.packages[i];
      for (const [suffix, key] of [['Name', 'name'], ['Benefits', 'benefits'], ['Price', 'price']]) {
        const n = el(`#mktPkg${suffix}-${i}`);
        if (!n) continue;
        n.value = p[key] == null ? '' : p[key];
        n.addEventListener('input', () => {
          p[key] = n.value === '' ? (key === 'price' ? '' : '') : n.value;
          state.priceDirty = true;
        });
      }
      el(`#mktPkgDel-${i}`)?.addEventListener('click', () => {
        state.priceDraft.packages.splice(i, 1);
        state.priceFieldErrors = {};
        state.priceDirty = true;
        render();
      });
    }
    el('#mktPkgAdd')?.addEventListener('click', () => {
      state.priceDraft.packages.push(blankPackage());
      state.priceDirty = true;
      render();
    });
    for (const [sel, key] of [['#mktPriceCost', 'costBasis'], ['#mktPriceValidation', 'validationMethod']]) {
      const n = el(sel);
      if (!n) continue;
      n.value = state.priceDraft[key];
      n.addEventListener('input', () => { state.priceDraft[key] = n.value; state.priceDirty = true; });
    }
    el('#mktPriceSave')?.addEventListener('click', () => savePricingNow());
    el('#mktSave')?.addEventListener('click', () => saveNow());
    el('#mktReload')?.addEventListener('click', () => reloadFromServer());

    // 版本历史
    for (const v of state.data?.versions || []) {
      el(`#mktVerBtn-${v.version}`)?.addEventListener('click', () => selectVersion(v.version));
      if (v.corrupt !== true && v.version !== state.data?.current) {
        el(`#mktSetCurrent-${v.version}`)?.addEventListener('click', () => setCurrent(v.version));
      }
    }
    const detail = el('#mktVerDetail');
    if (detail) detail.innerHTML = versionDetailHtml();

    syncButtons();
    paintFieldErrors();
    syncSaveState();
    syncPriceState();
    bindGrowth();
    if (state.tab === 'channels') bindBoard();
    if (state.tab === 'review') bindEffect();
  }

  /* ---------- project-growth 绑定（REQ-20260910-022；弹层 Esc 见 init） ---------- */

  function bindGrowth() {
    const view = viewEl();
    if (!view) return;
    const el = (sel) => view.querySelector(sel);

    // 五类入口按钮（各页右上角）
    for (const [ty] of AI_ENTRIES) {
      el(`[data-ai-type="${ty}"]`)?.addEventListener('click', () => openAiPanel(ty));
    }
    el('#mktGrowthRetry')?.addEventListener('click', () => refreshGrowth());

    // 任务面板
    const p = state.aiPanel;
    if (p) {
      const typeSel = el('#mktAiType');
      if (typeSel) {
        typeSel.value = p.type;
        typeSel.addEventListener('input', () => {
          p.type = typeSel.value;
          p.created = null;
          p.inputs = null;
          p.inputsPhase = 'loading';
          render();
          aiLoadInputs();
        });
      }
      for (const [sel, key] of [['#mktAiFrom', 'from'], ['#mktAiTo', 'to']]) {
        const n = el(sel);
        if (n) {
          n.value = p[key];
          n.addEventListener('input', () => {
            p[key] = n.value || '';
            p.inputs = null;
            p.inputsPhase = 'loading';
            aiLoadInputs();
          });
        }
      }
      el('#mktAiClose')?.addEventListener('click', () => { state.aiPanel = null; render(); });
      el('#mktAiCopy')?.addEventListener('click', () => aiCopyPrompt());
    }

    // 运行记录列表
    for (const r of growthData()?.runs || []) {
      if (r.corrupt) continue;
      el(`#mktAiRun-${r.id}`)?.addEventListener('click', () => openAiRun(r.id));
      if (r.status !== 'waiting') el(`#mktAiContinue-${r.id}`)?.addEventListener('click', () => aiContinuePrompt(r.id));
    }

    // 草稿处理 / 详情面板
    const run = state.aiRun;
    if (run && run.phase !== 'loading') {
      el('#mktAiRunClose')?.addEventListener('click', () => { state.aiRun = null; state.aiRunError = null; state.aiRunNotice = null; render(); });
      el('#mktAiRunClose2')?.addEventListener('click', () => { state.aiRun = null; state.aiRunError = null; state.aiRunNotice = null; render(); });
      el(`#mktAiRunContinue-${run.id}`)?.addEventListener('click', () => aiContinuePrompt(run.id));
      el(`#mktAiRebuild-${run.id}`)?.addEventListener('click', () => {
        state.aiRun = null;
        openAiPanel(run.type, run.observation);
      });
      for (const c of run.draft?.candidates || []) {
        if (c.state !== 'pending' || run.status === 'waiting') continue;
        el(`#mktAiCandAdopt-${c.id}`)?.addEventListener('click', () => aiSettle(c.id, 'adopt'));
        el(`#mktAiCandKeep-${c.id}`)?.addEventListener('click', () => aiSettle(c.id, 'keep'));
        el(`#mktAiCandEdit-${c.id}`)?.addEventListener('click', () => aiEditOpen(c.id));
      }
    } else if (state.aiRunError) {
      el('#mktAiRunClose')?.addEventListener('click', () => { state.aiRunError = null; render(); });
    }

    // 候选编辑弹层
    const e = state.aiEdit;
    if (e) {
      for (const [sel, key] of [['#mktAiEditTitle', 'title'], ['#mktAiEditVerify', 'verify'], ['#mktAiEditReason', 'reason']]) {
        const n = el(sel);
        if (n) {
          n.value = e[key];
          n.addEventListener('input', () => { e[key] = n.value; });
        }
      }
      el('#mktAiEditCancel')?.addEventListener('click', () => { state.aiEdit = null; render(); });
      el('#mktAiEditCancel2')?.addEventListener('click', () => { state.aiEdit = null; render(); });
      el('#mktAiEditSave')?.addEventListener('click', () => aiEditSave());
    }
  }

  /* ---------- 渠道与行动绑定 ---------- */

  const DRAWER_FIELDS = [
    ['#mktTitle', 'title'], ['#mktContent', 'contentDraft'], ['#mktMaterial', 'materialRefs'],
    ['#mktPlannedAt', 'plannedAt'], ['#mktTimezone', 'timezone'], ['#mktOwner', 'owner'],
    ['#mktNextStep', 'nextStep'], ['#mktPubUrl', 'publishUrl'], ['#mktPubCredential', 'publishCredential'],
    ['#mktPubAt', 'publishedAt'], ['#mktReviewBasis', 'reviewBasis'], ['#mktStopReason', 'stoppedReason'],
  ];
  const DRAWER_SELECTS = [
    ['#mktDrawerChannel', 'channelId'], ['#mktDrawerExp', 'experimentId'], ['#mktReviewDecision', 'decision'],
  ];
  const MODAL_FIELDS = {
    channel: [
      ['#mktChPlatform', 'platform'], ['#mktChLink', 'link'], ['#mktChAudience', 'audience'],
      ['#mktChLanguages', 'languages'], ['#mktChFormats', 'formats'], ['#mktChPriority', 'priority'],
      ['#mktChReason', 'reason'], ['#mktChEffort', 'weeklyEffort'], ['#mktChDataAccess', 'dataAccess'],
      ['#mktChCapabilities', 'capabilities'],
    ],
    experiment: [
      ['#mktExpChannel', 'channelId'], ['#mktExpHypothesis', 'hypothesis'], ['#mktExpMetric', 'primaryMetric'],
      ['#mktExpStart', 'observationStart'], ['#mktExpEnd', 'observationEnd'], ['#mktExpSuccess', 'successCriteria'],
      ['#mktExpCurrency', 'currency'], ['#mktExpBudgetPlanned', 'budgetPlanned'], ['#mktExpBudgetActual', 'budgetActual'],
      ['#mktExpHoursPlanned', 'hoursPlanned'], ['#mktExpHoursActual', 'hoursActual'], ['#mktExpPricing', 'pricingVersion'],
      ['#mktExpDecision', 'decision'], ['#mktExpDecisionBasis', 'decisionBasis'],
    ],
    activity: [
      ['#mktActTitle', 'title'], ['#mktActChannel', 'channelId'], ['#mktActExperiment', 'experimentId'],
      ['#mktActPlannedAt', 'plannedAt'], ['#mktActTimezone', 'timezone'], ['#mktActOwner', 'owner'],
    ],
    req: [['#mktReqTitle', 'title'], ['#mktReqDesc', 'description']],
    // REQ-20260910-021 效果与复盘（import 弹窗单独绑定）
    observation: [
      ['#mktObsMetric', 'metricKey'], ['#mktObsValue', 'value'], ['#mktObsUnit', 'unit'],
      ['#mktObsStart', 'dateStart'], ['#mktObsEnd', 'dateEnd'],
      ['#mktObsChannel', 'channelId'], ['#mktObsExp', 'experimentId'],
      ['#mktObsSource', 'source'], ['#mktObsTz', 'timezone'], ['#mktObsReason', 'reason'],
    ],
    review: [
      ['#mktRvExp', 'experimentId'], ['#mktRvStart', 'periodStart'], ['#mktRvEnd', 'periodEnd'],
      ['#mktRvTarget', 'target'], ['#mktRvActual', 'actual'], ['#mktRvBasis', 'basis'],
      ['#mktRvConclusion', 'conclusion'], ['#mktRvNext', 'nextStep'],
    ],
    metric: [
      ['#mktMdName', 'name'], ['#mktMdKey', 'key'], ['#mktMdCategory', 'category'],
      ['#mktMdKind', 'kind'], ['#mktMdUnit', 'unit'], ['#mktMdDedup', 'dedup'],
    ],
  };

  function bindBoard() {
    const view = viewEl();
    if (!view) return;
    const el = (sel) => view.querySelector(sel);

    // 工具栏与筛选
    const chanSel = el('#mktChanFilter');
    if (chanSel) {
      chanSel.addEventListener('input', () => {
        state.chanFilter = chanSel.value || '';
        if (state.expFilter) {
          const exp = boardExperiment(state.expFilter);
          if (exp && exp.channelId !== state.chanFilter) state.expFilter = ''; // 渠道变化后实验筛选跟随
        }
        render();
        notifyState();
      });
    }
    const expSel = el('#mktExpFilter');
    if (expSel) {
      expSel.addEventListener('input', () => {
        state.expFilter = expSel.value || '';
        render();
        notifyState();
      });
    }
    el('#mktClearFilters')?.addEventListener('click', () => {
      state.chanFilter = '';
      state.expFilter = '';
      state.narrowStatus = '';
      render();
      notifyState();
    });
    const narrowSel = el('#mktNarrowStatus');
    if (narrowSel) {
      narrowSel.addEventListener('input', () => {
        state.narrowStatus = narrowSel.value || '';
        render();
      });
    }
    el('#mktAddChannel')?.addEventListener('click', () => { state.modal = blankChannelModal(); render(); });
    el('#mktAddExperiment')?.addEventListener('click', () => {
      if (!(boardData()?.channels || []).length) {
        showToast('请先新建渠道（实验依附渠道运行）');
        return;
      }
      state.modal = blankExperimentModal();
      render();
    });
    el('#mktAddActivity')?.addEventListener('click', () => { state.modal = blankActivityModal(); render(); });
    el('#mktBoardRetry')?.addEventListener('click', () => refreshBoard());
    el('#mktEditChannel')?.addEventListener('click', () => {
      const c = boardChannel(state.chanFilter);
      if (!c || c.corrupt) return;
      state.modal = {
        ...blankChannelModal(),
        editId: c.id, baseRevision: c.revision,
        platform: c.platform || '', link: c.link || '', audience: c.audience || '',
        languages: c.languages || '', formats: c.formats || '', priority: c.priority || 'medium',
        reason: c.reason || '', weeklyEffort: c.weeklyEffort == null ? '' : String(c.weeklyEffort),
        dataAccess: c.dataAccess || '', capabilities: c.capabilities || '',
      };
      render();
    });

    // 实验条
    for (const e of boardData()?.experiments || []) {
      if (e.corrupt) continue;
      el(`#mktExpChip-${e.id}`)?.addEventListener('click', () => {
        state.expFilter = state.expFilter === e.id ? '' : e.id;
        render();
        notifyState();
      });
      el(`#mktExpEdit-${e.id}`)?.addEventListener('click', () => {
        state.modal = {
          ...blankExperimentModal(),
          editId: e.id, baseRevision: e.revision,
          channelId: e.channelId || '', hypothesis: e.hypothesis || '', primaryMetric: e.primaryMetric || '',
          observationStart: e.observationStart || '', observationEnd: e.observationEnd || '',
          successCriteria: e.successCriteria || '', currency: e.currency || '',
          budgetPlanned: e.budgetPlanned == null ? '' : String(e.budgetPlanned),
          budgetActual: e.budgetActual == null ? '' : String(e.budgetActual),
          hoursPlanned: e.hoursPlanned == null ? '' : String(e.hoursPlanned),
          hoursActual: e.hoursActual == null ? '' : String(e.hoursActual),
          pricingVersion: e.pricingVersion || '', decision: e.decision || '', decisionBasis: e.decisionBasis || '',
        };
        render();
      });
      el(`#mktExpCopy-${e.id}`)?.addEventListener('click', () => copyExperimentNow(e.id, null));
    }

    // 卡片 → 详情抽屉
    for (const a of (boardData()?.activities || [])) {
      if (a.corrupt) continue;
      el(`#mktCard-${a.id}`)?.addEventListener('click', () => openDrawer(a.id));
    }

    // 抽屉
    const d = state.drawer;
    if (d) {
      for (const [sel, key] of DRAWER_FIELDS) {
        const n = el(sel);
        if (!n) continue;
        n.value = d.draft[key] ?? '';
        n.addEventListener('input', () => {
          d.draft[key] = n.value;
          drawerMarkDirty();
          syncDrawerState();
        });
      }
      for (const [sel, key] of DRAWER_SELECTS) {
        const n = el(sel);
        if (!n) continue;
        n.value = d.draft[key] ?? '';
        n.addEventListener('input', () => {
          d.draft[key] = n.value;
          drawerMarkDirty();
        });
      }
      el('#mktDrawerClose')?.addEventListener('click', () => closeDrawer());
      el('#mktDrawerSave')?.addEventListener('click', () => saveDrawerNow());
      el('#mktDrawerDiscard')?.addEventListener('click', () => {
        const live = boardActivity(d.id);
        if (live) state.drawer = buildDrawerDraft(live);
        render();
      });
      el('#mktDrawerReload')?.addEventListener('click', () => drawerReload());
      el('#mktCopyText')?.addEventListener('click', () => copyContentText());
      el('#mktAdvance')?.addEventListener('click', () => {
        const live = boardActivity(d.id);
        if (!live) return;
        const to = ACTIVITY_NEXT[live.status];
        if (to) drawerTransition(to);
      });
      el('#mktStopBtn')?.addEventListener('click', () => drawerTransition('stopped'));
      el('#mktCopyExp')?.addEventListener('click', () => {
        const live = boardActivity(d.id);
        if (live?.experimentId) copyExperimentNow(live.experimentId, live.id);
      });
      el('#mktCorrectBtn')?.addEventListener('click', () => {
        const to = el('#mktCorrectTo')?.value || '';
        const reason = el('#mktCorrectReason')?.value || '';
        if (!to) return;
        drawerTransition(to, '/api/marketing/activity/correct', { reason });
      });
      el('#mktCreateReq')?.addEventListener('click', () => openReqModal());
      for (const l of boardActivity(d.id)?.linkedReqs || []) {
        if (!l.id) continue;
        el(`#mktReqLink-${l.id}`)?.addEventListener('click', () => {
          try {
            window.dispatchEvent?.(new CustomEvent('atb:open-item', { detail: { id: l.id } }));
          } catch { /* 派发失败不影响 */ }
        });
      }
      paintBoardErrors();
      syncDrawerState();
    }

    // 弹窗
    const m = state.modal;
    if (m) {
      for (const [sel, key] of MODAL_FIELDS[m.kind] || []) {
        const n = el(sel);
        if (!n) continue;
        n.value = m[key] ?? '';
        n.addEventListener('input', () => { m[key] = n.value; });
      }
      el('#mktModalCancel')?.addEventListener('click', () => { state.modal = null; render(); });
      el('#mktChSave')?.addEventListener('click', () => submitChannelModal());
      el('#mktExpSave')?.addEventListener('click', () => submitExperimentModal());
      el('#mktActSave')?.addEventListener('click', () => submitActivityModal());
      el('#mktReqSubmit')?.addEventListener('click', () => submitReqModal());
      paintModalErrors();
    }
  }

  function paintBoardErrors() {
    const view = viewEl();
    if (!view || !state.drawer) return;
    for (const [field, msg] of Object.entries(state.drawer.fieldErrors || {})) {
      const n = view.querySelector(`[data-err-for="${field}"]`);
      if (n) n.textContent = msg;
    }
  }

  function paintModalErrors() {
    const view = viewEl();
    if (!view || !state.modal) return;
    for (const [field, msg] of Object.entries(state.modal.fieldErrors || {})) {
      const n = view.querySelector(`[data-err-for="m.${field}"]`);
      if (n) n.textContent = msg;
    }
  }

  function syncDrawerState() {
    const view = viewEl();
    const d = state.drawer;
    const n = view?.querySelector('#mktDrawerState');
    if (!n || !d) return;
    if (d.saving) { n.textContent = '保存中…'; return; }
    if (d.conflict) { n.textContent = '检测到并发修改：点「重新载入」更新基线后重试。'; return; }
    if (d.error) { n.textContent = `操作失败：${d.error}（内容已保留，可重试）`; return; }
    if (d.savedAt) { n.textContent = `已保存 · ${fmtTime(d.savedAt)}`; return; }
    n.textContent = d.dirty ? '有未保存的修改' : '';
  }

  function todayStr() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function markDirty() {
    if (!state.dirty) state.dirty = true;
  }

  function syncButtons() {
    const view = viewEl();
    if (!view) return;
    const save = view.querySelector('#mktSave');
    if (save) save.disabled = state.saving;
    const psave = view.querySelector('#mktPriceSave');
    if (psave) psave.disabled = state.pricingSaving;
    const reload = view.querySelector('#mktReload');
    if (reload) reload.disabled = state.reloading;
    for (const v of state.data?.versions || []) {
      if (v.corrupt === true || v.version === state.data?.current) continue;
      const b = view.querySelector(`#mktSetCurrent-${v.version}`);
      if (b) b.disabled = !!state.settingCurrent;
    }
  }

  function syncSaveState() {
    const view = viewEl();
    const n = view?.querySelector('#mktSaveState');
    if (!n) return;
    if (state.saving) { n.textContent = '保存中…'; return; }
    if (state.conflict) {
      n.textContent = '检测到并发修改：点「重新载入」更新基线（本地草稿已保留，不会静默覆盖），再保存即可。';
      return;
    }
    if (state.saveError) {
      n.textContent = `保存失败：${state.saveError}（编辑内容已保留，可重试）`;
      return;
    }
    if (state.savedAt) { n.textContent = `已保存 · ${fmtTime(state.savedAt)}`; return; }
    n.textContent = state.dirty ? '有未保存的修改' : '';
  }

  function syncPriceState() {
    const view = viewEl();
    const n = view?.querySelector('#mktPriceState');
    if (!n) return;
    if (state.pricingSaving) { n.textContent = '保存中…'; return; }
    if (state.priceSaveError) { n.textContent = `保存失败：${state.priceSaveError}（编辑内容已保留，可重试）`; return; }
    if (state.priceSavedAt) { n.textContent = `已保存为新版本 · ${fmtTime(state.priceSavedAt)}`; return; }
    n.textContent = '';
  }

  function paintFieldErrors() {
    const view = viewEl();
    if (!view) return;
    const all = { ...(state.fieldErrors || {}), ...(state.priceFieldErrors || {}) };
    for (const [field, msg] of Object.entries(all)) {
      const n = view.querySelector(`[data-err-for="${field}"]`);
      if (n) n.textContent = msg;
    }
  }

  /* ---------- 进入 / 重置 ---------- */

  async function enter(project) {
    const changed = project !== state.project;
    if (changed) hardReset(project);
    ensureGrowth();
    if (!state.data) {
      await refresh();
      if (state.pendingRestore && state.phase === 'ready') {
        applyPendingRestore();
        render();
      }
      return;
    }
    if (state.pendingRestore && state.phase === 'ready') {
      applyPendingRestore();
      render();
      return;
    }
    if (!state.rendered) render();
  }

  function hardReset(project) {
    state.project = project ?? null;
    state.phase = 'loading';
    state.loadError = null;
    state.initError = null;
    state.busyInit = false;
    state.data = null;
    state.baseRevision = 1;
    state.tab = DEFAULT_TAB;
    state.versionSel = null;
    state.draft = null;
    state.priceDraft = null;
    state.dirty = false;
    state.priceDirty = false;
    state.saving = false;
    state.pricingSaving = false;
    state.reloading = false;
    state.settingCurrent = null;
    state.savedAt = null;
    state.priceSavedAt = null;
    state.saveError = null;
    state.priceSaveError = null;
    state.opError = null;
    state.conflict = false;
    state.fieldErrors = {};
    state.priceFieldErrors = {};
    state.draftFromReadme = false;
    state.rendered = false;
    // 渠道与行动看板按项目隔离
    state.board = null;
    state.boardPhase = 'idle';
    state.boardError = null;
    state.chanFilter = '';
    state.expFilter = '';
    state.narrowStatus = '';
    state.drawer = null;
    state.modal = null;
    state.toast = null;
    state.pendingDrawerId = null;
    // 效果与复盘按项目隔离
    state.effect = null;
    state.effectPhase = 'idle';
    state.effectError = null;
    state.effFrom = '';
    state.effTo = '';
    state.effChan = '';
    state.effExp = '';
    state.effMetric = null;
    // project-growth 按项目隔离（弹层与运行记录随项目切换重置）
    state.growth = null;
    state.growthPhase = 'idle';
    state.growthError = null;
    state.aiPanel = null;
    state.aiRun = null;
    state.aiRunBusy = false;
    state.aiRunError = null;
    state.aiRunNotice = null;
    state.aiEdit = null;
    state.gtoast = null;
    // pendingRestore / pendingSwitch 不清除：刷新恢复与切换守卫跨 enter 存续
  }

  function reset() {
    hardReset(state.project);
    state.pendingRestore = null;
    render();
  }

  /* ---------- 启动绑定（弹窗在 index.html，常驻节点一次性绑定） ---------- */

  function init() {
    $('#mktSwitchSave')?.addEventListener('click', saveAndSwitch);
    $('#mktSwitchDiscard')?.addEventListener('click', discardAndSwitch);
    $('#mktSwitchCancel')?.addEventListener('click', cancelSwitch);
    $('#mktSwitchClose')?.addEventListener('click', cancelSwitch);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const wrap = $('#mktSwitchWrap');
      if (wrap && !wrap.classList.contains('hidden')) cancelSwitch();
      // project-growth 弹层 Esc 关闭（编辑 → 草稿 → 任务面板，逐层）
      if (state.aiEdit) { state.aiEdit = null; render(); return; }
      if (state.aiRun || state.aiRunError) { state.aiRun = null; state.aiRunError = null; state.aiRunNotice = null; render(); return; }
      if (state.aiPanel) { state.aiPanel = null; render(); }
    });
  }
  init();

  // app.js 挂钩：enter（setView 激活）、reset（switchProject 隔离）、hasUnsaved / guardProjectSwitch
  // （项目切换守卫）、discardDraft（放弃）、snapshot / restoreView（REQ-20260910-001 刷新恢复）、
  // draftRevision（测试与调试基线）；refreshBoard / refreshEffect 为看板与效果页读取入口（测试与重试用）
  return {
    enter, refresh, reset, setTab, selectVersion,
    snapshot, restoreView, hasUnsaved, discardDraft,
    guardProjectSwitch, saveNow, draftRevision: () => state.baseRevision,
    refreshBoard, refreshEffect,
  };
})();

window.ATBMarketing = ATBMarketing;
