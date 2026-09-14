#!/usr/bin/env node
// BUG-20260910-008 契约测试 —— 批量完善提示词按「完善完成后自动转入计划」开关分态：
// 关闭（默认）＝REQ-20260908-020 原约束口径逐字保留（零回归）；打开＝提示词说明 done 回执后
// 系统（非 Agent）自动 accepted → planned 属预期系统行为、不得据此暂停，Agent 自身纪律不放宽。
// 覆盖（test-cases.md A–E）：
//   A 主调度提示词生成两态（buildRefinePrompt / createRefineBatch 联动）
//   B codex 单项提示词两态（buildRefineWorkerPrompt / newCodexRefineRun 联动）
//   C 展示层归一（normalizePromptForDisplay：开方向补说明 / 关方向剥说明 / 无选项零回归 / 幂等）
//   D 透出链路（CLI refine create 分态回显、存量批次幂等回显归一、refineSummary 实时分态、usage 文案）
//   E 行为零回归护栏 + 等价实测（开启开关跑完整 2 条目批次不被中断）
// 用法：node scripts/tests/refine-prompt-autoplan-20260910-008.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as refine from '../lib/refine-store.mjs';
import * as batch from '../lib/batch.mjs';
import * as taskSettings from '../lib/task-settings.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB = path.join(pluginRoot, 'scripts', 'atb.mjs');

// 两态约束文案唯一事实源（task-settings.mjs 导出，生成层与展示归一层共用）
const OFF_SCHED = taskSettings.REFINE_SCHEDULER_KEEP_ACCEPTED_LINE;
const ON_SCHED = taskSettings.REFINE_SCHEDULER_AUTO_PLAN_LINES;
const OFF_WORKER = taskSettings.REFINE_WORKER_KEEP_ACCEPTED_LINE;
const ON_WORKER = taskSettings.REFINE_WORKER_AUTO_PLAN_LINES;

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- 脚手架 ----------

function mkProject(prefix = 'atb-b31-') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const dataDir = core.initData(root);
  return { root, dataDir };
}

function mkAccepted(dataDir, title) {
  const st = core.createItem(dataDir, { type: 'requirement', title, description: 'x', by: 'tester' });
  core.setStatus(dataDir, st.id, 'accepted', { by: 'tester' });
  return st.id;
}

function atb(args, cwd) {
  const r = spawnSync(process.execPath, [ATB, ...args, '--dir', cwd], { encoding: 'utf8', timeout: 30_000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function atbJson(args, cwd) {
  const r = atb([...args, '--json'], cwd);
  assert.equal(r.code, 0, `atb ${args.join(' ')} 应成功（${r.err || r.out}）`);
  return JSON.parse(r.out.split('\n').filter(Boolean).pop());
}

const ledgerOf = (dataDir, batchId) =>
  JSON.parse(fs.readFileSync(path.join(dataDir, 'refine', 'batches', batchId, 'batch.json'), 'utf8'));

const workerArgs = {
  item: { id: 'REQ-20260910-001', title: '示例', itemDir: '/tmp/proj/docs/agent-team-board/requirements/REQ-20260910-001', reasons: [] },
  projectRoot: '/tmp/proj',
  runId: 'run-20260910-000000-0000',
};

const WORKER_TAIL = '不要写 test-report.md、不要 git commit；只编辑条目目录下的 markdown（涉及 UI 的需求或 Bug 可另建约定的 ui-demo.html）。';

// ---------- A 主调度提示词生成两态 ----------

t('A1 关闭（默认 / 显式 false）：约束首行与现状逐字一致、无自动转入计划字样（零回归）', () => {
  const base = { projectRoot: '/tmp/p', batchId: 'RFB-20260910-001', modelSource: 'follow' };
  const def = refine.buildRefinePrompt(base);
  assert.equal(def, refine.buildRefinePrompt({ ...base, autoPlan: false }), '默认与显式 false 输出一致');
  assert.ok(typeof OFF_SCHED === 'string' && OFF_SCHED.includes('条目全程保持 accepted（已接受）'), 'OFF 约束行常量定义（现状口径）');
  assert.ok(def.includes(OFF_SCHED), '约束首行保留现状文案');
  assert.ok(!def.includes('自动转入计划'), '默认关闭不出现自动转入计划说明');
  assert.ok(def.includes('不要调用 claim/report、不要写 test-report.md、不要 git commit'), '既有第二行（claim/report 等禁令）保留');
});

t('A2 打开：说明系统流转 + 不得据此暂停继续派发 + Agent 纪律不放宽', () => {
  const on = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-20260910-002', modelSource: 'follow', autoPlan: true });
  assert.ok(Array.isArray(ON_SCHED) && ON_SCHED.length >= 3, 'ON 约束段常量定义（多行说明）');
  assert.ok(on.includes(ON_SCHED.join('\n')), 'ON 约束段整段出现');
  assert.ok(!on.includes(OFF_SCHED), '不再输出与开关冲突的 OFF 约束行');
  for (const kw of ['完善完成后自动转入计划', 'accepted → planned', '已自动转入计划', '不要据此暂停、中止或等待人工确认', 'refine check', '继续派发下一个子代理', '保持 accepted（已接受）']) {
    assert.ok(on.includes(kw), `ON 提示词应含「${kw}」`);
  }
  for (const kw of ['不要修改业务源码', '不要修改条目 status.json', 'atb status']) {
    assert.ok(on.includes(kw), `Agent 纪律不放宽「${kw}」`);
  }
  assert.ok(on.includes('不要调用 claim/report、不要写 test-report.md、不要 git commit'), '既有第二行（claim/report 等禁令）保留');
});

t('A3 createRefineBatch 联动：设置开关决定冻结提示词分态（refineAutoPlanOn 实时读取）', () => {
  const off = mkProject('atb-b31-a3off-');
  const on = mkProject('atb-b31-a3on-');
  try {
    mkAccepted(off.dataDir, '联动关闭');
    const bOff = refine.createRefineBatch(off.dataDir, { projectRoot: off.root, modelSource: 'follow' }).batch;
    assert.ok(bOff.prompt.includes(OFF_SCHED), '默认关闭冻结 OFF 提示词');
    assert.ok(!bOff.prompt.includes('自动转入计划'), 'OFF 提示词无自动转入计划说明');
    assert.equal(refine.refineAutoPlanOn(off.dataDir), false, 'refineAutoPlanOn 关闭读取');

    taskSettings.saveTaskSettings(on.dataDir, { refine: { autoPlanAfterDone: true } });
    assert.equal(refine.refineAutoPlanOn(on.dataDir), true, 'refineAutoPlanOn 开启读取');
    mkAccepted(on.dataDir, '联动开启');
    const bOn = refine.createRefineBatch(on.dataDir, { projectRoot: on.root, modelSource: 'follow' }).batch;
    assert.ok(bOn.prompt.includes(ON_SCHED.join('\n')), '开启后新建批次冻结 ON 提示词');
    assert.ok(!bOn.prompt.includes(OFF_SCHED), 'ON 提示词不含 OFF 约束行');
  } finally {
    fs.rmSync(off.root, { recursive: true, force: true });
    fs.rmSync(on.root, { recursive: true, force: true });
  }
});

// ---------- B codex 单项提示词两态 ----------

t('B1 关闭（默认）：worker 第 3 条约束与现状逐字一致（零回归）', () => {
  const def = refine.buildRefineWorkerPrompt(workerArgs);
  assert.equal(def, refine.buildRefineWorkerPrompt({ ...workerArgs, autoPlan: false }), '默认与显式 false 输出一致');
  assert.ok(typeof OFF_WORKER === 'string' && OFF_WORKER.startsWith('3. 条目保持 accepted（已接受）'), 'OFF worker 约束行常量定义（现状口径）');
  assert.ok(def.includes(OFF_WORKER), '第 3 条约束保留现状文案');
  assert.ok(!def.includes('自动转入计划'), '默认关闭不出现自动转入计划说明');
  assert.ok(def.includes(WORKER_TAIL), '既有续行（test-report.md / git commit / 只编辑 markdown）保留');
});

t('B2 打开：worker 约束说明系统流转与不得暂停，自身仍不得改状态', () => {
  const on = refine.buildRefineWorkerPrompt({ ...workerArgs, autoPlan: true });
  assert.ok(Array.isArray(ON_WORKER) && ON_WORKER.length >= 2, 'ON worker 约束常量定义（多行说明）');
  assert.ok(on.includes(ON_WORKER.join('\n')), 'ON worker 约束段整段出现');
  assert.ok(!on.includes(OFF_WORKER), '不再输出与开关冲突的 OFF worker 约束行');
  for (const kw of ['完善完成后自动转入计划', 'accepted → planned', '已自动转入计划', '不要据此暂停', '不要改 status.json', 'atb status']) {
    assert.ok(on.includes(kw), `ON worker 提示词应含「${kw}」`);
  }
  assert.ok(on.includes(WORKER_TAIL), '既有续行（test-report.md / git commit / 只编辑 markdown）保留');
});

t('B3 newCodexRefineRun 联动：run.prompt 与 prompt.md 落盘按开关分态', () => {
  const off = mkProject('atb-b31-b3off-');
  const on = mkProject('atb-b31-b3on-');
  try {
    const idOff = mkAccepted(off.dataDir, 'worker 关闭');
    const bOff = refine.createRefineBatch(off.dataDir, { projectRoot: off.root, modelSource: 'follow' }).batch;
    const rOff = refine.newCodexRefineRun(off.dataDir, { batchId: bOff.batchId, item: { id: idOff, type: 'requirement', title: 'worker 关闭' }, projectRoot: off.root });
    assert.ok(rOff.prompt.includes(OFF_WORKER) && !rOff.prompt.includes('自动转入计划'), '关闭：run.prompt 为 OFF 文案');
    assert.equal(fs.readFileSync(path.join(refine.refineRunDir(off.dataDir, rOff.runId), 'prompt.md'), 'utf8'), rOff.prompt, 'prompt.md 与 run.prompt 一致');

    taskSettings.saveTaskSettings(on.dataDir, { refine: { autoPlanAfterDone: true } });
    const idOn = mkAccepted(on.dataDir, 'worker 开启');
    const bOn = refine.createRefineBatch(on.dataDir, { projectRoot: on.root, modelSource: 'follow' }).batch;
    const rOn = refine.newCodexRefineRun(on.dataDir, { batchId: bOn.batchId, item: { id: idOn, type: 'requirement', title: 'worker 开启' }, projectRoot: on.root });
    assert.ok(rOn.prompt.includes(ON_WORKER.join('\n')) && !rOn.prompt.includes(OFF_WORKER), '开启：run.prompt 为 ON 文案');
    assert.equal(fs.readFileSync(path.join(refine.refineRunDir(on.dataDir, rOn.runId), 'prompt.md'), 'utf8'), rOn.prompt, 'prompt.md 与 run.prompt 一致');
  } finally {
    fs.rmSync(off.root, { recursive: true, force: true });
    fs.rmSync(on.root, { recursive: true, force: true });
  }
});

// ---------- C 展示层归一（normalizePromptForDisplay） ----------

t('C1 开方向（autoPlan: true）：OFF 约束行（主调度 / worker 两形态）替换为 ON 文案，其余行逐字不动，幂等', () => {
  const offPrompt = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-1', modelSource: 'follow' });
  const on1 = taskSettings.normalizePromptForDisplay(offPrompt, { autoPlan: true });
  assert.ok(on1.includes(ON_SCHED.join('\n')), '主调度约束段替换为 ON 文案');
  assert.ok(!on1.includes(OFF_SCHED), 'OFF 约束行不再出现');
  assert.equal(taskSettings.normalizePromptForDisplay(on1, { autoPlan: true }), on1, '对已归一输出幂等');
  // 其余行不动：仅约束单行被替换为 ON 多行段，段外行序与原文一致
  const offLines = offPrompt.split('\n');
  const onLines = on1.split('\n');
  assert.deepEqual(
    onLines.slice(0, offLines.indexOf(OFF_SCHED)),
    offLines.slice(0, offLines.indexOf(OFF_SCHED)),
    '约束段之前的行逐字保留',
  );
  assert.deepEqual(
    onLines.slice(onLines.length - (offLines.length - offLines.indexOf(OFF_SCHED) - 1)),
    offLines.slice(offLines.indexOf(OFF_SCHED) + 1),
    '约束段之后的行逐字保留',
  );
  const onW = taskSettings.normalizePromptForDisplay(refine.buildRefineWorkerPrompt(workerArgs), { autoPlan: true });
  assert.ok(onW.includes(ON_WORKER.join('\n')), 'worker 约束行替换为 ON 文案');
  assert.ok(!onW.includes(OFF_WORKER), 'OFF worker 约束行不再出现');
});

t('C2 无选项零回归：OFF 输出原样返回；开发侧提示词传 autoPlan: true 不被改写', () => {
  const off = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-1', modelSource: 'follow' });
  assert.equal(taskSettings.normalizePromptForDisplay(off), off, 'OFF 提示词无选项原样返回（既有调用形态零回归）');
  assert.equal(taskSettings.normalizePromptForDisplay(off, {}), off, '空选项对象同无选项');
  const dev = batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'batch-1', workerSpecPath: '/tmp/spec.md', modelSource: 'follow' });
  assert.equal(taskSettings.normalizePromptForDisplay(dev, { autoPlan: true }), dev, '开发侧提示词不含完善约束行，autoPlan 选项不影响');
});

t('C3 关方向（autoPlan: false）：ON 文案归一回 OFF 约束行（实时口径两方向），幂等', () => {
  const on = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-1', modelSource: 'follow', autoPlan: true });
  const off = taskSettings.normalizePromptForDisplay(on, { autoPlan: false });
  assert.ok(off.includes(OFF_SCHED), '归一回 OFF 约束行');
  assert.ok(!off.includes('自动转入计划'), '自动转入计划说明被剥除');
  assert.equal(taskSettings.normalizePromptForDisplay(off, { autoPlan: false }), off, '幂等');
  const onW = refine.buildRefineWorkerPrompt({ ...workerArgs, autoPlan: true });
  const offW = taskSettings.normalizePromptForDisplay(onW, { autoPlan: false });
  assert.ok(offW.includes(OFF_WORKER) && !offW.includes('自动转入计划'), 'worker ON 文案归一回 OFF 行');
  assert.equal(taskSettings.normalizePromptForDisplay(offW, { autoPlan: false }), offW, 'worker 幂等');
});

t('C4 非字符串透传：null / undefined / 空串不受选项影响', () => {
  assert.equal(taskSettings.normalizePromptForDisplay(null, { autoPlan: true }), null, 'null 透传');
  assert.equal(taskSettings.normalizePromptForDisplay(undefined, { autoPlan: false }), undefined, 'undefined 透传');
  assert.equal(taskSettings.normalizePromptForDisplay('', { autoPlan: true }), '', '空串透传');
});

// ---------- D 透出链路（CLI / 数据层，账本不回写） ----------

t('D1 CLI refine create 分态回显：默认关闭与现状一致；开启后 prompt 含说明、输出行标注已开启', () => {
  const off = mkProject('atb-b31-d1off-');
  const on = mkProject('atb-b31-d1on-');
  try {
    mkAccepted(off.dataDir, 'CLI 关闭');
    const textOff = atb(['refine', 'create'], off.root);
    assert.equal(textOff.code, 0, '关闭路径 create 应成功');
    assert.match(textOff.out, /条目保持 accepted（已接受），不占实施互斥/, '关闭：输出行与现状一致');
    assert.ok(!textOff.out.includes('自动转入计划'), '关闭：全文无自动转入计划说明');
    // REQ-20260913-003：重复创建被拒——JSON 口径改读账本落盘提示词
    const offLedger = refine.queueHeadRefineBatch(off.dataDir);
    assert.ok(!offLedger.prompt.includes('自动转入计划'), '关闭：账本 prompt 无说明');

    mkAccepted(on.dataDir, 'CLI 开启');
    taskSettings.saveTaskSettings(on.dataDir, { refine: { autoPlanAfterDone: true } });
    const textOn = atb(['refine', 'create'], on.root);
    assert.equal(textOn.code, 0, '开启路径 create 应成功');
    assert.match(textOn.out, /完善后自动转入计划已开启/, '开启：输出行标注已开启');
    assert.match(textOn.out, /属预期系统行为/, '开启：输出行说明属预期系统行为');
    const onLedger = refine.queueHeadRefineBatch(on.dataDir);
    assert.ok(onLedger.prompt.includes('完善完成后自动转入计划'), '开启：账本 prompt 含开关说明');
    assert.ok(onLedger.prompt.includes('不要据此暂停、中止或等待人工确认'), '开启：账本 prompt 含不得暂停指令');
  } finally {
    fs.rmSync(off.root, { recursive: true, force: true });
    fs.rmSync(on.root, { recursive: true, force: true });
  }
});

t('D2 存量未结束批次：冻结 OFF 提示词 → 打开开关 → 公开视图归一为 ON；账本冻结原文不被改写', () => {
  const p = mkProject('atb-b31-d2-');
  try {
    mkAccepted(p.dataDir, '存量批次');
    const first = atbJson(['refine', 'create'], p.root);
    const rawBefore = ledgerOf(p.dataDir, first.batchId).prompt;
    assert.ok(rawBefore.includes(OFF_SCHED), '创建时（关闭）冻结 OFF 原文');
    taskSettings.saveTaskSettings(p.dataDir, { refine: { autoPlanAfterDone: true } });
    // REQ-20260913-003：重复创建被拒——公开视图（summary/publicView 数据源）按当前开关归一
    const view = refine.refineBatchPublicView(refine.getRefineBatch(p.dataDir, first.batchId), { autoPlan: true });
    assert.ok(view.prompt.includes(ON_SCHED.join('\n')), '公开视图按当前开关归一为 ON 文案');
    assert.ok(!view.prompt.includes(OFF_SCHED), '视图不再含 OFF 约束行');
    assert.equal(ledgerOf(p.dataDir, first.batchId).prompt, rawBefore, '账本冻结原文不回写');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

t('D3 数据层实时分态：refineSummary 按当前开关归一（开 → ON 段；关回 → OFF 行），账本原文不变', () => {
  const p = mkProject('atb-b31-d3-');
  try {
    mkAccepted(p.dataDir, '实时分态');
    const { batch } = refine.createRefineBatch(p.dataDir, { projectRoot: p.root, modelSource: 'follow' });
    const rawBefore = ledgerOf(p.dataDir, batch.batchId).prompt;
    assert.ok(refine.refineSummary(p.dataDir, batch.batchId).batch.prompt.includes(OFF_SCHED), '关闭：OFF 约束行');
    taskSettings.saveTaskSettings(p.dataDir, { refine: { autoPlanAfterDone: true } });
    assert.ok(refine.refineSummary(p.dataDir, batch.batchId).batch.prompt.includes(ON_SCHED.join('\n')), '打开：ON 约束段');
    taskSettings.saveTaskSettings(p.dataDir, { refine: { autoPlanAfterDone: false } });
    const s = refine.refineSummary(p.dataDir, batch.batchId);
    assert.ok(s.batch.prompt.includes(OFF_SCHED) && !s.batch.prompt.includes('自动转入计划'), '关回：OFF 约束行');
    assert.equal(ledgerOf(p.dataDir, batch.batchId).prompt, rawBefore, '账本原文不变（展示层不回写）');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

t('D4 usage 文案：说明开启开关时 done 后系统自动 accepted → planned 属预期系统行为、Agent 仍不得改状态', () => {
  const p = mkProject('atb-b31-d4-');
  try {
    const r = atb(['refine'], p.root); // 无子命令 → 输出 usage（stderr，退出码 1）
    assert.notEqual(r.code, 0, '无子命令应非零退出');
    for (const kw of ['完善完成后自动转入计划', 'accepted → planned', '属预期系统行为', 'Agent 自身仍不得改条目状态']) {
      assert.ok(r.err.includes(kw), `usage 应含「${kw}」`);
    }
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

// ---------- E 行为零回归护栏 + 等价实测 ----------

t('E1 行为零回归：done 流转输出 / autoPlanRefinedItem 接入 / state-guard / HUMAN_ONLY_TO 契约不变', () => {
  const cli = fs.readFileSync(ATB, 'utf8');
  assert.match(cli, /已自动转入计划：\$\{receipt\.itemId\}（accepted → planned，进入 AI 开发候选）/, 'done 成功流转输出行不变（REQ-20260913-005 改名）');
  assert.match(cli, /未开启自动转入计划：需人工移入计划（设置 → 批量任务 → 完善完成后自动转入计划）/, 'done 未开启输出行不变');
  const lib = fs.readFileSync(path.join(pluginRoot, 'scripts', 'lib', 'refine-store.mjs'), 'utf8');
  assert.match(lib, /autoPlanRefinedItem\(dataDir, run\.itemId, runId\)/, 'finishRefineRun 仍内部接入自动流转');
  const coreSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'lib', 'core.mjs'), 'utf8');
  assert.match(coreSrc, /HUMAN_ONLY_TO = new Set\(\['accepted', 'planned', 'done'\]\)/, 'HUMAN_ONLY_TO 集合不变');
});

t('E2 等价实测（本环境无受影响 Agent 会话）：开启开关完整跑 2 条目批次——done 输出已自动转入计划、条目转 planned、check 保持 continue、第二条可继续领取至收工', () => {
  const p = mkProject('atb-b31-e2-');
  try {
    const ids = [mkAccepted(p.dataDir, '批次推进甲'), mkAccepted(p.dataDir, '批次推进乙')];
    taskSettings.saveTaskSettings(p.dataDir, { refine: { autoPlanAfterDone: true } });
    const created = atbJson(['refine', 'create'], p.root);
    assert.ok(created.prompt.includes('不要据此暂停、中止或等待人工确认'), '回显提示词含不得暂停指令');
    let step = 0;
    for (const id of ids) {
      step++;
      const got = atbJson(['refine', 'next', '--by', `refine-031-${step}`], p.root);
      assert.equal(got.itemId, id, `第 ${step} 条按序领取`);
      fs.writeFileSync(path.join(got.itemDir, 'README.md'), `# r\n等价实测第 ${step} 条补全的说明文字，超过三十个字符阈值。`);
      const done = atb(['refine', 'done', got.runId, '--summary', `补全第 ${step} 条`], p.root);
      assert.equal(done.code, 0, `第 ${step} 条 done 应成功（${done.err}）`);
      assert.match(done.out, new RegExp(`已自动转入计划：${id}`), `第 ${step} 条 done 输出「已自动转入计划」`);
      assert.equal(core.readStatus(core.resolveItemDir(p.dataDir, id).dir).status, 'planned', `第 ${step} 条系统流转 planned`);
      if (step < ids.length) {
        const check = atbJson(['refine', 'check'], p.root);
        assert.equal(check.nextAction, 'continue', '流转发生后核对仍 continue（批次推进不被中断）');
      }
    }
    const fin = atbJson(['refine', 'check'], p.root);
    assert.equal(fin.nextAction, 'stop', '全部完成后收工');
    assert.equal(fin.counts.done, ids.length, '两条均记完成');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

// ---------- 执行 ----------

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
