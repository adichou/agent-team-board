#!/usr/bin/env node
// BUG-20260916-003 条目人工确认完成后未取消其受阻回执，批次计数永久残留受阻
// 覆盖：核心复现（blocked → 手工通道上报 → 确认 done → counts.blocked 归零 + 留痕）、
//       不误清（条目未完成时计数保持）、存量兜底（条目已 done 的未标记 run 读时口径归零
//       + legacy 标注）、既有口径不回归（先 blocked 后同批次内 reported 仍计 reported、
//       他人未完成 blocked 照常计数）、摘要/记录透出、前端与服务端静态契约、i18n 词典同步。
// 用法：node scripts/tests/bug-20260916-003.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';
import '../web/i18n.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const appJs = fs.readFileSync(path.join(repoRoot, 'scripts', 'web', 'app.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(repoRoot, 'scripts', 'server.mjs'), 'utf8');
const i18nSrc = fs.readFileSync(path.join(repoRoot, 'scripts', 'web', 'i18n.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function mkProject(prefix) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const dataDir = core.initData(root);
  batch.ensureDispatch(dataDir);
  return { root, dataDir };
}

function mkDevItem(p, title, { backMs = 0 } = {}) {
  const st = core.createItem(p.dataDir, { type: 'requirement', title, description: 'x', by: 'tester' });
  core.setStatus(p.dataDir, st.id, 'accepted', { by: 'human' });
  core.setStatus(p.dataDir, st.id, 'planned', { by: 'human' });
  if (backMs) {
    const sf = core.statusFileOfItemDir(core.resolveItemDir(p.dataDir, st.id).dir);
    const s = JSON.parse(fs.readFileSync(sf, 'utf8'));
    s.createdAt = new Date(Date.parse(s.createdAt) - backMs).toISOString();
    fs.writeFileSync(sf, JSON.stringify(s, null, 2) + '\n');
  }
  return st.id;
}

function readRun(p, runId) {
  return JSON.parse(fs.readFileSync(path.join(p.dataDir, 'runtime', 'dispatch', 'runs', runId, 'run.json'), 'utf8'));
}

function writeRun(p, runId, patch) {
  const f = path.join(p.dataDir, 'runtime', 'dispatch', 'runs', runId, 'run.json');
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), ...patch }, null, 2) + '\n');
}

// 复现路径构造（README 方式 A）：worker 领取认领并交 blocked 回执（safe，批次继续）
function mkBlocked(p, title, owner, { backMs = 0 } = {}) {
  const a = mkDevItem(p, title, { backMs });
  const { batch: b } = batch.createBatch(p.dataDir, { projectRoot: p.root });
  const r1 = batch.nextItem(p.dataDir, b.batchId, { owner });
  assert.equal(r1.itemId, a, '前置：worker 领取该条目');
  core.claim(p.dataDir, a, owner);
  batch.finishRun(p.dataDir, r1.runId, { result: 'blocked', reason: '待人工决策', safeToContinue: true });
  return { a, batchId: b.batchId, runId: r1.runId };
}

function cleanup(p) {
  try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {}
}

const W1 = 'zcode-cancel-w1';

// ---------- 数据层：核心复现 ----------

t('D1 blocked → 手工通道上报 → 人工确认 done：counts.blocked 归零，run 留存且带取消留痕', () => {
  const p = mkProject('atb-bug16003-d1-');
  try {
    const { a, batchId, runId } = mkBlocked(p, '受阻后经手工通道完成', W1);
    assert.equal(batch.checkBatch(p.dataDir, batchId).counts.blocked, 1, '前置：受阻计数为 1');

    // 手工通道收口：report 不带 --run（只产生 manual-<ID> 记录）→ 人工确认完成
    core.report(p.dataDir, a, { framework: 'node', summary: '手工会话实施完成', by: W1 });
    core.setStatus(p.dataDir, a, 'done', { by: 'human' });

    const ck = batch.checkBatch(p.dataDir, batchId);
    assert.equal(ck.counts.blocked, 0, '确认完成后受阻计数应归零');
    const run = readRun(p, runId);
    assert.equal(run.phase, 'blocked', 'run.phase 保持 blocked（不抹除回执历史）');
    assert.ok(run.cancelled && run.cancelled.at, 'run 应带取消留痕（cancelled.at）');
    assert.equal(run.cancelled.kind, 'item-done', '取消路径标记为随条目完成关闭');
    assert.equal(run.cancelled.note, '随条目完成关闭');
    assert.equal(run.reason, '待人工决策', '原受阻原因保留');
  } finally { cleanup(p); }
});

t('D2 不误清：blocked 后条目未完成（仅手工上报，未确认 done）→ 计数保持 1', () => {
  const p = mkProject('atb-bug16003-d2-');
  try {
    const { a, batchId } = mkBlocked(p, '受阻后仅上报未确认', W1);
    core.report(p.dataDir, a, { framework: 'node', summary: '手工会话实施完成', by: W1 });
    assert.equal(batch.checkBatch(p.dataDir, batchId).counts.blocked, 1, '条目未 done 时受阻计数不得被清');
    const ck2 = batch.checkBatch(p.dataDir, batchId);
    assert.equal(ck2.counts.blockedPending, undefined, '依赖受阻口径不受影响');
  } finally { cleanup(p); }
});

t('D3 存量兜底：条目已 done 但历史 run 未标记（修复前存量）→ 读时口径归零 + legacy 标注', () => {
  const p = mkProject('atb-bug16003-d3-');
  try {
    const { a, batchId, runId } = mkBlocked(p, '存量未标记受阻回执', W1);
    core.report(p.dataDir, a, { framework: 'node', summary: 'x', by: W1 });
    core.setStatus(p.dataDir, a, 'done', { by: 'human' });
    // 模拟修复前落账的存量：抹掉写时留痕，条目状态保持 done
    writeRun(p, runId, { cancelled: undefined });

    assert.equal(batch.checkBatch(p.dataDir, batchId).counts.blocked, 0, '存量 run（条目已 done）不再计入受阻');
    const s = batch.batchSummary(p.dataDir, batchId);
    assert.equal(s.counts.blocked, 0, 'batchSummary 同口径归零');
    const rec = s.records.find((r) => r.runId === runId);
    assert.ok(rec, '运行记录留存（不删除历史）');
    assert.equal(rec.result, 'blocked', '记录结果仍为受阻（不抹除）');
    assert.equal(rec.cancelled && rec.cancelled.kind, 'item-done-legacy', '存量记录就地识别为 legacy 取消标注');
  } finally { cleanup(p); }
});

t('D4 既有口径不回归：同条目先 blocked 后同批次内 reported 仍计 reported；他人未完成 blocked 照常计数', () => {
  const p = mkProject('atb-bug16003-d4-');
  try {
    const a = mkDevItem(p, '受阻后重试成功', { backMs: 2000 });
    const b2 = mkDevItem(p, '另一条受阻项');
    const { batch: b } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const r1 = batch.nextItem(p.dataDir, b.batchId, { owner: W1 });
    assert.equal(r1.itemId, a);
    core.claim(p.dataDir, a, W1);
    batch.finishRun(p.dataDir, r1.runId, { result: 'blocked', reason: '待确认', safeToContinue: true });
    assert.equal(batch.checkBatch(p.dataDir, b.batchId).counts.blocked, 1, '前置：受阻 1');

    // 人工把条目放回已计划（清认领）→ 重新执行 → 同批次内再次领取并成功上报
    const sf = core.statusFileOfItemDir(core.resolveItemDir(p.dataDir, a).dir);
    fs.writeFileSync(sf, JSON.stringify({ ...JSON.parse(fs.readFileSync(sf, 'utf8')), status: 'planned', owner: null }, null, 2) + '\n');
    try { fs.unlinkSync(path.join(p.dataDir, 'runtime', '.locks', `${a}.lock`)); } catch {}
    batch.retryRun(p.dataDir, r1.runId);
    const r2 = batch.nextItem(p.dataDir, b.batchId, { owner: W1 });
    assert.equal(r2.itemId, a, '重试后重新领取同一项');
    core.claim(p.dataDir, a, W1);
    core.report(p.dataDir, a, { framework: 'node', summary: '重试成功', by: W1, run: { runId: r2.runId } });
    batch.finishRun(p.dataDir, r2.runId, { result: 'reported', reportRef: 'test-report.md' });

    let ck = batch.checkBatch(p.dataDir, b.batchId);
    assert.equal(ck.counts.reported, 1, '同条目先 blocked 后 reported：按最新终态计 reported');
    assert.equal(ck.counts.blocked, 0, '旧 blocked 回执不再计入受阻');

    // 第二项领取后交 blocked 且保持未完成 → 确认 a 完成，b2 的受阻计数不受影响
    const r3 = batch.nextItem(p.dataDir, b.batchId, { owner: W1 });
    assert.equal(r3.itemId, b2);
    core.claim(p.dataDir, b2, W1);
    batch.finishRun(p.dataDir, r3.runId, { result: 'blocked', reason: '范围待定', safeToContinue: true });
    core.setStatus(p.dataDir, a, 'done', { by: 'human' });

    ck = batch.checkBatch(p.dataDir, b.batchId);
    assert.equal(ck.counts.reported, 1, 'reported 口径不受确认完成影响');
    assert.equal(ck.counts.blocked, 1, '未完成条目（b2）的受阻回执照常计数');
    const runB2 = readRun(p, r3.runId);
    assert.equal(runB2.cancelled, undefined, '未完成条目的 blocked run 不被标记取消');
    // a 的历史 blocked run 随完成关闭（留痕幂等：已标记/未标记都收敛为已取消）
    const runA1 = readRun(p, r1.runId);
    assert.ok(runA1.cancelled && runA1.cancelled.kind === 'item-done', '已完成条目的历史 blocked run 已取消留痕');
  } finally { cleanup(p); }
});

t('D5 取消范围：manual-<ID> 记录与未收尾 run 不受影响；重复确认（幂等）不重复标记', () => {
  const p = mkProject('atb-bug16003-d5-');
  try {
    const { a, batchId, runId } = mkBlocked(p, 'manual 记录不受波及', W1);
    core.report(p.dataDir, a, { framework: 'node', summary: 'x', by: W1 });
    // 手工通道 report 落 manual-<ID> 记录（executor=manual、batchId=null）
    const manualDir = path.join(p.dataDir, 'runtime', 'dispatch', 'runs', `manual-${a}`);
    assert.ok(fs.existsSync(path.join(manualDir, 'run.json')), '前置：manual 记录存在');
    core.setStatus(p.dataDir, a, 'done', { by: 'human' });
    const manual = JSON.parse(fs.readFileSync(path.join(manualDir, 'run.json'), 'utf8'));
    assert.equal(manual.cancelled, undefined, 'manual-<ID> 归因记录不被改写');
    assert.equal(readRun(p, runId).cancelled.kind, 'item-done');

    // done → in-progress 驳回重开后再次确认完成：取消留痕保持（不随状态回退复活计数）
    core.setStatus(p.dataDir, a, 'in-progress', { by: 'human' });
    assert.equal(batch.checkBatch(p.dataDir, batchId).counts.blocked, 0, '已取消回执不随驳回复活');
    core.setStatus(p.dataDir, a, 'done', { by: 'human' });
    const again = readRun(p, runId).cancelled;
    assert.equal(again.kind, 'item-done', '重复确认幂等：留痕字段不被覆盖失效');
  } finally { cleanup(p); }
});

// ---------- 前端 / 服务端 / i18n 静态契约 ----------

t('U1 面板记录行展示取消标注，已取消记录不再提供「重新执行」入口', () => {
  assert.match(appJs, /已取消（随条目完成关闭）/, '应包含「已取消（随条目完成关闭）」标注文案');
  assert.match(appJs, /已取消（条目已完成）/, '应包含存量 legacy 标注文案');
  const seg = appJs.slice(appJs.indexOf('function runAttemptsHtml'));
  const body = seg.slice(0, seg.indexOf('\nfunction '));
  assert.match(body, /r\.cancelled/, '记录行按 cancelled 字段渲染标注');
  const retryLine = body.match(/const retryable = [^\n]*/);
  assert.ok(retryLine, 'runAttemptsHtml 应保留 retryable 判定');
  assert.match(retryLine[0], /!r\.cancelled/, '已取消记录不显示「重新执行」（对 done 条目必然报均不可入队）');
});

t('U2 服务端异常口径 blockedRuns 仍由 counts.blocked 单点收敛（修复后自动不再计入已取消回执）', () => {
  assert.match(serverJs, /blockedRuns: s\.counts\.blocked/, '/api/batch/current 的 blockedRuns 应来自 batchState 计数');
});

t('U3 i18n 词典同步（BUG-20260912-001）：两条取消标注文案均有 EN 词条', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN } = I._dict;
  assert.ok(EN['已取消（随条目完成关闭）'], '缺少「已取消（随条目完成关闭）」EN 词条');
  assert.ok(EN['已取消（条目已完成）'], '缺少「已取消（条目已完成）」EN 词条');
  assert.match(i18nSrc, /BUG-20260916-003/, '词典应带本单编号注释');
});

for (const [name, fn] of cases) {
  fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
