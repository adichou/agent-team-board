#!/usr/bin/env node
// REQ-20260910-015 创建需求 / Bug 支持创建并接受 —— 前端测试 U1–U3。
// 加载实际 app.js / index.html / style.css（vm + 模拟 DOM，参照 item-shot-ui.test.mjs）。
// 用法：node scripts/tests/create-accept-ui-20260910-015.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function element() {
  const nodes = new Map();
  const classes = new Set();
  const attrs = new Map();
  const qsa = new Map();
  return {
    dataset: {}, innerHTML: '', textContent: '', value: '', disabled: false, checked: false,
    children: [], listeners: {},
    classList: {
      add: (v) => classes.add(v), remove: (v) => classes.delete(v),
      contains: (v) => classes.has(v), toggle: (v, on) => (on ? classes.add(v) : classes.delete(v)),
    },
    addEventListener(event, fn) { (this.listeners[event] ||= []).push(fn); },
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    setAttribute(name, v) { attrs.set(name, String(v)); },
    removeAttribute(name) { attrs.delete(name); },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll(selector) { if (!qsa.has(selector)) qsa.set(selector, []); return qsa.get(selector); },
    setQsa(selector, list) { qsa.set(selector, list); },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    replaceWith(...replacements) { this.replacedWith = replacements; },
    click() { for (const fn of this.listeners.click || []) fn({ target: this, currentTarget: this }); },
    fire(event) { for (const fn of this.listeners[event] || []) fn({ target: this, currentTarget: this }); },
    focus() {},
  };
}

function setup() {
  const document = element();
  document.createElement = element;
  document.querySelector('#modalWrap').classList.add('hidden');
  const requests = [], notices = [];
  const sandbox = {
    document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {}, Date,
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {} },
    window: { addEventListener() {}, confirm: () => true },
    FileReader: class { readAsDataURL() {} },
    fetch: async (url, opts) => {
      requests.push({ url, opts });
      return { ok: true, json: async () => ({ id: 'REQ-20990101-021', status: 'submitted' }) };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  state.board = { initialized: true, items: [] };
  sandbox.recordNotice = (message, error) => notices.push({ message, error });
  run('toast = recordNotice; setView = () => {}; poll = async () => {}; renderBoard = () => {}; renderDrawer = () => {}; refreshDrawer = async () => {}; updateBoardTabs = () => {};');
  return { sandbox, document, state, run, requests, notices };
}

t('U1 静态契约与类型联动：底栏「取消 | 创建并接受 | 创建」，.btn.accent 样式存在；讨论隐藏、需求 / Bug 显示', () => {
  const cancel = html.indexOf('id="modalCancel"');
  const accept = html.indexOf('id="fSubmitAccept"');
  const submit = html.indexOf('id="fSubmit"');
  assert.ok(cancel > 0 && accept > cancel && submit > accept, '底栏顺序应为 取消 | 创建并接受 | 创建');
  const acceptTag = html.slice(accept - 200, accept + 200);
  assert.match(acceptTag, /class="btn[^"]*accent[^"]*"/, '创建并接受应为次级强调按钮');
  assert.match(acceptTag, />创建并接受</, '按钮文案');
  assert.match(css, /\.btn\.accent/, '样式表应有 .btn.accent');

  const h = setup();
  h.run("$('#fType').value = 'ask'; syncNewFormFields();");
  assert.equal(h.document.querySelector('#fSubmitAccept').classList.contains('hidden'), true, '讨论应隐藏创建并接受');
  for (const ty of ['req', 'bug']) {
    h.run(`$('#fType').value = '${ty}'; syncNewFormFields();`);
    assert.equal(h.document.querySelector('#fSubmitAccept').classList.contains('hidden'), false, `${ty} 应显示创建并接受`);
  }
});

t('U2 提交：accept 路径请求体携带 accept:true、toast 已接受；普通创建不带字段、toast 待接受', async () => {
  // 创建并接受
  const a = setup();
  a.run("openModal('req')");
  a.document.querySelector('#fType').value = 'req';
  a.document.querySelector('#fTitle').value = '一步直达';
  await a.run("submitNew({ preventDefault() {} }, { accept: true })");
  const call = a.requests.find((r) => String(r.url).includes('/api/new'));
  assert.ok(call, '应请求 /api/new');
  const body = JSON.parse(call.opts.body);
  assert.equal(body.accept, true, '请求体应携带 accept:true');
  assert.match(a.notices.at(-1).message, /已接受/, 'toast 应提示已接受');
  assert.notEqual(a.notices.at(-1).error, true, '成功不应为错误样式');

  // 普通创建（缺省行为不变）
  const b = setup();
  b.run("openModal('bug')");
  b.document.querySelector('#fType').value = 'bug';
  b.document.querySelector('#fTitle').value = '普通创建';
  await b.run("submitNew({ preventDefault() {} })");
  const plain = b.requests.find((r) => String(r.url).includes('/api/new'));
  assert.ok(plain, '应请求 /api/new');
  assert.equal('accept' in JSON.parse(plain.opts.body), false, '普通创建不得携带 accept 字段');
  assert.match(b.notices.at(-1).message, /待接受/, 'toast 仍为待接受口径');

  // 按钮接线静态契约（事件绑定段未载入 vm）：点击走 submitNew 且带 accept: true
  assert.match(source, /\$\('#fSubmitAccept'\)\.addEventListener\('click'/, '应接线创建并接受按钮');
  const wiringIdx = source.indexOf("$('#fSubmitAccept').addEventListener('click'");
  const wiring = source.slice(wiringIdx, wiringIdx + 260);
  assert.match(wiring, /submitNew/, '点击应调用 submitNew');
  assert.match(wiring, /accept:\s*true/, '点击应携带 accept: true');
});

t('U3 防重复与复位：在途两按钮均禁用且文案「创建中…」；失败保留表单可重试；openModal 重置两按钮', async () => {
  const h = setup();
  h.run("openModal('req')");
  h.document.querySelector('#fType').value = 'req';
  h.document.querySelector('#fTitle').value = '防重复';
  let inFlight = null;
  h.sandbox.fetch = async (url, opts) => {
    h.requests.push({ url, opts });
    if (String(url).includes('/api/new')) {
      inFlight = {
        submitDisabled: h.document.querySelector('#fSubmit').disabled,
        submitText: h.document.querySelector('#fSubmit').textContent,
        acceptDisabled: h.document.querySelector('#fSubmitAccept').disabled,
        acceptText: h.document.querySelector('#fSubmitAccept').textContent,
      };
    }
    return { ok: true, json: async () => ({ id: 'REQ-20990101-022', status: 'accepted' }) };
  };
  await h.run("submitNew({ preventDefault() {} }, { accept: true })");
  assert.ok(inFlight, '应发起创建请求');
  assert.equal(inFlight.submitDisabled, true, '在途「创建」应禁用');
  assert.match(inFlight.submitText, /创建中…/, '在途「创建」文案');
  assert.equal(inFlight.acceptDisabled, true, '在途「创建并接受」应禁用');
  assert.match(inFlight.acceptText, /创建中…/, '在途「创建并接受」文案');
  assert.equal(h.document.querySelector('#fSubmit').disabled, false, '收尾恢复创建按钮');
  assert.equal(h.document.querySelector('#fSubmit').textContent, '创建', '收尾恢复创建文案');
  assert.equal(h.document.querySelector('#fSubmitAccept').disabled, false, '收尾恢复接受按钮');
  assert.equal(h.document.querySelector('#fSubmitAccept').textContent, '创建并接受', '收尾恢复接受文案');

  // 失败：保留弹窗与已填内容，可重试（首次成功已关弹窗，这里重新展开再提交）
  h.requests.length = 0;
  h.document.querySelector('#modalWrap').classList.remove('hidden');
  h.sandbox.fetch = async (url, opts) => {
    h.requests.push({ url, opts });
    return { ok: false, json: async () => ({ error: '标题不能为空' }) };
  };
  await h.run("submitNew({ preventDefault() {} }, { accept: true })");
  assert.equal(h.document.querySelector('#modalWrap').classList.contains('hidden'), false, '失败弹窗应保留');
  assert.equal(h.document.querySelector('#fTitle').value, '防重复', '失败保留已填标题');
  assert.match(h.notices.at(-1).message, /创建失败/, '失败应 toast 报错');
  assert.equal(h.document.querySelector('#fSubmit').disabled, false, '失败后按钮可重试');
  assert.equal(h.document.querySelector('#fSubmitAccept').disabled, false, '失败后接受按钮可重试');

  // openModal 重置两按钮状态（先关闭再打开，避开幂等守卫）
  h.document.querySelector('#modalWrap').classList.add('hidden');
  h.document.querySelector('#fSubmit').disabled = true;
  h.document.querySelector('#fSubmitAccept').textContent = '创建中…';
  h.run("openModal('req')");
  assert.equal(h.document.querySelector('#fSubmit').disabled, false, 'openModal 重置创建按钮');
  assert.equal(h.document.querySelector('#fSubmit').textContent, '创建', 'openModal 重置创建文案');
  assert.equal(h.document.querySelector('#fSubmitAccept').textContent, '创建并接受', 'openModal 重置接受文案');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
