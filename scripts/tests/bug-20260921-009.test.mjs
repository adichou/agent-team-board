#!/usr/bin/env node
// BUG-20260921-009 命令模块的最近执行没有显示 —— 根因：commands.js 的 render() 整体重建
// #commandsView DOM（含「最近执行」列表容器）但只调用 renderList / renderDetail / renderOutput /
//   renderHistory，漏调 renderRecent；renderRecent 仅在点选命令（bindCmdPick）与执行收敛
//   （withDone）时触发。因此：进入模块默认「最近执行」页签时空态提示不显示；成功执行产生
//   recents 后，切页签往返或离开再进入模块，列表被重建清空、recents 不再显示。
// 引入来源：REQ-20260920-004（commit 12ac4ae 引入 commands.js）。
// —— 用例（vm 沙箱驱动真实 commands.js，fake DOM 以「#commandsView.innerHTML 赋值 = 重建子树」语义）：
//   T1 进入模块即渲染「最近执行」空态提示（默认页签引导文案可见）；
//   T2 成功执行后切「全部命令」再切回「最近执行」，条目仍在；
//   T3 成功执行后离开再进入模块（enter 幂等路径），条目仍在；
//   T4 控制用例：默认页签 recent、切 all 后命令列表正常（零回归）。
// 用法：node scripts/tests/bug-20260921-009.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(pluginRoot, 'scripts', 'web');
const commandsJs = fs.readFileSync(path.join(webRoot, 'commands.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- fake DOM：querySelector 按选择器串挂映射；#commandsView.innerHTML 赋值 = 重建子树 ---------- */

// 每个 setup() 注入一次的全局选择器解析器（任意节点上的 querySelectorAll 共用，保证
// render() 绑定与测试触发拿到同一批列表项节点——真实 DOM 中两者本就同源）
let RESOLVE = null;

function makeEl(label) {
  const el = {
    _label: label, _html: '', _q: new Map(), listeners: {},
    textContent: '', value: '', title: '', disabled: false, hidden: false,
    dataset: {},
    classList: {
      _s: new Set(),
      add: (v) => el.classList._s.add(v),
      remove: (v) => el.classList._s.delete(v),
      contains: (v) => el.classList._s.has(v),
      toggle: (v, on) => (on ? el.classList._s.add(v) : el.classList._s.delete(v)),
    },
    addEventListener(ev, fn) { (el.listeners[ev] = el.listeners[ev] || []).push(fn); },
    async fire(ev, evt) {
      const fns = [...(el.listeners[ev] || [])]; // 快照：句柄内重建 DOM 会再绑新监听，不并入本轮
      for (const fn of fns) await fn(evt || { target: el });
    },
    focus() {}, select() {}, remove() {}, setAttribute() {}, removeAttribute() {},
    querySelector(sel) {
      if (!el._q.has(sel)) el._q.set(sel, makeEl(`${el._label} ${sel}`));
      return el._q.get(sel);
    },
    querySelectorAll(sel) { return (RESOLVE && RESOLVE(el, sel)) || []; },
  };
  Object.defineProperty(el, 'innerHTML', {
    configurable: true,
    get: () => el._html,
    set: (v) => { resetSubtree(el); el._html = v; }, // innerHTML 赋值 = 销毁 scoped 子节点后写入新内容（浏览器语义）
  });
  return el;
}

function resetSubtree(node) {
  node._html = '';
  node.listeners = {};
  for (const child of node._q.values()) resetSubtree(child);
  node._q.clear();
}

// 命令清单（fetch 桩与 .cmd-item 选择器解析共用一份，保证点击项即清单命令）
const CATALOG = [
  { name: 'list', desc: '列出条目' },
  { name: 'show', desc: '查看条目', args: [{ label: '条目 ID', required: true }] },
];

function setup() {
  const document = makeEl('#document');
  const commandsView = document.querySelector('#commandsView');
  // 列表项节点缓存：任意容器上查 .cmd-ltab / .cmd-item 都拿到同一批稳定节点；
  // #commandsView.innerHTML 赋值 = 重建子树（清缓存与内容，模拟浏览器销毁重建语义）
  const listCache = new Map();
  const cached = (key, make) => {
    if (!listCache.has(key)) listCache.set(key, make());
    return listCache.get(key);
  };
  RESOLVE = (el, sel) => {
    if (sel === '.cmd-ltab') {
      return cached(sel, () => ['recent', 'all'].map((tab) => {
        const b = makeEl(`.cmd-ltab[${tab}]`);
        b.dataset.tab = tab;
        return b;
      }));
    }
    if (sel === '.cmd-item') {
      return cached(sel, () => CATALOG.map((c) => {
        const b = makeEl(`.cmd-item[${c.name}]`);
        b.dataset.c = c.name;
        return b;
      }));
    }
    return [];
  };
  Object.defineProperty(commandsView, 'innerHTML', {
    configurable: true,
    get: () => commandsView._html,
    set: (v) => {
      // 模拟浏览器：容器 innerHTML 赋值 = 销毁并重建全部子节点。
      // commands.js 的 $ 查询有两类：scoped（host.querySelector，存于 commandsView._q）与
      // 文档级 `$('#commandsView …')`（存于 document._q，语义上仍是视图子树），重建时一并清空。
      resetSubtree(commandsView);
      for (const [k, node] of document._q) if (k !== '#commandsView') resetSubtree(node);
      listCache.clear(); // 页签 / 命令项按钮随子树重建，事件需重新绑定
      commandsView._html = v;
    },
  });
  commandsView.appendChild = () => {};
  const sandbox = {
    document, console, Date, JSON,
    setTimeout: () => 0, clearTimeout: () => {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    fetch: async (url) => {
      const u = String(url);
      if (u.startsWith('/api/cli/commands')) {
        return { ok: true, status: 200, json: async () => ({ groups: [{ label: '查询', commands: CATALOG }] }) };
      }
      if (u.startsWith('/api/board')) return { ok: true, status: 200, json: async () => ({ initialized: true }) };
      if (u.startsWith('/api/cli/run?')) return { ok: true, status: 200, json: async () => ({ runId: 'run-1' }) };
      if (u.startsWith('/api/cli/run-status')) {
        return {
          ok: true, status: 200,
          json: async () => ({ running: false, exitCode: 0, signal: null, stdout: 'ok', stderr: '', durationMs: 5, argv: ['node', 'atb.mjs', 'list'] }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(commandsJs, sandbox, { filename: 'commands.js' });
  const recentHost = () => document.querySelector('#commandsView .cmd-list[aria-label^="最近执行列表"]');
  const allHost = () => document.querySelector('#commandsView .cmd-list[aria-label="命令列表"]');
  const ltab = (tab) => commandsView.querySelectorAll('.cmd-ltab').find((b) => b.dataset.tab === tab);
  return { sandbox, document, commandsView, recentHost, allHost, ltab };
}

async function runListOnce(h) {
  // 在「全部命令」页签点选 list → 详情点执行 → run-status 即完成（exitCode 0）
  // 节点查询与 commands.js 自身口径一致（文档级 `#commandsView .cmd-detail`），拿到被绑定的同一节点
  await h.sandbox.ATBCommands.enter('/p');
  const item = h.commandsView.querySelectorAll('.cmd-item').find((b) => b.dataset.c === 'list');
  await item.fire('click');
  const detail = h.document.querySelector('#commandsView .cmd-detail');
  await detail.querySelector('#cmdRun').fire('click');
  await new Promise((r) => setTimeout(r, 20)); // 等 pollResult 收敛 withDone
}

t('T1 进入命令模块即渲染「最近执行」空态提示（默认页签引导文案可见，不再空白）', async () => {
  const h = setup();
  await h.sandbox.ATBCommands.enter('/p');
  assert.equal(h.sandbox.ATBCommands.snapshot().tab, 'recent', '默认页签为最近执行');
  const html = h.recentHost().innerHTML;
  assert.ok(html.includes('暂无最近执行'), `空态提示应显示，得到：${JSON.stringify(html.slice(0, 80))}`);
});

t('T2 成功执行后切「全部命令」再切回「最近执行」，条目仍在（render 重建后重渲染）', async () => {
  const h = setup();
  await runListOnce(h);
  assert.ok(h.recentHost().innerHTML.includes('atb list'), '执行成功后最近执行应展示该命令');
  await h.ltab('all').fire('click');   // switchTab('all') → render() 重建 DOM
  assert.ok(h.allHost().innerHTML.includes('atb list'), '全部命令页签命令列表正常（控制）');
  await h.ltab('recent').fire('click'); // switchTab('recent') → render() 重建 DOM
  assert.ok(h.recentHost().innerHTML.includes('atb list'), `切回最近执行后条目应保留，得到：${JSON.stringify(h.recentHost().innerHTML.slice(0, 120))}`);
});

t('T3 成功执行后离开再进入命令模块（enter 幂等路径），最近执行条目仍显示', async () => {
  const h = setup();
  await runListOnce(h);
  await h.sandbox.ATBCommands.enter('/p'); // 离开模块后再次进入（清单已就绪走幂等分支）
  assert.equal(h.sandbox.ATBCommands.snapshot().tab, 'recent', '再次进入默认回到最近执行页签');
  assert.ok(h.recentHost().innerHTML.includes('atb list'), `再进入后条目应保留，得到：${JSON.stringify(h.recentHost().innerHTML.slice(0, 120))}`);
});

t('T4 控制用例：页签切换与命令列表渲染零回归（切 all 后可搜到命令、详情可执行入口）', async () => {
  const h = setup();
  await h.sandbox.ATBCommands.enter('/p');
  await h.ltab('all').fire('click');
  assert.equal(h.sandbox.ATBCommands.snapshot().tab, 'all');
  assert.ok(h.allHost().innerHTML.includes('atb show'), '全部命令列表含 show');
  const item = h.commandsView.querySelectorAll('.cmd-item').find((b) => b.dataset.c === 'show');
  await item.fire('click');
  assert.ok(h.document.querySelector('#commandsView .cmd-detail').innerHTML.includes('atb show'), '点选后右侧详情加载');
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
