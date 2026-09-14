#!/usr/bin/env node
// BUG-20260908-006 「改为已计划」统一改为「移入计划」 —— 文案契约测试
// 覆盖 BUG test-cases.md 用例 1-5；用例 6（既有交互回归）由全量套件承担
// 用法：node scripts/tests/plan-wording.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8');
const appSrc = read('scripts/web/app.js');
const batchSrc = read('scripts/lib/batch.mjs');
const devMd = read('commands/dev.md');
const skillMd = read('skills/agent-team-board/SKILL.md');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    dataset: {}, innerHTML: '', textContent: '', title: '', disabled: false, checked: false,
    value: '', children: [], listeners: {},
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

t('W1 详情按钮：accepted 档按钮为「➤ 移入计划」，data-act/data-label 契约保留（用例 1）', () => {
  const document = element();
  document.createElement = element;
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }) },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  vm.createContext(sandbox);
  vm.runInContext(appSrc.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  run('state.project = "/project/p";');
  const acc = run('drawerActionsButtonHtml({ id: "REQ-20990101-4", status: "accepted", title: "t" })');
  assert.match(acc, /data-act="planned" data-label="移入计划"/, '按钮应为 data-act=planned + data-label=移入计划');
  assert.match(acc, /➤ 移入计划/, '按钮可见文案应为 ➤ 移入计划');
  assert.ok(!acc.includes('改为已计划'), '按钮不应再出现旧文案');
  const pl = run('drawerActionsButtonHtml({ id: "REQ-20990101-1", status: "planned", title: "t" })');
  assert.match(pl, /↩ 移出计划/, 'planned 档「移出计划」文案不受影响');
});

t('W2 插件源码不再出现「改为已计划」（用例 2）', () => {
  for (const [name, src] of [['scripts/web/app.js', appSrc], ['scripts/lib/batch.mjs', batchSrc], ['commands/dev.md', devMd], ['skills/agent-team-board/SKILL.md', skillMd]]) {
    assert.ok(!src.includes('改为已计划'), `${name} 不应再出现旧文案「改为已计划」`);
  }
});

t('W3 指引文案统一「移入计划」：LANE_HINT、未入批次提示、详情未入计划 notice、批量开发空态（用例 3）', () => {
  assert.match(appSrc, /「移入计划」排入开发计划/, 'LANE_HINT/未入批次提示应指引「移入计划」');
  assert.match(appSrc, /可点「移入计划」排入开发计划/, '详情未入计划 notice 应用「移入计划」');
  assert.match(appSrc, /详情页「移入计划」/, '批量开发空态提示应指向详情页「移入计划」');
});

t('W4 CLI 提示：batch.mjs 无候选提示指引「移入计划」（用例 4）', () => {
  assert.match(batchSrc, /接受条目并「移入计划」/, 'batch next 无候选提示应指引「移入计划」');
});

t('W5 Agent 指引：dev.md 与 SKILL.md 排期指引应用「移入计划」（用例 5）', () => {
  assert.match(devMd, /接受并「移入计划」/, 'dev.md 指引应使用「移入计划」');
  assert.match(skillMd, /接受并「移入计划」/, 'SKILL.md 指引应使用「移入计划」');
});

// ---------- runner ----------
let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
