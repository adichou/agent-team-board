#!/usr/bin/env node
// REQ-20260907-008 讨论视图精简契约已由 REQ-20260909-004 开放式讨论重构更新。
// 本文件保留并更新为：视图无头部说明区与派单工具条（死规则不复活）、仅「讨论中 / 已归档」
// 两档 filter-chip（无「全部」、无旧四态）、阶段提示不成为筛选项、空态指向顶栏「＋ 新建」。
// 行为细节（提示词/纪要/草稿）由 discussion-ui.test.mjs 保证，随 run-all 全量跑。
// 用法：node scripts/tests/oncall-view-lean.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const oncallJs = fs.readFileSync(path.join(webRoot, 'oncall.js'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');

// DOM 接缝：控件级 stub（req-filter-removed.test.mjs 同法）
function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes,
    dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false, checked: false, indeterminate: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    prepend(child) { this.children.unshift(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {},
  };
}

// vm 加载 oncall.js：fetch stub 按 URL 返回 board，#oncallView / #ocList 由 document.nodes 承接渲染
function setup(board) {
  const document = element();
  document.createElement = element;
  document.addEventListener = () => {};
  document.querySelector = (selector) => document.nodes.get(selector) ?? null;
  document.nodes.set('#oncallView', element());
  document.nodes.set('#ocList', element());
  document.nodes.set('#ocDetail', element());
  document.nodes.set('#discMask', element());
  document.nodes.set('#oncallLightbox', element());
  const sandbox = {
    document, console, URLSearchParams, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    marked: { parse: (s) => s },
    fetch: async (url) => {
      if (String(url).includes('/api/discussion/board')) return { ok: true, json: async () => board };
      return { ok: true, json: async () => ({}) };
    },
    window: { addEventListener() {} },
    navigator: { clipboard: { writeText: async () => {} } },
  };
  sandbox.window = sandbox; // oncall.js 末尾 window.ATBOncall = ATBOncall
  vm.createContext(sandbox);
  vm.runInContext(oncallJs, sandbox, { filename: 'oncall.js' });
  return sandbox;
}

const disc = (id, over = {}) => ({
  id, title: `t-${id}`, status: 'discussing', phase: 'none', createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T01:00:00.000Z',
  draftCount: 0, createdCount: 0, ...over,
});

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('T1 静态契约：头部与派单工具条不复活，无死样式引用', () => {
  assert.doesNotMatch(oncallJs, /oncall-head/, 'oncall.js 不应再有头部 oncall-head 区块');
  assert.doesNotMatch(oncallJs, /新建讨论单/, 'oncall.js 不应再有模块内「新建讨论单」按钮');
  assert.doesNotMatch(oncallJs, /oncall-toolbar|批量派单|ocMode/, '看板代答工具条（模式选择/客服人员/批量派单）应删除');
  for (const rule of ['.oncall-head', '.oncall-title', '.oc-filter']) {
    assert.doesNotMatch(css, new RegExp(`${rule.replace('.', '\\.')}\\s*\\{`), `style.css 应无死规则 ${rule}`);
  }
  assert.match(css, /\.oncall-filters\s*\{|\.disc-filters\s*\{/, '筛选容器样式保留');
});

t('T2 行为：仅「讨论中 / 已归档」两档 chip，缺省「讨论中」，filter-chip + filter-count 带计数', async () => {
  const board = { initialized: true, discussions: [
    disc('ASK-20990101-001'), disc('ASK-20990101-002'),
    disc('ASK-20990101-003', { status: 'archived' }),
  ] };
  const h = setup(board);
  await h.ATBOncall.poll('/p', true);
  const html = h.document.querySelector('#oncallView').innerHTML;
  assert.doesNotMatch(html, /data-filter="all"|>全部</, '不应渲染「全部」chip');
  assert.match(html, /class="filter-chip active" data-filter="discussing"/, '缺省选中第一档「讨论中」');
  for (const [key, label, n] of [['discussing', '讨论中', 2], ['archived', '已归档', 1]]) {
    assert.match(html, new RegExp(`data-filter="${key}">${label} <span class="filter-count">${n}</span>`), `应含「${label}」filter-chip 且计数 ${n}`);
  }
  for (const old of ['pending', 'answering', 'answered', 'failed']) {
    assert.doesNotMatch(html, new RegExp(`data-filter="${old}"`), `不应再有旧状态档 ${old}`);
  }
});

t('T3 行为与契约：阶段提示（等待纪要等）不成为筛选项；读取失败仅为行内徽标', async () => {
  assert.doesNotMatch(oncallJs, /state\.filter = 'waiting'|data-filter="waiting"/, '等待纪要不得成为筛选项');
  const h = setup({ initialized: true, discussions: [
    disc('ASK-20990101-001', { phase: 'error' }),
    disc('ASK-20990101-002', { phase: 'waiting' }),
  ] });
  await h.ATBOncall.poll('/p', true);
  const html = h.document.querySelector('#oncallView').innerHTML;
  const rows = (h.document.querySelector('#ocList').children || []).map((c) => c.innerHTML || '').join('\n');
  assert.match(rows, /⚠ 读取失败/, '读取失败为行内徽标提示');
  assert.doesNotMatch(html, /data-filter="error"/, '读取失败不成为筛选档');
});

t('T4 行为与契约：列表无 all 过滤分支，空态文案指向顶栏「＋ 新建」', async () => {
  assert.doesNotMatch(oncallJs, /filter === 'all'/, 'renderList 不应保留 all 全量分支');
  assert.match(oncallJs, /filter: 'discussing'/, 'state.filter 缺省应为「讨论中」');
  const h = setup({ initialized: true, discussions: [] });
  await h.ATBOncall.poll('/p', true);
  const empty = h.document.querySelector('#ocList').innerHTML;
  assert.match(empty, /＋ 新建/, '空态文案应指向顶栏「＋ 新建」');
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
