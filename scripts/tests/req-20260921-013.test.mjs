#!/usr/bin/env node
// REQ-20260921-013 「AI 完善」按钮从左侧版本卡片迁入右侧详情第一个页签（概况）内容区，
// 首个页签「版本计划」更名「概况」（内部 plan 标识与五步顺序不变，外层模块导航不动）。
// T1~T9 vm 行为（加载实际 build.js，假 DOM 口径同 bug-build-ver-card-acts-20260913-004）
// + i18n 静态断言；卡片锁定断言迁移后的既有回归适配见 bug-build-ver-card-acts /
// bug-20260920-005 两文件（本文件 T2/T5 锁定口径与其对齐）。
// 用法：node scripts/tests/req-20260921-013.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(pluginRoot, 'scripts', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');

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
    id, name, description: `描述 ${name}`, status, targetBranch: 'main', released: false,
    items: [{ itemId: 'REQ-20260921-013', commit: H1, title: '演示需求', mergedAt: status === 'merged' ? '2026-09-21T03:00:00.000Z' : null, mergeError: status === 'failed' ? 'conflict' : null }],
    createdAt: '2026-09-21T01:00:00.000Z', updatedAt: '2026-09-21T02:00:00.000Z',
    merge: { startedAt: null, finishedAt: null, error: status === 'failed' ? '模拟合并失败' : null, baseBranch: 'dev' },
    ...extra,
  };
}

function setup({ versions = [ver('BLD-DRAFT', 'd1'), ver('BLD-MERGING', 'm1', 'merging'), ver('BLD-MERGED', 'm2', 'merged'), ver('BLD-PUSHED', 'p1', 'merged', { released: true })] } = {}) {
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
    // 选中版本并渲染概况步（selectVersion 只重置状态，setStep 内部 render 出详情）
    select: (id) => {
      vm.runInContext(`window.ATBBuild.selectVersion(${JSON.stringify(id)}); window.ATBBuild.setStep('plan')`, sandbox);
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

t('T1 页签更名（REQ-20260926-002 五步重定义）：五步名称与顺序、data-step="plan" 标识保留；外层模块导航「版本计划 / 分支浏览」不受影响', async () => {
  const h = setup();
  await h.enter(); // 自动选中首个 BLD-DRAFT，默认 plan 步
  const inner = h.inner();
  assert.match(inner, /data-step="plan"[^>]*aria-selected="true"[^>]*>选择条目与提交</, '首个页签显示名按新五步定义且默认选中');
  assert.match(inner, /data-step="merge"[^>]*>挑选合并</, '第二步名称（挑选合并）');
  assert.match(inner, /data-step="docs"[^>]*>文档与翻译</, '第三步名称（文档与翻译）');
  assert.match(inner, /data-step="docmerge"[^>]*>文档合并</, '第四步名称（文档合并）');
  assert.match(inner, /data-step="release"[^>]*>发布</, '第五步名称（发布）');
  const order = ['plan', 'merge', 'docs', 'docmerge', 'release'].map((k) => inner.indexOf(`data-step="${k}"`));
  assert.ok(order.every((x, i) => i === 0 || x > order[i - 1]), '五步顺序保持');
  // 外层模块子页签（TABS）保留「版本计划 / 分支浏览」
  assert.match(inner, /data-bld-tab="versions"[^>]*>版本计划</, '外层「版本计划」导航保留');
  assert.match(inner, /data-bld-tab="branches"[^>]*>分支浏览</, '外层「分支浏览」导航保留');
});

t('T2 卡片迁移：版本卡片不再渲染 AI 完善按钮；合并 / 创建并预检 / 查看发布记录键随 REQ-20260921-016 一并移出卡片（迁往详情对应步骤），删除键随迁标题行保留', async () => {
  const h = setup();
  await h.enter();
  const inner = h.inner();
  const cards = listPart(inner);
  assert.ok(!cards.includes('data-ver-answer'), '卡片区不再有 AI 完善入口');
  // REQ-20260921-016：列表卡片精简——合并 / 创建并预检 / 查看发布记录只保留详情步骤入口
  for (const k of ['data-ver-merge', 'data-ver-release', 'data-ver-release-view']) {
    assert.ok(!cards.includes(k), `卡片区不再有 ${k} 入口（迁往详情对应步骤）`);
  }
  for (const id of ['BLD-DRAFT', 'BLD-MERGING', 'BLD-MERGED', 'BLD-PUSHED']) {
    assert.match(cards, new RegExp(`data-ver-delete="${id}"`), `${id} 删除键保留（REQ-20260921-016 迁标题行右端）`);
  }
});

t('T3 概况入口：概况顶部操作行有唯一「AI 完善」按钮（BUG-20260921-016 起位于 bld-plan-acts 行、紧邻「编辑」左边）绑定当前版本；切至其余四步入口隐藏', async () => {
  const h = setup();
  await h.enter(); // 选中 BLD-DRAFT，plan 步
  let detail = detailPart(h.inner());
  assert.match(detail, /bld-plan-acts/, '概况顶部操作行存在（入口所在容器，BUG-20260921-016）');
  assert.match(detail, /data-ver-answer="BLD-DRAFT"/, '按钮绑定当前选中版本');
  assert.match(detail, /aria-label="AI 完善 BLD-DRAFT"/, '可访问名称带版本号');
  assert.equal((detail.match(/data-ver-answer=/g) || []).length, 1, '详情内唯一入口（无重复）');
  // 入口在概况顶部操作行内，且先于「编辑」键（紧邻其左）
  const iActs = detail.indexOf('bld-plan-acts');
  assert.ok(iActs !== -1 && detail.indexOf('data-ver-answer="BLD-DRAFT"', iActs) < detail.indexOf('id="bldEditInfo"'), 'AI 完善位于编辑左边');
  // 切至其他步骤：入口不显示（对四个步骤逐一验证；REQ-20260926-002：link 步并入 plan，步骤键变更）
  for (const step of ['merge', 'docs', 'docmerge', 'release']) {
    h.run(`window.ATBBuild.setStep(${JSON.stringify(step)})`);
    detail = detailPart(h.inner());
    assert.ok(!detail.includes('data-ver-answer'), `切至 ${step} 步后概况入口隐藏`);
  }
  h.run(`window.ATBBuild.setStep('plan')`);
  detail = detailPart(h.inner());
  assert.ok(detail.includes('data-ver-answer'), '切回概况入口恢复');
});

t('T4 切换版本不串单：详情按钮随选中版本换绑；弹窗标题与提示词对当前版本', async () => {
  const h = setup();
  await h.enter(); // 选中 BLD-DRAFT
  assert.match(detailPart(h.inner()), /data-ver-answer="BLD-DRAFT"/, '初始绑定首个版本');
  h.select('BLD-MERGED');
  assert.match(detailPart(h.inner()), /data-ver-answer="BLD-MERGED"/, '切换后按钮绑定新选中版本');
  assert.ok(!detailPart(h.inner()).includes('data-ver-answer="BLD-DRAFT"'), '旧版本绑定不再出现');
  h.run(`window.ATBBuild.openAnswerModal()`);
  const inner = h.inner();
  assert.match(inner, /AI 完善（BLD-MERGED）/, '无参打开弹窗对应当前选中版本');
  assert.ok(inner.includes('描述 m2'), '提示词内容为新版本名称 / 描述');
});

t('T5 锁定规则沿用：merging 禁用「合并中，请稍候……」；已正式发布禁用并说明；已合并未推送可用', async () => {
  const h = setup();
  await h.enter();
  h.select('BLD-MERGING');
  assert.match(detailPart(h.inner()), /data-ver-answer="BLD-MERGING" disabled title="合并中，请稍候……"/, 'merging 禁用并提示合并中');
  h.select('BLD-PUSHED');
  assert.match(detailPart(h.inner()), /data-ver-answer="BLD-PUSHED" disabled title="已正式发布，不允许再 AI 完善"/, '已正式发布禁用并说明');
  h.select('BLD-MERGED');
  const merged = detailPart(h.inner());
  assert.match(merged, /data-ver-answer="BLD-MERGED" aria-label/, '已合并未推送可用（无 disabled）');
  assert.match(merged, /data-ver-answer="BLD-MERGED"[^>]*title="复制提示词给 Agent，回答直接粘贴回本弹窗自动解析"/, '可用态 title 说明动作');
  h.select('BLD-DRAFT');
  assert.match(detailPart(h.inner()), /data-ver-answer="BLD-DRAFT" aria-label/, 'draft 可用零回归');
});

t('T6 直调守卫不回归：merging / pushed 直调与无参回落均不弹窗；merged / draft / failed 可打开', async () => {
  const h = setup();
  await h.enter();
  h.run(`window.ATBBuild.openAnswerModal('BLD-MERGING')`);
  assert.ok(!h.inner().includes('AI 完善（BLD-MERGING）'), '直调 merging 不弹窗');
  h.run(`window.ATBBuild.openAnswerModal('BLD-PUSHED')`);
  assert.ok(!h.inner().includes('AI 完善（BLD-PUSHED）'), '直调已正式发布不弹窗');
  h.select('BLD-PUSHED');
  h.run(`window.ATBBuild.openAnswerModal()`);
  assert.ok(!h.inner().includes('AI 完善（BLD-PUSHED）'), '无参回落已正式发布不弹窗');
  h.run(`window.ATBBuild.openAnswerModal('BLD-MERGED')`);
  assert.match(h.inner(), /AI 完善（BLD-MERGED）/, '已合并未推送可打开');
  h.run(`window.ATBBuild.openAnswerModal('BLD-DRAFT')`);
  assert.match(h.inner(), /AI 完善（BLD-DRAFT）/, 'draft 可打开');
});

t('T7 手动编辑共存：编辑表单草稿不被 AI 完善弹窗静默覆盖，关闭弹窗后草稿仍在', async () => {
  const h = setup();
  await h.enter(); // 选中 BLD-DRAFT，plan 步
  h.el('#bldEditInfo').listeners.click(); // 打开就地编辑表单
  h.el('.bld-plan-name').value = '未保存的新名称';
  h.el('.bld-plan-name').listeners.input(); // 草稿回写 state.planEdit
  h.run(`window.ATBBuild.openAnswerModal('BLD-DRAFT')`);
  let inner = h.inner();
  assert.match(inner, /AI 完善（BLD-DRAFT）/, 'AI 完善弹窗打开');
  assert.match(inner, /class="[^"]*bld-plan-edit[^"]*"/, '编辑表单仍在（并存不互斥关闭）');
  assert.match(inner, /value="未保存的新名称"/, '编辑草稿值保留（未被静默覆盖）');
  h.el('#bldAnswerClose').listeners.click(); // 关闭 AI 完善弹窗
  inner = h.inner();
  assert.ok(!inner.includes('bldAnswerWrap'), '弹窗已关闭');
  assert.match(inner, /value="未保存的新名称"/, '关闭弹窗后编辑草稿仍在');
});

t('T8 空态：无版本时详情显示选择引导且无 AI 完善入口（refresh 后选中回落为空，未确定版本无写入按钮）', async () => {
  const h = setup({ versions: [] });
  await h.enter();
  const inner = h.inner();
  assert.match(inner, /暂无版本计划/, '无版本时列表空态引导保留');
  assert.match(inner, /点击左侧版本查看详情/, '详情区显示选择引导');
  assert.ok(!inner.includes('data-ver-answer'), '未确定版本无 AI 完善入口（无写入按钮）');
});

t('T9 i18n：「概况」EN=Overview；按钮 title 两词条补登记；外层「版本计划」词条保留', async () => {
  await import('../web/i18n.js');
  const { EN } = globalThis.ATBI18N._dict;
  assert.equal(EN['概况'], 'Overview', '「概况」词条存在');
  assert.ok(EN['合并中，请稍候……'], '「合并中，请稍候……」词条补登记');
  assert.ok(EN['复制提示词给 Agent，回答直接粘贴回本弹窗自动解析'], '按钮可用态 title 词条补登记');
  assert.equal(EN['版本计划'], 'Version plans', '外层导航「版本计划」词条保留');
  assert.equal(EN['已正式发布，不允许再 AI 完善'], 'Officially released — AI refine disabled', '锁定 title 词条保留');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
