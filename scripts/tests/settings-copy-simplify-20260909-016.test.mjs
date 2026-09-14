#!/usr/bin/env node
// BUG-20260909-016 契约测试 —— 设置「批量任务」分区描述精简（仅改文案、不改行为）
// 引入来源：REQ-20260909-011（分区通用说明两长句）+ REQ-20260909-010（开关长说明与 title 提示）。
// 覆盖（README 期望行为 1–4 / 验收说明）：
//   1) 分区说明精简为单句（≤45 字，语义要点：子代理模式 / 模型跟随主调度会话 / 保存仅对后续新任务生效）
//   2) 开关说明精简为单句（≤35 字，开启=自动移入计划 / 默认关闭=人工移入计划）；
//      title 悬停提示与可见说明统一为同一短句，不再两处长文逐字重复
//   3) 合计 ≤80 字（现状 119+93）；四要点在两段文案中合并可读
//   4) 行为零回归：aria-label 与可见文字 / 默认关闭与已开启回显 / 草稿提示「有未保存的更改」/
//      保存仅提交 refine.autoPlanAfterDone / 保存中防重复 / 成功失败 toast 与就近状态 / 加载骨架与失败重试
//   5) 无精简遗留：旧三段长文案不残留；「可在任意一种 Agent 会话粘贴执行」口径移出设置分区
//      （批量开发 / 批量完善页签启动说明仍保留，信息不丢失）；无空段落与失效 title
// 用法：node scripts/tests/settings-copy-simplify-20260909-016.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');

// 精简后文案（README 期望行为建议形态，与条目 ui-demo.html 验收示意一致）
const DESC = '两类批量任务均为子代理模式，子代理模型跟随主调度会话；保存仅对后续新任务生效。';
const SUB = '开启后完善完成即自动移入计划；默认关闭＝人工移入计划。';

// DOM 接缝：控件级 stub（task-settings-simplify-20260909-001 同法）
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

function setup() {
  const document = element();
  document.createElement = element;
  const seed = (selector, el) => document.nodes.set(selector, el);
  document.querySelector = (selector) => { if (!document.nodes.has(selector)) document.nodes.set(selector, element()); return document.get ? document.get(selector) : document.nodes.get(selector); };
  const posted = [];
  const resp = (ok, body, status = ok ? 200 : 500) => ({ ok, status, statusText: ok ? 'OK' : 'ERR', json: async () => body });
  const ctl = { getDelay: null, getFail: null, postGate: null, postFail: false, saved: { version: 1, agents: { refine: ['zcode', 'codex'], develop: ['zcode', 'codex'] }, models: { refine: {}, develop: {} }, refine: { autoPlanAfterDone: false } } };
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
          if (posted[posted.length - 1].body.refine) ctl.saved = { ...ctl.saved, refine: posted[posted.length - 1].body.refine };
          return resp(true, { ok: true, settings: ctl.saved });
        }
        if (ctl.getDelay) await ctl.getDelay;
        if (ctl.getFail) return resp(false, { error: ctl.getFail.message });
        return resp(true, { settings: ctl.saved });
      }
      if (p === '/api/dispatch/settings') return resp(true, { settings: { codex: { cliPath: null, timeoutMin: 60, retries: 2 } } });
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

function readyView(h) {
  const view = element();
  view.nodes.set('#tsAutoPlan', element());
  view.nodes.set('#tsStatus', element());
  view.nodes.set('#tsSave', element());
  h.seed('#settingsView', view);
  return view;
}

// 从 taskSettingsHtml 输出解析三处文案
const parseCopy = (out) => {
  const desc = out.match(/<p class="muted small">([^<]*)<\/p>/);
  const sub = out.match(/<p class="muted small" style="margin:2px 0 0">([^<]*)<\/p>/);
  const title = out.match(/<label class="field-inline" title="([^"]*)"/);
  return { desc: desc ? desc[1].trim() : '', sub: sub ? sub[1].trim() : '', title: title ? title[1].trim() : '' };
};

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- T1 分区说明精简（README 期望行为 1a/1b/1d） ----------

t('T1 分区说明精简为单句：含子代理模式 / 跟随主调度会话 / 保存仅对后续新任务生效，≤45 字且无旧长句片段', () => {
  const h = setup();
  const out = h.run('taskSettingsHtml({})');
  const { desc } = parseCopy(out);
  assert.ok(desc, '应存在分区通用说明段落');
  assert.match(desc, /子代理模式/, '要点(a)：两类批量任务均为子代理模式');
  assert.match(desc, /跟随主调度会话/, '要点(b)：子代理模型跟随主调度会话');
  assert.match(desc, /保存仅对后续新任务生效/, '要点(d)：仅对后续生效、不追溯（合并表述）');
  assert.ok(desc.replace(/\s/g, '').length <= 45, `分区说明应 ≤45 字（实际 ${desc.replace(/\s/g, '').length}）`);
  for (const frag of ['单一通用版', '可在任意一种 Agent 会话粘贴执行', '（与当前主调度会话一致）', '无需按 Agent 配置', '进行中的任务保持原设置']) {
    assert.ok(!desc.includes(frag), `分区说明不再含旧长句片段：${frag}`);
  }
});

// ---------- T2 开关说明精简 + title 统一（README 期望行为 1c） ----------

t('T2 开关说明精简为单句：开启=自动移入计划 / 默认关闭=人工移入计划（≤35 字）；title 与可见说明统一为同一短句', () => {
  const h = setup();
  const out = h.run('taskSettingsHtml({})');
  const { sub, title } = parseCopy(out);
  assert.ok(sub, '应存在开关下方说明段落');
  assert.match(sub, /开启后完善完成即自动移入计划/, '要点(c)：开启 = 完善完成后自动移入计划');
  assert.match(sub, /默认关闭 ?[=＝] ?人工移入计划/, '要点(c)：默认关闭 = 人工移入计划');
  assert.ok(sub.replace(/\s/g, '').length <= 35, `开关说明应 ≤35 字（实际 ${sub.replace(/\s/g, '').length}）`);
  for (const frag of ['done 核验通过', '进入批量开发候选', '不追溯', '已接受时']) {
    assert.ok(!sub.includes(frag), `开关说明不再含旧长句片段：${frag}`);
  }
  assert.equal(title, sub, 'title 悬停提示与可见说明统一为同一短句（不再两处长文逐字重复）');
  for (const frag of ['done 核验通过', '进入批量开发候选', '仅对后续完善回执生效']) {
    assert.ok(!title.includes(frag), `title 不再含旧长文片段：${frag}`);
  }
});

// ---------- T3 合计长度与语义四要点（验收说明第 1/2 条） ----------

t('T3 合计 ≤80 字（现状 119+93）；四要点在精简文案中仍可读（与 ui-demo 验收示意一致）', () => {
  const h = setup();
  const out = h.run('taskSettingsHtml({})');
  const { desc, sub } = parseCopy(out);
  const total = (desc + sub).replace(/\s/g, '').length;
  assert.ok(total <= 80, `分区说明 + 开关说明合计应 ≤80 字（实际 ${total}）`);
  // 验收示意文案逐字锁定（最终措辞按 README 建议形态落地）
  assert.equal(desc, DESC, '分区说明为验收示意短句');
  assert.equal(sub, SUB, '开关说明为验收示意短句');
});

// ---------- T4 行为零回归（README 期望行为 2） ----------

t('T4 行为零回归：aria-label 与可见文字 / 默认关闭与已开启回显 / 草稿提示 / 保存载荷仅 refine / 保存中防重复 / 失败保留草稿', async () => {
  const h = setup();
  // 渲染契约：aria-label 与可见文字保留（settings-simplify-20260909-002 T6 同口径）
  let out = h.run('taskSettingsHtml({})');
  assert.match(out, /id="tsAutoPlan"[^>]*aria-label="完善完成后自动转入计划"/, '开关可访问名称保留');
  assert.match(out, /> 完善完成后自动转入计划/, '开关保留可见文字');
  assert.doesNotMatch(out, /id="tsAutoPlan"[^>]*checked/, '默认关闭不勾选');
  out = h.run('taskSettingsHtml({ refine: { autoPlanAfterDone: true } })');
  assert.match(out, /id="tsAutoPlan"[^>]*checked/, '已开启回显勾选');
  // 交互契约：草稿提示 + 保存载荷 + 保存中防重复 + 失败保留草稿
  const view = readyView(h);
  await h.run('renderSettingsView()');
  const status = view.nodes.get('#tsStatus');
  const saveBtn = view.nodes.get('#tsSave');
  const sw = view.nodes.get('#tsAutoPlan');
  sw.checked = true;
  sw.fire('change');
  assert.match(status.textContent, /有未保存的更改/, '切换开关就近提示未保存');
  h.posted.length = 0;
  let release;
  h.ctl.postGate = { promise: new Promise((r) => { release = r; }) };
  const clickP = saveBtn.fire('click').result;
  assert.equal(saveBtn.disabled, true, '保存中禁用重复提交');
  assert.equal(saveBtn.textContent, '保存中…', '保存中按钮文案');
  release();
  await clickP;
  const post = h.posted.find((p) => p.url === '/api/tasks/settings');
  assert.ok(post, '应发起任务设置保存请求');
  assert.deepEqual(post.body, { refine: { autoPlanAfterDone: true } }, '保存载荷仅含 refine 开关（行为不变）');
  assert.match(status.textContent, /^已保存/, '保存成功就近显示已保存');
  // 保存失败：草稿保留、不误报成功
  h.ctl.postGate = null;
  h.ctl.postFail = true;
  sw.checked = false;
  sw.fire('change');
  await saveBtn.fire('click').result;
  assert.match(status.textContent, /保存失败/, '失败就近显示保存失败');
  assert.equal(sw.checked, false, '用户草稿保留（复选框不被重置）');
});

t('T4b 成功 toast 与加载两阶段、失败重试不受影响（本单不改 toast / 加载行为）', async () => {
  // 成功 toast 口径保留（refine-auto-plan-20260909-010 A9 同契约）
  assert.match(source, /toast\('✓ 已保存批量任务设置（流转开关仅对后续完善回执生效）'\)/, '成功 toast 保持现状');
  const h = setup();
  const view = readyView(h);
  let release;
  h.ctl.getDelay = new Promise((r) => { release = r; });
  const p = h.run('renderSettingsView()'); // 阶段一同步完成
  assert.match(view.innerHTML, /正在加载任务设置/, '加载中骨架保留');
  assert.doesNotMatch(view.innerHTML, /id="tsAutoPlan"/, '加载中不渲染编辑控件');
  assert.doesNotMatch(view.innerHTML, /id="tsSave"/, '加载中不渲染保存按钮');
  release();
  await p;
  assert.match(view.innerHTML, /id="tsAutoPlan"/, '加载完成后渲染开关');
  assert.match(view.innerHTML, /id="tsSave"/, '加载完成后渲染保存按钮');
  // 加载失败 + 重试
  h.ctl.getFail = new Error('服务暂不可用');
  await h.run('renderSettingsView()');
  assert.match(view.innerHTML, /任务设置加载失败/, '失败态显示任务设置加载失败');
  assert.match(view.innerHTML, /id="tsRetry"/, '失败态提供重试按钮');
  h.ctl.getFail = null;
  const retry = view.nodes.get('#tsRetry') || view.querySelector('#tsRetry');
  await retry.fire('click').result;
  assert.match(view.innerHTML, /id="tsAutoPlan"/, '重试成功后恢复编辑');
});

// ---------- T5 无精简遗留（README 期望行为 3 / 验收说明「无精简遗留」） ----------

t('T5 无精简遗留：旧三段长文案不残留在 app.js；「可在任意一种 Agent 会话粘贴执行」口径移出设置分区但页签启动说明保留；无空段落与失效 title', () => {
  // 旧长句代表性片段全文不残留（源码级契约）
  for (const frag of ['（与当前主调度会话一致），无需按 Agent 配置', '进行中的任务保持原设置', '完善回执 done 核验通过', '进入批量开发候选；默认关闭', '进行中与已完成的完善运行不追溯']) {
    assert.ok(!source.includes(frag), `旧长句片段应删除：${frag}`);
  }
  // 口径迁移：「可在任意一种 Agent 会话粘贴执行」不在设置分区函数内，但在批量开发 / 批量完善页签说明保留（信息不丢失）
  const fn = source.match(/function taskSettingsHtml\([\s\S]*?\n\}/)[0];
  assert.doesNotMatch(fn, /可在任意一种 Agent 会话粘贴执行/, '设置分区不再承载提示词通用口径');
  const occurrences = source.split('可在任意一种 Agent 会话粘贴执行').length - 1;
  assert.ok(occurrences >= 2, `批量开发 / 批量完善页签启动说明仍保留该口径（实际 ${occurrences} 处）`);
  // 无空段落、无空 title
  const h = setup();
  const out = h.run('taskSettingsHtml({})');
  assert.doesNotMatch(out, /<p class="muted small">\s*<\/p>/, '无空说明段落残留');
  assert.doesNotMatch(out, /title=""/, '无失效空 title');
  assert.match(out, /id="tsStatus"[^>]*>已加载设置</, '状态行初始文案保留');
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
