#!/usr/bin/env node
// REQ-20260906-017：加载实际前端函数，通过事件与模拟网络验证单条/批量接受。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const item = (id, type = 'requirement', status = 'submitted', parent = null) => ({ id, type, status, parent, title: id });
const sample = () => [item('REQ-20990101-001'), item('BUG-20990101-001', 'bug'), item('BUG-20990101-002', 'bug', 'submitted', 'REQ-20990101-001'), item('REQ-20990101-002', 'requirement', 'accepted')];

// DOM 接缝只记录控件属性、事件与内容；布局由界面检查覆盖。
function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    dataset: {}, innerHTML: '', textContent: '', disabled: false, checked: false, indeterminate: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {},
    fire(event) { const e = { target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
}

function setup() {
  const document = element();
  document.createElement = element;
  const requests = [], confirmations = [], notices = [];
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {} },
    window: { addEventListener() {}, confirm: (message) => { confirmations.push(message); return true; } },
    fetch: async (url, opts) => { requests.push({ url, opts }); return { ok: true, json: async () => ({}) }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  state.board = { initialized: true, items: sample() };
  sandbox.recordNotice = (message, error) => notices.push({ message, error });
  sandbox.recordConfirm = (text) => confirmations.push(text);
  // BUG-20260907-009：二次确认改页面内异步 uiConfirm；stub 记录弹窗文案并视为确认
  run('uiConfirm = (o) => { recordConfirm(`${o.title}\n${o.message || ""}`); return true; };');
  run('toast = recordNotice; updateBoardTabs = () => {}; markActiveTab = () => {}; refreshHealth = async () => {}; refreshDrawer = async () => {}; poll = async () => {};');
  return { sandbox, document, state, run, requests, confirmations, notices };
}

t('A1 列表头右组：零选择禁用、部分选中计数、清零收起与空态禁用（REQ-20260909-002 并入列表头）', () => {
  const h = setup();
  h.run('syncAcceptance()');
  assert.equal(h.document.querySelector('#acceptSelected').disabled, true, '零选择应禁用接受所选');
  // 勾选三条待接受（等价于行复选框 change 后的集合状态；REQ-002 为 accepted 不在此列）
  for (const id of ['REQ-20990101-001', 'BUG-20990101-001', 'BUG-20990101-002']) h.state.acceptance.selected.add(id);
  h.run('syncAcceptance()');
  assert.equal(h.document.querySelector('#acceptSelected').disabled, false);
  assert.match(h.document.querySelector('#selCount').textContent, /已选 3 项/);
  assert.equal(h.document.querySelector('#selGroup').classList.contains('hidden'), false, '有勾选时列表头右组出现');
  h.state.acceptance.selected.delete('BUG-20990101-001');
  h.run('syncAcceptance()');
  assert.match(h.document.querySelector('#selCount').textContent, /已选 2 项/);
  h.state.acceptance.selected.clear();
  h.run('syncAcceptance()');
  assert.equal(h.document.querySelector('#selGroup').classList.contains('hidden'), true, '清零后列表头右组收起');
  h.state.board.items = [];
  h.run('syncAcceptance()');
  assert.equal(h.document.querySelector('#selectOperable').disabled, true, '无待接受条目应禁用选择入口');
});

t('A2 卡片控件：三类条目选择不打开详情，其他状态无接受控件', async () => {
  const h = setup();
  for (const it of sample().slice(0, 3)) {
    h.sandbox.testItem = it;
    const card = h.run('reqRowEl(testItem)');
    assert.match(card.innerHTML, /data-select-id=/);
    assert.match(card.innerHTML, /data-accept-id=/);
    const check = card.querySelector('[data-select-id]');
    check.checked = true;
    assert.equal(check.fire('click').e.stopped, true, '勾选不得冒泡打开详情');
    check.fire('change');
    assert.ok(h.state.acceptance.selected.has(it.id));
    const click = card.querySelector('[data-accept-id]').fire('click');
    assert.equal(click.e.stopped, true, '接受不得冒泡打开详情');
    await click.result;
  }
  assert.equal(h.requests.length, 3, '三类卡片均可单条接受');
  h.sandbox.testItem = sample()[3];
  assert.doesNotMatch(h.run('reqRowEl(testItem)').innerHTML, /data-select-id=|data-accept-id=/);
});

t('A3/A4 混合接受：免二次确认、去重、原接口和固定项目，空选择无请求（REQ-20260910-011）', async () => {
  const h = setup();
  await h.run("acceptItems(['REQ-20990101-001', 'BUG-20990101-001', 'BUG-20990101-001', 'BUG-20990101-002', 'REQ-20990101-002'])");
  assert.equal(h.confirmations.length, 0, '接受可撤销，不得弹二次确认（REQ-20260910-011）');
  assert.equal(h.requests.length, 3, '已接受条目和重复条目不能被重复提交');
  for (const req of h.requests) {
    assert.match(req.url, /^\/api\/item\/(REQ|BUG)-20990101-00[12]\/status\?project=%2Fproject%2Fa$/);
    assert.equal(req.opts.method, 'POST');
    assert.deepEqual(JSON.parse(req.opts.body), { to: 'accepted' });
  }
  assert.match(h.state.acceptance.message, /成功 3/);
  await h.run('acceptItems([])');
  assert.equal(h.requests.length, 3, '空选择不应发请求');
});

t('A5 请求期间防重入并禁用控件，完成后恢复', async () => {
  const h = setup();
  let finish;
  h.sandbox.fetch = (url) => { h.requests.push(url); return new Promise((r) => { finish = r; }); };
  const pending = h.run("acceptItems(['REQ-20990101-001'])");
  await Promise.resolve(); await Promise.resolve(); // BUG-20260907-009：先过页面内确认再进入提交段
  assert.equal(h.state.acceptance.pending, true);
  assert.equal(h.document.querySelector('#acceptSelected').disabled, true);
  assert.equal(h.document.querySelector('#selectOperable').disabled, true);
  await h.run("acceptItems(['BUG-20990101-001'])");
  assert.equal(h.requests.length, 1);
  finish({ ok: true, json: async () => ({}) });
  await pending;
  assert.equal(h.state.acceptance.pending, false);
});

t('A6 部分失败：后续继续、保留失败项和错误明细，重试只发送失败项', async () => {
  const h = setup();
  for (const it of sample().slice(0, 3)) h.state.acceptance.selected.add(it.id);
  h.sandbox.fetch = async (url) => {
    h.requests.push(url);
    return url.includes('BUG-20990101-001')
      ? { ok: false, json: async () => ({ error: '条目状态已变化' }) }
      : { ok: true, json: async () => ({}) };
  };
  await h.run('acceptItems([...state.acceptance.selected])');
  assert.equal(h.requests.length, 3);
  assert.deepEqual([...h.state.acceptance.selected], ['BUG-20990101-001']);
  assert.match(h.state.acceptance.message, /成功 2.*失败 1/);
  assert.match(JSON.stringify(h.state.acceptance.failures), /BUG-20990101-001.*条目状态已变化/);
  h.sandbox.fetch = async (url) => { h.requests.push(url); return { ok: true, json: async () => ({}) }; };
  await h.run('acceptItems([...state.acceptance.selected])');
  assert.equal(h.requests.length, 4);
  assert.equal(h.state.acceptance.selected.size, 0);
});

t('A7 网络异常：全部失败无假成功，错误文本安全显示且控件恢复', async () => {
  const h = setup();
  h.sandbox.fetch = async () => { throw new Error('<img src=x onerror=alert(1)>'); };
  await h.run("acceptItems(['REQ-20990101-001', 'BUG-20990101-001'])");
  assert.match(h.state.acceptance.message, /成功 0.*失败 2/);
  assert.equal(h.state.acceptance.pending, false);
  assert.equal(h.state.acceptance.failures.length, 2);
  assert.doesNotMatch(h.document.querySelector('#acceptResult').innerHTML, /<img/);
});

t('A8 轮询：有效选择保留、移除状态变化/删除项、新到条目不自动选中', () => {
  const h = setup();
  h.state.acceptance.selected = new Set(['REQ-20990101-001', 'BUG-20990101-001', 'BUG-deleted']);
  h.state.board.items[1].status = 'accepted';
  h.state.board.items.push(item('REQ-new'));
  h.run('syncAcceptance()');
  assert.deepEqual([...h.state.acceptance.selected], ['REQ-20990101-001']);
  h.run('renderBoard()');
  assert.deepEqual([...h.state.acceptance.selected], ['REQ-20990101-001']);
});

t('A9 项目切换：清空选择、停止未发请求，旧请求完成不污染新项目结果', async () => {
  const h = setup();
  let finish;
  h.sandbox.fetch = (url) => { h.requests.push(url); return new Promise((r) => { finish = r; }); };
  h.state.acceptance.selected.add('REQ-20990101-001');
  const pending = h.run("acceptItems(['REQ-20990101-001', 'BUG-20990101-001'])");
  await Promise.resolve(); await Promise.resolve(); // BUG-20260907-009：先过页面内确认再发首个请求
  await h.run("switchProject('/project/b')");
  assert.equal(h.state.acceptance.selected.size, 0);
  assert.equal(h.state.acceptance.message, '');
  assert.equal(h.state.board, null, '等待新项目响应时不能继续显示旧条目');
  finish({ ok: true, json: async () => ({}) });
  await pending;
  assert.equal(h.requests.length, 1, '项目切换后不应继续发送剩余旧请求');
  assert.match(h.requests[0], /project=%2Fproject%2Fa$/);
  assert.equal(h.state.acceptance.message, '', '旧完成结果不得污染新项目');
});

t('A10 在途轮询响应不能覆盖切换后的项目', async () => {
  const h = setup();
  const originalPoll = source.slice(source.indexOf('async function poll()'), source.indexOf('// REQ-20260907-004 需求列表'));
  h.run(originalPoll);
  let finish;
  h.sandbox.fetch = () => new Promise((r) => { finish = r; });
  const polling = h.run('poll()');
  h.state.project = '/project/b';
  h.state.board = null;
  finish({ ok: true, json: async () => ({ initialized: true, projectRoot: '/project/a', items: sample() }) });
  await polling;
  assert.equal(h.state.board, null);
});

t('A11 详情和拖拽的接受复用新提交路径，非接受动作保留原行为', async () => {
  const h = setup();
  await h.run("attemptTransition('REQ-20990101-001', 'accepted')");
  assert.match(h.state.acceptance.message, /成功 1/);
  assert.match(h.run("drawerActionsButtonHtml({ status: 'submitted' })"), /data-act="accepted"/);
  await h.run("attemptTransition('REQ-20990101-002', 'done')");
  assert.equal(JSON.parse(h.requests.at(-1).opts.body).to, 'done');
});

t('A13 控件同步：复选框态与禁用（REQ-20260908-027 起勾选不再加行级边框）、卡片/详情按钮禁用，恢复后可操作', () => {
  const h = setup();
  const check = element(), accept = element(), drawerAccept = element();
  check.dataset.selectId = 'REQ-20990101-001';
  h.document.querySelectorAll = (selector) => selector === '[data-select-id]' ? [check] : [accept, drawerAccept];
  h.state.acceptance.selected.add(check.dataset.selectId);
  h.state.acceptance.pending = true;
  h.run('syncAcceptance()');
  assert.equal(check.checked, true);
  assert.equal(check.disabled, true);
  assert.equal(accept.disabled, true);
  assert.equal(drawerAccept.disabled, true);
  h.state.acceptance.pending = false;
  h.state.acceptance.selected.clear();
  h.run('syncAcceptance()');
  assert.equal(check.checked, false);
  assert.equal(check.disabled, false);
  assert.equal(accept.disabled, false);
  assert.equal(drawerAccept.disabled, false);
  h.state.board = null;
  h.document.querySelector = () => null;
  h.run('syncAcceptance()');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
