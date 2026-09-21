#!/usr/bin/env node
// BUG-20260920-005 已经合并入 main 的版本计划允许重新关联条目和提交 —— 锁定时机从
// 「merged（已合并入 main）」后移到「推送完成（正式发布，release.pushedAt）」。
// D1~D3 数据层 / 步骤门禁；U1~U3 前端 vm 行为（口径同 bug-build-ver-card-acts-20260913-004）；I1 i18n。
// 用法：node scripts/tests/bug-20260920-005.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as buildStore from '../lib/build-store.mjs';
import * as flow from '../lib/publish-flow.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(pluginRoot, 'scripts', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);
const H3 = 'c'.repeat(40);

function mkData() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bug-20260920-005-'));
  core.initData(tmp);
  return tmp;
}

const itemOf = (id, commit, title = `标题 ${id}`) => ({ itemId: id, commit, title });

const conflict = (re) => (e) => e instanceof buildStore.BuildConflictError && re.test(e.message);

/* ---------- D1~D3 数据层 / 步骤门禁 ---------- */

t('D1 条目锁基准后移：merged 未推送增删 / 换 commit 可用；推送完成后锁定并说明已正式发布；merging 不回归', () => {
  const dataDir = core.dataDirFrom(mkData());
  const v = buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260920-005', H1)] });
  buildStore.beginMerge(dataDir, v.id, { baseBranch: 'dev' });
  buildStore.finishMerge(dataDir, v.id, { results: [{ itemId: 'REQ-20260920-005', ok: true }] });
  // merged（已合并未推送）：补关联 / 换 commit / 移出全链路放开
  let out = buildStore.addItems(dataDir, v.id, [itemOf('BUG-20260920-005', H2)]);
  assert.equal(out.items.length, 2, 'merged 未推送可补关联条目');
  out = buildStore.setItemCommit(dataDir, v.id, 'BUG-20260920-005', H3);
  assert.equal(out.items.find((i) => i.itemId === 'BUG-20260920-005').commit, H3, 'merged 未推送可换 commit');
  out = buildStore.removeItems(dataDir, v.id, ['BUG-20260920-005']);
  assert.deepEqual(out.items.map((i) => i.itemId), ['REQ-20260920-005'], 'merged 未推送可移出条目（还原范围）');
  // 推送完成（正式发布）→ 条目操作锁定
  buildStore.recordPushSuccess(dataDir, v.id, { remote: 'origin', sha: H3 });
  assert.throws(() => buildStore.addItems(dataDir, v.id, [itemOf('BUG-20260920-005', H2)]), conflict(/正式发布/), '推送后增条目应 409 冲突');
  assert.throws(() => buildStore.removeItems(dataDir, v.id, ['REQ-20260920-005']), conflict(/正式发布/), '推送后移出应 409 冲突');
  assert.throws(() => buildStore.setItemCommit(dataDir, v.id, 'REQ-20260920-005', H2), conflict(/正式发布/), '推送后换 commit 应 409 冲突');
  // merging 维持锁定（回归）
  const v2 = buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260920-006', H1)] });
  buildStore.beginMerge(dataDir, v2.id, { baseBranch: 'dev' });
  assert.throws(() => buildStore.addItems(dataDir, v2.id, [itemOf('REQ-20260920-007', H2)]), conflict(/合并中/), 'merging 锁增不回归');
});

t('D2 合并锁基准后移：merged 未推送可重开合并（增量只补未合并条目、已合并 mergedAt 不动）；推送完成后拒绝', () => {
  const dataDir = core.dataDirFrom(mkData());
  const v = buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260920-005', H1)] });
  buildStore.beginMerge(dataDir, v.id, { baseBranch: 'dev' });
  const m1 = buildStore.finishMerge(dataDir, v.id, { results: [{ itemId: 'REQ-20260920-005', ok: true }] });
  assert.equal(m1.status, 'merged');
  const firstMergedAt = m1.items[0].mergedAt;
  // merged 未推送补入新条目后重开合并：只补未合并条目，已合并条目幂等不动
  buildStore.addItems(dataDir, v.id, [itemOf('BUG-20260920-005', H2)]);
  const m2 = buildStore.beginMerge(dataDir, v.id, { baseBranch: 'dev' });
  assert.equal(m2.status, 'merging', 'merged 未推送可重开合并');
  assert.throws(() => buildStore.beginMerge(dataDir, v.id, { baseBranch: 'dev' }), conflict(/合并中/), 'merging 不可重复发起');
  const m3 = buildStore.finishMerge(dataDir, v.id, { results: [{ itemId: 'BUG-20260920-005', ok: true }] });
  assert.equal(m3.status, 'merged', '补齐后回到 merged');
  assert.equal(m3.items.find((i) => i.itemId === 'REQ-20260920-005').mergedAt, firstMergedAt, '已合并条目 mergedAt 不动');
  assert.ok(m3.items.find((i) => i.itemId === 'BUG-20260920-005').mergedAt, '新条目落 mergedAt');
  // 推送完成（正式发布）→ 不可再合并
  buildStore.recordPushSuccess(dataDir, v.id, { remote: 'origin', sha: H3 });
  assert.throws(() => buildStore.beginMerge(dataDir, v.id, { baseBranch: 'dev' }), conflict(/正式发布/), '推送后不可再合并');
});

t('D3 五步门禁基准后移：merged 未推送 link/docs/merge 放开；推送完成后 link/docs 锁定并说明已正式发布；merging / draft 不回归', () => {
  const items = [{ itemId: 'REQ-20260920-005', commit: H1 }];
  const mk = (over = {}) => ({ status: 'draft', items, docs: null, ...over });
  const by = (steps, k) => steps.find((s) => s.key === k);
  // merged 未推送：文档已提交时四步全放开（待确认 2 默认：docs 锁定随后移）
  let steps = flow.publishStepsState(mk({ status: 'merged' }), { overall: 'committed' });
  assert.ok(!by(steps, 'link').locked, 'merged 未推送可进入「关联条目与提交」');
  assert.ok(!by(steps, 'docs').locked, 'merged 未推送可进入「文档编写」');
  assert.ok(!by(steps, 'merge').locked, 'merged 未推送可重开合并（文档已提交）');
  assert.ok(!by(steps, 'release').locked, 'release 维持 merged 可进入');
  // merged 未推送 + 范围变化（scopeStale）→ merge 被文档门禁拦（不放宽门禁）
  steps = flow.publishStepsState(mk({ status: 'merged' }), { overall: 'needs-rewrite' });
  assert.ok(by(steps, 'merge').locked && /重新/.test(by(steps, 'merge').reason), '范围过期仍锁合并');
  assert.ok(!by(steps, 'link').locked, '文档过期不回锁 link');
  // 推送完成（正式发布）→ link / docs / merge 锁定并说明
  steps = flow.publishStepsState(mk({ status: 'merged', release: { pushedAt: '2026-09-20T10:00:00.000Z', pushedSha: H1 } }), { overall: 'committed' });
  assert.ok(by(steps, 'link').locked && /正式发布/.test(by(steps, 'link').reason), 'link 锁定说明已正式发布');
  assert.ok(by(steps, 'docs').locked && /正式发布/.test(by(steps, 'docs').reason), 'docs 锁定说明已正式发布');
  assert.ok(by(steps, 'merge').locked && /正式发布/.test(by(steps, 'merge').reason), 'merge 锁定说明已正式发布');
  assert.ok(!by(steps, 'release').locked, '推送后 release 步仍可进入（查看推送与官网状态）');
  // merging 回归：link / docs / merge 锁定
  steps = flow.publishStepsState(mk({ status: 'merging' }), { overall: 'committed' });
  assert.ok(by(steps, 'link').locked && /合并执行中/.test(by(steps, 'link').reason), 'merging 锁 link 不回归');
  assert.ok(by(steps, 'docs').locked, 'merging 锁 docs 不回归');
  assert.ok(by(steps, 'merge').locked && /合并执行中/.test(by(steps, 'merge').reason), 'merging 锁 merge 不回归');
  // draft 回归：无条目锁 merge
  steps = flow.publishStepsState(mk({ items: [] }), { overall: 'none' });
  assert.ok(by(steps, 'merge').locked && /关联/.test(by(steps, 'merge').reason), 'draft 无条目仍锁 merge');
});

/* ---------- U1~U3 前端 vm 行为 ---------- */

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

function ver(id, name, status = 'draft', extra = {}) {
  return {
    id, name, description: `描述 ${name}`, status, targetBranch: 'main', pushed: false,
    items: [{ itemId: 'REQ-20260920-005', commit: H1, title: '演示需求', mergedAt: status === 'merged' ? '2026-09-20T03:00:00.000Z' : null, mergeError: status === 'failed' ? 'conflict' : null }],
    createdAt: '2026-09-20T01:00:00.000Z', updatedAt: '2026-09-20T02:00:00.000Z', merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' },
    ...extra,
  };
}

function setup({ versions = [ver('BLD-MERGED', 'm', 'merged'), ver('BLD-PUSHED', 'p', 'merged', { pushed: true })] } = {}) {
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
      // REQ-20260921-016：合并入口只剩详情「合并入 main」步主按钮（currentBranch=dev 与测试口径一致）
      if (up.pathname === '/api/build/publish-plan') return { ok: true, json: async () => ({ currentBranch: 'dev', mainBranch: 'main', steps: [], docs: { files: [], overall: 'none' }, mergeAnalysis: { perItem: [], blocked: [], notes: [] } }) };
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  return {
    sandbox, run: (code) => vm.runInContext(code, sandbox),
    inner: () => vm.runInContext(`document.querySelector('#buildView').innerHTML`, sandbox),
    enter: async () => { await vm.runInContext(`window.ATBBuild.enter('/p/a')`, sandbox); },
  };
}

t('U1 合并步主按钮 + 概况描述头 AI 完善（REQ-20260921-013 迁入详情概况、REQ-20260921-016 后合并入口在详情合并步）：merged 未推送两类可用；推送完成后禁用并说明已正式发布；merging / draft 不回归', async () => {
  const h = await setup({ versions: [
    ver('BLD-MERGED', 'm1', 'merged'),
    ver('BLD-PUSHED', 'p1', 'merged', { pushed: true }),
    ver('BLD-MERGING', 'm2', 'merging'),
    ver('BLD-DRAFT', 'd1', 'draft'),
    ver('BLD-FAILED', 'f1', 'failed'),
  ] });
  await h.enter();
  // 选中版本落概况步后取详情区断言（AI 完善入口迁移后位置）
  const detailAt = (id) => {
    h.run(`window.ATBBuild.selectVersion(${JSON.stringify(id)}); window.ATBBuild.setStep('plan')`);
    return h.inner().slice(h.inner().indexOf('rel-detail'));
  };
  // 选中版本落合并步后取主按钮片段（REQ-20260921-016 起列表卡片不再有合并键）
  const mergeBtnAt = async (id) => {
    h.run(`window.ATBBuild.selectVersion(${JSON.stringify(id)}); window.ATBBuild.setStep('merge')`);
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
    const inner = h.inner();
    const j = inner.indexOf(`data-ver-merge="${id}"`);
    assert.ok(j >= 0, `${id} 合并步主按钮存在`);
    return inner.slice(inner.lastIndexOf('<button', j), inner.indexOf('</button>', j));
  };
  assert.match(detailAt('BLD-MERGED'), /data-ver-answer="BLD-MERGED" aria-label/, 'merged 未推送 AI 完善可用（无 disabled）');
  assert.match(detailAt('BLD-MERGED'), /data-ver-answer="BLD-MERGED"[^>]*title="复制提示词给 Agent，回答直接粘贴回本弹窗自动解析"/, 'merged 未推送 AI 完善带可用 title');
  assert.doesNotMatch(await mergeBtnAt('BLD-MERGED'), /aria-disabled/, 'merged 未推送合并主按钮可用');
  assert.match(detailAt('BLD-PUSHED'), /data-ver-answer="BLD-PUSHED" disabled title="已正式发布，不允许再 AI 完善"/, '推送完成后 AI 完善禁用并说明');
  // BUG-20260920-006：合并键禁用从 HTML disabled 改 aria-disabled（点击可捕获反馈），title 升为完整归因
  assert.match(await mergeBtnAt('BLD-PUSHED'), /aria-disabled="true" title="已正式发布，不可再合并（如需调整请新建版本）"/, '推送完成后合并主按钮禁用并说明');
  assert.match(detailAt('BLD-MERGING'), /data-ver-answer="BLD-MERGING" disabled title="合并中，请稍候……"/, 'merging AI 完善口径不回归');
  assert.match(await mergeBtnAt('BLD-MERGING'), /aria-disabled="true" title="合并中，请勿重复触发"/, 'merging 合并主按钮口径不回归');
  assert.match(detailAt('BLD-DRAFT'), /data-ver-answer="BLD-DRAFT" aria-label/, 'draft 零回归');
  assert.match(await mergeBtnAt('BLD-FAILED'), />重试合并入 main$/, 'failed 零回归（重试合并入 main）');
});

t('U2 AI 完善弹窗防御路径：推送完成后直调 / 无参回落均不弹窗；merged 未推送可完整打开', async () => {
  const h = await setup();
  await h.enter(); // selVerId 自动选中首个 BLD-MERGED
  h.run(`window.ATBBuild.openAnswerModal('BLD-MERGED')`);
  assert.match(h.inner(), /AI 完善（BLD-MERGED）/, 'merged 未推送直调可打开弹窗');
  h.run(`window.ATBBuild.openAnswerModal('BLD-PUSHED')`);
  assert.doesNotMatch(h.inner(), /AI 完善（BLD-PUSHED）/, '推送完成后直调不弹窗');
  h.run(`window.ATBBuild.selectVersion('BLD-PUSHED')`);
  h.run(`window.ATBBuild.openAnswerModal()`);
  assert.doesNotMatch(h.inner(), /AI 完善（BLD-PUSHED）/, '推送完成后无参回落不弹窗（防御路径同口径）');
});

t('U3 详情「关联条目与提交」步：merged 未推送增删 / 换 commit 可用；推送完成后禁用并说明已正式发布', async () => {
  const h = await setup();
  await h.enter(); // 选中 BLD-MERGED
  h.run(`window.ATBBuild.setStep('link')`);
  let inner = h.inner();
  assert.match(inner, /id="bldAddItem"\s*>＋ 添加条目/, 'merged 未推送「＋ 添加条目」可用');
  assert.doesNotMatch(inner, /id="bldAddItem" disabled/, 'merged 未推送添加条目不再禁用');
  assert.doesNotMatch(inner, /data-remove-item="REQ-20260920-005" disabled/, 'merged 未推送移出可用');
  // BUG-20260921-015：条目行改为展示全部提交（chips，title 说明），锁定态经 title 说明体现
  assert.match(inner, /title="该条目关联的全部提交"/, 'merged 未推送提交清单可用（无锁定说明）');
  h.run(`window.ATBBuild.selectVersion('BLD-PUSHED')`);
  h.run(`window.ATBBuild.setStep('link')`);
  inner = h.inner();
  assert.match(inner, /id="bldAddItem" disabled title="已正式发布，条目已锁定"/, '推送完成后添加条目禁用并说明');
  assert.match(inner, /data-remove-item="REQ-20260920-005" disabled title="已正式发布，条目已锁定"/, '推送完成后移出禁用并说明');
  assert.match(inner, /该条目关联的全部提交（已正式发布，条目已锁定）/, '推送完成后提交清单锁定并说明');
});

/* ---------- I1 i18n ---------- */

t('I1 i18n 同步：新增锁定文案 EN 词条齐备；旧「已合并入 main，不允许再 AI 完善」词条随口径清理', async () => {
  await import('../web/i18n.js');
  const { EN } = globalThis.ATBI18N._dict;
  for (const zh of [
    '已正式发布，不允许再 AI 完善',
    '已正式发布',
    '已正式发布，条目已锁定',
    '已正式发布，范围锁定（如需调整请新建版本）',
    '已正式发布，不可再合并（如需调整请新建版本）',
    '合并中，条目不可增删',
  ]) {
    assert.ok(zh in EN, `EN 词典应含「${zh}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN[zh]), `「${zh}」译文不含中文`);
  }
  assert.ok(!('已合并入 main，不允许再 AI 完善' in EN), '旧 merged 禁用词条应清理（口径已后移到推送完成）');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
