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
//   - 新建版本 / 添加条目走右侧侧拉面板：选单支持全选 / 全不选；REQ-20260927-002 起
//     勾选条目即整组自动关联该条目全部自动口径提交（账本核验 ∪ 主题末尾单号严格归属，
//     自动集为空时回退宽口径命中最新 1 个并标注回退来源），以只读清单展示（旧→新、
//     来源徽标），不提供逐个提交的增删入口（调整走版本详情换选）；宽口径命中仅折叠
//     展示「另有 N 个宽口径命中未关联」只读提示；
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
  // REQ-20260921-014：版本信息编辑长度上限——镜像 scripts/lib/build-store.mjs 的
  // NAME_MAX / DESC_MAX（客户端校验只做就地拦截，数据层校验兜底双保险）
  const INFO_NAME_MAX = 80;
  const INFO_DESC_MAX = 4000;

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
    // REQ-20260921-014 概况页签显式编辑态 { id, name, description, error, busy }——按版本
    // id 归属（切换版本 / 步骤 / 项目即清空回展示态，不把未保存草稿静默写入）
    planEdit: null,
    createPanel: null,   // { candidates, picked:Set, broadOpen:Set, name, totalDone, busy, error, loadError }
    addPanel: null,      // { verId, candidates, picked:Set, broadOpen:Set, totalDone, busy, error, loadError }
    //（totalDone：候选接口占用过滤前的 done 条目总数，用于空态区分「无 done 条目」与
    // 「done 条目均已被版本占用」——BUG-20260914-004。REQ-20260927-002：关联提交不再单选
    // （commits 单值 map 移除），勾选条目即整组自动关联其全部自动口径提交（候选行
    // commitMeta 直读）；broadOpen 为宽口径命中折叠行展开状态）
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
    // 发布流程数据（/api/build/publish-plan 装配；以 verId 归属隔离，seq 丢弃切换版本 / 项目后
    // 迟到的旧响应）：phase: idle → loading → ready | error
    // REQ-20260921-008：prompt（AI 总结提示词预览）与 review（审查对话框开合与逐栏状态）入 pf
    pf: null, // { verId, seq, phase, error, plan, busy, commitMsg, refreshing, prompt, review, siteBusy }
    // 官网检测轮询句柄（60 秒一轮；离开发布步 / 切换版本 / 切换页签即停止，返回可继续核对）
    siteTimer: null,
    // REQ-20260921-008：AI 总结进度轮询句柄（15 秒一轮；离开文档编写步 / 切换版本即停止）
    summaryTimer: null,
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
    // 搜索范围 = 当前所选分支全部提交，服务端匹配）；logQueryInput 为输入框草稿（重渲染回填防丢字），
    // 与顶部模块搜索 state.query 互不串扰
    logQuery: '',
    logQueryInput: '',
    // REQ-20260921-002：搜索双模式——highlight（默认：数据集不变，命中高亮定位 + 滚动首条）/
    // filter（保留集 = 匹配 ∪ 祖先闭包，泳道连通）；模式为用户视图偏好，切分支不重置
    logSearchMode: 'highlight',
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

  // 全选口径：只纳入可自动关联提交的条目（自动集非空，含宽口径回退；两者皆空自动跳过并提示）。
  // REQ-20260927-002：候选提交不再单选，条目可勾选 ⇔ 整组自动关联集非空。
  function selectableCandidates(items) {
    return (items || []).filter((x) => autoAssociationOf(x).length > 0);
  }

  // BUG-20260921-015：版本条目多提交口径（纯函数）——条目关联的全部提交 = commits 数组
  //（服务端补齐），旧单提交形态兜底 [commit]；关联列表 / 搜索 / 合并确认清单均按此展开。
  function commitsOf(it) {
    return Array.isArray(it?.commits) && it.commits.length ? it.commits : (it?.commit ? [it.commit] : []);
  }

  // REQ-20260927-002（纯函数，渲染 / payload / 测试共用）：条目的整组自动关联提交集。
  // 服务端 commitMeta（{ hash, subject, source }，source ∈ 'ledger' 账本核验 /
  // 'attribution' 主题末尾单号严格归属，旧→新）直读；自动集为空时回退宽口径命中
  //（broadCommits，旧→新）中最新的 1 个（source 'fallback'，标注回退来源，保证条目
  // 仍可加入版本）；旧候选 payload（无元数据键，如部署间隙缓存 / 测试旧形态）防御回退为
  // 已知全部 commits（无位置信息，不做「最新 1 个」裁剪避免丢提交）。恒返回
  // [{ hash, subject, source }]，hash 小写 40 位。
  function autoAssociationOf(it) {
    const meta = (Array.isArray(it?.commitMeta) ? it.commitMeta : [])
      .filter((m) => m && HASH_RE.test(String(m.hash || '')));
    if (meta.length) {
      return meta.map((m) => ({
        hash: String(m.hash).toLowerCase(),
        subject: String(m.subject || ''),
        source: m.source === 'attribution' ? 'attribution' : 'ledger',
      }));
    }
    const broad = (Array.isArray(it?.broadCommits) ? it.broadCommits : [])
      .filter((m) => m && HASH_RE.test(String(m.hash || '')))
      .map((m) => ({ hash: String(m.hash).toLowerCase(), subject: String(m.subject || '') }));
    const legacy = broad.length
      ? broad
      : (Array.isArray(it?.commits) ? it.commits : [])
        .filter((h) => HASH_RE.test(String(h || '')))
        .map((h) => ({ hash: String(h).toLowerCase(), subject: '', source: 'fallback' }));
    if (Array.isArray(it?.broadCommits)) {
      // 正常链路：自动集为空且存在宽口径命中 → 回退关联最新 1 个（旧→新数组的末位）
      const pick = legacy[legacy.length - 1];
      return pick ? [{ ...pick, source: 'fallback' }] : [];
    }
    return legacy; // 旧形态防御：已知提交整组关联
  }

  // REQ-20260927-002（纯函数）：宽口径命中（未进自动关联集）——「另有 N 个宽口径命中未
  // 关联」折叠行只读展示数据源，不参与自动关联与保存 payload。
  function broadHitsOf(it) {
    return (Array.isArray(it?.broadCommits) ? it.broadCommits : [])
      .filter((m) => m && HASH_RE.test(String(m.hash || '')))
      .map((m) => ({ hash: String(m.hash).toLowerCase(), subject: String(m.subject || '') }));
  }

  // REQ-20260915-003：关联条目联合行过滤（纯函数，渲染与测试共用）——一条关联单及其全部
  // commit 为一个联合行；关键词覆盖条目 ID、标题与完整/短 commit 哈希（短哈希是完整哈希的
  // 前缀，包含匹配天然覆盖）；忽略英文大小写、去首尾空白、按包含关系匹配、保持原顺序。
  // 字段间以 \t 分隔，避免标题结尾与哈希开头在拼接边界串出假词误命中。
  // BUG-20260921-015：多提交条目按全部提交哈希参与匹配。
  function filterVersionItems(items, q) {
    const list = items || [];
    const kw = String(q || '').trim().toLowerCase();
    if (!kw) return list;
    return list.filter((it) => `${it.itemId}\t${it.title || ''}\t${commitsOf(it).join('\t')}`.toLowerCase().includes(kw));
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

  // REQ-20260921-006 提示词缓存命中优化：静态段（任务句 + 综合要求 + 回答格式约定）在前，
  // 随版本变化的值（版本号 / 当前名称描述 / 关联条目清单）收敛到尾部「运行参数」区——
  // 不同版本的提示词共享逐字一致的公共前缀。回答格式约定与 parseAnswer 解析口径不变。
  function buildPrompt(v) {
    const lines = [];
    lines.push('请为看板版本（版本号与素材见运行参数）生成「版本名称」与「版本描述」。');
    lines.push('请综合运行参数给出的当前信息与关联条目，给出更完整的版本名称与描述；只按以下格式回答，不要附加其他内容：');
    lines.push('版本名称：<一行>');
    lines.push('版本描述：<可多行>');
    lines.push('');
    lines.push('运行参数（随版本变化，占位符以本区实际值为准）：');
    lines.push(`看板版本：${v.id}`);
    lines.push(`当前信息：名称「${v.name || '（空）'}」；描述「${v.description || '（空）'}」。`);
    lines.push('关联条目：');
    for (const it of v.items || []) lines.push(`- ${it.itemId} ${it.title || ''}（commit ${commitsOf(it).map((h) => short(h)).join(' ')}）`);
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
    state.planEdit = null; // REQ-20260921-014：切换版本丢弃概况页签未保存编辑（不误保存）
    state.rel = null;
    state.pf = null;
    stopSiteTimer();
    stopSummaryTimer(); // REQ-20260921-008：旧版本 AI 总结进度轮询停止
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
        planEdit: null, // REQ-20260921-014：切换项目丢弃概况页签未保存编辑
        itemsQuery: '', itemsQueryInput: '', itemsPage: 1, // REQ-20260915-003：关联列表搜索分页随项目切换重置
        // BUG-20260915-014：详情页签与发布数据随项目切换重置（页签回概况，旧项目记录不串用）；
        // REQ-20260920-003：五步流程与官网轮询随项目切换重置（step 回 plan）
        step: 'plan', rel: null, pf: null,
        releaseConfirm: null, // BUG-20260928-002：发布二次确认弹窗随项目切换关闭（链路按 rc 身份自行中止）
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
  // REQ-20260914-002：logQuery 非空时请求附加 q（服务端全量匹配分页，能命中当前页之外的提交）。
  // REQ-20260921-002：搜索请求附 mode（highlight = 数据集不变 + 命中清单；filter = 祖先闭包保留集）。
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
      const q = state.logQuery ? `&q=${encodeURIComponent(state.logQuery)}&mode=${state.logSearchMode}` : '';
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

  // REQ-20260921-002：切换搜索模式——radio change 触发；已有生效关键词时带词重查回第一页
  //（两模式服务端口径不同：闭包保留集 vs 命中清单），无关键词仅切视图。
  function setLogSearchMode(mode) {
    const m = mode === 'filter' ? 'filter' : 'highlight';
    if (m === state.logSearchMode) return;
    state.logSearchMode = m;
    if (state.logQuery) return loadLog(1);
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

  /* ---------- REQ-20260921-002 提交树（vendored @gitgraph/js 渲染 + 数据适配纯函数） ---------- */

  // 泳道配色（浅 / 深两套，与 --git-lg* 调色板同源；gitgraph 模板需具体色值，深浅切换重画树）
  const TREE_COLORS_LIGHT = ['#2563eb', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#16a34a'];
  const TREE_COLORS_DARK = ['#60a5fa', '#fbbf24', '#a78bfa', '#22d3ee', '#f87171', '#4ade80'];

  // BUG-20260921-007：双支并集泳道名判定——heads 双支在位且行数据带 side 时返回
  // [主分支名, 'dev']（主分支取非 dev 头，dev 头按 DEV_BRANCH 命名；服务端口径 [main, dev]），
  // 否则 null（单支模式）。treeData 与 mountTree 共用，保证数据面与渲染面判定一致。
  function dualLogNames(heads, commits) {
    const hs = (Array.isArray(heads) ? heads : []).filter((x) => x && x.name && x.hash);
    if (hs.length < 2) return null;
    if (!(Array.isArray(commits) ? commits : []).some((c) => c && (c.side === 'main' || c.side === 'dev'))) return null;
    const dev = hs.find((x) => x.name === 'dev') || hs[1];
    const main = hs.find((x) => x !== dev) || hs[0];
    return [main.name, dev.name];
  }

  // BUG-20260921-007：泳道序比较器（gitgraph compareBranchesOrder）——主分支恒 0（蓝）、
  // dev 恒 1（黄），不随页内首次出现顺序跳变（翻页 / 搜索 / 刷新颜色稳定）；其余名排后。
  function laneOrderOf(names) {
    const order = (n) => (n === names[0] ? 0 : n === names[1] ? 1 : 2);
    return (a, b) => order(a) - order(b);
  }

  // 纯函数：commits（新→旧，含 parents / tags / side / heads 上下文）→ @gitgraph/js import()
  // 支持的扁平 DAG 数组（git2json 形态：author 为对象、refs 数组、`tag: ` 前缀识别标签）。
  // BUG-20260921-007 根因与修复（两缺陷同源：gitgraph 只渲染「分支 ref 沿首父链可达 ∪ 合并
  // 闭包」的提交，且泳道色按分支名首次出现顺序分配）：
  // - 双支并集（heads ≥2 且带 side）：每侧以「本页该侧最新行」为锚（heads 命中页内即头行——
  //   第 1 页行为不变；第 2 页起仍有身份，dev 不再变蓝），并把 parents[0] 改写为同侧页内链
  //   （同侧真实父优先，否则接到下方最近同侧行），保证整页提交从本侧锚首父可达（零丢弃）；
  //   跨侧父保留为附加父（合并 / 分叉曲线由 gitgraph 绘制）；最老 main 行补挂主分支名锚，
  //   使共享历史的 branchToDisplay 恒为主分支名（主蓝 / dev 黄不随页内交错顺序翻转）。
  // - 单支（无 side）：parents 仍按集合内截断保真（REQ-20260920-001 G 组「不虚构父边」口径），
  //   页外断层泳道（合并提交在更早页、gitgraph 锚链与合并闭包均不可达）以「分支名·n」续锚
  //   补覆盖，杜绝第 3 页起空白。
  // - refs：锚行带分支名（gitgraph 渲染分支名标签，标签只出现在 ref 最终指向的头行）；
  //   tags 以 `tag: <名>` 进入 refs。
  // - mergeParents 仍按原集合内父计数（渲染层合并标识与详情口径不变）。
  function treeData(commits, { heads = [], branchName = null } = {}) {
    const list = Array.isArray(commits) ? commits : [];
    const shown = new Set(list.map((c) => c && c.hash));
    const headByHash = new Map((Array.isArray(heads) ? heads : [])
      .filter((x) => x && x.name && x.hash).map((x) => [x.hash, x.name]));
    const dualNames = dualLogNames(heads, list);
    const anchorAt = new Map(); // 行序号 -> 泳道锚分支名
    let rewired = null; // hash -> 双支模式改写后的 parents
    if (dualNames) {
      const [mainName, devName] = dualNames;
      const nameOfSide = { main: mainName, dev: devName };
      const sideOf = (c) => (c && c.side === 'dev' ? 'dev' : 'main');
      for (const side of ['main', 'dev']) {
        const idx = list.findIndex((c) => sideOf(c) === side);
        if (idx >= 0) anchorAt.set(idx, nameOfSide[side]);
      }
      // 最老 main 行补挂主分支名（import 按旧→新序 set ref，主名先入 → 共享历史 walk 序恒主侧先）
      const oldestMain = [...list].reverse().find((c) => sideOf(c) === 'main');
      if (oldestMain) {
        const idx = list.indexOf(oldestMain);
        if (!anchorAt.has(idx)) anchorAt.set(idx, mainName);
      }
      rewired = new Map();
      list.forEach((c, i) => {
        const side = sideOf(c);
        const inPage = (Array.isArray(c.parents) ? c.parents : []).filter((p) => shown.has(p));
        // 严格同侧显示序链：parents[0] = 下方最近同侧行（同侧真实父可能跳过交错的同侧段行，
        // 以真实父为首父会留下不可达行 = gitgraph 静默丢弃，即本 Bug 第 3 页起空白的根因）
        let chain = null;
        for (let j = i + 1; j < list.length; j++) {
          if (sideOf(list[j]) === side) { chain = list[j].hash; break; }
        }
        const ps = [];
        if (chain) ps.push(chain);
        for (const p of inPage) if (!ps.includes(p)) ps.push(p); // 真实父（同侧跨行 / 跨侧）保留为附加父
        rewired.set(c.hash, ps);
      });
    } else {
      // 单支：既有锚（heads 命中行 / 无 heads 时首行选中分支名）+ gitgraph 可达覆盖镜像
      list.forEach((c, i) => {
        const headName = headByHash.get(c.hash);
        if (headName) anchorAt.set(i, headName);
        else if (i === 0 && branchName && !headByHash.size) anchorAt.set(i, String(branchName));
      });
      const byHash = new Map(list.map((c) => [c.hash, c]));
      const inPageParents = (c) => (Array.isArray(c.parents) ? c.parents : []).filter((p) => shown.has(p));
      const covered = new Set();
      const walkChain = (hash) => {
        const stack = [hash];
        while (stack.length) {
          const h = stack.pop();
          const c = byHash.get(h);
          if (!h || !c || covered.has(h)) continue;
          covered.add(h);
          const ps = inPageParents(c);
          if (ps[0]) stack.push(ps[0]);
        }
      };
      for (const idx of anchorAt.keys()) walkChain(list[idx].hash);
      // gitgraph 合并闭包镜像：合并行次父起沿首父链收「未被锚覆盖」的提交
      for (const c of list) {
        const ps = inPageParents(c);
        if (ps.length < 2) continue;
        for (const p of ps.slice(1)) {
          let cur = byHash.get(p);
          while (cur && !covered.has(cur.hash)) {
            covered.add(cur.hash);
            const cpp = inPageParents(cur);
            cur = cpp[0] ? byHash.get(cpp[0]) : null;
          }
        }
      }
      // 剩余未覆盖 = 页外断层泳道顶（合并提交在更早页）：「分支名·n」续锚补覆盖
      if (branchName) {
        let n = 1;
        list.forEach((c, i) => {
          if (covered.has(c.hash) || anchorAt.has(i)) return;
          n += 1;
          anchorAt.set(i, `${String(branchName)}·${n}`);
          walkChain(c.hash);
        });
      }
    }
    return list.map((c, i) => {
      const orig = (Array.isArray(c.parents) ? c.parents : []).filter((p) => shown.has(p));
      const parents = rewired ? (rewired.get(c.hash) || []) : orig;
      const refs = [];
      const anchor = anchorAt.get(i);
      if (anchor) refs.push(anchor);
      for (const tg of Array.isArray(c.tags) ? c.tags : []) refs.push(`tag: ${tg}`);
      const row = {
        hash: c.hash,
        parents,
        author: { name: String(c.author || ''), email: 'atb@local' },
        subject: `${c.short || String(c.hash).slice(0, 7)} ${c.subject || ''}`,
        refs,
      };
      if (orig.length >= 2) row.mergeParents = orig.length;
      return row;
    });
  }

  // gitgraph metro 模板定制（commit spacing / dot 尺寸 / message 等宽字体 + 短 hash 前缀已拼进
  // subject、不展示作者；分支线宽）。浅深两套色板由 prefersDark 决定。
  // BUG-20260921-007：colors 由 mountTree 按视图形态计算传入——单支单色板（全部泳道同色，
  // 翻页 / 断层续锚不跳变）；双支并集按「本页出现的 side」排色序（仅 dev 在页时 dev 色打头，
  // 避免单分支占 colors[0] 错染主分支蓝），配合 compareBranchesOrder 钉 main 恒蓝 / dev 恒黄。
  function treeTemplate(dark, colors) {
    const GG = window.GitgraphJS;
    return GG.templateExtend(GG.metroTemplate, {
      colors,
      branch: { lineWidth: 2 },
      commit: {
        spacing: 34,
        dot: { size: 9 },
        message: {
          displayAuthor: false,
          displayHash: false,
          font: 'normal 12px ui-monospace, Menlo, monospace',
          color: dark ? '#cccccc' : '#24292f',
        },
      },
    });
  }

  function prefersDark() {
    try {
      return typeof matchMedia === 'function' && !!matchMedia('(prefers-color-scheme: dark)').matches;
    } catch { return false; }
  }

  // 系统外观变化 → 重画树（一次性注册；浅深模板色板不同，须整体重放）
  let treeThemeWatched = false;
  function watchTreeTheme() {
    if (treeThemeWatched) return;
    treeThemeWatched = true;
    try {
      const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
      mq?.addEventListener?.('change', () => render());
    } catch { /* 测试桩环境无 matchMedia */ }
  }

  // 渲染后处理：高亮（highlight 模式命中清单）/ 选中 / 合并标识（message 文字样式 + 悬停说明）；
  // 首条命中滚动定位（scrollIntoView，容器内居中）。message 文本 = `<short> <subject>`（与
  // treeData 拼装口径一致，据此从 SVG text 反查提交）。
  function decorateTree(box, commits) {
    const matched = new Set(state.branchLog?.mode === 'highlight' && state.branchLog?.query === state.logQuery
      ? (state.branchLog.matchedHashes || []) : []);
    const msgOf = new Map(commits.map((c) => [`${c.short || String(c.hash).slice(0, 7)} ${c.subject || ''}`, c]));
    let firstHit = null;
    try {
      for (const txt of box.querySelectorAll('svg text')) {
        const c = msgOf.get(String(txt.textContent || '').trim());
        if (!c) continue;
        txt.classList?.toggle?.('hit', matched.has(c.hash));
        txt.classList?.toggle?.('sel', state.logSelected === c.hash);
        const pc = (Array.isArray(c.parents) ? c.parents : []).filter(Boolean).length;
        if (pc >= 2) {
          txt.classList?.add?.('gg-merge');
          if (typeof document.createElementNS === 'function') {
            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            title.textContent = `合并 · ${pc} 父提交`;
            txt.appendChild(title);
          }
        }
        if (matched.has(c.hash) && !firstHit) firstHit = txt;
      }
      if (matched.size && firstHit && firstHit.scrollIntoView) firstHit.scrollIntoView({ block: 'center' });
    } catch { /* 测试桩环境无完整 SVG DOM */ }
  }

  // 树挂载（bindCommon 渲染后调用）：vendor 脚本在位时以 import() 喂扁平 DAG（refs 自动出
  // 分支名 / tag 标签，泳道布局由库完成），每条提交注入 onClick（click 切换选中详情，
  // REQ-20260920-001 口径）；vendor 加载失败 / 渲染异常降级为行式列表（fallbackTreeHtml）。
  // BUG-20260921-007：vendor 渲染经 setTimeout 异步调度（next()），异步回调内的异常与
  // 「提交被可达过滤静默丢弃」都逃逸同步 try/catch——追加一个更晚的保底核查 tick：树容器
  // 无 SVG 或提交圆点数不足时降级行式列表，绝不出现空白内容区；渲染成功则补挂高亮 /
  // 选中 / 合并标识（decorateTree 在异步渲染完成后才有效）。双支并集传 compareBranchesOrder
  // 钉泳道色序，单支用单色板。
  function mountTree(view) {
    const GG = (typeof window !== 'undefined' && window.GitgraphJS) || null;
    const box = view.querySelector('#bldTreeBox');
    if (!GG || !box) return;
    const commits = state.branchLog?.commits || [];
    if (!commits.length || !state.logBranch) return;
    const heads = Array.isArray(state.branchLog?.heads) ? state.branchLog.heads : [];
    const dualNames = dualLogNames(heads, commits);
    // BUG-20260921-007：色板按本页 side 出现情况排头（仅 dev 在页 → dev 色打头；仅 main → 主色打头；
    // 双侧 → 全色板 + 比较器钉序）；单支单色板。同一提交在任何页码恒得本侧颜色。
    const base = prefersDark() ? TREE_COLORS_DARK : TREE_COLORS_LIGHT;
    const colors = dualNames
      ? (commits.some((c) => c.side === 'dev')
        ? (commits.some((c) => c.side !== 'dev') ? base : [base[1], ...base.slice(2), base[0]])
        : base)
      : [base[0]];
    const data = treeData(commits, { heads, branchName: state.logBranch });
    for (const c of data) c.onClick = () => selectLogRow(c.hash, { toggle: true });
    try {
      box.innerHTML = '';
      const graph = GG.createGitgraph(box, {
        orientation: 'vertical-reverse',
        template: treeTemplate(prefersDark(), colors),
        author: 'atb <atb@local>',
        ...(dualNames ? { compareBranchesOrder: laneOrderOf(dualNames) } : {}),
      });
      graph.import(data);
    } catch {
      box.innerHTML = fallbackTreeHtml(commits);
      return;
    }
    if (typeof setTimeout === 'function') {
      // 保底核查：注册晚于 vendor 的渲染 tick（同延迟 FIFO），在其后执行
      setTimeout(() => {
        try {
          const svg = box.querySelector('svg');
          const dots = svg ? svg.querySelectorAll('circle').length : 0;
          if (!svg || dots < commits.length) {
            box.innerHTML = fallbackTreeHtml(commits);
            return;
          }
          decorateTree(box, commits);
        } catch {
          box.innerHTML = fallbackTreeHtml(commits);
        }
      }, 0);
    }
    decorateTree(box, commits);
    watchTreeTheme();
  }

  // 降级行列表（vendor 脚本加载失败 / 渲染异常时保底可读可交互；与树共享同一数据与详情口径）
  function fallbackTreeHtml(commits) {
    const heads = Array.isArray(state.branchLog?.heads) ? state.branchLog.heads : [];
    const dual = heads.length >= 2;
    const mergeBase = state.branchLog?.mergeBase || null;
    const sideMap = new Map(commits.map((c) => [c.hash, c.side]));
    const headByHash = new Map(heads.map((x) => [x.hash, x.name]));
    return `<ul class="bld-log">${commits.map((c) => {
      const mergeTag = (Array.isArray(c.parents) ? c.parents : []).length >= 2
        ? `<span class="bld-merge-tag">合并 · ${c.parents.length} 父提交</span>` : '';
      const headName = dual ? headByHash.get(c.hash) : null;
      const headTag = headName ? `<span class="bld-branch-tag bt-${sideMap.get(c.hash) === 'dev' ? 'dev' : 'main'}">${esc(headName)}</span>` : '';
      const mbTag = dual && mergeBase && c.hash === mergeBase
        ? '<span class="bld-branch-tag bt-mb" title="main 与 dev 的汇聚点（merge-base）">Merge-base</span>' : '';
      const tagChips = (c.tags || []).map((tg) => `<span class="bld-tag-chip" title="标签">${esc(tg)}</span>`).join('');
      return `<li><button type="button" class="bld-log-row${state.logSelected === c.hash ? ' sel' : ''}" data-log-row="${esc(c.hash)}"><code>${markMatch(c.short || c.hash.slice(0, 8), state.logQuery)}</code> ${headTag}${mbTag}${tagChips}<span>${markMatch(c.subject, state.logQuery)}</span>${mergeTag}<span class="muted small">${markMatch(c.author, state.logQuery)} · ${esc(fmtTime(c.date))}</span></button></li>`;
    }).join('')}</ul>`;
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

  // REQ-20260922-006：建议版本号预填值——既有版本中最大 x.y.z 的 patch+1（无历史 0.1.0）。
  // 仅作表单预填建议，实际分配以服务端校验为准（空 / 重复 / 非法由服务端报错回显）。
  function suggestNextVersion() {
    let best = null;
    for (const v of state.data?.versions || []) {
      const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v.version || ''));
      if (!m) continue;
      const cur = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (!best
        || cur[0] > best[0]
        || (cur[0] === best[0] && (cur[1] > best[1] || (cur[1] === best[1] && cur[2] > best[2])))) best = cur;
    }
    return best ? `${best[0]}.${best[1]}.${best[2] + 1}` : '0.1.0';
  }

  async function openCreatePanel() {
    // REQ-20260927-002：关联提交整组自动关联——勾选即关联该条目全部自动口径提交（候选行
    // commitMeta 直读），无逐个提交默认选中逻辑（旧 commits[it.itemId] = it.commits[0] 移除）。
    state.createPanel = { candidates: null, picked: new Set(), broadOpen: new Set(), name: '', version: suggestNextVersion(), totalDone: null, busy: false, error: null, loadError: null };
    render();
    try {
      const r = await api('/candidates');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      const occupied = occupiedItemIds(state.data?.versions); // BUG-20260914-004：已纳入任一版本的条目不进候选
      state.createPanel.candidates = doneCandidates(data.items || []).filter((x) => !occupied.has(x.itemId)); // BUG-20260913-001：仅 done 条目进候选
      state.createPanel.totalDone = Number.isInteger(data.totalDone) ? data.totalDone : null;
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

  // 全选 / 全不选：仅对「可整组自动关联提交」的条目生效；返回跳过的无关联提交条目数。
  // BUG-20260914-002：与 pickItem 同口径在内部统一 render——点击后复选框 / 「已选 N 项」计数 /
  // 关联提交展开区立即同步，避免内部 picked 集合与界面显示错位（跳过提示由调用方补充 toast）。
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

  // REQ-20260927-002：宽口径命中折叠行展开 / 收起（只读，不影响勾选集合与保存 payload）。
  function toggleBroadHits(panelKey, itemId) {
    const p = state[panelKey];
    if (!p) return;
    if (p.broadOpen.has(itemId)) p.broadOpen.delete(itemId); else p.broadOpen.add(itemId);
    render();
  }

  async function submitCreate() {
    const p = state.createPanel;
    if (!p) return;
    // REQ-20260927-002：payload 条目 commits 为整组自动关联提交数组（每项 40 位 hash），
    // 不再有单值 commit 选择；两面板（创建版本 / 添加条目）行为一致。
    const items = [...p.picked].map((itemId) => ({
      itemId,
      commits: autoAssociationOf((p.candidates || []).find((x) => x.itemId === itemId)).map((m) => m.hash),
    }));
    if (!items.length) {
      p.error = '请至少勾选一个条目（无关联 commit 的条目不可纳入版本）';
      render();
      return;
    }
    p.busy = true;
    p.error = null;
    render();
    try {
      const r = await post('/version', { name: p.name, version: String(p.version || '').trim(), items });
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

  /* ---------- REQ-20260921-014 概况页签显式编辑版本名称与描述 ---------- */

  // 客户端校验（纯函数，渲染与测试共用）——镜像 build-store validateInfo 与
  // 「版本名称不能为空」口径：名称 trim 后判空与计长，描述不 trim 计长；
  // 返回 { field: 'name'|'desc', error } 或 null（合法）。仅就地拦截不发请求，
  // 数据层校验兜底双保险（沿用 AI 完善表单 REQ-20260913-006 口径）。
  function validateVersionInfo(name, description) {
    const n = String(name ?? '').trim();
    const d = String(description ?? '');
    if (!n) return { field: 'name', error: '版本名称不能为空' };
    if (n.length > INFO_NAME_MAX) return { field: 'name', error: `版本名称不超过 ${INFO_NAME_MAX} 字` };
    if (d.length > INFO_DESC_MAX) return { field: 'desc', error: `版本描述不超过 ${INFO_DESC_MAX} 字` };
    return null;
  }

  // 当前选中版本的概况页签编辑态（版本不匹配返回 null，旧表单自然失效不渲染）
  function planEditOf(v) {
    return state.planEdit && state.planEdit.id === v?.id ? state.planEdit : null;
  }

  // 打开概况页签就地编辑表单：预填当前名称与描述，焦点落名称输入框；merging 锁定不放行
  //（入口按钮已禁用，此处为防御路径并 toast 原因）。与遗留行内编辑（state.edit 单字段）
  // 互斥：打开表单即收起行内编辑。
  function openPlanEdit() {
    const v = selVersion();
    if (!v) return;
    if (v.status === 'merging') { toast('版本合并中，暂不可修改', true); return; }
    state.edit = null;
    state.planEdit = { id: v.id, name: v.name ?? '', description: v.description ?? '', error: null, busy: false };
    render();
    try { $('#bldPlanNameInput')?.focus(); } catch { /* 测试环境无 DOM focus */ }
  }

  // 取消：放弃未保存修改回展示态（保存中不响应，按钮已禁用、此处防御）
  function cancelPlanEdit() {
    const pe = state.planEdit;
    if (!pe || pe.busy) return;
    state.planEdit = null;
    render();
  }

  // 重渲染前把表单输入框当前值回写 state.planEdit（与 syncAnswerDraft 同口径），
  // 防后台 refresh 等重渲染冲掉未保存草稿；输入监听也即时回写（双保险）。
  // 仅在表单已在当前 DOM 时同步（首次打开前无可同步输入，保持 state 预填值）。
  function syncPlanEditDraft() {
    const pe = state.planEdit;
    if (!pe) return;
    const view = $('#buildView');
    if (!view || !String(view.innerHTML || '').includes('bld-plan-name')) return;
    const n = view.querySelector('.bld-plan-name');
    const d = view.querySelector('.bld-plan-desc');
    if (n) pe.name = n.value ?? pe.name;
    if (d) pe.description = d.value ?? pe.description;
  }

  // 保存：名称与描述经同一请求提交（POST /version/save）；客户端校验就地拦截（不发请求、
  // 聚焦出错字段）；保存中按钮禁用防重复提交；失败（网络 / 服务端错误含 merging 409）就地
  // 显示原因 + toast，表单内容保留可重试或取消
  async function submitPlanEdit() {
    const pe = state.planEdit;
    if (!pe || pe.busy) return;
    syncPlanEditDraft();
    const bad = validateVersionInfo(pe.name, pe.description);
    if (bad) {
      pe.error = bad.error;
      render();
      try { $(bad.field === 'name' ? '#bldPlanNameInput' : '#bldPlanDescInput')?.focus(); } catch { /* 测试环境无 DOM focus */ }
      return;
    }
    pe.busy = true;
    pe.error = null;
    render();
    try {
      const r = await post('/version/save', { id: pe.id, name: pe.name, description: pe.description });
      if (!r.ok) throw new Error(await errOf(r, '保存失败'));
      state.planEdit = null;
      toast('✓ 已保存版本信息');
      await refresh(); // 成功就地刷新：详情头部 / 概况页签 / 左侧版本列表同步更新
    } catch (e) {
      pe.busy = false;
      pe.error = e.message;
      render();
      toast(`✕ 保存失败：${e.message}`, true);
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
    // REQ-20260927-002：与创建面板同口径——整组自动关联，无逐个提交默认选中逻辑。
    state.addPanel = { verId: v.id, candidates: null, picked: new Set(), broadOpen: new Set(), totalDone: null, busy: false, error: null, loadError: null };
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
    } catch (e) {
      state.addPanel.loadError = e.message;
    }
    render();
  }

  async function submitAdd() {
    const p = state.addPanel;
    if (!p) return;
    // REQ-20260927-002：与创建面板一致——payload 条目 commits 为整组自动关联提交数组。
    const items = [...p.picked].map((itemId) => ({
      itemId,
      commits: autoAssociationOf((p.candidates || []).find((x) => x.itemId === itemId)).map((m) => m.hash),
    }));
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

  // REQ-20260921-013：入口位于详情概况页签操作行，按 verId 打开（对当前选中版本生效）；
  // 不带参时回落当前选中版本（向后兼容），带参但版本已不存在时不弹窗。
  // BUG-20260928-005：锁定基准 = 发布确认（正式发布）——发布按钮二次确认后不允许再 AI 完善
  //（卡片按钮已禁用），此处对带参直调与无参回落两条路径兜底校验（merging 同步收口），锁定态
  // 一律不弹窗；merged（含已推送未确认）放开，可完整走通复制 → 解析 → 应用回填。
  function openAnswerModal(verId) {
    const v = verId ? findVersion(verId) : selVersion();
    if (!v) return;
    if (v.status === 'merging' || releasedOf(v)) return;
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
        // BUG-20260922-001（hold q1 人工决策：通用化处理）：手动打开指引不并列宿主名，改通用口径
        + '<span class="muted small">或直接打开您使用的 Agent 客户端手动新建会话并粘贴提示词</span>';
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
  // 返回 '' 表示可合并）。优先级：全局合并执行中 > 版本 merging > 已正式发布（BUG-20260928-005
  // 基准，发布确认后锁定，merged 含已推送未确认可增量重开）> 五步门禁（暂无关联条目 / 文档未编写 / 未提交 / 范围过期，
  // 口径同 publishStepsState 与服务端守卫）> 不在 dev（含 detached HEAD）。
  // 门禁与分支仅当前选中版本已加载五步装配（pfOf(v).plan）时可知；未加载时不猜测，
  // 放行至确认后由后端守卫 409 + toast 给出真实原因（反馈链路完整，不误报）。
  // REQ-20260921-015：末档增补混合提交（mergeAnalysis.blocked）——服务端合并前置确定性
  // 阻止，装配已加载时纳入 title / toast 归因（截断首条；完整原因见隔离分析单行 title）。
  function mergeBlockReason(v) {
    if (!v) return '';
    if (state.mergeBusy || v.status === 'merging') return '合并中，请勿重复触发';
    if (releasedOf(v)) return '已正式发布，不可再合并（如需调整请新建版本）';
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

  /* ---------- REQ-20260926-002 文档合并（第四步动作） ---------- */

  // 把审核通过的发布文档提交合入 main（POST /api/build/docs/merge）：dmBusy 执行中防重复
  // 触发；merging / 已正式发布点击 toast 真实原因不静默；重试幂等（已合入的文档提交不重复
  // 执行，alreadyIncluded 如实反馈）；失败 toast 原因可重试，已完成结果保留。
  async function doDocsMerge(verId) {
    const v = verId ? findVersion(verId) : selVersion();
    if (!v) {
      toast('未找到该版本（可能已被删除）：请刷新页面后重试', true);
      return;
    }
    const pf = pfOf(v);
    if (!pf || pf.dmBusy) return;
    if (v.status === 'merging') {
      toast('合并中，请勿重复触发', true);
      return;
    }
    if (releasedOf(v)) {
      toast('已正式发布，范围锁定（如需调整请新建版本）', true);
      return;
    }
    pf.dmBusy = true;
    render();
    try {
      const r = await post('/docs/merge', { id: v.id });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `文档合并失败（${r.status}）`);
      if (data.alreadyIncluded) toast(`✓ 文档已合并入 main（重试幂等，不重复执行；${v.id}）`);
      else toast(`✓ 文档已合并入 main（${v.id}）`);
    } catch (e) {
      toast(`✕ 文档合并失败：${e.message}`, true);
    } finally {
      pf.dmBusy = false;
      await refresh();
      await ensurePublishPlan(true);
      if (state.pf) render();
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

  // BUG-20260928-002 发布二次确认（极简）：点击「发布」直接弹确认，确认即授权一键发布链路
  //（自动创建草稿并预检再启动，doOneClickPublish）；取消不发出任何执行请求。
  // 存量计划无 version 字段时在弹窗内补填发行版本号（REQ-20260922-006 预填口径保留）。
  function openPublishConfirm(verId) {
    const v = verId ? findVersion(verId) : selVersion();
    if (!v) return;
    if (v.status !== 'merged') {
      toast('仅已合并（merged）的版本计划可发布：请先完成「合并入 main」', true);
      return;
    }
    const rel = relOf(v);
    if (rel?.publishBusy) return;
    if (rel && !rel.config?.homepageRepoRoot) {
      toast('请先配置官网仓库后再发布', true);
      return;
    }
    state.releaseConfirm = { verId: v.id, version: v.version ? String(v.version).replace(/^v/, '') : '', busy: false, error: null };
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
      // BUG-20260928-002 一键发布链路：执行中标记（发布条按钮「启动中…」）与中止原因就近反馈
      publishBusy: false, publishError: null,
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

  /* ---------- REQ-20260920-003 发布流程数据（publish-plan / docs / release）；
     REQ-20260921-008 文档编写页三段式流水线（总结 → 审查 → 提交） ---------- */

  function defaultPf(verId) {
    return {
      verId, seq: 0, phase: 'idle', error: null, plan: null,
      busy: false, commitMsg: null, refreshing: false,
      // AI 总结：start 后的提示词预览 { text }（复制到剪贴板交给 AI Agent 执行）
      prompt: null,
      // REQ-20260921-010 语言集输入：langsInput（输入中草稿，重渲染不丢字）、langsErr
      //（行内校验 / 保存错误）、langsBusy（保存中禁用）
      langsInput: null, langsErr: null, langsBusy: false,
      // REQ-20260922-003 自定义文档：addDoc = 内联添加行 { open, input, err, busy, focus }
      //（草稿重渲染不丢字）；docBusy = 移除请求进行中防重复触发
      addDoc: null, docBusy: false,
      // 审查对话框（BUG-20260925-006 起只读核对 + 通过审核，编辑一律走「② 二次编辑」弹窗）：
      // { open, key（文档类型页签）, contents: { file: 文本 }, busy }
      review: null,
      // REQ-20260922-005 选择开源协议弹框：{ open, sel(选中 SPDX id), busy(写入中),
      // loading(目录加载中), error(加载失败), list(协议目录，含标准文本) }
      license: null,
      siteBusy: false,
      // REQ-20260924-006 二次编辑弹窗（默认语言单语言）：edit = { open, file, mode:
      // 'edit'|'preview', content(草稿), disk(最近已知磁盘内容，null=读取中/读取失败),
      // busy(保存中), loadErr, pending(未保存保护挂起动作), savedNote, pendingFocus }
      edit: null,
      // REQ-20260924-006 AI 校对建议：chkFile（侧栏选中文件）、chkDecisions（决断会话态
      //'runId|file|idx' → accepted/rejected/stale——BUG-20260925-002：从 plan.docsCheck.decisions
      // 播种并逐条落库持久化，见 seedChkDecisions / persistChkDecision）、chkBusy（接受请求进行中）
      chkFile: null, chkDecisions: null, chkBusy: null,
      // BUG-20260925-001 滚动保留：chkAnchor（接受 / 拒绝后待锚定的条目 { runId, file, idx }，
      // 决断渲染一次性消费；busy 中间渲染保留）、chkScrollReset（主动换文件后列表从顶部开始）
      chkAnchor: null, chkScrollReset: false,
      // REQ-20260926-002 文档合并步：dmBusy 执行中防重复触发（按钮「合并中…」）
      dmBusy: false,
      // BUG-20260925-004 关闭编辑界面后的后台静默同步失败信息（轻量横幅 + 重试入口的
      // 数据；成功同步 / 常规强刷成功清空，窗格内容与 phase 不受失败影响）
      syncErr: null,
    };
  }

  const pfOf = (v) => (state.pf && state.pf.verId === v.id ? state.pf : null);

  // 拉取五步装配（GET publish-plan，只读；steps 门禁 / 文档四态与提交状态 / AI 总结进度 /
  // 官网提示词 / 影响分析 / 发布状态）。force 用于动作完成后的刷新（「刷新」按钮同此入口）；
  // 迟到响应按闭包身份 + seq 丢弃。
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
      pf.syncErr = null; // BUG-20260925-004：常规加载成功即撤后台同步失败横幅
      seedChkDecisions(pf); // BUG-20260925-002：决断从服务端账本重播种（刷新 / 切版本重进不丢）
    } catch (e) {
      if (state.pf !== pf || pf.seq !== seq) return;
      pf.plan = null;
      pf.phase = 'error';
      pf.error = e.message;
    }
    render();
  }

  // BUG-20260925-004 关闭编辑界面（审查对话框 / ② 二次编辑弹窗）后的重渲染保持 #buildView
  //（.build-view 滚动容器）滚动位置：render() 为全量 innerHTML 重建（BUG-20260925-001 注释
  // 已佐证），替换瞬间滚动高度塌陷 scrollTop 归零；窗格内文件列表随整页滚动（bld-docs-list
  // 自身不滚），重建前记忆、重建后恢复即可不回顶。
  function renderPreservingDocsScroll() {
    const view = $('#buildView');
    const top = view ? view.scrollTop : null;
    render();
    if (view && typeof top === 'number' && top > 0) {
      try { view.scrollTop = top; } catch { /* 测试沙箱滚动容器不可写：忽略 */ }
    }
  }

  // BUG-20260925-004 关闭编辑界面后的后台静默同步（替代原关闭路径的 ensurePublishPlan(true)
  // 强刷——先置 phase=loading 再整块重建导致「关闭 = 整页刷新」闪烁与滚动丢失）。口径：
  // - 未就绪 / 无数据回落常规 ensurePublishPlan(true)（首次进入仍走既有加载占位）；
  // - 成功：数据有变化才保持滚动重绘（状态徽标 / 门禁 / 计数随新数据更新），无变化不重绘；
  // - 失败：保留现有内容（plan / phase 不动，不进整页 error 态），pf.syncErr 轻量横幅 +
  //   重试入口；迟到响应按闭包身份 + seq 丢弃（与 ensurePublishPlan 同口径）。
  async function syncDocsPlanSilently() {
    const v = selVersion();
    if (!v || !state.project) return;
    const pf = pfOf(v);
    if (!pf) return;
    if (pf.phase !== 'ready' || !pf.plan) { await ensurePublishPlan(true); return; }
    const seq = ++pf.seq;
    try {
      const r = await fetch(`/api/build/publish-plan?project=${encodeURIComponent(state.project)}&id=${encodeURIComponent(v.id)}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      if (state.pf !== pf || pf.seq !== seq) return;
      if (JSON.stringify(pf.plan) === JSON.stringify(data)) {
        if (pf.syncErr) { pf.syncErr = null; renderPreservingDocsScroll(); } // 仅撤失败横幅，内容不动
        return;
      }
      pf.plan = data;
      pf.syncErr = null;
      seedChkDecisions(pf); // 数据替换后决断重播种（BUG-20260925-002 口径不回归）
      renderPreservingDocsScroll();
    } catch (e) {
      if (state.pf !== pf || pf.seq !== seq) return;
      pf.syncErr = e.message; // 轻量提示（renderDocsPane 横幅 + 重试），内容与 phase 保持
      renderPreservingDocsScroll();
    }
  }

  // REQ-20260921-008「刷新」：重新从磁盘读取全部文件内容与状态（外部 IDE 修改后取回最新）；
  // 加载期间按钮禁用 + 列表读取中反馈；失败走 pf.phase=error（副标题按钮保留 + 错误横幅 + 重试）
  async function refreshDocsPane() {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf || pf.refreshing) return;
    pf.refreshing = true;
    render();
    try {
      await ensurePublishPlan(true);
      if (pf.review?.open) await loadReviewPair(pf.review.key);
      const n = (pf.plan?.docsFlow?.files || []).length || docFilesOf(pf.plan?.langs, pf.plan?.customDocs).length;
      toast(`已刷新：${n} 个文件已同步为磁盘最新内容`);
    } finally {
      pf.refreshing = false;
      if (state.pf === pf) render();
    }
  }

  // REQ-20260921-010「语言集」应用（回车 / 失焦确认）：客户端镜像校验先行（非法就地报错、
  // 不发请求、界面保持上次有效状态），合法则保存到版本记录并强制刷新五步装配——文件列表、
  // 门禁、审查对话框列、AI 总结提示词全部按新语言集联动。
  async function applyDocLangs(raw) {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf || pf.langsBusy || !state.project || pf.phase !== 'ready') return;
    const cur = (pf.plan?.langs || DEFAULT_DOC_LANGS).join(',');
    const r = validateLangSetInput(raw);
    if (r.error) {
      pf.langsErr = r.error; // 不应用非法值，界面保持上次有效状态
      if (state.pf === pf) render();
      toast(`✕ 语言集未应用：${r.error}`, true);
      return;
    }
    pf.langsErr = null;
    const next = r.langs.join(',');
    if (next === cur) {
      pf.langsInput = null;
      if (state.pf === pf) render();
      return;
    }
    pf.langsBusy = true;
    render();
    try {
      const resp = await fetch(`/api/build/docs/langs?project=${encodeURIComponent(state.project)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id, langs: next }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `保存失败（${resp.status}）`);
      pf.langsInput = null;
      if (pf.review?.open) { pf.review.contents = {}; } // 语言集变化：对话框按新清单重建（只读预览，无编辑草稿）
      await ensurePublishPlan(true);
      if (pf.review?.open) await loadReviewPair(pf.review.key);
      toast(`✓ 语言集已应用：${next}（文档清单 4 类 × ${r.langs.length} 语言 + LICENSE 单文件）`);
    } catch (e) {
      pf.langsErr = e.message; // 保存失败：保持上次有效语言集，可改后重试
      toast(`✕ 语言集保存失败：${e.message}`, true);
    } finally {
      pf.langsBusy = false;
      if (state.pf === pf) render();
    }
  }

  // REQ-20260921-008「AI 总结」：启动一轮逐文件总结（独立锁）+ 复制提示词到剪贴板；
  // 已有进行中的任务由服务端 400 明确提示（提示词仍可从预览复制）。
  // REQ-20260922-005：LICENSE.md 未编写时先弹「选择开源协议」框（表格：定义 / 官网 / 优劣；
  // 002 口径 B 下 LICENSE 不进 AI 总结，按「AI 总结」按钮时点拦截引导人工选择）——
  // 选中写入标准文本或暂不选择后再继续原启动；关闭（✕ / Esc / 遮罩）不启动。
  function startSummary() {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf || pf.busy || !state.project || pf.phase !== 'ready') return;
    if (licenseGuardNeeded()) { openLicensePicker(); return; }
    doStartSummary();
  }

  // 弹框触发条件：当前版本文档清单里 LICENSE.md（单文件类，002 A1 口径）状态 = 未编写
  //（在盘（待审核 / 已审核）不弹框，用户改协议 = 审查对话框人工编辑，不走快捷入口）。
  function licenseGuardNeeded() {
    const pf = state.pf;
    if (!pf || pf.phase !== 'ready' || !pf.plan) return false;
    const flowEval = normalizeFlowEval(pf.plan);
    const lic = (flowEval.files || []).find((f) => f.single && !f.custom && f.file === 'LICENSE.md');
    return !!lic && lic.state === 'unwritten';
  }

  function openLicensePicker() {
    const pf = state.pf;
    if (!pf) return;
    const reuse = pf.license?.list || null; // 已拉取过的目录直接复用（重开不重复请求）
    pf.license = { open: true, sel: null, busy: false, loading: !reuse, error: null, list: reuse };
    render();
    if (!reuse) loadDocLicenses();
  }

  // 协议目录拉取（弹框打开时一次；迟到响应按 pf 身份 + 弹框状态丢弃）
  async function loadDocLicenses() {
    const pf = state.pf;
    if (!pf?.license?.open || !state.project) return;
    const stamp = ++pf.seq;
    try {
      const r = await fetch(`/api/build/doc-licenses?project=${encodeURIComponent(state.project)}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      if (state.pf !== pf || !pf.license?.open || pf.seq !== stamp) return;
      pf.license.list = Array.isArray(data.licenses) ? data.licenses : [];
      pf.license.loading = false;
      pf.license.error = null;
    } catch (e) {
      if (state.pf !== pf || !pf.license?.open) return;
      pf.license.loading = false;
      pf.license.error = e.message;
    }
    if (state.pf === pf) render();
  }

  // 确认所选协议：以目录标准文本走既有 /api/build/docs/save 白名单通道写入 LICENSE.md
  //（002 口径：状态转「待审核」，人工在「审查」中通过审核；本单不新增写入口径）→
  // 关框后继续原 AI 总结启动。
  async function confirmLicensePick() {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    const lic = pf?.license;
    if (!lic?.open || lic.busy || !state.project) return;
    const entry = (lic.list || []).find((x) => x.id === lic.sel);
    if (!entry || !entry.text) return;
    lic.busy = true;
    render();
    try {
      const r = await fetch(`/api/build/docs/save?project=${encodeURIComponent(state.project)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id, file: 'LICENSE.md', content: entry.text }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `保存失败（${r.status}）`);
      if (data.docsFlow) pf.plan = { ...(pf.plan || {}), docsFlow: data.docsFlow };
      pf.license = null;
      toast(`✓ LICENSE.md 已写入（${entry.name} 标准文本）：转为「待审核」，请在「审查」中人工确认`);
      await doStartSummary();
    } catch (e) {
      toast(`✕ 写入 LICENSE.md 失败：${e.message}（弹框保留，可重试或暂不选择）`, true);
    } finally {
      if (pf.license) lic.busy = false;
      if (state.pf === pf) render();
    }
  }

  // 暂不选择：不写盘，关框后照常启动 AI 总结（LICENSE 本不在总结范围，不冲突）。
  function skipLicensePick() {
    const pf = state.pf;
    if (!pf?.license || pf.license.busy) return;
    pf.license = null;
    render();
    doStartSummary();
  }

  // ✕ / Esc / 遮罩关闭：不写盘也不启动（再点「AI 总结」可重来）。
  function closeLicensePicker() {
    const pf = state.pf;
    if (!pf?.license || pf.license.busy) return;
    pf.license = null;
    render();
  }

  async function doStartSummary() {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf || pf.busy || !state.project || pf.phase !== 'ready') return;
    pf.busy = true;
    render();
    try {
      const r = await fetch(`/api/build/docs-summary/start?project=${encodeURIComponent(state.project)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `启动失败（${r.status}）`);
      pf.prompt = { text: data.prompt };
      pf.plan = { ...(pf.plan || {}), summary: data.run };
      const ok = await copyText(data.prompt);
      if (ok) toast('✓ AI 总结提示词已复制：交给 AI Agent 逐文件执行，进度在本页与任务模块自动刷新');
      else toast('提示词已生成但复制失败：请在下方提示词文本框中全选（⌘A）并手动复制', true);
      render();
    } catch (e) {
      toast(`✕ AI 总结启动失败：${e.message}`, true);
    } finally {
      pf.busy = false;
      if (state.pf === pf) render();
    }
  }

  // REQ-20260921-012「AI 翻译」：启动一轮逐文件翻译（独立锁 translate.lock）+ 复制提示词到
  // 剪贴板；默认语言 4/4 已审核前服务端 400 明确提示（提示词仍可从预览复制）；启动前服务端
  // 已做基准变更检测——响应带 baselineShift 时提示「基准已更新，按最新基准翻译」。
  async function startTranslation() {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf || pf.busy || !state.project || pf.phase !== 'ready') return;
    // REQ-20260924-006 ④ 步门禁：最新校对轮未处理的建议先逐条接受 / 拒绝（阻止误以为
    // 校对结束；翻译基准取处理完建议并保存后的最新默认语言文档）。旧提取口径兼容：typeof
    // 守卫使 vm 中未提取 chkPendingCount 的既有单测按 0 处理。
    const pendingChk = typeof chkPendingCount === 'function' ? chkPendingCount(pf.plan, pf.chkDecisions) : 0;
    if (pendingChk > 0) {
      toast(`AI 翻译未解锁：尚有 ${pendingChk} 条校对建议未处理（逐条接受或拒绝后解锁，见右侧校对建议栏）`, true);
      return;
    }
    // aria-disabled 按钮（HTML disabled 不派发 click）：点击给真实缺口反馈
    const flowEval = normalizeFlowEval(pf.plan || {});
    if (flowEval.canTranslate !== true) {
      const gap = (flowEval.translateMissing || []).map((m) => `${m.file}（${DOCS_FLOW_LABEL[m.state] || m.state}）`).join('、');
      // REQ-20260924-006 单语言版本：默认语言全审且无剩余语言 → 无翻译目标，明确可跳过
      if (!gap && !(flowEval.restFiles || []).length) {
        toast('语言集只有一个语言：无翻译目标，可跳过翻译（直接进行提交）');
        return;
      }
      toast(`AI 翻译未解锁：默认语言尚缺 ${(flowEval.translateMissing || []).length} 个文件审核（${gap || '无文件'}）`, true);
      return;
    }
    pf.busy = true;
    render();
    try {
      const r = await fetch(`/api/build/docs-translate/start?project=${encodeURIComponent(state.project)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `启动失败（${r.status}）`);
      pf.translatePrompt = { text: data.prompt };
      pf.plan = { ...(pf.plan || {}), translate: data.run };
      const ok = await copyText(data.prompt);
      if (ok) toast('✓ AI 翻译提示词已复制：交给 AI Agent 以已审核默认语言文档为基准逐文件翻译，进度在本页与任务模块自动刷新');
      else toast('提示词已生成但复制失败：请在下方提示词文本框中全选（⌘A）并手动复制', true);
      if (data.baselineShift && data.baselineShift.length) {
        toast(`基准已更新：${data.baselineShift.length} 个翻译文档将按最新基准重新翻译`, true);
      }
      render();
    } catch (e) {
      toast(`✕ AI 翻译启动失败：${e.message}`, true);
    } finally {
      pf.busy = false;
      if (state.pf === pf) render();
    }
  }

  // 「AI 校对」：启动默认语言文档核查（提示词覆盖链接有效性 / 错别字 / 语法与行文规范）；
  // 成功复制提示词，交给 AI Agent 执行，结果经 docscheck 账本轮询自动回显（文档编写页
  // 右侧建议栏）。REQ-20260924-006：③ 步入口直接可用；BUG-20260926-002：整体审查阶段与
  // 完结对核对话框去除后，本入口与右侧建议栏是校对结果的唯一呈现位。
  async function startProofread() {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf || pf.phase !== 'ready' || pf.proofBusy || !state.project) return;
    pf.proofBusy = true;
    render();
    try {
      const r = await fetch(`/api/build/docs-proofread/start?project=${encodeURIComponent(state.project)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `启动失败（${r.status}）`);
      pf.plan = { ...(pf.plan || {}), docsCheck: data.run };
      seedChkDecisions(pf); // BUG-20260925-002：新 run 决断从空账本播种（旧 run 决断不带入）
      const ok = await copyText(data.prompt);
      if (ok) toast('✓ AI 校对提示词已复制：交给 AI Agent 逐文件核查默认语言文档（错别字与行文规范），结果自动回执');
      else toast('提示词已生成但复制失败：请在下方提示词文本框中全选（⌘A）并手动复制', true);
    } catch (e) {
      toast(`✕ AI 校对启动失败：${e.message}`, true);
    } finally {
      pf.proofBusy = false;
      if (state.pf === pf) render();
    }
  }

  /* ---------- REQ-20260922-003 自定义文档：添加 / 移除（清单随版本记录持久化） ---------- */

  // 打开内联添加行（输入草稿重渲染不丢字；打开时聚焦一次）
  function openAddDoc() {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf || pf.phase !== 'ready') {
      toast('发布流程数据未就绪：请先刷新或重试后再添加自定义文档', true);
      return;
    }
    pf.addDoc = { open: true, input: '', err: null, busy: false, focus: true };
    render();
  }

  function closeAddDoc() {
    const pf = state.pf;
    if (!pf?.addDoc || pf.addDoc.busy) return; // 添加请求进行中不误关
    pf.addDoc = null;
    render();
  }

  // 提交添加：客户端镜像校验先行（不发请求、非法值不应用），通过后交服务端权威校验并
  // 持久化；成功后强制刷新五步装配——文件列表（每个语言页签各一行）、表头与页签计数、
  // 门禁条、AI 总结 / AI 翻译提示词预览全部按新清单联动（其余语言文件由「AI 翻译」产出）。
  async function submitAddDoc() {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf?.addDoc?.open || pf.addDoc.busy || !state.project || pf.phase !== 'ready') return;
    const existing = pf.plan?.customDocs || [];
    // BUG-20260922-002：语言集参与展开重名比对（与服务端同口径）
    const r = validateCustomDocName(pf.addDoc.input, existing, pf.plan?.langs);
    if (r.error) {
      pf.addDoc.err = r.error; // 行内报错，不应用非法值
      if (state.pf === pf) render();
      toast(`✕ 添加失败：${r.error}`, true);
      return;
    }
    pf.addDoc.err = null;
    pf.addDoc.busy = true;
    render();
    try {
      const resp = await fetch(`/api/build/docs/custom?project=${encodeURIComponent(state.project)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id, op: 'add', name: pf.addDoc.input }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `添加失败（${resp.status}）`);
      pf.addDoc = null;
      await ensurePublishPlan(true);
      const langCount = (data.docsFlow?.files || []).filter((f) => f.custom).length
        || (pf.plan?.langs || DEFAULT_DOC_LANGS).length;
      toast(`✓ 已添加 ${r.key}.md（随语言集自动展开 ${langCount} 个语言文件，其余语言由「AI 翻译」产出）`);
    } catch (e) {
      if (pf.addDoc) { pf.addDoc.busy = false; pf.addDoc.err = e.message; }
      toast(`✕ 添加失败：${e.message}`, true);
      if (state.pf === pf) render();
    }
  }

  // 移除自定义文档（BUG-20260922-002 起整份移除）：AI 总结运行中禁用（按钮 disabled +
  // 守卫提示）；服务端另有运行中拦截与 merging / 已正式发布锁定；任一语言页签行尾的
  // 「移除」都按整份 KEY 生效——服务端同步删除该 KEY 全部语言文件（removedFiles 回传提示）
  // 并清理审核留痕，成功后联动刷新（清单 / 计数 / 提示词 / 门禁）。
  async function removeCustomDocFile(file) {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf || pf.phase !== 'ready' || !state.project || pf.docBusy) return;
    if (pf.plan?.summary?.phase === 'running') {
      toast('✕ AI 总结运行中，暂不可移除自定义文档', true);
      return;
    }
    const key = customDocKeyOfFile(pf.plan, file); // 展开文件名（KEY_<lang>.md）→ 整份 KEY
    if (!key) {
      toast(`✕ 移除失败：${file} 不是自定义文档文件`, true);
      return;
    }
    pf.docBusy = true;
    render();
    try {
      const resp = await fetch(`/api/build/docs/custom?project=${encodeURIComponent(state.project)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id, op: 'remove', key }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `移除失败（${resp.status}）`);
      await ensurePublishPlan(true);
      toast(`已移除自定义文档 ${key}（已删除 ${(data.removedFiles || []).length} 个磁盘文件）`);
    } catch (e) {
      toast(`✕ 移除失败：${e.message}`, true);
    } finally {
      pf.docBusy = false;
      if (state.pf === pf) render();
    }
  }

  /* ---------- REQ-20260921-008 审查对话框（中英双栏同步滚动；010 起 N 栏） ---------- */

  // BUG-20260925-006：审查对话框收敛为只读核对 + 通过审核——不再接受 { file, line } 跳转
  // 目标（原「AI 校对修改」跳入编辑态的入口已改走 openSecondaryEdit），恒开 README 页签、
  // 全栏预览态；文档编辑一律走「② 二次编辑」弹窗。
  function openReview() {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf || pf.phase !== 'ready') {
      toast('发布流程数据未就绪：请先刷新或重试后再审查', true);
      return;
    }
    pf.review = { open: true, key: 'README', contents: {}, busy: false };
    render();
    loadReviewPair(pf.review.key);
  }

  function closeReview() {
    const pf = state.pf;
    if (!pf?.review) return;
    pf.review = null;
    // BUG-20260925-004：关闭是轻量本地操作——只摘对话框元素，窗格 DOM 不整块重建
    //（原关闭即强制刷新：先置 loading 占位再整块重建，导致闪烁与滚动 / 页签丢失）；
    // 最新四态与门禁由后台静默同步按需更新。BUG-20260925-006：对话框已只读，无编辑
    // 草稿需回同步。
    $('#bldReviewWrap')?.remove();
    syncDocsPlanSilently();
  }

  // 切换类型页签：读目标页签全语言文件内容（只读预览，无草稿回同步）
  function switchReviewTab(key) {
    const pf = state.pf;
    if (!pf?.review?.open || pf.review.key === key) return;
    pf.review.key = key;
    render();
    loadReviewPair(key);
  }

  // 读取某类型页签的全语言文件（GET docs；content null 显示读取中）；REQ-20260921-010 起
  // 列随语言集动态（原中英双栏泛化为 N 栏）
  async function loadReviewPair(key) {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf?.review?.open || !state.project) return;
    const pair = docFilesOf(pf.plan?.langs, pf.plan?.customDocs).filter((f) => f.key === key);
    const stamp = ++pf.seq;
    await Promise.all(pair.map(async (f) => {
      try {
        const r = await fetch(`/api/build/docs?project=${encodeURIComponent(state.project)}&id=${encodeURIComponent(v.id)}&file=${encodeURIComponent(f.file)}`);
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
        if (state.pf !== pf || pf.seq !== stamp || !pf.review?.open || pf.review.key !== key) return;
        pf.review.contents[f.file] = data.content == null ? '' : data.content;
      } catch (e) {
        toast(`✕ ${f.file} 读取失败：${e.message}`, true);
        if (state.pf === pf && pf.review?.open) pf.review.contents[f.file] = '';
      }
    }));
    if (state.pf === pf && pf.review?.open && pf.review.key === key) render();
  }

  // 「通过审核」：直接以磁盘内容为审核基准记录（BUG-20260925-006：对话框内已无编辑草稿，
  // 不再有「未保存草稿先保存再审核」的过渡——内容改动一律经「② 二次编辑」保存，已审核文件
  // 改动保存后回退待审核再重新通过审核）；此后内容再变自动回退待审核（服务端每次求值读盘
  // 比对，口径不变）。
  async function approveReviewFile(file) {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf?.review?.open || pf.review.busy || !state.project) return;
    pf.review.busy = true;
    render();
    try {
      const r = await fetch(`/api/build/docs/review?project=${encodeURIComponent(state.project)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id, file }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `审核失败（${r.status}）`);
      if (data.docsFlow) pf.plan = { ...(pf.plan || {}), docsFlow: data.docsFlow };
      const n = data.docsFlow?.reviewedCount ?? 0;
      const total = data.docsFlow?.files?.length || docFilesOf(pf.plan?.langs, pf.plan?.customDocs).length;
      toast(`✓ ${file} 已通过审核（${n}/${total}）`);
    } catch (e) {
      toast(`✕ 审核失败：${e.message}`, true);
    } finally {
      if (pf.review) pf.review.busy = false;
      if (state.pf === pf) render();
    }
  }

  // 双栏同步滚动：各栏同步内容区——按 scrollHeight 比例跟随，
  // 互斥标志防回环（一侧滚动时另一侧跟随不再反触发）。
  // REQ-20260921-011：预览态为富文本容器 .bld-review-preview（滚动主体；渲染异常回退的
  // <pre> 与围栏代码块在容器内部随容器滚动，不单独绑定）。BUG-20260925-006：对话框只读化，
  // 各栏恒为预览态（编辑态 textarea 已随编辑入口移除），绑定只覆盖预览容器。
  function bindReviewSyncScroll(view) {
    const bodies = [...view.querySelectorAll('.bld-review-col-body .bld-review-preview')];
    if (bodies.length < 2) return;
    let syncing = false;
    const scrollRatio = (el) => {
      const max = el.scrollHeight - el.clientHeight;
      return max > 0 ? el.scrollTop / max : null;
    };
    for (const el of bodies) {
      el.addEventListener('scroll', () => {
        if (syncing) return;
        syncing = true;
        const ratio = scrollRatio(el);
        if (ratio != null) {
          for (const other of bodies) {
            if (other === el) continue;
            const omax = other.scrollHeight - other.clientHeight;
            if (omax > 0) other.scrollTop = ratio * omax;
          }
        }
        setTimeout(() => { syncing = false; }, 0);
      });
    }
  }

  /* ---------- REQ-20260921-008 提交（八文件全已审核门禁 + dev 前置） ---------- */

  async function commitDocs() {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf || pf.busy || !state.project || pf.phase !== 'ready') return;
    // aria-disabled 按钮（HTML disabled 不派发 click）：点击给真实缺口反馈
    const flowEval = normalizeFlowEval(pf.plan || {});
    if (pf.plan?.docs?.overall === 'committed' && pf.plan?.docs?.commitHash) {
      toast(`已提交到本地 dev 分支（${short(pf.plan.docs.commitHash)}）：满足「合并入 main」前置`);
      return;
    }
    if (flowEval.canCommit !== true) {
      const missing = flowEval.missing || [];
      if (missing.length) {
        toast(`尚不可提交：还需 ${missing.length} 个文件通过审查（${missing.map((m) => `${m.file}（${DOCS_FLOW_LABEL[m.state] || m.state}）`).join('、')}）`, true);
      } else if ((flowEval.baselineShift || []).length) {
        toast(`尚不可提交：默认语言文档已更新（基准变更），${flowEval.baselineShift.length} 个翻译文档需重新 AI 翻译并审核`, true);
      }
      return;
    }
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
        : `已提交到本地 dev 分支（${String(data.commitHash || '').slice(0, 12)}；范围：${(data.files || []).join('、')}）`;
      toast(data.noop ? '文档无变化，未空提交' : `✓ 文档已提交到本地 dev 分支（${String(data.commitHash || '').slice(0, 8)}）`);
      await Promise.all([ensurePublishPlan(true), refresh()]);
    } catch (e) {
      pf.commitMsg = `提交失败：${e.message}（内容已保留，可重试）`;
      toast(`✕ 文档提交失败：${e.message}`, true);
    } finally {
      pf.busy = false;
      if (state.pf === pf) render();
    }
  }

  /* ---------- REQ-20260921-008 AI 总结进度轮询（docs 步驻留期间 15s 一轮；离开即停） ---------- */

  const SUMMARY_POLL_MS = 15_000;

  function stopSummaryTimer() {
    if (state.summaryTimer) { clearInterval(state.summaryTimer); state.summaryTimer = null; }
  }

  function startSummaryTimer() {
    stopSummaryTimer();
    if (typeof setInterval !== 'function') return; // 测试沙箱无定时器：跳过（浏览器正常轮询）
    state.summaryTimer = setInterval(() => { summaryPoll(); }, SUMMARY_POLL_MS);
  }

  // 轻量轮询：只取当前版本 AI 总结 / AI 翻译 run + 阶段求值（不动 git 分析），驱动列表 /
  // 按钮进度 / 阶段门禁 / 基准变更刷新（REQ-20260921-012：响应带 translate，单次轮询同吸两 run）
  async function summaryPoll() {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf || !state.project || state.step !== 'docs' || pf.phase !== 'ready') return;
    try {
      const r = await fetch(`/api/build/docs-summary/current?project=${encodeURIComponent(state.project)}&id=${encodeURIComponent(v.id)}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return; // 轮询失败静默（下一轮重试；显式动作另有 toast）
      if (state.pf !== pf || state.step !== 'docs') return;
      const prev = pf.plan?.summary || null;
      const prevTr = pf.plan?.translate || null;
      const prevChk = pf.plan?.docsCheck || null;
      const next = data.run || null;
      const nextTr = data.translate || null;
      const nextChk = data.docsCheck || null;
      const changed = JSON.stringify(prev) !== JSON.stringify(next)
        || JSON.stringify(prevTr) !== JSON.stringify(nextTr)
        || JSON.stringify(prevChk) !== JSON.stringify(nextChk)
        || JSON.stringify(pf.plan?.docsFlow || null) !== JSON.stringify(data.docsFlow || null);
      if (!changed) return;
      // REQ-20260924-001：docsCheck（AI 校对 run）随单次轮询同吸——校对建议栏结果自动刷新
      pf.plan = { ...(pf.plan || {}), summary: next, translate: nextTr, ...(data.docsFlow ? { docsFlow: data.docsFlow } : {}), docsCheck: nextChk };
      seedChkDecisions(pf); // BUG-20260925-002：docsCheck 替换后决断重播种（服务端账本 + 本会话同 run 覆盖）
      render();
    } catch { /* 轮询网络异常静默 */ }
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
  // REQ-20260921-008：docs 步驻留期间启动 AI 总结进度轮询（15 秒一轮），离开即停。
  function setStep(step) {
    const s = ['plan', 'merge', 'docs', 'docmerge', 'release'].includes(step) ? step : 'plan';
    // REQ-20260921-014：切换步骤丢弃概况页签未保存编辑（同一步骤重复点击不丢草稿）
    if (s !== state.step) state.planEdit = null;
    state.step = s;
    stopSiteTimer();
    stopSummaryTimer();
    render();
    if (s === 'docs' || s === 'merge' || s === 'docmerge' || s === 'release') ensurePublishPlan();
    if (s === 'docs') startSummaryTimer();
    if (s === 'release') {
      ensureReleaseData(); // BUG-20260915-014：产品发布记录就地展示（沿用）
      startSiteTimer();
    }
  }

  // 「查看发布记录」新落点：选中所在卡片版本并进入「发布」步（不跳隐藏模块）
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

  // BUG-20260928-002 一键发布链路：二次确认后自动「创建草稿（按需）→ 预检 → 启动」。
  // 不再要求先手动「创建并预检」，也不再先走「预览发布计划」读取步骤；预检阻塞即中止并
  // 就近反馈原因（发布条下方 role=alert + toast，不静默）。服务端链路、守卫与允许状态不变
  //（start 仍须预检指纹 token；取消 / 中止不补发执行请求）。
  async function doOneClickPublish() {
    const rc = state.releaseConfirm;
    const project = state.project;
    const view = $('#buildView');
    const v = findVersion(rc?.verId);
    if (!v || rc.busy) return;
    const version = (view?.querySelector('#bldRelVersion')?.value || rc.version || '').trim();
    if (!version) {
      rc.error = '请填写发行版本号（如 1.2.0）';
      render();
      return;
    }
    rc.version = version;
    rc.busy = true;
    rc.error = null;
    let rel = relOf(v);
    if (rel) { rel.publishBusy = true; rel.publishError = null; }
    render();
    const settle = (relNow) => { if (relNow) relNow.publishBusy = false; };
    const fail = (message) => {
      rc.busy = false;
      if (state.releaseConfirm === rc) state.releaseConfirm = null;
      const relNow = relOf(v);
      settle(relNow);
      if (relNow && state.project === project) relNow.publishError = `发布中止：${message}`;
      toast(`✕ 发布中止：${message}`, true);
      render();
    };
    const canceled = () => settle(relOf(v));
    try {
      // 1. 目标运行：优先复用同发行版本号的可续跑草稿（draft/failed/canceled），否则创建新草稿
      let target = (rel?.runs || []).find((r) => r.version === version && ['draft', 'failed', 'canceled'].includes(r.status));
      if (!target) {
        const sep = state.project ? `?project=${encodeURIComponent(state.project)}` : '';
        const r = await fetch(`/api/build-publish/from-build${sep}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bldId: v.id, version }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `创建失败（${r.status}）`);
        target = data.run;
      }
      if (state.releaseConfirm !== rc) return canceled(); // 确认弹窗已被关闭（取消 / 切换项目）：链路即止
      const q = `?project=${encodeURIComponent(state.project)}`;
      // 2. 预检（发布链路自动执行；预检类提示仍保留在运行详情动作区）
      const pr = await fetch(`/api/build-publish/run/${encodeURIComponent(target.id)}/precheck${q}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const pdata = await pr.json().catch(() => ({}));
      if (!pr.ok) throw new Error(pdata.error || `预检失败（${pr.status}）`);
      const precheck = pdata.run?.precheck || {};
      if (!precheck.ok) {
        const bad = (precheck.checks || []).find((c) => !c.ok);
        throw new Error(bad ? `预检未通过：${bad.label}：${bad.detail || '未通过'}` : '预检未通过：请处理阻塞项后重试');
      }
      if (state.releaseConfirm !== rc) return canceled();
      // 3. 启动（token = 预检指纹；二次确认即授权，沿用服务端 start 守卫）
      const sr = await fetch(`/api/build-publish/run/${encodeURIComponent(target.id)}/start${q}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: precheck.fingerprint }),
      });
      const sdata = await sr.json().catch(() => ({}));
      if (!sr.ok) throw new Error(sdata.error || `发布启动失败（${sr.status}）`);
      rc.busy = false;
      state.releaseConfirm = null;
      toast(`✓ 发布已启动（${target.id}）：执行进度见下方运行详情`);
      if (state.selVerId !== v.id) selectVersion(v.id);
      state.step = 'release';
      rel = relOf(v) || rel;
      settle(rel);
      if (state.rel === rel) rel.runId = target.id;
      await refreshReleasePane();
    } catch (e) {
      fail(e.message);
    }
  }

  // BUG-20260928-002 发布二次确认弹窗：文案极简（仅提示即将发布的版本号），确认即授权；
  // 存量计划无 version 字段时改为补填发行版本号（校验同旧创建弹层）。
  function renderPublishConfirm() {
    const rc = state.releaseConfirm;
    if (!rc) return '';
    const v = findVersion(rc.verId);
    if (!v) { state.releaseConfirm = null; return ''; }
    return `
      <div class="rel-modal-wrap" id="bldPublishWrap" role="dialog" aria-label="发布二次确认">
        <div class="rel-modal">
          <h3>发布二次确认（${esc(v.id)}）</h3>
          <div class="rel-modal-body">
            ${rc.version
              ? `<p>即将发布版本 v${esc(rc.version)}。</p>`
              : `<label class="field">发行版本号（与版本显示名分开）
              <input id="bldRelVersion" value="${esc(rc.version)}" placeholder="1.2.0（实际对外发行号）"></label>`}
            ${rc.error ? `<p class="rel-form-err" role="alert">${esc(rc.error)}</p>` : ''}
          </div>
          <footer class="modal-foot">
            <button type="button" class="btn" id="bldRelCancel"${rc.busy ? ' disabled' : ''}>取消</button>
            <button type="button" class="btn primary" id="bldRelGo"${rc.busy ? ' disabled' : ''}>${rc.busy ? '启动中…' : '确认发布'}</button>
          </footer>
        </div>
      </div>`;
  }

  /* ---------- BUG-20260915-014 发布页签渲染（当前项目 + 当前版本 bldId 的产品发布记录） ---------- */

  const relStatusChip = (s) => `<span class="st ${s === 'succeeded' ? 'st-ok' : s === 'failed' ? 'st-fail' : s === 'running' || s === 'prechecking' ? 'st-run' : s === 'waiting-manual' ? 'st-wait' : 'st-mute'}">${esc(REL_STATUS_LABEL[s] || s || '未提供')}</span>`;
  const relStepChip = (s) => `<span class="st ${s === 'done' ? 'st-ok' : s === 'failed' ? 'st-fail' : s === 'running' ? 'st-run' : 'st-mute'}">${esc(REL_STEP_LABEL[s] || s || '未提供')}</span>`;

  // BUG-20260928-002：发布区收敛为唯一「发布」主按钮（唯一发布入口）——顶部操作条与空态 /
  // 记录列表里的重复「创建并预检」入口（BUG-20260916-001 + BUG-20260915-014 引入的堆叠）删除，
  // 点击「发布」直接弹二次确认（openPublishConfirm），确认后一键发布链路自动创建草稿并预检、
  // 启动（doOneClickPublish）。未就绪禁用并就近说明原因（请先配置官网仓库 / 请先完成合并入
  // main / 发布中… / 已发布；创建并预检不再作为按钮前置原因，预检类提示保留在运行详情
  // 动作区）；未配置官网仓库保留「前往设置」（goPublishSettings 口径不变）；一键链路的中止
  // 原因就近反馈（publishError）。发布主按钮始终可见（BUG-20260916-001 原则保留）。
  function renderPublishActions(v, rel) {
    const run = rel?.detail?.run;
    const configured = !!rel?.config?.homepageRepoRoot;
    const busy = !!rel?.publishBusy;
    const running = busy || run?.status === 'running' || (rel?.runs || []).some((r) => ['running', 'prechecking'].includes(r.status));
    const succeeded = run?.status === 'succeeded' || (rel?.runs || []).some((r) => r.status === 'succeeded');
    const reason = !configured ? '请先配置官网仓库' : v.status !== 'merged' ? '请先完成合并入 main' : running ? '发布中…' : succeeded ? '已发布' : '';
    const label = busy ? '启动中…' : running ? '发布中…' : succeeded ? '已发布' : '发布';
    return `<section class="bld-publish-actions"><p>
      <button type="button" class="btn primary bld-publish-btn" data-rel-publish="${esc(v.id)}"${reason || busy ? ' disabled' : ''}>${label}</button>
      ${reason && !succeeded ? `<span class="muted">${esc(reason)}</span>` : ''}
      ${!configured ? '<button type="button" class="btn" data-publish-settings>前往设置</button>' : ''}</p>
      ${rel?.publishError ? `<p class="rel-form-err" role="alert">${esc(rel.publishError)}</p>` : ''}</section>`;
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
    // BUG-20260928-002 已发布态从简：只显示发布时间与发布成功说明（版本计划标签口径见
    // BUG-20260917-001；发布计划锁定口径见 BUG-20260920-005，不放宽、不新增解锁路径），
    // 不再堆叠发布记录列表 / 运行详情。
    const doneRun = rel.detail?.run?.status === 'succeeded' ? rel.detail.run : runs.find((r) => r.status === 'succeeded');
    if (doneRun) {
      return pane(`<p class="small">发布时间：${esc(fmtTime(doneRun.updatedAt))}</p>
        <p class="bld-iso-note" role="status">发布成功：版本计划标签已更新为「已发布」，发布计划已锁定、不允许再修改（关联条目与提交 / 合并入 main / AI 完善 / 文档合并等不可再调整，如需调整请新建版本）。</p>`);
    }
    if (!runs.length) {
      return pane(`<p class="muted small">当前版本暂无发布记录。点击「发布」直接弹出二次确认，确认后自动创建发布草稿并预检、随后直接启动发布。${v.status !== 'merged' ? '当前版本未合并，请先完成合并入 main。' : ''}</p>`);
    }
    const cards = runs.map((r) => `
      <div class="rel-card${r.id === rel.runId ? ' sel' : ''}" data-rel-run="${esc(r.id)}" role="button" tabindex="0">
        <div class="t"><strong>${esc(r.id)}</strong> ${relStatusChip(r.status)}</div>
        <div class="meta">v${esc(r.version || '未提供')} · Web App ${esc(REL_STEP_LABEL[r.targets?.webapp] || r.targets?.webapp || '未提供')} · 官网 ${esc(REL_STEP_LABEL[r.targets?.site] || r.targets?.site || '未提供')}</div>
        ${r.error?.message ? `<div class="meta err">${esc(String(r.error.message).slice(0, 120))}</div>` : ''}
      </div>`).join('');
    return pane(`
      <div class="bld-rel-split">
        <div class="bld-rel-list" aria-label="发布记录">${cards}</div>
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
        ${run.precheck ? `<div><strong>预检</strong>${run.precheck.stale ? '<p class="err">配置或冻结输入已变化，请重新预检</p>' : ''}<ul>${(run.precheck.checks || []).map(c => c.advisory
          ? `<li class="rel-check-advisory"><strong>${esc(c.label)}</strong>：<span>${esc(c.detail)}</span></li>`
          : `<li><strong>${esc(c.label)}</strong>：<span>${c.ok ? '通过' : esc(c.detail || '未通过')}</span></li>`).join('')}</ul></div>` : ''}
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
    const steps = ['plan', 'merge', 'docs', 'docmerge', 'release'];
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
    // REQ-20260926-002：仅认新五步键；旧快照 link（关联条目与提交）归一为 plan（并入第一步）
    state.step = ['plan', 'merge', 'docs', 'docmerge', 'release'].includes(snap.step)
      ? snap.step
      : (snap.step && LEGACY_STEP_KEY[snap.step]) || 'plan';
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

  // BUG-20260928-001：「已合并」标签显示口径后移——绿色「已合并」（st-ok）只在文档与翻译
  // 提交合入 main（v.docsMerge 落账，重放提交 / main 头证据在账）后显示；仅挑选合并完成
  //（status = merged 且 docsMerge 无落账）显示中间态「代码已合并 · 文档未合并」（st-wait），
  // 与发布门禁（docsMerge 落账前推送被拦）口径一致。列表卡片 / 详情标题 / 删除确认弹窗
  // 三处状态标签共用本纯函数；状态机与门禁不变（只收敛显示）。
  const MERGE_PARTIAL_LABEL = '代码已并入 · 文档与翻译未合并';
  const docsMergedOf = (v) => !!(v && v.docsMerge && v.docsMerge.commitHash);
  function statusChipFor(v) {
    if (v && v.status === 'merged' && !docsMergedOf(v)) {
      return `<span class="st st-wait">${esc(MERGE_PARTIAL_LABEL)}</span>`;
    }
    return statusChip(v && v.status);
  }

  // 卡片 meta 行「阶段」与状态标签同口径（BUG-20260928-001）：merged 且 docsMerge 无落账
  // 显示中间态文案（不再提前显示「正式发布」）；docsMerge 落账后维持既有「正式发布」。
  function stageOf(v) {
    const s = v && v.status;
    if (s === 'merged') return docsMergedOf(v) ? '正式发布' : MERGE_PARTIAL_LABEL;
    if (s === 'merging') return '合并中';
    if (s === 'failed') return '失败（可重试）';
    return '计划中';
  }

  // BUG-20260928-005：锁定基准 = 发布确认（正式发布）——「关联条目与提交 / 合并入 main /
  // AI 完善」三类操作的锁定以「发布」按钮二次确认后一键发布链路启动为准
  //（/api/build/state 随版本附带 released，version.json release.confirmedAt 落盘）；
  // 仅推送（pushedAt）不锁定，merged（含已推送未确认）三类操作全部可用。
  const releasedOf = (v) => !!(v && v.released);

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
    // BUG-20260928-001：回退标签走 statusChipFor——merged 且 docsMerge 无落账显示中间态，
    // 文档与翻译合入 main 后才显示绿色「已合并」。
    return statusChipFor(v);
  }

  function renderVersionList() {
    const versions = filteredVersions();
    if (!versions.length) {
      return state.query.trim()
        ? '<div class="rel-empty-mini muted">没有匹配的版本（按名称 / 单号过滤）</div>'
        : '<div class="rel-empty-mini muted">暂无版本计划：点右上「＋ 新建版本」从需求单 / Bug 单创建</div>';
    }
    // REQ-20260921-016：列表卡片精简为「信息 + 删除」——AI 完善（概况描述头，REQ-20260921-013
    // 引入详情后本次迁至描述块头部）、合并入 main（含失败重试，详情「合并入 main」步）、
    // 创建并预检与发布记录（详情「正式发布」步）集中在右侧详情步骤，列表不再重复入口，
    // card-acts 操作行整体移除（无留白）；删除仍属各自卡片，迁至标题行右端。
    return versions.map((v) => {
      // REQ-20260913-004 删除键（REQ-20260921-016 迁至标题行右端）：quiet 危险弱化样式
      // （不抢主操作）；merging 卡片禁用（title 单列口径）；mergeBusy 为全局口径（一并禁用）。
      const delDisabled = v.status === 'merging' || state.mergeBusy;
      const delBtn = `<button type="button" class="btn small quiet bld-ver-del" data-ver-delete="${esc(v.id)}"${delDisabled ? ` disabled title="${v.status === 'merging' ? '合并中，不可删除' : '合并中，请勿重复触发'}"` : ''} aria-label="删除 ${esc(v.id)}"${delDisabled ? '' : ' title="删除该版本计划（需确认，删除后不可恢复）"'}>删除</button>`;
      // REQ-20260920-003：列表展示计划号 + 版本号 + 阶段；REQ-20260922-006：版本号优先取
      // 计划的 x.y.z 字段，存量计划（无 version）回退计划编号派生（YYYYMMDD-NNN）；
      // 已发布（releasedAt，推送远端 main 成功时间）追加「发布于」。
      const verNo = v.version || (/^BLD-\d{8}-\d{3}$/.test(v.id) ? v.id.replace(/^BLD-/, '') : '');
      const stage = stageOf(v);
      return `
      <div class="rel-card${v.id === state.selVerId ? ' sel' : ''}" data-ver-id="${esc(v.id)}" role="button" tabindex="0">
        <div class="t"><span class="bld-card-title"><strong title="${esc(v.name || v.id)}">${esc(v.name || v.id)}</strong> ${versionChip(v)}</span>${delBtn}</div>
        <div class="meta">${esc(v.id)}${verNo ? ` · 版本号 ${esc(verNo)}` : ''} · 阶段 ${esc(stage)} · ${v.items.length} 个关联单 · 更新 ${esc(fmtTime(v.updatedAt))}${v.releasedAt ? ` · 发布于 ${esc(fmtTime(v.releasedAt))}` : ''}</div>
      </div>`;
    }).join('');
  }

  // REQ-20260927-002：来源徽标（颜色 + 文字双重区分，不只靠颜色）——自动·账本（收口账本
  // 核验命中）/ 自动·归属（主题末尾单号严格归属命中）/ 回退·宽口径（自动集为空时的兜底）。
  const SOURCE_BADGE = { ledger: '自动·账本', attribution: '自动·归属', fallback: '回退·宽口径' };

  // REQ-20260927-002：面板操作条计数——M = 已选条目整组自动关联提交数之和（回退提交计入；
  // 宽口径命中不计入）。
  function pickedCommitCount(p) {
    let n = 0;
    for (const id of p.picked) {
      n += autoAssociationOf((p.candidates || []).find((x) => x.itemId === id)).length;
    }
    return n;
  }

  function renderCandidateRows(p, panelKey) {
    return (p.candidates || []).map((it) => {
      const assoc = autoAssociationOf(it);
      const broad = broadHitsOf(it);
      const selectable = assoc.length > 0;
      const checked = p.picked.has(it.itemId) ? ' checked' : '';
      const dis = selectable ? '' : ' disabled';
      // REQ-20260927-002：勾选行内展开「关联提交（自动关联 N 个 · 旧→新 · 只读）」只读
      // 区块——逐项短 hash + 提交主题（含类型前缀）+ 来源徽标；无逐个提交的增删控件
      // （无下拉、无删除按钮；提交调整仍走版本详情条目行换选，REQ-20260915-003 口径）。
      const assocBlock = !checked || !selectable ? '' : `
        <div class="bld-assoc">
          <div class="bld-assoc-head">${esc(`关联提交（自动关联 ${assoc.length} 个 · 旧→新 · 只读）`)}</div>
          ${assoc.map((m) => `
          <div class="bld-assoc-row"><code>${esc(short(m.hash))}</code><span class="bld-assoc-subject" title="${esc(m.subject)}">${esc(m.subject || '（无主题）')}</span><span class="st bld-src bld-src-${esc(m.source)}">${esc(SOURCE_BADGE[m.source] || m.source)}</span></div>`).join('')}
        </div>`;
      // 宽口径命中折叠行：只读提示可点开展开查看 hash + 主题，不可勾选、不计入 M。
      const broadBlock = !broad.length ? '' : `
        <div class="bld-broad">
          <button type="button" class="btn small quiet bld-broad-toggle" data-broad-toggle="${panelKey}" data-item="${esc(it.itemId)}" aria-expanded="${p.broadOpen?.has(it.itemId) ? 'true' : 'false'}">${esc(`另有 ${broad.length} 个宽口径命中未关联`)}</button>
          ${p.broadOpen?.has(it.itemId) ? broad.map((m) => `
          <div class="bld-broad-row"><code>${esc(short(m.hash))}</code><span class="bld-broad-subject" title="${esc(m.subject)}">${esc(m.subject || '（无主题）')}</span></div>`).join('') : ''}
        </div>`;
      return `<div class="bld-cand${selectable ? '' : ' off'}">
        <label class="check">
          <input type="checkbox" data-pick="${panelKey}" data-item="${esc(it.itemId)}"${checked}${dis}>
          <span class="bld-cand-title" title="${esc(it.title || '')}">${esc(it.itemId)} ${esc(it.title || '')}</span>
          ${selectable ? '' : '<span class="muted small">暂无关联提交（先完成开发提交）</span>'}
        </label>${assocBlock}${broadBlock}
      </div>`;
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
          <!-- BUG-20260922-006：版本名称 / 版本号输入框上移至面板 body 顶部（候选清单之前），
            done 条目多时不再被长清单挤到折叠线下；候选加载中也可先行填写（版本号已预填建议值）。 -->
          ${p === state.createPanel ? `<label class="field">版本名称（留空自动命名「版本 YYYYMMDD-HHMM」）
            <input id="bldNewName" value="${esc(p.name)}" placeholder="v1.0 / 2026-09 冲刺"></label>` : ''}
          ${p === state.createPanel ? `<label class="field">版本号（x.y.z 语义化格式，留空自动分配）
            <input id="bldNewVersion" value="${esc(p.version)}" placeholder="0.1.0（自动递增，可修改）"></label>` : ''}
          ${!p.candidates ? '<p class="muted">正在读取条目…</p>'
            : p.candidates.length === 0 ? `<p class="muted bld-cand-empty">${p.totalDone
              ? '已完成的条目均已纳入版本计划：可从「计划中 / 失败」版本移出条目，或删除版本后重新纳入' // BUG-20260914-004：区分「均已被占用」空态
              // BUG-20260914-008：口径已在头部副标题（side-panel-scope），空态正文精简不再复述，避免同面板口径出现两次
              : '暂无可纳入版本的条目'}</p>`
            : `
          <div class="bld-pick-bar">
            <button type="button" class="btn small" id="bldPickAll">全选</button>
            <button type="button" class="btn small" id="bldPickNone">全不选</button>
            <!-- REQ-20260927-002：计数带整组自动关联提交数（M 为已选条目自动关联提交数之和，
              回退提交计入）；跳过提示独立成句（便于动态词条插值） -->
            <span class="muted small">${esc(`已选 ${p.picked.size} 项 · ${pickedCommitCount(p)} 个提交`)}</span>
            ${skipped ? `<span class="muted small">${esc(`${skipped} 个条目暂无关联提交将被跳过`)}</span>` : ''}
          </div>
          ${renderCandidateRows(p, p === state.createPanel ? 'createPanel' : 'addPanel')}
          ${p.error ? `<p class="rel-form-err" role="alert">${esc(p.error)}</p>` : ''}`}
        </div>
        <footer class="rel-panel-foot">
          <button type="button" class="btn primary" id="${footId}" ${p.busy || !p.candidates ? 'disabled' : ''}>${esc(footLabel)}</button>
        </footer>
      </aside>`;
  }

  /* ---------- REQ-20260926-002 五步流程渲染（plan / merge / docs / docmerge / release） ---------- */

  // REQ-20260926-002 五步重定义：选择条目与提交 → 挑选合并 → 文档与翻译 → 文档合并 → 发布。
  // 「关联条目与提交」并入第一步（link 键移除，快照恢复归一 link → plan）；最后一步「发布」=
  // 推送远端 + 官网资料更新两个动作分别展示结果。
  const STEP_LABEL = { plan: '选择条目与提交', merge: '挑选合并', docs: '文档与翻译', docmerge: '文档合并', release: '发布' };
  // 旧快照步骤键归一（link 步并入第一步）
  const LEGACY_STEP_KEY = { link: 'plan' };
  // REQ-20260921-008 文档流水线状态（与 publish-flow.DOCS_FLOW_LABEL 同口径的唯一前端事实源）：
  // REQ-20260921-012 扩展七态——默认语言四态 + 剩余语言 未翻译 / 正在翻译 / 已翻译待审核
  //（reviewed 共用）；chip 三重区分（图标 + 颜色 + 文字，不只靠颜色）。
  const DOCS_FLOW_LABEL = {
    unsummarized: '未总结', summarizing: '正在总结', summarized: '已总结待审核',
    untranslated: '未翻译', translating: '正在翻译', translated: '已翻译待审核', reviewed: '已审核',
    // REQ-20260922-002 单文件类（LICENSE）三态：不经 AI，人工编写 → 待审核 → 已审核
    unwritten: '未编写', pending: '待审核',
  };
  const DOCS_FLOW_CLS = {
    unsummarized: 'st-mute', summarizing: 'st-run', summarized: 'st-wait',
    untranslated: 'st-mute', translating: 'st-run', translated: 'st-wait', reviewed: 'st-ok',
    unwritten: 'st-mute', pending: 'st-wait',
  };
  const DOCS_FLOW_ICON = {
    unsummarized: '○', summarizing: '◐', summarized: '●',
    untranslated: '○', translating: '◐', translated: '●', reviewed: '✔',
    unwritten: '○', pending: '●',
  };
  // REQ-20260921-010 文档清单按语言集动态展开（与 publish-flow 同口径）：
  // 四类 × 语言集语言数，第一个语言（默认语言）不带后缀，其余 <KEY>_<lang>.md；
  // REQ-20260922-002 追加单文件类 LICENSE（A1 口径：恒 LICENSE.md、不随语言集展开、
  // lang=null / single=true，归默认语言组展示并标「不分语言」）。
  const DOC_KEYS = ['README', 'CHANGELOG', 'FEATURES', 'AGENTS'];
  const DOC_SINGLE_KEYS = ['LICENSE'];
  const DEFAULT_DOC_LANGS = ['cn', 'en'];
  // REQ-20260922-003 自定义文档；BUG-20260922-002 起随语言集自动展开（默认语言 KEY.md +
  // 其余 KEY_<lang>.md，与服务端 publish-flow 同口径）；命名与上限与服务端
  // publish-flow.normalizeCustomDocName 同口径（validateCustomDocName 客户端镜像）。
  const CUSTOM_DOC_KEY_MAX = 40;
  const CUSTOM_DOC_MAX = 20;
  // 常见语言显示名（未命中原样显示缩写）；显示名随文件名 data-i18n-skip 豁免（标识不是文案）。
  const LANG_NAMES = { cn: '中文', zh: '中文', en: 'English', fr: 'Français', jp: '日本語', ja: '日本語',
    de: 'Deutsch', es: 'Español', ko: '한국어', ru: 'Русский', it: 'Italiano', pt: 'Português' };
  function langNameOf(l) { return LANG_NAMES[String(l || '').toLowerCase()] || l || ''; }
  // 语言集 → 文档清单（plan.langs 缺省回退 cn,en）：4 类 × N + 单文件类（末尾追加）
  // + 自定义文档（REQ-20260922-003：plan.customDocs 回显；BUG-20260922-002 起逐 KEY 随语言集
  // 展开——默认语言 KEY.md + 其余 KEY_<lang>.md，末尾追加；与服务端 publishDocFiles 镜像）
  function docFilesOf(langs, customDocs) {
    const ls = Array.isArray(langs) && langs.length ? langs : DEFAULT_DOC_LANGS;
    const cus = [];
    const seen = Object.create(null);
    for (const raw of Array.isArray(customDocs) ? customDocs : []) {
      const k = String(raw ?? '').trim().toUpperCase();
      if (!k || !/^[A-Z][A-Z0-9_-]*$/.test(k) || k.length > CUSTOM_DOC_KEY_MAX || seen[k]) continue;
      seen[k] = true;
      ls.forEach((lang, i) => cus.push({ key: k, lang, file: `${k}${i === 0 ? '' : `_${lang}`}.md`, custom: true }));
    }
    return [
      ...DOC_KEYS.flatMap((key) => ls.map((lang, i) => ({ key, lang, file: `${key}${i === 0 ? '' : `_${lang}`}.md` }))),
      ...DOC_SINGLE_KEYS.map((key) => ({ key, lang: null, file: `${key}.md`, single: true, isDefault: true })),
      ...cus,
    ];
  }
  // BUG-20260922-002：自定义文档按语言展开后，移除按钮携带的是行文件名（KEY[_lang].md）——
  // 反推该文件所属的整份自定义 KEY（非自定义文件返回 null），移除按整份 KEY 生效。
  function customDocKeyOfFile(plan, file) {
    const f = docFilesOf(plan?.langs, plan?.customDocs).find((x) => x.custom && x.file === String(file || ''));
    return f ? f.key : null;
  }
  // REQ-20260922-003 自定义文档命名客户端镜像校验（与服务端 normalizeCustomDocName 同口径）：
  // 先行拦截不发请求（非法值不应用、界面保持上次有效状态）；服务端仍为权威校验。
  // BUG-20260922-002：langs 参与展开重名比对（MIGRATION_EN 与 MIGRATION 的 MIGRATION_en.md
  // 重名即拦截——添加一次即自动展开，手工逐语种 workaround 不再可行）。
  function validateCustomDocName(raw, existing, langs) {
    let name = String(raw ?? '').trim();
    const emptyErr = { error: '文件名不能为空（如 MIGRATION.md）' };
    if (!name) return emptyErr;
    if (/\.md$/i.test(name)) name = name.slice(0, -3);
    if (!name) return emptyErr;
    if (name.length > CUSTOM_DOC_KEY_MAX) return { error: `文件名过长（上限 ${CUSTOM_DOC_KEY_MAX} 字符）` };
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) return { error: '存在非法字符：仅允许字母开头，字母 / 数字 / 连字符 / 下划线（.md 后缀可省略，自动补全；不支持子目录）' };
    const key = name.toUpperCase();
    if (/^(?:README|CHANGELOG|FEATURES|AGENTS|LICENSE)(?:_[A-Za-z]{2,3})?$/.test(key)) {
      return { error: `与标准发布文档重名：${key}（README / CHANGELOG / FEATURES / AGENTS / LICENSE 及 _语言 后缀为保留名）` };
    }
    const have = (Array.isArray(existing) ? existing : []).map((x) => String(x ?? '').trim().toUpperCase());
    if (have.includes(key)) return { error: `自定义文档重复：${key}.md 已在清单中` };
    if (have.length >= CUSTOM_DOC_MAX) return { error: `超出自定义文档数量上限（${CUSTOM_DOC_MAX} 份）` };
    const ls = Array.isArray(langs) && langs.length ? langs : DEFAULT_DOC_LANGS;
    const expand = (k) => ls.map((l, i) => `${k}${i === 0 ? '' : `_${l}`}.md`);
    const mine = expand(key).map((f) => f.toLowerCase());
    for (const other of have) {
      for (const f of expand(other)) {
        if (mine.includes(f.toLowerCase())) {
          return { error: `自定义文档重复：${key}.md 展开后与自定义文档 ${other} 的 ${f} 重名（自定义文档添加一次即随语言集自动展开）` };
        }
      }
    }
    return { key };
  }
  // 语言集客户端校验镜像（与服务端 normalizeDocLangs 同口径）：空值 / 空项 / 非 2–3 字母 /
  // 重复项拦截，不应用非法值、界面保持上次有效状态。
  function validateLangSetInput(raw) {
    const s = String(raw ?? '').trim();
    if (!s) return { error: '语言集不能为空（至少一个语言缩写，如 cn,en）' };
    const parts = s.split(',').map((x) => x.trim());
    const seen = {};
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p) return { error: `存在空的语言项（连续逗号）：第 ${i + 1} 项为空` };
      if (!/^[a-zA-Z]{2,3}$/.test(p)) return { error: `存在非法缩写「${p.slice(0, 20)}」：语言缩写以国际规范为准（2–3 个字母，如 cn / zh / en / fr / ja）` };
      const low = p.toLowerCase();
      if (seen[low]) return { error: `语言重复：「${low}」出现多次` };
      seen[low] = true;
    }
    return { langs: parts.map((x) => x.toLowerCase()) };
  }
  const SITE_STATE_LABEL = { waiting: '等待官网同步', scanning: '扫描中', missed: '未命中（可继续检测）', hit: '已检测到官网同步', failed: '读取失败' };

  function renderStepNav(v) {
    const pf = pfOf(v);
    const steps = pf?.plan?.steps || null;
    return `
        <nav class="rel-tabs bld-detail-tabs" role="tablist" aria-label="发布五步流程">
          ${['plan', 'merge', 'docs', 'docmerge', 'release'].map((k) => {
            const gate = steps?.find((s) => s.key === k) || null;
            // 步骤只改变浏览位置；执行门禁由各步动作保留，避免文档加载后导航突然失效。
            const locked = !!gate?.locked;
            return `<button type="button" class="rel-tab${state.step === k ? ' active' : ''}" data-step="${k}" role="tab" aria-selected="${state.step === k}"${locked ? ` title="${esc(gate.reason || '前置条件未满足')}"` : ''}>${STEP_LABEL[k]}</button>`;
          }).join('')}
        </nav>`;
  }

  // REQ-20260921-012 文档编写步两阶段视图（BUG-20260926-002：整体审查阶段去除）：阶段条
  //（① 默认语言先行 → ② AI 翻译与审查，纯展示）+ 一行操作条（BUG-20260926-001：语言集 +
  // 刷新 / 审查 + 五步 ① AI 总结 / ② 二次编辑 / ③ AI 校对 / ④ AI 翻译 / ⑤ 提交 同一水平行）
  // + 按语言页签的文件七态列表（BUG-20260921-013：每语言一个页签，替代平铺单列分组标题行）
  // + 门禁条（编辑收敛进审查对话框）。在 REQ-20260921-008 三段布局与 REQ-20260921-010
  // 语言集动态清单（4 类 × N）之上落位。
  // - 刷新 / 审查按钮恒可用（数据加载失败给错误反馈而非隐藏按钮）；
  // - AI 翻译在默认语言 4/4 已审核前禁用（aria-disabled + title 列默认语言缺口，模式同
  //   BUG-20260920-006）；提交回归「全部已审核」门禁（BUG-20260926-002，不叠加完结条件）；
  // - 文件名是标识不是文案：一律 data-i18n-skip（BUG-20260921-004 口径，防反向词典误译）。
  function renderDocsPane(v) {
    const pf = pfOf(v);
    if (!pf) return '<div class="bld-docs-pane"><p class="muted" role="status">正在加载发布流程数据…</p></div>';
    // 语言集（加载 / 失败态按缺省口径展示输入框；值 = 输入中草稿优先，回显上次有效语言集）。
    // BUG-20260921-017：删标题 / 副标题后与六按钮同一水平行（行首）；可见辅助说明随删除
    // 收纳进输入框既有 title 悬浮提示（内容已全量覆盖），选择器 / 禁用口径 / 反馈均不变。
    const langs = pf?.plan?.langs || DEFAULT_DOC_LANGS;
    const langsValue = pf.langsInput != null ? pf.langsInput : langs.join(',');
    const langsField = `
            <div class="bld-docs-langset">
              <label class="field-inline" for="bldDocLangs">语言集</label>
              <input id="bldDocLangs" data-pf-langs type="text" value="${esc(langsValue)}" autocomplete="off" spellcheck="false"${pf.langsBusy ? ' disabled' : ''}${pf.phase === 'ready' ? '' : ' disabled'} title="逗号分隔的语言缩写（2–3 个字母，国际规范）；第一个语言为默认语言（文件不带后缀），其余语言文件为 KEY_lang.md；回车或失焦应用">
              ${pf.langsBusy ? '<span class="muted small" role="status">保存中…</span>' : ''}
              ${pf.langsErr ? `<p class="rel-form-err small bld-docs-langset-err" role="alert">${esc(pf.langsErr)}</p>` : ''}
            </div>`;
    // 辅助动作恒渲染（加载 / 失败态不隐藏按钮；失败给错误横幅与重试）。BUG-20260926-001
    // 单行操作条收敛、「整体审查」独立按钮移除；BUG-20260926-002 完结对核对话框随之去除，
    // 本行保留辅助动作 刷新 / 审查。
    const actionsHtml = `
          <div class="bld-docs-actions">
            <button type="button" class="btn small" data-pf-refresh${pf.refreshing ? ' disabled' : ''} title="重新从磁盘读取全部文件内容与状态（外部 IDE 修改后取回最新内容，并做基准变更检测）">${pf.refreshing ? '正在读取…' : '刷新'}</button>
            <button type="button" class="btn small" data-pf-review title="打开审查对话框：按文档类型页签（四类 + LICENSE + 自定义）、全语言栏同步滚动对比，逐文件通过审核（只读核对，编辑走「② 二次编辑」）">审查</button>
          </div>`;
    // BUG-20260926-001 五步操作并入顶部单行（主流程顺序入口；状态就地呈现，加载 / 失败态
    // 恒渲染——数据钩子与辅助动作口径一致；「五步：」标签保留）：① AI 总结（复制提示词不
    // 代表编写完成，进度经回执回显）② 二次编辑（默认语言单语言弹窗）③ AI 校对（右侧建议栏
    // 逐条处理）④ AI 翻译（处理完建议并保存的最新默认语言为基准）⑤ 提交（集中展示清单与
    // 缺口）。proofStepText 用可选链计算（plan 未就绪时回落静态文案，不触碰新助手函数——
    // 旧提取口径兼容）。
    const proofRun = pf?.plan?.docsCheck || null;
    const proofStepText = proofRun && proofRun.phase === 'running'
      ? `③ 校对中 ${(proofRun.counts?.pass || 0) + (proofRun.counts?.fail || 0)}/${proofRun.counts?.total || 0}`
      : '③ AI 校对';
    const stepsBarHtml = `
          <nav class="bld-docs-steps" role="group" aria-label="文档编写五步操作">
            <span class="muted small">五步：</span>
            <button type="button" class="btn small" data-pf-summary${pf.busy ? ' disabled' : ''} title="① 复制 AI 总结提示词：依据本版关联需求与实际变更编写默认语言初稿（任务完成后逐文件回显；复制提示词本身不代表编写完成）">${pf?.plan?.summary?.phase === 'running' ? `① 总结中 ${(pf.plan.summary.counts?.summarized || 0)}/${pf.plan.summary.counts?.total || 0}` : '① AI 总结'}</button>
            <button type="button" class="btn small" data-pf-edit${pf.phase === 'ready' ? '' : ' disabled'} title="② 打开默认语言文档编辑弹窗：文件切换 / 刷新 / 编辑 / 预览 / 保存（只显示默认语言，不含其他语种对照列；其余语言由 ④ AI 翻译产出）">② 二次编辑</button>
            <button type="button" class="btn small" data-pf-proofstep${pf.proofBusy ? ' disabled' : ''} title="③ 复制 AI 校对提示词：核查默认语言文档的超链接有效性、错别字、语法与行文规范；无法验证的链接标待确认；结果逐文件显示在右侧建议栏，逐条接受或拒绝">${proofStepText}</button>
            ${translateBtnHtml(pf)}
            ${commitBtnHtml(pf)}
          </nav>`;
    // BUG-20260921-017：删「文档编写 · 三阶段」标题与副标题教学式文案（信息由页签 / 阶段条 /
    // 门禁条 / 按钮 title 缺口提示承载）；BUG-20260926-001：语言集簇、辅助动作与五步按钮
    // 合并同一水平行（一行操作条），窄屏 flex-wrap 换行，不再保留单独的五步操作行。
    const subBar = `
        <div class="bld-docs-sub">
${langsField}
          ${actionsHtml}
          ${stepsBarHtml}
        </div>`;
    if (pf.phase === 'loading') return `<div class="bld-docs-pane">${subBar}<p class="muted" role="status">正在加载发布流程数据…</p></div>`;
    if (pf.phase === 'error' || !pf.plan) {
      return `<div class="bld-docs-pane">${subBar}
        <p class="rel-form-err" role="alert">发布流程数据读取失败：${esc(pf.error || '未知原因')}</p>
        <p><button type="button" class="btn small" data-pf-retry>重试</button></p></div>`;
    }
    const p = pf.plan;
    const docs = p.docs || { files: [], overall: 'none', reasons: [] };
    const flowEval = normalizeFlowEval(p);
    // 阶段条：两阶段推进（各阶段解锁条件与缺口一目了然）
    const stagesHtml = docsStageBar(flowEval);
    // 文件列表（4 类 × 语言集语言数，按语言成组；AI 总结 / AI 翻译运行中附带当前文件标注；
    // 图标独立元素保证状态文字整节点可翻译）
    const sum = p.summary || null;
    const tr = p.translate || null;
    const flowChip = (state, extra = '') => `<span class="st ${DOCS_FLOW_CLS[state] || 'st-mute'}" title="${esc(DOCS_FLOW_LABEL[state] || state)}"><i class="st-ico" aria-hidden="true">${DOCS_FLOW_ICON[state] || ''}</i>${esc(DOCS_FLOW_LABEL[state] || state)}${extra}</span>`;
    const rowOf = (f) => {
      const sumProgress = sum && sum.phase === 'running' && sum.currentFile === f.file
        ? `<span class="muted small"> · AI 总结 ${sum.counts.summarized + 1}/${sum.counts.total}</span>`
        : '';
      const trProgress = tr && tr.phase === 'running' && tr.currentFile === f.file
        ? `<span class="muted small"> · AI 翻译 ${tr.counts.translated + 1}/${tr.counts.total}</span>`
        : '';
      // REQ-20260922-002：单文件类（LICENSE，A1 不随语言集）行尾标「不分语言」——独立可翻译
      // 元素（文件名本身仍 data-i18n-skip 豁免），深浅色下弱化呈现不与状态 chip 抢焦点。
      const singleTag = f.single && !f.custom ? '<span class="bld-doc-single-tag">不分语言</span>' : '';
      // REQ-20260922-003：自定义文档行尾标「自定义」；BUG-20260922-002 起每个语言页签各一行
      //（默认语言 KEY.md + 其余 KEY_<lang>.md），任一行的「移除」均整份生效（全部语种 +
      // 磁盘文件；AI 总结运行中禁用）。
      const customTag = f.custom ? '<span class="bld-doc-custom-tag">自定义</span>' : '';
      const sumRunning = !!(sum && sum.phase === 'running');
      const rmBtn = f.custom
        ? `<button type="button" class="bld-doc-rm" data-doc-rm="${esc(f.file)}"${pf.docBusy || sumRunning ? ' disabled title="AI 总结运行中，暂不可移除"' : ' title="移除整份自定义文档（全部语言文件行与磁盘文件一并删除）"'}>移除</button>`
        : '';
      return `
          <li class="bld-doc-row">
            <span class="bld-doc-fname" data-i18n-skip>${esc(f.file)}</span>${singleTag}${customTag}
            <span class="bld-doc-row-st">${flowChip(f.state)}${sumProgress}${trProgress}${rmBtn}</span>
          </li>`;
    };
    // BUG-20260921-013 文件区域语言页签：每语言一个页签（默认语言恒为第一个，标「默认」+
    // 该语言审核计数角标 x/4），激活语言记忆于 pf.docLang（不在语言集时渲染端回落默认语言，
    // 切换版本随 pf 重建自然回落）；非激活面板 hidden——全部语言面板均渲染，文件行七态 chip
    // 与 AI 进度标注对所有语言保留在 DOM，切页签即时可见；表头汇总 / 阶段条 / 门禁条恒为
    // 语言集全局，不受页签切换影响。
    const activeDocLang = langs.includes(pf.docLang) ? pf.docLang : langs[0];
    // AI 总结 / AI 翻译运行中的当前文件所在语言若非激活页签：页签尾部 ◐ 运行角标提示
    //（不自动切换页签，避免打断浏览；激活页签内行内进度标注已可见，不加冗余角标）
    const langOfFile = (file) => (flowEval.files.find((f) => f.file === file) || {}).lang || null;
    const sumBadgeLang = sum && sum.phase === 'running' ? langOfFile(sum.currentFile) : null;
    const trBadgeLang = tr && tr.phase === 'running' ? langOfFile(tr.currentFile) : null;
    const runBadgeOf = (l) => {
      if (activeDocLang === l) return '';
      if (sumBadgeLang === l) return '<span class="st st-run" title="AI 总结进行中：当前文件在该语言页签"><i class="st-ico" aria-hidden="true">◐</i></span>';
      if (trBadgeLang === l) return '<span class="st st-run" title="AI 翻译进行中：当前文件在该语言页签"><i class="st-ico" aria-hidden="true">◐</i></span>';
      return '';
    };
    const filesOfLang = (l, i) => (i === 0 ? flowEval.defaultFiles : flowEval.restFiles.filter((f) => f.lang === l));
    const langTabsHtml = langs.map((l, i) => {
      const files = filesOfLang(l, i);
      const reviewed = files.filter((f) => f.state === 'reviewed').length;
      return `<button type="button" class="rel-tab${activeDocLang === l ? ' active' : ''}" data-doc-lang="${esc(l)}" role="tab" aria-selected="${activeDocLang === l}" id="bldDocTab_${esc(l)}" aria-controls="bldDocPanel_${esc(l)}"><span data-i18n-skip>${esc(l)} · ${esc(langNameOf(l))}</span>${i === 0 ? '<span>（默认）</span>' : ''}<span class="bld-doc-tab-count${files.length && reviewed === files.length ? ' ok' : ''}">${reviewed}/${files.length}</span>${runBadgeOf(l)}</button>`;
    }).join('');
    const langPanelsHtml = langs.map((l, i) => `<ul class="bld-docs-list" role="tabpanel" id="bldDocPanel_${esc(l)}" aria-labelledby="bldDocTab_${esc(l)}"${activeDocLang === l ? '' : ' hidden'}>${filesOfLang(l, i).map(rowOf).join('')}</ul>`).join('');
    // 门禁条：已提交终态 > 全部可提交 > 缺口明细（默认语言 / 剩余语言分组计数；
    // BUG-20260926-002：完结缺口口径随完结阶段去除，全审即可提交）
    const total = flowEval.files.length;
    const defTotal = flowEval.defaultFiles.length;
    const restTotal = flowEval.restFiles.length;
    const committed = docs.overall === 'committed' && docs.commitHash;
    const missingList = flowEval.missing.map((m) => `${m.file}（${DOCS_FLOW_LABEL[m.state] || m.state}）`).join('、');
    const gateBar = committed
      ? `<div class="bld-docs-gate ok" role="note">已提交到本地 dev 分支（hash ${esc(short(docs.commitHash))}，仅语言集内文档 pathspec）：满足「合并入 main」前置。</div>`
      : flowEval.canCommit
        ? `<div class="bld-docs-gate ok" role="note">提交门禁：${total}/${total} 已审核 —— 可提交到本地 dev 分支。</div>`
        : `<div class="bld-docs-gate" role="note">提交门禁：默认语言 ${flowEval.defaultReviewedCount}/${defTotal} · 剩余语言 ${flowEval.restReviewedCount}/${restTotal} 已审核 —— 提交禁用，尚缺：${missingList}${flowEval.scopeStale ? '；发布范围已变化，审核已失效需重新审查' : ''}。</div>`;
    // 基准变更提示（mtime 对比命中：默认语言文档更新，受影响翻译文档已回退未翻译）
    const baselineNote = (flowEval.baselineShift || []).length
      ? `<p class="rel-form-err" role="alert">默认语言文档已更新：${flowEval.baselineShift.length} 个翻译文档需重新 AI 翻译（基准变更，相关审核已回退）：<code data-i18n-skip>${esc(flowEval.baselineShift.join('、'))}</code></p>`
      : '';
    // BUG-20260925-004 后台静默同步失败轻量横幅：保留现有内容（不进整页 error 态），
    // 仅提示 + 重试入口；成功同步 / 常规刷新后随 syncErr 清空消失。
    const syncErrNote = pf.syncErr
      ? `<div class="bld-docs-sync-err" role="alert"><span>后台同步失败：${esc(pf.syncErr)}——当前内容保持不变，可重试或点「刷新」全量更新</span><button type="button" class="btn small" data-pf-sync-retry>重试同步</button></div>`
      : '';
    // AI 总结提示词预览（点击「AI 总结」后展示；已复制口径。REQ-20260921-007 默认折叠：
    // 摘要行已说明已复制与回执口径，需要查看全文再展开，避免长提示词常驻占据大块空间）
    const promptBox = pf.prompt
      ? `<details class="bld-docs-prompt-box">
          <summary>AI 总结提示词（已复制到剪贴板，交给 AI Agent 执行；进度经 atb summary 逐文件回执，本页自动刷新）</summary>
          <textarea class="bld-docs-prompt" rows="7" readonly>${esc(pf.prompt.text || '')}</textarea>
          <p><button type="button" class="btn small" data-pf-copy-prompt>复制提示词</button></p>
        </details>`
      : '';
    // AI 翻译提示词预览（点击「AI 翻译」后展示；已复制口径，与 AI 总结同型、默认折叠）
    const tPromptBox = pf.translatePrompt
      ? `<details class="bld-docs-prompt-box">
          <summary>AI 翻译提示词（已复制到剪贴板，交给 AI Agent 执行；进度经 atb translate 逐文件回执，本页自动刷新）</summary>
          <textarea class="bld-docs-prompt" rows="7" readonly>${esc(pf.translatePrompt.text || '')}</textarea>
          <p><button type="button" class="btn small" data-pf-copy-tprompt>复制提示词</button></p>
        </details>`
      : '';
    const sumInfo = sum
      ? (sum.phase === 'running'
          ? `<p class="small" role="status">AI 总结进行中：${sum.counts.summarized}/${sum.counts.total}${sum.currentFile ? ` · 当前：<code>${esc(sum.currentFile)}</code>（正在总结）` : ''} · 独立锁 summary（与 AI 翻译 / AI 分析 / AI 开发互不占用）</p>`
          : sum.phase === 'failed'
            ? `<p class="rel-form-err" role="alert">AI 总结中断：${esc(sum.reason || '未知原因')}（文件状态不悬挂「正在总结」，可再次点击「AI 总结」续跑）</p>`
            : `<p class="small" role="status">AI 总结已完成：待总结文件均进入「已总结待审核」，等待人工审查。</p>`)
      : '';
    const trInfo = tr
      ? (tr.phase === 'running'
          ? `<p class="small" role="status">AI 翻译进行中：${tr.counts.translated}/${tr.counts.total}${tr.currentFile ? ` · 当前：<code>${esc(tr.currentFile)}</code>（正在翻译）` : ''} · 独立锁 translate（与 AI 总结 / AI 分析 / AI 开发互不占用）</p>`
          : tr.phase === 'failed'
            ? `<p class="rel-form-err" role="alert">AI 翻译中断：${esc(tr.reason || '未知原因')}——文件状态不悬挂「正在翻译」，可再次点击「AI 翻译」续跑（已翻译完成的文件保留待审核状态）。</p>`
            : `<p class="small" role="status">AI 翻译已完成：待翻译文件均进入「已翻译待审核」，等待人工审查。</p>`)
      : '';
    // REQ-20260922-003 内联添加行（文件区顶部展开：输入 + 添加 / 取消 + 行内错误；草稿
    // 重渲染不丢字；「添加中…」期间按钮禁用）。文件区表头行右侧新增「＋ 添加文档」入口。
    const addRowHtml = pf.addDoc?.open
      ? `
          <div class="bld-docs-addrow">
            <input id="bldDocAdd" data-doc-add-input type="text" value="${esc(pf.addDoc.input ?? '')}" placeholder="文件名，如 MIGRATION.md" autocomplete="off" spellcheck="false"${pf.addDoc.busy ? ' disabled' : ''} title="自定义发布文档文件名：字母开头，字母 / 数字 / 连字符 / 下划线，.md 后缀可省略（自动补全）；添加一次即随语言集自动展开全部语言文件（其余语言由「AI 翻译」产出，无需逐语种添加）；回车或点击「添加」应用">
            <button type="button" class="btn small primary" data-doc-add-confirm${pf.addDoc.busy ? ' disabled' : ''}>${pf.addDoc.busy ? '添加中…' : '添加'}</button>
            <button type="button" class="btn small" data-doc-add-cancel${pf.addDoc.busy ? ' disabled' : ''}>取消</button>
            ${pf.addDoc.err ? `<p class="rel-form-err small bld-docs-addrow-err" role="alert">${esc(pf.addDoc.err)}</p>` : ''}
          </div>`
      : '';
    // REQ-20260924-006 AI 校对建议侧栏（③ 步结果区，文件列表右侧；窄屏纵向堆叠）：文件下拉
    //（默认语言非单文件清单，选中文件记忆于 pf.chkFile）+ 待处理计数 + 逐条建议卡片。
    // 空态明确（尚未校对 / 未发现问题）；running / failed 有进度与重试。建议解析只发生在
    // docsCheck 存在的分支（旧测试 vm 提取口径不带新助手函数，夹具无 docsCheck 不经过）。
    const chkRun = p.docsCheck || null;
    const chkDefaults = flowEval.defaultFiles.filter((f) => !f.single);
    const chkFiles = (chkRun && Object.keys(chkRun.files || {}).length ? Object.keys(chkRun.files) : chkDefaults.map((f) => f.file));
    const chkSel = (pf.chkFile && chkFiles.includes(pf.chkFile) ? pf.chkFile : null)
      || (chkRun ? (chkFiles.find((f) => (chkRun.issues || {})[f]) || chkFiles[0]) : chkFiles[0])
      || null;
    const chkPending = chkRun && chkRun.phase === 'done' ? chkPendingCount(p, pf.chkDecisions) : 0;
    // BUG-20260925-002：新 run 旧决断失效的可感知说明（服务端 supersededDecided = 上一轮
    // 已决断数）——不让用户误以为刚处理过的建议凭空回到待处理。
    const chkSupersededNote = chkRun && chkRun.supersededDecided > 0
      ? `<p class="muted small" role="note">上一轮校对已处理 ${chkRun.supersededDecided} 条：决断随新一轮校对失效，本轮结论需逐条重新接受或拒绝。</p>`
      : '';
    const chkStateChip = (state) => {
      const cls = state === 'accepted' ? 'st-ok' : state === 'stale' ? 'st-wait' : state === 'rejected' ? 'st-mute' : state === '待确认' ? 'st-wait' : 'st-run';
      const label = state === 'accepted' ? '已接受' : state === 'rejected' ? '已拒绝' : state === 'stale' ? '过期' : state === '待确认' ? '待确认' : '待处理';
      return `<span class="st ${cls}" title="${esc(label)}"><i class="st-ico" aria-hidden="true">${state === 'accepted' ? '✔' : state === 'stale' || state === '待确认' ? '●' : '◐'}</i>${esc(label)}</span>`;
    };
    const chkBodyHtml = chkSupersededNote + (() => {
      if (!chkRun) return '<p class="muted small" role="status">尚未校对：点击「③ AI 校对」复制提示词并交给 AI Agent 核查，结果自动回显到本栏（链接 / 错别字 / 语法 / 行文规范）。</p>';
      const c = chkRun.counts || {};
      if (chkRun.phase === 'running') {
        return `<p class="small" role="status">校对进行中：${(c.pass || 0) + (c.fail || 0)}/${c.total || 0}${chkRun.currentFile ? ` · 当前：<code data-i18n-skip>${esc(chkRun.currentFile)}</code>（正在核查）` : ''}——本栏随回执自动刷新。</p>`;
      }
      if (chkRun.phase === 'failed') {
        return `<p class="rel-form-err small" role="alert">AI 校对中断：${esc(chkRun.reason || '未知原因')}——已回执结论保留，可重试续查。</p>
          <p><button type="button" class="btn small" data-chk-retry title="重新复制 AI 校对提示词并派发核查（新一轮 run 覆盖旧结论）">重试 AI 校对</button></p>`;
      }
      if (!chkSel) return '<p class="muted small" role="status">当前版本没有默认语言文档可校对。</p>';
      const rows = splitProofreadIssues((chkRun.issues || {})[chkSel] || '');
      if (!rows.length) return '<p class="small" role="status">该文件未发现问题 ✓（校对基准为回执时点磁盘内容）</p>';
      const cards = rows.map((row, i) => {
        const sug = parseChkSuggestion(row);
        const type = classifyChkIssue(row);
        const key = `${chkRun.runId}|${chkSel}|${i}`;
        const dec = (pf.chkDecisions || {})[key] || null;
        const state = dec || (type === '待确认' ? '待确认' : 'pending');
        const diffHtml = sug.applicable
          ? `<details class="bld-chk-diff">
              <summary>查看修改前后差异</summary>
              <div class="bld-chk-diff-grid">
                <div class="bld-chk-before"><span class="bld-chk-tag del">修改前（删除）</span><pre data-i18n-skip><del>${esc(sug.before)}</del></pre></div>
                <div class="bld-chk-after"><span class="bld-chk-tag ins">修改后（新增）</span><pre data-i18n-skip><ins>${esc(sug.after)}</ins></pre></div>
              </div>
            </details>`
          : '';
        const busy = pf.chkBusy === key;
        const canAccept = sug.applicable && !dec && type !== '待确认';
        const acceptBtn = canAccept
          ? `<button type="button" class="btn small primary" data-chk-accept="${esc(chkSel)}|${i}"${busy || pf.chkBusy ? ' disabled' : ''} title="按差异应用这一条建议并保存（应用前先核对磁盘原文一致，不一致标记过期不覆盖）">接受</button>`
          : (sug.applicable || dec ? '' : `<button type="button" class="btn small" disabled title="无法自动应用（未解析出修改前后文本）：请点「✎ 修改」手动处理">接受</button>`);
        const rejectBtn = !dec
          ? `<button type="button" class="btn small" data-chk-reject="${esc(chkSel)}|${i}"${busy || pf.chkBusy ? ' disabled' : ''} title="不采纳该条建议：原文保持不变（不计入待处理）">拒绝</button>`
          : '';
        // BUG-20260925-001：data-chk-idx 为滚动锚点钩子（决断后重渲染锚定刚操作条目用）
        return `
            <li class="bld-chk-issue" data-chk-idx="${i}">
              <div class="bld-chk-issue-head">
                <span class="bld-chk-type">${esc(type)}</span>
                <span class="bld-chk-pos">${sug.line ? `第 ${sug.line} 行` : '无行号'}</span>
                ${chkStateChip(state)}
              </div>
              <p class="bld-chk-text" data-i18n-skip>${esc(row)}</p>
              ${diffHtml}
              ${dec === 'stale' ? '<p class="muted small" role="note">建议基于的文本已变化：未覆盖当前内容，请重新校对或点「✎ 修改」手动处理。</p>' : ''}
              <div class="bld-chk-acts">
                ${acceptBtn}${rejectBtn}
                <button type="button" class="btn small" data-chk-edit="${esc(chkSel)}"${sug.line ? ` data-chk-line="${sug.line}"` : ''} title="${esc(sug.line ? `${chkSel} · 第 ${sug.line} 行` : chkSel)}">✎ 修改</button>
              </div>
            </li>`;
      }).join('');
      // 默认语言文档在校对后又有修改（任一非 reviewed）：提示接受前的原文核对口径
      const dirtyNote = flowEval.defaultFiles.some((f) => f.state !== 'reviewed')
        ? '<p class="muted small" role="note">默认语言文档已修改：接受前会逐条核对磁盘原文，不一致将标记过期，不覆盖人工修改。</p>'
        : '';
      return `${dirtyNote}<ul class="bld-chk-list">${cards}</ul>`;
    })();
    const chkPanelHtml = `
        <aside class="bld-docs-chk" aria-label="校对建议">
          <div class="bld-docs-chk-head">
            <span class="bld-docs-chk-title">校对建议</span>
            ${chkRun && chkRun.phase === 'done' ? `<span class="bld-docs-chk-count${chkPending ? '' : ' ok'}" title="未处理的建议数量：全部接受或拒绝后「④ AI 翻译」解锁">待处理 ${chkPending} 项</span>` : ''}
          </div>
          <label class="bld-docs-chk-file"><span>文件</span>
            <select data-chk-file${pf.chkBusy ? ' disabled' : ''} aria-label="选择要查看校对建议的文件">
              ${chkFiles.map((f) => `<option value="${esc(f)}"${f === chkSel ? ' selected' : ''} data-i18n-skip>${esc(f)}${chkRun && (chkRun.issues || {})[f] ? `（${splitProofreadIssues(chkRun.issues[f]).length}）` : ''}</option>`).join('')}
            </select>
          </label>
          <div class="bld-docs-chk-body">${chkBodyHtml}</div>
        </aside>`;
    return `
      <div class="bld-docs-pane">
        ${subBar}
        ${stagesHtml}
        ${promptBox}
        ${tPromptBox}
        ${sumInfo}
        ${trInfo}
        ${baselineNote}
        ${syncErrNote}
        <div class="bld-docs-main">
        <section class="bld-docs-files" aria-label="发布文档文件列表">
          <div class="bld-docs-files-head"><span>文件（${total} · 默认语言 ${flowEval.defaultReviewedCount}/${defTotal} 已审核 · 剩余语言 ${flowEval.restReviewedCount}/${restTotal} 已审核）</span><span class="bld-docs-head-right"><span>状态</span><button type="button" class="btn small primary" data-doc-add-open${pf.phase === 'ready' ? '' : ' disabled'} title="添加一份自定义发布文档（可添加多份；添加一次即随语言集自动展开全部语言文件；命名字母开头，字母 / 数字 / 连字符 / 下划线，.md 后缀可省略）">＋ 添加文档</button></span></div>
          ${addRowHtml}
          <nav class="rel-tabs bld-doc-lang-tabs" role="tablist" aria-label="文档语言页签">${langTabsHtml}</nav>
          ${langPanelsHtml}
          ${pf.refreshing ? '<div class="bld-docs-loading" role="status">正在读取最新内容…</div>' : ''}
        </section>
        ${chkPanelHtml}
        </div>
        ${gateBar}
        ${pf.commitMsg ? `<p class="small" role="status">${esc(pf.commitMsg)}</p>` : ''}
        ${docs.overall !== 'committed' && (docs.reasons || []).length && !flowEval.canCommit ? `<p class="muted small">${docs.reasons.map((x) => esc(x)).join('；')}</p>` : ''}
      </div>`;
  }

  // docsFlow 防御性补齐：旧快照 / 测试桩字段缺失时按 files 与语言集推导分组与门禁
  //（服务端求值为完整口径，此处只兜底展示，不引入第二事实源）。REQ-20260922-002：单文件类
  //（lang=null / single）归默认语言组（isDefault=true）。
  function normalizeFlowEval(p) {
    const langs = Array.isArray(p?.langs) && p.langs.length ? p.langs : DEFAULT_DOC_LANGS;
    const files = ((p?.docsFlow && p.docsFlow.files) || docFilesOf(langs, p?.customDocs))
      .map((f) => ({ ...f, isDefault: f.isDefault != null ? !!f.isDefault : (f.lang == null ? true : f.lang === langs[0]) }));
    const defaultFiles = files.filter((f) => f.isDefault);
    const restFiles = files.filter((f) => !f.isDefault);
    const reviewedOf = (list) => list.filter((f) => f.state === 'reviewed').length;
    const missingOf = (list) => list.filter((f) => f.state !== 'reviewed').map((f) => ({ file: f.file, state: f.state }));
    const base = p?.docsFlow || {};
    const defaultReviewedCount = base.defaultReviewedCount != null ? base.defaultReviewedCount : reviewedOf(defaultFiles);
    const restReviewedCount = base.restReviewedCount != null ? base.restReviewedCount : reviewedOf(restFiles);
    return {
      ...base,
      files,
      defaultFiles,
      restFiles,
      reviewedCount: base.reviewedCount != null ? base.reviewedCount : defaultReviewedCount + restReviewedCount,
      defaultReviewedCount,
      restReviewedCount,
      missing: base.missing != null ? base.missing : missingOf(files),
      translateMissing: base.translateMissing != null ? base.translateMissing : missingOf(defaultFiles),
      canTranslate: base.canTranslate != null ? base.canTranslate === true : defaultFiles.length > 0 && defaultReviewedCount === defaultFiles.length && restFiles.length > 0,
      baselineShift: base.baselineShift || [],
      canCommit: base.canCommit === true,
      scopeStale: !!base.scopeStale,
    };
  }

  // 阶段条（两阶段推进视图，BUG-20260926-002 回归两阶段）：① 默认语言先行（默认语言 4/4
  // 已审核完成）→ ② AI 翻译与审查（剩余语言全部已审核完成；无剩余语言视为完成）。
  // 各阶段 ✔ 已完成 / ● 进行中 / ○ 未解锁（chip 三重区分）；两段均为纯展示（完结入口随
  // 整体审查阶段去除，提交门禁回归「全部已审核」）。
  function docsStageBar(flowEval) {
    const defTotal = flowEval.defaultFiles.length;
    const restTotal = flowEval.restFiles.length;
    const defDone = defTotal > 0 && flowEval.defaultReviewedCount === defTotal;
    const restDone = restTotal === 0 || flowEval.restReviewedCount === restTotal;
    const mark = (done, active) => (done
      ? '<span class="st st-ok"><i class="st-ico" aria-hidden="true">✔</i>已完成</span>'
      : active
        ? '<span class="st st-run"><i class="st-ico" aria-hidden="true">●</i>进行中</span>'
        : '<span class="st st-mute"><i class="st-ico" aria-hidden="true">○</i>未解锁</span>');
    return `
        <div class="bld-docs-stages" role="note" aria-label="文档编写阶段推进">
          <span class="muted small">阶段：</span>
          <span class="bld-stage">① 默认语言先行 ${mark(defDone, true)}</span><span class="muted small" aria-hidden="true">──</span>
          <span class="bld-stage">② AI 翻译与审查 ${mark(restDone, defDone && !restDone)}</span>
        </div>`;
  }

  // AI 总结按钮文案：运行中显示进度（总结中 x/4，默认语言 4 文件）
  function summaryBtnText(pf) {
    const sum = pf?.plan?.summary;
    return sum && sum.phase === 'running' ? `总结中 ${sum.counts.summarized}/${sum.counts.total}` : 'AI 总结';
  }

  // AI 翻译按钮文案：运行中显示进度（翻译中 x/◇，◇ = 4 × (N−1) 随语言集剩余语言文件数动态）
  function translateBtnText(pf) {
    const tr = pf?.plan?.translate;
    return tr && tr.phase === 'running' ? `翻译中 ${tr.counts.translated}/${tr.counts.total}` : 'AI 翻译';
  }

  // AI 翻译按钮（④ 步）：默认语言 4/4 已审核前禁用（aria-disabled + title 列默认语言缺口
  // 明细——哪些默认语言文件未审核、各处什么状态；模式同 BUG-20260920-006）；运行中禁用并
  // 显示进度。REQ-20260924-006：① 未处理校对建议 > 0 时禁用并提示数量（决断后解锁）；
  // ② 单语言版本（默认全审且无剩余语言）显示「无翻译目标，可跳过翻译」空态说明（不报缺口）。
  // typeof 守卫：旧测试 vm 提取口径不带 chkPendingCount 时按 0 处理（兼容不回归）。
  function translateBtnHtml(pf) {
    if (!pf?.plan) return '<button type="button" class="btn small" data-pf-translate aria-disabled="true" title="发布流程数据未就绪：请先刷新或重试">④ AI 翻译</button>';
    if (pf.plan.translate?.phase === 'running') {
      return `<button type="button" class="btn small" data-pf-translate disabled title="AI 翻译进行中：提示词已交给 AI Agent，进度经 atb translate 逐文件回执，本页与任务模块自动刷新">④ ${translateBtnText(pf)}</button>`;
    }
    const flowEval = normalizeFlowEval(pf.plan);
    const gap = flowEval.translateMissing || [];
    const pendingChk = typeof chkPendingCount === 'function' ? chkPendingCount(pf.plan, pf.chkDecisions) : 0;
    let can = flowEval.canTranslate === true;
    let reason;
    if (pendingChk > 0) {
      can = false;
      reason = `AI 翻译未解锁：尚有 ${pendingChk} 条校对建议未处理（逐条接受或拒绝后解锁，见右侧校对建议栏）`;
    } else if (can) {
      reason = '复制 AI 翻译提示词到剪贴板：以已审核的默认语言文档为唯一基准，交给 AI Agent 逐文件翻译剩余语言文档（默认语言全部审核后解锁）';
    } else if (!gap.length && !(flowEval.restFiles || []).length) {
      reason = '语言集只有一个语言：无翻译目标，可跳过翻译（直接进行提交）';
    } else {
      reason = `AI 翻译未解锁：默认语言尚缺 ${gap.length} 个文件审核（${gap.map((m) => `${m.file}（${DOCS_FLOW_LABEL[m.state] || m.state}）`).join('、')}）`;
    }
    return `<button type="button" class="btn small" data-pf-translate${can ? '' : ' aria-disabled="true"'} title="${esc(reason)}">④ ${translateBtnText(pf)}</button>`;
  }

  // 提交按钮（⑤ 步）：需「全部文件已审核」（BUG-20260926-002：canCommit 不再叠加完结条件；
  // aria-disabled：HTML disabled 不派发 click，点击由 commitDocs 守卫 toast 真实缺口）；
  // 已提交 / 提交中 / 可提交三态文案；数据未就绪（加载 / 失败态）给明确 title。
  function commitBtnHtml(pf) {
    if (!pf?.plan) return '<button type="button" class="btn small primary" data-pf-commit aria-disabled="true" title="发布流程数据未就绪：请先刷新或重试">⑤ 提交</button>';
    const flowEval = normalizeFlowEval(pf.plan);
    const committed = pf.plan?.docs?.overall === 'committed' && pf.plan?.docs?.commitHash;
    if (committed) return `<button type="button" class="btn small primary" data-pf-commit aria-disabled="true" title="已提交到本地 dev 分支（${esc(short(pf.plan.docs.commitHash))}）">⑤ 已提交 ✓</button>`;
    if (pf.busy) return '<button type="button" class="btn small primary" data-pf-commit disabled>⑤ 提交中…</button>';
    const ok = flowEval.canCommit === true;
    const missing = flowEval.missing || [];
    const reason = ok
      ? '把语言集内文档与 LICENSE.md 提交到本地 dev 分支（pathspec 限定，不夹带业务源码）'
      : `还需 ${missing.length} 个文件通过审查：${missing.map((m) => `${m.file}（${DOCS_FLOW_LABEL[m.state] || m.state}）`).join('、')}`;
    return `<button type="button" class="btn small primary" data-pf-commit${ok ? '' : ' aria-disabled="true"'} title="${esc(reason)}">⑤ 提交</button>`;
  }

  // REQ-20260921-011 预览态 Markdown 渲染：与 app.js / req-disc.js / oncall.js 三处 renderMd
  // 逐字同口径——复用 index.html 已全局加载的 vendored marked v12.0.2（零新增依赖），
  // 输出经 sanitizeHtml 消毒（剥 script 块与 on* 内联事件）；渲染器抛错（含 marked 未加载）
  // 回退转义源码 <pre>，不白屏不崩溃。
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

  // REQ-20260921-008 审查对话框：按文档类型页签（REQ-20260922-002 起四类 + LICENSE 单文件类，
  // LICENSE 页签 A1 单栏并标「不分语言」；REQ-20260922-003 起自定义文档各占一个追加页签，
  // BUG-20260922-002 起随语言集展开为多语言多栏——页签计数 x/语言数），页签内全语言栏并排
  //（语言集内全部文件可达；REQ-20260921-010 起列随语言集动态展开——原中英双栏泛化为 N 栏，
  // 栅格列数 = 语言数）；各栏同步滚动（bindReviewSyncScroll 按比例跟随）。BUG-20260925-006：
  // 对话框收敛为只读核对 + 通过审核——各栏不再有 编辑/预览 切换、保存按钮与可输入 textarea，
  // 栏内容恒为 Markdown 预览态（空文档占位 / 读取中不变），文档编辑一律走「② 二次编辑」弹窗。
  // 文件名 data-i18n-skip（标识豁免）。
  function renderReviewModal(v) {
    const pf = v ? pfOf(v) : null;
    const rv = pf?.review;
    if (!rv?.open) return '';
    const flowEval = pf.plan?.docsFlow || { files: docFilesOf(pf?.plan?.langs, pf?.plan?.customDocs).map((f) => ({ ...f, state: f.custom ? (f.lang == null || f.lang === (pf.plan?.langs || DEFAULT_DOC_LANGS)[0] ? 'unsummarized' : 'untranslated') : (!f.single ? 'unsummarized' : 'unwritten') })), reviewedCount: 0 };
    const stateOf = (file) => (flowEval.files.find((f) => f.file === file) || {}).state || 'unsummarized';
    const docFiles = flowEval.files.length ? flowEval.files : docFilesOf(pf?.plan?.langs, pf?.plan?.customDocs);
    // REQ-20260922-003：自定义文档各占一个类型页签（追加在四类 + LICENSE 之后；
    // BUG-20260922-002 起页签内随语言集多栏，与标准类同构）
    const customKeys = (pf?.plan?.customDocs || []).map((x) => String(x || '').trim().toUpperCase()).filter(Boolean);
    const tabsHtml = [...DOC_KEYS, ...DOC_SINGLE_KEYS, ...customKeys].map((k) => {
      const per = docFiles.filter((f) => f.key === k);
      const n = per.filter((f) => stateOf(f.file) === 'reviewed').length;
      return `<button type="button" class="rel-tab${rv.key === k ? ' active' : ''}" data-review-tab="${k}" role="tab" aria-selected="${rv.key === k}">${k}（${n}/${per.length}）</button>`;
    }).join('');
    const pair = docFiles.filter((f) => f.key === rv.key);
    const colsHtml = pair.map((f) => {
      const st = stateOf(f.file);
      const content = rv.contents?.[f.file] ?? null;
      // REQ-20260921-011 预览态：Markdown 渲染为富文本（.md 排版：标题/列表/表格/引用/代码），
      // 空文档显示占位不渲染空白区。富文本容器 data-i18n-skip——文档内容是各自语言的本体
      //（README.md 中文 / README_en.md 英文），不进界面词典翻译（BUG-20260921-004 同口径），
      // 预览必须展示即将提交的原文；空文档占位是界面文案，不豁免、可随界面语言翻译。
      const body = content == null
        ? '<p class="muted small" role="status">正在读取文档内容…</p>'
        : !String(content).trim()
          ? `<div class="bld-review-preview muted small" data-review-file="${esc(f.file)}">（空文档）</div>`
          : `<div class="bld-review-preview md" data-review-file="${esc(f.file)}" data-i18n-skip>${renderMd(content)}</div>`;
      return `
            <div class="bld-review-col" data-col="${esc(f.file)}">
              <div class="bld-review-col-head">
                <span class="bld-doc-fname" data-i18n-skip>${esc(f.file)}${f.single ? '' : `（${esc(langNameOf(f.lang))}）`}</span>${f.single && !f.custom ? '<span class="bld-doc-single-tag">不分语言</span>' : ''}${f.custom ? '<span class="bld-doc-custom-tag">自定义</span>' : ''}
                <span class="st ${DOCS_FLOW_CLS[st] || 'st-mute'}"><i class="st-ico" aria-hidden="true">${DOCS_FLOW_ICON[st] || ''}</i>${esc(DOCS_FLOW_LABEL[st] || st)}</span>
                <div class="bld-review-col-acts">
                  <button type="button" class="btn small primary" data-review-approve="${esc(f.file)}"${st === 'reviewed' ? ' disabled title="已审核：内容再变化会自动回退待审核"' : ''}>${st === 'reviewed' ? '✔ 已审核' : '通过审核'}</button>
                </div>
              </div>
              <div class="bld-review-col-body">${body}</div>
            </div>`;
    }).join('');
    const pairReviewed = pair.filter((f) => stateOf(f.file) === 'reviewed').length;
    return `
      <div class="rel-modal-wrap bld-review-wrap" id="bldReviewWrap" role="dialog" aria-modal="true" aria-label="审查发布文档">
        <div class="rel-modal bld-review-modal">
          <header class="bld-review-head">
            <span>审查发布文档（${esc(v?.id || '')}）</span>
            <button type="button" class="btn small quiet" data-review-close aria-label="关闭对话框">✕ 关闭</button>
          </header>
          ${flowEval.scopeStale ? `<p class="bld-review-stale muted small" role="note" data-review-stale-note>发布范围已变化：请重新逐文件核对并「通过审核」后再提交</p>` : ''}
          <nav class="rel-tabs bld-review-tabs" role="tablist" aria-label="文档类型页签">${tabsHtml}</nav>
          <div class="bld-review-cols"${pair.length ? ` style="grid-template-columns:repeat(${pair.length},minmax(0,1fr))"` : ''}>${colsHtml}</div>
          <footer class="bld-review-foot">
            <span>全部 ${flowEval.reviewedCount}/${docFiles.length} 已审核 · 本页签 ${pairReviewed}/${pair.length} · 各栏同步滚动：一侧滚动其余按比例跟随</span>
            <button type="button" class="btn small" data-review-close>关闭</button>
          </footer>
        </div>
      </div>`;
  }

  // REQ-20260924-004 AI 校对 issues 逐条拆分（口径 a：提示词约束回执每条一行、行号开头，
  // 账本仍存整段文本——兼容既有 run）：按换行拆分、trim、去空行、保序；无换行的整段返回
  // 单条整段（不丢内容）；空文本返回空数组（渲染端兜底整段一条）。
  function splitProofreadIssues(text) {
    const rows = String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return rows.length ? rows : [String(text || '').trim()].filter(Boolean);
  }

  // REQ-20260924-004 行号解析（启发式，解析不到不算缺陷——跳转兜底为仅打开编辑态）：
  // 优先命中「第 N 行」形态；其次行首「N. / N、 / N: / N： / N) / L N:」序号形态。
  function parseIssueLineNo(text) {
    const s = String(text || '');
    let m = s.match(/第\s*(\d{1,5})\s*行/);
    if (m) return Math.max(1, parseInt(m[1], 10));
    m = s.match(/^\s*(?:L\s*)?(\d{1,5})\s*[.、:：)）]/);
    if (m) return Math.max(1, parseInt(m[1], 10));
    return null;
  }

  /* ---------- REQ-20260924-006 AI 校对建议（③ 步）纯函数：解析 / 分类 / 应用 / 计数 ---------- */

  // 单条建议解析（REQ-20260924-004 回执口径「第 N 行：原文「A」→ 建议「B」」；账本仍存整段
  // 文本，本层按行解析出可应用的前后文本对）：line 复用 parseIssueLineNo；before/after 取
  // 「…」→ 建议「…」捕获组（无「原文」前缀亦可）；applicable = 前后对存在且 before 非空且
  // 前后不同（after 可为空 = 删除型建议）。解析不出前后对的条目只展示，走「✎ 修改」人工处理。
  function parseChkSuggestion(text) {
    const s = String(text || '');
    const m = s.match(/「([^「」]*)」\s*(?:→|->)\s*(?:建议\s*)?「([^「」]*)」/);
    const before = m ? m[1] : null;
    const after = m ? m[2] : null;
    return {
      line: parseIssueLineNo(s),
      before,
      after,
      applicable: !!m && before !== '' && before !== after,
    };
  }

  // 问题类型启发式分类（回执无结构化类型字段——REQ 待确认口径，本层按文本特征尽力归类，
  // 只影响展示标签不影响应用）：「待确认」优先（无法验证的链接不得判成有效或确定失效）；
  // 其后链接 / 错别字 / 语法标点；默认行文规范。
  function classifyChkIssue(text) {
    const s = String(text || '');
    if (s.includes('待确认') || (s.includes('无法') && (s.includes('验证') || s.includes('确认')))) return '待确认';
    if (/链接|死链|超链|可达|https?:\/\/|www\./.test(s)) return '链接';
    if (/错别字|同音|形近|多字|漏字|笔误|应为/.test(s)) return '错别字';
    if (/语法|标点|句读|主语|搭配|残缺/.test(s)) return '语法';
    return '行文规范';
  }

  // 建议应用（纯文本定位替换，不修改入参）：有行号先按行定位（该行包含 before 才替换，
  // 行号超界收敛末行）；行内不含或全文找不到 before → stale（建议基于的文本已变化，不覆盖
  // 人工修改）；无行号全文首处定位。before 为空 / 前后相同 → error（调用方先拦截，双保险）。
  function applyChkSuggestion(content, s) {
    const before = String(s?.before ?? '');
    const after = String(s?.after ?? '');
    if (!before || before === after) return { error: '无可应用文本' };
    const text = String(content ?? '');
    if (s?.line != null && s.line >= 1) {
      const lines = text.split('\n');
      const idx = Math.min(s.line, lines.length) - 1;
      if (!lines[idx].includes(before)) return { stale: true };
      lines[idx] = lines[idx].replace(before, after);
      return { content: lines.join('\n') };
    }
    const at = text.indexOf(before);
    if (at === -1) return { stale: true };
    return { content: text.slice(0, at) + after + text.slice(at + before.length) };
  }

  // 未处理建议计数（AI 翻译 ④ 步门禁）：最新 done run 的 issues 按行计待处理；决断
  // accepted / rejected / stale 均视为已处理（stale 不可应用，不阻塞）；非 done 或无 run 计 0。
  function chkPendingCount(plan, decisions) {
    const run = plan?.docsCheck;
    if (!run || run.phase !== 'done') return 0;
    const dec = decisions || {};
    let n = 0;
    for (const [file, text] of Object.entries(run.issues || {})) {
      splitProofreadIssues(text).forEach((row, i) => {
        const st = dec[`${run.runId}|${file}|${i}`];
        if (!st || st === 'pending') n += 1;
      });
    }
    return n;
  }

  // BUG-20260925-002 决断播种：plan.docsCheck.decisions（服务端校对账本事实源，键 'file|idx'）
  // → 会话决断表（键 'runId|file|idx'）。本会话同 runId 已有决断覆盖其上（并发未落库不丢）；
  // 换 run（新一轮校对新 runId）旧键自然丢弃（旧决断不带入新 run，侧栏另有失效提示）。
  // 拉取 / 轮询替换 pf.plan(.docsCheck) 后调用——整页刷新与版本切换重进即重播种，决断不丢。
  function seedChkDecisions(pf) {
    const run = pf?.plan?.docsCheck;
    const out = {};
    if (run && run.runId) {
      for (const [k, st] of Object.entries(run.decisions || {})) out[`${run.runId}|${k}`] = st;
      for (const [k, st] of Object.entries(pf.chkDecisions || {})) {
        if (k.startsWith(`${run.runId}|`)) out[k] = st;
      }
    }
    pf.chkDecisions = out;
    return out;
  }

  // BUG-20260925-002 已应用识别（纯函数）：接受定位失败（stale）时区分「此前已应用」与
  //「原文被人工改过」——after 非空且按 applyChkSuggestion 同定位口径（有行号查该行、行号
  // 超界收敛末行；无行号查全文）能找到 after ⇒ 已应用；after 为空（删除型）无法从内容可靠
  // 区分，保守返回 false（走过期口径，「不一致不覆盖人工修改」的既有保护不回退）。
  function alreadyAppliedChk(content, s) {
    const after = String(s?.after ?? '');
    if (!after) return false;
    const text = String(content ?? '');
    if (s?.line != null && s.line >= 1) {
      const lines = text.split('\n');
      const idx = Math.min(s.line, lines.length) - 1;
      return lines[idx].includes(after);
    }
    return text.includes(after);
  }

  /* ---------- REQ-20260924-006 ② 二次编辑弹窗（默认语言单语言）与 ③ 建议接受 / 拒绝 ---------- */

  // 未保存判定：disk 已知（读取成功或保存成功回写）且草稿与磁盘不一致。
  function editUnsaved(pf) {
    return !!(pf?.edit?.open && pf.edit.disk != null && pf.edit.content != null && pf.edit.content !== pf.edit.disk);
  }

  // 打开二次编辑弹窗（target = { file, line }：建议栏「✎ 修改」跳入定位；无参默认首个默认
  // 语言文件、编辑态）。只列默认语言文件（4 类 + LICENSE + 自定义 KEY.md）——移除其他语种
  // 对照列；读取 / 保存沿用既有 docs 白名单通道。
  function openSecondaryEdit(target) {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf || pf.phase !== 'ready') {
      toast('发布流程数据未就绪：请先刷新或重试后再编辑', true);
      return;
    }
    const defaults = normalizeFlowEval(pf.plan || {}).defaultFiles;
    if (!defaults.length) {
      toast('当前版本没有默认语言文档可编辑', true);
      return;
    }
    const hit = target && target.file ? defaults.find((f) => f.file === String(target.file)) : null;
    const file = hit ? hit.file : defaults[0].file;
    const ln = target?.line != null ? parseInt(target.line, 10) : null;
    pf.edit = {
      open: true, file, mode: 'edit', content: null, disk: null, busy: false,
      loadErr: null, pending: null, savedNote: null,
      pendingFocus: hit && Number.isFinite(ln) && ln >= 1 ? { line: ln } : null,
    };
    render();
    loadEditFile(file).then(() => focusEditIssue());
  }

  // 读取弹窗当前文件磁盘内容（迟到响应按 pf 身份 + seq + 文件丢弃；失败给原因与重试，
  // 不丢已输入草稿——content 仅在读取成功时覆盖）。
  async function loadEditFile(file) {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf?.edit?.open || pf.edit.file !== file || !state.project) return;
    const stamp = ++pf.seq;
    try {
      const r = await fetch(`/api/build/docs?project=${encodeURIComponent(state.project)}&id=${encodeURIComponent(v.id)}&file=${encodeURIComponent(file)}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `读取失败（${r.status}）`);
      if (state.pf !== pf || pf.seq !== stamp || !pf.edit?.open || pf.edit.file !== file) return;
      pf.edit.content = data.content == null ? '' : data.content;
      pf.edit.disk = pf.edit.content;
      pf.edit.loadErr = null;
    } catch (e) {
      if (state.pf !== pf || !pf.edit?.open || pf.edit.file !== file) return;
      pf.edit.loadErr = e.message; // content/disk 保持：读取失败不覆盖已有输入
    }
    // BUG-20260925-004：渲染只服务弹窗内容落点——弹窗已关（关闭动作与读取竞态）不再
    // 重渲染窗格（避免「随即关闭」仍触发整块重建与滚动回顶）。
    if (state.pf === pf && pf.edit?.open) render();
  }

  // 定位突出建议行（弹窗内容加载完成后一次性消费 pendingFocus）：选区该行首尾 + 聚焦 +
  // 滚动定位 + 短暂描边闪烁（BUG-20260925-005：补齐落点闪烁，口径与原审查侧定位完全
  // 一致，目标为单语言编辑框）；行号缺失 / 空内容保持既有兜底（仅编辑态，不定位不报错）。
  function focusEditIssue() {
    const pf = state.pf;
    const target = pf?.edit?.pendingFocus;
    if (!pf?.edit?.open || !target) return;
    pf.edit.pendingFocus = null;
    const box = $('.bld-edit-editor');
    if (!box) return;
    box.focus();
    const value = String(box.value || '');
    if (!target.line || !value) return;
    const lines = value.split('\n');
    const idx = Math.min(target.line, lines.length) - 1;
    let start = 0;
    for (let i = 0; i < idx; i++) start += lines[i].length + 1;
    box.setSelectionRange(start, start + lines[idx].length);
    const lh = parseFloat(getComputedStyle(box).lineHeight) || 20;
    box.scrollTop = Math.max(0, (idx + 0.5) * lh - (box.clientHeight || 0) / 2);
    box.classList.add('bld-review-focus-flash');
    setTimeout(() => { box.classList?.remove('bld-review-focus-flash'); }, 2000);
  }

  // 切换 / 刷新 / 关闭的未保存保护入口：有未保存修改先进挂起态（弹窗内联三动作：
  // 保存并继续 / 放弃修改并继续 / 留在本文件），不直接执行、不丢字；无未保存直接执行。
  function requestEditSwitch(file) {
    const pf = state.pf;
    if (!pf?.edit?.open || pf.edit.busy || !file || file === pf.edit.file) return;
    if (editUnsaved(pf)) { pf.edit.pending = { kind: 'switch', file }; render(); return; }
    doEditSwitch(file);
  }

  function requestEditRefresh() {
    const pf = state.pf;
    if (!pf?.edit?.open || pf.edit.busy) return;
    if (editUnsaved(pf)) { pf.edit.pending = { kind: 'refresh' }; render(); return; }
    doEditRefresh();
  }

  function requestEditClose() {
    const pf = state.pf;
    if (!pf?.edit?.open || pf.edit.busy) return;
    if (editUnsaved(pf)) { pf.edit.pending = { kind: 'close' }; render(); return; }
    closeEditDialog();
  }

  function doEditSwitch(file) {
    const pf = state.pf;
    if (!pf?.edit?.open || !file) return;
    pf.edit.pending = null;
    pf.edit.file = file;
    pf.edit.content = null;
    pf.edit.disk = null;
    pf.edit.loadErr = null;
    pf.edit.savedNote = null;
    render();
    loadEditFile(file);
  }

  function doEditRefresh() {
    const pf = state.pf;
    if (!pf?.edit?.open) return;
    const file = pf.edit.file;
    pf.edit.pending = null;
    pf.edit.content = null;
    pf.edit.disk = null;
    pf.edit.loadErr = null;
    render();
    loadEditFile(file);
  }

  function closeEditDialog() {
    const pf = state.pf;
    if (!pf?.edit?.open) return;
    pf.edit = null;
    // BUG-20260925-004：同 closeReview——只摘弹窗元素不整块重建窗格，最新四态与门禁由
    // 后台静默同步按需更新（不进 loading 占位、不回顶）。
    $('#bldEditWrap')?.remove();
    syncDocsPlanSilently();
  }

  // 挂起动作裁决：cancel 留在当前文件；discard 放弃草稿执行挂起动作；save 先保存（成功才
  // 执行挂起动作，失败保留输入留在原文件）。返回值：save 路径透传保存结果。
  async function resolveEditPending(action) {
    const pf = state.pf;
    const pending = pf?.edit?.pending;
    if (!pending || pf.edit.busy) return false;
    const perform = () => {
      if (pending.kind === 'switch') doEditSwitch(pending.file);
      else if (pending.kind === 'refresh') doEditRefresh();
      else closeEditDialog();
    };
    if (action === 'cancel') { pf.edit.pending = null; render(); return false; }
    if (action === 'discard') { perform(); return true; }
    const ok = await saveEditFile();
    if (ok) perform();
    return ok;
  }

  // 保存弹窗当前文件（沿用 /api/build/docs/save 白名单 + ≤2MiB 口径）；成功回写 disk 与
  // 成功反馈（已保存 ≠ 已提交），失败保留输入不误标（savedNote 不设置）。
  async function saveEditFile() {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    if (!pf?.edit?.open || pf.edit.busy || !state.project || pf.edit.content == null) return false;
    pf.edit.busy = true;
    pf.edit.savedNote = null;
    pf.edit.pending = null;
    render();
    try {
      const r = await fetch(`/api/build/docs/save?project=${encodeURIComponent(state.project)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id, file: pf.edit.file, content: String(pf.edit.content ?? '') }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `保存失败（${r.status}）`);
      if (data.docsFlow) pf.plan = { ...(pf.plan || {}), docsFlow: data.docsFlow };
      pf.edit.disk = String(pf.edit.content ?? '');
      pf.edit.savedNote = '已保存 ✓（未提交：需审核通过并「提交」后进入本地 dev；默认语言变化会使翻译基准失效）';
      toast(`✓ 已保存 ${pf.edit.file}（未提交：需审核通过并「提交」后进入本地 dev）`);
      return true;
    } catch (e) {
      toast(`✕ 保存失败：${e.message}（内容已保留在编辑框中，可重试）`, true);
      return false;
    } finally {
      if (pf.edit) pf.edit.busy = false;
      if (state.pf === pf) render();
    }
  }

  // BUG-20260925-002 决断落库：接受 / 拒绝 / 过期逐条 POST 到服务端校对账本（run.json
  // decisions），刷新 / 切版本重进后重播种不丢；持久化失败不阻塞会话内决断（降级回内存
  // 口径，刷新后由 alreadyAppliedChk 已应用识别兜底不误报）。
  async function persistChkDecision(pf, run, file, idx, decision) {
    if (!state.project) return false;
    try {
      const r = await fetch(`/api/build/docs-check/decision?project=${encodeURIComponent(state.project)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pf.verId, runId: run.runId, file, idx, decision }),
      });
      return r.ok;
    } catch { return false; }
  }

  // ③ 建议接受：取磁盘最新内容 → 定位替换（applyChkSuggestion，行级 / 全文包含校验）→
  // 保存成功才记「已接受」（幂等：已决断条目直接返回；保存失败不误标）；文本已变化先区分
  //「此前已应用」（after 已在磁盘——BUG-20260925-002：决断丢失后重复接受不误报过期，标
  // accepted 计已处理）与「原文被人工改过」（仍标过期不覆盖人工修改）；决断逐条落库持久化。
  async function acceptChkSuggestion(file, idx) {
    const v = selVersion();
    const pf = v ? pfOf(v) : null;
    const run = pf?.plan?.docsCheck;
    if (!pf || pf.phase !== 'ready' || !state.project || !run || run.phase !== 'done') return;
    if (!pf.chkDecisions) pf.chkDecisions = {};
    const key = `${run.runId}|${file}|${idx}`;
    const cur = pf.chkDecisions[key];
    if (cur === 'accepted' || cur === 'rejected' || cur === 'stale') return; // 幂等不重复应用
    if (pf.chkBusy) return;
    const sug = parseChkSuggestion(splitProofreadIssues((run.issues || {})[file] || '')[idx] || '');
    if (!sug || !sug.applicable) return;
    pf.chkBusy = key;
    // BUG-20260925-001：锚定刚操作的条目（busy 中间渲染保留，决断渲染消费滚动到该条）
    pf.chkAnchor = { runId: run.runId, file, idx };
    render();
    try {
      const r0 = await fetch(`/api/build/docs?project=${encodeURIComponent(state.project)}&id=${encodeURIComponent(v.id)}&file=${encodeURIComponent(file)}`);
      const d0 = await r0.json().catch(() => ({}));
      if (!r0.ok) throw new Error(d0.error || `读取失败（${r0.status}）`);
      const applied = applyChkSuggestion(d0.content == null ? '' : d0.content, sug);
      if (applied.stale || applied.error) {
        // BUG-20260925-002：定位失败先识别「此前已应用」（after 已在磁盘内容中——刷新丢
        // 决断后重复接受给非失败反馈，不误报「文本已变化」）；「原文被人工改过」仍标过期。
        const wasApplied = applied.stale ? alreadyAppliedChk(d0.content == null ? '' : d0.content, sug) : false;
        pf.chkDecisions[key] = wasApplied ? 'accepted' : 'stale';
        await persistChkDecision(pf, run, file, idx, wasApplied ? 'accepted' : 'stale');
        if (wasApplied) toast('✓ 该建议此前已应用：当前内容已是建议后的文本，无需重复操作');
        else toast('✕ 建议已过期：建议基于的文本已变化，未覆盖当前内容（请重新校对或点「✎ 修改」手动处理）', true);
        return;
      }
      const r = await fetch(`/api/build/docs/save?project=${encodeURIComponent(state.project)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id, file, content: applied.content }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `保存失败（${r.status}）`);
      if (data.docsFlow) pf.plan = { ...(pf.plan || {}), docsFlow: data.docsFlow };
      pf.chkDecisions[key] = 'accepted';
      await persistChkDecision(pf, run, file, idx, 'accepted');
      toast(`✓ 已接受并保存 ${file} 的建议：文件回到待审核，翻译基准已更新`);
    } catch (e) {
      toast(`✕ 接受失败：${e.message}（文档未修改，可重试）`, true);
    } finally {
      pf.chkBusy = null;
      if (state.pf === pf) render();
    }
  }

  // ③ 建议拒绝：仅记「已拒绝」，原文不动（与接受结果可区分；已决断幂等）；决断落库持久化
  //（BUG-20260925-002），刷新 / 切版本重进后不再回到待处理。
  async function rejectChkSuggestion(file, idx) {
    const pf = state.pf;
    const run = pf?.plan?.docsCheck;
    if (!run || pf.chkBusy) return;
    if (!pf.chkDecisions) pf.chkDecisions = {};
    const key = `${run.runId}|${file}|${idx}`;
    const cur = pf.chkDecisions[key];
    if (cur === 'accepted' || cur === 'rejected' || cur === 'stale') return;
    pf.chkDecisions[key] = 'rejected';
    // BUG-20260925-001：拒绝同样锚定当前条目（重渲染后视图不跳回第一条）
    pf.chkAnchor = { runId: run.runId, file, idx };
    toast('已拒绝该条建议：原文保持不变');
    render();
    await persistChkDecision(pf, run, file, idx, 'rejected');
  }

  // BUG-20260925-001 校对建议列表滚动保留：render() 全量重建「文档编写」窗格 DOM，建议列表
  // .bld-chk-list（max-height 460px 纵向滚动容器）随重建丢 scrollTop——接受 / 拒绝与校对 run
  // 轮询刷新都触发重渲染，视图每次跳回第一条。修复分三段：
  // ① captureChkScroll：重渲染前记忆旧列表滚动位置；
  // ② restoreChkListScroll：重建后先恢复记忆位置，再把锚点条目按 nearest 口径微调进可视区
  //   （完全可见不动；上方露出上移贴顶；下方越界下移贴底——不引入整页滚动）；
  // ③ applyChkScrollAfterRender：锚点仅在决断渲染（chkBusy 已清空）消费一次，busy 中间渲染
  //   保留到决断渲染；换 run 锚点失效丢弃；主动换文件（chkScrollReset）从顶部开始。
  function captureChkScroll(view) {
    const el = view?.querySelector?.('.bld-chk-list');
    return el ? { top: el.scrollTop || 0 } : null;
  }

  function restoreChkListScroll(listEl, saved, anchor) {
    if (!listEl) return;
    if (saved && typeof saved.top === 'number') listEl.scrollTop = saved.top;
    if (!anchor) return;
    const card = listEl.querySelector ? listEl.querySelector(`.bld-chk-issue[data-chk-idx="${anchor.idx}"]`) : null;
    if (!card || typeof card.getBoundingClientRect !== 'function' || typeof listEl.getBoundingClientRect !== 'function') return;
    const lr = listEl.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    if (cr.top < lr.top) listEl.scrollTop += cr.top - lr.top;
    else if (cr.bottom > lr.bottom) listEl.scrollTop += cr.bottom - lr.bottom;
  }

  function applyChkScrollAfterRender(view, saved) {
    const pf = state.pf;
    if (!pf) return;
    const runId = pf.plan?.docsCheck?.runId;
    if (pf.chkAnchor && pf.chkAnchor.runId !== runId) pf.chkAnchor = null; // 换 run 丢弃
    const anchor = !pf.chkBusy && pf.chkAnchor ? pf.chkAnchor : null; // busy 渲染不消费
    if (anchor) pf.chkAnchor = null; // 决断渲染一次性消费
    const listEl = view?.querySelector?.('.bld-chk-list');
    const reset = !!pf.chkScrollReset;
    pf.chkScrollReset = false;
    if (!listEl || reset) return; // 主动换文件：新文件列表从顶部开始
    restoreChkListScroll(listEl, saved, anchor);
  }

  // 二次编辑弹窗渲染：默认语言单语言（文件下拉只列默认语言文件，无其他语种对照列）；
  // 顶部文件选择 + 刷新 + 编辑/预览切换，底部保存 / 关闭；未保存提示与挂起三动作内联呈现。
  function renderSecondaryEditModal(v) {
    const pf = v ? pfOf(v) : null;
    const ed = pf?.edit;
    if (!ed?.open) return '';
    const flowEval = normalizeFlowEval(pf.plan || {});
    const files = flowEval.defaultFiles;
    const mode = ed.mode === 'preview' ? 'preview' : 'edit';
    const unsaved = ed.disk != null && ed.content != null && ed.content !== ed.disk;
    const body = ed.content == null
      ? (ed.loadErr
        ? `<p class="rel-form-err small" role="alert">读取失败：${esc(ed.loadErr)}</p>
          <p><button type="button" class="btn small" data-edit-retry title="重新读取该文件的磁盘内容">重试读取</button></p>`
        : '<p class="muted small" role="status">正在读取文档内容…</p>')
      : mode === 'edit'
        ? `<textarea class="bld-edit-editor" rows="20" spellcheck="false" aria-label="默认语言文档内容（编辑）">${esc(ed.content)}</textarea>`
        : (!String(ed.content).trim()
          ? '<div class="bld-review-preview muted small">（空文档）</div>'
          : `<div class="bld-review-preview md" data-i18n-skip>${renderMd(ed.content)}</div>`);
    const footNote = ed.busy
      ? '保存中…'
      : ed.savedNote
        ? ed.savedNote
        : ed.loadErr
          ? '读取失败：内容尚未加载（可重试读取）'
          : '默认语言初稿编辑（其余语言由「④ AI 翻译」产出）';
    return `
      <div class="rel-modal-wrap bld-edit-wrap" id="bldEditWrap" role="dialog" aria-modal="true" aria-label="二次编辑（默认语言）">
        <div class="rel-modal bld-edit-modal">
          <header class="bld-review-head">
            <span>二次编辑 · 默认语言（${esc(v?.id || '')}）</span>
            <button type="button" class="btn small quiet" data-edit-close aria-label="关闭对话框">✕ 关闭</button>
          </header>
          <div class="bld-edit-bar">
            <label class="field-inline" for="bldEditFileSel">文件</label>
            <select id="bldEditFileSel" data-edit-file${ed.busy ? ' disabled' : ''}>
              ${files.map((f) => `<option value="${esc(f.file)}"${f.file === ed.file ? ' selected' : ''} data-i18n-skip>${esc(f.file)}</option>`).join('')}
            </select>
            <button type="button" class="btn small" data-edit-refresh${ed.busy || ed.content == null ? ' disabled' : ''} title="重新从磁盘读取该文件（外部修改后取回最新内容；有未保存修改时会先询问保存或放弃）">刷新</button>
            <span class="bld-doc-mode" role="group" aria-label="编辑或预览">
              <button type="button" class="btn small${mode === 'edit' ? ' on' : ''}" data-edit-mode="edit">编辑</button>
              <button type="button" class="btn small${mode === 'preview' ? ' on' : ''}" data-edit-mode="preview">预览</button>
            </span>
          </div>
          <div class="bld-edit-body">${body}</div>
          ${unsaved && !ed.pending ? '<p class="small bld-edit-unsaved" role="status">有未保存的修改：切换文件 / 刷新 / 关闭前会先询问保存或放弃。</p>' : ''}
          ${ed.pending ? `
          <div class="bld-edit-pending" role="alertdialog" aria-label="处理未保存修改">
            <span>有未保存的修改：</span>
            <button type="button" class="btn small primary" data-edit-keep${ed.busy ? ' disabled' : ''}>保存并继续</button>
            <button type="button" class="btn small" data-edit-discard${ed.busy ? ' disabled' : ''}>放弃修改并继续</button>
            <button type="button" class="btn small quiet" data-edit-stay>留在本文件</button>
          </div>` : ''}
          <footer class="bld-review-foot">
            <span class="small" role="status">${esc(footNote)}</span>
            <span>
              <button type="button" class="btn small" data-edit-save${ed.busy || ed.content == null ? ' disabled' : ''}>保存</button>
              <button type="button" class="btn small" data-edit-close${ed.busy ? ' disabled' : ''}>关闭</button>
            </span>
          </footer>
        </div>
      </div>`;
  }

  // REQ-20260922-005 选择开源协议弹框：LICENSE.md 未编写时点击「AI 总结」打开（002 口径 B
  // 下 LICENSE 不进 AI 总结——弹框是人工选协议的引导，写入的是内置 SPDX 标准文本）。表格
  // 罗列主流协议的定义 / 官网网址 / 优劣（协议名 / SPDX 标识 / 官网 URL 是标识，data-i18n-skip；
  // 定义与优劣是文案，随界面语言翻译）；行单选（radio + 高亮），确认 = 写入标准文本并继续
  // 总结，暂不选择 = 不写盘直接继续，✕ / Esc / 遮罩 = 关闭不继续。加载中 / 加载失败（重试）/
  // 写入中（按钮禁用）三态齐备。
  function renderLicenseModal(v) {
    const pf = v ? pfOf(v) : null;
    const lic = pf?.license;
    if (!lic?.open) return '';
    const copyleftLabel = { none: '宽松', weak: '弱著佐权', strong: '强著佐权' };
    let bodyHtml;
    if (lic.loading) {
      bodyHtml = '<p class="muted small" role="status">正在加载协议目录…</p>';
    } else if (lic.error) {
      bodyHtml = `<p class="rel-form-err" role="alert">协议目录读取失败：${esc(lic.error)}（可重试，或「暂不选择」直接总结，LICENSE.md 稍后在「审查」中人工编写）</p>
          <p><button type="button" class="btn small" data-license-retry${lic.busy ? ' disabled' : ''}>重试</button></p>`;
    } else {
      const rows = (lic.list || []).map((x) => `
            <tr class="bld-license-row${lic.sel === x.id ? ' sel' : ''}" data-license-row="${esc(x.id)}">
              <td><label class="bld-license-pick"><input type="radio" name="bldLicensePick" value="${esc(x.id)}"${lic.sel === x.id ? ' checked' : ''}${lic.busy ? ' disabled' : ''}> <span class="bld-license-name" data-i18n-skip>${esc(x.name)}</span> <code data-i18n-skip>${esc(x.id)}</code></label><span class="bld-doc-custom-tag">${esc(copyleftLabel[x.copyleft] || '')}</span></td>
              <td>${esc(x.definition)}</td>
              <td><a href="${esc(x.url)}" target="_blank" rel="noreferrer" data-i18n-skip>${esc(x.url)}</a></td>
              <td><ul class="bld-license-plist">${(x.pros || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul></td>
              <td><ul class="bld-license-plist cons">${(x.cons || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul></td>
            </tr>`).join('');
      bodyHtml = `
          <div class="bld-license-table-wrap"><table class="bld-license-table">
            <thead><tr><th>协议</th><th>定义</th><th>官网</th><th>优势</th><th>劣势</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>`;
    }
    return `
      <div class="rel-modal-wrap bld-license-wrap" id="bldLicenseWrap" role="dialog" aria-modal="true" aria-label="选择开源协议">
        <div class="rel-modal bld-license-modal">
          <header class="bld-review-head">
            <span>选择开源协议（LICENSE.md 尚未编写）</span>
            <button type="button" class="btn small quiet" data-license-close${lic.busy ? ' disabled' : ''} aria-label="关闭对话框">✕ 关闭</button>
          </header>
          <p class="muted small">AI 总结不覆盖 LICENSE.md：请选择开源协议，确认后写入该协议的标准文本（含占位符如 &lt;year&gt; &lt;copyright holders&gt;，审查时人工确认填写）；写入后 LICENSE.md 转为「待审核」，由人工在「审查」中通过审核。协议口径以官网为准。</p>
          ${bodyHtml}
          <footer class="bld-review-foot">
            <span class="muted small">选择协议即写入标准文本；也可暂不选择，稍后在「审查」中人工编写。</span>
            <span>
              <button type="button" class="btn small" data-license-skip${lic.busy ? ' disabled' : ''}>暂不选择，继续 AI 总结</button>
              <button type="button" class="btn small primary" data-license-confirm${!lic.sel || lic.busy ? ' disabled' : ''}>${lic.busy ? '写入中…' : '写入 LICENSE.md 并继续总结'}</button>
            </span>
          </footer>
        </div>
      </div>`;
  }

  // 挑选合并步（REQ-20260926-002 重排）：隔离分析收敛为「一行汇总 + 未选祖先明细折叠（只读
  // 参考，不再引导一键纳入）」；共享提交（多对多关联）单行说明按 hash 去重只执行一次；
  // 门禁锁定 / 不在 dev / 合并失败仍单行状态条（bld-iso-note），真实原因三通道可达：单行
  // title / 主按钮 title / 点击 toast（BUG-20260920-006「点击必反馈」不回退；服务端守卫不弱化）。
  // REQ-20260927-004：未选祖先按变更文件静态分类——发布文档提交（变更文件全部为根第一层
  // 发布文档）对合入 main 无影响（由「文档合并」步单独处理），从源码祖先明细拆出，单独
  // 折叠行展示（默认收起，M 单独计数）；汇总行合并「影响条目数」与去向说明为一句完整文案
  //（X 只统计源码祖先）。分类只读：折叠行不提供纳入 / 移出合并集合的任何入口。
  function renderMergePane(v) {
    const pf = pfOf(v);
    if (!pf || pf.phase === 'loading') return '<div class="bld-merge-pane"><p class="muted" role="status">正在加载合并分析…</p></div>';
    if (pf.phase === 'error' || !pf.plan) {
      return `<div class="bld-merge-pane"><p class="rel-form-err" role="alert">合并分析读取失败：${esc(pf.error || '未知原因')}</p>
        <p><button type="button" class="btn small" data-pf-retry>重试</button></p></div>`;
    }
    const p = pf.plan;
    const gate = (p.steps || []).find((s) => s.key === 'merge');
    const an = p.mergeAnalysis || { perItem: [], shared: [], notes: [] };
    const onDev = p.currentBranch === 'dev';
    // 未选祖先明细：有未选祖先的所选条目（去重提交；owner = 该祖先隶属的所选条目，明细标注用）
    // REQ-20260926-002：只读参考——不将未选祖先认定为必须加入的功能依赖，无一键纳入入口。
    const allInter = [];
    for (const x of an.perItem || []) {
      for (const i of x.intermediates || []) {
        const h = String(i.hash || '').toLowerCase();
        if (h) allInter.push({ ...i, hash: h, owner: x.itemId });
      }
    }
    // 源码祖先 = 未选祖先中非发布文档提交（docOnly=false）；发布文档提交优先读服务端
    // docAncestors（按 hash 去重附归属），旧响应缺该字段时按 perItem 的 docOnly 行兜底。
    const srcRows = allInter.filter((i) => !i.docOnly);
    const docRows = (Array.isArray(an.docAncestors) && an.docAncestors.length
      ? an.docAncestors.map((d) => ({ hash: String(d.hash || '').toLowerCase(), subject: d.subject, owner: (d.itemIds || [])[0] || '' }))
      : allInter.filter((i) => i.docOnly)).filter((i) => i.hash);
    const depCommits = new Map();
    for (const i of srcRows) {
      if (!depCommits.has(i.hash)) depCommits.set(i.hash, i);
    }
    const docCommits = new Map();
    for (const i of docRows) {
      if (!docCommits.has(i.hash)) docCommits.set(i.hash, i);
    }
    const depN = depCommits.size; // X：源码祖先数（不含发布文档提交）
    const docN = docCommits.size; // M：发布文档提交数（单独计数，不混入 X）
    const affectedN = new Set(srcRows.map((i) => i.owner)).size; // Y：受源码祖先影响的所选条目数
    // 明细折叠：每条 短 hash + 提交主题 + 归属所选条目；上限 50 防超长（超出注明，两段分别生效）
    const ISO_MAX = 50;
    const depRows = [...depCommits.values()];
    const depDetails = depN
      ? `<details class="bld-iso-deps"><summary>查看未选祖先明细</summary>
          <ul>${depRows.slice(0, ISO_MAX).map((i) => `<li><code data-i18n-skip>${esc(short(i.hash))}</code> <span data-i18n-skip>${esc(i.subject || '')}</span><br><span class="muted small">为 ${esc(i.owner)} 的未选祖先</span></li>`).join('')}</ul>
          ${depN > ISO_MAX ? `<p class="muted small">（其余 ${depN - ISO_MAX} 个略）</p>` : ''}
        </details>`
      : '';
    // 发布文档提交折叠行（REQ-20260927-004）：默认收起，一行汇总数量与去向；展开逐条
    // 短 hash + 主题 + 徽标（颜色 + 文字）+ 去向说明；上限 50 同源码明细分别生效
    const docDetails = docN
      ? `<details class="bld-iso-docs"><summary>另有 ${docN} 个发布文档提交 · 随『文档合并』步处理，不随挑选合并</summary>
          <ul>${docRows.slice(0, ISO_MAX).map((i) => `<li><code data-i18n-skip>${esc(short(i.hash))}</code> <span data-i18n-skip>${esc(i.subject || '')}</span><br><span class="bld-iso-doc-tag">发布文档提交</span> <span class="muted small">仅根第一层发布文档 · 不随挑选合并进入 main，随『文档合并』步处理</span></li>`).join('')}</ul>
          ${docN > ISO_MAX ? `<p class="muted small">（其余 ${docN - ISO_MAX} 个略）</p>` : ''}
        </details>`
      : '';
    // 共享提交（同一提交关联多个条目）：单行说明按 hash 去重只执行一次（各关联条目结果一致）
    const sharedLine = (an.shared || []).length
      ? `<p class="bld-iso-note" title="${esc((an.shared || []).map((s) => `${short(s.commit)}（关联 ${(s.itemIds || []).join('、')}）`).join('；'))}">共享提交 ${(an.shared || []).length} 处按提交 hash 去重，挑选合并只执行一次（各关联条目展示一致的合入结果）</p>`
      : '';
    // 汇总行（REQ-20260927-004 落定文案）：「影响 Y 个所选条目」与去向说明合并为一句完整文案
    const sumLine = depN
      ? `<p class="bld-iso-sum"><span class="small">发现 ${affectedN} 个所选条目的共 ${depN} 个未选祖先提交。未选的祖先提交不随隔离合并进入 main；若所选改动依赖其内容，执行时将冲突阻止并说明原因。</span></p>`
      : '';
    let isoBody;
    if (depN) {
      isoBody = `${sumLine}
        ${docDetails}
        ${depDetails}
        ${sharedLine}`;
    } else {
      isoBody = `<p class="small muted">所选提交无未选祖先：变更可独立进入主分支。</p>
        ${docDetails}
        ${sharedLine}`;
    }
    const devBar = onDev
      ? `<p class="small muted">当前分支 dev · 目标主分支 ${esc(p.mainBranch || 'main')}（合并经临时工作树隔离执行，完成后工作目录仍在 dev）</p>`
      : `<p class="bld-iso-note" role="alert">${p.currentBranch ? `当前分支是 ${esc(p.currentBranch)}，不在 dev：请自行切换回 dev 后重试（不自动切分支）` : '当前处于 detached HEAD，不在 dev：请自行切换回 dev 后重试（不自动切分支）'}</p>`;
    const merged = v.status === 'merged';
    // BUG-20260920-006：主按钮禁用改 aria-disabled（HTML disabled 不派发 click，点击无反馈）；
    // title 归因统一走 mergeBlockReason——不在 dev / 合并执行中不再误回落「前置条件未满足」，
    // 与真实禁用原因一一对应；点击由 openMergeConfirm 守卫 toast 真实原因。
    const mergeReason = mergeBlockReason(v);
    return `
      <div class="bld-merge-pane">
        <section><strong>隔离分析</strong>
          ${isoBody}
        </section>
        ${devBar}
        ${gate?.locked ? `<p class="bld-iso-note" role="alert">⚠ 暂不可合并：${esc(gate.reason || '前置条件未满足')}</p>` : ''}
        <p><button type="button" class="btn primary" data-ver-merge="${esc(v.id)}"${mergeReason ? ` aria-disabled="true" title="${esc(mergeReason)}"` : ''}>${v.status === 'failed' ? '重试挑选合并' : '挑选合并到 main'}</button>
          <span class="muted small">把所选提交按 hash 去重、按拓扑顺序 cherry-pick 进 main；冲突会展示具体提交、文件和原因，已合入提交不重复执行。</span></p>
        ${v.status === 'failed' && v.merge?.error ? `<p class="bld-iso-note" role="alert">⚠ 合并失败：${esc(v.merge.error)}（可重试，只补未合并条目）</p>` : ''}
        ${merged && v.merge?.mainSha ? `<p class="small muted">合并完成：主分支头 <code>${esc(short(v.merge.mainSha))}</code>；重放证据 ${(v.merge?.replays || []).length} 条。</p>` : ''}
      </div>`;
  }

  // 文档合并步（REQ-20260926-002 新增第四步）：审核通过的发布文档单独提交后合入 main。
  // 文档提交直接关联 BLD 版本计划（不要求额外需求 / Bug 单，也不通过功能条目的 done 门禁）；
  // 重试幂等——已合入的文档提交不重复执行；落账证据（重放提交 / main 头）就展示。
  function renderDocMergePane(v) {
    const pf = pfOf(v);
    if (!pf || pf.phase === 'loading') return '<div class="bld-docmerge-pane"><p class="muted" role="status">正在加载文档状态…</p></div>';
    if (pf.phase === 'error' || !pf.plan) {
      return `<div class="bld-docmerge-pane"><p class="rel-form-err" role="alert">文档状态读取失败：${esc(pf.error || '未知原因')}</p>
        <p><button type="button" class="btn small" data-pf-retry>重试</button></p></div>`;
    }
    const p = pf.plan;
    const gate = (p.steps || []).find((s) => s.key === 'docmerge');
    const docs = p.docs || {};
    const committed = docs.overall === 'committed';
    const dm = v.docsMerge || null;
    const dmTime = dm ? (dm.mergedAt || v.updatedAt) : null;
    return `
      <div class="bld-docmerge-pane">
        <section><strong>文档合并</strong>
          <p class="muted small">把审核通过的发布文档提交 cherry-pick 重放进 main：文档单独提交、直接关联版本计划 ${esc(v.id)}，合入结果落账到本版本计划（重放证据可追溯）。</p>
          ${docs.commitHash
            ? `<p class="small">文档提交 <code data-i18n-skip>${esc(short(docs.commitHash))}</code>${committed ? '（已提交且基于当前范围）' : '（有未提交修改或发布范围已变化，请回「文档与翻译」重新提交后再合并）'}</p>`
            : '<p class="small muted">尚未提交发布文档：请先在「文档与翻译」步完成编写、翻译、审核并提交。</p>'}
          ${dm ? `<p class="small" role="status">已合并入 main：重放提交 <code data-i18n-skip>${esc(short(dm.replayedHash || dm.commitHash))}</code>${dm.mainSha ? ` · main 头 <code data-i18n-skip>${esc(short(dm.mainSha))}</code>` : ''}${dmTime ? `（合并时间 ${esc(fmtTime(dmTime))}）` : ''}；重放证据 ${(dm.replays || []).length} 条。</p>` : ''}
          ${gate?.locked ? `<p class="bld-iso-note" role="alert">⚠ 暂不可合并文档：${esc(gate.reason || '前置条件未满足')}</p>` : ''}
          <p><button type="button" class="btn primary" data-docs-merge="${esc(v.id)}"${pf.dmBusy ? ' disabled' : (gate?.locked ? ' aria-disabled="true" title="前置条件未满足"' : '')}>${pf.dmBusy ? '合并中…' : (dm ? '重新执行文档合并（幂等）' : '文档合并入 main')}</button>
            <span class="muted small">已合入的文档提交重试不重复执行；失败保留已完成结果，可重试。</span></p>
        </section>
      </div>`;
  }

  // 发布步（REQ-20260926-002 最后一步，两个动作分别展示结果）：
  //   动作一 · 推送远端——以明确操作把本地 main 推送到远端（成功记录推送完成时间）；
  //   动作二 · 官网资料更新——依据本版本最终文档更新官网资料（提示词 + 同步检测作为更新结果）。
  // 区分本地 main 已合入（合并完成）、远端已推送（pushedAt）、官网资料已更新（site hit）；
  // 不把本地合入等同于远端发布或网站部署成功；两动作失败分别展示原因与重试入口。
  // 官网提示词默认折叠（BUG-20260928-004）：与 REQ-20260921-007「AI 总结 / AI 翻译提示词」同口径的
  // details 折叠盒，摘要行说明用途与复制口径，需要查看全文再展开；同步状态标签与「立即检测」
  // 在折叠区外渲染，不再被常驻展开的长提示词推到折叠线以下（复制链路与提示词内容不变）。
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
    const relGate = (p.steps || []).find((s) => s.key === 'release') || null;
    const pushLock = relGate?.locked ? (relGate.reason || '前置条件未满足') : (onDev ? '' : (p.currentBranch ? `当前分支是 ${esc(p.currentBranch)}，不在 dev：请自行切换回 dev 后重试（不自动切分支）` : '当前处于 detached HEAD，不在 dev：请自行切换回 dev 后重试（不自动切分支）'));
    const pushState = rel.pushedAt
      ? `<p class="small" role="status">已推送到远端 ${esc(rel.pushRemote || '')}（完成时间 ${esc(fmtTime(rel.pushedAt))}，基准 <code data-i18n-skip>${esc(short(rel.pushedSha))}</code>）；官网资料更新以该时间为检测起点。</p>`
      : '<p class="small muted">尚未推送到远端（推送成功时间将作为官网资料更新的检测起点）。</p>';
    // BUG-20260928-005：已推送但未经「发布」按钮二次确认——明确推送不等于正式发布，
    // 范围操作未被锁定，补确认路径即「发布」按钮（一键发布链路）。
    const pushNotReleaseNote = rel.pushedAt && !releasedOf(v)
      ? '<p class="muted small" role="note">推送完成不等于正式发布：正式发布以「发布」按钮二次确认为准，确认后版本范围锁定。</p>'
      : '';
    const site = rel.site || { status: 'waiting' };
    const siteCls = site.status === 'hit' ? 'st-ok' : site.status === 'failed' ? 'st-fail' : site.status === 'scanning' ? 'st-run' : 'st-mute';
    const evidence = site.status === 'hit' && site.evidence
      ? `<p class="small">官网已同步：匹配提交 <code data-i18n-skip>${esc(short(site.evidence.hash))}</code>（分支 ${esc(site.branch || '—')}，检测时间 ${esc(fmtTime(site.evidence.matchedAt))}）<br>主题：${esc(site.evidence.subject || '')}</p>`
      : '';
    const siteInfo = site.reason ? `<p class="small">${esc(site.reason)}</p>` : '';
    const times = `<p class="muted small">官网路径：${esc(p.siteRepoRoot || '未配置（设置中配置官网仓库根目录）')} · 实际分支：${esc(site.branch || '—')} · 上次检测 ${esc(fmtTime(site.lastScanAt))}${site.nextScanAt ? ` · 下一次 ${esc(fmtTime(site.nextScanAt))}` : ''}${site.since ? ` · 扫描起点 ${esc(fmtTime(site.since))}` : ''}</p>`;
    return `
      <div class="bld-release-pane">
        <section><strong>动作一 · 推送远端</strong>
          ${pushState}
          ${pushNotReleaseNote}
          <p><label class="small">目标远端 <select class="bld-push-main-remote">${remotes.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
            <button type="button" class="btn primary" data-pf-push${pushLock ? ` aria-disabled="true" title="${esc(pushLock)}"` : (pf.busy ? ' disabled' : '')}>${pf.busy ? '推送中…' : '推送主分支'}</button>
            <span class="muted small">以明确操作推送本地主分支（${esc(p.mainBranch || 'main')}）到远端：不推 dev、不强推；失败展示原因，可重试。</span></p>
        </section>
        <section><strong>动作二 · 官网资料更新</strong>
          <p class="muted small">依据本版本最终发布文档更新官网资料：提示词在官网仓库执行，读取本项目已发布版本 CHANGELOG / FEATURES 中英文材料，按官网自身架构更新；完成提交消息须含完整计划号。结果单独展示，与推送结果互不等同。</p>
          ${p.sitePrompt ? `<details class="bld-docs-prompt-box bld-site-prompt-box">
          <summary>官网提示词（默认折叠，点击展开查看全文；复制后在官网仓库会话粘贴执行，提交消息须含完整计划号）</summary>
          <textarea class="bld-site-prompt" rows="7" readonly>${esc(p.sitePrompt)}</textarea>
          <p><button type="button" class="btn small primary" data-pf-copy-site>复制官网提示词</button></p>
        </details>` : '<p class="small muted">未配置官网仓库：先在设置中配置官网仓库根目录。</p>'}
          <p><span class="st ${siteCls}">${esc(SITE_STATE_LABEL[site.status] || site.status)}</span>
            <button type="button" class="btn small" data-pf-scan${pf.siteBusy ? ' disabled' : ''}>${pf.siteBusy ? '检测中…' : '立即检测'}</button></p>
          ${evidence}${siteInfo}${times}
          <p class="muted small" role="note">${esc(p.siteNotice || pf.plan?.siteNotice || '每分钟检查官网本地主分支；匹配仅表示本地提交已同步，不代表已推送或网站已部署')}</p>
        </section>
      </div>`;
  }

  // REQ-20260921-014：概况页签就地编辑表单——名称 + 描述同一表单一次保存；字数计数器
  //（N / 上限）输入时由监听直接更新文本节点（不整页重渲染保焦点）；错误区承载客户端校验
  // 与保存失败原因（失败内容保留可重试）；保存中双按钮禁用防重复提交
  function renderPlanEditForm(pe) {
    const nameLen = String(pe.name ?? '').length;
    const descLen = String(pe.description ?? '').length;
    return `
        <div class="bld-plan-edit bld-edit-form" role="form" aria-label="编辑版本信息">
          <label class="field">版本名称
            <input class="bld-plan-name" id="bldPlanNameInput" type="text" value="${esc(pe.name)}" autocomplete="off"${pe.busy ? ' disabled' : ''}></label>
          <p class="small muted bld-plan-count" data-plan-count="name">${nameLen} / ${INFO_NAME_MAX}</p>
          <label class="field">版本描述
            <textarea class="bld-plan-desc" id="bldPlanDescInput" rows="4"${pe.busy ? ' disabled' : ''}>${esc(pe.description)}</textarea></label>
          <p class="small muted bld-plan-count" data-plan-count="desc">${descLen} / ${INFO_DESC_MAX}</p>
          ${pe.error ? `<p class="rel-form-err bld-plan-err" role="alert">${esc(pe.error)}</p>` : ''}
          <div class="bld-edit-row">
            <button type="button" class="btn small primary" id="bldPlanSave"${pe.busy ? ' disabled' : ''}>${pe.busy ? '保存中…' : '保存'}</button>
            <button type="button" class="btn small" id="bldPlanCancel"${pe.busy ? ' disabled' : ''}>取消</button>
          </div>
        </div>`;
  }

  function renderDetail(v) {
    if (!v) return '<div class="rel-detail muted">点击左侧版本查看详情</div>';
    // BUG-20260928-005：条目锁基准——merging 与发布确认（正式发布）锁定增删 / 换 commit，
    // merged（含已推送未确认）放开（补关联后重开合并只补未合并条目）。
    const lockItems = v.status === 'merging' || releasedOf(v);
    const itemsLockTitle = v.status === 'merging' ? '合并中，条目不可增删' : '已正式发布，条目已锁定';
    const editing = state.edit && state.edit.id === v.id ? state.edit : null;
    const nameCell = editing?.field === 'name'
      ? `<div class="bld-edit-row"><input class="bld-name-input" value="${esc(v.name)}"><button type="button" class="btn small primary" id="bldSaveName">保存</button><button type="button" class="btn small" id="bldCancelEdit">取消</button></div>`
      : `<strong class="bld-name" title="点击编辑名称" role="button" tabindex="0">${esc(v.name || v.id)}</strong> ${statusChipFor(v)}`;
    const descCell = editing?.field === 'desc'
      ? `<div class="bld-edit-row"><textarea class="bld-desc-input" rows="3">${esc(v.description)}</textarea><button type="button" class="btn small primary" id="bldSaveDesc">保存</button><button type="button" class="btn small" id="bldCancelEdit">取消</button></div>`
      : `<span class="bld-desc" title="点击编辑描述" role="button" tabindex="0">${v.description ? esc(v.description) : '<span class="muted">（无描述）</span>'}</span>`;
    // REQ-20260915-003：关联条目联合列表——先对当前版本全量关联行按关键词过滤（覆盖所有页），
    // 再分页（每页 ITEMS_PAGE_SIZE）；渲染时把越界页码校正回写（数据减少回落最后有效页）。
    const searching = !!state.itemsQuery;
    const pg = itemsPageView() || paginateItems([], 1, ITEMS_PAGE_SIZE);
    const itemRows = pg.rows.map((it) => `
      <div class="bld-item-row" data-row-item="${esc(it.itemId)}">
        <span class="bld-item-id">${esc(it.itemId)}</span>
        <span class="bld-item-title" title="${esc(it.title || '')}">${esc(it.title || '')}</span>
        <span class="bld-item-commits" title="该条目关联的全部提交${lockItems ? `（${itemsLockTitle}）` : ''}">${commitsOf(it).map((h) => `<code class="bld-item-commit" data-i18n-skip>${esc(short(h))}</code>`).join('')}</span>
        ${it.mergedAt ? `<span class="st st-ok" title="已合并入 main">✓</span>` : it.mergeError ? `<span class="st st-fail" title="${esc(it.mergeError)}">✕</span>` : ''}
        <button type="button" class="btn small quiet bld-item-remove" data-remove-item="${esc(it.itemId)}" ${lockItems ? `disabled title="${itemsLockTitle}"` : 'title="移出该条目（连同全部 commit 关联）"'}>移出</button>
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
    // REQ-20260920-003：右侧详情改为五步流程导航——1 概况（原「版本计划」，REQ-20260921-013
    // 更名并迁入 AI 完善，信息编辑）→ 2 关联条目与提交（原概况的关联列表）→ 3 文档编写
    // → 4 合并入 main → 5 正式发布（含原产品发布记录页签）
    // REQ-20260922-006：详情头部版本号优先取 x.y.z 字段（存量计划回退派生）；已发布追加「发布于」。
    const versionNumber = v.version || ((v.id && /^BLD-\d{8}-\d{3}$/.test(v.id)) ? v.id.replace(/^BLD-/, '') : '');
    // REQ-20260921-014：概况页签显式编辑——可见「编辑」按钮（merging 禁用 + title 文字
    // 原因），点开就地替换描述区为名称 + 描述同一表单（见 renderPlanEditForm）；与遗留
    // 行内点击编辑并存（快捷路径，见 bindCommon 绑定）。
    // BUG-20260921-016：概况内容区去冗余——删除元信息行（计划号 / 版本号 / 目标分支 /
    // 来源分支，计划号与版本号详情头部已有）与「描述」标签行；顶部仅一行右对齐操作行
    //（bld-plan-acts）「AI 完善」「编辑」同排（AI 完善在左）；编辑态「编辑」键随表单打开
    // 让位（表单自带保存 / 取消），「AI 完善」保留原位。锁定口径不变：BUG-20260920-005
    // 基准（merging 禁用、推送完成即正式发布后禁用并说明，merged 未推送可用）+
    // REQ-20260921-014 编辑键 merging 禁用。data-ver-answer 行为标记与绑定循环保留，
    // openAnswerModal(verId) 仍按当前版本打开。
    const planEdit = planEditOf(v);
    const answerLocked = v.status === 'merging' || releasedOf(v);
    const answerBtn = `<button type="button" class="btn small bld-ver-answer" data-ver-answer="${esc(v.id)}"${answerLocked ? ` disabled title="${releasedOf(v) ? '已正式发布，不允许再 AI 完善' : '合并中，请稍候……'}"` : ''} aria-label="AI 完善 ${esc(v.id)}"${answerLocked ? '' : ` title="复制提示词给 Agent，回答直接粘贴回本弹窗自动解析"`}>AI 完善</button>`;
    const editBtn = v.status === 'merging'
      ? '<button type="button" class="btn small quiet" id="bldEditInfo" disabled title="版本合并中，暂不可修改">编辑</button>'
      : '<button type="button" class="btn small quiet" id="bldEditInfo" title="编辑版本名称与描述">编辑</button>';
    const planActs = `<div class="bld-plan-acts">${answerBtn}${planEdit ? '' : editBtn}</div>`;
    const descBlock = planEdit
      ? renderPlanEditForm(planEdit)
      : `<div class="bld-desc-block">${descCell}</div>`;
    const planBody = `
        ${planActs}
        ${descBlock}
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
    if (state.step === 'docs') stepBody = renderDocsPane(v);
    else if (state.step === 'merge') stepBody = renderMergePane(v);
    else if (state.step === 'docmerge') stepBody = renderDocMergePane(v);
    else if (state.step === 'release') stepBody = `${renderReleaseFlowPane(v)}${renderReleasePane(v)}`;
    // REQ-20260926-002：第一步「选择条目与提交」= 概况（信息编辑 / AI 完善）+ 条目与提交关联
    //（原 link 步内容并入；同时展示条目、去重后的提交及关联）
    else stepBody = `${planBody}${linkBody}`;
    return `
      <div class="rel-detail">
        <header class="rel-detail-head">
          <div>
            <h3>${nameCell}</h3>
            <p class="muted small">${esc(v.id)}${versionNumber ? ` · 版本号 ${esc(versionNumber)}` : ''} · 更新 ${esc(fmtTime(v.updatedAt))}${v.releasedAt ? ` · 发布于 ${esc(fmtTime(v.releasedAt))}` : ''}</p>
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
            <ul>${v.items.map((it) => `<li>${esc(it.itemId)} ${commitsOf(it).map((h) => esc(short(h))).join(' ')} ${esc(it.title || '')}</li>`).join('')}</ul>
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
            <p>版本「<strong>${esc(v.name || v.id)}</strong>」当前状态：${statusChipFor(v)}，共 ${v.items.length} 个关联单。</p>
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
      // REQ-20260914-002：无命中空态（与「该分支暂无提交」区分；一键清除回默认列表）。
      // REQ-20260921-002：highlight 模式数据集不变（无命中仍显示全量 + 「高亮 0 处」计数），
      // 空集仅出现在 filter（闭包保留集空 = 无匹配）或默认列表。
      if (inSearch && !commits.length && !state.logError && state.branchLog?.mode !== 'highlight') {
        return `<p class="muted small">没有匹配的提交（关键词：${esc(state.logQuery)}）</p>
          <p><button type="button" class="btn small quiet" data-log-search-clear>清除</button></p>`;
      }
      if (!commits.length) return '<p class="muted small">该分支暂无提交</p>';
      // BUG-20260914-009：分页展示全部提交（替代 50 条静默截断）——翻页失败保留旧内容时
      // 在列表上方显示行内错误 + 重试（重发失败时的目标页）
      const errBar = state.logError ? `<p class="rel-form-err" role="alert">提交记录读取失败：${esc(state.logError)} <button type="button" class="btn small" id="bldLogRetry">重试</button></p>` : '';
      // REQ-20260921-002：双模式计数行——仅在展示数据与当前关键词一致时显示（翻页失败保留旧
      // 内容时不误报计数）；highlight = 命中处数（数据集为全量分页）；filter = 匹配数与
      // 保留集（匹配 ∪ 祖先闭包）/全量数。
      const countBar = inSearch && state.branchLog?.query === state.logQuery && !state.logError
        ? (state.branchLog?.mode === 'highlight'
          ? `<div class="bld-log-count small" role="status">高亮 ${Number(state.branchLog.matchedTotal ?? 0)} 处匹配（message / 分支名 / tag）</div>`
          : `<div class="bld-log-count small" role="status">匹配 ${Number(state.branchLog?.matchedTotal ?? 0)} 条 · 保留 ${Number(state.branchLog?.total ?? 0)}/${Number(state.branchLog?.allTotal ?? state.branchLog?.total ?? 0)} 条（含祖先，泳道连通）</div>`)
        : '';
      // BUG-20260920-002：双支并集上下文——载荷含 heads（≥2 支本地头）即双支模式（渲染按载荷
      // 驱动；BUG-20260921-008 起服务端所有分支一律单支口径、不再下发 heads / mergeBase /
      // side，本分支仅作载荷兼容保留）；分支名标签（gitgraph refs / 降级列表徽标）与 side 稳定配色。
      const heads = Array.isArray(state.branchLog?.heads) ? state.branchLog.heads.filter((x) => x && x.name && x.hash) : [];
      const dual = heads.length >= 2;
      const mergeBase = state.branchLog?.mergeBase || null;
      // 并集提示：双支模式常驻说明（真实分支名插值，含未合并提交口径）
      const unionHint = dual
        ? `<div class="bld-log-union muted small" role="note">并集视图：同时显示 ${esc(heads[0].name)} 与 ${esc(heads[1].name)} 的提交（含未合并提交）</div>`
        : '';
      // REQ-20260921-002：选中详情区（click 切换选中，树路径与降级列表同口径）——父提交清单
      // 如实列出（页外父也展示短 hash）；合并提交附「合并 · N 父提交」；双支 merge-base 标注。
      const selCommit = state.logSelected ? commits.find((c) => c.hash === state.logSelected) : null;
      const detail = selCommit ? (() => {
        const parents = Array.isArray(selCommit.parents) ? selCommit.parents : [];
        const parentsPart = parents.length
          ? `<span>父提交：</span>${parents.map((p) => `<code>${esc(short(p))}</code>`).join(' ')}`
          : '<span>无父提交（根提交）</span>';
        const mergePart = parents.length >= 2 ? ` <span class="bld-merge-tag">合并 · ${parents.length} 父提交</span>` : '';
        const mbPart = dual && mergeBase && selCommit.hash === mergeBase
          ? ' <span class="bld-branch-tag bt-mb" title="main 与 dev 的汇聚点（merge-base）">main ∩ dev 汇聚点</span>'
          : '';
        return `<div class="bld-log-detail" id="bldLogDetail" role="status"><code>${esc(selCommit.short || selCommit.hash.slice(0, 8))}</code> ${esc(selCommit.subject)}；${parentsPart}${mergePart}${mbPart}</div>`;
      })() : '';
      // REQ-20260921-002：提交树——vendor @gitgraph/js 在位时空容器（bindCommon 后 mountTree
      // 画树：泳道 / 圆点 / 分支合并曲线 / 分支名与 tag 标签 / message + 短 hash，浅深色跟随
      // 系统）；vendor 加载失败降级行式列表（保底可读可交互）。
      const hasGG = typeof window !== 'undefined' && !!window.GitgraphJS;
      const treeBox = `<div class="bld-tree" id="bldTreeBox" role="list">${hasGG ? '' : fallbackTreeHtml(commits)}</div>`;
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
      return errBar + countBar + unionHint + detail + treeBox + boundary + eof + logPagerHtml(page, pages, size, total);
    })() : '<div class="rel-detail muted">点击左侧分支查看提交记录</div>';
    // REQ-20260914-002：搜索控件——关键词输入 + 搜索触发 + 清除入口；执行中禁用防重复触发；
    // 清除入口仅在已有生效关键词时出现（无匹配空态内另有同口径入口）。
    // BUG-20260914-016：搜索控件并入 bld-log-head 头部行（与分支名同一行），
    // 不再在头部行下方独占一行；搜索行为与状态反馈口径不变。
    // REQ-20260921-002：双模式 radio（高亮定位 / 过滤（保留祖先））——默认高亮定位，
    // 模式为视图偏好（切分支不重置）；搜索范围 message / 分支名 / tag / 作者 / hash。
    const searchRow = state.logBranch ? `
          <div class="bld-log-search" role="search">
            <input type="search" id="bldLogSearchInput" placeholder="搜 message / 分支 / tag / 作者 / hash…" value="${esc(state.logQueryInput)}" aria-label="搜索提交记录"${state.logPhase === 'loading' ? ' disabled' : ''}>
            <span class="bld-log-modes" role="radiogroup" aria-label="搜索模式">
              <label class="bld-log-mode"><input type="radio" name="logSearchMode" value="highlight" data-log-mode="highlight"${state.logSearchMode !== 'filter' ? ' checked' : ''}${state.logPhase === 'loading' ? ' disabled' : ''}>高亮定位</label>
              <label class="bld-log-mode"><input type="radio" name="logSearchMode" value="filter" data-log-mode="filter"${state.logSearchMode === 'filter' ? ' checked' : ''}${state.logPhase === 'loading' ? ' disabled' : ''}>过滤（保留祖先）</label>
            </span>
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
  // BUG-20260925-006：审查对话框只读化后无编辑草稿，不再回同步（二次编辑弹窗草稿由
  // pf.edit.content 承载，input 即回写）
  function render(syncModalDrafts = true) {
    const view = $('#buildView');
    if (!view) return;
    if (syncModalDrafts && state.rendered) {
      syncAnswerDraft();
      syncPlanEditDraft(); // REQ-20260921-014：概况页签编辑草稿回同步（防后台重渲染冲掉输入）
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
    // BUG-20260925-001：重建前记忆校对建议列表滚动位置（重建后 applyChkScrollAfterRender 恢复 / 锚定）
    const chkScrollSaved = captureChkScroll(view);
    view.innerHTML = `
      <nav class="rel-tabs bld-tabs" aria-label="构建子页签">${tabs}<span class="bld-tabs-tools">${newBtn}</span></nav>
      ${body}
      ${d?.isRepo ? renderPanel(state.createPanel, '新建版本', '仅已完成（done）且未纳入任何版本的需求单 / Bug 单可纳入版本；勾选条目即整组自动关联其全部提交', 'bldCreateBtn', '创建版本计划') : ''}
      ${d?.isRepo ? renderPanel(state.addPanel, '添加条目', '仅已完成（done）且未纳入任何版本的需求单 / Bug 单可加入本版本（已纳入版本的条目不再出现）；勾选条目即整组自动关联其全部提交', 'bldAddSubmit', '添加所选条目') : ''}
      ${renderAnswerModal()}
      ${renderMergeConfirm()}
      ${renderPushConfirm()}
      ${renderDeleteConfirm()}
      ${renderPublishConfirm()}
      ${renderRelPlanModal()}
      ${renderReviewModal(selVersion())}
      ${renderLicenseModal(selVersion())}
      ${renderSecondaryEditModal(selVersion())}`;
    bindCommon(view);
    // BUG-20260925-001：校对建议列表滚动位置恢复 / 刚操作条目锚定（轮询等被动重渲染不打断）
    applyChkScrollAfterRender(view, chkScrollSaved);
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
      // REQ-20260921-008：AI 总结进度轮询自愈（处于文档编写步且未启动时启动；离开由 setStep / selectVersion 停止）
      if (v0 && state.step === 'docs' && !state.summaryTimer) startSummaryTimer();
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
    q('.bld-name')?.addEventListener('click', () => {
      const v = selVersion();
      if (!v) return;
      // REQ-20260921-014：概况页签编辑表单已开时聚焦表单名称字段（两编辑入口互斥不叠开）
      if (state.planEdit) { try { $('#bldPlanNameInput')?.focus(); } catch { /* 测试环境无 DOM focus */ } return; }
      // REQ-20260921-014：merging 锁定口径与显式入口一致——不进编辑，toast 文字原因
      if (v.status === 'merging') { toast('版本合并中，暂不可修改', true); return; }
      state.edit = { id: v.id, field: 'name' };
      render();
    });
    q('.bld-desc')?.addEventListener('click', () => {
      const v = selVersion();
      if (!v) return;
      if (state.planEdit) return; // 表单打开时描述块已替换为表单，此路径仅防御
      if (v.status === 'merging') { toast('版本合并中，暂不可修改', true); return; }
      state.edit = { id: v.id, field: 'desc' };
      render();
    });
    q('#bldSaveName')?.addEventListener('click', () => { const v = selVersion(); const val = q('.bld-name-input')?.value; if (v && val != null) { state.edit = null; saveInfo(v.id, { name: val }); } });
    q('#bldSaveDesc')?.addEventListener('click', () => { const v = selVersion(); const val = q('.bld-desc-input')?.value; if (v && val != null) { state.edit = null; saveInfo(v.id, { description: val }); } });
    q('#bldCancelEdit')?.addEventListener('click', () => { state.edit = null; render(); });
    // REQ-20260921-014：概况页签显式编辑（名称 + 描述同一表单，一次保存）
    q('#bldEditInfo')?.addEventListener('click', openPlanEdit);
    q('#bldPlanSave')?.addEventListener('click', submitPlanEdit);
    q('#bldPlanCancel')?.addEventListener('click', cancelPlanEdit);
    const planNameInput = q('.bld-plan-name');
    planNameInput?.addEventListener('input', () => {
      const pe = state.planEdit;
      if (!pe) return;
      pe.name = planNameInput.value; // 草稿即时回写：重渲染不丢输入
      const c = q('[data-plan-count="name"]');
      if (c) c.textContent = `${String(pe.name ?? '').length} / ${INFO_NAME_MAX}`; // 计数直改文本节点，不整页重渲染保焦点
    });
    planNameInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPlanEdit(); });
    const planDescInput = q('.bld-plan-desc');
    planDescInput?.addEventListener('input', () => {
      const pe = state.planEdit;
      if (!pe) return;
      pe.description = planDescInput.value;
      const c = q('[data-plan-count="desc"]');
      if (c) c.textContent = `${String(pe.description ?? '').length} / ${INFO_DESC_MAX}`;
    });
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
    // REQ-20260927-002：宽口径命中折叠行展开 / 收起（只读；关联提交不再有逐个选择控件，
    // 旧 [data-panel] commit 下拉 change 绑定随之移除）
    for (const el of view.querySelectorAll('[data-broad-toggle]')) {
      el.addEventListener('click', () => toggleBroadHits(el.dataset.broadToggle, el.dataset.item));
    }
    const nameInput = q('#bldNewName');
    nameInput?.addEventListener('input', () => { if (state.createPanel) state.createPanel.name = nameInput.value; });
    // REQ-20260922-006：版本号输入（x.y.z，预填建议值可改；空则服务端自动分配）
    const versionInput = q('#bldNewVersion');
    versionInput?.addEventListener('input', () => { if (state.createPanel) state.createPanel.version = versionInput.value; });
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
    // REQ-20260921-002：搜索模式 radio（highlight / filter）——切模式带词重查；树挂载在
    // 全部行绑定之后（渲染后置，容器内容替换为 gitgraph 树）
    for (const el of view.querySelectorAll('[data-log-mode]')) {
      el.addEventListener('change', () => setLogSearchMode(el.dataset.logMode));
    }
    mountTree(view);
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
    // BUG-20260928-002 唯一发布入口：详情「正式发布」步「发布」按钮直接弹二次确认
    //（openPublishConfirm，取消不发请求），确认后一键发布链路自动创建草稿并预检、启动
    //（doOneClickPublish）；原「创建并预检」前置入口（旧创建行为键）随区域
    // 收敛移除，「查看发布记录」按钮仍按 REQ-20260921-016 移除（发布记录直接展示在正式
    // 发布步，openReleaseTab 仍作为程序化激活入口保留）。
    for (const el of view.querySelectorAll('[data-rel-publish]')) {
      el.addEventListener('click', () => openPublishConfirm(el.dataset.relPublish));
    }
    q('#bldRelCancel')?.addEventListener('click', () => { if (!state.releaseConfirm?.busy) { state.releaseConfirm = null; render(); } });
    q('#bldRelGo')?.addEventListener('click', doOneClickPublish);
    q('#bldPublishWrap')?.addEventListener('click', (e) => {
      if (e.target?.id === 'bldPublishWrap' && !state.releaseConfirm?.busy) { state.releaseConfirm = null; render(); }
    });
    // REQ-20260920-003 五步流程导航 + 发布记录选择 / 动作 / 只读重试（BUG-20260915-014 迁移）
    for (const el of view.querySelectorAll('[data-step]')) {
      el.addEventListener('click', () => setStep(el.dataset.step));
    }
    for (const el of view.querySelectorAll('[data-pf-retry]')) {
      el.addEventListener('click', () => ensurePublishPlan(true));
    }
    // REQ-20260926-002 文档合并（第四步动作；幂等重试，失败可重试）
    for (const el of view.querySelectorAll('[data-docs-merge]')) {
      el.addEventListener('click', () => doDocsMerge(el.dataset.docsMerge));
    }
    // REQ-20260921-008 文档编写页按钮：刷新 / AI 总结 / 审查 / 提交；
    // REQ-20260921-012 新增 AI 翻译（默认语言全审后解锁）；整体审查绑定随阶段去除（BUG-20260926-002）
    // BUG-20260921-013 语言页签切换：激活语言记忆于 pf.docLang（重渲染保持；语言集变化后
    // 不在新集合内由渲染端回落默认语言）；键盘可达沿用既有页签口径（原生 button）
    for (const el of view.querySelectorAll('[data-doc-lang]')) {
      el.addEventListener('click', () => {
        const pf = state.pf;
        const lang = el.dataset.docLang;
        if (pf && lang) { pf.docLang = lang; render(); }
      });
    }
    q('[data-pf-refresh]')?.addEventListener('click', refreshDocsPane);
    // BUG-20260925-004 后台静默同步失败横幅的重试入口（轻量重试，不清窗格）
    q('[data-pf-sync-retry]')?.addEventListener('click', () => syncDocsPlanSilently());
    q('[data-pf-summary]')?.addEventListener('click', startSummary);
    q('[data-pf-translate]')?.addEventListener('click', startTranslation);
    q('[data-pf-review]')?.addEventListener('click', () => openReview()); // REQ-20260924-004：无参调用保持现状（防事件对象被误作跳转目标）
    q('[data-pf-commit]')?.addEventListener('click', commitDocs);
    // REQ-20260924-006 五步条新增入口：② 二次编辑（默认语言单语言弹窗）与 ③ AI 校对（直接启动）
    q('[data-pf-edit]')?.addEventListener('click', () => openSecondaryEdit());
    q('[data-pf-proofstep]')?.addEventListener('click', startProofread);
    // REQ-20260924-006 ③ 校对建议侧栏：文件切换 / 接受 / 拒绝 / 重试 / 跳二次编辑定位
    const chkSel = q('[data-chk-file]');
    chkSel?.addEventListener('change', () => {
      const pf = state.pf;
      // BUG-20260925-001：主动换文件是切列表——清锚点并从顶部开始（不沿用旧文件滚动偏移）
      if (pf && chkSel.value) { pf.chkFile = chkSel.value; pf.chkAnchor = null; pf.chkScrollReset = true; render(); }
    });
    for (const el of view.querySelectorAll('[data-chk-accept]')) {
      el.addEventListener('click', () => {
        const [file, idx] = String(el.dataset.chkAccept || '').split('|');
        acceptChkSuggestion(file, parseInt(idx, 10));
      });
    }
    for (const el of view.querySelectorAll('[data-chk-reject]')) {
      el.addEventListener('click', () => {
        const [file, idx] = String(el.dataset.chkReject || '').split('|');
        rejectChkSuggestion(file, parseInt(idx, 10));
      });
    }
    q('[data-chk-retry]')?.addEventListener('click', startProofread);
    for (const el of view.querySelectorAll('[data-chk-edit]')) {
      el.addEventListener('click', () => openSecondaryEdit({ file: el.dataset.chkEdit, line: el.dataset.chkLine }));
    }
    // REQ-20260924-006 ② 二次编辑弹窗：文件切换 / 刷新 / 编辑·预览 / 保存 / 关闭 / 未保存
    // 挂起三动作（内联保护，不用阻塞式 confirm——BUG-20260907-009 口径）；编辑框 input 即
    // 回写草稿（重渲染不丢字）；遮罩点击走关闭保护。
    const editSel = q('[data-edit-file]');
    editSel?.addEventListener('change', () => requestEditSwitch(editSel.value));
    q('[data-edit-refresh]')?.addEventListener('click', requestEditRefresh);
    q('[data-edit-retry]')?.addEventListener('click', () => { if (state.pf?.edit?.open) doEditRefresh(); });
    for (const el of view.querySelectorAll('[data-edit-mode]')) {
      el.addEventListener('click', () => {
        const pf = state.pf;
        if (!pf?.edit?.open) return;
        pf.edit.mode = el.dataset.editMode === 'preview' ? 'preview' : 'edit';
        render();
      });
    }
    q('[data-edit-save]')?.addEventListener('click', saveEditFile);
    // BUG-20260927-002：弹窗头部与底部各有一个 data-edit-close 按钮，必须循环绑定全部
    // （q 只命中 DOM 顺序第一个，曾致底部「关闭」无监听点击无响应；与 data-review-close 同口径）
    for (const el of view.querySelectorAll('[data-edit-close]')) {
      el.addEventListener('click', requestEditClose);
    }
    q('[data-edit-keep]')?.addEventListener('click', () => resolveEditPending('save'));
    q('[data-edit-discard]')?.addEventListener('click', () => resolveEditPending('discard'));
    q('[data-edit-stay]')?.addEventListener('click', () => resolveEditPending('cancel'));
    const editBox = q('.bld-edit-editor');
    if (editBox) editBox.addEventListener('input', () => { const pf = state.pf; if (pf?.edit?.open) pf.edit.content = editBox.value; });
    const editWrap = q('#bldEditWrap');
    editWrap?.addEventListener('click', (e) => {
      if (e.target?.id === 'bldEditWrap' && !state.pf?.edit?.busy) requestEditClose();
    });
    // BUG-20260925-005 二次编辑预览富媒体增强：与审查对话框（BUG-20260923-002）逐字同口径
    // ——仓库相对路径图片改写 /api/fs/raw 白名单端点（project 绑定当前项目，越权 / 超限 /
    // 不存在由端点拒绝 → 前端占位提示）+ mermaid 渲染 / plantuml 降级（md-rich 共享层，
    // 可选链调用：模块或图表库缺失均静默降级不白屏；render 重建后随 bindCommon 重跑）。
    if (editWrap) {
      for (const el of editWrap.querySelectorAll('.bld-review-preview.md')) {
        window.ATBMdRich?.enhance(el, { imgBase: state.project ? (raw) => `/api/fs/raw?path=${encodeURIComponent(raw)}&project=${encodeURIComponent(state.project)}` : null });
      }
    }
    // REQ-20260921-010 语言集输入框：输入草稿回写（重渲染不丢字）；回车触发失焦统一走应用；
    // 失焦应用（校验镜像 + 保存 + 联动刷新）
    const langsBox = q('[data-pf-langs]');
    if (langsBox) {
      langsBox.addEventListener('input', () => { const pf = state.pf; if (pf) pf.langsInput = langsBox.value; });
      langsBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); langsBox.blur(); } });
      langsBox.addEventListener('blur', () => { const pf = state.pf; if (pf) applyDocLangs(langsBox.value); });
    }
    // REQ-20260922-003 自定义文档：添加入口 / 内联行（输入草稿回写不重渲染防丢焦点、
    // 回车提交、打开时聚焦一次）/ 移除入口（运行中禁用由渲染端 + 守卫双保险）
    q('[data-doc-add-open]')?.addEventListener('click', openAddDoc);
    q('[data-doc-add-cancel]')?.addEventListener('click', closeAddDoc);
    q('[data-doc-add-confirm]')?.addEventListener('click', submitAddDoc);
    const addBox = q('[data-doc-add-input]');
    if (addBox) {
      addBox.addEventListener('input', () => { const pf = state.pf; if (pf?.addDoc) pf.addDoc.input = addBox.value; });
      addBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitAddDoc(); } });
      if (state.pf?.addDoc?.focus) { state.pf.addDoc.focus = false; addBox.focus(); }
    }
    for (const el of view.querySelectorAll('[data-doc-rm]')) {
      el.addEventListener('click', () => removeCustomDocFile(el.dataset.docRm));
    }
    q('[data-pf-copy-prompt]')?.addEventListener('click', async () => {
      const box = q('.bld-docs-prompt');
      const ok = await copyText(box?.value || '');
      if (ok) toast('✓ AI 总结提示词已复制：交给 AI Agent 逐文件执行，进度在本页与任务模块自动刷新');
      else toast('剪贴板不可用：请在提示词文本框中全选（⌘A）并手动复制', true);
    });
    q('[data-pf-copy-tprompt]')?.addEventListener('click', async () => {
      const box = q('.bld-docs-prompt');
      const ok = await copyText(box?.value || '');
      if (ok) toast('✓ AI 翻译提示词已复制：交给 AI Agent 以已审核默认语言文档为基准逐文件翻译，进度在本页与任务模块自动刷新');
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
    // REQ-20260921-008 审查对话框交互：类型页签 / 每栏通过审核 / 关闭（含遮罩点击）。
    // BUG-20260925-006：编辑·预览切换与保存控件随审查只读化移除，编辑走「② 二次编辑」弹窗。
    for (const el of view.querySelectorAll('[data-review-tab]')) {
      el.addEventListener('click', () => switchReviewTab(el.dataset.reviewTab));
    }
    for (const el of view.querySelectorAll('[data-review-approve]')) {
      el.addEventListener('click', () => approveReviewFile(el.dataset.reviewApprove));
    }
    for (const el of view.querySelectorAll('[data-review-close]')) {
      el.addEventListener('click', closeReview);
    }
    const reviewWrap = q('#bldReviewWrap');
    reviewWrap?.addEventListener('click', (e) => {
      if (e.target?.id === 'bldReviewWrap' && !state.pf?.review?.busy) closeReview();
    });
    if (reviewWrap) bindReviewSyncScroll(reviewWrap); // 各栏同步滚动（恒预览态，BUG-20260925-006）
    // BUG-20260923-002 预览富媒体增强：仓库相对路径图片改写到 /api/fs/raw 白名单端点
    //（发布文档位于被管理项目根，与端点的项目根解析一致；project 参数绑定当前项目，
    // 越权 / 超限 / 不存在由端点拒绝 → 前端占位提示）+ mermaid 渲染 / plantuml 降级（md-rich 共享层）。
    if (reviewWrap) {
      for (const el of reviewWrap.querySelectorAll('.bld-review-preview.md')) {
        window.ATBMdRich?.enhance(el, { imgBase: state.project ? (raw) => `/api/fs/raw?path=${encodeURIComponent(raw)}&project=${encodeURIComponent(state.project)}` : null });
      }
    }
    // REQ-20260922-005 选择开源协议弹框：行选中 / 写入并继续 / 暂不选择 / 关闭 / 重试（Esc + 遮罩）
    for (const el of view.querySelectorAll('[data-license-row]')) {
      el.addEventListener('click', () => {
        const pf = state.pf;
        if (!pf?.license?.open || pf.license.busy) return;
        pf.license.sel = el.dataset.licenseRow;
        render();
      });
    }
    q('[data-license-confirm]')?.addEventListener('click', confirmLicensePick);
    q('[data-license-skip]')?.addEventListener('click', skipLicensePick);
    q('[data-license-close]')?.addEventListener('click', closeLicensePicker);
    q('[data-license-retry]')?.addEventListener('click', () => {
      const pf = state.pf;
      if (!pf?.license?.open) return;
      pf.license.loading = true;
      pf.license.error = null;
      render();
      loadDocLicenses();
    });
    const licenseWrap = q('#bldLicenseWrap');
    licenseWrap?.addEventListener('click', (e) => {
      if (e.target?.id === 'bldLicenseWrap' && !state.pf?.license?.busy) closeLicensePicker();
    });
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
    if (state.pf?.license?.open) { closeLicensePicker(); return; } // REQ-20260922-005：选择开源协议弹框 Esc 关闭（不启动总结）
    if (state.pf?.edit?.open) { // REQ-20260924-006：二次编辑弹窗 Esc——挂起态先撤提示，未保存走关闭保护
      if (state.pf.edit.pending) { state.pf.edit.pending = null; render(); }
      else requestEditClose();
      return;
    }
    if (state.pf?.review?.open) { closeReview(); return; } // REQ-20260921-008：审查对话框 Esc 关闭
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
    // REQ-20260921-002：提交树（vendored @gitgraph/js）——数据适配纯函数 / 挂载入口 /
    // 搜索模式切换接缝（测试与交互）
    treeData, mountTree, setLogSearchMode,
    // REQ-20260920-001：节点选择行为接缝（测试与交互）
    selectLogRow,
    // 纯函数接缝（测试与面板复用）
    doneCandidates, selectableCandidates, occupiedItemIds, parseAnswer, buildPrompt, logPagerHtml,
    // BUG-20260928-001：状态标签 / 阶段文案纯函数接缝（三处标签与卡片 meta 共用口径）
    statusChipFor, versionChip, stageOf,
    // REQ-20260927-002：整组自动关联纯函数与宽口径折叠行接缝（测试与交互共用）
    autoAssociationOf, broadHitsOf, pickedCommitCount, toggleBroadHits,
    // REQ-20260921-014：概况页签显式编辑（行为接缝 + 客户端校验纯函数，测试与交互共用）
    openPlanEdit, cancelPlanEdit, submitPlanEdit, validateVersionInfo,
    // REQ-20260915-003：关联条目联合列表搜索 / 分页纯函数与行为接缝（测试与交互）
    filterVersionItems, paginateItems, submitItemsSearch, clearItemsSearch, gotoItemsPage,
    // 行为接缝（BUG-20260913-004：openAnswerModal / openMergeConfirm 支持 verId 定位卡片版本；
    // REQ-20260913-004：openDeleteConfirm / doDelete 删除确认与执行；
    // BUG-20260920-006：doMerge 守卫分支（执行中 / 版本不存在）补反馈测试接缝）
    openAnswerModal, openMergeConfirm, openDeleteConfirm, doDelete, doMerge,
    // REQ-20260926-002：文档合并动作接缝（测试与交互共用；一键加入已随流程简化移除）
    doDocsMerge,
    // REQ-20260915-003：切换选中版本（清空关联列表搜索并回第一页）
    selectVersion,
    // REQ-20260915-002 产品发布入口行为接缝；BUG-20260928-002 收敛为唯一「发布」入口：
    // 二次确认（openPublishConfirm）+ 一键发布链路（doOneClickPublish，自动创建草稿并预检再启动）
    openPublishConfirm, doOneClickPublish,
    // BUG-20260915-014：详情「正式发布」步与发布记录接缝（测试与就地查看 / 动作交互）；
    // REQ-20260920-003 更名 setDetailTab → setStep（五步流程）
    setStep, openReleaseTab, selectReleaseRun, relAction,
    openRelPlan, confirmRelStart, refreshReleasePane, openPublishDirectory,
    // REQ-20260920-003：发布流程接缝（推送 / 官网检测）；
    // REQ-20260921-008：文档编写页流水线接缝（刷新 / AI 总结 / 审查对话框 / 提交）；
    // REQ-20260921-012：AI 翻译接缝（BUG-20260926-002：整体审查完结接缝随阶段去除）
    ensurePublishPlan, refreshDocsPane, startSummary, startTranslation, openReview, closeReview,
    // REQ-20260924-006：② 二次编辑弹窗（打开 / 未保存保护 / 保存）与 ③ 建议接受 / 拒绝、
    // 校对建议解析与应用纯函数（测试与交互共用）
    openSecondaryEdit, requestEditSwitch, requestEditRefresh, requestEditClose, resolveEditPending,
    saveEditFile, acceptChkSuggestion, rejectChkSuggestion,
    parseChkSuggestion, classifyChkIssue, applyChkSuggestion, chkPendingCount,
    // BUG-20260925-002：决断播种与已应用识别纯函数（测试与交互共用）
    seedChkDecisions, alreadyAppliedChk,
    // REQ-20260922-005：选择开源协议弹框（行为接缝，测试与交互共用）
    confirmLicensePick, skipLicensePick, closeLicensePicker,
    loadReviewPair, approveReviewFile, commitDocs, pushMain, siteScan, summaryPoll,
    getCandidates: () => state.createPanel?.candidates || [],
    searchStats,
  };
})();

window.ATBBuild = ATBBuild;
