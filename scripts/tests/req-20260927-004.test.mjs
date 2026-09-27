#!/usr/bin/env node
// REQ-20260927-004 合并视图区分对合入 main 无影响的提交（发布文档提交单独折叠展示）。
// L3 Git 层（build-git：analyzePublishIsolation 按变更文件静态分类发布文档提交，X/M 分开计数）；
// F 前端（build.js：汇总行合并句 + 发布文档折叠行默认收起 + 源码祖先明细行为不变）；
// S 静态契约与 i18n 中英同步（旧汇总行 / 明细尾部词条随文案合并移除）。
// 用法：node scripts/tests/req-20260927-004.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as buildGit from '../lib/build-git.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(pluginRoot, 'scripts', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV, timeout: 20000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

function tmpdir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}
function mkRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@e.co']);
  git(dir, ['config', 'user.name', 'T']);
  return dir;
}
// 定向提交：只提交给定文件（不卷入其他工作区改动），返回新提交 hash
function commit(dir, files, subject) {
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  git(dir, ['add', '--', ...Object.keys(files)]);
  git(dir, ['commit', '-m', subject]);
  return git(dir, ['rev-parse', 'HEAD']);
}
// 场景仓库：main(init: base.txt) → dev 上依次提交 commits（[[files, subject], ...]），返回各提交 hash
function scenario(commits) {
  const dir = mkRepo(tmpdir('atb-req20260927-004-'));
  git(dir, ['add', '-A']);
  commit(dir, { 'base.txt': 'base\n' }, 'init');
  git(dir, ['switch', '-c', 'dev']);
  const hashes = commits.map(([files, subject]) => commit(dir, files, subject));
  return { dir, hashes };
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ================= L3 Git 层：analyzePublishIsolation 发布文档提交分类 ================= */

t('L3-1 仅根文档提交判定：未选祖先只触及 README.md → docOnly=true 且单列 docAncestors（不计入源码祖先）', () => {
  const { dir, hashes } = scenario([
    [{ 'README.md': '# R\n' }, 'docs: 发布文档 BLD-20260923-001'],
    [{ 'feat.txt': 'feat B\n' }, 'feat: B REQ-20260927-004'],
  ]);
  const [docsC, featC] = hashes;
  const an = buildGit.analyzePublishIsolation(dir, [{ itemId: 'REQ-20260927-004', commit: featC }]);
  const per = an.perItem.find((x) => x.itemId === 'REQ-20260927-004');
  assert.equal(per.intermediates.length, 1, '祖先明细仍如实列出该提交');
  assert.equal(per.intermediates[0].hash, docsC);
  assert.equal(per.intermediates[0].docOnly, true, '仅触及根第一层发布文档 → 判定为发布文档提交');
  assert.equal(an.docAncestors.length, 1, '发布文档提交单列（M 单独计数）');
  assert.equal(an.docAncestors[0].hash, docsC);
  assert.deepEqual(an.docAncestors[0].itemIds, ['REQ-20260927-004'], '附归属所选条目');
  assert.equal(per.intermediates.filter((i) => !i.docOnly).length, 0, '源码祖先计数 X = 0');
});

t('L3-2 混合祖先不分类：同时触及根文档与源码文件的祖先按现状展示（docOnly=false、不入 docAncestors）', () => {
  const { dir, hashes } = scenario([
    [{ 'README.md': '# R\n', 'feat.txt': 'mixed\n' }, 'feat: 混合提交 REQ-20260927-004'],
    [{ 'b.txt': 'b\n' }, 'feat: B REQ-20260927-004'],
  ]);
  const [mixedC, featC] = hashes;
  const an = buildGit.analyzePublishIsolation(dir, [{ itemId: 'REQ-20260927-004', commit: featC }]);
  const per = an.perItem.find((x) => x.itemId === 'REQ-20260927-004');
  assert.equal(per.intermediates.length, 1);
  assert.equal(per.intermediates[0].docOnly, false, '混合变更（根文档 + 其他文件）不分类');
  assert.equal(an.docAncestors.length, 0, '混合祖先不进发布文档清单');
});

t('L3-3 语言变体与自定义文档：README_en.md 随默认语言集判定；MIGRATION.md 仅在 v.customDocs 清单内判定', () => {
  const { dir, hashes } = scenario([
    [{ 'README_en.md': '# R en\n' }, 'docs: 发布文档（英文）'],
    [{ 'MIGRATION.md': '# M\n' }, 'docs: 迁移指南'],
    [{ 'c.txt': 'c\n' }, 'feat: C REQ-20260927-004'],
  ]);
  const [enDoc, migDoc, featC] = hashes;
  // 配置 customDocs：两个文档提交都判定为发布文档提交
  const an1 = buildGit.analyzePublishIsolation(
    dir,
    [{ itemId: 'REQ-20260927-004', commit: featC }],
    { langs: ['cn', 'en'], customDocs: ['MIGRATION'] },
  );
  assert.equal(an1.docAncestors.length, 2, 'README_en.md（语言变体）与 MIGRATION.md（customDocs）均判定');
  assert.ok(an1.docAncestors.some((d) => d.hash === enDoc) && an1.docAncestors.some((d) => d.hash === migDoc));
  // 未配置 customDocs：MIGRATION.md 提交不分类（按现状展示）
  const an2 = buildGit.analyzePublishIsolation(dir, [{ itemId: 'REQ-20260927-004', commit: featC }]);
  assert.equal(an2.docAncestors.length, 1, '默认集合只含标准类与语言变体');
  assert.equal(an2.docAncestors[0].hash, enDoc);
  const per2 = an2.perItem.find((x) => x.itemId === 'REQ-20260927-004');
  assert.equal(per2.intermediates.find((i) => i.hash === migDoc).docOnly, false, '不在集合内的文件不豁免');
});

t('L3-4 全部为发布文档提交的折叠形态（X=0 且 M>0）：docAncestors 汇总全部祖先，源码祖先为空', () => {
  const { dir, hashes } = scenario([
    [{ 'README.md': '# R1\n' }, 'docs: 发布文档（一）'],
    [{ 'CHANGELOG.md': '# C\n' }, 'docs: 发布文档（二）'],
    [{ 'd.txt': 'd\n' }, 'feat: D REQ-20260927-004'],
  ]);
  const [d1, d2, featC] = hashes;
  const an = buildGit.analyzePublishIsolation(dir, [{ itemId: 'REQ-20260927-004', commit: featC }]);
  assert.deepEqual([...an.docAncestors.map((d) => d.hash)].sort(), [d1, d2].sort(), 'M=2 单独计数（祖先明细按 git log 新→旧列出）');
  const per = an.perItem.find((x) => x.itemId === 'REQ-20260927-004');
  assert.equal(per.intermediates.filter((i) => !i.docOnly).length, 0, 'X=0：无源码祖先');
  assert.ok(!an.notes.some((n) => /未选祖先提交/.test(n) && !/发布文档/.test(n)), 'notes 不再把发布文档祖先混入源码祖先计数');
});

t('L3-5 分类判定只读：挑选合并仍只重放所选提交，main 不夹带发布文档祖先的变更', () => {
  const { dir, hashes } = scenario([
    [{ 'README.md': '# R\n' }, 'docs: 发布文档 BLD-20260923-001'],
    [{ 'e.txt': 'e\n' }, 'feat: E REQ-20260927-004'],
  ]);
  const [, featC] = hashes;
  const an = buildGit.analyzePublishIsolation(dir, [{ itemId: 'REQ-20260927-004', commit: featC }]);
  assert.equal(an.docAncestors.length, 1, '前置：祖先为发布文档提交');
  const r = buildGit.mergeIsolatedIntoMain(dir, { versionId: 'BLD-20260927-004', versionName: '测试', items: [{ itemId: 'REQ-20260927-004', commit: featC }] });
  assert.equal(r.results[0].ok, true, `合并应成功：${r.results[0].error || ''}`);
  assert.ok(git(dir, ['ls-tree', '--name-only', 'main']).includes('e.txt'), '所选提交变更在 main');
  assert.ok(!git(dir, ['ls-tree', '--name-only', 'main']).includes('README.md'), '发布文档祖先不随挑选合并进入 main（执行语义不变）');
});

/* ================= F 前端：合并步隔离分析区分展示 ================= */

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false, checked: false, hidden: false, open: false,
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
const DOC1 = 'c'.repeat(40);
const DOC2 = 'd'.repeat(40);

function ver(id, name, status = 'draft', extra = {}) {
  const merged = status === 'merged';
  return {
    id, name, description: `描述 ${name}`, status, targetBranch: 'main', pushed: false,
    items: [{ itemId: 'REQ-20260927-004', commit: H1, title: '演示需求', mergedAt: merged ? '2026-09-27T03:00:00.000Z' : null, mergeError: status === 'failed' ? 'conflict' : null }],
    createdAt: '2026-09-27T01:00:00.000Z', updatedAt: '2026-09-27T02:00:00.000Z',
    merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev', ...(merged ? { mainSha: H2, replays: [] } : {}) },
    ...extra,
  };
}

function plan({ currentBranch = 'dev', docsHash = null, perItem = null, docAncestors = null, sharedList = [] } = {}) {
  return {
    currentBranch, mainBranch: 'main',
    steps: [
      { key: 'plan', label: '选择条目与提交', locked: false, reason: '' },
      { key: 'merge', label: '挑选合并', locked: false, reason: '' },
      { key: 'docs', label: '文档与翻译', locked: false, reason: '' },
      { key: 'docmerge', label: '文档合并', locked: false, reason: '' },
      { key: 'release', label: '发布', locked: false, reason: '' },
    ],
    docs: { files: [], overall: docsHash ? 'committed' : 'none', commitHash: docsHash, reasons: [] },
    mergeAnalysis: {
      perItem: perItem || [],
      shared: sharedList,
      ...(docAncestors ? { docAncestors } : {}),
      notes: [],
    },
  };
}

const SRC_PER_ITEM = [
  { itemId: 'REQ-20260927-004', commit: H1, count: 2, intermediates: [
    { hash: '9ab3cdef'.padEnd(40, '0'), subject: 'feat: 优化 REQ-20260920-018', date: '2026-09-20T10:00:00+08:00', docOnly: false },
    { hash: 'c45d9911'.padEnd(40, '0'), subject: 'dev: 修复 BUG-20260920-017', date: '2026-09-20T11:00:00+08:00', docOnly: false },
  ] },
  { itemId: 'BUG-20260927-005', commit: H2, count: 1, intermediates: [
    { hash: '77d0e2ff'.padEnd(40, '0'), subject: 'feat: 补充说明', date: '2026-09-20T12:00:00+08:00', docOnly: false },
  ] },
];

function setup({ versions, plans = {} } = {}) {
  const state = { initialized: true, isRepo: true, currentBranch: 'dev', versions };
  const calls = { state: 0, plan: 0 };
  const toasts = [];
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const planOf = (id) => plans[id] || plan();
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    toast: () => {},
    fetch: async (url, opts) => {
      const up = new URL(String(url), 'http://local');
      if (up.pathname === '/api/build/state') { calls.state++; return { ok: true, json: async () => JSON.parse(JSON.stringify(state)) }; }
      if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => ({ items: [] }) };
      if (up.pathname === '/api/build/publish-plan') { calls.plan++; return { ok: true, json: async () => JSON.parse(JSON.stringify(planOf(up.searchParams.get('id')))) }; }
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  sandbox.toast = (m, isErr) => toasts.push([m, !!isErr]);
  const tick = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  return {
    sandbox, state, calls, toasts,
    run: (code) => vm.runInContext(code, sandbox),
    inner: () => vm.runInContext(`document.querySelector('#buildView').innerHTML`, sandbox),
    enter: async () => { await vm.runInContext(`window.ATBBuild.enter('/p/a')`, sandbox); },
    tick,
    detailAt: async (id, step = 'merge') => {
      vm.runInContext(`window.ATBBuild.selectVersion(${JSON.stringify(id)})`, sandbox);
      vm.runInContext(`window.ATBBuild.setStep(${JSON.stringify(step)})`, sandbox);
      await tick();
    },
  };
}

function mergePaneHtml(inner, size = 16000) {
  const i = inner.indexOf('bld-merge-pane');
  assert.ok(i >= 0, '应渲染合并步面板');
  return inner.slice(i, i + size);
}

t('F1 汇总行合并句：X 只统计源码祖先、Y 为受影响所选条目数；明细尾部去向说明不再单独展示；发布文档折叠行默认收起', async () => {
  const docAncestors = [{ hash: DOC1, subject: 'docs: 发布文档 BLD-20260923-001', itemIds: ['REQ-20260927-004'] }];
  const h = setup({
    versions: [ver('BLD-DOC', '区分文档提交')],
    plans: { 'BLD-DOC': plan({ docsHash: H2, perItem: SRC_PER_ITEM, docAncestors }) },
  });
  await h.enter();
  await h.detailAt('BLD-DOC', 'merge');
  const pane = mergePaneHtml(h.inner());
  assert.match(pane, /发现 2 个所选条目的共 3 个未选祖先提交。/, '汇总行：Y=2（源码祖先归属条目数）、X=3（不含 M）');
  assert.match(pane, /未选的祖先提交不随隔离合并进入 main；若所选改动依赖其内容，执行时将冲突阻止并说明原因。/, '去向说明并入汇总行');
  assert.ok(!pane.includes('个未选祖先提交 · 影响'), '旧「发现 X 个未选祖先提交 · 影响 Y 个所选条目」不再出现');
  assert.ok(!pane.includes('未选祖先不随隔离合并进入 main'), '明细尾部不再单独展示去向说明（旧句）');
  assert.match(pane, /另有 1 个发布文档提交 · 随『文档合并』步处理，不随挑选合并/, '发布文档折叠行汇总文案（M 单独说明）');
  assert.ok(!/<details class="bld-iso-docs" open/.test(pane), '发布文档折叠行默认收起');
  assert.match(pane, /查看未选祖先明细/, '源码祖先明细折叠入口保留（行为不变）');
  assert.ok(pane.includes('9ab3cdef'), '源码祖先明细含短 hash');
  assert.match(pane, /为 REQ-20260927-004 的未选祖先/, '源码祖先明细归属标注不变');
  assert.ok(!/<details class="bld-iso-deps" open/.test(pane), '源码祖先明细折叠行为不变（默认收起）');
});

t('F2 发布文档折叠行展开内容：徽标（颜色 + 文字）+ 短 hash + 主题 + 去向说明；无纳入/移出入口（只读）', async () => {
  const docAncestors = [
    { hash: DOC1, subject: 'docs: 发布文档 BLD-20260923-001', itemIds: ['REQ-20260927-004'] },
    { hash: DOC2, subject: 'docs: 发布文档 BLD-20260926-003', itemIds: ['BUG-20260927-005'] },
  ];
  const h = setup({
    versions: [ver('BLD-DOC2', '折叠明细')],
    plans: { 'BLD-DOC2': plan({ docsHash: H2, perItem: SRC_PER_ITEM, docAncestors }) },
  });
  await h.enter();
  await h.detailAt('BLD-DOC2', 'merge');
  const pane = mergePaneHtml(h.inner());
  assert.match(pane, /另有 2 个发布文档提交 · 随『文档合并』步处理，不随挑选合并/, 'M=2 单独计数说明');
  assert.ok(pane.includes('c'.repeat(8)) && pane.includes('发布文档 BLD-20260923-001'), '展开内容含短 hash + 主题');
  assert.match(pane, /发布文档提交/, '「发布文档提交」徽标文字');
  assert.ok(/bld-iso-doc-tag/.test(pane), '徽标带独立样式类（颜色 + 文字双重区分）');
  assert.match(pane, /仅根第一层发布文档 · 不随挑选合并进入 main，随『文档合并』步处理/, '逐条去向说明');
  assert.ok(!pane.includes('data-iso-add-deps') && !pane.includes('data-iso-doc-'), '折叠行不提供纳入/移出合并集合的入口（只读）');
});

t('F3 X=0 且 M>0：呈现「所选提交无未选祖先」+ 发布文档折叠行，不出现空的源码明细', async () => {
  const perItem = [
    { itemId: 'REQ-20260927-004', commit: H1, count: 1, intermediates: [
      { hash: DOC1, subject: 'docs: 发布文档 BLD-20260923-001', date: '2026-09-23T10:00:00+08:00', docOnly: true },
    ] },
  ];
  const h = setup({
    versions: [ver('BLD-ONLYDOC', '仅文档提交')],
    plans: { 'BLD-ONLYDOC': plan({ docsHash: H2, perItem }) },
  });
  await h.enter();
  await h.detailAt('BLD-ONLYDOC', 'merge');
  const pane = mergePaneHtml(h.inner());
  assert.match(pane, /所选提交无未选祖先：变更可独立进入主分支。/, 'X=0 空态文案');
  assert.match(pane, /另有 1 个发布文档提交 · 随『文档合并』步处理，不随挑选合并/, '发布文档折叠行照常呈现（不静默）');
  assert.ok(!pane.includes('查看未选祖先明细'), '不出现空的源码祖先明细');
  assert.ok(pane.includes('c'.repeat(8)), '折叠行可展开查看发布文档提交');
});

t('F4 M=0：不出现发布文档折叠行，界面与现状一致', async () => {
  const h = setup({
    versions: [ver('BLD-SRC', '仅源码祖先')],
    plans: { 'BLD-SRC': plan({ docsHash: H2, perItem: SRC_PER_ITEM, docAncestors: [] }) },
  });
  await h.enter();
  await h.detailAt('BLD-SRC', 'merge');
  const pane = mergePaneHtml(h.inner());
  assert.match(pane, /发现 2 个所选条目的共 3 个未选祖先提交。/, '汇总行照常');
  assert.ok(!pane.includes('bld-iso-docs') && !pane.includes('另有'), 'M=0 不渲染发布文档折叠行');
});

t('F5 截断上限分别生效：源码祖先与发布文档折叠行各按 50 条截断并注明「（其余 N 个略）」', async () => {
  const mk = (n, prefix, docOnly) => Array.from({ length: n }, (_, i) => ({
    hash: (prefix + String(i).padStart(4, '0')).padEnd(40, '0'),
    subject: `commit ${prefix}${i}`, date: '', docOnly,
  }));
  const perItem = [
    { itemId: 'REQ-20260927-004', commit: H1, count: 52, intermediates: [...mk(52, 'a', false), ...mk(51, 'c', true)] },
  ];
  const h = setup({
    versions: [ver('BLD-MAX', '截断')],
    plans: { 'BLD-MAX': plan({ docsHash: H2, perItem }) },
  });
  await h.enter();
  await h.detailAt('BLD-MAX', 'merge');
  const pane = mergePaneHtml(h.inner(), 40000); // 103 行明细超长，放宽截取窗口
  assert.match(pane, /（其余 2 个略）/, '源码祖先明细 52 条截断为 50 并注明');
  assert.match(pane, /另有 51 个发布文档提交 · 随『文档合并』步处理，不随挑选合并/, 'M=51 单独计数');
  const docPart = pane.slice(pane.indexOf('bld-iso-docs'));
  assert.match(docPart, /（其余 1 个略）/, '发布文档折叠行 51 条截断为 50 并注明');
});

/* ================= S 静态契约与 i18n 中英同步 ================= */

t('S1 静态契约：renderMergePane 含发布文档折叠行与徽标；旧汇总行/尾部说明源码移除；读取失败态 rel-form-err 不回归', () => {
  const mergePane = buildJs.match(/function renderMergePane\(v\) \{[\s\S]*?\n  \}/);
  assert.ok(mergePane, '缺少 renderMergePane');
  assert.ok(mergePane[0].includes('bld-iso-docs'), '发布文档折叠行存在');
  assert.ok(mergePane[0].includes('发布文档提交'), '徽标文字存在');
  assert.ok(mergePane[0].includes('随『文档合并』步处理'), '去向说明存在');
  assert.ok(mergePane[0].includes('docAncestors'), '读取服务端 docAncestors 分类结果');
  assert.ok(!mergePane[0].includes('个未选祖先提交 · 影响'), '旧汇总行源码移除');
  assert.ok(!mergePane[0].includes('未选祖先不随隔离合并进入 main'), '明细尾部旧去向说明源码移除（并入汇总句）');
  assert.equal((mergePane[0].match(/rel-form-err/g) || []).length, 1, 'rel-form-err 仅保留读取失败态一处');
  assert.ok(mergePane[0].includes('an.shared'), '共享提交说明保留');
});

t('S2 i18n 中英同步：新增词条齐备且译文不含中文；旧词条随文案合并移除', async () => {
  await import('../web/i18n.js');
  const { EN, EN_DYNAMIC } = globalThis.ATBI18N._dict;
  for (const k of [
    '发布文档提交',
    '仅根第一层发布文档 · 不随挑选合并进入 main，随『文档合并』步处理',
  ]) {
    assert.ok(k in EN, `EN 词典缺词条：${k}`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN[k]), `「${k}」译文不含中文`);
  }
  for (const k of [
    '发现 ◇ 个所选条目的共 ◇ 个未选祖先提交。未选的祖先提交不随隔离合并进入 main；若所选改动依赖其内容，执行时将冲突阻止并说明原因。',
    '另有 ◇ 个发布文档提交 · 随『文档合并』步处理，不随挑选合并',
  ]) {
    assert.ok(k in EN_DYNAMIC, `EN_DYNAMIC 词典缺词条：${k}`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN_DYNAMIC[k]), `「${k}」译文不含中文`);
  }
  for (const k of [
    '发现 ◇ 个未选祖先提交 · 影响 ◇ 个所选条目',
    '未选祖先不随隔离合并进入 main；若所选改动依赖其内容，执行时将冲突阻止并说明原因。',
  ]) {
    assert.ok(!(k in EN) && !(k in EN_DYNAMIC), `旧词条应随文案合并移除：${k}`);
  }
});

/* ================= 执行 ================= */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n${e && e.stack ? e.stack : e}`);
  }
}
if (failed) {
  console.error(`\n${failed} 个用例失败`);
  process.exit(1);
}
console.log(`\n全部通过（${cases.length} 例）`);
