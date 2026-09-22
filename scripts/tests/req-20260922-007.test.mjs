#!/usr/bin/env node
// REQ-20260922-007 开发收口提交忽略条目文档编写差异（文档走文档讨论轮/人工通道）—— TDD 载体
// 用法：node scripts/tests/req-20260922-007.test.mjs
// 覆盖（见条目 test-cases.md）：
//   · R1 批量收口不含条目文档：新提交（git show --name-only）无本单条目目录路径、无 doc: 提交；
//     test/业务组主题与路径归因不变；文档改动保留在工作区；
//   · R2 文档被忽略而非丢失：收口后条目文档仍 dirty，可经文档讨论轮形态（pathspec +
//     `doc: … <单号>` 主题）提交入库，itemCommitLog 关联；
//   · R3 手动 /dev 通道（atb claim → atb report）同口径；
//   · R4 仅文档改动：skipped、无新提交、不误报 committed、不挂起（回执/批次/确认/实施锁），
//     auto-commit.json 明细如实（ignoredDocs）；手动通道同样不挂起；
//   · R5 板级共享维持现状：本单与他条目 confirmations.md 删除（出库迁移）、看板共享文件
//     git mv 重命名（R 码）仍随本单 doc 组提交；
//   · R6 回归：预留前已脏非看板路径 → pendingManual 暂扣与挂起照常，条目文档同样不提交；
//   · R7 幂等：收口成功后 run autocommit 重试不产生新提交、文档仍未提交、不挂起；
//   · R8 表述同步：AGENTS.md / SKILL.md / dev-closeout.md 收口范围口径已更新；
//   · R9 结果字段：autoCommitForRun 结果与批量回执携带 ignoredDocs。
// 模式对齐 bug-20260918-003.test.mjs（真实 git 临时仓库 + 端到端经 batch.finishRun）。

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';
import * as gitFlow from '../lib/git-flow.mjs';
import * as confirmStates from '../lib/confirm-states.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB = path.join(pluginRoot, 'scripts', 'atb.mjs');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function git(root, args) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r;
}

function atb(args, cwd) {
  const r = spawnSync(process.execPath, [ATB, ...args, '--dir', cwd], { encoding: 'utf8', timeout: 120_000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-req22-007-')));
}

// 已有提交的 git 项目（main 起步），看板数据已提交；带可运行的轻量测试脚本（npm test）
function mkProject() {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(root, 'README.md'), '# t\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture', version: '1.0.0', private: true,
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  core.initData(root);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 初始化测试仓库']);
  return root;
}

function mkPlannedItem(dataDir, title, type = 'requirement') {
  const x = core.createItem(dataDir, { type, title });
  core.setStatus(dataDir, x.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, x.id, 'planned', { by: 'human' });
  return x;
}

const logSubjects = (root) =>
  git(root, ['log', '--format=%s']).stdout.split('\n').filter(Boolean);
const commitFiles = (root, hash) =>
  git(root, ['show', '--name-only', '--format=', hash]).stdout.split('\n').map((s) => s.trim()).filter(Boolean);
const statusLines = (root) =>
  git(root, ['status', '--porcelain', '-uall']).stdout.split('\n').filter(Boolean);

const relOf = (root, abs) => path.relative(root, abs);

// ---------- R1 批量收口不含条目文档（主路径） ----------

function runDocMixedFlow(root, { preDirty = false } = {}) {
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '文档忽略收口单');
  // 条目目录整体入基线（README 已跟踪）：运行期改动覆盖 M（已跟踪）与 ??（新文档）两类
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 条目基线入库']);
  if (preDirty) {
    fs.mkdirSync(path.join(root, 'scripts', 'web'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scripts', 'web', 'build.js'), 'base\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'chore: 被测源码入库']);
    fs.appendFileSync(path.join(root, 'scripts', 'web', 'build.js'), '上一单遗留脏改动\n'); // 预留前已脏
  }
  const beforeCount = logSubjects(root).length;
  batch.createBatch(dataDir, { projectRoot: root });
  const nx = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w1' });
  assert.equal(nx.itemId, item.id);
  core.claim(dataDir, item.id, 'w1');
  const itemDir = core.resolveItemDir(dataDir, item.id).dir;
  // 本单条目文档编写差异：新文档（??）+ 已跟踪文档修改（M）
  fs.writeFileSync(path.join(itemDir, 'design.md'), '# 设计补充\n');
  fs.writeFileSync(path.join(itemDir, 'test-cases.md'), '# 用例补充\n');
  fs.appendFileSync(path.join(itemDir, 'README.md'), '\n实施补充\n');
  // 源码与测试改动
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'feature-x.mjs'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(root, 'scripts', 'tests', 'feature-x.test.mjs'), 'import assert from "node:assert/strict";\n');
  if (preDirty) fs.appendFileSync(path.join(root, 'scripts', 'web', 'build.js'), '本单实现改动\n'); // 预留前已脏 + 本单动过
  core.report(dataDir, item.id, { summary: '实施完成', by: 'w1', run: { runId: nx.runId } });
  const { receipt } = batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });
  return { dataDir, item, itemDir, runId: nx.runId, batchId: nx.batchId, receipt, beforeCount };
}

t('R1 批量收口不含条目文档：提交清单无条目目录路径、无 doc: 提交；test/业务归因不变；文档保留在工作区', () => {
  const root = mkProject();
  const { dataDir, item, itemDir, runId, receipt, beforeCount } = runDocMixedFlow(root);

  assert.equal(receipt.result, 'reported');
  assert.equal(receipt.autoCommit.status, 'committed');
  assert.equal(receipt.autoCommit.commits.length, 2, '应收口 test + 业务两组（条目文档不进 doc 组）');

  const itemRel = relOf(root, itemDir);
  const newSubjects = logSubjects(root).slice(0, logSubjects(root).length - beforeCount);
  assert.equal(newSubjects.length, 2);
  for (const s of newSubjects) {
    assert.ok(s.includes(item.id), `提交消息须含单号：${s}`);
    assert.ok(!s.startsWith('doc: '), `收口不得再产生条目文档 doc 提交：${s}`);
  }
  const testSubj = newSubjects.find((s) => s.startsWith('test: '));
  const featSubj = newSubjects.find((s) => s.startsWith('feat: '));
  assert.ok(testSubj, '测试代码应单独 test 提交');
  assert.ok(featSubj, '需求业务代码应为 feat 提交');

  // 全部新提交的文件清单不含本单条目目录任何路径（git show --stat 核验口径）
  const hashes = git(root, ['log', '--format=%H', `-n${newSubjects.length}`]).stdout.split('\n').filter(Boolean);
  for (const h of hashes) {
    for (const f of commitFiles(root, h)) {
      assert.ok(!(f === itemRel || f.startsWith(itemRel + '/')), `新提交不得含条目目录路径：${f}（${h.slice(0, 8)}）`);
    }
  }
  // test / 业务组路径归因不变
  const testHash = git(root, ['log', '--format=%H', '--grep=^test: ', '-E']).stdout.split('\n').filter(Boolean)[0];
  const featHash = git(root, ['log', '--format=%H', '--grep=^feat: ', '-E']).stdout.split('\n').filter(Boolean)[0];
  assert.ok(commitFiles(root, testHash).some((f) => f === 'scripts/tests/feature-x.test.mjs'), 'test 组应只含测试路径');
  assert.ok(commitFiles(root, featHash).some((f) => f === 'scripts/lib/feature-x.mjs'), '业务组应含实现路径');

  // 文档改动保留在工作区（未提交、未还原）：design/test-cases/README/test-report 均仍 dirty
  const st = statusLines(root);
  for (const doc of ['design.md', 'test-cases.md', 'README.md', 'test-report.md']) {
    const rel = `${itemRel}/${doc}`;
    assert.ok(st.some((l) => l.slice(3).trim() === rel), `条目文档应保留在工作区：${rel}\n${st.join('\n')}`);
  }

  // R9 结果字段：autoCommitForRun 结果与批量回执携带 ignoredDocs
  assert.ok(Array.isArray(receipt.autoCommit.ignoredDocs) && receipt.autoCommit.ignoredDocs.length >= 3,
    `回执应携带 ignoredDocs：${JSON.stringify(receipt.autoCommit)}`);
  assert.ok(receipt.autoCommit.ignoredDocs.some((p) => p.endsWith('/design.md')), 'ignoredDocs 应含 design.md');
  const runRec = JSON.parse(fs.readFileSync(
    path.join(dataDir, 'runtime', 'dispatch', 'runs', runId, 'run.json'), 'utf8'));
  assert.ok(Array.isArray(runRec.autoCommit.ignoredDocs) && runRec.autoCommit.ignoredDocs.length >= 3,
    '运行账本应携带 ignoredDocs');
});

// ---------- R2 文档差异被忽略而非丢失（文档讨论轮通道可正常提交） ----------

t('R2 收口后条目文档仍可经文档讨论轮形态（pathspec + doc: 单号主题）提交，itemCommitLog 关联', () => {
  const root = mkProject();
  const { dataDir, item, itemDir } = runDocMixedFlow(root);
  const itemRel = relOf(root, itemDir);

  // 模拟文档讨论轮通道（REQ-20260917-002 放行形态：pathspec + 单号主题）
  git(root, ['add', '-A', '--', itemRel]);
  git(root, ['commit', '-q', '-m', `doc: 文档忽略收口单 ${item.id}`]);
  const tracked = git(root, ['ls-files']).stdout;
  assert.ok(tracked.includes(`${itemRel}/design.md`), '文档讨论轮提交后 design.md 应入库');
  assert.ok(tracked.includes(`${itemRel}/test-report.md`), 'test-report.md 应随文档通道入库');
  const st = statusLines(root);
  assert.ok(!st.some((l) => l.slice(3).trim().startsWith(itemRel + '/')), '文档提交后条目目录应干净');

  // 单号主题提交被条目提交索引关联（看板「已提交」徽标 git 历史扫描同源）
  const log = gitFlow.itemCommitLog(dataDir, root, item.id);
  assert.ok(log.some((c) => (c.subject || '').startsWith('doc: ')), `commit log 应含文档讨论轮提交：${JSON.stringify(log)}`);
});

// ---------- R3 手动 /dev 通道同口径 ----------

t('R3 手动 /dev 收口（atb claim → atb report）不含条目文档，文档保留在工作区', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '手动通道文档忽略单');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 条目基线入库']);
  const beforeCount = logSubjects(root).length;

  const c = atb(['claim', item.id, '--by', 'w1'], root);
  assert.equal(c.code, 0, `claim 应成功：${c.err}${c.out}`);
  const itemDir = core.resolveItemDir(dataDir, item.id).dir;
  fs.appendFileSync(path.join(itemDir, 'README.md'), '\n手动轮补充\n');
  fs.writeFileSync(path.join(itemDir, 'design.md'), '# 手动轮设计\n');
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'fix-y.mjs'), 'export const y = 1;\n');
  fs.writeFileSync(path.join(root, 'scripts', 'tests', 'fix-y.test.mjs',), 'import assert from "node:assert/strict";\n');

  const r = atb(['report', item.id, '--framework', 'node:test', '--summary', '通过', '--by', 'w1'], root);
  assert.equal(r.code, 0, `report 应成功：${r.err}${r.out}`);
  assert.ok(r.out.includes('系统收口提交 2 组'), `手动收口应只提交 test/业务两组：\n${r.out}`);

  const newSubjects = logSubjects(root).slice(0, logSubjects(root).length - beforeCount);
  assert.equal(newSubjects.length, 2, `应收口两组提交：${newSubjects.join(' | ')}`);
  for (const s of newSubjects) {
    assert.ok(!s.startsWith('doc: '), `手动通道不得提交条目文档：${s}`);
  }
  const itemRel = relOf(root, itemDir);
  const st = statusLines(root);
  for (const doc of ['README.md', 'design.md', 'test-report.md']) {
    assert.ok(st.some((l) => l.slice(3).trim() === `${itemRel}/${doc}`), `手动通道条目文档应保留在工作区：${doc}`);
  }
});

// ---------- R4 仅文档改动：跳过而非挂起/报错 ----------

t('R4a 批量通道仅文档改动：skipped、无新提交、不误报 committed、不挂起、明细如实、实施锁释放', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '纯文档轮单');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 条目基线入库']);
  const beforeCount = logSubjects(root).length;

  batch.createBatch(dataDir, { projectRoot: root });
  const nx = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w1' });
  core.claim(dataDir, item.id, 'w1');
  const itemDir = core.resolveItemDir(dataDir, item.id).dir;
  fs.writeFileSync(path.join(itemDir, 'design.md'), '# 纯文档设计\n');
  fs.appendFileSync(path.join(itemDir, 'test-cases.md'), '| X0 | 纯文档补充 |\n');
  core.report(dataDir, item.id, { summary: '文档轮完成', by: 'w1', run: { runId: nx.runId } });
  const { receipt } = batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });

  // 不误报 committed：skipped + 0 提交 + 原因如实注明不随收口提交
  assert.equal(receipt.autoCommit.status, 'skipped');
  assert.equal(receipt.autoCommit.commits.length, 0);
  assert.match(receipt.autoCommit.reason, /REQ-20260922-007|不随收口提交/, `原因应注明文档口径：${receipt.autoCommit.reason}`);
  assert.equal(logSubjects(root).length, beforeCount, '不得产生空提交/文档提交');

  // 不挂起：回执无 suspended、批次不 paused、无确认记录、实施锁可被后续批次占用
  assert.ok(!receipt.suspended, `仅文档改动不应挂起：${JSON.stringify(receipt.suspended || null)}`);
  const bt = batch.getBatch(dataDir, nx.batchId);
  assert.ok(!bt.pauseRequested, '批次不应被暂停');
  assert.notEqual(bt.status, 'paused');
  assert.equal(confirmStates.confirmOf(dataDir, item.id), null, '不应声明待人工确认提交');
  const item2 = mkPlannedItem(dataDir, '后续占位单');
  batch.createBatch(dataDir, { projectRoot: root });
  const nx2 = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w2' });
  assert.equal(nx2.itemId, item2.id, '实施锁应已释放（后续批次可领取）');

  // 账本明细如实：auto-commit.json 记录 skipped + ignoredDocs，不写徽标账本
  const detail = JSON.parse(fs.readFileSync(
    path.join(dataDir, 'runtime', 'dispatch', 'runs', nx.runId, 'auto-commit.json'), 'utf8'));
  assert.equal(detail.status, 'skipped');
  assert.ok(Array.isArray(detail.ignoredDocs) && detail.ignoredDocs.length >= 2, '明细应含 ignoredDocs');
  assert.equal(detail.commits.length, 0);
  const badgeDir = path.join(dataDir, 'runtime', 'commits', 'runs');
  assert.ok(!fs.existsSync(badgeDir) || !fs.readdirSync(badgeDir).length, '仅文档轮不得点亮已提交徽标账本');

  // 文档仍保留在工作区
  const itemRel = relOf(root, itemDir);
  const st = statusLines(root);
  assert.ok(st.some((l) => l.slice(3).trim() === `${itemRel}/design.md`), 'design.md 应保留在工作区');
});

t('R4b 手动通道仅文档改动：skipped 不挂起、无新提交', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '手动纯文档轮单');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 条目基线入库']);
  const beforeCount = logSubjects(root).length;

  const c = atb(['claim', item.id, '--by', 'w1'], root);
  assert.equal(c.code, 0, `claim 应成功：${c.err}${c.out}`);
  fs.appendFileSync(path.join(core.resolveItemDir(dataDir, item.id).dir, 'design.md'), '\n# 手动纯文档\n');
  const r = atb(['report', item.id, '--framework', 'node:test', '--summary', '文档轮', '--by', 'w1'], root);
  assert.equal(r.code, 0, `report 应成功：${r.err}${r.out}`);
  assert.ok(!r.out.includes('收口提交不完整'), `不应挂起：\n${r.out}`);
  assert.ok(!r.out.includes('系统收口提交'), `不应产生提交：\n${r.out}`);
  assert.equal(logSubjects(root).length, beforeCount, '手动通道不得产生提交');
});

// ---------- R5 板级共享维持现状（迁移/出库/重命名仍随收口 doc 组收纳） ----------

t('R5 板级共享维持现状：本单与他条目 confirmations.md 删除、看板共享文件 git mv 重命名仍随本单 doc 组提交', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const other = core.createItem(dataDir, { type: 'bug', title: '历史留痕条目' }); // 保持 submitted，不进派发候选
  const item = mkPlannedItem(dataDir, '板级共享收纳单');
  const otherDoc = path.join(core.resolveItemDir(dataDir, other.id).dir, 'confirmations.md');
  fs.writeFileSync(otherDoc, '# 他条目留痕\n');
  const ownDoc = path.join(core.resolveItemDir(dataDir, item.id).dir, 'confirmations.md');
  fs.writeFileSync(ownDoc, '# 本单留痕\n');
  fs.writeFileSync(path.join(dataDir, 'data', 'notes.md'), '# 看板共享文件\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 共享路径基线入库']);

  batch.createBatch(dataDir, { projectRoot: root });
  const nx = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w1' });
  core.claim(dataDir, item.id, 'w1');
  // 运行期执行出库迁移与共享文件搬移 + 本单普通文档编写（应被忽略）
  fs.rmSync(otherDoc);
  fs.rmSync(ownDoc);
  git(root, ['mv', path.join('agent-team-board', 'data', 'notes.md'), path.join('agent-team-board', 'data', 'notes2.md')]);
  fs.appendFileSync(path.join(core.resolveItemDir(dataDir, item.id).dir, 'README.md'), '\n板级共享轮补充\n');

  core.report(dataDir, item.id, { summary: '迁移完成', by: 'w1', run: { runId: nx.runId } });
  const { receipt } = batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });
  assert.equal(receipt.autoCommit.status, 'committed');

  // 出库删除与重命名归 doc 组（板级共享）随本单提交，主题带本单号
  const subjects = logSubjects(root).filter((s) => s.includes(item.id));
  assert.ok(subjects.some((s) => s.startsWith('doc: ')), `板级共享应随本单 doc 提交：${subjects.join(' | ')}`);
  const tracked = git(root, ['ls-files']).stdout;
  assert.ok(!tracked.includes('confirmations.md'), '出库迁移后 git 不得再跟踪 confirmations.md');
  assert.ok(tracked.includes('notes2.md'), '共享文件重命名目标应入库');

  // 本单普通文档仍被忽略（保留在工作区）
  const itemRel = relOf(root, core.resolveItemDir(dataDir, item.id).dir);
  const st = statusLines(root);
  assert.ok(st.some((l) => l.slice(3).trim() === `${itemRel}/README.md`), '本单普通文档应保留在工作区');
});

// ---------- R6 回归：pendingManual 暂扣与挂起语义保持 ----------

t('R6 预留前已脏非看板路径：test/业务暂扣、挂起照常；条目文档同样不提交', () => {
  const root = mkProject();
  const { dataDir, item, itemDir, receipt } = runDocMixedFlow(root, { preDirty: true });

  assert.ok(receipt.suspended, '预留前已脏路径应触发挂起');
  assert.equal(receipt.suspended.blockType, 'commit');
  assert.equal(receipt.autoCommit.status, 'skipped');
  assert.equal(receipt.autoCommit.commits.length, 0, '暂扣时不得提交 test/业务组');
  const subjects = logSubjects(root).filter((s) => s.includes(item.id));
  assert.equal(subjects.length, 0, '不应产生任何本单提交');

  const st = statusLines(root);
  assert.ok(st.some((l) => l.slice(3).trim() === 'scripts/tests/feature-x.test.mjs'), '测试应暂扣保留在工作区');
  const itemRel = relOf(root, itemDir);
  assert.ok(st.some((l) => l.slice(3).trim() === `${itemRel}/design.md`), '条目文档应保留在工作区（不进 doc 组）');
  assert.ok(confirmStates.confirmOf(dataDir, item.id), '应已声明待人工确认提交记录');
});

// ---------- R7 幂等：收口成功后重试不重复提交、文档仍未提交 ----------

t('R7 收口成功（含被忽略文档）后 run autocommit 重试：不产生新提交、文档仍未提交、不挂起', () => {
  const root = mkProject();
  const { dataDir, item, itemDir, runId } = runDocMixedFlow(root);
  const afterCount = logSubjects(root).length;

  const r = batch.retryAutoCommit(dataDir, runId);
  assert.equal(r.autoCommit.status, 'skipped', `重试应跳过：${JSON.stringify(r.autoCommit.reason)}`);
  assert.equal(r.autoCommit.commits.length, 0);
  assert.equal(logSubjects(root).length, afterCount, '重试不得产生新提交');

  const itemRel = relOf(root, itemDir);
  const st = statusLines(root);
  for (const doc of ['design.md', 'test-cases.md', 'README.md']) {
    assert.ok(st.some((l) => l.slice(3).trim() === `${itemRel}/${doc}`), `重试后文档应仍未提交：${doc}`);
  }
  void item;
});

// ---------- R8 表述同步 ----------

t('R8 流程表述已按新口径更新：收口只提交源码与测试；条目文档走文档讨论轮', () => {
  const read = (p) => fs.readFileSync(path.join(pluginRoot, p), 'utf8');
  const agents = read('AGENTS.md');
  assert.ok(agents.includes('REQ-20260922-007'), 'AGENTS.md 应引用本单口径');
  assert.ok(agents.includes('不随收口提交'), 'AGENTS.md 应写明条目文档不随收口提交');

  const skill = read('skills/agent-team-board/SKILL.md');
  assert.ok(skill.includes('REQ-20260922-007'), 'SKILL.md 应引用本单口径');

  const closeoutDoc = read('skills/agent-team-board/dev-closeout.md');
  assert.ok(closeoutDoc.includes('REQ-20260922-007'), 'dev-closeout.md 应引用本单口径');
  assert.ok(closeoutDoc.includes('不随收口提交'), 'dev-closeout.md 应写明条目文档不随收口提交');
  assert.ok(!closeoutDoc.includes('README/design/test-cases、status.json 和 test-report.md 按现行分组规范提交'),
    'dev-closeout.md 不得再声称条目文档随收口提交');
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
