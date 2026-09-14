#!/usr/bin/env node
// BUG-20260913-006 批量实施 auto-commit 漏提交预留时已脏的业务源码 —— 回归测试
// 用法：node scripts/tests/auto-commit-pre-dirty-20260913-006.test.mjs
// 覆盖：
//   · 快照升级：预留时已脏的已跟踪文件记录内容哈希（trackedHashes）；
//   · 差集三态：未动（不计入）/ 同码但内容变（dirtyTouched，待人工）/ 码变或新脏（changed）；
//     旧快照（无哈希基线）维持升级前行为；
//   · 端到端核心：预留前已脏 + 运行期修改 → pendingManual 显式化（回执 + auto-commit.json
//     明细含路径与建议）、test/业务组暂扣（提交历史自洽）、doc 组照常提交；
//   · 回归：未动的预留前脏路径不卷入、预留时干净路径照常三组、未跟踪哈希机制不受影响；
//   · 全部待人工且无 doc 可提交 → 如实 skipped、账本不点亮徽标；
//   · 幂等：重复回执幂等、atb run autocommit 重试不产生新提交。
// 模式对齐 dev-flow-20260911-009.test.mjs（真实 git 临时仓库 + 端到端经 batch.finishRun）。

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';
import * as commitStore from '../lib/commit-store.mjs';
import * as gitFlow from '../lib/git-flow.mjs';

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
  const r = spawnSync(process.execPath, [ATB, ...args, '--dir', cwd], { encoding: 'utf8', timeout: 90_000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function jsonOf(r) {
  return JSON.parse(r.out.split('\n').filter(Boolean).pop());
}

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-predirty-')));
}

// 已有提交的 git 项目（main 起步），看板数据已提交
function mkProject() {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(root, 'README.md'), '# t\n');
  core.initData(root);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 初始化测试仓库']);
  return root;
}

function mkPlannedItem(dataDir, title, type = 'bug') {
  const x = core.createItem(dataDir, { type, title });
  core.setStatus(dataDir, x.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, x.id, 'planned', { by: 'human' });
  return x;
}

const logSubjectsOf = (root, itemId) =>
  git(root, ['log', '--format=%s']).stdout.split('\n').filter(Boolean).filter((s) => s.includes(itemId));

// ---------- 快照与差集（识别层） ----------

t('P1 快照升级：预留时已脏的已跟踪文件记录内容哈希；干净文件不入快照；未跟踪走 untracked 哈希', () => {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(root, 'clean.js'), 'c\n');
  fs.writeFileSync(path.join(root, 'dirty.js'), 'd1\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: base']);
  fs.writeFileSync(path.join(root, 'dirty.js'), 'd2\n'); // 预留前已脏（' M'）
  fs.writeFileSync(path.join(root, 'new.txt'), 'n\n'); // 未跟踪（??）
  const snap = gitFlow.workingTreeSnapshot(root);
  assert.equal(snap.entries['dirty.js'], ' M');
  assert.match(snap.trackedHashes['dirty.js'], /^[0-9a-f]{40}$/, '预留时已脏的已跟踪文件应记录内容哈希');
  assert.equal(snap.entries['clean.js'], undefined, '干净文件不入快照');
  assert.equal(snap.trackedHashes['clean.js'], undefined);
  assert.match(snap.untracked['new.txt'], /^[0-9a-f]{40}$/, '未跟踪文件继续记录 untracked 哈希');
  assert.equal(snap.trackedHashes['new.txt'], undefined, '未跟踪不混入 trackedHashes');
});

t('P2 差集三态：未动不计入；同码但内容变 → dirtyTouched；码变/新脏 → changed；旧快照无哈希基线维持旧行为', () => {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  for (const f of ['b1.js', 'b2.js', 'c.js']) fs.writeFileSync(path.join(root, f), `${f}\n`);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: base']);
  fs.appendFileSync(path.join(root, 'b1.js'), '预留前脏\n');
  fs.appendFileSync(path.join(root, 'b2.js'), '预留前脏\n');
  const snap = gitFlow.workingTreeSnapshot(root);
  // 运行期：b2 再改（状态码仍 ' M'）；c 从干净变脏；b1 未动
  fs.appendFileSync(path.join(root, 'b2.js'), '本单改动\n');
  fs.appendFileSync(path.join(root, 'c.js'), '本单改动\n');
  const diff = gitFlow.diffWorkingTree(root, snap);
  assert.deepEqual(diff.changed, ['c.js'], '码变/新脏路径进 changed');
  assert.deepEqual(diff.dirtyTouched, ['b2.js'], '同码但内容变化路径进 dirtyTouched（预留前已脏且本单动过）');
  const union = gitFlow.changedPathsSince(root, snap);
  assert.ok(union.includes('c.js') && union.includes('b2.js') && union.length === 2, '兼容口径应含全部变化路径');
  assert.ok(!union.includes('b1.js'), '预留前已脏且未动过的路径不计入');
  // 旧快照（无 trackedHashes 字段）：无内容基线，b2 不被识别，维持升级前行为（不猜测归因）
  const old = { entries: snap.entries, untracked: snap.untracked, at: snap.at };
  const diff2 = gitFlow.diffWorkingTree(root, old);
  assert.deepEqual(diff2.dirtyTouched, []);
  assert.deepEqual(diff2.changed, ['c.js']);
});

// ---------- 端到端（处置层，经 batch.nextItem 预留 → 认领 → report → finishRun） ----------

// 核心复现场景（README 复现步骤 1–6）：build.js 预留前已脏（上一单遗留），本单运行期
// 再改 build.js（状态码不变）+ 新增干净的 test/biz 改动 + 本单条目文档补充。
function runPreDirtyFlow(root) {
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '预留前脏路径自动提交单');
  fs.mkdirSync(path.join(root, 'scripts', 'web'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'web', 'build.js'), 'base\n');
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'impl.mjs'), 'v1\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 被测源码入库']);
  fs.appendFileSync(path.join(root, 'scripts', 'web', 'build.js'), '上一单遗留脏改动\n'); // 预留前已脏

  batch.createBatch(dataDir, { projectRoot: root });
  const nx = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w1' });
  core.claim(dataDir, item.id, 'w1');
  // 运行期：修改预留前已脏的 build.js + 新增干净 test/biz 改动 + 本单条目文档
  fs.appendFileSync(path.join(root, 'scripts', 'web', 'build.js'), '本单实现改动\n');
  fs.mkdirSync(path.join(root, 'scripts', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'tests', 'impl.test.mjs'), 'import assert from "node:assert/strict";\n');
  fs.appendFileSync(path.join(root, 'scripts', 'lib', 'impl.mjs'), 'v2\n');
  fs.appendFileSync(path.join(nx.itemDir, 'README.md'), '\n实施补充\n');
  core.report(dataDir, item.id, { summary: '实施完成', by: 'w1', run: { runId: nx.runId } });
  const { receipt } = batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });
  return { dataDir, item, runId: nx.runId, receipt };
}

t('P3 核心场景：预留前已脏且运行期被修改的路径不再静默留脏——列入 pendingManual 并如实标记；test/业务组暂扣保证历史自洽；doc 组照常提交', () => {
  const root = mkProject();
  const { dataDir, item, runId, receipt } = runPreDirtyFlow(root);

  const ac = receipt.autoCommit;
  assert.equal(ac.status, 'committed', 'doc 组照常提交');
  assert.equal(ac.commits.length, 1, '只应有 doc 一个提交');
  assert.ok(Array.isArray(ac.pendingManual) && ac.pendingManual.includes('scripts/web/build.js'),
    '回执应显式携带待人工路径 scripts/web/build.js');
  assert.ok(ac.reason && ac.reason.includes('待人工'), 'reason 应说明待人工处理');

  // 提交历史自洽：不再产生「测试已提交、被测实现（build.js）未提交」的矛盾组合
  const subjects = logSubjectsOf(root, item.id);
  assert.equal(subjects.length, 1, '只应有 doc 提交');
  assert.ok(subjects[0].startsWith('doc: '));
  for (const s of subjects) {
    assert.equal(commitStore.validateCommitSubject(s, item.id), null, `消息须过规范核验：${s}`);
  }

  // build.js 与暂扣的 test/业务改动都保留在工作区（未被卷入提交，也未被静默丢弃）
  const st = git(root, ['status', '--porcelain', '-uall']).stdout;
  assert.match(st, /M\s+scripts\/web\/build\.js/, 'build.js 应保留为未提交脏改动');
  assert.match(st, /impl\.test\.mjs/, '暂扣的 test 改动应保留在工作区');
  assert.match(st, /impl\.mjs/, '暂扣的业务改动应保留在工作区');

  // 账本如实：auto-commit.json 明细记录 pendingManual（路径 + 建议）与 heldGroups
  const detail = JSON.parse(fs.readFileSync(
    path.join(core.dataDirFrom(root), 'dispatch', 'runs', runId, 'auto-commit.json'), 'utf8'));
  assert.ok(detail.pendingManual.includes('scripts/web/build.js'), '明细应记录待人工路径');
  assert.ok(detail.pendingManualAdvice && detail.pendingManualAdvice.includes('人工'), '明细应带人工处理建议');
  assert.ok(detail.heldGroups && detail.heldGroups.test.includes('scripts/tests/impl.test.mjs'),
    '明细应记录暂扣的 test 组路径');
  assert.ok(detail.heldGroups.biz.includes('scripts/lib/impl.mjs'), '明细应记录暂扣的业务组路径');
  // 徽标账本只登记已发生的 doc 提交（与实际一致，不误点亮多组）
  const idx = commitStore.committedItemIndex(dataDir);
  assert.equal((idx.get(item.id) || { commits: [] }).commits.length, 1);
});

t('P4 回归：未动的预留前脏路径不计入不卷入；预留时干净路径照常三组提交；未跟踪内容哈希机制不受影响', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '回归基准单');
  fs.mkdirSync(path.join(root, 'scripts', 'web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'web', 'build.js'), 'base\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: build.js 入库']);
  fs.appendFileSync(path.join(root, 'scripts', 'web', 'build.js'), '预留前脏改动\n'); // 预留前已脏
  fs.writeFileSync(path.join(root, 'scratch.md'), '预留前未跟踪\n'); // 预留前已存在的未跟踪文件

  batch.createBatch(dataDir, { projectRoot: root });
  const nx = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w1' });
  core.claim(dataDir, item.id, 'w1');
  // 运行期不动 build.js；scratch.md 追加内容（?? 同码内容变 → 按原口径整文件归本单）
  fs.appendFileSync(path.join(root, 'scratch.md'), '本单补充\n');
  fs.writeFileSync(path.join(root, 'biz.txt'), 'b\n');
  fs.mkdirSync(path.join(root, 'scripts', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'tests', 'x.test.mjs'), 't\n');
  core.report(dataDir, item.id, { summary: '完成', by: 'w1', run: { runId: nx.runId } });
  const { receipt } = batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });

  const ac = receipt.autoCommit;
  assert.equal(ac.status, 'committed');
  assert.equal(ac.commits.length, 3, 'doc/test/业务三组照常提交');
  assert.ok(!ac.pendingManual, '无待人工路径时不得出现 pendingManual 字段');
  const st = git(root, ['status', '--porcelain', '-uall']).stdout;
  assert.match(st, /M\s+scripts\/web\/build\.js/, '未动过的预留前脏路径不得被卷入提交');
  assert.ok(!st.includes('scratch.md'), '预留前未跟踪但运行期改动的文件应整文件提交（原口径不变）');
  assert.ok(!st.includes('biz.txt'), '预留时干净的新脏路径照常提交');
});

t('P5 全部非看板改动均待人工且无 doc 可提交：状态如实 skipped（不误报 committed）、明细仍落盘、无提交不点亮徽标', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '纯待人工单');
  fs.mkdirSync(path.join(root, 'scripts', 'web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'web', 'build.js'), 'base\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: build.js 入库']);
  fs.appendFileSync(path.join(root, 'scripts', 'web', 'build.js'), '预留前脏\n');

  batch.createBatch(dataDir, { projectRoot: root });
  const nx = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w1' });
  core.claim(dataDir, item.id, 'w1');
  fs.appendFileSync(path.join(root, 'scripts', 'web', 'build.js'), '本单改动\n');
  core.report(dataDir, item.id, { summary: '完成', by: 'w1', run: { runId: nx.runId } });
  // 预提交整个看板数据目录（含条目目录、dispatch/runs 与账本 .gitignore，不带单号），
  // 清空 doc 组 → 制造「只有待人工路径」的收尾
  const gi = path.join(dataDir, '.gitignore');
  const giCur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  fs.writeFileSync(gi, giCur.replace(/\n*$/, '\n') + 'commits/runs/\ncommits/batches/\n');
  git(root, ['add', path.relative(root, dataDir)]);
  git(root, ['commit', '-q', '-m', 'chore: 预提交看板数据与条目状态']);

  const { receipt } = batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });
  const ac = receipt.autoCommit;
  assert.equal(ac.status, 'skipped', '无任何可自动提交分组时不得表现为 committed');
  assert.ok(ac.reason && ac.reason.includes('待人工'), 'reason 应说明待人工处理');
  assert.deepEqual(ac.pendingManual, ['scripts/web/build.js']);
  assert.equal(logSubjectsOf(root, item.id).length, 0, '不得产生任何本单提交');
  const detail = JSON.parse(fs.readFileSync(
    path.join(dataDir, 'dispatch', 'runs', nx.runId, 'auto-commit.json'), 'utf8'));
  assert.ok(detail.pendingManual.includes('scripts/web/build.js'), '明细仍应落盘记录待人工路径');
  assert.ok(!commitStore.committedItemIndex(dataDir).get(item.id), '徽标账本不得点亮');
});

t('P6 幂等：待人工回执重复收尾幂等返回；atb run autocommit 重试因历史已含单号跳过，不产生新提交', () => {
  const root = mkProject();
  const { dataDir, item, runId } = runPreDirtyFlow(root);
  assert.equal(logSubjectsOf(root, item.id).length, 1);
  const r2 = batch.finishRun(dataDir, runId, { result: 'reported', reportRef: 'test-report.md' });
  assert.equal(r2.idempotent, true, '重复回执应幂等返回');
  const again = atb(['run', 'autocommit', runId, '--json'], root);
  assert.equal(again.code, 0, `重试入口应成功（${again.err}）`);
  const ac = jsonOf(again).autoCommit;
  assert.equal(ac.status, 'skipped');
  assert.match(ac.reason, /幂等|已含/, '应按幂等口径跳过');
  assert.equal(logSubjectsOf(root, item.id).length, 1, '不得产生重复提交');
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
