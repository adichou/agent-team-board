#!/usr/bin/env node
// REQ-20260913-003 批次排队退役 —— 同一时间只有一轮执行（历史版本 REQ-20260906-025 的
// 排队/自动接续能力随「去批次概念」整体移除）。本文件改为回归该移除契约与存量兼容：
// Q1 执行中/待启动/暂停重复启动一律拒绝，不产生排队对象
// Q2 check 不再携带 nextBatch 接续；提示词不含排队接续说明
// Q3 空转账本就地收尾（不残留未结束账本卡住启动）
// Q4 存量排队账本只读兼容：队首解析保留，后位账本不得越过队首领取（防抢）
// Q5 serve/CLI/UI 不再透出排队概念（queue 字段、排队输出、排队渲染均移除）
// 用法：node scripts/tests/batch-queue.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- core 脚手架：临时项目（与 batch-core.test.mjs 同款） ----------

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bqueue-')));
  const dataDir = core.initData(root);
  batch.ensureDispatch(dataDir);
  return { root, dataDir };
}

function mkItem(p, title, { accept = true, backMs = 0 } = {}) {
  const st = core.createItem(p.dataDir, { type: 'requirement', title, description: 'x', by: 'tester' });
  // REQ-20260908-010：选单口径 planned（已计划），接受后默认置计划
  if (accept) {
    core.setStatus(p.dataDir, st.id, 'accepted', { by: 'tester' });
    core.setStatus(p.dataDir, st.id, 'planned', { by: 'tester' });
  }
  if (backMs) {
    const { dir } = core.resolveItemDir(p.dataDir, st.id);
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
    s.createdAt = new Date(Date.parse(s.createdAt) - backMs).toISOString();
    fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(s, null, 2) + '\n');
  }
  return st.id;
}

function cleanup(p) {
  try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {}
}

const W1 = 'zcode-queue-w1';

// 完整流转：领取 → 认领 → 上报 → 回执（released 后 impl 互斥随之释放）
function runOneItem(p, batchId, owner = W1) {
  const run = batch.nextItem(p.dataDir, batchId, { owner });
  if (run.stop) return run;
  core.claim(p.dataDir, run.itemId, owner);
  core.report(p.dataDir, run.itemId, { summary: 'ok', by: owner, run: { runId: run.runId } });
  batch.finishRun(p.dataDir, run.runId, { result: 'reported', reportRef: 'test-report.md' });
  return run;
}

// ---------- Q1 重复启动拒绝（不排队） ----------

t('Q1 重复启动一律拒绝：待启动/执行中/暂停轮存在时不新建、不排队', () => {
  const p = mkProject();
  try {
    const a1 = mkItem(p, 'A1', { backMs: 3000 });
    const a2 = mkItem(p, 'A2', { backMs: 2000 });
    const rA = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.ok(rA.created, '首个轮次应 created=true');
    assert.ok(!('queued' in rA) && !('queuePosition' in rA), '创建结果不再携带排队字段');

    const before = batch.listBatches(p.dataDir).length;
    // 待启动（prepared）重复启动被拒
    assert.throws(() => batch.createBatch(p.dataDir, { projectRoot: p.root }), /已有进行中的任务/, '待启动时重复启动应被拒');
    // 执行中重复启动被拒
    const run = batch.nextItem(p.dataDir, rA.batch.batchId, { owner: W1 });
    assert.equal(run.itemId, a1);
    core.claim(p.dataDir, a1, W1);
    assert.throws(() => batch.createBatch(p.dataDir, { projectRoot: p.root }), /已有进行中的任务/, '执行中重复启动应被拒');
    // 暂停轮同样拒绝（须先恢复或终止）
    batch.pauseBatch(p.dataDir, rA.batch.batchId, true);
    assert.throws(() => batch.createBatch(p.dataDir, { projectRoot: p.root }), /已有进行中的任务/, '暂停轮存在时启动应被拒');
    assert.equal(batch.listBatches(p.dataDir).length, before, '拒绝路径不得产生新账本对象');
  } finally { cleanup(p); }
});

// ---------- Q2 无接续：check / 提示词 ----------

t('Q2 队列取空即结束：check 不携带 nextBatch；提示词不含排队接续说明', () => {
  const p = mkProject();
  try {
    mkItem(p, 'A1', { backMs: 1000 });
    mkItem(p, 'A2');
    const rA = batch.createBatch(p.dataDir, { projectRoot: p.root });
    runOneItem(p, rA.batch.batchId);
    runOneItem(p, rA.batch.batchId);
    const chk = batch.checkBatch(p.dataDir, rA.batch.batchId);
    assert.equal(chk.nextAction, 'stop');
    assert.equal(chk.status, 'finished');
    assert.equal('nextBatch' in chk, false, '不得再携带 nextBatch 排队接续');
    assert.ok(!JSON.stringify(chk).includes('批次'), '核对响应不得出现批次字样');
    for (const w of ['排队', 'nextBatch', '接续']) {
      assert.ok(!rA.batch.prompt.includes(w), `调度提示词不得包含「${w}」`);
    }
  } finally { cleanup(p); }
});

// ---------- Q3 空转账本就地收尾 ----------

t('Q3 空转账本就地收尾：候选全部流失的未结束轮不卡住下一次启动', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'A');
    const rA = batch.createBatch(p.dataDir, { projectRoot: p.root });
    // 唯一候选被人工认领（绕过本轮）→ 本轮空转（无在途、无剩余）
    const { dir } = core.resolveItemDir(p.dataDir, a);
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
    st.status = 'in-progress';
    st.owner = 'human';
    fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(st, null, 2) + '\n');
    // 空转且无候选：按候选口径报错，且空转轮被就地收尾
    assert.throws(() => batch.createBatch(p.dataDir, { projectRoot: p.root }), /没有可实施候选/);
    assert.equal(batch.getBatch(p.dataDir, rA.batch.batchId).status, 'finished', '空转旧轮应被就地收尾');
    // 新候选到位后可正常启动新一轮
    mkItem(p, 'B', { backMs: 500 });
    const next = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.ok(next.created, '收尾后可启动新一轮');
  } finally { cleanup(p); }
});

// ---------- Q4 存量排队账本兼容（防抢保留） ----------

t('Q4 存量排队数据防抢：后位账本不得越过队首领取；队首收尾后按队首解析展示', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'A', { backMs: 2000 });
    const b = mkItem(p, 'B', { backMs: 1000 });
    const rA = batch.createBatch(p.dataDir, { projectRoot: p.root });
    // 手工构造存量排队形态：后位账本 candidates 冻结 B（升级前数据形态）
    const laterId = batch.nextDispatchIdForTest ? batch.nextDispatchIdForTest(p.dataDir) : null;
    void laterId;
    const b2Dir = path.join(p.dataDir, 'dispatch', 'batches', 'batch-20990101-099');
    fs.mkdirSync(b2Dir, { recursive: true });
    const later = {
      ...rA.batch,
      batchId: 'batch-20990101-099',
      candidates: [b],
      createdAt: new Date(Date.parse(rA.batch.createdAt) + 60000).toISOString(),
      status: 'prepared',
      currentRunId: null,
    };
    fs.writeFileSync(path.join(b2Dir, 'batch.json'), JSON.stringify(later, null, 2) + '\n');
    // 队首仍是 A 轮；后位账本不得抢先领取
    assert.equal(batch.queueHeadBatch(p.dataDir).batchId, rA.batch.batchId, '队首解析保留（最早未结束账本）');
    assert.throws(
      () => batch.nextItem(p.dataDir, later.batchId, { owner: W1 }),
      /排队中：前序任务/,
      '存量后位账本不得越过队首领取',
    );
    void a;
  } finally { cleanup(p); }
});

// ---------- Q5 serve/CLI/UI 静态契约 ----------

t('Q5 排队概念不透出：/api/batch/current 无 queue 字段；UI 源码无排队批次渲染', async () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  for (const w of ['排队新批次', '删除本批次', 'deleteBatchById', 'data-del-batch', 'queueNewBatch', '排队批次（']) {
    assert.ok(!js.includes(w), `app.js 不得残留「${w}」`);
  }
  const serverSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');
  assert.ok(!serverSrc.includes("const queue = batch.unfinishedBatches"), '/api/batch/current 不再构造排队批次列表');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
