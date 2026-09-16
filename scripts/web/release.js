'use strict';
// 发布模块前端（REQ-20260910-029，Git 远端 / Apple App Store 发布流水线）—— 由 app.js 在 view=release 时激活。
// 界面：模块内左右分栏——左侧运行列表（目标 / 状态筛选），右侧运行详情（阶段进度 + 概览/阶段日志/产物/操作历史四页签 + 底部操作区）；
// 「＋ 新建发布」为模块内独立入口，打开右侧侧拉面板（先选目标类型再动态渲染字段；网站/网络存储置灰标注首期未开放）。
// 语义边界（与后端一致）：
//   - 发布是实际执行流程：预检（含 dry-run）不触发 push / 上传；启动前必须展示推送 / 发布计划，用户确认即授权该明确计划；
//   - 失败显示失败阶段与原因，重试只重跑未完成操作；等待人工（待人工提审 / 受保护分支）展示待办说明与外部入口；
//   - 取消后续阶段不宣称撤回已发送到远端的操作；刷新 / 服务重启后状态从服务端恢复，新开页面不重复执行已开始的阶段；
//   - 远端地址与凭据一律脱敏展示（服务端已剥离，前端不复原）。
// 状态机：loading → empty（引导 + 配置指引）| ready | error（读取失败重试）。

const ATBRelease = (() => {
  const $ = (s, el = document) => el.querySelector(s);

  const TARGETS = [
    { key: 'git', label: 'Git 远端', enabled: true },
    { key: 'apple', label: 'Apple App Store', enabled: true },
    { key: 'electron', label: '桌面应用（Electron）', enabled: true },
    { key: 'web', label: '网站', enabled: false },
    { key: 'storage', label: '网络存储', enabled: false },
  ];
  const TARGET_LABEL = Object.fromEntries(TARGETS.map((x) => [x.key, x.label]));
  const PLATFORM_LABEL = { mac: 'macOS', win: 'Windows' };
  const chipClass = (target) => (target === 'git' ? 'git' : target === 'apple' ? 'apple' : target === 'electron' ? 'electron' : 'web');
  const STATUS_LABEL = {
    draft: '草稿', prechecking: '预检', running: '进行中', 'waiting-manual': '等待人工',
    succeeded: '成功', failed: '失败', canceled: '已取消',
  };
  const STATUS_ORDER = ['draft', 'prechecking', 'running', 'waiting-manual', 'succeeded', 'failed', 'canceled'];
  const TABS = [['overview', '概览'], ['logs', '阶段日志'], ['artifacts', '产物'], ['history', '操作历史']];

  const state = {
    project: null,
    phase: 'loading', // loading | ready | error
    error: null,
    data: null,       // /api/release/state 最近成功响应
    runId: null,      // 当前选中运行
    tab: 'overview',
    targetFilter: '',
    statusFilter: '',
    detail: null,     // /api/release/run/:id 最近成功响应 { run, logs }
    detailPhase: 'idle',
    newPanel: null,   // { type, values, busy, error, precheckRun }
    planModal: null,  // { runId } 计划确认（用户确认即授权该明确计划）
    pollTimer: null,
    rendered: false,
    pendingRestore: null,
    // REQ-20260915-002 产品发布二级页签（PREL 运行）：与发布流水线共用 #releaseView，
    // 数据独立拉取（/api/product-release/*），互不复用筛选与选中态
    subTab: 'pipeline', // pipeline | product
    product: null,      // { phase, data, error, runId, detail, detailPhase, tab, configOpen, configBusy, configError, planModal }
  };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtTime = (iso) => (iso ? String(iso).replace('T', ' ').slice(0, 19) : '—');

  function api(path, opts = {}) {
    const project = state.project ? `?project=${encodeURIComponent(state.project)}` : '';
    return fetch(`/api/release${path}${project}`, opts);
  }
  const post = (path, body) => api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });

  /* ---------- 数据 ---------- */

  async function refresh({ keepDetail = false } = {}) {
    try {
      const r = await api('/state');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      state.data = data;
      state.phase = 'ready';
      state.error = null;
    } catch (e) {
      state.phase = state.data ? 'ready' : 'error';
      state.error = e.message;
    }
    if (state.runId && !keepDetail) await fetchDetail(state.runId);
    else if (!state.runId) state.detail = null;
    schedulePoll();
    render();
  }

  async function fetchDetail(id) {
    state.runId = id;
    state.detailPhase = 'loading';
    render();
    try {
      const r = await api(`/run/${encodeURIComponent(id)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      state.detail = data;
      state.detailPhase = 'ready';
    } catch (e) {
      state.detail = null;
      state.detailPhase = 'error';
      state.error = e.message;
    }
    render();
  }

  // 活动运行轮询（阶段执行中实时推进；新开页面只读轮询，不触发执行）
  function schedulePoll() {
    if (state.pollTimer) { clearTimeout(state.pollTimer); state.pollTimer = null; }
    const active = state.data?.runs?.some((r) => ['prechecking', 'running'].includes(r.status));
    // REQ-20260915-002：产品发布活动运行同样轮询（当前页签决定刷新哪侧列表）
    const activeProduct = state.product?.data?.runs?.some((r) => ['prechecking', 'running'].includes(r.status));
    if ((active || activeProduct) && state.project) {
      state.pollTimer = setTimeout(async () => {
        if (!state.project) return;
        await refresh();
        if (state.subTab === 'product' && activeProduct) await refreshProduct();
      }, 2500);
    }
  }

  /* ---------- REQ-20260915-002 产品发布（PREL）---------- */

  const P_STATUS_LABEL = {
    draft: '草稿', prechecking: '预检', running: '进行中', 'waiting-manual': '等待人工',
    succeeded: '已发布', failed: '失败', canceled: '已取消',
  };
  const P_TABS = [['overview', '概览'], ['materials', '材料与差异'], ['logs', '日志与证据'], ['links', '发布链接']];
  const TARGET_STATUS_LABEL = { pending: '待执行', running: '进行中', done: '已完成', failed: '失败', canceled: '已取消' };

  const pToast = (m, isErr) => { try { if (typeof window !== 'undefined' && window.toast) window.toast(m, isErr); } catch { /* 测试环境无 toast */ } };

  function defaultProductState() {
    return {
      phase: 'idle', data: null, error: null,
      runId: null, detail: null, detailPhase: 'idle',
      tab: 'overview', configOpen: false, configBusy: false, configError: null,
      planModal: null,
    };
  }
  function ensureProduct() {
    if (!state.product) state.product = defaultProductState();
    return state.product;
  }

  function papi(path, opts = {}) {
    const q = state.project ? `${path.includes('?') ? '&' : '?'}project=${encodeURIComponent(state.project)}` : '';
    return fetch(`/api/product-release${path}${q}`, opts);
  }
  const ppost = (path, body) => papi(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });

  async function refreshProduct() {
    const p = ensureProduct();
    if (!state.project) return;
    try {
      const r = await papi('/state');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      p.data = data;
      p.phase = 'ready';
      p.error = null;
    } catch (e) {
      p.phase = p.data ? 'ready' : 'error';
      p.error = e.message;
    }
    // 首次进入自动选中最新运行（详情区即刻有内容；点击左侧卡片可切换）
    if (!p.runId && p.data?.runs?.length) p.runId = p.data.runs[0].id;
    if (p.runId) await fetchProductDetail(p.runId, { quiet: true });
    else render();
  }

  async function fetchProductDetail(id, { quiet = false } = {}) {
    const p = ensureProduct();
    p.runId = id;
    if (!quiet) { p.detailPhase = 'loading'; render(); }
    try {
      const r = await papi(`/run/${encodeURIComponent(id)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      p.detail = data;
      p.detailPhase = 'ready';
    } catch (e) {
      p.detail = null;
      p.detailPhase = 'error';
      p.error = e.message;
    }
    render();
  }

  async function productAction(id, action) {
    const p = ensureProduct();
    if (!id || !action) return;
    try {
      const r = await ppost(`/run/${encodeURIComponent(id)}/${action}`, {});
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        p.error = data.error || `操作失败（${r.status}）`;
        pToast(`✕ ${p.error}`, true);
        render();
        return;
      }
      if (data.run) {
        p.detail = { run: data.run, logs: p.detail?.logs || {} };
        p.detailPhase = 'ready';
      }
      await refreshProduct();
    } catch (e) {
      p.error = e.message;
      render();
    }
  }

  async function openProductPlan(id) {
    const p = ensureProduct();
    if (!id) return;
    try {
      const r = await papi(`/run/${encodeURIComponent(id)}/plan`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      p.planModal = data.plan || {};
      render();
    } catch (e) {
      pToast(`✕ ${e.message}`, true);
    }
  }

  async function confirmProductStart(id) {
    const p = ensureProduct();
    p.planModal = null;
    if (!id) return;
    await productAction(id, 'start');
  }

  async function saveProductConfig() {
    const p = ensureProduct();
    const input = $('#releaseView')?.querySelector('#relProdHomepageRoot');
    const val = (input?.value || '').trim();
    p.configBusy = true;
    p.configError = null;
    render();
    try {
      const r = await ppost('/config', { homepageRepoRoot: val });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `保存失败（${r.status}）`);
      p.configOpen = false;
      pToast('✓ 官网仓库根目录已保存（后续发布自动带入；旧预检将失效）');
      await refreshProduct();
    } catch (e) {
      p.configError = e.message;
    } finally {
      p.configBusy = false;
      render();
    }
  }

  function pStatusChip(status) {
    const cls = { succeeded: 'st-ok', failed: 'st-fail', running: 'st-run', 'waiting-manual': 'st-wait', prechecking: 'st-run', canceled: 'st-mute' }[status] || 'st-mute';
    return `<span class="st ${cls}">${esc(P_STATUS_LABEL[status] || status)}</span>`;
  }
  const tChip = (st) => `<span class="st ${st === 'done' ? 'st-ok' : st === 'failed' ? 'st-fail' : 'st-mute'}">${esc(TARGET_STATUS_LABEL[st] || st)}</span>`;

  function renderProductConfig() {
    const p = state.product || {};
    const data = p.data || {};
    const cfg = data.config || {};
    const env = data.env || {};
    if (p.configOpen) {
      return `<div class="rel-prod-config bld-release-block" id="relProdConfigBox">
        <strong>官网仓库设置</strong>
        <label class="field">官网仓库根目录（一次配置，后续项目构建与发布复用）
          <input id="relProdHomepageRoot" value="${esc(cfg.homepageRepoRoot || '')}" placeholder="/absolute/path/to/homepage-repo（绝对路径，git 仓库，含 main 分支）"></label>
        ${p.configError ? `<p class="rel-form-err" role="alert">${esc(p.configError)}</p>` : ''}
        <div class="card-acts">
          <button type="button" class="btn small primary" id="relProdConfigSave"${p.configBusy ? ' disabled' : ''}>${p.configBusy ? '保存中…' : '保存'}</button>
          <button type="button" class="btn small" id="relProdConfigCancel"${p.configBusy ? ' disabled' : ''}>取消</button>
        </div>
      </div>`;
    }
    if (!env.homepageConfigured) {
      return `<div class="rel-prod-config rel-empty-mini" role="note">
        <span class="st st-wait">官网仓库未配置</span>
        <span class="muted small">官网与文档为必备目标：先设置仓库根目录，保存后返回继续（草稿保留）。产品内容子目录自动取项目名，目标分支默认 main。</span>
        <button type="button" class="btn small" id="relProdConfigBtn">前往设置</button>
      </div>`;
    }
    return `<div class="rel-prod-config" role="note">
      <span class="muted small">官网仓库根目录：</span><code>${esc(cfg.homepageRoot || cfg.homepageRepoRoot || '')}</code>
      <button type="button" class="btn small quiet" id="relProdConfigBtn">修改</button>
      <span class="muted small">（修改使旧预检失效）</span>
    </div>`;
  }

  function renderProductList() {
    const runs = state.product?.data?.runs || [];
    if (!runs.length) {
      return '<div class="rel-empty-mini muted">暂无产品发布：到「构建」模块的已合并版本点「创建发布」</div>';
    }
    return runs.map((r) => `
      <div class="rel-card${r.id === state.product.runId ? ' sel' : ''}" data-prel-id="${esc(r.id)}" role="button" tabindex="0">
        <div class="t">
          <strong>${esc(r.productId)} · v${esc(r.version)}</strong> ${pStatusChip(r.status)}
        </div>
        <div class="meta">来源 ${esc(r.bldId)} · Web App ${esc(TARGET_STATUS_LABEL[r.targets?.webapp] || r.targets?.webapp)} · 官网 ${esc(TARGET_STATUS_LABEL[r.targets?.site] || r.targets?.site)}${r.extraCount ? ` · 额外提交 ${r.extraCount}` : ''}</div>
        ${r.error?.message ? `<div class="meta err">${esc(String(r.error.message).slice(0, 120))}</div>` : ''}
      </div>`).join('');
  }

  function renderProductDetail() {
    const p = state.product;
    if (!p.runId) return '<div class="rel-detail muted">点击左侧运行查看详情</div>';
    if (p.detailPhase === 'loading') return '<div class="rel-detail">加载中…</div>';
    if (p.detailPhase === 'error' || !p.detail) {
      return `<div class="rel-detail">详情读取失败：${esc(p.error || '')}</div>`;
    }
    const run = p.detail.run;
    const logs = p.detail.logs || {};
    const frozen = run.frozen || {};
    const siteStage = run.stages.find((s) => s.key === 'site-materials')?.result || {};
    const precheckOk = !!run.precheck?.ok;

    const acts = [];
    if (run.status === 'draft') {
      acts.push('<button type="button" class="btn" id="relProdPrecheck">预检</button>');
      acts.push(`<button type="button" class="btn" id="relProdRefreeze" title="main 已前进时按当前 main 重新冻结（旧预检失效后须重新预检）">重新冻结</button>`);
      acts.push(`<button type="button" class="btn primary" id="relProdPlanShow" ${precheckOk ? '' : 'disabled title="请先预检（预检不推送 / 不部署）"'}>预览发布计划</button>`);
    }
    if (run.status === 'failed') {
      acts.push('<button type="button" class="btn warn" id="relProdRetry">重试失败阶段</button>');
      acts.push('<button type="button" class="btn" id="relProdRefreeze">重新冻结</button>');
    }
    if (['prechecking', 'running'].includes(run.status)) {
      acts.push('<button type="button" class="btn" id="relProdCancel">取消后续阶段</button>');
    }
    acts.push('<button type="button" class="btn" id="relProdRefresh">刷新状态</button>');

    const targetCard = (key, label, t) => `
      <div class="rel-target-card" data-target="${key}">
        <strong>${label}</strong> <span class="chip">必备</span> ${tChip(t?.status)}
        <div class="meta small">${t?.localUrl ? `<a href="${esc(t.localUrl)}" target="_blank" rel="noreferrer">${esc(t.localUrl)}</a>` : '本机入口在部署回验通过后生成'}</div>
      </div>`;

    const extraList = (frozen.extraCommits || []);
    const tabBody = {
      overview: `
        <dl class="rel-kv">
          <dt>发行版本</dt><dd>${esc(run.version)}（显示名：${esc(run.versionName || '—')}）</dd>
          <dt>来源版本</dt><dd>${esc(run.bldId)}${run.bldName ? ` · ${esc(run.bldName)}` : ''}</dd>
          <dt>冻结 main</dt><dd><code>${esc(String(frozen.mainSha || '').slice(0, 12))}</code>（构建只使用冻结 main 源码，不从 dev 构建）</dd>
          <dt>冻结 dev</dt><dd><code>${esc(String(frozen.devSha || '').slice(0, 12))}</code></dd>
          <dt>源码远端</dt><dd>${esc(frozen.remote || '—')} → ${esc(frozen.remoteUrl || '—')}（main/dev 一次原子推送）</dd>
          <dt>官网目标</dt><dd>${esc(frozen.homepage?.contentDir || '（未配置）')} · 分支 ${esc(frozen.homepage?.branch || 'main')}</dd>
          <dt>整体状态</dt><dd>${esc(P_STATUS_LABEL[run.status] || run.status)}（Web App 已发布 / 官网已上线分开判定，两目标 + 源码同步全部通过才整体已发布）</dd>
        </dl>
        ${run.precheck ? `<div class="rel-plan"><h4>预检结果（${run.precheck.ok ? '通过' : '未通过'} · ${esc(fmtTime(run.precheck.ranAt))}）</h4>
          <ul>${(run.precheck.checks || []).map((c) => `<li class="${c.ok ? '' : 'err'}">${c.ok ? '✓' : '✕'} ${esc(c.label)}：${esc(c.detail)}</li>`).join('')}</ul></div>` : ''}`,
      materials: `
        <div class="rel-plan"><h4>额外提交（main 相比计划条目，不隐去合并带入的额外变更）</h4>
          ${extraList.length ? `<ul>${extraList.map((c) => `<li><code>${esc(String(c.hash || '').slice(0, 8))}</code> ${esc(c.subject || '')} <span class="muted small">${esc(c.author || '')}</span></li>`).join('')}</ul>` : '<p class="muted">无额外提交</p>'}</div>
        <div class="rel-plan"><h4>官网中英文材料</h4>
          ${siteStage.files?.length
            ? `<p class="muted small">已核验 ${siteStage.files.length} 页（指纹 ${esc(String(siteStage.fingerprint || '').slice(0, 8))}…）；缺失项在预检与本阶段列出并阻塞。</p>`
            : '<p class="muted small">尚未核验（预检或「官网材料核验」阶段执行后展示）。</p>'}
          ${siteStage.missing?.length ? `<ul class="err">${siteStage.missing.map((m) => `<li>缺 ${esc(m.lang)}/${esc(m.page)}.html（${esc(m.label)}）</li>`).join('')}</ul>` : ''}</div>`,
      logs: Object.keys(logs).length
        ? Object.entries(logs).map(([stage, lines]) => `<details class="rel-log"><summary>${esc(stage)}</summary><pre>${esc(lines.join('\n'))}</pre></details>`).join('')
          + ((run.evidence || []).length ? `<h4>证据</h4><ul class="rel-hist">${run.evidence.map((e) => `<li><span class="muted">${esc(fmtTime(e.at))}</span> ${esc(e.kind)}：${esc(e.note)}</li>`).join('')}</ul>` : '')
        : '<p class="muted">暂无阶段日志</p>',
      links: `
        <dl class="rel-kv">
          <dt>Web App（本机）</dt><dd>${run.targets?.webapp?.localUrl ? `<a href="${esc(run.targets.webapp.localUrl)}" target="_blank" rel="noreferrer">${esc(run.targets.webapp.localUrl)}</a>` : '尚未部署回验'}</dd>
          <dt>官网（本机）</dt><dd>${run.targets?.site?.localUrl ? `<a href="${esc(run.targets.site.localUrl)}" target="_blank" rel="noreferrer">${esc(run.targets.site.localUrl)}</a>（中文 /zh · English /en）` : '尚未部署回验'}</dd>
          <dt>源码远端</dt><dd>${esc(frozen.remoteUrl || '—')}（main / dev 双分支）</dd>
        </dl>
        <p class="muted small">本机入口不需要公网 URL；私有仓库路径与完整日志仅保留在本地运行记录。</p>`,
    }[p.tab] || '';

    return `
      <div class="rel-detail">
        <header class="rel-detail-head">
          <div>
            <h3><span class="chip git">产品发布</span> ${esc(run.productId)} · v${esc(run.version)} ${pStatusChip(run.status)}</h3>
            <p class="muted small">${esc(run.id)} · 来源 ${esc(run.bldId)} · 冻结 main ${esc(String(frozen.mainSha || '').slice(0, 8))} / dev ${esc(String(frozen.devSha || '').slice(0, 8))}${extraList.length ? ` · 额外提交 ${extraList.length} 个` : ''}</p>
          </div>
        </header>
        ${extraList.length ? '<p class="meta err small" role="note">main 相比计划条目另有额外提交：发行范围以冻结 main 为准（详见「材料与差异」），不隐去额外变更。</p>' : ''}
        <div class="rel-targets">
          ${targetCard('webapp', 'Web App', run.targets?.webapp)}
          ${targetCard('site', '官网与文档', run.targets?.site)}
        </div>
        ${renderStages(run)}
        <nav class="rel-tabs">${P_TABS.map(([k, label]) => `<button type="button" class="rel-tab${p.tab === k ? ' active' : ''}" data-rel-ptab="${k}">${label}</button>`).join('')}</nav>
        <div class="rel-tab-body">${tabBody}</div>
        <footer class="rel-acts">${acts.join('')}</footer>
      </div>`;
  }

  function renderProductPlanModal() {
    const p = state.product;
    const plan = p?.planModal;
    if (!plan) return '';
    const frozen = plan.frozen || {};
    return `
      <div id="relProdPlanModal" class="rel-modal-wrap" role="dialog" aria-label="发布计划确认（产品发布）">
        <div class="rel-modal">
          <h3>发布计划确认（产品发布）</h3>
          <div class="rel-modal-body">
            <ul>${(plan.steps || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
            ${plan.warning ? `<p class="meta err small" role="note">${esc(plan.warning)}</p>` : ''}
            <p class="muted small">用户启动即授权以上明确操作；变更发布范围（版本 / 路径 / 材料 / 分支头）后须重新预检并确认新计划。预检不推送、不上传、不部署。</p>
          </div>
          <footer class="modal-foot">
            <button type="button" class="btn" id="relProdPlanCancel">取消</button>
            <button type="button" class="btn primary" id="relProdPlanConfirm">确认启动发布</button>
          </footer>
        </div>
      </div>`;
  }

  function renderProductView() {
    const p = ensureProduct();
    if (p.phase === 'loading') return '<div class="rel-loading muted">加载中…</div>';
    if (p.phase === 'error' && !p.data) {
      return `<div class="rel-error"><p>产品发布读取失败：${esc(p.error || '')}</p>
        <button type="button" class="btn" id="relProdRetryLoad">重试</button></div>`;
    }
    const runs = p.data?.runs || [];
    let emptyBlock = '';
    if (!runs.length) {
      emptyBlock = `<div class="rel-empty">
        <h3>还没有产品发布</h3>
        <p class="muted">从「构建」模块的已合并版本点「创建发布」：冻结 main/dev → 预检 → 预览计划 → 启动（源码双分支同步 → Web App 本机部署 → 官网双语上线，逐目标回验）。</p>
      </div>`;
    }
    return `
      ${renderProductConfig()}
      ${emptyBlock || `
      <div class="rel-split">
        <div class="rel-list rel-prod-list" aria-label="产品发布运行列表">${renderProductList()}</div>
        ${renderProductDetail()}
      </div>`}
      ${renderProductPlanModal()}`;
  }

  async function showProduct() {
    state.subTab = 'product';
    const p = ensureProduct();
    if (p.phase === 'idle' || p.phase === 'error') {
      p.phase = 'loading';
      render();
      await refreshProduct();
    } else {
      render();
    }
  }

  /* ---------- 渲染 ---------- */

  function runSummaryLine(run) {
    const bits = [];
    if (run.target === 'git') bits.push(`源 ${run.sourceOid ? run.sourceOid.slice(0, 8) : '—'}`);
    if (run.target === 'electron') bits.push(`输出 ${(run.config || {}).outDir || 'dist'}`);
    if (run.version) bits.push(`版本 ${run.version}`);
    bits.push(`创建 ${fmtTime(run.createdAt)}`);
    return bits.join(' · ');
  }

  function statusChip(status) {
    const cls = { succeeded: 'st-ok', failed: 'st-fail', running: 'st-run', 'waiting-manual': 'st-wait', prechecking: 'st-run', canceled: 'st-mute' }[status] || 'st-mute';
    return `<span class="st ${cls}">${esc(STATUS_LABEL[status] || status)}</span>`;
  }

  function filteredRuns() {
    const runs = state.data?.runs || [];
    return runs.filter((r) => (!state.targetFilter || r.target === state.targetFilter)
      && (!state.statusFilter || r.status === state.statusFilter));
  }

  function renderList() {
    const runs = filteredRuns();
    if (!runs.length) {
      return `<div class="rel-empty-mini muted">当前筛选下没有运行</div>`;
    }
    return runs.map((r) => `
      <div class="rel-card${r.id === state.runId ? ' sel' : ''}" data-run-id="${esc(r.id)}" role="button" tabindex="0">
        <div class="t">
          <span class="chip ${chipClass(r.target)}">${esc(TARGET_LABEL[r.target] || r.target)}</span>
          <strong>${esc(r.label || r.id)}</strong>
          ${statusChip(r.status)}
          ${r.simulated ? '<span class="chip sim" title="适配器模拟运行（不表述为真实上传成功）">模拟</span>' : ''}
        </div>
        <div class="meta">${esc(runSummaryLine(r))}</div>
        ${r.error ? `<div class="meta err">${esc(r.error.message || '').slice(0, 120)}</div>` : ''}
      </div>`).join('');
  }

  function renderStages(run) {
    return `<div class="rel-stages">${run.stages.map((s) => {
      const icon = s.status === 'done' ? '✓' : s.status === 'running' ? '◉' : s.status === 'failed' ? '✕' : s.status === 'skipped' ? '–' : '○';
      const cls = `st-${s.status}`;
      const err = s.status === 'failed' && s.error ? `<div class="rel-stage-err">${esc(s.error.message)}</div>` : '';
      const extra = s.key === 'review-data' && s.result?.ascEntry && run.status === 'waiting-manual'
        ? `<div class="rel-stage-err wait">待人工提审：请到 App Store Connect 手动提交审核（模块不代为提审）</div>` : '';
      return `<div class="rel-stage ${cls}"><span class="ic">${icon}</span> ${esc(s.label)}${err}${extra}</div>`;
    }).join('')}</div>`;
  }

  function renderDetail() {
    if (!state.runId) {
      return '<div class="rel-detail muted">点击左侧运行查看详情</div>';
    }
    if (state.detailPhase === 'loading') return '<div class="rel-detail">加载中…</div>';
    if (state.detailPhase === 'error' || !state.detail) {
      return `<div class="rel-detail">详情读取失败：${esc(state.error || '')}</div>`;
    }
    const run = state.detail.run;
    const logs = state.detail.logs || {};
    const plan = run.stages.find((s) => s.key === 'plan')?.result || null;
    const rd = run.stages.find((s) => s.key === 'review-data')?.result || null;
    const track = run.stages.find((s) => s.key === 'track')?.result || null;
    const elVerify = run.target === 'electron' ? run.stages.find((s) => s.key === 'verify')?.result || null : null;

    // 底部操作区按状态出现
    const acts = [];
    if (run.status === 'draft') {
      acts.push('<button type="button" class="btn" id="relActPrecheck">预检</button>');
      const planReady = run.stages.find((s) => s.key === 'plan')?.status === 'done'
        || (run.target === 'apple' && run.stages.find((s) => s.key === 'materials')?.status === 'done')
        || (run.target === 'electron' && run.stages.find((s) => s.key === 'local-precheck')?.status === 'done');
      acts.push(`<button type="button" class="btn primary" id="relActStart" ${planReady ? '' : 'disabled'} title="${planReady ? '启动前展示发布 / 推送 / 构建计划供确认' : '请先预检（预检不推送 / 不上传 / 不构建）'}">启动发布</button>`);
    }
    if (run.status === 'failed') acts.push('<button type="button" class="btn warn" id="relActRetry">重试失败阶段</button>');
    if (['prechecking', 'running'].includes(run.status)) acts.push('<button type="button" class="btn" id="relActCancel">取消后续阶段</button>');
    if (run.target === 'apple' && (run.status === 'waiting-manual' || run.status === 'succeeded')) {
      const url = (track?.ascEntry || rd?.ascEntry || 'https://appstoreconnect.apple.com');
      acts.push(`<a class="btn" id="relActAsc" href="${esc(url)}" target="_blank" rel="noreferrer">打开 ASC</a>`);
    }
    acts.push('<button type="button" class="btn" id="relActRefresh">刷新状态</button>');

    const tabBody = {
      overview: `
        <dl class="rel-kv">
          <dt>目标</dt><dd>${esc(TARGET_LABEL[run.target] || run.target)}${run.simulated ? '（适配器模拟运行，不表述为真实上传成功）' : ''}</dd>
          <dt>${run.target === 'git' ? '源提交' : run.target === 'electron' ? '源提交 / 版本' : '版本'}</dt><dd>${esc(run.target === 'git' ? (run.frozen?.sourceOid || '—') : run.target === 'electron' ? `${run.frozen?.sourceOid || '—'} / ${run.frozen?.version || run.config.version || '—'}` : `${run.config.version} (${run.config.build})`)}</dd>
          ${run.target === 'electron' ? `<dt>平台与架构</dt><dd>${esc((run.config.platforms || []).map((p) => PLATFORM_LABEL[p] || p).join(' + '))} · mac ${esc(run.frozen?.macArch || run.config.macArch || '自动')} / win x64 · 输出 ${esc(run.config.outDir || 'dist')}</dd>` : ''}
          <dt>状态</dt><dd>${esc(STATUS_LABEL[run.status] || run.status)}</dd>
          <dt>创建时间</dt><dd>${esc(fmtTime(run.createdAt))}</dd>
          ${run.parentId ? `<dt>关联运行</dt><dd>${esc(run.parentId)}（被拒修订）</dd>` : ''}
        </dl>
        ${plan ? `<div class="rel-plan"><h4>发布计划</h4><ul>${(plan.commits || []).map((c) => `<li>${esc(c)}</li>`).join('') || '<li class="muted">无待推送提交</li>'}</ul>
          <p class="muted small">目标 ${esc(run.config.targetBranch)}${run.config.tagName ? ` · 标签 ${esc(run.config.tagName)}` : ''}${plan.atomic ? ' · atomic' : ''}</p></div>` : ''}
        ${track?.reviewStateLabel ? `<p>审核状态：<strong>${esc(track.reviewStateLabel)}</strong>${track.rejectionNotes ? `（原因保留：${esc(track.rejectionNotes)}）` : ''}</p>` : ''}
        ${run.target === 'electron' ? `<p class="muted small">产物仅存本地（${esc(run.config.outDir || 'dist')}，不上传分发）；未配置签名证书，产物为「未签名」。</p>` : ''}
      `,
      logs: Object.keys(logs).length
        ? Object.entries(logs).map(([stage, lines]) => `<details class="rel-log" open><summary>${esc(stage)}</summary><pre>${esc(lines.join('\n'))}</pre></details>`).join('')
        : '<p class="muted">暂无阶段日志</p>',
      artifacts: (() => {
        if (run.target === 'electron') {
          const arts = elVerify?.artifacts;
          if (!arts || !arts.length) return '<p class="muted">无构建产物（尚未构建 / 构建失败）：构建成功后此处列出 macOS 应用包与 Windows 安装包清单。</p>';
          const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`);
          return `<ul class="rel-arts">${arts.map((a) => `
            <li>
              <div class="rel-art-name">${esc(a.fileName)} <span class="chip sim" title="未配置签名证书（首期不做签名 / 公证）">未签名</span></div>
              <div class="meta">${esc(PLATFORM_LABEL[a.platform] || a.platform)} ${esc(a.arch || '')} · ${fmtSize(a.sizeBytes || 0)} · sha256 ${esc(String(a.sha256 || '').slice(0, 12))}…</div>
              <div class="meta">源提交 ${esc(String(a.sourceOid || '').slice(0, 10))} · electron ${esc(a.electronVersion || '?')} · electron-builder ${esc(a.builderVersion || '?')}</div>
              <div class="meta small">${esc(a.path)}</div>
            </li>`).join('')}</ul>`;
        }
        const b = run.stages.find((s) => s.key === 'build')?.result;
        if (!b?.artifact) return '<p class="muted">无构建产物（Git 发布无产物 / Apple 尚未构建）</p>';
        return `<dl class="rel-kv"><dt>产物路径</dt><dd>${esc(b.artifact.path)}</dd><dt>摘要</dt><dd>${esc(b.artifact.digest)}</dd>
          <dt>源提交</dt><dd>${esc(b.sourceOid || '—')}</dd><dt>构建身份</dt><dd>${esc(b.identity || '')}</dd><dt>Xcode</dt><dd>${esc(b.xcodeVersion || '—')}</dd></dl>`;
      })(),
      history: (run.history || []).length
        ? `<ul class="rel-hist">${run.history.map((h) => `<li><span class="muted">${esc(fmtTime(h.at))}</span> ${esc(h.action)}${h.by ? ` · ${esc(h.by)}` : ''}${h.note ? ` · ${esc(h.note)}` : ''}</li>`).join('')}</ul>`
        : '<p class="muted">暂无操作历史</p>',
    }[state.tab] || '';

    return `
      <div class="rel-detail">
        <header class="rel-detail-head">
          <div>
            <h3><span class="chip ${chipClass(run.target)}">${esc(TARGET_LABEL[run.target] || run.target)}</span> ${esc(runLabel(run))} ${statusChip(run.status)}</h3>
            <p class="muted small">${esc(runSummaryLine(run))}</p>
          </div>
        </header>
        ${renderStages(run)}
        <nav class="rel-tabs">${TABS.map(([k, label]) => `<button type="button" class="rel-tab${state.tab === k ? ' active' : ''}" data-rel-tab="${k}">${label}</button>`).join('')}</nav>
        <div class="rel-tab-body">${tabBody}</div>
        <footer class="rel-acts">${acts.join('')}</footer>
      </div>`;
  }

  function runLabel(run) {
    if (run.target === 'git') return `${run.config.remote || '?'} → ${run.config.targetBranch || '?'}`;
    if (run.target === 'electron') {
      const name = run.frozen?.appName || run.config.appName || '桌面应用';
      const plats = (run.config.platforms || []).map((p) => PLATFORM_LABEL[p] || p).join(' + ');
      return `${name} ${run.frozen?.version || run.config.version || '?'}${plats ? ` · ${plats}` : ''}`;
    }
    return `${run.config.version || '?'} (${run.config.build || '?'})`;
  }

  function gitFields(v = {}) {
    return `
      <label class="field">remote
        <input id="relNewRemote" value="${esc(v.remote || '')}" placeholder="origin（已配置的远端名）"></label>
      <label class="field">源分支
        <input id="relNewSourceBranch" value="${esc(v.sourceBranch || '')}" placeholder="main"></label>
      <label class="field">目标分支
        <input id="relNewTargetBranch" value="${esc(v.targetBranch || '')}" placeholder="main"></label>
      <label class="field">版本标签（可选）
        <input id="relNewTagName" value="${esc(v.tagName || '')}" placeholder="v1.2.0（须已创建并指向发布提交）"></label>
      <label class="field">项目校验命令
        <input id="relNewCheckCommand" value="${esc(v.checkCommand || '')}" placeholder="npm test（在冻结提交的隔离工作目录执行）"></label>`;
  }

  function appleFields(v = {}) {
    return `
      <label class="field">Xcode project / workspace
        <input id="relNewProject" value="${esc(v.projectPath || '')}" placeholder="App.xcodeproj"></label>
      <label class="field">scheme
        <input id="relNewScheme" value="${esc(v.scheme || '')}" placeholder="App"></label>
      <label class="field">平台
        <select id="relNewPlatform">
          <option value="ios"${v.platform === 'ios' ? ' selected' : ''}>iOS</option>
          <option value="macos"${v.platform === 'macos' ? ' selected' : ''}>macOS</option>
        </select></label>
      <label class="field">target（多 target 时必选）
        <input id="relNewTarget" value="${esc(v.target || '')}" placeholder="留空按唯一 target；多 target 匹配歧义将阻塞"></label>
      <label class="field">版本号 version
        <input id="relNewVersion" value="${esc(v.version || '')}" placeholder="1.2.0"></label>
      <label class="field">build 号
        <input id="relNewBuild" value="${esc(v.build || '')}" placeholder="42"></label>`;
  }

  // REQ-20260910-030 桌面应用（Electron）字段：平台多选（实时反映到预检与构建计划）、mac 架构、版本、输出目录
  function electronFields(v = {}) {
    const env = state.data?.env?.electron || {};
    const platforms = Array.isArray(v.platforms) && v.platforms.length ? v.platforms : ['mac'];
    const macArch = v.macArch || env.macArchDefault || 'arm64';
    return `
      <fieldset class="field-group"><legend>目标平台（可多选）</legend>
        <label class="check"><input type="checkbox" id="relNewPlatMac"${platforms.includes('mac') ? ' checked' : ''}> macOS 应用包（dmg）</label>
        <label class="check"><input type="checkbox" id="relNewPlatWin"${platforms.includes('win') ? ' checked' : ''}> Windows 安装包（nsis）</label>
      </fieldset>
      <label class="field">macOS 架构
        <select id="relNewMacArch">
          <option value="arm64"${macArch === 'arm64' ? ' selected' : ''}>arm64（Apple Silicon）</option>
          <option value="x64"${macArch === 'x64' ? ' selected' : ''}>x64（Intel）</option>
          <option value="universal"${macArch === 'universal' ? ' selected' : ''}>universal（通用）</option>
        </select></label>
      <label class="field">版本号
        <input id="relNewVersion" value="${esc(v.version ?? env.version ?? '')}" placeholder="${esc(env.version || '0.1.0')}（默认取项目 package.json version）"></label>
      <label class="field">输出目录
        <input id="relNewOutDir" value="${esc(v.outDir || 'dist')}" placeholder="dist（项目根下相对路径）"></label>
      ${env.appName ? `<p class="muted small">对当前项目构建：${esc(env.appName)}（${env.depsOk && env.buildConfigOk ? 'Electron 工程与构建配置就绪' : '预检将给出工程指引'}）</p>` : ''}`;
  }

  function renderNewPanel() {
    if (!state.newPanel) return '';
    const p = state.newPanel;
    const fields = p.type === 'git' ? gitFields(p.values) : p.type === 'apple' ? appleFields(p.values) : p.type === 'electron' ? electronFields(p.values) : '';
    return `
      <div class="rel-panel-mask" id="relPanelMask"></div>
      <aside class="rel-panel" role="dialog" aria-label="新建发布">
        <header class="rel-panel-head">
          <h3>新建发布</h3>
          <button type="button" class="icon-btn" id="relNewClose" aria-label="关闭新建发布面板">✕</button>
        </header>
        <div class="rel-panel-body">
          <label class="field">目标类型
            <select id="relNewType">
              ${TARGETS.map((t) => `<option value="${t.key}"${p.type === t.key ? ' selected' : ''}${t.enabled ? '' : ' disabled'}>${t.label}${t.enabled ? '' : '（首期未开放）'}</option>`).join('')}
            </select></label>
          <div id="relNewFields">${fields}</div>
          ${p.error ? `<p class="rel-form-err" role="alert">${esc(p.error)}</p>` : ''}
          ${p.precheckRun ? `<div class="rel-plan"><h4>预检结果（不推送 / 不上传）</h4>
            <p>${esc(p.precheckRun.stages.filter((s) => s.status === 'done').length)} 个只读阶段通过；启动前将展示完整计划供确认。</p></div>` : ''}
        </div>
        <footer class="rel-panel-foot">
          <button type="button" class="btn" id="relNewSave" ${p.busy ? 'disabled' : ''}>保存草稿</button>
          <button type="button" class="btn" id="relNewPrecheck" ${p.busy ? 'disabled' : ''}>预检</button>
          <button type="button" class="btn primary" id="relNewStart" ${p.busy || !p.precheckRun ? 'disabled' : ''}>启动发布</button>
        </footer>
      </aside>`;
  }

  function renderPlanModal() {
    // 节点常驻（关闭时 hidden）：计划确认弹层——启动前展示推送 / 发布 / 构建计划，确认即授权该明确计划
    const run = state.planModal?.run || null;
    const plan = run?.stages?.find((s) => s.key === 'plan')?.result;
    const appleReady = run && run.stages.filter((s) => ['locate', 'env-credentials', 'materials'].includes(s.key)).every((s) => s.status === 'done');
    const electronReady = run && run.target === 'electron' && run.stages.find((s) => s.key === 'local-precheck')?.status === 'done';
    let body = '<p class="muted">计划尚不完整（请先预检）</p>';
    if (run && run.target === 'git' && plan) {
      body = `<ul>${(plan.commits || []).map((c) => `<li>${esc(c)}</li>`).join('') || '<li>无待推送提交</li>'}</ul>
         <p>目标分支 <strong>${esc(run.config.targetBranch)}</strong>${run.config.tagName ? ` · 标签 <strong>${esc(run.config.tagName)}</strong>` : ''}${plan.atomic ? ' · 分支与标签 atomic 同批' : ''}</p>
         <p class="muted small">校验「${esc(run.config.checkCommand)}」已通过；只推送以上选定引用（默认仅快进）。确认启动即授权本计划；执行中输入变化将使计划失效并阻塞。</p>`;
    } else if (run && run.target === 'apple' && appleReady) {
      body = `<p>版本 <strong>${esc(run.config.version)} (${esc(run.config.build)})</strong> · ${esc(run.config.scheme)}（${esc(run.config.platform)}）</p>
           <p class="muted small">将执行构建、上传 TestFlight、提审前检查与审核数据准备；完成后停在「待人工提审」，最终提审由你在 ASC 手动操作。</p>`;
    } else if (run && electronReady) {
      const plats = (run.frozen?.platforms || run.config.platforms || []).map((p) => PLATFORM_LABEL[p] || p);
      const macArch = run.frozen?.macArch || run.config.macArch || 'arm64';
      body = `<p>${esc(run.frozen?.appName || run.config.appName || '桌面应用')} <strong>${esc(run.frozen?.version || run.config.version || '?')}</strong> · ${plats.map((p) => `<strong>${esc(p)}</strong>`).join(' + ')}</p>
           <p class="muted small">mac 架构 ${esc(macArch)} · Windows x64 · 输出目录 ${esc(run.config.outDir || 'dist')}；冻结源提交 ${esc(String(run.frozen?.sourceOid || '').slice(0, 10))}（在冻结提交的隔离工作目录安装依赖并构建）。</p>
           <p class="muted small"><strong>产物未签名</strong>（未配置签名证书，首期不做签名 / 公证）；产物仅存本地，不自动上传分发。确认启动即授权本计划；执行中源提交变化将使计划失效并阻塞。</p>`;
    }
    return `
      <div id="relPlanModal" class="rel-modal-wrap${run ? '' : ' hidden'}" role="dialog" aria-label="发布计划确认">
        <div class="rel-modal">
          <h3>发布计划确认</h3>
          <div class="rel-modal-body">${body}</div>
          <footer class="modal-foot">
            <button type="button" class="btn" id="relPlanCancel">取消</button>
            <button type="button" class="btn primary" id="relPlanConfirm">确认启动发布</button>
          </footer>
        </div>
      </div>`;
  }

  function render() {
    const view = $('#releaseView');
    if (!view) return;
    if (state.phase === 'loading') {
      view.innerHTML = '<div class="rel-loading muted">加载中…</div>';
      state.rendered = true;
      return;
    }
    if (state.phase === 'error' && !state.data) {
      view.innerHTML = `<div class="rel-error"><p>发布模块读取失败：${esc(state.error || '')}</p>
        <button type="button" class="btn" id="relRetryLoad">重试</button></div>`;
      bindCommon(view);
      state.rendered = true;
      return;
    }
    const runs = state.data?.runs || [];
    const env = state.data?.env || { git: {}, apple: {}, electron: {} };
    // REQ-20260915-002 模块内二级页签：发布流水线（REL）/ 产品发布（PREL）
    const subTabs = `
      <nav class="rel-tabs" aria-label="发布模块子页签">
        <button type="button" class="rel-tab${state.subTab === 'pipeline' ? ' active' : ''}" data-rel-subtab="pipeline">发布流水线</button>
        <button type="button" class="rel-tab${state.subTab === 'product' ? ' active' : ''}" data-rel-subtab="product">产品发布</button>
      </nav>`;
    if (state.subTab === 'product') {
      view.innerHTML = `${subTabs}${renderProductView()}`;
      bindCommon(view);
      state.rendered = true;
      return;
    }
    let emptyBlock = '';
    if (!runs.length) {
      const hints = [];
      if (env.git && env.git.repo === false) hints.push('当前项目不是 Git 仓库或未配置 remote：Git 发布需先配置远端（git remote add …）');
      else if (env.git && Array.isArray(env.git.remotes) && !env.git.remotes.length) hints.push('未配置 Git remote：Git 远端发布需先在仓库配置远端地址');
      if (env.apple && env.apple.ascConfigured === false) hints.push('ASC 凭据未配置：Apple 发布需 ~/.appstoreconnect/config.json（含 key id / issuer id / 私钥路径；内容不进入看板）');
      if (env.electron && env.electron.packageJson && !env.electron.depsOk) hints.push('桌面构建需 package.json 声明 electron 与 electron-builder 依赖（预检将给出指引）');
      if (env.electron && env.electron.packageJson && env.electron.depsOk && env.electron.buildConfigOk === false) hints.push('桌面构建缺 electron-builder 配置：请在 package.json 增加 build 字段（appId / files / mac / win）');
      emptyBlock = `
        <div class="rel-empty">
          <h3>还没有发布运行</h3>
          <p class="muted">发布模块以可恢复、可追溯的流水线推送 Git 远端、发布 Apple App Store 构建、构建桌面应用（macOS 应用包与 Windows 安装包）：预检 → 计划确认 → 执行 → 结果核验。</p>
          ${hints.length ? `<ul class="rel-hints">${hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
          <!-- BUG-20260911-003：空态入口用独立 id（不得与工具栏 #relNewBtn 重复，重复 id 会导致只绑首个入口） -->
          <button type="button" class="btn primary" id="relEmptyNewBtn">＋ 新建发布</button>
        </div>`;
    }
    view.innerHTML = `
      ${subTabs}
      <div class="release-toolbar">
        <select id="relFilterTarget" title="按目标类型筛选" aria-label="目标类型筛选">
          <option value="">全部目标</option>
          ${TARGETS.filter((t) => t.enabled).map((t) => `<option value="${t.key}"${state.targetFilter === t.key ? ' selected' : ''}>${t.label}</option>`).join('')}
        </select>
        <select id="relFilterStatus" title="按状态筛选" aria-label="状态筛选">
          <option value="">全部状态</option>
          ${STATUS_ORDER.map((s) => `<option value="${s}"${state.statusFilter === s ? ' selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
        </select>
        <button type="button" class="btn primary" id="relNewBtn">＋ 新建发布</button>
      </div>
      ${emptyBlock || `
      <div class="rel-split">
        <div class="rel-list" aria-label="发布运行列表">${renderList()}</div>
        ${renderDetail()}
      </div>`}
      ${renderNewPanel()}
      ${renderPlanModal()}`;
    // 兼容子节点同步：测试接缝与真实浏览器一致（innerHTML 已含同样内容，重复赋值幂等）
    if (state.newPanel) {
      const f = view.querySelector('#relNewFields');
      if (f) f.innerHTML = state.newPanel.type === 'git' ? gitFields(state.newPanel.values)
        : state.newPanel.type === 'electron' ? electronFields(state.newPanel.values)
        : appleFields(state.newPanel.values);
    }
    bindCommon(view);
    state.rendered = true;
  }

  function bindCommon(view) {
    // 动态渲染节点的绑定一律走视图内查询（innerHTML 重渲染后节点重建，绑定随之刷新）
    const q = (s) => view.querySelector(s);
    q('#relRetryLoad')?.addEventListener('click', () => refresh());
    // 新建发布双入口（BUG-20260911-003）：工具栏 #relNewBtn 与空态卡 #relEmptyNewBtn 是两个节点，
    // 绑定同一打开动作。此前两处重复输出同一 id 且 querySelector 只绑文档序首个，空态入口点击无反应。
    const openNewPanel = () => {
      state.newPanel = { type: 'git', values: { sourceBranch: state.data?.env?.git?.currentBranch || '' }, busy: false, error: null, precheckRun: null };
      render();
    };
    q('#relNewBtn')?.addEventListener('click', openNewPanel);
    q('#relEmptyNewBtn')?.addEventListener('click', openNewPanel);
    const selT = q('#relFilterTarget');
    selT?.addEventListener('change', () => { state.targetFilter = selT.value; render(); });
    const selS = q('#relFilterStatus');
    selS?.addEventListener('change', () => { state.statusFilter = selS.value; render(); });
    const list = q('.rel-list');
    list?.addEventListener('click', (e) => {
      const card = e.target?.closest?.('[data-run-id]');
      if (card?.dataset?.runId) {
        state.tab = 'overview';
        fetchDetail(card.dataset.runId);
      }
    });

    // 详情操作区（按状态出现的按钮）
    q('#relActPrecheck')?.addEventListener('click', () => actionRun(state.runId, 'precheck'));
    q('#relActStart')?.addEventListener('click', () => openPlanModal(state.runId));
    q('#relActRetry')?.addEventListener('click', () => actionRun(state.runId, 'retry'));
    q('#relActCancel')?.addEventListener('click', async () => {
      if (!state.runId) return;
      await post('/run/cancel', { id: state.runId });
      await refresh({ keepDetail: true });
      if (state.runId) await fetchDetail(state.runId);
    });
    q('#relActRefresh')?.addEventListener('click', async () => {
      if (!state.runId) return;
      await post('/run/refresh', { id: state.runId });
      await fetchDetail(state.runId);
      await refresh({ keepDetail: true });
    });

    // 详情页签
    for (const [k] of TABS) {
      q(`[data-rel-tab="${k}"]`)?.addEventListener('click', () => {
        state.tab = k;
        render();
      });
    }

    // 新建面板
    q('#relNewClose')?.addEventListener('click', closePanel);
    q('#relPanelMask')?.addEventListener('click', closePanel);
    const typeSel = q('#relNewType');
    typeSel?.addEventListener('change', () => {
      state.newPanel.type = typeSel.value;
      state.newPanel.values = {};
      state.newPanel.precheckRun = null;
      render();
    });
    q('#relNewSave')?.addEventListener('click', () => submitNew('save'));
    q('#relNewPrecheck')?.addEventListener('click', () => submitNew('precheck'));
    q('#relNewStart')?.addEventListener('click', () => {
      const p = state.newPanel;
      if (!p?.precheckRun) return;
      state.planModal = { run: p.precheckRun };
      render();
    });

    // REQ-20260915-002 产品发布页签与操作
    for (const el of view.querySelectorAll('[data-rel-subtab]')) {
      el.addEventListener('click', () => {
        const tab = el.dataset.relSubtab;
        state.subTab = tab;
        if (tab === 'product' && (!state.product || ['idle', 'error'].includes(state.product.phase))) {
          showProduct();
        } else {
          render();
        }
      });
    }
    q('#relProdRetryLoad')?.addEventListener('click', () => { const p = ensureProduct(); p.phase = 'loading'; render(); refreshProduct(); });
    q('#relProdConfigBtn')?.addEventListener('click', () => { const p = ensureProduct(); p.configOpen = true; p.configError = null; render(); });
    q('#relProdConfigSave')?.addEventListener('click', saveProductConfig);
    q('#relProdConfigCancel')?.addEventListener('click', () => { const p = ensureProduct(); p.configOpen = false; p.configError = null; render(); });
    const plist = q('.rel-prod-list');
    plist?.addEventListener('click', (e) => {
      const card = e.target?.closest?.('[data-prel-id]');
      if (card?.dataset?.prelId) {
        const p = ensureProduct();
        p.tab = 'overview';
        fetchProductDetail(card.dataset.prelId);
      }
    });
    for (const [k] of P_TABS) {
      q(`[data-rel-ptab="${k}"]`)?.addEventListener('click', () => { state.product.tab = k; render(); });
    }
    q('#relProdPrecheck')?.addEventListener('click', () => productAction(state.product?.runId, 'precheck'));
    q('#relProdRefreeze')?.addEventListener('click', () => productAction(state.product?.runId, 'refreeze'));
    q('#relProdRetry')?.addEventListener('click', () => productAction(state.product?.runId, 'retry'));
    q('#relProdCancel')?.addEventListener('click', () => productAction(state.product?.runId, 'cancel'));
    q('#relProdRefresh')?.addEventListener('click', () => { const id = state.product?.runId; if (id) fetchProductDetail(id); refreshProduct(); });
    q('#relProdPlanShow')?.addEventListener('click', () => openProductPlan(state.product?.runId));
    q('#relProdPlanCancel')?.addEventListener('click', () => { state.product.planModal = null; render(); });
    q('#relProdPlanConfirm')?.addEventListener('click', () => confirmProductStart(state.product?.runId));

    // 计划确认（用户确认即授权该明确计划）
    q('#relPlanCancel')?.addEventListener('click', () => { state.planModal = null; render(); });
    q('#relPlanConfirm')?.addEventListener('click', async () => {
      const target = state.planModal?.run?.id;
      state.planModal = null;
      if (!target) return;
      const r = await post('/run/start', { id: target });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        state.error = data.error || '启动失败';
      }
      state.runId = target;
      await refresh({ keepDetail: true });
      await fetchDetail(target);
    });
  }

  function closePanel() {
    state.newPanel = null;
    render();
  }

  function collectNewValues() {
    const view = $('#releaseView');
    const q = (s) => view.querySelector(s);
    const p = state.newPanel;
    if (p.type === 'git') {
      return {
        remote: q('#relNewRemote')?.value?.trim() || '',
        sourceBranch: q('#relNewSourceBranch')?.value?.trim() || '',
        targetBranch: q('#relNewTargetBranch')?.value?.trim() || '',
        tagName: q('#relNewTagName')?.value?.trim() || '',
        checkCommand: q('#relNewCheckCommand')?.value?.trim() || '',
      };
    }
    if (p.type === 'electron') {
      // 平台多选实时反映到预检结果与构建计划（只勾 macOS 则计划只含 macOS）
      const platforms = [];
      if (q('#relNewPlatMac')?.checked) platforms.push('mac');
      if (q('#relNewPlatWin')?.checked) platforms.push('win');
      return {
        platforms,
        macArch: q('#relNewMacArch')?.value || '',
        version: q('#relNewVersion')?.value?.trim() || '',
        outDir: q('#relNewOutDir')?.value?.trim() || 'dist',
        appName: state.data?.env?.electron?.appName || '',
      };
    }
    return {
      projectPath: q('#relNewProject')?.value?.trim() || '',
      scheme: q('#relNewScheme')?.value?.trim() || '',
      platform: q('#relNewPlatform')?.value || 'ios',
      target: q('#relNewTarget')?.value?.trim() || '',
      version: q('#relNewVersion')?.value?.trim() || '',
      build: q('#relNewBuild')?.value?.trim() || '',
    };
  }

  async function submitNew(mode) {
    const p = state.newPanel;
    if (!p) return;
    p.values = collectNewValues();
    p.busy = true;
    p.error = null;
    render();
    try {
      let r = await post('/run', { target: p.type, config: p.values });
      let data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.fields ? Object.values(data.fields).join('；') : (data.error || '创建失败'));
      const run = data.run;
      if (mode === 'precheck' || mode === 'start') {
        r = await post('/run/precheck', { id: run.id });
        data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || '预检失败');
        // 轮询预检结果（只读阶段；失败展示原因）
        for (let i = 0; i < 100; i++) {
          const rr = await api(`/run/${encodeURIComponent(run.id)}`);
          const dd = await rr.json().catch(() => ({}));
          const st = dd.run?.status;
          const failed = dd.run?.stages?.find((s) => s.status === 'failed');
          if (st === 'failed' && failed) throw new Error(`预检失败（${failed.label}）：${failed.error?.message || ''}`);
          if (st === 'draft' && dd.run?.stages?.find((s) => s.key === (p.type === 'git' ? 'plan' : p.type === 'electron' ? 'local-precheck' : 'materials'))?.status === 'done') {
            p.precheckRun = dd.run;
            break;
          }
          await new Promise((res) => setTimeout(res, 500));
        }
        if (!p.precheckRun) throw new Error('预检超时：请稍后刷新查看');
        state.runId = run.id;
        state.detail = { run: p.precheckRun, logs: {} };
        state.detailPhase = 'ready';
      }
      await refresh({ keepDetail: true });
    } catch (e) {
      p.error = e.message;
    } finally {
      p.busy = false;
      render();
    }
  }

  async function actionRun(id, action) {
    if (!id) return;
    const r = await post(`/run/${action}`, { id });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      state.error = data.error || `${action} 失败`;
      render();
      return;
    }
    if (action === 'start') {
      state.runId = id;
    }
    await fetchDetail(id);
    await refresh({ keepDetail: true });
  }

  async function openPlanModal(id) {
    if (!id) return;
    let run = state.detail?.run?.id === id ? state.detail.run : null;
    if (!run) {
      const r = await api(`/run/${encodeURIComponent(id)}`);
      const data = await r.json().catch(() => ({}));
      run = data.run || null;
    }
    if (!run) return;
    state.planModal = { run };
    render();
  }

  /* ---------- app.js 挂钩 ---------- */

  async function enter(project) {
    const changed = project !== state.project;
    if (changed) {
      hardReset(project);
      render(); // 拉取前先呈现加载态（列表与详情拉取时显示加载指示）
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
    schedulePoll();
  }

  function hardReset(project) {
    if (state.pollTimer) clearTimeout(state.pollTimer);
    Object.assign(state, {
      project: project ?? null, phase: 'loading', error: null, data: null, runId: null,
      tab: 'overview', targetFilter: '', statusFilter: '', detail: null, detailPhase: 'idle',
      newPanel: null, planModal: null, pollTimer: null, rendered: false,
      subTab: 'pipeline', product: null,
    });
  }

  function reset() {
    hardReset(state.project);
    state.pendingRestore = null;
    render();
  }

  function snapshot() {
    return {
      runId: state.runId,
      tab: state.tab,
      targetFilter: state.targetFilter,
      statusFilter: state.statusFilter,
    };
  }

  function restoreView(snap) {
    state.pendingRestore = snap && typeof snap === 'object' ? snap : null;
  }

  function applyPendingRestore() {
    const snap = state.pendingRestore;
    if (!snap) return;
    if (typeof snap.tab === 'string' && TABS.some(([k]) => k === snap.tab)) state.tab = snap.tab;
    if (typeof snap.targetFilter === 'string') state.targetFilter = snap.targetFilter;
    if (typeof snap.statusFilter === 'string') state.statusFilter = snap.statusFilter;
    const known = (state.data?.runs || []).some((r) => r.id === snap.runId);
    state.runId = known ? snap.runId : null;
    state.pendingRestore = null;
    if (state.runId) fetchDetail(state.runId);
  }

  document.addEventListener?.('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.product?.planModal) { state.product.planModal = null; render(); return; }
    if (state.planModal) { state.planModal = null; render(); return; }
    if (state.newPanel) closePanel();
  });
  // 浏览态变化落快照（app.js 统一监听本事件持久化）
  const notify = () => window.dispatchEvent?.(new CustomEvent('atb:release-state'));

  return {
    enter, refresh, reset, snapshot, restoreView,
    selectRun: (id) => fetchDetail(id),
    setTab: (t) => { state.tab = t; render(); },
    // REQ-20260915-002：切到「产品发布」页签（构建模块「查看发布记录」跨模块跳转承接）
    showProduct,
    selectProduct: (id) => fetchProductDetail(id),
    notifyState: notify,
  };
})();

window.ATBRelease = ATBRelease;
