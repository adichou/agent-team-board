#!/usr/bin/env node
// REQ-20260914-001 AI 分析遇到必须人工确认的问题 —— 分析侧核心回归
// 用法：node scripts/tests/confirm-analyze-20260914-001.test.mjs
// 覆盖（test-cases C15–C21 分析侧）：
//   · C15 声明挂起：当前条目挂起、分析队列暂停、后续领取被拒；不能因文档生成记 done；
//   · C16 问题/选项/影响呈现；必答缺失禁止确认；推荐选项不自动视为已答；
//   · C17 草稿与保持挂起不解除阻塞；账本持久化（新进程可读回）；
//   · C18 确认后答案随续跑回传当前条目；未收尾不派下一条；再遇问题重新挂起；
//   · C19 问题/文档版本变化 → 过期确认被拒；答案与确认时间可追溯；
//   · C20 恢复失败可重试且保留答案；重复确认不重复启动；不自动接受/开发/验收 done；
//   · C21 分析与开发阻塞共享账本与入口，分形态呈现。
// 模式对齐 refine-store.test.mjs / hold-20260911-007.test.mjs（真实临时项目 + store/CLI 端到端）。

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as refine from '../lib/refine-store.mjs';
import * as confirmStore from '../lib/confirm-store.mjs';
import * as confirmStates from '../lib/confirm-states.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB = path.join(pluginRoot, 'scripts', 'atb.mjs');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-confirm-an-')));
  core.initData(root);
  return root;
}

function mkAcceptedItem(dataDir, title, desc) {
  const it = core.createItem(dataDir, { type: 'requirement', title, description: desc });
  core.setStatus(dataDir, it.id, 'accepted', { by: 'human' });
  return it;
}

function atb(args, cwd) {
  const r = spawnSync(process.execPath, [ATB, ...args, '--dir', cwd], { encoding: 'utf8', timeout: 90_000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// 补全一个条目的文档到「已完善」形态（绕过 UI 演示门槛：非 UI 单不需要 ui-demo）
function completeDocs(itemDir, title) {
  const readme = fs.readFileSync(path.join(itemDir, 'README.md'), 'utf8');
  const next = readme
    .replace('（待补充）', `已补充的详细描述：${title} 的完整行为与验收要求说明文字超过三十字以满足说明过简门槛。`)
    .replace('- 状态：submitted（待人工接受）', `- 状态：accepted`);
  fs.writeFileSync(path.join(itemDir, 'README.md'), next);
}

// 一轮分析执行：创建完善任务并领取首个候选
function startRefineRun(root) {
  const dataDir = core.dataDirFrom(root);
  const { batch } = refine.createRefineBatch(dataDir, { projectRoot: root });
  const run = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'rw1' });
  return { dataDir, batchId: batch.batchId, run };
}

// 声明分析挂起（走 store 直调；CLI 通道在 serve 测试覆盖）
function declareHold(root, runId, { reason = '方案待人工选择', questions } = {}) {
  const dataDir = core.dataDirFrom(root);
  return refine.declareRefineHold(dataDir, runId, {
    reason,
    background: '当前方案有两个交互走向，影响数据范围与权限模型',
    questions: questions || [
      {
        text: '请选择方案',
        options: [
          { label: '方案 A：仅当前项目', impact: '实现简单，跨项目复用需后续需求', recommended: true },
          { label: '方案 B：全局生效', impact: '需迁移存量配置' },
        ],
      },
      { text: '请补充目标用户与使用频率' },
    ],
  });
}

// ---------- C15：声明挂起与队列暂停 ----------

t('C15 声明挂起：当前条目挂起、队列持久化暂停、后续领取被拒；不能因文档生成记完成', () => {
  const root = mkProject();
  const it = mkAcceptedItem(root_dataDir(root), '待分析条目');
  const { dataDir, batchId, run } = startRefineRun(root);
  assert.equal(run.itemId, it.id);
  const later = mkAcceptedItem(dataDir, '后续分析条目');
  void later;

  const r = declareHold(root, run.runId);
  assert.ok(r.ok);
  const rec = confirmStates.confirmOf(dataDir, it.id);
  assert.ok(rec, '应创建分析挂起记录');
  assert.equal(rec.kind, 'analyze');
  assert.equal(rec.blockType, 'analysis');
  assert.equal(rec.state, 'waiting');
  assert.equal(rec.questions.length, 2);

  // 队列持久化暂停；后续条目领取被拒（notice 指明阻塞条目）
  const bt = refine.getRefineBatch(dataDir, batchId);
  assert.equal(bt.pauseRequested, true, '完善队列应持久化暂停');
  const nx = refine.nextRefineItem(dataDir, batchId, { owner: 'rw2' });
  assert.equal(nx.stop, 'paused');
  assert.ok(nx.notice.includes(it.id) && nx.notice.includes('待人工确认分析'), `notice 应指明阻塞条目：${nx.notice}`);

  // 不能因文档生成记完成：done 回执被拒（条目保持 accepted，不被标记已完善）
  completeDocs(run.itemDir, it.title);
  assert.throws(
    () => refine.finishRefineRun(dataDir, run.runId, { result: 'done', summary: '文档已生成' }),
    /待人工确认分析/,
    '有未决问题时 done 必须被拒',
  );
  const st = core.getItemDetail(dataDir, it.id);
  assert.equal(st.status, 'accepted', '分析确认不等于接受/完成');
});

// ---------- C16：必答校验与推荐选项 ----------

t('C16 必答缺失禁止确认；推荐选项不自动视为已答；选项与影响完整呈现', () => {
  const root = mkProject();
  const it = mkAcceptedItem(root_dataDir(root), '必答校验条目');
  const { dataDir, run } = startRefineRun(root);
  declareHold(root, run.runId);

  // 未作答即确认：拒绝并列出缺失必答项
  const rec0 = confirmStates.confirmOf(dataDir, it.id);
  const r0 = confirmStore.confirmAnalysisContinue(dataDir, it.id, { version: rec0.questionsVersion });
  assert.equal(r0.ok, false);
  assert.ok(r0.reasons.some((x) => x.includes('必答') && x.includes('q1') && x.includes('q2')), `应列出缺失必答：${r0.reasons.join('；')}`);

  // 呈现：问题/选项/影响/推荐标记齐全；推荐不自动作答
  const view = confirmStore.confirmDetail(dataDir, it.id);
  const q1 = view.questions[0];
  assert.equal(q1.options.length, 2);
  assert.equal(q1.options[0].recommended, true);
  assert.ok(q1.options[0].impact);
  assert.equal(q1.answer, null, '推荐选项不得自动视为人工答案');

  // 只答选答题（构造：第 2 题选答 + 第 1 题空）：仍拒绝
  const rec2 = confirmStates.confirmOf(dataDir, it.id);
  rec2.questions[0].required = false; // 数据面直接构造「第 1 题选答、第 2 题必答」
  confirmStates.saveConfirmRecord(dataDir, it.id, rec2);
  confirmStore.answerAnalysisConfirm(dataDir, it.id, { answers: [{ q: 'q1', text: '选答随便填' }] });
  const r2 = confirmStore.confirmAnalysisContinue(dataDir, it.id, { version: rec2.questionsVersion });
  assert.equal(r2.ok, false, '必答 q2 未答仍禁止确认');
  assert.ok(r2.reasons.some((x) => x.includes('q2')));
});

// ---------- C17：草稿 / 保持挂起 / 持久化 ----------

t('C17 草稿即时保存不解除阻塞；保持挂起保留现场；新进程读回同一账本（重启/新会话）', () => {
  const root = mkProject();
  const it = mkAcceptedItem(root_dataDir(root), '草稿条目');
  const { dataDir, batchId, run } = startRefineRun(root);
  declareHold(root, run.runId);

  // 草稿：部分作答
  const a1 = confirmStore.answerAnalysisConfirm(dataDir, it.id, {
    answers: [{ q: 'q1', text: '方案 A：仅当前项目' }],
  });
  assert.equal(a1.ok, true);
  assert.equal(a1.answered, 1);
  assert.deepEqual(a1.missing, ['q2'], '缺 q2');
  assert.equal(confirmStates.confirmOf(dataDir, it.id).state, 'waiting', '草稿不解除阻塞');
  const nx = refine.nextRefineItem(dataDir, batchId, { owner: 'rw2' });
  assert.equal(nx.stop, 'paused', '草稿后队列仍暂停');

  // 保持挂起
  const keep = confirmStore.keepConfirm(dataDir, it.id, { note: '等待产品例会决定' });
  assert.equal(keep.ok, true);
  assert.equal(confirmStates.confirmOf(dataDir, it.id).state, 'waiting');

  // 新进程读回（模拟重启/新会话）：问题、草稿答案、队列暂停全部恢复
  const j = atb(['confirm', 'show', it.id, '--json'], root);
  assert.equal(j.code, 0);
  const d = JSON.parse(j.out.split('\n').filter(Boolean).pop());
  assert.equal(d.itemId, it.id);
  assert.equal(d.questions[0].answer, '方案 A：仅当前项目', '草稿答案应持久化');
  assert.equal(d.questions[1].answer, null);
  const nx2 = refine.nextRefineItem(dataDir, batchId, { owner: 'rw3' });
  assert.equal(nx2.stop, 'paused', '重启后队列暂停仍生效');
});

// ---------- C18：确认续跑回传 ----------

t('C18 答案齐备确认：答案回传当前条目续跑（队首），未收尾不派下一条；完成后才到下一条并闭环', () => {
  const root = mkProject();
  const it = mkAcceptedItem(root_dataDir(root), '续跑条目');
  const { dataDir, batchId, run } = startRefineRun(root);
  const later = mkAcceptedItem(dataDir, '下一条条目');
  declareHold(root, run.runId);

  confirmStore.answerAnalysisConfirm(dataDir, it.id, {
    answers: [
      { q: 'q1', text: '方案 A：仅当前项目（补充：保留扩展位）' },
      { q: 'q2', text: '内部团队日常使用，每天约 20 次' },
    ],
  });
  const rec = confirmStates.confirmOf(dataDir, it.id);
  const c = confirmStore.confirmAnalysisContinue(dataDir, it.id, { version: rec.questionsVersion });
  assert.ok(c.ok, `确认应成功：${JSON.stringify(c.reasons || [])}`);
  assert.equal(confirmStates.confirmOf(dataDir, it.id).state, 'confirmed');

  // 续跑排队：当前运行落 interrupted、条目重排队首、队列解除暂停
  const rr = refine.resumeAfterAnalysisConfirm(dataDir, run.runId);
  assert.ok(rr.ok);
  assert.equal(refine.getRefineRun(dataDir, run.runId).phase, 'interrupted');
  assert.equal(refine.getRefineBatch(dataDir, batchId).pauseRequested, false, '确认后恢复领取');

  // 下一次领取：同一条目优先（队首续跑），且携带人工答案回传
  const nx = refine.nextRefineItem(dataDir, batchId, { owner: 'rw2' });
  assert.equal(nx.itemId, it.id, '未完成收尾前不得派下一条');
  assert.ok(nx.continuation, '领取结果应携带续跑答案');
  assert.equal(nx.continuation.questions[0].answer.includes('方案 A'), true, '人工答案随续跑回传');
  assert.equal(nx.continuation.questions[1].answer.includes('20 次'), true);

  // 续跑完成：done 记账成功，挂起记录随完成闭环；随后才领取下一条
  completeDocs(nx.itemDir, it.title);
  const fin = refine.finishRefineRun(dataDir, nx.runId, { result: 'done', summary: '按人工答案完成' });
  assert.ok(fin.ok);
  assert.equal(confirmStates.confirmOf(dataDir, it.id).state, 'closed-done', '分析收尾后闭环');
  const nx2 = refine.nextRefineItem(dataDir, batchId, { owner: 'rw3' });
  assert.equal(nx2.itemId, later.id, '完成后才到下一条');
});

// ---------- C19：版本绑定与过期确认 ----------

t('C19 问题清单更新（重新声明）/ 文档被改 → 过期确认被拒；有效答案与确认时间可追溯', () => {
  const root = mkProject();
  const it = mkAcceptedItem(root_dataDir(root), '版本绑定条目');
  const { dataDir, run } = startRefineRun(root);
  declareHold(root, run.runId);
  confirmStore.answerAnalysisConfirm(dataDir, it.id, {
    answers: [{ q: 'q1', text: '方案 A' }, { q: 'q2', text: '高频' }],
  });

  // 不携带版本 = 无效确认
  const r0 = confirmStore.confirmAnalysisContinue(dataDir, it.id, {});
  assert.equal(r0.ok, false);
  assert.ok(r0.reasons.some((x) => x.includes('未携带问题版本')), `应说明无效确认：${r0.reasons.join('；')}`);

  // 旧版本（重新声明后）→ 过期
  const oldVersion = confirmStates.confirmOf(dataDir, it.id).questionsVersion;
  refine.declareRefineHold(dataDir, run.runId, {
    reason: '问题清单更新：新增权限确认',
    background: '补充背景',
    questions: [{ text: '新增：是否需要管理员角色' }],
  });
  const r1 = confirmStore.confirmAnalysisContinue(dataDir, it.id, { version: oldVersion });
  assert.equal(r1.ok, false);
  assert.ok(r1.reasons.some((x) => x.includes('过期')), `应提示过期：${r1.reasons.join('；')}`);
  assert.equal(confirmStates.confirmOf(dataDir, it.id).round, 2, '新一轮声明归档旧轮次');
  assert.equal(confirmStates.archivedRounds(dataDir, it.id), 1, '历史轮次留痕（旧答案可追溯）');

  // 声明后文档被改 → 过期拒绝
  confirmStore.answerAnalysisConfirm(dataDir, it.id, { answers: [{ q: 'q1', text: '需要' }] });
  const cur = confirmStates.confirmOf(dataDir, it.id);
  fs.appendFileSync(path.join(run.itemDir, 'README.md'), '\n声明后被人工改动的文档内容\n');
  const r2 = confirmStore.confirmAnalysisContinue(dataDir, it.id, { version: cur.questionsVersion });
  assert.equal(r2.ok, false);
  assert.ok(r2.reasons.some((x) => x.includes('文档在声明后被修改')), `应提示文档版本变化：${r2.reasons.join('；')}`);
});

// ---------- C20：恢复失败可重试 / 重复确认不重复启动 / 不自动流转 ----------

t('C20 恢复失败保留答案可重试；重复确认幂等不重复启动；确认不自动接受/开发/验收 done', () => {
  const root = mkProject();
  const it = mkAcceptedItem(root_dataDir(root), '恢复重试条目');
  const { dataDir, run } = startRefineRun(root);
  declareHold(root, run.runId);
  confirmStore.answerAnalysisConfirm(dataDir, it.id, {
    answers: [{ q: 'q1', text: '方案 B' }, { q: 'q2', text: '低频' }],
  });
  const rec = confirmStates.confirmOf(dataDir, it.id);
  const c = confirmStore.confirmAnalysisContinue(dataDir, it.id, { version: rec.questionsVersion });
  assert.ok(c.ok);

  // 恢复失败：用已收尾的 runId 续跑 → 报错；答案与已确认状态保留
  assert.throws(() => refine.resumeAfterAnalysisConfirm(dataDir, 'run-20990101-000000-0099'), /找不到完善执行/);
  const rec2 = confirmStates.confirmOf(dataDir, it.id);
  assert.equal(rec2.state, 'confirmed', '确认状态保留');
  assert.equal(rec2.questions[0].answer, '方案 B', '答案保留');

  // 重复确认：幂等成功，不重复启动
  const c2 = confirmStore.confirmAnalysisContinue(dataDir, it.id, { version: rec.questionsVersion });
  assert.equal(c2.ok, true);
  assert.equal(c2.idempotent, true);

  // 重试恢复：正确的 runId 成功；条目保持 accepted（不自动接受/开发/验收）
  const rr = refine.resumeAfterAnalysisConfirm(dataDir, run.runId);
  assert.ok(rr.ok);
  assert.equal(core.getItemDetail(dataDir, it.id).status, 'accepted');
});

// ---------- C21：共享账本与分形态呈现 ----------

t('C21 分析与开发阻塞共享同一清单入口，分别按 blockType 呈现；卡片字段一致', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const anIt = mkAcceptedItem(dataDir, '分析挂起条目');
  const { run } = startRefineRun(root);
  declareHold(root, run.runId);
  const lst = confirmStore.listConfirms(dataDir, { projectRoot: root });
  assert.equal(lst.count, 1);
  const an = lst.items[0];
  assert.equal(an.kindLabel, 'AI 分析');
  assert.equal(an.blockTypeLabel, '待人工确认分析');
  assert.ok(Array.isArray(an.questions) && an.questions.length === 2, '分析形态呈现问题清单');
  assert.ok(an.questionsVersion, '分析形态携带版本（确认绑定）');

  // UI 静态契约：统一面板 + 两形态渲染分支 + 队列横幅（app.js / index.html / state-guard）
  const app = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  assert.ok(app.includes('function renderConfirmArea'), '任务页应渲染挂起确认区');
  assert.ok(app.includes('function openConfirmPanel'), '应提供统一侧拉确认面板入口');
  assert.ok(app.includes("d.kind === 'develop'") && app.includes('confirmDraftBtn'), '面板应按阻塞类型分形态（提交核验 / 分析表单）');
  assert.ok(app.includes('confirmQueueBannerHtml'), '队列区应显示暂停横幅');
  assert.ok(app.includes('待确认提交') && app.includes('待确认分析'), '看板行应区分两种挂起徽标');
  const html = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
  assert.ok(html.includes('id="confirmPanel"'), 'index.html 应有挂起确认面板骨架');
  const guardSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'state-guard.mjs'), 'utf8');
  assert.ok(guardSrc.includes('/api\\/confirms'), '人工确认写接口应纳入 Agent 拦截面');
});

function root_dataDir(root) {
  return core.dataDirFrom(root);
}

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
