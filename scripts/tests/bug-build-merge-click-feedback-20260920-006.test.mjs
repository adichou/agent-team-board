#!/usr/bin/env node
// BUG-20260920-006 版本计划「合并入 main」入口点击无响应——三路径修复的行为测试：
// 1) 详情页主按钮与卡片行内按钮统一改 aria-disabled（可点击捕获），禁用 title 归因与
//    真实原因一一对应（mergeBusy / merging / 已正式发布 / 文档门禁 / 暂无关联条目 / 不在 dev），
//    不再误回落「前置条件未满足」；
// 2) openMergeConfirm / doMerge 守卫分支不再静默：版本不存在 → 刷新提示；合并执行中 → 勿重复触发；
// 3) 两处入口可用性 / 反馈口径一致（选中版本五步装配已加载时卡片同查门禁与 dev）；
// 4) 可合并链路（点击 → 确认弹窗 → 确认合并 → 成功 toast）零回归；i18n 词条中英同步。
// 用法：node scripts/tests/bug-build-merge-click-feedback-20260920-006.test.mjs

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

/* ---------- vm 行为 ---------- */

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
    items: [{ itemId: 'REQ-20260913-001', commit: H1, title: '演示需求', mergedAt: status === 'merged' ? '2026-09-13T03:00:00.000Z' : null, mergeError: status === 'failed' ? 'conflict' : null }],
    createdAt: '2026-09-13T01:00:00.000Z', updatedAt: '2026-09-13T02:00:00.000Z', merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' },
    ...extra,
  };
}

// 五步装配 payload（/api/build/publish-plan 形状，steps / currentBranch / docs / mergeAnalysis）
function plan({ currentBranch = 'dev', mergeLocked = false, reason = '' } = {}) {
  return {
    currentBranch, mainBranch: 'main',
    steps: [
      { key: 'plan', label: '版本计划', locked: false, reason: '' },
      { key: 'link', label: '关联条目与提交', locked: false, reason: '' },
      { key: 'docs', label: '文档编写', locked: false, reason: '' },
      { key: 'merge', label: '合并入 main', locked: mergeLocked, reason },
      { key: 'release', label: '正式发布', locked: false, reason: '' },
    ],
    docs: { files: [], overall: mergeLocked ? 'none' : 'committed', reasons: [] },
    mergeAnalysis: { perItem: [], blocked: [], notes: [] },
  };
}

const DOCS_REASON = '文档尚未编写提交（合并前置：所需文档已完成且最新变化已提交）';
const NOITEMS_REASON = '暂无关联条目：请先在「关联条目与提交」步骤关联';
const PUSHED_REASON = '已正式发布，不可再合并（如需调整请新建版本）';
const BUSY_REASON = '合并中，请勿重复触发';
const GONE_REASON = '未找到该版本（可能已被删除）：请刷新页面后重试';
const NOT_DEV_MAIN = '当前分支是 main，不在 dev：请自行切换回 dev 后重试（不自动切分支）';

function setup({ versions, plans = {}, mergeRespond = null } = {}) {
  const state = { initialized: true, isRepo: true, currentBranch: 'dev', versions };
  const toasts = [];
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
    toast: (m, isErr) => { toasts.push({ m: String(m), isErr: !!isErr }); }, // BUG-20260920-006：捕获点击反馈 toast
    fetch: async (url, opts = {}) => {
      const up = new URL(String(url), 'http://local');
      if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(state)) };
      if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => ({ items: [] }) };
      if (up.pathname === '/api/build/publish-plan') {
        const id = up.searchParams.get('id');
        const p = plans[id];
        if (!p) return { ok: true, json: async () => plan() }; // 未配置按可合并装配（dev + 门禁开放）
        return { ok: true, json: async () => JSON.parse(JSON.stringify(p)) };
      }
      if (up.pathname === '/api/build/version/merge') {
        const body = opts.body ? JSON.parse(opts.body) : {};
        if (mergeRespond) return mergeRespond(body);
        return { ok: true, json: async () => ({ version: { ...ver(body.id, body.id, 'merged'), status: 'merged', merge: { mainSha: H1, replays: [] } } }) };
      }
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  const tick = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  return {
    sandbox, state, toasts,
    run: (code) => vm.runInContext(code, sandbox),
    inner: () => vm.runInContext(`document.querySelector('#buildView').innerHTML`, sandbox),
    enter: async () => { await vm.runInContext(`window.ATBBuild.enter('/p/a')`, sandbox); },
    tick,
    // 选中版本并进入「合并入 main」步（等待五步装配加载完成）
    detailAt: async (id) => {
      vm.runInContext(`window.ATBBuild.selectVersion(${JSON.stringify(id)})`, sandbox);
      vm.runInContext(`window.ATBBuild.setStep('merge')`, sandbox);
      await tick();
    },
  };
}

const baseVersions = () => [
  ver('BLD-OK', '可合并'),
  ver('BLD-DOCS', '文档未提交'),
  ver('BLD-NOITEMS', '暂无关联条目'),
  ver('BLD-MAIN', '不在 dev'),
  ver('BLD-MERGING', '合并中', 'merging'),
  ver('BLD-PUSHED', '已发布', 'merged', { released: true }),
];

const basePlans = () => ({
  'BLD-OK': plan(),
  'BLD-DOCS': plan({ mergeLocked: true, reason: DOCS_REASON }),
  'BLD-NOITEMS': plan({ mergeLocked: true, reason: NOITEMS_REASON }),
  'BLD-MAIN': plan({ currentBranch: 'main' }),
  'BLD-MERGING': plan({ mergeLocked: true, reason: '合并执行中' }),
  'BLD-PUSHED': plan({ mergeLocked: true, reason: PUSHED_REASON }),
});

// 详情步面板内主按钮（REQ-20260921-016 列表卡片合并键移除后为唯一合并入口：btn primary、
// 位于 bld-merge-pane 内）
function detailBtn(inner, id) {
  const i = inner.indexOf('bld-merge-pane');
  assert.ok(i >= 0, '应渲染合并步面板');
  const seg = inner.slice(i, i + 6000);
  const j = seg.indexOf(`data-ver-merge="${id}"`);
  return j >= 0 ? seg.slice(j, seg.indexOf('</button>', j)) : '';
}

t('M1 详情页主按钮五状态 title 归因准确：aria-disabled 且与真实原因一一对应，不再回落「前置条件未满足」', async () => {
  const h = setup({ versions: baseVersions(), plans: basePlans() });
  await h.enter();
  const expect = [
    ['BLD-DOCS', DOCS_REASON],
    ['BLD-NOITEMS', NOITEMS_REASON],
    ['BLD-MAIN', NOT_DEV_MAIN],
    ['BLD-MERGING', BUSY_REASON],
    ['BLD-PUSHED', PUSHED_REASON],
  ];
  for (const [id, reason] of expect) {
    await h.detailAt(id);
    const btn = detailBtn(h.inner(), id);
    assert.ok(btn, `${id} 详情步应有主按钮`);
    assert.match(btn, new RegExp(`aria-disabled="true" title="${reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), `${id} 禁用 title 应为真实原因「${reason}」`);
    assert.doesNotMatch(btn, /前置条件未满足/, `${id} 不再误显「前置条件未满足」`);
    assert.doesNotMatch(btn, /\sdisabled(=|\s|>)/, `${id} 不再用 HTML disabled（点击可被捕获）`);
  }
});

t('M2 可合并状态零回归：详情主按钮可用（无 aria-disabled；REQ-20260921-016 后为唯一合并入口），点击打开确认弹窗', async () => {
  const h = setup({ versions: baseVersions(), plans: basePlans() });
  await h.enter();
  await h.detailAt('BLD-OK');
  const inner = h.inner();
  const d = detailBtn(inner, 'BLD-OK');
  assert.ok(d && !/aria-disabled/.test(d), '可合并时详情主按钮可用');
  h.run(`window.ATBBuild.openMergeConfirm('BLD-OK')`);
  assert.match(h.inner(), /合并入 main 确认（BLD-OK）/, '可合并版本点击 → 确认弹窗（链路零回归）');
  assert.deepEqual(h.toasts.filter((x) => x.m.includes('合并')), [], '可合并路径不产生拦截 toast');
});

t('M3 点击必反馈：不可合并状态点击入口 → 错误 toast 给出真实原因，不弹确认框', async () => {
  const h = setup({ versions: baseVersions(), plans: basePlans() });
  await h.enter();
  await h.detailAt('BLD-DOCS');
  h.run(`window.ATBBuild.openMergeConfirm('BLD-DOCS')`);
  assert.doesNotMatch(h.inner(), /合并入 main 确认（BLD-DOCS）/, '文档未提交不弹确认框');
  assert.ok(h.toasts.some((x) => x.m === DOCS_REASON && x.isErr), '点击反馈 toast 为真实文档门禁原因（错误样式）');
  h.toasts.length = 0;
  await h.detailAt('BLD-MAIN');
  h.run(`window.ATBBuild.openMergeConfirm('BLD-MAIN')`);
  assert.ok(h.toasts.some((x) => x.m === NOT_DEV_MAIN && x.isErr), '不在 dev 点击反馈 toast 带真实分支原因');
  h.toasts.length = 0;
  h.run(`window.ATBBuild.openMergeConfirm('BLD-MERGING')`);
  assert.ok(h.toasts.some((x) => x.m === BUSY_REASON && x.isErr), 'merging 点击反馈 toast 勿重复触发');
  h.toasts.length = 0;
  h.run(`window.ATBBuild.openMergeConfirm('BLD-PUSHED')`);
  assert.ok(h.toasts.some((x) => x.m === PUSHED_REASON && x.isErr), '已正式发布点击反馈 toast');
  h.toasts.length = 0;
  h.run(`window.ATBBuild.openMergeConfirm('BLD-GONE')`);
  assert.ok(h.toasts.some((x) => x.m === GONE_REASON && x.isErr), '版本不存在（竞态残留 DOM）点击反馈刷新提示，不再静默');
});

t('M4 唯一入口口径（REQ-20260921-016 列表卡片合并键移除后合并步主按钮为唯一入口）：各状态禁用 title 与真实原因一一对应；计划无关态（merging / 已正式发布）同样生效', async () => {
  const h = setup({ versions: baseVersions(), plans: basePlans() });
  await h.enter();
  for (const [id, reason] of [['BLD-DOCS', DOCS_REASON], ['BLD-MAIN', NOT_DEV_MAIN]]) {
    await h.detailAt(id);
    const inner = h.inner();
    const c = detailBtn(inner, id);
    assert.ok(c, `${id} 合并步应有主按钮`);
    assert.match(c, /aria-disabled="true"/, `${id} 主按钮同口径禁用`);
    assert.match(c, new RegExp(`title="${reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), `${id} 主按钮 title 为真实原因`);
    assert.doesNotMatch(c, /\sdisabled(=|\s|>)/, `${id} 主按钮不用 HTML disabled`);
  }
  // 计划无关三态（merging / 已正式发布）在任何版本上都生效（mergeBlockReason 先于装配检查）
  for (const [id, title] of [['BLD-MERGING', BUSY_REASON], ['BLD-PUSHED', PUSHED_REASON]]) {
    await h.detailAt(id);
    assert.match(detailBtn(h.inner(), id), new RegExp(`aria-disabled="true" title="${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), `${id} 主按钮禁用与 title 口径`);
  }
  // 列表卡片不再渲染合并入口（REQ-20260921-016 精简，防口径回流的静态位）
  const h2 = setup({ versions: baseVersions() }); // 无 publish-plan 配置
  await h2.enter();
  const cards = h2.inner().slice(h2.inner().indexOf('rel-list'), h2.inner().indexOf('rel-detail'));
  assert.ok(!cards.includes('data-ver-merge'), '卡片不再渲染合并键（唯一入口在详情合并步）');
});

t('M5 合并执行中（mergeBusy）：执行期间两入口禁用 + 勿重复触发 title，再次点击守卫 toast，完成后恢复', async () => {
  let release = null;
  const gate = new Promise((r) => { release = r; });
  const h = setup({
    versions: [ver('BLD-OK', '可合并'), ver('BLD-OK2', '第二个可合并')],
    plans: { 'BLD-OK': plan(), 'BLD-OK2': plan() },
    mergeRespond: async () => { await gate; return { ok: true, json: async () => ({ version: { ...ver('BLD-OK', '可合并', 'merged'), status: 'merged', merge: { mainSha: H1, replays: [] } } }) }; },
  });
  await h.enter();
  await h.detailAt('BLD-OK');
  h.run(`window.ATBBuild.openMergeConfirm('BLD-OK')`);
  h.run(`window.ATBBuild.doMerge()`); // 不 await：挂在门上，保持 mergeBusy
  await h.tick();
  const inner = h.inner();
  assert.match(detailBtn(inner, 'BLD-OK') || '', /aria-disabled="true" title="合并中，请勿重复触发"/, '执行期间详情主按钮（选中版本）禁用 + 勿重复触发 title（真实原因，非「前置条件未满足」）');
  // 执行中切换到另一版本（REQ-20260921-016 后合并步主按钮为唯一入口）：同样禁用 + 同因 title
  await h.detailAt('BLD-OK2');
  assert.match(detailBtn(h.inner(), 'BLD-OK2'), /aria-disabled="true" title="合并中，请勿重复触发"/, '执行期间另一版本主按钮禁用 + 同因 title');
  // 执行中点击另一版本入口：守卫 toast，不弹确认框
  h.run(`window.ATBBuild.openMergeConfirm('BLD-OK2')`);
  assert.doesNotMatch(h.inner(), /合并入 main 确认（BLD-OK2）/, '执行中不开新确认框');
  assert.ok(h.toasts.some((x) => x.m === BUSY_REASON && x.isErr), '执行中点击反馈勿重复触发 toast');
  h.toasts.length = 0;
  // 执行中再触发确认合并（防御路径）：toast 而非静默
  h.run(`window.ATBBuild.doMerge()`);
  assert.ok(h.toasts.some((x) => x.m === BUSY_REASON), 'doMerge 执行中守卫不再静默');
  release();
  await h.tick(4);
  assert.ok(h.toasts.some((x) => x.m === '✓ 已合并入 main（BLD-OK）'), '合并成功 toast 维持');
  await h.detailAt('BLD-OK2');
  const after = detailBtn(h.inner(), 'BLD-OK2');
  assert.ok(after && !/aria-disabled/.test(after), '合并完成后主按钮恢复可用');
});

t('M6 doMerge 版本不存在守卫：确认后版本被删（刷新后残留触发）→ 提示刷新而非静默', async () => {
  const h = setup({ versions: [ver('BLD-OK', '可合并'), ver('BLD-B', '保留')], plans: { 'BLD-OK': plan(), 'BLD-B': plan() } });
  await h.enter();
  h.run(`window.ATBBuild.openMergeConfirm('BLD-OK')`);
  assert.match(h.inner(), /合并入 main 确认（BLD-OK）/, '确认框已打开');
  // 另一标签页删除该版本 → 本页刷新（列表已无 BLD-OK）→ 残留触发确认
  h.state.versions = h.state.versions.filter((v) => v.id !== 'BLD-OK');
  await h.run(`window.ATBBuild.refresh()`);
  h.run(`window.ATBBuild.doMerge()`);
  assert.ok(h.toasts.some((x) => x.m === GONE_REASON && x.isErr), 'doMerge 版本不存在守卫 toast 刷新提示');
});

t('M7 i18n：新增 title / toast 文案中英同步（静态 + 动态分支句），t() 命中英文', async () => {
  await import('../web/i18n.js');
  const { EN, EN_DYNAMIC } = globalThis.ATBI18N._dict;
  for (const k of [BUSY_REASON, NOITEMS_REASON, PUSHED_REASON, GONE_REASON, DOCS_REASON,
    '文档有未提交修改，不得合并（请先提交文档）',
    '发布范围已变化，文档需重新核对 / 编写并重新提交',
    '当前处于 detached HEAD，不在 dev：请自行切换回 dev 后重试（不自动切分支）',
    '前置条件未满足']) {
    assert.ok(EN[k], `EN 缺词条：${k}`);
  }
  assert.ok(EN_DYNAMIC['当前分支是 ◇，不在 dev：请自行切换回 dev 后重试（不自动切分支）'], 'EN_DYNAMIC 缺「当前分支是 ◇ 不在 dev」动态键');
  assert.ok(!('当前处于 detached HEAD，不在 dev：请自行切换回 dev 后重试（不自动切分支）' in EN_DYNAMIC), '无插值的 detached HEAD 句应在静态 EN（i18n-dict 动态键须含 ◇）');
  const { t } = globalThis.ATBI18N;
  const saved = globalThis.ATBI18N.getLang();
  globalThis.ATBI18N.setLang('en');
  try {
    assert.equal(t(NOT_DEV_MAIN), 'Current branch is main, not dev: switch back to dev yourself and retry (no automatic branch switch)', '分支句应译为英文（插值分支名）');
    assert.equal(t(BUSY_REASON), 'Merging in progress — do not trigger again', '勿重复触发词条译为英文');
  } finally {
    globalThis.ATBI18N.setLang(saved);
  }
  assert.equal(t(NOT_DEV_MAIN), NOT_DEV_MAIN, '中文界面原文保持');
});

t('S1 静态契约：mergeBlockReason 由详情主按钮与守卫共用；合并按钮不再输出 HTML disabled；CSS 禁用样式覆盖 aria-disabled', () => {
  const reasonFn = buildJs.match(/function mergeBlockReason\(v\) \{[\s\S]*?\n  \}/);
  assert.ok(reasonFn, '缺少 mergeBlockReason');
  // REQ-20260921-016：列表卡片合并键移除，renderVersionList 不再调用 mergeBlockReason
  const listFn = buildJs.match(/function renderVersionList\(\) \{[\s\S]*?\n  \}/);
  assert.ok(listFn, '缺少 renderVersionList');
  assert.ok(!listFn[0].includes('data-ver-merge'), 'renderVersionList 不再渲染合并键（REQ-20260921-016）');
  const mergePane = buildJs.match(/function renderMergePane\(v\) \{[\s\S]*?\n  \}/);
  assert.ok(mergePane, '缺少 renderMergePane');
  assert.match(mergePane[0], /mergeBlockReason\(v\)/, '详情主按钮共用 mergeBlockReason');
  assert.match(mergePane[0], /aria-disabled="true"/, '详情主按钮以 aria-disabled 呈现禁用');
  // data-ver-merge 按钮模板不再拼 HTML disabled（合并步模板，REQ-20260921-016 后唯一模板）
  const btnTpls = [...buildJs.matchAll(/data-ver-merge="\$\{esc\(v\.id\)\}"[\s\S]{0,220}?<\/button>/g)].map((m) => m[0]);
  assert.ok(btnTpls.length >= 1, '应找到合并按钮模板');
  for (const tpl of btnTpls) assert.doesNotMatch(tpl, /\sdisabled/, '合并按钮模板不输出 HTML disabled');
  assert.match(buildJs, /openMergeConfirm[\s\S]{0,400}?mergeBlockReason\(v\)/, 'openMergeConfirm 守卫引用真实原因');
  assert.match(buildJs, /async function doMerge\(\) \{[\s\S]{0,600}?(state\.mergeBusy|GONE|未找到该版本)/, 'doMerge 守卫补反馈');
  assert.match(styleCss, /\.btn\[aria-disabled="true"\]/, '.btn 禁用样式覆盖 aria-disabled（点击可捕获仍呈禁用视觉）');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
