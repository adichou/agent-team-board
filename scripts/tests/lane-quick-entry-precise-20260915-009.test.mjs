#!/usr/bin/env node
// BUG-20260915-009 需求模块快捷入口「▶ AI 分析 / ▶ AI 开发」未精准落到目标子面板 —— vm 行为测试
// （沿用 lane-quick-entry-20260909-007.test.mjs 的 vm 模拟 DOM 模式）
// 复现口径（README 验收说明）：两子面板本会话内先后渲染过 → 目标面板数据无变化（签名剪枝命中，
// refreshRefine 的 `sig === state.refine.sig` / refreshBatch 的 `sig === state.batchSig` 提前 return，
// 不再调 renderBatchDrawer）→ 点快捷入口必须仍精准落地目标子面板（页签高亮 + 面板内容一致），
// 不得依赖数据是否变化；无缓存数据时先渲染目标面板加载态；纯导航口径（不创建/不启动/无确认弹窗）
// 与完善徽标共用 gotoRuns('refine') 链路不回退。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 001/002 已接受（002 完善中）；003/004 待接受；005 已计划未认领；006 开发中
const item = (id, status = 'accepted', extra = {}) => ({
  id, type: 'requirement', status, owner: null, parent: null, title: id,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
});
const sample = () => [
  item('REQ-20990101-001'),
  item('REQ-20990101-002', 'accepted', { refineState: 'refining' }),
  item('REQ-20990101-003', 'submitted'),
  item('REQ-20990101-004', 'submitted'),
  item('REQ-20990101-005', 'planned'),
  item('REQ-20990101-006', 'in-progress', { owner: 'dev-x' }),
];

// 稳态数据源：同 URL 每次返回同一份载荷（签名恒定 → 第二轮起剪枝必命中）
const FIXTURES = [
  ['/api/refine/current', { batch: null, counts: { waiting: 1 }, records: [], recordsTotal: 0, stats: { done: 2 }, nextAction: null }],
  ['/api/refine/candidates', { candidates: [{ id: 'REQ-20990101-001', title: '已接受未完善条目', reasons: ['缺 README'] }] }],
  ['/api/batch/current', { batch: null, current: null, counts: {}, stats: { candidates: 2, blocked: 0 }, pending: [], records: [], recordsTotal: 0 }],
  ['/api/confirms', { items: [] }],
];

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    dataset: {}, innerHTML: '', textContent: '', disabled: false, checked: false, indeterminate: false,
    title: '', value: '', children: [], listeners: {},
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

function setup() {
  const document = element();
  document.createElement = element;
  const requests = [], confirmations = [];
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} },
    localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    sessionStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }), confirm: (message) => { confirmations.push(message); return true; } },
    fetch: async (url, opts) => {
      const u = String(url);
      requests.push({ url: u, opts });
      const hit = FIXTURES.find(([p]) => u.includes(p));
      return { ok: true, status: 200, statusText: 'OK', json: async () => (hit ? hit[1] : {}) };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  state.board = { initialized: true, items: sample() };
  run('toast = () => {}; poll = async () => {}; refreshDrawer = async () => {}; refreshHealth = async () => {}; updateBoardTabs = () => {}; markActiveTab = () => {};');
  // 快捷按钮点击绑定切片（与 lane-quick-entry-20260909-007.test.mjs 同落点）
  const bindStart = source.indexOf("$('#selectNone').addEventListener");
  const bindEnd = source.indexOf("$('#mask').addEventListener");
  if (bindStart >= 0 && bindEnd > bindStart) run(source.slice(bindStart, bindEnd));
  return { sandbox, document, state, run, requests, confirmations };
}

const drawerHtml = (h) => h.document.querySelector('#batchDrawer').innerHTML;
// renderBatchDrawer 头部页签：`class="tab ${active}" data-bmode="…"` —— 唯一 active 即当前子面板
const activeMode = (h) => {
  const html = drawerHtml(h);
  if (/class="tab active" data-bmode="refine"/.test(html)) return 'refine';
  if (/class="tab active" data-bmode="develop"/.test(html)) return 'develop';
  return null;
};

// 复现前置：两子面板本会话内先后各渲染过一次，随后停留在需求模块（#batchDrawer 残留 AI 开发面板）
async function renderBothPanels(h) {
  await h.run('gotoRuns("refine")'); // 首次进入：签名初值空 → 正常渲染 AI 分析面板
  await h.run('setView("status")'); // 离开任务模块（setView 仅隐藏 #runsView，抽屉 HTML 残留）
  await h.run('gotoRuns("develop")'); // 渲染 AI 开发面板
  await h.run('setView("status")'); // 再离开 → 残留 AI 开发面板（最常见的错位起点）
  h.requests.length = 0;
}

// R1 主复现（正向）：已接受档点「▶ AI 分析」，目标面板数据无变化（refine 签名剪枝命中），
// 落地必须即 AI 分析页签高亮 + AI 分析面板内容，不得停留在残留的 AI 开发面板
t('R1 数据稳态点「▶ AI 分析」：落地即 AI 分析页签高亮 + refine-create 启动区、无 dev-start 残留；refine 签名剪枝命中（渲染不依赖数据变化）', async () => {
  const h = setup();
  await renderBothPanels(h);
  const sigBefore = h.state.refine.sig;
  assert.ok(sigBefore, '前置：AI 分析面板本会话已渲染过（签名已落）');
  assert.equal(activeMode(h), 'develop', '前置：离开任务模块时抽屉残留 AI 开发面板');
  h.state.reqFilter = 'accepted';
  await h.document.querySelector('#laneQuickEntry').fire('click').result;
  assert.equal(h.state.view, 'runs', '进入任务模块');
  assert.equal(h.state.batch.mode, 'refine', 'mode 指向 AI 分析');
  assert.equal(activeMode(h), 'refine', '落地页签高亮 = AI 分析');
  assert.match(drawerHtml(h), /refine-create/, '主体为 AI 分析面板（refine-create 启动区）');
  assert.ok(!drawerHtml(h).includes('dev-start'), '不得残留 AI 开发面板启动区');
  assert.equal(h.state.refine.sig, sigBefore, '数据稳态：签名未变（剪枝命中，正确呈现来自进入渲染而非数据变化）');
});

// R2 反向：面板先停留 AI 分析，已计划档点「▶ AI 开发」，数据稳态下精准落到 AI 开发子面板
t('R2 数据稳态点「▶ AI 开发」（反向）：抽屉残留 AI 分析面板时落地即 AI 开发页签高亮 + dev-start 启动区、无 refine-create 残留；batchSig 未变', async () => {
  const h = setup();
  await h.run('gotoRuns("develop")'); // 开发面板先渲染过一次（batchSig 已落 → 后续剪枝可命中）
  await h.run('setView("status")');
  await h.run('gotoRuns("refine")'); // 再渲染 AI 分析面板（首次，正常），当前抽屉 = AI 分析
  await h.run('setView("status")'); // 离开 → 抽屉残留 AI 分析面板
  const sigBefore = h.state.batchSig;
  assert.ok(sigBefore, '前置：开发面板本会话已渲染过（签名已落）');
  assert.equal(activeMode(h), 'refine', '前置：抽屉残留 AI 分析面板');
  h.state.reqFilter = 'planned';
  await h.document.querySelector('#laneQuickEntry').fire('click').result;
  assert.equal(h.state.view, 'runs', '进入任务模块');
  assert.equal(h.state.batch.mode, 'develop', 'mode 指向 AI 开发');
  assert.equal(activeMode(h), 'develop', '落地页签高亮 = AI 开发');
  assert.match(drawerHtml(h), /dev-start/, '主体为 AI 开发面板（dev-start 启动区）');
  assert.ok(!drawerHtml(h).includes('refine-create'), '不得残留 AI 分析面板启动区');
  assert.equal(h.state.batchSig, sigBefore, '数据稳态：开发面板签名未变');
});

// R3 无缓存数据：进入瞬间先渲染目标面板加载态（「加载中…」+ 目标页签高亮），数据到位后照常渲染
t('R3 无缓存数据先渲染目标面板加载态：refine 缓存已清（模拟项目切换重置）且抽屉残留开发面板 → 点击落地瞬间为 AI 分析页签高亮 + 加载中…；拉取完成后正常呈现 refine-create', async () => {
  const h = setup();
  await h.run('gotoRuns("develop")'); // 抽屉渲染过 AI 开发面板
  await h.run('setView("status")');
  h.state.refine.data = null; // 清空 AI 分析面板缓存（首进 / 项目切换后的典型态）
  h.state.refine.sig = '';
  let release; const gate = new Promise((res) => { release = res; });
  const realFetch = h.sandbox.fetch;
  h.sandbox.fetch = async (url, opts) => { // 首个 refine/current 拉取挂起，观察进入瞬间
    if (String(url).includes('/api/refine/current')) { await gate; }
    return realFetch(url, opts);
  };
  h.state.reqFilter = 'accepted';
  const click = h.document.querySelector('#laneQuickEntry').fire('click');
  assert.equal(activeMode(h), 'refine', '落地瞬间页签高亮即 AI 分析（不等数据）');
  assert.match(drawerHtml(h), /加载中…/, '无缓存数据时先渲染目标面板加载态');
  release();
  await click.result;
  assert.equal(activeMode(h), 'refine', '数据到位后仍为 AI 分析页签高亮');
  assert.match(drawerHtml(h), /refine-create/, '数据到位后正常渲染 AI 分析面板');
});

// R4 口径不回退：纯导航（无创建/启动请求、无确认弹窗）；完善徽标 / 全局总览共用 gotoRuns('refine')
// 链路在数据稳态下同样精准落地
t('R4 导航口径与共用链路不回退：点击无 /api/batch/create、/api/refine/start、无确认弹窗；gotoRuns("refine")（完善徽标同链路）数据稳态下同样精准落地', async () => {
  const h = setup();
  await renderBothPanels(h);
  h.state.reqFilter = 'accepted';
  await h.document.querySelector('#laneQuickEntry').fire('click').result;
  assert.equal(activeMode(h), 'refine', '快捷入口落地正确');
  const urls = h.requests.map((r) => r.url);
  assert.ok(!urls.some((u) => u.includes('/api/batch/create')), '不得创建批量开发任务');
  assert.ok(!urls.some((u) => u.includes('/api/refine/start')), '不得启动完善任务');
  assert.equal(h.confirmations.length, 0, '纯导航不弹确认框');
  // 共用 gotoRuns（完善徽标 / 全局总览跳转）：先停回开发面板制造残留，再经 gotoRuns('refine') 进入
  await h.run('setView("status")');
  const devSig = h.state.batchSig;
  await h.run('gotoRuns("develop")');
  assert.equal(activeMode(h), 'develop');
  await h.run('setView("status")');
  await h.run('gotoRuns("refine")');
  assert.equal(activeMode(h), 'refine', '共用 gotoRuns 链路同样精准落地 AI 分析子面板');
  assert.equal(h.state.batchSig, devSig, '开发面板数据保持稳态');
});

// R5 既有机制不回退（静态契约）：轮询签名剪枝保留（不打断面板内输入）；手动页签切换仍无条件重渲染
t('R5 既有机制不回退：refreshRefine/refreshBatch 签名剪枝保留；bindBatchDrawer 手动页签切换仍无条件 renderBatchDrawer + refreshBatch', () => {
  assert.match(source, /if \(sig === state\.refine\.sig\) return;/, 'refine 轮询剪枝保留');
  assert.match(source, /if \(sig === state\.batchSig\) return;/, 'develop 轮询剪枝保留');
  const bind = source.match(/function bindBatchDrawer\(\)[\s\S]{0,900}/);
  assert.ok(bind, '应存在 bindBatchDrawer');
  assert.match(bind[0], /state\.batch\.mode = b\.dataset\.bmode;/, '页签点击切换 mode');
  assert.match(bind[0], /renderBatchDrawer\(\);\s*\n\s*refreshBatch\(\);/, '手动切换仍无条件重渲染并即时拉取');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
