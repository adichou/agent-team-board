#!/usr/bin/env node
// REQ-20260914-001 自动提交不完整时挂起条目并暂停队列，人工确认后恢复开发 —— 开发侧核心回归
// 用法：node scripts/tests/confirm-block-20260914-001.test.mjs
// 覆盖（test-cases C01–C14 开发侧）：
//   · C01 预留前已脏且本单修改 → 挂起（待人工确认提交）+ 暂停队列；doc 已提交不视为完成；
//   · C02 分组提交失败 → 保留已成功提交 hash，不重复提交，仍阻止后续领取；
//   · C03 挂起后 batch next / claim / 新批次创建统一拒绝并返回阻塞条目；
//   · C04 刷新/重启/新会话：账本与占用持久化（新进程 claim 同样被拒）；
//   · C05 人工核对确认 → 授权补交 + 完整性与测试复验通过 → 收尾恢复，后续仅派发一次；
//   · C06 内容已变 / 指纹过期 / 测试失败 → 保持挂起并逐项说明，可重新核验；
//   · C07 重复确认幂等（不重复 commit、不重复派发）；
//   · C08 人工已在终端补交：核验识别（不凭任意带单号 commit 直接通过，需路径全部入库）；
//   · C09 纯文档 / 无改动任务不误挂起；
//   · C10 保持挂起保留现场；人工恢复领取也不绕过（显式终止才取消）；
//   · C12 人工确认提交不自动 done；
//   · C13 当前单核验与补交仍可执行（不发生执行权死锁）；
//   · C14 历史部分提交账本恢复视图（仍脏才呈现，已补交不误报）。
// 模式对齐 auto-commit-pre-dirty-20260913-006.test.mjs（真实 git 临时仓库 + 端到端经 batch.finishRun）。

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';
import * as confirmStore from '../lib/confirm-store.mjs';
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
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-confirm-')));
}

// 已有提交的 git 项目（main 起步），看板数据已提交；带一个可运行的轻量测试脚本（npm test）
function mkProject({ failingTest = false } = {}) {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(root, 'README.md'), '# t\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture', version: '1.0.0', private: true,
    scripts: { test: `node -e "process.exit(${failingTest ? 1 : 0})"` },
  }, null, 2));
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

// 预置被测源码 + 预留前已脏的 build.js（复现路径与 BUG-20260913-006 相同）
function seedPreDirtySource(root) {
  fs.mkdirSync(path.join(root, 'scripts', 'web'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'web', 'build.js'), 'base\n');
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'impl.mjs'), 'v1\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 被测源码入库']);
  fs.appendFileSync(path.join(root, 'scripts', 'web', 'build.js'), '上一单遗留脏改动\n'); // 预留前已脏
}

// 一单完整流转（触发挂起）：预留 → 认领 → 运行期改动（含再动预留前已脏 build.js）→ report → 收尾
function runHeldFlow(root, item, title) {
  const dataDir = core.dataDirFrom(root);
  batch.createBatch(dataDir, { projectRoot: root });
  const nx = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w1' });
  assert.equal(nx.itemId, item.id, `应领取目标条目（得到 ${nx.itemId}）`);
  core.claim(dataDir, item.id, 'w1');
  fs.appendFileSync(path.join(root, 'scripts', 'web', 'build.js'), `本单实现改动 ${title}\n`);
  fs.mkdirSync(path.join(root, 'scripts', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'tests', `${item.id}.test.mjs`), 'import assert from "node:assert/strict";\n');
  fs.appendFileSync(path.join(root, 'scripts', 'lib', 'impl.mjs'), 'v2\n');
  fs.appendFileSync(path.join(nx.itemDir, 'README.md'), '\n实施补充\n');
  core.report(dataDir, item.id, { summary: '实施完成', by: 'w1', run: { runId: nx.runId } });
  const { receipt } = batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });
  return { dataDir, runId: nx.runId, receipt };
}

// ---------- C01：挂起声明与队列暂停 ----------

t('C01 预留前已脏且本单修改：挂起当前单 + 暂停队列；doc 已提交不视为完成；运行/条目状态如实', () => {
  const root = mkProject();
  seedPreDirtySource(root);
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '挂起复现单');
  const standby = mkPlannedItem(dataDir, '后续等待单');
  const { receipt } = runHeldFlow(root, item, 'C01');

  // 回执显式携带挂起标记
  assert.ok(receipt.suspended, '回执应携带 suspended 标记');
  assert.equal(receipt.suspended.blockType, 'commit');
  assert.ok(receipt.suspended.reason.includes('不完整') || receipt.suspended.reason.includes('人工'), `挂起原因应说明待人工：${receipt.suspended.reason}`);

  // 挂起确认记录：waiting / develop / commit，指纹绑定待人工路径
  const rec = confirmStates.confirmOf(dataDir, item.id);
  assert.ok(rec, '应创建挂起确认记录');
  assert.equal(rec.state, 'waiting');
  assert.equal(rec.kind, 'develop');
  assert.equal(rec.blockType, 'commit');
  assert.ok(rec.fingerprint.files['scripts/web/build.js'], '指纹应绑定待人工路径');
  assert.ok(rec.pendingManual.includes('scripts/web/build.js'));
  assert.ok(rec.heldGroups && rec.heldGroups.test.length >= 1, '暂扣 test 组应记录');
  assert.equal(rec.committedGroups.length, 1, 'doc 组提交应保留 hash');

  // 队列持久化暂停 + 项目实施占用（attentionKind=confirm，不释放执行权）
  const bt = batch.getBatch(dataDir, batch.queueHeadBatch(dataDir).batchId);
  assert.equal(bt.pauseRequested, true, '批次应持久化 pauseRequested');
  assert.equal(bt.status, 'paused');
  const lock = core.readImplLockIfExists(dataDir);
  assert.ok(lock && lock.attention === true && lock.attentionKind === 'confirm', `impl.lock 应带 confirm attention：${JSON.stringify(lock)}`);

  // 文档提交不视为完成：条目保持 in-progress（待人工确认），不进 done/待测试成功态
  const st = core.getItemDetail(dataDir, item.id);
  assert.equal(st.status, 'in-progress');
  assert.ok(st.lastReport, '已上报（reported 回执）——挂起只阻塞队列，不改条目终态');
  void standby;

  // 条目目录留痕文档
  assert.ok(fs.existsSync(path.join(core.resolveItemDir(dataDir, item.id).dir, 'confirmations.md')), '条目目录应有 confirmations.md 留痕');
});

// ---------- C03/C04：统一守卫与持久化 ----------

t('C03 挂起后 batch next / claim / 新批次统一拒绝并返回阻塞条目；C04 新进程（新会话）同样被拒', () => {
  const root = mkProject();
  seedPreDirtySource(root);
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '守卫单');
  const standby = mkPlannedItem(dataDir, '守卫后续单');
  runHeldFlow(root, item, 'C03');

  // batch next：stop=paused + notice 指明阻塞条目（不派空 worker）
  const head = batch.queueHeadBatch(dataDir).batchId;
  const nx = batch.nextItem(dataDir, head, { owner: 'w2' });
  assert.equal(nx.stop, 'paused');
  assert.ok(nx.notice.includes(item.id) && nx.notice.includes('待人工确认提交'), `notice 应指明阻塞条目：${nx.notice}`);

  // claim：项目级挂起防呆（任何条目、任何 owner）
  assert.throws(() => core.claim(dataDir, standby.id, 'w2'), /挂起|待人工确认/);
  assert.throws(() => core.claim(dataDir, standby.id, 'w1'), /挂起|待人工确认/);

  // 新批次创建被拒（挂起期间不得开新一轮：既有批次未结束 / 项目暂停同口径拒绝）
  assert.throws(() => batch.createBatch(dataDir, { projectRoot: root }), /进行中|挂起|暂停|attention|核对/);

  // C04 新进程（模拟重启/新会话）：账本与占用都在磁盘，atb claim 同样被拒
  const r = atb(['claim', standby.id, '--by', 'fresh-session'], root);
  assert.notEqual(r.code, 0, '新进程 claim 应被拒');
  assert.ok(r.err.includes('待人工确认') || r.err.includes('挂起'), `拒绝原因应指向挂起确认：${r.err}`);
  const lst = atb(['confirm', 'list', '--json'], root);
  assert.equal(lst.code, 0);
  const parsed = JSON.parse(lst.out.split('\n').filter(Boolean).pop());
  assert.equal(parsed.count, 1);
  assert.equal(parsed.items[0].itemId, item.id);
});

// ---------- C05/C12/C13：人工确认闭环（核验 → 补交 → 测试 → 恢复） ----------

t('C05 人工核对确认：指纹核验 → 授权补交 → 测试复验通过 → 收尾恢复队列，后续仅派发一次；C12 不自动 done；C13 核验补交不死锁', async () => {
  const root = mkProject();
  seedPreDirtySource(root);
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '确认恢复单');
  const standby = mkPlannedItem(dataDir, '恢复后续单');
  const { runId } = runHeldFlow(root, item, 'C05');
  const head = batch.queueHeadBatch(dataDir).batchId;

  // C13：当前单的核验入口在挂起占用下仍可执行（不发生执行权死锁）
  const v0 = confirmStore.verifyCommitConfirm(dataDir, item.id, { projectRoot: root, runTests: false });
  assert.equal(v0.ok, false, '待人工路径仍在工作区：核验应未通过');
  assert.ok(v0.reasons.some((r) => r.includes('未入库')), `核验应列出未入库路径：${v0.reasons.join('；')}`);

  // 确认并继续：携带声明时指纹（人工所见内容版本）
  const rec = confirmStates.confirmOf(dataDir, item.id);
  const r1 = confirmStore.confirmCommitContinue(dataDir, item.id, {
    projectRoot: root, fingerprint: rec.fingerprint,
  });
  assert.ok(r1.ok, `确认应成功：${JSON.stringify(r1.reasons || [])}`);
  assert.ok((r1.supplementCommits || []).length >= 1, '应产生补交提交');
  const subjects = logSubjectsOf(root, item.id);
  assert.ok(subjects.some((s) => s.startsWith('doc: ')), 'doc 组已提交');
  assert.ok(subjects.some((s) => s.startsWith('fix: ') && s.includes('人工确认补交')), `应有授权补交提交：${subjects.join(' | ')}`);
  const st = git(root, ['status', '--porcelain', '-uall']).stdout;
  assert.ok(!st.includes('build.js') && !st.includes('impl.mjs') && !st.includes('test.mjs'), `工作区应清干净：\n${st}`);

  // 服务端恢复队列（确认成功后的编排动作）
  const resume = batch.resumeAfterConfirm(dataDir, head);
  assert.ok(resume.ok && !resume.alreadyTerminal);
  assert.equal(batch.getBatch(dataDir, head).pauseRequested, false);
  assert.equal(core.readImplLockIfExists(dataDir), null, '恢复后应解除项目实施占用');

  // C12：条目不自动 done（仍走人工确认完成）
  assert.equal(core.getItemDetail(dataDir, item.id).status, 'in-progress');

  // 后续条目恰好派发一次
  const nx2 = batch.nextItem(dataDir, head, { owner: 'w2' });
  assert.equal(nx2.itemId, standby.id);
  assert.equal(nx2.runId && true, true, '应产生新预留');

  // C07 幂等：重复确认直接成功且不产生新提交
  const before = logSubjectsOf(root, item.id).length;
  const r2 = confirmStore.confirmCommitContinue(dataDir, item.id, {
    projectRoot: root, fingerprint: confirmStates.confirmOf(dataDir, item.id).fingerprint,
  });
  assert.equal(r2.ok, true);
  assert.equal(r2.idempotent, true, '重复确认应幂等');
  assert.equal(logSubjectsOf(root, item.id).length, before, '幂等确认不得产生重复提交');
  assert.equal(confirmStates.confirmOf(dataDir, item.id).state, 'resolved');
  void runId;
});

// ---------- C06：内容已变 / 指纹过期 / 测试失败保持挂起 ----------

t('C06a 内容已变（脏→脏内容变）：过期确认被拒，保持挂起并说明，可重新核验', () => {
  const root = mkProject();
  seedPreDirtySource(root);
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '过期确认单');
  runHeldFlow(root, item, 'C06');
  // 人工在确认前又改了待人工路径内容（脏→脏但内容变）
  fs.appendFileSync(path.join(root, 'scripts', 'web', 'build.js'), '人工再改动（未确认）\n');
  const rec = confirmStates.confirmOf(dataDir, item.id);
  const r = confirmStore.confirmCommitContinue(dataDir, item.id, {
    projectRoot: root, fingerprint: rec.fingerprint,
  });
  assert.equal(r.ok, false, '过期确认应被拒');
  assert.ok(r.reasons.some((x) => x.includes('内容已变') || x.includes('不一致')), `应说明内容已变：${r.reasons.join('；')}`);
  assert.equal(confirmStates.confirmOf(dataDir, item.id).state, 'waiting', '应保持挂起');
  const v = confirmStore.verifyCommitConfirm(dataDir, item.id, { projectRoot: root, runTests: false });
  assert.equal(v.ok, false, '可重新核验（仍列出未入库路径）');
});

t('C06b 补交后测试失败：保持挂起并逐项说明（测试验证的是提交后的完整内容）', () => {
  const root = mkProject({ failingTest: true });
  seedPreDirtySource(root);
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '测试失败单');
  runHeldFlow(root, item, 'C06b');
  const rec = confirmStates.confirmOf(dataDir, item.id);
  const r = confirmStore.confirmCommitContinue(dataDir, item.id, {
    projectRoot: root, fingerprint: rec.fingerprint,
  });
  assert.equal(r.ok, false, '测试失败应保持挂起');
  assert.ok(r.reasons.some((x) => x.includes('测试未通过')), `应说明测试失败：${r.reasons.join('；')}`);
  const cur = confirmStates.confirmOf(dataDir, item.id);
  assert.equal(cur.state, 'waiting');
  assert.ok(cur.verify && cur.verify.test && cur.verify.test.ok === false, '核验记录应保留测试结果');
  // 队列仍暂停：后续不派发
  const head = batch.queueHeadBatch(dataDir).batchId;
  assert.equal(batch.getBatch(dataDir, head).pauseRequested, true);
  const nx = batch.nextItem(dataDir, head, { owner: 'w2' });
  assert.equal(nx.stop, 'paused');
});

// ---------- C08：人工已在终端补交 ----------

t('C08 人工已在终端补交：脏→clean 允许方向；不凭任意带单号 commit 直接通过（需路径全部入库）', () => {
  const root = mkProject();
  seedPreDirtySource(root);
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '终端补交单');
  runHeldFlow(root, item, 'C08');
  // 人工只在终端补交了 build.js（带单号），暂扣的 test/biz 仍在工作区
  git(root, ['add', '--', 'scripts/web/build.js']);
  git(root, ['commit', '-q', '--only', '-m', `fix: 人工终端补交 ${item.id}`, '--', 'scripts/web/build.js']);
  const rec = confirmStates.confirmOf(dataDir, item.id);
  // 只带一个无关紧要的带单号提交不直接通过：仍应补交暂扣组
  const r = confirmStore.confirmCommitContinue(dataDir, item.id, {
    projectRoot: root, fingerprint: rec.fingerprint,
  });
  assert.ok(r.ok, `确认应成功（终端补交 + 授权补交暂扣组）：${JSON.stringify(r.reasons || [])}`);
  const subjects = logSubjectsOf(root, item.id);
  assert.ok(subjects.includes(`fix: 人工终端补交 ${item.id}`), '终端补交保留');
  assert.ok(subjects.some((s) => s.startsWith('fix: 人工确认补交')), '暂扣组由授权补交收纳');
  const rec2 = confirmStates.confirmOf(dataDir, item.id);
  assert.ok(rec2.events.some((e) => e.kind === 'terminal-supplement'), '应识别并留痕终端补交');
});

// ---------- C02：分组提交失败保留 hash ----------

t('C02 分组提交失败：保留已成功提交 hash，不重复提交，仍挂起阻止后续领取', () => {
  const root = mkProject();
  // 干净源（无预留前脏路径 → 不走 pendingManual 分支）：doc 提交成功后 test/fix 被钩子拦下
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'impl.mjs'), 'v1\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 被测源码入库']);
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '部分失败单');
  batch.createBatch(dataDir, { projectRoot: root });
  const nx = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w1' });
  core.claim(dataDir, item.id, 'w1');
  fs.appendFileSync(path.join(nx.itemDir, 'README.md'), '\n实施补充\n');
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.appendFileSync(path.join(root, 'scripts', 'lib', 'impl.mjs'), 'v2\n');
  core.report(dataDir, item.id, { summary: '完成', by: 'w1', run: { runId: nx.runId } });
  // pre-commit 钩子拦掉业务组提交（doc: 放行 → 保留部分成功 hash）。钩子在消息写入前运行、
  // 读不到 -m 主题，故按暂存路径拦截：--only 提交的临时索引即该组路径（scripts/ 下非看板文件）。
  fs.writeFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\n files=$(git diff --cached --name-only 2>/dev/null)\n case "$files" in *scripts/tests/*|*scripts/lib/*) exit 1;; *) exit 0;; esac\n');
  fs.chmodSync(path.join(root, '.git', 'hooks', 'pre-commit'), 0o755);
  const { receipt } = batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });
  assert.equal(receipt.autoCommit.status, 'failed');
  assert.equal(receipt.autoCommit.commits.length, 1, '已成功的 doc 组 hash 应保留在结果中');
  assert.ok(receipt.suspended, '失败应触发挂起');
  const rec = confirmStates.confirmOf(dataDir, item.id);
  assert.ok(rec, '失败也应创建挂起确认记录');
  assert.equal(rec.committedGroups.length, 1, '声明时保留已成功提交 hash');
  assert.ok(rec.reason.includes('失败'), `原因应说明失败：${rec.reason}`);
  // 仍阻止后续领取
  const head = batch.queueHeadBatch(dataDir).batchId;
  assert.equal(batch.getBatch(dataDir, head).pauseRequested, true);
  assert.equal(batch.nextItem(dataDir, head, { owner: 'w2' }).stop, 'paused');
  // 人工确认（移除故障钩子后）：补交恰一次，doc 不重复
  fs.rmSync(path.join(root, '.git', 'hooks', 'pre-commit'));
  const r = confirmStore.confirmCommitContinue(dataDir, item.id, {
    projectRoot: root, fingerprint: rec.fingerprint,
  });
  assert.ok(r.ok, `修复故障后确认应成功：${JSON.stringify(r.reasons || [])}`);
  // 业务路径恰一次入库；doc 组允许补交留痕文档（confirmations.md 等新文件），同一内容不重复提交
  const implSubjects = git(root, ['log', '--format=%s', '--', 'scripts/lib/impl.mjs'])
    .stdout.split('\n').filter(Boolean).filter((x) => x.includes(item.id));
  assert.equal(implSubjects.length, 1, `impl.mjs 本单提交应恰一次（得到 ${implSubjects.join(' | ')}）`);
  assert.ok(logSubjectsOf(root, item.id).filter((s) => s.startsWith('doc: ')).length <= 2, 'doc 组至多两次（初始 + 留痕文档补交）');
});

// ---------- C09：纯文档 / 无改动不误挂起 ----------

t('C09 纯文档任务按文件范围核验不误挂起；无改动任务记录可验证原因（skipped 不挂起）', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const docItem = mkPlannedItem(dataDir, '纯文档单', 'requirement');
  const noChgItem = mkPlannedItem(dataDir, '无改动单', 'requirement');
  batch.createBatch(dataDir, { projectRoot: root });
  const nx1 = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w1' });
  core.claim(dataDir, docItem.id, 'w1');
  fs.appendFileSync(path.join(nx1.itemDir, 'README.md'), '\n纯文档补充：描述与验收\n');
  core.report(dataDir, docItem.id, { summary: '文档完成', by: 'w1', run: { runId: nx1.runId } });
  const r1 = batch.finishRun(dataDir, nx1.runId, { result: 'reported', reportRef: 'test-report.md' });
  assert.ok(!r1.receipt.suspended, '纯文档提交完整不挂起');
  assert.ok(!confirmStates.confirmOf(dataDir, docItem.id));
  const head = batch.queueHeadBatch(dataDir).batchId;
  const nx2 = batch.nextItem(dataDir, head, { owner: 'w1' });
  assert.equal(nx2.itemId, noChgItem.id, '队列应继续派发');
  core.claim(dataDir, noChgItem.id, 'w1');
  core.report(dataDir, noChgItem.id, { summary: '无改动', by: 'w1', run: { runId: nx2.runId } });
  const r2 = batch.finishRun(dataDir, nx2.runId, { result: 'reported', reportRef: 'test-report.md' });
  assert.ok(!r2.receipt.suspended, '无业务改动不挂起');
  // 可验证原因：报告与看板文档照常入账（doc 组），或无任何可提交时 reason 落「无待提交改动」
  const ac2 = r2.receipt.autoCommit;
  assert.ok(ac2.status === 'committed' || (ac2.status === 'skipped' && /无待提交改动/.test(ac2.reason || '')),
    `无改动任务的提交账须可验证：${JSON.stringify(ac2)}`);
  assert.ok(!confirmStates.confirmOf(dataDir, noChgItem.id));
});

// ---------- C10：保持挂起与显式取消 ----------

t('C10 保持挂起保留现场与队列；人工恢复领取（显式）也不绕过挂起条目继续派发', () => {
  const root = mkProject();
  seedPreDirtySource(root);
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '保持挂起单');
  runHeldFlow(root, item, 'C10');
  const keep = confirmStore.keepConfirm(dataDir, item.id, { note: '归属待产品确认' });
  assert.equal(keep.ok, true);
  const rec = confirmStates.confirmOf(dataDir, item.id);
  assert.equal(rec.state, 'waiting', '保持挂起不解除阻塞');
  assert.equal(rec.keepNote, '归属待产品确认');
  const head = batch.queueHeadBatch(dataDir).batchId;
  // 人工显式「恢复后续领取」按钮：解除占用，但挂起确认仍在 → 仍不得派发后续
  batch.pauseBatch(dataDir, head, false);
  assert.equal(core.readImplLockIfExists(dataDir), null, '显式恢复解除占用');
  const nx = batch.nextItem(dataDir, head, { owner: 'w2' });
  assert.equal(nx.stop, 'paused', '挂起确认在：不得派发');
  assert.ok(nx.notice.includes(item.id), `notice 仍指明阻塞条目：${nx.notice}`);
  assert.throws(() => core.claim(dataDir, item.id, 'w1'), /挂起|待人工确认/, '认领仍被拒');
});

// ---------- C11：卡片与账本计数一致 ----------

t('C11 清单/详情计数一致：已提交组、待人工路径、部分提交徽标与账本同源', () => {
  const root = mkProject();
  seedPreDirtySource(root);
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '计数一致单');
  runHeldFlow(root, item, 'C11');
  const lst = confirmStore.listConfirms(dataDir, { projectRoot: root });
  assert.equal(lst.count, 1);
  const view = lst.items[0];
  assert.equal(view.itemId, item.id);
  assert.equal(view.committedCount, 1, '已提交组 = doc 1 组');
  const held = (view.pendingManual || []).length
    + (view.heldGroups ? view.heldGroups.test.length + view.heldGroups.biz.length : 0);
  assert.equal(view.pendingCount, held, '待人工计数 = pendingManual + 暂扣组');
  assert.equal(view.partialBadge, true, '部分提交显示不完整徽标');
  const d = confirmStore.confirmDetail(dataDir, item.id, { projectRoot: root });
  assert.equal(d.files.length, held, '详情文件表覆盖全部待人工路径');
  assert.ok(d.files.every((f) => f.state === '未提交' || f.state === '已入库'));
});

// ---------- C14：历史部分提交账本恢复 ----------

t('C14 旧部分提交/暂扣账本恢复：待人工路径仍脏 → 呈现待确认视图；已全部入库 → 不误报', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  // 手工构造一份历史运行账本（phase=reported + auto-commit.json 带 pendingManual）
  const item = mkPlannedItem(dataDir, '历史部分提交单');
  fs.mkdirSync(path.join(root, 'scripts', 'web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'web', 'legacy.js'), 'old\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: legacy 源码入库']);
  fs.appendFileSync(path.join(root, 'scripts', 'web', 'legacy.js'), '遗留未提交改动\n'); // 仍脏
  const runDir = path.join(dataDir, 'dispatch', 'runs', 'run-20990101-000000-0001');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
    runId: 'run-20990101-000000-0001', batchId: 'batch-20990101-001', itemId: item.id,
    owner: 'w0', phase: 'reported', createdAt: '2099-01-01T00:00:00.000Z', treeSnapshot: null,
  }));
  fs.writeFileSync(path.join(runDir, 'auto-commit.json'), JSON.stringify({
    status: 'committed', commits: [], pendingManual: ['scripts/web/legacy.js'], itemId: item.id,
    itemTitle: '历史部分提交单', createdAt: '2099-01-01T00:00:01.000Z',
  }));
  let views = confirmStore.legacyConfirmViews(dataDir, root);
  assert.equal(views.length, 1, '仍脏的历史账本应呈现恢复视图');
  assert.equal(views[0].itemId, item.id);
  assert.equal(views[0].legacy, true);
  assert.equal(views[0].state, 'waiting');
  // 人工在终端补齐后：不再呈现（不误报）
  git(root, ['add', '--', 'scripts/web/legacy.js']);
  git(root, ['commit', '-q', '--only', '-m', `fix: 人工补交 ${item.id}`, '--', 'scripts/web/legacy.js']);
  views = confirmStore.legacyConfirmViews(dataDir, root);
  assert.equal(views.length, 0, '已补交的历史账本不得再按待确认呈现');
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
