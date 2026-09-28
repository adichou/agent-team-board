#!/usr/bin/env node
// BUG-20260921-016 删除概况页签下方的描述标签与计划号等元信息标签，「AI 完善」与
// 「编辑」合并同一行——概况内容区仅剩顶部一行右对齐操作行（.bld-plan-acts，AI 完善 →
// 编辑）+ 描述正文；元信息行（计划号 · 版本号 · 目标分支 · 来源分支）与「描述」标签删除
//（计划号 / 版本号详情头部已有）；编辑态「编辑」键让位（表单自带保存 / 取消）、AI 完善
// 保留原位；锁定 title 口径不变（BUG-20260920-005 / REQ-20260921-014）。
// T1~T6 vm 行为（加载实际 build.js，假 DOM 口径同 req-20260921-016）+ S1 静态契约。
// 用法：node scripts/tests/bug-20260921-016.test.mjs

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

// 描述文本不用「描述」二字（避免与被删标签的断言串扰）
function ver(id, name, status = 'draft', extra = {}) {
  return {
    id, name, description: `版本说明 ${name}`, status, targetBranch: 'main', released: false,
    items: [{ itemId: 'BUG-20260921-016', commit: H1, title: '演示条目', mergedAt: status === 'merged' ? '2026-09-21T03:00:00.000Z' : null, mergeError: null }],
    createdAt: '2026-09-21T01:00:00.000Z', updatedAt: '2026-09-21T02:00:00.000Z',
    merge: { startedAt: null, finishedAt: null, error: status === 'failed' ? '模拟合并失败' : null, baseBranch: 'dev' },
    ...extra,
  };
}

const DRAFT = ver('BLD-20260921-016', 'd1');
const MERGING = ver('BLD-20260921-017', 'm1', 'merging');
const MERGED = ver('BLD-20260921-018', 'm2', 'merged');
const PUSHED = ver('BLD-20260921-019', 'p1', 'merged', { released: true });
const FAILED = ver('BLD-20260921-020', 'f1', 'failed');

function setup({ versions = [DRAFT, MERGING, MERGED, PUSHED, FAILED] } = {}) {
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

// 详情区（rel-detail 起）
function detailPart(inner) {
  const i = inner.indexOf('rel-detail');
  assert.ok(i >= 0, '应渲染右侧详情');
  return inner.slice(i);
}

t('T1 概况布局精简：无元信息行（计划号 / 版本号 / 目标分支 / 来源分支）与「描述」标签行；顶部一行右对齐操作行内「AI 完善」「编辑」同排且先于描述正文', async () => {
  const h = setup();
  await h.enter(); // 选中 BLD-20260921-016（首个），概况步
  const detail = detailPart(h.inner());
  // 元信息行删除（概况步内不再重复计划号 / 版本号 / 分支信息）
  for (const kw of ['计划号 ', '· 目标分支', '来源分支']) {
    assert.ok(!detail.includes(kw), `概况内容区不含「${kw.trim()}」元信息`);
  }
  // 「描述」标签行删除；描述块头部行整体移除
  assert.ok(!/>描述<\/span>/.test(detail), '无「描述」标签');
  assert.ok(!detail.includes('bld-desc-block-head'), '描述块头部行（bld-desc-block-head）移除');
  assert.ok(!detail.includes('bld-desc-block-acts'), '描述块头部操作组（bld-desc-block-acts）移除');
  // 顶部操作行：两键同排、次序 AI 完善 → 编辑、仅此两键
  assert.match(detail, /bld-plan-acts/, '概况顶部操作行（bld-plan-acts）存在');
  const acts = detail.slice(detail.indexOf('bld-plan-acts'), detail.indexOf('</div>', detail.indexOf('bld-plan-acts')));
  const iAnswer = acts.indexOf('data-ver-answer=');
  const iEdit = acts.indexOf('id="bldEditInfo"');
  assert.ok(iAnswer !== -1 && iEdit !== -1, '操作行含 AI 完善与编辑两键');
  assert.ok(iAnswer < iEdit, 'AI 完善在编辑左边');
  assert.equal((acts.match(/<button/g) || []).length, 2, '操作行仅两键');
  assert.match(acts, /data-ver-answer="BLD-20260921-016"/, 'AI 完善绑定当前选中版本');
  // 操作行先于描述正文（描述正文直接跟在操作行之后）
  const iActs = detail.indexOf('bld-plan-acts');
  const iDesc = detail.indexOf('class="bld-desc"');
  assert.ok(iDesc > iActs, '描述正文位于操作行之后');
  assert.match(detail, /版本说明 d1/, '描述正文照常展示');
});

t('T2 操作行锁定口径不回归：merging 两键禁用且 title 分别说明；推送完成后 AI 完善禁用、编辑仍可用；merged 未推送两键可用', async () => {
  const h = setup();
  await h.enter();
  h.select('BLD-20260921-017'); // merging
  let detail = detailPart(h.inner());
  assert.match(detail, /data-ver-answer="BLD-20260921-017" disabled title="合并中，请稍候……"/, 'AI 完善 merging 禁用并说明');
  assert.match(detail, /id="bldEditInfo" disabled title="版本合并中，暂不可修改"/, '编辑 merging 禁用并说明');
  h.select('BLD-20260921-019'); // merged + pushed（正式发布）
  detail = detailPart(h.inner());
  assert.match(detail, /data-ver-answer="BLD-20260921-019" disabled title="已正式发布，不允许再 AI 完善"/, 'AI 完善已正式发布禁用并说明');
  assert.match(detail, /id="bldEditInfo" title="编辑版本名称与描述"/, '编辑已正式发布仍可用（不因 AI 完善禁用而一并禁用）');
  h.select('BLD-20260921-018'); // merged 未推送
  detail = detailPart(h.inner());
  assert.match(detail, /data-ver-answer="BLD-20260921-018" aria-label="AI 完善 BLD-20260921-018"/, 'merged 未推送 AI 完善可用');
  assert.match(detail, /id="bldEditInfo" title="编辑版本名称与描述"/, 'merged 未推送编辑可用');
});

t('T3 编辑态让位：点「编辑」就地展开名称 + 描述表单，操作行「编辑」键随表单打开消失、「AI 完善」保留原位；取消后两键恢复、表单退出', async () => {
  const h = setup();
  await h.enter(); // 选中 BLD-20260921-016
  h.el('#bldEditInfo').listeners.click(); // 打开就地编辑表单
  let detail = detailPart(h.inner());
  assert.match(detail, /bld-plan-edit/, '就地编辑表单打开（名称 + 描述同一表单）');
  assert.ok(!detail.includes('id="bldEditInfo"'), '表单打开时操作行「编辑」键让位（表单自带保存 / 取消）');
  assert.match(detail, /data-ver-answer="BLD-20260921-016"/, 'AI 完善保留原位（操作行仍在）');
  assert.ok(!/>版本说明 d1<\/span>/.test(detail), '展示态描述被表单替换（textarea 预填除外）');
  assert.ok(!detail.includes('bld-desc-block'), '展示态描述块被表单替换（就地替换）');
  h.el('#bldPlanCancel').listeners.click(); // 取消
  detail = detailPart(h.inner());
  assert.ok(!detail.includes('bld-plan-edit'), '表单关闭（取消无副作用）');
  assert.match(detail, /data-ver-answer="BLD-20260921-016"/, '取消后 AI 完善恢复');
  assert.match(detail, /id="bldEditInfo"/, '取消后编辑键恢复');
  assert.match(detail, /版本说明 d1/, '取消后描述正文恢复');
});

t('T4 merging 提示与合并失败信息随布局上移且口径不变：位于操作行之后、描述区附近展示', async () => {
  const h = setup();
  await h.enter();
  h.select('BLD-20260921-017'); // merging
  let detail = detailPart(h.inner());
  let iNote = detail.indexOf('合并中，请稍候……');
  assert.ok(iNote > 0, 'merging 提示仍展示');
  assert.ok(iNote > detail.indexOf('bld-plan-acts'), 'merging 提示位于顶部操作行之后（随布局上移）');
  h.select('BLD-20260921-020'); // failed
  await h.flush();
  detail = detailPart(h.inner());
  assert.match(detail, /合并失败：[^（]*（可重试，只补未合并条目）/, '合并失败信息仍展示且口径不变');
});

t('T5 信息完整性：详情头部仍完整显示计划号、版本号、更新时间；五步导航五步齐全不受布局影响', async () => {
  const h = setup();
  await h.enter(); // 选中 BLD-20260921-016
  const detail = detailPart(h.inner());
  assert.match(detail, /BLD-20260921-016 · 版本号 20260921-016 · 更新 /, '头部元信息完整（计划号 / 版本号 / 更新时间）');
  for (const label of ['选择条目与提交', '挑选合并', '文档与翻译', '文档合并', '发布']) {
    assert.ok(detail.includes(label), `五步导航含「${label}」`);
  }
});

t('T6 i18n 词条沿用：被删标签不误删既有键（描述 / AI 完善 / 编辑等仍可全文匹配替换，别的界面在用）', async () => {
  await import('../web/i18n.js');
  const { EN } = globalThis.ATBI18N._dict;
  for (const k of ['描述', 'AI 完善', '编辑', '合并中，请稍候……', '已正式发布，不允许再 AI 完善', '版本合并中，暂不可修改', '编辑版本名称与描述', '点击编辑描述']) {
    assert.ok(EN[k], `EN 应含「${k}」（不误删）`);
  }
});

t('S1 静态契约：renderDetail 概况模板不再产出元信息行；bld-desc-block-head / bld-desc-block-acts 模板与样式移除；.bld-plan-acts 操作行样式恢复', () => {
  const detailFn = buildJs.match(/function renderDetail\(v\) \{[\s\S]*?\n  \}/);
  assert.ok(detailFn, '缺少 renderDetail');
  // 元信息行模板特征（esc 表达式）不再产出；注释中的说明性文字不算
  for (const k of ['计划号 ${esc(', '目标分支 ${esc(', '来源分支 ${esc(', 'bld-desc-block-head', 'bld-desc-block-acts']) {
    assert.ok(!detailFn[0].includes(k), `renderDetail 不再渲染 ${JSON.stringify(k)}`);
  }
  assert.ok(detailFn[0].includes('bld-plan-acts'), 'renderDetail 渲染 bld-plan-acts 操作行');
  assert.ok(!buildJs.includes('bld-desc-block-head') && !buildJs.includes('bld-desc-block-acts'), 'build.js 全文无描述块头部模板残留');
  assert.match(styleCss, /\.bld-plan-acts \{[^}]*justify-content: flex-end/, 'bld-plan-acts 右对齐样式存在');
  assert.match(styleCss, /\.bld-plan-acts \{[^}]*flex-wrap: wrap/, 'bld-plan-acts 窄屏自动换行（既有口径）');
  assert.ok(!styleCss.includes('.bld-desc-block-head') && !styleCss.includes('.bld-desc-block-acts'), '描述块头部样式移除');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
