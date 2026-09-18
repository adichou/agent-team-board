#!/usr/bin/env node
// BUG-20260916-002 任务记录重新执行无法续接已认领后 blocked 的条目 —— 数据层 + 前端/服务端静态契约 + i18n
// 覆盖：续接判定（blocked 终态 + 条目仍被原 owner 认领 + 无在途）、提示词要素清单、
//       不变量（不新建 run / 不改业务状态）、防线（在途拒绝、身份不符回退原路径）、
//       原路径回归（failed/interrupted 重建不受影响）、前端路由与面板、服务端路由、词典同步。
// 用法：node scripts/tests/retry-blocked-continue-20260916-002.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';
import '../web/i18n.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const appJs = fs.readFileSync(path.join(repoRoot, 'scripts', 'web', 'app.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(repoRoot, 'scripts', 'server.mjs'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function mkProject(prefix) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const dataDir = core.initData(root);
  batch.ensureDispatch(dataDir);
  return { root, dataDir };
}

function mkDevItem(p, title) {
  const st = core.createItem(p.dataDir, { type: 'requirement', title, description: 'x', by: 'tester' });
  core.setStatus(p.dataDir, st.id, 'accepted', { by: 'human' });
  core.setStatus(p.dataDir, st.id, 'planned', { by: 'human' });
  return st.id;
}

function readItemSt(p, id) {
  return JSON.parse(fs.readFileSync(core.statusFileOfItemDir(core.resolveItemDir(p.dataDir, id).dir), 'utf8'));
}

function writeItemSt(p, id, patch) {
  const sf = core.statusFileOfItemDir(core.resolveItemDir(p.dataDir, id).dir);
  fs.writeFileSync(sf, JSON.stringify({ ...JSON.parse(fs.readFileSync(sf, 'utf8')), ...patch }, null, 2) + '\n');
}

// 复现路径构造：条目被 worker 认领后上报 blocked 回执（终态运行，业务状态保持 in-progress）
function mkBlockedClaimed(p, title, owner) {
  const a = mkDevItem(p, title);
  const { batch: b } = batch.createBatch(p.dataDir, { projectRoot: p.root });
  const r1 = batch.nextItem(p.dataDir, b.batchId, { owner });
  assert.equal(r1.itemId, a, '前置：worker 领取该条目');
  core.claim(p.dataDir, a, owner);
  batch.finishRun(p.dataDir, r1.runId, { result: 'blocked', reason: '边界待确认' });
  return { a, batchId: b.batchId, runId: r1.runId };
}

const W1 = 'zcode-continue-w1';

// ---------- 数据层：续接核心场景 ----------

t('D1 continueRun：blocked 终态 + 条目仍被原 owner 认领 + 无在途 → 返回续接提示词（要素齐全）', () => {
  const p = mkProject('atb-cont-core-');
  const title = '受阻后人工确认边界';
  const { a, batchId, runId } = mkBlockedClaimed(p, title, W1);

  const r = batch.continueRun(p.dataDir, runId, { projectRoot: p.root });
  assert.equal(r.ok, true, '满足续接条件应返回 ok');
  assert.equal(r.itemId, a);
  assert.equal(r.owner, W1, '携带原认领身份');
  assert.equal(r.title, title, '携带条目标题');
  const pr = r.prompt;
  // 提示词内容核对清单（README 验收 A3）
  for (const frag of [
    a, title, W1, p.root,
    `claim ${a} --by ${W1}`, // 同 owner 幂等续认指令
    '旧 worker 已停止且无活动 worker', // 第一步核对
    'README.md', 'design.md', // 条目文档入口
    'worker-spec.md', // 执行规范入口（dispatch 快照）
    'skills/agent-team-board/worker-spec.md', // 事实源说明
    'report', '不带 --run', // 单项 /dev 收口口径
    '不走普通新批次入队', '不复用终态旧运行', '不新建 run', // 红线
    '不代替人工接受', // 不冒充人工
  ]) assert.ok(pr.includes(frag), `提示词应包含：${frag}`);
  // 第一步（旧 worker 核对）须位于续认指令之前
  assert.ok(pr.indexOf('旧 worker 已停止且无活动 worker') < pr.indexOf(`claim ${a} --by`), '核对旧 worker 应为第一步');

  // 幂等：重复请求返回一致结果，仍不产生新账目
  const again = batch.continueRun(p.dataDir, runId, { projectRoot: p.root });
  assert.equal(again.ok, true, '重复续接幂等');
  assert.equal(again.prompt, pr, '提示词稳定');

  // 不变量：不新建运行账目、不修改条目业务状态与认领身份
  assert.equal(batch.listRuns(p.dataDir, batchId).total, 1, '不新建 run 账目');
  const st = readItemSt(p, a);
  assert.equal(st.status, 'in-progress', '条目业务状态不被修改');
  assert.equal(st.owner, W1, '认领身份不被清除');
});

t('D2 防线：blocked 记录但该条目仍存在在途（非终态）运行 → 拒绝生成续接提示词（防双执行）', () => {
  const p = mkProject('atb-cont-inflight-');
  const { a, runId } = mkBlockedClaimed(p, '在途防线', W1);
  // 构造同条目的在途运行（预留态）：直接落一份非终态 run 账目
  const runsRoot = path.join(p.dataDir, 'runtime', 'dispatch', 'runs');
  const inflightId = 'run-fabricated-001';
  fs.mkdirSync(path.join(runsRoot, inflightId), { recursive: true });
  fs.writeFileSync(path.join(runsRoot, inflightId, 'run.json'), JSON.stringify({
    runId: inflightId, batchId: 'batch-x', itemId: a, owner: W1, phase: 'reserved', createdAt: new Date().toISOString(),
  }));
  const r = batch.continueRun(p.dataDir, runId, { projectRoot: p.root });
  assert.equal(r.ok, false, '在途执行不得生成续接提示词');
  assert.equal(r.fallback, 'none', '不回退重建路径（直接给指引）');
  assert.match(r.message, /在途/, '按「已有在途执行」口径给出指引');
  assert.ok(!('prompt' in r), '不得携带提示词');
});

t('D3 防线：owner 与运行记录不一致或条目非 in-progress → 不进续接分支，回退既有路径', () => {
  // 变体一：条目仍 in-progress 但认领身份已变化
  const p1 = mkProject('atb-cont-owner-');
  const { a, runId } = mkBlockedClaimed(p1, '身份变化', W1);
  writeItemSt(p1, a, { owner: 'human-moved' });
  const r1 = batch.continueRun(p1.dataDir, runId, { projectRoot: p1.root });
  assert.equal(r1.ok, false);
  assert.equal(r1.fallback, 'rebuild', '回退既有重建路径与报错口径');
  assert.match(r1.message, /当前为|认领/, '如实说明当前状态');

  // 变体二：人工已处理（回已计划且未认领）
  const p2 = mkProject('atb-cont-planned-');
  const c2 = mkBlockedClaimed(p2, '人工回到已计划', W1);
  writeItemSt(p2, c2.a, { status: 'planned', owner: '' });
  const r2 = batch.continueRun(p2.dataDir, c2.runId, { projectRoot: p2.root });
  assert.equal(r2.ok, false);
  assert.equal(r2.fallback, 'rebuild');
});

t('D4 原路径回归：failed 终态且条目 planned 未认领 → 不适用续接（rebuild），按原条目重建路径不受影响', () => {
  const p = mkProject('atb-cont-regress-');
  const a = mkDevItem(p, '失败后原路径重建');
  const { batch: b } = batch.createBatch(p.dataDir, { projectRoot: p.root });
  const r1 = batch.nextItem(p.dataDir, b.batchId, { owner: W1 });
  batch.finishRun(p.dataDir, r1.runId, { result: 'failed', reason: '实施失败', safeToContinue: true }); // failed 终态（未认领，条目保持 planned）
  assert.equal(readItemSt(p, a).status, 'planned', '前置：条目未被认领');
  const c = batch.continueRun(p.dataDir, r1.runId, { projectRoot: p.root });
  assert.equal(c.ok, false, '非 blocked 记录不适用续接');
  assert.equal(c.fallback, 'rebuild', '指示走既有重建路径');
  // REQ-20260908-026 行为不变：以该条目重建新的待启动任务
  const rebuild = batch.createBatch(p.dataDir, { ids: [a], projectRoot: p.root });
  assert.equal(rebuild.created, true, '单条目重建路径保持可用');
  assert.deepEqual(rebuild.batch.candidates, [a], '重建以该条目为队首种子');
});

t('D5 原路径回归：interrupted 终态且条目 planned 未认领 → 不适用续接（rebuild），重建路径保持可用', () => {
  const p = mkProject('atb-cont-interrupt-');
  const a = mkDevItem(p, '中断后原路径重建');
  const { batch: b } = batch.createBatch(p.dataDir, { projectRoot: p.root });
  const r1 = batch.nextItem(p.dataDir, b.batchId, { owner: W1 });
  // 人工终止任务：在途预留落 interrupted 终态（REQ-20260908-026 重试集合成员），条目保持 planned 未认领
  batch.abortBatch(p.dataDir, b.batchId);
  assert.equal(readItemSt(p, a).status, 'planned', '前置：条目未被认领');
  const c = batch.continueRun(p.dataDir, r1.runId, { projectRoot: p.root });
  assert.equal(c.ok, false, 'interrupted 记录不适用续接（仅限 blocked 回执）');
  assert.equal(c.fallback, 'rebuild', '指示走既有重建路径');
  // REQ-20260908-026 行为不变：interrupted 记录同样以该条目重建新的待启动任务
  const rebuild = batch.createBatch(p.dataDir, { ids: [a], projectRoot: p.root });
  assert.equal(rebuild.created, true, 'interrupted 后单条目重建路径保持可用');
  assert.deepEqual(rebuild.batch.candidates, [a], '重建以该条目为队首种子');
});

// ---------- 前端静态契约 ----------

t('U1 retryRunFromRecord 终态分支：blocked 记录先走续接接口，成功后自动复制并展示面板', () => {
  const f = appJs.match(/async function retryRunFromRecord[\s\S]{0,2200}/);
  assert.ok(f, '应存在 retryRunFromRecord');
  const body = f[0];
  assert.match(body, /rec\.result === 'blocked'/, '终态分支须先识别 blocked 记录');
  assert.match(body, /\/api\/batch\/continue/, '应调用续接接口');
  assert.match(body, /state\.batchContinue/, '成功后保存续接提示词状态');
  assert.match(body, /copyDispatchText\(c\.prompt\)/, '自动复制续接提示词');
  assert.match(body, /!copied/, '复制失败不得宣称已复制');
});

t('U2 前端回退口径：fallback=none 直接给指引；fallback=rebuild 落回原重建路径；refine 分支不受影响', () => {
  const f = appJs.match(/async function retryRunFromRecord[\s\S]{0,2200}/);
  const body = f[0];
  assert.match(body, /fallback === 'none'/, '在途等场景直接 toast 指引');
  assert.match(body, /fallback === 'rebuild'/, '条件不符回退重建路径');
  assert.match(body, /createBatchAndCopy\(\{ ids: \[rec\.itemId\] \}\)/, '原重建调用保留');
  assert.match(body, /\/api\/refine\/create/, 'refine 终态分支维持原路径');
});

t('U3 续接提示词面板：记录分区表格下方常驻展示，支持重新复制', () => {
  assert.match(appJs, /function batchContinueHtml/, '应有续接提示词面板渲染函数');
  const f = appJs.match(/function batchContinueHtml[\s\S]{0,700}/);
  assert.match(f[0], /id="continueRecopy"/, '面板应有重新复制按钮');
  assert.match(f[0], /id="continuePrompt"/, '面板应展示提示词全文（手动复制兜底）');
  const pane = appJs.match(/records: runAttemptsHtml\(data\.records \|\| \[\], data\.recordsTotal \?\? \(data\.records \|\| \[\]\)\.length, 'develop', ql\)[\s\S]{0,200}/);
  assert.ok(pane, '应定位批量开发记录分区');
  assert.match(pane[0], /batchContinueHtml\(\)/, '续接面板挂在记录分区（表格下方）');
});

t('U4 服务端路由：POST /api/batch/continue 透传 batch.continueRun', () => {
  const m = serverJs.match(/\/api\/batch\/continue[\s\S]{0,500}/);
  assert.ok(m, '应注册 /api/batch/continue 路由');
  assert.match(serverJs, /batch\.continueRun\(/, '应调用数据层 continueRun');
});

// ---------- i18n 词典同步（BUG-20260912-001 口径） ----------

t('I1 新增界面文案已同步英文词典（静态 + 动态）', () => {
  const { EN, EN_DYNAMIC } = globalThis.ATBI18N._dict;
  assert.ok('已生成续接提示词，但复制失败：请在「记录」分区的续接提示词面板手动复制' in EN, '复制失败文案（静态）');
  assert.ok('已复制续接提示词；请在原项目会话粘贴发送' in EN, '重新复制成功文案（静态）');
  assert.ok('✓ 已复制续接提示词（条目 ◇，沿用原认领身份 ◇）：请先确认旧子代理已停止，再到原项目会话粘贴发送' in EN_DYNAMIC, '成功 toast（动态）');
  assert.ok('续接提示词（条目 ◇ · 沿用原认领身份 ◇）：在原项目会话粘贴发送，先确认旧子代理已停止' in EN_DYNAMIC, '面板标题（动态）');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
