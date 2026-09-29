#!/usr/bin/env node
// BUG-20260928-005 推送完成即判定已正式发布并锁定范围，未以用户点击发布按钮并二次确认为准 ——
// 正式发布判定换基准：release.confirmedAt（发布按钮二次确认后一键发布链路 start 落账）才锁定；
// 推送（pushedAt）只落推送事实，不锁定。D1~D4 数据层 / 五步门禁 / 发布链路接线；
// U1 前端 vm 行为（released 键驱动锁定，推送不锁）；I1 i18n。
// 用法：node scripts/tests/bug-20260928-005.test.mjs

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

function mkData() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bug-20260928-005-'));
  core.initData(tmp);
  return tmp;
}

const itemOf = (id, commit, title = `标题 ${id}`) => ({ itemId: id, commit, title });
const conflict = (re) => (e) => e instanceof buildStore.BuildConflictError && re.test(e.message);

function mergedVersion(dataDir, id = 'REQ-20260928-005') {
  const v = buildStore.createVersion(dataDir, { items: [itemOf(id, H1)] });
  buildStore.beginMerge(dataDir, v.id, { baseBranch: 'dev' });
  return buildStore.finishMerge(dataDir, v.id, { results: [{ itemId: id, ok: true }] });
}

/* ---------- D1~D4 数据层 / 五步门禁 / 发布链路接线 ---------- */

t('D1 推送不锁定：recordPushSuccess 后增删 / 重开合并 / 语言集 / 自定义文档全可用；发布确认后才按「已正式发布」锁定', () => {
  const dataDir = core.dataDirFrom(mkData());
  const v = mergedVersion(dataDir);
  // 仅推送（动作一 push / 任何途径使 pushedAt 落账）——不构成正式发布，范围操作全部可用
  buildStore.recordPushSuccess(dataDir, v.id, { remote: 'origin', sha: H1 });
  assert.ok(buildStore.readVersion(dataDir, v.id).release.pushedAt, '推送事实照常落账');
  let out = buildStore.addItems(dataDir, v.id, [itemOf('BUG-20260928-005', H2)]);
  assert.equal(out.items.length, 2, '已推送未确认可补关联条目');
  out = buildStore.saveDocLangs(dataDir, v.id, { langs: ['zh', 'en'] });
  assert.deepEqual(out.langs, ['zh', 'en'], '已推送未确认可改文档语言集');
  out = buildStore.addCustomDoc(dataDir, v.id, { name: 'MIGRATION' });
  assert.deepEqual(out.customDocs, ['MIGRATION'], '已推送未确认可加自定义文档');
  const m = buildStore.beginMerge(dataDir, v.id, { baseBranch: 'dev' });
  assert.equal(m.status, 'merging', '已推送未确认可重开合并（增量）');
  buildStore.finishMerge(dataDir, v.id, { results: [{ itemId: 'BUG-20260928-005', ok: true }] });
  // 发布按钮 + 二次确认（一键发布链路 start）→ recordReleaseConfirm 落账 → 正式发布锁定
  buildStore.recordReleaseConfirm(dataDir, v.id, { runId: 'BPUB-test-run' });
  assert.throws(() => buildStore.addItems(dataDir, v.id, [itemOf('REQ-20260928-006', H2)]), conflict(/正式发布/), '确认后增条目应 409 冲突');
  assert.throws(() => buildStore.removeItems(dataDir, v.id, ['REQ-20260928-005']), conflict(/正式发布/), '确认后移出条目应 409 冲突');
  assert.throws(() => buildStore.saveDocLangs(dataDir, v.id, { langs: ['zh'] }), conflict(/正式发布/), '确认后改语言集应 409 冲突');
  assert.throws(() => buildStore.addCustomDoc(dataDir, v.id, { name: 'SECURITY' }), conflict(/正式发布/), '确认后加自定义文档应 409 冲突');
  assert.throws(() => buildStore.beginMerge(dataDir, v.id, { baseBranch: 'dev' }), conflict(/正式发布/), '确认后重开合并应 409 冲突');
});

t('D2 recordReleaseConfirm 幂等：首次确认时点固化（重试 / 再发布不重置）；merging 锁不回归', () => {
  const dataDir = core.dataDirFrom(mkData());
  const v = mergedVersion(dataDir);
  const c1 = buildStore.recordReleaseConfirm(dataDir, v.id, { runId: 'BPUB-first' });
  const at = c1.release.confirmedAt;
  assert.ok(at, '确认时点落账');
  assert.equal(c1.release.confirmedRunId, 'BPUB-first', '确认运行编号落账');
  // 等待跨毫秒后重复确认（重试 / 取消后再发布）：首次确认为准
  const later = new Date(Date.parse(at) + 5000).toISOString();
  const c2 = buildStore.recordReleaseConfirm(dataDir, v.id, { runId: 'BPUB-second' });
  assert.equal(c2.release.confirmedAt, at, '重复确认不重置时点');
  assert.equal(c2.release.confirmedRunId, 'BPUB-first', '重复确认不换运行编号');
  assert.notEqual(later, at);
  // merging 锁（回归）：与正式发布锁分别报合并中
  const v2 = buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260928-007', H1)] });
  buildStore.beginMerge(dataDir, v2.id, { baseBranch: 'dev' });
  assert.throws(() => buildStore.addItems(dataDir, v2.id, [itemOf('REQ-20260928-008', H2)]), conflict(/合并中/), 'merging 锁增不回归');
  assert.throws(() => buildStore.recordReleaseConfirm(dataDir, 'BLD-20990101-001', { runId: 'x' }), /找不到版本计划/, '未知版本报错');
});

t('D3 五步门禁换基准：仅 pushedAt 不锁 docs/docmerge/merge；confirmedAt 才锁并说明已正式发布；release 步不回锁', () => {
  const items = [{ itemId: 'REQ-20260928-005', commit: H1 }];
  const mk = (over = {}) => ({ status: 'merged', items, docs: null, ...over });
  const by = (steps, k) => steps.find((s) => s.key === k);
  // 仅推送（未确认）：docs / docmerge / merge 全放开
  let steps = flow.publishStepsState(mk({ release: { pushedAt: '2026-09-28T01:00:00.000Z', pushedSha: H1 } }), { overall: 'committed' });
  assert.ok(!by(steps, 'docs').locked, '已推送未确认可进入「文档与翻译」');
  assert.ok(!by(steps, 'docmerge').locked, '已推送未确认可进入「文档合并」');
  assert.ok(!by(steps, 'merge').locked, '已推送未确认可重开合并');
  // 发布确认后：docs / docmerge / merge 锁定并说明已正式发布；release 步仍可进入（查看结果）
  steps = flow.publishStepsState(mk({ release: { pushedAt: '2026-09-28T01:00:00.000Z', pushedSha: H1, confirmedAt: '2026-09-28T02:00:00.000Z' } }), { overall: 'committed' });
  assert.ok(by(steps, 'docs').locked && /正式发布/.test(by(steps, 'docs').reason), '确认后 docs 锁定说明已正式发布');
  assert.ok(by(steps, 'docmerge').locked && /正式发布/.test(by(steps, 'docmerge').reason), '确认后 docmerge 锁定说明已正式发布');
  assert.ok(by(steps, 'merge').locked && /正式发布/.test(by(steps, 'merge').reason), '确认后 merge 锁定说明已正式发布');
  assert.ok(!by(steps, 'release').locked, '确认后 release 步仍可进入（查看发布结果）');
  // 未推送未确认：release 步门禁不回归（文档合并落账为准）
  steps = flow.publishStepsState(mk(), { overall: 'committed' });
  assert.ok(by(steps, 'release').locked && /文档合并/.test(by(steps, 'release').reason), '未确认 release 仍以文档合并为门禁');
  // merging 回归：合并执行中锁定
  steps = flow.publishStepsState(mk({ status: 'merging' }), { overall: 'committed' });
  assert.ok(by(steps, 'docs').locked && /合并执行中/.test(by(steps, 'docs').reason), 'merging 锁 docs 不回归');
});

t('D4 一键发布链路接线：build-publish.start 在运行置 running 时落发布确认（recordReleaseConfirm），推送管线不落 pushedAt 锁', async () => {
  const src = fs.readFileSync(path.join(pluginRoot, 'scripts', 'lib', 'build-publish.mjs'), 'utf8');
  assert.match(src, /from '\.\/build-store\.mjs'/, 'build-publish 应引入 build-store');
  const iRunning = src.indexOf("r.status='running'");
  const iConfirm = src.indexOf('recordReleaseConfirm');
  const iDone = src.indexOf("r.status='succeeded'");
  assert.ok(iRunning >= 0, 'start 内应存在置 running 的落账');
  assert.ok(iConfirm > iRunning, '置 running 后应调用 recordReleaseConfirm（二次确认即正式发布口径）');
  // REQ-20260929-002：发布收敛为状态更新——确认落账成功后运行直接置终态 succeeded（无执行阶段）
  assert.ok(iDone > iConfirm, '确认落账成功后运行置 succeeded');
  // 服务端守卫与 state 装配换用 isReleased（不再用 isPushed 判定正式发布）；
  // BUG-20260928-015 起 isReleased 增传数据目录（读取侧兜底：确认运行失败 / 取消不判已发布）
  const serverSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');
  assert.ok(!/isPushed/.test(serverSrc), 'server 不再以 isPushed 判定正式发布');
  assert.match(serverSrc, /isReleased\(v,\s*dataDir\)/, 'state 装配透出 released（isReleased，BUG-20260928-015 起带兜底目录参）');
});

/* ---------- U1 前端 vm 行为 ---------- */

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
    id, name, description: `描述 ${name}`, status, targetBranch: 'main', released: false,
    items: [{ itemId: 'REQ-20260928-005', commit: H1, title: '演示需求', mergedAt: status === 'merged' ? '2026-09-28T03:00:00.000Z' : null, mergeError: null }],
    createdAt: '2026-09-28T01:00:00.000Z', updatedAt: '2026-09-28T02:00:00.000Z', merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' },
    ...extra,
  };
}

function setup({ versions = [], plans = {} } = {}) {
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
      if (up.pathname === '/api/build/publish-plan') {
        const plan = plans[up.searchParams.get('id')] || {};
        return { ok: true, json: async () => JSON.parse(JSON.stringify({ currentBranch: 'dev', mainBranch: 'main', steps: [], docs: { files: [], overall: 'none' }, mergeAnalysis: { perItem: [], blocked: [], notes: [] }, ...plan })) };
      }
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

t('U1 锁定键换 released：仅推送（无 released）增删 / 合并 / AI 完善可用；发布确认（released）后禁用并说明已正式发布', async () => {
  const h = await setup({ versions: [
    ver('BLD-MERGED', 'm1', 'merged'), // 未推送未确认
    ver('BLD-PUSHED', 'p1', 'merged', { released: false, release: { pushedAt: '2026-09-28T01:00:00.000Z' } }), // 已推送未确认（存量形态）
    ver('BLD-RELEASED', 'r1', 'merged', { released: true }), // 发布按钮二次确认后
  ] });
  await h.enter();
  const detailAt = (id) => {
    h.run(`window.ATBBuild.selectVersion(${JSON.stringify(id)}); window.ATBBuild.setStep('plan')`);
    return h.inner().slice(h.inner().indexOf('rel-detail'));
  };
  const mergeBtnAt = async (id) => {
    h.run(`window.ATBBuild.selectVersion(${JSON.stringify(id)}); window.ATBBuild.setStep('merge')`);
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
    const inner = h.inner();
    const j = inner.indexOf(`data-ver-merge="${id}"`);
    assert.ok(j >= 0, `${id} 合并步主按钮存在`);
    return inner.slice(inner.lastIndexOf('<button', j), inner.indexOf('</button>', j));
  };
  // 已推送未确认：与 merged 同口径放开（推送不锁定）
  assert.match(detailAt('BLD-PUSHED'), /data-ver-answer="BLD-PUSHED" aria-label/, '已推送未确认 AI 完善可用');
  assert.doesNotMatch(await mergeBtnAt('BLD-PUSHED'), /aria-disabled/, '已推送未确认合并主按钮可用');
  assert.doesNotMatch(detailAt('BLD-PUSHED'), /id="bldAddItem" disabled/, '已推送未确认添加条目可用');
  // 发布确认后：锁定并说明（文案与现状一致）
  assert.match(detailAt('BLD-RELEASED'), /data-ver-answer="BLD-RELEASED" disabled title="已正式发布，不允许再 AI 完善"/, '确认后 AI 完善禁用并说明');
  assert.match(await mergeBtnAt('BLD-RELEASED'), /aria-disabled="true" title="已正式发布，不可再合并（如需调整请新建版本）"/, '确认后合并主按钮禁用并说明');
  assert.match(detailAt('BLD-RELEASED'), /id="bldAddItem" disabled title="已正式发布，条目已锁定"/, '确认后添加条目禁用并说明');
  // 未推送未确认零回归
  assert.match(detailAt('BLD-MERGED'), /data-ver-answer="BLD-MERGED" aria-label/, 'merged 未推送 AI 完善可用（零回归）');
  assert.doesNotMatch(await mergeBtnAt('BLD-MERGED'), /aria-disabled/, 'merged 未推送合并可用（零回归）');
});

t('U2 REQ-20260929-002：发布步「动作一 · 推送远端 / 动作二 · 官网资料更新」区整体删除（源码远端推送与官网物料不再由构建模块发布步承担）', async () => {
  const pushRel = { pushedAt: '2026-09-28T01:00:00.000Z', pushedSha: H1, pushRemote: 'origin', site: { status: 'waiting' } };
  const h = await setup({
    versions: [
      ver('BLD-PUSHED', 'p1', 'merged', { released: false }),
      ver('BLD-RELEASED', 'r1', 'merged', { released: true }),
    ],
    plans: {
      'BLD-PUSHED': { release: { ...pushRel } },
      'BLD-RELEASED': { release: { ...pushRel, confirmedAt: '2026-09-28T02:00:00.000Z', confirmedRunId: 'BPUB-test' } },
    },
  });
  await h.enter();
  const releasePaneAt = async (id) => {
    h.run(`window.ATBBuild.selectVersion(${JSON.stringify(id)}); window.ATBBuild.setStep('release')`);
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
    return h.inner();
  };
  // 已推送未确认与已确认：发布步均不再渲染推送 / 官网动作区与「推送 ≠ 正式发布」说明
  for (const id of ['BLD-PUSHED', 'BLD-RELEASED']) {
    const pane = await releasePaneAt(id);
    assert.ok(!pane.includes('动作一 · 推送远端'), `${id} 发布步无动作一区`);
    assert.ok(!pane.includes('动作二 · 官网资料更新'), `${id} 发布步无动作二区`);
    assert.ok(!pane.includes('已推送到远端'), `${id} 发布步无推送事实展示`);
    assert.ok(!pane.includes('推送主分支'), `${id} 发布步无推送入口`);
    assert.ok(!pane.includes('推送完成不等于正式发布'), `${id} 发布步无「推送 ≠ 正式发布」说明`);
  }
});

/* ---------- I1 i18n ---------- */

t('I1 i18n 同步：推送 ≠ 正式发布说明句 EN 词条齐备；既有正式发布锁定词条不回归', async () => {
  await import('../web/i18n.js');
  const { EN } = globalThis.ATBI18N._dict;
  for (const zh of [
    '已正式发布，不允许再 AI 完善',
    '已正式发布，条目已锁定',
    '已正式发布，范围锁定（如需调整请新建版本）',
    '已正式发布，不可再合并（如需调整请新建版本）',
  ]) {
    assert.ok(zh in EN, `EN 词典应含「${zh}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN[zh]), `「${zh}」译文不含中文`);
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
