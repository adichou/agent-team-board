#!/usr/bin/env node
// BUG-20260918-003 确认留痕 confirmations.md / decisions.md 属应用数据，迁至 runtime 不进 git —— 回归
// 用法：node scripts/tests/bug-20260918-003.test.mjs
// 覆盖（见条目 README 期望行为 / design.md 口径）：
//   · R1 开发侧挂起确认全流程（声明→核验→保持→确认并继续）：条目目录不出现也不更新
//     confirmations.md，留痕完整落 runtime/confirms/confirmations/<ID>.md（轮次 / 事件 /
//     待人工路径），git status 全程无 confirmations.md 相关变更；
//   · R2 分析侧挂起（声明→作答→确认→收尾闭环）：同口径 runtime 留痕，条目目录零写入；
//   · R3 hold 决策留痕（声明→作答→复工）：条目目录不出现 decisions.md，留痕落
//     runtime/holds/decisions/<ID>.md（问题 / 答复 / 轮次）；
//   · R4 条目文档口径：orderedDocs / getItemDetail 不再列出 confirmations.md / decisions.md
//     （详情文档页签与全局搜索同源）；
//   · R5 出库迁移归因：他条目已入库 confirmations.md 的删除（出库迁移）按板级共享随本单
//     doc 组自动提交，提交主题带本 Bug 单号，git ls-files 不再列出该文件；
//   · R6 提示口径：CLI（hold declare / refine hold）/ 前端 / i18n 不再指向条目目录留痕，
//     指向 runtime 域路径（双语同步）。
// 模式对齐 confirm-block-20260914-001.test.mjs（真实 git 临时仓库 + 端到端经 batch.finishRun）。

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
import * as holdStore from '../lib/hold-store.mjs';
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
  const r = spawnSync(process.execPath, [ATB, ...args, '--dir', cwd], { encoding: 'utf8', timeout: 120_000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bug18-003-')));
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

function mkPlannedItem(dataDir, title, type = 'bug') {
  const x = core.createItem(dataDir, { type, title });
  core.setStatus(dataDir, x.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, x.id, 'planned', { by: 'human' });
  return x;
}

// BUG-20260918-003 口径下的 runtime 留痕路径（与实现同源断言）
const confirmationsDocOf = (dataDir, id) =>
  path.join(dataDir, 'runtime', 'confirms', 'confirmations', `${id}.md`);
const decisionsDocOf = (dataDir, id) =>
  path.join(dataDir, 'runtime', 'holds', 'decisions', `${id}.md`);

// 预置被测源码 + 预留前已脏的 build.js（复现挂起路径，与 confirm-block 测试相同）
function seedPreDirtySource(root) {
  fs.mkdirSync(path.join(root, 'scripts', 'web'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'web', 'build.js'), 'base\n');
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'impl.mjs'), 'v1\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 被测源码入库']);
  fs.appendFileSync(path.join(root, 'scripts', 'web', 'build.js'), '上一单遗留脏改动\n'); // 预留前已脏
}

// 一单完整流转（触发挂起）：预留 → 认领 → 运行期改动 → report → 收尾挂起
function runHeldFlow(root, item, title) {
  const dataDir = core.dataDirFrom(root);
  batch.createBatch(dataDir, { projectRoot: root });
  const nx = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w1' });
  assert.equal(nx.itemId, item.id, `应领取目标条目（得到 ${nx.itemId}）`);
  core.claim(dataDir, item.id, 'w1');
  fs.appendFileSync(path.join(root, 'scripts', 'web', 'build.js'), `本单实现改动 ${title}\n`);
  fs.mkdirSync(path.join(root, 'scripts', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'tests', `${item.id}.test.mjs`), 'import assert from "node:assert/strict";\n');
  core.report(dataDir, item.id, { summary: '实施完成', by: 'w1', run: { runId: nx.runId } });
  const { receipt } = batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });
  assert.ok(receipt.suspended, '夹具应触发挂起（预留前已脏路径）');
  return { dataDir, runId: nx.runId };
}

// ---------- R1 开发侧：留痕迁 runtime，条目目录零写入 ----------

t('R1 开发侧挂起确认全流程：条目目录无 confirmations.md，留痕完整在 runtime，git 全程无感知', async () => {
  const root = mkProject();
  seedPreDirtySource(root);
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '留痕迁出单');
  const { runId } = runHeldFlow(root, item, 'R1');

  // 声明后：条目目录不出现留痕文件；runtime 留痕完整（轮次 / 原因 / 待人工路径）
  const itemDir = core.resolveItemDir(dataDir, item.id).dir;
  assert.ok(!fs.existsSync(path.join(itemDir, 'confirmations.md')), '条目目录不得出现 confirmations.md');
  const rt = confirmationsDocOf(dataDir, item.id);
  assert.ok(fs.existsSync(rt), `留痕应落 runtime：${rt}`);
  let md = fs.readFileSync(rt, 'utf8');
  assert.ok(md.includes(item.id), 'runtime 留痕应含条目编号');
  assert.ok(md.includes('第 1 轮'), 'runtime 留痕应体现轮次');
  assert.ok(md.includes('declared'), 'runtime 留痕应含声明事件');

  // 核验 → 保持挂起 → 确认并继续：每步都不在条目目录产生/更新留痕，事件在 runtime 留痕
  await confirmStore.verifyCommitConfirm(dataDir, item.id, { projectRoot: root, runTests: false });
  confirmStore.keepConfirm(dataDir, item.id, { note: '归属人工核对中' });
  const rec = confirmStates.confirmOf(dataDir, item.id);
  const r = await confirmStore.confirmCommitContinue(dataDir, item.id, {
    projectRoot: root, fingerprint: rec.fingerprint,
  });
  assert.ok(r.ok, `确认应成功：${JSON.stringify(r.reasons || [])}`);
  assert.ok(!fs.existsSync(path.join(itemDir, 'confirmations.md')), '闭环后条目目录仍不得出现 confirmations.md');
  md = fs.readFileSync(confirmationsDocOf(dataDir, item.id), 'utf8');
  for (const kind of ['verified', 'kept', 'confirmed']) {
    assert.ok(md.includes(kind), `runtime 留痕应含 ${kind} 事件`);
  }

  // git 全程无感知：状态里不出现 confirmations.md，历史中也没有该路径
  const st = git(root, ['status', '--porcelain', '-uall']).stdout;
  assert.ok(!st.includes('confirmations.md'), `git status 不得出现 confirmations.md：\n${st}`);
  const tracked = git(root, ['ls-files']).stdout;
  assert.ok(!tracked.includes('confirmations.md'), 'git 不得跟踪任何 confirmations.md');
  void runId;
});

// ---------- R2 分析侧：留痕迁 runtime ----------

t('R2 分析侧挂起（声明→作答→确认→收尾）：条目目录无 confirmations.md，问题与答复完整在 runtime', async () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '分析留痕迁出单', 'requirement');
  core.setStatus(dataDir, item.id, 'in-progress', { by: 'human' });

  confirmStore.declareAnalysisConfirm(dataDir, {
    itemId: item.id, reason: '方案取舍需人工确认', background: '两套口径',
    questions: [
      { id: 'q1', text: '选 A 还是 B？', options: [{ label: 'A', recommended: true }, { label: 'B' }] },
      { id: 'q2', text: '备注口径？', required: false },
    ],
    by: 'worker-1',
  });
  confirmStore.answerAnalysisConfirm(dataDir, item.id, {
    answers: [{ q: 'q1', text: '选 A' }, { q: 'q2', text: '无' }], by: 'human-a',
  });
  const rec = confirmStates.confirmOf(dataDir, item.id);
  const r = confirmStore.confirmAnalysisContinue(dataDir, item.id, { version: rec.questionsVersion });
  assert.equal(r.ok, true, `分析确认应成功：${JSON.stringify(r.reasons || [])}`);
  confirmStore.closeAnalysisConfirm(dataDir, item.id);

  const itemDir = core.resolveItemDir(dataDir, item.id).dir;
  assert.ok(!fs.existsSync(path.join(itemDir, 'confirmations.md')), '条目目录不得出现 confirmations.md');
  const md = fs.readFileSync(confirmationsDocOf(dataDir, item.id), 'utf8');
  assert.ok(md.includes('选 A 还是 B？'), 'runtime 留痕应含问题清单');
  assert.ok(md.includes('选 A'), 'runtime 留痕应含人工答复');
  assert.ok(md.includes('human-a'), 'runtime 留痕应含作答人');
  assert.ok(md.includes('第 1 轮'), 'runtime 留痕应体现轮次');
});

// ---------- R3 hold：decisions.md 同口径迁 runtime ----------

t('R3 hold 决策留痕：条目目录无 decisions.md，问题 / 答复 / 轮次完整在 runtime', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '决策留痕迁出单', 'requirement');
  core.claim(dataDir, item.id, 'worker-1');
  holdStore.declareHold(dataDir, item.id, {
    questions: ['首批平台范围？', '覆盖率口径？'], reason: '口径待确认', by: 'worker-1',
  });
  const itemDir = core.resolveItemDir(dataDir, item.id).dir;
  assert.ok(!fs.existsSync(path.join(itemDir, 'decisions.md')), '声明后条目目录不得出现 decisions.md');
  holdStore.answerHold(dataDir, item.id, {
    answers: [{ q: 'q1', text: '先做 iOS 单端' }, { q: 'q2', text: '按行覆盖' }], by: 'human-a',
  });
  holdStore.resumeHold(dataDir, item.id, { by: 'human-a' });
  assert.ok(!fs.existsSync(path.join(itemDir, 'decisions.md')), '复工后条目目录仍不得出现 decisions.md');
  const md = fs.readFileSync(decisionsDocOf(dataDir, item.id), 'utf8');
  assert.ok(md.includes(item.id), 'runtime 留痕应含条目编号');
  assert.ok(md.includes('首批平台范围？'), 'runtime 留痕应含问题清单');
  assert.ok(md.includes('先做 iOS 单端'), 'runtime 留痕应含人工答复');
  assert.ok(md.includes('resumed'), 'runtime 留痕应含复工事件');

  // 多轮：再声明开新一轮，runtime 留痕保留历史轮次
  core.claim(dataDir, item.id, 'worker-2');
  holdStore.declareHold(dataDir, item.id, { questions: ['新问题'], by: 'worker-2' });
  const md2 = fs.readFileSync(decisionsDocOf(dataDir, item.id), 'utf8');
  assert.ok(md2.includes('第 2 轮'), 'runtime 留痕应体现新一轮');
  assert.ok(md2.includes('历史轮次'), 'runtime 留痕应保留历史轮次');
});

// ---------- R4 条目文档口径：详情页签与搜索不再出现留痕文件 ----------

t('R4 orderedDocs / getItemDetail 不列出 confirmations.md / decisions.md（页签与全局搜索同源）', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '文档口径单', 'requirement');
  const itemDir = core.resolveItemDir(dataDir, item.id).dir;
  // 模拟未迁移存量：条目目录遗留留痕文件（不再由机制产生，但不得进文档页签/搜索）
  fs.writeFileSync(path.join(itemDir, 'confirmations.md'), '# 人工确认记录\n');
  fs.writeFileSync(path.join(itemDir, 'decisions.md'), '# 人工决策记录\n');
  const docs = core.orderedDocs(itemDir);
  assert.ok(!docs.includes('confirmations.md'), 'orderedDocs 不得列出 confirmations.md');
  assert.ok(!docs.includes('decisions.md'), 'orderedDocs 不得列出 decisions.md');
  assert.ok(docs.includes('README.md'), '常规条目文档照常列出');
  const detail = core.getItemDetail(dataDir, item.id);
  assert.ok(!detail.docs.includes('confirmations.md'), '条目详情页签不得出现 confirmations.md');
  assert.ok(!detail.docs.includes('decisions.md'), '条目详情页签不得出现 decisions.md');
});

// ---------- R5 出库迁移归因：他条目留痕删除按板级共享随本单 doc 提交 ----------

t('R5 出库迁移：他条目已入库 confirmations.md 的删除随本单 doc 组提交（主题带本 Bug 单号），git 不再跟踪', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  // 他条目（BUG-20260918-003 之前的存量）已入库 confirmations.md；保持待接受不进派发候选
  const other = core.createItem(dataDir, { type: 'bug', title: '历史留痕条目' });
  const otherDoc = path.join(core.resolveItemDir(dataDir, other.id).dir, 'confirmations.md');
  fs.writeFileSync(otherDoc, '# 人工确认记录 — 历史存量\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 历史留痕入库']);
  assert.ok(git(root, ['ls-files']).stdout.includes('confirmations.md'), '夹具：历史留痕应已被跟踪');

  // 本单运行（预留快照后执行出库迁移：删除条目目录留痕、内容移入 runtime）
  const item = mkPlannedItem(dataDir, '出库迁移执行单');
  batch.createBatch(dataDir, { projectRoot: root });
  const nx = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w1' });
  assert.equal(nx.itemId, item.id);
  core.claim(dataDir, item.id, 'w1');
  fs.rmSync(otherDoc);
  fs.mkdirSync(path.dirname(confirmationsDocOf(dataDir, other.id)), { recursive: true });
  fs.writeFileSync(confirmationsDocOf(dataDir, other.id), '# 人工确认记录 — 历史存量（迁入 runtime）\n');

  // 收口自动提交：删除应归本单 doc 组（板级共享），提交主题带本单号
  const run = JSON.parse(fs.readFileSync(
    path.join(dataDir, 'runtime', 'dispatch', 'runs', nx.runId, 'run.json'), 'utf8'));
  const ac = gitFlow.autoCommitForRun({ dataDir, projectRoot: root, run });
  assert.equal(ac.status, 'committed', `迁移删除应随本单自动提交：${JSON.stringify(ac.reason)}`);
  assert.ok(!git(root, ['ls-files']).stdout.includes('confirmations.md'), '出库迁移后 git 不得再跟踪 confirmations.md');
  const subjects = git(root, ['log', '--format=%s']).stdout.split('\n').filter(Boolean)
    .filter((s) => s.includes(item.id));
  assert.ok(subjects.some((s) => s.startsWith('doc: ')), `迁移提交主题应带本单号（doc 组）：${subjects.join(' | ')}`);
  const st = git(root, ['status', '--porcelain', '-uall']).stdout;
  assert.ok(!st.includes('confirmations.md'), '迁移后工作区不得残留 confirmations.md 相关变更');
});

// ---------- R6 提示口径：CLI / 前端 / i18n 指向 runtime ----------

t('R6 提示口径：CLI hold declare 输出指向 runtime 留痕；源与词典不再指向条目目录', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const item = mkPlannedItem(dataDir, '提示口径单', 'requirement');
  core.claim(dataDir, item.id, 'worker-1');
  const r = atb(['hold', 'declare', item.id, '--question', '口径？', '--by', 'worker-1'], root);
  assert.equal(r.code, 0, `declare 应成功：${r.err}`);
  assert.ok(r.out.includes('agent-team-board/runtime/holds/decisions'), `CLI 应指向 runtime 留痕路径：${r.out}`);
  assert.ok(!r.out.includes('条目目录 decisions.md'), 'CLI 不得再指向条目目录留痕');

  const read = (p) => fs.readFileSync(path.join(pluginRoot, p), 'utf8');
  for (const [src, frag] of [
    ['scripts/atb.mjs', 'agent-team-board/runtime/confirms/confirmations'],
    ['scripts/atb.mjs', 'agent-team-board/runtime/holds/decisions'],
    ['scripts/web/app.js', 'agent-team-board/runtime/holds/decisions'],
    ['scripts/web/i18n.js', 'agent-team-board/runtime/holds/decisions'],
  ]) {
    assert.ok(read(src).includes(frag), `${src} 应指向 runtime 留痕路径`);
  }
  for (const src of ['scripts/atb.mjs', 'scripts/web/app.js', 'scripts/web/i18n.js']) {
    const text = read(src);
    assert.ok(!text.includes('条目目录 confirmations.md'), `${src} 不得再指向条目目录 confirmations.md`);
    assert.ok(!text.includes('条目目录 decisions.md'), `${src} 不得再指向条目目录 decisions.md`);
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
