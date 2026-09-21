#!/usr/bin/env node
// BUG-20260920-002 main 分支的 git log 显示优化（main ∪ dev 双支并集 + 分支头标签 +
// 分支配色 + merge-base 汇聚标注）
// —— BUG-20260921-008：数据层已回退并集——所有分支（含 main / master 回退）一律单支口径，
//   B 组随之为单支断言；前端渲染按载荷驱动保留并集渲染能力（服务端不再下发 heads /
//   mergeBase / side），G / R / S / I 组以合成双支载荷继续验证该兼容路径。
// —— B 组：build-git 真实临时仓库（main 单支（BUG-20260921-008）/ dev 单支口径
//   （BUG-20260921-006）/ 单支回退 / 搜索 / 分页 / 已合并 / 无共同祖先 / master 回退）；G 组：
//   logGraph 纯函数分支稳定配色与汇聚标记；R 组：vm 渲染（分支头标签 / Merge-base 标注 /
//   并集提示 / 详情标注 / 单支零回归）；S 组：样式与静态契约；I 组：i18n 中英同步。
// 用法：node scripts/tests/bug-20260920-002.test.mjs

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
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- 公共：真实临时 git 仓库夹具（提交时间戳递增，保证 log 新→旧稳定） ---------- */

let tick = 0;
function git(root, args, opts = {}) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  if (!opts.canFail && r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r;
}

function mkTmp(prefix = 'atb-bug-20260920-002-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function commit(root, file, msg) {
  tick += 10;
  const at = `2026-09-20T01:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')} +0000`;
  fs.writeFileSync(path.join(root, file), `${msg}\n`);
  git(root, ['add', '.']);
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', msg], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at },
  });
  if (r.status !== 0) throw new Error(`git commit 失败：${r.stderr || r.stdout}`);
  return git(root, ['rev-parse', 'HEAD']).stdout.trim();
}

const revOf = (root, ref) => git(root, ['rev-parse', ref]).stdout.trim();

// dev 严格领先型：main = [m0, m1]，dev = [m0, m1, d0, d1]（merge-base = m1）
function mkAheadRepo() {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  const m0 = commit(root, 'm0.md', 'chore: 初始化');
  const m1 = commit(root, 'm1.md', 'docs: main 甲');
  git(root, ['switch', '-q', '-c', 'dev']);
  const d0 = commit(root, 'd0.md', 'feat: dev 提交甲');
  const d1 = commit(root, 'd1.md', 'feat: dev 提交乙');
  return { root, m0, m1, d0, d1 };
}

// 并行型：分叉后 main 也前进（m2 最新）——两支各有独有提交，轨道并行后汇聚
function mkParallelRepo() {
  const a = mkAheadRepo();
  git(a.root, ['switch', '-q', 'main']);
  const m2 = commit(a.root, 'm2.md', 'docs: main 乙');
  return { ...a, m2 };
}

// 已合并型：dev 全部并入 main（--no-ff），无 dev 独有提交
function mkMergedRepo() {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  const m0 = commit(root, 'm0.md', 'chore: 初始化');
  git(root, ['switch', '-q', '-c', 'dev']);
  const d0 = commit(root, 'd0.md', 'feat: dev 提交甲');
  git(root, ['switch', '-q', 'main']);
  git(root, ['merge', '--no-ff', '-q', '-m', 'merge: 合并 dev', 'dev']);
  return { root, m0, d0, M: revOf(root, 'HEAD') };
}

/* ---------- B 组：后端双支并集 ---------- */

t('B1 branchLog main 单支（BUG-20260921-008）：集合与次序 = git log main，不含 dev 独有提交，无 heads / mergeBase / side', () => {
  const { root, m0, m1, m2, d0, d1 } = mkParallelRepo();
  const r = buildGit.branchLog(root, 'main', { limit: 50 });
  const expect = git(root, ['log', 'main', '--format=%H']).stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  assert.equal(r.branch, 'main', '响应 branch 为所选分支');
  assert.equal(r.total, 3, 'total = main 可达总数（rev-list --count main；单支口径）');
  assert.deepEqual(r.commits.map((c) => c.hash), expect, '提交集合与次序与 git log main 一致（dev 独有提交不可见）');
  assert.ok(!r.commits.some((c) => c.hash === d0 || c.hash === d1), 'dev 独有提交不出现在 main 视图');
  assert.ok(!('heads' in r) && !('mergeBase' in r), '单支响应不带 heads / mergeBase');
  assert.ok(r.commits.every((c) => !('side' in c)), '单支响应不带 side');
  const hashes = r.commits.map((c) => c.hash);
  for (const h of [m0, m1, m2]) assert.ok(hashes.includes(h), 'main 可达提交齐全');
  for (const c of r.commits) {
    assert.ok(Array.isArray(c.parents), 'parents 字段保留（REQ-20260920-001 口径不回退）');
    assert.ok(c.short && c.author && c.date && typeof c.subject === 'string');
  }
});

t('B2 BUG-20260921-006 / BUG-20260921-008：main 与 dev 均走单支口径（各只显示本支可达提交）', () => {
  const { root, m2 } = mkParallelRepo();
  const a = buildGit.branchLog(root, 'main', { limit: 50 });
  const b = buildGit.branchLog(root, 'dev', { limit: 50 });
  assert.equal(b.branch, 'dev');
  const expect = git(root, ['log', 'dev', '--format=%H']).stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  assert.equal(b.total, 4, 'dev total = dev 可达数（rev-list --count dev）');
  assert.deepEqual(b.commits.map((c) => c.hash), expect, 'dev 集合与次序 = git log dev（main 独有 m2 不混入）');
  assert.ok(!b.commits.some((c) => c.hash === m2), 'main 独有提交不出现在 dev 视图');
  assert.ok(!('heads' in b) && !('mergeBase' in b), 'dev 单支响应不带 heads / mergeBase');
  assert.ok(b.commits.every((c) => !('side' in c)), 'dev 单支响应不带 side');
  assert.equal(a.total, 3, 'main = main 可达数（BUG-20260921-008 单支口径）');
  assert.ok(!('heads' in a) && !('mergeBase' in a), 'main 单支响应不带 heads / mergeBase');
});

t('B3 单支回退：无 dev / 无 main / 选其他分支时保持既有单支口径（无 heads / mergeBase / side）', () => {
  // 无 dev（main + feature 并存）：feature 提交不出现在 main 视图
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  const m0 = commit(root, 'm0.md', 'chore: 初始化');
  const m1 = commit(root, 'm1.md', 'docs: main 甲');
  git(root, ['switch', '-q', '-c', 'feature']);
  const f0 = commit(root, 'f.md', 'feat: feature 提交');
  const r1 = buildGit.branchLog(root, 'main', { limit: 50 });
  assert.equal(r1.total, 2, '无 dev：仍是单支可达集合');
  assert.ok(!r1.commits.some((c) => c.hash === f0), 'feature 提交不混入');
  assert.ok(!('heads' in r1) && !('mergeBase' in r1), '单支响应不带 heads / mergeBase');
  assert.ok(r1.commits.every((c) => !('side' in c)), '单支响应不带 side');
  // 无 main（仅 dev）
  const root2 = mkTmp();
  git(root2, ['init', '-q', '-b', 'dev']);
  commit(root2, 'a.md', 'chore: 初始化');
  const r2 = buildGit.branchLog(root2, 'dev', { limit: 50 });
  assert.equal(r2.total, 1);
  assert.ok(!('heads' in r2) && !('mergeBase' in r2));
  // 双支仓库但选了第三支：单支口径
  const p = mkParallelRepo();
  git(p.root, ['switch', '-q', 'main']);
  git(p.root, ['branch', 'topic', 'main']);
  const r3 = buildGit.branchLog(p.root, 'topic', { limit: 50 });
  assert.equal(r3.total, 3, 'topic = main 可达 3 条（不含 dev 独有）');
  assert.ok(!('heads' in r3));
});

t('B4 branchSearchLog 单支搜索（BUG-20260921-008）：main 数据集不含 dev 独有提交；dev 单支口径保持；空白 q 走默认单支分页', () => {
  const { root, m1 } = mkParallelRepo();
  // REQ-20260921-002：q 默认 filter（保留祖先闭包）——dev 独有主题在 main 单支数据集中零命中
  const s = buildGit.branchSearchLog(root, 'main', { q: 'dev 提交' });
  assert.equal(s.query, 'dev 提交');
  assert.equal(s.mode, 'filter');
  assert.equal(s.matchedTotal, 0, 'dev 独有主题零命中（单支数据集不含 dev 独有提交）');
  assert.equal(s.total, 0, '保留集为空');
  assert.deepEqual(s.commits, []);
  assert.ok(!('heads' in s) && !('mergeBase' in s), '搜索响应不带 heads / mergeBase');
  // highlight 模式：数据集不变（main 单支 3 条）+ 命中清单为空
  const sh = buildGit.branchSearchLog(root, 'main', { q: 'dev 提交', mode: 'highlight' });
  assert.equal(sh.mode, 'highlight');
  assert.equal(sh.matchedHashes.length, 0, '全量命中清单为空');
  assert.equal(sh.commits.length, 3, '数据集 = main 单支（不过滤）');
  // subject 之外字段命中（作者）：main 单支全部 3 条
  const sMain = buildGit.branchSearchLog(root, 'main', { q: 't' });
  assert.equal(sMain.matchedTotal, 3, '作者命中 main 可达全部（单支）');
  assert.equal(sMain.total, 3);
  // BUG-20260921-006：dev 单支口径（作者命中 dev 可达 4 条，不含 main 独有 m2）
  const s2 = buildGit.branchSearchLog(root, 'dev', { q: 't' });
  assert.equal(s2.matchedTotal, 4, '作者命中 dev 可达全部（单支）');
  assert.equal(s2.total, 4);
  assert.equal(s2.branch, 'dev');
  assert.ok(!('heads' in s2) && !('mergeBase' in s2), 'dev 搜索响应不带 heads / mergeBase');
  // 空白 q → 默认单支分页（无 query 字段）
  const s3 = buildGit.branchSearchLog(root, 'main', { q: '   ' });
  assert.equal(s3.total, 3);
  assert.ok(!s3.query, '空白关键词走默认口径');
});

t('B5 分页：main 单支上 limit/offset 分页拼回完整序列；各页不带 heads / mergeBase', () => {
  const { root } = mkParallelRepo();
  const expect = git(root, ['log', 'main', '--format=%H']).stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  const pages = [];
  for (let off = 0; off < 3; off += 2) {
    const p = buildGit.branchLog(root, 'main', { limit: 2, offset: off });
    assert.equal(p.total, 3, '各页 total 一致（单支）');
    assert.equal(p.limit, 2);
    assert.equal(p.offset, off);
    assert.ok(!('heads' in p) && !('mergeBase' in p), `第 ${off / 2 + 1} 页不带 heads / mergeBase`);
    pages.push(...p.commits);
  }
  assert.deepEqual(pages.map((c) => c.hash), expect, '分页拼回 = 完整 main 单支序列');
});

t('B6 dev 已全部合并：main 视图 = main 可达集合（含经合并提交可达的 dev 提交），无 side / heads / mergeBase', () => {
  const { root, m0, d0, M } = mkMergedRepo();
  const r = buildGit.branchLog(root, 'main', { limit: 50 });
  assert.equal(r.total, 3, 'main = m0 / d0 / 合并提交（git log main 可达）');
  assert.ok(r.commits.some((c) => c.hash === d0), '已并入的 dev 提交经合并提交可达，自然出现在 main 视图');
  assert.ok(r.commits.some((c) => c.hash === M), '合并提交在 main 视图');
  assert.ok(r.commits.every((c) => !('side' in c)), '单支响应不带 side');
  assert.ok(!('heads' in r) && !('mergeBase' in r), '单支响应不带 heads / mergeBase');
  assert.equal(git(root, ['rev-list', '--count', 'main']).stdout.trim(), '3');
});

t('B7 无共同祖先（不相关历史）：main 视图仅 main 可达，孤立 dev 提交不混入；读取不报错', () => {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  const m0 = commit(root, 'a.md', 'chore: 初始化 main');
  const tree = git(root, ['rev-parse', 'main^{tree}']).stdout.trim();
  const orphan = git(root, ['commit-tree', tree, '-m', 'chore: 孤立 dev 根']).stdout.trim();
  git(root, ['update-ref', 'refs/heads/dev', orphan]);
  const r = buildGit.branchLog(root, 'main', { limit: 50 });
  assert.equal(r.total, 1, 'main 只显示 main 可达（孤立 dev 根不混入）');
  assert.deepEqual(r.commits.map((c) => c.hash), [m0]);
  assert.ok(!('heads' in r) && !('mergeBase' in r), '单支响应不带 heads / mergeBase');
});

t('B8 主分支 master 回退仓库：master 单支口径（不含 dev 独有），无并集字段', () => {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'master']);
  const c0 = commit(root, 'a.md', 'chore: 初始化');
  git(root, ['switch', '-q', '-c', 'dev']);
  const d0 = commit(root, 'd.md', 'feat: dev 提交甲');
  git(root, ['switch', '-q', 'master']);
  const c1 = commit(root, 'b.md', 'docs: master 甲');
  const r = buildGit.branchLog(root, 'master', { limit: 50 });
  assert.equal(r.total, 2, 'master = c0 + c1（不含 dev 独有 d0）');
  assert.deepEqual(r.commits.map((c) => c.hash), [c1, c0]);
  assert.ok(!r.commits.some((c) => c.hash === d0), 'dev 独有提交不混入 master 视图');
  assert.ok(!('heads' in r) && !('mergeBase' in r), 'master 单支响应不带 heads / mergeBase');
  assert.ok(r.commits.every((c) => !('side' in c)), 'master 单支响应不带 side');
});

/* ---------- G 组：treeData 纯函数（REQ-20260921-002 树化后：双支身份经 refs 进入 gitgraph；
   原 logGraph colorOf/mergeBase 轨道断言随自研行内 SVG 移除，同 hash 身份稳定性由数据层 side/heads 保证） ---------- */

function loadBuild() {
  const el = () => ({
    innerHTML: '', textContent: '', value: '', dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    appendChild() {}, setAttribute() {}, focus() {},
  });
  const document = { addEventListener() {}, body: el(), querySelector: () => null, querySelectorAll: () => [] };
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  return sandbox.window.ATBBuild;
}

const H = (i) => i.toString(16).padStart(4, '0').repeat(10);
const sc = (i, parents = [], subject = `提交 ${i}`) => ({
  hash: H(i), short: H(i).slice(0, 7), parents, subject, author: 'T', date: '2026-09-20T00:00:00.000Z',
});

t('G1 双支身份：treeData 把 heads 命中行标为分支（main/dev 分支名标签经 gitgraph refs 渲染）；同 hash 子集身份稳定', () => {
  const ATB = loadBuild();
  // dev 领先型并集（新→旧）：d1←mb←m0（d1 side=dev、mb/m0 side=main）
  const commits = [
    { ...sc(1, [H(5)], 'dev 头'), side: 'dev' },
    { ...sc(2, [H(5)], 'main 头'), side: 'main' },
    { ...sc(5, [H(6)], '汇聚点'), side: 'main' },
    { ...sc(6, [], '根'), side: 'main' },
  ];
  const heads = [{ name: 'main', hash: H(2) }, { name: 'dev', hash: H(1) }];
  const d = ATB.treeData(commits, { heads, branchName: 'main' });
  const by = new Map(d.map((x) => [x.hash, x]));
  assert.deepEqual([...by.get(H(1)).refs], ['dev'], 'dev 头行带 dev 分支名');
  assert.deepEqual([...by.get(H(2)).refs], ['main'], 'main 头行带 main 分支名');
  assert.deepEqual([...by.get(H(5)).refs], [], '共享历史行不误挂分支名（汇聚点不因上线 dev 色误染）');
  // 稳定性：搜索 / 翻页子集同 hash 同身份（refs 由 heads 数据决定，不跳变）
  const d2 = ATB.treeData([commits[0], commits[2]], { heads, branchName: 'main' });
  assert.deepEqual([...d2[0].refs], ['dev'], '子集中 dev 头仍 dev 分支名');
  // BUG-20260921-007：子集中 main 头不在集合 → main 侧最新行（汇聚点）锚定 main 分支名
  // （side 身份不变：仍是 main 侧 / 主分支蓝，翻页 / 搜索不跳变——原「无分支名」即第 2 页起
  // dev 泳道变蓝的同源根因）
  assert.deepEqual([...d2[1].refs], ['main'], '子集中 main 侧最新行锚定 main（side 身份稳定）');
});

t('G2 单支零回归：无 heads 时不编造分支名（仅选中分支名挂最新行）；数据行不带双支 refs', () => {
  const ATB = loadBuild();
  const commits = [sc(1, [H(2), H(3)], '合并 feature'), sc(3, [H(4)]), sc(2, [H(4)]), sc(4, [])];
  const d = ATB.treeData(commits, { heads: [], branchName: 'feature' });
  assert.deepEqual([...d[0].refs], ['feature'], '单支最新行 = 选中分支头');
  assert.ok(d.slice(1).every((x) => x.refs.length === 0), '其余行无分支名（不编造）');
  assert.equal(d[0].mergeParents, 2, '合并节点口径不变（双父保真）');
});

/* ---------- R 组：vm 渲染 ---------- */

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

const ST = { initialized: true, isRepo: true, currentBranch: 'dev', versions: [] };

function setup() {
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
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  return { sandbox, run: (code) => vm.runInContext(code, sandbox) };
}

// 提交记录桩：载荷来自 h.sandbox.__logPayload（对象或按 URL 参数返回对象的函数）
function logStub(h, st) {
  h.sandbox.__branches = { isRepo: true, current: 'dev', local: ['dev', 'main'], remote: [] };
  h.sandbox.fetch = async (url) => {
    const up = new URL(String(url), 'http://local');
    if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(st)) };
    if (up.pathname === '/api/build/branches') return { ok: true, json: async () => JSON.parse(JSON.stringify(h.sandbox.__branches)) };
    if (up.pathname === '/api/build/branch-log') {
      const p = typeof h.sandbox.__logPayload === 'function' ? h.sandbox.__logPayload(up) : h.sandbox.__logPayload;
      return { ok: true, json: async () => JSON.parse(JSON.stringify(p)) };
    }
    return { ok: true, json: async () => ({}) };
  };
}

async function branchesView(h) {
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.setTab('branches')`);
  await new Promise((r) => setTimeout(r, 10));
  h.run(`window.ATBBuild.selectBranch('main')`);
  await new Promise((r) => setTimeout(r, 10));
  return () => h.run(`document.querySelector('#buildView').innerHTML`);
}

// 双支并集载荷（dev 领先型）：main 头 H(2)、dev 头 H(1)、merge-base H(5)
function dualPayload(over = {}) {
  return {
    branch: 'main', total: 4, limit: 50, offset: 0,
    heads: [{ name: 'main', hash: H(2) }, { name: 'dev', hash: H(1) }],
    mergeBase: H(5),
    commits: [
      { ...sc(1, [H(5)], 'dev 提交乙'), side: 'dev' },
      { ...sc(2, [H(5)], 'main 提交乙'), side: 'main' },
      { ...sc(5, [H(6)], '汇聚点'), side: 'main' },
      { ...sc(6, [], '根'), side: 'main' },
    ],
    ...over,
  };
}

t('R1 双支并集渲染：分支头标签（main/dev 按轨道色）+ Merge-base 标注（降级列表）+ 树路径 refs（gitgraph 分支标签）+ 并集提示', async () => {
  const h = setup();
  logStub(h, ST);
  h.sandbox.__logPayload = dualPayload();
  const inner = await branchesView(h);
  const html = inner();
  assert.equal((html.match(/data-log-row="/g) || []).length, 4, '节点数 = 并集提交数');
  assert.match(html, /<span class="bld-branch-tag bt-dev">dev<\/span>/, 'dev 分支头标签');
  assert.match(html, /<span class="bld-branch-tag bt-main">main<\/span>/, 'main 分支头标签');
  assert.match(html, /<span class="bld-branch-tag bt-mb" title="main 与 dev 的汇聚点（merge-base）">Merge-base<\/span>/, 'Merge-base 文字标注（非颜色提示）');
  assert.equal((html.match(/并集视图：同时显示 main 与 dev 的提交（含未合并提交）/g) || []).length, 1, '并集提示恰一条');
  // 树路径（vendor 在位）：mountTree import 的 refs 携带 main/dev 分支名（gitgraph 渲染分支标签）
  const h2 = setup();
  logStub(h2, ST);
  h2.sandbox.__logPayload = dualPayload();
  const treeCalls = [];
  h2.sandbox.GitgraphJS = {
    createGitgraph() {
      return { import(data) { treeCalls.push(data); return this; } };
    },
    templateExtend() { return {}; },
    metroTemplate: 'metro',
  };
  await branchesView(h2);
  assert.ok(treeCalls.length >= 1, '树挂载 import 数据');
  const by = new Map(treeCalls[0].map((x) => [x.hash, x]));
  assert.deepEqual([...by.get(H(1)).refs], ['dev'], '树数据 dev 头行带 dev 分支名（gitgraph 分支标签）');
  assert.deepEqual([...by.get(H(2)).refs], ['main'], '树数据 main 头行带 main 分支名');
});

t('R2 单支载荷零回归：无 heads 时不渲染分支标签 / Merge-base 标注 / 并集提示（不编造分支名）', async () => {
  const h = setup();
  logStub(h, ST);
  h.sandbox.__logPayload = {
    branch: 'feature', total: 2, limit: 50, offset: 0,
    commits: [sc(1, [H(2)], 'feature 提交'), sc(2, [], '根')],
  };
  const inner = await branchesView(h);
  const html = inner();
  assert.equal((html.match(/data-log-row="/g) || []).length, 2);
  assert.ok(!/bld-branch-tag/.test(html), '单支无分支头标签');
  assert.ok(!/Merge-base/.test(html), '单支无汇聚标注');
  assert.ok(!/并集视图/.test(html), '单支无并集提示');
});

t('R3 详情区：选中 merge-base 提交显示「main ∩ dev 汇聚点」标注；选中普通提交不显示', async () => {
  const h = setup();
  logStub(h, ST);
  h.sandbox.__logPayload = dualPayload();
  await branchesView(h);
  const inner = () => h.run(`document.querySelector('#buildView').innerHTML`);
  h.run(`window.ATBBuild.selectLogRow(${JSON.stringify(H(5))})`);
  assert.match(inner(), /main ∩ dev 汇聚点/, '详情区含汇聚点标注');
  h.run(`window.ATBBuild.selectLogRow(${JSON.stringify(H(1))})`);
  assert.ok(!/main ∩ dev 汇聚点/.test(inner()), '普通提交详情不带汇聚点标注');
});

t('R4 搜索态双支（filter 闭包）：命中行保留分支头标签与并集提示（不错位 / 不丢身份）', async () => {
  const h = setup();
  logStub(h, ST);
  // REQ-20260921-002：filter 模式响应（匹配 + 祖先闭包保留集分页）
  h.sandbox.__logPayload = (up) => {
    const q = String(up.searchParams.get('q') || '').trim();
    if (!q) return dualPayload();
    const all = dualPayload().commits;
    const hits = all.filter((c) => c.subject.includes(q));
    const kept = new Set(hits.map((c) => c.hash));
    const byHash = new Map(all.map((c) => [c.hash, c]));
    const stack = [...kept];
    while (stack.length) {
      for (const p of byHash.get(stack.pop()).parents) if (!kept.has(p)) { kept.add(p); stack.push(p); }
    }
    const keptList = all.filter((c) => kept.has(c.hash));
    return { ...dualPayload(), query: q, mode: 'filter', commits: keptList, total: keptList.length, matchedTotal: hits.length, allTotal: all.length };
  };
  await branchesView(h);
  const inner = () => h.run(`document.querySelector('#buildView').innerHTML`);
  const el = (sel) => h.run(`document.querySelector('#buildView').querySelector(${JSON.stringify(sel)})`);
  h.run(`window.ATBBuild.setLogSearchMode('filter')`);
  await new Promise((r) => setTimeout(r, 10));
  const input = el('#bldLogSearchInput');
  input.value = 'dev 提交';
  input.listeners.input();
  el('#bldLogSearchGo').listeners.click();
  await new Promise((r) => setTimeout(r, 10));
  const html = inner();
  assert.match(html, /匹配 1 条 · 保留 3\/4 条（含祖先，泳道连通）/, '过滤计数（命中 1 + 祖先 2 条）');
  assert.match(html, /<span class="bld-branch-tag bt-dev">dev<\/span>/, '过滤后分支头标签保留');
  assert.match(html, /并集视图：同时显示 main 与 dev 的提交（含未合并提交）/, '并集提示保留');
});

t('R5 master 回退仓库：heads 首支名为 master 时标签文字如实（bt-main 配色）', async () => {
  const h = setup();
  logStub(h, ST);
  const p = dualPayload();
  h.sandbox.__logPayload = { ...p, heads: [{ name: 'master', hash: H(2) }, { name: 'dev', hash: H(1) }] };
  const inner = await branchesView(h);
  const html = inner();
  assert.match(html, /<span class="bld-branch-tag bt-main">master<\/span>/, 'master 标签按 main 侧配色');
  assert.match(html, /并集视图：同时显示 master 与 dev 的提交（含未合并提交）/, '并集提示用真实分支名');
});

/* ---------- S 组：样式与静态契约 ---------- */

t('S1 style.css：分支头标签 / Merge-base 标注 / 并集提示样式类存在（REQ-20260921-002 树化后行内 SVG 类清理）', () => {
  assert.match(css, /\.bld-branch-tag/, '分支头标签样式');
  assert.match(css, /\.bld-branch-tag\.bt-main/, 'main 侧标签配色（轨道 lg0）');
  assert.match(css, /\.bld-branch-tag\.bt-dev/, 'dev 侧标签配色（轨道 lg1）');
  assert.match(css, /\.bld-branch-tag\.bt-mb/, 'Merge-base 标注样式（虚线描边非颜色提示）');
  assert.match(css, /\.bld-log-union/, '并集提示样式');
  assert.match(css, /\.bld-tree/, '提交树容器样式');
  assert.ok(!/\.bld-graph/.test(css), '自研行内 SVG 图形列样式已清理（渲染层归 gitgraph）');
});

t('S2 build.js 静态契约：treeData 消费 heads（双支身份）/ 渲染读取 mergeBase / side', () => {
  assert.match(buildJs, /function treeData\(/, 'treeData 数据适配纯函数');
  assert.match(buildJs, /heads = Array\.isArray\(state\.branchLog\?\.heads\)/, '渲染读取 heads');
  assert.match(buildJs, /state\.branchLog\?\.mergeBase/, '渲染读取 mergeBase');
  assert.match(buildJs, /c\.side/, '渲染使用 side 分类');
});

t('S3 server.mjs 口径注释同步（branch-log 双支并集说明）', () => {
  const sv = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');
  assert.match(sv, /BUG-20260920-002/, 'branch-log 注释含双支并集口径');
});

/* ---------- I 组：i18n 中英同步 ---------- */

t('I1 i18n：新增文案进 EN / EN_DYNAMIC（值无中文、静态值唯一）', async () => {
  await import('../web/i18n.js');
  const I = globalThis.ATBI18N;
  const { EN, EN_DYNAMIC } = I._dict;
  for (const k of ['main 与 dev 的汇聚点（merge-base）', 'main ∩ dev 汇聚点']) {
    assert.ok(EN[k], `EN 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN[k]), `EN 值不含中文：${k}`);
  }
  assert.ok(EN_DYNAMIC['并集视图：同时显示 ◇ 与 ◇ 的提交（含未合并提交）'], 'EN_DYNAMIC 应含并集提示');
  assert.ok(!/[\u4e00-\u9fff]/.test(EN_DYNAMIC['并集视图：同时显示 ◇ 与 ◇ 的提交（含未合并提交）']), 'EN_DYNAMIC 值不含中文');
  const values = Object.values(EN);
  for (const k of ['main 与 dev 的汇聚点（merge-base）', 'main ∩ dev 汇聚点']) {
    assert.equal(values.filter((v) => v === EN[k]).length, 1, `EN 值唯一（无重复）：${k}`);
  }
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  ${String(e && e.message ? e.message : e).split('\n').join('\n  ')}`);
  }
}
console.log(`\n${cases.length} 用例，失败 ${failed}`);
process.exit(failed ? 1 : 0);
