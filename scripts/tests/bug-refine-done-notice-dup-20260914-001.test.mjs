#!/usr/bin/env node
// BUG-20260914-001 —— AI 分析（批量完善）概况页收尾提示重复渲染修复
// 现象：批次正常收尾（finished、未终止、剩余 0）时，服务端 notice（含「均」、无句号）
// 与前端硬编码 ok 条（无「均」、带句号）同屏各渲染一次，且措辞不一致。
// 期望：收尾语义只出现一次（保留绿色 notice ok 展示口径），文案与 CLI `atb refine check`
// 返回的 notice 完全一致；其余场景（运行中/暂停/终止）notice 展示不回归。
// 用法：node scripts/tests/bug-refine-done-notice-dup-20260914-001.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const web = path.join(pluginRoot, 'scripts', 'web');
const js = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
const storeSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'lib', 'refine-store.mjs'), 'utf8');

// 服务端（= CLI `atb refine check`）收尾 notice 权威文案：从 refine-store.mjs 源码提取，
// 保证测试口径与实现单一事实源一致（REQ 文案改动时本测试同步报警）
const storeNotice = storeSrc.match(/notice = '(本轮完善队列已处理完毕[^']*)'/);
assert.ok(storeNotice, 'refine-store.mjs 应含收尾 notice 文案');
const DONE_NOTICE = storeNotice[1];

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 提取真实 renderRefinePanel 源码在 vm 中执行（与 refine-ui.test.mjs R12-8 同思路）
function renderPanel(data) {
  const panel = js.match(/function renderRefinePanel\(\)[\s\S]*?\n\}/)[0];
  const ctx = {
    state: { refine: { data } },
    taskAgentModeText: () => '子代理模式',
    esc: String, fmtTime: String, shortOwner: String, batchStatusLabel: String,
    taskStatsLine: () => '', fmtElapsed: () => '00:00',
    pendingQueueHtml: () => '', runAttemptsHtml: () => '',
    taskPaneShell: (scope, store, panes) => Object.values(panes).join(''),
    workspaceOpenRowHtml: () => '',
    localStorage: { getItem: () => '' },
  };
  vm.createContext(ctx);
  return vm.runInContext(`${panel}\nrenderRefinePanel()`, ctx);
}

const count = (html, s) => html.split(s).length - 1;

const batch = (extra = {}) => ({
  batchId: 'RFB-20990101-001', mode: 'subagent', agent: 'subagent', status: 'finished',
  abortRequested: false, aborted: false, pauseRequested: false, developer: null,
  createdAt: '2026-01-01T00:00:00.000Z', lastActivityAt: '2026-01-01T00:00:00.000Z',
  candidates: [], prompt: '调度提示词', ...extra,
});
const doneCounts = { total: 1, done: 1, failed: 0, skipped: 0, interrupted: 0, remaining: 0 };

t('B1 正常收尾 + 服务端 notice：收尾整句恰好出现 1 次，且为绿色 notice ok 样式、文案与服务端完全一致', () => {
  const html = renderPanel({ batch: batch(), counts: doneCounts, records: [], candidates: [], notice: DONE_NOTICE });
  assert.equal(count(html, '本轮完善队列已处理完毕'), 1, `收尾整句应恰好出现 1 次，实际 ${count(html, '本轮完善队列已处理完毕')} 次`);
  assert.ok(html.includes(`<div class="notice ok">${DONE_NOTICE}</div>`), '唯一一条应为 notice ok 且文案与服务端 notice 逐字一致（含「均」、句读一致）');
  assert.ok(!html.includes('<div class="notice">本轮完善队列已处理完毕'), '不得再以普通 notice 样式叠加渲染同语义收尾提示');
});

t('B2 文案统一：前端不再维护与服务端措辞分叉的硬编码收尾文案（「条目保持已接受」旧措辞/带句号变体清除）', () => {
  const panel = js.match(/function renderRefinePanel\(\)[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(panel, /本轮完善队列已处理完毕（条目保持已接受，[^）]*）。\x27/, '不得保留无「均」且带句号的旧硬编码措辞');
  // 兜底文案（服务端 notice 缺失时）必须与服务端权威文案同源同措辞
  const fallback = panel.match(/'本轮完善队列已处理完毕[^'\n]*'/);
  if (fallback) {
    assert.equal(fallback[0], `'${DONE_NOTICE}'`, `前端兜底收尾文案须与服务端一致：${fallback[0]}`);
  }
});

t('B3 收尾态无服务端 notice（兜底路径）：仍恰好 1 条 ok 收尾提示，不重复', () => {
  const html = renderPanel({ batch: batch(), counts: doneCounts, records: [], candidates: [] });
  assert.equal(count(html, '本轮完善队列已处理完毕'), 1, 'notice 缺失时兜底渲染应恰好 1 次');
  assert.ok(html.includes('<div class="notice ok">'), '兜底渲染仍为绿色 ok 样式');
});

t('B4 场景不回归——运行中：服务端「当前执行未收尾」notice 单条展示，无 ok 收尾条', () => {
  const html = renderPanel({
    batch: batch({ status: 'running' }),
    counts: { ...doneCounts, remaining: 1 },
    current: { runId: 'RFR-1', itemId: 'REQ-20990101-001', title: 't', owner: 'w', createdAt: '2026-01-01T00:00:00.000Z' },
    records: [], candidates: [],
    notice: '当前执行未收尾（RFR-1 REQ-20990101-001 owner w），等待子 Agent 回执后核对',
  });
  assert.equal(count(html, '当前执行未收尾'), 1, '运行中服务端 notice 单条展示');
  assert.ok(!html.includes('notice ok'), '运行中不得出现 ok 收尾条');
  assert.ok(!html.includes('本轮完善队列已处理完毕'), '运行中不得出现收尾提示');
});

t('B5 场景不回归——暂停：info 提示与服务端暂停 notice 按现状保留', () => {
  const html = renderPanel({
    batch: batch({ status: 'paused', pauseRequested: true }),
    counts: { ...doneCounts, remaining: 1 },
    records: [], candidates: [],
    notice: '已暂停后续领取（在途执行不受影响）',
  });
  assert.equal(count(html, '已请求暂停后续领取'), 1, '暂停 info 提示保留');
  assert.equal(count(html, '已暂停后续领取'), 1, '服务端暂停 notice 保留');
  assert.ok(!html.includes('notice ok'), '暂停态无 ok 收尾条');
});

t('B6 场景不回归——终止：warn 提示保留、无 ok 收尾条、不出现收尾整句；「启动新一轮」入口不受影响', () => {
  const html = renderPanel({
    batch: batch({ abortRequested: true, aborted: true }),
    counts: doneCounts, records: [], candidates: [{ id: 'REQ-20990101-001', type: 'requirement', title: 't', reasons: [] }],
    notice: '任务已人工终止：不再派发后续项；在途子代理请在对应子代理会话人工停止',
  });
  assert.ok(html.includes('任务已人工终止'), '终止 warn 提示保留');
  assert.ok(!html.includes('notice ok'), '终止态不得出现 ok 收尾条');
  assert.equal(count(html, '本轮完善队列已处理完毕'), 0, '终止态不出现收尾提示');
  assert.match(html, /id="refineNext"/, '终止收尾仍有「启动新一轮」入口');
});

t('B7 收尾态「启动新一轮」入口不回归：有候选可点', () => {
  const html = renderPanel({
    batch: batch(), counts: doneCounts, records: [],
    candidates: [{ id: 'REQ-20990101-001', type: 'requirement', title: 't', reasons: [] }],
    notice: DONE_NOTICE,
  });
  assert.match(html, /id="refineNext"/, '收尾面板应含「启动新一轮」按钮');
  assert.doesNotMatch(html, /id="refineNext"[^>]*\sdisabled/, '有候选时不应禁用');
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
