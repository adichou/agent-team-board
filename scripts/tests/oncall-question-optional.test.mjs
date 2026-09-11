#!/usr/bin/env node
// REQ-20260908-013 原契约（讨论正文可空）随 REQ-20260909-004 开放式讨论重构更新：
// 统一新建「讨论」类型 = 标题（必填）+ 背景（可选），无关联需求与截图附件；
// 提交走 /api/discussion（background 可空串），成功后 reveal 定位并展示启动提示词。
// U1：源码静态断言；U2/U3：加载实际 app.js 的 vm 沙箱行为（参照 new-item-nav.test.mjs）。
// 用法：node scripts/tests/oncall-question-optional.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const source = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

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
    querySelector(selector) { if (!nodes.has(selector)) return undefined; return nodes.get(selector); },
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
  const nodes = new Map();
  document.querySelector = (sel) => {
    if (!nodes.has(sel)) nodes.set(sel, element());
    return nodes.get(sel);
  };
  for (const sel of ['#modalWrap']) document.querySelector(sel).classList.add('hidden');
  const requests = [], notices = [], views = [], revealed = [];
  const sandbox = {
    document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {} },
    window: {
      addEventListener() {}, confirm: () => true,
      ATBOncall: { poll: async () => {}, reveal: (id) => revealed.push(id) },
    },
    fetch: async (url, opts) => { requests.push({ url, opts }); return { ok: true, json: async () => ({}) }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  state.board = { initialized: true, items: [] };
  sandbox.recordNotice = (message, error) => notices.push({ message, error });
  run('toast = recordNotice; setView = (v) => recordView(v); renderBoard = () => {}; renderDrawer = () => {};');
  sandbox.recordView = (v) => views.push(v);
  return { sandbox, document, state, run, requests, notices, views, revealed };
}

t('U1 静态：讨论类型为背景（可选）；无关联需求与截图附件字段；需求/Bug 描述文案不受影响', () => {
  assert.ok(!source.includes('讨论单的问题正文不能为空'), '不得再含旧正文拦截文案');
  assert.ok(!source.includes('以标题作为正文'), '不得再含「以标题作为正文」旧口径（背景可空，无回退语义）');
  const syncBlock = source.slice(source.indexOf('function syncNewFormFields'), source.indexOf('function openModal'));
  assert.ok(syncBlock, '应存在 syncNewFormFields');
  assert.match(syncBlock, /背景（可选）/, '讨论类型标签应为「背景（可选）」');
  assert.match(syncBlock, /不需要关联需求/, '讨论类型 placeholder 应注明无需关联需求');
  assert.match(syncBlock, /label\.textContent = '描述';/, '需求 / Bug 描述标签不动');
  assert.match(syncBlock, /可留空，后续补充/, '需求 / Bug 描述 placeholder 不动');
  const submitBlock = source.slice(source.indexOf('async function submitNew'), source.indexOf('/* ---------- 批量'));
  assert.ok(!/type === 'ask' && !desc/.test(submitBlock), 'submitNew 不得按 ask+空背景拦截');
  assert.match(submitBlock, /background: desc/, '讨论提交透传 background（空串可创建，store 不回退）');
  assert.doesNotMatch(submitBlock, /\/api\/oncall\/ticket/, '讨论创建不再走旧 oncall 接口');
  // HTML：弹窗无关联需求与截图附件字段；描述 placeholder 保持（type=req 初始态）
  assert.ok(!html.includes('id="fReq"'), '弹窗不应再有关联需求输入');
  assert.ok(!html.includes('id="fAttach"'), '弹窗不应再有截图上传');
  assert.match(html, /可留空，后续补充/, 'index.html 描述 placeholder 不动');
});

t('U2 行为：讨论背景留空提交——直接请求 /api/discussion，弹窗关闭、toast、进入讨论模块并 reveal 展示启动提示词', async () => {
  const h = setup();
  h.document.querySelector('#fType').value = 'ask';
  h.document.querySelector('#fTitle').value = '部署后看板列表为空，如何排查？';
  h.document.querySelector('#fDesc').value = ''; // 背景留空
  h.sandbox.fetch = async (url, opts) => {
    h.requests.push({ url, opts });
    if (String(url).includes('/api/discussion')) {
      return { ok: true, json: async () => ({ discussion: { id: 'ASK-20990101-009', status: 'discussing', startPrompt: '启动提示词' } }) };
    }
    return { ok: true, json: async () => ({ initialized: true, items: [] }) };
  };
  await h.run("submitNew({ preventDefault() {} })");
  const call = h.requests.find((x) => String(x.url).includes('/api/discussion'));
  assert.ok(call, '留空背景应直接发起创建请求（不再被前端拦截）');
  const body = JSON.parse(call.opts.body);
  assert.equal(body.title, '部署后看板列表为空，如何排查？');
  assert.equal(body.background, '', 'background 原样透传空串（背景可选，无回退语义）');
  assert.equal(h.document.querySelector('#modalWrap').classList.contains('hidden'), true, '成功后应关闭弹窗');
  assert.match(h.notices.at(-1).message, /✓ 已创建 ASK-20990101-009（讨论中/, '应有创建成功 toast（讨论中口径）');
  assert.deepEqual(h.views, ['oncall'], '应进入讨论模块');
  assert.deepEqual(h.revealed, ['ASK-20990101-009'], 'REQ-20260909-004：创建成功后 reveal 定位新讨论并展示启动提示词');
});

t('U3 回归：背景填写时照常提交原文；需求类型空描述仍走 /api/new', async () => {
  const h = setup();
  h.document.querySelector('#fType').value = 'ask';
  h.document.querySelector('#fTitle').value = '带背景的讨论';
  h.document.querySelector('#fDesc').value = '## 背景\n集中讨论部署问题';
  h.sandbox.fetch = async (url, opts) => {
    h.requests.push({ url, opts });
    if (String(url).includes('/api/discussion')) {
      return { ok: true, json: async () => ({ discussion: { id: 'ASK-20990101-010', status: 'discussing' } }) };
    }
    return { ok: true, json: async () => ({ initialized: true, items: [] }) };
  };
  await h.run("submitNew({ preventDefault() {} })");
  const ask = h.requests.find((x) => String(x.url).includes('/api/discussion'));
  assert.ok(ask, '讨论创建请求应发出');
  assert.equal(JSON.parse(ask.opts.body).background, '## 背景\n集中讨论部署问题', '背景填写时原样提交');

  const h2 = setup();
  h2.document.querySelector('#fType').value = 'req';
  h2.document.querySelector('#fTitle').value = '新需求';
  h2.document.querySelector('#fDesc').value = '';
  h2.sandbox.fetch = async (url, opts) => {
    h2.requests.push({ url, opts });
    if (String(url).includes('/api/new')) return { ok: true, json: async () => ({ id: 'REQ-20990101-009', status: 'submitted' }) };
    return { ok: true, json: async () => ({ initialized: true, items: [] }) };
  };
  h2.run('openDrawer = async () => {};');
  await h2.run("submitNew({ preventDefault() {} })");
  const newCall = h2.requests.find((x) => String(x.url).includes('/api/new'));
  assert.ok(newCall, '需求类型空描述应照常走 /api/new（可留空口径不受影响）');
  assert.equal(JSON.parse(newCall.opts.body).description, '');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n${e.stack}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
