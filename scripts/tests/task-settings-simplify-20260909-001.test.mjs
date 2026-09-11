#!/usr/bin/env node
// REQ-20260909-001 契约测试 —— 任务设置（隐藏开关 + 草稿/加载/失败反馈机制）
// REQ-20260909-005 更新：设置区在两列隐藏开关之上重新引入「模型来源 / 子代理模型 / 推理强度」
// 三列（五列表格，默认跟随主调度会话，手动指定为显式覆盖）。
// REQ-20260909-011 更新：设置区去 Agent 化——删除五列表格与全部隐藏联动，仅保留完善流转开关；
// 保存仅提交 refine；创建入口固定 follow（不再读 models）。T1/T2/T5/T7/T8/T9 契约随本需求更新。
// 覆盖：
//   1) taskSettingsHtml 精简形态：通用说明 + 流转开关 + 保存；无按 Agent 控件
//   2) 保存仅提交 refine 流转开关
//   3) 数据层：agents-only patch 保留既有 models（存储兼容不动）
//   4) 草稿与就近反馈：有未保存的更改 / 保存中…禁重复 / 已保存 / 失败保留草稿不误报成功
//   5) 加载状态：正在加载任务设置（不渲染编辑与保存，避免未加载完成覆盖配置）
//   6) 加载失败：任务设置加载失败 + 重试
//   7) 按 Agent 配置移除契约：无全部隐藏提示与联动
//   8) 文案口径：子代理模式 + 默认跟随主调度会话；旧智能档建议不回归
//   9) 底层链路：创建入口固定 follow；settings POST 忽略 agents/models；存储与校验保留
// 用法：node scripts/tests/task-settings-simplify-20260909-001.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as taskSettings from '../lib/task-settings.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const srv = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');

// DOM 接缝：控件级 stub（settings-simplify-20260909-002 同法），
// 额外支持 querySelectorAll（按 __match 谓词过滤种子节点）与受控 fetch 门闩
function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes,
    dataset: {}, innerHTML: '', textContent: '', title: '', value: '', disabled: false, checked: false, indeterminate: false,
    tagName: 'DIV', __match: null,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll(selector) { return Array.from(nodes.values()).filter((el) => el.__match && el.__match(selector)); },
    appendChild(child) { this.children.push(child); },
    prepend(child) { this.children.unshift(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {},
    fire(event) { const e = { target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
}

const defaultTs = () => ({
  version: 1,
  agents: { refine: ['zcode', 'codex'], develop: ['zcode', 'codex'] },
  models: {
    refine: { zcode: { model: '', level: 'high' }, codex: { model: '', level: 'high' } },
    develop: { zcode: { model: '', level: 'medium' }, codex: { model: '', level: 'medium' } },
  },
});

function setup() {
  const document = element();
  document.createElement = element;
  const seed = (selector, el) => document.nodes.set(selector, el);
  document.querySelector = (selector) => { if (!document.nodes.has(selector)) document.nodes.set(selector, element()); return document.nodes.get(selector); };
  const posted = [];
  const resp = (ok, body, status = ok ? 200 : 500) => ({ ok, status, statusText: ok ? 'OK' : 'ERR', json: async () => body });
  // 门闩：GET /api/tasks/settings 可延迟/失败；POST 可延迟/失败
  const ctl = { getDelay: null, getFail: null, postGate: null, postFail: false, saved: defaultTs() };
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, confirm: () => true },
    fetch: async (url, opts) => {
      const p = String(url).split('?')[0];
      const method = opts && opts.method;
      if (method === 'POST') posted.push({ url: p, body: JSON.parse(opts.body || '{}') });
      if (p === '/api/tasks/settings') {
        if (method === 'POST') {
          if (ctl.postGate) await ctl.postGate.promise;
          if (ctl.postFail) return resp(false, { error: '磁盘写入失败' });
          if (posted[posted.length - 1].body.agents) ctl.saved = { ...ctl.saved, agents: posted[posted.length - 1].body.agents };
          return resp(true, { ok: true, settings: ctl.saved });
        }
        if (ctl.getDelay) await ctl.getDelay;
        if (ctl.getFail) return resp(false, { error: ctl.getFail.message });
        return resp(true, { settings: ctl.saved });
      }
      if (p === '/api/dispatch/settings') {
        return resp(true, { settings: { codex: { cliPath: null, timeoutMin: 60, retries: 2 } } });
      }
      return resp(true, {});
    },
  };
  sandbox.__posted = posted;
  sandbox.__ctl = ctl;
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  run('toast = () => {}; poll = async () => {}; refreshDrawer = async () => {}; refreshBatch = async () => {}; renderBatchDrawer = () => {};');
  return { sandbox, document, state, run, seed, posted, ctl };
}

// 渲染就绪视图：预置流转开关/状态位/保存按钮节点，
// 使 bindSettingsView 的 querySelector 命中与真实 DOM 等价的种子（REQ-20260909-011 精简形态）
function readyView(h) {
  const view = element();
  view.nodes.set('#tsAutoPlan', element());
  view.nodes.set('#tsStatus', element());
  view.nodes.set('#tsSave', element());
  h.seed('#settingsView', view);
  return view;
}

const autoPlanBox = (view) => view.nodes.get('#tsAutoPlan');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- T1 渲染（REQ-20260909-011 设置区去 Agent 化精简） ----------

t('T1 taskSettingsHtml 精简形态：标题 + 通用说明 + 流转开关 + 保存；无表格与任何按 Agent 控件', () => {
  const h = setup();
  const ts = defaultTs();
  const out = h.run(`taskSettingsHtml(${JSON.stringify(ts)})`);
  assert.match(out, /<h4>批量任务<\/h4>/, '「批量任务」分区标题保留');
  assert.match(out, /子代理模式/, '说明含子代理模式口径');
  assert.match(out, /跟随主调度会话/, '说明含默认跟随语义');
  assert.match(out, /id="tsAutoPlan"/, '完善完成后自动转入计划开关保留');
  assert.match(out, /id="tsSave"/, '保存按钮保留');
  assert.match(out, /id="tsStatus"/, '就近状态反馈位保留');
  assert.doesNotMatch(out, /<table/, 'REQ-20260909-011：无表格');
  for (const id of ['tsSource-', 'tsModel-', 'tsLevel-', 'tsHidden-', 'tsEmpty-']) {
    assert.ok(!out.includes(id), `不得出现 ${id} 控件（按 Agent 配置已移除）`);
  }
  assert.doesNotMatch(out, /执行 Agent/, '设置区不再出现执行 Agent 维度');
  assert.doesNotMatch(out, /ts-agents-line/, '无残留占位结构');
});

// ---------- T2 保存载荷（REQ-20260909-011：仅 refine 流转开关） ----------

t('T2 保存仅提交 refine 流转开关；agents/models 不再有界面入口', async () => {
  const h = setup();
  const view = readyView(h);
  await h.run('renderSettingsView()');
  view.nodes.get('#tsAutoPlan').checked = true;
  view.nodes.get('#tsAutoPlan').fire('change');
  h.posted.length = 0;
  await h.run('document.querySelector("#settingsView").querySelector("#tsSave").fire("click")');
  const post = h.posted.find((p) => p.url === '/api/tasks/settings');
  assert.ok(post, '应发起任务设置保存请求');
  assert.deepEqual(post.body, { refine: { autoPlanAfterDone: true } }, '保存载荷仅含 refine 开关');
});

// ---------- T3 数据层：agents-only patch 不重置 models ----------

t('T3 数据层：仅 patch agents 时既有模型/档位原样保留并持久化', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-ts-simplify-')));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  taskSettings.saveTaskSettings(dataDir, { models: { refine: { zcode: { model: 'glm-5.3', level: 'medium' } } } });
  const r = taskSettings.saveTaskSettings(dataDir, { agents: { refine: [], develop: ['zcode'] } });
  assert.deepEqual(r.agents.refine, [], '全部隐藏保存成功');
  assert.equal(r.models.refine.zcode.model, 'glm-5.3', '已保存模型不被清空');
  assert.equal(r.models.refine.zcode.level, 'medium', '已保存档位不被重置');
  assert.equal(r.models.develop.codex.level, 'medium', '未触及的默认档位保持');
  const re = taskSettings.loadTaskSettings(dataDir);
  assert.equal(re.models.refine.zcode.model, 'glm-5.3', '持久化可读（验收：不重置原模型/档位字段）');
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------- T4 草稿与就近反馈 ----------

t('T4 草稿反馈：变更提示「有未保存的更改」；保存中禁重复；成功「已保存」；失败保留草稿不误报成功', async () => {
  const h = setup();
  const view = readyView(h);
  await h.run('renderSettingsView()');
  const status = view.nodes.get('#tsStatus');
  const saveBtn = view.nodes.get('#tsSave');
  // 初始状态位文案（stub 不解析 HTML，静态断言源码契约）
  assert.match(source.match(/function taskSettingsHtml\([\s\S]*?\n\}/)[0], />已加载设置</, '初始状态位显示已加载');
  // 草稿变更 → 有未保存的更改（REQ-20260909-011：仅流转开关可编辑）
  const c = autoPlanBox(view);
  c.checked = true;
  c.fire('change');
  assert.match(status.textContent, /有未保存的更改/, '变更后就近提示未保存');
  // 保存中：按钮「保存中…」并禁用（门闩挂起请求）
  let release;
  h.ctl.postGate = { promise: new Promise((r) => { release = r; }) };
  const clickP = saveBtn.fire('click').result;
  assert.equal(saveBtn.disabled, true, '保存中禁用重复提交');
  assert.equal(saveBtn.textContent, '保存中…', '保存中按钮文案');
  release();
  await clickP;
  assert.equal(saveBtn.disabled, false, '完成后恢复可点');
  assert.equal(saveBtn.textContent, '保存批量任务设置', '完成后按钮文案恢复');
  assert.match(status.textContent, /^已保存/, '保存成功就近显示已保存');
  // 保存失败：草稿保留、显示错误、不误报成功
  h.ctl.postGate = null;
  h.ctl.postFail = true;
  const c2 = autoPlanBox(view);
  c2.checked = false;
  c2.fire('change');
  await saveBtn.fire('click').result;
  assert.match(status.textContent, /保存失败/, '失败就近显示保存失败');
  assert.match(status.textContent, /磁盘写入失败/, '失败信息含服务端错误');
  assert.equal(c2.checked, false, '用户草稿保留（复选框不被重置）');
  assert.doesNotMatch(status.textContent, /已保存(?!.*失败)/, '不得误报成功');
});

// ---------- T5 加载状态 ----------

t('T5 加载状态：先渲染「正在加载任务设置」骨架（无编辑与保存入口），完成后渲染开关表单', async () => {
  const h = setup();
  const view = readyView(h);
  let release;
  h.ctl.getDelay = new Promise((r) => { release = r; });
  const p = h.run('renderSettingsView()'); // 不等待：阶段一同步完成
  const loading = view.innerHTML;
  assert.match(loading, /正在加载任务设置/, '加载中显示「正在加载任务设置」');
  assert.doesNotMatch(loading, /id="tsAutoPlan"/, '加载中不渲染流转开关（禁编辑）');
  assert.doesNotMatch(loading, /id="tsSave"/, '加载中不渲染保存按钮（禁保存，避免未加载完成覆盖配置）');
  // 口径更新（BUG-20260909-011）：运行参数分区已删除，加载中不再出现随之禁用的运行参数保存按钮
  assert.doesNotMatch(loading, /id="stSave"/, '运行参数保存按钮已随分区删除（加载中不再出现）');
  release();
    await p;
    assert.match(view.innerHTML, /id="tsAutoPlan"/, '加载完成后渲染流转开关');
    assert.match(view.innerHTML, /id="tsSave"/, '加载完成后渲染保存按钮');
    // 就绪后保存与开关恢复可用
    assert.doesNotMatch(view.innerHTML, /id="tsSave"[^>]*disabled/, '就绪后保存按钮可点');
    assert.doesNotMatch(view.innerHTML, /id="tsAutoPlan"[^>]*disabled/, '就绪后流转开关可编辑');
});

// ---------- T6 加载失败与重试 ----------

t('T6 加载失败：显示「任务设置加载失败」与重试按钮，重试成功恢复编辑', async () => {
  const h = setup();
  const view = readyView(h);
  h.ctl.getFail = new Error('服务暂不可用');
  await h.run('renderSettingsView()');
  const failed = view.innerHTML;
  assert.match(failed, /任务设置加载失败/, '失败态显示任务设置加载失败');
  assert.match(failed, /服务暂不可用/, '失败态包含错误信息');
  assert.match(failed, /id="tsRetry"/, '失败态提供重试按钮');
  assert.doesNotMatch(failed, /id="tsAutoPlan"/, '失败态不渲染编辑控件');
  // 重试成功 → 恢复编辑
  h.ctl.getFail = null;
  const retry = view.nodes.get('#tsRetry') || view.querySelector('#tsRetry');
  await retry.fire('click').result;
  assert.match(view.innerHTML, /id="tsAutoPlan"/, '重试成功后恢复流转开关编辑');
  assert.match(view.innerHTML, /id="tsSave"/, '重试成功后恢复保存按钮');
});

// ---------- T7 按 Agent 配置移除契约 ----------

t('T7 按 Agent 配置移除（REQ-20260909-011）：无全部隐藏提示与联动逻辑；启动区不再消费隐藏列表', () => {
  const h = setup();
  const ts = defaultTs();
  ts.agents.refine = []; // 存量已全部隐藏（合法持久数据）也不再有对应 UI
  const out = h.run(`taskSettingsHtml(${JSON.stringify(ts)})`);
  assert.doesNotMatch(out, /tsEmpty|无可用 Agent|全部隐藏/, '全部隐藏提示已随配置移除');
  assert.doesNotMatch(source, /function updateTsEmptyHints/, '联动逻辑函数已删除');
  assert.doesNotMatch(source, /function visibleTaskAgents/, '启动区隐藏列表过滤已删除');
});

// ---------- T8 文案口径（REQ-20260909-011：通用说明；默认跟随主调度会话） ----------

t('T8 文案口径：分区说明含子代理模式与默认跟随语义；旧「按此生成提示词与子代理参数」「默认智能档建议」不回归', async () => {
  const fn = source.match(/function taskSettingsHtml\([\s\S]*?\n\}/)[0];
  assert.match(fn, /子代理模式/, '说明含子代理模式口径');
  assert.match(fn, /跟随主调度会话/, '说明含默认跟随语义');
  assert.doesNotMatch(source, /按此生成提示词与子代理参数/, '保存按钮旁提示同步精简');
  assert.doesNotMatch(source, /默认建议：完善工作流/, '默认智能档建议删除');
  const h = setup();
  const view = readyView(h);
  await h.run('renderSettingsView()');
  // BUG-20260909-016 文案精简：分区说明压缩为单句；「可在任意一种 Agent 会话粘贴执行」口径
  // 移出设置分区，由批量开发 / 批量完善页签的启动说明继续承载（信息不丢失）
  assert.match(view.innerHTML, /两类批量任务均为子代理模式，子代理模型跟随主调度会话；保存仅对后续新任务生效。/, '分区说明为 BUG-20260909-016 精简单句');
  assert.doesNotMatch(view.innerHTML, /可在任意一种 Agent 会话粘贴执行/, '设置页不再承载提示词通用口径（页签启动说明保留）');
  // Codex 存量面板的模型/强度文案不在本单范围（settings-simplify-20260909-002 T7 保留契约）
});

// ---------- T9 底层链路（REQ-20260909-011：创建入口固定 follow；POST 忽略 agents/models） ----------

t('T9 底层链路：创建入口不再读 models（固定 follow）；settings POST 忽略 agents/models；数据层存储结构保留', () => {
  assert.doesNotMatch(srv, /modelConfigOf/, '创建入口不再读取按 Agent 的模型配置（REQ-20260909-011）');
  assert.match(srv, /modelSource: 'follow'/, '创建入口固定注入跟随指令');
  assert.doesNotMatch(srv, /models: body\.models \?\? undefined/, 'POST 不再透传 models（agents/models 忽略）');
  const lib = fs.readFileSync(path.join(pluginRoot, 'scripts', 'lib', 'task-settings.mjs'), 'utf8');
  assert.match(lib, /TASK_LEVELS/, '档位常量与校验保留（存储结构不变）');
  assert.match(lib, /export function saveTaskSettings/, '保存函数保留');
  assert.match(lib, /TASK_MODEL_SOURCES/, 'REQ-20260909-005 来源常量与校验存在（存量数据兼容）');
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
