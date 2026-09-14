#!/usr/bin/env node
// REQ-20260908-020 重构批量流程和任务管理 —— 数据层测试
// 覆盖：完善候选口径（accepted + 实时读取）、单级完善三态（未完善/完善中/已完善）、
//       完善中禁驳、驳回后重置、终止（refine/batch abort）、双 Agent 差异化提示词、
//       批量任务设置（Agent 展示 + 四路模型档位）
// 用法：node scripts/tests/tasks-refine.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as refine from '../lib/refine-store.mjs';
import * as batch from '../lib/batch.mjs';
import * as refineStates from '../lib/refine-states.mjs';
import * as taskSettings from '../lib/task-settings.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-tasks-refine-')));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  return { root, dataDir };
}

function accept(dataDir, id) {
  core.setStatus(dataDir, id, 'accepted', { by: 'human' });
}

t('T1 候选口径：已接受未完善单进入候选；待接受/已计划/已完善单不进入', () => {
  const { root, dataDir } = mkProject();
  const sub = core.createItem(dataDir, { type: 'requirement', title: '待接受不进' });
  const acc1 = core.createItem(dataDir, { type: 'requirement', title: '已接受进' });
  accept(dataDir, acc1.id);
  const plan1 = core.createItem(dataDir, { type: 'requirement', title: '已计划不进' });
  accept(dataDir, plan1.id);
  core.setStatus(dataDir, plan1.id, 'planned', { by: 'human' });

  let cands = refine.refineCandidates(dataDir);
  assert.deepEqual(cands.map((x) => x.id), [acc1.id], `只有已接受单进候选（得到 ${cands.map((x) => x.id)}）`);
  assert.ok(Array.isArray(cands[0].reasons), '候选仍携带完整性原因（用于展示）');

  // 已完善（refined）不再进候选
  refineStates.setRefineItemState(dataDir, acc1.id, 'refined');
  cands = refine.refineCandidates(dataDir);
  assert.equal(cands.length, 0, '已完善单不进候选');
  assert.equal(sub.status, 'submitted');
});

t('T2 实时读取：创建任务后新接受的单在下一轮领取时被吸收处理', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: '先接受' });
  accept(dataDir, a.id);
  const { batch: b } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  assert.deepEqual(b.candidates, [], '建轮不冻结候选快照（REQ-20260913-003）');
  assert.deepEqual(refine.effectiveRefineCandidates(dataDir, b).map((c) => c.id), [a.id]);

  // 创建后新接受的单 → 下一轮 next 实时吸收
  const late = core.createItem(dataDir, { type: 'requirement', title: '后接受' });
  accept(dataDir, late.id);
  const got = refine.nextRefineItem(dataDir, b.batchId, { owner: 'w1' });
  assert.equal(got.itemId, a.id);
  const fin = refine.finishRefineRun(dataDir, got.runId, { result: 'failed', reason: '先失败换下一项' });
  assert.equal(fin.receipt.result, 'failed');
  const got2 = refine.nextRefineItem(dataDir, b.batchId, { owner: 'w1' });
  assert.equal(got2.itemId, late.id, '后接受的单应被实时吸收并领取');
});

t('T3 三态置位：接受→未完善；领取→完善中；done→已完善；fail→未完善；release→未完善', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: '三态' });
  accept(dataDir, a.id);
  assert.equal(refineStates.refineStateOf(dataDir, a.id), 'unrefined', '接受进入时置未完善');

  const { batch: b } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  const got = refine.nextRefineItem(dataDir, b.batchId, { owner: 'w1' });
  assert.equal(refineStates.refineStateOf(dataDir, got.itemId), 'refining', '领取后置完善中');

  fs.writeFileSync(path.join(got.itemDir, 'README.md'), '# a\n\n## 描述\n补全后的说明文字长度超过阈值三十个字符以上，可判定为真实变更。\n\n## 验收标准\n\n- [x] 可跑\n');
  refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补全描述' });
  assert.equal(refineStates.refineStateOf(dataDir, got.itemId), 'refined', 'done 核验通过置已完善');

  // fail 回置未完善并可重新领取
  const c = core.createItem(dataDir, { type: 'requirement', title: '失败路径' });
  accept(dataDir, c.id);
  const got2 = refine.nextRefineItem(dataDir, b.batchId, { owner: 'w2' });
  refine.finishRefineRun(dataDir, got2.runId, { result: 'failed', reason: '信息不足' });
  assert.equal(refineStates.refineStateOf(dataDir, got2.itemId), 'unrefined', 'fail 回置未完善');

  // release 回置未完善
  const d = core.createItem(dataDir, { type: 'requirement', title: '释放路径' });
  accept(dataDir, d.id);
  const got3 = refine.nextRefineItem(dataDir, b.batchId, { owner: 'w3' });
  refine.releaseRefineRun(dataDir, got3.runId, { reason: '认领冲突' });
  assert.equal(refineStates.refineStateOf(dataDir, got3.itemId), 'unrefined', 'release 回置未完善');
});

t('T4 三态只落执行账本：states.json 在 refine/ 下；status.json 无新增字段', () => {
  const { dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: '账本隔离' });
  accept(dataDir, a.id);
  const statesFile = path.join(dataDir, 'refine', 'states.json');
  assert.ok(fs.existsSync(statesFile), '三态索引应落在 refine/states.json');
  const raw = JSON.parse(fs.readFileSync(statesFile, 'utf8'));
  assert.equal(raw.items[a.id].state, 'unrefined');
  const st = JSON.parse(fs.readFileSync(path.join(core.resolveItemDir(dataDir, a.id).dir, 'status.json'), 'utf8'));
  assert.equal(st.refineState, undefined, 'status.json 不得新增完善状态字段');
});

t('T5 完善中禁驳：setStatus accepted→submitted 拒绝；未完善/已完善可驳回；再接受重置未完善', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: '禁驳' });
  accept(dataDir, a.id);
  const { batch: b } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  const got = refine.nextRefineItem(dataDir, b.batchId, { owner: 'w1' });
  assert.throws(() => core.setStatus(dataDir, a.id, 'submitted', { by: 'human' }), /完善中/, '完善中应拒绝驳回');

  // 未完善/已完善可正常驳回（REQ-20260907-011 回归）
  fs.writeFileSync(path.join(got.itemDir, 'README.md'), '# a\n\n## 描述\n补全后的说明文字长度超过阈值三十个字符以上，可判定为真实变更。\n');
  refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补全' });
  assert.equal(refineStates.refineStateOf(dataDir, a.id), 'refined');
  core.setStatus(dataDir, a.id, 'submitted', { by: 'human' }); // 已完善可驳回
  accept(dataDir, a.id);
  assert.equal(refineStates.refineStateOf(dataDir, a.id), 'unrefined', '再次接受一律重置未完善');
});

t('T6 refine 终止：剩余项出局、在途 interrupted、锁释放、批次终止态、提示人工停止在途子代理', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: '在途' });
  accept(dataDir, a.id);
  const b1 = core.createItem(dataDir, { type: 'requirement', title: '剩余1' });
  accept(dataDir, b1.id);
  const b2 = core.createItem(dataDir, { type: 'requirement', title: '剩余2' });
  accept(dataDir, b2.id);
  const { batch: b } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  const got = refine.nextRefineItem(dataDir, b.batchId, { owner: 'w1' });
  assert.ok(fs.existsSync(path.join(dataDir, '.locks', 'refine.lock')), '领取持有互斥锁');

  const r = refine.abortRefineBatch(dataDir, b.batchId);
  assert.equal(r.ok, true);
  assert.match(r.notice, /在途子代理.*人工停止/, '终止提示应含在途子代理人工停止指引');
  const after = refine.getRefineBatch(dataDir, b.batchId);
  assert.equal(after.aborted, true, '批次落终止标记');
  assert.equal(after.status, 'finished', '批次转终止态（finished+aborted）');
  assert.equal(refine.getRefineRun(dataDir, got.runId).phase, 'interrupted', '在途运行落 interrupted');
  assert.match(refine.getRefineRun(dataDir, got.runId).reason, /人工终止/);
  assert.equal(refineStates.refineStateOf(dataDir, a.id), 'unrefined', '在途项回置未完善');
  const runs = refine.listRefineRuns(dataDir, b.batchId, { offset: 0, limit: 20 });
  assert.equal(runs.records.filter((x) => x.result === 'skipped').length, 2, '剩余两项出局');
  assert.equal(runs.records.filter((x) => x.result === 'skipped' && x.itemId === b1.id).length, 1);
  assert.ok(!fs.existsSync(path.join(dataDir, '.locks', 'refine.lock')), 'refine 锁全部释放');
  const ck = refine.checkRefineBatch(dataDir, b.batchId);
  assert.equal(ck.nextAction, 'stop', '终止后核对停止派发');
  // 终止后可立即启动新任务（不残留旧锁）
  const { batch: nb } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  assert.notEqual(nb.batchId, b.batchId);
  assert.doesNotThrow(() => refine.nextRefineItem(dataDir, nb.batchId, { owner: 'w2' }));
});

t('T7 batch 终止：剩余项 skipped 出局、在途 interrupted、impl 锁释放、next 停止派发', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: 'a' });
  accept(dataDir, a.id);
  core.setStatus(dataDir, a.id, 'planned', { by: 'human' });
  const b = core.createItem(dataDir, { type: 'requirement', title: 'b' });
  accept(dataDir, b.id);
  core.setStatus(dataDir, b.id, 'planned', { by: 'human' });
  const { batch: bt } = batch.createBatch(dataDir, { projectRoot: root });
  const got = batch.nextItem(dataDir, bt.batchId, { owner: 'w1' });
  assert.ok(fs.existsSync(path.join(dataDir, '.locks', 'impl.lock')), '领取持有实施互斥');

  const r = batch.abortBatch(dataDir, bt.batchId);
  assert.equal(r.ok, true);
  assert.match(r.notice, /人工停止/, '提示在途子代理人工停止');
  const after = batch.getBatch(dataDir, bt.batchId);
  assert.equal(after.aborted, true);
  assert.equal(after.status, 'finished');
  assert.equal(batch.getRun(dataDir, got.runId).phase, 'interrupted');
  assert.match(batch.getRun(dataDir, got.runId).reason, /人工终止/);
  const runs = batch.listRuns(dataDir, bt.batchId, { offset: 0, limit: 20 });
  assert.equal(runs.records.filter((x) => x.result === 'skipped').length, 1, '未领取项出局');
  assert.ok(!fs.existsSync(path.join(dataDir, '.locks', 'impl.lock')), 'impl 锁全部释放');
  const nxt = batch.nextItem(dataDir, bt.batchId, { owner: 'w2' });
  assert.equal(nxt.stop, 'aborted', '终止后 next 停止派发');
  // 终止后可创建新批次
  const { batch: nb } = batch.createBatch(dataDir, { projectRoot: root });
  assert.notEqual(nb.batchId, bt.batchId);
});

t('T8 通用提示词（REQ-20260909-011）：agent 参数忽略、单一版本且无执行端字样；调度要素保留', () => {
  const z = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-20260908-001', agent: 'zcode' });
  const c = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-20260908-001', agent: 'codex' });
  assert.equal(z, c, 'agent 参数忽略：完善主调度提示词单一通用版');
  assert.doesNotMatch(z, /zcode|Zcode|codex|Codex|general-purpose/, '通用提示词不得出现执行端字样');
  for (const p of [z, c]) {
    assert.ok(p.includes('只补 README'), '补文档口径保留');
    assert.ok(p.includes('atb refine next'), '领取命令保留');
    assert.ok(p.includes('保持 accepted'), '条目保持已接受口径');
  }

  const dz = batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'batch-20260908-001', workerSpecPath: '/tmp/spec.md', agent: 'zcode' });
  const dc = batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'batch-20260908-001', workerSpecPath: '/tmp/spec.md', agent: 'codex' });
  assert.equal(dz, dc, '开发主调度提示词单一通用版（agent 参数忽略）');
  assert.doesNotMatch(dz, /zcode|Zcode|codex|Codex|general-purpose/, '开发提示词不得出现执行端字样');
});

t('T9 批次 agent 落盘（REQ-20260909-011 新口径）：新建批次 agent 记 subagent、提示词通用；显式旧 mode 直连兼容', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: 'a' });
  accept(dataDir, a.id);
  const { batch: rb } = refine.createRefineBatch(dataDir, { projectRoot: root });
  assert.equal(rb.agent, 'subagent', '新建完善批次 agent 记通用子代理模式标识');
  assert.ok(rb.prompt && !/zcode|Zcode|codex|Codex|general-purpose/.test(rb.prompt), '提示词单一通用版（无执行端字样）');

  // 显式 codex（存量语义兼容）：直连传参仍按传入值落账
  refine.abortRefineBatch(dataDir, rb.batchId);
  const a2 = core.createItem(dataDir, { type: 'requirement', title: 'a2' });
  accept(dataDir, a2.id);
  const { batch: rb2 } = refine.createRefineBatch(dataDir, { mode: 'codex', projectRoot: root });
  assert.equal(rb2.agent, 'codex', '显式 mode 直连仍按传入值落账');
  assert.doesNotMatch(rb2.prompt, /zcode|Zcode|codex|Codex|general-purpose/, '显式 codex 亦输出通用提示词');

  const p = core.createItem(dataDir, { type: 'requirement', title: 'p' });
  accept(dataDir, p.id);
  core.setStatus(dataDir, p.id, 'planned', { by: 'human' });
  const { batch: db } = batch.createBatch(dataDir, { projectRoot: root });
  assert.equal(db.agent, 'subagent', '新建开发批次 agent 记通用子代理模式标识');
  assert.doesNotMatch(db.prompt, /zcode|Zcode|codex|Codex|general-purpose/, '开发提示词单一通用版');
});

t('T10 批量任务设置：默认值（完善高智能/开发一般智能、双 Agent 全展示）、保存校验、持久化', () => {
  const { dataDir } = mkProject();
  let s = taskSettings.loadTaskSettings(dataDir);
  assert.deepEqual(s.agents.refine, ['zcode', 'codex'], '缺省完善双 Agent 展示');
  assert.deepEqual(s.agents.develop, ['zcode', 'codex']);
  assert.equal(s.models.refine.zcode.level, 'high', '完善默认高智能');
  assert.equal(s.models.develop.zcode.level, 'medium', '开发默认一般智能');
  assert.equal(s.models.refine.codex.level, 'high');

  s = taskSettings.saveTaskSettings(dataDir, {
    agents: { refine: ['zcode'], develop: ['codex'] },
    models: { refine: { zcode: { model: 'glm-5.3', level: 'medium' } } },
  });
  assert.deepEqual(s.agents.refine, ['zcode'], '隐藏 codex 后完善启动只展示 zcode');
  assert.deepEqual(s.agents.develop, ['codex'], '两类任务 Agent 展示互不影响');
  assert.equal(s.models.refine.zcode.model, 'glm-5.3');
  assert.equal(s.models.refine.zcode.level, 'medium');
  assert.equal(taskSettings.loadTaskSettings(dataDir).models.refine.zcode.model, 'glm-5.3', '持久化可读');

  // REQ-20260908-026：全部隐藏成为合法持久态（启动区据此禁用并提示到任务设置取消隐藏）
  const allHidden = taskSettings.saveTaskSettings(dataDir, { agents: { refine: [] } });
  assert.deepEqual(allHidden.agents.refine, [], 'Agent 列表允许为空（全部隐藏）');
  assert.throws(() => taskSettings.saveTaskSettings(dataDir, { agents: { refine: ['gpt'] } }), /Agent/, 'Agent 只能是 zcode/codex');
  assert.throws(() => taskSettings.saveTaskSettings(dataDir, { models: { refine: { zcode: { level: 'ultra' } } } }), /档位/, '档位只能高/中/低');
  taskSettings.saveTaskSettings(dataDir, { agents: { refine: ['zcode'], develop: ['codex'] } }); // 恢复现场
});

t('T11 BUG-20260908-013：领取落账继承批次执行 Agent（codex 批次 run.mode === codex，zcode 不回退）', () => {
  const { root, dataDir } = mkProject();
  const a = core.createItem(dataDir, { type: 'requirement', title: 'codex 领取' });
  accept(dataDir, a.id);
  const { batch: cb } = refine.createRefineBatch(dataDir, { mode: 'codex', projectRoot: root });
  const got = refine.nextRefineItem(dataDir, cb.batchId, { owner: 'codex-test' });
  assert.equal(refine.getRefineRun(dataDir, got.runId).mode, 'codex', 'codex 批次领取落账应为 codex');
  refine.finishRefineRun(dataDir, got.runId, { result: 'failed', reason: '测试收尾' });

  // zcode 回归：独立临时项目（同项目两个未结束批次会排队保护，无法直接领取）
  const z = mkProject();
  const b = core.createItem(z.dataDir, { type: 'requirement', title: 'zcode 领取' });
  accept(z.dataDir, b.id);
  const { batch: zb } = refine.createRefineBatch(z.dataDir, { mode: 'zcode', projectRoot: z.root });
  const got2 = refine.nextRefineItem(z.dataDir, zb.batchId, { owner: 'zcode-test' });
  assert.equal(refine.getRefineRun(z.dataDir, got2.runId).mode, 'zcode', 'zcode 批次领取落账保持 zcode');
});

t('T12 领取前缀通用化（REQ-20260909-011）：单一 refine- 前缀，不再 zcode-refine / codex-refine 二选一', () => {
  const p = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-20260908-009' });
  assert.ok(p.includes('refine-<序号>'), '领取命令使用单一通用前缀（去批次尾号，REQ-20260913-003）');
  assert.ok(!p.includes('zcode-refine') && !p.includes('codex-refine'), '不再出现按 Agent 差异化的领取前缀');
  const c = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-20260908-009', agent: 'codex' });
  assert.ok(c.includes('refine-<序号>'), '显式 codex 参数亦输出通用前缀（去批次尾号）');
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
