#!/usr/bin/env node
// BUG-20260913-004 版本卡片行内操作按钮——「提示词与回答回填 / 合并入 main」两键从右侧详情底部
// 迁入左侧版本列表每张卡片（参照需求列表 row-acts 口径），文案更名「AI 完善」，i18n 同步。
// REQ-20260921-016 适配：列表卡片合并 / 发布键再迁回右侧详情对应步骤（合并步 / 正式发布步），
// 删除键迁卡片标题行；本文件合并入口状态口径改在详情合并步主按钮核验。
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

function ver(id, name, status = 'draft', extra = {}) {
  return {
    id, name, description: `描述 ${name}`, status, targetBranch: 'main', released: false,
    items: [{ itemId: 'REQ-20260913-001', commit: H1, title: '演示需求', mergedAt: status === 'merged' ? '2026-09-13T03:00:00.000Z' : null, mergeError: status === 'failed' ? 'conflict' : null }],
    createdAt: '2026-09-13T01:00:00.000Z', updatedAt: '2026-09-13T02:00:00.000Z', merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' },
    ...extra,
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
      // REQ-20260921-016：合并入口只剩详情「合并入 main」步主按钮（装配加载就绪后渲染；
      // currentBranch=dev 与测试 state 口径一致，保证非锁定状态按钮可用）
      if (up.pathname === '/api/build/publish-plan') return { ok: true, json: async () => ({ currentBranch: 'dev', mainBranch: 'main', steps: [], docs: { files: [], overall: 'none' }, mergeAnalysis: { perItem: [], blocked: [], notes: [] } }) };
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

// 选中版本并落概况步，返回详情区 HTML（REQ-20260921-013：AI 完善 入口迁入概况；
// REQ-20260921-016：再迁至概况描述块头部）
const detailAt = (h, id) => {
  h.run(`window.ATBBuild.selectVersion(${JSON.stringify(id)}); window.ATBBuild.setStep('plan')`);
  const inner = h.inner();
  const i = inner.indexOf('rel-detail');
  assert.ok(i >= 0, '应渲染右侧详情');
  return inner.slice(i);
};

// 选中版本并落「合并入 main」步，返回合并步主按钮 HTML（REQ-20260921-016 起列表卡片不再有
// 合并键，合并入口状态口径在详情合并步主按钮上核验；步装配为按需异步加载，等就绪后取）
const mergePaneAt = async (h, id) => {
  h.run(`window.ATBBuild.selectVersion(${JSON.stringify(id)}); window.ATBBuild.setStep('merge')`);
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  const inner = h.inner();
  const p = inner.indexOf('bld-merge-pane');
  assert.ok(p >= 0, '应渲染合并步面板');
  const j = inner.indexOf(`data-ver-merge="${id}"`, p);
  assert.ok(j >= 0, `${id} 合并步主按钮存在`);
  const s = inner.lastIndexOf('<button', j);
  return inner.slice(s, inner.indexOf('</button>', j));
};

t('B1 版本卡片不再有行内合并 / 发布键（REQ-20260921-016 精简，合并迁详情合并步）；「AI 完善」在详情概况顶部操作行（REQ-20260921-013 迁入详情，BUG-20260921-016 布局调整）', async () => {
  const h = await setup();
  await h.enter();
  const inner = h.inner();
  const cards = inner.slice(inner.indexOf('rel-list'), inner.indexOf('rel-detail'));
  assert.ok(!cards.includes('data-ver-answer'), '卡片不再渲染 AI 完善（迁移后无重复入口）');
  for (const k of ['data-ver-merge', 'data-ver-release', 'data-ver-release-view']) {
    assert.ok(!cards.includes(k), `卡片不再渲染 ${k}（REQ-20260921-016 迁往详情对应步骤）`);
  }
  for (const id of ['BLD-A', 'BLD-B']) {
    assert.match(cards, new RegExp(`data-ver-delete="${id}"`), `${id} 删除键保留（迁卡片标题行右端）`);
  }
  // 详情概况：唯一 AI 完善入口绑定选中版本（enter 后自动选中 BLD-A），位于概况顶部操作行
  const detail = detailAt(h, 'BLD-A');
  assert.match(detail, /bld-plan-acts/, '概况顶部操作行存在（入口所在容器，BUG-20260921-016）');
  assert.match(detail, /data-ver-answer="BLD-A"/, '概况描述头有 AI 完善（绑定当前版本）');
  assert.match(detail, /aria-label="AI 完善 BLD-A"/, 'AI 完善 aria-label 带版本号');
  assert.match(detail, /title="复制提示词给 Agent，回答直接粘贴回本弹窗自动解析"/, 'AI 完善 title 说明动作');
  assert.match(detail, />AI 完善<\/button>/, '按钮文案为「AI 完善」');
  assert.doesNotMatch(inner, /提示词与回答回填/, '旧文案不再出现');
  // 合并入 main 入口仍在详情合并步（主按钮，文案保留）
  assert.match(await mergePaneAt(h, 'BLD-A'), />挑选合并到 main$/, '合并步主按钮文案（REQ-20260926-002 更名挑选合并）');
});

t('B2 状态口径继承（REQ-20260921-016 起在详情合并步主按钮核验）：merging 禁用；merged 未推送可用（BUG-20260920-005 基准后移）；推送完成后禁用并说明已正式发布；failed 显「重试挑选合并」；AI 完善锁定口径随入口迁入概况描述头保持', async () => {
  const h = await setup({ versions: [
    ver('BLD-DRAFT', 'd1', 'draft'),
    ver('BLD-MERGING', 'd2', 'merging'),
    ver('BLD-MERGED', 'd3', 'merged'),
    ver('BLD-PUSHED', 'd5', 'merged', { released: true }),
    ver('BLD-FAILED', 'd4', 'failed'),
  ] });
  await h.enter();
  const btn = (id) => mergePaneAt(h, id);
  assert.match(await btn('BLD-DRAFT'), /^<button type="button" class="btn primary" data-ver-merge="BLD-DRAFT">/, 'draft 的合并主按钮可用（无 aria-disabled）');
  assert.match(await btn('BLD-MERGING'), /aria-disabled="true" title="合并中，请勿重复触发"/, 'merging 的合并主按钮禁用并提示');
  // BUG-20260920-005：merged（已合并未推送）放开（补关联后可重开合并 / AI 完善）
  assert.match(await btn('BLD-MERGED'), /^<button type="button" class="btn primary" data-ver-merge="BLD-MERGED">/, 'merged 未推送的合并主按钮可用（增量重开合并）');
  // BUG-20260920-005：推送完成（正式发布）后禁用，title 说明已正式发布
  // BUG-20260920-006：禁用从 HTML disabled 改 aria-disabled（点击可捕获反馈），title 升为完整归因
  assert.match(await btn('BLD-PUSHED'), /aria-disabled="true" title="已正式发布，不可再合并（如需调整请新建版本）"/, '推送完成后的合并主按钮禁用且 title 说明');
  assert.match(await btn('BLD-FAILED'), />重试挑选合并$/, 'failed 的合并主按钮文案为「重试挑选合并」（REQ-20260926-002）');
  // AI 完善锁定口径迁入详情概况描述头后逐态核验（口径不变，位置变）
  assert.match(detailAt(h, 'BLD-DRAFT'), /data-ver-answer="BLD-DRAFT" aria-label/, 'draft 的 AI 完善可用（无 disabled）');
  assert.match(detailAt(h, 'BLD-MERGING'), /data-ver-answer="BLD-MERGING" disabled title="合并中，请稍候……"/, 'merging 的 AI 完善禁用并提示');
  assert.match(detailAt(h, 'BLD-MERGED'), /data-ver-answer="BLD-MERGED"[^>]*title="复制提示词给 Agent，回答直接粘贴回本弹窗自动解析"/, 'merged 未推送的 AI 完善带可用 title');
  assert.match(detailAt(h, 'BLD-PUSHED'), /data-ver-answer="BLD-PUSHED" disabled title="已正式发布，不允许再 AI 完善"/, '推送完成的 AI 完善禁用且 title 说明');
  // 回归：merging 详情提示保留（概况步内容区）
  const mergingDetail = detailAt(h, 'BLD-MERGING');
  assert.match(mergingDetail, /合并中，请稍候……/, 'merging 详情提示不回归');
});

t('B3 移动而非复制：详情底部不再渲染操作按钮（无 rel-acts / bldAnswerBtn / bldMergeBtn），详情其余区块不受影响', async () => {
  const h = await setup();
  await h.enter(); // refresh 后自动选中首个版本 → 详情已渲染
  const inner = h.inner();
  assert.doesNotMatch(inner, /rel-acts/, '详情底部 rel-acts 移除');
  assert.doesNotMatch(inner, /bldAnswerBtn/, '旧 #bldAnswerBtn 移除');
  assert.doesNotMatch(inner, /bldMergeBtn/, '旧 #bldMergeBtn 移除');
  assert.match(inner, /bld-name/, '详情名称区保留');
  // REQ-20260920-003：五步流程——「＋ 添加条目」在「关联条目与提交」步
  h.run(`window.ATBBuild.setStep('link')`);
  assert.match(h.inner(), /bldAddItem/, '「关联条目与提交」步「＋ 添加条目」保留');
});

t('B4 按目标版本打开且不改变选中：openAnswerModal 带参对非选中版本 B 开弹窗内容对 B，选中态保持 A（REQ-20260921-013 后入口绑定选中版本，带参直调口径保留）', async () => {
  const h = await setup();
  await h.enter(); // selVerId 自动为 BLD-A
  h.run(`window.ATBBuild.openAnswerModal('BLD-B')`);
  let inner = h.inner();
  assert.match(inner, /AI 完善（BLD-B）/, '弹窗标题对应目标版本 B');
  assert.match(inner, /v2\.0 后备/, '提示词内容为 B 的名称/描述');
  assert.doesNotMatch(inner, /rel-card sel" data-ver-id="BLD-B"/, 'B 卡片未因打开弹窗而选中');
  assert.match(inner, /rel-card sel" data-ver-id="BLD-A"/, 'A 选中态保持');
  h.run(`window.ATBBuild.openMergeConfirm('BLD-B')`);
  inner = h.inner();
  assert.match(inner, /合并入 main 确认（BLD-B）/, '合并确认框对应目标版本 B');
});

t('B5 无参调用兼容：无参对应当前选中版本；带参但版本不存在时不弹窗', async () => {
  const h = await setup();
  await h.enter(); // selVerId = BLD-A
  h.run(`window.ATBBuild.openAnswerModal()`);
  assert.match(h.inner(), /AI 完善（BLD-A）/, '无参时对应当前选中版本');
  h.run(`window.ATBBuild.openAnswerModal('BLD-NOPE')`);
  assert.doesNotMatch(h.inner(), /AI 完善（BLD-NOPE）/, '不存在的版本号不弹窗');
});

t('B7 BUG-20260914-020 / BUG-20260920-005：推送完成（正式发布）后不允许再 AI 完善——直调/选中回落均不弹窗，merging 同口径兜底，merged 未推送 / draft / failed 零回归，i18n 词条同步', async () => {
  const h = await setup({ versions: [
    ver('BLD-DRAFT', 'd1', 'draft'),
    ver('BLD-MERGING', 'd2', 'merging'),
    ver('BLD-MERGED', 'd3', 'merged'),
    ver('BLD-PUSHED', 'd5', 'merged', { released: true }),
    ver('BLD-FAILED', 'd4', 'failed'),
  ] });
  await h.enter(); // selVerId 自动选中首个 BLD-DRAFT
  // 推送完成：带参直调不弹窗
  h.run(`window.ATBBuild.openAnswerModal('BLD-PUSHED')`);
  assert.doesNotMatch(h.inner(), /AI 完善（BLD-PUSHED）/, '直调推送完成后不弹窗');
  // 推送完成：选中后无参回落也不弹窗（防御路径）
  h.run(`window.ATBBuild.selectVersion('BLD-PUSHED')`);
  h.run(`window.ATBBuild.openAnswerModal()`);
  assert.doesNotMatch(h.inner(), /AI 完善（BLD-PUSHED）/, '无参回落推送完成后不弹窗');
  // merging：卡片按钮本就禁用，直调路径同样兜底不弹窗（锁定口径一致）
  h.run(`window.ATBBuild.openAnswerModal('BLD-MERGING')`);
  assert.doesNotMatch(h.inner(), /AI 完善（BLD-MERGING）/, '直调 merging 不弹窗');
  // BUG-20260920-005：merged（已合并未推送）放开——可完整打开弹窗
  h.run(`window.ATBBuild.openAnswerModal('BLD-MERGED')`);
  assert.match(h.inner(), /AI 完善（BLD-MERGED）/, 'merged 未推送可打开 AI 完善');
  // 零回归：draft / failed 仍可打开 AI 完善弹窗
  h.run(`window.ATBBuild.openAnswerModal('BLD-FAILED')`);
  assert.match(h.inner(), /AI 完善（BLD-FAILED）/, 'failed 仍可打开 AI 完善');
  h.run(`window.ATBBuild.openAnswerModal('BLD-DRAFT')`);
  assert.match(h.inner(), /AI 完善（BLD-DRAFT）/, 'draft 仍可打开 AI 完善');
  // i18n：BUG-20260920-005 新 title 词条同步（title 属性走全文精确翻译），旧 merged 词条清理
  await import('../web/i18n.js');
  const { EN } = globalThis.ATBI18N._dict;
  assert.equal(EN['已正式发布，不允许再 AI 完善'], 'Officially released — AI refine disabled', 'EN 新词条已同步');
  assert.ok(!('已合并入 main，不允许再 AI 完善' in EN), '旧 merged 禁用词条随口径迁移清理');
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
