#!/usr/bin/env node
// REQ-20260922-001 命令看板隐藏 AI Agent 工作流命令 —— 注册表标记 / API 过滤与拒绝 / 前端残留过滤测试。
// C1：注册表 agentOnly 标记与 visibleGroups 过滤口径（注册表命令面不变，C1 同步校验不回归）。
// C2：服务端 /api/cli/commands 只下发可见分组；/api/cli/run 对 agentOnly 命令拒绝（防绕过界面直接调接口）。
// C3：前端 commands.js（vm 沙箱，沿用 bug-20260921-010 口径）：最近执行残留过滤、全隐藏空态、搜索空态、保留命令回归。
// 设计（条目 design.md）：隐藏仅看板展示层——注册表保留全部命令（findCommand 白名单 / CLI 同步测试口径不变），
// agentOnly 命令经 /api/cli/run 一并拒绝：所需 RUN-ID / 批次 ID / 会话标识只存在于 Agent 会话，
// 网页（人工入口）执行无意义且徒增误触发风险（batch delete / refine abort 高危）。
// 用法：node scripts/tests/req-20260922-001.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as cliRegistry from '../lib/cli-registry.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 10000,
    }, (rs) => {
      const chunks = [];
      rs.on('data', (c) => chunks.push(c));
      rs.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString() || '{}'); } catch {}
        resolve({ status: rs.statusCode, json, text: buf.toString() });
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 隐藏范围口径（README「隐藏范围（默认清单）」）
const HIDDEN_GROUPS = ['batch', 'run', 'refine', 'summary', 'translate']; // 整组隐藏（组 id）
const HIDDEN_NAMES = ['claim', 'report', 'hold declare'];                  // 组内隐藏（Agent 例行操作）
const KEPT_LIFECYCLE = ['new req', 'new bug', 'rename', 'delete', 'status', 'move', 'prune-locks'];
const KEPT_HOLD = ['hold list', 'hold show', 'hold answer', 'hold resume', 'hold cancel'];
const isHidden = (name) => {
  const top = name.split(' ')[0];
  return HIDDEN_GROUPS.includes(top) || HIDDEN_NAMES.includes(name);
};

/* ---------- C1 注册表标记与 visibleGroups ---------- */

t('C1a 注册表命令面不变：隐藏范围带 agentOnly 标记，allCommands 仍含全部命令', () => {
  const all = cliRegistry.allCommands();
  const names = all.map((c) => c.name);
  // 隐藏范围（五组全组 + 组内三命令）全部仍在注册表（CLI 同步 / 白名单口径不变）
  for (const g of cliRegistry.CLI_GROUPS) {
    for (const c of g.commands) {
      assert.ok(names.includes(c.name), `注册表仍应包含 ${c.name}（隐藏不得以删除命令方式实现）`);
    }
  }
  // 归一化口径：allCommands 每条命令的 agentOnly 与隐藏范围一致（五组整组隐藏 + 组内三命令）
  for (const c of all) {
    assert.equal(!!c.agentOnly, isHidden(c.name), `${c.name} 的 agentOnly 标记应与隐藏口径一致`);
  }
  // 整组隐藏的五组：组级标记（全组隐藏 = 组内无保留命令，新增命令不会漏标）
  for (const gid of HIDDEN_GROUPS) {
    const g = cliRegistry.CLI_GROUPS.find((x) => x.id === gid);
    assert.ok(g, `注册表应仍有分组 ${gid}`);
    assert.equal(g.agentOnly, true, `${gid} 组应带组级 agentOnly 标记`);
    assert.ok(g.commands.length > 0, `${gid} 组应仍有命令（注册表命令面不变）`);
  }
});

t('C1b visibleGroups：五组整体消失（无空分组标题残留），组内隐藏后其余命令保留', () => {
  const groups = cliRegistry.visibleGroups();
  const labels = groups.map((g) => g.label);
  for (const gone of ['AI 开发', 'AI 分析', '执行回执', '发布文档 AI 总结', '发布文档 AI 翻译']) {
    assert.ok(!labels.includes(gone), `可见分组不应再出现「${gone}」`);
  }
  for (const g of groups) assert.ok((g.commands || []).length > 0, `分组「${g.label}」不应残留空分组标题`);
  const flat = groups.flatMap((g) => g.commands.map((c) => c.name));
  for (const n of flat) assert.ok(!isHidden(n), `可见清单不应含隐藏命令 ${n}`);
  // 组内隐藏：同组其余命令保留
  const lifecycle = groups.find((g) => g.label === '条目生命周期');
  const hold = groups.find((g) => g.label === '人工决策');
  assert.deepEqual((lifecycle?.commands || []).map((c) => c.name), KEPT_LIFECYCLE, '条目生命周期组应保留人工命令（claim / report 隐藏）');
  assert.deepEqual((hold?.commands || []).map((c) => c.name), KEPT_HOLD, '人工决策组应保留人工命令（hold declare 隐藏）');
  // 保留组完整
  const kept = ['init', 'migrate', 'rebuild', 'pack', 'confirm list', 'confirm show', 'list', 'show', 'commit log', 'commit which', 'serve', 'cli install', 'cli uninstall', 'cli status'];
  for (const n of kept) assert.ok(flat.includes(n), `保留命令 ${n} 应在可见清单`);
  // visibleGroups 不得改动注册表本体（过滤返回副本）
  assert.equal(cliRegistry.CLI_GROUPS.length, 12, '注册表本体分组数不变（12）');
});

t('C1c validateRunRequest：agentOnly 命令拒绝下发（参数齐全也拒绝），保留命令照常通过', () => {
  for (const [name, args] of [
    ['batch create', []],
    ['run receipt', ['run-20260921-001', '--result', 'reported', '--report-ref', 'test-report.md']],
    ['refine next', ['--by', 'dev-1']],
    ['claim', ['REQ-20260922-001', '--by', 'dev-1']],
    ['report', ['REQ-20260922-001', '--coverage', '5', '--framework', 'node', '--summary', 's', '--by', 'dev-1']],
    ['hold declare', ['REQ-20260922-001', '--question', 'q']],
  ]) {
    const v = cliRegistry.validateRunRequest({ command: name, args });
    assert.equal(v.ok, false, `${name} 属 Agent 会话命令，网页下发应拒绝`);
    assert.match(v.error, /Agent/, `拒绝原因应说明属 Agent 会话命令：${v.error}`);
  }
  const ok = cliRegistry.validateRunRequest({ command: 'show', args: ['REQ-20260922-001'] });
  assert.equal(ok.ok, true, '保留命令照常通过');
});

/* ---------- C2 服务端 ---------- */

t('C2 /api/cli/commands 只下发可见分组；/api/cli/run 拒绝 agentOnly 命令', async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-hide-agent-')));
  const projA = path.join(tmp, 'projA');
  fs.mkdirSync(projA);
  core.initData(projA);
  const reg = path.join(tmp, 'reg.json');
  const spawnOnPort = async (port) => {
    const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
      cwd: projA,
      env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: reg },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try {
        const h = await req(port, 'GET', '/api/health');
        if (h.json && h.json.port === port) return child;
      } catch {}
      if (child.exitCode !== null) break;
    }
    child.kill('SIGTERM');
    return null;
  };
  let server = null;
  let port = 0;
  for (let i = 0; i < 6 && !server; i++) {
    port = 31000 + Math.floor(Math.random() * 20000);
    server = await spawnOnPort(port);
  }
  assert.ok(server, `服务应启动（最后端口 ${port}）`);
  const P = `?project=${encodeURIComponent(projA)}`;
  try {
    // C2a 清单：可见分组 7 个，隐藏五组与组内三命令不出现，保留命令在
    let r = await req(port, 'GET', '/api/cli/commands');
    assert.equal(r.status, 200, `清单应可用：${r.text}`);
    assert.equal(r.json.groups.length, 7, `可见分组应 7（12 − 整组隐藏 5）：${r.json.groups.length}`);
    const flat = r.json.groups.flatMap((g) => g.commands.map((c) => c.name));
    for (const n of flat) assert.ok(!isHidden(n), `清单不应含隐藏命令 ${n}`);
    for (const gone of ['batch next', 'run receipt', 'refine next', 'summary start', 'translate show', 'claim', 'report', 'hold declare']) {
      assert.ok(!flat.includes(gone), `清单不应再出现 ${gone}`);
    }
    for (const keep of ['init', 'new req', 'rename', 'delete', 'status', 'move', 'prune-locks', 'hold list', 'hold answer', 'confirm list', 'list', 'commit which', 'serve', 'cli status']) {
      assert.ok(flat.includes(keep), `保留命令 ${keep} 应在清单`);
    }

    // C2b 下发拒绝：agentOnly 命令（参数齐全）400，不经执行直接拒绝
    r = await req(port, 'POST', `/api/cli/run${P}`, {
      command: 'run receipt',
      args: ['run-20260921-001', '--result', 'reported', '--report-ref', 'test-report.md'],
    });
    assert.equal(r.status, 400, `agentOnly 命令网页下发应 400：${r.text}`);
    assert.match(r.json.error || '', /Agent/, '拒绝原因应说明属 Agent 会话命令');
    // 保留命令链路不受影响（下发成功受理）
    r = await req(port, 'POST', `/api/cli/run${P}`, { command: 'list', args: [] });
    assert.equal(r.status, 200, `保留命令照常受理：${r.text}`);
    // 收敛执行结果（防悬挂；服务退出前等 job 结束）
    const deadline = Date.now() + 20000;
    for (;;) {
      const s = await req(port, 'GET', `/api/cli/run-status${P}`);
      if (s.status === 404) break; // 无记录（服务重启口径）视作结束
      if (s.status === 200 && !s.json.running) break;
      if (Date.now() > deadline) throw new Error('list 执行未在时限内结束');
      await sleep(150);
    }
  } finally {
    server.kill('SIGTERM');
    await sleep(200);
  }
});

/* ---------- C3 前端（vm 沙箱驱动真实 commands.js） ---------- */

const commandsJs = fs.readFileSync(path.join(webRoot, 'commands.js'), 'utf8');
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

// 可见清单（与 C2a 同口径：隐藏命令不在 catalog，模拟 /api/cli/commands 过滤后的数据）
const CATALOG = [
  { name: 'list', desc: '列出条目（含各状态计数）' },
  { name: 'show', desc: '查看条目详情', args: [{ label: 'ID', required: true }] },
  { name: 'hold list', desc: '待人工确认清单' },
];

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

function setup({ storage = makeStorage() } = {}) {
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
    localStorage: storage,
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

const recentRec = (name, at = '08:02:11') => ({ name, vals: {}, extra: '', at });

t('C3a 最近执行残留过滤：batch next 记录被忽略，list 保留（不报错）', async () => {
  const storage = makeStorage();
  storage.setItem('atb.cmd.recents:/p', JSON.stringify([recentRec('batch next'), recentRec('list', '07:58:40')]));
  const h = setup({ storage });
  await h.sandbox.ATBCommands.enter('/p');
  const html = h.recentHost().innerHTML;
  assert.ok(!html.includes('batch next'), `隐藏命令残留记录不应展示：${JSON.stringify(html.slice(0, 160))}`);
  assert.ok(html.includes('atb list'), '保留命令记录应照常展示');
});

t('C3b 最近执行全为隐藏命令时显示空态提示，不显示空白', async () => {
  const storage = makeStorage();
  storage.setItem('atb.cmd.recents:/p', JSON.stringify([recentRec('batch next'), recentRec('run receipt', '07:50:00')]));
  const h = setup({ storage });
  await h.sandbox.ATBCommands.enter('/p');
  const html = h.recentHost().innerHTML;
  assert.ok(html.includes('暂无最近执行'), `全为隐藏命令应显示空态提示：${JSON.stringify(html.slice(0, 160))}`);
  assert.ok(!html.includes('batch next') && !html.includes('run receipt'), '隐藏命令不出现');
  assert.ok(html.includes('全部命令'), '空态应引导切换「全部命令」');
});

t('C3c 搜索隐藏命令名落入「无匹配命令」空态并可清除恢复；保留命令仍正常过滤', async () => {
  const h = setup();
  await h.sandbox.ATBCommands.enter('/p');
  await h.ltab('all').fire('click');
  const search = h.commandsView.querySelector('#cmdSearch');
  for (const q of ['batch', 'refine', 'run receipt']) {
    search.value = q;
    await search.fire('input');
    const html = h.allHost().innerHTML;
    assert.ok(html.includes('无匹配命令'), `搜索「${q}」应落入无匹配空态：${JSON.stringify(html.slice(0, 120))}`);
  }
  search.value = 'hold';
  await search.fire('input');
  assert.ok(h.allHost().innerHTML.includes('atb hold list'), '搜索保留命令仍正常过滤');
  // 清除搜索恢复
  search.value = '';
  await search.fire('input');
  assert.ok(h.allHost().innerHTML.includes('atb list'), '清除搜索后清单恢复');
});

t('C3d 保留命令行为回归：list 执行成功计入最近执行，详情回填不变', async () => {
  const storage = makeStorage();
  const h = setup({ storage });
  await h.sandbox.ATBCommands.enter('/p');
  await h.ltab('all').fire('click');
  const item = h.commandsView.querySelectorAll('.cmd-item').find((b) => b.dataset.c === 'list');
  await item.fire('click');
  await h.detailHost().querySelector('#cmdRun').fire('click');
  await new Promise((r) => setTimeout(r, 20)); // 等 pollResult 收敛 withDone
  const html = h.recentHost().innerHTML;
  assert.ok(html.includes('atb list'), '成功执行后最近执行应计入');
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
