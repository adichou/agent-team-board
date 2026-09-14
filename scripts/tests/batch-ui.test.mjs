#!/usr/bin/env node
// REQ-20260906-002 Zcode 批量实施 —— 前端静态契约测试
// 覆盖：Z06 待启动/执行中区分、重复制不建新批次；Z16 入口/抽屉/依赖设置的静态结构
// 用法：node scripts/tests/batch-ui.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('U1 批量开发入口唯一（BUG-20260909-006 移除列表勾选进入）：顶栏与列表头均无按钮，仅任务模块', () => {
  assert.ok(!/id="btnBatch"/.test(html), '顶栏不应再有批量实施按钮');
  assert.ok(!html.includes('implGo'), '列表头「进入批量开发」按钮应随 BUG-20260909-006 移除');
  assert.ok(!js.includes('implGo'), 'app.js 不得残留 #implGo 引用');
  assert.match(html, /id="selGroup"/, '批量右组随当前档勾选出现（已计划档仅「移出计划」）');
  assert.match(html, /data-view="runs"[^>]*>任务</, '批量实施页面化为任务模块');
});

t('U2 任务面板骨架：页面化容器，无独立遮罩（REQ-20260907-004）', () => {
  assert.doesNotMatch(html, /id="batchMask"/, '页面化后不得再用抽屉遮罩');
  assert.match(html, /id="batchDrawer"/, '应有批量面板容器');
  assert.match(html, /id="runsView"/, '批量面板应位于任务视图容器内');
});

t('U3 任务面板宽度：居中限宽，窄屏铺满（REQ-20260907-004 页面化）', () => {
  const m = css.match(/\.batch-drawer\s*\{[^}]*\}/);
  assert.ok(m, '应有 .batch-drawer 样式');
  assert.match(m[0], /max-width:\s*980px/, '面板最大宽度 980px 居中限宽');
  assert.match(m[0], /margin:\s*0 auto/, '面板应居中');
  assert.match(css, /@media[^{]*\(max-width:\s*720px\)[^{]*\{[\s\S]{0,800}?\.batch-drawer/, '720px 以下有窄屏适配');
});

t('U4 顶栏换行：窄屏不遮挡项目名', () => {
  assert.match(css, /\.top-actions\s*\{[^}]*flex-wrap:\s*wrap/, 'top-actions 应允许换行');
});

t('U5 模式入口：Zcode 批次与 Codex 自动派发并列；Codex 页由 REQ-20260906-003 提供独立开关（已实施）', () => {
  assert.match(js, /Codex 自动派发/, '应有 Codex 模式入口文案');
  const codexPanel = js.match(/function renderCodexPanel[\s\S]{0,900}/) || js.match(/codex[\s\S]{0,60}自动派发[\s\S]{0,600}/);
  assert.ok(codexPanel, '应有 Codex 面板渲染');
  assert.match(codexPanel[0], /REQ-20260906-003/, 'Codex 面板应关联其需求编号');
  assert.ok(!/创建批次并复制提示词/.test(codexPanel[0]), 'Codex 面板不得混入 Zcode 批次创建按钮');
});

t('U6 创建与状态：候选/受阻计数、无上限输入（REQ-20260908-019）、启动并复制提示词（REQ-20260908-026 文案「启动」）', () => {
  assert.match(js, /\/api\/batch\/create/, '应调用创建接口');
  assert.match(js, /id="devStart"[^>]*>启动</, '启动区应有「启动」按钮');
  assert.match(js, /受依赖阻塞/, '应显示受阻计数');
  assert.ok(!js.includes('batchLimit'), '上限输入框应随上限设置移除');
  assert.ok(!/上限 \$\{b\.limit\}/.test(js), '运行视图不得再回显批次上限');
  for (const s of ['待启动', '执行中']) assert.ok(js.includes(s), `应有「${s}」状态`);
  assert.match(js, /暂无已计划候选/, '空态文案（REQ-20260908-010 已计划口径）');
});

t('U7 待启动/执行中区分：有效运行登记后才显示执行中', () => {
  const f = js.match(/function batchStatusLabel[\s\S]{0,500}/);
  assert.ok(f, '应有批次状态映射');
  assert.match(f[0], /prepared[\s\S]{0,200}待启动/, 'prepared → 待启动');
  assert.match(f[0], /running[\s\S]{0,200}执行中/, 'running → 执行中');
});

t('U8 复制失败恢复：重新复制同一批次，不产生新批次', () => {
  assert.match(js, /重新复制/, '应有重新复制按钮');
  assert.match(js, /\/api\/batch\/prompt/, '重复制应走 prompt 接口而非再 create');
});

t('U9 中部信息与操作区：暂停后续领取/续接提示词/本轮处理记录（REQ-20260908-026 最近两条口径）', () => {
  assert.match(js, /\/api\/batch\/pause/, '应调用暂停接口');
  assert.match(js, /暂停后续领取/, '应有「暂停后续领取」按钮');
  assert.match(js, /复制续接提示词/, '应有续接提示词按钮');
  assert.match(js, /本轮处理记录/, '应有本轮处理记录区（最近 2 次）');
  assert.match(js, /runAttemptsHtml/, '记录渲染走共用四列表格');
  assert.match(js, /执行状态待核对/, '失联应显示待核对');
});

t('U10 Zcode 工作区辅助入口：不声称自动新建会话', () => {
  assert.match(js, /zcode:\/\/workspace\/open/, '应保留工作区深链');
  // REQ-20260910-002：标题允许否定式说明（「深链不会自动新建或发送」「不会自动发送」），
  // 剔除否定式后不得残留肯定式「自动新建会话 / 自动发送」声称
  const affirmative = js.replace(/不(会)?自动(新建|发送)/g, '');
  assert.ok(!/自动新建会话|自动发送/.test(affirmative), '不得声称深链自动新建/发送会话');
});

t('U11 条目详情批量执行设置：折叠、依赖多选、保存校验就地反馈', () => {
  assert.match(js, /批量执行设置/, '应有批量执行设置区块');
  assert.match(js, /details/, '应使用折叠容器');
  assert.match(js, /\/api\/item\/.+\/policy/, '应读写策略接口');
  assert.match(js, /前置条目人工验收完成后才自动实施/, '应说明依赖语义');
});

t('U12 面板轮询：打开时随主轮询刷新批次摘要', () => {
  assert.match(js, /\/api\/batch\/current/, '应拉取批次摘要');
  assert.match(js, /batchSig|batchJson/, '应有变更签名避免全量重渲染');
});

t('U13 打开 Zcode 工作区与关闭说明：立即停止需原生界面', () => {
  assert.match(js, /Zcode 原生|原生任务/, '应说明立即停止需到原生界面');
});

t('U14 REQ-20260910-027 开发人员设置移除：创建区无输入框、无 localStorage 记忆与 git 预填、面板与排队不展示、创建请求体不带 developer', () => {
  assert.doesNotMatch(js, /id="batchDev"/, '创建区不应再有开发人员输入框');
  assert.doesNotMatch(js, /maxlength="30"/, '开发人员输入框限长应随输入框移除');
  assert.doesNotMatch(js, /atb\.batch\.dev/, '不应再记忆上次使用值（localStorage）');
  assert.doesNotMatch(js, /gitUser/, '不应再使用 git user.name 预填');
  assert.doesNotMatch(js, /开发人员 \$\{/, '面板不应再展示「开发人员 <值>」片段');
  assert.doesNotMatch(js, /未指定/, '「未指定」回退文案应随展示移除');
  // 提交创建时不再携带 developer 字段
  const createFn = js.match(/async function createBatchAndCopy[\s\S]{0,900}/);
  assert.ok(createFn, '应有 createBatchAndCopy 函数');
  assert.doesNotMatch(createFn[0], /developer/, '创建请求体不应携带 developer');
});

t('U15 REQ-20260908-001 记录单号后显示条目标题（REQ-20260908-026 起由 runAttemptsHtml 承接）：截断悬停', () => {
  const fn = js.match(/function runAttemptsHtml[\s\S]*?\n\}/);
  assert.ok(fn, '应有 runAttemptsHtml 函数');
  const body = fn[0];
  // 单号 span 之后紧跟标题渲染：标题 span 带 title 属性悬停全文
  assert.match(
    body,
    /data-goto-item="\$\{esc\(r\.itemId\)\}[\s\S]{0,200}?title="\$\{esc\(r\.title/,
    '单号后应渲染带悬停全文的条目标题',
  );
  assert.match(body, /shortOwner\(r\.title/, '标题超长应截断（shortOwner）');
  assert.match(css, /\.attempt-table td \.rec-title|\.rec-title/, '标题应有独立样式');
});

t('U16（BUG-20260908-023）终态批次不再提供「暂停后续」入口：终止/正常收尾面板无 batchPause；运行中面板保留', () => {
  // 提取真实 renderZcodeBatchPanel 源码在 vm 中执行（与 refine-ui R12-9 同思路）。
  const panel = js.match(/function renderZcodeBatchPanel\(\)[\s\S]*?\n\}/);
  assert.ok(panel, '应存在 renderZcodeBatchPanel');
  const render = (data) => {
    const ctx = {
      state: { impl: { selected: new Set() }, batchData: data },
      plannedQueue: () => [],
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
    return vm.runInContext(`${panel[0]}\nrenderZcodeBatchPanel()`, ctx);
  };
  const batch = (extra = {}) => ({
    batchId: 'B-20990101-001', mode: 'zcode', agent: 'zcode', status: 'running',
    abortRequested: false, aborted: false, pauseRequested: false, developer: null,
    createdAt: '2026-01-01T00:00:00.000Z', lastActivityAt: '2026-01-01T00:00:00.000Z',
    candidates: [], prompt: '调度提示词', ...extra,
  });
  const data = (b, counts) => ({ batch: b, counts, current: null, records: [], recordsTotal: 0, pending: [], nextAction: 'stop', notice: null, queue: [], stats: { candidates: 0, blocked: 0 } });
  const doneCounts = { total: 1, reported: 0, failed: 0, skipped: 1, blockedRuns: 0, interrupted: 0, remaining: 0 };
  // 终止收尾态：不出现可点的「暂停后续」按钮（与「终止任务」隐藏口径一致）
  const abortedHtml = render(data(batch({ status: 'finished', abortRequested: true, aborted: true }), doneCounts));
  assert.doesNotMatch(abortedHtml, /id="batchPause"/, '终止收尾面板不得出现暂停后续按钮');
  assert.doesNotMatch(abortedHtml, /已请求暂停后续领取/, '不得误显示已暂停提示');
  // 正常完成态（非终止）：同样不出现暂停入口
  const doneHtml = render(data(batch({ status: 'finished' }), doneCounts));
  assert.doesNotMatch(doneHtml, /id="batchPause"/, '正常完成面板不得出现暂停后续按钮');
  // 运行中 / 已暂停：暂停入口保留（行为不回归）
  const runningHtml = render(data(batch(), { ...doneCounts, remaining: 1, skipped: 0 }));
  assert.match(runningHtml, /id="batchPause"/, '运行中面板保留暂停后续按钮');
  const pausedHtml = render(data(batch({ status: 'paused', pauseRequested: true }), { ...doneCounts, remaining: 1, skipped: 0 }));
  assert.match(pausedHtml, /id="batchPause"/, '已暂停面板保留恢复后续领取按钮');
  assert.match(pausedHtml, /恢复后续领取/, '按钮文案为恢复后续领取');
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
