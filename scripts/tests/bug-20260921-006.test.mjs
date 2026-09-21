#!/usr/bin/env node
// BUG-20260921-006 分支浏览 dev 只显示 dev 可达提交（dev 单支口径；BUG-20260921-008 起
// main 同为单支口径——B2/B6/B7 的 main 侧断言随之同步为单支）
// —— B 组：build-git 真实临时仓库（dev 单支 / 无并集载荷字段 / main 不回归 / 搜索双模式 /
//   分页 / master 回退 / dev 已全并入 main 型）；R 组：vm 渲染（dev 单支载荷不出并集专属
//   UI：无并集提示 / 无 main 分支头标签 / 无 Merge-base 标注，与其他单支分支一致）。
// 用法：node scripts/tests/bug-20260921-006.test.mjs

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

function mkTmp(prefix = 'atb-bug-20260921-006-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function commit(root, file, msg) {
  tick += 10;
  const at = `2026-09-21T01:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')} +0000`;
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

// 已合并型：dev 全部并入 main（--no-ff）——main 上存在 dev 不可达的合并提交
function mkMergedRepo() {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  const m0 = commit(root, 'm0.md', 'chore: 初始化');
  git(root, ['switch', '-q', '-c', 'dev']);
  const d0 = commit(root, 'd0.md', 'feat: dev 提交甲');
  git(root, ['switch', '-q', 'main']);
  git(root, ['merge', '--no-ff', '-q', '-m', 'build: 合并 REQ-1（BLD-1）', 'dev']);
  return { root, m0, d0, M: revOf(root, 'HEAD') };
}

/* ---------- B 组：后端 dev 单支口径 ---------- */

t('B1 branchLog dev 单支：集合与次序 = git log dev，total = dev 可达数，不含 main 独有提交，响应无 heads / mergeBase / side', () => {
  const { root, m2 } = mkParallelRepo();
  const r = buildGit.branchLog(root, 'dev', { limit: 50 });
  assert.equal(r.branch, 'dev');
  assert.equal(r.total, 4, 'total = git rev-list --count dev（本仓库 4，非并集 5）');
  assert.deepEqual(r.commits.map((c) => c.hash), logOf(root, 'dev'), '集合与次序 = git log dev');
  assert.ok(!r.commits.some((c) => c.hash === m2), 'main 独有提交（m2）不出现在 dev 视图');
  assert.ok(!('heads' in r) && !('mergeBase' in r), 'dev 单支响应不带 heads / mergeBase');
  assert.ok(r.commits.every((c) => !('side' in c)), 'dev 单支响应不带 side');
  for (const c of r.commits) {
    assert.ok(Array.isArray(c.parents), 'parents 字段保留（REQ-20260920-001 口径不回退）');
    assert.ok(Array.isArray(c.tags), 'tags 字段保留（REQ-20260921-002 口径不回退）');
    assert.ok(c.short && c.author && c.date && typeof c.subject === 'string');
  }
});

t('B2 main 单支（BUG-20260921-008 同口径）：选中 main 只显示 main 可达提交（total 3），无 heads / mergeBase / side', () => {
  const { root, m1, m2 } = mkParallelRepo();
  const r = buildGit.branchLog(root, 'main', { limit: 50 });
  assert.equal(r.branch, 'main');
  assert.equal(r.total, 3, 'main = main 可达总数（rev-list --count main）');
  assert.deepEqual(r.commits.map((c) => c.hash), logOf(root, 'main'), 'main 集合与次序 = git log main');
  assert.ok(r.commits.some((c) => c.hash === m2) && r.commits.some((c) => c.hash === m1), 'main 可达提交齐全');
  assert.ok(!('heads' in r) && !('mergeBase' in r), 'main 单支响应不带 heads / mergeBase');
  assert.ok(r.commits.every((c) => !('side' in c)), 'main 单支响应不带 side');
});

t('B3 dev 搜索 filter：匹配与闭包数据集均为 dev 单支（作者全命中 4 条；main 独有主题零命中）', () => {
  const { root } = mkParallelRepo();
  // 作者 't' 命中 dev 全部 4 条；闭包 = 全量 dev
  const s = buildGit.branchSearchLog(root, 'dev', { q: 't', mode: 'filter', limit: 50 });
  assert.equal(s.branch, 'dev');
  assert.equal(s.matchedTotal, 4, '作者命中 dev 可达全部（不含 main 独有 m2）');
  assert.equal(s.total, 4, '保留集 = dev 单支全量');
  assert.equal(s.allTotal, 4, '全量数据集 = dev 单支（非并集 5）');
  assert.ok(!('heads' in s) && !('mergeBase' in s), 'dev 搜索响应不带 heads / mergeBase');
  // main 独有提交主题（docs: main 乙）在 dev 数据集中不可命中
  const s2 = buildGit.branchSearchLog(root, 'dev', { q: 'main 乙', mode: 'filter', limit: 50 });
  assert.equal(s2.matchedTotal, 0, 'main 独有提交主题在 dev 搜索中零命中');
  assert.deepEqual(s2.commits, []);
  assert.equal(s2.total, 0);
});

t('B4 dev 搜索 highlight：数据集 = dev 单支分页（不过滤），命中清单不含 main 独有提交', () => {
  const { root } = mkParallelRepo();
  const def = buildGit.branchLog(root, 'dev', { limit: 50 });
  const h = buildGit.branchSearchLog(root, 'dev', { q: 'dev 提交', mode: 'highlight', limit: 50 });
  assert.equal(h.mode, 'highlight');
  assert.equal(h.matchedTotal, 2, 'dev 独有两条命中');
  assert.deepEqual(h.commits.map((c) => c.hash), def.commits.map((c) => c.hash), '数据集与默认 dev 分页一致');
  assert.equal(h.total, def.total, 'total = dev 全量数（分页条按单支计数）');
  assert.ok(!('heads' in h) && !('mergeBase' in h), 'highlight 搜索响应同样不带 heads / mergeBase');
  const h2 = buildGit.branchSearchLog(root, 'dev', { q: 'main 乙', mode: 'highlight', limit: 50 });
  assert.deepEqual(h2.matchedHashes, [], 'main 独有主题零命中');
  assert.equal(h2.commits.length, 4, 'highlight 无命中不改变数据集（dev 单支 4 条）');
});

t('B5 dev 分页与空白关键词：limit/offset 在 dev 单支上拼回完整序列；空白 q 走默认单支分页', () => {
  const { root } = mkParallelRepo();
  const expect = logOf(root, 'dev');
  const pages = [];
  for (let off = 0; off < 4; off += 2) {
    const p = buildGit.branchLog(root, 'dev', { limit: 2, offset: off });
    assert.equal(p.total, 4, `offset=${off} 各页 total 一致（单支）`);
    assert.ok(!('heads' in p), '分页响应不带 heads');
    pages.push(...p.commits);
  }
  assert.deepEqual(pages.map((c) => c.hash), expect, '分页拼回 = 完整 dev 单支序列');
  const blank = buildGit.branchSearchLog(root, 'dev', { q: '   ', mode: 'filter', limit: 50 });
  assert.equal(blank.mode, undefined, 'q 空白走 branchLog 默认分页（无 mode 字段）');
  assert.equal(blank.total, 4, '空白关键词 total = dev 单支数');
  assert.ok(!('heads' in blank), '空白关键词响应不带 heads');
});

t('B6 dev 已全并入 main（合并提交型）：dev 视图 = dev 可达 2 条，不含 main 上的合并提交；main 视图 = main 可达（BUG-20260921-008 单支）', () => {
  const { root, M } = mkMergedRepo();
  const d = buildGit.branchLog(root, 'dev', { limit: 50 });
  assert.equal(d.total, 2, 'dev = m0 + d0（merge-base 场景下不含 main 合并提交）');
  assert.ok(!d.commits.some((c) => c.hash === M), '「build: 合并 …」合并提交（dev 不可达）不混入 dev 视图');
  const m = buildGit.branchLog(root, 'main', { limit: 50 });
  assert.equal(m.total, 3, 'main = m0 / d0 / 合并提交（git log main 可达，含经合并提交可达的 dev 提交）');
  assert.ok(!('heads' in m) && !('mergeBase' in m), 'main 单支响应不带 heads / mergeBase');
});

t('B7 主分支 master 回退仓库：dev 同样单支口径；master 亦单支（BUG-20260921-008，不含 dev 独有）', () => {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'master']);
  const c0 = commit(root, 'a.md', 'chore: 初始化');
  git(root, ['switch', '-q', '-c', 'dev']);
  const d0 = commit(root, 'd.md', 'feat: dev 提交甲');
  git(root, ['switch', '-q', 'master']);
  const c1 = commit(root, 'b.md', 'docs: master 甲');
  const d = buildGit.branchLog(root, 'dev', { limit: 50 });
  assert.equal(d.total, 2, 'dev = c0 + d0（不含 master 独有 c1）');
  assert.ok(!('heads' in d) && !('mergeBase' in d), 'dev 单支响应不带并集字段');
  const m = buildGit.branchLog(root, 'master', { limit: 50 });
  assert.equal(m.total, 2, 'master = c0 + c1（不含 dev 独有 d0）');
  assert.ok(!m.commits.some((c) => c.hash === d0), 'dev 独有提交不混入 master 视图');
  assert.ok(!('heads' in m) && !('mergeBase' in m), 'master 单支响应不带并集字段');
});

/* ---------- R 组：vm 渲染（dev 单支载荷无并集专属 UI） ---------- */

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
    setTimeout: () => 0, clearTimeout: {},
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

async function branchesView(h, branch = 'dev') {
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.setTab('branches')`);
  await new Promise((r) => setTimeout(r, 10));
  h.run(`window.ATBBuild.selectBranch(${JSON.stringify(branch)})`);
  await new Promise((r) => setTimeout(r, 10));
  return () => h.run(`document.querySelector('#buildView').innerHTML`);
}

t('R1 dev 单支载荷渲染：无并集提示 / 无 main 分支头标签 / 无 Merge-base 标注 / 无汇聚点详情（与单支分支一致）', async () => {
  const h = setup();
  // dev 单支载荷（修复后 branchLog dev 的真实形态：无 heads / mergeBase / side）
  logStub(h, {
    branch: 'dev', total: 4, limit: 50, offset: 0,
    commits: [sc(1, [H(5)], 'dev 提交乙'), sc(4, [H(5)], 'dev 提交甲'), sc(5, [H(6)], '共享历史'), sc(6, [], '根')],
  });
  const inner = await branchesView(h, 'dev');
  const html = inner();
  assert.equal((html.match(/data-log-row="/g) || []).length, 4, '节点数 = dev 单支提交数');
  assert.ok(!/并集视图/.test(html), 'dev 视图无并集提示');
  assert.ok(!/bld-branch-tag/.test(html), 'dev 视图无分支头标签（含 main 标签）');
  assert.ok(!/Merge-base/.test(html), 'dev 视图无汇聚标注');
  // 选中共享历史提交（并集模式下会标 merge-base 的位置）不出「main ∩ dev 汇聚点」
  h.run(`window.ATBBuild.selectLogRow(${JSON.stringify(H(5))})`);
  assert.ok(!/main ∩ dev 汇聚点/.test(inner()), 'dev 视图详情区无汇聚点标注');
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
