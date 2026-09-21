'use strict';
// REQ-20260920-004 命令模块前端 —— 由 app.js 在 view=commands 时激活（window.ATBCommands.enter）。
// 定位：通用兜底入口，不替代既有专用界面（同一命令经本模块与终端执行走同一 CLI 入口）。
// 数据源：命令清单唯一来源是服务端注册表（GET /api/cli/commands，scripts/lib/cli-registry.mjs），
// 前端不手抄清单；执行走 POST /api/cli/run（白名单 + 参数数组传递 + --dir 服务端注入）
// + GET /api/cli/run-status 轮询收敛（长耗时命令异步执行，不阻塞看板 2s 轮询）。
// 布局（讨论轮调整 2026-09-21，参考需求模块纵向档位形态）：
//   左缘竖排页签（最近执行在前且每次进入默认 / 全部命令）+ 命令列表（平铺无折叠）；
//   右侧命令详情与执行（说明 — 参数表单 — 命令预览 — 执行 — 输出区），下方执行历史（最近 20 次）。
// 安全交互：高危命令二次确认（完整命令 + 影响说明，取消参数保留）；serve 执行前固定影响告知
//（自动重启致响应丢失 / 界面断连属预期，按「服务重启中」处理并经轮询自动恢复）；
// cli 组禁用执行并在详情说明原因与终端指引；未初始化项目对 needsBoard 命令给初始化引导。
// 文案中英同步：静态中文原文入 scripts/web/i18n.js（BUG-20260912-001），命令名与参数保持 CLI 原文。

const ATBCommands = (() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const HISTORY_LIMIT = 20; // 执行历史：会话内最近 20 次，超限淘汰最旧，无清空入口
  const RECENT_LIMIT = 10;  // 最近执行：按命令去重前 10（仅成功执行计入，失败不计入）
  const POLL_MS = 1000;     // 执行结果轮询间隔

  const state = {
    project: null,
    phase: 'idle',    // idle | loading | ready | error
    error: null,
    groups: [],
    initialized: false, // 当前项目看板初始化状态（needsBoard 命令初始化引导依据）
    tab: 'recent',    // recent | all —— 每次进入命令模块默认 recent
    query: '',
    sel: null,        // 当前选中命令名（切换命令参数重置）
    vals: {},         // 参数表单值：'<命令名>|<参数label>' → 字符串
    extra: '',        // 附加参数（空白分隔，逐 token 透传）
    running: false,   // 本模块有在途执行（详情执行 / 轮询中）
    result: null,     // 输出区当前展示的执行结果
    history: [],      // { cmd, at, ok, exitCode, signal, stdout, stderr, durationMs }
    recents: [],      // { name, vals, extra, at } —— 按命令去重，成功执行后刷新
    confirmPending: null, // 高危待确认 { spec, preview }
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const toast = (m, isErr) => { try { if (typeof window !== 'undefined' && window.toast) window.toast(m, isErr); } catch { /* app.js 未加载 */ } };
  const fmtDur = (ms) => `${(Number(ms || 0) / 1000).toFixed(1)}s`;
  const nowTime = () => new Date().toLocaleTimeString();

  function findCmd(name) {
    for (const g of state.groups) {
      const c = (g.commands || []).find((x) => x.name === name);
      if (c) return { ...c, groupLabel: g.label };
    }
    return null;
  }
  const flatCmds = () => state.groups.flatMap((g) => (g.commands || []).map((c) => ({ ...c, groupLabel: g.label })));

  // ---------- 纯函数（命令预览 / 参数装配 / 必填校验，展示与下发同一口径） ----------

  function argValue(spec, a) {
    return String(state.vals[`${spec.name}|${a.label}`] ?? '').trim();
  }

  // 实际下发参数：位置参数与带值旗标按表单值装配 + 附加参数逐 token 透传（不经 shell 拼接）
  function buildArgs(spec) {
    const args = [];
    for (const a of spec.args || []) {
      const v = argValue(spec, a);
      if (!v) continue;
      if (a.flag) args.push(a.flag, v);
      else args.push(v);
    }
    for (const tok of String(state.extra || '').split(/\s+/).filter(Boolean)) args.push(tok);
    return args;
  }

  // 命令预览：与实际下发内容一致（含服务端注入的 --dir 项目根）
  function previewText(spec) {
    const parts = ['atb', spec.name];
    for (const a of spec.args || []) {
      const v = argValue(spec, a);
      parts.push(a.flag ? `${a.flag} ${v || `<${a.label}>`}` : (v || `<${a.label}>`));
    }
    for (const tok of String(state.extra || '').split(/\s+/).filter(Boolean)) parts.push(tok);
    if (state.project) parts.push('--dir', state.project);
    return `$ ${parts.join(' ')}`;
  }

  function missingRequired(spec) {
    return (spec.args || []).filter((a) => a.required && !argValue(spec, a)).map((a) => a.label);
  }

  // ---------- 数据加载 ----------

  async function enter(project) {
    state.project = project ?? null;
    state.tab = 'recent'; // 每次进入命令模块默认显示「最近执行」页签
    if (state.phase === 'loading') { render(); return; }
    if (state.phase !== 'ready' || state.loadedProject !== project) await loadCatalog(true);
    else refreshBoardState();
    render();
  }

  async function loadCatalog(force = false) {
    if (!force && state.phase === 'ready') return;
    state.phase = 'loading';
    state.error = null;
    render();
    try {
      const r = await fetch('/api/cli/commands');
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      state.groups = data.groups || [];
      state.phase = 'ready';
      state.loadedProject = state.project;
      refreshBoardState();
    } catch (e) {
      state.phase = 'error';
      state.error = e && e.message ? e.message : String(e);
    }
    render();
  }

  // 当前项目看板初始化状态（needsBoard 命令初始化引导依据；读取失败不阻塞清单）
  async function refreshBoardState() {
    if (!state.project) { state.initialized = false; return; }
    try {
      const r = await fetch(`/api/board?project=${encodeURIComponent(state.project)}`);
      const data = await r.json().catch(() => ({}));
      state.initialized = !!data.initialized;
    } catch { state.initialized = false; }
  }

  // ---------- 渲染 ----------

  function render() {
    const host = $('#commandsView');
    if (!host) return;
    host.innerHTML = `
      <div class="cmd-shell">
        <aside class="cmd-side" aria-label="命令列表区">
          <div class="cmd-ltabs" role="tablist" aria-label="左缘视图页签">
            <button type="button" class="cmd-ltab${state.tab === 'recent' ? ' on' : ''}" role="tab" aria-selected="${state.tab === 'recent'}" data-tab="recent">最近执行</button>
            <button type="button" class="cmd-ltab${state.tab === 'all' ? ' on' : ''}" role="tab" aria-selected="${state.tab === 'all'}" data-tab="all">全部命令</button>
          </div>
          <div class="cmd-lmain">
            <div class="cmd-listctl${state.tab === 'all' ? '' : ' hidden'}">
              <input id="cmdSearch" class="cmd-search" type="search" placeholder="搜索命令或说明（按 / 聚焦）…" autocomplete="off" aria-label="搜索命令">
            </div>
            <div class="cmd-list${state.tab === 'all' ? '' : ' hidden'}" role="listbox" aria-label="命令列表"></div>
            <div class="cmd-list${state.tab === 'recent' ? '' : ' hidden'}" role="listbox" aria-label="最近执行列表（按命令去重前 10）"></div>
          </div>
        </aside>
        <section class="cmd-main">
          <div class="cmd-detail" aria-live="polite"></div>
          <div class="cmd-outwrap"></div>
          <div class="cmd-histwrap"></div>
        </section>
      </div>
      <div class="cmd-confirm-wrap hidden" role="dialog" aria-modal="true" aria-label="确认执行">
        <div class="cmd-confirm-box">
          <h3 class="cmd-confirm-title">确认执行该命令？</h3>
          <p class="cmd-confirm-desc">高危命令可能不可恢复或影响全局，请核对完整命令与参数：</p>
          <pre class="cmd-preview" id="cmdConfirmCmd"></pre>
          <div class="cmd-row">
            <button type="button" class="btn" id="cmdConfirmNo">取消（返回表单，参数保留）</button>
            <button type="button" class="btn danger" id="cmdConfirmYes">确认执行</button>
          </div>
        </div>
      </div>`;
    $$('.cmd-ltab', host).forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    const search = $('#cmdSearch', host);
    if (search) {
      search.value = state.query;
      search.addEventListener('input', () => { state.query = search.value; renderList(); });
    }
    renderList();
    renderRecent(); // render() 重建 DOM 后「最近执行」容器随之清空：必须重渲染（BUG-20260921-009）
    renderDetail();
    renderOutput();
    renderHistory();
  }

  function switchTab(tab) {
    if (state.tab === tab) return;
    state.tab = tab;
    render();
  }

  function cmdBtnHtml(c, extraRight = '') {
    const on = state.sel === c.name ? ' on' : '';
    const off = c.disabled ? ' off' : '';
    const tags = [
      c.danger ? '<span class="cmd-tag danger">需确认</span>' : '',
      c.serve ? '<span class="cmd-tag warn">影响提示</span>' : '',
      c.disabled ? '<span class="cmd-tag dis">终端执行</span>' : '',
    ].join('');
    return `<button type="button" class="cmd-item${on}${off}" data-c="${esc(c.name)}" aria-label="atb ${esc(c.name)}"><code>atb ${esc(c.name)}</code>${tags}${extraRight}</button>`;
  }

  function renderList() {
    const host = $('#commandsView .cmd-list[aria-label="命令列表"]');
    if (!host) return;
    if (state.phase === 'loading') { host.innerHTML = '<div class="cmd-notice">正在读取命令清单…</div>'; return; }
    if (state.phase === 'error') {
      host.innerHTML = `<div class="cmd-notice">命令清单读取失败：${esc(state.error || '未知原因')}<br><button type="button" class="btn small" id="cmdRetryList">重试</button></div>`;
      $('#cmdRetryList', host)?.addEventListener('click', () => loadCatalog(true));
      return;
    }
    const q = String(state.query || '').trim().toLowerCase();
    let any = false;
    const html = state.groups.map((g) => {
      const its = (g.commands || []).filter((c) => !q || `${c.name} ${c.desc || ''}`.toLowerCase().includes(q));
      if (!its.length) return ''; // 分组内无匹配时该分组隐藏
      any = true;
      return `<p class="cmd-grp">${esc(g.label)}</p>${its.map((c) => cmdBtnHtml(c)).join('')}`;
    }).join('');
    if (!any) {
      host.innerHTML = `<div class="cmd-notice">无匹配命令。<button type="button" class="btn small" id="cmdClearQ">清除搜索</button></div>`;
      $('#cmdClearQ', host)?.addEventListener('click', () => { state.query = ''; const s = $('#cmdSearch'); if (s) s.value = ''; renderList(); });
      return;
    }
    host.innerHTML = html;
    bindCmdPick(host);
  }

  function bindCmdPick(host) {
    $$('.cmd-item', host).forEach((b) => b.addEventListener('click', () => {
      const name = b.dataset.c;
      if (state.sel !== name) { state.vals = {}; state.extra = ''; } // 切换命令参数重置
      state.sel = name;
      renderList();
      renderRecent();
      renderDetail();
    }));
  }

  function renderRecent() {
    const host = $('#commandsView .cmd-list[aria-label^="最近执行列表"]');
    if (!host) return;
    if (!state.recents.length) {
      host.innerHTML = '<div class="cmd-notice cmd-recent-empty">暂无最近执行：命令成功执行后，这里按命令去重展示最近 10 条，点击在右侧回填该次参数快速再执行；也可切换「全部命令」页签选择命令。</div>';
      return;
    }
    host.innerHTML = state.recents.map((r) => {
      const c = findCmd(r.name);
      if (!c) return '';
      return cmdBtnHtml(c, `<small>${esc(r.at)}</small>`);
    }).join('');
    $$('.cmd-item', host).forEach((b) => b.addEventListener('click', () => {
      const r = state.recents.find((x) => x.name === b.dataset.c);
      if (!r) return;
      state.sel = r.name;
      state.vals = { ...r.vals }; // 回填该命令最近一次成功执行的参数
      state.extra = r.extra;
      renderRecent();
      renderList();
      renderDetail();
      setDetailFeedback('cmd-fb warn', '已回填该命令最近一次执行参数，核对后可直接执行。');
    }));
  }

  function setDetailFeedback(cls, text) {
    const fb = $('#cmdDetailFb');
    if (fb) { fb.className = `cmd-fb ${cls}`.trim(); fb.textContent = text; }
  }

  function renderDetail() {
    const host = $('#commandsView .cmd-detail');
    if (!host) return;
    const spec = state.sel ? findCmd(state.sel) : null;
    if (!spec) {
      host.innerHTML = '<div class="cmd-notice">在左侧点击命令，右侧显示说明、参数表单与执行入口；输出与执行历史在下方回显。</div>';
      return;
    }
    const miss = missingRequired(spec);
    const needInit = spec.needsBoard !== false && !state.initialized;
    const argsHtml = (spec.args || []).length
      ? `<div class="cmd-params">${spec.args.map((a) => `
          <label class="cmd-field"><span class="cmd-fl">${esc(a.label)}${a.flag ? ` <code>${esc(a.flag)}</code>` : ''}</span><span class="cmd-fr">${a.required ? '（必填）' : '（可选）'}</span>
            <input data-k="${esc(a.label)}" data-flag="${esc(a.flag || '')}" placeholder="${esc(a.placeholder || '')}" value="${esc(argValue(spec, a))}">
          </label>`).join('')}</div>`
      : '<p class="cmd-desc">该命令无位置参数。</p>';
    host.innerHTML = `
      <h2 class="cmd-title"><code>atb ${esc(spec.name)}</code></h2>
      <p class="cmd-desc">${esc(spec.desc || '')}</p>
      ${spec.options ? `<p class="cmd-desc">常用选项：<code>${esc(spec.options)}</code></p>` : ''}
      ${argsHtml}
      <label class="cmd-field cmd-extra">附加参数（可选，空白分隔）
        <input id="cmdExtra" placeholder="--json --by demo" value="${esc(state.extra)}">
      </label>
      <pre class="cmd-preview" id="cmdPrev"></pre>
      ${spec.serve ? '<div class="cmd-notice">执行影响：版本一致时为「复用现有实例」的空操作，正常回显输出；磁盘代码较新时服务自动重启——本次响应会丢失、界面短暂断连，属预期而非执行失败，重启完成后界面自动恢复。</div>' : ''}
      ${spec.disabled ? `<div class="cmd-notice">该命令面向本机终端环境（PATH / 常驻服务），不适合经网页下发；请在终端执行：<code>node scripts/atb.mjs ${esc(spec.name)}</code></div>` : ''}
      ${needInit ? '<div class="cmd-notice">当前项目尚未初始化看板：该命令依赖看板数据，请先初始化。<button type="button" class="btn small" id="cmdGoInit">去初始化</button></div>' : ''}
      <div class="cmd-row">
        ${spec.disabled ? '<button type="button" class="btn primary" disabled>执行</button><span class="cmd-fb warn">界面已禁用执行入口</span>' : `
        <button type="button" class="btn primary" id="cmdRun" ${miss.length || state.running || needInit ? 'disabled' : ''}>${state.running ? '执行中…' : '执行'}</button>
        ${miss.length ? `<span class="cmd-fb warn">必填项缺失：${esc(miss.join('、'))}</span>` : ''}
        ${spec.long && !miss.length ? '<span class="cmd-fb">长耗时命令：异步执行，不阻塞看板轮询。</span>' : ''}`}
      </div>
      <p class="cmd-fb" id="cmdDetailFb" role="status" aria-live="polite"></p>`;
    $('#cmdPrev', host).textContent = previewText(spec);
    // 参数输入就地更新预览与执行态（不整页重渲染，输入不丢）
    $$('.cmd-params input', host).forEach((inp) => inp.addEventListener('input', () => {
      state.vals[`${spec.name}|${inp.dataset.k}`] = inp.value;
      $('#cmdPrev', host).textContent = previewText(spec);
      const m = missingRequired(spec);
      const btn = $('#cmdRun', host);
      if (btn) btn.disabled = !!m.length || state.running || needInit;
      setDetailFeedback(m.length ? 'cmd-fb warn' : '', m.length ? `必填项缺失：${m.join('、')}` : '');
    }));
    $('#cmdExtra', host)?.addEventListener('input', (e) => {
      state.extra = e.target.value.trim();
      $('#cmdPrev', host).textContent = previewText(spec);
    });
    $('#cmdGoInit', host)?.addEventListener('click', () => {
      // 需求模块空态有「初始化」卡（对齐既有初始化能力，不重复实现）
      window.dispatchEvent(new CustomEvent('atb:goto-view', { detail: { view: 'status' } }));
    });
    $('#cmdRun', host)?.addEventListener('click', () => onRun(spec));
  }

  // ---------- 执行（白名单下发 + 轮询收敛 + serve 断连预期态） ----------

  function onRun(spec) {
    const miss = missingRequired(spec);
    if (miss.length) { setDetailFeedback('cmd-fb warn', `必填项缺失：${miss.join('、')}`); return; }
    if (spec.danger) { // 高危命令二次确认：展示完整命令；取消回表单且参数保留
      state.confirmPending = { spec };
      $('#cmdConfirmCmd').textContent = previewText(spec);
      $('#commandsView .cmd-confirm-wrap').classList.remove('hidden');
      $('#cmdConfirmNo').onclick = () => {
        $('#commandsView .cmd-confirm-wrap').classList.add('hidden');
        state.confirmPending = null;
        setDetailFeedback('cmd-fb warn', '已取消：高危命令未执行，参数保留。');
      };
      $('#cmdConfirmYes').onclick = () => {
        $('#commandsView .cmd-confirm-wrap').classList.add('hidden');
        state.confirmPending = null;
        doRun(spec);
      };
      return;
    }
    doRun(spec);
  }

  async function doRun(spec) {
    const args = buildArgs(spec);
    const preview = previewText(spec);
    state.running = true;
    renderDetail();
    setDetailFeedback('cmd-fb', `已下发：${preview}`);
    try {
      const r = await fetch(`/api/cli/run?project=${encodeURIComponent(state.project || '')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: spec.name, args }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        state.running = false;
        renderDetail();
        setDetailFeedback('cmd-fb err', data.error || `下发失败：HTTP ${r.status}`);
        return;
      }
      await pollResult(spec);
    } catch (e) {
      state.running = false;
      renderDetail();
      setDetailFeedback('cmd-fb err', `下发失败：${e && e.message ? e.message : e}`);
    }
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function pollResult(spec) {
    const P = `?project=${encodeURIComponent(state.project || '')}`;
    for (;;) {
      let r = null;
      let networkFail = false;
      try {
        r = await fetch(`/api/cli/run-status${P}`);
      } catch {
        networkFail = true;
      }
      if (networkFail) {
        // 服务不可达：serve 自动重启（承载本次请求的进程被 kill）属预期——提示重启中并等待恢复
        if (spec.serve) {
          setDetailFeedback('cmd-fb warn', '服务重启中，稍后自动恢复（serve 自动重启，界面短暂断连属预期）');
          await sleep(2000);
          continue;
        }
        withUnknown(spec, '服务不可达或已重启，执行结果未知，可重试。');
        return;
      }
      if (r.status === 404) {
        // 记录丢失（服务重启）：serve → 服务已恢复即成功口径；其余命令 → 结果未知
        if (spec.serve) {
          withDone(spec, { exitCode: 0, stdout: '', stderr: '', durationMs: null, recovered: true });
        } else {
          withUnknown(spec, '服务已重启，执行结果未知（记录丢失），可重试或到终端核实。');
        }
        return;
      }
      const job = await r.json().catch(() => ({}));
      if (!job.running) {
        withDone(spec, job);
        return;
      }
      setDetailFeedback('cmd-fb', '执行中…');
      await sleep(POLL_MS);
    }
  }

  // 以结果收敛（渲染详情 / 最近执行 / 输出区 / 历史）
  function withDone(spec, job) {
    state.running = false;
    const ok = job.exitCode === 0 && !job.spawnError;
    const rec = {
      cmd: (job.argv || []).join(' '),
      at: nowTime(),
      ok,
      exitCode: job.exitCode,
      signal: job.signal || null,
      stdout: job.stdout || '',
      stderr: job.stderr || '',
      spawnError: job.spawnError || null,
      durationMs: job.durationMs,
      recovered: !!job.recovered,
    };
    state.result = rec;
    state.history.unshift(rec);
    if (state.history.length > 20) state.history.length = 20; // 超出 20 自动淘汰最旧
    if (ok) {
      // 最近执行：按命令去重（重复只占 1 条并刷新到最前），仅成功执行计入
      state.recents = state.recents.filter((x) => x.name !== spec.name);
      state.recents.unshift({ name: spec.name, vals: { ...state.vals }, extra: state.extra, at: nowTime() });
      if (state.recents.length > 10) state.recents.length = 10;
    }
    renderDetail();
    renderRecent();
    renderOutput();
    renderHistory();
    if (rec.recovered) setDetailFeedback('cmd-fb warn', '服务已恢复（serve 重启完成；本次输出经重启丢失属预期）。');
    return null;
  }

  function withUnknown(spec, message) {
    state.running = false;
    const rec = {
      cmd: previewText(spec), at: nowTime(), ok: false, exitCode: null, signal: null,
      stdout: '', stderr: '', spawnError: null, durationMs: null, unknown: true,
    };
    state.result = rec;
    state.history.unshift(rec);
    if (state.history.length > 20) state.history.length = 20;
    renderDetail();
    setDetailFeedback('cmd-fb err', message);
    renderOutput();
    renderHistory();
    return null;
  }

  // ---------- 输出区与执行历史 ----------

  function renderOutput() {
    const host = $('#commandsView .cmd-outwrap');
    if (!host) return;
    const r = state.result;
    if (!r) { host.innerHTML = ''; return; }
    // 状态行拆为独立 span（每段一个完整文本节点，i18n 全文匹配翻译互不干扰）
    const parts = [];
    if (r.unknown) {
      parts.push('<span class="cmd-fb err">✗ 结果未知</span>');
    } else if (r.ok) {
      parts.push('<span class="cmd-fb ok">✓ 成功 · 退出码 0</span>');
      if (r.durationMs != null) parts.push(`<span class="cmd-fb ok"> · 耗时 ${fmtDur(r.durationMs)}</span>`);
    } else {
      parts.push('<span class="cmd-fb err">✗ 失败</span>');
      if (r.exitCode != null) parts.push(`<span class="cmd-fb err"> · 退出码 ${r.exitCode}</span>`);
      if (r.signal) parts.push(`<span class="cmd-fb err"> · 信号 ${r.signal}</span>`);
      if (r.durationMs != null) parts.push(`<span class="cmd-fb err"> · 耗时 ${fmtDur(r.durationMs)}</span>`);
    }
    const meta = parts.join('');
    const out = r.stdout || '';
    const err = r.stderr || r.spawnError || '';
    host.innerHTML = `
      <h3 class="cmd-h">输出</h3>
      <div class="cmd-row">${meta}<button type="button" class="btn small" id="cmdCopyOut">复制输出</button></div>
      <div class="cmd-out">
        <div class="cmd-out-sec"><span class="cmd-out-label">stdout</span><pre>${esc(out) || (r.ok && !err ? '（无输出）' : '')}</pre></div>
        ${err ? `<div class="cmd-out-sec err"><span class="cmd-out-label">stderr</span><pre>${esc(err)}</pre></div>` : ''}
      </div>`;
    $('#cmdCopyOut', host)?.addEventListener('click', async () => {
      const text = `${r.stdout || ''}${r.stderr ? `\n${r.stderr}` : ''}`.trim() || '（无输出）';
      try {
        await navigator.clipboard.writeText(text);
        toast('已复制输出');
      } catch { toast('剪贴板不可用：请手动选择输出文本复制', true); }
    });
  }

  function renderHistory() {
    const host = $('#commandsView .cmd-histwrap');
    if (!host) return;
    const rows = state.history.map((h, n) => `
      <li class="cmd-hist-row">
        <code class="cmd-hist-cmd">${esc(h.cmd)}</code>
        <small>${esc(h.at)}</small>
        <span class="cmd-hist-st ${h.ok ? 'ok' : 'err'}">${h.ok ? '成功' : '失败'}</span>
        <button type="button" class="btn small quiet" data-n="${n}">回看输出</button>
      </li>`).join('');
    host.innerHTML = `
      <h3 class="cmd-h">执行历史（本次会话 · 最近 20 次）</h3>
      <ul class="cmd-hist">${rows || '<li class="cmd-hist-empty">暂无执行记录</li>'}</ul>`;
    $$('.cmd-hist-row button', host).forEach((b) => b.addEventListener('click', () => {
      state.result = state.history[Number(b.dataset.n)] || null;
      renderOutput();
    }));
  }

  // ---------- 对外接缝 ----------

  function focusSearch() {
    // `/` 快捷键联动：最近执行页签下先切到全部命令，再聚焦搜索框
    if (state.tab !== 'all') switchTab('all');
    const s = $('#cmdSearch');
    if (s) s.focus();
  }

  function retryRun() {
    const spec = state.sel ? findCmd(state.sel) : null;
    if (spec && !state.running) doRun(spec); // 失败就地重试：同命令同参数，表单参数不丢
  }

  return {
    enter,
    loadCatalog,
    focusSearch,
    retryRun,
    snapshot: () => ({ tab: state.tab, sel: state.sel }),
  };
})();

if (typeof window !== 'undefined') window.ATBCommands = ATBCommands;
