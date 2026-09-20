#!/usr/bin/env node
// REQ-20260920-001 分支浏览 Git 历史拓扑图（合并记录图形化，替代平铺）
// —— B 组：build-git 真实临时仓库 parents 数据（单父 / 双父合并 / octopus / 已删除分支 / 搜索与分页）；
// G 组：logGraph 纯函数轨道布局（线性 / 合并 / 多父 / 断档虚线 / 页边界桩 / 去重）；
// R 组：vm 渲染（图形列 / 合并标签 / 节点选择详情 / 搜索隐藏上下文 / 页边界延续 / 状态回归）；
// S 组：样式契约（轨道调色板深浅色 + 图形列样式）；I 组：i18n 中英同步。
// 用法：node scripts/tests/req-20260920-001.test.mjs

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

function mkTmp(prefix = 'atb-req-20260920-001-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function commit(root, file, msg) {
  tick += 10;
  const at = `2026-09-20T00:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')} +0000`;
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

// 带真实分叉与合并的仓库：main 两次提交 + feature 一条 + --no-ff 合并（合并提交双父）
function mkMergeRepo() {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  const c0 = commit(root, 'a.md', 'chore: 初始化');
  git(root, ['switch', '-q', '-c', 'feature']);
  const c1 = commit(root, 'f.md', 'feat: feature 提交');
  git(root, ['switch', '-q', 'main']);
  const c2 = commit(root, 'm.md', 'docs: main 文档');
  git(root, ['merge', '--no-ff', '-q', '-m', 'merge: 合并 feature', 'feature']);
  return { root, c0, c1, c2, c3: revOf(root, 'HEAD') };
}

// octopus（3 父）仓库：三支各改独立文件后一次 --no-ff 合并
function mkOctopusRepo() {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  const c0 = commit(root, 'a.md', 'chore: 初始化');
  for (const b of ['b1', 'b2', 'b3']) {
    git(root, ['switch', '-q', '-c', b]);
    commit(root, `${b}.md`, `feat: ${b} 提交`);
    git(root, ['switch', '-q', 'main']);
  }
  git(root, ['merge', '--no-ff', '-q', '-m', 'merge: octopus 三父合并', 'b1', 'b2', 'b3']);
  return { root, c0, merge: revOf(root, 'HEAD') };
}

// 已删除分支：合并入 main 后删除 feature，提交仍可达
function mkDeletedBranchRepo() {
  const m = mkMergeRepo();
  git(m.root, ['branch', '-q', '-D', 'feature']);
  return m;
}

/* ---------- B 组：后端 parents 数据 ---------- */

t('B1 branchLog：merge 提交附双父、普通提交单父、根提交空数组；既有字段不破坏', () => {
  const { root, c0, c1, c2, c3 } = mkMergeRepo();
  const r = buildGit.branchLog(root, 'main', { limit: 50 });
  assert.equal(r.total, 4);
  assert.deepEqual(r.commits.map((c) => c.hash), [c3, c2, c1, c0], '时间戳递增保证新→旧稳定');
  assert.deepEqual(r.commits[0].parents, [c2, c1], 'merge 提交双父（第一父 main 前驱、第二父 feature 头）');
  assert.deepEqual(r.commits[1].parents, [c0]);
  assert.deepEqual(r.commits[2].parents, [c0]);
  assert.deepEqual(r.commits[3].parents, [], '根提交 parents 为空数组');
  for (const c of r.commits) {
    assert.equal(typeof c.subject, 'string');
    assert.ok(c.short && c.author && c.date, 'hash/short/author/date 字段保留');
  }
});

t('B2 branchSearchLog 与分页 offset>0 页均附 parents', () => {
  const { root, c0, c1, c2, c3 } = mkMergeRepo();
  const s = buildGit.branchSearchLog(root, 'main', { q: 'feature' });
  assert.deepEqual(s.commits.map((c) => c.hash).sort(), [c1, c3].sort(), '命中 merge 与 feature 提交');
  for (const c of s.commits) assert.ok(Array.isArray(c.parents), '搜索命中同样附 parents 数组');
  const merge = s.commits.find((c) => c.hash === c3);
  assert.deepEqual(merge.parents, [c2, c1], '搜索命中的 merge 提交双父完整');
  const p2 = buildGit.branchLog(root, 'main', { limit: 2, offset: 2 });
  assert.deepEqual(p2.commits.map((c) => c.hash), [c1, c0], '第 2 页两行');
  assert.deepEqual(p2.commits[1].parents, [], '跨页根提交仍如实为空数组（不误判）');
});

t('B3 已删除分支：可达历史 parents 完整（合并关系不丢失）', () => {
  const { root, c1, c2, c3 } = mkDeletedBranchRepo();
  const r = buildGit.branchLog(root, 'main', { limit: 50 });
  const merge = r.commits.find((c) => c.hash === c3);
  assert.deepEqual(merge.parents, [c2, c1], 'feature 分支已删，合并提交仍带双父');
});

t('B4 octopus 多头合并：parents 含 HEAD 与全部三个分支头（共 4 父）', () => {
  const { root, merge } = mkOctopusRepo();
  const r = buildGit.branchLog(root, 'main', { limit: 50 });
  const m = r.commits.find((c) => c.hash === merge);
  assert.equal(m.parents.length, 4, 'octopus 三头合并 = HEAD + 三分支头，4 父全保留');
  assert.equal(new Set(m.parents).size, 4, '四父互不重复');
});

/* ---------- G 组：logGraph 纯函数 ---------- */

// vm 装载 build.js（最小 document 桩，只取导出的纯函数）
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

// 短前缀可区分的 40 位 hash（slice(0,7) 各不相同）
const H = (i) => i.toString(16).padStart(4, '0').repeat(10);
const sc = (i, parents = [], subject = `提交 ${i}`) => ({
  hash: H(i), short: H(i).slice(0, 7), parents, subject, author: 'T', date: '2026-09-20T00:00:00.000Z',
});

t('G1 logGraph 线性历史：全程单轨道、无合并、根行无向下虚构连线', () => {
  const ATB = loadBuild();
  const commits = [sc(3, [H(2)]), sc(2, [H(1)]), sc(1, [])];
  const g = ATB.logGraph(commits);
  assert.equal(g.rows.length, 3, '节点数=提交数');
  assert.ok(g.rows.every((r) => r.lane === 0), '线性历史全部在同一轨道');
  assert.ok(g.rows.every((r) => !r.merge), '无合并节点');
  assert.equal(g.laneCount, 1);
  assert.equal(g.rows[2].segments.length, 0, '根提交无任何向下边（不虚构连线）');
  assert.ok(g.rows[0].segments.some((s) => s.fromNode && !s.dashed), 'HEAD 行有真实父边');
  assert.ok(g.rows.every((r) => !r.stubAbove), '完整视图无上方虚线桩');
});

t('G2 logGraph 两父合并：合并行 2 条真实父边、分支轨道分出并汇回、无假连线', () => {
  const ATB = loadBuild();
  // demo 结构：M=[B,C]；C=[D]；D=[E]；B=[E]；E=[]（新→旧：M,C,D,B,E）
  const commits = [sc(1, [H(2), H(3)], '合并 feature'), sc(3, [H(4)], 'feature 提交'), sc(4, [H(5)]), sc(2, [H(5)], 'main 提交'), sc(5, [], '共同祖先')];
  const g = ATB.logGraph(commits);
  assert.equal(g.rows.length, 5);
  const [rM, , , rB, rE] = g.rows;
  assert.equal(rM.merge, true, '合并标记');
  assert.equal(rM.parentCount, 2);
  const edges = rM.segments.filter((s) => s.fromNode);
  assert.equal(edges.length, 2, '合并行两条真实父边全部画出');
  assert.ok(edges.every((s) => !s.dashed), '父边均为实线');
  assert.deepEqual([...new Set(edges.map((s) => s.x2))].sort(), [0, 1], '两条父边分别落在主线与分支轨道');
  assert.equal(rB.merge, false, '普通提交不误标合并');
  assert.equal(rE.segments.length, 0, '根行无向下边');
  assert.ok(g.rows.every((r) => r.segments.every((s) => !s.dashed)), '完整历史无虚线');
  assert.equal(g.laneCount, 2, '主线 + 一条并行分支轨道');
  assert.equal(new Set(g.rows.map((r) => r.hash)).size, 5, '同页不重复节点');
});

t('G3 logGraph 多父（octopus 4 父）：四条父边全部画出', () => {
  const ATB = loadBuild();
  const commits = [sc(1, [H(2), H(3), H(4), H(5)], '四父合并'), sc(5, [H(6)]), sc(4, [H(6)]), sc(3, [H(6)]), sc(2, [H(6)]), sc(6, [])];
  const g = ATB.logGraph(commits);
  const edges = g.rows[0].segments.filter((s) => s.fromNode);
  assert.equal(edges.length, 4, '四父边不丢');
  assert.ok(edges.every((s) => !s.dashed));
  assert.equal(g.rows[0].parentCount, 4);
  assert.equal(new Set([...edges.map((s) => s.x2)]).size, 4, '四父各落一条轨道');
});

t('G4 logGraph 已删除分支可达历史：分支提交与汇回边仍完整（不丢父边、不丢轨道）', () => {
  const ATB = loadBuild();
  // 与 G2 同构：feature 分支删除后，其提交（3、4）仍在 main 可达历史中
  const commits = [sc(1, [H(2), H(3)], '合并 feature'), sc(3, [H(4)], 'feature 提交'), sc(4, [H(5)]), sc(2, [H(5)], 'main 提交'), sc(5, [], '共同祖先')];
  const g = ATB.logGraph(commits);
  const featRows = g.rows.filter((r) => [H(3), H(4)].includes(r.hash));
  assert.equal(featRows.length, 2, '已删除分支的提交仍逐行展示');
  assert.ok(featRows.every((r) => r.lane === 1), '分支提交保持独立轨道');
  const mergeEdges = g.rows[0].segments.filter((s) => s.fromNode);
  assert.equal(mergeEdges.length, 2, '合并行父边不因分支删除而丢失');
});

t('G5 logGraph 搜索断档：隐藏中间提交不误连实线，父边转虚线并计数', () => {
  const ATB = loadBuild();
  // 搜索命中 [M, C, E]（B、D 被隐藏）：M 的父 B、C 的父 D 不在展示集合
  const commits = [sc(1, [H(2), H(3)], '合并 feature'), sc(3, [H(4)], 'feature 提交'), sc(5, [], '共同祖先')];
  const g = ATB.logGraph(commits);
  const [rM, rC, rE] = g.rows;
  const hiddenEdgesM = rM.segments.filter((s) => s.dashed);
  assert.ok(hiddenEdgesM.length >= 1, 'M 行存在虚线父边（B 隐藏）');
  assert.ok(hiddenEdgesM.every((s) => s.fromNode), '虚线父边从节点出发');
  assert.deepEqual([...rM.hiddenParents], [H(2)], '隐藏父提交如实计数（B）');
  const solidEdgesM = rM.segments.filter((s) => s.fromNode && !s.dashed);
  assert.equal(solidEdgesM.length, 1, '展示中的父 C 仍以实线直连（真实父子才连线）');
  assert.ok(rC.segments.every((s) => s.dashed), 'C 行父边全为虚线（D 隐藏，不与 E 误连实线）');
  assert.deepEqual([...rC.hiddenParents], [H(4)], 'C 行隐藏父 D 计数');
  assert.ok(!rE.stubAbove, '根提交即使行序靠中也不画上方延续桩（它确实是历史起点）');
  assert.equal(rE.segments.length, 0, '根行不虚构向下连线');
});

t('G6 logGraph 页边界：跨页首行有父提交画上方虚线桩（不误判根）；节点唯一', () => {
  const ATB = loadBuild();
  // 第 2 页首行：父提交（H(9)）在上一页未随行加载
  const g = ATB.logGraph([sc(8, [H(9)], '跨页首行')], { hasAbove: true });
  assert.equal(g.rows[0].stubAbove, true, '有父提交且上方上下文未加载 → 上方虚线桩');
  assert.deepEqual([...g.rows[0].hiddenParents], [H(9)], '页边界父提交未加载 → 虚线延续计数');
  // 同一输入去重防御：logGraph 不制造重复节点
  const g2 = ATB.logGraph([sc(1, [H(2)]), sc(2, [])]);
  assert.equal(new Set(g2.rows.map((r) => r.hash)).size, g2.rows.length, '节点唯一');
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

// 提交记录桩：num<total 时父为 num+1（合成链，页边界天然断档）；q 按 subject/author/hash 过滤。
function graphStub(h, st, { total = 137 } = {}) {
  h.sandbox.__branches = { isRepo: true, current: 'dev', local: ['dev', 'main'], remote: [] };
  h.sandbox.__logReqs = [];
  h.sandbox.__logFail = false;
  h.sandbox.__total = total;
  h.sandbox.fetch = async (url) => {
    const up = new URL(String(url), 'http://local');
    if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(st)) };
    if (up.pathname === '/api/build/branches') return { ok: true, json: async () => JSON.parse(JSON.stringify(h.sandbox.__branches)) };
    if (up.pathname === '/api/build/branch-log') {
      h.sandbox.__logReqs.push(up.pathname + up.search);
      if (h.sandbox.__logFail) return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
      const total_ = h.sandbox.__total;
      const limit = Number(up.searchParams.get('limit') || 50);
      const offset = Number(up.searchParams.get('offset') || 0);
      const q = String(up.searchParams.get('q') || '').trim().toLowerCase();
      const mk = (num) => ({
        hash: H(num), short: H(num).slice(0, 7),
        subject: num === 120 ? 'fix: 跨页关键词 REQ-OLD-1201' : `提交 ${num}`,
        author: 'T', date: '2026-09-20T00:00:00.000Z',
        parents: num < total_ ? [H(num + 1)] : [],
      });
      let page;
      let totalOut = total_;
      if (!q) {
        const n = Math.max(0, Math.min(limit, total_ - offset));
        page = Array.from({ length: n }, (_, i) => mk(offset + i + 1));
      } else {
        const matched = [];
        for (let num = 1; num <= total_; num++) {
          const c = mk(num);
          if (`${c.subject}\t${c.author}\t${c.short}\t${c.hash}`.toLowerCase().includes(q)) matched.push(c);
        }
        totalOut = matched.length;
        page = matched.slice(offset, offset + limit);
      }
      return {
        ok: true,
        json: async () => ({ branch: up.searchParams.get('branch'), ...(q ? { query: up.searchParams.get('q').trim() } : {}), commits: page, total: totalOut, limit, offset }),
      };
    }
    return { ok: true, json: async () => ({}) };
  };
}

function setup(st = ST) {
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

async function branchesView(h) {
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.setTab('branches')`);
  await new Promise((r) => setTimeout(r, 10));
  h.run(`window.ATBBuild.selectBranch('dev')`);
  await new Promise((r) => setTimeout(r, 10));
  return () => h.run(`document.querySelector('#buildView').innerHTML`);
}

t('R1 渲染：每行图形列 SVG + 行节点按钮（data-log-row）；节点数=提交数；合并行文字标签', async () => {
  const h = setup();
  graphStub(h, ST, { total: 3 });
  const inner = await branchesView(h);
  const html = inner();
  assert.equal((html.match(/data-log-row="/g) || []).length, 3, '每行一个节点按钮（节点数=提交数）');
  assert.match(html, /<svg[^>]*class="bld-graph"/, '每行左侧固定图形列');
  assert.match(html, /viewBox/, 'SVG 轨道视窗');
  // 合并行标签：手写含 merge 的 payload
  const h2 = setup();
  h2.sandbox.__branches = { isRepo: true, current: 'dev', local: ['dev'], remote: [] };
  h2.sandbox.fetch = async (url) => {
    const up = new URL(String(url), 'http://local');
    if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(ST)) };
    if (up.pathname === '/api/build/branches') return { ok: true, json: async () => JSON.parse(JSON.stringify(h2.sandbox.__branches)) };
    if (up.pathname === '/api/build/branch-log') {
      return { ok: true, json: async () => ({ branch: 'dev', commits: [
        { hash: H(1), short: H(1).slice(0, 7), subject: '合并 feature', author: 'T', date: '2026-09-20T00:00:00.000Z', parents: [H(2), H(3)] },
        { hash: H(3), short: H(3).slice(0, 7), subject: 'feature 提交', author: 'T', date: '2026-09-20T00:00:00.000Z', parents: [H(4)] },
        { hash: H(2), short: H(2).slice(0, 7), subject: 'main 提交', author: 'T', date: '2026-09-20T00:00:00.000Z', parents: [H(4)] },
        { hash: H(4), short: H(4).slice(0, 7), subject: '根', author: 'T', date: '2026-09-20T00:00:00.000Z', parents: [] },
      ], total: 4, limit: 50, offset: 0 }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  const inner2 = await branchesView(h2);
  const html2 = inner2();
  assert.match(html2, /合并 · 2 父提交/, '合并行有非颜色文字标签');
  assert.equal((html2.match(/data-log-row="/g) || []).length, 4, '合并图节点数=提交数');
  assert.ok(!/stroke-dasharray/.test(html2), '完整加载页无断档虚线');
});

t('R2 选择反馈：选中节点 → 详情区显示该提交与父提交标识；根提交显示无父提交；选中行高亮', async () => {
  const h = setup();
  graphStub(h, ST, { total: 3 });
  await branchesView(h);
  const inner = () => h.run(`document.querySelector('#buildView').innerHTML`);
  h.run(`window.ATBBuild.selectLogRow(${JSON.stringify(H(1))})`);
  assert.match(inner(), /bld-log-detail/, '渲染详情区');
  assert.match(inner(), /父提交：/, '详情含父提交说明');
  assert.match(inner(), new RegExp(H(2).slice(0, 7)), '父提交短 hash 出现在详情');
  // 根提交（num=3 为根）
  h.run(`window.ATBBuild.selectLogRow(${JSON.stringify(H(3))})`);
  assert.match(inner(), /无父提交（根提交）/, '根提交详情不虚构父提交');
  assert.match(inner(), /class="bld-log-row sel"/, '选中行高亮');
});

t('R3 搜索隐藏上下文：断档行虚线 + 顶部说明 + 行内提示；清除恢复', async () => {
  const h = setup();
  graphStub(h, ST, { total: 137 });
  await branchesView(h);
  const inner = () => h.run(`document.querySelector('#buildView').innerHTML`);
  // 搜 REQ-OLD-1201 → 仅命中 120，其父 121 不在结果（父子断档）
  const el = (sel) => h.run(`document.querySelector('#buildView').querySelector(${JSON.stringify(sel)})`);
  const input = el('#bldLogSearchInput');
  input.value = 'REQ-OLD-1201';
  input.listeners.input();
  el('#bldLogSearchGo').listeners.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.match(inner(), /搜索已隐藏中间提交/, '顶部隐藏上下文说明');
  assert.match(inner(), /stroke-dasharray/, '断档父边以虚线绘制');
  assert.match(inner(), /个父提交未显示/, '行内隐藏父提交文字说明');
  // 清除恢复：顶部说明消失
  h.run(`window.ATBBuild.clearLogSearch()`);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(!/搜索已隐藏中间提交/.test(inner()), '清除后说明消失');
});

t('R4 页边界：未到末页显示延续提示与虚线；末页不显示提示但跨页首行有上方虚线桩', async () => {
  const h = setup();
  graphStub(h, ST, { total: 137 });
  await branchesView(h);
  const inner = () => h.run(`document.querySelector('#buildView').innerHTML`);
  // 第 1 页（共 3 页）：最老行父提交在下一页 → 延续提示 + 该行虚线父边
  assert.match(inner(), /父提交在后续页，轨道继续/, '非末页显示延续提示');
  assert.match(inner(), /stroke-dasharray/, '页边界行虚线父边（不误画成根）');
  // 末页：不再显示延续提示；首行（上一页延续而来）有上方虚线桩
  h.run(`window.ATBBuild.gotoLogPage(3)`);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(!/父提交在后续页，轨道继续/.test(inner()), '末页无延续提示');
  assert.match(inner(), /stroke-dasharray/, '跨页首行上方虚线桩（有父提交、上下文在上一页）');
});

t('R5 状态回归：空历史 / 翻页失败保留旧内容+重试 / 搜索无结果口径不回归', async () => {
  const h = setup();
  graphStub(h, ST, { total: 0 });
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.setTab('branches')`);
  await new Promise((r) => setTimeout(r, 10));
  h.run(`window.ATBBuild.selectBranch('dev')`);
  await new Promise((r) => setTimeout(r, 10));
  assert.match(h.run(`document.querySelector('#buildView').innerHTML`), /该分支暂无提交/, '空历史口径');
  // 翻页失败保留旧内容 + 重试
  const h2 = setup();
  graphStub(h2, ST, { total: 137 });
  await branchesView(h2);
  h2.sandbox.__logFail = true;
  h2.run(`window.ATBBuild.gotoLogPage(2)`);
  await new Promise((r) => setTimeout(r, 10));
  const html = h2.run(`document.querySelector('#buildView').innerHTML`);
  assert.match(html, /提交 1</, '翻页失败保留第 1 页内容');
  assert.match(html, /提交记录读取失败：boom/, '失败原因展示');
  assert.match(html, /id="bldLogRetry"/, '重试入口');
  // 搜索无结果
  h2.sandbox.__logFail = false;
  const el = (sel) => h2.run(`document.querySelector('#buildView').querySelector(${JSON.stringify(sel)})`);
  const input = el('#bldLogSearchInput');
  input.value = 'zzz-no-hit';
  input.listeners.input();
  el('#bldLogSearchGo').listeners.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.match(h2.run(`document.querySelector('#buildView').innerHTML`), /没有匹配的提交（关键词：zzz-no-hit）/, '搜索无结果口径');
});

/* ---------- S 组：样式契约 ---------- */

t('S1 style.css：轨道调色板浅 / 深两套 + 图形列 / 行按钮 / 合并标签 / 详情区样式', () => {
  assert.equal((css.match(/--git-lg0:/g) || []).length, 2, '调色板变量浅色与深色各定义一次');
  assert.match(css, /\.bld-graph/, '图形列样式');
  assert.match(css, /\.bld-graph \{[^}]*flex-shrink: 0/, '图形列固定不压缩（行对齐前提）');
  assert.match(css, /\.bld-log-row/, '行节点按钮样式');
  assert.match(css, /\.bld-merge-tag/, '合并标签样式');
  assert.match(css, /\.bld-log-detail/, '选择详情区样式');
});

t('S2 build.js 静态契约：logGraph 纯函数导出 + bindCommon 绑定 data-log-row（click / focus）', () => {
  assert.match(buildJs, /function logGraph\(/, 'logGraph 纯函数');
  assert.match(buildJs, /logGraph,/, '经 window.ATBBuild 导出（测试接缝）');
  assert.match(buildJs, /view\.querySelectorAll\('\[data-log-row\]'\)/, 'bindCommon 循环绑定节点按钮');
  assert.match(buildJs, /selectLogRow/, '选择行为接缝');
});

/* ---------- I 组：i18n 中英同步 ---------- */

t('I1 i18n：拓扑图新增文案进 EN / EN_DYNAMIC（值无中文、静态值唯一）', async () => {
  await import('../web/i18n.js');
  const I = globalThis.ATBI18N;
  const { EN, EN_DYNAMIC } = I._dict;
  for (const k of ['父提交：', '无父提交（根提交）', '搜索已隐藏中间提交：虚线不表示直接父子关系。', '父提交在后续页，轨道继续；此处不是历史起点。']) {
    assert.ok(EN[k], `EN 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN[k]), `EN 值不含中文：${k}`);
  }
  for (const k of ['合并 · ◇ 父提交', '◇ 个父提交未显示（虚线延续）']) {
    assert.ok(EN_DYNAMIC[k], `EN_DYNAMIC 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN_DYNAMIC[k]), `EN_DYNAMIC 值不含中文：${k}`);
  }
  const values = Object.values(EN);
  for (const k of ['父提交：', '无父提交（根提交）', '搜索已隐藏中间提交：虚线不表示直接父子关系。', '父提交在后续页，轨道继续；此处不是历史起点。']) {
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
