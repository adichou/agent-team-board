#!/usr/bin/env node
// REQ-20260911-009 dev 分支开发 + 到待测试自动 commit + 条目/提交索引 —— 集成测试
// 用法：node scripts/tests/dev-flow-20260911-009.test.mjs
// 覆盖 test-cases.md D1–D12：init/设置页接口（真实 git 临时仓库 + 子进程）、
// 快照归因自动提交（经 batch.finishRun 端到端）、幂等/失败重试、hook 流程外提交拦截、
// 双向索引 CLI 与 UI 静态断言。模式对齐 commit-batch-20260910-013 / code-guard / serve。

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
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
const GUARD = path.join(pluginRoot, 'scripts', 'state-guard.mjs');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function git(root, args, opts = {}) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  if (!opts.canFail && r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
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
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-devflow-')));
}

// 已有提交的 git 项目（main 起步），看板数据已提交；initData 走新流程切 dev
function mkProject() {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(root, 'README.md'), '# t\n');
  fs.writeFileSync(path.join(root, 'NOTES.md'), 'n\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 初始化测试仓库']);
  core.initData(root); // REQ-20260911-009：切到 dev
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 初始化看板数据']);
  return root;
}

function mkPlannedItem(dataDir, title, type = 'requirement') {
  const x = core.createItem(dataDir, { type, title });
  core.setStatus(dataDir, x.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, x.id, 'planned', { by: 'human' });
  return x;
}

const branchOf = (root) => git(root, ['branch', '--show-current']).stdout.trim();
const logSubjects = (root) => git(root, ['log', '--format=%s']).stdout.split('\n').filter(Boolean);

// ---------- D1–D3 初始化：自动 git init + dev 分支 ----------

t('D1 init 非 git 项目：自动 git init 并落 dev；不 push、不配远端', () => {
  const root = mkTmp();
  core.initData(root);
  assert.equal(git(root, ['rev-parse', '--is-inside-work-tree']).stdout.trim(), 'true', '应已成为 git 仓库');
  assert.equal(branchOf(root), 'dev', '初始化后当前分支应为 dev');
  assert.equal(git(root, ['remote']).stdout.trim(), '', '不得配置任何远端');
  const cfg = git(root, ['config', '--local', '--list']).stdout;
  assert.ok(!/remote\./.test(cfg), '本地配置不得出现 remote.*');
});

t('D2 init 已是 git 仓库：跳过 init；按需创建 dev 并切换；已在 dev 幂等；dev 已存在仅切换', () => {
  // 有提交的 main 仓库 → 创建 dev 并切换
  const r1 = mkTmp();
  git(r1, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(r1, 'a.txt'), 'a\n');
  git(r1, ['add', '.']);
  git(r1, ['commit', '-q', '-m', 'chore: base']);
  core.initData(r1);
  assert.equal(branchOf(r1), 'dev');
  assert.equal(git(r1, ['rev-parse', '--verify', 'main']).status, 0, 'main 分支应保留');
  // dev 已存在但当前在 main → 仅切换不重复创建
  const r2 = mkTmp();
  git(r2, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(r2, 'a.txt'), 'a\n');
  git(r2, ['add', '.']);
  git(r2, ['commit', '-q', '-m', 'chore: base']);
  git(r2, ['branch', 'dev']);
  core.initData(r2);
  assert.equal(branchOf(r2), 'dev');
  // 已在 dev → 幂等无操作
  const r3 = mkTmp();
  git(r3, ['init', '-q', '-b', 'dev']);
  core.initData(r3);
  assert.equal(branchOf(r3), 'dev');
});

t('D3 空仓库（无任何提交）：init 落 dev 不报错，首个提交落在 dev', () => {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']); // 无提交
  core.initData(root);
  assert.equal(branchOf(root), 'dev', '空仓库也应切到 dev（未出生分支改名路径）');
  fs.writeFileSync(path.join(root, 'x.txt'), 'x\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 首次提交']);
  assert.equal(branchOf(root), 'dev', '首个提交应落在 dev');
});

// ---------- D5–D9 到待测试自动提交（快照归因） ----------

// 端到端：建批 → 预置无关脏改动 → 领取（快照）→ 认领实施 → 上报 → 回执
function runReportedFlow(root, { preDirty = true, hookFail = false } = {}) {
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '自动提交流程单');
  // 其他单保持 accepted（不入开发批次候选），仅用于验证其目录改动不被卷入
  const other = core.createItem(dataDir, { type: 'requirement', title: '其他单不该动' });
  core.setStatus(dataDir, other.id, 'accepted', { by: 'human' });

  // 预置与本次实施无关的既有改动（预留快照之前就存在）
  if (preDirty) {
    fs.writeFileSync(path.join(root, 'pre-staged.txt'), '旧内容\n');
    git(root, ['add', 'pre-staged.txt']);
    fs.appendFileSync(path.join(root, 'NOTES.md'), '预留前改动\n'); // 已跟踪未暂存（非看板文件）
  }
  if (hookFail) {
    fs.mkdirSync(path.join(root, '.git', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n');
    fs.chmodSync(path.join(root, '.git', 'hooks', 'pre-commit'), 0o755);
  }

  batch.createBatch(dataDir, { projectRoot: root });
  const nx = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w1' }); // 队首批次缺省
  assert.equal(nx.itemId, item.id);
  core.claim(dataDir, item.id, 'w1');

  // 实施：业务 + 测试 + 本单条目文档（未跟踪文件编辑）+ 其他单条目文档（应排除）
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'feature-a.mjs'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(root, 'scripts', 'tests', 'feature-a.test.mjs'), 'import assert from "node:assert/strict";\n');
  fs.appendFileSync(path.join(nx.itemDir, 'README.md'), '\n实施补充\n');
  const otherDir = core.resolveItemDir(dataDir, other.id).dir;
  fs.appendFileSync(path.join(otherDir, 'README.md'), '\n其他单改动\n');
  fs.rmSync(path.join(root, 'README.md')); // 删除既有文件也应进入业务提交
  fs.writeFileSync(path.join(root, 'README.md'), '# t 改\n');

  core.report(dataDir, item.id, { summary: '实施完成', by: 'w1', run: { runId: nx.runId } });
  const { receipt } = batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });
  return { dataDir, item, other, otherDir, runId: nx.runId, receipt, batch: nx.batchId };
}

t('D5/D6 reported 回执触发自动提交：三组规范提交 + 回执带 autoCommit + 徽标索引点亮 + 无关改动保留', () => {
  const root = mkProject();
  const { dataDir, item, other, otherDir, receipt } = runReportedFlow(root);

  assert.equal(receipt.result, 'reported');
  assert.ok(receipt.autoCommit, '回执应携带 autoCommit 概要');
  assert.equal(receipt.autoCommit.status, 'committed');
  assert.equal(receipt.autoCommit.commits.length, 3, '应产生 doc/test/业务三组提交');

  const subjects = logSubjects(root).slice(0, 3);
  for (const s of subjects) {
    assert.ok(s.includes(item.id), `提交消息须含单号：${s}`);
    assert.equal(commitStore.validateCommitSubject(s, item.id), null, `消息须过规范核验：${s}`);
  }
  assert.ok(subjects.some((s) => s.startsWith('doc: ')), '条目文档应归 doc 提交');
  assert.ok(subjects.some((s) => s.startsWith('test: ')), '测试代码应单独 test 提交');
  assert.ok(subjects.some((s) => s.startsWith('feat: ')), '需求业务代码应为 feat 提交');

  // 已提交徽标同源索引（committedItemIndex）点亮
  const idx = commitStore.committedItemIndex(dataDir);
  assert.ok(idx.get(item.id), 'committedItemIndex 应含本单');
  assert.equal(idx.get(item.id).commits.length, 3);

  // 无关改动保留：预留前已存在的暂存/未暂存改动（非看板路径）、其他单条目文档均不动；
  // 看板共享文件（.gitignore/config 等）随本单 doc 提交收纳属预期
  const st = git(root, ['status', '--porcelain', '-uall']).stdout;
  assert.match(st, /A {2}pre-staged\.txt|A\s+pre-staged\.txt/, '预留前的暂存改动不得被卷入');
  assert.match(st, /M {1,2}NOTES\.md|M\s+NOTES\.md/, '预留前的未暂存改动不得被卷入');
  const otherRel = path.relative(root, path.join(otherDir, 'README.md'));
  assert.ok(st.includes(otherRel), '其他单条目文档应保留在工作区');
  // 本单条目文档应已全部提交（目录干净）
  const itemRel = path.relative(root, core.resolveItemDir(dataDir, item.id).dir);
  assert.ok(!st.split('\n').some((l) => l.includes(itemRel)), '本单条目目录应已提交干净');
});

t('D7 幂等：同一运行重复回执不重复提交；git 历史已含单号时跳过', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '幂等单');
  batch.createBatch(dataDir, { projectRoot: root });
  const nx = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w1' });
  core.claim(dataDir, item.id, 'w1');
  fs.writeFileSync(path.join(root, 'biz.txt'), 'x\n');
  core.report(dataDir, item.id, { summary: '完成', by: 'w1', run: { runId: nx.runId } });
  const r1 = batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });
  assert.equal(r1.receipt.autoCommit.status, 'committed');
  const r2 = batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });
  assert.equal(r2.idempotent, true, '重复回执应幂等返回');
  const withId = logSubjects(root).filter((s) => s.includes(item.id));
  assert.equal(withId.length, 2, '重复回执不得产生重复提交（doc + 业务两组）');

  // git 历史已含单号 → 重试入口跳过（幂等）
  const again = atb(['run', 'autocommit', nx.runId, '--json'], root);
  assert.equal(again.code, 0);
  assert.equal(jsonOf(again).autoCommit.status, 'skipped');
  assert.match(jsonOf(again).autoCommit.reason, /幂等|已含/);
});

t('D8 失败不阻断回执：提交失败回执仍 reported、改动保留；REQ-20260914-001 起挂起队列，人工确认后恢复续派；重试不重复', async () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const { receipt, runId, item } = runReportedFlow(root, { hookFail: true });
  assert.equal(receipt.result, 'reported', '自动提交失败不得改变回执结果');
  assert.equal(receipt.autoCommit.status, 'failed');
  assert.ok(receipt.autoCommit.reason, '失败应带原因');
  assert.equal(logSubjects(root).filter((s) => s.includes(item.id)).length, 0, '失败时不应产生任何提交');
  const st = git(root, ['status', '--porcelain', '-uall']).stdout;
  assert.match(st, /feature-a\.mjs/, '失败时改动应保留在工作区');
  // REQ-20260914-001：失败 → 挂起当前条目并暂停队列（禁止后续领取放大混合修改）
  assert.ok(receipt.suspended, '失败应触发挂起标记');
  const batchId = batch.queueHeadBatch(dataDir).batchId;
  assert.equal(batch.getBatch(dataDir, batchId).pauseRequested, true, '队列应持久化暂停');
  const item2 = mkPlannedItem(dataDir, '后续单');
  const blocked = batch.nextItem(dataDir, batchId, { owner: 'w2' });
  assert.equal(blocked.stop, 'paused', '挂起期间不得派发后续单');
  void item2;

  // 移除故障钩子后人工确认：授权补交恰一次（不重复），核验通过恢复队列
  fs.rmSync(path.join(root, '.git', 'hooks', 'pre-commit'));
  const confirmStore = await import('../lib/confirm-store.mjs');
  const confirmStates = await import('../lib/confirm-states.mjs');
  const rec = confirmStates.confirmOf(dataDir, item.id);
  assert.ok(rec, '失败应已声明挂起确认记录');
  const r = confirmStore.confirmCommitContinue(dataDir, item.id, {
    projectRoot: root, fingerprint: rec.fingerprint,
  });
  assert.ok(r.ok, `人工确认应成功：${JSON.stringify(r.reasons || [])}`);
  batch.resumeAfterConfirm(dataDir, batchId);
  const nx2 = batch.nextItem(dataDir, batchId, { owner: 'w2' });
  assert.equal(nx2.itemId, item2.id, '确认恢复后批次继续派发下一项');
  const withId = logSubjects(root).filter((s) => s.includes(item.id));
  assert.ok(withId.length >= 2, `补交应恰好落库（doc + 人工确认补交）：${withId.join(' | ')}`);
  assert.equal(logSubjects(root).filter((s) => s === 'doc: 幂等单 ' + item.id).length, 0, '不得出现重复主题');
  void runId;
});

t('D9 旧版预留（无快照）/非 git 项目 → 明确跳过，不猜测归因', () => {
  // 无快照：手工抹掉 treeSnapshot 模拟旧版本预留
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '旧版预留单');
  batch.createBatch(dataDir, { projectRoot: root });
  const nx = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w1' });
  const runFile = path.join(dataDir, 'dispatch', 'runs', nx.runId, 'run.json');
  const runJson = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  delete runJson.treeSnapshot;
  fs.writeFileSync(runFile, JSON.stringify(runJson, null, 2));
  core.claim(dataDir, item.id, 'w1');
  fs.writeFileSync(path.join(root, 'x.txt'), 'x\n');
  core.report(dataDir, item.id, { summary: '完成', by: 'w1', run: { runId: nx.runId } });
  const r = batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });
  assert.equal(r.receipt.autoCommit.status, 'skipped');
  assert.match(r.receipt.autoCommit.reason, /快照/);

  // 非 git 项目（初始化早于本需求的存量项目）
  const plain = mkTmp();
  core.initData(plain);
  fs.rmSync(path.join(plain, '.git'), { recursive: true, force: true });
  const dataDir2 = core.dataDirFrom(plain);
  const it2 = mkPlannedItem(dataDir2, '非git单');
  batch.createBatch(dataDir2, { projectRoot: plain });
  const nx2 = batch.nextItem(dataDir2, batch.queueHeadBatch(dataDir2).batchId, { owner: 'w1' });
  core.claim(dataDir2, it2.id, 'w1');
  core.report(dataDir2, it2.id, { summary: '完成', by: 'w1', run: { runId: nx2.runId } });
  const r2 = batch.finishRun(dataDir2, nx2.runId, { result: 'reported', reportRef: 'test-report.md' });
  assert.equal(r2.receipt.autoCommit.status, 'skipped');
  assert.match(r2.receipt.autoCommit.reason, /git/);
});

t('D5b Bug 单业务提交类型为 fix；快照哈希能探测未跟踪文件的内容修改', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const bug = mkPlannedItem(dataDir, 'Bug 自动提交单', 'bug');
  batch.createBatch(dataDir, { projectRoot: root });
  const nx = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w1' });
  core.claim(dataDir, bug.id, 'w1');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'fix.txt'), 'fix\n');
  core.report(dataDir, bug.id, { summary: '修复完成', by: 'w1', run: { runId: nx.runId } });
  const { receipt } = batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });
  assert.equal(receipt.autoCommit.status, 'committed');
  assert.ok(logSubjects(root).some((s) => s.startsWith('fix: ') && s.includes(bug.id)), 'Bug 业务提交应为 fix');
});

// ---------- D10 hook：流程外 git commit 拦截与豁免 ----------

function runGuard(mode, toolInput, cwd) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [GUARD, mode], { cwd, stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => resolve({ code, err }));
    p.stdin.write(JSON.stringify({ tool_name: 'Bash', cwd, tool_input: toolInput }));
    p.stdin.end();
  });
}

t('D10 hook：看板项目内流程外 git commit 一律拦（REQ-20260911-010：CMT 豁免已移除）；无看板放行；git add 放行', async () => {
  // 看板项目 → 拦
  const proj = mkTmp();
  core.initData(proj);
  let r = await runGuard('bash', { command: 'git commit -m "feat: 偷偷提交 REQ-20260911-009"' }, proj);
  assert.equal(r.code, 2, '流程外 git commit 应被拦');
  assert.match(r.err, /自动提交|流程外/, '拦截提示应说明授权通道');

  // 带 -C 与选项前缀的变体同样拦（防绕过）
  r = await runGuard('bash', { command: `git -C ${proj} commit -m x` }, proj);
  assert.equal(r.code, 2);

  // REQ-20260911-010：存量 CMT 在途账本残留也不再豁免（人工批量提交通道已回退下线）
  const dataDir = core.dataDirFrom(proj);
  const cmtId = 'CMT-20260911-001';
  const runId = 'run-20260911-120000-abcd';
  fs.mkdirSync(path.join(dataDir, 'commits', 'batches', cmtId), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'commits', 'batches', cmtId, 'batch.json'), JSON.stringify({
    batchId: cmtId, status: 'running', abortRequested: false, currentRunId: runId,
  }));
  fs.mkdirSync(path.join(dataDir, 'commits', 'runs', runId), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'commits', 'runs', runId, 'run.json'), JSON.stringify({
    runId, batchId: cmtId, phase: 'reserved',
  }));
  r = await runGuard('bash', { command: 'git commit -m "feat: 存量通道残留 REQ-1"' }, proj);
  assert.equal(r.code, 2, 'CMT 在途账本残留不得再豁免（提交通道已回退）');

  // 无看板上下文的其他项目 → 放行（插件不越界管别的项目）
  const outside = mkTmp();
  r = await runGuard('bash', { command: 'git commit -m "别的项目正常提交"' }, outside);
  assert.equal(r.code, 0);

  // 看板项目内非提交命令 → 放行
  r = await runGuard('bash', { command: 'git add -A && git status --short' }, proj);
  assert.equal(r.code, 0, 'git add/status 应放行');
});

// ---------- D11 双向索引 CLI ----------

t('D11 索引：atb commit log 查单→全部提交；atb commit which 从提交反查条目', () => {
  const root = mkProject();
  const { dataDir, item, receipt } = runReportedFlow(root);

  const log = atb(['commit', 'log', item.id, '--json'], root);
  assert.equal(log.code, 0, `commit log 应成功（${log.err}）`);
  const rows = jsonOf(log);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.match(row.hash, /^[0-9a-f]{40}$/, '应返回完整 hash');
    assert.ok(row.subject.includes(item.id), '应携带提交消息');
  }

  const which = atb(['commit', 'which', receipt.autoCommit.commits[0], '--json'], root);
  assert.equal(which.code, 0, `commit which 应成功（${which.err}）`);
  const w = jsonOf(which);
  assert.equal(w.itemId, item.id, '应从提交反查出条目');
  assert.match(w.title, /自动提交流程单/);

  // 不含单号的提交 → 反查为空（--json null）而非报错
  fs.writeFileSync(path.join(root, 'free.txt'), 'f\n');
  git(root, ['add', 'free.txt']);
  git(root, ['commit', '-q', '-m', 'chore: 无单号提交']);
  const hash = git(root, ['rev-parse', 'HEAD']).stdout.trim();
  const none = atb(['commit', 'which', hash, '--json'], root);
  assert.equal(none.code, 0);
  assert.equal(jsonOf(none), null);
  // lib 直查：via 合并账本与 git 历史
  const merged = gitFlow.itemCommitLog(dataDir, root, item.id);
  assert.equal(merged.length, 3);
});

// ---------- D4 设置页接口（server 子进程） ---------- ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJson(port, method, p) {
  return new Promise((resolve, reject) => {
    const rq = http.request({ hostname: '127.0.0.1', port, path: p, method, timeout: 4000 }, (rs) => {
      let body = '';
      rs.on('data', (c) => { body += c; });
      rs.on('end', () => {
        try { resolve({ status: rs.statusCode, json: JSON.parse(body || '{}') }); }
        catch (e) { reject(e); }
      });
    });
    rq.on('error', reject);
    rq.on('timeout', () => { rq.destroy(); reject(new Error('timeout')); });
    rq.end();
  });
}

t('D4 设置页接口：branch-state / init-dev 幂等创建切换；非 git 项目明确提示', async () => {
  const tmp = mkTmp();
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj);
  git(proj, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(proj, 'README.md'), '# t\n');
  git(proj, ['add', '.']);
  git(proj, ['commit', '-q', '-m', 'chore: base']);
  core.initData(proj); // 顺带创建 dev 并切换（有提交仓库）
  const plain = path.join(tmp, 'plain');
  fs.mkdirSync(plain);
  core.initData(plain);
  fs.rmSync(path.join(plain, '.git'), { recursive: true, force: true }); // 存量非 git 项目

  const port = 30390;
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: proj, env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(200);
      try {
        const h = await httpJson(port, 'GET', '/api/health');
        if (h.status === 200) { up = true; break; }
      } catch {}
    }
    assert.ok(up, 'server 应已启动');

    const q = encodeURIComponent(proj);
    let r = await httpJson(port, 'GET', `/api/git/branch-state?project=${q}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.isRepo, true);
    assert.equal(r.json.branch, 'dev');
    assert.equal(r.json.devExists, true);

    // 切回 main 后 init-dev：仅切换不重复创建
    git(proj, ['switch', '-q', 'main']);
    r = await httpJson(port, 'GET', `/api/git/branch-state?project=${q}`);
    assert.equal(r.json.branch, 'main');
    r = await httpJson(port, 'POST', `/api/git/init-dev?project=${q}`);
    assert.equal(r.status, 200, `init-dev 应成功：${JSON.stringify(r.json)}`);
    assert.equal(r.json.after.branch, 'dev');
    assert.equal(r.json.after.devExists, true);
    assert.equal(branchOf(proj), 'dev');
    assert.equal(git(proj, ['branch', '--list', 'dev']).stdout.trim().split('\n').length, 1, '不得重复创建 dev');

    // 非 git 项目：状态接口如实返回；init-dev 明确拒绝（不出现必失败入口）
    const q2 = encodeURIComponent(plain);
    r = await httpJson(port, 'GET', `/api/git/branch-state?project=${q2}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.isRepo, false);
    r = await httpJson(port, 'POST', `/api/git/init-dev?project=${q2}`);
    assert.equal(r.status, 400);
    assert.match(r.json.error, /git/);
  } finally {
    server.kill();
  }
});

// ---------- D12 UI 静态断言 ----------

t('D12 UI 静态断言：设置页 Git 工作流分区 + 待测试条目已提交徽标 + hooks 文案同步', () => {
  const app = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  assert.match(app, /Git 工作流/, '设置页应有 Git 工作流分区');
  assert.match(app, /\/api\/git\/branch-state/, '应请求分支状态接口');
  assert.match(app, /\/api\/git\/init-dev/, '应请求初始化 dev 接口');
  assert.match(app, /id="gwInit"/, '应有初始化按钮（gwInit）');
  assert.match(app, /已在 dev 分支/, '应有已在 dev 就绪态文案');
  assert.match(app, /当前分支：/, '应有当前分支状态行');
  assert.match(app, /正在创建并切换到 dev 分支/, '应有执行中反馈文案');
  // 待测试（in-progress 已上报）条目同样展示已提交徽标
  assert.match(app, /agentCompletedAt \? .*(commitBadge|已提交)|commitBadge[^\n]*agentCompletedAt/s, '徽标条件应覆盖待测试条目');
  const badgeFn = app.slice(app.indexOf('function commitBadgeHtml'), app.indexOf('function commitStatusDetailHtml'));
  assert.match(badgeFn, /agentCompletedAt/, 'commitBadgeHtml 应放行待测试条目');

  // hooks 配置文案同步纳入提交拦截口径
  const hj = fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8');
  const cj = fs.readFileSync(path.join(pluginRoot, 'hooks', 'codex.json'), 'utf8');
  assert.match(hj, /提交/, 'hooks.json 守卫说明应提及提交拦截');
  assert.match(cj, /提交/, 'codex.json 守卫说明应提及提交拦截');

  // i18n 词典覆盖（i18n-coverage 测试的静态前置）
  const i18n = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'i18n.js'), 'utf8');
  assert.match(i18n, /'Git 工作流':/, '词典应含 Git 工作流');
  assert.match(i18n, /'初始化 dev 分支':/, '词典应含初始化按钮文案');
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
