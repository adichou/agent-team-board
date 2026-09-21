#!/usr/bin/env node
// BUG-20260921-014 「合并入 main」页签首屏「发布范围」区块与页面其余信息完全重复——移除测试：
// 1) 有 / 无关联条目、failed（部分合并）、merged（含文档提交 hash）各状态下合并页签均不再渲染
//    「发布范围」区块（含空态提示「（无关联条目：回到「关联条目与提交」步骤关联）」与
//    「文档提交：…（只随本版发布最新文档提交）」行），无空壳标题残留；
// 2) 移除后剩余区块与顺序不变：隔离分析 → 分支提示 → 门禁禁用原因（如有）→「合并入 main」主按钮
//    → 失败原因 / 合并完成结果；加载中、读取失败（重试）态行为不变；
// 3) 信息不丢失：关联条目 + commit + 已合并（✓）/ 失败（✕）仍在「关联条目与提交」页签；
//    文档提交 hash 仍在「文档编写」页签提交门禁条；合并确认弹窗仍列完整 commit 清单；
// 4) i18n：词典死词条「发布范围: 'Release scope'」随之清理（EN / EN_DYNAMIC 均无残留）。
// 用法：node scripts/tests/bug-build-merge-scope-removal-20260921-014.test.mjs

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
  const merged = status === 'merged';
  return {
    id, name, description: `描述 ${name}`, status, targetBranch: 'main', pushed: false,
    items: [{ itemId: 'REQ-20260913-001', commit: H1, title: '演示需求', mergedAt: merged ? '2026-09-13T03:00:00.000Z' : null, mergeError: status === 'failed' ? 'conflict' : null }],
    createdAt: '2026-09-13T01:00:00.000Z', updatedAt: '2026-09-13T02:00:00.000Z',
    merge: { startedAt: null, finishedAt: null, error: status === 'failed' ? '模拟合并失败' : null, baseBranch: 'dev', ...(merged ? { mainSha: H2, replays: [] } : {}) },
    ...extra,
  };
}

// 五步装配 payload（/api/build/publish-plan 形状）
function plan({ currentBranch = 'dev', docsHash = null, mergeLocked = false, reason = '' } = {}) {
  return {
    currentBranch, mainBranch: 'main',
    steps: [
      { key: 'plan', label: '版本计划', locked: false, reason: '' },
      { key: 'link', label: '关联条目与提交', locked: false, reason: '' },
      { key: 'docs', label: '文档编写', locked: false, reason: '' },
      { key: 'merge', label: '合并入 main', locked: mergeLocked, reason },
      { key: 'release', label: '正式发布', locked: false, reason: '' },
    ],
    docs: { files: [], overall: docsHash ? 'committed' : 'none', commitHash: docsHash, reasons: [] },
    mergeAnalysis: { perItem: [], blocked: [], notes: [] },
  };
}

function setup({ versions, plans = {} } = {}) {
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
    toast: () => {},
    fetch: async (url) => {
      const up = new URL(String(url), 'http://local');
      if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(state)) };
      if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => ({ items: [] }) };
      if (up.pathname === '/api/build/publish-plan') {
        const id = up.searchParams.get('id');
        return { ok: true, json: async () => JSON.parse(JSON.stringify(plans[id] || plan())) };
      }
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  const tick = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  return {
    sandbox, state,
    run: (code) => vm.runInContext(code, sandbox),
    inner: () => vm.runInContext(`document.querySelector('#buildView').innerHTML`, sandbox),
    enter: async () => { await vm.runInContext(`window.ATBBuild.enter('/p/a')`, sandbox); },
    tick,
    // 选中版本并切到指定步（等待五步装配加载完成）
    detailAt: async (id, step = 'merge') => {
      vm.runInContext(`window.ATBBuild.selectVersion(${JSON.stringify(id)})`, sandbox);
      vm.runInContext(`window.ATBBuild.setStep(${JSON.stringify(step)})`, sandbox);
      await tick();
    },
  };
}

// 截取合并页签内层 HTML（bld-merge-pane 起）
function mergePaneHtml(inner) {
  const i = inner.indexOf('bld-merge-pane');
  assert.ok(i >= 0, '应渲染合并步面板');
  return inner.slice(i, i + 8000);
}

// 断言合并页签无「发布范围」区块及空壳 / 空态 / 文档提交行残留
function assertNoScopeBlock(pane, label) {
  assert.ok(!pane.includes('发布范围'), `${label}：不应出现「发布范围」标题区块`);
  assert.ok(!pane.includes('（无关联条目：回到「关联条目与提交」步骤关联）'), `${label}：不应出现发布范围空态提示`);
  assert.ok(!pane.includes('只随本版发布最新文档提交'), `${label}：不应出现文档提交（只随本版发布最新文档提交）行`);
}

t('M1 有关联条目（可合并）：首区块直接为「隔离分析」，剩余区块与顺序保持不变', async () => {
  const h = setup({ versions: [ver('BLD-OK', '可合并')], plans: { 'BLD-OK': plan({ docsHash: H2 }) } });
  await h.enter();
  await h.detailAt('BLD-OK', 'merge');
  const inner = h.inner();
  const pane = mergePaneHtml(inner);
  assertNoScopeBlock(pane, '有关联条目 + 有文档提交 hash');
  // 首个区块即隔离分析（其后才是分支提示 / 主按钮）
  const firstSection = pane.match(/<section><strong>([^<]+)<\/strong>/);
  assert.ok(firstSection, '合并页签应有区块结构');
  assert.equal(firstSection[1], '隔离分析', `首个区块应为「隔离分析」，实际「${firstSection && firstSection[1]}」`);
  // 顺序：隔离分析 → 当前分支 dev 提示 → 合并主按钮（+ 说明）
  const idx = (s) => { const i = pane.indexOf(s); assert.ok(i >= 0, `合并页签应包含「${s}」`); return i; };
  assert.ok(idx('隔离分析') < idx('当前分支 dev · 目标主分支 main'), '隔离分析应在分支提示之前');
  assert.ok(idx('当前分支 dev · 目标主分支 main') < pane.indexOf('data-ver-merge="BLD-OK"'), '分支提示应在合并主按钮之前');
  assert.ok(pane.indexOf('data-ver-merge="BLD-OK"') >= 0, '合并主按钮仍在');
  assert.match(pane, /只发布所选条目提交与最新文档提交；冲突或依赖未选变化会阻止并说明原因。/, '主按钮说明保留');
});

t('M2 无关联条目 / failed（部分合并）/ merged（已合并）状态均无「发布范围」区块与残留，结果反馈保留', async () => {
  const versions = [
    ver('BLD-EMPTY', '无关联', 'draft', { items: [] }),
    ver('BLD-FAILED', '合并失败', 'failed'),
    ver('BLD-MERGED', '已合并', 'merged'),
  ];
  const plans = {
    'BLD-EMPTY': plan({ mergeLocked: true, reason: '暂无关联条目：请先在「关联条目与提交」步骤关联' }),
    'BLD-FAILED': plan(),
    'BLD-MERGED': plan({ docsHash: H2 }),
  };
  const h = setup({ versions, plans });
  await h.enter();
  // 无关联条目：不再有空态提示行（该引导归关联页签空态）
  await h.detailAt('BLD-EMPTY', 'merge');
  let pane = mergePaneHtml(h.inner());
  assertNoScopeBlock(pane, '无关联条目');
  assert.match(pane, /暂不可合并：暂无关联条目：请先在「关联条目与提交」步骤关联/, '门禁禁用原因保留（无关联条目原因仍可见）');
  // failed：失败原因与重试入口保留
  await h.detailAt('BLD-FAILED', 'merge');
  pane = mergePaneHtml(h.inner());
  assertNoScopeBlock(pane, 'failed（部分合并重试）');
  assert.match(pane, /合并失败：模拟合并失败（可重试，只补未合并条目）/, '合并失败原因保留');
  assert.match(pane, /重试合并入 main/, '重试主按钮保留');
  // merged：合并完成信息保留
  await h.detailAt('BLD-MERGED', 'merge');
  pane = mergePaneHtml(h.inner());
  assertNoScopeBlock(pane, 'merged（已合并）');
  assert.match(pane, /合并完成：主分支头/, '合并完成结果保留');
});

t('M3 加载中 / 读取失败态行为不变（不渲染该区块，重试入口保留）', async () => {
  // 加载中：publish-plan 永不返回 → 一直 loading
  const h = setup({ versions: [ver('BLD-LOAD', '加载中')], plans: {} });
  h.sandbox.fetch = async () => ({ ok: false, json: async () => ({}) });
  // 读取失败：plan 请求返回错误载荷
  const h2 = setup({ versions: [ver('BLD-ERR', '读取失败')] });
  h2.sandbox.fetch = async (url) => {
    const up = new URL(String(url), 'http://local');
    if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(h2.state)) };
    if (up.pathname === '/api/build/publish-plan') return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({}) };
  };
  await h2.enter();
  await h2.detailAt('BLD-ERR', 'merge');
  const pane = mergePaneHtml(h2.inner());
  assertNoScopeBlock(pane, '读取失败态');
  assert.match(pane, /合并分析读取失败：/, '读取失败错误条保留');
  assert.match(pane, /data-pf-retry/, '读取失败重试按钮保留');
});

t('M4 信息不丢失：关联页签仍展示条目 + commit + 合并状态；文档页签门禁条仍显 hash；确认弹窗仍列完整清单', async () => {
  const h = setup({
    versions: [ver('BLD-OK', '可合并', 'failed')], // failed：条目带失败徽标（✕）对照
    plans: { 'BLD-OK': plan({ docsHash: H2 }) },
  });
  await h.enter();
  // 关联条目与提交页签：条目号 + commit + 失败徽标仍在
  await h.detailAt('BLD-OK', 'link');
  const inner = h.inner();
  const i = inner.indexOf('关联条目与 commit');
  assert.ok(i >= 0, '关联页签应有「关联条目与 commit」区块');
  const seg = inner.slice(i, i + 4000);
  assert.match(seg, /REQ-20260913-001/, '关联页签仍展示条目号');
  assert.match(seg, new RegExp(H1.slice(0, 8)), '关联页签仍展示 commit 短 hash');
  assert.match(seg, /title="conflict"/, '关联页签仍展示失败徽标（✕，title 归因）');
  // 文档编写页签：提交门禁条仍展示文档提交 hash
  await h.detailAt('BLD-OK', 'docs');
  const docsSeg = h.inner().slice(h.inner().indexOf('bld-docs'), h.inner().indexOf('bld-docs') + 6000);
  assert.ok(docsSeg.includes('已提交到本地 dev 分支'), '文档页签提交门禁条仍在');
  assert.ok(docsSeg.includes(H2.slice(0, 8)), '文档页签门禁条仍展示文档提交 hash');
  // 合并确认弹窗：仍列出将合并的完整 commit 清单（REQ-20260920-003 前置核对要求）
  h.run(`window.ATBBuild.openMergeConfirm('BLD-OK')`);
  const modal = h.inner();
  assert.match(modal, /合并入 main 确认（BLD-OK）/, '确认弹窗仍打开');
  const m = modal.indexOf('合并入 main 确认（BLD-OK）');
  const mSeg = modal.slice(m, m + 2000);
  assert.match(mSeg, /REQ-20260913-001/, '确认弹窗仍列条目号');
  assert.match(mSeg, new RegExp(H1.slice(0, 8)), '确认弹窗仍列 commit 清单');
});

t('S1 静态契约：renderMergePane 源码不再含发布范围区块 / 死变量；i18n 词典同步清理无半语言残留', async () => {
  const mergePane = buildJs.match(/function renderMergePane\(v\) \{[\s\S]*?\n  \}/);
  assert.ok(mergePane, '缺少 renderMergePane');
  assert.ok(!mergePane[0].includes('<strong>发布范围</strong>'), 'renderMergePane 源码不应再含「发布范围」区块');
  assert.ok(!mergePane[0].includes('scopeRows'), '死变量 scopeRows 应一并移除');
  assert.ok(!mergePane[0].includes('只随本版发布最新文档提交'), 'renderMergePane 源码不应残留文档提交行');
  assert.ok(!mergePane[0].includes('（无关联条目：回到「关联条目与提交」步骤关联）'), 'renderMergePane 源码不应残留空态提示');
  assert.ok(!buildJs.includes('<strong>发布范围</strong>'), 'build.js 不应残留发布范围标题');
  // i18n：静态 / 动态词典均无「发布范围」死词条（BUG-20260912-001 口径：中英一并清理）
  await import('../web/i18n.js');
  const { EN, EN_DYNAMIC } = globalThis.ATBI18N._dict;
  assert.ok(!('发布范围' in EN), 'EN 词典不应残留「发布范围」词条');
  assert.ok(!('发布范围' in EN_DYNAMIC), 'EN_DYNAMIC 词典不应残留「发布范围」词条');
  // 其余 web 模块不再单独输出该标题（词条删除安全）
  for (const f of fs.readdirSync(webRoot).filter((x) => x.endsWith('.js') && x !== 'build.js')) {
    const src = fs.readFileSync(path.join(webRoot, f), 'utf8');
    assert.ok(!src.includes('<strong>发布范围</strong>'), `${f} 不应输出发布范围标题`);
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
