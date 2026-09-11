#!/usr/bin/env node
// BUG-20260910-019 全选 / 全不选图标标准化——自绘内联 SVG（带勾方框 / 空方框）替换 ☑ / ☐ 投票框字形
// —— 静态契约 + 轻量行为测试（引入来源：REQ-20260910-026 以字形先行落地图标化，字形渲染随字体回退漂移）
// 覆盖用例：
//   T1 图标替换：两按钮内容为内联 SVG（全选=带勾方框、全不选=空方框），页面不再使用 U+2610/U+2611 字形
//   T2 SVG 口径：viewBox 16×16、13×13 尺寸、fill=none、stroke=currentColor（随主题）、等线宽描边、
//      aria-hidden（读屏由按钮 aria-label 承载）；勾形 polyline 仅全选独有
//   T3 语义契约零变化：type=button、aria-label / title 口径、初始禁用、两按钮 class 一致、
//      app.js 不向两按钮写回内容（图标不被文案覆盖）
//   T4 视觉契约：基础盒口径 .req-caption .btn.icon-act 保持 26×24 定宽等高 + 13px + 居中（追加 flex 居中
//      承载 SVG）；BUG-20260910-017 的 icon-check 降字号修补规则与修饰类随 SVG 方案移除；
//      行内 .req-row .row-acts .btn.icon-act 仍 13px 不受影响
//   T5 行为零回归（vm 模拟 DOM）：三选择档两按钮可见、非选择档整体隐藏、零勾选禁全不选、
//      批量进行中防误触禁用（完整行为口径由 caption-toolbar-icons-20260910-026 T4 继续守护）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 工具栏区段（#reqCaption 起至结果区前）
const captionHead = () => htmlSrc.match(/<div id="reqCaption"[\s\S]*?<div id="acceptResult"/)?.[0] || '';
// 按钮整段（含内联 SVG 子元素）
const btnHtml = (head, id) => head.match(new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?</button>`));

t('T1 图标替换：#selectOperable / #selectNone 内容均为内联 <svg>（无中文文字、无 ☑ / ☐ 投票框字形）；index.html 全文不再出现 U+2610 / U+2611 字形', () => {
  const head = captionHead();
  assert.ok(head, '应存在列表头 #reqCaption');
  const selBtn = btnHtml(head, 'selectOperable');
  const noneBtn = btnHtml(head, 'selectNone');
  assert.ok(selBtn, '应存在全选按钮 #selectOperable');
  assert.ok(noneBtn, '应存在全不选按钮 #selectNone');
  assert.match(selBtn[0], /<svg\b/, '全选按钮内容应为内联 SVG 图标（替换 ☑ 字形）');
  assert.match(noneBtn[0], /<svg\b/, '全不选按钮内容应为内联 SVG 图标（替换 ☐ 字形）');
  for (const [name, btn] of [['全选', selBtn], ['全不选', noneBtn]]) {
    assert.doesNotMatch(btn[0], /☑|☐/, `${name}按钮不得残留投票框字形`);
    assert.doesNotMatch(btn[0].replace(/^<button[^>]*>/, ''), /[\u4e00-\u9fff]/, `${name}按钮内容不得残留中文文字`);
  }
  // 整页不再以投票框字形充当图标（形态不随系统字体回退漂移）
  assert.doesNotMatch(htmlSrc, /[\u2610\u2611]/, 'index.html 全文不得出现 ☑(U+2611) / ☐(U+2610) 字形');
});

t('T2 SVG 口径：viewBox="0 0 16 16" + width/height=13（对齐行内 13px 字形图标视觉重量）+ fill="none" + stroke="currentColor"（随深浅主题与 hover 变色）+ stroke-width 等线宽 + aria-hidden；勾形 <polyline> 仅全选独有，全不选仅空方框 <rect>', () => {
  const head = captionHead();
  const selBtn = btnHtml(head, 'selectOperable');
  const noneBtn = btnHtml(head, 'selectNone');
  const svgOf = (btn) => btn[0].match(/<svg\b[^>]*>/)?.[0] || '';
  for (const [name, btn] of [['全选', selBtn], ['全不选', noneBtn]]) {
    const svg = svgOf(btn);
    assert.match(svg, /viewBox="0 0 16 16"/, `${name}图标应有 16×16 viewBox`);
    assert.match(svg, /width="13"/, `${name}图标应为 13px 宽（对齐 13px 字形图标视觉重量）`);
    assert.match(svg, /height="13"/, `${name}图标应为 13px 高`);
    assert.match(svg, /fill="none"/, `${name}图标应为描边形态（非填充）`);
    assert.match(svg, /stroke="currentColor"/, `${name}图标描边应继承按钮颜色（深浅色主题自适应）`);
    assert.match(svg, /stroke-width="1\.6"/, `${name}图标应等线宽描边（1.6/16 ≈ 1.3px 实际笔画）`);
    assert.match(svg, /aria-hidden="true"/, `${name}图标应 aria-hidden（读屏念按钮 aria-label，不重复念图）`);
    // 标准复选框语汇：空方框（圆角矩形）
    assert.match(btn[0], /<rect\b[^>]*rx="2\.5"/, `${name}图标应含圆角方框 rect（空方框语汇）`);
  }
  // 全选独有勾形；全不选不得带勾
  assert.match(selBtn[0], /<polyline\b[^>]*points=/, '全选图标应含勾形 polyline（带勾方框语汇）');
  assert.doesNotMatch(noneBtn[0], /<polyline\b/, '全不选图标不得含勾形（空方框语汇）');
});

t('T3 语义契约零变化：type=button；aria-label="全选"/"全不选" 与 title 口径保留；全不选初始禁用；两按钮 class 一致；app.js 不向两按钮写 textContent / innerHTML', () => {
  const head = captionHead();
  const selBtn = btnHtml(head, 'selectOperable');
  const noneBtn = btnHtml(head, 'selectNone');
  assert.match(selBtn[0], /type="button"/, '全选为原生 button（键盘可达）');
  assert.match(noneBtn[0], /type="button"/, '全不选为原生 button');
  assert.match(selBtn[0], /aria-label="全选"/, '全选应保留 aria-label（屏幕阅读器念出「全选」）');
  assert.match(noneBtn[0], /aria-label="全不选"/, '全不选应保留 aria-label');
  assert.match(selBtn[0], /title="全选：仅勾选当前筛选档内可见的可操作条目[^"]*叠搜索范围[^"]*"/, '全选 title 口径不变（当前档 + 叠搜索）');
  assert.match(noneBtn[0], /title="全不选：仅取消当前筛选档的勾选"/, '全不选 title 口径不变（仅当前档）');
  assert.match(noneBtn[0], /\bdisabled\b/, '全不选初始禁用（零勾选）沿用现状');
  const cls = (m) => m[0].match(/class="([^"]*)"/)[1];
  assert.equal(cls(selBtn), cls(noneBtn), '两图标按钮 class 应一致（盒规格同一条规则）');
  assert.match(cls(selBtn), /\bicon-act\b/, 'class 应保留 icon-act（沿用 BUG-20260910-007 图标盒口径）');
  assert.doesNotMatch(cls(selBtn), /\bicon-check\b/, '字形时代降字号修饰类 icon-check 应随 SVG 方案移除');
  // 图标不被文案覆盖：app.js 不得向两按钮写内容（syncAcceptance 仅切显隐与禁用态）
  assert.doesNotMatch(source, /\$\('#selectOperable'\)[^;\n]*\.(textContent|innerHTML)\s*=/, '不得向全选按钮写回内容');
  assert.doesNotMatch(source, /\$\('#selectNone'\)[^;\n]*\.(textContent|innerHTML)\s*=/, '不得向全不选按钮写回内容');
  // app.js 不再以投票框字形指代两按钮（注释表述同步）
  assert.doesNotMatch(source, /[☑☐]/, 'app.js 不得残留 ☑ / ☐ 字形表述');
});

t('T4 视觉契约：.req-caption .btn.icon-act 基础口径保持 26×24 定宽等高 + 13px 基准 + 居中，并含 flex 居中（承载 SVG 在盒内水平垂直居中）；icon-check 降字号修补规则已移除（不残留 <13px 字形字号）；行内 .req-row .row-acts .btn.icon-act 仍 13px', () => {
  const baseRule = cssSrc.match(/\.req-caption \.btn\.icon-act\s*\{/);
  assert.ok(baseRule, '基础规则 .req-caption .btn.icon-act 应保留');
  const rule = cssSrc.match(/\.req-caption \.btn\.icon-act\s*\{[^}]*\}/)?.[0] || '';
  assert.match(rule, /min-width:\s*26px/, '基础口径 min-width:26px 不变');
  assert.match(rule, /min-height:\s*24px/, '基础口径 min-height:24px 不变');
  assert.match(rule, /font-size:\s*13px/, '基础口径基准字号 13px 不变');
  assert.match(rule, /text-align:\s*center/, '基础口径居中不变');
  assert.match(rule, /display:\s*inline-flex/, '应 flex 化承载 SVG 居中');
  assert.match(rule, /align-items:\s*center/, 'SVG 垂直居中');
  assert.match(rule, /justify-content:\s*center/, 'SVG 水平居中');
  // BUG-20260910-017 修补规则随字形移除：不再有 icon-check 作用域降字号（全文件无该选择器）
  assert.doesNotMatch(cssSrc, /\.icon-check\b/, 'icon-check 降字号修补规则应移除（SVG 尺寸即视觉口径）');
  // 行内操作图标口径不受影响
  const rowRule = cssSrc.match(/\.req-row \.row-acts \.btn\.icon-act\s*\{[^}]*\}/);
  assert.ok(rowRule, '行内操作图标规则应保留');
  assert.match(rowRule[0], /font-size:\s*13px/, '卡片操作图标字号不受影响（仍 13px）');
  assert.match(rowRule[0], /min-width:\s*26px/, '卡片操作图标盒口径不变（min-width:26px）');
});

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
  const requests = [], confirmations = [], notices = [];
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }) },
    fetch: async (url, opts) => { requests.push({ url: String(url), opts }); return { ok: true, json: async () => ({}) }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  state.board = { initialized: true, items: sample() };
  sandbox.recordNotice = (message, error) => notices.push({ message, error });
  sandbox.recordConfirm = (text) => confirmations.push(text);
  run('uiConfirm = (o) => { recordConfirm(`${o.title}\\n${o.message || ""}`); return true; };');
  run('toast = recordNotice; poll = async () => {}; refreshDrawer = async () => {}; updateBoardTabs = () => {}; markActiveTab = () => {}; refreshHealth = async () => {};');
  return { sandbox, document, state, run, requests, confirmations, notices };
}

const hidden = (h, sel) => h.document.querySelector(sel).classList.contains('hidden');

t('T5 行为零回归（图标替换不触碰逻辑）：待接受档两按钮可见、零勾选禁全不选；批量进行中两按钮防误触禁用；非选择档两按钮整体隐藏（无空占位）', () => {
  const h = setup();
  h.run('syncPlan(false); syncImpl(false);');
  h.run("state.reqFilter = 'submitted'");
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selectOperable'), false, '待接受档全选图标可见');
  assert.equal(hidden(h, '#selectNone'), false, '待接受档全不选图标可见');
  assert.equal(h.document.querySelector('#selectNone').disabled, true, '零勾选禁用全不选');
  assert.equal(h.document.querySelector('#selectOperable').disabled, false, '有可操作条目全选可用');
  // 批量进行中防误触（图标化按钮 disabled 口径不回退）
  h.state.acceptance.selected.add('REQ-20990101-003');
  h.state.acceptance.pending = true;
  h.run('syncAcceptance()');
  assert.equal(h.document.querySelector('#selectOperable').disabled, true, '批量进行中禁用全选');
  assert.equal(h.document.querySelector('#selectNone').disabled, true, '批量进行中禁用全不选');
  h.state.acceptance.pending = false;
  // 非选择档整体隐藏（BUG-20260909-008 契约）
  for (const lane of ['developing', 'confirming', 'done']) {
    h.run(`state.reqFilter = '${lane}'`);
    h.run('syncAcceptance()');
    assert.equal(hidden(h, '#selectOperable'), true, `${lane} 档全选图标应隐藏`);
    assert.equal(hidden(h, '#selectNone'), true, `${lane} 档全不选图标应隐藏`);
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
