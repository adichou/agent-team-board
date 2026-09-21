#!/usr/bin/env node
// REQ-20260921-002 分支浏览提交树可视化（@gitgraph/js vendor 渲染）+ 双模式搜索
// —— B 组：build-git 真实临时仓库（tags 附着 / filter 祖先闭包 / highlight 匹配清单 / 分支名与
// tag 匹配 / 双支并集两模式 / 边界回退）；T 组：treeData 纯函数（git2json 适配：refs / 页内截断 /
// 合并标记）；R 组：vm 渲染与交互（fake GitgraphJS 注入走树路径 + 降级列表 + 双模式搜索 UI /
// 计数 / 空态 / 重置 / 深浅色模板）；S 组：vendor 与静态契约；I 组：i18n 中英同步。
// 用法：node scripts/tests/req-20260921-002.test.mjs

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
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- 公共：真实临时 git 仓库夹具 ---------- */

let tick = 0;
function git(root, args, opts = {}) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  if (!opts.canFail && r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r;
}

function mkTmp(prefix = 'atb-req-20260921-002-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function commit(root, file, msg) {
  tick += 10;
  const at = `2026-09-21T00:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')} +0000`;
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

// 带 tag 与分叉合并的仓库：A ← B(tag v0.1.0 lightweight) ← M(merge)；feature: C(←A)。
// 新→旧序（时间戳递增）：M, B, C, A。annotated tag v0.2.0 落在 M。
function mkRepo() {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  const a = commit(root, 'a.md', 'chore: 初始化仓库');
  git(root, ['switch', '-q', '-c', 'feature']);
  const c = commit(root, 'c.md', 'feat: feature 提交 REQ-1');
  git(root, ['switch', '-q', 'main']);
  const b = commit(root, 'b.md', 'docs: 文档补充');
  git(root, ['tag', 'v0.1.0', b]);
  git(root, ['merge', '--no-ff', '-q', '-m', 'merge: 合并 feature', 'feature']);
  const m = revOf(root, 'HEAD');
  git(root, ['tag', '-a', 'v0.2.0', '-m', 'annotated', m]);
  return { root, a, b, c, m };
}

// main + dev 双支并集仓库（BUG-20260920-002 口径）：main: A←B；dev: A←B←D。
function mkDualRepo() {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  const a = commit(root, 'a.md', 'chore: 初始化');
  const b = commit(root, 'b.md', 'docs: 主线文档');
  git(root, ['switch', '-q', '-c', 'dev']);
  const d = commit(root, 'd.md', 'feat: dev 提交 REQ-2');
  return { root, a, b, d };
}

/* ---------- B 组：后端（build-git.mjs） ---------- */

t('B1 tags 附着：lightweight 与 annotated 均按指向 commit 归位；无 tag 为 []；既有字段不破坏', () => {
  const { root, a, b, c, m } = mkRepo();
  const r = buildGit.branchLog(root, 'main', { limit: 50 });
  assert.equal(r.total, 4);
  const by = new Map(r.commits.map((x) => [x.hash, x]));
  assert.deepEqual(by.get(b).tags, ['v0.1.0'], 'lightweight tag 落在指向提交');
  assert.deepEqual(by.get(m).tags, ['v0.2.0'], 'annotated tag 解引用到实际 commit（%(*objectname)）');
  assert.deepEqual(by.get(a).tags, [], '无 tag 提交为空数组');
  assert.deepEqual(by.get(c).tags, [], 'feature 提交无 tag');
  for (const x of r.commits) {
    assert.ok(typeof x.subject === 'string' && x.short && x.author && x.date, '既有字段保留');
    assert.ok(Array.isArray(x.parents), 'parents 保留（REQ-20260920-001）');
  }
});

t('B2 filter 模式（q 默认）：保留集 = 匹配 ∪ 祖先闭包，total=保留集数、matchedTotal=匹配数、allTotal=全量数', () => {
  const { root, a, b, c, m } = mkRepo();
  const r = buildGit.branchSearchLog(root, 'main', { q: 'feature', mode: 'filter', limit: 50 });
  assert.equal(r.mode, 'filter');
  assert.equal(r.matchedTotal, 2, '命中 merge 提交与 feature 提交');
  assert.equal(r.total, 4, '保留集 = 匹配 {M,C} + 祖先 {B,A} = 4');
  assert.equal(r.allTotal, 4, '全量数据集数');
  assert.deepEqual(r.commits.map((x) => x.hash), [m, b, c, a], '保留集保持新→旧原序（泳道连通）');
  for (const x of r.commits) assert.ok(Array.isArray(x.tags), 'filter 命中行同样附 tags');
  // 分页：limit=2 → 前两行 M,B；闭包集上的 offset 分页
  const p = buildGit.branchSearchLog(root, 'main', { q: 'feature', mode: 'filter', limit: 2, offset: 2 });
  assert.deepEqual(p.commits.map((x) => x.hash), [c, a], '闭包保留集上分页');
  assert.equal(p.total, 4);
});

t('B3 highlight 模式：数据集与默认分页一致（不过滤），附 matchedHashes 与 matchedTotal', () => {
  const { root, a, b, c, m } = mkRepo();
  const def = buildGit.branchLog(root, 'main', { limit: 50 });
  const r = buildGit.branchSearchLog(root, 'main', { q: 'feature', mode: 'highlight', limit: 50 });
  assert.equal(r.mode, 'highlight');
  assert.equal(r.matchedTotal, 2);
  assert.deepEqual(r.matchedHashes, [m, c], '全量命中清单（数据集顺序）');
  assert.deepEqual(r.commits.map((x) => x.hash), def.commits.map((x) => x.hash), '数据集与默认分页一致');
  assert.equal(r.total, def.total, 'total 为全量数（分页条正常）');
  // 分页页同样附命中清单（翻页后高亮可延续）
  const p2 = buildGit.branchSearchLog(root, 'main', { q: 'feature', mode: 'highlight', limit: 2, offset: 2 });
  assert.deepEqual(p2.commits.map((x) => x.hash), [c, a]);
  assert.deepEqual(p2.matchedHashes, [m, c], '非首页也返回全量命中清单');
});

t('B4 匹配范围：tag 名 / 分支名（选中分支）/ message / 作者 / hash 忽略大小写', () => {
  const { root, a, b, m } = mkRepo();
  const byTag = buildGit.branchSearchLog(root, 'main', { q: 'V0.1', mode: 'filter', limit: 50 });
  assert.equal(byTag.matchedTotal, 1, 'tag 名忽略大小写命中');
  assert.equal(byTag.total, 2, '闭包含其祖先 A');
  assert.deepEqual(byTag.commits.map((x) => x.hash), [b, a]);
  const byBranch = buildGit.branchSearchLog(root, 'main', { q: 'main', mode: 'highlight', limit: 50 });
  assert.equal(byBranch.matchedTotal, 4, '选中分支名命中 ⇒ 当前分支全部提交匹配');
  const byMsg = buildGit.branchSearchLog(root, 'main', { q: 'REQ-1', mode: 'highlight', limit: 50 });
  assert.equal(byMsg.matchedTotal, 1, 'message 子串命中');
  const byAuthor = buildGit.branchSearchLog(root, 'main', { q: 'T', mode: 'highlight', limit: 50 });
  assert.equal(byAuthor.matchedTotal, 4, '作者命中（既有四字段口径保留）');
  const byHash = buildGit.branchSearchLog(root, 'main', { q: m.slice(0, 7), mode: 'highlight', limit: 50 });
  assert.equal(byHash.matchedTotal, 1, 'hash 命中');
});

t('B5 双支并集：filter / highlight 两模式口径一致（heads / mergeBase / side 保留，闭包沿并集 parents）', () => {
  const { root, a, b, d } = mkDualRepo();
  const def = buildGit.branchLog(root, 'main', { limit: 50 });
  assert.ok(Array.isArray(def.heads) && def.heads.length === 2, '并集载荷附 heads');
  // 搜 dev：heads 名命中 → side=dev 提交匹配；闭包沿并集 parents 收敛到全量
  const f = buildGit.branchSearchLog(root, 'main', { q: 'dev', mode: 'filter', limit: 50 });
  assert.equal(f.matchedTotal, 1, 'dev side 命中 D');
  assert.equal(f.total, 3, '闭包 D→B→A = 并集全量');
  assert.deepEqual(f.commits.map((x) => x.hash).sort(), [a, b, d].sort());
  assert.ok(f.heads && f.mergeBase, 'filter 模式保留 heads / mergeBase');
  assert.equal(f.commits.find((x) => x.hash === d).side, 'dev', 'side 字段保留');
  // 搜 REQ-2：message 命中 D，闭包同上；highlight 模式清单只含 D
  //（BUG-20260921-006：dev 为单支口径；本夹具 dev ⊇ main，单支集合与并集相同）
  const h = buildGit.branchSearchLog(root, 'dev', { q: 'REQ-2', mode: 'highlight', limit: 50 });
  assert.deepEqual(h.matchedHashes, [d]);
  assert.deepEqual(h.commits.map((x) => x.hash).sort(), [a, b, d].sort(), 'highlight 数据集 = 默认 dev 分页');
  assert.equal(h.branch, 'dev', 'dev 搜索口径（fixture dev ⊇ main，集合恰同并集）');
});

t('B6 边界：无匹配 filter 空集 + matchedTotal=0；highlight 清单为空但默认数据保留；mode 非法回退 filter；q 空白走默认分页', () => {
  const { root, a, b, c, m } = mkRepo();
  const f = buildGit.branchSearchLog(root, 'main', { q: 'zzz-no-hit', mode: 'filter', limit: 50 });
  assert.equal(f.matchedTotal, 0);
  assert.deepEqual(f.commits, []);
  assert.equal(f.total, 0);
  const h = buildGit.branchSearchLog(root, 'main', { q: 'zzz-no-hit', mode: 'highlight', limit: 50 });
  assert.deepEqual(h.matchedHashes, []);
  assert.equal(h.commits.length, 4, 'highlight 无命中不改变数据集');
  const bad = buildGit.branchSearchLog(root, 'main', { q: 'feature', mode: 'weird', limit: 50 });
  assert.equal(bad.mode, 'filter', '非法 mode 归一为 filter');
  const blank = buildGit.branchSearchLog(root, 'main', { q: '   ', mode: 'filter', limit: 50 });
  assert.equal(blank.mode, undefined, 'q 空白走 branchLog 默认分页（无 mode 字段）');
  assert.equal(blank.total, 4);
});

/* ---------- vm 公共：装载 build.js ---------- */

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
    scrollIntoView() {},
  };
}

const ST = { initialized: true, isRepo: true, currentBranch: 'dev', versions: [] };

// 短前缀可区分的 40 位 hash（slice(0,7) 各不相同）
const H = (i) => i.toString(16).padStart(4, '0').repeat(10);
const sc = (i, parents = [], subject = `提交 ${i}`, over = {}) => ({
  hash: H(i), short: H(i).slice(0, 7), parents, subject, author: 'T', date: '2026-09-21T00:00:00.000Z', tags: [], ...over,
});

// branch-log 桩：实现双模式 contract（四分支仓库 M=[B,C]；C=[A]；B=[A]；A=[]，新→旧 M,C,B,A）
function searchStub(h, st, { total = 4 } = {}) {
  h.sandbox.__branches = { isRepo: true, current: 'dev', local: ['dev'], remote: [] };
  h.sandbox.__logReqs = [];
  const all = [
    sc(1, [H(2), H(3)], 'merge: 合并 feature'),
    sc(3, [H(4)], 'feat: feature 提交 REQ-1'),
    sc(2, [H(4)], 'docs: 文档补充', { tags: ['v0.1.0'] }),
    sc(4, [], 'chore: 初始化'),
  ];
  h.sandbox.fetch = async (url) => {
    const up = new URL(String(url), 'http://local');
    if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(st)) };
    if (up.pathname === '/api/build/branches') return { ok: true, json: async () => JSON.parse(JSON.stringify(h.sandbox.__branches)) };
    if (up.pathname === '/api/build/branch-log') {
      h.sandbox.__logReqs.push(up.pathname + up.search);
      const limit = Number(up.searchParams.get('limit') || 50);
      const offset = Number(up.searchParams.get('offset') || 0);
      const q = String(up.searchParams.get('q') || '').trim().toLowerCase();
      const mode = String(up.searchParams.get('mode') || 'filter');
      if (!q) return { ok: true, json: async () => ({ branch: 'dev', commits: all.slice(offset, offset + limit), total: total, limit, offset }) };
      const matches = (c) => `${c.subject}\t${c.author}\t${c.short}\t${c.hash}\t${(c.tags || []).join('\t')}`.toLowerCase().includes(q)
        || 'dev'.includes(q);
      const matched = all.filter(matches);
      if (mode === 'highlight') {
        return { ok: true, json: async () => ({
          branch: 'dev', query: up.searchParams.get('q').trim(), mode: 'highlight',
          commits: all.slice(offset, offset + limit), total: all.length,
          matchedHashes: matched.map((c) => c.hash), matchedTotal: matched.length, limit, offset,
        }) };
      }
      // filter：匹配 + 祖先闭包（沿 parents）
      const kept = new Set(matched.map((c) => c.hash));
      const stack = [...kept];
      const byHash = new Map(all.map((c) => [c.hash, c]));
      while (stack.length) {
        for (const p of byHash.get(stack.pop()).parents) if (!kept.has(p)) { kept.add(p); stack.push(p); }
      }
      const keptList = all.filter((c) => kept.has(c.hash));
      return { ok: true, json: async () => ({
        branch: 'dev', query: up.searchParams.get('q').trim(), mode: 'filter',
        commits: keptList.slice(offset, offset + limit), total: keptList.length, matchedTotal: matched.length,
        allTotal: all.length, limit, offset,
      }) };
    }
    return { ok: true, json: async () => ({}) };
  };
}

function setup(st = ST, extra = {}) {
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
    ...extra,
  };
  sandbox.setTimeout = () => 0;
  sandbox.clearTimeout = () => {};
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

// fake GitgraphJS：记录 createGitgraph / templateExtend / import 调用
function fakeGitgraph(h) {
  const calls = { createGitgraph: [], templateExtend: [], imports: [] };
  const api = {
    createGitgraph(container, options) {
      calls.createGitgraph.push({ container, options });
      return {
        import(data) { calls.imports.push(data); return this; },
        branch() { return api.__branchProxy; },
      };
    },
    templateExtend(name, opts) { calls.templateExtend.push({ name, opts }); return { __tpl: name, opts }; },
    metroTemplate: 'metro',
    __branchProxy: { commit() { return this; }, merge() { return this; }, tag() { return this; } },
  };
  h.sandbox.GitgraphJS = api;
  return calls;
}

/* ---------- T 组：treeData 纯函数 ---------- */

t('T1 treeData：refs 组装（heads 命中行带分支名 / 单支最新行带选中分支名 / tags 带 tag: 前缀）+ subject 拼 short 前缀', () => {
  const h = setup();
  const commits = [
    sc(1, [H(2), H(3)], 'merge: 合并'),
    sc(3, [H(4)], 'feat: x'),
    sc(2, [H(4)], 'docs: y', { tags: ['v0.1.0'] }),
    sc(4, [], 'chore: init'),
  ];
  const d = h.run(`window.ATBBuild.treeData(${JSON.stringify(commits)}, ${JSON.stringify({ heads: [{ name: 'main', hash: H(2) }, { name: 'dev', hash: H(3) }], branchName: 'dev' })})`);
  assert.equal(d.length, 4);
  const by = new Map(d.map((x) => [x.hash, x]));
  assert.deepEqual([...by.get(H(2)).refs], ['main', 'tag: v0.1.0'], 'heads 命中行带分支名 + tag 前缀');
  assert.deepEqual([...by.get(H(3)).refs], ['dev'], '第二支头标签');
  assert.deepEqual([...by.get(H(1)).refs], [], '非头提交无 ref');
  assert.equal(by.get(H(1)).subject, `${H(1).slice(0, 7)} merge: 合并`, 'subject 前缀短 hash');
  assert.equal(by.get(H(1)).author.name, 'T', 'author 对象形态（git2json 校验要求）');
  // 单支：最新行带选中分支名
  const d2 = h.run(`window.ATBBuild.treeData(${JSON.stringify(commits)}, ${JSON.stringify({ heads: [], branchName: 'feature/x' })})`);
  assert.deepEqual([...d2[0].refs], ['feature/x'], '单支模式最新提交 = 选中分支头');
});

t('T2 treeData：parents 截断到集合内（页边界 / 过滤闭包外的父不外连）+ merge 行 mergeParents 标记', () => {
  const h = setup();
  const commits = [sc(8, [H(9)], '跨页首行'), sc(6, [], '根')]; // H(9) 不在集合
  const d = h.run(`window.ATBBuild.treeData(${JSON.stringify(commits)}, ${JSON.stringify({ heads: [], branchName: 'dev' })})`);
  assert.deepEqual([...d[0].parents], [], '集合外父被截断（不画向页外）');
  assert.deepEqual([...d[1].parents], []);
  const mg = [sc(1, [H(2), H(3), H(4)], 'octopus'), sc(2, [H(5)]), sc(3, [H(5)]), sc(4, [H(5)]), sc(5, [])];
  const d2 = h.run(`window.ATBBuild.treeData(${JSON.stringify(mg)}, ${JSON.stringify({ heads: [], branchName: 'dev' })})`);
  assert.equal(d2.find((x) => x.hash === H(1)).mergeParents, 3, '集合内父计数（合并标识数据）');
  assert.equal(d2.find((x) => x.hash === H(2)).mergeParents, undefined, '单父行不标合并');
});

/* ---------- R 组：vm 渲染与交互 ---------- */

t('R1 fake GitgraphJS：mountTree 走树路径——createGitgraph(vertical-reverse) + import 数据（每条带 onClick），点击回调出详情', async () => {
  const h = setup();
  searchStub(h, ST);
  const calls = fakeGitgraph(h);
  const inner = await branchesView(h);
  assert.ok(calls.createGitgraph.length >= 1, 'createGitgraph 被调用');
  const first = calls.createGitgraph[0];
  assert.equal(first.options.orientation, 'vertical-reverse', '新→旧自上而下');
  assert.ok(calls.templateExtend.length >= 1 && calls.templateExtend[0].name === 'metro', 'templateExtend 基于 metro 模板');
  assert.ok(calls.imports.length >= 1, 'import DAG 数据');
  assert.equal(calls.imports[0].length, 4, '导入全部页内提交');
  for (const c of calls.imports[0]) assert.equal(typeof c.onClick, 'function', '每条提交注入点击回调');
  // 点击回调 → 选中详情（selectLogRow 口径延续）
  const mergeCommit = calls.imports[0].find((c) => c.hash === H(1));
  h.sandbox.__clickMerge = mergeCommit.onClick;
  h.run(`window.ATBBuild.selectLogRow(${JSON.stringify(H(1))})`);
  assert.match(inner(), /bld-log-detail/, '选中提交渲染详情区');
  assert.match(inner(), /父提交：/, '详情含父提交');
  assert.match(inner(), new RegExp(H(2).slice(0, 7)), '父提交短 hash 可见');
  assert.match(inner(), /合并 · 3 父提交|合并 · 2 父提交/, '合并行文字标签（详情区）');
});

t('R2 降级：无 GitgraphJS → 行式列表（data-log-row）保留选中详情与合并标签，不出现树容器空挂载', async () => {
  const h = setup();
  searchStub(h, ST);
  const inner = await branchesView(h);
  assert.equal((inner().match(/data-log-row="/g) || []).length, 4, '每条提交一个行按钮');
  assert.match(inner(), /bld-tag-chip[^>]*>v0\.1\.0</, 'tag 以徽标展示在对应提交行');
  assert.match(inner(), /合并 · 2 父提交/, '合并行文字标签');
  h.run(`window.ATBBuild.selectLogRow(${JSON.stringify(H(4))})`);
  assert.match(inner(), /无父提交（根提交）/, '根提交详情口径保留');
});

t('R3 双模式搜索：模式 radio（默认高亮定位）、请求附 mode、两种计数文案、radio 切换重查', async () => {
  const h = setup();
  searchStub(h, ST);
  const inner = await branchesView(h);
  const el = (sel) => h.run(`document.querySelector('#buildView').querySelector(${JSON.stringify(sel)})`);
  // 模式控件：两个 radio，默认高亮定位
  assert.match(inner(), /name="logSearchMode" value="highlight"[^>]* checked/, '默认模式 = 高亮定位');
  assert.doesNotMatch(inner(), /name="logSearchMode" value="filter"[^>]* checked/, '过滤模式默认不选中');
  assert.match(inner(), /name="logSearchMode" value="filter"/, '过滤模式选项存在');
  assert.match(inner(), /高亮定位/, '模式一标签');
  assert.match(inner(), /过滤（保留祖先）/, '模式二标签');
  // 高亮模式搜索：请求 mode=highlight；计数「高亮 N 处匹配」
  const input = el('#bldLogSearchInput');
  input.value = 'REQ-1';
  input.listeners.input();
  el('#bldLogSearchGo').listeners.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.match(h.sandbox.__logReqs.at(-1), /q=REQ-1&mode=highlight/, '高亮模式请求附 mode');
  assert.match(inner(), /高亮 1 处匹配（message \/ 分支名 \/ tag）/, '高亮计数文案');
  assert.match(inner(), /第 1–4 条 \/ 共 4 条/, '高亮模式数据集 = 默认分页（区间按全量）');
  // 切换到过滤模式：带既有词重查；计数「匹配 N 条 · 保留 M/T 条」
  h.run(`window.ATBBuild.setLogSearchMode('filter')`);
  await new Promise((r) => setTimeout(r, 10));
  assert.match(h.sandbox.__logReqs.at(-1), /q=REQ-1&mode=filter/, '过滤模式请求附 mode');
  assert.match(inner(), /匹配 1 条 · 保留 2\/4 条（含祖先，泳道连通）/, '过滤计数文案（匹配 REQ-1 一条，闭包保留 C 及其父 A 共 2/4）');
  assert.match(inner(), /name="logSearchMode" value="filter"[^>]* checked/, '切模式后 radio 勾选同步');
  // 过滤模式翻页沿用分页条
  assert.match(inner(), /bld-log-pager/, '过滤结果沿用分页条');
});

t('R4 搜索状态回归：无匹配空态 + 一键清除、清除恢复全量、切分支重置关键词（模式保留）、翻页与每页条数带 mode', async () => {
  const h = setup();
  searchStub(h, ST);
  const inner = await branchesView(h);
  const el = (sel) => h.run(`document.querySelector('#buildView').querySelector(${JSON.stringify(sel)})`);
  // 无匹配（过滤模式）
  h.run(`window.ATBBuild.setLogSearchMode('filter')`);
  await new Promise((r) => setTimeout(r, 10));
  const input = el('#bldLogSearchInput');
  input.value = 'zzz';
  input.listeners.input();
  el('#bldLogSearchGo').listeners.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.match(inner(), /没有匹配的提交（关键词：zzz）/, '无匹配空态');
  assert.doesNotMatch(inner(), /该分支暂无提交/, '与空分支区分');
  assert.match(inner(), /data-log-search-clear/, '一键清除入口');
  // 高亮模式无匹配：数据集不变（不出空态），计数 0 处
  h.run(`window.ATBBuild.setLogSearchMode('highlight')`);
  await new Promise((r) => setTimeout(r, 10));
  assert.match(inner(), /高亮 0 处匹配（message \/ 分支名 \/ tag）/, '高亮无命中计数为 0 处');
  assert.match(inner(), /data-log-row="[^"]+"/, '高亮无命中仍显示全量列表');
  // 清除恢复全量
  h.run(`window.ATBBuild.clearLogSearch()`);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(!/[?&]q=/.test(h.sandbox.__logReqs.at(-1)), '清除后不带 q');
  assert.match(inner(), /第 1–4 条 \/ 共 4 条/, '恢复默认列表');
  // 切分支重置关键词、模式保留为用户选择
  input.value = 'REQ-1';
  input.listeners.input();
  el('#bldLogSearchGo').listeners.click();
  await new Promise((r) => setTimeout(r, 10));
  h.sandbox.__branches = { isRepo: true, current: 'dev', local: ['dev', 'main'], remote: [] };
  h.run(`window.ATBBuild.selectBranch('main')`);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(!/[?&]q=/.test(h.sandbox.__logReqs.at(-1)), '切分支清空关键词');
  assert.match(inner(), /name="logSearchMode" value="highlight"[^>]* checked/, '切分支不重置模式（用户选择保留）');
  // 过滤模式翻页 / 每页条数切换带 q 与 mode
  h.run(`window.ATBBuild.setLogSearchMode('filter')`);
  await new Promise((r) => setTimeout(r, 10));
  const input2 = el('#bldLogSearchInput');
  input2.value = 'REQ-1';
  input2.listeners.input();
  el('#bldLogSearchGo').listeners.click();
  await new Promise((r) => setTimeout(r, 10));
  h.run(`window.ATBBuild.gotoLogPage(2)`);
  await new Promise((r) => setTimeout(r, 10));
  assert.match(h.sandbox.__logReqs.at(-1), /offset=\d+.*q=REQ-1&mode=filter/, '过滤态翻页带 q+mode');
});

t('R5 深浅色：matchMedia(prefers-color-scheme) 选浅 / 深两套模板配色，change 触发重画', async () => {
  const listeners = [];
  const mk = (dark) => ({
    matches: dark,
    addEventListener(ev, fn) { listeners.push(fn); },
    removeEventListener() {},
  });
  const h = setup(ST, { matchMedia: (q) => mk(false) });
  searchStub(h, ST);
  const calls = fakeGitgraph(h);
  await branchesView(h);
  const lightColors = calls.createGitgraph[0].options.template.opts.colors;
  assert.ok(Array.isArray(lightColors) && lightColors.length >= 4, '浅色模板色板');
  const h2 = setup(ST, { matchMedia: (q) => mk(true) });
  searchStub(h2, ST);
  const calls2 = fakeGitgraph(h2);
  await branchesView(h2);
  const darkColors = calls2.createGitgraph[0].options.template.opts.colors;
  assert.notDeepEqual(lightColors, darkColors, '浅 / 深两套色板（跟随系统）');
  // 系统外观变化 → 重画（mountTree 注册监听，触发后再次 createGitgraph）
  const before = calls2.createGitgraph.length;
  calls2.__themeChange = () => listeners.forEach((fn) => fn({ matches: true }));
  // 模拟 change 事件回调触发（build.js 内监听函数被调用后 render → 重新 mountTree）
  h2.sandbox.__fireTheme = () => listeners.forEach((fn) => fn({ matches: false }));
  h2.run(`window.ATBBuild.selectLogRow(${JSON.stringify(H(1))})`); // 任一重渲染路径
  assert.ok(calls2.createGitgraph.length >= before, '重渲染重新挂载树');
});

/* ---------- S 组：vendor 与静态契约 ---------- */

t('S1 index.html 在 build.js 之前引入 /gitgraph.umd.min.js；vendor 文件为官方 @gitgraph/js 1.4.0 UMD 产物', () => {
  const iGG = html.indexOf('<script src="/gitgraph.umd.min.js"></script>');
  const iBuild = html.indexOf('<script src="/build.js"></script>');
  assert.ok(iGG !== -1, 'index.html 引入 gitgraph UMD');
  assert.ok(iGG < iBuild, '在 build.js 之前加载');
  const bundle = fs.readFileSync(path.join(webRoot, 'gitgraph.umd.min.js'), 'utf8');
  assert.ok(bundle.includes('GitgraphJS'), 'UMD 暴露 GitgraphJS 全局');
  assert.ok(bundle.length > 30000, '官方 min bundle 体积量级（约 36KB）');
  assert.match(buildJs, /window\.GitgraphJS/, 'build.js 检测 GitgraphJS（vendor 加载失败走降级）');
});

t('S2 style.css：树容器 / 模式控件 / 命中高亮（浅深两套）/ 选中 / 合并标识样式类', () => {
  assert.match(css, /\.bld-tree/, '树容器样式');
  assert.match(css, /\.bld-log-mode/, '模式 radio 控件样式');
  assert.match(css, /\.bld-tag-chip/, '降级列表 tag 徽标样式');
  assert.equal((css.match(/text\.hit/g) || []).length, 2, '命中高亮浅 / 深各一套');
  assert.match(css, /\.gg-merge/, '合并提交 message 标识样式');
  assert.match(css, /\.bld-log-count/, '计数行样式保留');
});

t('S3 build.js 静态契约：treeData / mountTree 导出接缝；server.mjs mode 透传注释同步', () => {
  assert.match(buildJs, /function treeData\(/, 'treeData 纯函数');
  assert.match(buildJs, /treeData,/, '经 window.ATBBuild 导出');
  assert.match(buildJs, /function mountTree\(/, 'mountTree 渲染入口');
  const server = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');
  assert.match(server, /searchParams\.get\('mode'\)/, 'branch-log 路由透传 mode');
});

t('S4 旧渲染清理：自研行内轨道（logGraph/graphSvg）不再存在；licenses.md 维护 vendor 口径', () => {
  assert.doesNotMatch(buildJs, /function logGraph\(/, '自研轨道纯函数移除（渲染层归 gitgraph）');
  assert.doesNotMatch(buildJs, /function graphSvg\(/, '行内 SVG 渲染移除');
  const lic = fs.readFileSync(path.join(pluginRoot, 'agent-team-board', 'data', 'requirements', 'REQ-20260921-002', 'licenses.md'), 'utf8');
  for (const s of ['@gitgraph/js', '1.4.0', 'vendor', 'MIT', 'github.com/nicoespeon/gitgraph.js']) {
    assert.ok(lic.includes(s), `licenses.md 含 ${s}`);
  }
});

/* ---------- I 组：i18n 中英同步 ---------- */

t('I1 i18n：树视图与双模式搜索新增文案进 EN / EN_DYNAMIC（值无中文、静态值唯一）', async () => {
  await import('../web/i18n.js');
  const I = globalThis.ATBI18N;
  const { EN, EN_DYNAMIC } = I._dict;
  for (const k of ['高亮定位', '过滤（保留祖先）', '搜 message / 分支 / tag / 作者 / hash…']) {
    assert.ok(EN[k], `EN 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN[k]), `EN 值不含中文：${k}`);
  }
  for (const k of ['高亮 ◇ 处匹配（message / 分支名 / tag）', '匹配 ◇ 条 · 保留 ◇/◇ 条（含祖先，泳道连通）']) {
    assert.ok(EN_DYNAMIC[k], `EN_DYNAMIC 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN_DYNAMIC[k]), `EN_DYNAMIC 值不含中文：${k}`);
  }
  const values = Object.values(EN);
  for (const k of ['高亮定位', '过滤（保留祖先）']) {
    assert.equal(values.filter((v) => v === EN[k]).length, 1, `EN 值唯一：${k}`);
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
