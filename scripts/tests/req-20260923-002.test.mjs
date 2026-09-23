#!/usr/bin/env node
// REQ-20260923-002 开发收口恢复提交条目文档并忽略根目录文档变更（回退 REQ-20260922-007）—— TDD 载体
// 用法：node scripts/tests/req-20260923-002.test.mjs
// 覆盖（见条目 test-cases.md）：
//   · N1 批量收口恢复提交条目文档：doc: 提交含本单条目目录路径（git show --name-only）、
//     主题 `doc: <标题> <单号>`；回执/账本不再出现本单条目目录的 ignoredDocs；条目目录收口后干净；
//     test/业务组归因不变；
//   · N2 根目录文档忽略（run-20260923-356 对照）：认领前根文档已有人工未提交改动 + 运行期
//     本单又改同一根文档（含未跟踪根 .md）→ 提交清单不含任何根第一层文档路径；根文档差异
//     保留在工作区；无 pendingManual、不挂起、批次不暂停、实施锁释放；confirmScopeForRun
//     候选不含根文档；ignoredDocs 如实携带根文档路径；
//   · N3 手动 /dev 通道（atb claim → atb report）同口径；
//   · N4 仅根文档改动（直接调 autoCommitForRun）：skipped、无新提交、不误报 committed、
//     不挂起（commitIncompleteReason 为 null）、明细如实（ignoredDocs）；
//   · N5 板级共享维持：confirmations.md 出库删除、看板共享文件 git mv 重命名（R 码）仍随
//     本单 doc 组提交；本单条目普通文档同入 doc 组；
//   · N6 回归：预留前已脏非看板源码 → pendingManual 暂扣与挂起照常（test/业务暂扣），
//     doc 组照常提交（含条目文档），状态 committed（部分提交）；
//   · N7 幂等：收口成功后 run autocommit 重试不产生新提交、根文档仍未提交；
//   · N8 仅条目文档改动：doc 组提交（committed）、不挂起；
//   · N9 表述同步：AGENTS.md / SKILL.md / dev-closeout.md 新口径、不再引用 REQ-20260922-007。
// 模式对齐 req-20260922-007.test.mjs（真实 git 临时仓库 + 端到端经 batch.finishRun）。

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
import * as confirmStore from '../lib/confirm-store.mjs';

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
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-req23-002-')));
}

// 已有提交的 git 项目（main 起步），看板数据已提交；根第一层文档基线（README.md/AGENTS.md）
// 已跟踪；带可运行的轻量测试脚本（npm test）
function mkProject() {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(root, 'README.md'), '# t\n');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# 协作规则基线\n');
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
const newHashes = (root, beforeCount) =>
  git(root, ['log', '--format=%H', `-n${logSubjects(root).length - beforeCount}`]).stdout.split('\n').filter(Boolean);

const relOf = (root, abs) => path.relative(root, abs);

// ---------- N1 批量收口恢复提交条目文档（主路径） ----------

function runMixedFlow(root, { preDirtyRoot = false, preDirtySource = false } = {}) {
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '条目文档恢复收口单');
  // 条目目录整体入基线（README 已跟踪）：运行期改动覆盖 M（已跟踪）与 ??（新文档）两类
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 条目基线入库']);
  if (preDirtySource) {
    fs.mkdirSync(path.join(root, 'scripts', 'web'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scripts', 'web', 'build.js'), 'base\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'chore: 被测源码入库']);
    fs.appendFileSync(path.join(root, 'scripts', 'web', 'build.js'), '上一单遗留脏改动\n'); // 预留前已脏
  }
  if (preDirtyRoot) {
    // run-20260923-356 场景前置：认领前根第一层文档已有人工未提交改动
    fs.appendFileSync(path.join(root, 'README.md'), '人工发布文档草稿\n');
    fs.appendFileSync(path.join(root, 'AGENTS.md'), '人工协作文档草稿\n');
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
  if (preDirtySource) fs.appendFileSync(path.join(root, 'scripts', 'web', 'build.js'), '本单实现改动\n');
  if (preDirtyRoot) {
    // 运行期本单又修改同一根文档（无法安全归因的同码内容变）+ 新增未跟踪根文档
    fs.appendFileSync(path.join(root, 'README.md'), '本单运行期改动\n');
    fs.appendFileSync(path.join(root, 'AGENTS.md'), '本单运行期改动\n');
    fs.writeFileSync(path.join(root, 'NOTES.md'), '# 运行期新写根文档\n');
  }
  core.report(dataDir, item.id, { summary: '实施完成', by: 'w1', run: { runId: nx.runId } });
  const { receipt } = batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });
  return { dataDir, item, itemDir, runId: nx.runId, batchId: nx.batchId, receipt, beforeCount };
}

t('N1 批量收口恢复提交条目文档：doc: 提交含条目目录路径；回执无本单条目目录 ignoredDocs；条目目录收口后干净；test/业务归因不变', () => {
  const root = mkProject();
  const { dataDir, item, itemDir, runId, receipt, beforeCount } = runMixedFlow(root);

  assert.equal(receipt.result, 'reported');
  assert.equal(receipt.autoCommit.status, 'committed');
  assert.equal(receipt.autoCommit.commits.length, 3, '应收口 doc + test + 业务三组（条目文档恢复进 doc 组）');

  const itemRel = relOf(root, itemDir);
  const hashes = newHashes(root, beforeCount);
  assert.equal(hashes.length, 3);
  const docHash = git(root, ['log', '--format=%H', '--grep=^doc: ', '-E']).stdout.split('\n').filter(Boolean)[0];
  assert.ok(docHash, '应有条目文档 doc 提交');
  assert.equal(git(root, ['log', '--format=%s', '-n1', docHash]).stdout.trim(), `doc: 条目文档恢复收口单 ${item.id}`,
    'doc 组主题恢复「doc: <标题> <单号>」');
  // doc 提交清单含本单条目目录路径（git show --name-only 核验口径）
  const docFiles = commitFiles(root, docHash);
  for (const doc of ['README.md', 'design.md', 'test-cases.md', 'test-report.md']) {
    assert.ok(docFiles.includes(`${itemRel}/${doc}`), `doc 提交应含条目文档：${itemRel}/${doc}（实际 ${docFiles.join(' | ')}）`);
  }
  // test / 业务组路径归因不变
  const testHash = git(root, ['log', '--format=%H', '--grep=^test: ', '-E']).stdout.split('\n').filter(Boolean)[0];
  const featHash = git(root, ['log', '--format=%H', '--grep=^feat: ', '-E']).stdout.split('\n').filter(Boolean)[0];
  assert.ok(commitFiles(root, testHash).some((f) => f === 'scripts/tests/feature-x.test.mjs'), 'test 组应只含测试路径');
  assert.ok(commitFiles(root, featHash).some((f) => f === 'scripts/lib/feature-x.mjs'), '业务组应含实现路径');

  // 条目目录收口后干净（文档已随收口入库）
  const st = statusLines(root);
  assert.ok(!st.some((l) => l.slice(3).trim().startsWith(itemRel + '/')), `条目目录应已全部入库：\n${st.join('\n')}`);

  // 回执与运行账本不再出现本单条目目录的 ignoredDocs 条目
  const ig = receipt.autoCommit.ignoredDocs || [];
  assert.ok(!ig.some((p) => p === itemRel || p.startsWith(itemRel + '/')), `ignoredDocs 不得含本单条目目录：${JSON.stringify(ig)}`);
  const runRec = JSON.parse(fs.readFileSync(
    path.join(dataDir, 'runtime', 'dispatch', 'runs', runId, 'run.json'), 'utf8'));
  const igRun = (runRec.autoCommit && runRec.autoCommit.ignoredDocs) || [];
  assert.ok(!igRun.some((p) => p === itemRel || p.startsWith(itemRel + '/')), `运行账本 ignoredDocs 不得含条目目录：${JSON.stringify(igRun)}`);
});

// ---------- N2 根目录文档忽略（run-20260923-356 对照场景） ----------

t('N2 根目录文档不随收口提交且不触发暂扣：提交清单无根第一层文档、差异保留工作区、不挂起、批次不暂停、确认候选不含根文档', () => {
  const root = mkProject();
  const { dataDir, item, runId, batchId, receipt, beforeCount } = runMixedFlow(root, { preDirtyRoot: true });

  assert.equal(receipt.result, 'reported');
  assert.equal(receipt.autoCommit.status, 'committed');
  assert.equal(receipt.autoCommit.commits.length, 3, 'test/业务照常提交（根文档不暂扣、不阻塞）');
  assert.ok(!(Array.isArray(receipt.autoCommit.pendingManual) && receipt.autoCommit.pendingManual.length),
    '根文档不得触发 pendingManual');
  assert.ok(!receipt.suspended, `根文档场景不应挂起：${JSON.stringify(receipt.suspended || null)}`);

  // 全部新提交的文件清单不含任何根第一层文档路径（无目录分隔符的路径即根第一层）
  const hashes = newHashes(root, beforeCount);
  for (const h of hashes) {
    for (const f of commitFiles(root, h)) {
      assert.ok(f.includes('/'), `新提交不得含根第一层文档路径：${f}（${h.slice(0, 8)}）`);
    }
  }

  // 根文档差异保留在工作区（未提交、未还原）
  const st = statusLines(root);
  for (const doc of ['README.md', 'AGENTS.md', 'NOTES.md']) {
    assert.ok(st.some((l) => l.slice(3).trim() === doc), `根文档应保留在工作区：${doc}\n${st.join('\n')}`);
  }

  // 回执 ignoredDocs 如实携带根文档路径（不再含条目目录路径，见 N1）
  const ig = receipt.autoCommit.ignoredDocs || [];
  for (const doc of ['README.md', 'AGENTS.md', 'NOTES.md']) {
    assert.ok(ig.includes(doc), `ignoredDocs 应含根文档：${doc}（实际 ${JSON.stringify(ig)}）`);
  }

  // 不挂起闭环：批次不暂停、无确认记录、实施锁可被后续批次占用
  const bt = batch.getBatch(dataDir, batchId);
  assert.ok(!bt.pauseRequested, '批次不应被暂停');
  assert.notEqual(bt.status, 'paused');
  assert.equal(confirmStates.confirmOf(dataDir, item.id), null, '不应声明待人工确认提交');
  const item2 = mkPlannedItem(dataDir, '后续占位单');
  batch.createBatch(dataDir, { projectRoot: root });
  const nx2 = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w2' });
  assert.equal(nx2.itemId, item2.id, '实施锁应已释放（后续批次可领取）');

  // 人工确认候选范围不含根第一层文档（attributed / uncertain / excluded 均不含）
  const runRec = JSON.parse(fs.readFileSync(
    path.join(dataDir, 'runtime', 'dispatch', 'runs', runId, 'run.json'), 'utf8'));
  const scope = gitFlow.confirmScopeForRun({ dataDir, projectRoot: root, run: runRec });
  assert.ok(scope, '应可计算确认候选范围');
  const scopePaths = [...scope.attributed, ...scope.uncertain, ...scope.excluded].map((x) => x.path || x);
  for (const doc of ['README.md', 'AGENTS.md', 'NOTES.md']) {
    assert.ok(!scopePaths.includes(doc), `确认候选不得含根文档：${doc}（实际 ${JSON.stringify(scopePaths)}）`);
  }
});

// ---------- N3 手动 /dev 通道同口径 ----------

t('N3 手动 /dev 收口（atb claim → atb report）提交条目文档、忽略根目录文档', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '手动通道恢复文档单');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 条目基线入库']);
  fs.appendFileSync(path.join(root, 'README.md'), '人工发布文档草稿\n'); // 认领前根文档已脏
  const beforeCount = logSubjects(root).length;

  const c = atb(['claim', item.id, '--by', 'w1'], root);
  assert.equal(c.code, 0, `claim 应成功：${c.err}${c.out}`);
  const itemDir = core.resolveItemDir(dataDir, item.id).dir;
  fs.appendFileSync(path.join(itemDir, 'README.md'), '\n手动轮补充\n');
  fs.writeFileSync(path.join(itemDir, 'design.md'), '# 手动轮设计\n');
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'fix-y.mjs'), 'export const y = 1;\n');
  fs.writeFileSync(path.join(root, 'scripts', 'tests', 'fix-y.test.mjs'), 'import assert from "node:assert/strict";\n');
  fs.appendFileSync(path.join(root, 'README.md'), '本单运行期改动\n'); // 运行期又改同一根文档

  const r = atb(['report', item.id, '--framework', 'node:test', '--summary', '通过', '--by', 'w1'], root);
  assert.equal(r.code, 0, `report 应成功：${r.err}${r.out}`);
  assert.ok(r.out.includes('系统收口提交 3 组'), `手动收口应提交 doc/test/业务三组：\n${r.out}`);

  const hashes = newHashes(root, beforeCount);
  assert.equal(hashes.length, 3, `应收口三组提交：${logSubjects(root).slice(0, 3).join(' | ')}`);
  for (const h of hashes) {
    for (const f of commitFiles(root, h)) {
      assert.ok(f.includes('/'), `手动通道新提交不得含根第一层文档路径：${f}`);
    }
  }
  const itemRel = relOf(root, itemDir);
  const st = statusLines(root);
  assert.ok(!st.some((l) => l.slice(3).trim().startsWith(itemRel + '/')), '手动通道条目文档应随收口入库');
  assert.ok(st.some((l) => l.slice(3).trim() === 'README.md'), '手动通道根文档应保留在工作区');
});

// ---------- N4 仅根文档改动：跳过而非挂起/报错 ----------

t('N4 仅根文档改动：skipped、无新提交、不误报 committed、不挂起、明细如实（ignoredDocs）', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '纯根文档轮单');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 条目基线入库']);
  const beforeCount = logSubjects(root).length;

  // 直接调收口内核模拟「本单只改根文档」轮次（report 必写条目文档，走不了端到端）
  const snap = gitFlow.workingTreeSnapshot(root);
  fs.appendFileSync(path.join(root, 'README.md'), '本单根文档改动\n');
  fs.writeFileSync(path.join(root, 'NOTES.md'), '# 本单新写根文档\n');
  const ac = gitFlow.autoCommitForRun({
    dataDir, projectRoot: root,
    run: { runId: 'run-002-n4-direct', itemId: item.id, treeSnapshot: snap, autoCommit: null },
  });

  assert.equal(ac.status, 'skipped');
  assert.equal(ac.commits.length, 0);
  assert.match(ac.reason, /REQ-20260923-002|根目录文档/, `原因应注明根文档口径：${ac.reason}`);
  assert.ok(Array.isArray(ac.ignoredDocs) && ac.ignoredDocs.includes('README.md') && ac.ignoredDocs.includes('NOTES.md'),
    `ignoredDocs 应如实携带根文档：${JSON.stringify(ac.ignoredDocs)}`);
  assert.equal(confirmStore.commitIncompleteReason(ac), null, '仅根文档被忽略的跳过是完整收口，不挂起');
  assert.equal(logSubjects(root).length, beforeCount, '不得产生空提交/根文档提交');
  const detail = JSON.parse(fs.readFileSync(
    path.join(dataDir, 'runtime', 'dispatch', 'runs', 'run-002-n4-direct', 'auto-commit.json'), 'utf8'));
  assert.equal(detail.status, 'skipped');
  assert.equal(detail.commits.length, 0);
  assert.ok(Array.isArray(detail.ignoredDocs) && detail.ignoredDocs.length >= 2, '明细应含 ignoredDocs');
  const badgeDir = path.join(dataDir, 'runtime', 'commits', 'runs');
  assert.ok(!fs.existsSync(badgeDir) || !fs.readdirSync(badgeDir).length, '纯根文档轮不得点亮已提交徽标账本');
  const st = statusLines(root);
  assert.ok(st.some((l) => l.slice(3).trim() === 'README.md') && st.some((l) => l.slice(3).trim() === 'NOTES.md'),
    '根文档应保留在工作区');
});

// ---------- N5 板级共享维持现状（出库/重命名仍随收口 doc 组收纳） ----------

t('N5 板级共享维持：confirmations.md 出库删除、看板共享文件 git mv 重命名仍随本单 doc 组提交；条目普通文档同入 doc 组', () => {
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
  // 运行期执行出库迁移与共享文件搬移 + 本单普通文档编写（应随 doc 组提交）
  fs.rmSync(otherDoc);
  fs.rmSync(ownDoc);
  git(root, ['mv', path.join('agent-team-board', 'data', 'notes.md'), path.join('agent-team-board', 'data', 'notes2.md')]);
  fs.appendFileSync(path.join(core.resolveItemDir(dataDir, item.id).dir, 'README.md'), '\n板级共享轮补充\n');

  core.report(dataDir, item.id, { summary: '迁移完成', by: 'w1', run: { runId: nx.runId } });
  const { receipt } = batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });
  assert.equal(receipt.autoCommit.status, 'committed');

  // 出库删除、重命名与条目普通文档均随本单 doc 组提交
  const subjects = logSubjects(root).filter((s) => s.includes(item.id));
  assert.ok(subjects.some((s) => s.startsWith('doc: ')), `板级共享应随本单 doc 提交：${subjects.join(' | ')}`);
  const docHash = git(root, ['log', '--format=%H', '--grep=^doc: ', '-E']).stdout.split('\n').filter(Boolean)[0];
  const docFiles = commitFiles(root, docHash);
  assert.ok(docFiles.some((f) => f.endsWith('notes2.md')), '重命名目标应随 doc 组入库');
  const tracked = git(root, ['ls-files']).stdout;
  assert.ok(!tracked.includes('confirmations.md'), '出库迁移后 git 不得再跟踪 confirmations.md');

  // 本单条目普通文档随收口入库（收口后条目目录干净）
  const itemRel = relOf(root, core.resolveItemDir(dataDir, item.id).dir);
  const st = statusLines(root);
  assert.ok(!st.some((l) => l.slice(3).trim().startsWith(itemRel + '/')), `条目目录应已入库：\n${st.join('\n')}`);
});

// ---------- N6 回归：pendingManual 暂扣与挂起语义保持（预留前已脏非看板源码） ----------

t('N6 预留前已脏非看板源码：test/业务暂扣、挂起照常；doc 组照常提交（含条目文档），状态 committed（部分提交）', () => {
  const root = mkProject();
  const { dataDir, item, itemDir, receipt } = runMixedFlow(root, { preDirtySource: true });

  assert.ok(receipt.suspended, '预留前已脏源码路径应触发挂起');
  assert.equal(receipt.suspended.blockType, 'commit');
  assert.equal(receipt.autoCommit.status, 'committed', 'doc 组（含条目文档）照常提交，部分提交标记 committed');
  assert.equal(receipt.autoCommit.commits.length, 1, '只提交 doc 组');
  assert.ok(Array.isArray(receipt.autoCommit.pendingManual) && receipt.autoCommit.pendingManual.includes('scripts/web/build.js'),
    '回执应携带待人工路径 scripts/web/build.js');

  const st = statusLines(root);
  assert.ok(st.some((l) => l.slice(3).trim() === 'scripts/tests/feature-x.test.mjs'), '测试应暂扣保留在工作区');
  assert.ok(st.some((l) => l.slice(3).trim() === 'scripts/lib/feature-x.mjs'), '业务改动应暂扣保留在工作区');
  const itemRel = relOf(root, itemDir);
  assert.ok(!st.some((l) => l.slice(3).trim().startsWith(itemRel + '/')), '条目文档应随 doc 组入库（不再滞留工作区）');
  assert.ok(confirmStates.confirmOf(dataDir, item.id), '应已声明待人工确认提交记录');
});

// ---------- N7 幂等：收口成功后重试不重复提交、根文档仍未提交 ----------

t('N7 收口成功（根文档被忽略保留）后 run autocommit 重试：不产生新提交、根文档仍未提交、不挂起', () => {
  const root = mkProject();
  const { runId } = runMixedFlow(root, { preDirtyRoot: true });
  const afterCount = logSubjects(root).length;

  const r = batch.retryAutoCommit(core.dataDirFrom(root), runId);
  assert.equal(r.autoCommit.status, 'skipped', `重试应跳过：${JSON.stringify(r.autoCommit.reason)}`);
  assert.equal(r.autoCommit.commits.length, 0);
  assert.equal(logSubjects(root).length, afterCount, '重试不得产生新提交');

  const st = statusLines(root);
  for (const doc of ['README.md', 'AGENTS.md', 'NOTES.md']) {
    assert.ok(st.some((l) => l.slice(3).trim() === doc), `重试后根文档应仍未提交：${doc}`);
  }
});

// ---------- N8 仅条目文档改动：doc 组提交不挂起 ----------

t('N8 仅条目文档改动：doc 组提交（committed）、不挂起、批次继续派发', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '纯条目文档轮单');
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

  assert.equal(receipt.autoCommit.status, 'committed', '条目文档随收口 doc 组提交');
  assert.equal(receipt.autoCommit.commits.length, 1);
  const hashes = newHashes(root, beforeCount);
  assert.equal(hashes.length, 1, '只应有 doc 一组提交');
  assert.ok(git(root, ['show', '--name-only', '--format=', hashes[0]]).stdout.includes('design.md'), 'doc 提交应含条目文档');
  assert.ok(!receipt.suspended, '纯条目文档轮不应挂起');
  assert.ok(!confirmStates.confirmOf(dataDir, item.id), '不应声明待人工确认提交');
  const bt = batch.getBatch(dataDir, nx.batchId);
  assert.ok(!bt.pauseRequested, '批次不应被暂停');
});

// ---------- N9 表述同步 ----------

t('N9 流程表述已按新口径更新：条目文档随收口提交；根目录文档不随收口提交且不触发暂扣；不再引用 REQ-20260922-007', () => {
  const read = (p) => fs.readFileSync(path.join(pluginRoot, p), 'utf8');
  const agents = read('AGENTS.md');
  assert.ok(agents.includes('REQ-20260923-002'), 'AGENTS.md 应引用本单口径');
  assert.ok(!agents.includes('REQ-20260922-007'), 'AGENTS.md 不应再引用 REQ-20260922-007 口径');
  assert.ok(/根(第一层|目录)文档/.test(agents) && agents.includes('不随收口提交'), 'AGENTS.md 应写明根目录文档不随收口提交');

  const skill = read('skills/agent-team-board/SKILL.md');
  assert.ok(skill.includes('REQ-20260923-002'), 'SKILL.md 应引用本单口径');
  assert.ok(!skill.includes('REQ-20260922-007'), 'SKILL.md 不应再引用 REQ-20260922-007 口径');

  const closeoutDoc = read('skills/agent-team-board/dev-closeout.md');
  assert.ok(closeoutDoc.includes('REQ-20260923-002'), 'dev-closeout.md 应引用本单口径');
  assert.ok(!closeoutDoc.includes('REQ-20260922-007'), 'dev-closeout.md 不应再引用 REQ-20260922-007 口径');
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
