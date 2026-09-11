#!/usr/bin/env node
// BUG-20260908-008 契约测试 —— 设置视图不再渲染「项目设置」视图级大标题
// （含并排项目路径 span.path）。模块归属由第二行「设置」页签 + 第三行副标题
// 「当前项目的派发默认值」（MODULE_SUB.settings，REQ-20260907-004 口径）承担。
// 范围边界：任务模块抽屉 renderBatchDrawer 的 <h2>任务</h2> 原不在本 Bug 范围，
// 后续由 BUG-20260908-009 移除（T3 边界断言已同步更新）；「已保存项目设置…」toast
// 属运行参数保存入口反馈，后随 BUG-20260909-011 删除保存入口一并移除（T3 已同步更新）。
// 用法：node scripts/tests/settings-title-removed.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const source = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');

// DOM 接缝：控件级 stub（type-chip-removed.test.mjs 同法）；
// document.querySelector 对未播种选择器自动造节点，容纳文件尾部静态事件绑定段
function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes,
    dataset: {}, innerHTML: '', textContent: '', title: '', value: '', disabled: false, checked: false, indeterminate: false,
    tagName: 'DIV',
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: () => true, toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    prepend(child) { this.children.unshift(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {},
    fire(event) { const e = { target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
}

function setup() {
  const document = element();
  document.createElement = element;
  const seed = (selector, el) => document.nodes.set(selector, el);
  document.querySelector = (selector) => { if (!document.nodes.has(selector)) document.nodes.set(selector, element()); return document.nodes.get(selector); };
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {}, getItem: () => null },
    window: { addEventListener() {}, confirm: () => true },
    fetch: async (url) => {
      const p = String(url).split('?')[0];
      const body = p === '/api/tasks/settings'
        ? { settings: { agents: { refine: ['zcode', 'codex'], develop: ['zcode', 'codex'] }, models: { refine: {}, develop: {} } } }
        : p === '/api/dispatch/settings'
          ? { settings: { codex: {} } }
          : p === '/api/dispatch/codex/models'
            ? { ok: false, models: [], reason: 'stub 未加载', loadedAt: null }
            : p === '/api/dispatch/codex/model-inherit'
              ? { inherit: {} }
              : {};
      return { ok: true, status: 200, statusText: 'OK', json: async () => body };
    },
  };
  vm.createContext(sandbox);
  // 载入至「启动」段之前：包含全部渲染函数（renderSettingsView 等）与静态事件绑定，
  // 排除 boot() 的真实网络轮询
  vm.runInContext(source.split('/* ---------- 启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  return { sandbox, document, state, run, seed };
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('T1 动态渲染：设置视图无「项目设置」标题头，其余内容完整保留', async () => {
  const h = setup();
  const view = element();
  h.seed('#settingsView', view);
  await h.run('renderSettingsView()');
  const html = view.innerHTML;
  assert.doesNotMatch(html, /<h2>项目设置<\/h2>/, '设置视图不应再渲染「项目设置」大标题');
  assert.doesNotMatch(html, /class="batch-title"/, '设置视图不应再渲染 batch-title 标题头');
  assert.doesNotMatch(html, /<header class="batch-head">/, '设置视图不应再渲染 batch-head 标题头');
  assert.ok(!html.includes('/project/a'), '标题旁的项目路径文本应随标题头一并移除');
  // 口径更新（BUG-20260909-002）：派发默认值说明、模型与推理强度分区、
  // 运行环境静态检查均已删除；运行参数分区曾保留改用相符分组标题，
  // 后由 BUG-20260909-011 整体删除（标题、五控件与保存按钮）。
  assert.doesNotMatch(html, /当前项目的派发默认值/, '派发默认值说明文案应删除');
  assert.doesNotMatch(html, /模型与推理强度/, '「模型与推理强度」分区应删除');
  assert.doesNotMatch(html, /id="stPreflight"/, '运行环境静态检查入口应删除');
  assert.match(html, /<h4>批量任务<\/h4>/, '「批量任务」分区（REQ-20260908-020）应保留');
  assert.doesNotMatch(html, /<h4>运行参数<\/h4>/, '「运行参数」分区已由 BUG-20260909-011 删除');
  assert.match(html, /id="tsSave"/, '「保存批量任务设置」按钮应保留');
  assert.doesNotMatch(html, /id="stSave"/, '「保存设置」按钮已随运行参数分区删除');
  assert.doesNotMatch(html, /id="stCliPath"/, 'CLI 路径字段已删除');
  assert.doesNotMatch(html, /id="stTimeout"/, '单项时限字段已删除');
});

t('T2 静态契约：renderSettingsView 函数体不再拼接视图级标题头', () => {
  const fn = source.match(/async function renderSettingsView\(\)[\s\S]*?\n\}/);
  assert.ok(fn, '应存在 renderSettingsView');
  assert.doesNotMatch(fn[0], /项目设置<\/h2>/, 'renderSettingsView 不应再拼接「项目设置」标题');
  assert.doesNotMatch(fn[0], /batch-title|batch-head/, 'renderSettingsView 不应再拼接标题头结构');
});

t('T3 范围边界：任务抽屉头部不受影响；运行参数保存 toast 已随保存入口删除', () => {
  const drawer = source.match(/function renderBatchDrawer\(\)[\s\S]*?\n\}/);
  assert.ok(drawer, '应存在 renderBatchDrawer');
  // 边界更新（BUG-20260908-009）：任务模块的「任务」大标题已由该单移除，
  // 此处同步改为断言其不再出现（详见 batch-title-removed.test.mjs）。
  assert.doesNotMatch(drawer[0], /<h2>任务<\/h2>/, '任务模块「任务」大标题已由 BUG-20260908-009 移除');
  // 边界更新（BUG-20260909-011）：「已保存项目设置…」toast 属运行参数保存入口的反馈文案，
  // 随保存按钮删除一并移除。
  assert.doesNotMatch(source, /已保存项目设置（用于后续新执行）/, '「已保存项目设置」toast 已随运行参数保存入口删除');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
