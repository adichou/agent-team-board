#!/usr/bin/env node
// BUG-20260908-011 批量完善创建后人工编辑导致待领取条目被跳过 —— 数据层测试（B1~B6）
// 覆盖：创建/吸收后、领取前的人工编辑不再作为出局门槛（D02）、领取时重冻结基线并持久化、
// done「文档确有变更」核验以领取时基线为准（领取后未改文档仍拒绝）、在途期间人工编辑同算
// 「领取后变更」、既有出局条件（目录损坏/离开 accepted）与收尾计数不回归。
// 用法：node scripts/tests/refine-claim-baseline.test.mjs

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
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-refine-claim-')));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  return { root, dataDir };
}

function accept(dataDir, id) {
  core.setStatus(dataDir, id, 'accepted', { by: 'human' });
}

// B1（D02 主场景）：创建批次后、领取前人工编辑（追加背景）→ 正常领取、不产生 skipped、
// 完善状态置「完善中」，随后补全文档 done 记账
t('B1 创建后领取前人工编辑 README：仍领取该条目，不 skip，补全后正常 done', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: '深测项' });
  accept(dataDir, a.id);
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  fs.appendFileSync(path.join(core.resolveItemDir(dataDir, a.id).dir, 'README.md'), '\n人工追加背景\n');
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  assert.equal(got.itemId, a.id, `应领取被人工编辑过的条目（得到 ${JSON.stringify(got)}）`);
  assert.equal(refineStates.refineStateOf(dataDir, a.id), 'refining', '领取后完善状态应为完善中');
  const runs = refine.listRefineRuns(dataDir, batch.batchId, { offset: 0, limit: 20 });
  assert.equal(runs.records.filter((x) => x.result === 'skipped').length, 0, '不应产生 skipped 记录');
  fs.writeFileSync(path.join(got.itemDir, 'README.md'),
    '# r1\n\n## 描述\n补全后的说明文字长度超过阈值三十个字符以上，符合完整判定。\n\n## 验收标准\n\n- [x] 可记账\n');
  const fin = refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补全 README' });
  assert.equal(fin.receipt.result, 'done', '领取前的人工编辑不阻断 done 记账');
  const ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.counts.done, 1);
  assert.equal(ck.counts.skipped, 0);
  assert.equal(ck.counts.remaining, 0);
});

// B2：done 核验以领取时基线为准——领取后未改文档仍拒绝（既有「基线一致不能记完成」不回归）
t('B2 领取后未改文档：done 仍被拒（领取时基线一致），改文档后通过', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: 'r1' });
  accept(dataDir, a.id);
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  assert.throws(() => refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '无修改' }),
    /基线一致/, '领取后未改文档不能记完成');
  fs.appendFileSync(path.join(got.itemDir, 'README.md'), '\n补全说明\n');
  const fin = refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补全' });
  assert.equal(fin.receipt.result, 'done');
});

// B3：领取时基线重冻结并持久化——账本 baseline 从创建时点指纹更新为领取时点指纹
t('B3 领取时重冻结基线并持久化：账本 baseline=领取时点指纹，不再是创建时点指纹', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: 'r1' });
  accept(dataDir, a.id);
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  const frozenAtCreate = batch.candidates[0].baseline;
  const dir = core.resolveItemDir(dataDir, a.id).dir;
  fs.appendFileSync(path.join(dir, 'README.md'), '\n人工追加背景\n');
  const fpEdited = refine.docsFingerprint(dir);
  assert.notEqual(fpEdited, frozenAtCreate, '前置：人工编辑已使指纹偏离创建时基线');
  refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  const stored = refine.getRefineBatch(dataDir, batch.batchId).candidates
    .find((c) => c.id === a.id).baseline;
  assert.equal(stored, fpEdited, '账本基线应为领取时点（编辑后）指纹');
  assert.notEqual(stored, frozenAtCreate, '账本基线不应停留在创建时点指纹');
});

// B4：吸收时冻结同样不作为领取门槛——round1 吸收的候选在 round2 领取前被人工编辑仍正常领取
t('B4 吸收后领取前人工编辑：跨轮领取不 skip（吸收时基线不作门槛）', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: '首轮项' });
  accept(dataDir, a.id);
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  const runA = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  assert.equal(runA.itemId, a.id);
  const b = core.createItem(dataDir, { type: 'requirement', title: '在途时新接受' });
  accept(dataDir, b.id); // 运行 A 期间新接受 → 回执收尾实时吸收（吸收时冻结 B 基线）
  fs.appendFileSync(path.join(runA.itemDir, 'README.md'), '\n补全说明\n');
  refine.finishRefineRun(dataDir, runA.runId, { result: 'done', summary: '补全 A' });
  fs.appendFileSync(path.join(core.resolveItemDir(dataDir, b.id).dir, 'README.md'), '\n人工补充背景\n'); // 吸收后、领取前编辑
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  assert.equal(got.itemId, b.id, `应领取吸收后被人工编辑的 B（得到 ${JSON.stringify(got)}）`);
  const runs = refine.listRefineRuns(dataDir, batch.batchId, { offset: 0, limit: 20 });
  assert.equal(runs.records.filter((x) => x.result === 'skipped').length, 0, '不应产生 skipped');
});

// B5：在途期间的人工再次编辑与子代理编辑不区分——领取后任何变更都算「领取后变更」，done 通过
t('B5 领取后在途期间人工编辑：done 核验按领取时基线通过（不区分编辑者）', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: 'r1' });
  accept(dataDir, a.id);
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  fs.appendFileSync(path.join(got.itemDir, 'README.md'), '\n人工在子代理回执前追加内容\n');
  const fin = refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '文档已变更' });
  assert.equal(fin.receipt.result, 'done', '领取后编辑（无论何方）均满足「确有变更」核验');
});

// B6：既有出局条件与收尾计数不回归——目录损坏 / 离开 accepted 照旧 skipped，批账正确
t('B6 出局条件回归：目录损坏与离开 accepted 仍 skipped 出局，无人工编辑类 skipped', () => {
  const { root, dataDir } = mkProject();
  const items = ['r1', 'r2', 'r3'].map((title) => {
    const x = core.createItem(dataDir, { type: 'requirement', title });
    accept(dataDir, x.id);
    return x;
  });
  const [a, b, c] = items;
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  fs.rmSync(core.resolveItemDir(dataDir, a.id).dir, { recursive: true, force: true }); // 目录损坏
  core.setStatus(dataDir, b.id, 'planned', { by: 'human' }); // 离开 accepted
  fs.appendFileSync(path.join(core.resolveItemDir(dataDir, c.id).dir, 'README.md'), '\n人工追加\n'); // 人工编辑：不出局
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  assert.equal(got.itemId, c.id, '目录损坏/状态变化出局后领到被人工编辑的 c（编辑不出局）');
  fs.appendFileSync(path.join(got.itemDir, 'README.md'), '\n补全说明\n');
  refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补全 c' });
  const end = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  assert.equal(end.stop, 'finished', JSON.stringify(end));
  const runs = refine.listRefineRuns(dataDir, batch.batchId, { offset: 0, limit: 20 });
  const skipped = runs.records.filter((x) => x.result === 'skipped');
  assert.equal(skipped.length, 2, '仅目录损坏与状态变化两条出局');
  assert.match(skipped.find((x) => x.itemId === a.id).reason, /目录损坏/);
  assert.match(skipped.find((x) => x.itemId === b.id).reason, /状态已变化/);
  const ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.counts.done, 1);
  assert.equal(ck.counts.skipped, 2);
  assert.equal(ck.counts.remaining, 0);
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
