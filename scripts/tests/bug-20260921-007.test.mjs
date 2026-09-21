#!/usr/bin/env node
// BUG-20260921-007 分支浏览提交树翻页修复（第 3 页起无数据 / 第 2 页起 dev 泳道变蓝）
// —— T 组：treeData 纯函数（双支 side 锚定 + 同侧链改写 / 单支 parents 保真 + 页外断层续锚 /
//   mergeParents 口径）；V 组：vendor 可达性镜像（gitgraph import 渲染过滤语义：分支锚首父链 ∪
//   合并闭包——整页提交不丢，缺陷一的结构性回归闸）；R 组：vm 渲染（异步渲染失败降级保底 /
//   双支 compareBranchesOrder 配色锚定 / 单支单色板）；S 组：静态契约。
// 根因（登记排查 + 本测试固化）：
//   1. gitgraph import() 只渲染「从分支 ref 沿首父链可达 ∪ 合并闭包」的提交；treeData 旧实现只把
//      「页内命中的分支头」转成 refs，第 2 页起页内无 ref → 大量提交被静默丢弃（本仓库并集第 3 页
//      50/50 全丢 = 界面空白；丢弃无异常抛出，逃逸 mountTree 同步 try/catch，降级列表也不触发）。
//   2. gitgraph 泳道色按「分支名在渲染序列中的首次出现顺序」分配（colors[0] 蓝 / colors[1] 黄）；
//      第 1 页两支头都在页内恰成两支，第 2 页起无 ref → 单支（或 DELETED 分支）恒 colors[0] 蓝。
// 用法：node scripts/tests/bug-20260921-007.test.mjs

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

// useRealTimers：传入真实 setTimeout（默认桩不触发回调），用于异步降级保底用例
function setup(extra = {}) {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout: () => {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    ...extra,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  return { sandbox, run: (code) => vm.runInContext(code, sandbox) };
}

// 短前缀可区分的 40 位 hash（slice(0,7) 各不相同）
const H = (i) => i.toString(16).padStart(4, '0').repeat(10);
const sc = (i, parents = [], subject = `提交 ${i}`, over = {}) => ({
  hash: H(i), short: H(i).slice(0, 7), parents, subject, author: 'T', date: '2026-09-21T00:00:00.000Z', tags: [], ...over,
});

// branch-log 桩：载荷来自 h.sandbox.__logPayload
function logStub(h, st = ST) {
  h.sandbox.__branches = { isRepo: true, current: 'dev', local: ['dev', 'main'], remote: [] };
  h.sandbox.fetch = async (url) => {
    const up = new URL(String(url), 'http://local');
    if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(st)) };
    if (up.pathname === '/api/build/branches') return { ok: true, json: async () => JSON.parse(JSON.stringify(h.sandbox.__branches)) };
    if (up.pathname === '/api/build/branch-log') {
      const p = h.sandbox.__logPayload;
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

/* ---------- vendor 可达性镜像（gitgraph import 渲染过滤语义） ---------- */

// 复刻 @gitgraph/js 1.4.0 getRenderedData 的提交过滤：锚（非 tag ref）沿 parents[0] 的可达集
// ∪ 合并闭包（合并行次父起沿首父链、仅收「未被锚覆盖」的提交）。镜像证明见条目 design.md。
function ggRenderedHashes(data) {
  const byHash = new Map(data.map((r) => [r.hash, r]));
  const covered = new Set();
  const walk = (hash) => {
    const stack = [hash];
    while (stack.length) {
      const h = stack.pop();
      const c = byHash.get(h);
      if (!h || !c || covered.has(h)) continue;
      covered.add(h);
      if (c.parents[0]) stack.push(c.parents[0]);
    }
  };
  for (const row of data) {
    for (const n of row.refs || []) {
      if (!String(n).startsWith('tag: ')) walk(row.hash);
    }
  }
  for (const c of data) {
    if ((c.parents || []).length < 2) continue;
    for (const p of c.parents.slice(1)) {
      let cur = byHash.get(p);
      while (cur && !covered.has(cur.hash)) {
        covered.add(cur.hash);
        cur = cur.parents[0] ? byHash.get(cur.parents[0]) : undefined;
      }
    }
  }
  return covered;
}

/* ---------- T 组：treeData 纯函数 ---------- */

// 双支并集第 2 页形态（新→旧）：两支头都不在页内，页内为两 side 交错段
function dualPage() {
  return [
    { ...sc(11, [H(15)], 'dev 段新'), side: 'dev' },
    { ...sc(12, [H(15)], 'main 段新'), side: 'main' },
    { ...sc(13, [H(15)], 'dev 段旧'), side: 'dev' },
    { ...sc(15, [H(16)], '共享历史'), side: 'main' },
    { ...sc(16, [], '根'), side: 'main' },
  ];
}
const DUAL_HEADS_OUT = [{ name: 'main', hash: H(99) }, { name: 'dev', hash: H(98) }];
const DUAL_HEADS_IN = [{ name: 'main', hash: H(12) }, { name: 'dev', hash: H(11) }];

t('T1 双支翻页锚定：heads 不在页内时每侧最新行带该侧分支名（泳道 / 配色身份跨页稳定）；heads 在页内（第 1 页）行为不变', () => {
  const h = setup();
  const commits = dualPage();
  const d = h.run(`window.ATBBuild.treeData(${JSON.stringify(commits)}, ${JSON.stringify({ heads: DUAL_HEADS_OUT, branchName: 'main' })})`);
  const by = new Map(d.map((x) => [x.hash, x]));
  assert.deepEqual([...by.get(H(11)).refs], ['dev'], '页内最新 dev 行锚定 dev 分支名（第 2 页起仍有身份）');
  assert.deepEqual([...by.get(H(12)).refs], ['main'], '页内最新 main 行锚定 main 分支名');
  assert.deepEqual([...by.get(H(13)).refs], [], '其余 dev 行不重复挂名');
  // 第 1 页（heads 在页内）：锚仍在头行，回归不变
  const d1 = h.run(`window.ATBBuild.treeData(${JSON.stringify(commits)}, ${JSON.stringify({ heads: DUAL_HEADS_IN, branchName: 'main' })})`);
  const by1 = new Map(d1.map((x) => [x.hash, x]));
  assert.deepEqual([...by1.get(H(11)).refs], ['dev'], '第 1 页 dev 头行带 dev 分支名');
  assert.deepEqual([...by1.get(H(12)).refs], ['main'], '第 1 页 main 头行带 main 分支名');
});

t('T2 双支同侧链：同侧真实父保真为 parents[0]；同侧父不在页内时接下方最近同侧行（链覆盖不丢提交）；跨侧父保留为附加父（合并曲线）；主侧链底锚序钉主分支名先入', () => {
  const h = setup();
  const commits = [
    { ...sc(21, [H(22), H(23)], 'main 合并 dev'), side: 'main' }, // 合并行：跨侧父 D
    { ...sc(24, [H(25)], 'dev 提交'), side: 'dev' },             // dev 头（heads 在页内）
    { ...sc(22, [H(25)], 'main 上一提交'), side: 'main' },        // 不与合并行相邻：同侧链跨行相接
    { ...sc(23, [H(25)], '被合并的 dev 头'), side: 'dev' },
    { ...sc(25, [H(26)], '共享历史'), side: 'main' },
    { ...sc(26, [], '根'), side: 'main' },
  ];
  const heads = [{ name: 'main', hash: H(21) }, { name: 'dev', hash: H(24) }];
  const d = h.run(`window.ATBBuild.treeData(${JSON.stringify(commits)}, ${JSON.stringify({ heads, branchName: 'main' })})`);
  const by = new Map(d.map((x) => [x.hash, x]));
  // 合并行：同侧父 H(22) 为 parents[0]，跨侧父 H(23) 保留为附加父（gitgraph 画合并曲线）
  assert.deepEqual([...by.get(H(21)).parents], [H(22), H(23)], '合并行 [同侧父, 跨侧父]');
  assert.equal(by.get(H(21)).mergeParents, 2, 'mergeParents 按原集合内父计数（合并标识口径不变）');
  // H(22) 的同侧真实父 H(25) 不与其相邻（中间隔着 H(23)）：保真为首父
  assert.deepEqual([...by.get(H(22)).parents], [H(25)], '同侧真实父保真');
  // dev 头 H(24)：同侧真实父不在页内（其真父 H(25) 是 main 侧共享历史）→ 接下方最近同侧行 H(23)
  // 为 parents[0]（链覆盖），真实跨侧父 H(25) 保留为附加父（真实父边不丢，gitgraph 画分叉曲线）
  assert.deepEqual([...by.get(H(24)).parents], [H(23), H(25)], '同侧父缺位时接下方最近同侧行（链覆盖），跨侧真父保留');
  assert.deepEqual([...by.get(H(23)).parents], [H(25)], 'dev 段底：跨侧父保留（分叉曲线），链汇入共享历史');
  assert.deepEqual([...by.get(H(26)).refs], ['main'], '最老 main 行钉主分支名先入（共享历史 branchToDisplay 恒 main）');
});

t('T3 单支保真：无 side 时 parents 仍按集合内截断保真（不虚构父边）；未覆盖断层行以「分支名·n」续锚', () => {
  const h = setup();
  // G5（REQ-20260920-001）同构：C 的父 D 在集合外——不得误连 E；E 断层 → 续锚补覆盖
  const commits = [sc(31, [H(32), H(33)], '合并 feature'), sc(33, [H(34)], 'feature 提交'), sc(35, [], '断层泳道')];
  const d = h.run(`window.ATBBuild.treeData(${JSON.stringify(commits)}, ${JSON.stringify({ heads: [], branchName: 'dev' })})`);
  const by = new Map(d.map((x) => [x.hash, x]));
  assert.deepEqual([...by.get(H(31)).parents], [H(33)], '集合内父保真、集合外父截断（既有口径）');
  assert.deepEqual([...by.get(H(33)).parents], [], '不与 H(35) 误连（不虚构父边）');
  assert.deepEqual([...by.get(H(31)).refs], ['dev'], '首行锚定选中分支名');
  assert.deepEqual([...by.get(H(33)).refs], [], '闭包覆盖行（合并次父链）不加续锚');
  assert.deepEqual([...by.get(H(35)).refs], ['dev·2'], '页外断层泳道顶以「分支名·2」续锚（gitgraph 可达覆盖）');
});

t('T4 单支合并闭包内不加锚：段提交经合并次父闭包覆盖时不产生多余续锚（第 1 页既有形态零回归）', () => {
  const h = setup();
  const commits = [sc(41, [H(42), H(43)], '合并 feature'), sc(43, [], 'feature 提交'), sc(42, [], '主线提交')];
  const d = h.run(`window.ATBBuild.treeData(${JSON.stringify(commits)}, ${JSON.stringify({ heads: [], branchName: 'dev' })})`);
  const by = new Map(d.map((x) => [x.hash, x]));
  assert.deepEqual([...by.get(H(41)).refs], ['dev'], '首行分支名');
  assert.deepEqual([...by.get(H(42)).refs], [], '主线行（锚链覆盖）无锚');
  assert.deepEqual([...by.get(H(43)).refs], [], '合并次父闭包覆盖行无锚（不添乱）');
});

/* ---------- V 组：vendor 可达性镜像（缺陷一的结构性闸） ---------- */

t('V1 双支翻页：整页提交在 gitgraph 可达过滤下零丢弃（本仓库并集第 3 页 50/50 全丢的结构性回归闸）', () => {
  const h = setup();
  // 合成两页交错并集（heads 恒在第 1 页）：page2 无 heads 命中行
  const mkPage = (base, sides) => sides.map((s, i) => ({
    ...sc(base + i, [H(base + i + 1)], `提交 ${base + i}`), side: s,
  }));
  const page1 = mkPage(1, ['dev', 'main', 'dev', 'main', 'dev', 'main', 'dev', 'main']);
  const page2 = mkPage(9, ['main', 'dev', 'main', 'dev', 'main', 'dev', 'main', 'dev']);
  const heads = [{ name: 'main', hash: H(5) }, { name: 'dev', hash: H(7) }]; // 第 1 页末两支头
  for (const [name, page] of [['第 1 页', page1], ['第 2 页', page2]]) {
    const d = h.run(`window.ATBBuild.treeData(${JSON.stringify(page)}, ${JSON.stringify({ heads, branchName: 'main' })})`);
    const got = ggRenderedHashes(d);
    assert.equal(got.size, d.length, `${name}：${d.length} 条提交全部可达（零丢弃）`);
  }
});

t('V2 单支页外断层：续锚后整页零丢弃；无断层的普通分页同样零丢弃', () => {
  const h = setup();
  // 断层形态：合并提交在更早页，本页两条互不相邻的泳道残段
  const spill = [sc(51, [H(52)], '残段一'), sc(53, [H(54)], '残段二'), sc(52, [], '残段一底'), sc(54, [], '残段二底')];
  const d1 = h.run(`window.ATBBuild.treeData(${JSON.stringify(spill)}, ${JSON.stringify({ heads: [], branchName: 'main' })})`);
  assert.equal(ggRenderedHashes(d1).size, 4, '断层页 4 条全部可达');
  const linear = [sc(61, [H(62)]), sc(62, [H(63)]), sc(63, [])];
  const d2 = h.run(`window.ATBBuild.treeData(${JSON.stringify(linear)}, ${JSON.stringify({ heads: [], branchName: 'main' })})`);
  assert.equal(ggRenderedHashes(d2).size, 3, '普通线性页零丢弃');
});

/* ---------- R 组：vm 渲染与交互 ---------- */

t('R1 异步渲染失败降级保底：vendor 渲染异常发生在 setTimeout 内（逃逸同步 try/catch）时，树容器降级为行式列表，不出现空白', async () => {
  const h = setup({ setTimeout: (fn) => setTimeout(fn, 0), clearTimeout: () => {} }); // 真实定时器
  logStub(h);
  h.sandbox.__logPayload = {
    branch: 'main', total: 3, limit: 50, offset: 100,
    commits: [sc(71, [H(72)], '第 3 页行一'), sc(72, [H(73)], '第 3 页行二'), sc(73, [], '第 3 页行三')],
  };
  // fake vendor：import() 返回成功，但异步渲染回调内“崩溃”（什么都不画）——复刻缺陷一的逃逸路径
  h.sandbox.GitgraphJS = {
    createGitgraph() {
      return {
        import() { setTimeout(() => { /* vendor 异步渲染异常：树未画出（真实场景为抛错逃逸） */ }, 0); return this; },
      };
    },
    templateExtend() { return {}; },
    metroTemplate: 'metro',
  };
  const inner = await branchesView(h);
  assert.doesNotMatch(inner(), /data-log-row/, '同步阶段仍是树路径（未提前降级）');
  await new Promise((r) => setTimeout(r, 20)); // 等 vendor 渲染 tick 与保底核查 tick（FIFO 后于 vendor）
  const boxHtml = () => h.run(`document.querySelector('#buildView').querySelector('#bldTreeBox').innerHTML`);
  assert.equal((boxHtml().match(/data-log-row="/g) || []).length, 3, '异步渲染失败后树容器降级为行式列表（3 条全保底）');
  assert.match(boxHtml(), /bld-log-row/, '保底列表行结构');
});

t('R2 双支配色锚定：createGitgraph 传 compareBranchesOrder（main 恒 0 蓝 / dev 恒 1 黄，不随页内出现顺序跳变）；单支单色板', async () => {
  const mk = async (payload) => {
    const h = setup();
    logStub(h);
    h.sandbox.__logPayload = payload;
    const calls = { opts: [] };
    h.sandbox.GitgraphJS = {
      createGitgraph(box, options) { calls.opts.push(options); return { import() { return this; } }; },
      templateExtend(name, opts) { return { __tpl: name, opts }; },
      metroTemplate: 'metro',
    };
    await branchesView(h);
    return calls;
  };
  // 双支第 2 页（heads 不在页内）：compareBranchesOrder 存在且钉 main < dev；双支色板前两色 = --git-lg0/1
  const dual = await mk({
    branch: 'main', total: 5, limit: 50, offset: 50,
    heads: [{ name: 'main', hash: H(99) }, { name: 'dev', hash: H(98) }],
    mergeBase: H(15),
    commits: dualPage(),
  });
  const o = dual.opts.at(-1);
  assert.equal(typeof o.compareBranchesOrder, 'function', '双支并集传泳道序比较器');
  assert.ok(o.compareBranchesOrder('main', 'dev') < 0, 'main 恒排在 dev 前（colors[0] 蓝）');
  assert.ok(o.compareBranchesOrder('dev', 'main') > 0, 'dev 恒排 main 后（colors[1] 黄）');
  assert.equal(o.template.opts.colors[0], '#2563eb', '浅色主分支泳道 --git-lg0 蓝');
  assert.equal(o.template.opts.colors[1], '#d97706', '浅色 dev 泳道 --git-lg1 黄');
  // 双支仅 dev 在页（本仓库现状第 1 页：main 头被更新的 dev 提交挤到第 2 页）：
  // dev 色打头——单分支不占 colors[0] 错染主分支蓝
  const devOnly = await mk({
    branch: 'main', total: 3, limit: 50, offset: 0,
    heads: [{ name: 'main', hash: H(99) }, { name: 'dev', hash: H(98) }],
    commits: [
      { ...sc(91, [H(92)], 'dev 提交一'), side: 'dev' },
      { ...sc(92, [H(93)], 'dev 提交二'), side: 'dev' },
      { ...sc(93, [], '根'), side: 'dev' },
    ],
  });
  const od = devOnly.opts.at(-1);
  assert.equal(typeof od.compareBranchesOrder, 'function', '仅 dev 在页仍是比较器口径');
  assert.equal(od.template.opts.colors[0], '#d97706', '仅 dev 在页：dev 色打头（恒黄，不因单分支占 0 号位变蓝）');
  // 单支：单色板（全部泳道同色，翻页 / 断层续锚不跳变）
  const single = await mk({
    branch: 'dev', total: 3, limit: 50, offset: 0,
    commits: [sc(81, [H(82)], 'dev 提交'), sc(82, [], '根')],
  });
  const os = single.opts.at(-1);
  assert.equal(os.compareBranchesOrder, undefined, '单支不传比较器');
  assert.equal(os.template.opts.colors.length, 1, '单支单色板');
  assert.equal(os.template.opts.colors[0], '#2563eb', '单支泳道色 = 主分支蓝');
});

t('R3 双支翻页树数据：import 数据携带每侧锚（第 2 页起 dev/main 身份仍在，缺陷二的数据面）', async () => {
  const h = setup();
  logStub(h);
  h.sandbox.__logPayload = {
    branch: 'main', total: 5, limit: 50, offset: 50,
    heads: [{ name: 'main', hash: H(99) }, { name: 'dev', hash: H(98) }],
    mergeBase: H(15),
    commits: dualPage(),
  };
  const imports = [];
  h.sandbox.GitgraphJS = {
    createGitgraph() { return { import(data) { imports.push(data); return this; } }; },
    templateExtend() { return {}; },
    metroTemplate: 'metro',
  };
  await branchesView(h);
  assert.ok(imports.length >= 1, '树挂载 import 数据');
  const by = new Map(imports[0].map((x) => [x.hash, x]));
  assert.deepEqual([...by.get(H(11)).refs], ['dev'], '第 2 页 dev 泳道锚仍在（不再退化为单蓝色泳道）');
  assert.deepEqual([...by.get(H(12)).refs], ['main'], '第 2 页 main 泳道锚仍在');
});

/* ---------- S 组：静态契约 ---------- */

t('S1 build.js 静态契约：side 锚定 / 续锚 / 泳道序比较器 / 异步保底注释均以 BUG-20260921-007 归因', () => {
  assert.match(buildJs, /BUG-20260921-007/, '修复点归因注释');
  assert.match(buildJs, /compareBranchesOrder/, '泳道序比较器接入 createGitgraph');
  assert.match(buildJs, /function treeData\(/, 'treeData 纯函数仍在（导出接缝不变）');
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
