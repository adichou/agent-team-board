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

t('B2 branchSearchLog 双模式与分页 offset>0 页均附 parents', () => {
  const { root, c0, c1, c2, c3 } = mkMergeRepo();
  // REQ-20260921-002：highlight 模式数据集不变 + 全量命中清单（过滤语义见 req-20260921-002 B 组）
  const s = buildGit.branchSearchLog(root, 'main', { q: 'feature', mode: 'highlight' });
  assert.deepEqual([...s.matchedHashes].sort(), [c1, c3].sort(), '命中 merge 与 feature 提交（清单）');
  for (const c of s.commits) assert.ok(Array.isArray(c.parents), '数据集行同样附 parents 数组');
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

/* ---------- G 组：treeData 纯函数（REQ-20260921-002 渲染层升级 @gitgraph/js 后的适配层；
   原 logGraph 轨道布局断言随自研行内 SVG 移除，拓扑正确性改由 parents 保真 + 集合内截断承载） ---------- */

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
    setTimeout: () => 0, clearTimeout: () => {},
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
  hash: H(i), short: H(i).slice(0, 7), parents, subject, author: 'T', date: '2026-09-20T00:00:00.000Z', tags: [],
});

t('G1 treeData 线性历史：parents 全保真（主线直下由 gitgraph 泳道表达）、无合并标记', () => {
  const ATB = loadBuild();
  const commits = [sc(3, [H(2)]), sc(2, [H(1)]), sc(1, [])];
  const d = ATB.treeData(commits, { heads: [], branchName: 'main' });
  assert.equal(d.length, 3, '节点数=提交数');
  assert.deepEqual([...d[0].parents], [H(2)], '真实父边保真（不虚构 / 不丢）');
  assert.deepEqual([...d[1].parents], [H(1)]);
  assert.deepEqual([...d[2].parents], [], '根提交无父');
  assert.ok(d.every((x) => x.mergeParents === undefined), '无合并标记');
});

t('G2 treeData 两父合并：双父完整保留并标记 mergeParents（分支轨道分出汇回由 gitgraph 渲染）', () => {
  const ATB = loadBuild();
  // demo 结构：M=[B,C]；C=[D]；D=[E]；B=[E]；E=[]（新→旧：M,C,D,B,E）
  const commits = [sc(1, [H(2), H(3)], '合并 feature'), sc(3, [H(4)], 'feature 提交'), sc(4, [H(5)]), sc(2, [H(5)], 'main 提交'), sc(5, [], '共同祖先')];
  const d = ATB.treeData(commits, { heads: [], branchName: 'main' });
  assert.equal(d.length, 5);
  const by = new Map(d.map((x) => [x.hash, x]));
  assert.equal(by.get(H(1)).mergeParents, 2, '合并行标记双父');
  assert.deepEqual([...by.get(H(1)).parents], [H(2), H(3)], '两父保真');
  assert.equal(by.get(H(2)).mergeParents, undefined, '普通提交不误标合并');
  assert.deepEqual([...by.get(H(5)).parents], [], '根行无父');
  assert.equal(new Set(d.map((x) => x.hash)).size, 5, '同页不重复节点');
});

t('G3 treeData 多父（octopus 4 父）：四父保真 + mergeParents=4', () => {
  const ATB = loadBuild();
  const commits = [sc(1, [H(2), H(3), H(4), H(5)], '四父合并'), sc(5, [H(6)]), sc(4, [H(6)]), sc(3, [H(6)]), sc(2, [H(6)]), sc(6, [])];
  const d = ATB.treeData(commits, { heads: [], branchName: 'main' });
  const by = new Map(d.map((x) => [x.hash, x]));
  assert.deepEqual([...by.get(H(1)).parents], [H(2), H(3), H(4), H(5)], '四父不丢');
  assert.equal(by.get(H(1)).mergeParents, 4);
});

t('G4 treeData 已删除分支可达历史：分支提交与父边仍完整（不丢父、不丢节点）', () => {
  const ATB = loadBuild();
  // 与 G2 同构：feature 分支删除后，其提交（3、4）仍在 main 可达历史中
  const commits = [sc(1, [H(2), H(3)], '合并 feature'), sc(3, [H(4)], 'feature 提交'), sc(4, [H(5)]), sc(2, [H(5)], 'main 提交'), sc(5, [], '共同祖先')];
  const d = ATB.treeData(commits, { heads: [], branchName: 'main' });
  const by = new Map(d.map((x) => [x.hash, x]));
  assert.equal(d.filter((x) => [H(3), H(4)].includes(x.hash)).length, 2, '已删除分支的提交仍逐节点保留');
  assert.deepEqual([...by.get(H(1)).parents], [H(2), H(3)], '合并行父边不因分支删除而丢失');
});

t('G5 treeData 搜索断档：集合外父截断（不外连误画）；集合内父保真（REQ-20260921-002 过滤模式闭包保证连通）', () => {
  const ATB = loadBuild();
  // 搜索命中 [M, C, E]（B、D 不在展示集合）：M 的父 B、C 的父 D 不在集合
  const commits = [sc(1, [H(2), H(3)], '合并 feature'), sc(3, [H(4)], 'feature 提交'), sc(5, [], '共同祖先')];
  const d = ATB.treeData(commits, { heads: [], branchName: 'main' });
  const by = new Map(d.map((x) => [x.hash, x]));
  assert.deepEqual([...by.get(H(1)).parents], [H(3)], '集合内父 C 保真、集合外父 B 截断（不误连）');
  assert.deepEqual([...by.get(H(3)).parents], [], 'C 行集合外父 D 截断（不与 E 误连）');
  assert.deepEqual([...by.get(H(5)).parents], [], '根行无父');
  assert.equal(by.get(H(1)).mergeParents, undefined, '截断后单父不标合并');
});

t('G6 treeData 页边界：跨页首行集合外父截断（页边界提示由渲染层补充）；节点唯一', () => {
  const ATB = loadBuild();
  // 第 2 页首行：父提交（H(9)）在上一页未随行加载
  const d = ATB.treeData([sc(8, [H(9)], '跨页首行')], { heads: [], branchName: 'main' });
  assert.deepEqual([...d[0].parents], [], '页边界父提交未加载 → 截断（配合「父提交在后续页」提示，不误画）');
  // 同一输入去重防御：treeData 不制造重复节点
  const d2 = ATB.treeData([sc(1, [H(2)]), sc(2, [])], { heads: [], branchName: 'main' });
  assert.equal(new Set(d2.map((x) => x.hash)).size, d2.length, '节点唯一');
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

// 提交记录桩：num<total 时父为 num+1（合成链，页边界天然断档）；q 双模式（REQ-20260921-002）：
// highlight = 默认分页数据 + 全量命中清单；filter（默认）= 匹配 ∪ 祖先闭包（链 ⇒ 最老匹配..total）。
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
      const mode = String(up.searchParams.get('mode') || 'filter') === 'highlight' ? 'highlight' : 'filter';
      const mk = (num) => ({
        hash: H(num), short: H(num).slice(0, 7),
        subject: num === 120 ? 'fix: 跨页关键词 REQ-OLD-1201' : `提交 ${num}`,
        author: 'T', date: '2026-09-20T00:00:00.000Z',
        parents: num < total_ ? [H(num + 1)] : [],
        tags: [],
      });
      const pageOf = (list) => list.slice(offset, offset + limit);
      if (!q) {
        const n = Math.max(0, Math.min(limit, total_ - offset));
        return {
          ok: true,
          json: async () => ({ branch: up.searchParams.get('branch'), commits: Array.from({ length: n }, (_, i) => mk(offset + i + 1)), total: total_, limit, offset }),
        };
      }
      const matched = [];
      for (let num = 1; num <= total_; num++) {
        const c = mk(num);
        if (`${c.subject}\t${c.author}\t${c.short}\t${c.hash}`.toLowerCase().includes(q)) matched.push(num);
      }
      if (mode === 'highlight') {
        const n = Math.max(0, Math.min(limit, total_ - offset));
        return {
          ok: true,
          json: async () => ({
            branch: up.searchParams.get('branch'), query: up.searchParams.get('q').trim(), mode: 'highlight',
            commits: Array.from({ length: n }, (_, i) => mk(offset + i + 1)),
            total: total_, matchedHashes: matched.map((num) => H(num)), matchedTotal: matched.length, limit, offset,
          }),
        };
      }
      const oldest = matched.length ? Math.min(...matched) : null;
      const kept = oldest == null ? [] : Array.from({ length: total_ - oldest + 1 }, (_, i) => mk(oldest + i));
      return {
        ok: true,
        json: async () => ({
          branch: up.searchParams.get('branch'), query: up.searchParams.get('q').trim(), mode: 'filter',
          commits: pageOf(kept), total: kept.length, matchedTotal: matched.length, allTotal: total_, limit, offset,
        }),
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

t('R1 渲染：树容器 + 行节点按钮（data-log-row，vendor 缺失降级列表）；节点数=提交数；合并行文字标签', async () => {
  const h = setup();
  graphStub(h, ST, { total: 3 });
  const inner = await branchesView(h);
  const html = inner();
  assert.match(html, /id="bldTreeBox"/, '提交树容器（REQ-20260921-002：vendor 在位时 bindCommon 后画 gitgraph 树）');
  assert.equal((html.match(/data-log-row="/g) || []).length, 3, '每行一个节点按钮（节点数=提交数）');
  // 合并行标签：手写含 merge 的 payload
  const h2 = setup();
  h2.sandbox.__branches = { isRepo: true, current: 'dev', local: ['dev'], remote: [] };
  h2.sandbox.fetch = async (url) => {
    const up = new URL(String(url), 'http://local');
    if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(ST)) };
    if (up.pathname === '/api/build/branches') return { ok: true, json: async () => JSON.parse(JSON.stringify(h2.sandbox.__branches)) };
    if (up.pathname === '/api/build/branch-log') {
      return { ok: true, json: async () => ({ branch: 'dev', commits: [
        { hash: H(1), short: H(1).slice(0, 7), subject: '合并 feature', author: 'T', date: '2026-09-20T00:00:00.000Z', parents: [H(2), H(3)], tags: [] },
        { hash: H(3), short: H(3).slice(0, 7), subject: 'feature 提交', author: 'T', date: '2026-09-20T00:00:00.000Z', parents: [H(4)], tags: [] },
        { hash: H(2), short: H(2).slice(0, 7), subject: 'main 提交', author: 'T', date: '2026-09-20T00:00:00.000Z', parents: [H(4)], tags: [] },
        { hash: H(4), short: H(4).slice(0, 7), subject: '根', author: 'T', date: '2026-09-20T00:00:00.000Z', parents: [], tags: [] },
      ], total: 4, limit: 50, offset: 0 }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  const inner2 = await branchesView(h2);
  const html2 = inner2();
  assert.match(html2, /合并 · 2 父提交/, '合并行有非颜色文字标签');
  assert.equal((html2.match(/data-log-row="/g) || []).length, 4, '合并图节点数=提交数');
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

t('R3 过滤模式祖先闭包：跨页命中保留集含全部祖先（无断线断档语义）；清除恢复', async () => {
  const h = setup();
  graphStub(h, ST, { total: 137 });
  await branchesView(h);
  const inner = () => h.run(`document.querySelector('#buildView').innerHTML`);
  // 搜 REQ-OLD-1201（filter 模式）→ 命中 1 条；闭包沿链收敛 #120..#137 共 18 条（含祖先）
  h.run(`window.ATBBuild.setLogSearchMode('filter')`);
  await new Promise((r) => setTimeout(r, 10));
  const el = (sel) => h.run(`document.querySelector('#buildView').querySelector(${JSON.stringify(sel)})`);
  const input = el('#bldLogSearchInput');
  input.value = 'REQ-OLD-1201';
  input.listeners.input();
  el('#bldLogSearchGo').listeners.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.match(inner(), /匹配 1 条 · 保留 18\/137 条（含祖先，泳道连通）/, '过滤计数（匹配 + 闭包保留集）');
  assert.equal((inner().match(/data-log-row="/g) || []).length, 18, '保留集逐节点展示（不断线）');
  assert.ok(!/搜索已隐藏中间提交/.test(inner()), '闭包保留后无「隐藏中间提交」断档说明');
  // 清除恢复：回默认全量第一页
  h.run(`window.ATBBuild.clearLogSearch()`);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((inner().match(/data-log-row="/g) || []).length, 50, '清除恢复默认分页首页');
});

t('R4 页边界：未到末页显示延续提示；末页不显示提示（页外父截断由 treeData 承载，不误画）', async () => {
  const h = setup();
  graphStub(h, ST, { total: 137 });
  await branchesView(h);
  const inner = () => h.run(`document.querySelector('#buildView').innerHTML`);
  // 第 1 页（共 3 页）：最老行父提交在下一页 → 延续提示（父截断不画向页外，见 G6）
  assert.match(inner(), /父提交在后续页，轨道继续/, '非末页显示延续提示');
  // 末页：不再显示延续提示
  h.run(`window.ATBBuild.gotoLogPage(3)`);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(!/父提交在后续页，轨道继续/.test(inner()), '末页无延续提示');
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
  // 搜索无结果（filter 模式：highlight 无命中数据集不变，不出空态）
  h2.sandbox.__logFail = false;
  h2.run(`window.ATBBuild.setLogSearchMode('filter')`);
  await new Promise((r) => setTimeout(r, 10));
  const el = (sel) => h2.run(`document.querySelector('#buildView').querySelector(${JSON.stringify(sel)})`);
  const input = el('#bldLogSearchInput');
  input.value = 'zzz-no-hit';
  input.listeners.input();
  el('#bldLogSearchGo').listeners.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.match(h2.run(`document.querySelector('#buildView').innerHTML`), /没有匹配的提交（关键词：zzz-no-hit）/, '搜索无结果口径');
});

/* ---------- S 组：样式契约 ---------- */

t('S1 style.css：轨道调色板浅 / 深两套 + 树容器 / 行按钮 / 合并标签 / 详情区样式', () => {
  assert.equal((css.match(/--git-lg0:/g) || []).length, 2, '调色板变量浅色与深色各定义一次（降级标签与树色板同源）');
  assert.match(css, /\.bld-tree/, '提交树容器样式（REQ-20260921-002）');
  assert.match(css, /\.bld-log-row/, '行节点按钮样式');
  assert.match(css, /\.bld-merge-tag/, '合并标签样式');
  assert.match(css, /\.bld-log-detail/, '选择详情区样式');
});

t('S2 build.js 静态契约：treeData 纯函数导出 + bindCommon 绑定 data-log-row（click / focus）与树挂载', () => {
  assert.match(buildJs, /function treeData\(/, 'treeData 纯函数（git2json 适配）');
  assert.match(buildJs, /treeData,/, '经 window.ATBBuild 导出（测试接缝）');
  assert.match(buildJs, /function mountTree\(/, 'mountTree 树挂载入口');
  assert.match(buildJs, /view\.querySelectorAll\('\[data-log-row\]'\)/, 'bindCommon 循环绑定节点按钮');
  assert.match(buildJs, /selectLogRow/, '选择行为接缝');
});

/* ---------- I 组：i18n 中英同步 ---------- */

t('I1 i18n：拓扑图文案（REQ-20260921-002 树化后保留口径）进 EN / EN_DYNAMIC（值无中文、静态值唯一；虚线断档词条已清理）', async () => {
  await import('../web/i18n.js');
  const I = globalThis.ATBI18N;
  const { EN, EN_DYNAMIC } = I._dict;
  for (const k of ['父提交：', '无父提交（根提交）', '父提交在后续页，轨道继续；此处不是历史起点。']) {
    assert.ok(EN[k], `EN 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN[k]), `EN 值不含中文：${k}`);
  }
  for (const k of ['合并 · ◇ 父提交']) {
    assert.ok(EN_DYNAMIC[k], `EN_DYNAMIC 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN_DYNAMIC[k]), `EN_DYNAMIC 值不含中文：${k}`);
  }
  const values = Object.values(EN);
  for (const k of ['父提交：', '无父提交（根提交）', '父提交在后续页，轨道继续；此处不是历史起点。']) {
    assert.equal(values.filter((v) => v === EN[k]).length, 1, `EN 值唯一（无重复）：${k}`);
  }
  // REQ-20260921-002：过滤模式闭包保留（无断线）后虚线断档语义清理，词条不再存在
  assert.ok(!('搜索已隐藏中间提交：虚线不表示直接父子关系。' in EN), '旧断档说明词条已清理');
  assert.ok(!('◇ 个父提交未显示（虚线延续）' in EN_DYNAMIC), '旧隐藏父提交词条已清理');
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
