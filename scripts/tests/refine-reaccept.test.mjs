#!/usr/bin/env node
// BUG-20260908-010 批量完善实时队列提前结束并漏掉重新接受条目 —— 数据层测试（V1~V7）
// 覆盖：check/回执收尾实时吸收新接受单（D01）、驳回再接受重排队重领+基线重冻结（D03）、
// fail 出局 / release 换单 / 状态变化出局 / stop 语义不回归、移出计划回已接受同样重排队。
// 用法：node scripts/tests/refine-reaccept.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as core from '../lib/core.mjs';
import * as refine from '../lib/refine-store.mjs';
import * as refineStates from '../lib/refine-states.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-refine-reaccept-')));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  return { root, dataDir };
}

function accept(dataDir, id) {
  core.setStatus(dataDir, id, 'accepted', { by: 'human' });
}

// V1：最后一项运行期间新接受的单，回执收尾与 check 都要实时吸收（D01）
t('V1 最后一项在途时新接受单：回执吸收、check 继续、next 领到新单', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: '在途项' });
  accept(dataDir, a.id);
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  const run = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  assert.equal(run.itemId, a.id);

  const b = core.createItem(dataDir, { type: 'requirement', title: '在途时新接受' });
  accept(dataDir, b.id); // A 运行期间人工接受 B

  refine.finishRefineRun(dataDir, run.runId, { result: 'failed', reason: '测试失败路径' });
  assert.notEqual(refine.getRefineBatch(dataDir, batch.batchId).status, 'finished', '尚有实时候选 B，批次不得提前 finished');

  const ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.nextAction, 'continue', JSON.stringify(ck));
  assert.equal(ck.counts.total, 2, 'B 计入 total');
  assert.equal(ck.counts.remaining, 1, 'B 计入 remaining');

  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  assert.equal(got.itemId, b.id, '随后领取到 B');
});

// V2：同轮已 done 的 A 驳回再接受 → 重新入队（队尾）、重冻结基线、可再次补全 done（D03）
t('V2 同轮已完成单驳回再接受：重新入队、重冻结基线、再次 done、双运行记录', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: '先完成再被驳回' });
  accept(dataDir, a.id);
  const b = core.createItem(dataDir, { type: 'requirement', title: '保持队列未结束' });
  accept(dataDir, b.id);
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });

  const run1 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  assert.equal(run1.itemId, a.id);
  fs.appendFileSync(path.join(run1.itemDir, 'README.md'), '\n补全说明\n');
  refine.finishRefineRun(dataDir, run1.runId, { result: 'done', summary: '补全' });

  // 人工驳回再接受：完善状态重置「未完善」
  core.setStatus(dataDir, a.id, 'submitted', { by: 'human' });
  core.setStatus(dataDir, a.id, 'accepted', { by: 'human' });
  assert.equal(refineStates.refineStateOf(dataDir, a.id), 'unrefined');

  // A 重新排队到队尾：本轮先领到其他候选 B
  const runB = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  assert.equal(runB.itemId, b.id, 'A 重排队尾，先领 B');
  refine.finishRefineRun(dataDir, runB.runId, { result: 'failed', reason: '测试' });

  // 其余项收尾后再次领到 A（重新接受识别，finalByItem 不排除）
  const run2 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w3' });
  assert.equal(run2.itemId, a.id, '再次领取到被重新接受的 A');

  // 上一轮 done 的修改不视为人工篡改：基线已重冻结，改文档后 done 通过核验
  fs.appendFileSync(path.join(run2.itemDir, 'README.md'), '\n二次补全说明\n');
  const fin = refine.finishRefineRun(dataDir, run2.runId, { result: 'done', summary: '二次补全' });
  assert.equal(fin.receipt.result, 'done');

  // 执行记录可追溯同一条目的多次运行
  const runs = refine.listRefineRuns(dataDir, batch.batchId, { offset: 0, limit: 20 });
  const ofA = runs.records.filter((x) => x.itemId === a.id);
  assert.equal(ofA.length, 2, 'A 留有两条独立运行记录');
});

// V3：fail 不重领（无再接受事件），不形成同轮无限重领
t('V3 fail 出局语义不变：fail 后领下一项或收尾', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: '失败项' });
  accept(dataDir, a.id);
  const b = core.createItem(dataDir, { type: 'requirement', title: '后继项' });
  accept(dataDir, b.id);
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  const run = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  assert.equal(run.itemId, a.id);
  refine.finishRefineRun(dataDir, run.runId, { result: 'failed', reason: '信息不足' });
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  assert.equal(got.itemId, b.id, 'fail 后领下一项，不重领 A');

  // 单候选批次：fail 后直接收尾 finished
  const p2 = mkProject();
  const only = core.createItem(p2.dataDir, { type: 'requirement', title: '独苗' });
  accept(p2.dataDir, only.id);
  const b2 = refine.createRefineBatch(p2.dataDir, { mode: 'zcode', projectRoot: p2.root }).batch;
  const r2 = refine.nextRefineItem(p2.dataDir, b2.batchId, { owner: 'w1' });
  refine.finishRefineRun(p2.dataDir, r2.runId, { result: 'failed', reason: '信息不足' });
  const end = refine.nextRefineItem(p2.dataDir, b2.batchId, { owner: 'w2' });
  assert.equal(end.stop, 'finished', JSON.stringify(end));
});

// V4：release 换单语义不回归
t('V4 release 后领其他候选而非原条目', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: '被释放项' });
  accept(dataDir, a.id);
  const b = core.createItem(dataDir, { type: 'requirement', title: '下一项' });
  accept(dataDir, b.id);
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  const run = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  assert.equal(run.itemId, a.id);
  refine.releaseRefineRun(dataDir, run.runId, { reason: '认领冲突换单' });
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  assert.equal(got.itemId, b.id, 'release 后换单，不重领 A');
});

// V5：领取门槛口径（BUG-20260908-011）——创建后被人工编辑不再出局，按领取时基线正常领取；
// 状态变化出局仍为一次性终局（skip 后不重领）
t('V5 创建后被人工编辑不跳过：领取时基线重冻结正常领取；状态变化出局一次性', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: '人工已编辑' });
  const b = core.createItem(dataDir, { type: 'requirement', title: '状态变化项' });
  accept(dataDir, a.id);
  accept(dataDir, b.id);
  // ids 种子落账（状态变化项须在账本候选中才产生出局记账；缺省建轮不冻结，REQ-20260913-003）
  const { batch } = refine.createRefineBatch(dataDir, { ids: [a.id, b.id], mode: 'zcode', projectRoot: root });
  fs.writeFileSync(path.join(core.resolveItemDir(dataDir, a.id).dir, 'README.md'),
    '# a\n人工已自行补全一版说明，内容足够长。\n');
  core.setStatus(dataDir, b.id, 'planned', { by: 'human' });
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  assert.equal(got.itemId, a.id, '人工编辑不再是出局门槛（BUG-20260908-011）');
  fs.appendFileSync(path.join(got.itemDir, 'README.md'), '\n补全\n');
  refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补全' });
  const end = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  assert.equal(end.stop, 'finished', '状态变化项出局后收尾');
  const ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.counts.skipped, 1, '仅状态变化一条 skipped');
  assert.equal(ck.counts.remaining, 0, 'skip 后不重领');
});

// V6：stop 语义不失效
t('V6 全部处理完且无实时候选：check 返回 stop、批次 finished', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: '正常项' });
  accept(dataDir, a.id);
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  const run = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  fs.appendFileSync(path.join(run.itemDir, 'README.md'), '\n补全\n');
  refine.finishRefineRun(dataDir, run.runId, { result: 'done', summary: '补全' });
  const ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.nextAction, 'stop');
  assert.equal(ck.counts.remaining, 0);
  assert.equal(refine.getRefineBatch(dataDir, batch.batchId).status, 'finished');
});

// V7：移出计划回已接受（done 后 accepted→planned→accepted）同样重新入队
t('V7 移出计划回已接受：重置未完善并重新领取', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: '移出计划项' });
  accept(dataDir, a.id);
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  const run = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  fs.appendFileSync(path.join(run.itemDir, 'README.md'), '\n补全\n');
  refine.finishRefineRun(dataDir, run.runId, { result: 'done', summary: '补全' });
  core.setStatus(dataDir, a.id, 'planned', { by: 'human' });
  core.setStatus(dataDir, a.id, 'accepted', { by: 'human' }); // 移出计划回已接受
  assert.equal(refineStates.refineStateOf(dataDir, a.id), 'unrefined');
  const ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.nextAction, 'continue', '重置未完善后应继续');
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  assert.equal(got.itemId, a.id, '再次领取到移出计划回已接受的 A');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e.message}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
