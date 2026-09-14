#!/usr/bin/env node
// REQ-20260907-003 需求完善 —— 前端静态契约测试（R12）
// REQ-20260908-020 起改造：任务模块子面板为「批量完善 / 批量开发」；完善面向已接受单；
// 面板含启动区（执行 Agent）/ 当前处理详情 / 操作（暂停、终止）/ 执行记录；看板已接受单三态徽标。
// 用法：node scripts/tests/refine-ui.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const web = path.join(pluginRoot, 'scripts', 'web');
const js = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(web, 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('R12-1 入口（REQ-20260908-027 起）：列表头批量右组不设「批量完善」按钮（与勾选无关）；入口收敛为完善徽标与任务模块（REQ-20260909-002 起操作条并入列表头）', () => {
  const group = html.match(/<div id="selGroup"[\s\S]*?<\/div>/);
  assert.ok(group, '应存在列表头批量右组 #selGroup');
  assert.doesNotMatch(group[0], /id="refineGo"/, '批量右组不得再含 #refineGo 按钮（REQ-20260908-020 面向已接受未完善单，与勾选无关）');
  assert.doesNotMatch(js, /\$\('#refineGo'\)/, 'app.js 应移除 refineGo 绑定');
  // 入口仍在：已接受行 / 详情页完善徽标点击跳任务模块 refine 面板（gotoRuns('refine')）
  assert.match(js, /data-goto-refine/, '完善徽标入口保留');
  assert.match(js, /gotoRuns\('refine'\)/, '点击进入批量完善面板');
});

t('R12-2 任务模块（REQ-20260908-020）：子面板为「批量完善 / 批量开发」，refine 面板随轮询刷新', () => {
  assert.match(js, /data-bmode="refine"/, '模式 tab 应含 refine（批量完善）');
  assert.match(js, /data-bmode="develop"/, '模式 tab 应含 develop（批量开发）');
  assert.doesNotMatch(js, /data-bmode="zcode"/, '旧 Zcode 批次 tab 不复存在');
  assert.doesNotMatch(js, /data-bmode="codex"/, 'Codex 后台自动派发 tab 入口隐藏');
  const tabs = js.match(/<nav class="tabs batch-modes">[\s\S]*?<\/nav>/);
  assert.ok(tabs, '应有子面板 tabs');
  assert.match(tabs[0], /批量完善/);
  assert.match(tabs[0], /批量开发/);
  const refresh = js.match(/async function refreshBatch\(\)[\s\S]*?\n\}/);
  assert.ok(refresh, '应存在 refreshBatch');
  assert.match(refresh[0], /mode === 'refine'/, 'refreshBatch 应分发 refine 模式');
  assert.match(js, /async function refreshRefine\(\)/, '应有 refreshRefine 数据拉取');
  assert.match(js, /\/api\/refine\/current/, '应拉取 current 接口');
  assert.match(js, /\/api\/refine\/candidates/, '应拉取 candidates 接口');
});

t('R12-3 启动区：候选=已接受未完善 + 缺失原因；启动按钮（REQ-20260909-011：无执行 Agent 选择；REQ-20260910-027：开发人员输入移除）；创建调用接口', () => {
  const panel = js.match(/function renderRefinePanel\(\)[\s\S]*?\n\}/);
  assert.ok(panel, '应存在 renderRefinePanel');
  const src = panel[0];
  // REQ-20260908-026：候选清单收敛进共用 pendingQueueHtml（最近 2 条），缺失原因随队列行渲染
  const queue = js.match(/function pendingQueueHtml[\s\S]*?\n\}/);
  assert.ok(queue, '应存在 pendingQueueHtml');
  assert.match(queue[0], /refineReasonsHtml|reasons\.map/, '候选应渲染缺失原因');
  assert.match(src, /已接受未完善/, '候选计数标注已接受未完善口径');
  assert.match(src, /每轮实时读取/, '标注实时读取口径');
  // REQ-20260909-011：启动区去 Agent 化——无执行 Agent 选择控件与设置过滤
  assert.doesNotMatch(src, /id="refineMode"/, '不得出现执行 Agent 选择控件');
  assert.doesNotMatch(src, /visibleTaskAgents/, '不再按设置「批量任务」过滤选项');
  assert.doesNotMatch(src, /选择执行 Agent/, '无空占位校验文案');
  // REQ-20260910-027：开发人员输入移除
  assert.doesNotMatch(src, /id="refineDev"/, '不得出现开发人员输入');
  assert.doesNotMatch(src, /开发人员/, '启动区不再出现开发人员');
  assert.match(src, /id="refineCreate"/, '启动按钮');
  assert.match(js, /\/api\/refine\/create/, '创建应调用 /api/refine/create');
  assert.match(js, /copyDispatchText\(res\.prompt\)/, '创建成功应复制主调度提示词');
});

t('R12-4 运行面板：当前处理详情（单号+标题/子代理会话/开始时间/最近回执/计数）、终止、暂停、提示词块、执行记录', () => {
  const panel = js.match(/function renderRefinePanel\(\)[\s\S]*?\n\}/)[0];
  assert.match(panel, /当前条目/, '当前处理详情区');
  assert.match(panel, /等待领取下一项/, '无进行中项显示等待领取');
  assert.match(panel, /子代理会话/, '子代理会话标识');
  assert.match(panel, /开始时间/, '开始时间');
  assert.match(panel, /最近回执/, '最近回执摘要');
  assert.match(panel, /counts\.done \?\? 0/, '展示完成计数');
  assert.match(panel, /data-goto-item/, '记录条目可跳转文档');
  // REQ-20260908-026：记录渲染改由共用 runAttemptsHtml（四列表格、最近 2 次）承接
  assert.match(js, /function runAttemptsHtml\(/, '应存在记录渲染函数');
  const recs = js.match(/function runAttemptsHtml\([\s\S]*?\n\}/)[0];
  assert.match(recs, /summary/, '记录展示摘要');
  assert.match(recs, /reason/, '记录展示失败原因');
  assert.match(panel, /id="refinePause"/, '暂停按钮');
  assert.match(panel, /id="refineAbort"/, '终止按钮');
  assert.match(panel, /id="refinePrompt"/, '主调度提示词块');
  assert.match(js, /\/api\/refine\/pause/, '暂停调用接口');
  assert.match(js, /\/api\/refine\/abort/, '终止调用接口');
  assert.match(js, /function abortRefineTask[\s\S]*?uiConfirm/, '终止须二次确认（uiConfirm）');
  assert.match(js, /REFINE_RESULT_LABEL/, '结果中文标签');
});

t('R12-5 样式与多选联动：候选/记录/徽标样式存在；选择工具条不再同步 refine 入口（REQ-20260908-027）', () => {
  assert.match(css, /\.refine-cands\b/, '候选清单样式');
  assert.match(css, /\.refine-cand\b/, '候选项样式');
  assert.match(css, /\.refine-badge\b/, '完善三态徽标样式');
  assert.match(css, /\.rf-refining\b/, '完善中徽标样式（含动效）');
  assert.match(css, /\.rf-refined\b/, '已完善徽标样式');
  const sync = js.match(/function syncAcceptance\(\)[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(sync, /refineGo/, '选择同步不再维护 refineGo 入口（按钮已移出工具条）');
});

t('R12-6（REQ-20260908-020）看板徽标：已接受单渲染三态徽标，点击跳任务模块批量完善面板；完善中禁驳', () => {
  assert.match(js, /REFINE_BADGE/, '应有三态徽标定义');
  assert.match(js, /未完善/, '未完善文案');
  assert.match(js, /完善中/, '完善中文案');
  assert.match(js, /已完善/, '已完善文案');
  assert.match(js, /refineBadgeHtml\(it\)/, '列表行渲染徽标');
  assert.match(js, /data-goto-refine/, '徽标可点击跳转');
  assert.match(js, /gotoRuns\('refine'\)/, '点击进入批量完善面板');
  // 详情页驳回按钮完善中禁用（悬停提示）
  const actions = js.match(/function drawerActionsButtonHtml\([\s\S]*?\n\}/)[0];
  assert.match(actions, /完善中，待本轮批量完善结束后再驳回/, '完善中驳回入口禁用并提示');
});

t('R12-7（REQ-20260909-011）设置模块「批量任务」分区精简：通用说明 + 完善流转开关 + 保存；无按 Agent 表格', () => {
  assert.match(js, /function taskSettingsHtml\(/, '应有批量任务设置渲染函数');
  const fn = js.match(/function taskSettingsHtml[\s\S]*?\n\}/)[0];
  assert.match(fn, /id="tsAutoPlan"/, '完善完成后自动转入计划开关保留');
  assert.match(fn, /子代理模式/, '说明含子代理模式口径');
  assert.match(fn, /跟随主调度会话/, '说明含默认跟随语义');
  assert.match(js, /\/api\/tasks\/settings/, '设置读写调用 /api/tasks/settings');
  assert.match(js, /保存批量任务设置/, '保存按钮');
  // 按 Agent 配置已移除：无表格 / 隐藏复选框 / 来源下拉 / 全部隐藏提示
  assert.doesNotMatch(fn, /<table/, '无表格');
  for (const id of ['tsHidden-', 'tsSource-', 'tsModel-', 'tsLevel-', 'tsEmpty-']) {
    assert.ok(!fn.includes(id), `不得出现 ${id} 控件`);
  }
});

t('R12-8（BUG-20260908-014）终止收尾后面板显示「启动新任务」入口；无候选时禁用不报错', () => {
  // 提取真实 renderRefinePanel 源码在 vm 中执行（与深测夹具 D06 同思路），
  // 终止收尾态 = finished + aborted + remaining=0（abortRefineBatch 落 skipped 出局账后的口径）。
  const panel = js.match(/function renderRefinePanel\(\)[\s\S]*?\n\}/)[0];
  const render = (data) => {
    const ctx = {
      state: { refine: { data } },
      taskAgentModeText: () => '子代理模式',
      esc: String, fmtTime: String, shortOwner: String, batchStatusLabel: String,
      taskStatsLine: () => '', fmtElapsed: () => '00:00',
      pendingQueueHtml: () => '', runAttemptsHtml: () => '',
      // REQ-20260909-008：运行面板改由共用 taskPaneShell 组织二级页签（此处桩为拼合四分区内容）
      taskPaneShell: (scope, store, panes) => Object.values(panes).join(''),
      // REQ-20260910-002：提示词分区工作区工具行改由共用 workspaceOpenRowHtml 渲染（此处桩掉）
      workspaceOpenRowHtml: () => '',
      localStorage: { getItem: () => '' },
    };
    vm.createContext(ctx);
    return vm.runInContext(`${panel}\nrenderRefinePanel()`, ctx);
  };
  const batch = (extra = {}) => ({
    batchId: 'RFB-20990101-001', mode: 'subagent', agent: 'subagent', status: 'finished',
    abortRequested: true, aborted: true, pauseRequested: false, developer: null,
    createdAt: '2026-01-01T00:00:00.000Z', lastActivityAt: '2026-01-01T00:00:00.000Z',
    candidates: [], prompt: '调度提示词', ...extra,
  });
  const counts = { total: 1, done: 0, failed: 0, skipped: 1, interrupted: 0, remaining: 0 };
  const cands = [{ id: 'REQ-20990101-001', type: 'requirement', title: 't', reasons: [] }];
  // 终止收尾 + 有候选：出现 refineNext 且可点击；不误报「已处理完毕」ok notice
  const abortedHtml = render({ batch: batch(), counts, records: [], candidates: cands });
  assert.match(abortedHtml, /id="refineNext"/, '终止收尾面板应含「启动新任务」按钮');
  assert.doesNotMatch(abortedHtml, /id="refineNext"[^>]*\sdisabled/, '有候选时「启动新任务」不应禁用');
  assert.match(abortedHtml, /任务已人工终止/, '终止态保留已终止提示');
  assert.doesNotMatch(abortedHtml, /本批完善范围已处理完毕/, '终止态不得误报「已处理完毕」');
  // 终止收尾 + 无候选：refineNext 渲染为禁用并说明暂无候选（不靠接口报错兜底）
  const noCandHtml = render({ batch: batch(), counts, records: [], candidates: [] });
  assert.match(noCandHtml, /id="refineNext"[^>]*\sdisabled/, '无候选时「启动新任务」应禁用');
  assert.match(noCandHtml, /暂无可完善候选/, '禁用时应说明暂无可完善候选');
  // 正常完成态（非终止）不回归：refineNext 仍可点击
  const doneHtml = render({ batch: batch({ abortRequested: false, aborted: false }), counts, records: [], candidates: cands });
  assert.match(doneHtml, /id="refineNext"/, '正常完成态仍应含「启动新任务」');
  assert.doesNotMatch(doneHtml, /id="refineNext"[^>]*\sdisabled/, '正常完成态有候选时不应禁用');
  // 未收尾批次（运行中）不显示 refineNext，行为不变
  const runningHtml = render({ batch: batch({ status: 'running', abortRequested: false, aborted: false }), counts: { ...counts, remaining: 1, skipped: 0 }, records: [], candidates: cands });
  assert.doesNotMatch(runningHtml, /id="refineNext"/, '运行中不得出现「启动新任务」');
});

t('R12-9（BUG-20260908-015）终态批次不再提供「暂停后续」入口：终止/正常收尾面板无 refinePause；运行中面板保留', () => {
  const panel = js.match(/function renderRefinePanel\(\)[\s\S]*?\n\}/)[0];
  const render = (data) => {
    const ctx = {
      state: { refine: { data } },
      taskAgentModeText: () => '子代理模式',
      esc: String, fmtTime: String, shortOwner: String, batchStatusLabel: String,
      taskStatsLine: () => '', fmtElapsed: () => '00:00',
      pendingQueueHtml: () => '', runAttemptsHtml: () => '',
      // REQ-20260909-008：运行面板改由共用 taskPaneShell 组织二级页签（此处桩为拼合四分区内容）
      taskPaneShell: (scope, store, panes) => Object.values(panes).join(''),
      // REQ-20260910-002：提示词分区工作区工具行改由共用 workspaceOpenRowHtml 渲染（此处桩掉）
      workspaceOpenRowHtml: () => '',
      localStorage: { getItem: () => '' },
    };
    vm.createContext(ctx);
    return vm.runInContext(`${panel}\nrenderRefinePanel()`, ctx);
  };
  const batch = (extra = {}) => ({
    batchId: 'RFB-20990101-001', mode: 'zcode', agent: 'zcode', status: 'running',
    abortRequested: false, aborted: false, pauseRequested: false, developer: null,
    createdAt: '2026-01-01T00:00:00.000Z', lastActivityAt: '2026-01-01T00:00:00.000Z',
    candidates: [], prompt: '调度提示词', ...extra,
  });
  const doneCounts = { total: 1, done: 0, failed: 0, skipped: 1, interrupted: 0, remaining: 0 };
  // 终止收尾态：不出现可点的「暂停后续」按钮（与「终止任务」隐藏口径一致）
  const abortedHtml = render({ batch: batch({ status: 'finished', abortRequested: true, aborted: true }), counts: doneCounts, records: [], candidates: [] });
  assert.doesNotMatch(abortedHtml, /id="refinePause"/, '终止收尾面板不得出现暂停后续按钮');
  assert.doesNotMatch(abortedHtml, /已请求暂停后续领取/, '不得误显示已暂停提示');
  assert.match(abortedHtml, /id="refineNext"/, '终止收尾仍提供启动新任务入口');
  // 正常完成态（非终止）：同样不出现暂停入口
  const doneHtml = render({ batch: batch({ status: 'finished' }), counts: doneCounts, records: [], candidates: [] });
  assert.doesNotMatch(doneHtml, /id="refinePause"/, '正常完成面板不得出现暂停后续按钮');
  // 运行中 / 已暂停：暂停入口保留（行为不回归）
  const runningHtml = render({ batch: batch(), counts: { ...doneCounts, remaining: 1, skipped: 0 }, records: [], candidates: [] });
  assert.match(runningHtml, /id="refinePause"/, '运行中面板保留暂停后续按钮');
  const pausedHtml = render({ batch: batch({ status: 'paused', pauseRequested: true }), counts: { ...doneCounts, remaining: 1, skipped: 0 }, records: [], candidates: [] });
  assert.match(pausedHtml, /id="refinePause"/, '已暂停面板保留恢复后续领取按钮');
  assert.match(pausedHtml, /恢复后续领取/, '按钮文案为恢复后续领取');
});

t('R12-10（REQ-20260909-011）收尾「启动新任务」与创建面板去 Agent 化：无执行 Agent 选择；无候选禁用；创建不读/不提交 mode', () => {
  // 提取真实 renderRefinePanel 源码在 vm 中执行（与 R12-8 同思路）。
  // 已结束非终止批次 + 已终止批次（BUG-20260908-014 入口）均直接提供启动入口。
  const panel = js.match(/function renderRefinePanel\(\)[\s\S]*?\n\}/)[0];
  const render = (data) => {
    const ctx = {
      state: { refine: { data } },
      taskAgentModeText: () => '子代理模式',
      esc: String, fmtTime: String, shortOwner: String, batchStatusLabel: String,
      refineReasonsHtml: () => '', taskStatsLine: () => '', fmtElapsed: () => '00:00',
      pendingQueueHtml: () => '', runAttemptsHtml: () => '',
      // REQ-20260909-008：运行面板改由共用 taskPaneShell 组织二级页签（此处桩为拼合四分区内容）
      taskPaneShell: (scope, store, panes) => Object.values(panes).join(''),
      // REQ-20260910-002：提示词分区工作区工具行改由共用 workspaceOpenRowHtml 渲染（此处桩掉）
      workspaceOpenRowHtml: () => '',
      localStorage: { getItem: () => '' },
    };
    vm.createContext(ctx);
    return vm.runInContext(`${panel}\nrenderRefinePanel()`, ctx);
  };
  const batch = (extra = {}) => ({
    batchId: 'RFB-20990101-001', mode: 'subagent', agent: 'subagent', status: 'finished',
    abortRequested: false, aborted: false, pauseRequested: false, developer: null,
    createdAt: '2026-01-01T00:00:00.000Z', lastActivityAt: '2026-01-01T00:00:00.000Z',
    candidates: [], prompt: '调度提示词', ...extra,
  });
  const counts = { total: 1, done: 0, failed: 0, skipped: 1, interrupted: 0, remaining: 0 };
  const cands = [{ id: 'REQ-20990101-001', type: 'requirement', title: 't', reasons: [] }];
  // 正常收尾（非终止）+ 有候选：有候选即可启动，无 Agent 选择控件
  const doneHtml = render({ batch: batch(), counts, records: [], candidates: cands });
  assert.match(doneHtml, /id="refineNext"/, '收尾面板应含「启动新任务」按钮');
  assert.doesNotMatch(doneHtml, /id="refineNextMode"/, 'REQ-20260909-011：收尾面板不得再内嵌执行 Agent 选择');
  assert.doesNotMatch(doneHtml, /选择执行 Agent/, '无空占位「选择执行 Agent…」文案');
  assert.doesNotMatch(doneHtml, /id="refineNext"[^>]*\sdisabled/, '有候选时「启动新任务」可用');
  // 终止收尾（BUG-20260908-014 入口路径）同样直接可启动
  const abortedHtml = render({ batch: batch({ abortRequested: true, aborted: true }), counts, records: [], candidates: cands });
  assert.doesNotMatch(abortedHtml, /id="refineNextMode"/, '终止收尾面板亦无执行 Agent 选择');
  assert.doesNotMatch(abortedHtml, /已隐藏全部执行 Agent/, '无「设置中已隐藏全部执行 Agent」禁用提示');
  // 无候选仍禁用并说明（R12-8 口径不回归）
  const noCandHtml = render({ batch: batch(), counts, records: [], candidates: [] });
  assert.match(noCandHtml, /id="refineNext"[^>]*\sdisabled/, '无候选时仍应禁用');
  assert.match(noCandHtml, /暂无可完善候选/, '禁用时应说明暂无可完善候选');
  // 创建流程：不再读取面板 Agent 选择、请求体不带 mode
  const fnSrc = js.match(/async function createRefineBatchAndCopy\(\)[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(fnSrc, /refineMode|refineNextMode/, '创建流程不再读取执行 Agent 选择');
  assert.doesNotMatch(fnSrc, /请先选择执行 Agent/, '无 Agent 守卫提示');
  assert.doesNotMatch(fnSrc, /body: JSON\.stringify\(\{[^}]*mode/, '请求体不得携带 mode');
  // 创建面板（无批次分支）同样无 Agent 选择
  const createHtml = render({ batch: null, candidates: cands });
  assert.doesNotMatch(createHtml, /选择执行 Agent…/, '创建面板无空占位');
  assert.doesNotMatch(createHtml, /id="refineCreate"[^>]*disabled/, '创建面板有候选时启动可点');
});

// REQ-20260908-026：执行记录改为「最近 2 次执行尝试」四列表格（BUG-20260908-018 的分页交互随
// 展示上限移除——完整账本与计数不受影响，2 条仅为界面展示限制）
t('R12-11（REQ-20260908-026）执行记录最近两条：四列表格只显示最近 2 次尝试并标注「最近 X 条 / 共 N 条」；无分页按钮', () => {
  const recs = js.match(/function runAttemptsHtml\([^)]*\)[\s\S]*?\n\}/);
  assert.ok(recs, '应存在 runAttemptsHtml 渲染函数');
  const render = (records, total, kind = 'refine') => {
    const ctx = {
      esc: String, fmtTime: String, shortOwner: String, itemKindLabel: () => '需求',
      ATTEMPT_RESULT_LABEL: { done: '已处理', failed: '异常' },
    };
    vm.createContext(ctx);
    return vm.runInContext(`${recs[0]}\nrunAttemptsHtml(${JSON.stringify(records)}, ${total}, '${kind}')`, ctx);
  };
  const mk = (n, result = 'done') => Array.from({ length: n }, (_, i) => ({ runId: `RUN-${i}`, itemId: `REQ-20990101-00${i}`, result, owner: 'w', at: '2026-01-01T00:00:00.000Z', summary: 's', attempt: i + 1 }));
  // 超过 2 条：只展示最近 2 次（records 最新在前），总数不截断
  const three = render(mk(3), 3);
  assert.match(three, /最近 2 条 \/ 共 3 条/, '标注最近 2 条 / 共 3 条');
  assert.doesNotMatch(three, /RUN-2/, '最早一次不展示（仅最近 2 次）');
  // 无分页按钮与全量入口（2 条仅为展示限制）
  assert.doesNotMatch(three, /id="refineMoreRecords"|id="batchMoreRecords"/, '不得渲染分页按钮');
  // ≤2 条全部展示；0 条空态
  const two = render(mk(2), 2);
  assert.match(two, /最近 2 条 \/ 共 2 条/, '2 条标注');
  assert.match(render(mk(1), 1), /最近 1 条 \/ 共 1 条/, '1 条标注');
  assert.match(render([], 0), /暂无执行记录/, '无记录空态');
  // 服务端 recordsTotal 透传（真实账面计数）
  assert.match(js, /recordsTotal/, '前端消费 recordsTotal');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
