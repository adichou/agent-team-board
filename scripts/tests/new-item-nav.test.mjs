#!/usr/bin/env node
// REQ-20260908-017：创建完单后直接返回列表即可（修订 REQ-20260906-016 的自动导航）。
// 加载实际 app.js（参照 accept-ui.test.mjs 的 vm + 模拟 DOM 方式）。
// 用法：node scripts/tests/new-item-nav.test.mjs
// 覆盖 test-cases.md 的 A1–A8（本文件 N1–N8）；M1/M2 为浏览器人工验收。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const item = (id, createdAt, extra = {}) => ({
  id, type: id.startsWith('BUG') ? 'bug' : 'requirement', status: 'submitted', title: id,
  createdAt: createdAt || '2099-01-01T00:00:00.000Z', ...extra,
});

// DOM 接缝只记录控件属性、事件与内容；布局由界面检查覆盖。
function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    dataset: {}, innerHTML: '', textContent: '', value: '', disabled: false, checked: false, indeterminate: false,
    children: [], listeners: {},
    classList: {
      add: (v) => classes.add(v), remove: (v) => classes.delete(v),
      contains: (v) => classes.has(v), toggle: (v, on) => (on ? classes.add(v) : classes.delete(v)),
    },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {},
    fire(event) {
      const e = { target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } };
      return { e, result: this.listeners[event]?.(e) };
    },
  };
}

function setup() {
  const document = element();
  document.createElement = element;
  // 覆盖层默认视为关闭（hidden），与真实页面初始态一致
  for (const sel of ['#modalWrap', '#batchDrawer', '#drawer', '#mask']) {
    document.querySelector(sel).classList.add('hidden');
  }
  const requests = [], notices = [], opened = [], refreshes = [];
  const sandbox = {
    document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {} },
    window: { addEventListener() {}, confirm: () => true },
    fetch: async (url, opts) => { requests.push({ url, opts }); return { ok: true, json: async () => ({}) }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  state.board = { initialized: true, items: [] };
  sandbox.recordNotice = (message, error) => notices.push({ message, error });
  sandbox.recordOpen = (id) => { opened.push(id); state.drawer.id = id; };
  sandbox.recordRefresh = () => refreshes.push(1);
  run('toast = recordNotice; updateBoardTabs = () => {}; markActiveTab = () => {}; refreshHealth = async () => {}; renderBoard = () => {}; renderDrawer = () => {}; refreshDrawer = recordRefresh;');
  return { sandbox, document, state, run, requests, notices, opened, refreshes };
}

// 让 fetch 依次返回可变的看板数据（generatedAt 每轮变化已被轮询签名排除）
function boardResponder(h) {
  let board = { initialized: true, items: [] };
  h.sandbox.fetch = async () => ({ ok: true, json: async () => JSON.parse(JSON.stringify(board)) });
  return {
    set items(v) { board.items = v; },
    get items() { return board.items; },
  };
}

t('N1 基线播种：首轮 poll 只登记全部 id，不导航不开抽屉', async () => {
  const h = setup();
  const board = boardResponder(h);
  board.items = [item('REQ-20990101-001'), item('BUG-20990101-001')];
  await h.run('poll()');
  assert.ok(h.state.knownIds, '首轮应建立 knownIds 基线');
  assert.deepEqual([...h.state.knownIds].sort(), ['BUG-20990101-001', 'REQ-20990101-001']);
  assert.equal(h.state.drawer.id, null, '首轮加载不得导航');
  assert.equal(h.notices.length, 0);
});

t('N2 CLI 新建检测：poll 出现新 REQ → 列表刷新出新单，但不导航、不弹「已定位新建条目」', async () => {
  const h = setup();
  const board = boardResponder(h);
  board.items = [item('REQ-20990101-001')];
  await h.run('poll()');
  board.items = [item('REQ-20990101-001'), item('REQ-20990101-002', '2099-01-02T00:00:00.000Z')];
  await h.run('poll()');
  assert.equal(h.state.drawer.id, null, 'REQ-20260908-017：轮询检测到新单不得自动跳转');
  assert.equal(h.notices.length, 0, '不得再弹「已定位新建条目」提示');
  assert.ok(h.state.board.items.some((it) => it.id === 'REQ-20990101-002'), '列表数据应随轮询刷新出新单');
  assert.ok(h.state.knownIds.has('REQ-20990101-002'), '新单仍应登记进基线');
});

t('N3 多条新单：全部登记基线，无任何导航；后续轮询不补跳', async () => {
  const h = setup();
  const board = boardResponder(h);
  board.items = [item('REQ-20990101-001')];
  await h.run('poll()');
  board.items = [
    item('REQ-20990101-001'),
    item('BUG-20990101-002', '2099-01-02T00:00:00.000Z'),
    item('REQ-20990101-003', '2099-01-03T00:00:00.000Z'),
  ];
  await h.run('poll()');
  assert.equal(h.state.drawer.id, null, '多条新单也不得导航');
  assert.equal(h.notices.length, 0);
  board.items.push(item('REQ-20990101-004', '2099-01-04T00:00:00.000Z'));
  await h.run('poll()');
  assert.deepEqual([...h.state.knownIds].sort(), ['BUG-20990101-002', 'REQ-20990101-001', 'REQ-20990101-003', 'REQ-20990101-004'], '全部新 id 都应登记');
  assert.equal(h.state.drawer.id, null, '已登记的单后续轮询不补跳');
});

t('N4 无新单：数据变化不触发导航，已打开的抽屉仅常规刷新', async () => {
  const h = setup();
  const board = boardResponder(h);
  board.items = [item('REQ-20990101-001')];
  await h.run('poll()');
  h.run('state.drawer.id = "REQ-20990101-001"'); // 模拟用户此前手动打开的详情
  const before = h.refreshes.length;
  board.items[0].title = '标题更新';
  board.items[0].updatedAt = '2099-01-05T00:00:00.000Z';
  await h.run('poll()');
  assert.equal(h.state.drawer.id, 'REQ-20990101-001', '既有抽屉不得被切换或关闭');
  assert.ok(h.refreshes.length > before, '已有抽屉应走常规刷新路径');
});

t('N5 弹窗路径：创建成功后关闭弹窗并停留列表，不导航；失败时弹窗保留、报错、不导航', async () => {
  const h = setup();
  h.run('openDrawer = recordOpen');
  h.document.querySelector('#fType').value = 'bug';
  h.document.querySelector('#fTitle').value = '新 Bug';
  h.document.querySelector('#fDesc').value = '';
  h.document.querySelector('#fParent').value = '';
  h.sandbox.fetch = async (url, opts) => {
    h.requests.push({ url, opts });
    if (String(url).includes('/api/new')) return { ok: true, json: async () => ({ id: 'BUG-20990101-009', status: 'submitted' }) };
    return { ok: true, json: async () => ({ initialized: true, items: [] }) };
  };
  await h.run("submitNew({ preventDefault() {} })");
  assert.deepEqual(h.opened, [], 'REQ-20260908-017：创建成功后不得自动打开详情抽屉');
  assert.equal(h.document.querySelector('#modalWrap').classList.contains('hidden'), true, '成功后应关闭弹窗');
  assert.match(h.notices.at(-1).message, /✓ 已创建 BUG-20990101-009（待接受）/, '成功仍应 toast 创建成功');
  assert.equal(h.state.drawer.id, null, '抽屉保持未打开');

  h.opened.length = 0;
  h.document.querySelector('#modalWrap').classList.remove('hidden');
  h.sandbox.fetch = async (url, opts) => {
    h.requests.push({ url, opts });
    return { ok: false, json: async () => ({ error: '标题不能为空' }) };
  };
  await h.run("submitNew({ preventDefault() {} })");
  assert.deepEqual(h.opened, [], '失败时不得导航');
  assert.equal(h.document.querySelector('#modalWrap').classList.contains('hidden'), false, '失败时弹窗应保留');
  assert.match(h.notices.at(-1).message, /标题不能为空/);
  assert.equal(h.notices.at(-1).error, true, '失败应为错误 toast');
  assert.equal(h.document.querySelector('#fSubmit').disabled, false, '失败后按钮应恢复可重试');
});

t('N6 护栏：弹窗打开期间轮询不导航，id 照常登记；关闭后不补跳', async () => {
  const h = setup();
  const board = boardResponder(h);
  board.items = [item('REQ-20990101-001')];
  await h.run('poll()');
  h.document.querySelector('#modalWrap').classList.remove('hidden');
  board.items = [item('REQ-20990101-001'), item('REQ-20990101-002', '2099-01-02T00:00:00.000Z')];
  await h.run('poll()');
  assert.equal(h.state.drawer.id, null, '弹窗打开期间不得抢跳');
  assert.ok(h.state.knownIds.has('REQ-20990101-002'), '护栏期间新单仍要登记');
  h.document.querySelector('#modalWrap').classList.add('hidden');
  board.items[1].title = '改标题触发签名变化';
  await h.run('poll()');
  assert.equal(h.state.drawer.id, null, '关闭弹窗后不得补跳已登记的单');
});

t('N7 切换项目：knownIds 重置为新项目基线，既有条目不算新建', async () => {
  const h = setup();
  const board = boardResponder(h);
  board.items = [item('REQ-20990101-001')];
  await h.run('poll()');
  assert.ok(h.state.knownIds.has('REQ-20990101-001'));
  h.sandbox.fetch = async () => ({
    ok: true,
    json: async () => ({ initialized: true, items: [item('REQ-20991231-777')] }),
  });
  await h.run("switchProject('/project/b')");
  assert.equal(h.state.project, '/project/b');
  assert.equal(h.state.drawer.id, null, '新项目既有条目不得触发导航');
  assert.deepEqual([...h.state.knownIds], ['REQ-20991231-777'], '基线应重置为新项目条目');
});

t('N8 静态契约：poll 接线 detectNewItem 仅登记基线不导航；submitNew 无 openDrawer/reveal；switchProject / btnInit 重置基线保留', () => {
  // 旧文本标记（列结构与拖拽监听 / 批量实施抽屉）已随后续重构改名失效，改为按函数体提取
  const topFn = (header) => {
    const start = source.indexOf(header);
    assert.ok(start >= 0, `缺少 ${header}`);
    const end = source.indexOf('\n}', start);
    return source.slice(start, end + 2);
  };
  const pollBlock = topFn('async function poll()');
  assert.match(pollBlock, /detectNewItem\(/, 'poll 内应调用 detectNewItem（基线登记保留）');
  assert.doesNotMatch(pollBlock, /openDrawer\(/, 'poll 不得再调用 openDrawer（REQ-20260908-017）');
  assert.doesNotMatch(source, /已定位新建条目/, '「已定位新建条目」提示应整体移除');
  const submitBlock = topFn('async function submitNew');
  assert.doesNotMatch(submitBlock, /openDrawer\(/, 'submitNew 成功后不得再导航到新单');
  // REQ-20260909-004：讨论创建成功后 reveal 定位新讨论并直接展示启动提示词（需求/Bug 仍不导航）
  // REQ-20260909-013：讨论类型入口随讨论模块暂态隐藏，分支暂不可达；机制与跳转代码保留，恢复即生效
  const askBranch = submitBlock.slice(submitBlock.indexOf("type === 'ask'"), submitBlock.indexOf('} else {'));
  assert.doesNotMatch(submitBlock.replace(askBranch, ''), /reveal\(/, '需求/Bug 分支不得 reveal');
  assert.match(askBranch, /ATBOncall\?\.reveal|ATBOncall\.reveal/, '讨论分支应 reveal 定位并展示启动提示词（分支保留待恢复）');
  assert.match(submitBlock, /setView\('status'\)/, '需求/Bug 创建成功仍进入需求模块');
  assert.match(submitBlock, /setView\('oncall'\)/, '讨论单创建进入讨论模块的分支保留（入口已暂隐藏，setView 兜底回落需求模块）');
  const switchBlock = source.slice(source.indexOf('async function switchProject'), source.indexOf('/* ---------- File Board'));
  assert.match(switchBlock, /state\.knownIds = null/, 'switchProject 应重置基线');
  assert.match(source.slice(source.indexOf("$('#btnInit')")), /state\.knownIds = null/, 'btnInit 初始化后应重置基线');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
