#!/usr/bin/env node
// REQ-20260921-016 版本计划列表中的操作按钮优化——列表卡片精简（移除 AI 完善 / 合并入 main
// （含失败重试）/ 创建并预检 / 查看发布记录四键与 card-acts 操作行），「删除」迁至卡片标题行
// 右端；详情概况「AI 完善」紧邻「编辑」左边。BUG-20260921-016 布局再调整：两键同排于概况
// 顶部一行右对齐操作行（bld-plan-acts，元信息行与「描述」标签行删除），断言已同步。
// 合并 / 创建并预检 / 发布记录入口仍分别位于详情「合并入 main」「正式发布」步。
// T1~T8 vm 行为（加载实际 build.js，假 DOM 口径同 req-20260921-013）+ S1 静态契约。
// 用法：node scripts/tests/req-20260921-016.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(pluginRoot, 'scripts', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');
const styleCss = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

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
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {},
    closest() { return null; },
  };
}

const H1 = 'a'.repeat(40);

function ver(id, name, status = 'draft', extra = {}) {
  return {
    id, name, description: `描述 ${name}`, status, targetBranch: 'main', pushed: false,
    items: [{ itemId: 'REQ-20260921-016', commit: H1, title: '演示需求', mergedAt: status === 'merged' ? '2026-09-21T03:00:00.000Z' : null, mergeError: status === 'failed' ? 'conflict' : null }],
    createdAt: '2026-09-21T01:00:00.000Z', updatedAt: '2026-09-21T02:00:00.000Z',
    merge: { startedAt: null, finishedAt: null, error: status === 'failed' ? '模拟合并失败' : null, baseBranch: 'dev' },
    ...extra,
  };
}

function setup({ versions = [ver('BLD-DRAFT', 'd1'), ver('BLD-MERGING', 'm1', 'merging'), ver('BLD-MERGED', 'm2', 'merged'), ver('BLD-PUSHED', 'p1', 'merged', { pushed: true }), ver('BLD-FAILED', 'f1', 'failed')] } = {}) {
  const state = { initialized: true, isRepo: true, currentBranch: 'dev', versions };
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    fetch: async (url) => {
      const up = new URL(String(url), 'http://local');
      if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(state)) };
      if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => ({ items: [] }) };
      if (up.pathname === '/api/build/publish-plan') return { ok: true, json: async () => ({ steps: [], docs: { files: [], overall: 'none' }, mergeAnalysis: { perItem: [], blocked: [], notes: [] } }) };
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  sandbox.toast = () => {};
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
  return {
    sandbox, state,
    run: (code) => vm.runInContext(code, sandbox),
    inner: () => vm.runInContext(`document.querySelector('#buildView').innerHTML`, sandbox),
    el: (sel) => vm.runInContext(`document.querySelector('#buildView').querySelector(${JSON.stringify(sel)})`, sandbox),
    enter: async () => { await vm.runInContext(`window.ATBBuild.enter('/p/a')`, sandbox); await flush(); },
    select: (id, step = 'plan') => {
      vm.runInContext(`window.ATBBuild.selectVersion(${JSON.stringify(id)}); window.ATBBuild.setStep(${JSON.stringify(step)})`, sandbox);
    },
    flush,
  };
}

// 详情区（rel-detail 起）与卡片区（rel-list 到 rel-detail）分段：入口位置断言用
function detailPart(inner) {
  const i = inner.indexOf('rel-detail');
  assert.ok(i >= 0, '应渲染右侧详情');
  return inner.slice(i);
}
function listPart(inner) {
  const a = inner.indexOf('rel-list');
  const b = inner.indexOf('rel-detail');
  assert.ok(a >= 0 && b > a, '应渲染左侧列表');
  return inner.slice(a, b);
}
// 某版本卡片片段（卡片起至下一卡片或详情区）
function cardOf(inner, id) {
  const start = inner.indexOf(`data-ver-id="${id}"`);
  assert.ok(start >= 0, `卡片 ${id} 应存在`);
  let end = inner.length;
  const next = inner.indexOf('data-ver-id="', start + 10);
  const detail = inner.indexOf('<div class="rel-detail', start);
  if (next !== -1) end = Math.min(end, next);
  if (detail !== -1) end = Math.min(end, detail);
  return inner.slice(start, end);
}

t('T1 列表精简：卡片不再渲染 AI 完善 / 合并入 main（含失败重试）/ 创建并预检 / 查看发布记录，card-acts 操作行整体移除无留白', async () => {
  const h = setup();
  await h.enter();
  const cards = listPart(h.inner());
  assert.ok(!cards.includes('data-ver-answer'), '卡片无 AI 完善');
  assert.ok(!cards.includes('data-ver-merge'), '卡片无合并入 main / 重试合并入 main');
  assert.ok(!cards.includes('合并入 main') && !cards.includes('重试合并入 main'), '卡片无合并文案（含失败重试入口）');
  assert.ok(!cards.includes('data-ver-release'), '卡片无创建并预检（data-ver-release）');
  assert.ok(!cards.includes('创建并预检'), '卡片无创建并预检文案');
  assert.ok(!cards.includes('data-ver-release-view'), '卡片无查看发布记录');
  assert.ok(!cards.includes('card-acts'), 'card-acts 操作行整体移除（原操作区无多余留白）');
});

t('T2 删除迁标题行右端：每张卡片删除键位于自身标题行（.t 内、名称之后），quiet 危险弱化；长名称带完整名 title 提示；状态禁用口径不回归', async () => {
  const h = setup();
  await h.enter();
  const inner = h.inner();
  for (const id of ['BLD-DRAFT', 'BLD-MERGING', 'BLD-MERGED', 'BLD-PUSHED', 'BLD-FAILED']) {
    const card = cardOf(inner, id);
    const tStart = card.indexOf('<div class="t"');
    const tEnd = card.indexOf('</div>', tStart);
    assert.ok(tStart >= 0, `${id} 卡片有标题行`);
    const titleRow = card.slice(tStart, tEnd);
    assert.match(titleRow, new RegExp(`data-ver-delete="${id}"`), `${id} 删除键在标题行内`);
    assert.match(titleRow, new RegExp(`aria-label="删除 ${id}"`), `${id} 删除键 aria-label 带版本号`);
    const iName = titleRow.indexOf('<strong');
    const iDel = titleRow.indexOf('data-ver-delete');
    assert.ok(iName !== -1 && iDel > iName, `${id} 删除键位于名称之后（标题行右端）`);
    assert.ok(!card.slice(tEnd).includes('data-ver-delete'), `${id} 删除键不在标题行外的其他行`);
  }
  // quiet 危险弱化样式（REQ-20260913-004 口径随位置迁移保留）
  const card = cardOf(inner, 'BLD-DRAFT');
  const del = card.slice(card.lastIndexOf('<button', card.indexOf('data-ver-delete')), card.indexOf('</button>', card.indexOf('data-ver-delete')));
  assert.match(del, /btn small quiet/, '删除键为 quiet 弱化样式');
  // 长名称完整提示（title 挂在名称上）
  assert.match(cardOf(inner, 'BLD-DRAFT'), /<strong title="d1">d1<\/strong>/, '名称带 title 完整名提示');
  // 状态口径：merging 禁用并提示；draft / merged / pushed / failed 可用（不回归）
  assert.match(inner, /data-ver-delete="BLD-MERGING" disabled title="合并中，不可删除"/, 'merging 删除键禁用并提示');
  for (const id of ['BLD-DRAFT', 'BLD-MERGED', 'BLD-PUSHED', 'BLD-FAILED']) {
    assert.match(inner, new RegExp(`data-ver-delete="${id}" aria-label`), `${id} 删除键可用`);
  }
});

t('T3 详情概况操作行（BUG-20260921-016 布局调整后）：顶部一行右对齐 bld-plan-acts 内「AI 完善」紧邻「编辑」左边；无「描述」标签行与元信息行', async () => {
  const h = setup();
  await h.enter(); // 选中 BLD-DRAFT，plan 步
  let detail = detailPart(h.inner());
  // BUG-20260921-016：概况顶部操作行恢复（元信息行 / 描述标签行删除）
  assert.match(detail, /bld-plan-acts/, '概况顶部操作行（bld-plan-acts）存在');
  assert.ok(!detail.includes('bld-desc-block-head'), '描述块头部行移除（BUG-20260921-016）');
  const acts = detail.slice(detail.indexOf('bld-plan-acts'), detail.indexOf('</div>', detail.indexOf('bld-plan-acts')));
  const iAnswer = acts.indexOf('data-ver-answer="BLD-DRAFT"');
  const iEdit = acts.indexOf('id="bldEditInfo"');
  assert.ok(iAnswer !== -1 && iEdit !== -1, '操作行含两键');
  assert.ok(iAnswer < iEdit, '顺序：AI 完善 → 编辑（AI 完善紧邻编辑左边）');
  assert.equal((acts.match(/<button/g) || []).length, 2, '操作行仅两键（AI 完善 / 编辑）');
  assert.match(detail, /data-ver-answer="BLD-DRAFT"/, 'AI 完善绑定当前选中版本');
  // 切至其他步骤入口隐藏（操作行属概况步）；切回恢复
  for (const step of ['link', 'docs', 'merge', 'release']) {
    h.select('BLD-DRAFT', step);
    assert.ok(!detailPart(h.inner()).includes('data-ver-answer'), `切至 ${step} 步后概况入口隐藏`);
  }
  h.select('BLD-DRAFT', 'plan');
  assert.ok(detailPart(h.inner()).includes('data-ver-answer'), '切回概况入口恢复');
});

t('T4 编辑表单并存口径（BUG-20260921-016 让位规则）：进入就地编辑表单时操作行「编辑」键让位、「AI 完善」保留原位，取消后恢复；编辑键原有 merging 禁用规则不变（pushed 不禁用）', async () => {
  const h = setup();
  await h.enter(); // 选中 BLD-DRAFT
  h.el('#bldEditInfo').listeners.click(); // 打开就地编辑表单
  let detail = detailPart(h.inner());
  assert.match(detail, /bld-plan-edit/, '编辑表单打开');
  assert.match(detail, /data-ver-answer="BLD-DRAFT"/, '表单打开时 AI 完善保留原位（操作行仍在，BUG-20260921-016）');
  assert.ok(!detail.includes('id="bldEditInfo"'), '表单打开时编辑键让位（表单自带保存 / 取消）');
  h.el('#bldPlanCancel').listeners.click(); // 取消
  detail = detailPart(h.inner());
  assert.ok(!detail.includes('bld-plan-edit'), '表单关闭');
  assert.ok(detail.includes('data-ver-answer') && detail.includes('id="bldEditInfo"'), '退出编辑后恢复两个入口');
  // 编辑键 merging 禁用规则不变；AI 完善在 pushed 禁用但编辑不受影响
  h.select('BLD-MERGING');
  const merging = detailPart(h.inner());
  assert.match(merging, /id="bldEditInfo" disabled title="版本合并中，暂不可修改"/, '编辑键 merging 禁用（原有规则）');
  assert.match(merging, /data-ver-answer="BLD-MERGING" disabled title="合并中，请稍候……"/, 'AI 完善 merging 禁用并说明');
  h.select('BLD-PUSHED');
  const pushed = detailPart(h.inner());
  assert.match(pushed, /data-ver-answer="BLD-PUSHED" disabled title="已正式发布，不允许再 AI 完善"/, 'AI 完善已正式发布禁用并说明');
  assert.match(pushed, /id="bldEditInfo" title="编辑版本名称与描述"/, '编辑键已正式发布仍可用（不因 AI 完善禁用而一并禁用）');
  h.select('BLD-MERGED');
  assert.match(detailPart(h.inner()), /data-ver-answer="BLD-MERGED" aria-label/, '已合并未推送 AI 完善仍可用');
});

t('T5 切换版本不串单：详情两入口随选中版本换绑，AI 弹窗对新选中版本的版本号与回填对象', async () => {
  const h = setup();
  await h.enter(); // 选中 BLD-DRAFT
  h.select('BLD-MERGED');
  const detail = detailPart(h.inner());
  assert.match(detail, /data-ver-answer="BLD-MERGED"/, '切换后 AI 完善绑定新选中版本');
  assert.ok(!detail.includes('data-ver-answer="BLD-DRAFT"'), '旧版本绑定不再出现');
  h.run(`window.ATBBuild.openAnswerModal()`);
  const inner = h.inner();
  assert.match(inner, /AI 完善（BLD-MERGED）/, '无参打开弹窗对应当前选中版本');
  assert.ok(inner.includes('描述 m2'), '提示词内容为新版本名称 / 描述');
  // 删除确认仍按所在卡片版本打开（绑定循环 data-ver-delete 不回归）
  h.run(`window.ATBBuild.openDeleteConfirm('BLD-DRAFT')`);
  assert.match(h.inner(), /删除版本（BLD-DRAFT）/, '删除确认按目标卡片版本打开（选中态不干扰）');
});

t('T6 合并 / 创建并预检 / 发布记录仍在详情对应步骤：合并步有主按钮；正式发布步有创建并预检与发布记录区；列表不再重复入口', async () => {
  const h = setup();
  await h.enter(); // 选中 BLD-DRAFT
  h.select('BLD-DRAFT', 'merge');
  await h.flush(); // 等合并步装配自愈加载完成
  let detail = detailPart(h.inner());
  assert.match(detail, /data-ver-merge="BLD-DRAFT"/, '合并步主按钮仍在（绑定当前版本）');
  h.select('BLD-MERGED', 'release');
  await h.flush();
  detail = detailPart(h.inner());
  assert.match(detail, /data-ver-release="BLD-MERGED"/, '正式发布步创建并预检入口仍在（merged 可用）');
  assert.match(detail, /aria-label="发布记录"|暂无发布记录/, '正式发布步发布记录区仍在（有记录列清单 / 无记录显空态）');
  assert.ok(!listPart(h.inner()).includes('data-ver-merge'), '列表无合并入口（详情独有）');
  assert.ok(!listPart(h.inner()).includes('data-ver-release'), '列表无发布入口（详情独有）');
});

t('T7 空态：无版本 / 搜索无匹配无悬空入口；未选择版本时详情显示选择提示且无 AI 完善 / 编辑 / 删除入口', async () => {
  const h = setup({ versions: [] });
  await h.enter();
  const inner = h.inner();
  assert.match(inner, /暂无版本计划/, '无版本时列表空态引导保留');
  assert.match(inner, /点击左侧版本查看详情/, '详情区显示选择引导');
  for (const k of ['data-ver-answer', 'id="bldEditInfo"', 'data-ver-delete', 'data-ver-merge', 'data-ver-release']) {
    assert.ok(!inner.includes(k), `未确定版本无 ${k} 入口`);
  }
});

t('T8 i18n 词条沿用：AI 完善 / 编辑 / 删除与禁用说明词条均已在词典（本次仅迁移位置，不新增文案）', async () => {
  await import('../web/i18n.js');
  const { EN } = globalThis.ATBI18N._dict;
  for (const k of ['AI 完善', '编辑', '删除', '合并中，请稍候……', '已正式发布，不允许再 AI 完善', '合并中，不可删除', '版本合并中，暂不可修改', '编辑版本名称与描述']) {
    assert.ok(EN[k], `EN 应含「${k}」`);
  }
});

t('S1 静态契约：renderVersionList 不再产出合并 / 发布入口与 card-acts；data-ver-release-view 按钮与绑定移除；其余行为标记绑定保留；CSS 新增标题行删除与描述头操作组样式', () => {
  const listFn = buildJs.match(/function renderVersionList\(\) \{[\s\S]*?\n  \}/);
  assert.ok(listFn, '缺少 renderVersionList');
  for (const k of ['data-ver-merge', 'data-ver-release', 'data-ver-release-view', 'class="card-acts"', 'data-ver-answer']) {
    assert.ok(!listFn[0].includes(k), `renderVersionList 不再渲染 ${k}`);
  }
  assert.ok(listFn[0].includes('data-ver-delete'), 'renderVersionList 仍渲染删除键（标题行）');
  assert.ok(listFn[0].includes('state.mergeBusy'), 'mergeBusy 期间删除键一并禁用（全局口径保留）');
  assert.ok(!buildJs.includes('data-ver-release-view'), '查看发布记录按钮模板与绑定整体移除');
  for (const k of ['data-ver-answer', 'data-ver-merge', 'data-ver-delete', 'data-ver-release']) {
    assert.match(buildJs, new RegExp(`view\\.querySelectorAll\\('\\[${k}\\]'\\)`), `bindCommon 循环绑定 ${k} 保留`);
  }
  // CSS：卡片标题行删除右端对齐；概况操作行样式（BUG-20260921-016 恢复 bld-plan-acts，
  // 描述块头部行 bld-desc-block-head / bld-desc-block-acts 移除）；rel-card card-acts 样式移除
  assert.match(styleCss, /\.rel-card \.t \.bld-card-title/, '卡片标题行标题侧样式存在');
  assert.match(styleCss, /\.rel-card \.t \.bld-ver-del/, '标题行删除键右端对齐样式存在');
  assert.match(styleCss, /\.bld-plan-acts \{/, '概况顶部操作行样式存在（BUG-20260921-016 恢复）');
  assert.ok(!styleCss.includes('.bld-desc-block-head') && !styleCss.includes('.bld-desc-block-acts'), '描述块头部行样式移除（BUG-20260921-016）');
  assert.ok(!/\.rel-card \.card-acts/.test(styleCss), '版本卡片 card-acts 样式移除');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
