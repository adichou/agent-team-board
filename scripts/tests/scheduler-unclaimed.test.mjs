// BUG-20260906-006：未认领条目失败后，不得跨 run 重置尝试预算。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as store from '../lib/dispatch-store.mjs';
import { createScheduler } from '../lib/scheduler.mjs';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// BUG-20260910-012：预算取 scheduler.test.mjs 同款 15s——断言语义不变（通过时仍毫秒级收敛），
// 只在真故障时兜底；label 标注卡点，避免再出现「三处共用一句文案、无法定位」的间歇失败。
async function waitFor(check, label) {
  const end = Date.now() + 15_000;
  while (!check()) {
    assert.ok(Date.now() < end, `等待运行结算超时 [${label}]`);
    await sleep(20);
  }
}

for (const mode of ['no-report', 'no-thread', 'timeout-sleep']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-unclaimed-'));
  const d = core.initData(root).dataDir || core.requireDataDir(root);
  const createItem = (title) => {
    const item = core.createItem(d, { type: 'requirement', title, by: 'test' });
    // REQ-20260908-010：调度只从 planned（已计划）取单
    core.setStatus(d, item.id, 'accepted', { by: 'human' });
    core.setStatus(d, item.id, 'planned', { by: 'human' });
    return item.id;
  };
  let currentMode = mode;
  // BUG-20260910-012：150ms 单项时限只服务于首个 timeout-sleep run（验证超时强杀路径）。
  // 重启后的调度器还要跑后续 worker-ok 条目（node 启动 + atb claim/report 三个串行子进程），
  // 高负载下不可能 150ms 完成——沿用会把守规执行误杀成 timeout 失败，agentCompletedAt 永不出现，
  // waitFor 空转到断言超时（间歇失败的根源）。重启/后续阶段一律用正常时限。
  const makeScheduler = ({ probeTimeout = true } = {}) => createScheduler({
    projectRoot: root, dataDir: d, atbCliPath: path.join(base, 'atb.mjs'),
    cli: {
      path: process.execPath, spawnArgs: [path.join(base, 'tests/fixtures/fake-codex.mjs')],
      envForRun: () => ({ FAKE_MODE: currentMode }),
    },
    tickMs: 25, maxResumeRounds: 1,
    timeoutMs: probeTimeout && mode === 'timeout-sleep' ? 150 : 5000,
    cancelGraceMs: 50, settleMs: 50,
  });
  let s = makeScheduler();
  try {
    const id = createItem('未认领');
    s.enable();
    await waitFor(() => store.listRuns(d).items.some((r) => store.isTerminalPhase(r.phase)), `${mode}：首个 run 进入终态`);
    s.disable();
    await waitFor(() => !s.status().current, `${mode}：disable 后 current 清空`);
    assert.equal(core.getItemDetail(d, id).status, 'planned', '执行器不能伪造认领');
    const first = store.listRuns(d).items[0];
    assert.equal(first.attempts.length, mode === 'no-report' ? 2 : 1, '单 run 的尝试预算仍生效');
    s.enable();
    await sleep(250);
    assert.equal(store.listRuns(d).total, 1, `${mode}：重新开启后不得自动重派失败项`);

    await s.shutdown();
    s = makeScheduler({ probeTimeout: false });
    s.recover();
    s.enable();
    await sleep(250);
    assert.equal(store.listRuns(d).total, 1, `${mode}：重启后不得丢失失败记录`);

    currentMode = 'worker-ok';
    const next = createItem('后续可运行条目');
    await waitFor(() => !!core.getItemDetail(d, next).agentCompletedAt, `${mode}：后续条目完成上报`);
    assert.equal(store.listRuns(d).total, 2, '失败项不应阻止其他条目正常派发');
    console.log(`✓ ${mode}：有限尝试、重新开启、重启和后续条目`);
  } finally {
    await s.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
