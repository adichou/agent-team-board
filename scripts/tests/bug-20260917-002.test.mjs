#!/usr/bin/env node
// BUG-20260917-002 收口自动提交对已整体暂存的删除路径 git add -A 报 pathspec fatal —— 回归测试
// 用法：node scripts/tests/bug-20260917-002.test.mjs
// 覆盖：
//   · B1 核心复现：git rm 已跟踪看板共享路径（整体暂存删除：索引与磁盘均无）后收口，
//     doc 组提交成功、删除由 commit --only 收录、不再 fatal；
//   · B2 非 pathspec 类真实 git 错误不吞：index.lock 致 add 失败 → 如实 failed 挂起、
//     errorFull 完整落账；解锁后人工确认闭环（confirmCommitContinue）补齐 doc 提交且不重复；
//   · B3 确认补交（supplementCommitForRun）同现场：显式计入（include）该共享路径时补交成功，
//     删除被收录；
//   · B4 本地化容错：zh_CN locale 下 pathspec fatal 文案非英文（「致命错误：路径规格 …」），
//     跳过判定不依赖错误文案——收口仍成功（环境无对应 locale 时跳过本用例）。
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

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function git(root, args) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r;
}

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-staged-del-')));
}

// 已有提交的 git 项目（main 起步）：看板数据 + 一个板级共享文件（不归属任何条目）入库
function mkProject() {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(root, 'README.md'), '# t\n');
  core.initData(root);
  const sharedRel = path.join('shared', 'board-shared.json');
  const dataDir = core.dataDirFrom(root);
  fs.mkdirSync(path.join(dataDir, 'shared'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, sharedRel), '{ "v": 1 }\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 初始化测试仓库（含看板共享文件）']);
  return root;
}

function mkPlannedItem(dataDir, title) {
  const x = core.createItem(dataDir, { type: 'bug', title });
  core.setStatus(dataDir, x.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, x.id, 'planned', { by: 'human' });
  return x;
}

const logSubjectsOf = (root, itemId) =>
  git(root, ['log', '--format=%s']).stdout.split('\n').filter(Boolean).filter((s) => s.includes(itemId));

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 端到端复现（README 复现步骤 1–3）：实施期对看板共享路径制造「已整体暂存的删除」
// （git rm：索引中已无条目、磁盘无文件，pathspec 匹配不到任何对象）→ 上报 → 收口。
function runPoisonedFlow(root, { hookFail = false, lockIndex = false, title = '暂存删除容错单' } = {}) {
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, title);
  const sharedAbsRel = path.relative(root, path.join(dataDir, 'shared', 'board-shared.json'));

  batch.createBatch(dataDir, { projectRoot: root });
  const nx = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w1' });
  core.claim(dataDir, item.id, 'w1');

  // 实施：本单条目文档补充 + 毒源（看板共享文件整体暂存删除）
  fs.appendFileSync(path.join(nx.itemDir, 'README.md'), '\n实施补充\n');
  git(root, ['rm', '-q', sharedAbsRel]);
  assert.match(
    git(root, ['status', '--porcelain']).stdout,
    new RegExp(`^D {2}${escapeRe(sharedAbsRel)}$`, 'm'),
    '前置：共享路径应为已整体暂存的删除（D 码 + 完全无未暂存标记）',
  );
  if (hookFail) {
    fs.mkdirSync(path.join(root, '.git', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n');
    fs.chmodSync(path.join(root, '.git', 'hooks', 'pre-commit'), 0o755);
  }
  if (lockIndex) fs.writeFileSync(path.join(root, '.git', 'index.lock'), 'poison');

  core.report(dataDir, item.id, { summary: '实施完成', by: 'w1', run: { runId: nx.runId } });
  const { receipt } = batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });
  return { dataDir, item, runId: nx.runId, sharedRel: sharedAbsRel, receipt };
}

// ---------- B1 核心复现（默认 locale：英文 fatal 文案场景） ----------

t('B1 核心复现：已整体暂存删除的看板共享路径不再毒死收口——doc 组提交成功且删除被 --only 收录', () => {
  const root = mkProject();
  const { item, sharedRel, receipt } = runPoisonedFlow(root);

  const ac = receipt.autoCommit;
  assert.equal(ac.status, 'committed', `收口应成功而非被 pathspec fatal 毒死：${ac.reason || ''}`);
  assert.ok(!/pathspec|did not match any files/i.test(String(ac.reason || '')), '不应出现 pathspec fatal');

  const docSubjects = logSubjectsOf(root, item.id).filter((s) => s.startsWith('doc: '));
  assert.equal(docSubjects.length, 1, 'doc 组恰好一个提交');
  assert.equal(commitStore.validateCommitSubject(docSubjects[0], item.id), null, 'doc 组消息须过规范核验');

  // 删除确实被提交收录（--only 以 HEAD 跟踪记录为准）
  const docHash = ac.commits[0];
  const show = git(root, ['show', '--name-status', '--format=', docHash]).stdout;
  assert.match(show, new RegExp(`^D\\s+${escapeRe(sharedRel)}$`, 'm'), '暂存删除应被收录进 doc 提交');

  // 收口后该路径退出脏集合（不再挂在工作区）
  const st = git(root, ['status', '--porcelain', '-uall']).stdout;
  assert.ok(!st.includes(sharedRel), '已提交的删除不应再出现在工作区状态中');
});

// ---------- B2 非 pathspec 类真实 git 错误照常上抛 + 挂起后确认闭环补齐 ----------

t('B2 真实 git 错误不吞：index.lock 致 add 失败如实 failed 挂起且 errorFull 落账；解锁后人工确认补交补齐、不重复', async () => {
  const root = mkProject();
  const { dataDir, item, sharedRel, runId, receipt } = runPoisonedFlow(root, { lockIndex: true });

  const ac = receipt.autoCommit;
  assert.equal(ac.status, 'failed', '非 pathspec 类真实错误必须如实失败（不得被容错吞掉）');
  assert.ok(receipt.suspended, '提交不完整应挂起待人工确认');
  assert.equal(logSubjectsOf(root, item.id).length, 0, '失败时不得产生任何本单提交');

  const detail = JSON.parse(fs.readFileSync(
    path.join(dataDir, 'runtime', 'dispatch', 'runs', runId, 'auto-commit.json'), 'utf8'));
  assert.match(String(detail.errorFull || ''), /index\.lock/, 'errorFull 应完整保留真实错误关键信息');

  // 解除毒锁后走人工确认闭环：默认计入范围为空（无 pendingManual/暂扣），补交本单可归属路径
  fs.rmSync(path.join(root, '.git', 'index.lock'));
  const confirmStates = await import('../lib/confirm-states.mjs');
  const confirmStore = await import('../lib/confirm-store.mjs');
  const rec = confirmStates.confirmOf(dataDir, item.id);
  assert.ok(rec, '失败挂起应已声明待人工确认记录');
  const r = await confirmStore.confirmCommitContinue(dataDir, item.id, {
    projectRoot: root, fingerprint: rec.fingerprint,
  });
  assert.ok(r.ok, `人工确认补交应成功：${JSON.stringify(r.reasons || [])}`);

  const subjects = logSubjectsOf(root, item.id);
  assert.equal(subjects.filter((s) => s.startsWith('doc: ')).length, 1, '补交后 doc 组恰好一个提交（不重复）');
  // 未显式计入的归属待确认路径（共享暂存删除）保留在工作区，不静默并入
  const st = git(root, ['status', '--porcelain', '-uall']).stdout;
  assert.match(st, new RegExp(`^D {2}${escapeRe(sharedRel)}$`, 'm'), '未计入的共享暂存删除应保留现场');
});

// ---------- B3 确认补交路径（supplementCommitForRun，与收口共用 commitPaths） ----------

t('B3 确认补交同现场：显式计入（include）已整体暂存删除的共享路径，补交成功且删除被收录', async () => {
  const root = mkProject();
  const { dataDir, item, sharedRel, receipt } = runPoisonedFlow(root, { hookFail: true });

  const ac = receipt.autoCommit;
  assert.equal(ac.status, 'failed', '提交阶段失败（钩子）应挂起待人工确认');
  fs.rmSync(path.join(root, '.git', 'hooks', 'pre-commit')); // 移除故障钩子后人工确认

  const confirmStates = await import('../lib/confirm-states.mjs');
  const confirmStore = await import('../lib/confirm-store.mjs');
  const rec = confirmStates.confirmOf(dataDir, item.id);
  assert.ok(rec, '失败挂起应已声明待人工确认记录');
  const r = await confirmStore.confirmCommitContinue(dataDir, item.id, {
    projectRoot: root, fingerprint: rec.fingerprint, include: [sharedRel],
  });
  assert.ok(r.ok, `显式计入共享路径的确认补交应成功：${JSON.stringify(r.reasons || [])}`);

  const subjects = logSubjectsOf(root, item.id);
  assert.equal(subjects.filter((s) => s.startsWith('doc: ')).length, 1, '补交 doc 组恰好一个提交');
  const supplementHashes = r.supplementCommits || [];
  assert.equal(supplementHashes.length, 1, '补交应产生 1 组提交');
  const show = git(root, ['show', '--name-status', '--format=', supplementHashes[0]]).stdout;
  assert.match(show, new RegExp(`^D\\s+${escapeRe(sharedRel)}$`, 'm'), '补交提交应收录共享路径的删除');
  assert.ok(!git(root, ['status', '--porcelain', '-uall']).stdout.includes(sharedRel), '补交后删除退出脏集合');
});

// ---------- B4 本地化容错（zh_CN locale：fatal 文案不匹配英文正则） ----------

t('B4 本地化容错：zh_CN locale 下 fatal 文案非英文，「无匹配」跳过不依赖错误文案——收口仍成功', () => {
  const root = mkProject();
  // 前置探测：本机 git 在 zh_CN locale 下是否输出本地化 fatal（否则本用例无意义，跳过）
  const probe = spawnSync('git', ['add', '-A', '--', 'no-such-probe-path'], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'zh_CN.UTF-8', LANG: 'zh_CN.UTF-8' },
  });
  const localized = probe.status !== 0 && !/did not match any files/i.test(String(probe.stderr || ''));
  if (!localized) {
    console.log('  （本机 git 在 zh_CN locale 下仍输出英文 fatal，跳过本地化用例）');
    return;
  }
  assert.match(String(probe.stderr || ''), /未匹配/, '前置：fatal 文案应已本地化（非英文正则可匹配范围）');

  const prev = { LC_ALL: process.env.LC_ALL, LANG: process.env.LANG, LANGUAGE: process.env.LANGUAGE };
  process.env.LC_ALL = 'zh_CN.UTF-8';
  process.env.LANG = 'zh_CN.UTF-8';
  delete process.env.LANGUAGE;
  try {
    const { item, sharedRel, receipt } = runPoisonedFlow(root, { title: '本地化容错单' });
    const ac = receipt.autoCommit;
    assert.equal(ac.status, 'committed', `非英文 locale 下收口应同样成功：${ac.reason || ''}`);
    const docSubjects = logSubjectsOf(root, item.id).filter((s) => s.startsWith('doc: '));
    assert.equal(docSubjects.length, 1, 'doc 组恰好一个提交');
    const show = git(root, ['show', '--name-status', '--format=', ac.commits[0]]).stdout;
    assert.match(show, new RegExp(`^D\\s+${escapeRe(sharedRel)}$`, 'm'), '暂存删除应被收录进 doc 提交');
  } finally {
    if (prev.LC_ALL === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = prev.LC_ALL;
    if (prev.LANG === undefined) delete process.env.LANG; else process.env.LANG = prev.LANG;
    if (prev.LANGUAGE === undefined) delete process.env.LANGUAGE; else process.env.LANGUAGE = prev.LANGUAGE;
  }
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
