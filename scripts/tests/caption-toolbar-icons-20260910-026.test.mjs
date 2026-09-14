#!/usr/bin/env node
// REQ-20260910-026 全选 / 全不选图标化 + 批量动作组与「开始完善 / 开始开发」恒定同行 —— 静态契约与行为测试
// （沿用 caption-toolbar-20260910-008.test.mjs 的 vm 模拟 DOM 模式）
// 覆盖 test-cases.md 用例 T1-T5：
//   T1 全选 / 全不选图标化静态契约（仅图标无文字、aria-label 与 title 语义保留、无文字回写代码路径；
//      BUG-20260910-019 起图标由 ☑ / ☐ 字形改为内联 SVG，本用例按「仅图标」口径同步）
//   T2 图标按钮等宽尺寸（.req-caption .btn.icon-act 定宽等高，沿用 BUG-20260910-007 图标口径）
//   T3 同一行绑定静态契约（#captionActions 包住 #selGroup + #laneQuickEntry；nowrap 恒不拆散、整组靠右；
//      .req-caption 仍 wrap 整组换行兜底；.sel-group 仍 wrap 不靠右）
//   T4 行为语义零变化（按档显隐、全选叠搜索、全不选仅当前档、禁用口径、计数与批量组显隐、快捷入口按档）
//   T5 ui-demo.html 离线自包含（调整前 / 调整后对照、图标与同行容器演示）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
const demoPath = path.join(pluginRoot, 'docs', 'agent-team-board', 'requirements', 'REQ-20260910-026', 'ui-demo.html');
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

// 工具栏区段（#reqCaption 起至结果区前）
const captionHead = () => htmlSrc.match(/<div id="reqCaption"[\s\S]*?<div id="acceptResult"/)?.[0] || '';

// T1 全选 / 全不选图标化：仅图标（无中文文字），aria-label 与 title 语义完整保留，
// 两按钮 class 一致（等宽样式同源）；app.js 无任何向两按钮写回文字的代码路径（图标不被文案覆盖）。
// BUG-20260910-019：图标载体由 ☑ / ☐ 投票框字形改为自绘内联 SVG（带勾方框 / 空方框），
// 本用例断言「仅图标、无文字」口径不变；SVG 形态细节由 bug-select-icon-svg-20260910-019 守护
t('T1 图标化契约：#selectOperable / #selectNone 内容仅图标（内联 SVG，无中文文字、无 ☑ / ☐ 字形）；aria-label="全选"/"全不选" 与 title 口径保留；type=button；两按钮 class 一致；app.js 不向两按钮写 textContent', () => {
  const head = captionHead();
  assert.ok(head, '应存在列表头 #reqCaption');
  const selBtn = head.match(/<button[^>]*id="selectOperable"[\s\S]*?<\/button>/);
  const noneBtn = head.match(/<button[^>]*id="selectNone"[\s\S]*?<\/button>/);
  assert.ok(selBtn, '应存在全选按钮 #selectOperable');
  assert.ok(noneBtn, '应存在全不选按钮 #selectNone');
  // 仅图标：内容为内联 SVG 图标，不含中文文字（BUG-20260910-019 起不再用 ☑ / ☐ 字形）
  const inner = (m) => m[0].replace(/^<button[^>]*>/, '').replace(/<\/button>$/, '');
  assert.match(inner(selBtn), /^\s*<svg\b[\s\S]*<\/svg>\s*$/, '全选按钮内容应仅为内联 SVG 图标（去掉「全选」文字）');
  assert.match(inner(noneBtn), /^\s*<svg\b[\s\S]*<\/svg>\s*$/, '全不选按钮内容应仅为内联 SVG 图标（去掉「全不选」文字）');
  assert.doesNotMatch(inner(selBtn), /[\u4e00-\u9fff]/, '全选按钮不得残留中文文字');
  assert.doesNotMatch(inner(noneBtn), /[\u4e00-\u9fff]/, '全不选按钮不得残留中文文字');
  // 可访问语义：aria-label 与 title 悬浮提示保留完整口径
  assert.match(selBtn[0], /aria-label="全选"/, '全选应保留 aria-label（屏幕阅读器念出「全选」）');
  assert.match(noneBtn[0], /aria-label="全不选"/, '全不选应保留 aria-label');
  assert.match(selBtn[0], /title="全选：仅勾选当前筛选档内可见的可操作条目[^"]*叠搜索范围[^"]*"/, '全选 title 口径不变（当前档 + 叠搜索）');
  assert.match(noneBtn[0], /title="全不选：仅取消当前筛选档的勾选"/, '全不选 title 口径不变（仅当前档）');
  // 键盘可达与等宽同源：type=button、两按钮 class 一致（尺寸规则同一条）
  assert.match(selBtn[0], /type="button"/, '全选为原生 button（键盘可达）');
  assert.match(noneBtn[0], /type="button"/, '全不选为原生 button');
  assert.match(noneBtn[0], /\bdisabled\b/, '全不选初始禁用（零勾选）沿用现状');
  const cls = (m) => m[0].match(/class="([^"]*)"/)[1];
  assert.equal(cls(selBtn), cls(noneBtn), '两图标按钮 class 应一致（等宽等高、基线对齐同一条规则）');
  // 图标不被文案覆盖：app.js 不得向两按钮写 textContent（syncAcceptance 仅切显隐与禁用态）
  assert.doesNotMatch(source, /\$\('#selectOperable'\)[^;\n]*\.textContent\s*=/, '不得向全选按钮写回文字');
  assert.doesNotMatch(source, /\$\('#selectNone'\)[^;\n]*\.textContent\s*=/, '不得向全不选按钮写回文字');
});

// T2 图标按钮等宽尺寸：沿用 BUG-20260910-007 的 .btn.icon-act 图标口径，在 .req-caption 作用域内
// 定宽等高（两按钮尺寸一致、与工具栏基线垂直居中），文字按钮尺寸不受影响
t('T2 图标按钮尺寸：.req-caption .btn.icon-act 规则存在，min-width / min-height 定宽等高 + text-align:center', () => {
  const rule = cssSrc.match(/\.req-caption \.btn\.icon-act\s*\{[^}]*\}/);
  assert.ok(rule, '应为工具栏图标按钮定义 .req-caption .btn.icon-act 尺寸规则');
  assert.match(rule[0], /min-width:\s*\d+px/, '图标按钮应定宽（两按钮等宽、图标切换不改变行宽）');
  assert.match(rule[0], /min-height:\s*\d+px/, '图标按钮应定高（与工具栏基线垂直居中）');
  assert.match(rule[0], /text-align:\s*center/, '图标字形居中呈现');
});

// T3 同一行绑定：#captionActions 承载 #selGroup + #laneQuickEntry（批量动作组与快捷入口恒同一行、
// 不拆散到两行）；空间足够时整组靠右；.req-caption 仍 wrap 承接整组换行兜底；.sel-group 不抢靠右位
t('T3 同行绑定契约：#selGroup 与 #laneQuickEntry 同处 #captionActions 且顺序 批量组 → 快捷入口；容器 flex-wrap:nowrap（恒不拆散）+ margin-left:auto（整组靠右）+ flex:none；.sel-group 仍 wrap 且无 margin-left:auto；.req-caption 仍 wrap 非 column', () => {
  const head = captionHead();
  const wrapAt = head.indexOf('id="captionActions"');
  assert.ok(wrapAt >= 0, '应存在同行容器 #captionActions');
  const grpAt = head.indexOf('id="selGroup"');
  const quickAt = head.indexOf('id="laneQuickEntry"');
  assert.ok(grpAt > wrapAt, '#selGroup 应在 #captionActions 容器内');
  assert.ok(quickAt > grpAt, '#laneQuickEntry 应在容器内且位于批量组之后（同一行内 批量动作 → 快捷入口）');
  // 容器在批量组之前没有兄弟控件插入（reqCount / 两图标按钮保持在容器之外，工具栏左起口径不变）
  assert.ok(head.indexOf('id="selectOperable"') < wrapAt && head.indexOf('id="selectNone"') < wrapAt, '全选 / 全不选应在同行容器之外（左起口径不变）');
  // 容器 CSS：nowrap 恒不拆散 + 整组靠右 + 不被压缩
  const wrapRule = cssSrc.match(/\.caption-actions\s*\{[^}]*\}/);
  assert.ok(wrapRule, '应有 .caption-actions 容器规则');
  assert.match(wrapRule[0], /display:\s*flex/, '同行容器为 flex 行');
  assert.match(wrapRule[0], /flex-wrap:\s*nowrap/, '批量动作组与快捷入口恒定同一行（宽度不足也不拆散到两行）');
  assert.match(wrapRule[0], /margin-left:\s*auto/, '空间足够时整组靠右');
  assert.match(wrapRule[0], /flex:\s*none/, '同行容器不被压缩拆散');
  // 兜底与既有口径：外层 .req-caption 仍 wrap（整组换行兜底、不横向滚动不裁切），.sel-group 仍 wrap 且不抢靠右位
  const capRule = cssSrc.match(/\.req-caption\s*\{[^}]*\}/);
  assert.ok(capRule, '应有 .req-caption 规则');
  assert.match(capRule[0], /flex-wrap:\s*wrap/, '外层保留 wrap：宽度不足时同行容器整组换行兜底');
  assert.doesNotMatch(capRule[0], /flex-direction:\s*column/, '不得纵向固定多行');
  const grpRule = cssSrc.match(/\.sel-group\s*\{[^}]*\}/);
  assert.ok(grpRule, '应有 .sel-group 规则');
  assert.match(grpRule[0], /flex-wrap:\s*wrap/, '.sel-group 组内按钮必要时继续换行（组内压缩兜底）');
  assert.doesNotMatch(grpRule[0], /margin-left:\s*auto/, '.sel-group 不得自带靠右（靠右由同行容器整组承载）');
});

// T4 行为语义零变化：图标化与同行调整只改呈现——按档显隐、全选叠搜索、全不选仅当前档、
// 禁用口径、计数与批量组显隐、快捷入口按档文案与「批量进行中不禁用」全部沿用
t('T4 行为零变化：三选择档两图标按钮可见、非选择档隐藏；全选仅勾当前档∩搜索命中；全不选仅清当前档；零勾选禁全不选、无可操作项禁全选、批量进行中均禁用；勾选首项 #selGroup 出现、清零隐藏；快捷入口按档显隐文案且批量进行中不禁用', () => {
  const h = setup();
  h.run('syncPlan(false); syncImpl(false);');
  // 待接受档：两图标按钮可见；零勾选禁全不选、有候选可用全选
  h.run("state.reqFilter = 'submitted'");
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selectOperable'), false, '待接受档全选图标可见');
  assert.equal(hidden(h, '#selectNone'), false, '待接受档全不选图标可见');
  assert.equal(h.document.querySelector('#selectNone').disabled, true, '零勾选禁用全不选');
  assert.equal(h.document.querySelector('#selectOperable').disabled, false, '有可操作条目全选可用');
  assert.equal(hidden(h, '#selGroup'), true, '零勾选批量动作组隐藏');
  // 全选叠搜索：命中只含 003，勾选结果不含 004（所见即所选）
  h.run('state.search.q = "REQ-20990101-00"; state.search.res = { items: [{ id: "REQ-20990101-003" }] };');
  h.run('selectOperable()');
  assert.ok(h.state.acceptance.selected.has('REQ-20990101-003'), '命中条目应被勾选');
  assert.ok(!h.state.acceptance.selected.has('REQ-20990101-004'), '搜索未命中条目不得被勾选');
  assert.equal(hidden(h, '#selGroup'), false, '勾选首项批量动作组出现（同行容器内）');
  assert.match(h.document.querySelector('#selCount').textContent, /^已选 1 项$/, '已选数量即时同步');
  // 全不选仅清当前档：其他档勾选保留（BUG-20260907-016 契约）
  h.run('state.search.q = ""; state.search.res = null;');
  h.state.plan.selected.add('REQ-20990101-001');
  h.run('deselectOperable()');
  assert.equal(h.state.acceptance.selected.size, 0, '全不选清当前档勾选');
  assert.ok(h.state.plan.selected.has('REQ-20990101-001'), '其他档勾选保留');
  assert.equal(hidden(h, '#selGroup'), true, '清零后批量动作组隐藏');
  // 搜索无命中：无可操作条目禁用全选；空档禁用全不选
  h.run('state.search.q = "NOHIT"; state.search.res = { items: [] };');
  h.run('syncAcceptance()');
  assert.equal(h.document.querySelector('#selectOperable').disabled, true, '搜索无命中禁用全选（无可操作项）');
  h.run('state.search.q = ""; state.search.res = null;');
  // 批量进行中：全选 / 全不选防误触禁用；快捷入口仅导航不禁用
  h.run("state.reqFilter = 'accepted'");
  h.state.plan.selected.add('REQ-20990101-001');
  h.state.plan.pending = true;
  h.run('syncAcceptance()');
  assert.equal(h.document.querySelector('#selectOperable').disabled, true, '批量进行中禁用全选');
  assert.equal(h.document.querySelector('#selectNone').disabled, true, '批量进行中禁用全不选');
  assert.equal(hidden(h, '#laneQuickEntry'), false, '已接受档快捷入口仍可见');
  assert.equal(h.document.querySelector('#laneQuickEntry').disabled, false, '快捷入口仅导航，批量进行中不禁用');
  assert.equal(h.document.querySelector('#laneQuickEntry').textContent, '▶ 开始 AI 分析', '已接受档快捷入口文案（REQ-20260913-005 改名）');
  h.state.plan.pending = false;
  // 非选择档：两图标按钮与批量动作组整体隐藏（无空占位）；快捷入口仅已接受 / 已计划 / 已完成可见
  for (const lane of ['developing', 'confirming']) {
    h.run(`state.reqFilter = '${lane}'`);
    h.run('syncAcceptance()');
    assert.equal(hidden(h, '#selectOperable'), true, `${lane} 档全选图标应隐藏`);
    assert.equal(hidden(h, '#selectNone'), true, `${lane} 档全不选图标应隐藏`);
    assert.equal(hidden(h, '#selGroup'), true, `${lane} 档批量动作组应隐藏`);
    assert.equal(hidden(h, '#laneQuickEntry'), true, `${lane} 档快捷入口应隐藏`);
  }
  // 已完成档（REQ-20260911-010）：选择控件与批量动作组仍隐藏，快捷入口随批量 Commit 回退一并隐藏
  h.run("state.reqFilter = 'done'");
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selectOperable'), true, 'done 档全选图标应隐藏');
  assert.equal(hidden(h, '#selectNone'), true, 'done 档全不选图标应隐藏');
  assert.equal(hidden(h, '#selGroup'), true, 'done 档批量动作组应隐藏');
  assert.equal(hidden(h, '#laneQuickEntry'), true, 'done 档快捷入口应隐藏（已随批量 Commit 回退）');
  // 已计划档：全选 / 全不选可见，快捷入口换文案「▶ 开始开发」
  h.run("state.reqFilter = 'planned'");
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selectOperable'), false, '已计划档全选图标可见');
  assert.equal(hidden(h, '#selectNone'), false, '已计划档全不选图标可见');
  assert.equal(h.document.querySelector('#laneQuickEntry').textContent, '▶ 开始 AI 开发', '已计划档快捷入口文案（镜像入口同口径，REQ-20260913-005 改名）');
});

// T5 ui-demo.html：离线自包含（无外链脚本 / 样式 / 资源），承载调整前 / 调整后对照与图标 + 同行演示
t('T5 ui-demo 离线自包含：条目目录存在 ui-demo.html；无外链 script/link/@import/网络 url；含调整前 / 调整后对照、☑ / ☐ 图标（aria-label 保留）与同行容器（nowrap）演示', () => {
  assert.ok(fs.existsSync(demoPath), '条目目录应存在 ui-demo.html（README 演示链接可打开）');
  const demo = fs.readFileSync(demoPath, 'utf8');
  assert.doesNotMatch(demo, /<script[^>]*\ssrc=/i, '不得外链脚本');
  assert.doesNotMatch(demo, /<link[^>]*href=/i, '不得外链样式/资源');
  assert.doesNotMatch(demo, /@import/i, '不得 @import 外部样式');
  assert.doesNotMatch(demo, /url\(\s*['"]?https?:/i, '不得引用网络图片/字体');
  for (const word of ['调整前', '调整后', '☑', '☐', 'aria-label="全选"', 'aria-label="全不选"', '开始完善', '开始开发', 'nowrap']) {
    assert.ok(demo.includes(word), `演示应包含「${word}」`);
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
