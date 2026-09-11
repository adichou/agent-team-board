#!/usr/bin/env node
// BUG-20260911-004 营销概览页签切换后内容空白（需 Cmd+R）—— 前端契约 + 行为测试
// U1 为源码静态契约（render 写入的 pane 属性与 setTab 读取的 dataset 键必须一致），
// U2/U3 为 vm 行为（加载实际 marketing.js；fake DOM 提供 .mkt-pane / .mkt-tab 节点，
// 模拟 render() 产出：pane 带 data-mkt-pane（dataset.mktPane）、按钮带 data-tab）。
// 用法：node scripts/tests/marketing-overview-tab-20260911-004.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const mktJs = fs.readFileSync(path.join(webRoot, 'marketing.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- vm 接缝（marketing-ui.test.mjs 同法） ---------- */
function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false, checked: false, hidden: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, element()); return nodes.get(sel); },
    querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); },
    replaceChildren(...c) { this.children = c; },
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {}, click() {},
    closest() { return null; },
    get scrollTop() { return 0; }, set scrollTop(v) {},
  };
}

function statePayload() {
  return {
    initialized: true,
    profile: {
      id: 'mp-1', revision: 2, createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T01:00:00.000Z',
      positioning: {
        intro: '一句话介绍', stage: 'validating', markets: '', audience: '独立开发者', scenarios: '',
        painPoints: '工具割裂', alternatives: '', differentiators: '本地优先', links: '',
        stageGoal: '验证首次使用价值', primaryMetric: '激活人数', budget: null, weeklyHours: null,
      },
      evidence: [], currentPricing: 'v1',
    },
    versions: [
      { version: 'v1', model: 'subscription', currency: 'CNY', cycle: 'monthly', packages: [{ name: '专业版', benefits: '', price: 29 }], costBasis: '', competitorBasis: '', validationMethod: '', createdAt: '2026-09-10T00:00:00.000Z' },
    ],
    current: 'v1',
  };
}

/* 模拟 render() 产出的 pane / 页签按钮（dataset 键与真实 DOM 的 data-* 属性对应） */
function paneNode(key, hidden) {
  const classes = new Set(hidden ? ['hidden'] : []);
  return {
    dataset: { mktPane: key },
    classList: {
      add: (v) => classes.add(v), remove: (v) => classes.delete(v),
      contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v),
    },
  };
}

function tabBtnNode(key, active) {
  const classes = new Set(active ? ['active'] : []);
  return {
    dataset: { tab: key }, disabled: false, listeners: {},
    classList: {
      add: (v) => classes.add(v), remove: (v) => classes.delete(v),
      contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v),
    },
    addEventListener(event, fn) { this.listeners[event] = fn; },
  };
}

function setup() {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.querySelector = (sel) => document.nodes.get(sel) ?? null;
  const view = element();
  const panes = {
    overview: paneNode('overview', false),
    positioning: paneNode('positioning', true),
    channels: paneNode('channels', true),
    review: paneNode('review', true),
  };
  const tabBtns = {
    overview: tabBtnNode('overview', true),
    positioning: tabBtnNode('positioning', false),
    channels: tabBtnNode('channels', false),
    review: tabBtnNode('review', false),
  };
  view.querySelectorAll = (sel) => {
    if (sel === '.mkt-pane') return Object.values(panes);
    if (sel === '.mkt-tab') return Object.values(tabBtns);
    return [];
  };
  document.nodes.set('#marketingView', view);
  for (const id of ['#mktSwitchWrap', '#mktSwitchText', '#mktSwitchSave', '#mktSwitchDiscard', '#mktSwitchCancel']) {
    document.nodes.set(id, element());
  }
  document.addEventListener = () => {};
  const calls = [];
  const sandbox = {
    document, console, URLSearchParams, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async (url, opts) => {
      calls.push({ url: String(url), method: opts?.method || 'GET' });
      const json = String(url).includes('/api/marketing/state') ? statePayload() : { initialized: false };
      return { ok: true, status: 200, json: async () => json };
    },
    navigator: {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(mktJs, sandbox, { filename: 'marketing.js' });
  return { ...sandbox, calls, panes, tabBtns, tick: () => new Promise((r) => setTimeout(r, 0)) };
}

const hiddenOf = (h, key) => h.panes[key].classList.contains('hidden');

/* ---------- 静态契约 ---------- */

t('U1 契约：render 写入 data-mkt-pane，setTab 读取同名 dataset 键（属性不匹配会让所有 pane 误加 hidden）', () => {
  assert.match(mktJs, /data-mkt-pane="(overview|positioning|channels|review)"/, 'render() 写入 data-mkt-pane 属性');
  const setTabSrc = mktJs.slice(mktJs.indexOf('function setTab'), mktJs.indexOf('function selectVersion'));
  assert.ok(setTabSrc.length > 0, '应存在 setTab 函数');
  assert.match(setTabSrc, /dataset\?\.mktPane/, 'setTab 应读取 dataset.mktPane（与 data-mkt-pane 对应）');
});

/* ---------- vm 行为 ---------- */

t('U2 模块内页签往返：切换到其他页签再返回概览，概览 pane 保持可见（不隐藏全部 pane）', async () => {
  const h = setup();
  await h.ATBMarketing.enter('/p'); // 首次进入：overview 可见
  assert.equal(hiddenOf(h, 'overview'), false, '初始概览可见');

  h.ATBMarketing.setTab('positioning');
  assert.equal(hiddenOf(h, 'positioning'), false, '切到「定位与定价」后该 pane 可见');
  assert.equal(hiddenOf(h, 'overview'), true, '非当前页签隐藏');

  h.ATBMarketing.setTab('overview'); // 返回概览，不触发完整重绘
  assert.equal(hiddenOf(h, 'overview'), false, '返回概览后数据仍可见（无需 Cmd+R）');
  assert.equal(hiddenOf(h, 'positioning'), true, '其余页签隐藏');
  assert.equal(h.tabBtns.overview.classList.contains('active'), true, '概览页签按钮 active');
});

t('U3 经「渠道与行动」「效果与复盘」往返与跨模块重入：概览 pane 均保持可见', async () => {
  const h = setup();
  await h.ATBMarketing.enter('/p');

  h.ATBMarketing.setTab('channels');
  await h.tick(); // 等首次看板拉取（fetch stub 返回未初始化）
  assert.equal(hiddenOf(h, 'channels'), false, '切到「渠道与行动」后该 pane 可见');

  h.ATBMarketing.setTab('review');
  await h.tick(); // 等首次效果数据拉取
  assert.equal(hiddenOf(h, 'review'), false, '切到「效果与复盘」后该 pane 可见');

  h.ATBMarketing.setTab('overview');
  assert.equal(hiddenOf(h, 'overview'), false, '经后两页返回概览后数据仍可见');

  // 跨模块重入（app.js 切回 marketing 时 enter 同项目不重绘）：概览内容保持
  await h.ATBMarketing.enter('/p');
  assert.equal(hiddenOf(h, 'overview'), false, '跨模块重入概览后数据仍可见（无需 Cmd+R）');
  assert.equal(hiddenOf(h, 'positioning'), true);
  assert.equal(hiddenOf(h, 'channels'), true);
  assert.equal(hiddenOf(h, 'review'), true);
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
