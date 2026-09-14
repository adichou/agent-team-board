#!/usr/bin/env node
// REQ-20260910-008 选择区域布局优化 —— 单行工具栏 + 去重复计数（行为与静态契约测试）
// （沿用 caption-two-row-20260909-009.test.mjs 的 vm 模拟 DOM 模式）
// 覆盖 test-cases.md 用例 L1-L6：
//   L1 静态单行工具栏结构（排序→全选→全不选→右组→快捷入口；无两行结构；无静态「N 个条目」）
//   L2 CSS 契约（单行 wrap、非 column、快捷入口靠右、右组连续可换行、分类标签可换行）
//   L3 计数提示语义（普通档隐藏；已完成截断保留总量与搜索引导；搜索命中明确标注、结果未到不显示）
//   L4 按档显隐与零跳变（三选择档、三不可选择档、快捷入口按档）
//   L5 交互语义不回退（全选叠搜索、全不选仅当前档、进行中禁用、排序契约不动）
//   L6 ui-demo.html 离线自包含（无外链依赖、覆盖六档与四态）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
const demoPath = path.join(pluginRoot, 'docs', 'agent-team-board', 'requirements', 'REQ-20260910-008', 'ui-demo.html');
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

// L1 静态单行工具栏：#reqCaption 单容器承载全部控件，两行结构（#selectRow/.caption-info/.caption-select）根除；
// 普通「N 个条目」不再静态出现——#reqCount 保留为条件提示节点且初始 hidden
// REQ-20260910-016：排序菜单迁至第三行 #pageHead 定位组（搜索框左侧），工具栏不再含排序入口与占位
t('L1 静态结构：#reqCaption 单容器内左起 #reqCount → #selectOperable → #selectNone → #selGroup → #laneQuickEntry；#reqSort 已迁至 #pageHead 定位组（无排序入口与占位残留）；#reqCount 为条件提示（初始 hidden、无静态计数文案）；无 #selectRow / .caption-info / .caption-select / .caption-divider', () => {
  const caption = htmlSrc.match(/<div id="reqCaption"[\s\S]*?<div id="acceptResult"/);
  assert.ok(caption, '应存在列表头 #reqCaption（含至结果区前）');
  const head = caption[0];
  for (const id of ['reqCount', 'selectOperable', 'selectNone', 'selGroup', 'laneQuickEntry']) {
    assert.ok(head.includes(`id="${id}"`), `工具栏应包含 #${id}`);
  }
  const order = ['reqCount', 'selectOperable', 'selectNone', 'selGroup', 'laneQuickEntry'].map((id) => head.indexOf(`id="${id}"`));
  assert.ok(order.every((i) => i !== -1), '工具栏应包含全部控件');
  assert.ok(order[0] < order[1] && order[1] < order[2] && order[2] < order[3] && order[3] < order[4],
    '工具栏顺序应为 提示 → 全选 → 全不选 → 右组 → 快捷入口');
  // REQ-20260910-016：排序入口迁至搜索框左侧定位组，工具栏无排序、无占位空洞
  assert.ok(!head.includes('id="reqSort"'), '工具栏不得再含 #reqSort（已迁至 #pageHead 定位组）');
  assert.doesNotMatch(head, /sort-placeholder|排序占位/, '不得遗留排序占位');
  // 两行结构根除（REQ-20260910-008 取消固定的第二行选择区）
  assert.doesNotMatch(htmlSrc, /id="selectRow"/, '不得再有 #selectRow 第二行容器');
  assert.doesNotMatch(htmlSrc, /caption-info|caption-select|caption-row/, '不得再有 .caption-info/.caption-select/.caption-row 行结构');
  assert.doesNotMatch(cssSrc, /\.caption-divider\s*\{/, '不得残留 .caption-divider 规则');
  assert.doesNotMatch(cssSrc, /\.caption-row\s*\{/, 'style.css 应删除 .caption-row 规则');
  // #reqCount 转条件提示：初始 hidden 且无静态计数文案
  const count = head.match(/<span id="reqCount"[^>]*>/);
  assert.ok(count, '#reqCount 节点保留（承载截断/搜索提示）');
  assert.match(count[0], /class="[^"]*\bhidden\b[^"]*"/, '#reqCount 初始应 hidden（普通计数已移除）');
  assert.doesNotMatch(head, /个条目/, '工具栏不得残留静态「N 个条目」文案（分类标签已展示各档数量）');
  // 合并意图与既有口径不回退
  assert.doesNotMatch(htmlSrc, /id="selectionBar"/, '不得回退出独立操作条');
  assert.doesNotMatch(htmlSrc, /clearSelection/, '不得回退出「清空选择」');
  assert.doesNotMatch(source, /clearSelection/, 'app.js 不得回退 clearSelection');
  // 结果区仍在列表头之后（进度/结果不塞入工具栏）
  assert.ok(htmlSrc.indexOf('<div id="acceptResult"') > htmlSrc.indexOf('id="reqCaption"'), '结果区应在列表头之后');
});

// L2 CSS 契约：单行工具栏（wrap 兜底、非纵向 column）；快捷入口空间足够时靠右；
// 右组与全选/全不选连续（无 margin-left:auto）；分类标签条可换行（六档均可到达）
t('L2 CSS 契约：.req-caption 单行 flex + flex-wrap:wrap 且非 column；#laneQuickEntry margin-left:auto（空间足够时靠右）；.sel-group 保留 wrap 且无 margin-left:auto；.filter-bar 可换行', () => {
  const capRule = cssSrc.match(/\.req-caption\s*\{[^}]*\}/);
  assert.ok(capRule, '应有 .req-caption 规则');
  assert.match(capRule[0], /display:\s*flex/, '列表头 flex 单行工具栏');
  assert.match(capRule[0], /flex-wrap:\s*wrap/, '宽度不足按组整体换行（不裁切、不横向滚动）');
  assert.doesNotMatch(capRule[0], /flex-direction:\s*column/, '不得再纵向固定两行（REQ-20260910-008 取消第二行）');
  const quickRule = cssSrc.match(/#laneQuickEntry\s*\{[^}]*\}/);
  assert.ok(quickRule, '应有 #laneQuickEntry 规则');
  assert.match(quickRule[0], /margin-left:\s*auto/, '快捷入口空间足够时靠右');
  const grpRule = cssSrc.match(/\.sel-group\s*\{[^}]*\}/);
  assert.ok(grpRule, '应有 .sel-group 规则');
  assert.match(grpRule[0], /flex-wrap:\s*wrap/, '右组内按钮必要时继续换行');
  assert.doesNotMatch(grpRule[0], /margin-left:\s*auto/, '右组不得 margin-left:auto 靠右（选择区与全选/全不选连续）');
  const barRule = cssSrc.match(/\.filter-bar\s*\{[^}]*\}/);
  assert.ok(barRule, '应有 .filter-bar 规则');
  // REQ-20260910-012：分类标签条迁为内容区左缘纵向栏后，「六档均可到达」由
  // 竖向滚动承接（nowrap 不换列、overflow-y 可滚），不再依赖横向换行
  assert.match(barRule[0], /flex-wrap:\s*nowrap/, '纵向栏单列不换列（不裁切）');
  assert.match(barRule[0], /overflow-y:\s*auto/, '高度不足时竖向滚动（六档均可到达）');
});

// L3 计数提示语义：普通档不展示重复总数；已完成截断保留总量与搜索引导；
// 搜索命中以「搜索命中 N 项」明确承载；结果未到不显示提示（全量不误称命中）
// BUG-20260911-008：截断文案精简（去「个条目」等冗余字词），确保与「▶ 开始 Commit」同行
t('L3 计数提示：普通档 #reqCount 隐藏且无文案；已完成截断档显示「100 / 150 项，仅列最新 100」并含搜索引导且保持精简量级；搜索结果已到显示「搜索命中 N 项」（不含「个条目」）；关键词已输结果未到不显示提示', () => {
  const h = setup();
  h.run("state.reqFilter = 'submitted'");
  h.run('renderBoard()');
  assert.equal(hidden(h, '#reqCount'), true, '普通档（无搜索、无截断）不展示与分类标签重复的计数');
  assert.equal(h.document.querySelector('#reqCount').textContent, '', '普通档提示文案应为空');
  // 已完成档默认截断：保留必要提示（显示范围 / 总量 / 搜索更早条目说明）；
  // BUG-20260911-008：文案精简为「N / M 项，仅列最新 100，更早请搜索」量级，与右组「▶ 开始 Commit」同行
  const doneItems = Array.from({ length: 150 }, (_, i) => item(`REQ-20990101-${String(i + 1).padStart(3, '0')}`, 'done'));
  h.state.board = { initialized: true, items: doneItems };
  h.state.reqFilter = 'done';
  h.state.listSig = '';
  h.run('renderBoard()');
  const capped = h.document.querySelector('#reqCount').textContent;
  assert.equal(hidden(h, '#reqCount'), false, '截断档提示可见');
  assert.match(capped, /^100 \/ 150 项/, '截断提示应展示显示范围与总量');
  assert.match(capped, /仅列最新 100/, '截断提示应说明默认显示范围');
  assert.match(capped, /更早请搜索/, '截断提示应保留搜索更早条目引导');
  // BUG-20260911-008：精简后不得残留「个条目」等冗余字词，且长度保持与「▶ 开始 Commit」同行的量级
  assert.doesNotMatch(capped, /个条目/, '截断提示不得残留「个条目」冗余字词（精简后与开始 Commit 同行）');
  assert.ok(capped.length <= 30, `截断提示应保持精简量级（≤30 字符，实测 ${capped.length}）`);
  // 搜索生效：命中数明确标注为搜索结果，不冒充分类总数
  // REQ-20260910-009：提示改为「搜索命中条目 N 项（当前档可见 M 项）」，且仅当结果属于当前关键词
  // （resQ 与 q 一致）时显示——结果未到或为旧词结果时不显示，避免全量被误称命中
  h.state.board = { initialized: true, items: sample() };
  h.state.reqFilter = 'submitted';
  h.state.listSig = '';
  h.run('state.search.q = "REQ-20990101-00"; state.search.res = { items: [{ id: "REQ-20990101-003" }, { id: "REQ-20990101-004" }] }; state.search.resQ = "REQ-20990101-00";');
  h.run('renderBoard()');
  const hitText = h.document.querySelector('#reqCount').textContent;
  assert.equal(hidden(h, '#reqCount'), false, '搜索命中提示可见');
  assert.match(hitText, /搜索命中条目 2 项/, '搜索命中应以「搜索命中条目 N 项」明确承载');
  assert.doesNotMatch(hitText, /个条目/, '搜索提示不得把命中数写成分类总数口径');
  // 关键词已输、结果未到（防抖/在途）：不显示提示，避免全量被误称命中
  h.run('state.search.res = null;');
  h.state.listSig = '';
  h.run('renderBoard()');
  assert.equal(hidden(h, '#reqCount'), true, '结果未到不显示命中提示');
  assert.equal(h.document.querySelector('#reqCount').textContent, '', '结果未到提示文案应为空');
});

// L4 按档显隐与零跳变：三选择档全选/全不选恒可见（勾选首项右组出现、清零消失，同容器无空占位）；
// 三不可选择档两按钮与右组均隐藏（无 #selectRow 空行残留）；快捷入口仅已接受/已计划可见
t('L4 按档显隐：待接受/已接受/已计划 全选与全不选可见，勾选首项 #selGroup 出现、清零隐藏；开发中/待测试/已完成 两按钮与 #selGroup 均隐藏；快捷入口已接受「开始完善」/已计划「开始开发」/已完成「开始 Commit」（BUG-20260911-005），其余档隐藏', () => {
  const h = setup();
  h.run('syncPlan(false); syncImpl(false);');
  // 待接受：零勾选 → 勾选首项 → 清零
  h.run("state.reqFilter = 'submitted'");
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selectOperable'), false, '待接受档全选可见');
  assert.equal(hidden(h, '#selectNone'), false, '待接受档全不选可见');
  assert.equal(hidden(h, '#selGroup'), true, '零勾选右组隐藏');
  h.state.acceptance.selected.add('REQ-20990101-003');
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selGroup'), false, '勾选首项右组出现（同一工具栏行内，不增加行）');
  assert.match(h.document.querySelector('#selCount').textContent, /^已选 1 项$/, '已选数量即时同步');
  h.state.acceptance.selected.clear();
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selGroup'), true, '清零后右组隐藏');
  // 已接受 / 已计划同理
  for (const lane of ['accepted', 'planned']) {
    h.state.reqFilter = lane;
    h.run('syncAcceptance()');
    assert.equal(hidden(h, '#selectOperable'), false, `${lane} 档全选可见`);
    assert.equal(hidden(h, '#selectNone'), false, `${lane} 档全不选可见`);
  }
  // 三个不可选择档：无选择控件、无空占位
  for (const lane of ['developing', 'confirming', 'done']) {
    h.state.reqFilter = lane;
    h.run('syncAcceptance()');
    assert.equal(hidden(h, '#selectOperable'), true, `${lane} 档全选应隐藏`);
    assert.equal(hidden(h, '#selectNone'), true, `${lane} 档全不选应隐藏`);
    assert.equal(hidden(h, '#selGroup'), true, `${lane} 档右组应隐藏`);
  }
  // 快捷入口按档：已接受「开始完善」/已计划「开始开发」，其余档隐藏；与勾选无关
  h.state.reqFilter = 'accepted';
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#laneQuickEntry'), false, '已接受档快捷入口可见');
  assert.equal(h.document.querySelector('#laneQuickEntry').textContent, '▶ 开始完善', '已接受档文案');
  h.state.plan.selected.add('REQ-20990101-001');
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#laneQuickEntry'), false, '快捷入口与勾选无关（右组出现仍可见）');
  h.state.plan.selected.clear();
  h.state.reqFilter = 'planned';
  h.run('syncAcceptance()');
  assert.equal(h.document.querySelector('#laneQuickEntry').textContent, '▶ 开始开发', '已计划档文案');
  // REQ-20260911-010：已完成档「开始 Commit」快捷入口已随批量 Commit 回退移除
  // （详见 lane-quick-entry-commit-20260911-005.test.mjs），本测试守 done 与其余三档均隐藏
  h.state.reqFilter = 'done';
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#laneQuickEntry'), true, 'done 档快捷入口应隐藏（已随批量 Commit 回退）');
  for (const lane of ['submitted', 'developing', 'confirming']) {
    h.state.reqFilter = lane;
    h.run('syncAcceptance()');
    assert.equal(hidden(h, '#laneQuickEntry'), true, `${lane} 档快捷入口应隐藏`);
  }
});

// L5 交互语义不回退：全选仅当前档叠搜索范围；全不选仅清当前档；批量进行中禁用全选/全不选；排序契约不动
t('L5 语义不回退：全选仅勾选当前档∩搜索命中；全不选仅清当前档（其他档勾选保留）；批量进行中全选/全不选禁用；#reqSort 五选项与绑定保留', () => {
  const h = setup();
  h.run('syncPlan(false); syncImpl(false);');
  // 全选叠搜索：命中只含 003，勾选结果不含 004
  h.run("state.reqFilter = 'submitted'");
  h.run('state.search.q = "REQ-20990101-00"; state.search.res = { items: [{ id: "REQ-20990101-003" }] };');
  h.run('selectOperable()');
  assert.ok(h.state.acceptance.selected.has('REQ-20990101-003'), '命中条目应被勾选');
  assert.ok(!h.state.acceptance.selected.has('REQ-20990101-004'), '搜索未命中条目不得被勾选');
  // 全不选仅清当前档（先清搜索：搜索命中会按档收窄勾选资格，与选择区收窄是两回事）
  h.run('state.search.q = ""; state.search.res = null;');
  h.state.plan.selected.add('REQ-20990101-001');
  h.state.reqFilter = 'submitted';
  h.run('deselectOperable()');
  assert.equal(h.state.acceptance.selected.size, 0, '全不选清当前档勾选');
  assert.ok(h.state.plan.selected.has('REQ-20990101-001'), '其他档勾选保留');
  // 批量进行中：全选/全不选禁用（防重复提交）
  h.state.plan.pending = true;
  h.run("state.reqFilter = 'accepted'");
  h.run('syncAcceptance()');
  assert.equal(h.document.querySelector('#selectOperable').disabled, true, '批量进行中禁用全选');
  assert.equal(h.document.querySelector('#selectNone').disabled, true, '批量进行中禁用全不选');
  h.state.plan.pending = false;
  // 排序契约：五选项与绑定保留（排序沿用现有偏好记忆）
  const sortSel = htmlSrc.match(/<select id="reqSort"[\s\S]*?<\/select>/);
  assert.ok(sortSel, '#reqSort 控件保留');
  for (const v of ['updated-desc', 'updated-asc', 'created-desc', 'created-asc', 'id-asc']) {
    assert.ok(sortSel[0].includes(`value="${v}"`), `排序选项 ${v} 保留`);
  }
  assert.match(source, /reqSortSel\.addEventListener\('change'/, '排序 change 绑定保留（localStorage 记忆）');
});

// L6 ui-demo.html：离线自包含（无外链脚本/样式/资源），覆盖六档、选择与批量动作、快捷入口、四态与宽窄屏
t('L6 ui-demo 离线自包含：条目目录存在 ui-demo.html；无外链 script/link/@import/url(http) 引用；含六档标签、排序/全选/全不选/批量动作/快捷入口演示与 正常/空/加载/失败 四态', () => {
  assert.ok(fs.existsSync(demoPath), '条目目录应存在 ui-demo.html（README 演示链接可打开）');
  const demo = fs.readFileSync(demoPath, 'utf8');
  // 离线自包含：无外部资源加载（内联脚本/样式之外不得引用网络）
  assert.doesNotMatch(demo, /<script[^>]*\ssrc=/i, '不得外链脚本');
  assert.doesNotMatch(demo, /<link[^>]*href=/i, '不得外链样式/资源');
  assert.doesNotMatch(demo, /@import/i, '不得 @import 外部样式');
  assert.doesNotMatch(demo, /url\(\s*['"]?https?:/i, '不得引用网络图片/字体');
  assert.doesNotMatch(demo, /<img[^>]*\ssrc=["']?(?!data:)https?:/i, '不得外链图片');
  // 覆盖面：六档标签全部可演示
  for (const lane of ['待接受', '已接受', '已计划', '开发中', '待测试', '已完成']) {
    assert.ok(demo.includes(lane), `演示应包含 ${lane} 档`);
  }
  // 交互与状态：排序 / 全选 / 全不选 / 批量动作 / 快捷入口 / 四态
  for (const word of ['排序', '全选', '全不选', '开始完善', '开始开发', '接受所选', '移入计划', '驳回待接受', '移出计划']) {
    assert.ok(demo.includes(word), `演示应包含「${word}」`);
  }
  for (const state of ['正常', '空', '加载', '失败']) {
    assert.ok(demo.includes(state), `演示应可切换「${state}」状态`);
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
