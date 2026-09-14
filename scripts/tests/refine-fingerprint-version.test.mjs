#!/usr/bin/env node
// REQ-20260908-025 完善文档指纹算法版本化 —— 数据层测试（F1~F6）
// 覆盖：指纹自带版本（v2: 前缀）、四处冻结点统一记录版本（领取重冻结就地升级存量裸基线）、
// 按基线版本重算比对（v1 口径基线在 v2 代码下未编辑判一致/有编辑判不一致）、
// 存量裸 40 位 sha1 基线确定性兼容（任一已知口径匹配=未编辑）、真人工编辑语义不回归、
// 事故序列端到端（RFB-20260908-010 场景不再产生「基线失效」误报 skipped）。
// 事故模拟手法：利用注册表内真实 v1（三文档）/v2（四文件）两口径，手工改写账本 baseline
// 还原「冻结方与比对方算法版本不一致」，不引入测试专用动态注册钩子。
// 用法：node scripts/tests/refine-fingerprint-version.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as refine from '../lib/refine-store.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-refine-fpver-')));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  return { root, dataDir };
}

function accept(dataDir, id) {
  core.setStatus(dataDir, id, 'accepted', { by: 'human' });
}

function batchFile(dataDir, batchId) {
  return path.join(dataDir, 'refine', 'batches', batchId, 'batch.json');
}

// 改写账本基线（模拟历史口径冻结的存量账本；batch.json 是数据账本，非 status.json）
function rewriteBaseline(dataDir, batchId, itemId, baseline) {
  const file = batchFile(dataDir, batchId);
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  b.candidates.find((c) => c.id === itemId).baseline = baseline;
  fs.writeFileSync(file, JSON.stringify(b, null, 2));
}

const V2_FP = /^v2:[0-9a-f]{40}$/;

// F1：指纹自带版本——docsFingerprint 返回 v2:<40hex>；docsFingerprintAt 按版本口径出裸哈希，
// v1 不含 ui-demo.html、v2 含；未登记版本抛错
t('F1 指纹版本形态：v2: 前缀 + 按版本口径重算（v1 不含 ui-demo.html）+ 未登记版本抛错', () => {
  const { dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: 'r1' });
  accept(dataDir, a.id);
  const dir = core.resolveItemDir(dataDir, a.id).dir;
  assert.equal(refine.FINGERPRINT_VERSION, 2, '当前口径应为 v2');
  assert.match(refine.docsFingerprint(dir), V2_FP, '指纹应自带 v2: 版本前缀');
  const v1a = refine.docsFingerprintAt(dir, 1);
  const v2a = refine.docsFingerprintAt(dir, 2);
  assert.match(v1a, /^[0-9a-f]{40}$/, 'v1 口径返回裸哈希');
  assert.match(v2a, /^[0-9a-f]{40}$/, 'v2 口径返回裸哈希');
  assert.notEqual(v1a, v2a, '三文档与四文件口径哈希必然不同');
  // v2 才纳入的 ui-demo.html：v1 口径下增删不影响、v2 口径必变
  fs.writeFileSync(path.join(dir, 'ui-demo.html'), '<!doctype html><html><body>a</body></html>');
  assert.equal(refine.docsFingerprintAt(dir, 1), v1a, 'v1 口径不含 ui-demo.html（历史口径重算依据）');
  assert.notEqual(refine.docsFingerprintAt(dir, 2), v2a, 'v2 口径含 ui-demo.html');
  assert.throws(() => refine.docsFingerprintAt(dir, 99), /未知指纹算法版本/, '未登记版本应抛错');
});

// F2：四处冻结点（创建/吸收/重排队/领取）统一落盘版本化基线；领取重冻结把存量裸基线就地升级
t('F2 四处冻结点统一记录版本：创建/吸收/重排队/领取均 v2: 形态；领取把裸基线就地升级', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: '先完成再驳回' });
  accept(dataDir, a.id);
  const b = core.createItem(dataDir, { type: 'requirement', title: '在途新接受' });
  accept(dataDir, b.id);
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  const baseOf = (id) => refine.getRefineBatch(dataDir, batch.batchId).candidates
    .find((c) => c.id === id).baseline;
  // ① 创建时冻结
  assert.match(baseOf(a.id), V2_FP, '创建冻结点基线应带版本');
  // ④ 领取时重冻结（持久化，且等于当前版本化指纹）
  refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  assert.equal(baseOf(a.id), refine.docsFingerprint(core.resolveItemDir(dataDir, a.id).dir),
    '领取后账本基线=当前版本化指纹');
  fs.appendFileSync(path.join(core.resolveItemDir(dataDir, a.id).dir, 'README.md'), '\n补全说明\n');
  refine.finishRefineRun(dataDir, refine.getRefineBatch(dataDir, batch.batchId).currentRunId,
    { result: 'done', summary: '补全 A' });
  // ② 吸收时冻结（B 在 A 运行中接受，回执收尾实时吸收）
  assert.match(baseOf(b.id), V2_FP, '吸收冻结点基线应带版本');
  // ③ 重排队时重冻结：A done 后驳回再接受 → next 扫描重排队并重冻结（A 移队尾，w2 先领 B）
  core.setStatus(dataDir, a.id, 'submitted', { by: 'human' });
  core.setStatus(dataDir, a.id, 'accepted', { by: 'human' });
  const runB = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  assert.equal(runB.itemId, b.id, 'A 重排队尾，先领 B');
  assert.match(baseOf(a.id), V2_FP, '重排队冻结点基线应带版本');
  // 存量裸基线就地升级：手工把重排队后的 A 基线改回裸哈希（模拟版本化上线前的账本），下次领取即升级
  refine.finishRefineRun(dataDir, runB.runId, { result: 'failed', reason: '让位' });
  const bareA = refine.docsFingerprintAt(core.resolveItemDir(dataDir, a.id).dir, 2);
  rewriteBaseline(dataDir, batch.batchId, a.id, bareA);
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w3' });
  assert.equal(got.itemId, a.id, '应再次领到 A（B 已终态出局）');
  assert.match(baseOf(a.id), V2_FP, '领取重冻结把存量裸基线就地升级为版本化形态');
});

// F3：事故主场景——v1 口径冻结的基线在算法演进（当前 v2）后的代码里按 v1 口径重算比对：
// 未编辑（含仅新增 v2 才纳入的 ui-demo.html）判一致 → done 仍拒绝；编辑 v1 覆盖文件判不一致 → 可记完成
t('F3 按基线版本重算比对：v1 基线在 v2 代码下未编辑判一致（done 拒绝）、有编辑判不一致（done 通过）', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: 'r1' });
  accept(dataDir, a.id);
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  const dir = core.resolveItemDir(dataDir, a.id).dir;
  // 模拟「冻结时算法为 v1」的版本化基线（领取后未再编辑文档）
  const v1Baseline = `v1:${refine.docsFingerprintAt(dir, 1)}`;
  rewriteBaseline(dataDir, batch.batchId, a.id, v1Baseline);
  assert.equal(refine.docsUnchangedSince(dir, refine.getRefineBatch(dataDir, batch.batchId)
    .candidates.find((c) => c.id === a.id).baseline), true, '未编辑：v1 口径重算应判一致');
  assert.throws(() => refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '未改文档' }),
    /基线一致/, '未编辑（旧版本口径）done 仍按「未检测到补全变更」拒绝');
  // 仅新增 v2 才纳入的 ui-demo.html：v1 口径下不算变更 → 仍判一致（事故核心：不再误报人工编辑）
  fs.writeFileSync(path.join(dir, 'ui-demo.html'), '<!doctype html><html><body>演示</body></html>');
  assert.equal(refine.docsUnchangedSince(dir, v1Baseline),
    true, 'ui-demo.html 不在 v1 口径内：不应判为已编辑');
  assert.throws(() => refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '仅演示文件' }),
    /基线一致/, '旧版本口径下未触及其覆盖文件：done 拒绝（口径语义保持）');
  // 编辑 v1 覆盖文件（README）→ 判不一致 → done 通过
  fs.appendFileSync(path.join(dir, 'README.md'), '\n真实补全内容\n');
  assert.equal(refine.docsUnchangedSince(dir, v1Baseline),
    false, '前置：README 已改（v1 口径重算不再等于旧基线）');
  const fin = refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补全 README' });
  assert.equal(fin.receipt.result, 'done', '有编辑（旧版本口径）done 通过核验');
});

// F4：存量裸 40 位 sha1 基线确定性兼容——v1/v2 任一已知口径匹配即视为未编辑；
// 真编辑在任一口径下都不再等于旧哈希 → 判已变更
t('F4 存量裸哈希兼容：裸 v1/裸 v2 基线未编辑均判一致，真编辑判不一致', () => {
  const { dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: 'r1' });
  accept(dataDir, a.id);
  const dir = core.resolveItemDir(dataDir, a.id).dir;
  const bareV1 = refine.docsFingerprintAt(dir, 1);
  const bareV2 = refine.docsFingerprintAt(dir, 2);
  assert.equal(refine.docsUnchangedSince(dir, bareV1), true, '裸 v1 基线：未编辑判一致');
  assert.equal(refine.docsUnchangedSince(dir, bareV2), true, '裸 v2 基线：未编辑判一致');
  // 裸 v1 基线 + 之后新增 ui-demo.html（v2 时代约定）：v1 口径仍匹配 → 不误报（RFB-010 事故形态）
  fs.writeFileSync(path.join(dir, 'ui-demo.html'), '<!doctype html><html><body>x</body></html>');
  assert.equal(refine.docsUnchangedSince(dir, bareV1), true, '裸 v1 基线遇 v2 时代新增文件不误报');
  // 真编辑：任一口径都无法再算出旧哈希
  fs.appendFileSync(path.join(dir, 'README.md'), '\n人工编辑\n');
  assert.equal(refine.docsUnchangedSince(dir, bareV1), false, '真编辑后裸 v1 基线判已变更');
  assert.equal(refine.docsUnchangedSince(dir, bareV2), false, '真编辑后裸 v2 基线判已变更');
});

// F5：真人工编辑语义与异常形态不回归——同版本口径领取后编辑判已变更（precheck 出局/settle changed 方向）；
// 非法形态与未登记版本前缀判已变更（宁可出局不在无法重算口径下静默通过核验）；
// server.mjs 两处比对点必须走 docsUnchangedSince（防回退为裸直比）
t('F5 真人工编辑语义回归：同版本编辑判已变更；非法/未登记版本基线判已变更；server 比对点走版本化比对', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: 'r1' });
  accept(dataDir, a.id);
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  const dir = core.resolveItemDir(dataDir, a.id).dir;
  const baseline = refine.getRefineBatch(dataDir, batch.batchId)
    .candidates.find((c) => c.id === a.id).baseline;
  assert.match(baseline, V2_FP);
  assert.equal(refine.docsUnchangedSince(dir, baseline), true, '领取后未编辑：判一致');
  fs.appendFileSync(path.join(dir, 'README.md'), '\n领取后人工编辑\n');
  assert.equal(refine.docsUnchangedSince(dir, baseline), false, '同版本口径领取后人工编辑：判已变更');
  // 非法形态 / 未登记版本：判已变更
  assert.equal(refine.docsUnchangedSince(dir, 'not-a-hash'), false, '非法基线形态判已变更');
  assert.equal(refine.docsUnchangedSince(dir, null), false, '空基线判已变更');
  assert.equal(refine.docsUnchangedSince(dir, `v99:${'0'.repeat(40)}`), false, '未登记版本前缀判已变更');
  // server.mjs precheck/settle 两处比对点必须使用版本化比对助手（源码断言，防回退裸直比）
  const srv = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');
  assert.ok(!srv.includes('refine.docsFingerprint(dir) !== cand.baseline'),
    'server.mjs 不得残留「当前算法重算 !== 裸基线」直比');
  assert.ok(srv.includes('!refine.docsUnchangedSince(dir, cand.baseline)'),
    'precheck 应走 docsUnchangedSince 版本化比对');
  assert.ok(srv.includes('!refine.docsUnchangedSince(dir, cand.baseline) : false'),
    'settle 的 changed 计算应走 docsUnchangedSince 版本化比对');
});

// F6：事故序列端到端——在途批次携带裸基线（模拟 RFB-20260908-010 存量账本）在版本化代码上
// 继续领取/回执：领取重冻结升级基线，补全文档 done 记账，全程无「基线失效」类 skipped
t('F6 事故序列回归：裸基线在途批次领取→补全→done 记账，无「冻结后文档已被人工编辑，基线失效」skipped', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: 'r1' });
  accept(dataDir, a.id);
  const dir = core.resolveItemDir(dataDir, a.id).dir;
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  // 模拟版本化上线前冻结的裸基线（v1 时代口径；REQ-20260908-021 演进使其与重算必然不等）
  rewriteBaseline(dataDir, batch.batchId, a.id, refine.docsFingerprintAt(dir, 1));
  const bare = refine.getRefineBatch(dataDir, batch.batchId).candidates.find((c) => c.id === a.id).baseline;
  assert.match(bare, /^[0-9a-f]{40}$/, '前置：存量裸基线已就位');
  assert.notEqual(refine.docsFingerprint(dir), bare, '前置：旧直比口径下重算必不等（误报成因）');
  assert.equal(refine.docsUnchangedSince(dir, bare), true, '版本化比对：未编辑不误报');
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  assert.match(refine.getRefineBatch(dataDir, batch.batchId).candidates
    .find((c) => c.id === a.id).baseline, V2_FP, '领取重冻结就地升级裸基线');
  fs.appendFileSync(path.join(dir, 'README.md'), '\n补全说明\n');
  const fin = refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补全 README' });
  assert.equal(fin.receipt.result, 'done', '补全后正常记账');
  const end = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  assert.equal(end.stop, 'finished', JSON.stringify(end));
  const runs = refine.listRefineRuns(dataDir, batch.batchId, { offset: 0, limit: 20 });
  assert.equal(runs.records.filter((x) => x.result === 'skipped').length, 0, '不应产生任何 skipped');
  assert.ok(!runs.records.some((x) => (x.reason || '').includes('基线失效')), '不得出现「基线失效」误报');
  const ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.counts.done, 1);
  assert.equal(ck.counts.skipped, 0);
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
