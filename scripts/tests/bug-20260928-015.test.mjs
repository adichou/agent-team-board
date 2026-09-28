#!/usr/bin/env node
// BUG-20260928-015 发布运行失败后确认锁不回滚：计划被误锁为已发布、无法调整范围与重新提交 ——
// 引入来源 BUG-20260928-005（recordReleaseConfirm 幂等固化首次确认，失败 / 取消不回滚）。
// 双层修复：W1 写侧 rollbackReleaseConfirm（失败 / 取消终态清除确认锁，成功不可逆）；
// R1 读取侧 isReleased 兜底（confirmedRunId 对应运行 failed / canceled 视为未确认，
// 账本缺失保守判已发布）；R2 存量计划范围操作恢复；T1 重试 = 最近一次有效确认；
// G1 五步门禁 released 覆盖参；J1 发布链路 / 服务端接线。
// 用法：node scripts/tests/bug-20260928-015.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as buildStore from '../lib/build-store.mjs';
import * as flow from '../lib/publish-flow.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);

function mkData() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bug-20260928-015-'));
  core.initData(tmp);
  return core.dataDirFrom(tmp);
}

const itemOf = (id, commit, title = `标题 ${id}`) => ({ itemId: id, commit, title });
const conflict = (re) => (e) => e instanceof buildStore.BuildConflictError && re.test(e.message);

function mergedVersion(dataDir, id = 'REQ-20260928-015') {
  const v = buildStore.createVersion(dataDir, { items: [itemOf(id, H1)] });
  buildStore.beginMerge(dataDir, v.id, { baseBranch: 'dev' });
  return buildStore.finishMerge(dataDir, v.id, { results: [{ itemId: id, ok: true }] });
}

// 发布运行账本：<dataDir>/runtime/builds/publish-runs/<runId>/run.json（status 为发布运行终态）。
function mkRun(dataDir, runId, status) {
  const dir = path.join(dataDir, 'runtime', 'builds', 'publish-runs', runId);
  fs.mkdirSync(dir, { recursive: true });
  const run = { id: runId, bldId: 'BLD-TEST', version: '1.0.0', status, createdAt: '2026-09-28T14:00:00.000Z', updatedAt: '2026-09-28T15:00:00.000Z', stages: [], logs: [] };
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run));
  return run;
}

// 确认 + 推送事实齐备的版本（模拟「点击发布并通过二次确认」后的计划形态）。
function confirmedVersion(dataDir, runId) {
  const v = mergedVersion(dataDir);
  buildStore.recordPushSuccess(dataDir, v.id, { remote: 'origin', sha: H1 });
  buildStore.recordReleaseConfirm(dataDir, v.id, { runId });
  return buildStore.readVersion(dataDir, v.id);
}

/* ---------- W1 写侧回退：rollbackReleaseConfirm ---------- */

t('W1 失败 / 取消终态回退确认锁（保留推送事实）；succeeded / 运行不匹配 / 账本缺失不回退', () => {
  for (const status of ['failed', 'canceled']) {
    const dataDir = mkData();
    const v = confirmedVersion(dataDir, 'BPUB-run-fail');
    mkRun(dataDir, 'BPUB-run-fail', status);
    const out = buildStore.rollbackReleaseConfirm(dataDir, v.id, { runId: 'BPUB-run-fail' });
    assert.ok(!out.release.confirmedAt && !out.release.confirmedRunId, `${status} 终态应清除确认锁`);
    assert.equal(out.release.pushedAt, v.release.pushedAt, `${status} 回退保留推送事实 pushedAt`);
    assert.equal(out.release.pushedSha, H1, `${status} 回退保留推送事实 pushedSha`);
    assert.ok(out.release.site, `${status} 回退保留 site 推送证据`);
    assert.equal(buildStore.isReleased(buildStore.readVersion(dataDir, v.id), dataDir), false, `${status} 回退后 isReleased 为假`);
  }
  // 成功不可逆：succeeded 运行不回退
  {
    const dataDir = mkData();
    const v = confirmedVersion(dataDir, 'BPUB-run-ok');
    mkRun(dataDir, 'BPUB-run-ok', 'succeeded');
    const out = buildStore.rollbackReleaseConfirm(dataDir, v.id, { runId: 'BPUB-run-ok' });
    assert.ok(out.release.confirmedAt, 'succeeded 运行确认锁不可逆');
  }
  // 确认运行不匹配（他轮确认）：不动
  {
    const dataDir = mkData();
    const v = confirmedVersion(dataDir, 'BPUB-run-a');
    mkRun(dataDir, 'BPUB-run-b', 'failed');
    const out = buildStore.rollbackReleaseConfirm(dataDir, v.id, { runId: 'BPUB-run-b' });
    assert.equal(out.release.confirmedRunId, 'BPUB-run-a', '运行不匹配不回退');
  }
  // 账本缺失：保守不回退（与读取侧「缺失判已发布」同口径）
  {
    const dataDir = mkData();
    const v = confirmedVersion(dataDir, 'BPUB-run-gone');
    const out = buildStore.rollbackReleaseConfirm(dataDir, v.id, { runId: 'BPUB-run-gone' });
    assert.ok(out.release.confirmedAt, '账本缺失保守不清确认锁');
  }
  // 未确认过的版本：幂等无操作
  {
    const dataDir = mkData();
    const v = mergedVersion(dataDir);
    const out = buildStore.rollbackReleaseConfirm(dataDir, v.id, { runId: 'BPUB-run-x' });
    assert.ok(!out.release, '未确认版本回退为无操作');
  }
});

/* ---------- R1 读取侧兜底：isReleased(v, dataDir) ---------- */

t('R1 isReleased 兜底：确认运行 failed / canceled → 未发布；succeeded / 无运行编号 / 账本缺失 / 未传目录 → 维持已发布口径', () => {
  for (const [status, expect] of [['failed', false], ['canceled', false], ['succeeded', true], ['running', true]]) {
    const dataDir = mkData();
    const v = confirmedVersion(dataDir, 'BPUB-judge');
    mkRun(dataDir, 'BPUB-judge', status);
    assert.equal(buildStore.isReleased(buildStore.readVersion(dataDir, v.id), dataDir), expect, `确认运行 ${status} 应判 ${expect ? '已发布' : '未发布'}`);
  }
  // 无 confirmedRunId（早期确认形态）：无运行可查，按确认事实判已发布
  {
    const dataDir = mkData();
    const v = mergedVersion(dataDir);
    buildStore.recordReleaseConfirm(dataDir, v.id, { runId: null });
    assert.equal(buildStore.isReleased(buildStore.readVersion(dataDir, v.id), dataDir), true, '无运行编号保守判已发布');
  }
  // 账本缺失（被清理）：保守判已发布
  {
    const dataDir = mkData();
    const v = confirmedVersion(dataDir, 'BPUB-missing');
    assert.equal(buildStore.isReleased(buildStore.readVersion(dataDir, v.id), dataDir), true, '账本缺失保守判已发布');
  }
  // 兼容：不传 dataDir（旧调用形态）按 confirmedAt 现状判定
  {
    const dataDir = mkData();
    const v = confirmedVersion(dataDir, 'BPUB-legacy');
    mkRun(dataDir, 'BPUB-legacy', 'failed');
    assert.equal(buildStore.isReleased(buildStore.readVersion(dataDir, v.id)), true, '未传目录维持旧口径（不读账本）');
    assert.equal(buildStore.isReleased(null, dataDir), false, '无版本对象恒为未发布');
  }
});

/* ---------- R2 存量计划范围操作恢复 ---------- */

t('R2 确认运行失败的计划恢复可编辑：增条目 / 语言集 / 自定义文档 / 重开合并不再被「已正式发布」拦截；succeeded 维持锁定', () => {
  const dataDir = mkData();
  const v = confirmedVersion(dataDir, 'BPUB-stock');
  mkRun(dataDir, 'BPUB-stock', 'failed');
  // 存量 BLD 形态：confirmedAt 存在 + 对应运行 failed → 读取侧兜底恢复可编辑，无需改 runtime 数据
  const out = buildStore.addItems(dataDir, v.id, [itemOf('BUG-20260928-015', H2)]);
  assert.equal(out.items.length, 2, '失败确认后可补关联条目');
  assert.deepEqual(buildStore.saveDocLangs(dataDir, v.id, { langs: ['zh', 'en'] }).langs, ['zh', 'en'], '失败确认后可改文档语言集');
  assert.deepEqual(buildStore.addCustomDoc(dataDir, v.id, { name: 'MIGRATION' }).customDocs, ['MIGRATION'], '失败确认后可加自定义文档');
  assert.equal(buildStore.beginMerge(dataDir, v.id, { baseBranch: 'dev' }).status, 'merging', '失败确认后可重开合并');
  buildStore.finishMerge(dataDir, v.id, { results: [{ itemId: 'BUG-20260928-015', ok: true }] });
  // 已合入条目的移出 / 换 commit 拦截口径不再是「正式发布」（REQ-20260926-002 已合入事实保护独立生效）
  assert.throws(() => buildStore.removeItems(dataDir, v.id, ['REQ-20260928-015']), conflict(/已合并入 main/), '已合入条目移出按既有口径拦截（非正式发布锁）');
  assert.throws(() => buildStore.setItemCommit(dataDir, v.id, 'REQ-20260928-015', H2), conflict(/已合并入 main/), '已合入条目换提交按既有口径拦截（非正式发布锁）');
  // 成功运行（现状零回归）：确认锁维持
  const dataDir2 = mkData();
  const v2 = confirmedVersion(dataDir2, 'BPUB-ok');
  mkRun(dataDir2, 'BPUB-ok', 'succeeded');
  assert.throws(() => buildStore.addItems(dataDir2, v2.id, [itemOf('BUG-20260928-016', H2)]), conflict(/正式发布/), '成功发布后增条目仍 409');
  assert.throws(() => buildStore.beginMerge(dataDir2, v2.id, { baseBranch: 'dev' }), conflict(/正式发布/), '成功发布后重开合并仍 409');
});

/* ---------- T1 重试语义：最近一次有效确认 ---------- */

t('T1 回退后再次确认固化为最近一次有效确认（新运行编号 + 新时点）；成功后确认锁稳定', async () => {
  const dataDir = mkData();
  const v = mergedVersion(dataDir);
  const a = buildStore.recordReleaseConfirm(dataDir, v.id, { runId: 'BPUB-run-a' });
  mkRun(dataDir, 'BPUB-run-a', 'failed');
  buildStore.rollbackReleaseConfirm(dataDir, v.id, { runId: 'BPUB-run-a' });
  await new Promise((r) => setTimeout(r, 5)); // 跨毫秒，保证新确认时点可区分
  const b = buildStore.recordReleaseConfirm(dataDir, v.id, { runId: 'BPUB-run-b' });
  assert.equal(b.release.confirmedRunId, 'BPUB-run-b', '回退后重新确认固化新运行编号');
  assert.ok(Date.parse(b.release.confirmedAt) > Date.parse(a.release.confirmedAt), '重试确认为新的有效确认时点');
  mkRun(dataDir, 'BPUB-run-b', 'succeeded');
  const out = buildStore.rollbackReleaseConfirm(dataDir, v.id, { runId: 'BPUB-run-b' });
  assert.ok(out.release.confirmedAt && out.release.confirmedRunId === 'BPUB-run-b', '成功运行不回退（最近一次有效确认稳定）');
  assert.equal(buildStore.isReleased(buildStore.readVersion(dataDir, v.id), dataDir), true, '成功后 isReleased 为真');
});

/* ---------- G1 五步门禁 released 覆盖参 ---------- */

t('G1 publishStepsState 第三参：false 时失败确认计划 docs / docmerge / merge 不锁；缺省维持 confirmedAt 现状口径', () => {
  const mk = (over = {}) => ({ status: 'merged', items: [{ itemId: 'REQ-20260928-015', commit: H1 }], docsMerge: { commitHash: 'c'.repeat(40), mergedAt: '2026-09-26T10:00:00.000Z' }, docs: null, ...over });
  const by = (steps, k) => steps.find((s) => s.key === k);
  const releasedForm = mk({ release: { pushedAt: '2026-09-28T01:00:00.000Z', pushedSha: H1, confirmedAt: '2026-09-28T02:00:00.000Z', confirmedRunId: 'BPUB-g' } });
  // 服务端以 isReleased(v, dataDir) 兜底后传入 false：门禁不再按「已正式发布」锁范围
  let steps = flow.publishStepsState(releasedForm, { overall: 'committed' }, false);
  assert.ok(!by(steps, 'docs').locked, '兜底 false 时 docs 步不锁');
  assert.ok(!by(steps, 'docmerge').locked, '兜底 false 时 docmerge 步不锁');
  assert.ok(!by(steps, 'merge').locked, '兜底 false 时 merge 步不锁');
  // 缺省（不传第三参，既有调用 / 存量测试口径）：confirmedAt 现状判定，零回归
  steps = flow.publishStepsState(releasedForm, { overall: 'committed' });
  assert.ok(by(steps, 'docs').locked && /正式发布/.test(by(steps, 'docs').reason), '缺省口径 docs 锁不回归');
  assert.ok(by(steps, 'docmerge').locked, '缺省口径 docmerge 锁不回归');
  assert.ok(by(steps, 'merge').locked, '缺省口径 merge 锁不回归');
  // 显式 true（成功发布）：锁定不回归
  steps = flow.publishStepsState(releasedForm, { overall: 'committed' }, true);
  assert.ok(by(steps, 'merge').locked, '兜底 true 时 merge 步锁定');
});

/* ---------- J1 发布链路 / 服务端接线 ---------- */

t('J1 build-publish 失败 / 取消终态收尾调用 rollbackReleaseConfirm；server / publish-flow 换兜底口径', () => {
  const src = fs.readFileSync(path.join(pluginRoot, 'scripts', 'lib', 'build-publish.mjs'), 'utf8');
  assert.match(src, /rollbackReleaseConfirm/, 'build-publish 应调用确认锁回退');
  // 阶段失败落账后回退
  const iStageFail = src.indexOf("r.status='failed';r.error={message:e.message,stage:stageKey}");
  assert.ok(iStageFail >= 0, '阶段失败落账存在');
  assert.ok(src.indexOf('rollbackConfirm(', iStageFail) > iStageFail, '阶段失败后应回退确认锁');
  // cancel / recover / 完成态 failed 同样接线
  assert.ok((src.match(/rollbackConfirm\(/g) || []).length >= 5, '取消 / 完成 failed / start 异常 / cancel / recover 收尾均接线');
  const serverSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');
  assert.ok(!/isReleased\(v\)[^,]/.test(serverSrc), 'server 各处 isReleased 应传数据目录兜底');
  assert.match(serverSrc, /isReleased\(v,\s*(?:dataDir|board)\)/, 'server isReleased 传目录（读取侧兜底）');
  assert.match(serverSrc, /publishStepsState\(v,\s*docsEval,\s*buildStore\.isReleased\(/, 'publish-plan 门禁传入兜底 released');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
