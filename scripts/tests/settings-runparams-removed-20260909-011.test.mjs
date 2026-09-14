#!/usr/bin/env node
// BUG-20260909-011 契约测试 —— 设置页删除「运行参数」配置分区
// 覆盖：
//   1) 就绪渲染：分区标题、五个运行参数控件（CLI 路径 / 单项时限 / 网络重试次数 /
//      重启后自动继续 / 允许非 Git 项目执行）、「保存设置」按钮与密钥说明一并移除，
//      不残留空卡片 / 空标题 / 不可操作占位；「批量任务」分区与其保存按钮保持可用
//   2) 加载两阶段（REQ-20260909-001）：加载中不再出现被禁用的运行参数控件或保存按钮
//   3) 设置读取失败：整页「设置加载失败」+ 重试保留（接口调用口径未变，待确认项不动）
//   4) 静态契约：bindSettingsView 不再绑定运行参数保存 / 不再 POST /api/dispatch/settings；
//      renderSettingsView 仍 GET /api/dispatch/settings（取值来源待确认，保留既有落盘配置）
//   5) 范围边界：服务端消费点与接口不动——scheduler 仍读 cliPath / allowNonGit /
//      resumeAfterRestart，codex-adapter 仍按 allowNonGit 追加 --skip-git-repo-check，
//      server 仍保留 /api/dispatch/settings GET/POST（是否连带删除属待确认，不在本单）
// 用法：node scripts/tests/settings-runparams-removed-20260909-011.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const srv = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');
const scheduler = fs.readFileSync(path.join(pluginRoot, 'scripts', 'lib', 'scheduler.mjs'), 'utf8');
const adapter = fs.readFileSync(path.join(pluginRoot, 'scripts', 'lib', 'codex-adapter.mjs'), 'utf8');

const ST_IDS = ['stCliPath', 'stTimeout', 'stRetries', 'stResumeRestart', 'stAllowNonGit', 'stSave'];

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

// 完整沙箱：fetch 门闩可控 /api/dispatch/settings 与 /api/tasks/settings 的延迟与失败
function harness() {
  const document = element();
  document.createElement = element;
  const seed = (selector, el) => document.nodes.set(selector, el);
  document.querySelector = (selector) => { if (!document.nodes.has(selector)) document.nodes.set(selector, element()); return document.nodes.get(selector); };
  const ctl = { settingsFail: null, tasksDelay: null };
  const resp = (ok, body, status = ok ? 200 : 500) => ({ ok, status, statusText: ok ? 'OK' : 'ERR', json: async () => body });
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, confirm: () => true },
    fetch: async (url) => {
      const p = String(url).split('?')[0];
      if (p === '/api/dispatch/settings') {
        if (ctl.settingsFail) return resp(false, { error: ctl.settingsFail.message });
        return resp(true, { settings: { codex: { cliPath: null, timeoutMin: 60, retries: 2 } } });
      }
      if (p === '/api/tasks/settings') {
        if (ctl.tasksDelay) await ctl.tasksDelay;
        return resp(true, { settings: { agents: { refine: ['zcode', 'codex'], develop: ['zcode', 'codex'] }, models: { refine: {}, develop: {} } } });
      }
      return resp(true, {});
    },
  };
  sandbox.__ctl = ctl;
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  run('toast = () => {}; poll = async () => {}; refreshDrawer = async () => {}; refreshBatch = async () => {}; renderBatchDrawer = () => {};');
  return { sandbox, document, state, run, seed, ctl };
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- T1 就绪渲染：运行参数分区整体删除，批量任务保持可用 ----------

t('T1 设置视图不渲染「运行参数」分区：标题、五个控件、保存按钮与密钥说明均无，无空卡片残留；「批量任务」完整可用', async () => {
  const h = harness();
  const view = element();
  h.seed('#settingsView', view);
  await h.run('renderSettingsView()');
  const out = view.innerHTML;
  // 删除项（README 期望行为 1）
  assert.doesNotMatch(out, /<h4>运行参数<\/h4>/, '不应再渲染「运行参数」分区标题');
  for (const id of ST_IDS) {
    assert.doesNotMatch(out, new RegExp(`id="${id}"`), `运行参数控件 ${id} 不应再渲染`);
  }
  assert.doesNotMatch(out, /CLI 路径/, '不应再渲染 CLI 路径字段');
  assert.doesNotMatch(out, /单项时限/, '不应再渲染单项时限字段');
  assert.doesNotMatch(out, /网络重试次数/, '不应再渲染网络重试次数字段');
  assert.doesNotMatch(out, /重启后自动继续/, '不应再渲染重启后自动继续开关');
  assert.doesNotMatch(out, /允许非 Git 项目执行/, '不应再渲染允许非 Git 项目执行开关');
  assert.doesNotMatch(out, /不在此收集任何密钥/, '密钥说明应随分区一并移除');
  assert.doesNotMatch(out, /<section class="cx-config">/, '不应残留空卡片 / 空白分区结构');
  // 保留项（README 期望行为 2）：「批量任务」分区不受影响（REQ-20260909-011 起仅剩流转开关）
  assert.match(out, /<h4>批量任务<\/h4>/, '「批量任务」分区保留');
  assert.match(out, /id="tsSave"/, '「保存批量任务设置」按钮保留');
  assert.match(out, /id="tsStatus"/, '批量任务就近状态反馈位保留');
  assert.match(out, /id="tsAutoPlan"/, '完善流转开关保留（按 Agent 隐藏开关已随 REQ-20260909-011 移除）');
});

// ---------- T2 加载两阶段：不再出现随之禁用的运行参数控件 ----------

t('T2 加载中：任务设置加载骨架保留，运行参数控件与保存按钮不再出现（含禁用态）', async () => {
  const h = harness();
  const view = element();
  h.seed('#settingsView', view);
  let release;
  h.ctl.tasksDelay = new Promise((r) => { release = r; });
  const p = h.run('renderSettingsView()'); // 阶段一同步完成，不等待
  const loading = view.innerHTML;
  assert.match(loading, /正在加载任务设置/, '加载中显示「正在加载任务设置」骨架');
  for (const id of ST_IDS) {
    assert.doesNotMatch(loading, new RegExp(`id="${id}"`), `加载中不应出现运行参数控件 ${id}（含禁用态）`);
  }
  assert.doesNotMatch(loading, /<h4>运行参数<\/h4>/, '加载中不渲染「运行参数」分区标题');
  release();
  await p;
  assert.match(view.innerHTML, /id="tsSave"/, '加载完成后「保存批量任务设置」恢复渲染');
  for (const id of ST_IDS) {
    assert.doesNotMatch(view.innerHTML, new RegExp(`id="${id}"`), `就绪后亦不应出现运行参数控件 ${id}`);
  }
});

// ---------- T3 设置读取失败：整页错误 + 重试保留（接口口径未变） ----------

t('T3 设置读取失败仍整页「设置加载失败」+ 重试；重试成功后设置页恢复且无运行参数分区', async () => {
  const h = harness();
  const view = element();
  h.seed('#settingsView', view);
  h.ctl.settingsFail = new Error('配置目录不可读');
  await h.run('renderSettingsView()');
  const failed = view.innerHTML;
  assert.match(failed, /设置加载失败/, '读取失败仍显示整页错误');
  assert.match(failed, /配置目录不可读/, '错误信息可见');
  assert.match(failed, /id="stRetry"/, '失败态提供重试按钮');
  // 重试成功 → 恢复「批量任务」，且无运行参数分区
  h.ctl.settingsFail = null;
  await view.querySelector('#stRetry').fire('click').result;
  assert.match(view.innerHTML, /<h4>批量任务<\/h4>/, '重试成功后设置页恢复');
  assert.doesNotMatch(view.innerHTML, /<h4>运行参数<\/h4>/, '重试成功后亦无「运行参数」分区');
});

// ---------- T4 静态契约：渲染与绑定不再含运行参数，读取调用保留 ----------

t('T4 静态契约：bindSettingsView 不再绑定运行参数保存；renderSettingsView 仍读取 /api/dispatch/settings；旧保存 toast 不残留', () => {
  const paint = source.match(/function paintSettingsView\(view\)[\s\S]*?\n\}/);
  assert.ok(paint, '应存在 paintSettingsView');
  for (const id of ST_IDS) {
    assert.doesNotMatch(paint[0], new RegExp(`id="${id}"`), `paintSettingsView 不应再拼接 ${id}`);
  }
  assert.doesNotMatch(paint[0], /运行参数/, 'paintSettingsView 不应再拼接「运行参数」分区');
  const bind = source.match(/function bindSettingsView\(view\)[\s\S]*?\n\}/);
  assert.ok(bind, '应存在 bindSettingsView');
  assert.doesNotMatch(bind[0], /stSave|stCliPath|stTimeout|stRetries|stResumeRestart|stAllowNonGit/, 'bindSettingsView 不应再引用运行参数控件');
  assert.doesNotMatch(bind[0], /dispatch\/settings/, '设置视图不再发起 /api/dispatch/settings 保存');
  const render = source.match(/async function renderSettingsView\(\)[\s\S]*?\n\}/);
  assert.ok(render, '应存在 renderSettingsView');
  assert.match(render[0], /\/api\/dispatch\/settings/, '仍读取项目设置（取值来源待确认，保留既有落盘配置，服务端消费照常）');
  // 旧保存入口的操作反馈文案随分区删除，不残留死文案
  assert.doesNotMatch(source, /已保存项目设置（用于后续新执行）/, '运行参数保存 toast 文案应随入口删除');
});

// ---------- T5 范围边界：服务端消费点与接口不动（README 期望行为 3/4） ----------

t('T5 服务端不动：scheduler 仍读 cliPath/allowNonGit/resumeAfterRestart；codex-adapter 仍加 --skip-git-repo-check；settings 接口保留', () => {
  assert.match(scheduler, /settings\(\)\.cliPath/, 'scheduler 仍读取既有落盘 cliPath');
  assert.match(scheduler, /settings\(\)\.allowNonGit/, 'scheduler 仍读取既有落盘 allowNonGit');
  assert.match(scheduler, /cfg\.resumeAfterRestart/, 'scheduler 重启恢复仍读取 resumeAfterRestart');
  assert.match(adapter, /--skip-git-repo-check/, 'codex-adapter 仍按 allowNonGit 追加 --skip-git-repo-check');
  assert.match(srv, /GET[\s\S]{0,40}\/api\/dispatch\/settings|'\/api\/dispatch\/settings'[\s\S]{0,80}readSettings/s, 'server 仍提供 /api/dispatch/settings 读取');
  assert.match(srv, /req\.method === 'POST' && pathname === '\/api\/dispatch\/settings'/, 'server 仍提供 /api/dispatch/settings 保存（是否连带删除属待确认，不在本单）');
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
