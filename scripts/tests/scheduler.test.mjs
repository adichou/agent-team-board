#!/usr/bin/env node
// REQ-20260906-003 Scheduler —— 选单/依赖/互斥/重试/续跑/取消/恢复 功能测试（假 CLI 端到端）
// 用法：node scripts/tests/scheduler.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as store from '../lib/dispatch-store.mjs';
import { createScheduler, createHub } from '../lib/scheduler.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = path.join(PLUGIN_ROOT, 'scripts', 'tests', 'fixtures', 'fake-codex.mjs');
const ATB = path.join(PLUGIN_ROOT, 'scripts', 'atb.mjs');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond, timeoutMs = 10_000, label = '') {
  const start = Date.now();
  for (;;) {
    if (cond()) return true;
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时：${label || cond.name}`);
    await sleep(30);
  }
}

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-sched-'));
  core.initData(root);
  return root;
}

function makeItem(dataDir, { type = 'req', title, accept = true }) {
  const st = core.createItem(dataDir, { type: type === 'bug' ? 'bug' : 'requirement', title, by: 't' });
  // REQ-20260908-010：调度只从 planned（已计划）取单，测试样本接受后默认置计划
  if (accept) {
    core.setStatus(dataDir, st.id, 'accepted', { by: 'human' });
    core.setStatus(dataDir, st.id, 'planned', { by: 'human' });
  }
  return st.id;
}

let spawnCount = 0;

function mkScheduler(root, mode, opts = {}) {
  const dataDir = core.requireDataDir(root);
  spawnCount = 0;
  return createScheduler({
    projectRoot: root,
    dataDir,
    hub: opts.hub || createHub(),
    atbCliPath: ATB,
    cli: {
      path: opts.cliPath || process.execPath,
      spawnArgs: [FIXTURE],
      envForRun: (run) => {
        spawnCount++;
        return {
          FAKE_MODE: mode,
          FAKE_ATB_CLI: ATB,
          FAKE_ITEM_ID: run.itemId,
          FAKE_RECORD: path.join(store.runDir(dataDir, run.runId), 'worker-record.json'),
          ...(opts.extraEnv || {}),
        };
      },
    },
    tickMs: opts.tickMs ?? 50,
    backoffs: opts.backoffs ?? [60, 90],
    cancelGraceMs: opts.cancelGraceMs ?? 250,
    settleMs: opts.settleMs ?? 150,
    maxResumeRounds: opts.maxResumeRounds ?? 2,
    timeoutMs: opts.timeoutMs ?? 60_000,
  });
}

t('D1 选单排序：最旧优先（纯创建时间序，REQ-20260908-010）；依赖未满足与 submitted 排除（C02/C03）', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  const bugId = makeItem(d, { type: 'bug', title: '老 Bug' });          // 创建最早
  const reqId = makeItem(d, { title: '需求乙' });
  const reqDep = makeItem(d, { title: '依赖未满足' });
  makeItem(d, { title: '未接受', accept: false });
  const known = new Set(core.listItems(d).map((x) => x.id));
  store.saveItemPolicy(d, reqDep, [bugId], { existsIds: known });       // 依赖未 done 的 bug

  const s = mkScheduler(root, 'worker-ok');
  s.enable();
  await waitFor(() => store.listRuns(d).total >= 1);
  const firstId = store.listRuns(d).items[0].runId;
  assert.equal(store.getRun(d, firstId).itemId, bugId, '创建最早的 Bug 应最先被处理（最旧优先）');
  await waitFor(() => {
    const r = store.getRun(d, firstId);
    return r.phase !== 'reserved' && r.phase !== 'starting' && r.phase !== 'running';
  });
  s.stop();
});

t('D2 空队列不调用模型；后来置计划的条目可被处理（C02；REQ-20260908-010 实时获取）', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  makeItem(d, { title: '还没接受', accept: false });
  const s = mkScheduler(root, 'worker-ok');
  s.enable();
  await sleep(400);
  assert.equal(spawnCount, 0, '空队列绝不能调用模型');
  assert.equal(s.status().waiting.kind, 'empty');

  const id = makeItem(d, { title: '后置计划', accept: false });
  core.setStatus(d, id, 'accepted', { by: 'human' });
  core.setStatus(d, id, 'planned', { by: 'human' });
  await waitFor(() => store.listRuns(d).total === 1);
  await waitFor(() => store.listRuns(d).items[0].phase === 'reported');
  s.stop();
});

t('D3 连续多项：不同会话 ID、上报后释放锁、继续下一项（C22 假 CLI 形态）', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  const id1 = makeItem(d, { title: '一' });
  const id2 = makeItem(d, { title: '二' });
  const s = mkScheduler(root, 'worker-ok');
  s.enable();
  await waitFor(() => store.listRuns(d).total === 2 && store.listRuns(d).items.every((r) => r.phase === 'reported'), 15_000);
  const runs = store.listRuns(d).items.sort((a, b) => a.seq - b.seq);
  assert.ok(runs[0].threadId && runs[1].threadId);
  assert.notEqual(runs[0].threadId, runs[1].threadId, '各项必须是不同会话');
  for (const id of [id1, id2]) {
    const it = core.getItemDetail(d, id);
    assert.equal(it.status, 'in-progress');
    assert.equal(it.owner, id, 'worker 按提示词以单号认领');
    assert.ok(it.agentCompletedAt, '必须有新的上报标记');
  }
  assert.equal(store.readProjectLock(d), null, '上报后项目锁应释放');
  assert.equal(s.status().waiting.kind, 'empty');
  s.stop();
});

t('D4 一轮未上报 → 按确切 threadId 续跑后上报成功（C09）', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  makeItem(d, { title: '迟到上报' });
  const s = mkScheduler(root, 'worker-late-report');
  s.enable();
  await waitFor(() => {
    const r = store.listRuns(d).items[0];
    return r && r.phase === 'reported';
  }, 15_000);
  const run = store.listRuns(d).items[0];
  assert.equal(run.attempts.length, 2, '初始 + 续跑共两次尝试');
  assert.equal(run.attempts[1].kind, 'resume');
  assert.equal(run.attempts[1].resumeThreadId, run.threadId, '续跑必须用已记录的确切会话 ID');
  const it = core.getItemDetail(d, run.itemId);
  assert.ok(it.agentCompletedAt);
  s.stop();
});

t('D5 续跑上限：默认最多追加 2 轮，超限转 blocked 且不派下一项同条目（C09）', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  makeItem(d, { title: '卡住' });
  const s = mkScheduler(root, 'worker-stuck');
  s.enable();
  await waitFor(() => {
    const r = store.listRuns(d).items[0];
    return r && r.phase === 'blocked';
  }, 15_000);
  const run = store.listRuns(d).items[0];
  assert.equal(run.attempts.length, 3, '1 次初始 + 2 次续跑');
  assert.equal(run.result.reason, 'unfinished-after-continuation');
  await sleep(300);
  assert.equal(store.listRuns(d).total, 1, '同一条目不得重复派发新 run');
  s.stop();
});

t('D6 关闭开关只停止领取新项，当前项默认继续（C10）', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  makeItem(d, { title: '慢活' });
  makeItem(d, { title: '下一项' });
  const s = mkScheduler(root, 'worker-ok-slow');
  s.enable();
  await waitFor(() => s.status().current !== null);
  s.disable();
  assert.equal(s.status().enabled, false);
  await waitFor(() => store.listRuns(d).items[0].phase === 'reported', 15_000, '当前执行完成后停止派发');
  await sleep(300);
  assert.equal(store.listRuns(d).total, 1, '关闭后不得再领取新条目');
  s.stop();
});

t('D7 停止当前：先持久化停止请求（停止中），确认回收后 interrupted（C10/C11）', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  makeItem(d, { title: '挂死活' });
  const s = mkScheduler(root, 'worker-hang');
  s.enable();
  await waitFor(() => s.status().current !== null && s.status().current.phase === 'running');
  s.stopCurrent();
  const stopping = store.getRun(d, s.status().current?.runId || store.listRuns(d).items[0].runId);
  assert.equal(stopping.cancelRequested, true, '停止请求必须先持久化');
  await waitFor(() => {
    const r = store.listRuns(d).items[0];
    return r.phase === 'interrupted';
  }, 15_000);
  const run = store.listRuns(d).items[0];
  assert.equal(run.result.reason, 'user-stop');
  assert.equal(store.readProjectLock(d), null, '确认结束后释放实施占用');
  const pid = run.attempts[0].pid;
  assert.ok(pid, '应记录受管进程 PID');
  let dead = false;
  try { process.kill(pid, 0); } catch { dead = true; }
  assert.ok(dead, '受管进程必须已回收');
  s.stop();
});

t('D8 认证失败：暂停执行器，不继续领取其余任务（C14）', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  makeItem(d, { title: '第一个' });
  makeItem(d, { title: '不该被领' });
  const s = mkScheduler(root, 'auth-error');
  s.enable();
  await waitFor(() => s.status().paused === true, 15_000);
  assert.match(s.status().pauseReason, /登录|认证|401/);
  await sleep(300);
  assert.equal(store.listRuns(d).total, 1, '环境级错误不得逐一失败整批条目');
  s.stop();
});

t('D9 网络错误：按退避重试并记录，恢复后完成上报（C14）', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  makeItem(d, { title: '网络抖动' });
  const s = mkScheduler(root, 'worker-net-fail-once');
  s.enable();
  await waitFor(() => store.listRuns(d).items[0]?.phase === 'reported', 15_000);
  const run = store.listRuns(d).items[0];
  assert.equal(run.retriesUsed, 1, '重试次数要有持久化记录');
  const kinds = run.attempts.map((a) => a.kind);
  assert.ok(kinds.includes('retry'), '网络重试作为独立尝试记录');
  await sleep(100);
  s.stop();
});

t('D10 项目互斥：未知 in-progress 执行（手工/Zcode）占用时不抢占（C04）', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  const busy = makeItem(d, { title: '手工在办' });
  core.claim(d, busy, 'manual-session');
  makeItem(d, { title: '候选' });
  const s = mkScheduler(root, 'worker-ok');
  s.enable();
  await sleep(400);
  assert.equal(store.listRuns(d).total, 0, '不得静默抢占旧 owner');
  const w = s.status().waiting;
  assert.equal(w.kind, 'project-busy');
  assert.match(w.holder, /manual-session/);
  s.stop();
});

t('D11 崩溃恢复：running 记录核销为可核对状态；重启后默认等待人工（C15/C16）', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  const id = makeItem(d, { title: '崩溃现场' });
  // 构造崩溃窗口：run 已 running、记了 PID（早已死）与 threadId，但条目无人认领
  const run = store.newRun(d, { itemId: id, projectRoot: root, prompt: 'p' });
  store.updateRun(d, run.runId, {
    phase: 'running', startedAt: new Date().toISOString(), threadId: 'th-crash',
    attempts: [{ attemptNo: 1, kind: 'new', startedAt: new Date().toISOString(), pid: 999_999, pidStartTime: null }],
  });
  store.saveSettings(d, { codex: { enabled: true } });

  const s = mkScheduler(root, 'worker-ok');
  s.recover();
  const recovered = store.getRun(d, run.runId);
  assert.equal(recovered.phase, 'blocked', '会话中断且无人认领 → blocked 交人工核对');
  assert.match(recovered.recoveryNote || '', /恢复/);
  assert.equal(s.status().enabled, false, '重启后默认不自动继续');
  assert.match(s.status().recoveryNote || '', /等待继续|已恢复记录/);
  s.stop();
});

t('D11b 重启自动继续开启且核对通过时恢复取单（C16）', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  makeItem(d, { title: '待办' });
  store.saveSettings(d, { codex: { enabled: true, resumeAfterRestart: true } });
  const s = mkScheduler(root, 'worker-ok');
  s.recover();
  assert.equal(s.status().enabled, true);
  await waitFor(() => store.listRuns(d).total === 1 && store.listRuns(d).items[0].phase === 'reported', 15_000);
  s.stop();
});

t('D12 全局串行：首期全服务并发 1，其他项目排队可见（README 并发约定）', async () => {
  const hub = createHub();
  const rootA = tempProject();
  const rootB = tempProject();
  const dA = core.requireDataDir(rootA);
  const dB = core.requireDataDir(rootB);
  makeItem(dA, { title: 'A 慢活' });
  makeItem(dB, { title: 'B 候选' });
  const sa = mkScheduler(rootA, 'worker-ok-slow', { hub });
  const sb = mkScheduler(rootB, 'worker-ok', { hub });
  sa.enable();
  sb.enable();
  await waitFor(() => sb.status().waiting.kind === 'global-busy', 5_000);
  assert.match(sb.status().waiting.holder || '', /A 慢活|rootA/, '应显示持有项目信息');
  await waitFor(() => store.listRuns(dB).total === 1 && store.listRuns(dB).items[0].phase === 'reported', 20_000, 'A 完成后 B 才开始');
  sa.stop();
  sb.stop();
});

t('D13 CLI 缺失：启动失败不产生半执行状态，执行器暂停并给出原因（C01 局部）', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  makeItem(d, { title: '目标' });
  const s = mkScheduler(root, 'worker-ok', { cliPath: '/nonexistent/codex' });
  s.enable();
  await waitFor(() => s.status().paused === true, 10_000);
  assert.match(s.status().pauseReason, /CLI|启动失败|codex/i);
  const run = store.listRuns(d).items[0];
  assert.equal(run.phase, 'failed');
  assert.equal(store.readProjectLock(d), null);
  s.stop();
});

t('D14 失败遗留用户改动不清理；git 工作区不确定时暂停项目（C17）', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  fs.writeFileSync(path.join(root, 'src.txt'), '原始内容\n');
  spawnSync('git', ['-C', root, 'init', '-q'], { stdio: 'ignore' });
  spawnSync('git', ['-C', root, 'add', '.'], { stdio: 'ignore' });
  spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { stdio: 'ignore' });
  makeItem(d, { title: '弄脏现场' });

  const s = mkScheduler(root, 'worker-dirty-fail');
  s.enable();
  await waitFor(() => s.status().paused === true, 15_000);
  assert.match(s.status().pauseReason, /工作区|改动/);
  const content = fs.readFileSync(path.join(root, 'src.txt'), 'utf8');
  assert.match(content, /worker 改动/, '失败遗留改动绝不能被自动清理');
  s.stop();
});

t('D15 手工认领互斥（C04）：自动派发实施期间 atb claim 被拒，收尾后放行', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  const id1 = makeItem(d, { title: '自动执行中' });
  const id2 = makeItem(d, { title: '手工想认领' });
  const known = new Set(core.listItems(d).map((x) => x.id));
  store.saveItemPolicy(d, id2, [id1], { existsIds: known }); // 依赖未满足：调度器永不选 id2
  const s = mkScheduler(root, 'worker-ok-slow');
  s.enable();
  await waitFor(() => s.status().current !== null);
  assert.throws(() => core.claim(d, id2, 'manual-session'), /互斥/, '实施期间其他认领应被 impl.lock 拒绝');
  await waitFor(() => store.listRuns(d).items[0].phase === 'reported', 15_000);
  const st = core.claim(d, id2, 'manual-session'); // 收尾释放后放行（不抛即通过）
  assert.equal(st.status, 'in-progress');
  s.stop();
});

t('D16 停止后不自动重派：中断过的条目不进自动选单、run 不被续跑复活（回归）', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  makeItem(d, { title: '停后不再派' });
  const s = mkScheduler(root, 'worker-hang');
  s.enable();
  await waitFor(() => s.status().current !== null);
  s.stopCurrent(); // 无论 worker 是否已完成认领，停止后同条目都不得再被领取
  await waitFor(() => {
    const r = store.listRuns(d).items[0];
    return r && r.phase === 'interrupted';
  }, 15_000);
  await sleep(600); // 给潜在的重派/续跑定时器留足窗口
  assert.equal(store.listRuns(d).total, 1, '不得为同条目创建新 run');
  const run = store.getRun(d, store.listRuns(d).items[0].runId);
  assert.equal(run.attempts.length, 1, '停止后不得出现续跑尝试');
  assert.equal(store.readProjectLock(d), null, '不残留实施占用');
  let dead = false;
  try { process.kill(run.attempts[0].pid, 0); } catch { dead = true; }
  assert.ok(dead, '受管进程必须已回收');
  s.stop();
});

t('D18 依赖阻塞：全部候选依赖未满足时 waiting=deps-blocked 而非 empty，并指出前置条目（BUG-20260906-005）', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  const dep = makeItem(d, { title: '未完成前置', accept: false }); // submitted：依赖永不满足
  const id = makeItem(d, { title: '等待前置' });
  const known = new Set(core.listItems(d).map((x) => x.id));
  store.saveItemPolicy(d, id, [dep], { existsIds: known });
  const s = mkScheduler(root, 'worker-ok');
  try {
    s.enable();
    await sleep(300);
    assert.equal(spawnCount, 0, '依赖阻塞期间不得调用模型');
    const w = s.status().waiting;
    assert.equal(w?.kind, 'deps-blocked', `不得误报队列已空：${JSON.stringify(w)}`);
    assert.equal(w.count, 1);
    assert.equal(w.items[0].id, id);
    assert.deepEqual(w.items[0].unsatisfied, [dep], '应指出需完成的前置条目');
    // 多条目阻塞：列表截断前 3 项防载荷膨胀，count 保留真实总数
    const extra = Array.from({ length: 3 }, (_, i) => makeItem(d, { title: `同受阻 ${i}` }));
    for (const e of extra) store.saveItemPolicy(d, e, [dep], { existsIds: known });
    await sleep(200);
    const w4 = s.status().waiting;
    assert.equal(w4.kind, 'deps-blocked');
    assert.equal(w4.count, 4, 'count 必须是真实总数');
    assert.equal(w4.items.length, 3, '列表截断前 3 项');
    // 前置人工验收完成后自动继续派发被阻塞条目（创建最早的 id 最先）
    core.setStatus(d, dep, 'accepted', { by: 'human' });
    core.claim(d, dep, 'human-session'); // 手工认领兜底通道（调度只取 planned，前置单无需置计划）
    core.setStatus(d, dep, 'done', { by: 'human' });
    await waitFor(() => store.listRuns(d).total >= 1);
    const firstRun = store.listRuns(d).items.sort((a, b) => a.seq - b.seq)[0];
    assert.equal(firstRun.itemId, id, '前置完成后应派发原被阻塞条目');
    await waitFor(() => store.getRun(d, firstRun.runId).phase === 'reported', 15_000);
  } finally {
    await s.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

t('D19 网络退避等待期停止当前执行：撤销待执行重试并结束运行（BUG-20260906-007 / C-A4）', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  makeItem(d, { title: '退避中停止' });
  const s = mkScheduler(root, 'net-error', { backoffs: [600, 600] });
  try {
    s.enable();
    await waitFor(() => store.listRuns(d).items.some((x) => x.retriesUsed === 1));
    const runId = store.listRuns(d).items[0].runId;
    const before = spawnCount;
    const stopped = s.stopCurrent();
    assert.equal(stopped.ok, true);
    await sleep(850); // 覆盖退避窗口：待执行重试不得复活
    assert.equal(spawnCount, before, `停止后不得再启动新进程：${JSON.stringify({ stopped, before, starts: spawnCount, state: s.status() })}`);
    const run = store.getRun(d, runId);
    assert.equal(run.phase, 'interrupted', `停止请求应撤销待执行重试并结束运行：${run.phase}`);
    assert.equal(run.result.reason, 'user-stop');
    assert.equal(store.readProjectLock(d), null, '结束运行后应释放实施占用');
    assert.equal(s.status().current, null, '结束后不得残留 current 占用');
    assert.equal(store.listRuns(d).total, 1, '不得为同条目创建新 run');
  } finally {
    await s.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

t('D20 恢复本项必须绑定指定 runId：不得代选其他可恢复执行（BUG-20260906-008 / C-A5）', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  const idOld = makeItem(d, { title: '较早中断' });
  const idNew = makeItem(d, { title: '较新中断' });
  const mkInterrupted = (itemId, threadId) => {
    // REQ-20260906-024：新运行均带模型快照；无快照的旧记录按 M15 不可直接恢复
    const run = store.newRun(d, { itemId, projectRoot: root, prompt: '', modelSnapshot: { mode: 'explicit', modelId: 'fake-astra', reasoningEffort: 'low', source: 'project-explicit', configFingerprint: 'x', resolvedAt: new Date().toISOString() } });
    store.updateRun(d, run.runId, { phase: 'interrupted', threadId, startedAt: new Date().toISOString() });
    return run.runId;
  };
  const older = mkInterrupted(idOld, 'th-older');
  await sleep(20);
  const newer = mkInterrupted(idNew, 'th-newer');
  const reported = store.newRun(d, { itemId: idOld, projectRoot: root, prompt: '' });
  store.updateRun(d, reported.runId, { phase: 'reported', threadId: 'th-reported', startedAt: new Date().toISOString(), endedAt: new Date().toISOString() });

  const s = mkScheduler(root, 'no-report');
  try {
    // 缺 runId：必须拒绝，不得任选一条可恢复记录
    const noArg = s.resumeItem();
    assert.equal(noArg.ok, false, JSON.stringify(noArg));
    assert.match(noArg.error, /runId/);
    // 不存在的 runId：拒绝
    const missing = s.resumeItem('run-not-exist');
    assert.equal(missing.ok, false, JSON.stringify(missing));
    // 非可恢复状态（reported）：拒绝
    const done = s.resumeItem(reported.runId);
    assert.equal(done.ok, false, JSON.stringify(done));
    assert.match(done.error, /blocked\/interrupted|状态/);
    // 绑定较早 run：恢复的必须就是它，且续跑会话 ID 来自该 run
    const resumed = s.resumeItem(older);
    assert.equal(resumed.ok, true, JSON.stringify({ resumed, older, newer }));
    assert.equal(resumed.runId, older, '必须恢复用户指定的执行，而非较新的另一条');
    assert.equal(s.status().current.runId, older);
    const runAfter = store.getRun(d, older);
    assert.equal(runAfter.attempts.at(-1).kind, 'resume');
    assert.equal(runAfter.attempts.at(-1).resumeThreadId, 'th-older', '续跑必须用该 run 已记录的确切会话 ID');
    assert.equal(store.readProjectLock(d).runId, older, '实施互斥归属必须是恢复的 run');
  } finally {
    await s.shutdown({ cancelCurrent: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const [mode, reason, message] of [
  ['project-error', 'project', 'Not inside a trusted directory'],
  ['args-error', 'cli-args', "unexpected argument '-C'"],
]) {
  t(`D17 ${reason} 启动失败保留真实诊断并暂停执行器`, async () => {
    const root = tempProject();
    const d = core.requireDataDir(root);
    const id = makeItem(d, { title: '环境拒绝' });
    makeItem(d, { title: '后续条目' });
    const s = mkScheduler(root, mode);
    try {
      s.enable();
      await waitFor(() => s.status().paused, 5000, '环境失败暂停');
      await sleep(150);
      const run = store.listRuns(d).items[0];
      assert.equal(store.listRuns(d).total, 1, '环境失败不得继续派发');
      assert.equal(run.result.reason, reason);
      assert.ok(run.result.detail.includes(message), '执行记录必须保留底层原因');
      assert.ok(s.status().pauseReason.includes(message), '暂停提示必须显示底层原因');
      assert.equal(run.threadId, null);
      assert.equal(core.getItemDetail(d, id).status, 'planned', '未实际认领时业务状态保持不变');
    } finally {
      await s.shutdown();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

// ---------- REQ-20260907-007 一键派单已删除：dispatchItem 移除契约 ----------
// 原 D21-D25（REQ-20260906-019 dispatchItem 行为用例）随功能一并移除；
// 校验/互斥路径仍由自动派发（tick/startRunForItem）与批量开发用例覆盖。

t('D21 一键派单已删除：调度器不再暴露 dispatchItem（派单只能通过批量开发）', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  const id = makeItem(d, { title: '只能批量开发' });
  const s = mkScheduler(root, 'worker-ok');
  assert.equal(typeof s.dispatchItem, 'undefined', 'dispatchItem 应已移除');
  // 自动派发路径不受影响：开启后 tick 仍可正常领取执行
  assert.equal(typeof s.tick, 'function', '自动派发 tick 保留');
  assert.equal(core.getItemDetail(d, id).status, 'planned', '条目状态不受影响');
  s.stop();
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
