#!/usr/bin/env node
// BUG-20260921-010 刷新后，最近执行的命令看不见了 —— 根因：commands.js 的 state.recents
// （最近执行）为模块级内存态，浏览器刷新后 JS 上下文重建、recents 归零；服务端
// /api/cli/run-status 仅存单槽内存 job（会话内口径，重启即丢），无可恢复的最近执行清单。
// 引入来源：REQ-20260920-004（commit 12ac4ae 引入 commands.js，recents 自始为内存态）。
// 修复：recents 持久化 localStorage（key：atb.cmd.recents:<项目根>，按项目隔离；
//   localStorage 不可用 / 数据损坏时 try-catch 降级为会话内行为，不崩不阻塞执行）。
// —— 用例（vm 沙箱驱动真实 commands.js；「刷新」= 同一 fake localStorage 下全新沙箱
//   重新加载 commands.js，模拟浏览器刷新后的全新 JS 上下文）：
//   T1 成功执行后「刷新」页面，最近执行列表仍显示该命令（不再回到空态）；
//   T2 刷新后点击最近执行条目，右侧回填该次参数与附加参数（带参命令 show 验证）；
//   T3 项目隔离：/p 的最近执行不串到 /q（切项目后各看各的）；
//   T4 localStorage 不可用（未注入）时降级会话内行为：执行正常、会话内可见，刷新后为空态；
//   T5 持久化数据损坏（非法 JSON / 字段结构不对）时回退空态不崩；
//   T6 刷新后保持既有口径：按命令去重（同命令重复执行仍只占 1 条）。
// 用法：node scripts/tests/bug-20260921-010.test.mjs

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

/* ---------- fake DOM（沿用 bug-20260921-009 口径）+ fake localStorage ---------- */

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
      const fns = [...(el.listeners[ev] || [])];
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
    set: (v) => { resetSubtree(el); el._html = v; },
  });
  return el;
}

function resetSubtree(node) {
  node._html = '';
  node.listeners = {};
  for (const child of node._q.values()) resetSubtree(child);
  node._q.clear();
}

const CATALOG = [
  { name: 'list', desc: '列出条目' },
  { name: 'show', desc: '查看条目', args: [{ label: '条目 ID', required: true }] },
];

// fake localStorage：跨沙箱共享（同一浏览器域下刷新前后共用同一份存储）
function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
  };
}

function setup({ storage = makeStorage(), injectStorage = true } = {}) {
  const document = makeEl('#document');
  const commandsView = document.querySelector('#commandsView');
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
    if (sel === '.cmd-params input') {
      // 参数输入节点：按 CATALOG 全量懒造（dataset.k = 参数 label；真实 DOM 只渲染当前命令的，
      // 多余节点仅被无害绑定，不会触发）
      return cached(sel, () => CATALOG.flatMap((c) => (c.args || []).map((a) => {
        const inp = makeEl(`input[${c.name}/${a.label}]`);
        inp.dataset.k = a.label;
        return inp;
      })));
    }
    return [];
  };
  Object.defineProperty(commandsView, 'innerHTML', {
    configurable: true,
    get: () => commandsView._html,
    set: (v) => {
      resetSubtree(commandsView);
      for (const [k, node] of document._q) if (k !== '#commandsView') resetSubtree(node);
      listCache.clear();
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
    ...(injectStorage ? { localStorage: storage } : {}),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(commandsJs, sandbox, { filename: 'commands.js' });
  const recentHost = () => document.querySelector('#commandsView .cmd-list[aria-label^="最近执行列表"]');
  const allHost = () => document.querySelector('#commandsView .cmd-list[aria-label="命令列表"]');
  const detailHost = () => document.querySelector('#commandsView .cmd-detail');
  const ltab = (tab) => commandsView.querySelectorAll('.cmd-ltab').find((b) => b.dataset.tab === tab);
  return { sandbox, document, commandsView, recentHost, allHost, detailHost, ltab };
}

async function runOnce(h, name, { arg = null, extra = '' } = {}) {
  // 进入模块 → 切「全部命令」→ 点选命令 →（可选）填参数与附加参数 → 执行 → 轮询收敛
  await h.sandbox.ATBCommands.enter('/p');
  await h.ltab('all').fire('click');
  const item = h.commandsView.querySelectorAll('.cmd-item').find((b) => b.dataset.c === name);
  await item.fire('click');
  const detail = h.document.querySelector('#commandsView .cmd-detail');
  if (arg != null) {
    const inp = detail.querySelectorAll('.cmd-params input')[0];
    inp.value = arg;
    await inp.fire('input');
  }
  if (extra) {
    const ex = detail.querySelector('#cmdExtra');
    ex.value = extra;
    await ex.fire('input');
  }
  await detail.querySelector('#cmdRun').fire('click');
  await new Promise((r) => setTimeout(r, 20)); // 等 pollResult 收敛 withDone
}

/* ---------- 用例 ---------- */

t('T1 成功执行后「刷新」页面，最近执行列表仍显示该命令（不再回到空态）', async () => {
  const storage = makeStorage();
  const h1 = setup({ storage });
  await runOnce(h1, 'list');
  assert.ok(h1.recentHost().innerHTML.includes('atb list'), '执行成功后本会话最近执行应展示该命令');
  // 「刷新」：同一 localStorage、全新沙箱重新加载 commands.js（JS 上下文重建）
  const h2 = setup({ storage });
  await h2.sandbox.ATBCommands.enter('/p');
  assert.equal(h2.sandbox.ATBCommands.snapshot().tab, 'recent', '刷新后进入仍默认最近执行页签');
  const html = h2.recentHost().innerHTML;
  assert.ok(html.includes('atb list'), `刷新后最近执行应恢复显示，得到：${JSON.stringify(html.slice(0, 120))}`);
  assert.ok(!html.includes('暂无最近执行'), '刷新后不应显示空态提示');
});

t('T2 刷新后点击最近执行条目，右侧回填该次参数与附加参数', async () => {
  const storage = makeStorage();
  const h1 = setup({ storage });
  await runOnce(h1, 'show', { arg: 'REQ-1', extra: '--json' });
  assert.ok(h1.recentHost().innerHTML.includes('atb show'), '带参执行成功后最近执行应展示 show');
  const h2 = setup({ storage }); // 刷新
  await h2.sandbox.ATBCommands.enter('/p');
  const item = h2.commandsView.querySelectorAll('.cmd-item').find((b) => b.dataset.c === 'show');
  await item.fire('click');
  const html = h2.detailHost().innerHTML;
  assert.ok(html.includes('value="REQ-1"'), `刷新后点击最近执行应回填参数值，得到：${JSON.stringify(html.slice(0, 200))}`);
  assert.ok(html.includes('value="--json"'), '刷新后点击最近执行应回填附加参数');
  // 回填反馈写在内联 <p> 节点（textContent），fake DOM 不回写 innerHTML 字符串，从节点断言
  assert.ok(h2.document.querySelector('#cmdDetailFb').textContent.includes('已回填该命令最近一次执行参数'), '应出现回填反馈提示');
});

t('T3 项目隔离：/p 的最近执行不串到 /q（切项目后各看各的）', async () => {
  const storage = makeStorage();
  const h1 = setup({ storage });
  await runOnce(h1, 'list');
  const h2 = setup({ storage });
  await h2.sandbox.ATBCommands.enter('/q');
  const html = h2.recentHost().innerHTML;
  assert.ok(html.includes('暂无最近执行'), `/q 无最近执行应显示空态，得到：${JSON.stringify(html.slice(0, 80))}`);
  await h2.sandbox.ATBCommands.enter('/p');
  assert.ok(h2.recentHost().innerHTML.includes('atb list'), '切回 /p 后最近执行恢复（同会话切项目也从持久化恢复）');
});

t('T4 localStorage 不可用（未注入）时降级会话内行为：执行正常、会话内可见，刷新后为空态不崩', async () => {
  const storage = makeStorage(); // 共享对象但两边都不注入（模拟禁用存储的浏览器）
  const h1 = setup({ storage, injectStorage: false });
  await runOnce(h1, 'list');
  assert.ok(h1.recentHost().innerHTML.includes('atb list'), '无 localStorage 时执行与会话内最近执行仍正常');
  const h2 = setup({ storage, injectStorage: false }); // 刷新
  await h2.sandbox.ATBCommands.enter('/p');
  assert.ok(h2.recentHost().innerHTML.includes('暂无最近执行'), '降级口径：刷新后回到空态（会话内行为），不崩');
});

t('T5 持久化数据损坏（非法 JSON / 字段结构不对）时回退空态不崩', async () => {
  const s1 = makeStorage();
  s1.setItem('atb.cmd.recents:/p', '{bad json');
  const h1 = setup({ storage: s1 });
  await h1.sandbox.ATBCommands.enter('/p');
  assert.ok(h1.recentHost().innerHTML.includes('暂无最近执行'), '非法 JSON 应回退空态');
  const s2 = makeStorage();
  s2.setItem('atb.cmd.recents:/p', JSON.stringify([{ name: 42 }, { nope: true }, 'x']));
  const h2 = setup({ storage: s2 });
  await h2.sandbox.ATBCommands.enter('/p');
  assert.ok(h2.recentHost().innerHTML.includes('暂无最近执行'), '字段结构不对应过滤为空，不渲染也不崩');
});

t('T6 刷新后保持按命令去重口径：同命令重复执行仍只占 1 条', async () => {
  const storage = makeStorage();
  const h1 = setup({ storage });
  await runOnce(h1, 'list');
  await runOnce(h1, 'list');
  const h2 = setup({ storage }); // 刷新
  await h2.sandbox.ATBCommands.enter('/p');
  const html = h2.recentHost().innerHTML;
  const n = (html.match(/<code>atb list<\/code>/g) || []).length; // 每条目 code 标签 1 次（aria-label 另计）
  assert.equal(n, 1, `同命令重复执行去重为 1 条，实际 ${n}`);
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
