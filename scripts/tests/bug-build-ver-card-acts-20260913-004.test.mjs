#!/usr/bin/env node
// BUG-20260913-004 版本卡片行内操作按钮——「提示词与回答回填 / 合并入 main」两键从右侧详情底部
// 迁入左侧版本列表每张卡片（参照需求列表 row-acts 口径），文案更名「AI 完善」，i18n 同步。
// B1~B5 vm 行为（加载实际 build.js，假 DOM 口径同 build-ui.test.mjs）；S1 静态契约；B6 i18n。
// 用法：node scripts/tests/bug-build-ver-card-acts-20260913-004.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(pluginRoot, 'scripts', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- vm 行为 ---------- */

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false, checked: false, hidden: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, element()); return nodes.get(sel); },
    querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); },
    replaceChildren(...c) { this.children = c; },
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {},
    closest() { return null; },
  };
}

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);

function ver(id, name, status = 'draft') {
  return {
    id, name, description: `描述 ${name}`, status, targetBranch: 'main',
    items: [{ itemId: 'REQ-20260913-001', commit: H1, title: '演示需求', mergedAt: status === 'merged' ? '2026-09-13T03:00:00.000Z' : null, mergeError: status === 'failed' ? 'conflict' : null }],
    createdAt: '2026-09-13T01:00:00.000Z', updatedAt: '2026-09-13T02:00:00.000Z', merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' },
  };
}

function setup({ versions = [ver('BLD-A', 'v1.0'), ver('BLD-B', 'v2.0 后备')], mergeBusy = false } = {}) {
  const state = { initialized: true, isRepo: true, currentBranch: 'dev', versions };
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    fetch: async (url) => {
      const up = new URL(String(url), 'http://local');
      if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(state)) };
      if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  return {
    sandbox, run: (code) => vm.runInContext(code, sandbox),
    inner: () => vm.runInContext(`document.querySelector('#buildView').innerHTML`, sandbox),
    enter: async () => { await vm.runInContext(`window.ATBBuild.enter('/p/a')`, sandbox); },
  };
}

t('B1 每张版本卡片内渲染「AI 完善」与「合并入 main」两个行内按钮（aria-label/title 齐备，未选中也有）', async () => {
  const h = await setup();
  await h.enter();
  const inner = h.inner();
  for (const id of ['BLD-A', 'BLD-B']) {
    assert.match(inner, new RegExp(`data-ver-answer="${id}"`), `${id} 卡片应有 AI 完善按钮`);
    assert.match(inner, new RegExp(`data-ver-merge="${id}"`), `${id} 卡片应有合并入 main 按钮`);
    assert.match(inner, new RegExp(`aria-label="AI 完善 ${id}"`), 'AI 完善 aria-label 带版本号');
    assert.match(inner, new RegExp(`aria-label="合并入 main ${id}"`), '合并 aria-label 带版本号');
  }
  assert.match(inner, /title="复制提示词给 Agent，回答直接粘贴回本弹窗自动解析"/, 'AI 完善 title 说明动作');
  assert.match(inner, />AI 完善<\/button>/, '按钮文案为「AI 完善」');
  assert.match(inner, />合并入 main<\/button>/, '合并按钮文案');
  assert.doesNotMatch(inner, /提示词与回答回填/, '旧文案不再出现');
});

t('B2 状态口径逐卡继承：merging 两键禁用；merged 合并键禁用 title=已合并入 main；failed 显「重试合并入 main」', async () => {
  const h = await setup({ versions: [
    ver('BLD-DRAFT', 'd1', 'draft'),
    ver('BLD-MERGING', 'd2', 'merging'),
    ver('BLD-MERGED', 'd3', 'merged'),
    ver('BLD-FAILED', 'd4', 'failed'),
  ] });
  await h.enter();
  const inner = h.inner();
  assert.match(inner, /data-ver-answer="BLD-DRAFT" aria-label/, 'draft 的 AI 完善可用（无 disabled）');
  assert.match(inner, /data-ver-merge="BLD-DRAFT" aria-label/, 'draft 的合并键可用');
  assert.match(inner, /data-ver-answer="BLD-MERGING" disabled title="合并中，请稍候……"/, 'merging 的 AI 完善禁用并提示');
  assert.match(inner, /data-ver-merge="BLD-MERGING" disabled title="合并中，请勿重复触发"/, 'merging 的合并键禁用并提示');
  assert.match(inner, /data-ver-merge="BLD-MERGED" disabled title="已合并入 main"/, 'merged 的合并键禁用且 title 提示已合并');
  // BUG-20260914-020：merged 的 AI 完善同样禁用，title 说明已合并不可再 AI 完善（与合并键口径一致）
  assert.match(inner, /data-ver-answer="BLD-MERGED" disabled title="已合并入 main，不允许再 AI 完善"/, 'merged 的 AI 完善禁用且 title 提示已合并');
  assert.doesNotMatch(inner, /data-ver-answer="BLD-MERGED"[^>]*title="复制提示词给 Agent，回答直接粘贴回本弹窗自动解析"/, 'merged 的 AI 完善不再带可用 title');
  assert.match(inner, /data-ver-merge="BLD-FAILED" aria-label="重试合并入 main BLD-FAILED"/, 'failed 的合并键 aria 口径');
  assert.match(inner, />重试合并入 main<\/button>/, 'failed 的合并键文案');
  // 回归：merging 详情提示保留
  h.run(`window.ATBBuild.restoreView({ tab: 'versions', selVerId: 'BLD-MERGING' })`);
  await h.run(`window.ATBBuild.refresh()`);
  assert.match(h.inner(), /合并中，请稍候……/, 'merging 详情提示不回归');
});

t('B3 移动而非复制：详情底部不再渲染操作按钮（无 rel-acts / bldAnswerBtn / bldMergeBtn），详情其余区块不受影响', async () => {
  const h = await setup();
  await h.enter(); // refresh 后自动选中首个版本 → 详情已渲染
  const inner = h.inner();
  assert.doesNotMatch(inner, /rel-acts/, '详情底部 rel-acts 移除');
  assert.doesNotMatch(inner, /bldAnswerBtn/, '旧 #bldAnswerBtn 移除');
  assert.doesNotMatch(inner, /bldMergeBtn/, '旧 #bldMergeBtn 移除');
  assert.match(inner, /bldAddItem/, '详情「＋ 添加条目」保留');
  assert.match(inner, /bld-name/, '详情名称区保留');
});

t('B4 卡片按钮操作所在卡片版本且不改变选中：对非选中版本 B 开弹窗，内容对 B，选中态保持 A', async () => {
  const h = await setup();
  await h.enter(); // selVerId 自动为 BLD-A
  h.run(`window.ATBBuild.openAnswerModal('BLD-B')`);
  let inner = h.inner();
  assert.match(inner, /AI 完善（BLD-B）/, '弹窗标题对应卡片版本 B');
  assert.match(inner, /v2\.0 后备/, '提示词内容为 B 的名称/描述');
  assert.doesNotMatch(inner, /rel-card sel" data-ver-id="BLD-B"/, 'B 卡片未因点按钮而选中');
  assert.match(inner, /rel-card sel" data-ver-id="BLD-A"/, 'A 选中态保持');
  h.run(`window.ATBBuild.openMergeConfirm('BLD-B')`);
  inner = h.inner();
  assert.match(inner, /合并入 main 确认（BLD-B）/, '合并确认框对应卡片版本 B');
});

t('B5 无参调用兼容：无参对应当前选中版本；带参但版本不存在时不弹窗', async () => {
  const h = await setup();
  await h.enter(); // selVerId = BLD-A
  h.run(`window.ATBBuild.openAnswerModal()`);
  assert.match(h.inner(), /AI 完善（BLD-A）/, '无参时对应当前选中版本');
  h.run(`window.ATBBuild.openAnswerModal('BLD-NOPE')`);
  assert.doesNotMatch(h.inner(), /AI 完善（BLD-NOPE）/, '不存在的版本号不弹窗');
});

t('B7 BUG-20260914-020：merged 不允许再 AI 完善——直调/无参回落均不弹窗，merging 同口径兜底，draft/failed 零回归，i18n 词条同步', async () => {
  const h = await setup({ versions: [
    ver('BLD-DRAFT', 'd1', 'draft'),
    ver('BLD-MERGING', 'd2', 'merging'),
    ver('BLD-MERGED', 'd3', 'merged'),
    ver('BLD-FAILED', 'd4', 'failed'),
  ] });
  await h.enter(); // selVerId 自动选中首个 BLD-DRAFT
  // merged：带参直调不弹窗
  h.run(`window.ATBBuild.openAnswerModal('BLD-MERGED')`);
  assert.doesNotMatch(h.inner(), /AI 完善（BLD-MERGED）/, '直调 merged 不弹窗');
  // merged：选中后无参回落也不弹窗（防御路径）
  h.run(`window.ATBBuild.restoreView({ tab: 'versions', selVerId: 'BLD-MERGED' })`);
  await h.run(`window.ATBBuild.refresh()`);
  h.run(`window.ATBBuild.openAnswerModal()`);
  assert.doesNotMatch(h.inner(), /AI 完善（BLD-MERGED）/, '无参回落 merged 不弹窗');
  // merging：卡片按钮本就禁用，直调路径同样兜底不弹窗（锁定口径一致）
  h.run(`window.ATBBuild.openAnswerModal('BLD-MERGING')`);
  assert.doesNotMatch(h.inner(), /AI 完善（BLD-MERGING）/, '直调 merging 不弹窗');
  // 零回归：draft / failed 仍可打开 AI 完善弹窗
  h.run(`window.ATBBuild.openAnswerModal('BLD-FAILED')`);
  assert.match(h.inner(), /AI 完善（BLD-FAILED）/, 'failed 仍可打开 AI 完善');
  h.run(`window.ATBBuild.openAnswerModal('BLD-DRAFT')`);
  assert.match(h.inner(), /AI 完善（BLD-DRAFT）/, 'draft 仍可打开 AI 完善');
  // i18n：新 title 词条同步（title 属性走全文精确翻译）
  await import('../web/i18n.js');
  const { EN } = globalThis.ATBI18N._dict;
  assert.equal(EN['已合并入 main，不允许再 AI 完善'], 'Already merged into main — AI refine disabled', 'EN 新词条已同步');
});

/* ---------- 静态契约 ---------- */

t('S1 静态：按 data-ver-* 循环绑定；copyPrompt 以 answer.verId 定位；doMerge 以 mergeConfirm.verId 定位；mergeBusy 全局禁用口径', () => {
  assert.match(buildJs, /view\.querySelectorAll\('\[data-ver-answer\]'\)/, 'bindCommon 循环绑定 data-ver-answer');
  assert.match(buildJs, /view\.querySelectorAll\('\[data-ver-merge\]'\)/, 'bindCommon 循环绑定 data-ver-merge');
  assert.doesNotMatch(buildJs, /#bldAnswerBtn|#bldMergeBtn/, '旧单实例 id 绑定移除');
  const copyPrompt = buildJs.match(/async function copyPrompt\(\) \{[\s\S]*?\n  \}/);
  assert.ok(copyPrompt, '缺少 copyPrompt');
  assert.match(copyPrompt[0], /const a = state\.answer;/, 'copyPrompt 以弹窗记录的 answer 为准');
  assert.match(copyPrompt[0], /findVersion\(a\.verId\)/, 'copyPrompt 应以 answer.verId 定位版本');
  const doMerge = buildJs.match(/async function doMerge\(\) \{[\s\S]*?\n  \}/);
  assert.ok(doMerge, '缺少 doMerge');
  assert.match(doMerge[0], /state\.mergeConfirm\?\.verId/, 'doMerge 应以 mergeConfirm.verId 定位版本');
  const listFn = buildJs.match(/function renderVersionList\(\) \{[\s\S]*?\n  \}/);
  assert.ok(listFn, '缺少 renderVersionList');
  assert.match(listFn[0], /state\.mergeBusy/, '合并执行中（mergeBusy）应禁用所有卡片合并键');
});

t('B6 i18n：EN 含「AI 完善」，旧键「提示词与回答回填」移除，合并词条保留', async () => {
  await import('../web/i18n.js');
  const { EN } = globalThis.ATBI18N._dict;
  assert.ok(EN['AI 完善'], '应新增「AI 完善」词条');
  assert.ok(!('提示词与回答回填' in EN), '旧词条应移除');
  assert.equal(EN['合并入 main'], 'Merge into main');
  assert.equal(EN['重试合并入 main'], 'Retry merge into main');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
