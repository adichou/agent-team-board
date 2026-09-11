#!/usr/bin/env node
// BUG-20260909-002 契约测试 —— 设置/任务界面精简
// 覆盖四项删除要求：
//   1) 设置页去掉「模型与推理强度」配置与「运行环境」检查区域（运行参数曾保留改用相符
//      分组标题；后由 BUG-20260909-011 整体删除，T1/T3 口径已同步更新）
//   2) 任务页头部删除「任务设置」按钮（主导航「设置」页签仍是唯一入口）
//   3) 设置模块副标题与正文删除「当前项目的派发默认值」文案（其他模块副标题不受影响）
//   4) 批量任务两类「是否隐藏」复选框删除尾随可见「隐藏」文字，保留列标题、
//      勾选语义与包含任务类别/Agent/隐藏含义的可访问名称（aria-label）
// 边界：保存设置不得携带已删除模型控件的空值（服务端浅合并保留既有 modelSelection）；
//       Codex 存量面板（renderCodexPanel 深链）的模型块与预检不在本单范围。
// 用法：node scripts/tests/settings-simplify-20260909-002.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');

// DOM 接缝：控件级 stub（settings-title-removed.test.mjs 同法）
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
  const posted = [];
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {}, getItem: () => null },
    window: { addEventListener() {}, confirm: () => true },
    fetch: async (url, opts) => {
      const p = String(url).split('?')[0];
      if (opts && opts.method === 'POST') posted.push({ url: p, body: JSON.parse(opts.body || '{}') });
      const body = p === '/api/tasks/settings'
        ? { settings: { agents: { refine: ['zcode', 'codex'], develop: ['zcode', 'codex'] }, models: { refine: {}, develop: {} } } }
        : p === '/api/dispatch/settings'
          ? { settings: { codex: { cliPath: null, timeoutMin: 60, retries: 2, modelSelection: { mode: 'explicit', modelId: 'gpt-6-astra', reasoningEffort: 'high' } } } }
          : {};
      return { ok: true, status: 200, statusText: 'OK', json: async () => body };
    },
  };
  sandbox.__posted = posted;
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  run('toast = () => {}; poll = async () => {}; refreshDrawer = async () => {}; refreshBatch = async () => {}; renderBatchDrawer = () => {};');
  return { sandbox, document, state, run, seed, posted };
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- 1) 设置页：模型/强度配置与运行环境检查移除，运行参数保留 ----------

t('T1 设置视图不渲染模型配置、运行环境检查与派发默认值文案；运行参数分区已删除（BUG-20260909-011）', async () => {
  const h = setup();
  const view = element();
  h.seed('#settingsView', view);
  await h.run('renderSettingsView()');
  const out = view.innerHTML;
  // 删除项（README 期望 1/3）
  assert.doesNotMatch(out, /模型与推理强度/, '不应再渲染「模型与推理强度」分区');
  assert.doesNotMatch(out, /cx-model-block/, '不应再渲染模型配置块');
  assert.doesNotMatch(out, /id="stPreflight"/, '不应再渲染运行环境静态检查按钮');
  assert.doesNotMatch(out, /id="stPreflightBody"/, '不应再渲染检查结果容器');
  assert.doesNotMatch(out, /<h4>运行环境<\/h4>/, '不应再渲染运行环境分区标题');
  assert.doesNotMatch(out, /当前项目的派发默认值/, '正文不应再出现派发默认值说明');
  assert.doesNotMatch(out, /cx-preflight/, '不应残留运行环境分区结构');
  // 口径更新（BUG-20260909-011）：运行参数分区（标题、五控件、保存按钮与密钥说明）整体删除
  assert.doesNotMatch(out, /<h4>运行参数<\/h4>/, '「运行参数」分区应删除');
  for (const id of ['stCliPath', 'stTimeout', 'stRetries', 'stResumeRestart', 'stAllowNonGit', 'stSave']) {
    assert.doesNotMatch(out, new RegExp(`id="${id}"`), `运行参数字段 ${id} 应删除`);
  }
  assert.match(out, /<h4>批量任务<\/h4>/, '「批量任务」分区应保留');
  assert.match(out, /id="tsSave"/, '「保存批量任务设置」按钮应保留');
});

t('T2 静态契约：设置视图渲染/绑定不再引用模型块、预检与派发默认值', () => {
  const fn = source.match(/async function renderSettingsView\(\)[\s\S]*?\n\}/);
  assert.ok(fn, '应存在 renderSettingsView');
  assert.doesNotMatch(fn[0], /cxModelBlockHtml/, 'renderSettingsView 不应再调用模型块渲染');
  assert.doesNotMatch(fn[0], /当前项目的派发默认值/, 'renderSettingsView 不应再拼接派发默认值说明');
  assert.doesNotMatch(fn[0], /stPreflight/, 'renderSettingsView 不应再拼接预检入口');
  assert.doesNotMatch(fn[0], /codex\/models|model-inherit/, '进入设置页不应再预取模型目录/继承值');
  const bind = source.match(/function bindSettingsView\(view\)[\s\S]*?\n\}/);
  assert.ok(bind, '应存在 bindSettingsView');
  assert.doesNotMatch(bind[0], /bindCxModelBlock/, '设置视图不应再绑定模型块交互');
  assert.doesNotMatch(bind[0], /stPreflight/, '设置视图不应再绑定预检按钮');
  assert.doesNotMatch(bind[0], /cxReadModelForm/, '设置保存不应再读取已删除的模型表单');
});

t('T3 设置视图不再发起运行参数保存（BUG-20260909-011 删除保存入口；服务端接口保留不连带删除）', async () => {
  const h = setup();
  const view = element();
  h.seed('#settingsView', view);
  h.posted.length = 0;
  await h.run('renderSettingsView()');
  // 旧口径（POST 不携带 modelSelection）随保存入口删除失效：设置视图不再渲染保存按钮，
  // /api/dispatch/settings 仅剩 renderSettingsView 的读取调用，无任何 POST
  assert.doesNotMatch(view.innerHTML, /id="stSave"/, '设置视图不再渲染运行参数保存按钮');
  assert.equal(h.posted.filter((p) => p.url === '/api/dispatch/settings').length, 0, '设置视图不应再 POST /api/dispatch/settings');
});

t('T4 副标题：设置模块不再有「当前项目的派发默认值」，其他模块副标题不受影响（REQ-20260909-013：讨论 / 文件副标题随入口暂隐藏移出）', () => {
  const m = source.match(/const MODULE_SUB = \{[\s\S]*?\};/);
  assert.ok(m, '应存在 MODULE_SUB');
  const seg = m[0];
  assert.match(seg, /settings:\s*''/, 'settings 副标题应为空串（键保留、无文案）');
  assert.doesNotMatch(source, /当前项目的派发默认值/, 'app.js 全文不应再出现该文案');
  for (const sub of ['从想法到验收，跟进每一项工作', '进度、队列与结果集中在这里']) {
    assert.ok(seg.includes(sub), `其他模块副标题应保留：${sub}`);
  }
  for (const gone of ['开放式讨论，看板沉淀成果', '项目资料与源码，专注阅读']) {
    assert.ok(!seg.includes(gone), `讨论 / 文件副标题应随 REQ-20260909-013 暂隐藏移出：${gone}`);
  }
});

// ---------- 2) 任务页「任务设置」按钮删除 ----------

t('T5 任务页头部无「任务设置」按钮；主导航设置页签仍是入口', () => {
  assert.doesNotMatch(source, /taskSettingsGo/, 'app.js 不应再有任务设置跳转按钮（含绑定）');
  const drawer = source.match(/function renderBatchDrawer\(\)[\s\S]*?\n\}/);
  assert.ok(drawer, '应存在 renderBatchDrawer');
  assert.doesNotMatch(drawer[0], /任务设置<\/button>/, '任务抽屉头部不应再渲染「任务设置」按钮（注释说明除外）');
  assert.doesNotMatch(drawer[0], /id="batchClose"/, '关闭按钮不应再渲染（BUG-20260909-014：与导航「需求」页签重复，整行移除）');
  assert.match(html, /data-view="settings"[^>]*>设置</, '主导航「设置」页签保留（唯一设置入口）');
});

// ---------- 3) 隐藏复选框随 REQ-20260909-011 设置去 Agent 化整体移除 ----------

t('T6 按 Agent 隐藏控件整体移除（REQ-20260909-011）：无「是否隐藏」列/复选框；流转开关可访问名称保留', () => {
  const h = setup();
  const ts = { version: 1, agents: { refine: ['zcode'], develop: ['zcode', 'codex'] }, models: { refine: {}, develop: {} } };
  const out = h.run(`taskSettingsHtml(${JSON.stringify(ts)})`);
  assert.doesNotMatch(out, /是否隐藏/, '「是否隐藏」列标题随表格移除');
  assert.doesNotMatch(out, /id="tsHidden-/, '隐藏复选框不再渲染');
  // 存量已隐藏数据不引发渲染异常；流转开关保留可见文字与 aria-label
  assert.match(out, /id="tsAutoPlan"[^>]*aria-label="完善完成后自动转入计划"/, '流转开关可访问名称保留');
  assert.match(out, /> 完善完成后自动转入计划/, '流转开关保留可见文字');
});

// ---------- 4) 边界：Codex 存量面板的模型块与预检不受本单影响 ----------

t('T7 Codex 存量面板（深链）的模型块与静态预检保留', () => {
  const panel = source.match(/function renderCodexPanel\([\s\S]*?\n\}/);
  assert.ok(panel, '应存在 renderCodexPanel');
  assert.match(panel[0], /cx-model-block/, 'Codex 面板模型块保留');
  assert.match(panel[0], /id="cxPreflight"/, 'Codex 面板静态预检保留');
  assert.match(source, /id="cxModelProbe"/, 'Codex 面板模型验证保留');
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
