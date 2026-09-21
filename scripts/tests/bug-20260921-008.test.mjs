#!/usr/bin/env node
// BUG-20260921-008 main 分支的提交历史只显示 main 分支的（单支口径），不再与 dev 并集显示
// —— 回退 BUG-20260920-002 为 main 引入的 main∪dev 双支并集：branchLog / branchSearchLog
//   对所有分支（含主分支 main / master 回退）一律单支可达集合（等价 git log <branch>），
//   响应不再附 heads / mergeBase / side。BUG-20260921-006（dev 单支）口径保持零回归。
// —— B 组：build-git 真实临时仓库（main 单支 / dev 零回归 / 搜索双模式 / 分页 /
//   dev 已全并入型 / 无共同祖先 / master 回退）；R 组：vm 渲染（main 单支载荷不出并集专属
//   UI：无并集提示 / 无分支头标签 / 无 Merge-base 标注，与其他单支分支一致）。
// 用法：node scripts/tests/bug-20260921-008.test.mjs

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

function mkTmp(prefix = 'atb-bug-20260921-008-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function commit(root, file, msg) {
  tick += 10;
  const at = `2026-09-21T02:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')} +0000`;
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
const logOf = (root, ...refs) => git(root, ['log', ...refs, '--format=%H']).stdout.split('\n').map((s) => s.trim()).filter(Boolean);

// 并行型：main = [m0, m1, m2]，dev = [m0, m1, d0, d1]（merge-base = m1）——两支各有独有提交
function mkParallelRepo() {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  const m0 = commit(root, 'm0.md', 'chore: 初始化');
  const m1 = commit(root, 'm1.md', 'docs: main 甲');
  git(root, ['switch', '-q', '-c', 'dev']);
  const d0 = commit(root, 'd0.md', 'feat: dev 提交甲');
  const d1 = commit(root, 'd1.md', 'feat: dev 提交乙');
  git(root, ['switch', '-q', 'main']);
  const m2 = commit(root, 'm2.md', 'docs: main 乙');
  return { root, m0, m1, m2, d0, d1 };
}

// 已合并型：dev 全部并入 main（--no-ff）——main 经合并提交可达 d0
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

/* ---------- B 组：后端 main 单支口径 ---------- */

t('B1 branchLog main 单支：集合与次序 = git log main，total = main 可达数，不含 dev 独有提交，响应无 heads / mergeBase / side', () => {
  const { root, m0, m1, m2, d0, d1 } = mkParallelRepo();
  const r = buildGit.branchLog(root, 'main', { limit: 50 });
  assert.equal(r.branch, 'main');
  assert.equal(r.total, 3, 'total = git rev-list --count main（本仓库 3，非并集 5）');
  assert.deepEqual(r.commits.map((c) => c.hash), logOf(root, 'main'), '集合与次序 = git log main');
  assert.ok(!r.commits.some((c) => c.hash === d0 || c.hash === d1), 'dev 独有提交不出现在 main 视图');
  const hashes = r.commits.map((c) => c.hash);
  for (const h of [m0, m1, m2]) assert.ok(hashes.includes(h), `main 视图含 main 可达提交 ${h.slice(0, 7)}`);
  assert.ok(!('heads' in r) && !('mergeBase' in r), 'main 单支响应不带 heads / mergeBase');
  assert.ok(r.commits.every((c) => !('side' in c)), 'main 单支响应不带 side');
  for (const c of r.commits) {
    assert.ok(Array.isArray(c.parents), 'parents 字段保留（REQ-20260920-001 口径不回退）');
    assert.ok(Array.isArray(c.tags), 'tags 字段保留（REQ-20260921-002 口径不回退）');
    assert.ok(c.short && c.author && c.date && typeof c.subject === 'string');
  }
});

t('B2 dev 单支零回归：BUG-20260921-006 口径保持（dev 可达 4 条，不含 main 独有 m2，无并集字段）', () => {
  const { root, m2 } = mkParallelRepo();
  const r = buildGit.branchLog(root, 'dev', { limit: 50 });
  assert.equal(r.branch, 'dev');
  assert.equal(r.total, 4, 'dev total = dev 可达数');
  assert.deepEqual(r.commits.map((c) => c.hash), logOf(root, 'dev'), 'dev 集合与次序 = git log dev');
  assert.ok(!r.commits.some((c) => c.hash === m2), 'main 独有提交不混入 dev 视图');
  assert.ok(!('heads' in r) && !('mergeBase' in r), 'dev 响应不带 heads / mergeBase');
});

t('B3 main 搜索：数据集 = main 单支（dev 专属主题零命中；选中分支名命中全量）；highlight 数据集与默认分页一致', () => {
  const { root } = mkParallelRepo();
  // dev 独有主题在 main 数据集中零命中（filter 保留集为空）
  const f = buildGit.branchSearchLog(root, 'main', { q: 'dev 提交', mode: 'filter', limit: 50 });
  assert.equal(f.branch, 'main');
  assert.equal(f.matchedTotal, 0, 'dev 独有主题零命中（不再经 heads/side 语义混入）');
  assert.equal(f.total, 0);
  assert.deepEqual(f.commits, []);
  assert.ok(!('heads' in f) && !('mergeBase' in f), 'main 搜索响应不带 heads / mergeBase');
  // 搜「dev」（另一支分支名）：单支口径下不再按 heads 名命中 side（main 侧 subject/author/hash 均不含）→ 零命中
  const fbn = buildGit.branchSearchLog(root, 'main', { q: 'dev', mode: 'filter', limit: 50 });
  assert.equal(fbn.matchedTotal, 0, '另一支分支名不再作为 main 搜索的命中语义');
  // 搜「main」（选中分支名）：分支名命中 ⇒ 当前分支全部提交匹配（既有口径保留）
  const hb = buildGit.branchSearchLog(root, 'main', { q: 'main', mode: 'highlight', limit: 50 });
  assert.equal(hb.matchedTotal, 3, '选中分支名命中 main 单支全部');
  assert.equal(hb.total, 3, 'total = main 单支全量（分页条按单支计数）');
  // highlight 数据集 = 默认分页（main 单支）
  const def = buildGit.branchLog(root, 'main', { limit: 50 });
  const h = buildGit.branchSearchLog(root, 'main', { q: 'main 乙', mode: 'highlight', limit: 50 });
  assert.deepEqual(h.commits.map((c) => c.hash), def.commits.map((c) => c.hash), 'highlight 数据集与默认 main 分页一致');
  assert.equal(h.matchedTotal, 1, 'main 独有主题命中 1 条');
  assert.ok(h.commits.every((c) => !('side' in c)), '搜索响应不带 side');
});

t('B4 main 分页：limit/offset 在 main 单支上拼回完整序列；空白 q 走默认单支分页', () => {
  const { root } = mkParallelRepo();
  const expect = logOf(root, 'main');
  const pages = [];
  for (let off = 0; off < 3; off += 2) {
    const p = buildGit.branchLog(root, 'main', { limit: 2, offset: off });
    assert.equal(p.total, 3, `offset=${off} 各页 total 一致（单支）`);
    assert.ok(!('heads' in p), '分页响应不带 heads');
    pages.push(...p.commits);
  }
  assert.deepEqual(pages.map((c) => c.hash), expect, '分页拼回 = 完整 main 单支序列');
  const blank = buildGit.branchSearchLog(root, 'main', { q: '   ', mode: 'filter', limit: 50 });
  assert.equal(blank.mode, undefined, 'q 空白走 branchLog 默认分页（无 mode 字段）');
  assert.equal(blank.total, 3, '空白关键词 total = main 单支数');
  assert.ok(!('heads' in blank), '空白关键词响应不带 heads');
});

t('B5 dev 已全并入 main（合并提交型）：main 视图 = main 可达 3 条（含经合并提交可达的 d0），无并集字段', () => {
  const { root, m0, d0, M } = mkMergedRepo();
  const r = buildGit.branchLog(root, 'main', { limit: 50 });
  assert.equal(r.total, 3, 'main = m0 / d0 / 合并提交（git log main 可达，含已合并的 dev 提交）');
  assert.deepEqual(r.commits.map((c) => c.hash), logOf(root, 'main'), '集合与次序 = git log main');
  assert.ok(r.commits.some((c) => c.hash === M), '合并提交在 main 视图（--no-ff 口径）');
  assert.ok(r.commits.some((c) => c.hash === d0), '已并入的 dev 提交经合并提交可达，自然出现在 main 视图');
  assert.ok(r.commits.some((c) => c.hash === m0));
  assert.ok(!('heads' in r) && !('mergeBase' in r), 'main 响应不带 heads / mergeBase');
  assert.ok(r.commits.every((c) => !('side' in c)), 'main 响应不带 side');
});

t('B6 无共同祖先（不相关历史 dev）：main 视图仅 main 可达 1 条，读取不报错、无 mergeBase', () => {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  const m0 = commit(root, 'a.md', 'chore: 初始化 main');
  const tree = git(root, ['rev-parse', 'main^{tree}']).stdout.trim();
  const orphan = git(root, ['commit-tree', tree, '-m', 'chore: 孤立 dev 根']).stdout.trim();
  git(root, ['update-ref', 'refs/heads/dev', orphan]);
  const r = buildGit.branchLog(root, 'main', { limit: 50 });
  assert.equal(r.total, 1, 'main 只显示 main 可达（孤立 dev 提交不混入）');
  assert.deepEqual(r.commits.map((c) => c.hash), [m0]);
  assert.ok(!('mergeBase' in r), '无 mergeBase 字段（不虚构汇聚点）');
  assert.ok(!('heads' in r));
});

t('B7 主分支 master 回退仓库：master 同样单支口径（不含 dev 独有），无并集字段', () => {
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
  assert.ok(!('heads' in r) && !('mergeBase' in r), 'master 单支响应不带并集字段');
  assert.ok(r.commits.every((c) => !('side' in c)), 'master 单支响应不带 side');
});

/* ---------- R 组：vm 渲染（main 单支载荷无并集专属 UI） ---------- */

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
    setTimeout: () => 0, clearTimeout: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  return { sandbox, run: (code) => vm.runInContext(code, sandbox) };
}

function logStub(h, payload) {
  h.sandbox.__branches = { isRepo: true, current: 'dev', local: ['dev', 'main'], remote: [] };
  h.sandbox.fetch = async (url) => {
    const up = new URL(String(url), 'http://local');
    if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(ST)) };
    if (up.pathname === '/api/build/branches') return { ok: true, json: async () => JSON.parse(JSON.stringify(h.sandbox.__branches)) };
    if (up.pathname === '/api/build/branch-log') return { ok: true, json: async () => JSON.parse(JSON.stringify(payload)) };
    return { ok: true, json: async () => ({}) };
  };
}

const H = (i) => i.toString(16).padStart(4, '0').repeat(10);
const sc = (i, parents = [], subject = `提交 ${i}`) => ({
  hash: H(i), short: H(i).slice(0, 7), parents, subject, author: 'T', date: '2026-09-21T00:00:00.000Z', tags: [],
});

async function branchesView(h, branch = 'main') {
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.setTab('branches')`);
  await new Promise((r) => setTimeout(r, 10));
  h.run(`window.ATBBuild.selectBranch(${JSON.stringify(branch)})`);
  await new Promise((r) => setTimeout(r, 10));
  return () => h.run(`document.querySelector('#buildView').innerHTML`);
}

t('R1 main 单支载荷渲染：无并集提示 / 无分支头标签（含 dev 标签）/ 无 Merge-base 标注 / 无汇聚点详情（与其他单支分支一致）', async () => {
  const h = setup();
  // main 单支载荷（修复后 branchLog main 的真实形态：无 heads / mergeBase / side）
  logStub(h, {
    branch: 'main', total: 3, limit: 50, offset: 0,
    commits: [sc(2, [H(5)], 'docs: main 乙'), sc(5, [H(6)], '共享历史'), sc(6, [], '根')],
  });
  const inner = await branchesView(h, 'main');
  const html = inner();
  assert.equal((html.match(/data-log-row="/g) || []).length, 3, '节点数 = main 单支提交数');
  assert.ok(!/并集视图/.test(html), 'main 视图无并集提示');
  assert.ok(!/bld-branch-tag/.test(html), 'main 视图无分支头标签（含 dev 标签）');
  assert.ok(!/Merge-base/.test(html), 'main 视图无汇聚标注');
  // 选中共享历史提交（并集模式下会标 merge-base 的位置）不出「main ∩ dev 汇聚点」
  h.run(`window.ATBBuild.selectLogRow(${JSON.stringify(H(5))})`);
  assert.ok(!/main ∩ dev 汇聚点/.test(inner()), 'main 视图详情区无汇聚点标注');
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
